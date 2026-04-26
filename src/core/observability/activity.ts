/**
 * activity.js - Activity Feed and Timeline System
 *
 * WHY THIS EXISTS:
 * Users need visibility into what's happening in the CMS:
 * - Content authors see recent changes to their work
 * - Admins monitor system-wide activity
 * - Teams track collaboration on shared content
 *
 * DESIGN DECISIONS:
 * - Builds on audit log but provides richer, user-friendly data
 * - Aggregates similar activities (3 edits -> "edited 3 times")
 * - Stores actor/target context for meaningful display
 * - Supports filtering by user, content, action type
 *
 * STORAGE:
 * Separate from audit logs - optimized for display, not compliance.
 * /content/.activity/<year>/<month>.json
 */

import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

// ============================================================================
// Types
// ============================================================================

/** Activity actor */
interface Actor {
  id: string | null;
  username: string;
  type: string;
}

/** Activity target */
interface Target {
  type: string | null;
  id: string | null;
  title: string | null;
}

/** Activity entry */
interface ActivityEntry {
  id: string;
  action: string;
  actor: Actor;
  target: Target | null;
  data: Record<string, unknown>;
  timestamp: string;
  count?: number;
  lastTimestamp?: string;
  firstTimestamp?: string;
  label?: string;
  relativeTime?: string;
}

/** Activity configuration */
interface ActivityConfig {
  enabled: boolean;
  aggregateWindow: number;
  retention: number;
  maxPerFeed: number;
}

/** Database pool interface */
interface PgPool {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  simpleQuery: (sql: string) => Promise<{ rows: Record<string, unknown>[] }>;
}

/** Feed options */
interface FeedOptions {
  action?: string | null;
  actorId?: string | null;
  targetType?: string | null;
  days?: number;
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
  aggregate?: boolean;
}

/** Feed result */
interface FeedResult {
  activities: ActivityEntry[];
  total: number;
  limit: number;
  offset: number;
  from?: string;
  to?: string;
}

/** Content feed result */
interface ContentFeedResult {
  activities: ActivityEntry[];
  total: number;
  type: string;
  id: string;
  limit: number;
  offset: number;
}

/** Activity stats */
interface ActivityStats {
  total: number;
  from: string | undefined;
  to: string | undefined;
  byAction: Record<string, number>;
  byActor: Record<string, number>;
  byTargetType: Record<string, number>;
  byDay: Record<string, number>;
  topContent: Array<{ type: string; id: string; title: string | null; count: number }>;
}

/** User input for record convenience methods */
interface UserInput {
  id?: string;
  username?: string;
  email?: string;
  type?: string;
}

/** Content service interface */
interface ContentService {
  [key: string]: unknown;
}

