/**
 * notifications.js - User Notification System
 *
 * WHY THIS EXISTS:
 * ================
 * Users need to be notified of events:
 * - Content published/updated
 * - Comments on their content
 * - Workflow status changes
 * - System alerts
 *
 * NOTIFICATION CHANNELS:
 * =====================
 * - app: In-app notifications (stored, displayed in UI)
 * - email: Email notifications (sent via email.js)
 * - webhook: Webhook notifications (for integrations)
 *
 * NOTIFICATION TYPES:
 * ==================
 * - content.published
 * - content.updated
 * - content.commented
 * - content.mentioned
 * - workflow.pending
 * - workflow.approved
 * - workflow.rejected
 * - user.welcome
 * - system.alert
 *
 * USER PREFERENCES:
 * ================
 * Users can configure which channels receive which notification types.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

// ============================================
// STATE
// ============================================

/**
 * Notifications storage
 * Structure: { notificationId: { ...data } }
 */
let notifications = {};

/**
 * User notification preferences
 * Structure: { userId: { type: { channel: bool } } }
 */
let preferences = {};

/**
 * Storage paths
 */
let notificationsFile = null;
let preferencesFile = null;

/**
 * Content directory
 */
let contentDir = null;

/**
 * Email service reference
 */
let emailService = null;

/**
 * Webhooks service reference
 */
let webhooksService = null;

/**
 * Configuration
 */
let config = {
  enabled: true,
  maxPerUser: 100,      // Max notifications to keep per user
  defaultChannels: ['app'],
  emailTemplates: {
    'content.published': 'notification',
    'content.commented': 'comment',
    'user.welcome': 'welcome',
    'default': 'notification'
  }
};

/**
 * Default notification preferences
 */
const DEFAULT_PREFERENCES = {
  'content.published': { app: true, email: false },
  'content.updated': { app: true, email: false },
  'content.commented': { app: true, email: true },
  'content.mentioned': { app: true, email: true },
  'workflow.pending': { app: true, email: true },
  'workflow.approved': { app: true, email: false },
  'workflow.rejected': { app: true, email: true },
  'user.welcome': { app: true, email: true },
  'system.alert': { app: true, email: false }
};

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize notification system
 *
 * @param {Object} cfg - Configuration
 * @param {string} baseDir - Base directory
 * @param {Object} email - Email service
 * @param {Object} webhooks - Webhooks service
 */
export function init(cfg = {}, baseDir = '', email = null, webhooks = null) {
  config = { ...config, ...cfg };
  contentDir = join(baseDir, 'content');
  emailService = email;
  webhooksService = webhooks;

  // Ensure notifications directory exists
  const notificationsDir = join(contentDir, '.notifications');
  if (!existsSync(notificationsDir)) {
    mkdirSync(notificationsDir, { recursive: true });
  }

  notificationsFile = join(notificationsDir, 'notifications.json');
  preferencesFile = join(notificationsDir, 'preferences.json');

  // Load existing data
  loadNotifications();
  loadPreferences();

  const count = Object.keys(notifications).length;
  console.log(`[notifications] Initialized (${count} stored)`);
}

/**
 * Load notifications from storage
 */
function loadNotifications() {
  if (existsSync(notificationsFile)) {
    try {
      const data = readFileSync(notificationsFile, 'utf-8');
      notifications = JSON.parse(data);
    } catch (e) {
      console.error('[notifications] Failed to load:', e.message);
      notifications = {};
    }
  }
}

/**
 * Save notifications to storage
 */
function saveNotifications() {
  try {
    const dir = join(contentDir, '.notifications');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(notificationsFile, JSON.stringify(notifications, null, 2));
  } catch (e) {
    console.error('[notifications] Failed to save:', e.message);
  }
}

/**
 * Load preferences from storage
 */
function loadPreferences() {
  if (existsSync(preferencesFile)) {
    try {
      const data = readFileSync(preferencesFile, 'utf-8');
      preferences = JSON.parse(data);
    } catch (e) {
      console.error('[notifications] Failed to load preferences:', e.message);
      preferences = {};
    }
  }
}

/**
 * Save preferences to storage
 */
function savePreferences() {
  try {
    const dir = join(contentDir, '.notifications');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(preferencesFile, JSON.stringify(preferences, null, 2));
  } catch (e) {
    console.error('[notifications] Failed to save preferences:', e.message);
  }
}

