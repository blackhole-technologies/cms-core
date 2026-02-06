/**
 * regions.js - Theme Regions System for Block Placement
 *
 * WHY REGIONS:
 * ============
 * Regions provide structured areas where blocks can be placed:
 * - Theme-defined layout areas (header, sidebar, footer)
 * - Per-theme customization (admin theme vs public theme)
 * - Weighted ordering for predictable block placement
 * - Responsive visibility rules
 *
 * DESIGN DECISIONS:
 * =================
 * 1. Theme-scoped regions - different themes define different regions
 * 2. File-based storage - regions.json contains all region definitions
 * 3. Integration with blocks.js - assigns blocks to regions
 * 4. Responsive hints - show/hide regions based on viewport
 *
 * STORAGE STRATEGY:
 * =================
 * - config/regions.json: region definitions and block assignments
 * - Regions are theme-scoped (each theme has its own regions)
 * - Block assignments reference theme + region
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Base directory for configuration
 */
let baseDir = null;

/**
 * Blocks service reference for rendering
 */
let blocksService = null;

/**
 * Template service reference for region rendering
 */
let templateService = null;

/**
 * Hooks service reference
 */
let hooksService = null;

/**
 * In-memory regions data structure
 * Structure: {
 *   themes: {
 *     themeName: {
 *       regions: {
 *         regionId: { label, weight, responsive }
 *       }
 *     }
 *   },
 *   assignments: {
 *     blockId: { region, weight, theme }
 *   }
 * }
 */
let regionsData = {
  themes: {},
  assignments: {},
};

/**
 * Default regions for all themes
 */
const DEFAULT_REGIONS = {
  header: { label: 'Header', weight: -100, responsive: { mobile: true, tablet: true, desktop: true } },
  navigation: { label: 'Navigation', weight: -90, responsive: { mobile: true, tablet: true, desktop: true } },
  sidebar_first: { label: 'Left Sidebar', weight: 0, responsive: { mobile: false, tablet: true, desktop: true } },
  content: { label: 'Main Content', weight: 10, responsive: { mobile: true, tablet: true, desktop: true } },
  sidebar_second: { label: 'Right Sidebar', weight: 20, responsive: { mobile: false, tablet: false, desktop: true } },
  footer: { label: 'Footer', weight: 100, responsive: { mobile: true, tablet: true, desktop: true } },
};

/**
 * Get path to regions.json
 */
function getRegionsPath() {
  return join(baseDir, 'config', 'regions.json');
}

/**
 * Load regions from disk
 */
function loadRegions() {
  const path = getRegionsPath();

  if (!existsSync(path)) {
    // Initialize with default theme
    regionsData = {
      themes: {
        default: { regions: DEFAULT_REGIONS },
      },
      assignments: {},
    };
    saveRegions();
    return;
  }

  try {
    const content = readFileSync(path, 'utf-8');
    regionsData = JSON.parse(content);
  } catch (err) {
    console.error('[regions] Failed to load regions.json:', err.message);
    regionsData = {
      themes: {
        default: { regions: DEFAULT_REGIONS },
      },
      assignments: {},
    };
  }
}

/**
 * Save regions to disk
 */
function saveRegions() {
  const path = getRegionsPath();
  const dir = join(baseDir, 'config');

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(path, JSON.stringify(regionsData, null, 2), 'utf-8');
}

/**
 * Initialize regions system
 *
 * @param {string} directory - Base directory for config storage
 * @param {object} blocks - Blocks service instance
 * @param {object} template - Template service instance
 *
 * WHY INIT:
 * - Sets up dependencies (blocks, template services)
 * - Loads regions from disk
 * - Ensures config directory exists
 */
export function init(directory, blocks, template) {
  baseDir = directory;
  blocksService = blocks;
  templateService = template;

  loadRegions();
}

/**
 * Set hooks service reference
 *
 * @param {object} service - Hooks service instance
 */
export function setHooks(service) {
  hooksService = service;
}

// ============================================
// REGION MANAGEMENT
// ============================================

/**
 * Get all regions for a theme
 *
 * @param {string} theme - Theme name (default: 'default')
 * @returns {object} - Region definitions
 *
 * WHY THEME SCOPED:
 * - Admin themes may have different regions than public themes
 * - Custom themes can define their own layout structure
 */
export function getRegions(theme = 'default') {
  const themeData = regionsData.themes[theme];

  if (!themeData) {
    return {};
  }

  return themeData.regions || {};
}

/**
 * Get a single region by ID
 *
 * @param {string} regionId - Region ID
 * @param {string} theme - Theme name
 * @returns {object|null} - Region definition or null
 */
