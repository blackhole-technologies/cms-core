/**
 * ratelimit.js - Rate Limiting System
 *
 * WHAT IS RATE LIMITING:
 * ======================
 * Rate limiting controls how many requests a client can make within a time window.
 * It protects against:
 * - Brute force attacks (password guessing)
 * - DoS attacks (overwhelming the server)
 * - API abuse (excessive automated requests)
 * - Resource exhaustion (database overload)
 *
 * RATE LIMITING STRATEGIES:
 * =========================
 *
 * 1. FIXED WINDOW
 *    - Simple: count requests in fixed time periods (e.g., per minute)
 *    - Problem: burst at window boundaries
 *    - Example: 100 requests at 11:59:59, 100 more at 12:00:00 = 200 in 2 seconds
 *
 * 2. SLIDING WINDOW (what we use)
 *    - Track exact timestamps of requests
 *    - Count requests in rolling window from current time
 *    - Smoother rate enforcement, no boundary bursts
 *    - More memory (store each request timestamp)
 *
 * 3. TOKEN BUCKET
 *    - Tokens added at fixed rate, consumed per request
 *    - Allows bursts up to bucket size
 *    - Good for APIs with occasional spikes
 *
 * 4. LEAKY BUCKET
 *    - Requests "leak" out at fixed rate
 *    - Smooths traffic completely
 *    - Good for consistent throughput
 *
 * WHY SLIDING WINDOW:
 * - Best balance of accuracy and simplicity
 * - No burst exploitation at boundaries
 * - Memory manageable with cleanup
 * - Easy to reason about ("X requests per Y seconds")
 *
 * IDENTIFICATION STRATEGIES:
 * ==========================
 *
 * 1. BY IP ADDRESS
 *    - Simple and universal
 *    - Problem: shared IPs (NAT, proxies, corporate networks)
 *    - Problem: IP spoofing (though TCP prevents most)
 *    - Best for: unauthenticated endpoints (login, registration)
 *
 * 2. BY USER/SESSION
 *    - More accurate per-user limiting
 *    - Survives IP changes (mobile networks)
 *    - Problem: only works for authenticated requests
 *    - Best for: authenticated API endpoints
 *
 * 3. BY API TOKEN
 *    - Per-application limiting
 *    - Good for third-party integrations
 *    - Best for: public APIs with developer keys
 *
 * 4. COMPOSITE (what we use)
 *    - Combine IP + session/token
 *    - IP limit catches unauthenticated abuse
 *    - User limit prevents account-based abuse
 *    - Defense in depth
 *
 * BLOCKING STRATEGIES:
 * ====================
 *
 * 1. SOFT BLOCK (429 response)
 *    - Return "Too Many Requests" status
 *    - Include Retry-After header
 *    - Client can retry after cooldown
 *    - What we do for normal rate limiting
 *
 * 2. HARD BLOCK (temporary ban)
 *    - Block for extended period after repeated violations
 *    - Escalating: 5 min -> 15 min -> 1 hour -> 24 hours
 *    - What we do for login abuse
 *
 * 3. PERMANENT BLOCK
 *    - Requires manual unblock
 *    - For confirmed malicious actors
 *    - Implemented via manual CLI command
 *
 * RESPONSE HEADERS:
 * =================
 * X-RateLimit-Limit: Maximum requests allowed
 * X-RateLimit-Remaining: Requests left in window
 * X-RateLimit-Reset: Unix timestamp when window resets
 * Retry-After: Seconds until retry allowed (on 429)
 *
 * IMPLEMENTATION NOTES:
 * =====================
 * - In-memory storage (lost on restart)
 * - For production: consider Redis or similar
 * - Cleanup runs periodically to prevent memory growth
 * - Timestamps stored as arrays for sliding window
 */

// ===========================================
// Configuration
// ===========================================

/**
 * Rate limiter state
 */
let rateLimitEnabled = true;
let rateLimitConfig = {
  login: { points: 5, duration: 60, blockDuration: 300 },
  api: { points: 100, duration: 60 },
  admin: { points: 60, duration: 60 },
};

/**
 * Request tracking storage
 * Structure: Map<key, { timestamps: number[], blockedUntil?: number, reason?: string }>
 *
 * WHY THIS STRUCTURE:
 * - timestamps: Array of request times for sliding window
 * - blockedUntil: Unix ms when block expires (if blocked)
 * - reason: Why blocked (for admin visibility)
 */
