/**
 * preview.js - Content Preview Token Management
 *
 * WHY THIS EXISTS:
 * ================
 * Draft content needs to be shareable before publishing.
 * This module provides:
 * - Secure preview tokens with expiration
 * - Shareable preview URLs
 * - View tracking and limits
 * - Password protection option
 * - Preview toolbar injection
 *
 * USE CASES:
 * ==========
 * - Share draft article with editor for review
 * - Client preview of pending changes
 * - Scheduled content preview
 * - Stakeholder approval workflow
 *
 * TOKEN FORMAT:
 * =============
 * prev_<random12chars>
 * Example: prev_x7k9m2p5abc1
 *
 * SECURITY:
 * =========
 * - Tokens are random and unguessable
 * - Expiration prevents permanent access
 * - View limits prevent link sharing
 * - Password adds extra protection
 * - Revocation for immediate access removal
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

// ============================================
// STATE
// ============================================

/**
 * Preview tokens storage
 * Structure: { token: { ...tokenData } }
 */
let tokens = {};

/**
 * Storage file path
 */
let tokensFile = null;

/**
 * Content directory
 */
let contentDir = null;

/**
 * Content service reference
 */
let contentService = null;

/**
 * Configuration
 */
let config = {
  enabled: true,
  defaultExpiry: 604800,  // 7 days in seconds
  maxExpiry: 2592000,     // 30 days in seconds
  requireAuth: false,     // Require login to create previews
  baseUrl: ''             // Base URL for preview links
};

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize preview system
 *
 * @param {Object} cfg - Configuration
 * @param {string} baseDir - Base directory path
 * @param {Object} content - Content service
 */
export function init(cfg = {}, baseDir = '', content = null) {
  config = { ...config, ...cfg };
  contentDir = join(baseDir, 'content');
  contentService = content;

  // Ensure previews directory exists
  const previewsDir = join(contentDir, '.previews');
  if (!existsSync(previewsDir)) {
    mkdirSync(previewsDir, { recursive: true });
  }

  tokensFile = join(previewsDir, 'tokens.json');

  // Load existing tokens
  loadTokens();

  // Cleanup expired tokens
  const cleaned = cleanupExpiredTokens();

  const activeCount = Object.keys(tokens).length;
  console.log(`[preview] Initialized (${activeCount} active tokens${cleaned > 0 ? `, ${cleaned} expired removed` : ''})`);
}

/**
 * Load tokens from storage
 */
function loadTokens() {
  if (existsSync(tokensFile)) {
    try {
      const data = readFileSync(tokensFile, 'utf-8');
      tokens = JSON.parse(data);
    } catch (e) {
      console.error('[preview] Failed to load tokens:', e.message);
      tokens = {};
    }
  }
}

/**
 * Save tokens to storage
 */
function saveTokens() {
  try {
    const previewsDir = join(contentDir, '.previews');
    if (!existsSync(previewsDir)) {
      mkdirSync(previewsDir, { recursive: true });
    }
    writeFileSync(tokensFile, JSON.stringify(tokens, null, 2));
  } catch (e) {
    console.error('[preview] Failed to save tokens:', e.message);
  }
}

// ============================================
// TOKEN MANAGEMENT
// ============================================

/**
 * Generate a unique preview token
 *
 * @returns {string} Token string
 */
function generateToken() {
  const bytes = randomBytes(9);  // 9 bytes = 12 base64 chars
  const token = 'prev_' + bytes.toString('base64url').slice(0, 12);
  return token;
}

/**
 * Create a preview token for content
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {Object} options - Token options
 * @returns {Object} Token data
 */
