/**
 * CMS Core - In-Memory Cache Module
 *
 * Provides a simple but effective caching layer with TTL (time-to-live) support.
 *
 * CACHE STRATEGY:
 * ===============
 *
 * 1. READ-THROUGH CACHING
 *    - When data is requested, check cache first
 *    - If cache hit (and not expired), return cached value
 *    - If cache miss, fetch from source, store in cache, return value
 *
 * 2. WRITE-THROUGH INVALIDATION
 *    - When data is modified (create/update/delete), invalidate related cache entries
 *    - This ensures consistency between cache and source of truth
 *    - We invalidate rather than update to avoid stale data edge cases
 *
 * 3. TTL-BASED EXPIRATION
 *    - Each cache entry has a TTL (time-to-live) in seconds
 *    - Expired entries are treated as cache misses
 *    - Lazy cleanup: expired entries removed on access, not proactively
 *    - This avoids the overhead of background cleanup timers
 *
 * 4. PATTERN-BASED INVALIDATION
 *    - Supports wildcard patterns for bulk cache clearing
 *    - Example: "content:greeting:*" clears all greeting-related cache
 *    - Useful when a change affects multiple cached entries
 *
 * CACHE KEY CONVENTIONS:
 * ======================
 *
 * We use colon-separated namespaced keys for organization:
 *
 *   content:<type>:<id>           - Single content item
 *   content:<type>:list:<hash>    - List query results
 *   api:<method>:<path>           - API response cache
 *
 * Examples:
 *   "content:greeting:abc123"     - A specific greeting item
 *   "content:greeting:list:p1l20" - Page 1, limit 20 of greetings
 *   "api:GET:/api/content/user"   - Cached API response
 *
 * MEMORY CONSIDERATIONS:
 * ======================
 *
 * This is an in-memory cache, meaning:
 * - Cache is lost on server restart (by design - simplicity over persistence)
 * - Memory grows with cache size (monitor with stats())
 * - No maximum size limit (could be added if memory becomes a concern)
 * - Suitable for single-server deployments
 *
 * For multi-server or persistent caching, consider Redis or similar.
 * This implementation is intentionally simple for zero-dependency philosophy.
 *
 * THREAD SAFETY:
 * ==============
 *
 * Node.js is single-threaded for JavaScript execution, so this cache
 * is inherently safe from race conditions. However, async operations
 * between cache check and cache write could theoretically cause
 * redundant fetches (harmless, just inefficient).
 */

// ===========================================
// Cache Storage
// ===========================================

/**
 * The cache store - a simple Map for O(1) lookups
 *
 * Each entry is stored as: { value, expiresAt }
 * - value: the cached data (any type)
 * - expiresAt: Unix timestamp (ms) when entry expires
 */
const store = new Map();

/**
 * Cache statistics for monitoring and debugging
 */
const statistics = {
  hits: 0,    // Successful cache retrievals
  misses: 0,  // Cache misses (not found or expired)
  sets: 0,    // Number of cache writes
  deletes: 0, // Number of explicit deletions
  clears: 0,  // Number of bulk clear operations
};

/**
 * Default TTL in seconds (can be overridden per-entry or via config)
 */
let defaultTTL = 300; // 5 minutes

// ===========================================
// Configuration
// ===========================================

/**
 * Initialize cache with configuration
 *
 * @param {Object} config - Cache configuration
 * @param {boolean} config.enabled - Whether caching is enabled
 * @param {number} config.ttl - Default TTL in seconds
 */
export function init(config = {}) {
  if (config.ttl) {
    defaultTTL = config.ttl;
  }
  // Clear any existing cache on init
  store.clear();
  // Reset statistics
  statistics.hits = 0;
  statistics.misses = 0;
  statistics.sets = 0;
  statistics.deletes = 0;
  statistics.clears = 0;
}

// ===========================================
// Core Operations
// ===========================================

/**
 * Retrieve a value from the cache
 *
 * @param {string} key - The cache key to look up
 * @returns {*} The cached value, or null if not found/expired
 *
 * @example
 * const user = cache.get('content:user:abc123');
 * if (user) {
 *   // Cache hit - use cached value
 * } else {
 *   // Cache miss - fetch from source
 * }
 */
export function get(key) {
  const entry = store.get(key);

  // Cache miss - key doesn't exist
  if (!entry) {
    statistics.misses++;
    return null;
  }

  // Check if entry has expired
  // We use lazy expiration - only check on access
  if (Date.now() > entry.expiresAt) {
    // Entry expired - remove it and treat as miss
    store.delete(key);
    statistics.misses++;
    return null;
  }

  // Cache hit - return the value
  statistics.hits++;
  return entry.value;
}

/**
 * Store a value in the cache
 *
 * @param {string} key - The cache key
 * @param {*} value - The value to cache (any serializable type)
 * @param {number} [ttl] - Time-to-live in seconds (uses default if not specified)
 *
 * @example
 * // Cache with default TTL
 * cache.set('content:greeting:abc123', greetingData);
 *
 * // Cache with custom TTL (60 seconds)
 * cache.set('api:GET:/health', healthData, 60);
 */
export function set(key, value, ttl = defaultTTL) {
  // Calculate expiration timestamp
  // TTL is in seconds, Date.now() is in milliseconds
  const expiresAt = Date.now() + (ttl * 1000);

  store.set(key, { value, expiresAt });
  statistics.sets++;
}

/**
 * Remove a specific key from the cache
 *
 * @param {string} key - The cache key to remove
 * @returns {boolean} True if key existed and was removed
 *
 * @example
 * // Invalidate a specific item after update
 * cache.delete('content:greeting:abc123');
 */
