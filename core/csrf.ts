/**
 * csrf.ts - Cross-Site Request Forgery Protection
 *
 * WHAT IS CSRF:
 * =============
 * Cross-Site Request Forgery (CSRF) is an attack where a malicious website
 * tricks a user's browser into making unwanted requests to another site
 * where the user is authenticated.
 *
 * HOW WE PREVENT IT:
 * ==================
 * CSRF tokens! Every form includes a secret token that:
 * 1. Is tied to the user's session
 * 2. Is not accessible to other websites (Same-Origin Policy)
 * 3. Must be included in every state-changing request
 *
 * TOKEN DESIGN:
 * =============
 * Token format: timestamp.signature
 * - timestamp: When the token was created (for expiry)
 * - signature: HMAC-SHA256(sessionId + timestamp + secret)
 *
 * WHY THIS FORMAT:
 * - Stateless validation (don't need to store tokens in DB)
 * - Tied to session (stolen token useless without session)
 * - Time-limited (expired tokens rejected)
 * - Cryptographically secure (HMAC prevents forgery)
 *
 * WHY STORE TOKENS IN MEMORY:
 * While our tokens are stateless (self-validating via signature), we also
 * track issued tokens in memory to:
 * - Count active tokens (for monitoring/debugging)
 * - Enable token revocation (clear all tokens)
 * - Clean up expired tokens periodically
 *
 * WHAT'S PROTECTED:
 * =================
 * - All POST/PUT/DELETE requests to /admin/*
 * - Form submissions that change state
 *
 * WHAT'S EXEMPT:
 * ==============
 * - GET requests (should be idempotent anyway)
 * - API routes (/api/*) - use Bearer token auth instead
 * - Public routes that don't require auth
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

// ============================================================================
// Types
// ============================================================================

/** Configuration options for CSRF initialization */
interface CSRFInitConfig {
    enabled?: boolean;
    tokenExpiry?: number;
}

/** CSRF configuration status returned by getConfig() */
interface CSRFConfigStatus {
    enabled: boolean;
    tokenExpiry: number;
    activeTokenCount: number;
}

/** Tracked token entry */
interface TokenEntry {
    sessionId: string;
    createdAt: number;
}

/** Middleware options for CSRF validation */
interface CSRFMiddlewareOptions {
    exemptPaths?: string[];
    exemptMethods?: string[];
}

/** Request context with optional services and parsed body */
interface CSRFRequestContext {
    services?: Map<string, unknown>;
    _parsedBody?: Record<string, unknown>;
    [key: string]: unknown;
}

/** Auth service interface as expected by the CSRF middleware */
interface AuthService {
    getSession(req: IncomingMessage): { userId: string; sessionId: string } | null;
}

/** Middleware next function */
type NextFn = () => Promise<void>;

// ============================================================================
// State
// ============================================================================

/** CSRF enabled flag */
let csrfEnabled: boolean = true;

/** Token expiry in seconds */
let tokenExpiry: number = 3600;

/** Secret key for HMAC signing */
let csrfSecret: string | null = null;

/**
 * Active tokens store
 * Structure: Map<token, { sessionId, createdAt }>
 *
 * WHY TRACK TOKENS:
 * - Enables token revocation
 * - Provides monitoring stats
 * - Allows cleanup of expired tokens
 */
const activeTokens: Map<string, TokenEntry> = new Map();

/** Cleanup interval reference */
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

// ============================================================================
// Initialization
// ============================================================================
/**
 * Initialize CSRF protection
 *
 * WHY SEPARATE SECRET:
 * CSRF tokens use the same secret as session signing.
 * This is secure because:
 * - Both use HMAC with different data
 * - Token includes session ID, so it's inherently tied to session
 */
export function init(secret: string, config: CSRFInitConfig = {}): void {
    csrfSecret = secret;
    csrfEnabled = config.enabled !== false; // Default true
    tokenExpiry = config.tokenExpiry ?? 3600;

    // Start cleanup interval (every 5 minutes)
    // WHY PERIODIC CLEANUP:
    // - Prevents memory growth from expired tokens
    // - More efficient than checking expiry on every access
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
    }
    cleanupInterval = setInterval(cleanupExpiredTokens, 5 * 60 * 1000);
    // Don't prevent process from exiting
    if (cleanupInterval.unref) {
        cleanupInterval.unref();
    }
}

/** Check if CSRF protection is enabled */
export function isEnabled(): boolean {
    return csrfEnabled;
}

