/**
 * backup.js - Content Backup and Restore System
 *
 * WHY THIS EXISTS:
 * ================
 * Data loss prevention is critical for any CMS:
 * - Accidental deletions
 * - Failed updates/migrations
 * - System failures
 * - Security incidents
 *
 * BACKUP TYPES:
 * =============
 * - full: Complete snapshot of all content, config, and media
 * - incremental: Only changes since last backup (references parent)
 *
 * BACKUP CONTENTS:
 * ===============
 * - content.json: All content items (or delta for incremental)
 * - config/: Configuration files
 * - media/: Media files (or references)
 * - plugins/: Plugin configurations
 * - manifest.json: Backup metadata with checksums
 *
 * RETENTION POLICY:
 * ================
 * Configurable retention for daily, weekly, and monthly backups.
 * Old backups are automatically pruned.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, rmSync, copyFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { randomBytes } from 'node:crypto';

// ============================================
// STATE
// ============================================

/**
 * Configuration
 */
let config = {
  enabled: true,
  path: './backups',
  compress: false,
  schedule: '0 2 * * *',      // Daily at 2 AM
  incremental: null,           // Hourly incremental (optional)
  retention: {
    daily: 7,
    weekly: 4,
    monthly: 3
  }
};

/**
 * Base directory
 */
let baseDir = '';

/**
 * Content service reference
 */
let contentService = null;

/**
 * Scheduler service reference
 */
let schedulerService = null;

/**
 * Backup directory path
 */
let backupDir = '';

/**
 * Change tracking for incremental backups
 * Structure: { contentId: { action: 'create'|'update'|'delete', timestamp } }
 */
let changeLog = {};

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize backup system
 *
 * @param {Object} cfg - Configuration
 * @param {string} base - Base directory
 * @param {Object} content - Content service
 * @param {Object} scheduler - Scheduler service
 * @param {Object} hooks - Hooks service for change tracking
 */
export function init(cfg = {}, base = '', content = null, scheduler = null, hooks = null) {
  config = {
    ...config,
    ...cfg,
    retention: { ...config.retention, ...(cfg.retention || {}) }
  };

  baseDir = base;
  contentService = content;
  schedulerService = scheduler;

  // Resolve backup directory
  backupDir = config.path.startsWith('/')
    ? config.path
    : join(baseDir, config.path);

  // Ensure backup directory exists
  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true });
  }

  // Load change log for incremental backups
  loadChangeLog();

  // Register hooks for change tracking
  if (hooks && config.incremental) {
    hooks.on('content:afterCreate', (data) => trackChange(data.type, data.id, 'create'));
    hooks.on('content:afterUpdate', (data) => trackChange(data.type, data.id, 'update'));
    hooks.on('content:afterDelete', (data) => trackChange(data.type, data.id, 'delete'));
  }

  // Register scheduled backups
  if (scheduler && config.enabled) {
    if (config.schedule) {
      scheduler.schedule('backup:full', config.schedule, async () => {
        try {
          await createBackup({ type: 'full' });
          await pruneBackups();
        } catch (e) {
          console.error('[backup] Scheduled full backup failed:', e.message);
        }
      });
    }

    if (config.incremental) {
      scheduler.schedule('backup:incremental', config.incremental, async () => {
        try {
          await createBackup({ type: 'incremental' });
        } catch (e) {
          console.error('[backup] Scheduled incremental backup failed:', e.message);
        }
      });
    }
  }

  const backups = listBackups();
  console.log(`[backup] Initialized (${backups.length} backups, path: ${config.path})`);
}

/**
 * Load change log from disk
 */
function loadChangeLog() {
  const logFile = join(backupDir, '.changelog.json');
  if (existsSync(logFile)) {
    try {
      changeLog = JSON.parse(readFileSync(logFile, 'utf-8'));
    } catch (e) {
      changeLog = {};
    }
  }
}

/**
 * Save change log to disk
 */