function deleteKey(key) {
  const existed = store.has(key);
  store.delete(key);
  if (existed) {
    statistics.deletes++;
  }
  return existed;
}

// Export with name 'delete' (reserved word, so we define separately)
export { deleteKey as delete };

/**
 * Clear cache entries matching a pattern
 *
 * Supports wildcard patterns using '*' character:
 * - "content:*" - All content cache entries
 * - "content:greeting:*" - All greeting-related entries
 * - "*" or no pattern - Clear entire cache
 *
 * @param {string} [pattern] - Glob-like pattern (supports * wildcard)
 * @returns {number} Number of entries cleared
 *
 * @example
 * // Clear all cache
 * cache.clear();
 *
 * // Clear all content cache
 * cache.clear('content:*');
 *
 * // Clear all greeting-related cache
 * cache.clear('content:greeting:*');
 */
export function clear(pattern = null) {
  statistics.clears++;

  // No pattern or "*" - clear everything
  if (!pattern || pattern === '*') {
    const count = store.size;
    store.clear();
    return count;
  }

  // Pattern matching with wildcard support
  // Convert glob pattern to regex
  // Escape special regex chars except *, then convert * to .*
  const regexPattern = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')  // Escape special chars
    .replace(/\*/g, '.*');                    // Convert * to .*

  const regex = new RegExp(`^${regexPattern}$`);

  // Find and delete matching keys
  let count = 0;
  for (const key of store.keys()) {
    if (regex.test(key)) {
      store.delete(key);
      count++;
    }
  }

  return count;
}

/**
 * Get cache statistics
 *
 * Returns metrics useful for monitoring cache effectiveness:
 * - hits/misses ratio indicates cache efficiency
 * - size shows memory usage (entry count)
 * - keys lists all current cache keys (useful for debugging)
 *
 * @returns {Object} Cache statistics
 *
 * @example
 * const stats = cache.stats();
 * console.log(`Hit rate: ${stats.hits / (stats.hits + stats.misses) * 100}%`);
 */
export function stats() {
  // Clean up expired entries before reporting
  // This gives accurate size/keys counts
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.expiresAt) {
      store.delete(key);
    }
  }

  return {
    hits: statistics.hits,
    misses: statistics.misses,
    sets: statistics.sets,
    deletes: statistics.deletes,
    clears: statistics.clears,
    size: store.size,
    keys: Array.from(store.keys()),
    hitRate: statistics.hits + statistics.misses > 0
      ? ((statistics.hits / (statistics.hits + statistics.misses)) * 100).toFixed(1) + '%'
      : 'N/A',
  };
}

// ===========================================
// Utility Functions
// ===========================================

/**
 * Check if a key exists in cache (and is not expired)
 *
 * Unlike get(), this doesn't count as a hit/miss in statistics.
 * Useful for conditional logic without affecting metrics.
 *
 * @param {string} key - The cache key to check
 * @returns {boolean} True if key exists and is not expired
 */
export function has(key) {
  const entry = store.get(key);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return false;
  }
  return true;
}

/**
 * Get the TTL remaining for a key (in seconds)
 *
 * @param {string} key - The cache key
 * @returns {number} Seconds until expiration, or -1 if not found/expired
 */
export function ttl(key) {
  const entry = store.get(key);
  if (!entry) return -1;

  const remaining = entry.expiresAt - Date.now();
  if (remaining <= 0) {
    store.delete(key);
    return -1;
  }

  return Math.ceil(remaining / 1000);
}

/**
 * Generate a cache key for content list queries
 *
 * Creates a consistent, unique key based on query parameters including filters.
 *
 * @param {string} type - Content type
 * @param {Object} options - Query options
 * @returns {string} Cache key
 *
 * @example
 * const key = cache.listKey('greeting', { page: 1, limit: 20 });
 * // Returns: "content:greeting:list:p1l20s-o-f-"
 *
 * const keyWithFilters = cache.listKey('user', { filters: { role: 'admin' } });
 * // Returns: "content:user:list:p1l20s-o-frole=admin"
 */
export function listKey(type, options = {}) {
  const { page = 1, limit = 20, search = null, sortBy = 'created', sortOrder = 'desc', filters = null, workspaceId = null } = options;
  // Create a compact but unique key from parameters
  const searchPart = search ? `s${search}` : 's-';
  const sortPart = `o${sortBy}${sortOrder === 'desc' ? 'd' : 'a'}`;

  // Include filters in cache key
  // Sort filter keys for consistent cache keys regardless of insertion order
  let filterPart = 'f-';
  if (filters && Object.keys(filters).length > 0) {
    const sortedFilters = Object.entries(filters)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    filterPart = `f${sortedFilters}`;
  }

  // WHY workspaceId IN CACHE KEY:
  // Different workspace contexts return different content sets.
  // Without this, a live query caches results that then get served
  // for workspace-scoped queries (or vice versa), breaking isolation.
  const wsPart = workspaceId ? `w${workspaceId}` : 'w-';

  return `content:${type}:list:p${page}l${limit}${searchPart}${sortPart}${filterPart}${wsPart}`;
}

/**
 * Generate a cache key for a single content item
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @returns {string} Cache key
 */
export function itemKey(type, id) {
  return `content:${type}:${id}`;
}

/**
 * Generate a cache key for API responses
 *
 * @param {string} method - HTTP method
 * @param {string} url - Request URL
 * @returns {string} Cache key
 */
export function apiKey(method, url) {
  return `api:${method}:${url}`;
}

// ===========================================
// Default Export
// ===========================================

export default {
  init,
  get,
  set,
  delete: deleteKey,
  clear,
  stats,
  has,
  ttl,
  listKey,
  itemKey,
  apiKey,
};