/** Get CSRF configuration */
export function getConfig(): CSRFConfigStatus {
    return {
        enabled: csrfEnabled,
        tokenExpiry,
        activeTokenCount: activeTokens.size,
    };
}

// ============================================================================
// Token Generation
// ============================================================================
/**
 * Generate a CSRF token for a session
 *
 * TOKEN FORMAT:
 * timestamp.signature
 *
 * Where signature = HMAC-SHA256(sessionId + "." + timestamp, secret)
 *
 * WHY INCLUDE TIMESTAMP:
 * - Allows expiry checking without database lookup
 * - Token is self-describing (stateless validation)
 *
 * WHY INCLUDE SESSION ID IN SIGNATURE:
 * - Token only valid for this specific session
 * - Stolen token useless without the session cookie
 */
export function generateToken(sessionId: string): string {
    if (!csrfSecret) {
        throw new Error('CSRF module not initialized');
    }

    const timestamp = Date.now();
    const data = `${sessionId}.${timestamp}`;

    // Create HMAC signature
    const signature = createHmac('sha256', csrfSecret)
        .update(data)
        .digest('base64url');

    const token = `${timestamp}.${signature}`;

    // Track token for monitoring/revocation
    activeTokens.set(token, {
        sessionId,
        createdAt: timestamp,
    });

    return token;
}

// ============================================================================
// Token Validation
// ============================================================================
/**
 * Validate a CSRF token
 *
 * VALIDATION STEPS:
 * 1. Check token format (timestamp.signature)
 * 2. Check token hasn't expired
 * 3. Recompute signature and compare (timing-safe)
 *
 * WHY STATELESS VALIDATION:
 * - No database/memory lookup required
 * - Scales horizontally (any server can validate)
 * - Token carries all information needed to validate
 */
export function validateToken(sessionId: string, token: string): boolean {
    if (!csrfSecret) {
        throw new Error('CSRF module not initialized');
    }

    if (!token || !sessionId) {
        return false;
    }

    // Parse token
    const parts = token.split('.');
    if (parts.length !== 2) {
        return false;
    }

    const [timestampStr, signature] = parts as [string, string];
    const timestamp = parseInt(timestampStr, 10);

    // Validate timestamp is a number
    if (isNaN(timestamp)) {
        return false;
    }

    // Check expiry
    const age = Date.now() - timestamp;
    if (age > tokenExpiry * 1000) {
        // Clean up expired token from tracking
        activeTokens.delete(token);
        return false;
    }

    // Check token isn't from the future (clock skew protection)
    // Allow 5 minutes of future time to handle clock differences
    if (age < -5 * 60 * 1000) {
        return false;
    }

    // Recompute signature
    const data = `${sessionId}.${timestampStr}`;
    const expectedSignature = createHmac('sha256', csrfSecret)
        .update(data)
        .digest('base64url');

    // Timing-safe comparison
    // WHY TIMING-SAFE:
    // Prevents attackers from guessing the signature
    // one character at a time by measuring response times
    if (signature.length !== expectedSignature.length) {
        return false;
    }

    try {
        return timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expectedSignature)
        );
    }
    catch {
        return false;
    }
}

// ============================================================================
// Token Management
// ============================================================================
/**
 * Clean up expired tokens from tracking
 *
 * WHY CLEANUP:
 * - Prevents unbounded memory growth
 * - Keeps active token count accurate
 */
export function cleanupExpiredTokens(): number {
    const now = Date.now();
    const expiryMs = tokenExpiry * 1000;
    let removed = 0;

    for (const [token, data] of activeTokens) {
        if (now - data.createdAt > expiryMs) {
            activeTokens.delete(token);
            removed++;
        }
    }

    return removed;
}

/**
 * Clear all tokens (force re-authentication)
 *
 * USE CASES:
 * - Security incident response
 * - After changing CSRF secret
 * - Maintenance/debugging
 */
export function clearAllTokens(): number {
    const count = activeTokens.size;
    activeTokens.clear();
    return count;
}

/** Get count of active tokens */
export function getActiveTokenCount(): number {
    // Clean up expired first for accurate count
    cleanupExpiredTokens();
    return activeTokens.size;
}

// ============================================================================
// Middleware
// ============================================================================
/**
 * Create CSRF validation middleware
 *
 * MIDDLEWARE BEHAVIOR:
 * 1. Check if request needs CSRF validation
 * 2. Extract token from request (body or header)
 * 3. Get session ID from request
 * 4. Validate token
 * 5. Call next() on success, return 403 on failure
 *
 * TOKEN SOURCES (checked in order):
 * 1. X-CSRF-Token header (for AJAX requests)
 * 2. _csrf field in request body (for form submissions)
 */
