/**
 * auth.ts - Session Management and Authentication
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
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as csrf from './csrf.ts';

// ============================================================================
// Types
// ============================================================================

/** Session data stored in the active sessions map */
interface SessionData {
    userId: string;
    createdAt: number;
    lastActivity: number;
}

/** Parsed session cookie components */
interface ParsedSessionCookie {
    sessionId: string;
    userId: string;
    timestamp: number;
    timestampStr: string;
    signature: string;
}

/** Session returned to callers */
interface Session {
    userId: string;
    sessionId: string;
}

/** Auth result from getAuthFromRequest */
interface AuthResult {
    userId: string;
    method: 'session' | 'token';
    sessionId?: string;
}

/** Token verification result */
interface TokenData {
    userId: string;
}

/** Token payload encoded in the API token */
interface TokenPayload {
    userId: string;
    timestamp: number;
    signature: string;
}

/** User session stats per user */
interface UserSessionStats {
    count: number;
    lastActivity: number;
}

/** Session info returned by getAllSessions */
interface SessionInfo {
    sessionId: string;
    userId: string;
    createdAt: number;
    lastActivity: number;
}

/** CSRF middleware options */
interface CSRFOptions {
    exemptPaths?: string[];
    exemptMethods?: string[];
}

/** CSRF init config */
interface CSRFConfig {
    enabled?: boolean;
    tokenExpiry?: number;
}

/** Request context for CSRF extraction */
interface CSRFRequestContext {
    _parsedBody?: Record<string, unknown>;
    [key: string]: unknown;
}

/** Role permissions map type */
interface RolePermissionsMap {
    [role: string]: string[];
}

/** User object for permission checks */
interface UserForPermission {
    role?: string;
    [key: string]: unknown;
}