export function getRegion(regionId, theme = 'default') {
  const regions = getRegions(theme);
  return regions[regionId] || null;
}

/**
 * Register/define a region for a theme
 *
 * @param {string} regionId - Unique region ID
 * @param {object} definition - Region definition
 * @param {string} theme - Theme name
 *
 * WHY REGISTER:
 * - Themes can define custom regions beyond defaults
 * - Allows dynamic region creation by modules
 */
export function defineRegion(regionId, definition, theme = 'default') {
  if (!regionsData.themes[theme]) {
    regionsData.themes[theme] = { regions: {} };
  }

  regionsData.themes[theme].regions[regionId] = {
    label: definition.label || regionId,
    weight: definition.weight || 0,
    description: definition.description || '',
    responsive: definition.responsive || { mobile: true, tablet: true, desktop: true },
  };

  saveRegions();

  // Fire hook
  if (hooksService) {
    hooksService.invoke('regions:define', { regionId, definition, theme });
  }
}

/**
 * Remove a region definition
 *
 * @param {string} regionId - Region ID to remove
 * @param {string} theme - Theme name
 * @throws {Error} - If region contains assigned blocks
 */
export function removeRegion(regionId, theme = 'default') {
  // Check if any blocks are assigned
  const assignedBlocks = Object.entries(regionsData.assignments)
    .filter(([_, assignment]) => assignment.region === regionId && assignment.theme === theme);

  if (assignedBlocks.length > 0) {
    throw new Error(`Cannot remove region ${regionId}: ${assignedBlocks.length} blocks still assigned`);
  }

  if (regionsData.themes[theme]) {
    delete regionsData.themes[theme].regions[regionId];
    saveRegions();
  }

  // Fire hook
  if (hooksService) {
    hooksService.invoke('regions:remove', { regionId, theme });
  }
}

/**
 * Initialize a theme with default regions
 *
 * @param {string} theme - Theme name
 */
export function initializeTheme(theme) {
  if (!regionsData.themes[theme]) {
    regionsData.themes[theme] = {
      regions: { ...DEFAULT_REGIONS },
    };
    saveRegions();
  }
}

// ============================================
// BLOCK ASSIGNMENT
// ============================================

/**
 * Assign a block to a region
 *
 * @param {string} blockId - Block ID
 * @param {string} regionId - Target region ID
 * @param {number} weight - Display order (lower = earlier)
 * @param {string} theme - Theme name
 *
 * WHY SEPARATE FROM BLOCKS:
 * - Blocks may be assigned to different regions in different themes
 * - Keeps region logic centralized
 * - Allows region-specific visibility overrides
 */
export async function assignBlock(blockId, regionId, weight = 0, theme = 'default') {
  // Verify region exists
  const region = getRegion(regionId, theme);
  if (!region) {
    throw new Error(`Region not found: ${regionId} in theme ${theme}`);
  }

  // Verify block exists (if blocks service available)
  if (blocksService) {
    const block = blocksService.getBlock(blockId);
    if (!block) {
      throw new Error(`Block not found: ${blockId}`);
    }
  }

  // Create/update assignment
  regionsData.assignments[blockId] = {
    region: regionId,
    weight,
    theme,
  };

  saveRegions();

  // Fire hook
  if (hooksService) {
    await hooksService.invoke('regions:assign', { blockId, regionId, weight, theme });
  }
}

/**
 * Unassign a block from its region
 *
 * @param {string} blockId - Block ID
 * @param {string} theme - Theme name (optional, removes from all themes if not specified)
 */
export async function unassignBlock(blockId, theme = null) {
  if (theme) {
    // Remove only from specified theme
    const assignment = regionsData.assignments[blockId];
    if (assignment && assignment.theme === theme) {
      delete regionsData.assignments[blockId];
    }
  } else {
    // Remove from all themes
    delete regionsData.assignments[blockId];
  }

  saveRegions();

  // Fire hook
  if (hooksService) {
    await hooksService.invoke('regions:unassign', { blockId, theme });
  }
}

/**
 * Move a block to a different region
 *
 * @param {string} blockId - Block ID
 * @param {string} newRegion - Target region ID
 * @param {number} newWeight - Optional new weight
 */
export async function moveBlock(blockId, newRegion, newWeight = null) {
  const assignment = regionsData.assignments[blockId];

  if (!assignment) {
    throw new Error(`Block not assigned: ${blockId}`);
  }

  const theme = assignment.theme;
  const weight = newWeight !== null ? newWeight : assignment.weight;

  await assignBlock(blockId, newRegion, weight, theme);
}

