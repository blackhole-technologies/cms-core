/**
 * block.d.ts - Block System Contracts
 *
 * WHY THIS EXISTS:
 * Blocks are reusable content chunks placed in page regions:
 * - Site-wide elements (header, footer, sidebar)
 * - Context-aware widgets (related posts, recent comments)
 * - User-configurable page sections
 *
 * DRUPAL HERITAGE:
 * Inspired by Drupal's block system which provides:
 * - Regions defined by themes
 * - Blocks assignable to any region
 * - Visibility rules (pages, roles, content types)
 * - Weight-based ordering within regions
 *
 * STORAGE STRATEGY:
 * /content
 *   /block/
 *     <id>.json
 *   /block-type/
 *     <id>.json (block type definitions with schemas)
 */

// ============================================
// REGION
// ============================================

/**
 * Region definition
 * Regions are defined by templates/themes
 */
export interface Region {
  /** Unique machine name (e.g., "header", "sidebar_left") */
  id: string;

  /** Human-readable label (e.g., "Header", "Left Sidebar") */
  label: string;

  /** Optional description */
  description?: string;

  /** Template that defines this region */
  template?: string;

  /** Weight for ordering regions in admin UI */
  weight: number;
}

// ============================================
// BLOCK TYPE
// ============================================

/**
 * Block type definition
 * Defines a reusable block template with configurable fields
 */
export interface BlockType {
  /** Unique machine name (e.g., "text", "menu", "recent_posts") */
  id: string;

  /** Human-readable label */
  label: string;

  /** Description of what this block type does */
  description?: string;

  /** Category for organizing in admin UI */
  category: string;

  /** Icon identifier */
  icon?: string;

  /** Field schema for block configuration */
  schema: Record<string, FieldDefinition>;

  /** Default field values */
  defaults?: Record<string, any>;

  /** Template name for rendering */
  template?: string;

  /** Custom render function (alternative to template) */
  render?: (block: Block, context: RenderContext) => string | Promise<string>;

  /** Source: 'core', module name, or 'config' */
  source: string;

  /** Whether this type can be created by users */
  userCreatable: boolean;
}

/**
 * Options for creating a block type
 */
export interface BlockTypeInput {
  id?: string;
  label: string;
  description?: string;
  category?: string;
  icon?: string;
  schema: Record<string, FieldDefinition>;
  defaults?: Record<string, any>;
  template?: string;
  render?: (block: Block, context: RenderContext) => string | Promise<string>;
  userCreatable?: boolean;
}

// ============================================
// BLOCK
// ============================================

/**
 * Block visibility rule types
 */
export type VisibilityType =
  | 'pages'        // Show/hide on specific paths
  | 'content'      // Show/hide for content types
  | 'roles'        // Show/hide for user roles
  | 'query'        // Show/hide based on query params
  | 'custom'       // Custom visibility callback
  ;

/**
 * Block visibility rule
 */
export interface VisibilityRule {
  /** Rule type */
  type: VisibilityType;

  /** Whether to show (true) or hide (false) when rule matches */
  show: boolean;

  /** Rule configuration (varies by type) */
  config: {
    /** For pages: array of path patterns */
    paths?: string[];

    /** For content: array of content types */
    contentTypes?: string[];

    /** For roles: array of role names */
    roles?: string[];

    /** For query: query parameter conditions */
    query?: Record<string, string | string[]>;

    /** For custom: callback name */
    callback?: string;
  };
}

/**
 * Block definition
 * A configured instance of a block type
 */
export interface Block {
  /** Unique identifier */
  id: string;

  /** Block type */
  type: string;

  /** Admin title (for identifying in admin UI) */
  adminTitle: string;

  /** Display title (shown to users, optional) */
  title?: string;

  /** Whether to show the title */
  showTitle: boolean;

  /** Assigned region (null if unassigned) */
  regionId: string | null;

  /** Weight for ordering within region */
  weight: number;

