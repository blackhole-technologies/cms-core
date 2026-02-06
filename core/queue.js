/**
 * queue.js - Background Job Queue System
 *
 * WHY THIS EXISTS:
 * Long-running operations (bulk updates, exports, imports) should not block
 * the HTTP request/response cycle. This queue system provides:
 * - Async job processing with progress tracking
 * - Priority-based execution
 * - Retry logic for failed jobs
 * - Persistence for recovery after restart
 *
 * JOB LIFECYCLE:
 * pending → running → completed/failed
 *          ↓         ↓
 *          └─ retry ─┘
 *
 * STORAGE:
 * Jobs are stored in /content/.queue/jobs.json for persistence.
 * Completed jobs are archived after configurable period.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as hooks from './hooks.js';

// Configuration
let enabled = true;
let concurrency = 5;
let retryDelay = 60;     // seconds
let maxRetries = 3;
let archiveAfter = 7;    // days
let contentDir = './content';

// Queue storage
let queueDir = null;
let jobsFile = null;

// In-memory job storage
// Map<jobId, job>
const jobs = new Map();

// Job handlers by type
// Map<type, handler(job, context) => Promise<result>>
const handlers = new Map();

// Currently running jobs
const runningJobs = new Set();

// Processing state
let isProcessing = false;
let processingInterval = null;

// Context for job handlers
let handlerContext = null;

/**
 * Generate unique job ID
 */
function generateJobId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `job_${timestamp}_${random}`;
}

/**
 * Initialize the queue system
 * @param {object} config - Configuration object
 */
export function init(config = {}) {
  if (config.enabled !== undefined) enabled = config.enabled;
  if (config.concurrency !== undefined) concurrency = config.concurrency;
  if (config.retryDelay !== undefined) retryDelay = config.retryDelay;
  if (config.maxRetries !== undefined) maxRetries = config.maxRetries;
  if (config.archiveAfter !== undefined) archiveAfter = config.archiveAfter;
  if (config.contentDir !== undefined) contentDir = config.contentDir;
  if (config.context !== undefined) handlerContext = config.context;

  // Set up persistence directory
  queueDir = path.join(contentDir, '.queue');
  jobsFile = path.join(queueDir, 'jobs.json');

  // Create queue directory if needed
  if (!fs.existsSync(queueDir)) {
    fs.mkdirSync(queueDir, { recursive: true });
  }

  // Load persisted jobs
  loadJobs();

  // Clean up stale running jobs (from crash/restart)
  for (const [id, job] of jobs) {
    if (job.status === 'running') {
      // Mark as failed for retry
      job.status = 'failed';
      job.error = 'Job interrupted by system restart';
      job.completedAt = new Date().toISOString();
    }
  }
  saveJobs();

  // Archive old completed jobs
  archiveOldJobs();

  console.log(`[queue] Initialized (concurrency: ${concurrency}, retries: ${maxRetries})`);
}

/**
 * Load jobs from persistence file
 */
function loadJobs() {
  if (!jobsFile || !fs.existsSync(jobsFile)) {
    return;
  }

  try {
    const data = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
    jobs.clear();

    for (const job of data) {
      jobs.set(job.id, job);
    }
  } catch (error) {
    console.error('[queue] Failed to load jobs:', error.message);
  }
}

/**
 * Save jobs to persistence file
 */
function saveJobs() {
  if (!jobsFile) return;

  try {
    const data = Array.from(jobs.values());
    fs.writeFileSync(jobsFile, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('[queue] Failed to save jobs:', error.message);
  }
}

/**
 * Archive and remove old completed jobs
 */
function archiveOldJobs() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - archiveAfter);

  let archived = 0;

  for (const [id, job] of jobs) {
    if (job.status === 'completed' || job.status === 'failed') {
      const completedAt = new Date(job.completedAt);
      if (completedAt < cutoff) {
        // Archive to separate file
        archiveJob(job);
        jobs.delete(id);
        archived++;
      }
    }
  }

  if (archived > 0) {
    saveJobs();
    console.log(`[queue] Archived ${archived} old jobs`);
  }
}

/**
 * Archive a single job to archive file
 */
