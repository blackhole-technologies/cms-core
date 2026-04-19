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
   */
  register('views:list', async (args, ctx) => {
    const viewsService = ctx.services.get('views');
    if (!viewsService) {
      console.log('Views service not available');
      return;
    }

    const views = viewsService.listViews();
    if (views.length === 0) {
      console.log('No views defined');
      return;
    }

    console.log(`\nViews (${views.length}):\n`);
    for (const view of views) {
      console.log(`  ${view.id} - ${view.contentType} (${view.filters?.length || 0} filters, ${view.sorts?.length || 0} sorts)`);
    }
    console.log('');
  }, 'List all views');

  /**
   * views:show <id> - Show view config
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

    const view = viewsService.getView(id);
    if (!view) {
      console.log(`View not found: ${id}`);
      return;
    }

    console.log('\nView:', id);
    console.log('Content Type:', view.contentType);
    console.log('Filters:', JSON.stringify(view.filters, null, 2));
    console.log('Sorts:', JSON.stringify(view.sorts, null, 2));
    console.log('');
  }, 'Show view config');

  /**
   * views:create <id> --type=<contentType> - Create view
   */
  register('views:create', async (args, ctx) => {
    const viewsService = ctx.services.get('views');
    if (!viewsService) {
      console.log('Views service not available');
      return;
    }

    const id = args[0];
    if (!id) {
      console.log('Usage: views:create <id> --type=<contentType>');
      return;
    }

    const typeArg = args.find(a => a.startsWith('--type='));
    if (!typeArg) {
      console.log('Error: --type=<contentType> required');
      return;
    }

    const contentType = typeArg.split('=')[1];
    viewsService.createView(id, { contentType, filters: [], sorts: [] });
    console.log(`Created view: ${id}`);
  }, 'Create view');

  /**
   * views:delete <id> - Delete view
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

    viewsService.deleteView(id);
    console.log(`Deleted view: ${id}`);
  }, 'Delete view');

  /**
   * views:execute <id> [--limit=N] - Run view query
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

    const limitArg = args.find(a => a.startsWith('--limit='));
    const limit = limitArg ? parseInt(limitArg.split('=')[1]) : undefined;

    const results = viewsService.executeView(id, { limit });
    console.log(`\nView: ${id} (${results.length} results)\n`);
    for (const item of results) {
      const title = item.title || item.name || item.id;
      console.log(`  - ${item.id}: ${title}`);
    }
    console.log('');
  }, 'Run view query');

  /**
   * views:export <id> - Export view config
   */
  register('views:export', async (args, ctx) => {
    const viewsService = ctx.services.get('views');
    if (!viewsService) {
      console.log('Views service not available');
      return;
    }

    const id = args[0];
    if (!id) {
      console.log('Usage: views:export <id>');
      return;
    }

    const view = viewsService.getView(id);
    if (!view) {
      console.log(`View not found: ${id}`);
      return;
    }

    console.log(JSON.stringify(view, null, 2));
  }, 'Export view config');

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
    let stylesService;
    try { stylesService = ctx.services.get('imageStyles'); } catch (e) {
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
    let stylesService;
    try { stylesService = ctx.services.get('imageStyles'); } catch (e) {
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
    let stylesService;
    try { stylesService = ctx.services.get('imageStyles'); } catch (e) {
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
    let stylesService;
    try { stylesService = ctx.services.get('imageStyles'); } catch (e) {
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
   */
  register('config:list', async (args, ctx) => {
    const configService = ctx.services.get('config');
    if (!configService) {
      console.log('Config service not available');
      return;
    }

    const items = configService.listItems();
    if (items.length === 0) {
      console.log('No config items');
      return;
    }

    console.log(`\nConfig Items (${items.length}):\n`);
    for (const item of items) {
      console.log(`  ${item.key} = ${JSON.stringify(item.value)}`);
    }
    console.log('');
  }, 'List config items');

  /**
   * config:export [--items=a,b,c] - Export config
   */
  register('config:export', async (args, ctx) => {
    const configService = ctx.services.get('config');
    if (!configService) {
      console.log('Config service not available');
      return;
    }

    const itemsArg = args.find(a => a.startsWith('--items='));
    const items = itemsArg ? itemsArg.split('=')[1].split(',') : undefined;

    const exported = configService.exportConfig(items);
    console.log(JSON.stringify(exported, null, 2));
  }, 'Export config');

  /**
   * config:import <file> - Import config
   */
  register('config:import', async (args, ctx) => {
    const configService = ctx.services.get('config');
    if (!configService) {
      console.log('Config service not available');
      return;
    }

    const file = args[0];
    if (!file) {
      console.log('Usage: config:import <file>');
      return;
    }

    try {
      const { readFileSync } = await import('node:fs');
      const data = JSON.parse(readFileSync(file, 'utf-8'));
      configService.importConfig(data);
      console.log(`Imported config from ${file}`);
    } catch (error) {
      console.log(`Error: ${error.message}`);
    }
  }, 'Import config');

  /**
   * config:diff <file> - Show diff
   */
  register('config:diff', async (args, ctx) => {
    const configService = ctx.services.get('config');
    if (!configService) {
      console.log('Config service not available');
      return;
    }

    const file = args[0];
    if (!file) {
      console.log('Usage: config:diff <file>');
      return;
    }

    try {
      const { readFileSync } = await import('node:fs');
      const data = JSON.parse(readFileSync(file, 'utf-8'));
      const diff = configService.diffConfig(data);

      console.log('\nConfig Diff:\n');
      for (const item of diff) {
        console.log(`  ${item.key}:`);
        console.log(`    current: ${JSON.stringify(item.current)}`);
        console.log(`    incoming: ${JSON.stringify(item.incoming)}`);
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
    let tokenService;
    try { tokenService = ctx.services.get('tokens'); } catch (e) {
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
    let tokenService;
    try { tokenService = ctx.services.get('tokens'); } catch (e) {
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
    let actionService;
    try { actionService = ctx.services.get('actions'); } catch (e) {
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
    let actionService;
    try { actionService = ctx.services.get('actions'); } catch (e) {
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
    const themeService = ctx.services.get('theme');
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
    const themeService = ctx.services.get('theme');
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
    const themeService = ctx.services.get('theme');
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
    const themeService = ctx.services.get('theme');
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
    const themeService = ctx.services.get('theme');
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

    const adminTemplate = loadTemplate(templateName);
    const pageContent = template.renderString(adminTemplate, {
      ...data,
      csrfToken, // Inject for {{csrfField}} helper
    });

    // Determine active nav item from request path
    const path = req?.url?.split('?')[0] || '/admin';
    const navDashboard = path === '/admin';
    const navContent = path.startsWith('/admin/content') || path.startsWith('/admin/comments') || path.startsWith('/admin/trash');
    const navStructure = path.startsWith('/admin/structure') || path.startsWith('/admin/views') || path.startsWith('/admin/menus') || path.startsWith('/admin/taxonomy') || path.startsWith('/admin/blocks') || path.startsWith('/admin/blueprints');
    const navAppearance = path.startsWith('/admin/appearance') || path.startsWith('/admin/themes');
    const navModules = path === '/admin/modules' || path.startsWith('/admin/modules/');
    const navConfig = path.startsWith('/admin/config') || path.startsWith('/admin/cron') || path.startsWith('/admin/aliases') || path.startsWith('/admin/text-formats') || path.startsWith('/admin/image-styles') || path.startsWith('/admin/tokens') || path.startsWith('/admin/regions') || path.startsWith('/admin/seo') || path.startsWith('/admin/contact-forms') || path.startsWith('/admin/feeds') || path.startsWith('/admin/api') || path.startsWith('/admin/graphql');
    const navPeople = path.startsWith('/admin/users') || path.startsWith('/admin/permissions') || path.startsWith('/admin/roles');
    const navReports = path.startsWith('/admin/reports') || path.startsWith('/admin/analytics') || path.startsWith('/admin/audit') || path.startsWith('/admin/cache') || path.startsWith('/admin/queue') || path.startsWith('/admin/ratelimit');

    const username = ctx.session?.user?.username || 'admin';
    const usernameInitial = username.charAt(0).toUpperCase();

    return template.renderWithLayout('admin-layout.html', pageContent, {
      title: data.pageTitle || 'Admin',
      siteName: ctx.config.site.name,
      version: ctx.config.site.version,
      csrfToken,
      username,
      usernameInitial,
      navDashboard, navContent, navStructure, navAppearance,
      navModules, navConfig, navPeople, navReports,
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

      return {
        ...item,
        type, // Include type for links
        status: item.status || 'draft',
        createdFormatted: formatDate(item.created),
        updatedFormatted: formatDate(item.updated),
        scheduledAtFormatted: item.scheduledAt ? formatDate(item.scheduledAt) : null,
        preview: previewParts.join('\n'),
        isFavorite,
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

      // Persist SEO metatag fields (not in schema, stored directly on content)
      if (formData.meta_title) data.metaTitle = formData.meta_title;
      if (formData.meta_description) data.metaDescription = formData.meta_description;
      if (formData.og_image) data.ogImage = formData.og_image;

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

      // Persist SEO metatag fields (not in schema, stored directly on content)
      if (formData.meta_title !== undefined) data.metaTitle = formData.meta_title || '';
      if (formData.meta_description !== undefined) data.metaDescription = formData.meta_description || '';
      if (formData.og_image !== undefined) data.ogImage = formData.og_image || '';

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

  /**
   * POST /admin/modules/:name/enable - Enable a module
   */
  register('POST', '/admin/modules/:name/enable', async (req, res, params, ctx) => {
    const { name } = params;
    try {
      const configPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'config', 'modules.json');
      const { readFileSync, writeFileSync } = await import('node:fs');
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));

      if (!config.enabled.includes(name)) {
        config.enabled.push(name);
        writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
      }

      redirect(res, '/admin/modules?success=' + encodeURIComponent(`Module "${name}" enabled. Restart the server for changes to take effect.`));
    } catch (error) {
      redirect(res, '/admin/modules?error=' + encodeURIComponent(`Failed to enable module: ${error.message}`));
    }
  }, 'Enable module');

  /**
   * POST /admin/modules/:name/disable - Disable a module
   */
  register('POST', '/admin/modules/:name/disable', async (req, res, params, ctx) => {
    const { name } = params;

    // Prevent disabling the admin module itself
    if (name === 'admin') {
      redirect(res, '/admin/modules?error=' + encodeURIComponent('Cannot disable the admin module.'));
      return;
    }

    try {
      const configPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'config', 'modules.json');
      const { readFileSync, writeFileSync } = await import('node:fs');
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));

      config.enabled = config.enabled.filter(m => m !== name);
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

      redirect(res, '/admin/modules?success=' + encodeURIComponent(`Module "${name}" disabled. Restart the server for changes to take effect.`));
    } catch (error) {
      redirect(res, '/admin/modules?error=' + encodeURIComponent(`Failed to disable module: ${error.message}`));
    }
  }, 'Disable module');

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
      // Pre-compute config status badges — template engine doesn't support {{else if}}
      const configBadge = (cfg) => {
        if (cfg.imported) return '<span class="badge badge-success">Imported</span>';
        if (cfg.wouldImport) return '<span class="badge badge-info">Would Import</span>';
        return '<span class="badge badge-secondary">Skipped</span>';
      };
      const siteBadgeHtml = configBadge(result.config?.site || {});
      const modulesBadgeHtml = configBadge(result.config?.modules || {});
      if (result.config?.modules?.imported) {
        modulesBadgeHtml.replace('Imported', 'Imported (restart required)');
      }

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
        siteBadgeHtml,
        modulesBadgeHtml: result.config?.modules?.imported
          ? '<span class="badge badge-success">Imported (restart required)</span>'
          : modulesBadgeHtml,
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

  /**
   * POST /admin/autosave - Server-side autosave drafts
   *
   * Drupal parity: autosave_form server-side persistence.
   * Stores draft data so it survives browser crashes and can be
   * recovered from other devices.
   */
  register('POST', '/admin/autosave', async (req, res, params, ctx) => {
    try {
      let body = ctx._parsedBody;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = {}; }
      }

      const path = body.path || '';
      const data = body.data || {};
      const userId = req.user?.id || 'anonymous';

      if (!path) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'path required' }));
        return;
      }

      // Store draft in content/.drafts/<userId>/<sanitized-path>.json
      const { mkdirSync, writeFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const safePath = path.replace(/[^a-zA-Z0-9_/-]/g, '_').replace(/\//g, '__');
      const draftDir = join(process.cwd(), 'content', '.drafts', userId);
      mkdirSync(draftDir, { recursive: true });
      writeFileSync(
        join(draftDir, safePath + '.json'),
        JSON.stringify({ path, data, userId, saved: new Date().toISOString() }, null, 2)
      );

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }, 'Autosave draft');

  // ==========================================
  // AI Editor Assistant
  // ==========================================

  /**
   * POST /api/ai/editor-assist - AI writing assistant for content fields
   * Actions: rewrite, summarize, expand, tone-formal, tone-casual, fix-grammar
   */
  register('POST', '/api/ai/editor-assist', async (req, res, params, ctx) => {
    try {
      let body = ctx._parsedBody;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = {}; }
      }

      const { text, action } = body;
      if (!text || !action) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'text and action are required' }));
        return;
      }

      // Map actions to system prompts
      const prompts = {
        'rewrite': 'Rewrite the following text to improve clarity and flow while preserving its meaning. Return only the rewritten text with no preamble.',
        'summarize': 'Summarize the following text in 1-3 concise sentences. Return only the summary.',
        'expand': 'Expand the following text with more detail, examples, and explanation. Return only the expanded text.',
        'tone-formal': 'Rewrite the following text in a formal, professional tone. Return only the rewritten text.',
        'tone-casual': 'Rewrite the following text in a friendly, casual tone. Return only the rewritten text.',
        'fix-grammar': 'Fix any grammar, spelling, and punctuation errors in the following text. Return only the corrected text.',
      };

      const systemPrompt = prompts[action];
      if (!systemPrompt) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unknown action: ' + action }));
        return;
      }

      // Try to use AI provider
      let providerManager;
      try { providerManager = ctx.services.get('ai-provider-manager'); } catch { providerManager = null; }

      if (providerManager) {
        const result = await providerManager.routeToProvider('chat', [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ]);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result: result.content || result.text || String(result) }));
      } else {
        // Fallback: simple transformations when no AI provider is configured
        let result = text;
        if (action === 'summarize') {
          const sentences = text.split(/[.!?]+/).filter(s => s.trim());
          result = sentences.slice(0, 3).join('. ').trim() + '.';
        } else if (action === 'fix-grammar') {
          result = text.replace(/\s{2,}/g, ' ').trim();
          result = result.charAt(0).toUpperCase() + result.slice(1);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result, fallback: true }));
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }, 'AI editor writing assistant');

  /**
   * POST /api/ai/auto-fill - AI field auto-fill for content forms
   * Given a content body, suggests values for title, summary, tags, slug
   */
  register('POST', '/api/ai/auto-fill', async (req, res, params, ctx) => {
    try {
      let body = ctx._parsedBody;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = {}; }
      }

      const { text, fields } = body;
      if (!text) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'text is required' }));
        return;
      }

      // Fields to auto-fill (defaults to all)
      const requestedFields = fields || ['title', 'summary', 'tags', 'slug'];

      let providerManager;
      try { providerManager = ctx.services.get('ai-provider-manager'); } catch { providerManager = null; }

      if (providerManager) {
        const systemPrompt = `Given the following content, generate JSON with these fields: ${requestedFields.join(', ')}. Rules: title should be compelling (max 70 chars), summary should be 1-2 sentences, tags should be an array of 3-5 relevant keywords, slug should be URL-friendly lowercase with hyphens. Return valid JSON only.`;

        const result = await providerManager.routeToProvider('chat', [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text.slice(0, 2000) },
        ]);

        let parsed;
        try {
          const raw = result.content || result.text || String(result);
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
        } catch { parsed = {}; }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ suggestions: parsed }));
      } else {
        // Fallback: basic extraction without AI
        const words = text.split(/\s+/).filter(w => w.length > 3);
        const firstSentence = text.split(/[.!?]/)[0]?.trim() || '';
        const suggestions = {};

        if (requestedFields.includes('title')) {
          suggestions.title = firstSentence.slice(0, 70);
        }
        if (requestedFields.includes('summary')) {
          suggestions.summary = text.split(/[.!?]/).slice(0, 2).join('. ').trim() + '.';
        }
        if (requestedFields.includes('tags')) {
          // Simple keyword extraction: most frequent significant words
          const freq = {};
          words.forEach(w => { const lw = w.toLowerCase().replace(/[^a-z]/g, ''); if (lw.length > 3) freq[lw] = (freq[lw] || 0) + 1; });
          suggestions.tags = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]);
        }
        if (requestedFields.includes('slug')) {
          suggestions.slug = firstSentence.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ suggestions, fallback: true }));
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }, 'AI field auto-fill');

  /**
   * POST /api/ai/content-suggestions - AI content improvement suggestions
   * Analyzes content and returns actionable suggestions.
   */
  register('POST', '/api/ai/content-suggestions', async (req, res, params, ctx) => {
    try {
      let body = ctx._parsedBody;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = {}; }
      }

      const { text, type } = body;
      if (!text) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'text is required' }));
        return;
      }

      let providerManager;
      try { providerManager = ctx.services.get('ai-provider-manager'); } catch { providerManager = null; }

      if (providerManager) {
        const result = await providerManager.routeToProvider('chat', [
          { role: 'system', content: 'You are a content editor. Analyze the text and return JSON: { "suggestions": [{ "type": "readability|seo|structure|engagement", "severity": "info|warning|error", "message": "...", "fix": "..." }], "score": 0-100 }. Be specific and actionable. Return valid JSON only.' },
          { role: 'user', content: text.slice(0, 3000) },
        ]);
        let parsed;
        try {
          const raw = result.content || result.text || String(result);
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { suggestions: [], score: 50 };
        } catch { parsed = { suggestions: [], score: 50 }; }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(parsed));
      } else {
        // Fallback: basic heuristic suggestions
        const suggestions = [];
        const words = text.split(/\s+/).length;
        const sentences = text.split(/[.!?]+/).filter(s => s.trim()).length;
        const avgWordLen = text.replace(/\s+/g, '').length / (words || 1);

        if (words < 100) suggestions.push({ type: 'engagement', severity: 'warning', message: 'Content is quite short. Consider expanding to at least 300 words for better engagement.', fix: 'Add more detail, examples, or context.' });
        if (words > 2000) suggestions.push({ type: 'readability', severity: 'info', message: 'Content is lengthy. Consider adding subheadings to break it up.', fix: 'Add h2/h3 headings every 300-500 words.' });
        if (avgWordLen > 6) suggestions.push({ type: 'readability', severity: 'info', message: 'Average word length is high. Consider simpler language.', fix: 'Replace complex words with simpler alternatives.' });
        if (sentences > 0 && words / sentences > 25) suggestions.push({ type: 'readability', severity: 'warning', message: 'Sentences are long. Aim for 15-20 words per sentence.', fix: 'Break long sentences into shorter ones.' });
        if (!text.includes('\n\n') && words > 200) suggestions.push({ type: 'structure', severity: 'warning', message: 'No paragraph breaks found.', fix: 'Add blank lines between paragraphs.' });

        const score = Math.max(20, Math.min(100, 80 - suggestions.length * 12));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ suggestions, score, fallback: true }));
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }, 'AI content suggestions');

  /**
   * POST /api/ai/translate - AI-powered content translation
   */
  register('POST', '/api/ai/translate', async (req, res, params, ctx) => {
    try {
      let body = ctx._parsedBody;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = {}; }
      }

      const { text, targetLanguage, sourceLanguage } = body;
      if (!text || !targetLanguage) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'text and targetLanguage are required' }));
        return;
      }

      let providerManager;
      try { providerManager = ctx.services.get('ai-provider-manager'); } catch { providerManager = null; }

      if (!providerManager) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No AI provider configured. Translation requires an AI provider.' }));
        return;
      }

      const srcLang = sourceLanguage || 'auto-detect';
      const result = await providerManager.routeToProvider('chat', [
        { role: 'system', content: `Translate the following text from ${srcLang} to ${targetLanguage}. Preserve formatting (HTML tags, markdown). Return only the translated text with no preamble.` },
        { role: 'user', content: text },
      ]);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ translation: result.content || result.text || String(result), targetLanguage }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }, 'AI translation');

  /**
   * POST /api/ai/validate - AI content validation (quality, tone, policy compliance)
   */
  register('POST', '/api/ai/validate', async (req, res, params, ctx) => {
    try {
      let body = ctx._parsedBody;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = {}; }
      }

      const { text, rules } = body;
      if (!text) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'text is required' }));
        return;
      }

      let providerManager;
      try { providerManager = ctx.services.get('ai-provider-manager'); } catch { providerManager = null; }

      const ruleList = rules || ['no profanity', 'professional tone', 'factual claims need sources', 'no placeholder text'];

      if (providerManager) {
        const result = await providerManager.routeToProvider('chat', [
          { role: 'system', content: `You are a content validator. Check the text against these rules: ${ruleList.join(', ')}. Return JSON: { "valid": true/false, "issues": [{ "rule": "...", "severity": "error|warning", "message": "...", "location": "..." }] }. Return valid JSON only.` },
          { role: 'user', content: text.slice(0, 3000) },
        ]);
        let parsed;
        try {
          const raw = result.content || result.text || String(result);
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { valid: true, issues: [] };
        } catch { parsed = { valid: true, issues: [] }; }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(parsed));
      } else {
        // Fallback: basic text validation
        const issues = [];
        if (/lorem ipsum/i.test(text)) issues.push({ rule: 'no placeholder text', severity: 'error', message: 'Contains Lorem Ipsum placeholder text' });
        if (/TODO|FIXME|XXX/i.test(text)) issues.push({ rule: 'no placeholder text', severity: 'warning', message: 'Contains TODO/FIXME markers' });
        if (text.length < 50) issues.push({ rule: 'minimum length', severity: 'warning', message: 'Content is very short' });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ valid: issues.length === 0, issues, fallback: true }));
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }, 'AI content validation');

  /**
   * GET /admin/ai-explorer - Interactive AI API testing UI
   */
  register('GET', '/admin/ai-explorer', async (req, res, params, ctx) => {
    const explorerHtml = `
      <div class="admin-breadcrumb">
        <a href="/admin">Home</a> <span>&rsaquo;</span>
        <span>AI API Explorer</span>
      </div>
      <h1 class="admin-page-title">AI API Explorer</h1>
      <p class="admin-page-description">Test AI endpoints interactively.</p>

      <div class="admin-panel" style="margin-bottom:var(--gin-space-6)">
        <div class="admin-panel-header"><h2>Request</h2></div>
        <div class="admin-panel-body">
          <div class="form-group" style="margin-bottom:var(--gin-space-3)">
            <label>Endpoint</label>
            <select id="aiEndpoint" class="form-input">
              <option value="/api/ai/editor-assist">Editor Assist (rewrite/summarize/expand)</option>
              <option value="/api/ai/auto-fill">Auto-fill (title/summary/tags/slug)</option>
              <option value="/api/ai/content-suggestions">Content Suggestions</option>
              <option value="/api/ai/translate">Translate</option>
              <option value="/api/ai/validate">Validate</option>
              <option value="/api/search/semantic">Semantic Search (GET)</option>
            </select>
          </div>
          <div class="form-group" id="actionGroup" style="margin-bottom:var(--gin-space-3)">
            <label>Action (for editor-assist)</label>
            <select id="aiAction" class="form-input">
              <option value="rewrite">Rewrite</option>
              <option value="summarize">Summarize</option>
              <option value="expand">Expand</option>
              <option value="tone-formal">Formal Tone</option>
              <option value="tone-casual">Casual Tone</option>
              <option value="fix-grammar">Fix Grammar</option>
            </select>
          </div>
          <div class="form-group" id="langGroup" style="margin-bottom:var(--gin-space-3);display:none">
            <label>Target Language</label>
            <input type="text" id="aiLang" class="form-input" value="Spanish" placeholder="e.g. Spanish, French, German">
          </div>
          <div class="form-group" style="margin-bottom:var(--gin-space-3)">
            <label>Input Text</label>
            <textarea id="aiInput" class="form-input" rows="6" placeholder="Enter text to process..."></textarea>
          </div>
          <button type="button" class="btn btn-primary" id="aiSendBtn" onclick="sendAIRequest()">Send Request</button>
        </div>
      </div>

      <div class="admin-panel">
        <div class="admin-panel-header"><h2>Response</h2></div>
        <div class="admin-panel-body">
          <div id="aiTiming" style="font-size:var(--gin-font-size-xs);color:var(--gin-text-muted);margin-bottom:var(--gin-space-2)"></div>
          <pre id="aiOutput" style="background:var(--gin-bg);padding:var(--gin-space-4);border-radius:var(--gin-radius);overflow-x:auto;font-size:var(--gin-font-size-sm);white-space:pre-wrap;min-height:100px">No response yet. Send a request above.</pre>
        </div>
      </div>

      <script>
      document.getElementById('aiEndpoint').addEventListener('change', function() {
        var v = this.value;
        document.getElementById('actionGroup').style.display = v === '/api/ai/editor-assist' ? '' : 'none';
        document.getElementById('langGroup').style.display = v === '/api/ai/translate' ? '' : 'none';
      });

      function sendAIRequest() {
        var endpoint = document.getElementById('aiEndpoint').value;
        var text = document.getElementById('aiInput').value.trim();
        if (!text) { alert('Enter some text first.'); return; }

        var btn = document.getElementById('aiSendBtn');
        btn.disabled = true; btn.textContent = 'Sending...';
        var start = Date.now();

        var csrfMeta = document.querySelector('meta[name="csrf-token"]');
        var headers = { 'Content-Type': 'application/json' };
        if (csrfMeta) headers['X-CSRF-Token'] = csrfMeta.content;

        var isGet = endpoint.startsWith('/api/search');
        var url = isGet ? endpoint + '?q=' + encodeURIComponent(text) : endpoint;
        var opts = isGet ? { method: 'GET', headers: headers } : {
          method: 'POST', headers: headers,
          body: JSON.stringify({
            text: text,
            action: document.getElementById('aiAction').value,
            targetLanguage: document.getElementById('aiLang').value,
          })
        };

        fetch(url, opts)
          .then(function(r) { return r.json(); })
          .then(function(data) {
            document.getElementById('aiOutput').textContent = JSON.stringify(data, null, 2);
            document.getElementById('aiTiming').textContent = 'Response in ' + (Date.now() - start) + 'ms';
          })
          .catch(function(err) {
            document.getElementById('aiOutput').textContent = 'Error: ' + err.message;
          })
          .finally(function() { btn.disabled = false; btn.textContent = 'Send Request'; });
      }
      </script>
    `;

    const templateSvc = ctx.services.get('template');
    const csrfToken = auth.getCSRFToken(req);
    const username = ctx.session?.user?.username || 'admin';
    const page = templateSvc.renderWithLayout('admin-layout.html', explorerHtml, {
      title: 'AI API Explorer',
      siteName: ctx.config.site.name,
      version: ctx.config.site.version,
      csrfToken,
      username,
      usernameInitial: username.charAt(0).toUpperCase(),
      navReports: true,
    });
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(page);
  }, 'AI API Explorer');

  // ==========================================
  // Server Restart
  // ==========================================

  /**
   * POST /admin/restart - Gracefully restart the server process
   * Useful after enabling/disabling modules or changing themes.
   */
  register('POST', '/admin/restart', async (req, res, params, ctx) => {
    // Only allow admins (user is attached to req by auth middleware)
    if (!req.user || req.user.role !== 'admin') {
      res.writeHead(403, { 'Content-Type': 'text/html' });
      res.end('<h1>403 Forbidden</h1><p>Admin access required.</p><p><a href="/admin">Back to Dashboard</a></p>');
      return;
    }

    // Send a success response before restarting so the browser gets the redirect
    redirect(res, '/admin?success=' + encodeURIComponent('Server is restarting... Please wait a moment and refresh.'));

    // Schedule restart after response is sent (short delay to let the response flush)
    setTimeout(() => {
      console.log('[admin] Server restart requested by admin user');
      process.exit(0);
    }, 500);
  }, 'Restart server');

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

  /**
   * GET /search - Public search page
   */
  register('GET', '/search', async (req, res, params, ctx) => {
    const searchService = ctx.services.get('search');
    const templateService = ctx.services.get('template');

    const url = new URL(req.url, 'http://localhost');
    const query = url.searchParams.get('q') || '';
    const selectedType = url.searchParams.get('type') || '';

    let results = [];
    let total = 0;
    let took = 0;

    if (query) {
      const searchTypes = selectedType ? [selectedType] : null;
      const searchResult = searchService.search(query, {
        types: searchTypes,
        limit: 20,
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

    const searchHtml = `
      <div class="search-page">
        <h1>Search</h1>
        <form method="GET" action="/search" class="search-form" style="margin-bottom:2rem">
          <input type="text" name="q" value="${templateService.escapeHtml(query)}" placeholder="Search..." style="padding:8px 12px;border:1px solid #d4d4d8;border-radius:8px;font-size:16px;width:100%;max-width:500px">
          <button type="submit" style="padding:8px 16px;background:#2c59ee;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:500;margin-left:8px">Search</button>
        </form>
        ${query ? `<p style="color:#71727a;font-size:14px;margin-bottom:1.5rem">${total} result(s) for &ldquo;${templateService.escapeHtml(query)}&rdquo; (${took}ms)</p>` : ''}
        ${results.length > 0 ? `
          <div class="search-results-list">
            ${results.map(r => `
              <div style="margin-bottom:1.5rem;padding-bottom:1.5rem;border-bottom:1px solid rgba(0,0,0,0.08)">
                <a href="/admin/content/${r.type}/${r.id}/edit" style="font-size:18px;font-weight:600;color:#2c59ee;text-decoration:none">${r.title || r.id}</a>
                <span style="display:inline-block;padding:2px 8px;background:rgba(0,0,0,0.06);border-radius:999px;font-size:12px;margin-left:8px">${r.type}</span>
                ${r.highlights ? r.highlights.map(h => `<p style="font-size:14px;color:#545560;margin:4px 0 0">${h.value}</p>`).join('') : ''}
              </div>
            `).join('')}
          </div>
        ` : (query ? '<p style="color:#71727a">No results found.</p>' : '<p style="color:#71727a">Enter a search term above.</p>')}
      </div>

      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "SearchResultsPage",
        "name": "Search Results"
      }
      </script>
    `;

    const html = templateService.renderWithLayout('layout.html', searchHtml, {
      title: query ? `Search: ${query}` : 'Search',
      siteName: ctx.config.site.name,
      version: ctx.config.site.version,
    });

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }, 'Public search page');

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
      redirect(res, '/login?error=' + encodeURIComponent('Please log in to view favorites'));
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
      redirect(res, '/login');
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
        redirect(res, '/login');
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
      redirect(res, '/login');
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
    // WHY pre-compute cellHtml: template engine doesn't support {{else if}} chains
    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const fields = Object.entries(comparison.fields).map(([name, data]) => {
      const fmtA = formatValue(data.a);
      const fmtB = formatValue(data.b);
      const fmtV = formatValue(data.value);
      let leftCellHtml, rightCellHtml;
      if (data.status === 'unchanged') {
        leftCellHtml = `<span class="unchanged-value">${esc(fmtV)}</span>`;
        rightCellHtml = leftCellHtml;
      } else if (data.status === 'removed') {
        leftCellHtml = `<span class="removed-value">${esc(fmtA)}</span>`;
        rightCellHtml = '<span class="empty-value">—</span>';
      } else if (data.status === 'added') {
        leftCellHtml = '<span class="empty-value">—</span>';
        rightCellHtml = `<span class="added-value">${esc(fmtB)}</span>`;
      } else if (data.status === 'modified') {
        leftCellHtml = `<span class="old-value">${esc(fmtA)}</span>`;
        rightCellHtml = `<span class="new-value">${esc(fmtB)}</span>`;
      } else {
        leftCellHtml = '<span class="empty-value">—</span>';
        rightCellHtml = '<span class="empty-value">—</span>';
      }
      // Pre-compute diff line prefixes
      const diffLines = data.diff && data.diff.changes ? data.diff.changes.map(c => ({
        ...c,
        prefix: c.type === 'added' ? '+' : c.type === 'removed' ? '-' : ' ',
      })) : null;
      return {
        name,
        status: data.status,
        leftCellHtml,
        rightCellHtml,
        diff: diffLines,
        hasDiff: diffLines && diffLines.length > 0,
      };
    });

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

    const html = renderAdmin('activity-feed.html', {
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
      csrfToken: auth.getCSRFToken ? auth.getCSRFToken(req) : '',
    }, ctx, req);

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
      csrfToken: auth.getCSRFToken ? auth.getCSRFToken(req) : '',
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
      csrfToken: auth.getCSRFToken ? auth.getCSRFToken(req) : '',
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

    const html = renderAdmin('archetypes-list.html', {
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
      csrfToken: auth.getCSRFToken ? auth.getCSRFToken(req) : '',
    }, ctx, req);

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
      csrfToken: auth.getCSRFToken ? auth.getCSRFToken(req) : '',
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
      csrfToken: auth.getCSRFToken ? auth.getCSRFToken(req) : '',
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

    const html = renderAdmin('api-docs.html', data, ctx, req);
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

    const html = renderAdmin('api-versions.html', data, ctx, req);
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

    const html = renderAdmin('graphql-explorer.html', data, ctx, req);
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

    const html = renderAdmin('feeds.html', data, ctx, req);
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
    let sitemapService;
    try { sitemapService = ctx.services.get('sitemap'); } catch (e) { /* not available */ }
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
    let sitemapService;
    try { sitemapService = ctx.services.get('sitemap'); } catch (e) { /* not available */ }
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
    let sitemapService;
    try { sitemapService = ctx.services.get('sitemap'); } catch (e) { /* not available */ }
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
    let sitemapService;
    try { sitemapService = ctx.services.get('sitemap'); } catch (e) {}
    if (!sitemapService) {
      redirect(res, '/admin?error=' + encodeURIComponent('Sitemap service not available'));
      return;
    }

    const stats = sitemapService.getStats();
    const types = sitemapService.listTypes();
    const config = sitemapService.getConfig();
    const robotsTxt = sitemapService.generateRobotsTxt();
    const audit = sitemapService.auditSEO();
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('seo-dashboard.html', {
      pageTitle: 'SEO & Sitemap',
      stats,
      types,
      hasTypes: Array.isArray(types) && types.length > 0,
      config,
      robotsTxt,
      audit,
      flash,
      hasFlash: !!flash,
      siteUrl: config.siteUrl || '',
    }, ctx, req);

    server.html(res, html);
  }, 'SEO dashboard');

  /**
   * GET /admin/seo/audit — SEO audit results
   */
  register('GET', '/admin/seo/audit', async (req, res, params, ctx) => {
    let sitemapService;
    try { sitemapService = ctx.services.get('sitemap'); } catch (e) {}
    if (!sitemapService) {
      redirect(res, '/admin/seo?error=' + encodeURIComponent('Sitemap service not available'));
      return;
    }

    const url = new URL(req.url, 'http://localhost');
    const type = url.searchParams.get('type') || null;
    const severity = url.searchParams.get('severity') || null;

    const audit = sitemapService.auditSEO(type);
    let issues = [...(audit.errors || []), ...(audit.warnings || []), ...(audit.info || [])];
    if (severity) {
      issues = issues.filter(i => i.severity === severity);
    }
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('seo-audit.html', {
      pageTitle: 'SEO Audit',
      audit,
      issues,
      hasIssues: issues.length > 0,
      filterType: type,
      filterSeverity: severity,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'SEO audit results');

  /**
   * POST /admin/seo/ping — Ping search engines
   */
  register('POST', '/admin/seo/ping', async (req, res, params, ctx) => {
    let sitemapService;
    try { sitemapService = ctx.services.get('sitemap'); } catch (e) { /* not available */ }
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
    let sitemapService;
    try { sitemapService = ctx.services.get('sitemap'); } catch (e) { /* not available */ }
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

    const blocks = blockService.listBlocks().items;
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('block-list.html', {
      pageTitle: 'Block layout',
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

    const html = renderAdmin('block-edit.html', {
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
  // ==========================================
  // Image Styles
  // ==========================================

  /**
   * GET /admin/image-styles - List image styles
   */
  register('GET', '/admin/image-styles', async (req, res, params, ctx) => {
    let imageStylesService;
    try { imageStylesService = ctx.services.get('imageStyles'); } catch (e) {}
    if (!imageStylesService) {
      redirect(res, '/admin?error=' + encodeURIComponent('Image styles service not available'));
      return;
    }

    const styles = imageStylesService.listStyles();
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('image-styles-list.html', {
      pageTitle: 'Image Styles',
      styles,
      hasStyles: Array.isArray(styles) && styles.length > 0,
      styleCount: Array.isArray(styles) ? styles.length : 0,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Image styles list');

  // ==========================================
  // Path Aliases
  // ==========================================

  /**
   * GET /admin/aliases - List path aliases
   */
  register('GET', '/admin/aliases', async (req, res, params, ctx) => {
    let aliasService;
    try { aliasService = ctx.services.get('pathAliases'); } catch (e) {}
    if (!aliasService) {
      redirect(res, '/admin?error=' + encodeURIComponent('Path aliases service not available'));
      return;
    }

    const aliases = aliasService.listAliases();
    const redirects = aliasService.listRedirects();
    const patterns = aliasService.listPatterns();
    const stats = aliasService.getStats();
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('aliases-list.html', {
      pageTitle: 'Path Aliases',
      aliases,
      hasAliases: Array.isArray(aliases) && aliases.length > 0,
      aliasCount: Array.isArray(aliases) ? aliases.length : 0,
      redirects,
      hasRedirects: Array.isArray(redirects) && redirects.length > 0,
      redirectCount: Array.isArray(redirects) ? redirects.length : 0,
      patterns,
      hasPatterns: Array.isArray(patterns) && patterns.length > 0,
      stats,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Path aliases list');

  // ==========================================
  // Tokens
  // ==========================================

  register('GET', '/admin/tokens', async (req, res, params, ctx) => {
    let tokenService;
    try { tokenService = ctx.services.get('tokens'); } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Token service not available');
      return;
    }

    const tokens = tokenService.getTokens();
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('tokens-browser.html', {
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
    let formatService;
    try { formatService = ctx.services.get('textFormats'); } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Text format service not available');
      return;
    }

    const formats = formatService.getFormats();
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('text-formats-list.html', {
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
    const html = renderAdmin('text-formats-edit.html', {
      pageTitle: 'Create Text Format',
      isNew: true,
    }, ctx, req);

    server.html(res, html);
  }, 'Create text format form');

  /**
   * POST /admin/text-formats - Create format
   */
  register('POST', '/admin/text-formats', async (req, res, params, ctx) => {
    let formatService;
    try { formatService = ctx.services.get('textFormats'); } catch (e) {
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
    let formatService;
    try { formatService = ctx.services.get('textFormats'); } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Text format service not available');
      return;
    }

    const format = formatService.getFormat(id);
    if (!format) {
      redirect(res, '/admin/text-formats?error=' + encodeURIComponent(`Format not found: ${id}`));
      return;
    }

    const html = renderAdmin('text-formats-edit.html', {
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
    let formatService;
    try { formatService = ctx.services.get('textFormats'); } catch (e) {
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
    let formatService;
    try { formatService = ctx.services.get('textFormats'); } catch (e) {
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
    const rawTypes = content.listTypes();
    const flash = getFlashMessage(req.url);

    /* Enrich each type with a description derived from its schema metadata.
       schema.description may be a field definition object (not a string) — filter those out. */
    const types = rawTypes.map(t => {
      let desc = t.schema?._description || '';
      if (!desc && typeof t.schema?.description === 'string') desc = t.schema.description;
      return { ...t, description: desc };
    });

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
      contentType: { machineName: type, label: deriveTypeLabel(type) },
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

  // Field type label map — maps internal type names to human-readable labels
  const fieldTypeLabels = {
    string: 'Text (plain)',
    text: 'Text (formatted)',
    number: 'Number',
    boolean: 'Boolean',
    date: 'Date',
    relation: 'Reference',
    file: 'File',
    image: 'Image',
    array: 'List',
    computed: 'Computed (system)',
    slug: 'URL alias (system)',
  };

  // Field type options for the "Add field" dropdown
  const fieldTypeOptions = [
    { value: 'string', label: 'Text (plain)' },
    { value: 'text', label: 'Text (formatted)' },
    { value: 'number', label: 'Number' },
    { value: 'boolean', label: 'Boolean' },
    { value: 'date', label: 'Date' },
    { value: 'relation', label: 'Reference' },
    { value: 'file', label: 'File' },
    { value: 'image', label: 'Image' },
    { value: 'array', label: 'List' },
  ];

  // Build a short settings summary for a field definition
  function buildSettingsSummary(def) {
    const parts = [];
    if (def.settings?.maxLength) parts.push(`Max length: ${def.settings.maxLength}`);
    if (def.settings?.min != null) parts.push(`Min: ${def.settings.min}`);
    if (def.settings?.max != null) parts.push(`Max: ${def.settings.max}`);
    if (def.settings?.referenceType) parts.push(`Ref: ${def.settings.referenceType}`);
    if (def.settings?.allowedExtensions) parts.push(`Extensions: ${def.settings.allowedExtensions}`);
    if (def.settings?.textProcessing && def.settings.textProcessing !== 'plain') parts.push(def.settings.textProcessing);
    return parts.join(', ');
  }

  // Derive a human-readable label from a machine name
  function deriveTypeLabel(typeName) {
    return typeName.charAt(0).toUpperCase() + typeName.slice(1).replace(/_/g, ' ');
  }

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
      machineName: name,
      label: def.label || name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, ' '),
      type: def.type,
      typeLabel: fieldTypeLabels[def.type] || def.type,
      required: !!def.required,
      cardinality: def.cardinality || 1,
      cardinalityLabel: def.cardinality === -1 ? 'Unlimited' : def.cardinality > 1 ? `Limited to ${def.cardinality}` : '',
      helpText: def.helpText || '',
      settingsSummary: buildSettingsSummary(def),
      isBase: ['title', 'body', 'status'].includes(name),
    }));

    const flash = getFlashMessage(req.url);

    /* Build re-use fields list from all other content types */
    const allTypes = content.listTypes();
    const reuseFields = [];
    for (const t of allTypes) {
      if (t.type === type) continue;
      const tSchema = content.getSchema(t.type);
      for (const [fName, fDef] of Object.entries(tSchema)) {
        if (fName.startsWith('_') || ['title', 'body', 'status'].includes(fName)) continue;
        /* Avoid duplicates */
        if (reuseFields.some(rf => rf.machineName === fName)) continue;
        reuseFields.push({
          machineName: fName,
          typeLabel: fieldTypeLabels[fDef.type] || fDef.type || 'Unknown',
          cardinalityLabel: fDef.cardinality === -1 ? 'Unlimited' : 'Single value',
          usedIn: deriveTypeLabel(t.type),
        });
      }
    }

    const html = renderAdmin('content-types-fields.html', {
      pageTitle: `Manage Fields: ${deriveTypeLabel(type)}`,
      typeName: type,
      typeLabel: deriveTypeLabel(type),
      fields,
      hasFields: fields.length > 0,
      reuseFields,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Manage content type fields');

  // Helper: build the template data for the field edit/add form
  function buildFieldEditData(type, fieldName, fieldDef, isNew) {
    const cardinality = fieldDef.cardinality || 1;
    const settings = fieldDef.settings || {};

    // Text processing flags for the select dropdown
    const textProcessing = settings.textProcessing || 'plain';

    // Build the content types list for reference fields
    // content.listTypes() may return objects ({type, ...}) or strings
    const allTypes = content.listTypes();
    const contentTypesList = allTypes.map(t => {
      const typeName = typeof t === 'string' ? t : (t.type || t.name || String(t));
      return {
        machineName: typeName,
        label: deriveTypeLabel(typeName),
        selected: settings.referenceType === typeName,
      };
    });

    // Build options text for select fields
    let optionsText = '';
    if (Array.isArray(settings.options)) {
      optionsText = settings.options.map(o => `${o.value || o.key || o}|${o.label || o}`).join('\n');
    } else if (typeof settings.options === 'string') {
      optionsText = settings.options;
    }

    const fieldType = fieldDef.type || '';

    return {
      typeName: type,
      typeLabel: deriveTypeLabel(type),
      isNew,
      formAction: isNew
        ? `/admin/structure/types/${type}/fields/add`
        : `/admin/structure/types/${type}/fields/${fieldName}`,
      field: {
        machineName: fieldName || '',
        label: fieldDef.label || (fieldName ? fieldName.charAt(0).toUpperCase() + fieldName.slice(1).replace(/_/g, ' ') : ''),
        type: fieldType,
        typeLabel: fieldTypeLabels[fieldType] || fieldType,
        required: !!fieldDef.required,
        helpText: fieldDef.helpText || '',
        defaultValue: fieldDef.defaultValue || '',
        cardinality,
        cardinalityCount: cardinality > 1 ? cardinality : '',
        settings: {
          ...settings,
          isPlain: textProcessing === 'plain',
          isFiltered: textProcessing === 'filtered',
          isFull: textProcessing === 'full',
          optionsText,
        },
      },
      // Cardinality select flags
      cardinalityIs1: cardinality === 1,
      cardinalityIsUnlimited: cardinality === -1,
      cardinalityIsCustom: cardinality > 1,
      // Type boolean flags for template conditionals
      isTextField: fieldType === 'string' || fieldType === 'text',
      isNumberField: fieldType === 'number',
      isBooleanField: fieldType === 'boolean',
      isDateField: fieldType === 'date',
      isSelectField: fieldType === 'array',
      isReferenceField: fieldType === 'relation',
      isFileField: fieldType === 'file',
      isImageField: fieldType === 'image',
      hasTypeSettings: ['string', 'text', 'number', 'array', 'relation', 'file', 'image'].includes(fieldType),
      // Data for dropdowns
      contentTypes: contentTypesList,
      fieldTypes: fieldTypeOptions.map(ft => ({ ...ft, selected: ft.value === fieldType })),
    };
  }

  // Helper: extract settings from form data (handles bracket notation keys like settings[maxLength])
  function extractSettingsFromForm(formData) {
    const settings = {};
    for (const [key, value] of Object.entries(formData)) {
      const match = key.match(/^settings\[(\w+)\]$/);
      if (match) {
        const settingKey = match[1];
        // Convert checkbox values
        if (value === '1' && ['multiple', 'autoCreate'].includes(settingKey)) {
          settings[settingKey] = true;
        } else if (['maxLength', 'min', 'max', 'precision', 'maxFileSize', 'minWidth', 'minHeight'].includes(settingKey)) {
          // Numeric settings — only store if non-empty
          if (value !== '') settings[settingKey] = Number(value);
        } else if (settingKey === 'options') {
          // Parse key|label format into structured array
          settings.options = value.split('\n').filter(l => l.trim()).map(line => {
            const [val, label] = line.split('|').map(s => s.trim());
            return { value: val, label: label || val };
          });
        } else {
          settings[settingKey] = value;
        }
      }
    }
    return settings;
  }

  /**
   * GET /admin/structure/types/:type/fields/add - Add field form
   */
  register('GET', '/admin/structure/types/:type/fields/add', async (req, res, params, ctx) => {
    const { type } = params;
    if (!content.hasType(type)) {
      redirect(res, '/admin/structure/types?error=' + encodeURIComponent(`Content type not found: ${type}`));
      return;
    }

    const flash = getFlashMessage(req.url);
    const data = buildFieldEditData(type, '', { type: '' }, true);

    const html = renderAdmin('content-types-field-edit.html', {
      pageTitle: `Add Field to ${deriveTypeLabel(type)}`,
      ...data,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Add field form');

  /**
   * POST /admin/structure/types/:type/fields/add - Create new field
   */
  register('POST', '/admin/structure/types/:type/fields/add', async (req, res, params, ctx) => {
    const { type } = params;
    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const fieldName = (formData.machineName || formData.name || '').trim();
      if (!fieldName) {
        redirect(res, `/admin/structure/types/${type}/fields/add?error=` + encodeURIComponent('Machine name is required'));
        return;
      }
      if (!/^[a-z][a-z0-9_]*$/.test(fieldName)) {
        redirect(res, `/admin/structure/types/${type}/fields/add?error=` + encodeURIComponent('Machine name must start with a lowercase letter and contain only lowercase letters, numbers, and underscores'));
        return;
      }

      const schema = content.getSchema(type);
      if (schema[fieldName]) {
        redirect(res, `/admin/structure/types/${type}/fields/add?error=` + encodeURIComponent(`Field "${fieldName}" already exists`));
        return;
      }

      const fieldType = (formData.type || '').trim();
      if (!fieldType) {
        redirect(res, `/admin/structure/types/${type}/fields/add?error=` + encodeURIComponent('Field type is required'));
        return;
      }

      // Build field definition from form data
      const cardinality = formData.cardinality === '-1' ? -1
        : formData.cardinality === 'custom' ? Math.max(2, parseInt(formData.cardinalityCount) || 2)
        : 1;

      const fieldDef = {
        type: fieldType,
        label: (formData.label || '').trim() || fieldName,
        required: formData.required === '1' || formData.required === 'on',
        helpText: (formData.helpText || '').trim(),
        defaultValue: formData.defaultValue || '',
        cardinality,
        settings: extractSettingsFromForm(formData),
      };

      schema[fieldName] = fieldDef;
      content.registerType(type, schema);

      redirect(res, `/admin/structure/types/${type}/fields?success=` + encodeURIComponent(`Field added: ${fieldName}`));
    } catch (error) {
      redirect(res, `/admin/structure/types/${type}/fields/add?error=` + encodeURIComponent(error.message));
    }
  }, 'Create new field');

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

    const flash = getFlashMessage(req.url);
    const data = buildFieldEditData(type, field, fieldDef, false);

    const html = renderAdmin('content-types-field-edit.html', {
      pageTitle: `Edit Field: ${data.field.label}`,
      ...data,
      flash,
      hasFlash: !!flash,
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

      const schema = content.getSchema(type);
      const existingDef = schema[field] || {};

      // Preserve the field type (cannot be changed after creation)
      const fieldType = existingDef.type || (formData.type || '').trim();

      // Parse cardinality
      const cardinality = formData.cardinality === '-1' ? -1
        : formData.cardinality === 'custom' ? Math.max(2, parseInt(formData.cardinalityCount) || 2)
        : 1;

      // Build updated field definition, preserving type
      const fieldDef = {
        type: fieldType,
        label: (formData.label || '').trim() || field,
        required: formData.required === '1' || formData.required === 'on',
        helpText: (formData.helpText || '').trim(),
        defaultValue: formData.defaultValue || '',
        cardinality,
        settings: extractSettingsFromForm(formData),
      };

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

    const html = renderAdmin('display-manage.html', {
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

  /**
   * GET /admin/structure/types/:type/form-display - Manage form display
   */
  register('GET', '/admin/structure/types/:type/form-display', async (req, res, params, ctx) => {
    const { type } = params;
    if (!content.hasType(type)) {
      redirect(res, '/admin/structure/types?error=' + encodeURIComponent(`Content type not found: ${type}`));
      return;
    }

    const schema = content.getSchema(type);
    const flash = getFlashMessage(req.url);

    /* Map of field type -> available widget options */
    const widgetMap = {
      string: [
        { value: 'textfield', label: 'Text field' },
        { value: 'textarea', label: 'Text area' },
      ],
      text: [
        { value: 'textarea', label: 'Text area' },
        { value: 'wysiwyg', label: 'WYSIWYG editor' },
      ],
      number: [
        { value: 'number', label: 'Number field' },
        { value: 'range', label: 'Range slider' },
      ],
      boolean: [
        { value: 'checkbox', label: 'Single on/off checkbox' },
        { value: 'radios', label: 'Radio buttons' },
      ],
      date: [
        { value: 'datepicker', label: 'Date picker' },
        { value: 'datetime', label: 'Date and time' },
      ],
      relation: [
        { value: 'autocomplete', label: 'Autocomplete' },
        { value: 'select', label: 'Select list' },
      ],
      file: [
        { value: 'file_upload', label: 'File upload' },
      ],
      image: [
        { value: 'image_upload', label: 'Image upload' },
      ],
      array: [
        { value: 'textarea', label: 'Text area (one per line)' },
        { value: 'tag_input', label: 'Tag input' },
      ],
    };

    let weight = 0;
    const fields = Object.entries(schema)
      .filter(([name]) => !name.startsWith('_'))
      .map(([name, def]) => {
        const fType = def.type || 'string';
        const widgets = (widgetMap[fType] || [{ value: 'default', label: 'Default' }]).map(w => ({
          ...w,
          selected: w.value === (def.widget || (widgetMap[fType] || [])[0]?.value),
        }));
        return {
          machineName: name,
          label: def.label || name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, ' '),
          availableWidgets: widgets,
          weight: weight++,
        };
      });

    const html = renderAdmin('content-types-form-display.html', {
      pageTitle: `Manage Form Display: ${deriveTypeLabel(type)}`,
      typeName: type,
      typeLabel: deriveTypeLabel(type),
      fields,
      hasFields: fields.length > 0,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Manage form display');

  /**
   * POST /admin/structure/types/:type/form-display - Save form display
   */
  register('POST', '/admin/structure/types/:type/form-display', async (req, res, params, ctx) => {
    const { type } = params;
    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      /* Widget and weight data would be persisted here in a full implementation */
      redirect(res, `/admin/structure/types/${type}/form-display?success=` + encodeURIComponent('Form display settings saved'));
    } catch (error) {
      redirect(res, `/admin/structure/types/${type}/form-display?error=` + encodeURIComponent(error.message));
    }
  }, 'Save form display');

  /**
   * GET /admin/structure/types/:type/permissions - Per-type permissions
   */
  register('GET', '/admin/structure/types/:type/permissions', async (req, res, params, ctx) => {
    const { type } = params;
    if (!content.hasType(type)) {
      redirect(res, '/admin/structure/types?error=' + encodeURIComponent(`Content type not found: ${type}`));
      return;
    }

    const flash = getFlashMessage(req.url);

    const roles = [
      { name: 'anonymous', label: 'Anonymous' },
      { name: 'authenticated', label: 'Authenticated' },
      { name: 'admin', label: 'Administrator' },
    ];

    const permissions = [
      { key: 'create', label: `Create new ${type} content`, description: `Create ${type} content items` },
      { key: 'edit_own', label: `Edit own ${type} content`, description: `Edit own ${type} content items` },
      { key: 'edit_any', label: `Edit any ${type} content`, description: `Edit any ${type} content items` },
      { key: 'delete_own', label: `Delete own ${type} content`, description: `Delete own ${type} content items` },
      { key: 'delete_any', label: `Delete any ${type} content`, description: `Delete any ${type} content items` },
      { key: 'view_published', label: `View published ${type} content`, description: '' },
      { key: 'view_unpublished', label: `View unpublished ${type} content`, description: '' },
    ];

    /* Default permissions: admin gets all, authenticated gets view_published, anonymous gets view_published */
    permissions.forEach(p => {
      p.granted = {
        admin: true,
        authenticated: ['create', 'edit_own', 'delete_own', 'view_published'].includes(p.key),
        anonymous: p.key === 'view_published',
      };
    });

    const html = renderAdmin('content-types-permissions.html', {
      pageTitle: `Permissions: ${deriveTypeLabel(type)}`,
      typeName: type,
      typeLabel: deriveTypeLabel(type),
      roles,
      permissions,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Manage content type permissions');

  /**
   * POST /admin/structure/types/:type/permissions - Save per-type permissions
   */
  register('POST', '/admin/structure/types/:type/permissions', async (req, res, params, ctx) => {
    const { type } = params;
    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      /* Permission data would be persisted here in a full implementation */
      redirect(res, `/admin/structure/types/${type}/permissions?success=` + encodeURIComponent('Permissions saved'));
    } catch (error) {
      redirect(res, `/admin/structure/types/${type}/permissions?error=` + encodeURIComponent(error.message));
    }
  }, 'Save content type permissions');

  // ==========================================
  // Configuration Hub
  // ==========================================

  /**
   * GET /admin/config - Configuration landing page
   */
  register('GET', '/admin/config', async (req, res, params, ctx) => {
    // Build configuration hub page inline — links to all config sub-sections
    const hubHtml = `
<h1 class="admin-page-title">Configuration</h1>
<p class="admin-page-description">Manage site configuration and settings.</p>

<div class="admin-menu-grid">
  <div class="admin-menu-block">
    <h3><a href="/admin/cron">Cron</a></h3>
    <p>Manage scheduled tasks and automated jobs.</p>
  </div>
  <div class="admin-menu-block">
    <h3><a href="/admin/text-formats">Text Formats</a></h3>
    <p>Configure text processing and input filters.</p>
  </div>
  <div class="admin-menu-block">
    <h3><a href="/admin/image-styles">Image Styles</a></h3>
    <p>Manage image presets and transformations.</p>
  </div>
  <div class="admin-menu-block">
    <h3><a href="/admin/aliases">Path Aliases</a></h3>
    <p>Manage URL aliases and redirects.</p>
  </div>
  <div class="admin-menu-block">
    <h3><a href="/admin/tokens">Tokens</a></h3>
    <p>Browse available tokens for dynamic text replacement.</p>
  </div>
  <div class="admin-menu-block">
    <h3><a href="/admin/config/actions">Actions</a></h3>
    <p>Configure system actions for automation.</p>
  </div>
  <div class="admin-menu-block">
    <h3><a href="/admin/config/rules">Rules</a></h3>
    <p>Set up event-driven automation rules.</p>
  </div>
  <div class="admin-menu-block">
    <h3><a href="/admin/config/user-fields">User Fields</a></h3>
    <p>Manage custom fields on user profiles.</p>
  </div>
  <div class="admin-menu-block">
    <h3><a href="/admin/regions">Regions</a></h3>
    <p>Manage theme regions and block placement.</p>
  </div>
  <div class="admin-menu-block">
    <h3><a href="/admin/seo">SEO</a></h3>
    <p>Search engine optimization settings and audit.</p>
  </div>
  <div class="admin-menu-block">
    <h3><a href="/admin/contact-forms">Contact Forms</a></h3>
    <p>Manage site contact forms and submissions.</p>
  </div>
  <div class="admin-menu-block">
    <h3><a href="/admin/permissions">Permissions</a></h3>
    <p>Configure user roles and access permissions.</p>
  </div>
</div>`;

    const path = req?.url?.split('?')[0] || '/admin/config';
    const navConfig = true;
    const username = ctx.session?.user?.username || 'admin';

    const html = template.renderWithLayout('admin-layout.html', hubHtml, {
      title: 'Configuration',
      siteName: ctx.config.site.name,
      version: ctx.config.site.version,
      csrfToken: req ? auth.getCSRFToken(req) : null,
      username,
      navConfig,
    });

    server.html(res, html);
  }, 'Configuration hub');

  // ==========================================
  // Actions & Rules
  // ==========================================

  /**
   * GET /admin/config/actions - List actions
   */
  register('GET', '/admin/config/actions', async (req, res, params, ctx) => {
    let actionService;
    try { actionService = ctx.services.get('actions'); } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Action service not available');
      return;
    }

    const actions = actionService.getActions();
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
    let ruleService;
    try { ruleService = ctx.services.get('actions'); } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Rule service not available');
      return;
    }

    const rules = ruleService.getRules();
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
    const html = renderAdmin('rules-edit.html', {
      pageTitle: 'Create Rule',
      isNew: true,
    }, ctx, req);

    server.html(res, html);
  }, 'Create rule form');

  /**
   * POST /admin/config/rules - Create rule
   */
  register('POST', '/admin/config/rules', async (req, res, params, ctx) => {
    let ruleService;
    try { ruleService = ctx.services.get('actions'); } catch (e) {
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
    let ruleService;
    try { ruleService = ctx.services.get('actions'); } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Rule service not available');
      return;
    }

    const rule = ruleService.getRule(id);
    if (!rule) {
      redirect(res, '/admin/config/rules?error=' + encodeURIComponent(`Rule not found: ${id}`));
      return;
    }

    const html = renderAdmin('rules-edit.html', {
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
    let ruleService;
    try { ruleService = ctx.services.get('actions'); } catch (e) {
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
    let ruleService;
    try { ruleService = ctx.services.get('actions'); } catch (e) {
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
    let userService;
    try { userService = ctx.services.get('userFields'); } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('User field service not available');
      return;
    }

    const fields = userService.getFields ? userService.getFields() : [];
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('user-fields-list.html', {
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
    const html = renderAdmin('user-fields-edit.html', {
      pageTitle: 'Add User Field',
      isNew: true,
    }, ctx, req);

    server.html(res, html);
  }, 'Add user field form');

  /**
   * POST /admin/config/user-fields - Create field
   */
  register('POST', '/admin/config/user-fields', async (req, res, params, ctx) => {
    let userService;
    try { userService = ctx.services.get('userFields'); } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('User field management not available');
      return;
    }
    if (!userService.defineField) {
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

      await userService.defineField(fieldData.name, fieldData);
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
    let userService;
    try { userService = ctx.services.get('userFields'); } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('User field management not available');
      return;
    }
    if (!userService.getField) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('User field management not available');
      return;
    }

    const field = userService.getField(name);
    if (!field) {
      redirect(res, '/admin/config/user-fields?error=' + encodeURIComponent(`Field not found: ${name}`));
      return;
    }

    const html = renderAdmin('user-fields-edit.html', {
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
    let userService;
    try { userService = ctx.services.get('userFields'); } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('User field management not available');
      return;
    }
    if (!userService.updateField) {
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

      await userService.updateField(name, updates);
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
    let userService;
    try { userService = ctx.services.get('userFields'); } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('User field management not available');
      return;
    }
    if (!userService.deleteField) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('User field management not available');
      return;
    }

    try {
      await userService.deleteField(name);
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
    let themeService;
    try {
      themeService = ctx.services.get('themeSettings');
    } catch (e) {
      // Service not available
    }
    if (!themeService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Theme service not available');
      return;
    }

    const themes = themeService.getThemes ? themeService.getThemes() : (themeService.listThemes ? themeService.listThemes() : []);
    const activeTheme = ctx.config.site.theme || 'default';
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('themes-list.html', {
      pageTitle: 'Appearance',
      themes,
      hasThemes: themes.length > 0,
      activeTheme,
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
    let themeService;
    try { themeService = ctx.services.get('themeSettings'); } catch (e) {}
    if (!themeService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Theme service not available');
      return;
    }

    // Load full theme metadata and current settings
    let themeMeta = {};
    try { themeMeta = themeService.getTheme ? themeService.getTheme(theme) : {}; } catch (e) {}
    const settings = themeService.getSettings ? themeService.getSettings(theme) : {};
    const activeTheme = themeService.getActiveTheme ? themeService.getActiveTheme() : '';
    const flash = getFlashMessage(req.url);

    // Build setting groups with pre-rendered field HTML
    // (template engine can't do nested {{#each}}, so we render fields server-side)
    const rawGroups = themeMeta.setting_groups || {};
    const rawSettings = themeMeta.settings || {};
    const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    const settingGroups = Object.entries(rawGroups).map(([groupKey, group], idx) => {
      const fieldsHtml = (group.settings || []).map(key => {
        const schema = rawSettings[key] || {};
        const schemaType = typeof schema === 'object' ? schema.type : null;
        const value = settings[key] !== undefined ? settings[key] : (schema.default !== undefined ? schema.default : schema);
        const label = (typeof schema === 'object' && schema.label) ? schema.label : key.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
        const description = (typeof schema === 'object' && schema.description) ? schema.description : '';

        let input = '';
        if (schemaType === 'toggle') {
          const checked = value ? ' checked' : '';
          input = `<label class="toggle-switch"><input type="checkbox" id="${esc(key)}" name="${esc(key)}"${checked}><span class="toggle-slider"></span></label>`;
        } else if (schemaType === 'color') {
          input = `<div style="display:flex;gap:0.5rem;align-items:center"><input type="color" id="${esc(key)}" name="${esc(key)}" value="${esc(value)}" style="width:48px;height:36px;padding:2px;cursor:pointer;border:1px solid var(--gin-border-light,#d4d4d8);border-radius:var(--gin-radius,8px)"><input type="text" value="${esc(value)}" class="form-input" style="flex:1;font-family:monospace" readonly></div>`;
        } else if (schemaType === 'select' && typeof schema === 'object' && schema.options) {
          const opts = schema.options.map(opt => {
            const sel = opt.value === String(value) ? ' selected' : '';
            return `<option value="${esc(opt.value)}"${sel}>${esc(opt.label)}</option>`;
          }).join('');
          input = `<select id="${esc(key)}" name="${esc(key)}" class="form-select">${opts}</select>`;
        } else if (schemaType === 'image') {
          input = `<input type="file" id="${esc(key)}" name="${esc(key)}" accept="image/*" class="form-input">`;
          if (value) input += `<div style="margin-top:0.5rem"><img src="${esc(value)}" alt="Preview" style="max-width:200px;border-radius:var(--gin-radius,8px);border:1px solid var(--gin-border-light,#d4d4d8)"></div>`;
        } else {
          input = `<input type="text" id="${esc(key)}" name="${esc(key)}" value="${esc(value)}" class="form-input">`;
        }

        let html = `<div class="form-item"><label for="${esc(key)}">${esc(label)}</label>${input}`;
        if (description) html += `<div class="form-item__description">${esc(description)}</div>`;
        html += '</div>';
        return html;
      }).join('\n');

      return {
        label: group.label || groupKey,
        description: group.description || '',
        fieldsHtml,
        isExpanded: idx === 0,
      };
    });

    // Build color schemes list
    const rawSchemes = themeMeta.color_schemes || {};
    const colorSchemes = Object.keys(rawSchemes);

    const html = renderAdmin('theme-settings.html', {
      pageTitle: `Theme Settings: ${themeMeta.name || theme}`,
      theme,
      themeName: themeMeta.name || theme,
      themeDescription: themeMeta.description || '',
      themeVersion: themeMeta.version || '',
      themeSlug: theme,
      isActive: theme === activeTheme,
      hasColorSchemes: colorSchemes.length > 0,
      colorSchemes,
      hasSettingGroups: settingGroups.length > 0,
      settingGroups,
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
    let themeService;
    try { themeService = ctx.services.get('themeSettings'); } catch (e) {}
    if (!themeService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Theme service not available');
      return;
    }

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);

      // Build settings from form fields — skip CSRF token and internal fields
      let themeMeta = {};
      try { themeMeta = themeService.getTheme ? themeService.getTheme(theme) : {}; } catch (e) {}
      const defaultSettings = themeMeta.settings || {};
      const settingKeys = Object.keys(defaultSettings);
      const settings = {};

      // If a JSON blob was submitted (legacy), parse it
      if (formData.settings && typeof formData.settings === 'string') {
        try { Object.assign(settings, JSON.parse(formData.settings)); } catch (e) {}
      }

      // Read individual form fields matching known setting keys using schema types
      for (const key of settingKeys) {
        const schema = defaultSettings[key];
        const schemaType = (typeof schema === 'object' && schema.type) ? schema.type : null;
        if (schemaType === 'toggle') {
          // Checkboxes: present = true, absent = false
          settings[key] = formData[key] === 'on' || formData[key] === 'true' || formData[key] === '1';
        } else if (key in formData) {
          settings[key] = formData[key];
        }
      }

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
    let themeService;
    try { themeService = ctx.services.get('themeSettings'); } catch (e) {}
    if (!themeService) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Theme service not available');
      return;
    }

    try {
      if (themeService.setActiveTheme) {
        await themeService.setActiveTheme(theme);
      } else if (themeService.activateTheme) {
        await themeService.activateTheme(theme);
      }

      redirect(res, '/admin/appearance?success=' + encodeURIComponent(`Theme "${theme}" activated. Restart the server for full effect.`));
    } catch (error) {
      redirect(res, '/admin/appearance?error=' + encodeURIComponent(error.message));
    }
  }, 'Activate theme');

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

    // Group layouts by category
    const layoutsByCategory = categories.map(cat => ({
      category: cat,
      layouts: layouts.filter(l => l.category === cat).map(l => ({
        ...l,
        regionCount: Object.keys(l.regions).length,
        regionsList: Object.keys(l.regions).join(', '),
      })),
    }));

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

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('layout-builder.html', {
      pageTitle: 'Layout Builder',
      layoutsByCategory,
      hasLayouts: layouts.length > 0,
      defaultLayoutInfo,
      hasDefaults: defaultLayoutInfo.length > 0,
      contentTypes,
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

    // Enrich sections with layout info
    const sections = (storage.sections || []).map((section, index) => {
      const layoutDef = layoutBuilder.getLayout(section.layoutId);
      const regions = Object.entries(layoutDef?.regions || {}).map(([regionId, region]) => {
        const components = (section.components[regionId] || []).map(comp => ({
          ...comp,
          uuidShort: comp.uuid.substring(0, 8),
          typeLabel: comp.type === 'block' ? `Block: ${comp.blockId}` :
            comp.type === 'inline_block' ? `Inline: ${comp.blockType}` :
            comp.type === 'field' ? `Field: ${comp.fieldName}` : comp.type,
        }));
        return {
          id: regionId,
          label: region.label,
          components,
          hasComponents: components.length > 0,
        };
      });

      return {
        ...section,
        uuidShort: section.uuid.substring(0, 8),
        layoutLabel: layoutDef?.label || section.layoutId,
        regions,
        index,
        isFirst: index === 0,
        isLast: index === storage.sections.length - 1,
      };
    });

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('layout-builder-edit.html', {
      pageTitle: `Layout: ${type}`,
      contentType: type,
      sections,
      hasSections: sections.length > 0,
      layouts: layouts.map(l => ({
        ...l,
        regionsList: Object.keys(l.regions).join(', '),
      })),
      blocks: blocks.map(b => ({
        id: b.id,
        adminTitle: b.adminTitle || b.title || b.id,
        type: b.type,
      })),
      hasBlocks: blocks.length > 0,
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
    const page = parseInt(url.searchParams.get('page')) || 1;
    const limit = 24;

    const result = mediaLibrary.list({ mediaType, page, limit });
    const rawTypes = mediaLibrary.listMediaTypes();
    const stats = mediaLibrary.getStats();
    // Pre-compute active state for type filter tabs
    const types = rawTypes.map(t => ({ ...t, active: t.id === mediaType }));

    // Pre-compute preview HTML and pagination values for each item
    // WHY: The template engine doesn't support {{else if}} chains or {{add}}/{{subtract}} helpers.
    // Instead of adding Handlebars features to the engine, we compute these in the handler.
    const enrichedItems = result.items.map(item => {
      let previewHtml;
      if (item.mediaType === 'image') {
        const altText = (item.name || '').replace(/"/g, '&quot;');
        previewHtml = `<img src="/media/${item.path}" alt="${altText}" loading="lazy" />`;
      } else {
        const icons = { video: '🎬', audio: '🎵', document: '📄', remote_video: '🔗' };
        previewHtml = `<div class="media-icon">${icons[item.mediaType] || '📁'}</div>`;
      }
      return { ...item, previewHtml };
    });

    const hasNext = page * limit < result.total;
    const hasPrev = page > 1;
    const typeParam = mediaType ? `&type=${mediaType}` : '';

    const html = renderAdmin('media-library.html', {
      pageTitle: 'Media Library',
      items: enrichedItems,
      total: result.total,
      page,
      limit,
      types,
      stats,
      currentType: mediaType,
      hasNext,
      hasPrev,
      nextPageUrl: hasNext ? `/admin/media/library?page=${page + 1}${typeParam}` : '',
      prevPageUrl: hasPrev ? `/admin/media/library?page=${page - 1}${typeParam}` : '',
    }, ctx, req);

    server.html(res, html);
  }, 'Media library browser');

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

    // Pre-compute preview HTML — template engine doesn't support {{else if}} chains
    let previewHtml;
    if (item.mediaType === 'image') {
      const altText = (item.alt || item.name || '').replace(/"/g, '&quot;');
      previewHtml = `<img src="${url}" alt="${altText}" />`;
    } else if (item.mediaType === 'remote_video') {
      const embedUrl = item.metadata?.embedUrl || '';
      previewHtml = `<div class="video-embed"><iframe src="${embedUrl}" frameborder="0" allowfullscreen></iframe></div>`;
    } else {
      const icons = { video: '🎬', audio: '🎵', document: '📄' };
      const icon = icons[item.mediaType] || '📁';
      previewHtml = `<div class="media-placeholder"><span class="media-icon-large">${icon}</span><a href="${url}" class="btn" target="_blank">Download File</a></div>`;
    }

    // Pre-compute formatted metadata values
    const formatBytes = (bytes) => {
      if (!bytes) return '';
      const units = ['B', 'KB', 'MB', 'GB'];
      let i = 0;
      let size = bytes;
      while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
      return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
    };
    const formatDate = (d) => d ? new Date(d).toLocaleString() : '';

    const html = renderAdmin('media-detail.html', {
      pageTitle: item.name || 'Media Detail',
      item,
      usage,
      hasUsage: usage && usage.length > 0,
      url,
      thumbnailUrl,
      previewHtml,
      formattedSize: formatBytes(item.size),
      formattedCreated: formatDate(item.created),
      formattedUpdated: formatDate(item.updated),
      tagsDisplay: item.tags && item.tags.length ? item.tags.join(', ') : '',
    }, ctx, req);

    server.html(res, html);
  }, 'View media item details');

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

    const rawFormats = editor.listFormats();
    const categories = editor.listButtonCategories();

    // Pre-compute toolbar preview data — template engine can't do array indexing or arithmetic helpers
    const formats = rawFormats.map(f => {
      const firstRow = Array.isArray(f.toolbar) && f.toolbar[0] ? f.toolbar[0] : [];
      const toolbarPreviewHtml = firstRow.map(btn => {
        if (btn === '|') return '<span class="separator">|</span>';
        return `<span class="button-icon" title="${btn}">${btn}</span>`;
      }).join('');
      const extraRows = Array.isArray(f.toolbar) && f.toolbar.length > 1 ? f.toolbar.length - 1 : 0;
      const isBuiltin = f.source === 'builtin';
      return { ...f, toolbarPreviewHtml, extraRows, hasExtraRows: extraRows > 0, isBuiltin };
    });

    const html = renderAdmin('editor-formats.html', {
      pageTitle: 'Editor Formats',
      formats,
      categories,
    }, ctx, req);

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

    const rawStyles = responsiveImages.listResponsiveStyles();
    const breakpoints = responsiveImages.listBreakpoints();

    // Pre-compute template values — engine doesn't support {{join}}, {{@key}}, or {{#unless (eq ...)}}
    const styles = rawStyles.map(s => {
      const isBuiltin = s.source === 'builtin';
      const sizesDisplay = Array.isArray(s.sizes) && s.sizes.length ? s.sizes.join(', ') : '';
      // Convert mappings object to array for {{#each}}
      const mappingsList = s.mappings
        ? Object.entries(s.mappings).map(([bp, style]) => ({ breakpoint: bp, style }))
        : [];
      return { ...s, isBuiltin, sizesDisplay, mappingsList, hasSizes: !!sizesDisplay };
    });

    const html = renderAdmin('responsive-images.html', {
      pageTitle: 'Responsive Images',
      styles,
      breakpoints,
    }, ctx, req);

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

    const html = renderAdmin('jsonapi.html', {
      pageTitle: 'JSON:API Explorer',
      config,
      types,
      basePath: config.basePath,
    }, ctx, req);

    server.html(res, html);
  }, 'JSON:API explorer');

  // ==========================================
  // AI Chatbot API
  // ==========================================

  /**
   * POST /admin/api/ai/chat - AI chatbot endpoint
   *
   * Accepts { message: string } and routes through the AI provider system.
   * Returns { reply: string } or { error: string }.
   */
  register('POST', '/admin/api/ai/chat', async (req, res, params, ctx) => {
    const server = ctx.services.get('server');

    // Parse JSON body
    let body;
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    const userMessage = (body.message || '').trim();
    if (!userMessage) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Message is required' }));
      return;
    }

    // Try to route through the AI provider manager
    let providerManager;
    try {
      providerManager = ctx.services.get('ai-provider-manager');
    } catch {
      // AI provider not available
    }

    if (!providerManager || typeof providerManager.routeToProvider !== 'function') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        reply: 'AI providers are not configured. Please set up an AI provider (OpenAI, Anthropic, or Ollama) in your CMS configuration to enable the AI assistant.',
      }));
      return;
    }

    try {
      const messages = [
        { role: 'system', content: 'You are a helpful CMS assistant. You help content editors with their questions about creating and managing content. Keep responses concise and practical.' },
        { role: 'user', content: userMessage },
      ];

      const result = await providerManager.routeToProvider('chat', messages);
      const reply = (result && result.content) || (result && result.message) || String(result || 'No response from AI provider.');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ reply }));
    } catch (err) {
      console.error('[admin] AI chat error:', err.message);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        reply: 'Sorry, I could not process your request. ' + (err.code === 'RATE_LIMIT_EXCEEDED' ? 'Rate limit reached. Please try again later.' : 'Please check your AI provider configuration.'),
      }));
    }
  }, 'AI chatbot');

  // ==========================================
  // AI Agents Admin Routes
  // ==========================================

  /**
   * GET /admin/ai/agents - List registered AI agents
   */
  register('GET', '/admin/ai/agents', async (req, res, params, ctx) => {
    let agentsService;
    try { agentsService = ctx.services.get('ai-agents'); } catch (e) {}

    const agentsList = agentsService ? agentsService.listAgents() : [];
    const toolsList = agentsService ? agentsService.listTools() : [];

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ agents: agentsList, tools: toolsList }));
  }, 'List AI agents');

  /**
   * POST /admin/api/ai/agent/:id/execute - Execute an AI agent
   *
   * Accepts { input: string, context: { contentType?, contentId?, model? } }
   * Returns { result: string, toolCalls: Array }
   */
  register('POST', '/admin/api/ai/agent/:id/execute', async (req, res, params, ctx) => {
    let agentsService;
    try { agentsService = ctx.services.get('ai-agents'); } catch (e) {}

    if (!agentsService) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'AI Agents service not available' }));
      return;
    }

    // Parse JSON body
    let body;
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    const input = (body.input || '').trim();
    if (!input) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Input is required' }));
      return;
    }

    try {
      const result = await agentsService.executeAgent(params.id, input, body.context || {});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }, 'Execute AI agent');

  // ==========================================
  // ECA (Event-Condition-Action) Admin Routes
  // ==========================================

  /**
   * GET /admin/eca - ECA rule listing with execution log
   */
  register('GET', '/admin/eca', async (req, res, params, ctx) => {
    let actionsService;
    try { actionsService = ctx.services.get('actions'); } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Actions service not available');
      return;
    }

    const config = actionsService.exportConfig();
    const rulesArr = Object.entries(config.rules || {}).map(([id, rule]) => ({
      id,
      label: rule.label || id,
      event: rule.event || '—',
      conditionCount: (rule.conditions || []).length,
      actionCount: (rule.actions || []).length,
      enabled: rule.enabled !== false,
    }));

    const eventsArr = Object.entries(config.events || {}).map(([id, ev]) => ({
      id,
      label: ev.label || id,
    }));

    const log = actionsService.getExecutionLog(20);

    const html = renderAdmin('eca-list.html', {
      pageTitle: 'ECA Rules',
      rules: rulesArr,
      events: eventsArr,
      log,
    }, ctx, req);

    server.html(res, html);
  }, 'ECA rule listing');

  /**
   * GET /admin/eca/add - Create ECA rule form
   */
  register('GET', '/admin/eca/add', async (req, res, params, ctx) => {
    let actionsService;
    try { actionsService = ctx.services.get('actions'); } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Actions service not available');
      return;
    }

    const config = actionsService.exportConfig();

    const eventsArr = Object.entries(config.events || {}).map(([id, ev]) => ({ id, label: ev.label || id, selected: false }));
    const condArr = Object.entries(config.conditions || {}).map(([id, c]) => ({ id, label: c.label || id }));
    const actArr = Object.entries(config.actions || {}).map(([id, a]) => ({ id, label: a.label || id }));

    const html = renderAdmin('eca-edit.html', {
      pageTitle: 'Create ECA Rule',
      isNew: true,
      formAction: '/admin/eca/save',
      rule: { id: '', label: '', event: '', conditions: [], actions: [], enabled: true },
      events: eventsArr,
      availableConditions: condArr,
      availableActions: actArr,
      conditionsJson: JSON.stringify(condArr),
      actionsJson: JSON.stringify(actArr),
    }, ctx, req);

    server.html(res, html);
  }, 'Create ECA rule form');

  /**
   * GET /admin/eca/edit/:id - Edit ECA rule form
   */
  register('GET', '/admin/eca/edit/:id', async (req, res, params, ctx) => {
    let actionsService;
    try { actionsService = ctx.services.get('actions'); } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Actions service not available');
      return;
    }

    const rule = actionsService.getRule(params.id);
    if (!rule) {
      redirect(res, '/admin/eca?error=Rule+not+found');
      return;
    }

    const config = actionsService.exportConfig();
    const eventsArr = Object.entries(config.events || {}).map(([id, ev]) => ({
      id, label: ev.label || id, selected: id === rule.event
    }));
    const condArr = Object.entries(config.conditions || {}).map(([id, c]) => ({ id, label: c.label || id }));
    const actArr = Object.entries(config.actions || {}).map(([id, a]) => ({ id, label: a.label || id }));

    // Prepare conditions/actions with settings JSON for the form
    const ruleConditions = (rule.conditions || []).map((c, i) => ({
      ...c,
      settingsJson: JSON.stringify(c.settings || {}),
    }));
    const ruleActions = (rule.actions || []).map((a, i) => ({
      ...a,
      settingsJson: JSON.stringify(a.settings || {}),
    }));

    const html = renderAdmin('eca-edit.html', {
      pageTitle: `Edit Rule: ${rule.label}`,
      isNew: false,
      formAction: '/admin/eca/save/' + params.id,
      rule: { ...rule, id: params.id, conditions: ruleConditions, actions: ruleActions },
      events: eventsArr,
      availableConditions: condArr,
      availableActions: actArr,
      conditionsJson: JSON.stringify(condArr),
      actionsJson: JSON.stringify(actArr),
    }, ctx, req);

    server.html(res, html);
  }, 'Edit ECA rule form');

  /**
   * POST /admin/eca/save - Create new ECA rule
   * POST /admin/eca/save/:id - Update existing ECA rule
   */
  register('POST', '/admin/eca/save/:id', async (req, res, params, ctx) => {
    let actionsService;
    try { actionsService = ctx.services.get('actions'); } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Actions service not available');
      return;
    }

    try {
      const formData = ctx._parsedBody || {};

      // Parse conditions and actions from indexed form fields
      const conditions = [];
      const actions = [];
      for (const key of Object.keys(formData)) {
        const condMatch = key.match(/^conditions\[(\d+)]\[(\w+)]$/);
        if (condMatch) {
          const idx = parseInt(condMatch[1]);
          const field = condMatch[2];
          if (!conditions[idx]) conditions[idx] = {};
          if (field === 'settings') {
            try { conditions[idx].settings = JSON.parse(formData[key] || '{}'); } catch { conditions[idx].settings = {}; }
          } else {
            conditions[idx][field] = formData[key];
          }
        }
        const actMatch = key.match(/^actions\[(\d+)]\[(\w+)]$/);
        if (actMatch) {
          const idx = parseInt(actMatch[1]);
          const field = actMatch[2];
          if (!actions[idx]) actions[idx] = {};
          if (field === 'settings') {
            try { actions[idx].settings = JSON.parse(formData[key] || '{}'); } catch { actions[idx].settings = {}; }
          } else {
            actions[idx][field] = formData[key];
          }
        }
      }

      const ruleConfig = {
        label: (formData.label || '').trim(),
        event: (formData.event || '').trim(),
        conditions: conditions.filter(Boolean),
        actions: actions.filter(Boolean),
        enabled: formData.enabled === '1',
      };

      const id = params.id || (formData.id || '').trim();
      if (!id) {
        redirect(res, '/admin/eca/add?error=Rule+ID+required');
        return;
      }

      if (actionsService.getRule(id)) {
        actionsService.updateRule(id, ruleConfig);
      } else {
        actionsService.createRule(id, ruleConfig);
      }

      redirect(res, '/admin/eca?success=' + encodeURIComponent('Rule saved: ' + ruleConfig.label));
    } catch (error) {
      redirect(res, '/admin/eca?error=' + encodeURIComponent(error.message));
    }
  }, 'Save ECA rule');

  register('POST', '/admin/eca/save', async (req, res, params, ctx) => {
    // Delegate to the :id handler with no id (creates new)
    params.id = null;
    const handler = ctx._routeHandlers?.['POST:/admin/eca/save/:id'];
    if (handler) return handler(req, res, params, ctx);
    // Fallback: parse and create directly
    let actionsService;
    try { actionsService = ctx.services.get('actions'); } catch (e) {
      redirect(res, '/admin/eca?error=Actions+service+not+available');
      return;
    }
    const formData = ctx._parsedBody || {};
    const id = (formData.id || '').trim();
    if (!id) { redirect(res, '/admin/eca/add?error=Rule+ID+required'); return; }
    try {
      actionsService.createRule(id, {
        label: (formData.label || '').trim(),
        event: (formData.event || '').trim(),
        conditions: [],
        actions: [],
        enabled: formData.enabled === '1',
      });
      redirect(res, '/admin/eca?success=Rule+created');
    } catch (err) {
      redirect(res, '/admin/eca/add?error=' + encodeURIComponent(err.message));
    }
  }, 'Create ECA rule');

  /**
   * POST /admin/eca/toggle/:id - Toggle rule enabled/disabled
   */
  register('POST', '/admin/eca/toggle/:id', async (req, res, params, ctx) => {
    let actionsService;
    try { actionsService = ctx.services.get('actions'); } catch (e) {
      redirect(res, '/admin/eca?error=Actions+service+not+available');
      return;
    }
    const rule = actionsService.getRule(params.id);
    if (!rule) {
      redirect(res, '/admin/eca?error=Rule+not+found');
      return;
    }
    actionsService.updateRule(params.id, { enabled: !rule.enabled });
    redirect(res, '/admin/eca?success=' + encodeURIComponent(`Rule ${rule.enabled ? 'disabled' : 'enabled'}: ${rule.label}`));
  }, 'Toggle ECA rule');

  /**
   * POST /admin/eca/delete/:id - Delete rule
   */
  register('POST', '/admin/eca/delete/:id', async (req, res, params, ctx) => {
    let actionsService;
    try { actionsService = ctx.services.get('actions'); } catch (e) {
      redirect(res, '/admin/eca?error=Actions+service+not+available');
      return;
    }
    try {
      actionsService.deleteRule(params.id);
      redirect(res, '/admin/eca?success=Rule+deleted');
    } catch (err) {
      redirect(res, '/admin/eca?error=' + encodeURIComponent(err.message));
    }
  }, 'Delete ECA rule');

  // ==========================================
  // Webform Admin Routes
  // ==========================================

  /**
   * GET /admin/webforms - Webform listing
   */
  register('GET', '/admin/webforms', async (req, res, params, ctx) => {
    let wf;
    try { wf = ctx.services.get('webform'); } catch (e) {}
    if (!wf) { redirect(res, '/admin?error=Webform+service+not+available'); return; }

    const forms = wf.listForms().map(f => ({
      ...f,
      elementCount: (f.elements || []).filter(e => e.type !== 'page_break' && e.type !== 'markup').length,
      submissionCount: wf.countSubmissions(f.id),
    }));

    const flash = getFlashMessage(req.url);
    const html = renderAdmin('webform-list.html', {
      pageTitle: 'Webforms',
      forms,
      flash,
      hasFlash: !!flash,
    }, ctx, req);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }, 'List webforms');

  /**
   * GET /admin/webforms/add - Create webform
   */
  register('GET', '/admin/webforms/add', async (req, res, params, ctx) => {
    let wf;
    try { wf = ctx.services.get('webform'); } catch (e) {}
    if (!wf) { redirect(res, '/admin?error=Webform+service+not+available'); return; }

    const elementTypes = Object.entries(wf.getElementTypes()).map(([value, info]) => ({
      value,
      label: info.label,
    }));

    const html = renderAdmin('webform-edit.html', {
      pageTitle: 'Create Webform',
      isNew: true,
      form: { id: '', title: '', description: '', status: 'open', elements: [], settings: { submitLabel: 'Submit', confirmationMessage: 'Thank you for your submission.', confirmationType: 'message', redirectUrl: '', limitTotal: 0 }, handlers: [] },
      formAction: '/admin/webforms/save',
      elementTypes,
      elementTypesJson: JSON.stringify(elementTypes),
    }, ctx, req);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }, 'Create webform form');

  /**
   * GET /admin/webforms/edit/:id - Edit webform
   */
  register('GET', '/admin/webforms/edit/:id', async (req, res, params, ctx) => {
    let wf;
    try { wf = ctx.services.get('webform'); } catch (e) {}
    if (!wf) { redirect(res, '/admin?error=Webform+service+not+available'); return; }

    const form = wf.getForm(params.id);
    if (!form) { redirect(res, '/admin/webforms?error=Form+not+found'); return; }

    const elementTypes = Object.entries(wf.getElementTypes()).map(([value, info]) => ({
      value,
      label: info.label,
    }));

    // Prepare elements for template with selected states and serialized options/showIf
    const elements = (form.elements || []).map(el => ({
      ...el,
      optionsRaw: (el.options || []).map(o => o.value + '|' + o.label).join(', '),
      showIfRaw: el.showIf ? (el.showIf.field + '|' + el.showIf.operator + '|' + (el.showIf.value || '')) : '',
    }));

    // Add selected state to element types for each element
    const elementsWithTypes = elements.map(el => ({
      ...el,
      elementTypes: elementTypes.map(t => ({ ...t, selected: t.value === el.type })),
    }));

    const handlers = (form.handlers || []).map(h => ({
      ...h,
      settingsRaw: JSON.stringify(h.settings || {}),
    }));

    const html = renderAdmin('webform-edit.html', {
      pageTitle: 'Edit Webform: ' + form.title,
      isNew: false,
      form: { ...form, elements: elementsWithTypes, handlers },
      formAction: '/admin/webforms/save/' + params.id,
      elementTypes,
      elementTypesJson: JSON.stringify(elementTypes),
    }, ctx, req);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }, 'Edit webform form');

  /**
   * POST /admin/webforms/save/:id - Save/update webform
   * POST /admin/webforms/save - Create new webform
   */
  register('POST', '/admin/webforms/save/:id', async (req, res, params, ctx) => {
    let wf;
    try { wf = ctx.services.get('webform'); } catch (e) {}
    if (!wf) { redirect(res, '/admin?error=Webform+service+not+available'); return; }

    try {
      const body = ctx._parsedBody || {};
      const id = params.id || body.id;
      if (!id) { redirect(res, '/admin/webforms/add?error=ID+required'); return; }

      // Parse elements from indexed form fields
      const elements = [];
      for (let i = 0; i < 200; i++) {
        const type = body['elements[' + i + '][type]'];
        if (!type) break;
        const key = body['elements[' + i + '][key]'] || '';
        const label = body['elements[' + i + '][label]'] || '';
        const required = body['elements[' + i + '][required]'] === '1';
        const placeholder = body['elements[' + i + '][placeholder]'] || '';
        const optionsRaw = body['elements[' + i + '][options_raw]'] || '';
        const showIfRaw = body['elements[' + i + '][showIf_raw]'] || '';

        const el = { type, key, label, required, placeholder };

        // Parse options: "val1|Label 1, val2|Label 2"
        if (optionsRaw.trim()) {
          el.options = optionsRaw.split(',').map(s => {
            const parts = s.trim().split('|');
            return { value: parts[0].trim(), label: (parts[1] || parts[0]).trim() };
          }).filter(o => o.value);
        }

        // Parse showIf: "field|operator|value"
        if (showIfRaw.trim()) {
          const parts = showIfRaw.split('|');
          if (parts.length >= 2) {
            el.showIf = { field: parts[0].trim(), operator: parts[1].trim(), value: (parts[2] || '').trim() };
          }
        }

        elements.push(el);
      }

      // Parse handlers
      const handlers = [];
      for (let i = 0; i < 50; i++) {
        const type = body['handlers[' + i + '][type]'];
        if (!type) break;
        const settingsRaw = body['handlers[' + i + '][settings_raw]'] || '{}';
        let settings = {};
        try { settings = JSON.parse(settingsRaw); } catch { /* keep empty */ }
        handlers.push({ type, settings });
      }

      // Parse settings
      const settings = {};
      const settingsKeys = ['submitLabel', 'confirmationMessage', 'confirmationType', 'redirectUrl', 'limitTotal'];
      for (const key of settingsKeys) {
        const val = body['settings[' + key + ']'];
        if (val !== undefined) {
          settings[key] = key === 'limitTotal' ? parseInt(val, 10) || 0 : val;
        }
      }

      const formData = {
        id,
        title: body.title || id,
        description: body.description || '',
        status: body.status || 'open',
        elements,
        handlers,
        settings,
      };

      const existing = wf.getForm(id);
      if (existing) {
        await wf.updateForm(id, formData);
      } else {
        await wf.createForm(formData);
      }

      redirect(res, '/admin/webforms?success=' + encodeURIComponent('Webform saved: ' + formData.title));
    } catch (error) {
      redirect(res, '/admin/webforms?error=' + encodeURIComponent(error.message));
    }
  }, 'Save webform');

  register('POST', '/admin/webforms/save', async (req, res, params, ctx) => {
    // Delegate to save/:id handler with ID from body
    const body = ctx._parsedBody || {};
    const id = body.id;
    if (!id) { redirect(res, '/admin/webforms/add?error=ID+required'); return; }
    params.id = id;

    let wf;
    try { wf = ctx.services.get('webform'); } catch (e) {}
    if (!wf) { redirect(res, '/admin?error=Webform+service+not+available'); return; }

    try {
      // Parse elements, handlers, settings (same logic as save/:id)
      const elements = [];
      for (let i = 0; i < 200; i++) {
        const type = body['elements[' + i + '][type]'];
        if (!type) break;
        const key = body['elements[' + i + '][key]'] || '';
        const label = body['elements[' + i + '][label]'] || '';
        const required = body['elements[' + i + '][required]'] === '1';
        const placeholder = body['elements[' + i + '][placeholder]'] || '';
        const optionsRaw = body['elements[' + i + '][options_raw]'] || '';
        const showIfRaw = body['elements[' + i + '][showIf_raw]'] || '';
        const el = { type, key, label, required, placeholder };
        if (optionsRaw.trim()) {
          el.options = optionsRaw.split(',').map(s => {
            const parts = s.trim().split('|');
            return { value: parts[0].trim(), label: (parts[1] || parts[0]).trim() };
          }).filter(o => o.value);
        }
        if (showIfRaw.trim()) {
          const parts = showIfRaw.split('|');
          if (parts.length >= 2) {
            el.showIf = { field: parts[0].trim(), operator: parts[1].trim(), value: (parts[2] || '').trim() };
          }
        }
        elements.push(el);
      }
      const handlers = [];
      for (let i = 0; i < 50; i++) {
        const type = body['handlers[' + i + '][type]'];
        if (!type) break;
        const settingsRaw = body['handlers[' + i + '][settings_raw]'] || '{}';
        let settings = {};
        try { settings = JSON.parse(settingsRaw); } catch { /* keep empty */ }
        handlers.push({ type, settings });
      }
      const settings = {};
      const settingsKeys = ['submitLabel', 'confirmationMessage', 'confirmationType', 'redirectUrl', 'limitTotal'];
      for (const key of settingsKeys) {
        const val = body['settings[' + key + ']'];
        if (val !== undefined) {
          settings[key] = key === 'limitTotal' ? parseInt(val, 10) || 0 : val;
        }
      }
      await wf.createForm({ id, title: body.title || id, description: body.description || '', status: body.status || 'open', elements, handlers, settings });
      redirect(res, '/admin/webforms?success=' + encodeURIComponent('Webform created: ' + (body.title || id)));
    } catch (err) {
      redirect(res, '/admin/webforms/add?error=' + encodeURIComponent(err.message));
    }
  }, 'Create webform');

  /**
   * GET /admin/webforms/submissions/:id - View submissions
   */
  register('GET', '/admin/webforms/submissions/:id', async (req, res, params, ctx) => {
    let wf;
    try { wf = ctx.services.get('webform'); } catch (e) {}
    if (!wf) { redirect(res, '/admin?error=Webform+service+not+available'); return; }

    const form = wf.getForm(params.id);
    if (!form) { redirect(res, '/admin/webforms?error=Form+not+found'); return; }

    // Parse page from query string
    const urlObj = new URL(req.url, 'http://localhost');
    const page = parseInt(urlObj.searchParams.get('page') || '0', 10);
    const limit = 50;

    const submissions = wf.listSubmissions(params.id, { limit, offset: page * limit });

    // Build columns from form elements
    const columns = (form.elements || [])
      .filter(el => el.type !== 'page_break' && el.type !== 'markup' && el.type !== 'fieldset')
      .slice(0, 6) // Show first 6 columns max in table
      .map(el => ({ key: el.key, label: el.label || el.key }));

    // Pre-compute cell values since template engine doesn't support {{lookup}}
    const enrichedItems = (submissions.items || []).map(sub => {
      const cells = columns.map(col => {
        const val = sub.data && sub.data[col.key];
        return { value: val != null ? String(val) : '' };
      });
      return { ...sub, cells };
    });
    const enrichedSubmissions = { ...submissions, items: enrichedItems };

    const html = renderAdmin('webform-submissions.html', {
      pageTitle: 'Submissions: ' + form.title,
      form,
      submissions: enrichedSubmissions,
      columns,
      hasPrev: page > 0,
      hasNext: (page + 1) * limit < submissions.total,
      prevPage: page - 1,
      nextPage: page + 1,
    }, ctx, req);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }, 'View webform submissions');

  /**
   * GET /admin/webforms/submission/:formId/:subId - View single submission
   */
  register('GET', '/admin/webforms/submission/:formId/:subId', async (req, res, params, ctx) => {
    let wf;
    try { wf = ctx.services.get('webform'); } catch (e) {}
    if (!wf) { redirect(res, '/admin?error=Webform+service+not+available'); return; }

    const form = wf.getForm(params.formId);
    if (!form) { redirect(res, '/admin/webforms?error=Form+not+found'); return; }

    const submission = wf.getSubmission(params.formId, params.subId);
    if (!submission) { redirect(res, '/admin/webforms/submissions/' + params.formId + '?error=Submission+not+found'); return; }

    // Build a simple detail view
    let detailHtml = '<div class="admin-content">';
    detailHtml += '<h1>Submission: ' + submission.id + '</h1>';
    detailHtml += '<p><a href="/admin/webforms/submissions/' + form.id + '">Back to submissions</a></p>';
    detailHtml += '<table class="admin-table"><tbody>';
    detailHtml += '<tr><th>Submitted</th><td>' + (submission.created || '') + '</td></tr>';
    detailHtml += '<tr><th>IP</th><td>' + (submission.ip || 'N/A') + '</td></tr>';
    detailHtml += '<tr><th>User</th><td>' + (submission.userId || 'Anonymous') + '</td></tr>';
    for (const el of (form.elements || [])) {
      if (el.type === 'page_break' || el.type === 'markup' || el.type === 'fieldset') continue;
      const val = submission.data?.[el.key];
      const display = val === undefined ? '' : (Array.isArray(val) ? val.join(', ') : String(val));
      detailHtml += '<tr><th>' + (el.label || el.key) + '</th><td>' + display + '</td></tr>';
    }
    detailHtml += '</tbody></table></div>';

    const html = renderAdmin('dashboard.html', { pageTitle: 'Submission Detail', _rawContent: detailHtml }, ctx, req);
    // For submission detail, render inline since we don't need a dedicated template
    res.writeHead(200, { 'Content-Type': 'text/html' });
    // Actually just wrap in layout directly
    const layoutHtml = renderAdmin('webform-submissions.html', {
      pageTitle: 'Submission: ' + submission.id,
      form,
      submissions: { items: [], total: 0 },
      columns: [],
    }, ctx, req);
    // Simpler approach: just send the detail HTML with admin layout
    const adminLayout = renderAdmin('content-list.html', { pageTitle: 'Submission Detail' }, ctx, req);
    // Let's just use a direct response with the admin chrome
    res.end(detailHtml);
  }, 'View single submission');

  /**
   * POST /admin/webforms/submission/:formId/:subId/delete - Delete submission
   */
  register('POST', '/admin/webforms/submission/:formId/:subId/delete', async (req, res, params, ctx) => {
    let wf;
    try { wf = ctx.services.get('webform'); } catch (e) {}
    if (!wf) { redirect(res, '/admin?error=Webform+service+not+available'); return; }

    try {
      await wf.deleteSubmission(params.formId, params.subId);
      redirect(res, '/admin/webforms/submissions/' + params.formId + '?success=Submission+deleted');
    } catch (err) {
      redirect(res, '/admin/webforms/submissions/' + params.formId + '?error=' + encodeURIComponent(err.message));
    }
  }, 'Delete submission');

  /**
   * GET /admin/webforms/export/:id - Export submissions as CSV
   */
  register('GET', '/admin/webforms/export/:id', async (req, res, params, ctx) => {
    let wf;
    try { wf = ctx.services.get('webform'); } catch (e) {}
    if (!wf) { redirect(res, '/admin?error=Webform+service+not+available'); return; }

    try {
      const csv = wf.exportCsv(params.id);
      res.writeHead(200, {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="' + params.id + '-submissions.csv"',
      });
      res.end(csv);
    } catch (err) {
      redirect(res, '/admin/webforms?error=' + encodeURIComponent(err.message));
    }
  }, 'Export webform CSV');

  /**
   * POST /admin/webforms/delete/:id - Delete webform
   */
  register('POST', '/admin/webforms/delete/:id', async (req, res, params, ctx) => {
    let wf;
    try { wf = ctx.services.get('webform'); } catch (e) {}
    if (!wf) { redirect(res, '/admin?error=Webform+service+not+available'); return; }

    try {
      await wf.deleteForm(params.id);
      redirect(res, '/admin/webforms?success=Webform+deleted');
    } catch (err) {
      redirect(res, '/admin/webforms?error=' + encodeURIComponent(err.message));
    }
  }, 'Delete webform');

  // ==========================================
  // Public Webform Routes
  // ==========================================

  /**
   * GET /form/:id - Render public webform
   */
  register('GET', '/form/:id', async (req, res, params, ctx) => {
    let wf;
    try { wf = ctx.services.get('webform'); } catch (e) {}
    if (!wf) { res.writeHead(404); res.end('Form system not available'); return; }

    const form = wf.getForm(params.id);
    if (!form) { res.writeHead(404); res.end('Form not found'); return; }
    if (form.status !== 'open') { res.writeHead(403); res.end('This form is not currently accepting submissions.'); return; }

    const formHtml = wf.renderFormHtml(form);
    const pageHtml = '<div class="webform-page"><h1>' + form.title + '</h1>' +
      (form.description ? '<p>' + form.description + '</p>' : '') +
      formHtml + '</div>';

    // Try to render within site theme, fallback to bare HTML
    try {
      const templateSvc = ctx.services.get('template');
      const html = templateSvc.render('layout.html', {
        title: form.title,
        content: pageHtml,
        siteName: ctx.config?.site?.name || 'CMS',
      });
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!DOCTYPE html><html><head><title>' + form.title + '</title></head><body>' + pageHtml + '</body></html>');
    }
  }, 'Render public webform');

  /**
   * POST /form/:id - Submit webform
   */
  register('POST', '/form/:id', async (req, res, params, ctx) => {
    let wf;
    try { wf = ctx.services.get('webform'); } catch (e) {}
    if (!wf) { res.writeHead(500); res.end('Form system not available'); return; }

    const form = wf.getForm(params.id);
    if (!form) { res.writeHead(404); res.end('Form not found'); return; }

    const body = ctx._parsedBody || {};

    // Handle multi-step navigation
    const pageTarget = body._webform_page;
    if (pageTarget !== undefined) {
      const pageNum = parseInt(pageTarget, 10);
      const formHtml = wf.renderFormHtml(form, body, [], pageNum);
      const pageHtml = '<div class="webform-page"><h1>' + form.title + '</h1>' + formHtml + '</div>';
      try {
        const templateSvc = ctx.services.get('template');
        const html = templateSvc.render('layout.html', { title: form.title, content: pageHtml, siteName: ctx.config?.site?.name || 'CMS' });
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!DOCTYPE html><html><head><title>' + form.title + '</title></head><body>' + pageHtml + '</body></html>');
      }
      return;
    }

    try {
      const result = await wf.submit(params.id, body, {
        ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
        userAgent: req.headers['user-agent'],
        user: ctx._user || null,
      });

      if (!result.success) {
        // Re-render with errors
        const formHtml = wf.renderFormHtml(form, body, result.errors || []);
        const pageHtml = '<div class="webform-page"><h1>' + form.title + '</h1>' + formHtml + '</div>';
        try {
          const templateSvc = ctx.services.get('template');
          const html = templateSvc.render('layout.html', { title: form.title, content: pageHtml, siteName: ctx.config?.site?.name || 'CMS' });
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(html);
        } catch {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<!DOCTYPE html><html><body>' + pageHtml + '</body></html>');
        }
        return;
      }

      if (result.redirect) {
        redirect(res, result.redirect);
        return;
      }

      // Show confirmation message
      const confirmHtml = '<div class="webform-confirmation"><h1>' + form.title + '</h1><div class="alert alert-success">' + (result.message || 'Submission received.') + '</div></div>';
      try {
        const templateSvc = ctx.services.get('template');
        const html = templateSvc.render('layout.html', { title: form.title, content: confirmHtml, siteName: ctx.config?.site?.name || 'CMS' });
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!DOCTYPE html><html><body>' + confirmHtml + '</body></html>');
      }
    } catch (err) {
      const errHtml = '<div class="webform-page"><h1>' + form.title + '</h1><div class="alert alert-danger">' + err.message + '</div></div>';
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(errHtml);
    }
  }, 'Submit webform');

  // ==========================================
  // Experience Builder Routes
  // ==========================================

  /**
   * GET /admin/xb/:type/:id - Experience Builder visual editor page
   */
  register('GET', '/admin/xb/:type/:id', async (req, res, params, ctx) => {
    let lb;
    try { lb = ctx.services.get('layout-builder'); } catch (e) {}
    if (!lb) { redirect(res, '/admin?error=Layout+builder+not+available'); return; }

    // Get content title for display
    let contentTitle = params.id;
    try {
      const contentSvc = ctx.services.get('content');
      const item = contentSvc.read(params.type, params.id);
      if (item) contentTitle = item.title || item.name || params.id;
    } catch { /* use ID as fallback */ }

    const html = renderAdmin('experience-builder.html', {
      pageTitle: 'Experience Builder',
      contentType: params.type,
      contentId: params.id,
      contentTitle,
    }, ctx, req);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }, 'Experience Builder editor');

  /**
   * GET /admin/xb/api/layout/:type/:id - Get layout data as JSON
   */
  register('GET', '/admin/xb/api/layout/:type/:id', async (req, res, params, ctx) => {
    let lb;
    try { lb = ctx.services.get('layout-builder'); } catch (e) {}
    if (!lb) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Layout builder not available' }));
      return;
    }

    try {
      const layout = lb.getEffectiveLayout(params.type, params.id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(layout || { sections: [] }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }, 'Get layout JSON');

  /**
   * POST /admin/xb/api/layout/:type/:id - Save layout data
   */
  register('POST', '/admin/xb/api/layout/:type/:id', async (req, res, params, ctx) => {
    let lb;
    try { lb = ctx.services.get('layout-builder'); } catch (e) {}
    if (!lb) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Layout builder not available' }));
      return;
    }

    try {
      // Parse JSON body
      let body = ctx._parsedBody;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = {}; }
      }

      await lb.setContentLayout(params.type, params.id, body);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }, 'Save layout JSON');

  /**
   * GET /admin/xb/api/components - List available components for sidebar
   *
   * Returns blocks + SDC components that can be placed in layouts.
   */
  register('GET', '/admin/xb/api/components', async (req, res, params, ctx) => {
    const components = [];

    // Add blocks
    try {
      const blocksSvc = ctx.services.get('blocks');
      const blocks = blocksSvc.listBlocks ? blocksSvc.listBlocks() : [];
      blocks.forEach(function(block) {
        components.push({
          id: block.id,
          label: block.label || block.title || block.id,
          type: 'block',
          category: 'Blocks',
        });
      });
    } catch { /* blocks service not available */ }

    // Add SDC components if available
    try {
      const sdcSvc = ctx.services.get('sdc');
      const sdcComponents = sdcSvc.listComponents ? sdcSvc.listComponents() : [];
      sdcComponents.forEach(function(comp) {
        components.push({
          id: comp.machineName || comp.id,
          label: comp.name || comp.machineName || comp.id,
          type: 'sdc',
          category: 'Components',
        });
      });
    } catch { /* SDC service not available */ }

    // Add field components for the current content type
    components.push(
      { id: 'field:title', label: 'Title', type: 'field', category: 'Fields' },
      { id: 'field:body', label: 'Body', type: 'field', category: 'Fields' },
      { id: 'field:image', label: 'Image', type: 'field', category: 'Fields' },
      { id: 'field:created', label: 'Date', type: 'field', category: 'Fields' },
      { id: 'field:author', label: 'Author', type: 'field', category: 'Fields' },
    );

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(components));
  }, 'List XB components');

  /**
   * GET /admin/xb/api/layouts - List available layout definitions
   */
  register('GET', '/admin/xb/api/layouts', async (req, res, params, ctx) => {
    let lb;
    try { lb = ctx.services.get('layout-builder'); } catch (e) {}

    let layouts = [];
    if (lb && lb.listLayouts) {
      layouts = lb.listLayouts().map(function(l) {
        return {
          id: l.id,
          label: l.label,
          description: l.description || '',
          category: l.category || '',
          regions: l.regions,
          defaultSettings: l.defaultSettings || {},
        };
      });
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(layouts));
  }, 'List layout definitions');

  // ==========================================
  // Views Admin Routes
  // ==========================================

  /**
   * GET /admin/views - Views listing
   */
  register('GET', '/admin/views', async (req, res, params, ctx) => {
    let viewsService;
    try { viewsService = ctx.services.get('views'); } catch (e) {}
    const views = viewsService && viewsService.listViews ? viewsService.listViews() : [];
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('views-list.html', {
      pageTitle: 'Views',
      views,
      hasViews: views.length > 0,
      viewCount: views.length,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Views listing');

  // ==========================================
  // Roles & Permissions Admin Routes
  // ==========================================

  /**
   * GET /admin/roles - Roles listing
   */
  register('GET', '/admin/roles', async (req, res, params, ctx) => {
    let permsService;
    try { permsService = ctx.services.get('permissions'); } catch (e) {}
    const roles = permsService && permsService.listRoles ? permsService.listRoles() : [];
    const flash = getFlashMessage(req.url);

    const rolesList = roles.map(role => {
      const perms = permsService.getPermissions ? permsService.getPermissions(role) : [];
      return { name: role, permissionCount: perms.length };
    });

    const html = renderAdmin('roles-list.html', {
      pageTitle: 'Roles',
      roles: rolesList,
      hasRoles: rolesList.length > 0,
      roleCount: rolesList.length,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Roles listing');

  /**
   * GET /admin/permissions - Permissions matrix
   */
  register('GET', '/admin/permissions', async (req, res, params, ctx) => {
    let permsService;
    try { permsService = ctx.services.get('permissions'); } catch (e) {}
    const roles = permsService && permsService.listRoles ? permsService.listRoles() : [];
    const allPermissions = permsService && permsService.listPermissions ? permsService.listPermissions() : [];
    const flash = getFlashMessage(req.url);

    // Build a matrix: for each permission, which roles have it
    const matrix = allPermissions.map(perm => {
      const roleFlags = roles.map(role => {
        const perms = permsService.getPermissions ? permsService.getPermissions(role) : [];
        return { role, granted: perms.includes(perm) || perms.includes('*') };
      });
      return { permission: perm, roles: roleFlags };
    });

    const html = renderAdmin('permissions-matrix.html', {
      pageTitle: 'Permissions',
      roles,
      matrix,
      hasMatrix: matrix.length > 0,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Permissions matrix');

  // ==========================================
  // Permissions Save (B7)
  // ==========================================

  /**
   * POST /admin/permissions - Save permissions matrix
   */
  register('POST', '/admin/permissions', async (req, res, params, ctx) => {
    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      let permsService;
      try { permsService = ctx.services.get('permissions'); } catch (e) {}

      if (permsService && permsService.savePermissions) {
        // Parse the permissions[role][permission] structure from form data
        const permissions = {};
        for (const [key, value] of Object.entries(formData)) {
          const match = key.match(/^permissions\[(.+?)\]\[(.+?)\]$/);
          if (match) {
            const [, roleId, permId] = match;
            if (!permissions[roleId]) permissions[roleId] = [];
            permissions[roleId].push(permId);
          }
        }
        await permsService.savePermissions(permissions);
      }

      redirect(res, '/admin/permissions?success=' + encodeURIComponent('Permissions saved'));
    } catch (error) {
      console.error('[admin] Save permissions error:', error.message);
      redirect(res, '/admin/permissions?error=' + encodeURIComponent(error.message));
    }
  }, 'Save permissions');

  // ==========================================
  // Image Styles Edit (B6)
  // ==========================================

  /**
   * GET /admin/image-styles/:name/edit - Edit image style
   */
  register('GET', '/admin/image-styles/:name/edit', async (req, res, params, ctx) => {
    const { name } = params;
    let imageStylesService;
    try { imageStylesService = ctx.services.get('imageStyles'); } catch (e) {}
    if (!imageStylesService) {
      redirect(res, '/admin?error=' + encodeURIComponent('Image styles service not available'));
      return;
    }

    const style = imageStylesService.getStyle ? imageStylesService.getStyle(name) : null;
    if (!style) {
      redirect(res, '/admin/image-styles?error=' + encodeURIComponent('Style not found: ' + name));
      return;
    }

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('image-styles-edit.html', {
      pageTitle: 'Edit Image Style: ' + (style.label || name),
      style,
      styleName: name,
      isNew: false,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Edit image style');

  /**
   * POST /admin/image-styles/:name - Update image style
   */
  register('POST', '/admin/image-styles/:name', async (req, res, params, ctx) => {
    const { name } = params;
    try {
      let imageStylesService;
      try { imageStylesService = ctx.services.get('imageStyles'); } catch (e) {}
      if (!imageStylesService) {
        redirect(res, '/admin?error=' + encodeURIComponent('Image styles service not available'));
        return;
      }

      const formData = ctx._parsedBody || await parseFormBody(req);
      if (imageStylesService.updateStyle) {
        await imageStylesService.updateStyle(name, formData);
      }

      redirect(res, '/admin/image-styles?success=' + encodeURIComponent('Style updated: ' + name));
    } catch (error) {
      console.error('[admin] Update image style error:', error.message);
      redirect(res, '/admin/image-styles/' + name + '/edit?error=' + encodeURIComponent(error.message));
    }
  }, 'Update image style');

  /**
   * POST /admin/image-styles/:name/delete - Delete image style
   */
  register('POST', '/admin/image-styles/:name/delete', async (req, res, params, ctx) => {
    const { name } = params;
    try {
      let imageStylesService;
      try { imageStylesService = ctx.services.get('imageStyles'); } catch (e) {}
      if (!imageStylesService) {
        redirect(res, '/admin?error=' + encodeURIComponent('Image styles service not available'));
        return;
      }

      if (imageStylesService.deleteStyle) {
        await imageStylesService.deleteStyle(name);
      }

      redirect(res, '/admin/image-styles?success=' + encodeURIComponent('Style deleted: ' + name));
    } catch (error) {
      console.error('[admin] Delete image style error:', error.message);
      redirect(res, '/admin/image-styles?error=' + encodeURIComponent(error.message));
    }
  }, 'Delete image style');

  // ==========================================
  // Menu Attributes Config (B8)
  // ==========================================

  /**
   * POST /admin/config/system/menu-attributes - Save menu attribute settings
   */
  register('POST', '/admin/config/system/menu-attributes', async (req, res, params, ctx) => {
    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      let configMgr;
      try { configMgr = ctx.services.get('configManagement'); } catch (e) {}

      if (configMgr && configMgr.set) {
        await configMgr.set('menu-attributes', formData);
      }

      redirect(res, '/admin/config/system/menu-attributes?success=' + encodeURIComponent('Menu attributes settings saved'));
    } catch (error) {
      console.error('[admin] Save menu attributes error:', error.message);
      redirect(res, '/admin/config/system/menu-attributes?error=' + encodeURIComponent(error.message));
    }
  }, 'Save menu attributes config');

  // ==========================================
  // Display Modes CRUD (B2)
  // ==========================================

  /**
   * GET /admin/display-modes - List display modes
   */
  register('GET', '/admin/display-modes', async (req, res, params, ctx) => {
    let configMgr;
    try { configMgr = ctx.services.get('configManagement'); } catch (e) {}
    const modes = (configMgr && configMgr.get) ? (configMgr.get('display-modes') || []) : [];
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('display-modes-list.html', {
      pageTitle: 'Display Modes',
      modes,
      hasModes: Array.isArray(modes) && modes.length > 0,
      modeCount: Array.isArray(modes) ? modes.length : 0,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Display modes list');

  /**
   * GET /admin/display-modes/create - Create display mode form
   */
  register('GET', '/admin/display-modes/create', async (req, res, params, ctx) => {
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('display-modes-list.html', {
      pageTitle: 'Create Display Mode',
      isNew: true,
      mode: {},
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Create display mode form');

  /**
   * POST /admin/display-modes - Create display mode
   */
  register('POST', '/admin/display-modes', async (req, res, params, ctx) => {
    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      let configMgr;
      try { configMgr = ctx.services.get('configManagement'); } catch (e) {}

      if (configMgr && configMgr.get && configMgr.set) {
        const modes = configMgr.get('display-modes') || [];
        modes.push({
          name: formData.name || formData.machineName,
          label: formData.label || formData.name,
          description: formData.description || '',
        });
        await configMgr.set('display-modes', modes);
      }

      redirect(res, '/admin/display-modes?success=' + encodeURIComponent('Display mode created'));
    } catch (error) {
      console.error('[admin] Create display mode error:', error.message);
      redirect(res, '/admin/display-modes/create?error=' + encodeURIComponent(error.message));
    }
  }, 'Create display mode');

  /**
   * GET /admin/display-modes/:name/edit - Edit display mode form
   */
  register('GET', '/admin/display-modes/:name/edit', async (req, res, params, ctx) => {
    const { name } = params;
    let configMgr;
    try { configMgr = ctx.services.get('configManagement'); } catch (e) {}
    const modes = (configMgr && configMgr.get) ? (configMgr.get('display-modes') || []) : [];
    const mode = modes.find(m => m.name === name);

    if (!mode) {
      redirect(res, '/admin/display-modes?error=' + encodeURIComponent('Display mode not found: ' + name));
      return;
    }

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('display-modes-list.html', {
      pageTitle: 'Edit Display Mode: ' + (mode.label || name),
      isNew: false,
      mode,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Edit display mode form');

  /**
   * POST /admin/display-modes/:name - Update display mode
   */
  register('POST', '/admin/display-modes/:name', async (req, res, params, ctx) => {
    const { name } = params;
    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      let configMgr;
      try { configMgr = ctx.services.get('configManagement'); } catch (e) {}

      if (configMgr && configMgr.get && configMgr.set) {
        const modes = configMgr.get('display-modes') || [];
        const idx = modes.findIndex(m => m.name === name);
        if (idx >= 0) {
          modes[idx] = { ...modes[idx], label: formData.label, description: formData.description };
          await configMgr.set('display-modes', modes);
        }
      }

      redirect(res, '/admin/display-modes?success=' + encodeURIComponent('Display mode updated'));
    } catch (error) {
      console.error('[admin] Update display mode error:', error.message);
      redirect(res, '/admin/display-modes/' + name + '/edit?error=' + encodeURIComponent(error.message));
    }
  }, 'Update display mode');

  /**
   * POST /admin/display-modes/:name/delete - Delete display mode
   */
  register('POST', '/admin/display-modes/:name/delete', async (req, res, params, ctx) => {
    const { name } = params;
    try {
      let configMgr;
      try { configMgr = ctx.services.get('configManagement'); } catch (e) {}

      if (configMgr && configMgr.get && configMgr.set) {
        const modes = (configMgr.get('display-modes') || []).filter(m => m.name !== name);
        await configMgr.set('display-modes', modes);
      }

      redirect(res, '/admin/display-modes?success=' + encodeURIComponent('Display mode deleted'));
    } catch (error) {
      console.error('[admin] Delete display mode error:', error.message);
      redirect(res, '/admin/display-modes?error=' + encodeURIComponent(error.message));
    }
  }, 'Delete display mode');

  // ==========================================
  // Editor Formats CRUD (B5)
  // ==========================================

  /**
   * GET /admin/editor/new - Create editor format form
   */
  register('GET', '/admin/editor/new', async (req, res, params, ctx) => {
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('editor-formats.html', {
      pageTitle: 'Create Editor Format',
      isNew: true,
      format: {},
      formats: [],
      categories: [],
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Create editor format form');

  /**
   * POST /admin/editor - Create editor format
   */
  register('POST', '/admin/editor', async (req, res, params, ctx) => {
    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      let editor;
      try { editor = ctx.services.get('editor'); } catch (e) {}

      if (editor && editor.createFormat) {
        await editor.createFormat(formData);
      }

      redirect(res, '/admin/editor?success=' + encodeURIComponent('Editor format created'));
    } catch (error) {
      console.error('[admin] Create editor format error:', error.message);
      redirect(res, '/admin/editor/new?error=' + encodeURIComponent(error.message));
    }
  }, 'Create editor format');

  /**
   * GET /admin/editor/:id/edit - Edit editor format form
   */
  register('GET', '/admin/editor/:id/edit', async (req, res, params, ctx) => {
    const { id } = params;
    let editor;
    try { editor = ctx.services.get('editor'); } catch (e) {}

    const format = editor && editor.getFormat ? editor.getFormat(id) : null;
    if (!format) {
      redirect(res, '/admin/editor?error=' + encodeURIComponent('Format not found: ' + id));
      return;
    }

    const flash = getFlashMessage(req.url);
    const categories = editor && editor.listButtonCategories ? editor.listButtonCategories() : [];

    const html = renderAdmin('editor-formats.html', {
      pageTitle: 'Edit Editor Format: ' + (format.label || id),
      isNew: false,
      format,
      formats: [],
      categories,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Edit editor format form');

  /**
   * POST /admin/editor/:id - Update editor format
   */
  register('POST', '/admin/editor/:id', async (req, res, params, ctx) => {
    const { id } = params;
    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      let editor;
      try { editor = ctx.services.get('editor'); } catch (e) {}

      if (editor && editor.updateFormat) {
        await editor.updateFormat(id, formData);
      }

      redirect(res, '/admin/editor?success=' + encodeURIComponent('Editor format updated'));
    } catch (error) {
      console.error('[admin] Update editor format error:', error.message);
      redirect(res, '/admin/editor/' + id + '/edit?error=' + encodeURIComponent(error.message));
    }
  }, 'Update editor format');

  /**
   * GET /admin/editor/buttons - Editor button browser
   */
  register('GET', '/admin/editor/buttons', async (req, res, params, ctx) => {
    let editor;
    try { editor = ctx.services.get('editor'); } catch (e) {}

    const categories = editor && editor.listButtonCategories ? editor.listButtonCategories() : [];
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('editor-formats.html', {
      pageTitle: 'Editor Buttons',
      isButtonBrowser: true,
      categories,
      formats: [],
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Editor button browser');

  // ==========================================
  // Responsive Images CRUD (B4)
  // ==========================================

  /**
   * GET /admin/responsive-images/new - Create responsive image style form
   */
  register('GET', '/admin/responsive-images/new', async (req, res, params, ctx) => {
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('responsive-images.html', {
      pageTitle: 'Create Responsive Image Style',
      isNew: true,
      style: {},
      styles: [],
      breakpoints: [],
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Create responsive image style form');

  /**
   * POST /admin/responsive-images - Create responsive image style
   */
  register('POST', '/admin/responsive-images', async (req, res, params, ctx) => {
    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      let responsiveImages;
      try { responsiveImages = ctx.services.get('responsiveImages'); } catch (e) {}

      if (responsiveImages && responsiveImages.createStyle) {
        await responsiveImages.createStyle(formData);
      }

      redirect(res, '/admin/responsive-images?success=' + encodeURIComponent('Responsive image style created'));
    } catch (error) {
      console.error('[admin] Create responsive image style error:', error.message);
      redirect(res, '/admin/responsive-images/new?error=' + encodeURIComponent(error.message));
    }
  }, 'Create responsive image style');

  /**
   * GET /admin/responsive-images/:id/edit - Edit responsive image style form
   */
  register('GET', '/admin/responsive-images/:id/edit', async (req, res, params, ctx) => {
    const { id } = params;
    let responsiveImages;
    try { responsiveImages = ctx.services.get('responsiveImages'); } catch (e) {}

    const style = responsiveImages && responsiveImages.getStyle ? responsiveImages.getStyle(id) : null;
    if (!style) {
      redirect(res, '/admin/responsive-images?error=' + encodeURIComponent('Responsive image style not found: ' + id));
      return;
    }

    const flash = getFlashMessage(req.url);
    const breakpoints = responsiveImages && responsiveImages.listBreakpoints ? responsiveImages.listBreakpoints() : [];

    const html = renderAdmin('responsive-images.html', {
      pageTitle: 'Edit Responsive Image Style: ' + (style.label || id),
      isNew: false,
      style,
      styles: [],
      breakpoints,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Edit responsive image style form');

  /**
   * POST /admin/responsive-images/:id - Update responsive image style
   */
  register('POST', '/admin/responsive-images/:id', async (req, res, params, ctx) => {
    const { id } = params;
    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      let responsiveImages;
      try { responsiveImages = ctx.services.get('responsiveImages'); } catch (e) {}

      if (responsiveImages && responsiveImages.updateStyle) {
        await responsiveImages.updateStyle(id, formData);
      }

      redirect(res, '/admin/responsive-images?success=' + encodeURIComponent('Responsive image style updated'));
    } catch (error) {
      console.error('[admin] Update responsive image style error:', error.message);
      redirect(res, '/admin/responsive-images/' + id + '/edit?error=' + encodeURIComponent(error.message));
    }
  }, 'Update responsive image style');

  /**
   * POST /admin/responsive-images/:id/delete - Delete responsive image style
   */
  register('POST', '/admin/responsive-images/:id/delete', async (req, res, params, ctx) => {
    const { id } = params;
    try {
      let responsiveImages;
      try { responsiveImages = ctx.services.get('responsiveImages'); } catch (e) {}

      if (responsiveImages && responsiveImages.deleteStyle) {
        await responsiveImages.deleteStyle(id);
      }

      redirect(res, '/admin/responsive-images?success=' + encodeURIComponent('Responsive image style deleted'));
    } catch (error) {
      console.error('[admin] Delete responsive image style error:', error.message);
      redirect(res, '/admin/responsive-images?error=' + encodeURIComponent(error.message));
    }
  }, 'Delete responsive image style');

  // ==========================================
  // Workflows CRUD (B3)
  // ==========================================

  /**
   * GET /admin/workflows - List workflows
   */
  register('GET', '/admin/workflows', async (req, res, params, ctx) => {
    let configMgr;
    try { configMgr = ctx.services.get('configManagement'); } catch (e) {}
    const workflows = (configMgr && configMgr.get) ? (configMgr.get('workflows') || []) : [];
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('workflows-list.html', {
      pageTitle: 'Workflows',
      workflows,
      hasWorkflows: Array.isArray(workflows) && workflows.length > 0,
      workflowCount: Array.isArray(workflows) ? workflows.length : 0,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Workflows list');

  /**
   * GET /admin/workflows/new - Create workflow form
   */
  register('GET', '/admin/workflows/new', async (req, res, params, ctx) => {
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('workflows-edit.html', {
      pageTitle: 'Create Workflow',
      isNew: true,
      workflow: {},
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Create workflow form');

  /**
   * POST /admin/workflows - Create workflow
   */
  register('POST', '/admin/workflows', async (req, res, params, ctx) => {
    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      let configMgr;
      try { configMgr = ctx.services.get('configManagement'); } catch (e) {}

      if (configMgr && configMgr.get && configMgr.set) {
        const workflows = configMgr.get('workflows') || [];
        const id = formData.id || formData.name || ('workflow_' + Date.now());
        workflows.push({
          id,
          name: formData.name || formData.label,
          label: formData.label || formData.name,
          description: formData.description || '',
          states: formData.states ? JSON.parse(formData.states) : [
            { id: 'draft', label: 'Draft' },
            { id: 'review', label: 'In Review' },
            { id: 'published', label: 'Published' },
          ],
          transitions: formData.transitions ? JSON.parse(formData.transitions) : [],
        });
        await configMgr.set('workflows', workflows);
      }

      redirect(res, '/admin/workflows?success=' + encodeURIComponent('Workflow created'));
    } catch (error) {
      console.error('[admin] Create workflow error:', error.message);
      redirect(res, '/admin/workflows/new?error=' + encodeURIComponent(error.message));
    }
  }, 'Create workflow');

  /**
   * GET /admin/workflows/:id/edit - Edit workflow form
   */
  register('GET', '/admin/workflows/:id/edit', async (req, res, params, ctx) => {
    const { id } = params;
    let configMgr;
    try { configMgr = ctx.services.get('configManagement'); } catch (e) {}
    const workflows = (configMgr && configMgr.get) ? (configMgr.get('workflows') || []) : [];
    const workflow = workflows.find(w => w.id === id);

    if (!workflow) {
      redirect(res, '/admin/workflows?error=' + encodeURIComponent('Workflow not found: ' + id));
      return;
    }

    const flash = getFlashMessage(req.url);

    // Pre-compute transition numbers — template engine doesn't support {{add @index 1}}
    const enrichedWorkflow = { ...workflow };
    if (enrichedWorkflow.transitions) {
      enrichedWorkflow.transitions = enrichedWorkflow.transitions.map((t, i) => ({
        ...t,
        transitionNumber: i + 1,
      }));
    }

    const html = renderAdmin('workflows-edit.html', {
      pageTitle: 'Edit Workflow: ' + (workflow.label || id),
      isNew: false,
      workflow: enrichedWorkflow,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Edit workflow form');

  /**
   * POST /admin/workflows/:id - Update workflow
   */
  register('POST', '/admin/workflows/:id', async (req, res, params, ctx) => {
    const { id } = params;
    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      let configMgr;
      try { configMgr = ctx.services.get('configManagement'); } catch (e) {}

      if (configMgr && configMgr.get && configMgr.set) {
        const workflows = configMgr.get('workflows') || [];
        const idx = workflows.findIndex(w => w.id === id);
        if (idx >= 0) {
          workflows[idx] = {
            ...workflows[idx],
            label: formData.label || workflows[idx].label,
            description: formData.description || workflows[idx].description,
            states: formData.states ? JSON.parse(formData.states) : workflows[idx].states,
            transitions: formData.transitions ? JSON.parse(formData.transitions) : workflows[idx].transitions,
          };
          await configMgr.set('workflows', workflows);
        }
      }

      redirect(res, '/admin/workflows?success=' + encodeURIComponent('Workflow updated'));
    } catch (error) {
      console.error('[admin] Update workflow error:', error.message);
      redirect(res, '/admin/workflows/' + id + '/edit?error=' + encodeURIComponent(error.message));
    }
  }, 'Update workflow');

  /**
   * POST /admin/workflows/:id/delete - Delete workflow
   */
  register('POST', '/admin/workflows/:id/delete', async (req, res, params, ctx) => {
    const { id } = params;
    try {
      let configMgr;
      try { configMgr = ctx.services.get('configManagement'); } catch (e) {}

      if (configMgr && configMgr.get && configMgr.set) {
        const workflows = (configMgr.get('workflows') || []).filter(w => w.id !== id);
        await configMgr.set('workflows', workflows);
      }

      redirect(res, '/admin/workflows?success=' + encodeURIComponent('Workflow deleted'));
    } catch (error) {
      console.error('[admin] Delete workflow error:', error.message);
      redirect(res, '/admin/workflows?error=' + encodeURIComponent(error.message));
    }
  }, 'Delete workflow');

  /**
   * GET /admin/workflows/:id/diagram - Workflow diagram view
   */
  register('GET', '/admin/workflows/:id/diagram', async (req, res, params, ctx) => {
    const { id } = params;
    let configMgr;
    try { configMgr = ctx.services.get('configManagement'); } catch (e) {}
    const workflows = (configMgr && configMgr.get) ? (configMgr.get('workflows') || []) : [];
    const workflow = workflows.find(w => w.id === id);

    if (!workflow) {
      redirect(res, '/admin/workflows?error=' + encodeURIComponent('Workflow not found: ' + id));
      return;
    }

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('workflows-edit.html', {
      pageTitle: 'Workflow Diagram: ' + (workflow.label || id),
      isDiagram: true,
      workflow,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Workflow diagram');

  // ==========================================
  // Aliases CRUD (B1)
  // ==========================================

  /**
   * GET /admin/aliases/new - Create alias form
   */
  register('GET', '/admin/aliases/new', async (req, res, params, ctx) => {
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('aliases-edit.html', {
      pageTitle: 'Create Path Alias',
      isNew: true,
      alias: {},
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Create alias form');

  /**
   * POST /admin/aliases - Create alias
   */
  register('POST', '/admin/aliases', async (req, res, params, ctx) => {
    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      let aliasService;
      try { aliasService = ctx.services.get('pathAliases'); } catch (e) {}

      if (aliasService && aliasService.createAlias) {
        await aliasService.createAlias({
          source: formData.source,
          alias: formData.alias,
          language: formData.language || 'en',
        });
      }

      redirect(res, '/admin/aliases?success=' + encodeURIComponent('Alias created'));
    } catch (error) {
      console.error('[admin] Create alias error:', error.message);
      redirect(res, '/admin/aliases/new?error=' + encodeURIComponent(error.message));
    }
  }, 'Create alias');

  /**
   * GET /admin/aliases/:id/edit - Edit alias form
   */
  register('GET', '/admin/aliases/:id/edit', async (req, res, params, ctx) => {
    const { id } = params;
    let aliasService;
    try { aliasService = ctx.services.get('pathAliases'); } catch (e) {}

    const alias = aliasService && aliasService.getAlias ? aliasService.getAlias(id) : null;
    if (!alias) {
      redirect(res, '/admin/aliases?error=' + encodeURIComponent('Alias not found'));
      return;
    }

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('aliases-edit.html', {
      pageTitle: 'Edit Path Alias',
      isNew: false,
      alias,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Edit alias form');

  /**
   * POST /admin/aliases/:id - Update alias
   */
  register('POST', '/admin/aliases/:id', async (req, res, params, ctx) => {
    const { id } = params;
    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      let aliasService;
      try { aliasService = ctx.services.get('pathAliases'); } catch (e) {}

      if (aliasService && aliasService.updateAlias) {
        await aliasService.updateAlias(id, {
          source: formData.source,
          alias: formData.alias,
          language: formData.language || 'en',
        });
      }

      redirect(res, '/admin/aliases?success=' + encodeURIComponent('Alias updated'));
    } catch (error) {
      console.error('[admin] Update alias error:', error.message);
      redirect(res, '/admin/aliases/' + id + '/edit?error=' + encodeURIComponent(error.message));
    }
  }, 'Update alias');

  /**
   * POST /admin/aliases/:id/delete - Delete alias
   */
  register('POST', '/admin/aliases/:id/delete', async (req, res, params, ctx) => {
    const { id } = params;
    try {
      let aliasService;
      try { aliasService = ctx.services.get('pathAliases'); } catch (e) {}

      if (aliasService && aliasService.deleteAlias) {
        await aliasService.deleteAlias(id);
      }

      redirect(res, '/admin/aliases?success=' + encodeURIComponent('Alias deleted'));
    } catch (error) {
      console.error('[admin] Delete alias error:', error.message);
      redirect(res, '/admin/aliases?error=' + encodeURIComponent(error.message));
    }
  }, 'Delete alias');

  /**
   * GET /admin/aliases/bulk-generate - Bulk generate aliases form
   */
  register('GET', '/admin/aliases/bulk-generate', async (req, res, params, ctx) => {
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('aliases-list.html', {
      pageTitle: 'Bulk Generate Aliases',
      isBulkGenerate: true,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Bulk generate aliases form');

  /**
   * POST /admin/aliases/bulk - Bulk alias action
   */
  register('POST', '/admin/aliases/bulk', async (req, res, params, ctx) => {
    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      let aliasService;
      try { aliasService = ctx.services.get('pathAliases'); } catch (e) {}

      if (aliasService && aliasService.bulkGenerate) {
        const result = await aliasService.bulkGenerate(formData);
        redirect(res, '/admin/aliases?success=' + encodeURIComponent('Bulk operation complete: ' + (result?.count || 0) + ' aliases processed'));
      } else {
        redirect(res, '/admin/aliases?success=' + encodeURIComponent('Bulk operation complete'));
      }
    } catch (error) {
      console.error('[admin] Bulk alias error:', error.message);
      redirect(res, '/admin/aliases?error=' + encodeURIComponent(error.message));
    }
  }, 'Bulk alias action');

  /**
   * GET /admin/aliases/patterns - Alias patterns page
   */
  register('GET', '/admin/aliases/patterns', async (req, res, params, ctx) => {
    let aliasService;
    try { aliasService = ctx.services.get('pathAliases'); } catch (e) {}
    const patterns = (aliasService && aliasService.listPatterns) ? aliasService.listPatterns() : [];
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('aliases-patterns.html', {
      pageTitle: 'URL Alias Patterns',
      patterns,
      hasPatterns: Array.isArray(patterns) && patterns.length > 0,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Alias patterns');

  /**
   * POST /admin/aliases/patterns/:type - Save alias pattern
   */
  register('POST', '/admin/aliases/patterns/:type', async (req, res, params, ctx) => {
    const { type } = params;
    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      let aliasService;
      try { aliasService = ctx.services.get('pathAliases'); } catch (e) {}

      if (aliasService && aliasService.savePattern) {
        await aliasService.savePattern(type, formData);
      }

      redirect(res, '/admin/aliases/patterns?success=' + encodeURIComponent('Pattern saved for ' + type));
    } catch (error) {
      console.error('[admin] Save alias pattern error:', error.message);
      redirect(res, '/admin/aliases/patterns?error=' + encodeURIComponent(error.message));
    }
  }, 'Save alias pattern');

  /**
   * POST /admin/aliases/patterns/:type/test - Test alias pattern
   */
  register('POST', '/admin/aliases/patterns/:type/test', async (req, res, params, ctx) => {
    const { type } = params;
    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      let aliasService;
      try { aliasService = ctx.services.get('pathAliases'); } catch (e) {}

      let result = { sample: '/content/' + type + '/example-title' };
      if (aliasService && aliasService.testPattern) {
        result = await aliasService.testPattern(type, formData.pattern || '');
      }

      server.json(res, result);
    } catch (error) {
      server.json(res, { error: error.message }, 400);
    }
  }, 'Test alias pattern');

  /**
   * POST /admin/aliases/patterns/:type/regenerate - Regenerate aliases for type
   */
  register('POST', '/admin/aliases/patterns/:type/regenerate', async (req, res, params, ctx) => {
    const { type } = params;
    try {
      let aliasService;
      try { aliasService = ctx.services.get('pathAliases'); } catch (e) {}

      let count = 0;
      if (aliasService && aliasService.regenerateAliases) {
        count = await aliasService.regenerateAliases(type);
      }

      redirect(res, '/admin/aliases/patterns?success=' + encodeURIComponent('Regenerated ' + count + ' aliases for ' + type));
    } catch (error) {
      console.error('[admin] Regenerate aliases error:', error.message);
      redirect(res, '/admin/aliases/patterns?error=' + encodeURIComponent(error.message));
    }
  }, 'Regenerate aliases');

  /**
   * GET /admin/aliases/redirects - List redirects
   */
  register('GET', '/admin/aliases/redirects', async (req, res, params, ctx) => {
    let aliasService;
    try { aliasService = ctx.services.get('pathAliases'); } catch (e) {}
    const redirectsList = (aliasService && aliasService.listRedirects) ? aliasService.listRedirects() : [];
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('aliases-redirects.html', {
      pageTitle: 'URL Redirects',
      redirects: redirectsList,
      hasRedirects: Array.isArray(redirectsList) && redirectsList.length > 0,
      redirectCount: Array.isArray(redirectsList) ? redirectsList.length : 0,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Redirects list');

  /**
   * GET /admin/aliases/redirects/new - Create redirect form
   */
  register('GET', '/admin/aliases/redirects/new', async (req, res, params, ctx) => {
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('aliases-redirects.html', {
      pageTitle: 'Create Redirect',
      isNew: true,
      redirectItem: {},
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Create redirect form');

  /**
   * POST /admin/aliases/redirects - Create redirect
   */
  register('POST', '/admin/aliases/redirects', async (req, res, params, ctx) => {
    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      let aliasService;
      try { aliasService = ctx.services.get('pathAliases'); } catch (e) {}

      if (aliasService && aliasService.createRedirect) {
        await aliasService.createRedirect({
          source: formData.source,
          destination: formData.destination,
          statusCode: parseInt(formData.statusCode) || 301,
        });
      }

      redirect(res, '/admin/aliases/redirects?success=' + encodeURIComponent('Redirect created'));
    } catch (error) {
      console.error('[admin] Create redirect error:', error.message);
      redirect(res, '/admin/aliases/redirects/new?error=' + encodeURIComponent(error.message));
    }
  }, 'Create redirect');

  /**
   * GET /admin/aliases/redirects/:id/edit - Edit redirect form
   */
  register('GET', '/admin/aliases/redirects/:id/edit', async (req, res, params, ctx) => {
    const { id } = params;
    let aliasService;
    try { aliasService = ctx.services.get('pathAliases'); } catch (e) {}

    const redirectItem = aliasService && aliasService.getRedirect ? aliasService.getRedirect(id) : null;
    if (!redirectItem) {
      redirect(res, '/admin/aliases/redirects?error=' + encodeURIComponent('Redirect not found'));
      return;
    }

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('aliases-redirects.html', {
      pageTitle: 'Edit Redirect',
      isNew: false,
      redirectItem,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Edit redirect form');

  /**
   * POST /admin/aliases/redirects/:id - Update redirect
   */
  register('POST', '/admin/aliases/redirects/:id', async (req, res, params, ctx) => {
    const { id } = params;
    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      let aliasService;
      try { aliasService = ctx.services.get('pathAliases'); } catch (e) {}

      if (aliasService && aliasService.updateRedirect) {
        await aliasService.updateRedirect(id, {
          source: formData.source,
          destination: formData.destination,
          statusCode: parseInt(formData.statusCode) || 301,
        });
      }

      redirect(res, '/admin/aliases/redirects?success=' + encodeURIComponent('Redirect updated'));
    } catch (error) {
      console.error('[admin] Update redirect error:', error.message);
      redirect(res, '/admin/aliases/redirects/' + id + '/edit?error=' + encodeURIComponent(error.message));
    }
  }, 'Update redirect');

  /**
   * POST /admin/aliases/redirects/:id/delete - Delete redirect
   */
  register('POST', '/admin/aliases/redirects/:id/delete', async (req, res, params, ctx) => {
    const { id } = params;
    try {
      let aliasService;
      try { aliasService = ctx.services.get('pathAliases'); } catch (e) {}

      if (aliasService && aliasService.deleteRedirect) {
        await aliasService.deleteRedirect(id);
      }

      redirect(res, '/admin/aliases/redirects?success=' + encodeURIComponent('Redirect deleted'));
    } catch (error) {
      console.error('[admin] Delete redirect error:', error.message);
      redirect(res, '/admin/aliases/redirects?error=' + encodeURIComponent(error.message));
    }
  }, 'Delete redirect');

  /**
   * POST /admin/aliases/redirects/bulk - Bulk redirect action
   */
  register('POST', '/admin/aliases/redirects/bulk', async (req, res, params, ctx) => {
    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      let aliasService;
      try { aliasService = ctx.services.get('pathAliases'); } catch (e) {}

      if (aliasService && aliasService.bulkRedirectAction) {
        await aliasService.bulkRedirectAction(formData);
      }

      redirect(res, '/admin/aliases/redirects?success=' + encodeURIComponent('Bulk action complete'));
    } catch (error) {
      console.error('[admin] Bulk redirect error:', error.message);
      redirect(res, '/admin/aliases/redirects?error=' + encodeURIComponent(error.message));
    }
  }, 'Bulk redirect action');

  // ==========================================
  // Cookie Consent Config Route
  // ==========================================

  /**
   * GET /admin/config/cookie-consent - Cookie consent settings
   */
  register('GET', '/admin/config/cookie-consent', async (req, res, params, ctx) => {
    const flash = getFlashMessage(req.url);

    // Read cookie consent module config
    let consentConfig = {};
    try {
      const configMgr = ctx.services.get('configManagement');
      if (configMgr && configMgr.get) consentConfig = configMgr.get('cookie-consent') || {};
    } catch (e) {}

    // Use config-list template with a single config item for editing
    const html = renderAdmin('config-list.html', {
      pageTitle: 'Cookie Consent',
      configs: [{ name: 'cookie-consent', data: consentConfig }],
      hasConfigs: true,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Cookie consent settings');

  // ========================================
  // CALENDAR VIEW
  // ========================================

  /**
   * GET /admin/calendar - Content calendar view
   * Shows content items organized by creation/publish date on a monthly calendar.
   * Query params: ?year=2026&month=2&type=article
   */
  register('GET', '/admin/calendar', async (req, res, params, ctx) => {
    const url = new URL(req.url, 'http://localhost');
    const now = new Date();
    const year = parseInt(url.searchParams.get('year')) || now.getFullYear();
    const month = parseInt(url.searchParams.get('month')) || (now.getMonth() + 1);
    const typeFilter = url.searchParams.get('type') || '';

    // Get all content types
    const types = content.listTypes().map(t => t.type);

    // Gather content items for this month
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0); // Last day of month
    const daysInMonth = endDate.getDate();
    const startDay = startDate.getDay(); // 0=Sun

    // Build calendar grid: array of days, each with items
    const days = [];
    const typesToQuery = typeFilter ? [typeFilter] : types;

    // Collect all items for the month
    const itemsByDay = {};
    for (let d = 1; d <= daysInMonth; d++) itemsByDay[d] = [];

    for (const type of typesToQuery) {
      try {
        const result = content.list(type);
        const items = result.items || [];
        for (const item of items) {
          const created = new Date(item.created || item.timestamp || item.date);
          if (isNaN(created.getTime())) continue;
          if (created.getFullYear() === year && created.getMonth() === month - 1) {
            const day = created.getDate();
            if (itemsByDay[day]) {
              itemsByDay[day].push({
                id: item.id,
                title: item.title || item.name || item.id,
                type,
                status: item.status || 'draft',
                time: created.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
              });
            }
          }
        }
      } catch {
        // Skip types that fail
      }
    }

    // Build calendar weeks
    const weeks = [];
    let currentWeek = new Array(startDay).fill(null);
    for (let d = 1; d <= daysInMonth; d++) {
      currentWeek.push({ day: d, items: itemsByDay[d], isToday: d === now.getDate() && month === now.getMonth() + 1 && year === now.getFullYear() });
      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
    }
    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) currentWeek.push(null);
      weeks.push(currentWeek);
    }

    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;

    // Render inline (no separate template needed)
    let calendarHtml = `
      <div class="gin-page-header"><h1>Content Calendar</h1></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--gin-space-4)">
        <a href="/admin/calendar?year=${prevYear}&month=${prevMonth}${typeFilter ? '&type=' + typeFilter : ''}" class="btn btn-secondary">&larr; Previous</a>
        <h2 style="margin:0">${monthNames[month - 1]} ${year}</h2>
        <a href="/admin/calendar?year=${nextYear}&month=${nextMonth}${typeFilter ? '&type=' + typeFilter : ''}" class="btn btn-secondary">Next &rarr;</a>
      </div>
      <div style="margin-bottom:var(--gin-space-4)">
        <label style="font-weight:600;margin-right:8px">Filter by type:</label>
        <select onchange="location.href='/admin/calendar?year=${year}&month=${month}&type='+this.value" style="padding:4px 8px;border:1px solid var(--gin-border);border-radius:var(--gin-radius-sm)">
          <option value="">All types</option>
          ${types.map(t => `<option value="${t}"${t === typeFilter ? ' selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      <table style="width:100%;border-collapse:collapse;background:var(--gin-surface);border-radius:var(--gin-radius);overflow:hidden;box-shadow:var(--gin-shadow-xs)">
        <thead>
          <tr>${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => `<th style="padding:8px;border:1px solid var(--gin-border-light);background:var(--gin-surface-alt);font-size:var(--gin-font-size-sm);font-weight:600">${d}</th>`).join('')}</tr>
        </thead>
        <tbody>`;

    for (const week of weeks) {
      calendarHtml += '<tr>';
      for (const cell of week) {
        if (!cell) {
          calendarHtml += '<td style="padding:4px;border:1px solid var(--gin-border-light);background:var(--gin-surface-alt);min-height:80px;vertical-align:top"></td>';
        } else {
          const todayStyle = cell.isToday ? 'background:var(--gin-primary-light);' : '';
          calendarHtml += `<td style="padding:4px;border:1px solid var(--gin-border-light);vertical-align:top;min-width:120px;height:90px;${todayStyle}">`;
          calendarHtml += `<div style="font-weight:600;font-size:var(--gin-font-size-sm);margin-bottom:2px;${cell.isToday ? 'color:var(--gin-primary)' : ''}">${cell.day}</div>`;
          for (const item of cell.items.slice(0, 3)) {
            const statusColor = item.status === 'published' ? 'var(--gin-success)' : 'var(--gin-warning)';
            calendarHtml += `<a href="/admin/content/${item.type}/${item.id}/edit" style="display:block;font-size:11px;padding:1px 4px;margin-bottom:1px;border-radius:3px;background:${statusColor}20;color:${statusColor};text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${item.title}">${item.title}</a>`;
          }
          if (cell.items.length > 3) {
            calendarHtml += `<div style="font-size:10px;color:var(--gin-text-muted)">+${cell.items.length - 3} more</div>`;
          }
          calendarHtml += '</td>';
        }
      }
      calendarHtml += '</tr>';
    }

    calendarHtml += '</tbody></table>';

    // Render calendar inside admin layout using renderAdmin pattern
    // Pass raw HTML as the "template content" by using renderString directly
    const path = req?.url?.split('?')[0] || '/admin';
    const username = ctx.session?.user?.username || 'admin';
    const usernameInitial = username.charAt(0).toUpperCase();

    const finalHtml = template.renderWithLayout('admin-layout.html', calendarHtml, {
      title: 'Content Calendar',
      siteName: ctx.config.site.name,
      version: ctx.config.site.version,
      username,
      usernameInitial,
      navContent: true,
    });

    server.html(res, finalHtml);
  }, 'Content calendar view');

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