  /** Block-specific configuration (per block type schema) */
  config: Record<string, any>;

  /** Visibility rules */
  visibility: VisibilityRule[];

  /** Whether block is enabled */
  enabled: boolean;

  /** Cache settings */
  cache: {
    /** Cache mode: 'none', 'global', 'per-user', 'per-page', 'per-role' */
    mode: 'none' | 'global' | 'per-user' | 'per-page' | 'per-role';
    /** Max age in seconds (0 = indefinite) */
    maxAge: number;
  };

  /** ISO timestamp when created */
  created: string;

  /** ISO timestamp when last modified */
  updated: string;
}

/**
 * Options for creating/updating a block
 */
export interface BlockInput {
  type: string;
  adminTitle: string;
  title?: string;
  showTitle?: boolean;
  regionId?: string | null;
  weight?: number;
  config?: Record<string, any>;
  visibility?: VisibilityRule[];
  enabled?: boolean;
  cache?: {
    mode?: 'none' | 'global' | 'per-user' | 'per-page' | 'per-role';
    maxAge?: number;
  };
}

/**
 * Block with rendered content
 */
export interface BlockRendered extends Block {
  /** Rendered HTML content */
  html: string;

  /** Whether block was served from cache */
  cached: boolean;

  /** Render time in ms */
  renderTime: number;
}

// ============================================
// QUERY OPTIONS
// ============================================

/**
 * Options for listing blocks
 */
export interface BlockListOptions {
  /** Filter by region */
  regionId?: string;

  /** Filter by block type */
  type?: string;

  /** Filter by enabled state */
  enabled?: boolean;

  /** Sort field */
  sort?: 'adminTitle' | 'weight' | 'created' | 'updated';

  /** Sort direction */
  order?: 'asc' | 'desc';

  /** Pagination offset */
  offset?: number;

  /** Pagination limit */
  limit?: number;
}

/**
 * Result of block list query
 */
export interface BlockListResult {
  items: Block[];
  total: number;
  offset: number;
  limit: number;
}

/**
 * Context for rendering blocks
 */
export interface RenderContext {
  /** Current request path */
  path: string;

  /** Query parameters */
  query: Record<string, string>;

  /** Current user */
  user?: {
    id: string;
    roles: string[];
  };

  /** Current content (if viewing content) */
  content?: {
    type: string;
    id: string;
    data: any;
  };

  /** Service references */
  services: {
    content: ContentService;
    menu?: MenuService;
    taxonomy?: TaxonomyService;
  };

  /** Additional custom context */
  [key: string]: any;
}

// ============================================
// SERVICE INTERFACE
// ============================================

/**
 * BlockService provides full block management
 *
 * DESIGN NOTES:
 * - Block types are registered like content types (with schemas)
 * - Blocks are instances with config values
 * - Regions are defined by templates/themes
 * - Visibility is evaluated at render time
 */
export interface BlockService {
  // ----------------------------------------
  // INITIALIZATION
  // ----------------------------------------

  /**
   * Initialize block system
   * @param config - Block configuration
   * @param contentModule - Reference to content service
   */
  init(config: BlockConfig, contentModule: ContentService): void;

  // ----------------------------------------
  // BLOCK TYPE MANAGEMENT
  // ----------------------------------------

  /**
   * Register a block type
   * @param input - Block type definition
   */
  registerBlockType(input: BlockTypeInput): void;

  /**
   * Get a block type by ID
   * @param id - Block type ID
   * @returns Block type or null
   */
  getBlockType(id: string): BlockType | null;

  /**
   * List all block types
   * @param category - Optional category filter
   * @returns Array of block types
   */
  listBlockTypes(category?: string): BlockType[];

  /**
   * List block type categories
   * @returns Array of category names
   */
  listCategories(): string[];

  // ----------------------------------------
  // REGION MANAGEMENT
  // ----------------------------------------

  /**
   * Register a region
   * @param region - Region definition
   */
  registerRegion(region: Region): void;

