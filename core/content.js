/**
 * content.js - Flat-File Content Storage System
 *
 * WHY FLAT-FILE STORAGE:
 * =====================
 * This CMS uses JSON files instead of a database for content storage.
 * The approach is inspired by static site generators and simple CMS systems.
 *
 * ADVANTAGES:
 * - Zero database dependencies (no MySQL, Postgres, MongoDB)
 * - Human-readable storage (can edit JSON files directly)
 * - Version controllable (content lives in git)
 * - Portable (copy folder = backup/deploy)
 * - Simple debugging (just read the file)
 *
 * TRADE-OFFS:
 * - Not suitable for high-traffic sites (file I/O is slower than DB)
 * - No complex queries (no JOIN, no full-text search without loading all)
 * - Concurrent writes need careful handling (we use atomic writes)
 * - Scales poorly beyond thousands of items per type
 *
 * WHEN TO USE FLAT-FILE:
 * - Blogs with < 1000 posts
 * - Configuration-heavy sites
 * - Developer documentation
 * - Prototypes and small projects
 * - Sites where content changes infrequently
 *
 * WHEN TO USE A DATABASE:
 * - User-generated content at scale
 * - Complex relationships between content
 * - Need for full-text search
 * - High concurrent write loads
 *
 * DIRECTORY STRUCTURE:
 * ===================
 * /content
 *   /<type>/           # Each content type is a directory
 *     <id>.json        # Each content item is a JSON file
 *
 * Example:
 * /content
 *   /page/
 *     about.json
 *     contact.json
 *   /post/
 *     2024-01-15-hello-world.json
 *     2024-01-20-second-post.json
 *   /greeting/
 *     abc123.json
 *
 * CONTENT OBJECT FORMAT:
 * =====================
 * Every content item has these system fields:
 * {
 *   "id": "abc123",           // Unique identifier (auto-generated)
 *   "type": "greeting",       // Content type name
 *   "created": "2024-01...",  // ISO timestamp when created
 *   "updated": "2024-01...",  // ISO timestamp when last modified
 *   ...userFields             // Fields defined in schema
 * }
 *
 * ID GENERATION:
 * =============
 * IDs are timestamp-based with random suffix for uniqueness:
 * Format: <timestamp>-<random>
 * Example: "1705123456789-x7k9m"
 *
 * Why timestamp-first:
 * - IDs sort chronologically by default
 * - Easy to see when content was created
 * - Filesystem-friendly (no special chars)
 *
 * SCHEMA VALIDATION:
 * =================
 * Content types define schemas with field definitions:
 * {
 *   fieldName: {
 *     type: 'string' | 'number' | 'boolean' | 'array' | 'object',
 *     required: true | false
 *   }
 * }
 *
 * Validation happens on create() and update().
 * Missing required fields throw errors.
 * Unknown fields are preserved (schema is not restrictive).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as hooks from './hooks.js';
import * as cache from './cache.js';
import * as locks from './locks.js';
import { slugify, generateUniqueSlug, validateSlug, looksLikeId } from './slugify.js';

/**
 * Constraint service reference (injected after boot)
 *
 * WHY LATE-BINDING:
 * Content.js is initialized before constraints.js in the boot sequence.
 * The constraints service is injected via setConstraints() after both are initialized.
 * This avoids circular dependency issues while enabling constraint-based validation
 * on content create/update.
 */
let constraintService = null;

/**
 * Set the constraint service for content validation
 *
 * Called from boot.js after both content and constraints are initialized.
 * Enables the Drupal-inspired constraint plugin validation on save.
 *
 * @param {Object} svc - The constraints service module
 */
export function setConstraints(svc) {
  constraintService = svc;
}

/**
 * Content type registry
 * Structure: { typeName: { schema, source } }
 *
 * WHY TRACK SOURCE:
 * - Know which module registered which content type
 * - Useful for debugging and documentation
 * - Enables per-module content type management
 */
const contentTypes = {};

/**
 * Base directory for content storage
 * Set during init()
 */
let contentDir = null;

/**
 * Cache configuration
 * Set during init()
 */
let cacheEnabled = false;
let cacheTTL = 300;

/**
 * REVISION SYSTEM:
 * ================
 * The revision system provides version history for content items.
 * Every time content is updated, the previous version is saved as a revision.
 *
 * WHY REVISIONS:
 * - Accidental edits can be undone
 * - See who changed what and when
 * - Audit trail for compliance
 * - Compare versions to understand changes
 *
 * STORAGE STRATEGY:
 * Revisions are stored in a hidden directory within each content type:
 *
 * /content
 *   /greeting/
 *     abc123.json           <- Current version
 *     .revisions/           <- Hidden revisions directory
 *       abc123/             <- Revisions for this item
 *         2024-01-15T12:00:00.000Z.json  <- Previous version
 *         2024-01-15T11:00:00.000Z.json  <- Older version
 *
 * WHY .revisions/ HIDDEN DIRECTORY:
 * - Won't appear in normal content listings
 * - Clear separation between current and historical data
 * - Easy to exclude from backups if desired
 * - Follows Unix convention for hidden/system files
 *
 * WHY TIMESTAMP-BASED FILENAMES:
 * - Revisions naturally sort chronologically
 * - No collision with multiple edits (ISO timestamps are unique to ms)
 * - Human-readable when inspecting filesystem
 * - Easy to implement "keep last N revisions" pruning
 *
 * REVISION LIFECYCLE:
 * 1. User calls update(type, id, data)
 * 2. Before overwriting, current version is copied to .revisions/<id>/<timestamp>.json
 * 3. New version is written to <id>.json
 * 4. Revision count is checked; old revisions pruned if exceeding maxPerItem
 *
 * REVERT BEHAVIOR:
 * When reverting to a revision:
 * 1. Current version becomes a new revision (so you can undo the revert)
 * 2. Selected revision content replaces current
 * 3. 'updated' timestamp is set to now (not the revision's timestamp)
 * 4. 'created' timestamp is preserved from original
 */

/**
 * Revision configuration
 * Set during init()
 */
let revisionsEnabled = false;
let maxRevisionsPerItem = 10;

/**
 * WORKFLOW SYSTEM:
 * ================
 * Content workflow provides publishing states for content items.
 *
 * STATUSES:
 * - draft: Work in progress, not visible to public
 * - pending: Awaiting review or scheduled for publishing
 * - published: Live and visible to public
 * - archived: No longer active, hidden from public
 *
 * WHY WORKFLOW:
 * - Editorial review before publishing
 * - Scheduled publishing for time-sensitive content
 * - Archival for outdated but preserved content
 * - Clear separation between draft and live content
 *
 * TIMESTAMPS:
 * - publishedAt: When content was first published
 * - scheduledAt: When pending content should auto-publish
 */

/**
 * Valid workflow statuses
 */
export const WORKFLOW_STATUSES = ['draft', 'pending', 'published', 'archived'];

/**
 * Workflow configuration
 * Set during init()
 */
let workflowEnabled = false;
let defaultStatus = 'draft';
let scheduleCheckInterval = 60;

/**
 * COMPUTED FIELDS:
 * ================
 * Computed fields are virtual properties calculated on read, not stored.
 * They derive values from other fields in the content item.
 *
 * USE CASES:
 * - Word count from body text
 * - Read time estimate
 * - Full name from first + last name
 * - URL slug generation
 * - Age from birthdate
 * - Status flags (isNew, isExpired)
 *
 * WHY COMPUTED FIELDS:
 * - Avoid data duplication (calculated values don't need storage)
 * - Always up-to-date (calculated on read, not stale)
 * - Reduce write complexity (no need to update derived fields)
 * - Clean separation of source data and derived values
 *
 * REGISTRATION:
 * Computed fields can be registered in two ways:
 *
 * 1. In schema definition:
 *    register('article', {
 *      body: { type: 'string' },
 *      wordCount: { type: 'computed', compute: (item) => item.body?.split(/\s+/).length || 0 }
 *    });
 *
 * 2. Via hook_computed hook:
 *    export function hook_computed(register, context) {
 *      register('article', 'readTime', (item) => Math.ceil(item.body?.split(/\s+/).length / 200) + ' min');
 *    }
 *
 * ASYNC SUPPORT:
 * Compute functions can be async for complex lookups:
 *    register('post', 'commentCount', async (item, ctx) => {
 *      return ctx.services.get('content').list('comment', { filters: { postId: item.id } }).total;
 *    });
 */

/**
 * Computed fields registry
 * Structure: { type: { fieldName: { compute, async } } }
 */
const computedFields = {};

/**
 * Computed fields configuration
 */
let computedEnabled = true;
let cacheComputed = false;

/**
 * SLUG SYSTEM:
 * ============
 * URL-friendly identifiers for content items.
 *
 * WHY SLUGS:
 * - SEO-friendly URLs (/article/hello-world vs /article/1705123456789-x7k9m)
 * - Human-readable and memorable
 * - Shareable and professional-looking
 *
 * FEATURES:
 * - Auto-generation from title or other fields
 * - Uniqueness enforcement within content type
 * - History tracking for old slugs (enables redirects)
 * - Manual override capability
 */

/**
 * Slug configuration
 * Set during initSlugs()
 */
let slugsEnabled = true;
let slugSeparator = '-';
let slugMaxLength = 100;
let slugRedirectOld = true;
let slugHistoryLimit = 10;

/**
 * Slug index for fast lookups
 * Structure: { type: { slug: id, ... } }
 *
 * WHY INDEX:
 * - getBySlug() needs to be fast
 * - Scanning all files for each lookup is expensive
 * - Index is rebuilt on startup and updated on write
 */
const slugIndex = {};

/**
 * Slug history index for redirects
 * Structure: { type: { oldSlug: currentSlug, ... } }
 */
const slugHistoryIndex = {};

/**
 * TRASH SYSTEM:
 * =============
 * Soft delete with recovery capability.
 *
 * WHY TRASH:
 * - Accidental deletions can be recovered
 * - Grace period before permanent deletion
 * - Audit trail for deleted content
 * - User-friendly "undo" capability
 *
 * STORAGE:
 * /content/.trash/<type>/<id>.json
 * - Hidden directory (starts with .)
 * - Maintains type separation
 * - Original item plus metadata
 */

/**
 * Trash configuration
 * Set during initTrash()
 */
let trashEnabled = true;
let trashRetentionDays = 30;
let trashAutoPurge = true;

/**
 * Initialize content system with base directory
 *
 * @param {string} baseDir - Project root directory
 * @param {Object} cacheConfig - Cache configuration (optional)
 * @param {boolean} cacheConfig.enabled - Whether caching is enabled
 * @param {number} cacheConfig.ttl - Default TTL in seconds
 * @param {Object} revisionsConfig - Revisions configuration (optional)
 * @param {boolean} revisionsConfig.enabled - Whether revisions are enabled
 * @param {number} revisionsConfig.maxPerItem - Max revisions per item (default: 10)
 * @param {Object} workflowConfig - Workflow configuration (optional)
 * @param {boolean} workflowConfig.enabled - Whether workflow is enabled
 * @param {string} workflowConfig.defaultStatus - Default status for new content (default: 'draft')
 * @param {number} workflowConfig.scheduleCheckInterval - Interval to check scheduled content in seconds
 *
 * WHY SEPARATE INIT:
 * - Decouples from boot sequence
 * - Makes testing easier (point to test fixtures)
 * - Explicit is better than implicit
 */
export function init(baseDir, cacheConfig = {}, revisionsConfig = {}, workflowConfig = {}) {
  contentDir = join(baseDir, 'content');

  // Configure caching
  cacheEnabled = cacheConfig.enabled || false;
  cacheTTL = cacheConfig.ttl || 300;

  // Configure revisions
  // WHY DEFAULT TO ENABLED:
  // - Revisions are non-destructive and useful for most sites
  // - Can be disabled for high-volume/ephemeral content
  revisionsEnabled = revisionsConfig.enabled !== false; // Default true
  maxRevisionsPerItem = revisionsConfig.maxPerItem || 10;

  // Configure workflow
  // WHY DEFAULT TO DISABLED:
  // - Not all sites need publishing workflow
  // - Simpler default behavior for basic sites
  workflowEnabled = workflowConfig.enabled === true;
  defaultStatus = workflowConfig.defaultStatus || 'draft';
  scheduleCheckInterval = workflowConfig.scheduleCheckInterval || 60;

  // Configure computed fields from content config (passed via contentConfig)
  // Note: computed config is passed through revisionsConfig for now
  // This will be refactored in a future version

  // Ensure content directory exists
  // WHY CREATE AUTOMATICALLY:
  // - Fresh installs shouldn't fail
  // - Git might not track empty directories
  if (!existsSync(contentDir)) {
    mkdirSync(contentDir, { recursive: true });
  }
}

/**
 * Generate a unique ID for content
 *
 * Format: <timestamp>-<random>
 *
 * WHY THIS FORMAT:
 * - Timestamp prefix = chronological sorting
 * - Random suffix = uniqueness even with same-millisecond creates
 * - Filesystem-safe characters only
 *
 * @returns {string} - Unique ID like "1705123456789-x7k9m"
 */
function generateId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 7);
  return `${timestamp}-${random}`;
}

/**
 * Ensure a content type directory exists
 *
 * @param {string} type - Content type name
 *
 * WHY CREATE ON DEMAND:
 * - Types can be registered but unused
 * - First content creation ensures directory exists
 */
function ensureTypeDir(type) {
  const typeDir = join(contentDir, type);
  if (!existsSync(typeDir)) {
    mkdirSync(typeDir, { recursive: true });
  }
  return typeDir;
}

/**
 * Get the file path for a content item
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @returns {string} - Full path to the JSON file
 */
function getContentPath(type, id) {
  return join(contentDir, type, `${id}.json`);
}

/**
 * Get the revisions directory for a content item
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @returns {string} - Full path to the revisions directory
 *
 * STRUCTURE:
 * /content/<type>/.revisions/<id>/
 *
 * WHY NESTED UNDER ITEM ID:
 * - All revisions for an item are grouped together
 * - Easy to delete all revisions when item is deleted
 * - Clear ownership of revision files
 */
function getRevisionsDir(type, id) {
  return join(contentDir, type, '.revisions', id);
}

/**
 * Get the file path for a specific revision
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {string} timestamp - ISO timestamp of the revision
 * @returns {string} - Full path to the revision JSON file
 */
function getRevisionPath(type, id, timestamp) {
  // Sanitize timestamp for filesystem (replace colons which aren't valid on Windows)
  const safeTimestamp = timestamp.replace(/:/g, '-');
  return join(getRevisionsDir(type, id), `${safeTimestamp}.json`);
}

/**
 * Ensure revisions directory exists for a content item
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @returns {string} - Path to the revisions directory
 */
function ensureRevisionsDir(type, id) {
  const revisionsDir = getRevisionsDir(type, id);
  if (!existsSync(revisionsDir)) {
    mkdirSync(revisionsDir, { recursive: true });
  }
  return revisionsDir;
}

/**
 * Save current content as a revision
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {Object} content - Content object to save as revision
 *
 * WHAT GETS SAVED:
 * - Complete content object as it exists at this moment
 * - Uses content's 'updated' timestamp as the revision identifier
 *
 * WHY SAVE COMPLETE OBJECT:
 * - Self-contained: revision can be viewed without current version
 * - Simple restoration: just copy revision over current
 * - No complex diff reconstruction needed
 *
 * @private
 */
function saveRevision(type, id, content) {
  if (!revisionsEnabled) return;

  ensureRevisionsDir(type, id);

  // Use the content's updated timestamp as revision identifier
  // This captures "when this version was created"
  const timestamp = content.updated;
  const revisionPath = getRevisionPath(type, id, timestamp);

  // Write revision file
  writeFileSync(revisionPath, JSON.stringify(content, null, 2) + '\n');

  // Prune old revisions if we exceed the limit
  // WHY PRUNE AUTOMATICALLY:
  // - Prevents unbounded disk growth
  // - Keeps revision list manageable
  // - Configurable via maxPerItem
  pruneRevisionsInternal(type, id, maxRevisionsPerItem);
}

/**
 * PENDING REVISIONS SYSTEM:
 * =========================
 * Implements Drupal's content_moderation pattern:
 * - Published content can have "pending" draft revisions
 * - The main content file is always the "default" (public-facing) version
 * - Drafts on published content are stored as non-default revisions
 * - Publishing a pending draft promotes it to the default
 *
 * KEY CONCEPT: isDefaultRevision flag
 * - true  = this version is the public-facing, canonical version
 * - false = this is a pending draft, not visible to the public
 *
 * The main content file (content/{type}/{id}.json) always holds the
 * default revision. Non-default drafts live in .revisions/.
 *
 * WHY THIS APPROACH:
 * - read() and list() automatically return the published version
 * - No changes needed to existing API consumers
 * - Drafts are accessible via getPendingRevisions() or includeAllRevisions
 * - Mirrors Drupal's separation of published + isDefaultRevision flags
 */

/**
 * Determine isDefaultRevision value based on workflow state
 *
 * WHY: In Drupal's content_moderation, the isDefaultRevision flag is
 * determined by the workflow state, not set manually. Published content
 * is always the default. Drafts on published content are non-default.
 *
 * @param {string} targetStatus - The workflow status being set
 * @param {Object} existing - The existing content item (null for new content)
 * @returns {boolean} - Whether the revision should be the default
 */
function shouldBeDefaultRevision(targetStatus, existing = null) {
  // Published content is always the default revision
  if (targetStatus === 'published') {
    return true;
  }

  // If creating new content (no existing), it's always the default
  if (!existing) {
    return true;
  }

  // If existing content is published and we're creating a draft,
  // the draft should NOT be the default (pending revision pattern)
  if (existing.status === 'published' && targetStatus === 'draft') {
    return false;
  }

  // For non-published existing content changing to draft,
  // keep it as default (normal draft editing)
  return true;
}

/**
 * Create a draft revision on published content (pending revision)
 *
 * WHY: When published content is edited as a draft, the edit should
 * NOT overwrite the live version. Instead, it's stored as a
 * non-default revision in .revisions/ directory.
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {Object} data - New field data for the draft
 * @param {Object} options - Options (userId, etc.)
 * @returns {Promise<Object>} - The pending draft revision
 */
