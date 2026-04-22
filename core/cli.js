/**
 * cli.js - Command Line Interface System
 *
 * WHY THIS EXISTS:
 * A CMS needs administrative commands for common tasks:
 * - Listing and managing modules
 * - Viewing configuration
 * - Debugging (viewing logs, system status)
 *
 * This CLI system provides:
 * - Simple command registration (no framework overhead)
 * - Built-in commands for common operations
 * - Extensibility for modules to add their own commands via hooks
 *
 * DESIGN DECISION: Object-based registry with source tracking
 * Commands are stored with their source (core vs module name).
 * This allows the help command to group commands logically.
 *
 * HOOK-BASED EXTENSION:
 * Modules export hook_cli(register) to add commands.
 * The register function is passed to the hook, keeping modules
 * decoupled from the CLI internals.
 *
 * USAGE:
 *   node index.js help
 *   node index.js modules:list
 *   node index.js hello:greet Ernie
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as dependencies from './dependencies.ts';

/**
 * Command registry
 * Structure: { commandName: { handler, description, source } }
 *
 * WHY TRACK SOURCE:
 * - Help command can group core vs module commands
 * - Debugging: know which module provided which command
 * - Potential for per-module command disabling later
 */
const commands = {};

/**
 * Core command names (for grouping in help)
 * Populated as core commands are registered
 */
const coreCommands = new Set();

/**
 * Register a command (internal)
 *
 * @param {string} name - Command name (e.g., "modules:list", "hello:greet")
 * @param {Function} handler - Async function(args, context) => void
 * @param {string} description - Help text for this command
 * @param {string} source - "core" or module name
 */
function registerInternal(name, handler, description, source = 'core') {
  commands[name] = { handler, description, source };

  if (source === 'core') {
    coreCommands.add(name);
  }
}

/**
 * Register a core command
 *
 * WHY SEPARATE FROM MODULE REGISTRATION:
 * Core commands are registered at module load time.
 * Module commands are registered via hooks during boot.
 * Different sources need different tracking.
 */
export function register(name, handler, description) {
  registerInternal(name, handler, description, 'core');
}

/**
 * Register a command with explicit source (for plugins)
 */
export { registerInternal };

/**
 * Create a register function for a specific module
 *
 * WHY FACTORY FUNCTION:
 * Each module gets a register function that automatically
 * tracks which module the command came from.
 * Modules don't need to pass their name each time.
 *
 * @param {string} moduleName - The module registering commands
 * @returns {Function} - register(name, handler, description)
 */
export function createModuleRegister(moduleName) {
  return function registerForModule(name, handler, description) {
    registerInternal(name, handler, description, moduleName);
  };
}

/**
 * Run a command
 *
 * @param {string} command - Command name to run
 * @param {string[]} args - Arguments passed to the command
 * @param {Object} context - Boot context (config, modules, services, etc.)
 * @returns {Promise<boolean>} - true if command succeeded, false otherwise
 */
export async function run(command, args, context) {
  const cmd = commands[command];

  if (!cmd) {
    console.error(`Unknown command: ${command}`);
    console.error(`Run 'node index.js help' for available commands.`);
    return false;
  }

  try {
    await cmd.handler(args, context);
    return true;
  } catch (error) {
    console.error(`Command failed: ${error.message}`);
    return false;
  }
}

/**
 * Parse process.argv into command and arguments
 *
 * @returns {{ command: string|null, args: string[] }}
 */
export function parse() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    return { command: null, args: [] };
  }

  return {
    command: args[0],
    args: args.slice(1),
  };
}

/**
 * List all registered commands
 *
 * @returns {Array<{name, description, source}>}
 */
export function list() {
  return Object.entries(commands).map(([name, { description, source }]) => ({
    name,
    description,
    source,
  }));
}

/**
 * List core commands only
 */
export function listCore() {
  return list().filter(cmd => cmd.source === 'core');
}

/**
 * List module commands only
 */
export function listModule() {
  return list().filter(cmd => cmd.source !== 'core');
}

/**
 * Check if a command exists
 */
export function has(name) {
  return name in commands;
}

/**
 * Unregister a command by name
 *
 * @param {string} name - Command name to remove
 * @returns {boolean} - true if removed, false if not found
 */
export function unregister(name) {
  if (!(name in commands)) {
    return false;
  }

  delete commands[name];
  coreCommands.delete(name);
  return true;
}

/**
 * Unregister commands by source
 *
 * @param {string} source - Source name (module or plugin name)
 * @returns {number} - Number of commands removed
 *
 * WHY THIS EXISTS:
 * Hot-swap plugins need to remove their CLI commands when deactivated.
 */
export function unregisterBySource(source) {
  let removed = 0;

  for (const [name, cmd] of Object.entries(commands)) {
    if (cmd.source === source) {
      delete commands[name];
      coreCommands.delete(name);
      removed++;
    }
  }

  return removed;
}

// ============================================================
// BUILT-IN COMMANDS
// ============================================================

/**
 * help - Show available commands, grouped by source
 */
register('help', async (args, context) => {
  const coreCmds = listCore();
  const moduleCmds = listModule();

  // Find longest command name for alignment
  const allCmds = [...coreCmds, ...moduleCmds];
  const maxLen = Math.max(...allCmds.map(c => c.name.length));

  // Core commands
  console.log('\nCore commands:');
  for (const { name, description } of coreCmds) {
    const padding = ' '.repeat(maxLen - name.length + 2);
    console.log(`  ${name}${padding}${description}`);
  }

  // Module commands (if any)
  if (moduleCmds.length > 0) {
    console.log('\nModule commands:');
    for (const { name, description } of moduleCmds) {
      const padding = ' '.repeat(maxLen - name.length + 2);
      console.log(`  ${name}${padding}${description}`);
    }
  }

  console.log('');
}, 'Show this help message');

/**
 * modules:list - Show all discovered modules with enabled/disabled status
 */
register('modules:list', async (args, context) => {
  const discovered = context.modules || [];
  const enabled = context.config?.modules?.enabled || [];

  if (discovered.length === 0) {
    console.log('\nNo modules discovered in /modules');
    console.log('Create a module with a manifest.json to get started.\n');
    return;
  }

  console.log('\nModules:');

  for (const mod of discovered) {
    const isEnabled = enabled.includes(mod.name);
    const status = isEnabled ? '✓' : '○';
    const label = isEnabled ? 'enabled' : 'disabled';
    console.log(`  ${status} ${mod.name}@${mod.version} (${label})`);

    if (mod.description) {
      console.log(`      ${mod.description}`);
    }
  }

  console.log('');
}, 'List all discovered modules');

/**
 * modules:enable <name> - Add a module to the enabled list
 */
register('modules:enable', async (args, context) => {
  if (args.length === 0) {
    console.error('Usage: modules:enable <name>');
    console.error('Example: node index.js modules:enable blog');
    throw new Error('Module name required');
  }

  const moduleName = args[0];
  const discovered = context.modules || [];
  const enabled = context.config?.modules?.enabled || [];

  const moduleInfo = discovered.find(m => m.name === moduleName);
  if (!moduleInfo) {
    console.error(`Module "${moduleName}" not found in /modules`);
    console.error('Available modules:');
    for (const mod of discovered) {
      console.error(`  - ${mod.name}`);
    }
    throw new Error('Module not found');
  }

  if (enabled.includes(moduleName)) {
    console.log(`Module "${moduleName}" is already enabled.`);
    return;
  }

  const configPath = join(context.baseDir, 'config', 'modules.json');
  const currentConfig = JSON.parse(readFileSync(configPath, 'utf-8'));

  currentConfig.enabled = currentConfig.enabled || [];
  currentConfig.enabled.push(moduleName);

  writeFileSync(configPath, JSON.stringify(currentConfig, null, 2) + '\n');

  console.log(`Enabled module: ${moduleName}`);
  console.log('Config saved. Restart to activate.');
}, 'Enable a module');

/**
 * modules:disable <name> - Remove a module from the enabled list
 */
register('modules:disable', async (args, context) => {
  if (args.length === 0) {
    console.error('Usage: modules:disable <name>');
    console.error('Example: node index.js modules:disable blog');
    throw new Error('Module name required');
  }

  const moduleName = args[0];
  const enabled = context.config?.modules?.enabled || [];

  if (!enabled.includes(moduleName)) {
    console.log(`Module "${moduleName}" is not enabled.`);
    return;
  }

  const configPath = join(context.baseDir, 'config', 'modules.json');
  const currentConfig = JSON.parse(readFileSync(configPath, 'utf-8'));

  currentConfig.enabled = (currentConfig.enabled || []).filter(
    name => name !== moduleName
  );

  writeFileSync(configPath, JSON.stringify(currentConfig, null, 2) + '\n');

  console.log(`Disabled module: ${moduleName}`);
  console.log('Config saved. Restart to deactivate.');
}, 'Disable a module');

/**
 * config:show - Display current site configuration
 */
register('config:show', async (args, context) => {
  console.log('\nSite Configuration:');
  console.log(JSON.stringify(context.config?.site || {}, null, 2));

  console.log('\nModules Configuration:');
  console.log(JSON.stringify(context.config?.modules || {}, null, 2));

  console.log('');
}, 'Show site configuration');

