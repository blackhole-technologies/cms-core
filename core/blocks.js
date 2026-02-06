/**
 * blocks.js - Block System
 *
 * WHY BLOCKS:
 * ===========
 * Blocks are reusable chunks of content placed in theme regions:
 * - Site-wide elements (header, footer, sidebar)
 * - Context-aware widgets (recent posts, menus)
 * - User-configurable page sections
 *
 * Inspired by Drupal's block system:
 * - Regions defined by themes
 * - Blocks assignable to any region
 * - Visibility rules (pages, roles, content types)
 * - Weight-based ordering within regions
 *
 * STORAGE STRATEGY:
 * =================
 * - Block types: registered in memory (core + plugins)
 * - Block instances: content/block/<id>.json
 * - Regions: registered in memory (from theme manifest)
 *
 * DESIGN DECISIONS:
 * =================
 * 1. Uses content service for persistent storage
 * 2. In-memory registries for types and regions
 * 3. Visibility evaluated at render time
 * 4. Simple cache support via cache mode
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Block type registry
 * Structure: { typeId: BlockType, ... }
 */
const blockTypes = {};

/**
 * Region registry
 * Structure: { regionId: Region, ... }
 */
const regions = {};

/**
 * Block instances cache
 * Structure: { blockId: Block, ... }
 */
const blockCache = {};

/**
 * Rendered block cache
 * Structure: { cacheKey: { html, timestamp }, ... }
 */
const renderCache = new Map();

/**
 * Base directory for content storage
 */
let baseDir = null;

/**
 * Template service reference for rendering
 */
let templateService = null;

/**
 * Content service reference for storage
 */
let contentService = null;

/**
 * Hooks service reference
 */
let hooksService = null;

/**
 * Configuration
 */
let config = {
  enabled: true,
  cache: {
    enabled: true,
    defaultMode: 'per-page',
    defaultMaxAge: 3600,
  },
  builtinTypes: true,
};

/**
 * Initialize block system
 *
 * @param {string} directory - Base directory for content storage
 * @param {object} templateSvc - Template service instance
 * @param {object} cfg - Configuration object
 *
 * WHY INIT:
 * - Sets up dependencies (template service, storage path)
 * - Registers built-in block types
 * - Loads regions from theme
 */
export function init(directory, templateSvc, cfg = {}) {
  baseDir = directory;
  templateService = templateSvc;
  config = { ...config, ...cfg };

  // Ensure blocks directory exists
  const blocksDir = join(baseDir, 'content', 'block');
  if (!existsSync(blocksDir)) {
    mkdirSync(blocksDir, { recursive: true });
  }

  // Register built-in block types
  if (config.builtinTypes) {
    registerBuiltinTypes();
  }

  // Load all blocks into cache
  loadAllBlocks();
}

/**
 * Set hooks service reference
 *
 * @param {object} service - Hooks service instance
 */
export function setHooks(service) {
  hooksService = service;
}

/**
 * Set content service reference
 *
 * @param {object} service - Content service instance
 */
export function setContentService(service) {
  contentService = service;
}

// ============================================
// BLOCK TYPE MANAGEMENT
// ============================================

/**
 * Register a block type
 *
 * @param {object} input - Block type definition
 * @throws {Error} - If type ID is missing or already registered
 *
 * WHY REGISTRATION:
 * - Defines available block types
 * - Provides schema for block config
 * - Allows custom render functions
 */
export function registerBlockType(input) {
  if (!input.id) {
    throw new Error('Block type ID is required');
  }

  if (blockTypes[input.id]) {
    throw new Error(`Block type already registered: ${input.id}`);
  }

  // Build full type definition
  const type = {
    id: input.id,
    label: input.label || input.id,
    description: input.description || '',
    category: input.category || 'general',
    icon: input.icon || 'square',
    schema: input.schema || {},
    defaults: input.defaults || {},
    template: input.template || null,
    render: input.render || null,
    source: input.source || 'custom',
    userCreatable: input.userCreatable !== false,
  };

  blockTypes[type.id] = type;

  // Fire hook
  if (hooksService) {
    hooksService.fire('block:typeRegister', { type });
  }
}