export async function createDraft(type, id, data, options = {}) {
  const existing = read(type, id);
  if (!existing) {
    throw new Error(`Content not found: ${type}/${id}`);
  }

  // Only create pending revisions on published content
  // For non-published content, use normal update()
  if (existing.status !== 'published') {
    return update(type, id, { ...data, status: 'draft' }, options);
  }

  const { schema } = contentTypes[type];
  const now = new Date().toISOString();

  // Merge existing with draft data
  const draft = {
    ...existing,
    ...data,
    // Preserve system fields
    id: existing.id,
    type: existing.type,
    created: existing.created,
    updated: now,
    // Mark as draft, non-default revision
    status: 'draft',
    isDefaultRevision: false,
  };

  // Save draft as a revision (non-default)
  if (revisionsEnabled) {
    ensureRevisionsDir(type, id);
    const revisionPath = getRevisionPath(type, id, now);
    writeFileSync(revisionPath, JSON.stringify(draft, null, 2) + '\n');
  }

  // Fire hook so other modules know a pending draft was created
  await hooks.trigger('content:pendingDraftCreated', {
    type,
    id,
    draft,
    published: existing,
  });

  return draft;
}

/**
 * Get pending (non-default) revisions for a content item
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @returns {Array<Object>} - List of pending revision objects with full content
 */
