/**
 * IP Ban Service for CMS-Core
 *
 * Architecture Notes:
 * - In-memory cache for fast middleware checks (runs on EVERY request)
 * - Single JSON file storage (content/ban/bans.json)
 * - CIDR range support for network-level blocks
 * - Temporary ban support via expires field
 * - Zero dependencies (Node.js built-in only)
 *
 * Performance:
 * - Ban list cached in memory to avoid disk I/O on every request
 * - CIDR matching uses bit operations for speed
 * - Expired bans filtered on read, not written back (lazy cleanup)
 *
 * Security:
 * - IPv6-mapped IPv4 addresses normalized (::ffff:127.0.0.1 → 127.0.0.1)
 * - X-Forwarded-For header checked for proxy/load balancer scenarios
 * - Ban reason logged for audit trail
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Module-level state
let banDir = '';
let banFile = '';
let banCache = []; // In-memory cache for fast lookups
let config = {
  enabled: true,
  message: 'Your IP address has been banned.',
  statusCode: 403
};

/**
 * Initialize ban service
 * @param {Object} cfg - Configuration object from site.json ban key
 * @param {string} baseDir - Base directory path for CMS installation
 */
export function init(cfg = {}, baseDir) {
  config = { ...config, ...cfg };
  banDir = join(baseDir, 'content', 'ban');
  banFile = join(banDir, 'bans.json');

  // Ensure directory exists
  if (!existsSync(banDir)) {
    mkdirSync(banDir, { recursive: true });
  }

  // Load bans into memory cache
  loadBans();
}

/**
 * Load bans from disk into memory cache
 * WHY: Middleware needs fast access; reading from disk on every request is too slow
 */
function loadBans() {
  if (!existsSync(banFile)) {
    banCache = [];
    return;
  }
  try {
    const data = JSON.parse(readFileSync(banFile, 'utf8'));
    banCache = data.bans || [];
  } catch (e) {
    console.error('[ban] Error loading bans:', e.message);
    banCache = [];
  }
}

/**
 * Save bans to disk from memory cache
 * WHY: Single source of truth on disk; cache synced after mutations
 */
function saveBans() {
  try {
    writeFileSync(banFile, JSON.stringify({ bans: banCache }, null, 2) + '\n');
  } catch (e) {
    console.error('[ban] Error saving bans:', e.message);
    throw e;
  }
}

/**
 * Convert IPv4 address to 32-bit integer
 * WHY: Enables fast bitwise CIDR range checks
 * @param {string} ip - IPv4 address (e.g., "192.168.1.1")
 * @returns {number} 32-bit unsigned integer
 */