/** Database pool interface for session persistence */
interface DbPool {
    query(sql: string, params: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
    simpleQuery(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
}

/** Database row for session data */
interface SessionDbRow {
    session_id: string;
    user_id: string;
    created_at: string;
    last_activity: string;
}

// ============================================================================
// State
// ============================================================================
/**
 * Session configuration
 */
const SESSION_COOKIE_NAME: string = 'cms_session';
const SESSION_MAX_AGE: number = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

/**
 * Secret key for signing (set by init)
 */
let sessionSecret: string | null = null;

/**
 * Active sessions tracking
 * Map<sessionId, { userId, createdAt, lastActivity }>
 *
 * WHY FILE-BACKED:
 * Sessions are persisted to a JSON file so they survive server restarts.
 * The in-memory Map is the primary store for fast lookups; the file
 * is written after each mutation (create/destroy/invalidate).
 *
 * WHY ALSO POSTGRES:
 * When config/database.json is enabled, sessions are stored in the
 * `sessions` table. The in-memory Map remains the fast-path for
 * lookups. DB writes happen asynchronously after Map mutations.
 */
const activeSessions: Map<string, SessionData> = new Map();

/**
 * Path to sessions persistence file
 */
let sessionsFilePath: string | null = null;

/**
 * Database pool for PostgreSQL session persistence.
 * Set by initDb() when database is enabled. When non-null, sessions
 * are stored in `sessions` table instead of active.json.
 */
let dbPool: DbPool | null = null;

/**
 * Debounce timer for session persistence writes
 */
let persistTimer: ReturnType<typeof setTimeout> | null = null;

// ============================================================================
// Initialization
// ============================================================================
/**
 * Initialize auth module with secret key
 *
 * WHY INIT:
 * - Secret comes from config, which loads during boot
 * - Can't access config at module load time
 * - Allows testing with different secrets
 */
export function init(secret: string, baseDir: string | null = null): void {
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
 * Set database pool for PostgreSQL session persistence.
 * Called from boot.js when database.enabled is true.
 */
export async function initDb(pool: DbPool): Promise<void> {
    dbPool = pool;
    await loadSessionsFromDb();
}

// ============================================================================
// Session Persistence (Private)
// ============================================================================
/**
 * Load sessions from disk
 * Called once during init to restore sessions from previous run.
 */
function loadSessions(): void {
    if (!sessionsFilePath || !existsSync(sessionsFilePath)) return;

    try {
        const data = JSON.parse(readFileSync(sessionsFilePath, 'utf-8')) as Record<string, SessionData>;
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
    }
    catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[auth] Failed to load sessions: ${message}`);
    }
}

/**
 * Load sessions from PostgreSQL.
 * Populates the in-memory Map from the sessions table,
 * skipping expired rows (and cleaning them up).
 */
async function loadSessionsFromDb(): Promise<void> {
    if (!dbPool) return;

    try {
        // Clean up expired sessions in one pass
        await dbPool.simpleQuery(`DELETE FROM sessions WHERE expires_at < NOW()`);
        const result = await dbPool.simpleQuery(
            `SELECT session_id, user_id, created_at, last_activity FROM sessions`
        );

        for (const row of result.rows) {
            const r = row as unknown as SessionDbRow;
            activeSessions.set(r.session_id, {
                userId: r.user_id,
                createdAt: new Date(r.created_at).getTime(),
                lastActivity: new Date(r.last_activity).getTime(),
            });
        }

        if (activeSessions.size > 0) {
            console.log(`[auth] Restored ${activeSessions.size} session(s) from database`);
        }
    }
    catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[auth] Failed to load sessions from database: ${message}`);
    }
}

/**
 * Persist sessions to disk or database (debounced).
 * Writes are debounced by 1 second to avoid excessive I/O.
 *
 * WHY DEBOUNCE FOR BOTH:
 * Multiple rapid session changes (e.g. bulk invalidation) would
 * cause many writes. Debouncing coalesces them into one.
 * For Postgres, individual session mutations also write directly
 * (see persistSessionToDb), so this is a safety net.
 */
function persistSessions(): void {
    // When database is active, individual mutations handle their own persistence
    if (dbPool) return;
    if (!sessionsFilePath) return;

    if (persistTimer) {
        clearTimeout(persistTimer);
    }

    persistTimer = setTimeout(() => {
        try {
            const data = Object.fromEntries(activeSessions);
            writeFileSync(sessionsFilePath!, JSON.stringify(data, null, 2), 'utf-8');
        }
        catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[auth] Failed to persist sessions: ${message}`);
        }
        persistTimer = null;
    }, 1000);

    // Don't prevent process from exiting
    if (persistTimer?.unref) {
        persistTimer.unref();
    }
}

// ============================================================================
// Cookie Signing (Private)
// ============================================================================
/**
 * Create a signature for session data
 *
 * WHY HMAC:
 * HMAC (Hash-based Message Authentication Code) ensures:
 * - Data hasn't been tampered with
 * - Only someone with the secret could have created it
 *
 * We use SHA-256 for the HMAC algorithm.
 */
function sign(data: string): string {
    return createHmac('sha256', sessionSecret!)
        .update(data)
        .digest('base64url'); // URL-safe base64
}

/**
 * Verify a signature matches the data
 *
 * WHY TIMING-SAFE COMPARISON:
 * Regular string comparison (===) can leak timing information.
 * An attacker could measure response times to guess the signature
 * one character at a time. timingSafeEqual takes constant time
 * regardless of where the mismatch occurs.
 */
function verify(data: string, signature: string): boolean {
    const expected = sign(data);

    // Both must be same length for timingSafeEqual
    if (signature.length !== expected.length) {
        return false;
    }

    try {
        return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    }
    catch {
        return false;
    }
}

// ============================================================================
// Core Session Operations
// ============================================================================
/**
 * Parse session cookie from request (internal helper)
 */
function parseSessionCookie(req: IncomingMessage): ParsedSessionCookie | null {
    // Get Cookie header
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) {
        return null;
    }

    // Parse cookies (format: "name1=value1; name2=value2")
    const cookies: Record<string, string> = {};
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

    const [sessionId, userId, timestampStr, signature] = parts as [string, string, string, string];
    const timestamp = parseInt(timestampStr, 10);
    if (isNaN(timestamp)) {
        return null;
    }

    return { sessionId, userId, timestamp, timestampStr, signature };
}

/**
 * Create a session for a user
 *
 * COOKIE FORMAT:
 * cms_session=sessionId.userId.timestamp.signature
 *
 * COOKIE OPTIONS:
 * - HttpOnly: JavaScript can't read it (XSS protection)
 * - Path=/: Cookie sent for all paths
 * - SameSite=Lax: Some CSRF protection
 * - Max-Age: Cookie expires after this many seconds
 */
export function createSession(res: ServerResponse, userId: string): string {
    const sessionId = randomUUID();
    const timestamp = Date.now();
    const data = `${sessionId}.${userId}.${timestamp}`;
    const signature = sign(data);
    const cookieValue = `${data}.${signature}`;

    // Track session in memory and persist
    activeSessions.set(sessionId, {
        userId,
        createdAt: timestamp,
        lastActivity: timestamp,
    });

    if (dbPool) {
        // Persist to database (fire-and-forget with error logging)
        const expiresAt = new Date(timestamp + SESSION_MAX_AGE).toISOString();
        dbPool.query(
            `INSERT INTO sessions (session_id, user_id, created_at, last_activity, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (session_id) DO UPDATE SET
         last_activity = EXCLUDED.last_activity,
         expires_at = EXCLUDED.expires_at`,
            [sessionId, userId, new Date(timestamp).toISOString(), new Date(timestamp).toISOString(), expiresAt]
        ).catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`[auth] Failed to persist session to DB: ${message}`);
        });
    }
    else {
        persistSessions();
    }

    // Calculate max age in seconds
    const maxAgeSeconds = Math.floor(SESSION_MAX_AGE / 1000);

    // Set the cookie
    const cookieOptions = [
        `${SESSION_COOKIE_NAME}=${cookieValue}`,
        'HttpOnly', // No JavaScript access
        'Path=/',   // Available for all paths
        'SameSite=Lax', // Basic CSRF protection
        `Max-Age=${maxAgeSeconds}`, // Expiration
    ];
    res.setHeader('Set-Cookie', cookieOptions.join('; '));
    return sessionId;
}

/**
 * Destroy a session (logout)
 *
 * HOW TO DELETE A COOKIE:
 * Set the same cookie with:
 * - Empty value
 * - Max-Age=0 or Expires in the past
 *
 * Browser will remove the cookie.
 */
export function destroySession(res: ServerResponse, req?: IncomingMessage): void {
    // If request provided, remove from tracking
    if (req) {
        const sessionData = parseSessionCookie(req);
        if (sessionData?.sessionId) {
            activeSessions.delete(sessionData.sessionId);
            if (dbPool) {
                dbPool.query(`DELETE FROM sessions WHERE session_id = $1`, [sessionData.sessionId])
                    .catch((err: unknown) => {
                        const message = err instanceof Error ? err.message : String(err);
                        console.warn(`[auth] Failed to delete session from DB: ${message}`);
                    });
            }
            else {
                persistSessions();
            }
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
 * Get session from request
 *
 * VALIDATION STEPS:
 * 1. Parse Cookie header to find our session cookie
 * 2. Split cookie value into sessionId.userId.timestamp.signature
 * 3. Verify signature matches sessionId.userId.timestamp
 * 4. Check timestamp hasn't expired
 * 5. Verify session exists in active sessions map
 * 6. Return session data or null
 */
export function getSession(req: IncomingMessage): Session | null {
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
    const sessionData = activeSessions.get(sessionId)!;
    sessionData.lastActivity = Date.now();

    // Session is valid
    return { userId, sessionId };
}

/**
 * Invalidate all sessions for a user
 *
 * USE CASES:
 * - User's role is changed
 * - User's password is changed (invalidate other sessions)
 * - User is deleted
 * - Admin forces logout
 */
export function invalidateSessions(userId: string): number {
    let count = 0;
    for (const [sessionId, data] of activeSessions.entries()) {
        if (data.userId === userId) {
            activeSessions.delete(sessionId);
            count++;
        }
    }

    if (count > 0) {
        if (dbPool) {
            dbPool.query(`DELETE FROM sessions WHERE user_id = $1`, [userId])
                .catch((err: unknown) => {
                    const message = err instanceof Error ? err.message : String(err);
                    console.warn(`[auth] Failed to invalidate sessions in DB: ${message}`);
                });
        }
        else {
            persistSessions();
        }
    }

    return count;
}

/**
 * Invalidate all sessions for a user except one
 *
 * USE CASE:
 * Password change - invalidate other sessions but keep current one
 */
export function invalidateOtherSessions(userId: string, exceptSessionId: string): number {
    let count = 0;
    for (const [sessionId, data] of activeSessions.entries()) {
        if (data.userId === userId && sessionId !== exceptSessionId) {
            activeSessions.delete(sessionId);
            count++;
        }
    }

    if (count > 0) {
        if (dbPool) {
            dbPool.query(
                `DELETE FROM sessions WHERE user_id = $1 AND session_id != $2`,
                [userId, exceptSessionId]
            ).catch((err: unknown) => {
                const message = err instanceof Error ? err.message : String(err);
                console.warn(`[auth] Failed to invalidate sessions in DB: ${message}`);
            });
        }
        else {
            persistSessions();
        }
    }

    return count;
}

/**
 * Get count of active sessions for a user
 */
export function getActiveSessionCount(userId: string): number {
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
 */
export function getAllSessions(): SessionInfo[] {
    const sessions: SessionInfo[] = [];
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
 */
export function getSessionStats(): Map<string, UserSessionStats> {
    const stats: Map<string, UserSessionStats> = new Map();
    for (const data of activeSessions.values()) {
        if (!stats.has(data.userId)) {
            stats.set(data.userId, { count: 0, lastActivity: 0 });
        }
        const userStats = stats.get(data.userId)!;
        userStats.count++;
        if (data.lastActivity > userStats.lastActivity) {
            userStats.lastActivity = data.lastActivity;
        }
    }
    return stats;
}

// ============================================================================
// Password Hashing
// ============================================================================
/**
 * Hash a password for storage
 *
 * WHY SCRYPT:
 * Node's built-in crypto.scryptSync is a password-hashing KDF that:
 * - Is specifically designed for password hashing (unlike SHA-256)
 * - Is intentionally slow to resist brute force attacks
 * - Has configurable cost parameters (N, r, p)
 * - Includes salt to prevent rainbow table attacks
 * - Requires zero external dependencies
 *
 * FORMAT: scrypt:salt:hash
 * The "scrypt:" prefix enables backwards-compatible migration
 * from the old SHA-256 format (salt:hash without prefix).
 */
export function hashPassword(password: string): string {
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
 * BACKWARDS COMPATIBILITY:
 * Supports both new scrypt format (scrypt:salt:hash) and legacy
 * SHA-256 format (salt:hash) so existing users can still log in.
 * Passwords are upgraded to scrypt on next hash (e.g., password change).
 */
export function verifyPassword(password: string, storedHash: string): boolean {
    // Detect format by prefix
    if (storedHash.startsWith('scrypt:')) {
        // New scrypt format: scrypt:salt:hash
        const parts = storedHash.split(':');
        if (parts.length !== 3) return false;

        const [, salt, originalHash] = parts as [string, string, string];
        const checkHash = scryptSync(password, salt, 64, {
            N: 16384,
            r: 8,
            p: 1,
        }).toString('hex');

        if (checkHash.length !== originalHash.length) return false;

        try {
            return timingSafeEqual(Buffer.from(checkHash), Buffer.from(originalHash));
        }
        catch {
            return false;
        }
    }

    // Legacy SHA-256 format: salt:hash (for backwards compatibility)
    const parts = storedHash.split(':');
    if (parts.length !== 2) return false;

    const [salt, originalHash] = parts as [string, string];
    const checkHash = createHash('sha256')
        .update(salt + password)
        .digest('hex');

    if (checkHash.length !== originalHash.length) return false;

    try {
        return timingSafeEqual(Buffer.from(checkHash), Buffer.from(originalHash));
    }
    catch {
        return false;
    }
}

/**
 * Check if auth module is initialized
 */
export function isInitialized(): boolean {
    return sessionSecret !== null;
}

// ============================================================================
// Roles and Permissions
// ============================================================================
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
const ROLE_PERMISSIONS: RolePermissionsMap = {
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
 * WILDCARD SUPPORT:
 * Admin role has '*' which grants all permissions.
 */
export function hasPermission(user: UserForPermission | null | undefined, permission: string): boolean {
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
 */
export function hasRole(user: UserForPermission | null | undefined, role: string): boolean {
    if (!user || !user.role) {
        return false;
    }
    return user.role === role;
}

/**
 * Get all permissions for a role
 */
export function getRolePermissions(role: string): string[] {
    return ROLE_PERMISSIONS[role] || [];
}

/**
 * Get all defined roles
 */
export function getRoles(): string[] {
    return Object.keys(ROLE_PERMISSIONS);
}

// ============================================================================
// API Tokens
// ============================================================================
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
const TOKEN_PREFIX: string = 'cms_';

/**
 * Generate an API token for a user
 *
 * TOKEN FORMAT:
 * cms_<base64-encoded-json>
 *
 * WHY PREFIX:
 * Makes tokens easily identifiable.
 * Helps with log scrubbing and secret detection.
 */
export function generateToken(userId: string): string {
    const timestamp = Date.now();
    const data = `${userId}.${timestamp}`;
    const signature = sign(data);

    const payload: TokenPayload = {
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
export function verifyToken(token: string): TokenData | null {
    // Check prefix
    if (!token || !token.startsWith(TOKEN_PREFIX)) {
        return null;
    }

    // Remove prefix and decode
    const encoded = token.slice(TOKEN_PREFIX.length);
    let payload: TokenPayload;
    try {
        const decoded = Buffer.from(encoded, 'base64url').toString('utf-8');
        payload = JSON.parse(decoded) as TokenPayload;
    }
    catch {
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
 * CHECKS IN ORDER:
 * 1. Session cookie (for browser requests)
 * 2. Authorization: Bearer <token> header (for API requests)
 *
 * WHY BOTH:
 * - Browsers use session cookies automatically
 * - CLI/scripts use Bearer tokens
 * - Same endpoints can serve both
 */
export function getAuthFromRequest(req: IncomingMessage): AuthResult | null {
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

// ============================================================================
// CSRF Protection
// ============================================================================
/**
 * Initialize CSRF protection
 *
 * WHY IN AUTH MODULE:
 * CSRF protection is tightly coupled with session management.
 * Tokens are tied to session IDs for security.
 */
export function initCSRF(csrfConfig: CSRFConfig = {}): void {
    if (!sessionSecret) {
        throw new Error('Auth module must be initialized before CSRF');
    }
    csrf.init(sessionSecret, csrfConfig);
}

/**
 * Get CSRF token for current session
 *
 * USE CASE:
 * Call this to get a token for embedding in forms/pages.
 * Token is tied to the current user's session.
 */
export function getCSRFToken(req: IncomingMessage): string | null {
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
 * USE CASE:
 * Call this in route handlers to validate submitted tokens.
 */
export function validateCSRFToken(req: IncomingMessage, token: string): boolean {
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
 * SOURCES (checked in order):
 * 1. X-CSRF-Token header (for AJAX)
 * 2. _csrf in parsed body (for forms)
 * 3. _csrf in query string (fallback)
 */
export function extractCSRFToken(req: IncomingMessage, ctx: CSRFRequestContext): string | null {
    // Check header first (most secure for AJAX)
    const headerToken = req.headers['x-csrf-token'];
    if (headerToken && typeof headerToken === 'string') {
        return headerToken;
    }

    // Check parsed body (for form submissions)
    const csrfFromBody = ctx?._parsedBody?._csrf;
    if (csrfFromBody && typeof csrfFromBody === 'string') {
        return csrfFromBody;
    }

    // Check query string (fallback)
    try {
        const url = new URL(req.url || '/', 'http://localhost');
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
 * CSRF validation middleware
 *
 * USE CASE:
 * Apply to admin routes that accept POST/PUT/DELETE requests.
 */
export function requireCSRF(
    options: CSRFOptions = {}
): (req: IncomingMessage, res: ServerResponse, ctx: CSRFRequestContext, next: () => Promise<void>) => Promise<void> {
    const {
        exemptPaths = ['/api/'],
        exemptMethods = ['GET', 'HEAD', 'OPTIONS'],
    } = options;

    return async function csrfMiddleware(
        req: IncomingMessage,
        res: ServerResponse,
        ctx: CSRFRequestContext,
        next: () => Promise<void>
    ): Promise<void> {
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
 */
export function getCSRFStatus(): { enabled: boolean; tokenExpiry: number; activeTokenCount: number } {
    return csrf.getConfig();
}

/**
 * Clear all CSRF tokens (force re-auth)
 */
export function clearCSRFTokens(): number {
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