/**
 * Get a block type by ID
 *
 * @param {string} id - Block type ID
 * @returns {object|null} - Block type or null if not found
 */
export function getBlockType(id) {
  return blockTypes[id] || null;
}

/**
 * List all block types
 *
 * @param {string} category - Optional category filter
 * @returns {array} - Array of block types
 */
export function listBlockTypes(category = null) {
  const types = Object.values(blockTypes);

  if (category) {
    return types.filter((t) => t.category === category);
  }

  return types;
}

/**
 * List block type categories
 *
 * @returns {array} - Array of unique category names
 */
export function listCategories() {
  const categories = new Set();
  Object.values(blockTypes).forEach((type) => {
    categories.add(type.category);
  });
  return Array.from(categories).sort();
}

// ============================================
// REGION MANAGEMENT
// ============================================

/**
 * Register a region
 *
 * @param {object} region - Region definition
 * @throws {Error} - If region ID is missing
 *
 * WHY REGIONS:
 * - Define areas where blocks can be placed
 * - Typically defined by theme
 * - Examples: header, sidebar_left, footer
 */
export function registerRegion(region) {
  if (!region.id) {
    throw new Error('Region ID is required');
  }

  regions[region.id] = {
    id: region.id,
    label: region.label || region.id,
    description: region.description || '',
    template: region.template || null,
    weight: region.weight || 0,
  };
}

/**
 * Get a region by ID
 *
 * @param {string} id - Region ID
 * @returns {object|null} - Region or null if not found
 */
export function getRegion(id) {
  return regions[id] || null;
}

/**
 * List all regions
 *
 * @returns {array} - Array of regions sorted by weight
 */
export function listRegions() {
  return Object.values(regions).sort((a, b) => a.weight - b.weight);
}

// ============================================
// BLOCK INSTANCE MANAGEMENT
// ============================================

/**
 * Generate a unique block ID
 *
 * @returns {string} - Unique ID (UUID v4 format)
 */
function generateId() {
  return randomBytes(16).toString('hex');
}

/**
 * Get file path for a block
 *
 * @param {string} id - Block ID
 * @returns {string} - Absolute file path
 */
function getBlockPath(id) {
  return join(baseDir, 'content', 'block', `${id}.json`);
}

/**
 * Load all blocks into cache
 *
 * WHY CACHE:
 * - Blocks are frequently accessed during page rendering
 * - File I/O is expensive
 * - Cache invalidated on create/update/delete
 */
function loadAllBlocks() {
  const blocksDir = join(baseDir, 'content', 'block');

  if (!existsSync(blocksDir)) {
    return;
  }

  const files = readdirSync(blocksDir);

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const filePath = join(blocksDir, file);
    try {
      const content = readFileSync(filePath, 'utf-8');
      const block = JSON.parse(content);
      blockCache[block.id] = block;
    } catch (err) {
      console.error(`Failed to load block from ${file}:`, err.message);
    }
  }
}

/**
 * Save block to disk and cache
 *
 * @param {object} block - Block instance
 */
function saveBlock(block) {
  const filePath = getBlockPath(block.id);
  writeFileSync(filePath, JSON.stringify(block, null, 2), 'utf-8');
  blockCache[block.id] = block;
}

/**
 * Create a new block
 *
 * @param {object} input - Block data
 * @returns {object} - Created block
 * @throws {Error} - If block type not found
 *
 * WHY ASYNC:
 * - Allows for future async validation
 * - Hooks may be async
 * - Consistent with other services
 */