const requestStore = new Map();

/**
 * Cleanup interval reference
 */
let cleanupInterval = null;

// ===========================================
// Initialization
// ===========================================

/**
 * Initialize rate limiting system
 *
 * @param {Object} config - Rate limit configuration
 * @param {boolean} config.enabled - Whether rate limiting is enabled
 * @param {Object} config.login - Login rate limit config
 * @param {Object} config.api - API rate limit config
 * @param {Object} config.admin - Admin rate limit config
 *
 * CONFIG STRUCTURE:
 * {
 *   enabled: true,
 *   login: { points: 5, duration: 60, blockDuration: 300 },
 *   api: { points: 100, duration: 60 },
 *   admin: { points: 60, duration: 60 }
 * }
 *
 * WHERE:
 * - points: Max requests allowed in window
 * - duration: Window size in seconds
 * - blockDuration: How long to block after exceeding (optional)
 */
export function init(config = {}) {
  rateLimitEnabled = config.enabled !== false;

  if (config.login) {
    rateLimitConfig.login = { ...rateLimitConfig.login, ...config.login };
  }
  if (config.api) {
    rateLimitConfig.api = { ...rateLimitConfig.api, ...config.api };
  }
  if (config.admin) {
    rateLimitConfig.admin = { ...rateLimitConfig.admin, ...config.admin };
  }

  // Start cleanup interval (every minute)
  // WHY PERIODIC CLEANUP:
  // - Prevents unbounded memory growth
  // - Removes expired entries and old timestamps
  // - More efficient than checking on every request
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
  }

  cleanupInterval = setInterval(cleanup, 60 * 1000);

  // Don't prevent process from exiting
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }
}

/**
 * Check if rate limiting is enabled
 */
export function isEnabled() {
  return rateLimitEnabled;
}

/**
 * Get rate limit configuration
 */
export function getConfig() {
  return {
    enabled: rateLimitEnabled,
    ...rateLimitConfig,
  };
}

// ===========================================
// Core Rate Limiting
// ===========================================

/**
 * Check if a request is allowed under rate limits
 *
 * @param {string} key - Unique identifier (IP, session, token)
 * @param {Object} options - Rate limit options
 * @param {number} options.points - Max requests allowed
 * @param {number} options.duration - Window size in seconds
 * @param {number} options.blockDuration - Block duration in seconds (optional)
 * @param {string} options.reason - Reason for tracking (for admin visibility)
 * @returns {Object} - { allowed, remaining, resetAt, blockedUntil?, retryAfter? }
 *
 * ALGORITHM (Sliding Window):
 * 1. Get current timestamp
 * 2. Calculate window start (current - duration)
 * 3. Filter out timestamps older than window start
 * 4. If blocked, check if block has expired
 * 5. If not blocked and within limit, add new timestamp
 * 6. If over limit and blockDuration set, create block
 * 7. Return result with remaining count
 *
 * @example
 * const result = checkLimit('192.168.1.1', {
 *   points: 5,
 *   duration: 60,
 *   blockDuration: 300,
 *   reason: 'login'
 * });
 *
 * if (!result.allowed) {
 *   // Return 429 with Retry-After: result.retryAfter
 * }
 */
