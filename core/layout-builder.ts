/**
 * layout-builder.js - Section-Based Layout Builder
 *
 * WHY LAYOUT BUILDER:
 * ===================
 * Traditional CMS layouts are rigid - themes define regions, blocks go in regions.
 * Layout Builder flips this: content authors can assemble layouts per-page using
 * flexible "sections" with configurable columns.
 *
 * INSPIRED BY DRUPAL'S LAYOUT BUILDER:
 * - Sections are rows in a page layout
 * - Each section uses a "layout plugin" (1-col, 2-col, 3-col, etc.)
 * - Blocks are placed into specific regions within sections
 * - Supports default layouts per content type
 * - Supports per-entity layout overrides
 *
 * KEY CONCEPTS:
 * =============
 * 1. LAYOUT DEFINITIONS - Column templates (e.g., "two_column" with regions: first, second)
 * 2. SECTIONS - Instances of layouts with specific settings
 * 3. SECTION COMPONENTS - Blocks placed within section regions
 * 4. LAYOUT STORAGE - Where layouts are saved (content type defaults, per-entity)
 *
 * STORAGE STRATEGY:
 * =================
 * - Layout definitions: config/layouts.json (built-in + custom)
 * - Content type defaults: config/layout-defaults/<type>.json
 * - Per-content overrides: stored in content item's `_layout` field
 *
 * WHY NOT USE REGIONS.JS:
 * ======================
 * Regions are theme-level (site-wide sidebars, headers).
 * Layout Builder is content-level (per-page layout flexibility).
 * Both can coexist - regions for chrome, layout builder for main content area.
 *
 * DESIGN DECISIONS:
 * =================
 * 1. Sections are ordered arrays, not weighted objects (simpler reordering)
 * 2. Layout overrides are opt-in per content type (not all content needs flexibility)
 * 3. Layout definitions are static; sections/components are dynamic
 * 4. Render output is framework-agnostic HTML
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

// ============================================
// TYPE DEFINITIONS
// ============================================

/** A region within a layout definition */
interface LayoutRegion {
  /** Region label (e.g., 'First Column') */
  label: string;
  /** Optional description */
  description?: string;
  /** Display order (lower = first) */
  weight?: number;
}

/** A layout definition describing a column/region template */
interface LayoutDefinition {
  /** Unique layout ID (e.g., 'two_column') */
  id: string;
  /** Human-readable label */
  label: string;
  /** Optional description */
  description: string;
  /** Layout category (e.g., 'Columns', 'Grid') */
  category: string;
  /** Icon identifier */
  icon: string;
  /** Regions in this layout */
  regions: Record<string, LayoutRegion>;
  /** Optional template string/path */
  template: string | null;
  /** Default settings for new sections */
  defaultSettings: Record<string, unknown>;
  /** Where this layout came from ('builtin', 'config', 'custom') */
  source?: string;
}

/** Input for registering a layout (partial, pre-defaults) */
interface LayoutDefinitionInput {
  id: string;
  label?: string;
  description?: string;
  category?: string;
  icon?: string;
  regions: Record<string, LayoutRegion>;
  template?: string | null;
  defaultSettings?: Record<string, unknown>;
  source?: string;
}

/** A component placed within a section region */
interface SectionComponent {
  /** Unique identifier for this component */
  uuid: string;
  /** Component type ('block', 'field', 'inline_block') */
  type: string;
  /** For type='block', the block instance ID */
  blockId?: string;
  /** For type='inline_block', the block type ID */
  blockType?: string;
  /** For type='field', the content field name */
  fieldName?: string;
  /** Type-specific configuration */
  configuration?: Record<string, unknown>;
  /** Order within the region (lower = first) */
  weight: number;
}

/** A section instance within a layout */
interface Section {
  /** Unique identifier for this section instance */
  uuid: string;
  /** ID of the layout definition to use */
  layoutId: string;
  /** Layout-specific settings (e.g., column widths) */
  settings: Record<string, unknown>;
  /** Components keyed by region ID */
  components: Record<string, SectionComponent[]>;
  /** Section order (lower = first) */
  weight: number;
}

/** Serialized layout storage format */
interface LayoutStorage {
  /** Optional identifier (for content type defaults) */
  id?: string;
  /** Ordered array of sections */
  sections: Section[];
  /** Last update timestamp */
  updated?: string;
}

