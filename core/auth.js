/**
 * auth.js - Session Management and Authentication
 *
 * WHY THIS EXISTS:
 * The CMS needs to protect admin routes from unauthorized access.
 * This module provides:
 * - Session management via signed cookies
 * - Password hashing for secure storage
 * - Session verification for protected routes
 * - Active session tracking for invalidation
 *
 * DESIGN DECISIONS:
 * =================
 *
 * 1. SIGNED COOKIES (not JWTs or server-side sessions)
 *    Why cookies:
 *    - Browser handles storage and transmission automatically
 *    - HttpOnly flag prevents XSS attacks from reading the cookie
 *    - Works without JavaScript on the client
 *
 *    Why signed (not encrypted):
 *    - We need to verify the cookie wasn't tampered with
 *    - The session data (just userId) isn't secret
 *    - Signing is simpler and sufficient for our needs
 *
 *    Cookie format: sessionId.userId.timestamp.signature
 *    - sessionId: Unique identifier for this session
 *    - userId: The logged-in user's ID
 *    - timestamp: When the session was created (for expiry)
 *    - signature: HMAC of "sessionId.userId.timestamp" using secret key
 *
 * 2. SESSION TRACKING
 *    Active sessions are tracked in memory for:
 *    - Session invalidation on role/password changes
 *    - Listing active sessions for admin
 *    - Forced logout capability
 *
 * 3. SIMPLE SECRET KEY
 *    The session secret comes from config (site.json).
 *    - In development: use a default value
 *    - In production: MUST be changed to a secure random string
 *    - If secret changes, all existing sessions are invalidated
 *
 * 4. NO EXTERNAL DEPENDENCIES
 *    Using Node's built-in crypto module:
 *    - createHmac for cookie signing
 *    - scryptSync for password hashing (password-specific KDF)
 *    - randomBytes for cryptographically secure salt generation
 *    - timingSafeEqual for secure comparison
 *    - randomUUID for session IDs
 *
 * SECURITY NOTES:
 * ===============
 * - Passwords are hashed with scrypt (Node's built-in KDF, zero-deps)
 * - Intentionally slow to resist brute force attacks
 * - Session cookies are HttpOnly (no JS access)
 * - Cookies should also be Secure in production (HTTPS only)
 *
 * WHAT THIS DOESN'T DO:
 * ====================
 * - Password complexity requirements
 * - Session refresh/sliding expiration
 */

