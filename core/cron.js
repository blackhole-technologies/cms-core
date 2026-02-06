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
import * as scheduler from './scheduler.js';

// ===========================================
// Storage
// ===========================================

let baseDir = null;
let hooksService = null;
let configPath = null;
let logsDir = null;

/**
 * Task configuration loaded from config/cron.json
 */
let config = {
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
const handlers = new Map();

/**
 * Currently running tasks
 * Set of task IDs
 */
const runningTasks = new Set();

/**
 * Task execution locks
 * Map of task ID to lock timestamp
 */
const locks = new Map();

/**
 * Queued tasks waiting to run
 */
const taskQueue = [];

// ===========================================
// Initialization
// ===========================================

/**
 * Initialize cron system
 *
 * @param {string} base - Base directory path
 * @param {Object} sched - Scheduler service (optional, defaults to core scheduler)
 * @param {Object} hooks - Hooks service (optional)
 */
export async function init(base, sched = null, hooks = null) {
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
async function loadConfig() {
  try {
    const data = await fs.readFile(configPath, 'utf8');
    config = JSON.parse(data);

    // Validate structure
    if (!config.tasks) config.tasks = {};
    if (!config.settings) config.settings = {};
    if (!config.settings.maxConcurrent) config.settings.maxConcurrent = 3;
    if (!config.settings.logRetention) config.settings.logRetention = 30;

    console.log(`[cron] Loaded ${Object.keys(config.tasks).length} tasks from config`);
  } catch (error) {
    if (error.code === 'ENOENT') {
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
async function saveConfig() {
  const data = JSON.stringify(config, null, 2);
  await fs.writeFile(configPath, data, 'utf8');
}

// ===========================================
// Task Registration
// ===========================================

/**
 * Register a cron task
 *
 * @param {string} id - Task ID (e.g., "content:publish_scheduled")
 * @param {Object} taskConfig - Task configuration
 * @param {string} taskConfig.module - Module name
 * @param {string} taskConfig.schedule - Cron expression
 * @param {boolean} taskConfig.enabled - Whether task is enabled
 * @param {number} taskConfig.timeout - Timeout in seconds
 * @param {number} taskConfig.retries - Number of retries on failure
 * @param {Array<string>} taskConfig.dependencies - Task IDs that must complete first
 * @param {Function} handler - Async function to execute
 */
export async function registerTask(id, taskConfig, handler) {
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
 * @param {string} id - Task ID
 * @returns {boolean} True if task existed and was removed
 */
export async function unregisterTask(id) {
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
 * @returns {Object} Tasks configuration
 */
export function getTasks() {
  const tasks = {};

  for (const [id, taskConfig] of Object.entries(config.tasks)) {
    const schedulerTask = scheduler.get(id);

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
 * @param {string} id - Task ID
 * @returns {Object|null} Task info or null if not found
 */
export function getTask(id) {
  const taskConfig = config.tasks[id];
  if (!taskConfig) return null;

  const schedulerTask = scheduler.get(id);

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
 * @param {string} id - Task ID
 */
export async function enableTask(id) {
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
 * @param {string} id - Task ID
 */
export async function disableTask(id) {
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
 * @param {string} id - Task ID
 * @param {boolean} force - Force execution even if locked
 * @returns {Promise<Object>} Execution result
 */
export async function runTask(id, force = false) {
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

  } catch (error) {
    const duration = Date.now() - startTime;

    // Log execution
    await logExecution(id, started, new Date(), 'error', duration, error.message);

    // Trigger error hook
    if (hooksService) {
      await hooksService.trigger('cron:error', {
        taskId: id,
        taskConfig,
        error: error.message,
        duration,
      });
    }

    console.error(`[cron] Failed task: ${id} - ${error.message}`);

    // Retry if configured
    if (taskConfig.retries > 0) {
      console.log(`[cron] Will retry task: ${id}`);
      // TODO: Implement retry logic with exponential backoff
    }

    return { status: 'error', duration, error: error.message };

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
 * @param {Function} handler - Handler function
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<*>} Handler result
 */
async function executeWithTimeout(handler, timeoutMs) {
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
 * @param {string} id - Task ID
 */
function acquireLock(id) {
  locks.set(id, Date.now());
}

/**
 * Release execution lock for a task
 *
 * @param {string} id - Task ID
 */
function releaseLock(id) {
  locks.delete(id);
}

/**
 * Check if a task is currently running
 *
 * @param {string} id - Task ID
 * @returns {boolean} True if task is running
 */
export function isTaskRunning(id) {
  return runningTasks.has(id);
}

/**
 * Get all currently running tasks
 *
 * @returns {Array<string>} Array of task IDs
 */
export function getRunningTasks() {
  return Array.from(runningTasks);
}

// ===========================================
// Task Queue
// ===========================================

/**
 * Process queued tasks
 */
async function processQueue() {
  while (taskQueue.length > 0 && runningTasks.size < config.settings.maxConcurrent) {
    const id = taskQueue.shift();

    // Check if task is still valid
    if (config.tasks[id] && !isTaskRunning(id)) {
      // Run without awaiting to allow concurrent execution
      runTask(id).catch(error => {
        console.error(`[cron] Queued task failed: ${id}`, error);
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
 * @param {string} taskId - Task ID
 * @param {Date} started - Start time
 * @param {Date} completed - Completion time
 * @param {string} status - 'success' or 'error'
 * @param {number} duration - Duration in milliseconds
 * @param {*} result - Result or error message
 */
async function logExecution(taskId, started, completed, status, duration, result) {
  const log = {
    task: taskId,
    started: started.toISOString(),
    completed: completed.toISOString(),
    duration,
    status,
  };

  // Add result details based on status
  if (status === 'success') {
    if (typeof result === 'object' && result !== null) {
      log.items_processed = result.count || result.items || 0;
      log.result = result;
    }
  } else {
    log.error = result;
  }

  // Write to log file
  const logFile = join(logsDir, `${taskId.replace(/:/g, '_')}.json`);

  try {
    // Read existing logs
    let logs = [];
    try {
      const data = await fs.readFile(logFile, 'utf8');
      logs = JSON.parse(data);
    } catch (error) {
      // File doesn't exist yet
      if (error.code !== 'ENOENT') throw error;
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

  } catch (error) {
    console.error(`[cron] Failed to log execution: ${error.message}`);
  }
}

/**
 * Get task execution logs
 *
 * @param {string} id - Task ID
 * @param {number} limit - Maximum number of logs to return
 * @returns {Promise<Array>} Array of log entries
 */
export async function getTaskLogs(id, limit = 20) {
  const logFile = join(logsDir, `${id.replace(/:/g, '_')}.json`);

  try {
    const data = await fs.readFile(logFile, 'utf8');
    const logs = JSON.parse(data);
    return logs.slice(0, limit);
  } catch (error) {
    if (error.code === 'ENOENT') {
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
 * @param {string} id - Task ID
 * @returns {Date|null} Next run time or null if task not found
 */
export function getNextRun(id) {
  const task = scheduler.get(id);
  return task?.nextRun || null;
}

/**
 * Parse cron expression (delegates to scheduler)
 *
 * @param {string} expr - Cron expression
 * @returns {Object} Parsed cron
 */
export function parseCronExpression(expr) {
  // This delegates to the existing scheduler parseCron function
  // We need to import the internal function, but for now we'll
  // just validate by trying to schedule a dummy task
  try {
    const parsed = scheduler.describeCron(expr);
    return { valid: true, description: parsed };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

/**
 * Check if a task should run at given time
 *
 * @param {string} id - Task ID
 * @param {Date} now - Time to check
 * @returns {boolean} True if task should run
 */
export function shouldRun(id, now = new Date()) {
  const taskConfig = config.tasks[id];
  if (!taskConfig || !taskConfig.enabled) return false;

  const task = scheduler.get(id);
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
 * @returns {Object} Health status
 */
export function getHealth() {
  const tasks = getTasks();
  const health = {
    running: runningTasks.size,
    queued: taskQueue.length,
    maxConcurrent: config.settings.maxConcurrent,
    tasks: {},
  };

  for (const [id, task] of Object.entries(tasks)) {
    const status = {
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
