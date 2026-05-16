const TelegramBot = require('node-telegram-bot-api');
const db = require('../database/db');
const { formatPostText, formatPreviewMessage } = require('../utils/formatter');
const { publishToTelegram } = require('../publishers/telegramPublisher');
const { publishToTwitter }  = require('../publishers/twitterPublisher');
const { generateAffiliateLink } = require('../utils/affiliateLinks');
const config = require('../../config.json');

// State machine states
const STATE = {
  IDLE:             'idle',
  WAITING_LINK:     'waiting_link',
  WAITING_CHANNELS: 'waiting_channels',
};

class ApprovalBot {
  constructor() {
    this.bot = null;
    this.adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  }

  start() {
    this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

    this.bot.on('callback_query', (q) => this._handleCallback(q));
    this.bot.on('message',        (m) => this._handleMessage(m));

    this.bot.on('polling_error', (err) => {
      console.error('[BOT] Polling error:', err.message);
    });

    console.log('[BOT] Bot de aprovação iniciado e escutando...');
  }

  // ────────────────────────────────────────────────────────────
  //  Send a new post for the admin's approval
  // ────────────────────────────────────────────────────────────
  async sendForApproval(post) {
    if (!this.bot) throw new Error('Bot não iniciado');

    const text    = formatPreviewMessage(post);
    const keyboard = {
      inline_keyboard: [[
        { text: '✅ Aprovar',   callback_data: `approve:${post.id}:${post.sourceType}` },
        { text: '❌ Rejeitar',  callback_data: `reject:${post.id}:${post.sourceType}` },
        { text: '⏭ Pular',     callback_data: `skip:${post.id}:${post.sourceType}` },
      ]],
    };

    try {
      if (post.imageUrl) {
        await this.bot.sendPhoto(this.adminChatId, post.imageUrl, {
          caption:      text,
          parse_mode:   'Markdown',
          reply_markup: keyboard,
        });
      } else {
        await this.bot.sendMessage(this.adminChatId, text, {
          parse_mode:   'Markdown',
          reply_markup: keyboard,
        });
      }
    } catch (err) {
      // If image fails, fall back to text
      await this.bot.sendMessage(this.adminChatId, text, {
        parse_mode:   'Markdown',
        reply_markup: keyboard,
      });
    }
  }

