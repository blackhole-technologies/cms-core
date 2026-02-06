// ===========================================
// CMS Core - Scheduled Task System
// ===========================================
//
// Provides cron-like scheduling for recurring tasks using setInterval.
//
// CRON EXPRESSION FORMAT:
// =======================
//
// Standard cron format with 5 fields:
//   minute hour day-of-month month day-of-week
//
// Field ranges:
//   - minute: 0-59
//   - hour: 0-23
//   - day of month: 1-31
//   - month: 1-12
//   - day of week: 0-6 (0 = Sunday)
//
// SUPPORTED PATTERNS:
// ==================
//
// - "*"     : Any value (matches all)
// - "5"     : Specific value (matches only 5)
// - "* /5"  : Step value (every 5 units: 0, 5, 10, 15, ...) [no space]
// - "1,3,5" : List of values (matches 1, 3, or 5)
// - "1-5"   : Range (matches 1, 2, 3, 4, or 5)
//
// COMMON EXPRESSIONS:
// ==================
//
// "* * * * *"      - Every minute
// "0 * * * *"      - Every hour (at minute 0)
// "0 0 * * *"      - Daily at midnight
// "0 0 * * 0"      - Weekly on Sunday at midnight
// "0 0 1 * *"      - Monthly on the 1st at midnight
// "30 4 * * *"     - Daily at 4:30 AM
// "0 9-17 * * 1-5" - Hourly from 9 AM to 5 PM, Monday-Friday
//
// IMPLEMENTATION NOTES:
// ====================
//
// We use a tick-based approach:
// 1. A single setInterval runs every minute
// 2. On each tick, we check which tasks should run
// 3. Matching tasks are executed (async, non-blocking)
//
// WHY NOT setTimeout for each task?
// - Simpler to manage one timer
// - Easier to stop all tasks cleanly
// - Better for many tasks (fewer active timers)
//
// WHY MINUTE GRANULARITY?
// - Standard cron behavior
// - Sub-minute scheduling rarely needed for CMS tasks
// - Reduces complexity and timer overhead
//

// ===========================================
// Storage
// ===========================================

/**
 * Registered tasks
 * Map of task name to task object
 *
 * Task object structure:
 * {
 *   name: string,           // Unique task identifier
 *   cronExpr: string,       // Original cron expression
 *   parsedCron: Object,     // Parsed cron fields
 *   handler: Function,      // Async function to execute
 *   options: Object,        // Task options (enabled, etc.)
 *   lastRun: Date|null,     // When task last ran
 *   nextRun: Date|null,     // When task will next run
 *   runCount: number,       // How many times task has run
 *   lastStatus: string,     // 'success', 'error', or 'pending'
 *   lastError: string|null, // Last error message if any
 *   lastDuration: number,   // Last run duration in ms
 * }
 */
const tasks = new Map();

/**
 * Task run history for persistence
 */
const runHistory = [];

/**
 * Maximum history entries to keep in memory
 */
const MAX_HISTORY = 100;

/**
 * The main scheduler interval ID
 */
let schedulerInterval = null;

/**
 * Whether scheduler is running
 */
let isRunning = false;

/**
 * Content service reference (for persisting history)
 */
let contentService = null;

// ===========================================
// Cron Parsing
// ===========================================

