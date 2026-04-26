/**
 * Content History & Read Tracking Service
 *
 * Tracks which content items each user has viewed/read, enabling:
 * - "New" badges on unviewed content
 * - "Updated" badges on content modified since last view
 * - "X new items since your last visit" counts
 * - Per-user read history for dashboards
 *
 * Inspired by Drupal's history module.
 *
 * Storage: content/history/{userId}.json per user
 * Format: { userId, lastVisit, reads: { "type/id": epochMs } }
 *
 * WHY this architecture:
 * - Per-user files: Avoids locking a single history file, enables parallel writes
 * - Epoch ms timestamps: Compact storage, fast numeric comparison vs ISO strings
 * - In-memory cache: Dashboard queries need fast bulk access to user history
 * - LRU eviction: Bounds memory while keeping hot data cached
 * - maxEntriesPerUser: Prevents unlimited growth for power users
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

/**
 * Database pool for PostgreSQL history persistence.
 * When non-null, read history is stored in `content_history` table.
 * @type {import('../src/core/storage/pg-client.ts').PgPool | null}
 */
let dbPool = null;

let config = {};
let historyDir = '';
let initialized = false;

// In-memory cache for recently accessed user histories
// WHY: Dashboard showing "3 new items" needs to check hundreds of content items
// against user history. Reading from disk on every check would be too slow.
const historyCache = new Map();
const CACHE_MAX = 100; // Max cached user histories

/**
 * Initialize history tracking service
 *
 * @param {Object} cfg - Configuration from site.json "history" key
 * @param {boolean} cfg.enabled - Enable/disable tracking (default: true)
 * @param {number} cfg.maxEntriesPerUser - Max tracked items per user (default: 1000)
 * @param {boolean} cfg.trackAnonymous - Track anonymous users (default: false)
 * @param {string} baseDir - Base directory for CMS (contains content/)
 */
export function init(cfg = {}, baseDir) {
  config = {
    enabled: cfg.enabled !== false, // Default enabled
    maxEntriesPerUser: cfg.maxEntriesPerUser || 1000,
    trackAnonymous: cfg.trackAnonymous || false,
    ...cfg,
  };

  historyDir = join(baseDir, 'content', 'history');

  if (!existsSync(historyDir)) {
    mkdirSync(historyDir, { recursive: true });
  }

  initialized = true;
}

/**
 * Load user history from disk
 * WHY private function: Centralize file I/O and error handling
 *
 * @param {string} userId
 * @returns {Object} { userId, lastVisit, reads: {} }
 */
