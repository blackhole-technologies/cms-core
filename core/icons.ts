/**
 * icons.js - Icon Discovery and Registry System
 *
 * WHY THIS EXISTS:
 * A CMS needs a unified way to discover and use icons from multiple sources:
 * - Multiple icon packs (Heroicons, Bootstrap Icons, FontAwesome, etc.)
 * - Custom project-specific icons
 * - Searchable icon registry with metadata
 * - Consistent lookup API across the system
 *
 * DESIGN DECISIONS:
 * - Icon packs are configured in config/icons.json
 * - Icons are discovered at boot time by scanning configured directories
 * - In-memory registry for fast lookups
 * - Support for tags and aliases for better searchability
 * - File-based SVG icons (not icon fonts) for flexibility
 *
 * WHY NOT ICON FONTS:
 * - SVGs can be styled individually (multi-color)
 * - SVGs can be inlined for better performance
 * - SVGs can be dynamically modified
 * - No FOIT (Flash of Invisible Text) issues
 * - Better accessibility with proper aria labels
 *
 * USAGE:
 *   const icon = icons.getIcon('hero:user');
 *   const results = icons.searchIcons('home');
 *   const packs = icons.listPacks();
 *   const packIcons = icons.getIconsByPack('heroicons');
 */

import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join, parse, relative } from 'node:path';

// ============= Types =============

/** Icon metadata record */
interface IconMetadata {
  id: string;
  name: string;
  packId: string;
  packName: string;
  path: string;
  relativePath: string;
  variant: string;
  tags: string[];
  aliases: string[];
}

/** Icon pack metadata */
interface IconPack {
  id: string;
  name: string;
  description: string;
  version: string;
  type: string;
  path: string;
  prefix: string;
  enabled: boolean;
  source: string;
  iconCount: number;
}

/** Icon pack configuration input */
interface IconPackConfig {
  id: string;
  name: string;
  description?: string;
  version?: string;
  type?: string;
  path: string;
  prefix?: string;
  enabled?: boolean;
  source?: string;
}

/** Icon discovery configuration */
interface IconDiscoveryConfig {
  extensions?: string[];
  excludePatterns?: string[];
  scanOnBoot?: boolean;
}

/** Icon service configuration */
interface IconConfig {
  packs?: IconPackConfig[];
  discovery?: IconDiscoveryConfig;
}

/** Search options for icons */
interface IconSearchOptions {
  packId?: string | null;
  limit?: number;
  variant?: string | null;
}

// ============= State =============

/**
 * Service state
 */
let config: IconConfig | null = null;
let baseDir: string | null = null;
let initialized = false;

/**
 * Icon registry
 * Structure: Map<iconId, iconMetadata>
 *
 * WHY MAP INSTEAD OF OBJECT:
 * - Faster lookups for large icon sets
 * - Better iteration performance
 * - Can use any string as key without prototype issues
 */
const registry = new Map<string, IconMetadata>();

/**
 * Pack registry
 * Structure: Map<packId, packMetadata>
 */
const packs = new Map<string, IconPack>();

/**
 * Search index for faster queries
 * Structure: Map<searchTerm, Set<iconId>>
 */
const searchIndex = new Map<string, Set<string>>();

/**
 * Initialize icon service
 *
 * WHY SEPARATE INIT:
 * - Allows dependency injection of config
 * - Defers filesystem operations until boot
 * - Can be re-initialized for testing
 *
 * @param {Object} iconConfig - Icon configuration from config/icons.json
 * @param {string} baseDirPath - Base directory for icon files
 */
export function init(iconConfig: IconConfig, baseDirPath: string): void {
  if (!iconConfig) {
    throw new Error('[icons] Configuration is required');
  }

  if (!baseDirPath) {
    throw new Error('[icons] Base directory is required');
  }

  config = iconConfig;
  baseDir = baseDirPath;

  // Clear existing registries
  registry.clear();
  packs.clear();
  searchIndex.clear();

  // Register icon packs from config
  if (config.packs && Array.isArray(config.packs)) {
    for (const pack of config.packs) {
      if (pack.enabled !== false) {
        registerPack(pack);
      }
    }
  }

  // Note: Plugin packs are registered later via discoverPluginPacks()
  // This allows module hooks to be wired first

  // Discover icons if configured
  if (config!.discovery?.scanOnBoot !== false) {
    discoverIcons();
  }

  initialized = true;

  const packCount = packs.size;
  const iconCount = registry.size;
  console.log(`[icons] Initialized (${packCount} packs, ${iconCount} icons)`);
}