export async function createBlock(input) {
  // Validate type exists
  const type = getBlockType(input.type);
  if (!type) {
    throw new Error(`Block type not found: ${input.type}`);
  }

  // Build block instance
  const block = {
    id: generateId(),
    type: input.type,
    adminTitle: input.adminTitle,
    title: input.title || '',
    showTitle: input.showTitle !== false,
    regionId: input.regionId || null,
    weight: input.weight || 0,
    config: { ...type.defaults, ...input.config },
    visibility: input.visibility || [],
    enabled: input.enabled !== false,
    cache: {
      mode: input.cache?.mode || config.cache.defaultMode,
      maxAge: input.cache?.maxAge || config.cache.defaultMaxAge,
    },
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };

  // Save to disk
  saveBlock(block);

  // Fire hook
  if (hooksService) {
    await hooksService.fire('block:create', { block });
  }

  return block;
}

/**
 * Get a block by ID
 *
 * @param {string} id - Block ID
 * @returns {object|null} - Block or null if not found
 */
export function getBlock(id) {
  return blockCache[id] || null;
}

/**
 * Update a block
 *
 * @param {string} id - Block ID
 * @param {object} input - Updated data
 * @returns {object} - Updated block
 * @throws {Error} - If block not found
 */
export async function updateBlock(id, input) {
  const block = getBlock(id);
  if (!block) {
    throw new Error(`Block not found: ${id}`);
  }

  // Update fields
  if (input.adminTitle !== undefined) block.adminTitle = input.adminTitle;
  if (input.title !== undefined) block.title = input.title;
  if (input.showTitle !== undefined) block.showTitle = input.showTitle;
  if (input.regionId !== undefined) block.regionId = input.regionId;
  if (input.weight !== undefined) block.weight = input.weight;
  if (input.config !== undefined) block.config = { ...block.config, ...input.config };
  if (input.visibility !== undefined) block.visibility = input.visibility;
  if (input.enabled !== undefined) block.enabled = input.enabled;
  if (input.cache !== undefined) {
    block.cache = { ...block.cache, ...input.cache };
  }

  block.updated = new Date().toISOString();

  // Save to disk
  saveBlock(block);

  // Clear render cache for this block
  clearCache(id);

  // Fire hook
  if (hooksService) {
    await hooksService.fire('block:update', { block });
  }

  return block;
}

/**
 * Delete a block
 *
 * @param {string} id - Block ID
 * @throws {Error} - If block not found
 */
export async function deleteBlock(id) {
  const block = getBlock(id);
  if (!block) {
    throw new Error(`Block not found: ${id}`);
  }

  // Delete from disk
  const filePath = getBlockPath(id);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }

  // Remove from cache
  delete blockCache[id];

  // Clear render cache
  clearCache(id);

  // Fire hook
  if (hooksService) {
    await hooksService.fire('block:delete', { id, block });
  }
}

/**
 * List blocks with filtering
 *
 * @param {object} options - Query options
 * @returns {object} - Paginated block list
 */
export function listBlocks(options = {}) {
  let items = Object.values(blockCache);

  // Apply filters
  if (options.regionId !== undefined) {
    items = items.filter((b) => b.regionId === options.regionId);
  }

  if (options.type !== undefined) {
    items = items.filter((b) => b.type === options.type);
  }

  if (options.enabled !== undefined) {
    items = items.filter((b) => b.enabled === options.enabled);
  }

  // Sort
  const sortField = options.sort || 'weight';
  const order = options.order || 'asc';
  items.sort((a, b) => {
    const aVal = a[sortField];
    const bVal = b[sortField];
    if (aVal < bVal) return order === 'asc' ? -1 : 1;
    if (aVal > bVal) return order === 'asc' ? 1 : -1;
    return 0;
  });

  // Pagination
  const total = items.length;
  const offset = options.offset || 0;
  const limit = options.limit || total;
  items = items.slice(offset, offset + limit);

  return { items, total, offset, limit };
}

/**
 * Move block to region
 *
 * @param {string} blockId - Block ID
 * @param {string|null} regionId - Target region (null to unassign)
 * @param {number} weight - Optional new weight
 * @returns {object} - Updated block
 */
export async function moveToRegion(blockId, regionId, weight = null) {
  const updates = { regionId };
  if (weight !== null) {
    updates.weight = weight;
  }
  return updateBlock(blockId, updates);
}

