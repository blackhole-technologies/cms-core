// ===========================================
// CMS Core - Cron Task Management System
// ===========================================
//
// Extends scheduler.js with advanced task management:
// - Task registration with module namespacing
// - Execution locking to prevent concurrent runs
// - Execution logging with persistence
// - Task dependencies and ordering
// - Resource limits and health monitoring
// - Manual execution and task control
//
// ARCHITECTURE:
// - Built on existing scheduler.js for cron parsing
// - Adds management layer for config, logging, locking
// - Zero dependencies (Node.js stdlib only)
// - ES Modules

import { promises as fs } from 'fs';
import { join } from 'path';
import * as scheduler from './scheduler.ts';

// ===========================================
// Types
// ===========================================

/** Configuration for a single cron task */
interface TaskConfig {
  module: string;
  schedule: string;
  enabled: boolean;
  timeout: number;
  retries: number;
  dependencies: string[];
}

/** Registration input for a cron task */
interface TaskRegistrationConfig {
  module?: string;
  schedule: string;
  enabled?: boolean;
  timeout?: number;
  retries?: number;
  dependencies?: string[];
}

/** Full cron configuration file structure */
interface CronConfig {
  tasks: Record<string, TaskConfig>;
  settings: {
    maxConcurrent: number;
    logRetention: number;
  };
}

/** Task info returned by getTasks/getTask */
interface TaskInfo extends TaskConfig {
  lastRun: Date | null;
  nextRun: Date | null;
  runCount: number;
  lastStatus: string;
  lastDuration: number;
  running: boolean;
}

/** Result of running a task */
interface TaskRunResult {
  status: 'success' | 'error' | 'skipped' | 'queued';
  reason?: string;
  duration?: number;
  result?: unknown;
  error?: string;
}

/** Execution log entry */
interface ExecutionLogEntry {
  task: string;
  started: string;
  completed: string;
  duration: number;
  status: string;
  items_processed?: number;
  result?: unknown;
  error?: string;
}

/** Parsed cron expression result */
interface CronParseResult {
  valid: boolean;
  description?: string;
  error?: string;
}

/** Health status for a single task */
interface TaskHealthStatus {
  enabled: boolean;
  healthy: boolean;
  issues: string[];
}

/** Overall health status */
interface HealthStatus {
  running: number;
  queued: number;
  maxConcurrent: number;
  tasks: Record<string, TaskHealthStatus>;
}

/** Scheduler task entry (minimal interface) */
interface SchedulerTask {
  lastRun?: Date | null;
  nextRun?: Date | null;
  runCount?: number;
  lastStatus?: string;
  lastDuration?: number;
}

/** Handler function type */
type TaskHandler = () => Promise<unknown>;

// ===========================================
// Storage
// ===========================================

let baseDir: string | null = null;
let hooksService: { trigger: (name: string, data: Record<string, unknown>) => Promise<void> } | null = null;
let configPath: string | null = null;
let logsDir: string | null = null;

/**
 * Task configuration loaded from config/cron.json
 */
let config: CronConfig = {
  tasks: {},
  settings: {
    maxConcurrent: 3,
    logRetention: 30,
  },
};

/**
 * Active task handlers
 * Map of task ID to handler function
 */
const handlers: Map<string, TaskHandler> = new Map();

/**
 * Currently running tasks
 * Set of task IDs
 */
const runningTasks: Set<string> = new Set();

/**
 * Task execution locks
 * Map of task ID to lock timestamp
 */
const locks: Map<string, number> = new Map();

/**
 * Queued tasks waiting to run
 */
const taskQueue: string[] = [];

// ===========================================
// Initialization
// ===========================================

/**
 * Initialize cron system
 *
 * @param base - Base directory path
 * @param sched - Scheduler service (optional, defaults to core scheduler)
 * @param hooks - Hooks service (optional)
 */
