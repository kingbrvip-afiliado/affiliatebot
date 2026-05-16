const { TwitterApi } = require('twitter-api-v2');

let twitterClient;

function getClient() {
  if (!twitterClient) {
    twitterClient = new TwitterApi({
      appKey:            process.env.TWITTER_API_KEY,
      appSecret:         process.env.TWITTER_API_SECRET,
      accessToken:       process.env.TWITTER_ACCESS_TOKEN,
      accessSecret:      process.env.TWITTER_ACCESS_SECRET,
    });
  }
  return twitterClient;
}

/**
 * Publica um tweet
 * @param {string} text - texto do tweet (máx. 280 caracteres)
 * @returns {Promise<{success: boolean, tweetId?: string, error?: string}>}
 */
async function publishToTwitter(text) {
  const client = getClient();

  try {
    const tweet = await client.v2.tweet(text);
    console.log('[TWITTER PUBLISHER] Tweet publicado:', tweet.data.id);
    return { success: true, tweetId: tweet.data.id };
  } catch (err) {
    console.error('[TWITTER PUBLISHER] Erro ao publicar tweet:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { publishToTwitter };
