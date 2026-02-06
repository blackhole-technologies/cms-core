/**
 * audit.js - Audit Logging System
 *
 * WHY THIS EXISTS:
 * Track all significant user actions for:
 * - Security monitoring and incident investigation
 * - Compliance requirements (who did what, when)
 * - Debugging user-reported issues
 * - Activity analytics
 *
 * STORAGE STRUCTURE:
 * /logs/audit/<year>/<month>.json
 *
 * Each log file is a JSON array of audit entries, partitioned by month
 * for manageable file sizes and easy archival.
 *
 * LOGGED ACTIONS:
 * - auth.login, auth.logout, auth.failed
 * - content.create, content.update, content.delete
 * - content.publish, content.unpublish, content.archive
 * - user.create, user.update, user.delete, user.role_change
 * - plugin.activate, plugin.deactivate, plugin.install
 * - config.update
 * - export.content, export.site, import.content, import.site
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Configuration
 */
let config = {
  enabled: true,
  retention: 90,            // Days to keep logs (0 = forever)
  logLevel: 'info',         // info, warning, security
  excludeActions: [],       // Actions to exclude from logging
};

/**
 * Log levels hierarchy
 */
const LOG_LEVELS = {
  info: 0,
  warning: 1,
  security: 2,
};

/**
 * Base directory for logs
 */
let baseDir = null;
let logsDir = null;

/**
 * In-memory buffer for batch writes
 */
let writeBuffer = [];
let flushInterval = null;
const FLUSH_INTERVAL_MS = 5000;
const BUFFER_SIZE = 50;

/**
 * Initialize audit system
 *
 * @param {string} dir - Base directory
 * @param {Object} auditConfig - Audit configuration
 */
export function init(dir, auditConfig = {}) {
  baseDir = dir;

  // Merge config
  config = { ...config, ...auditConfig };

  // Setup logs directory
  logsDir = join(baseDir, 'logs', 'audit');
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }

  // Start flush interval
  if (flushInterval) {
    clearInterval(flushInterval);
  }

  flushInterval = setInterval(() => {
    flush();
  }, FLUSH_INTERVAL_MS);
}

/**
 * Get log file path for a given date
 *
 * @param {Date} date - Date to get path for
 * @returns {string} - Path to log file
 */
function getLogPath(date = new Date()) {
  const year = date.getFullYear().toString();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');

  const yearDir = join(logsDir, year);
  if (!existsSync(yearDir)) {
    mkdirSync(yearDir, { recursive: true });
  }

  return join(yearDir, `${month}.json`);
}

/**
 * Read log file
 *
 * @param {string} path - Path to log file
 * @returns {Array} - Log entries
 */