export async function init(
  base: string,
  sched: unknown = null,
  hooks: { trigger: (name: string, data: Record<string, unknown>) => Promise<void> } | null = null
): Promise<void> {
  baseDir = base;
  hooksService = hooks;
  configPath = join(baseDir, 'config', 'cron.json');
  logsDir = join(baseDir, 'logs', 'cron');

  // Ensure logs directory exists
  await fs.mkdir(logsDir, { recursive: true });

  // Load configuration
  await loadConfig();

  console.log('[cron] Initialized');
}

/**
 * Load task configuration from config/cron.json
 */
async function loadConfig(): Promise<void> {
  try {
    const data = await fs.readFile(configPath!, 'utf8');
    config = JSON.parse(data) as CronConfig;

    // Validate structure
    if (!config.tasks) config.tasks = {};
    if (!config.settings) config.settings = { maxConcurrent: 3, logRetention: 30 };
    if (!config.settings.maxConcurrent) config.settings.maxConcurrent = 3;
    if (!config.settings.logRetention) config.settings.logRetention = 30;

    console.log(`[cron] Loaded ${Object.keys(config.tasks).length} tasks from config`);
  } catch (error: unknown) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Config doesn't exist yet, start with defaults
      console.log('[cron] No config found, starting with defaults');
      await saveConfig();
    } else {
      throw error;
    }
  }
}

/**
 * Save task configuration to config/cron.json
 */
async function saveConfig(): Promise<void> {
  const data = JSON.stringify(config, null, 2);
  await fs.writeFile(configPath!, data, 'utf8');
}

// ===========================================
// Task Registration
// ===========================================

/**
 * Register a cron task
 *
 * @param id - Task ID (e.g., "content:publish_scheduled")
 * @param taskConfig - Task configuration
 * @param handler - Async function to execute
 */
export async function registerTask(id: string, taskConfig: TaskRegistrationConfig, handler: TaskHandler): Promise<void> {
  // Validate inputs
  if (!id || typeof id !== 'string') {
    throw new Error('Task ID is required and must be a string');
  }
  if (typeof handler !== 'function') {
    throw new Error('Task handler must be a function');
  }
  if (!taskConfig.schedule) {
    throw new Error('Task schedule is required');
  }

  // Store handler
  handlers.set(id, handler);

  // Store config
  config.tasks[id] = {
    module: taskConfig.module || 'unknown',
    schedule: taskConfig.schedule,
    enabled: taskConfig.enabled !== false,
    timeout: taskConfig.timeout || 300,
    retries: taskConfig.retries || 0,
    dependencies: taskConfig.dependencies || [],
  };

  await saveConfig();

  // Register with scheduler if enabled
  if (config.tasks[id].enabled) {
    scheduler.schedule(id, taskConfig.schedule, () => runTask(id), {
      description: `Cron task: ${id}`,
    });
  }

  console.log(`[cron] Registered task: ${id}`);
}

/**
 * Unregister a cron task
 *
 * @param id - Task ID
 * @returns True if task existed and was removed
 */
export async function unregisterTask(id: string): Promise<boolean> {
  // Remove from scheduler
  scheduler.unschedule(id);

  // Remove handler
  handlers.delete(id);

  // Remove from config
  const existed = !!config.tasks[id];
  delete config.tasks[id];

  if (existed) {
    await saveConfig();
    console.log(`[cron] Unregistered task: ${id}`);
  }

  return existed;
}

// ===========================================
// Task Control
// ===========================================

/**
 * Get all registered tasks
 *
 * @returns Tasks configuration
 */
export function getTasks(): Record<string, TaskInfo> {
  const tasks: Record<string, TaskInfo> = {};

  for (const [id, taskConfig] of Object.entries(config.tasks)) {
    const schedulerTask = scheduler.get(id) as SchedulerTask | null;

    tasks[id] = {
      ...taskConfig,
      lastRun: schedulerTask?.lastRun || null,
      nextRun: schedulerTask?.nextRun || null,
      runCount: schedulerTask?.runCount || 0,
      lastStatus: schedulerTask?.lastStatus || 'pending',
      lastDuration: schedulerTask?.lastDuration || 0,
      running: runningTasks.has(id),
    };
  }

  return tasks;
}

