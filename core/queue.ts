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
 * pending -> running -> completed/failed
 *          |         |
 *          +- retry -+
 *
 * STORAGE:
 * Jobs are stored in /content/.queue/jobs.json for persistence.
 * Completed jobs are archived after configurable period.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as hooks from './hooks.ts';

// ============================================================================
// Types
// ============================================================================

/** Database pool interface for PostgreSQL */
interface PgPool {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  simpleQuery: (text: string) => Promise<{ rows: Record<string, unknown>[] }>;
}

/** Job status values */
type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Job progress tracking */
interface JobProgress {
  total: number;
  completed: number;
  failed: number;
}

/** Job data structure */
interface Job {
  id: string;
  type: string;
  status: JobStatus;
  priority: number;
  data: Record<string, unknown>;
  progress: JobProgress;
  result: unknown;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  retries: number;
  maxRetries: number;
  createdBy: string;
}

/** Job options when adding to queue */
interface JobOptions {
  priority?: number;
  maxRetries?: number;
  userId?: string;
}

/** Queue configuration */
interface QueueConfig {
  enabled?: boolean;
  concurrency?: number;
  retryDelay?: number;
  maxRetries?: number;
  archiveAfter?: number;
  contentDir?: string;
  context?: HandlerContext | null;
}

/** Queue statistics */
interface QueueStats {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  byType: Record<string, number>;
  avgDuration: number;
  enabled: boolean;
  concurrency: number;
  runningCount: number;
  isProcessing: boolean;
  [key: string]: unknown;
}

/** Progress updater function passed to job handlers */
type ProgressUpdater = (progress: Partial<JobProgress>) => void;

/** Job handler function */
type JobHandler = (job: Job, updateProgress: ProgressUpdater, context: HandlerContext | null) => Promise<unknown>;

/** Handler context with services */
interface HandlerContext {
  services: {
    get: (name: string) => unknown;
  };
  [key: string]: unknown;
}

/** Content service interface */
interface ContentService {
  update: (type: string, id: string, data: Record<string, unknown>) => Promise<void>;
  remove: (type: string, id: string) => Promise<void>;
  trash: (type: string, id: string) => Promise<void>;
}

/** Transfer service interface */
interface TransferService {
  exportContent: (types: string[], options: Record<string, unknown>) => { content: Record<string, unknown[]> };
  importContent: (data: unknown, options: Record<string, unknown>) => Promise<unknown>;
}

// ============================================================================
// State
// ============================================================================

// Configuration
let enabled: boolean = true;
let concurrency: number = 5;
let retryDelay: number = 60;     // seconds
let maxRetries: number = 3;
let archiveAfter: number = 7;    // days
let contentDir: string = './content';

// Queue storage
let queueDir: string | null = null;
let jobsFile: string | null = null;

/**
 * Database pool for PostgreSQL job persistence.
 * When non-null, jobs are stored in `queue_jobs` table instead of jobs.json.
 */
let dbPool: PgPool | null = null;

// In-memory job storage
const jobs: Map<string, Job> = new Map();

// Job handlers by type
const handlers: Map<string, JobHandler> = new Map();

// Currently running jobs
const runningJobs: Set<string> = new Set();

// Processing state
let isProcessing: boolean = false;
let processingInterval: ReturnType<typeof setInterval> | null = null;

// Context for job handlers
let handlerContext: HandlerContext | null = null;

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Generate unique job ID
 */
function generateJobId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `job_${timestamp}_${random}`;
}

/**
 * Load jobs from persistence file
 */
