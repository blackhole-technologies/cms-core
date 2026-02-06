/**
 * Cache Backend - Drupal-Style Tag-Based Invalidation
 *
 * Provides comprehensive caching with tag-based invalidation, multiple bins,
 * cache contexts, and file-based persistence.
 *
 * Key Features:
 * - Tag-based invalidation (invalidate all items tagged 'node:1')
 * - Multiple cache bins (default, render, data, page, etc.)
 * - Cache contexts (vary by user, url, language, etc.)
 * - Checksum-based staleness detection
 * - File-based persistence
 * - Garbage collection
 * - Statistics tracking
 *
 * @version 1.0.0
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

// ===========================================
// Constants
// ===========================================

const CACHE_DIR = 'cache';
const TAG_CHECKSUM_FILE = 'tag-checksums.json';
const STATS_FILE = 'cache-stats.json';

/**
 * Standard cache bins
 */
const STANDARD_BINS = [
  'default',              // General cache
  'render',               // Render array cache
  'data',                 // Processed data cache
  'page',                 // Full page cache
  'dynamic_page_cache',   // Partial page cache
  'config',               // Configuration cache
  'discovery',            // Plugin/service discovery cache
  'bootstrap',            // Early bootstrap cache
  'menu',                 // Menu cache
  'entity',               // Entity cache
];

/**
 * Cache expiration constants
 */
const CACHE_PERMANENT = 0;
const CACHE_DEFAULT = -1;
const DEFAULT_TTL = 3600; // 1 hour in seconds

// ===========================================
// Storage
// ===========================================

/**
 * In-memory cache storage (bin -> cid -> item)
 */
const bins = new Map();

/**
 * Tag checksums (tag -> timestamp)
 */
let tagChecksums = new Map();

/**
 * Cache statistics
 */
let statistics = {
  hits: 0,
  misses: 0,
  sets: 0,
  deletes: 0,
  invalidations: 0,
  tagInvalidations: 0,
  garbageCollections: 0,
};

/**
 * Cache contexts registry
 */
const cacheContexts = new Map();

// ===========================================
// Initialization
// ===========================================

/**
 * Initialize cache system
 *
 * Creates standard bins and loads persisted data.
 */
export function init() {
  // Create cache directory if needed
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }

  // Create standard bins
  for (const binName of STANDARD_BINS) {
    createBin(binName);
  }

  // Load tag checksums
  loadTagChecksums();

  // Load statistics
  loadStatistics();
}

/**
 * Create a cache bin
 *
 * @param {string} bin - Bin name
 */
export function createBin(bin) {
  if (!bins.has(bin)) {
    bins.set(bin, new Map());

    // Create bin directory
    const binDir = join(CACHE_DIR, bin);
    if (!existsSync(binDir)) {
      mkdirSync(binDir, { recursive: true });
    }

    // Load persisted cache items
    loadBin(bin);
  }
}

/**
 * Remove a cache bin
 *
 * @param {string} bin - Bin name
 */
export function removeBin(bin) {
  bins.delete(bin);

  // Remove bin directory
  const binDir = join(CACHE_DIR, bin);
  if (existsSync(binDir)) {
    const files = readdirSync(binDir);
    for (const file of files) {
      unlinkSync(join(binDir, file));
    }
  }
}

/**
 * Get all cache bins
 *
 * @returns {string[]} Array of bin names
 */
export function getBins() {
  return Array.from(bins.keys());
}

// ===========================================
// Core Cache Operations
// ===========================================

/**
 * Get a cache item
 *
 * @param {string} cid - Cache ID
 * @param {string} bin - Cache bin
 * @returns {*} Cached data or null if not found/invalid
 */
export function get(cid, bin = 'default') {
  const binStorage = bins.get(bin);
  if (!binStorage) {
    statistics.misses++;
    return null;
  }

  const item = binStorage.get(cid);
  if (!item) {
    statistics.misses++;
    return null;
  }

  // Check if item is valid
  if (!isValid(item)) {
    binStorage.delete(cid);
    statistics.misses++;
    return null;
  }

  statistics.hits++;
  return item.data;
}

