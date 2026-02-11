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
// MODULE STATE
// ============================================

/**
 * Base directory for storage
 */
let baseDir = null;

/**
 * Content service reference
 */
let contentService = null;

/**
 * Blocks service reference
 */
let blocksService = null;

/**
 * Hooks service reference
 */
let hooksService = null;

/**
 * Template service reference
 */
let templateService = null;

/**
 * Configuration
 */
let config = {
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
const layoutDefinitions = {};

/**
 * Content type default layouts cache
 * Structure: { contentType: LayoutStorage }
 */
const defaultLayouts = {};

/**
 * Rendered layout cache
 * Structure: Map of cacheKey -> { html, timestamp }
 */
const renderCache = new Map();

// ============================================
// TYPE DEFINITIONS (JSDoc)
// ============================================

/**
 * @typedef {Object} LayoutDefinition
 * @property {string} id - Unique layout ID (e.g., 'two_column')
 * @property {string} label - Human-readable label
 * @property {string} [description] - Optional description
 * @property {string} [category] - Layout category (e.g., 'Columns', 'Grid')
 * @property {string} [icon] - Icon identifier
 * @property {Object.<string, LayoutRegion>} regions - Regions in this layout
 * @property {string} [template] - Optional template string/path
 * @property {Object} [defaultSettings] - Default settings for new sections
 */

/**
 * @typedef {Object} LayoutRegion
 * @property {string} label - Region label (e.g., 'First Column')
 * @property {string} [description] - Optional description
 * @property {number} [weight] - Display order (lower = first)
 */

/**
 * @typedef {Object} Section
 * @property {string} uuid - Unique identifier for this section instance
 * @property {string} layoutId - ID of the layout definition to use
 * @property {Object} settings - Layout-specific settings (e.g., column widths)
 * @property {Object.<string, SectionComponent[]>} components - Components keyed by region
 * @property {number} weight - Section order (lower = first)
 */

/**
 * @typedef {Object} SectionComponent
 * @property {string} uuid - Unique identifier for this component
 * @property {string} type - Component type ('block', 'field', 'inline_block')
 * @property {string} [blockId] - For type='block', the block instance ID
 * @property {Object} [configuration] - Type-specific configuration
 * @property {number} weight - Order within the region (lower = first)
 */

/**
 * @typedef {Object} LayoutStorage
 * @property {string} [id] - Optional identifier (for content type defaults)
 * @property {Section[]} sections - Ordered array of sections
 * @property {string} [updated] - Last update timestamp
 */

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize Layout Builder
 *
 * @param {string} directory - Base directory
 * @param {Object} contentSvc - Content service instance
 * @param {Object} blocksSvc - Blocks service instance
 * @param {Object} cfg - Configuration options
 *
 * WHY DEPENDENCIES:
 * - Content service: read/write content items with layouts
 * - Blocks service: render block components
 */
export function init(directory, contentSvc, blocksSvc, cfg = {}) {
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
 * @param {Object} service - Hooks service
 */
export function setHooks(service) {
  hooksService = service;
}

/**
 * Set template service reference
 * @param {Object} service - Template service
 */
export function setTemplate(service) {
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
function registerBuiltinLayouts() {
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
 * @param {LayoutDefinition} definition - Layout definition
 * @throws {Error} If layout ID already exists or required fields missing
 */
export function registerLayout(definition) {
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
    hooksService.invoke('layout:register', { layout: layoutDefinitions[definition.id] });
  }
}

/**
 * Unregister a layout definition
 *
 * @param {string} layoutId - Layout ID to remove
 * @throws {Error} If layout is in use
 */
export function unregisterLayout(layoutId) {
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
 *
 * @param {string} layoutId - Layout ID
 * @returns {LayoutDefinition|null}
 */
export function getLayout(layoutId) {
  return layoutDefinitions[layoutId] || null;
}

/**
 * List all layout definitions
 *
 * @param {Object} options - Filter options
 * @param {string} [options.category] - Filter by category
 * @returns {LayoutDefinition[]}
 */
export function listLayouts(options = {}) {
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
 *
 * @returns {string[]}
 */
export function listCategories() {
  const categories = new Set();
  Object.values(layoutDefinitions).forEach(l => categories.add(l.category));
  return Array.from(categories).sort();
}

/**
 * Load custom layouts from config/layouts.json
 */
function loadCustomLayouts() {
  const layoutsPath = join(baseDir, 'config', 'layouts.json');

  if (!existsSync(layoutsPath)) {
    return;
  }

  try {
    const data = JSON.parse(readFileSync(layoutsPath, 'utf-8'));

    for (const [id, def] of Object.entries(data.layouts || {})) {
      if (!layoutDefinitions[id]) {
        registerLayout({ ...def, id, source: 'config' });
      }
    }
  } catch (err) {
    console.error('[layout-builder] Failed to load custom layouts:', err.message);
  }
}

/**
 * Save custom layout to config/layouts.json
 *
 * @param {LayoutDefinition} definition - Layout to save
 */
export function saveCustomLayout(definition) {
  const layoutsPath = join(baseDir, 'config', 'layouts.json');

  let data = { layouts: {} };

  if (existsSync(layoutsPath)) {
    try {
      data = JSON.parse(readFileSync(layoutsPath, 'utf-8'));
    } catch (err) {
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
 *
 * @returns {string}
 */
function generateUuid() {
  return randomBytes(16).toString('hex');
}

/**
 * Create a new section
 *
 * @param {string} layoutId - Layout definition to use
 * @param {Object} settings - Layout-specific settings
 * @returns {Section}
 */
export function createSection(layoutId, settings = {}) {
  const layout = getLayout(layoutId);

  if (!layout) {
    throw new Error(`Layout not found: ${layoutId}`);
  }

  // Initialize empty component arrays for each region
  const components = {};
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
 *
 * @param {Section} section - Section to modify
 * @param {string} regionId - Target region
 * @param {SectionComponent} component - Component to add
 * @returns {Section} Modified section
 */
export function addComponent(section, regionId, component) {
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
    component.weight = section.components[regionId].length;
  }

  section.components[regionId].push(component);

  // Sort by weight
  section.components[regionId].sort((a, b) => a.weight - b.weight);

  return section;
}

/**
 * Remove a component from a section
 *
 * @param {Section} section - Section to modify
 * @param {string} componentUuid - Component UUID to remove
 * @returns {Section} Modified section
 */
export function removeComponent(section, componentUuid) {
  for (const regionId of Object.keys(section.components)) {
    const index = section.components[regionId].findIndex(c => c.uuid === componentUuid);
    if (index !== -1) {
      section.components[regionId].splice(index, 1);
      // Recompute weights
      section.components[regionId].forEach((c, i) => {
        c.weight = i;
      });
      break;
    }
  }

  return section;
}

/**
 * Move a component within or between regions
 *
 * @param {Section} section - Section to modify
 * @param {string} componentUuid - Component to move
 * @param {string} targetRegion - Target region
 * @param {number} targetIndex - Target position
 * @returns {Section} Modified section
 */
export function moveComponent(section, componentUuid, targetRegion, targetIndex) {
  // Find and remove the component from its current location
  let component = null;

  for (const regionId of Object.keys(section.components)) {
    const index = section.components[regionId].findIndex(c => c.uuid === componentUuid);
    if (index !== -1) {
      component = section.components[regionId].splice(index, 1)[0];
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

  section.components[targetRegion].splice(targetIndex, 0, component);

  // Recompute weights for all regions
  for (const regionId of Object.keys(section.components)) {
    section.components[regionId].forEach((c, i) => {
      c.weight = i;
    });
  }

  return section;
}

/**
 * Create a block component
 *
 * @param {string} blockId - Block instance ID
 * @param {Object} configuration - Block configuration overrides
 * @returns {SectionComponent}
 */
export function createBlockComponent(blockId, configuration = {}) {
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
 *
 * @param {string} blockType - Block type ID
 * @param {Object} blockConfig - Block configuration
 * @returns {SectionComponent}
 */
export function createInlineBlockComponent(blockType, blockConfig = {}) {
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
 *
 * @param {string} fieldName - Content field name
 * @param {Object} configuration - Display configuration
 * @returns {SectionComponent}
 */
export function createFieldComponent(fieldName, configuration = {}) {
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
 *
 * @param {string} contentType - Content type
 * @returns {string}
 */
function getDefaultLayoutPath(contentType) {
  return join(baseDir, 'config', 'layout-defaults', `${contentType}.json`);
}

/**
 * Load default layouts for all content types
 */
function loadDefaultLayouts() {
  const layoutsDir = join(baseDir, 'config', 'layout-defaults');

  if (!existsSync(layoutsDir)) {
    return;
  }

  const files = readdirSync(layoutsDir);

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const contentType = file.replace('.json', '');
    const filePath = join(layoutsDir, file);

    try {
      const data = JSON.parse(readFileSync(filePath, 'utf-8'));
      defaultLayouts[contentType] = data;
    } catch (err) {
      console.error(`[layout-builder] Failed to load default layout for ${contentType}:`, err.message);
    }
  }
}

/**
 * Get default layout for a content type
 *
 * @param {string} contentType - Content type
 * @returns {LayoutStorage|null}
 */
export function getDefaultLayout(contentType) {
  return defaultLayouts[contentType] || null;
}

/**
 * Set default layout for a content type
 *
 * @param {string} contentType - Content type
 * @param {LayoutStorage} layout - Layout storage
 */
export async function setDefaultLayout(contentType, layout) {
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
 *
 * @param {string} contentType - Content type
 */
export async function deleteDefaultLayout(contentType) {
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
 *
 * @returns {string[]}
 */
export function listDefaultLayouts() {
  return Object.keys(defaultLayouts);
}

// ============================================
// PER-CONTENT LAYOUT OVERRIDES
// ============================================

/**
 * Get effective layout for a content item
 * Returns override if exists, otherwise default, otherwise null
 *
 * @param {string} contentType - Content type
 * @param {string} contentId - Content ID (optional, for override lookup)
 * @param {Object} contentItem - Content item (optional, if already loaded)
 * @returns {LayoutStorage|null}
 */
export function getEffectiveLayout(contentType, contentId = null, contentItem = null) {
  // Check for per-content override
  if (config.enableOverrides && contentId) {
    const item = contentItem || (contentService ? contentService.read(contentType, contentId) : null);

    if (item && item._layout && item._layout.sections) {
      return item._layout;
    }
  }

  // Fall back to content type default
  return getDefaultLayout(contentType);
}

/**
 * Set layout override for a specific content item
 *
 * @param {string} contentType - Content type
 * @param {string} contentId - Content ID
 * @param {LayoutStorage} layout - Layout to save
 */
export async function setContentLayout(contentType, contentId, layout) {
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
 *
 * @param {string} contentType - Content type
 * @param {string} contentId - Content ID
 */
export async function removeContentLayout(contentType, contentId) {
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
 *
 * @param {string} contentType - Content type
 * @param {string} contentId - Content ID
 * @returns {boolean}
 */
export function hasContentLayoutOverride(contentType, contentId) {
  if (!contentService) {
    return false;
  }

  const item = contentService.read(contentType, contentId);
  return item && item._layout && Array.isArray(item._layout.sections);
}

// ============================================
// RENDERING
// ============================================

/**
 * Build CSS classes for a layout section
 *
 * @param {Section} section - Section to build classes for
 * @param {LayoutDefinition} layout - Layout definition
 * @returns {string}
 */
function buildSectionClasses(section, layout) {
  const classes = [
    `${config.classPrefix}-section`,
    `${config.classPrefix}-${layout.id}`,
  ];

  // Add column width class if present
  if (section.settings.columnWidths) {
    classes.push(`${config.classPrefix}-${section.settings.columnWidths.replace(/-/g, '_')}`);
  }

  return classes.join(' ');
}

/**
 * Build CSS classes for a region
 *
 * @param {string} regionId - Region ID
 * @param {LayoutDefinition} layout - Layout definition
 * @returns {string}
 */
function buildRegionClasses(regionId, layout) {
  return [
    `${config.classPrefix}-region`,
    `${config.classPrefix}-region-${regionId}`,
  ].join(' ');
}

/**
 * Render a single component
 *
 * @param {SectionComponent} component - Component to render
 * @param {Object} context - Render context
 * @returns {Promise<string>} Rendered HTML
 */
async function renderComponent(component, context) {
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
          const pseudoBlock = {
            id: component.uuid,
            type: component.blockType,
            config: component.configuration || {},
            title: component.configuration?.title || '',
            showTitle: component.configuration?.showTitle || false,
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
 *
 * @param {Section} section - Section to render
 * @param {Object} context - Render context
 * @returns {Promise<string>} Rendered HTML
 */
async function renderSection(section, context) {
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
  const regionHtml = {};
  const sortedRegions = Object.entries(layout.regions)
    .sort((a, b) => (a[1].weight || 0) - (b[1].weight || 0));

  for (const [regionId, regionDef] of sortedRegions) {
    const components = section.components[regionId] || [];
    const componentHtmls = [];

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
    if (result && result.html !== undefined) {
      html = result.html;
    }
  }

  return html;
}

/**
 * Render a complete layout
 *
 * @param {LayoutStorage} layout - Layout storage to render
 * @param {Object} context - Render context
 * @returns {Promise<string>} Rendered HTML
 */
export async function renderLayout(layout, context = {}) {
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
  const sectionHtmls = [];

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
    if (result && result.html !== undefined) {
      html = result.html;
    }
  }

  return html;
}

/**
 * Render layout for a content item
 *
 * @param {string} contentType - Content type
 * @param {string} contentId - Content ID
 * @param {Object} context - Additional render context
 * @returns {Promise<string>} Rendered HTML
 */
export async function renderContentLayout(contentType, contentId, context = {}) {
  // Check cache
  const cacheKey = `${contentType}:${contentId}:${JSON.stringify(context)}`;
  if (config.cacheTtl > 0 && renderCache.has(cacheKey)) {
    const cached = renderCache.get(cacheKey);
    if (Date.now() - cached.timestamp < config.cacheTtl * 1000) {
      return cached.html;
    }
  }

  // Load content if not in context
  let contentItem = context.content;
  if (!contentItem && contentService) {
    contentItem = contentService.read(contentType, contentId);
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
 *
 * @param {string} [key] - Specific cache key prefix to clear (optional)
 */
export function clearCache(key = null) {
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
 *
 * @param {LayoutStorage} storage - Layout storage to modify
 * @param {Section} section - Section to add
 * @param {number} [position] - Optional position (appends if not specified)
 * @returns {LayoutStorage} Modified storage
 */
export function addSection(storage, section, position = null) {
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
 *
 * @param {LayoutStorage} storage - Layout storage to modify
 * @param {string} sectionUuid - Section UUID to remove
 * @returns {LayoutStorage} Modified storage
 */
export function removeSection(storage, sectionUuid) {
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
 *
 * @param {LayoutStorage} storage - Layout storage to modify
 * @param {string} sectionUuid - Section UUID to move
 * @param {number} newPosition - New position index
 * @returns {LayoutStorage} Modified storage
 */
export function moveSection(storage, sectionUuid, newPosition) {
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
  storage.sections.splice(newPosition, 0, section);

  // Recompute weights
  storage.sections.forEach((s, i) => {
    s.weight = i;
  });

  storage.updated = new Date().toISOString();
  return storage;
}

/**
 * Get a section from storage by UUID
 *
 * @param {LayoutStorage} storage - Layout storage
 * @param {string} sectionUuid - Section UUID
 * @returns {Section|null}
 */
export function getSection(storage, sectionUuid) {
  if (!storage.sections) {
    return null;
  }

  return storage.sections.find(s => s.uuid === sectionUuid) || null;
}

/**
 * Update section settings
 *
 * @param {LayoutStorage} storage - Layout storage to modify
 * @param {string} sectionUuid - Section UUID
 * @param {Object} settings - New settings (merged with existing)
 * @returns {LayoutStorage} Modified storage
 */
export function updateSectionSettings(storage, sectionUuid, settings) {
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
 *
 * @param {string} str - String to escape
 * @returns {string}
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

/**
 * Clone a layout storage (deep copy)
 *
 * @param {LayoutStorage} storage - Storage to clone
 * @returns {LayoutStorage}
 */
export function cloneLayout(storage) {
  return JSON.parse(JSON.stringify(storage));
}

/**
 * Validate a layout storage structure
 *
 * @param {LayoutStorage} storage - Storage to validate
 * @returns {Object} Validation result { valid, errors }
 */
export function validateLayout(storage) {
  const errors = [];

  if (!storage) {
    errors.push('Layout storage is null or undefined');
    return { valid: false, errors };
  }

  if (!Array.isArray(storage.sections)) {
    errors.push('Layout sections must be an array');
    return { valid: false, errors };
  }

  for (let i = 0; i < storage.sections.length; i++) {
    const section = storage.sections[i];

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
 *
 * @returns {Object}
 */
export function getConfig() {
  return { ...config };
}

/**
 * Check if layout builder is enabled
 *
 * @returns {boolean}
 */
export function isEnabled() {
  return config.enabled;
}

/**
 * Get statistics about layouts
 *
 * @returns {Object}
 */
export function getStats() {
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
