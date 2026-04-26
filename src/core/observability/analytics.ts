/**
 * analytics.js - Content Analytics and Statistics
 *
 * WHY THIS EXISTS:
 * ================
 * Understanding how content performs is critical:
 * - Which content is popular?
 * - How are users engaging?
 * - What trends are emerging?
 * - Where should effort be focused?
 *
 * EVENTS TRACKED:
 * ==============
 * - pageview: Page/content viewed
 * - content.view: Specific content viewed
 * - content.create: Content created
 * - content.update: Content updated
 * - content.publish: Content published
 * - search: Search performed
 * - login: User logged in
 * - api.request: API request made
 *
 * STORAGE:
 * ========
 * Raw events: /logs/analytics/<year>/<month>/<day>.json
 * Aggregates: /logs/analytics/.aggregates/<period>.json
 *
 * AGGREGATION:
 * ===========
 * Hourly rollups computed on schedule.
 * Pre-computed summaries for dashboard performance.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

// ============================================================================
// Types
// ============================================================================

/** Analytics configuration */
interface AnalyticsConfig {
  enabled: boolean;
  trackPageViews: boolean;
  trackApi: boolean;
  retention: number;
  aggregateSchedule: string;
}

/** Database pool interface */
interface PgPool {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

/** Analytics event */
interface AnalyticsEvent {
  event: string;
  timestamp: string;
  ip?: string | null;
  userAgent?: string | null;
  userId?: string | null;
  [key: string]: unknown;
}

/** Event tracking context */
interface TrackContext {
  ip?: string | null;
  userAgent?: string | null;
  userId?: string | null;
}

/** Scheduler service interface */
interface SchedulerService {
  schedule: (
    id: string,
    expression: string,
    handler: () => Promise<void>,
    options?: Record<string, unknown>
  ) => void;
}

/** Hooks service interface */
interface HooksService {
  register: (name: string, handler: (data: Record<string, unknown>) => void) => void;
}

/** Content service interface */
interface ContentService {
  read: (type: string, id: string) => { title?: string; [key: string]: unknown } | null;
}

/** Page view stats */
interface PageViewStats {
  total: number;
  unique: number;
  byPath: Array<{ path: string; count: number }>;
  byDay: Array<{ day: string; count: number }>;
}

/** Content stats */
interface ContentStats {
  views: number;
  creates: number;
  updates: number;
  topContent: Array<{ type: string; id: string; views: number }>;
}

/** User activity stats */
interface UserActivityStats {
  totalLogins: number;
  totalCreates: number;
  totalUpdates: number;
  topUsers: Array<{
    userId: string;
    logins: number;
    creates: number;
    updates: number;
    total: number;
  }>;
}

/** Popular content entry */
interface PopularContentEntry {
  type: string;
  id: string;
  title: string;
  views: number;
}

/** Dashboard summary */
interface DashboardSummary {
  period: string;
  startDate: string;
  endDate: string;
  pageViews: number;
  contentViews: number;
  uniqueVisitors: number;
  apiRequests: number;
  contentCreated: number;
  contentUpdated: number;
  logins: number;
  searches: number;
}

/** Chart data */
interface ChartData {
  metric: string;
  labels: string[];
  data: number[];
  total: number;
}

/** Aggregate cache structure */
interface AggregateCache {
  updatedAt?: string;
  day?: DashboardSummary;
  week?: DashboardSummary;
  month?: DashboardSummary;
  popularContent?: PopularContentEntry[];
  topUsers?: Array<{
    userId: string;
    logins: number;
    creates: number;
    updates: number;
    total: number;
  }>;
}

/** System stats */
interface SystemStats {
  enabled: boolean;
  retention: number;
  totalEvents: number;
  totalDays: number;
  bufferSize: number;
  lastAggregation: string | null;
}

// ============================================================================
// State
// ============================================================================

/**
 * Configuration
 */
let config: AnalyticsConfig = {
  enabled: true,
  trackPageViews: true,
  trackApi: true,
  retention: 90,
  aggregateSchedule: '0 * * * *',
};

/**
 * Database pool for PostgreSQL analytics persistence.
 * When non-null, events are stored in `analytics_events` table.
 */
let dbPool: PgPool | null = null;

/**
 * Base directory
 */
let baseDir: string = '';

/**
 * Analytics log directory
 */
let analyticsDir: string = '';

/**
 * Aggregates directory
 */
let aggregatesDir: string = '';

/**
 * In-memory buffer for current day's events
 */
let eventBuffer: AnalyticsEvent[] = [];
let currentDayKey: string | null = null;
const BUFFER_FLUSH_SIZE: number = 50;

/**
 * Cached aggregates
 */
let aggregateCache: AggregateCache = {};

/**
 * Scheduler service reference
 */
let schedulerService: SchedulerService | null = null;

/**
 * Content service reference
 */
let contentService: ContentService | null = null;

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize analytics system
 *
 * @param cfg - Configuration overrides
 * @param base - Base directory
 * @param scheduler - Scheduler service
 * @param content - Content service
 * @param hooks - Hooks service
 */
export function init(
  cfg: Partial<AnalyticsConfig> = {},
  base: string = '',
  scheduler: SchedulerService | null = null,
  content: ContentService | null = null,
  hooks: HooksService | null = null
): void {
  config = { ...config, ...cfg };
  baseDir = base;
  schedulerService = scheduler;
  contentService = content;

  analyticsDir = join(baseDir, 'logs', 'analytics');
  aggregatesDir = join(analyticsDir, '.aggregates');

  // Ensure directories exist
  if (!existsSync(analyticsDir)) {
    mkdirSync(analyticsDir, { recursive: true });
  }
  if (!existsSync(aggregatesDir)) {
    mkdirSync(aggregatesDir, { recursive: true });
  }

  // Load today's events into buffer
  loadTodayBuffer();

  // Load cached aggregates
  loadAggregateCache();

  // Register hooks for auto-tracking
  if (hooks && config.enabled) {
    hooks.register('content:afterCreate', (data: Record<string, unknown>) => {
      track('content.create', { type: data.type, id: data.id });
    });

    hooks.register('content:afterUpdate', (data: Record<string, unknown>) => {
      track('content.update', { type: data.type, id: data.id });
    });

    hooks.register('auth:login', (data: Record<string, unknown>) => {
      track('login', { userId: data.userId });
    });
  }

  // Register scheduled aggregation
  if (scheduler && config.enabled && config.aggregateSchedule) {
    scheduler.schedule('analytics:aggregate', config.aggregateSchedule, async () => {
      try {
        runAggregation();
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.error('[analytics] Aggregation failed:', message);
      }
    });
  }

  console.log(`[analytics] Initialized (retention: ${config.retention} days)`);
}

/**
 * Load today's events into buffer
 */
function loadTodayBuffer(): void {
  const dayKey = getDayKey(new Date());
  currentDayKey = dayKey;

  const dayFile = getDayFile(dayKey);
  if (existsSync(dayFile)) {
    try {
      eventBuffer = JSON.parse(readFileSync(dayFile, 'utf-8')) as AnalyticsEvent[];
    } catch (_e: unknown) {
      eventBuffer = [];
    }
  }
}

/**
 * Load aggregate cache
 */
function loadAggregateCache(): void {
  const summaryFile = join(aggregatesDir, 'summary.json');
  if (existsSync(summaryFile)) {
    try {
      aggregateCache = JSON.parse(readFileSync(summaryFile, 'utf-8')) as AggregateCache;
    } catch (_e: unknown) {
      aggregateCache = {};
    }
  }
}

/**
 * Set database pool for PostgreSQL analytics persistence.
 * @param pool - PostgreSQL pool instance
 */
export async function initDb(pool: PgPool): Promise<void> {
  dbPool = pool;
  console.log('[analytics] Using PostgreSQL for event storage');
}

/**
 * Persist a batch of events to the database.
 */
function persistEventsToDb(events: AnalyticsEvent[]): void {
  if (!dbPool || events.length === 0) return;

  for (const e of events) {
    dbPool
      .query(
        `INSERT INTO analytics_events (event, timestamp, ip, user_agent, user_id, data)
       VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          e.event,
          e.timestamp,
          e.ip || null,
          e.userAgent || null,
          e.userId || null,
          JSON.stringify(
            Object.fromEntries(
              Object.entries(e).filter(
                ([k]) => !['event', 'timestamp', 'ip', 'userAgent', 'userId'].includes(k)
              )
            )
          ),
        ]
      )
      .catch((err: Error) =>
        console.warn(`[analytics] Failed to persist event to DB: ${err.message}`)
      );
  }
}

/**
 * Query events from the database.
 *
 * @param start - Start date
 * @param end - End date
 * @param eventType - Event type filter
 * @returns Events array or null
 */
async function queryEventsFromDb(
  start: Date,
  end: Date,
  eventType: string | null = null
): Promise<AnalyticsEvent[] | null> {
  if (!dbPool) return null;

  const conditions: string[] = [`timestamp >= $1`, `timestamp <= $2`];
  const params: unknown[] = [start.toISOString(), end.toISOString()];
  let idx = 3;

  if (eventType) {
    conditions.push(`event = $${idx++}`);
    params.push(eventType);
  }

  try {
    const result = await dbPool.query(
      `SELECT event, timestamp, ip, user_agent, user_id, data
       FROM analytics_events
       WHERE ${conditions.join(' AND ')}
       ORDER BY timestamp ASC`,
      params
    );

    return result.rows.map((r: Record<string, unknown>) => {
      const data =
        typeof r.data === 'string'
          ? (JSON.parse(r.data) as Record<string, unknown>)
          : ((r.data || {}) as Record<string, unknown>);
      return {
        event: r.event as string,
        timestamp: new Date(r.timestamp as string).toISOString(),
        ip: r.ip as string | null,
        userAgent: r.user_agent as string | null,
        userId: r.user_id as string | null,
        ...data,
      };
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[analytics] Failed to query events from DB: ${message}`);
    return null;
  }
}

/**
 * Get day key for a date
 */
function getDayKey(date: Date): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

/**
 * Get file path for a day's events
 */
function getDayFile(dayKey: string): string {
  return join(analyticsDir, `${dayKey}.json`);
}

// ============================================================================
// Event Tracking
// ============================================================================

/**
 * Track an analytics event
 *
 * @param event - Event name
 * @param data - Event data
 * @param context - Request context (ip, userAgent, userId)
 */
export function track(
  event: string,
  data: Record<string, unknown> = {},
  context: TrackContext = {}
): void {
  if (!config.enabled) return;

  const now = new Date();
  const dayKey = getDayKey(now);

  // Flush buffer if day changed
  if (dayKey !== currentDayKey) {
    flushBuffer();
    currentDayKey = dayKey;
  }

  const record: AnalyticsEvent = {
    event,
    timestamp: now.toISOString(),
    ...data,
    ip: context.ip || null,
    userAgent: context.userAgent || null,
    userId: context.userId || null,
  };

  eventBuffer.push(record);

  // Flush if buffer is full
  if (eventBuffer.length >= BUFFER_FLUSH_SIZE) {
    flushBuffer();
  }
}

/**
 * Track a page view
 *
 * @param path - Page path
 * @param context - Request context
 */
export function trackPageView(path: string, context: TrackContext = {}): void {
  if (!config.trackPageViews) return;
  track('pageview', { path }, context);
}

/**
 * Track content view
 *
 * @param type - Content type
 * @param id - Content ID
 * @param context - Request context
 */
export function trackContentView(type: string, id: string, context: TrackContext = {}): void {
  track('content.view', { type, id }, context);
}

/**
 * Track API request
 *
 * @param method - HTTP method
 * @param path - API path
 * @param status - Response status
 * @param duration - Request duration in ms
 * @param context - Request context
 */
export function trackApiRequest(
  method: string,
  path: string,
  status: number,
  duration: number,
  context: TrackContext = {}
): void {
  if (!config.trackApi) return;
  track('api.request', { method, path, status, duration }, context);
}

/**
 * Track search
 *
 * @param query - Search query
 * @param results - Number of results
 * @param context - Request context
 */
export function trackSearch(query: string, results: number, context: TrackContext = {}): void {
  track('search', { query, results }, context);
}

/**
 * Flush event buffer to disk
 */
export function flushBuffer(): void {
  if (eventBuffer.length === 0) return;

  // DB mode: persist to database
  if (dbPool) {
    persistEventsToDb(eventBuffer);
    eventBuffer = [];
    return;
  }

  // Flat-file mode
  const dayKey = currentDayKey || getDayKey(new Date());
  const dayFile = getDayFile(dayKey);

  // Ensure directory exists
  const dir = join(analyticsDir, dayKey.split('/').slice(0, 2).join('/'));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  try {
    writeFileSync(dayFile, JSON.stringify(eventBuffer, null, 2));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[analytics] Failed to flush buffer:', message);
  }
}

// ============================================================================
// Data Retrieval
// ============================================================================

/**
 * Get events for a date range
 *
 * @param start - Start date
 * @param end - End date
 * @param eventType - Filter by event type
 * @returns Events array (or Promise in DB mode)
 */
export function getEvents(
  start: Date | string,
  end: Date | string,
  eventType: string | null = null
): AnalyticsEvent[] | Promise<AnalyticsEvent[] | null> {
  const startDate = new Date(start);
  const endDate = new Date(end);

  // Ensure buffer is flushed
  flushBuffer();

  // DB mode: query from database (returns promise)
  if (dbPool) {
    return queryEventsFromDb(startDate, endDate, eventType);
  }

  // Flat-file mode
  const events: AnalyticsEvent[] = [];
  const current = new Date(startDate);
  while (current <= endDate) {
    const dayKey = getDayKey(current);
    const dayFile = getDayFile(dayKey);

    if (existsSync(dayFile)) {
      try {
        const dayEvents = JSON.parse(readFileSync(dayFile, 'utf-8')) as AnalyticsEvent[];
        for (const event of dayEvents) {
          if (!eventType || event.event === eventType) {
            const eventDate = new Date(event.timestamp);
            if (eventDate >= startDate && eventDate <= endDate) {
              events.push(event);
            }
          }
        }
      } catch (_e: unknown) {
        // Skip invalid files
      }
    }

    current.setDate(current.getDate() + 1);
  }

  return events;
}

/**
 * Get page view statistics
 *
 * @param options - Query options
 * @returns Page view stats
 */
export function getPageViews(options: { days?: number; groupBy?: string } = {}): PageViewStats {
  const { days = 30 } = options;

  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);