/**
 * Get multiple cache items
 *
 * @param {string[]} cids - Array of cache IDs
 * @param {string} bin - Cache bin
 * @returns {Object} Map of cid -> data for valid items
 */
export function getMultiple(cids, bin = 'default') {
  const results = {};

  for (const cid of cids) {
    const data = get(cid, bin);
    if (data !== null) {
      results[cid] = data;
    }
  }

  return results;
}

/**
 * Set a cache item
 *
 * @param {string} cid - Cache ID
 * @param {*} data - Data to cache
 * @param {number} expire - Expiration timestamp (0 = permanent, -1 = default)
 * @param {string[]} tags - Cache tags for invalidation
 * @param {string} bin - Cache bin
 */
export function set(cid, data, expire = CACHE_DEFAULT, tags = [], bin = 'default') {
  const binStorage = bins.get(bin);
  if (!binStorage) {
    createBin(bin);
    return set(cid, data, expire, tags, bin);
  }

  // Calculate expiration
  const now = Date.now();
  let expiresAt;

  if (expire === CACHE_PERMANENT) {
    expiresAt = 0; // Never expires
  } else if (expire === CACHE_DEFAULT) {
    expiresAt = now + (DEFAULT_TTL * 1000);
  } else {
    expiresAt = expire;
  }

  // Get current tag checksums
  const checksum = getCurrentTagChecksum(tags);

  // Create cache item
  const item = {
    cid,
    data,
    created: now,
    expire: expiresAt,
    tags,
    checksum,
  };

  binStorage.set(cid, item);
  statistics.sets++;

  // Persist to disk
  persistItem(bin, cid, item);
}

/**
 * Delete a cache item
 *
 * @param {string} cid - Cache ID
 * @param {string} bin - Cache bin
 * @returns {boolean} True if item existed
 */
export function delete_(cid, bin = 'default') {
  const binStorage = bins.get(bin);
  if (!binStorage) {
    return false;
  }

  const existed = binStorage.has(cid);
  binStorage.delete(cid);

  if (existed) {
    statistics.deletes++;
    deletePersistedItem(bin, cid);
  }

  return existed;
}

/**
 * Delete multiple cache items
 *
 * @param {string[]} cids - Array of cache IDs
 * @param {string} bin - Cache bin
 * @returns {number} Number of items deleted
 */
export function deleteMultiple(cids, bin = 'default') {
  let count = 0;

  for (const cid of cids) {
    if (delete_(cid, bin)) {
      count++;
    }
  }

  return count;
}

/**
 * Delete all items in a bin
 *
 * @param {string} bin - Cache bin
 * @returns {number} Number of items deleted
 */
export function deleteAll(bin = 'default') {
  const binStorage = bins.get(bin);
  if (!binStorage) {
    return 0;
  }

  const count = binStorage.size;
  binStorage.clear();
  statistics.deletes += count;

  // Clear persisted items
  const binDir = join(CACHE_DIR, bin);
  if (existsSync(binDir)) {
    const files = readdirSync(binDir);
    for (const file of files) {
      unlinkSync(join(binDir, file));
    }
  }

  return count;
}

// ===========================================
// Invalidation
// ===========================================

/**
 * Invalidate a cache item (mark as invalid without deleting)
 *
 * @param {string} cid - Cache ID
 * @param {string} bin - Cache bin
 */
export function invalidate(cid, bin = 'default') {
  const binStorage = bins.get(bin);
  if (!binStorage) {
    return;
  }

  const item = binStorage.get(cid);
  if (item) {
    item.expire = Date.now() - 1; // Set to past
    statistics.invalidations++;
    persistItem(bin, cid, item);
  }
}

/**
 * Invalidate multiple cache items
 *
 * @param {string[]} cids - Array of cache IDs
 * @param {string} bin - Cache bin
 * @returns {number} Number of items invalidated
 */