/**
 * Get a specific task
 *
 * @param id - Task ID
 * @returns Task info or null if not found
 */
export function getTask(id: string): TaskInfo | null {
  const taskConfig = config.tasks[id];
  if (!taskConfig) return null;

  const schedulerTask = scheduler.get(id) as SchedulerTask | null;

  return {
    ...taskConfig,
    lastRun: schedulerTask?.lastRun || null,
    nextRun: schedulerTask?.nextRun || null,
    runCount: schedulerTask?.runCount || 0,
    lastStatus: schedulerTask?.lastStatus || 'pending',
    lastDuration: schedulerTask?.lastDuration || 0,
    running: runningTasks.has(id),
  };
}

/**
 * Enable a task
 *
 * @param id - Task ID
 */
export async function enableTask(id: string): Promise<void> {
  const taskConfig = config.tasks[id];
  if (!taskConfig) {
    throw new Error(`Task not found: ${id}`);
  }

  taskConfig.enabled = true;
  await saveConfig();

  // Register with scheduler
  const handler = handlers.get(id);
  if (handler) {
    scheduler.schedule(id, taskConfig.schedule, () => runTask(id), {
      description: `Cron task: ${id}`,
    });
  }

  console.log(`[cron] Enabled task: ${id}`);
}

/**
 * Disable a task
 *
 * @param id - Task ID
 */
export async function disableTask(id: string): Promise<void> {
  const taskConfig = config.tasks[id];
  if (!taskConfig) {
    throw new Error(`Task not found: ${id}`);
  }

  taskConfig.enabled = false;
  await saveConfig();

  // Unregister from scheduler
  scheduler.unschedule(id);

  console.log(`[cron] Disabled task: ${id}`);
}

// ===========================================
// Task Execution
// ===========================================

/**
 * Run a task manually or on schedule
 *
 * @param id - Task ID
 * @param force - Force execution even if locked
 * @returns Execution result
 */
export async function runTask(id: string, force: boolean = false): Promise<TaskRunResult> {
  const taskConfig = config.tasks[id];
  if (!taskConfig) {
    throw new Error(`Task not found: ${id}`);
  }

  const handler = handlers.get(id);
  if (!handler) {
    throw new Error(`No handler registered for task: ${id}`);
  }

  // Check if task is already running
  if (!force && isTaskRunning(id)) {
    console.log(`[cron] Task already running: ${id}`);
    return { status: 'skipped', reason: 'already_running' };
  }

  // Check concurrent limit
  if (!force && runningTasks.size >= config.settings.maxConcurrent) {
    console.log(`[cron] Max concurrent tasks reached, queuing: ${id}`);
    taskQueue.push(id);
    return { status: 'queued', reason: 'max_concurrent' };
  }

  // Check dependencies
  if (taskConfig.dependencies && taskConfig.dependencies.length > 0) {
    for (const depId of taskConfig.dependencies) {
      if (isTaskRunning(depId)) {
        console.log(`[cron] Waiting for dependency: ${depId}`);
        taskQueue.push(id);
        return { status: 'queued', reason: 'waiting_for_dependency' };
      }
    }
  }

  // Acquire lock
  if (!force) {
    acquireLock(id);
  }

  // Mark as running
  runningTasks.add(id);

  const startTime = Date.now();
  const started = new Date();

  try {
    // Trigger before hook
    if (hooksService) {
      await hooksService.trigger('cron:beforeRun', { taskId: id, taskConfig });
    }

    // Execute with timeout
    const timeoutMs = taskConfig.timeout * 1000;
    const result = await executeWithTimeout(handler, timeoutMs);

    // Calculate duration
    const duration = Date.now() - startTime;

    // Log execution
    await logExecution(id, started, new Date(), 'success', duration, result);

    // Trigger after hook
    if (hooksService) {
      await hooksService.trigger('cron:afterRun', {
        taskId: id,
        taskConfig,
        result,
        duration,
      });
    }

    console.log(`[cron] Completed task: ${id} (${duration}ms)`);

    return { status: 'success', duration, result };

  } catch (error: unknown) {
    const duration = Date.now() - startTime;
    const message = error instanceof Error ? error.message : String(error);

    // Log execution
    await logExecution(id, started, new Date(), 'error', duration, message);

    // Trigger error hook
    if (hooksService) {
      await hooksService.trigger('cron:error', {
        taskId: id,
        taskConfig,
        error: message,
        duration,
      });
    }

    console.error(`[cron] Failed task: ${id} - ${message}`);

    // Retry if configured
    if (taskConfig.retries > 0) {
      console.log(`[cron] Will retry task: ${id}`);
      // TODO: Implement retry logic with exponential backoff
    }

    return { status: 'error', duration, error: message };

  } finally {
    // Release lock and mark as not running
    releaseLock(id);
    runningTasks.delete(id);

    // Process queued tasks
    processQueue();
  }
}