function loadJobs(): void {
  if (!jobsFile || !fs.existsSync(jobsFile)) {
    return;
  }

  try {
    const data = JSON.parse(fs.readFileSync(jobsFile, 'utf8')) as Job[];
    jobs.clear();

    for (const job of data) {
      jobs.set(job.id, job);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[queue] Failed to load jobs:', message);
  }
}

/**
 * Load jobs from PostgreSQL.
 */
async function loadJobsFromDb(): Promise<void> {
  if (!dbPool) return;

  try {
    const result = await dbPool.simpleQuery(
      `SELECT id, type, status, priority, data, progress_total, progress_completed,
              progress_failed, result, created_at, started_at, completed_at,
              error, retries, max_retries, created_by
       FROM queue_jobs
       WHERE status IN ('pending', 'running', 'failed')
       ORDER BY priority ASC, created_at ASC`
    );

    for (const row of result.rows) {
      const r = row;
      const job: Job = {
        id: r.id as string,
        type: r.type as string,
        status: (r.status === 'running' ? 'failed' : r.status) as JobStatus, // crashed jobs -> failed
        priority: r.priority as number,
        data: (r.data || {}) as Record<string, unknown>,
        progress: {
          total: (r.progress_total as number) || 0,
          completed: (r.progress_completed as number) || 0,
          failed: (r.progress_failed as number) || 0,
        },
        result: r.result,
        createdAt: r.created_at ? new Date(r.created_at as string).toISOString() : '',
        startedAt: r.started_at ? new Date(r.started_at as string).toISOString() : null,
        completedAt: r.completed_at ? new Date(r.completed_at as string).toISOString() : null,
        error: r.status === 'running' ? 'Job interrupted by system restart' : (r.error as string | null),
        retries: (r.retries as number) || 0,
        maxRetries: (r.max_retries as number) ?? maxRetries,
        createdBy: (r.created_by as string) || 'system',
      };
      jobs.set(job.id, job);
    }

    if (jobs.size > 0) {
      console.log(`[queue] Restored ${jobs.size} job(s) from database`);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[queue] Failed to load jobs from database: ${message}`);
  }
}

/**
 * Save jobs to persistence file (flat-file mode only).
 */
function saveJobs(): void {
  if (dbPool) return; // DB mode: individual mutations handle persistence

  if (!jobsFile) return;

  try {
    const data = Array.from(jobs.values());
    fs.writeFileSync(jobsFile, JSON.stringify(data, null, 2));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[queue] Failed to save jobs:', message);
  }
}

/**
 * Persist a single job to the database (upsert).
 */
function persistJobToDb(job: Job): void {
  if (!dbPool) return;
  dbPool.query(
    `INSERT INTO queue_jobs (id, type, status, priority, data, progress_total, progress_completed,
                             progress_failed, result, created_at, started_at, completed_at,
                             error, retries, max_retries, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       progress_total = EXCLUDED.progress_total,
       progress_completed = EXCLUDED.progress_completed,
       progress_failed = EXCLUDED.progress_failed,
       result = EXCLUDED.result,
       started_at = EXCLUDED.started_at,
       completed_at = EXCLUDED.completed_at,
       error = EXCLUDED.error,
       retries = EXCLUDED.retries`,
    [
      job.id, job.type, job.status, job.priority,
      JSON.stringify(job.data),
      job.progress?.total || 0, job.progress?.completed || 0, job.progress?.failed || 0,
      job.result ? JSON.stringify(job.result) : null,
      job.createdAt, job.startedAt, job.completedAt,
      job.error, job.retries, job.maxRetries ?? maxRetries, job.createdBy || 'system',
    ]
  ).catch((err: Error) => console.warn(`[queue] Failed to persist job to DB: ${err.message}`));
}

/**
 * Delete a job from the database.
 */
function deleteJobFromDb(jobId: string): void {
  if (!dbPool) return;
  dbPool.query(`DELETE FROM queue_jobs WHERE id = $1`, [jobId])
    .catch((err: Error) => console.warn(`[queue] Failed to delete job from DB: ${err.message}`));
}

/**
 * Archive and remove old completed jobs
 */
function archiveOldJobs(): void {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - archiveAfter);

  let archived = 0;

  for (const [id, job] of jobs) {
    if (job.status === 'completed' || job.status === 'failed') {
      const completedAt = new Date(job.completedAt || '');
      if (completedAt < cutoff) {
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
function archiveJob(job: Job): void {
  if (!queueDir) return;

  const archiveFile = path.join(queueDir, 'archive.json');
  let archive: Job[] = [];

  if (fs.existsSync(archiveFile)) {
    try {
      archive = JSON.parse(fs.readFileSync(archiveFile, 'utf8')) as Job[];
    } catch {
      archive = [];
    }
  }

  archive.push(job);
  fs.writeFileSync(archiveFile, JSON.stringify(archive, null, 2));
}

/**
 * Process a single job
 */
async function processJob(job: Job): Promise<Job> {
  const handler = handlers.get(job.type);

  if (!handler) {
    job.status = 'failed';
    job.error = `No handler registered for job type: ${job.type}`;
    job.completedAt = new Date().toISOString();
    saveJobs();
    persistJobToDb(job);
    return job;
  }

  // Mark as running
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  runningJobs.add(job.id);
  saveJobs();
  persistJobToDb(job);

  hooks.trigger('queue:jobStarted', { job });

  try {
    // Create progress updater for handler
    const progressUpdater: ProgressUpdater = (progress) => {
      updateProgress(job.id, progress);
    };

    // Execute handler
    const result = await handler(job, progressUpdater, handlerContext);

    // Mark as completed
    job.status = 'completed';
    job.result = result;
    job.completedAt = new Date().toISOString();

    hooks.trigger('queue:jobCompleted', { job });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    // Mark as failed
    job.status = 'failed';
    job.error = message;
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
  persistJobToDb(job);

  return job;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize the queue system
 * @param config - Configuration object
 */
export function init(config: QueueConfig = {}): void {
  if (config.enabled !== undefined) enabled = config.enabled;
  if (config.concurrency !== undefined) concurrency = config.concurrency;
  if (config.retryDelay !== undefined) retryDelay = config.retryDelay;
  if (config.maxRetries !== undefined) maxRetries = config.maxRetries;
  if (config.archiveAfter !== undefined) archiveAfter = config.archiveAfter;
  if (config.contentDir !== undefined) contentDir = config.contentDir;
  if (config.context !== undefined) handlerContext = config.context || null;

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
  for (const [, job] of jobs) {
    if (job.status === 'running') {
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
 * Set database pool for PostgreSQL job persistence.
 * @param pool - Database pool
 */
export async function initDb(pool: PgPool): Promise<void> {
  dbPool = pool;
  await loadJobsFromDb();
}

/**
 * Register a job handler
 * @param type - Job type (e.g., 'bulk:publish')
 * @param handler - Async function(job, updateProgress, context)
 */
export function registerHandler(type: string, handler: JobHandler): void {
  handlers.set(type, handler);
}

/**
 * Add a job to the queue
 * @param type - Job type
 * @param data - Job data
 * @param options - Job options
 * @returns Created job
 */
export function addJob(type: string, data: Record<string, unknown>, options: JobOptions = {}): Job {
  if (!enabled) {
    throw new Error('Queue system is disabled');
  }

  const now = new Date().toISOString();
  const jobData = data as Record<string, unknown> & { ids?: unknown[]; total?: number };

  const job: Job = {
    id: generateJobId(),
    type,
    status: 'pending',
    priority: options.priority || 5,  // 1 = highest, 10 = lowest
    data,
    progress: {
      total: jobData.ids?.length || jobData.total || 0,
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
  persistJobToDb(job);

  // Trigger hook
  hooks.trigger('queue:jobAdded', { job });

  return job;
}

/**
 * Get a job by ID
 * @param id - Job ID
 * @returns Job or null
 */
export function getJob(id: string): Job | null {
  return jobs.get(id) || null;
}

/**
 * List jobs by status
 * @param status - Filter by status (optional)
 * @returns Array of jobs
 */
export function listJobs(status: JobStatus | null = null): Job[] {
  const result: Job[] = [];

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
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  return result;
}

/**
 * Cancel a pending job
 * @param id - Job ID
 * @returns True if cancelled
 */
export function cancelJob(id: string): boolean {
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
  persistJobToDb(job);

  hooks.trigger('queue:jobCancelled', { job });

  return true;
}

/**
 * Retry a failed job
 * @param id - Job ID
 * @returns Updated job or null
 */
export function retryJob(id: string): Job | null {
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
  persistJobToDb(job);

  hooks.trigger('queue:jobRetried', { job });

  return job;
}

/**
 * Clear jobs by status
 * @param status - Status to clear (default: 'completed')
 * @returns Number of jobs cleared
 */
export function clearJobs(status: JobStatus = 'completed'): number {
  let cleared = 0;
  const deletedIds: string[] = [];

  for (const [id, job] of jobs) {
    if (job.status === status) {
      jobs.delete(id);
      deletedIds.push(id);
      cleared++;
    }
  }

  if (cleared > 0) {
    saveJobs();
    for (const id of deletedIds) {
      deleteJobFromDb(id);
    }
  }

  return cleared;
}

/**
 * Update job progress
 * @param id - Job ID
 * @param progress - Progress update
 */
export function updateProgress(id: string, progress: Partial<JobProgress>): void {
  const job = jobs.get(id);

  if (!job) return;

  job.progress = { ...job.progress, ...progress };
  saveJobs();
  persistJobToDb(job);

  hooks.trigger('queue:jobProgress', { job });
}

/**
 * Process pending jobs
 * @param limit - Max jobs to process (optional)
 * @returns Processed jobs
 */
export async function processQueue(limit: number | null = null): Promise<Job[]> {
  if (!enabled) {
    return [];
  }

  // Get pending jobs sorted by priority
  const pending = listJobs('pending');
  const toProcess = limit ? pending.slice(0, limit) : pending;

  const results: Job[] = [];

  for (const job of toProcess) {
    // Check concurrency limit
    if (runningJobs.size >= concurrency) {
      break;
    }

    try {
      const result = await processJob(job);
      results.push(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[queue] Job ${job.id} failed:`, message);
    }
  }

  return results;
}

/**
 * Start automatic queue processing
 * @param interval - Processing interval in seconds
 */
export function startProcessing(interval: number = 10): void {
  if (isProcessing) return;

  isProcessing = true;
  processingInterval = setInterval(() => {
    processQueue().catch((err: Error) => {
      console.error('[queue] Processing error:', err.message);
    });
  }, interval * 1000);

  console.log(`[queue] Auto-processing started (interval: ${interval}s)`);
}

/**
 * Stop automatic queue processing
 */
export function stopProcessing(): void {
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
 * @returns Statistics
 */
export function getStats(): QueueStats {
  const stats: QueueStats = {
    total: jobs.size,
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    byType: {},
    avgDuration: 0,
    enabled,
    concurrency,
    runningCount: runningJobs.size,
    isProcessing,
  };

  let totalDuration = 0;
  let completedCount = 0;

  for (const job of jobs.values()) {
    // Count by status
    if (typeof stats[job.status] === 'number') {
      (stats[job.status] as number)++;
    }

    // Count by type
    stats.byType[job.type] = (stats.byType[job.type] || 0) + 1;

    // Calculate average duration for completed jobs
    if (job.status === 'completed' && job.startedAt && job.completedAt) {
      const duration = new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime();
      totalDuration += duration;
      completedCount++;
    }
  }

  if (completedCount > 0) {
    stats.avgDuration = Math.round(totalDuration / completedCount);
  }

  return stats;
}

/**
 * Get configuration
 * @returns Current configuration
 */
export function getConfig(): { enabled: boolean; concurrency: number; retryDelay: number; maxRetries: number; archiveAfter: number } {
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
 * @param ms - Duration in milliseconds
 * @returns Formatted duration
 */
export function formatDuration(ms: number): string {
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
 * @param isoString - ISO timestamp
 * @returns Formatted relative time
 */
export function formatRelativeTime(isoString: string): string {
  if (!isoString) return '';

  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
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
export function registerBuiltinHandlers(context: HandlerContext): void {
  handlerContext = context;
  const content = context.services.get('content') as ContentService;

  // bulk:publish - Publish multiple items
  registerHandler('bulk:publish', async (job, updateProgressFn) => {
    const { contentType, ids } = job.data as { contentType: string; ids: string[] };
    const results = { success: 0, failed: 0, errors: [] as { id: string; error: string }[] };

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      try {
        await content.update(contentType, id, { status: 'published' });
        results.success++;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        results.failed++;
        results.errors.push({ id, error: message });
      }

      updateProgressFn({
        completed: results.success + results.failed,
        failed: results.failed,
      });
    }

    return results;
  });

  // bulk:unpublish - Unpublish multiple items
  registerHandler('bulk:unpublish', async (job, updateProgressFn) => {
    const { contentType, ids } = job.data as { contentType: string; ids: string[] };
    const results = { success: 0, failed: 0, errors: [] as { id: string; error: string }[] };

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      try {
        await content.update(contentType, id, { status: 'draft' });
        results.success++;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        results.failed++;
        results.errors.push({ id, error: message });
      }

      updateProgressFn({
        completed: results.success + results.failed,
        failed: results.failed,
      });
    }

    return results;
  });

  // bulk:archive - Archive multiple items
  registerHandler('bulk:archive', async (job, updateProgressFn) => {
    const { contentType, ids } = job.data as { contentType: string; ids: string[] };
    const results = { success: 0, failed: 0, errors: [] as { id: string; error: string }[] };

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      try {
        await content.update(contentType, id, { status: 'archived' });
        results.success++;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        results.failed++;
        results.errors.push({ id, error: message });
      }

      updateProgressFn({
        completed: results.success + results.failed,
        failed: results.failed,
      });
    }

    return results;
  });

  // bulk:delete - Delete multiple items
  registerHandler('bulk:delete', async (job, updateProgressFn) => {
    const { contentType, ids, permanent } = job.data as { contentType: string; ids: string[]; permanent?: boolean };
    const results = { success: 0, failed: 0, errors: [] as { id: string; error: string }[] };

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      try {
        if (permanent) {
          await content.remove(contentType, id);
        } else {
          await content.trash(contentType, id);
        }
        results.success++;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        results.failed++;
        results.errors.push({ id, error: message });
      }

      updateProgressFn({
        completed: results.success + results.failed,
        failed: results.failed,
      });
    }

    return results;
  });

  // bulk:update - Update multiple items with same data
  registerHandler('bulk:update', async (job, updateProgressFn) => {
    const { contentType, ids, data } = job.data as { contentType: string; ids: string[]; data: Record<string, unknown> };
    const results = { success: 0, failed: 0, errors: [] as { id: string; error: string }[] };

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      try {
        await content.update(contentType, id, data);
        results.success++;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        results.failed++;
        results.errors.push({ id, error: message });
      }

      updateProgressFn({
        completed: results.success + results.failed,
        failed: results.failed,
      });
    }

    return results;
  });

  // bulk:export - Export content (large exports)
  registerHandler('bulk:export', async (job, updateProgressFn, ctx) => {
    const transfer = ctx!.services.get('transfer') as TransferService;
    const { types, options } = job.data as { types: string[]; options: Record<string, unknown> };

    // Export content
    const exportData = transfer.exportContent(types, options);

    // Write to file
    const filename = `export_${Date.now()}.json`;
    const exportPath = path.join(queueDir!, filename);
    fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2));

    updateProgressFn({ completed: 1, total: 1 });

    return {
      success: true,
      filename,
      path: exportPath,
      itemCount: Object.values(exportData.content).reduce((sum: number, items) => sum + (items as unknown[]).length, 0),
    };
  });

  // bulk:import - Import content (large imports)
  registerHandler('bulk:import', async (job, updateProgressFn, ctx) => {
    const transfer = ctx!.services.get('transfer') as TransferService;
    const { filePath, options } = job.data as { filePath: string; options: Record<string, unknown> };

    // Read import file
    const importData = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { content?: Record<string, unknown[]> };

    // Count items
    const totalItems = Object.values(importData.content || {}).reduce(
      (sum: number, items) => sum + (items as unknown[]).length, 0
    );

    updateProgressFn({ total: totalItems, completed: 0 });

    // Import content
    const result = await transfer.importContent(importData, {
      ...options,
      onProgress: (completed: number) => {
        updateProgressFn({ completed });
      },
    });

    return result;
  });

  console.log('[queue] Built-in handlers registered');
}