export function invalidateMultiple(cids, bin = 'default') {
  let count = 0;

  for (const cid of cids) {
    invalidate(cid, bin);
    count++;
  }

  return count;
}

/**
 * Invalidate all items in a bin
 *
 * @param {string} bin - Cache bin
 * @returns {number} Number of items invalidated
 */
export function invalidateAll(bin = 'default') {
  const binStorage = bins.get(bin);
  if (!binStorage) {
    return 0;
  }

  const now = Date.now() - 1;
  let count = 0;

  for (const [cid, item] of binStorage.entries()) {
    item.expire = now;
    persistItem(bin, cid, item);
    count++;
  }

  statistics.invalidations += count;
  return count;
}

/**
 * Invalidate all cache items with specific tags
 *
 * THIS IS THE KEY DRUPAL FEATURE
 *
 * @param {string[]} tags - Array of tags to invalidate
 * @returns {number} Number of tags invalidated
 */
export function invalidateTags(tags) {
  const now = Date.now();

  // Update tag checksums
  for (const tag of tags) {
    invalidateTagChecksum(tag);
  }

  statistics.tagInvalidations++;

  // Save updated checksums
  saveTagChecksums();

  return tags.length;
}

// ===========================================
// Tag Checksum System
// ===========================================

/**
 * Get current checksum for a set of tags
 *
 * The checksum is a hash of all tag invalidation timestamps.
 * If any tag is invalidated, the checksum changes.
 *
 * @param {string[]} tags - Array of tags
 * @returns {string} Checksum hash
 */
export function getCurrentTagChecksum(tags) {
  if (!tags || tags.length === 0) {
    return '';
  }

  // Get timestamps for all tags
  const timestamps = tags.map(tag => {
    return tagChecksums.get(tag) || 0;
  });

  // Create hash of timestamps
  const hash = createHash('md5');
  hash.update(timestamps.join(':'));
  return hash.digest('hex');
}

/**
 * Invalidate tag checksum
 *
 * @param {string} tag - Tag to invalidate
 */
export function invalidateTagChecksum(tag) {
  tagChecksums.set(tag, Date.now());
}

/**
 * Check if cache item is valid
 *
 * An item is valid if:
 * 1. It hasn't expired (time-based)
 * 2. Its tag checksum matches current checksums (tag-based)
 *
 * @param {Object} item - Cache item
 * @returns {boolean} True if item is valid
 */
export function isValid(item) {
  const now = Date.now();

  // Check time-based expiration
  if (item.expire > 0 && now >= item.expire) {
    return false;
  }

  // Check tag-based invalidation
  if (item.tags && item.tags.length > 0) {
    const currentChecksum = getCurrentTagChecksum(item.tags);
    if (currentChecksum !== item.checksum) {
      return false;
    }
  }

  return true;
}

// ===========================================
// Cache Contexts
// ===========================================

/**
 * Register cache context provider
 *
 * @param {string} context - Context name (e.g., 'user', 'url.path')
 * @param {Function} provider - Function that returns context value
 */
export function registerCacheContext(context, provider) {
  cacheContexts.set(context, provider);
}

/**
 * Get cache context value
 *
 * @param {string} context - Context name
 * @param {Object} request - Request object
 * @returns {string} Context value
 */
export function getCacheContext(context, request = {}) {
  const provider = cacheContexts.get(context);
  if (!provider) {
    return '';
  }

  return String(provider(request));
}

/**
 * Get cache keys for contexts
 *
 * @param {string[]} contexts - Array of context names
 * @param {Object} request - Request object
 * @returns {string} Combined context key
 */
export function getCacheContextKeys(contexts, request = {}) {
  if (!contexts || contexts.length === 0) {
    return '';
  }

  const keys = contexts.map(context => {
    return `${context}:${getCacheContext(context, request)}`;
  });

  return keys.join('|');
}