export function checkLimit(key, options) {
  const {
    points = 10,
    duration = 60,
    blockDuration = 0,
    reason = 'unknown',
  } = options;

  const now = Date.now();
  const windowStart = now - (duration * 1000);
  const windowEnd = now + (duration * 1000);

  // Get or create entry for this key
  let entry = requestStore.get(key);

  if (!entry) {
    entry = { timestamps: [], reason };
    requestStore.set(key, entry);
  }

  // Check if currently blocked
  // WHY CHECK BLOCK FIRST:
  // - Blocked clients should be rejected immediately
  // - Don't count their requests during block period
  // - Prevents block bypass by waiting for window reset
  if (entry.blockedUntil && entry.blockedUntil > now) {
    const retryAfter = Math.ceil((entry.blockedUntil - now) / 1000);
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.blockedUntil,
      blockedUntil: entry.blockedUntil,
      retryAfter,
      blocked: true,
    };
  }

  // Clear expired block
  if (entry.blockedUntil && entry.blockedUntil <= now) {
    entry.blockedUntil = undefined;
  }

  // Filter timestamps to current window (sliding window)
  // WHY FILTER:
  // - Only count recent requests
  // - Automatically "forgets" old requests
  // - Implements sliding window behavior
  entry.timestamps = entry.timestamps.filter(ts => ts > windowStart);

  // Check if within limit
  const currentCount = entry.timestamps.length;

  if (currentCount >= points) {
    // Over limit
    // WHY BLOCK ON EXCEED:
    // - Prevents rapid retry attempts
    // - Gives server time to recover
    // - Discourages abuse
    if (blockDuration > 0) {
      entry.blockedUntil = now + (blockDuration * 1000);
      entry.reason = reason;
    }

    // Calculate when oldest request in window expires
    const oldestInWindow = entry.timestamps[0] || now;
    const resetAt = oldestInWindow + (duration * 1000);
    const retryAfter = blockDuration > 0
      ? blockDuration
      : Math.ceil((resetAt - now) / 1000);

    return {
      allowed: false,
      remaining: 0,
      resetAt: blockDuration > 0 ? entry.blockedUntil : resetAt,
      retryAfter,
      blocked: blockDuration > 0,
    };
  }

  // Within limit - record this request
  entry.timestamps.push(now);
  entry.reason = reason;

  return {
    allowed: true,
    remaining: points - entry.timestamps.length,
    resetAt: windowEnd,
  };
}

/**
 * Create a rate limiter instance with preset options
 *
 * @param {Object} options - Default options for this limiter
 * @returns {Object} - Limiter instance with check() method
 *
 * WHY FACTORY PATTERN:
 * - Encapsulate configuration for specific use cases
 * - Cleaner API for middleware
 * - Easy to create multiple limiters with different configs
 *
 * @example
 * const loginLimiter = createLimiter({
 *   points: 5,
 *   duration: 60,
 *   blockDuration: 300,
 *   reason: 'login'
 * });
 *
 * const result = loginLimiter.check('192.168.1.1');
 */
export function createLimiter(options) {
  return {
    check: (key) => checkLimit(key, options),
    options,
  };
}

// ===========================================
// Key Generation
// ===========================================

/**
 * Get client IP from request
 *
 * @param {http.IncomingMessage} req - HTTP request
 * @returns {string} - Client IP address
 *
 * IP DETECTION ORDER:
 * 1. X-Forwarded-For header (first IP if multiple)
 * 2. X-Real-IP header
 * 3. req.socket.remoteAddress
 *
 * WHY CHECK HEADERS:
 * - Servers behind proxies/load balancers
 * - Original client IP in forwarded headers
 * - Direct connection falls back to socket
 *
 * SECURITY NOTE:
 * X-Forwarded-For can be spoofed if not behind trusted proxy.
 * In production, only trust these headers from known proxies.
 */
export function getClientIP(req) {
  // X-Forwarded-For may contain multiple IPs: client, proxy1, proxy2
  // First IP is the original client
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = forwarded.split(',').map(ip => ip.trim());
    return ips[0];
  }

  // X-Real-IP is typically set by nginx
  const realIP = req.headers['x-real-ip'];
  if (realIP) {
    return realIP;
  }

  // Fall back to socket address
  return req.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Generate rate limit key for request
 *
 * @param {http.IncomingMessage} req - HTTP request
 * @param {string} type - Limiter type ('login', 'api', 'admin')
 * @param {Object} ctx - Request context (may have session info)
 * @returns {string} - Rate limit key
 *
 * KEY STRATEGIES:
 * - login: IP only (unauthenticated)
 * - api: Token + IP (authenticated with fallback)
 * - admin: Session + IP (authenticated with fallback)
 *
 * WHY COMPOSITE KEYS:
 * - IP alone misses account-based abuse
 * - Session alone misses IP-based attacks
 * - Combined provides defense in depth
 */