/**
 * Discover and register icon packs from plugins
 *
 * WHY SEPARATE FROM INIT:
 * - Module hooks are wired after icons.init() is called
 * - This function is called after modules are fully loaded
 * - Allows plugins to register packs via hook_icon_packs_info
 *
 * @param {Function} hooksService - Hooks service for triggering plugin hook
 */
export async function discoverPluginPacks(hooksService: { trigger(event: string, ctx: unknown): Promise<unknown> } | null): Promise<void> {
  if (!initialized) {
    throw new Error('[icons] Service must be initialized before discovering plugin packs');
  }

  if (!hooksService) {
    return;
  }

  // Trigger hook to let modules register icon packs
  // Hook name: hook_icon_packs_info → 'icon:packs:info'
  const context = { registerPack: registerPackExternal, baseDir: baseDir as string };
  await hooksService.trigger('icon:packs:info', context);

  // Re-discover icons to include plugin packs
  if (config!.discovery?.scanOnBoot !== false) {
    discoverIcons();
  }

  const packCount = packs.size;
  const iconCount = registry.size;
  console.log(`[icons] Discovered plugin packs (${packCount} total packs, ${iconCount} total icons)`);
}

/**
 * Register an icon pack (internal)
 *
 * WHY VALIDATE PACK:
 * - Fail fast if pack configuration is invalid
 * - Provide helpful error messages
 * - Prevent runtime errors during icon lookups
 *
 * @param {Object} pack - Pack configuration
 */
function registerPack(pack: IconPackConfig): void {
  // Validate required fields
  if (!pack.id) {
    throw new Error('[icons] Pack ID is required');
  }

  if (!pack.name) {
    throw new Error(`[icons] Pack name is required for pack "${pack.id}"`);
  }

  if (!pack.path) {
    throw new Error(`[icons] Pack path is required for pack "${pack.id}"`);
  }

  // Check for duplicate pack IDs
  if (packs.has(pack.id)) {
    console.warn(`[icons] Pack "${pack.id}" already registered, skipping`);
    return;
  }

  // Store pack metadata
  packs.set(pack.id, {
    id: pack.id,
    name: pack.name,
    description: pack.description || '',
    version: pack.version || '1.0',
    type: pack.type || 'svg',
    path: pack.path,
    prefix: pack.prefix || pack.id,
    enabled: pack.enabled !== false,
    source: pack.source || 'config',
    iconCount: 0,
  });
}

/**
 * Register an icon pack from external modules (plugin API)
 *
 * WHY SEPARATE FROM INTERNAL:
 * - Provides a stable public API for modules
 * - Can add additional validation or hooks later
 * - Tracks source for debugging (config vs module)
 *
 * USAGE (in a module's hook_icon_packs_info):
 *   export function hook_icon_packs_info(context) {
 *     context.registerPack({
 *       id: 'mypack',
 *       name: 'My Icon Pack',
 *       description: 'Custom icon pack',
 *       path: 'modules/mymodule/icons',
 *       prefix: 'mypack',
 *       type: 'svg'
 *     });
 *   }
 *
 * @param {Object} pack - Pack configuration
 */
function registerPackExternal(pack: IconPackConfig): void {
  // Add source tracking for plugin packs
  const packWithSource = {
    ...pack,
    source: 'plugin',
  };

  try {
    registerPack(packWithSource);
    console.log(`[icons] Registered icon pack "${pack.id}" from plugin`);
  } catch (error) {
    console.error(`[icons] Failed to register plugin pack "${pack.id}":`, (error as Error).message);
  }
}

/**
 * Discover icons from all registered packs
 *
 * WHY SCAN DIRECTORIES:
 * - Icons are added/removed from icon packs externally
 * - Discovery at boot ensures registry is up-to-date
 * - Supports hot-reloading in development
 */
function discoverIcons(): void {
  for (const [packId, pack] of packs.entries()) {
    const packPath = join(baseDir!, pack.path);

    // Check if pack directory exists
    if (!existsSync(packPath)) {
      console.warn(`[icons] Pack directory not found: ${packPath}`);
      continue;
    }

    // Scan directory for icons
    try {
      const icons = scanDirectory(packPath, pack);
      pack.iconCount = icons.length;

      // Register each icon
      for (const icon of icons) {
        registerIcon(icon);
      }
    } catch (error) {
      console.error(`[icons] Failed to scan pack "${packId}":`, (error as Error).message);
    }
  }
}

