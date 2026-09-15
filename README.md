# Nosso Dinheiro — João & Manuela

App de controle financeiro do casal: lance receitas e despesas em segundos pelo
celular, veja o saldo do mês e quem deve quanto a quem, e acompanhe metas —
tudo isso rodando de graça na Vercel.

## Como o app conversa com a "planilha"

Não existe um arquivo `.xlsx` sendo lido e escrito pelo app — isso não
funcionaria bem num servidor (o arquivo teria que morar em algum lugar e ser
salvo a cada lançamento, o que é frágil em ambientes serverless como a
Vercel, que não guardam arquivos entre requisições).

Em vez disso, **a planilha É o banco de dados**: uma planilha Google Sheets
faz esse papel. A arquitetura é:

```
┌─────────────┐        HTTPS         ┌──────────────────┐      Google Sheets API      ┌──────────────────────┐
│  Frontend   │  ───────────────────▶│  Backend (Next.js │ ───────────────────────────▶│  Planilha Google      │
│  (React)    │◀─────────────────────│  API Routes)      │◀─────────────────────────────│  Sheets (2 abas)       │
└─────────────┘      JSON             └──────────────────┘                              └──────────────────────┘
   roda no          roda como                                                              "Lancamentos" e "Metas"
   celular          função serverless
                     na Vercel
```

- O **front-end** (`app/page.tsx`) é a tela que vocês usam no celular. Ele
  nunca fala direto com o Google — só chama a própria API do app
  (`/api/entries`, `/api/goals`).
- O **back-end** (`app/api/entries/route.ts` e `app/api/goals/route.ts`) roda
  como função serverless na Vercel. Ele recebe a chamada do front, autentica
  com uma *service account* do Google e lê/escreve linhas na planilha via
  Google Sheets API (`lib/sheets.ts`).
- A **planilha** é a fonte única da verdade. Como é uma Google Sheets normal,
  vocês também podem abrir ela direto pelo app do Google Sheets, olhar os
  dados brutos, ou usar como base para gerar relatórios mais elaborados
  depois.
- Cada lançamento vira uma linha; exclusões são "soft delete" (marcadas numa
  coluna `Excluido`, não removidas de fato), então nada se perde por engano.

Quando quiser, você pode me passar os dados dessa planilha (ou exportar o CSV
pelo botão do app) e eu gero a versão formatada em Excel com abas mensais,
como a que já fiz antes — mas o dia a dia de uso é 100% pela planilha viva
conectada ao app.

## 1. Criar a planilha Google Sheets

1. Crie uma planilha nova no Google Sheets.
   O arquivo precisa ser uma planilha Google nativa. Arquivos `.xlsx` ou `.xls`
   apenas abertos no Drive continuam sendo arquivos Office e não podem ser
   preenchidos pela Google Sheets API. Para converter, abra o arquivo no Google
   Sheets e use **Arquivo → Salvar como Planilhas Google**; depois use o ID da
   nova URL, não o ID do arquivo Office.
2. Renomeie a primeira aba para `Lancamentos` e cole este cabeçalho na
   linha 1 (coluna A até J):
   ```
   ID | Data | Tipo | Descricao | Categoria | Pessoa | TipoDespesa | PercJoao | Valor | Excluido
   ```
3. Crie uma segunda aba chamada `Metas` com este cabeçalho (A até F):
   ```
   ID | Nome | ValorObjetivo | ValorGuardado | DataLimite | Excluido
   ```
4. Copie o ID da planilha na URL: `https://docs.google.com/spreadsheets/d/ESTE_TRECHO_AQUI/edit`

## 2. Criar a Service Account no Google Cloud (gratuito)

