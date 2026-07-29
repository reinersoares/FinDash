# FinDash — Contexto do Projeto

Dashboard financeiro pessoal, desenvolvido e usado exclusivamente pelo Reiner (dev = usuário final). Stack enxuta de propósito: zero custo contínuo, sem build step, sem contas desnecessárias.

## Preferências de trabalho do Reiner
- Feedback direto e crítico. Sem validação por educação. Aponte pontos fracos e pontos cegos.
- Não gosta de criar conta/autenticação sem necessidade real.
- Antes de qualquer decisão técnica incerta, verificar (documentação, busca) em vez de assumir.
- Trabalhava só via GitHub web UI (sem terminal) até migrar pro Claude Code — arquivo de 3800+ linhas tinha ficado arriscado de editar via "apagar tudo e colar de novo".

## Stack
- **Frontend**: `reinersoares/FinDash` (repo público), arquivo único `index.html`, Vanilla JS + Tailwind CSS via CDN (sem build step), Chart.js. Hospedado na Vercel (projeto `findash-workspace`, deploy automático a cada push na `main`). Netlify e GitHub Pages foram descontinuados.
- **Bot Telegram**: `reinersoares/findash-bot` (repo privado), Vercel serverless (`api/telegram.js`, `api/import-fatura.js`), `firebase-admin` (service account em base64 na env var `FIREBASE_SA_B64`), Gemini (`gemini-3.5-flash`, autenticação via header `x-goog-api-key` — chave começa com `AQ.`, não `AIza...`, e não vai mais na URL).
- **Banco**: Firestore, collection `banco_findash`, doc ID = código de sincronização. Sem Firebase Auth — segurança é só regra de Firestore restringindo `get`/`write` ao doc específico, `list: false`.

## Prática obrigatória ao editar o `index.html`
Arquivo grande (~3800 linhas). Depois de qualquer edição no bloco `<script>`, extrair o JS e rodar `node --check` antes de considerar pronto. Também conferir contagem de `<div>`/`</div>` e handlers `onclick` sem função correspondente (`grep` simples resolve). Já aconteceu de um `str_replace` apagar sem querer a abertura de uma function/modal, quebrando o app inteiro sem erro visível óbvio (tela em branco, nenhum botão funciona).

## Decisões já tomadas (não reabrir sem motivo novo)
- **Multi-categoria por lançamento foi rejeitado** — inflava totais nos relatórios de orçamento.
- **Tags (categoria única + tags pra consulta cruzada, tipo "Viagem Argentina") está em STANDBY** — Reiner acha que pode poluir a UI, sem decisão tomada. Não implementar sem ele pedir.
- **Meta de gastos por categoria usa a data da FATURA (vencimento), não a data da compra.** Decisão revista durante o desenvolvimento: bate com o que aparece no Extrato ("o dinheiro saiu da conta esse mês"), não com quando a compra foi feita.
- **Cota gratuita do Gemini no projeto do FinDash: 20 requisições/dia (RPD)**, reseta à meia-noite Pacífico (madrugada no Brasil). Erro 429 RESOURCE_EXHAUSTED = cota acabou. Erro 503 UNAVAILABLE = sobrecarga transitória (o código já tenta de novo 3x com backoff — cada tentativa consome 1 requisição da cota, então uma sequência de 503 pode gastar cota rápido sem o usuário perceber).
- **Categorias de despesa atuais (14)**: Futebol, Carro, Combustível, Bebida, Assinatura, Vestuário, Internet, FastFood, Tec, Lazer, Viagens, Yasmim, Barbeiro, Faculdade.

## Estado atual das features

### ✅ Importar fatura em PDF — completo e testado
`api/import-fatura.js` manda o PDF pro Gemini, extrai lançamentos com checksum contra o total da fatura, identifica e exclui do checksum linhas de "pagamento da fatura anterior" (não são gasto do período — diferente de estorno, que continua contando). No `index.html`: modal de revisão editável linha a linha, categoria sempre vazia por padrão, picker de categoria compartilhado com overlay/blur (mesmo componente usado em Novo Lançamento). Parcelas detectam automaticamente se já foram importadas antes (mesmo cartão + estabelecimento + total de parcelas + valor) via um groupId determinístico, e vêm desmarcadas com "Já lançado em [data]" — risco aceito: duas compras diferentes com mesmos parâmetros colidiriam no mesmo grupo, mas isso só afeta exclusão em lote, não soma/categoria/orçamento. Confirmar importação grava de fato no Firestore, com aviso (não bloqueio) de possível duplicata.

**Testado pelo Reiner em 29/07/2026 — funcionou, incluindo editar nomes, desmarcar itens e criar categoria nova durante a revisão.**

### ✅ Metas de gastos por categoria — completo, pouco uso real ainda
Aba "Metas" substituiu "Investir" na barra inferior mobile (Investir continua acessível pela sidebar desktop e pelo menu hambúrguer mobile). Cada card: nome da categoria, valor gasto no mês (cinza, não vermelho — só a porcentagem usa cor semáforo verde <70% / amarelo 70-99% / vermelho ≥100%), barra de progresso, porcentagem isolada e "faltam R$X" / "estourou em R$X" (também cinza, não vermelho). Lista de lançamentos expansível com altura fixa (~6 itens visíveis, scroll interno + botão "mostrar tudo" pro resto) — todos os cards do mesmo tamanho quando abertos, independente de quantos lançamentos têm. Rodapé do detalhe expandido replica o estilo de contagem+total da tela de Lançamentos (label pequena em cima, número embaixo, alinhado à direita). Colunas configuráveis (1/2/3, padrão 2, só desktop ≥1024px) e ordenação configurável (% da meta, alfabética, estourados primeiro, não estourados primeiro) — preferências salvas em `localStorage`, não sincronizam entre dispositivos de propósito (é preferência de tela, não dado financeiro). Modal de editar meta: só valor em R$ digitável + botões -100/-10/+10/+100 (teve slider com % no início, foi simplificado depois de feedback). Aviso não-bloqueante na tela de Novo Lançamento quando o lançamento faria a categoria estourar a meta (calcula o mês de fatura considerando o cartão escolhido, mesma lógica da aba Metas).

### ⏳ Backup/restore automático — PRÓXIMO PASSO PRIORITÁRIO
Reiner já perdeu dado do Firestore uma vez (teve que redigitar tudo manualmente) — isso importa mais que qualquer feature nova.
- `api/backup.js` foi escrito em sessão anterior mas **não está no ar** — falta configurar o Vercel Cron (`vercel.json`) pra rodar periodicamente.
- Plano: cron dispara o endpoint → lê o documento inteiro do Firestore → manda como arquivo JSON pro chat do Reiner com o bot no Telegram (sem storage externo).
- Restore: Reiner reenvia esse JSON pro bot → bot pede confirmação por palavra-chave → só então sobrescreve o Firestore inteiro (substituição total, não mescla).
- **Ainda não decidido com o Reiner**: frequência exata do cron (diário vs. semanal) e a palavra-chave de confirmação do restore.
- O fluxo de restore em si **não foi escrito** em `telegram.js` — só o backup existe. Ver o `telegram.js` atual completo antes de mexer, pra não quebrar os fluxos de texto/voz/anti-duplicação (últimos 30 `update_id` no Firestore) que já existem.

### 💤 Sistema de tags — standby, sem decisão
Não iniciar implementação sem o Reiner pedir explicitamente.

### 💤 Campo de busca no seletor de categoria — baixa prioridade
Com 14 categorias, ordenação por frequência provavelmente já resolve.