/**
 * Reorder blocks within a region
 *
 * @param {string} regionId - Region ID
 * @param {array} blockIds - Array of block IDs in desired order
 * @param {string} theme - Theme name
 *
 * WHY ARRAY ORDER:
 * - Simpler than specifying individual weights
 * - Natural for drag-and-drop interfaces
 * - Automatically assigns sequential weights
 */
export async function reorderBlocks(regionId, blockIds, theme = 'default') {
  for (let i = 0; i < blockIds.length; i++) {
    const blockId = blockIds[i];
    const assignment = regionsData.assignments[blockId];

    if (assignment && assignment.region === regionId && assignment.theme === theme) {
      assignment.weight = i;
    }
  }

  saveRegions();

  // Fire hook
  if (hooksService) {
    await hooksService.invoke('regions:reorder', { regionId, blockIds, theme });
  }
}

/**
 * Get all blocks assigned to a region
 *
 * @param {string} regionId - Region ID
 * @param {string} theme - Theme name
 * @returns {array} - Array of block IDs sorted by weight
 */
export function getBlocksInRegion(regionId, theme = 'default') {
  const blocks = Object.entries(regionsData.assignments)
    .filter(([_, assignment]) => assignment.region === regionId && assignment.theme === theme)
    .map(([blockId, assignment]) => ({ blockId, weight: assignment.weight }))
    .sort((a, b) => a.weight - b.weight);

  return blocks.map(item => item.blockId);
}

/**
 * Get assignment info for a block
 *
 * @param {string} blockId - Block ID
 * @returns {object|null} - Assignment or null if not assigned
 */
export function getBlockAssignment(blockId) {
  return regionsData.assignments[blockId] || null;
}

// ============================================
// RENDERING
// ============================================

/**
 * Render all blocks in a region
 *
 * @param {string} regionId - Region ID
 * @param {string} theme - Theme name
 * @param {object} context - Render context (passed to blocks)
 * @returns {Promise<object>} - Rendered region data
 *
 * RETURN FORMAT:
 * {
 *   id: 'header',
 *   label: 'Header',
 *   blocks: [{ id, html, ... }],
 *   html: '<div class="region-header">...</div>',
 *   isEmpty: false
 * }
 */
export async function renderRegion(regionId, theme = 'default', context = {}) {
  // Fire before render hook
  if (hooksService) {
    await hooksService.invoke('regions:beforeRender', { regionId, theme, context });
  }

  const region = getRegion(regionId, theme);

  if (!region) {
    throw new Error(`Region not found: ${regionId} in theme ${theme}`);
  }

  // Get blocks in this region
  const blockIds = getBlocksInRegion(regionId, theme);

  if (!blocksService) {
    throw new Error('Blocks service not initialized');
  }

  // Render each block
  const renderedBlocks = [];

  for (const blockId of blockIds) {
    try {
      const rendered = await blocksService.renderBlock(blockId, context);

      // Only include blocks that produced output and are visible
      if (rendered.html) {
        renderedBlocks.push(rendered);
      }
    } catch (err) {
      console.error(`[regions] Error rendering block ${blockId}:`, err.message);
    }
  }

  // Combine block HTML
  const blocksHtml = renderedBlocks.map(b => b.html).join('\n');

  // Wrap in region container
  const html = blocksHtml
    ? `<div class="region region-${regionId}" data-region="${regionId}">\n${blocksHtml}\n</div>`
    : '';

  const result = {
    id: regionId,
    label: region.label,
    weight: region.weight,
    responsive: region.responsive,
    blocks: renderedBlocks,
    html,
    isEmpty: renderedBlocks.length === 0,
  };

  // Fire after render hook
  if (hooksService) {
    const hookResult = await hooksService.invoke('regions:afterRender', {
      regionId,
      theme,
      context,
      result
    });

    // Allow hook to modify HTML
    if (hookResult && hookResult.html !== undefined) {
      result.html = hookResult.html;
    }
  }

  return result;
}

/**
 * Render all regions for a page layout
 *
 * @param {string} theme - Theme name
 * @param {object} context - Render context
 * @returns {Promise<Map>} - Map of regionId -> rendered region data
 *
 * WHY MAP:
 * - Preserves insertion order
 * - Natural key-value lookup for templates
 * - Easy iteration
 */
