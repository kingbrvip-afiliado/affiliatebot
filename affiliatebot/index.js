require('dotenv').config();
const path = require('path');
const axios = require('axios');
const cron = require('node-cron');
const cheerio = require('cheerio');
const TelegramBot = require('node-telegram-bot-api');
const { TwitterApi } = require('twitter-api-v2');
const Database = require('better-sqlite3');

// ─── Config ──────────────────────────────────────────────────
const config = {
  sources: {
    telegram: ["@wolf_ofertas","@achadinhosafiliadosss","@clubedeofertasss","@gatunopromos","@urubupromo","@xetdaspromocoes"],
    twitter:  ["@xetdaspromocoes","@achadinhos_dadu","@achadinhodasho","@acheinaxo","@capivarapromoss","@buscopobres","@oigatuna","@lobaopromo"]
  },
  targets: {
    twitterEnabled: true,
    telegramGroups: ["@KingBRVip10"]
  },
  affiliates: {
    mercadolivre: { trackingId: "aler8930883" },
    shopee:       { affiliateId: "18325130155" }
  },
  footer: "📣 Mais ofertas: t.me/KingBRVip10"
};

// ─── Database ─────────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'affiliatebot.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT NOT NULL, source_type TEXT NOT NULL, source_profile TEXT,
    raw_content TEXT, product_name TEXT, original_link TEXT, image_url TEXT,
    original_price REAL, sale_price REAL, discount INTEGER,
    status TEXT NOT NULL DEFAULT 'pending', affiliate_link TEXT,
    captured_at TEXT NOT NULL, published_at TEXT,
    PRIMARY KEY (id, source_type)
  );
  CREATE TABLE IF NOT EXISTS bot_state (
    chat_id TEXT PRIMARY KEY, state TEXT NOT NULL,
    pending_post_id TEXT, pending_source_type TEXT, updated_at TEXT NOT NULL
  );