export function getPendingRevisions(type, id) {
  const revisionsDir = getRevisionsDir(type, id);

  if (!existsSync(revisionsDir)) {
    return [];
  }

  const files = readdirSync(revisionsDir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse();

  const pending = [];

  for (const file of files) {
    try {
      const filePath = join(revisionsDir, file);
      const raw = readFileSync(filePath, 'utf-8');
      const revision = JSON.parse(raw);

      // Only include non-default revisions (pending drafts)
      if (revision.isDefaultRevision === false) {
        pending.push(revision);
      }
    } catch (e) {
      // Skip unreadable revisions
    }
  }

  return pending;
}

/**
 * Check if a content item has pending (non-default) revisions
 *
 * WHY: Fast check without loading all revision data. Used by content
 * listings to show a "pending revision" indicator badge.
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @returns {boolean} - True if pending revisions exist
 */
export function hasPendingRevisions(type, id) {
  const revisionsDir = getRevisionsDir(type, id);

  if (!existsSync(revisionsDir)) {
    return false;
  }

  const files = readdirSync(revisionsDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    try {
      const filePath = join(revisionsDir, file);
      const raw = readFileSync(filePath, 'utf-8');
      const revision = JSON.parse(raw);

      if (revision.isDefaultRevision === false) {
        return true;
      }
    } catch (e) {
      // Skip unreadable revisions
    }
  }

  return false;
}

/**
 * Count pending (non-default) revisions for a content item
 *
 * WHY: Used by content listings to show exact count of pending drafts.
 * More informative than just hasPendingRevisions boolean.
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @returns {number} - Number of pending revisions
 */
export function countPendingRevisions(type, id) {
  return getPendingRevisions(type, id).length;
}

/**
 * Publish a pending revision, making it the new default
 *
 * WHY: When a pending draft is approved, it should replace the
 * current published version as the default revision.
 *
 * BEHAVIOR:
 * 1. Save current published version as a revision
 * 2. Replace main file with the pending draft (now published)
 * 3. Mark the new version as isDefaultRevision: true, status: published
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {string} revisionTimestamp - ISO timestamp of the pending revision to publish
 * @returns {Promise<Object>} - The newly published content
 */
export async function publishPendingRevision(type, id, revisionTimestamp = null) {
  const existing = read(type, id);
  if (!existing) {
    throw new Error(`Content not found: ${type}/${id}`);
  }

  // Find the pending revision to publish
  let pendingDraft;

  if (revisionTimestamp) {
    // Specific revision requested
    pendingDraft = getRevision(type, id, revisionTimestamp);
    if (!pendingDraft || pendingDraft.isDefaultRevision !== false) {
      throw new Error(`No pending revision found at timestamp: ${revisionTimestamp}`);
    }
  } else {
    // Get the most recent pending revision
    const pending = getPendingRevisions(type, id);
    if (pending.length === 0) {
      throw new Error(`No pending revisions found for ${type}/${id}`);
    }
    pendingDraft = pending[0]; // Most recent
  }

  const now = new Date().toISOString();

  // 1. Save current published version as a historical revision
  if (revisionsEnabled) {
    saveRevision(type, id, existing);
  }

  // 2. Build the new published version from the pending draft
  const newPublished = {
    ...pendingDraft,
    status: 'published',
    isDefaultRevision: true,
    updated: now,
    publishedAt: existing.publishedAt || now,
  };

  // 3. Write the new version as the main content file
  const filePath = getContentPath(type, id);
  writeFileSync(filePath, JSON.stringify(newPublished, null, 2) + '\n');

  // 4. Invalidate cache
  if (cacheEnabled) {
    cache.delete(cache.itemKey(type, id));
    cache.clear(`content:${type}:list:*`);
  }

  // 5. Fire hooks
  await hooks.trigger('content:afterStatusChange', {
    type,
    id,
    from: 'draft',
    to: 'published',
    item: newPublished,
  });
  await hooks.trigger('content:published', { type, item: newPublished });

  return newPublished;
}

/**
 * Internal prune function (doesn't check revisionsEnabled)
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {number} keep - Number of revisions to keep
 * @returns {number} - Number of revisions deleted
 * @private
 */
function pruneRevisionsInternal(type, id, keep) {
  const revisionsDir = getRevisionsDir(type, id);

  if (!existsSync(revisionsDir)) {
    return 0;
  }

  // Get all revision files sorted by timestamp (newest first)
  const files = readdirSync(revisionsDir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse();

  // Delete oldest revisions beyond the keep limit
  const toDelete = files.slice(keep);
  let deleted = 0;

  for (const file of toDelete) {
    try {
      unlinkSync(join(revisionsDir, file));
      deleted++;
    } catch (error) {
      console.error(`[content] Failed to delete revision ${file}: ${error.message}`);
    }
  }

  return deleted;
}

/**
 * RELATION TYPES:
 * ===============
 * Content can have relationships to other content types.
 *
 * RELATION TYPES:
 * - belongsTo: Single reference (stored as single ID string)
 *   Example: post.author → user
 *
 * - hasMany: Multiple references (stored as array of IDs)
 *   Example: user.posts → [post] (note: this is a virtual relation, stored on the "many" side)
 *
 * - belongsToMany: Many-to-many (stored as array of IDs on both sides)
 *   Example: post.tags ↔ tag.posts
 *
 * STORAGE FORMAT:
 * - belongsTo: "userId123" (string)
 * - hasMany: Computed from inverse belongsTo relations
 * - belongsToMany: ["tagId1", "tagId2", "tagId3"] (array of strings)
 *
 * WHY STORE IDS (not embedded objects):
 * - Normalization: single source of truth
 * - Smaller file sizes
 * - Updates don't cascade through all referencing content
 * - populate() option fetches related content when needed
 */

/**
 * Validate a relation field value
 *
 * @param {*} value - The relation value to validate
 * @param {Object} fieldDef - Field definition with target and relation
 * @param {string} fieldName - Field name (for error messages)
 * @param {string} type - Content type name (for error messages)
 * @throws {Error} - If relation is invalid
 * @private
 */
function validateRelation(value, fieldDef, fieldName, type) {
  const { target, relation } = fieldDef;

  // Verify target content type exists
  if (!contentTypes[target]) {
    throw new Error(
      `Relation field "${fieldName}" targets unknown content type "${target}" in "${type}"`
    );
  }

  // Validate relation type
  const validRelations = ['belongsTo', 'hasMany', 'belongsToMany'];
  if (!validRelations.includes(relation)) {
    throw new Error(
      `Invalid relation type "${relation}" for field "${fieldName}" in "${type}". ` +
      `Valid types: ${validRelations.join(', ')}`
    );
  }

  // Validate value format based on relation type
  if (value !== undefined && value !== null) {
    if (relation === 'belongsTo') {
      // Must be a string (single ID)
      if (typeof value !== 'string') {
        throw new Error(
          `Relation field "${fieldName}" (belongsTo) must be a string ID, got ${typeof value}`
        );
      }
    } else if (relation === 'belongsToMany') {
      // Must be an array of strings
      if (!Array.isArray(value)) {
        throw new Error(
          `Relation field "${fieldName}" (belongsToMany) must be an array, got ${typeof value}`
        );
      }
      for (const id of value) {
        if (typeof id !== 'string') {
          throw new Error(
            `Relation field "${fieldName}" (belongsToMany) must contain string IDs, got ${typeof id}`
          );
        }
      }
    }
    // hasMany is computed from inverse relations, not stored directly
  }
}

/**
 * Validate referential integrity for relation fields
 *
 * @param {Object} data - Content data with relation fields
 * @param {Object} schema - Schema with relation definitions
 * @param {string} type - Content type name
 * @param {Object} options - Validation options
 * @param {boolean} options.checkExists - Whether to verify referenced items exist (default: true)
 * @throws {Error} - If referenced content doesn't exist
 * @private
 */
function validateReferentialIntegrity(data, schema, type, options = {}) {
  const { checkExists = true } = options;

  if (!checkExists) return;

  for (const [fieldName, fieldDef] of Object.entries(schema)) {
    if (fieldDef.type !== 'relation') continue;

    const value = data[fieldName];
    if (value === undefined || value === null) continue;

    const { target, relation } = fieldDef;

    if (relation === 'belongsTo') {
      // Check single reference exists
      const targetPath = getContentPath(target, value);
      if (!existsSync(targetPath)) {
        throw new Error(
          `Relation field "${fieldName}" references non-existent ${target} with ID "${value}"`
        );
      }
    } else if (relation === 'belongsToMany') {
      // Check all references exist
      for (const id of value) {
        const targetPath = getContentPath(target, id);
        if (!existsSync(targetPath)) {
          throw new Error(
            `Relation field "${fieldName}" references non-existent ${target} with ID "${id}"`
          );
        }
      }
    }
  }
}

/**
 * Validate data against a schema
 *
 * @param {Object} data - Content data to validate
 * @param {Object} schema - Field definitions
 * @param {string} type - Content type name (for error messages)
 * @param {Object} options - Validation options
 * @param {boolean} options.checkReferentialIntegrity - Check that related content exists (default: true)
 * @throws {Error} - If required fields are missing or types don't match
 *
 * VALIDATION RULES:
 * - Required fields must be present and non-null
 * - Type checking is permissive (trusts JavaScript's typing)
 * - Unknown fields pass through (schema is additive, not restrictive)
 * - Relation fields are validated for format and optionally for existence
 *
 * WHY PERMISSIVE:
 * - Modules can store extra metadata
 * - Schema evolution is easier
 * - Strict mode could be added later as opt-in
 */
function validateData(data, schema, type, options = {}) {
  const { checkReferentialIntegrity = true } = options;

  for (const [fieldName, fieldDef] of Object.entries(schema)) {
    const value = data[fieldName];

    // Skip readonly fields during validation — they are auto-set by the system
    // WHY: Fields like 'created' and 'updated' are required but readonly,
    // meaning the system populates them automatically. User-supplied data
    // should not be required to include these fields.
    if (fieldDef.readonly) {
      continue;
    }

    // Check required fields
    if (fieldDef.required && (value === undefined || value === null)) {
      throw new Error(`Missing required field "${fieldName}" for content type "${type}"`);
    }

    // Handle relation type specially
    if (fieldDef.type === 'relation') {
      validateRelation(value, fieldDef, fieldName, type);
      continue;
    }

    // Skip special field types (handled elsewhere)
    if (fieldDef.type === 'computed' || fieldDef.type === 'slug') {
      continue;
    }

    // Type checking (only if value is present)
    if (value !== undefined && value !== null && fieldDef.type) {
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (actualType !== fieldDef.type) {
        throw new Error(
          `Field "${fieldName}" must be ${fieldDef.type}, got ${actualType} for content type "${type}"`
        );
      }
    }
  }

  // Validate referential integrity after field validation
  if (checkReferentialIntegrity) {
    validateReferentialIntegrity(data, schema, type);
  }
}

/**
 * Register a content type with its schema
 *
 * @param {string} type - Content type name (e.g., "page", "post", "greeting")
 * @param {Object} schema - Field definitions
 * @param {string} source - Module that registered this type (default: "core")
 *
 * SCHEMA FORMAT:
 * {
 *   title: { type: 'string', required: true },
 *   body: { type: 'string', required: true },
 *   published: { type: 'boolean', required: false }
 * }
 *
 * WHY REQUIRE SCHEMA:
 * - Documents what fields a type expects
 * - Enables validation to catch errors early
 * - Makes API responses predictable
 *
 * @example
 * register('greeting', {
 *   name: { type: 'string', required: true },
 *   message: { type: 'string', required: true }
 * }, 'hello');
 */
export function register(type, schema, source = 'core') {
  if (contentTypes[type]) {
    throw new Error(`Content type "${type}" is already registered by ${contentTypes[type].source}`);
  }

  contentTypes[type] = { schema, source };
}

/**
 * Create a module-specific register function
 *
 * WHY FACTORY FUNCTION:
 * - Same pattern as CLI and Router
 * - Auto-tracks which module registered the type
 * - Module doesn't need to pass its name every time
 *
 * @param {string} moduleName - The module registering content types
 * @returns {Function} - register(type, schema)
 */
export function createModuleRegister(moduleName) {
  return function registerForModule(type, schema) {
    register(type, schema, moduleName);
  };
}

/**
 * Create a new content item
 *
 * @param {string} type - Content type
 * @param {Object} data - Content data (fields matching schema)
 * @returns {Promise<Object>} - The saved content object with id, type, created, updated
 *
 * WHAT HAPPENS:
 * 1. Fires content:beforeCreate hook (can modify data or throw to cancel)
 * 2. Validates content type exists
 * 3. Validates data against schema
 * 4. Generates unique ID
 * 5. Adds system fields (id, type, created, updated)
 * 6. Writes JSON file atomically
 * 7. Fires content:afterCreate hook
 * 8. Returns the complete content object
 *
 * @throws {Error} - If type is not registered, validation fails, or hook cancels
 *
 * @example
 * const greeting = await create('greeting', {
 *   name: 'Ernie',
 *   message: 'Welcome!'
 * });
 * // Returns: { id: '...', type: 'greeting', created: '...', updated: '...', name: 'Ernie', message: 'Welcome!' }
 */
export async function create(type, data) {
  // Verify content type is registered
  if (!contentTypes[type]) {
    throw new Error(`Unknown content type: "${type}". Register it first with content.register()`);
  }

  // Fire beforeCreate hook
  // WHY PASS MUTABLE CONTEXT:
  // - Hooks can modify data before save
  // - Hooks can throw to cancel the operation
  const beforeContext = { type, data: { ...data } };
  await hooks.trigger('content:beforeCreate', beforeContext);
  data = beforeContext.data;

  const { schema } = contentTypes[type];

  // Run constraint plugin validation if available
  // WHY CONSTRAINTS BEFORE OLD VALIDATION:
  // Constraints collect ALL violations at once (Drupal pattern).
  // If constraints are enabled, they replace the old one-at-a-time validateData.
  // This gives users a complete list of what needs fixing.
  if (constraintService) {
    await constraintService.validateOrThrow(type, data, schema);
  } else {
    // Fallback to legacy validation if constraints not initialized
    validateData(data, schema, type);
  }

  // Generate unique ID and timestamps
  const id = generateId();
  const now = new Date().toISOString();

  // Build complete content object
  // WHY SPREAD data LAST:
  // - User data can't override system fields
  // - System fields are always present and correct
  const content = {
    id,
    type,
    created: now,
    updated: now,
    ...data,
    // WHY isDefaultRevision on create:
    // - New content is always the default (canonical) revision
    // - Enables pending draft workflows where published content
    //   can have non-default draft revisions alongside it
    // - Mirrors Drupal's content_moderation: published + isDefaultRevision
    //   are independent flags allowing "pending draft on published content"
    isDefaultRevision: true,
  };

  // Add workflow fields if enabled
  // WHY ADD AFTER DATA SPREAD:
  // - Allows data to specify initial status if desired
  // - Falls back to default if not provided
  if (workflowEnabled) {
    if (!content.status || !WORKFLOW_STATUSES.includes(content.status)) {
      content.status = defaultStatus;
    }
    // Set publishedAt if creating as published
    if (content.status === 'published' && !content.publishedAt) {
      content.publishedAt = now;
    }
  }

  // Generate slug if enabled and type has slug field
  // WHY AFTER WORKFLOW:
  // - All data fields are now populated
  // - Can generate from any field
  if (slugsEnabled) {
    const generatedSlug = await generateSlugForContent(type, content, schema);
    if (generatedSlug) {
      // Find the slug field name
      const slugFieldEntry = Object.entries(schema).find(([_, def]) => def.type === 'slug');
      if (slugFieldEntry) {
        content[slugFieldEntry[0]] = generatedSlug;
      }
    }
  }

  // Ensure type directory exists
  ensureTypeDir(type);

  // Write to file
  // WHY JSON with 2-space indent:
  // - Human-readable
  // - Git-friendly diffs
  // - Standard JSON formatting
  const filePath = getContentPath(type, id);
  writeFileSync(filePath, JSON.stringify(content, null, 2) + '\n');

  // Invalidate list cache for this type
  // WHY INVALIDATE ON CREATE:
  // - New item changes list results
  // - Pagination counts are now different
  // - Search results may include new item
  if (cacheEnabled) {
    cache.clear(`content:${type}:list:*`);
  }

  // Update slug index
  if (slugsEnabled && content.slug) {
    updateSlugIndex(type, content);
  }

  // Fire afterCreate hook
  // WHY AFTER WRITE:
  // - Item is safely persisted
  // - Webhooks can be fired
  // - Other modules can react to the new content
  await hooks.trigger('content:afterCreate', { type, item: content });

  return content;
}

/**
 * Populate relation fields in a content item
 *
 * @param {Object} item - Content item with relation IDs
 * @param {Object} schema - Content type schema
 * @param {Array<string>} populateFields - Fields to populate (or ['*'] for all)
 * @returns {Object} - Content item with populated relations
 * @private
 *
 * POPULATE BEHAVIOR:
 * - Replaces relation IDs with full content objects
 * - belongsTo: ID string → content object
 * - belongsToMany: ID array → content object array
 * - Missing references become null (belongsTo) or are filtered out (belongsToMany)
 *
 * WHY NOT POPULATE BY DEFAULT:
 * - Performance: additional reads for each relation
 * - Circular references: A→B→A would cause infinite loops
 * - Often only IDs are needed
 * - Explicit is better than implicit
 */
function populateRelations(item, schema, populateFields) {
  if (!item || !schema || !populateFields || populateFields.length === 0) {
    return item;
  }

  // Create a copy to avoid mutating the original (especially cached items)
  const populated = { ...item };

  // Determine which fields to populate
  const fieldsToPopulate = populateFields[0] === '*'
    ? Object.keys(schema).filter(f => schema[f].type === 'relation')
    : populateFields;

  for (const fieldName of fieldsToPopulate) {
    const fieldDef = schema[fieldName];

    // Skip if field isn't a relation
    if (!fieldDef || fieldDef.type !== 'relation') {
      continue;
    }

    const value = item[fieldName];
    if (value === undefined || value === null) {
      continue;
    }

    const { target, relation } = fieldDef;

    if (relation === 'belongsTo') {
      // Populate single reference
      // NOTE: We call the internal read without populate to avoid infinite loops
      const related = readRaw(target, value);
      populated[fieldName] = related; // null if not found
    } else if (relation === 'belongsToMany') {
      // Populate array of references
      const relatedItems = [];
      for (const id of value) {
        const related = readRaw(target, id);
        if (related) {
          relatedItems.push(related);
        }
        // Skip missing references (filter them out)
      }
      populated[fieldName] = relatedItems;
    }
    // hasMany is computed from inverse relations - would need separate query
  }

  return populated;
}

/**
 * Internal read function without populate (to avoid circular calls)
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @returns {Object|null} - Content object or null
 * @private
 */
function readRaw(type, id) {
  // Check cache first if enabled
  if (cacheEnabled) {
    const cacheKey = cache.itemKey(type, id);
    const cached = cache.get(cacheKey);
    if (cached !== null) {
      return cached;
    }
  }

  const filePath = getContentPath(type, id);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const raw = readFileSync(filePath, 'utf-8');
    const item = JSON.parse(raw);

    // WHY DEFAULT isDefaultRevision to true:
    // - Existing content created before pending revisions feature
    //   should be treated as the default (canonical) revision
    // - The main content file (not in .revisions/) is always
    //   the current default unless explicitly marked otherwise
    if (item.isDefaultRevision === undefined) {
      item.isDefaultRevision = true;
    }

    // Store in cache if enabled
    if (cacheEnabled) {
      const cacheKey = cache.itemKey(type, id);
      cache.set(cacheKey, item, cacheTTL);
    }

    return item;
  } catch (error) {
    console.error(`[content] Failed to read ${type}/${id}: ${error.message}`);
    return null;
  }
}

/**
 * Read a single content item
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {Object} options - Read options
 * @param {Array<string>} options.populate - Relation fields to populate (e.g., ['author', 'tags'] or ['*'])
 * @param {boolean} options.computed - Include computed fields (default: true)
 * @param {Array<string>} options.computedFields - Specific computed fields to include (default: all)
 * @param {Object} options.context - Context passed to computed field functions
 * @returns {Object|null} - Content object or null if not found
 *
 * CACHING:
 * - If caching is enabled, check cache first
 * - Cache hits return immediately without disk I/O
 * - Cache misses read from disk and populate cache
 * - Populated results are NOT cached (to avoid stale nested data)
 *
 * POPULATE:
 * - Pass populate option to embed related content
 * - Relations are replaced with full content objects
 * - Use ['*'] to populate all relation fields
 *
 * COMPUTED FIELDS:
 * - By default, computed fields are included (computed: true)
 * - Set computed: false to exclude them
 * - Use computedFields: ['field1', 'field2'] to include specific fields only
 *
 * WHY RETURN null (not throw):
 * - 404 is a normal case, not an error
 * - Caller decides how to handle missing content
 * - Matches common API patterns
 *
 * @example
 * const greeting = read('greeting', '1705123456789-x7k9m');
 * if (!greeting) {
 *   console.log('Not found');
 * }
 *
 * @example
 * // With populate
 * const post = read('post', 'abc123', { populate: ['author', 'tags'] });
 * console.log(post.author.username); // Embedded user object
 *
 * @example
 * // With computed fields
 * const article = read('article', 'abc123');
 * console.log(article.wordCount); // 450 (computed)
 *
 * // Exclude computed fields
 * const articleRaw = read('article', 'abc123', { computed: false });
 */
export function read(type, id, options = {}) {
  const {
    populate = null,
    computed = true,
    computedFields: requestedComputedFields = null,
    context = null,
  } = options;

  // Get raw item
  let item = readRaw(type, id);

  if (!item) {
    return null;
  }

  // Populate relations if requested
  if (populate && populate.length > 0) {
    const schema = contentTypes[type]?.schema;
    if (schema) {
      item = populateRelations(item, schema, populate);
    }
  }

  // Resolve computed fields if enabled and not explicitly disabled
  // Note: This is sync for now; use readAsync for async computed fields
  if (computed && computedEnabled && hasComputedFields(type)) {
    // For sync read, we need to handle async computed fields specially
    // If any computed field is async, the caller should use readAsync
    const allComputed = getComputedFields(type);
    const hasAsync = Object.values(allComputed).some(f => f.async);

    if (!hasAsync) {
      // All sync - resolve immediately
      const resolved = { ...item };
      const fieldsToCompute = requestedComputedFields
        ? requestedComputedFields.filter(f => allComputed[f])
        : Object.keys(allComputed);

      for (const fieldName of fieldsToCompute) {
        const fieldDef = allComputed[fieldName];
        try {
          resolved[fieldName] = fieldDef.compute(item, context);
        } catch (error) {
          console.error(`[content] Error computing "${fieldName}": ${error.message}`);
          resolved[fieldName] = null;
        }
      }
      item = resolved;
    }
    // If has async, computed fields won't be resolved in sync read
    // Use readAsync() or resolveComputed() separately
  }

  return item;
}

/**
 * Read a content item with async computed field support
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {Object} options - Same options as read()
 * @returns {Promise<Object|null>} - Content object with computed fields or null
 *
 * WHY SEPARATE ASYNC READ:
 * - Some computed fields may need async operations (DB lookups, API calls)
 * - Keeping read() sync maintains backwards compatibility
 * - Explicit async version makes the cost clear to callers
 */
export async function readAsync(type, id, options = {}) {
  const {
    populate = null,
    computed = true,
    computedFields: requestedComputedFields = null,
    context = null,
  } = options;

  // Get raw item
  let item = readRaw(type, id);

  if (!item) {
    return null;
  }

  // Populate relations if requested
  if (populate && populate.length > 0) {
    const schema = contentTypes[type]?.schema;
    if (schema) {
      item = populateRelations(item, schema, populate);
    }
  }

  // Resolve computed fields
  if (computed && computedEnabled && hasComputedFields(type)) {
    item = await resolveComputed(item, {
      fields: requestedComputedFields,
      context,
    });
  }

  return item;
}

/**
 * Update an existing content item
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {Object} data - Fields to update (partial update supported)
 * @returns {Promise<Object|null>} - Updated content object or null if not found
 *
 * WHAT HAPPENS:
 * 1. Reads existing content
 * 2. Fires content:beforeUpdate hook (can modify data or throw to cancel)
 * 3. Merges new data with existing
 * 4. Validates merged data against schema
 * 5. Preserves id and created timestamp
 * 6. Updates the 'updated' timestamp
 * 7. Writes back to file
 * 8. Fires content:afterUpdate hook
 *
 * PARTIAL UPDATES:
 * You don't need to send all fields, just the ones changing.
 * Existing fields are preserved.
 *
 * @example
 * await update('greeting', '1705123456789-x7k9m', { message: 'Updated message!' });
 */
export async function update(type, id, data, options = {}) {
  // Read existing content
  const existing = read(type, id);

  if (!existing) {
    return null;
  }

  // Verify content type is registered
  if (!contentTypes[type]) {
    throw new Error(`Unknown content type: "${type}"`);
  }

  // Check lock status (unless force flag is set)
  if (!options.force) {
    const userId = options.userId || options.user?.id || null;
    const lockError = locks.checkUpdateAllowed(type, id, userId);
    if (lockError) {
      const error = new Error(lockError.message);
      error.code = 'LOCKED';
      error.lockedBy = lockError.lockedBy;
      error.lockedByUserId = lockError.lockedByUserId;
      error.expiresIn = lockError.expiresIn;
      error.expiresAt = lockError.expiresAt;
      throw error;
    }
  }

  // Fire beforeUpdate hook
  const beforeContext = { type, id, data: { ...data }, existing };
  await hooks.trigger('content:beforeUpdate', beforeContext);
  data = beforeContext.data;

  const { schema } = contentTypes[type];

  // Merge existing with new data
  // WHY MERGE (not replace):
  // - Partial updates are more ergonomic
  // - Less data over the wire
  // - Less chance of overwriting parallel edits
  const now = new Date().toISOString();
  const merged = {
    ...existing,
    ...data,
    // Preserve system fields
    id: existing.id,
    type: existing.type,
    created: existing.created,
    updated: now,
  };

  // PENDING REVISIONS: Set isDefaultRevision based on workflow state
  // WHY: Mirrors Drupal's content_moderation where the isDefaultRevision
  // flag is determined by the workflow transition, not manually set.
  // - Publishing → always default
  // - Draft on published content → non-default (pending revision)
  // - Draft on draft content → stays default (normal editing)
  if (workflowEnabled) {
    const targetStatus = merged.status || existing.status || 'draft';
    merged.isDefaultRevision = shouldBeDefaultRevision(targetStatus, existing);
  }

  // PENDING REVISION ROUTING:
  // If the update results in a non-default revision (draft on published),
  // store as a pending revision instead of overwriting the main file.
  // This keeps the published version intact for public-facing reads.
  if (workflowEnabled && merged.isDefaultRevision === false && existing.status === 'published') {
    // Store as pending revision in .revisions/ directory
    if (revisionsEnabled) {
      ensureRevisionsDir(type, id);
      const revisionPath = getRevisionPath(type, id, now);
      writeFileSync(revisionPath, JSON.stringify(merged, null, 2) + '\n');
    }

    // Fire hook so other modules know a pending draft was created
    await hooks.trigger('content:pendingDraftCreated', {
      type,
      id,
      draft: merged,
      published: existing,
    });

    // Fire afterUpdate hook with the draft (but don't overwrite main file)
    await hooks.trigger('content:afterUpdate', { type, item: merged });

    return merged;
  }

  // Validate merged data
  // WHY CONSTRAINTS ON UPDATE TOO:
  // Constraints must be enforced on every save, not just create.
  // Uses merged data so partial updates are validated in full context.
  if (constraintService) {
    await constraintService.validateOrThrow(type, merged, schema, { isUpdate: true, id });
  } else {
    validateData(merged, schema, type);
  }

  // Handle slug updates (track history for redirects)
  const oldSlug = existing.slug;
  if (slugsEnabled) {
    const slugFieldEntry = Object.entries(schema).find(([_, def]) => def.type === 'slug');
    if (slugFieldEntry) {
      const [slugFieldName, slugFieldDef] = slugFieldEntry;

      // If slug changed, track history
      if (oldSlug && merged[slugFieldName] && oldSlug !== merged[slugFieldName]) {
        // Validate new slug
        const validation = validateSlug(merged[slugFieldName], {
          separator: slugSeparator,
          maxLength: slugMaxLength,
        });

        if (!validation.valid) {
          throw new Error(`Invalid slug: ${validation.errors.join(', ')}`);
        }

        // Check uniqueness
        if (slugFieldDef.unique !== false && slugExists(type, merged[slugFieldName], id)) {
          throw new Error(`Slug "${merged[slugFieldName]}" already exists for type "${type}"`);
        }

        // Track old slug in history if enabled
        if (slugFieldDef.trackHistory !== false && slugRedirectOld) {
          const history = Array.isArray(existing._slugHistory) ? [...existing._slugHistory] : [];

          // Add old slug to history if not already there
          if (!history.includes(oldSlug)) {
            history.unshift(oldSlug);
          }

          // Trim history to limit
          if (history.length > slugHistoryLimit) {
            history.length = slugHistoryLimit;
          }

          merged._slugHistory = history;
        }
      }
    }
  }

  // Save current version as revision BEFORE overwriting
  // WHY BEFORE WRITE:
  // - If write fails, we haven't created an orphan revision
  // - Captures the state that's about to be replaced
  // - Revision timestamp matches content's 'updated' field
  if (revisionsEnabled) {
    saveRevision(type, id, existing);
  }

  // Write back
  const filePath = getContentPath(type, id);
  writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n');

  // Invalidate cache for this item and list results
  // WHY INVALIDATE BOTH:
  // - Item cache has stale data
  // - List results may show different values
  // - Search results may change
  if (cacheEnabled) {
    cache.delete(cache.itemKey(type, id));
    cache.clear(`content:${type}:list:*`);
  }

  // Update slug index
  if (slugsEnabled && (merged.slug || oldSlug)) {
    updateSlugIndex(type, merged, oldSlug);
  }

  // Fire afterUpdate hook
  await hooks.trigger('content:afterUpdate', { type, item: merged });

  return merged;
}

/**
 * Delete a content item
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @returns {Promise<boolean>} - true if deleted, false if not found
 *
 * WHY RETURN boolean:
 * - Caller knows if anything was deleted
 * - Idempotent: calling delete twice doesn't error
 *
 * @example
 * if (await remove('greeting', id)) {
 *   console.log('Deleted');
 * } else {
 *   console.log('Not found');
 * }
 */
export async function remove(type, id, options = {}) {
  const { permanent = false, trashedBy = null } = options;
  const filePath = getContentPath(type, id);

  if (!existsSync(filePath)) {
    return false;
  }

  // Read item before delete (for slug index cleanup and trash)
  const item = read(type, id);

  // Fire beforeDelete hook
  // WHY BEFORE FILE DELETE:
  // - Hooks can throw to cancel deletion
  // - Item still exists if hook needs to read it
  await hooks.trigger('content:beforeDelete', { type, id, permanent });

  try {
    // Soft delete: move to trash (unless permanent or trash disabled)
    if (trashEnabled && !permanent) {
      await moveToTrash(type, id, item, trashedBy);
    } else {
      // Permanent delete: remove file directly
      unlinkSync(filePath);
    }

    // Invalidate cache for this item and list results
    // WHY INVALIDATE ON DELETE:
    // - Item no longer exists
    // - List counts and pagination change
    // - Search results change
    if (cacheEnabled) {
      cache.delete(cache.itemKey(type, id));
      cache.clear(`content:${type}:list:*`);
    }

    // Remove from slug index
    if (slugsEnabled && item) {
      removeFromSlugIndex(type, item);
    }

    // Fire afterDelete hook
    await hooks.trigger('content:afterDelete', { type, id, permanent, trashed: trashEnabled && !permanent });

    return true;
  } catch (error) {
    console.error(`[content] Failed to delete ${type}/${id}: ${error.message}`);
    return false;
  }
}

// Alias for delete (since 'delete' is a reserved word)
export { remove as delete };

/**
 * FILTER OPERATORS:
 * =================
 * Content listing supports field-level filtering with operators.
 *
 * SYNTAX:
 * Filter keys use double underscore to separate field from operator:
 * - field=value          → Exact match (eq)
 * - field__ne=value      → Not equal
 * - field__gt=value      → Greater than (numbers/dates)
 * - field__gte=value     → Greater than or equal
 * - field__lt=value      → Less than
 * - field__lte=value     → Less than or equal
 * - field__contains=str  → String contains (case-insensitive)
 * - field__startswith=a  → String starts with (case-insensitive)
 * - field__endswith=z    → String ends with (case-insensitive)
 * - field__in=a,b,c      → Value in comma-separated list
 *
 * WHY DOUBLE UNDERSCORE:
 * - Django-inspired convention, well-known to developers
 * - Unambiguous: field names rarely contain __
 * - URL-safe, no encoding needed
 *
 * EXAMPLE:
 * list('user', { filters: { role: 'admin', 'created__gte': '2024-01-01' } })
 */

/**
 * Parse a filter key into field and operator
 *
 * @param {string} key - Filter key (e.g., 'name', 'age__gt')
 * @returns {{ field: string, operator: string }}
 * @private
 */
function parseFilterKey(key) {
  const operators = ['ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'startswith', 'endswith', 'in'];

  for (const op of operators) {
    const suffix = `__${op}`;
    if (key.endsWith(suffix)) {
      return {
        field: key.slice(0, -suffix.length),
        operator: op,
      };
    }
  }

  // No operator suffix = exact match
  return { field: key, operator: 'eq' };
}

/**
 * Apply a single filter condition to an item
 *
 * @param {*} itemValue - The value from the content item
 * @param {string} operator - Filter operator
 * @param {*} filterValue - The filter value to compare against
 * @returns {boolean} - Whether the item passes the filter
 * @private
 */
function applyFilter(itemValue, operator, filterValue) {
  // Handle null/undefined item values
  if (itemValue === null || itemValue === undefined) {
    // Only 'ne' operator can match null/undefined values
    return operator === 'ne' && filterValue !== null && filterValue !== undefined;
  }

  switch (operator) {
    case 'eq':
      // Exact match (type-coerced for strings vs numbers from query params)
      if (typeof itemValue === 'number') {
        return itemValue === Number(filterValue);
      }
      if (typeof itemValue === 'boolean') {
        return itemValue === (filterValue === 'true' || filterValue === '1');
      }
      return String(itemValue) === String(filterValue);

    case 'ne':
      // Not equal
      if (typeof itemValue === 'number') {
        return itemValue !== Number(filterValue);
      }
      return String(itemValue) !== String(filterValue);

    case 'gt':
      // Greater than (numbers and dates)
      if (typeof itemValue === 'number') {
        return itemValue > Number(filterValue);
      }
      // Try as date
      const itemDate = new Date(itemValue);
      const filterDate = new Date(filterValue);
      if (!isNaN(itemDate.getTime()) && !isNaN(filterDate.getTime())) {
        return itemDate > filterDate;
      }
      return String(itemValue) > String(filterValue);

    case 'gte':
      // Greater than or equal
      if (typeof itemValue === 'number') {
        return itemValue >= Number(filterValue);
      }
      const itemDateGte = new Date(itemValue);
      const filterDateGte = new Date(filterValue);
      if (!isNaN(itemDateGte.getTime()) && !isNaN(filterDateGte.getTime())) {
        return itemDateGte >= filterDateGte;
      }
      return String(itemValue) >= String(filterValue);

    case 'lt':
      // Less than
      if (typeof itemValue === 'number') {
        return itemValue < Number(filterValue);
      }
      const itemDateLt = new Date(itemValue);
      const filterDateLt = new Date(filterValue);
      if (!isNaN(itemDateLt.getTime()) && !isNaN(filterDateLt.getTime())) {
        return itemDateLt < filterDateLt;
      }
      return String(itemValue) < String(filterValue);

    case 'lte':
      // Less than or equal
      if (typeof itemValue === 'number') {
        return itemValue <= Number(filterValue);
      }
      const itemDateLte = new Date(itemValue);
      const filterDateLte = new Date(filterValue);
      if (!isNaN(itemDateLte.getTime()) && !isNaN(filterDateLte.getTime())) {
        return itemDateLte <= filterDateLte;
      }
      return String(itemValue) <= String(filterValue);

    case 'contains':
      // String contains (case-insensitive)
      return String(itemValue).toLowerCase().includes(String(filterValue).toLowerCase());

    case 'startswith':
      // String starts with (case-insensitive)
      return String(itemValue).toLowerCase().startsWith(String(filterValue).toLowerCase());

    case 'endswith':
      // String ends with (case-insensitive)
      return String(itemValue).toLowerCase().endsWith(String(filterValue).toLowerCase());

    case 'in':
      // Value in comma-separated list
      const validValues = String(filterValue).split(',').map(v => v.trim());
      if (typeof itemValue === 'number') {
        return validValues.map(Number).includes(itemValue);
      }
      return validValues.includes(String(itemValue));

    default:
      // Unknown operator - treat as exact match
      return String(itemValue) === String(filterValue);
  }
}

/**
 * Apply all filters to an item
 *
 * @param {Object} item - Content item
 * @param {Object} filters - Filter conditions
 * @returns {boolean} - Whether item passes all filters (AND logic)
 * @private
 */
function matchesFilters(item, filters) {
  if (!filters || Object.keys(filters).length === 0) {
    return true;
  }

  for (const [key, value] of Object.entries(filters)) {
    const { field, operator } = parseFilterKey(key);
    const itemValue = item[field];

    if (!applyFilter(itemValue, operator, value)) {
      return false; // AND logic: fail on first non-match
    }
  }

  return true;
}

/**
 * List content items with pagination, search, and field filters
 *
 * @param {string} type - Content type
 * @param {Object} options - Query options
 * @param {number} options.page - Page number (default: 1)
 * @param {number} options.limit - Items per page (default: 20)
 * @param {string} options.search - Search term (case-insensitive, matches any string field)
 * @param {string} options.sortBy - Field to sort by (default: 'created')
 * @param {string} options.sortOrder - Sort order: 'asc' or 'desc' (default: 'desc')
 * @param {Object} options.filters - Field filters (e.g., { role: 'admin', 'age__gt': 18 })
 * @param {Array<string>} options.populate - Relation fields to populate (e.g., ['author'] or ['*'])
 * @param {boolean} options.computed - Include computed fields (default: true)
 * @param {Array<string>} options.computedFields - Specific computed fields to include
 * @returns {{ items: Array, total: number, page: number, limit: number, pages: number, filters: Object }}
 *
 * CACHING:
 * - List results are cached based on query parameters
 * - Cache key includes type, page, limit, search, sort, filters
 * - Cache is invalidated on any write to this type
 * - Populated results are NOT cached (to avoid stale nested data)
 *
 * PAGINATION:
 * Results are paginated to prevent loading thousands of items.
 * Default limit is 20 items per page.
 *
 * SEARCH:
 * Case-insensitive search across all string fields.
 * Matches if any field contains the search term.
 *
 * FILTERS:
 * Field-level filters with operators (eq, ne, gt, gte, lt, lte, contains, startswith, endswith, in).
 * Multiple filters use AND logic (all must match).
 * Applied after loading content, before pagination.
 * Filtering by relation ID is supported (e.g., { author: 'userId123' }).
 *
 * SORTING:
 * Can sort by any field. Default is created timestamp, newest first.
 *
 * POPULATE:
 * - Pass populate option to embed related content in results
 * - Applied after pagination (only populates returned items)
 * - Use ['*'] to populate all relation fields
 *
 * COMPUTED:
 * - By default, computed fields are included in results
 * - Set computed: false to exclude them
 * - Note: list() only includes sync computed fields (async are skipped)
 * - Use listAsync() for async computed field support
 *
 * @example
 * // Basic filtering
 * const result = list('user', { filters: { role: 'admin' } });
 *
 * // With operators
 * const result = list('user', { filters: {
 *   'created__gte': '2024-01-01',
 *   'name__contains': 'john',
 *   'role__in': 'admin,editor'
 * }});
 *
 * // With populate
 * const result = list('post', { populate: ['author', 'tags'] });
 * console.log(result.items[0].author.username); // Embedded user
 *
 * // Reverse query: find posts by author
 * const userPosts = list('post', { filters: { author: 'userId123' } });
 *
 * // With computed fields
 * const articles = list('article'); // includes wordCount, readTime etc.
 */
export function list(type, options = {}) {
  const {
    page = 1,
    limit = 20,
    search = null,
    sortBy = 'created',
    sortOrder = 'desc',
    filters = null,
    populate = null,
    computed = true,
    computedFields: requestedComputedFields = null,
  } = options;

  // Check cache first if enabled
  // Include filters in cache key for accurate caching
  if (cacheEnabled) {
    const cacheKey = cache.listKey(type, { page, limit, search, sortBy, sortOrder, filters });
    const cached = cache.get(cacheKey);
    if (cached !== null) {
      return cached;
    }
  }

  const typeDir = join(contentDir, type);

  if (!existsSync(typeDir)) {
    return { items: [], total: 0, page, limit, pages: 0, filters: filters || {} };
  }

  const files = readdirSync(typeDir)
    .filter(f => f.endsWith('.json'));

  let items = [];

  for (const file of files) {
    const id = file.replace('.json', '');
    // Read without computed fields initially (we'll add them after pagination)
    const item = read(type, id, { computed: false });
    if (item) {
      items.push(item);
    }
  }

  // Apply field filters FIRST (most specific)
  // WHY BEFORE SEARCH:
  // - Filters are explicit field constraints
  // - Search is a broad text match
  // - Filtering first reduces items for search to process
  if (filters && Object.keys(filters).length > 0) {
    items = items.filter(item => matchesFilters(item, filters));
  }

  // Apply search filter
  // WHY SEARCH ALL STRING FIELDS:
  // - User doesn't need to know schema
  // - More flexible than field-specific search
  // - Simple to implement and understand
  if (search) {
    const searchLower = search.toLowerCase();
    items = items.filter(item => {
      for (const [key, value] of Object.entries(item)) {
        if (typeof value === 'string' && value.toLowerCase().includes(searchLower)) {
          return true;
        }
      }
      return false;
    });
  }

  // Sort items
  // WHY SUPPORT ANY FIELD:
  // - Flexibility for different use cases
  // - Common patterns: sort by created, updated, title, etc.
  items.sort((a, b) => {
    let aVal = a[sortBy];
    let bVal = b[sortBy];

    // Handle dates
    if (sortBy === 'created' || sortBy === 'updated') {
      aVal = new Date(aVal).getTime();
      bVal = new Date(bVal).getTime();
    }

    // Handle strings case-insensitively
    if (typeof aVal === 'string') aVal = aVal.toLowerCase();
    if (typeof bVal === 'string') bVal = bVal.toLowerCase();

    // Compare
    if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  // Calculate pagination
  const total = items.length;
  const pages = Math.ceil(total / limit);
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;

  // Slice to page
  let paginatedItems = items.slice(startIndex, endIndex);

  // Populate relations if requested
  // WHY AFTER PAGINATION:
  // - Only populate items we're returning (not entire dataset)
  // - Better performance for large datasets
  // - Still allows filtering by relation ID before pagination
  if (populate && populate.length > 0) {
    const schema = contentTypes[type]?.schema;
    if (schema) {
      paginatedItems = paginatedItems.map(item => populateRelations(item, schema, populate));
    }
  }

  // Resolve computed fields if enabled (sync only for list())
  // WHY AFTER PAGINATION:
  // - Only compute for items we're returning
  // - Better performance for large datasets
  // - Computed values don't affect filtering/sorting (use listAsync for that)
  if (computed && computedEnabled && hasComputedFields(type)) {
    const allComputed = getComputedFields(type);
    const hasAsync = Object.values(allComputed).some(f => f.async);

    // Only resolve sync computed fields
    if (!hasAsync || requestedComputedFields) {
      const syncFields = Object.entries(allComputed)
        .filter(([_, def]) => !def.async)
        .map(([name]) => name);

      const fieldsToCompute = requestedComputedFields
        ? requestedComputedFields.filter(f => syncFields.includes(f))
        : syncFields;

      if (fieldsToCompute.length > 0) {
        paginatedItems = paginatedItems.map(item => {
          const resolved = { ...item };
          for (const fieldName of fieldsToCompute) {
            const fieldDef = allComputed[fieldName];
            if (fieldDef && !fieldDef.async) {
              try {
                resolved[fieldName] = fieldDef.compute(item, null);
              } catch (error) {
                console.error(`[content] Error computing "${fieldName}": ${error.message}`);
                resolved[fieldName] = null;
              }
            }
          }
          return resolved;
        });
      }
    }
  }

  const result = {
    items: paginatedItems,
    total,
    page,
    limit,
    pages,
    filters: filters || {},
  };

  // Store in cache if enabled (only if not populating)
  // WHY NOT CACHE POPULATED RESULTS:
  // - Nested data could become stale
  // - Cache key would need to include populate fields
  // - Complexity vs benefit tradeoff
  if (cacheEnabled && !populate) {
    const cacheKey = cache.listKey(type, { page, limit, search, sortBy, sortOrder, filters });
    cache.set(cacheKey, result, cacheTTL);
  }

  return result;
}

/**
 * Get all items without pagination (for internal use)
 *
 * @param {string} type - Content type
 * @returns {Array<Object>} - All content items
 *
 * WHY SEPARATE FUNCTION:
 * - Backwards compatibility with code expecting arrays
 * - Simpler API for small datasets
 * - Internal operations that need all items
 *
 * WHY NOT USE limit: Infinity:
 * - (page - 1) * Infinity = NaN for page 1
 * - Slice with NaN returns empty array
 * - Use MAX_SAFE_INTEGER instead as practical "unlimited"
 */
export function listAll(type) {
  const result = list(type, { limit: Number.MAX_SAFE_INTEGER });
  return result.items;
}

/**
 * Search across multiple content types
 *
 * @param {string} query - Search term
 * @param {string[]} types - Content types to search (default: all types)
 * @returns {Array<{ type: string, item: Object }>} - Matching items with their types
 *
 * SEARCH BEHAVIOR:
 * - Case-insensitive
 * - Matches any string field
 * - Results sorted by relevance (exact matches first, then partial)
 *
 * @example
 * const results = search('hello');
 * for (const { type, item } of results) {
 *   console.log(`[${type}] ${item.id}`);
 * }
 */
export function search(query, types = null) {
  // Get all types if not specified
  const typesToSearch = types || Object.keys(contentTypes);
  const results = [];
  const queryLower = query.toLowerCase();

  for (const type of typesToSearch) {
    if (!contentTypes[type]) continue;

    const typeDir = join(contentDir, type);
    if (!existsSync(typeDir)) continue;

    const files = readdirSync(typeDir).filter(f => f.endsWith('.json'));

    for (const file of files) {
      const id = file.replace('.json', '');
      const item = read(type, id);
      if (!item) continue;

      // Check if any string field matches
      let matchScore = 0;
      for (const [key, value] of Object.entries(item)) {
        if (typeof value === 'string') {
          const valueLower = value.toLowerCase();
          if (valueLower === queryLower) {
            matchScore = 2; // Exact match
            break;
          } else if (valueLower.includes(queryLower)) {
            matchScore = 1; // Partial match
          }
        }
      }

      if (matchScore > 0) {
        results.push({ type, item, score: matchScore });
      }
    }
  }

  // Sort by score (exact matches first), then by created date
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(b.item.created).getTime() - new Date(a.item.created).getTime();
  });

  // Remove score from results
  return results.map(({ type, item }) => ({ type, item }));
}

/**
 * List all registered content types
 *
 * @returns {Array<{type, schema, source}>}
 *
 * WHY RETURN ARRAY:
 * - Consistent with list() pattern
 * - Easy to iterate for help/docs
 * - Includes source for debugging
 *
 * @example
 * const types = listTypes();
 * for (const { type, schema, source } of types) {
 *   console.log(`${type} (from ${source})`);
 * }
 */
export function listTypes() {
  return Object.entries(contentTypes).map(([type, { schema, source }]) => ({
    type,
    schema,
    source,
  }));
}

/**
 * Check if a content type is registered
 *
 * @param {string} type - Content type name
 * @returns {boolean}
 */
export function hasType(type) {
  return type in contentTypes;
}

/**
 * Get schema for a content type
 *
 * @param {string} type - Content type name
 * @returns {Object|null} - Schema or null if not registered
 */
export function getSchema(type) {
  return contentTypes[type]?.schema || null;
}

/**
 * Get content type info (schema + metadata)
 *
 * @param {string} type - Content type name
 * @returns {Object|null} - Type info { schema, source } or null
 */
export function getType(type) {
  return contentTypes[type] || null;
}

/**
 * Clear all registered content types (mainly for testing)
 */
export function clearTypes() {
  for (const key of Object.keys(contentTypes)) {
    delete contentTypes[key];
  }
}

// ===========================================
// REVISION FUNCTIONS
// ===========================================

/**
 * Get all revisions for a content item
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @returns {Array<{ timestamp: string, size: number }>} - List of revisions, newest first
 *
 * RETURNS:
 * Array of revision metadata (not full content, for performance)
 * Each item has:
 * - timestamp: ISO string when this revision was created
 * - size: File size in bytes (gives sense of content size)
 *
 * WHY NOT RETURN FULL CONTENT:
 * - Could be many revisions with large content
 * - List view just needs timestamps
 * - Use getRevision() to fetch specific revision content
 *
 * @example
 * const revisions = getRevisions('greeting', 'abc123');
 * // [
 * //   { timestamp: '2024-01-15T12:00:00.000Z', size: 245 },
 * //   { timestamp: '2024-01-15T11:00:00.000Z', size: 198 }
 * // ]
 */
export function getRevisions(type, id) {
  const revisionsDir = getRevisionsDir(type, id);

  if (!existsSync(revisionsDir)) {
    return [];
  }

  const files = readdirSync(revisionsDir)
    .filter(f => f.endsWith('.json'));

  const revisions = [];

  for (const file of files) {
    // Convert filename back to timestamp
    // Filename format: 2024-01-15T12-00-00.000Z.json (colons replaced with dashes)
    const timestamp = file
      .replace('.json', '')
      .replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})/, '$1:$2:$3');

    const filePath = join(revisionsDir, file);
    const stats = statSync(filePath);

    // Read revision content to extract isDefaultRevision flag
    // WHY include isDefaultRevision in metadata:
    // - Enables pending revision workflows without reading full revision content
    // - CLI and UI can show which revision is the default at a glance
    let isDefaultRevision = false;
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const revisionContent = JSON.parse(raw);
      isDefaultRevision = revisionContent.isDefaultRevision === true;
    } catch (e) {
      // If we can't read the revision, default to false
    }

    revisions.push({
      timestamp,
      size: stats.size,
      isDefaultRevision,
    });
  }

  // Sort by timestamp descending (newest first)
  revisions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return revisions;
}

