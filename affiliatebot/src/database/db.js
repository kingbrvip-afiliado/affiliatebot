const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../data/affiliatebot.db');

let db;

function getDb() {
  if (!db) {
    const fs = require('fs');
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
  }
  return db;
}

function initialize() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id            TEXT    NOT NULL,
      source_type   TEXT    NOT NULL,
      source_profile TEXT   NOT NULL,
      raw_content   TEXT,
      product_name  TEXT,
      original_link TEXT,
      image_url     TEXT,
      original_price REAL,
      sale_price    REAL,
      discount      INTEGER,
      status        TEXT    NOT NULL DEFAULT 'pending',
      affiliate_link TEXT,
      channels      TEXT,
      captured_at   TEXT    NOT NULL,
      published_at  TEXT,
      PRIMARY KEY (id, source_type)
    );

    CREATE TABLE IF NOT EXISTS bot_state (
      chat_id       TEXT    PRIMARY KEY,
      state         TEXT    NOT NULL,
      pending_post_id TEXT,
      pending_source_type TEXT,
      updated_at    TEXT    NOT NULL
    );
  `);

  console.log('[DB] Banco de dados inicializado em:', DB_PATH);
}

function postExists(id, sourceType) {
  const db = getDb();
  const row = db.prepare(
    'SELECT 1 FROM posts WHERE id = ? AND source_type = ?'
  ).get(id, sourceType);
  return !!row;
}

function savePost(post) {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO posts
      (id, source_type, source_profile, raw_content, product_name,
       original_link, image_url, original_price, sale_price, discount,
       status, captured_at)
    VALUES
      (@id, @sourceType, @sourceProfile, @rawContent, @productName,
       @originalLink, @imageUrl, @originalPrice, @salePrice, @discount,
       'pending', @capturedAt)
  `).run({
    id:            post.id,
    sourceType:    post.sourceType,
    sourceProfile: post.sourceProfile,
    rawContent:    post.rawContent || null,
    productName:   post.productName || null,
    originalLink:  post.originalLink || null,
    imageUrl:      post.imageUrl || null,
    originalPrice: post.originalPrice || null,
    salePrice:     post.salePrice || null,
    discount:      post.discount || null,
    capturedAt:    new Date().toISOString(),
  });
}

function getPost(id, sourceType) {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM posts WHERE id = ? AND source_type = ?'
  ).get(id, sourceType);
}

function updatePostStatus(id, sourceType, status, extra = {}) {
  const db = getDb();
  db.prepare(`
    UPDATE posts SET
      status         = @status,
      affiliate_link = COALESCE(@affiliateLink, affiliate_link),
      channels       = COALESCE(@channels, channels),
      published_at   = CASE WHEN @status = 'published' THEN @now ELSE published_at END
    WHERE id = @id AND source_type = @sourceType
  `).run({
    id,
    sourceType,
    status,
    affiliateLink: extra.affiliateLink || null,
    channels:      extra.channels ? JSON.stringify(extra.channels) : null,
    now:           new Date().toISOString(),
  });
}

function getBotState(chatId) {
  const db = getDb();
  return db.prepare('SELECT * FROM bot_state WHERE chat_id = ?').get(String(chatId));
}

function setBotState(chatId, state, pendingPostId = null, pendingSourceType = null) {
  const db = getDb();
  db.prepare(`
    INSERT INTO bot_state (chat_id, state, pending_post_id, pending_source_type, updated_at)
    VALUES (@chatId, @state, @pendingPostId, @pendingSourceType, @now)
    ON CONFLICT(chat_id) DO UPDATE SET
      state              = excluded.state,
      pending_post_id    = excluded.pending_post_id,
      pending_source_type= excluded.pending_source_type,
      updated_at         = excluded.updated_at
  `).run({
    chatId: String(chatId),
    state,
    pendingPostId,
    pendingSourceType,
    now: new Date().toISOString(),
  });
}

function clearBotState(chatId) {
  const db = getDb();
  db.prepare('DELETE FROM bot_state WHERE chat_id = ?').run(String(chatId));
}

function getRecentPosts(limit = 20) {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM posts ORDER BY captured_at DESC LIMIT ?'
  ).all(limit);
}

function getStats() {
  const db = getDb();
  const total     = db.prepare("SELECT COUNT(*) as n FROM posts").get().n;
  const pending   = db.prepare("SELECT COUNT(*) as n FROM posts WHERE status = 'pending'").get().n;
  const approved  = db.prepare("SELECT COUNT(*) as n FROM posts WHERE status = 'approved'").get().n;
  const published = db.prepare("SELECT COUNT(*) as n FROM posts WHERE status = 'published'").get().n;
  const rejected  = db.prepare("SELECT COUNT(*) as n FROM posts WHERE status = 'rejected'").get().n;
  return { total, pending, approved, published, rejected };
}

module.exports = {
  initialize,
  postExists,
  savePost,
  getPost,
  updatePostStatus,
  getBotState,
  setBotState,
  clearBotState,
  getRecentPosts,
  getStats,
};