function readLogFile(path) {
  if (!existsSync(path)) {
    return [];
  }

  try {
    const data = readFileSync(path, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.warn(`[audit] Failed to read log file ${path}: ${error.message}`);
    return [];
  }
}

/**
 * Write log file
 *
 * @param {string} path - Path to log file
 * @param {Array} entries - Log entries
 */
function writeLogFile(path, entries) {
  try {
    writeFileSync(path, JSON.stringify(entries, null, 2) + '\n');
  } catch (error) {
    console.error(`[audit] Failed to write log file ${path}: ${error.message}`);
  }
}

/**
 * Flush buffer to disk
 */
export function flush() {
  if (writeBuffer.length === 0) return;

  // Group entries by month
  const byMonth = {};
  for (const entry of writeBuffer) {
    const date = new Date(entry.timestamp);
    const path = getLogPath(date);

    if (!byMonth[path]) {
      byMonth[path] = [];
    }
    byMonth[path].push(entry);
  }

  // Write each month's entries
  for (const [path, entries] of Object.entries(byMonth)) {
    const existing = readLogFile(path);
    const combined = [...existing, ...entries];
    writeLogFile(path, combined);
  }

  writeBuffer = [];
}

/**
 * Get client IP from request
 *
 * @param {http.IncomingMessage} req - HTTP request
 * @returns {string|null}
 */
function getClientIP(req) {
  if (!req) return null;

  // Check for forwarded headers (behind proxy)
  const forwarded = req.headers?.['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  const realIP = req.headers?.['x-real-ip'];
  if (realIP) {
    return realIP;
  }

  return req.socket?.remoteAddress || null;
}

/**
 * Get log level for an action
 *
 * @param {string} action - Action name
 * @returns {string} - Log level
 */
function getActionLevel(action) {
  // Security-level actions
  if (action.startsWith('auth.') || action.includes('role_change') || action.includes('delete')) {
    return 'security';
  }

  // Warning-level actions
  if (action.includes('failed') || action.includes('error')) {
    return 'warning';
  }

  return 'info';
}

/**
 * Log an audit entry
 *
 * @param {string} action - Action identifier (e.g., 'content.create')
 * @param {Object} details - Action details
 * @param {Object} context - Request context (req, user)
 * @returns {Object|null} - Created entry or null if disabled
 */
export function log(action, details = {}, context = {}) {
  if (!config.enabled || !logsDir) return null;

  // Check if action is excluded
  if (config.excludeActions.includes(action)) {
    return null;
  }

  // Check log level
  const actionLevel = getActionLevel(action);
  if (LOG_LEVELS[actionLevel] < LOG_LEVELS[config.logLevel]) {
    return null;
  }

  const { req, user, result = 'success', error = null } = context;

  const entry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    action,
    level: actionLevel,
    userId: user?.id || null,
    username: user?.username || user?.email || null,
    ip: getClientIP(req),
    userAgent: req?.headers?.['user-agent'] || null,
    details,
    result,
    error: error || null,
  };

  // Add to buffer
  writeBuffer.push(entry);

  // Flush if buffer is full
  if (writeBuffer.length >= BUFFER_SIZE) {
    flush();
  }

  return entry;
}

/**
 * Query audit logs
 *
 * @param {Object} filters - Query filters
 * @param {Object} options - Query options
 * @returns {Object} - { entries: [], total: number }
 */
export function query(filters = {}, options = {}) {
  if (!logsDir) return { entries: [], total: 0 };

  const {
    action = null,
    userId = null,
    username = null,
    ip = null,
    result = null,
    level = null,
    from = null,
    to = null,
    days = null,
    search = null,
  } = filters;

  const {
    limit = 100,
    offset = 0,
    sortOrder = 'desc',
  } = options;

  // Flush pending writes first
  flush();

  // Determine date range
  let toDate = to ? new Date(to) : new Date();
  let fromDate;

  if (from) {
    fromDate = new Date(from);
  } else if (days) {
    fromDate = new Date(toDate.getTime() - days * 24 * 60 * 60 * 1000);
  } else {
    fromDate = new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000); // Default: 30 days
  }

  // Get all log files in range
  const logFiles = getLogFilesInRange(fromDate, toDate);

  // Collect and filter entries
  let allEntries = [];

  for (const path of logFiles) {
    const entries = readLogFile(path);
    allEntries = allEntries.concat(entries);
  }

  // Apply filters
  let filtered = allEntries.filter(entry => {
    const entryDate = new Date(entry.timestamp);

    // Date range filter
    if (entryDate < fromDate || entryDate > toDate) {
      return false;
    }

    // Action filter (supports prefix matching)
    if (action) {
      if (action.endsWith('.*')) {
        const prefix = action.slice(0, -2);
        if (!entry.action.startsWith(prefix)) return false;
      } else if (entry.action !== action) {
        return false;
      }
    }

    // User filters
    if (userId && entry.userId !== userId) return false;
    if (username && entry.username !== username) return false;

    // IP filter
    if (ip && entry.ip !== ip) return false;

    // Result filter
    if (result && entry.result !== result) return false;

    // Level filter
    if (level && entry.level !== level) return false;

    // Search filter (searches action, username, details)
    if (search) {
      const searchLower = search.toLowerCase();
      const searchable = [
        entry.action,
        entry.username,
        JSON.stringify(entry.details),
      ].join(' ').toLowerCase();

      if (!searchable.includes(searchLower)) return false;
    }

    return true;
  });

  // Sort by timestamp
  filtered.sort((a, b) => {
    const diff = new Date(b.timestamp) - new Date(a.timestamp);
    return sortOrder === 'desc' ? diff : -diff;
  });

  const total = filtered.length;

  // Apply pagination
  const entries = filtered.slice(offset, offset + limit);

  return {
    entries,
    total,
    limit,
    offset,
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
  };
}

/**
 * Get log files in date range
 *
 * @param {Date} from - Start date
 * @param {Date} to - End date
 * @returns {string[]} - Array of log file paths
 */
function getLogFilesInRange(from, to) {
  if (!existsSync(logsDir)) return [];

  const files = [];

  // Iterate through each month in range
  const current = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth(), 1);

  while (current <= end) {
    const path = getLogPath(current);
    if (existsSync(path)) {
      files.push(path);
    }
    current.setMonth(current.getMonth() + 1);
  }

  return files;
}