/**
 * Get a specific revision's content
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {string} timestamp - ISO timestamp of the revision
 * @returns {Object|null} - Revision content or null if not found
 *
 * @example
 * const oldVersion = getRevision('greeting', 'abc123', '2024-01-15T11:00:00.000Z');
 * console.log(oldVersion.message); // Previous message
 */
export function getRevision(type, id, timestamp) {
  const revisionPath = getRevisionPath(type, id, timestamp);

  if (!existsSync(revisionPath)) {
    return null;
  }

  try {
    const raw = readFileSync(revisionPath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    console.error(`[content] Failed to read revision ${type}/${id}@${timestamp}: ${error.message}`);
    return null;
  }
}

/**
 * Revert content to a previous revision
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {string} timestamp - ISO timestamp of the revision to restore
 * @returns {Promise<Object|null>} - The restored content or null if revision not found
 *
 * REVERT BEHAVIOR:
 * 1. Current version is saved as a new revision (so you can undo the revert)
 * 2. Revision content becomes the new current version
 * 3. 'updated' timestamp is set to NOW (not the revision's timestamp)
 * 4. 'created' timestamp is preserved from the revision
 *
 * WHY SAVE CURRENT AS REVISION:
 * - Reverts can be undone by reverting again
 * - No data is ever lost
 * - Audit trail shows the revert happened
 *
 * WHY UPDATE 'updated' TIMESTAMP:
 * - Reflects when the change happened (now)
 * - Content lists show correct "last modified"
 * - Hooks see the revert as a normal update
 *
 * @example
 * const restored = await revertTo('greeting', 'abc123', '2024-01-15T11:00:00.000Z');
 * // Current version is now what it was at that timestamp
 */
export async function revertTo(type, id, timestamp) {
  // Get the revision to restore
  const revision = getRevision(type, id, timestamp);

  if (!revision) {
    return null;
  }

  // Get current version
  const current = read(type, id);

  if (!current) {
    return null;
  }

  // Save current version as revision before overwriting
  // This allows "undo revert" by reverting to the version we're about to replace
  if (revisionsEnabled) {
    saveRevision(type, id, current);
  }

  // Build restored content
  // Use revision's data fields but update the 'updated' timestamp
  const restored = {
    ...revision,
    updated: new Date().toISOString(),
  };

  // Write restored content
  const filePath = getContentPath(type, id);
  writeFileSync(filePath, JSON.stringify(restored, null, 2) + '\n');

  // Invalidate cache
  if (cacheEnabled) {
    cache.delete(cache.itemKey(type, id));
    cache.clear(`content:${type}:list:*`);
  }

  // Fire afterUpdate hook (revert is a type of update)
  await hooks.trigger('content:afterUpdate', { type, item: restored });

  return restored;
}

/**
 * Set a specific revision as the default (canonical) revision
 *
 * WHY SEPARATE FROM revertTo:
 * - revertTo is about restoring content, focused on the "updated" timestamp
 * - setDefaultRevision is about the pending revisions workflow:
 *   it explicitly manages the isDefaultRevision flag
 * - In Drupal's content_moderation, setting the default revision
 *   is the mechanism by which a pending draft becomes canonical
 *
 * BEHAVIOR:
 * 1. Save current default as a non-default revision
 * 2. Load the target revision content
 * 3. Write it as the main file with isDefaultRevision: true
 * 4. Remove the target from the revisions directory
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {string} revisionTimestamp - ISO timestamp of the revision to make default
 * @returns {Promise<Object>} - The new default content
 */
export async function setDefaultRevision(type, id, revisionTimestamp) {
  const current = read(type, id);
  if (!current) {
    throw new Error(`Content not found: ${type}/${id}`);
  }

  // Load the target revision
  const targetRevision = getRevision(type, id, revisionTimestamp);
  if (!targetRevision) {
    throw new Error(`Revision not found: ${revisionTimestamp}`);
  }

  // Save current version as a non-default revision
  // WHY NON-DEFAULT:
  // - The current content is being replaced as the default
  // - It should be preserved in history but no longer be canonical
  if (revisionsEnabled) {
    const currentAsRevision = { ...current, isDefaultRevision: false };
    saveRevision(type, id, currentAsRevision);
  }

  const now = new Date().toISOString();

  // Build the new default from the target revision
  const newDefault = {
    ...targetRevision,
    isDefaultRevision: true,
    updated: now,
  };

  // Write as the main content file
  const filePath = getContentPath(type, id);
  writeFileSync(filePath, JSON.stringify(newDefault, null, 2) + '\n');

  // Remove the target revision file (it's now the main content)
  // WHY REMOVE:
  // - Avoids having the same content in both the main file and revisions
  // - The old default is now in revisions, so nothing is lost
  const revisionsDir = getRevisionsDir(type, id);
  const tsFormatted = revisionTimestamp.replace(/:/g, '-');
  const possibleFiles = readdirSync(revisionsDir).filter(f => f.endsWith('.json'));
  for (const file of possibleFiles) {
    const fileTs = file.replace('.json', '').replace(/-/g, ':').replace(/T(\d+):(\d+):/, (m, h, min) => `T${h}:${min}:`);
    // Match by checking if the revision content matches
    try {
      const revPath = join(revisionsDir, file);
      const rev = JSON.parse(readFileSync(revPath, 'utf-8'));
      if (rev.updated === targetRevision.updated && rev.title === targetRevision.title) {
        unlinkSync(revPath);
        break;
      }
    } catch (e) {
      // Skip
    }
  }

  // Invalidate cache
  if (cacheEnabled) {
    cache.delete(cache.itemKey(type, id));
    cache.clear(`content:${type}:list:*`);
  }

  // Fire hook
  await hooks.trigger('content:defaultRevisionChanged', {
    type,
    id,
    newDefault,
    previousDefault: current,
    revisionTimestamp,
  });

  await hooks.trigger('content:afterUpdate', { type, item: newDefault });

  return newDefault;
}

/**
 * Compare two revisions or a revision with current content
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {string} ts1 - First timestamp (or 'current' for current version)
 * @param {string} ts2 - Second timestamp (or 'current' for current version)
 * @returns {Object|null} - Diff object or null if either version not found
 *
 * DIFF FORMAT:
 * {
 *   ts1: '2024-01-15T11:00:00.000Z',
 *   ts2: '2024-01-15T12:00:00.000Z',
 *   changes: [
 *     { field: 'message', from: 'Hello', to: 'Hello World', type: 'modified' },
 *     { field: 'newField', from: undefined, to: 'value', type: 'added' },
 *     { field: 'oldField', from: 'value', to: undefined, type: 'removed' }
 *   ]
 * }
 *
 * DIFF TYPES:
 * - 'modified': Field exists in both, values differ
 * - 'added': Field exists only in ts2
 * - 'removed': Field exists only in ts1
 *
 * WHY FIELD-LEVEL DIFF:
 * - Easy to display in UI
 * - Shows exactly what changed
 * - Works for any content type
 *
 * @example
 * const diff = diffRevisions('greeting', 'abc123', '2024-01-15T11:00:00.000Z', 'current');
 * for (const change of diff.changes) {
 *   console.log(`${change.field}: ${change.from} → ${change.to}`);
 * }
 */
export function diffRevisions(type, id, ts1, ts2) {
  // Get both versions
  const v1 = ts1 === 'current' ? read(type, id) : getRevision(type, id, ts1);
  const v2 = ts2 === 'current' ? read(type, id) : getRevision(type, id, ts2);

  if (!v1 || !v2) {
    return null;
  }

  const changes = [];

  // Get all unique keys from both versions
  const allKeys = new Set([...Object.keys(v1), ...Object.keys(v2)]);

  // Skip system fields that always change
  const skipFields = ['updated'];

  for (const key of allKeys) {
    if (skipFields.includes(key)) continue;

    const val1 = v1[key];
    const val2 = v2[key];

    // Convert to JSON for comparison (handles objects/arrays)
    const str1 = JSON.stringify(val1);
    const str2 = JSON.stringify(val2);

    if (str1 === str2) continue;

    // Determine change type
    let changeType;
    if (val1 === undefined) {
      changeType = 'added';
    } else if (val2 === undefined) {
      changeType = 'removed';
    } else {
      changeType = 'modified';
    }

    changes.push({
      field: key,
      from: val1,
      to: val2,
      type: changeType,
    });
  }

  return {
    ts1: ts1 === 'current' ? v1.updated : ts1,
    ts2: ts2 === 'current' ? v2.updated : ts2,
    changes,
  };
}

/**
 * Prune old revisions for a content item
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {number} keep - Number of revisions to keep (default: maxPerItem from config)
 * @returns {number} - Number of revisions deleted
 *
 * PRUNE BEHAVIOR:
 * - Keeps the N most recent revisions
 * - Deletes all older revisions
 * - Returns count of deleted revisions
 *
 * WHY EXPLICIT PRUNE:
 * - Auto-pruning happens on update()
 * - This allows manual cleanup if limits change
 * - Useful for housekeeping commands
 *
 * @example
 * const deleted = pruneRevisions('greeting', 'abc123', 5);
 * console.log(`Deleted ${deleted} old revisions`);
 */
export function pruneRevisions(type, id, keep = maxRevisionsPerItem) {
  return pruneRevisionsInternal(type, id, keep);
}

/**
 * Get revision configuration status
 *
 * @returns {{ enabled: boolean, maxPerItem: number }}
 */
export function getRevisionsConfig() {
  return {
    enabled: revisionsEnabled,
    maxPerItem: maxRevisionsPerItem,
  };
}

// ===========================================
// RELATION FUNCTIONS
// ===========================================

/**
 * Get related content items (for hasMany relations)
 *
 * @param {string} sourceType - Source content type
 * @param {string} sourceId - Source content ID
 * @param {string} relationField - The belongsTo field on the target type that references this type
 * @param {string} targetType - Target content type to query
 * @param {Object} options - Query options (same as list())
 * @returns {{ items: Array, total: number, page: number, limit: number, pages: number }}
 *
 * USE CASE:
 * When you have a belongsTo relation (post.author → user) and want to find all
 * posts for a given user, use this function.
 *
 * This implements the "hasMany" side of a relationship without storing IDs
 * redundantly on the "one" side.
 *
 * @example
 * // Schema: post has author: { type: 'relation', target: 'user', relation: 'belongsTo' }
 * // Find all posts by a user:
 * const userPosts = getRelated('user', 'userId123', 'author', 'post');
 *
 * // This is equivalent to:
 * list('post', { filters: { author: 'userId123' } });
 */
export function getRelated(sourceType, sourceId, relationField, targetType, options = {}) {
  // Verify the source content exists
  const source = readRaw(sourceType, sourceId);
  if (!source) {
    return { items: [], total: 0, page: 1, limit: 20, pages: 0, filters: {} };
  }

  // Query target type filtering by the relation field
  return list(targetType, {
    ...options,
    filters: {
      ...options.filters,
      [relationField]: sourceId,
    },
  });
}

/**
 * Get all relation fields from a schema
 *
 * @param {string} type - Content type
 * @returns {Array<{field: string, target: string, relation: string}>}
 *
 * @example
 * const relations = getRelationFields('post');
 * // [
 * //   { field: 'author', target: 'user', relation: 'belongsTo' },
 * //   { field: 'tags', target: 'tag', relation: 'belongsToMany' }
 * // ]
 */
export function getRelationFields(type) {
  const schema = contentTypes[type]?.schema;
  if (!schema) return [];

  const relations = [];
  for (const [field, def] of Object.entries(schema)) {
    if (def.type === 'relation') {
      relations.push({
        field,
        target: def.target,
        relation: def.relation,
      });
    }
  }
  return relations;
}

/**
 * Check if deleting content would break referential integrity
 *
 * @param {string} type - Content type being deleted
 * @param {string} id - Content ID being deleted
 * @returns {Array<{type: string, id: string, field: string}>} - Content that references this item
 *
 * USE CASE:
 * Before deleting content, check if other content references it.
 * This allows showing a warning or preventing orphan references.
 *
 * WHY NOT AUTO-CASCADE:
 * - Cascading deletes can be dangerous
 * - User should be aware of what will be affected
 * - Different situations need different handling (cascade, nullify, or block)
 *
 * @example
 * const refs = checkReferences('user', 'userId123');
 * if (refs.length > 0) {
 *   console.log(`Cannot delete: ${refs.length} items reference this user`);
 * }
 */
export function checkReferences(type, id) {
  const references = [];

  // Check all content types for relations targeting this type
  for (const [otherType, { schema }] of Object.entries(contentTypes)) {
    for (const [fieldName, fieldDef] of Object.entries(schema)) {
      if (fieldDef.type !== 'relation' || fieldDef.target !== type) {
        continue;
      }

      // Search for content referencing this ID
      const items = listAll(otherType);
      for (const item of items) {
        const value = item[fieldName];

        if (fieldDef.relation === 'belongsTo' && value === id) {
          references.push({ type: otherType, id: item.id, field: fieldName });
        } else if (fieldDef.relation === 'belongsToMany' && Array.isArray(value) && value.includes(id)) {
          references.push({ type: otherType, id: item.id, field: fieldName });
        }
      }
    }
  }

  return references;
}

/**
 * Parse JSON body from request
 *
 * UTILITY FUNCTION:
 * Since this CMS doesn't have middleware, we provide this helper
 * for route handlers that need to parse JSON bodies.
 *
 * @param {http.IncomingMessage} req - HTTP request
 * @returns {Promise<Object>} - Parsed JSON body
 * @throws {Error} - If body is not valid JSON
 *
 * WHY HERE (not in server.js):
 * - Content routes need body parsing
 * - Keeps server.js minimal
 * - Can be imported by modules that need it
 *
 * @example
 * const data = await parseBody(req);
 * const content = create('greeting', data);
 */
export function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();

      // Prevent huge bodies (basic protection)
      // WHY 1MB LIMIT:
      // - Prevents memory exhaustion attacks
      // - JSON content rarely exceeds this
      // - Configurable limit could be added later
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
      }
    });

    req.on('end', () => {
      try {
        // Handle empty body
        if (!body.trim()) {
          resolve({});
          return;
        }

        const data = JSON.parse(body);
        resolve(data);
      } catch (error) {
        reject(new Error('Invalid JSON in request body'));
      }
    });

    req.on('error', reject);
  });
}