/**
 * watcher:log [n] - Show recent watcher log entries
 */
register('watcher:log', async (args, context) => {
  const logPath = join(context.baseDir, 'logs', 'watcher.log');

  if (!existsSync(logPath)) {
    console.log('\nNo watcher log file found.');
    console.log('The watcher creates logs/watcher.log when running in server mode.\n');
    return;
  }

  const content = readFileSync(logPath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  if (lines.length === 0) {
    console.log('\nWatcher log is empty.');
    console.log('Events will appear here as files change.\n');
    return;
  }

  const count = parseInt(args[0], 10) || 10;
  const recent = lines.slice(-count);

  console.log(`\nLast ${recent.length} watcher log entries:`);

  for (const line of recent) {
    console.log(`  ${line.replace('[watcher] ', '')}`);
  }

  console.log('');
}, 'Show last n watcher log entries');

/**
 * modules:deps - Show module dependency tree
 */
register('modules:deps', async (args, context) => {
  const discovered = context.modules || [];
  const enabled = context.config?.modules?.enabled || [];

  if (discovered.length === 0) {
    console.log('\nNo modules discovered in /modules');
    console.log('Create a module with a manifest.json to get started.\n');
    return;
  }

  // Filter to enabled modules for the tree
  const enabledModules = discovered.filter(m => enabled.includes(m.name));

  // Also show all discovered modules
  console.log('\n' + dependencies.formatDependencyTree(enabledModules));

  // Check for circular dependencies
  const cycles = dependencies.detectCircular(enabledModules);
  if (cycles.length > 0) {
    console.log('\n⚠ Circular dependencies detected:');
    for (const cycle of cycles) {
      console.log(`  ${cycle.join(' → ')}`);
    }
  }

  // Check for missing dependencies
  const validation = dependencies.validateDependencies(discovered, enabled);
  if (!validation.valid) {
    console.log('\n⚠ Missing dependencies:');
    for (const err of validation.errors) {
      console.log(`  ${err.module} requires ${err.missing} (${err.reason})`);
    }
  }

  console.log('');
}, 'Show module dependency tree');

// ============================================================
// QUEUE COMMANDS
// ============================================================

/**
 * queue:list - List jobs in the queue
 */
register('queue:list', async (args, context) => {
  const queue = context.services.get('queue');

  // Parse --status flag
  const statusArg = args.find(a => a.startsWith('--status='));
  const status = statusArg ? statusArg.split('=')[1] : null;

  const jobs = queue.listJobs(status);

  if (jobs.length === 0) {
    console.log(`\nNo ${status || ''} jobs in queue.\n`);
    return;
  }

  console.log(`\nQueue jobs${status ? ` (${status})` : ''}:`);

  for (const job of jobs) {
    const progress = job.progress.total
      ? ` (${job.progress.completed}/${job.progress.total})`
      : '';
    const age = queue.formatRelativeTime(job.createdAt);

    console.log(`  ${job.id} [${job.status}] ${job.type}${progress} - ${age}`);

    if (job.error) {
      console.log(`    Error: ${job.error}`);
    }
  }

  console.log('');
}, 'List queue jobs (--status=pending|running|completed|failed)');

/**
 * queue:run - Process pending jobs manually
 */
register('queue:run', async (args, context) => {
  const queue = context.services.get('queue');

  // Parse --limit flag
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 10;

  // Register built-in handlers if not already done
  queue.registerBuiltinHandlers(context);

  console.log(`\nProcessing up to ${limit} jobs...`);

  const results = await queue.processQueue(limit);

  if (results.length === 0) {
    console.log('No pending jobs to process.\n');
    return;
  }

  for (const job of results) {
    const status = job.status === 'completed' ? '✓' : '✗';
    console.log(`  ${status} ${job.id} - ${job.type}`);

    if (job.result) {
      console.log(`    Result: ${job.result.success} success, ${job.result.failed} failed`);
    }

    if (job.error) {
      console.log(`    Error: ${job.error}`);
    }
  }

  console.log('');
}, 'Process pending queue jobs (--limit=10)');

/**
 * queue:status - Show job status and progress
 */
register('queue:status', async (args, context) => {
  const queue = context.services.get('queue');

  if (args.length === 0) {
    console.error('Usage: queue:status <job_id>');
    throw new Error('Job ID required');
  }

  const jobId = args[0];
  const job = queue.getJob(jobId);

  if (!job) {
    console.error(`Job not found: ${jobId}`);
    throw new Error('Job not found');
  }

  console.log(`\nJob: ${job.id}`);
  console.log(`  Type: ${job.type}`);
  console.log(`  Status: ${job.status}`);
  console.log(`  Priority: ${job.priority}`);

  if (job.progress.total > 0) {
    const percent = Math.round((job.progress.completed / job.progress.total) * 100);
    console.log(`  Progress: ${job.progress.completed}/${job.progress.total} (${percent}%)`);

    if (job.progress.failed > 0) {
      console.log(`  Failed items: ${job.progress.failed}`);
    }
  }

  console.log(`  Created: ${queue.formatRelativeTime(job.createdAt)}`);

  if (job.startedAt) {
    console.log(`  Started: ${queue.formatRelativeTime(job.startedAt)}`);
  }

  if (job.completedAt) {
    console.log(`  Completed: ${queue.formatRelativeTime(job.completedAt)}`);

    if (job.startedAt) {
      const duration = new Date(job.completedAt) - new Date(job.startedAt);
      console.log(`  Duration: ${queue.formatDuration(duration)}`);
    }
  }

  if (job.error) {
    console.log(`  Error: ${job.error}`);
  }

  if (job.result && job.result.errors && job.result.errors.length > 0) {
    console.log(`  Errors:`);
    for (const err of job.result.errors.slice(0, 5)) {
      console.log(`    - ${err.id}: ${err.error}`);
    }
    if (job.result.errors.length > 5) {
      console.log(`    ... and ${job.result.errors.length - 5} more`);
    }
  }

  console.log('');
}, 'Show job status and progress');

/**
 * queue:cancel - Cancel a pending job
 */
register('queue:cancel', async (args, context) => {
  const queue = context.services.get('queue');

  if (args.length === 0) {
    console.error('Usage: queue:cancel <job_id>');
    throw new Error('Job ID required');
  }

  const jobId = args[0];
  const success = queue.cancelJob(jobId);

  if (success) {
    console.log(`Job ${jobId} cancelled.`);
  } else {
    console.error(`Could not cancel job ${jobId} (not pending or not found)`);
    throw new Error('Cancel failed');
  }
}, 'Cancel a pending job');

/**
 * queue:retry - Retry a failed job
 */
register('queue:retry', async (args, context) => {
  const queue = context.services.get('queue');

  if (args.length === 0) {
    console.error('Usage: queue:retry <job_id>');
    throw new Error('Job ID required');
  }

  const jobId = args[0];
  const job = queue.retryJob(jobId);

  if (job) {
    console.log(`Job ${jobId} queued for retry (attempt ${job.retries + 1}).`);
  } else {
    console.error(`Could not retry job ${jobId} (not failed or not found)`);
    throw new Error('Retry failed');
  }
}, 'Retry a failed job');

/**
 * queue:clear - Clear jobs by status
 */
register('queue:clear', async (args, context) => {
  const queue = context.services.get('queue');

  // Parse --status flag
  const statusArg = args.find(a => a.startsWith('--status='));
  const status = statusArg ? statusArg.split('=')[1] : 'completed';

  const cleared = queue.clearJobs(status);

  console.log(`Cleared ${cleared} ${status} job(s).`);
}, 'Clear jobs (--status=completed|failed|cancelled)');

/**
 * queue:stats - Show queue statistics
 */
register('queue:stats', async (args, context) => {
  const queue = context.services.get('queue');
  const stats = queue.getStats();

  console.log('\nQueue Statistics:');
  console.log(`  Total jobs: ${stats.total}`);
  console.log(`  Pending: ${stats.pending}`);
  console.log(`  Running: ${stats.running} (${stats.runningCount} active)`);
  console.log(`  Completed: ${stats.completed}`);
  console.log(`  Failed: ${stats.failed}`);

  if (Object.keys(stats.byType).length > 0) {
    console.log('\n  By type:');
    for (const [type, count] of Object.entries(stats.byType)) {
      console.log(`    ${type}: ${count}`);
    }
  }

  if (stats.avgDuration > 0) {
    console.log(`\n  Average duration: ${queue.formatDuration(stats.avgDuration)}`);
  }

  console.log(`\n  Auto-processing: ${stats.isProcessing ? 'running' : 'stopped'}`);
  console.log(`  Concurrency: ${stats.concurrency}`);
  console.log('');
}, 'Show queue statistics');

// ============================================================
// BULK OPERATIONS COMMANDS
// ============================================================

/**
 * bulk:publish - Bulk publish content items
 */
register('bulk:publish', async (args, context) => {
  const content = context.services.get('content');
  const queue = context.services.get('queue');

  if (args.length < 2) {
    console.error('Usage: bulk:publish <type> <id,id,id> [--async]');
    throw new Error('Type and IDs required');
  }

  const type = args[0];
  const ids = args[1].split(',').map(id => id.trim()).filter(Boolean);
  const useAsync = args.includes('--async');

  if (ids.length === 0) {
    console.error('No IDs provided');
    throw new Error('IDs required');
  }

  if (useAsync || ids.length > 10) {
    // Use queue for large batches or explicit async
    const job = queue.addJob('bulk:publish', {
      contentType: type,
      ids,
    });

    console.log(`Created job: ${job.id}`);
    console.log(`Processing ${ids.length} items in background...`);
    console.log(`Use 'queue:status ${job.id}' to check progress`);
    return;
  }

  // Process synchronously for small batches
  console.log(`\nPublishing ${ids.length} ${type} item(s)...`);

  const results = await content.bulkPublish(type, ids);

  for (const item of results.items || []) {
    console.log(`  ✓ ${item.id} published`);
  }

  for (const err of results.errors || []) {
    console.log(`  ✗ ${err.id}: ${err.error}`);
  }

  console.log(`\nCompleted: ${results.success} success, ${results.failed} failed\n`);
}, 'Bulk publish content items');

/**
 * bulk:unpublish - Bulk unpublish content items
 */
register('bulk:unpublish', async (args, context) => {
  const content = context.services.get('content');
  const queue = context.services.get('queue');

  if (args.length < 2) {
    console.error('Usage: bulk:unpublish <type> <id,id,id> [--async]');
    throw new Error('Type and IDs required');
  }

  const type = args[0];
  const ids = args[1].split(',').map(id => id.trim()).filter(Boolean);
  const useAsync = args.includes('--async');

  if (ids.length === 0) {
    console.error('No IDs provided');
    throw new Error('IDs required');
  }

  if (useAsync || ids.length > 10) {
    const job = queue.addJob('bulk:unpublish', {
      contentType: type,
      ids,
    });

    console.log(`Created job: ${job.id}`);
    console.log(`Processing ${ids.length} items in background...`);
    console.log(`Use 'queue:status ${job.id}' to check progress`);
    return;
  }

  console.log(`\nUnpublishing ${ids.length} ${type} item(s)...`);

  const results = await content.bulkUnpublish(type, ids);

  for (const item of results.items || []) {
    console.log(`  ✓ ${item.id} unpublished`);
  }

  for (const err of results.errors || []) {
    console.log(`  ✗ ${err.id}: ${err.error}`);
  }

  console.log(`\nCompleted: ${results.success} success, ${results.failed} failed\n`);
}, 'Bulk unpublish content items');

/**
 * bulk:delete - Bulk delete content items
 */
register('bulk:delete', async (args, context) => {
  const content = context.services.get('content');
  const queue = context.services.get('queue');

  if (args.length < 2) {
    console.error('Usage: bulk:delete <type> <id,id,id> [--permanent] [--async]');
    throw new Error('Type and IDs required');
  }

  const type = args[0];
  const ids = args[1].split(',').map(id => id.trim()).filter(Boolean);
  const permanent = args.includes('--permanent');
  const useAsync = args.includes('--async');

  if (ids.length === 0) {
    console.error('No IDs provided');
    throw new Error('IDs required');
  }

  if (useAsync || ids.length > 10) {
    const job = queue.addJob('bulk:delete', {
      contentType: type,
      ids,
      permanent,
    });

    console.log(`Created job: ${job.id}`);
    console.log(`Deleting ${ids.length} items in background...`);
    console.log(`Use 'queue:status ${job.id}' to check progress`);
    return;
  }

  console.log(`\nDeleting ${ids.length} ${type} item(s)${permanent ? ' permanently' : ''}...`);

  const results = await content.bulkDelete(type, ids, { permanent });

  console.log(`Completed: ${results.success} deleted, ${results.failed} failed`);

  for (const err of results.errors || []) {
    console.log(`  ✗ ${err.id}: ${err.error}`);
  }

  console.log('');
}, 'Bulk delete content items (--permanent to skip trash)');

/**
 * bulk:update - Bulk update content items
 */
register('bulk:update', async (args, context) => {
  const content = context.services.get('content');
  const queue = context.services.get('queue');

  if (args.length < 2) {
    console.error('Usage: bulk:update <type> <id,id,id> --field.name=value [--async]');
    throw new Error('Type, IDs, and field values required');
  }

  const type = args[0];
  const ids = args[1].split(',').map(id => id.trim()).filter(Boolean);
  const useAsync = args.includes('--async');

  // Parse field updates from --field.name=value arguments
  const data = {};
  for (const arg of args.slice(2)) {
    if (arg.startsWith('--field.')) {
      const match = arg.match(/^--field\.([^=]+)=(.*)$/);
      if (match) {
        const [, field, value] = match;
        // Try to parse as JSON, fall back to string
        try {
          data[field] = JSON.parse(value);
        } catch {
          data[field] = value;
        }
      }
    }
  }

  if (ids.length === 0) {
    console.error('No IDs provided');
    throw new Error('IDs required');
  }

  if (Object.keys(data).length === 0) {
    console.error('No field updates provided. Use --field.name=value');
    throw new Error('Field updates required');
  }

  if (useAsync || ids.length > 10) {
    const job = queue.addJob('bulk:update', {
      contentType: type,
      ids,
      data,
    });

    console.log(`Created job: ${job.id}`);
    console.log(`Updating ${ids.length} items in background...`);
    console.log(`Use 'queue:status ${job.id}' to check progress`);
    return;
  }

  console.log(`\nUpdating ${ids.length} ${type} item(s)...`);
  console.log(`  Fields: ${JSON.stringify(data)}`);

  const results = await content.bulkUpdate(type, ids, data);

  console.log(`\nCompleted: ${results.success} updated, ${results.failed} failed`);

  for (const err of results.errors || []) {
    console.log(`  ✗ ${err.id}: ${err.error}`);
  }

  console.log('');
}, 'Bulk update content items (--field.name=value)');

// ============================================================
// OEMBED COMMANDS
// ============================================================

/**
 * oembed:fetch - Fetch and display oEmbed data for a URL
 */
register('oembed:fetch', async (args, context) => {
  const oembed = context.services.get('oembed');

  if (args.length === 0) {
    console.error('Usage: oembed:fetch <url>');
    throw new Error('URL required');
  }

  const url = args[0];
  const skipCache = args.includes('--no-cache');

  console.log(`\nFetching oEmbed data for: ${url}`);

  try {
    const data = await oembed.fetchEmbed(url, { skipCache });

    console.log(`\n  Type: ${data.type}`);
    if (data.title) console.log(`  Title: ${data.title}`);
    if (data.author_name) console.log(`  Author: ${data.author_name}`);
    if (data.provider_name) console.log(`  Provider: ${data.provider_name}`);
    if (data.width && data.height) console.log(`  Dimensions: ${data.width}x${data.height}`);
    if (data.thumbnail_url) console.log(`  Thumbnail: ${data.thumbnail_url}`);
    console.log(`  Cached: ${data.cached ? 'yes' : 'no'}`);
    console.log(`  Fetched: ${data.fetchedAt}`);

    if (data.html) {
      console.log(`\n  HTML preview (first 200 chars):`);
      console.log(`  ${data.html.substring(0, 200)}${data.html.length > 200 ? '...' : ''}`);
    }

    console.log('');
  } catch (error) {
    console.error(`\nError: ${error.message}\n`);
    throw error;
  }
}, 'Fetch oEmbed data for a URL');

/**
 * oembed:providers - List registered oEmbed providers
 */
register('oembed:providers', async (args, context) => {
  const oembed = context.services.get('oembed');
  const providers = oembed.getProviders();

  console.log(`\nRegistered oEmbed providers (${providers.length}):\n`);

  for (const provider of providers) {
    console.log(`  ${provider.name}`);
    console.log(`    Endpoint: ${provider.endpoint}`);
    console.log(`    Patterns: ${provider.patterns.length}`);
  }

  console.log('');
}, 'List registered oEmbed providers');

/**
 * oembed:cache - Show cache statistics
 */
register('oembed:cache', async (args, context) => {
  const oembed = context.services.get('oembed');
  const stats = oembed.getCacheStats();

  console.log('\noEmbed Cache Statistics:');
  console.log(`  Entries: ${stats.entries}`);
  console.log(`  Size: ${stats.sizeFormatted}`);
  if (stats.oldestEntry) {
    console.log(`  Oldest: ${stats.oldestEntry}`);
  }
  if (stats.newestEntry) {
    console.log(`  Newest: ${stats.newestEntry}`);
  }

  const config = oembed.getConfig();
  console.log(`\n  Cache TTL: ${config.cacheTtl}s (${Math.round(config.cacheTtl / 86400)} days)`);
  console.log('');
}, 'Show oEmbed cache statistics');

/**
 * oembed:clear-cache - Clear oEmbed cache
 */
register('oembed:clear-cache', async (args, context) => {
  const oembed = context.services.get('oembed');

  const url = args[0] || null;

  if (url) {
    const cleared = oembed.clearCache(url);
    if (cleared > 0) {
      console.log(`Cleared cache for: ${url}`);
    } else {
      console.log(`No cache entry found for: ${url}`);
    }
  } else {
    const cleared = oembed.clearCache();
    console.log(`Cleared ${cleared} cached embed(s).`);
  }
}, 'Clear oEmbed cache (optionally for specific URL)');

/**
 * oembed:check - Check if URL is supported
 */
register('oembed:check', async (args, context) => {
  const oembed = context.services.get('oembed');

  if (args.length === 0) {
    console.error('Usage: oembed:check <url>');
    throw new Error('URL required');
  }

  const url = args[0];
  const support = oembed.checkSupport(url);

  console.log(`\nURL: ${url}`);
  console.log(`  Supported: ${support.supported ? 'yes' : 'no'}`);
  if (support.provider) {
    console.log(`  Provider: ${support.provider}`);
  } else if (support.discoverable) {
    console.log(`  Discovery: will attempt auto-discovery`);
  }
  console.log('');
}, 'Check if URL is supported by oEmbed');

// ============================================
// FIELDS COMMANDS
// ============================================

register('fields:list', async (args, context) => {
  const fields = context.services.get('fields');
  const types = fields.listFieldTypes();

  console.log(`\nField types (${types.length}):\n`);

  for (const ft of types) {
    const source = ft.source === 'core' ? '' : ` [${ft.source}]`;
    console.log(`  ${ft.name.padEnd(15)} - ${ft.description || ft.label}${source}`);
  }
  console.log('');
}, 'List all registered field types');

register('fields:types', async (args, context) => {
  const fields = context.services.get('fields');
  const types = fields.listFieldTypes();

  // Group by source
  const core = types.filter(t => t.source === 'core');
  const custom = types.filter(t => t.source !== 'core');

  console.log(`\n=== Built-in Field Types (${core.length}) ===\n`);
  for (const ft of core) {
    console.log(`  ${ft.name}`);
    console.log(`    Label: ${ft.label}`);
    console.log(`    Widget: ${ft.widget}`);
    if (ft.description) console.log(`    Description: ${ft.description}`);
    console.log('');
  }

  if (custom.length > 0) {
    console.log(`=== Custom Field Types (${custom.length}) ===\n`);
    for (const ft of custom) {
      console.log(`  ${ft.name} [${ft.source}]`);
      console.log(`    Label: ${ft.label}`);
      console.log(`    Widget: ${ft.widget}`);
      if (ft.description) console.log(`    Description: ${ft.description}`);
      console.log('');
    }
  }
}, 'Show detailed field type information');

register('fields:info', async (args, context) => {
  const fields = context.services.get('fields');

  if (args.length === 0) {
    console.error('Usage: fields:info <type>');
    throw new Error('Field type name required');
  }

  const typeName = args[0];
  const ft = fields.getFieldType(typeName);

  if (!ft) {
    console.error(`Field type "${typeName}" not found`);
    throw new Error('Unknown field type');
  }

  console.log(`\nField Type: ${ft.name}\n`);
  console.log(`  Label: ${ft.label}`);
  console.log(`  Widget: ${ft.widget}`);
  console.log(`  Source: ${ft.source}`);
  console.log(`  Default: ${JSON.stringify(ft.defaultValue)}`);
  if (ft.description) console.log(`  Description: ${ft.description}`);
  console.log('');
}, 'Show info about a specific field type');

// ============================================
// VALIDATION COMMANDS
// ============================================

register('validators:list', async (args, context) => {
  const validation = context.services.get('validation');
  const validators = validation.listValidators();

  console.log(`\nValidators (${validators.length}):\n`);

  for (const v of validators) {
    const asyncMark = v.async ? ' [async]' : '';
    const source = v.source === 'core' ? '' : ` [${v.source}]`;
    console.log(`  ${v.name.padEnd(15)} - ${v.description || 'No description'}${asyncMark}${source}`);
  }
  console.log('');
}, 'List all registered validators');

register('validate:content', async (args, context) => {
  const validation = context.services.get('validation');
  const content = context.services.get('content');

  if (args.length < 2) {
    console.error('Usage: validate:content <type> <id>');
    throw new Error('Type and ID required');
  }

  const [type, id] = args;

  // Get schema
  const schema = content.getSchema(type);
  if (!schema) {
    console.error(`Unknown content type: ${type}`);
    throw new Error('Unknown content type');
  }

  console.log(`\nValidating ${type}/${id}...`);

  const result = await validation.validateContent(type, id, schema);

  if (result.valid) {
    console.log('  ✓ Valid\n');
  } else {
    console.log(`  ✗ ${result.errors.length} error(s):`);
    for (const err of result.errors) {
      console.log(`    - ${err.field}: ${err.message}`);
    }
    console.log('');
  }
}, 'Validate existing content item');

register('validate:type', async (args, context) => {
  const validation = context.services.get('validation');
  const content = context.services.get('content');

  if (args.length < 1) {
    console.error('Usage: validate:type <type>');
    throw new Error('Type required');
  }

  const type = args[0];

  // Get schema
  const schema = content.getSchema(type);
  if (!schema) {
    console.error(`Unknown content type: ${type}`);
    throw new Error('Unknown content type');
  }

  // Use listAll to get all items
  const items = content.listAll ? content.listAll(type) : (content.list(type)?.items || []);
  console.log(`\nValidating ${items.length} ${type}(s)...\n`);

  const result = await validation.validateType(type, schema);

  for (const item of items) {
    const itemErrors = result.errors[item.id];
    if (itemErrors) {
      console.log(`  ✗ ${item.id} - ${itemErrors.length} error(s):`);
      for (const err of itemErrors) {
        console.log(`      - ${err.field}: ${err.message}`);
      }
    } else {
      console.log(`  ✓ ${item.id} - valid`);
    }
  }

  console.log(`\nSummary: ${result.valid} valid, ${result.invalid} invalid\n`);
}, 'Validate all content of a type');

register('validate:all', async (args, context) => {
  const validation = context.services.get('validation');
  const content = context.services.get('content');

  const typeInfos = content.listTypes();
  let totalValid = 0;
  let totalInvalid = 0;
  const allErrors = {};

  console.log(`\nValidating all content...\n`);

  for (const typeInfo of typeInfos) {
    const type = typeInfo.type;
    const schema = typeInfo.schema;
    if (!schema) continue;

    // Use listAll to get all items
    const items = content.listAll ? content.listAll(type) : (content.list(type)?.items || []);
    if (items.length === 0) continue;

    const result = await validation.validateType(type, schema);
    totalValid += result.valid;
    totalInvalid += result.invalid;

    if (result.invalid > 0) {
      allErrors[type] = result.errors;
    }

    const status = result.invalid > 0 ? `✗ ${result.invalid} invalid` : '✓ all valid';
    console.log(`  ${type}: ${items.length} item(s) - ${status}`);
  }

  if (totalInvalid > 0) {
    console.log(`\nErrors by type:`);
    for (const [type, errors] of Object.entries(allErrors)) {
      console.log(`\n  ${type}:`);
      for (const [id, itemErrors] of Object.entries(errors)) {
        console.log(`    ${id}:`);
        for (const err of itemErrors) {
          console.log(`      - ${err.field}: ${err.message}`);
        }
      }
    }
  }

  console.log(`\nTotal: ${totalValid} valid, ${totalInvalid} invalid\n`);
}, 'Validate all content');

register('validate:rules', async (args, context) => {
  const validation = context.services.get('validation');
  const content = context.services.get('content');

  if (args.length < 1) {
    console.error('Usage: validate:rules <type>');
    throw new Error('Type required');
  }

  const type = args[0];
  const schema = content.getSchema(type);

  if (!schema) {
    console.error(`Unknown content type: ${type}`);
    throw new Error('Unknown content type');
  }

  const summary = validation.getRulesSummary(schema);

  console.log(`\nValidation rules for ${type}:\n`);

  if (Object.keys(summary).length === 0) {
    console.log('  No validation rules defined\n');
    return;
  }

  for (const [field, rules] of Object.entries(summary)) {
    console.log(`  ${field}: ${rules.join(', ')}`);
  }
  console.log('');
}, 'Show validation rules for a content type');

// ============================================
// PREVIEW COMMANDS
// ============================================

register('preview:create', async (args, context) => {
  const preview = context.services.get('preview');

  if (args.length < 2) {
    console.error('Usage: preview:create <type> <id> [--expires=7d] [--max-views=N] [--password=X]');
    throw new Error('Type and ID required');
  }

  const [type, id] = args;
  const options = {};

  // Parse options
  for (const arg of args.slice(2)) {
    if (arg.startsWith('--expires=')) {
      options.expiresIn = arg.split('=')[1];
    } else if (arg.startsWith('--max-views=')) {
      options.maxViews = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--password=')) {
      options.password = arg.split('=')[1];
    }
  }

  const token = preview.createPreviewToken(type, id, options);

  console.log(`\nCreated preview token for ${type}/${id}`);
  console.log(`  Token: ${token.token}`);
  console.log(`  URL: ${token.url}`);
  console.log(`  Expires: ${token.expiresAt}`);
  if (token.maxViews) console.log(`  Max views: ${token.maxViews}`);
  if (token.hasPassword) console.log(`  Password protected: yes`);
  console.log('');
}, 'Create a preview token for content');

register('preview:list', async (args, context) => {
  const preview = context.services.get('preview');

  const type = args[0] || null;
  const id = args[1] || null;

  const tokens = preview.listPreviewTokens(type, id);

  if (tokens.length === 0) {
    console.log('\nNo active preview tokens\n');
    return;
  }

  console.log(`\nActive preview tokens (${tokens.length}):\n`);

  for (const token of tokens) {
    const expiry = token.expired ? 'EXPIRED' : `expires in ${preview.formatDuration(token.expiresIn)}`;
    const views = token.maxViews ? `${token.views}/${token.maxViews} views` : `${token.views} views`;
    const password = token.hasPassword ? ' [password]' : '';

    console.log(`  ${token.token}`);
    console.log(`    ${token.type}/${token.id} - ${expiry} (${views})${password}`);
    console.log(`    URL: ${token.url}`);
    console.log('');
  }
}, 'List active preview tokens');

register('preview:revoke', async (args, context) => {
  const preview = context.services.get('preview');

  if (args.length < 1) {
    console.error('Usage: preview:revoke <token>');
    throw new Error('Token required');
  }

  const token = args[0];
  const success = preview.revokePreviewToken(token);

  if (success) {
    console.log(`\nRevoked preview token ${token}\n`);
  } else {
    console.error(`\nToken not found: ${token}\n`);
    throw new Error('Token not found');
  }
}, 'Revoke a preview token');

register('preview:cleanup', async (args, context) => {
  const preview = context.services.get('preview');

  const removed = preview.cleanupExpiredTokens();

  console.log(`\nCleaned up ${removed} expired token(s)\n`);
}, 'Remove expired preview tokens');

register('preview:url', async (args, context) => {
  const preview = context.services.get('preview');

  if (args.length < 2) {
    console.error('Usage: preview:url <type> <id> [--expires=7d]');
    throw new Error('Type and ID required');
  }

  const [type, id] = args;
  const options = {};

  for (const arg of args.slice(2)) {
    if (arg.startsWith('--expires=')) {
      options.expiresIn = arg.split('=')[1];
    }
  }

  const token = preview.createPreviewToken(type, id, options);

  // Output just the URL for scripting
  console.log(token.url);
}, 'Create preview token and output URL');

register('preview:stats', async (args, context) => {
  const preview = context.services.get('preview');

  const stats = preview.getStats();

  console.log('\nPreview token statistics:\n');
  console.log(`  Total tokens: ${stats.total}`);
  console.log(`  Active: ${stats.active}`);
  console.log(`  Expired: ${stats.expired}`);
  console.log(`  Revoked: ${stats.revoked}`);
  console.log(`  Total views: ${stats.totalViews}`);
  console.log('');
}, 'Show preview token statistics');

// ============================================
// EMAIL COMMANDS
// ============================================

register('email:test', async (args, context) => {
  const email = context.services.get('email');

  const to = args[0];
  if (!to) {
    console.error('Usage: email:test <email>');
    return;
  }

  try {
    const result = await email.send(
      to,
      'CMS Test Email',
      '<h1>Test Email</h1><p>This is a test email from the CMS.</p>',
      { html: true }
    );

    console.log('\nTest email sent successfully');
    console.log(`  To: ${to}`);
    console.log(`  Message ID: ${result.messageId || 'N/A'}`);
    console.log('');
  } catch (e) {
    console.error(`Failed to send test email: ${e.message}`);
  }
}, 'Send a test email');

register('email:verify', async (args, context) => {
  const email = context.services.get('email');

  console.log('\nVerifying email configuration...\n');

  try {
    const result = await email.verify();

    if (result.valid) {
      console.log('  Status: OK');
      console.log(`  Transport: ${result.transport}`);
      console.log(`  From: ${result.from}`);
      if (result.message) {
        console.log(`  Message: ${result.message}`);
      }
    } else {
      console.log('  Status: FAILED');
      console.log(`  Transport: ${result.transport}`);
      console.log(`  Error: ${result.error}`);
    }
    console.log('');
  } catch (e) {
    console.error(`Verification failed: ${e.message}`);
  }
}, 'Verify email configuration');

register('email:log', async (args, context) => {
  const email = context.services.get('email');

  const limit = parseInt(args[0]) || 10;
  const log = email.getLog(limit);

  console.log(`\nRecent emails (${log.length}):\n`);

  for (const entry of log) {
    console.log(`  ${entry.timestamp}`);
    console.log(`    To: ${entry.to.join(', ')}`);
    console.log(`    Subject: ${entry.subject}`);
    console.log('');
  }

  if (log.length === 0) {
    console.log('  No emails sent yet');
    console.log('');
  }
}, 'Show recent email log');

register('email:templates', async (args, context) => {
  const email = context.services.get('email');

  const templates = email.listTemplates();

  console.log(`\nEmail templates (${templates.length}):\n`);

  for (const name of templates) {
    console.log(`  - ${name}`);
  }

  if (templates.length === 0) {
    console.log('  No templates found');
    console.log('  Create templates in: templates/email/');
  }
  console.log('');
}, 'List email templates');

// ============================================
// NOTIFICATION COMMANDS
// ============================================

register('notify:send', async (args, context) => {
  const notifications = context.services.get('notifications');

  const userId = args[0];
  const type = args[1] || 'system.alert';
  const title = args[2] || 'Test Notification';
  const message = args[3] || 'This is a test notification.';

  if (!userId) {
    console.error('Usage: notify:send <userId> [type] [title] [message]');
    console.error('');
    console.error('Types: content.published, content.commented, workflow.pending, system.alert, etc.');
    return;
  }

  try {
    const result = await notifications.send(userId, {
      type,
      title,
      message
    });

    if (result) {
      console.log('\nNotification sent:');
      console.log(`  ID: ${result.id}`);
      console.log(`  User: ${result.userId}`);
      console.log(`  Type: ${result.type}`);
      console.log(`  Channels: ${result.channels.join(', ')}`);
      console.log('');
    } else {
      console.log('Notifications are disabled');
    }
  } catch (e) {
    console.error(`Failed to send notification: ${e.message}`);
  }
}, 'Send a notification to a user');

register('notify:list', async (args, context) => {
  const notifications = context.services.get('notifications');

  const userId = args[0];
  if (!userId) {
    console.error('Usage: notify:list <userId> [--unread]');
    return;
  }

  const unreadOnly = args.includes('--unread');
  const result = notifications.getForUser(userId, { unreadOnly, limit: 20 });

  console.log(`\nNotifications for ${userId} (${result.unread} unread / ${result.total} total):\n`);

  for (const n of result.items) {
    const status = n.read ? '✓' : '●';
    console.log(`  ${status} [${n.type}] ${n.title}`);
    console.log(`    ${n.message}`);
    console.log(`    ${n.createdAt}`);
    console.log('');
  }

  if (result.items.length === 0) {
    console.log('  No notifications');
    console.log('');
  }
}, 'List notifications for a user');

register('notify:read', async (args, context) => {
  const notifications = context.services.get('notifications');

  const target = args[0];
  if (!target) {
    console.error('Usage: notify:read <notificationId | --all userId>');
    return;
  }

  if (target === '--all') {
    const userId = args[1];
    if (!userId) {
      console.error('Usage: notify:read --all <userId>');
      return;
    }
    const count = notifications.markAllRead(userId);
    console.log(`Marked ${count} notification(s) as read`);
  } else {
    const success = notifications.markRead(target);
    if (success) {
      console.log('Notification marked as read');
    } else {
      console.log('Notification not found');
    }
  }
}, 'Mark notification(s) as read');

register('notify:stats', async (args, context) => {
  const notifications = context.services.get('notifications');

  const stats = notifications.getStats();

  console.log('\nNotification statistics:\n');
  console.log(`  Total: ${stats.total}`);
  console.log(`  Unread: ${stats.unread}`);
  console.log(`  Read: ${stats.read}`);
  console.log(`  Users with notifications: ${stats.userCount}`);
  console.log('');

  if (Object.keys(stats.byType).length > 0) {
    console.log('  By type:');
    for (const [type, count] of Object.entries(stats.byType)) {
      console.log(`    ${type}: ${count}`);
    }
    console.log('');
  }

  if (stats.topUsers.length > 0) {
    console.log('  Top users:');
    for (const { userId, count } of stats.topUsers) {
      console.log(`    ${userId}: ${count}`);
    }
    console.log('');
  }
}, 'Show notification statistics');

register('notify:types', async (args, context) => {
  const notifications = context.services.get('notifications');

  const types = notifications.getNotificationTypes();
  const defaults = notifications.getDefaultPreferences();

  console.log('\nNotification types:\n');

  for (const type of types) {
    const prefs = defaults[type] || {};
    const channels = [];
    if (prefs.app) channels.push('app');
    if (prefs.email) channels.push('email');

    console.log(`  ${type}`);
    console.log(`    Default channels: ${channels.join(', ') || 'none'}`);
    console.log('');
  }
}, 'List notification types and default channels');

register('notify:prefs', async (args, context) => {
  const notifications = context.services.get('notifications');

  const userId = args[0];
  if (!userId) {
    console.error('Usage: notify:prefs <userId> [type] [channel] [on|off]');
    return;
  }

  // If just userId, show preferences
  if (args.length === 1) {
    const prefs = notifications.getUserPreferences(userId);

    console.log(`\nNotification preferences for ${userId}:\n`);

    for (const [type, channels] of Object.entries(prefs)) {
      const enabled = [];
      for (const [channel, on] of Object.entries(channels)) {
        if (on) enabled.push(channel);
      }
      console.log(`  ${type}: ${enabled.join(', ') || 'none'}`);
    }
    console.log('');
    return;
  }

  // Set a preference
  const type = args[1];
  const channel = args[2];
  const value = args[3];

  if (!type || !channel || !value) {
    console.error('Usage: notify:prefs <userId> <type> <channel> <on|off>');
    return;
  }

  const enabled = value === 'on' || value === 'true' || value === '1';
  notifications.setPreference(userId, type, channel, enabled);

  console.log(`Set ${userId} ${type} ${channel} = ${enabled ? 'on' : 'off'}`);
}, 'View or set user notification preferences');

// ============================================
// BACKUP COMMANDS
// ============================================

register('backup:create', async (args, context) => {
  const backup = context.services.get('backup');

  const isIncremental = args.includes('--incremental') || args.includes('-i');
  const type = isIncremental ? 'incremental' : 'full';

  console.log(`\nCreating ${type} backup...`);

  try {
    const result = await backup.createBackup({ type });

    console.log(`  Content: ${result.itemCount} items`);
    for (const [contentType, count] of Object.entries(result.manifest.content)) {
      console.log(`    - ${contentType}: ${count}`);
    }
    console.log(`  Config: ${result.manifest.config.length} files`);
    console.log(`  Media: ${result.manifest.media} files`);
    console.log(`  Plugins: ${result.manifest.plugins} configs`);
    console.log('');
    console.log(`Backup created: ${result.id}`);
    console.log(`  Size: ${backup.formatSize(result.size)}`);
    console.log(`  Checksum: ${result.checksum}`);
    if (result.parent) {
      console.log(`  Parent: ${result.parent}`);
    }
    console.log('');
  } catch (e) {
    console.error(`Backup failed: ${e.message}`);
  }
}, 'Create a backup (--incremental for incremental)');

register('backup:list', async (args, context) => {
  const backupService = context.services.get('backup');

  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 10;

  const backups = backupService.listBackups().slice(0, limit);

  console.log(`\nBackups (${backups.length}):\n`);

  for (const b of backups) {
    const typeLabel = b.type === 'full' ? '[full]' : '[incr]';
    const size = backupService.formatSize(b.size);
    const age = backupService.formatRelativeTime(b.created);
    const parent = b.parent ? ` (parent: ${b.parent})` : '';

    console.log(`  ${b.id} ${typeLabel} - ${size} - ${age}${parent}`);
  }

  if (backups.length === 0) {
    console.log('  No backups found');
    console.log('  Create one with: backup:create');
  }
  console.log('');
}, 'List backups (--limit=N)');

register('backup:info', async (args, context) => {
  const backupService = context.services.get('backup');

  const backupId = args[0];
  if (!backupId) {
    console.error('Usage: backup:info <backupId>');
    return;
  }

  const b = backupService.getBackup(backupId);
  if (!b) {
    console.error(`Backup not found: ${backupId}`);
    return;
  }

  console.log(`\nBackup: ${b.id}\n`);
  console.log(`  Type: ${b.type}`);
  console.log(`  Created: ${b.created}`);
  console.log(`  Size: ${backupService.formatSize(b.size)}`);
  console.log(`  Checksum: ${b.checksum}`);
  if (b.parent) {
    console.log(`  Parent: ${b.parent}`);
  }
  console.log('');
  console.log('  Manifest:');
  console.log(`    Content items: ${b.itemCount}`);
  for (const [type, count] of Object.entries(b.manifest.content)) {
    console.log(`      - ${type}: ${count}`);
  }
  console.log(`    Config files: ${b.manifest.config.length}`);
  for (const file of b.manifest.config) {
    console.log(`      - ${file}`);
  }
  console.log(`    Media files: ${b.manifest.media}`);
  console.log(`    Plugin configs: ${b.manifest.plugins}`);
  console.log('');
}, 'Show backup details');

register('backup:verify', async (args, context) => {
  const backupService = context.services.get('backup');

  const backupId = args[0];
  if (!backupId) {
    console.error('Usage: backup:verify <backupId>');
    return;
  }

  console.log(`\nVerifying backup ${backupId}...\n`);

  const result = backupService.verifyBackup(backupId);

  if (result.error) {
    console.error(`  Error: ${result.error}`);
    return;
  }

  const check = (valid) => valid ? '\u2713' : '\u2717';

  console.log(`  ${check(result.manifest.valid)} Manifest valid`);
  console.log(`  ${check(result.content.valid)} Content checksum valid (${result.content.count} items)`);
  console.log(`  ${check(result.config.valid)} Config files present (${result.config.count})`);
  console.log(`  ${check(result.media.valid)} Media files valid (${result.media.count})`);
  console.log('');

  if (result.valid) {
    console.log('Backup verified successfully.');
  } else {
    console.log('Backup verification FAILED:');
    for (const error of result.errors) {
      console.log(`  - ${error}`);
    }
  }
  console.log('');
}, 'Verify backup integrity');

register('backup:restore', async (args, context) => {
  const backupService = context.services.get('backup');

  const backupId = args[0];
  if (!backupId) {
    console.error('Usage: backup:restore <backupId> [--dry-run] [--content-only]');
    return;
  }

  const dryRun = args.includes('--dry-run');
  const contentOnly = args.includes('--content-only');

  if (dryRun) {
    console.log('\nDry run - no changes will be made\n');
  } else {
    console.log(`\nRestoring from backup ${backupId}...\n`);
  }

  try {
    const result = await backupService.restoreBackup(backupId, { dryRun, contentOnly });

    const verb = dryRun ? 'Would restore' : 'Restored';

    console.log(`${verb}:`);
    console.log(`  Content: ${result.content.total} items`);
    console.log(`    - ${result.content.unchanged} unchanged`);
    console.log(`    - ${result.content.updated} updated`);
    console.log(`    - ${result.content.created} created`);
    if (result.content.deleted > 0) {
      console.log(`    - ${result.content.deleted} deleted`);
    }

    if (!contentOnly) {
      console.log(`  Config: ${result.config.total} files (${result.config.changed} changed)`);
      console.log(`  Media: ${result.media.total} files`);
      console.log(`    - ${result.media.unchanged} unchanged`);
      console.log(`    - ${result.media.created} new`);
    }
    console.log('');

    if (!dryRun) {
      console.log('Restore completed successfully.');
      console.log('Note: Restart the server to apply config changes.');
      console.log('');
    }
  } catch (e) {
    console.error(`Restore failed: ${e.message}`);
  }
}, 'Restore from backup (--dry-run, --content-only)');

register('backup:delete', async (args, context) => {
  const backupService = context.services.get('backup');

  const backupId = args[0];
  if (!backupId) {
    console.error('Usage: backup:delete <backupId>');
    return;
  }

  try {
    const success = backupService.deleteBackup(backupId);
    if (success) {
      console.log(`Deleted backup: ${backupId}`);
    } else {
      console.log(`Backup not found: ${backupId}`);
    }
  } catch (e) {
    console.error(`Delete failed: ${e.message}`);
  }
}, 'Delete a backup');

register('backup:prune', async (args, context) => {
  const backupService = context.services.get('backup');

  const dryRun = args.includes('--dry-run');

  if (dryRun) {
    console.log('\nDry run - no backups will be deleted\n');
  } else {
    console.log('\nApplying retention policy...\n');
  }

  const result = backupService.pruneBackups({ dryRun });

  const verb = dryRun ? 'Would delete' : 'Deleted';

  console.log(`Kept: ${result.kept.length} backups`);
  console.log(`${verb}: ${result.deleted.length} backups`);

  if (result.deleted.length > 0) {
    console.log('');
    for (const id of result.deleted) {
      console.log(`  - ${id}`);
    }
  }
  console.log('');
}, 'Apply retention policy (--dry-run)');

register('backup:stats', async (args, context) => {
  const backupService = context.services.get('backup');

  const stats = backupService.getStats();

  console.log('\nBackup statistics:\n');
  console.log(`  Total backups: ${stats.total}`);
  console.log(`    - Full: ${stats.full}`);
  console.log(`    - Incremental: ${stats.incremental}`);
  console.log(`  Total size: ${backupService.formatSize(stats.totalSize)}`);
  console.log('');

  if (stats.oldestBackup) {
    console.log(`  Oldest backup: ${backupService.formatRelativeTime(stats.oldestBackup)}`);
  }
  if (stats.newestBackup) {
    console.log(`  Newest backup: ${backupService.formatRelativeTime(stats.newestBackup)}`);
  }
  if (stats.nextScheduled) {
    console.log(`  Next scheduled: ${stats.nextScheduled}`);
  }
  console.log('');

  console.log('  Retention policy:');
  console.log(`    - Daily: ${stats.retention.daily}`);
  console.log(`    - Weekly: ${stats.retention.weekly}`);
  console.log(`    - Monthly: ${stats.retention.monthly}`);
  console.log('');
}, 'Show backup statistics');

// ============================================
// ANALYTICS COMMANDS
// ============================================

register('analytics:summary', async (args, context) => {
  const analytics = context.services.get('analytics');

  const periodArg = args.find(a => a.startsWith('--period='));
  const period = periodArg ? periodArg.split('=')[1] : 'week';

  const summary = analytics.getSummary(period);

  const periodLabel = period === 'day' ? '24 hours' : period === 'week' ? '7 days' : '30 days';

  console.log(`\nAnalytics Summary (last ${periodLabel}):\n`);
  console.log(`  Page views: ${analytics.formatNumber(summary.pageViews)}`);
  console.log(`  Unique visitors: ${analytics.formatNumber(summary.uniqueVisitors)}`);
  console.log(`  Content views: ${analytics.formatNumber(summary.contentViews)}`);
  console.log(`  API requests: ${analytics.formatNumber(summary.apiRequests)}`);
  console.log(`  Content created: ${analytics.formatNumber(summary.contentCreated)}`);
  console.log(`  Content updated: ${analytics.formatNumber(summary.contentUpdated)}`);
  console.log(`  User logins: ${analytics.formatNumber(summary.logins)}`);
  console.log(`  Searches: ${analytics.formatNumber(summary.searches)}`);
  console.log('');
}, 'Show analytics summary (--period=day|week|month)');

register('analytics:content', async (args, context) => {
  const analytics = context.services.get('analytics');

  const type = args.find(a => !a.startsWith('--'));
  const topArg = args.find(a => a.startsWith('--top='));
  const limit = topArg ? parseInt(topArg.split('=')[1]) : 10;

  const daysArg = args.find(a => a.startsWith('--days='));
  const days = daysArg ? parseInt(daysArg.split('=')[1]) : 30;

  const popular = analytics.getPopularContent(type, { days, limit });

  const typeLabel = type ? `${type} content` : 'content';
  console.log(`\nTop ${typeLabel} (last ${days} days):\n`);

  if (popular.length === 0) {
    console.log('  No content views recorded');
    console.log('');
    return;
  }

  let rank = 1;
  for (const item of popular) {
    console.log(`  ${rank}. ${item.type}/${item.id} - "${item.title}" - ${analytics.formatNumber(item.views)} views`);
    rank++;
  }
  console.log('');
}, 'Show top content (--top=N, --days=N)');

register('analytics:users', async (args, context) => {
  const analytics = context.services.get('analytics');

  const topArg = args.find(a => a.startsWith('--top='));
  const limit = topArg ? parseInt(topArg.split('=')[1]) : 10;

  const activity = analytics.getUserActivity();

  console.log(`\nMost Active Users (last 30 days):\n`);

  if (activity.topUsers.length === 0) {
    console.log('  No user activity recorded');
    console.log('');
    return;
  }

  let rank = 1;
  for (const user of activity.topUsers.slice(0, limit)) {
    console.log(`  ${rank}. ${user.userId} - ${user.total} actions (${user.updates} edits, ${user.logins} logins, ${user.creates} creates)`);
    rank++;
  }
  console.log('');
}, 'Show most active users (--top=N)');

register('analytics:events', async (args, context) => {
  const analytics = context.services.get('analytics');

  const typeArg = args.find(a => a.startsWith('--type='));
  const eventType = typeArg ? typeArg.split('=')[1] : null;

  const daysArg = args.find(a => a.startsWith('--days='));
  const days = daysArg ? parseInt(daysArg.split('=')[1]) : 7;

  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 20;

  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);

  const events = analytics.getEvents(start, end, eventType);

  const typeLabel = eventType || 'all';
  console.log(`\nRecent events (${typeLabel}, last ${days} days):\n`);

  if (events.length === 0) {
    console.log('  No events recorded');
    console.log('');
    return;
  }

  // Show most recent first
  const recent = events.slice(-limit).reverse();

  for (const event of recent) {
    const time = new Date(event.timestamp).toLocaleString();
    const user = event.userId || 'anonymous';
    let detail = '';

    switch (event.event) {
      case 'pageview':
        detail = event.path;
        break;
      case 'content.view':
      case 'content.create':
      case 'content.update':
        detail = `${event.type}/${event.id}`;
        break;
      case 'search':
        detail = `"${event.query}" (${event.results} results)`;
        break;
      case 'api.request':
        detail = `${event.method} ${event.path} (${event.status})`;
        break;
      default:
        detail = JSON.stringify(event).slice(0, 50);
    }

    console.log(`  [${event.event}] ${detail}`);
    console.log(`    ${time} - ${user}`);
    console.log('');
  }

  console.log(`  Showing ${recent.length} of ${events.length} events`);
  console.log('');
}, 'Show event log (--type=X, --days=N, --limit=N)');

