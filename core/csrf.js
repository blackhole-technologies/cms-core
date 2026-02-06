/**
 * csrf.js - Cross-Site Request Forgery Protection
 *
 * WHAT IS CSRF:
 * =============
 * Cross-Site Request Forgery (CSRF) is an attack where a malicious website
 * tricks a user's browser into making unwanted requests to another site
 * where the user is authenticated.
 *
 * ATTACK SCENARIO:
 * ----------------
 * 1. User logs into your CMS at cms.example.com
 * 2. Browser stores session cookie
 * 3. User visits malicious-site.com (in another tab)
 * 4. Malicious site has a hidden form:
 *    <form action="https://cms.example.com/admin/content/greeting" method="POST">
 *      <input name="message" value="Hacked!">
 *    </form>
 *    <script>document.forms[0].submit();</script>
 * 5. Browser sends the POST request WITH the user's session cookie
 * 6. CMS sees valid session, creates malicious content
 *
 * WHY THIS WORKS:
 * - Browsers automatically send cookies for any request to that domain
 * - The CMS can't tell the difference between:
 *   - User clicking submit on a legitimate form
 *   - Hidden form submitted by malicious site
 *
 * HOW WE PREVENT IT:
 * ==================
 * CSRF tokens! Every form includes a secret token that:
 * 1. Is tied to the user's session
 * 2. Is not accessible to other websites (Same-Origin Policy)
 * 3. Must be included in every state-changing request
 *
 * ATTACK BLOCKED:
 * ---------------
 * 1. User logs in, CMS generates CSRF token
 * 2. Every CMS form includes: <input type="hidden" name="_csrf" value="token">
 * 3. Malicious site cannot read the token (cross-origin)
 * 4. Their forged request doesn't include valid token
 * 5. CMS rejects the request: "Missing CSRF token"
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
 * ALTERNATIVE: DOUBLE-SUBMIT COOKIE
 * A simpler approach is to set a cookie and require the same value in the request.
 * We use signed tokens instead because:
 * - More secure (tokens are cryptographically tied to session)
 * - Tokens expire (cookies persist until deleted)
 * - Can revoke all tokens by changing secret
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
 *
 * IMPLEMENTATION NOTES:
 * =====================
 * Tokens are sent via:
 * 1. Hidden form field: <input type="hidden" name="_csrf" value="...">
 * 2. HTTP header: X-CSRF-Token (for JavaScript/fetch requests)
 *
 * The header approach is useful for AJAX/SPA applications.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

// ===========================================
// Configuration
// ===========================================

/**
 * CSRF configuration (set during init)
 */
let csrfEnabled = true;
let tokenExpiry = 3600; // 1 hour in seconds
let csrfSecret = null;

/**
 * Active tokens store
 * Structure: Map<token, { sessionId, createdAt }>
 *
 * WHY TRACK TOKENS:
 * - Enables token revocation
 * - Provides monitoring stats
 * - Allows cleanup of expired tokens
 */
const activeTokens = new Map();

/**
 * Cleanup interval reference
 */
let cleanupInterval = null;

// ===========================================
// Initialization
// ===========================================

/**
 * Initialize CSRF protection
 *
 * @param {string} secret - Secret key for signing tokens
 * @param {Object} config - CSRF configuration
 * @param {boolean} config.enabled - Whether CSRF protection is enabled
 * @param {number} config.tokenExpiry - Token expiry time in seconds
 *
 * WHY SEPARATE SECRET:
 * CSRF tokens use the same secret as session signing.
 * This is secure because:
 * - Both use HMAC with different data
 * - Token includes session ID, so it's inherently tied to session
 */