/**
 * Parse filter parameters from a URL query string
 *
 * @param {URLSearchParams} searchParams - URL search params
 * @param {Object} schema - Content type schema (optional, for validation)
 * @returns {Object} - Filter object for use with list()
 *
 * WHY SEPARATE FUNCTION:
 * - Reusable across HTTP routes and CLI
 * - Encapsulates URL parameter parsing logic
 * - Easy to add validation or transformation
 *
 * RESERVED PARAMS (not treated as filters):
 * - page, limit, search, sort, order
 *
 * @example
 * const url = new URL(req.url, 'http://localhost');
 * const filters = parseFiltersFromQuery(url.searchParams, schema);
 * // { status: 'published', 'views__gt': '100' }
 */
export function parseFiltersFromQuery(searchParams, schema = null) {
  const reservedParams = ['page', 'limit', 'search', 'sort', 'order'];
  const filters = {};

  for (const [key, value] of searchParams.entries()) {
    // Skip reserved params
    if (reservedParams.includes(key)) {
      continue;
    }

    // Skip empty values
    if (value === '' || value === null || value === undefined) {
      continue;
    }

    // Extract field name from key (handle operators like field__gt)
    const { field } = parseFilterKey(key);

    // If schema provided, validate field exists
    // Allow system fields (id, type, created, updated) even if not in schema
    const systemFields = ['id', 'type', 'created', 'updated'];
    if (schema && !schema[field] && !systemFields.includes(field)) {
      // Skip unknown fields (could throw error in strict mode)
      continue;
    }

    filters[key] = value;
  }

  return Object.keys(filters).length > 0 ? filters : null;
}

/**
 * Format filter object for URL query string
 *
 * @param {Object} filters - Filter object
 * @returns {string} - URL query string fragment (without leading ?)
 *
 * @example
 * formatFiltersForQuery({ role: 'admin', 'age__gt': '18' })
 * // 'role=admin&age__gt=18'
 */
export function formatFiltersForQuery(filters) {
  if (!filters || Object.keys(filters).length === 0) {
    return '';
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    params.set(key, value);
  }
  return params.toString();
}

/**
 * Get available filter operators
 *
 * @returns {Array<{op: string, description: string, types: Array<string>}>}
 *
 * WHY EXPORT:
 * - Admin UI can show available operators
 * - Documentation generation
 * - Client-side validation
 */
export function getFilterOperators() {
  return [
    { op: 'eq', label: '=', description: 'Exact match', types: ['string', 'number', 'boolean'] },
    { op: 'ne', label: '≠', description: 'Not equal', types: ['string', 'number', 'boolean'] },
    { op: 'gt', label: '>', description: 'Greater than', types: ['number', 'date'] },
    { op: 'gte', label: '≥', description: 'Greater than or equal', types: ['number', 'date'] },
    { op: 'lt', label: '<', description: 'Less than', types: ['number', 'date'] },
    { op: 'lte', label: '≤', description: 'Less than or equal', types: ['number', 'date'] },
    { op: 'contains', label: 'contains', description: 'String contains', types: ['string'] },
    { op: 'startswith', label: 'starts with', description: 'String starts with', types: ['string'] },
    { op: 'endswith', label: 'ends with', description: 'String ends with', types: ['string'] },
    { op: 'in', label: 'in', description: 'Value in list', types: ['string', 'number'] },
  ];
}

// ===========================================
// WORKFLOW FUNCTIONS
// ===========================================

/**
 * Get workflow configuration status
 *
 * @returns {{ enabled: boolean, defaultStatus: string, scheduleCheckInterval: number, statuses: string[] }}
 */
export function getWorkflowConfig() {
  return {
    enabled: workflowEnabled,
    defaultStatus,
    scheduleCheckInterval,
    statuses: WORKFLOW_STATUSES,
  };
}

/**
 * Change content status with workflow hooks
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {string} status - New status (draft, pending, published, archived)
 * @param {Object} options - Options
 * @param {Date|string} options.scheduledAt - For pending status, when to auto-publish
 * @returns {Promise<Object|null>} - Updated content or null if not found
 *
 * WORKFLOW HOOKS FIRED:
 * - content:beforeStatusChange - can throw to prevent
 * - content:afterStatusChange - after status is changed
 * - content:published - when status changes to 'published'
 * - content:unpublished - when status changes from 'published' to draft
 *
 * @example
 * await setStatus('article', 'abc123', 'published');
 */