export function generateKey(req, type, ctx) {
  const ip = getClientIP(req);

  switch (type) {
    case 'login':
      // Login: IP only (not authenticated yet)
      return `login:${ip}`;

    case 'api':
      // API: Token preferred, fallback to IP
      // WHY TOKEN PREFERRED:
      // - Multiple clients may share IP
      // - Token identifies specific application
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        // Use first 16 chars of token as key (privacy)
        return `api:${token.substring(0, 16)}`;
      }
      return `api:${ip}`;

    case 'admin':
      // Admin: Session preferred, fallback to IP
      // WHY SESSION PREFERRED:
      // - Per-user limiting for authenticated users
      // - IP fallback catches unauthenticated probes
      const session = ctx?.services?.get?.('auth')?.getSession?.(req);
      if (session?.userId) {
        return `admin:${session.userId}`;
      }
      return `admin:${ip}`;

    default:
      return `${type}:${ip}`;
  }
}

// ===========================================
// Middleware Factory
// ===========================================

/**
 * Create rate limiting middleware
 *
 * @param {Object} options - Middleware options
 * @param {string} options.type - Limiter type ('login', 'api', 'admin')
 * @param {number} options.points - Override default points
 * @param {number} options.duration - Override default duration
 * @param {number} options.blockDuration - Override default block duration
 * @param {Function} options.keyGenerator - Custom key generator (req, ctx) => string
 * @param {Function} options.onBlocked - Custom handler when blocked
 * @returns {Function} - Middleware function
 *
 * MIDDLEWARE BEHAVIOR:
 * 1. Extract rate limit key from request
 * 2. Check if request is allowed
 * 3. Add X-RateLimit-* headers
 * 4. If blocked, return 429 and stop
 * 5. If allowed, continue to next middleware
 *
 * @example
 * // Use in router
 * router.use(rateLimit({ type: 'login' }), 'loginLimit', '/login');
 *
 * // Custom configuration
 * router.use(rateLimit({
 *   type: 'api',
 *   points: 1000,
 *   duration: 3600,
 *   keyGenerator: (req) => req.headers['x-api-key']
 * }), 'apiLimit', '/api');
 */
export function rateLimit(options = {}) {
  const {
    type = 'default',
    keyGenerator,
    onBlocked,
  } = options;

  // Get config for this type
  const typeConfig = rateLimitConfig[type] || {};

  // Merge options with type defaults
  const finalOptions = {
    points: options.points || typeConfig.points || 60,
    duration: options.duration || typeConfig.duration || 60,
    blockDuration: options.blockDuration || typeConfig.blockDuration || 0,
    reason: type,
  };

  return async function rateLimitMiddleware(req, res, ctx, next) {
    // Skip if rate limiting disabled
    if (!rateLimitEnabled) {
      await next();
      return;
    }

    // Generate key for this request
    const key = keyGenerator
      ? keyGenerator(req, ctx)
      : generateKey(req, type, ctx);

    // Check rate limit
    const result = checkLimit(key, finalOptions);

    // Always add rate limit headers
    // WHY ALWAYS ADD:
    // - Clients can monitor their usage
    // - Helps with debugging
    // - Standard practice for rate-limited APIs
    res.setHeader('X-RateLimit-Limit', finalOptions.points);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, result.remaining));
    res.setHeader('X-RateLimit-Reset', Math.floor(result.resetAt / 1000));

    if (!result.allowed) {
      // Add Retry-After header
      res.setHeader('Retry-After', result.retryAfter);

      // Custom blocked handler
      if (onBlocked) {
        await onBlocked(req, res, ctx, result);
        return;
      }

      // Default 429 response
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Too Many Requests',
        message: result.blocked
          ? `Rate limit exceeded. Blocked for ${result.retryAfter} seconds.`
          : `Rate limit exceeded. Try again in ${result.retryAfter} seconds.`,
        retryAfter: result.retryAfter,
      }));
      return;
    }

    // Request allowed, continue
    await next();
  };
}

// ===========================================
// Block Management
// ===========================================

/**
 * Get all currently blocked entries
 *
 * @returns {Array} - Array of { key, blockedUntil, reason }
 */
export function getBlocked() {
  const now = Date.now();
  const blocked = [];

  for (const [key, entry] of requestStore) {
    if (entry.blockedUntil && entry.blockedUntil > now) {
      blocked.push({
        key,
        blockedUntil: entry.blockedUntil,
        blockedUntilFormatted: new Date(entry.blockedUntil).toISOString(),
        reason: entry.reason || 'unknown',
        remainingSeconds: Math.ceil((entry.blockedUntil - now) / 1000),
      });
    }
  }

  return blocked;
}