function getUserHistory(userId) {
  const filePath = join(historyDir, `${userId}.json`);
  if (!existsSync(filePath)) {
    return { userId, lastVisit: null, reads: {} };
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (e) {
    // Corrupted file - return empty history
    return { userId, lastVisit: null, reads: {} };
  }
}

/**
 * Save user history to disk (flat-file mode only).
 * WHY: Flush cache to persistent storage
 *
 * @param {string} userId
 * @param {Object} history
 */
function saveUserHistory(userId, history) {
  if (dbPool) return; // DB mode: individual mutations handle persistence

  const filePath = join(historyDir, `${userId}.json`);
  writeFileSync(filePath, JSON.stringify(history, null, 2) + '\n');
}

/**
 * Set database pool for PostgreSQL history persistence.
 * @param {import('../src/core/storage/pg-client.ts').PgPool} pool
 */
export async function initDb(pool) {
  dbPool = pool;
  console.log('[history] Using PostgreSQL for history storage');
}

/**
 * Persist a single view record to the database (upsert).
 */
function persistViewToDb(userId, contentType, contentId, viewedAtMs) {
  if (!dbPool) return;
  dbPool
    .query(
      `INSERT INTO content_history (user_id, content_type, content_id, viewed_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, content_type, content_id) DO UPDATE SET
       viewed_at = EXCLUDED.viewed_at`,
      [userId, contentType, contentId, new Date(viewedAtMs).toISOString()]
    )
    .catch((err) => console.warn(`[history] Failed to persist view to DB: ${err.message}`));
}

/**
 * Persist user's lastVisit to the database.
 */
function persistLastVisitToDb(userId, lastVisit) {
  if (!dbPool) return;
  // Use a special sentinel row to track lastVisit
  dbPool
    .query(
      `INSERT INTO content_history (user_id, content_type, content_id, viewed_at)
     VALUES ($1, '_meta', '_lastVisit', $2)
     ON CONFLICT (user_id, content_type, content_id) DO UPDATE SET
       viewed_at = EXCLUDED.viewed_at`,
      [userId, lastVisit]
    )
    .catch((err) => console.warn(`[history] Failed to persist lastVisit to DB: ${err.message}`));
}

/**
 * Delete all history for a user from the database.
 */
function clearHistoryFromDb(userId) {
  if (!dbPool) return;
  dbPool
    .query(`DELETE FROM content_history WHERE user_id = $1`, [userId])
    .catch((err) => console.warn(`[history] Failed to clear history from DB: ${err.message}`));
}

/**
 * Load a user's history from the database into cache format.
 * @param {string} userId
 * @returns {Promise<Object|null>}
 */
async function loadHistoryFromDb(userId) {
  if (!dbPool) return null;

  try {
    const result = await dbPool.query(
      `SELECT content_type, content_id, viewed_at
       FROM content_history
       WHERE user_id = $1`,
      [userId]
    );

    const history = { userId, lastVisit: null, reads: {} };

    for (const r of result.rows) {
      if (r.content_type === '_meta' && r.content_id === '_lastVisit') {
        history.lastVisit = new Date(r.viewed_at).toISOString();
      } else {
        const key = `${r.content_type}/${r.content_id}`;
        history.reads[key] = new Date(r.viewed_at).getTime();
      }
    }

    return history;
  } catch (error) {
    console.warn(`[history] Failed to load from DB for ${userId}: ${error.message}`);
    return null;
  }
}

/**
 * Get user history from cache or load from disk
 * WHY: LRU-like caching reduces disk I/O for frequently accessed users
 *
 * @param {string} userId
 * @returns {Object}
 */
function getCachedHistory(userId) {
  if (historyCache.has(userId)) {
    return historyCache.get(userId);
  }

  const history = getUserHistory(userId);

  // Simple LRU: Remove oldest if cache full
  if (historyCache.size >= CACHE_MAX) {
    const firstKey = historyCache.keys().next().value;
    historyCache.delete(firstKey);
  }

  historyCache.set(userId, history);
  return history;
}

/**
 * Trim history to maxEntriesPerUser
 * WHY: Power users viewing thousands of items would cause unbounded file growth
 * Keep newest entries since recent views are most relevant for "new" detection
 *
 * @param {Object} history
 */
function trimHistory(history) {
  const entries = Object.entries(history.reads);
  if (entries.length <= config.maxEntriesPerUser) return;

  // Sort by timestamp descending, keep newest
  entries.sort((a, b) => b[1] - a[1]);
  history.reads = Object.fromEntries(entries.slice(0, config.maxEntriesPerUser));
}

/**
 * Build content key for reads map
 * WHY: Format "type/id" allows querying by contentType or full content item
 *
 * @param {string} contentType
 * @param {string} contentId
 * @returns {string}
 */
function buildKey(contentType, contentId) {
  return `${contentType}/${contentId}`;
}

// ============================================================================
// Core Tracking
// ============================================================================

/**
 * Record that user viewed this content
 * WHY fire-and-forget: Request handlers shouldn't wait for history writes
 *
 * @param {string} userId
 * @param {string} contentType
 * @param {string} contentId
 */
export function recordView(userId, contentType, contentId) {
  if (!initialized || !config.enabled) return;

  // Don't track anonymous if disabled
  if (!userId || (userId === 'anonymous' && !config.trackAnonymous)) {
    return;
  }

  const history = getCachedHistory(userId);
  const key = buildKey(contentType, contentId);

  const now = Date.now();
  history.reads[key] = now;
  history.lastVisit = new Date().toISOString();

  trimHistory(history);
  saveUserHistory(userId, history);
  persistViewToDb(userId, contentType, contentId, now);
  persistLastVisitToDb(userId, history.lastVisit);

  // Update cache
  historyCache.set(userId, history);
}

/**
 * Get timestamp when user last viewed this content
 *
 * @param {string} userId
 * @param {string} contentType
 * @param {string} contentId
 * @returns {number} Epoch ms, or 0 if never viewed
 */
export function getLastViewed(userId, contentType, contentId) {
  if (!initialized || !config.enabled) return 0;

  const history = getCachedHistory(userId);
  const key = buildKey(contentType, contentId);
  return history.reads[key] || 0;
}

/**
 * Check if user has viewed this content
 *
 * @param {string} userId
 * @param {string} contentType
 * @param {string} contentId
 * @returns {boolean}
 */
export function hasViewed(userId, contentType, contentId) {
  return getLastViewed(userId, contentType, contentId) > 0;
}

/**
 * Check if content is new for this user
 * WHY: Content created after last view (or never viewed) should show "New" badge
 *
 * @param {string} userId
 * @param {string} contentType
 * @param {string} contentId
 * @param {string} contentCreated - ISO timestamp
 * @returns {boolean}
 */
export function isNew(userId, contentType, contentId, contentCreated) {
  if (!initialized || !config.enabled) return false;

  const lastViewed = getLastViewed(userId, contentType, contentId);
  if (lastViewed === 0) return true; // Never viewed = new

  const createdMs = new Date(contentCreated).getTime();
  return createdMs > lastViewed;
}

/**
 * Check if content was updated since user last viewed it
 * WHY: Show "Updated" badge to surface changes to previously-read content
 *
 * @param {string} userId
 * @param {string} contentType
 * @param {string} contentId
 * @param {string} contentUpdated - ISO timestamp
 * @returns {boolean}
 */
export function isUpdated(userId, contentType, contentId, contentUpdated) {
  if (!initialized || !config.enabled) return false;

  const lastViewed = getLastViewed(userId, contentType, contentId);
  if (lastViewed === 0) return false; // Never viewed = new, not updated

  const updatedMs = new Date(contentUpdated).getTime();
  return updatedMs > lastViewed;
}

// ============================================================================
// Bulk Queries
// ============================================================================

/**
 * Count new/updated items for user
 * WHY: Dashboard "12 new items since your last visit" requires bulk checking
 *
 * @param {string} userId
 * @param {string} contentType
 * @param {Array} items - Array of { id, created, updated }
 * @returns {number}
 */
export function getUnreadCount(userId, contentType, items) {
  if (!initialized || !config.enabled) return 0;

  const history = getCachedHistory(userId);
  let count = 0;

  for (const item of items) {
    const key = buildKey(contentType, item.id);
    const lastViewed = history.reads[key] || 0;

    if (lastViewed === 0) {
      count++; // Never viewed
      continue;
    }

    const updatedMs = new Date(item.updated || item.created).getTime();
    if (updatedMs > lastViewed) {
      count++; // Updated since last view
    }
  }

  return count;
}

/**
 * Mark all items as read
 * WHY: "Mark all as read" button in UI
 *
 * @param {string} userId
 * @param {string} contentType
 * @param {Array} items - Array of { id }
 */
export function markAllRead(userId, contentType, items) {
  if (!initialized || !config.enabled) return;

  const history = getCachedHistory(userId);
  const now = Date.now();

  for (const item of items) {
    const key = buildKey(contentType, item.id);
    history.reads[key] = now;
    persistViewToDb(userId, contentType, item.id, now);
  }

  history.lastVisit = new Date().toISOString();

  trimHistory(history);
  saveUserHistory(userId, history);
  persistLastVisitToDb(userId, history.lastVisit);
  historyCache.set(userId, history);
}

/**
 * Get user's full read history
 * WHY: User profile "Recently viewed" section
 *
 * @param {string} userId
 * @param {Object} options - { contentType?, limit?, sort? }
 * @returns {Array} [{ contentType, contentId, timestamp }, ...]
 */
export function getReadHistory(userId, options = {}) {
  if (!initialized || !config.enabled) return [];

  const history = getCachedHistory(userId);
  let entries = Object.entries(history.reads).map(([key, timestamp]) => {
    const [contentType, contentId] = key.split('/');
    return { contentType, contentId, timestamp };
  });

  // Filter by contentType if specified
  if (options.contentType) {
    entries = entries.filter((e) => e.contentType === options.contentType);
  }

  // Sort by timestamp descending (newest first)
  if (options.sort !== false) {
    entries.sort((a, b) => b.timestamp - a.timestamp);
  }

  // Limit results
  if (options.limit) {
    entries = entries.slice(0, options.limit);
  }

  return entries;
}

// ============================================================================
// User Management
// ============================================================================

/**
 * Delete all history for a user
 * WHY: GDPR compliance - delete user data on account deletion
 *
 * @param {string} userId
 */
export function clearHistory(userId) {
  if (!initialized) return;

  const filePath = join(historyDir, `${userId}.json`);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }

  clearHistoryFromDb(userId);
  historyCache.delete(userId);
}

