const axios = require('axios');
const cheerio = require('cheerio');
const { extractLinks, extractPrices, extractProductName } = require('../utils/linkExtractor');

/**
 * Raspa posts de canais públicos do Telegram via https://t.me/s/CHANNEL
 * Não precisa de API key — usa o preview público do Telegram
 */
class TelegramScraper {
  constructor() {
    this.baseUrl = 'https://t.me/s';
    this.headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    };
  }

  /**
   * Busca os últimos posts de um canal público
   * @param {string} channelUsername - ex: "ofertasml" ou "@ofertasml"
   * @returns {Promise<Array>}
   */
  async getLatestPosts(channelUsername) {
    const channel = channelUsername.replace('@', '').trim();
    const url = `${this.baseUrl}/${channel}`;

    let html;
    try {
      const response = await axios.get(url, {
        headers: this.headers,
        timeout: 15000,
      });
      html = response.data;
    } catch (err) {
      if (err.response?.status === 404) {
        throw new Error(`Canal "@${channel}" não encontrado ou é privado.`);
      }
      throw new Error(`Erro ao acessar @${channel}: ${err.message}`);
    }

    return this._parseHtml(html, channel);
  }

  _parseHtml(html, channelUsername) {
    const $ = cheerio.load(html);
    const posts = [];

    $('.tgme_widget_message').each((_, el) => {
      const $el = $(el);

      // Post ID
      const msgLink = $el.attr('data-post') || '';
      const id = msgLink.split('/').pop();
      if (!id) return;

      // Text content
      const textEl = $el.find('.tgme_widget_message_text');
      const rawContent = textEl.text().trim();

      // Image URL
      let imageUrl = null;
      const bgStyle = $el.find('.tgme_widget_message_photo_wrap').attr('style') || '';
      const bgMatch = bgStyle.match(/url\(['"]?([^'"]+)['"]?\)/);
      if (bgMatch) imageUrl = bgMatch[1];

      // Extract links
      const links = extractLinks(rawContent);

      // Skip posts without any product link
      if (!links.hasProductLink) return;

      // Extract prices
      const prices = extractPrices(rawContent);

      // Apply filters
      const config = require('../../config.json');
      if (
        config.filters.minDiscountPercent > 0 &&
        prices.discount &&
        prices.discount < config.filters.minDiscountPercent
      ) return;

      // Keyword filters
      if (config.filters.blockedKeywords.length > 0) {
        const lower = rawContent.toLowerCase();
        if (config.filters.blockedKeywords.some(kw => lower.includes(kw.toLowerCase()))) return;
      }

      if (config.filters.requiredKeywords.length > 0) {
        const lower = rawContent.toLowerCase();
        if (!config.filters.requiredKeywords.some(kw => lower.includes(kw.toLowerCase()))) return;
      }

      posts.push({
        id,
        sourceType:    links.source === 'shopee' ? 'shopee' : 'mercadolivre',
        sourceProfile: `@${channelUsername}`,
        rawContent,
        productName:   extractProductName(rawContent),
        originalLink:  links.firstProductLink,
        imageUrl,
        originalPrice: prices.originalPrice || null,
        salePrice:     prices.salePrice || null,
        discount:      prices.discount || null,
        capturedAt:    new Date().toISOString(),
      });
    });

    return posts;
  }
}

module.exports = TelegramScraper;