`);
console.log('[DB] Banco inicializado.');

const postExists = (id, t) => !!db.prepare('SELECT 1 FROM posts WHERE id=? AND source_type=?').get(id, t);

function savePost(p) {
  db.prepare(`
    INSERT OR IGNORE INTO posts
      (id, source_type, source_profile, raw_content, product_name,
       original_link, image_url, original_price, sale_price, discount, captured_at)
    VALUES
      (@id, @sourceType, @sourceProfile, @rawContent, @productName,
       @originalLink, @imageUrl, @originalPrice, @salePrice, @discount, @capturedAt)
  `).run({
    id:            p.id,
    sourceType:    p.sourceType,
    sourceProfile: p.sourceProfile,
    rawContent:    p.rawContent || null,
    productName:   p.productName || null,
    originalLink:  p.originalLink || null,
    imageUrl:      p.imageUrl || null,
    originalPrice: p.originalPrice || null,
    salePrice:     p.salePrice || null,
    discount:      p.discount || null,
    capturedAt:    new Date().toISOString(),
  });
}

const getPost = (id, t) => db.prepare('SELECT * FROM posts WHERE id=? AND source_type=?').get(id, t);

function updatePost(id, t, status, extra = {}) {
  db.prepare(`
    UPDATE posts SET
      status         = @status,
      affiliate_link = COALESCE(@afl, affiliate_link),
      published_at   = CASE WHEN @status = 'published' THEN @now ELSE published_at END
    WHERE id = @id AND source_type = @t
  `).run({ id, t, status, afl: extra.affiliateLink || null, now: new Date().toISOString() });
}

const getStats = () => ({
  total:     db.prepare("SELECT COUNT(*) as n FROM posts").get().n,
  pending:   db.prepare("SELECT COUNT(*) as n FROM posts WHERE status='pending'").get().n,
  published: db.prepare("SELECT COUNT(*) as n FROM posts WHERE status='published'").get().n,
  rejected:  db.prepare("SELECT COUNT(*) as n FROM posts WHERE status='rejected'").get().n,
});

const getBotState  = (c)         => db.prepare('SELECT * FROM bot_state WHERE chat_id=?').get(String(c));
const clearState   = (c)         => db.prepare('DELETE FROM bot_state WHERE chat_id=?').run(String(c));
const setBotState  = (c, s, p=null, t=null) =>
  db.prepare(`INSERT INTO bot_state (chat_id,state,pending_post_id,pending_source_type,updated_at)
    VALUES (@c,@s,@p,@t,@n) ON CONFLICT(chat_id) DO UPDATE SET
    state=excluded.state, pending_post_id=excluded.pending_post_id,
    pending_source_type=excluded.pending_source_type, updated_at=excluded.updated_at`)
  .run({ c: String(c), s, p, t, n: new Date().toISOString() });

// ─── Helpers ──────────────────────────────────────────────────
const rnd    = (a) => a[Math.floor(Math.random() * a.length)];
const fmtBRL = (v) => v != null ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '';
const sleep  = (ms) => new Promise(r => setTimeout(r, ms));

// Helper: get field from post regardless of camelCase or snake_case
const f = (post, camel, snake) => post[camel] !== undefined ? post[camel] : post[snake];

// ─── Link Extractor ───────────────────────────────────────────
function extractLinks(text) {
  if (!text) return { hasProductLink: false, firstProductLink: null, source: 'unknown' };

  // Extract ALL URLs first
  const allUrls = text.match(/https?:\/\/[^\s<>"'\]]+/gi) || [];

  const ML_PATTERNS    = /mercadolivre\.com\.br|mercadolibre\.com|meli\.st|meli\.la|meli\.store|click\.mlcdn|produto\.mercadolivre|mlcdn\.com|mercadoshops/i;
  const SHOPEE_PATTERNS = /shopee\.com\.br|shope\.ee|s\.shopee\.com\.br/i;

  const ml     = allUrls.filter(u => ML_PATTERNS.test(u));
  const shopee = allUrls.filter(u => SHOPEE_PATTERNS.test(u));

  // ML has priority
  const hasML     = ml.length > 0;
  const hasShopee = shopee.length > 0;

  return {
    mlLinks:          ml,
    shopeeLinks:      shopee,
    hasProductLink:   hasML || hasShopee,
    firstProductLink: ml[0] || shopee[0] || null,
    source:           hasML ? 'mercadolivre' : hasShopee ? 'shopee' : 'unknown',
    allUrls,
  };
}

function extractPrices(text) {
  if (!text) return {};
  const prices = [];
  let m;
  const re = /R\$\s?(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/g;
  while ((m = re.exec(text)) !== null) {
    const v = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
    if (!isNaN(v) && v > 0) prices.push(v);
  }
  const dm = text.match(/(\d{1,3})\s*%\s*(?:off|de desconto|OFF)/i);
  const discount = dm ? parseInt(dm[1]) : null;
  if (prices.length >= 2) {
    const hi = Math.max(...prices), lo = Math.min(...prices);
    return { originalPrice: hi, salePrice: lo, discount: discount || Math.round(((hi - lo) / hi) * 100) };
  }
  if (prices.length === 1) return { salePrice: prices[0], discount };
  return { discount };
}

function extractName(text) {
  if (!text) return null;
  const clean = text.replace(/https?:\/\/[^\s]+/g, '').trim();
  for (const line of clean.split('\n').map(l => l.trim()).filter(Boolean)) {
    if (line.length > 8) {
      const n = line.replace(/^[\p{Emoji}\s]+/u, '').trim();
      if (n.length > 5) return n.slice(0, 120);
    }
  }
  return null;
}

// ─── Formatter ────────────────────────────────────────────────
const OPENERS = ['🔥 ACHADO DO DIA','⚡ CORRE QUE TÁ BARATO','🚨 OFERTA IMPERDÍVEL','💥 TÁ NA HORA DE COMPRAR','😱 QUE PREÇO É ESSE','🤑 DESCONTO DE VERDADE','🎯 OLHA SÓ ESSA OFERTA','👀 PARA TUDO E VÊ ISSO','💸 ECONOMIA NA VEIA','🛒 ACHEI PRA VOCÊS'];
const INTROS  = ['Saindo por só','Tá saindo a','Por apenas','Você leva por','Pode comprar por'];
const DISC_FN = [(d)=>`${d}% de desconto!`,(d)=>`${d}% OFF, não é brincadeira!`,(d)=>`você economiza ${d}%!`,(d)=>`caiu ${d}%!`];
const CTAS    = ['👇 Pega o seu aqui:','🔗 Link direto:','👇 Garante o seu agora:','👇 Aproveita antes de acabar:','🔗 Corre lá:'];

function priceBlock(post) {
  const price = f(post, 'salePrice', 'sale_price');
  if (!price) return '';
  const orig  = f(post, 'originalPrice', 'original_price');
  const disc  = post.discount;
  let b = `${rnd(INTROS)} ${fmtBRL(price)}`;
  const d = disc || (orig > price ? Math.round(((orig - price) / orig) * 100) : 0);
  if (d > 0) b += ` — ${rnd(DISC_FN)(d)}`;
  return b;
}

function payExtras(raw = '') {
  const l = raw.toLowerCase(); const e = [];
  if (/sem juros|parcelado/.test(l)) e.push('sem juros no cartão');
  if (/frete gr[áa]tis|entrega gr[áa]tis|prime|full/.test(l)) e.push('🚚 frete grátis');
  return e.length ? ` (${e.join(', ')})` : '';
}

function formatTelegram(post, link) {
  const name     = f(post, 'productName', 'product_name') || '';
  const price    = f(post, 'salePrice',    'sale_price');
  const origPrice= f(post, 'originalPrice','original_price');
  const discount = post.discount;
  const raw      = f(post, 'rawContent',   'raw_content') || '';

  // Opener rotativo
  const OPENERS_TG = [
    '🔥 ACHADO DO DIA!', '⚡ CORRE QUE É POUCO!', '😱 QUE PREÇO É ESSE?!',
    '💥 OFERTA IMPERDÍVEL!', '🤑 TÁ BARATO DEMAIS!', '🎯 OLHA SÓ ESSE PREÇO!',
    '👀 NÃO PASSA NÃO!', '🚨 CORRE ANTES QUE ACABE!',
  ];

  // Preço
  let priceLine = price ? `💰 ${fmtBRL(price)}` : '';
  if (origPrice && price && origPrice > price) {
    priceLine = `💰 ~~${fmtBRL(origPrice)}~~ → *${fmtBRL(price)}*`;
    if (discount) priceLine += ` (*${discount}% OFF*)`;
  }

  // Parcelamento
  const parcMatch = raw.match(/(\d+)x\s*(?:de\s*)?R?\$?\s*([\d,.]+)\s*sem juros/i)
                 || raw.match(/(\d+)\s*x\s*(?:de\s*)?R?\$?\s*([\d,.]+)/i);
  const parcLine  = parcMatch ? `💳 ${parcMatch[1]}x de R$ ${parcMatch[2]} sem juros` : 
                    /sem juros/i.test(raw) ? '💳 Sem juros no cartão' : '';

  // Frete
  const freteLine = /frete gr[áa]tis|entrega gr[áa]tis|full|prime/i.test(raw) ? '🚚 Frete grátis' : '';

  // Cupom
  const couponMatch = raw.match(/(?:cupom|coupon|código|promo)[\s:]+([A-Z0-9]{3,20})/i);
  const couponLine  = couponMatch ? `🏷️ Cupom: \`${couponMatch[1].toUpperCase()}\`` : '';

  const lines = [
    rnd(OPENERS_TG),
    '',
    name ? `*${name}*` : null,
    '',
    priceLine || null,
    parcLine  || null,
    freteLine || null,
    couponLine|| null,
    '',
    `👉 ${link}`,
  ].filter(x => x !== null);

  return lines.join('\n').trim();
}