export async function setStatus(type, id, status, options = {}) {
  // Validate status
  if (!WORKFLOW_STATUSES.includes(status)) {
    throw new Error(`Invalid status: "${status}". Valid statuses: ${WORKFLOW_STATUSES.join(', ')}`);
  }

  // Read existing content
  const existing = read(type, id);
  if (!existing) {
    return null;
  }

  const fromStatus = existing.status || 'draft';
  const toStatus = status;

  // Skip if status unchanged
  if (fromStatus === toStatus && !options.scheduledAt) {
    return existing;
  }

  // Check workflow options for this type (if defined)
  const typeInfo = contentTypes[type];
  const workflowOptions = typeInfo?.schema?._workflow;

  if (workflowOptions?.allowedTransitions) {
    const allowed = workflowOptions.allowedTransitions[fromStatus] || [];
    if (!allowed.includes(toStatus)) {
      throw new Error(
        `Cannot transition from "${fromStatus}" to "${toStatus}". ` +
        `Allowed: ${allowed.join(', ') || 'none'}`
      );
    }
  }

  // Fire beforeStatusChange hook
  const beforeCtx = { type, id, from: fromStatus, to: toStatus };
  await hooks.trigger('content:beforeStatusChange', beforeCtx);

  const now = new Date().toISOString();

  // PENDING REVISION PUBLISH:
  // When publishing and there are pending draft revisions, promote the
  // most recent pending draft to become the new default (live) version.
  // This is Feature #13: "Publish transition makes revision the new default"
  if (toStatus === 'published' && existing.status === 'published') {
    const pending = getPendingRevisions(type, id);
    if (pending.length > 0) {
      // Promote the most recent pending draft
      const published = await publishPendingRevision(type, id);
      return published;
    }
  }

  // Build update data
  const updateData = {
    status: toStatus,
  };

  // Handle publishedAt timestamp
  if (toStatus === 'published' && !existing.publishedAt) {
    updateData.publishedAt = now;
  }

  // PENDING REVISIONS: Set isDefaultRevision based on target status
  // WHY: When status changes, the isDefaultRevision flag must reflect
  // whether this version should be the public-facing default.
  updateData.isDefaultRevision = shouldBeDefaultRevision(toStatus, existing);

  // Handle scheduledAt for pending status
  if (toStatus === 'pending' && options.scheduledAt) {
    const scheduledDate = options.scheduledAt instanceof Date
      ? options.scheduledAt.toISOString()
      : options.scheduledAt;
    updateData.scheduledAt = scheduledDate;
  } else if (toStatus !== 'pending') {
    // Clear scheduledAt when not pending
    updateData.scheduledAt = null;
  }

  // Update the content
  const updated = await update(type, id, updateData);

  // Fire afterStatusChange hook
  await hooks.trigger('content:afterStatusChange', {
    type,
    id,
    from: fromStatus,
    to: toStatus,
    item: updated,
  });

  // Fire specific status hooks
  if (toStatus === 'published' && fromStatus !== 'published') {
    await hooks.trigger('content:published', { type, item: updated });
  } else if (fromStatus === 'published' && toStatus === 'draft') {
    await hooks.trigger('content:unpublished', { type, item: updated });
  }

  return updated;
}

/**
 * Publish content (shorthand for setStatus to published)
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @returns {Promise<Object|null>} - Updated content or null
 */
export async function publish(type, id) {
  return setStatus(type, id, 'published');
}

/**
 * Unpublish content (set to draft)
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @returns {Promise<Object|null>} - Updated content or null
 */
export async function unpublish(type, id) {
  return setStatus(type, id, 'draft');
}

/**
 * Archive content
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @returns {Promise<Object|null>} - Updated content or null
 */
export async function archive(type, id) {
  return setStatus(type, id, 'archived');
}

/**
 * Schedule content for future publishing
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {Date|string} publishDate - When to publish
 * @returns {Promise<Object|null>} - Updated content or null
 *
 * BEHAVIOR:
 * - Sets status to 'pending'
 * - Sets scheduledAt to the publish date
 * - Content will be auto-published when processScheduled() runs
 */
export async function schedulePublish(type, id, publishDate) {
  return setStatus(type, id, 'pending', { scheduledAt: publishDate });
}

/**
 * Get content filtered by status
 *
 * @param {string} type - Content type
 * @param {string} status - Status to filter by (or 'all' for all statuses)
 * @param {Object} options - Query options (same as list())
 * @returns {{ items: Array, total: number, page: number, limit: number, pages: number }}
 */
export function getByStatus(type, status, options = {}) {
  if (status === 'all') {
    return list(type, options);
  }

  return list(type, {
    ...options,
    filters: {
      ...options.filters,
      status,
    },
  });
}

/**
 * Process scheduled content (auto-publish items where scheduledAt <= now)
 *
 * @returns {Promise<Array<{type: string, id: string}>>} - List of published items
 *
 * BEHAVIOR:
 * - Finds all pending content with scheduledAt <= now
 * - Publishes each item
 * - Clears scheduledAt
 * - Fires content:published hook for each
 *
 * WHY SEPARATE FUNCTION:
 * - Called by scheduler on interval
 * - Can be run manually via CLI
 * - Testable in isolation
 */
export async function processScheduled() {
  const published = [];
  const now = new Date();

  // Check all content types
  for (const type of Object.keys(contentTypes)) {
    const pending = list(type, {
      limit: Number.MAX_SAFE_INTEGER,
      filters: {
        status: 'pending',
        'scheduledAt__lte': now.toISOString(),
      },
    });

    for (const item of pending.items) {
      if (!item.scheduledAt) continue;

      const scheduledDate = new Date(item.scheduledAt);
      if (scheduledDate <= now) {
        try {
          await publish(type, item.id);
          // Clear scheduledAt after publishing
          await update(type, item.id, { scheduledAt: null });
          published.push({ type, id: item.id, title: item.title || item.name || item.id });
          console.log(`[workflow] Auto-published ${type}/${item.id}`);
        } catch (error) {
          console.error(`[workflow] Failed to auto-publish ${type}/${item.id}: ${error.message}`);
        }
      }
    }
  }

  return published;
}

/**
 * List content for public API (only published, unless admin)
 *
 * @param {string} type - Content type
 * @param {Object} options - Query options
 * @param {boolean} options.includeAll - Include all statuses (admin mode)
 * @param {string} options.status - Filter by specific status
 * @returns {{ items: Array, total: number, page: number, limit: number, pages: number }}
 *
 * WHY SEPARATE FUNCTION:
 * - Public API should only return published content by default
 * - Admin API can request all statuses
 * - Encapsulates the workflow filtering logic
 */
export function listPublic(type, options = {}) {
  const { includeAll = false, status = null, ...queryOptions } = options;

  // If workflow is disabled, return all content
  if (!workflowEnabled) {
    return list(type, queryOptions);
  }

  // If includeAll is true, return based on status param or all
  if (includeAll) {
    if (status && status !== 'all') {
      return getByStatus(type, status, queryOptions);
    }
    return list(type, queryOptions);
  }

  // Default: only published content
  return getByStatus(type, 'published', queryOptions);
}

/**
 * Read content for public API (only if published)
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {Object} options - Read options
 * @param {boolean} options.includeAll - Include unpublished content
 * @returns {Object|null} - Content or null
 */
export function readPublic(type, id, options = {}) {
  const { includeAll = false, ...readOptions } = options;

  const item = read(type, id, readOptions);
  if (!item) return null;

  // If workflow disabled or includeAll, return as-is
  if (!workflowEnabled || includeAll) {
    return item;
  }

  // Only return if published
  if (item.status === 'published') {
    return item;
  }

  return null;
}

// ===========================================
// COMPUTED FIELDS FUNCTIONS
// ===========================================

/**
 * Initialize computed fields configuration
 *
 * @param {Object} config - Computed fields configuration
 * @param {boolean} config.computedFields - Whether computed fields are enabled (default: true)
 * @param {boolean} config.cacheComputed - Whether to cache computed values (default: false)
 */
export function initComputed(config = {}) {
  computedEnabled = config.computedFields !== false;
  cacheComputed = config.cacheComputed === true;
}

/**
 * Register a computed field for a content type
 *
 * @param {string} type - Content type name
 * @param {string} field - Field name for the computed value
 * @param {Function} compute - Function to compute the value: (item, context?) => value
 * @param {Object} options - Options
 * @param {boolean} options.async - Whether the compute function is async (default: auto-detected)
 *
 * WHY SEPARATE REGISTRY:
 * - Computed fields defined outside schema can be added by any module
 * - Allows plugins to add computed fields without modifying schemas
 * - Easy to list all computed fields for a type
 *
 * @example
 * registerComputed('article', 'wordCount', (item) => item.body?.split(/\s+/).length || 0);
 * registerComputed('article', 'readTime', (item) => Math.ceil((item.body?.split(/\s+/).length || 0) / 200) + ' min');
 * registerComputed('user', 'fullName', (item) => `${item.firstName} ${item.lastName}`);
 */
export function registerComputed(type, field, compute, options = {}) {
  if (!computedFields[type]) {
    computedFields[type] = {};
  }

  // Detect if function is async
  const isAsync = options.async ?? (compute.constructor.name === 'AsyncFunction');

  computedFields[type][field] = {
    compute,
    async: isAsync,
    source: options.source || 'hook',
  };
}

/**
 * Create a module-specific computed register function
 *
 * @param {string} moduleName - The module registering computed fields
 * @returns {Function} - register(type, field, compute)
 */
export function createComputedRegister(moduleName) {
  return function registerForModule(type, field, compute, options = {}) {
    registerComputed(type, field, compute, { ...options, source: moduleName });
  };
}

/**
 * Extract computed field definitions from a schema
 *
 * @param {Object} schema - Content type schema
 * @returns {Object} - Map of field names to compute functions
 * @private
 *
 * WHY EXTRACT FROM SCHEMA:
 * - Allows computed fields to be defined inline with schema
 * - More convenient for simple computed fields
 * - Keeps schema as single source of truth for type definition
 */
function extractSchemaComputedFields(schema) {
  const fields = {};

  for (const [fieldName, fieldDef] of Object.entries(schema)) {
    if (fieldDef.type === 'computed' && typeof fieldDef.compute === 'function') {
      const isAsync = fieldDef.async ?? (fieldDef.compute.constructor.name === 'AsyncFunction');
      fields[fieldName] = {
        compute: fieldDef.compute,
        async: isAsync,
        source: 'schema',
      };
    }
  }

  return fields;
}

/**
 * Get all computed fields for a content type
 *
 * @param {string} type - Content type name
 * @returns {Object} - Map of field names to compute info { compute, async, source }
 *
 * MERGES:
 * - Schema-defined computed fields (type: 'computed' with compute function)
 * - Hook-registered computed fields (via registerComputed)
 * - Hook-registered fields take precedence if same name
 */
export function getComputedFields(type) {
  const result = {};

  // First, get schema-defined computed fields
  const typeInfo = contentTypes[type];
  if (typeInfo?.schema) {
    const schemaComputed = extractSchemaComputedFields(typeInfo.schema);
    Object.assign(result, schemaComputed);
  }

  // Then, merge hook-registered computed fields (these take precedence)
  if (computedFields[type]) {
    Object.assign(result, computedFields[type]);
  }

  return result;
}

/**
 * Check if a content type has computed fields
 *
 * @param {string} type - Content type name
 * @returns {boolean}
 */
export function hasComputedFields(type) {
  return Object.keys(getComputedFields(type)).length > 0;
}

/**
 * Resolve computed fields for a content item
 *
 * @param {Object} item - Content item
 * @param {Object} options - Options
 * @param {string[]} options.fields - Specific fields to compute (default: all)
 * @param {Object} options.context - Context passed to compute functions
 * @param {boolean} options.markComputed - Add _computed marker to computed fields (default: false)
 * @returns {Promise<Object>} - Item with computed fields added
 *
 * BEHAVIOR:
 * - Computes all computed fields for the item's type
 * - Returns a new object (doesn't mutate input)
 * - Async compute functions are awaited
 * - Errors in compute functions are caught and field is set to null
 *
 * @example
 * const article = read('article', 'abc123');
 * const withComputed = await resolveComputed(article);
 * console.log(withComputed.wordCount); // 450
 * console.log(withComputed.readTime);  // "3 min"
 */
export async function resolveComputed(item, options = {}) {
  if (!item || !item.type) {
    return item;
  }

  if (!computedEnabled) {
    return item;
  }

  const {
    fields: requestedFields = null,
    context = null,
    markComputed = false,
  } = options;

  const allComputed = getComputedFields(item.type);

  if (Object.keys(allComputed).length === 0) {
    return item;
  }

  // Create a copy to avoid mutating the original
  const result = { ...item };
  const computedMarkers = {};

  // Determine which fields to compute
  const fieldsToCompute = requestedFields
    ? requestedFields.filter(f => allComputed[f])
    : Object.keys(allComputed);

  for (const fieldName of fieldsToCompute) {
    const fieldDef = allComputed[fieldName];

    try {
      // Compute the value
      let value;
      if (fieldDef.async) {
        value = await fieldDef.compute(item, context);
      } else {
        value = fieldDef.compute(item, context);
      }

      result[fieldName] = value;

      if (markComputed) {
        computedMarkers[fieldName] = true;
      }
    } catch (error) {
      console.error(`[content] Error computing field "${fieldName}" for ${item.type}/${item.id}: ${error.message}`);
      result[fieldName] = null;

      if (markComputed) {
        computedMarkers[fieldName] = true;
      }
    }
  }

  // Add computed marker if requested
  if (markComputed && Object.keys(computedMarkers).length > 0) {
    result._computed = computedMarkers;
  }

  return result;
}

/**
 * Resolve computed fields for multiple items
 *
 * @param {Object[]} items - Array of content items
 * @param {Object} options - Same options as resolveComputed
 * @returns {Promise<Object[]>} - Items with computed fields
 */
export async function resolveComputedBatch(items, options = {}) {
  if (!items || items.length === 0) {
    return items;
  }

  if (!computedEnabled) {
    return items;
  }

  // Process all items in parallel for better performance
  return Promise.all(items.map(item => resolveComputed(item, options)));
}

/**
 * Get computed field value for a specific item and field
 *
 * @param {Object} item - Content item
 * @param {string} field - Field name
 * @param {Object} context - Context passed to compute function
 * @returns {Promise<*>} - Computed value
 */
export async function getComputedValue(item, field, context = null) {
  if (!item || !item.type) {
    return null;
  }

  const allComputed = getComputedFields(item.type);
  const fieldDef = allComputed[field];

  if (!fieldDef) {
    return undefined;
  }

  try {
    if (fieldDef.async) {
      return await fieldDef.compute(item, context);
    }
    return fieldDef.compute(item, context);
  } catch (error) {
    console.error(`[content] Error computing "${field}" for ${item.type}/${item.id}: ${error.message}`);
    return null;
  }
}

/**
 * Get computed fields configuration
 *
 * @returns {{ enabled: boolean, cacheComputed: boolean }}
 */
export function getComputedConfig() {
  return {
    enabled: computedEnabled,
    cacheComputed,
  };
}

/**
 * Clear all registered computed fields (mainly for testing)
 */
export function clearComputedFields() {
  for (const key of Object.keys(computedFields)) {
    delete computedFields[key];
  }
}

// ============================================
// SLUG SYSTEM
// ============================================

/**
 * Initialize slug system configuration
 *
 * @param {Object} config - Slug configuration
 * @param {boolean} config.enabled - Whether slugs are enabled (default: true)
 * @param {string} config.separator - Slug word separator (default: '-')
 * @param {number} config.maxLength - Maximum slug length (default: 100)
 * @param {boolean} config.redirectOld - Redirect old slugs (default: true)
 * @param {number} config.historyLimit - Max old slugs to keep (default: 10)
 */
export function initSlugs(config = {}) {
  slugsEnabled = config.enabled !== false;
  slugSeparator = config.separator || '-';
  slugMaxLength = config.maxLength || 100;
  slugRedirectOld = config.redirectOld !== false;
  slugHistoryLimit = config.historyLimit || 10;
}

/**
 * Get slug configuration
 *
 * @returns {Object} Current slug configuration
 */
export function getSlugsConfig() {
  return {
    enabled: slugsEnabled,
    separator: slugSeparator,
    maxLength: slugMaxLength,
    redirectOld: slugRedirectOld,
    historyLimit: slugHistoryLimit,
  };
}

/**
 * Build slug index for a content type
 *
 * @param {string} type - Content type name
 * @private
 *
 * WHY REBUILD INDEX:
 * - On startup, we need to know all existing slugs
 * - After external file changes (e.g., manual edits)
 * - To ensure consistency
 */
function buildSlugIndex(type) {
  slugIndex[type] = {};
  slugHistoryIndex[type] = {};

  const typeDir = join(contentDir, type);
  if (!existsSync(typeDir)) {
    return;
  }

  const files = readdirSync(typeDir).filter(f => f.endsWith('.json') && !f.startsWith('.'));

  for (const file of files) {
    try {
      const filePath = join(typeDir, file);
      const content = JSON.parse(readFileSync(filePath, 'utf-8'));

      if (content.slug) {
        slugIndex[type][content.slug] = content.id;

        // Index slug history for redirects
        if (Array.isArray(content._slugHistory)) {
          for (const oldSlug of content._slugHistory) {
            slugHistoryIndex[type][oldSlug] = content.slug;
          }
        }
      }
    } catch (error) {
      // Skip invalid files
    }
  }
}

/**
 * Ensure slug index exists for a type
 *
 * @param {string} type - Content type name
 * @private
 */
function ensureSlugIndex(type) {
  if (!slugIndex[type]) {
    buildSlugIndex(type);
  }
}

/**
 * Check if a slug exists for a content type
 *
 * @param {string} type - Content type name
 * @param {string} slug - Slug to check
 * @param {string} excludeId - Exclude this ID from check (for updates)
 * @returns {boolean} True if slug exists
 */
export function slugExists(type, slug, excludeId = null) {
  ensureSlugIndex(type);
  const existingId = slugIndex[type]?.[slug];
  return existingId && existingId !== excludeId;
}

/**
 * Get content item by slug
 *
 * @param {string} type - Content type name
 * @param {string} slug - Slug to look up
 * @param {Object} options - Read options (same as read())
 * @returns {Object|null} Content item or null if not found
 *
 * WHY SEPARATE FROM read():
 * - read() uses ID, getBySlug() uses slug
 * - Different lookup mechanism (index vs direct file)
 * - Clearer API intent
 *
 * @example
 * const article = getBySlug('article', 'hello-world');
 */
export function getBySlug(type, slug, options = {}) {
  if (!slugsEnabled || !slug) {
    return null;
  }

  ensureSlugIndex(type);

  const id = slugIndex[type]?.[slug];
  if (!id) {
    return null;
  }

  return read(type, id, options);
}

