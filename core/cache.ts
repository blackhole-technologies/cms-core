/**
 * cache.ts - In-Memory Cache Module
 *
 * Provides a simple but effective caching layer with TTL (time-to-live) support.
 *
 * CACHE STRATEGY:
 * 1. READ-THROUGH CACHING — check cache first, fetch on miss
 * 2. WRITE-THROUGH INVALIDATION — invalidate on create/update/delete
 * 3. TTL-BASED EXPIRATION — lazy cleanup on access, not proactively
 * 4. PATTERN-BASED INVALIDATION — wildcard patterns for bulk clearing
 *
 * CACHE KEY CONVENTIONS (colon-separated namespaces):
 *   content:<type>:<id>           - Single content item
 *   content:<type>:list:<hash>    - List query results
 *   api:<method>:<path>           - API response cache
 */

// ============================================================================
// Types
// ============================================================================

/** A single cached entry with its expiration timestamp */
interface CacheEntry {
    value: unknown;
    expiresAt: number;
}

/** Cache statistics for monitoring and debugging */
interface CacheStatistics {
    hits: number;
    misses: number;
    sets: number;
    deletes: number;
    clears: number;
}

/** Options for cache initialization */
interface CacheInitConfig {
    ttl?: number;
}

/** Options for generating a list cache key */
interface ListKeyOptions {
    page?: number;
    limit?: number;
    search?: string | null;
    sortBy?: string;
    sortOrder?: string;
    filters?: Record<string, string> | null;
}

/** Cache stats returned by stats() */
interface CacheStats {
    hits: number;
    misses: number;
    sets: number;
    deletes: number;
    clears: number;
    size: number;
    keys: string[];
    hitRate: string;
}

// ============================================================================
// State
// ============================================================================

/** The cache store — a simple Map for O(1) lookups */
const store: Map<string, CacheEntry> = new Map();

/** Cache statistics for monitoring and debugging */
const statistics: CacheStatistics = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    clears: 0,
};

/** Default TTL in seconds */
let defaultTTL: number = 300; // 5 minutes

// ============================================================================
// Configuration
// ============================================================================

/** Initialize cache with configuration */
export function init(config: CacheInitConfig = {}): void {
    if (config.ttl) {
        defaultTTL = config.ttl;
    }
    store.clear();
    statistics.hits = 0;
    statistics.misses = 0;
    statistics.sets = 0;
    statistics.deletes = 0;
    statistics.clears = 0;
}

// ============================================================================
// Core Operations
// ============================================================================

/**
 * Retrieve a value from the cache
 *
 * Uses lazy expiration — only checks on access.
 */
export function get(key: string): unknown {
    const entry = store.get(key);

    if (!entry) {
        statistics.misses++;
        return null;
    }

    if (Date.now() > entry.expiresAt) {
        store.delete(key);
        statistics.misses++;
        return null;
    }

    statistics.hits++;
    return entry.value;
}

/**
 * Store a value in the cache
 *
 * @param key - The cache key
 * @param value - The value to cache
 * @param ttl - Time-to-live in seconds (uses default if not specified)
 */
export function set(key: string, value: unknown, ttl: number = defaultTTL): void {
    const expiresAt = Date.now() + (ttl * 1000);
    store.set(key, { value, expiresAt });
    statistics.sets++;
}

/**
 * Remove a specific key from the cache
 */
function deleteKey(key: string): boolean {
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
 * - "content:*" — All content cache entries
 * - "content:greeting:*" — All greeting-related entries
 * - "*" or no pattern — Clear entire cache
 */
export function clear(pattern: string | null = null): number {
    statistics.clears++;

    if (!pattern || pattern === '*') {
        const count = store.size;
        store.clear();
        return count;
    }

    // Convert glob pattern to regex
    const regexPattern = pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
    const regex = new RegExp(`^${regexPattern}$`);

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
 * Cleans up expired entries before reporting for accurate counts.
 */
export function stats(): CacheStats {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
        if (now > entry.expiresAt) {
            store.delete(key);
        }
    }

    const total = statistics.hits + statistics.misses;
    return {
        hits: statistics.hits,
        misses: statistics.misses,
        sets: statistics.sets,
        deletes: statistics.deletes,
        clears: statistics.clears,
        size: store.size,
        keys: Array.from(store.keys()),
        hitRate: total > 0
            ? ((statistics.hits / total) * 100).toFixed(1) + '%'
            : 'N/A',
    };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a key exists in cache (and is not expired)
 *
 * Unlike get(), this doesn't count as a hit/miss in statistics.
 */
export function has(key: string): boolean {
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
 * @returns Seconds until expiration, or -1 if not found/expired
 */
export function ttl(key: string): number {
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
 * Filter keys are sorted for consistent cache keys regardless of insertion order.
 */
export function listKey(type: string, options: ListKeyOptions = {}): string {
    const { page = 1, limit = 20, search = null, sortBy = 'created', sortOrder = 'desc', filters = null } = options;
    const searchPart = search ? `s${search}` : 's-';
    const sortPart = `o${sortBy}${sortOrder === 'desc' ? 'd' : 'a'}`;

    let filterPart = 'f-';
    if (filters && Object.keys(filters).length > 0) {
        const sortedFilters = Object.entries(filters)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([k, v]) => `${k}=${v}`)
            .join('&');
        filterPart = `f${sortedFilters}`;
    }

    return `content:${type}:list:p${page}l${limit}${searchPart}${sortPart}${filterPart}`;
}

/** Generate a cache key for a single content item */
export function itemKey(type: string, id: string): string {
    return `content:${type}:${id}`;
}

/** Generate a cache key for API responses */
export function apiKey(method: string, url: string): string {
    return `api:${method}:${url}`;
}

// ============================================================================
// Default Export
// ============================================================================
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
