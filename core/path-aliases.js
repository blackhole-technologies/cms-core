/**
 * path-aliases.js - URL Path Alias System
 *
 * WHY THIS EXISTS:
 * - SEO-friendly URLs: /about instead of /content/page/page-1
 * - Automatic patterns: generate aliases from content type patterns
 * - Redirects: keep old URLs working when aliases change
 * - Integration: works with router, slugs, and content systems
 *
 * INSPIRED BY: Drupal's pathauto module
 *
 * DESIGN DECISIONS:
 * - Zero dependencies (Node.js standard library only)
 * - File-based storage (config/path-aliases.json)
 * - Token-based patterns ([type], [title], [date:Y], etc.)
 * - Automatic uniqueness handling (suffixes -1, -2, etc.)
 * - Hook integration (alias:beforeCreate, alias:afterCreate, alias:resolve)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Module state
 */
let baseDir = null;
let router = null;
let content = null;
let hooks = null;
let config = {
  patterns: {},
  aliases: {},
  redirects: {},
};

/**
 * Reserved paths that cannot be used as aliases
 *
 * WHY THESE PATHS:
 * Core routes and admin paths should not be overridden by aliases.
 * Prevents conflicts with system functionality.
 */
const RESERVED_PATHS = [
  '/health',
  '/admin',
  '/api',
  '/content',
  '/config',
  '/modules',
  '/plugins',
  '/cli',
  '/test',
];

/**
 * Initialize path alias system
 *
 * @param {string} dir - Base directory for CMS
 * @param {Object} routerInstance - Router instance for integration
 * @param {Object} contentInstance - Content instance for data access
 * @param {Object} hooksInstance - Hooks instance for events
 *
 * WHY DEPENDENCY INJECTION:
 * Allows testing with mock implementations.
 * Avoids circular dependencies.
 */
export async function init(dir, routerInstance = null, contentInstance = null, hooksInstance = null) {
  baseDir = dir;
  router = routerInstance;
  content = contentInstance;
  hooks = hooksInstance;

  await load();
}

/**
 * Load configuration from disk
 *
 * WHY ASYNC:
 * File operations are async in Node.js.
 * Keeps the system non-blocking.
 */
async function load() {
  const configPath = join(baseDir, 'config', 'path-aliases.json');

  try {
    if (existsSync(configPath)) {
      const data = await readFile(configPath, 'utf-8');
      config = JSON.parse(data);
    } else {
      // Initialize with defaults
      config = {
        patterns: {},
        aliases: {},
        redirects: {},
      };
      await save();
    }
  } catch (error) {
    console.error('[path-aliases] Error loading config:', error.message);
    // Use defaults on error
    config = {
      patterns: {},
      aliases: {},
      redirects: {},
    };
  }
}

/**
 * Save configuration to disk
 *
 * WHY ATOMIC WRITES:
 * Write to temp file, then rename to prevent corruption if process dies.
 * (Not implemented yet, but should be for production)
 */
async function save() {
  const configDir = join(baseDir, 'config');
  const configPath = join(configDir, 'path-aliases.json');

  try {
    // Ensure config directory exists
    if (!existsSync(configDir)) {
      await mkdir(configDir, { recursive: true });
    }

    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    console.error('[path-aliases] Error saving config:', error.message);
    throw error;
  }
}

/**
 * Set URL pattern for a content type
 *
 * @param {string} contentType - Content type name
 * @param {string} pattern - URL pattern with tokens
 * @param {boolean} enabled - Whether pattern is enabled
 *
 * PATTERN SYNTAX:
 * - [type] - Content type
 * - [title] - Content title (slugified)
 * - [slug] - Explicit slug field
 * - [id] - Content ID
 * - [date:Y] - Year (4-digit)
 * - [date:m] - Month (2-digit)
 * - [date:d] - Day (2-digit)
 * - [term:name] - Taxonomy term name
 * - [vocabulary] - Taxonomy vocabulary name
 *
 * EXAMPLES:
 * - /[type]/[date:Y]/[date:m]/[title]
 * - /blog/[title]
 * - /[title]
 */
export async function setPattern(contentType, pattern, enabled = true) {
  config.patterns[contentType] = {
    pattern,
    enabled,
  };
  await save();
}