// ============================================
// NOTIFICATION SENDING
// ============================================

/**
 * Generate a notification ID
 */
function generateId() {
  return 'notif_' + randomBytes(8).toString('hex');
}

/**
 * Send a notification to a user
 *
 * @param {string} userId - User ID
 * @param {Object} notification - Notification data
 * @returns {Object} Created notification
 */
export async function send(userId, notification) {
  if (!config.enabled) {
    return null;
  }

  const id = generateId();
  const now = new Date().toISOString();

  // Determine channels based on preferences
  const userPrefs = getUserPreferences(userId);
  const typePrefs = userPrefs[notification.type] || DEFAULT_PREFERENCES[notification.type] || { app: true };
  const channels = [];

  if (typePrefs.app !== false) channels.push('app');
  if (typePrefs.email === true) channels.push('email');
  if (typePrefs.webhook === true) channels.push('webhook');

  // Create notification object
  const notificationData = {
    id,
    userId,
    type: notification.type || 'system.alert',
    title: notification.title || '',
    message: notification.message || '',
    link: notification.link || null,
    data: notification.data || {},
    read: false,
    createdAt: now,
    channels
  };

  // Store in-app notification
  if (channels.includes('app')) {
    notifications[id] = notificationData;
    saveNotifications();
    pruneUserNotifications(userId);
  }

  // Send email if enabled
  if (channels.includes('email') && emailService) {
    try {
      const template = config.emailTemplates[notification.type] || config.emailTemplates.default;
      await emailService.sendTemplate(
        notification.email || `${userId}@example.com`,
        template,
        {
          subject: notificationData.title,
          title: notificationData.title,
          message: notificationData.message,
          link: notificationData.link,
          type: notificationData.type
        }
      );
    } catch (e) {
      console.error(`[notifications] Email send failed:`, e.message);
    }
  }

  // Trigger webhook if enabled
  if (channels.includes('webhook') && webhooksService) {
    try {
      await webhooksService.trigger(`notification:${notification.type}`, notificationData);
    } catch (e) {
      console.error(`[notifications] Webhook trigger failed:`, e.message);
    }
  }

  return notificationData;
}

/**
 * Send notification to multiple users
 *
 * @param {string[]} userIds - Array of user IDs
 * @param {Object} notification - Notification data
 * @returns {Object[]} Created notifications
 */
export async function sendBulk(userIds, notification) {
  const results = [];

  for (const userId of userIds) {
    const result = await send(userId, notification);
    if (result) {
      results.push(result);
    }
  }

  return results;
}

/**
 * Send notification to all users
 *
 * @param {Object} notification - Notification data
 * @param {Function} getUserIds - Function to get user IDs
 * @returns {Object[]} Created notifications
 */
export async function broadcast(notification, getUserIds) {
  const userIds = getUserIds ? await getUserIds() : [];
  return sendBulk(userIds, notification);
}

// ============================================
// NOTIFICATION RETRIEVAL
// ============================================

/**
 * Get notifications for a user
 *
 * @param {string} userId - User ID
 * @param {Object} options - Query options
 * @returns {Object} { items, total, unread }
 */
export function getForUser(userId, options = {}) {
  const {
    page = 1,
    limit = 20,
    unreadOnly = false,
    type = null
  } = options;

  let items = Object.values(notifications)
    .filter(n => n.userId === userId)
    .filter(n => !unreadOnly || !n.read)
    .filter(n => !type || n.type === type)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const total = items.length;
  const unread = items.filter(n => !n.read).length;

  // Paginate
  const start = (page - 1) * limit;
  items = items.slice(start, start + limit);

  return { items, total, unread, page, limit };
}

/**
 * Get a single notification
 *
 * @param {string} id - Notification ID
 * @returns {Object|null} Notification or null
 */
export function get(id) {
  return notifications[id] || null;
}

/**
 * Get unread count for a user
 *
 * @param {string} userId - User ID
 * @returns {number} Unread count
 */
export function getUnreadCount(userId) {
  return Object.values(notifications)
    .filter(n => n.userId === userId && !n.read)
    .length;
}

// ============================================
// NOTIFICATION MANAGEMENT
// ============================================

/**
 * Mark a notification as read
 *
 * @param {string} id - Notification ID
 * @returns {boolean} Success
 */
