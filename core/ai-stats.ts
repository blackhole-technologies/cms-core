/**
 * ai-stats.js - AI Usage Statistics Tracking Service
 *
 * WHY THIS EXISTS:
 * The CMS needs to track AI operations for monitoring, billing, and optimization.
 * This service logs AI provider calls, tokens used, costs, and response times.
 * Data is stored as daily JSON files for dashboard display and analysis.
 *
 * DESIGN DECISIONS:
 * - Daily JSON files in content/ai-stats/ (one file per day)
 * - In-memory buffer with batch writes (reduces I/O, improves performance)
 * - 30-day retention policy (older files archived/deleted)
 * - Aggregation methods for dashboard queries
 * - Integrates with ai-registry for automatic logging
 *
 * USAGE:
 *   const aiStats = services.get('ai-stats');
 *   aiStats.log({
 *     provider: 'anthropic',
 *     operation: 'chat.completion',
 *     tokensIn: 100,
 *     tokensOut: 50,
 *     cost: 0.0025,
 *     responseTime: 1250,
 *     status: 'success'
 *   });
 *   const daily = await aiStats.getDaily('2026-02-11');
 *   const total = await aiStats.getTotalCost();
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================================
// Types
// ============================================================================

/** Database pool interface (PostgreSQL) */
interface PgPool {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

/** AI event to log */
export interface AIEvent {
  provider: string;
  operation: string;
  tokensIn?: number;
  tokensOut?: number;
  cost?: number;
  responseTime?: number;
  status?: string;
  error?: string | null;
}

/** Full event with timestamp */
interface FullAIEvent {
  timestamp: string;
  provider: string;
  operation: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  responseTime: number;
  status: string;
  error: string | null;
}

/** Provider stats within aggregated results */
interface ProviderStats {
  count: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
}

/** Aggregated statistics */
interface AggregatedStats {
  label: string;
  totalEvents: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCost: number;
  avgResponseTime: number;
  byProvider: Record<string, ProviderStats>;
  byStatus: Record<string, number>;
}

/** Full log entry for request/response logging */
export interface FullLogEntry {
  provider: string;
  operation: string;
  request?: unknown;
  response?: unknown;
  responseTime?: number;
  status?: string;
  error?: string;
}

/** Stored full log entry */
interface StoredLogEntry {
  id: string;
  timestamp: string;
  provider: string;
  operation: string;
  status: string;
  responseTime: number;
  error: string | null;
  request: unknown;
  response: unknown;
}

/** Log entry summary (without full payloads) */
interface LogEntrySummary {
  id: string;
  timestamp: string;
  provider: string;
  operation: string;
  status: string;
  responseTime: number;
  error: string | null;
}

// ============================================================================
// State
// ============================================================================

/**
 * Database pool for PostgreSQL AI stats persistence.
 * When non-null, AI events are stored in `ai_stats` table.
 */
let dbPool: PgPool | null = null;

/**
 * Service state
 */
let baseDir: string | null = null;
let statsDir: string | null = null;
let logsDir: string | null = null;
let initialized: boolean = false;
let fullLoggingEnabled: boolean = false;

/**
 * In-memory buffer for batching writes
 * Reduces I/O by collecting events and writing periodically
 */
const eventBuffer: FullAIEvent[] = [];
const BUFFER_SIZE: number = 100; // Write after 100 events
const FLUSH_INTERVAL: number = 10000; // Write every 10 seconds
let flushTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Retention policy: keep last 30 days
 */
const RETENTION_DAYS: number = 30;

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Start the periodic flush timer
 */
function startFlushTimer(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
  }

  flushTimer = setInterval(() => {
    if (eventBuffer.length > 0) {
      flushBuffer();
    }
  }, FLUSH_INTERVAL);

  // Prevent timer from keeping process alive
  if (flushTimer.unref) {
    flushTimer.unref();
  }
}

/**
 * Flush the event buffer to disk
 * Writes all buffered events to the appropriate daily JSON file
 */