// Parse a single cron field into a matcher function
//
// @param {string} field - The cron field value (e.g., "*", "5", "star/5", "1-5", "1,3,5")
// @param {number} min - Minimum allowed value for this field
// @param {number} max - Maximum allowed value for this field
// @returns {Function} A function that takes a value and returns true if it matches
//
// PARSING LOGIC:
// ==============
//
// 1. "*" (any)
//    Matches any value. Returns () => true
//
// 2. "*/N" (step) - e.g., */5 for every 5 units
//    Matches values where value % N === 0
//    With minutes: matches 0, 5, 10, 15, 20, ...
//
// 3. "N" (specific)
//    Matches only that specific value
//    "5" matches only 5
//
// 4. "N-M" (range)
//    Matches values from N to M inclusive
//    "1-5" matches 1, 2, 3, 4, 5
//
// 5. "N,M,O" (list)
//    Matches any of the listed values
//    "1,3,5" matches 1, 3, or 5
//
// Example:
//   const matcher = parseCronField('*/5', 0, 59);
//   matcher(0);  // true
//   matcher(5);  // true
//   matcher(7);  // false
//
function parseCronField(field, min, max) {
  // ANY: "*" matches everything
  if (field === '*') {
    return () => true;
  }

  // STEP: "*/N" (star-slash-N) matches every N values starting from 0
  // WHY CHECK FOR "/" FIRST:
  // Step expressions start with "*" but aren't the "any" pattern
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);

    // Validate step value
    if (isNaN(step) || step <= 0) {
      throw new Error(`Invalid step value in cron field: ${field}`);
    }

    // Return matcher function
    // Value matches if value % step === 0
    return (value) => value % step === 0;
  }

  // LIST: "1,3,5" matches any of the values
  // Check before RANGE because lists can contain ranges ("1-3,5,7-9")
  if (field.includes(',')) {
    // Split by comma and recursively parse each part
    const parts = field.split(',');
    const matchers = parts.map(part => parseCronField(part.trim(), min, max));

    // Value matches if ANY matcher matches
    return (value) => matchers.some(matcher => matcher(value));
  }

  // RANGE: "1-5" matches values from 1 to 5 inclusive
  if (field.includes('-')) {
    const [startStr, endStr] = field.split('-');
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);

    // Validate range values
    if (isNaN(start) || isNaN(end)) {
      throw new Error(`Invalid range in cron field: ${field}`);
    }
    if (start < min || end > max || start > end) {
      throw new Error(`Range out of bounds in cron field: ${field} (allowed: ${min}-${max})`);
    }

    // Return matcher function
    return (value) => value >= start && value <= end;
  }

  // SPECIFIC: "5" matches only the value 5
  const num = parseInt(field, 10);

  // Validate specific value
  if (isNaN(num)) {
    throw new Error(`Invalid cron field value: ${field}`);
  }
  if (num < min || num > max) {
    throw new Error(`Value out of range in cron field: ${field} (allowed: ${min}-${max})`);
  }

  // Return matcher function
  return (value) => value === num;
}

/**
 * Parse a complete cron expression into matcher functions
 *
 * @param {string} cronExpr - Full cron expression (5 fields)
 * @returns {Object} Parsed cron with matcher functions for each field
 *
 * @example
 * const parsed = parseCron('0 * * * *'); // Every hour
 * parsed.minute(0);  // true
 * parsed.minute(30); // false
 * parsed.hour(5);    // true (any hour)
 */
