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

// ============================================
// Types
// ============================================

/** Responsive visibility settings */
interface ResponsiveConfig {
  mobile: boolean;
  tablet: boolean;
  desktop: boolean;
}

/** A region definition within a theme */
interface RegionDefinition {
  label: string;
  weight: number;
  description?: string;
  responsive: ResponsiveConfig;
}

/** A theme's region configuration */
interface ThemeData {
  regions: Record<string, RegionDefinition>;
}

/** Block assignment to a region */
interface BlockAssignment {
  region: string;
  weight: number;
  theme: string;
}

/** Full regions data structure persisted to disk */
interface RegionsData {
  themes: Record<string, ThemeData>;
  assignments: Record<string, BlockAssignment>;
}

/** Rendered block result from blocks service */
interface RenderedBlock {
  html: string;
  [key: string]: unknown;
}

/** Rendered region result */
interface RenderedRegion {
  id: string;
  label: string;
  weight?: number;
  responsive?: ResponsiveConfig;
  blocks?: RenderedBlock[];
  html: string;
  isEmpty: boolean;
  error?: string;
}

/** Blocks service interface */
interface BlocksServiceInterface {
  getBlock(id: string): unknown;
  renderBlock(id: string, context: Record<string, unknown>): Promise<RenderedBlock>;
}

/** Template service interface */
interface TemplateServiceInterface {
  render(template: string, data: Record<string, unknown>): string;
}

/** Hooks service interface */
interface HooksServiceInterface {
  invoke(event: string, data: Record<string, unknown>): unknown | Promise<unknown>;
}

/** Theme statistics */
interface ThemeStats {
  theme: string;
  regionCount: number;
  blockCount: number;
  blocksByRegion: Record<string, number>;
}

/** Exportable configuration */
interface ExportedConfig {
  themes: Record<string, ThemeData>;
  assignments: Record<string, BlockAssignment>;
}

// ============================================
// Module State
// ============================================

/**
 * Base directory for configuration
 */
let baseDir: string | null = null;

/**
 * Blocks service reference for rendering
 */
let blocksService: BlocksServiceInterface | null = null;

/**
 * Template service reference for region rendering
 */
let templateService: TemplateServiceInterface | null = null;

/**
 * Hooks service reference
 */
let hooksService: HooksServiceInterface | null = null;

/**
 * In-memory regions data structure
 */
let regionsData: RegionsData = {
  themes: {},
  assignments: {},
};

/**
 * Default regions for all themes
 */
