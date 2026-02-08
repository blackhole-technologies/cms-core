/**
 * admin/index.js - Web-based Admin Interface
 *
 * This module provides a browser-based admin panel for:
 * - Viewing dashboard statistics
 * - Managing content (CRUD operations)
 * - Viewing module status
 *
 * DESIGN DECISIONS:
 * =================
 *
 * 1. NO JAVASCRIPT REQUIRED
 *    The admin UI uses standard HTML forms and server-side rendering.
 *    This keeps it simple and works without client-side JS.
 *
 * 2. FORM-BASED CRUD
 *    Content creation/editing uses HTML forms with POST submissions.
 *    After each action, the user is redirected back to the list.
 *
 * 3. FLASH MESSAGES
 *    Success/error messages are passed via query parameters.
 *    Simple but effective for form feedback.
 *
 * 4. USES THEME LAYOUT
 *    Admin pages use the site's theme layout for consistency.
 *    Admin-specific styling is in /public/css/admin.css.
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

// Get the directory of this module for loading templates
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load an admin template file
 */
function loadTemplate(name) {
  const templatePath = join(__dirname, 'templates', name);
  return readFileSync(templatePath, 'utf-8');
}

/**
 * Format bytes to human-readable size string
 * @param {number} bytes - Size in bytes
 * @returns {string} - e.g. "1.5 MB"
 */
function formatMediaSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

/**
 * Parse URL-encoded form data from request body
 *
 * @param {http.IncomingMessage} req
 * @returns {Promise<Object>} - Parsed form data
 */
function parseFormBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1024 * 1024) {
        reject(new Error('Form data too large'));
      }
    });

    req.on('end', () => {
      try {
        const data = {};
        const pairs = body.split('&');

        for (const pair of pairs) {
          // Replace + with space before decoding (URL encoding uses + for spaces)
          const [key, value] = pair.split('=').map(s => decodeURIComponent(s.replace(/\+/g, ' ')));
          if (key) {
            // Handle arrays (multiple values with same key)
            if (data[key]) {
              if (Array.isArray(data[key])) {
                data[key].push(value || '');
              } else {
                data[key] = [data[key], value || ''];
              }
            } else {
              data[key] = value || '';
            }
          }
        }

        resolve(data);
      } catch (error) {
        reject(new Error('Invalid form data'));
      }
    });

    req.on('error', reject);
  });
}

/**
 * Parse JSON request body
 * WHY: API routes need to parse JSON payloads for REST operations.
 * Used for PUT/POST/PATCH requests with Content-Type: application/json.
 */
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
      // WHY 1MB LIMIT: Prevents memory exhaustion attacks
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
      }
    });

    req.on('end', () => {
      try {
        if (!body) {
          resolve({});
          return;
        }
        const data = JSON.parse(body);
        resolve(data);
      } catch (error) {
        reject(new Error('Invalid JSON body: ' + error.message));
      }
    });

    req.on('error', reject);
  });
}

/**
 * Get flash message from query string
 */
function getFlashMessage(url) {
  const urlObj = new URL(url, 'http://localhost');
  const success = urlObj.searchParams.get('success');
  const error = urlObj.searchParams.get('error');

  if (success) {
    return { type: 'success', message: decodeURIComponent(success) };
  }
  if (error) {
    return { type: 'error', message: decodeURIComponent(error) };
  }
  return null;
}

/**
 * Format date for display
 */
function formatDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format duration in seconds for display
 */
function formatDuration(seconds) {
  if (seconds < 60) {
    return `${seconds} sec`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  if (remainingMins === 0) {
    return `${hours} hr`;
  }
  return `${hours}h ${remainingMins}m`;
}

/**
 * Format relative time (e.g., "5m ago", "2h ago")
 */
function formatRelativeTime(date) {
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);

  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return formatDate(date.toISOString());
}

/**
 * Boot hook - module initialization
 */
export async function hook_boot(context) {
  console.log('[admin] Admin module initialized');
}

/**
 * CLI hook - register admin commands
 */
export function hook_cli(register, context) {
  /**
   * admin:stats - Show dashboard statistics
   */
  register('admin:stats', async (args, ctx) => {
    const content = ctx.services.get('content');

    console.log('\n=== Admin Dashboard Stats ===\n');

    // Content types
    const types = content.listTypes();
    console.log(`Content Types: ${types.length}`);
    for (const { type, source } of types) {
      const result = content.list(type);
      console.log(`  - ${type}: ${result.total} items (from: ${source})`);
    }

    // Modules
    const enabledModules = ctx.config.modules.enabled || [];
    const allModules = ctx.modules || [];
    console.log(`\nModules: ${enabledModules.length} enabled / ${allModules.length} discovered`);

    // Theme
    console.log(`\nTheme: ${ctx.config.site.theme || 'default'}`);

    console.log('');
  }, 'Show admin dashboard statistics');

  /**
   * favorites:list [userId] - List favorites
   */
  register('favorites:list', async (args, ctx) => {
    const favoritesService = ctx.services.get('favorites');
    const content = ctx.services.get('content');

    const userId = args[0] || 'admin';
    const favorites = favoritesService.getFavorites(userId, { includeContent: true });

    if (favorites.length === 0) {
      console.log(`\nNo favorites for ${userId}\n`);
      return;
    }

    console.log(`\nFavorites for ${userId} (${favorites.length}):\n`);

    for (const fav of favorites) {
      const title = fav.content?.title || fav.content?.name || fav.content?.username || fav.contentId;
      const label = fav.label ? ` - "${fav.label}"` : '';
      const date = new Date(fav.addedAt);
      const relative = formatRelativeTime(date);
      console.log(`  ★ ${fav.contentType}/${fav.contentId} - "${title}"${label} - added ${relative}`);
    }
    console.log('');

    function formatRelativeTime(date) {
      const now = new Date();
      const diff = Math.floor((now - date) / 1000);
      if (diff < 60) return `${diff}s ago`;
      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
      if (diff < 604800) return `${Math.floor(diff / 86400)} days ago`;
      if (diff < 2592000) return `${Math.floor(diff / 604800)} weeks ago`;
      return date.toLocaleDateString();
    }
  }, 'List favorites for a user');

  /**
   * favorites:add <userId> <type> <id> [--label="..."] - Add favorite
   */
  register('favorites:add', async (args, ctx) => {
    const favoritesService = ctx.services.get('favorites');

    if (args.length < 3) {
      console.error('Usage: favorites:add <userId> <type> <id> [--label="..."]');
      return;
    }

    const userId = args[0];
    const type = args[1];
    const id = args[2];

    // Parse --label flag
    let label = null;
    for (const arg of args.slice(3)) {
      if (arg.startsWith('--label=')) {
        label = arg.substring(8).replace(/^["']|["']$/g, '');
      }
    }

    try {
      favoritesService.addFavorite(userId, type, id, label);
      console.log(`\nAdded favorite for ${userId}: ${type}/${id}`);
      if (label) {
        console.log(`  Label: ${label}`);
      }
      console.log('');
    } catch (error) {
      console.error(`Error: ${error.message}`);
    }
  }, 'Add a favorite for a user');

  /**
   * favorites:remove <userId> <type> <id> - Remove favorite
   */
  register('favorites:remove', async (args, ctx) => {
    const favoritesService = ctx.services.get('favorites');

    if (args.length < 3) {
      console.error('Usage: favorites:remove <userId> <type> <id>');
      return;
    }

    const userId = args[0];
    const type = args[1];
    const id = args[2];

    const removed = favoritesService.removeFavorite(userId, type, id);

    if (removed) {
      console.log(`\nRemoved favorite for ${userId}: ${type}/${id}\n`);
    } else {
      console.log(`\nFavorite not found: ${type}/${id} for ${userId}\n`);
    }
  }, 'Remove a favorite for a user');

  /**
   * favorites:popular [--limit=10] - Show most favorited content
   */
  register('favorites:popular', async (args, ctx) => {
    const favoritesService = ctx.services.get('favorites');

    // Parse --limit flag
    let limit = 10;
    for (const arg of args) {
      if (arg.startsWith('--limit=')) {
        limit = parseInt(arg.substring(8)) || 10;
      }
    }

    const popular = favoritesService.getPopularFavorites(limit);

    if (popular.length === 0) {
      console.log('\nNo favorites yet.\n');
      return;
    }

    console.log('\nMost favorited content:\n');

    popular.forEach((item, index) => {
      const title = item.content?.title || item.content?.name || item.contentId;
      const users = item.count === 1 ? '1 user' : `${item.count} users`;
      console.log(`  ${index + 1}. ${item.contentType}/${item.contentId} - "${title}" - ${users}`);
    });
    console.log('');
  }, 'Show most favorited content');

  /**
   * content:compare <type> <idA> <idB> - Compare two content items
   * content:compare <type> <id> --revision=<ts> - Compare with revision
   */
  register('content:compare', async (args, ctx) => {
    const compareService = ctx.services.get('compare');
    const content = ctx.services.get('content');

    if (args.length < 2) {
      console.error('Usage: content:compare <type> <idA> <idB>');
      console.error('       content:compare <type> <id> --revision=<timestamp>');
      return;
    }

    const type = args[0];
    const idA = args[1];

    // Check for --revision flag
    let revisionTs = null;
    for (const arg of args) {
      if (arg.startsWith('--revision=')) {
        revisionTs = arg.substring(11);
      }
    }

    try {
      let result;
      let labelA, labelB;

      if (revisionTs) {
        // Compare with revision
        result = compareService.compareWithRevision(type, idA, revisionTs);
        labelA = `${type}/${idA} (revision ${revisionTs})`;
        labelB = `${type}/${idA} (current)`;
      } else {
        // Compare two items
        const idB = args[2];
        if (!idB) {
          console.error('Usage: content:compare <type> <idA> <idB>');
          return;
        }

        const itemA = content.read(type, idA);
        const itemB = content.read(type, idB);

        if (!itemA) {
          console.error(`Not found: ${type}/${idA}`);
          return;
        }
        if (!itemB) {
          console.error(`Not found: ${type}/${idB}`);
          return;
        }

        result = compareService.compare(itemA, itemB);
        labelA = `${type}/${idA}`;
        labelB = `${type}/${idB}`;
      }

      console.log(`\nComparing ${labelA} vs ${labelB}:\n`);
      console.log(compareService.formatComparison(result));
      console.log('');
    } catch (error) {
      console.error(`Error: ${error.message}`);
    }
  }, 'Compare two content items or revisions');

  /**
   * content:merge <type> <id> --from=<sourceId> [--strategy=<strategy>] - Merge content
   */
  register('content:merge', async (args, ctx) => {
    const compareService = ctx.services.get('compare');

    if (args.length < 2) {
      console.error('Usage: content:merge <type> <targetId> --from=<sourceId> [--strategy=ours|theirs|manual]');
      return;
    }

    const type = args[0];
    const targetId = args[1];

    // Parse flags
    let sourceId = null;
    let strategy = 'theirs';

    for (const arg of args) {
      if (arg.startsWith('--from=')) {
        sourceId = arg.substring(7);
      }
      if (arg.startsWith('--strategy=')) {
        strategy = arg.substring(11);
      }
    }

    if (!sourceId) {
      console.error('Error: --from=<sourceId> is required');
      return;
    }

    try {
      const result = await compareService.mergeFrom(type, targetId, sourceId, { strategy });

      if (result.hasConflicts) {
        console.log(`\nMerge has ${result.conflicts.length} conflict(s):\n`);
        for (const c of result.conflicts) {
          console.log(`  ${c.field}:`);
          console.log(`    ours:   ${c.ours}`);
          console.log(`    theirs: ${c.theirs}`);
        }
        console.log('\nUse --strategy=ours or --strategy=theirs to auto-resolve.');
        return;
      }

      // Apply the merge
      await compareService.applyMerge(type, targetId, result, {});

      console.log(`\nMerged ${type}/${sourceId} into ${type}/${targetId}:`);
      console.log(`  Applied ${result.applied.length} changes (${strategy} strategy)`);
      for (const a of result.applied) {
        const val = typeof a.value === 'string' && a.value.length > 40
          ? a.value.substring(0, 40) + '...'
          : a.value;
        console.log(`  - ${a.field}: ${val}`);
      }
      console.log('');
    } catch (error) {
      console.error(`Error: ${error.message}`);
    }
  }, 'Merge content from another item');

  /**
   * content:diff <type> <id> --field=<fieldName> - Show field diff
   */
  register('content:diff', async (args, ctx) => {
    const content = ctx.services.get('content');
    const compareService = ctx.services.get('compare');

    if (args.length < 2) {
      console.error('Usage: content:diff <type> <id> --field=<fieldName> [--revision=<ts>]');
      return;
    }

    const type = args[0];
    const id = args[1];

    let fieldName = null;
    let revisionTs = null;

    for (const arg of args) {
      if (arg.startsWith('--field=')) {
        fieldName = arg.substring(8);
      }
      if (arg.startsWith('--revision=')) {
        revisionTs = arg.substring(11);
      }
    }

    if (!fieldName) {
      console.error('Error: --field=<fieldName> is required');
      return;
    }

    try {
      const current = content.read(type, id);
      if (!current) {
        console.error(`Not found: ${type}/${id}`);
        return;
      }

      let previous;
      if (revisionTs) {
        previous = content.getRevision(type, id, revisionTs);
        if (!previous) {
          console.error(`Revision not found: ${type}/${id} @ ${revisionTs}`);
          return;
        }
      } else {
        // Get most recent revision
        const revisions = content.getRevisions(type, id);
        if (revisions.length === 0) {
          console.log('No revisions available for diff.');
          return;
        }
        previous = content.getRevision(type, id, revisions[0].timestamp);
      }

      const valueA = previous[fieldName];
      const valueB = current[fieldName];

      if (valueA === undefined && valueB === undefined) {
        console.log(`Field "${fieldName}" not found in either version.`);
        return;
      }

      const diff = compareService.diff(valueA, valueB);

      console.log(`\nDiff for ${type}/${id}.${fieldName}:\n`);

      if (diff.status === 'unchanged') {
        console.log('  (no changes)');
      } else if (diff.diff && diff.diff.changes) {
        for (const change of diff.diff.changes) {
          const prefix = change.type === 'added' ? '+' : change.type === 'removed' ? '-' : ' ';
          console.log(`  ${prefix} ${change.line}`);
        }
      } else {
        console.log(`  - ${valueA}`);
        console.log(`  + ${valueB}`);
      }
      console.log('');
    } catch (error) {
      console.error(`Error: ${error.message}`);
    }
  }, 'Show diff for a specific field');

  /**
   * activity:feed [--limit=20] [--action=<type>] - Show activity feed
   */
  register('activity:feed', async (args, ctx) => {
    const activityService = ctx.services.get('activity');

    // Parse options
    const limitArg = args.find(a => a.startsWith('--limit='));
    const actionArg = args.find(a => a.startsWith('--action='));
    const daysArg = args.find(a => a.startsWith('--days='));

    const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 20;
    const action = actionArg ? actionArg.split('=')[1] : null;
    const days = daysArg ? parseInt(daysArg.split('=')[1], 10) : 30;

    const result = activityService.getFeed({ limit, action, days, aggregate: true });

    console.log('\nRecent Activity:');
    if (result.activities.length === 0) {
      console.log('  (no activity recorded yet)');
    } else {
      for (const activity of result.activities) {
        const formatted = activityService.formatActivity(activity);
        console.log(`  • ${formatted}`);
      }
    }
    console.log(`\nShowing ${result.activities.length} of ${result.total} activities.\n`);
  }, 'Show activity feed');

  /**
   * activity:user <userId> [--limit=20] - Show user activity
   */
  register('activity:user', async (args, ctx) => {
    const activityService = ctx.services.get('activity');

    if (args.length < 1 || args[0].startsWith('--')) {
      console.error('Usage: activity:user <userId> [--limit=20]');
      return;
    }

    const userId = args[0];
    const limitArg = args.find(a => a.startsWith('--limit='));
    const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 20;

    const result = activityService.getForUser(userId, { limit, aggregate: true });

    console.log(`\nActivity for ${userId}:`);
    if (result.activities.length === 0) {
      console.log('  (no activity recorded)');
    } else {
      for (const activity of result.activities) {
        const label = activity.label || activity.action;
        const count = activity.count > 1 ? ` (${activity.count} times)` : '';
        let target = '';
        if (activity.target) {
          target = ` ${activity.target.type}/${activity.target.title || activity.target.id}`;
        }
        console.log(`  • ${label}${target}${count} - ${activity.relativeTime}`);
      }
    }
    console.log(`\nShowing ${result.activities.length} of ${result.total} activities.\n`);
  }, 'Show user activity');

  /**
   * activity:content <type> <id> - Show content timeline
   */
  register('activity:content', async (args, ctx) => {
    const activityService = ctx.services.get('activity');

    if (args.length < 2) {
      console.error('Usage: activity:content <type> <id>');
      return;
    }

    const type = args[0];
    const id = args[1];

    const result = activityService.getForContent(type, id, { limit: 50 });

    console.log(`\nTimeline for ${type}/${id}:`);
    if (result.activities.length === 0) {
      console.log('  (no activity recorded)');
    } else {
      for (const activity of result.activities) {
        const date = activity.timestamp.slice(0, 16).replace('T', ' ');
        const actor = activity.actor?.username || 'system';
        const label = activity.label || activity.action;
        let extra = '';
        if (activity.data?.fields && activity.data.fields.length > 0) {
          extra = ` (${activity.data.fields.join(', ')})`;
        }
        console.log(`  ${date} - ${label} by ${actor}${extra}`);
      }
    }
    console.log('');
  }, 'Show content timeline');

  /**
   * activity:stats [--days=30] - Show activity statistics
   */
  register('activity:stats', async (args, ctx) => {
    const activityService = ctx.services.get('activity');

    const daysArg = args.find(a => a.startsWith('--days='));
    const days = daysArg ? parseInt(daysArg.split('=')[1], 10) : 30;

    const stats = activityService.getStats({ days });

    console.log(`\nActivity Statistics (last ${days} days):`);
    console.log(`  Total activities: ${stats.total}`);

    console.log('\n  By action:');
    for (const [action, count] of Object.entries(stats.byAction).slice(0, 5)) {
      console.log(`    ${action}: ${count}`);
    }

    console.log('\n  By user:');
    for (const [user, count] of Object.entries(stats.byActor).slice(0, 5)) {
      console.log(`    ${user}: ${count}`);
    }

    if (stats.topContent.length > 0) {
      console.log('\n  Most active content:');
      for (const item of stats.topContent.slice(0, 5)) {
        console.log(`    ${item.type}/${item.title || item.id}: ${item.count} activities`);
      }
    }
    console.log('');
  }, 'Show activity statistics');

  // =====================================================
  // ARCHETYPE CLI COMMANDS
  // =====================================================

  /**
   * archetypes:list - List all content types
   */
  register('archetypes:list', async (args, ctx) => {
    const archetypesService = ctx.services.get('archetypes');

    const types = archetypesService.listArchetypes();

    console.log(`\nContent Types (${types.length}):`);
    for (const type of types) {
      const icon = type.icon || '📁';
      const fieldCount = type.fields ? Object.keys(type.fields).length : 0;
      const source = type.source === 'archetype' ? 'custom' :
                     type.isSystem ? 'system' : type.source || 'module';
      console.log(`  ${icon} ${type.name} (${source}) - ${fieldCount} fields - ${type.itemCount || 0} items`);
    }
    console.log('');
  }, 'List all content types');

  /**
   * archetypes:show <name> - Show content type details
   */
  register('archetypes:show', async (args, ctx) => {
    const archetypesService = ctx.services.get('archetypes');
    const content = ctx.services.get('content');

    if (args.length < 1) {
      console.error('Usage: archetypes:show <name>');
      return;
    }

    const name = args[0];
    let archetype = archetypesService.getArchetype(name);

    // Try to get from content types if not found
    if (!archetype) {
      const types = content.listTypes();
      const found = types.find(t => t.type === name);
      if (found) {
        archetype = {
          name,
          label: name.charAt(0).toUpperCase() + name.slice(1),
          fields: found.schema,
          source: found.source || 'module',
          isSystem: archetypesService.isSystemType(name),
        };
      }
    }

    if (!archetype) {
      console.error(`Content type "${name}" not found`);
      return;
    }

    console.log(`\nContent Type: ${archetype.name}`);
    if (archetype.label) console.log(`  Label: ${archetype.label}`);
    if (archetype.description) console.log(`  Description: ${archetype.description}`);

    console.log('  Fields:');
    for (const [fieldName, fieldDef] of Object.entries(archetype.fields || {})) {
      let desc = `    ${fieldName} (${fieldDef.type})`;
      const attrs = [];
      if (fieldDef.required) attrs.push('required');
      if (fieldDef.maxLength) attrs.push(`max ${fieldDef.maxLength}`);
      if (fieldDef.min !== undefined) attrs.push(`min ${fieldDef.min}`);
      if (fieldDef.max !== undefined) attrs.push(`max ${fieldDef.max}`);
      if (fieldDef.options) attrs.push(fieldDef.options.join(', '));
      if (fieldDef.target) attrs.push(`→ ${fieldDef.target}`);
      if (fieldDef.from) attrs.push(`from ${fieldDef.from}`);
      if (fieldDef.unique) attrs.push('unique');
      if (fieldDef.default !== undefined) attrs.push(`default ${fieldDef.default}`);
      if (attrs.length > 0) desc += ` - ${attrs.join(', ')}`;
      console.log(desc);
    }

    if (archetype.workflow?.enabled) console.log('  Workflow: enabled');
    if (archetype.revisions?.enabled) console.log(`  Revisions: enabled (max ${archetype.revisions.max || 10})`);
    if (archetype.search?.enabled) console.log(`  Search: ${(archetype.search.fields || []).join(', ')}`);
    console.log('');
  }, 'Show content type details');

  /**
   * archetypes:create <name> <json> - Create content type from JSON
   */
  register('archetypes:create', async (args, ctx) => {
    const archetypesService = ctx.services.get('archetypes');

    if (args.length < 2) {
      console.error('Usage: archetypes:create <name> <json>');
      console.error('Example: archetypes:create article \'{"fields":{"title":{"type":"string","required":true},"body":{"type":"markdown"}}}\'');
      return;
    }

    const name = args[0];
    let definition;
    try {
      definition = JSON.parse(args.slice(1).join(' '));
    } catch (e) {
      console.error(`Invalid JSON: ${e.message}`);
      return;
    }

    const result = archetypesService.createArchetype(name, definition);
    if (result.success) {
      console.log(`Created content type: ${name}`);
    } else {
      console.error(`Error: ${result.error}`);
    }
  }, 'Create content type from JSON');

  /**
   * archetypes:delete <name> - Delete content type
   */
  register('archetypes:delete', async (args, ctx) => {
    const archetypesService = ctx.services.get('archetypes');

    if (args.length < 1) {
      console.error('Usage: archetypes:delete <name> [--force]');
      return;
    }

    const name = args[0];
    const force = args.includes('--force');

    const result = archetypesService.deleteArchetype(name, { force });
    if (result.success) {
      console.log(`Deleted content type: ${name}`);
    } else {
      console.error(`Error: ${result.error}`);
    }
  }, 'Delete content type');

  /**
   * archetypes:export <name> [--output=file.json] - Export content type
   */
  register('archetypes:export', async (args, ctx) => {
    const archetypesService = ctx.services.get('archetypes');
    const { writeFileSync } = await import('node:fs');

    if (args.length < 1) {
      console.error('Usage: archetypes:export <name> [--output=file.json]');
      return;
    }

    const name = args[0];
    const outputArg = args.find(a => a.startsWith('--output='));
    const outputFile = outputArg ? outputArg.split('=')[1] : null;

    const result = archetypesService.exportArchetype(name);
    if (!result.success) {
      console.error(`Error: ${result.error}`);
      return;
    }

    if (outputFile) {
      writeFileSync(outputFile, JSON.stringify(result.data, null, 2) + '\n');
      console.log(`Exported ${name} schema to ${outputFile}`);
    } else {
      console.log(JSON.stringify(result.data, null, 2));
    }
  }, 'Export content type as JSON');

  /**
   * archetypes:import <file.json> [--overwrite] - Import content type
   */
  register('archetypes:import', async (args, ctx) => {
    const archetypesService = ctx.services.get('archetypes');
    const { readFileSync, existsSync } = await import('node:fs');

    if (args.length < 1) {
      console.error('Usage: archetypes:import <file.json> [--overwrite]');
      return;
    }

    const file = args[0];
    const overwrite = args.includes('--overwrite');

    if (!existsSync(file)) {
      console.error(`File not found: ${file}`);
      return;
    }

    let data;
    try {
      data = JSON.parse(readFileSync(file, 'utf-8'));
    } catch (e) {
      console.error(`Invalid JSON: ${e.message}`);
      return;
    }

    const result = archetypesService.importArchetype(data, { overwrite });
    if (result.success) {
      console.log(`Imported content type: ${result.archetype.name}`);
    } else {
      console.error(`Error: ${result.error}`);
    }
  }, 'Import content type from JSON');

  /**
   * archetypes:fields - List available field types
   */
  register('archetypes:fields', async (args, ctx) => {
    const archetypesService = ctx.services.get('archetypes');

    const fieldTypes = archetypesService.getFieldTypes();

    console.log('\nAvailable Field Types:');
    for (const ft of fieldTypes) {
      console.log(`  ${ft.type.padEnd(12)} - ${ft.description || ''}`);
    }
    console.log('');
  }, 'List available field types');

  // =====================================================
  // API VERSION CLI COMMANDS
  // =====================================================

  /**
   * api:versions - List API versions and status
   */
  register('api:versions', async (args, ctx) => {
    const apiVersionService = ctx.services.get('apiVersion');

    const versions = apiVersionService.listVersions();
    const stats = apiVersionService.getUsageStats({ days: 7 });
    const defaultVersion = apiVersionService.getConfig().defaultVersion;

    console.log('\nAPI Versions:');
    for (const v of versions) {
      const statusIcon = v.status === 'stable' ? '✓' :
                         v.status === 'deprecated' ? '⚠️' :
                         v.status === 'beta' ? '🧪' : '○';

      let statusText = v.status;
      if (v.version === defaultVersion) statusText += ' - default';
      if (v.sunsetAt) statusText += ` - sunset ${v.sunsetAt}`;

      const usage = stats.versions[v.version]?.total || 0;
      const usageText = usage > 0 ? `${usage.toLocaleString()} requests in last 7 days` : 'no recent requests';

      console.log(`  ${v.version} (${statusText})`);
      console.log(`    ${statusIcon} ${usageText}`);
    }
    console.log('');
  }, 'List API versions and status');

  /**
   * api:deprecations - Show deprecation warnings
   */
  register('api:deprecations', async (args, ctx) => {
    const apiVersionService = ctx.services.get('apiVersion');

    const deprecations = apiVersionService.getDeprecations();

    if (deprecations.length === 0) {
      console.log('\nNo deprecated API features.\n');
      return;
    }

    console.log('\nDeprecated API Features:');
    for (const d of deprecations) {
      if (d.type === 'version') {
        console.log(`  ${d.version} - entire version${d.sunsetAt ? ` - sunset ${d.sunsetAt}` : ''}`);
      } else {
        console.log(`  ${d.version} ${d.endpoint}${d.alternative ? ` - use ${d.alternative} instead` : ''}${d.sunsetAt ? ` - sunset ${d.sunsetAt}` : ''}`);
      }
    }
    console.log('');
  }, 'Show deprecation warnings');

  /**
   * api:usage - API usage by version
   */
  register('api:usage', async (args, ctx) => {
    const apiVersionService = ctx.services.get('apiVersion');

    const days = parseInt(args.days) || 30;
    const stats = apiVersionService.getUsageStats({ days });

    console.log(`\nAPI Usage (last ${days} days):`);
    console.log(`  Period: ${stats.period.start} to ${stats.period.end}`);
    console.log(`  Total requests: ${stats.total.toLocaleString()}`);
    console.log('');

    for (const [version, data] of Object.entries(stats.versions)) {
      const deprecated = apiVersionService.isDeprecated(version) ? ' ⚠️ deprecated' : '';
      console.log(`  ${version}${deprecated}: ${data.total.toLocaleString()} requests`);

      // Show top 5 endpoints
      const endpoints = Object.entries(data.endpoints)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      for (const [endpoint, count] of endpoints) {
        console.log(`    ${endpoint}: ${count.toLocaleString()}`);
      }
      console.log('');
    }
  }, 'API usage by version [--days=30]');

  /**
   * api:changelog - Show version changelog
   */
  register('api:changelog', async (args, ctx) => {
    const apiVersionService = ctx.services.get('apiVersion');

    const changelog = apiVersionService.getChangelog();

    if (changelog.length === 0) {
      console.log('\nNo changelog entries.\n');
      return;
    }

    console.log('\nAPI Changelog:');
    for (const entry of changelog) {
      const date = entry.releasedAt ? ` (${entry.releasedAt})` : '';
      console.log(`\n  ${entry.version}${date} - ${entry.status}`);
      for (const change of entry.changes) {
        console.log(`    - ${change}`);
      }
    }
    console.log('');
  }, 'Show version changelog');

  // =====================================================
  // GRAPHQL CLI COMMANDS
  // =====================================================

  /**
   * graphql:schema - Print generated GraphQL schema
   */
  register('graphql:schema', async (args, ctx) => {
    const graphqlService = ctx.services.get('graphql');

    const schema = graphqlService.generateSchemaString();
    console.log(schema);
  }, 'Print generated GraphQL schema');

  /**
   * graphql:types - List GraphQL types
   */
  register('graphql:types', async (args, ctx) => {
    const graphqlService = ctx.services.get('graphql');

    const types = graphqlService.listTypes();

    console.log('\nGraphQL Types:');
    for (const type of types) {
      console.log(`\n  ${type.name} (${type.contentType})`);
      for (const field of type.fields) {
        const required = field.required ? '!' : '';
        console.log(`    ${field.name}: ${field.type}${required}`);
      }
    }
    console.log('');
  }, 'List GraphQL types');

  /**
   * graphql:query - Execute GraphQL query
   */
  register('graphql:query', async (args, ctx) => {
    const graphqlService = ctx.services.get('graphql');

    const query = args[0];
    if (!query) {
      console.log('Usage: graphql:query <query>');
      console.log('Example: graphql:query \'{ greetings { id name } }\'');
      return;
    }

    const result = graphqlService.executeQuery(query, {}, { user: null });
    console.log(JSON.stringify(result, null, 2));
  }, 'Execute GraphQL query <query>');

  // =====================================================
  // FEEDS CLI COMMANDS
  // =====================================================

  /**
   * feeds:list - List available feeds
   */
  register('feeds:list', async (args, ctx) => {
    const feedsService = ctx.services.get('feeds');

    const feeds = feedsService.listFeeds();

    console.log('\nAvailable Feeds:');
    for (const feed of feeds) {
      const status = feed.enabled ? 'enabled' : 'disabled';
      const formats = feed.enabled ? ` (${feed.formats.join(', ')})` : '';

      console.log(`  ${feed.type} - ${status}${formats} - ${feed.itemCount} items`);

      if (feed.enabled) {
        console.log(`    ${feed.urls.rss}`);
        console.log(`    ${feed.urls.atom}`);
        console.log(`    ${feed.urls.json}`);
      }
    }
    console.log('');
  }, 'List available feeds');

  /**
   * feeds:generate - Generate feed output
   */
  register('feeds:generate', async (args, ctx) => {
    const feedsService = ctx.services.get('feeds');

    const type = args[0];

    // Parse --format=rss|atom|json
    const formatArg = args.find(a => a.startsWith('--format='));
    const format = formatArg ? formatArg.split('=')[1] : 'rss';

    if (!type) {
      console.log('Usage: feeds:generate <type> [--format=rss|atom|json]');
      return;
    }

    const feedConfig = feedsService.getFeedConfig(type);
    if (!feedConfig.enabled) {
      console.log(`Feed for "${type}" is not enabled. Use feeds:config to enable it.`);
      return;
    }

    const output = feedsService.generateFeed(type, format);
    console.log(output);
  }, 'Generate feed <type> [--format=rss]');

  /**
   * feeds:validate - Validate feed configuration
   */
  register('feeds:validate', async (args, ctx) => {
    const feedsService = ctx.services.get('feeds');

    const type = args[0];

    if (!type) {
      console.log('Usage: feeds:validate <type>');
      return;
    }

    const result = feedsService.validateFeed(type);

    console.log(`\nFeed Validation: ${type}`);
    console.log(`  Valid: ${result.valid ? 'Yes' : 'No'}`);

    if (result.errors.length > 0) {
      console.log('  Errors:');
      for (const error of result.errors) {
        console.log(`    - ${error}`);
      }
    }

    if (result.warnings.length > 0) {
      console.log('  Warnings:');
      for (const warning of result.warnings) {
        console.log(`    - ${warning}`);
      }
    }

    if (result.feedConfig) {
      console.log('  Configuration:');
      console.log(`    Title: ${result.feedConfig.title}`);
      console.log(`    Limit: ${result.feedConfig.limit}`);
      console.log(`    Formats: ${result.feedConfig.formats.join(', ')}`);
    }

    if (result.itemCount !== undefined) {
      console.log(`  Items: ${result.itemCount}`);
    }
    console.log('');
  }, 'Validate feed <type>');

  /**
   * feeds:config - Configure feed for a type
   */
  register('feeds:config', async (args, ctx) => {
    const feedsService = ctx.services.get('feeds');

    const type = args[0];

    if (!type) {
      console.log('Usage: feeds:config <type> [--enable] [--disable] [--limit=20] [--title="..."]');
      return;
    }

    const updates = {};

    // Parse flags
    if (args.includes('--enable')) updates.enabled = true;
    if (args.includes('--disable')) updates.enabled = false;

    // Parse --limit=N
    const limitArg = args.find(a => a.startsWith('--limit='));
    if (limitArg) updates.limit = parseInt(limitArg.split('=')[1]);

    // Parse --title="..."
    const titleArg = args.find(a => a.startsWith('--title='));
    if (titleArg) updates.title = titleArg.split('=').slice(1).join('=');

    // Parse --description="..."
    const descArg = args.find(a => a.startsWith('--description='));
    if (descArg) updates.description = descArg.split('=').slice(1).join('=');

    // If no updates specified, show current config
    if (Object.keys(updates).length === 0) {
      const config = feedsService.getFeedConfig(type);
      console.log(`\nFeed Configuration: ${type}`);
      console.log(`  Enabled: ${config.enabled}`);
      console.log(`  Title: ${config.title}`);
      console.log(`  Description: ${config.description || '(none)'}`);
      console.log(`  Limit: ${config.limit}`);
      console.log(`  Formats: ${config.formats.join(', ')}`);
      console.log(`  Include Content: ${config.includeContent}`);
      console.log(`  Content Field: ${config.contentField}`);
      console.log(`  Title Field: ${config.titleField}`);
      console.log(`  Date Field: ${config.dateField}`);
      console.log('');
      return;
    }

    const newConfig = feedsService.setFeedConfig(type, updates);

    console.log(`\nFeed configured for ${type}:`);
    console.log(`  Enabled: ${newConfig.enabled}`);
    console.log(`  Limit: ${newConfig.limit}`);
    console.log(`  Formats: ${newConfig.formats.join(', ')}`);
    console.log('');
  }, 'Configure feed <type> [--enable] [--limit=N]');

  // ========================================
  // SITEMAP & SEO COMMANDS
  // ========================================

  /**
   * sitemap:generate - Generate XML sitemap
   */
  register('sitemap:generate', async (args, ctx) => {
    const sitemapService = ctx.services.get('sitemap');
    if (!sitemapService) {
      console.log('Sitemap service not available');
      return;
    }

    const typeArg = args[0];
    const indexFlag = args.includes('--index');

    if (indexFlag) {
      console.log(sitemapService.generateSitemapIndex());
    } else if (typeArg) {
      console.log(sitemapService.generateSitemap(typeArg));
    } else {
      console.log(sitemapService.generateFullSitemap());
    }
  }, 'Generate XML sitemap');

  /**
   * sitemap:stats - Show sitemap statistics
   */
  register('sitemap:stats', async (args, ctx) => {
    const sitemapService = ctx.services.get('sitemap');
    if (!sitemapService) {
      console.log('Sitemap service not available');
      return;
    }

    const stats = sitemapService.getStats();

    console.log('Sitemap Statistics:');
    console.log(`  Total URLs: ${stats.totalUrls}`);
    console.log('  By type:');
    for (const type of stats.byType) {
      const status = type.enabled ? '' : ' (disabled)';
      console.log(`    ${type.type}: ${type.count} (priority ${type.priority})${status}`);
    }
    console.log(`  Last generated: ${stats.lastGenerated}`);
  }, 'Show sitemap statistics');

  /**
   * sitemap:ping - Ping search engines
   */
  register('sitemap:ping', async (args, ctx) => {
    const sitemapService = ctx.services.get('sitemap');
    if (!sitemapService) {
      console.log('Sitemap service not available');
      return;
    }

    console.log('Pinging search engines...');
    const results = await sitemapService.pingSearchEngines();

    for (const [engine, result] of Object.entries(results)) {
      const status = result.success ? '✓' : '✗';
      console.log(`  ${status} ${engine}: ${result.message}`);
    }
  }, 'Ping search engines about sitemap');

  /**
   * seo:audit - Run SEO audit
   */
  register('seo:audit', async (args, ctx) => {
    const sitemapService = ctx.services.get('sitemap');
    if (!sitemapService) {
      console.log('Sitemap service not available');
      return;
    }

    const type = args[0] || null;
    const id = args[1] || null;

    const audit = sitemapService.auditSEO(type, id);

    if (type) {
      console.log(`SEO Audit for ${type}${id ? ` (${id})` : ''}:`);
    } else {
      console.log('SEO Audit (all types):');
    }

    console.log(`  ${audit.summary.passed} items - no issues`);

    if (audit.warnings.length > 0) {
      console.log(`  ⚠ ${audit.warnings.length} warnings:`);
      for (const issue of audit.warnings.slice(0, 10)) {
        console.log(`    ${issue.id}: ${issue.message}`);
      }
      if (audit.warnings.length > 10) {
        console.log(`    ... and ${audit.warnings.length - 10} more`);
      }
    }

    if (audit.errors.length > 0) {
      console.log(`  ✗ ${audit.errors.length} errors:`);
      for (const issue of audit.errors.slice(0, 10)) {
        console.log(`    ${issue.id}: ${issue.message}`);
      }
      if (audit.errors.length > 10) {
        console.log(`    ... and ${audit.errors.length - 10} more`);
      }
    }
  }, 'Run SEO audit on content');

  /**
   * seo:config - Configure sitemap for a type
   */
  register('seo:config', async (args, ctx) => {
    const sitemapService = ctx.services.get('sitemap');
    if (!sitemapService) {
      console.log('Sitemap service not available');
      return;
    }

    const type = args[0];
    if (!type) {
      console.log('Usage: seo:config <type> [--priority=0.8] [--changefreq=weekly] [--enable] [--disable]');
      return;
    }

    const updates = {};

    if (args.includes('--enable')) updates.enabled = true;
    if (args.includes('--disable')) updates.enabled = false;

    const priorityArg = args.find(a => a.startsWith('--priority='));
    if (priorityArg) updates.priority = parseFloat(priorityArg.split('=')[1]);

    const changefreqArg = args.find(a => a.startsWith('--changefreq='));
    if (changefreqArg) updates.changefreq = changefreqArg.split('=')[1];

    const urlArg = args.find(a => a.startsWith('--url='));
    if (urlArg) updates.urlTemplate = urlArg.split('=')[1];

    if (Object.keys(updates).length > 0) {
      sitemapService.setSitemapConfig(type, updates);
      console.log(`Updated sitemap config for: ${type}`);
    }

    const config = sitemapService.getSitemapConfig(type);
    console.log(`\nSitemap config for ${type}:`);
    console.log(`  enabled: ${config.enabled}`);
    console.log(`  priority: ${config.priority}`);
    console.log(`  changefreq: ${config.changefreq}`);
    console.log(`  urlTemplate: ${config.urlTemplate}`);
  }, 'Configure sitemap for a type');

  /**
   * robots:generate - Generate robots.txt
   */
  register('robots:generate', async (args, ctx) => {
    const sitemapService = ctx.services.get('sitemap');
    if (!sitemapService) {
      console.log('Sitemap service not available');
      return;
    }

    console.log(sitemapService.generateRobotsTxt());
  }, 'Generate robots.txt');

  // =====================================================
  // TAXONOMY CLI COMMANDS
  // =====================================================

  /**
   * taxonomy:list - List vocabularies
   */
  register('taxonomy:list', async (args, ctx) => {
    const taxonomyService = ctx.services.get('taxonomy');
    if (!taxonomyService) {
      console.log('Taxonomy service not available');
      return;
    }

    const vocabularies = taxonomyService.listVocabularies();
    console.log('\nVocabularies:');
    for (const vocab of vocabularies) {
      const termCount = taxonomyService.getTerms(vocab.name).length;
      console.log(`  ${vocab.name} - ${termCount} terms`);
    }
  }, 'List vocabularies');

  /**
   * taxonomy:create - Create vocabulary
   */
  register('taxonomy:create', async (args, ctx) => {
    const taxonomyService = ctx.services.get('taxonomy');
    if (!taxonomyService) {
      console.log('Taxonomy service not available');
      return;
    }

    const name = args[0];
    if (!name) {
      console.log('Usage: taxonomy:create <name>');
      return;
    }

    taxonomyService.createVocabulary(name);
    console.log(`Created vocabulary: ${name}`);
  }, 'Create vocabulary <name>');

  /**
   * taxonomy:delete - Delete vocabulary
   */
  register('taxonomy:delete', async (args, ctx) => {
    const taxonomyService = ctx.services.get('taxonomy');
    if (!taxonomyService) {
      console.log('Taxonomy service not available');
      return;
    }

    const name = args[0];
    if (!name) {
      console.log('Usage: taxonomy:delete <name>');
      return;
    }

    taxonomyService.deleteVocabulary(name);
    console.log(`Deleted vocabulary: ${name}`);
  }, 'Delete vocabulary <name>');

  /**
   * taxonomy:terms - List terms in vocabulary
   */
  register('taxonomy:terms', async (args, ctx) => {
    const taxonomyService = ctx.services.get('taxonomy');
    if (!taxonomyService) {
      console.log('Taxonomy service not available');
      return;
    }

    const vocabulary = args[0];
    if (!vocabulary) {
      console.log('Usage: taxonomy:terms <vocabulary>');
      return;
    }

    const terms = taxonomyService.getTerms(vocabulary);
    console.log(`\nTerms in ${vocabulary}:`);
    for (const term of terms) {
      const indent = '  '.repeat(term.depth || 0);
      console.log(`  ${indent}${term.name} (ID: ${term.id})`);
    }
  }, 'List terms in <vocabulary>');

  /**
   * taxonomy:add - Add term to vocabulary
   */
  register('taxonomy:add', async (args, ctx) => {
    const taxonomyService = ctx.services.get('taxonomy');
    if (!taxonomyService) {
      console.log('Taxonomy service not available');
      return;
    }

    const vocabulary = args[0];
    const name = args[1];

    if (!vocabulary || !name) {
      console.log('Usage: taxonomy:add <vocabulary> <name> [--parent=id]');
      return;
    }

    const parentArg = args.find(a => a.startsWith('--parent='));
    const parentId = parentArg ? parseInt(parentArg.split('=')[1]) : null;

    const term = taxonomyService.addTerm(vocabulary, name, parentId);
    console.log(`Added term: ${name} (ID: ${term.id})`);
  }, 'Add term to vocabulary [--parent=id]');

  /**
   * taxonomy:move - Move term to new parent
   */
  register('taxonomy:move', async (args, ctx) => {
    const taxonomyService = ctx.services.get('taxonomy');
    if (!taxonomyService) {
      console.log('Taxonomy service not available');
      return;
    }

    const vocabulary = args[0];
    const id = args[1];

    if (!vocabulary || !id) {
      console.log('Usage: taxonomy:move <vocabulary> <id> --parent=<id>');
      return;
    }

    const parentArg = args.find(a => a.startsWith('--parent='));
    if (!parentArg) {
      console.log('Usage: taxonomy:move <vocabulary> <id> --parent=<id>');
      return;
    }

    const parentId = parseInt(parentArg.split('=')[1]);
    taxonomyService.moveTerm(vocabulary, parseInt(id), parentId);
    console.log(`Moved term ${id} to parent ${parentId}`);
  }, 'Move term to new parent --parent=<id>');

  /**
   * taxonomy:tree - Show term hierarchy
   */
  register('taxonomy:tree', async (args, ctx) => {
    const taxonomyService = ctx.services.get('taxonomy');
    if (!taxonomyService) {
      console.log('Taxonomy service not available');
      return;
    }

    const vocabulary = args[0];
    if (!vocabulary) {
      console.log('Usage: taxonomy:tree <vocabulary>');
      return;
    }

    const tree = taxonomyService.getTermTree(vocabulary);
    console.log(`\nTerm hierarchy for ${vocabulary}:`);

    const printTree = (terms, depth = 0) => {
      for (const term of terms) {
        const indent = '  '.repeat(depth);
        console.log(`  ${indent}${term.name} (ID: ${term.id})`);
        if (term.children && term.children.length > 0) {
          printTree(term.children, depth + 1);
        }
      }
    };

    printTree(tree);
  }, 'Show term hierarchy');

  // =====================================================
  // MENU CLI COMMANDS
  // =====================================================

  /**
   * menu:list - List menus
   */
  register('menu:list', async (args, ctx) => {
    const menuService = ctx.services.get('menu');
    if (!menuService) {
      console.log('Menu service not available');
      return;
    }

    const menus = menuService.listMenus();
    console.log('\nMenus:');
    for (const menu of menus) {
      const itemCount = menuService.listMenuItems({menuId: menu.id}).items.length;
      console.log(`  ${menu.id} (${menu.title}) - ${itemCount} items`);
    }
  }, 'List menus');

  /**
   * menu:create - Create menu
   */
  register('menu:create', async (args, ctx) => {
    const menuService = ctx.services.get('menu');
    if (!menuService) {
      console.log('Menu service not available');
      return;
    }

    const name = args[0];
    if (!name) {
      console.log('Usage: menu:create <name>');
      return;
    }

    await menuService.createMenu({title: name, id: name});
    console.log(`Created menu: ${name}`);
  }, 'Create menu <name>');

  /**
   * menu:delete - Delete menu
   */
  register('menu:delete', async (args, ctx) => {
    const menuService = ctx.services.get('menu');
    if (!menuService) {
      console.log('Menu service not available');
      return;
    }

    const name = args[0];
    if (!name) {
      console.log('Usage: menu:delete <name>');
      return;
    }

    await menuService.deleteMenu(name);
    console.log(`Deleted menu: ${name}`);
  }, 'Delete menu <name>');

  /**
   * menu:items - List menu items
   */
  register('menu:items', async (args, ctx) => {
    const menuService = ctx.services.get('menu');
    if (!menuService) {
      console.log('Menu service not available');
      return;
    }

    const menu = args[0];
    if (!menu) {
      console.log('Usage: menu:items <menu>');
      return;
    }

    const items = menuService.listMenuItems({menuId: menu}).items;
    console.log(`\nMenu items for ${menu}:`);
    for (const item of items) {
      const indent = '  '.repeat(item.depth || 0);
      console.log(`  ${indent}${item.title} -> ${item.link} (weight: ${item.weight})`);
    }
  }, 'List menu items');

  /**
   * menu:add - Add menu item
   */
  register('menu:add', async (args, ctx) => {
    const menuService = ctx.services.get('menu');
    if (!menuService) {
      console.log('Menu service not available');
      return;
    }

    const menu = args[0];
    const title = args[1];
    const path = args[2];

    if (!menu || !title || !path) {
      console.log('Usage: menu:add <menu> <title> <path> [--parent=id] [--weight=0]');
      return;
    }

    const parentArg = args.find(a => a.startsWith('--parent='));
    const parentId = parentArg ? parentArg.split('=')[1] : null;

    const weightArg = args.find(a => a.startsWith('--weight='));
    const weight = weightArg ? parseInt(weightArg.split('=')[1]) : 0;

    const item = await menuService.createMenuItem({menuId: menu, title, link: path, parentId, weight});
    console.log(`Added menu item: ${title} (ID: ${item.id})`);
  }, 'Add menu item [--parent=id] [--weight=0]');

  /**
   * menu:remove - Remove menu item
   */
  register('menu:remove', async (args, ctx) => {
    const menuService = ctx.services.get('menu');
    if (!menuService) {
      console.log('Menu service not available');
      return;
    }

    const menu = args[0];
    const id = args[1];

    if (!menu || !id) {
      console.log('Usage: menu:remove <menu> <id>');
      return;
    }

    await menuService.deleteMenuItem(id);
    console.log(`Removed menu item: ${id}`);
  }, 'Remove menu item <id>');

  /**
   * menu:move - Move menu item
   */
  register('menu:move', async (args, ctx) => {
    const menuService = ctx.services.get('menu');
    if (!menuService) {
      console.log('Menu service not available');
      return;
    }

    const menu = args[0];
    const id = args[1];

    if (!menu || !id) {
      console.log('Usage: menu:move <menu> <id> --parent=<id> --weight=<n>');
      return;
    }

    const parentArg = args.find(a => a.startsWith('--parent='));
    const weightArg = args.find(a => a.startsWith('--weight='));

    if (!parentArg && !weightArg) {
      console.log('Usage: menu:move <menu> <id> --parent=<id> --weight=<n>');
      return;
    }

    const parentId = parentArg ? parentArg.split('=')[1] : null;
    const weight = weightArg ? parseInt(weightArg.split('=')[1]) : null;

    if (parentId !== null) {
      await menuService.moveMenuItem(id, parentId);
    }
    if (weight !== null) {
      await menuService.updateMenuItem(id, {weight});
    }
    console.log(`Moved menu item: ${id}`);
  }, 'Move menu item --parent=<id> --weight=<n>');

  /**
   * menu:render - Render menu HTML
   */
  register('menu:render', async (args, ctx) => {
    const menuService = ctx.services.get('menu');
    if (!menuService) {
      console.log('Menu service not available');
      return;
    }

    const menu = args[0];
    if (!menu) {
      console.log('Usage: menu:render <menu>');
      return;
    }

    const tree = menuService.renderMenu(menu);
    console.log(JSON.stringify(tree, null, 2));
  }, 'Render menu HTML');

  // =====================================================
  // Contact Commands
  // =====================================================

  /**
   * contact:list - List contact forms
   */
  register('contact:list', async (args, ctx) => {
    const contactService = ctx.services.get('contact');
    if (!contactService) {
      console.log('Contact service not available');
      return;
    }

    const forms = contactService.listForms();
    const stats = contactService.getSubmissionStats();
    console.log('\nContact Forms:');
    for (const form of forms) {
      const count = stats.byForm[form.id] || 0;
      const status = form.enabled ? 'enabled' : 'disabled';
      console.log(`  ${form.id} (${form.title}) - ${count} submissions [${status}]`);
      console.log(`    Recipients: ${form.recipients.join(', ')}`);
    }
    console.log(`\nTotal: ${forms.length} form(s), ${stats.total} submission(s)`);
  }, 'List contact forms');

  /**
   * contact:create - Create contact form
   */
  register('contact:create', async (args, ctx) => {
    const contactService = ctx.services.get('contact');
    if (!contactService) {
      console.log('Contact service not available');
      return;
    }

    const id = args[0];
    const title = args[1] || id;
    const recipients = args[2] ? args[2].split(',') : ['admin@example.com'];

    if (!id) {
      console.log('Usage: contact:create <id> [title] [recipients-comma-separated]');
      return;
    }

    await contactService.createForm({ id, title, recipients });
    console.log(`Created contact form: ${id} (${title})`);
  }, 'Create contact form <id> [title] [recipients]');

  /**
   * contact:delete - Delete contact form
   */
  register('contact:delete', async (args, ctx) => {
    const contactService = ctx.services.get('contact');
    if (!contactService) {
      console.log('Contact service not available');
      return;
    }

    const id = args[0];
    if (!id) {
      console.log('Usage: contact:delete <id>');
      return;
    }

    await contactService.deleteForm(id);
    console.log(`Deleted contact form: ${id}`);
  }, 'Delete contact form <id>');

  /**
   * contact:submissions - List submissions for a form
   */
  register('contact:submissions', async (args, ctx) => {
    const contactService = ctx.services.get('contact');
    if (!contactService) {
      console.log('Contact service not available');
      return;
    }

    const formId = args[0];
    if (!formId) {
      console.log('Usage: contact:submissions <form-id>');
      return;
    }

    const result = contactService.listSubmissions(formId, { limit: 50 });
    console.log(`\nSubmissions for "${formId}" (${result.total} total):\n`);
    for (const sub of result.items) {
      console.log(`  [${sub.id}] ${sub.name} <${sub.email}> - ${sub.subject}`);
      console.log(`    ${sub.created}`);
    }
  }, 'List submissions for form <form-id>');

  /**
   * contact:submit - Submit a test contact form
   */
  register('contact:submit', async (args, ctx) => {
    const contactService = ctx.services.get('contact');
    if (!contactService) {
      console.log('Contact service not available');
      return;
    }

    const formId = args[0] || 'general';
    const result = await contactService.submitForm(formId, {
      name: 'CLI Test User',
      email: 'test@example.com',
      subject: 'Test submission from CLI',
      message: 'This is a test submission created via the contact:submit CLI command.',
      copy: false,
    }, { ip: '127.0.0.1', userAgent: 'CLI' });

    console.log(`Submission result: ${result.message}`);
  }, 'Submit test contact form [form-id]');

  /**
   * contact:export - Export form with all submissions
   */
  register('contact:export', async (args, ctx) => {
    const contactService = ctx.services.get('contact');
    if (!contactService) {
      console.log('Contact service not available');
      return;
    }

    const formId = args[0];
    if (!formId) {
      console.log('Usage: contact:export <form-id>');
      return;
    }

    const exported = contactService.exportForm(formId);
    console.log(JSON.stringify(exported, null, 2));
  }, 'Export contact form with submissions <form-id>');

  // =====================================================
  // Ban Commands
  // =====================================================

  /**
   * ban:list - List banned IPs
   */
  register('ban:list', async (args, ctx) => {
    const banService = ctx.services.get('ban');
    if (!banService) {
      console.log('Ban service not available');
      return;
    }

    const bans = banService.listBans();
    const stats = banService.getStats();

    console.log(`\nIP Bans (${stats.total} total, ${stats.permanent} permanent, ${stats.temporary} temporary):\n`);
    for (const b of bans) {
      const expiry = b.expires ? `expires ${b.expires}` : 'permanent';
      const reason = b.reason ? ` - ${b.reason}` : '';
      console.log(`  ${b.ip} [${expiry}]${reason} (by ${b.bannedBy})`);
    }
    if (bans.length === 0) {
      console.log('  No active bans');
    }
  }, 'List banned IPs');

  /**
   * ban:add - Ban an IP
   */
  register('ban:add', async (args, ctx) => {
    const banService = ctx.services.get('ban');
    if (!banService) {
      console.log('Ban service not available');
      return;
    }

    const ip = args[0];
    if (!ip) {
      console.log('Usage: ban:add <ip> [reason] [duration-hours]');
      return;
    }

    const reason = args[1] || '';
    const hours = args[2] ? parseInt(args[2]) : null;
    const expires = hours ? new Date(Date.now() + hours * 3600000).toISOString() : null;

    banService.addBan(ip, { reason, expires, bannedBy: 'cli' });
    console.log(`Banned: ${ip}${expires ? ` (expires: ${expires})` : ' (permanent)'}`);
  }, 'Ban an IP <ip> [reason] [duration-hours]');

  /**
   * ban:remove - Unban an IP
   */
  register('ban:remove', async (args, ctx) => {
    const banService = ctx.services.get('ban');
    if (!banService) {
      console.log('Ban service not available');
      return;
    }

    const ip = args[0];
    if (!ip) {
      console.log('Usage: ban:remove <ip>');
      return;
    }

    banService.removeBan(ip);
    console.log(`Unbanned: ${ip}`);
  }, 'Unban an IP <ip>');

  /**
   * ban:check - Check if an IP is banned
   */
  register('ban:check', async (args, ctx) => {
    const banService = ctx.services.get('ban');
    if (!banService) {
      console.log('Ban service not available');
      return;
    }

    const ip = args[0];
    if (!ip) {
      console.log('Usage: ban:check <ip>');
      return;
    }

    const result = banService.isBanned(ip);
    if (result) {
      console.log(`BANNED: ${ip}`);
      console.log(`  Reason: ${result.reason || 'none'}`);
      console.log(`  Matched: ${result.ip}`);
      console.log(`  Expires: ${result.expires || 'never'}`);
    } else {
      console.log(`NOT BANNED: ${ip}`);
    }
  }, 'Check if IP is banned <ip>');

  // =====================================================
  // History Commands
  // =====================================================

  /**
   * history:stats - Show history statistics
   */
  register('history:stats', async (args, ctx) => {
    const historyService = ctx.services.get('history');
    if (!historyService) {
      console.log('History service not available');
      return;
    }

    const stats = historyService.getStats();
    console.log('\nContent History Stats:');
    console.log(`  Users tracked: ${stats.totalUsers}`);
    console.log(`  Total reads: ${stats.totalReads}`);
  }, 'Show history statistics');

  /**
   * history:user - Show history for a user
   */
  register('history:user', async (args, ctx) => {
    const historyService = ctx.services.get('history');
    if (!historyService) {
      console.log('History service not available');
      return;
    }

    const userId = args[0];
    if (!userId) {
      console.log('Usage: history:user <user-id>');
      return;
    }

    const lastVisit = historyService.getLastVisit(userId);
    const reads = historyService.getReadHistory(userId);

    console.log(`\nHistory for user: ${userId}`);
    console.log(`  Last visit: ${lastVisit ? new Date(lastVisit).toISOString() : 'never'}`);
    console.log(`  Items read: ${reads.length}\n`);

    for (const entry of reads.slice(0, 20)) {
      console.log(`  ${entry.contentType}/${entry.contentId} — ${new Date(entry.timestamp).toISOString()}`);
    }
    if (reads.length > 20) {
      console.log(`  ... and ${reads.length - 20} more`);
    }
  }, 'Show history for user <user-id>');

  /**
   * history:record - Record a view (for testing)
   */
  register('history:record', async (args, ctx) => {
    const historyService = ctx.services.get('history');
    if (!historyService) {
      console.log('History service not available');
      return;
    }

    const userId = args[0];
    const contentType = args[1];
    const contentId = args[2];

    if (!userId || !contentType || !contentId) {
      console.log('Usage: history:record <user-id> <content-type> <content-id>');
      return;
    }

    historyService.recordView(userId, contentType, contentId);
    console.log(`Recorded: ${userId} viewed ${contentType}/${contentId}`);
  }, 'Record a content view <user-id> <type> <id>');

  /**
   * history:clear - Clear history for a user
   */
  register('history:clear', async (args, ctx) => {
    const historyService = ctx.services.get('history');
    if (!historyService) {
      console.log('History service not available');
      return;
    }

    const userId = args[0];
    if (!userId) {
      console.log('Usage: history:clear <user-id>');
      return;
    }

    historyService.clearHistory(userId);
    console.log(`Cleared history for: ${userId}`);
  }, 'Clear history for user <user-id>');

  /**
   * history:check - Check if user has viewed content
   */
  register('history:check', async (args, ctx) => {
    const historyService = ctx.services.get('history');
    if (!historyService) {
      console.log('History service not available');
      return;
    }

    const userId = args[0];
    const contentType = args[1];
    const contentId = args[2];

    if (!userId || !contentType || !contentId) {
      console.log('Usage: history:check <user-id> <content-type> <content-id>');
      return;
    }

    const viewed = historyService.hasViewed(userId, contentType, contentId);
    const lastViewed = historyService.getLastViewed(userId, contentType, contentId);

    if (viewed) {
      console.log(`VIEWED: ${userId} last saw ${contentType}/${contentId} at ${new Date(lastViewed).toISOString()}`);
    } else {
      console.log(`NOT VIEWED: ${userId} has not seen ${contentType}/${contentId}`);
    }
  }, 'Check if user viewed content <user-id> <type> <id>');

  // =====================================================
  // BLOCK CLI COMMANDS
  // =====================================================

  /**
   * block:types - List block types
   */
  register('block:types', async (args, ctx) => {
    const blocksService = ctx.services.get('blocks');
    if (!blocksService) {
      console.log('Blocks service not available');
      return;
    }

    const types = blocksService.getBlockTypes();
    console.log('\nBlock Types:');
    for (const type of types) {
      console.log(`  ${type.name} - ${type.description || 'No description'}`);
    }
  }, 'List block types');

  /**
   * block:list - List block instances
   */
  register('block:list', async (args, ctx) => {
    const blocksService = ctx.services.get('blocks');
    if (!blocksService) {
      console.log('Blocks service not available');
      return;
    }

    const blocks = blocksService.listBlocks();
    console.log('\nBlock Instances:');
    for (const block of blocks) {
      const region = block.region || 'unassigned';
      console.log(`  ${block.id}: ${block.type} -> ${region} (weight: ${block.weight})`);
    }
  }, 'List block instances');

  /**
   * block:create - Create block instance
   */
  register('block:create', async (args, ctx) => {
    const blocksService = ctx.services.get('blocks');
    if (!blocksService) {
      console.log('Blocks service not available');
      return;
    }

    const type = args[0];
    if (!type) {
      console.log('Usage: block:create <type> [--region=<name>]');
      return;
    }

    const regionArg = args.find(a => a.startsWith('--region='));
    const region = regionArg ? regionArg.split('=')[1] : null;

    const block = blocksService.createBlock(type, region);
    console.log(`Created block: ${block.id} (type: ${type})`);
  }, 'Create block [--region=<name>]');

  /**
   * block:delete - Delete block instance
   */
  register('block:delete', async (args, ctx) => {
    const blocksService = ctx.services.get('blocks');
    if (!blocksService) {
      console.log('Blocks service not available');
      return;
    }

    const id = args[0];
    if (!id) {
      console.log('Usage: block:delete <id>');
      return;
    }

    blocksService.deleteBlock(id);
    console.log(`Deleted block: ${id}`);
  }, 'Delete block <id>');

  /**
   * block:regions - List regions
   */
  register('block:regions', async (args, ctx) => {
    const blocksService = ctx.services.get('blocks');
    if (!blocksService) {
      console.log('Blocks service not available');
      return;
    }

    const regions = blocksService.getRegions();
    console.log('\nRegions:');
    for (const region of regions) {
      const blockCount = blocksService.getBlocksByRegion(region.name).length;
      console.log(`  ${region.name} - ${blockCount} blocks`);
    }
  }, 'List regions');

  /**
   * block:assign - Assign block to region
   */
  register('block:assign', async (args, ctx) => {
    const blocksService = ctx.services.get('blocks');
    if (!blocksService) {
      console.log('Blocks service not available');
      return;
    }

    const id = args[0];
    const region = args[1];

    if (!id || !region) {
      console.log('Usage: block:assign <id> <region> [--weight=0]');
      return;
    }

    const weightArg = args.find(a => a.startsWith('--weight='));
    const weight = weightArg ? parseInt(weightArg.split('=')[1]) : 0;

    blocksService.assignBlock(id, region, weight);
    console.log(`Assigned block ${id} to region ${region}`);
  }, 'Assign block to region [--weight=0]');

  /**
   * block:render - Render single block
   */
  register('block:render', async (args, ctx) => {
    const blocksService = ctx.services.get('blocks');
    if (!blocksService) {
      console.log('Blocks service not available');
      return;
    }

    const id = args[0];
    if (!id) {
      console.log('Usage: block:render <id>');
      return;
    }

    const html = blocksService.renderBlock(id);
    console.log(html);
  }, 'Render single block');

  /**
   * block:render-region - Render region
   */
  register('block:render-region', async (args, ctx) => {
    const blocksService = ctx.services.get('blocks');
    if (!blocksService) {
      console.log('Blocks service not available');
      return;
    }

    const region = args[0];
    if (!region) {
      console.log('Usage: block:render-region <name>');
      return;
    }

    const html = blocksService.renderRegion(region);
    console.log(html);
  }, 'Render region');

  /**
   * Content Types Commands
   */

  /**
   * types:list - List all content types
   */
  register('types:list', async (args, ctx) => {
    const content = ctx.services.get('content');
    const types = content.listTypes();

    console.log('\n=== Content Types ===\n');
    for (const { type, source } of types) {
      const result = content.list(type);
      console.log(`- ${type}: ${result.total} items (from: ${source})`);
    }
    console.log('');
  }, 'List all content types');

  /**
   * types:show <type> - Show type configuration and fields
   */
  register('types:show', async (args, ctx) => {
    const type = args[0];
    if (!type) {
      console.log('Usage: types:show <type>');
      return;
    }

    const content = ctx.services.get('content');
    const config = content.getTypeConfig(type);

    if (!config) {
      console.log(`Content type '${type}' not found`);
      return;
    }

    console.log(`\n=== Content Type: ${type} ===\n`);
    console.log(`Label: ${config.label || type}`);
    console.log(`Description: ${config.description || 'N/A'}`);

    if (config.fields && Object.keys(config.fields).length > 0) {
      console.log('\nFields:');
      for (const [name, field] of Object.entries(config.fields)) {
        const required = field.required ? ' (required)' : '';
        console.log(`  - ${name}: ${field.type}${required}`);
        if (field.label) console.log(`    Label: ${field.label}`);
        if (field.default !== undefined) console.log(`    Default: ${field.default}`);
      }
    } else {
      console.log('\nNo fields defined');
    }
    console.log('');
  }, 'Show type configuration and fields');

  /**
   * types:create <type> --label="..." - Create content type
   */
  register('types:create', async (args, ctx) => {
    const type = args[0];
    if (!type) {
      console.log('Usage: types:create <type> --label="..."');
      return;
    }

    const label = args.find(a => a.startsWith('--label='))?.split('=')[1]?.replace(/"/g, '') || type;

    const content = ctx.services.get('content');

    try {
      content.defineType(type, { label, fields: {} });
      console.log(`Content type '${type}' created with label '${label}'`);
    } catch (error) {
      console.log(`Error creating content type: ${error.message}`);
    }
  }, 'Create content type');

  /**
   * types:delete <type> - Delete content type
   */
  register('types:delete', async (args, ctx) => {
    const type = args[0];
    if (!type) {
      console.log('Usage: types:delete <type>');
      return;
    }

    const content = ctx.services.get('content');

    try {
      content.deleteType(type);
      console.log(`Content type '${type}' deleted`);
    } catch (error) {
      console.log(`Error deleting content type: ${error.message}`);
    }
  }, 'Delete content type');

  /**
   * types:add-field <type> <field> --type=text --required
   */
  register('types:add-field', async (args, ctx) => {
    const type = args[0];
    const fieldName = args[1];

    if (!type || !fieldName) {
      console.log('Usage: types:add-field <type> <field> --type=text --required');
      return;
    }

    const fieldType = args.find(a => a.startsWith('--type='))?.split('=')[1] || 'text';
    const required = args.includes('--required');

    const content = ctx.services.get('content');
    const config = content.getTypeConfig(type);

    if (!config) {
      console.log(`Content type '${type}' not found`);
      return;
    }

    if (!config.fields) config.fields = {};
    config.fields[fieldName] = { type: fieldType, required };

    try {
      content.defineType(type, config);
      console.log(`Field '${fieldName}' (${fieldType}) added to '${type}'${required ? ' (required)' : ''}`);
    } catch (error) {
      console.log(`Error adding field: ${error.message}`);
    }
  }, 'Add field to content type');

  /**
   * types:remove-field <type> <field> - Remove field
   */
  register('types:remove-field', async (args, ctx) => {
    const type = args[0];
    const fieldName = args[1];

    if (!type || !fieldName) {
      console.log('Usage: types:remove-field <type> <field>');
      return;
    }

    const content = ctx.services.get('content');
    const config = content.getTypeConfig(type);

    if (!config) {
      console.log(`Content type '${type}' not found`);
      return;
    }

    if (!config.fields || !config.fields[fieldName]) {
      console.log(`Field '${fieldName}' not found in type '${type}'`);
      return;
    }

    delete config.fields[fieldName];

    try {
      content.defineType(type, config);
      console.log(`Field '${fieldName}' removed from '${type}'`);
    } catch (error) {
      console.log(`Error removing field: ${error.message}`);
    }
  }, 'Remove field from content type');

  /**
   * types:export <type> - Export type definition
   */
  register('types:export', async (args, ctx) => {
    const type = args[0];
    if (!type) {
      console.log('Usage: types:export <type>');
      return;
    }

    const content = ctx.services.get('content');
    const config = content.getTypeConfig(type);

    if (!config) {
      console.log(`Content type '${type}' not found`);
      return;
    }

    console.log(JSON.stringify({ type, config }, null, 2));
  }, 'Export type definition');

  /**
   * types:import <file> - Import type definition
   */
  register('types:import', async (args, ctx) => {
    const file = args[0];
    if (!file) {
      console.log('Usage: types:import <file>');
      return;
    }

    try {
      const fs = await import('fs/promises');
      const data = await fs.readFile(file, 'utf-8');
      const { type, config } = JSON.parse(data);

      const content = ctx.services.get('content');
      content.defineType(type, config);

      console.log(`Content type '${type}' imported from ${file}`);
    } catch (error) {
      console.log(`Error importing type: ${error.message}`);
    }
  }, 'Import type definition');

  /**
   * Display Modes Commands
   */

  /**
   * display:modes - List view modes
   */
  register('display:modes', async (args, ctx) => {
    const display = ctx.services.get('display');
    if (!display) {
      console.log('Display service not available');
      return;
    }

    const modes = display.listModes();
    console.log('\n=== Display Modes ===\n');
    for (const mode of modes) {
      console.log(`- ${mode}`);
    }
    console.log('');
  }, 'List view modes');

  /**
   * display:show <type> [mode] - Show display configuration
   */
  register('display:show', async (args, ctx) => {
    const type = args[0];
    const mode = args[1] || 'default';

    if (!type) {
      console.log('Usage: display:show <type> [mode]');
      return;
    }

    const display = ctx.services.get('display');
    if (!display) {
      console.log('Display service not available');
      return;
    }

    const config = display.getConfig(type, mode);
    console.log(`\n=== Display Config: ${type} (${mode}) ===\n`);
    console.log(JSON.stringify(config, null, 2));
    console.log('');
  }, 'Show display configuration');

  /**
   * display:set <type> <mode> <field> --formatter=... --weight=...
   */
  register('display:set', async (args, ctx) => {
    const type = args[0];
    const mode = args[1];
    const field = args[2];

    if (!type || !mode || !field) {
      console.log('Usage: display:set <type> <mode> <field> --formatter=... --weight=...');
      return;
    }

    const formatter = args.find(a => a.startsWith('--formatter='))?.split('=')[1] || 'default';
    const weight = parseInt(args.find(a => a.startsWith('--weight='))?.split('=')[1]) || 0;

    const display = ctx.services.get('display');
    if (!display) {
      console.log('Display service not available');
      return;
    }

    try {
      display.setFieldDisplay(type, mode, field, { formatter, weight });
      console.log(`Field '${field}' display configured for ${type}.${mode}`);
    } catch (error) {
      console.log(`Error: ${error.message}`);
    }
  }, 'Configure field display');

  /**
   * display:hide <type> <mode> <field> - Hide field in mode
   */
  register('display:hide', async (args, ctx) => {
    const type = args[0];
    const mode = args[1];
    const field = args[2];

    if (!type || !mode || !field) {
      console.log('Usage: display:hide <type> <mode> <field>');
      return;
    }

    const display = ctx.services.get('display');
    if (!display) {
      console.log('Display service not available');
      return;
    }

    try {
      display.hideField(type, mode, field);
      console.log(`Field '${field}' hidden in ${type}.${mode}`);
    } catch (error) {
      console.log(`Error: ${error.message}`);
    }
  }, 'Hide field in display mode');

  /**
   * display:order <type> <mode> <field1,field2,...> - Reorder fields
   */
  register('display:order', async (args, ctx) => {
    const type = args[0];
    const mode = args[1];
    const fieldsStr = args[2];

    if (!type || !mode || !fieldsStr) {
      console.log('Usage: display:order <type> <mode> <field1,field2,...>');
      return;
    }

    const fields = fieldsStr.split(',');
    const display = ctx.services.get('display');
    if (!display) {
      console.log('Display service not available');
      return;
    }

    try {
      display.orderFields(type, mode, fields);
      console.log(`Fields reordered in ${type}.${mode}: ${fields.join(', ')}`);
    } catch (error) {
      console.log(`Error: ${error.message}`);
    }
  }, 'Reorder fields in display mode');

  /**
   * Batch Commands
   */

  /**
   * batch:list - List active batches
   */
  register('batch:list', async (args, ctx) => {
    const batch = ctx.services.get('batch');
    if (!batch) {
      console.log('Batch service not available');
      return;
    }

    const batches = batch.list();
    console.log('\n=== Active Batches ===\n');

    if (batches.length === 0) {
      console.log('No active batches');
    } else {
      for (const b of batches) {
        console.log(`ID: ${b.id}`);
        console.log(`  Operation: ${b.operation}`);
        console.log(`  Progress: ${b.processed}/${b.total} (${Math.round(b.processed/b.total*100)}%)`);
        console.log(`  Status: ${b.status}`);
        console.log('');
      }
    }
  }, 'List active batches');

  /**
   * batch:status <id> - Show batch progress
   */
  register('batch:status', async (args, ctx) => {
    const id = args[0];
    if (!id) {
      console.log('Usage: batch:status <id>');
      return;
    }

    const batch = ctx.services.get('batch');
    if (!batch) {
      console.log('Batch service not available');
      return;
    }

    const status = batch.getStatus(id);
    if (!status) {
      console.log(`Batch '${id}' not found`);
      return;
    }

    console.log(`\n=== Batch ${id} ===\n`);
    console.log(`Operation: ${status.operation}`);
    console.log(`Progress: ${status.processed}/${status.total} (${Math.round(status.processed/status.total*100)}%)`);
    console.log(`Status: ${status.status}`);
    console.log(`Started: ${status.startTime}`);
    if (status.endTime) console.log(`Ended: ${status.endTime}`);
    if (status.errors?.length) {
      console.log(`\nErrors (${status.errors.length}):`);
      status.errors.forEach((err, i) => console.log(`  ${i+1}. ${err}`));
    }
    console.log('');
  }, 'Show batch progress');

  /**
   * batch:cancel <id> - Cancel running batch
   */
  register('batch:cancel', async (args, ctx) => {
    const id = args[0];
    if (!id) {
      console.log('Usage: batch:cancel <id>');
      return;
    }

    const batch = ctx.services.get('batch');
    if (!batch) {
      console.log('Batch service not available');
      return;
    }

    try {
      batch.cancel(id);
      console.log(`Batch '${id}' cancelled`);
    } catch (error) {
      console.log(`Error: ${error.message}`);
    }
  }, 'Cancel running batch');

  /**
   * Status Commands
   */

  /**
   * status:report - Show full status report
   */
  register('status:report', async (args, ctx) => {
    const status = ctx.services.get('status');
    if (!status) {
      console.log('Status service not available');
      return;
    }

    const report = status.getReport();
    console.log('\n=== System Status Report ===\n');

    for (const [category, checks] of Object.entries(report)) {
      console.log(`${category}:`);
      for (const check of checks) {
        const icon = check.status === 'ok' ? '✓' : check.status === 'warning' ? '⚠' : '✗';
        console.log(`  ${icon} ${check.name}: ${check.message}`);
      }
      console.log('');
    }
  }, 'Show full status report');

  /**
   * status:check <name> - Run specific check
   */
  register('status:check', async (args, ctx) => {
    const name = args[0];
    if (!name) {
      console.log('Usage: status:check <name>');
      return;
    }

    const status = ctx.services.get('status');
    if (!status) {
      console.log('Status service not available');
      return;
    }

    try {
      const result = status.runCheck(name);
      console.log(`\n${name}:`);
      console.log(`  Status: ${result.status}`);
      console.log(`  Message: ${result.message}`);
      if (result.details) {
        console.log('  Details:');
        console.log(JSON.stringify(result.details, null, 4));
      }
      console.log('');
    } catch (error) {
      console.log(`Error: ${error.message}`);
    }
  }, 'Run specific status check');

  /**
   * status:summary - Show overall status only
   */
  register('status:summary', async (args, ctx) => {
    const status = ctx.services.get('status');
    if (!status) {
      console.log('Status service not available');
      return;
    }

    const summary = status.getSummary();
    console.log('\n=== System Status Summary ===\n');
    console.log(`Overall: ${summary.overall}`);
    console.log(`Checks: ${summary.passed} passed, ${summary.warnings} warnings, ${summary.failed} failed`);
    console.log('');
  }, 'Show overall status summary');

  /**
   * Help Commands
   */

  /**
   * help:topics - List all help topics
   */
  register('help:topics', async (args, ctx) => {
    const help = ctx.services.get('help');
    if (!help) {
      console.log('Help service not available');
      return;
    }

    const topics = help.listTopics();
    console.log('\n=== Help Topics ===\n');

    for (const topic of topics) {
      console.log(`- ${topic.name}: ${topic.description}`);
    }
    console.log('');
  }, 'List all help topics');

  /**
   * help:search <query> - Search help
   */
  register('help:search', async (args, ctx) => {
    const query = args.join(' ');
    if (!query) {
      console.log('Usage: help:search <query>');
      return;
    }

    const help = ctx.services.get('help');
    if (!help) {
      console.log('Help service not available');
      return;
    }

    const results = help.search(query);
    console.log(`\n=== Search Results for "${query}" ===\n`);

    if (results.length === 0) {
      console.log('No results found');
    } else {
      for (const result of results) {
        console.log(`- ${result.topic}: ${result.excerpt}`);
      }
    }
    console.log('');
  }, 'Search help topics');

  /**
   * help:show <topic> - Show help topic content
   */
  register('help:show', async (args, ctx) => {
    const topic = args[0];
    if (!topic) {
      console.log('Usage: help:show <topic>');
      return;
    }

    const help = ctx.services.get('help');
    if (!help) {
      console.log('Help service not available');
      return;
    }

    const content = help.getTopic(topic);
    if (!content) {
      console.log(`Help topic '${topic}' not found`);
      return;
    }

    console.log(`\n=== ${content.title} ===\n`);
    console.log(content.body);
    console.log('');
  }, 'Show help topic content');

  // ===== Views Commands =====

  /**
   * views:list - List all views
   * WHY: Provides overview of all defined views with key metadata
   */
  register('views:list', async (args, ctx) => {
    const viewsService = ctx.services.get('views');
    if (!viewsService) {
      console.log('Views service not available');
      return;
    }

    const typeArg = args.find(a => a.startsWith('--type='));
    const contentType = typeArg ? typeArg.split('=')[1] : undefined;
    const displayArg = args.find(a => a.startsWith('--display='));
    const display = displayArg ? displayArg.split('=')[1] : undefined;

    const views = viewsService.listViews({ contentType, display });
    if (views.length === 0) {
      console.log('No views defined');
      return;
    }

    console.log(`\nViews (${views.length}):\n`);
    for (const view of views) {
      const filterCount = view.filters?.length || 0;
      const sortCount = view.sort?.length || 0;
      const fieldCount = view.fields?.length || 0;
      const displayMode = view.display || 'page';
      // WHY: Views can have multiple displays (page, block, feed).
      // Show actual count from the displays array if it exists,
      // otherwise fall back to 1 for legacy views without displays array.
      const displayCount = view.displays?.length || 1;
      const displayTypes = view.displays?.map(d => d.type).join(', ') || displayMode;
      console.log(`  ${view.id}`);
      console.log(`    Label: ${view.name}`);
      console.log(`    Content Type: ${view.contentType}`);
      console.log(`    Displays: ${displayCount} (${displayTypes})`);
      console.log(`    Fields: ${fieldCount}, Filters: ${filterCount}, Sorts: ${sortCount}`);
      if (view.description) {
        console.log(`    Description: ${view.description}`);
      }
      console.log('');
    }
  }, 'List all views');

  /**
   * views:show <id> - Show full view configuration
   * WHY: getViewConfig() is the correct API method name in views.js
   */
  register('views:show', async (args, ctx) => {
    const viewsService = ctx.services.get('views');
    if (!viewsService) {
      console.log('Views service not available');
      return;
    }

    const id = args[0];
    if (!id) {
      console.log('Usage: views:show <id>');
      return;
    }

    const view = viewsService.getViewConfig(id);
    if (!view) {
      console.log(`View not found: ${id}`);
      return;
    }

    console.log(`\nView: ${view.id}`);
    console.log(`  Label: ${view.name}`);
    console.log(`  Description: ${view.description || '(none)'}`);
    console.log(`  Content Type: ${view.contentType}`);
    console.log(`  Display: ${view.display}`);
    console.log(`  Path: ${view.path || '(none)'}`);
    console.log(`  Pager: ${view.pager.type} (limit: ${view.pager.limit})`);
    console.log(`  Cache: ${view.cache.enabled ? 'enabled' : 'disabled'} (TTL: ${view.cache.ttl}s)`);
    console.log(`  Created: ${view.created}`);
    console.log(`  Updated: ${view.updated}`);
    if (view.filters.length > 0) {
      console.log(`  Filters:`);
      for (const f of view.filters) {
        console.log(`    - ${f.field} ${f.op} ${f.value}`);
      }
    }
    if (view.sort.length > 0) {
      console.log(`  Sort:`);
      for (const s of view.sort) {
        console.log(`    - ${s.field} ${s.dir || 'asc'}`);
      }
    }
    if (view.fields.length > 0) {
      console.log(`  Fields: ${view.fields.join(', ')}`);
    }
    console.log('');
  }, 'Show view config');

  /**
   * views:create <id> --name=<label> --type=<contentType> [--display=<mode>] [--description=<desc>] [--path=<path>]
   * WHY: createView() requires name (label) and contentType; async for hooks
   */
  register('views:create', async (args, ctx) => {
    const viewsService = ctx.services.get('views');
    if (!viewsService) {
      console.log('Views service not available');
      return;
    }

    const id = args[0];
    if (!id) {
      console.log('Usage: views:create <id> --label=<label> --type=<contentType> [--display=<mode>] [--description=<desc>] [--path=<path>]');
      return;
    }

    const typeArg = args.find(a => a.startsWith('--type='));
    if (!typeArg) {
      console.log('Error: --type=<contentType> required');
      return;
    }

    // WHY --label alias: Feature spec uses --label, but --name also accepted
    const nameArg = args.find(a => a.startsWith('--name=')) || args.find(a => a.startsWith('--label='));
    const descArg = args.find(a => a.startsWith('--description='));
    const displayArg = args.find(a => a.startsWith('--display='));
    const pathArg = args.find(a => a.startsWith('--path='));

    const contentType = typeArg.split('=')[1];
    // Default name to id if not provided, for convenience
    const name = nameArg ? nameArg.split('=').slice(1).join('=') : id;
    const description = descArg ? descArg.split('=').slice(1).join('=') : '';
    const display = displayArg ? displayArg.split('=')[1] : 'page';
    const path = pathArg ? pathArg.split('=').slice(1).join('=') : null;

    try {
      const view = await viewsService.createView(id, {
        name,
        description,
        contentType,
        display,
        path,
        filters: [],
        sort: [],
      });
      console.log(`\nCreated view: ${view.id}`);
      console.log(`  Label: ${view.name}`);
      console.log(`  Content Type: ${view.contentType}`);
      console.log(`  Display: ${view.display}`);
      console.log(`  Persisted to: config/views.json`);
      console.log('');
    } catch (e) {
      console.log(`Error creating view: ${e.message}`);
    }
  }, 'Create view');

  /**
   * views:delete <id> - Delete view
   * WHY: deleteView() is async for hooks
   */
  register('views:delete', async (args, ctx) => {
    const viewsService = ctx.services.get('views');
    if (!viewsService) {
      console.log('Views service not available');
      return;
    }

    const id = args[0];
    if (!id) {
      console.log('Usage: views:delete <id>');
      return;
    }

    try {
      await viewsService.deleteView(id);
      console.log(`Deleted view: ${id}`);
    } catch (e) {
      console.log(`Error: ${e.message}`);
    }
  }, 'Delete view');

  /**
   * views:execute <id> [--limit=N] - Run view query and show results
   * WHY: executeView() is async and returns {items, total, pager} object
   */
  register('views:execute', async (args, ctx) => {
    const viewsService = ctx.services.get('views');
    if (!viewsService) {
      console.log('Views service not available');
      return;
    }

    const id = args[0];
    if (!id) {
      console.log('Usage: views:execute <id> [--limit=N]');
      return;
    }

    try {
      const result = await viewsService.executeView(id, {});
      console.log(`\nView: ${result.view.name} (${result.total} total results)\n`);
      if (result.items.length === 0) {
        console.log('  No results');
      } else {
        for (const item of result.items) {
          const title = item.title || item.name || item.id;
          console.log(`  - ${item.id}: ${title}`);
        }
      }
      console.log(`\n  Page ${result.pager.currentPage + 1} of ${result.pager.totalPages}`);
      console.log('');
    } catch (e) {
      console.log(`Error executing view: ${e.message}`);
    }
  }, 'Run view query');

  /**
   * views:export <id> [--file=<path>] - Export view config as JSON
   * WHY: getViewConfig() is the correct API method name.
   * Optional --file flag writes JSON to a file instead of stdout,
   * enabling round-trip export/import workflows.
   */
  register('views:export', async (args, ctx) => {
    const viewsService = ctx.services.get('views');
    if (!viewsService) {
      console.log('Views service not available');
      return;
    }

    const id = args[0];
    if (!id) {
      console.log('Usage: views:export <id> [--file=<path>]');
      return;
    }

    const view = viewsService.getViewConfig(id);
    if (!view) {
      console.log(`View not found: ${id}`);
      return;
    }

    const json = JSON.stringify(view, null, 2);

    // WHY --file: Allows saving export to a file for backup/transfer/import
    const fileArg = args.find(a => a.startsWith('--file='));
    if (fileArg) {
      const filePath = fileArg.split('=').slice(1).join('=');
      const { writeFileSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const resolvedPath = resolve(filePath);
      writeFileSync(resolvedPath, json + '\n');
      console.log(`\nExported view "${id}" to: ${resolvedPath}`);
      console.log(`  Configuration includes:`);
      console.log(`    - Display: ${view.display}`);
      console.log(`    - Fields: ${view.fields?.length || 0}`);
      console.log(`    - Filters: ${view.filters?.length || 0}`);
      console.log(`    - Sorts: ${view.sort?.length || 0}`);
      console.log(`    - Contextual Filters: ${view.contextualFilters?.length || 0}`);
      console.log(`    - Relationships: ${view.relationships?.length || 0}`);
      console.log(`    - Cache: ${view.cache?.enabled ? 'enabled' : 'disabled'} (TTL: ${view.cache?.ttl || 0}s)`);
      console.log('');
    } else {
      // WHY stdout: Default behavior outputs JSON for piping to other tools
      console.log(json);
    }
  }, 'Export view config');

  /**
   * views:import <file|json> [--id=<newId>] - Import view from JSON file or inline JSON
   * WHY: Enables round-trip export/import for backup, migration, and sharing.
   * The --id flag allows importing under a different ID to avoid conflicts.
   * Validates the JSON structure before importing to prevent corrupt views.
   */
  register('views:import', async (args, ctx) => {
    const viewsService = ctx.services.get('views');
    if (!viewsService) {
      console.log('Views service not available');
      return;
    }

    if (args.length === 0) {
      console.log('Usage: views:import <file.json> [--id=<newId>]');
      console.log('       views:import \'{"id":"myview","name":"My View",...}\' [--id=<newId>]');
      return;
    }

    // WHY --id override: When importing, the user may want a different ID
    // to avoid conflicts with existing views or to create copies
    const idArg = args.find(a => a.startsWith('--id='));
    const overrideId = idArg ? idArg.split('=').slice(1).join('=') : null;

    // Determine if input is a file path or inline JSON
    let jsonStr;
    const input = args.filter(a => !a.startsWith('--')).join(' ');

    if (input.trim().startsWith('{')) {
      // WHY: Allow inline JSON for quick imports and scripting
      jsonStr = input;
    } else {
      // WHY: File-based import for round-trip with views:export --file
      const { readFileSync, existsSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const filePath = resolve(input);

      if (!existsSync(filePath)) {
        console.log(`Error: File not found: ${filePath}`);
        return;
      }

      try {
        jsonStr = readFileSync(filePath, 'utf-8');
      } catch (e) {
        console.log(`Error reading file: ${e.message}`);
        return;
      }
    }

    // Parse and validate JSON
    let viewConfig;
    try {
      viewConfig = JSON.parse(jsonStr);
    } catch (e) {
      console.log(`Error: Invalid JSON - ${e.message}`);
      return;
    }

    // WHY: Validate required fields before attempting to create
    if (!viewConfig.name && !viewConfig.id) {
      console.log('Error: JSON must include at least "name" or "id"');
      return;
    }

    if (!viewConfig.contentType) {
      console.log('Error: JSON must include "contentType"');
      return;
    }

    // Determine the view ID to use
    const viewId = overrideId || viewConfig.id;
    if (!viewId) {
      console.log('Error: No view ID found. Provide --id=<id> or include "id" in JSON');
      return;
    }

    // Check if view already exists
    const existing = viewsService.getViewConfig(viewId);
    if (existing) {
      console.log(`Error: View "${viewId}" already exists. Use --id=<newId> to import with a different ID, or delete the existing view first.`);
      return;
    }

    // WHY: Strip timestamps so createView generates fresh ones
    // This ensures imported views get proper creation timestamps
    const { created, updated, id: _stripId, ...importConfig } = viewConfig;

    try {
      const view = await viewsService.createView(viewId, importConfig);
      console.log(`\nImported view: ${view.id}`);
      console.log(`  Label: ${view.name}`);
      console.log(`  Content Type: ${view.contentType}`);
      console.log(`  Display: ${view.display}`);
      console.log(`  Fields: ${view.fields?.length || 0}`);
      console.log(`  Filters: ${view.filters?.length || 0}`);
      console.log(`  Sorts: ${view.sort?.length || 0}`);
      console.log(`  Contextual Filters: ${view.contextualFilters?.length || 0}`);
      console.log(`  Relationships: ${view.relationships?.length || 0}`);
      console.log(`  Persisted to: config/views.json`);
      console.log('');
    } catch (e) {
      console.log(`Error importing view: ${e.message}`);
    }
  }, 'Import view from JSON');

  // ===== Workflows Commands =====

  /**
   * workflows:list - List workflows
   */
  register('workflows:list', async (args, ctx) => {
    const workflowsService = ctx.services.get('workflows');
    if (!workflowsService) {
      console.log('Workflows service not available');
      return;
    }

    const workflows = workflowsService.listWorkflows();
    if (workflows.length === 0) {
      console.log('No workflows defined');
      return;
    }

    console.log(`\nWorkflows (${workflows.length}):\n`);
    for (const wf of workflows) {
      console.log(`  ${wf.id} - ${wf.states.length} states, ${wf.transitions.length} transitions`);
    }
    console.log('');
  }, 'List workflows');

  /**
   * workflows:show <id> - Show workflow states/transitions
   */
  register('workflows:show', async (args, ctx) => {
    const workflowsService = ctx.services.get('workflows');
    if (!workflowsService) {
      console.log('Workflows service not available');
      return;
    }

    const id = args[0];
    if (!id) {
      console.log('Usage: workflows:show <id>');
      return;
    }

    const wf = workflowsService.getWorkflow(id);
    if (!wf) {
      console.log(`Workflow not found: ${id}`);
      return;
    }

    console.log('\nWorkflow:', id);
    console.log('\nStates:');
    for (const state of wf.states) {
      console.log(`  - ${state.id}${state.initial ? ' (initial)' : ''}`);
    }
    console.log('\nTransitions:');
    for (const tr of wf.transitions) {
      console.log(`  - ${tr.id}: ${tr.from} → ${tr.to}`);
    }
    console.log('');
  }, 'Show workflow states/transitions');

  /**
   * workflows:assign <contentType> <workflowId> - Assign to content type
   */
  register('workflows:assign', async (args, ctx) => {
    const workflowsService = ctx.services.get('workflows');
    if (!workflowsService) {
      console.log('Workflows service not available');
      return;
    }

    if (args.length < 2) {
      console.log('Usage: workflows:assign <contentType> <workflowId>');
      return;
    }

    const contentType = args[0];
    const workflowId = args[1];

    workflowsService.assignWorkflow(contentType, workflowId);
    console.log(`Assigned workflow ${workflowId} to ${contentType}`);
  }, 'Assign to content type');

  /**
   * workflows:state <type> <id> - Show content's current state
   */
  register('workflows:state', async (args, ctx) => {
    const workflowsService = ctx.services.get('workflows');
    if (!workflowsService) {
      console.log('Workflows service not available');
      return;
    }

    if (args.length < 2) {
      console.log('Usage: workflows:state <type> <id>');
      return;
    }

    const type = args[0];
    const id = args[1];

    const state = workflowsService.getCurrentState(type, id);
    console.log(`State: ${state || 'none'}`);
  }, 'Show content\'s current state');

  /**
   * workflows:transition <type> <id> <transition> - Perform transition
   */
  register('workflows:transition', async (args, ctx) => {
    const workflowsService = ctx.services.get('workflows');
    if (!workflowsService) {
      console.log('Workflows service not available');
      return;
    }

    if (args.length < 3) {
      console.log('Usage: workflows:transition <type> <id> <transition>');
      return;
    }

    const type = args[0];
    const id = args[1];
    const transition = args[2];

    try {
      workflowsService.performTransition(type, id, transition);
      console.log(`Transitioned ${type}/${id} via ${transition}`);
    } catch (error) {
      console.log(`Error: ${error.message}`);
    }
  }, 'Perform transition');

  /**
   * workflows:history <type> <id> - Show transition history
   */
  register('workflows:history', async (args, ctx) => {
    const workflowsService = ctx.services.get('workflows');
    if (!workflowsService) {
      console.log('Workflows service not available');
      return;
    }

    if (args.length < 2) {
      console.log('Usage: workflows:history <type> <id>');
      return;
    }

    const type = args[0];
    const id = args[1];

    const history = workflowsService.getHistory(type, id);
    if (history.length === 0) {
      console.log('No transition history');
      return;
    }

    console.log(`\nTransition History (${history.length}):\n`);
    for (const entry of history) {
      const date = new Date(entry.timestamp).toLocaleString();
      console.log(`  ${entry.from} → ${entry.to} (${entry.transition}) - ${date}`);
    }
    console.log('');
  }, 'Show transition history');

  // ===== Permissions Commands =====

  /**
   * permissions:list - List all permissions
   */
  register('permissions:list', async (args, ctx) => {
    const permsService = ctx.services.get('permissions');
    if (!permsService) {
      console.log('Permissions service not available');
      return;
    }

    const perms = permsService.listPermissions();
    if (perms.length === 0) {
      console.log('No permissions defined');
      return;
    }

    console.log(`\nPermissions (${perms.length}):\n`);
    for (const perm of perms) {
      console.log(`  - ${perm}`);
    }
    console.log('');
  }, 'List all permissions');

  /**
   * permissions:roles - List roles
   */
  register('permissions:roles', async (args, ctx) => {
    const permsService = ctx.services.get('permissions');
    if (!permsService) {
      console.log('Permissions service not available');
      return;
    }

    const roles = permsService.listRoles();
    if (roles.length === 0) {
      console.log('No roles defined');
      return;
    }

    console.log(`\nRoles (${roles.length}):\n`);
    for (const role of roles) {
      const perms = permsService.getRolePermissions(role);
      console.log(`  ${role}: ${perms.length} permissions`);
    }
    console.log('');
  }, 'List roles');

  /**
   * permissions:grant <role> <permission> - Grant permission
   */
  register('permissions:grant', async (args, ctx) => {
    const permsService = ctx.services.get('permissions');
    if (!permsService) {
      console.log('Permissions service not available');
      return;
    }

    if (args.length < 2) {
      console.log('Usage: permissions:grant <role> <permission>');
      return;
    }

    const role = args[0];
    const permission = args[1];

    permsService.grantPermission(role, permission);
    console.log(`Granted ${permission} to ${role}`);
  }, 'Grant permission');

  /**
   * permissions:revoke <role> <permission> - Revoke permission
   */
  register('permissions:revoke', async (args, ctx) => {
    const permsService = ctx.services.get('permissions');
    if (!permsService) {
      console.log('Permissions service not available');
      return;
    }

    if (args.length < 2) {
      console.log('Usage: permissions:revoke <role> <permission>');
      return;
    }

    const role = args[0];
    const permission = args[1];

    permsService.revokePermission(role, permission);
    console.log(`Revoked ${permission} from ${role}`);
  }, 'Revoke permission');

  /**
   * permissions:check <user> <permission> - Check if user has permission
   */
  register('permissions:check', async (args, ctx) => {
    const permsService = ctx.services.get('permissions');
    if (!permsService) {
      console.log('Permissions service not available');
      return;
    }

    if (args.length < 2) {
      console.log('Usage: permissions:check <user> <permission>');
      return;
    }

    const user = args[0];
    const permission = args[1];

    const has = permsService.hasPermission(user, permission);
    console.log(`${user} ${has ? 'HAS' : 'DOES NOT HAVE'} ${permission}`);
  }, 'Check if user has permission');

  // ===== Image Styles Commands =====

  /**
   * styles:list - List image styles
   */
  register('styles:list', async (args, ctx) => {
    const stylesService = ctx.services.get('image_styles');
    if (!stylesService) {
      console.log('Image styles service not available');
      return;
    }

    const styles = stylesService.listStyles();
    if (styles.length === 0) {
      console.log('No image styles defined');
      return;
    }

    console.log(`\nImage Styles (${styles.length}):\n`);
    for (const style of styles) {
      console.log(`  ${style.name} - ${style.effects.length} effects`);
    }
    console.log('');
  }, 'List image styles');

  /**
   * styles:show <name> - Show style effects
   */
  register('styles:show', async (args, ctx) => {
    const stylesService = ctx.services.get('image_styles');
    if (!stylesService) {
      console.log('Image styles service not available');
      return;
    }

    const name = args[0];
    if (!name) {
      console.log('Usage: styles:show <name>');
      return;
    }

    const style = stylesService.getStyle(name);
    if (!style) {
      console.log(`Style not found: ${name}`);
      return;
    }

    console.log('\nStyle:', name);
    console.log('Effects:');
    for (const effect of style.effects) {
      console.log(`  - ${effect.type}:`, JSON.stringify(effect.settings));
    }
    console.log('');
  }, 'Show style effects');

  /**
   * styles:flush [name] - Flush derivatives (all or specific)
   */
  register('styles:flush', async (args, ctx) => {
    const stylesService = ctx.services.get('image_styles');
    if (!stylesService) {
      console.log('Image styles service not available');
      return;
    }

    const name = args[0];
    if (name) {
      stylesService.flushStyle(name);
      console.log(`Flushed derivatives for style: ${name}`);
    } else {
      stylesService.flushAll();
      console.log('Flushed all image derivatives');
    }
  }, 'Flush derivatives (all or specific)');

  /**
   * styles:generate <mediaId> <style> - Generate derivative
   */
  register('styles:generate', async (args, ctx) => {
    const stylesService = ctx.services.get('image_styles');
    if (!stylesService) {
      console.log('Image styles service not available');
      return;
    }

    if (args.length < 2) {
      console.log('Usage: styles:generate <mediaId> <style>');
      return;
    }

    const mediaId = args[0];
    const styleName = args[1];

    try {
      const path = stylesService.generateDerivative(mediaId, styleName);
      console.log(`Generated derivative: ${path}`);
    } catch (error) {
      console.log(`Error: ${error.message}`);
    }
  }, 'Generate derivative');

  // ===== Cron Commands =====

  /**
   * cron:list - List tasks with next run times
   */
  register('cron:list', async (args, ctx) => {
    const cronService = ctx.services.get('cron');
    if (!cronService) {
      console.log('Cron service not available');
      return;
    }

    const tasks = cronService.listTasks();
    if (tasks.length === 0) {
      console.log('No cron tasks defined');
      return;
    }

    console.log(`\nCron Tasks (${tasks.length}):\n`);
    for (const task of tasks) {
      const next = task.nextRun ? new Date(task.nextRun).toLocaleString() : 'n/a';
      const status = task.enabled ? 'enabled' : 'disabled';
      console.log(`  ${task.id} (${task.schedule}) - ${status} - next: ${next}`);
    }
    console.log('');
  }, 'List tasks with next run times');

  /**
   * cron:run <task> - Run task manually
   */
  register('cron:run', async (args, ctx) => {
    const cronService = ctx.services.get('cron');
    if (!cronService) {
      console.log('Cron service not available');
      return;
    }

    const taskId = args[0];
    if (!taskId) {
      console.log('Usage: cron:run <task>');
      return;
    }

    try {
      await cronService.runTask(taskId);
      console.log(`Ran task: ${taskId}`);
    } catch (error) {
      console.log(`Error: ${error.message}`);
    }
  }, 'Run task manually');

  /**
   * cron:logs [task] [--limit=N] - Show execution logs
   */
  register('cron:logs', async (args, ctx) => {
    const cronService = ctx.services.get('cron');
    if (!cronService) {
      console.log('Cron service not available');
      return;
    }

    const task = args.find(a => !a.startsWith('--'));
    const limitArg = args.find(a => a.startsWith('--limit='));
    const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 20;

    const logs = cronService.getLogs(task, { limit });
    if (logs.length === 0) {
      console.log('No logs found');
      return;
    }

    console.log(`\nCron Logs (${logs.length}):\n`);
    for (const log of logs) {
      const date = new Date(log.timestamp).toLocaleString();
      const status = log.success ? 'OK' : 'FAIL';
      console.log(`  [${date}] ${log.taskId} - ${status}${log.error ? ': ' + log.error : ''}`);
    }
    console.log('');
  }, 'Show execution logs');

  /**
   * cron:enable <task> - Enable task
   */
  register('cron:enable', async (args, ctx) => {
    const cronService = ctx.services.get('cron');
    if (!cronService) {
      console.log('Cron service not available');
      return;
    }

    const taskId = args[0];
    if (!taskId) {
      console.log('Usage: cron:enable <task>');
      return;
    }

    cronService.enableTask(taskId);
    console.log(`Enabled task: ${taskId}`);
  }, 'Enable task');

  /**
   * cron:disable <task> - Disable task
   */
  register('cron:disable', async (args, ctx) => {
    const cronService = ctx.services.get('cron');
    if (!cronService) {
      console.log('Cron service not available');
      return;
    }

    const taskId = args[0];
    if (!taskId) {
      console.log('Usage: cron:disable <task>');
      return;
    }

    cronService.disableTask(taskId);
    console.log(`Disabled task: ${taskId}`);
  }, 'Disable task');

  // ===== Config Commands =====

  /**
   * config:list - List config items
   *
   * WHY USE configManagement SERVICE:
   * The 'config' service returns the raw config object (context.config).
   * The 'configManagement' service provides the registry of tracked configs
   * with methods like getRegistry(), getConfig(), exportConfig(), etc.
   */
  register('config:list', async (args, ctx) => {
    const configMgmt = ctx.services.get('configManagement');
    if (!configMgmt) {
      console.log('Config management service not available');
      return;
    }

    const registryInfo = configMgmt.getRegistry();
    const configNames = Object.keys(registryInfo.configs);

    if (configNames.length === 0) {
      console.log('No config items registered');
      return;
    }

    console.log(`\nRegistered Configs (${configNames.length}):\n`);
    for (const name of configNames.sort()) {
      const meta = registryInfo.configs[name];
      const locked = registryInfo.locked.includes(name) ? ' [LOCKED]' : '';
      console.log(`  ${name} (${meta.file})${locked}`);
    }
    console.log(`\nEnvironments: ${Object.keys(registryInfo.environments).join(', ')}`);
    console.log(`History entries: ${registryInfo.historyCount}`);
    console.log('');
  }, 'List config items');

  /**
   * config:export [--items=a,b,c] - Export config
   */
  register('config:export', async (args, ctx) => {
    const configMgmt = ctx.services.get('configManagement');
    if (!configMgmt) {
      console.log('Config management service not available');
      return;
    }

    const itemsArg = args.find(a => a.startsWith('--items='));
    const items = itemsArg ? itemsArg.split('=')[1].split(',') : null;

    try {
      const archivePath = await configMgmt.exportConfig(items);
      console.log(`Config exported to: ${archivePath}`);
    } catch (error) {
      console.log(`Error: ${error.message}`);
    }
  }, 'Export config');

  /**
   * config:import <file> [--overwrite] [--dry-run] - Import config
   */
  register('config:import', async (args, ctx) => {
    const configMgmt = ctx.services.get('configManagement');
    if (!configMgmt) {
      console.log('Config management service not available');
      return;
    }

    const file = args.find(a => !a.startsWith('--'));
    if (!file) {
      console.log('Usage: config:import <file> [--overwrite] [--dry-run]');
      return;
    }

    const overwrite = args.includes('--overwrite');
    const dryRun = args.includes('--dry-run');

    try {
      const result = await configMgmt.importConfig(file, { overwrite, dryRun });
      if (dryRun) {
        console.log('\n[DRY RUN] No changes applied.\n');
      }
      console.log(`Imported: ${result.imported.length}`);
      console.log(`Skipped: ${result.skipped.length}`);
      console.log(`Failed: ${result.failed.length}`);
      if (result.skipped.length > 0) {
        console.log('\nSkipped:');
        for (const s of result.skipped) {
          console.log(`  ${s.name}: ${s.reason}`);
        }
      }
      if (result.failed.length > 0) {
        console.log('\nFailed:');
        for (const f of result.failed) {
          console.log(`  ${f.name}: ${f.reason}`);
        }
      }
      console.log('');
    } catch (error) {
      console.log(`Error: ${error.message}`);
    }
  }, 'Import config');

  /**
   * config:diff <file> - Show diff between current config and archive
   */
  register('config:diff', async (args, ctx) => {
    const configMgmt = ctx.services.get('configManagement');
    if (!configMgmt) {
      console.log('Config management service not available');
      return;
    }

    const file = args[0];
    if (!file) {
      console.log('Usage: config:diff <file>');
      return;
    }

    try {
      const diff = await configMgmt.diffConfig(file);

      console.log('\nConfig Diff:\n');
      if (diff.added.length > 0) {
        console.log(`  Added (${diff.added.length}): ${diff.added.join(', ')}`);
      }
      if (diff.modified.length > 0) {
        console.log(`  Modified (${diff.modified.length}):`);
        for (const m of diff.modified) {
          console.log(`    ${m.name}`);
        }
      }
      if (diff.removed.length > 0) {
        console.log(`  Removed (${diff.removed.length}): ${diff.removed.join(', ')}`);
      }
      if (diff.unchanged.length > 0) {
        console.log(`  Unchanged (${diff.unchanged.length}): ${diff.unchanged.join(', ')}`);
      }
      console.log('');
    } catch (error) {
      console.log(`Error: ${error.message}`);
    }
  }, 'Show diff');

  // ===== Path Aliases Commands =====

  /**
   * aliases:list [--type=<type>] - List aliases
   */
  register('aliases:list', async (args, ctx) => {
    const aliasService = ctx.services.get('path_aliases');
    if (!aliasService) {
      console.log('Path aliases service not available');
      return;
    }

    const typeArg = args.find(a => a.startsWith('--type='));
    const type = typeArg ? typeArg.split('=')[1] : undefined;

    const aliases = aliasService.listAliases(type);
    if (aliases.length === 0) {
      console.log('No aliases found');
      return;
    }

    console.log(`\nPath Aliases (${aliases.length}):\n`);
    for (const alias of aliases) {
      console.log(`  ${alias.alias} → ${alias.target}${alias.type ? ` (${alias.type})` : ''}`);
    }
    console.log('');
  }, 'List aliases');

  /**
   * aliases:create <alias> <target> - Create alias
   */
  register('aliases:create', async (args, ctx) => {
    const aliasService = ctx.services.get('path_aliases');
    if (!aliasService) {
      console.log('Path aliases service not available');
      return;
    }

    if (args.length < 2) {
      console.log('Usage: aliases:create <alias> <target>');
      return;
    }

    const alias = args[0];
    const target = args[1];

    aliasService.createAlias(alias, target);
    console.log(`Created alias: ${alias} → ${target}`);
  }, 'Create alias');

  /**
   * aliases:delete <alias> - Delete alias
   */
  register('aliases:delete', async (args, ctx) => {
    const aliasService = ctx.services.get('path_aliases');
    if (!aliasService) {
      console.log('Path aliases service not available');
      return;
    }

    const alias = args[0];
    if (!alias) {
      console.log('Usage: aliases:delete <alias>');
      return;
    }

    aliasService.deleteAlias(alias);
    console.log(`Deleted alias: ${alias}`);
  }, 'Delete alias');

  /**
   * aliases:patterns - Show URL patterns
   */
  register('aliases:patterns', async (args, ctx) => {
    const aliasService = ctx.services.get('path_aliases');
    if (!aliasService) {
      console.log('Path aliases service not available');
      return;
    }

    const patterns = aliasService.listPatterns();
    if (patterns.length === 0) {
      console.log('No URL patterns defined');
      return;
    }

    console.log(`\nURL Patterns (${patterns.length}):\n`);
    for (const pattern of patterns) {
      console.log(`  ${pattern.contentType}: ${pattern.pattern}`);
    }
    console.log('');
  }, 'Show URL patterns');

  /**
   * aliases:generate <type> [id] - Generate aliases
   */
  register('aliases:generate', async (args, ctx) => {
    const aliasService = ctx.services.get('path_aliases');
    if (!aliasService) {
      console.log('Path aliases service not available');
      return;
    }

    const type = args[0];
    if (!type) {
      console.log('Usage: aliases:generate <type> [id]');
      return;
    }

    const id = args[1];
    if (id) {
      aliasService.generateAlias(type, id);
      console.log(`Generated alias for ${type}/${id}`);
    } else {
      const count = aliasService.generateBulkAliases(type);
      console.log(`Generated ${count} aliases for ${type}`);
    }
  }, 'Generate aliases');

  /**
   * aliases:redirects - List redirects
   */
  register('aliases:redirects', async (args, ctx) => {
    const aliasService = ctx.services.get('path_aliases');
    if (!aliasService) {
      console.log('Path aliases service not available');
      return;
    }

    const redirects = aliasService.listRedirects();
    if (redirects.length === 0) {
      console.log('No redirects defined');
      return;
    }

    console.log(`\nRedirects (${redirects.length}):\n`);
    for (const redir of redirects) {
      console.log(`  ${redir.from} → ${redir.to} (${redir.status})`);
    }
    console.log('');
  }, 'List redirects');

  /**
   * tokens:list [type] - List available tokens
   */
  register('tokens:list', async (args, ctx) => {
    const tokenService = ctx.services.get('token');
    if (!tokenService) {
      console.error('Token service not available');
      return;
    }

    const type = args[0];
    const tokens = tokenService.getAvailableTokens(type);

    console.log(`\nAvailable tokens${type ? ` (${type})` : ''}:\n`);
    for (const [name, info] of Object.entries(tokens)) {
      console.log(`  [${name}]`);
      console.log(`    ${info.description || 'No description'}`);
    }
    console.log('');
  }, 'List available tokens');

  /**
   * tokens:replace <text> - Replace tokens in text (for testing)
   */
  register('tokens:replace', async (args, ctx) => {
    const tokenService = ctx.services.get('token');
    if (!tokenService) {
      console.error('Token service not available');
      return;
    }

    if (args.length === 0) {
      console.error('Usage: tokens:replace <text>');
      return;
    }

    const text = args.join(' ');
    const data = { site: ctx.config.site };
    const result = tokenService.replace(text, data);

    console.log(`\nOriginal: ${text}`);
    console.log(`Result: ${result}\n`);
  }, 'Replace tokens in text for testing');

  /**
   * formats:list - List text formats
   */
  register('formats:list', async (args, ctx) => {
    const filterService = ctx.services.get('filter');
    if (!filterService) {
      console.error('Filter service not available');
      return;
    }

    const formats = filterService.listFormats();

    console.log(`\nText formats (${formats.length}):\n`);
    for (const format of formats) {
      console.log(`  ${format.id}`);
      console.log(`    Name: ${format.name}`);
      console.log(`    Filters: ${format.filters.join(', ')}`);
    }
    console.log('');
  }, 'List text formats');

  /**
   * formats:show <id> - Show format config
   */
  register('formats:show', async (args, ctx) => {
    const filterService = ctx.services.get('filter');
    if (!filterService) {
      console.error('Filter service not available');
      return;
    }

    if (args.length === 0) {
      console.error('Usage: formats:show <id>');
      return;
    }

    const format = filterService.getFormat(args[0]);
    if (!format) {
      console.error(`Format not found: ${args[0]}`);
      return;
    }

    console.log(`\nFormat: ${format.id}`);
    console.log(`  Name: ${format.name}`);
    console.log(`  Filters: ${format.filters.join(', ')}`);
    if (format.settings) {
      console.log(`  Settings: ${JSON.stringify(format.settings, null, 2)}`);
    }
    console.log('');
  }, 'Show format configuration');

  /**
   * formats:process <text> --format=<id> - Process text through format
   */
  register('formats:process', async (args, ctx) => {
    const filterService = ctx.services.get('filter');
    if (!filterService) {
      console.error('Filter service not available');
      return;
    }

    let formatId = null;
    const textArgs = [];

    for (const arg of args) {
      if (arg.startsWith('--format=')) {
        formatId = arg.substring(9);
      } else {
        textArgs.push(arg);
      }
    }

    if (!formatId || textArgs.length === 0) {
      console.error('Usage: formats:process <text> --format=<id>');
      return;
    }

    const text = textArgs.join(' ');
    const result = filterService.process(text, formatId);

    console.log(`\nFormat: ${formatId}`);
    console.log(`Original: ${text}`);
    console.log(`Result: ${result}\n`);
  }, 'Process text through format');

  /**
   * entity:types - List entity types
   */
  register('entity:types', async (args, ctx) => {
    const entityService = ctx.services.get('entity');
    if (!entityService) {
      console.error('Entity service not available');
      return;
    }

    const types = entityService.getTypes();

    console.log(`\nEntity types (${types.length}):\n`);
    for (const type of types) {
      const bundle = type.bundle ? `:${type.bundle}` : '';
      console.log(`  ${type.type}${bundle}`);
      if (type.label) {
        console.log(`    Label: ${type.label}`);
      }
      if (type.fields) {
        console.log(`    Fields: ${Object.keys(type.fields).length}`);
      }
    }
    console.log('');
  }, 'List entity types');

  /**
   * entity:load <type> <id> - Load and display entity
   */
  register('entity:load', async (args, ctx) => {
    const entityService = ctx.services.get('entity');
    if (!entityService) {
      console.error('Entity service not available');
      return;
    }

    if (args.length < 2) {
      console.error('Usage: entity:load <type> <id>');
      return;
    }

    const [type, id] = args;
    const entity = entityService.load(type, id);

    if (!entity) {
      console.error(`Entity not found: ${type}/${id}`);
      return;
    }

    console.log(`\nEntity: ${type}/${id}\n`);
    console.log(JSON.stringify(entity, null, 2));
    console.log('');
  }, 'Load and display entity');

  /**
   * entity:query <type> [--field=value] - Query entities
   */
  register('entity:query', async (args, ctx) => {
    const entityService = ctx.services.get('entity');
    if (!entityService) {
      console.error('Entity service not available');
      return;
    }

    if (args.length === 0) {
      console.error('Usage: entity:query <type> [--field=value]');
      return;
    }

    const type = args[0];
    const conditions = {};

    for (const arg of args.slice(1)) {
      if (arg.startsWith('--')) {
        const [key, value] = arg.substring(2).split('=');
        if (key && value) {
          conditions[key] = value;
        }
      }
    }

    const results = entityService.query(type, conditions);

    console.log(`\nQuery: ${type} ${JSON.stringify(conditions)}`);
    console.log(`Results: ${results.length}\n`);
    for (const entity of results) {
      const label = entity.title || entity.name || entity.id;
      console.log(`  - ${entity.id}: ${label}`);
    }
    console.log('');
  }, 'Query entities');

  /**
   * actions:list - List available actions
   */
  register('actions:list', async (args, ctx) => {
    const actionService = ctx.services.get('actions');
    if (!actionService) {
      console.error('Action service not available');
      return;
    }

    const actions = actionService.getActions();

    console.log(`\nActions (${actions.length}):\n`);
    for (const action of actions) {
      console.log(`  ${action.id}`);
      console.log(`    Type: ${action.type}`);
      if (action.label) {
        console.log(`    Label: ${action.label}`);
      }
    }
    console.log('');
  }, 'List available actions');

  /**
   * actions:execute <action> [--target=type:id] - Execute action
   */
  register('actions:execute', async (args, ctx) => {
    const actionService = ctx.services.get('actions');
    if (!actionService) {
      console.error('Action service not available');
      return;
    }

    if (args.length === 0) {
      console.error('Usage: actions:execute <action> [--target=type:id]');
      return;
    }

    const actionId = args[0];
    let target = null;

    for (const arg of args.slice(1)) {
      if (arg.startsWith('--target=')) {
        const targetStr = arg.substring(9);
        const [type, id] = targetStr.split(':');
        if (type && id) {
          target = { type, id };
        }
      }
    }

    try {
      const result = await actionService.execute(actionId, target);
      console.log(`\nAction executed: ${actionId}`);
      console.log(`Result: ${JSON.stringify(result, null, 2)}\n`);
    } catch (error) {
      console.error(`Error: ${error.message}`);
    }
  }, 'Execute action');

  /**
   * rules:list - List rules
   */
  register('rules:list', async (args, ctx) => {
    const rulesService = ctx.services.get('rules');
    if (!rulesService) {
      console.error('Rules service not available');
      return;
    }

    const rules = rulesService.getRules();

    console.log(`\nRules (${rules.length}):\n`);
    for (const rule of rules) {
      console.log(`  ${rule.id}`);
      console.log(`    Event: ${rule.event}`);
      console.log(`    Actions: ${rule.actions.length}`);
      console.log(`    Enabled: ${rule.enabled !== false}`);
    }
    console.log('');
  }, 'List rules');

  /**
   * rules:trigger <event> - Manually trigger event
   */
  register('rules:trigger', async (args, ctx) => {
    const rulesService = ctx.services.get('rules');
    if (!rulesService) {
      console.error('Rules service not available');
      return;
    }

    if (args.length === 0) {
      console.error('Usage: rules:trigger <event>');
      return;
    }

    const event = args[0];

    try {
      console.log(`\nTriggering event: ${event}`);
      await rulesService.trigger(event, {});
      console.log('Event triggered successfully\n');
    } catch (error) {
      console.error(`Error: ${error.message}`);
    }
  }, 'Manually trigger event');

  /**
   * profile:fields - List profile fields
   */
  register('profile:fields', async (args, ctx) => {
    const userFieldsService = ctx.services.get('user_fields');
    if (!userFieldsService) {
      console.error('User fields service not available');
      return;
    }

    const fields = userFieldsService.getFields();

    console.log(`\nProfile fields (${fields.length}):\n`);
    for (const field of fields) {
      console.log(`  ${field.name}`);
      console.log(`    Type: ${field.type}`);
      console.log(`    Required: ${field.required || false}`);
      if (field.label) {
        console.log(`    Label: ${field.label}`);
      }
    }
    console.log('');
  }, 'List profile fields');

  /**
   * profile:show <userId> - Show user profile
   */
  register('profile:show', async (args, ctx) => {
    const userFieldsService = ctx.services.get('user_fields');
    if (!userFieldsService) {
      console.error('User fields service not available');
      return;
    }

    if (args.length === 0) {
      console.error('Usage: profile:show <userId>');
      return;
    }

    const userId = args[0];
    const profile = userFieldsService.getProfile(userId);

    console.log(`\nProfile: ${userId}\n`);
    console.log(JSON.stringify(profile, null, 2));
    console.log('');
  }, 'Show user profile');

  /**
   * profile:set <userId> <field> <value> - Set profile field
   */
  register('profile:set', async (args, ctx) => {
    const userFieldsService = ctx.services.get('user_fields');
    if (!userFieldsService) {
      console.error('User fields service not available');
      return;
    }

    if (args.length < 3) {
      console.error('Usage: profile:set <userId> <field> <value>');
      return;
    }

    const [userId, field, ...valueParts] = args;
    const value = valueParts.join(' ');

    try {
      userFieldsService.setField(userId, field, value);
      console.log(`\nSet ${field} = ${value} for ${userId}\n`);
    } catch (error) {
      console.error(`Error: ${error.message}`);
    }
  }, 'Set profile field');

  /**
   * theme:list - List themes
   */
  register('theme:list', async (args, ctx) => {
    const themeService = ctx.services.get('themeEngine');
    if (!themeService) {
      console.error('Theme service not available');
      return;
    }

    const themes = themeService.getThemes();

    console.log(`\nThemes (${themes.length}):\n`);
    for (const theme of themes) {
      const active = theme.name === ctx.config.site.theme ? ' [active]' : '';
      console.log(`  ${theme.name}${active}`);
      if (theme.version) {
        console.log(`    Version: ${theme.version}`);
      }
      if (theme.description) {
        console.log(`    ${theme.description}`);
      }
    }
    console.log('');
  }, 'List themes');

  /**
   * theme:active - Show active theme
   */
  register('theme:active', async (args, ctx) => {
    const themeService = ctx.services.get('themeEngine');
    if (!themeService) {
      console.error('Theme service not available');
      return;
    }

    const active = themeService.getActiveTheme();

    console.log(`\nActive theme: ${active.name}`);
    if (active.version) {
      console.log(`Version: ${active.version}`);
    }
    if (active.description) {
      console.log(`Description: ${active.description}`);
    }
    console.log('');
  }, 'Show active theme');

  /**
   * theme:activate <name> - Activate theme
   */
  register('theme:activate', async (args, ctx) => {
    const themeService = ctx.services.get('themeEngine');
    if (!themeService) {
      console.error('Theme service not available');
      return;
    }

    if (args.length === 0) {
      console.error('Usage: theme:activate <name>');
      return;
    }

    const themeName = args[0];

    try {
      themeService.activate(themeName);
      console.log(`\nActivated theme: ${themeName}\n`);
    } catch (error) {
      console.error(`Error: ${error.message}`);
    }
  }, 'Activate theme');

  /**
   * theme:settings <name> - Show theme settings
   */
  register('theme:settings', async (args, ctx) => {
    const themeService = ctx.services.get('themeEngine');
    if (!themeService) {
      console.error('Theme service not available');
      return;
    }

    if (args.length === 0) {
      console.error('Usage: theme:settings <name>');
      return;
    }

    const themeName = args[0];
    const settings = themeService.getSettings(themeName);

    console.log(`\nTheme settings: ${themeName}\n`);
    console.log(JSON.stringify(settings, null, 2));
    console.log('');
  }, 'Show theme settings');

  /**
   * theme:set <name> <key> <value> - Set theme setting
   */
  register('theme:set', async (args, ctx) => {
    const themeService = ctx.services.get('themeEngine');
    if (!themeService) {
      console.error('Theme service not available');
      return;
    }

    if (args.length < 3) {
      console.error('Usage: theme:set <name> <key> <value>');
      return;
    }

    const [themeName, key, ...valueParts] = args;
    const value = valueParts.join(' ');

    try {
      themeService.setSetting(themeName, key, value);
      console.log(`\nSet ${themeName}.${key} = ${value}\n`);
    } catch (error) {
      console.error(`Error: ${error.message}`);
    }
  }, 'Set theme setting');

  // ========================================
  // Theme Engine CLI Commands
  // (Layouts + Skins system)
  // ========================================

  /**
   * layouts:list - List available layouts
   */
  register('layouts:list', async (args, ctx) => {
    const engine = ctx.services.get('themeEngine');
    if (!engine) {
      console.error('Theme engine not available');
      return;
    }

    const layouts = engine.listLayouts();
    console.log(`\nLayouts (${layouts.length}):\n`);
    for (const layout of layouts) {
      const active = layout.id === engine.getActiveLayout()?.id ? ' [active]' : '';
      console.log(`  ${layout.id}${active}`);
      console.log(`    Name: ${layout.name}`);
      if (layout.description) console.log(`    ${layout.description}`);
      console.log(`    Regions: ${layout.regions.join(', ')}`);
    }
    console.log('');
  }, 'List available layouts');

  /**
   * skins:list - List available skins
   */
  register('skins:list', async (args, ctx) => {
    const engine = ctx.services.get('themeEngine');
    if (!engine) {
      console.error('Theme engine not available');
      return;
    }

    const layoutId = args[0] || null;
    const skins = engine.listSkins(layoutId);
    const filterNote = layoutId ? ` (compatible with ${layoutId})` : '';

    console.log(`\nSkins (${skins.length})${filterNote}:\n`);
    for (const skin of skins) {
      const active = skin.id === engine.getActiveSkin()?.id ? ' [active]' : '';
      console.log(`  ${skin.id}${active}`);
      console.log(`    Name: ${skin.name}`);
      if (skin.description) console.log(`    ${skin.description}`);
    }
    console.log('');
  }, 'List available skins (optionally filter by layout)');

  /**
   * skins:admin - List admin skins
   */
  register('skins:admin', async (args, ctx) => {
    const engine = ctx.services.get('themeEngine');
    if (!engine) {
      console.error('Theme engine not available');
      return;
    }

    const skins = engine.listAdminSkins();
    console.log(`\nAdmin Skins (${skins.length}):\n`);
    for (const skin of skins) {
      const active = skin.id === engine.getActiveAdminSkin()?.id ? ' [active]' : '';
      console.log(`  ${skin.id}${active}`);
      console.log(`    Name: ${skin.name}`);
      if (skin.description) console.log(`    ${skin.description}`);
    }
    console.log('');
  }, 'List admin skins');

  /**
   * theme-engine:status - Show current theme engine status
   */
  register('theme-engine:status', async (args, ctx) => {
    const engine = ctx.services.get('themeEngine');
    if (!engine) {
      console.error('Theme engine not available');
      return;
    }

    const theme = engine.getActiveTheme();
    const adminSkin = engine.getActiveAdminSkin();
    const stats = engine.refresh();

    console.log('\nTheme Engine Status:');
    console.log(`  Layouts: ${stats.layouts}`);
    console.log(`  Skins: ${stats.skins}`);
    console.log(`  Admin Skins: ${stats.adminSkins}`);
    console.log('\nActive Configuration:');
    console.log(`  Layout: ${theme.layout?.id || 'none'} (${theme.layout?.name || 'N/A'})`);
    console.log(`  Skin: ${theme.skin?.id || 'none'} (${theme.skin?.name || 'N/A'})`);
    console.log(`  Admin Skin: ${adminSkin?.id || 'none'} (${adminSkin?.name || 'N/A'})`);
    if (theme.skin?.cssPaths?.length) {
      console.log('\nSkin CSS:');
      for (const path of theme.skin.cssPaths) {
        console.log(`  ${path}`);
      }
    }
    console.log('');
  }, 'Show theme engine status');

  /**
   * theme-engine:set <layout> <skin> - Set active layout and skin
   */
  register('theme-engine:set', async (args, ctx) => {
    const engine = ctx.services.get('themeEngine');
    if (!engine) {
      console.error('Theme engine not available');
      return;
    }

    if (args.length < 2) {
      console.error('Usage: theme-engine:set <layout> <skin>');
      console.log('  Example: theme-engine:set immersive consciousness-dark');
      return;
    }

    const [layoutId, skinId] = args;

    try {
      const result = engine.setActiveTheme(layoutId, skinId);
      console.log(`\nTheme updated:`);
      console.log(`  Layout: ${result.layout?.id}`);
      console.log(`  Skin: ${result.skin?.id}\n`);
    } catch (error) {
      console.error(`Error: ${error.message}`);
    }
  }, 'Set active layout and skin');

  /**
   * theme-engine:admin <skin> - Set admin skin
   */
  register('theme-engine:admin', async (args, ctx) => {
    const engine = ctx.services.get('themeEngine');
    if (!engine) {
      console.error('Theme engine not available');
      return;
    }

    if (args.length === 0) {
      console.error('Usage: theme-engine:admin <skin>');
      console.log('  Example: theme-engine:admin dark');
      return;
    }

    const skinId = args[0];

    try {
      const result = engine.setAdminSkin(skinId);
      console.log(`\nAdmin skin updated: ${result.id}\n`);
    } catch (error) {
      console.error(`Error: ${error.message}`);
    }
  }, 'Set admin skin');

  /**
   * theme-engine:refresh - Refresh theme discovery
   */
  register('theme-engine:refresh', async (args, ctx) => {
    const engine = ctx.services.get('themeEngine');
    if (!engine) {
      console.error('Theme engine not available');
      return;
    }

    const stats = engine.refresh();
    console.log(`\nTheme engine refreshed:`);
    console.log(`  Layouts: ${stats.layouts}`);
    console.log(`  Skins: ${stats.skins}`);
    console.log(`  Admin Skins: ${stats.adminSkins}\n`);
  }, 'Refresh theme discovery');

  /**
   * batch:list - List active batches
   */
  register('batch:list', async (args, ctx) => {
    const batchService = ctx.services.get('batch');
    if (!batchService) {
      console.error('Batch service not available');
      return;
    }

    const batches = batchService.list();

    console.log(`\nActive batches (${batches.length}):\n`);
    for (const batch of batches) {
      const percent = Math.round((batch.current / batch.total) * 100);
      console.log(`  ${batch.id}`);
      console.log(`    Progress: ${batch.current}/${batch.total} (${percent}%)`);
      console.log(`    Status: ${batch.status || 'running'}`);
    }
    console.log('');
  }, 'List active batches');

  /**
   * batch:status <id> - Show batch progress
   */
  register('batch:status', async (args, ctx) => {
    const batchService = ctx.services.get('batch');
    if (!batchService) {
      console.error('Batch service not available');
      return;
    }

    if (args.length === 0) {
      console.error('Usage: batch:status <id>');
      return;
    }

    const batchId = args[0];
    const batch = batchService.get(batchId);

    if (!batch) {
      console.error(`Batch not found: ${batchId}`);
      return;
    }

    const percent = Math.round((batch.current / batch.total) * 100);

    console.log(`\nBatch: ${batch.id}`);
    console.log(`Progress: ${batch.current}/${batch.total} (${percent}%)`);
    console.log(`Status: ${batch.status || 'running'}`);
    if (batch.message) {
      console.log(`Message: ${batch.message}`);
    }
    console.log('');
  }, 'Show batch progress');

  /**
   * batch:cancel <id> - Cancel batch
   */
  register('batch:cancel', async (args, ctx) => {
    const batchService = ctx.services.get('batch');
    if (!batchService) {
      console.error('Batch service not available');
      return;
    }

    if (args.length === 0) {
      console.error('Usage: batch:cancel <id>');
      return;
    }

    const batchId = args[0];

    try {
      batchService.cancel(batchId);
      console.log(`\nCancelled batch: ${batchId}\n`);
    } catch (error) {
      console.error(`Error: ${error.message}`);
    }
  }, 'Cancel batch');

  /**
   * status:report - Full status report
   */
  register('status:report', async (args, ctx) => {
    const statusService = ctx.services.get('status');
    if (!statusService) {
      console.error('Status service not available');
      return;
    }

    const report = statusService.getReport();

    console.log(`\nSystem Status Report\n`);
    for (const [name, status] of Object.entries(report)) {
      const icon = status.status === 'ok' ? '✓' : status.status === 'warning' ? '⚠' : '✗';
      console.log(`  ${icon} ${name}: ${status.status}`);
      if (status.message) {
        console.log(`    ${status.message}`);
      }
    }
    console.log('');
  }, 'Full status report');

  /**
   * status:check <name> - Run specific check
   */
  register('status:check', async (args, ctx) => {
    const statusService = ctx.services.get('status');
    if (!statusService) {
      console.error('Status service not available');
      return;
    }

    if (args.length === 0) {
      console.error('Usage: status:check <name>');
      return;
    }

    const checkName = args[0];

    try {
      const result = await statusService.check(checkName);
      console.log(`\nCheck: ${checkName}`);
      console.log(`Status: ${result.status}`);
      if (result.message) {
        console.log(`Message: ${result.message}`);
      }
      console.log('');
    } catch (error) {
      console.error(`Error: ${error.message}`);
    }
  }, 'Run specific check');

  /**
   * help:topics - List help topics
   */
  register('help:topics', async (args, ctx) => {
    const helpService = ctx.services.get('help');
    if (!helpService) {
      console.error('Help service not available');
      return;
    }

    const topics = helpService.getTopics();

    console.log(`\nHelp topics (${topics.length}):\n`);
    for (const topic of topics) {
      console.log(`  ${topic.id}`);
      if (topic.title) {
        console.log(`    ${topic.title}`);
      }
    }
    console.log('');
  }, 'List help topics');

  /**
   * help:show <topic> - Display help topic
   */
  register('help:show', async (args, ctx) => {
    const helpService = ctx.services.get('help');
    if (!helpService) {
      console.error('Help service not available');
      return;
    }

    if (args.length === 0) {
      console.error('Usage: help:show <topic>');
      return;
    }

    const topicId = args[0];
    const topic = helpService.getTopic(topicId);

    if (!topic) {
      console.error(`Topic not found: ${topicId}`);
      return;
    }

    console.log(`\n${topic.title || topicId}\n`);
    console.log(topic.content);
    console.log('');
  }, 'Display help topic');

  /**
   * help:search <query> - Search help
   */
  register('help:search', async (args, ctx) => {
    const helpService = ctx.services.get('help');
    if (!helpService) {
      console.error('Help service not available');
      return;
    }

    if (args.length === 0) {
      console.error('Usage: help:search <query>');
      return;
    }

    const query = args.join(' ');
    const results = helpService.search(query);

    console.log(`\nSearch: "${query}"`);
    console.log(`Results: ${results.length}\n`);
    for (const result of results) {
      console.log(`  ${result.id}: ${result.title}`);
      if (result.excerpt) {
        console.log(`    ${result.excerpt}`);
      }
    }
    console.log('');
  }, 'Search help');

  // ========================================
  // LAYOUT BUILDER CLI COMMANDS
  // ========================================

  /**
   * layout:list - List all layout definitions
   */
  register('layout:list', async (args, ctx) => {
    const layoutBuilder = ctx.services.get('layoutBuilder');
    if (!layoutBuilder) {
      console.log('Layout Builder service not available');
      return;
    }

    const layouts = layoutBuilder.listLayouts();
    const categories = layoutBuilder.listCategories();

    console.log('\n=== Layout Definitions ===\n');

    for (const category of categories) {
      const categoryLayouts = layouts.filter(l => l.category === category);
      console.log(`${category}:`);
      for (const layout of categoryLayouts) {
        const regions = Object.keys(layout.regions).join(', ');
        console.log(`  ${layout.id} - ${layout.label}`);
        console.log(`    Regions: ${regions}`);
      }
      console.log('');
    }

    // Show stats
    const stats = layoutBuilder.getStats();
    console.log(`Stats: ${stats.layouts} layouts, ${stats.contentTypesWithDefaults} content types with defaults`);
    console.log('');
  }, 'List all layout definitions');

  /**
   * layout:sections <type> [id] - List sections in a layout
   */
  register('layout:sections', async (args, ctx) => {
    const layoutBuilder = ctx.services.get('layoutBuilder');
    if (!layoutBuilder) {
      console.log('Layout Builder service not available');
      return;
    }

    const type = args[0];
    const id = args[1];

    if (!type) {
      // List content types with defaults
      const types = layoutBuilder.listDefaultLayouts();
      console.log('\n=== Content Types with Default Layouts ===\n');
      if (types.length === 0) {
        console.log('No content types have default layouts configured.');
      } else {
        for (const t of types) {
          const layout = layoutBuilder.getDefaultLayout(t);
          const sectionCount = layout?.sections?.length || 0;
          console.log(`  ${t}: ${sectionCount} section(s)`);
        }
      }
      console.log('');
      return;
    }

    // Get effective layout
    const layout = layoutBuilder.getEffectiveLayout(type, id);

    if (!layout) {
      console.log(`No layout found for ${type}${id ? `/${id}` : ''}`);
      return;
    }

    const isOverride = id && layoutBuilder.hasContentLayoutOverride(type, id);
    console.log(`\n=== Layout for ${type}${id ? `/${id}` : ''} ${isOverride ? '(override)' : '(default)'} ===\n`);

    if (!layout.sections || layout.sections.length === 0) {
      console.log('No sections defined.');
      return;
    }

    for (const section of layout.sections) {
      const layoutDef = layoutBuilder.getLayout(section.layoutId);
      console.log(`Section: ${section.uuid.substring(0, 8)}... (${layoutDef?.label || section.layoutId})`);
      console.log(`  Layout: ${section.layoutId}`);
      console.log(`  Weight: ${section.weight}`);

      if (Object.keys(section.settings || {}).length > 0) {
        console.log(`  Settings: ${JSON.stringify(section.settings)}`);
      }

      // Show components per region
      for (const [regionId, components] of Object.entries(section.components || {})) {
        if (components.length > 0) {
          console.log(`  Region "${regionId}": ${components.length} component(s)`);
          for (const comp of components) {
            const compType = comp.type === 'block' ? `block:${comp.blockId}` :
              comp.type === 'inline_block' ? `inline:${comp.blockType}` :
              comp.type === 'field' ? `field:${comp.fieldName}` : comp.type;
            console.log(`    - ${comp.uuid.substring(0, 8)}... (${compType})`);
          }
        }
      }
      console.log('');
    }
  }, 'List sections in a layout');

  /**
   * layout:add-section <type> <layoutId> [--position=N] - Add section to default layout
   */
  register('layout:add-section', async (args, ctx) => {
    const layoutBuilder = ctx.services.get('layoutBuilder');
    if (!layoutBuilder) {
      console.log('Layout Builder service not available');
      return;
    }

    const type = args[0];
    const layoutId = args[1];

    if (!type || !layoutId) {
      console.log('Usage: layout:add-section <contentType> <layoutId> [--position=N]');
      console.log('Example: layout:add-section page two_column --position=0');
      return;
    }

    // Verify layout exists
    const layoutDef = layoutBuilder.getLayout(layoutId);
    if (!layoutDef) {
      console.log(`Layout not found: ${layoutId}`);
      console.log('Available layouts:', layoutBuilder.listLayouts().map(l => l.id).join(', '));
      return;
    }

    // Parse position
    let position = null;
    const posArg = args.find(a => a.startsWith('--position='));
    if (posArg) {
      position = parseInt(posArg.split('=')[1]);
    }

    // Get or create default layout
    let storage = layoutBuilder.getDefaultLayout(type) || { sections: [] };

    // Create and add section
    const section = layoutBuilder.createSection(layoutId);
    storage = layoutBuilder.addSection(storage, section, position);

    // Save
    await layoutBuilder.setDefaultLayout(type, storage);

    console.log(`\nAdded section using "${layoutDef.label}" layout to ${type}`);
    console.log(`Section UUID: ${section.uuid}`);
    console.log(`Total sections: ${storage.sections.length}`);
    console.log('');
  }, 'Add a section to content type default layout');

  /**
   * layout:add-block <type> <sectionUuid> <regionId> <blockId> - Add block to section
   */
  register('layout:add-block', async (args, ctx) => {
    const layoutBuilder = ctx.services.get('layoutBuilder');
    if (!layoutBuilder) {
      console.log('Layout Builder service not available');
      return;
    }

    const [type, sectionUuid, regionId, blockId] = args;

    if (!type || !sectionUuid || !regionId || !blockId) {
      console.log('Usage: layout:add-block <contentType> <sectionUuid> <regionId> <blockId>');
      console.log('Example: layout:add-block page abc123 content my-block-id');
      return;
    }

    // Get default layout
    const storage = layoutBuilder.getDefaultLayout(type);
    if (!storage) {
      console.log(`No default layout found for ${type}`);
      return;
    }

    // Find section (match partial UUID)
    const section = storage.sections.find(s =>
      s.uuid === sectionUuid || s.uuid.startsWith(sectionUuid)
    );
    if (!section) {
      console.log(`Section not found: ${sectionUuid}`);
      return;
    }

    // Verify region exists
    const layoutDef = layoutBuilder.getLayout(section.layoutId);
    if (!layoutDef.regions[regionId]) {
      console.log(`Region not found: ${regionId}`);
      console.log('Available regions:', Object.keys(layoutDef.regions).join(', '));
      return;
    }

    // Create and add block component
    const component = layoutBuilder.createBlockComponent(blockId);
    layoutBuilder.addComponent(section, regionId, component);

    // Save
    await layoutBuilder.setDefaultLayout(type, storage);

    console.log(`\nAdded block "${blockId}" to section ${section.uuid.substring(0, 8)}... region "${regionId}"`);
    console.log(`Component UUID: ${component.uuid}`);
    console.log('');
  }, 'Add a block to a section region');

  /**
   * layout:remove-section <type> <sectionUuid> - Remove section from default layout
   */
  register('layout:remove-section', async (args, ctx) => {
    const layoutBuilder = ctx.services.get('layoutBuilder');
    if (!layoutBuilder) {
      console.log('Layout Builder service not available');
      return;
    }

    const [type, sectionUuid] = args;

    if (!type || !sectionUuid) {
      console.log('Usage: layout:remove-section <contentType> <sectionUuid>');
      return;
    }

    let storage = layoutBuilder.getDefaultLayout(type);
    if (!storage) {
      console.log(`No default layout found for ${type}`);
      return;
    }

    // Find section (match partial UUID)
    const section = storage.sections.find(s =>
      s.uuid === sectionUuid || s.uuid.startsWith(sectionUuid)
    );
    if (!section) {
      console.log(`Section not found: ${sectionUuid}`);
      return;
    }

    storage = layoutBuilder.removeSection(storage, section.uuid);
    await layoutBuilder.setDefaultLayout(type, storage);

    console.log(`\nRemoved section ${section.uuid.substring(0, 8)}... from ${type}`);
    console.log(`Remaining sections: ${storage.sections.length}`);
    console.log('');
  }, 'Remove a section from content type default layout');

  /**
   * layout:clear <type> - Clear all sections from default layout
   */
  register('layout:clear', async (args, ctx) => {
    const layoutBuilder = ctx.services.get('layoutBuilder');
    if (!layoutBuilder) {
      console.log('Layout Builder service not available');
      return;
    }

    const type = args[0];
    if (!type) {
      console.log('Usage: layout:clear <contentType>');
      return;
    }

    const confirm = args.includes('--yes') || args.includes('-y');
    if (!confirm) {
      console.log(`This will remove all sections from ${type} default layout.`);
      console.log('Add --yes to confirm.');
      return;
    }

    await layoutBuilder.deleteDefaultLayout(type);
    console.log(`\nCleared default layout for ${type}`);
    console.log('');
  }, 'Clear all sections from content type default layout');

  /**
   * layout:stats - Show layout builder statistics
   */
  register('layout:stats', async (args, ctx) => {
    const layoutBuilder = ctx.services.get('layoutBuilder');
    if (!layoutBuilder) {
      console.log('Layout Builder service not available');
      return;
    }

    const stats = layoutBuilder.getStats();
    const config = layoutBuilder.getConfig();

    console.log('\n=== Layout Builder Statistics ===\n');
    console.log(`Layout definitions: ${stats.layouts}`);
    console.log(`Content types with defaults: ${stats.contentTypesWithDefaults}`);
    console.log(`Total sections: ${stats.totalSections}`);
    console.log(`Total components: ${stats.totalComponents}`);
    console.log(`Render cache entries: ${stats.cacheSize}`);
    console.log('');
    console.log('Configuration:');
    console.log(`  Enabled: ${config.enabled}`);
    console.log(`  Per-content overrides: ${config.enableOverrides}`);
    console.log(`  Cache TTL: ${config.cacheTtl}s`);
    console.log(`  CSS class prefix: ${config.classPrefix}`);
    console.log('');
  }, 'Show layout builder statistics');

  /**
   * layout:render <type> [id] - Render layout HTML
   */
  register('layout:render', async (args, ctx) => {
    const layoutBuilder = ctx.services.get('layoutBuilder');
    if (!layoutBuilder) {
      console.log('Layout Builder service not available');
      return;
    }

    const type = args[0];
    const id = args[1];

    if (!type) {
      console.log('Usage: layout:render <contentType> [contentId]');
      return;
    }

    try {
      let html;
      if (id) {
        html = await layoutBuilder.renderContentLayout(type, id);
      } else {
        const layout = layoutBuilder.getDefaultLayout(type);
        if (!layout) {
          console.log(`No default layout found for ${type}`);
          return;
        }
        html = await layoutBuilder.renderLayout(layout, {});
      }

      console.log('\n=== Rendered Layout HTML ===\n');
      console.log(html || '(empty)');
      console.log('');
    } catch (error) {
      console.log(`Error: ${error.message}`);
    }
  }, 'Render layout to HTML');

  // ========================================
  // MEDIA LIBRARY CLI COMMANDS
  // ========================================

  /**
   * media:library [--type=image] [--limit=20] - List media entities
   */
  register('media:library', async (args, ctx) => {
    const mediaLibrary = ctx.services.get('mediaLibrary');
    if (!mediaLibrary) {
      console.log('Media Library not enabled');
      return;
    }

    let mediaType = null;
    let limit = 20;

    for (const arg of args) {
      if (arg.startsWith('--type=')) {
        mediaType = arg.substring(7);
      } else if (arg.startsWith('--limit=')) {
        limit = parseInt(arg.substring(8)) || 20;
      }
    }

    const result = mediaLibrary.list({ mediaType, limit });

    console.log(`\n=== Media Library (${result.total} items) ===\n`);

    if (result.items.length === 0) {
      console.log('No media items found.');
    } else {
      for (const item of result.items) {
        const size = item.size ? `(${Math.round(item.size / 1024)}KB)` : '';
        console.log(`  [${item.mediaType}] ${item.id} - ${item.name} ${size}`);
      }
    }
    console.log('');
  }, 'List media library items');

  /**
   * media:stats - Show media library statistics
   */
  register('media:stats', async (args, ctx) => {
    const mediaLibrary = ctx.services.get('mediaLibrary');
    if (!mediaLibrary) {
      console.log('Media Library not enabled');
      return;
    }

    const stats = mediaLibrary.getStats();

    console.log('\n=== Media Library Statistics ===\n');
    console.log(`Total items: ${stats.total}`);
    console.log(`Total size: ${Math.round(stats.totalSize / 1024 / 1024)}MB`);
    console.log(`Recently added (7 days): ${stats.recentlyAdded}`);
    console.log('\nBy type:');
    for (const [type, count] of Object.entries(stats.byType)) {
      console.log(`  ${type}: ${count}`);
    }
    console.log('');
  }, 'Show media library statistics');

  /**
   * media:types - List available media types
   */
  register('media:types', async (args, ctx) => {
    const mediaLibrary = ctx.services.get('mediaLibrary');
    if (!mediaLibrary) {
      console.log('Media Library not enabled');
      return;
    }

    const types = mediaLibrary.listMediaTypes();

    console.log('\n=== Media Types ===\n');
    for (const type of types) {
      console.log(`  ${type.id}: ${type.label}`);
      console.log(`    ${type.description}`);
      if (type.extensions.length > 0) {
        console.log(`    Extensions: ${type.extensions.join(', ')}`);
      }
    }
    console.log('');
  }, 'List available media types');

  /**
   * media:usage <id> - Show where a media item is used
   */
  register('media:usage', async (args, ctx) => {
    const mediaLibrary = ctx.services.get('mediaLibrary');
    if (!mediaLibrary) {
      console.log('Media Library not enabled');
      return;
    }

    if (args.length < 1) {
      console.error('Usage: media:usage <media-id>');
      return;
    }

    const id = args[0];
    const usage = mediaLibrary.getUsage(id);

    console.log(`\n=== Media Usage: ${id} ===\n`);
    if (usage.length === 0) {
      console.log('Not used anywhere.');
    } else {
      for (const ref of usage) {
        console.log(`  ${ref.contentType}/${ref.contentId} (field: ${ref.field})`);
      }
    }
    console.log('');
  }, 'Show where a media item is used');

  /**
   * media:create-from-url <url> - Create media entity from remote URL with oEmbed metadata
   *
   * WHY: Tests the full oEmbed metadata extraction pipeline.
   * Fetches oEmbed data from the provider, extracts title/author/dimensions,
   * and stores everything with the media entity for later retrieval.
   */
  register('media:create-from-url', async (args, ctx) => {
    const mediaLibrary = ctx.services.get('mediaLibrary');
    if (!mediaLibrary) {
      console.log('Media library not enabled');
      return;
    }

    if (args.length < 1) {
      console.error('Usage: media:create-from-url <url> [--name="Video Title"]');
      return;
    }

    const url = args[0];
    const nameFlag = args.find(a => a.startsWith('--name='));
    const name = nameFlag ? nameFlag.replace('--name=', '') : undefined;

    try {
      const entity = await mediaLibrary.createFromUrl(url, { name });
      console.log(`\n=== Media Entity Created ===\n`);
      console.log(`  ID: ${entity.id}`);
      console.log(`  Name: ${entity.name}`);
      console.log(`  Type: ${entity.mediaType}`);
      console.log(`  Credit: ${entity.credit}`);
      console.log(`  Thumbnail: ${entity.thumbnail || 'none'}`);
      if (entity.metadata && entity.metadata.oembed) {
        const oe = entity.metadata.oembed;
        console.log(`\n  oEmbed Metadata:`);
        console.log(`    Title: ${oe.title || 'N/A'}`);
        console.log(`    Author: ${oe.author_name || 'N/A'}`);
        console.log(`    Provider: ${oe.provider_name || 'N/A'}`);
        console.log(`    Dimensions: ${oe.width || '?'}x${oe.height || '?'}`);
        console.log(`    Thumbnail: ${oe.thumbnail_url || 'N/A'}`);
      } else {
        console.log(`\n  oEmbed Metadata: not available (fetch may have failed)`);
      }
      console.log('');
    } catch (err) {
      console.error(`Error: ${err.message}`);
    }
  }, 'Create media entity from remote URL with oEmbed metadata');

  /**
   * media:show <id> - Show full media entity details including oEmbed metadata
   */
  register('media:show', async (args, ctx) => {
    const mediaLibrary = ctx.services.get('mediaLibrary');
    if (!mediaLibrary) {
      console.log('Media library not enabled');
      return;
    }

    if (args.length < 1) {
      console.error('Usage: media:show <media-entity-id>');
      return;
    }

    const entity = mediaLibrary.get(args[0]);
    if (!entity) {
      console.error('Media entity not found');
      return;
    }

    console.log(`\n=== Media Entity: ${entity.id} ===\n`);
    console.log(`  Name: ${entity.name}`);
    console.log(`  Type: ${entity.mediaType}`);
    console.log(`  Path: ${entity.path}`);
    console.log(`  Credit: ${entity.credit || 'N/A'}`);
    console.log(`  Alt: ${entity.alt || 'N/A'}`);
    console.log(`  Thumbnail: ${entity.thumbnail || 'N/A'}`);
    console.log(`  Status: ${entity.status}`);
    console.log(`  Created: ${entity.created}`);

    if (entity.metadata) {
      console.log(`\n  Metadata:`);
      console.log(`    URL: ${entity.metadata.url || 'N/A'}`);
      console.log(`    Provider: ${entity.metadata.provider || 'N/A'}`);
      console.log(`    Video ID: ${entity.metadata.videoId || 'N/A'}`);
      console.log(`    Embed URL: ${entity.metadata.embedUrl || 'N/A'}`);

      if (entity.metadata.oembed) {
        const oe = entity.metadata.oembed;
        console.log(`\n  oEmbed Metadata:`);
        console.log(`    Type: ${oe.type || 'N/A'}`);
        console.log(`    Title: ${oe.title || 'N/A'}`);
        console.log(`    Author: ${oe.author_name || 'N/A'} (${oe.author_url || 'N/A'})`);
        console.log(`    Provider: ${oe.provider_name || 'N/A'} (${oe.provider_url || 'N/A'})`);
        console.log(`    Dimensions: ${oe.width || '?'}x${oe.height || '?'}`);
        console.log(`    Thumbnail: ${oe.thumbnail_url || 'N/A'} (${oe.thumbnail_width || '?'}x${oe.thumbnail_height || '?'})`);
      }
    }
    console.log('');
  }, 'Show full media entity details including oEmbed metadata');

  // ========================================
  // EDITOR CLI COMMANDS
  // ========================================

  /**
   * editor:formats - List editor formats
   */
  register('editor:formats', async (args, ctx) => {
    const editor = ctx.services.get('editor');
    if (!editor) {
      console.log('Editor not enabled');
      return;
    }

    const formats = editor.listFormats();

    console.log('\n=== Editor Formats ===\n');
    for (const format of formats) {
      const source = format.source === 'builtin' ? '(built-in)' : '';
      console.log(`  ${format.id}: ${format.label} ${source}`);
      console.log(`    ${format.description}`);
      console.log(`    Toolbar: ${format.toolbar.length} rows`);
    }
    console.log('');
  }, 'List editor formats');

  /**
   * editor:buttons [--category=formatting] - List toolbar buttons
   */
  register('editor:buttons', async (args, ctx) => {
    const editor = ctx.services.get('editor');
    if (!editor) {
      console.log('Editor not enabled');
      return;
    }

    let category = null;
    for (const arg of args) {
      if (arg.startsWith('--category=')) {
        category = arg.substring(11);
      }
    }

    const buttons = editor.listButtons(category);
    const categories = editor.listButtonCategories();

    console.log('\n=== Editor Toolbar Buttons ===\n');
    if (category) {
      console.log(`Category: ${category}\n`);
    } else {
      console.log(`Categories: ${categories.join(', ')}\n`);
    }

    for (const button of buttons) {
      const shortcut = button.shortcut ? ` [${button.shortcut}]` : '';
      console.log(`  ${button.id}: ${button.label}${shortcut}`);
    }
    console.log('');
  }, 'List available toolbar buttons');

  /**
   * editor:config <format> - Show editor config for a format
   */
  register('editor:config', async (args, ctx) => {
    const editor = ctx.services.get('editor');
    if (!editor) {
      console.log('Editor not enabled');
      return;
    }

    const formatId = args[0] || 'basic';
    
    try {
      const config = editor.getEditorConfig(formatId);
      console.log(`\n=== Editor Config: ${formatId} ===\n`);
      console.log(JSON.stringify(config, null, 2));
      console.log('');
    } catch (error) {
      console.log(`Error: ${error.message}`);
    }
  }, 'Show editor configuration for a format');

  // ========================================
  // RESPONSIVE IMAGES CLI COMMANDS
  // ========================================

  /**
   * images:breakpoints - List responsive breakpoints
   */
  register('images:breakpoints', async (args, ctx) => {
    const responsiveImages = ctx.services.get('responsiveImages');
    if (!responsiveImages) {
      console.log('Responsive Images not enabled');
      return;
    }

    const breakpoints = responsiveImages.listBreakpoints();

    console.log('\n=== Responsive Breakpoints ===\n');
    for (const bp of breakpoints) {
      const range = bp.maxWidth 
        ? `${bp.minWidth || 0}px - ${bp.maxWidth}px`
        : `${bp.minWidth}px+`;
      console.log(`  ${bp.id}: ${bp.label} (${range})`);
      console.log(`    ${bp.mediaQuery}`);
    }
    console.log('');
  }, 'List responsive image breakpoints');

  /**
   * images:responsive - List responsive image styles
   */
  register('images:responsive', async (args, ctx) => {
    const responsiveImages = ctx.services.get('responsiveImages');
    if (!responsiveImages) {
      console.log('Responsive Images not enabled');
      return;
    }

    const styles = responsiveImages.listResponsiveStyles();

    console.log('\n=== Responsive Image Styles ===\n');
    for (const style of styles) {
      const source = style.source === 'builtin' ? '(built-in)' : '';
      console.log(`  ${style.id}: ${style.label} ${source}`);
      console.log(`    ${style.description}`);
      console.log(`    Mappings:`);
      for (const [bp, imgStyle] of Object.entries(style.mappings)) {
        console.log(`      ${bp} → ${imgStyle}`);
      }
    }
    console.log('');
  }, 'List responsive image styles');

  /**
   * images:render <path> <style> [--picture] - Generate responsive image HTML
   */
  register('images:render', async (args, ctx) => {
    const responsiveImages = ctx.services.get('responsiveImages');
    if (!responsiveImages) {
      console.log('Responsive Images not enabled');
      return;
    }

    if (args.length < 2) {
      console.error('Usage: images:render <image-path> <style> [--picture]');
      return;
    }

    const imagePath = args[0];
    const styleId = args[1];
    const usePicture = args.includes('--picture');

    try {
      const html = await responsiveImages.render(imagePath, styleId, {
        artDirection: usePicture,
        alt: 'Sample image',
      });
      console.log('\n=== Responsive Image HTML ===\n');
      console.log(html);
      console.log('');
    } catch (error) {
      console.log(`Error: ${error.message}`);
    }
  }, 'Generate responsive image HTML');

  // ========================================
  // JSON:API CLI COMMANDS
  // ========================================

  /**
   * jsonapi:resources - List JSON:API resources
   */
  register('jsonapi:resources', async (args, ctx) => {
    const jsonapi = ctx.services.get('jsonapi');
    if (!jsonapi) {
      console.log('JSON:API not enabled');
      return;
    }

    const config = jsonapi.getConfig();

    console.log('\n=== JSON:API Resources ===\n');
    console.log(`Base path: ${config.basePath}`);
    console.log(`Default page limit: ${config.defaultPageLimit}`);
    console.log(`Max page limit: ${config.maxPageLimit}`);
    console.log(`Include depth: ${config.includeDepth}`);
    console.log('');
  }, 'Show JSON:API configuration');

  /**
   * jsonapi:fetch <type> [id] [--include=...] - Fetch resources via JSON:API
   */
  register('jsonapi:fetch', async (args, ctx) => {
    if (args.length < 1) {
      console.error('Usage: jsonapi:fetch <type> [id] [--include=rel1,rel2]');
      return;
    }

    const type = args[0];
    const id = args[1] && !args[1].startsWith('--') ? args[1] : null;
    
    let include = '';
    for (const arg of args) {
      if (arg.startsWith('--include=')) {
        include = `?include=${arg.substring(10)}`;
      }
    }

    const port = ctx.config.site.port || 3000;
    const path = id ? `/jsonapi/${type}/${id}${include}` : `/jsonapi/${type}${include}`;
    const url = `http://localhost:${port}${path}`;

    console.log(`\nFetching: ${url}\n`);

    try {
      // Use native fetch if available, otherwise show curl command
      if (typeof fetch !== 'undefined') {
        const response = await fetch(url, {
          headers: { 'Accept': 'application/vnd.api+json' }
        });
        const data = await response.json();
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.log('Run this to fetch:');
        console.log(`  curl -H "Accept: application/vnd.api+json" "${url}"`);
      }
      console.log('');
    } catch (error) {
      console.log(`Error: ${error.message}`);
    }
  }, 'Fetch resources via JSON:API');
}

/**
 * Middleware hook - register admin middleware
 *
 * This middleware runs for all /admin/* requests:
 * - Logs access
 * - Parses form body for POST requests
 * - Validates CSRF tokens
 */
export function hook_middleware(use, context) {
  const auth = context.services.get('auth');

  // Register access logging middleware for /admin paths
  use(async (req, res, ctx, next) => {
    const url = req.url || '/';
    console.log(`[admin] Access: ${url}`);
    await next();
  }, 'access', '/admin');

  // Register CSRF middleware for /admin POST requests
  // Parses URL-encoded form body and validates CSRF token
  use(async (req, res, ctx, next) => {
    const method = req.method || 'GET';

    // Skip non-mutating methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      await next();
      return;
    }

    // Skip if CSRF is disabled
    const csrfStatus = auth.getCSRFStatus();
    if (!csrfStatus.enabled) {
      await next();
      return;
    }

    // Skip file uploads (multipart) - they're handled differently
    // The import handler validates CSRF from the fields object
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('multipart/form-data')) {
      await next();
      return;
    }

    // Parse URL-encoded body and store in context
    try {
      const body = await parseFormBodyOnce(req);
      ctx._parsedBody = body;

      // Extract and validate CSRF token
      const token = body._csrf || req.headers['x-csrf-token'];

      if (!token) {
        console.warn(`[csrf] Missing token for ${method} ${req.url}`);
        res.writeHead(403, { 'Content-Type': 'text/html' });
        res.end('<h1>403 Forbidden</h1><p>Missing CSRF token. Please refresh the page and try again.</p>');
        return;
      }

      if (!auth.validateCSRFToken(req, token)) {
        console.warn(`[csrf] Invalid token for ${method} ${req.url}`);
        res.writeHead(403, { 'Content-Type': 'text/html' });
        res.end('<h1>403 Forbidden</h1><p>Invalid CSRF token. Please refresh the page and try again.</p>');
        return;
      }

      await next();
    } catch (error) {
      console.error(`[admin] Body parsing error: ${error.message}`);
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<h1>400 Bad Request</h1><p>Invalid form data.</p>');
    }
  }, 'csrf', '/admin');
}

/**
 * Parse form body once and cache it
 * Used by CSRF middleware to parse before route handlers
 */
function parseFormBodyOnce(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1024 * 1024) {
        reject(new Error('Form data too large'));
      }
    });

    req.on('end', () => {
      try {
        const data = {};
        const pairs = body.split('&');

        for (const pair of pairs) {
          const [key, value] = pair.split('=').map(s => decodeURIComponent(s.replace(/\+/g, ' ')));
          if (key) {
            if (data[key]) {
              if (Array.isArray(data[key])) {
                data[key].push(value || '');
              } else {
                data[key] = [data[key], value || ''];
              }
            } else {
              data[key] = value || '';
            }
          }
        }

        resolve(data);
      } catch (error) {
        reject(new Error('Invalid form data'));
      }
    });

    req.on('error', reject);
  });
}

/**
 * Routes hook - register admin routes
 */
export function hook_routes(register, context) {
  const server = context.services.get('server');
  const content = context.services.get('content');
  const template = context.services.get('template');
  const auth = context.services.get('auth');

  /**
   * Render an admin page with layout
   *
   * CSRF TOKEN INJECTION:
   * Automatically injects csrfToken into template data
   * so {{csrfField}} helper works in all admin templates.
   */
  function renderAdmin(templateName, data, ctx, req) {
    // Get CSRF token for current session
    const csrfToken = req ? auth.getCSRFToken(req) : null;

    // Get workspace context for switcher and status indicator
    const workspacesService = ctx.services?.get('workspaces');
    let activeWorkspace = null;
    let workspaceList = [];
    if (workspacesService) {
      activeWorkspace = workspacesService.getWorkspaceContext(req);
      workspaceList = workspacesService.list({ status: 'active' }).map(ws => ({
        ...ws,
        isCurrent: activeWorkspace && activeWorkspace.id === ws.id,
      }));
    }

    const adminTemplate = loadTemplate(templateName);
    const pageContent = template.renderString(adminTemplate, {
      ...data,
      csrfToken, // Inject for {{csrfField}} helper
    });

    // Determine active nav item from request path
    const path = req?.url?.split('?')[0] || '/admin';
    const navDashboard = path === '/admin';
    const navContent = path.startsWith('/admin/content') || path.startsWith('/admin/comments') || path.startsWith('/admin/trash') || path.startsWith('/admin/moderation');
    const navStructure = path.startsWith('/admin/structure') || path.startsWith('/admin/views') || path.startsWith('/admin/menus') || path.startsWith('/admin/taxonomy') || path.startsWith('/admin/blocks') || path.startsWith('/admin/blueprints');
    const navAppearance = path.startsWith('/admin/appearance') || path.startsWith('/admin/themes');
    const navModules = path === '/admin/modules' || path.startsWith('/admin/modules/');
    const navConfig = path.startsWith('/admin/config') || path.startsWith('/admin/cron') || path.startsWith('/admin/aliases') || path.startsWith('/admin/text-formats') || path.startsWith('/admin/image-styles') || path.startsWith('/admin/tokens') || path.startsWith('/admin/regions');
    const navPeople = path.startsWith('/admin/users') || path.startsWith('/admin/permissions') || path.startsWith('/admin/roles');
    const navReports = path.startsWith('/admin/reports') || path.startsWith('/admin/analytics') || path.startsWith('/admin/audit') || path.startsWith('/admin/cache') || path.startsWith('/admin/queue') || path.startsWith('/admin/ratelimit');

    const username = ctx.session?.user?.username || 'admin';

    return template.renderWithLayout('admin-layout.html', pageContent, {
      title: data.pageTitle || 'Admin',
      siteName: ctx.config.site.name,
      version: ctx.config.site.version,
      csrfToken,
      username,
      navDashboard, navContent, navStructure, navAppearance,
      navModules, navConfig, navPeople, navReports,
      // Workspace data for switcher and status indicator
      hasWorkspaces: workspaceList.length > 0,
      workspaces: workspaceList,
      hasActiveWorkspace: !!activeWorkspace,
      activeWorkspaceName: activeWorkspace ? activeWorkspace.label : 'Live',
      activeWorkspaceId: activeWorkspace ? activeWorkspace.id : '',
      isLiveWorkspace: !activeWorkspace,
    });
  }

  /**
   * Redirect helper
   */
  function redirect(res, url) {
    res.writeHead(302, { Location: url });
    res.end();
  }

  // ==========================================
  // Dashboard
  // ==========================================

  /**
   * GET /admin - Dashboard overview
   */
  register('GET', '/admin', async (req, res, params, ctx) => {
    const types = content.listTypes();
    const enabledModules = ctx.config.modules.enabled || [];
    const allModules = ctx.modules || [];

    // Separate internal/system content types from user-created ones
    // Internal types are registered by core modules via hook_content
    const internalTypes = new Set([
      'user', 'apitoken', 'webhook', 'media', 'taskrun',
      'comment', 'term', 'menu', 'menu-item', 'greeting',
    ]);
    const userTypes = types.filter(t => !internalTypes.has(t.type));
    const systemTypes = types.filter(t => internalTypes.has(t.type));

    // Get recent content across all types
    const recentContent = [];
    for (const { type } of types) {
      const items = content.list(type, { limit: 3 }).items;
      for (const item of items) {
        recentContent.push({ ...item, _type: type });
      }
    }
    // Sort by created date, newest first
    recentContent.sort((a, b) => new Date(b.created) - new Date(a.created));
    const recent = recentContent.slice(0, 5).map(item => ({
      ...item,
      createdFormatted: formatDate(item.created),
    }));

    // Content stats - show user types first, then system types
    const userContentStats = userTypes.map(({ type, source }) => ({
      type,
      source,
      count: content.list(type).total,
      isSystem: false,
    }));
    const systemContentStats = systemTypes.map(({ type, source }) => ({
      type,
      source,
      count: content.list(type).total,
      isSystem: true,
    }));

    // Count total content items
    let totalContentItems = 0;
    for (const { type } of types) {
      totalContentItems += content.list(type).total;
    }

    // Count registered core services
    const coreServiceCount = ctx.services?.list ? ctx.services.list().length : 0;

    const flash = getFlashMessage(req.url);

    // Get user's favorites for dashboard widget
    let favorites = [];
    let totalFavorites = 0;
    const user = ctx.session?.user;
    if (user) {
      const favoritesService = ctx.services.get('favorites');
      if (favoritesService) {
        const allFavorites = favoritesService.getFavorites(user.id, { includeContent: true });
        totalFavorites = allFavorites.length;
        favorites = allFavorites.slice(0, 5).map(fav => ({
          ...fav,
          title: fav.content?.title || fav.content?.name || fav.content?.username || fav.contentId,
        }));
      }
    }

    // Get recent activity for dashboard widget
    let recentActivity = [];
    const activityService = ctx.services.get('activity');
    if (activityService) {
      const activityResult = activityService.getFeed({ limit: 5, aggregate: true });
      recentActivity = activityResult.activities.map(act => ({
        ...act,
        iconClass: act.action.includes('create') ? 'icon-plus' :
                   act.action.includes('update') ? 'icon-edit' :
                   act.action.includes('delete') ? 'icon-trash' :
                   act.action.includes('publish') ? 'icon-check' : 'icon-activity',
        countDisplay: act.count > 1 ? `(${act.count} times)` : '',
      }));
    }

    // Count users
    const userCount = content.list('user').total;

    const html = renderAdmin('dashboard.html', {
      pageTitle: 'Dashboard',
      userContentTypeCount: userTypes.length,
      totalContentItems,
      userCount,
      coreServiceCount,
      theme: ctx.config.site.theme || 'default',
      userContentStats,
      hasUserContentStats: userContentStats.length > 0,
      systemContentStats,
      hasSystemContentStats: systemContentStats.length > 0,
      recentContent: recent,
      hasRecentContent: recent.length > 0,
      favorites,
      hasFavorites: favorites.length > 0,
      totalFavorites,
      hasMoreFavorites: totalFavorites > 5,
      recentActivity,
      hasActivity: recentActivity.length > 0,
      flash,
      hasFlash: !!flash,
      username: user?.username || 'admin',
    }, ctx, req);

    server.html(res, html);
  }, 'Admin dashboard');

  /**
   * POST /admin/workspace/switch - Switch active workspace
   *
   * WHY FORM POST:
   * Uses a standard HTML form POST for workspace switching.
   * This follows Drupal's workspace switcher pattern where the
   * workspace context is set server-side via session/cookies.
   */
  register('POST', '/admin/workspace/switch', async (req, res, params, ctx) => {
    const workspacesService = ctx.services.get('workspaces');
    if (!workspacesService) {
      redirect(res, '/admin?message=Workspaces+not+available&type=error');
      return;
    }

    const formData = ctx._parsedBody || {};
    const workspaceId = formData.workspace_id || '';

    try {
      if (!workspaceId || workspaceId === 'live') {
        // Switch to live
        workspacesService.setActiveWorkspace(null);
        // Also clear HTTP session workspace
        if (req.sessionId) {
          workspacesService.setSessionWorkspace(req.sessionId, null);
        }
        redirect(res, '/admin?message=Switched+to+Live+workspace&type=success');
      } else {
        // Switch to specific workspace
        workspacesService.setActiveWorkspace(workspaceId);
        if (req.sessionId) {
          workspacesService.setSessionWorkspace(req.sessionId, workspaceId);
        }
        const ws = workspacesService.get(workspaceId) || workspacesService.getByMachineName(workspaceId);
        const label = ws ? ws.label : workspaceId;
        redirect(res, `/admin?message=Switched+to+${encodeURIComponent(label)}+workspace&type=success`);
      }
    } catch (err) {
      redirect(res, `/admin?message=${encodeURIComponent(err.message)}&type=error`);
    }
  }, 'Switch workspace');

  /**
   * GET /workspace/:id/preview - Preview workspace content
   *
   * WHY PREVIEW URL:
   * Provides a standalone URL to view all content staged in a workspace
   * without switching the active workspace. Useful for reviewing changes,
   * sharing workspace state with stakeholders, or auditing content before
   * publishing.
   *
   * WORKSPACE ID RESOLUTION:
   * The :id parameter can be either the workspace UUID or machine name.
   * This mirrors Drupal's flexible entity loading patterns.
   */
  register('GET', '/workspace/:id/preview', async (req, res, params, ctx) => {
    try {
      const workspacesService = ctx.services.get('workspaces');
      const workspaceId = params.id;

      // Resolve workspace by UUID or machine name
      let workspace = workspacesService.get(workspaceId);
      if (!workspace) {
        workspace = workspacesService.getByMachineName(workspaceId);
      }

      if (!workspace) {
        const html = renderAdmin('workspace-preview.html', {
          pageTitle: 'Workspace Preview',
          error: 'Workspace not found',
        }, ctx, req);
        return server.html(res, html);
      }

      // Get all content associations for this workspace
      const associations = workspacesService.getAssociations(workspace.id);
      const contentItems = [];

      // WHY SKIP WORKSPACE FLAG:
      // We're reading workspace copies directly, not relying on active workspace
      // context. The content.read() function normally checks for workspace copies
      // based on the active workspace, but we want to explicitly read the workspace
      // version here regardless of what workspace is currently active.
      //
      // For "edit" operations: read ws-{first8chars}-{originalId}
      // For "create" operations: read {id} directly (created in workspace)
      for (const assoc of associations.items || []) {
        try {
          let actualId;
          let displayId = assoc.id;

          if (assoc.operation === 'edit') {
            // Workspace copy ID pattern: ws-{first8chars}-{originalId}
            actualId = `ws-${workspace.id.substring(0, 8)}-${assoc.id}`;
          } else {
            // Created directly in workspace
            actualId = assoc.id;
          }

          // Read the content item (skip workspace resolution to get exact copy)
          const item = content.read(assoc.type, actualId, { skipWorkspace: true });

          if (item) {
            // Generate a preview (first 100 chars of JSON or title field)
            let preview = '';
            if (item.title) {
              preview = item.title;
            } else if (item.name) {
              preview = item.name;
            } else {
              const json = JSON.stringify(item, null, 2);
              preview = json.substring(0, 100) + (json.length > 100 ? '...' : '');
            }

            contentItems.push({
              type: assoc.type,
              actualId, // The actual ID to use for links (workspace copy ID)
              displayId, // The original ID for display
              preview,
              operation: assoc.operation,
              timestamp: assoc.timestamp,
              timestampFormatted: new Date(assoc.timestamp).toLocaleString(),
            });
          }
        } catch (err) {
          // WHY SKIP ERRORS:
          // If a workspace copy is missing or corrupt, we still want to show
          // other items. Log the error but continue processing.
          console.error(`[workspace-preview] Failed to load ${assoc.type}:${assoc.id}:`, err.message);
        }
      }

      // Format workspace timestamps
      const workspaceData = {
        ...workspace,
        createdFormatted: new Date(workspace.created).toLocaleString(),
        updatedFormatted: new Date(workspace.updated).toLocaleString(),
      };

      const html = renderAdmin('workspace-preview.html', {
        pageTitle: `Workspace Preview: ${workspace.label}`,
        workspace: workspaceData,
        contentItems,
        hasContent: contentItems.length > 0,
      }, ctx, req);

      server.html(res, html);
    } catch (err) {
      const html = renderAdmin('workspace-preview.html', {
        pageTitle: 'Workspace Preview',
        error: `Error loading workspace preview: ${err.message}`,
      }, ctx, req);
      server.html(res, html);
    }
  }, 'Workspace preview');

  // ==========================================
  // Content Management
  // ==========================================

  /**
   * GET /admin/content - List all content types
   */
  register('GET', '/admin/content', async (req, res, params, ctx) => {
    const types = content.listTypes().map(({ type, schema, source }) => {
      const computedFieldDefs = content.getComputedFields(type);
      const computedNames = Object.keys(computedFieldDefs);
      return {
        type,
        source,
        count: content.list(type).total,
        fields: Object.entries(schema).map(([name, def]) => ({
          name,
          type: def.type,
          required: def.required,
        })),
        hasComputed: computedNames.length > 0,
        computedCount: computedNames.length,
        computedNames: computedNames.join(', '),
      };
    });

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('content-list.html', {
      pageTitle: 'Content Types',
      isTypeList: true,
      types,
      hasTypes: types.length > 0,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'List content types');

  /**
   * GET /admin/moderation - Content moderation dashboard
   * Shows all content items with pending revisions
   */
  register('GET', '/admin/moderation', async (req, res, params, ctx) => {
    const types = content.listTypes();
    const pendingItems = [];
    let totalPending = 0;

    // Internal content types to exclude
    const internalTypes = new Set([
      'user', 'apitoken', 'webhook', 'media', 'taskrun',
      'comment', 'term', 'menu', 'menu-item', 'greeting',
    ]);

    for (const { type } of types) {
      if (internalTypes.has(type)) continue;

      const result = content.list(type, { limit: 1000 });
      for (const item of result.items) {
        if (content.hasPendingRevisions(type, item.id)) {
          const count = content.countPendingRevisions(type, item.id);
          const pending = content.getPendingRevisions(type, item.id);
          const oldest = pending[pending.length - 1];
          const newest = pending[0];

          // Calculate age of oldest pending revision
          const oldestDate = new Date(oldest?.updated || oldest?.created || Date.now());
          const ageMs = Date.now() - oldestDate.getTime();
          const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
          const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
          const ageDisplay = ageDays > 0 ? `${ageDays} day(s)` : `${ageHours} hour(s)`;

          totalPending += count;
          pendingItems.push({
            type,
            id: item.id,
            title: item.title || item.name || item.id,
            status: item.status || 'draft',
            pendingCount: count,
            oldestPending: oldest?.updated || oldest?.created || '',
            newestPending: newest?.updated || newest?.created || '',
            ageDisplay,
            editUrl: `/admin/content/${type}/${item.id}/edit`,
            revisionsUrl: `/admin/content/${type}/${item.id}/revisions`,
          });
        }
      }
    }

    // Sort: most pending first, then by age (oldest first)
    pendingItems.sort((a, b) => b.pendingCount - a.pendingCount ||
      new Date(a.oldestPending) - new Date(b.oldestPending));

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('moderation-dashboard.html', {
      pageTitle: 'Content Moderation',
      pendingItems,
      hasPendingItems: pendingItems.length > 0,
      totalItems: pendingItems.length,
      totalPending,
      hasFlash: !!flash,
      flash,
    }, ctx, req);

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }, 'Content moderation dashboard - pending items');

  /**
   * POST /admin/moderation/bulk-publish - Bulk publish all pending revisions
   * WHY: Enables editors to approve and publish all pending drafts in one click.
   * Iterates all content types, finds items with pending revisions, and publishes
   * the most recent pending revision for each item.
   */
  register('POST', '/admin/moderation/bulk-publish', async (req, res, params, ctx) => {
    const types = content.listTypes();
    const internalTypes = new Set([
      'user', 'apitoken', 'webhook', 'media', 'taskrun',
      'comment', 'term', 'menu', 'menu-item', 'greeting',
    ]);

    let published = 0;
    let failed = 0;
    const errors = [];

    for (const { type } of types) {
      if (internalTypes.has(type)) continue;

      const result = content.list(type, { limit: 1000 });
      for (const item of result.items) {
        if (content.hasPendingRevisions(type, item.id)) {
          try {
            await content.publishPendingRevision(type, item.id);
            published++;
          } catch (err) {
            failed++;
            errors.push(`${type}/${item.id}: ${err.message}`);
          }
        }
      }
    }

    // Flush audit buffer so revision changes are persisted immediately
    const auditService = ctx.services.get('audit');
    if (auditService?.flush) auditService.flush();

    if (failed > 0) {
      redirect(res, `/admin/moderation?error=${encodeURIComponent(`Published ${published} item(s), ${failed} failed: ${errors.join('; ')}`)}`);
    } else {
      redirect(res, `/admin/moderation?success=${encodeURIComponent(`Successfully published ${published} pending revision(s).`)}`);
    }
  }, 'Bulk publish all pending revisions');

  /**
   * GET /admin/content/:type - List content items with filters
   */
  register('GET', '/admin/content/:type', async (req, res, params, ctx) => {
    const { type } = params;

    if (!content.hasType(type)) {
      const html = renderAdmin('content-list.html', {
        pageTitle: 'Error',
        error: `Unknown content type: ${type}`,
      }, ctx, req);
      res.writeHead(404);
      res.end(html);
      return;
    }

    const schema = content.getSchema(type);
    const schemaFields = Object.keys(schema);

    // Check workflow status
    const workflowConfig = content.getWorkflowConfig();
    const workflowEnabled = workflowConfig.enabled;

    // Parse query params for search, pagination, and filters
    const url = new URL(req.url, 'http://localhost');
    const filters = content.parseFiltersFromQuery(url.searchParams, schema) || {};

    // Handle status filter from tab navigation
    const statusFilter = url.searchParams.get('status');
    if (workflowEnabled && statusFilter && statusFilter !== 'all') {
      filters.status = statusFilter;
    }

    const options = {
      page: parseInt(url.searchParams.get('page')) || 1,
      limit: parseInt(url.searchParams.get('limit')) || 20,
      search: url.searchParams.get('search') || null,
      sortBy: url.searchParams.get('sort') || 'created',
      sortOrder: url.searchParams.get('order') || 'desc',
      filters: Object.keys(filters).length > 0 ? filters : null,
    };

    const result = content.list(type, options);

    // Get status counts for tabs if workflow enabled
    let statusCounts = { all: 0, draft: 0, pending: 0, published: 0, archived: 0 };
    if (workflowEnabled) {
      const allItems = content.list(type, { limit: Number.MAX_SAFE_INTEGER });
      statusCounts.all = allItems.total;
      for (const item of allItems.items) {
        const status = item.status || 'draft';
        if (statusCounts[status] !== undefined) {
          statusCounts[status]++;
        }
      }
    }
    // Get favorites service for checking favorite status
    const favoritesService = ctx.services.get('favorites');
    const user = ctx.session?.user;

    const items = result.items.map(item => {
      // Build preview string from schema fields
      const previewParts = schemaFields
        .filter(key => item[key] !== undefined)
        .slice(0, 3) // Show first 3 fields
        .map(key => {
          let val = item[key];
          // Truncate long strings
          if (typeof val === 'string' && val.length > 50) {
            val = val.substring(0, 50) + '...';
          }
          return `${key}: ${val}`;
        });

      // Check if item is favorited by current user
      const isFavorite = user && favoritesService ?
        favoritesService.isFavorite(user.id, type, item.id) : false;

      // Check for pending revisions (non-default drafts)
      const hasPendingRevisions = content.hasPendingRevisions(type, item.id);
      const pendingRevisionCount = hasPendingRevisions ? content.countPendingRevisions(type, item.id) : 0;

      return {
        ...item,
        type, // Include type for links
        status: item.status || 'draft',
        createdFormatted: formatDate(item.created),
        updatedFormatted: formatDate(item.updated),
        scheduledAtFormatted: item.scheduledAt ? formatDate(item.scheduledAt) : null,
        preview: previewParts.join('\n'),
        isFavorite,
        hasPendingRevisions,
        pendingRevisionCount,
      };
    });

    const fields = schemaFields;
    const flash = getFlashMessage(req.url);

    // Build pagination data
    const pagination = {
      page: result.page,
      pages: result.pages,
      total: result.total,
      limit: result.limit,
      hasPrev: result.page > 1,
      hasNext: result.page < result.pages,
      prevPage: result.page - 1,
      nextPage: result.page + 1,
    };

    // Build query string for pagination links (preserve search and filters)
    let baseQuery = options.search ? `search=${encodeURIComponent(options.search)}&` : '';
    if (filters) {
      baseQuery += content.formatFiltersForQuery(filters) + '&';
    }

    // Prepare filter UI data
    // Build list of schema fields with their types for filter dropdowns
    const filterFields = [
      { name: 'id', fieldType: 'string', label: 'ID' },
      { name: 'created', fieldType: 'string', label: 'Created' },
      { name: 'updated', fieldType: 'string', label: 'Updated' },
      ...Object.entries(schema).map(([name, def]) => ({
        name,
        fieldType: def.type,
        label: name.charAt(0).toUpperCase() + name.slice(1),
      })),
    ];

    // Get available filter operators
    const filterOperators = content.getFilterOperators();

    // Parse active filters for display
    const activeFilters = filters ? Object.entries(filters).map(([key, value]) => {
      // Parse field and operator from key
      const match = key.match(/^(.+?)(?:__(\w+))?$/);
      const field = match ? match[1] : key;
      const operator = match && match[2] ? match[2] : 'eq';
      const opInfo = filterOperators.find(op => op.op === operator) || { label: '=' };
      return {
        key,
        field,
        operator,
        operatorLabel: opInfo.label,
        value,
        encoded: encodeURIComponent(key),
      };
    }) : [];

    const html = renderAdmin('content-list.html', {
      pageTitle: `${type} Content`,
      isItemList: true,
      type,
      items,
      hasItems: items.length > 0,
      fields,
      flash,
      hasFlash: !!flash,
      search: options.search || '',
      hasSearch: !!options.search,
      pagination,
      hasPagination: result.pages > 1,
      baseQuery,
      // Filter-related data
      filterFields,
      filterOperators,
      activeFilters,
      hasFilters: activeFilters.length > 0,
      filtersJson: JSON.stringify(filters || {}),
      // Workflow data
      workflowEnabled,
      statusFilter,
      statusCounts,
    }, ctx, req);

    server.html(res, html);
  }, 'List content items with filters');

  /**
   * GET /admin/content/:type/new - Create content form
   */
  register('GET', '/admin/content/:type/new', async (req, res, params, ctx) => {
    const { type } = params;

    if (!content.hasType(type)) {
      redirect(res, '/admin/content?error=' + encodeURIComponent('Unknown content type'));
      return;
    }

    const schema = content.getSchema(type);
    const fields = Object.entries(schema).map(([name, def]) => ({
      name,
      type: def.type,
      required: def.required,
      value: '',
    }));

    const flash = getFlashMessage(req.url);

    // Check workflow status
    const workflowConfig = content.getWorkflowConfig();
    const workflowEnabled = workflowConfig.enabled;

    const html = renderAdmin('content-form.html', {
      pageTitle: `Create ${type}`,
      isCreate: true,
      type,
      fields,
      flash,
      hasFlash: !!flash,
      // Workflow data
      workflowEnabled,
      currentStatus: workflowConfig.defaultStatus || 'draft',
    }, ctx, req);

    server.html(res, html);
  }, 'Create content form');

  /**
   * POST /admin/content/:type - Create content
   */
  register('POST', '/admin/content/:type', async (req, res, params, ctx) => {
    const { type } = params;

    if (!content.hasType(type)) {
      redirect(res, '/admin/content?error=' + encodeURIComponent('Unknown content type'));
      return;
    }

    try {
      // Use pre-parsed body from CSRF middleware, or parse if not available
      const formData = ctx._parsedBody || await parseFormBody(req);

      // Remove empty values and convert types
      const data = {};
      const schema = content.getSchema(type);

      for (const [key, value] of Object.entries(formData)) {
        if (key.startsWith('_')) continue; // Skip internal fields

        const fieldDef = schema[key];
        if (!fieldDef) continue;

        // Type conversion
        if (fieldDef.type === 'number' && value !== '') {
          data[key] = Number(value);
        } else if (fieldDef.type === 'boolean') {
          data[key] = value === 'true' || value === '1' || value === 'on';
        } else if (value !== '') {
          data[key] = value;
        }
      }

      await content.create(type, data);
      redirect(res, `/admin/content/${type}?success=` + encodeURIComponent('Content created successfully'));
    } catch (error) {
      redirect(res, `/admin/content/${type}/new?error=` + encodeURIComponent(error.message));
    }
  }, 'Create content');

  /**
   * GET /admin/content/:type/:id/edit - Edit content form
   */
  register('GET', '/admin/content/:type/:id/edit', async (req, res, params, ctx) => {
    const { type, id } = params;

    if (!content.hasType(type)) {
      redirect(res, '/admin/content?error=' + encodeURIComponent('Unknown content type'));
      return;
    }

    const item = content.read(type, id);
    if (!item) {
      redirect(res, `/admin/content/${type}?error=` + encodeURIComponent('Content not found'));
      return;
    }

    const schema = content.getSchema(type);
    const fields = Object.entries(schema).map(([name, def]) => ({
      name,
      type: def.type,
      required: def.required,
      value: item[name] !== undefined ? item[name] : '',
    }));

    const flash = getFlashMessage(req.url);

    // Check workflow status
    const workflowConfig = content.getWorkflowConfig();
    const workflowEnabled = workflowConfig.enabled;

    // Get computed fields for this type
    const computedFieldDefs = content.getComputedFields(type);
    const hasComputedFields = Object.keys(computedFieldDefs).length > 0;
    let computedFields = [];

    if (hasComputedFields) {
      // Resolve computed values for display
      const resolved = await content.resolveComputed(item, { type });
      computedFields = Object.entries(computedFieldDefs).map(([name, def]) => ({
        name,
        value: resolved[name] !== undefined ? resolved[name] : '(error)',
        description: def.description || '',
        isAsync: def.async || false,
      }));
    }

    // Get slug info
    const hasSlugField = content.hasSlugField(type);
    const slugInfo = hasSlugField ? content.getSlugInfo(type, id) : null;
    const hasSlugHistory = slugInfo && slugInfo.history && slugInfo.history.length > 0;

    // Handle content locking
    const user = ctx.session?.user;
    const lockConfig = content.getLockConfig();
    let lockStatus = { locked: false };
    let userHasLock = false;
    let lockedByOther = false;

    if (lockConfig.enabled && user) {
      // Try to acquire lock for current user
      const lock = content.acquireLock(type, id, user.id, {
        username: user.username || user.name || user.id,
      });

      if (lock) {
        userHasLock = true;
        lockStatus = {
          locked: true,
          userId: user.id,
          username: user.username || user.name || user.id,
          expiresAt: lock.expiresAt,
          expiresIn: Math.floor((new Date(lock.expiresAt) - new Date()) / 1000),
        };
      } else {
        // Someone else has the lock
        lockedByOther = true;
        lockStatus = content.checkLock(type, id);
      }
    }

    const isAdmin = user && (user.role === 'admin' || user.role === 'administrator');

    const html = renderAdmin('content-form.html', {
      pageTitle: `Edit ${type}`,
      isEdit: true,
      type,
      id,
      fields,
      createdFormatted: formatDate(item.created),
      updatedFormatted: formatDate(item.updated),
      flash,
      hasFlash: !!flash,
      // Workflow data
      workflowEnabled,
      currentStatus: item.status || 'draft',
      publishedAt: item.publishedAt,
      publishedAtFormatted: item.publishedAt ? formatDate(item.publishedAt) : null,
      scheduledAt: item.scheduledAt,
      scheduledAtFormatted: item.scheduledAt ? formatDate(item.scheduledAt) : null,
      // Computed fields
      hasComputedFields,
      computedFields,
      // Slug data
      hasSlugField,
      currentSlug: slugInfo ? slugInfo.slug : null,
      hasSlugHistory,
      slugHistoryDisplay: hasSlugHistory ? slugInfo.history.join(', ') : null,
      // Lock data
      lockingEnabled: lockConfig.enabled,
      userHasLock,
      lockedByOther,
      lockStatus,
      lockExpiresIn: lockStatus.expiresIn || 0,
      lockExpiresAt: lockStatus.expiresAt || null,
      lockedByUsername: lockStatus.username || null,
      lockTimeout: lockConfig.timeout,
      isAdmin,
    }, ctx, req);

    server.html(res, html);
  }, 'Edit content form');

  /**
   * POST /admin/content/:type/:id - Update content
   */
  register('POST', '/admin/content/:type/:id', async (req, res, params, ctx) => {
    const { type, id } = params;

    if (!content.hasType(type)) {
      redirect(res, '/admin/content?error=' + encodeURIComponent('Unknown content type'));
      return;
    }

    try {
      // Use pre-parsed body from CSRF middleware, or parse if not available
      const formData = ctx._parsedBody || await parseFormBody(req);

      // Convert form data to content data
      const data = {};
      const schema = content.getSchema(type);

      for (const [key, value] of Object.entries(formData)) {
        if (key.startsWith('_')) continue;

        const fieldDef = schema[key];
        if (!fieldDef) continue;

        if (fieldDef.type === 'number' && value !== '') {
          data[key] = Number(value);
        } else if (fieldDef.type === 'boolean') {
          data[key] = value === 'true' || value === '1' || value === 'on';
        } else if (value !== '') {
          data[key] = value;
        }
      }

      // Pass user info for lock checking
      const user = ctx.session?.user;
      const updateOptions = user ? { userId: user.id } : {};

      const updated = await content.update(type, id, data, updateOptions);
      if (!updated) {
        redirect(res, `/admin/content/${type}?error=` + encodeURIComponent('Content not found'));
        return;
      }

      // Refresh lock on successful save
      if (user) {
        content.refreshLock(type, id, user.id);
      }

      redirect(res, `/admin/content/${type}?success=` + encodeURIComponent('Content updated successfully'));
    } catch (error) {
      // Check if it's a lock error
      if (error.code === 'LOCKED') {
        redirect(res, `/admin/content/${type}/${id}/edit?error=` + encodeURIComponent(`Content is locked by ${error.lockedBy}. Try again when they're done editing.`));
        return;
      }
      redirect(res, `/admin/content/${type}/${id}/edit?error=` + encodeURIComponent(error.message));
    }
  }, 'Update content');

  /**
   * POST /admin/content/:type/:id/delete - Delete content
   */
  register('POST', '/admin/content/:type/:id/delete', async (req, res, params, ctx) => {
    const { type, id } = params;

    if (!content.hasType(type)) {
      redirect(res, '/admin/content?error=' + encodeURIComponent('Unknown content type'));
      return;
    }

    const deleted = await content.remove(type, id);

    if (deleted) {
      redirect(res, `/admin/content/${type}?success=` + encodeURIComponent('Content deleted successfully'));
    } else {
      redirect(res, `/admin/content/${type}?error=` + encodeURIComponent('Content not found'));
    }
  }, 'Delete content');

  // ==========================================
  // Content Revisions
  // ==========================================

  /**
   * GET /admin/content/:type/:id/revisions - List revisions
   */
  register('GET', '/admin/content/:type/:id/revisions', async (req, res, params, ctx) => {
    const { type, id } = params;

    if (!content.hasType(type)) {
      redirect(res, '/admin/content?error=' + encodeURIComponent('Unknown content type'));
      return;
    }

    const item = content.read(type, id);
    if (!item) {
      redirect(res, `/admin/content/${type}?error=` + encodeURIComponent('Content not found'));
      return;
    }

    const revisions = content.getRevisions(type, id);
    const flash = getFlashMessage(req.url);

    // Get preview data for each revision
    const revisionsList = revisions.map(rev => {
      const revContent = content.getRevision(type, id, rev.timestamp);
      const schema = content.getSchema(type);
      const schemaFields = Object.keys(schema);

      // Build preview from first few fields
      const preview = schemaFields.slice(0, 2).map(key => {
        let val = revContent ? revContent[key] : '';
        if (typeof val === 'string' && val.length > 30) {
          val = val.substring(0, 30) + '...';
        }
        return `${key}: ${val}`;
      }).join(', ');

      return {
        timestamp: rev.timestamp,
        timestampFormatted: formatDate(rev.timestamp),
        size: rev.size,
        preview,
      };
    });

    const html = renderAdmin('revisions-list.html', {
      pageTitle: `Revisions - ${type}/${id}`,
      type,
      id,
      item,
      currentUpdated: item.updated,
      currentUpdatedFormatted: formatDate(item.updated),
      revisions: revisionsList,
      hasRevisions: revisionsList.length > 0,
      revisionCount: revisionsList.length,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'List content revisions');

  /**
   * GET /admin/content/:type/:id/revisions/:ts - View specific revision
   */
  register('GET', '/admin/content/:type/:id/revisions/:ts', async (req, res, params, ctx) => {
    const { type, id, ts } = params;

    if (!content.hasType(type)) {
      redirect(res, '/admin/content?error=' + encodeURIComponent('Unknown content type'));
      return;
    }

    const item = content.read(type, id);
    if (!item) {
      redirect(res, `/admin/content/${type}?error=` + encodeURIComponent('Content not found'));
      return;
    }

    const revision = content.getRevision(type, id, ts);
    if (!revision) {
      redirect(res, `/admin/content/${type}/${id}/revisions?error=` + encodeURIComponent('Revision not found'));
      return;
    }

    const schema = content.getSchema(type);
    const fields = Object.entries(schema).map(([name, def]) => ({
      name,
      type: def.type,
      value: revision[name] !== undefined ? revision[name] : '',
      currentValue: item[name] !== undefined ? item[name] : '',
      changed: JSON.stringify(revision[name]) !== JSON.stringify(item[name]),
    }));

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('revision-view.html', {
      pageTitle: `Revision - ${ts}`,
      type,
      id,
      timestamp: ts,
      timestampFormatted: formatDate(ts),
      revision,
      fields,
      createdFormatted: formatDate(revision.created),
      updatedFormatted: formatDate(revision.updated),
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'View specific revision');

  /**
   * POST /admin/content/:type/:id/revisions/:ts/revert - Revert to revision
   */
  register('POST', '/admin/content/:type/:id/revisions/:ts/revert', async (req, res, params, ctx) => {
    const { type, id, ts } = params;

    if (!content.hasType(type)) {
      redirect(res, '/admin/content?error=' + encodeURIComponent('Unknown content type'));
      return;
    }

    try {
      const restored = await content.revertTo(type, id, ts);

      if (!restored) {
        redirect(res, `/admin/content/${type}/${id}/revisions?error=` + encodeURIComponent('Revision not found'));
        return;
      }

      redirect(res, `/admin/content/${type}/${id}/edit?success=` + encodeURIComponent(`Reverted to ${ts}`));
    } catch (error) {
      redirect(res, `/admin/content/${type}/${id}/revisions?error=` + encodeURIComponent(error.message));
    }
  }, 'Revert to revision');

  /**
   * GET /admin/content/:type/:id/revisions/:ts/diff - Compare revision to current
   */
  register('GET', '/admin/content/:type/:id/revisions/:ts/diff', async (req, res, params, ctx) => {
    const { type, id, ts } = params;

    if (!content.hasType(type)) {
      redirect(res, '/admin/content?error=' + encodeURIComponent('Unknown content type'));
      return;
    }

    const item = content.read(type, id);
    if (!item) {
      redirect(res, `/admin/content/${type}?error=` + encodeURIComponent('Content not found'));
      return;
    }

    const diff = content.diffRevisions(type, id, ts, 'current');
    if (!diff) {
      redirect(res, `/admin/content/${type}/${id}/revisions?error=` + encodeURIComponent('Could not compute diff'));
      return;
    }

    const flash = getFlashMessage(req.url);

    // Format changes for display
    const changes = diff.changes.map(change => ({
      ...change,
      fromStr: JSON.stringify(change.from, null, 2),
      toStr: JSON.stringify(change.to, null, 2),
      isAdded: change.type === 'added',
      isRemoved: change.type === 'removed',
      isModified: change.type === 'modified',
    }));

    const html = renderAdmin('revision-diff.html', {
      pageTitle: `Diff - ${ts} vs Current`,
      type,
      id,
      timestamp: ts,
      timestampFormatted: formatDate(ts),
      currentTimestamp: item.updated,
      currentTimestampFormatted: formatDate(item.updated),
      changes,
      hasChanges: changes.length > 0,
      changeCount: changes.length,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Compare revision to current');

  // ==========================================
  // Module Management
  // ==========================================

  /**
   * GET /admin/modules - List all modules
   */
  register('GET', '/admin/modules', async (req, res, params, ctx) => {
    const enabledModules = ctx.config.modules.enabled || [];
    const allModules = (ctx.modules || []).map(mod => ({
      ...mod,
      enabled: enabledModules.includes(mod.name),
    }));

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('modules.html', {
      pageTitle: 'Modules',
      modules: allModules,
      hasModules: allModules.length > 0,
      enabledCount: enabledModules.length,
      totalCount: allModules.length,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'List modules');

  // ==========================================
  // Import/Export
  // ==========================================

  /**
   * GET /admin/export - Export options page
   */
  register('GET', '/admin/export', async (req, res, params, ctx) => {
    const transfer = ctx.services.get('transfer');
    const stats = transfer.getExportStats();

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('export.html', {
      pageTitle: 'Export',
      types: stats.types,
      hasTypes: stats.types.length > 0,
      totalItems: stats.totalItems,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Export options page');

  /**
   * POST /admin/export/content - Download content JSON
   */
  register('POST', '/admin/export/content', async (req, res, params, ctx) => {
    const transfer = ctx.services.get('transfer');

    // Use pre-parsed body from CSRF middleware, or parse if not available
    const formData = ctx._parsedBody || await parseFormBody(req);
    const selectedTypes = formData.types
      ? (Array.isArray(formData.types) ? formData.types : [formData.types])
      : null;
    const includeMedia = formData.includeMedia === 'on' || formData.includeMedia === '1';

    // Export content
    const data = transfer.exportContent(selectedTypes, { includeMedia });

    // Set download headers
    const filename = `content-export-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    res.end(JSON.stringify(data, null, 2));
  }, 'Download content export');

  /**
   * POST /admin/export/site - Download full site JSON
   */
  register('POST', '/admin/export/site', async (req, res, params, ctx) => {
    const transfer = ctx.services.get('transfer');

    // Full site export
    const data = transfer.exportSite({ includeMedia: true });

    // Set download headers
    const filename = `site-backup-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    res.end(JSON.stringify(data, null, 2));
  }, 'Download full site export');

  /**
   * GET /admin/import - Import page with file upload
   */
  register('GET', '/admin/import', async (req, res, params, ctx) => {
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('import.html', {
      pageTitle: 'Import',
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Import page');

  /**
   * POST /admin/import - Handle import with preview
   */
  register('POST', '/admin/import', async (req, res, params, ctx) => {
    const transfer = ctx.services.get('transfer');
    const mediaService = ctx.services.get('media');

    try {
      // Parse multipart form data
      const { fields, files } = await mediaService.parseUpload(req);

      if (!files || files.length === 0) {
        redirect(res, '/admin/import?error=' + encodeURIComponent('No file uploaded'));
        return;
      }

      // Parse JSON from uploaded file
      const fileContent = files[0].data.toString('utf-8');
      let data;

      try {
        data = transfer.parseImportData(fileContent);
      } catch (error) {
        redirect(res, '/admin/import?error=' + encodeURIComponent(`Invalid JSON: ${error.message}`));
        return;
      }

      // Check compatibility
      const compat = transfer.checkCompatibility(data);

      // Determine mode: preview or actual import
      const dryRun = fields.action !== 'import';
      const overwrite = fields.overwrite === 'on' || fields.overwrite === '1';
      const importConfig = fields.importConfig === 'on' || fields.importConfig === '1';

      // Perform import (dry run for preview)
      const result = await transfer.importSite(data, { dryRun, overwrite, importConfig });

      // Render preview/result page
      const html = renderAdmin('import-preview.html', {
        pageTitle: dryRun ? 'Import Preview' : 'Import Complete',
        isPreview: dryRun,
        isComplete: !dryRun,
        result,
        data,
        compat,
        hasWarnings: compat.warnings.length > 0,
        hasErrors: result.content.errors.length > 0,
        overwrite,
        importConfig,
        // Format details for template
        typeDetails: Object.entries(result.content.details).map(([type, stats]) => ({
          type,
          ...stats,
        })),
        hasTypeDetails: Object.keys(result.content.details).length > 0,
      }, ctx, req);

      server.html(res, html);
    } catch (error) {
      redirect(res, '/admin/import?error=' + encodeURIComponent(error.message));
    }
  }, 'Handle import');

  // ==========================================
  // Cache Management
  // ==========================================

  /**
   * GET /admin/cache - Show cache statistics
   */
  register('GET', '/admin/cache', async (req, res, params, ctx) => {
    const cache = ctx.services.get('cache');
    const cacheConfig = ctx.config.site.cache || {};
    const stats = cache.stats();

    const flash = getFlashMessage(req.url);

    // Calculate hit rate percentage
    const totalRequests = stats.hits + stats.misses;
    const hitRatePercent = totalRequests > 0
      ? ((stats.hits / totalRequests) * 100).toFixed(1)
      : 0;

    // Get keys with TTL info
    const keys = stats.keys.slice(0, 50).map(key => ({
      key,
      ttl: cache.ttl(key),
    }));

    const html = renderAdmin('cache.html', {
      pageTitle: 'Cache',
      enabled: cacheConfig.enabled || false,
      ttl: cacheConfig.ttl || 300,
      apiTtl: cacheConfig.apiTtl || 60,
      size: stats.size,
      hits: stats.hits,
      misses: stats.misses,
      hitRate: hitRatePercent,
      sets: stats.sets,
      deletes: stats.deletes,
      clears: stats.clears,
      keys,
      hasKeys: keys.length > 0,
      totalKeys: stats.keys.length,
      showingAllKeys: stats.keys.length <= 50,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Cache statistics');

  /**
   * POST /admin/cache/clear - Clear all cache
   */
  register('POST', '/admin/cache/clear', async (req, res, params, ctx) => {
    const cache = ctx.services.get('cache');
    const count = cache.clear();

    redirect(res, '/admin/cache?success=' + encodeURIComponent(`Cleared ${count} cache entries`));
  }, 'Clear cache');

  // ==========================================
  // Rate Limiting Management
  // ==========================================

  /**
   * GET /admin/ratelimit - Show rate limit statistics and blocked IPs
   */
  register('GET', '/admin/ratelimit', async (req, res, params, ctx) => {
    const ratelimit = ctx.services.get('ratelimit');
    const rateLimitConfig = ctx.config.site.rateLimit || {};
    const stats = ratelimit.getStats();
    const blocked = ratelimit.getBlocked();

    const flash = getFlashMessage(req.url);

    // Format blocked entries for display
    const blockedList = blocked.map(entry => ({
      key: entry.key,
      reason: entry.reason,
      blockedAt: new Date(entry.blockedAt).toISOString(),
      expiresAt: new Date(entry.expiresAt).toISOString(),
      remaining: Math.ceil((entry.expiresAt - Date.now()) / 1000),
    }));

    const html = renderAdmin('ratelimit.html', {
      pageTitle: 'Rate Limiting',
      enabled: rateLimitConfig.enabled !== false,
      loginPoints: rateLimitConfig.login?.points || 5,
      loginDuration: rateLimitConfig.login?.duration || 60,
      loginBlockDuration: rateLimitConfig.login?.blockDuration || 300,
      apiPoints: rateLimitConfig.api?.points || 100,
      apiDuration: rateLimitConfig.api?.duration || 60,
      adminPoints: rateLimitConfig.admin?.points || 60,
      adminDuration: rateLimitConfig.admin?.duration || 60,
      totalRequests: stats.totalRequests,
      blockedRequests: stats.blockedRequests,
      activeKeys: stats.activeKeys,
      blockedKeys: stats.blockedKeys,
      blockedList,
      hasBlocked: blockedList.length > 0,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Rate limit statistics');

  /**
   * POST /admin/ratelimit/:key/clear - Unblock a specific key
   */
  register('POST', '/admin/ratelimit/:key/clear', async (req, res, params, ctx) => {
    const ratelimit = ctx.services.get('ratelimit');
    const key = decodeURIComponent(params.key);

    const cleared = ratelimit.clearKey(key);

    if (cleared) {
      redirect(res, '/admin/ratelimit?success=' + encodeURIComponent(`Unblocked: ${key}`));
    } else {
      redirect(res, '/admin/ratelimit?error=' + encodeURIComponent(`Key not found: ${key}`));
    }
  }, 'Unblock rate limit key');

  // ==========================================
  // Search Management
  // ==========================================

  /**
   * GET /admin/search - Search admin page
   */
  register('GET', '/admin/search', async (req, res, params, ctx) => {
    const searchService = ctx.services.get('search');
    const contentService = ctx.services.get('content');

    const url = new URL(req.url, 'http://localhost');
    const query = url.searchParams.get('q') || '';
    const selectedType = url.searchParams.get('type') || '';

    const flash = getFlashMessage(req.url);

    // Get available types for dropdown
    const types = contentService.listTypes().map(t => ({
      type: t.type,
      selected: t.type === selectedType,
    }));

    // Get search stats
    const stats = searchService.getStats();
    const typeStats = Object.entries(stats.typeStats).map(([type, data]) => ({
      type,
      ...data,
    }));

    // Perform search if query provided
    let results = [];
    let total = 0;
    let took = 0;

    if (query) {
      const searchTypes = selectedType ? [selectedType] : null;
      const searchResult = searchService.search(query, {
        types: searchTypes,
        limit: 50,
        highlight: true,
      });

      results = searchResult.results.map(r => ({
        ...r,
        highlights: r.highlights
          ? Object.entries(r.highlights).map(([field, value]) => ({ field, value }))
          : null,
      }));
      total = searchResult.total;
      took = searchResult.took;
    }

    const html = renderAdmin('search.html', {
      pageTitle: 'Search',
      query,
      hasQuery: !!query,
      results,
      hasResults: results.length > 0,
      total,
      took,
      types,
      stats,
      typeStats,
      hasTypeStats: typeStats.length > 0,
      typeCount: typeStats.length,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Search admin page');

  /**
   * GET /admin/search/status - Search index status (JSON)
   */
  register('GET', '/admin/search/status', async (req, res, params, ctx) => {
    const searchService = ctx.services.get('search');
    const stats = searchService.getStats();
    server.json(res, stats);
  }, 'Search index status');

  /**
   * POST /admin/search/rebuild - Rebuild search index
   */
  register('POST', '/admin/search/rebuild', async (req, res, params, ctx) => {
    const searchService = ctx.services.get('search');

    try {
      const result = searchService.buildIndex();
      redirect(res, '/admin/search?success=' + encodeURIComponent(
        `Index rebuilt: ${result.docs} documents, ${result.terms} terms`
      ));
    } catch (error) {
      redirect(res, '/admin/search?error=' + encodeURIComponent(error.message));
    }
  }, 'Rebuild search index');

  // ==========================================
  // Plugin Management
  // ==========================================

  /**
   * GET /admin/plugins - List all plugins
   */
  register('GET', '/admin/plugins', async (req, res, params, ctx) => {
    const pluginsService = ctx.services.get('plugins');

    const discovered = pluginsService.discover();
    const loaded = pluginsService.listPlugins();
    const enabled = pluginsService.getEnabledPlugins();
    const permDescriptions = pluginsService.getPermissionDescriptions();
    const changedPlugins = pluginsService.getChangedPlugins();
    const autoReloadMode = pluginsService.getAutoReloadMode();

    const flash = getFlashMessage(req.url);

    // Build set of changed plugin names for quick lookup
    const changedSet = new Set(changedPlugins.map(c => c.name));

    // Build plugin list with status
    const pluginList = discovered.map(info => {
      const plugin = loaded.find(p => p.name === info.name);
      const isEnabled = enabled.includes(info.name);

      return {
        name: info.name,
        version: info.manifest?.version || '?',
        description: info.manifest?.description || '(no description)',
        author: info.manifest?.author || null,
        valid: info.valid,
        enabled: isEnabled,
        status: plugin?.status || (info.valid ? 'not loaded' : 'invalid'),
        error: plugin?.error || (info.valid ? null : info.errors.join(', ')),
        permissions: info.manifest?.permissions || [],
        dependencies: info.manifest?.dependencies || [],
        minCoreVersion: info.manifest?.minCoreVersion || null,
        hasChanges: changedSet.has(info.name),
        changeInfo: changedPlugins.find(c => c.name === info.name) || null,
      };
    });

    const html = renderAdmin('plugins-list.html', {
      pageTitle: 'Plugins',
      plugins: pluginList,
      hasPlugins: pluginList.length > 0,
      enabledCount: enabled.length,
      totalCount: discovered.length,
      changedCount: changedPlugins.length,
      hasChangedPlugins: changedPlugins.length > 0,
      autoReloadMode,
      autoReloadEnabled: autoReloadMode === true,
      autoReloadPrompt: autoReloadMode === 'prompt',
      permDescriptions,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'List plugins');

  /**
   * GET /admin/plugins/:name - Plugin details
   */
  register('GET', '/admin/plugins/:name', async (req, res, params, ctx) => {
    const { name } = params;
    const pluginsService = ctx.services.get('plugins');

    const plugin = pluginsService.getPlugin(name);
    const discovered = pluginsService.discover();
    const pluginInfo = discovered.find(p => p.name === name);

    if (!pluginInfo) {
      redirect(res, '/admin/plugins?error=' + encodeURIComponent('Plugin not found'));
      return;
    }

    const enabled = pluginsService.getEnabledPlugins();
    const permDescriptions = pluginsService.getPermissionDescriptions();
    const flash = getFlashMessage(req.url);

    // Build config fields for form
    const manifest = pluginInfo.manifest || {};
    const currentConfig = plugin?.config || manifest.config || {};
    const configFields = Object.entries(currentConfig).map(([key, value]) => ({
      key,
      value: typeof value === 'object' ? JSON.stringify(value, null, 2) : value,
      type: typeof value,
      isObject: typeof value === 'object',
    }));

    const html = renderAdmin('plugin-detail.html', {
      pageTitle: `Plugin: ${name}`,
      name,
      version: manifest.version || '?',
      description: manifest.description || '(no description)',
      author: manifest.author || null,
      valid: pluginInfo.valid,
      enabled: enabled.includes(name),
      status: plugin?.status || (pluginInfo.valid ? 'not loaded' : 'invalid'),
      error: plugin?.error || (pluginInfo.valid ? null : pluginInfo.errors?.join(', ')),
      permissions: (manifest.permissions || []).map(p => ({
        name: p,
        description: permDescriptions[p] || p,
      })),
      hasPermissions: (manifest.permissions || []).length > 0,
      dependencies: manifest.dependencies || [],
      hasDependencies: (manifest.dependencies || []).length > 0,
      minCoreVersion: manifest.minCoreVersion || null,
      configFields,
      hasConfig: configFields.length > 0,
      configJson: JSON.stringify(currentConfig, null, 2),
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Plugin details');

  /**
   * POST /admin/plugins/:name/config - Save plugin config
   */
  register('POST', '/admin/plugins/:name/config', async (req, res, params, ctx) => {
    const { name } = params;
    const pluginsService = ctx.services.get('plugins');

    const plugin = pluginsService.getPlugin(name);
    if (!plugin) {
      redirect(res, '/admin/plugins?error=' + encodeURIComponent('Plugin not found'));
      return;
    }

    try {
      // Use pre-parsed body from CSRF middleware
      const formData = ctx._parsedBody || await parseFormBody(req);

      // Parse config JSON
      let newConfig;
      try {
        newConfig = JSON.parse(formData.config || '{}');
      } catch (e) {
        redirect(res, `/admin/plugins/${name}?error=` + encodeURIComponent('Invalid JSON in config'));
        return;
      }

      // Save config
      pluginsService.savePluginConfig(name, newConfig);

      redirect(res, `/admin/plugins/${name}?success=` + encodeURIComponent('Config saved. Restart may be required.'));
    } catch (error) {
      redirect(res, `/admin/plugins/${name}?error=` + encodeURIComponent(error.message));
    }
  }, 'Save plugin config');

  // ==========================================
  // Hot-Swap Plugin Operations
  // ==========================================

  /**
   * POST /admin/plugins/:name/activate - Hot-activate a plugin
   */
  register('POST', '/admin/plugins/:name/activate', async (req, res, params, ctx) => {
    const { name } = params;
    const pluginsService = ctx.services.get('plugins');

    try {
      let plugin = pluginsService.getPlugin(name);

      if (!plugin) {
        // Plugin not loaded yet, try to load it
        const discovered = pluginsService.discover();
        const pluginInfo = discovered.find(p => p.name === name);

        if (!pluginInfo) {
          redirect(res, '/admin/plugins?error=' + encodeURIComponent(`Plugin not found: ${name}`));
          return;
        }

        if (!pluginInfo.valid) {
          redirect(res, '/admin/plugins?error=' + encodeURIComponent(`Plugin '${name}' has validation errors`));
          return;
        }

        // Load the plugin first
        await pluginsService.loadPlugin(pluginInfo.path, ctx);
      }

      // Activate the plugin (hot-swap mode)
      await pluginsService.activatePlugin(name, true);

      redirect(res, `/admin/plugins/${name}?success=` + encodeURIComponent('Plugin activated (hot-loaded)'));
    } catch (error) {
      redirect(res, `/admin/plugins/${name}?error=` + encodeURIComponent(error.message));
    }
  }, 'Hot-activate a plugin');

  /**
   * POST /admin/plugins/:name/deactivate - Hot-deactivate a plugin
   */
  register('POST', '/admin/plugins/:name/deactivate', async (req, res, params, ctx) => {
    const { name } = params;
    const pluginsService = ctx.services.get('plugins');

    try {
      const plugin = pluginsService.getPlugin(name);

      if (!plugin) {
        redirect(res, '/admin/plugins?error=' + encodeURIComponent(`Plugin '${name}' is not loaded`));
        return;
      }

      if (plugin.status !== 'active') {
        redirect(res, `/admin/plugins/${name}?error=` + encodeURIComponent(`Plugin '${name}' is not active`));
        return;
      }

      await pluginsService.deactivatePlugin(name);

      redirect(res, `/admin/plugins/${name}?success=` + encodeURIComponent('Plugin deactivated (hot-unloaded)'));
    } catch (error) {
      redirect(res, `/admin/plugins/${name}?error=` + encodeURIComponent(error.message));
    }
  }, 'Hot-deactivate a plugin');

  /**
   * POST /admin/plugins/:name/reload - Hot-reload a plugin
   */
  register('POST', '/admin/plugins/:name/reload', async (req, res, params, ctx) => {
    const { name } = params;
    const pluginsService = ctx.services.get('plugins');

    try {
      const plugin = pluginsService.getPlugin(name);

      if (!plugin) {
        redirect(res, '/admin/plugins?error=' + encodeURIComponent(`Plugin '${name}' is not loaded`));
        return;
      }

      await pluginsService.reloadPlugin(name);

      // Clear the changed status after successful reload
      pluginsService.clearPluginChanged(name);

      redirect(res, `/admin/plugins/${name}?success=` + encodeURIComponent('Plugin reloaded'));
    } catch (error) {
      redirect(res, `/admin/plugins/${name}?error=` + encodeURIComponent(error.message));
    }
  }, 'Hot-reload a plugin');

  // ==========================================
  // Workflow Actions
  // ==========================================

  /**
   * POST /admin/content/:type/:id/publish - Publish content
   */
  register('POST', '/admin/content/:type/:id/publish', async (req, res, params, ctx) => {
    const { type, id } = params;

    if (!content.hasType(type)) {
      redirect(res, '/admin/content?error=' + encodeURIComponent('Unknown content type'));
      return;
    }

    try {
      const result = await content.publish(type, id);
      if (!result) {
        redirect(res, `/admin/content/${type}?error=` + encodeURIComponent('Content not found'));
        return;
      }

      redirect(res, `/admin/content/${type}/${id}/edit?success=` + encodeURIComponent('Content published'));
    } catch (error) {
      redirect(res, `/admin/content/${type}/${id}/edit?error=` + encodeURIComponent(error.message));
    }
  }, 'Publish content');

  /**
   * POST /admin/content/:type/:id/unpublish - Unpublish content
   */
  register('POST', '/admin/content/:type/:id/unpublish', async (req, res, params, ctx) => {
    const { type, id } = params;

    if (!content.hasType(type)) {
      redirect(res, '/admin/content?error=' + encodeURIComponent('Unknown content type'));
      return;
    }

    try {
      const result = await content.unpublish(type, id);
      if (!result) {
        redirect(res, `/admin/content/${type}?error=` + encodeURIComponent('Content not found'));
        return;
      }

      redirect(res, `/admin/content/${type}/${id}/edit?success=` + encodeURIComponent('Content unpublished'));
    } catch (error) {
      redirect(res, `/admin/content/${type}/${id}/edit?error=` + encodeURIComponent(error.message));
    }
  }, 'Unpublish content');

  /**
   * POST /admin/content/:type/:id/archive - Archive content
   */
  register('POST', '/admin/content/:type/:id/archive', async (req, res, params, ctx) => {
    const { type, id } = params;

    if (!content.hasType(type)) {
      redirect(res, '/admin/content?error=' + encodeURIComponent('Unknown content type'));
      return;
    }

    try {
      const result = await content.archive(type, id);
      if (!result) {
        redirect(res, `/admin/content/${type}?error=` + encodeURIComponent('Content not found'));
        return;
      }

      redirect(res, `/admin/content/${type}/${id}/edit?success=` + encodeURIComponent('Content archived'));
    } catch (error) {
      redirect(res, `/admin/content/${type}/${id}/edit?error=` + encodeURIComponent(error.message));
    }
  }, 'Archive content');

  /**
   * POST /admin/content/:type/:id/schedule - Schedule content for publishing
   */
  register('POST', '/admin/content/:type/:id/schedule', async (req, res, params, ctx) => {
    const { type, id } = params;

    if (!content.hasType(type)) {
      redirect(res, '/admin/content?error=' + encodeURIComponent('Unknown content type'));
      return;
    }

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const scheduledAt = formData.scheduledAt;

      if (!scheduledAt) {
        redirect(res, `/admin/content/${type}/${id}/edit?error=` + encodeURIComponent('Schedule date is required'));
        return;
      }

      const result = await content.schedulePublish(type, id, scheduledAt);
      if (!result) {
        redirect(res, `/admin/content/${type}?error=` + encodeURIComponent('Content not found'));
        return;
      }

      redirect(res, `/admin/content/${type}/${id}/edit?success=` + encodeURIComponent(`Scheduled for ${scheduledAt}`));
    } catch (error) {
      redirect(res, `/admin/content/${type}/${id}/edit?error=` + encodeURIComponent(error.message));
    }
  }, 'Schedule content for publishing');

  /**
   * POST /admin/content/:type/:id/slug - Update content slug
   */
  register('POST', '/admin/content/:type/:id/slug', async (req, res, params, ctx) => {
    const { type, id } = params;

    if (!content.hasType(type)) {
      redirect(res, '/admin/content?error=' + encodeURIComponent('Unknown content type'));
      return;
    }

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const newSlug = formData.slug;

      if (!newSlug) {
        redirect(res, `/admin/content/${type}/${id}/edit?error=` + encodeURIComponent('Slug is required'));
        return;
      }

      // Find the slug field name
      const slugFieldDef = content.getSlugFieldDef(type);
      if (!slugFieldDef) {
        redirect(res, `/admin/content/${type}/${id}/edit?error=` + encodeURIComponent('This content type does not have a slug field'));
        return;
      }

      const result = await content.update(type, id, { [slugFieldDef.name]: newSlug });
      if (!result) {
        redirect(res, `/admin/content/${type}?error=` + encodeURIComponent('Content not found'));
        return;
      }

      redirect(res, `/admin/content/${type}/${id}/edit?success=` + encodeURIComponent(`Slug updated to "${newSlug}"`));
    } catch (error) {
      redirect(res, `/admin/content/${type}/${id}/edit?error=` + encodeURIComponent(error.message));
    }
  }, 'Update content slug');

  /**
   * POST /admin/content/:type/:id/clone - Clone content item
   */
  register('POST', '/admin/content/:type/:id/clone', async (req, res, params, ctx) => {
    const { type, id } = params;

    if (!content.hasType(type)) {
      redirect(res, '/admin/content?error=' + encodeURIComponent('Unknown content type'));
      return;
    }

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);

      const options = {
        prefix: formData.prefix || undefined,
        deep: formData.deep === 'true' || formData.deep === '1',
        fields: {},
      };

      // Parse any custom field overrides from form
      for (const [key, value] of Object.entries(formData)) {
        if (key.startsWith('field_') && value) {
          options.fields[key.slice(6)] = value;
        }
      }

      const cloned = await content.clone(type, id, options);

      if (!cloned) {
        redirect(res, `/admin/content/${type}/${id}/edit?error=` + encodeURIComponent('Failed to clone item'));
        return;
      }

      redirect(res, `/admin/content/${type}/${cloned.id}/edit?success=` + encodeURIComponent('Item cloned successfully'));
    } catch (error) {
      redirect(res, `/admin/content/${type}/${id}/edit?error=` + encodeURIComponent(error.message));
    }
  }, 'Clone content item');

  // ==========================================
  // Content Locking
  // ==========================================

  /**
   * POST /admin/content/:type/:id/lock - Acquire lock on content
   */
  register('POST', '/admin/content/:type/:id/lock', async (req, res, params, ctx) => {
    const { type, id } = params;

    if (!content.hasType(type)) {
      server.json(res, { error: 'Unknown content type' }, 404);
      return;
    }

    // Get current user
    const user = ctx.session?.user;
    if (!user) {
      server.json(res, { error: 'Authentication required' }, 401);
      return;
    }

    const lock = content.acquireLock(type, id, user.id, {
      username: user.username || user.name || user.id,
    });

    if (!lock) {
      const status = content.checkLock(type, id);
      server.json(res, {
        error: 'Content is locked by another user',
        lockedBy: status.username,
        expiresIn: status.expiresIn,
        expiresAt: status.expiresAt,
      }, 409);
      return;
    }

    server.json(res, {
      locked: true,
      expiresAt: lock.expiresAt,
      expiresIn: Math.floor((new Date(lock.expiresAt) - new Date()) / 1000),
    });
  }, 'Acquire content lock');

  /**
   * DELETE /admin/content/:type/:id/lock - Release lock on content
   */
  register('DELETE', '/admin/content/:type/:id/lock', async (req, res, params, ctx) => {
    const { type, id } = params;

    const user = ctx.session?.user;
    if (!user) {
      server.json(res, { error: 'Authentication required' }, 401);
      return;
    }

    const released = content.releaseLock(type, id, user.id);

    if (!released) {
      server.json(res, { error: 'Lock held by another user' }, 403);
      return;
    }

    server.json(res, { released: true });
  }, 'Release content lock');

  /**
   * POST /admin/content/:type/:id/lock/refresh - Refresh/extend lock
   */
  register('POST', '/admin/content/:type/:id/lock/refresh', async (req, res, params, ctx) => {
    const { type, id } = params;

    const user = ctx.session?.user;
    if (!user) {
      server.json(res, { error: 'Authentication required' }, 401);
      return;
    }

    const lock = content.refreshLock(type, id, user.id);

    if (!lock) {
      server.json(res, { error: 'Cannot refresh lock - not the lock holder' }, 403);
      return;
    }

    server.json(res, {
      refreshed: true,
      expiresAt: lock.expiresAt,
      expiresIn: Math.floor((new Date(lock.expiresAt) - new Date()) / 1000),
    });
  }, 'Refresh content lock');

  /**
   * GET /admin/locks - List all active locks
   */
  register('GET', '/admin/locks', async (req, res, params, ctx) => {
    const url = new URL(req.url, 'http://localhost');
    const typeFilter = url.searchParams.get('type') || null;

    const locks = content.listLocks(typeFilter);
    const stats = content.getLockStats();
    const config = content.getLockConfig();

    // Format for display
    const formattedLocks = locks.map(lock => ({
      type: lock.type,
      id: lock.id,
      userId: lock.userId,
      username: lock.username,
      acquiredAt: lock.acquiredAt,
      acquiredFormatted: formatDate(lock.acquiredAt),
      expiresAt: lock.expiresAt,
      expiresIn: lock.expiresIn,
      expiresInFormatted: formatDuration(lock.expiresIn),
      inGracePeriod: lock.inGracePeriod,
    }));

    // Get unique types for filter tabs
    const typeStats = {};
    for (const lock of locks) {
      typeStats[lock.type] = (typeStats[lock.type] || 0) + 1;
    }

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('locks-list.html', {
      pageTitle: 'Active Locks',
      locks: formattedLocks,
      hasLocks: formattedLocks.length > 0,
      totalLocks: stats.total,
      typeFilter,
      typeStats: Object.entries(typeStats).map(([type, count]) => ({
        type,
        count,
        active: typeFilter === type,
      })),
      timeout: config.timeout,
      gracePeriod: config.gracePeriod,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'List active content locks');

  /**
   * DELETE /admin/locks/:type/:id - Force release lock (admin only)
   */
  register('DELETE', '/admin/locks/:type/:id', async (req, res, params, ctx) => {
    const { type, id } = params;

    const user = ctx.session?.user;
    if (!user) {
      server.json(res, { error: 'Authentication required' }, 401);
      return;
    }

    // Check if user is admin
    if (user.role !== 'admin' && user.role !== 'administrator') {
      server.json(res, { error: 'Admin access required' }, 403);
      return;
    }

    const released = content.forceReleaseLock(type, id);

    if (!released) {
      server.json(res, { error: 'No active lock found' }, 404);
      return;
    }

    server.json(res, {
      released: true,
      wasHeldBy: released.username,
    });
  }, 'Force release content lock (admin)');

  /**
   * POST /admin/locks/:type/:id/release - Force release lock via POST (admin only)
   */
  register('POST', '/admin/locks/:type/:id/release', async (req, res, params, ctx) => {
    const { type, id } = params;

    const user = ctx.session?.user;
    if (!user) {
      redirect(res, '/admin/login?error=' + encodeURIComponent('Authentication required'));
      return;
    }

    // Check if user is admin
    if (user.role !== 'admin' && user.role !== 'administrator') {
      redirect(res, '/admin/locks?error=' + encodeURIComponent('Admin access required'));
      return;
    }

    const released = content.forceReleaseLock(type, id);

    if (released) {
      redirect(res, '/admin/locks?success=' + encodeURIComponent(`Released lock on ${type}/${id} (was held by ${released.username})`));
    } else {
      redirect(res, '/admin/locks?error=' + encodeURIComponent(`No active lock on ${type}/${id}`));
    }
  }, 'Force release content lock via POST');

  // ==========================================
  // Queue Management
  // ==========================================

  /**
   * GET /admin/queue - Queue dashboard
   */
  register('GET', '/admin/queue', async (req, res, params, ctx) => {
    const queue = ctx.services.get('queue');
    if (!queue) {
      server.html(res, '<p>Queue system not available</p>', 500);
      return;
    }

    const url = new URL(req.url, 'http://localhost');
    const statusFilter = url.searchParams.get('status') || null;

    const jobs = queue.listJobs(statusFilter);
    const stats = queue.getStats();
    const config = queue.getConfig();

    // Format jobs for display
    const formattedJobs = jobs.map(job => ({
      ...job,
      createdFormatted: formatDate(job.createdAt),
      hasProgress: job.progress && job.progress.total > 0,
      progressPercent: job.progress && job.progress.total > 0
        ? Math.round((job.progress.completed / job.progress.total) * 100)
        : 0,
    }));

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('queue.html', {
      pageTitle: 'Job Queue',
      jobs: formattedJobs,
      hasJobs: formattedJobs.length > 0,
      statusFilter,
      stats,
      config,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Queue dashboard');

  /**
   * GET /admin/queue/:id - Job details
   */
  register('GET', '/admin/queue/:id', async (req, res, params, ctx) => {
    const queue = ctx.services.get('queue');
    if (!queue) {
      server.html(res, '<p>Queue system not available</p>', 500);
      return;
    }

    const job = queue.getJob(params.id);
    if (!job) {
      redirect(res, '/admin/queue?error=' + encodeURIComponent('Job not found'));
      return;
    }

    const flash = getFlashMessage(req.url);

    // Calculate progress and duration
    const progressPercent = job.progress && job.progress.total > 0
      ? Math.round((job.progress.completed / job.progress.total) * 100)
      : 0;

    let duration = null;
    if (job.startedAt && job.completedAt) {
      const ms = new Date(job.completedAt) - new Date(job.startedAt);
      duration = queue.formatDuration(ms);
    }

    // Format errors for display
    const errors = job.result?.errors?.slice(0, 20) || [];
    const hasErrors = errors.length > 0;
    const hasMoreErrors = job.result?.errors?.length > 20;
    const moreErrorCount = hasMoreErrors ? job.result.errors.length - 20 : 0;
    const errorCount = job.result?.errors?.length || 0;

    const html = renderAdmin('queue-job.html', {
      pageTitle: `Job ${params.id}`,
      job,
      createdFormatted: formatDate(job.createdAt),
      startedFormatted: job.startedAt ? formatDate(job.startedAt) : null,
      completedFormatted: job.completedAt ? formatDate(job.completedAt) : null,
      duration,
      progressPercent,
      hasData: job.data && Object.keys(job.data).length > 0,
      dataFormatted: JSON.stringify(job.data, null, 2),
      hasResult: job.result !== null,
      resultFormatted: JSON.stringify(job.result, null, 2),
      errors,
      hasErrors,
      hasMoreErrors,
      moreErrorCount,
      errorCount,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Job details');

  /**
   * POST /admin/queue/process - Process pending jobs
   */
  register('POST', '/admin/queue/process', async (req, res, params, ctx) => {
    const queue = ctx.services.get('queue');
    if (!queue) {
      redirect(res, '/admin/queue?error=' + encodeURIComponent('Queue system not available'));
      return;
    }

    // Register handlers if not done
    queue.registerBuiltinHandlers(ctx);

    const results = await queue.processQueue(10);
    const message = results.length > 0
      ? `Processed ${results.length} job(s)`
      : 'No pending jobs to process';

    redirect(res, '/admin/queue?success=' + encodeURIComponent(message));
  }, 'Process pending jobs');

  /**
   * POST /admin/queue/clear - Clear jobs by status
   */
  register('POST', '/admin/queue/clear', async (req, res, params, ctx) => {
    const queue = ctx.services.get('queue');
    if (!queue) {
      redirect(res, '/admin/queue?error=' + encodeURIComponent('Queue system not available'));
      return;
    }

    const url = new URL(req.url, 'http://localhost');
    const status = url.searchParams.get('status') || 'completed';

    const cleared = queue.clearJobs(status);
    redirect(res, '/admin/queue?success=' + encodeURIComponent(`Cleared ${cleared} ${status} job(s)`));
  }, 'Clear jobs by status');

  /**
   * POST /admin/queue/:id/cancel - Cancel pending job
   */
  register('POST', '/admin/queue/:id/cancel', async (req, res, params, ctx) => {
    const queue = ctx.services.get('queue');
    if (!queue) {
      redirect(res, '/admin/queue?error=' + encodeURIComponent('Queue system not available'));
      return;
    }

    const success = queue.cancelJob(params.id);
    if (success) {
      redirect(res, '/admin/queue?success=' + encodeURIComponent(`Cancelled job ${params.id}`));
    } else {
      redirect(res, '/admin/queue?error=' + encodeURIComponent(`Could not cancel job ${params.id}`));
    }
  }, 'Cancel pending job');

  /**
   * POST /admin/queue/:id/retry - Retry failed job
   */
  register('POST', '/admin/queue/:id/retry', async (req, res, params, ctx) => {
    const queue = ctx.services.get('queue');
    if (!queue) {
      redirect(res, '/admin/queue?error=' + encodeURIComponent('Queue system not available'));
      return;
    }

    const job = queue.retryJob(params.id);
    if (job) {
      redirect(res, '/admin/queue?success=' + encodeURIComponent(`Queued job ${params.id} for retry`));
    } else {
      redirect(res, '/admin/queue?error=' + encodeURIComponent(`Could not retry job ${params.id}`));
    }
  }, 'Retry failed job');

  /**
   * POST /admin/queue/:id/delete - Delete job
   */
  register('POST', '/admin/queue/:id/delete', async (req, res, params, ctx) => {
    const queue = ctx.services.get('queue');
    if (!queue) {
      redirect(res, '/admin/queue?error=' + encodeURIComponent('Queue system not available'));
      return;
    }

    const job = queue.getJob(params.id);
    if (!job) {
      redirect(res, '/admin/queue?error=' + encodeURIComponent('Job not found'));
      return;
    }

    if (job.status === 'running') {
      redirect(res, '/admin/queue?error=' + encodeURIComponent('Cannot delete running job'));
      return;
    }

    // Clear the specific job by deleting from internal storage
    queue.clearJobs(job.status);
    redirect(res, '/admin/queue?success=' + encodeURIComponent(`Deleted job ${params.id}`));
  }, 'Delete job');

  /**
   * POST /admin/content/:type/bulk - Perform bulk action
   */
  register('POST', '/admin/content/:type/bulk', async (req, res, params, ctx) => {
    const { type } = params;

    if (!content.hasType(type)) {
      redirect(res, '/admin/content?error=' + encodeURIComponent('Unknown content type'));
      return;
    }

    const queue = ctx.services.get('queue');
    const formData = ctx._parsedBody || await parseFormBody(req);

    const action = formData.action;
    const ids = Array.isArray(formData.ids) ? formData.ids : (formData.ids ? [formData.ids] : []);

    if (ids.length === 0) {
      redirect(res, `/admin/content/${type}?error=` + encodeURIComponent('No items selected'));
      return;
    }

    const user = ctx.session?.user;

    try {
      let results;

      // Use queue for larger operations (> 10 items)
      const useQueue = ids.length > 10 && queue;

      if (useQueue) {
        const jobType = `bulk:${action}`;
        const job = queue.addJob(jobType, {
          contentType: type,
          ids,
          permanent: action === 'delete' && formData.permanent === 'true',
        }, {
          userId: user?.id || 'system',
        });

        redirect(res, `/admin/queue/${job.id}?success=` + encodeURIComponent(`Created job for ${ids.length} items`));
        return;
      }

      // Process synchronously for small batches
      switch (action) {
        case 'publish':
          results = await content.bulkPublish(type, ids);
          break;
        case 'unpublish':
          results = await content.bulkUnpublish(type, ids);
          break;
        case 'archive':
          results = await content.bulkArchive(type, ids);
          break;
        case 'delete':
          results = await content.bulkDelete(type, ids, {
            permanent: formData.permanent === 'true',
            userId: user?.id,
          });
          break;
        default:
          redirect(res, `/admin/content/${type}?error=` + encodeURIComponent('Unknown action'));
          return;
      }

      const message = `${action}: ${results.success} success, ${results.failed} failed`;
      redirect(res, `/admin/content/${type}?success=` + encodeURIComponent(message));
    } catch (error) {
      redirect(res, `/admin/content/${type}?error=` + encodeURIComponent(error.message));
    }
  }, 'Perform bulk content action');

  // ==========================================
  // oEmbed Management
  // ==========================================

  /**
   * GET /admin/oembed/preview - Preview embed for URL
   */
  register('GET', '/admin/oembed/preview', async (req, res, params, ctx) => {
    const oembed = ctx.services.get('oembed');
    if (!oembed) {
      server.json(res, { error: 'oEmbed system not available' }, 500);
      return;
    }

    const url = new URL(req.url, 'http://localhost');
    const embedUrl = url.searchParams.get('url');

    if (!embedUrl) {
      server.json(res, { error: 'URL parameter required' }, 400);
      return;
    }

    try {
      const data = await oembed.fetchEmbed(embedUrl, {
        skipCache: url.searchParams.get('refresh') === 'true',
      });

      server.json(res, {
        url: embedUrl,
        type: data.type,
        title: data.title,
        author_name: data.author_name,
        provider_name: data.provider_name,
        thumbnail_url: data.thumbnail_url,
        html: data.html,
        width: data.width,
        height: data.height,
        cached: data.cached,
        fetchedAt: data.fetchedAt,
      });
    } catch (error) {
      server.json(res, {
        error: error.message,
        url: embedUrl,
        supported: oembed.checkSupport(embedUrl).supported,
      }, 400);
    }
  }, 'Preview oEmbed for URL');

  /**
   * GET /admin/oembed/providers - List oEmbed providers
   */
  register('GET', '/admin/oembed/providers', async (req, res, params, ctx) => {
    const oembed = ctx.services.get('oembed');
    if (!oembed) {
      server.json(res, { error: 'oEmbed system not available' }, 500);
      return;
    }

    const providers = oembed.getProviders();
    const config = oembed.getConfig();

    server.json(res, {
      providers,
      config: {
        enabled: config.enabled,
        cacheTtl: config.cacheTtl,
        maxWidth: config.maxWidth,
        maxHeight: config.maxHeight,
      },
    });
  }, 'List oEmbed providers');

  /**
   * POST /admin/oembed/clear-cache - Clear oEmbed cache
   */
  register('POST', '/admin/oembed/clear-cache', async (req, res, params, ctx) => {
    const oembed = ctx.services.get('oembed');
    if (!oembed) {
      redirect(res, '/admin?error=' + encodeURIComponent('oEmbed system not available'));
      return;
    }

    const formData = ctx._parsedBody || await parseFormBody(req);
    const url = formData.url || null;

    const cleared = oembed.clearCache(url);

    if (url) {
      redirect(res, '/admin?success=' + encodeURIComponent(`Cleared cache for ${url}`));
    } else {
      redirect(res, '/admin?success=' + encodeURIComponent(`Cleared ${cleared} cached embed(s)`));
    }
  }, 'Clear oEmbed cache');

  /**
   * GET /admin/oembed/check - Check URL support
   */
  register('GET', '/admin/oembed/check', async (req, res, params, ctx) => {
    const oembed = ctx.services.get('oembed');
    if (!oembed) {
      server.json(res, { error: 'oEmbed system not available' }, 500);
      return;
    }

    const url = new URL(req.url, 'http://localhost');
    const embedUrl = url.searchParams.get('url');

    if (!embedUrl) {
      server.json(res, { error: 'URL parameter required' }, 400);
      return;
    }

    const support = oembed.checkSupport(embedUrl);
    server.json(res, {
      url: embedUrl,
      ...support,
    });
  }, 'Check URL oEmbed support');

  // ==========================================
  // Comments Management
  // ==========================================

  /**
   * GET /admin/comments - Moderation queue (pending comments)
   */
  register('GET', '/admin/comments', async (req, res, params, ctx) => {
    const commentsService = ctx.services.get('comments');
    if (!commentsService) {
      server.html(res, '<p>Comments system not available</p>', 500);
      return;
    }

    const url = new URL(req.url, 'http://localhost');
    const statusFilter = url.searchParams.get('status') || 'pending';
    const typeFilter = url.searchParams.get('type') || null;

    const config = commentsService.getConfig();
    const stats = commentsService.getStats();

    let result;
    if (statusFilter === 'pending') {
      result = commentsService.getModerationQueue({ contentType: typeFilter, limit: 50 });
    } else {
      result = commentsService.getAllComments({ status: statusFilter, contentType: typeFilter, limit: 50 });
    }

    // Enhance comments with content info
    const formattedComments = result.comments.map(comment => {
      const targetContent = content.read(comment.contentType, comment.contentId);
      return {
        ...comment,
        contentTitle: targetContent?.title || targetContent?.name || comment.contentId,
        excerpt: comment.body.slice(0, 100) + (comment.body.length > 100 ? '...' : ''),
        createdFormatted: formatDate(comment.created),
        isReply: !!comment.parentId,
      };
    });

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('comments-moderation.html', {
      pageTitle: 'Comments',
      comments: formattedComments,
      hasComments: formattedComments.length > 0,
      total: result.total,
      statusFilter,
      typeFilter,
      stats,
      pendingCount: stats.pending,
      approvedCount: stats.byStatus.approved || 0,
      spamCount: stats.byStatus.spam || 0,
      trashCount: stats.byStatus.trash || 0,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Comments moderation queue');

  /**
   * GET /admin/content/:type/:id/comments - Comments for specific content
   */
  register('GET', '/admin/content/:type/:id/comments', async (req, res, params, ctx) => {
    const { type, id } = params;
    const commentsService = ctx.services.get('comments');

    if (!content.hasType(type)) {
      redirect(res, '/admin/content?error=' + encodeURIComponent('Unknown content type'));
      return;
    }

    const item = content.read(type, id);
    if (!item) {
      redirect(res, `/admin/content/${type}?error=` + encodeURIComponent('Content not found'));
      return;
    }

    const url = new URL(req.url, 'http://localhost');
    const statusFilter = url.searchParams.get('status') || null;

    const result = commentsService.getComments(type, id, {
      status: statusFilter,
      threaded: false,
      limit: 100,
    });

    const formattedComments = result.comments.map(comment => ({
      ...comment,
      excerpt: comment.body.slice(0, 100) + (comment.body.length > 100 ? '...' : ''),
      createdFormatted: formatDate(comment.created),
      isReply: !!comment.parentId,
    }));

    const stats = {
      total: commentsService.getCommentCount(type, id),
      approved: commentsService.getCommentCount(type, id, 'approved'),
      pending: commentsService.getCommentCount(type, id, 'pending'),
      spam: commentsService.getCommentCount(type, id, 'spam'),
    };

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('content-comments.html', {
      pageTitle: `Comments for ${item.title || item.name || id}`,
      type,
      id,
      contentTitle: item.title || item.name || id,
      comments: formattedComments,
      hasComments: formattedComments.length > 0,
      total: result.total,
      stats,
      statusFilter,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Comments for specific content');

  /**
   * POST /admin/comments/:id/approve - Approve comment
   */
  register('POST', '/admin/comments/:id/approve', async (req, res, params, ctx) => {
    const { id } = params;
    const commentsService = ctx.services.get('comments');

    try {
      await commentsService.approveComment(id);
      redirect(res, '/admin/comments?success=' + encodeURIComponent('Comment approved'));
    } catch (error) {
      redirect(res, '/admin/comments?error=' + encodeURIComponent(error.message));
    }
  }, 'Approve comment');

  /**
   * POST /admin/comments/:id/spam - Mark comment as spam
   */
  register('POST', '/admin/comments/:id/spam', async (req, res, params, ctx) => {
    const { id } = params;
    const commentsService = ctx.services.get('comments');

    try {
      await commentsService.spamComment(id);
      redirect(res, '/admin/comments?success=' + encodeURIComponent('Comment marked as spam'));
    } catch (error) {
      redirect(res, '/admin/comments?error=' + encodeURIComponent(error.message));
    }
  }, 'Mark comment as spam');

  /**
   * POST /admin/comments/:id/trash - Trash comment
   */
  register('POST', '/admin/comments/:id/trash', async (req, res, params, ctx) => {
    const { id } = params;
    const commentsService = ctx.services.get('comments');

    try {
      await commentsService.trashComment(id);
      redirect(res, '/admin/comments?success=' + encodeURIComponent('Comment moved to trash'));
    } catch (error) {
      redirect(res, '/admin/comments?error=' + encodeURIComponent(error.message));
    }
  }, 'Trash comment');

  /**
   * POST /admin/comments/:id/delete - Permanently delete comment
   */
  register('POST', '/admin/comments/:id/delete', async (req, res, params, ctx) => {
    const { id } = params;
    const commentsService = ctx.services.get('comments');

    try {
      await commentsService.deleteComment(id);
      redirect(res, '/admin/comments?status=trash&success=' + encodeURIComponent('Comment permanently deleted'));
    } catch (error) {
      redirect(res, '/admin/comments?error=' + encodeURIComponent(error.message));
    }
  }, 'Delete comment permanently');

  /**
   * POST /admin/comments/bulk - Bulk action on comments
   */
  register('POST', '/admin/comments/bulk', async (req, res, params, ctx) => {
    const commentsService = ctx.services.get('comments');

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const action = formData.action;
      const ids = Array.isArray(formData.ids) ? formData.ids : (formData.ids ? [formData.ids] : []);

      if (!action || ids.length === 0) {
        redirect(res, '/admin/comments?error=' + encodeURIComponent('No action or comments selected'));
        return;
      }

      const result = await commentsService.bulkAction(ids, action);

      redirect(res, `/admin/comments?success=` + encodeURIComponent(`${result.success} comment(s) updated`));
    } catch (error) {
      redirect(res, '/admin/comments?error=' + encodeURIComponent(error.message));
    }
  }, 'Bulk action on comments');

  // ==========================================
  // Trash Management
  // ==========================================

  /**
   * GET /admin/trash - List trashed items
   */
  register('GET', '/admin/trash', async (req, res, params, ctx) => {
    const url = new URL(req.url, 'http://localhost');
    const typeFilter = url.searchParams.get('type') || null;

    const items = content.listTrash(typeFilter);
    const stats = content.getTrashStats();
    const trashConfig = content.getTrashConfig();

    // Format items for display
    const formattedItems = items.map(item => ({
      type: item.type,
      id: item.id,
      displayTitle: item.title || item.name || item.id,
      trashedFormatted: formatDate(item._trashedAt),
      trashedBy: item._trashedBy || 'unknown',
      daysAgo: item._daysInTrash,
      daysRemaining: item._daysRemaining,
      willPurgeSoon: item._daysRemaining <= 5 && trashConfig.autoPurge,
    }));

    // Type stats for tabs
    const typeStats = Object.entries(stats.byType).map(([type, count]) => ({
      type,
      count,
      active: typeFilter === type,
    }));

    // Auto-purge warning
    let autoPurgeWarning = null;
    if (trashConfig.autoPurge && stats.autoPurgeIn !== null && stats.autoPurgeIn <= 5 && stats.total > 0) {
      const itemsAtRisk = items.filter(i => i._daysRemaining <= 5).length;
      autoPurgeWarning = `${itemsAtRisk} item(s) will be auto-purged within ${stats.autoPurgeIn} days.`;
    }

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('trash-list.html', {
      pageTitle: 'Trash',
      items: formattedItems,
      hasItems: formattedItems.length > 0,
      totalItems: stats.total,
      oldestDays: stats.oldestDays,
      retention: stats.retention,
      autoPurgeEnabled: stats.autoPurgeEnabled,
      autoPurgeWarning,
      typeFilter,
      typeStats,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'List trashed items');

  /**
   * POST /admin/trash/:type/:id/restore - Restore item from trash
   */
  register('POST', '/admin/trash/:type/:id/restore', async (req, res, params, ctx) => {
    const { type, id } = params;

    try {
      const item = await content.restore(type, id);
      if (!item) {
        redirect(res, '/admin/trash?error=' + encodeURIComponent('Item not found in trash'));
        return;
      }

      redirect(res, '/admin/trash?success=' + encodeURIComponent(`Restored ${type}/${id}`));
    } catch (error) {
      redirect(res, '/admin/trash?error=' + encodeURIComponent(error.message));
    }
  }, 'Restore item from trash');

  /**
   * POST /admin/trash/:type/:id/purge - Permanently delete from trash
   */
  register('POST', '/admin/trash/:type/:id/purge', async (req, res, params, ctx) => {
    const { type, id } = params;

    try {
      const success = await content.purge(type, id);
      if (!success) {
        redirect(res, '/admin/trash?error=' + encodeURIComponent('Item not found in trash'));
        return;
      }

      redirect(res, '/admin/trash?success=' + encodeURIComponent(`Permanently deleted ${type}/${id}`));
    } catch (error) {
      redirect(res, '/admin/trash?error=' + encodeURIComponent(error.message));
    }
  }, 'Permanently delete from trash');

  /**
   * POST /admin/trash/empty - Empty all trash
   */
  register('POST', '/admin/trash/empty', async (req, res, params, ctx) => {
    try {
      const result = await content.emptyTrash();
      redirect(res, '/admin/trash?success=' + encodeURIComponent(`Permanently deleted ${result.purged} items`));
    } catch (error) {
      redirect(res, '/admin/trash?error=' + encodeURIComponent(error.message));
    }
  }, 'Empty all trash');

  /**
   * POST /admin/trash/:type/empty - Empty trash for a type
   */
  register('POST', '/admin/trash/:type/empty', async (req, res, params, ctx) => {
    const { type } = params;

    try {
      const result = await content.emptyTrash(type);
      redirect(res, '/admin/trash?success=' + encodeURIComponent(`Permanently deleted ${result.purged} ${type} items`));
    } catch (error) {
      redirect(res, '/admin/trash?error=' + encodeURIComponent(error.message));
    }
  }, 'Empty trash for type');

  // ==========================================
  // Internationalization (i18n)
  // ==========================================

  /**
   * GET /admin/i18n - Locales overview
   */
  register('GET', '/admin/i18n', async (req, res, params, ctx) => {
    const i18nService = ctx.services.get('i18n');
    const i18nConfig = ctx.config.site.i18n || {};

    const locales = i18nService.getAvailableLocales().map(locale => ({
      ...locale,
      percentage: i18nService.getCompletionStats(locale.code).percentage,
    }));

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('i18n-list.html', {
      pageTitle: 'Translations',
      locales,
      hasLocales: locales.length > 0,
      localeCount: locales.length,
      totalKeys: i18nService.getAllKeys().length,
      defaultLocale: i18nService.getDefaultLocale(),
      enabled: i18nConfig.enabled !== false,
      fallback: i18nConfig.fallback !== false,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Locales overview');

  /**
   * GET /admin/i18n/new - Add new locale form
   */
  register('GET', '/admin/i18n/new', async (req, res, params, ctx) => {
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('i18n-new.html', {
      pageTitle: 'Add Locale',
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Add locale form');

  /**
   * POST /admin/i18n/new - Create new locale
   */
  register('POST', '/admin/i18n/new', async (req, res, params, ctx) => {
    const i18nService = ctx.services.get('i18n');
    const formData = ctx._parsedBody || await parseFormBody(req);

    try {
      const code = formData.code?.trim().toLowerCase();

      if (!code) {
        redirect(res, '/admin/i18n/new?error=' + encodeURIComponent('Locale code is required'));
        return;
      }

      const created = i18nService.createLocale(code);

      if (created) {
        redirect(res, `/admin/i18n/${code}?success=` + encodeURIComponent('Locale created'));
      } else {
        redirect(res, '/admin/i18n?error=' + encodeURIComponent('Locale already exists'));
      }
    } catch (error) {
      redirect(res, '/admin/i18n/new?error=' + encodeURIComponent(error.message));
    }
  }, 'Create new locale');

  /**
   * GET /admin/i18n/:code - Edit locale translations
   */
  register('GET', '/admin/i18n/:code', async (req, res, params, ctx) => {
    const { code } = params;
    const i18nService = ctx.services.get('i18n');

    const locales = i18nService.getAvailableLocales();
    const locale = locales.find(l => l.code === code);

    if (!locale) {
      redirect(res, '/admin/i18n?error=' + encodeURIComponent('Locale not found'));
      return;
    }

    // Parse query params for search/filter
    const url = new URL(req.url, 'http://localhost');
    const search = url.searchParams.get('search') || '';
    const filter = url.searchParams.get('filter') || '';

    const defaultLocale = i18nService.getDefaultLocale();
    const allKeys = i18nService.getAllKeys();
    const translations = i18nService.getTranslations(code);
    const defaultTranslations = i18nService.getTranslations(defaultLocale);
    const missing = i18nService.getMissingKeys(code);
    const stats = i18nService.getCompletionStats(code);

    // Build translations list
    let translationList = allKeys.map(key => ({
      key,
      defaultValue: defaultTranslations[key] || '',
      value: translations[key] || '',
      isMissing: !translations[key],
      isLong: (defaultTranslations[key]?.length || 0) > 100 || (translations[key]?.length || 0) > 100,
    }));

    // Apply filter
    if (filter === 'missing') {
      translationList = translationList.filter(t => t.isMissing);
    } else if (filter === 'translated') {
      translationList = translationList.filter(t => !t.isMissing);
    }

    // Apply search
    if (search) {
      const searchLower = search.toLowerCase();
      translationList = translationList.filter(t =>
        t.key.toLowerCase().includes(searchLower) ||
        t.defaultValue.toLowerCase().includes(searchLower) ||
        t.value.toLowerCase().includes(searchLower)
      );
    }

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('i18n-edit.html', {
      pageTitle: `Edit ${code}`,
      code,
      name: locale.name,
      isDefault: code === defaultLocale,
      defaultLocale,
      keyCount: Object.keys(translations).length,
      percentage: stats.percentage,
      hasMissing: missing.length > 0,
      missingCount: missing.length,
      translations: translationList,
      hasTranslations: translationList.length > 0,
      search,
      filter,
      filterMissing: filter === 'missing',
      filterTranslated: filter === 'translated',
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Edit locale translations');

  /**
   * POST /admin/i18n/:code - Save translations
   */
  register('POST', '/admin/i18n/:code', async (req, res, params, ctx) => {
    const { code } = params;
    const i18nService = ctx.services.get('i18n');
    const formData = ctx._parsedBody || await parseFormBody(req);

    try {
      // Parse translations from form data
      // Form data comes as translations[key]=value
      const updates = {};

      for (const [key, value] of Object.entries(formData)) {
        if (key.startsWith('translations[') && key.endsWith(']')) {
          const translationKey = key.slice(13, -1);
          if (value.trim()) {
            updates[translationKey] = value;
          }
        }
      }

      // Update translations
      for (const [key, value] of Object.entries(updates)) {
        i18nService.setTranslation(code, key, value);
      }

      // Save to file
      i18nService.saveLocale(code);

      redirect(res, `/admin/i18n/${code}?success=` + encodeURIComponent('Translations saved'));
    } catch (error) {
      redirect(res, `/admin/i18n/${code}?error=` + encodeURIComponent(error.message));
    }
  }, 'Save translations');

  /**
   * POST /admin/i18n/:code/add-key - Add new translation key
   */
  register('POST', '/admin/i18n/:code/add-key', async (req, res, params, ctx) => {
    const { code } = params;
    const i18nService = ctx.services.get('i18n');
    const formData = ctx._parsedBody || await parseFormBody(req);

    try {
      const key = formData.key?.trim();
      const value = formData.value?.trim();

      if (!key || !value) {
        redirect(res, `/admin/i18n/${code}?error=` + encodeURIComponent('Key and value are required'));
        return;
      }

      i18nService.setTranslation(code, key, value);
      i18nService.saveLocale(code);

      redirect(res, `/admin/i18n/${code}?success=` + encodeURIComponent(`Added key: ${key}`));
    } catch (error) {
      redirect(res, `/admin/i18n/${code}?error=` + encodeURIComponent(error.message));
    }
  }, 'Add translation key');

  /**
   * GET /admin/i18n/:code/export - Export translations as JSON download
   */
  register('GET', '/admin/i18n/:code/export', async (req, res, params, ctx) => {
    const { code } = params;
    const i18nService = ctx.services.get('i18n');

    const data = i18nService.exportTranslations(code);
    const filename = `translations-${code}-${new Date().toISOString().slice(0, 10)}.json`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.end(JSON.stringify(data, null, 2));
  }, 'Export translations');

  /**
   * POST /admin/i18n/import - Import translations from file
   */
  register('POST', '/admin/i18n/import', async (req, res, params, ctx) => {
    const i18nService = ctx.services.get('i18n');
    const mediaService = ctx.services.get('media');

    try {
      const { fields, files } = await mediaService.parseUpload(req);

      if (!files || files.length === 0) {
        redirect(res, '/admin/i18n?error=' + encodeURIComponent('No file uploaded'));
        return;
      }

      const locale = fields.locale;
      const merge = fields.merge === '1' || fields.merge === 'on';

      if (!locale) {
        redirect(res, '/admin/i18n?error=' + encodeURIComponent('Target locale is required'));
        return;
      }

      const fileContent = files[0].data.toString('utf-8');
      const data = JSON.parse(fileContent);

      const result = i18nService.importTranslations(locale, data, merge);

      redirect(res, `/admin/i18n/${locale}?success=` + encodeURIComponent(`Imported: ${result.added} added, ${result.updated} updated`));
    } catch (error) {
      redirect(res, '/admin/i18n?error=' + encodeURIComponent(error.message));
    }
  }, 'Import translations');

  // ==========================================
  // Content Translation
  // ==========================================

  /**
   * GET /admin/content/:type/:id/translate - Content translation overview
   */
  register('GET', '/admin/content/:type/:id/translate', async (req, res, params, ctx) => {
    const { type, id } = params;
    const i18nService = ctx.services.get('i18n');

    if (!content.hasType(type)) {
      redirect(res, '/admin/content?error=' + encodeURIComponent('Unknown content type'));
      return;
    }

    const item = content.read(type, id);
    if (!item) {
      redirect(res, `/admin/content/${type}?error=` + encodeURIComponent('Content not found'));
      return;
    }

    const schema = content.getSchema(type);
    const translatableFields = i18nService.getTranslatableFields(schema);
    const status = i18nService.getContentTranslationStatus(type, id);
    const defaultLocale = i18nService.getDefaultLocale();
    const locales = i18nService.getAvailableLocales();

    const statusList = locales.map(locale => ({
      code: locale.code,
      name: locale.name,
      ...status[locale.code],
      isComplete: status[locale.code]?.percentage === 100,
    }));

    const flash = getFlashMessage(req.url);
    const itemTitle = item.title || item.name || id;

    const html = renderAdmin('content-translate.html', {
      pageTitle: `Translate: ${itemTitle}`,
      type,
      id,
      item,
      itemTitle,
      defaultLocale,
      statusList,
      translatableFieldsList: translatableFields,
      isEditing: false,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Content translation overview');

  /**
   * GET /admin/content/:type/:id/translate/:locale - Edit content translation
   */
  register('GET', '/admin/content/:type/:id/translate/:locale', async (req, res, params, ctx) => {
    const { type, id, locale } = params;
    const i18nService = ctx.services.get('i18n');

    if (!content.hasType(type)) {
      redirect(res, '/admin/content?error=' + encodeURIComponent('Unknown content type'));
      return;
    }

    const item = content.read(type, id);
    if (!item) {
      redirect(res, `/admin/content/${type}?error=` + encodeURIComponent('Content not found'));
      return;
    }

    const defaultLocale = i18nService.getDefaultLocale();

    if (locale === defaultLocale) {
      redirect(res, `/admin/content/${type}/${id}/translate?error=` + encodeURIComponent('Cannot translate default locale'));
      return;
    }

    const schema = content.getSchema(type);
    const translatableFields = i18nService.getTranslatableFields(schema);
    const existingTranslation = item._translations?.[locale] || {};
    const locales = i18nService.getAvailableLocales();
    const targetLocaleInfo = locales.find(l => l.code === locale);

    const translatableFieldsData = translatableFields.map(field => ({
      field,
      originalValue: item[field] || '',
      translatedValue: existingTranslation[field] || '',
      isLong: (item[field]?.length || 0) > 100,
      isRequired: schema[field]?.required || false,
    }));

    const status = i18nService.getContentTranslationStatus(type, id);
    const statusList = locales.map(loc => ({
      code: loc.code,
      name: loc.name,
      ...status[loc.code],
      isComplete: status[loc.code]?.percentage === 100,
    }));

    const flash = getFlashMessage(req.url);
    const itemTitle = item.title || item.name || id;

    const html = renderAdmin('content-translate.html', {
      pageTitle: `Translate to ${locale}: ${itemTitle}`,
      type,
      id,
      item,
      itemTitle,
      defaultLocale,
      targetLocale: locale,
      targetLocaleName: targetLocaleInfo?.name || locale,
      translatableFields: translatableFieldsData,
      translatableFieldsList: translatableFields,
      hasExistingTranslation: Object.keys(existingTranslation).length > 0,
      statusList,
      isEditing: true,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Edit content translation');

  /**
   * POST /admin/content/:type/:id/translate/:locale - Save content translation
   */
  register('POST', '/admin/content/:type/:id/translate/:locale', async (req, res, params, ctx) => {
    const { type, id, locale } = params;
    const i18nService = ctx.services.get('i18n');
    const formData = ctx._parsedBody || await parseFormBody(req);

    if (!content.hasType(type)) {
      redirect(res, '/admin/content?error=' + encodeURIComponent('Unknown content type'));
      return;
    }

    try {
      // Remove CSRF token from form data
      const translationData = {};
      for (const [key, value] of Object.entries(formData)) {
        if (!key.startsWith('_') && value.trim()) {
          translationData[key] = value;
        }
      }

      await i18nService.setContentTranslation(type, id, locale, translationData);

      redirect(res, `/admin/content/${type}/${id}/translate?success=` + encodeURIComponent(`Translation saved for ${locale}`));
    } catch (error) {
      redirect(res, `/admin/content/${type}/${id}/translate/${locale}?error=` + encodeURIComponent(error.message));
    }
  }, 'Save content translation');

  /**
   * POST /admin/content/:type/:id/translate/:locale/delete - Delete content translation
   */
  register('POST', '/admin/content/:type/:id/translate/:locale/delete', async (req, res, params, ctx) => {
    const { type, id, locale } = params;
    const i18nService = ctx.services.get('i18n');

    if (!content.hasType(type)) {
      redirect(res, '/admin/content?error=' + encodeURIComponent('Unknown content type'));
      return;
    }

    try {
      const deleted = await i18nService.deleteContentTranslation(type, id, locale);

      if (deleted) {
        redirect(res, `/admin/content/${type}/${id}/translate?success=` + encodeURIComponent(`Deleted ${locale} translation`));
      } else {
        redirect(res, `/admin/content/${type}/${id}/translate?error=` + encodeURIComponent('Translation not found'));
      }
    } catch (error) {
      redirect(res, `/admin/content/${type}/${id}/translate?error=` + encodeURIComponent(error.message));
    }
  }, 'Delete content translation');

  // ==========================================
  // Audit Logging
  // ==========================================

  /**
   * GET /admin/audit - Audit log viewer with filters
   */
  register('GET', '/admin/audit', async (req, res, params, ctx) => {
    const auditService = ctx.services.get('audit');
    if (!auditService) {
      const html = renderAdmin('audit.html', {
        pageTitle: 'Audit Logs',
        error: 'Audit service not available',
        hasEntries: false,
      }, ctx, req);
      server.html(res, html);
      return;
    }

    // Parse query params
    const url = new URL(req.url, 'http://localhost');
    const filters = {
      search: url.searchParams.get('search') || null,
      action: url.searchParams.get('action') || null,
      username: url.searchParams.get('user') || null,
      result: url.searchParams.get('result') || null,
      days: parseInt(url.searchParams.get('days')) || 7,
    };

    const page = parseInt(url.searchParams.get('page')) || 1;
    const limit = 50;
    const offset = (page - 1) * limit;

    const result = auditService.query(filters, { limit, offset });
    const stats = auditService.getStats({ days: filters.days });

    // Get unique actions for filter dropdown
    const uniqueActions = auditService.getUniqueActions();

    // Process entries for display
    const entries = result.entries.map(entry => {
      // Determine action color
      let actionColor = '#6c757d'; // default gray
      if (entry.action.startsWith('auth.')) actionColor = '#007bff'; // blue
      else if (entry.action.startsWith('content.')) actionColor = '#28a745'; // green
      else if (entry.action.startsWith('user.')) actionColor = '#17a2b8'; // cyan
      else if (entry.action.startsWith('plugin.')) actionColor = '#ffc107'; // yellow
      else if (entry.action.startsWith('export.') || entry.action.startsWith('import.')) actionColor = '#6f42c1'; // purple

      // Format details summary
      let detailsSummary = '';
      if (entry.details) {
        if (entry.details.type && entry.details.id) {
          detailsSummary = `${entry.details.type}/${entry.details.id}`;
        } else if (entry.details.plugin) {
          detailsSummary = entry.details.plugin;
        } else {
          const keys = Object.keys(entry.details).slice(0, 2);
          detailsSummary = keys.map(k => `${k}: ${entry.details[k]}`).join(', ');
        }
      }

      return {
        ...entry,
        timestampFormatted: formatDate(entry.timestamp),
        actionColor,
        detailsSummary,
        detailsJson: JSON.stringify(entry.details, null, 2),
        isSuccess: entry.result === 'success',
      };
    });

    const flash = getFlashMessage(req.url);

    const totalPages = Math.ceil(result.total / limit);

    const html = renderAdmin('audit.html', {
      pageTitle: 'Audit Logs',
      entries,
      hasEntries: entries.length > 0,
      total: result.total,
      stats,
      successCount: stats.byResult?.success || 0,
      failureCount: stats.byResult?.failure || 0,
      uniqueUsers: Object.keys(stats.byUser).length,
      uniqueActions,
      // Filter state
      search: filters.search || '',
      selectedAction: filters.action,
      selectedUser: filters.username,
      selectedResult: filters.result,
      selectedDays: filters.days,
      // Pagination
      pagination: {
        page,
        pages: totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages,
        prevPage: page - 1,
        nextPage: page + 1,
      },
      hasPagination: totalPages > 1,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Audit log viewer');

  /**
   * GET /admin/audit/export - Export audit logs
   */
  register('GET', '/admin/audit/export', async (req, res, params, ctx) => {
    const auditService = ctx.services.get('audit');
    if (!auditService) {
      server.json(res, { error: 'Audit service not available' }, 500);
      return;
    }

    // Parse query params
    const url = new URL(req.url, 'http://localhost');
    const filters = {
      action: url.searchParams.get('action') || null,
      username: url.searchParams.get('user') || null,
      result: url.searchParams.get('result') || null,
      days: parseInt(url.searchParams.get('days')) || 30,
    };

    const format = url.searchParams.get('format') || 'json';
    const data = auditService.exportLogs(filters, format);

    const date = new Date().toISOString().slice(0, 10);
    const ext = format === 'csv' ? 'csv' : 'json';
    const contentType = format === 'csv' ? 'text/csv' : 'application/json';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="audit-export-${date}.${ext}"`);
    res.end(data);
  }, 'Export audit logs');

  /**
   * GET /admin/audit/user/:id - Logs for specific user
   */
  register('GET', '/admin/audit/user/:id', async (req, res, params, ctx) => {
    const { id } = params;
    const auditService = ctx.services.get('audit');

    if (!auditService) {
      redirect(res, '/admin/audit?error=' + encodeURIComponent('Audit service not available'));
      return;
    }

    // Redirect to audit page with user filter
    redirect(res, `/admin/audit?user=${encodeURIComponent(id)}&days=30`);
  }, 'View user audit logs');

  /**
   * GET /admin/audit/content/:type/:id - Logs for specific content
   */
  register('GET', '/admin/audit/content/:type/:id', async (req, res, params, ctx) => {
    const { type, id } = params;
    const auditService = ctx.services.get('audit');

    if (!auditService) {
      redirect(res, '/admin/audit?error=' + encodeURIComponent('Audit service not available'));
      return;
    }

    // Get logs for this content item
    const result = auditService.getByContent(type, id, { limit: 100 });

    // Process entries for display
    const entries = result.entries.map(entry => {
      let actionColor = '#28a745';
      if (entry.action.includes('delete')) actionColor = '#dc3545';
      else if (entry.action.includes('update')) actionColor = '#ffc107';

      return {
        ...entry,
        timestampFormatted: formatDate(entry.timestamp),
        actionColor,
        detailsSummary: `${entry.details?.type || type}/${entry.details?.id || id}`,
        detailsJson: JSON.stringify(entry.details, null, 2),
        isSuccess: entry.result === 'success',
      };
    });

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('audit.html', {
      pageTitle: `Audit: ${type}/${id}`,
      entries,
      hasEntries: entries.length > 0,
      total: result.total,
      stats: { total: result.total },
      successCount: entries.filter(e => e.result === 'success').length,
      failureCount: entries.filter(e => e.result !== 'success').length,
      uniqueUsers: new Set(entries.map(e => e.username)).size,
      uniqueActions: [...new Set(entries.map(e => e.action))],
      selectedDays: 30,
      hasPagination: false,
      flash,
      hasFlash: !!flash,
      contentFilter: { type, id },
    }, ctx, req);

    server.html(res, html);
  }, 'View content audit logs');

  // ==========================================
  // Analytics Dashboard
  // ==========================================

  /**
   * GET /admin/analytics - Analytics dashboard
   */
  register('GET', '/admin/analytics', async (req, res, params, ctx) => {
    const analyticsService = ctx.services.get('analytics');
    const urlObj = new URL(req.url, 'http://localhost');
    const period = urlObj.searchParams.get('period') || 'week';

    if (!analyticsService) {
      const html = renderAdmin('analytics.html', {
        pageTitle: 'Analytics',
        error: 'Analytics service not available',
        summary: { pageViews: 0, uniqueVisitors: 0, contentCreated: 0, logins: 0, contentViews: 0, contentUpdated: 0, apiRequests: 0, searches: 0 },
        isDayPeriod: period === 'day',
        isWeekPeriod: period === 'week',
        isMonthPeriod: period === 'month',
        periodLabel: period,
        hasChartData: false,
        hasTopContent: false,
        hasRecentActivity: false,
      }, ctx, req);
      server.html(res, html);
      return;
    }

    // Get summary for selected period
    const summary = analyticsService.getSummary(period);

    // Get chart data
    const days = period === 'day' ? 1 : period === 'week' ? 7 : 30;
    const chartRaw = analyticsService.getChartData('pageviews', { days });
    const maxValue = Math.max(...chartRaw.data, 1);
    const chartData = chartRaw.labels.map((label, i) => ({
      label,
      value: chartRaw.data[i],
      heightPercent: Math.round((chartRaw.data[i] / maxValue) * 100),
      shortLabel: new Date(label).toLocaleDateString('en-US', { weekday: 'short' }).charAt(0),
    }));

    // Get top content
    const topContent = analyticsService.getPopularContent(null, { days, limit: 10 });

    // Get recent events for activity feed
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 1);
    const recentEvents = analyticsService.getEvents(start, end).slice(0, 20);

    const recentActivity = recentEvents.map(event => {
      const timeAgo = formatRelativeTime(new Date(event.timestamp));
      let icon = '•';
      let description = event.event;

      switch (event.event) {
        case 'content.create':
          icon = '✚';
          description = `Created ${event.type}/${event.id}`;
          break;
        case 'content.update':
          icon = '✎';
          description = `Updated ${event.type}/${event.id}`;
          break;
        case 'content.view':
          icon = '👁';
          description = `Viewed ${event.type}/${event.id}`;
          break;
        case 'login':
          icon = '→';
          description = `User ${event.userId || 'anonymous'} logged in`;
          break;
        case 'pageview':
          icon = '📄';
          description = `Page view: ${event.path}`;
          break;
        case 'search':
          icon = '🔍';
          description = `Search: "${event.query}" (${event.results} results)`;
          break;
      }

      return { icon, description, timeAgo };
    });

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('analytics.html', {
      pageTitle: 'Analytics',
      summary,
      isDayPeriod: period === 'day',
      isWeekPeriod: period === 'week',
      isMonthPeriod: period === 'month',
      periodLabel: period === 'day' ? 'Today' : period === 'week' ? 'Last 7 Days' : 'Last 30 Days',
      chartData,
      chartTotal: chartRaw.total,
      hasChartData: chartRaw.total > 0,
      topContent,
      hasTopContent: topContent.length > 0,
      recentActivity,
      hasRecentActivity: recentActivity.length > 0,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Analytics dashboard');

  /**
   * GET /admin/analytics/content - Content analytics
   */
  register('GET', '/admin/analytics/content', async (req, res, params, ctx) => {
    const analyticsService = ctx.services.get('analytics');
    const urlObj = new URL(req.url, 'http://localhost');
    const selectedType = urlObj.searchParams.get('type') || '';
    const days = parseInt(urlObj.searchParams.get('days') || '30', 10);

    if (!analyticsService) {
      redirect(res, '/admin/analytics?error=' + encodeURIComponent('Analytics service not available'));
      return;
    }

    // Get content types for filter
    const contentTypes = content.listTypes().map(t => ({
      type: t.type,
      selected: t.type === selectedType,
    }));

    // Get content stats
    const stats = analyticsService.getContentStats(selectedType || null);
    const popularContent = analyticsService.getPopularContent(selectedType || null, { days, limit: 50 });

    // Enrich with last viewed time
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    const viewEvents = analyticsService.getEvents(start, end, 'content.view');

    const contentList = popularContent.map(item => {
      const contentViews = viewEvents.filter(e => e.type === item.type && e.id === item.id);
      const uniqueIps = new Set(contentViews.map(e => e.ip).filter(Boolean));
      const lastView = contentViews.length > 0 ? contentViews[contentViews.length - 1] : null;

      return {
        ...item,
        uniqueViews: uniqueIps.size,
        lastViewedFormatted: lastView ? formatDate(lastView.timestamp) : 'Never',
      };
    });

    const totalViews = stats.views;
    const totalContent = contentList.length;
    const avgViews = totalContent > 0 ? Math.round(totalViews / totalContent) : 0;

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('analytics-content.html', {
      pageTitle: 'Content Analytics',
      contentTypes,
      selectedType,
      days,
      is7Days: days === 7,
      is30Days: days === 30,
      is90Days: days === 90,
      contentList,
      hasContent: contentList.length > 0,
      totalViews,
      totalContent,
      avgViews,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Content analytics');

  /**
   * GET /admin/analytics/content/:type/:id - Single content stats
   */
  register('GET', '/admin/analytics/content/:type/:id', async (req, res, params, ctx) => {
    const { type, id } = params;
    const analyticsService = ctx.services.get('analytics');

    if (!analyticsService) {
      redirect(res, '/admin/analytics?error=' + encodeURIComponent('Analytics service not available'));
      return;
    }

    // Get content item
    let contentItem = null;
    try {
      contentItem = content.read(type, id);
    } catch (e) {
      // Content might be deleted
    }

    // Get view events for this content
    const end = new Date();
    const start30 = new Date();
    start30.setDate(start30.getDate() - 30);
    const start7 = new Date();
    start7.setDate(start7.getDate() - 7);
    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);

    const viewEvents30 = analyticsService.getEvents(start30, end, 'content.view')
      .filter(e => e.type === type && e.id === id);
    const viewEvents7 = viewEvents30.filter(e => new Date(e.timestamp) >= start7);
    const viewEventsToday = viewEvents30.filter(e => new Date(e.timestamp) >= startToday);

    const uniqueIps = new Set(viewEvents30.map(e => e.ip).filter(Boolean));

    // Chart data - views per day for last 30 days
    const byDay = {};
    for (const event of viewEvents30) {
      const day = event.timestamp.split('T')[0];
      byDay[day] = (byDay[day] || 0) + 1;
    }

    const chartData = [];
    const current = new Date(start30);
    let maxValue = 1;
    while (current <= end) {
      const day = current.toISOString().split('T')[0];
      const value = byDay[day] || 0;
      if (value > maxValue) maxValue = value;
      chartData.push({ label: day, value, shortLabel: day.slice(-2) });
      current.setDate(current.getDate() + 1);
    }

    // Calculate height percentages
    chartData.forEach(d => {
      d.heightPercent = Math.round((d.value / maxValue) * 100);
    });

    // Recent views
    const recentViews = viewEvents30.slice(-20).reverse().map(e => ({
      timeFormatted: formatDate(e.timestamp),
      userId: e.userId,
      ipMasked: e.ip ? e.ip.replace(/\.\d+$/, '.xxx') : 'unknown',
      userAgent: e.userAgent ? e.userAgent.slice(0, 50) + '...' : 'unknown',
    }));

    const stats = {
      totalViews: viewEvents30.length,
      uniqueViews: uniqueIps.size,
      viewsThisWeek: viewEvents7.length,
      viewsToday: viewEventsToday.length,
    };

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('analytics-detail.html', {
      pageTitle: `Stats: ${contentItem?.title || id}`,
      content: contentItem ? {
        ...contentItem,
        createdFormatted: formatDate(contentItem.created),
      } : { title: id },
      contentType: type,
      contentId: id,
      stats,
      chartData,
      hasChartData: viewEvents30.length > 0,
      recentViews,
      hasRecentViews: recentViews.length > 0,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Single content analytics');

  /**
   * GET /admin/analytics/users - User activity
   */
  register('GET', '/admin/analytics/users', async (req, res, params, ctx) => {
    const analyticsService = ctx.services.get('analytics');
    const usersService = ctx.services.get('users');
    const urlObj = new URL(req.url, 'http://localhost');
    const days = parseInt(urlObj.searchParams.get('days') || '30', 10);

    if (!analyticsService) {
      redirect(res, '/admin/analytics?error=' + encodeURIComponent('Analytics service not available'));
      return;
    }

    // Get user activity stats
    const activity = analyticsService.getUserActivity();

    // Enrich with user details
    const users = activity.topUsers.map(u => {
      let userInfo = { username: u.userId, role: 'unknown' };
      if (usersService && u.userId !== 'anonymous') {
        try {
          const user = usersService.get(u.userId);
          if (user) {
            userInfo = { username: user.username, role: user.role };
          }
        } catch (e) {
          // User might be deleted
        }
      }

      return {
        ...u,
        username: userInfo.username,
        role: userInfo.role,
        isAnonymous: u.userId === 'anonymous',
        lastActiveFormatted: 'Recently', // Would need to track this
      };
    });

    const totalLogins = activity.totalLogins;
    const totalCreates = activity.totalCreates;
    const totalUpdates = activity.totalUpdates;
    const totalActions = totalLogins + totalCreates + totalUpdates;

    const loginPercent = totalActions > 0 ? Math.round((totalLogins / totalActions) * 100) : 0;
    const createPercent = totalActions > 0 ? Math.round((totalCreates / totalActions) * 100) : 0;
    const updatePercent = totalActions > 0 ? Math.round((totalUpdates / totalActions) * 100) : 0;

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('analytics-users.html', {
      pageTitle: 'User Activity',
      users,
      hasUsers: users.length > 0,
      totalLogins,
      totalCreates,
      totalUpdates,
      activeUsers: users.length,
      days,
      is7Days: days === 7,
      is30Days: days === 30,
      is90Days: days === 90,
      loginPercent,
      createPercent,
      updatePercent,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'User activity analytics');

  // ==========================================
  // Analytics API
  // ==========================================

  /**
   * GET /api/analytics/chart/views - JSON data for views chart
   */
  register('GET', '/api/analytics/chart/views', async (req, res, params, ctx) => {
    const analyticsService = ctx.services.get('analytics');
    const urlObj = new URL(req.url, 'http://localhost');
    const days = parseInt(urlObj.searchParams.get('days') || '7', 10);

    if (!analyticsService) {
      server.json(res, { error: 'Analytics not available' }, 500);
      return;
    }

    const chartData = analyticsService.getChartData('pageviews', { days });
    server.json(res, chartData);
  }, 'Get views chart data');

  /**
   * GET /api/analytics/chart/content - JSON data for content chart
   */
  register('GET', '/api/analytics/chart/content', async (req, res, params, ctx) => {
    const analyticsService = ctx.services.get('analytics');
    const urlObj = new URL(req.url, 'http://localhost');
    const days = parseInt(urlObj.searchParams.get('days') || '7', 10);

    if (!analyticsService) {
      server.json(res, { error: 'Analytics not available' }, 500);
      return;
    }

    const chartData = analyticsService.getChartData('content_views', { days });
    server.json(res, chartData);
  }, 'Get content chart data');

  /**
   * GET /api/analytics/summary - JSON summary data
   */
  register('GET', '/api/analytics/summary', async (req, res, params, ctx) => {
    const analyticsService = ctx.services.get('analytics');
    const urlObj = new URL(req.url, 'http://localhost');
    const period = urlObj.searchParams.get('period') || 'week';

    if (!analyticsService) {
      server.json(res, { error: 'Analytics not available' }, 500);
      return;
    }

    const summary = analyticsService.getSummary(period);
    server.json(res, summary);
  }, 'Get analytics summary');

  // ==========================================
  // Blueprints
  // ==========================================

  /**
   * GET /admin/blueprints - List all blueprints
   */
  register('GET', '/admin/blueprints', async (req, res, params, ctx) => {
    const blueprintsService = ctx.services.get('blueprints');
    const urlObj = new URL(req.url, 'http://localhost');
    const selectedType = urlObj.searchParams.get('type') || '';

    const blueprintsList = blueprintsService.list(selectedType || null);

    // Get content types for filter
    const contentTypes = content.listTypes().map(t => ({
      type: t.type,
      selected: t.type === selectedType,
    }));

    // Enrich blueprints for display
    const blueprints = blueprintsList.map(bp => ({
      ...bp,
      fieldCount: Object.keys(bp.template).length,
      fieldsList: Object.keys(bp.template).join(', '),
      hasLocked: bp.locked.length > 0,
      lockedCount: bp.locked.length,
      createdFormatted: formatDate(bp.createdAt),
    }));

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('blueprints-list.html', {
      pageTitle: 'Blueprints',
      blueprints,
      hasBlueprints: blueprints.length > 0,
      contentTypes,
      hasTypes: contentTypes.length > 0,
      selectedType,
      curlyOpen: '{{',
      curlyClose: '}}',
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'List blueprints');

  /**
   * GET /admin/blueprints/new - Create blueprint form
   */
  register('GET', '/admin/blueprints/new', async (req, res, params, ctx) => {
    const contentTypes = content.listTypes().map(t => ({
      type: t.type,
      selected: false,
    }));

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('blueprint-form.html', {
      pageTitle: 'Create Blueprint',
      isEdit: false,
      formAction: '/admin/blueprints',
      blueprint: { name: '', description: '', type: '', template: {}, locked: [] },
      templateFields: [],
      contentTypes,
      curlyOpen: '{{',
      curlyClose: '}}',
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Create blueprint form');

  /**
   * POST /admin/blueprints - Create blueprint
   */
  register('POST', '/admin/blueprints', async (req, res, params, ctx) => {
    const blueprintsService = ctx.services.get('blueprints');

    try {
      const body = await parseFormBody(req);

      const name = body.name?.trim();
      const type = body.type;
      const description = body.description?.trim() || '';

      if (!name || !type) {
        redirect(res, '/admin/blueprints/new?error=' + encodeURIComponent('Name and type are required'));
        return;
      }

      // Build template from form fields
      const template = {};
      const locked = [];

      const fieldNames = Array.isArray(body['fieldName[]']) ? body['fieldName[]'] : [body['fieldName[]']].filter(Boolean);
      const fieldValues = Array.isArray(body['fieldValue[]']) ? body['fieldValue[]'] : [body['fieldValue[]']].filter(Boolean);
      const lockedFields = Array.isArray(body['locked[]']) ? body['locked[]'] : [body['locked[]']].filter(Boolean);

      for (let i = 0; i < fieldNames.length; i++) {
        const fieldName = fieldNames[i]?.trim();
        const fieldValue = fieldValues[i] || '';

        if (fieldName) {
          template[fieldName] = fieldValue;
          if (lockedFields.includes(fieldName)) {
            locked.push(fieldName);
          }
        }
      }

      const bp = blueprintsService.create(name, type, template, {
        description,
        locked,
        createdBy: ctx.user?.username || 'admin',
      });

      redirect(res, '/admin/blueprints?success=' + encodeURIComponent(`Blueprint "${name}" created`));
    } catch (e) {
      redirect(res, '/admin/blueprints/new?error=' + encodeURIComponent(e.message));
    }
  }, 'Create blueprint');

  /**
   * GET /admin/blueprints/:id - Edit blueprint form
   */
  register('GET', '/admin/blueprints/:id', async (req, res, params, ctx) => {
    const { id } = params;
    const blueprintsService = ctx.services.get('blueprints');

    const bp = blueprintsService.get(id);
    if (!bp) {
      redirect(res, '/admin/blueprints?error=' + encodeURIComponent('Blueprint not found'));
      return;
    }

    const contentTypes = content.listTypes().map(t => ({
      type: t.type,
      selected: t.type === bp.type,
    }));

    // Convert template to array for form
    const templateFields = Object.entries(bp.template).map(([name, value]) => ({
      name,
      value: typeof value === 'string' ? value : JSON.stringify(value),
      isLocked: bp.locked.includes(name),
    }));

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('blueprint-form.html', {
      pageTitle: `Edit: ${bp.name}`,
      isEdit: true,
      formAction: `/admin/blueprints/${id}`,
      blueprint: {
        ...bp,
        createdFormatted: formatDate(bp.createdAt),
        updatedFormatted: formatDate(bp.updatedAt),
      },
      templateFields,
      contentTypes,
      curlyOpen: '{{',
      curlyClose: '}}',
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Edit blueprint form');

  /**
   * POST /admin/blueprints/:id - Update blueprint
   */
  register('POST', '/admin/blueprints/:id', async (req, res, params, ctx) => {
    const { id } = params;
    const blueprintsService = ctx.services.get('blueprints');

    const bp = blueprintsService.get(id);
    if (!bp) {
      redirect(res, '/admin/blueprints?error=' + encodeURIComponent('Blueprint not found'));
      return;
    }

    try {
      const body = await parseFormBody(req);

      const name = body.name?.trim();
      const description = body.description?.trim() || '';

      if (!name) {
        redirect(res, `/admin/blueprints/${id}?error=` + encodeURIComponent('Name is required'));
        return;
      }

      // Build template from form fields
      const template = {};
      const locked = [];

      const fieldNames = Array.isArray(body['fieldName[]']) ? body['fieldName[]'] : [body['fieldName[]']].filter(Boolean);
      const fieldValues = Array.isArray(body['fieldValue[]']) ? body['fieldValue[]'] : [body['fieldValue[]']].filter(Boolean);
      const lockedFields = Array.isArray(body['locked[]']) ? body['locked[]'] : [body['locked[]']].filter(Boolean);

      for (let i = 0; i < fieldNames.length; i++) {
        const fieldName = fieldNames[i]?.trim();
        const fieldValue = fieldValues[i] || '';

        if (fieldName) {
          template[fieldName] = fieldValue;
          if (lockedFields.includes(fieldName)) {
            locked.push(fieldName);
          }
        }
      }

      blueprintsService.update(id, { name, description, template, locked });

      redirect(res, '/admin/blueprints?success=' + encodeURIComponent(`Blueprint "${name}" updated`));
    } catch (e) {
      redirect(res, `/admin/blueprints/${id}?error=` + encodeURIComponent(e.message));
    }
  }, 'Update blueprint');

  /**
   * POST /admin/blueprints/:id/delete - Delete blueprint
   */
  register('POST', '/admin/blueprints/:id/delete', async (req, res, params, ctx) => {
    const { id } = params;
    const blueprintsService = ctx.services.get('blueprints');

    const bp = blueprintsService.get(id);
    if (!bp) {
      redirect(res, '/admin/blueprints?error=' + encodeURIComponent('Blueprint not found'));
      return;
    }

    const name = bp.name;
    blueprintsService.remove(id);

    redirect(res, '/admin/blueprints?success=' + encodeURIComponent(`Blueprint "${name}" deleted`));
  }, 'Delete blueprint');

  /**
   * POST /admin/content/:type/:id/to-blueprint - Create blueprint from content
   */
  register('POST', '/admin/content/:type/:id/to-blueprint', async (req, res, params, ctx) => {
    const { type, id } = params;
    const blueprintsService = ctx.services.get('blueprints');

    try {
      const body = await parseFormBody(req);
      const name = body.name?.trim();

      if (!name) {
        redirect(res, `/admin/content/${type}/${id}/edit?error=` + encodeURIComponent('Blueprint name is required'));
        return;
      }

      const bp = blueprintsService.createFromContent(type, id, name, {
        description: body.description?.trim() || '',
        createdBy: ctx.user?.username || 'admin',
      });

      redirect(res, `/admin/blueprints/${bp.id}?success=` + encodeURIComponent(`Blueprint "${name}" created from content`));
    } catch (e) {
      redirect(res, `/admin/content/${type}/${id}/edit?error=` + encodeURIComponent(e.message));
    }
  }, 'Create blueprint from content');

  // ==========================================
  // Favorites Management
  // ==========================================

  /**
   * GET /admin/favorites - List user's favorites
   */
  register('GET', '/admin/favorites', async (req, res, params, ctx) => {
    const favoritesService = ctx.services.get('favorites');
    const user = ctx.session?.user;

    if (!user) {
      redirect(res, '/admin/users/login?error=' + encodeURIComponent('Please log in to view favorites'));
      return;
    }

    const url = new URL(req.url, 'http://localhost');
    const filterType = url.searchParams.get('type') || null;
    const sortBy = url.searchParams.get('sort') || 'addedAt';
    const sortOrder = url.searchParams.get('order') || 'desc';

    const favorites = favoritesService.getFavorites(user.id, {
      contentType: filterType,
      sortBy,
      sortOrder,
      includeContent: true,
    });

    // Get list of content types for filter dropdown
    const types = content.listTypes().map(t => t.type);

    const flash = getFlashMessage(req.url);

    // Format favorites for display
    const items = favorites.map(fav => ({
      ...fav,
      addedAtFormatted: formatDate(fav.addedAt),
      addedAtRelative: formatRelativeTime(new Date(fav.addedAt)),
      title: getContentTitle(fav.content),
    }));

    const html = renderAdmin('favorites.html', {
      pageTitle: 'Your Favorites',
      items,
      hasItems: items.length > 0,
      itemCount: items.length,
      types,
      filterType,
      sortBy,
      sortOrder,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'List user favorites');

  /**
   * POST /admin/favorites - Add a favorite
   */
  register('POST', '/admin/favorites', async (req, res, params, ctx) => {
    const favoritesService = ctx.services.get('favorites');
    const user = ctx.session?.user;

    if (!user) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not authenticated' }));
      return;
    }

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const { contentType, contentId, label } = formData;

      if (!contentType || !contentId) {
        throw new Error('contentType and contentId are required');
      }

      const favorite = favoritesService.addFavorite(user.id, contentType, contentId, label || null);

      // Check if this is an AJAX request
      const isAjax = req.headers['x-requested-with'] === 'XMLHttpRequest' ||
                     req.headers['accept']?.includes('application/json');

      if (isAjax) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, favorite }));
      } else {
        const returnUrl = formData._return || `/admin/content/${contentType}`;
        redirect(res, returnUrl + '?success=' + encodeURIComponent('Added to favorites'));
      }
    } catch (error) {
      const isAjax = req.headers['x-requested-with'] === 'XMLHttpRequest';
      if (isAjax) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      } else {
        redirect(res, '/admin/favorites?error=' + encodeURIComponent(error.message));
      }
    }
  }, 'Add favorite');

  /**
   * POST /admin/favorites/:type/:id/delete - Remove a favorite
   */
  register('POST', '/admin/favorites/:type/:id/delete', async (req, res, params, ctx) => {
    const favoritesService = ctx.services.get('favorites');
    const user = ctx.session?.user;
    const { type, id } = params;

    if (!user) {
      redirect(res, '/admin/users/login');
      return;
    }

    const removed = favoritesService.removeFavorite(user.id, type, id);

    const formData = ctx._parsedBody || {};
    const returnUrl = formData._return || '/admin/favorites';

    if (removed) {
      redirect(res, returnUrl + '?success=' + encodeURIComponent('Removed from favorites'));
    } else {
      redirect(res, returnUrl + '?error=' + encodeURIComponent('Favorite not found'));
    }
  }, 'Remove favorite');

  /**
   * POST /admin/content/:type/:id/favorite - Toggle favorite status
   */
  register('POST', '/admin/content/:type/:id/favorite', async (req, res, params, ctx) => {
    const favoritesService = ctx.services.get('favorites');
    const user = ctx.session?.user;
    const { type, id } = params;

    if (!user) {
      const isAjax = req.headers['x-requested-with'] === 'XMLHttpRequest';
      if (isAjax) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not authenticated' }));
      } else {
        redirect(res, '/admin/users/login');
      }
      return;
    }

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const label = formData.label || null;

      const result = favoritesService.toggleFavorite(user.id, type, id, label);

      const isAjax = req.headers['x-requested-with'] === 'XMLHttpRequest' ||
                     req.headers['accept']?.includes('application/json');

      if (isAjax) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          added: result.added,
          isFavorite: result.added,
        }));
      } else {
        const returnUrl = formData._return || `/admin/content/${type}`;
        const msg = result.added ? 'Added to favorites' : 'Removed from favorites';
        redirect(res, returnUrl + '?success=' + encodeURIComponent(msg));
      }
    } catch (error) {
      const isAjax = req.headers['x-requested-with'] === 'XMLHttpRequest';
      if (isAjax) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      } else {
        redirect(res, `/admin/content/${type}?error=` + encodeURIComponent(error.message));
      }
    }
  }, 'Toggle favorite');

  /**
   * POST /admin/favorites/:type/:id/label - Update favorite label
   */
  register('POST', '/admin/favorites/:type/:id/label', async (req, res, params, ctx) => {
    const favoritesService = ctx.services.get('favorites');
    const user = ctx.session?.user;
    const { type, id } = params;

    if (!user) {
      redirect(res, '/admin/users/login');
      return;
    }

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const label = formData.label?.trim() || null;

      const updated = favoritesService.updateLabel(user.id, type, id, label);

      if (updated) {
        redirect(res, '/admin/favorites?success=' + encodeURIComponent('Label updated'));
      } else {
        redirect(res, '/admin/favorites?error=' + encodeURIComponent('Favorite not found'));
      }
    } catch (error) {
      redirect(res, '/admin/favorites?error=' + encodeURIComponent(error.message));
    }
  }, 'Update favorite label');

  /**
   * GET /api/favorites - JSON list of user's favorites
   */
  register('GET', '/api/favorites', async (req, res, params, ctx) => {
    const favoritesService = ctx.services.get('favorites');
    const user = ctx.session?.user;

    if (!user) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not authenticated' }));
      return;
    }

    const url = new URL(req.url, 'http://localhost');
    const contentType = url.searchParams.get('type') || null;
    const limit = parseInt(url.searchParams.get('limit')) || null;
    const includeContent = url.searchParams.get('includeContent') === 'true';

    const favorites = favoritesService.getFavorites(user.id, {
      contentType,
      limit,
      includeContent,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ favorites, count: favorites.length }));
  }, 'API: List user favorites');

  /**
   * GET /api/favorites/popular - Most favorited content
   */
  register('GET', '/api/favorites/popular', async (req, res, params, ctx) => {
    const favoritesService = ctx.services.get('favorites');

    const url = new URL(req.url, 'http://localhost');
    const limit = parseInt(url.searchParams.get('limit')) || 10;
    const contentType = url.searchParams.get('type') || null;

    const popular = favoritesService.getPopularFavorites(limit, contentType);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ popular }));
  }, 'API: Popular favorites');

  // ==========================================
  // Content Comparison & Merge
  // ==========================================

  /**
   * GET /admin/compare - Comparison tool landing page
   */
  register('GET', '/admin/compare', async (req, res, params, ctx) => {
    const types = content.listTypes().map(t => t.type);
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('compare.html', {
      pageTitle: 'Compare Content',
      isLanding: true,
      types,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Compare tool landing page');

  /**
   * GET /admin/content/:type/:id/compare - Compare content with another item or revision
   */
  register('GET', '/admin/content/:type/:id/compare', async (req, res, params, ctx) => {
    const { type, id } = params;
    const compareService = ctx.services.get('compare');

    const url = new URL(req.url, 'http://localhost');
    const withId = url.searchParams.get('with');
    const revisionTs = url.searchParams.get('revision');

    const itemA = content.read(type, id);
    if (!itemA) {
      redirect(res, `/admin/content/${type}?error=` + encodeURIComponent('Content not found'));
      return;
    }

    let itemB, comparison, labelA, labelB;

    if (revisionTs) {
      // Compare with revision
      itemB = content.getRevision(type, id, revisionTs);
      if (!itemB) {
        redirect(res, `/admin/content/${type}/${id}/edit?error=` + encodeURIComponent('Revision not found'));
        return;
      }
      comparison = compareService.compare(itemB, itemA);
      labelA = `Revision (${formatDate(revisionTs)})`;
      labelB = 'Current Version';
    } else if (withId) {
      // Compare with another item
      itemB = content.read(type, withId);
      if (!itemB) {
        redirect(res, `/admin/content/${type}/${id}/edit?error=` + encodeURIComponent('Comparison target not found'));
        return;
      }
      comparison = compareService.compare(itemA, itemB);
      labelA = `${type}/${id}`;
      labelB = `${type}/${withId}`;
    } else {
      // Show comparison picker
      const items = content.list(type, { limit: 100 }).items
        .filter(i => i.id !== id)
        .map(i => ({
          id: i.id,
          title: getContentTitle(i),
        }));

      const revisions = content.getRevisions(type, id).map(r => ({
        timestamp: r.timestamp,
        label: formatDate(r.timestamp),
      }));

      const html = renderAdmin('compare.html', {
        pageTitle: `Compare: ${type}/${id}`,
        isPicker: true,
        type,
        id,
        items,
        hasItems: items.length > 0,
        revisions,
        hasRevisions: revisions.length > 0,
      }, ctx, req);

      server.html(res, html);
      return;
    }

    // Build field comparison data for template
    const fields = Object.entries(comparison.fields).map(([name, data]) => ({
      name,
      status: data.status,
      valueA: data.status === 'removed' || data.status === 'modified' ? formatValue(data.a) : null,
      valueB: data.status === 'added' || data.status === 'modified' ? formatValue(data.b) : null,
      value: data.status === 'unchanged' ? formatValue(data.value) : null,
      isUnchanged: data.status === 'unchanged',
      isModified: data.status === 'modified',
      isAdded: data.status === 'added',
      isRemoved: data.status === 'removed',
      diff: data.diff ? data.diff.changes : null,
      hasDiff: data.diff && data.diff.changes && data.diff.changes.length > 0,
    }));

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('compare.html', {
      pageTitle: 'Compare Content',
      isComparison: true,
      type,
      id,
      withId,
      revisionTs,
      labelA,
      labelB,
      fields,
      summary: comparison.summary,
      isEqual: comparison.equal,
      canMerge: withId && !comparison.equal,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Compare content items');

  /**
   * POST /admin/content/:type/:id/merge - Apply merge
   */
  register('POST', '/admin/content/:type/:id/merge', async (req, res, params, ctx) => {
    const { type, id } = params;
    const compareService = ctx.services.get('compare');

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const sourceId = formData.sourceId;
      const strategy = formData.strategy || 'theirs';

      if (!sourceId) {
        throw new Error('Source ID is required');
      }

      const result = await compareService.mergeFrom(type, id, sourceId, { strategy });

      if (result.hasConflicts && strategy === 'manual') {
        // Redirect to merge UI with conflicts
        redirect(res, `/admin/content/${type}/${id}/merge?from=${sourceId}`);
        return;
      }

      // Apply the merge
      await compareService.applyMerge(type, id, result, {});

      redirect(res, `/admin/content/${type}/${id}/edit?success=` +
        encodeURIComponent(`Merged ${result.applied.length} changes from ${type}/${sourceId}`));
    } catch (error) {
      redirect(res, `/admin/content/${type}/${id}/compare?with=${ctx._parsedBody?.sourceId || ''}&error=` +
        encodeURIComponent(error.message));
    }
  }, 'Merge content');

  /**
   * GET /admin/content/:type/:id/merge - Merge conflict resolution UI
   */
  register('GET', '/admin/content/:type/:id/merge', async (req, res, params, ctx) => {
    const { type, id } = params;
    const compareService = ctx.services.get('compare');

    const url = new URL(req.url, 'http://localhost');
    const sourceId = url.searchParams.get('from');

    if (!sourceId) {
      redirect(res, `/admin/content/${type}/${id}/compare`);
      return;
    }

    const target = content.read(type, id);
    const source = content.read(type, sourceId);

    if (!target || !source) {
      redirect(res, `/admin/content/${type}?error=` + encodeURIComponent('Content not found'));
      return;
    }

    const result = await compareService.mergeFrom(type, id, sourceId, { strategy: 'manual' });

    const conflicts = result.conflicts.map(c => ({
      field: c.field,
      ours: formatValue(c.ours),
      theirs: formatValue(c.theirs),
      base: formatValue(c.base),
    }));

    const autoMerged = result.applied.map(a => ({
      field: a.field,
      source: a.source,
      value: formatValue(a.value),
    }));

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('merge.html', {
      pageTitle: 'Resolve Merge Conflicts',
      type,
      id,
      sourceId,
      conflicts,
      hasConflicts: conflicts.length > 0,
      autoMerged,
      hasAutoMerged: autoMerged.length > 0,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Merge conflict resolution');

  /**
   * POST /admin/content/:type/:id/merge/resolve - Apply resolved merge
   */
  register('POST', '/admin/content/:type/:id/merge/resolve', async (req, res, params, ctx) => {
    const { type, id } = params;
    const compareService = ctx.services.get('compare');

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const sourceId = formData.sourceId;

      // Get merge result
      const result = await compareService.mergeFrom(type, id, sourceId, { strategy: 'manual' });

      // Build resolutions from form data
      const resolutions = {};
      for (const conflict of result.conflicts) {
        const resolution = formData[`resolve_${conflict.field}`];
        if (resolution) {
          resolutions[conflict.field] = resolution;
        }
      }

      // Apply the merge with resolutions
      await compareService.applyMerge(type, id, result, resolutions);

      redirect(res, `/admin/content/${type}/${id}/edit?success=` +
        encodeURIComponent('Merge completed successfully'));
    } catch (error) {
      redirect(res, `/admin/content/${type}/${id}/merge?from=${ctx._parsedBody?.sourceId || ''}&error=` +
        encodeURIComponent(error.message));
    }
  }, 'Apply resolved merge');

  // =====================================================
  // ACTIVITY FEED ROUTES
  // =====================================================

  /**
   * GET /admin/activity - Global activity feed
   */
  register('GET', '/admin/activity', async (req, res, params, ctx) => {
    const template = ctx.services.get('template');
    const activityService = ctx.services.get('activity');
    const auth = ctx.services.get('auth');

    // Parse query params
    const urlObj = new URL(req.url, 'http://localhost');
    const page = parseInt(urlObj.searchParams.get('page') || '1', 10);
    const limit = 25;
    const offset = (page - 1) * limit;
    const actionFilter = urlObj.searchParams.get('action') || null;
    const userFilter = urlObj.searchParams.get('user') || null;

    const flash = getFlashMessage(req.url);

    // Get activity feed
    const result = activityService.getFeed({
      limit,
      offset,
      action: actionFilter,
      actorId: userFilter,
      aggregate: true,
    });

    // Get stats for summary
    const stats = activityService.getStats({ days: 7 });

    // Prepare template data
    const activities = result.activities.map(act => ({
      ...act,
      iconClass: getActivityIcon(act.action),
      targetUrl: act.target ? `/admin/content/${act.target.type}/${act.target.id}/edit` : null,
      countDisplay: act.count > 1 ? `(${act.count} times)` : '',
    }));

    const totalPages = Math.ceil(result.total / limit);

    const templateContent = loadTemplate('activity-feed.html');
    const html = template.renderWithLayout(templateContent, {
      pageTitle: 'Activity Feed',
      hasFlash: !!flash,
      flash,
      activities,
      hasActivities: activities.length > 0,
      total: result.total,
      page,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      nextPage: page + 1,
      prevPage: page - 1,
      actionFilter,
      userFilter,
      stats: {
        totalWeek: stats.total,
        topActions: Object.entries(stats.byAction).slice(0, 3).map(([action, count]) => ({
          action: action.split('.').pop(),
          count,
        })),
        topUsers: Object.entries(stats.byActor).slice(0, 3).map(([user, count]) => ({
          user,
          count,
        })),
      },
      csrfField: auth.getCsrfField(req),
    });

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }, 'Activity feed page');

  /**
   * GET /admin/activity/user/:userId - User activity page
   */
  register('GET', '/admin/activity/user/:userId', async (req, res, params, ctx) => {
    const template = ctx.services.get('template');
    const activityService = ctx.services.get('activity');
    const auth = ctx.services.get('auth');

    const { userId } = params;

    // Parse query params
    const urlObj = new URL(req.url, 'http://localhost');
    const page = parseInt(urlObj.searchParams.get('page') || '1', 10);
    const limit = 25;
    const offset = (page - 1) * limit;

    const flash = getFlashMessage(req.url);

    // Get user activity
    const result = activityService.getForUser(userId, { limit, offset, aggregate: true });

    const activities = result.activities.map(act => ({
      ...act,
      iconClass: getActivityIcon(act.action),
      targetUrl: act.target ? `/admin/content/${act.target.type}/${act.target.id}/edit` : null,
      countDisplay: act.count > 1 ? `(${act.count} times)` : '',
    }));

    const totalPages = Math.ceil(result.total / limit);

    const templateContent = loadTemplate('activity-feed.html');
    const html = template.renderWithLayout(templateContent, {
      pageTitle: `Activity: ${userId}`,
      isUserView: true,
      userId,
      hasFlash: !!flash,
      flash,
      activities,
      hasActivities: activities.length > 0,
      total: result.total,
      page,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      nextPage: page + 1,
      prevPage: page - 1,
      csrfField: auth.getCsrfField(req),
    });

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }, 'User activity page');

  /**
   * GET /admin/content/:type/:id/activity - Content activity timeline
   */
  register('GET', '/admin/content/:type/:id/activity', async (req, res, params, ctx) => {
    const template = ctx.services.get('template');
    const activityService = ctx.services.get('activity');
    const content = ctx.services.get('content');
    const auth = ctx.services.get('auth');

    const { type, id } = params;

    const flash = getFlashMessage(req.url);

    // Get the content item
    const item = content.read(type, id);
    if (!item) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('Content not found');
      return;
    }

    const title = getContentTitle(item);

    // Get content timeline
    const result = activityService.getForContent(type, id, { limit: 100 });

    const activities = result.activities.map(act => ({
      ...act,
      iconClass: getActivityIcon(act.action),
      dateFormatted: act.timestamp.slice(0, 16).replace('T', ' '),
      fieldsDisplay: act.data?.fields?.length > 0 ? `(${act.data.fields.join(', ')})` : '',
    }));

    const templateContent = loadTemplate('activity-timeline.html');
    const html = template.renderWithLayout(templateContent, {
      pageTitle: `Timeline: ${title}`,
      type,
      id,
      title,
      hasFlash: !!flash,
      flash,
      activities,
      hasActivities: activities.length > 0,
      total: result.total,
      csrfField: auth.getCsrfField(req),
    });

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }, 'Content timeline page');

  /**
   * GET /api/activity/feed - JSON activity feed for widgets
   */
  register('GET', '/api/activity/feed', async (req, res, params, ctx) => {
    const activityService = ctx.services.get('activity');

    const urlObj = new URL(req.url, 'http://localhost');
    const limit = parseInt(urlObj.searchParams.get('limit') || '10', 10);

    const result = activityService.getFeed({ limit, aggregate: true });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  }, 'Activity feed JSON API');

  /**
   * Helper: Get icon class for activity type
   */
  function getActivityIcon(action) {
    const icons = {
      'content.create': 'icon-plus',
      'content.update': 'icon-edit',
      'content.delete': 'icon-trash',
      'content.publish': 'icon-check',
      'content.unpublish': 'icon-x',
      'content.clone': 'icon-copy',
      'content.comment': 'icon-comment',
      'user.login': 'icon-login',
      'media.upload': 'icon-upload',
      'workflow.approve': 'icon-check',
      'workflow.reject': 'icon-x',
      'system.backup': 'icon-archive',
    };
    return icons[action] || 'icon-activity';
  }

  // =====================================================
  // ARCHETYPE ROUTES (Content Type Builder)
  // =====================================================

  /**
   * GET /admin/archetypes - List all content types
   */
  register('GET', '/admin/archetypes', async (req, res, params, ctx) => {
    const template = ctx.services.get('template');
    const archetypesService = ctx.services.get('archetypes');
    const auth = ctx.services.get('auth');

    const flash = getFlashMessage(req.url);
    const types = archetypesService.listArchetypes();

    // Group by source
    const customTypes = types.filter(t => t.source === 'archetype');
    const moduleTypes = types.filter(t => t.source === 'module' || (!t.isSystem && t.source !== 'archetype'));
    const systemTypes = types.filter(t => t.isSystem);

    const templateContent = loadTemplate('archetypes-list.html');
    const html = template.renderWithLayout(templateContent, {
      pageTitle: 'Content Types',
      hasFlash: !!flash,
      flash,
      customTypes,
      hasCustomTypes: customTypes.length > 0,
      moduleTypes,
      hasModuleTypes: moduleTypes.length > 0,
      systemTypes,
      hasSystemTypes: systemTypes.length > 0,
      totalTypes: types.length,
      csrfField: auth.getCsrfField(req),
    });

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }, 'List content types');

  /**
   * GET /admin/archetypes/new - Create new content type form
   */
  register('GET', '/admin/archetypes/new', async (req, res, params, ctx) => {
    const template = ctx.services.get('template');
    const archetypesService = ctx.services.get('archetypes');
    const auth = ctx.services.get('auth');

    const flash = getFlashMessage(req.url);
    const fieldTypes = archetypesService.getFieldTypes();
    const referenceTargets = archetypesService.getReferenceTargets();

    const templateContent = loadTemplate('archetype-form.html');
    const html = template.renderWithLayout(templateContent, {
      pageTitle: 'New Content Type',
      isNew: true,
      hasFlash: !!flash,
      flash,
      fieldTypes,
      referenceTargets,
      csrfField: auth.getCsrfField(req),
    });

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }, 'New content type form');

  /**
   * POST /admin/archetypes - Create new content type
   */
  register('POST', '/admin/archetypes', async (req, res, params, ctx) => {
    const archetypesService = ctx.services.get('archetypes');

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);

      const name = formData.name?.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const label = formData.label || name;
      const description = formData.description || '';
      const icon = formData.icon || '📁';

      // Parse fields from form
      const fields = {};
      const fieldNames = formData.field_name;
      const fieldTypes = formData.field_type;
      const fieldLabels = formData.field_label;
      const fieldRequired = formData.field_required;

      if (fieldNames) {
        const names = Array.isArray(fieldNames) ? fieldNames : [fieldNames];
        const types = Array.isArray(fieldTypes) ? fieldTypes : [fieldTypes];
        const labels = Array.isArray(fieldLabels) ? fieldLabels : [fieldLabels];

        for (let i = 0; i < names.length; i++) {
          if (names[i]) {
            fields[names[i]] = {
              type: types[i] || 'string',
              label: labels[i] || names[i],
              required: fieldRequired?.includes(names[i]) || false,
            };
          }
        }
      }

      // Parse settings
      const workflow = { enabled: formData.workflow_enabled === 'on' };
      const revisions = {
        enabled: formData.revisions_enabled !== 'off',
        max: parseInt(formData.revisions_max || '10', 10),
      };
      const search = {
        enabled: formData.search_enabled !== 'off',
        fields: Object.keys(fields).slice(0, 3),
      };

      const result = archetypesService.createArchetype(name, {
        label,
        description,
        icon,
        fields,
        workflow,
        revisions,
        search,
      });

      if (result.success) {
        redirect(res, '/admin/archetypes?success=' + encodeURIComponent(`Created content type: ${name}`));
      } else {
        redirect(res, '/admin/archetypes/new?error=' + encodeURIComponent(result.error));
      }
    } catch (error) {
      redirect(res, '/admin/archetypes/new?error=' + encodeURIComponent(error.message));
    }
  }, 'Create content type');

  /**
   * GET /admin/archetypes/:name - Edit content type form
   */
  register('GET', '/admin/archetypes/:name', async (req, res, params, ctx) => {
    const template = ctx.services.get('template');
    const archetypesService = ctx.services.get('archetypes');
    const content = ctx.services.get('content');
    const auth = ctx.services.get('auth');

    const { name } = params;
    const flash = getFlashMessage(req.url);

    let archetype = archetypesService.getArchetype(name);

    // Try from content types if not custom archetype
    if (!archetype) {
      const types = content.listTypes();
      const found = types.find(t => t.type === name);
      if (found) {
        archetype = {
          name,
          label: name.charAt(0).toUpperCase() + name.slice(1),
          fields: found.schema,
          source: found.source,
          isSystem: archetypesService.isSystemType(name),
          isReadOnly: true,
        };
      }
    }

    if (!archetype) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('Content type not found');
      return;
    }

    const fieldTypes = archetypesService.getFieldTypes();
    const referenceTargets = archetypesService.getReferenceTargets();

    // Convert fields to array for template
    const fieldsArray = Object.entries(archetype.fields || {}).map(([fieldName, fieldDef]) => ({
      name: fieldName,
      ...fieldDef,
    }));

    const templateContent = loadTemplate('archetype-form.html');
    const html = template.renderWithLayout(templateContent, {
      pageTitle: `Edit: ${archetype.label || name}`,
      isNew: false,
      isReadOnly: archetype.isReadOnly || archetype.isSystem,
      archetype,
      name,
      label: archetype.label,
      description: archetype.description,
      icon: archetype.icon,
      fields: fieldsArray,
      hasFields: fieldsArray.length > 0,
      workflow: archetype.workflow,
      revisions: archetype.revisions,
      search: archetype.search,
      hasFlash: !!flash,
      flash,
      fieldTypes,
      referenceTargets,
      itemCount: content.list(name).total,
      csrfField: auth.getCsrfField(req),
    });

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }, 'Edit content type form');

  /**
   * POST /admin/archetypes/:name - Update content type
   */
  register('POST', '/admin/archetypes/:name', async (req, res, params, ctx) => {
    const archetypesService = ctx.services.get('archetypes');
    const { name } = params;

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);

      const label = formData.label || name;
      const description = formData.description || '';
      const icon = formData.icon || '📁';

      // Parse fields from form
      const fields = {};
      const fieldNames = formData.field_name;
      const fieldTypes = formData.field_type;
      const fieldLabels = formData.field_label;
      const fieldRequired = formData.field_required;

      if (fieldNames) {
        const names = Array.isArray(fieldNames) ? fieldNames : [fieldNames];
        const types = Array.isArray(fieldTypes) ? fieldTypes : [fieldTypes];
        const labels = Array.isArray(fieldLabels) ? fieldLabels : [fieldLabels];

        for (let i = 0; i < names.length; i++) {
          if (names[i]) {
            fields[names[i]] = {
              type: types[i] || 'string',
              label: labels[i] || names[i],
              required: fieldRequired?.includes(names[i]) || false,
            };
          }
        }
      }

      // Parse settings
      const workflow = { enabled: formData.workflow_enabled === 'on' };
      const revisions = {
        enabled: formData.revisions_enabled !== 'off',
        max: parseInt(formData.revisions_max || '10', 10),
      };

      const result = archetypesService.updateArchetype(name, {
        label,
        description,
        icon,
        fields,
        workflow,
        revisions,
      });

      if (result.success) {
        redirect(res, `/admin/archetypes/${name}?success=` + encodeURIComponent('Content type updated'));
      } else {
        redirect(res, `/admin/archetypes/${name}?error=` + encodeURIComponent(result.error));
      }
    } catch (error) {
      redirect(res, `/admin/archetypes/${name}?error=` + encodeURIComponent(error.message));
    }
  }, 'Update content type');

  /**
   * POST /admin/archetypes/:name/delete - Delete content type
   */
  register('POST', '/admin/archetypes/:name/delete', async (req, res, params, ctx) => {
    const archetypesService = ctx.services.get('archetypes');
    const { name } = params;

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const force = formData.force === 'on';

      const result = archetypesService.deleteArchetype(name, { force });

      if (result.success) {
        redirect(res, '/admin/archetypes?success=' + encodeURIComponent(`Deleted content type: ${name}`));
      } else {
        redirect(res, `/admin/archetypes/${name}?error=` + encodeURIComponent(result.error));
      }
    } catch (error) {
      redirect(res, `/admin/archetypes/${name}?error=` + encodeURIComponent(error.message));
    }
  }, 'Delete content type');

  /**
   * GET /admin/archetypes/:name/export - Export content type as JSON
   */
  register('GET', '/admin/archetypes/:name/export', async (req, res, params, ctx) => {
    const archetypesService = ctx.services.get('archetypes');
    const { name } = params;

    const result = archetypesService.exportArchetype(name);

    if (!result.success) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: result.error }));
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${name}-archetype.json"`,
    });
    res.end(JSON.stringify(result.data, null, 2));
  }, 'Export content type JSON');

  /**
   * POST /admin/archetypes/import - Import content type from JSON
   */
  register('POST', '/admin/archetypes/import', async (req, res, params, ctx) => {
    const archetypesService = ctx.services.get('archetypes');

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const jsonData = formData.json_data;
      const overwrite = formData.overwrite === 'on';

      if (!jsonData) {
        redirect(res, '/admin/archetypes?error=' + encodeURIComponent('No JSON data provided'));
        return;
      }

      let data;
      try {
        data = JSON.parse(jsonData);
      } catch (e) {
        redirect(res, '/admin/archetypes?error=' + encodeURIComponent('Invalid JSON: ' + e.message));
        return;
      }

      const result = archetypesService.importArchetype(data, { overwrite });

      if (result.success) {
        redirect(res, '/admin/archetypes?success=' + encodeURIComponent(`Imported content type: ${result.archetype.name}`));
      } else {
        redirect(res, '/admin/archetypes?error=' + encodeURIComponent(result.error));
      }
    } catch (error) {
      redirect(res, '/admin/archetypes?error=' + encodeURIComponent(error.message));
    }
  }, 'Import content type');

  // =====================================================
  // API VERSIONING ADMIN ROUTES
  // =====================================================

  /**
   * GET /admin/api - API documentation page
   */
  register('GET', '/admin/api', async (req, res, params, ctx) => {
    const apiVersionService = ctx.services.get('apiVersion');
    const templateService = ctx.services.get('template');

    const docs = apiVersionService.getApiDocs();
    const stats = apiVersionService.getUsageStats({ days: 7 });

    const data = {
      pageTitle: 'API Documentation',
      ...docs,
      stats,
      hasVersions: docs.versions.length > 0,
      totalRequests: stats.total,
      ...ctx._viewData,
    };

    const html = templateService.render('api-docs', data);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }, 'API documentation page');

  /**
   * GET /admin/api/versions - API versions status page
   */
  register('GET', '/admin/api/versions', async (req, res, params, ctx) => {
    const apiVersionService = ctx.services.get('apiVersion');
    const templateService = ctx.services.get('template');

    const versions = apiVersionService.listVersions();
    const stats = apiVersionService.getUsageStats({ days: 30 });
    const changelog = apiVersionService.getChangelog();
    const deprecations = apiVersionService.getDeprecations();
    const config = apiVersionService.getConfig();

    // Add usage stats to each version
    const versionsWithStats = versions.map(v => ({
      ...v,
      requests7d: stats.versions[v.version]?.total || 0,
      topEndpoints: Object.entries(stats.versions[v.version]?.endpoints || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([endpoint, count]) => ({ endpoint, count })),
    }));

    const data = {
      pageTitle: 'API Versions',
      versions: versionsWithStats,
      hasVersions: versions.length > 0,
      changelog,
      hasChangelog: changelog.length > 0,
      deprecations,
      hasDeprecations: deprecations.length > 0,
      defaultVersion: config.defaultVersion,
      totalRequests: stats.total,
      period: stats.period,
      ...ctx._viewData,
    };

    const html = templateService.render('api-versions', data);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }, 'API versions status page');

  /**
   * GET /api/versions - JSON list of API versions
   */
  register('GET', '/api/versions', async (req, res, params, ctx) => {
    const apiVersionService = ctx.services.get('apiVersion');

    const versions = apiVersionService.listVersions();
    const config = apiVersionService.getConfig();

    const data = {
      versions: versions.map(v => ({
        version: v.version,
        status: v.status,
        releasedAt: v.releasedAt,
        deprecatedAt: v.deprecatedAt,
        sunsetAt: v.sunsetAt,
      })),
      default: config.defaultVersion,
      current: apiVersionService.getLatestStableVersion(),
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
  }, 'JSON list of API versions');

  /**
   * API versioned content routes
   * These routes handle /api/v{n}/content/... requests with version-specific transforms
   */

  /**
   * GET /api/:version/content/:type - List content with version transform
   */
  register('GET', '/api/:version/content/:type', async (req, res, params, ctx) => {
    const apiVersionService = ctx.services.get('apiVersion');
    const contentService = ctx.services.get('content');
    const { version, type } = params;

    // Parse query params
    const url = new URL(req.url, `http://${req.headers.host}`);
    const page = parseInt(url.searchParams.get('page')) || 1;
    const limit = parseInt(url.searchParams.get('limit')) || 20;
    const sort = url.searchParams.get('sort') || 'created';
    const order = url.searchParams.get('order') || 'desc';

    // Get content
    const result = contentService.list(type, { page, limit, sort, order });

    // Add deprecation headers if needed
    if (apiVersionService.isDeprecated(version)) {
      const info = apiVersionService.getDeprecationInfo(version);
      res.setHeader('Deprecation', 'true');
      if (info?.sunsetAt) {
        res.setHeader('Sunset', new Date(info.sunsetAt).toUTCString());
      }
    }

    // Transform response for version
    const transformed = apiVersionService.transformResponse({
      items: result.items,
      total: result.total,
      page,
      limit,
      pages: Math.ceil(result.total / limit),
    }, version, 'list');

    res.setHeader('X-API-Version', version);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(transformed, null, 2));
  }, 'List content (versioned)');

  /**
   * GET /api/:version/content/:type/:id - Get single item with version transform
   */
  register('GET', '/api/:version/content/:type/:id', async (req, res, params, ctx) => {
    const apiVersionService = ctx.services.get('apiVersion');
    const contentService = ctx.services.get('content');
    const { version, type, id } = params;

    const item = contentService.read(type, id);

    if (!item) {
      const error = apiVersionService.transformResponse({
        message: 'Not found',
        code: 'NOT_FOUND',
        statusCode: 404,
      }, version, 'error');

      res.setHeader('X-API-Version', version);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(error, null, 2));
      return;
    }

    // Add deprecation headers if needed
    if (apiVersionService.isDeprecated(version)) {
      const info = apiVersionService.getDeprecationInfo(version);
      res.setHeader('Deprecation', 'true');
      if (info?.sunsetAt) {
        res.setHeader('Sunset', new Date(info.sunsetAt).toUTCString());
      }
    }

    // Transform response for version
    const transformed = apiVersionService.transformResponse({
      data: item,
      version: item._version,
      updatedAt: item.updated,
      createdAt: item.created,
    }, version, 'item');

    res.setHeader('X-API-Version', version);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(transformed, null, 2));
  }, 'Get content item (versioned)');

  // =====================================================
  // GRAPHQL ROUTES
  // =====================================================

  /**
   * GET /graphql — GraphQL Playground
   */
  register('GET', '/graphql', async (req, res, params, ctx) => {
    const graphqlService = ctx.services.get('graphql');

    if (!graphqlService.isPlaygroundEnabled()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('GraphQL Playground is disabled');
      return;
    }

    const html = graphqlService.generatePlaygroundHTML('/graphql');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }, 'GraphQL Playground');

  /**
   * POST /graphql — GraphQL endpoint
   */
  register('POST', '/graphql', async (req, res, params, ctx) => {
    const graphqlService = ctx.services.get('graphql');
    const contentService = ctx.services.get('content');

    if (!graphqlService.isEnabled()) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ errors: [{ message: 'GraphQL is disabled' }] }));
      return;
    }

    // Parse request body
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    let query, variables, operationName;
    try {
      const parsed = JSON.parse(body);
      query = parsed.query;
      variables = parsed.variables || {};
      operationName = parsed.operationName;
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ errors: [{ message: 'Invalid JSON body' }] }));
      return;
    }

    if (!query) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ errors: [{ message: 'Query is required' }] }));
      return;
    }

    // Build context
    const context = {
      user: ctx.user || null,
      session: ctx.session || null,
    };

    // Execute query
    const result = graphqlService.executeQuery(query, variables, context);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result, null, 2));
  }, 'GraphQL endpoint');

  /**
   * GET /admin/graphql — Admin GraphQL Explorer
   */
  register('GET', '/admin/graphql', async (req, res, params, ctx) => {
    const graphqlService = ctx.services.get('graphql');
    const templateService = ctx.services.get('template');

    const types = graphqlService.listTypes();
    const schema = graphqlService.generateSchemaString();
    const config = graphqlService.getConfig();

    const data = {
      pageTitle: 'GraphQL Explorer',
      types,
      hasTypes: types.length > 0,
      schema,
      config,
      playgroundEnabled: config.playground,
      ...ctx._viewData,
    };

    const html = templateService.render('graphql-explorer', data);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }, 'Admin GraphQL Explorer');

  // =====================================================
  // FEEDS ROUTES
  // =====================================================

  /**
   * GET /feed/:type.rss — RSS feed
   */
  register('GET', '/feed/:type.rss', async (req, res, params, ctx) => {
    const feedsService = ctx.services.get('feeds');
    const { type } = params;

    const feedConfig = feedsService.getFeedConfig(type);
    if (!feedConfig.enabled) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Feed not enabled for type: ${type}`);
      return;
    }

    const feed = feedsService.generateRSS(type);
    res.writeHead(200, { 'Content-Type': feedsService.getContentType('rss') });
    res.end(feed);
  }, 'RSS feed');

  /**
   * GET /feed/:type.atom — Atom feed
   */
  register('GET', '/feed/:type.atom', async (req, res, params, ctx) => {
    const feedsService = ctx.services.get('feeds');
    const { type } = params;

    const feedConfig = feedsService.getFeedConfig(type);
    if (!feedConfig.enabled) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Feed not enabled for type: ${type}`);
      return;
    }

    const feed = feedsService.generateAtom(type);
    res.writeHead(200, { 'Content-Type': feedsService.getContentType('atom') });
    res.end(feed);
  }, 'Atom feed');

  /**
   * GET /feed/:type.json — JSON feed
   */
  register('GET', '/feed/:type.json', async (req, res, params, ctx) => {
    const feedsService = ctx.services.get('feeds');
    const { type } = params;

    const feedConfig = feedsService.getFeedConfig(type);
    if (!feedConfig.enabled) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Feed not enabled for type: ${type}` }));
      return;
    }

    const feed = feedsService.generateJSON(type);
    res.writeHead(200, { 'Content-Type': feedsService.getContentType('json') });
    res.end(feed);
  }, 'JSON feed');

  /**
   * GET /feed/:type — Default feed (RSS)
   */
  register('GET', '/feed/:type', async (req, res, params, ctx) => {
    const feedsService = ctx.services.get('feeds');
    const { type } = params;

    const feedConfig = feedsService.getFeedConfig(type);
    if (!feedConfig.enabled) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Feed not enabled for type: ${type}`);
      return;
    }

    const feed = feedsService.generateRSS(type);
    res.writeHead(200, { 'Content-Type': feedsService.getContentType('rss') });
    res.end(feed);
  }, 'Default feed (RSS)');

  /**
   * GET /admin/feeds — Feed management
   */
  register('GET', '/admin/feeds', async (req, res, params, ctx) => {
    const feedsService = ctx.services.get('feeds');
    const templateService = ctx.services.get('template');

    const feeds = feedsService.listFeeds();
    const config = feedsService.getConfig();

    const data = {
      pageTitle: 'Feed Management',
      feeds,
      hasFeeds: feeds.length > 0,
      enabledCount: feeds.filter(f => f.enabled).length,
      config,
      baseUrl: config.baseUrl,
      ...ctx._viewData,
    };

    const html = templateService.render('feeds', data);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }, 'Feed management');

  /**
   * POST /admin/feeds/:type — Update feed configuration
   */
  register('POST', '/admin/feeds/:type', async (req, res, params, ctx) => {
    const feedsService = ctx.services.get('feeds');
    const { type } = params;

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);

      const updates = {
        enabled: formData.enabled === 'on',
        title: formData.title || undefined,
        description: formData.description || undefined,
        limit: formData.limit ? parseInt(formData.limit) : undefined,
        includeContent: formData.includeContent === 'on',
      };

      // Remove undefined values
      Object.keys(updates).forEach(key => {
        if (updates[key] === undefined) delete updates[key];
      });

      feedsService.setFeedConfig(type, updates);

      redirect(res, '/admin/feeds?success=' + encodeURIComponent(`Feed updated for: ${type}`));
    } catch (error) {
      redirect(res, '/admin/feeds?error=' + encodeURIComponent(error.message));
    }
  }, 'Update feed configuration');

  // ========================================
  // SITEMAP & SEO ROUTES
  // ========================================

  /**
   * GET /sitemap.xml — Main sitemap
   */
  register('GET', '/sitemap.xml', async (req, res, params, ctx) => {
    const sitemapService = ctx.services.get('sitemap')?.();
    if (!sitemapService || !sitemapService.isEnabled()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Sitemap not enabled');
      return;
    }

    const needsIndex = sitemapService.needsSitemapIndex();
    const xml = needsIndex
      ? sitemapService.generateSitemapIndex()
      : sitemapService.generateFullSitemap();

    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
    res.end(xml);
  }, 'Main sitemap');

  /**
   * GET /sitemap-:type.xml — Per-type sitemap
   */
  register('GET', '/sitemap-:type.xml', async (req, res, params, ctx) => {
    const sitemapService = ctx.services.get('sitemap')?.();
    if (!sitemapService || !sitemapService.isEnabled()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Sitemap not enabled');
      return;
    }

    const type = params.type;
    const xml = sitemapService.generateSitemap(type);

    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
    res.end(xml);
  }, 'Per-type sitemap');

  /**
   * GET /robots.txt — Robots file
   */
  register('GET', '/robots.txt', async (req, res, params, ctx) => {
    const sitemapService = ctx.services.get('sitemap')?.();
    if (!sitemapService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    const txt = sitemapService.generateRobotsTxt();

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(txt);
  }, 'Robots.txt');

  /**
   * GET /admin/seo — SEO dashboard
   */
  register('GET', '/admin/seo', async (req, res, params, ctx) => {
    const sitemapService = ctx.services.get('sitemap')?.();
    const templateService = ctx.services.get('template')?.();
    const authService = ctx.services.get('auth')?.();

    if (!sitemapService || !templateService) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Service not available');
      return;
    }

    const stats = sitemapService.getStats();
    const types = sitemapService.listTypes();
    const config = sitemapService.getConfig();
    const robotsTxt = sitemapService.generateRobotsTxt();

    // Quick audit summary
    const audit = sitemapService.auditSEO();

    const csrfToken = authService ? authService.generateCSRFToken() : '';
    const csrfField = `<input type="hidden" name="_csrf" value="${csrfToken}">`;

    const flash = parseFlash(req);

    const html = await templateService.render('seo-dashboard.html', {
      pageTitle: 'SEO & Sitemap',
      stats,
      types,
      config,
      robotsTxt,
      audit,
      csrfField,
      flash,
      hasFlash: !!flash,
      siteUrl: config.siteUrl,
    }, 'admin');

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }, 'SEO dashboard');

  /**
   * GET /admin/seo/audit — SEO audit results
   */
  register('GET', '/admin/seo/audit', async (req, res, params, ctx) => {
    const sitemapService = ctx.services.get('sitemap')?.();
    const templateService = ctx.services.get('template')?.();

    if (!sitemapService || !templateService) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Service not available');
      return;
    }

    const url = new URL(req.url, 'http://localhost');
    const type = url.searchParams.get('type') || null;
    const severity = url.searchParams.get('severity') || null;

    const audit = sitemapService.auditSEO(type);

    // Filter by severity if specified
    let issues = [...audit.errors, ...audit.warnings, ...audit.info];
    if (severity) {
      issues = issues.filter(i => i.severity === severity);
    }

    const flash = parseFlash(req);

    const html = await templateService.render('seo-audit.html', {
      pageTitle: 'SEO Audit',
      audit,
      issues,
      filterType: type,
      filterSeverity: severity,
      flash,
      hasFlash: !!flash,
    }, 'admin');

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }, 'SEO audit results');

  /**
   * POST /admin/seo/ping — Ping search engines
   */
  register('POST', '/admin/seo/ping', async (req, res, params, ctx) => {
    const sitemapService = ctx.services.get('sitemap')?.();
    if (!sitemapService) {
      redirect(res, '/admin/seo?error=' + encodeURIComponent('Service not available'));
      return;
    }

    try {
      const results = await sitemapService.pingSearchEngines();
      const messages = Object.entries(results)
        .map(([engine, r]) => `${engine}: ${r.message}`)
        .join(', ');

      redirect(res, '/admin/seo?success=' + encodeURIComponent(`Ping results: ${messages}`));
    } catch (error) {
      redirect(res, '/admin/seo?error=' + encodeURIComponent(error.message));
    }
  }, 'Ping search engines');

  /**
   * POST /admin/seo/:type — Update sitemap config for type
   */
  register('POST', '/admin/seo/:type', async (req, res, params, ctx) => {
    const sitemapService = ctx.services.get('sitemap')?.();
    if (!sitemapService) {
      redirect(res, '/admin/seo?error=' + encodeURIComponent('Service not available'));
      return;
    }

    const type = params.type;

    try {
      const body = await parseBody(req);

      const updates = {
        enabled: body.enabled === 'on' || body.enabled === true,
        priority: parseFloat(body.priority) || 0.5,
        changefreq: body.changefreq || 'weekly',
        urlTemplate: body.urlTemplate || undefined,
      };

      // Remove undefined values
      Object.keys(updates).forEach(key => {
        if (updates[key] === undefined) delete updates[key];
      });

      sitemapService.setSitemapConfig(type, updates);

      redirect(res, '/admin/seo?success=' + encodeURIComponent(`Config updated for: ${type}`));
    } catch (error) {
      redirect(res, '/admin/seo?error=' + encodeURIComponent(error.message));
    }
  }, 'Update sitemap config');

  // ==========================================
  // Taxonomy Management
  // ==========================================

  /**
   * GET /admin/taxonomy - Vocabulary list page
   */
  register('GET', '/admin/taxonomy', async (req, res, params, ctx) => {
    const taxonomyService = ctx.services.get('taxonomy');
    if (!taxonomyService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Taxonomy service not available');
      return;
    }

    const vocabularies = taxonomyService.listVocabularies();
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('taxonomy-list.html', {
      pageTitle: 'Taxonomy',
      vocabularies,
      hasVocabularies: vocabularies.length > 0,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Taxonomy vocabulary list');

  /**
   * GET /admin/taxonomy/:vocab - Terms list for vocabulary
   */
  register('GET', '/admin/taxonomy/:vocab', async (req, res, params, ctx) => {
    const { vocab } = params;
    const taxonomyService = ctx.services.get('taxonomy');
    if (!taxonomyService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Taxonomy service not available');
      return;
    }

    const vocabulary = taxonomyService.getVocabulary(vocab);
    if (!vocabulary) {
      redirect(res, '/admin/taxonomy?error=' + encodeURIComponent(`Vocabulary not found: ${vocab}`));
      return;
    }

    const terms = taxonomyService.getTerms(vocab);
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('taxonomy-terms.html', {
      pageTitle: `Taxonomy: ${vocabulary.label}`,
      vocabulary,
      vocab,
      terms,
      hasTerms: terms.length > 0,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Taxonomy terms list');

  /**
   * GET /admin/taxonomy/:vocab/add - Add term form
   */
  register('GET', '/admin/taxonomy/:vocab/add', async (req, res, params, ctx) => {
    const { vocab } = params;
    const taxonomyService = ctx.services.get('taxonomy');
    if (!taxonomyService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Taxonomy service not available');
      return;
    }

    const vocabulary = taxonomyService.getVocabulary(vocab);
    if (!vocabulary) {
      redirect(res, '/admin/taxonomy?error=' + encodeURIComponent(`Vocabulary not found: ${vocab}`));
      return;
    }

    const terms = taxonomyService.getTerms(vocab);

    const html = renderAdmin('taxonomy-add.html', {
      pageTitle: `Add Term to ${vocabulary.label}`,
      vocabulary,
      vocab,
      terms,
      hasTerms: terms.length > 0,
    }, ctx, req);

    server.html(res, html);
  }, 'Add taxonomy term form');

  /**
   * POST /admin/taxonomy/:vocab/add - Create term
   */
  register('POST', '/admin/taxonomy/:vocab/add', async (req, res, params, ctx) => {
    const { vocab } = params;
    const taxonomyService = ctx.services.get('taxonomy');
    if (!taxonomyService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Taxonomy service not available');
      return;
    }

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);

      const termData = {
        name: formData.name?.trim(),
        description: formData.description?.trim() || '',
        weight: parseInt(formData.weight) || 0,
        parent: formData.parent || null,
      };

      if (!termData.name) {
        redirect(res, `/admin/taxonomy/${vocab}/add?error=` + encodeURIComponent('Term name required'));
        return;
      }

      const term = taxonomyService.createTerm(vocab, termData);
      redirect(res, `/admin/taxonomy/${vocab}?success=` + encodeURIComponent(`Term created: ${term.name}`));
    } catch (error) {
      redirect(res, `/admin/taxonomy/${vocab}/add?error=` + encodeURIComponent(error.message));
    }
  }, 'Create taxonomy term');

  /**
   * GET /admin/taxonomy/:vocab/:id - Edit term form
   */
  register('GET', '/admin/taxonomy/:vocab/:id', async (req, res, params, ctx) => {
    const { vocab, id } = params;
    const taxonomyService = ctx.services.get('taxonomy');
    if (!taxonomyService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Taxonomy service not available');
      return;
    }

    const vocabulary = taxonomyService.getVocabulary(vocab);
    if (!vocabulary) {
      redirect(res, '/admin/taxonomy?error=' + encodeURIComponent(`Vocabulary not found: ${vocab}`));
      return;
    }

    const term = taxonomyService.getTerm(vocab, id);
    if (!term) {
      redirect(res, `/admin/taxonomy/${vocab}?error=` + encodeURIComponent(`Term not found: ${id}`));
      return;
    }

    const terms = taxonomyService.getTerms(vocab).filter(t => t.id !== id);

    const html = renderAdmin('taxonomy-edit.html', {
      pageTitle: `Edit Term: ${term.name}`,
      vocabulary,
      vocab,
      term,
      terms,
      hasTerms: terms.length > 0,
    }, ctx, req);

    server.html(res, html);
  }, 'Edit taxonomy term form');

  /**
   * POST /admin/taxonomy/:vocab/:id - Update term
   */
  register('POST', '/admin/taxonomy/:vocab/:id', async (req, res, params, ctx) => {
    const { vocab, id } = params;
    const taxonomyService = ctx.services.get('taxonomy');
    if (!taxonomyService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Taxonomy service not available');
      return;
    }

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);

      const updates = {
        name: formData.name?.trim(),
        description: formData.description?.trim() || '',
        weight: parseInt(formData.weight) || 0,
        parent: formData.parent || null,
      };

      if (!updates.name) {
        redirect(res, `/admin/taxonomy/${vocab}/${id}?error=` + encodeURIComponent('Term name required'));
        return;
      }

      taxonomyService.updateTerm(vocab, id, updates);
      redirect(res, `/admin/taxonomy/${vocab}?success=` + encodeURIComponent(`Term updated: ${updates.name}`));
    } catch (error) {
      redirect(res, `/admin/taxonomy/${vocab}/${id}?error=` + encodeURIComponent(error.message));
    }
  }, 'Update taxonomy term');

  /**
   * POST /admin/taxonomy/:vocab/:id/delete - Delete term
   */
  register('POST', '/admin/taxonomy/:vocab/:id/delete', async (req, res, params, ctx) => {
    const { vocab, id } = params;
    const taxonomyService = ctx.services.get('taxonomy');
    if (!taxonomyService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Taxonomy service not available');
      return;
    }

    try {
      const term = taxonomyService.getTerm(vocab, id);
      const termName = term ? term.name : id;

      taxonomyService.deleteTerm(vocab, id);
      redirect(res, `/admin/taxonomy/${vocab}?success=` + encodeURIComponent(`Term deleted: ${termName}`));
    } catch (error) {
      redirect(res, `/admin/taxonomy/${vocab}?error=` + encodeURIComponent(error.message));
    }
  }, 'Delete taxonomy term');

  // ==========================================
  // Menu Management
  // ==========================================

  /**
   * GET /admin/menus - Menu list page
   */
  register('GET', '/admin/menus', async (req, res, params, ctx) => {
    const menuService = ctx.services.get('menu');
    if (!menuService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Menu service not available');
      return;
    }

    const rawMenus = menuService.listMenus();
    const menus = rawMenus.map(m => ({
      ...m,
      itemCount: menuService.listMenuItems({menuId: m.id}).items.length,
    }));
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('menu-list.html', {
      pageTitle: 'Menus',
      menus,
      hasMenus: menus.length > 0,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Menu list');

  /**
   * POST /admin/menus - Create menu
   */
  register('POST', '/admin/menus', async (req, res, params, ctx) => {
    const menuService = ctx.services.get('menu');
    if (!menuService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Menu service not available');
      return;
    }

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const title = formData.title?.trim();
      const id = formData.machine_name?.trim() || title?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const description = formData.description?.trim() || '';

      if (!title || !id) {
        redirect(res, '/admin/menus?error=' + encodeURIComponent('Title and machine name required'));
        return;
      }

      await menuService.createMenu({ id, title, description });
      redirect(res, '/admin/menus?success=' + encodeURIComponent(`Menu created: ${title}`));
    } catch (error) {
      redirect(res, '/admin/menus?error=' + encodeURIComponent(error.message));
    }
  }, 'Create menu');

  /**
   * POST /admin/menus/:name/update - Update menu
   */
  register('POST', '/admin/menus/:name/update', async (req, res, params, ctx) => {
    const { name } = params;
    const menuService = ctx.services.get('menu');
    if (!menuService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Menu service not available');
      return;
    }

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const updates = {};
      if (formData.title?.trim()) updates.title = formData.title.trim();
      if (formData.description !== undefined) updates.description = formData.description.trim();

      await menuService.updateMenu(name, updates);
      redirect(res, '/admin/menus?success=' + encodeURIComponent(`Menu updated: ${updates.title || name}`));
    } catch (error) {
      redirect(res, '/admin/menus?error=' + encodeURIComponent(error.message));
    }
  }, 'Update menu');

  /**
   * POST /admin/menus/:name/delete - Delete menu
   */
  register('POST', '/admin/menus/:name/delete', async (req, res, params, ctx) => {
    const { name } = params;
    const menuService = ctx.services.get('menu');
    if (!menuService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Menu service not available');
      return;
    }

    try {
      await menuService.deleteMenu(name);
      redirect(res, '/admin/menus?success=' + encodeURIComponent(`Menu deleted: ${name}`));
    } catch (error) {
      redirect(res, '/admin/menus?error=' + encodeURIComponent(error.message));
    }
  }, 'Delete menu');

  /**
   * GET /admin/menus/:name - Menu items page
   */
  register('GET', '/admin/menus/:name', async (req, res, params, ctx) => {
    const { name } = params;
    const menuService = ctx.services.get('menu');
    if (!menuService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Menu service not available');
      return;
    }

    const menu = menuService.getMenu(name);
    if (!menu) {
      redirect(res, '/admin/menus?error=' + encodeURIComponent(`Menu not found: ${name}`));
      return;
    }

    const items = menuService.listMenuItems({menuId: name}).items;
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('menu-items.html', {
      pageTitle: `Menu: ${menu.title}`,
      menu,
      menuName: name,
      items,
      hasItems: items.length > 0,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Menu items list');

  /**
   * GET /admin/menus/:name/add - Add item form
   */
  register('GET', '/admin/menus/:name/add', async (req, res, params, ctx) => {
    const { name } = params;
    const menuService = ctx.services.get('menu');
    if (!menuService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Menu service not available');
      return;
    }

    const menu = menuService.getMenu(name);
    if (!menu) {
      redirect(res, '/admin/menus?error=' + encodeURIComponent(`Menu not found: ${name}`));
      return;
    }

    const items = menuService.listMenuItems({menuId: name}).items;

    const html = renderAdmin('menu-add.html', {
      pageTitle: `Add Item to ${menu.title}`,
      menu,
      menuName: name,
      items,
      hasItems: items.length > 0,
    }, ctx, req);

    server.html(res, html);
  }, 'Add menu item form');

  /**
   * POST /admin/menus/:name/add - Create item
   */
  register('POST', '/admin/menus/:name/add', async (req, res, params, ctx) => {
    const { name } = params;
    const menuService = ctx.services.get('menu');
    if (!menuService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Menu service not available');
      return;
    }

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);

      const itemData = {
        title: formData.title?.trim(),
        url: formData.url?.trim(),
        weight: parseInt(formData.weight) || 0,
        parent: formData.parent || null,
        enabled: formData.enabled === 'on',
      };

      if (!itemData.title || !itemData.url) {
        redirect(res, `/admin/menus/${name}/add?error=` + encodeURIComponent('Title and URL required'));
        return;
      }

      const item = await menuService.createMenuItem({
        menuId: name,
        title: itemData.title,
        link: itemData.url,
        weight: itemData.weight,
        parentId: itemData.parent,
        enabled: itemData.enabled
      });
      redirect(res, `/admin/menus/${name}?success=` + encodeURIComponent(`Item created: ${item.title}`));
    } catch (error) {
      redirect(res, `/admin/menus/${name}/add?error=` + encodeURIComponent(error.message));
    }
  }, 'Create menu item');

  /**
   * GET /admin/menus/:name/:id - Edit item form
   */
  register('GET', '/admin/menus/:name/:id', async (req, res, params, ctx) => {
    const { name, id } = params;
    const menuService = ctx.services.get('menu');
    if (!menuService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Menu service not available');
      return;
    }

    const menu = menuService.getMenu(name);
    if (!menu) {
      redirect(res, '/admin/menus?error=' + encodeURIComponent(`Menu not found: ${name}`));
      return;
    }

    const item = menuService.getMenuItem(id);
    if (!item) {
      redirect(res, `/admin/menus/${name}?error=` + encodeURIComponent(`Item not found: ${id}`));
      return;
    }

    const items = menuService.listMenuItems({menuId: name}).items.filter(i => i.id !== id);

    const html = renderAdmin('menu-edit.html', {
      pageTitle: `Edit Item: ${item.title}`,
      menu,
      menuName: name,
      item,
      items,
      hasItems: items.length > 0,
    }, ctx, req);

    server.html(res, html);
  }, 'Edit menu item form');

  /**
   * POST /admin/menus/:name/:id - Update item
   */
  register('POST', '/admin/menus/:name/:id', async (req, res, params, ctx) => {
    const { name, id } = params;
    const menuService = ctx.services.get('menu');
    if (!menuService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Menu service not available');
      return;
    }

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);

      const updates = {
        title: formData.title?.trim(),
        url: formData.url?.trim(),
        weight: parseInt(formData.weight) || 0,
        parent: formData.parent || null,
        enabled: formData.enabled === 'on',
      };

      if (!updates.title || !updates.url) {
        redirect(res, `/admin/menus/${name}/${id}?error=` + encodeURIComponent('Title and URL required'));
        return;
      }

      await menuService.updateMenuItem(id, {
        title: updates.title,
        link: updates.url,
        weight: updates.weight,
        parentId: updates.parent,
        enabled: updates.enabled
      });
      redirect(res, `/admin/menus/${name}?success=` + encodeURIComponent(`Item updated: ${updates.title}`));
    } catch (error) {
      redirect(res, `/admin/menus/${name}/${id}?error=` + encodeURIComponent(error.message));
    }
  }, 'Update menu item');

  /**
   * POST /admin/menus/:name/:id/delete - Delete item
   */
  register('POST', '/admin/menus/:name/:id/delete', async (req, res, params, ctx) => {
    const { name, id } = params;
    const menuService = ctx.services.get('menu');
    if (!menuService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Menu service not available');
      return;
    }

    try {
      const item = menuService.getMenuItem(id);
      const itemTitle = item ? item.title : id;

      await menuService.deleteMenuItem(id);
      redirect(res, `/admin/menus/${name}?success=` + encodeURIComponent(`Item deleted: ${itemTitle}`));
    } catch (error) {
      redirect(res, `/admin/menus/${name}?error=` + encodeURIComponent(error.message));
    }
  }, 'Delete menu item');

  // ==========================================
  // Contact Forms Management
  // ==========================================

  /**
   * GET /admin/contact-forms - Contact forms list
   */
  register('GET', '/admin/contact-forms', async (req, res, params, ctx) => {
    const contactService = ctx.services.get('contact');
    if (!contactService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Contact service not available');
      return;
    }

    const forms = contactService.listForms();
    const stats = contactService.getSubmissionStats();
    const flash = getFlashMessage(req.url);

    const formsWithStats = forms.map(form => ({
      ...form,
      recipients: form.recipients.join(', '),
      submissionCount: stats.byForm[form.id] || 0,
    }));

    const html = renderAdmin('contact-forms.html', {
      pageTitle: 'Contact Forms',
      forms: formsWithStats,
      hasForms: formsWithStats.length > 0,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Contact forms list');

  /**
   * POST /admin/contact-forms - Create contact form
   */
  register('POST', '/admin/contact-forms', async (req, res, params, ctx) => {
    const contactService = ctx.services.get('contact');
    if (!contactService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Contact service not available');
      return;
    }

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const id = formData.id?.trim();
      const title = formData.title?.trim();
      const recipientsRaw = formData.recipients?.trim() || '';
      const recipients = recipientsRaw.split(/[\n,]+/).map(r => r.trim()).filter(Boolean);

      if (!id || !title || recipients.length === 0) {
        redirect(res, '/admin/contact-forms?error=' + encodeURIComponent('ID, title, and at least one recipient are required'));
        return;
      }

      await contactService.createForm({
        id,
        title,
        recipients,
        reply: formData.reply?.trim() || '',
        message: formData.message?.trim() || 'Your message has been sent.',
        redirect: formData.redirect?.trim() || '',
        weight: parseInt(formData.weight) || 0,
        enabled: true,
      });

      redirect(res, '/admin/contact-forms?success=' + encodeURIComponent(`Created form: ${title}`));
    } catch (error) {
      redirect(res, '/admin/contact-forms?error=' + encodeURIComponent(error.message));
    }
  }, 'Create contact form');

  /**
   * GET /admin/contact-forms/:id/edit - Edit contact form
   */
  register('GET', '/admin/contact-forms/:id/edit', async (req, res, params, ctx) => {
    const contactService = ctx.services.get('contact');
    if (!contactService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Contact service not available');
      return;
    }

    const { id } = params;
    const form = contactService.getForm(id);
    if (!form) {
      redirect(res, '/admin/contact-forms?error=' + encodeURIComponent(`Form "${id}" not found`));
      return;
    }

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('contact-form-edit.html', {
      pageTitle: `Edit: ${form.title}`,
      form: {
        ...form,
        recipientsText: form.recipients.join('\n'),
      },
      isNew: false,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Edit contact form');

  /**
   * POST /admin/contact-forms/:id/update - Update contact form
   */
  register('POST', '/admin/contact-forms/:id/update', async (req, res, params, ctx) => {
    const contactService = ctx.services.get('contact');
    if (!contactService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Contact service not available');
      return;
    }

    const { id } = params;

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const recipientsRaw = formData.recipients?.trim() || '';
      const recipients = recipientsRaw.split(/[\n,]+/).map(r => r.trim()).filter(Boolean);

      if (recipients.length === 0) {
        redirect(res, `/admin/contact-forms/${id}/edit?error=` + encodeURIComponent('At least one recipient is required'));
        return;
      }

      await contactService.updateForm(id, {
        title: formData.title?.trim(),
        recipients,
        reply: formData.reply?.trim() || '',
        message: formData.message?.trim() || 'Your message has been sent.',
        redirect: formData.redirect?.trim() || '',
        weight: parseInt(formData.weight) || 0,
        enabled: formData.enabled === 'on',
      });

      redirect(res, '/admin/contact-forms?success=' + encodeURIComponent(`Updated form: ${formData.title}`));
    } catch (error) {
      redirect(res, `/admin/contact-forms/${id}/edit?error=` + encodeURIComponent(error.message));
    }
  }, 'Update contact form');

  /**
   * POST /admin/contact-forms/:id/delete - Delete contact form
   */
  register('POST', '/admin/contact-forms/:id/delete', async (req, res, params, ctx) => {
    const contactService = ctx.services.get('contact');
    if (!contactService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Contact service not available');
      return;
    }

    const { id } = params;

    try {
      await contactService.deleteForm(id);
      redirect(res, '/admin/contact-forms?success=' + encodeURIComponent(`Deleted form: ${id}`));
    } catch (error) {
      redirect(res, '/admin/contact-forms?error=' + encodeURIComponent(error.message));
    }
  }, 'Delete contact form');

  /**
   * GET /admin/contact-forms/:id/submissions - List submissions
   */
  register('GET', '/admin/contact-forms/:id/submissions', async (req, res, params, ctx) => {
    const contactService = ctx.services.get('contact');
    if (!contactService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Contact service not available');
      return;
    }

    const { id } = params;
    const form = contactService.getForm(id);
    if (!form) {
      redirect(res, '/admin/contact-forms?error=' + encodeURIComponent(`Form "${id}" not found`));
      return;
    }

    const result = contactService.listSubmissions(id, { limit: 100 });
    const flash = getFlashMessage(req.url);

    const submissions = result.items.map(sub => ({
      ...sub,
      createdFormatted: formatDate(sub.created),
    }));

    const html = renderAdmin('contact-submissions.html', {
      pageTitle: `Submissions: ${form.title}`,
      formId: id,
      formTitle: form.title,
      submissions,
      hasSubmissions: submissions.length > 0,
      totalCount: result.total,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Contact form submissions');

  /**
   * GET /admin/contact-forms/:formId/submissions/:id - View submission
   */
  register('GET', '/admin/contact-forms/:formId/submissions/:id', async (req, res, params, ctx) => {
    const contactService = ctx.services.get('contact');
    if (!contactService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Contact service not available');
      return;
    }

    const { formId, id } = params;
    const form = contactService.getForm(formId);
    const submission = contactService.getSubmission(id);

    if (!form || !submission) {
      redirect(res, `/admin/contact-forms/${formId}/submissions?error=` + encodeURIComponent('Submission not found'));
      return;
    }

    const html = renderAdmin('contact-submission-view.html', {
      pageTitle: 'View Submission',
      formId,
      formTitle: form.title,
      submission: {
        ...submission,
        createdFormatted: formatDate(submission.created),
      },
    }, ctx, req);

    server.html(res, html);
  }, 'View contact submission');

  /**
   * POST /admin/contact-forms/:formId/submissions/:id/delete - Delete submission
   */
  register('POST', '/admin/contact-forms/:formId/submissions/:id/delete', async (req, res, params, ctx) => {
    const contactService = ctx.services.get('contact');
    if (!contactService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Contact service not available');
      return;
    }

    const { formId, id } = params;

    try {
      await contactService.deleteSubmission(id);
      redirect(res, `/admin/contact-forms/${formId}/submissions?success=` + encodeURIComponent('Submission deleted'));
    } catch (error) {
      redirect(res, `/admin/contact-forms/${formId}/submissions?error=` + encodeURIComponent(error.message));
    }
  }, 'Delete contact submission');

  /**
   * POST /admin/contact-forms/:id/submissions/delete-all - Delete all submissions
   */
  register('POST', '/admin/contact-forms/:id/submissions/delete-all', async (req, res, params, ctx) => {
    const contactService = ctx.services.get('contact');
    if (!contactService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Contact service not available');
      return;
    }

    const { id } = params;

    try {
      const result = contactService.listSubmissions(id, { limit: 100000 });
      let deleted = 0;
      for (const sub of result.items) {
        await contactService.deleteSubmission(sub.id);
        deleted++;
      }
      redirect(res, `/admin/contact-forms/${id}/submissions?success=` + encodeURIComponent(`Deleted ${deleted} submission(s)`));
    } catch (error) {
      redirect(res, `/admin/contact-forms/${id}/submissions?error=` + encodeURIComponent(error.message));
    }
  }, 'Delete all contact submissions');

  // ==========================================
  // IP Ban Management
  // ==========================================

  /**
   * GET /admin/ban - IP ban list
   */
  register('GET', '/admin/ban', async (req, res, params, ctx) => {
    const banService = ctx.services.get('ban');
    if (!banService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Ban service not available');
      return;
    }

    const bans = banService.listBans();
    const stats = banService.getStats();
    const flash = getFlashMessage(req.url);

    const formattedBans = bans.map(b => ({
      ...b,
      createdFormatted: formatDate(b.created),
      expiresFormatted: b.expires ? formatDate(b.expires) : null,
      isPermanent: !b.expires,
      isCidr: b.ip.includes('/'),
    }));

    const html = renderAdmin('ban-list.html', {
      pageTitle: 'IP Bans',
      bans: formattedBans,
      hasBans: formattedBans.length > 0,
      stats,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'IP ban list');

  /**
   * POST /admin/ban - Add IP ban
   */
  register('POST', '/admin/ban', async (req, res, params, ctx) => {
    const banService = ctx.services.get('ban');
    if (!banService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Ban service not available');
      return;
    }

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const ip = formData.ip?.trim();

      if (!ip) {
        redirect(res, '/admin/ban?error=' + encodeURIComponent('IP address is required'));
        return;
      }

      // Calculate expiry from duration
      let expires = null;
      const duration = formData.duration;
      if (duration && duration !== 'permanent') {
        if (duration === 'custom' && formData.customExpiry) {
          expires = new Date(formData.customExpiry).toISOString();
        } else {
          const hours = {
            '1h': 1,
            '24h': 24,
            '7d': 168,
            '30d': 720,
          };
          if (hours[duration]) {
            expires = new Date(Date.now() + hours[duration] * 3600000).toISOString();
          }
        }
      }

      banService.addBan(ip, {
        reason: formData.reason?.trim() || '',
        expires,
        bannedBy: ctx.user?.name || 'admin',
      });

      redirect(res, '/admin/ban?success=' + encodeURIComponent(`Banned: ${ip}`));
    } catch (error) {
      redirect(res, '/admin/ban?error=' + encodeURIComponent(error.message));
    }
  }, 'Add IP ban');

  /**
   * POST /admin/ban/:ip/delete - Remove IP ban
   */
  register('POST', '/admin/ban/:ip/delete', async (req, res, params, ctx) => {
    const banService = ctx.services.get('ban');
    if (!banService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Ban service not available');
      return;
    }

    try {
      const ip = decodeURIComponent(params.ip);
      banService.removeBan(ip);
      redirect(res, '/admin/ban?success=' + encodeURIComponent(`Unbanned: ${ip}`));
    } catch (error) {
      redirect(res, '/admin/ban?error=' + encodeURIComponent(error.message));
    }
  }, 'Remove IP ban');

  // ==========================================
  // Content History
  // ==========================================

  /**
   * GET /admin/history - Content history overview
   */
  register('GET', '/admin/history', async (req, res, params, ctx) => {
    const historyService = ctx.services.get('history');
    if (!historyService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('History service not available');
      return;
    }

    const stats = historyService.getStats();
    const flash = getFlashMessage(req.url);

    // Get all user histories for the overview
    const content = ctx.services.get('content');
    const userList = content.list('user', { limit: 10000 });

    const users = userList.items.map(user => {
      const readHistory = historyService.getReadHistory(user.id);
      const lastVisit = historyService.getLastVisit(user.id);
      return {
        userId: user.id,
        userName: user.name || user.username || user.id,
        lastVisit,
        lastVisitFormatted: lastVisit ? formatDate(new Date(lastVisit).toISOString()) : 'Never',
        readCount: readHistory.length,
      };
    }).filter(u => u.readCount > 0 || u.lastVisit);

    const html = renderAdmin('history.html', {
      pageTitle: 'Content History',
      users,
      hasUsers: users.length > 0,
      stats,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Content history overview');

  /**
   * POST /admin/history/:userId/clear - Clear user history
   */
  register('POST', '/admin/history/:userId/clear', async (req, res, params, ctx) => {
    const historyService = ctx.services.get('history');
    if (!historyService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('History service not available');
      return;
    }

    const { userId } = params;
    historyService.clearHistory(userId);
    redirect(res, '/admin/history?success=' + encodeURIComponent(`Cleared history for user: ${userId}`));
  }, 'Clear user history');

  // ==========================================
  // Views Management
  // ==========================================

  /**
   * GET /admin/views - Views admin list page
   * WHY: Provides admin UI for managing views (saved queries)
   */
  register('GET', '/admin/views', async (req, res, params, ctx) => {
    const viewsService = ctx.services.get('views');
    if (!viewsService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Views service not available');
      return;
    }

    const viewsList = viewsService.listViews();
    const flash = getFlashMessage(req.url);

    // Enrich views with computed display properties
    const views = viewsList.map(v => ({
      ...v,
      displayMode: v.display || 'page',
      filterCount: v.filters?.length || 0,
      sortCount: v.sort?.length || 0,
      enabled: true, // Views are always enabled if they exist
    }));

    const html = renderAdmin('views-list.html', {
      pageTitle: 'Views',
      views,
      hasViews: views.length > 0,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Views list');

  /**
   * Helper: Build template data for view edit/create form
   * WHY: Shared between create and edit routes to avoid duplication.
   * Pre-computes all boolean flags since template engine only supports {{#if var}}.
   */
  function buildViewEditData(view, viewsService, isEdit, flash) {
    // Get content types for dropdown
    const contentTypes = content.listTypes().map(t => ({
      value: t.type,
      label: t.type.charAt(0).toUpperCase() + t.type.slice(1).replace(/-/g, ' '),
      selected: view ? t.type === view.contentType : false,
    }));

    // WHY CATEGORIZED FIELDS: Drupal Views organizes fields by category
    // (Content, System, Meta, Relationships) so users can quickly find the
    // field they need. We mirror this pattern for usability.
    const fieldCategories = {
      'Content': [
        { value: 'title', label: 'Title' },
        { value: 'body', label: 'Body' },
        { value: 'summary', label: 'Summary' },
        { value: 'image', label: 'Image' },
      ],
      'Taxonomy': [
        { value: 'tags', label: 'Tags' },
        { value: 'category', label: 'Category' },
      ],
      'Meta': [
        { value: 'status', label: 'Status' },
        { value: 'published', label: 'Published' },
        { value: 'author', label: 'Author' },
        { value: 'slug', label: 'Slug' },
      ],
      'System': [
        { value: 'id', label: 'ID' },
        { value: 'type', label: 'Content Type' },
        { value: 'created', label: 'Created Date' },
        { value: 'updated', label: 'Updated Date' },
      ],
    };

    // Build flat available fields list from all categories
    const commonFields = [];
    for (const cat of Object.keys(fieldCategories)) {
      for (const f of fieldCategories[cat]) {
        commonFields.push({ ...f, category: cat });
      }
    }

    // If view has a content type, try to get schema fields
    let availableFields = [...commonFields];
    if (view && view.contentType) {
      const schema = content.getSchema ? content.getSchema(view.contentType) : null;
      if (schema && schema.fields) {
        const schemaFieldNames = Object.keys(schema.fields);
        for (const fname of schemaFieldNames) {
          if (!availableFields.find(f => f.value === fname)) {
            availableFields.push({
              value: fname,
              label: fname.charAt(0).toUpperCase() + fname.slice(1).replace(/[_-]/g, ' '),
              category: 'Type Fields',
            });
          }
        }
        // Add 'Type Fields' category if new fields were added
        if (schemaFieldNames.some(fn => !commonFields.find(f => f.value === fn))) {
          if (!fieldCategories['Type Fields']) {
            fieldCategories['Type Fields'] = availableFields.filter(f => f.category === 'Type Fields');
          }
        }
      }
    }

    // Build categorized fields JSON for the add-field modal
    // WHY: The template renders a categorized field chooser modal where
    // fields are grouped under headings (Content, Meta, System, etc.)
    const categorizedFieldsJSON = JSON.stringify(fieldCategories);

    // Build display tabs from actual displays array
    // WHY: Each view can have multiple displays (page, block, feed).
    // The tabs let users switch between displays to configure each one independently.
    const displays = [];
    const activeDisplayId = null; // first display is active by default
    if (view && view.displays && Array.isArray(view.displays) && view.displays.length > 0) {
      view.displays.forEach((d, idx) => {
        displays.push({
          id: d.id,
          type: d.type,
          label: d.label || d.type.charAt(0).toUpperCase() + d.type.slice(1),
          tabClass: idx === 0 ? 'active' : '',
          path: d.path || '',
          displayMode: d.displayMode || 'table',
          pagerType: d.pager?.type || 'full',
          pagerLimit: d.pager?.limit || 10,
        });
      });
    } else {
      // Legacy: single display from top-level display field
      const displayType = view ? (view.display || 'page') : 'page';
      displays.push({
        id: 'default',
        type: displayType,
        label: displayType.charAt(0).toUpperCase() + displayType.slice(1),
        tabClass: 'active',
        path: view ? (view.path || '') : '',
        displayMode: view ? (view.displayMode || view.format || 'table') : 'table',
        pagerType: view ? (view.pager?.type || 'full') : 'full',
        pagerLimit: view ? (view.pager?.limit || 10) : 10,
      });
    }
    const hasMultipleDisplays = displays.length > 1;
    const displaysJSON = JSON.stringify(displays);

    // Build fields array with pre-computed flags
    // WHY PRE-RENDER: Template engine doesn't support nested {{#each ../parent}}
    // So we pre-render option HTML for select elements in each row
    function buildOptionsHtml(options, selectedValue) {
      return options.map(o =>
        `<option value="${o.value}"${o.value === selectedValue ? ' selected' : ''}>${o.label}</option>`
      ).join('\n              ');
    }

    const viewFields = [];
    // WHY: Pre-render complete field row HTML to avoid nested template issues
    let fieldsRowsHtml = '';
    if (view && view.fields && Array.isArray(view.fields)) {
      view.fields.forEach((field, idx) => {
        const fieldName = typeof field === 'string' ? field : (field.name || field);
        const fieldLabel = typeof field === 'object' ? (field.label || '') : '';
        const fieldFormatter = typeof field === 'object' ? (field.formatter || 'default') : 'default';

        const fieldOptionsHtml = buildOptionsHtml(availableFields, fieldName);

        viewFields.push({
          name: fieldName,
          label: fieldLabel,
          formatter: fieldFormatter,
        });

        fieldsRowsHtml += `
          <div class="field-row" draggable="true">
            <span class="drag-handle" title="Drag to reorder">&#9776;</span>
            <select name="fields[${idx}][name]" class="field-select" required>
              <option value="">-- Select Field --</option>
              ${fieldOptionsHtml}
            </select>
            <input type="text" name="fields[${idx}][label]" value="${fieldLabel}" placeholder="Custom label (optional)" class="field-label-input">
            <select name="fields[${idx}][formatter]" class="field-formatter">
              <option value="default"${fieldFormatter === 'default' ? ' selected' : ''}>Default</option>
              <option value="trimmed"${fieldFormatter === 'trimmed' ? ' selected' : ''}>Trimmed</option>
              <option value="raw"${fieldFormatter === 'raw' ? ' selected' : ''}>Raw</option>
              <option value="date"${fieldFormatter === 'date' ? ' selected' : ''}>Date</option>
              <option value="link"${fieldFormatter === 'link' ? ' selected' : ''}>Link</option>
            </select>
            <button type="button" class="btn btn-sm btn-danger" onclick="removeField(this)">Remove</button>
          </div>`;
      });
    }

    // Build filters array - pre-render HTML to avoid nested template issues
    const viewFilters = [];
    let filtersRowsHtml = '';
    const operators = [
      { value: '=', label: 'Equals' },
      { value: '!=', label: 'Not Equals' },
      { value: 'contains', label: 'Contains' },
      { value: '>', label: 'Greater Than' },
      { value: '<', label: 'Less Than' },
      { value: '>=', label: 'Greater or Equal' },
      { value: '<=', label: 'Less or Equal' },
    ];
    if (view && view.filters && Array.isArray(view.filters)) {
      view.filters.forEach((filter, idx) => {
        const filterOp = filter.op || filter.operator || '=';
        const filterVal = filter.value !== undefined ? String(filter.value) : '';
        const isExposed = !!filter.exposed;

        viewFilters.push({
          field: filter.field,
          operator: filterOp,
          filterValue: filterVal,
          exposed: isExposed,
        });

        const fieldOptsHtml = buildOptionsHtml(availableFields, filter.field);
        const operatorOptsHtml = buildOptionsHtml(operators, filterOp);

        filtersRowsHtml += `
          <div class="filter-row">
            <select name="filters[${idx}][field]" class="filter-field" required>
              <option value="">-- Select Field --</option>
              ${fieldOptsHtml}
            </select>
            <select name="filters[${idx}][operator]" class="filter-operator" required>
              ${operatorOptsHtml}
            </select>
            <input type="text" name="filters[${idx}][value]" value="${filterVal}" placeholder="Value" required>
            <label class="checkbox-label checkbox-sm" title="Expose this filter to end users">
              <input type="checkbox" name="filters[${idx}][exposed]" value="true"${isExposed ? ' checked' : ''}>
              Exposed
            </label>
            <button type="button" class="btn btn-sm btn-danger" onclick="removeFilter(this)">Remove</button>
          </div>`;
      });
    }

    // Build sorts array - pre-render HTML to avoid nested template issues
    const viewSorts = [];
    let sortsRowsHtml = '';
    if (view && view.sort && Array.isArray(view.sort)) {
      view.sort.forEach((s, idx) => {
        const dir = (s.dir || s.direction || 'ASC').toUpperCase();
        viewSorts.push({
          field: s.field,
          direction: dir,
        });

        const sortFieldOptsHtml = buildOptionsHtml(availableFields, s.field);

        sortsRowsHtml += `
          <div class="sort-row" draggable="true">
            <span class="drag-handle" title="Drag to reorder">&#9776;</span>
            <select name="sort[${idx}][field]" class="sort-field" required>
              <option value="">-- Select Field --</option>
              ${sortFieldOptsHtml}
            </select>
            <select name="sort[${idx}][direction]" class="sort-direction" required>
              <option value="ASC"${dir === 'ASC' ? ' selected' : ''}>Ascending</option>
              <option value="DESC"${dir === 'DESC' ? ' selected' : ''}>Descending</option>
            </select>
            <button type="button" class="btn btn-sm btn-danger" onclick="removeSort(this)">Remove</button>
          </div>`;
      });
    }

    // Pager
    const pagerType = view ? (view.pager?.type || 'full') : 'full';
    const itemsPerPage = view ? (view.pager?.limit || 10) : 10;

    // Display type flags
    const dt = view ? (view.display || 'page') : 'page';
    const displayMode = view ? (view.displayMode || view.format || 'table') : 'table';

    // WHY: Pre-render display settings panel HTML for the active display.
    // Each display has its own title, format, path, and pager settings.
    const activeDisplay = displays[0] || {};
    let displaySettingsHtml = '';
    displays.forEach((d, idx) => {
      const isActive = idx === 0;
      const isPage = d.type === 'page';
      const isFeed = d.type === 'feed';
      displaySettingsHtml += `
        <div class="display-settings-panel" data-display-id="${d.id}" style="display: ${isActive ? 'block' : 'none'};">
          <h3>Display: ${d.label} <span class="display-type-badge">${d.type}</span></h3>
          <div class="form-row">
            <div class="form-group">
              <label for="display_label_${d.id}">Display Title</label>
              <input type="text" id="display_label_${d.id}" name="display_settings[${d.id}][label]" value="${d.label}" placeholder="Display title">
            </div>
            <div class="form-group">
              <label for="display_format_${d.id}">Format</label>
              <select id="display_format_${d.id}" name="display_settings[${d.id}][displayMode]">
                <option value="table"${d.displayMode === 'table' ? ' selected' : ''}>Table</option>
                <option value="grid"${d.displayMode === 'grid' ? ' selected' : ''}>Grid</option>
                <option value="list"${d.displayMode === 'list' ? ' selected' : ''}>Unformatted List</option>
                <option value="custom"${d.displayMode === 'custom' ? ' selected' : ''}>Custom Template</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="display_pager_type_${d.id}">Pager Type</label>
              <select id="display_pager_type_${d.id}" name="display_settings[${d.id}][pager_type]">
                <option value="full"${d.pagerType === 'full' ? ' selected' : ''}>Full Pager</option>
                <option value="mini"${d.pagerType === 'mini' ? ' selected' : ''}>Mini Pager</option>
                <option value="none"${d.pagerType === 'none' ? ' selected' : ''}>No Pager</option>
              </select>
            </div>
            <div class="form-group">
              <label for="display_pager_limit_${d.id}">Items Per Page</label>
              <input type="number" id="display_pager_limit_${d.id}" name="display_settings[${d.id}][pager_limit]" value="${d.pagerLimit}" min="1" max="100">
            </div>
          </div>
          ${isPage ? `
          <div class="form-group">
            <label for="display_path_${d.id}">URL Path</label>
            <input type="text" id="display_path_${d.id}" name="display_settings[${d.id}][path]" value="${d.path}" placeholder="e.g., /articles">
            <small>Make this display accessible at a specific URL path.</small>
          </div>` : ''}
          ${isFeed ? `
          <div class="form-group">
            <label for="display_path_${d.id}">Feed URL Path</label>
            <input type="text" id="display_path_${d.id}" name="display_settings[${d.id}][path]" value="${d.path}" placeholder="e.g., /articles/feed">
            <small>URL path for the RSS/JSON feed.</small>
          </div>` : ''}
          <button type="button" class="btn btn-sm btn-danger" onclick="removeDisplay('${d.id}')" ${displays.length <= 1 ? 'disabled title="Cannot remove the only display"' : ''}>Remove Display</button>
        </div>`;
    });

    return {
      pageTitle: isEdit ? 'Edit View: ' + view.name : 'Create View',
      breadcrumbLabel: isEdit ? 'Edit: ' + view.name : 'Create View',
      formAction: isEdit ? '/admin/views/' + view.id : '/admin/views/create',
      isEdit,
      isCreate: !isEdit,
      viewId: view ? view.id : '',
      viewName: view ? view.name : '',
      viewMachineName: view ? view.id : '',
      viewDescription: view ? (view.description || '') : '',
      viewEnabled: view ? true : true,
      viewPath: view ? (view.path || '') : '',
      viewTemplate: view ? (view.template || '') : '',
      viewHeader: view ? (view.header || '') : '',
      viewFooter: view ? (view.footer || '') : '',
      viewItemsPerPage: itemsPerPage,
      contentTypes,
      availableFields: availableFields.map(f => ({ ...f, selected: false })),
      availableFieldsJSON: JSON.stringify(availableFields),
      categorizedFieldsJSON: categorizedFieldsJSON,
      displaysJSON: displaysJSON,
      displays,
      hasMultipleDisplays,
      displaySettingsHtml,
      // Fields - pre-rendered HTML for rows (avoids nested template issues)
      viewFields,
      hasFields: viewFields.length > 0,
      fieldCount: viewFields.length,
      fieldsRowsHtml,
      // Filters - pre-rendered HTML for rows
      viewFilters,
      hasFilters: viewFilters.length > 0,
      filterCount: viewFilters.length,
      filterLogic: view?.filterLogic || 'AND',
      filterLogicAndChecked: (view?.filterLogic || 'AND') === 'AND' ? 'checked' : '',
      filterLogicOrChecked: (view?.filterLogic || 'AND') === 'OR' ? 'checked' : '',
      filtersRowsHtml,
      // Sorts - pre-rendered HTML for rows
      viewSorts,
      hasSorts: viewSorts.length > 0,
      sortCount: viewSorts.length,
      sortsRowsHtml,
      // Pager
      pagerFull: pagerType === 'full',
      pagerMini: pagerType === 'mini',
      pagerNone: pagerType === 'none',
      // Display type
      displayPage: dt === 'page',
      displayBlock: dt === 'block',
      displayFeed: dt === 'feed',
      displayEmbed: dt === 'embed',
      displayAttachment: dt === 'attachment',
      // Format
      formatTable: displayMode === 'table',
      formatGrid: displayMode === 'grid',
      formatList: displayMode === 'list',
      formatCustom: displayMode === 'custom',
      // Flash
      hasFlash: !!flash,
      flashType: flash ? flash.type : '',
      flashMessage: flash ? flash.message : '',
    };
  }

  /**
   * GET /admin/views/create - Create view form
   * WHY: Admin UI for creating a new view
   */
  register('GET', '/admin/views/create', async (req, res, params, ctx) => {
    const viewsService = ctx.services.get('views');
    if (!viewsService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Views service not available');
      return;
    }

    const flash = getFlashMessage(req.url);
    const templateData = buildViewEditData(null, viewsService, false, flash);

    const html = renderAdmin('views-edit.html', templateData, ctx, req);
    server.html(res, html);
  }, 'Create view form');

  /**
   * POST /admin/views/create - Create a new view
   * WHY: Process form submission to create a view
   */
  register('POST', '/admin/views/create', async (req, res, params, ctx) => {
    const viewsService = ctx.services.get('views');
    if (!viewsService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Views service not available');
      return;
    }

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);

      const machineName = (formData.machine_name || '').trim().toLowerCase().replace(/[^a-z_]/g, '');
      if (!machineName) {
        redirect(res, '/admin/views/create?error=' + encodeURIComponent('Machine name is required'));
        return;
      }

      // Parse fields from form
      const fields = parseViewArrayFormData(formData, 'fields', ['name', 'label', 'formatter']);
      // Parse filters from form
      const filters = parseViewArrayFormData(formData, 'filters', ['field', 'operator', 'value', 'exposed']).map(f => ({
        field: f.field,
        op: f.operator || '=',
        value: f.value,
        exposed: f.exposed === 'true',
      }));
      const filterLogic = formData.filterLogic || 'AND';
      // Parse sorts from form
      const sorts = parseViewArrayFormData(formData, 'sort', ['field', 'direction']).map(s => ({
        field: s.field,
        dir: (s.direction || 'DESC').toLowerCase(),
      }));

      const viewConfig = {
        name: (formData.name || '').trim(),
        description: (formData.description || '').trim(),
        contentType: (formData.content_type || '').trim(),
        display: formData.display_type || 'page',
        displayMode: formData.display_mode || 'table',
        path: (formData.path || '').trim() || null,
        template: (formData.template || '').trim() || null,
        fields: fields.map(f => f.label ? { name: f.name, label: f.label, formatter: f.formatter || 'default' } : f.name),
        filters,
        filterLogic,
        sort: sorts,
        pager: {
          type: formData.pager_type || 'full',
          limit: parseInt(formData.items_per_page) || 10,
        },
      };

      await viewsService.createView(machineName, viewConfig);
      redirect(res, '/admin/views?success=' + encodeURIComponent('Created view: ' + viewConfig.name));
    } catch (error) {
      redirect(res, '/admin/views/create?error=' + encodeURIComponent(error.message));
    }
  }, 'Create view');

  /**
   * GET /admin/views/:id/edit - Edit view form
   * WHY: Admin UI for editing an existing view configuration
   */
  register('GET', '/admin/views/:id/edit', async (req, res, params, ctx) => {
    const viewsService = ctx.services.get('views');
    if (!viewsService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Views service not available');
      return;
    }

    const { id } = params;
    const view = viewsService.getViewConfig(id);
    if (!view) {
      redirect(res, '/admin/views?error=' + encodeURIComponent('View not found: ' + id));
      return;
    }

    const flash = getFlashMessage(req.url);
    const templateData = buildViewEditData(view, viewsService, true, flash);

    const html = renderAdmin('views-edit.html', templateData, ctx, req);
    server.html(res, html);
  }, 'Edit view form');

  /**
   * POST /admin/views/:id - Update a view
   * WHY: Process form submission to update view configuration
   */
  register('POST', '/admin/views/:id', async (req, res, params, ctx) => {
    const viewsService = ctx.services.get('views');
    if (!viewsService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Views service not available');
      return;
    }

    const { id } = params;
    try {
      const formData = ctx._parsedBody || await parseFormBody(req);

      // Parse fields from form
      const fields = parseViewArrayFormData(formData, 'fields', ['name', 'label', 'formatter']);
      // Parse filters from form
      const filters = parseViewArrayFormData(formData, 'filters', ['field', 'operator', 'value', 'exposed']).map(f => ({
        field: f.field,
        op: f.operator || '=',
        value: f.value,
        exposed: f.exposed === 'true',
      }));
      const filterLogic = formData.filterLogic || 'AND';
      // Parse sorts from form
      const sorts = parseViewArrayFormData(formData, 'sort', ['field', 'direction']).map(s => ({
        field: s.field,
        dir: (s.direction || 'DESC').toLowerCase(),
      }));

      const updates = {
        name: (formData.name || '').trim(),
        description: (formData.description || '').trim(),
        contentType: (formData.content_type || '').trim(),
        display: formData.display_type || 'page',
        displayMode: formData.display_mode || 'table',
        path: (formData.path || '').trim() || null,
        template: (formData.template || '').trim() || null,
        header: (formData.header || '').trim() || null,
        footer: (formData.footer || '').trim() || null,
        fields: fields.map(f => f.label ? { name: f.name, label: f.label, formatter: f.formatter || 'default' } : f.name),
        filters,
        filterLogic,
        sort: sorts,
        pager: {
          type: formData.pager_type || 'full',
          limit: parseInt(formData.items_per_page) || 10,
        },
      };

      await viewsService.updateView(id, updates);

      // WHY: Also update per-display settings if provided.
      // Display settings are submitted as display_settings[display_id][field] = value.
      // Each display has its own label, format, pager, and path.
      const displaySettingsKeys = Object.keys(formData).filter(k => k.startsWith('display_settings['));
      if (displaySettingsKeys.length > 0) {
        // Parse display_settings[display_id][field] pattern
        const displayUpdates = {};
        for (const key of displaySettingsKeys) {
          const match = key.match(/display_settings\[([^\]]+)\]\[([^\]]+)\]/);
          if (match) {
            const [, dispId, field] = match;
            if (!displayUpdates[dispId]) displayUpdates[dispId] = {};
            displayUpdates[dispId][field] = formData[key];
          }
        }

        // Apply updates to each display
        for (const [dispId, dispUpdate] of Object.entries(displayUpdates)) {
          try {
            const updateObj = {};
            if (dispUpdate.label) updateObj.label = dispUpdate.label;
            if (dispUpdate.displayMode) updateObj.displayMode = dispUpdate.displayMode;
            if (dispUpdate.path !== undefined) updateObj.path = dispUpdate.path.trim() || null;
            if (dispUpdate.pager_type || dispUpdate.pager_limit) {
              updateObj.pager = {};
              if (dispUpdate.pager_type) updateObj.pager.type = dispUpdate.pager_type;
              if (dispUpdate.pager_limit) updateObj.pager.limit = parseInt(dispUpdate.pager_limit) || 10;
            }
            await viewsService.updateDisplay(id, dispId, updateObj);
          } catch (e) {
            // Display might not exist yet (new view) - skip silently
          }
        }
      }

      redirect(res, '/admin/views/' + id + '/edit?success=' + encodeURIComponent('View saved successfully'));
    } catch (error) {
      redirect(res, '/admin/views/' + id + '/edit?error=' + encodeURIComponent(error.message));
    }
  }, 'Update view');

  /**
   * POST /admin/views/:id/display/add - Add a display to a view
   * WHY: Drupal Views support multiple displays (page, block, feed).
   * This route adds a new display to an existing view.
   */
  register('POST', '/admin/views/:id/display/add', async (req, res, params, ctx) => {
    const viewsService = ctx.services.get('views');
    if (!viewsService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Views service not available');
      return;
    }

    const { id } = params;
    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const displayType = (formData.display_type || 'page').trim();

      if (!['page', 'block', 'feed'].includes(displayType)) {
        redirect(res, '/admin/views/' + id + '/edit?error=' + encodeURIComponent('Invalid display type: ' + displayType));
        return;
      }

      // WHY: Ensure the view has a displays array before adding.
      // Legacy views may not have one - initialize it.
      const view = viewsService.getViewConfig(id);
      if (!view) {
        redirect(res, '/admin/views?error=' + encodeURIComponent('View not found: ' + id));
        return;
      }

      if (!view.displays || !Array.isArray(view.displays)) {
        // Initialize displays array with current display config
        const defaultDisplay = {
          type: view.display || 'page',
          label: (view.display || 'page').charAt(0).toUpperCase() + (view.display || 'page').slice(1),
          path: view.path || null,
          displayMode: view.displayMode || 'table',
        };
        await viewsService.addDisplay(id, defaultDisplay);
      }

      // Add the new display
      const display = await viewsService.addDisplay(id, {
        type: displayType,
        label: displayType.charAt(0).toUpperCase() + displayType.slice(1),
      });

      redirect(res, '/admin/views/' + id + '/edit?success=' + encodeURIComponent('Added ' + displayType + ' display: ' + display.id));
    } catch (error) {
      redirect(res, '/admin/views/' + id + '/edit?error=' + encodeURIComponent(error.message));
    }
  }, 'Add display to view');

  /**
   * POST /admin/views/:id/display/:displayId/remove - Remove a display
   * WHY: Users may want to remove a display they no longer need.
   */
  register('POST', '/admin/views/:id/display/:displayId/remove', async (req, res, params, ctx) => {
    const viewsService = ctx.services.get('views');
    if (!viewsService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Views service not available');
      return;
    }

    const { id, displayId } = params;
    try {
      await viewsService.removeDisplay(id, displayId);
      redirect(res, '/admin/views/' + id + '/edit?success=' + encodeURIComponent('Removed display: ' + displayId));
    } catch (error) {
      redirect(res, '/admin/views/' + id + '/edit?error=' + encodeURIComponent(error.message));
    }
  }, 'Remove display from view');

  /**
   * GET /admin/views/:id/preview.json - JSON preview results for inline preview
   * WHY: The edit page needs to fetch preview data via AJAX to display results
   * inline without a full page navigation. Returns structured JSON for client rendering.
   */
  register('GET', '/admin/views/:id/preview.json', async (req, res, params, ctx) => {
    const viewsService = ctx.services.get('views');
    if (!viewsService) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Views service not available' }));
      return;
    }

    const { id } = params;
    const view = viewsService.getViewConfig(id);
    if (!view) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'View not found: ' + id }));
      return;
    }

    let results = null;
    let queryError = null;
    try {
      results = await viewsService.executeView(id, {});
    } catch (error) {
      queryError = error.message;
    }

    const items = results ? results.items : [];
    const viewFields = view.fields || [];
    const fieldNames = viewFields.map(f => typeof f === 'string' ? f : (f.name || f));
    const fieldLabels = viewFields.map(f => {
      if (typeof f === 'object' && f.label) return f.label;
      const name = typeof f === 'string' ? f : (f.name || f);
      return name.charAt(0).toUpperCase() + name.slice(1).replace(/[_-]/g, ' ');
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      viewName: view.name,
      contentType: view.contentType,
      items: items,
      total: results ? results.total : 0,
      count: items.length,
      fieldNames: fieldNames,
      fieldLabels: fieldLabels,
      error: queryError,
    }));
  }, 'View preview JSON API');

  /**
   * GET /admin/views/:id/preview - Preview view results
   * WHY: Show live query results for a view
   */
  register('GET', '/admin/views/:id/preview', async (req, res, params, ctx) => {
    const viewsService = ctx.services.get('views');
    if (!viewsService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Views service not available');
      return;
    }

    const { id } = params;
    const view = viewsService.getViewConfig(id);
    if (!view) {
      redirect(res, '/admin/views?error=' + encodeURIComponent('View not found: ' + id));
      return;
    }

    // Execute the view to get results
    let results = null;
    let queryError = null;
    try {
      results = await viewsService.executeView(id, {});
    } catch (error) {
      queryError = error.message;
    }

    // WHY PRE-RENDER: Template engine can't handle nested {{#each ../view.fields}}
    // Pre-render the results table HTML server-side
    const items = results ? results.items : [];
    const viewFields = view.fields || [];
    // Normalize fields - can be strings or objects with name/label/formatter
    const fieldNames = viewFields.map(f => typeof f === 'string' ? f : (f.name || f));
    // WHY: Custom labels override field names in table headers.
    // Drupal Views allows each field to have a custom "Administrative title" that
    // shows in the table header instead of the raw field name.
    const fieldLabels = viewFields.map(f => {
      if (typeof f === 'object' && f.label) return f.label;
      const name = typeof f === 'string' ? f : (f.name || f);
      return name.charAt(0).toUpperCase() + name.slice(1).replace(/[_-]/g, ' ');
    });
    // WHY: Formatters control how field values are displayed (e.g., trimmed, date, link, raw).
    const fieldFormatters = viewFields.map(f => typeof f === 'object' ? (f.formatter || 'default') : 'default');

    // Build table header HTML using custom labels
    let tableHeaderHtml = '';
    if (fieldNames.length > 0) {
      tableHeaderHtml = fieldLabels.map(label => `<th>${label}</th>`).join('\n            ');
    } else {
      tableHeaderHtml = '<th>ID</th>\n            <th>Title</th>\n            <th>Status</th>\n            <th>Author</th>\n            <th>Created</th>';
    }

    /**
     * Format a field value according to its formatter setting
     * WHY: Different formatters present the same data differently:
     * - default: as-is with HTML escaping
     * - trimmed: first 200 characters with ellipsis
     * - raw: unprocessed value
     * - date: formatted date string
     * - link: clickable link
     */
    function formatFieldValue(val, formatter) {
      if (val === undefined || val === null) return '';
      const str = String(val);
      switch (formatter) {
        case 'trimmed':
          return str.length > 200 ? str.slice(0, 200) + '...' : str;
        case 'date':
          try {
            return new Date(str).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          } catch { return str; }
        case 'link':
          return `<a href="${str}" target="_blank">${str}</a>`;
        case 'raw':
          return str;
        default:
          return str;
      }
    }

    // Build table body HTML with formatter support
    let tableBodyHtml = '';
    for (const item of items) {
      let rowHtml = '<tr>';
      if (fieldNames.length > 0) {
        for (let fi = 0; fi < fieldNames.length; fi++) {
          const val = item[fieldNames[fi]];
          const formatted = formatFieldValue(val, fieldFormatters[fi]);
          rowHtml += `<td>${formatted}</td>`;
        }
      } else {
        const pubBadge = item.published
          ? '<span class="status-badge status-published">Published</span>'
          : '<span class="status-badge status-draft">Draft</span>';
        rowHtml += `<td>${item.id || ''}</td>`;
        rowHtml += `<td><strong>${item.title || ''}</strong></td>`;
        rowHtml += `<td>${pubBadge}</td>`;
        rowHtml += `<td>${item.author || ''}</td>`;
        rowHtml += `<td>${item.created || ''}</td>`;
      }
      rowHtml += '</tr>';
      tableBodyHtml += rowHtml + '\n          ';
    }

    // Build filters HTML
    let filtersHtml = '';
    if (view.filters && view.filters.length > 0) {
      filtersHtml = view.filters.map(f =>
        `<li><code>${f.field}</code> ${f.op || f.operator || '='} <strong>${f.value !== undefined ? f.value : ''}</strong></li>`
      ).join('\n            ');
    }

    // Build sorts HTML
    let sortsHtml = '';
    if (view.sort && view.sort.length > 0) {
      sortsHtml = view.sort.map(s =>
        `<li><code>${s.field}</code> ${(s.dir || s.direction || 'desc').toUpperCase()}</li>`
      ).join('\n            ');
    }

    const html = renderAdmin('views-preview.html', {
      pageTitle: 'Preview: ' + view.name,
      viewId: view.id,
      viewName: view.name,
      viewDescription: view.description || '',
      hasDescription: !!(view.description),
      viewContentType: view.contentType,
      viewDisplayMode: view.displayMode || view.display || 'table',
      viewPath: view.path || '',
      hasPath: !!(view.path),
      viewHeader: view.header || '',
      viewFooter: view.footer || '',
      hasHeader: !!(view.header),
      hasFooter: !!(view.footer),
      resultCount: items.length,
      totalCount: results ? results.total : 0,
      hasResults: items.length > 0,
      tableHeaderHtml,
      tableBodyHtml,
      hasFilters: !!(view.filters && view.filters.length > 0),
      filtersHtml,
      hasSorts: !!(view.sort && view.sort.length > 0),
      sortsHtml,
      viewItemsPerPage: view.pager ? view.pager.limit : 10,
      hasItemsPerPage: !!(view.pager),
      queryError,
      hasError: !!queryError,
    }, ctx, req);

    server.html(res, html);
  }, 'Preview view');

  /**
   * Helper: Parse array-style form data like fields[0][name], filters[1][field]
   * WHY: HTML forms encode array items as indexed bracket notation.
   */
  function parseViewArrayFormData(formData, prefix, keys) {
    const items = [];
    // WHY: Track consecutive misses to handle sparse indices from add/remove cycles.
    // When a user removes a field row and adds another, indices may have gaps
    // (e.g., 0, 1, 3 with 2 removed). We skip gaps up to 10 consecutive misses.
    let consecutiveMisses = 0;
    let i = 0;
    while (i < 200 && consecutiveMisses < 10) {
      const hasKey = keys.some(k => formData[prefix + '[' + i + '][' + k + ']'] !== undefined);
      if (!hasKey) {
        consecutiveMisses++;
        i++;
        continue;
      }

      consecutiveMisses = 0;
      const item = {};
      for (const k of keys) {
        item[k] = formData[prefix + '[' + i + '][' + k + ']'] || '';
      }
      items.push(item);
      i++;
    }

    // Fallback: Also check for simple array like fields[]
    if (items.length === 0 && formData[prefix + '[]'] !== undefined) {
      const values = Array.isArray(formData[prefix + '[]'])
        ? formData[prefix + '[]']
        : [formData[prefix + '[]']];
      return values.map(v => ({ name: v }));
    }

    return items;
  }

  /**
   * POST /admin/views/:id/delete - Delete a view
   * WHY: Admin UI delete action for views
   */
  register('POST', '/admin/views/:id/delete', async (req, res, params, ctx) => {
    const viewsService = ctx.services.get('views');
    if (!viewsService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Views service not available');
      return;
    }

    const { id } = params;
    try {
      await viewsService.deleteView(id);
      redirect(res, '/admin/views?success=' + encodeURIComponent(`Deleted view: ${id}`));
    } catch (error) {
      redirect(res, '/admin/views?error=' + encodeURIComponent(error.message));
    }
  }, 'Delete view');

  /**
   * Register view page display routes
   * WHY: Views with page displays and configured paths need to be served as actual
   * URL routes. We register a handler for each path that renders the view results.
   */
  (function registerViewPageRoutes() {
    const viewsService = context.services?.get('views');
    if (!viewsService || !viewsService.getPageDisplayRoutes) return;

    const pageRoutes = viewsService.getPageDisplayRoutes();
    for (const route of pageRoutes) {
      if (!route.path) continue;

      const routePath = route.path.startsWith('/') ? route.path : '/' + route.path;

      register('GET', routePath, async (req, res, params, ctx) => {
        const vs = ctx.services.get('views');
        if (!vs) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Views service not available');
          return;
        }

        const view = vs.getViewConfig(route.viewId);
        if (!view) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('View not found');
          return;
        }

        let results;
        try {
          results = await vs.executeView(route.viewId, {
            params,
            query: Object.fromEntries(new URL(req.url, 'http://localhost').searchParams),
          });
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end('<h1>View Error</h1><p>' + error.message + '</p>');
          return;
        }

        const display = route.display || {};
        const displayMode = display.displayMode || 'table';
        const items = results.items || [];
        const viewFields = view.fields || [];
        const fieldNames = viewFields.map(function(f) { return typeof f === 'string' ? f : (f.name || f); });

        let contentHtml = '';

        if (displayMode === 'table') {
          let headerHtml = '';
          if (fieldNames.length > 0) {
            headerHtml = fieldNames.map(function(f) { return '<th>' + f + '</th>'; }).join('');
          } else {
            headerHtml = '<th>Title</th><th>Status</th><th>Created</th>';
          }

          let rowsHtml = '';
          for (const item of items) {
            rowsHtml += '<tr>';
            if (fieldNames.length > 0) {
              for (const fname of fieldNames) {
                const val = item[fname];
                rowsHtml += '<td>' + (val !== undefined && val !== null ? String(val) : '') + '</td>';
              }
            } else {
              rowsHtml += '<td>' + (item.title || '') + '</td>';
              rowsHtml += '<td>' + (item.published ? 'Published' : 'Draft') + '</td>';
              rowsHtml += '<td>' + (item.created || '') + '</td>';
            }
            rowsHtml += '</tr>';
          }

          contentHtml = '<table class="view-table"><thead><tr>' + headerHtml + '</tr></thead><tbody>' + rowsHtml + '</tbody></table>';
        } else if (displayMode === 'list') {
          contentHtml = '<ul class="view-list">';
          for (const item of items) {
            contentHtml += '<li>' + (item.title || item.id || JSON.stringify(item)) + '</li>';
          }
          contentHtml += '</ul>';
        } else if (displayMode === 'grid') {
          contentHtml = '<div class="view-grid">';
          for (const item of items) {
            contentHtml += '<div class="view-grid-item"><h3>' + (item.title || '') + '</h3>';
            if (item.summary) contentHtml += '<p>' + item.summary + '</p>';
            contentHtml += '</div>';
          }
          contentHtml += '</div>';
        }

        let pagerHtml = '';
        if (results.pager && results.pager.totalPages > 1) {
          pagerHtml = '<div class="view-pager">';
          if (results.pager.hasPrev) {
            pagerHtml += '<a href="' + routePath + '?page=' + (results.pager.currentPage - 1) + '">&laquo; Previous</a> ';
          }
          pagerHtml += '<span>Page ' + (results.pager.currentPage + 1) + ' of ' + results.pager.totalPages + '</span>';
          if (results.pager.hasNext) {
            pagerHtml += ' <a href="' + routePath + '?page=' + (results.pager.currentPage + 1) + '">Next &raquo;</a>';
          }
          pagerHtml += '</div>';
        }

        // WHY: Build exposed filter form HTML
        // Exposed filters allow end users to interactively filter view results
        // Each exposed filter renders as a form field, submits via GET to preserve URL state
        let exposedFilterHtml = '';
        const exposedFilters = (view.filters || []).filter(f => f.exposed === true);
        if (exposedFilters.length > 0) {
          const currentQuery = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);

          exposedFilterHtml = '<form method="GET" action="' + routePath + '" class="exposed-filters">';

          for (const filter of exposedFilters) {
            const fieldName = filter.field;
            const currentValue = currentQuery[fieldName] || '';
            const labelText = fieldName.charAt(0).toUpperCase() + fieldName.slice(1);

            exposedFilterHtml += '<div class="filter-field">';
            exposedFilterHtml += '<label for="filter-' + fieldName + '">' + labelText + '</label>';
            exposedFilterHtml += '<input type="text" id="filter-' + fieldName + '" name="' + fieldName + '" value="' + currentValue + '" />';
            exposedFilterHtml += '</div>';
          }

          exposedFilterHtml += '<div class="filter-actions">';
          exposedFilterHtml += '<button type="submit">Filter</button>';
          exposedFilterHtml += '<a href="' + routePath + '" class="reset-link">Reset</a>';
          exposedFilterHtml += '</div>';
          exposedFilterHtml += '</form>';
        }

        const pageHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
          + '<title>' + (view.name || 'View') + '</title>'
          + '<style>'
          + 'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:0;padding:2rem;color:#111827;background:#fff;max-width:1200px;margin:0 auto;}'
          + 'h1{margin:0 0 1rem;font-size:1.5rem;color:#111827;}'
          + '.exposed-filters{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:1rem;margin-bottom:1.5rem;display:flex;align-items:flex-end;gap:1rem;flex-wrap:wrap;}'
          + '.filter-field{display:flex;flex-direction:column;gap:0.25rem;}'
          + '.filter-field label{font-size:0.85rem;font-weight:500;color:#374151;}'
          + '.filter-field input{padding:0.5rem;border:1px solid #d1d5db;border-radius:4px;font-size:0.9rem;min-width:200px;}'
          + '.filter-actions{display:flex;gap:0.5rem;align-items:center;}'
          + '.filter-actions button{background:#2563eb;color:#fff;border:none;padding:0.5rem 1rem;border-radius:4px;font-size:0.9rem;cursor:pointer;}'
          + '.filter-actions button:hover{background:#1d4ed8;}'
          + '.reset-link{color:#6b7280;text-decoration:none;font-size:0.85rem;padding:0.5rem;}'
          + '.reset-link:hover{color:#374151;text-decoration:underline;}'
          + '.view-table{width:100%;border-collapse:collapse;margin-bottom:1rem;}'
          + '.view-table th{background:#f9fafb;border:1px solid #e5e7eb;padding:0.5rem 0.75rem;text-align:left;font-size:0.85rem;text-transform:uppercase;color:#6b7280;}'
          + '.view-table td{border:1px solid #e5e7eb;padding:0.5rem 0.75rem;font-size:0.9rem;}'
          + '.view-table tr:hover{background:#f9fafb;}'
          + '.view-list{list-style:none;padding:0;}'
          + '.view-list li{padding:0.5rem 0;border-bottom:1px solid #e5e7eb;}'
          + '.view-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:1rem;}'
          + '.view-grid-item{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:1rem;}'
          + '.view-pager{margin-top:1rem;display:flex;align-items:center;gap:1rem;font-size:0.9rem;}'
          + '.view-pager a{color:#2563eb;text-decoration:none;}'
          + '.view-meta{font-size:0.85rem;color:#6b7280;margin-bottom:1rem;}'
          + '</style></head><body>'
          + '<h1>' + (view.name || 'View') + '</h1>'
          + exposedFilterHtml
          + '<div class="view-meta">' + items.length + ' of ' + (results.total || 0) + ' items</div>'
          + contentHtml
          + pagerHtml
          + '</body></html>';

        server.html(res, pageHtml);
      }, 'View page display: ' + route.viewId + ' at ' + route.path);
    }
  })();

  // ==========================================
  // Block Management
  // ==========================================

  /**
   * GET /admin/blocks - Block list page
   */
  register('GET', '/admin/blocks', async (req, res, params, ctx) => {
    const blockService = ctx.services.get('blocks');
    if (!blockService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Block service not available');
      return;
    }

    const blocks = blockService.listBlocks();
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('block-list.html', {
      pageTitle: 'Blocks',
      blocks,
      hasBlocks: blocks.length > 0,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Block list');

  /**
   * GET /admin/blocks/add - Add block form
   */
  register('GET', '/admin/blocks/add', async (req, res, params, ctx) => {
    const blockService = ctx.services.get('blocks');
    if (!blockService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Block service not available');
      return;
    }

    const html = renderAdmin('block-add.html', {
      pageTitle: 'Add Block',
    }, ctx, req);

    server.html(res, html);
  }, 'Add block form');

  /**
   * POST /admin/blocks/add - Create block
   */
  register('POST', '/admin/blocks/add', async (req, res, params, ctx) => {
    const blockService = ctx.services.get('blocks');
    if (!blockService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Block service not available');
      return;
    }

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);

      const blockData = {
        key: formData.key?.trim(),
        label: formData.label?.trim(),
        content: formData.content?.trim(),
        type: formData.type || 'custom',
        enabled: formData.enabled === 'on',
        weight: parseInt(formData.weight) || 0,
      };

      if (!blockData.key || !blockData.label) {
        redirect(res, '/admin/blocks/add?error=' + encodeURIComponent('Key and label required'));
        return;
      }

      const block = blockService.createBlock(blockData);
      redirect(res, '/admin/blocks?success=' + encodeURIComponent(`Block created: ${block.label}`));
    } catch (error) {
      redirect(res, '/admin/blocks/add?error=' + encodeURIComponent(error.message));
    }
  }, 'Create block');

  /**
   * GET /admin/blocks/:id - Edit block form
   */
  register('GET', '/admin/blocks/:id', async (req, res, params, ctx) => {
    const { id } = params;
    const blockService = ctx.services.get('blocks');
    if (!blockService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Block service not available');
      return;
    }

    const block = blockService.getBlock(id);
    if (!block) {
      redirect(res, '/admin/blocks?error=' + encodeURIComponent(`Block not found: ${id}`));
      return;
    }

    const html = renderAdmin('block-edit.html', {
      pageTitle: `Edit Block: ${block.label}`,
      block,
    }, ctx, req);

    server.html(res, html);
  }, 'Edit block form');

  /**
   * POST /admin/blocks/:id - Update block
   */
  register('POST', '/admin/blocks/:id', async (req, res, params, ctx) => {
    const { id } = params;
    const blockService = ctx.services.get('blocks');
    if (!blockService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Block service not available');
      return;
    }

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);

      const updates = {
        label: formData.label?.trim(),
        content: formData.content?.trim(),
        type: formData.type || 'custom',
        enabled: formData.enabled === 'on',
        weight: parseInt(formData.weight) || 0,
      };

      if (!updates.label) {
        redirect(res, `/admin/blocks/${id}?error=` + encodeURIComponent('Label required'));
        return;
      }

      blockService.updateBlock(id, updates);
      redirect(res, '/admin/blocks?success=' + encodeURIComponent(`Block updated: ${updates.label}`));
    } catch (error) {
      redirect(res, `/admin/blocks/${id}?error=` + encodeURIComponent(error.message));
    }
  }, 'Update block');

  /**
   * POST /admin/blocks/:id/delete - Delete block
   */
  register('POST', '/admin/blocks/:id/delete', async (req, res, params, ctx) => {
    const { id } = params;
    const blockService = ctx.services.get('blocks');
    if (!blockService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Block service not available');
      return;
    }

    try {
      const block = blockService.getBlock(id);
      const blockLabel = block ? block.label : id;

      blockService.deleteBlock(id);
      redirect(res, '/admin/blocks?success=' + encodeURIComponent(`Block deleted: ${blockLabel}`));
    } catch (error) {
      redirect(res, '/admin/blocks?error=' + encodeURIComponent(error.message));
    }
  }, 'Delete block');

  /**
   * GET /admin/regions - Region management
   */
  register('GET', '/admin/regions', async (req, res, params, ctx) => {
    const blockService = ctx.services.get('blocks');
    if (!blockService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Block service not available');
      return;
    }

    const regions = blockService.listRegions();
    const blocks = blockService.listBlocks();
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('regions.html', {
      pageTitle: 'Regions',
      regions,
      hasRegions: regions.length > 0,
      blocks,
      hasBlocks: blocks.length > 0,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Region management');

  /**
   * POST /admin/blocks/:id/assign - Assign to region
   */
  register('POST', '/admin/blocks/:id/assign', async (req, res, params, ctx) => {
    const { id } = params;
    const blockService = ctx.services.get('blocks');
    if (!blockService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Block service not available');
      return;
    }

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const region = formData.region?.trim();

      if (!region) {
        redirect(res, '/admin/regions?error=' + encodeURIComponent('Region required'));
        return;
      }

      blockService.assignBlockToRegion(id, region);
      redirect(res, '/admin/regions?success=' + encodeURIComponent(`Block assigned to region: ${region}`));
    } catch (error) {
      redirect(res, '/admin/regions?error=' + encodeURIComponent(error.message));
    }
  }, 'Assign block to region');

  // ==========================================
  // Tokens
  // ==========================================

  /**
   * GET /admin/tokens - Token browser UI
   */
  register('GET', '/admin/tokens', async (req, res, params, ctx) => {
    const tokenService = ctx.services.get('token');
    if (!tokenService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Token service not available');
      return;
    }

    const tokens = tokenService.getTokens();
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('token-browser.html', {
      pageTitle: 'Tokens',
      tokens,
      hasTokens: tokens && tokens.length > 0,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Token browser');

  // ==========================================
  // Text Formats
  // ==========================================

  /**
   * GET /admin/text-formats - List text formats
   */
  register('GET', '/admin/text-formats', async (req, res, params, ctx) => {
    const formatService = ctx.services.get('text_format');
    if (!formatService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Text format service not available');
      return;
    }

    const formats = formatService.listFormats();
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('text-format-list.html', {
      pageTitle: 'Text Formats',
      formats,
      hasFormats: formats.length > 0,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'List text formats');

  /**
   * GET /admin/text-formats/new - Create format form
   */
  register('GET', '/admin/text-formats/new', async (req, res, params, ctx) => {
    const html = renderAdmin('text-format-form.html', {
      pageTitle: 'Create Text Format',
      isNew: true,
    }, ctx, req);

    server.html(res, html);
  }, 'Create text format form');

  /**
   * POST /admin/text-formats - Create format
   */
  register('POST', '/admin/text-formats', async (req, res, params, ctx) => {
    const formatService = ctx.services.get('text_format');
    if (!formatService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Text format service not available');
      return;
    }

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const formatData = {
        id: formData.id?.trim(),
        name: formData.name?.trim(),
        filters: formData.filters ? JSON.parse(formData.filters) : [],
      };

      formatService.createFormat(formatData);
      redirect(res, '/admin/text-formats?success=' + encodeURIComponent(`Format created: ${formatData.name}`));
    } catch (error) {
      redirect(res, '/admin/text-formats/new?error=' + encodeURIComponent(error.message));
    }
  }, 'Create text format');

  /**
   * GET /admin/text-formats/:id - Edit format form
   */
  register('GET', '/admin/text-formats/:id', async (req, res, params, ctx) => {
    const { id } = params;
    const formatService = ctx.services.get('text_format');
    if (!formatService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Text format service not available');
      return;
    }

    const format = formatService.getFormat(id);
    if (!format) {
      redirect(res, '/admin/text-formats?error=' + encodeURIComponent(`Format not found: ${id}`));
      return;
    }

    const html = renderAdmin('text-format-form.html', {
      pageTitle: `Edit Format: ${format.name}`,
      format,
      filtersJson: JSON.stringify(format.filters || [], null, 2),
    }, ctx, req);

    server.html(res, html);
  }, 'Edit text format form');

  /**
   * POST /admin/text-formats/:id - Update format
   */
  register('POST', '/admin/text-formats/:id', async (req, res, params, ctx) => {
    const { id } = params;
    const formatService = ctx.services.get('text_format');
    if (!formatService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Text format service not available');
      return;
    }

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const updates = {
        name: formData.name?.trim(),
        filters: formData.filters ? JSON.parse(formData.filters) : [],
      };

      formatService.updateFormat(id, updates);
      redirect(res, '/admin/text-formats?success=' + encodeURIComponent(`Format updated: ${updates.name}`));
    } catch (error) {
      redirect(res, `/admin/text-formats/${id}?error=` + encodeURIComponent(error.message));
    }
  }, 'Update text format');

  /**
   * POST /admin/text-formats/:id/delete - Delete format
   */
  register('POST', '/admin/text-formats/:id/delete', async (req, res, params, ctx) => {
    const { id } = params;
    const formatService = ctx.services.get('text_format');
    if (!formatService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Text format service not available');
      return;
    }

    try {
      formatService.deleteFormat(id);
      redirect(res, '/admin/text-formats?success=' + encodeURIComponent(`Format deleted: ${id}`));
    } catch (error) {
      redirect(res, '/admin/text-formats?error=' + encodeURIComponent(error.message));
    }
  }, 'Delete text format');

  // ==========================================
  // Content Types
  // ==========================================

  /**
   * GET /admin/structure/types - List content types
   */
  register('GET', '/admin/structure/types', async (req, res, params, ctx) => {
    const types = content.listTypes().map(t => ({
      ...t,
      fieldCount: Object.keys(t.schema || {}).length,
    }));
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('content-types-list.html', {
      pageTitle: 'Content Types',
      types,
      hasTypes: types.length > 0,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'List content types');

  /**
   * GET /admin/structure/types/new - Create content type form
   */
  register('GET', '/admin/structure/types/new', async (req, res, params, ctx) => {
    const html = renderAdmin('content-types-edit.html', {
      pageTitle: 'Create Content Type',
      isNew: true,
    }, ctx, req);

    server.html(res, html);
  }, 'Create content type form');

  /**
   * POST /admin/structure/types - Create content type
   */
  register('POST', '/admin/structure/types', async (req, res, params, ctx) => {
    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const typeData = {
        type: formData.type?.trim(),
        schema: formData.schema ? JSON.parse(formData.schema) : {},
      };

      content.registerType(typeData.type, typeData.schema);
      redirect(res, '/admin/structure/types?success=' + encodeURIComponent(`Content type created: ${typeData.type}`));
    } catch (error) {
      redirect(res, '/admin/structure/types/new?error=' + encodeURIComponent(error.message));
    }
  }, 'Create content type');

  /**
   * GET /admin/structure/types/:type - Edit content type form
   */
  register('GET', '/admin/structure/types/:type', async (req, res, params, ctx) => {
    const { type } = params;
    if (!content.hasType(type)) {
      redirect(res, '/admin/structure/types?error=' + encodeURIComponent(`Content type not found: ${type}`));
      return;
    }

    const schema = content.getSchema(type);
    const html = renderAdmin('content-types-edit.html', {
      pageTitle: `Edit Content Type: ${type}`,
      type,
      schemaJson: JSON.stringify(schema, null, 2),
    }, ctx, req);

    server.html(res, html);
  }, 'Edit content type form');

  /**
   * POST /admin/structure/types/:type - Update content type
   */
  register('POST', '/admin/structure/types/:type', async (req, res, params, ctx) => {
    const { type } = params;
    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const schema = formData.schema ? JSON.parse(formData.schema) : {};

      content.registerType(type, schema);
      redirect(res, '/admin/structure/types?success=' + encodeURIComponent(`Content type updated: ${type}`));
    } catch (error) {
      redirect(res, `/admin/structure/types/${type}?error=` + encodeURIComponent(error.message));
    }
  }, 'Update content type');

  /**
   * POST /admin/structure/types/:type/delete - Delete content type
   */
  register('POST', '/admin/structure/types/:type/delete', async (req, res, params, ctx) => {
    const { type } = params;
    try {
      content.deleteType(type);
      redirect(res, '/admin/structure/types?success=' + encodeURIComponent(`Content type deleted: ${type}`));
    } catch (error) {
      redirect(res, '/admin/structure/types?error=' + encodeURIComponent(error.message));
    }
  }, 'Delete content type');

  /**
   * GET /admin/structure/types/:type/fields - Manage fields
   */
  register('GET', '/admin/structure/types/:type/fields', async (req, res, params, ctx) => {
    const { type } = params;
    if (!content.hasType(type)) {
      redirect(res, '/admin/structure/types?error=' + encodeURIComponent(`Content type not found: ${type}`));
      return;
    }

    const schema = content.getSchema(type);
    const fields = Object.entries(schema).map(([name, def]) => ({
      name,
      type: def.type,
      required: def.required,
    }));

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('content-types-fields.html', {
      pageTitle: `Manage Fields: ${type}`,
      type,
      fields,
      hasFields: fields.length > 0,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Manage content type fields');

  /**
   * POST /admin/structure/types/:type/fields - Add field
   */
  register('POST', '/admin/structure/types/:type/fields', async (req, res, params, ctx) => {
    const { type } = params;
    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const fieldName = formData.name?.trim();
      const fieldDef = {
        type: formData.type?.trim(),
        required: formData.required === 'on',
      };

      const schema = content.getSchema(type);
      schema[fieldName] = fieldDef;
      content.registerType(type, schema);

      redirect(res, `/admin/structure/types/${type}/fields?success=` + encodeURIComponent(`Field added: ${fieldName}`));
    } catch (error) {
      redirect(res, `/admin/structure/types/${type}/fields?error=` + encodeURIComponent(error.message));
    }
  }, 'Add field to content type');

  /**
   * GET /admin/structure/types/:type/fields/:field - Edit field
   */
  register('GET', '/admin/structure/types/:type/fields/:field', async (req, res, params, ctx) => {
    const { type, field } = params;
    if (!content.hasType(type)) {
      redirect(res, '/admin/structure/types?error=' + encodeURIComponent(`Content type not found: ${type}`));
      return;
    }

    const schema = content.getSchema(type);
    const fieldDef = schema[field];
    if (!fieldDef) {
      redirect(res, `/admin/structure/types/${type}/fields?error=` + encodeURIComponent(`Field not found: ${field}`));
      return;
    }

    const html = renderAdmin('content-types-field-edit.html', {
      pageTitle: `Edit Field: ${field}`,
      type,
      field,
      fieldDef,
    }, ctx, req);

    server.html(res, html);
  }, 'Edit content type field');

  /**
   * POST /admin/structure/types/:type/fields/:field - Update field
   */
  register('POST', '/admin/structure/types/:type/fields/:field', async (req, res, params, ctx) => {
    const { type, field } = params;
    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const fieldDef = {
        type: formData.type?.trim(),
        required: formData.required === 'on',
      };

      const schema = content.getSchema(type);
      schema[field] = fieldDef;
      content.registerType(type, schema);

      redirect(res, `/admin/structure/types/${type}/fields?success=` + encodeURIComponent(`Field updated: ${field}`));
    } catch (error) {
      redirect(res, `/admin/structure/types/${type}/fields/${field}?error=` + encodeURIComponent(error.message));
    }
  }, 'Update content type field');

  /**
   * POST /admin/structure/types/:type/fields/:field/delete - Remove field
   */
  register('POST', '/admin/structure/types/:type/fields/:field/delete', async (req, res, params, ctx) => {
    const { type, field } = params;
    try {
      const schema = content.getSchema(type);
      delete schema[field];
      content.registerType(type, schema);

      redirect(res, `/admin/structure/types/${type}/fields?success=` + encodeURIComponent(`Field deleted: ${field}`));
    } catch (error) {
      redirect(res, `/admin/structure/types/${type}/fields?error=` + encodeURIComponent(error.message));
    }
  }, 'Delete content type field');

  /**
   * GET /admin/structure/types/:type/display - Manage display
   */
  register('GET', '/admin/structure/types/:type/display', async (req, res, params, ctx) => {
    const { type } = params;
    if (!content.hasType(type)) {
      redirect(res, '/admin/structure/types?error=' + encodeURIComponent(`Content type not found: ${type}`));
      return;
    }

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('content-type-display.html', {
      pageTitle: `Manage Display: ${type}`,
      type,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Manage content type display');

  /**
   * POST /admin/structure/types/:type/display/:mode - Save display
   */
  register('POST', '/admin/structure/types/:type/display/:mode', async (req, res, params, ctx) => {
    const { type, mode } = params;
    try {
      const formData = ctx._parsedBody || await parseFormBody(req);

      redirect(res, `/admin/structure/types/${type}/display?success=` + encodeURIComponent(`Display mode saved: ${mode}`));
    } catch (error) {
      redirect(res, `/admin/structure/types/${type}/display?error=` + encodeURIComponent(error.message));
    }
  }, 'Save content type display');

  // ==========================================
  // Actions & Rules
  // ==========================================

  /**
   * GET /admin/config/actions - List actions
   */
  register('GET', '/admin/config/actions', async (req, res, params, ctx) => {
    const actionsService = ctx.services.get('actions');
    if (!actionsService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Actions service not available');
      return;
    }

    const actions = actionsService.getActions ? actionsService.getActions() : [];
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('actions-list.html', {
      pageTitle: 'Actions',
      actions,
      hasActions: actions && actions.length > 0,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'List actions');

  /**
   * GET /admin/config/rules - List rules
   */
  register('GET', '/admin/config/rules', async (req, res, params, ctx) => {
    const actionsService = ctx.services.get('actions');
    if (!actionsService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Actions service not available');
      return;
    }

    const rules = actionsService.getRules ? actionsService.getRules() : [];
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('rules-list.html', {
      pageTitle: 'Rules',
      rules,
      hasRules: rules && rules.length > 0,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'List rules');

  /**
   * GET /admin/config/rules/new - Create rule form
   */
  register('GET', '/admin/config/rules/new', async (req, res, params, ctx) => {
    const html = renderAdmin('rule-form.html', {
      pageTitle: 'Create Rule',
      isNew: true,
    }, ctx, req);

    server.html(res, html);
  }, 'Create rule form');

  /**
   * POST /admin/config/rules - Create rule
   */
  register('POST', '/admin/config/rules', async (req, res, params, ctx) => {
    const ruleService = ctx.services.get('actions');
    if (!ruleService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Rule service not available');
      return;
    }

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const ruleData = {
        id: formData.id?.trim(),
        name: formData.name?.trim(),
        event: formData.event?.trim(),
        conditions: formData.conditions ? JSON.parse(formData.conditions) : [],
        actions: formData.actions ? JSON.parse(formData.actions) : [],
      };

      ruleService.createRule(ruleData);
      redirect(res, '/admin/config/rules?success=' + encodeURIComponent(`Rule created: ${ruleData.name}`));
    } catch (error) {
      redirect(res, '/admin/config/rules/new?error=' + encodeURIComponent(error.message));
    }
  }, 'Create rule');

  /**
   * GET /admin/config/rules/:id - Edit rule form
   */
  register('GET', '/admin/config/rules/:id', async (req, res, params, ctx) => {
    const { id } = params;
    const ruleService = ctx.services.get('actions');
    if (!ruleService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Rule service not available');
      return;
    }

    const rule = ruleService.getRule(id);
    if (!rule) {
      redirect(res, '/admin/config/rules?error=' + encodeURIComponent(`Rule not found: ${id}`));
      return;
    }

    const html = renderAdmin('rule-form.html', {
      pageTitle: `Edit Rule: ${rule.name}`,
      rule,
      conditionsJson: JSON.stringify(rule.conditions || [], null, 2),
      actionsJson: JSON.stringify(rule.actions || [], null, 2),
    }, ctx, req);

    server.html(res, html);
  }, 'Edit rule form');

  /**
   * POST /admin/config/rules/:id - Update rule
   */
  register('POST', '/admin/config/rules/:id', async (req, res, params, ctx) => {
    const { id } = params;
    const ruleService = ctx.services.get('actions');
    if (!ruleService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Rule service not available');
      return;
    }

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const updates = {
        name: formData.name?.trim(),
        event: formData.event?.trim(),
        conditions: formData.conditions ? JSON.parse(formData.conditions) : [],
        actions: formData.actions ? JSON.parse(formData.actions) : [],
      };

      ruleService.updateRule(id, updates);
      redirect(res, '/admin/config/rules?success=' + encodeURIComponent(`Rule updated: ${updates.name}`));
    } catch (error) {
      redirect(res, `/admin/config/rules/${id}?error=` + encodeURIComponent(error.message));
    }
  }, 'Update rule');

  /**
   * POST /admin/config/rules/:id/delete - Delete rule
   */
  register('POST', '/admin/config/rules/:id/delete', async (req, res, params, ctx) => {
    const { id } = params;
    const ruleService = ctx.services.get('actions');
    if (!ruleService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Rule service not available');
      return;
    }

    try {
      ruleService.deleteRule(id);
      redirect(res, '/admin/config/rules?success=' + encodeURIComponent(`Rule deleted: ${id}`));
    } catch (error) {
      redirect(res, '/admin/config/rules?error=' + encodeURIComponent(error.message));
    }
  }, 'Delete rule');

  // ==========================================
  // User Fields
  // ==========================================

  /**
   * GET /admin/config/user-fields - List profile fields
   */
  register('GET', '/admin/config/user-fields', async (req, res, params, ctx) => {
    const userService = ctx.services.get('user');
    if (!userService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('User service not available');
      return;
    }

    const fields = userService.listCustomFields ? userService.listCustomFields() : [];
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('user-field-list.html', {
      pageTitle: 'User Profile Fields',
      fields,
      hasFields: fields.length > 0,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'List user profile fields');

  /**
   * GET /admin/config/user-fields/new - Add field form
   */
  register('GET', '/admin/config/user-fields/new', async (req, res, params, ctx) => {
    const html = renderAdmin('user-field-form.html', {
      pageTitle: 'Add User Field',
      isNew: true,
    }, ctx, req);

    server.html(res, html);
  }, 'Add user field form');

  /**
   * POST /admin/config/user-fields - Create field
   */
  register('POST', '/admin/config/user-fields', async (req, res, params, ctx) => {
    const userService = ctx.services.get('user');
    if (!userService || !userService.addCustomField) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('User field management not available');
      return;
    }

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const fieldData = {
        name: formData.name?.trim(),
        type: formData.type?.trim(),
        label: formData.label?.trim(),
        required: formData.required === 'on',
      };

      userService.addCustomField(fieldData);
      redirect(res, '/admin/config/user-fields?success=' + encodeURIComponent(`Field added: ${fieldData.label}`));
    } catch (error) {
      redirect(res, '/admin/config/user-fields/new?error=' + encodeURIComponent(error.message));
    }
  }, 'Create user field');

  /**
   * GET /admin/config/user-fields/:name - Edit field form
   */
  register('GET', '/admin/config/user-fields/:name', async (req, res, params, ctx) => {
    const { name } = params;
    const userService = ctx.services.get('user');
    if (!userService || !userService.getCustomField) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('User field management not available');
      return;
    }

    const field = userService.getCustomField(name);
    if (!field) {
      redirect(res, '/admin/config/user-fields?error=' + encodeURIComponent(`Field not found: ${name}`));
      return;
    }

    const html = renderAdmin('user-field-form.html', {
      pageTitle: `Edit User Field: ${field.label}`,
      field,
    }, ctx, req);

    server.html(res, html);
  }, 'Edit user field form');

  /**
   * POST /admin/config/user-fields/:name - Update field
   */
  register('POST', '/admin/config/user-fields/:name', async (req, res, params, ctx) => {
    const { name } = params;
    const userService = ctx.services.get('user');
    if (!userService || !userService.updateCustomField) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('User field management not available');
      return;
    }

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const updates = {
        type: formData.type?.trim(),
        label: formData.label?.trim(),
        required: formData.required === 'on',
      };

      userService.updateCustomField(name, updates);
      redirect(res, '/admin/config/user-fields?success=' + encodeURIComponent(`Field updated: ${updates.label}`));
    } catch (error) {
      redirect(res, `/admin/config/user-fields/${name}?error=` + encodeURIComponent(error.message));
    }
  }, 'Update user field');

  /**
   * POST /admin/config/user-fields/:name/delete - Delete field
   */
  register('POST', '/admin/config/user-fields/:name/delete', async (req, res, params, ctx) => {
    const { name } = params;
    const userService = ctx.services.get('user');
    if (!userService || !userService.deleteCustomField) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('User field management not available');
      return;
    }

    try {
      userService.deleteCustomField(name);
      redirect(res, '/admin/config/user-fields?success=' + encodeURIComponent(`Field deleted: ${name}`));
    } catch (error) {
      redirect(res, '/admin/config/user-fields?error=' + encodeURIComponent(error.message));
    }
  }, 'Delete user field');

  // ==========================================
  // Theme Settings
  // ==========================================

  /**
   * GET /admin/appearance - List themes
   */
  register('GET', '/admin/appearance', async (req, res, params, ctx) => {
    const themeEngine = ctx.services.get('themeEngine');
    if (!themeEngine) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Theme engine not available');
      return;
    }

    // Get layouts and skins from theme engine
    const layouts = themeEngine.listLayouts ? themeEngine.listLayouts() : [];
    const skins = themeEngine.listSkins ? themeEngine.listSkins() : [];
    const activeTheme = themeEngine.getActiveTheme ? themeEngine.getActiveTheme() : {};

    // Combine layouts and skins into theme entries for display
    const themes = layouts.map(layout => ({
      name: layout.id || layout.name,
      description: layout.description || '',
      version: layout.version,
      isActive: activeTheme.layout === (layout.id || layout.name),
      skins: skins.filter(s => !s.layoutId || s.layoutId === layout.id),
    }));

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('theme-list.html', {
      pageTitle: 'Appearance',
      themes,
      hasThemes: themes.length > 0,
      activeTheme,
      layouts,
      skins,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'List themes');

  /**
   * GET /admin/appearance/:theme/settings - Theme settings form
   */
  register('GET', '/admin/appearance/:theme/settings', async (req, res, params, ctx) => {
    const { theme } = params;
    const themeService = ctx.services.get('themeEngine');
    if (!themeService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Theme service not available');
      return;
    }

    const settings = themeService.getSettings ? themeService.getSettings(theme) : {};
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('theme-settings.html', {
      pageTitle: `Theme Settings: ${theme}`,
      theme,
      settings,
      settingsJson: JSON.stringify(settings, null, 2),
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Theme settings form');

  /**
   * POST /admin/appearance/:theme/settings - Save settings
   */
  register('POST', '/admin/appearance/:theme/settings', async (req, res, params, ctx) => {
    const { theme } = params;
    const themeService = ctx.services.get('themeEngine');
    if (!themeService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Theme service not available');
      return;
    }

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const settings = formData.settings ? JSON.parse(formData.settings) : {};

      if (themeService.saveSettings) {
        themeService.saveSettings(theme, settings);
      }

      redirect(res, `/admin/appearance/${theme}/settings?success=` + encodeURIComponent('Settings saved'));
    } catch (error) {
      redirect(res, `/admin/appearance/${theme}/settings?error=` + encodeURIComponent(error.message));
    }
  }, 'Save theme settings');

  /**
   * POST /admin/appearance/:theme/activate - Activate theme
   */
  register('POST', '/admin/appearance/:theme/activate', async (req, res, params, ctx) => {
    const { theme } = params;
    const themeService = ctx.services.get('themeEngine');
    if (!themeService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Theme service not available');
      return;
    }

    try {
      if (themeService.activateTheme) {
        themeService.activateTheme(theme);
      }
      ctx.config.site.theme = theme;

      redirect(res, '/admin/appearance?success=' + encodeURIComponent(`Theme activated: ${theme}`));
    } catch (error) {
      redirect(res, '/admin/appearance?error=' + encodeURIComponent(error.message));
    }
  }, 'Activate theme');

  // ==========================================
  // Theme Engine (Layouts + Skins)
  // ==========================================

  /**
   * GET /admin/appearance/layouts - Layout + Skin manager
   */
  register('GET', '/admin/appearance/layouts', async (req, res, params, ctx) => {
    const engine = ctx.services.get('themeEngine');
    if (!engine) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Theme engine not available');
      return;
    }

    const layouts = engine.listLayouts();
    const skins = engine.listSkins();
    const adminSkins = engine.listAdminSkins();
    const activeTheme = engine.getActiveTheme();
    const activeAdminSkin = engine.getActiveAdminSkin();
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('theme-engine.html', {
      pageTitle: 'Layouts & Skins',
      layouts,
      skins,
      adminSkins,
      activeLayout: activeTheme.layout?.id,
      activeSkin: activeTheme.skin?.id,
      activeAdminSkin: activeAdminSkin?.id,
      hasLayouts: layouts.length > 0,
      hasSkins: skins.length > 0,
      hasAdminSkins: adminSkins.length > 0,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Layout and skin manager');

  /**
   * POST /admin/appearance/layouts - Set layout + skin
   */
  register('POST', '/admin/appearance/layouts', async (req, res, params, ctx) => {
    const engine = ctx.services.get('themeEngine');
    if (!engine) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Theme engine not available');
      return;
    }

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const { layout, skin, adminSkin } = formData;

      if (layout && skin) {
        engine.setActiveTheme(layout, skin, true); // persist to site.json
      }
      if (adminSkin) {
        engine.setAdminSkin(adminSkin, true); // persist to site.json
      }

      redirect(res, '/admin/appearance/layouts?success=' + encodeURIComponent('Theme updated and saved'));
    } catch (error) {
      redirect(res, '/admin/appearance/layouts?error=' + encodeURIComponent(error.message));
    }
  }, 'Update layout and skin');

  /**
   * GET /admin/appearance/layouts/preview/:layout/:skin - Preview layout + skin
   */
  register('GET', '/admin/appearance/layouts/preview/:layout/:skin', async (req, res, params, ctx) => {
    const engine = ctx.services.get('themeEngine');
    if (!engine) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Theme engine not available');
      return;
    }

    const { layout, skin } = params;
    const layoutData = engine.getLayout(layout);
    const skinData = engine.getSkin(skin);

    if (!layoutData || !skinData) {
      redirect(res, '/admin/appearance/layouts?error=' + encodeURIComponent('Layout or skin not found'));
      return;
    }

    const cssPaths = engine.getSkinCSSPaths(skin);

    // Simple preview page
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Preview: ${layoutData.name} + ${skinData.name}</title>
  ${cssPaths.map(p => `<link rel="stylesheet" href="${p}">`).join('\n  ')}
  <style>
    body { margin: 0; padding: 2rem; }
    .preview-header { 
      padding: 1rem; 
      background: var(--color-surface, #f0f0f0); 
      border-radius: var(--radius-md, 8px);
      margin-bottom: 1rem;
    }
    .preview-content {
      padding: 2rem;
      background: var(--color-bg, #fff);
      border: 1px solid var(--color-border, #ddd);
      border-radius: var(--radius-md, 8px);
    }
    h1 { color: var(--color-primary, #333); }
    p { color: var(--color-text, #666); }
    .preview-actions {
      margin-top: 2rem;
      padding-top: 1rem;
      border-top: 1px solid var(--color-border, #ddd);
    }
    .preview-actions a {
      display: inline-block;
      padding: 0.5rem 1rem;
      background: var(--color-primary, #007bff);
      color: white;
      text-decoration: none;
      border-radius: var(--radius-sm, 4px);
      margin-right: 0.5rem;
    }
  </style>
</head>
<body>
  <div class="preview-header">
    <strong>Layout:</strong> ${layoutData.name} | 
    <strong>Skin:</strong> ${skinData.name} |
    <strong>Regions:</strong> ${layoutData.regions.join(', ')}
  </div>
  <div class="preview-content">
    <h1>Sample Heading</h1>
    <p>This is a preview of the <strong>${skinData.name}</strong> skin applied to the <strong>${layoutData.name}</strong> layout.</p>
    <p>The CSS variables from this skin are being applied to style this preview.</p>
    <div class="preview-actions">
      <a href="/admin/appearance/layouts">← Back to Layouts</a>
      <a href="/admin/appearance/layouts" onclick="document.getElementById('apply-form').submit(); return false;">Apply This Theme</a>
      <form id="apply-form" method="POST" action="/admin/appearance/layouts" style="display:none;">
        <input type="hidden" name="layout" value="${layout}">
        <input type="hidden" name="skin" value="${skin}">
      </form>
    </div>
  </div>
</body>
</html>`;

    server.html(res, html);
  }, 'Preview layout + skin');

  // ==========================================
  // Batch Operations
  // ==========================================

  /**
   * GET /admin/batch/:id - Batch progress page
   */
  register('GET', '/admin/batch/:id', async (req, res, params, ctx) => {
    const { id } = params;
    const batchService = ctx.services.get('batch');
    if (!batchService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Batch service not available');
      return;
    }

    const batch = batchService.getBatch ? batchService.getBatch(id) : null;
    if (!batch) {
      redirect(res, '/admin?error=' + encodeURIComponent(`Batch not found: ${id}`));
      return;
    }

    const html = renderAdmin('batch-progress.html', {
      pageTitle: 'Batch Operation',
      batch,
      progress: batch.progress || 0,
      isComplete: batch.status === 'complete',
      hasError: batch.status === 'error',
    }, ctx, req);

    server.html(res, html);
  }, 'Batch progress');

  // ==========================================
  // System Status
  // ==========================================

  /**
   * GET /admin/reports/status - Status report
   */
  register('GET', '/admin/reports/status', async (req, res, params, ctx) => {
    const statusService = ctx.services.get('status');
    const report = statusService && statusService.getReport ? statusService.getReport() : {
      checks: [],
      overall: 'unknown',
    };

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('status-report.html', {
      pageTitle: 'Status Report',
      report,
      hasChecks: report.checks && report.checks.length > 0,
      isHealthy: report.overall === 'ok',
      hasWarnings: report.overall === 'warning',
      hasErrors: report.overall === 'error',
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Status report');

  // ==========================================
  // Help System
  // ==========================================

  /**
   * GET /admin/help - Help index
   */
  register('GET', '/admin/help', async (req, res, params, ctx) => {
    const helpService = ctx.services.get('help');
    const topics = helpService && helpService.listTopics ? helpService.listTopics() : [];
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('help-index.html', {
      pageTitle: 'Help',
      topics,
      hasTopics: topics.length > 0,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Help index');

  /**
   * GET /admin/help/:topic - Help topic
   */
  register('GET', '/admin/help/:topic', async (req, res, params, ctx) => {
    const { topic } = params;
    const helpService = ctx.services.get('help');
    if (!helpService || !helpService.getTopic) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Help service not available');
      return;
    }

    const content = helpService.getTopic(topic);
    if (!content) {
      redirect(res, '/admin/help?error=' + encodeURIComponent(`Topic not found: ${topic}`));
      return;
    }

    const html = renderAdmin('help-topic.html', {
      pageTitle: `Help: ${topic}`,
      topic,
      content,
    }, ctx, req);

    server.html(res, html);
  }, 'Help topic');

  // ========================================
  // LAYOUT BUILDER ADMIN ROUTES
  // ========================================

  /**
   * GET /admin/layout - Layout Builder dashboard
   */
  register('GET', '/admin/layout', async (req, res, params, ctx) => {
    const layoutBuilder = ctx.services.get('layoutBuilder');

    if (!layoutBuilder) {
      redirect(res, '/admin?error=' + encodeURIComponent('Layout Builder not enabled'));
      return;
    }

    const layouts = layoutBuilder.listLayouts();
    const categories = layoutBuilder.listCategories();
    const defaultLayoutTypes = layoutBuilder.listDefaultLayouts();
    const stats = layoutBuilder.getStats();
    const contentTypes = content.listTypes().map(t => t.type);

    // Pre-render layouts HTML since nested iteration is complex for template engine
    // WHY: Template engine supports {{#each}} but nested each with object-to-array
    // conversion for regions is fragile. Pre-rendering guarantees correct output.
    let layoutsHtml = '';
    for (const cat of categories) {
      const catLayouts = layouts.filter(l => l.category === cat);
      layoutsHtml += `<div class="category-section"><h3>${cat}</h3><div class="layout-grid">`;
      for (const l of catLayouts) {
        const regionSpans = Object.entries(l.regions)
          .map(([id, r]) => `<span>${r.label || id}</span>`)
          .join(' ');
        layoutsHtml += `<div class="layout-card">
          <h4>${l.label}</h4>
          <p>${l.description || ''}</p>
          <p><strong>ID:</strong> <code>${l.id}</code></p>
          <div class="layout-regions"><strong>Regions:</strong> ${regionSpans}</div>
        </div>`;
      }
      layoutsHtml += '</div></div>';
    }

    // Get default layout info for each content type
    const defaultLayoutInfo = defaultLayoutTypes.map(type => {
      const layout = layoutBuilder.getDefaultLayout(type);
      return {
        type,
        sectionCount: layout?.sections?.length || 0,
        componentCount: (layout?.sections || []).reduce((acc, s) =>
          acc + Object.values(s.components || {}).flat().length, 0),
      };
    });

    // Convert content types to objects for {{#each}} template iteration
    const contentTypeOptions = contentTypes.map(t => ({ value: t, label: t }));

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('layout-builder.html', {
      pageTitle: 'Layout Builder',
      layoutsHtml,
      hasLayouts: layouts.length > 0,
      defaultLayoutInfo,
      hasDefaults: defaultLayoutInfo.length > 0,
      noDefaults: defaultLayoutInfo.length === 0,
      contentTypeOptions,
      stats,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Layout Builder dashboard');

  /**
   * GET /admin/layout/defaults/:type - Manage default layout for content type
   */
  register('GET', '/admin/layout/defaults/:type', async (req, res, params, ctx) => {
    const { type } = params;
    const layoutBuilder = ctx.services.get('layoutBuilder');
    const blocksService = ctx.services.get('blocks');

    if (!layoutBuilder) {
      redirect(res, '/admin?error=' + encodeURIComponent('Layout Builder not enabled'));
      return;
    }

    const storage = layoutBuilder.getDefaultLayout(type) || { sections: [] };
    const layouts = layoutBuilder.listLayouts();
    const blocks = blocksService ? blocksService.listBlocks({ enabled: true }).items : [];
    const csrfToken = req ? (ctx.services.get('auth')?.getCSRFToken(req) || '') : '';

    // Pre-render sections HTML
    // WHY: Template engine doesn't support deeply nested Mustache-style sections.
    // Pre-rendering in the handler guarantees correct output for sections → regions → components.
    let sectionsHtml = '';
    const sectionsList = storage.sections || [];
    if (sectionsList.length === 0) {
      sectionsHtml = '<div class="empty-section"><p>No sections yet.</p><p>Add a section from the sidebar to start building your layout.</p></div>';
    } else {
      for (let i = 0; i < sectionsList.length; i++) {
        const section = sectionsList[i];
        const layoutDef = layoutBuilder.getLayout(section.layoutId);
        const layoutLabel = layoutDef?.label || section.layoutId;
        const uuidShort = section.uuid.substring(0, 8);

        // Section action buttons (move up/down, remove)
        let actionBtns = '';
        if (i > 0) {
          actionBtns += `<form action="/admin/layout/defaults/${type}/move-section" method="POST" class="inline-form">
            <input type="hidden" name="sectionUuid" value="${section.uuid}">
            <input type="hidden" name="direction" value="up">
            <input type="hidden" name="_csrf" value="${csrfToken}">
            <input type="submit" value="↑" title="Move up">
          </form>`;
        }
        if (i < sectionsList.length - 1) {
          actionBtns += `<form action="/admin/layout/defaults/${type}/move-section" method="POST" class="inline-form">
            <input type="hidden" name="sectionUuid" value="${section.uuid}">
            <input type="hidden" name="direction" value="down">
            <input type="hidden" name="_csrf" value="${csrfToken}">
            <input type="submit" value="↓" title="Move down">
          </form>`;
        }
        actionBtns += `<form action="/admin/layout/defaults/${type}/remove-section" method="POST" class="inline-form" onsubmit="return confirm('Remove this section?')">
          <input type="hidden" name="sectionUuid" value="${section.uuid}">
          <input type="hidden" name="_csrf" value="${csrfToken}">
          <input type="submit" value="×" title="Remove section">
        </form>`;

        // Regions with components
        let regionsHtml = '';
        for (const [regionId, region] of Object.entries(layoutDef?.regions || {})) {
          const components = section.components[regionId] || [];
          let componentsHtml = '';
          if (components.length > 0) {
            for (const comp of components) {
              const typeLabel = comp.type === 'block' ? `Block: ${comp.blockId}` :
                comp.type === 'inline_block' ? `Inline: ${comp.blockType}` :
                comp.type === 'field' ? `Field: ${comp.fieldName}` : comp.type;
              const configStr = comp.configuration && Object.keys(comp.configuration).length > 0
                ? ` <span style="color:#999;font-size:0.8em">[configured]</span>` : '';
              componentsHtml += `<div class="component-item">
                <div class="component-info">
                  <span class="component-type">${typeLabel}</span>${configStr}
                  <span class="component-uuid">(${comp.uuid.substring(0, 8)}...)</span>
                </div>
                <div class="component-actions">
                  <form action="/admin/layout/defaults/${type}/remove-component" method="POST" class="inline-form" onsubmit="return confirm('Remove this component?')">
                    <input type="hidden" name="sectionUuid" value="${section.uuid}">
                    <input type="hidden" name="componentUuid" value="${comp.uuid}">
                    <input type="hidden" name="_csrf" value="${csrfToken}">
                    <button type="submit">×</button>
                  </form>
                </div>
              </div>`;
            }
          } else {
            componentsHtml = '<p style="color: #999; font-size: 0.9em; text-align: center;">Drop blocks here</p>';
          }

          // Add block form for this region
          let addBlockForm = '';
          if (blocks.length > 0) {
            const blockOptions = blocks.map(b =>
              `<option value="${b.id}">${b.adminTitle || b.title || b.id}</option>`
            ).join('');
            addBlockForm = `<form action="/admin/layout/defaults/${type}/add-block" method="POST" style="margin-top: 10px;">
              <input type="hidden" name="sectionUuid" value="${section.uuid}">
              <input type="hidden" name="regionId" value="${regionId}">
              <input type="hidden" name="_csrf" value="${csrfToken}">
              <select name="blockId" style="width: 70%; padding: 4px; font-size: 0.85em;">
                <option value="">Add block...</option>
                ${blockOptions}
              </select>
              <button type="submit" class="btn btn-small" style="padding: 4px 8px;">+</button>
            </form>`;
          }

          regionsHtml += `<div class="region-container">
            <div class="region-header">${region.label || regionId}</div>
            <div class="region-content">
              ${componentsHtml}
              ${addBlockForm}
            </div>
          </div>`;
        }

        sectionsHtml += `<div class="section-card">
          <div class="section-header">
            <h3>${layoutLabel}</h3>
            <div class="section-actions">${actionBtns}</div>
          </div>
          <div class="section-body">
            <small class="component-uuid">UUID: ${uuidShort}...</small>
            <div class="section-regions">${regionsHtml}</div>
          </div>
        </div>`;
      }
    }

    // Pre-render sidebar HTML
    const layoutOptions = layouts.map(l =>
      `<option value="${l.id}">${l.label} (${Object.keys(l.regions).join(', ')})</option>`
    ).join('');

    let blocksListHtml = '';
    if (blocks.length > 0) {
      const blockItems = blocks.map(b =>
        `<li><strong>${b.adminTitle || b.title || b.id}</strong> <span style="color: #999;">(${b.type})</span></li>`
      ).join('');
      blocksListHtml = `<ul style="font-size: 0.9em; padding-left: 20px;">${blockItems}</ul>
        <p style="font-size: 0.85em; color: #666;"><a href="/admin/blocks">Manage Blocks →</a></p>`;
    } else {
      blocksListHtml = '<p style="color: #999; font-size: 0.9em;">No blocks available. <a href="/admin/blocks/add">Create a block</a> first.</p>';
    }

    const sidebarHtml = `<h3>Add Section</h3>
      <form action="/admin/layout/defaults/${type}/add-section" method="POST" class="add-form">
        <input type="hidden" name="_csrf" value="${csrfToken}">
        <label for="layoutId">Layout Template:</label>
        <select name="layoutId" id="layoutId" required>
          <option value="">Select layout...</option>
          ${layoutOptions}
        </select>
        <button type="submit" class="btn btn-primary">Add Section</button>
      </form>
      <hr style="margin: 20px 0;">
      <h3>Available Blocks</h3>
      ${blocksListHtml}
      <div class="danger-zone">
        <h4>Danger Zone</h4>
        <p style="font-size: 0.85em;">Clear all sections from this layout:</p>
        <form action="/admin/layout/defaults/${type}/clear" method="POST" onsubmit="return confirm('Are you sure you want to clear all sections? This cannot be undone.')">
          <input type="hidden" name="_csrf" value="${csrfToken}">
          <button type="submit" class="btn btn-danger">Clear All Sections</button>
        </form>
      </div>`;

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('layout-builder-edit.html', {
      pageTitle: `Layout: ${type}`,
      contentType: type,
      sectionsHtml,
      sidebarHtml,
      lastUpdated: storage.updated ? formatDate(storage.updated) : 'Never',
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Edit content type default layout');

  /**
   * POST /admin/layout/defaults/:type/add-section - Add section
   */
  register('POST', '/admin/layout/defaults/:type/add-section', async (req, res, params, ctx) => {
    const { type } = params;
    const layoutBuilder = ctx.services.get('layoutBuilder');

    if (!layoutBuilder) {
      redirect(res, '/admin?error=' + encodeURIComponent('Layout Builder not enabled'));
      return;
    }

    try {
      const body = ctx._parsedBody || await parseFormBody(req);
      const layoutId = body.layoutId;

      if (!layoutId) {
        redirect(res, `/admin/layout/defaults/${type}?error=` + encodeURIComponent('Layout is required'));
        return;
      }

      let storage = layoutBuilder.getDefaultLayout(type) || { sections: [] };
      const section = layoutBuilder.createSection(layoutId);
      storage = layoutBuilder.addSection(storage, section);
      await layoutBuilder.setDefaultLayout(type, storage);

      redirect(res, `/admin/layout/defaults/${type}?success=` + encodeURIComponent('Section added'));
    } catch (error) {
      redirect(res, `/admin/layout/defaults/${type}?error=` + encodeURIComponent(error.message));
    }
  }, 'Add section to layout');

  /**
   * POST /admin/layout/defaults/:type/remove-section - Remove section
   */
  register('POST', '/admin/layout/defaults/:type/remove-section', async (req, res, params, ctx) => {
    const { type } = params;
    const layoutBuilder = ctx.services.get('layoutBuilder');

    if (!layoutBuilder) {
      redirect(res, '/admin?error=' + encodeURIComponent('Layout Builder not enabled'));
      return;
    }

    try {
      const body = ctx._parsedBody || await parseFormBody(req);
      const sectionUuid = body.sectionUuid;

      let storage = layoutBuilder.getDefaultLayout(type);
      if (!storage) {
        redirect(res, `/admin/layout/defaults/${type}?error=` + encodeURIComponent('No layout found'));
        return;
      }

      storage = layoutBuilder.removeSection(storage, sectionUuid);
      await layoutBuilder.setDefaultLayout(type, storage);

      redirect(res, `/admin/layout/defaults/${type}?success=` + encodeURIComponent('Section removed'));
    } catch (error) {
      redirect(res, `/admin/layout/defaults/${type}?error=` + encodeURIComponent(error.message));
    }
  }, 'Remove section from layout');

  /**
   * POST /admin/layout/defaults/:type/move-section - Move section up/down
   */
  register('POST', '/admin/layout/defaults/:type/move-section', async (req, res, params, ctx) => {
    const { type } = params;
    const layoutBuilder = ctx.services.get('layoutBuilder');

    if (!layoutBuilder) {
      redirect(res, '/admin?error=' + encodeURIComponent('Layout Builder not enabled'));
      return;
    }

    try {
      const body = ctx._parsedBody || await parseFormBody(req);
      const sectionUuid = body.sectionUuid;
      const direction = body.direction; // 'up' or 'down'

      let storage = layoutBuilder.getDefaultLayout(type);
      if (!storage) {
        redirect(res, `/admin/layout/defaults/${type}?error=` + encodeURIComponent('No layout found'));
        return;
      }

      const currentIndex = storage.sections.findIndex(s => s.uuid === sectionUuid);
      if (currentIndex === -1) {
        redirect(res, `/admin/layout/defaults/${type}?error=` + encodeURIComponent('Section not found'));
        return;
      }

      const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (newIndex >= 0 && newIndex < storage.sections.length) {
        storage = layoutBuilder.moveSection(storage, sectionUuid, newIndex);
        await layoutBuilder.setDefaultLayout(type, storage);
      }

      redirect(res, `/admin/layout/defaults/${type}?success=` + encodeURIComponent('Section moved'));
    } catch (error) {
      redirect(res, `/admin/layout/defaults/${type}?error=` + encodeURIComponent(error.message));
    }
  }, 'Move section in layout');

  /**
   * POST /admin/layout/defaults/:type/add-block - Add block to section
   */
  register('POST', '/admin/layout/defaults/:type/add-block', async (req, res, params, ctx) => {
    const { type } = params;
    const layoutBuilder = ctx.services.get('layoutBuilder');

    if (!layoutBuilder) {
      redirect(res, '/admin?error=' + encodeURIComponent('Layout Builder not enabled'));
      return;
    }

    try {
      const body = ctx._parsedBody || await parseFormBody(req);
      const { sectionUuid, regionId, blockId } = body;

      if (!sectionUuid || !regionId || !blockId) {
        redirect(res, `/admin/layout/defaults/${type}?error=` + encodeURIComponent('Missing required fields'));
        return;
      }

      let storage = layoutBuilder.getDefaultLayout(type);
      if (!storage) {
        redirect(res, `/admin/layout/defaults/${type}?error=` + encodeURIComponent('No layout found'));
        return;
      }

      const section = layoutBuilder.getSection(storage, sectionUuid);
      if (!section) {
        redirect(res, `/admin/layout/defaults/${type}?error=` + encodeURIComponent('Section not found'));
        return;
      }

      const component = layoutBuilder.createBlockComponent(blockId);
      layoutBuilder.addComponent(section, regionId, component);
      await layoutBuilder.setDefaultLayout(type, storage);

      redirect(res, `/admin/layout/defaults/${type}?success=` + encodeURIComponent('Block added'));
    } catch (error) {
      redirect(res, `/admin/layout/defaults/${type}?error=` + encodeURIComponent(error.message));
    }
  }, 'Add block to section');

  /**
   * POST /admin/layout/defaults/:type/remove-component - Remove component from section
   */
  register('POST', '/admin/layout/defaults/:type/remove-component', async (req, res, params, ctx) => {
    const { type } = params;
    const layoutBuilder = ctx.services.get('layoutBuilder');

    if (!layoutBuilder) {
      redirect(res, '/admin?error=' + encodeURIComponent('Layout Builder not enabled'));
      return;
    }

    try {
      const body = ctx._parsedBody || await parseFormBody(req);
      const { sectionUuid, componentUuid } = body;

      let storage = layoutBuilder.getDefaultLayout(type);
      if (!storage) {
        redirect(res, `/admin/layout/defaults/${type}?error=` + encodeURIComponent('No layout found'));
        return;
      }

      const section = layoutBuilder.getSection(storage, sectionUuid);
      if (!section) {
        redirect(res, `/admin/layout/defaults/${type}?error=` + encodeURIComponent('Section not found'));
        return;
      }

      layoutBuilder.removeComponent(section, componentUuid);
      await layoutBuilder.setDefaultLayout(type, storage);

      redirect(res, `/admin/layout/defaults/${type}?success=` + encodeURIComponent('Component removed'));
    } catch (error) {
      redirect(res, `/admin/layout/defaults/${type}?error=` + encodeURIComponent(error.message));
    }
  }, 'Remove component from section');

  /**
   * POST /admin/layout/defaults/:type/clear - Clear all sections
   */
  register('POST', '/admin/layout/defaults/:type/clear', async (req, res, params, ctx) => {
    const { type } = params;
    const layoutBuilder = ctx.services.get('layoutBuilder');

    if (!layoutBuilder) {
      redirect(res, '/admin?error=' + encodeURIComponent('Layout Builder not enabled'));
      return;
    }

    try {
      await layoutBuilder.deleteDefaultLayout(type);
      redirect(res, `/admin/layout?success=` + encodeURIComponent(`Cleared layout for ${type}`));
    } catch (error) {
      redirect(res, `/admin/layout/defaults/${type}?error=` + encodeURIComponent(error.message));
    }
  }, 'Clear layout');

  /**
   * GET /admin/layout/preview/:type - Preview rendered layout
   */
  register('GET', '/admin/layout/preview/:type', async (req, res, params, ctx) => {
    const { type } = params;
    const layoutBuilder = ctx.services.get('layoutBuilder');

    if (!layoutBuilder) {
      server.html(res, '<p>Layout Builder not enabled</p>');
      return;
    }

    try {
      const layout = layoutBuilder.getDefaultLayout(type);
      if (!layout) {
        server.html(res, `<p>No default layout defined for ${type}</p>`);
        return;
      }

      const html = await layoutBuilder.renderLayout(layout, {});
      const wrappedHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Layout Preview: ${type}</title>
  <style>
    body { font-family: sans-serif; padding: 20px; background: #f5f5f5; }
    .layout-builder { background: white; padding: 20px; border-radius: 8px; }
    .layout-section { border: 2px dashed #ccc; padding: 10px; margin: 10px 0; }
    .layout-region { border: 1px solid #ddd; padding: 10px; margin: 5px; min-height: 50px; background: #fafafa; }
    .layout-component { background: #e3f2fd; padding: 5px; margin: 5px 0; border-radius: 4px; }
  </style>
</head>
<body>
  <h2>Layout Preview: ${type}</h2>
  ${html || '<p>(empty layout)</p>'}
</body>
</html>`;
      server.html(res, wrappedHtml);
    } catch (error) {
      server.html(res, `<p>Error: ${error.message}</p>`);
    }
  }, 'Preview rendered layout');

  // ========================================
  // LAYOUT BUILDER REST API ROUTES
  // ========================================

  /**
   * GET /api/layout/:type/sections - Get default layout sections for a content type
   *
   * WHY REST API: Enables headless/decoupled usage of layout data.
   * Returns sections with regions and components in JSON format.
   */
  register('GET', '/api/layout/:type/sections', async (req, res, params, ctx) => {
    const { type } = params;
    const layoutBuilder = ctx.services.get('layoutBuilder');

    if (!layoutBuilder) {
      server.json(res, { error: 'Layout Builder not enabled' }, 503);
      return;
    }

    const storage = layoutBuilder.getDefaultLayout(type);
    if (!storage) {
      server.json(res, { error: `No default layout for content type: ${type}` }, 404);
      return;
    }

    // Enrich sections with layout definition info
    const sections = (storage.sections || []).map(section => {
      const layoutDef = layoutBuilder.getLayout(section.layoutId);
      return {
        uuid: section.uuid,
        layoutId: section.layoutId,
        layoutLabel: layoutDef?.label || section.layoutId,
        layoutCategory: layoutDef?.category || 'Unknown',
        settings: section.settings,
        weight: section.weight,
        regions: Object.entries(layoutDef?.regions || {}).map(([regionId, region]) => ({
          id: regionId,
          label: region.label,
          weight: region.weight || 0,
          components: (section.components[regionId] || []).map(comp => ({
            uuid: comp.uuid,
            type: comp.type,
            blockId: comp.blockId || null,
            blockType: comp.blockType || null,
            fieldName: comp.fieldName || null,
            configuration: comp.configuration || {},
            weight: comp.weight,
          })),
        })),
      };
    });

    server.json(res, {
      contentType: type,
      sections,
      sectionCount: sections.length,
      updated: storage.updated || null,
    });
  }, 'Get layout sections for content type');

  /**
   * GET /api/layout/:type/:id/sections - Get effective layout for a specific content item
   *
   * WHY: Returns per-content override if exists, otherwise falls back to default.
   * This is what a front-end would call to render a specific content item's layout.
   */
  register('GET', '/api/layout/:type/:id/sections', async (req, res, params, ctx) => {
    const { type, id } = params;
    const layoutBuilder = ctx.services.get('layoutBuilder');

    if (!layoutBuilder) {
      server.json(res, { error: 'Layout Builder not enabled' }, 503);
      return;
    }

    // Get effective layout (per-content override or default)
    const layout = layoutBuilder.getEffectiveLayout(type, id);

    if (!layout) {
      server.json(res, { error: `No layout found for ${type}/${id}` }, 404);
      return;
    }

    // Determine if this is an override or default
    const hasOverride = layoutBuilder.hasContentLayoutOverride(type, id);

    // Enrich sections with layout definition info
    const sections = (layout.sections || []).map(section => {
      const layoutDef = layoutBuilder.getLayout(section.layoutId);
      return {
        uuid: section.uuid,
        layoutId: section.layoutId,
        layoutLabel: layoutDef?.label || section.layoutId,
        layoutCategory: layoutDef?.category || 'Unknown',
        settings: section.settings,
        weight: section.weight,
        regions: Object.entries(layoutDef?.regions || {}).map(([regionId, region]) => ({
          id: regionId,
          label: region.label,
          weight: region.weight || 0,
          components: (section.components[regionId] || []).map(comp => ({
            uuid: comp.uuid,
            type: comp.type,
            blockId: comp.blockId || null,
            blockType: comp.blockType || null,
            fieldName: comp.fieldName || null,
            configuration: comp.configuration || {},
            weight: comp.weight,
          })),
        })),
      };
    });

    server.json(res, {
      contentType: type,
      contentId: id,
      isOverride: hasOverride,
      sections,
      sectionCount: sections.length,
      updated: layout.updated || null,
    });
  }, 'Get effective layout sections for content item');

  /**
   * GET /api/layout/definitions - List all layout definitions
   *
   * WHY: Enables front-ends to know what layout options are available.
   */
  register('GET', '/api/layout/definitions', async (req, res, params, ctx) => {
    const layoutBuilder = ctx.services.get('layoutBuilder');

    if (!layoutBuilder) {
      server.json(res, { error: 'Layout Builder not enabled' }, 503);
      return;
    }

    const layouts = layoutBuilder.listLayouts();
    const definitions = layouts.map(l => ({
      id: l.id,
      label: l.label,
      description: l.description,
      category: l.category,
      icon: l.icon,
      regions: Object.entries(l.regions).map(([id, r]) => ({
        id,
        label: r.label,
        weight: r.weight || 0,
      })),
    }));

    server.json(res, {
      definitions,
      count: definitions.length,
      categories: layoutBuilder.listCategories(),
    });
  }, 'List layout definitions');

  /**
   * PUT /api/layout/:type/:id/sections - Set per-content layout override
   *
   * WHY: Enables creating custom layouts for individual content items.
   * Body should contain: { sections: [...] }
   */
  register('PUT', '/api/layout/:type/:id/sections', async (req, res, params, ctx) => {
    const { type, id } = params;
    const layoutBuilder = ctx.services.get('layoutBuilder');

    if (!layoutBuilder) {
      server.json(res, { error: 'Layout Builder not enabled' }, 503);
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const { sections } = body;

      if (!sections || !Array.isArray(sections)) {
        server.json(res, { error: 'sections array is required' }, 400);
        return;
      }

      await layoutBuilder.setContentLayout(type, id, { sections });

      server.json(res, {
        success: true,
        contentType: type,
        contentId: id,
        sectionCount: sections.length,
      });
    } catch (error) {
      server.json(res, { error: error.message }, 400);
    }
  }, 'Set per-content layout override');

  /**
   * DELETE /api/layout/:type/:id/sections - Remove per-content layout override
   *
   * WHY: Allows reverting to content type default layout.
   */
  register('DELETE', '/api/layout/:type/:id/sections', async (req, res, params, ctx) => {
    const { type, id } = params;
    const layoutBuilder = ctx.services.get('layoutBuilder');

    if (!layoutBuilder) {
      server.json(res, { error: 'Layout Builder not enabled' }, 503);
      return;
    }

    try {
      await layoutBuilder.removeContentLayout(type, id);

      server.json(res, {
        success: true,
        contentType: type,
        contentId: id,
        reverted: true,
      });
    } catch (error) {
      server.json(res, { error: error.message }, 400);
    }
  }, 'Remove per-content layout override');

  // ========================================
  // PER-CONTENT LAYOUT OVERRIDE ADMIN ROUTES
  // ========================================

  /**
   * GET /admin/content/:type/:id/layout - Manage layout for specific content item
   *
   * WHY: Provides UI for creating custom layouts for individual content items.
   * Shows current effective layout (override or default) with edit capabilities.
   */
  register('GET', '/admin/content/:type/:id/layout', async (req, res, params, ctx) => {
    const { type, id } = params;
    const layoutBuilder = ctx.services.get('layoutBuilder');
    const blocksService = ctx.services.get('blocks');
    const contentService = ctx.services.get('content');

    if (!layoutBuilder) {
      redirect(res, '/admin?error=' + encodeURIComponent('Layout Builder not enabled'));
      return;
    }

    // Get content item for title display
    const item = contentService ? contentService.read(type, id) : null;
    if (!item) {
      redirect(res, `/admin/content/${type}?error=` + encodeURIComponent('Content not found'));
      return;
    }
    const itemTitle = item.title || item.name || id;

    // Get effective layout (per-content override or default)
    const storage = layoutBuilder.getEffectiveLayout(type, id) || { sections: [] };
    const hasOverride = layoutBuilder.hasContentLayoutOverride(type, id);
    const layouts = layoutBuilder.listLayouts();
    const blocks = blocksService ? blocksService.listBlocks({ enabled: true }).items : [];
    const csrfToken = req ? (ctx.services.get('auth')?.getCSRFToken(req) || '') : '';

    // Pre-render sections HTML (same pattern as default layout edit)
    // WHY: Template engine doesn't support deeply nested Mustache-style sections.
    let sectionsHtml = '';
    const sectionsList = storage.sections || [];
    if (sectionsList.length === 0) {
      sectionsHtml = '<div class="empty-section"><p>No sections yet.</p><p>Add a section from the sidebar to start building your layout.</p></div>';
    } else {
      for (let i = 0; i < sectionsList.length; i++) {
        const section = sectionsList[i];
        const layoutDef = layoutBuilder.getLayout(section.layoutId);
        const layoutLabel = layoutDef?.label || section.layoutId;
        const uuidShort = section.uuid.substring(0, 8);

        // Section action buttons (move up/down, remove)
        let actionBtns = '';
        if (i > 0) {
          actionBtns += `<form action="/admin/content/${type}/${id}/layout/move-section" method="POST" class="inline-form">
            <input type="hidden" name="sectionUuid" value="${section.uuid}">
            <input type="hidden" name="direction" value="up">
            <input type="hidden" name="_csrf" value="${csrfToken}">
            <input type="submit" value="↑" title="Move up">
          </form>`;
        }
        if (i < sectionsList.length - 1) {
          actionBtns += `<form action="/admin/content/${type}/${id}/layout/move-section" method="POST" class="inline-form">
            <input type="hidden" name="sectionUuid" value="${section.uuid}">
            <input type="hidden" name="direction" value="down">
            <input type="hidden" name="_csrf" value="${csrfToken}">
            <input type="submit" value="↓" title="Move down">
          </form>`;
        }
        actionBtns += `<form action="/admin/content/${type}/${id}/layout/remove-section" method="POST" class="inline-form" onsubmit="return confirm('Remove this section?')">
          <input type="hidden" name="sectionUuid" value="${section.uuid}">
          <input type="hidden" name="_csrf" value="${csrfToken}">
          <input type="submit" value="×" title="Remove section">
        </form>`;

        // Regions with components
        let regionsHtml = '';
        for (const [regionId, region] of Object.entries(layoutDef?.regions || {})) {
          const components = section.components[regionId] || [];
          let componentsHtml = '';
          if (components.length > 0) {
            for (const comp of components) {
              const typeLabel = comp.type === 'block' ? `Block: ${comp.blockId}` :
                comp.type === 'inline_block' ? `Inline: ${comp.blockType}` :
                comp.type === 'field' ? `Field: ${comp.fieldName}` : comp.type;
              const configStr = comp.configuration && Object.keys(comp.configuration).length > 0
                ? ` <span style="color:#999;font-size:0.8em">[configured]</span>` : '';
              componentsHtml += `<div class="component-item">
                <div class="component-info">
                  <span class="component-type">${typeLabel}</span>${configStr}
                  <span class="component-uuid">(${comp.uuid.substring(0, 8)}...)</span>
                </div>
                <div class="component-actions">
                  <form action="/admin/content/${type}/${id}/layout/remove-component" method="POST" class="inline-form" onsubmit="return confirm('Remove this component?')">
                    <input type="hidden" name="sectionUuid" value="${section.uuid}">
                    <input type="hidden" name="componentUuid" value="${comp.uuid}">
                    <input type="hidden" name="_csrf" value="${csrfToken}">
                    <button type="submit">×</button>
                  </form>
                </div>
              </div>`;
            }
          } else {
            componentsHtml = '<p style="color: #999; font-size: 0.9em; text-align: center;">Drop blocks here</p>';
          }

          // Add block form for this region
          let addBlockForm = '';
          if (blocks.length > 0) {
            const blockOptions = blocks.map(b =>
              `<option value="${b.id}">${b.adminTitle || b.title || b.id}</option>`
            ).join('');
            addBlockForm = `<form action="/admin/content/${type}/${id}/layout/add-block" method="POST" style="margin-top: 10px;">
              <input type="hidden" name="sectionUuid" value="${section.uuid}">
              <input type="hidden" name="regionId" value="${regionId}">
              <input type="hidden" name="_csrf" value="${csrfToken}">
              <select name="blockId" style="width: 70%; padding: 4px; font-size: 0.85em;">
                <option value="">Add block...</option>
                ${blockOptions}
              </select>
              <button type="submit" class="btn btn-small" style="padding: 4px 8px;">+</button>
            </form>`;
          }

          regionsHtml += `<div class="region-container">
            <div class="region-header">${region.label || regionId}</div>
            <div class="region-content">
              ${componentsHtml}
              ${addBlockForm}
            </div>
          </div>`;
        }

        sectionsHtml += `<div class="section-card">
          <div class="section-header">
            <h3>${layoutLabel}</h3>
            <div class="section-actions">${actionBtns}</div>
          </div>
          <div class="section-body">
            <small class="component-uuid">UUID: ${uuidShort}...</small>
            <div class="section-regions">${regionsHtml}</div>
          </div>
        </div>`;
      }
    }

    // Pre-render sidebar HTML
    const layoutOptions = layouts.map(l =>
      `<option value="${l.id}">${l.label} (${Object.keys(l.regions).join(', ')})</option>`
    ).join('');

    let blocksListHtml = '';
    if (blocks.length > 0) {
      const blockItems = blocks.map(b =>
        `<li><strong>${b.adminTitle || b.title || b.id}</strong> <span style="color: #999;">(${b.type})</span></li>`
      ).join('');
      blocksListHtml = `<ul style="font-size: 0.9em; padding-left: 20px;">${blockItems}</ul>
        <p style="font-size: 0.85em; color: #666;"><a href="/admin/blocks">Manage Blocks →</a></p>`;
    } else {
      blocksListHtml = '<p style="color: #999; font-size: 0.9em;">No blocks available. <a href="/admin/blocks/add">Create a block</a> first.</p>';
    }

    const overrideStatusHtml = hasOverride
      ? '<div class="info-banner" style="background: #e3f2fd; border-left: 4px solid #2196f3; padding: 12px; margin-bottom: 16px;">This content item has a custom layout override.</div>'
      : '<div class="info-banner" style="background: #fff8e1; border-left: 4px solid #ff9800; padding: 12px; margin-bottom: 16px;">This content item uses the default layout for <strong>' + type + '</strong>. Changes will create an override.</div>';

    let revertButtonHtml = '';
    if (hasOverride) {
      revertButtonHtml = `<form action="/admin/content/${type}/${id}/layout/revert" method="POST" onsubmit="return confirm('Revert to default layout? This will remove all custom sections.')">
        <input type="hidden" name="_csrf" value="${csrfToken}">
        <button type="submit" class="btn btn-danger">Revert to Default Layout</button>
      </form>`;
    }

    const sidebarHtml = `<h3>Add Section</h3>
      <form action="/admin/content/${type}/${id}/layout/add-section" method="POST" class="add-form">
        <input type="hidden" name="_csrf" value="${csrfToken}">
        <label for="layoutId">Layout Template:</label>
        <select name="layoutId" id="layoutId" required>
          <option value="">Select layout...</option>
          ${layoutOptions}
        </select>
        <button type="submit" class="btn btn-primary">Add Section</button>
      </form>
      <hr style="margin: 20px 0;">
      <h3>Available Blocks</h3>
      ${blocksListHtml}
      ${hasOverride ? '<hr style="margin: 20px 0;"><div class="danger-zone"><h4>Danger Zone</h4><p style="font-size: 0.85em;">Revert to default layout:</p>' + revertButtonHtml + '</div>' : ''}`;

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('layout-builder-edit.html', {
      pageTitle: `Layout: ${itemTitle}`,
      contentType: type,
      sectionsHtml: overrideStatusHtml + sectionsHtml,
      sidebarHtml,
      lastUpdated: storage.updated ? formatDate(storage.updated) : 'Never',
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Edit per-content layout override');

  /**
   * POST /admin/content/:type/:id/layout/add-section - Add section to content layout
   */
  register('POST', '/admin/content/:type/:id/layout/add-section', async (req, res, params, ctx) => {
    const { type, id } = params;
    const layoutBuilder = ctx.services.get('layoutBuilder');

    if (!layoutBuilder) {
      redirect(res, '/admin?error=' + encodeURIComponent('Layout Builder not enabled'));
      return;
    }

    try {
      const body = ctx._parsedBody || await parseFormBody(req);
      const layoutId = body.layoutId;

      if (!layoutId) {
        redirect(res, `/admin/content/${type}/${id}/layout?error=` + encodeURIComponent('Layout is required'));
        return;
      }

      let storage = layoutBuilder.getEffectiveLayout(type, id) || { sections: [] };
      const section = layoutBuilder.createSection(layoutId);
      storage = layoutBuilder.addSection(storage, section);
      await layoutBuilder.setContentLayout(type, id, storage);

      redirect(res, `/admin/content/${type}/${id}/layout?success=` + encodeURIComponent('Section added'));
    } catch (error) {
      redirect(res, `/admin/content/${type}/${id}/layout?error=` + encodeURIComponent(error.message));
    }
  }, 'Add section to content layout');

  /**
   * POST /admin/content/:type/:id/layout/remove-section - Remove section from content layout
   */
  register('POST', '/admin/content/:type/:id/layout/remove-section', async (req, res, params, ctx) => {
    const { type, id } = params;
    const layoutBuilder = ctx.services.get('layoutBuilder');

    if (!layoutBuilder) {
      redirect(res, '/admin?error=' + encodeURIComponent('Layout Builder not enabled'));
      return;
    }

    try {
      const body = ctx._parsedBody || await parseFormBody(req);
      const sectionUuid = body.sectionUuid;

      let storage = layoutBuilder.getEffectiveLayout(type, id);
      if (!storage) {
        redirect(res, `/admin/content/${type}/${id}/layout?error=` + encodeURIComponent('No layout found'));
        return;
      }

      storage = layoutBuilder.removeSection(storage, sectionUuid);
      await layoutBuilder.setContentLayout(type, id, storage);

      redirect(res, `/admin/content/${type}/${id}/layout?success=` + encodeURIComponent('Section removed'));
    } catch (error) {
      redirect(res, `/admin/content/${type}/${id}/layout?error=` + encodeURIComponent(error.message));
    }
  }, 'Remove section from content layout');

  /**
   * POST /admin/content/:type/:id/layout/move-section - Move section up/down in content layout
   */
  register('POST', '/admin/content/:type/:id/layout/move-section', async (req, res, params, ctx) => {
    const { type, id } = params;
    const layoutBuilder = ctx.services.get('layoutBuilder');

    if (!layoutBuilder) {
      redirect(res, '/admin?error=' + encodeURIComponent('Layout Builder not enabled'));
      return;
    }

    try {
      const body = ctx._parsedBody || await parseFormBody(req);
      const sectionUuid = body.sectionUuid;
      const direction = body.direction; // 'up' or 'down'

      let storage = layoutBuilder.getEffectiveLayout(type, id);
      if (!storage) {
        redirect(res, `/admin/content/${type}/${id}/layout?error=` + encodeURIComponent('No layout found'));
        return;
      }

      const currentIndex = storage.sections.findIndex(s => s.uuid === sectionUuid);
      if (currentIndex === -1) {
        redirect(res, `/admin/content/${type}/${id}/layout?error=` + encodeURIComponent('Section not found'));
        return;
      }

      const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (newIndex >= 0 && newIndex < storage.sections.length) {
        storage = layoutBuilder.moveSection(storage, sectionUuid, newIndex);
        await layoutBuilder.setContentLayout(type, id, storage);
      }

      redirect(res, `/admin/content/${type}/${id}/layout?success=` + encodeURIComponent('Section moved'));
    } catch (error) {
      redirect(res, `/admin/content/${type}/${id}/layout?error=` + encodeURIComponent(error.message));
    }
  }, 'Move section in content layout');

  /**
   * POST /admin/content/:type/:id/layout/add-block - Add block to content layout section
   */
  register('POST', '/admin/content/:type/:id/layout/add-block', async (req, res, params, ctx) => {
    const { type, id } = params;
    const layoutBuilder = ctx.services.get('layoutBuilder');

    if (!layoutBuilder) {
      redirect(res, '/admin?error=' + encodeURIComponent('Layout Builder not enabled'));
      return;
    }

    try {
      const body = ctx._parsedBody || await parseFormBody(req);
      const { sectionUuid, regionId, blockId } = body;

      if (!sectionUuid || !regionId || !blockId) {
        redirect(res, `/admin/content/${type}/${id}/layout?error=` + encodeURIComponent('Missing required fields'));
        return;
      }

      let storage = layoutBuilder.getEffectiveLayout(type, id);
      if (!storage) {
        redirect(res, `/admin/content/${type}/${id}/layout?error=` + encodeURIComponent('No layout found'));
        return;
      }

      const section = layoutBuilder.getSection(storage, sectionUuid);
      if (!section) {
        redirect(res, `/admin/content/${type}/${id}/layout?error=` + encodeURIComponent('Section not found'));
        return;
      }

      const component = layoutBuilder.createBlockComponent(blockId);
      layoutBuilder.addComponent(section, regionId, component);
      await layoutBuilder.setContentLayout(type, id, storage);

      redirect(res, `/admin/content/${type}/${id}/layout?success=` + encodeURIComponent('Block added'));
    } catch (error) {
      redirect(res, `/admin/content/${type}/${id}/layout?error=` + encodeURIComponent(error.message));
    }
  }, 'Add block to content layout section');

  /**
   * POST /admin/content/:type/:id/layout/remove-component - Remove component from content layout section
   */
  register('POST', '/admin/content/:type/:id/layout/remove-component', async (req, res, params, ctx) => {
    const { type, id } = params;
    const layoutBuilder = ctx.services.get('layoutBuilder');

    if (!layoutBuilder) {
      redirect(res, '/admin?error=' + encodeURIComponent('Layout Builder not enabled'));
      return;
    }

    try {
      const body = ctx._parsedBody || await parseFormBody(req);
      const { sectionUuid, componentUuid } = body;

      let storage = layoutBuilder.getEffectiveLayout(type, id);
      if (!storage) {
        redirect(res, `/admin/content/${type}/${id}/layout?error=` + encodeURIComponent('No layout found'));
        return;
      }

      const section = layoutBuilder.getSection(storage, sectionUuid);
      if (!section) {
        redirect(res, `/admin/content/${type}/${id}/layout?error=` + encodeURIComponent('Section not found'));
        return;
      }

      layoutBuilder.removeComponent(section, componentUuid);
      await layoutBuilder.setContentLayout(type, id, storage);

      redirect(res, `/admin/content/${type}/${id}/layout?success=` + encodeURIComponent('Component removed'));
    } catch (error) {
      redirect(res, `/admin/content/${type}/${id}/layout?error=` + encodeURIComponent(error.message));
    }
  }, 'Remove component from content layout section');

  /**
   * POST /admin/content/:type/:id/layout/revert - Revert to default layout (remove override)
   */
  register('POST', '/admin/content/:type/:id/layout/revert', async (req, res, params, ctx) => {
    const { type, id } = params;
    const layoutBuilder = ctx.services.get('layoutBuilder');

    if (!layoutBuilder) {
      redirect(res, '/admin?error=' + encodeURIComponent('Layout Builder not enabled'));
      return;
    }

    try {
      await layoutBuilder.removeContentLayout(type, id);
      redirect(res, `/admin/content/${type}/${id}/layout?success=` + encodeURIComponent('Reverted to default layout'));
    } catch (error) {
      redirect(res, `/admin/content/${type}/${id}/layout?error=` + encodeURIComponent(error.message));
    }
  }, 'Revert to default layout');

  // ========================================
  // MEDIA LIBRARY ROUTES
  // ========================================

  /**
   * GET /admin/media/library - Media library browser
   */
  register('GET', '/admin/media/library', async (req, res, params, ctx) => {
    const mediaLibrary = ctx.services.get('mediaLibrary');
    const template = ctx.services.get('template');
    const server = ctx.services.get('server');

    if (!mediaLibrary) {
      server.html(res, '<p>Media Library not enabled</p>');
      return;
    }

    const url = new URL(req.url, 'http://localhost');
    const mediaType = url.searchParams.get('type') || null;
    const searchQuery = url.searchParams.get('search') || '';
    const viewMode = url.searchParams.get('view') || 'grid';
    const page = parseInt(url.searchParams.get('page')) || 1;
    const limit = 24;

    const listOptions = { mediaType, page, limit };
    if (searchQuery) {
      listOptions.search = searchQuery;
    }

    const result = mediaLibrary.list(listOptions);
    const types = mediaLibrary.listMediaTypes();
    const stats = mediaLibrary.getStats();

    // Pre-compute media icon and type flags for template (template engine is simple)
    const mediaIcons = { video: '🎬', audio: '🎵', document: '📄', remote_video: '🔗' };
    const items = (result.items || []).map(item => ({
      ...item,
      _isImage: item.mediaType === 'image',
      _icon: mediaIcons[item.mediaType] || '📁',
      _sizeFormatted: item.size ? formatMediaSize(item.size) : '-',
      _createdFormatted: item.created ? new Date(item.created).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '-',
    }));

    // Pre-compute filter tabs with href and active class
    const searchSuffix = searchQuery ? '&search=' + encodeURIComponent(searchQuery) : '';
    const filterTabs = [
      { label: 'All', href: '/admin/media/library' + (searchQuery ? '?search=' + encodeURIComponent(searchQuery) : ''), activeClass: !mediaType ? 'active' : '' },
      ...types.map(t => ({
        label: t.label || t.id,
        href: '/admin/media/library?type=' + t.id + searchSuffix,
        activeClass: mediaType === t.id ? 'active' : '',
      })),
    ];

    // Pre-compute pagination URLs
    const hasNext = page * limit < result.total;
    const hasPrev = page > 1;
    const baseParams = (mediaType ? '&type=' + mediaType : '') + (searchQuery ? '&search=' + encodeURIComponent(searchQuery) : '');
    const prevUrl = '/admin/media/library?page=' + (page - 1) + baseParams;
    const nextUrl = '/admin/media/library?page=' + (page + 1) + baseParams;

    const html = renderAdmin('media-library.html', {
      items,
      total: result.total,
      hasItems: items.length > 0,
      page,
      limit,
      filterTabs,
      stats,
      currentType: mediaType,
      searchQuery,
      viewMode,
      typeQueryParam: mediaType ? '?type=' + mediaType : '',
      hasNext,
      hasPrev,
      showPagination: hasNext || hasPrev,
      prevUrl,
      nextUrl,
      pageTitle: 'Media Library',
    }, ctx, req);

    server.html(res, html);
  }, 'Media library browser with search, grid/list view toggle');

  /**
   * GET /admin/media/library/browse/search - Search endpoint for media browser modal
   * Returns JSON for dynamic filtering in the modal
   */
  register('GET', '/admin/media/library/browse/search', async (req, res, params, ctx) => {
    const mediaLibrary = ctx.services.get('mediaLibrary');
    const server = ctx.services.get('server');

    if (!mediaLibrary) {
      server.json(res, { error: 'Media Library not enabled' }, 404);
      return;
    }

    const url = new URL(req.url, 'http://localhost');
    const search = url.searchParams.get('search') || '';
    const mediaType = url.searchParams.get('type') || null;
    const limit = parseInt(url.searchParams.get('limit')) || 50;
    const page = parseInt(url.searchParams.get('page')) || 1;

    const listOptions = { page, limit };
    if (mediaType) listOptions.mediaType = mediaType;
    if (search) listOptions.search = search;

    const result = mediaLibrary.list(listOptions);

    server.json(res, {
      items: result.items,
      total: result.total,
      page,
      limit,
    });
  }, 'Media browser search endpoint for modal filtering');

  /**
   * GET /admin/media/library/browse - Media browser modal (for WYSIWYG)
   */
  register('GET', '/admin/media/library/browse', async (req, res, params, ctx) => {
    const mediaLibrary = ctx.services.get('mediaLibrary');
    const server = ctx.services.get('server');

    if (!mediaLibrary) {
      server.json(res, { error: 'Media Library not enabled' }, 404);
      return;
    }

    const data = mediaLibrary.getBrowserData({
      allowedTypes: ['image', 'video', 'audio', 'document', 'remote_video'],
      multiple: false,
    });

    server.json(res, data);
  }, 'Media browser data for modals');

  /**
   * GET /admin/media/upload - Render media bulk upload page
   */
  register('GET', '/admin/media/upload', async (req, res, params, ctx) => {
    const server = ctx.services.get('server');

    const html = renderAdmin('media-upload.html', {
      pageTitle: 'Upload Media',
      maxFileSize: 10 * 1024 * 1024,
      maxFileSizeFormatted: '10 MB',
    }, ctx, req);

    server.html(res, html);
  }, 'Media upload page');

  /**
   * POST /admin/media/upload - Handle file upload (one file per request)
   * WHY: Each file is uploaded individually via XHR to provide granular progress tracking
   * and error handling per file, similar to modern file upload UX patterns
   */
  register('POST', '/admin/media/upload', async (req, res, params, ctx) => {
    const mediaService = ctx.services.get('media');
    const contentService = ctx.services.get('content');
    const server = ctx.services.get('server');

    try {
      const { fields, files } = await mediaService.parseUpload(req);

      if (!files || files.length === 0) {
        server.json(res, { error: 'No file uploaded' }, 400);
        return;
      }

      const results = [];
      for (const file of files) {
        try {
          // Save file to disk
          const saved = mediaService.saveFile(file);

          // WHY: Determine media type from extension to match Drupal's media type
          // classification pattern (image, video, audio, document)
          const ext = saved.filename.split('.').pop().toLowerCase();
          const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];
          const videoExts = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v'];
          const audioExts = ['mp3', 'wav', 'ogg', 'flac'];
          let mediaType = 'document';
          if (imageExts.includes(ext)) mediaType = 'image';
          else if (videoExts.includes(ext)) mediaType = 'video';
          else if (audioExts.includes(ext)) mediaType = 'audio';

          // Create media entity
          // WHY: Strip extension from filename to create a clean default name
          const name = file.originalName ? file.originalName.replace(/\.[^.]+$/, '') : file.name.replace(/\.[^.]+$/, '');
          const entity = await contentService.create('media-entity', {
            name: name,
            mediaType: mediaType,
            filename: saved.filename,
            path: saved.relativePath,
            mimeType: saved.type,
            size: saved.size,
            metadata: {},
            tags: [],
            alt: '',
            caption: '',
            credit: '',
            status: 'published',
          });

          results.push({
            success: true,
            name: file.originalName || file.name,
            id: entity.id,
            mediaType
          });
        } catch (fileErr) {
          results.push({
            success: false,
            name: file.originalName || file.name,
            error: fileErr.message
          });
        }
      }

      server.json(res, { results });
    } catch (err) {
      server.json(res, { error: err.message }, 500);
    }
  }, 'Handle media file upload');

  /**
   * GET /admin/media/library/:id - View media item details
   */
  register('GET', '/admin/media/library/:id', async (req, res, params, ctx) => {
    const { id } = params;
    const mediaLibrary = ctx.services.get('mediaLibrary');
    const template = ctx.services.get('template');
    const server = ctx.services.get('server');

    if (!mediaLibrary) {
      server.html(res, '<p>Media Library not enabled</p>');
      return;
    }

    const item = mediaLibrary.get(id);
    if (!item) {
      server.html(res, '<p>Media item not found</p>', 404);
      return;
    }

    const usage = mediaLibrary.getUsage(id);
    const url = mediaLibrary.getUrl(item);
    const thumbnailUrl = mediaLibrary.getThumbnailUrl(item);

    // WHY: Pre-compute flags since template engine doesn't support (eq ...) helper
    const isImage = item.mediaType === 'image';
    const isRemoteVideo = item.mediaType === 'remote_video';
    const isVideo = item.mediaType === 'video';
    const isAudio = item.mediaType === 'audio';
    const isDocument = item.mediaType === 'document';

    // WHY: Format date for display since template engine doesn't have formatDate helper
    function formatDate(dateStr) {
      if (!dateStr) return '';
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }

    // WHY: Enrich usage entries with edit URLs and labels for template
    const usageList = usage.map(u => ({
      ...u,
      editUrl: '/admin/content/' + u.contentType + '/' + u.contentId + '/edit',
      label: u.contentType + '/' + u.contentId,
    }));

    const html = renderAdmin('media-detail.html', {
      item,
      usage: usageList,
      hasUsage: usageList.length > 0,
      noUsage: usageList.length === 0,
      usageCount: usageList.length,
      url,
      thumbnailUrl,
      isImage,
      isRemoteVideo,
      isVideo,
      isAudio,
      isDocument,
      sizeFormatted: formatMediaSize(item.size),
      createdFormatted: formatDate(item.created),
      updatedFormatted: formatDate(item.updated),
      tagsFormatted: item.tags && item.tags.length ? item.tags.join(', ') : '',
      hasTags: item.tags && item.tags.length > 0,
      pageTitle: 'Media: ' + (item.name || item.id),
    }, ctx, req);

    server.html(res, html);
  }, 'View media item details');

  /**
   * POST /admin/media/library/:id/track-usage - Track media usage
   * WHY: Allows manual tracking of where media is used (for testing and manual workflows)
   */
  register('POST', '/admin/media/library/:id/track-usage', async (req, res, params, ctx) => {
    const mediaLibrary = ctx.services.get('mediaLibrary');
    const server = ctx.services.get('server');

    try {
      // WHY: Use ctx._parsedBody from CSRF middleware (body already consumed)
      const body = ctx._parsedBody || {};

      const { contentType, contentId, field } = body;

      if (!contentType || !contentId || !field) {
        server.json(res, { error: 'Missing required fields: contentType, contentId, field' }, 400);
        return;
      }

      await mediaLibrary.trackUsage(params.id, contentType, contentId, field);
      server.json(res, { success: true, mediaId: params.id, contentType, contentId, field });
    } catch (err) {
      server.json(res, { error: err.message }, 500);
    }
  }, 'Track media usage');

  /**
   * POST /admin/media/library/:id/remove-usage - Remove media usage tracking
   * WHY: Allows manual removal of usage references (for cleanup and testing)
   */
  register('POST', '/admin/media/library/:id/remove-usage', async (req, res, params, ctx) => {
    const mediaLibrary = ctx.services.get('mediaLibrary');
    const server = ctx.services.get('server');

    try {
      // WHY: Use ctx._parsedBody from CSRF middleware (body already consumed)
      const body = ctx._parsedBody || {};

      const { contentType, contentId } = body;

      if (!contentType || !contentId) {
        server.json(res, { error: 'Missing required fields: contentType, contentId' }, 400);
        return;
      }

      await mediaLibrary.removeUsage(params.id, contentType, contentId);
      server.json(res, { success: true, mediaId: params.id, contentType, contentId });
    } catch (err) {
      server.json(res, { error: err.message }, 500);
    }
  }, 'Remove media usage');

  // ========================================
  // EDITOR ROUTES
  // ========================================

  /**
   * GET /admin/editor - Editor formats management
   */
  register('GET', '/admin/editor', async (req, res, params, ctx) => {
    const editor = ctx.services.get('editor');
    const template = ctx.services.get('template');
    const server = ctx.services.get('server');

    if (!editor) {
      server.html(res, '<p>Editor not enabled</p>');
      return;
    }

    const formats = editor.listFormats();
    const categories = editor.listButtonCategories();

    const html = template.renderWithLayout('admin/editor-formats.html', {
      formats,
      categories,
    });

    server.html(res, html);
  }, 'Editor formats management');

  /**
   * GET /admin/editor/config/:format - Get editor config as JSON
   */
  register('GET', '/admin/editor/config/:format', async (req, res, params, ctx) => {
    const { format } = params;
    const editor = ctx.services.get('editor');
    const server = ctx.services.get('server');

    if (!editor) {
      server.json(res, { error: 'Editor not enabled' }, 404);
      return;
    }

    try {
      const config = editor.getEditorConfig(format);
      server.json(res, config);
    } catch (error) {
      server.json(res, { error: error.message }, 400);
    }
  }, 'Get editor configuration');

  // ========================================
  // RESPONSIVE IMAGES ROUTES
  // ========================================

  /**
   * GET /admin/responsive-images - Responsive image styles
   */
  register('GET', '/admin/responsive-images', async (req, res, params, ctx) => {
    const responsiveImages = ctx.services.get('responsiveImages');
    const template = ctx.services.get('template');
    const server = ctx.services.get('server');

    if (!responsiveImages) {
      server.html(res, '<p>Responsive Images not enabled</p>');
      return;
    }

    const styles = responsiveImages.listResponsiveStyles();
    const breakpoints = responsiveImages.listBreakpoints();

    const html = template.renderWithLayout('admin/responsive-images.html', {
      styles,
      breakpoints,
    });

    server.html(res, html);
  }, 'Responsive image styles');

  // ========================================
  // JSON:API ROUTES
  // ========================================

  /**
   * GET /admin/jsonapi - JSON:API explorer
   */
  register('GET', '/admin/jsonapi', async (req, res, params, ctx) => {
    const jsonapi = ctx.services.get('jsonapi');
    const content = ctx.services.get('content');
    const template = ctx.services.get('template');
    const server = ctx.services.get('server');

    if (!jsonapi) {
      server.html(res, '<p>JSON:API not enabled</p>');
      return;
    }

    const config = jsonapi.getConfig();
    const types = content.listTypes();

    const html = template.renderWithLayout('admin/jsonapi.html', {
      config,
      types,
      basePath: config.basePath,
    });

    server.html(res, html);
  }, 'JSON:API explorer');

  // ========================================
  // LAYOUT BUILDER PAGE ROUTE (Feature #67)
  // ========================================

  /**
   * GET /node/:id/layout - Layout builder page for a specific content item
   *
   * WHY /node/:id/layout:
   * Follows Drupal's convention where /node/{nid}/layout opens the layout builder.
   * Auto-detects content type by searching across all registered types.
   *
   * FEATURES IMPLEMENTED:
   * - Feature #67: Dedicated page route for the layout builder interface
   * - Feature #68: Layout builder HTML shell with sections grid
   * - Feature #70: Drag handle for sections (via draggable attribute + JS)
   */
  register('GET', '/node/:id/layout', async (req, res, params, ctx) => {
    const { id } = params;
    const layoutBuilder = ctx.services.get('layoutBuilder');
    const server = ctx.services.get('server');

    if (!layoutBuilder) {
      redirect(res, '/admin?error=' + encodeURIComponent('Layout Builder not enabled'));
      return;
    }

    // Auto-detect content type by searching across all registered types
    // WHY: Drupal's /node/{id}/layout doesn't include type in the URL,
    // so we need to find which type this content belongs to.
    const types = content.listTypes();
    let contentItem = null;
    let contentType = null;

    for (const { type } of types) {
      const item = content.read(type, id);
      if (item) {
        contentItem = item;
        contentType = type;
        break;
      }
    }

    // 404 for non-existent content
    if (!contentItem) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html><html><head><title>404 Not Found</title><link rel="stylesheet" href="/css/admin.css"></head>
<body><main class="admin-main"><h1>404 - Content Not Found</h1>
<p>No content found with ID "${id.replace(/[<>"'&]/g, '')}".</p>
<a href="/admin/content" class="btn btn-primary">← Back to Content</a></main></body></html>`);
      return;
    }

    const contentId = contentItem.id || id;
    const contentTitle = contentItem.title || contentItem.name || contentItem.subject || contentId;

    // Get the effective layout (override > default > empty)
    const effectiveLayout = layoutBuilder.getEffectiveLayout(contentType, contentId, contentItem);
    const hasOverride = layoutBuilder.hasContentLayoutOverride(contentType, contentId);
    const layouts = layoutBuilder.listLayouts();

    // Build sections HTML (Feature #68: sections grid)
    let sectionsHtml = '';

    if (effectiveLayout && effectiveLayout.sections && effectiveLayout.sections.length > 0) {
      const sortedSections = [...effectiveLayout.sections].sort((a, b) => (a.weight || 0) - (b.weight || 0));

      for (const section of sortedSections) {
        const layoutDef = layoutBuilder.getLayout(section.layoutId);
        const layoutLabel = layoutDef ? layoutDef.label : section.layoutId;
        const regions = layoutDef ? layoutDef.regions : {};
        const regionCount = Object.keys(regions).length;

        // Build regions HTML
        let regionsHtml = '';
        const sortedRegions = Object.entries(regions)
          .sort((a, b) => (a[1].weight || 0) - (b[1].weight || 0));

        for (const [regionId, regionDef] of sortedRegions) {
          const components = (section.components && section.components[regionId]) || [];

          let componentsHtml = '';
          if (components.length > 0) {
            for (const comp of components.sort((a, b) => (a.weight || 0) - (b.weight || 0))) {
              let typeLabel = comp.type;
              let detailLabel = '';
              if (comp.type === 'block') {
                typeLabel = 'Block';
                detailLabel = comp.blockId || '(no block ID)';
              } else if (comp.type === 'inline_block') {
                typeLabel = 'Inline Block';
                detailLabel = comp.blockType || '';
              } else if (comp.type === 'field') {
                typeLabel = 'Field';
                detailLabel = comp.fieldName || '';
              }

              componentsHtml += `
                <div class="component-chip" draggable="true" data-component-uuid="${comp.uuid}" data-section-uuid="${section.uuid}" data-region="${regionId}">
                  <div class="component-drag-handle" role="button" aria-label="Drag to reorder ${typeLabel} ${detailLabel}" aria-roledescription="drag handle" tabindex="0" title="Drag to reorder">
                    <span class="drag-grip">⠿</span>
                  </div>
                  <div class="component-chip-info">
                    <span class="component-chip-type">${typeLabel}</span>
                    <span class="component-chip-detail">${detailLabel}</span>
                  </div>
                  <div class="component-chip-actions">
                    <button title="Remove component" onclick="if(confirm('Remove this component?')) removeComponent('${contentType}', '${contentId}', '${section.uuid}', '${comp.uuid}')">✕</button>
                  </div>
                </div>`;
            }
          } else {
            componentsHtml = '<div class="region-empty">Drop a component here</div>';
          }

          regionsHtml += `
            <div class="region-slot" data-region="${regionId}">
              <div class="region-slot-header">
                <span>${regionDef.label || regionId}</span>
                <button class="add-component-btn" onclick="addComponent('${contentType}', '${contentId}', '${section.uuid}', '${regionId}')">+ Add</button>
              </div>
              <div class="region-slot-content">
                ${componentsHtml}
              </div>
            </div>`;
        }

        // Section wrapper with drag handle (Feature #70)
        sectionsHtml += `
          <div class="section-wrapper" draggable="true" data-section-uuid="${section.uuid}">
            <div class="section-drag-handle" role="button" aria-label="Drag to reorder ${layoutLabel} section" aria-roledescription="drag handle" tabindex="0" title="Drag to reorder">
              <div class="drag-dots"></div>
              <div class="drag-dots"></div>
              <div class="drag-dots"></div>
              <div class="drag-dots"></div>
              <div class="drag-dots"></div>
            </div>
            <div class="section-header">
              <div class="section-header-info">
                <h3>${layoutLabel}</h3>
                <span class="section-layout-badge">${section.layoutId}</span>
              </div>
              <div class="section-header-actions">
                <button onclick="if(confirm('Delete this section?')) deleteSection('${contentType}', '${contentId}', '${section.uuid}')" class="btn-delete-section">Delete</button>
              </div>
            </div>
            <div class="section-body">
              <div class="section-regions-grid regions-${regionCount}">
                ${regionsHtml}
              </div>
            </div>
          </div>`;
      }
    } else {
      sectionsHtml = `
        <div class="empty-layout">
          <div class="empty-icon">📐</div>
          <h3>No Layout Defined</h3>
          <p>This content has no layout sections yet. Click "Add Section" below to start building.</p>
        </div>`;
    }

    // Build layout options HTML for the layout chooser
    let layoutOptionsHtml = '';
    for (const layout of layouts) {
      const regionCount = Object.keys(layout.regions).length;
      // Simple column icons based on region count
      const icon = regionCount === 1 ? '▮' :
                   regionCount === 2 ? '▮▮' :
                   regionCount === 3 ? '▮▮▮' :
                   regionCount === 4 ? '▮▮▮▮' : '▦';

      layoutOptionsHtml += `
        <div class="layout-option" onclick="addSection('${contentType}', '${contentId}', '${layout.id}')">
          <div class="layout-icon">${icon}</div>
          <div class="layout-name">${layout.label}</div>
        </div>`;
    }

    const flash = getFlashMessage(req.url);

    // Build field options for component chooser (Feature #70)
    const schema = content.getSchema(contentType);
    let fieldOptionsHtml = '<option value="">-- Choose a field --</option>';
    if (schema) {
      for (const [fieldName, fieldDef] of Object.entries(schema)) {
        fieldOptionsHtml += `<option value="${fieldName}">${fieldName} (${fieldDef.type || 'text'})</option>`;
      }
    }

    // Build block options for component chooser (Feature #70)
    const blocksService = ctx.services.get('blocks');
    let blockOptionsHtml = '';
    let hasBlocks = false;
    if (blocksService && typeof blocksService.listBlocks === 'function') {
      const blocks = blocksService.listBlocks({ enabled: true });
      const blockItems = blocks.items || blocks || [];
      if (blockItems.length > 0) {
        hasBlocks = true;
        for (const block of blockItems) {
          const blockId = block.id || block.name || '';
          const blockLabel = block.title || block.label || blockId;
          blockOptionsHtml += `<option value="${blockId}">${blockLabel}</option>`;
        }
      }
    }

    const html = renderAdmin('layout-builder-page.html', {
      pageTitle: `Layout: ${contentTitle}`,
      contentType,
      contentId,
      contentTitle,
      hasOverride,
      overrideClass: hasOverride ? 'has-override' : 'using-default',
      overrideLabel: hasOverride ? 'Override' : 'Default Layout',
      sectionsHtml,
      layoutOptionsHtml,
      fieldOptionsHtml,
      blockOptionsHtml,
      hasBlocks,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Layout builder page for content item');

  /**
   * POST /node/:id/layout/add-section - Add a section to content layout
   */
  register('POST', '/node/:id/layout/add-section', async (req, res, params, ctx) => {
    const { id } = params;
    const layoutBuilder = ctx.services.get('layoutBuilder');

    // Parse form body
    const body = await parseFormBody(req);
    const layoutId = body.layoutId;
    const contentType = body.contentType;

    if (!layoutId || !contentType) {
      redirect(res, `/node/${id}/layout?error=` + encodeURIComponent('Missing layoutId or contentType'));
      return;
    }

    try {
      const item = content.read(contentType, id);
      if (!item) {
        redirect(res, `/node/${id}/layout?error=` + encodeURIComponent('Content not found'));
        return;
      }

      // Get or create layout storage
      let storage = layoutBuilder.getEffectiveLayout(contentType, id, item);
      if (!storage || !layoutBuilder.hasContentLayoutOverride(contentType, id)) {
        storage = storage ? layoutBuilder.cloneLayout(storage) : { sections: [] };
      }

      // Create and add section
      const section = layoutBuilder.createSection(layoutId);
      layoutBuilder.addSection(storage, section);

      // Save as per-content override
      await layoutBuilder.setContentLayout(contentType, id, storage);

      redirect(res, `/node/${id}/layout?success=` + encodeURIComponent(`Section "${layoutBuilder.getLayout(layoutId).label}" added`));
    } catch (err) {
      redirect(res, `/node/${id}/layout?error=` + encodeURIComponent(err.message));
    }
  }, 'Add section to content layout');

  /**
   * POST /node/:id/layout/revert - Revert content layout to default
   */
  register('POST', '/node/:id/layout/revert', async (req, res, params, ctx) => {
    const { id } = params;
    const layoutBuilder = ctx.services.get('layoutBuilder');

    // Find content type
    const types = content.listTypes();
    let contentType = null;
    for (const { type } of types) {
      const item = content.read(type, id);
      if (item) {
        contentType = type;
        break;
      }
    }

    if (!contentType) {
      redirect(res, `/admin/content?error=` + encodeURIComponent('Content not found'));
      return;
    }

    try {
      await layoutBuilder.removeContentLayout(contentType, id);
      redirect(res, `/node/${id}/layout?success=` + encodeURIComponent('Layout reverted to default'));
    } catch (err) {
      redirect(res, `/node/${id}/layout?error=` + encodeURIComponent(err.message));
    }
  }, 'Revert content layout to default');

  /**
   * POST /node/:id/layout/save - Save layout with revision tracking (Feature #79)
   *
   * WHY: Explicit save button creates a revision snapshot so editors
   * can track changes and revert if needed.
   */
  register('POST', '/node/:id/layout/save', async (req, res, params, ctx) => {
    const { id } = params;
    const layoutBuilder = ctx.services.get('layoutBuilder');

    // Find content type
    const types = content.listTypes();
    let contentType = null;
    let contentItem = null;
    for (const { type } of types) {
      const item = content.read(type, id);
      if (item) {
        contentType = type;
        contentItem = item;
        break;
      }
    }

    if (!contentType) {
      redirect(res, `/admin/content?error=` + encodeURIComponent('Content not found'));
      return;
    }

    try {
      const layout = layoutBuilder.getEffectiveLayout(contentType, id, contentItem);
      if (layout && layout.sections) {
        layoutBuilder.saveLayoutRevision(contentType, id, layout, 'Manual save');
      }
      redirect(res, `/node/${id}/layout?success=` + encodeURIComponent('Layout saved successfully'));
    } catch (err) {
      redirect(res, `/node/${id}/layout?error=` + encodeURIComponent(err.message));
    }
  }, 'Save layout with revision (Feature #79)');

  /**
   * POST /node/:id/layout/discard - Discard changes, revert to last saved revision (Feature #80)
   *
   * WHY: Allows editors to undo layout changes when they made mistakes.
   * Reverts to the last saved revision or removes the override entirely.
   */
  register('POST', '/node/:id/layout/discard', async (req, res, params, ctx) => {
    const { id } = params;
    const layoutBuilder = ctx.services.get('layoutBuilder');

    // Find content type
    const types = content.listTypes();
    let contentType = null;
    for (const { type } of types) {
      const item = content.read(type, id);
      if (item) {
        contentType = type;
        break;
      }
    }

    if (!contentType) {
      redirect(res, `/admin/content?error=` + encodeURIComponent('Content not found'));
      return;
    }

    try {
      // Get the last saved revision
      const revisions = layoutBuilder.getLayoutRevisions(contentType, id, 1);
      if (revisions.length > 0) {
        await layoutBuilder.revertToLayoutRevision(contentType, id, revisions[0].id);
        redirect(res, `/node/${id}/layout?success=` + encodeURIComponent('Changes discarded - reverted to last saved state'));
      } else {
        // No revisions, revert to default
        await layoutBuilder.removeContentLayout(contentType, id);
        redirect(res, `/node/${id}/layout?success=` + encodeURIComponent('Changes discarded - reverted to default layout'));
      }
    } catch (err) {
      redirect(res, `/node/${id}/layout?error=` + encodeURIComponent(err.message));
    }
  }, 'Discard layout changes (Feature #80)');

  /**
   * GET /node/:id/layout/revisions - Layout revision history page (Feature #83)
   *
   * WHY: Provides a dedicated page for viewing and reverting layout history.
   * Supplements the inline revision panel in the layout builder.
   */
  register('GET', '/node/:id/layout/revisions', async (req, res, params, ctx) => {
    const { id } = params;
    const layoutBuilder = ctx.services.get('layoutBuilder');
    const server = ctx.services.get('server');

    // Find content type
    const types = content.listTypes();
    let contentType = null;
    let contentItem = null;
    for (const { type } of types) {
      const item = content.read(type, id);
      if (item) {
        contentType = type;
        contentItem = item;
        break;
      }
    }

    if (!contentItem) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<!DOCTYPE html><html><body><h1>404 - Content Not Found</h1></body></html>');
      return;
    }

    const contentTitle = contentItem.title || contentItem.name || id;
    const revisions = layoutBuilder.getLayoutRevisions(contentType, id, 50);

    // Support JSON format for the inline revision panel (AJAX)
    const reqUrl = new URL(req.url, `http://${req.headers.host}`);
    if (reqUrl.searchParams.get('format') === 'json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ revisions, count: revisions.length }));
      return;
    }

    const flash = getFlashMessage(req.url);

    let revisionsHtml = '';
    if (revisions.length === 0) {
      revisionsHtml = '<tr><td colspan="5" style="text-align:center; padding:30px; color:#999;">No revisions yet. Save the layout to create the first revision.</td></tr>';
    } else {
      for (let i = 0; i < revisions.length; i++) {
        const rev = revisions[i];
        const date = new Date(rev.timestamp);
        const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
        const isCurrent = i === 0 ? ' <span style="background:#4caf50;color:white;padding:1px 6px;border-radius:10px;font-size:0.8em;">current</span>' : '';

        revisionsHtml += `
          <tr style="border-bottom:1px solid #eee;">
            <td style="padding:10px;">${dateStr}${isCurrent}</td>
            <td style="padding:10px; color:#666;">${rev.message || '-'}</td>
            <td style="text-align:center; padding:10px;">${rev.sectionCount || 0}</td>
            <td style="text-align:center; padding:10px;">${rev.componentCount || 0}</td>
            <td style="text-align:center; padding:10px;">
              ${i > 0 ?
                `<form action="/node/${id}/layout/revisions/${rev.id}/revert" method="POST" style="display:inline;">
                  <button type="submit" style="background:#ff9800;color:white;border:none;padding:5px 12px;border-radius:4px;cursor:pointer;" onclick="return confirm('Revert to this revision?')">Revert</button>
                </form>` :
                '<span style="color:#999; font-size:0.9em;">Latest</span>'
              }
            </td>
          </tr>`;
      }
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Layout Revisions: ${contentTitle}</title>
  <link rel="stylesheet" href="/css/admin.css">
</head>
<body>
  <nav class="admin-nav">
    <a href="/node/${id}/layout">&larr; Back to Layout Builder</a>
    <span style="margin: 0 10px; color: #999;">|</span>
    <a href="/admin/content/${contentType}/${id}/edit">Edit Content</a>
  </nav>
  <main class="admin-main">
    <h1>📋 Layout Revision History</h1>
    <p style="color:#666;">Content: <strong>${contentTitle}</strong> (${contentType}/${id})</p>
    ${flash ? `<div class="flash flash-${flash.type}">${flash.message}</div>` : ''}
    <table style="width:100%; border-collapse:collapse; background:white; border-radius:8px; overflow:hidden; box-shadow:0 1px 4px rgba(0,0,0,0.1);">
      <thead>
        <tr style="background:#f5f5f5; border-bottom:2px solid #ddd;">
          <th style="text-align:left; padding:12px;">Timestamp</th>
          <th style="text-align:left; padding:12px;">Message</th>
          <th style="text-align:center; padding:12px;">Sections</th>
          <th style="text-align:center; padding:12px;">Components</th>
          <th style="text-align:center; padding:12px;">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${revisionsHtml}
      </tbody>
    </table>
  </main>
</body>
</html>`;

    server.html(res, html);
  }, 'Layout revision history page (Feature #83)');

  /**
   * POST /node/:id/layout/revisions/:revisionId/revert - Revert to revision (Feature #83)
   */
  register('POST', '/node/:id/layout/revisions/:revisionId/revert', async (req, res, params, ctx) => {
    const { id, revisionId } = params;
    const layoutBuilder = ctx.services.get('layoutBuilder');

    // Find content type
    const types = content.listTypes();
    let contentType = null;
    for (const { type } of types) {
      const item = content.read(type, id);
      if (item) {
        contentType = type;
        break;
      }
    }

    if (!contentType) {
      redirect(res, `/admin/content?error=` + encodeURIComponent('Content not found'));
      return;
    }

    try {
      await layoutBuilder.revertToLayoutRevision(contentType, id, revisionId);
      redirect(res, `/node/${id}/layout?success=` + encodeURIComponent('Layout reverted to previous revision'));
    } catch (err) {
      redirect(res, `/node/${id}/layout?error=` + encodeURIComponent(err.message));
    }
  }, 'Revert to layout revision (Feature #83)');

  /**
   * Helper: Format value for display
   */
  function formatValue(value) {
    if (value === null || value === undefined) return '(empty)';
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    if (typeof value === 'string' && value.length > 200) {
      return value.substring(0, 200) + '...';
    }
    return String(value);
  }

  /**
   * Helper: Get a display title from content object
   */
  function getContentTitle(content) {
    if (!content) return '(deleted)';
    return content.title || content.name || content.subject || content.username || content.id;
  }
}