register('analytics:aggregate', async (args, context) => {
  const analytics = context.services.get('analytics');

  console.log('\nRunning aggregation...\n');

  const result = analytics.runAggregation();

  console.log('  Aggregation complete');
  console.log(`  Updated: ${result.updatedAt}`);
  console.log(`  Day summary: ${result.day.pageViews} page views`);
  console.log(`  Week summary: ${result.week.pageViews} page views`);
  console.log(`  Month summary: ${result.month.pageViews} page views`);
  console.log(`  Popular content: ${result.popularContent.length} items`);
  console.log(`  Top users: ${result.topUsers.length} users`);
  console.log('');
}, 'Run manual aggregation');

register('analytics:stats', async (args, context) => {
  const analytics = context.services.get('analytics');

  const stats = analytics.getStats();

  console.log('\nAnalytics system statistics:\n');
  console.log(`  Enabled: ${stats.enabled}`);
  console.log(`  Retention: ${stats.retention} days`);
  console.log(`  Total events: ${analytics.formatNumber(stats.totalEvents)}`);
  console.log(`  Total days tracked: ${stats.totalDays}`);
  console.log(`  Buffer size: ${stats.bufferSize}`);
  if (stats.lastAggregation) {
    console.log(`  Last aggregation: ${stats.lastAggregation}`);
  }
  console.log('');
}, 'Show analytics system stats');