function flushBuffer(): void {
  if (eventBuffer.length === 0) {
    return;
  }

  // DB mode: persist to database
  if (dbPool) {
    persistEventsToDb(eventBuffer);
    const flushedCount = eventBuffer.length;
    eventBuffer.length = 0;
    console.log(`[ai-stats] Flushed ${flushedCount} events to database`);
    return;
  }

  if (!statsDir) return;

  // Flat-file mode: group events by date
  const eventsByDate: Map<string, FullAIEvent[]> = new Map();

  for (const event of eventBuffer) {
    const date = event.timestamp.split('T')[0] ?? ''; // Extract YYYY-MM-DD
    if (!eventsByDate.has(date)) {
      eventsByDate.set(date, []);
    }
    eventsByDate.get(date)!.push(event);
  }

  // Write each date's events to its file
  for (const [date, events] of eventsByDate.entries()) {
    const filePath = join(statsDir, `${date}.json`);

    // Read existing events if file exists
    let existingEvents: FullAIEvent[] = [];
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        existingEvents = JSON.parse(content) as FullAIEvent[];
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[ai-stats] Error reading ${filePath}:`, message);
      }
    }

    // Append new events
    const allEvents = [...existingEvents, ...events];

    // Write back to file
    try {
      writeFileSync(filePath, JSON.stringify(allEvents, null, 2), 'utf-8');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[ai-stats] Error writing ${filePath}:`, message);
    }
  }

  // Clear buffer
  const flushedCount = eventBuffer.length;
  eventBuffer.length = 0;

  console.log(`[ai-stats] Flushed ${flushedCount} events to disk`);
}

/**
 * Persist a batch of AI events to the database.
 */
function persistEventsToDb(events: FullAIEvent[]): void {
  if (!dbPool || events.length === 0) return;

  for (const e of events) {
    dbPool.query(
      `INSERT INTO ai_stats (timestamp, provider, operation, tokens_in, tokens_out,
                              cost, response_time, status, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [e.timestamp, e.provider, e.operation, e.tokensIn, e.tokensOut,
       e.cost, e.responseTime, e.status, e.error]
    ).catch((err: Error) => console.warn(`[ai-stats] Failed to persist to DB: ${err.message}`));
  }
}

/**
 * Query AI events from the database for a date range.
 * @param startDate - YYYY-MM-DD
 * @param endDate - YYYY-MM-DD
 * @param provider - Filter by provider
 * @returns Array of events or null if no DB
 */
async function queryEventsFromDb(startDate: string, endDate: string, provider: string | null = null): Promise<FullAIEvent[] | null> {
  if (!dbPool) return null;

  const conditions: string[] = [`timestamp >= $1`, `timestamp < $2`];
  const params: string[] = [`${startDate}T00:00:00.000Z`, `${endDate}T23:59:59.999Z`];
  let idx = 3;

  if (provider) {
    conditions.push(`provider = $${idx++}`);
    params.push(provider);
  }

  try {
    const result = await dbPool.query(
      `SELECT timestamp, provider, operation, tokens_in, tokens_out,
              cost, response_time, status, error
       FROM ai_stats
       WHERE ${conditions.join(' AND ')}
       ORDER BY timestamp ASC`,
      params
    );

    return result.rows.map((r: Record<string, unknown>) => ({
      timestamp: new Date(r.timestamp as string).toISOString(),
      provider: r.provider as string,
      operation: r.operation as string,
      tokensIn: Number(r.tokens_in) || 0,
      tokensOut: Number(r.tokens_out) || 0,
      cost: Number(r.cost) || 0,
      responseTime: Number(r.response_time) || 0,
      status: (r.status as string) || 'success',
      error: (r.error as string) || null,
    }));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[ai-stats] Failed to query from DB: ${message}`);
    return null;
  }
}

/**
 * Aggregate a list of events into summary statistics
 *
 * @param events - Array of event objects
 * @param label - Label for this aggregation (date, provider, etc.)
 * @returns Aggregated stats
 */