/** DB query options (internal) */
interface DbQueryOptions {
  action?: string | null;
  actorId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/** Internal DB feed options */
interface DbFeedOptions extends DbQueryOptions {
  aggregate: boolean;
  requestedLimit: number;
  requestedOffset: number;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Activity types
 */
export const ACTIVITY_TYPES: Record<string, string> = {
  // Content actions
  CONTENT_CREATE: 'content.create',
  CONTENT_UPDATE: 'content.update',
  CONTENT_DELETE: 'content.delete',
  CONTENT_PUBLISH: 'content.publish',
  CONTENT_UNPUBLISH: 'content.unpublish',
  CONTENT_ARCHIVE: 'content.archive',
  CONTENT_CLONE: 'content.clone',
  CONTENT_RESTORE: 'content.restore',

  // Comments
  CONTENT_COMMENT: 'content.comment',

  // User actions
  USER_LOGIN: 'user.login',
  USER_CREATE: 'user.create',
  USER_UPDATE: 'user.update',

  // Media
  MEDIA_UPLOAD: 'media.upload',
  MEDIA_DELETE: 'media.delete',

  // Workflow
  WORKFLOW_APPROVE: 'workflow.approve',
  WORKFLOW_REJECT: 'workflow.reject',
  WORKFLOW_SUBMIT: 'workflow.submit',

  // System
  SYSTEM_BACKUP: 'system.backup',
  SYSTEM_RESTORE: 'system.restore',
};

/**
 * Human-readable action labels
 */
const ACTION_LABELS: Record<string, string> = {
  'content.create': 'created',
  'content.update': 'updated',
  'content.delete': 'deleted',
  'content.publish': 'published',
  'content.unpublish': 'unpublished',
  'content.archive': 'archived',
  'content.clone': 'cloned',
  'content.restore': 'restored',
  'content.comment': 'commented on',
  'user.login': 'logged in',
  'user.create': 'created account',
  'user.update': 'updated profile',
  'media.upload': 'uploaded',
  'media.delete': 'deleted',
  'workflow.approve': 'approved',
  'workflow.reject': 'rejected',
  'workflow.submit': 'submitted for review',
  'system.backup': 'ran backup',
  'system.restore': 'restored from backup',
};

// ============================================================================
// State
// ============================================================================

/**
 * Configuration
 */
let config: ActivityConfig = {
  enabled: true,
  aggregateWindow: 5 * 60 * 1000, // 5 minutes - group activities within this window
  retention: 90, // Days to keep activity data
  maxPerFeed: 100, // Max items in a single feed query
};

/**
 * Database pool for PostgreSQL activity persistence.
 * When non-null, activities are stored in `activity` table.
 */
let dbPool: PgPool | null = null;

/**
 * Storage directory
 */
let baseDir: string | null = null;
let activityDir: string | null = null;
let contentService: ContentService | null = null;

/**
 * In-memory buffer for batch writes
 */
let writeBuffer: ActivityEntry[] = [];
const FLUSH_INTERVAL_MS: number = 5000;
const BUFFER_SIZE: number = 20;
let flushInterval: ReturnType<typeof setInterval> | null = null;

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize activity system
 *
 * @param dir - Base directory
 * @param contentSvc - Content service
 * @param activityConfig - Activity configuration
 */
export function init(
  dir: string,
  contentSvc: ContentService | null,
  activityConfig: Partial<ActivityConfig> = {}
): void {
  baseDir = dir;
  contentService = contentSvc;

  config = { ...config, ...activityConfig };

  activityDir = join(baseDir, 'content', '.activity');
  if (!existsSync(activityDir)) {
    mkdirSync(activityDir, { recursive: true });
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
 * Get storage path for a date
 *
 * @param date - Date to get path for
 * @returns Storage path
 */
function getStoragePath(date: Date = new Date()): string {
  const year = date.getFullYear().toString();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');

  const yearDir = join(activityDir!, year);
  if (!existsSync(yearDir)) {
    mkdirSync(yearDir, { recursive: true });
  }

  return join(yearDir, `${month}.json`);
}

/**
 * Read activities from storage file
 *
 * @param path - File path
 * @returns Activities array
 */
function readActivities(path: string): ActivityEntry[] {
  if (!existsSync(path)) {
    return [];
  }

  try {
    const data = readFileSync(path, 'utf-8');
    return JSON.parse(data) as ActivityEntry[];
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[activity] Failed to read ${path}: ${message}`);
    return [];
  }
}

/**
 * Write activities to storage file (flat-file mode only).
 *
 * @param path - File path
 * @param activities - Activities array
 */
function writeActivities(path: string, activities: ActivityEntry[]): void {
  if (dbPool) return; // DB mode: flush writes directly to DB

  try {
    writeFileSync(path, JSON.stringify(activities, null, 2) + '\n');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[activity] Failed to write ${path}: ${message}`);
  }
}

/**
 * Set database pool for PostgreSQL activity persistence.
 * @param pool - PostgreSQL pool instance
 */
export async function initDb(pool: PgPool): Promise<void> {
  dbPool = pool;
  console.log('[activity] Using PostgreSQL for activity storage');
}

/**
 * Persist a batch of activities to the database.
 */
function persistActivitiesToDb(activities: ActivityEntry[]): void {
  if (!dbPool || activities.length === 0) return;

  for (const a of activities) {
    dbPool
      .query(
        `INSERT INTO activity (id, action, actor_id, actor_username, actor_type,
                             target_type, target_id, target_title, data, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO NOTHING`,
        [
          a.id,
          a.action,
          a.actor?.id || null,
          a.actor?.username || 'system',
          a.actor?.type || 'user',
          a.target?.type || null,
          a.target?.id || null,
          a.target?.title || null,
          JSON.stringify(a.data || {}),
          a.timestamp,
        ]
      )
      .catch((err: Error) => console.warn(`[activity] Failed to persist to DB: ${err.message}`));
  }
}

/**
 * Query activities from the database.
 *
 * @param options - Filter options
 * @returns Activities or null
 */
async function queryActivitiesFromDb(
  options: DbQueryOptions = {}
): Promise<ActivityEntry[] | null> {
  if (!dbPool) return null;

  const { action, actorId, targetType, targetId, from, to, limit, offset } = options;
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (from) {
    conditions.push(`timestamp >= $${idx++}`);
    params.push(from);
  }
  if (to) {
    conditions.push(`timestamp <= $${idx++}`);
    params.push(to);
  }
  if (action) {
    conditions.push(`action = $${idx++}`);
    params.push(action);
  }
  if (actorId) {
    conditions.push(`actor_id = $${idx++}`);
    params.push(actorId);
  }
  if (targetType) {
    conditions.push(`target_type = $${idx++}`);
    params.push(targetType);
  }
  if (targetId) {
    conditions.push(`target_id = $${idx++}`);
    params.push(targetId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await dbPool.query(
      `SELECT id, action, actor_id, actor_username, actor_type,
              target_type, target_id, target_title, data, timestamp
       FROM activity ${where}
       ORDER BY timestamp DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, String(limit || 100), String(offset || 0)]
    );

    return result.rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      action: r.action as string,
      actor: {
        id: r.actor_id as string | null,
        username: r.actor_username as string,
        type: r.actor_type as string,
      },
      target: r.target_type
        ? {
            type: r.target_type as string,
            id: r.target_id as string | null,
            title: r.target_title as string | null,
          }
        : null,
      data:
        typeof r.data === 'string'
          ? (JSON.parse(r.data) as Record<string, unknown>)
          : ((r.data || {}) as Record<string, unknown>),
      timestamp: new Date(r.timestamp as string).toISOString(),
    }));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[activity] Failed to query from DB: ${message}`);
    return null;
  }
}

/**
 * Count activities from the database.
 */
async function countActivitiesFromDb(options: DbQueryOptions = {}): Promise<number | null> {
  if (!dbPool) return null;

  const { action, actorId, targetType, targetId, from, to } = options;
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (from) {
    conditions.push(`timestamp >= $${idx++}`);
    params.push(from);
  }
  if (to) {
    conditions.push(`timestamp <= $${idx++}`);
    params.push(to);
  }
  if (action) {
    conditions.push(`action = $${idx++}`);
    params.push(action);
  }
  if (actorId) {
    conditions.push(`actor_id = $${idx++}`);
    params.push(actorId);
  }
  if (targetType) {
    conditions.push(`target_type = $${idx++}`);
    params.push(targetType);
  }
  if (targetId) {
    conditions.push(`target_id = $${idx++}`);
    params.push(targetId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await dbPool.simpleQuery(`SELECT COUNT(*) AS total FROM activity ${where}`);
    return Number(result.rows[0]?.total) || 0;
  } catch (_error: unknown) {
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
    persistActivitiesToDb(writeBuffer);
    writeBuffer = [];
    return;
  }

  // Flat-file mode: group by month
  const byMonth: Record<string, ActivityEntry[]> = {};
  for (const activity of writeBuffer) {
    const date = new Date(activity.timestamp);
    const path = getStoragePath(date);

    if (!byMonth[path]) {
      byMonth[path] = [];
    }
    byMonth[path].push(activity);
  }

  // Write each month
  for (const [path, activities] of Object.entries(byMonth)) {
    const existing = readActivities(path);
    const combined = [...existing, ...activities];
    writeActivities(path, combined);
  }

  writeBuffer = [];
}

/**
 * Record an activity
 *
 * @param action - Action type (from ACTIVITY_TYPES)
 * @param actor - Who performed the action
 * @param target - What was affected
 * @param data - Additional data
 * @returns Created activity
 */
export function record(
  action: string,
  actor: UserInput | null,
  target: { type?: string; id?: string; title?: string; name?: string } | null = null,
  data: Record<string, unknown> = {}
): ActivityEntry | null {
  if (!config.enabled || !activityDir) return null;

  const activity: ActivityEntry = {
    id: `act_${randomUUID().slice(0, 12)}`,
    action,
    actor: {
      id: actor?.id || null,
      username: actor?.username || actor?.email || 'system',
      type: actor?.type || 'user',
    },
    target: target
      ? {
          type: target.type || null,
          id: target.id || null,
          title: target.title || target.name || null,
        }
      : null,
    data: data || {},
    timestamp: new Date().toISOString(),
  };

  writeBuffer.push(activity);

  if (writeBuffer.length >= BUFFER_SIZE) {
    flush();
  }

  return activity;
}

/**
 * Get activity files in date range
 *
 * @param from - Start date
 * @param to - End date
 * @returns File paths
 */
function getFilesInRange(from: Date, to: Date): string[] {
  if (!existsSync(activityDir!)) return [];

  const files: string[] = [];
  const current = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth(), 1);

  while (current <= end) {
    const path = getStoragePath(current);
    if (existsSync(path)) {
      files.push(path);
    }
    current.setMonth(current.getMonth() + 1);
  }

  return files;
}

/**
 * Get aggregated activity feed
 *
 * @param options - Filter options
 * @returns Feed result
 */
export function getFeed(options: FeedOptions = {}): FeedResult | Promise<FeedResult> {
  const {
    action = null,
    actorId = null,
    targetType = null,
    days = 30,
    from = null,
    to = null,
    limit = 50,
    offset = 0,
    aggregate = true,
  } = options;

  flush();

  const toDate = to ? new Date(to) : new Date();
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - days * 24 * 60 * 60 * 1000);

  // DB mode: query from database (returns promise -- callers must handle)
  if (dbPool) {
    return _getFeedFromDb({
      action,
      actorId,
      targetType,
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      limit: aggregate ? 500 : limit,
      offset: aggregate ? 0 : offset,
      aggregate,
      requestedLimit: limit,
      requestedOffset: offset,
    });
  }

  const files = getFilesInRange(fromDate, toDate);
  let allActivities: ActivityEntry[] = [];

  for (const path of files) {
    const activities = readActivities(path);
    allActivities = allActivities.concat(activities);
  }

  // Filter
  let filtered = allActivities.filter((activity: ActivityEntry) => {
    const actDate = new Date(activity.timestamp);
    if (actDate < fromDate || actDate > toDate) return false;

    if (action && activity.action !== action) return false;
    if (actorId && activity.actor?.id !== actorId) return false;
    if (targetType && activity.target?.type !== targetType) return false;

    return true;
  });

  // Sort by timestamp descending
  filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Aggregate if requested
  if (aggregate) {
    filtered = aggregateActivities(filtered);
  }

  const total = filtered.length;
  const activities = filtered.slice(offset, offset + limit);

  // Add relative time and labels
  for (const activity of activities) {
    activity.label = getActionLabel(activity.action);
    activity.relativeTime = getRelativeTime(activity.timestamp);
  }

  return {
    activities,
    total,
    limit,
    offset,
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
  };
}

/**
 * Internal: get feed from database (async).
 */
async function _getFeedFromDb(opts: DbFeedOptions): Promise<FeedResult> {
  const {
    action,
    actorId,
    targetType,
    from,
    to,
    limit,
    offset,
    aggregate,
    requestedLimit,
    requestedOffset,
  } = opts;

  let dbActivities = await queryActivitiesFromDb({
    action,
    actorId,
    targetType,
    from,
    to,
    limit,
    offset,
  });
  if (!dbActivities) dbActivities = [];

  if (aggregate) {
    dbActivities = aggregateActivities(dbActivities);
    const total = dbActivities.length;
    const sliced = dbActivities.slice(requestedOffset, requestedOffset + requestedLimit);

    for (const activity of sliced) {
      activity.label = getActionLabel(activity.action);
      activity.relativeTime = getRelativeTime(activity.timestamp);
    }

    return { activities: sliced, total, limit: requestedLimit, offset: requestedOffset, from, to };
  }

  for (const activity of dbActivities) {
    activity.label = getActionLabel(activity.action);
    activity.relativeTime = getRelativeTime(activity.timestamp);
  }

  return {
    activities: dbActivities,
    total: dbActivities.length,
    limit: limit ?? 50,
    offset: offset ?? 0,
    from,
    to,
  };
}

/**
 * Aggregate similar activities
 *
 * Groups activities by same actor + same action + same target within window
 *
 * @param activities - Sorted activities (newest first)
 * @returns Aggregated activities
 */
export function aggregateActivities(activities: ActivityEntry[]): ActivityEntry[] {
  if (!activities.length) return [];

  const aggregated: ActivityEntry[] = [];
  let current: ActivityEntry | null = null;

  for (const activity of activities) {
    // Check if can aggregate with current
    if (current && canAggregate(current, activity)) {
      current.count = (current.count || 1) + 1;
      current.lastTimestamp = current.timestamp;
      current.firstTimestamp = activity.timestamp;
      // Collect fields that changed
      if (activity.data?.fields) {
        const fields = activity.data.fields as string[];
        current.data.allFields = current.data.allFields || [
          ...((current.data.fields as string[]) || []),
        ];
        const allFields = current.data.allFields as string[];
        for (const field of fields) {
          if (!allFields.includes(field)) {
            allFields.push(field);
          }
        }
      }
    } else {
      if (current) aggregated.push(current);
      current = { ...activity, count: 1 };
    }
  }

  if (current) aggregated.push(current);

  return aggregated;
}

/**
 * Check if two activities can be aggregated
 *
 * @param a - First activity
 * @param b - Second activity
 * @returns True if they can be aggregated
 */
function canAggregate(a: ActivityEntry, b: ActivityEntry): boolean {
  // Must be same actor
  if (a.actor?.id !== b.actor?.id) return false;

  // Must be same action
  if (a.action !== b.action) return false;

  // Must be same target (if any)
  if (a.target?.type !== b.target?.type) return false;
  if (a.target?.id !== b.target?.id) return false;

  // Must be within aggregation window
  const timeDiff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  if (timeDiff > config.aggregateWindow) return false;

  return true;
}

/**
 * Get activities for a specific user
 *
 * @param userId - User ID
 * @param options - Feed options
 * @returns Feed result
 */
export function getForUser(
  userId: string,
  options: FeedOptions = {}
): FeedResult | Promise<FeedResult> {
  return getFeed({ ...options, actorId: userId });
}

/**
 * Get activity timeline for specific content
 *
 * @param type - Content type
 * @param id - Content ID
 * @param options - Feed options
 * @returns Content feed result
 */
export function getForContent(
  type: string,
  id: string,
  options: FeedOptions = {}
): ContentFeedResult | Promise<ContentFeedResult> {
  const { days = 90, from = null, to = null, limit = 100, offset = 0 } = options;

  flush();

  const toDate = to ? new Date(to) : new Date();
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - days * 24 * 60 * 60 * 1000);

  // DB mode: query directly
  if (dbPool) {
    return _getForContentFromDb(
      type,
      id,
      fromDate.toISOString(),
      toDate.toISOString(),
      limit,
      offset
    );
  }

  const files = getFilesInRange(fromDate, toDate);
  let allActivities: ActivityEntry[] = [];

  for (const path of files) {
    const activities = readActivities(path);
    allActivities = allActivities.concat(activities);
  }

  // Filter by target
  const filtered = allActivities.filter((activity: ActivityEntry) => {
    if (!activity.target) return false;
    return activity.target.type === type && activity.target.id === id;
  });

  // Sort by timestamp descending
  filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const total = filtered.length;
  const activities = filtered.slice(offset, offset + limit);

  // Add relative time and labels
  for (const activity of activities) {
    activity.label = getActionLabel(activity.action);
    activity.relativeTime = getRelativeTime(activity.timestamp);
  }

  return {
    activities,
    total,
    type,
    id,
    limit,
    offset,
  };
}

/**
 * Internal: get content activities from database (async).
 */
async function _getForContentFromDb(
  type: string,
  id: string,
  from: string,
  to: string,
  limit: number,
  offset: number
): Promise<ContentFeedResult> {
  let activities = await queryActivitiesFromDb({
    targetType: type,
    targetId: id,
    from,
    to,
    limit,
    offset,
  });
  if (!activities) activities = [];

  for (const activity of activities) {
    activity.label = getActionLabel(activity.action);
    activity.relativeTime = getRelativeTime(activity.timestamp);
  }

  return { activities, total: activities.length, type, id, limit, offset };
}

/**
 * Get most recent activities
 *
 * @param limit - Max activities to return
 * @returns Activities array
 */
export function getRecent(limit: number = 10): ActivityEntry[] {
  const result = getFeed({ limit, aggregate: true });
  // WHY: In flat-file mode getFeed returns sync; in DB mode it returns a promise.
  // For getRecent we assume flat-file (sync) usage.
  return (result as FeedResult).activities;
}

/**
 * Get activity statistics
 *
 * @param options - Feed options
 * @returns Activity stats
 */
export function getStats(options: FeedOptions = {}): ActivityStats {
  const result = getFeed({
    ...options,
    limit: Number.MAX_SAFE_INTEGER,
    aggregate: false,
  }) as FeedResult;

  const stats: ActivityStats = {
    total: result.total,
    from: result.from,
    to: result.to,
    byAction: {},
    byActor: {},
    byTargetType: {},
    byDay: {},
    topContent: [],
  };

  const topContentMap: Record<
    string,
    { type: string; id: string; title: string | null; count: number }
  > = {};

  for (const activity of result.activities) {
    // By action
    stats.byAction[activity.action] = (stats.byAction[activity.action] || 0) + 1;

    // By actor
    const actor = activity.actor?.username || '(system)';
    stats.byActor[actor] = (stats.byActor[actor] || 0) + 1;

    // By target type
    if (activity.target?.type) {
      stats.byTargetType[activity.target.type] =
        (stats.byTargetType[activity.target.type] || 0) + 1;
    }

    // By day
    const day = activity.timestamp.slice(0, 10);
    stats.byDay[day] = (stats.byDay[day] || 0) + 1;

    // Top content
    if (activity.target?.type && activity.target?.id) {
      const key = `${activity.target.type}/${activity.target.id}`;
      if (!topContentMap[key]) {
        topContentMap[key] = {
          type: activity.target.type,
          id: activity.target.id,
          title: activity.target.title,
          count: 0,
        };
      }
      topContentMap[key].count++;
    }
  }

  // Sort and limit top content
  stats.topContent = Object.values(topContentMap)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Sort by action count
  stats.byAction = Object.fromEntries(Object.entries(stats.byAction).sort((a, b) => b[1] - a[1]));

  // Sort by actor count
  stats.byActor = Object.fromEntries(Object.entries(stats.byActor).sort((a, b) => b[1] - a[1]));

  return stats;
}

/**
 * Get human-readable action label
 *
 * @param action - Action type
 * @returns Human-readable label
 */
function getActionLabel(action: string): string {
  return ACTION_LABELS[action] || action;
}

/**
 * Get relative time string
 *
 * @param timestamp - ISO timestamp
 * @returns Relative time string
 */
function getRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diff = now - then;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;