register('analytics:cleanup', async (args, context) => {
  const analytics = context.services.get('analytics');

  const dryRun = args.includes('--dry-run');

  if (dryRun) {
    console.log('\nDry run - no data will be deleted\n');
  } else {
    console.log('\nCleaning up old analytics data...\n');
  }

  const result = analytics.cleanup();

  console.log(`  Deleted: ${result.deleted} day files`);
  console.log('');
}, 'Clean up old analytics data (--dry-run)');

// ============================================
// Blueprint Commands
// ============================================

register('blueprints:list', async (args, context) => {
  const blueprints = context.services.get('blueprints');

  // Parse type filter
  const typeArg = args.find(a => a.startsWith('--type='));
  const type = typeArg ? typeArg.split('=')[1] : null;

  const list = blueprints.list(type);

  if (list.length === 0) {
    console.log(type ? `\nNo blueprints for type "${type}".` : '\nNo blueprints defined.');
    console.log('');
    return;
  }

  console.log(`\nBlueprints${type ? ` (${type})` : ''} (${list.length}):\n`);

  for (const bp of list) {
    const fields = Object.keys(bp.template).join(', ') || 'none';
    console.log(`  ${bp.id} - "${bp.name}" (${bp.type})`);
    console.log(`    Fields: ${fields}`);
    console.log(`    Used: ${bp.usageCount || 0} times`);
    if (bp.description) {
      console.log(`    ${bp.description}`);
    }
    console.log('');
  }
}, 'List blueprints (--type=article)');

