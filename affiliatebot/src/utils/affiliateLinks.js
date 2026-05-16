const axios = require('axios');
const config = require('../../config.json');

/**
 * Gera link de afiliado do Mercado Livre
 * Documentação: https://developers.mercadolivre.com.br/pt_br/link-building
 */
async function generateMLAffiliateLink(originalUrl) {
  const { trackingId, enabled } = config.affiliates.mercadolivre;
  if (!enabled || !trackingId) return originalUrl;

  // Limpa o link — remove parâmetros desnecessários e garante que é de produto ML
  const cleanUrl = cleanMLUrl(originalUrl);
  if (!cleanUrl) return originalUrl;

  try {
    const response = await axios.get('https://api.mercadolibre.com/link-building', {
      params: {
        tracking_id: trackingId,
        url: cleanUrl,
      },
      timeout: 8000,
    });

    const affiliateUrl = response.data?.url || response.data?.link;
    if (affiliateUrl) {
      console.log(`[ML AFILIADO] Link gerado: ${affiliateUrl}`);
      return affiliateUrl;
    }
  } catch (err) {
    console.warn('[ML AFILIADO] API falhou, usando fallback manual:', err.message);
  }

  // Fallback: adiciona o tracking_id manualmente na URL
  return addMLTrackingFallback(cleanUrl, trackingId);
}

/**
 * Gera link de afiliado da Shopee
 * Usa o username do afiliado para construir o link rastreável.
 * Se tiver API Key configurada, usa a API oficial.
 */
async function generateShopeeAffiliateLink(originalUrl) {
  const { username, apiKey, enabled } = config.affiliates.shopee;
  if (!enabled || !username) return originalUrl;

  // Se tiver API Key, usa a API oficial da Shopee
  if (apiKey) {
    try {
      const response = await axios.post(
        'https://open-api.affiliate.shopee.com.br/graphql',
        {
          query: `
            mutation generateLink($input: GenerateLinkInput!) {
              generateLink(input: $input) {
                shortLink
                longLink
              }
            }
          `,
          variables: {
            input: {
              originUrl: originalUrl,
              subIds: [username],
            },
          },
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 8000,
        }
      );

      const link =
        response.data?.data?.generateLink?.shortLink ||
        response.data?.data?.generateLink?.longLink;

      if (link) {
        console.log(`[SHOPEE AFILIADO] Link via API: ${link}`);
        return link;
      }
    } catch (err) {
      console.warn('[SHOPEE AFILIADO] API falhou, usando fallback:', err.message);
    }
  }

  // Fallback: adiciona o ID como parâmetro de rastreamento na URL
  return addShopeeTrackingFallback(originalUrl, username, config.affiliates.shopee.affiliateId);
}

/**
 * Detecta a plataforma e gera o link de afiliado correto
 */
async function generateAffiliateLink(originalUrl) {
  if (!originalUrl) return null;

  if (isMLUrl(originalUrl)) {
    return await generateMLAffiliateLink(originalUrl);
  }

  if (isShopeeUrl(originalUrl)) {
    return await generateShopeeAffiliateLink(originalUrl);
  }

  return originalUrl;
}

// ─── Helpers ────────────────────────────────────────────────

function isMLUrl(url) {
  return /mercadolivre\.com\.br|mercadolibre\.com|meli\.store|click\.mlcdn|produto\.mercadolivre/i.test(url);
}

function isShopeeUrl(url) {
  return /shopee\.com\.br|shope\.ee|s\.shopee\.com\.br/i.test(url);
}

function cleanMLUrl(url) {
  try {
    const u = new URL(url);
    // Keep only the path (product ID is in the path on ML)
    return `https://www.mercadolivre.com.br${u.pathname}`;
  } catch {
    return url;
  }
}

function addMLTrackingFallback(url, trackingId) {
  try {
    const u = new URL(url);
    u.searchParams.set('tracking_id', trackingId);
    return u.toString();
  } catch {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}tracking_id=${trackingId}`;
  }
}

function addShopeeTrackingFallback(url, username, affiliateId) {
  const id = affiliateId || username;
  try {
    const u = new URL(url);
    u.searchParams.set('af_id', id);
    u.searchParams.set('af_click_id', `${id}_${Date.now()}`);
    return u.toString();
  } catch {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}af_id=${id}`;
  }
}

module.exports = { generateAffiliateLink, isMLUrl, isShopeeUrl };