  const events = getEvents(start, end, 'pageview') as AnalyticsEvent[];

  // Count total and unique
  const uniqueIps: Set<string> = new Set();
  const byPath: Record<string, number> = {};
  const byDay: Record<string, number> = {};

  for (const event of events) {
    if (event.ip) uniqueIps.add(event.ip);

    // By path
    const path = (event.path as string) || '/';
    byPath[path] = (byPath[path] || 0) + 1;

    // By day
    const day = event.timestamp.split('T')[0] ?? '';
    byDay[day] = (byDay[day] ?? 0) + 1;
  }

  return {
    total: events.length,
    unique: uniqueIps.size,
    byPath: Object.entries(byPath)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([path, count]) => ({ path, count })),
    byDay: Object.entries(byDay)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, count]) => ({ day, count })),
  };
}

/**
 * Get content statistics
 *
 * @param type - Content type (optional)
 * @param id - Content ID (optional)
 * @returns Content stats
 */
export function getContentStats(
  type: string | null = null,
  id: string | null = null
): ContentStats {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);

  const viewEvents = getEvents(start, end, 'content.view') as AnalyticsEvent[];
  const createEvents = getEvents(start, end, 'content.create') as AnalyticsEvent[];
  const updateEvents = getEvents(start, end, 'content.update') as AnalyticsEvent[];

  // Filter by type/id if specified
  const filterEvents = (events: AnalyticsEvent[]): AnalyticsEvent[] => {
    return events.filter((e: AnalyticsEvent) => {
      if (type && e.type !== type) return false;
      if (id && e.id !== id) return false;
      return true;
    });
  };

  const filteredViews = filterEvents(viewEvents);
  const filteredCreates = filterEvents(createEvents);
  const filteredUpdates = filterEvents(updateEvents);

  // Aggregate views by content
  const viewsByContent: Record<string, number> = {};
  for (const event of filteredViews) {
    const key = `${event.type}/${event.id}`;
    viewsByContent[key] = (viewsByContent[key] || 0) + 1;
  }

  return {
    views: filteredViews.length,
    creates: filteredCreates.length,
    updates: filteredUpdates.length,
    topContent: Object.entries(viewsByContent)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([key, views]) => {
        const parts = key.split('/');
        return { type: parts[0] ?? '', id: parts[1] ?? '', views };
      }),
  };
}

