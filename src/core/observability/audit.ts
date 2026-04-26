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

import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

// ============================================================================
// Types
// ============================================================================

/** Audit configuration */
interface AuditConfig {
  enabled: boolean;
  retention: number;
  logLevel: string;
  excludeActions: string[];
}

/** Database pool interface */
interface PgPool {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

/** Audit log entry */
interface AuditEntry {
  id: string;
  timestamp: string;
  action: string;
  level: string;
  userId: string | null;
  username: string | null;
  ip: string | null;
  userAgent: string | null;
  details: Record<string, unknown>;
  result: string;
  error: string | null;
}

/** HTTP request (minimal interface) */
interface HttpRequest {
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

/** User context */
interface UserContext {
  id?: string;
  username?: string;
  email?: string;
}

/** Log context passed to log() */
interface LogContext {
  req?: HttpRequest;
  user?: UserContext;
  result?: string;
  error?: string | null;
}

/** Query filters */
interface QueryFilters {
  action?: string | null;
  userId?: string | null;
  username?: string | null;
  ip?: string | null;
  result?: string | null;
  level?: string | null;
  from?: string | null;
  to?: string | null;
  days?: number | null;
  search?: string | null;
}

/** Query options */
interface QueryOptions {
  limit?: number;
  offset?: number;
  sortOrder?: 'asc' | 'desc';
}

/** Query result */
interface QueryResult {
  entries: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
  from?: string;
  to?: string;
}

/** Log file info */
interface LogFileInfo {
  year: string;
  month: string;
  path: string;
  size: number;
  count: number;
}

/** Prune result */
interface PruneResult {
  deleted: number;
  files: string[];
}

/** Audit stats */
interface AuditStats {
  total: number;
  from: string | undefined;
  to: string | undefined;
  byAction: Record<string, number>;
  byUser: Record<string, number>;
  byResult: Record<string, number>;
  byLevel: Record<string, number>;
  byDay: Record<string, number>;
  topIPs: Record<string, number>;
}

/** Target user for logUser */
interface TargetUser {
  id?: string;
  username?: string;
}

// ============================================================================
// State
// ============================================================================

/**
 * Configuration
 */
let config: AuditConfig = {
  enabled: true,
  retention: 90, // Days to keep logs (0 = forever)
  logLevel: 'info', // info, warning, security
  excludeActions: [], // Actions to exclude from logging
};

/**
 * Log levels hierarchy
 */
const LOG_LEVELS: Record<string, number> = {
  info: 0,
  warning: 1,
  security: 2,
};

/**
 * Database pool for PostgreSQL audit persistence.
 * When non-null, audit entries are stored in `audit_log` table.
 */
let dbPool: PgPool | null = null;

/**
 * Base directory for logs
 */
let baseDir: string | null = null;
let logsDir: string | null = null;

/**
 * In-memory buffer for batch writes
 */
let writeBuffer: AuditEntry[] = [];
let flushInterval: ReturnType<typeof setInterval> | null = null;
const FLUSH_INTERVAL_MS: number = 5000;
const BUFFER_SIZE: number = 50;

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize audit system
 *
 * @param dir - Base directory
 * @param auditConfig - Audit configuration
 */
export function init(dir: string, auditConfig: Partial<AuditConfig> = {}): void {
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
 * @param date - Date to get path for
 * @returns Path to log file
 */
function getLogPath(date: Date = new Date()): string {
  const year = date.getFullYear().toString();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');

  const yearDir = join(logsDir!, year);
  if (!existsSync(yearDir)) {
    mkdirSync(yearDir, { recursive: true });
  }

  return join(yearDir, `${month}.json`);
}

/**
 * Read log file
 *
 * @param path - Path to log file
 * @returns Log entries
 */
function readLogFile(path: string): AuditEntry[] {
  if (!existsSync(path)) {
    return [];
  }

  try {
    const data = readFileSync(path, 'utf-8');
    return JSON.parse(data) as AuditEntry[];
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[audit] Failed to read log file ${path}: ${message}`);
    return [];
  }
}

/**
 * Write log file (flat-file mode only).
 *
 * @param path - Path to log file
 * @param entries - Log entries
 */
function writeLogFile(path: string, entries: AuditEntry[]): void {
  if (dbPool) return; // DB mode: flush writes directly to DB

  try {
    writeFileSync(path, JSON.stringify(entries, null, 2) + '\n');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[audit] Failed to write log file ${path}: ${message}`);
  }
}

/**
 * Set database pool for PostgreSQL audit persistence.
 * @param pool - PostgreSQL pool instance
 */
export async function initDb(pool: PgPool): Promise<void> {
  dbPool = pool;
  console.log('[audit] Using PostgreSQL for audit storage');
}

/**
 * Persist a batch of audit entries to the database.
 */
function persistEntriesToDb(entries: AuditEntry[]): void {
  if (!dbPool || entries.length === 0) return;

  for (const e of entries) {
    dbPool
      .query(
        `INSERT INTO audit_log (id, timestamp, action, level, user_id, username, ip, user_agent, details, result, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO NOTHING`,
        [
          e.id,
          e.timestamp,
          e.action,
          e.level,
          e.userId,
          e.username,
          e.ip,
          e.userAgent,
          JSON.stringify(e.details || {}),
          e.result,
          e.error,
        ]
      )
      .catch((err: Error) => console.warn(`[audit] Failed to persist to DB: ${err.message}`));
  }
}

/**
 * Query audit entries from the database.
 *
 * @param filters - Query filters
 * @param options - Query options
 * @returns Query result or null if no DB
 */
async function queryFromDb(
  filters: QueryFilters,
  options: QueryOptions
): Promise<QueryResult | null> {
  if (!dbPool) return null;

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

  const { limit = 100, offset = 0, sortOrder = 'desc' } = options;

  const toDate = to ? new Date(to) : new Date();
  let fromDate: Date;
  if (from) {
    fromDate = new Date(from);
  } else if (days) {
    fromDate = new Date(toDate.getTime() - days * 24 * 60 * 60 * 1000);
  } else {
    fromDate = new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  const conditions: string[] = [`timestamp >= $1`, `timestamp <= $2`];
  const params: unknown[] = [fromDate.toISOString(), toDate.toISOString()];
  let idx = 3;

  if (action) {
    if (action.endsWith('.*')) {
      conditions.push(`action LIKE $${idx++}`);
      params.push(action.slice(0, -2) + '%');
    } else {
      conditions.push(`action = $${idx++}`);
      params.push(action);
    }
  }
  if (userId) {
    conditions.push(`user_id = $${idx++}`);
    params.push(userId);
  }
  if (username) {
    conditions.push(`username = $${idx++}`);
    params.push(username);
  }
  if (ip) {
    conditions.push(`ip = $${idx++}`);
    params.push(ip);
  }
  if (result) {
    conditions.push(`result = $${idx++}`);
    params.push(result);
  }
  if (level) {
    conditions.push(`level = $${idx++}`);
    params.push(level);
  }
  if (search) {
    conditions.push(
      `(action ILIKE $${idx} OR username ILIKE $${idx} OR details::text ILIKE $${idx})`
    );
    params.push(`%${search}%`);
    idx++;
  }

  const where = conditions.join(' AND ');
  const order = sortOrder === 'desc' ? 'DESC' : 'ASC';

  try {
    // Get total count
    const countResult = await dbPool.query(
      `SELECT COUNT(*) AS total FROM audit_log WHERE ${where}`,
      params
    );
    const total = Number(countResult.rows[0]?.total) || 0;

    // Get paginated results
    const dataResult = await dbPool.query(
      `SELECT id, timestamp, action, level, user_id, username, ip, user_agent, details, result, error
       FROM audit_log
       WHERE ${where}
       ORDER BY timestamp ${order}
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, String(limit), String(offset)]
    );

    const entries: AuditEntry[] = dataResult.rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      timestamp: new Date(r.timestamp as string).toISOString(),
      action: r.action as string,
      level: r.level as string,
      userId: r.user_id as string | null,
      username: r.username as string | null,
      ip: r.ip as string | null,
      userAgent: r.user_agent as string | null,
      details:
        typeof r.details === 'string'
          ? (JSON.parse(r.details) as Record<string, unknown>)
          : ((r.details || {}) as Record<string, unknown>),
      result: r.result as string,
      error: r.error as string | null,
    }));

    return {
      entries,
      total,
      limit,
      offset,
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[audit] Failed to query from DB: ${message}`);
    return null;
  }
}

/**
 * Flush buffer to disk (or database)
 */
export function flush(): void {
  if (writeBuffer.length === 0) return;

  // DB mode: persist directly to database
  if (dbPool) {
    persistEntriesToDb(writeBuffer);
    writeBuffer = [];
    return;
  }

  // Flat-file mode: group entries by month
  const byMonth: Record<string, AuditEntry[]> = {};
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
 * @param req - HTTP request
 * @returns Client IP or null
 */
function getClientIP(req: HttpRequest | undefined): string | null {
  if (!req) return null;

  // Check for forwarded headers (behind proxy)
  const forwarded = req.headers?.['x-forwarded-for'];
  if (forwarded) {
    const forwardedStr = Array.isArray(forwarded) ? (forwarded[0] ?? '') : forwarded;
    return (forwardedStr.split(',')[0] ?? '').trim();
  }

  const realIP = req.headers?.['x-real-ip'];
  if (realIP) {
    return Array.isArray(realIP) ? (realIP[0] ?? null) : realIP;
  }

  return req.socket?.remoteAddress || null;
}

/**
 * Get log level for an action
 *
 * @param action - Action name
 * @returns Log level
 */
function getActionLevel(action: string): string {
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
 * @param action - Action identifier (e.g., 'content.create')
 * @param details - Action details
 * @param context - Request context (req, user)
 * @returns Created entry or null if disabled
 */
export function log(
  action: string,
  details: Record<string, unknown> = {},
  context: LogContext = {}
): AuditEntry | null {
  if (!config.enabled || !logsDir) return null;

  // Check if action is excluded
  if (config.excludeActions.includes(action)) {
    return null;
  }

  // Check log level
  const actionLevel = getActionLevel(action);
  if ((LOG_LEVELS[actionLevel] ?? 0) < (LOG_LEVELS[config.logLevel] ?? 0)) {
    return null;
  }

  const { req, user, result = 'success', error = null } = context;

  const entry: AuditEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    action,
    level: actionLevel,
    userId: user?.id || null,
    username: user?.username || user?.email || null,
    ip: getClientIP(req),
    userAgent: (req?.headers?.['user-agent'] as string) || null,
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
 * @param filters - Query filters
 * @param options - Query options
 * @returns Query result
 */
export function query(
  filters: QueryFilters = {},
  options: QueryOptions = {}
): QueryResult | Promise<QueryResult | null> {
  if (!logsDir && !dbPool) return { entries: [], total: 0, limit: 100, offset: 0 };

  // Flush pending writes first
  flush();

  // DB mode: delegate to database query
  if (dbPool) {
    return queryFromDb(filters, options);
  }

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

  const { limit = 100, offset = 0, sortOrder = 'desc' } = options;

  // Determine date range
  const toDate = to ? new Date(to) : new Date();
  let fromDate: Date;

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
  let allEntries: AuditEntry[] = [];

  for (const path of logFiles) {
    const entries = readLogFile(path);
    allEntries = allEntries.concat(entries);
  }

  // Apply filters
  const filtered = allEntries.filter((entry: AuditEntry) => {
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
      const searchable = [entry.action, entry.username, JSON.stringify(entry.details)]
        .join(' ')
        .toLowerCase();

      if (!searchable.includes(searchLower)) return false;
    }

    return true;
  });

  // Sort by timestamp
  filtered.sort((a, b) => {
    const diff = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
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
 * @param from - Start date
 * @param to - End date
 * @returns Array of log file paths
 */
function getLogFilesInRange(from: Date, to: Date): string[] {
  if (!existsSync(logsDir!)) return [];

  const files: string[] = [];

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
 * @param userId - User ID
 * @param options - Query options
 * @returns Query result
 */
export function getByUser(
  userId: string,
  options: QueryOptions = {}
): QueryResult | Promise<QueryResult | null> {
  return query({ userId }, options);
}

/**
 * Get audit logs for content item
 *
 * @param type - Content type
 * @param id - Content ID
 * @param options - Query options
 * @returns Query result
 */
export function getByContent(type: string, id: string, options: QueryOptions = {}): QueryResult {
  const result = query(
    { action: 'content.*' },
    { ...options, limit: Number.MAX_SAFE_INTEGER }
  ) as QueryResult;

  // Filter by content type and id in details
  const filtered = result.entries.filter((entry: AuditEntry) => {
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
 * @param olderThan - Days (number) or Date to delete before
 * @returns Prune result
 */
export function prune(olderThan: number | Date | null = null): PruneResult {
  if (!logsDir) return { deleted: 0, files: [] };

  let cutoff: Date;

  if (olderThan instanceof Date) {
    cutoff = olderThan;
  } else {
    const days = olderThan ?? config.retention;
    if (days <= 0) return { deleted: 0, files: [] };

    cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
  }

  const deletedFiles: string[] = [];
  let totalDeleted = 0;

  // Find all year directories
  if (!existsSync(logsDir)) return { deleted: 0, files: [] };

  const years = readdirSync(logsDir).filter((f: string) => /^\d{4}$/.test(f));

  for (const year of years) {
    const yearDir = join(logsDir, year);
    const months = readdirSync(yearDir).filter((f: string) => f.endsWith('.json'));

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
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[audit] Failed to delete ${path}: ${message}`);
        }
      }
    }

    // Remove empty year directories
    try {
      const remaining = readdirSync(yearDir);
      if (remaining.length === 0) {
        rmdirSync(yearDir);
      }
    } catch (_e: unknown) {
      // Ignore errors removing directories
    }
  }

  return { deleted: totalDeleted, files: deletedFiles };
}

/**
 * Get statistics for audit logs
 *
 * @param options - Query options (days, from, to)
 * @returns Statistics
 */
export function getStats(options: { days?: number; from?: string; to?: string } = {}): AuditStats {
  const result = query(
    {
      days: options.days || 30,
      from: options.from || null,
      to: options.to || null,
    },
    { limit: Number.MAX_SAFE_INTEGER }
  ) as QueryResult;

  const stats: AuditStats = {
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
  stats.byAction = Object.fromEntries(Object.entries(stats.byAction).sort((a, b) => b[1] - a[1]));

  // Sort byUser by count descending
  stats.byUser = Object.fromEntries(Object.entries(stats.byUser).sort((a, b) => b[1] - a[1]));

  // Limit topIPs to top 10
  stats.topIPs = Object.fromEntries(
    Object.entries(stats.topIPs)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
  );

  return stats;
}

/**
 * Get a single audit entry by ID
 *
 * @param id - Entry ID
 * @returns Entry or null
 */
export async function getEntry(id: string): Promise<AuditEntry | null> {
  // Flush pending writes first
  flush();

  // DB mode: query by ID
  if (dbPool) {
    try {
      const result = await dbPool.query(
        `SELECT id, timestamp, action, level, user_id, username, ip, user_agent, details, result, error
         FROM audit_log WHERE id = $1`,
        [id]
      );
      if (result.rows.length === 0) return null;
      const r = result.rows[0]!;
      return {
        id: r.id as string,
        timestamp: new Date(r.timestamp as string).toISOString(),
        action: r.action as string,
        level: r.level as string,
        userId: r.user_id as string | null,
        username: r.username as string | null,
        ip: r.ip as string | null,
        userAgent: r.user_agent as string | null,
        details:
          typeof r.details === 'string'
            ? (JSON.parse(r.details) as Record<string, unknown>)
            : ((r.details || {}) as Record<string, unknown>),
        result: r.result as string,
        error: r.error as string | null,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[audit] Failed to get entry from DB: ${message}`);
      return null;
    }
  }

  if (!logsDir || !existsSync(logsDir)) return null;

  // Search through all log files
  const years = readdirSync(logsDir).filter((f: string) => /^\d{4}$/.test(f));

  for (const year of years) {
    const yearDir = join(logsDir, year);
    const months = readdirSync(yearDir).filter((f: string) => f.endsWith('.json'));

    for (const monthFile of months) {
      const path = join(yearDir, monthFile);
      const entries = readLogFile(path);
      const entry = entries.find((e: AuditEntry) => e.id === id);

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
 * @returns Array of log file info
 */
export function listLogFiles(): LogFileInfo[] {
  if (!logsDir || !existsSync(logsDir)) return [];

  const files: LogFileInfo[] = [];
  const years = readdirSync(logsDir)
    .filter((f: string) => /^\d{4}$/.test(f))
    .sort()
    .reverse();

  for (const year of years) {
    const yearDir = join(logsDir, year);
    const months = readdirSync(yearDir)
      .filter((f: string) => f.endsWith('.json'))
      .sort()
      .reverse();

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
 * @returns List of unique action names
 */
export function getUniqueActions(): string[] {
  const result = query({}, { limit: Number.MAX_SAFE_INTEGER }) as QueryResult;
  const actions: Set<string> = new Set();

  for (const entry of result.entries) {
    actions.add(entry.action);
  }

  return Array.from(actions).sort();
}

/**
 * Export audit logs to JSON or CSV
 *
 * @param filters - Query filters
 * @param format - 'json' or 'csv'
 * @returns Exported data
 */
export function exportLogs(filters: QueryFilters = {}, format: 'json' | 'csv' = 'json'): string {
  const result = query(filters, { limit: Number.MAX_SAFE_INTEGER }) as QueryResult;

  if (format === 'csv') {
    const headers = [
      'id',
      'timestamp',
      'action',
      'level',
      'userId',
      'username',
      'ip',
      'result',
      'error',
      'details',
    ];
    const rows = result.entries.map((entry: AuditEntry) => [
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

    const csvRows: string[] = [headers.join(',')];
    for (const row of rows) {
      csvRows.push(
        row
          .map((cell: string | null) => {
            const str = String(cell);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          })
          .join(',')
      );
    }

    return csvRows.join('\n');
  }

  return JSON.stringify(
    {
      exported: new Date().toISOString(),
      filters,
      total: result.total,
      entries: result.entries,
    },
    null,
    2
  );
}

/**
 * Get audit configuration
 *
 * @returns Audit config copy
 */
export function getConfig(): AuditConfig {
  return { ...config };
}

/**
 * Check if audit logging is enabled
 *
 * @returns True if enabled
 */
export function isEnabled(): boolean {
  return config.enabled;
}

/**
 * Convenience logging functions for common actions
 */

export function logAuth(
  action: string,
  user: UserContext | undefined,
  req: HttpRequest | undefined,
  details: Record<string, unknown> = {},
  result: string = 'success',
  error: string | null = null
): AuditEntry | null {
  return log(`auth.${action}`, details, { req, user, result, error });
}

export function logContent(
  action: string,
  type: string,
  id: string,
  user: UserContext | undefined,
  req: HttpRequest | undefined,
  extraDetails: Record<string, unknown> = {}
): AuditEntry | null {
  return log(`content.${action}`, { type, id, ...extraDetails }, { req, user });
}

export function logUser(
  action: string,
  targetUser: TargetUser | undefined,
  user: UserContext | undefined,
  req: HttpRequest | undefined,
  extraDetails: Record<string, unknown> = {}
): AuditEntry | null {
  return log(
    `user.${action}`,
    { targetUserId: targetUser?.id, targetUsername: targetUser?.username, ...extraDetails },
    { req, user }
  );
}

export function logPlugin(
  action: string,
  pluginName: string,
  user: UserContext | undefined,
  req: HttpRequest | undefined,
  extraDetails: Record<string, unknown> = {}
): AuditEntry | null {
  return log(`plugin.${action}`, { plugin: pluginName, ...extraDetails }, { req, user });
}

export function logConfig(
  action: string,
  user: UserContext | undefined,
  req: HttpRequest | undefined,
  extraDetails: Record<string, unknown> = {}
): AuditEntry | null {
  return log(`config.${action}`, extraDetails, { req, user });
}

export function logExport(
  action: string,
  user: UserContext | undefined,
  req: HttpRequest | undefined,
  extraDetails: Record<string, unknown> = {}
): AuditEntry | null {
  return log(`export.${action}`, extraDetails, { req, user });
}

export function logImport(
  action: string,
  user: UserContext | undefined,
  req: HttpRequest | undefined,
  extraDetails: Record<string, unknown> = {}
): AuditEntry | null {
  return log(`import.${action}`, extraDetails, { req, user });
}

export function logSystem(
  action: string,
  details: Record<string, unknown> = {}
): AuditEntry | null {
  return log(`system.${action}`, details, {});
}