const DEFAULT_REGIONS: Record<string, RegionDefinition> = {
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
function getRegionsPath(): string {
  return join(baseDir!, 'config', 'regions.json');
}

/**
 * Load regions from disk
 */
function loadRegions(): void {
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
    regionsData = JSON.parse(content) as RegionsData;
  } catch (err: unknown) {
    console.error('[regions] Failed to load regions.json:', err instanceof Error ? err.message : err);
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
function saveRegions(): void {
  const path = getRegionsPath();
  const dir = join(baseDir!, 'config');

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(path, JSON.stringify(regionsData, null, 2), 'utf-8');
}

/**
 * Initialize regions system
 *
 * @param directory - Base directory for config storage
 * @param blocks - Blocks service instance
 * @param tmpl - Template service instance
 *
 * WHY INIT:
 * - Sets up dependencies (blocks, template services)
 * - Loads regions from disk
 * - Ensures config directory exists
 */
export function init(directory: string, blocks: BlocksServiceInterface, tmpl: TemplateServiceInterface): void {
  baseDir = directory;
  blocksService = blocks;
  templateService = tmpl;

  loadRegions();
}

/**
 * Set hooks service reference
 *
 * @param service - Hooks service instance
 */
export function setHooks(service: HooksServiceInterface): void {
  hooksService = service;
}

// ============================================
// REGION MANAGEMENT
// ============================================

/**
 * Get all regions for a theme
 *
 * @param theme - Theme name (default: 'default')
 * @returns Region definitions
 *
 * WHY THEME SCOPED:
 * - Admin themes may have different regions than public themes
 * - Custom themes can define their own layout structure
 */
export function getRegions(theme: string = 'default'): Record<string, RegionDefinition> {
  const themeData = regionsData.themes[theme];

  if (!themeData) {
    return {};
  }

  return themeData.regions || {};
}

/**
 * Get a single region by ID
 *
 * @param regionId - Region ID
 * @param theme - Theme name
 * @returns Region definition or null
 */
export function getRegion(regionId: string, theme: string = 'default'): RegionDefinition | null {
  const regions = getRegions(theme);
  return regions[regionId] || null;
}

/**
 * Register/define a region for a theme
 *
 * @param regionId - Unique region ID
 * @param definition - Region definition
 * @param theme - Theme name
 *
 * WHY REGISTER:
 * - Themes can define custom regions beyond defaults
 * - Allows dynamic region creation by modules
 */
export function defineRegion(regionId: string, definition: Partial<RegionDefinition>, theme: string = 'default'): void {
  if (!regionsData.themes[theme]) {
    regionsData.themes[theme] = { regions: {} };
  }

  regionsData.themes[theme]!.regions[regionId] = {
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
 * @param regionId - Region ID to remove
 * @param theme - Theme name
 * @throws Error if region contains assigned blocks
 */
export function removeRegion(regionId: string, theme: string = 'default'): void {
  // Check if any blocks are assigned
  const assignedBlocks = Object.entries(regionsData.assignments)
    .filter(([_, assignment]) => assignment.region === regionId && assignment.theme === theme);

  if (assignedBlocks.length > 0) {
    throw new Error(`Cannot remove region ${regionId}: ${assignedBlocks.length} blocks still assigned`);
  }

  if (regionsData.themes[theme]) {
    delete regionsData.themes[theme]!.regions[regionId];
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
 * @param theme - Theme name
 */
export function initializeTheme(theme: string): void {
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
 * @param blockId - Block ID
 * @param regionId - Target region ID
 * @param weight - Display order (lower = earlier)
 * @param theme - Theme name
 *
 * WHY SEPARATE FROM BLOCKS:
 * - Blocks may be assigned to different regions in different themes
 * - Keeps region logic centralized
 * - Allows region-specific visibility overrides
 */
export async function assignBlock(blockId: string, regionId: string, weight: number = 0, theme: string = 'default'): Promise<void> {
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
 * @param blockId - Block ID
 * @param theme - Theme name (optional, removes from all themes if not specified)
 */
export async function unassignBlock(blockId: string, theme: string | null = null): Promise<void> {
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
    await hooksService.invoke('regions:unassign', { blockId, theme: theme || '' });
  }
}

/**
 * Move a block to a different region
 *
 * @param blockId - Block ID
 * @param newRegion - Target region ID
 * @param newWeight - Optional new weight
 */
export async function moveBlock(blockId: string, newRegion: string, newWeight: number | null = null): Promise<void> {
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
 * @param regionId - Region ID
 * @param blockIds - Array of block IDs in desired order
 * @param theme - Theme name
 *
 * WHY ARRAY ORDER:
 * - Simpler than specifying individual weights
 * - Natural for drag-and-drop interfaces
 * - Automatically assigns sequential weights
 */
export async function reorderBlocks(regionId: string, blockIds: string[], theme: string = 'default'): Promise<void> {
  for (let i = 0; i < blockIds.length; i++) {
    const blockId = blockIds[i]!;
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
 * @param regionId - Region ID
 * @param theme - Theme name
 * @returns Array of block IDs sorted by weight
 */
export function getBlocksInRegion(regionId: string, theme: string = 'default'): string[] {
  const blocks = Object.entries(regionsData.assignments)
    .filter(([_, assignment]) => assignment.region === regionId && assignment.theme === theme)
    .map(([blockId, assignment]) => ({ blockId, weight: assignment.weight }))
    .sort((a, b) => a.weight - b.weight);

  return blocks.map(item => item.blockId);
}

/**
 * Get assignment info for a block
 *
 * @param blockId - Block ID
 * @returns Assignment or null if not assigned
 */
export function getBlockAssignment(blockId: string): BlockAssignment | null {
  return regionsData.assignments[blockId] || null;
}

// ============================================
// RENDERING
// ============================================

/**
 * Render all blocks in a region
 *
 * @param regionId - Region ID
 * @param theme - Theme name
 * @param context - Render context (passed to blocks)
 * @returns Rendered region data
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
export async function renderRegion(regionId: string, theme: string = 'default', context: Record<string, unknown> = {}): Promise<RenderedRegion> {
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
  const renderedBlocks: RenderedBlock[] = [];

  for (const blockId of blockIds) {
    try {
      const rendered = await blocksService.renderBlock(blockId, context);

      // Only include blocks that produced output and are visible
      if (rendered.html) {
        renderedBlocks.push(rendered);
      }
    } catch (err: unknown) {
      console.error(`[regions] Error rendering block ${blockId}:`, err instanceof Error ? err.message : err);
    }
  }

  // Combine block HTML
  const blocksHtml = renderedBlocks.map(b => b.html).join('\n');

  // Wrap in region container
  const html = blocksHtml
    ? `<div class="region region-${regionId}" data-region="${regionId}">\n${blocksHtml}\n</div>`
    : '';

  const result: RenderedRegion = {
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
    }) as { html?: string } | null;

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
 * @param theme - Theme name
 * @param context - Render context
 * @returns Map of regionId -> rendered region data
 *
 * WHY MAP:
 * - Preserves insertion order
 * - Natural key-value lookup for templates
 * - Easy iteration
 */
export async function renderLayout(theme: string = 'default', context: Record<string, unknown> = {}): Promise<Map<string, RenderedRegion>> {
  const regions = getRegions(theme);
  const result = new Map<string, RenderedRegion>();

  // Sort regions by weight
  const sortedRegions = Object.entries(regions)
    .sort((a, b) => a[1].weight - b[1].weight);

  // Render each region
  for (const [regionId, _] of sortedRegions) {
    try {
      const rendered = await renderRegion(regionId, theme, context);
      result.set(regionId, rendered);
    } catch (err: unknown) {
      console.error(`[regions] Error rendering region ${regionId}:`, err instanceof Error ? err.message : err);

      const regionDef = regions[regionId];
      // Include empty region in result
      result.set(regionId, {
        id: regionId,
        label: regionDef?.label || regionId,
        html: '',
        isEmpty: true,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

/**
 * Get region HTML for template injection
 *
 * @param renderedLayout - Output from renderLayout()
 * @param regionId - Region ID
 * @returns HTML for region or empty string
 *
 * WHY HELPER:
 * - Simplifies template code
 * - Provides safe fallback for missing regions
 */
export function getRegionHtml(renderedLayout: Map<string, RenderedRegion>, regionId: string): string {
  const region = renderedLayout.get(regionId);
  return region ? region.html : '';
}

/**
 * Build region data for template context
 *
 * @param renderedLayout - Output from renderLayout()
 * @returns Plain object for template injection
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
export function buildRegionContext(renderedLayout: Map<string, RenderedRegion>): Record<string, string> {
  const context: Record<string, string> = {};

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
 * @returns Array of theme names
 */
export function listThemes(): string[] {
  return Object.keys(regionsData.themes);
}

/**
 * Get statistics for a theme
 *
 * @param theme - Theme name
 * @returns Statistics
 */
export function getThemeStats(theme: string = 'default'): ThemeStats {
  const regions = getRegions(theme);
  const regionCount = Object.keys(regions).length;

  // Count assigned blocks for this theme
  let blockCount = 0;
  const blocksByRegion: Record<string, number> = {};

  Object.entries(regionsData.assignments).forEach(([_blockId, assignment]) => {
    if (assignment.theme === theme) {
      blockCount++;
      if (!blocksByRegion[assignment.region]) {
        blocksByRegion[assignment.region] = 0;
      }
      blocksByRegion[assignment.region]!++;
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
 * @param theme - Theme name (optional, exports all if not specified)
 * @returns Exportable configuration
 */
export function exportConfig(theme: string | null = null): ExportedConfig {
  if (theme) {
    const themeData = regionsData.themes[theme];
    if (!themeData) {
      throw new Error(`Theme not found: ${theme}`);
    }

    // Get assignments for this theme
    const themeAssignments: Record<string, BlockAssignment> = {};
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
 * @param importData - Configuration to import
 * @param merge - Merge with existing (default: false = replace)
 */
export function importConfig(importData: RegionsData, merge: boolean = false): void {
  if (!merge) {
    regionsData = importData;
  } else {
    // Merge themes
    Object.entries(importData.themes || {}).forEach(([themeName, themeData]) => {
      if (!regionsData.themes[themeName]) {
        regionsData.themes[themeName] = themeData;
      } else {
        // Merge regions
        regionsData.themes[themeName]!.regions = {
          ...regionsData.themes[themeName]!.regions,
          ...themeData.regions,
        };
      }
    });

    // Merge assignments
    regionsData.assignments = {
      ...regionsData.assignments,
      ...(importData.assignments || {}),
    };
  }

  saveRegions();
}

/**
 * Reset regions to defaults
 *
 * @param theme - Theme to reset (optional, resets all if not specified)
 */
export function resetToDefaults(theme: string | null = null): void {
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