function parseCron(cronExpr) {
  // Split expression into fields
  const fields = cronExpr.trim().split(/\s+/);

  // Validate field count
  if (fields.length !== 5) {
    throw new Error(
      `Invalid cron expression: "${cronExpr}". ` +
      `Expected 5 fields (minute hour day month weekday), got ${fields.length}`
    );
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;

  // Parse each field with its valid range
  // CRON FIELD RANGES:
  // - minute: 0-59
  // - hour: 0-23
  // - day of month: 1-31
  // - month: 1-12
  // - day of week: 0-6 (0 = Sunday)
  return {
    minute: parseCronField(minute, 0, 59),
    hour: parseCronField(hour, 0, 23),
    dayOfMonth: parseCronField(dayOfMonth, 1, 31),
    month: parseCronField(month, 1, 12),
    dayOfWeek: parseCronField(dayOfWeek, 0, 6),
    original: cronExpr,
  };
}

/**
 * Check if a cron expression matches a given date
 *
 * @param {Object} parsedCron - Parsed cron expression
 * @param {Date} date - Date to check against
 * @returns {boolean} True if the date matches the cron expression
 *
 * MATCHING LOGIC:
 * ==============
 *
 * A date matches if ALL of these conditions are true:
 * - Minute matches
 * - Hour matches
 * - Day of month matches OR Day of week matches (special cron behavior)
 * - Month matches
 *
 * WHY "OR" FOR DAY FIELDS:
 * Standard cron behavior: if both day-of-month and day-of-week are specified
 * (not "*"), then EITHER matching causes execution. This allows expressions
 * like "run on the 1st of the month OR every Monday".
 *
 * Most implementations (including this one) simplify to: both fields must match,
 * but "*" means "don't restrict this field". This matches common expectations.
 */
function matchesCron(parsedCron, date) {
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dayOfMonth = date.getDate();
  const month = date.getMonth() + 1; // JS months are 0-indexed
  const dayOfWeek = date.getDay();   // 0 = Sunday

  // All fields must match
  return (
    parsedCron.minute(minute) &&
    parsedCron.hour(hour) &&
    parsedCron.dayOfMonth(dayOfMonth) &&
    parsedCron.month(month) &&
    parsedCron.dayOfWeek(dayOfWeek)
  );
}

/**
 * Calculate the next run time for a cron expression
 *
 * @param {Object} parsedCron - Parsed cron expression
 * @param {Date} [from] - Start searching from this date (default: now)
 * @returns {Date} Next date that matches the cron expression
 *
 * WHY ITERATE MINUTE BY MINUTE:
 * - Simple and guaranteed to find the next match
 * - Cron has minute granularity anyway
 * - Maximum iterations bounded (worst case: 1 year = ~525,600 iterations)
 */
function getNextRun(parsedCron, from = new Date()) {
  // Start from the next minute (current minute might already be past)
  const next = new Date(from);
  next.setSeconds(0);
  next.setMilliseconds(0);
  next.setMinutes(next.getMinutes() + 1);

  // Search up to 2 years ahead (should always find a match)
  const maxIterations = 60 * 24 * 365 * 2;

  for (let i = 0; i < maxIterations; i++) {
    if (matchesCron(parsedCron, next)) {
      return next;
    }
    next.setMinutes(next.getMinutes() + 1);
  }

  // This should never happen with valid cron expressions
  throw new Error('Could not calculate next run time');
}

// ===========================================
// Task Management
// ===========================================

/**
 * Register a scheduled task
 *
 * @param {string} name - Unique task identifier
 * @param {string} cronExpr - Cron expression for scheduling
 * @param {Function} handler - Async function to execute
 * @param {Object} [options] - Task options
 * @param {boolean} [options.enabled=true] - Whether task is enabled
 * @param {string} [options.description] - Human-readable description
 *
 * @example
 * schedule('cleanup', '0 * * * *', async () => {
 *   console.log('Running hourly cleanup...');
 * }, { description: 'Clear expired cache entries' });
 */
export function schedule(name, cronExpr, handler, options = {}) {
  // Validate name
  if (!name || typeof name !== 'string') {
    throw new Error('Task name is required and must be a string');
  }

  // Validate handler
  if (typeof handler !== 'function') {
    throw new Error('Task handler must be a function');
  }

  // Parse cron expression (validates format)
  const parsedCron = parseCron(cronExpr);

  // Calculate next run time
  const nextRun = getNextRun(parsedCron);

  // Create task object
  const task = {
    name,
    cronExpr,
    parsedCron,
    handler,
    options: {
      enabled: true,
      description: '',
      ...options,
    },
    lastRun: null,
    nextRun,
    runCount: 0,
    lastStatus: 'pending',
    lastError: null,
    lastDuration: 0,
  };

  // Store task
  tasks.set(name, task);

  console.log(`[scheduler] Registered task: ${name} (${cronExpr})`);

  return task;
}

/**
 * Unregister a scheduled task
 *
 * @param {string} name - Task name to remove
 * @returns {boolean} True if task existed and was removed
 */
export function unschedule(name) {
  const existed = tasks.has(name);
  tasks.delete(name);

  if (existed) {
    console.log(`[scheduler] Unregistered task: ${name}`);
  }

  return existed;
}

/**
 * Manually run a task (regardless of schedule)
 *
 * @param {string} name - Task name to run
 * @returns {Promise<Object>} Run result with status and duration
 */
export async function run(name) {
  const task = tasks.get(name);

  if (!task) {
    throw new Error(`Task not found: ${name}`);
  }

  console.log(`[scheduler] Running: ${name}`);

  const startTime = Date.now();
  const startedAt = new Date();

  try {
    // Execute task handler
    const result = await task.handler();

    // Update task stats
    const duration = Date.now() - startTime;
    task.lastRun = startedAt;
    task.lastStatus = 'success';
    task.lastError = null;
    task.lastDuration = duration;
    task.runCount++;
    task.nextRun = getNextRun(task.parsedCron);

    // Record history
    recordHistory(name, startedAt, new Date(), 'success', result);

    console.log(`[scheduler] Completed: ${name} (${duration}ms)`);

    return { status: 'success', duration, result };

  } catch (error) {
    // Update task stats on error
    const duration = Date.now() - startTime;
    task.lastRun = startedAt;
    task.lastStatus = 'error';
    task.lastError = error.message;
    task.lastDuration = duration;
    task.runCount++;
    task.nextRun = getNextRun(task.parsedCron);

    // Record history
    recordHistory(name, startedAt, new Date(), 'error', error.message);

    console.error(`[scheduler] Failed: ${name} - ${error.message}`);

    return { status: 'error', duration, error: error.message };
  }
}

/**
 * List all scheduled tasks
 *
 * @returns {Array} Array of task info objects
 */
export function list() {
  const result = [];

  for (const task of tasks.values()) {
    result.push({
      name: task.name,
      cronExpr: task.cronExpr,
      description: task.options.description,
      enabled: task.options.enabled,
      lastRun: task.lastRun,
      nextRun: task.nextRun,
      runCount: task.runCount,
      lastStatus: task.lastStatus,
      lastError: task.lastError,
      lastDuration: task.lastDuration,
    });
  }

  return result;
}

/**
 * Get a specific task by name
 *
 * @param {string} name - Task name
 * @returns {Object|null} Task info or null if not found
 */
export function get(name) {
  const task = tasks.get(name);
  if (!task) return null;

  return {
    name: task.name,
    cronExpr: task.cronExpr,
    description: task.options.description,
    enabled: task.options.enabled,
    lastRun: task.lastRun,
    nextRun: task.nextRun,
    runCount: task.runCount,
    lastStatus: task.lastStatus,
    lastError: task.lastError,
    lastDuration: task.lastDuration,
  };
}

// ===========================================
// History Management
// ===========================================

/**
 * Record a task run in history
 *
 * @param {string} name - Task name
 * @param {Date} startedAt - When task started
 * @param {Date} completedAt - When task completed
 * @param {string} status - 'success' or 'error'
 * @param {*} result - Result or error message
 */
function recordHistory(name, startedAt, completedAt, status, result) {
  const entry = {
    name,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    duration: completedAt - startedAt,
    status,
    result: typeof result === 'string' ? result : JSON.stringify(result),
  };

  // Add to in-memory history
  runHistory.unshift(entry);

  // Trim to max size
  if (runHistory.length > MAX_HISTORY) {
    runHistory.pop();
  }

  // Persist to content (if available)
  if (contentService && contentService.hasType('taskrun')) {
    try {
      contentService.create('taskrun', entry);
    } catch (error) {
      console.error(`[scheduler] Failed to persist task history: ${error.message}`);
    }
  }
}

/**
 * Get task run history
 *
 * @param {string} [name] - Filter by task name (optional)
 * @param {number} [limit=20] - Maximum entries to return
 * @returns {Array} Array of history entries
 */
export function history(name = null, limit = 20) {
  let entries = runHistory;

  // Filter by name if provided
  if (name) {
    entries = entries.filter(e => e.name === name);
  }

  // Return limited results
  return entries.slice(0, limit);
}

// ===========================================
// Scheduler Control
// ===========================================

/**
 * Start the scheduler
 *
 * Begins the main scheduler loop that checks for tasks to run every minute.
 *
 * @param {Object} [context] - Boot context (for content service)
 */
export function start(context = null) {
  if (isRunning) {
    console.log('[scheduler] Already running');
    return;
  }

  // Store content service reference for history persistence
  if (context && context.services) {
    contentService = context.services.get('content');
  }

  // Start the scheduler tick
  // WHY 60000ms (1 minute):
  // Cron has minute granularity. Checking more often wastes CPU.
  // Checking less often could miss scheduled runs.
  schedulerInterval = setInterval(tick, 60000);

  isRunning = true;

  // Run initial tick to handle tasks due now
  // WHY IMMEDIATE TICK:
  // If server starts at 10:00:05 and a task is scheduled for "0 10 * * *",
  // we want it to run now, not wait until 10:01.
  tick();
}

/**
 * Stop the scheduler
 *
 * Stops the main scheduler loop. Running tasks will complete but no new tasks
 * will be started.
 */
export function stop() {
  if (!isRunning) {
    console.log('[scheduler] Not running');
    return;
  }

  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }

  isRunning = false;
  console.log('[scheduler] Stopped');
}

