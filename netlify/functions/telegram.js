// netlify/functions/telegram.js
// Bot do Telegram para o FinDash
// Recebe mensagens via webhook, interpreta com Gemini e grava/consulta no Firestore.
//
// Variáveis de ambiente necessárias (configurar no painel da Netlify):
//   TELEGRAM_BOT_TOKEN       -> token do @BotFather
//   TELEGRAM_CHAT_ID         -> seu ID numérico do Telegram (do @userinfobot)
//   TELEGRAM_WEBHOOK_SECRET  -> uma senha qualquer que você inventa (ex: xk29fj3m)
//   GEMINI_API_KEY           -> chave do Google AI Studio
//   FIREBASE_SA_B64          -> JSON da conta de serviço do Firebase em base64
//   FINDASH_DOC_ID           -> amt9nj3f0w (seu código de sincronização)

const admin = require("firebase-admin");

if (!admin.apps.length) {
  const sa = JSON.parse(
    Buffer.from(process.env.FIREBASE_SA_B64, "base64").toString("utf8")
  );
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

const COLLECTION = "banco_findash";
const DOC_ID = process.env.FINDASH_DOC_ID;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

// ---------- utilidades ----------

// Data de hoje em São Paulo, formato YYYY-MM-DD
function hoje() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
}

// Gera id no mesmo estilo do site (9 caracteres minúsculos/números)
function genId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 9; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// Regra da fatura: compra no dia >= closingDay cai na fatura do mês seguinte
function dataFatura(purchaseDate, closingDay, dueDay) {
  const [y, m, d] = purchaseDate.split("-").map(Number);
  let fy = y, fm = m;
  if (d >= closingDay) {
    fm += 1;
    if (fm > 12) { fm = 1; fy += 1; }
  }
  return `${fy}-${String(fm).padStart(2, "0")}-${String(dueDay).padStart(2, "0")}`;
}

