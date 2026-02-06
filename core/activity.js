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
 * - Aggregates similar activities (3 edits → "edited 3 times")
 * - Stores actor/target context for meaningful display
 * - Supports filtering by user, content, action type
 *
 * STORAGE:
 * Separate from audit logs - optimized for display, not compliance.
 * /content/.activity/<year>/<month>.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Activity types
 */
export const ACTIVITY_TYPES = {
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
const ACTION_LABELS = {
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

/**
 * Configuration
 */
let config = {
  enabled: true,
  aggregateWindow: 5 * 60 * 1000, // 5 minutes - group activities within this window
  retention: 90,                   // Days to keep activity data
  maxPerFeed: 100,                // Max items in a single feed query
};

/**
 * Storage directory
 */
let baseDir = null;
let activityDir = null;
let contentService = null;

/**
 * In-memory buffer for batch writes
 */
let writeBuffer = [];
const FLUSH_INTERVAL_MS = 5000;
const BUFFER_SIZE = 20;
let flushInterval = null;

/**
 * Initialize activity system
 *
 * @param {string} dir - Base directory
 * @param {Object} contentSvc - Content service
 * @param {Object} activityConfig - Activity configuration
 */
export function init(dir, contentSvc, activityConfig = {}) {
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
 * @param {Date} date
 * @returns {string}
 */
function getStoragePath(date = new Date()) {
  const year = date.getFullYear().toString();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');

  const yearDir = join(activityDir, year);
  if (!existsSync(yearDir)) {
    mkdirSync(yearDir, { recursive: true });
  }

  return join(yearDir, `${month}.json`);
}

/**
 * Read activities from storage file
 *
 * @param {string} path
 * @returns {Array}
 */
function readActivities(path) {
  if (!existsSync(path)) {
    return [];
  }

  try {
    const data = readFileSync(path, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.warn(`[activity] Failed to read ${path}: ${error.message}`);
    return [];
  }
}

/**
 * Write activities to storage file
 *
 * @param {string} path
 * @param {Array} activities
 */
function writeActivities(path, activities) {
  try {
    writeFileSync(path, JSON.stringify(activities, null, 2) + '\n');
  } catch (error) {
    console.error(`[activity] Failed to write ${path}: ${error.message}`);
  }
}

/**
 * Flush buffer to disk
 */
export function flush() {
  if (writeBuffer.length === 0) return;

  // Group by month
  const byMonth = {};
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
 * @param {string} action - Action type (from ACTIVITY_TYPES)
 * @param {Object} actor - Who performed the action
 * @param {Object} target - What was affected
 * @param {Object} data - Additional data
 * @returns {Object} - Created activity
 */
export function record(action, actor, target = null, data = {}) {
  if (!config.enabled || !activityDir) return null;

  const activity = {
    id: `act_${randomUUID().slice(0, 12)}`,
    action,
    actor: {
      id: actor?.id || null,
      username: actor?.username || actor?.email || 'system',
      type: actor?.type || 'user',
    },
    target: target ? {
      type: target.type || null,
      id: target.id || null,
      title: target.title || target.name || null,
    } : null,
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
 * @param {Date} from
 * @param {Date} to
 * @returns {string[]}
 */
function getFilesInRange(from, to) {
  if (!existsSync(activityDir)) return [];

  const files = [];
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
 * @param {Object} options - Filter options
 * @returns {Object} - { activities: [], total: number }
 */
export function getFeed(options = {}) {
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

  const files = getFilesInRange(fromDate, toDate);
  let allActivities = [];

  for (const path of files) {
    const activities = readActivities(path);
    allActivities = allActivities.concat(activities);
  }

  // Filter
  let filtered = allActivities.filter(activity => {
    const actDate = new Date(activity.timestamp);
    if (actDate < fromDate || actDate > toDate) return false;

    if (action && activity.action !== action) return false;
    if (actorId && activity.actor?.id !== actorId) return false;
    if (targetType && activity.target?.type !== targetType) return false;

    return true;
  });

  // Sort by timestamp descending
  filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

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
 * Aggregate similar activities
 *
 * Groups activities by same actor + same action + same target within window
 *
 * @param {Array} activities - Sorted activities (newest first)
 * @returns {Array} - Aggregated activities
 */
export function aggregateActivities(activities) {
  if (!activities.length) return [];

  const aggregated = [];
  let current = null;

  for (const activity of activities) {
    // Check if can aggregate with current
    if (current && canAggregate(current, activity)) {
      current.count = (current.count || 1) + 1;
      current.lastTimestamp = current.timestamp;
      current.firstTimestamp = activity.timestamp;
      // Collect fields that changed
      if (activity.data?.fields) {
        current.data.allFields = current.data.allFields || [...(current.data.fields || [])];
        for (const field of activity.data.fields) {
          if (!current.data.allFields.includes(field)) {
            current.data.allFields.push(field);
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
 * @param {Object} a - First activity
 * @param {Object} b - Second activity
 * @returns {boolean}
 */
function canAggregate(a, b) {
  // Must be same actor
  if (a.actor?.id !== b.actor?.id) return false;

  // Must be same action
  if (a.action !== b.action) return false;

  // Must be same target (if any)
  if (a.target?.type !== b.target?.type) return false;
  if (a.target?.id !== b.target?.id) return false;

  // Must be within aggregation window
  const timeDiff = new Date(a.timestamp) - new Date(b.timestamp);
  if (timeDiff > config.aggregateWindow) return false;

  return true;
}

/**
 * Get activities for a specific user
 *
 * @param {string} userId - User ID
 * @param {Object} options
 * @returns {Object}
 */
export function getForUser(userId, options = {}) {
  return getFeed({ ...options, actorId: userId });
}

/**
 * Get activity timeline for specific content
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {Object} options
 * @returns {Object}
 */
export function getForContent(type, id, options = {}) {
  const {
    days = 90,
    from = null,
    to = null,
    limit = 100,
    offset = 0,
  } = options;

  flush();

  const toDate = to ? new Date(to) : new Date();
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - days * 24 * 60 * 60 * 1000);

  const files = getFilesInRange(fromDate, toDate);
  let allActivities = [];

  for (const path of files) {
    const activities = readActivities(path);
    allActivities = allActivities.concat(activities);
  }

  // Filter by target
  let filtered = allActivities.filter(activity => {
    if (!activity.target) return false;
    return activity.target.type === type && activity.target.id === id;
  });

  // Sort by timestamp descending
  filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

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
 * Get most recent activities
 *
 * @param {number} limit
 * @returns {Array}
 */
export function getRecent(limit = 10) {
  const result = getFeed({ limit, aggregate: true });
  return result.activities;
}

/**
 * Get activity statistics
 *
 * @param {Object} options
 * @returns {Object}
 */
export function getStats(options = {}) {
  const result = getFeed({ ...options, limit: Number.MAX_SAFE_INTEGER, aggregate: false });

  const stats = {
    total: result.total,
    from: result.from,
    to: result.to,
    byAction: {},
    byActor: {},
    byTargetType: {},
    byDay: {},
    topContent: {},
  };

  for (const activity of result.activities) {
    // By action
    stats.byAction[activity.action] = (stats.byAction[activity.action] || 0) + 1;

    // By actor
    const actor = activity.actor?.username || '(system)';
    stats.byActor[actor] = (stats.byActor[actor] || 0) + 1;

    // By target type
    if (activity.target?.type) {
      stats.byTargetType[activity.target.type] = (stats.byTargetType[activity.target.type] || 0) + 1;
    }

    // By day
    const day = activity.timestamp.slice(0, 10);
    stats.byDay[day] = (stats.byDay[day] || 0) + 1;

    // Top content
    if (activity.target?.type && activity.target?.id) {
      const key = `${activity.target.type}/${activity.target.id}`;
      if (!stats.topContent[key]) {
        stats.topContent[key] = {
          type: activity.target.type,
          id: activity.target.id,
          title: activity.target.title,
          count: 0,
        };
      }
      stats.topContent[key].count++;
    }
  }

  // Sort and limit top content
  stats.topContent = Object.values(stats.topContent)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Sort by action count
  stats.byAction = Object.fromEntries(
    Object.entries(stats.byAction).sort((a, b) => b[1] - a[1])
  );

  // Sort by actor count
  stats.byActor = Object.fromEntries(
    Object.entries(stats.byActor).sort((a, b) => b[1] - a[1])
  );

  return stats;
}

/**
 * Get human-readable action label
 *
 * @param {string} action
 * @returns {string}
 */
function getActionLabel(action) {
  return ACTION_LABELS[action] || action;
}

/**
 * Get relative time string
 *
 * @param {string} timestamp
 * @returns {string}
 */
function getRelativeTime(timestamp) {
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
 * @param {Object} activity
 * @returns {string}
 */
export function formatActivity(activity) {
  const actor = activity.actor?.username || 'Someone';
  const label = getActionLabel(activity.action);
  const count = activity.count > 1 ? ` (${activity.count} times)` : '';

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
 * @param {number} olderThanDays
 * @returns {Object}
 */
export function prune(olderThanDays = null) {
  const days = olderThanDays ?? config.retention;
  if (days <= 0) return { deleted: 0 };

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  let totalDeleted = 0;

  if (!existsSync(activityDir)) return { deleted: 0 };

  const years = readdirSync(activityDir).filter(f => /^\d{4}$/.test(f));

  for (const year of years) {
    const yearDir = join(activityDir, year);
    const months = readdirSync(yearDir).filter(f => f.endsWith('.json'));

    for (const monthFile of months) {
      const month = monthFile.replace('.json', '');
      const endOfMonth = new Date(parseInt(year), parseInt(month), 0);

      if (endOfMonth < cutoff) {
        const path = join(yearDir, monthFile);
        const activities = readActivities(path);
        totalDeleted += activities.length;

        try {
          const { unlinkSync } = require('node:fs');
          unlinkSync(path);
        } catch (e) {
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

export function recordContentCreate(user, type, id, title) {
  return record(ACTIVITY_TYPES.CONTENT_CREATE, user, { type, id, title });
}

export function recordContentUpdate(user, type, id, title, fields = []) {
  return record(ACTIVITY_TYPES.CONTENT_UPDATE, user, { type, id, title }, { fields });
}

export function recordContentDelete(user, type, id, title) {
  return record(ACTIVITY_TYPES.CONTENT_DELETE, user, { type, id, title });
}

export function recordContentPublish(user, type, id, title) {
  return record(ACTIVITY_TYPES.CONTENT_PUBLISH, user, { type, id, title });
}

export function recordContentUnpublish(user, type, id, title) {
  return record(ACTIVITY_TYPES.CONTENT_UNPUBLISH, user, { type, id, title });
}

export function recordContentClone(user, type, id, title, sourceId) {
  return record(ACTIVITY_TYPES.CONTENT_CLONE, user, { type, id, title }, { sourceId });
}

export function recordComment(user, type, id, title, commentId) {
  return record(ACTIVITY_TYPES.CONTENT_COMMENT, user, { type, id, title }, { commentId });
}

export function recordMediaUpload(user, filename, mediaId) {
  return record(ACTIVITY_TYPES.MEDIA_UPLOAD, user, { type: 'media', id: mediaId, title: filename });
}

export function recordUserLogin(user) {
  return record(ACTIVITY_TYPES.USER_LOGIN, user);
}

export function recordSystemBackup(details = {}) {
  return record(ACTIVITY_TYPES.SYSTEM_BACKUP, { type: 'system', username: 'system' }, null, details);
}

/**
 * Get configuration
 *
 * @returns {Object}
 */
export function getConfig() {
  return { ...config };
}

/**
 * Check if activity tracking is enabled
 *
 * @returns {boolean}
 */
export function isEnabled() {
  return config.enabled;
}