/**
 * Get audit logs by user
 *
 * @param {string} userId - User ID
 * @param {Object} options - Query options
 * @returns {Object} - Query result
 */
export function getByUser(userId, options = {}) {
  return query({ userId }, options);
}

/**
 * Get audit logs for content item
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {Object} options - Query options
 * @returns {Object} - Query result
 */
export function getByContent(type, id, options = {}) {
  const result = query({ action: 'content.*' }, { ...options, limit: Number.MAX_SAFE_INTEGER });

  // Filter by content type and id in details
  const filtered = result.entries.filter(entry => {
    return entry.details?.type === type && entry.details?.id === id;
  });

  const limit = options.limit || 100;
  const offset = options.offset || 0;

  return {
    entries: filtered.slice(offset, offset + limit),
    total: filtered.length,
    limit,
    offset,
  };
}

/**
 * Prune old audit logs
 *
 * @param {number|Date} olderThan - Days (number) or Date to delete before
 * @returns {Object} - { deleted: number, files: string[] }
 */
export function prune(olderThan = null) {
  if (!logsDir) return { deleted: 0, files: [] };

  let cutoff;

  if (olderThan instanceof Date) {
    cutoff = olderThan;
  } else {
    const days = olderThan ?? config.retention;
    if (days <= 0) return { deleted: 0, files: [] };

    cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
  }

  const deletedFiles = [];
  let totalDeleted = 0;

  // Find all year directories
  if (!existsSync(logsDir)) return { deleted: 0, files: [] };

  const years = readdirSync(logsDir).filter(f => /^\d{4}$/.test(f));

  for (const year of years) {
    const yearDir = join(logsDir, year);
    const months = readdirSync(yearDir).filter(f => f.endsWith('.json'));

    for (const monthFile of months) {
      const month = monthFile.replace('.json', '');
      // Check if the entire month is before cutoff
      const endOfMonth = new Date(parseInt(year), parseInt(month), 0);

      if (endOfMonth < cutoff) {
        const path = join(yearDir, monthFile);
        const entries = readLogFile(path);
        totalDeleted += entries.length;

        try {
          unlinkSync(path);
          deletedFiles.push(path);
        } catch (error) {
          console.error(`[audit] Failed to delete ${path}: ${error.message}`);
        }
      }
    }

    // Remove empty year directories
    try {
      const remaining = readdirSync(yearDir);
      if (remaining.length === 0) {
        const { rmdirSync } = require('node:fs');
        rmdirSync(yearDir);
      }
    } catch (e) {
      // Ignore errors removing directories
    }
  }

  return { deleted: totalDeleted, files: deletedFiles };
}

/**
 * Get statistics for audit logs
 *
 * @param {Object} options - Query options (days, from, to)
 * @returns {Object} - Statistics
 */
export function getStats(options = {}) {
  const result = query({
    days: options.days || 30,
    from: options.from,
    to: options.to,
  }, { limit: Number.MAX_SAFE_INTEGER });

  const stats = {
    total: result.total,
    from: result.from,
    to: result.to,
    byAction: {},
    byUser: {},
    byResult: {},
    byLevel: {},
    byDay: {},
    topIPs: {},
  };

  for (const entry of result.entries) {
    // By action
    stats.byAction[entry.action] = (stats.byAction[entry.action] || 0) + 1;

    // By user
    const username = entry.username || '(anonymous)';
    stats.byUser[username] = (stats.byUser[username] || 0) + 1;

    // By result
    stats.byResult[entry.result] = (stats.byResult[entry.result] || 0) + 1;

    // By level
    stats.byLevel[entry.level] = (stats.byLevel[entry.level] || 0) + 1;

    // By day
    const day = entry.timestamp.slice(0, 10);
    stats.byDay[day] = (stats.byDay[day] || 0) + 1;

    // By IP
    if (entry.ip) {
      stats.topIPs[entry.ip] = (stats.topIPs[entry.ip] || 0) + 1;
    }
  }

  // Sort byAction by count descending
  stats.byAction = Object.fromEntries(
    Object.entries(stats.byAction).sort((a, b) => b[1] - a[1])
  );

  // Sort byUser by count descending
  stats.byUser = Object.fromEntries(
    Object.entries(stats.byUser).sort((a, b) => b[1] - a[1])
  );

  // Limit topIPs to top 10
  stats.topIPs = Object.fromEntries(
    Object.entries(stats.topIPs).sort((a, b) => b[1] - a[1]).slice(0, 10)
  );

  return stats;
}