/**
 * Recursively scan directory for icon files
 *
 * WHY RECURSIVE:
 * - Icon packs often organize icons in subdirectories
 * - Need to support nested structures (e.g., solid/outline variants)
 * - Filter out excluded patterns
 *
 * @param {string} dirPath - Directory to scan
 * @param {Object} pack - Pack metadata
 * @param {string} relativePath - Relative path from pack root
 * @returns {Array} Array of icon metadata objects
 */
function scanDirectory(dirPath: string, pack: IconPack, relativePath = ''): IconMetadata[] {
  const icons: IconMetadata[] = [];
  const extensions = config!.discovery?.extensions ?? ['.svg'];
  const excludePatterns = config!.discovery?.excludePatterns ?? [];

  try {
    const entries = readdirSync(dirPath);

    for (const entry of entries) {
      const fullPath = join(dirPath, entry);
      const relPath = relativePath ? join(relativePath, entry) : entry;

      // Check if excluded
      const isExcluded = excludePatterns.some(pattern =>
        relPath.includes(pattern) || entry.includes(pattern)
      );

      if (isExcluded) {
        continue;
      }

      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        // Recursively scan subdirectory
        const subIcons = scanDirectory(fullPath, pack, relPath);
        icons.push(...subIcons);
      } else if (stat.isFile()) {
        // Check if file has valid extension
        const parsed = parse(entry);
        if (extensions.includes(parsed.ext)) {
          // Extract icon metadata
          const iconName = parsed.name;
          const iconId = `${pack.prefix}:${relativePath ? relativePath + '/' : ''}${iconName}`;

          icons.push({
            id: iconId,
            name: iconName,
            packId: pack.id,
            packName: pack.name,
            path: fullPath,
            relativePath: relPath,
            variant: relativePath || 'default',
            tags: extractTags(iconName, relativePath),
            aliases: extractAliases(iconName),
          });
        }
      }
    }
  } catch (error) {
    console.error(`[icons] Failed to read directory "${dirPath}":`, (error as Error).message);
  }

  return icons;
}

/**
 * Register an icon in the registry
 *
 * WHY SEPARATE REGISTRATION:
 * - Allows manual icon registration (not just discovery)
 * - Builds search index for fast queries
 * - Validates icon data before storing
 *
 * @param {Object} icon - Icon metadata
 */
function registerIcon(icon: IconMetadata): void {
  // Store in registry
  registry.set(icon.id, icon);

  // Build search index
  indexIcon(icon);
}

/**
 * Index an icon for search
 *
 * WHY SEARCH INDEX:
 * - Enables fast fuzzy search across all icons
 * - Indexes name, tags, and aliases
 * - Normalizes terms for case-insensitive search
 *
 * @param {Object} icon - Icon metadata
 */
function indexIcon(icon: IconMetadata): void {
  const terms = [
    icon.name,
    ...icon.tags,
    ...icon.aliases,
  ];

  for (const term of terms) {
    const normalized = term.toLowerCase();

    if (!searchIndex.has(normalized)) {
      searchIndex.set(normalized, new Set());
    }

    searchIndex.get(normalized)!.add(icon.id);
  }
}

/**
 * Extract tags from icon name and path
 *
 * WHY TAGS:
 * - Makes icons more discoverable
 * - Supports grouping (e.g., all "social" icons)
 * - Enables filtering by category
 *
 * @param {string} name - Icon name
 * @param {string} path - Relative path in pack
 * @returns {string[]} Array of tags
 */
function extractTags(name: string, path: string): string[] {
  const tags = [];

  // Add variant as tag (e.g., "solid", "outline")
  if (path) {
    const pathParts = path.split('/');
    tags.push(...pathParts);
  }

  // Split icon name by common delimiters
  const nameParts = name.split(/[-_]/);
  tags.push(...nameParts);

  // Remove duplicates and normalize
  return [...new Set(tags.map(t => t.toLowerCase()))];
}

/**
 * Extract aliases from icon name
 *
 * WHY ALIASES:
 * - Icons have multiple common names (e.g., "trash" = "delete", "bin")
 * - Improves search recall
 * - Reduces frustration when users search for wrong term
 *
 * @param {string} name - Icon name
 * @returns {string[]} Array of aliases
 */
