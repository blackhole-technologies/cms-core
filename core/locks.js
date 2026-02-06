/**
 * Content Locking System
 *
 * Prevents edit collisions by tracking which users are editing content.
 * Locks auto-expire after timeout and can be forcefully released by admins.
 *
 * Lock structure:
 * {
 *   type: string,        // Content type
 *   id: string,          // Content ID
 *   userId: string,      // User who holds the lock
 *   username: string,    // Display name
 *   acquiredAt: string,  // ISO timestamp
 *   expiresAt: string,   // ISO timestamp
 *   lastActivity: string // ISO timestamp (for heartbeat)
 * }
 */

import * as fs from 'fs';
import * as path from 'path';

// Configuration
let enabled = true;
let timeout = 1800;        // 30 minutes default
let gracePeriod = 60;      // 1 minute grace after expiry
let contentDir = './content';

// In-memory lock storage
// Key: "type/id", Value: lock object
const locks = new Map();

// Persistence file path
let lockFile = null;

/**
 * Initialize the locking system
 * @param {object} config - Configuration object
 */
export function init(config = {}) {
  if (config.enabled !== undefined) enabled = config.enabled;
  if (config.timeout !== undefined) timeout = config.timeout;
  if (config.gracePeriod !== undefined) gracePeriod = config.gracePeriod;
  if (config.contentDir !== undefined) contentDir = config.contentDir;

  // Set up persistence file
  const locksDir = path.join(contentDir, '.locks');
  lockFile = path.join(locksDir, 'index.json');

  // Create locks directory if needed
  if (!fs.existsSync(locksDir)) {
    fs.mkdirSync(locksDir, { recursive: true });
  }

  // Load persisted locks
  loadLocks();

  // Cleanup expired on init
  cleanupExpired();

  console.log(`[locks] Initialized (timeout: ${timeout}s, grace: ${gracePeriod}s)`);
}

/**
 * Load locks from persistence file
 */
function loadLocks() {
  if (!lockFile || !fs.existsSync(lockFile)) {
    return;
  }

  try {
    const data = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    locks.clear();

    for (const lock of data) {
      const key = `${lock.type}/${lock.id}`;
      locks.set(key, lock);
    }
  } catch (error) {
    console.error('[locks] Failed to load locks:', error.message);
  }
}

/**
 * Save locks to persistence file
 */