/**
 * Manually block a key
 *
 * @param {string} key - Key to block (usually IP)
 * @param {number} duration - Block duration in seconds (default: 1 hour)
 * @param {string} reason - Reason for block
 * @returns {Object} - Block details
 *
 * USE CASES:
 * - Manually block known bad actors
 * - Emergency response to attacks
 * - Testing rate limit behavior
 */
export function blockKey(key, duration = 3600, reason = 'manual') {
  const now = Date.now();
  const blockedUntil = now + (duration * 1000);

  let entry = requestStore.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    requestStore.set(key, entry);
  }

  entry.blockedUntil = blockedUntil;
  entry.reason = reason;

  return {
    key,
    blockedUntil,
    blockedUntilFormatted: new Date(blockedUntil).toISOString(),
    reason,
    duration,
  };
}

/**
 * Clear rate limit data for a key
 *
 * @param {string} key - Key to clear (or null for all)
 * @returns {number} - Number of entries cleared
 *
 * USE CASES:
 * - Unblock accidentally blocked user
 * - Reset after fixing issue
 * - Clean up test data
 */
export function clearKey(key = null) {
  if (key === null) {
    // Clear all
    const count = requestStore.size;
    requestStore.clear();
    return count;
  }

  // Clear specific key
  // Also try with common prefixes
  const keys = [key];

  // If it looks like an IP, try all prefixed versions
  if (key.match(/^[\d.]+$/) || key.includes(':')) {
    keys.push(`login:${key}`, `api:${key}`, `admin:${key}`);
  }

  let cleared = 0;
  for (const k of keys) {
    if (requestStore.delete(k)) {
      cleared++;
    }
  }

  return cleared;
}

/**
 * Clear all blocks (but keep rate limit counters)
 *
 * @returns {number} - Number of blocks cleared
 */
export function clearAllBlocks() {
  let cleared = 0;

  for (const [key, entry] of requestStore) {
    if (entry.blockedUntil) {
      entry.blockedUntil = undefined;
      cleared++;
    }
  }

  return cleared;
}

// ===========================================
// Cleanup
// ===========================================

/**
 * Clean up expired entries
 *
 * @returns {number} - Number of entries removed
 *
 * WHAT GETS CLEANED:
 * - Entries with no recent requests (older than 2x max duration)
 * - Expired blocks are kept but cleared
 * - Empty entries are removed
 *
 * WHY PERIODIC CLEANUP:
 * - In-memory storage grows unbounded without cleanup
 * - Expired data no longer useful
 * - Reduces memory footprint
 */
export function cleanup() {
  const now = Date.now();
  // Keep entries active within 2 hours (max reasonable window)
  const cutoff = now - (2 * 60 * 60 * 1000);
  let removed = 0;

  for (const [key, entry] of requestStore) {
    // Filter old timestamps
    entry.timestamps = entry.timestamps.filter(ts => ts > cutoff);

    // Clear expired blocks
    if (entry.blockedUntil && entry.blockedUntil <= now) {
      entry.blockedUntil = undefined;
    }

    // Remove empty entries that aren't blocked
    if (entry.timestamps.length === 0 && !entry.blockedUntil) {
      requestStore.delete(key);
      removed++;
    }
  }

  return removed;
}

/**
 * Get statistics about rate limiter
 *
 * @returns {Object} - Stats object
 */
export function getStats() {
  const now = Date.now();
  let totalEntries = 0;
  let totalTimestamps = 0;
  let activeBlocks = 0;

  for (const [key, entry] of requestStore) {
    totalEntries++;
    totalTimestamps += entry.timestamps.length;
    if (entry.blockedUntil && entry.blockedUntil > now) {
      activeBlocks++;
    }
  }

  return {
    totalEntries,
    totalTimestamps,
    activeBlocks,
    memoryEstimate: totalTimestamps * 8 + totalEntries * 100, // Rough bytes estimate
  };
}

// ===========================================
// Default Export
// ===========================================

export default {
  init,
  isEnabled,
  getConfig,
  checkLimit,
  createLimiter,
  getClientIP,
  generateKey,
  rateLimit,
  getBlocked,
  blockKey,
  clearKey,
  clearAllBlocks,
  cleanup,
  getStats,
};
