/**
 * ratelimit.ts - Rate Limiting System
 *
 * Sliding window rate limiter with:
 * - Per-IP, per-session, and per-token identification
 * - Soft blocks (429) and hard blocks (temporary ban)
 * - Standard X-RateLimit-* response headers
 * - Periodic cleanup to prevent memory growth
 *
 * WHY SLIDING WINDOW:
 * - Best balance of accuracy and simplicity
 * - No burst exploitation at window boundaries
 * - Memory manageable with cleanup
 * - Easy to reason about ("X requests per Y seconds")
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

// ============================================================================
// Types
// ============================================================================

/** Rate limit configuration for a specific type */
interface RateLimitTypeConfig {
    points?: number;
    duration?: number;
    blockDuration?: number;
}

/** Full rate limit configuration */
interface RateLimitFullConfig {
    enabled?: boolean;
    login?: RateLimitTypeConfig;
    api?: RateLimitTypeConfig;
    admin?: RateLimitTypeConfig;
}

/** Internal request tracking entry */
interface RequestEntry {
    timestamps: number[];
    blockedUntil?: number;
    reason?: string;
}

/** Options passed to checkLimit */
interface CheckLimitOptions {
    points?: number;
    duration?: number;
    blockDuration?: number;
    reason?: string;
}

/** Result of a rate limit check */
interface CheckLimitResult {
    allowed: boolean;
    remaining: number;
    resetAt: number;
    retryAfter?: number;
    blocked?: boolean;
    blockedUntil?: number;
}

/** A pre-configured rate limiter instance */
interface LimiterInstance {
    check: (key: string) => CheckLimitResult;
    options: CheckLimitOptions;
}

/** Blocked entry info */
interface BlockedEntry {
    key: string;
    blockedUntil: number;
    blockedUntilFormatted: string;
    reason: string;
    remainingSeconds: number;
}

/** Block result info */
interface BlockResult {
    key: string;
    blockedUntil: number;
    blockedUntilFormatted: string;
    reason: string;
    duration: number;
}

/** Rate limiter statistics */
interface RateLimitStats {
    totalEntries: number;
    totalTimestamps: number;
    activeBlocks: number;
    memoryEstimate: number;
}

/** Middleware options */
interface RateLimitMiddlewareOptions {
    type?: string;
    points?: number;
    duration?: number;
    blockDuration?: number;
    keyGenerator?: (req: IncomingMessage, ctx: RateLimitContext) => string;
    onBlocked?: (req: IncomingMessage, res: ServerResponse, ctx: RateLimitContext, result: CheckLimitResult) => Promise<void> | void;
}

/** Request context for rate limiting */
interface RateLimitContext {
    services?: Map<string, unknown>;
    [key: string]: unknown;
}

/** Auth service interface as expected by generateKey */
interface AuthServiceForRateLimit {
    getSession(req: IncomingMessage): { userId: string; sessionId: string } | null;
}

/** Internal config map for rate limit types */
interface RateLimitConfigMap {
    login: Required<RateLimitTypeConfig>;
    api: Required<RateLimitTypeConfig>;
    admin: Required<RateLimitTypeConfig>;
    [key: string]: RateLimitTypeConfig;
}

// ============================================================================
// State
// ============================================================================

let rateLimitEnabled: boolean = true;

let rateLimitConfig: RateLimitConfigMap = {
    login: { points: 5, duration: 60, blockDuration: 300 },
    api: { points: 100, duration: 60, blockDuration: 0 },
    admin: { points: 60, duration: 60, blockDuration: 0 },
};

/**
 * Request tracking storage
 * WHY THIS STRUCTURE:
 * - timestamps: Array of request times for sliding window
 * - blockedUntil: Unix ms when block expires (if blocked)
 * - reason: Why blocked (for admin visibility)
 */
const requestStore: Map<string, RequestEntry> = new Map();

/** Cleanup interval reference */
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

// ============================================================================
// Initialization
// ============================================================================
/**
 * Initialize rate limiting system
 *
 * WHERE config values come from:
 * - points: Max requests allowed in window
 * - duration: Window size in seconds
 * - blockDuration: How long to block after exceeding (optional)
 */