  /**
   * Get a region by ID
   * @param id - Region ID
   * @returns Region or null
   */
  getRegion(id: string): Region | null;

  /**
   * List all regions
   * @returns Array of regions
   */
  listRegions(): Region[];

  // ----------------------------------------
  // BLOCK MANAGEMENT
  // ----------------------------------------

  /**
   * Create a new block
   * @param input - Block data
   * @returns Created block
   */
  createBlock(input: BlockInput): Promise<Block>;

  /**
   * Get a block by ID
   * @param id - Block ID
   * @returns Block or null
   */
  getBlock(id: string): Block | null;

  /**
   * Update a block
   * @param id - Block ID
   * @param input - Updated data
   * @returns Updated block
   */
  updateBlock(id: string, input: Partial<BlockInput>): Promise<Block>;

  /**
   * Delete a block
   * @param id - Block ID
   */
  deleteBlock(id: string): Promise<void>;

  /**
   * List blocks with filtering
   * @param options - Query options
   * @returns Paginated block list
   */
  listBlocks(options?: BlockListOptions): BlockListResult;

  /**
   * Move block to region
   * @param blockId - Block ID
   * @param regionId - Target region (null to unassign)
   * @param weight - Optional new weight
   */
  moveToRegion(blockId: string, regionId: string | null, weight?: number): Promise<Block>;

  /**
   * Reorder blocks within region
   * @param regionId - Region ID
   * @param blockIds - Block IDs in desired order
   */
  reorderBlocks(regionId: string, blockIds: string[]): Promise<void>;

  // ----------------------------------------
  // RENDERING
  // ----------------------------------------

  /**
   * Render a single block
   * @param blockId - Block ID
   * @param context - Render context
   * @returns Rendered block
   */
  renderBlock(blockId: string, context: RenderContext): Promise<BlockRendered>;

  /**
   * Render all blocks in a region
   * @param regionId - Region ID
   * @param context - Render context
   * @returns Array of rendered blocks
   */
  renderRegion(regionId: string, context: RenderContext): Promise<BlockRendered[]>;

  /**
   * Render all regions for a page
   * @param context - Render context
   * @returns Map of regionId -> rendered blocks
   */
  renderAllRegions(context: RenderContext): Promise<Map<string, BlockRendered[]>>;

  // ----------------------------------------
  // VISIBILITY
  // ----------------------------------------

  /**
   * Check if block should be visible
   * @param block - Block to check
   * @param context - Render context
   * @returns True if visible
   */
  checkVisibility(block: Block, context: RenderContext): boolean;

  /**
   * Add visibility rule to block
   * @param blockId - Block ID
   * @param rule - Visibility rule
   */
  addVisibilityRule(blockId: string, rule: VisibilityRule): Promise<Block>;

  /**
   * Remove visibility rule from block
   * @param blockId - Block ID
   * @param ruleIndex - Index of rule to remove
   */
  removeVisibilityRule(blockId: string, ruleIndex: number): Promise<Block>;

  // ----------------------------------------
  // CACHING
  // ----------------------------------------

  /**
   * Clear block cache
   * @param blockId - Block ID (all if omitted)
   */
  clearCache(blockId?: string): void;

  /**
   * Get cache key for block
   * @param block - Block
   * @param context - Render context
   * @returns Cache key
   */
  getCacheKey(block: Block, context: RenderContext): string;

  // ----------------------------------------
  // UTILITIES
  // ----------------------------------------

  /**
   * Clone a block
   * @param blockId - Source block ID
   * @param overrides - Optional property overrides
   * @returns Cloned block
   */
  cloneBlock(blockId: string, overrides?: Partial<BlockInput>): Promise<Block>;

  /**
   * Export block configuration
   * @param blockId - Block ID
   * @returns Exportable block data
   */
  exportBlock(blockId: string): { block: Block; type: BlockType };