register('blueprints:create', async (args, context) => {
  const blueprints = context.services.get('blueprints');

  if (args.length < 3) {
    console.error('Usage: blueprints:create <name> <type> <json>');
    console.error('Example: blueprints:create "Blog Post" article \'{"title":"New Post","status":"draft"}\'');
    return;
  }

  const name = args[0];
  const type = args[1];
  let template;

  try {
    template = JSON.parse(args[2]);
  } catch (e) {
    console.error('Error: Invalid JSON template');
    console.error(e.message);
    return;
  }

  // Parse optional description
  const descArg = args.find(a => a.startsWith('--description='));
  const description = descArg ? descArg.split('=').slice(1).join('=') : '';

  // Parse optional locked fields
  const lockedArg = args.find(a => a.startsWith('--locked='));
  const locked = lockedArg ? lockedArg.split('=')[1].split(',') : [];

  try {
    const bp = blueprints.create(name, type, template, { description, locked });

    console.log(`\nCreated blueprint: ${bp.id}`);
    console.log(`  Name: ${bp.name}`);
    console.log(`  Type: ${bp.type}`);
    console.log(`  Fields: ${Object.keys(template).join(', ')}`);
    if (locked.length > 0) {
      console.log(`  Locked: ${locked.join(', ')}`);
    }
    console.log('');
  } catch (e) {
    console.error('Error:', e.message);
  }
}, 'Create blueprint: <name> <type> <json>');