function saveChangeLog() {
  const logFile = join(backupDir, '.changelog.json');
  try {
    writeFileSync(logFile, JSON.stringify(changeLog, null, 2));
  } catch (e) {
    console.error('[backup] Failed to save change log:', e.message);
  }
}

/**
 * Track a content change
 */
function trackChange(type, id, action) {
  const key = `${type}/${id}`;
  changeLog[key] = {
    action,
    timestamp: new Date().toISOString()
  };
  saveChangeLog();
}

/**
 * Clear change log (after successful incremental backup)
 */
function clearChangeLog() {
  changeLog = {};
  saveChangeLog();
}

// ============================================
// BACKUP CREATION
// ============================================

/**
 * Generate backup ID
 */
function generateBackupId() {
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `backup_${date}_${time}`;
}

/**
 * Calculate SHA256 checksum of data
 */
function checksum(data) {
  const hash = createHash('sha256');
  hash.update(typeof data === 'string' ? data : JSON.stringify(data));
  return 'sha256:' + hash.digest('hex');
}

/**
 * Calculate file checksum
 */
function fileChecksum(filePath) {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return 'sha256:' + hash.digest('hex');
}

/**
 * Get directory size recursively
 */
function getDirSize(dir) {
  let size = 0;
  if (!existsSync(dir)) return size;

  const items = readdirSync(dir);
  for (const item of items) {
    const itemPath = join(dir, item);
    const stat = statSync(itemPath);
    if (stat.isDirectory()) {
      size += getDirSize(itemPath);
    } else {
      size += stat.size;
    }
  }
  return size;
}

/**
 * Create a backup
 *
 * @param {Object} options - Backup options
 * @param {string} options.type - 'full' or 'incremental'
 * @param {boolean} options.compress - Compress backup (not implemented)
 * @returns {Promise<Object>} Backup metadata
 */