function formatTwitter(post, link) {
  const name     = (f(post, 'productName', 'product_name') || '').trim();
  const price    = f(post, 'salePrice',    'sale_price');
  const origPrice= f(post, 'originalPrice','original_price');
  const discount = post.discount;
  const raw      = f(post, 'rawContent',   'raw_content') || '';
  const source   = f(post, 'sourceType',   'source_type');

  const OPENERS_TW = [
    '🔥 IMPERDÍVEL‼️', '⚡ CORRE‼️', '😱 QUE PREÇO‼️',
    '🚨 OFERTA URGENTE‼️', '🤑 TÁ BARATO‼️', '💥 ACHADO DO DIA‼️',
    '🎯 OLHA ESSE PREÇO‼️', '👀 NÃO PASSA NÃO‼️',
  ];

  const sourceLabel = source === 'shopee' ? '🟠 Shopee' : '🟡 Mercado Livre';

  // Preço
  let priceLine = '';
  if (origPrice && price && origPrice > price) {
    priceLine = `De ${fmtBRL(origPrice)} | Por ${fmtBRL(price)}`;
    if (discount) priceLine += ` (${discount}% OFF)`;
  } else if (price) {
    priceLine = fmtBRL(price);
  }

  // Parcelamento
  const parcMatch = raw.match(/(\d+)x\s*(?:de\s*)?R?\$?\s*([\d,.]+)\s*sem juros/i);
  const parcLine  = parcMatch ? `${parcMatch[1]}x R$${parcMatch[2]} sem juros` :
                    /sem juros/i.test(raw) ? 'sem juros' : '';

  // Cupom
  const couponMatch = raw.match(/(?:cupom|coupon|código|promo)[\s:]+([A-Z0-9]{3,20})/i);
  const couponLine  = couponMatch ? `Cupom: ${couponMatch[1].toUpperCase()}` : '';

  // Monta o tweet
  const parts = [
    rnd(OPENERS_TW),
    name ? name.slice(0, 80) : null,
    priceLine || null,
    parcLine  || null,
    couponLine|| null,
    sourceLabel,
    `\n👉 ${link}`,
  ].filter(Boolean);

  let tweet = parts.join('\n');

  // Garante 280 chars (link conta como 23)
  if (tweet.length > 280) {
    const shortName = name.slice(0, 50) + (name.length > 50 ? '…' : '');
    tweet = [
      rnd(OPENERS_TW),
      shortName,
      priceLine || null,
      couponLine|| null,
      sourceLabel,
      `\n👉 ${link}`,
    ].filter(Boolean).join('\n');
  }

  return tweet.trim();
}