register('blueprints:show', async (args, context) => {
  const blueprints = context.services.get('blueprints');

  if (args.length === 0) {
    console.error('Usage: blueprints:show <id>');
    return;
  }

  const bp = blueprints.get(args[0]);

  if (!bp) {
    console.error(`Blueprint not found: ${args[0]}`);
    return;
  }

  console.log(`\nBlueprint: ${bp.id}`);
  console.log(`  Name: ${bp.name}`);
  console.log(`  Type: ${bp.type}`);
  if (bp.description) {
    console.log(`  Description: ${bp.description}`);
  }
  console.log(`  Created: ${bp.createdAt}`);
  console.log(`  Updated: ${bp.updatedAt}`);
  console.log(`  Created by: ${bp.createdBy}`);
  console.log(`  Usage count: ${bp.usageCount || 0}`);

  if (bp.locked.length > 0) {
    console.log(`  Locked fields: ${bp.locked.join(', ')}`);
  }

  console.log('\n  Template:');
  for (const [key, value] of Object.entries(bp.template)) {
    const display = typeof value === 'string' && value.length > 50
      ? value.substring(0, 47) + '...'
      : JSON.stringify(value);
    console.log(`    ${key}: ${display}`);
  }
  console.log('');
}, 'Show blueprint details');

register('blueprints:apply', async (args, context) => {
  const blueprints = context.services.get('blueprints');

  if (args.length === 0) {
    console.error('Usage: blueprints:apply <id> [--field.name=value]');
    return;
  }

  const id = args[0];

  // Parse field overrides
  const overrides = {};
  for (const arg of args.slice(1)) {
    if (arg.startsWith('--field.')) {
      const [key, ...valueParts] = arg.substring(8).split('=');
      overrides[key] = valueParts.join('=');
    }
  }

  try {
    const result = await blueprints.apply(id, overrides, {
      username: 'cli',
      userId: 'cli'
    });

    console.log(`\nCreated ${result.content.type}/${result.content.id} from blueprint "${result.blueprint.name}"`);
    console.log(`  Title: ${result.content.title || result.content.name || result.content.id}`);
    console.log(`  Status: ${result.content.status || 'draft'}`);
    console.log('');
  } catch (e) {
    console.error('Error:', e.message);
  }
}, 'Create content from blueprint');