export async function createBackup(options = {}) {
  const {
    type = 'full',
    compress = config.compress
  } = options;

  if (!config.enabled) {
    throw new Error('Backup system is disabled');
  }

  const backupId = generateBackupId();
  const backupPath = join(backupDir, backupId);

  // For incremental, find parent backup
  let parentBackup = null;
  if (type === 'incremental') {
    const backups = listBackups();
    const fullBackups = backups.filter(b => b.type === 'full');
    if (fullBackups.length === 0) {
      throw new Error('No full backup found. Create a full backup first.');
    }
    parentBackup = fullBackups[0]; // Most recent full backup
  }

  // Create backup directory structure
  mkdirSync(backupPath, { recursive: true });
  mkdirSync(join(backupPath, 'config'), { recursive: true });
  mkdirSync(join(backupPath, 'media'), { recursive: true });
  mkdirSync(join(backupPath, 'plugins'), { recursive: true });

  const manifest = {
    id: backupId,
    type,
    created: new Date().toISOString(),
    size: 0,
    itemCount: 0,
    checksum: null,
    parent: parentBackup ? parentBackup.id : null,
    manifest: {
      content: {},
      config: [],
      media: 0,
      plugins: 0
    },
    files: []
  };

  // Backup content
  const contentData = await backupContent(backupPath, type, parentBackup);
  manifest.manifest.content = contentData.counts;
  manifest.itemCount = contentData.total;
  manifest.files.push({
    path: 'content.json',
    checksum: contentData.checksum,
    size: contentData.size
  });

  // Backup config files
  const configData = backupConfig(backupPath);
  manifest.manifest.config = configData.files;
  for (const file of configData.checksums) {
    manifest.files.push(file);
  }

  // Backup media files
  const mediaData = backupMedia(backupPath, type, parentBackup);
  manifest.manifest.media = mediaData.count;
  for (const file of mediaData.checksums) {
    manifest.files.push(file);
  }

  // Backup plugin configs
  const pluginData = backupPlugins(backupPath);
  manifest.manifest.plugins = pluginData.count;
  for (const file of pluginData.checksums) {
    manifest.files.push(file);
  }

  // Calculate total size and overall checksum
  manifest.size = getDirSize(backupPath);
  manifest.checksum = checksum(manifest.files);

  // Write manifest
  writeFileSync(
    join(backupPath, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  // Clear change log after successful incremental backup
  if (type === 'incremental') {
    clearChangeLog();
  }

  return manifest;
}

/**
 * Backup content items
 */
async function backupContent(backupPath, type, parentBackup) {
  const counts = {};
  const items = [];
  let total = 0;

  if (!contentService) {
    const data = JSON.stringify({ items: [], changes: [] });
    writeFileSync(join(backupPath, 'content.json'), data);
    return { counts: {}, total: 0, checksum: checksum(data), size: data.length };
  }

  // Get all content types
  const types = contentService.listTypes();

  for (const typeInfo of types) {
    const typeName = typeInfo.type;
    const typeItems = contentService.listAll(typeName);

    counts[typeName] = typeItems.length;

    for (const item of typeItems) {
      // For incremental, only include changed items
      if (type === 'incremental') {
        const key = `${typeName}/${item.id}`;
        if (!changeLog[key]) continue;
      }

      items.push({
        type: typeName,
        id: item.id,
        data: item
      });
      total++;
    }
  }

  // For incremental, also track deleted items
  const changes = [];
  if (type === 'incremental') {
    for (const [key, change] of Object.entries(changeLog)) {
      if (change.action === 'delete') {
        const [contentType, id] = key.split('/');
        changes.push({ type: contentType, id, action: 'delete' });
      }
    }
  }

  const contentData = { items, changes };
  const data = JSON.stringify(contentData, null, 2);
  writeFileSync(join(backupPath, 'content.json'), data);

  return {
    counts,
    total: type === 'full' ? total : items.length,
    checksum: checksum(data),
    size: data.length
  };
}

/**
 * Backup config files
 */
function backupConfig(backupPath) {
  const configDir = join(baseDir, 'config');
  const files = [];
  const checksums = [];

  if (!existsSync(configDir)) {
    return { files, checksums };
  }

  const configFiles = readdirSync(configDir).filter(f => f.endsWith('.json'));

  for (const file of configFiles) {
    const srcPath = join(configDir, file);
    const destPath = join(backupPath, 'config', file);

    copyFileSync(srcPath, destPath);
    files.push(file);

    checksums.push({
      path: `config/${file}`,
      checksum: fileChecksum(srcPath),
      size: statSync(srcPath).size
    });
  }

  return { files, checksums };
}

/**
 * Backup media files
 */
function backupMedia(backupPath, type, parentBackup) {
  const mediaDir = join(baseDir, 'media');
  const checksums = [];
  let count = 0;

  if (!existsSync(mediaDir)) {
    return { count: 0, checksums: [] };
  }

  // For incremental, we store references instead of copying
  if (type === 'incremental' && parentBackup) {
    // Just create a references file
    const refs = { parent: parentBackup.id, inherited: true };
    writeFileSync(join(backupPath, 'media', '_refs.json'), JSON.stringify(refs));
    return { count: 0, checksums: [] };
  }

  // Full backup: copy all media files
  const copyMediaDir = (src, dest, prefix = '') => {
    if (!existsSync(src)) return;

    const items = readdirSync(src);
    for (const item of items) {
      const srcPath = join(src, item);
      const destPath = join(dest, item);
      const stat = statSync(srcPath);

      if (stat.isDirectory()) {
        mkdirSync(destPath, { recursive: true });
        copyMediaDir(srcPath, destPath, prefix ? `${prefix}/${item}` : item);
      } else {
        copyFileSync(srcPath, destPath);
        count++;
        checksums.push({
          path: `media/${prefix ? prefix + '/' : ''}${item}`,
          checksum: fileChecksum(srcPath),
          size: stat.size
        });
      }
    }
  };

  copyMediaDir(mediaDir, join(backupPath, 'media'));

  return { count, checksums };
}

/**
 * Backup plugin configs
 */
function backupPlugins(backupPath) {
  const pluginsDir = join(baseDir, 'plugins');
  const checksums = [];
  let count = 0;

  if (!existsSync(pluginsDir)) {
    return { count: 0, checksums: [] };
  }

  const plugins = readdirSync(pluginsDir);

  for (const plugin of plugins) {
    const pluginDir = join(pluginsDir, plugin);
    if (!statSync(pluginDir).isDirectory()) continue;

    const configFile = join(pluginDir, 'config.json');
    if (existsSync(configFile)) {
      const destPath = join(backupPath, 'plugins', `${plugin}.config.json`);
      copyFileSync(configFile, destPath);
      count++;

      checksums.push({
        path: `plugins/${plugin}.config.json`,
        checksum: fileChecksum(configFile),
        size: statSync(configFile).size
      });
    }
  }

  return { count, checksums };
}

// ============================================
// BACKUP LISTING & RETRIEVAL
// ============================================

/**
 * List all backups
 *
 * @returns {Object[]} Array of backup metadata
 */
export function listBackups() {
  if (!existsSync(backupDir)) {
    return [];
  }

  const backups = [];
  const dirs = readdirSync(backupDir).filter(d => d.startsWith('backup_'));

  for (const dir of dirs) {
    const manifestPath = join(backupDir, dir, 'manifest.json');
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        backups.push(manifest);
      } catch (e) {
        // Skip invalid backups
      }
    }
  }

  // Sort by created date, newest first
  backups.sort((a, b) => new Date(b.created) - new Date(a.created));

  return backups;
}

