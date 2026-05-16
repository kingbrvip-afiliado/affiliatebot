# 🤖 AffiliateBot

Bot de replicação automática de ofertas de afiliados do Mercado Livre e Shopee.  
Monitora canais do Telegram e perfis do Twitter, pede sua aprovação antes de publicar, e replica nos seus canais com o seu link de afiliado.

---

## 📋 Como funciona

```
[Canal/Perfil Monitorado]
        ↓
  Bot detecta oferta
        ↓
  Te envia no Telegram:
  "Nova oferta! Aprovar?"
        ↓
  Você clica ✅ Aprovar
        ↓
  Bot pede: "Manda seu link de afiliado"
        ↓
  Você escolhe: Twitter / Telegram / Ambos
        ↓
  Bot publica nos seus canais 🚀
```

---

## 🛠️ Pré-requisitos

- **Node.js 18+** instalado ([nodejs.org](https://nodejs.org))
- **Conta no Telegram** (para receber as notificações de aprovação)
- **Bot no Telegram** (gratuito, criado em 2 minutos)
- **Twitter API** (opcional, necessário para publicar no Twitter/X)

---

## 📦 Instalação

### Passo 1 — Baixar o projeto

Coloque a pasta `affiliatebot` em qualquer lugar do seu computador.

### Passo 2 — Instalar as dependências

Abra o terminal dentro da pasta do projeto e rode:

```bash
npm install
```

Aguarde terminar. Vai criar uma pasta `node_modules`.

### Passo 3 — Criar o arquivo de configuração

No terminal, rode:

```bash
cp .env.example .env
```

Isso cria o arquivo `.env` onde ficam seus dados privados.

---

## 🔑 Configuração do Telegram Bot (OBRIGATÓRIO)

### 3.1 — Criar o bot no Telegram

1. Abra o Telegram e procure por **@BotFather**
2. Mande `/newbot`
3. Escolha um nome para o bot (ex: "Minhas Ofertas Bot")
4. Escolha um username (ex: `minhas_ofertas_bot`)
5. O BotFather vai te mandar um **token** assim:
   ```
   5843921734:AAHfq1234abcDEFghijKLMNopqRSTuvwXYZ
   ```
6. Copie esse token

### 3.2 — Colocar o token no .env

Abra o arquivo `.env` e coloque:

```
TELEGRAM_BOT_TOKEN=5843921734:AAHfq1234abcDEFghijKLMNopqRSTuvwXYZ
```
*(substitua pelo seu token real)*

### 3.3 — Descobrir seu Chat ID

1. Abra o Telegram e procure por **@userinfobot**
2. Mande qualquer mensagem para ele
3. Ele vai responder com seu **Id** (um número tipo `8273645193`)
4. Copie esse número

Coloque no `.env`:

```
TELEGRAM_ADMIN_CHAT_ID=8273645193
```

### 3.4 — Ativar o bot

1. Abra o Telegram, procure pelo **nome do seu bot** (que você criou)
2. Clique em **START** ou mande `/start`
3. Isso é necessário para o bot poder te mandar mensagens

---

## 📢 Configurar os grupos onde vai publicar

### Adicionar o bot como admin dos seus grupos

1. Abra o grupo/canal do Telegram onde quer publicar
2. Clique no nome do grupo → Editar → Administradores
3. Adicione o seu bot como administrador
4. Dê permissão de **"Enviar Mensagens"**

### Descobrir o ID do grupo

1. Adicione o bot **@username_to_id_bot** temporariamente no seu grupo
2. Ele vai mandar o ID do grupo (um número negativo tipo `-1001234567890`)
3. Pode remover o bot depois

### Adicionar ao config.json

Abra `config.json` e adicione os IDs:

```json
{
  "targets": {
    "telegramGroups": ["-1001234567890", "-1009876543210"],
    "twitterEnabled": false
  }
}
```

---

## 📡 Configurar o que monitorar

Abra `config.json` e adicione os perfis que você quer monitorar:

```json
{
  "sources": {
    "telegram": ["@canal_de_ofertas", "@shopee_br_ofertas"],
    "twitter":  ["@ofertastech", "@promoML"]
  }
}
```

> ⚠️ **IMPORTANTE:** Só funciona com **canais públicos** do Telegram.  
> Canais privados precisam de integração diferente (me avise se precisar).

---

## 🐦 Configuração do Twitter/X (OPCIONAL)

> Se não quiser publicar no Twitter, pule essa parte.

### Criar conta de desenvolvedor

1. Acesse [developer.twitter.com](https://developer.twitter.com)
2. Crie um projeto e um App
3. Vá em **Keys and Tokens**
4. Gere e copie:
   - API Key
   - API Secret
   - Access Token
   - Access Secret
   - Bearer Token

> ⚠️ **ATENÇÃO:** Para **monitorar** perfis do Twitter, é necessário o plano **Basic ($100/mês)**.  
> Para apenas **publicar** tweets, o plano gratuito funciona.

Coloque no `.env`:

```
TWITTER_API_KEY=sua_api_key
TWITTER_API_SECRET=seu_api_secret
TWITTER_ACCESS_TOKEN=seu_access_token
TWITTER_ACCESS_SECRET=seu_access_secret
TWITTER_BEARER_TOKEN=seu_bearer_token
```

E no `config.json`:

```json
{
  "targets": {
    "twitterEnabled": true
  }
}
```

---

## ⚙️ Outras configurações (config.json)

```json
{
  "filters": {
    "minDiscountPercent": 10,
    "requiredKeywords": [],
    "blockedKeywords": ["usado", "semi-novo"]
  },
  "post": {
    "callToAction": "👇 Garanta o seu agora:",
    "footer": "💬 Dúvidas? Me chama no privado!"
  }
}
```

| Campo | O que faz |
|---|---|
| `minDiscountPercent` | Só captura ofertas com X% de desconto ou mais |
| `requiredKeywords` | Só captura se o post contiver essas palavras |
| `blockedKeywords` | Ignora posts com essas palavras |
| `callToAction` | Texto antes do link na publicação |
| `footer` | Texto no final de cada post |

---

## 🚀 Rodar o bot

No terminal, dentro da pasta do projeto:

```bash
npm start
```

Você vai ver algo assim:

```
╔══════════════════════════════════════════════╗
║          🤖  AffiliateBot  iniciado          ║
╠══════════════════════════════════════════════╣
║  Monitorando                                 ║
║    📡 Canais Telegram : 2                   ║
║    🐦 Perfis Twitter  : 1                   ║
║  ⏰ Verificando a cada 15 min               ║
╚══════════════════════════════════════════════╝
```

O bot já vai começar a verificar os canais imediatamente e a cada 15 minutos.

---

## 💬 Comandos do bot no Telegram

Mande esses comandos para o seu bot:

| Comando | O que faz |
|---|---|
| `/status` | Ver quantos posts capturou, aprovou, publicou |
| `/pending` | Re-enviar posts que estão aguardando aprovação |
| `/config` | Ver a configuração atual |
| `/cancel` | Cancelar uma aprovação em andamento |
| `/help` | Ver todos os comandos |

---

## 🔄 Como aprovar um post

Quando o bot encontrar uma nova oferta, você vai receber no Telegram:

```
🆕 Nova oferta capturada!

📌 Fonte: 🟡 Mercado Livre — @canal_ofertas
📦 Produto: Fone Bluetooth JBL Tune 520BT
💰 De R$ 399,90 por R$ 179,90 (55% OFF)

🔗 Link original:
https://mercadolivre.com.br/...

[✅ Aprovar] [❌ Rejeitar] [⏭ Pular]
```

1. Clique em **✅ Aprovar**
2. Bot pergunta: *"Manda o seu link de afiliado"*
3. Cole seu link (ex: `https://meli.st/seulink`) ou mande `.` para usar o link original
4. Escolha onde publicar: **Twitter + Telegram**, **Só Twitter** ou **Só Telegram**
5. Bot publica automaticamente! ✅

---

## 🖥️ Rodar em servidor 24h (VPS)

Para o bot funcionar sem parar, coloque ele em um servidor.

### Opção gratuita: Railway.app

1. Acesse [railway.app](https://railway.app) e crie conta
2. Crie um novo projeto → Deploy from GitHub
3. Suba o código no GitHub (pode ser repositório privado)
4. Adicione as variáveis do `.env` em Settings → Variables
5. Deploy automático!

### Opção: Usar PM2 (em VPS própria)

```bash
npm install -g pm2
pm2 start npm --name "affiliatebot" -- start
pm2 save
pm2 startup
```

---

## ❓ Problemas comuns

**"Bot não responde"**
→ Verifique se mandou /start para o bot no Telegram

**"Canal não encontrado"**
→ O canal precisa ser público. Canais privados não funcionam via scraping

**"Erro de autenticação Twitter"**
→ Verifique as chaves no .env. Regenere os tokens no Twitter Developer Portal

**"Não detecta preço"**
→ Nem todos os posts têm preço no texto. O produto ainda aparece para você aprovar

---

## 📁 Estrutura de arquivos

```
affiliatebot/
├── .env                  ← Suas chaves secretas (nunca compartilhe!)
├── .env.example          ← Modelo do .env
├── config.json           ← Perfis, grupos e filtros
├── package.json
├── data/
│   └── affiliatebot.db   ← Banco de dados (criado automaticamente)
└── src/
    ├── index.js           ← Ponto de entrada principal
    ├── database/db.js     ← Banco de dados SQLite
    ├── scrapers/
    │   ├── telegramScraper.js  ← Lê canais públicos do Telegram
    │   └── twitterScraper.js   ← Lê perfis do Twitter
    ├── bot/
    │   └── approvalBot.js      ← Bot de aprovação (você no Telegram)
    ├── publishers/
    │   ├── telegramPublisher.js ← Publica nos grupos
    │   └── twitterPublisher.js  ← Publica no Twitter
    └── utils/
        ├── formatter.js         ← Formata o texto das publicações
        └── linkExtractor.js     ← Extrai links e preços dos posts
```