/**
 * Get URL pattern for a content type
 *
 * @param {string} contentType - Content type name
 * @returns {Object|null} - Pattern config or null
 */
export function getPattern(contentType) {
  return config.patterns[contentType] || null;
}

/**
 * Replace tokens in a pattern with actual values
 *
 * @param {string} pattern - Pattern with tokens
 * @param {Object} item - Content item
 * @returns {string} - Resolved path
 *
 * WHY SEPARATE FUNCTION:
 * Token replacement is complex enough to warrant isolation.
 * Makes testing easier.
 */
export function replaceTokens(pattern, item) {
  let result = pattern;

  // [type]
  result = result.replace(/\[type\]/g, item.type || '');

  // [id]
  result = result.replace(/\[id\]/g, item.id || '');

  // [title] - slugified
  if (item.title) {
    const slugTitle = slugify(item.title);
    result = result.replace(/\[title\]/g, slugTitle);
  }

  // [slug]
  if (item.slug) {
    result = result.replace(/\[slug\]/g, item.slug);
  }

  // Date tokens
  if (item.created || item.date) {
    const date = new Date(item.created || item.date);
    result = result.replace(/\[date:Y\]/g, date.getFullYear().toString());
    result = result.replace(/\[date:m\]/g, (date.getMonth() + 1).toString().padStart(2, '0'));
    result = result.replace(/\[date:d\]/g, date.getDate().toString().padStart(2, '0'));
  }

  // [term:name] - first term if available
  if (item.terms && item.terms.length > 0) {
    result = result.replace(/\[term:name\]/g, slugify(item.terms[0].name || ''));
  }

  // [vocabulary]
  if (item.vocabulary) {
    result = result.replace(/\[vocabulary\]/g, item.vocabulary);
  }

  return result;
}

/**
 * Simple slugify function
 *
 * WHY NOT USE A LIBRARY:
 * Zero dependencies requirement.
 * Simple enough to implement ourselves.
 *
 * @param {string} text - Text to slugify
 * @returns {string} - URL-safe slug
 */
function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove non-word chars
    .replace(/[\s_-]+/g, '-') // Replace spaces/underscores with hyphens
    .replace(/^-+|-+$/g, ''); // Trim hyphens
}

/**
 * Generate alias from pattern
 *
 * @param {Object} item - Content item
 * @returns {string|null} - Generated alias or null
 *
 * WHY RETURN NULL:
 * Pattern might not be set or enabled for this type.
 * Caller needs to know if generation failed.
 */
export function generateAlias(item) {
  const patternConfig = getPattern(item.type);

  if (!patternConfig || !patternConfig.enabled) {
    return null;
  }

  let alias = replaceTokens(patternConfig.pattern, item);

  // Ensure leading slash
  if (!alias.startsWith('/')) {
    alias = '/' + alias;
  }

  return alias;
}

/**
 * Validate alias format
 *
 * @param {string} alias - Alias to validate
 * @returns {{valid: boolean, error?: string}}
 *
 * VALIDATION RULES:
 * - Must start with /
 * - Cannot be reserved path
 * - Cannot contain special characters (except - and /)
 * - Cannot be empty
 */
export function validateAlias(alias) {
  if (!alias || typeof alias !== 'string') {
    return { valid: false, error: 'Alias must be a non-empty string' };
  }

  if (!alias.startsWith('/')) {
    return { valid: false, error: 'Alias must start with /' };
  }

  if (alias === '/') {
    return { valid: false, error: 'Cannot use / as alias' };
  }

  // Check reserved paths
  for (const reserved of RESERVED_PATHS) {
    if (alias === reserved || alias.startsWith(reserved + '/')) {
      return { valid: false, error: `Path is reserved: ${reserved}` };
    }
  }

  // Check valid characters
  if (!/^\/[\w\/-]+$/.test(alias)) {
    return { valid: false, error: 'Alias contains invalid characters' };
  }

  return { valid: true };
}

/**
 * Make alias unique by adding suffix
 *
 * @param {string} alias - Desired alias
 * @returns {string} - Unique alias
 *
 * WHY SUFFIXES:
 * Common pattern for handling duplicates.
 * User-friendly (about, about-1, about-2).
 */