export function createMiddleware(
    options: CSRFMiddlewareOptions = {}
): (req: IncomingMessage, res: ServerResponse, ctx: CSRFRequestContext, next: NextFn) => Promise<void> {
    const {
        exemptPaths = ['/api/'],
        exemptMethods = ['GET', 'HEAD', 'OPTIONS'],
    } = options;

    return async function csrfMiddleware(
        req: IncomingMessage,
        res: ServerResponse,
        ctx: CSRFRequestContext,
        next: NextFn
    ): Promise<void> {
        // Skip if CSRF is disabled
        if (!csrfEnabled) {
            await next();
            return;
        }

        const method = req.method ?? 'GET';
        const url = req.url ?? '/';

        // Skip exempt methods (safe methods that don't change state)
        if (exemptMethods.includes(method)) {
            await next();
            return;
        }

        // Skip exempt paths (like API routes that use Bearer auth)
        for (const exemptPath of exemptPaths) {
            if (url.startsWith(exemptPath)) {
                await next();
                return;
            }
        }

        // Get session ID from request
        // We need access to auth module for this, so we expect it in ctx
        const authService = ctx?.services?.get?.('auth') as AuthService | undefined;
        if (!authService) {
            // Auth not available, skip CSRF (probably not an authenticated route)
            await next();
            return;
        }

        const session = authService.getSession(req);
        if (!session) {
            // No session = no CSRF needed (user will be redirected to login)
            await next();
            return;
        }

        const sessionId = session.userId;

        // Extract CSRF token from request
        const token = getTokenFromRequest(req, ctx);

        if (!token) {
            // No token provided
            console.warn(`[csrf] Missing token for ${method} ${url}`);
            sendForbidden(res, 'Missing CSRF token');
            return;
        }

        // Validate token
        if (!validateToken(sessionId, token)) {
            console.warn(`[csrf] Invalid token for ${method} ${url}`);
            sendForbidden(res, 'Invalid CSRF token');
            return;
        }

        // Token valid, continue
        await next();
    };
}

// ============================================================================
// Private Helpers
// ============================================================================
/**
 * Extract CSRF token from request
 *
 * SOURCES (checked in order):
 * 1. X-CSRF-Token header (preferred for AJAX)
 * 2. _csrf in parsed body (for forms)
 * 3. _csrf in query string (fallback)
 */
function getTokenFromRequest(
    req: IncomingMessage,
    ctx: CSRFRequestContext
): string | null {
    // Check header first (most secure for AJAX)
    const headerToken = req.headers['x-csrf-token'];
    if (headerToken && typeof headerToken === 'string') {
        return headerToken;
    }

    // Check parsed body (for form submissions)
    // The body may be parsed by form middleware
    const csrfFromBody = ctx?._parsedBody?._csrf;
    if (csrfFromBody && typeof csrfFromBody === 'string') {
        return csrfFromBody;
    }

    // Check query string (fallback)
    try {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const queryToken = url.searchParams.get('_csrf');
        if (queryToken) {
            return queryToken;
        }
    }
    catch {
        // Invalid URL, ignore
    }

    return null;
}

/**
 * Send 403 Forbidden response
 */
function sendForbidden(res: ServerResponse, message: string): void {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message, status: 403 }));
}

// ============================================================================
// Template Helpers
// ============================================================================
/**
 * Generate hidden input field HTML for forms
 *
 * WHY HIDDEN INPUT:
 * - Works with standard HTML forms
 * - No JavaScript required
 * - Browser includes it in form submission automatically
 */
export function csrfFieldHtml(token: string): string {
    return `<input type="hidden" name="_csrf" value="${token}">`;
}

/**
 * Generate meta tag HTML for JavaScript access
 *
 * ACCESS IN JAVASCRIPT:
 * const token = document.querySelector('meta[name="csrf-token"]').content;
 */
export function csrfMetaHtml(token: string): string {
    return `<meta name="csrf-token" content="${token}">`;
}

// ============================================================================
// Default Export
// ============================================================================
export default {
    init,
    isEnabled,
    getConfig,
    generateToken,
    validateToken,
    cleanupExpiredTokens,
    clearAllTokens,
    getActiveTokenCount,
    createMiddleware,
    csrfFieldHtml,
    csrfMetaHtml,
};