// Soma n meses a uma data YYYY-MM-DD mantendo o dia
function somaMeses(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  let ny = y, nm = m + n;
  while (nm > 12) { nm -= 12; ny += 1; }
  return `${ny}-${String(nm).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function fmtBRL(v) {
  return "R$ " + v.toFixed(2).replace(".", ",");
}

async function enviarTelegram(chatId, texto) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: texto }),
  });
}

async function chamarGemini(prompt) {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0 },
      }),
    }
  );
  const data = await resp.json();
  const texto = (data.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || "")
    .join("");
  return texto;
}

function extrairJSON(texto) {
  const limpo = texto.replace(/```json|```/g, "").trim();
  return JSON.parse(limpo);
}

// ---------- handler principal ----------

exports.handler = async (event) => {
  // Sempre responder 200 pro Telegram não ficar reenviando
  const ok = { statusCode: 200, body: "ok" };

  try {
    // 1. Verifica o segredo do webhook (bloqueia requisições falsas)
    const secret =
      event.headers["x-telegram-bot-api-secret-token"] ||
      event.headers["X-Telegram-Bot-Api-Secret-Token"];
    if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
      return { statusCode: 403, body: "forbidden" };
    }

    const update = JSON.parse(event.body || "{}");
    const msg = update.message;
    if (!msg || !msg.text) return ok;

    const chatId = msg.chat.id;

    // 2. Só o dono pode usar
    if (String(chatId) !== String(process.env.TELEGRAM_CHAT_ID)) {
      await enviarTelegram(chatId, "Bot privado.");
      return ok;
    }

    const texto = msg.text.trim();

    if (texto === "/start") {
      await enviarTelegram(
        chatId,
        "FinDash Bot pronto. Exemplos:\n" +
          "• abasteci 100 no crédito\n" +
          "• gastei 35 de fastfood ontem\n" +
          "• recebi 200 de pix\n" +
          "• comprei uma bota de 300 em 3x no cartão\n" +
          "• quanto gastei esse mês?\n" +
          "• quanto gastei com FastFood em julho?"
      );
      return ok;
    }

    // 3. Lê o documento do FinDash (config + lançamentos)
    const docRef = db.collection(COLLECTION).doc(DOC_ID);
    const snap = await docRef.get();
    if (!snap.exists) {
      await enviarTelegram(chatId, "Erro: documento do FinDash não encontrado.");
      return ok;
    }
    const dados = snap.data();
    const card = (dados.cards || [])[0]; // Nubank
    const catDespesa = (dados.categories?.expense || []).map((c) => c.name);
    const catReceita = (dados.categories?.income || []).map((c) => c.name);
    const catInvest = (dados.categories?.investment || []).map((c) => c.name);

    // 4. Pede pro Gemini interpretar a mensagem
    const promptIntent = `Você é o interpretador de um app de finanças pessoais. Hoje é ${hoje()} (fuso de Brasília).
Analise a mensagem do usuário e responda SOMENTE com JSON válido, sem markdown, neste formato:

{
  "intent": "lancar" | "consultar" | "outro",
  "lancamento": {
    "type": "expense" | "income" | "investment",
    "category": "<uma categoria EXATA da lista correspondente>",
    "desc": "<descrição curta, primeira letra maiúscula>",
    "valorTotal": <número>,
    "credito": <true se pagou no cartão de crédito, senão false>,
    "purchaseDate": "<YYYY-MM-DD: data real da compra; hoje salvo se o usuário indicar outro dia como 'ontem' ou 'sábado'>",
    "parcelas": <número de parcelas, 1 se à vista ou não mencionado>
  },
  "pergunta": "<a pergunta do usuário, se intent=consultar>",
  "resposta": "<resposta educada curta, se intent=outro>"
}

Categorias de despesa: ${catDespesa.join(", ")}
Categorias de receita: ${catReceita.join(", ")}
Categorias de investimento: ${catInvest.join(", ")}

Regras:
- "lancar" = usuário informa um gasto, receita ou investimento novo.
- "consultar" = usuário pergunta sobre gastos, receitas, saldo, totais.
- Escolha a categoria mais adequada da lista; nunca invente categoria nova.
- Combustível/posto/gasolina = categoria "Carro". Lanche/delivery/pizza = "FastFood".
- Se não der pra saber o valor, use intent "outro" e peça o valor na resposta.
- Investimento com data de outro mês que não o atual: intent "outro", resposta dizendo que investimento retroativo deve ser lançado pelo site.

Mensagem do usuário: "${texto}"`;

    let intent;
    try {
      intent = extrairJSON(await chamarGemini(promptIntent));
    } catch (e) {
      await enviarTelegram(chatId, "Não consegui interpretar. Tenta reformular?");
      return ok;
    }

    // 5a. Lançamento
    if (intent.intent === "lancar" && intent.lancamento) {
      const l = intent.lancamento;
      const listas = { expense: catDespesa, income: catReceita, investment: catInvest };
      if (!listas[l.type] || !listas[l.type].includes(l.category)) {
        await enviarTelegram(
          chatId,
          `Categoria "${l.category}" não existe no FinDash. Nada foi lançado.`
        );
        return ok;
      }

      const novos = [];
      const parcelas = Math.max(1, parseInt(l.parcelas) || 1);
      const isCredito = l.type === "expense" && l.credito && card;

      // essential vem da configuração da categoria (igual ao site)
      const catCfg = (dados.categories?.expense || []).find((c) => c.name === l.category);
      const essential = catCfg ? !!catCfg.essential : false;

      if (isCredito) {
        const primeiraFatura = dataFatura(l.purchaseDate, card.closingDay, card.dueDay);
        // divisão de parcelas com ajuste de centavos na primeira (igual ao padrão do site)
        const base = Math.floor((l.valorTotal / parcelas) * 100) / 100;
        const primeira = Math.round((l.valorTotal - base * (parcelas - 1)) * 100) / 100;
        const groupId = parcelas > 1 ? genId() : null;

        for (let i = 0; i < parcelas; i++) {
          const item = {
            id: genId(),
            type: "expense",
            category: l.category,
            desc: parcelas > 1 ? `${l.desc} (${i + 1}/${parcelas})` : l.desc,
            value: i === 0 ? primeira : base,
            paymentMethod: "Crédito",
            cardId: card.id,
            purchaseDate: l.purchaseDate,
            date: somaMeses(primeiraFatura, i),
            essential: essential,
          };
          if (groupId) item.groupId = groupId;
          novos.push(item);
        }
      } else {
        const item = {
          id: genId(),
          type: l.type,
          category: l.category,
          desc: l.desc,
          value: l.valorTotal,
          date: l.purchaseDate,
          paymentMethod: l.type === "income" ? "" : "Pix/Transferência",
        };
        if (l.type === "expense") item.essential = essential;
        novos.push(item);
      }

      await docRef.update({
        transactions: admin.firestore.FieldValue.arrayUnion(...novos),
      });

      const tipoTxt = { expense: "Despesa", income: "Receita", investment: "Investimento" }[l.type];
      let resumo = `✓ ${tipoTxt}: ${fmtBRL(l.valorTotal)} · ${l.category} · ${l.desc}`;
      if (isCredito) {
        resumo += `\n💳 Crédito (${card.name}) · compra ${l.purchaseDate} · fatura ${novos[0].date}`;
        if (parcelas > 1) resumo += ` · ${parcelas}x de ${fmtBRL(novos[1].value)}`;
      } else {
        resumo += `\n📅 ${l.purchaseDate} · ${novos[0].paymentMethod || "—"}`;
      }
      await enviarTelegram(chatId, resumo);
      return ok;
    }

    // 5b. Consulta
    if (intent.intent === "consultar") {
      const transacoes = dados.transactions || [];
      const promptResposta = `Hoje é ${hoje()}. Você é o assistente financeiro pessoal do usuário.
Responda a pergunta dele usando SOMENTE os dados abaixo. Seja direto e curto, valores em R$.
Observação: em compras no crédito, "purchaseDate" é a data real da compra e "date" é a data da fatura. Para "quanto gastei no mês X", considere a data da compra (purchaseDate quando existir, senão date), a menos que o usuário pergunte sobre a fatura.

Pergunta: "${intent.pergunta || texto}"

Dados (JSON): ${JSON.stringify(transacoes)}`;

      const resposta = await chamarGemini(promptResposta);
      await enviarTelegram(chatId, resposta.trim() || "Não consegui calcular.");
      return ok;
    }

    // 5c. Outro
    await enviarTelegram(
      chatId,
      intent.resposta || "Não entendi. Manda algo como: gastei 50 no mercado"
    );
    return ok;
  } catch (err) {
    console.error(err);
    try {
      const update = JSON.parse(event.body || "{}");
      if (update.message?.chat?.id) {
        await enviarTelegram(update.message.chat.id, "⚠️ Erro interno. Nada foi lançado.");
      }
    } catch (_) {}
    return ok;
  }
};