1. Acesse [console.cloud.google.com](https://console.cloud.google.com) e
   crie um projeto (ou use um existente).
2. Em **APIs e serviços → Biblioteca**, ative a **Google Sheets API**.
3. Em **APIs e serviços → Credenciais → Criar credenciais → Conta de
   serviço**, crie uma service account (não precisa dar nenhuma permissão
   especial de projeto).
4. Abra a service account criada → aba **Chaves** → **Adicionar chave →
   Criar nova chave → JSON**. Um arquivo `.json` será baixado.
5. Abra esse JSON: você vai precisar dos campos `client_email` e
   `private_key`.
6. **Importante:** volte na sua planilha Google Sheets, clique em
   **Compartilhar** e adicione o e-mail da service account (o
   `client_email`, algo como `xxx@xxx.iam.gserviceaccount.com`) como
   **Editor**. Sem esse passo o app não consegue escrever na planilha.

## 3. Rodar localmente (opcional, para testar antes do deploy)

```bash
npm install
cp .env.example .env.local
# edite .env.local com GOOGLE_SHEET_ID, GOOGLE_CLIENT_EMAIL e GOOGLE_PRIVATE_KEY
npm run dev
```

Abra `http://localhost:3000` no navegador (ou no celular, na mesma rede,
usando o IP do computador).

## 4. Deploy na Vercel

1. Suba esta pasta para um repositório no GitHub (ou use `vercel` direto pela
   CLI sem precisar de Git — veja abaixo).
2. Em [vercel.com](https://vercel.com), clique em **Add New → Project** e
   importe o repositório. Ou, pela CLI:
   ```bash
   npm i -g vercel
   vercel
   ```
3. Em **Settings → Environment Variables** no projeto da Vercel, adicione:
   - `GOOGLE_SHEET_ID`
   - `GOOGLE_CLIENT_EMAIL`
   - `GOOGLE_PRIVATE_KEY` (cole o valor entre aspas, mantendo os `\n`
     literais — a Vercel aceita colar o valor multi-linha direto também)
   - `GROQ_API_KEY` (opcional, para a aba Dados gerar dicas com a Groq)
   - `GROQ_MODEL` (opcional; padrão `llama-3.3-70b-versatile`; se um modelo configurado responder 404, o app tenta esse fallback)
4. Clique em **Deploy**. Em ~1 minuto vocês têm uma URL tipo
   `https://nosso-dinheiro.vercel.app`.

## 5. Instalar como "app" no celular

Abram a URL da Vercel no navegador do celular:
- **iPhone (Safari):** toque em Compartilhar → "Adicionar à Tela de Início".
- **Android (Chrome):** menu (⋮) → "Adicionar à tela inicial" / "Instalar app".

O ícone (dourado + rosé, "JM") vai para a tela inicial e o app abre em tela
cheia, sem barra de navegador.

## 6. Aba Dados e análise

A aba **Dados** consolida o mês selecionado em receitas, despesas, saldo final,
valores por pessoa e despesas por categoria. O botão de análise envia somente
esses totais agregados para a API Groq através do servidor; a chave nunca fica
no navegador. Sem `GROQ_API_KEY`, o restante do app continua funcionando e a
análise apenas fica indisponível.

Na primeira leitura ou gravação, o app cria as abas `Lancamentos` e `Metas` se
necessário e preenche seus cabeçalhos automaticamente. Dados existentes não
são apagados.

Quando a planilha contém as abas mensais `Jan` a `Dez`, o app usa o modelo
mensal automaticamente: receitas entram nas linhas de receitas do mês,
despesas entram nas linhas de despesas do mês e as fórmulas de totais e divisão
da planilha são preservadas. A aba `Resumo Anual` continua sendo calculada
pelas fórmulas do modelo. A aba `Lancamentos`, se existir de uma configuração
anterior, é mantida como arquivo histórico e não recebe novos lançamentos.

## Estrutura do projeto

```
nosso-dinheiro/
├── app/
│   ├── page.tsx              # tela única (Início / Adicionar / Metas)
│   ├── layout.tsx            # metadata, PWA, fontes
│   ├── globals.css           # identidade visual
│   └── api/
│       ├── entries/route.ts  # GET/POST/DELETE de lançamentos
│       └── goals/route.ts    # GET/POST/PATCH/DELETE de metas
├── lib/
│   ├── sheets.ts             # toda a comunicação com Google Sheets API
│   └── types.ts
├── public/
│   ├── manifest.json
│   ├── icon-192.png
│   └── icon-512.png
├── .env.example
└── package.json
```

## Limites a saber

- A Google Sheets API tem limite gratuito de 300 requisições por minuto por
  projeto — muito acima do que dois usuários no dia a dia vão usar.
- Não há autenticação de login no app: qualquer pessoa com a URL da Vercel
  consegue abrir e lançar dados. Para uso privado do casal, isso costuma ser
  aceitável (a URL não é divulgada), mas se quiser adicionar uma senha simples
  depois, dá para fazer com poucas linhas a mais.