function makeUnique(alias) {
  let unique = alias;
  let counter = 1;

  while (config.aliases[unique]) {
    unique = `${alias}-${counter}`;
    counter++;
  }

  return unique;
}

/**
 * Create a new alias
 *
 * @param {string} alias - Desired alias
 * @param {string} target - Internal path
 * @param {Object} options - Options
 * @returns {Promise<string>} - Actual alias created
 *
 * OPTIONS:
 * - unique: boolean - Make unique if exists (default: true)
 * - force: boolean - Overwrite existing (default: false)
 *
 * WHY ASYNC:
 * Triggers hooks and saves to disk.
 */
export async function createAlias(alias, target, options = {}) {
  const { unique = true, force = false } = options;

  // Validate
  const validation = validateAlias(alias);
  if (!validation.valid) {
    throw new Error(`Invalid alias: ${validation.error}`);
  }

  // Hook: beforeCreate
  if (hooks) {
    const hookContext = { alias, target, cancelled: false };
    await hooks.trigger('alias:beforeCreate', hookContext);
    if (hookContext.cancelled) {
      throw new Error('Alias creation cancelled by hook');
    }
  }

  let finalAlias = alias;

  // Handle existing
  if (config.aliases[alias]) {
    if (force) {
      // Overwrite
      finalAlias = alias;
    } else if (unique) {
      // Make unique
      finalAlias = makeUnique(alias);
    } else {
      throw new Error(`Alias already exists: ${alias}`);
    }
  }

  // Create alias
  config.aliases[finalAlias] = {
    target,
    created: new Date().toISOString(),
  };

  await save();

  // Hook: afterCreate
  if (hooks) {
    await hooks.trigger('alias:afterCreate', { alias: finalAlias, target });
  }

  return finalAlias;
}

/**
 * Update an alias (move to new path)
 *
 * @param {string} oldAlias - Current alias
 * @param {string} newAlias - New alias
 * @param {boolean} createRedirect - Create redirect from old to new
 * @returns {Promise<void>}
 *
 * WHY SEPARATE FROM createAlias:
 * Update has different semantics (redirects, validation).
 */
export async function updateAlias(oldAlias, newAlias, createRedirect = true) {
  if (!config.aliases[oldAlias]) {
    throw new Error(`Alias not found: ${oldAlias}`);
  }

  const target = config.aliases[oldAlias].target;

  // Validate new alias
  const validation = validateAlias(newAlias);
  if (!validation.valid) {
    throw new Error(`Invalid alias: ${validation.error}`);
  }

  // Create redirect if requested
  if (createRedirect) {
    config.redirects[oldAlias] = {
      target: newAlias,
      status: 301, // Permanent redirect
    };
  }

  // Remove old, create new
  delete config.aliases[oldAlias];
  config.aliases[newAlias] = {
    target,
    created: new Date().toISOString(),
  };

  await save();
}

/**
 * Delete an alias
 *
 * @param {string} alias - Alias to delete
 * @returns {Promise<void>}
 */
export async function deleteAlias(alias) {
  if (!config.aliases[alias]) {
    throw new Error(`Alias not found: ${alias}`);
  }

  delete config.aliases[alias];
  await save();
}

/**
 * Resolve alias to internal path
 *
 * @param {string} path - URL path (may be alias or internal)
 * @returns {Object|null} - {target, isRedirect, status}
 *
 * WHY RETURN OBJECT:
 * Need to distinguish between aliases and redirects.
 * Status code important for HTTP response.
 */
export async function resolveAlias(path) {
  // Hook: resolve
  if (hooks) {
    const hookContext = { path, resolved: null };
    await hooks.trigger('alias:resolve', hookContext);
    if (hookContext.resolved) {
      return hookContext.resolved;
    }
  }

  // Check redirects first
  if (config.redirects[path]) {
    return {
      target: config.redirects[path].target,
      isRedirect: true,
      status: config.redirects[path].status || 301,
    };
  }

  // Check aliases
  if (config.aliases[path]) {
    return {
      target: config.aliases[path].target,
      isRedirect: false,
    };
  }

  return null;
}