export async function renderLayout(theme = 'default', context = {}) {
  const regions = getRegions(theme);
  const result = new Map();

  // Sort regions by weight
  const sortedRegions = Object.entries(regions)
    .sort((a, b) => a[1].weight - b[1].weight);

  // Render each region
  for (const [regionId, _] of sortedRegions) {
    try {
      const rendered = await renderRegion(regionId, theme, context);
      result.set(regionId, rendered);
    } catch (err) {
      console.error(`[regions] Error rendering region ${regionId}:`, err.message);

      // Include empty region in result
      result.set(regionId, {
        id: regionId,
        label: regions[regionId].label,
        html: '',
        isEmpty: true,
        error: err.message,
      });
    }
  }

  return result;
}

/**
 * Get region HTML for template injection
 *
 * @param {Map} renderedLayout - Output from renderLayout()
 * @param {string} regionId - Region ID
 * @returns {string} - HTML for region or empty string
 *
 * WHY HELPER:
 * - Simplifies template code
 * - Provides safe fallback for missing regions
 */
export function getRegionHtml(renderedLayout, regionId) {
  const region = renderedLayout.get(regionId);
  return region ? region.html : '';
}

/**
 * Build region data for template context
 *
 * @param {Map} renderedLayout - Output from renderLayout()
 * @returns {object} - Plain object for template injection
 *
 * USAGE:
 * const regions = renderLayout('default', context);
 * const data = { ...pageData, ...buildRegionContext(regions) };
 * template.render('page.html', data);
 *
 * TEMPLATE:
 * {{header}}
 * {{content}}
 * {{footer}}
 */
export function buildRegionContext(renderedLayout) {
  const context = {};

  for (const [regionId, data] of renderedLayout) {
    context[regionId] = data.html;
  }

  return context;
}

// ============================================
// UTILITIES
// ============================================

/**
 * List all themes with defined regions
 *
 * @returns {array} - Array of theme names
 */
export function listThemes() {
  return Object.keys(regionsData.themes);
}

/**
 * Get statistics for a theme
 *
 * @param {string} theme - Theme name
 * @returns {object} - Statistics
 */
export function getThemeStats(theme = 'default') {
  const regions = getRegions(theme);
  const regionCount = Object.keys(regions).length;

  // Count assigned blocks for this theme
  let blockCount = 0;
  const blocksByRegion = {};

  Object.entries(regionsData.assignments).forEach(([blockId, assignment]) => {
    if (assignment.theme === theme) {
      blockCount++;
      if (!blocksByRegion[assignment.region]) {
        blocksByRegion[assignment.region] = 0;
      }
      blocksByRegion[assignment.region]++;
    }
  });

  return {
    theme,
    regionCount,
    blockCount,
    blocksByRegion,
  };
}

/**
 * Export regions configuration
 *
 * @param {string} theme - Theme name (optional, exports all if not specified)
 * @returns {object} - Exportable configuration
 */
export function exportConfig(theme = null) {
  if (theme) {
    const themeData = regionsData.themes[theme];
    if (!themeData) {
      throw new Error(`Theme not found: ${theme}`);
    }

    // Get assignments for this theme
    const themeAssignments = {};
    Object.entries(regionsData.assignments).forEach(([blockId, assignment]) => {
      if (assignment.theme === theme) {
        themeAssignments[blockId] = assignment;
      }
    });

    return {
      themes: { [theme]: themeData },
      assignments: themeAssignments,
    };
  }

  // Export all
  return { ...regionsData };
}

/**
 * Import regions configuration
 *
 * @param {object} config - Configuration to import
 * @param {boolean} merge - Merge with existing (default: false = replace)
 */
export function importConfig(config, merge = false) {
  if (!merge) {
    regionsData = config;
  } else {
    // Merge themes
    Object.entries(config.themes || {}).forEach(([themeName, themeData]) => {
      if (!regionsData.themes[themeName]) {
        regionsData.themes[themeName] = themeData;
      } else {
        // Merge regions
        regionsData.themes[themeName].regions = {
          ...regionsData.themes[themeName].regions,
          ...themeData.regions,
        };
      }
    });

    // Merge assignments
    regionsData.assignments = {
      ...regionsData.assignments,
      ...(config.assignments || {}),
    };
  }

  saveRegions();
}

/**
 * Reset regions to defaults
 *
 * @param {string} theme - Theme to reset (optional, resets all if not specified)
 */
export function resetToDefaults(theme = null) {
  if (theme) {
    regionsData.themes[theme] = {
      regions: { ...DEFAULT_REGIONS },
    };

    // Clear assignments for this theme
    Object.entries(regionsData.assignments).forEach(([blockId, assignment]) => {
      if (assignment.theme === theme) {
        delete regionsData.assignments[blockId];
      }
    });
  } else {
    regionsData = {
      themes: {
        default: { regions: { ...DEFAULT_REGIONS } },
      },
      assignments: {},
    };
  }

  saveRegions();
}