/**
 * Check if scheduler is running
 *
 * @returns {boolean} True if scheduler is active
 */
export function running() {
  return isRunning;
}

/**
 * Scheduler tick - runs every minute to check for due tasks
 *
 * This is the heart of the scheduler. On each tick:
 * 1. Get current time (rounded to minute)
 * 2. Check each task's cron expression
 * 3. Run matching tasks (async, don't block)
 */
function tick() {
  const now = new Date();
  // Round to current minute for matching
  now.setSeconds(0);
  now.setMilliseconds(0);

  for (const task of tasks.values()) {
    // Skip disabled tasks
    if (!task.options.enabled) {
      continue;
    }

    // Check if task should run now
    if (matchesCron(task.parsedCron, now)) {
      // Run task asynchronously (don't await - don't block other tasks)
      run(task.name).catch(error => {
        // Errors are already logged in run(), this is just a safety net
        console.error(`[scheduler] Unhandled error in task ${task.name}:`, error);
      });
    }
  }
}

// ===========================================
// Utility Functions
// ===========================================

// Format a cron expression as human-readable text
//
// @param {string} cronExpr - Cron expression
// @returns {string} Human-readable description
//
// Examples:
//   describeCron('0 * * * *');  // "hourly"
//   describeCron('0 0 * * *');  // "daily at midnight"
//   describeCron with step expr; // "every 5 minutes"
//
export function describeCron(cronExpr) {
  const fields = cronExpr.trim().split(/\s+/);
  if (fields.length !== 5) return cronExpr;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;

  // Common patterns
  if (minute === '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'every minute';
  }

  if (minute.startsWith('*/') && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `every ${minute.slice(2)} minutes`;
  }

  if (minute === '0' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'hourly';
  }

  if (minute === '0' && hour === '0' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'daily at midnight';
  }

  if (minute === '0' && hour === '0' && dayOfMonth === '1' && month === '*' && dayOfWeek === '*') {
    return 'monthly on the 1st';
  }

  if (minute === '0' && hour === '0' && dayOfMonth === '*' && month === '*' && dayOfWeek === '0') {
    return 'weekly on Sunday';
  }

  if (minute !== '*' && hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `daily at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  }

  // Default: return the expression
  return cronExpr;
}

/**
 * Format a date for display
 *
 * @param {Date} date - Date to format
 * @returns {string} Formatted date string
 */
export function formatDate(date) {
  if (!date) return 'never';

  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

// ===========================================
// Module Registration Helper
// ===========================================

/**
 * Create a module-specific schedule function
 *
 * This mirrors the pattern used for CLI, routes, etc.
 *
 * @param {string} moduleName - Name of the module
 * @returns {Function} Schedule function bound to module
 */
export function createModuleScheduler(moduleName) {
  return function moduleSchedule(name, cronExpr, handler, options = {}) {
    // Prefix task name with module
    const fullName = name.includes(':') ? name : `${moduleName}:${name}`;
    return schedule(fullName, cronExpr, handler, options);
  };
}

// ===========================================
// Default Export
// ===========================================

export default {
  schedule,
  unschedule,
  run,
  list,
  get,
  history,
  start,
  stop,
  running,
  describeCron,
  formatDate,
  createModuleScheduler,
};
