# FinDash 💰

**English** · [Português](#findash--português)

A personal finance dashboard built as a **single HTML file** — no build step, no backend to deploy. Open it in a browser and start tracking. Data lives in your browser (localStorage) and can optionally sync across devices in real time through Firebase using a private sync code.

> ⚠️ Interface language is **Portuguese (pt-BR)** — see [Language](#language).

## Features

- **Overview dashboard** — filtered income, expenses, allocation goal and free balance at a glance, plus an income-destination bar (essential vs. non-essential vs. invested) and a line chart comparing income and expenses month by month, with flexible time ranges (current month, last 3/6/12 months, full history or a custom period).
- **Transactions** — quick entry with categories, payment methods, installments, essential/non-essential tagging, search, per-tab category filters, sortable columns (date and amount) and CSV export.
- **Credit cards with real billing cycles** — register each card's closing and due day. Purchases are recorded on the day they happen but are counted in the month the invoice is actually paid; installments cascade across successive invoices automatically. Each entry gets a color-coded invoice tag (e.g. “Nubank · Aug”).
- **Investments** — contribution goal tracking, an emergency-fund shield that changes color as your protection grows (and goes past 100% when you beat the goal), plus portfolio distribution by category.
- **Smart filters** — date-range picker in the header, category/payment-method/card filter popup with removable chips and an active-filter badge.
- **Cross-device sync (optional)** — real-time synchronization via Firebase Firestore using a private code; works offline-first with localStorage as the source of truth.
- **Polished mobile experience** — slide-in navigation drawer, bottom tab bar, numeric keyboards for amounts, and iOS-specific fixes for native date fields.
- **Dark / light mode**, responsive layouts from phones to ultrawide monitors.

## Tech stack

| Layer | Choice |
|---|---|
| UI | HTML + Tailwind CSS (CDN) |
| Charts | Chart.js |
| State | Plain JavaScript + localStorage |
| Sync (optional) | Firebase Firestore |

No framework, no bundler, no dependencies to install.

## Getting started

1. Download `findash.html`.
2. Open it in any modern browser. That's it.
3. (Optional) To sync between devices, open the sync modal, copy your code and paste it on the other device.

## Language

The interface is written in **Brazilian Portuguese** and does **not** follow the device language. Labels, month names and currency formatting (R$, pt-BR) are fixed in the code. The only elements that follow the operating system are the **native date pickers** (calendar popup and the date text inside date fields, rendered by the browser/OS). Full internationalization would require extracting the hardcoded strings into a translation layer — a possible future improvement.

---

# FinDash — Português

Um dashboard de finanças pessoais construído em um **único arquivo HTML** — sem build, sem servidor para configurar. Abra no navegador e comece a usar. Os dados ficam no seu navegador (localStorage) e, opcionalmente, sincronizam entre dispositivos em tempo real via Firebase usando um código privado.

## Funcionalidades

- **Visão geral** — receitas, despesas, meta de aporte e saldo livre filtrados, barra "para onde vai sua renda" (essencial × não essencial × investido) e gráfico de linhas comparando receitas e despesas mês a mês, com períodos flexíveis (mês atual, últimos 3/6/12 meses, todo o histórico ou período personalizado).
- **Lançamentos** — registro rápido com categorias, formas de pagamento, parcelamento, classificação essencial/não essencial, busca, filtro de categorias por aba, colunas ordenáveis (data e valor) e exportação CSV.
- **Cartões de crédito com ciclo de fatura real** — cadastre o dia de fechamento e de vencimento de cada cartão. As compras são registradas no dia em que acontecem, mas contam no mês em que a fatura é paga; parcelas caem automaticamente em faturas sucessivas. Cada lançamento ganha uma etiqueta colorida da fatura (ex.: "Nubank · Ago").
- **Investimentos** — acompanhamento da meta de aporte, escudo da reserva de emergência que muda de cor conforme a proteção cresce (e passa de 100% quando você supera a meta), além da distribuição da carteira por categoria.
- **Filtros inteligentes** — seletor de período no cabeçalho, popup de filtros por categoria/forma de pagamento/cartão com chips removíveis e badge de filtros ativos.
- **Sincronização entre dispositivos (opcional)** — em tempo real via Firebase Firestore com um código privado; funciona offline-first com o localStorage como fonte principal.
- **Experiência mobile caprichada** — menu lateral deslizante, barra de abas inferior, teclado numérico nos campos de valor e correções específicas para os campos de data do iOS.
- **Modo claro/escuro**, layout responsivo do celular ao monitor ultrawide.

## Tecnologias

| Camada | Escolha |
|---|---|
| UI | HTML + Tailwind CSS (CDN) |
| Gráficos | Chart.js |
| Estado | JavaScript puro + localStorage |
| Sync (opcional) | Firebase Firestore |

Sem framework, sem bundler, sem dependências para instalar.

## Como usar

1. Baixe o `findash.html`.
2. Abra em qualquer navegador moderno. Pronto.
3. (Opcional) Para sincronizar entre dispositivos, abra o modal de sincronização, copie seu código e cole no outro aparelho.

## Idioma

A interface é em **português do Brasil** e **não** acompanha o idioma do dispositivo — textos, meses e formatação de moeda (R$, pt-BR) são fixos no código. Apenas os **seletores de data nativos** (o calendário e o texto dentro dos campos de data, renderizados pelo navegador/sistema) seguem o idioma do aparelho. Uma internacionalização completa exigiria extrair os textos fixos para uma camada de tradução — uma possível evolução futura.