/**
 * Get user activity statistics
 *
 * @param userId - User ID (optional)
 * @returns User activity stats
 */
export function getUserActivity(userId: string | null = null): UserActivityStats {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);

  const loginEvents = getEvents(start, end, 'login') as AnalyticsEvent[];
  const createEvents = getEvents(start, end, 'content.create') as AnalyticsEvent[];
  const updateEvents = getEvents(start, end, 'content.update') as AnalyticsEvent[];

  // Filter by user if specified
  const filterByUser = (events: AnalyticsEvent[]): AnalyticsEvent[] => {
    if (!userId) return events;
    return events.filter((e: AnalyticsEvent) => e.userId === userId);
  };

  const logins = filterByUser(loginEvents);
  const creates = filterByUser(createEvents);
  const updates = filterByUser(updateEvents);

  // Aggregate by user
  const activityByUser: Record<
    string,
    { logins: number; creates: number; updates: number; total: number }
  > = {};

  const addActivity = (events: AnalyticsEvent[], type: 'logins' | 'creates' | 'updates'): void => {
    for (const event of events) {
      const uid = (event.userId as string) || 'anonymous';
      if (!activityByUser[uid]) {
        activityByUser[uid] = { logins: 0, creates: 0, updates: 0, total: 0 };
      }
      activityByUser[uid][type]++;
      activityByUser[uid].total++;
    }
  };

  addActivity(logins, 'logins');
  addActivity(creates, 'creates');
  addActivity(updates, 'updates');

  return {
    totalLogins: logins.length,
    totalCreates: creates.length,
    totalUpdates: updates.length,
    topUsers: Object.entries(activityByUser)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10)
      .map(([uid, stats]) => ({ userId: uid, ...stats })),
  };
}