/**
 * Merge cache contexts
 *
 * @param {string[]} a - First context array
 * @param {string[]} b - Second context array
 * @returns {string[]} Merged unique contexts
 */
export function mergeCacheContexts(a, b) {
  return [...new Set([...a, ...b])];
}

// Initialize standard cache contexts
registerCacheContext('user', (req) => req.user?.id || 'anonymous');
registerCacheContext('user.roles', (req) => req.user?.roles?.sort().join(',') || 'anonymous');
registerCacheContext('url', (req) => req.url || '');
registerCacheContext('url.path', (req) => req.path || '');
registerCacheContext('url.query_args', (req) => req.query ? JSON.stringify(req.query) : '');
registerCacheContext('session', (req) => req.sessionId || '');
registerCacheContext('theme', (req) => req.theme || 'default');
registerCacheContext('languages', (req) => req.language || 'en');
registerCacheContext('timezone', (req) => req.timezone || 'UTC');

// ===========================================
// Garbage Collection
// ===========================================

/**
 * Run garbage collection on a bin
 *
 * Removes expired and invalid cache items.
 *
 * @param {string} bin - Cache bin
 * @returns {number} Number of items removed
 */
export function garbageCollection(bin = 'default') {
  const binStorage = bins.get(bin);
  if (!binStorage) {
    return 0;
  }

  let count = 0;
  const itemsToDelete = [];

  for (const [cid, item] of binStorage.entries()) {
    if (!isValid(item)) {
      itemsToDelete.push(cid);
      count++;
    }
  }

  // Delete invalid items
  for (const cid of itemsToDelete) {
    binStorage.delete(cid);
    deletePersistedItem(bin, cid);
  }

  if (count > 0) {
    statistics.garbageCollections++;
  }

  return count;
}

/**
 * Run garbage collection on all bins
 *
 * @returns {Object} Map of bin -> items removed
 */
export function garbageCollectionAll() {
  const results = {};

  for (const bin of bins.keys()) {
    results[bin] = garbageCollection(bin);
  }

  return results;
}

// ===========================================
// Persistence
// ===========================================

/**
 * Get file path for cache item
 *
 * @param {string} bin - Cache bin
 * @param {string} cid - Cache ID
 * @returns {string} File path
 */
function getItemFilePath(bin, cid) {
  // Hash cid to create safe filename
  const hash = createHash('md5');
  hash.update(cid);
  const filename = hash.digest('hex') + '.json';

  return join(CACHE_DIR, bin, filename);
}

/**
 * Persist cache item to disk
 *
 * @param {string} bin - Cache bin
 * @param {string} cid - Cache ID
 * @param {Object} item - Cache item
 */
function persistItem(bin, cid, item) {
  const filepath = getItemFilePath(bin, cid);

  try {
    writeFileSync(filepath, JSON.stringify(item), 'utf8');
  } catch (err) {
    // Silently fail persistence (cache is optional)
    console.error(`Failed to persist cache item ${cid}:`, err.message);
  }
}

/**
 * Delete persisted cache item
 *
 * @param {string} bin - Cache bin
 * @param {string} cid - Cache ID
 */
function deletePersistedItem(bin, cid) {
  const filepath = getItemFilePath(bin, cid);

  try {
    if (existsSync(filepath)) {
      unlinkSync(filepath);
    }
  } catch (err) {
    console.error(`Failed to delete cache item ${cid}:`, err.message);
  }
}

/**
 * Load cache bin from disk
 *
 * @param {string} bin - Cache bin
 */
function loadBin(bin) {
  const binDir = join(CACHE_DIR, bin);
  if (!existsSync(binDir)) {
    return;
  }

  const binStorage = bins.get(bin);
  const files = readdirSync(binDir);

  for (const file of files) {
    if (!file.endsWith('.json')) {
      continue;
    }

    const filepath = join(binDir, file);

    try {
      const content = readFileSync(filepath, 'utf8');
      const item = JSON.parse(content);

      // Only load valid items
      if (isValid(item)) {
        binStorage.set(item.cid, item);
      } else {
        // Delete invalid persisted items
        unlinkSync(filepath);
      }
    } catch (err) {
      console.error(`Failed to load cache item from ${file}:`, err.message);
      // Delete corrupted files
      unlinkSync(filepath);
    }
  }
}