function archiveJob(job) {
  if (!queueDir) return;

  const archiveFile = path.join(queueDir, 'archive.json');
  let archive = [];

  if (fs.existsSync(archiveFile)) {
    try {
      archive = JSON.parse(fs.readFileSync(archiveFile, 'utf8'));
    } catch {
      archive = [];
    }
  }

  archive.push(job);
  fs.writeFileSync(archiveFile, JSON.stringify(archive, null, 2));
}

/**
 * Register a job handler
 * @param {string} type - Job type (e.g., 'bulk:publish')
 * @param {Function} handler - Async function(job, updateProgress, context)
 */
export function registerHandler(type, handler) {
  handlers.set(type, handler);
}

/**
 * Add a job to the queue
 * @param {string} type - Job type
 * @param {object} data - Job data
 * @param {object} options - Job options
 * @returns {object} - Created job
 */
export function addJob(type, data, options = {}) {
  if (!enabled) {
    throw new Error('Queue system is disabled');
  }

  const now = new Date().toISOString();

  const job = {
    id: generateJobId(),
    type,
    status: 'pending',
    priority: options.priority || 5,  // 1 = highest, 10 = lowest
    data,
    progress: {
      total: data.ids?.length || data.total || 0,
      completed: 0,
      failed: 0,
    },
    result: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    error: null,
    retries: 0,
    maxRetries: options.maxRetries ?? maxRetries,
    createdBy: options.userId || 'system',
  };

  jobs.set(job.id, job);
  saveJobs();

  // Trigger hook
  hooks.trigger('queue:jobAdded', { job });

  return job;
}

/**
 * Get a job by ID
 * @param {string} id - Job ID
 * @returns {object|null} - Job or null
 */
export function getJob(id) {
  return jobs.get(id) || null;
}

/**
 * List jobs by status
 * @param {string} status - Filter by status (optional)
 * @returns {Array} - Array of jobs
 */
export function listJobs(status = null) {
  const result = [];

  for (const job of jobs.values()) {
    if (!status || job.status === status) {
      result.push(job);
    }
  }

  // Sort by priority (ascending) then by createdAt
  result.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return new Date(a.createdAt) - new Date(b.createdAt);
  });

  return result;
}

/**
 * Cancel a pending job
 * @param {string} id - Job ID
 * @returns {boolean} - True if cancelled
 */
export function cancelJob(id) {
  const job = jobs.get(id);

  if (!job) {
    return false;
  }

  if (job.status !== 'pending') {
    return false; // Can only cancel pending jobs
  }

  job.status = 'cancelled';
  job.completedAt = new Date().toISOString();
  saveJobs();

  hooks.trigger('queue:jobCancelled', { job });

  return true;
}

/**
 * Retry a failed job
 * @param {string} id - Job ID
 * @returns {object|null} - Updated job or null
 */
export function retryJob(id) {
  const job = jobs.get(id);

  if (!job) {
    return null;
  }

  if (job.status !== 'failed') {
    return null; // Can only retry failed jobs
  }

  // Reset job for retry
  job.status = 'pending';
  job.error = null;
  job.completedAt = null;
  job.progress.completed = 0;
  job.progress.failed = 0;
  job.retries++;

  saveJobs();

  hooks.trigger('queue:jobRetried', { job });

  return job;
}

/**
 * Clear jobs by status
 * @param {string} status - Status to clear (default: 'completed')
 * @returns {number} - Number of jobs cleared
 */
export function clearJobs(status = 'completed') {
  let cleared = 0;

  for (const [id, job] of jobs) {
    if (job.status === status) {
      jobs.delete(id);
      cleared++;
    }
  }

  if (cleared > 0) {
    saveJobs();
  }

  return cleared;
}

/**
 * Update job progress
 * @param {string} id - Job ID
 * @param {object} progress - Progress update
 */
export function updateProgress(id, progress) {
  const job = jobs.get(id);

  if (!job) return;

  job.progress = { ...job.progress, ...progress };
  saveJobs();

  hooks.trigger('queue:jobProgress', { job });
}

/**
 * Process pending jobs
 * @param {number} limit - Max jobs to process (optional)
 * @returns {Promise<Array>} - Processed jobs
 */