export function init(config: RateLimitFullConfig = {}): void {
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
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
    }
    cleanupInterval = setInterval(cleanup, 60 * 1000);
    // Don't prevent process from exiting
    if (cleanupInterval.unref) {
        cleanupInterval.unref();
    }
}

/** Check if rate limiting is enabled */
export function isEnabled(): boolean {
    return rateLimitEnabled;
}

/** Get rate limit configuration */
export function getConfig(): RateLimitFullConfig & { enabled: boolean } {
    return {
        enabled: rateLimitEnabled,
        ...rateLimitConfig,
    };
}

// ============================================================================
// Core Rate Limiting
// ============================================================================
/**
 * Check if a request is allowed under rate limits
 *
 * ALGORITHM (Sliding Window):
 * 1. Get current timestamp
 * 2. Calculate window start (current - duration)
 * 3. Filter out timestamps older than window start
 * 4. If blocked, check if block has expired
 * 5. If not blocked and within limit, add new timestamp
 * 6. If over limit and blockDuration set, create block
 * 7. Return result with remaining count
 */
export function checkLimit(key: string, options: CheckLimitOptions): CheckLimitResult {
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
    entry.timestamps = entry.timestamps.filter(ts => ts > windowStart);

    // Check if within limit
    const currentCount = entry.timestamps.length;
    if (currentCount >= points) {
        // Over limit
        if (blockDuration > 0) {
            entry.blockedUntil = now + (blockDuration * 1000);
            entry.reason = reason;
        }

        // Calculate when oldest request in window expires
        const oldestInWindow = entry.timestamps[0] ?? now;
        const resetAt = oldestInWindow + (duration * 1000);
        const retryAfter = blockDuration > 0
            ? blockDuration
            : Math.ceil((resetAt - now) / 1000);

        return {
            allowed: false,
            remaining: 0,
            resetAt: blockDuration > 0 ? (entry.blockedUntil as number) : resetAt,
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
 * WHY FACTORY PATTERN:
 * - Encapsulate configuration for specific use cases
 * - Cleaner API for middleware
 */
export function createLimiter(options: CheckLimitOptions): LimiterInstance {
    return {
        check: (key: string): CheckLimitResult => checkLimit(key, options),
        options,
    };
}

// ============================================================================
// Key Generation
// ============================================================================
/**
 * Get client IP from request
 *
 * IP DETECTION ORDER:
 * 1. X-Forwarded-For header (first IP if multiple)
 * 2. X-Real-IP header
 * 3. req.socket.remoteAddress
 *
 * SECURITY NOTE:
 * X-Forwarded-For can be spoofed if not behind trusted proxy.
 * In production, only trust these headers from known proxies.
 */
export function getClientIP(req: IncomingMessage): string {
    // X-Forwarded-For may contain multiple IPs: client, proxy1, proxy2
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        const ips = (typeof forwarded === 'string' ? forwarded : forwarded[0] ?? '').split(',').map(ip => ip.trim());
        return ips[0] ?? '127.0.0.1';
    }

    // X-Real-IP is typically set by nginx
    const realIP = req.headers['x-real-ip'];
    if (realIP) {
        return typeof realIP === 'string' ? realIP : realIP[0] ?? '127.0.0.1';
    }

    // Fall back to socket address
    return req.socket?.remoteAddress ?? '127.0.0.1';
}

/**
 * Generate rate limit key for request
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
export function generateKey(req: IncomingMessage, type: string, ctx: RateLimitContext): string {
    const ip = getClientIP(req);

    switch (type) {
        case 'login':
            return `login:${ip}`;
        case 'api': {
            const authHeader = req.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                const token = authHeader.slice(7);
                return `api:${token.substring(0, 16)}`;
            }
            return `api:${ip}`;
        }
        case 'admin': {
            const auth = ctx?.services?.get?.('auth') as AuthServiceForRateLimit | undefined;
            const session = auth?.getSession?.(req);
            if (session?.userId) {
                return `admin:${session.userId}`;
            }
            return `admin:${ip}`;
        }
        default:
            return `${type}:${ip}`;
    }
}

// ============================================================================
// Middleware Factory
// ============================================================================
/**
 * Create rate limiting middleware
 *
 * MIDDLEWARE BEHAVIOR:
 * 1. Extract rate limit key from request
 * 2. Check if request is allowed
 * 3. Add X-RateLimit-* headers
 * 4. If blocked, return 429 and stop
 * 5. If allowed, continue to next middleware
 */
export function rateLimit(
    options: RateLimitMiddlewareOptions = {}
): (req: IncomingMessage, res: ServerResponse, ctx: RateLimitContext, next: () => Promise<void>) => Promise<void> {
    const {
        type = 'default',
        keyGenerator,
        onBlocked,
    } = options;

    // Get config for this type
    const typeConfig = rateLimitConfig[type] ?? {};

    // Merge options with type defaults
    const finalOptions: CheckLimitOptions = {
        points: options.points ?? typeConfig.points ?? 60,
        duration: options.duration ?? typeConfig.duration ?? 60,
        blockDuration: options.blockDuration ?? typeConfig.blockDuration ?? 0,
        reason: type,
    };

    return async function rateLimitMiddleware(
        req: IncomingMessage,
        res: ServerResponse,
        ctx: RateLimitContext,
        next: () => Promise<void>
    ): Promise<void> {
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
        res.setHeader('X-RateLimit-Limit', finalOptions.points ?? 60);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, result.remaining));
        res.setHeader('X-RateLimit-Reset', Math.floor(result.resetAt / 1000));

        if (!result.allowed) {
            // Add Retry-After header
            res.setHeader('Retry-After', result.retryAfter ?? 60);

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

// ============================================================================
// Block Management
// ============================================================================

/** Get all currently blocked entries */
export function getBlocked(): BlockedEntry[] {
    const now = Date.now();
    const blocked: BlockedEntry[] = [];

    for (const [key, entry] of requestStore) {
        if (entry.blockedUntil && entry.blockedUntil > now) {
            blocked.push({
                key,
                blockedUntil: entry.blockedUntil,
                blockedUntilFormatted: new Date(entry.blockedUntil).toISOString(),
                reason: entry.reason ?? 'unknown',
                remainingSeconds: Math.ceil((entry.blockedUntil - now) / 1000),
            });
        }
    }

    return blocked;
}

/**
 * Manually block a key
 *
 * USE CASES:
 * - Manually block known bad actors
 * - Emergency response to attacks
 * - Testing rate limit behavior
 */
export function blockKey(
    key: string,
    duration: number = 3600,
    reason: string = 'manual'
): BlockResult {
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
 * USE CASES:
 * - Unblock accidentally blocked user
 * - Reset after fixing issue
 * - Clean up test data
 */
export function clearKey(key: string | null = null): number {
    if (key === null) {
        const count = requestStore.size;
        requestStore.clear();
        return count;
    }

    // Clear specific key
    // Also try with common prefixes
    const keys: string[] = [key];

    // If it looks like an IP, try all prefixed versions
    if (/^[\d.]+$/.test(key) || key.includes(':')) {
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

/** Clear all blocks (but keep rate limit counters) */
export function clearAllBlocks(): number {
    let cleared = 0;
    for (const [_key, entry] of requestStore) {
        if (entry.blockedUntil) {
            entry.blockedUntil = undefined;
            cleared++;
        }
    }
    return cleared;
}

// ============================================================================
// Cleanup
// ============================================================================
/**
 * Clean up expired entries
 *
 * WHAT GETS CLEANED:
 * - Entries with no recent requests (older than 2x max duration)
 * - Expired blocks are kept but cleared
 * - Empty entries are removed
 */
export function cleanup(): number {
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

/** Get statistics about rate limiter */
export function getStats(): RateLimitStats {
    const now = Date.now();
    let totalEntries = 0;
    let totalTimestamps = 0;
    let activeBlocks = 0;

    for (const [_key, entry] of requestStore) {
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
        memoryEstimate: totalTimestamps * 8 + totalEntries * 100,
    };
}

// ============================================================================
// Default Export
// ============================================================================
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