register('blueprints:delete', async (args, context) => {
  const blueprints = context.services.get('blueprints');

  if (args.length === 0) {
    console.error('Usage: blueprints:delete <id>');
    return;
  }

  const id = args[0];
  const bp = blueprints.get(id);

  if (!bp) {
    console.error(`Blueprint not found: ${id}`);
    return;
  }

  const deleted = blueprints.remove(id);

  if (deleted) {
    console.log(`\nDeleted blueprint: ${id} ("${bp.name}")`);
    console.log('');
  } else {
    console.error('Error: Failed to delete blueprint');
  }
}, 'Delete a blueprint');

register('blueprints:from-content', async (args, context) => {
  const blueprints = context.services.get('blueprints');

  if (args.length < 3) {
    console.error('Usage: blueprints:from-content <type> <id> <name>');
    return;
  }

  const [type, id, name] = args;

  // Parse optional description
  const descArg = args.find(a => a.startsWith('--description='));
  const description = descArg ? descArg.split('=').slice(1).join('=') : '';

  try {
    const bp = blueprints.createFromContent(type, id, name, { description });

    console.log(`\nCreated blueprint: ${bp.id}`);
    console.log(`  Name: ${bp.name}`);
    console.log(`  From: ${type}/${id}`);
    console.log(`  Fields: ${Object.keys(bp.template).join(', ')}`);
    console.log('');
  } catch (e) {
    console.error('Error:', e.message);
  }
}, 'Create blueprint from existing content');

