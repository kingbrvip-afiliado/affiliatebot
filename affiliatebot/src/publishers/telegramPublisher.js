const TelegramBot = require('node-telegram-bot-api');

let publisherBot;

function getBot() {
  if (!publisherBot) {
    publisherBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
  }
  return publisherBot;
}

/**
 * Publica uma oferta em um ou mais grupos/canais do Telegram
 * @param {string} text - texto formatado (Markdown)
 * @param {string|null} imageUrl - URL da imagem do produto
 * @param {string[]} groupIds - lista de IDs ou @usernames dos grupos
 */
async function publishToTelegram(text, imageUrl, groupIds) {
  const bot = getBot();
  const results = [];

  for (const groupId of groupIds) {
    try {
      if (imageUrl) {
        // Try to send with photo; fall back to text-only if image fails
        try {
          await bot.sendPhoto(groupId, imageUrl, {
            caption: text,
            parse_mode: 'Markdown',
          });
          results.push({ groupId, success: true, method: 'photo' });
          continue;
        } catch (_) {
          // Image failed — fall through to text-only
        }
      }

      await bot.sendMessage(groupId, text, {
        parse_mode: 'Markdown',
        disable_web_page_preview: false,
      });

      results.push({ groupId, success: true, method: 'text' });
    } catch (err) {
      results.push({ groupId, success: false, error: err.message });
      console.error(`[TELEGRAM PUBLISHER] Erro ao publicar em ${groupId}:`, err.message);
    }
  }

  return results;
}

module.exports = { publishToTelegram };
