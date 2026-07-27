// api/import-fatura.js
//
// FASE 1: só extração. Não grava nada no Firestore.
// Recebe o PDF em base64, manda pro Gemini como documento (visão nativa,
// entende tabela/layout, não é extração de texto puro), pede JSON estruturado,
// e valida com checksum contra o "Total a pagar" da própria fatura.

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

// Suas 14 categorias atuais — se você adicionar/remover categoria no FinDash,
// atualize aqui também.
const CATEGORIAS = [
  "Futebol", "Carro", "Combustível", "Bebida", "Assinatura", "Vestuário",
  "Internet", "FastFood", "Tec", "Lazer", "Viagens", "Yasmim", "Barbeiro", "Faculdade"
];

const PROMPT = `Você vai receber uma fatura de cartão de crédito em PDF (banco brasileiro, geralmente Nubank).

Extraia TODOS os lançamentos da seção "TRANSAÇÕES" (ignore texto de marketing, simulações de parcelamento da própria fatura em atraso, e informações de limite disponível).

Preste atenção nestes padrões, que são diferentes entre si:
- Compra parcelada: descrição termina em "Parcela X/Y" (ex: "Amazon - Parcela 3/6"). Extraia X e Y.
- Assinatura recorrente: se repete todo mês com valor igual ou muito próximo, SEM "Parcela X/Y" no nome (ex: "Nubank Ultravioleta", "Dm*Spotify", "Apple.Com/Bill"). NÃO trate como parcelamento.
- Estorno: linhas que começam com "Estorno de" e têm valor negativo. Marque tipo "estorno" e valor negativo.
- Pode haver duas compras diferentes do MESMO estabelecimento com a MESMA numeração de parcela (ex: duas compras "NuViagens - Parcela 7/8" com valores diferentes) — são séries distintas, mantenha os valores exatos de cada uma para permitir diferenciá-las depois.

Para cada lançamento, retorne um objeto com:
- "data": formato YYYY-MM-DD (o ano vem do cabeçalho da fatura, ex: "FATURA 10 JUL 2026")
- "estabelecimento": nome limpo, sem o texto "- Parcela X/Y"
- "valor": número (negativo se for estorno)
- "parcela_atual": número inteiro, ou null se não for parcelado
- "parcela_total": número inteiro, ou null se não for parcelado
- "tipo": "compra", "estorno", "assinatura", ou "outro"
- "categoria_sugerida": a categoria mais adequada dentre: ${CATEGORIAS.join(", ")}. Se nenhuma combinar bem, use "Lazer".
- "confianca": "alta", "media" ou "baixa" — sua confiança nesse item específico

Também extraia:
- "periodo_fatura": {"inicio": "YYYY-MM-DD", "fim": "YYYY-MM-DD"} — do campo "Período vigente"
- "vencimento": "YYYY-MM-DD" — data de vencimento
- "total_fatura": número — o valor de "Total a pagar" impresso no resumo da fatura

Responda APENAS com JSON válido, sem texto antes/depois, sem blocos de código markdown:
{
  "periodo_fatura": {"inicio": "YYYY-MM-DD", "fim": "YYYY-MM-DD"},
  "vencimento": "YYYY-MM-DD",
  "total_fatura": 0000.00,
  "lancamentos": [ { ... } ]
}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido, use POST' });
  }

  const { pdfBase64 } = req.body || {};
  if (!pdfBase64) {
    return res.status(400).json({ error: 'Campo pdfBase64 é obrigatório' });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({
      error: 'GEMINI_API_KEY não configurada neste projeto Vercel. Veja o passo a passo de configuração.',
    });
  }

  // Gemini ocasionalmente devolve 503/UNAVAILABLE quando está sob alta demanda —
  // é transitório, então vale tentar de novo automaticamente antes de desistir.
  async function chamarGemini(tentativa = 1) {
    const resp = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { inline_data: { mime_type: 'application/pdf', data: pdfBase64 } },
                { text: PROMPT },
              ],
            },
          ],
        }),
      }
    );

    const data = await resp.json();
    const status = data?.error?.status;
    const ehTransitorio = resp.status === 503 || status === 'UNAVAILABLE';

    if (!resp.ok && ehTransitorio && tentativa < 3) {
      const espera = tentativa * 2000; // 2s, depois 4s
      await new Promise((r) => setTimeout(r, espera));
      return chamarGemini(tentativa + 1);
    }

    return { resp, data };
  }

  try {
    const { resp: geminiResp, data: geminiData } = await chamarGemini();

    if (!geminiResp.ok) {
      console.error('Erro Gemini:', JSON.stringify(geminiData));
      return res.status(502).json({
        error: 'Gemini retornou erro (já tentou 3 vezes)',
        detalhe: geminiData,
      });
    }

    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const cleanText = rawText.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleanText);
    } catch (e) {
      return res.status(502).json({
        error: 'Gemini não retornou um JSON válido — provavelmente a extração falhou',
        raw: rawText,
      });
    }

    // Checksum: soma os lançamentos extraídos e compara com o total impresso na fatura.
    // Se não bater (tolerância de 1 centavo pra arredondamento), a extração tem erro
    // em algum lugar e não deveria ser confiada sem revisão manual mais cuidadosa.
    const somaLancamentos = (parsed.lancamentos || []).reduce(
      (acc, item) => acc + (Number(item.valor) || 0),
      0
    );
    const totalFatura = Number(parsed.total_fatura) || 0;
    const diferenca = Math.round((somaLancamentos - totalFatura) * 100) / 100;
    const checksumOk = Math.abs(diferenca) <= 0.01;

    return res.status(200).json({
      ...parsed,
      _checksum: {
        soma_lancamentos: Math.round(somaLancamentos * 100) / 100,
        total_fatura: totalFatura,
        diferenca,
        ok: checksumOk,
      },
    });
  } catch (err) {
    console.error('Erro em import-fatura:', err);
    return res.status(500).json({ error: 'Erro interno', detalhe: err.message });
  }
}