/**
 * Reorder blocks within region
 *
 * @param {string} regionId - Region ID
 * @param {array} blockIds - Block IDs in desired order
 */
export async function reorderBlocks(regionId, blockIds) {
  for (let i = 0; i < blockIds.length; i++) {
    await updateBlock(blockIds[i], { weight: i });
  }
}

/**
 * Get blocks by type
 *
 * @param {string} typeId - Block type ID
 * @returns {array} - Blocks of this type
 */
export function getBlocksByType(typeId) {
  return Object.values(blockCache).filter((b) => b.type === typeId);
}

// ============================================
// VISIBILITY
// ============================================

/**
 * Check if a path matches a pattern
 *
 * @param {string} path - Current path
 * @param {string} pattern - Pattern to match (supports * wildcard)
 * @returns {boolean} - True if matches
 *
 * PATTERN EXAMPLES:
 * - "/about" - Exact match
 * - "/blog/*" - Matches /blog/post-1, /blog/post-2, etc.
 * - "*" - Matches all paths
 */
function matchPath(path, pattern) {
  if (pattern === '*') return true;

  // Convert pattern to regex
  const regexPattern = pattern
    .replace(/\*/g, '.*')
    .replace(/\//g, '\\/');
  const regex = new RegExp(`^${regexPattern}$`);

  return regex.test(path);
}

/**
 * Check if block should be visible
 *
 * @param {object} block - Block to check
 * @param {object} context - Render context
 * @returns {boolean} - True if visible
 *
 * VISIBILITY LOGIC:
 * - If no rules, block is visible
 * - Rules are AND'ed together
 * - Each rule can show or hide
 * - Custom callbacks can override
 */
export function checkVisibility(block, context) {
  if (!block.enabled) {
    return false;
  }

  if (!block.visibility || block.visibility.length === 0) {
    return true;
  }

  let visible = true;

  for (const rule of block.visibility) {
    let matches = false;

    switch (rule.type) {
      case 'pages':
        {
          const paths = rule.config.paths || [];
          matches = paths.some((pattern) => matchPath(context.path, pattern));
        }
        break;

      case 'content':
        {
          if (!context.content) break;
          const types = rule.config.contentTypes || [];
          matches = types.includes(context.content.type);
        }
        break;

      case 'roles':
        {
          if (!context.user) break;
          const roles = rule.config.roles || [];
          matches = roles.some((role) => context.user.roles.includes(role));
        }
        break;

      case 'query':
        {
          const queryRules = rule.config.query || {};
          matches = Object.entries(queryRules).every(([key, value]) => {
            const contextValue = context.query[key];
            if (Array.isArray(value)) {
              return value.includes(contextValue);
            }
            return contextValue === value;
          });
        }
        break;

      case 'custom':
        {
          // Custom callback (must be registered)
          const callbackName = rule.config.callback;
          if (callbackName && typeof global[callbackName] === 'function') {
            matches = global[callbackName](block, context);
          }
        }
        break;
    }

    // Apply show/hide logic
    if (rule.show && !matches) {
      visible = false;
      break;
    }
    if (!rule.show && matches) {
      visible = false;
      break;
    }
  }

  // Fire hook to allow override
  if (hooksService) {
    const result = hooksService.fire('block:checkVisibility', {
      block,
      context,
      visible,
    });
    if (result && result.visible !== undefined) {
      visible = result.visible;
    }
  }

  return visible;
}

/**
 * Add visibility rule to block
 *
 * @param {string} blockId - Block ID
 * @param {object} rule - Visibility rule
 * @returns {object} - Updated block
 */
export async function addVisibilityRule(blockId, rule) {
  const block = getBlock(blockId);
  if (!block) {
    throw new Error(`Block not found: ${blockId}`);
  }

  block.visibility = block.visibility || [];
  block.visibility.push(rule);

  return updateBlock(blockId, { visibility: block.visibility });
}

/**
 * Remove visibility rule from block
 *
 * @param {string} blockId - Block ID
 * @param {number} ruleIndex - Index of rule to remove
 * @returns {object} - Updated block
 */
export async function removeVisibilityRule(blockId, ruleIndex) {
  const block = getBlock(blockId);
  if (!block) {
    throw new Error(`Block not found: ${blockId}`);
  }

  if (!block.visibility || ruleIndex < 0 || ruleIndex >= block.visibility.length) {
    throw new Error(`Invalid rule index: ${ruleIndex}`);
  }

  block.visibility.splice(ruleIndex, 1);

  return updateBlock(blockId, { visibility: block.visibility });
}

// ============================================
// RENDERING
// ============================================

/**
 * Get cache key for block
 *
 * @param {object} block - Block instance
 * @param {object} context - Render context
 * @returns {string} - Cache key
 *
 * CACHE KEY STRATEGY:
 * - global: same for all users/pages
 * - per-page: varies by path
 * - per-user: varies by user ID
 * - per-role: varies by user roles
 */
export function getCacheKey(block, context) {
  const parts = [`block:${block.id}`];

  switch (block.cache.mode) {
    case 'global':
      // No additional keys
      break;
    case 'per-page':
      parts.push(`page:${context.path}`);
      break;
    case 'per-user':
      parts.push(`user:${context.user?.id || 'anonymous'}`);
      break;
    case 'per-role':
      {
        const roles = context.user?.roles?.join(',') || 'anonymous';
        parts.push(`roles:${roles}`);
      }
      break;
  }

  return parts.join(':');
}

/**
 * Render a single block
 *
 * @param {string} blockId - Block ID
 * @param {object} context - Render context
 * @returns {object} - Rendered block with metadata
 *
 * RENDER PROCESS:
 * 1. Check visibility
 * 2. Check cache
 * 3. Get block type
 * 4. Call custom render function or use template
 * 5. Fire hooks
 * 6. Cache result
 */
export async function renderBlock(blockId, context) {
  const startTime = Date.now();
  const block = getBlock(blockId);

  if (!block) {
    throw new Error(`Block not found: ${blockId}`);
  }

  // Check visibility
  if (!checkVisibility(block, context)) {
    return {
      ...block,
      html: '',
      cached: false,
      renderTime: Date.now() - startTime,
    };
  }

  // Check cache
  const cacheKey = getCacheKey(block, context);
  if (config.cache.enabled && block.cache.mode !== 'none') {
    const cached = renderCache.get(cacheKey);
    if (cached) {
      const age = Date.now() - cached.timestamp;
      const maxAge = block.cache.maxAge * 1000;
      if (maxAge === 0 || age < maxAge) {
        return {
          ...block,
          html: cached.html,
          cached: true,
          renderTime: Date.now() - startTime,
        };
      }
    }
  }

  // Fire before render hook
  if (hooksService) {
    await hooksService.fire('block:beforeRender', { block, context });
  }

  // Get block type
  const type = getBlockType(block.type);
  if (!type) {
    throw new Error(`Block type not found: ${block.type}`);
  }

  // Render
  let html = '';

  if (type.render) {
    // Custom render function
    html = await type.render(block, context);
  } else if (type.template) {
    // Template-based rendering
    const data = {
      ...block.config,
      block,
      context,
    };
    html = templateService.render(type.template, data);
  }

  // Wrap with title if enabled
  if (block.showTitle && block.title) {
    html = `<h2 class="block-title">${escapeHtml(block.title)}</h2>\n${html}`;
  }

  // Fire after render hook (allows modification)
  if (hooksService) {
    const result = await hooksService.fire('block:afterRender', {
      block,
      html,
      context,
    });
    if (result && result.html !== undefined) {
      html = result.html;
    }
  }

  // Cache result
  if (config.cache.enabled && block.cache.mode !== 'none') {
    renderCache.set(cacheKey, {
      html,
      timestamp: Date.now(),
    });
  }

  return {
    ...block,
    html,
    cached: false,
    renderTime: Date.now() - startTime,
  };
}

/**
 * Render all blocks in a region
 *
 * @param {string} regionId - Region ID
 * @param {object} context - Render context
 * @returns {array} - Array of rendered blocks
 */
export async function renderRegion(regionId, context) {
  // Fire before render hook
  if (hooksService) {
    await hooksService.fire('region:beforeRender', { regionId, context });
  }

  // Get blocks in region
  const { items: blocks } = listBlocks({
    regionId,
    enabled: true,
    sort: 'weight',
    order: 'asc',
  });

  // Render each block
  const rendered = [];
  for (const block of blocks) {
    const result = await renderBlock(block.id, context);
    if (result.html) {
      rendered.push(result);
    }
  }

  // Fire after render hook
  if (hooksService) {
    await hooksService.fire('region:afterRender', {
      regionId,
      rendered,
      context,
    });
  }

  return rendered;
}

/**
 * Render all regions for a page
 *
 * @param {object} context - Render context
 * @returns {Map} - Map of regionId -> rendered blocks
 */
export async function renderAllRegions(context) {
  const result = new Map();
  const regionIds = Object.keys(regions);

  for (const regionId of regionIds) {
    const rendered = await renderRegion(regionId, context);
    result.set(regionId, rendered);
  }

  return result;
}

// ============================================
// CACHING
// ============================================

/**
 * Clear block render cache
 *
 * @param {string} blockId - Block ID (all if omitted)
 */
export function clearCache(blockId = null) {
  if (blockId) {
    // Clear all cache entries for this block
    const prefix = `block:${blockId}:`;
    for (const key of renderCache.keys()) {
      if (key.startsWith(prefix)) {
        renderCache.delete(key);
      }
    }
  } else {
    // Clear all cache
    renderCache.clear();
  }
}

// ============================================
// UTILITIES
// ============================================

/**
 * Clone a block
 *
 * @param {string} blockId - Source block ID
 * @param {object} overrides - Optional property overrides
 * @returns {object} - Cloned block
 */
export async function cloneBlock(blockId, overrides = {}) {
  const source = getBlock(blockId);
  if (!source) {
    throw new Error(`Block not found: ${blockId}`);
  }

  const input = {
    type: source.type,
    adminTitle: `${source.adminTitle} (copy)`,
    title: source.title,
    showTitle: source.showTitle,
    regionId: source.regionId,
    weight: source.weight + 1,
    config: { ...source.config },
    visibility: [...source.visibility],
    enabled: source.enabled,
    cache: { ...source.cache },
    ...overrides,
  };

  return createBlock(input);
}

/**
 * Export block configuration
 *
 * @param {string} blockId - Block ID
 * @returns {object} - Exportable block data
 */
export function exportBlock(blockId) {
  const block = getBlock(blockId);
  if (!block) {
    throw new Error(`Block not found: ${blockId}`);
  }

  const type = getBlockType(block.type);
  if (!type) {
    throw new Error(`Block type not found: ${block.type}`);
  }

  return { block, type };
}

/**
 * Import block configuration
 *
 * @param {object} data - Exported block data
 * @param {object} options - Import options
 * @returns {object} - Imported block
 */
export async function importBlock(data, options = {}) {
  const { block, type } = data;

  // Register type if it doesn't exist
  if (!getBlockType(type.id)) {
    registerBlockType(type);
  }

  // Check if block already exists
  const existing = getBlock(block.id);
  if (existing && !options.overwrite) {
    throw new Error(`Block already exists: ${block.id} (use overwrite option)`);
  }

  if (existing && options.overwrite) {
    return updateBlock(block.id, block);
  }

  // Create new block with same ID
  const input = {
    type: block.type,
    adminTitle: block.adminTitle,
    title: block.title,
    showTitle: block.showTitle,
    regionId: block.regionId,
    weight: block.weight,
    config: block.config,
    visibility: block.visibility,
    enabled: block.enabled,
    cache: block.cache,
  };

  const created = await createBlock(input);

  // Overwrite with original ID
  delete blockCache[created.id];
  const filePath = getBlockPath(created.id);
  unlinkSync(filePath);

  created.id = block.id;
  saveBlock(created);

  return created;
}

/**
 * Escape HTML special characters
 *
 * @param {string} str - String to escape
 * @returns {string} - Escaped string
 */
function escapeHtml(str) {
  if (typeof str !== 'string') {
    return String(str);
  }

  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================
// BUILT-IN BLOCK TYPES
// ============================================

/**
 * Register built-in block types
 *
 * WHY BUILT-INS:
 * - Common functionality out of the box
 * - Examples for custom block types
 * - Reduce boilerplate for simple sites
 */
function registerBuiltinTypes() {
  // HTML Block - Static HTML content
  registerBlockType({
    id: 'html',
    label: 'HTML',
    description: 'Static HTML content',
    category: 'content',
    schema: {
      body: {
        type: 'html',
        label: 'HTML Content',
        required: true,
      },
    },
    defaults: {
      body: '<p>Enter your HTML content here.</p>',
    },
    render: async (block) => {
      return block.config.body || '';
    },
    source: 'core',
  });

  // Menu Block - Render a menu
  registerBlockType({
    id: 'menu',
    label: 'Menu',
    description: 'Render a navigation menu',
    category: 'navigation',
    schema: {
      menuId: {
        type: 'string',
        label: 'Menu',
        required: true,
      },
      level: {
        type: 'number',
        label: 'Starting Level',
        defaultValue: 0,
      },
      maxDepth: {
        type: 'number',
        label: 'Maximum Depth',
        defaultValue: 0,
      },
    },
    defaults: {
      menuId: 'main',
      level: 0,
      maxDepth: 0,
    },
    render: async (block, context) => {
      // Requires menu service
      if (!context.services?.menu) {
        return '<!-- Menu service not available -->';
      }

      const items = context.services.menu.renderMenu(block.config.menuId, {
        level: block.config.level,
        maxDepth: block.config.maxDepth,
      });

      if (!items || items.length === 0) {
        return '';
      }

      return renderMenuItems(items);
    },
    source: 'core',
  });

  // Content Block - Dynamic content query
  registerBlockType({
    id: 'content',
    label: 'Content List',
    description: 'Display a list of content items',
    category: 'content',
    schema: {
      contentType: {
        type: 'string',
        label: 'Content Type',
        required: true,
      },
      limit: {
        type: 'number',
        label: 'Number of Items',
        defaultValue: 5,
      },
      sort: {
        type: 'string',
        label: 'Sort By',
        defaultValue: 'created',
      },
      order: {
        type: 'select',
        label: 'Order',
        options: ['asc', 'desc'],
        defaultValue: 'desc',
      },
    },
    defaults: {
      contentType: 'page',
      limit: 5,
      sort: 'created',
      order: 'desc',
    },
    render: async (block, context) => {
      // Requires content service
      if (!context.services?.content) {
        return '<!-- Content service not available -->';
      }

      const { items } = context.services.content.list(block.config.contentType, {
        limit: block.config.limit,
        sort: block.config.sort,
        order: block.config.order,
      });

      if (!items || items.length === 0) {
        return '';
      }

      return renderContentItems(items);
    },
    source: 'core',
  });
}

/**
 * Render menu items as HTML
 *
 * @param {array} items - Menu items
 * @returns {string} - HTML string
 */
function renderMenuItems(items) {
  if (!items || items.length === 0) {
    return '';
  }

  const html = items.map((item) => {
    const children = item.children ? renderMenuItems(item.children) : '';
    return `<li><a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a>${children}</li>`;
  }).join('\n');

  return `<ul class="menu">\n${html}\n</ul>`;
}

/**
 * Render content items as HTML
 *
 * @param {array} items - Content items
 * @returns {string} - HTML string
 */
function renderContentItems(items) {
  if (!items || items.length === 0) {
    return '';
  }

  const html = items.map((item) => {
    const title = escapeHtml(item.title || item.id);
    const url = item.slug ? `/${item.slug}` : `/${item.id}`;
    return `<li><a href="${escapeHtml(url)}">${title}</a></li>`;
  }).join('\n');

  return `<ul class="content-list">\n${html}\n</ul>`;
}