function ipToInt(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return 0;
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/**
 * Check if IP matches CIDR range
 * WHY: Allows blocking entire networks (e.g., all of 10.0.0.0/8)
 * @param {string} ip - IPv4 address to check
 * @param {string} cidr - CIDR notation (e.g., "192.168.0.0/16")
 * @returns {boolean} True if IP is in CIDR range
 */
function ipMatchesCidr(ip, cidr) {
  // Handle non-CIDR notation (exact match)
  if (!cidr.includes('/')) {
    return ip === cidr;
  }

  const [network, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);

  // Validate CIDR
  if (isNaN(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }

  const ipInt = ipToInt(ip);
  const networkInt = ipToInt(network);

  if (ipInt === 0 || networkInt === 0) {
    return false;
  }

  // Create subnet mask (e.g., /24 = 0xFFFFFF00)
  const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;

  // Compare network portions
  return (ipInt & mask) === (networkInt & mask);
}

/**
 * Normalize IP address
 * WHY: IPv6-mapped IPv4 addresses (::ffff:127.0.0.1) should match IPv4 entries
 * @param {string} ip - Raw IP address
 * @returns {string} Normalized IPv4 address
 */
function normalizeIp(ip) {
  if (!ip) return '';

  // Strip IPv6-mapped IPv4 prefix
  if (ip.startsWith('::ffff:')) {
    return ip.substring(7);
  }

  return ip;
}

/**
 * Check if ban entry is expired
 * WHY: Temporary bans should auto-expire without manual intervention
 * @param {Object} ban - Ban entry
 * @returns {boolean} True if ban is expired
 */
function isExpired(ban) {
  if (!ban.expires) return false;
  return new Date(ban.expires) < new Date();
}

/**
 * Filter out expired bans
 * WHY: Lazy cleanup - don't delete from disk, just skip in memory
 * @param {Array} bans - Array of ban entries
 * @returns {Array} Active bans only
 */
function filterActive(bans) {
  return bans.filter(ban => !isExpired(ban));
}

/**
 * List all active bans (excludes expired)
 * @returns {Array} Array of ban entries
 */
export function listBans() {
  return filterActive(banCache);
}

/**
 * Get ban entry for specific IP (exact match only)
 * @param {string} ip - IP address to check
 * @returns {Object|null} Ban entry or null
 */
export function getBan(ip) {
  const normalized = normalizeIp(ip);
  const activeBans = filterActive(banCache);
  return activeBans.find(ban => ban.ip === normalized) || null;
}

/**
 * Add IP or CIDR to ban list
 * @param {string} ip - IP address or CIDR range
 * @param {Object} options - Ban options
 * @param {string} options.reason - Reason for ban
 * @param {string|null} options.expires - ISO date string or null for permanent
 * @param {string} options.bannedBy - User/system that created the ban
 * @returns {Object} Created ban entry
 */
export function addBan(ip, options = {}) {
  const normalized = normalizeIp(ip);

  // Remove existing ban for this IP (upsert behavior)
  banCache = banCache.filter(ban => ban.ip !== normalized);

  const banEntry = {
    ip: normalized,
    reason: options.reason || 'No reason provided',
    created: new Date().toISOString(),
    expires: options.expires || null,
    bannedBy: options.bannedBy || 'system'
  };

  banCache.push(banEntry);
  saveBans();

  return banEntry;
}

/**
 * Remove ban by IP string (exact match)
 * @param {string} ip - IP address to unban
 * @returns {boolean} True if ban was removed
 */
export function removeBan(ip) {
  const normalized = normalizeIp(ip);
  const beforeLength = banCache.length;

  banCache = banCache.filter(ban => ban.ip !== normalized);

  if (banCache.length < beforeLength) {
    saveBans();
    return true;
  }

  return false;
}

/**
 * Check if IP is banned (checks exact match AND CIDR ranges)
 * WHY: Core security function - must check both exact IPs and network ranges
 * @param {string} ip - IP address to check
 * @returns {Object|null} Ban entry if banned, null otherwise
 */
export function isBanned(ip) {
  const normalized = normalizeIp(ip);
  if (!normalized) return null;

  const activeBans = filterActive(banCache);

  // Check exact match first (faster)
  const exactMatch = activeBans.find(ban => ban.ip === normalized);
  if (exactMatch) return exactMatch;

  // Check CIDR ranges
  for (const ban of activeBans) {
    if (ban.ip.includes('/') && ipMatchesCidr(normalized, ban.ip)) {
      return ban;
    }
  }

  return null;
}

/**
 * Get ban statistics
 * @returns {Object} Statistics object
 */
export function getStats() {
  const active = filterActive(banCache);
  return {
    total: active.length,
    permanent: active.filter(ban => !ban.expires).length,
    temporary: active.filter(ban => ban.expires).length,
    expired: banCache.length - active.length
  };
}

/**
 * Force reload bans from disk
 * WHY: Allows external tools to modify bans.json and trigger reload
 */
export function reloadBans() {
  loadBans();
}

/**
 * Extract client IP from request
 * WHY: Must handle both direct connections and proxy/load balancer scenarios
 * @param {Object} req - Express/HTTP request object
 * @returns {string} Client IP address
 */
function getClientIp(req) {
  // Check X-Forwarded-For header (proxies/load balancers)
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    // X-Forwarded-For can be comma-separated list; first is client IP
    return normalizeIp(forwarded.split(',')[0].trim());
  }

  // Fall back to socket remote address
  return normalizeIp(req.socket?.remoteAddress || '');
}

/**
 * Express/Connect middleware for IP ban checking
 * WHY: Runs on EVERY request - must be extremely fast
 * @returns {Function} Middleware function (req, res, next)
 */
export function middleware() {
  return async (req, res, context, next) => {
    // Skip if disabled
    if (!config.enabled) {
      return next();
    }

    const clientIp = getClientIp(req);
    if (!clientIp) {
      return next();
    }

    const ban = isBanned(clientIp);
    if (ban) {
      // Log ban hit for audit
      console.warn(`[ban] Blocked request from ${clientIp}: ${ban.reason}`);

      // Send ban response using Node's native http methods
      res.writeHead(config.statusCode, { 'Content-Type': 'text/plain' });
      res.end(config.message);
      // DO NOT call next() - request is terminated
      return;
    }

    // Not banned, continue
    await next();
  };
}