export function createPreviewToken(type, id, options = {}) {
  if (!config.enabled) {
    throw new Error('Preview system is disabled');
  }

  // Verify content exists
  if (contentService) {
    const item = contentService.read(type, id);
    if (!item) {
      throw new Error(`Content not found: ${type}/${id}`);
    }
  }

  // Calculate expiration
  let expiresIn = options.expiresIn || config.defaultExpiry;
  if (typeof expiresIn === 'string') {
    expiresIn = parseDuration(expiresIn);
  }
  if (expiresIn > config.maxExpiry) {
    expiresIn = config.maxExpiry;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresIn * 1000);

  // Generate unique token
  let token;
  do {
    token = generateToken();
  } while (tokens[token]);

  // Hash password if provided
  let passwordHash = null;
  if (options.password) {
    passwordHash = hashPassword(options.password);
  }

  // Create token data
  const tokenData = {
    token,
    type,
    id,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    createdBy: options.createdBy || null,
    views: 0,
    maxViews: options.maxViews || null,
    passwordHash,
    revoked: false
  };

  tokens[token] = tokenData;
  saveTokens();

  // Return data without password hash
  const { passwordHash: _, ...publicData } = tokenData;
  return {
    ...publicData,
    hasPassword: !!passwordHash,
    url: getPreviewUrl(type, id, token)
  };
}

/**
 * Validate a preview token
 *
 * @param {string} token - Token to validate
 * @param {string} password - Password if required
 * @returns {Object} { valid: bool, error?: string, data?: tokenData }
 */
export function validatePreviewToken(token, password = null) {
  const tokenData = tokens[token];

  if (!tokenData) {
    return { valid: false, error: 'Token not found' };
  }

  if (tokenData.revoked) {
    return { valid: false, error: 'Token has been revoked' };
  }

  // Check expiration
  const now = new Date();
  const expiresAt = new Date(tokenData.expiresAt);
  if (now > expiresAt) {
    return { valid: false, error: 'Token has expired' };
  }

  // Check view limit
  if (tokenData.maxViews !== null && tokenData.views >= tokenData.maxViews) {
    return { valid: false, error: 'Token view limit exceeded' };
  }

  // Check password
  if (tokenData.passwordHash) {
    if (!password) {
      return { valid: false, error: 'Password required', requiresPassword: true };
    }
    if (!verifyPassword(password, tokenData.passwordHash)) {
      return { valid: false, error: 'Invalid password', requiresPassword: true };
    }
  }

  // Token is valid - increment view count
  tokenData.views++;
  tokenData.lastViewedAt = now.toISOString();
  saveTokens();

  return {
    valid: true,
    data: {
      type: tokenData.type,
      id: tokenData.id,
      expiresAt: tokenData.expiresAt,
      views: tokenData.views,
      maxViews: tokenData.maxViews
    }
  };
}

/**
 * Revoke a preview token
 *
 * @param {string} token - Token to revoke
 * @returns {boolean} Success
 */
export function revokePreviewToken(token) {
  const tokenData = tokens[token];

  if (!tokenData) {
    return false;
  }

  tokenData.revoked = true;
  tokenData.revokedAt = new Date().toISOString();
  saveTokens();

  return true;
}

/**
 * Delete a preview token completely
 *
 * @param {string} token - Token to delete
 * @returns {boolean} Success
 */
export function deletePreviewToken(token) {
  if (!tokens[token]) {
    return false;
  }

  delete tokens[token];
  saveTokens();

  return true;
}

/**
 * Get a preview token's data
 *
 * @param {string} token - Token to get
 * @returns {Object|null} Token data or null
 */
export function getPreviewToken(token) {
  const tokenData = tokens[token];
  if (!tokenData) return null;

  const { passwordHash, ...publicData } = tokenData;
  return {
    ...publicData,
    hasPassword: !!passwordHash
  };
}

/**
 * List preview tokens
 *
 * @param {string} type - Filter by content type
 * @param {string} id - Filter by content ID
 * @returns {Array} Array of token data
 */