function extractAliases(name: string): string[] {
  // Common alias mappings
  const aliasMap: Record<string, string[]> = {
    'trash': ['delete', 'bin', 'remove'],
    'user': ['person', 'account', 'profile'],
    'home': ['house', 'index'],
    'search': ['find', 'magnify', 'magnifier'],
    'settings': ['config', 'configuration', 'gear', 'cog'],
    'menu': ['hamburger', 'bars', 'navigation'],
    'close': ['x', 'cross', 'cancel'],
    'check': ['checkmark', 'tick', 'confirm'],
    'arrow': ['pointer'],
    'chevron': ['caret'],
    'plus': ['add', 'create', 'new'],
    'minus': ['subtract', 'remove'],
    'edit': ['pencil', 'modify', 'update'],
    'eye': ['view', 'visible', 'show'],
    'heart': ['like', 'favorite', 'love'],
    'star': ['favorite', 'bookmark'],
    'bell': ['notification', 'alert'],
    'mail': ['email', 'envelope', 'message'],
    'calendar': ['date', 'schedule'],
    'clock': ['time'],
    'download': ['save'],
    'upload': ['import'],
  };

  const normalized = name.toLowerCase();

  for (const [key, aliases] of Object.entries(aliasMap)) {
    if (normalized.includes(key)) {
      return aliases;
    }
  }

  return [];
}

/**
 * Get an icon by ID
 *
 * @param {string} id - Icon ID (e.g., "hero:user" or "bi:house")
 * @returns {Object|null} Icon metadata or null if not found
 */
export function getIcon(id: string): IconMetadata | null {
  checkInitialized();
  return registry.get(id) || null;
}

/**
 * Search icons by query
 *
 * WHY FUZZY SEARCH:
 * - Users don't know exact icon names
 * - Partial matches are more user-friendly
 * - Returns ranked results (exact matches first)
 *
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {Array} Array of matching icons, ranked by relevance
 */
export function searchIcons(query: string, options: IconSearchOptions = {}): IconMetadata[] {
  checkInitialized();

  const {
    packId = null,
    limit = 50,
    variant = null,
  } = options;

  if (!query) {
    return [];
  }

  const normalized = query.toLowerCase();
  const results = new Map(); // iconId -> score

  // Exact matches (highest score)
  for (const [term, iconIds] of searchIndex.entries()) {
    if (term === normalized) {
      for (const iconId of iconIds) {
        results.set(iconId, (results.get(iconId) || 0) + 100);
      }
    }
  }

  // Prefix matches (high score)
  for (const [term, iconIds] of searchIndex.entries()) {
    if (term.startsWith(normalized)) {
      for (const iconId of iconIds) {
        results.set(iconId, (results.get(iconId) || 0) + 50);
      }
    }
  }

  // Substring matches (medium score)
  for (const [term, iconIds] of searchIndex.entries()) {
    if (term.includes(normalized)) {
      for (const iconId of iconIds) {
        results.set(iconId, (results.get(iconId) || 0) + 25);
      }
    }
  }

  // Convert to array and sort by score
  let icons: IconMetadata[] = Array.from(results.entries())
    .sort((a, b) => b[1] - a[1]) // Sort by score descending
    .map(([iconId]) => registry.get(iconId))
    .filter((icon): icon is IconMetadata => icon !== undefined);

  // Apply filters
  if (packId) {
    icons = icons.filter(icon => icon.packId === packId);
  }

  if (variant) {
    icons = icons.filter(icon => icon.variant === variant);
  }

  // Apply limit
  if (limit > 0) {
    icons = icons.slice(0, limit);
  }

  return icons;
}

/**
 * List all registered icon packs
 *
 * @returns {Array} Array of pack metadata objects
 */
export function listPacks(): IconPack[] {
  checkInitialized();
  return Array.from(packs.values());
}

/**
 * Get all icons from a specific pack
 *
 * @param {string} packId - Pack ID
 * @returns {Array} Array of icon metadata objects
 */
export function getIconsByPack(packId: string): IconMetadata[] {
  checkInitialized();

  const pack = packs.get(packId);
  if (!pack) {
    return [];
  }

  const icons = [];
  for (const icon of registry.values()) {
    if (icon.packId === packId) {
      icons.push(icon);
    }
  }

  return icons;
}

/**
 * Get icon SVG content
 *
 * WHY READ ON DEMAND:
 * - SVG content can be large
 * - Only load when actually rendering
 * - Supports caching in upstream code
 *
 * @param {string} id - Icon ID
 * @returns {string|null} SVG content or null if not found
 */
export function getIconSvg(id: string): string | null {
  checkInitialized();

  const icon = registry.get(id);
  if (!icon) {
    return null;
  }

  try {
    return readFileSync(icon.path, 'utf-8');
  } catch (error) {
    console.error(`[icons] Failed to read icon "${id}":`, (error as Error).message);
    return null;
  }
}