function aggregateEvents(events: FullAIEvent[], label: string): AggregatedStats {
  const stats: AggregatedStats = {
    label,
    totalEvents: events.length,
    totalTokensIn: 0,
    totalTokensOut: 0,
    totalCost: 0,
    avgResponseTime: 0,
    byProvider: {},
    byStatus: { success: 0, error: 0, timeout: 0 },
  };

  if (events.length === 0) {
    return stats;
  }

  let totalResponseTime = 0;

  for (const event of events) {
    stats.totalTokensIn += event.tokensIn || 0;
    stats.totalTokensOut += event.tokensOut || 0;
    stats.totalCost += event.cost || 0;
    totalResponseTime += event.responseTime || 0;

    // Count by provider
    if (!stats.byProvider[event.provider]) {
      stats.byProvider[event.provider] = {
        count: 0,
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
      };
    }
    stats.byProvider[event.provider]!.count++;
    stats.byProvider[event.provider]!.tokensIn += event.tokensIn || 0;
    stats.byProvider[event.provider]!.tokensOut += event.tokensOut || 0;
    stats.byProvider[event.provider]!.cost += event.cost || 0;

    // Count by status
    const status = event.status || 'success';
    if (stats.byStatus[status] !== undefined) {
      stats.byStatus[status]++;
    }
  }

  stats.avgResponseTime = totalResponseTime / events.length;

  return stats;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize AI stats service
 *
 * @param baseDirPath - Base directory (project root)
 */
export function init(baseDirPath: string): void {
  if (!baseDirPath) {
    throw new Error('[ai-stats] Base directory is required');
  }

  baseDir = baseDirPath;
  statsDir = join(baseDir, 'content', 'ai-stats');
  logsDir = join(baseDir, 'content', '.ai-logs');

  // Create stats directory if it doesn't exist
  if (!existsSync(statsDir)) {
    mkdirSync(statsDir, { recursive: true });
  }

  // Create full logs directory
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }

  // Start flush timer
  startFlushTimer();

  initialized = true;
  fullLoggingEnabled = true;
  console.log('[ai-stats] Service initialized (full logging enabled)');
}

/**
 * Log an AI operation
 *
 * @param event - AI operation event
 * @returns True if logged successfully
 */
export function log(event: AIEvent): boolean {
  if (!initialized) {
    console.error('[ai-stats] Service not initialized. Call init() first.');
    return false;
  }

  // Validate required fields
  if (!event.provider || !event.operation) {
    console.error('[ai-stats] Cannot log event: provider and operation are required');
    return false;
  }

  // Create full event with timestamp
  const fullEvent: FullAIEvent = {
    timestamp: new Date().toISOString(),
    provider: event.provider,
    operation: event.operation,
    tokensIn: event.tokensIn || 0,
    tokensOut: event.tokensOut || 0,
    cost: event.cost || 0,
    responseTime: event.responseTime || 0,
    status: event.status || 'success',
    error: event.error || null,
  };

  // Add to buffer
  eventBuffer.push(fullEvent);

  // Flush if buffer is full
  if (eventBuffer.length >= BUFFER_SIZE) {
    flushBuffer();
  }

  return true;
}

/**
 * Force flush the buffer (for testing or shutdown)
 */
export function flush(): void {
  flushBuffer();
}

/**
 * Set database pool for PostgreSQL AI stats persistence.
 * @param pool - Database pool
 */
export async function initDb(pool: PgPool): Promise<void> {
  dbPool = pool;
  console.log('[ai-stats] Using PostgreSQL for stats storage');
}

/**
 * Get daily statistics for a specific date
 *
 * @param date - Date in YYYY-MM-DD format
 * @returns Aggregated stats for the day
 */
export async function getDaily(date: string): Promise<AggregatedStats | null> {
  if (!initialized) {
    throw new Error('[ai-stats] Service not initialized. Call init() first.');
  }

  // DB mode: query from database
  if (dbPool) {
    flushBuffer();
    const events = await queryEventsFromDb(date, date);
    if (events) return aggregateEvents(events, date);
  }

  if (!statsDir) return null;

  // Flat-file mode
  const filePath = join(statsDir, `${date}.json`);

  if (!existsSync(filePath)) {
    return {
      label: date,
      totalEvents: 0,
      totalTokensIn: 0,
      totalTokensOut: 0,
      totalCost: 0,
      avgResponseTime: 0,
      byProvider: {},
      byStatus: { success: 0, error: 0, timeout: 0 },
    };
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const events = JSON.parse(content) as FullAIEvent[];

    return aggregateEvents(events, date);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ai-stats] Error reading ${filePath}:`, message);
    return null;
  }
}

/**
 * Get hourly statistics for a specific date
 *
 * @param date - Date in YYYY-MM-DD format
 * @returns Array of hourly stats (24 entries, one per hour)
 */
export function getHourly(date: string): AggregatedStats[] {
  if (!initialized) {
    throw new Error('[ai-stats] Service not initialized. Call init() first.');
  }

  if (!statsDir) return [];

  const filePath = join(statsDir, `${date}.json`);

  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const events = JSON.parse(content) as FullAIEvent[];

    // Group by hour
    const byHour: Map<number, FullAIEvent[]> = new Map();
    for (let i = 0; i < 24; i++) {
      byHour.set(i, []);
    }

    for (const event of events) {
      const hour = new Date(event.timestamp).getHours();
      byHour.get(hour)!.push(event);
    }

    // Aggregate each hour
    const hourlyStats: AggregatedStats[] = [];
    for (let i = 0; i < 24; i++) {
      const hourEvents = byHour.get(i)!;
      hourlyStats.push(aggregateEvents(hourEvents, `${date} ${i}:00`));
    }

    return hourlyStats;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ai-stats] Error reading ${filePath}:`, message);
    return [];
  }
}