register('blueprints:stats', async (args, context) => {
  const blueprints = context.services.get('blueprints');

  const stats = blueprints.getStats();

  console.log('\nBlueprint statistics:\n');
  console.log(`  Enabled: ${stats.enabled}`);
  console.log(`  Total blueprints: ${stats.total}`);
  console.log(`  Total usage: ${stats.totalUsage}`);
  console.log(`  Sequences: ${stats.sequences}`);

  if (Object.keys(stats.byType).length > 0) {
    console.log('\n  By type:');
    for (const [type, count] of Object.entries(stats.byType)) {
      console.log(`    ${type}: ${count}`);
    }
  }

  console.log('');
}, 'Show blueprint statistics');

// ============================================
// Keyboard Shortcuts Command
// ============================================

register('shortcuts:list', async (args, context) => {
  const isMac = process.platform === 'darwin';
  const modKey = isMac ? 'cmd' : 'ctrl';

  const shortcuts = {
    global: [
      { keys: '?', description: 'Show shortcuts help' },
      { keys: 'g h', description: 'Go to dashboard' },
      { keys: 'g c', description: 'Go to content' },
      { keys: 'g b', description: 'Go to blueprints' },
      { keys: 'g u', description: 'Go to users' },
      { keys: 'g m', description: 'Go to media' },
      { keys: 'g p', description: 'Go to plugins' },
      { keys: 'g a', description: 'Go to analytics' },
      { keys: '/', description: 'Focus search' },
      { keys: 'esc', description: 'Close modal / cancel' }
    ],
    'Content List': [
      { keys: 'n', description: 'New content' },
      { keys: 'j / k', description: 'Navigate down / up' },
      { keys: 'enter', description: 'Edit selected' },
      { keys: 'd', description: 'Delete selected' },
      { keys: 'p', description: 'Publish selected' },
      { keys: 'r', description: 'Refresh list' }
    ],
    'Content Edit': [
      { keys: `${modKey}+s`, description: 'Save' },
      { keys: `${modKey}+shift+s`, description: 'Save and continue' },
      { keys: `${modKey}+p`, description: 'Publish' },
      { keys: `${modKey}+d`, description: 'Save as draft' },
      { keys: `${modKey}+shift+p`, description: 'Preview' },
      { keys: 'esc', description: 'Cancel / go back' }
    ]
  };

  console.log('\nKeyboard Shortcuts:\n');

  for (const [section, items] of Object.entries(shortcuts)) {
    console.log(`  ${section.charAt(0).toUpperCase() + section.slice(1)}:`);
    for (const item of items) {
      const key = item.keys.padEnd(16);
      console.log(`    ${key}${item.description}`);
    }
    console.log('');
  }

  console.log('  Note: In the browser, press ? to show the shortcuts help modal.\n');
}, 'List keyboard shortcuts for admin UI');

// ============================================
// AI REGISTRY COMMANDS
// ============================================

/**
 * ai:registry:list - Show all registered AI modules
 */
register('ai:registry:list', async (args, context) => {
  const aiRegistry = context.services.get('ai-registry');

  if (!aiRegistry) {
    console.log('\nAI registry not available\n');
    return;
  }

  const allModules = aiRegistry.listAll();
  const stats = aiRegistry.getStats();

  if (allModules.length === 0) {
    console.log('\nNo AI modules registered');
    console.log('Create a module with "ai": true in manifest.json to register it.\n');
    return;
  }

  console.log('\nAI Modules Registry:');
  console.log(`  Total: ${stats.total} modules\n`);

  // Group by type
  const typeNames = { provider: 'Providers', tool: 'Tools', processor: 'Processors', agent: 'Agents' };

  for (const [type, displayName] of Object.entries(typeNames)) {
    const modules = aiRegistry.getByType(type);

    if (modules.length > 0) {
      console.log(`  ${displayName} (${modules.length}):`);

      for (const mod of modules) {
        const statusIcon = mod.status === 'active' ? '✓' : '○';
        console.log(`    ${statusIcon} ${mod.name}`);

        if (mod.manifest.description) {
          console.log(`        ${mod.manifest.description}`);
        }

        // Show capabilities if any
        const caps = mod.capabilities;
        if (caps && Object.keys(caps).length > 0) {
          const capStr = Object.entries(caps)
            .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
            .join(', ');
          console.log(`        Capabilities: ${capStr}`);
        }
      }
      console.log('');
    }
  }

  console.log(`  Status: ${stats.byStatus.active} active, ${stats.byStatus.inactive} inactive\n`);
}, 'List all registered AI modules');

/**
 * EXTENDING THE CLI VIA HOOKS:
 *
 * Modules can register commands by exporting hook_cli:
 *
 *   export function hook_cli(register) {
 *     register('mymod:status', async (args, context) => {
 *       console.log('Status: OK');
 *     }, 'Show module status');
 *   }
 *
 * The register function automatically tracks the module source.
 * Commands are available after the CLI hook fires during boot.
 */
