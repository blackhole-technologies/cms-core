/**
 * Tasks Module
 *
 * Provides scheduled task management functionality including:
 * - Example scheduled tasks (cache cleanup, content stats)
 * - Admin UI for viewing and managing tasks
 * - Task run history storage
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Content hook - register taskrun content type for history
 */
export function hook_content(register, context) {
  // Task run history - stores execution records
  register('taskrun', {
    name: { type: 'string', required: true },
    startedAt: { type: 'string', required: true },
    completedAt: { type: 'string', required: true },
    duration: { type: 'number', required: false },
    status: { type: 'string', required: true },
    result: { type: 'string', required: false },
  });
}

/**
 * Boot hook - initialize tasks module
 */
export async function hook_boot(context) {
  console.log('[tasks] Tasks module initialized');
}

/**
 * Schedule hook - register scheduled tasks
 *
 * This hook is called during the REGISTER phase to let modules
 * define their scheduled tasks.
 */
export function hook_schedule(schedule, context) {
  const cache = context.services.get('cache');
  const content = context.services.get('content');

  /**
   * Cache Cleanup Task
   *
   * Runs every hour to clear expired cache entries.
   * While the cache has lazy expiration (entries expire on access),
   * this proactive cleanup prevents memory bloat from entries
   * that are never accessed again.
   */
  schedule('cleanup', '0 * * * *', async () => {
    // Get stats before cleanup
    const before = cache.stats();
    const expiredCount = before.size;

    // The stats() function already cleans up expired entries
    // We just need to call it and report
    const after = cache.stats();
    const cleaned = expiredCount - after.size;

    const result = `Cleaned ${cleaned} expired entries, ${after.size} remain`;
    console.log(`[tasks] Cache cleanup: ${result}`);

    return result;
  }, {
    description: 'Clear expired cache entries',
  });

  /**
   * Workflow Publish Task
   *
   * Runs every minute to check for scheduled content that should be published.
   * Finds content where status=pending and scheduledAt <= now.
   */
  schedule('workflow:publish', '* * * * *', async () => {
    const workflowConfig = content.getWorkflowConfig();

    if (!workflowConfig.enabled) {
      return 'Workflow disabled, skipping';
    }

    const published = await content.processScheduled();

    if (published.length === 0) {
      return 'No scheduled content to publish';
    }

    const result = `Published ${published.length} item(s): ${published.map(p => `${p.type}/${p.id}`).join(', ')}`;
    console.log(`[tasks] ${result}`);

    return result;
  }, {
    description: 'Auto-publish scheduled content',
  });

  /**
   * Content Statistics Task
   *
   * Runs daily at midnight to log content statistics.
   * Useful for monitoring content growth and health.
   */
  schedule('stats', '0 0 * * *', async () => {
    const types = content.listTypes();
    const stats = {};
    let totalItems = 0;

    for (const { type } of types) {
      const result = content.list(type, { limit: 1 });
      stats[type] = result.total;
      totalItems += result.total;
    }

    const result = {
      totalTypes: types.length,
      totalItems,
      byType: stats,
      timestamp: new Date().toISOString(),
    };

    console.log(`[tasks] Content stats: ${totalItems} items across ${types.length} types`);
    console.log('[tasks] By type:', JSON.stringify(stats));

    return result;
  }, {
    description: 'Log content statistics',
  });

  /**
   * Trash Auto-Purge Task
   *
   * Runs daily at 2 AM to permanently delete old trashed items.
   * Respects the trash.retention configuration for cutoff age.
   */
  schedule('trash:autopurge', '0 2 * * *', async () => {
    const trashConfig = content.getTrashConfig();

    if (!trashConfig.enabled || !trashConfig.autoPurge) {
      return 'Trash auto-purge disabled, skipping';
    }

    const result = await content.autoPurgeTrash();

    if (result.skipped) {
      return 'Auto-purge disabled in config';
    }

    if (result.purged === 0) {
      return 'No items to purge';
    }

    const msg = `Purged ${result.purged} item(s) older than ${trashConfig.retention} days`;
    console.log(`[tasks] ${msg}`);

    if (result.errors.length > 0) {
      console.log(`[tasks] Purge errors: ${result.errors.length}`);
    }

    return msg;
  }, {
    description: 'Auto-purge old trashed content',
  });
}