/**
 * Get statistics by provider
 *
 * @param provider - Provider name
 * @param days - Number of days to look back
 * @returns Aggregated stats for the provider
 */
export async function getByProvider(provider: string, days: number = 30): Promise<AggregatedStats> {
  if (!initialized) {
    throw new Error('[ai-stats] Service not initialized. Call init() first.');
  }

  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - days);
  const startStr = startDate.toISOString().split('T')[0] ?? '';
  const endStr = today.toISOString().split('T')[0] ?? '';

  // DB mode: query from database
  if (dbPool) {
    flushBuffer();
    const events = await queryEventsFromDb(startStr, endStr, provider);
    if (events) return aggregateEvents(events, `last ${days} days`);
  }

  if (!statsDir) return aggregateEvents([], `last ${days} days`);

  // Flat-file mode
  const allEvents: FullAIEvent[] = [];

  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    const filePath = join(statsDir, `${dateStr}.json`);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const events = JSON.parse(content) as FullAIEvent[];
        allEvents.push(...events.filter(e => e.provider === provider));
      } catch {
        // Skip files with errors
      }
    }
  }

  return aggregateEvents(allEvents, `last ${days} days`);
}

/**
 * Get total cost across all providers
 *
 * @param days - Number of days to look back
 * @returns Total cost in dollars
 */
export async function getTotalCost(days: number = 30): Promise<number> {
  if (!initialized) {
    throw new Error('[ai-stats] Service not initialized. Call init() first.');
  }

  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - days);

  // DB mode: aggregate directly in SQL
  if (dbPool) {
    flushBuffer();
    try {
      const result = await dbPool.query(
        `SELECT COALESCE(SUM(cost), 0) AS total_cost
         FROM ai_stats
         WHERE timestamp >= $1`,
        [startDate.toISOString()]
      );
      return Number(result.rows[0]?.total_cost) || 0;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[ai-stats] Failed to get total cost from DB: ${message}`);
    }
  }

  if (!statsDir) return 0;

  // Flat-file mode
  let totalCost = 0;

  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    const filePath = join(statsDir, `${dateStr}.json`);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const events = JSON.parse(content) as FullAIEvent[];
        totalCost += events.reduce((sum, e) => sum + (e.cost || 0), 0);
      } catch {
        // Skip files with errors
      }
    }
  }

  return totalCost;
}

/**
 * Rotate old stats files (archive or delete files older than retention period)
 */
export function rotateFiles(): number {
  if (!initialized) {
    throw new Error('[ai-stats] Service not initialized. Call init() first.');
  }

  if (!statsDir) return 0;

  const today = new Date();
  const cutoffDate = new Date(today);
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

  const files = readdirSync(statsDir);
  let deletedCount = 0;

  for (const file of files) {
    if (!file.endsWith('.json')) {
      continue;
    }

    // Extract date from filename (YYYY-MM-DD.json)
    const dateStr = file.replace('.json', '');
    const fileDate = new Date(dateStr);

    if (fileDate < cutoffDate) {
      const filePath = join(statsDir, file);
      try {
        unlinkSync(filePath);
        deletedCount++;
        console.log(`[ai-stats] Deleted old stats file: ${file}`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[ai-stats] Error deleting ${file}:`, message);
      }
    }
  }

  if (deletedCount > 0) {
    console.log(`[ai-stats] Rotated ${deletedCount} old stats files`);
  }

  return deletedCount;
}