  // ────────────────────────────────────────────────────────────
  //  Handle inline keyboard callbacks
  // ────────────────────────────────────────────────────────────
  async _handleCallback(query) {
    const chatId = String(query.message.chat.id);
    const [action, postId, sourceType] = (query.data || '').split(':');

    await this.bot.answerCallbackQuery(query.id);

    if (action === 'reject') {
      db.updatePostStatus(postId, sourceType, 'rejected');
      db.clearBotState(chatId);
      await this.bot.sendMessage(chatId, '❌ Post rejeitado.');
      return;
    }

    if (action === 'skip') {
      db.clearBotState(chatId);
      await this.bot.sendMessage(chatId, '⏭ Post pulado. Não será publicado.');
      return;
    }

    if (action === 'approve') {
      db.setBotState(chatId, STATE.WAITING_LINK, postId, sourceType);
      await this.bot.sendMessage(
        chatId,
        '🔗 *Manda o seu link de afiliado* (ou mande `.` para usar o link original):',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (action === 'ch') {
      // Channel selection: ch:postId:sourceType:CHANNELS
      // CHANNELS encoded as T1G1 (twitter + telegram), T0G1, T1G0
      const [, pid, stype, channelCode] = (query.data || '').split(':');
      const useTwitter  = channelCode.includes('T1');
      const useTelegram = channelCode.includes('G1');

      await this._publishPost(chatId, pid, stype, { useTwitter, useTelegram });
    }
  }

  // ────────────────────────────────────────────────────────────
  //  Handle text messages (state-machine driven)
  // ────────────────────────────────────────────────────────────
  async _handleMessage(msg) {
    const chatId = String(msg.chat.id);

    // Only process messages from admin
    if (chatId !== String(this.adminChatId)) {
      if (msg.text === '/start') {
        await this.bot.sendMessage(chatId,
          '⛔ Você não tem permissão para usar este bot.'
        );
      }
      return;
    }

    // Commands
    if (msg.text?.startsWith('/')) {
      await this._handleCommand(msg);
      return;
    }

    const state = db.getBotState(chatId);
    if (!state) return;

    if (state.state === STATE.WAITING_LINK) {
      const affiliateLink = msg.text?.trim() === '.' ? null : msg.text?.trim();
      const postId      = state.pending_post_id;
      const sourceType  = state.pending_source_type;

      // Store the affiliate link temporarily in DB
      db.updatePostStatus(postId, sourceType, 'approved', { affiliateLink: affiliateLink || '' });

      // Ask which channels to publish to
      const twitterEnabled = config.targets.twitterEnabled;
      const telegramGroups = config.targets.telegramGroups;

      const hasTwitter  = twitterEnabled;
      const hasTelegram = telegramGroups.length > 0;

      if (!hasTwitter && !hasTelegram) {
        await this.bot.sendMessage(chatId,
          '⚠️ Nenhum canal de publicação configurado ainda. ' +
          'Adicione grupos em `config.json` > `targets`.',
          { parse_mode: 'Markdown' }
        );
        db.clearBotState(chatId);
        return;
      }

      db.setBotState(chatId, STATE.WAITING_CHANNELS, postId, sourceType);

      const buttons = [];
      if (hasTwitter && hasTelegram) {
        buttons.push([
          { text: '𝕏 Twitter + ✈ Telegram', callback_data: `ch:${postId}:${sourceType}:T1G1` },
        ]);
        buttons.push([
          { text: '𝕏 Só Twitter',   callback_data: `ch:${postId}:${sourceType}:T1G0` },
          { text: '✈ Só Telegram',  callback_data: `ch:${postId}:${sourceType}:T0G1` },
        ]);
      } else if (hasTwitter) {
        buttons.push([
          { text: '𝕏 Publicar no Twitter', callback_data: `ch:${postId}:${sourceType}:T1G0` },
        ]);
      } else {
        buttons.push([
          { text: '✈ Publicar no Telegram', callback_data: `ch:${postId}:${sourceType}:T0G1` },
        ]);
      }

      await this.bot.sendMessage(chatId, '📣 *Onde quer publicar?*', {
        parse_mode:   'Markdown',
        reply_markup: { inline_keyboard: buttons },
      });
    }
  }

  // ────────────────────────────────────────────────────────────
  //  Actually publish the post to selected channels
  // ────────────────────────────────────────────────────────────
  async _publishPost(chatId, postId, sourceType, { useTwitter, useTelegram }) {
    db.clearBotState(chatId);

    const post = db.getPost(postId, sourceType);
    if (!post) {
      await this.bot.sendMessage(chatId, '⚠️ Post não encontrado no banco.');
      return;
    }

    const rawLink       = post.affiliate_link || post.original_link;
    const affiliateLink = await generateAffiliateLink(rawLink);
    const channels      = { twitter: useTwitter, telegram: useTelegram };

    let successCount = 0;
    const errors = [];

    // Telegram
    if (useTelegram && config.targets.telegramGroups.length > 0) {
      const text    = formatPostText(post, affiliateLink, 'telegram');
      const results = await publishToTelegram(text, post.image_url, config.targets.telegramGroups);

      results.forEach(r => {
        if (r.success) successCount++;
        else errors.push(`Telegram ${r.groupId}: ${r.error}`);
      });
    }

    // Twitter
    if (useTwitter && config.targets.twitterEnabled) {
      const text   = formatPostText(post, affiliateLink, 'twitter');
      const result = await publishToTwitter(text);
      if (result.success) successCount++;
      else errors.push(`Twitter: ${result.error}`);
    }

    // Update DB
    db.updatePostStatus(postId, sourceType, 'published', { affiliateLink, channels });

    // Report back
    if (successCount > 0) {
      await this.bot.sendMessage(chatId,
        `✅ *Publicado com sucesso!*\n` +
        `📣 Enviado para ${successCount} canal(is).\n` +
        (errors.length ? `⚠️ ${errors.length} erro(s): ${errors.join(', ')}` : ''),
        { parse_mode: 'Markdown' }
      );
    } else {
      await this.bot.sendMessage(chatId,
        `❌ *Falha ao publicar.*\n${errors.join('\n')}`,
        { parse_mode: 'Markdown' }
      );
    }
  }

  // ────────────────────────────────────────────────────────────
  //  Bot commands
  // ────────────────────────────────────────────────────────────
  async _handleCommand(msg) {
    const chatId = String(msg.chat.id);
    const cmd    = msg.text.split(' ')[0].toLowerCase();

    if (cmd === '/start' || cmd === '/help') {
      await this.bot.sendMessage(chatId,
        `🤖 *AffiliateBot — Comandos*\n\n` +
        `/status — Ver estatísticas do bot\n` +
        `/pending — Ver posts aguardando aprovação\n` +
        `/config — Ver configuração atual\n` +
        `/cancel — Cancelar ação em andamento\n`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (cmd === '/status') {
      const stats = db.getStats();
      await this.bot.sendMessage(chatId,
        `📊 *Estatísticas*\n\n` +
        `📥 Total capturado: ${stats.total}\n` +
        `⏳ Pendentes: ${stats.pending}\n` +
        `✅ Aprovados: ${stats.approved}\n` +
        `🚀 Publicados: ${stats.published}\n` +
        `❌ Rejeitados: ${stats.rejected}`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (cmd === '/config') {
      await this.bot.sendMessage(chatId,
        `⚙️ *Configuração Atual*\n\n` +
        `📡 Canais Telegram monitorados: ${config.sources.telegram.length || 0}\n` +
        `🐦 Perfis Twitter monitorados: ${config.sources.twitter.length || 0}\n\n` +
        `📤 Grupos alvo (Telegram): ${config.targets.telegramGroups.length || 0}\n` +
        `🐦 Twitter ativo: ${config.targets.twitterEnabled ? 'Sim' : 'Não'}\n\n` +
        `🔍 Desconto mínimo: ${config.filters.minDiscountPercent}%`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (cmd === '/cancel') {
      db.clearBotState(chatId);
      await this.bot.sendMessage(chatId, '↩️ Ação cancelada.');
      return;
    }

    if (cmd === '/pending') {
      const posts = db.getRecentPosts(50).filter(p => p.status === 'pending');
      if (posts.length === 0) {
        await this.bot.sendMessage(chatId, '✅ Nenhum post pendente!');
        return;
      }
      for (const post of posts.slice(0, 5)) {
        await this.sendForApproval({
          id:            post.id,
          sourceType:    post.source_type,
          sourceProfile: post.source_profile,
          rawContent:    post.raw_content,
          productName:   post.product_name,
          originalLink:  post.original_link,
          imageUrl:      post.image_url,
          originalPrice: post.original_price,
          salePrice:     post.sale_price,
          discount:      post.discount,
        });
      }
      if (posts.length > 5) {
        await this.bot.sendMessage(chatId,
          `_...e mais ${posts.length - 5} posts. Use /pending novamente para ver._`,
          { parse_mode: 'Markdown' }
        );
      }
      return;
    }
  }
}

module.exports = ApprovalBot;