/**
 * Get popular content
 *
 * @param type - Content type (optional)
 * @param options - Query options
 * @returns Popular content entries
 */
export function getPopularContent(
  type: string | null = null,
  options: { days?: number; limit?: number } = {}
): PopularContentEntry[] {
  const { days = 30, limit = 10 } = options;

  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);

  const viewEvents = getEvents(start, end, 'content.view') as AnalyticsEvent[];

  // Filter by type
  const filtered = type ? viewEvents.filter((e: AnalyticsEvent) => e.type === type) : viewEvents;

  // Aggregate
  const viewsByContent: Record<string, number> = {};
  for (const event of filtered) {
    const key = `${event.type}/${event.id}`;
    viewsByContent[key] = (viewsByContent[key] || 0) + 1;
  }

  // Get content titles
  const results: PopularContentEntry[] = Object.entries(viewsByContent)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, views]) => {
      const parts = key.split('/');
      const contentType = parts[0] ?? '';
      const contentId = parts[1] ?? '';
      let title = contentId;

      // Try to get actual title from content
      if (contentService) {
        try {
          const content = contentService.read(contentType, contentId);
          if (content && content.title) {
            title = content.title;
          }
        } catch (_e: unknown) {
          // Keep ID as title
        }
      }

      return { type: contentType, id: contentId, title, views };
    });

  return results;
}