  return new Date(timestamp).toLocaleDateString();
}

/**
 * Format activity for display
 *
 * @param activity - Activity entry
 * @returns Formatted string
 */
export function formatActivity(activity: ActivityEntry): string {
  const actor = activity.actor?.username || 'Someone';
  const label = getActionLabel(activity.action);
  const count = (activity.count ?? 0) > 1 ? ` (${activity.count} times)` : '';

  let target = '';
  if (activity.target) {
    const title = activity.target.title || activity.target.id;
    target = ` ${activity.target.type}/${title}`;
  }

  const time = getRelativeTime(activity.timestamp);

  return `${actor} ${label}${target}${count} - ${time}`;
}

/**
 * Prune old activity data
 *
 * @param olderThanDays - Days to keep (null uses config.retention)
 * @returns Prune result
 */
export function prune(olderThanDays: number | null = null): { deleted: number } {
  const days = olderThanDays ?? config.retention;
  if (days <= 0) return { deleted: 0 };

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  let totalDeleted = 0;

  if (!existsSync(activityDir!)) return { deleted: 0 };

  const years = readdirSync(activityDir!).filter((f: string) => /^\d{4}$/.test(f));

  for (const year of years) {
    const yearDir = join(activityDir!, year);
    const months = readdirSync(yearDir).filter((f: string) => f.endsWith('.json'));

    for (const monthFile of months) {
      const month = monthFile.replace('.json', '');
      const endOfMonth = new Date(parseInt(year), parseInt(month), 0);

      if (endOfMonth < cutoff) {
        const path = join(yearDir, monthFile);
        const activities = readActivities(path);
        totalDeleted += activities.length;

        try {
          unlinkSync(path);
        } catch (_e: unknown) {
          // Ignore
        }
      }
    }
  }

  return { deleted: totalDeleted };
}

/**
 * Convenience methods for recording common activities
 */

export function recordContentCreate(
  user: UserInput,
  type: string,
  id: string,
  title: string
): ActivityEntry | null {
  return record(ACTIVITY_TYPES.CONTENT_CREATE!, user, { type, id, title });
}

export function recordContentUpdate(
  user: UserInput,
  type: string,
  id: string,
  title: string,
  fields: string[] = []
): ActivityEntry | null {
  return record(ACTIVITY_TYPES.CONTENT_UPDATE!, user, { type, id, title }, { fields });
}

export function recordContentDelete(
  user: UserInput,
  type: string,
  id: string,
  title: string
): ActivityEntry | null {
  return record(ACTIVITY_TYPES.CONTENT_DELETE!, user, { type, id, title });
}

export function recordContentPublish(
  user: UserInput,
  type: string,
  id: string,
  title: string
): ActivityEntry | null {
  return record(ACTIVITY_TYPES.CONTENT_PUBLISH!, user, { type, id, title });
}

export function recordContentUnpublish(
  user: UserInput,
  type: string,
  id: string,
  title: string
): ActivityEntry | null {
  return record(ACTIVITY_TYPES.CONTENT_UNPUBLISH!, user, { type, id, title });
}

export function recordContentClone(
  user: UserInput,
  type: string,
  id: string,
  title: string,
  sourceId: string
): ActivityEntry | null {
  return record(ACTIVITY_TYPES.CONTENT_CLONE!, user, { type, id, title }, { sourceId });
}

export function recordComment(
  user: UserInput,
  type: string,
  id: string,
  title: string,
  commentId: string
): ActivityEntry | null {
  return record(ACTIVITY_TYPES.CONTENT_COMMENT!, user, { type, id, title }, { commentId });
}

export function recordMediaUpload(
  user: UserInput,
  filename: string,
  mediaId: string
): ActivityEntry | null {
  return record(ACTIVITY_TYPES.MEDIA_UPLOAD!, user, {
    type: 'media',
    id: mediaId,
    title: filename,
  });
}

export function recordUserLogin(user: UserInput): ActivityEntry | null {
  return record(ACTIVITY_TYPES.USER_LOGIN!, user);
}

export function recordSystemBackup(details: Record<string, unknown> = {}): ActivityEntry | null {
  return record(
    ACTIVITY_TYPES.SYSTEM_BACKUP!,
    { type: 'system', username: 'system' },
    null,
    details
  );
}

/**
 * Get configuration
 *
 * @returns Config copy
 */
export function getConfig(): ActivityConfig {
  return { ...config };
}

/**
 * Check if activity tracking is enabled
 *
 * @returns True if enabled
 */
export function isEnabled(): boolean {
  return config.enabled;
}
