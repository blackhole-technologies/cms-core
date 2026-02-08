/**
 * TEMPLATE: Content Field Extension
 * 
 * How to add new fields/metadata to existing content types.
 * Used by: Scheduler (scheduledPublish), Trash (deleted), Metatag (meta), Pathauto (alias)
 */

// Pattern 1: Add metadata fields to content on save
export function hook_ready(ctx) {
  const content = ctx.services.get('content');

  // Hook into content lifecycle
  content.on('beforeCreate', (type, data) => {
    // Add default field values
    data.scheduledPublish = data.scheduledPublish || null;
    data.scheduledUnpublish = data.scheduledUnpublish || null;
    return data;
  });

  content.on('beforeSave', (type, data) => {
    // Compute derived fields
    if (data.title && !data.alias) {
      data.alias = slugify(data.title);
    }
    return data;
  });

  content.on('afterDelete', (type, id, data) => {
    // Cleanup: remove related data
    // e.g., remove redirects pointing to this content
  });
}

// Pattern 2: Modify content queries
export function hook_boot(ctx) {
  const content = ctx.services.get('content');

  // Add query scope — trash module uses this
  content.addScope('withDeleted', (query) => {
    // Don't filter out deleted items
    query.includeDeleted = true;
    return query;
  });

  content.addScope('onlyDeleted', (query) => {
    // Only return deleted items
    query.filter = (item) => !!item.deleted;
    return query;
  });
}

// Pattern 3: Cron job for scheduled operations
export function hook_ready(ctx) {
  const cron = ctx.services.get('cron');
  const content = ctx.services.get('content');

  // Run every minute
  cron.register('scheduler:process', '* * * * *', async () => {
    const now = new Date().toISOString();

    // Find content scheduled to publish
    const toPublish = content.list('*', {
      filter: item => item.scheduledPublish && item.scheduledPublish <= now && !item.status
    });

    for (const item of toPublish) {
      content.update(item._type, item.id, {
        status: true,
        scheduledPublish: null
      });
      ctx.services.get('logger').info(`Published scheduled content: ${item.title}`);
    }
  });
}

// Helper: slugify (no npm deps)
function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // remove diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Storage: Fields are stored IN the content JSON files.
 * No separate field tables — flat-file JSON means fields are just properties.
 * 
 * content/article/abc123.json:
 * {
 *   "id": "abc123",
 *   "title": "My Article",
 *   "body": "...",
 *   "alias": "/my-article",              ← Pathauto
 *   "scheduledPublish": "2026-03-01",    ← Scheduler
 *   "deleted": null,                      ← Trash (null = not deleted, ISO date = deleted at)
 *   "meta": { "title": "...", "og:image": "..." }  ← Metatag
 * }
 */