function saveLocks() {
  if (!lockFile) return;

  try {
    const data = Array.from(locks.values());
    fs.writeFileSync(lockFile, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('[locks] Failed to save locks:', error.message);
  }
}

/**
 * Generate lock key from type and id
 */
function lockKey(type, id) {
  return `${type}/${id}`;
}

/**
 * Check if a lock has expired
 */
function isExpired(lock) {
  if (!lock || !lock.expiresAt) return true;
  return new Date(lock.expiresAt) < new Date();
}

/**
 * Check if lock is in grace period (expired but within grace window)
 */
function isInGracePeriod(lock) {
  if (!lock || !lock.expiresAt) return false;
  const expiresAt = new Date(lock.expiresAt);
  const graceEnd = new Date(expiresAt.getTime() + gracePeriod * 1000);
  const now = new Date();
  return now >= expiresAt && now < graceEnd;
}

/**
 * Acquire a lock on content
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {string} userId - User ID
 * @param {object} options - Options
 * @returns {object|null} Lock object or null if failed
 */
export function acquireLock(type, id, userId, options = {}) {
  if (!enabled) {
    return { type, id, userId, disabled: true };
  }

  const key = lockKey(type, id);
  const existing = locks.get(key);

  // Check if already locked by another user
  if (existing && !isExpired(existing)) {
    if (existing.userId !== userId) {
      // Locked by someone else
      return null;
    }
    // Already locked by same user - refresh it
    return refreshLock(type, id, userId);
  }

  // Check grace period - only original holder can reclaim during grace
  if (existing && isInGracePeriod(existing) && existing.userId !== userId) {
    return null;
  }

  const now = new Date();
  const lockTimeout = options.timeout || timeout;
  const expiresAt = new Date(now.getTime() + lockTimeout * 1000);

  const lock = {
    type,
    id,
    userId,
    username: options.username || userId,
    acquiredAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    lastActivity: now.toISOString(),
  };

  locks.set(key, lock);
  saveLocks();

  return lock;
}

/**
 * Release a lock
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {string} userId - User ID (must match lock holder)
 * @returns {boolean} True if released
 */
export function releaseLock(type, id, userId) {
  if (!enabled) return true;

  const key = lockKey(type, id);
  const existing = locks.get(key);

  if (!existing) {
    return true; // Already unlocked
  }

  // Only lock holder can release (unless using forceRelease)
  if (existing.userId !== userId) {
    return false;
  }

  locks.delete(key);
  saveLocks();

  return true;
}

/**
 * Check lock status
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @returns {object} Lock status
 */
export function checkLock(type, id) {
  if (!enabled) {
    return { locked: false, enabled: false };
  }

  const key = lockKey(type, id);
  const lock = locks.get(key);

  if (!lock) {
    return { locked: false };
  }

  if (isExpired(lock)) {
    // Check grace period
    if (isInGracePeriod(lock)) {
      const graceEnd = new Date(new Date(lock.expiresAt).getTime() + gracePeriod * 1000);
      return {
        locked: true,
        inGracePeriod: true,
        userId: lock.userId,
        username: lock.username,
        acquiredAt: lock.acquiredAt,
        expiresAt: lock.expiresAt,
        graceEndsAt: graceEnd.toISOString(),
        expiresIn: Math.floor((graceEnd - new Date()) / 1000),
      };
    }

    // Fully expired - clean up
    locks.delete(key);
    saveLocks();
    return { locked: false, wasExpired: true };
  }

  const expiresIn = Math.floor((new Date(lock.expiresAt) - new Date()) / 1000);

  return {
    locked: true,
    userId: lock.userId,
    username: lock.username,
    acquiredAt: lock.acquiredAt,
    expiresAt: lock.expiresAt,
    lastActivity: lock.lastActivity,
    expiresIn,
  };
}

/**
 * Refresh/extend a lock
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {string} userId - User ID (must match lock holder)
 * @returns {object|null} Updated lock or null if failed
 */
export function refreshLock(type, id, userId) {
  if (!enabled) {
    return { type, id, userId, disabled: true };
  }

  const key = lockKey(type, id);
  const existing = locks.get(key);

  if (!existing) {
    // No lock exists - acquire new one
    return acquireLock(type, id, userId);
  }

  // Only lock holder can refresh
  if (existing.userId !== userId) {
    return null;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + timeout * 1000);

  existing.expiresAt = expiresAt.toISOString();
  existing.lastActivity = now.toISOString();

  locks.set(key, existing);
  saveLocks();

  return existing;
}

/**
 * Force release a lock (admin only)
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @returns {object|null} Released lock info or null if no lock
 */
export function forceRelease(type, id) {
  const key = lockKey(type, id);
  const existing = locks.get(key);

  if (!existing) {
    return null;
  }

  locks.delete(key);
  saveLocks();

  return existing;
}

/**
 * List all active locks
 * @param {string} [type] - Optional type filter
 * @returns {Array} Array of lock objects with status
 */
export function listLocks(type = null) {
  // Clean up expired first
  cleanupExpired();

  const result = [];

  for (const [key, lock] of locks) {
    if (type && lock.type !== type) continue;

    const expiresIn = Math.floor((new Date(lock.expiresAt) - new Date()) / 1000);
    const inGrace = isInGracePeriod(lock);

    result.push({
      ...lock,
      expiresIn,
      inGracePeriod: inGrace,
    });
  }

  // Sort by expiration (soonest first)
  result.sort((a, b) => a.expiresIn - b.expiresIn);

  return result;
}

/**
 * Clean up all expired locks (past grace period)
 * @returns {number} Number of locks removed
 */
export function cleanupExpired() {
  let removed = 0;

  for (const [key, lock] of locks) {
    if (isExpired(lock) && !isInGracePeriod(lock)) {
      locks.delete(key);
      removed++;
    }
  }

  if (removed > 0) {
    saveLocks();
  }

  return removed;
}

/**
 * Check if content can be updated by user
 * Returns lock error info if locked by another user
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {string} userId - User attempting update
 * @returns {object|null} Error info or null if allowed
 */
export function checkUpdateAllowed(type, id, userId) {
  if (!enabled) return null;

  const status = checkLock(type, id);

  if (!status.locked) {
    return null; // No lock, allowed
  }

  if (status.userId === userId) {
    return null; // Same user, allowed
  }

  // Locked by another user
  return {
    error: 'locked',
    message: `Content is locked by ${status.username}`,
    lockedBy: status.username,
    lockedByUserId: status.userId,
    expiresIn: status.expiresIn,
    expiresAt: status.expiresAt,
    inGracePeriod: status.inGracePeriod || false,
  };
}

/**
 * Get lock statistics
 * @returns {object} Statistics
 */
export function getStats() {
  cleanupExpired();

  const byType = {};
  let soonestExpiry = null;

  for (const lock of locks.values()) {
    byType[lock.type] = (byType[lock.type] || 0) + 1;

    const expiresAt = new Date(lock.expiresAt);
    if (!soonestExpiry || expiresAt < soonestExpiry) {
      soonestExpiry = expiresAt;
    }
  }

  return {
    total: locks.size,
    byType,
    soonestExpiry: soonestExpiry ? soonestExpiry.toISOString() : null,
    enabled,
    timeout,
    gracePeriod,
  };
}

/**
 * Get configuration
 * @returns {object} Current configuration
 */
export function getConfig() {
  return {
    enabled,
    timeout,
    gracePeriod,
  };
}

/**
 * Format duration for display
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration
 */
export function formatDuration(seconds) {
  if (seconds < 60) {
    return `${seconds} second${seconds !== 1 ? 's' : ''}`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  if (remainingMins === 0) {
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  }
  return `${hours}h ${remainingMins}m`;
}