/**
 * Get dashboard summary
 *
 * @param period - 'day', 'week', 'month'
 * @returns Summary data
 */
export function getSummary(period: string = 'week'): DashboardSummary {
  const end = new Date();
  const start = new Date();

  switch (period) {
    case 'day':
      start.setDate(start.getDate() - 1);
      break;
    case 'week':
      start.setDate(start.getDate() - 7);
      break;
    case 'month':
      start.setDate(start.getDate() - 30);
      break;
    default:
      start.setDate(start.getDate() - 7);
  }

  const pageViews = getEvents(start, end, 'pageview') as AnalyticsEvent[];
  const contentViews = getEvents(start, end, 'content.view') as AnalyticsEvent[];
  const apiRequests = getEvents(start, end, 'api.request') as AnalyticsEvent[];
  const contentCreates = getEvents(start, end, 'content.create') as AnalyticsEvent[];
  const contentUpdates = getEvents(start, end, 'content.update') as AnalyticsEvent[];
  const logins = getEvents(start, end, 'login') as AnalyticsEvent[];
  const searches = getEvents(start, end, 'search') as AnalyticsEvent[];

  // Count unique visitors
  const uniqueIps: Set<string> = new Set();
  for (const event of pageViews) {
    if (event.ip) uniqueIps.add(event.ip);
  }

  return {
    period,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    pageViews: pageViews.length,
    contentViews: contentViews.length,
    uniqueVisitors: uniqueIps.size,
    apiRequests: apiRequests.length,
    contentCreated: contentCreates.length,
    contentUpdated: contentUpdates.length,
    logins: logins.length,
    searches: searches.length,
  };
}