/**
 * Routes hook - register admin routes
 */
export function hook_routes(register, context) {
  const server = context.services.get('server');
  const template = context.services.get('template');
  const scheduler = context.services.get('scheduler');
  const content = context.services.get('content');

  /**
   * Render admin template with layout
   */
  function renderAdmin(templateName, data, ctx) {
    const templatePath = join(import.meta.dirname, 'templates', templateName);
    const templateContent = readFileSync(templatePath, 'utf-8');
    const rendered = template.renderString(templateContent, data);
    return template.renderWithLayout('layout.html', rendered, {
      ...data,
      siteName: ctx.config.site.name,
    });
  }

  /**
   * Redirect helper
   */
  function redirect(res, url) {
    res.writeHead(302, { Location: url });
    res.end();
  }

  /**
   * Get flash message from URL
   */
  function getFlashMessage(url) {
    const urlObj = new URL(url, 'http://localhost');
    const success = urlObj.searchParams.get('success');
    const error = urlObj.searchParams.get('error');
    if (success) return { type: 'success', message: decodeURIComponent(success) };
    if (error) return { type: 'error', message: decodeURIComponent(error) };
    return null;
  }

  /**
   * Format date for display
   */
  function formatDate(date) {
    if (!date) return 'Never';
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /**
   * Format duration in milliseconds
   */
  function formatDuration(ms) {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  /**
   * GET /admin/tasks - List all scheduled tasks
   */
  register('GET', '/admin/tasks', async (req, res, params, ctx) => {
    const tasks = scheduler.list();
    const flash = getFlashMessage(req.url);

    // Enrich task data for display
    const items = tasks.map(task => ({
      ...task,
      description: task.description || scheduler.describeCron(task.cronExpr),
      cronDescription: scheduler.describeCron(task.cronExpr),
      lastRunFormatted: formatDate(task.lastRun),
      nextRunFormatted: formatDate(task.nextRun),
      lastDurationFormatted: formatDuration(task.lastDuration),
      statusClass: task.lastStatus === 'success' ? 'success' :
                   task.lastStatus === 'error' ? 'error' : 'pending',
    }));

    const html = renderAdmin('tasks-list.html', {
      pageTitle: 'Scheduled Tasks',
      items,
      hasItems: items.length > 0,
      totalCount: items.length,
      schedulerRunning: scheduler.running(),
      flash,
      hasFlash: !!flash,
    }, ctx);

    server.html(res, html);
  }, 'List scheduled tasks');

  /**
   * POST /admin/tasks/:name/run - Manually run a task
   */
  register('POST', '/admin/tasks/:name/run', async (req, res, params, ctx) => {
    const { name } = params;

    try {
      const result = await scheduler.run(name);

      if (result.status === 'success') {
        redirect(res, `/admin/tasks?success=${encodeURIComponent(`Task "${name}" completed in ${result.duration}ms`)}`);
      } else {
        redirect(res, `/admin/tasks?error=${encodeURIComponent(`Task "${name}" failed: ${result.error}`)}`);
      }
    } catch (error) {
      redirect(res, `/admin/tasks?error=${encodeURIComponent(error.message)}`);
    }
  }, 'Run task manually');

  /**
   * GET /admin/tasks/:name/history - View task history
   */
  register('GET', '/admin/tasks/:name/history', async (req, res, params, ctx) => {
    const { name } = params;
    const task = scheduler.get(name);

    if (!task) {
      redirect(res, '/admin/tasks?error=' + encodeURIComponent(`Task not found: ${name}`));
      return;
    }

    // Get history from content store
    const result = content.list('taskrun', {
      limit: 50,
      search: name,
    });

    // Filter to exact task name and format
    const items = result.items
      .filter(item => item.name === name)
      .map(item => ({
        ...item,
        startedAtFormatted: formatDate(item.startedAt),
        completedAtFormatted: formatDate(item.completedAt),
        durationFormatted: formatDuration(item.duration),
        statusClass: item.status === 'success' ? 'success' : 'error',
      }));

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('task-history.html', {
      pageTitle: `Task History: ${name}`,
      taskName: name,
      task: {
        ...task,
        cronDescription: scheduler.describeCron(task.cronExpr),
      },
      items,
      hasItems: items.length > 0,
      totalCount: items.length,
      flash,
      hasFlash: !!flash,
    }, ctx);

    server.html(res, html);
  }, 'View task history');
}

/**
 * CLI hook - register CLI commands
 */
export function hook_cli(register, context) {
  const scheduler = context.services.get('scheduler');
  const content = context.services.get('content');

  /**
   * tasks:list - Show all scheduled tasks
   */
  register('list', async (args, ctx) => {
    const tasks = scheduler.list();

    if (tasks.length === 0) {
      console.log('\nNo scheduled tasks registered.');
      console.log('Modules can register tasks via hook_schedule.\n');
      return;
    }

    console.log('\nScheduled tasks:');

    for (const task of tasks) {
      console.log(`  ${task.name}`);
      console.log(`    Schedule: ${task.cronExpr} (${scheduler.describeCron(task.cronExpr)})`);

      if (task.description) {
        console.log(`    Description: ${task.description}`);
      }

      console.log(`    Last run: ${task.lastRun ? scheduler.formatDate(task.lastRun) : 'never'}`);
      console.log(`    Next run: ${scheduler.formatDate(task.nextRun)}`);
      console.log(`    Run count: ${task.runCount}`);
      console.log(`    Status: ${task.lastStatus}${task.lastError ? ` (${task.lastError})` : ''}`);

      if (task.lastDuration) {
        console.log(`    Last duration: ${task.lastDuration}ms`);
      }

      console.log('');
    }
  }, 'Show all scheduled tasks');

  /**
   * tasks:run <name> - Manually run a task
   */
  register('run', async (args, ctx) => {
    if (args.length === 0) {
      console.error('Usage: tasks:run <name>');
      console.error('Example: tasks:run cache:cleanup');
      throw new Error('Task name required');
    }

    const name = args[0];

    try {
      const result = await scheduler.run(name);

      if (result.status === 'success') {
        if (result.result) {
          console.log(`Result: ${typeof result.result === 'string' ? result.result : JSON.stringify(result.result)}`);
        }
      } else {
        console.error(`Failed: ${result.error}`);
      }
    } catch (error) {
      console.error(`Error: ${error.message}`);
      throw error;
    }
  }, 'Manually run a scheduled task');

  /**
   * tasks:history [name] - Show recent task runs
   */
  register('history', async (args, ctx) => {
    const name = args[0] || null;
    const limit = 20;

    // Get history from scheduler (in-memory) and content (persisted)
    const memoryHistory = scheduler.history(name, limit);

    // Also try to get from content store
    let contentHistory = [];
    if (content.hasType('taskrun')) {
      const result = content.list('taskrun', { limit, search: name || '' });
      contentHistory = result.items;
      if (name) {
        contentHistory = contentHistory.filter(item => item.name === name);
      }
    }

    // Merge and dedupe by timestamp
    const seen = new Set();
    const combined = [];

    for (const entry of [...memoryHistory, ...contentHistory]) {
      const key = `${entry.name}-${entry.startedAt}`;
      if (!seen.has(key)) {
        seen.add(key);
        combined.push(entry);
      }
    }

    // Sort by start time descending
    combined.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

    if (combined.length === 0) {
      if (name) {
        console.log(`\nNo history found for task: ${name}\n`);
      } else {
        console.log('\nNo task history found.\n');
      }
      return;
    }

    const title = name ? `Task history for "${name}":` : 'Recent task runs:';
    console.log(`\n${title}\n`);

    for (const entry of combined.slice(0, limit)) {
      const started = new Date(entry.startedAt);
      const dateStr = started.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      const status = entry.status === 'success' ? '✓' : '✗';
      const duration = entry.duration ? `${entry.duration}ms` : '-';

      console.log(`  ${status} [${dateStr}] ${entry.name} (${duration})`);

      if (entry.status === 'error' && entry.result) {
        console.log(`    Error: ${entry.result}`);
      }
    }

    console.log('');
  }, 'Show recent task runs');
}
