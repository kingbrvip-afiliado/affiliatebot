// Extrai e classifica links de produtos de ML e Shopee de um texto

const ML_PATTERNS = [
  /https?:\/\/(?:www\.)?mercadolivre\.com\.br\/[^\s<>"]+/gi,
  /https?:\/\/(?:www\.)?mercadolibre\.com\/[^\s<>"]+/gi,
  /https?:\/\/meli\.store\/[^\s<>"]+/gi,
  /https?:\/\/produto\.mercadolivre\.com\.br\/[^\s<>"]+/gi,
  /https?:\/\/click\.mlcdn\.com\.br\/[^\s<>"]+/gi,
];

const SHOPEE_PATTERNS = [
  /https?:\/\/(?:www\.)?shopee\.com\.br\/[^\s<>"]+/gi,
  /https?:\/\/shope\.ee\/[^\s<>"]+/gi,
  /https?:\/\/s\.shopee\.com\.br\/[^\s<>"]+/gi,
];

const GENERIC_URL = /https?:\/\/[^\s<>"]+/gi;

function extractLinks(text) {
  if (!text) return { mlLinks: [], shopeeLinks: [], otherLinks: [] };

  const mlLinks = [];
  const shopeeLinks = [];

  for (const pattern of ML_PATTERNS) {
    const matches = text.match(pattern) || [];
    mlLinks.push(...matches);
  }

  for (const pattern of SHOPEE_PATTERNS) {
    const matches = text.match(pattern) || [];
    shopeeLinks.push(...matches);
  }

  // Remove duplicates
  const allProductLinks = new Set([...mlLinks, ...shopeeLinks]);

  const allUrls = text.match(GENERIC_URL) || [];
  const otherLinks = allUrls.filter(u => !allProductLinks.has(u));

  return {
    mlLinks:     [...new Set(mlLinks)],
    shopeeLinks: [...new Set(shopeeLinks)],
    otherLinks:  [...new Set(otherLinks)],
    hasProductLink: mlLinks.length > 0 || shopeeLinks.length > 0,
    firstProductLink: mlLinks[0] || shopeeLinks[0] || null,
    source: mlLinks.length > 0 ? 'mercadolivre' : shopeeLinks.length > 0 ? 'shopee' : 'unknown',
  };
}

function extractPrices(text) {
  if (!text) return {};

  // Matches patterns like: R$ 199,90 / R$199.90 / 199,90
  const pricePattern = /R\$\s?(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)/g;
  const prices = [];
  let match;

  while ((match = pricePattern.exec(text)) !== null) {
    const raw = match[1].replace(/\./g, '').replace(',', '.');
    const value = parseFloat(raw);
    if (!isNaN(value) && value > 0) prices.push(value);
  }

  // Detect discount percentage
  const discountMatch = text.match(/(\d{1,3})\s*%\s*(?:off|de desconto|OFF|desconto)/i);
  const discount = discountMatch ? parseInt(discountMatch[1]) : null;

  if (prices.length >= 2) {
    const [higher, lower] = [Math.max(...prices), Math.min(...prices)];
    return {
      originalPrice: higher,
      salePrice: lower,
      discount: discount || Math.round(((higher - lower) / higher) * 100),
    };
  }

  if (prices.length === 1) {
    return { salePrice: prices[0], discount };
  }

  return { discount };
}

function extractProductName(text) {
  if (!text) return null;

  // Remove URLs
  const clean = text.replace(/https?:\/\/[^\s]+/g, '').trim();

  // Take first non-empty line with enough content
  const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    // Skip lines that are just emojis, prices, or very short
    if (line.length > 10 && !/^[🔥💰📦🛒✅❌👇⚡🎯]+$/.test(line)) {
      // Remove leading emojis
      const name = line.replace(/^[\p{Emoji}\s]+/u, '').trim();
      if (name.length > 5) return name.slice(0, 120);
    }
  }

  return lines[0] ? lines[0].slice(0, 120) : null;
}

module.exports = { extractLinks, extractPrices, extractProductName };