/** Result from validateLayout() */
interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Render context passed to component/section renderers */
interface RenderContext {
  content?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Cached rendered layout entry */
interface RenderCacheEntry {
  html: string;
  timestamp: number;
}

/** Configuration for the layout builder module */
interface LayoutBuilderConfig {
  enabled: boolean;
  /** Enable per-content layout overrides (requires content types to opt-in) */
  enableOverrides: boolean;
  /** Default cache TTL for rendered layouts (seconds) */
  cacheTtl: number;
  /** CSS class prefix for layout elements */
  classPrefix: string;
}

/** Custom layouts config file structure */
interface CustomLayoutsFile {
  layouts: Record<string, LayoutDefinitionInput>;
}

// ---- Service interfaces (describing the methods we call) ----

interface ContentServiceInterface {
  read(contentType: string, contentId: string): Record<string, unknown> | null;
  update(contentType: string, contentId: string, data: Record<string, unknown>): Promise<void>;
}

interface BlocksServiceInterface {
  renderBlock(blockId: string, context: RenderContext): Promise<{ html?: string }>;
  getBlockType(blockType: string): { render?: (block: Record<string, unknown>, context: RenderContext) => Promise<string> } | null;
}

interface HooksServiceInterface {
  invoke(hook: string, data: Record<string, unknown>): Promise<Record<string, unknown> | void>;
}

// ============================================
// MODULE STATE
// ============================================

/**
 * Base directory for storage
 */
let baseDir: string | null = null;

/**
 * Content service reference
 */
let contentService: ContentServiceInterface | null = null;

/**
 * Blocks service reference
 */
let blocksService: BlocksServiceInterface | null = null;

/**
 * Hooks service reference
 */
let hooksService: HooksServiceInterface | null = null;

/**
 * Template service reference (reserved for future template-based layout rendering)
 */
let templateService: unknown = null;

/**
 * Configuration
 */
let config: LayoutBuilderConfig = {
  enabled: true,
  /** Enable per-content layout overrides (requires content types to opt-in) */
  enableOverrides: true,
  /** Default cache TTL for rendered layouts (seconds) */
  cacheTtl: 300,
  /** CSS class prefix for layout elements */
  classPrefix: 'layout',
};

/**
 * In-memory layout definitions registry
 * Structure: { layoutId: LayoutDefinition }
 */
const layoutDefinitions: Record<string, LayoutDefinition> = {};

/**
 * Content type default layouts cache
 * Structure: { contentType: LayoutStorage }
 */
const defaultLayouts: Record<string, LayoutStorage> = {};

/**
 * Rendered layout cache
 * Structure: Map of cacheKey -> { html, timestamp }
 */
const renderCache: Map<string, RenderCacheEntry> = new Map();

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize Layout Builder
 *
 * WHY DEPENDENCIES:
 * - Content service: read/write content items with layouts
 * - Blocks service: render block components
 */
export function init(
  directory: string,
  contentSvc: ContentServiceInterface,
  blocksSvc: BlocksServiceInterface,
  cfg: Partial<LayoutBuilderConfig> = {},
): void {
  baseDir = directory;
  contentService = contentSvc;
  blocksService = blocksSvc;
  config = { ...config, ...cfg };

  // Ensure directories exist
  const layoutsDir = join(baseDir, 'config', 'layout-defaults');
  if (!existsSync(layoutsDir)) {
    mkdirSync(layoutsDir, { recursive: true });
  }

  // Register built-in layouts
  registerBuiltinLayouts();

  // Load custom layouts
  loadCustomLayouts();

  // Load content type defaults
  loadDefaultLayouts();
}

/**
 * Set hooks service reference
 */
export function setHooks(service: HooksServiceInterface): void {
  hooksService = service;
}

/**
 * Set template service reference
 */
export function setTemplate(service: unknown): void {
  templateService = service;
}

// ============================================
// BUILT-IN LAYOUTS
// ============================================

/**
 * Register built-in layout definitions
 *
 * WHY BUILT-INS:
 * - Common layouts everyone needs (1-col, 2-col, 3-col)
 * - Examples for custom layout creation
 * - Work out-of-box without configuration
 */
function registerBuiltinLayouts(): void {
  // One Column - Full Width
  registerLayout({
    id: 'one_column',
    label: 'One Column',
    description: 'Single full-width column',
    category: 'Columns',
    icon: 'layout-1',
    regions: {
      content: { label: 'Content', weight: 0 },
    },
    defaultSettings: {},
  });

  // Two Column - Equal Width
  registerLayout({
    id: 'two_column',
    label: 'Two Column',
    description: 'Two equal-width columns',
    category: 'Columns',
    icon: 'layout-2',
    regions: {
      first: { label: 'First', weight: 0 },
      second: { label: 'Second', weight: 1 },
    },
    defaultSettings: {
      columnWidths: '50-50',
    },
  });

  // Two Column - Sidebar Left
  registerLayout({
    id: 'two_column_sidebar_left',
    label: 'Sidebar Left',
    description: 'Narrow sidebar on left, wide content on right',
    category: 'Columns',
    icon: 'layout-sidebar-left',
    regions: {
      sidebar: { label: 'Sidebar', weight: 0 },
      content: { label: 'Content', weight: 1 },
    },
    defaultSettings: {
      columnWidths: '33-67',
    },
  });

  // Two Column - Sidebar Right
  registerLayout({
    id: 'two_column_sidebar_right',
    label: 'Sidebar Right',
    description: 'Wide content on left, narrow sidebar on right',
    category: 'Columns',
    icon: 'layout-sidebar-right',
    regions: {
      content: { label: 'Content', weight: 0 },
      sidebar: { label: 'Sidebar', weight: 1 },
    },
    defaultSettings: {
      columnWidths: '67-33',
    },
  });

  // Three Column - Equal Width
  registerLayout({
    id: 'three_column',
    label: 'Three Column',
    description: 'Three equal-width columns',
    category: 'Columns',
    icon: 'layout-3',
    regions: {
      first: { label: 'First', weight: 0 },
      second: { label: 'Second', weight: 1 },
      third: { label: 'Third', weight: 2 },
    },
    defaultSettings: {
      columnWidths: '33-33-33',
    },
  });

  // Four Column
  registerLayout({
    id: 'four_column',
    label: 'Four Column',
    description: 'Four equal-width columns',
    category: 'Columns',
    icon: 'layout-4',
    regions: {
      first: { label: 'First', weight: 0 },
      second: { label: 'Second', weight: 1 },
      third: { label: 'Third', weight: 2 },
      fourth: { label: 'Fourth', weight: 3 },
    },
    defaultSettings: {
      columnWidths: '25-25-25-25',
    },
  });

  // Stacked Sections
  registerLayout({
    id: 'stacked',
    label: 'Stacked',
    description: 'Two stacked full-width regions',
    category: 'Special',
    icon: 'layout-stacked',
    regions: {
      top: { label: 'Top', weight: 0 },
      bottom: { label: 'Bottom', weight: 1 },
    },
    defaultSettings: {},
  });

  // Hero + Content
  registerLayout({
    id: 'hero_content',
    label: 'Hero + Content',
    description: 'Full-width hero region with content below',
    category: 'Special',
    icon: 'layout-hero',
    regions: {
      hero: { label: 'Hero', weight: 0 },
      content: { label: 'Content', weight: 1 },
    },
    defaultSettings: {
      heroHeight: 'auto',
    },
  });
}

// ============================================
// LAYOUT DEFINITION MANAGEMENT
// ============================================

/**
 * Register a layout definition
 *
 * @throws {Error} If layout ID already exists or required fields missing
 */
export function registerLayout(definition: LayoutDefinitionInput): void {
  if (!definition.id) {
    throw new Error('Layout definition requires an ID');
  }

  if (!definition.regions || Object.keys(definition.regions).length === 0) {
    throw new Error(`Layout "${definition.id}" must have at least one region`);
  }

  if (layoutDefinitions[definition.id]) {
    throw new Error(`Layout already registered: ${definition.id}`);
  }

  layoutDefinitions[definition.id] = {
    id: definition.id,
    label: definition.label || definition.id,
    description: definition.description || '',
    category: definition.category || 'Custom',
    icon: definition.icon || 'layout',
    regions: definition.regions,
    template: definition.template || null,
    defaultSettings: definition.defaultSettings || {},
    source: definition.source || 'custom',
  };

  // Fire hook
  if (hooksService) {
    hooksService.invoke('layout:register', { layout: layoutDefinitions[definition.id]! });
  }
}

/**
 * Unregister a layout definition
 *
 * @throws {Error} If layout is in use
 */
export function unregisterLayout(layoutId: string): void {
  if (!layoutDefinitions[layoutId]) {
    throw new Error(`Layout not found: ${layoutId}`);
  }

  // Check if layout is used in any defaults
  for (const [type, storage] of Object.entries(defaultLayouts)) {
    for (const section of storage.sections || []) {
      if (section.layoutId === layoutId) {
        throw new Error(`Cannot unregister layout "${layoutId}": used in content type "${type}"`);
      }
    }
  }

  delete layoutDefinitions[layoutId];
}

/**
 * Get a layout definition by ID
 */
export function getLayout(layoutId: string): LayoutDefinition | null {
  return layoutDefinitions[layoutId] || null;
}

/**
 * List all layout definitions
 */
export function listLayouts(options: { category?: string } = {}): LayoutDefinition[] {
  let layouts = Object.values(layoutDefinitions);

  if (options.category) {
    layouts = layouts.filter(l => l.category === options.category);
  }

  return layouts.sort((a, b) => {
    // Sort by category, then by label
    if (a.category !== b.category) {
      return a.category.localeCompare(b.category);
    }
    return a.label.localeCompare(b.label);
  });
}

/**
 * List layout categories
 */
export function listCategories(): string[] {
  const categories = new Set<string>();
  Object.values(layoutDefinitions).forEach(l => categories.add(l.category));
  return Array.from(categories).sort();
}

/**
 * Load custom layouts from config/layouts.json
 */
function loadCustomLayouts(): void {
  const layoutsPath = join(baseDir!, 'config', 'layouts.json');

  if (!existsSync(layoutsPath)) {
    return;
  }

  try {
    const data = JSON.parse(readFileSync(layoutsPath, 'utf-8')) as CustomLayoutsFile;

    for (const [id, def] of Object.entries(data.layouts || {})) {
      if (!layoutDefinitions[id]) {
        registerLayout({ ...def, id, source: 'config' });
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[layout-builder] Failed to load custom layouts:', message);
  }
}

/**
 * Save custom layout to config/layouts.json
 */
export function saveCustomLayout(definition: LayoutDefinition): void {
  const layoutsPath = join(baseDir!, 'config', 'layouts.json');

  let data: CustomLayoutsFile = { layouts: {} };

  if (existsSync(layoutsPath)) {
    try {
      data = JSON.parse(readFileSync(layoutsPath, 'utf-8')) as CustomLayoutsFile;
    } catch (_err: unknown) {
      // Start fresh
    }
  }

  data.layouts[definition.id] = definition;
  writeFileSync(layoutsPath, JSON.stringify(data, null, 2), 'utf-8');
}

// ============================================
// SECTION MANAGEMENT
// ============================================

/**
 * Generate a unique UUID for sections/components
 */
function generateUuid(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Create a new section
 */
export function createSection(layoutId: string, settings: Record<string, unknown> = {}): Section {
  const layout = getLayout(layoutId);

  if (!layout) {
    throw new Error(`Layout not found: ${layoutId}`);
  }

  // Initialize empty component arrays for each region
  const components: Record<string, SectionComponent[]> = {};
  for (const regionId of Object.keys(layout.regions)) {
    components[regionId] = [];
  }

  return {
    uuid: generateUuid(),
    layoutId,
    settings: { ...layout.defaultSettings, ...settings },
    components,
    weight: 0,
  };
}

/**
 * Add a component to a section region
 */
export function addComponent(section: Section, regionId: string, component: SectionComponent): Section {
  const layout = getLayout(section.layoutId);

  if (!layout) {
    throw new Error(`Layout not found: ${section.layoutId}`);
  }

  if (!layout.regions[regionId]) {
    throw new Error(`Region "${regionId}" not found in layout "${section.layoutId}"`);
  }

  if (!section.components[regionId]) {
    section.components[regionId] = [];
  }

  // Assign UUID if not present
  if (!component.uuid) {
    component.uuid = generateUuid();
  }

  // Set weight if not present
  if (component.weight === undefined) {
    component.weight = section.components[regionId]!.length;
  }

  section.components[regionId]!.push(component);

  // Sort by weight
  section.components[regionId]!.sort((a, b) => a.weight - b.weight);

  return section;
}

/**
 * Remove a component from a section
 */
export function removeComponent(section: Section, componentUuid: string): Section {
  for (const regionId of Object.keys(section.components)) {
    const regionComponents = section.components[regionId]!;
    const index = regionComponents.findIndex(c => c.uuid === componentUuid);
    if (index !== -1) {
      regionComponents.splice(index, 1);
      // Recompute weights
      regionComponents.forEach((c, i) => {
        c.weight = i;
      });
      break;
    }
  }

  return section;
}

/**
 * Move a component within or between regions
 */
export function moveComponent(
  section: Section,
  componentUuid: string,
  targetRegion: string,
  targetIndex: number,
): Section {
  // Find and remove the component from its current location
  let component: SectionComponent | null = null;

  for (const regionId of Object.keys(section.components)) {
    const regionComponents = section.components[regionId]!;
    const index = regionComponents.findIndex(c => c.uuid === componentUuid);
    if (index !== -1) {
      component = regionComponents.splice(index, 1)[0]!;
      break;
    }
  }

  if (!component) {
    throw new Error(`Component not found: ${componentUuid}`);
  }

  // Insert at new position
  if (!section.components[targetRegion]) {
    section.components[targetRegion] = [];
  }

  section.components[targetRegion]!.splice(targetIndex, 0, component);

  // Recompute weights for all regions
  for (const regionId of Object.keys(section.components)) {
    section.components[regionId]!.forEach((c, i) => {
      c.weight = i;
    });
  }

  return section;
}

/**
 * Create a block component
 */
export function createBlockComponent(
  blockId: string,
  configuration: Record<string, unknown> = {},
): SectionComponent {
  return {
    uuid: generateUuid(),
    type: 'block',
    blockId,
    configuration,
    weight: 0,
  };
}

/**
 * Create an inline block component (block defined within the layout)
 */
export function createInlineBlockComponent(
  blockType: string,
  blockConfig: Record<string, unknown> = {},
): SectionComponent {
  return {
    uuid: generateUuid(),
    type: 'inline_block',
    blockType,
    configuration: blockConfig,
    weight: 0,
  };
}

/**
 * Create a field component (renders a content field)
 */
export function createFieldComponent(
  fieldName: string,
  configuration: Record<string, unknown> = {},
): SectionComponent {
  return {
    uuid: generateUuid(),
    type: 'field',
    fieldName,
    configuration,
    weight: 0,
  };
}

// ============================================
// LAYOUT STORAGE
// ============================================

/**
 * Get path for content type default layout
 */
function getDefaultLayoutPath(contentType: string): string {
  return join(baseDir!, 'config', 'layout-defaults', `${contentType}.json`);
}

/**
 * Load default layouts for all content types
 */
function loadDefaultLayouts(): void {
  const layoutsDir = join(baseDir!, 'config', 'layout-defaults');

  if (!existsSync(layoutsDir)) {
    return;
  }

  const files = readdirSync(layoutsDir);

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const contentType = file.replace('.json', '');
    const filePath = join(layoutsDir, file);

    try {
      const data = JSON.parse(readFileSync(filePath, 'utf-8')) as LayoutStorage;
      defaultLayouts[contentType] = data;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[layout-builder] Failed to load default layout for ${contentType}:`, message);
    }
  }
}

/**
 * Get default layout for a content type
 */
export function getDefaultLayout(contentType: string): LayoutStorage | null {
  return defaultLayouts[contentType] || null;
}

/**
 * Set default layout for a content type
 */
export async function setDefaultLayout(contentType: string, layout: LayoutStorage): Promise<void> {
  // Validate sections
  for (const section of layout.sections || []) {
    if (!getLayout(section.layoutId)) {
      throw new Error(`Invalid layout in section: ${section.layoutId}`);
    }
  }

  layout.updated = new Date().toISOString();
  defaultLayouts[contentType] = layout;

  // Persist to disk
  const filePath = getDefaultLayoutPath(contentType);
  writeFileSync(filePath, JSON.stringify(layout, null, 2), 'utf-8');

  // Fire hook
  if (hooksService) {
    await hooksService.invoke('layout:setDefault', { contentType, layout });
  }
}

/**
 * Delete default layout for a content type
 */
export async function deleteDefaultLayout(contentType: string): Promise<void> {
  delete defaultLayouts[contentType];

  const filePath = getDefaultLayoutPath(contentType);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }

  // Fire hook
  if (hooksService) {
    await hooksService.invoke('layout:deleteDefault', { contentType });
  }
}

/**
 * List content types with default layouts
 */
export function listDefaultLayouts(): string[] {
  return Object.keys(defaultLayouts);
}

// ============================================
// PER-CONTENT LAYOUT OVERRIDES
// ============================================

/**
 * Get effective layout for a content item
 * Returns override if exists, otherwise default, otherwise null
 */
export function getEffectiveLayout(
  contentType: string,
  contentId: string | null = null,
  contentItem: Record<string, unknown> | null = null,
): LayoutStorage | null {
  // Check for per-content override
  if (config.enableOverrides && contentId) {
    const item = contentItem || (contentService ? contentService.read(contentType, contentId) : null);

    if (item && item._layout && (item._layout as LayoutStorage).sections) {
      return item._layout as LayoutStorage;
    }
  }

  // Fall back to content type default
  return getDefaultLayout(contentType);
}

/**
 * Set layout override for a specific content item
 */
export async function setContentLayout(
  contentType: string,
  contentId: string,
  layout: LayoutStorage,
): Promise<void> {
  if (!config.enableOverrides) {
    throw new Error('Per-content layout overrides are disabled');
  }

  if (!contentService) {
    throw new Error('Content service not initialized');
  }

  // Validate sections
  for (const section of layout.sections || []) {
    if (!getLayout(section.layoutId)) {
      throw new Error(`Invalid layout in section: ${section.layoutId}`);
    }
  }

  layout.updated = new Date().toISOString();

  // Update content item with layout
  await contentService.update(contentType, contentId, {
    _layout: layout,
  });

  // Clear render cache
  clearCache(`${contentType}:${contentId}`);

  // Fire hook
  if (hooksService) {
    await hooksService.invoke('layout:setContent', { contentType, contentId, layout });
  }
}

/**
 * Remove layout override from a content item (reverts to default)
 */
export async function removeContentLayout(contentType: string, contentId: string): Promise<void> {
  if (!contentService) {
    throw new Error('Content service not initialized');
  }

  await contentService.update(contentType, contentId, {
    _layout: null,
  });

  // Clear render cache
  clearCache(`${contentType}:${contentId}`);

  // Fire hook
  if (hooksService) {
    await hooksService.invoke('layout:removeContent', { contentType, contentId });
  }
}

/**
 * Check if content item has a layout override
 */
export function hasContentLayoutOverride(contentType: string, contentId: string): boolean {
  if (!contentService) {
    return false;
  }

  const item = contentService.read(contentType, contentId);
  return !!(item && item._layout && Array.isArray((item._layout as LayoutStorage).sections));
}

// ============================================
// RENDERING
// ============================================

/**
 * Build CSS classes for a layout section
 */
function buildSectionClasses(section: Section, layout: LayoutDefinition): string {
  const classes = [
    `${config.classPrefix}-section`,
    `${config.classPrefix}-${layout.id}`,
  ];

  // Add column width class if present
  const columnWidths = section.settings.columnWidths as string | undefined;
  if (columnWidths) {
    classes.push(`${config.classPrefix}-${columnWidths.replace(/-/g, '_')}`);
  }

  return classes.join(' ');
}

/**
 * Build CSS classes for a region
 */
function buildRegionClasses(regionId: string, _layout: LayoutDefinition): string {
  return [
    `${config.classPrefix}-region`,
    `${config.classPrefix}-region-${regionId}`,
  ].join(' ');
}

/**
 * Render a single component
 */
async function renderComponent(component: SectionComponent, context: RenderContext): Promise<string> {
  let html = '';

  switch (component.type) {
    case 'block':
      // Render existing block
      if (blocksService && component.blockId) {
        const rendered = await blocksService.renderBlock(component.blockId, context);
        html = rendered.html || '';
      }
      break;

    case 'inline_block':
      // Render inline block configuration
      if (blocksService && component.blockType) {
        const blockType = blocksService.getBlockType(component.blockType);
        if (blockType && blockType.render) {
          // Create a temporary block-like object
          const pseudoBlock: Record<string, unknown> = {
            id: component.uuid,
            type: component.blockType,
            config: component.configuration || {},
            title: (component.configuration as Record<string, unknown> | undefined)?.title || '',
            showTitle: (component.configuration as Record<string, unknown> | undefined)?.showTitle || false,
          };
          html = await blockType.render(pseudoBlock, context);
        }
      }
      break;

    case 'field':
      // Render content field
      if (context.content && component.fieldName) {
        const value = context.content[component.fieldName];
        if (value !== undefined && value !== null) {
          // Simple field rendering - can be enhanced with field formatters
          html = `<div class="${config.classPrefix}-field ${config.classPrefix}-field-${component.fieldName}">${escapeHtml(String(value))}</div>`;
        }
      }
      break;

    default:
      console.warn(`[layout-builder] Unknown component type: ${component.type}`);
  }

  // Wrap component
  if (html) {
    html = `<div class="${config.classPrefix}-component" data-component-uuid="${component.uuid}">\n${html}\n</div>`;
  }

  return html;
}

/**
 * Render a section
 */
async function renderSection(section: Section, context: RenderContext): Promise<string> {
  const layout = getLayout(section.layoutId);

  if (!layout) {
    console.warn(`[layout-builder] Layout not found: ${section.layoutId}`);
    return '';
  }

  // Fire before render hook
  if (hooksService) {
    await hooksService.invoke('layout:section:beforeRender', { section, context });
  }

  // Render components for each region
  const regionHtml: Record<string, string> = {};
  const sortedRegions = Object.entries(layout.regions)
    .sort((a, b) => (a[1].weight || 0) - (b[1].weight || 0));

  for (const [regionId, _regionDef] of sortedRegions) {
    const components = section.components[regionId] || [];
    const componentHtmls: string[] = [];

    for (const component of components.sort((a, b) => a.weight - b.weight)) {
      const componentHtml = await renderComponent(component, context);
      if (componentHtml) {
        componentHtmls.push(componentHtml);
      }
    }

    const regionClasses = buildRegionClasses(regionId, layout);
    regionHtml[regionId] = componentHtmls.length > 0
      ? `<div class="${regionClasses}" data-region="${regionId}">\n${componentHtmls.join('\n')}\n</div>`
      : `<div class="${regionClasses}" data-region="${regionId}"></div>`;
  }

  // Build section wrapper
  const sectionClasses = buildSectionClasses(section, layout);
  const regionsContent = Object.values(regionHtml).join('\n');

  let html = `<div class="${sectionClasses}" data-section-uuid="${section.uuid}" data-layout="${section.layoutId}">
${regionsContent}
</div>`;

  // Fire after render hook
  if (hooksService) {
    const result = await hooksService.invoke('layout:section:afterRender', { section, html, context });
    if (result && (result as Record<string, unknown>).html !== undefined) {
      html = (result as Record<string, unknown>).html as string;
    }
  }

  return html;
}

/**
 * Render a complete layout
 */
export async function renderLayout(
  layout: LayoutStorage,
  context: RenderContext = {},
): Promise<string> {
  if (!layout || !layout.sections || layout.sections.length === 0) {
    return '';
  }

  // Fire before render hook
  if (hooksService) {
    await hooksService.invoke('layout:beforeRender', { layout, context });
  }

  // Sort sections by weight
  const sortedSections = [...layout.sections].sort((a, b) => (a.weight || 0) - (b.weight || 0));

  // Render each section
  const sectionHtmls: string[] = [];

  for (const section of sortedSections) {
    const sectionHtml = await renderSection(section, context);
    if (sectionHtml) {
      sectionHtmls.push(sectionHtml);
    }
  }

  let html = `<div class="${config.classPrefix}-builder">\n${sectionHtmls.join('\n')}\n</div>`;

  // Fire after render hook
  if (hooksService) {
    const result = await hooksService.invoke('layout:afterRender', { layout, html, context });
    if (result && (result as Record<string, unknown>).html !== undefined) {
      html = (result as Record<string, unknown>).html as string;
    }
  }

  return html;
}

/**
 * Render layout for a content item
 */
export async function renderContentLayout(
  contentType: string,
  contentId: string,
  context: RenderContext = {},
): Promise<string> {
  // Check cache
  const cacheKey = `${contentType}:${contentId}:${JSON.stringify(context)}`;
  if (config.cacheTtl > 0 && renderCache.has(cacheKey)) {
    const cached = renderCache.get(cacheKey)!;
    if (Date.now() - cached.timestamp < config.cacheTtl * 1000) {
      return cached.html;
    }
  }

  // Load content if not in context
  let contentItem = context.content;
  if (!contentItem && contentService) {
    contentItem = contentService.read(contentType, contentId) as Record<string, unknown> | null ?? undefined;
  }

  if (!contentItem) {
    throw new Error(`Content not found: ${contentType}/${contentId}`);
  }

  // Get effective layout
  const layout = getEffectiveLayout(contentType, contentId, contentItem);

  if (!layout) {
    return '';
  }

  // Render
  const html = await renderLayout(layout, { ...context, content: contentItem });

  // Cache result
  if (config.cacheTtl > 0) {
    renderCache.set(cacheKey, { html, timestamp: Date.now() });
  }

  return html;
}

// ============================================
// CACHING
// ============================================

/**
 * Clear render cache
 */
export function clearCache(key: string | null = null): void {
  if (key) {
    for (const cacheKey of renderCache.keys()) {
      if (cacheKey.startsWith(key)) {
        renderCache.delete(cacheKey);
      }
    }
  } else {
    renderCache.clear();
  }
}

// ============================================
// SECTION OPERATIONS FOR LAYOUT STORAGE
// ============================================

/**
 * Add a section to a layout storage
 */
export function addSection(
  storage: LayoutStorage,
  section: Section,
  position: number | null = null,
): LayoutStorage {
  if (!storage.sections) {
    storage.sections = [];
  }

  // Assign weight based on position or append
  if (position !== null && position >= 0) {
    // Insert at specific position
    storage.sections.splice(position, 0, section);
    // Recompute weights
    storage.sections.forEach((s, i) => {
      s.weight = i;
    });
  } else {
    // Append
    section.weight = storage.sections.length;
    storage.sections.push(section);
  }

  storage.updated = new Date().toISOString();
  return storage;
}

/**
 * Remove a section from a layout storage
 */
export function removeSection(storage: LayoutStorage, sectionUuid: string): LayoutStorage {
  if (!storage.sections) {
    return storage;
  }

  const index = storage.sections.findIndex(s => s.uuid === sectionUuid);
  if (index !== -1) {
    storage.sections.splice(index, 1);
    // Recompute weights
    storage.sections.forEach((s, i) => {
      s.weight = i;
    });
    storage.updated = new Date().toISOString();
  }

  return storage;
}

/**
 * Move a section within a layout storage
 */
export function moveSection(
  storage: LayoutStorage,
  sectionUuid: string,
  newPosition: number,
): LayoutStorage {
  if (!storage.sections) {
    return storage;
  }

  const index = storage.sections.findIndex(s => s.uuid === sectionUuid);
  if (index === -1) {
    throw new Error(`Section not found: ${sectionUuid}`);
  }

  // Remove from current position
  const [section] = storage.sections.splice(index, 1);

  // Insert at new position
  storage.sections.splice(newPosition, 0, section!);

  // Recompute weights
  storage.sections.forEach((s, i) => {
    s.weight = i;
  });

  storage.updated = new Date().toISOString();
  return storage;
}

/**
 * Get a section from storage by UUID
 */
export function getSection(storage: LayoutStorage, sectionUuid: string): Section | null {
  if (!storage.sections) {
    return null;
  }

  return storage.sections.find(s => s.uuid === sectionUuid) || null;
}

/**
 * Update section settings
 */
export function updateSectionSettings(
  storage: LayoutStorage,
  sectionUuid: string,
  settings: Record<string, unknown>,
): LayoutStorage {
  const section = getSection(storage, sectionUuid);

  if (!section) {
    throw new Error(`Section not found: ${sectionUuid}`);
  }

  section.settings = { ...section.settings, ...settings };
  storage.updated = new Date().toISOString();

  return storage;
}

// ============================================
// UTILITIES
// ============================================

/**
 * Escape HTML special characters
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

/**
 * Clone a layout storage (deep copy)
 */
export function cloneLayout(storage: LayoutStorage): LayoutStorage {
  return JSON.parse(JSON.stringify(storage)) as LayoutStorage;
}

/**
 * Validate a layout storage structure
 */
export function validateLayout(storage: LayoutStorage): ValidationResult {
  const errors: string[] = [];

  if (!storage) {
    errors.push('Layout storage is null or undefined');
    return { valid: false, errors };
  }

  if (!Array.isArray(storage.sections)) {
    errors.push('Layout sections must be an array');
    return { valid: false, errors };
  }

  for (let i = 0; i < storage.sections.length; i++) {
    const section = storage.sections[i]!;

    if (!section.uuid) {
      errors.push(`Section at index ${i} missing UUID`);
    }

    if (!section.layoutId) {
      errors.push(`Section at index ${i} missing layoutId`);
    } else if (!getLayout(section.layoutId)) {
      errors.push(`Section at index ${i} uses unknown layout: ${section.layoutId}`);
    }

    if (typeof section.components !== 'object') {
      errors.push(`Section at index ${i} has invalid components (must be object)`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get configuration
 */
export function getConfig(): LayoutBuilderConfig {
  return { ...config };
}

/**
 * Check if layout builder is enabled
 */
export function isEnabled(): boolean {
  return config.enabled;
}

/**
 * Get statistics about layouts
 */
export function getStats(): {
  layouts: number;
  contentTypesWithDefaults: number;
  totalSections: number;
  totalComponents: number;
  cacheSize: number;
} {
  const layoutCount = Object.keys(layoutDefinitions).length;
  const defaultLayoutCount = Object.keys(defaultLayouts).length;

  let totalSections = 0;
  let totalComponents = 0;

  for (const storage of Object.values(defaultLayouts)) {
    totalSections += storage.sections?.length || 0;
    for (const section of storage.sections || []) {
      for (const components of Object.values(section.components || {})) {
        totalComponents += components.length;
      }
    }
  }

  return {
    layouts: layoutCount,
    contentTypesWithDefaults: defaultLayoutCount,
    totalSections,
    totalComponents,
    cacheSize: renderCache.size,
  };
}