function formatPreview(post) {
  const sourceType    = f(post, 'sourceType',    'source_type');
  const sourceProfile = f(post, 'sourceProfile', 'source_profile') || '(desconhecido)';
  const productName   = f(post, 'productName',   'product_name');
  const originalLink  = f(post, 'originalLink',  'original_link');
  const salePrice     = f(post, 'salePrice',     'sale_price');
  const src = sourceType === 'shopee' ? '🟠 Shopee' : '🟡 Mercado Livre';
  const price = salePrice ? `\n💰 ${fmtBRL(salePrice)}` + (post.discount ? ` (*${post.discount}% OFF*)` : '') : '';
  return [
    `🆕 *Nova oferta capturada!*`, ``,
    `📌 *Fonte:* ${src} — ${sourceProfile}`,
    productName ? `📦 *Produto:* ${productName}` : null,
    price || null, ``,
    `🔗 *Link original:*`,
    originalLink || '_(não detectado)_', ``,
    `_Clique em Aprovar para publicar com seu link de afiliado._`,
  ].filter(Boolean).join('\n');
}

// ─── Affiliate Links ──────────────────────────────────────────
async function generateAffiliateLink(url) {
  if (!url) return null;
  if (/mercadolivre\.com\.br|mercadolibre\.com|meli\.st|meli\.la|meli\.store|click\.mlcdn/i.test(url)) {
    try {
      const r = await axios.get('https://api.mercadolibre.com/link-building', {
        params: { tracking_id: config.affiliates.mercadolivre.trackingId, url }, timeout: 8000
      });
      if (r.data?.url || r.data?.link) return r.data.url || r.data.link;
    } catch (_) {}
    try {
      const u = new URL(url); u.searchParams.set('tracking_id', config.affiliates.mercadolivre.trackingId); return u.toString();
    } catch (_) { return url + '?tracking_id=' + config.affiliates.mercadolivre.trackingId; }
  }
  if (/shopee\.com\.br|shope\.ee/i.test(url)) {
    try {
      const u = new URL(url); u.searchParams.set('af_id', config.affiliates.shopee.affiliateId); return u.toString();
    } catch (_) { return url + '?af_id=' + config.affiliates.shopee.affiliateId; }
  }
  return url;
}

// ─── ML Link Encurtado ───────────────────────────────────────
let mlAccessToken = process.env.ML_ACCESS_TOKEN || null;

async function refreshMLToken() {
  try {
    const r = await axios.post('https://api.mercadolibre.com/oauth/token', null, {
      params: {
        grant_type:    'refresh_token',
        client_id:     process.env.ML_CLIENT_ID,
        client_secret: process.env.ML_CLIENT_SECRET,
        refresh_token: process.env.ML_REFRESH_TOKEN,
      },
      timeout: 8000,
    });
    if (r.data?.access_token) {
      mlAccessToken = r.data.access_token;
      console.log('[ML] Token renovado com sucesso');
    }
  } catch (e) {
    console.warn('[ML] Erro ao renovar token:', e.message);
  }
}