  /**
   * Import block configuration
   * @param data - Exported block data
   * @param options - { overwrite: boolean }
   */
  importBlock(data: { block: Block; type: BlockType }, options?: { overwrite?: boolean }): Promise<Block>;

  /**
   * Get blocks by type
   * @param typeId - Block type ID
   * @returns Blocks of this type
   */
  getBlocksByType(typeId: string): Block[];
}

// ============================================
// CONFIGURATION
// ============================================

/**
 * Block system configuration
 */
export interface BlockConfig {
  /** Enable block system */
  enabled?: boolean;

  /** Default cache settings */
  cache?: {
    enabled?: boolean;
    defaultMode?: 'none' | 'global' | 'per-user' | 'per-page' | 'per-role';
    defaultMaxAge?: number;
  };

  /** Built-in block types to register */
  builtinTypes?: boolean;

  /** Default regions */
  defaultRegions?: Region[];
}

// ============================================
// BUILT-IN BLOCK TYPES
// ============================================

/**
 * Built-in block types provided by core:
 *
 * text - Static HTML/text content
 *   schema: { body: { type: 'html' } }
 *
 * menu - Render a menu
 *   schema: { menuId: { type: 'select', options: menus }, level: { type: 'number' } }
 *
 * recent_content - List recent content items
 *   schema: { contentType: { type: 'select' }, limit: { type: 'number' } }
 *
 * search - Search form
 *   schema: { placeholder: { type: 'string' }, action: { type: 'string' } }
 *
 * login - Login form (or user info if logged in)
 *   schema: { showRegister: { type: 'boolean' } }
 *
 * breadcrumb - Breadcrumb navigation
 *   schema: { menuId: { type: 'select' }, showHome: { type: 'boolean' } }
 *
 * taxonomy_terms - List terms from vocabulary
 *   schema: { vocabularyId: { type: 'select' }, showCount: { type: 'boolean' } }
 */

// ============================================
// HOOKS
// ============================================

/**
 * Hook: block:beforeRender
 * Fired before rendering a block
 * Context: { block: Block, context: RenderContext }
 */

/**
 * Hook: block:afterRender
 * Fired after rendering a block (can modify html)
 * Context: { block: Block, html: string, context: RenderContext }
 */

/**
 * Hook: block:checkVisibility
 * Fired when checking visibility (can override)
 * Context: { block: Block, context: RenderContext, visible: boolean }
 */

/**
 * Hook: region:beforeRender
 * Fired before rendering a region
 * Context: { regionId: string, blocks: Block[], context: RenderContext }
 */

/**
 * Hook: region:afterRender
 * Fired after rendering a region
 * Context: { regionId: string, rendered: BlockRendered[], context: RenderContext }
 */

// ============================================
// CLI COMMANDS
// ============================================

/**
 * block:list [--region=<id>] [--type=<type>] - List blocks
 * block:show <id> - Show block details
 * block:create <type> <admin-title> [--region=<id>] - Create block
 * block:update <id> --config='{"key":"value"}' - Update block config
 * block:delete <id> - Delete block
 * block:move <id> <region> [--weight=<n>] - Move to region
 * block:types - List block types
 * block:regions - List regions
 * block:clear-cache [<id>] - Clear block cache
 */

// ============================================
// FIELD DEFINITION STUB (for type reference)
// ============================================

interface FieldDefinition {
  type: string;
  required?: boolean;
  label?: string;
  description?: string;
  defaultValue?: any;
  options?: any;
  [key: string]: any;
}

// ============================================
// SERVICE STUBS (for type reference)
// ============================================

interface ContentService {
  create(type: string, data: any): Promise<any>;
  read(type: string, id: string): any;
  update(type: string, id: string, data: any): Promise<any>;
  delete(type: string, id: string): Promise<void>;
  list(type: string, options?: any): { items: any[]; total: number };
  register(type: string, schema: any): void;
}

interface MenuService {
  renderMenu(menuId: string, options?: any): any[];
}

interface TaxonomyService {
  listTerms(options?: any): { items: any[]; total: number };
}
