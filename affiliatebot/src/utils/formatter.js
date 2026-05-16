const config = require('../../config.json');

const OPENERS = [
  '🔥 ACHADO DO DIA',
  '⚡ CORRE QUE TÁ BARATO',
  '🚨 OFERTA IMPERDÍVEL',
  '💥 TÁ NA HORA DE COMPRAR',
  '🛒 ACHEI PRA VOCÊS',
  '😱 QUE PREÇO É ESSE',
  '🤑 DESCONTO DE VERDADE',
  '🎯 OLHA SÓ ESSA OFERTA',
  '👀 PARA TUDO E VÊ ISSO',
  '💸 ECONOMIA NA VEIA',
];

const PRICE_INTROS = [
  'Saindo por só',
  'Tá saindo a',
  'Por apenas',
  'Você leva por',
  'Pode comprar por',
  'Preço de',
];

const DISCOUNT_PHRASES = [
  (d) => `${d}% de desconto!`,
  (d) => `${d}% OFF, não é brincadeira!`,
  (d) => `você economiza ${d}%!`,
  (d) => `com ${d}% a menos!`,
  (d) => `caiu ${d}%!`,
];

const INSTALLMENT_PHRASES = [
  'sem juros no cartão',
  'parcelado e sem juros',
  'no crédito sem juros',
];

const SHIPPING_PHRASES = [
  '🚚 frete grátis',
  '🚚 entrega grátis',
  '📦 frete grátis incluso',
];

const CTAS = [
  '👇 Pega o seu aqui:',
  '🔗 Link direto:',
  '👇 Garante o seu agora:',
  '👇 Aproveita antes de acabar:',
  '🔗 Corre lá:',
  '👇 É só clicar:',
];

const TELEGRAM_CTA = `📣 Mais ofertas: t.me/KingBRVip10`;

function random(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function formatCurrency(value) {
  if (value == null) return null;
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function buildPriceBlock(post) {
  const price = post.sale_price || post.salePrice;
  const originalPrice = post.original_price || post.originalPrice;
  const discount = post.discount;
  if (!price) return '';

  const priceIntro = random(PRICE_INTROS);
  let block = `${priceIntro} ${formatCurrency(price)}`;

  const disc = discount || (originalPrice > price
    ? Math.round(((originalPrice - price) / originalPrice) * 100)
    : 0);

  if (disc > 0) block += ` — ${random(DISCOUNT_PHRASES)(disc)}`;
  return block;
}

function extractPaymentInfo(rawContent) {
  if (!rawContent) return {};
  const lower = rawContent.toLowerCase();
  return {
    hasFreeShipping: /frete gr[áa]tis|entrega gr[áa]tis|prime|full/.test(lower),
    hasInstallments: /sem juros|parcelado|parcelas/.test(lower),
  };
}

function buildPaymentExtras(rawContent) {
  const { hasFreeShipping, hasInstallments } = extractPaymentInfo(rawContent);
  const extras = [];
  if (hasInstallments) extras.push(random(INSTALLMENT_PHRASES));
  if (hasFreeShipping) extras.push(random(SHIPPING_PHRASES));
  return extras.length > 0 ? ` (${extras.join(', ')})` : '';
}

function formatTwitterPost(post, affiliateLink) {
  const opener     = random(OPENERS);
  const name       = (post.product_name || post.productName || '').slice(0, 55);
  const priceBlock = buildPriceBlock(post);
  const payExtras  = buildPaymentExtras(post.raw_content || post.rawContent || '');
  const cta        = random(CTAS);
  const link       = affiliateLink || post.original_link || post.originalLink || '';
  const tgSuffix   = ' | t.me/KingBRVip10';

  // Twitter counts links as 23 chars
  const LINK_COST  = 23;
  const budget     = 280 - LINK_COST - tgSuffix.length - cta.length - 3;

  let body = name && priceBlock
    ? `${opener}\n${name}\n${priceBlock}${payExtras}`
    : name
    ? `${opener}\n${name}`
    : `${opener}\n${priceBlock}`;

  if (body.length > budget) {
    body = `${opener}\n${name.slice(0, 40)}…\n${priceBlock}`;
  }

  return `${body}\n${cta} ${link}${tgSuffix}`.trim();
}

function formatTelegramPost(post, affiliateLink) {
  const opener     = random(OPENERS);
  const name       = post.product_name || post.productName || '';
  const priceBlock = buildPriceBlock(post);
  const payExtras  = buildPaymentExtras(post.raw_content || post.rawContent || '');
  const cta        = random(CTAS);
  const link       = affiliateLink || post.original_link || post.originalLink || '';

  return [
    `${opener}!`,
    '',
    name ? `*${name}*` : null,
    priceBlock ? `\n💰 ${priceBlock}${payExtras}` : null,
    '',
    `${cta}`,
    link,
    '',
    TELEGRAM_CTA,
  ].filter(l => l !== null).join('\n').trim();
}

function formatPostText(post, affiliateLink, platform = 'telegram') {
  return platform === 'twitter'
    ? formatTwitterPost(post, affiliateLink)
    : formatTelegramPost(post, affiliateLink);
}

function formatPreviewMessage(post) {
  const source = post.source_type === 'shopee' ? '🟠 Shopee' : '🟡 Mercado Livre';
  const price  = post.sale_price
    ? `\n💰 ${formatCurrency(post.sale_price)}` +
      (post.discount ? ` (*${post.discount}% OFF*)` : '')
    : '';

  return [
    `🆕 *Nova oferta capturada!*`,
    ``,
    `📌 *Fonte:* ${source} — ${post.source_profile}`,
    post.product_name ? `📦 *Produto:* ${post.product_name}` : null,
    price || null,
    ``,
    `🔗 *Link original:*`,
    post.original_link || '_(não detectado)_',
    ``,
    `_Clique em Aprovar para publicar com seu link de afiliado._`,
  ].filter(Boolean).join('\n');
}

module.exports = { formatPostText, formatPreviewMessage, formatCurrency };