/**
 * Get registry statistics
 *
 * @returns {Object} Statistics about icon registry
 */
export function getStats(): { totalPacks: number; totalIcons: number; packs: Array<{ id: string; name: string; iconCount: number; enabled: boolean }> } {
  checkInitialized();

  const stats: { totalPacks: number; totalIcons: number; packs: Array<{ id: string; name: string; iconCount: number; enabled: boolean }> } = {
    totalPacks: packs.size,
    totalIcons: registry.size,
    packs: [],
  };

  for (const pack of packs.values()) {
    stats.packs.push({
      id: pack.id,
      name: pack.name,
      iconCount: pack.iconCount,
      enabled: pack.enabled,
    });
  }

  return stats;
}

/**
 * Check if service is initialized
 */
function checkInitialized(): void {
  if (!initialized) {
    throw new Error('[icons] Service not initialized. Call init() first.');
  }
}

/**
 * Register CLI commands
 *
 * @param {Function} register - CLI register function
 */
export function registerCli(register: (name: string, fn: (args: string[], context: unknown) => Promise<void>, description: string) => void): void {
  register('icons:list', async (args: string[], _context: unknown) => {
    const stats = getStats();

    console.log('\nIcon Packs:');
    console.log('===========\n');

    for (const pack of stats.packs) {
      const status = pack.enabled ? '✓' : '✗';
      console.log(`${status} ${pack.name} (${pack.id})`);
      console.log(`  Icons: ${pack.iconCount}`);
      console.log();
    }

    console.log(`Total: ${stats.totalPacks} packs, ${stats.totalIcons} icons\n`);
  }, 'List all icon packs and statistics');

  register('icons:search', async (args: string[], _context: unknown) => {
    const query = args[0];

    if (!query) {
      console.error('Usage: icons:search <query>');
      return;
    }

    const results = searchIcons(query, { limit: 20 });

    console.log(`\nSearch results for "${query}":`);
    console.log('==============================\n');

    if (results.length === 0) {
      console.log('No icons found.\n');
      return;
    }

    for (const icon of results) {
      console.log(`${icon.id}`);
      console.log(`  Pack: ${icon.packName}`);
      console.log(`  Variant: ${icon.variant}`);
      console.log(`  Tags: ${icon.tags.join(', ')}`);
      console.log();
    }

    console.log(`Found ${results.length} icons\n`);
  }, 'Search for icons by name or tag');

  register('icons:packs', async (args: string[], _context: unknown) => {
    const packsList = listPacks();

    console.log('\nInstalled Icon Packs:');
    console.log('====================\n');

    for (const pack of packsList) {
      const sourceLabel = pack.source === 'plugin' ? ' [plugin]' : '';
      console.log(`${pack.name} (${pack.id})${sourceLabel}`);
      console.log(`  Description: ${pack.description}`);
      console.log(`  Version: ${pack.version}`);
      console.log(`  Type: ${pack.type}`);
      console.log(`  Path: ${pack.path}`);
      console.log(`  Prefix: ${pack.prefix}`);
      console.log(`  Icons: ${pack.iconCount}`);
      console.log();
    }

    console.log(`Total: ${packsList.length} packs\n`);
  }, 'List all icon pack details');

  register('icons:register-pack', async (args: string[], _context: unknown) => {
    const [path, format = 'svg'] = args;

    if (!path) {
      console.error('Usage: icons:register-pack <path> [format]');
      console.error('Example: icons:register-pack public/icons/custom svg');
      return;
    }

    // Extract pack ID from path
    const pathParts = path.split('/');
    const packId = pathParts[pathParts.length - 1]!;

    const packConfig = {
      id: packId,
      name: packId.charAt(0).toUpperCase() + packId.slice(1),
      description: `Custom icon pack registered via CLI`,
      type: format,
      path: path,
      prefix: packId,
      source: 'cli',
    };

    try {
      registerPackExternal(packConfig);

      // Re-discover icons
      discoverIcons();

      console.log(`\n✓ Registered icon pack "${packId}"`);
      console.log(`  Path: ${path}`);
      console.log(`  Format: ${format}`);
      console.log(`  Icons found: ${packs.get(packId)?.iconCount || 0}\n`);
    } catch (error) {
      console.error(`\n✗ Failed to register pack: ${(error as Error).message}\n`);
    }
  }, 'Register a new icon pack from a directory');
}

// Export for name tracking
export const name = 'icons';