export function markRead(id) {
  const notification = notifications[id];
  if (!notification) return false;

  notification.read = true;
  notification.readAt = new Date().toISOString();
  saveNotifications();

  return true;
}

/**
 * Mark all notifications as read for a user
 *
 * @param {string} userId - User ID
 * @returns {number} Count marked
 */
export function markAllRead(userId) {
  let count = 0;
  const now = new Date().toISOString();

  for (const notification of Object.values(notifications)) {
    if (notification.userId === userId && !notification.read) {
      notification.read = true;
      notification.readAt = now;
      count++;
    }
  }

  if (count > 0) {
    saveNotifications();
  }

  return count;
}

/**
 * Delete a notification
 *
 * @param {string} id - Notification ID
 * @returns {boolean} Success
 */
export function deleteNotification(id) {
  if (!notifications[id]) return false;

  delete notifications[id];
  saveNotifications();

  return true;
}

/**
 * Delete all read notifications for a user
 *
 * @param {string} userId - User ID
 * @returns {number} Count deleted
 */
export function deleteRead(userId) {
  let count = 0;

  for (const [id, notification] of Object.entries(notifications)) {
    if (notification.userId === userId && notification.read) {
      delete notifications[id];
      count++;
    }
  }

  if (count > 0) {
    saveNotifications();
  }

  return count;
}

/**
 * Prune old notifications for a user
 */
function pruneUserNotifications(userId) {
  const userNotifications = Object.values(notifications)
    .filter(n => n.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  if (userNotifications.length > config.maxPerUser) {
    const toRemove = userNotifications.slice(config.maxPerUser);
    for (const n of toRemove) {
      delete notifications[n.id];
    }
    saveNotifications();
  }
}

// ============================================
// USER PREFERENCES
// ============================================

/**
 * Get user notification preferences
 *
 * @param {string} userId - User ID
 * @returns {Object} Preferences object
 */
export function getUserPreferences(userId) {
  return preferences[userId] || { ...DEFAULT_PREFERENCES };
}

/**
 * Set user notification preferences
 *
 * @param {string} userId - User ID
 * @param {Object} prefs - Preferences to set
 * @returns {Object} Updated preferences
 */
export function setUserPreferences(userId, prefs) {
  preferences[userId] = {
    ...getUserPreferences(userId),
    ...prefs
  };
  savePreferences();

  return preferences[userId];
}

/**
 * Update single preference
 *
 * @param {string} userId - User ID
 * @param {string} type - Notification type
 * @param {string} channel - Channel name
 * @param {boolean} enabled - Enable/disable
 */
export function setPreference(userId, type, channel, enabled) {
  if (!preferences[userId]) {
    preferences[userId] = { ...DEFAULT_PREFERENCES };
  }
  if (!preferences[userId][type]) {
    preferences[userId][type] = { app: true };
  }

  preferences[userId][type][channel] = enabled;
  savePreferences();
}

/**
 * Get default preferences
 */
export function getDefaultPreferences() {
  return { ...DEFAULT_PREFERENCES };
}

// ============================================
// STATISTICS
// ============================================

/**
 * Get notification statistics
 *
 * @returns {Object} Stats object
 */
export function getStats() {
  const all = Object.values(notifications);
  const byType = {};
  const byUser = {};

  for (const n of all) {
    byType[n.type] = (byType[n.type] || 0) + 1;
    byUser[n.userId] = (byUser[n.userId] || 0) + 1;
  }

  return {
    total: all.length,
    unread: all.filter(n => !n.read).length,
    read: all.filter(n => n.read).length,
    byType,
    userCount: Object.keys(byUser).length,
    topUsers: Object.entries(byUser)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([userId, count]) => ({ userId, count }))
  };
}

/**
 * List all notifications (admin)
 *
 * @param {Object} options - Query options
 * @returns {Object} { items, total }
 */
export function listAll(options = {}) {
  const {
    page = 1,
    limit = 50,
    unreadOnly = false,
    type = null,
    userId = null
  } = options;

  let items = Object.values(notifications)
    .filter(n => !unreadOnly || !n.read)
    .filter(n => !type || n.type === type)
    .filter(n => !userId || n.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const total = items.length;

  // Paginate
  const start = (page - 1) * limit;
  items = items.slice(start, start + limit);

  return { items, total, page, limit };
}

/**
 * Get notification types
 */
export function getNotificationTypes() {
  return Object.keys(DEFAULT_PREFERENCES);
}