/**
 * Get chart data for a metric
 *
 * @param metric - Metric name
 * @param options - Query options
 * @returns Chart data
 */
export function getChartData(
  metric: string,
  options: { days?: number; groupBy?: string } = {}
): ChartData {
  const { days = 30 } = options;

  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);

  let eventType: string;
  switch (metric) {
    case 'pageviews':
      eventType = 'pageview';
      break;
    case 'content_views':
      eventType = 'content.view';
      break;
    case 'api_requests':
      eventType = 'api.request';
      break;
    case 'logins':
      eventType = 'login';
      break;
    case 'searches':
      eventType = 'search';
      break;
    default:
      eventType = 'pageview';
  }

  const events = getEvents(start, end, eventType) as AnalyticsEvent[];

  // Group by day
  const byDay: Record<string, number> = {};
  for (const event of events) {
    const day = event.timestamp.split('T')[0] ?? '';
    byDay[day] = (byDay[day] ?? 0) + 1;
  }

  // Fill in missing days with zeros
  const labels: string[] = [];
  const data: number[] = [];
  const current = new Date(start);

  while (current <= end) {
    const day = current.toISOString().split('T')[0] ?? '';
    labels.push(day);
    data.push(byDay[day] ?? 0);
    current.setDate(current.getDate() + 1);
  }

  return {
    metric,
    labels,
    data,
    total: events.length,
  };
}

// ============================================================================
// Aggregation
// ============================================================================