/**
 * Get user's last visit timestamp
 *
 * @param {string} userId
 * @returns {string|null} ISO timestamp
 */
export function getLastVisit(userId) {
  if (!initialized || !config.enabled) return null;

  const history = getCachedHistory(userId);
  return history.lastVisit;
}

/**
 * Update user's lastVisit timestamp without recording a specific view
 * WHY: Track user activity even when not viewing specific content (login, dashboard visit)
 *
 * @param {string} userId
 */
export function recordVisit(userId) {
  if (!initialized || !config.enabled) return;

  const history = getCachedHistory(userId);
  history.lastVisit = new Date().toISOString();

  saveUserHistory(userId, history);
  persistLastVisitToDb(userId, history.lastVisit);
  historyCache.set(userId, history);
}

// ============================================================================
// Stats
// ============================================================================

/**
 * Get system-wide history statistics
 * WHY: Admin dashboard metrics
 *
 * @returns {Object} { totalUsers, totalReads }
 */
export function getStats() {
  if (!initialized) {
    return { totalUsers: 0, totalReads: 0 };
  }

  const files = readdirSync(historyDir).filter((f) => f.endsWith('.json'));
  let totalReads = 0;

  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(historyDir, file), 'utf8'));
      totalReads += Object.keys(data.reads || {}).length;
    } catch (e) {
      // Skip corrupted files
    }
  }

  return {
    totalUsers: files.length,
    totalReads,
  };
}
