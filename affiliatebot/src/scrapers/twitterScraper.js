const { TwitterApi } = require('twitter-api-v2');
const { extractLinks, extractPrices, extractProductName } = require('../utils/linkExtractor');

/**
 * Monitora perfis do Twitter/X buscando tweets com links de afiliados ML/Shopee
 * ATENÇÃO: A leitura de timelines requer plano Basic ($100/mês) ou superior
 *          na API do Twitter. O plano Free permite apenas criação de posts.
 */
class TwitterScraper {
  constructor() {
    this.client = new TwitterApi(process.env.TWITTER_BEARER_TOKEN);
    this.roClient = this.client.readOnly;
    this._userCache = new Map(); // username -> userId
  }

  /**
   * Retorna os tweets mais recentes de um perfil que contenham links de produto
   * @param {string} username - ex: "@ofertastech" ou "ofertastech"
   * @returns {Promise<Array>}
   */
  async getLatestTweets(username) {
    const handle = username.replace('@', '').trim();

    // Resolve username to user ID (cached)
    let userId = this._userCache.get(handle);
    if (!userId) {
      const user = await this.roClient.v2.userByUsername(handle);
      if (!user?.data?.id) throw new Error(`Usuário @${handle} não encontrado`);
      userId = user.data.id;
      this._userCache.set(handle, userId);
    }

    // Fetch recent tweets (last 10)
    const timeline = await this.roClient.v2.userTimeline(userId, {
      max_results: 10,
      expansions: ['attachments.media_keys'],
      'media.fields': ['url', 'preview_image_url'],
      'tweet.fields': ['created_at', 'entities', 'text'],
    });

    const tweets = timeline.data?.data || [];
    const media  = timeline.data?.includes?.media || [];

    const mediaMap = {};
    media.forEach(m => { mediaMap[m.media_key] = m.url || m.preview_image_url; });

    const posts = [];
    for (const tweet of tweets) {
      const links = extractLinks(tweet.text);
      if (!links.hasProductLink) continue;

      // Expand t.co URLs from entities if present
      const expandedUrls = tweet.entities?.urls || [];
      let resolvedLink = links.firstProductLink;

      // Try to find the expanded URL for the product link
      for (const urlEntity of expandedUrls) {
        const expanded = urlEntity.expanded_url || '';
        if (
          expanded.includes('mercadolivre') ||
          expanded.includes('shopee') ||
          expanded.includes('shope.ee') ||
          expanded.includes('meli.store')
        ) {
          resolvedLink = expanded;
          break;
        }
      }

      const prices = extractPrices(tweet.text);

      // Apply filters
      const config = require('../../config.json');
      if (
        config.filters.minDiscountPercent > 0 &&
        prices.discount &&
        prices.discount < config.filters.minDiscountPercent
      ) continue;

      // Image from media attachment
      const mediaKeys = tweet.attachments?.media_keys || [];
      const imageUrl  = mediaKeys.length > 0 ? mediaMap[mediaKeys[0]] : null;

      posts.push({
        id:            tweet.id,
        sourceType:    links.source === 'shopee' ? 'shopee' : 'mercadolivre',
        sourceProfile: `@${handle}`,
        rawContent:    tweet.text,
        productName:   extractProductName(tweet.text),
        originalLink:  resolvedLink,
        imageUrl,
        originalPrice: prices.originalPrice || null,
        salePrice:     prices.salePrice || null,
        discount:      prices.discount || null,
        capturedAt:    tweet.created_at || new Date().toISOString(),
      });
    }

    return posts;
  }
}

module.exports = TwitterScraper;
