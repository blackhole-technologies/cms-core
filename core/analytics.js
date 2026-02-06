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

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ============================================
// STATE
// ============================================

/**
 * Configuration
 */
let config = {
  enabled: true,
  trackPageViews: true,
  trackApi: true,
  retention: 90,
  aggregateSchedule: '0 * * * *'
};

/**
 * Base directory
 */
let baseDir = '';

/**
 * Analytics log directory
 */
let analyticsDir = '';

/**
 * Aggregates directory
 */
let aggregatesDir = '';

/**
 * In-memory buffer for current day's events
 */
let eventBuffer = [];
let currentDayKey = null;
const BUFFER_FLUSH_SIZE = 50;

/**
 * Cached aggregates
 */
let aggregateCache = {};

/**
 * Scheduler service reference
 */
let schedulerService = null;

/**
 * Content service reference
 */
let contentService = null;

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize analytics system
 *
 * @param {Object} cfg - Configuration
 * @param {string} base - Base directory
 * @param {Object} scheduler - Scheduler service
 * @param {Object} content - Content service
 * @param {Object} hooks - Hooks service
 */
export function init(cfg = {}, base = '', scheduler = null, content = null, hooks = null) {
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
    hooks.register('content:afterCreate', (data) => {
      track('content.create', { type: data.type, id: data.id });
    });

    hooks.register('content:afterUpdate', (data) => {
      track('content.update', { type: data.type, id: data.id });
    });

    hooks.register('auth:login', (data) => {
      track('login', { userId: data.userId });
    });
  }

  // Register scheduled aggregation
  if (scheduler && config.enabled && config.aggregateSchedule) {
    scheduler.schedule('analytics:aggregate', config.aggregateSchedule, async () => {
      try {
        runAggregation();
      } catch (e) {
        console.error('[analytics] Aggregation failed:', e.message);
      }
    });
  }

  console.log(`[analytics] Initialized (retention: ${config.retention} days)`);
}

/**
 * Load today's events into buffer
 */
function loadTodayBuffer() {
  const dayKey = getDayKey(new Date());
  currentDayKey = dayKey;

  const dayFile = getDayFile(dayKey);
  if (existsSync(dayFile)) {
    try {
      eventBuffer = JSON.parse(readFileSync(dayFile, 'utf-8'));
    } catch (e) {
      eventBuffer = [];
    }
  }
}

/**
 * Load aggregate cache
 */
function loadAggregateCache() {
  const summaryFile = join(aggregatesDir, 'summary.json');
  if (existsSync(summaryFile)) {
    try {
      aggregateCache = JSON.parse(readFileSync(summaryFile, 'utf-8'));
    } catch (e) {
      aggregateCache = {};
    }
  }
}

/**
 * Get day key for a date
 */