/**
 * Get list of available stats dates
 *
 * @returns Array of date strings in YYYY-MM-DD format
 */
export function getAvailableDates(): string[] {
  if (!initialized) {
    throw new Error('[ai-stats] Service not initialized. Call init() first.');
  }

  if (!statsDir) return [];

  const files = readdirSync(statsDir);
  return files
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
    .sort()
    .reverse(); // Most recent first
}

/**
 * Clear all stats (for testing)
 */
export function clear(): void {
  if (eventBuffer.length > 0) {
    eventBuffer.length = 0;
  }
  console.log('[ai-stats] Buffer cleared');
}

/**
 * Shutdown the service (flush buffer and stop timer)
 */
export function shutdown(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  flushBuffer();
  console.log('[ai-stats] Service shut down');
}

// ============================================
// FULL REQUEST/RESPONSE LOGGING
// ============================================

/**
 * Log a full AI request/response payload for debugging and auditing.
 * Stored as individual JSON files in content/.ai-logs/<date>/
 *
 * @param entry - Full log entry
 * @returns Log entry ID, or null if logging is disabled
 */
export function logFullRequest(entry: FullLogEntry): string | null {
  if (!initialized || !fullLoggingEnabled || !logsDir) return null;

  const now = new Date();
  const date = now.toISOString().split('T')[0] ?? '';
  const dayDir = join(logsDir, date);

  if (!existsSync(dayDir)) {
    mkdirSync(dayDir, { recursive: true });
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const logEntry: StoredLogEntry = {
    id,
    timestamp: now.toISOString(),
    provider: entry.provider,
    operation: entry.operation,
    status: entry.status || 'success',
    responseTime: entry.responseTime || 0,
    error: entry.error || null,
    request: entry.request,
    response: entry.response,
  };

  try {
    writeFileSync(join(dayDir, `${id}.json`), JSON.stringify(logEntry, null, 2), 'utf-8');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ai-stats] Error writing full log: ${message}`);
    return null;
  }

  return id;
}

/**
 * Get a specific full log entry by date and ID.
 *
 * @param date - Date in YYYY-MM-DD format
 * @param id - Log entry ID
 * @returns Full log entry or null
 */
export function getFullLog(date: string, id: string): StoredLogEntry | null {
  if (!initialized || !logsDir) return null;

  const filePath = join(logsDir, date, `${id}.json`);
  if (!existsSync(filePath)) return null;

  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as StoredLogEntry;
  } catch {
    return null;
  }
}

/**
 * List full log entries for a specific date.
 *
 * @param date - Date in YYYY-MM-DD format
 * @param limit - Max entries to return
 * @returns Log entry summaries (without full payloads)
 */
export function listFullLogs(date: string, limit: number = 50): LogEntrySummary[] {
  if (!initialized || !logsDir) return [];

  const dayDir = join(logsDir, date);
  if (!existsSync(dayDir)) return [];

  try {
    const files = readdirSync(dayDir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, limit);

    return files.map(f => {
      try {
        const data = JSON.parse(readFileSync(join(dayDir, f), 'utf-8')) as StoredLogEntry;
        // Return summary without full payloads
        return {
          id: data.id,
          timestamp: data.timestamp,
          provider: data.provider,
          operation: data.operation,
          status: data.status,
          responseTime: data.responseTime,
          error: data.error,
        };
      } catch {
        return null;
      }
    }).filter((entry): entry is LogEntrySummary => entry !== null);
  } catch {
    return [];
  }
}

/**
 * Enable or disable full request/response logging.
 *
 * @param enabled - Whether to enable full logging
 */
export function setFullLogging(enabled: boolean): void {
  fullLoggingEnabled = !!enabled;
  console.log(`[ai-stats] Full logging ${fullLoggingEnabled ? 'enabled' : 'disabled'}`);
}

/**
 * Check if full logging is enabled.
 * @returns True if enabled
 */
export function isFullLoggingEnabled(): boolean {
  return fullLoggingEnabled;
}

/**
 * Service name for registration
 */
export const name: string = 'ai-stats';
