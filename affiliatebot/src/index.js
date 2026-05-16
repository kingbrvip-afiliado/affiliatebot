require('dotenv').config();

const cron           = require('node-cron');
const db             = require('./database/db');
const TelegramScraper = require('./scrapers/telegramScraper');
const TwitterScraper  = require('./scrapers/twitterScraper');
const ApprovalBot     = require('./bot/approvalBot');
const config          = require('../config.json');

// ─── Validate required env vars ─────────────────────────────
function validateEnv() {
  const required = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_CHAT_ID'];
  const missing  = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`\n❌ Variáveis de ambiente ausentes: ${missing.join(', ')}`);
    console.error('   Copie .env.example para .env e preencha os dados.\n');
    process.exit(1);
  }
}

// ─── Instances ───────────────────────────────────────────────
const telegramScraper = new TelegramScraper();
const twitterScraper  = new TwitterScraper();
const approvalBot     = new ApprovalBot();

// ─── Core check loop ─────────────────────────────────────────
async function checkForNewPosts() {
  const ts = new Date().toLocaleTimeString('pt-BR');
  console.log(`\n[${ts}] 🔍 Verificando novos posts...`);

  // ── Telegram channels ──────────────────────────────────────
  for (const channel of config.sources.telegram) {
    try {
      const posts = await telegramScraper.getLatestPosts(channel);
      let newCount = 0;

      for (const post of posts) {
        if (db.postExists(post.id, post.sourceType)) continue;
        db.savePost(post);
        await approvalBot.sendForApproval(post);
        newCount++;

        // Small delay to avoid flooding the admin with messages
        await sleep(1500);
      }

      if (newCount > 0)
        console.log(`  [TELEGRAM] @${channel.replace('@','')} → ${newCount} novo(s) post(s)`);
      else
        console.log(`  [TELEGRAM] @${channel.replace('@','')} → nada novo`);

    } catch (err) {
      console.error(`  [TELEGRAM] Erro em ${channel}:`, err.message);
    }
  }

  // ── Twitter profiles ───────────────────────────────────────
  if (config.sources.twitter.length > 0 && process.env.TWITTER_BEARER_TOKEN) {
    for (const username of config.sources.twitter) {
      try {
        const tweets = await twitterScraper.getLatestTweets(username);
        let newCount = 0;

        for (const tweet of tweets) {
          if (db.postExists(tweet.id, tweet.sourceType)) continue;
          db.savePost(tweet);
          await approvalBot.sendForApproval(tweet);
          newCount++;
          await sleep(1500);
        }

        if (newCount > 0)
          console.log(`  [TWITTER] @${username.replace('@','')} → ${newCount} novo(s) tweet(s)`);
        else
          console.log(`  [TWITTER] @${username.replace('@','')} → nada novo`);

      } catch (err) {
        console.error(`  [TWITTER] Erro em ${username}:`, err.message);
      }
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Banner ──────────────────────────────────────────────────
function printBanner() {
  const tg = config.sources.telegram.length;
  const tw = config.sources.twitter.length;
  const gi = config.targets.telegramGroups.length;
  const interval = process.env.CHECK_INTERVAL_MINUTES || 15;

  console.log(`
╔══════════════════════════════════════════════╗
║          🤖  AffiliateBot  iniciado          ║
╠══════════════════════════════════════════════╣
║  Monitorando                                 ║
║    📡 Canais Telegram : ${String(tg).padEnd(20)}║
║    🐦 Perfis Twitter  : ${String(tw).padEnd(20)}║
║  Publicando em                               ║
║    📣 Grupos Telegram : ${String(gi).padEnd(20)}║
║    𝕏  Twitter        : ${config.targets.twitterEnabled ? 'Ativado             ' : 'Desativado          '}║
║  ⏰ Verificando a cada ${String(interval + ' min').padEnd(22)}║
╚══════════════════════════════════════════════╝
  `.trim());
}

// ─── Main ────────────────────────────────────────────────────
async function main() {
  validateEnv();
  db.initialize();
  await approvalBot.start();
  printBanner();

  if (config.sources.telegram.length === 0 && config.sources.twitter.length === 0) {
    console.log('\n⚠️  Nenhuma fonte configurada ainda.');
    console.log('   Edite config.json e adicione canais em sources.telegram ou sources.twitter\n');
  }

  // Run once immediately
  await checkForNewPosts();

  // Schedule
  const minutes = parseInt(process.env.CHECK_INTERVAL_MINUTES) || 15;
  cron.schedule(`*/${minutes} * * * *`, checkForNewPosts);
}

main().catch(err => {
  console.error('\n💥 Erro fatal:', err.message);
  process.exit(1);
});