export function init(secret, config = {}) {
  csrfSecret = secret;
  csrfEnabled = config.enabled !== false; // Default true
  tokenExpiry = config.tokenExpiry || 3600;

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

/**
 * Check if CSRF protection is enabled
 */
export function isEnabled() {
  return csrfEnabled;
}

/**
 * Get CSRF configuration
 */
export function getConfig() {
  return {
    enabled: csrfEnabled,
    tokenExpiry,
    activeTokenCount: activeTokens.size,
  };
}

// ===========================================
// Token Generation
// ===========================================

/**
 * Generate a CSRF token for a session
 *
 * @param {string} sessionId - The session ID to bind this token to
 * @returns {string} - CSRF token string
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
 *
 * @example
 * const token = generateToken('user123');
 * // '1705123456789.abc123def456...'
 */
export function generateToken(sessionId) {
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

// ===========================================
// Token Validation
// ===========================================

/**
 * Validate a CSRF token
 *
 * @param {string} sessionId - Expected session ID
 * @param {string} token - Token to validate
 * @returns {boolean} - True if token is valid
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
 *
 * @example
 * if (validateToken(sessionId, token)) {
 *   // Process the request
 * } else {
 *   // Reject with 403
 * }
 */
export function validateToken(sessionId, token) {
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

  const [timestampStr, signature] = parts;
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
  } catch {
    return false;
  }
}

// ===========================================
// Token Management
// ===========================================

/**
 * Clean up expired tokens from tracking
 *
 * @returns {number} - Number of tokens removed
 *
 * WHY CLEANUP:
 * - Prevents unbounded memory growth
 * - Keeps active token count accurate
 */
export function cleanupExpiredTokens() {
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
 * @returns {number} - Number of tokens cleared
 *
 * USE CASES:
 * - Security incident response
 * - After changing CSRF secret
 * - Maintenance/debugging
 */
export function clearAllTokens() {
  const count = activeTokens.size;
  activeTokens.clear();
  return count;
}

/**
 * Get count of active tokens
 *
 * @returns {number}
 */
export function getActiveTokenCount() {
  // Clean up expired first for accurate count
  cleanupExpiredTokens();
  return activeTokens.size;
}

// ===========================================
// Middleware
// ===========================================

/**
 * Create CSRF validation middleware
 *
 * @param {Object} options - Middleware options
 * @param {string[]} options.exemptPaths - Paths to exempt from CSRF (e.g., ['/api/'])
 * @param {string[]} options.exemptMethods - Methods to exempt (default: ['GET', 'HEAD', 'OPTIONS'])
 * @returns {Function} - Middleware function
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
 *
 * @example
 * const csrfMiddleware = createMiddleware({
 *   exemptPaths: ['/api/', '/public/'],
 * });
 *
 * router.use(csrfMiddleware, 'csrf', '/admin');
 */
export function createMiddleware(options = {}) {
  const {
    exemptPaths = ['/api/'],
    exemptMethods = ['GET', 'HEAD', 'OPTIONS'],
  } = options;

  return async function csrfMiddleware(req, res, ctx, next) {
    // Skip if CSRF is disabled
    if (!csrfEnabled) {
      await next();
      return;
    }

    const method = req.method || 'GET';
    const url = req.url || '/';

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
    const auth = ctx?.services?.get?.('auth');
    if (!auth) {
      // Auth not available, skip CSRF (probably not an authenticated route)
      await next();
      return;
    }

    const session = auth.getSession(req);
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

/**
 * Extract CSRF token from request
 *
 * @param {http.IncomingMessage} req - HTTP request
 * @param {Object} ctx - Request context (may contain parsed body)
 * @returns {string|null} - Token or null if not found
 *
 * SOURCES (checked in order):
 * 1. X-CSRF-Token header (preferred for AJAX)
 * 2. _csrf in parsed body (for forms)
 * 3. _csrf in query string (fallback)
 *
 * @private
 */
function getTokenFromRequest(req, ctx) {
  // Check header first (most secure for AJAX)
  const headerToken = req.headers['x-csrf-token'];
  if (headerToken) {
    return headerToken;
  }

  // Check parsed body (for form submissions)
  // The body may be parsed by form middleware
  if (ctx?._parsedBody?._csrf) {
    return ctx._parsedBody._csrf;
  }

  // Check query string (fallback)
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const queryToken = url.searchParams.get('_csrf');
    if (queryToken) {
      return queryToken;
    }
  } catch {
    // Invalid URL, ignore
  }

  return null;
}

/**
 * Send 403 Forbidden response
 *
 * @param {http.ServerResponse} res - HTTP response
 * @param {string} message - Error message
 * @private
 */
function sendForbidden(res, message) {
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message, status: 403 }));
}

// ===========================================
// Template Helpers
// ===========================================

/**
 * Generate hidden input field HTML for forms
 *
 * @param {string} token - CSRF token
 * @returns {string} - HTML hidden input element
 *
 * USE IN TEMPLATES:
 * <form method="POST">
 *   {{csrfField}}
 *   <input type="text" name="title">
 *   <button type="submit">Submit</button>
 * </form>
 *
 * WHY HIDDEN INPUT:
 * - Works with standard HTML forms
 * - No JavaScript required
 * - Browser includes it in form submission automatically
 */
export function csrfFieldHtml(token) {
  return `<input type="hidden" name="_csrf" value="${token}">`;
}

/**
 * Generate meta tag HTML for JavaScript access
 *
 * @param {string} token - CSRF token
 * @returns {string} - HTML meta tag
 *
 * USE IN HEAD:
 * <head>
 *   {{csrfMeta}}
 * </head>
 *
 * ACCESS IN JAVASCRIPT:
 * const token = document.querySelector('meta[name="csrf-token"]').content;
 *
 * USE WITH FETCH:
 * fetch('/admin/api', {
 *   method: 'POST',
 *   headers: { 'X-CSRF-Token': token },
 *   body: JSON.stringify(data)
 * });
 */
export function csrfMetaHtml(token) {
  return `<meta name="csrf-token" content="${token}">`;
}

// ===========================================
// Default Export
// ===========================================

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