async function generateMLShortLink(originalUrl) {
  if (!mlAccessToken) return null;
  try {
    const r = await axios.post(
      'https://api.mercadolibre.com/affiliates/links',
      { url: originalUrl },
      {
        headers: {
          Authorization: `Bearer ${mlAccessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 8000,
      }
    );
    return r.data?.short_url || r.data?.link || null;
  } catch (e) {
    // Token expirado — tenta renovar e tentar de novo
    if (e.response?.status === 401) {
      await refreshMLToken();
      try {
        const r2 = await axios.post(
          'https://api.mercadolibre.com/affiliates/links',
          { url: originalUrl },
          {
            headers: {
              Authorization: `Bearer ${mlAccessToken}`,
              'Content-Type': 'application/json',
            },
            timeout: 8000,
          }
        );
        return r2.data?.short_url || r2.data?.link || null;
      } catch (_) {}
    }
    console.warn('[ML] Erro ao gerar link encurtado:', e.message);
    return null;
  }
}


async function fetchMLProductImage(url) {
  try {
    // Resolve meli.la / meli.st para URL completa se necessário
    let resolvedUrl = url;
    if (/meli\.la|meli\.st/i.test(url)) {
      try {
        const r = await axios.get(url, { maxRedirects: 5, timeout: 8000 });
        resolvedUrl = r.request?.res?.responseUrl || r.config?.url || url;
      } catch (_) {}
    }

    // Extrai o ID do produto (MLB123456789)
    const idMatch = resolvedUrl.match(/MLB-?(\d+)/i);
    if (!idMatch) return null;

    const itemId = `MLB${idMatch[1]}`;
    const r = await axios.get(`https://api.mercadolibre.com/items/${itemId}`, { timeout: 8000 });

    // Pega a foto de maior resolução disponível
    const pictures = r.data?.pictures || [];
    if (pictures.length > 0) {
      // ML usa sufixos: -I (intermediate), -O (original/max), -F (full)
      const bestUrl = pictures[0].url || pictures[0].secure_url || '';
      return bestUrl
        .replace(/-[A-Z]\.jpg$/i, '-O.jpg')  // força resolução máxima
        .replace('http://', 'https://');       // garante HTTPS
    }

    // Fallback para thumbnail em alta resolução
    const thumb = r.data?.thumbnail || '';
    return thumb.replace(/-[A-Z]\.jpg$/i, '-O.jpg').replace('http://', 'https://') || null;
  } catch (_) {}
  return null;
}

async function fetchShopeeProductImage(url) {
  try {
    // Resolve link encurtado se necessário
    let resolvedUrl = url;
    if (/shope\.ee|s\.shopee/i.test(url)) {
      try {
        const r = await axios.get(url, { maxRedirects: 5, timeout: 8000 });
        resolvedUrl = r.request?.res?.responseUrl || r.config?.url || url;
      } catch (_) {}
    }

    // Extrai shopId e itemId da URL
    const match = resolvedUrl.match(/i\.(\d+)\.(\d+)/);
    if (!match) return null;
    const [, shopId, itemId] = match;

    const r = await axios.get(
      `https://shopee.com.br/api/v4/item/get?itemid=${itemId}&shopid=${shopId}`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }, timeout: 8000 }
    );

    const imgHash = r.data?.data?.image || r.data?.data?.images?.[0];
    if (imgHash) {
      // Shopee serve imagens em alta resolução com esse padrão
      return `https://cf.shopee.com.br/file/${imgHash}_tn`;
    }
  } catch (_) {}
  return null;
}

async function fetchProductImage(post) {
  // Se já tem imagem, usa ela
  const existingImage = f(post, 'imageUrl', 'image_url');
  if (existingImage) return existingImage;

  // Tenta buscar via API
  const link = f(post, 'originalLink', 'original_link') || '';
  const sourceType = f(post, 'sourceType', 'source_type');

  if (sourceType === 'mercadolivre') return await fetchMLProductImage(link);
  if (sourceType === 'shopee')       return await fetchShopeeProductImage(link);
  return null;
}


const pubBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

function safeMd(text) {
  // Remove or close any unclosed markdown chars to prevent Telegram parse errors
  return (text || '')
    .replace(/([_*`])/g, '\\$1')  // escape special chars
    .replace(/\\\*\\\*/g, '*')     // restore **bold** → *bold*
    .replace(/\\\*/g, '*');        // restore *italic*
}

async function publishTelegram(text, imageUrl, groups) {
  const results = [];
  for (const g of groups) {
    try {
      // Try with Markdown first, fall back to plain text if parse error
      const sendMsg = async (parseMode) => {
        if (imageUrl) {
          try {
            await pubBot.sendPhoto(g, imageUrl, { caption: text, parse_mode: parseMode });
            return true;
          } catch (_) {}
        }
        await pubBot.sendMessage(g, text, { parse_mode: parseMode, disable_web_page_preview: false });
        return true;
      };

      try {
        await sendMsg('Markdown');
      } catch (_) {
        // Fall back to plain text if Markdown fails
        const plain = text.replace(/[*_`]/g, '');
        if (imageUrl) {
          try { await pubBot.sendPhoto(g, imageUrl, { caption: plain }); results.push({ g, ok: true }); continue; } catch (_2) {}
        }
        await pubBot.sendMessage(g, plain, { disable_web_page_preview: false });
      }
      results.push({ g, ok: true });
    } catch (e) { results.push({ g, ok: false, error: e.message }); }
  }
  return results;
}