function getDayKey(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

/**
 * Get file path for a day's events
 */
function getDayFile(dayKey) {
  return join(analyticsDir, `${dayKey}.json`);
}

// ============================================
// EVENT TRACKING
// ============================================

/**
 * Track an analytics event
 *
 * @param {string} event - Event name
 * @param {Object} data - Event data
 * @param {Object} context - Request context (ip, userAgent, userId)
 */
export function track(event, data = {}, context = {}) {
  if (!config.enabled) return;

  const now = new Date();
  const dayKey = getDayKey(now);

  // Flush buffer if day changed
  if (dayKey !== currentDayKey) {
    flushBuffer();
    currentDayKey = dayKey;
  }

  const record = {
    event,
    timestamp: now.toISOString(),
    ...data,
    ip: context.ip || null,
    userAgent: context.userAgent || null,
    userId: context.userId || null
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
 * @param {string} path - Page path
 * @param {Object} context - Request context
 */
export function trackPageView(path, context = {}) {
  if (!config.trackPageViews) return;
  track('pageview', { path }, context);
}

/**
 * Track content view
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {Object} context - Request context
 */
export function trackContentView(type, id, context = {}) {
  track('content.view', { type, id }, context);
}

/**
 * Track API request
 *
 * @param {string} method - HTTP method
 * @param {string} path - API path
 * @param {number} status - Response status
 * @param {number} duration - Request duration in ms
 * @param {Object} context - Request context
 */
export function trackApiRequest(method, path, status, duration, context = {}) {
  if (!config.trackApi) return;
  track('api.request', { method, path, status, duration }, context);
}

/**
 * Track search
 *
 * @param {string} query - Search query
 * @param {number} results - Number of results
 * @param {Object} context - Request context
 */
export function trackSearch(query, results, context = {}) {
  track('search', { query, results }, context);
}

/**
 * Flush event buffer to disk
 */
export function flushBuffer() {
  if (eventBuffer.length === 0) return;

  const dayKey = currentDayKey || getDayKey(new Date());
  const dayFile = getDayFile(dayKey);

  // Ensure directory exists
  const dir = join(analyticsDir, dayKey.split('/').slice(0, 2).join('/'));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  try {
    writeFileSync(dayFile, JSON.stringify(eventBuffer, null, 2));
  } catch (e) {
    console.error('[analytics] Failed to flush buffer:', e.message);
  }
}

// ============================================
// DATA RETRIEVAL
// ============================================

/**
 * Get events for a date range
 *
 * @param {Date} start - Start date
 * @param {Date} end - End date
 * @param {string} eventType - Filter by event type
 * @returns {Object[]} Events
 */
export function getEvents(start, end, eventType = null) {
  const events = [];
  const startDate = new Date(start);
  const endDate = new Date(end);

  // Ensure buffer is flushed
  flushBuffer();

  // Iterate through days
  const current = new Date(startDate);
  while (current <= endDate) {
    const dayKey = getDayKey(current);
    const dayFile = getDayFile(dayKey);

    if (existsSync(dayFile)) {
      try {
        const dayEvents = JSON.parse(readFileSync(dayFile, 'utf-8'));
        for (const event of dayEvents) {
          if (!eventType || event.event === eventType) {
            const eventDate = new Date(event.timestamp);
            if (eventDate >= startDate && eventDate <= endDate) {
              events.push(event);
            }
          }
        }
      } catch (e) {
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
 * @param {Object} options - Query options
 * @returns {Object} Page view stats
 */
export function getPageViews(options = {}) {
  const {
    days = 30,
    groupBy = 'day'
  } = options;

  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);

  const events = getEvents(start, end, 'pageview');

  // Count total and unique
  const uniqueIps = new Set();
  const byPath = {};
  const byDay = {};

  for (const event of events) {
    if (event.ip) uniqueIps.add(event.ip);

    // By path
    const path = event.path || '/';
    byPath[path] = (byPath[path] || 0) + 1;

    // By day
    const day = event.timestamp.split('T')[0];
    byDay[day] = (byDay[day] || 0) + 1;
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
      .map(([day, count]) => ({ day, count }))
  };
}

/**
 * Get content statistics
 *
 * @param {string} type - Content type (optional)
 * @param {string} id - Content ID (optional)
 * @returns {Object} Content stats
 */
export function getContentStats(type = null, id = null) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);

  const viewEvents = getEvents(start, end, 'content.view');
  const createEvents = getEvents(start, end, 'content.create');
  const updateEvents = getEvents(start, end, 'content.update');

  // Filter by type/id if specified
  const filterEvents = (events) => {
    return events.filter(e => {
      if (type && e.type !== type) return false;
      if (id && e.id !== id) return false;
      return true;
    });
  };

  const filteredViews = filterEvents(viewEvents);
  const filteredCreates = filterEvents(createEvents);
  const filteredUpdates = filterEvents(updateEvents);

  // Aggregate views by content
  const viewsByContent = {};
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
        const [type, id] = key.split('/');
        return { type, id, views };
      })
  };
}

/**
 * Get user activity statistics
 *
 * @param {string} userId - User ID (optional)
 * @returns {Object} User activity stats
 */
export function getUserActivity(userId = null) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);

  const loginEvents = getEvents(start, end, 'login');
  const createEvents = getEvents(start, end, 'content.create');
  const updateEvents = getEvents(start, end, 'content.update');

  // Filter by user if specified
  const filterByUser = (events) => {
    if (!userId) return events;
    return events.filter(e => e.userId === userId);
  };

  const logins = filterByUser(loginEvents);
  const creates = filterByUser(createEvents);
  const updates = filterByUser(updateEvents);

  // Aggregate by user
  const activityByUser = {};

  const addActivity = (events, type) => {
    for (const event of events) {
      const uid = event.userId || 'anonymous';
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
      .map(([userId, stats]) => ({ userId, ...stats }))
  };
}

/**
 * Get popular content
 *
 * @param {string} type - Content type (optional)
 * @param {Object} options - Query options
 * @returns {Object[]} Popular content
 */
export function getPopularContent(type = null, options = {}) {
  const { days = 30, limit = 10 } = options;

  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);

  const viewEvents = getEvents(start, end, 'content.view');

  // Filter by type
  const filtered = type
    ? viewEvents.filter(e => e.type === type)
    : viewEvents;

  // Aggregate
  const viewsByContent = {};
  for (const event of filtered) {
    const key = `${event.type}/${event.id}`;
    viewsByContent[key] = (viewsByContent[key] || 0) + 1;
  }

  // Get content titles
  const results = Object.entries(viewsByContent)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, views]) => {
      const [contentType, id] = key.split('/');
      let title = id;

      // Try to get actual title from content
      if (contentService) {
        try {
          const content = contentService.read(contentType, id);
          if (content && content.title) {
            title = content.title;
          }
        } catch (e) {
          // Keep ID as title
        }
      }

      return { type: contentType, id, title, views };
    });

  return results;
}