export async function processQueue(limit = null) {
  if (!enabled) {
    return [];
  }

  // Get pending jobs sorted by priority
  const pending = listJobs('pending');
  const toProcess = limit ? pending.slice(0, limit) : pending;

  const results = [];

  for (const job of toProcess) {
    // Check concurrency limit
    if (runningJobs.size >= concurrency) {
      break;
    }

    try {
      const result = await processJob(job);
      results.push(result);
    } catch (error) {
      console.error(`[queue] Job ${job.id} failed:`, error.message);
    }
  }

  return results;
}

/**
 * Process a single job
 * @param {object} job - Job to process
 * @returns {Promise<object>} - Job result
 */
async function processJob(job) {
  const handler = handlers.get(job.type);

  if (!handler) {
    job.status = 'failed';
    job.error = `No handler registered for job type: ${job.type}`;
    job.completedAt = new Date().toISOString();
    saveJobs();
    return job;
  }

  // Mark as running
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  runningJobs.add(job.id);
  saveJobs();

  hooks.trigger('queue:jobStarted', { job });

  try {
    // Create progress updater for handler
    const progressUpdater = (progress) => {
      updateProgress(job.id, progress);
    };

    // Execute handler
    const result = await handler(job, progressUpdater, handlerContext);

    // Mark as completed
    job.status = 'completed';
    job.result = result;
    job.completedAt = new Date().toISOString();

    hooks.trigger('queue:jobCompleted', { job });

  } catch (error) {
    // Mark as failed
    job.status = 'failed';
    job.error = error.message;
    job.completedAt = new Date().toISOString();

    // Schedule retry if within limit
    if (job.retries < job.maxRetries) {
      setTimeout(() => {
        retryJob(job.id);
      }, retryDelay * 1000);
    }

    hooks.trigger('queue:jobFailed', { job, error });
  }

  runningJobs.delete(job.id);
  saveJobs();

  return job;
}

/**
 * Start automatic queue processing
 * @param {number} interval - Processing interval in seconds
 */
export function startProcessing(interval = 10) {
  if (isProcessing) return;

  isProcessing = true;
  processingInterval = setInterval(() => {
    processQueue().catch(err => {
      console.error('[queue] Processing error:', err.message);
    });
  }, interval * 1000);

  console.log(`[queue] Auto-processing started (interval: ${interval}s)`);
}

/**
 * Stop automatic queue processing
 */
export function stopProcessing() {
  if (!isProcessing) return;

  isProcessing = false;
  if (processingInterval) {
    clearInterval(processingInterval);
    processingInterval = null;
  }

  console.log('[queue] Auto-processing stopped');
}

/**
 * Get queue statistics
 * @returns {object} - Statistics
 */
export function getStats() {
  const stats = {
    total: jobs.size,
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    byType: {},
    avgDuration: 0,
  };

  let totalDuration = 0;
  let completedCount = 0;

  for (const job of jobs.values()) {
    // Count by status
    stats[job.status] = (stats[job.status] || 0) + 1;

    // Count by type
    stats.byType[job.type] = (stats.byType[job.type] || 0) + 1;

    // Calculate average duration for completed jobs
    if (job.status === 'completed' && job.startedAt && job.completedAt) {
      const duration = new Date(job.completedAt) - new Date(job.startedAt);
      totalDuration += duration;
      completedCount++;
    }
  }

  if (completedCount > 0) {
    stats.avgDuration = Math.round(totalDuration / completedCount);
  }

  stats.enabled = enabled;
  stats.concurrency = concurrency;
  stats.runningCount = runningJobs.size;
  stats.isProcessing = isProcessing;

  return stats;
}

/**
 * Get configuration
 * @returns {object} - Current configuration
 */
export function getConfig() {
  return {
    enabled,
    concurrency,
    retryDelay,
    maxRetries,
    archiveAfter,
  };
}

/**
 * Format duration for display
 * @param {number} ms - Duration in milliseconds
 * @returns {string} - Formatted duration
 */