/**
 * Get a single audit entry by ID
 *
 * @param {string} id - Entry ID
 * @returns {Object|null} - Entry or null
 */
export function getEntry(id) {
  if (!logsDir || !existsSync(logsDir)) return null;

  // Flush pending writes first
  flush();

  // Search through all log files
  const years = readdirSync(logsDir).filter(f => /^\d{4}$/.test(f));

  for (const year of years) {
    const yearDir = join(logsDir, year);
    const months = readdirSync(yearDir).filter(f => f.endsWith('.json'));

    for (const monthFile of months) {
      const path = join(yearDir, monthFile);
      const entries = readLogFile(path);
      const entry = entries.find(e => e.id === id);

      if (entry) {
        return entry;
      }
    }
  }

  return null;
}

/**
 * Get list of available log files
 *
 * @returns {Array<{ year: string, month: string, path: string, size: number, count: number }>}
 */
export function listLogFiles() {
  if (!logsDir || !existsSync(logsDir)) return [];

  const files = [];
  const years = readdirSync(logsDir).filter(f => /^\d{4}$/.test(f)).sort().reverse();

  for (const year of years) {
    const yearDir = join(logsDir, year);
    const months = readdirSync(yearDir).filter(f => f.endsWith('.json')).sort().reverse();

    for (const monthFile of months) {
      const path = join(yearDir, monthFile);
      const entries = readLogFile(path);
      const fileStats = statSync(path);

      files.push({
        year,
        month: monthFile.replace('.json', ''),
        path,
        size: fileStats.size,
        count: entries.length,
      });
    }
  }

  return files;
}

/**
 * Get unique actions from logs
 *
 * @returns {string[]} - List of unique action names
 */
export function getUniqueActions() {
  const result = query({}, { limit: Number.MAX_SAFE_INTEGER });
  const actions = new Set();

  for (const entry of result.entries) {
    actions.add(entry.action);
  }

  return Array.from(actions).sort();
}

/**
 * Export audit logs to JSON or CSV
 *
 * @param {Object} filters - Query filters
 * @param {string} format - 'json' or 'csv'
 * @returns {string} - Exported data
 */
export function exportLogs(filters = {}, format = 'json') {
  const result = query(filters, { limit: Number.MAX_SAFE_INTEGER });

  if (format === 'csv') {
    const headers = ['id', 'timestamp', 'action', 'level', 'userId', 'username', 'ip', 'result', 'error', 'details'];
    const rows = result.entries.map(entry => [
      entry.id,
      entry.timestamp,
      entry.action,
      entry.level,
      entry.userId || '',
      entry.username || '',
      entry.ip || '',
      entry.result,
      entry.error || '',
      JSON.stringify(entry.details || {}),
    ]);

    const csvRows = [headers.join(',')];
    for (const row of rows) {
      csvRows.push(row.map(cell => {
        const str = String(cell);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(','));
    }

    return csvRows.join('\n');
  }

  return JSON.stringify({
    exported: new Date().toISOString(),
    filters,
    total: result.total,
    entries: result.entries,
  }, null, 2);
}

/**
 * Get audit configuration
 *
 * @returns {Object}
 */
export function getConfig() {
  return { ...config };
}

/**
 * Check if audit logging is enabled
 *
 * @returns {boolean}
 */
export function isEnabled() {
  return config.enabled;
}

/**
 * Convenience logging functions for common actions
 */

export function logAuth(action, user, req, details = {}, result = 'success', error = null) {
  return log(`auth.${action}`, details, { req, user, result, error });
}

export function logContent(action, type, id, user, req, extraDetails = {}) {
  return log(`content.${action}`, { type, id, ...extraDetails }, { req, user });
}

export function logUser(action, targetUser, user, req, extraDetails = {}) {
  return log(`user.${action}`, { targetUserId: targetUser?.id, targetUsername: targetUser?.username, ...extraDetails }, { req, user });
}

export function logPlugin(action, pluginName, user, req, extraDetails = {}) {
  return log(`plugin.${action}`, { plugin: pluginName, ...extraDetails }, { req, user });
}

export function logConfig(action, user, req, extraDetails = {}) {
  return log(`config.${action}`, extraDetails, { req, user });
}

export function logExport(action, user, req, extraDetails = {}) {
  return log(`export.${action}`, extraDetails, { req, user });
}

export function logImport(action, user, req, extraDetails = {}) {
  return log(`import.${action}`, extraDetails, { req, user });
}

export function logSystem(action, details = {}) {
  return log(`system.${action}`, details, {});
}