/**
 * Get dashboard summary
 *
 * @param {string} period - 'day', 'week', 'month'
 * @returns {Object} Summary data
 */
export function getSummary(period = 'week') {
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

  const pageViews = getEvents(start, end, 'pageview');
  const contentViews = getEvents(start, end, 'content.view');
  const apiRequests = getEvents(start, end, 'api.request');
  const contentCreates = getEvents(start, end, 'content.create');
  const contentUpdates = getEvents(start, end, 'content.update');
  const logins = getEvents(start, end, 'login');
  const searches = getEvents(start, end, 'search');

  // Count unique visitors
  const uniqueIps = new Set();
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
    searches: searches.length
  };
}

/**
 * Get chart data for a metric
 *
 * @param {string} metric - Metric name
 * @param {Object} options - Query options
 * @returns {Object} Chart data
 */
export function getChartData(metric, options = {}) {
  const { days = 30, groupBy = 'day' } = options;

  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);

  let eventType;
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

  const events = getEvents(start, end, eventType);

  // Group by day
  const byDay = {};
  for (const event of events) {
    const day = event.timestamp.split('T')[0];
    byDay[day] = (byDay[day] || 0) + 1;
  }

  // Fill in missing days with zeros
  const labels = [];
  const data = [];
  const current = new Date(start);

  while (current <= end) {
    const day = current.toISOString().split('T')[0];
    labels.push(day);
    data.push(byDay[day] || 0);
    current.setDate(current.getDate() + 1);
  }

  return {
    metric,
    labels,
    data,
    total: events.length
  };
}

// ============================================
// AGGREGATION
// ============================================

/**
 * Run aggregation for dashboard performance
 */
export function runAggregation() {
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
    topUsers: userActivity.topUsers
  };

  // Save to disk
  try {
    writeFileSync(
      join(aggregatesDir, 'summary.json'),
      JSON.stringify(aggregateCache, null, 2)
    );
  } catch (e) {
    console.error('[analytics] Failed to save aggregates:', e.message);
  }

  return aggregateCache;
}

/**
 * Get cached aggregates
 */
export function getCachedSummary() {
  return aggregateCache;
}

// ============================================
// CLEANUP
// ============================================

/**
 * Clean up old analytics data
 */
export function cleanup() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - config.retention);

  let deleted = 0;

  // Find year directories
  const years = readdirSync(analyticsDir).filter(d => /^\d{4}$/.test(d));

  for (const year of years) {
    const yearDir = join(analyticsDir, year);
    if (!statSync(yearDir).isDirectory()) continue;

    const months = readdirSync(yearDir).filter(d => /^\d{2}$/.test(d));

    for (const month of months) {
      const monthDir = join(yearDir, month);
      if (!statSync(monthDir).isDirectory()) continue;

      const days = readdirSync(monthDir).filter(f => f.endsWith('.json'));

      for (const day of days) {
        const dayNum = day.replace('.json', '');
        const fileDate = new Date(`${year}-${month}-${dayNum}`);

        if (fileDate < cutoff) {
          const filePath = join(monthDir, day);
          try {
            require('fs').unlinkSync(filePath);
            deleted++;
          } catch (e) {
            // Ignore
          }
        }
      }
    }
  }

  return { deleted };
}

// ============================================
// STATISTICS
// ============================================

/**
 * Get analytics system statistics
 */
export function getStats() {
  // Count total events
  let totalEvents = 0;
  let totalDays = 0;

  const years = readdirSync(analyticsDir).filter(d => /^\d{4}$/.test(d));

  for (const year of years) {
    const yearDir = join(analyticsDir, year);
    if (!statSync(yearDir).isDirectory()) continue;

    const months = readdirSync(yearDir).filter(d => /^\d{2}$/.test(d));

    for (const month of months) {
      const monthDir = join(yearDir, month);
      if (!statSync(monthDir).isDirectory()) continue;

      const days = readdirSync(monthDir).filter(f => f.endsWith('.json'));
      totalDays += days.length;

      for (const day of days) {
        try {
          const events = JSON.parse(readFileSync(join(monthDir, day), 'utf-8'));
          totalEvents += events.length;
        } catch (e) {
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
    lastAggregation: aggregateCache.updatedAt || null
  };
}

/**
 * Format number with commas
 */
export function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
