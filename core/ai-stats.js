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

/**
 * Service state
 */
let baseDir = null;
let statsDir = null;
let logsDir = null;
let initialized = false;
let fullLoggingEnabled = false;

/**
 * In-memory buffer for batching writes
 * Reduces I/O by collecting events and writing periodically
 */
const eventBuffer = [];
const BUFFER_SIZE = 100; // Write after 100 events
const FLUSH_INTERVAL = 10000; // Write every 10 seconds
let flushTimer = null;

/**
 * Retention policy: keep last 30 days
 */
const RETENTION_DAYS = 30;

/**
 * Initialize AI stats service
 *
 * @param {string} baseDirPath - Base directory (project root)
 */
export function init(baseDirPath) {
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
 * Start the periodic flush timer
 */
function startFlushTimer() {
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
 * Log an AI operation
 *
 * @param {Object} event - AI operation event
 * @param {string} event.provider - Provider name (e.g., 'anthropic', 'openai')
 * @param {string} event.operation - Operation type (e.g., 'chat.completion', 'embeddings')
 * @param {number} [event.tokensIn] - Input tokens used
 * @param {number} [event.tokensOut] - Output tokens used
 * @param {number} [event.cost] - Cost in dollars
 * @param {number} [event.responseTime] - Response time in milliseconds
 * @param {string} [event.status='success'] - Status: success|error|timeout
 * @param {string} [event.error] - Error message if status is error
 */
export function log(event) {
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
  const fullEvent = {
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
 * Flush the event buffer to disk
 * Writes all buffered events to the appropriate daily JSON file
 */
function flushBuffer() {
  if (eventBuffer.length === 0) {
    return;
  }

  // Group events by date
  const eventsByDate = new Map();

  for (const event of eventBuffer) {
    const date = event.timestamp.split('T')[0]; // Extract YYYY-MM-DD
    if (!eventsByDate.has(date)) {
      eventsByDate.set(date, []);
    }
    eventsByDate.get(date).push(event);
  }

  // Write each date's events to its file
  for (const [date, events] of eventsByDate.entries()) {
    const filePath = join(statsDir, `${date}.json`);

    // Read existing events if file exists
    let existingEvents = [];
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        existingEvents = JSON.parse(content);
      } catch (err) {
        console.error(`[ai-stats] Error reading ${filePath}:`, err.message);
      }
    }

    // Append new events
    const allEvents = [...existingEvents, ...events];

    // Write back to file
    try {
      writeFileSync(filePath, JSON.stringify(allEvents, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[ai-stats] Error writing ${filePath}:`, err.message);
    }
  }

  // Clear buffer
  const flushedCount = eventBuffer.length;
  eventBuffer.length = 0;

  console.log(`[ai-stats] Flushed ${flushedCount} events to disk`);
}

/**
 * Force flush the buffer (for testing or shutdown)
 */
export function flush() {
  flushBuffer();
}

/**
 * Get daily statistics for a specific date
 *
 * @param {string} date - Date in YYYY-MM-DD format
 * @returns {Object} - Aggregated stats for the day
 */
export function getDaily(date) {
  if (!initialized) {
    throw new Error('[ai-stats] Service not initialized. Call init() first.');
  }

  const filePath = join(statsDir, `${date}.json`);

  if (!existsSync(filePath)) {
    return {
      date,
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
    const events = JSON.parse(content);

    return aggregateEvents(events, date);
  } catch (err) {
    console.error(`[ai-stats] Error reading ${filePath}:`, err.message);
    return null;
  }
}

/**
 * Get hourly statistics for a specific date
 *
 * @param {string} date - Date in YYYY-MM-DD format
 * @returns {Array} - Array of hourly stats (24 entries, one per hour)
 */
export function getHourly(date) {
  if (!initialized) {
    throw new Error('[ai-stats] Service not initialized. Call init() first.');
  }

  const filePath = join(statsDir, `${date}.json`);

  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const events = JSON.parse(content);

    // Group by hour
    const byHour = new Map();
    for (let i = 0; i < 24; i++) {
      byHour.set(i, []);
    }

    for (const event of events) {
      const hour = new Date(event.timestamp).getHours();
      byHour.get(hour).push(event);
    }

    // Aggregate each hour
    const hourlyStats = [];
    for (let i = 0; i < 24; i++) {
      const hourEvents = byHour.get(i);
      hourlyStats.push(aggregateEvents(hourEvents, `${date} ${i}:00`));
    }

    return hourlyStats;
  } catch (err) {
    console.error(`[ai-stats] Error reading ${filePath}:`, err.message);
    return [];
  }
}

/**
 * Get statistics by provider
 *
 * @param {string} provider - Provider name
 * @param {number} [days=30] - Number of days to look back
 * @returns {Object} - Aggregated stats for the provider
 */
export function getByProvider(provider, days = 30) {
  if (!initialized) {
    throw new Error('[ai-stats] Service not initialized. Call init() first.');
  }

  const allEvents = [];
  const today = new Date();

  // Read events from last N days
  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    const filePath = join(statsDir, `${dateStr}.json`);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const events = JSON.parse(content);
        allEvents.push(...events.filter(e => e.provider === provider));
      } catch (err) {
        // Skip files with errors
      }
    }
  }

  return aggregateEvents(allEvents, `last ${days} days`);
}

/**
 * Get total cost across all providers
 *
 * @param {number} [days=30] - Number of days to look back
 * @returns {number} - Total cost in dollars
 */
export function getTotalCost(days = 30) {
  if (!initialized) {
    throw new Error('[ai-stats] Service not initialized. Call init() first.');
  }

  let totalCost = 0;
  const today = new Date();

  // Read events from last N days
  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    const filePath = join(statsDir, `${dateStr}.json`);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const events = JSON.parse(content);
        totalCost += events.reduce((sum, e) => sum + (e.cost || 0), 0);
      } catch (err) {
        // Skip files with errors
      }
    }
  }

  return totalCost;
}

/**
 * Aggregate a list of events into summary statistics
 *
 * @param {Array} events - Array of event objects
 * @param {string} label - Label for this aggregation (date, provider, etc.)
 * @returns {Object} - Aggregated stats
 */
function aggregateEvents(events, label) {
  const stats = {
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
    stats.byProvider[event.provider].count++;
    stats.byProvider[event.provider].tokensIn += event.tokensIn || 0;
    stats.byProvider[event.provider].tokensOut += event.tokensOut || 0;
    stats.byProvider[event.provider].cost += event.cost || 0;

    // Count by status
    const status = event.status || 'success';
    if (stats.byStatus[status] !== undefined) {
      stats.byStatus[status]++;
    }
  }

  stats.avgResponseTime = totalResponseTime / events.length;

  return stats;
}

/**
 * Rotate old stats files (archive or delete files older than retention period)
 */
export function rotateFiles() {
  if (!initialized) {
    throw new Error('[ai-stats] Service not initialized. Call init() first.');
  }

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
      } catch (err) {
        console.error(`[ai-stats] Error deleting ${file}:`, err.message);
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
 * @returns {Array} - Array of date strings in YYYY-MM-DD format
 */
export function getAvailableDates() {
  if (!initialized) {
    throw new Error('[ai-stats] Service not initialized. Call init() first.');
  }

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
export function clear() {
  if (eventBuffer.length > 0) {
    eventBuffer.length = 0;
  }
  console.log('[ai-stats] Buffer cleared');
}

/**
 * Shutdown the service (flush buffer and stop timer)
 */
export function shutdown() {
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
 * @param {Object} entry - Full log entry
 * @param {string} entry.provider - Provider name
 * @param {string} entry.operation - Operation type
 * @param {*} entry.request - Full request payload (messages, params, etc.)
 * @param {*} entry.response - Full response payload
 * @param {number} [entry.responseTime] - Response time in ms
 * @param {string} [entry.status='success'] - Status
 * @param {string} [entry.error] - Error message if failed
 * @returns {string|null} Log entry ID, or null if logging is disabled
 */
export function logFullRequest(entry) {
  if (!initialized || !fullLoggingEnabled) return null;

  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const dayDir = join(logsDir, date);

  if (!existsSync(dayDir)) {
    mkdirSync(dayDir, { recursive: true });
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const logEntry = {
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
  } catch (err) {
    console.error(`[ai-stats] Error writing full log: ${err.message}`);
    return null;
  }

  return id;
}

/**
 * Get a specific full log entry by date and ID.
 *
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {string} id - Log entry ID
 * @returns {Object|null} Full log entry or null
 */
export function getFullLog(date, id) {
  if (!initialized) return null;

  const filePath = join(logsDir, date, `${id}.json`);
  if (!existsSync(filePath)) return null;

  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (err) {
    return null;
  }
}

/**
 * List full log entries for a specific date.
 *
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {number} [limit=50] - Max entries to return
 * @returns {Array} Log entry summaries (without full payloads)
 */
export function listFullLogs(date, limit = 50) {
  if (!initialized) return [];

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
        const data = JSON.parse(readFileSync(join(dayDir, f), 'utf-8'));
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
    }).filter(Boolean);
  } catch (err) {
    return [];
  }
}

/**
 * Enable or disable full request/response logging.
 *
 * @param {boolean} enabled
 */
export function setFullLogging(enabled) {
  fullLoggingEnabled = !!enabled;
  console.log(`[ai-stats] Full logging ${fullLoggingEnabled ? 'enabled' : 'disabled'}`);
}

/**
 * Check if full logging is enabled.
 * @returns {boolean}
 */
export function isFullLoggingEnabled() {
  return fullLoggingEnabled;
}

/**
 * Service name for registration
 */
export const name = 'ai-stats';