/**
 * Load tag checksums from disk
 */
function loadTagChecksums() {
  const filepath = join(CACHE_DIR, TAG_CHECKSUM_FILE);

  if (!existsSync(filepath)) {
    tagChecksums = new Map();
    return;
  }

  try {
    const content = readFileSync(filepath, 'utf8');
    const data = JSON.parse(content);
    tagChecksums = new Map(Object.entries(data));
  } catch (err) {
    console.error('Failed to load tag checksums:', err.message);
    tagChecksums = new Map();
  }
}

/**
 * Save tag checksums to disk
 */
function saveTagChecksums() {
  const filepath = join(CACHE_DIR, TAG_CHECKSUM_FILE);
  const data = Object.fromEntries(tagChecksums);

  try {
    writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save tag checksums:', err.message);
  }
}

/**
 * Load statistics from disk
 */
function loadStatistics() {
  const filepath = join(CACHE_DIR, STATS_FILE);

  if (!existsSync(filepath)) {
    return;
  }

  try {
    const content = readFileSync(filepath, 'utf8');
    statistics = JSON.parse(content);
  } catch (err) {
    console.error('Failed to load statistics:', err.message);
  }
}

/**
 * Save statistics to disk
 */
function saveStatistics() {
  const filepath = join(CACHE_DIR, STATS_FILE);

  try {
    writeFileSync(filepath, JSON.stringify(statistics, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save statistics:', err.message);
  }
}

// ===========================================
// Statistics
// ===========================================

/**
 * Get cache statistics
 *
 * @returns {Object} Statistics object
 */
export function getStatistics() {
  const binStats = {};

  for (const [binName, binStorage] of bins.entries()) {
    binStats[binName] = binStorage.size;
  }

  const hitRate = statistics.hits + statistics.misses > 0
    ? ((statistics.hits / (statistics.hits + statistics.misses)) * 100).toFixed(1) + '%'
    : 'N/A';

  return {
    ...statistics,
    hitRate,
    bins: binStats,
    totalItems: Array.from(bins.values()).reduce((sum, bin) => sum + bin.size, 0),
    tagCount: tagChecksums.size,
  };
}

/**
 * Reset statistics
 */
export function resetStatistics() {
  statistics = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    invalidations: 0,
    tagInvalidations: 0,
    garbageCollections: 0,
  };

  saveStatistics();
}

// ===========================================
// Shutdown
// ===========================================

/**
 * Shutdown cache system
 *
 * Saves all state to disk.
 */
export function shutdown() {
  saveTagChecksums();
  saveStatistics();
}

// ===========================================
// Auto-initialization
// ===========================================

// Initialize on module load
init();

// Auto-save on process exit
process.on('exit', shutdown);
process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});
process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});

// ===========================================
// Default Export
// ===========================================

export default {
  // Core operations
  get,
  getMultiple,
  set,
  delete: delete_,
  deleteMultiple,
  deleteAll,

  // Invalidation
  invalidate,
  invalidateMultiple,
  invalidateTags,
  invalidateAll,

  // Tag checksums
  getCurrentTagChecksum,
  invalidateTagChecksum,
  isValid,

  // Cache contexts
  registerCacheContext,
  getCacheContext,
  getCacheContextKeys,
  mergeCacheContexts,

  // Garbage collection
  garbageCollection,
  garbageCollectionAll,

  // Bin management
  createBin,
  removeBin,
  getBins,

  // Statistics
  getStatistics,
  resetStatistics,

  // Lifecycle
  init,
  shutdown,

  // Constants
  CACHE_PERMANENT,
  CACHE_DEFAULT,
};