/**
 * Get backup metadata
 *
 * @param {string} backupId - Backup ID
 * @returns {Object|null} Backup metadata or null
 */
export function getBackup(backupId) {
  const manifestPath = join(backupDir, backupId, 'manifest.json');
  if (!existsSync(manifestPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch (e) {
    return null;
  }
}

/**
 * Delete a backup
 *
 * @param {string} backupId - Backup ID
 * @returns {boolean} Success
 */
export function deleteBackup(backupId) {
  const backupPath = join(backupDir, backupId);
  if (!existsSync(backupPath)) {
    return false;
  }

  // Check if other backups depend on this one
  const backups = listBackups();
  const dependents = backups.filter(b => b.parent === backupId);
  if (dependents.length > 0) {
    throw new Error(`Cannot delete: ${dependents.length} backup(s) depend on this backup`);
  }

  rmSync(backupPath, { recursive: true, force: true });
  return true;
}

// ============================================
// BACKUP VERIFICATION
// ============================================

/**
 * Verify backup integrity
 *
 * @param {string} backupId - Backup ID
 * @returns {Object} Verification result
 */
export function verifyBackup(backupId) {
  const backup = getBackup(backupId);
  if (!backup) {
    return { valid: false, error: 'Backup not found' };
  }

  const backupPath = join(backupDir, backupId);
  const results = {
    valid: true,
    manifest: { valid: true },
    content: { valid: true, count: 0 },
    config: { valid: true, count: 0 },
    media: { valid: true, count: 0 },
    errors: []
  };

  // Verify manifest checksum
  const calculatedChecksum = checksum(backup.files);
  if (calculatedChecksum !== backup.checksum) {
    results.valid = false;
    results.manifest.valid = false;
    results.errors.push('Manifest checksum mismatch');
  }

  // Verify each file
  for (const file of backup.files) {
    const filePath = join(backupPath, file.path);

    if (!existsSync(filePath)) {
      results.valid = false;
      results.errors.push(`Missing file: ${file.path}`);
      continue;
    }

    const actualChecksum = fileChecksum(filePath);
    if (actualChecksum !== file.checksum) {
      results.valid = false;
      results.errors.push(`Checksum mismatch: ${file.path}`);
    }

    // Count by type
    if (file.path === 'content.json') {
      const content = JSON.parse(readFileSync(filePath, 'utf-8'));
      results.content.count = content.items.length;
    } else if (file.path.startsWith('config/')) {
      results.config.count++;
    } else if (file.path.startsWith('media/')) {
      results.media.count++;
    }
  }

  return results;
}

// ============================================
// BACKUP RESTORATION
// ============================================

/**
 * Restore from backup
 *
 * @param {string} backupId - Backup ID
 * @param {Object} options - Restore options
 * @param {boolean} options.dryRun - Don't make changes
 * @param {boolean} options.contentOnly - Only restore content
 * @returns {Promise<Object>} Restore result
 */
export async function restoreBackup(backupId, options = {}) {
  const {
    dryRun = false,
    contentOnly = false
  } = options;

  const backup = getBackup(backupId);
  if (!backup) {
    throw new Error('Backup not found');
  }

  const backupPath = join(backupDir, backupId);
  const result = {
    dryRun,
    content: { total: 0, unchanged: 0, updated: 0, created: 0, deleted: 0 },
    config: { total: 0, changed: 0 },
    media: { total: 0, unchanged: 0, created: 0 }
  };

  // For incremental backups, we need to restore from the full backup first
  if (backup.type === 'incremental' && backup.parent) {
    const parentResult = await restoreBackup(backup.parent, { ...options, contentOnly: true });
    result.content = parentResult.content;
  }

  // Restore content
  const contentFile = join(backupPath, 'content.json');
  if (existsSync(contentFile) && contentService) {
    const contentData = JSON.parse(readFileSync(contentFile, 'utf-8'));

    for (const item of contentData.items) {
      const existing = contentService.read(item.type, item.id);

      if (!existing) {
        result.content.created++;
        if (!dryRun) {
          // Create new item
          contentService.create(item.type, item.data, { id: item.id });
        }
      } else if (JSON.stringify(existing) !== JSON.stringify(item.data)) {
        result.content.updated++;
        if (!dryRun) {
          // Update existing item
          contentService.update(item.type, item.id, item.data);
        }
      } else {
        result.content.unchanged++;
      }
      result.content.total++;
    }

    // Handle deletions (for incremental)
    for (const change of (contentData.changes || [])) {
      if (change.action === 'delete') {
        result.content.deleted++;
        if (!dryRun) {
          contentService.delete(change.type, change.id);
        }
      }
    }
  }

  if (contentOnly) {
    return result;
  }

  // Restore config files
  const configBackupDir = join(backupPath, 'config');
  if (existsSync(configBackupDir)) {
    const configDir = join(baseDir, 'config');
    const files = readdirSync(configBackupDir);

    for (const file of files) {
      const srcPath = join(configBackupDir, file);
      const destPath = join(configDir, file);

      const srcContent = readFileSync(srcPath, 'utf-8');
      const destContent = existsSync(destPath) ? readFileSync(destPath, 'utf-8') : null;

      if (srcContent !== destContent) {
        result.config.changed++;
        if (!dryRun) {
          copyFileSync(srcPath, destPath);
        }
      }
      result.config.total++;
    }
  }

  // Restore media files (full backups only)
  const mediaBackupDir = join(backupPath, 'media');
  const refsFile = join(mediaBackupDir, '_refs.json');

  if (existsSync(mediaBackupDir) && !existsSync(refsFile)) {
    const mediaDir = join(baseDir, 'media');

    const restoreMediaDir = (src, dest) => {
      if (!existsSync(src)) return;

      const items = readdirSync(src);
      for (const item of items) {
        const srcPath = join(src, item);
        const destPath = join(dest, item);
        const stat = statSync(srcPath);

        if (stat.isDirectory()) {
          if (!dryRun && !existsSync(destPath)) {
            mkdirSync(destPath, { recursive: true });
          }
          restoreMediaDir(srcPath, destPath);
        } else {
          if (!existsSync(destPath)) {
            result.media.created++;
            if (!dryRun) {
              mkdirSync(dest, { recursive: true });
              copyFileSync(srcPath, destPath);
            }
          } else {
            result.media.unchanged++;
          }
          result.media.total++;
        }
      }
    };

    restoreMediaDir(mediaBackupDir, mediaDir);
  }

  return result;
}

// ============================================
// RETENTION & PRUNING
// ============================================

/**
 * Prune old backups according to retention policy
 *
 * @param {Object} options - Prune options
 * @param {boolean} options.dryRun - Don't delete, just report
 * @param {number} options.keepDaily - Override daily retention
 * @param {number} options.keepWeekly - Override weekly retention
 * @param {number} options.keepMonthly - Override monthly retention
 * @returns {Object} Prune result
 */
export function pruneBackups(options = {}) {
  const {
    dryRun = false,
    keepDaily = config.retention.daily,
    keepWeekly = config.retention.weekly,
    keepMonthly = config.retention.monthly
  } = options;

  const backups = listBackups().filter(b => b.type === 'full');
  const now = new Date();
  const result = {
    dryRun,
    kept: [],
    deleted: []
  };

  // Categorize backups by age
  const daily = [];
  const weekly = [];
  const monthly = [];

  for (const backup of backups) {
    const created = new Date(backup.created);
    const ageInDays = (now - created) / (1000 * 60 * 60 * 24);

    if (ageInDays < 7) {
      daily.push(backup);
    } else if (ageInDays < 30) {
      weekly.push(backup);
    } else {
      monthly.push(backup);
    }
  }

  // Keep the specified number from each category
  const toKeep = new Set();

  // Keep most recent daily backups
  for (let i = 0; i < Math.min(keepDaily, daily.length); i++) {
    toKeep.add(daily[i].id);
  }

  // Keep one per week from weekly
  const weeklyKept = [];
  for (const backup of weekly) {
    const created = new Date(backup.created);
    const weekNum = Math.floor((now - created) / (1000 * 60 * 60 * 24 * 7));

    if (!weeklyKept.includes(weekNum) && weeklyKept.length < keepWeekly) {
      toKeep.add(backup.id);
      weeklyKept.push(weekNum);
    }
  }

  // Keep one per month from monthly
  const monthlyKept = [];
  for (const backup of monthly) {
    const created = new Date(backup.created);
    const monthKey = `${created.getFullYear()}-${created.getMonth()}`;

    if (!monthlyKept.includes(monthKey) && monthlyKept.length < keepMonthly) {
      toKeep.add(backup.id);
      monthlyKept.push(monthKey);
    }
  }

  // Also keep any backups that are parents of incremental backups
  const incrementals = listBackups().filter(b => b.type === 'incremental');
  for (const incr of incrementals) {
    if (incr.parent) {
      toKeep.add(incr.parent);
    }
  }

  // Delete backups not in keep set
  for (const backup of backups) {
    if (toKeep.has(backup.id)) {
      result.kept.push(backup.id);
    } else {
      result.deleted.push(backup.id);
      if (!dryRun) {
        try {
          deleteBackup(backup.id);
        } catch (e) {
          // Skip if can't delete (has dependents)
        }
      }
    }
  }

  return result;
}

// ============================================
// STATISTICS
// ============================================

/**
 * Get backup statistics
 *
 * @returns {Object} Statistics
 */
export function getStats() {
  const backups = listBackups();
  const fullBackups = backups.filter(b => b.type === 'full');
  const incrBackups = backups.filter(b => b.type === 'incremental');

  let totalSize = 0;
  for (const backup of backups) {
    totalSize += backup.size || 0;
  }

  let nextScheduled = null;
  if (schedulerService) {
    const task = schedulerService.get('backup:full');
    if (task) {
      nextScheduled = task.nextRun;
    }
  }

  return {
    total: backups.length,
    full: fullBackups.length,
    incremental: incrBackups.length,
    totalSize,
    oldestBackup: backups.length > 0 ? backups[backups.length - 1].created : null,
    newestBackup: backups.length > 0 ? backups[0].created : null,
    nextScheduled,
    retention: config.retention
  };
}

/**
 * Format bytes to human readable
 */
export function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format relative time
 */
export function formatRelativeTime(date) {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  if (diffDays < 30) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;

  return then.toLocaleDateString();
}