async function publishTwitter(text, imageUrl = null) {
  try {
    const client = new TwitterApi({
      appKey:      process.env.TWITTER_API_KEY,
      appSecret:   process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret:process.env.TWITTER_ACCESS_SECRET,
    });

    let mediaId = null;

    // Try to upload image if available
    if (imageUrl) {
      try {
        const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 10000 });
        const buffer   = Buffer.from(response.data);
        const mimeType = response.headers['content-type'] || 'image/jpeg';
        mediaId = await client.v1.uploadMedia(buffer, { mimeType });
        console.log('[TWITTER] Imagem enviada, mediaId:', mediaId);
      } catch (imgErr) {
        console.warn('[TWITTER] Falha ao enviar imagem, publicando sem foto:', imgErr.message);
      }
    }

    const tweetParams = mediaId
      ? { text, media: { media_ids: [mediaId] } }
      : { text };

    const t = await client.v2.tweet(tweetParams);
    return { ok: true, id: t.data.id };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─── Scrapers ─────────────────────────────────────────────────
async function scrapeTelegram(channel) {
  const ch = channel.replace('@', '');
  const r = await axios.get(`https://t.me/s/${ch}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    timeout: 15000,
  });
  const $ = cheerio.load(r.data);
  const posts = [];

  $('.tgme_widget_message').each((_, el) => {
    const $el = $(el);
    const dataPost = $el.attr('data-post') || '';
    const id = dataPost.split('/').pop();
    if (!id) return;

    const raw = $el.find('.tgme_widget_message_text').text().trim();

    // Also check for links in anchor tags
    const anchorLinks = [];
    $el.find('a').each((_, a) => {
      const href = $(a).attr('href');
      if (href) anchorLinks.push(href);
    });

    const allText = raw + ' ' + anchorLinks.join(' ');
    const links = extractLinks(allText);
    if (!links.hasProductLink) return;

    const prices = extractPrices(raw);
    const bgStyle = $el.find('.tgme_widget_message_photo_wrap').attr('style') || '';
    const imgMatch = bgStyle.match(/url\(['"]?([^'"]+)['"]?\)/);

    posts.push({
      id,
      sourceType:    links.source,
      sourceProfile: `@${ch}`,
      rawContent:    raw,
      productName:   extractName(raw),
      originalLink:  links.firstProductLink,
      imageUrl:      imgMatch ? imgMatch[1] : null,
      originalPrice: prices.originalPrice || null,
      salePrice:     prices.salePrice || null,
      discount:      prices.discount || null,
    });
  });

  return posts;
}

const twitterUserCache = {};
async function scrapeTwitter(username) {
  const handle = username.replace('@', '');
  const client = new TwitterApi(process.env.TWITTER_BEARER_TOKEN);

  if (!twitterUserCache[handle]) {
    const user = await client.readOnly.v2.userByUsername(handle);
    if (!user?.data?.id) return [];
    twitterUserCache[handle] = user.data.id;
  }

  const tl = await client.readOnly.v2.userTimeline(twitterUserCache[handle], {
    max_results: 10,
    'tweet.fields': ['created_at', 'entities', 'text'],
    expansions: ['attachments.media_keys'],
    'media.fields': ['url', 'preview_image_url'],
  });

  const tweets = tl.data?.data || [];
  const media  = tl.data?.includes?.media || [];
  const mediaMap = {};
  media.forEach(m => { mediaMap[m.media_key] = m.url || m.preview_image_url; });

  return tweets.map(t => {
    // Expand t.co URLs
    const expandedUrls = (t.entities?.urls || []).map(u => u.expanded_url || '').join(' ');
    const fullText = t.text + ' ' + expandedUrls;
    const links = extractLinks(fullText);
    if (!links.hasProductLink) return null;

    const mediaKeys = t.attachments?.media_keys || [];
    return {
      id:            t.id,
      sourceType:    links.source,
      sourceProfile: `@${handle}`,
      rawContent:    t.text,
      productName:   extractName(t.text),
      originalLink:  links.firstProductLink,
      imageUrl:      mediaKeys[0] ? mediaMap[mediaKeys[0]] : null,
      ...extractPrices(t.text),
    };
  }).filter(Boolean);
}

// ─── Approval Bot ─────────────────────────────────────────────
const ADMIN = process.env.TELEGRAM_ADMIN_CHAT_ID;
const approvalBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

async function sendForApproval(post) {
  const text = formatPreview(post);
  const kbd  = { inline_keyboard: [[
    { text: '✅ Aprovar',  callback_data: `approve:${post.id}:${post.sourceType}` },
    { text: '❌ Rejeitar', callback_data: `reject:${post.id}:${post.sourceType}` },
    { text: '⏭ Pular',   callback_data: `skip:${post.id}:${post.sourceType}` },
  ]]};
  try {
    if (post.imageUrl) {
      try { await approvalBot.sendPhoto(ADMIN, post.imageUrl, { caption: text, parse_mode: 'Markdown', reply_markup: kbd }); return; } catch (_) {}
    }
    await approvalBot.sendMessage(ADMIN, text, { parse_mode: 'Markdown', reply_markup: kbd });
  } catch (e) { console.error('[BOT] Erro ao enviar aprovação:', e.message); }
}

approvalBot.on('callback_query', async (q) => {
  const chatId = String(q.message.chat.id);
  const parts  = (q.data || '').split(':');
  const action = parts[0];
  await approvalBot.answerCallbackQuery(q.id);

  if (action === 'reject') {
    updatePost(parts[1], parts[2], 'rejected');
    clearState(chatId);
    await approvalBot.sendMessage(chatId, '❌ Post rejeitado.');
    return;
  }
  if (action === 'skip') {
    clearState(chatId);
    await approvalBot.sendMessage(chatId, '⏭ Post pulado.');
    return;
  }
  if (action === 'approve') {
    const pid    = parts[1];
    const ptype  = parts[2];
    const hasT   = config.targets.twitterEnabled;
    const hasG   = config.targets.telegramGroups.length > 0;

    // Gera o link de afiliado automaticamente
    const post = getPost(pid, ptype);
    const affiliateLink = await generateAffiliateLink(post?.original_link);
    updatePost(pid, ptype, 'approved', { affiliateLink: affiliateLink || '' });
    setBotState(chatId, 'waiting_channels', pid, ptype);

    const btns = [];
    if (hasT && hasG) {
      btns.push([{ text: '𝕏 Twitter + ✈ Telegram', callback_data: `ch:${pid}:${ptype}:T1G1` }]);
      btns.push([{ text: '𝕏 Só Twitter', callback_data: `ch:${pid}:${ptype}:T1G0` }, { text: '✈ Só Telegram', callback_data: `ch:${pid}:${ptype}:T0G1` }]);
    } else if (hasT) {
      btns.push([{ text: '𝕏 Publicar no Twitter', callback_data: `ch:${pid}:${ptype}:T1G0` }]);
    } else {
      btns.push([{ text: '✈ Publicar no Telegram', callback_data: `ch:${pid}:${ptype}:T0G1` }]);
    }
    await approvalBot.sendMessage(chatId, '📣 *Onde publicar?*', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
    return;
  }
  if (action === 'ch') {
    await doPublish(chatId, parts[1], parts[2], parts[3].includes('T1'), parts[3].includes('G1'));
  }
});

approvalBot.on('message', async (msg) => {
  const chatId = String(msg.chat.id);
  if (chatId !== String(ADMIN)) { if (msg.text === '/start') await approvalBot.sendMessage(chatId, '⛔ Sem permissão.'); return; }
  if (msg.text?.startsWith('/')) { await handleCmd(msg); return; }
});

approvalBot.on('polling_error', (e) => console.error('[BOT] Polling error:', e.message));

async function doPublish(chatId, postId, sourceType, useTwitter, useTelegram) {
  clearState(chatId);
  const post = getPost(postId, sourceType);
  if (!post) { await approvalBot.sendMessage(chatId, '⚠️ Post não encontrado.'); return; }

  // Se o usuário colou um link de afiliado, usa ele direto sem modificar
  // Só gera automaticamente se não tiver link personalizado
  let link;
  if (post.affiliate_link && post.affiliate_link.trim() !== '') {
    link = post.affiliate_link.trim();
    console.log('[PUBLISH] Usando link do usuário:', link);
  } else {
    link = await generateAffiliateLink(post.original_link);
    console.log('[PUBLISH] Usando link gerado automaticamente:', link);
  }

  // Busca foto — usa a do post ou busca automaticamente via API
  const imageUrl = await fetchProductImage(post);

  let ok = 0; const errs = [];

  if (useTelegram && config.targets.telegramGroups.length > 0) {
    const text = formatTelegram(post, link);
    const res  = await publishTelegram(text, imageUrl, config.targets.telegramGroups);
    res.forEach(r => { if (r.ok) ok++; else errs.push(`Telegram ${r.g}: ${r.error}`); });
  }
  if (useTwitter && config.targets.twitterEnabled) {
    const text = formatTwitter(post, link);
    const res  = await publishTwitter(text, imageUrl);
    if (res.ok) ok++; else errs.push(`Twitter: ${res.error}`);
  }

  updatePost(postId, sourceType, 'published', { affiliateLink: link });
  const msg = ok > 0
    ? `✅ *Publicado!* Enviado para ${ok} canal(is).${errs.length ? '\n⚠️ ' + errs.join(', ') : ''}`
    : `❌ *Falha ao publicar.*\n${errs.join('\n')}`;
  await approvalBot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
}

async function handleCmd(msg) {
  const chatId = String(msg.chat.id);
  const cmd    = msg.text.split(' ')[0].toLowerCase();
  if (cmd === '/start' || cmd === '/help') {
    await approvalBot.sendMessage(chatId, '🤖 *AffiliateBot*\n\n`/status` — Estatísticas\n`/config` — Configuração\n`/cancel` — Cancelar ação', { parse_mode: 'Markdown' });
  } else if (cmd === '/status') {
    const s = getStats();
    await approvalBot.sendMessage(chatId, `📊 *Stats*\n\n📥 Total: ${s.total}\n⏳ Pendentes: ${s.pending}\n🚀 Publicados: ${s.published}\n❌ Rejeitados: ${s.rejected}`, { parse_mode: 'Markdown' });
  } else if (cmd === '/config') {
    await approvalBot.sendMessage(chatId, `⚙️ *Config atual*\n\n📡 Telegram: ${config.sources.telegram.length} canais\n🐦 Twitter: ${config.sources.twitter.length} perfis\n📤 Grupo alvo: ${config.targets.telegramGroups.join(', ')}\n🐦 Twitter ativo: ${config.targets.twitterEnabled ? 'Sim' : 'Não'}`, { parse_mode: 'Markdown' });
  } else if (cmd === '/cancel') {
    clearState(chatId);
    await approvalBot.sendMessage(chatId, '↩️ Cancelado.');
  }
}

// ─── Main loop ────────────────────────────────────────────────
async function checkPosts() {
  const ts = new Date().toLocaleTimeString('pt-BR');
  console.log(`\n[${ts}] 🔍 Verificando novos posts...`);

  for (const ch of config.sources.telegram) {
    try {
      const posts = await scrapeTelegram(ch);
      let n = 0;
      for (const p of posts) {
        if (postExists(p.id, p.sourceType)) continue;
        savePost(p);
        await sendForApproval(p);
        n++;
        await sleep(1500);
      }
      console.log(`  [TG] ${ch} → ${n} novo(s)`);
    } catch (e) { console.error(`  [TG] Erro em ${ch}:`, e.message); }
  }

  if (process.env.TWITTER_BEARER_TOKEN) {
    for (const u of config.sources.twitter) {
      try {
        const tweets = await scrapeTwitter(u);
        let n = 0;
        for (const t of tweets) {
          if (postExists(t.id, t.sourceType)) continue;
          savePost(t);
          await sendForApproval(t);
          n++;
          await sleep(1500);
        }
        console.log(`  [TW] ${u} → ${n} novo(s)`);
      } catch (e) { console.error(`  [TW] Erro em ${u}:`, e.message); }
    }
  }
}

async function main() {
  const missing = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_CHAT_ID'].filter(k => !process.env[k]);
  if (missing.length) { console.error('❌ Variáveis ausentes:', missing.join(', ')); process.exit(1); }

  console.log(`
╔══════════════════════════════════════════╗
║       🤖  AffiliateBot  iniciado!        ║
╠══════════════════════════════════════════╣
║  📡 Telegram : ${String(config.sources.telegram.length + ' canais').padEnd(26)}║
║  🐦 Twitter  : ${String(config.sources.twitter.length + ' perfis').padEnd(26)}║
║  📣 Publicando em @KingBRVip10 + X       ║
╚══════════════════════════════════════════╝`);

  await checkPosts();
  const min = parseInt(process.env.CHECK_INTERVAL_MINUTES) || 15;
  cron.schedule(`*/${min} * * * *`, checkPosts);
}

main().catch(e => { console.error('💥 Erro fatal:', e.message); process.exit(1); });