export function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSecs = seconds % 60;
  if (minutes < 60) {
    return remainingSecs ? `${minutes}m ${remainingSecs}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return remainingMins ? `${hours}h ${remainingMins}m` : `${hours}h`;
}

/**
 * Format relative time (e.g., "2 minutes ago")
 * @param {string} isoString - ISO timestamp
 * @returns {string} - Formatted relative time
 */
export function formatRelativeTime(isoString) {
  if (!isoString) return '';

  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffSecs = Math.floor(diffMs / 1000);

  if (diffSecs < 60) {
    return 'just now';
  }

  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) {
    return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
  }

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) {
    return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
}

// ============================================================
// BUILT-IN JOB HANDLERS
// ============================================================

/**
 * Register built-in job handlers
 * Called during boot to set up standard bulk operations
 */
export function registerBuiltinHandlers(context) {
  handlerContext = context;
  const content = context.services.get('content');

  // bulk:publish - Publish multiple items
  registerHandler('bulk:publish', async (job, updateProgress, ctx) => {
    const { contentType, ids } = job.data;
    const results = { success: 0, failed: 0, errors: [] };

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      try {
        await content.update(contentType, id, { status: 'published' });
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({ id, error: error.message });
      }

      updateProgress({
        completed: results.success + results.failed,
        failed: results.failed,
      });
    }

    return results;
  });

  // bulk:unpublish - Unpublish multiple items
  registerHandler('bulk:unpublish', async (job, updateProgress, ctx) => {
    const { contentType, ids } = job.data;
    const results = { success: 0, failed: 0, errors: [] };

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      try {
        await content.update(contentType, id, { status: 'draft' });
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({ id, error: error.message });
      }

      updateProgress({
        completed: results.success + results.failed,
        failed: results.failed,
      });
    }

    return results;
  });

  // bulk:archive - Archive multiple items
  registerHandler('bulk:archive', async (job, updateProgress, ctx) => {
    const { contentType, ids } = job.data;
    const results = { success: 0, failed: 0, errors: [] };

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      try {
        await content.update(contentType, id, { status: 'archived' });
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({ id, error: error.message });
      }

      updateProgress({
        completed: results.success + results.failed,
        failed: results.failed,
      });
    }

    return results;
  });

  // bulk:delete - Delete multiple items
  registerHandler('bulk:delete', async (job, updateProgress, ctx) => {
    const { contentType, ids, permanent } = job.data;
    const results = { success: 0, failed: 0, errors: [] };

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      try {
        if (permanent) {
          await content.remove(contentType, id);
        } else {
          await content.trash(contentType, id);
        }
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({ id, error: error.message });
      }

      updateProgress({
        completed: results.success + results.failed,
        failed: results.failed,
      });
    }

    return results;
  });

  // bulk:update - Update multiple items with same data
  registerHandler('bulk:update', async (job, updateProgress, ctx) => {
    const { contentType, ids, data } = job.data;
    const results = { success: 0, failed: 0, errors: [] };

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      try {
        await content.update(contentType, id, data);
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({ id, error: error.message });
      }

      updateProgress({
        completed: results.success + results.failed,
        failed: results.failed,
      });
    }

    return results;
  });

  // bulk:export - Export content (large exports)
  registerHandler('bulk:export', async (job, updateProgress, ctx) => {
    const transfer = ctx.services.get('transfer');
    const { types, options } = job.data;

    // Export content
    const exportData = transfer.exportContent(types, options);

    // Write to file
    const filename = `export_${Date.now()}.json`;
    const exportPath = path.join(queueDir, filename);
    fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2));

    updateProgress({ completed: 1, total: 1 });

    return {
      success: true,
      filename,
      path: exportPath,
      itemCount: Object.values(exportData.content).reduce((sum, items) => sum + items.length, 0),
    };
  });

  // bulk:import - Import content (large imports)
  registerHandler('bulk:import', async (job, updateProgress, ctx) => {
    const transfer = ctx.services.get('transfer');
    const { filePath, options } = job.data;

    // Read import file
    const importData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    // Count items
    const totalItems = Object.values(importData.content || {}).reduce(
      (sum, items) => sum + items.length, 0
    );

    updateProgress({ total: totalItems, completed: 0 });

    // Import content
    const result = await transfer.importContent(importData, {
      ...options,
      onProgress: (completed) => {
        updateProgress({ completed });
      },
    });

    return result;
  });

  console.log('[queue] Built-in handlers registered');
}