/**
 * Resolve a permalink - find content by slug with redirect support
 *
 * @param {string} type - Content type name
 * @param {string} slug - Slug to resolve
 * @returns {Object} Result with item or redirect info
 *
 * RETURNS:
 * - { found: true, item: {...} } - Found by current slug
 * - { found: true, redirect: true, currentSlug: '...' } - Old slug, should redirect
 * - { found: false } - Not found
 *
 * @example
 * const result = resolvePermalink('article', 'old-title');
 * if (result.redirect) {
 *   res.redirect(301, `/article/${result.currentSlug}`);
 * } else if (result.found) {
 *   render(result.item);
 * } else {
 *   notFound();
 * }
 */
export function resolvePermalink(type, slug) {
  if (!slugsEnabled || !slug) {
    return { found: false };
  }

  ensureSlugIndex(type);

  // Check current slugs first
  const id = slugIndex[type]?.[slug];
  if (id) {
    const item = read(type, id);
    return item ? { found: true, item } : { found: false };
  }

  // Check slug history for redirects
  if (slugRedirectOld) {
    const currentSlug = slugHistoryIndex[type]?.[slug];
    if (currentSlug) {
      return { found: true, redirect: true, currentSlug };
    }
  }

  return { found: false };
}

/**
 * Generate a slug for a content item
 *
 * @param {string} type - Content type name
 * @param {Object} data - Content data
 * @param {Object} schema - Content type schema
 * @param {string} excludeId - ID to exclude from uniqueness check (for updates)
 * @returns {Promise<string|null>} Generated slug or null if no slug field
 * @private
 */
async function generateSlugForContent(type, data, schema, excludeId = null) {
  // Find slug field in schema
  const slugField = Object.entries(schema).find(([_, def]) => def.type === 'slug');
  if (!slugField) {
    return null;
  }

  const [fieldName, fieldDef] = slugField;

  // If slug is already provided and valid, use it
  if (data[fieldName]) {
    const validation = validateSlug(data[fieldName], {
      separator: slugSeparator,
      maxLength: slugMaxLength,
    });
    if (validation.valid) {
      // Check uniqueness
      if (fieldDef.unique !== false && slugExists(type, data[fieldName], excludeId)) {
        // Generate unique version
        return generateUniqueSlug(data[fieldName], (s) => slugExists(type, s, excludeId));
      }
      return data[fieldName];
    }
  }

  // Auto-generate from source field
  const sourceField = fieldDef.from || 'title';
  const sourceValue = data[sourceField];

  if (!sourceValue) {
    return null;
  }

  // Generate base slug
  const baseSlug = slugify(sourceValue, {
    separator: slugSeparator,
    maxLength: slugMaxLength,
  });

  if (!baseSlug) {
    return null;
  }

  // Ensure uniqueness if required
  if (fieldDef.unique !== false) {
    return generateUniqueSlug(baseSlug, (s) => slugExists(type, s, excludeId));
  }

  return baseSlug;
}

/**
 * Update slug index when content is created or updated
 *
 * @param {string} type - Content type name
 * @param {Object} item - Content item with slug
 * @param {string} oldSlug - Previous slug (for updates)
 * @private
 */
function updateSlugIndex(type, item, oldSlug = null) {
  ensureSlugIndex(type);

  // Remove old slug from index
  if (oldSlug && slugIndex[type]?.[oldSlug] === item.id) {
    delete slugIndex[type][oldSlug];
  }

  // Add current slug to index
  if (item.slug) {
    slugIndex[type][item.slug] = item.id;
  }

  // Update history index
  if (Array.isArray(item._slugHistory)) {
    for (const histSlug of item._slugHistory) {
      slugHistoryIndex[type][histSlug] = item.slug;
    }
  }
}

/**
 * Remove content from slug index
 *
 * @param {string} type - Content type name
 * @param {Object} item - Content item being removed
 * @private
 */
function removeFromSlugIndex(type, item) {
  if (!item) return;

  ensureSlugIndex(type);

  // Remove current slug
  if (item.slug && slugIndex[type]?.[item.slug] === item.id) {
    delete slugIndex[type][item.slug];
  }

  // Remove history entries
  if (Array.isArray(item._slugHistory)) {
    for (const histSlug of item._slugHistory) {
      if (slugHistoryIndex[type]?.[histSlug] === item.slug) {
        delete slugHistoryIndex[type][histSlug];
      }
    }
  }
}

/**
 * Get slug and history for a content item
 *
 * @param {string} type - Content type name
 * @param {string} id - Content ID
 * @returns {Object|null} { slug, history } or null if not found
 */
export function getSlugInfo(type, id) {
  const item = read(type, id);
  if (!item) {
    return null;
  }

  return {
    slug: item.slug || null,
    history: item._slugHistory || [],
  };
}

/**
 * List all slugs for a content type
 *
 * @param {string} type - Content type name
 * @returns {Array<Object>} Array of { slug, id, history }
 */
export function listSlugs(type) {
  if (!hasType(type)) {
    return [];
  }

  ensureSlugIndex(type);

  const items = listAll(type);
  return items
    .filter(item => item.slug)
    .map(item => ({
      slug: item.slug,
      id: item.id,
      history: item._slugHistory || [],
    }));
}

/**
 * Regenerate missing slugs for a content type
 *
 * @param {string} type - Content type name
 * @returns {Promise<Object>} { fixed: number, errors: Array }
 */
export async function regenerateMissingSlugs(type) {
  if (!hasType(type)) {
    return { fixed: 0, errors: [{ id: null, error: 'Unknown content type' }] };
  }

  const schema = getSchema(type);
  const slugField = Object.entries(schema).find(([_, def]) => def.type === 'slug');

  if (!slugField) {
    return { fixed: 0, errors: [{ id: null, error: 'No slug field in schema' }] };
  }

  const [fieldName] = slugField;
  const items = listAll(type);
  const results = { fixed: 0, errors: [] };

  for (const item of items) {
    if (item[fieldName]) {
      continue; // Already has slug
    }

    try {
      const newSlug = await generateSlugForContent(type, item, schema, item.id);
      if (newSlug) {
        await update(type, item.id, { [fieldName]: newSlug });
        results.fixed++;
      }
    } catch (error) {
      results.errors.push({ id: item.id, error: error.message });
    }
  }

  return results;
}

/**
 * Find duplicate or invalid slugs
 *
 * @param {string} type - Content type name (optional, checks all if not provided)
 * @returns {Object} { duplicates: [...], invalid: [...] }
 */
export function checkSlugs(type = null) {
  const types = type ? [type] : listTypes().map(t => t.type);
  const results = { duplicates: [], invalid: [] };

  for (const t of types) {
    ensureSlugIndex(t);

    // Check for duplicates (shouldn't happen with proper index, but check anyway)
    const slugCounts = {};
    const items = listAll(t);

    for (const item of items) {
      if (item.slug) {
        slugCounts[item.slug] = (slugCounts[item.slug] || 0) + 1;

        // Validate slug format
        const validation = validateSlug(item.slug, {
          separator: slugSeparator,
          maxLength: slugMaxLength,
        });

        if (!validation.valid) {
          results.invalid.push({
            type: t,
            id: item.id,
            slug: item.slug,
            errors: validation.errors,
          });
        }
      }
    }

    // Find duplicates
    for (const [slug, count] of Object.entries(slugCounts)) {
      if (count > 1) {
        const ids = items.filter(i => i.slug === slug).map(i => i.id);
        results.duplicates.push({ type: t, slug, count, ids });
      }
    }
  }

  return results;
}

/**
 * Check if a type has a slug field in its schema
 *
 * @param {string} type - Content type name
 * @returns {boolean} True if type has slug field
 */
export function hasSlugField(type) {
  if (!hasType(type)) {
    return false;
  }

  const schema = getSchema(type);
  return Object.values(schema).some(def => def.type === 'slug');
}

/**
 * Get the slug field definition for a type
 *
 * @param {string} type - Content type name
 * @returns {Object|null} Slug field definition or null
 */
export function getSlugFieldDef(type) {
  if (!hasType(type)) {
    return null;
  }

  const schema = getSchema(type);
  const entry = Object.entries(schema).find(([_, def]) => def.type === 'slug');
  return entry ? { name: entry[0], ...entry[1] } : null;
}

/**
 * Clear slug indexes (mainly for testing)
 */
export function clearSlugIndexes() {
  for (const key of Object.keys(slugIndex)) {
    delete slugIndex[key];
  }
  for (const key of Object.keys(slugHistoryIndex)) {
    delete slugHistoryIndex[key];
  }
}

// ============================================
// TRASH SYSTEM
// ============================================

/**
 * Initialize trash system configuration
 *
 * @param {Object} config - Trash configuration
 * @param {boolean} config.enabled - Whether trash is enabled (default: true)
 * @param {number} config.retention - Days to keep trashed items (default: 30)
 * @param {boolean} config.autoPurge - Auto-purge old items (default: true)
 */
export function initTrash(config = {}) {
  trashEnabled = config.enabled !== false;
  trashRetentionDays = config.retention || 30;
  trashAutoPurge = config.autoPurge !== false;
}

/**
 * Get trash configuration
 *
 * @returns {Object} Current trash configuration
 */
export function getTrashConfig() {
  return {
    enabled: trashEnabled,
    retention: trashRetentionDays,
    autoPurge: trashAutoPurge,
  };
}

/**
 * Get the trash directory path
 *
 * @returns {string} Path to trash directory
 */
function getTrashDir() {
  return join(contentDir, '.trash');
}

/**
 * Get the trash directory path for a content type
 *
 * @param {string} type - Content type name
 * @returns {string} Path to type's trash directory
 */
function getTrashTypeDir(type) {
  return join(getTrashDir(), type);
}

/**
 * Get the trash file path for an item
 *
 * @param {string} type - Content type name
 * @param {string} id - Content ID
 * @returns {string} Path to trashed item file
 */
function getTrashPath(type, id) {
  return join(getTrashTypeDir(type), `${id}.json`);
}

/**
 * Ensure trash directory exists for a type
 *
 * @param {string} type - Content type name
 */
function ensureTrashDir(type) {
  const trashTypeDir = getTrashTypeDir(type);
  if (!existsSync(trashTypeDir)) {
    mkdirSync(trashTypeDir, { recursive: true });
  }
  return trashTypeDir;
}

/**
 * Move content item to trash
 *
 * @param {string} type - Content type name
 * @param {string} id - Content ID
 * @param {Object} item - Content item to trash
 * @param {string} trashedBy - User/actor who deleted (optional)
 * @returns {Promise<Object>} Trashed item
 * @private
 */
async function moveToTrash(type, id, item, trashedBy = null) {
  ensureTrashDir(type);

  const trashedItem = {
    ...item,
    _trashedAt: new Date().toISOString(),
    _trashedBy: trashedBy,
    _originalPath: getContentPath(type, id),
  };

  const trashPath = getTrashPath(type, id);
  writeFileSync(trashPath, JSON.stringify(trashedItem, null, 2) + '\n');

  // Remove original file
  const originalPath = getContentPath(type, id);
  if (existsSync(originalPath)) {
    unlinkSync(originalPath);
  }

  // Fire trash hook
  await hooks.trigger('content:trashed', { type, id, item: trashedItem });

  return trashedItem;
}

/**
 * Restore content item from trash
 *
 * @param {string} type - Content type name
 * @param {string} id - Content ID
 * @returns {Promise<Object|null>} Restored item or null if not found
 *
 * @example
 * const item = await restore('article', 'abc123');
 */
export async function restore(type, id) {
  const trashPath = getTrashPath(type, id);

  if (!existsSync(trashPath)) {
    return null;
  }

  try {
    const trashedItem = JSON.parse(readFileSync(trashPath, 'utf-8'));

    // Remove trash metadata
    const { _trashedAt, _trashedBy, _originalPath, ...item } = trashedItem;

    // Update timestamps
    item.updated = new Date().toISOString();

    // Ensure type directory exists
    ensureTypeDir(type);

    // Write back to original location
    const filePath = getContentPath(type, id);
    writeFileSync(filePath, JSON.stringify(item, null, 2) + '\n');

    // Remove from trash
    unlinkSync(trashPath);

    // Update slug index if applicable
    if (slugsEnabled && item.slug) {
      updateSlugIndex(type, item);
    }

    // Invalidate cache
    if (cacheEnabled) {
      cache.clear(`content:${type}:list:*`);
    }

    // Fire restore hook
    await hooks.trigger('content:restored', { type, id, item });

    return item;
  } catch (error) {
    console.error(`[content] Failed to restore ${type}/${id}: ${error.message}`);
    return null;
  }
}

/**
 * Permanently delete item from trash
 *
 * @param {string} type - Content type name
 * @param {string} id - Content ID
 * @returns {Promise<boolean>} True if purged, false if not found
 *
 * @example
 * await purge('article', 'abc123');
 */
export async function purge(type, id) {
  const trashPath = getTrashPath(type, id);

  if (!existsSync(trashPath)) {
    return false;
  }

  try {
    // Fire before purge hook
    await hooks.trigger('content:beforePurge', { type, id });

    unlinkSync(trashPath);

    // Fire after purge hook
    await hooks.trigger('content:afterPurge', { type, id });

    return true;
  } catch (error) {
    console.error(`[content] Failed to purge ${type}/${id}: ${error.message}`);
    return false;
  }
}

/**
 * Get a single trashed item
 *
 * @param {string} type - Content type name
 * @param {string} id - Content ID
 * @returns {Object|null} Trashed item or null
 */
export function getTrash(type, id) {
  const trashPath = getTrashPath(type, id);

  if (!existsSync(trashPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(trashPath, 'utf-8'));
  } catch (error) {
    return null;
  }
}

/**
 * List trashed items
 *
 * @param {string} type - Content type (optional, lists all if not provided)
 * @param {Object} options - List options
 * @param {number} options.limit - Max items to return
 * @param {number} options.olderThanDays - Only items older than N days
 * @returns {Array<Object>} Array of trashed items with metadata
 *
 * @example
 * const allTrash = listTrash();
 * const articleTrash = listTrash('article');
 * const oldTrash = listTrash(null, { olderThanDays: 20 });
 */
export function listTrash(type = null, options = {}) {
  const { limit = 0, olderThanDays = 0 } = options;
  const trashDir = getTrashDir();
  const items = [];

  if (!existsSync(trashDir)) {
    return items;
  }

  const types = type ? [type] : readdirSync(trashDir).filter(d => {
    const fullPath = join(trashDir, d);
    return statSync(fullPath).isDirectory();
  });

  const cutoffDate = olderThanDays > 0
    ? new Date(Date.now() - (olderThanDays * 24 * 60 * 60 * 1000))
    : null;

  for (const t of types) {
    const typeTrashDir = getTrashTypeDir(t);
    if (!existsSync(typeTrashDir)) continue;

    const files = readdirSync(typeTrashDir).filter(f => f.endsWith('.json'));

    for (const file of files) {
      try {
        const filePath = join(typeTrashDir, file);
        const item = JSON.parse(readFileSync(filePath, 'utf-8'));

        // Filter by age if specified
        if (cutoffDate && item._trashedAt) {
          const trashedDate = new Date(item._trashedAt);
          if (trashedDate >= cutoffDate) continue;
        }

        // Calculate days in trash
        const trashedDate = new Date(item._trashedAt);
        const daysInTrash = Math.floor((Date.now() - trashedDate.getTime()) / (24 * 60 * 60 * 1000));
        const daysRemaining = Math.max(0, trashRetentionDays - daysInTrash);

        items.push({
          ...item,
          _daysInTrash: daysInTrash,
          _daysRemaining: daysRemaining,
          _willAutoPurge: trashAutoPurge && daysRemaining === 0,
        });
      } catch (error) {
        // Skip invalid files
      }
    }
  }

  // Sort by trashed date (newest first)
  items.sort((a, b) => new Date(b._trashedAt) - new Date(a._trashedAt));

  // Apply limit
  if (limit > 0) {
    return items.slice(0, limit);
  }

  return items;
}

/**
 * Empty trash for a type or all types
 *
 * @param {string} type - Content type (optional, empties all if not provided)
 * @param {Object} options - Options
 * @param {number} options.olderThanDays - Only purge items older than N days
 * @returns {Promise<Object>} { purged: number, errors: Array }
 *
 * @example
 * await emptyTrash(); // Empty all
 * await emptyTrash('article'); // Empty only articles
 * await emptyTrash(null, { olderThanDays: 30 }); // Purge items > 30 days
 */
export async function emptyTrash(type = null, options = {}) {
  const { olderThanDays = 0 } = options;
  const items = listTrash(type, { olderThanDays });
  const results = { purged: 0, errors: [] };

  for (const item of items) {
    try {
      const success = await purge(item.type, item.id);
      if (success) {
        results.purged++;
      }
    } catch (error) {
      results.errors.push({ type: item.type, id: item.id, error: error.message });
    }
  }

  return results;
}

/**
 * Get trash statistics
 *
 * @returns {Object} Trash statistics
 */
export function getTrashStats() {
  const items = listTrash();
  const byType = {};
  let oldestDays = 0;

  for (const item of items) {
    byType[item.type] = (byType[item.type] || 0) + 1;
    if (item._daysInTrash > oldestDays) {
      oldestDays = item._daysInTrash;
    }
  }

  const autoPurgeIn = trashAutoPurge && items.length > 0
    ? Math.max(0, trashRetentionDays - oldestDays)
    : null;

  return {
    total: items.length,
    byType,
    oldestDays,
    autoPurgeIn,
    retention: trashRetentionDays,
    autoPurgeEnabled: trashAutoPurge,
  };
}

/**
 * Auto-purge old items (called by scheduled task)
 *
 * @returns {Promise<Object>} { purged: number, errors: Array }
 */
export async function autoPurgeTrash() {
  if (!trashAutoPurge) {
    return { purged: 0, errors: [], skipped: true };
  }

  return emptyTrash(null, { olderThanDays: trashRetentionDays });
}

/**
 * Check if item exists in trash
 *
 * @param {string} type - Content type name
 * @param {string} id - Content ID
 * @returns {boolean} True if in trash
 */
export function isInTrash(type, id) {
  return existsSync(getTrashPath(type, id));
}

// ============================================
// CLONE SYSTEM
// ============================================

/**
 * Clone configuration
 * Set during initClone()
 */
let clonePrefix = 'Copy of ';
let cloneDeepDefault = false;