/**
 * Execute handler with timeout
 *
 * @param handler - Handler function
 * @param timeoutMs - Timeout in milliseconds
 * @returns Handler result
 */
async function executeWithTimeout(handler: TaskHandler, timeoutMs: number): Promise<unknown> {
  return Promise.race([
    handler(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Task timeout')), timeoutMs)
    ),
  ]);
}

// ===========================================
// Task Locking
// ===========================================

/**
 * Acquire execution lock for a task
 *
 * @param id - Task ID
 */
function acquireLock(id: string): void {
  locks.set(id, Date.now());
}

/**
 * Release execution lock for a task
 *
 * @param id - Task ID
 */
function releaseLock(id: string): void {
  locks.delete(id);
}

/**
 * Check if a task is currently running
 *
 * @param id - Task ID
 * @returns True if task is running
 */
export function isTaskRunning(id: string): boolean {
  return runningTasks.has(id);
}

/**
 * Get all currently running tasks
 *
 * @returns Array of task IDs
 */
export function getRunningTasks(): string[] {
  return Array.from(runningTasks);
}

// ===========================================
// Task Queue
// ===========================================

/**
 * Process queued tasks
 */
async function processQueue(): Promise<void> {
  while (taskQueue.length > 0 && runningTasks.size < config.settings.maxConcurrent) {
    const id = taskQueue.shift();

    // Check if task is still valid
    if (id && config.tasks[id] && !isTaskRunning(id)) {
      // Run without awaiting to allow concurrent execution
      runTask(id).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[cron] Queued task failed: ${id}`, message);
      });
    }
  }
}

// ===========================================
// Execution Logging
// ===========================================

/**
 * Log task execution
 *
 * @param taskId - Task ID
 * @param started - Start time
 * @param completed - Completion time
 * @param status - 'success' or 'error'
 * @param duration - Duration in milliseconds
 * @param result - Result or error message
 */
async function logExecution(
  taskId: string,
  started: Date,
  completed: Date,
  status: string,
  duration: number,
  result: unknown
): Promise<void> {
  const log: ExecutionLogEntry = {
    task: taskId,
    started: started.toISOString(),
    completed: completed.toISOString(),
    duration,
    status,
  };

  // Add result details based on status
  if (status === 'success') {
    if (typeof result === 'object' && result !== null) {
      const resultObj = result as Record<string, unknown>;
      log.items_processed = (resultObj.count as number) || (resultObj.items as number) || 0;
      log.result = result;
    }
  } else {
    log.error = result as string;
  }

  // Write to log file
  const logFile = join(logsDir!, `${taskId.replace(/:/g, '_')}.json`);

  try {
    // Read existing logs
    let logs: ExecutionLogEntry[] = [];
    try {
      const data = await fs.readFile(logFile, 'utf8');
      logs = JSON.parse(data) as ExecutionLogEntry[];
    } catch (error: unknown) {
      // File doesn't exist yet
      if (error instanceof Error && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    // Add new log
    logs.unshift(log);

    // Trim old logs based on retention
    const maxLogs = config.settings.logRetention || 30;
    if (logs.length > maxLogs) {
      logs = logs.slice(0, maxLogs);
    }

    // Write back
    await fs.writeFile(logFile, JSON.stringify(logs, null, 2), 'utf8');

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[cron] Failed to log execution: ${message}`);
  }
}