/**
 * Run aggregation for dashboard performance
 */
export function runAggregation(): AggregateCache {
  // Flush any pending events
  flushBuffer();

  // Compute summary for different periods
  const daySummary = getSummary('day');
  const weekSummary = getSummary('week');
  const monthSummary = getSummary('month');

  // Get popular content
  const popularContent = getPopularContent(null, { days: 30, limit: 20 });

  // Get top users
  const userActivity = getUserActivity();

  // Store aggregates
  aggregateCache = {
    updatedAt: new Date().toISOString(),
    day: daySummary,
    week: weekSummary,
    month: monthSummary,
    popularContent,
    topUsers: userActivity.topUsers,
  };

  // Save to disk or DB
  if (dbPool) {
    dbPool
      .query(
        `INSERT INTO analytics_events (event, timestamp, ip, user_agent, user_id, data)
       VALUES ('_aggregate_cache', NOW(), NULL, NULL, NULL, $1)
       ON CONFLICT DO NOTHING`,
        [JSON.stringify(aggregateCache)]
      )
      .catch(() => {});
  } else {
    try {
      writeFileSync(join(aggregatesDir, 'summary.json'), JSON.stringify(aggregateCache, null, 2));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[analytics] Failed to save aggregates:', message);
    }
  }

  return aggregateCache;
}

/**
 * Get cached aggregates
 */
export function getCachedSummary(): AggregateCache {
  return aggregateCache;
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Clean up old analytics data
 */
export function cleanup(): { deleted: number } {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - config.retention);

  let deleted = 0;

  // Find year directories
  const years = readdirSync(analyticsDir).filter((d: string) => /^\d{4}$/.test(d));

  for (const year of years) {
    const yearDir = join(analyticsDir, year);
    if (!statSync(yearDir).isDirectory()) continue;

    const months = readdirSync(yearDir).filter((d: string) => /^\d{2}$/.test(d));

    for (const month of months) {
      const monthDir = join(yearDir, month);
      if (!statSync(monthDir).isDirectory()) continue;

      const days = readdirSync(monthDir).filter((f: string) => f.endsWith('.json'));

      for (const day of days) {
        const dayNum = day.replace('.json', '');
        const fileDate = new Date(`${year}-${month}-${dayNum}`);

        if (fileDate < cutoff) {
          const filePath = join(monthDir, day);
          try {
            unlinkSync(filePath);
            deleted++;
          } catch (_e: unknown) {
            // Ignore
          }
        }
      }
    }
  }

  return { deleted };
}

// ============================================================================
// Statistics
// ============================================================================

/**
 * Get analytics system statistics
 */
export function getStats(): SystemStats {
  // Count total events
  let totalEvents = 0;
  let totalDays = 0;

  const years = readdirSync(analyticsDir).filter((d: string) => /^\d{4}$/.test(d));

  for (const year of years) {
    const yearDir = join(analyticsDir, year);
    if (!statSync(yearDir).isDirectory()) continue;

    const months = readdirSync(yearDir).filter((d: string) => /^\d{2}$/.test(d));

    for (const month of months) {
      const monthDir = join(yearDir, month);
      if (!statSync(monthDir).isDirectory()) continue;

      const days = readdirSync(monthDir).filter((f: string) => f.endsWith('.json'));
      totalDays += days.length;

      for (const day of days) {
        try {
          const events = JSON.parse(readFileSync(join(monthDir, day), 'utf-8')) as AnalyticsEvent[];
          totalEvents += events.length;
        } catch (_e: unknown) {
          // Skip invalid files
        }
      }
    }
  }

  return {
    enabled: config.enabled,
    retention: config.retention,
    totalEvents,
    totalDays,
    bufferSize: eventBuffer.length,
    lastAggregation: aggregateCache.updatedAt || null,
  };
}

/**
 * Format number with commas
 */
export function formatNumber(num: number): string {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