/**
 * Reverse lookup: get alias for internal path
 *
 * @param {string} internalPath - Internal path
 * @returns {string|null} - Alias or null
 *
 * WHY LINEAR SEARCH:
 * Not a performance-critical operation.
 * Building reverse index would complicate save/load.
 */
export function getAliasFor(internalPath) {
  for (const [alias, data] of Object.entries(config.aliases)) {
    if (data.target === internalPath) {
      return alias;
    }
  }
  return null;
}

/**
 * Bulk generate aliases for content type
 *
 * @param {string} contentType - Content type
 * @param {Object} options - Options
 * @returns {Promise<{created: number, skipped: number, errors: number}>}
 *
 * WHY BATCH OPERATION:
 * Useful for initial setup or pattern changes.
 * Regenerate all aliases at once.
 */
export async function bulkGenerate(contentType, options = {}) {
  const { overwrite = false } = options;

  if (!content) {
    throw new Error('Content system not initialized');
  }

  const items = content.list(contentType);
  const stats = { created: 0, skipped: 0, errors: 0 };

  for (const item of items) {
    try {
      const alias = generateAlias(item);
      if (!alias) {
        stats.skipped++;
        continue;
      }

      const internalPath = `/content/${contentType}/${item.id}`;
      const existing = getAliasFor(internalPath);

      if (existing && !overwrite) {
        stats.skipped++;
        continue;
      }

      if (existing && overwrite) {
        await deleteAlias(existing);
      }

      await createAlias(alias, internalPath, { unique: true });
      stats.created++;
    } catch (error) {
      console.error(`[path-aliases] Error generating alias for ${item.id}:`, error.message);
      stats.errors++;
    }
  }

  return stats;
}

/**
 * Get available tokens for content type
 *
 * @param {string} contentType - Content type
 * @returns {Array<{token: string, description: string}>}
 *
 * WHY THIS EXISTS:
 * Help UI show available tokens.
 * Documentation for pattern creation.
 */
export function getAvailableTokens(contentType) {
  const tokens = [
    { token: '[type]', description: 'Content type name' },
    { token: '[id]', description: 'Content ID' },
    { token: '[title]', description: 'Title (slugified)' },
    { token: '[slug]', description: 'Explicit slug field' },
    { token: '[date:Y]', description: 'Year (4-digit)' },
    { token: '[date:m]', description: 'Month (2-digit)' },
    { token: '[date:d]', description: 'Day (2-digit)' },
  ];

  // Add taxonomy tokens if type supports it
  if (content && content.getSchema) {
    const schema = content.getSchema(contentType);
    if (schema) {
      const hasTerms = Object.values(schema.fields || {}).some(
        f => f.type === 'taxonomy' || f.type === 'reference'
      );
      if (hasTerms) {
        tokens.push(
          { token: '[term:name]', description: 'First taxonomy term name' },
          { token: '[vocabulary]', description: 'Taxonomy vocabulary name' }
        );
      }
    }
  }

  return tokens;
}

/**
 * List all aliases
 *
 * @returns {Array<{alias: string, target: string, created: string}>}
 */
export function listAliases() {
  return Object.entries(config.aliases).map(([alias, data]) => ({
    alias,
    target: data.target,
    created: data.created,
  }));
}

/**
 * List all redirects
 *
 * @returns {Array<{from: string, to: string, status: number}>}
 */
export function listRedirects() {
  return Object.entries(config.redirects).map(([from, data]) => ({
    from,
    to: data.target,
    status: data.status,
  }));
}

/**
 * List all patterns
 *
 * @returns {Array<{type: string, pattern: string, enabled: boolean}>}
 */
export function listPatterns() {
  return Object.entries(config.patterns).map(([type, data]) => ({
    type,
    pattern: data.pattern,
    enabled: data.enabled,
  }));
}

/**
 * Get statistics
 *
 * @returns {Object} - Stats about aliases
 */
export function getStats() {
  return {
    aliases: Object.keys(config.aliases).length,
    redirects: Object.keys(config.redirects).length,
    patterns: Object.keys(config.patterns).length,
  };
}

/**
 * Clear all data (testing only)
 */
export function clear() {
  config = {
    patterns: {},
    aliases: {},
    redirects: {},
  };
}