/**
 * Initialize clone system configuration
 *
 * @param {Object} config - Clone configuration
 * @param {string} config.clonePrefix - Default title prefix (default: "Copy of ")
 * @param {boolean} config.cloneDeep - Default deep clone setting (default: false)
 */
export function initClone(config = {}) {
  clonePrefix = config.clonePrefix !== undefined ? config.clonePrefix : 'Copy of ';
  cloneDeepDefault = config.cloneDeep === true;
}

/**
 * Get clone configuration
 *
 * @returns {Object} Current clone configuration
 */
export function getCloneConfig() {
  return {
    prefix: clonePrefix,
    deepDefault: cloneDeepDefault,
  };
}

/**
 * Clone a content item
 *
 * @param {string} type - Content type name
 * @param {string} id - Content ID to clone
 * @param {Object} options - Clone options
 * @param {string} options.prefix - Title/name prefix (default: "Copy of ")
 * @param {string} options.suffix - Title/name suffix (default: "")
 * @param {Object} options.fields - Field overrides to apply
 * @param {boolean} options.deep - Clone referenced items (default: false)
 * @param {boolean} options.includeTranslations - Include _translations (default: false)
 * @param {Set} options._clonedIds - Internal: track cloned IDs to prevent cycles
 * @returns {Promise<Object>} The cloned item with new ID
 *
 * CLONE BEHAVIOR:
 * - Generate new ID
 * - Set created/updated to now
 * - Prefix title/name with configurable prefix
 * - Generate new unique slug if slug field exists
 * - Reset workflow status to draft
 * - Do not copy _revisions or _slugHistory
 *
 * @example
 * // Simple clone
 * const clone = await content.clone('article', 'abc123');
 *
 * // Clone with custom title
 * const clone = await content.clone('article', 'abc123', {
 *   prefix: '',
 *   fields: { title: 'New Article' }
 * });
 *
 * // Deep clone with related media
 * const clone = await content.clone('article', 'abc123', { deep: true });
 */
export async function clone(type, id, options = {}) {
  const {
    prefix = clonePrefix,
    suffix = '',
    fields = {},
    deep = cloneDeepDefault,
    includeTranslations = false,
    _clonedIds = new Set(),
  } = options;

  // Read original item
  const original = read(type, id);
  if (!original) {
    throw new Error(`Content not found: ${type}/${id}`);
  }

  // Prevent circular cloning in deep mode
  const cloneKey = `${type}:${id}`;
  if (_clonedIds.has(cloneKey)) {
    return null; // Already cloned in this operation
  }
  _clonedIds.add(cloneKey);

  const schema = getSchema(type);

  // Build clone data, excluding system fields
  const cloneData = {};
  for (const [key, value] of Object.entries(original)) {
    // Skip system fields
    if (['id', 'type', 'created', 'updated'].includes(key)) continue;

    // Skip revision/history fields
    if (key === '_revisions' || key === '_slugHistory') continue;

    // Skip translations unless requested
    if (key === '_translations' && !includeTranslations) continue;

    // Skip trash metadata
    if (key.startsWith('_trashed')) continue;

    cloneData[key] = value;
  }

  // Find title/name field for prefixing
  const titleField = findTitleField(schema, cloneData);
  if (titleField && cloneData[titleField]) {
    cloneData[titleField] = `${prefix}${cloneData[titleField]}${suffix}`;
  }

  // Handle slug field - will be regenerated
  const slugFieldEntry = Object.entries(schema).find(([_, def]) => def.type === 'slug');
  if (slugFieldEntry) {
    // Remove existing slug so it gets regenerated from new title
    delete cloneData[slugFieldEntry[0]];
  }

  // Reset workflow status to draft
  if (workflowEnabled && cloneData.status) {
    cloneData.status = 'draft';
    delete cloneData.publishedAt;
    delete cloneData.scheduledAt;
  }

  // Apply field overrides
  Object.assign(cloneData, fields);

  // Handle deep clone - clone referenced items
  let clonedReferences = [];
  if (deep) {
    const relationFields = getRelationFields(type);
    for (const { field, target, relation } of relationFields) {
      const refValue = cloneData[field];
      if (!refValue) continue;

      if (relation === 'belongsTo' && typeof refValue === 'string') {
        // Clone single reference
        try {
          const clonedRef = await clone(target, refValue, {
            prefix,
            suffix,
            deep: true,
            includeTranslations,
            _clonedIds,
          });
          if (clonedRef) {
            cloneData[field] = clonedRef.id;
            clonedReferences.push({ type: target, original: refValue, clone: clonedRef.id });
          }
        } catch (err) {
          // Keep original reference if clone fails
          console.warn(`[content] Could not clone referenced ${target}/${refValue}: ${err.message}`);
        }
      } else if (relation === 'belongsToMany' && Array.isArray(refValue)) {
        // Clone multiple references
        const newRefs = [];
        for (const refId of refValue) {
          try {
            const clonedRef = await clone(target, refId, {
              prefix,
              suffix,
              deep: true,
              includeTranslations,
              _clonedIds,
            });
            if (clonedRef) {
              newRefs.push(clonedRef.id);
              clonedReferences.push({ type: target, original: refId, clone: clonedRef.id });
            } else {
              newRefs.push(refId); // Keep original if already cloned
            }
          } catch (err) {
            newRefs.push(refId); // Keep original if clone fails
            console.warn(`[content] Could not clone referenced ${target}/${refId}: ${err.message}`);
          }
        }
        cloneData[field] = newRefs;
      }
    }
  }

  // Create the clone
  const clonedItem = await create(type, cloneData);

  // Fire clone hook
  await hooks.trigger('content:cloned', {
    type,
    originalId: id,
    cloneId: clonedItem.id,
    item: clonedItem,
    deep,
    clonedReferences,
  });

  // Attach metadata for caller
  clonedItem._cloneSource = { type, id };
  if (clonedReferences.length > 0) {
    clonedItem._clonedReferences = clonedReferences;
  }

  return clonedItem;
}

/**
 * Find the title/name field in a schema
 *
 * @param {Object} schema - Content type schema
 * @param {Object} data - Content data
 * @returns {string|null} Field name or null
 * @private
 */
function findTitleField(schema, data) {
  // Check common title field names in order of preference
  const titleFields = ['title', 'name', 'label', 'subject', 'heading'];

  for (const field of titleFields) {
    if (schema[field] && data[field]) {
      return field;
    }
  }

  // Fall back to first string field
  for (const [field, def] of Object.entries(schema)) {
    if (def.type === 'string' && data[field]) {
      return field;
    }
  }

  return null;
}

/**
 * Get cloneable references for a content item
 *
 * @param {string} type - Content type name
 * @param {string} id - Content ID
 * @returns {Array<{field: string, type: string, ids: string[]}>} Cloneable references
 *
 * Useful for showing user how many items will be cloned in deep mode.
 */
export function getCloneableReferences(type, id) {
  const item = read(type, id);
  if (!item) return [];

  const relationFields = getRelationFields(type);
  const refs = [];

  for (const { field, target, relation } of relationFields) {
    const value = item[field];
    if (!value) continue;

    if (relation === 'belongsTo' && typeof value === 'string') {
      refs.push({ field, type: target, ids: [value] });
    } else if (relation === 'belongsToMany' && Array.isArray(value) && value.length > 0) {
      refs.push({ field, type: target, ids: value });
    }
  }

  return refs;
}

/**
 * Count total items that would be cloned in deep mode
 *
 * @param {string} type - Content type name
 * @param {string} id - Content ID
 * @returns {number} Total count including the item itself
 */
export function countDeepCloneItems(type, id) {
  const refs = getCloneableReferences(type, id);
  let count = 1; // The item itself

  for (const ref of refs) {
    count += ref.ids.length;
  }

  return count;
}

// ==========================================
// Content Locking
// ==========================================

/**
 * Initialize content locking system
 *
 * @param {Object} config - Lock configuration
 * @param {boolean} config.enabled - Enable locking (default: true)
 * @param {number} config.timeout - Lock timeout in seconds (default: 1800)
 * @param {number} config.gracePeriod - Grace period in seconds (default: 60)
 */
export function initLocks(config = {}) {
  locks.init({
    ...config,
    contentDir,
  });
}

/**
 * Acquire a lock on content
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {string} userId - User ID
 * @param {object} options - Options { username, timeout }
 * @returns {object|null} Lock object or null if failed
 */
export function acquireLock(type, id, userId, options = {}) {
  return locks.acquireLock(type, id, userId, options);
}

/**
 * Release a lock
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {string} userId - User ID
 * @returns {boolean} True if released
 */
export function releaseLock(type, id, userId) {
  return locks.releaseLock(type, id, userId);
}

/**
 * Check lock status
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @returns {object} Lock status
 */
export function checkLock(type, id) {
  return locks.checkLock(type, id);
}

/**
 * Refresh/extend a lock
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {string} userId - User ID
 * @returns {object|null} Updated lock or null if failed
 */
export function refreshLock(type, id, userId) {
  return locks.refreshLock(type, id, userId);
}

/**
 * Force release a lock (admin only)
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @returns {object|null} Released lock or null
 */
export function forceReleaseLock(type, id) {
  return locks.forceRelease(type, id);
}

/**
 * List all active locks
 * @param {string} [type] - Optional type filter
 * @returns {Array} Array of lock objects
 */
export function listLocks(type = null) {
  return locks.listLocks(type);
}

/**
 * Clean up expired locks
 * @returns {number} Number removed
 */
export function cleanupExpiredLocks() {
  return locks.cleanupExpired();
}

/**
 * Get lock statistics
 * @returns {object} Stats
 */
export function getLockStats() {
  return locks.getStats();
}

/**
 * Get lock configuration
 * @returns {object} Config
 */
export function getLockConfig() {
  return locks.getConfig();
}

// ==========================================
// Bulk Operations
// ==========================================

/**
 * Bulk update multiple items
 *
 * @param {string} type - Content type
 * @param {Array<string>} ids - Array of item IDs
 * @param {object} data - Data to update on all items
 * @param {object} options - Options { skipHooks, userId }
 * @returns {Promise<object>} - Results { success, failed, errors }
 *
 * WHY BULK OPERATIONS:
 * - Avoid N individual HTTP requests
 * - Atomic-like operations (all or nothing mentality)
 * - Progress tracking for large batches
 */
export async function bulkUpdate(type, ids, data, options = {}) {
  const { skipHooks = false, userId = null } = options;
  const results = { success: 0, failed: 0, errors: [], items: [] };

  for (const id of ids) {
    try {
      const item = await update(type, id, data, { skipHooks, userId });
      results.success++;
      results.items.push(item);
    } catch (error) {
      results.failed++;
      results.errors.push({ id, error: error.message });
    }
  }

  // Fire bulk hook
  if (!skipHooks) {
    await hooks.trigger('content:bulkUpdate', { type, ids, data, results });
  }

  return results;
}

/**
 * Bulk delete multiple items
 *
 * @param {string} type - Content type
 * @param {Array<string>} ids - Array of item IDs
 * @param {object} options - Options { permanent, userId }
 * @returns {Promise<object>} - Results { success, failed, errors }
 */
export async function bulkDelete(type, ids, options = {}) {
  const { permanent = false, userId = null } = options;
  const results = { success: 0, failed: 0, errors: [] };

  for (const id of ids) {
    try {
      const success = await remove(type, id, { permanent, trashedBy: userId });
      if (success) {
        results.success++;
      } else {
        results.failed++;
        results.errors.push({ id, error: 'Not found' });
      }
    } catch (error) {
      results.failed++;
      results.errors.push({ id, error: error.message });
    }
  }

  // Fire bulk hook
  await hooks.trigger('content:bulkDelete', { type, ids, permanent, results });

  return results;
}

/**
 * Bulk publish multiple items
 *
 * @param {string} type - Content type
 * @param {Array<string>} ids - Array of item IDs
 * @param {object} options - Options { userId }
 * @returns {Promise<object>} - Results { success, failed, errors }
 */
export async function bulkPublish(type, ids, options = {}) {
  if (!workflowEnabled) {
    throw new Error('Workflow is not enabled');
  }

  const results = { success: 0, failed: 0, errors: [], items: [] };

  for (const id of ids) {
    try {
      const item = await publish(type, id);
      results.success++;
      results.items.push(item);
    } catch (error) {
      results.failed++;
      results.errors.push({ id, error: error.message });
    }
  }

  // Fire bulk hook
  await hooks.trigger('content:bulkPublish', { type, ids, results });

  return results;
}

/**
 * Bulk unpublish multiple items
 *
 * @param {string} type - Content type
 * @param {Array<string>} ids - Array of item IDs
 * @param {object} options - Options { userId }
 * @returns {Promise<object>} - Results { success, failed, errors }
 */
export async function bulkUnpublish(type, ids, options = {}) {
  if (!workflowEnabled) {
    throw new Error('Workflow is not enabled');
  }

  const results = { success: 0, failed: 0, errors: [], items: [] };

  for (const id of ids) {
    try {
      const item = await unpublish(type, id);
      results.success++;
      results.items.push(item);
    } catch (error) {
      results.failed++;
      results.errors.push({ id, error: error.message });
    }
  }

  // Fire bulk hook
  await hooks.trigger('content:bulkUnpublish', { type, ids, results });

  return results;
}

/**
 * Bulk archive multiple items
 *
 * @param {string} type - Content type
 * @param {Array<string>} ids - Array of item IDs
 * @param {object} options - Options { userId }
 * @returns {Promise<object>} - Results { success, failed, errors }
 */
export async function bulkArchive(type, ids, options = {}) {
  if (!workflowEnabled) {
    throw new Error('Workflow is not enabled');
  }

  const results = { success: 0, failed: 0, errors: [], items: [] };

  for (const id of ids) {
    try {
      const item = await archive(type, id);
      results.success++;
      results.items.push(item);
    } catch (error) {
      results.failed++;
      results.errors.push({ id, error: error.message });
    }
  }

  // Fire bulk hook
  await hooks.trigger('content:bulkArchive', { type, ids, results });

  return results;
}

/**
 * Bulk change status of multiple items
 *
 * @param {string} type - Content type
 * @param {Array<string>} ids - Array of item IDs
 * @param {string} status - New status
 * @param {object} options - Options { userId }
 * @returns {Promise<object>} - Results { success, failed, errors }
 */
export async function bulkStatusChange(type, ids, status, options = {}) {
  if (!workflowEnabled) {
    throw new Error('Workflow is not enabled');
  }

  if (!WORKFLOW_STATUSES.includes(status)) {
    throw new Error(`Invalid status: ${status}`);
  }

  const results = { success: 0, failed: 0, errors: [], items: [] };

  for (const id of ids) {
    try {
      const item = await setStatus(type, id, status, options);
      results.success++;
      results.items.push(item);
    } catch (error) {
      results.failed++;
      results.errors.push({ id, error: error.message });
    }
  }

  // Fire bulk hook
  await hooks.trigger('content:bulkStatusChange', { type, ids, status, results });

  return results;
}

/**
 * Bulk restore items from trash
 *
 * @param {string} type - Content type (optional, null for all types)
 * @param {Array<string>} ids - Array of item IDs
 * @param {object} options - Options { userId }
 * @returns {Promise<object>} - Results { success, failed, errors }
 */
export async function bulkRestore(type, ids, options = {}) {
  if (!trashEnabled) {
    throw new Error('Trash is not enabled');
  }

  const results = { success: 0, failed: 0, errors: [], items: [] };

  for (const id of ids) {
    try {
      const item = await restore(type, id);
      results.success++;
      results.items.push(item);
    } catch (error) {
      results.failed++;
      results.errors.push({ id, error: error.message });
    }
  }

  // Fire bulk hook
  await hooks.trigger('content:bulkRestore', { type, ids, results });

  return results;
}

/**
 * Get IDs from filter criteria (for bulk operations by filter)
 *
 * @param {string} type - Content type
 * @param {object} filters - Filter criteria
 * @param {object} options - Options { limit }
 * @returns {Array<string>} - Array of matching IDs
 */
export function getIdsByFilter(type, filters, options = {}) {
  const { limit = 1000 } = options;
  const result = list(type, { filters, limit });
  return result.items.map(item => item.id);
}

/**
 * EXTENDING CONTENT TYPES:
 *
 * Modules register content types via hook_content:
 *
 *   export function hook_content(register, context) {
 *     register('greeting', {
 *       name: { type: 'string', required: true },
 *       message: { type: 'string', required: true }
 *     });
 *   }
 *
 * The content system handles:
 * - Storage in /content/<type>/<id>.json
 * - ID generation
 * - Timestamps (created, updated)
 * - Schema validation
 *
 * CONTENT LIFECYCLE HOOKS:
 * ========================
 * Modules can register handlers for content events:
 *
 *   hooks.register('content:beforeCreate', async (ctx) => {
 *     // ctx.type - content type name
 *     // ctx.data - data being saved (mutable)
 *     // throw to cancel the operation
 *   });
 *
 *   hooks.register('content:afterCreate', async (ctx) => {
 *     // ctx.type - content type name
 *     // ctx.item - the saved content object
 *   });
 *
 * Available hooks:
 * - content:beforeCreate(type, data) - can modify data or throw to cancel
 * - content:afterCreate(type, item) - item has been saved
 * - content:beforeUpdate(type, id, data, existing) - can modify data or throw
 * - content:afterUpdate(type, item) - item has been saved
 * - content:beforeDelete(type, id) - can throw to cancel
 * - content:afterDelete(type, id) - item has been deleted
 * - content:bulkUpdate(type, ids, data, results) - after bulk update
 * - content:bulkDelete(type, ids, permanent, results) - after bulk delete
 * - content:bulkPublish(type, ids, results) - after bulk publish
 * - content:bulkUnpublish(type, ids, results) - after bulk unpublish
 * - content:bulkArchive(type, ids, results) - after bulk archive
 * - content:bulkStatusChange(type, ids, status, results) - after bulk status change
 *
 * FUTURE ENHANCEMENTS:
 * - Pagination for list()
 * - Full-text search
 * - Content relationships
 * - Versioning / audit trail
 */
