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

// ============================================
// Types
// ============================================

/** Block type definition -- defines what kinds of blocks can be created */
interface BlockType {
  id: string;
  label: string;
  description: string;
  category: string;
  icon: string;
  schema: Record<string, unknown>;
  defaults: Record<string, unknown>;
  template: string | null;
  render: ((block: BlockInstance, context: RenderContext) => Promise<string>) | null;
  source: string;
  userCreatable: boolean;
}

/** A block instance stored on disk and cached in memory */
interface BlockInstance {
  id: string;
  type: string;
  adminTitle: string;
  title: string;
  showTitle: boolean;
  regionId: string | null;
  weight: number;
  config: Record<string, unknown>;
  visibility: VisibilityRule[];
  enabled: boolean;
  cache: BlockCacheConfig;
  created: string;
  updated: string;
  [key: string]: unknown;
}

/** Block cache configuration */
interface BlockCacheConfig {
  mode: string;
  maxAge: number;
}

/** Visibility rule for a block */
interface VisibilityRule {
  type: string;
  show?: boolean;
  config: Record<string, unknown>;
}

/** Region definition */
interface RegionDef {
  id: string;
  label: string;
  description: string;
  template: string | null;
  weight: number;
}

/** Render context passed to block renderers */
interface RenderContext {
  path: string;
  content?: { type: string; [key: string]: unknown };
  user?: { id: string; roles: string[]; [key: string]: unknown };
  query: Record<string, unknown>;
  services?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Cached rendered block entry */
interface RenderCacheEntry {
  html: string;
  timestamp: number;
}

/** Rendered block result */
interface RenderedBlock extends BlockInstance {
  html: string;
  cached: boolean;
  renderTime: number;
}

/** Block list query options */
interface ListBlocksOptions {
  regionId?: string;
  type?: string;
  enabled?: boolean;
  sort?: string;
  order?: string;
  offset?: number;
  limit?: number;
}

/** Block list result */
interface ListBlocksResult {
  items: BlockInstance[];
  total: number;
  offset: number;
  limit: number;
}

/** Block import data */
interface BlockExportData {
  block: BlockInstance;
  type: BlockType;
}

/** Block import options */
interface BlockImportOptions {
  overwrite?: boolean;
}

/** Block creation input */
interface CreateBlockInput {
  type: string;
  adminTitle: string;
  title?: string;
  showTitle?: boolean;
  regionId?: string | null;
  weight?: number;
  config?: Record<string, unknown>;
  visibility?: VisibilityRule[];
  enabled?: boolean;
  cache?: Partial<BlockCacheConfig>;
}

/** Block update input */
interface UpdateBlockInput {
  adminTitle?: string;
  title?: string;
  showTitle?: boolean;
  regionId?: string | null;
  weight?: number;
  config?: Record<string, unknown>;
  visibility?: VisibilityRule[];
  enabled?: boolean;
  cache?: Partial<BlockCacheConfig>;
}

/** Module configuration */
interface BlocksConfig {
  enabled: boolean;
  cache: {
    enabled: boolean;
    defaultMode: string;
    defaultMaxAge: number;
  };
  builtinTypes: boolean;
}

/** Template service interface */
interface TemplateServiceInterface {
  render(template: string, data: Record<string, unknown>): string;
}

/** Content service interface */
interface ContentServiceInterface {
  [key: string]: unknown;
}

/** Hooks service interface */
interface HooksServiceInterface {
  fire(event: string, data: Record<string, unknown>): unknown;
}

// ============================================
// Module State
// ============================================

/**
 * Block type registry
 */
const blockTypes: Record<string, BlockType> = {};

/**
 * Region registry
 */
const regions: Record<string, RegionDef> = {};

/**
 * Block instances cache
 */
const blockCache: Record<string, BlockInstance> = {};

/**
 * Rendered block cache
 */
const renderCache: Map<string, RenderCacheEntry> = new Map();

/**
 * Base directory for content storage
 */
let baseDir: string | null = null;

/**
 * Template service reference for rendering
 */
let templateService: TemplateServiceInterface | null = null;

/**
 * Content service reference for storage
 */
let contentService: ContentServiceInterface | null = null;

/**
 * Hooks service reference
 */
let hooksService: HooksServiceInterface | null = null;

/**
 * Configuration
 */
let config: BlocksConfig = {
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
 * @param directory - Base directory for content storage
 * @param templateSvc - Template service instance
 * @param cfg - Configuration object
 */
export function init(directory: string, templateSvc: TemplateServiceInterface, cfg: Partial<BlocksConfig> = {}): void {
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
 * @param service - Hooks service instance
 */
export function setHooks(service: HooksServiceInterface): void {
  hooksService = service;
}

/**
 * Set content service reference
 *
 * @param service - Content service instance
 */
export function setContentService(service: ContentServiceInterface): void {
  contentService = service;
}

// ============================================
// BLOCK TYPE MANAGEMENT
// ============================================

/**
 * Register a block type
 *
 * @param input - Block type definition
 * @throws Error if type ID is missing or already registered
 */
export function registerBlockType(input: Partial<BlockType> & { id: string }): void {
  if (!input.id) {
    throw new Error('Block type ID is required');
  }

  if (blockTypes[input.id]) {
    throw new Error(`Block type already registered: ${input.id}`);
  }

  // Build full type definition
  const type: BlockType = {
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
 * @param id - Block type ID
 * @returns Block type or null if not found
 */
export function getBlockType(id: string): BlockType | null {
  return blockTypes[id] || null;
}

/**
 * List all block types
 *
 * @param category - Optional category filter
 * @returns Array of block types
 */
export function listBlockTypes(category: string | null = null): BlockType[] {
  const types = Object.values(blockTypes);

  if (category) {
    return types.filter((t) => t.category === category);
  }

  return types;
}

/**
 * List block type categories
 *
 * @returns Array of unique category names
 */
export function listCategories(): string[] {
  const categories = new Set<string>();
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
 * @param region - Region definition
 * @throws Error if region ID is missing
 */
export function registerRegion(region: Partial<RegionDef> & { id: string }): void {
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
 * @param id - Region ID
 * @returns Region or null if not found
 */
export function getRegion(id: string): RegionDef | null {
  return regions[id] || null;
}

/**
 * List all regions
 *
 * @returns Array of regions sorted by weight
 */
export function listRegions(): RegionDef[] {
  return Object.values(regions).sort((a, b) => a.weight - b.weight);
}

// ============================================
// BLOCK INSTANCE MANAGEMENT
// ============================================

/**
 * Generate a unique block ID
 *
 * @returns Unique ID (hex string)
 */
function generateId(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Get file path for a block
 *
 * @param id - Block ID
 * @returns Absolute file path
 */
function getBlockPath(id: string): string {
  return join(baseDir!, 'content', 'block', `${id}.json`);
}

/**
 * Load all blocks into cache
 *
 * WHY CACHE:
 * - Blocks are frequently accessed during page rendering
 * - File I/O is expensive
 * - Cache invalidated on create/update/delete
 */
function loadAllBlocks(): void {
  const blocksDir = join(baseDir!, 'content', 'block');

  if (!existsSync(blocksDir)) {
    return;
  }

  const files = readdirSync(blocksDir);

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const filePath = join(blocksDir, file);
    try {
      const content = readFileSync(filePath, 'utf-8');
      const block = JSON.parse(content) as BlockInstance;
      blockCache[block.id] = block;
    } catch (err: unknown) {
      console.error(`Failed to load block from ${file}:`, err instanceof Error ? err.message : err);
    }
  }
}

/**
 * Save block to disk and cache
 *
 * @param block - Block instance
 */
function saveBlock(block: BlockInstance): void {
  const filePath = getBlockPath(block.id);
  writeFileSync(filePath, JSON.stringify(block, null, 2), 'utf-8');
  blockCache[block.id] = block;
}

/**
 * Create a new block
 *
 * @param input - Block data
 * @returns Created block
 * @throws Error if block type not found
 */
export async function createBlock(input: CreateBlockInput): Promise<BlockInstance> {
  // Validate type exists
  const type = getBlockType(input.type);
  if (!type) {
    throw new Error(`Block type not found: ${input.type}`);
  }

  // Build block instance
  const block: BlockInstance = {
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
 * @param id - Block ID
 * @returns Block or null if not found
 */
export function getBlock(id: string): BlockInstance | null {
  return blockCache[id] || null;
}

/**
 * Update a block
 *
 * @param id - Block ID
 * @param input - Updated data
 * @returns Updated block
 * @throws Error if block not found
 */
export async function updateBlock(id: string, input: UpdateBlockInput): Promise<BlockInstance> {
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
 * @param id - Block ID
 * @throws Error if block not found
 */
export async function deleteBlock(id: string): Promise<void> {
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
 * @param options - Query options
 * @returns Paginated block list
 */
export function listBlocks(options: ListBlocksOptions = {}): ListBlocksResult {
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
    const aVal = a[sortField] as string | number;
    const bVal = b[sortField] as string | number;
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
 * @param blockId - Block ID
 * @param regionId - Target region (null to unassign)
 * @param weight - Optional new weight
 * @returns Updated block
 */
export async function moveToRegion(blockId: string, regionId: string | null, weight: number | null = null): Promise<BlockInstance> {
  const updates: UpdateBlockInput = { regionId };
  if (weight !== null) {
    updates.weight = weight;
  }
  return updateBlock(blockId, updates);
}

/**
 * Reorder blocks within region
 *
 * @param regionId - Region ID
 * @param blockIds - Block IDs in desired order
 */
export async function reorderBlocks(regionId: string, blockIds: string[]): Promise<void> {
  for (let i = 0; i < blockIds.length; i++) {
    await updateBlock(blockIds[i]!, { weight: i });
  }
}

/**
 * Get blocks by type
 *
 * @param typeId - Block type ID
 * @returns Blocks of this type
 */
export function getBlocksByType(typeId: string): BlockInstance[] {
  return Object.values(blockCache).filter((b) => b.type === typeId);
}

// ============================================
// VISIBILITY
// ============================================

/**
 * Check if a path matches a pattern
 *
 * @param path - Current path
 * @param pattern - Pattern to match (supports * wildcard)
 * @returns True if matches
 */
function matchPath(path: string, pattern: string): boolean {
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
 * @param block - Block to check
 * @param context - Render context
 * @returns True if visible
 */
export function checkVisibility(block: BlockInstance, context: RenderContext): boolean {
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
          const paths = (rule.config.paths || []) as string[];
          matches = paths.some((pattern: string) => matchPath(context.path, pattern));
        }
        break;

      case 'content':
        {
          if (!context.content) break;
          const types = (rule.config.contentTypes || []) as string[];
          matches = types.includes(context.content.type);
        }
        break;

      case 'roles':
        {
          if (!context.user) break;
          const roles = (rule.config.roles || []) as string[];
          matches = roles.some((role: string) => context.user!.roles.includes(role));
        }
        break;

      case 'query':
        {
          const queryRules = (rule.config.query || {}) as Record<string, unknown>;
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
          const callbackName = rule.config.callback as string | undefined;
          if (callbackName && typeof (globalThis as Record<string, unknown>)[callbackName] === 'function') {
            matches = ((globalThis as Record<string, unknown>)[callbackName] as (b: BlockInstance, c: RenderContext) => boolean)(block, context);
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
    }) as { visible?: boolean } | null;
    if (result && result.visible !== undefined) {
      visible = result.visible;
    }
  }

  return visible;
}

/**
 * Add visibility rule to block
 *
 * @param blockId - Block ID
 * @param rule - Visibility rule
 * @returns Updated block
 */
export async function addVisibilityRule(blockId: string, rule: VisibilityRule): Promise<BlockInstance> {
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
 * @param blockId - Block ID
 * @param ruleIndex - Index of rule to remove
 * @returns Updated block
 */
export async function removeVisibilityRule(blockId: string, ruleIndex: number): Promise<BlockInstance> {
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
 * @param block - Block instance
 * @param context - Render context
 * @returns Cache key
 */
export function getCacheKey(block: BlockInstance, context: RenderContext): string {
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
 * @param blockId - Block ID
 * @param context - Render context
 * @returns Rendered block with metadata
 */
export async function renderBlock(blockId: string, context: RenderContext): Promise<RenderedBlock> {
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
    const data: Record<string, unknown> = {
      ...block.config,
      block,
      context,
    };
    html = templateService!.render(type.template, data);
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
    }) as { html?: string } | null;
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
 * @param regionId - Region ID
 * @param context - Render context
 * @returns Array of rendered blocks
 */
export async function renderRegion(regionId: string, context: RenderContext): Promise<RenderedBlock[]> {
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
  const rendered: RenderedBlock[] = [];
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
 * @param context - Render context
 * @returns Map of regionId -> rendered blocks
 */
export async function renderAllRegions(context: RenderContext): Promise<Map<string, RenderedBlock[]>> {
  const result = new Map<string, RenderedBlock[]>();
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
 * @param blockId - Block ID (all if omitted)
 */
export function clearCache(blockId: string | null = null): void {
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
 * @param blockId - Source block ID
 * @param overrides - Optional property overrides
 * @returns Cloned block
 */
export async function cloneBlock(blockId: string, overrides: Partial<CreateBlockInput> = {}): Promise<BlockInstance> {
  const source = getBlock(blockId);
  if (!source) {
    throw new Error(`Block not found: ${blockId}`);
  }

  const input: CreateBlockInput = {
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
 * @param blockId - Block ID
 * @returns Exportable block data
 */
export function exportBlock(blockId: string): BlockExportData {
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
 * @param data - Exported block data
 * @param options - Import options
 * @returns Imported block
 */
export async function importBlock(data: BlockExportData, options: BlockImportOptions = {}): Promise<BlockInstance> {
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
  const input: CreateBlockInput = {
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
 * @param str - String to escape
 * @returns Escaped string
 */
function escapeHtml(str: string): string {
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
 */
function registerBuiltinTypes(): void {
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
    render: async (block: BlockInstance) => {
      return (block.config.body || '') as string;
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
      menuId: { type: 'string', label: 'Menu', required: true },
      level: { type: 'number', label: 'Starting Level', defaultValue: 0 },
      maxDepth: { type: 'number', label: 'Maximum Depth', defaultValue: 0 },
    },
    defaults: {
      menuId: 'main',
      level: 0,
      maxDepth: 0,
    },
    render: async (block: BlockInstance, context: RenderContext) => {
      // Requires menu service
      const menuService = (context.services as Record<string, unknown> | undefined)?.menu as { renderMenu(id: string, opts: Record<string, unknown>): MenuItem[] } | undefined;
      if (!menuService) {
        return '<!-- Menu service not available -->';
      }

      const items = menuService.renderMenu(block.config.menuId as string, {
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
      contentType: { type: 'string', label: 'Content Type', required: true },
      limit: { type: 'number', label: 'Number of Items', defaultValue: 5 },
      sort: { type: 'string', label: 'Sort By', defaultValue: 'created' },
      order: { type: 'select', label: 'Order', options: ['asc', 'desc'], defaultValue: 'desc' },
    },
    defaults: {
      contentType: 'page',
      limit: 5,
      sort: 'created',
      order: 'desc',
    },
    render: async (block: BlockInstance, context: RenderContext) => {
      // Requires content service
      const contentSvc = (context.services as Record<string, unknown> | undefined)?.content as { list(type: string, opts: Record<string, unknown>): { items: ContentItem[] } } | undefined;
      if (!contentSvc) {
        return '<!-- Content service not available -->';
      }

      const { items } = contentSvc.list(block.config.contentType as string, {
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

/** Menu item for rendering */
interface MenuItem {
  title: string;
  url: string;
  children?: MenuItem[];
}

/** Content item for rendering */
interface ContentItem {
  id?: string;
  title?: string;
  slug?: string;
  [key: string]: unknown;
}

/**
 * Render menu items as HTML
 *
 * @param items - Menu items
 * @returns HTML string
 */
function renderMenuItems(items: MenuItem[]): string {
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
 * @param items - Content items
 * @returns HTML string
 */
function renderContentItems(items: ContentItem[]): string {
  if (!items || items.length === 0) {
    return '';
  }

  const html = items.map((item) => {
    const title = escapeHtml(item.title || item.id || '');
    const url = item.slug ? `/${item.slug}` : `/${item.id || ''}`;
    return `<li><a href="${escapeHtml(url)}">${title}</a></li>`;
  }).join('\n');

  return `<ul class="content-list">\n${html}\n</ul>`;
}