import { createHmac, createHash, scryptSync, randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as csrf from './csrf.js';

/**
 * Session configuration
 */
const SESSION_COOKIE_NAME = 'cms_session';
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

/**
 * Secret key for signing (set by init)
 */
let sessionSecret = null;

/**
 * Active sessions tracking
 * Map<sessionId, { userId, createdAt, lastActivity }>
 *
 * WHY FILE-BACKED:
 * Sessions are persisted to a JSON file so they survive server restarts.
 * The in-memory Map is the primary store for fast lookups; the file
 * is written after each mutation (create/destroy/invalidate).
 */
const activeSessions = new Map();

/**
 * Path to sessions persistence file
 */
let sessionsFilePath = null;

/**
 * Debounce timer for session persistence writes
 */
let persistTimer = null;

/**
 * Initialize auth module with secret key
 *
 * @param {string} secret - Secret key for signing cookies
 * @param {string} baseDir - Base directory for the CMS (for session file storage)
 *
 * WHY INIT:
 * - Secret comes from config, which loads during boot
 * - Can't access config at module load time
 * - Allows testing with different secrets
 */
export function init(secret, baseDir = null) {
  if (!secret || secret.length < 16) {
    console.warn('[auth] Warning: Session secret is too short. Use at least 16 characters.');
  }
  sessionSecret = secret;

  // Set up file-based session persistence
  if (baseDir) {
    const sessionsDir = join(baseDir, 'content', '.sessions');
    if (!existsSync(sessionsDir)) {
      mkdirSync(sessionsDir, { recursive: true });
    }
    sessionsFilePath = join(sessionsDir, 'active.json');
    loadSessions();
  }
}

/**
 * Load sessions from disk
 * Called once during init to restore sessions from previous run.
 */
function loadSessions() {
  if (!sessionsFilePath || !existsSync(sessionsFilePath)) return;

  try {
    const data = JSON.parse(readFileSync(sessionsFilePath, 'utf-8'));
    const now = Date.now();

    // Restore non-expired sessions
    for (const [sessionId, sessionData] of Object.entries(data)) {
      const age = now - sessionData.createdAt;
      if (age < SESSION_MAX_AGE) {
        activeSessions.set(sessionId, sessionData);
      }
    }

    if (activeSessions.size > 0) {
      console.log(`[auth] Restored ${activeSessions.size} session(s) from disk`);
    }
  } catch (error) {
    console.warn(`[auth] Failed to load sessions: ${error.message}`);
  }
}

/**
 * Persist sessions to disk (debounced)
 * Writes are debounced by 1 second to avoid excessive I/O.
 */
function persistSessions() {
  if (!sessionsFilePath) return;

  if (persistTimer) {
    clearTimeout(persistTimer);
  }

  persistTimer = setTimeout(() => {
    try {
      const data = Object.fromEntries(activeSessions);
      writeFileSync(sessionsFilePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.warn(`[auth] Failed to persist sessions: ${error.message}`);
    }
    persistTimer = null;
  }, 1000);

  // Don't prevent process from exiting
  if (persistTimer?.unref) {
    persistTimer.unref();
  }
}

/**
 * Create a signature for session data
 *
 * @param {string} data - Data to sign (sessionId.userId.timestamp)
 * @returns {string} - Base64-encoded HMAC signature
 *
 * WHY HMAC:
 * HMAC (Hash-based Message Authentication Code) ensures:
 * - Data hasn't been tampered with
 * - Only someone with the secret could have created it
 *
 * We use SHA-256 for the HMAC algorithm.
 */
function sign(data) {
  return createHmac('sha256', sessionSecret)
    .update(data)
    .digest('base64url'); // URL-safe base64
}

/**
 * Verify a signature matches the data
 *
 * @param {string} data - Original data
 * @param {string} signature - Signature to verify
 * @returns {boolean} - True if signature is valid
 *
 * WHY TIMING-SAFE COMPARISON:
 * Regular string comparison (===) can leak timing information.
 * An attacker could measure response times to guess the signature
 * one character at a time. timingSafeEqual takes constant time
 * regardless of where the mismatch occurs.
 */
function verify(data, signature) {
  const expected = sign(data);

  // Both must be same length for timingSafeEqual
  if (signature.length !== expected.length) {
    return false;
  }

  try {
    return timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

/**
 * Create a session for a user
 *
 * @param {http.ServerResponse} res - Response to set cookie on
 * @param {string} userId - User ID to store in session
 * @returns {string} - Session ID
 *
 * COOKIE FORMAT:
 * cms_session=sessionId.userId.timestamp.signature
 *
 * Example:
 * cms_session=abc-123.user456.1705123456789.dGhpcyBpcyBhIHNpZ25hdHVyZQ
 *
 * COOKIE OPTIONS:
 * - HttpOnly: JavaScript can't read it (XSS protection)
 * - Path=/: Cookie sent for all paths
 * - SameSite=Lax: Some CSRF protection
 * - Max-Age: Cookie expires after this many seconds
 */
export function createSession(res, userId) {
  const sessionId = randomUUID();
  const timestamp = Date.now();
  const data = `${sessionId}.${userId}.${timestamp}`;
  const signature = sign(data);
  const cookieValue = `${data}.${signature}`;

  // Track session and persist to disk
  activeSessions.set(sessionId, {
    userId,
    createdAt: timestamp,
    lastActivity: timestamp,
  });
  persistSessions();

  // Calculate max age in seconds
  const maxAgeSeconds = Math.floor(SESSION_MAX_AGE / 1000);

  // Set the cookie
  const cookieOptions = [
    `${SESSION_COOKIE_NAME}=${cookieValue}`,
    'HttpOnly',           // No JavaScript access
    'Path=/',             // Available for all paths
    'SameSite=Lax',       // Basic CSRF protection
    `Max-Age=${maxAgeSeconds}`, // Expiration
  ];

  res.setHeader('Set-Cookie', cookieOptions.join('; '));

  return sessionId;
}

/**
 * Destroy a session (logout)
 *
 * @param {http.ServerResponse} res - Response to clear cookie on
 * @param {http.IncomingMessage} [req] - Request to get session ID from
 *
 * HOW TO DELETE A COOKIE:
 * Set the same cookie with:
 * - Empty value
 * - Max-Age=0 or Expires in the past
 *
 * Browser will remove the cookie.
 */
export function destroySession(res, req) {
  // If request provided, remove from tracking
  if (req) {
    const sessionData = parseSessionCookie(req);
    if (sessionData?.sessionId) {
      activeSessions.delete(sessionData.sessionId);
      persistSessions();
    }
  }

  const cookieOptions = [
    `${SESSION_COOKIE_NAME}=`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    'Max-Age=0', // Expire immediately
  ];

  res.setHeader('Set-Cookie', cookieOptions.join('; '));
}

/**
 * Parse session cookie from request (internal helper)
 *
 * @param {http.IncomingMessage} req - Request to read cookie from
 * @returns {{ sessionId, userId, timestamp, signature } | null}
 */
function parseSessionCookie(req) {
  // Get Cookie header
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) {
    return null;
  }

  // Parse cookies (format: "name1=value1; name2=value2")
  const cookies = {};
  for (const part of cookieHeader.split(';')) {
    const [name, ...valueParts] = part.trim().split('=');
    if (name) {
      cookies[name] = valueParts.join('='); // Value might contain =
    }
  }

  // Get our session cookie
  const sessionCookie = cookies[SESSION_COOKIE_NAME];
  if (!sessionCookie) {
    return null;
  }

  // Parse cookie value: sessionId.userId.timestamp.signature
  const parts = sessionCookie.split('.');
  if (parts.length !== 4) {
    return null;
  }

  const [sessionId, userId, timestampStr, signature] = parts;
  const timestamp = parseInt(timestampStr, 10);

  if (isNaN(timestamp)) {
    return null;
  }

  return { sessionId, userId, timestamp, timestampStr, signature };
}

/**
 * Get session from request
 *
 * @param {http.IncomingMessage} req - Request to read cookie from
 * @returns {{ userId: string, sessionId: string } | null} - Session data or null if invalid
 *
 * VALIDATION STEPS:
 * 1. Parse Cookie header to find our session cookie
 * 2. Split cookie value into sessionId.userId.timestamp.signature
 * 3. Verify signature matches sessionId.userId.timestamp
 * 4. Check timestamp hasn't expired
 * 5. Verify session exists in active sessions map
 * 6. Return session data or null
 */
export function getSession(req) {
  const parsed = parseSessionCookie(req);
  if (!parsed) {
    return null;
  }

  const { sessionId, userId, timestamp, timestampStr, signature } = parsed;

  // Verify signature
  const data = `${sessionId}.${userId}.${timestampStr}`;
  if (!verify(data, signature)) {
    return null;
  }

  // Check expiration
  const age = Date.now() - timestamp;
  if (age > SESSION_MAX_AGE) {
    // Clean up expired session from tracking
    activeSessions.delete(sessionId);
    return null;
  }

  // Verify session is still active (not invalidated)
  if (!activeSessions.has(sessionId)) {
    return null;
  }

  // Update last activity
  const sessionData = activeSessions.get(sessionId);
  sessionData.lastActivity = Date.now();

  // Session is valid
  return { userId, sessionId };
}

/**
 * Invalidate all sessions for a user
 *
 * @param {string} userId - User ID to invalidate sessions for
 * @returns {number} - Number of sessions invalidated
 *
 * USE CASES:
 * - User's role is changed
 * - User's password is changed (invalidate other sessions)
 * - User is deleted
 * - Admin forces logout
 */
export function invalidateSessions(userId) {
  let count = 0;

  for (const [sessionId, data] of activeSessions.entries()) {
    if (data.userId === userId) {
      activeSessions.delete(sessionId);
      count++;
    }
  }

  if (count > 0) persistSessions();
  return count;
}

/**
 * Invalidate all sessions for a user except one
 *
 * @param {string} userId - User ID to invalidate sessions for
 * @param {string} exceptSessionId - Session ID to keep active
 * @returns {number} - Number of sessions invalidated
 *
 * USE CASE:
 * Password change - invalidate other sessions but keep current one
 */
export function invalidateOtherSessions(userId, exceptSessionId) {
  let count = 0;

  for (const [sessionId, data] of activeSessions.entries()) {
    if (data.userId === userId && sessionId !== exceptSessionId) {
      activeSessions.delete(sessionId);
      count++;
    }
  }

  if (count > 0) persistSessions();
  return count;
}

/**
 * Get count of active sessions for a user
 *
 * @param {string} userId - User ID
 * @returns {number} - Number of active sessions
 */
export function getActiveSessionCount(userId) {
  let count = 0;

  for (const data of activeSessions.values()) {
    if (data.userId === userId) {
      count++;
    }
  }

  return count;
}

/**
 * Get all active sessions (for admin)
 *
 * @returns {Array<{ sessionId, userId, createdAt, lastActivity }>}
 */
export function getAllSessions() {
  const sessions = [];

  for (const [sessionId, data] of activeSessions.entries()) {
    sessions.push({
      sessionId,
      userId: data.userId,
      createdAt: data.createdAt,
      lastActivity: data.lastActivity,
    });
  }

  return sessions;
}

/**
 * Get session statistics grouped by user
 *
 * @returns {Map<userId, { count, lastActivity }>}
 */
export function getSessionStats() {
  const stats = new Map();

  for (const data of activeSessions.values()) {
    if (!stats.has(data.userId)) {
      stats.set(data.userId, { count: 0, lastActivity: 0 });
    }

    const userStats = stats.get(data.userId);
    userStats.count++;
    if (data.lastActivity > userStats.lastActivity) {
      userStats.lastActivity = data.lastActivity;
    }
  }

  return stats;
}

/**
 * Hash a password for storage
 *
 * @param {string} password - Plain text password
 * @returns {string} - Hashed password
 *
 * WHY SCRYPT:
 * Node's built-in crypto.scryptSync is a password-hashing KDF that:
 * - Is specifically designed for password hashing (unlike SHA-256)
 * - Is intentionally slow to resist brute force attacks
 * - Has configurable cost parameters (N, r, p)
 * - Includes salt to prevent rainbow table attacks
 * - Requires zero external dependencies
 *
 * PARAMETERS:
 * - N=16384 (cost): CPU/memory cost parameter (2^14)
 * - r=8: block size parameter
 * - p=1: parallelization parameter
 * - keylen=64: output hash length in bytes
 *
 * FORMAT: scrypt:salt:hash
 * The "scrypt:" prefix enables backwards-compatible migration
 * from the old SHA-256 format (salt:hash without prefix).
 */
export function hashPassword(password) {
  // Generate a cryptographically secure random salt (16 bytes)
  const salt = randomBytes(16).toString('hex');

  // Hash password with scrypt
  const hash = scryptSync(password, salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
  }).toString('hex');

  // Return scrypt:salt:hash format
  return `scrypt:${salt}:${hash}`;
}

/**
 * Verify a password against a hash
 *
 * @param {string} password - Plain text password to check
 * @param {string} storedHash - Hash from database (scrypt:salt:hash or legacy salt:hash format)
 * @returns {boolean} - True if password matches
 *
 * BACKWARDS COMPATIBILITY:
 * Supports both new scrypt format (scrypt:salt:hash) and legacy
 * SHA-256 format (salt:hash) so existing users can still log in.
 * Passwords are upgraded to scrypt on next hash (e.g., password change).
 */
export function verifyPassword(password, storedHash) {
  // Detect format by prefix
  if (storedHash.startsWith('scrypt:')) {
    // New scrypt format: scrypt:salt:hash
    const parts = storedHash.split(':');
    if (parts.length !== 3) return false;

    const [, salt, originalHash] = parts;

    const checkHash = scryptSync(password, salt, 64, {
      N: 16384,
      r: 8,
      p: 1,
    }).toString('hex');

    if (checkHash.length !== originalHash.length) return false;

    try {
      return timingSafeEqual(
        Buffer.from(checkHash),
        Buffer.from(originalHash)
      );
    } catch {
      return false;
    }
  }

  // Legacy SHA-256 format: salt:hash (for backwards compatibility)
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;

  const [salt, originalHash] = parts;

  const checkHash = createHash('sha256')
    .update(salt + password)
    .digest('hex');

  if (checkHash.length !== originalHash.length) return false;

  try {
    return timingSafeEqual(
      Buffer.from(checkHash),
      Buffer.from(originalHash)
    );
  } catch {
    return false;
  }
}

/**
 * Check if auth module is initialized
 */
export function isInitialized() {
  return sessionSecret !== null;
}

// ==========================================
// ROLES AND PERMISSIONS
// ==========================================

/**
 * Default role permissions
 *
 * PERMISSION NAMING CONVENTION:
 * resource.action (e.g., content.create, users.delete)
 *
 * ROLE HIERARCHY:
 * - admin: Full access (wildcard *)
 * - editor: Content management
 * - viewer: Read-only access
 *
 * WHY NOT DATABASE-DRIVEN:
 * For simplicity, permissions are hardcoded.
 * In a larger system, you'd store these in config or database.
 */
const ROLE_PERMISSIONS = {
  admin: ['*'], // Wildcard - all permissions
  editor: [
    'content.create',
    'content.read',
    'content.update',
    'content.delete',
  ],
  viewer: [
    'content.read',
  ],
};

/**
 * Check if a user has a specific permission
 *
 * @param {Object} user - User object with role property
 * @param {string} permission - Permission to check (e.g., 'content.create')
 * @returns {boolean} - True if user has permission
 *
 * WILDCARD SUPPORT:
 * Admin role has '*' which grants all permissions.
 *
 * PERMISSION FORMAT:
 * 'resource.action' - e.g., 'content.create', 'users.delete'
 *
 * @example
 * hasPermission({ role: 'editor' }, 'content.create') // true
 * hasPermission({ role: 'viewer' }, 'content.create') // false
 * hasPermission({ role: 'admin' }, 'anything.here')   // true (wildcard)
 */
export function hasPermission(user, permission) {
  if (!user || !user.role) {
    return false;
  }

  const permissions = ROLE_PERMISSIONS[user.role];
  if (!permissions) {
    return false;
  }

  // Check for wildcard (admin)
  if (permissions.includes('*')) {
    return true;
  }

  // Check for specific permission
  return permissions.includes(permission);
}

/**
 * Check if a user has a specific role
 *
 * @param {Object} user - User object with role property
 * @param {string} role - Role to check (e.g., 'admin')
 * @returns {boolean} - True if user has role
 *
 * @example
 * hasRole({ role: 'admin' }, 'admin')   // true
 * hasRole({ role: 'editor' }, 'admin')  // false
 */
export function hasRole(user, role) {
  if (!user || !user.role) {
    return false;
  }
  return user.role === role;
}

/**
 * Get all permissions for a role
 *
 * @param {string} role - Role name
 * @returns {string[]} - Array of permissions
 */
export function getRolePermissions(role) {
  return ROLE_PERMISSIONS[role] || [];
}

/**
 * Get all defined roles
 *
 * @returns {string[]} - Array of role names
 */
export function getRoles() {
  return Object.keys(ROLE_PERMISSIONS);
}

// ==========================================
// API TOKENS
// ==========================================

/**
 * API Token configuration
 *
 * TOKEN FORMAT:
 * Base64-encoded JSON: { userId, timestamp, signature }
 *
 * WHY BASE64 JSON (not JWT):
 * - Simpler implementation
 * - No external dependencies
 * - JWT is overkill for our needs
 * - We control both creation and verification
 */
const TOKEN_PREFIX = 'cms_';

/**
 * Generate an API token for a user
 *
 * @param {string} userId - User ID to embed in token
 * @returns {string} - API token string
 *
 * TOKEN FORMAT:
 * cms_<base64-encoded-json>
 *
 * The JSON contains:
 * - userId: User ID
 * - timestamp: Creation time
 * - signature: HMAC of userId.timestamp
 *
 * WHY PREFIX:
 * Makes tokens easily identifiable.
 * Helps with log scrubbing and secret detection.
 */
export function generateToken(userId) {
  const timestamp = Date.now();
  const data = `${userId}.${timestamp}`;
  const signature = sign(data);

  const payload = {
    userId,
    timestamp,
    signature,
  };

  // Encode as base64
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');

  return `${TOKEN_PREFIX}${encoded}`;
}

/**
 * Verify an API token
 *
 * @param {string} token - API token to verify
 * @returns {{ userId: string } | null} - Token data or null if invalid
 *
 * VALIDATION STEPS:
 * 1. Check token prefix
 * 2. Decode base64 JSON
 * 3. Verify signature
 * 4. Return userId (no expiration for API tokens)
 *
 * WHY NO EXPIRATION:
 * API tokens are long-lived by design.
 * Users can revoke them manually.
 * This matches common API patterns (GitHub, Stripe, etc.)
 */
export function verifyToken(token) {
  // Check prefix
  if (!token || !token.startsWith(TOKEN_PREFIX)) {
    return null;
  }

  // Remove prefix and decode
  const encoded = token.slice(TOKEN_PREFIX.length);

  let payload;
  try {
    const decoded = Buffer.from(encoded, 'base64url').toString('utf-8');
    payload = JSON.parse(decoded);
  } catch {
    return null;
  }

  // Validate payload structure
  if (!payload.userId || !payload.timestamp || !payload.signature) {
    return null;
  }

  // Verify signature
  const data = `${payload.userId}.${payload.timestamp}`;
  if (!verify(data, payload.signature)) {
    return null;
  }

  // Token is valid
  return { userId: payload.userId };
}

/**
 * Get authentication from request (session OR token)
 *
 * @param {http.IncomingMessage} req - Request object
 * @returns {{ userId: string, method: 'session' | 'token', sessionId?: string } | null}
 *
 * CHECKS IN ORDER:
 * 1. Session cookie (for browser requests)
 * 2. Authorization: Bearer <token> header (for API requests)
 *
 * WHY BOTH:
 * - Browsers use session cookies automatically
 * - CLI/scripts use Bearer tokens
 * - Same endpoints can serve both
 *
 * @example
 * // Browser request with cookie
 * getAuthFromRequest(req) // { userId: 'abc', method: 'session', sessionId: '...' }
 *
 * // API request with token
 * // Authorization: Bearer cms_...
 * getAuthFromRequest(req) // { userId: 'abc', method: 'token' }
 */
export function getAuthFromRequest(req) {
  // Try session cookie first
  const session = getSession(req);
  if (session) {
    return { userId: session.userId, method: 'session', sessionId: session.sessionId };
  }

  // Try Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7); // Remove 'Bearer ' prefix
    const tokenData = verifyToken(token);
    if (tokenData) {
      return { userId: tokenData.userId, method: 'token' };
    }
  }

  return null;
}

// ==========================================
// CSRF PROTECTION
// ==========================================

/**
 * Initialize CSRF protection
 *
 * @param {Object} csrfConfig - CSRF configuration
 * @param {boolean} csrfConfig.enabled - Whether CSRF is enabled
 * @param {number} csrfConfig.tokenExpiry - Token expiry in seconds
 *
 * WHY IN AUTH MODULE:
 * CSRF protection is tightly coupled with session management.
 * Tokens are tied to session IDs for security.
 */
export function initCSRF(csrfConfig = {}) {
  if (!sessionSecret) {
    throw new Error('Auth module must be initialized before CSRF');
  }
  csrf.init(sessionSecret, csrfConfig);
}

/**
 * Get CSRF token for current session
 *
 * @param {http.IncomingMessage} req - HTTP request
 * @returns {string|null} - CSRF token or null if no session
 *
 * USE CASE:
 * Call this to get a token for embedding in forms/pages.
 * Token is tied to the current user's session.
 *
 * @example
 * const token = getCSRFToken(req);
 * // Use in template: <input type="hidden" name="_csrf" value="${token}">
 */
export function getCSRFToken(req) {
  if (!csrf.isEnabled()) {
    return null;
  }

  const session = getSession(req);
  if (!session) {
    return null;
  }

  return csrf.generateToken(session.userId);
}

/**
 * Validate CSRF token from request
 *
 * @param {http.IncomingMessage} req - HTTP request
 * @param {string} token - Token to validate
 * @returns {boolean} - True if token is valid
 *
 * USE CASE:
 * Call this in route handlers to validate submitted tokens.
 */
export function validateCSRFToken(req, token) {
  if (!csrf.isEnabled()) {
    return true; // CSRF disabled, always valid
  }

  const session = getSession(req);
  if (!session) {
    return false;
  }

  return csrf.validateToken(session.userId, token);
}

/**
 * Get CSRF token from request body/header
 *
 * @param {http.IncomingMessage} req - HTTP request
 * @param {Object} ctx - Request context (may contain parsed body)
 * @returns {string|null} - Token or null
 *
 * SOURCES (checked in order):
 * 1. X-CSRF-Token header (for AJAX)
 * 2. _csrf in parsed body (for forms)
 * 3. _csrf in query string (fallback)
 */
export function extractCSRFToken(req, ctx) {
  // Check header first (most secure for AJAX)
  const headerToken = req.headers['x-csrf-token'];
  if (headerToken) {
    return headerToken;
  }

  // Check parsed body (for form submissions)
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
 * CSRF validation middleware
 *
 * @param {Object} options - Middleware options
 * @param {string[]} options.exemptPaths - Paths to skip CSRF check
 * @param {string[]} options.exemptMethods - Methods to skip (default: GET, HEAD, OPTIONS)
 * @returns {Function} - Middleware function
 *
 * USE CASE:
 * Apply to admin routes that accept POST/PUT/DELETE requests.
 *
 * @example
 * router.use(requireCSRF(), 'csrf', '/admin');
 */
export function requireCSRF(options = {}) {
  const {
    exemptPaths = ['/api/'],
    exemptMethods = ['GET', 'HEAD', 'OPTIONS'],
  } = options;

  return async function csrfMiddleware(req, res, ctx, next) {
    // Skip if CSRF is disabled
    if (!csrf.isEnabled()) {
      await next();
      return;
    }

    const method = req.method || 'GET';
    const url = req.url || '/';

    // Skip exempt methods (safe methods)
    if (exemptMethods.includes(method)) {
      await next();
      return;
    }

    // Skip exempt paths
    for (const exemptPath of exemptPaths) {
      if (url.startsWith(exemptPath)) {
        await next();
        return;
      }
    }

    // Get session
    const session = getSession(req);
    if (!session) {
      // No session = no CSRF needed (will redirect to login)
      await next();
      return;
    }

    // Extract and validate token
    const token = extractCSRFToken(req, ctx);

    if (!token) {
      console.warn(`[csrf] Missing token for ${method} ${url}`);
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing CSRF token', status: 403 }));
      return;
    }

    if (!csrf.validateToken(session.userId, token)) {
      console.warn(`[csrf] Invalid token for ${method} ${url}`);
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid CSRF token', status: 403 }));
      return;
    }

    // Token valid, continue
    await next();
  };
}

/**
 * Get CSRF status and statistics
 *
 * @returns {Object} - CSRF configuration and stats
 */
export function getCSRFStatus() {
  return csrf.getConfig();
}

/**
 * Clear all CSRF tokens (force re-auth)
 *
 * @returns {number} - Number of tokens cleared
 */
export function clearCSRFTokens() {
  return csrf.clearAllTokens();
}

/**
 * SESSION COOKIE LIFECYCLE:
 *
 * 1. USER LOGS IN:
 *    - POST /login with username/password
 *    - Server verifies credentials
 *    - Server calls createSession(res, userId)
 *    - Response includes Set-Cookie header
 *    - Browser stores the cookie
 *    - Session tracked in activeSessions map
 *
 * 2. USER MAKES REQUEST:
 *    - Browser automatically includes Cookie header
 *    - Server calls getSession(req)
 *    - Server verifies signature, expiration, and active status
 *    - If valid, request proceeds with user context
 *    - If invalid (expired or invalidated), redirect to login
 *
 * 3. USER LOGS OUT:
 *    - GET /logout
 *    - Server calls destroySession(res, req)
 *    - Session removed from activeSessions map
 *    - Response includes Set-Cookie with Max-Age=0
 *    - Browser deletes the cookie
 *
 * 4. SESSION INVALIDATED:
 *    - Admin changes user's role/password
 *    - invalidateSessions(userId) called
 *    - All sessions for that user removed from map
 *    - User's next request fails getSession() validation
 *    - User redirected to login
 *
 * 5. SESSION EXPIRES:
 *    - After 24 hours, getSession() returns null
 *    - User must log in again
 *    - Browser may also expire the cookie (Max-Age)
 */
