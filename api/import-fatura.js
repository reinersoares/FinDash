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

const PROMPT = `Você vai receber um documento em PDF. Ele PODE ser uma fatura de cartão de crédito de um banco brasileiro (geralmente Nubank), ou pode ser outra coisa completamente diferente (currículo, contrato, foto aleatória, etc).

PRIMEIRO, decida: isso é realmente uma fatura de cartão de crédito? Procure por sinais como: nome de banco, "fatura", "vencimento", lista de transações com valores em R$, período de referência. Se NÃO for uma fatura de cartão, retorne "eh_fatura_cartao": false e pare por aí — não invente lançamentos.

Se FOR uma fatura, extraia TODOS os lançamentos da seção de transações (ignore texto de marketing, simulações de parcelamento da própria fatura em atraso, e informações de limite disponível).

Preste atenção nestes padrões, que são diferentes entre si:
- Compra parcelada: descrição termina em "Parcela X/Y" (ex: "Amazon - Parcela 3/6"). Extraia X e Y.
  IMPORTANTE: só preencha parcela_atual/parcela_total se você conseguir apontar o padrão "X/Y" (ou equivalente, tipo "X de Y") literalmente escrito perto do lançamento. NUNCA infira parcelamento por conhecimento geral sobre o tipo de compra (ex: não assuma que passagem aérea é parcelada só porque isso é comum no Brasil — isso é invenção, não leitura). Na dúvida, deixe null.
- Assinatura recorrente: se repete todo mês com valor igual ou muito próximo, SEM "Parcela X/Y" no nome (ex: "Nubank Ultravioleta", "Dm*Spotify", "Apple.Com/Bill"). NÃO trate como parcelamento.
- Estorno: linhas que começam com "Estorno de" e têm valor negativo, referentes a uma compra específica (cancelamento, devolução, estorno de IOF de compra internacional). Marque tipo "estorno" e valor negativo. Estornos SÃO parte da fatura e devem continuar na lista de lançamentos normalmente — o "Total a pagar" da fatura já é líquido deles.
- Pagamento da fatura anterior: uma linha (geralmente única, valor alto, negativo) referente ao PAGAMENTO que você fez da fatura do mês passado — não é uma compra nem um estorno de compra específica. Aparece com descrições como "Pagamento em [data]", "Pagamento recebido", "Pagamento efetuado" ou similar, SEM nome de estabelecimento comercial. Isso NÃO é um gasto do período atual, é só a baixa do saldo anterior. Marque tipo "pagamento_fatura_anterior". Não confunda com estorno: estorno está ligado a uma compra específica que aparece na própria fatura; pagamento da fatura anterior está ligado ao boleto/fatura do mês retrasado, não a uma compra.
- Pode haver duas compras diferentes do MESMO estabelecimento com a MESMA numeração de parcela (ex: duas compras "NuViagens - Parcela 7/8" com valores diferentes) — são séries distintas, mantenha os valores exatos de cada uma para permitir diferenciá-las depois.

Para cada lançamento, retorne um objeto com:
- "data": formato YYYY-MM-DD. Se o item não tiver data individual visível, tente inferir pelo contexto (ex: dentro do período da fatura); se realmente não for possível, use null.
- "data_confiavel": true se a data veio explícita no documento, false se foi inferida ou é null
- "estabelecimento": nome limpo, sem o texto "- Parcela X/Y"
- "valor": número (negativo se for estorno)
- "parcela_atual": número inteiro, ou null se não for parcelado
- "parcela_total": número inteiro, ou null se não for parcelado
- "tipo": "compra", "estorno", "assinatura", "pagamento_fatura_anterior", ou "outro"
- "categoria_sugerida": a categoria mais adequada dentre: ${CATEGORIAS.join(", ")}.
- "categoria_e_fallback": true se NENHUMA categoria da lista combina bem de verdade e você escolheu a menos ruim só pra preencher o campo. false se a categoria escolhida realmente descreve o gasto.
- "confianca_leitura": "alta", "media" ou "baixa" — o quão bem você conseguiu LER o texto/valor desse item no documento (nitidez, legibilidade)
- "confianca_categoria": "alta", "media" ou "baixa" — o quão bem a categoria escolhida realmente representa esse gasto (independente de você ter lido o texto bem ou não)

Não misture as duas confianças: dá pra ler um item perfeitamente (confianca_leitura alta) e mesmo assim não ter categoria boa pra ele (confianca_categoria baixa).

Também extraia:
- "eh_fatura_cartao": true ou false
- "periodo_fatura": {"inicio": "YYYY-MM-DD", "fim": "YYYY-MM-DD"} ou null se não encontrado
- "vencimento": "YYYY-MM-DD" ou null
- "total_fatura": número, ou null se não encontrado

Responda APENAS com JSON válido, sem texto antes/depois, sem blocos de código markdown:
{
  "eh_fatura_cartao": true,
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

    // Se o próprio Gemini disse que isso não é uma fatura, ou não achou nenhum
    // lançamento, isso NÃO é um "checksum ok" — é uma falha, e precisa ser
    // reportado como tal, não como sucesso com zero itens.
    if (parsed.eh_fatura_cartao === false || (parsed.lancamentos || []).length === 0) {
      return res.status(422).json({
        error: 'O documento enviado não parece ser uma fatura de cartão de crédito, ou não foi possível extrair nenhum lançamento dele.',
        eh_fatura_cartao: parsed.eh_fatura_cartao ?? null,
      });
    }

    // Pagamento da fatura anterior não é gasto do período e o "Total a pagar"
    // impresso na fatura já não inclui isso — então precisa ficar de fora tanto
    // do checksum quanto da lista que vai pra revisão, ou o valor do pagamento
    // aparece como "diferença" no checksum sem motivo aparente.
    const pagamentosExcluidos = parsed.lancamentos.filter(
      (item) => item.tipo === 'pagamento_fatura_anterior'
    );
    const lancamentos = parsed.lancamentos.filter(
      (item) => item.tipo !== 'pagamento_fatura_anterior'
    );

    // Checksum: soma os lançamentos extraídos (já sem pagamento da fatura anterior)
    // e compara com o total impresso na fatura. Se não bater (tolerância de 1 centavo
    // pra arredondamento), a extração tem erro em algum lugar e não deveria ser
    // confiada sem revisão manual mais cuidadosa.
    const somaLancamentos = lancamentos.reduce(
      (acc, item) => acc + (Number(item.valor) || 0),
      0
    );
    const totalFatura = Number(parsed.total_fatura) || 0;
    const totalFaturaConhecido = parsed.total_fatura !== null && parsed.total_fatura !== undefined;
    const diferenca = Math.round((somaLancamentos - totalFatura) * 100) / 100;
    const checksumOk = totalFaturaConhecido && Math.abs(diferenca) <= 0.01;

    // Itens que precisam de atenção manual antes de confirmar qualquer importação:
    // sem data confiável, ou categoria que é só um fallback forçado.
    const itensParaRevisar = lancamentos.filter(
      (item) => item.data_confiavel === false || item.categoria_e_fallback === true
    ).length;

    return res.status(200).json({
      ...parsed,
      lancamentos,
      _checksum: {
        soma_lancamentos: Math.round(somaLancamentos * 100) / 100,
        total_fatura: totalFaturaConhecido ? totalFatura : null,
        diferenca: totalFaturaConhecido ? diferenca : null,
        ok: checksumOk,
      },
      _itens_para_revisar: itensParaRevisar,
      _pagamentos_excluidos: pagamentosExcluidos, // informativo, não vai pra tela — só pra debug se precisar
    });
  } catch (err) {
    console.error('Erro em import-fatura:', err);
    return res.status(500).json({ error: 'Erro interno', detalhe: err.message });
  }
}