/**
 * Get task execution logs
 *
 * @param id - Task ID
 * @param limit - Maximum number of logs to return
 * @returns Array of log entries
 */
export async function getTaskLogs(id: string, limit: number = 20): Promise<ExecutionLogEntry[]> {
  const logFile = join(logsDir!, `${id.replace(/:/g, '_')}.json`);

  try {
    const data = await fs.readFile(logFile, 'utf8');
    const logs = JSON.parse(data) as ExecutionLogEntry[];
    return logs.slice(0, limit);
  } catch (error: unknown) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

// ===========================================
// Scheduling Info
// ===========================================

/**
 * Get next run time for a task
 *
 * @param id - Task ID
 * @returns Next run time or null if task not found
 */
export function getNextRun(id: string): Date | null {
  const task = scheduler.get(id) as SchedulerTask | null;
  return task?.nextRun || null;
}

/**
 * Parse cron expression (delegates to scheduler)
 *
 * @param expr - Cron expression
 * @returns Parsed cron
 */
export function parseCronExpression(expr: string): CronParseResult {
  // This delegates to the existing scheduler parseCron function
  // We need to import the internal function, but for now we'll
  // just validate by trying to schedule a dummy task
  try {
    const parsed = scheduler.describeCron(expr);
    return { valid: true, description: parsed };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, error: message };
  }
}

/**
 * Check if a task should run at given time
 *
 * @param id - Task ID
 * @param now - Time to check
 * @returns True if task should run
 */
export function shouldRun(id: string, now: Date = new Date()): boolean {
  const taskConfig = config.tasks[id];
  if (!taskConfig || !taskConfig.enabled) return false;

  const task = scheduler.get(id) as SchedulerTask | null;
  if (!task) return false;

  // Round to minute for comparison
  const checkTime = new Date(now);
  checkTime.setSeconds(0);
  checkTime.setMilliseconds(0);

  const nextRun = task.nextRun;
  if (!nextRun) return false;

  return checkTime.getTime() >= nextRun.getTime();
}

// ===========================================
// Health Monitoring
// ===========================================

/**
 * Get health status of all tasks
 *
 * @returns Health status
 */
export function getHealth(): HealthStatus {
  const tasks = getTasks();
  const health: HealthStatus = {
    running: runningTasks.size,
    queued: taskQueue.length,
    maxConcurrent: config.settings.maxConcurrent,
    tasks: {},
  };

  for (const [id, task] of Object.entries(tasks)) {
    const status: TaskHealthStatus = {
      enabled: task.enabled,
      healthy: true,
      issues: [],
    };

    // Check for stuck tasks (running > 2x timeout)
    if (task.running) {
      const lockTime = locks.get(id);
      if (lockTime) {
        const elapsed = Date.now() - lockTime;
        const maxTime = task.timeout * 2000;
        if (elapsed > maxTime) {
          status.healthy = false;
          status.issues.push('stuck');
        }
      }
    }

    // Check for repeated failures
    if (task.lastStatus === 'error') {
      status.issues.push('last_run_failed');
    }

    health.tasks[id] = status;
  }

  return health;
}

// ===========================================
// Default Export
// ===========================================

export default {
  init,
  registerTask,
  unregisterTask,
  getTasks,
  getTask,
  runTask,
  enableTask,
  disableTask,
  getTaskLogs,
  getNextRun,
  parseCronExpression,
  shouldRun,
  isTaskRunning,
  getRunningTasks,
  getHealth,
};