export function listPreviewTokens(type = null, id = null) {
  const now = new Date();

  return Object.values(tokens)
    .filter(t => {
      if (t.revoked) return false;
      if (type && t.type !== type) return false;
      if (id && t.id !== id) return false;
      // Include expired for listing (marked as expired)
      return true;
    })
    .map(t => {
      const { passwordHash, ...publicData } = t;
      const expiresAt = new Date(t.expiresAt);
      return {
        ...publicData,
        hasPassword: !!passwordHash,
        expired: now > expiresAt,
        expiresIn: Math.max(0, Math.floor((expiresAt - now) / 1000)),
        url: getPreviewUrl(t.type, t.id, t.token)
      };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Cleanup expired tokens
 *
 * @returns {number} Number of tokens removed
 */
export function cleanupExpiredTokens() {
  const now = new Date();
  let removed = 0;

  for (const [token, data] of Object.entries(tokens)) {
    const expiresAt = new Date(data.expiresAt);
    // Remove tokens expired more than 24 hours ago
    if (now - expiresAt > 24 * 60 * 60 * 1000) {
      delete tokens[token];
      removed++;
    }
  }

  if (removed > 0) {
    saveTokens();
  }

  return removed;
}

/**
 * Get preview URL for content
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {string} token - Preview token
 * @returns {string} Full preview URL
 */
export function getPreviewUrl(type, id, token) {
  const baseUrl = config.baseUrl || '';
  return `${baseUrl}/preview/${token}`;
}

/**
 * Get statistics about preview tokens
 *
 * @returns {Object} Stats object
 */
export function getStats() {
  const now = new Date();
  const allTokens = Object.values(tokens);

  const active = allTokens.filter(t => !t.revoked && new Date(t.expiresAt) > now);
  const expired = allTokens.filter(t => !t.revoked && new Date(t.expiresAt) <= now);
  const revoked = allTokens.filter(t => t.revoked);

  const totalViews = allTokens.reduce((sum, t) => sum + t.views, 0);

  return {
    total: allTokens.length,
    active: active.length,
    expired: expired.length,
    revoked: revoked.length,
    totalViews
  };
}

// ============================================
// PREVIEW RENDERING
// ============================================

/**
 * Get preview toolbar HTML
 *
 * @param {Object} content - Content item
 * @param {Object} tokenData - Token data
 * @returns {string} HTML string
 */
export function getPreviewToolbar(content, tokenData) {
  const type = tokenData.type;
  const id = tokenData.id;
  const status = content.status || 'draft';
  const statusColors = {
    draft: '#6c757d',
    pending: '#ffc107',
    scheduled: '#17a2b8',
    published: '#28a745',
    archived: '#dc3545'
  };
  const statusColor = statusColors[status] || '#6c757d';

  return `
<div id="cms-preview-toolbar" style="
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 99999;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  color: #fff;
  padding: 10px 20px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 2px 10px rgba(0,0,0,0.3);
">
  <div style="display: flex; align-items: center; gap: 15px;">
    <span style="
      background: #e94560;
      color: #fff;
      padding: 4px 12px;
      border-radius: 4px;
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    ">Preview Mode</span>
    <span style="color: #a0a0a0;">|</span>
    <span>
      <strong>${escapeHtml(type)}</strong> / ${escapeHtml(id)}
    </span>
    <span style="color: #a0a0a0;">|</span>
    <span style="
      background: ${statusColor};
      color: #fff;
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 12px;
      text-transform: capitalize;
    ">${escapeHtml(status)}</span>
  </div>
  <div style="display: flex; align-items: center; gap: 10px;">
    <a href="/admin/content/${escapeHtml(type)}/${escapeHtml(id)}/edit" style="
      color: #fff;
      text-decoration: none;
      padding: 6px 12px;
      background: rgba(255,255,255,0.1);
      border-radius: 4px;
      transition: background 0.2s;
    " onmouseover="this.style.background='rgba(255,255,255,0.2)'" onmouseout="this.style.background='rgba(255,255,255,0.1)'">
      Edit
    </a>
    <a href="/" style="
      color: #fff;
      text-decoration: none;
      padding: 6px 12px;
      background: rgba(255,255,255,0.1);
      border-radius: 4px;
      transition: background 0.2s;
    " onmouseover="this.style.background='rgba(255,255,255,0.2)'" onmouseout="this.style.background='rgba(255,255,255,0.1)'">
      Exit Preview
    </a>
  </div>
</div>
<div style="height: 50px;"></div>
<meta name="robots" content="noindex, nofollow">
`;
}

/**
 * Get password form HTML for protected previews
 *
 * @param {string} token - Preview token
 * @param {string} error - Error message
 * @returns {string} HTML string
 */
export function getPasswordForm(token, error = null) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>Preview - Password Required</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.2);
      padding: 40px;
      max-width: 400px;
      width: 100%;
      text-align: center;
    }
    h1 {
      color: #333;
      margin-bottom: 10px;
      font-size: 24px;
    }
    p {
      color: #666;
      margin-bottom: 25px;
    }
    .error {
      background: #fee;
      color: #c00;
      padding: 10px;
      border-radius: 6px;
      margin-bottom: 20px;
      font-size: 14px;
    }
    input[type="password"] {
      width: 100%;
      padding: 12px 16px;
      border: 2px solid #ddd;
      border-radius: 8px;
      font-size: 16px;
      margin-bottom: 15px;
      transition: border-color 0.2s;
    }
    input[type="password"]:focus {
      outline: none;
      border-color: #667eea;
    }
    button {
      width: 100%;
      padding: 12px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 5px 20px rgba(102,126,234,0.4);
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Password Required</h1>
    <p>This preview is password protected.</p>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
    <form method="POST">
      <input type="password" name="password" placeholder="Enter password" required autofocus>
      <button type="submit">View Preview</button>
    </form>
  </div>
</body>
</html>
`;
}

/**
 * Get preview not found/invalid page
 *
 * @param {string} error - Error message
 * @returns {string} HTML string
 */
export function getErrorPage(error) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>Preview Not Available</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
      padding: 40px;
      max-width: 400px;
      width: 100%;
      text-align: center;
    }
    .icon {
      font-size: 48px;
      margin-bottom: 20px;
    }
    h1 {
      color: #333;
      margin-bottom: 10px;
      font-size: 24px;
    }
    p {
      color: #666;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🔒</div>
    <h1>Preview Not Available</h1>
    <p>${escapeHtml(error)}</p>
  </div>
</body>
</html>
`;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Parse duration string to seconds
 *
 * @param {string} duration - Duration string (e.g., "7d", "24h", "30m")
 * @returns {number} Seconds
 */
function parseDuration(duration) {
  const match = duration.match(/^(\d+)(s|m|h|d|w)$/);
  if (!match) {
    return parseInt(duration, 10) || config.defaultExpiry;
  }

  const [, value, unit] = match;
  const num = parseInt(value, 10);

  switch (unit) {
    case 's': return num;
    case 'm': return num * 60;
    case 'h': return num * 60 * 60;
    case 'd': return num * 24 * 60 * 60;
    case 'w': return num * 7 * 24 * 60 * 60;
    default: return num;
  }
}

/**
 * Format duration for display
 *
 * @param {number} seconds - Duration in seconds
 * @returns {string} Human-readable duration
 */
export function formatDuration(seconds) {
  if (seconds < 60) return `${seconds} second${seconds !== 1 ? 's' : ''}`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    return `${mins} minute${mins !== 1 ? 's' : ''}`;
  }
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  }
  const days = Math.floor(seconds / 86400);
  return `${days} day${days !== 1 ? 's' : ''}`;
}

/**
 * Hash a password
 *
 * @param {string} password - Plain password
 * @returns {string} Hashed password
 */
function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = createHash('sha256').update(salt + password).digest('hex');
  return `${salt}:${hash}`;
}

/**
 * Verify a password
 *
 * @param {string} password - Plain password
 * @param {string} stored - Stored hash
 * @returns {boolean} Match
 */
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const testHash = createHash('sha256').update(salt + password).digest('hex');
  return hash === testHash;
}

/**
 * Escape HTML entities
 *
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
