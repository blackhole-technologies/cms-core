/**
 * menu.d.ts - Menu System Contracts
 *
 * WHY THIS EXISTS:
 * Navigation menus are a core CMS feature providing:
 * - Hierarchical navigation structures
 * - Multiple menus per site (main nav, footer, sidebar)
 * - Dynamic menu items linked to content
 * - Access control per menu item
 *
 * DRUPAL HERITAGE:
 * Inspired by Drupal's menu system which provides:
 * - Named menus (main-menu, footer, admin)
 * - Menu links with parent/child relationships
 * - Integration with content for automatic menu items
 * - Weight-based ordering
 *
 * STORAGE STRATEGY:
 * /content
 *   /menu/
 *     main-menu.json
 *     footer.json
 *   /menu-item/
 *     <id>.json
 */

// ============================================
// MENU
// ============================================

/**
 * Menu definition
 * A menu is a named collection of navigation items
 */
export interface Menu {
  /** Unique machine name (e.g., "main-menu", "footer") */
  id: string;

  /** Human-readable title (e.g., "Main Navigation") */
  title: string;

  /** Optional description */
  description?: string;

  /** Whether this is a system menu (cannot be deleted) */
  locked: boolean;

  /** Maximum nesting depth (-1 = unlimited) */
  maxDepth: number;

  /** ISO timestamp when created */
  created: string;

  /** ISO timestamp when last modified */
  updated: string;
}

/**
 * Options for creating/updating a menu
 */
export interface MenuInput {
  id?: string;
  title: string;
  description?: string;
  locked?: boolean;
  maxDepth?: number;
}

// ============================================
// MENU ITEM
// ============================================

/**
 * Menu item link types
 */
export type MenuItemType =
  | 'internal'   // Link to internal path
  | 'external'   // Link to external URL
  | 'content'    // Link to content item
  | 'route'      // Link to named route
  | 'separator'  // Visual separator (no link)
  | 'parent'     // Container only (has children but no link)
  ;

/**
 * Menu item definition
 * Represents a single link in a menu
 */
export interface MenuItem {
  /** Unique identifier */
  id: string;

  /** Menu this item belongs to */
  menuId: string;

  /** Display title */
  title: string;

  /** Item type */
  type: MenuItemType;

  /** Link destination (interpretation depends on type) */
  link: string | null;

  /** For content type: content type name */
  contentType?: string;

  /** For content type: content ID */
  contentId?: string;

  /** For route type: route name */
  routeName?: string;

  /** For route type: route params */
  routeParams?: Record<string, string>;

  /** Parent menu item ID (null for top-level) */
  parentId: string | null;

  /** Weight for ordering at same level */
  weight: number;

  /** Computed depth in hierarchy */
  depth: number;

  /** CSS classes to apply */
  classes?: string[];

  /** HTML attributes (e.g., target, rel) */
  attributes?: Record<string, string>;

  /** Whether item is enabled */
  enabled: boolean;

  /** Whether to show in expanded state (for parents) */
  expanded: boolean;

  /** Access control: required roles */
  roles?: string[];

  /** Access control: required permissions */
  permissions?: string[];

  /** ISO timestamp when created */
  created: string;

  /** ISO timestamp when last modified */
  updated: string;
}

/**
 * Options for creating/updating a menu item
 */
export interface MenuItemInput {
  menuId: string;
  title: string;
  type: MenuItemType;
  link?: string;
  contentType?: string;
  contentId?: string;
  routeName?: string;
  routeParams?: Record<string, string>;
  parentId?: string | null;
  weight?: number;
  classes?: string[];
  attributes?: Record<string, string>;
  enabled?: boolean;
  expanded?: boolean;
  roles?: string[];
  permissions?: string[];
}

/**
 * Menu item with resolved data and children
 */
export interface MenuItemResolved extends MenuItem {
  /** Resolved URL path */
  url: string;

  /** Whether current page matches this item */
  active: boolean;

  /** Whether current page is in this item's subtree */
  activeTrail: boolean;

  /** Child menu items */
  children: MenuItemResolved[];

  /** Linked content data (if type is content) */
  content?: any;
}

// ============================================
// QUERY OPTIONS
// ============================================

/**
 * Options for rendering a menu
 */
export interface MenuRenderOptions {
  /** Maximum depth to render (-1 = all) */
  maxDepth?: number;

  /** Starting level (0 = root) */
  startLevel?: number;

  /** Only show active trail */
  activeTrailOnly?: boolean;

  /** Expand all items (ignore expanded setting) */
  expandAll?: boolean;

  /** Current path for active detection */
  currentPath?: string;

  /** Current user for access control */
  user?: { roles?: string[]; permissions?: string[] };

  /** Include disabled items */
  includeDisabled?: boolean;
}

/**
 * Options for listing menu items
 */
export interface MenuItemListOptions {
  /** Filter by menu */
  menuId?: string;

  /** Filter by parent (null for top-level) */
  parentId?: string | null;

  /** Filter by enabled state */
  enabled?: boolean;

  /** Sort field */
  sort?: 'title' | 'weight' | 'created';

  /** Sort direction */
  order?: 'asc' | 'desc';

  /** Pagination offset */
  offset?: number;

  /** Pagination limit */
  limit?: number;
}

/**
 * Result of menu item list query
 */
export interface MenuItemListResult {
  items: MenuItem[];
  total: number;
  offset: number;
  limit: number;
}

// ============================================
// SERVICE INTERFACE
// ============================================

/**
 * MenuService provides full menu management
 *
 * DESIGN NOTES:
 * - Menus are stored as content items of type "menu"
 * - Menu items are stored as content items of type "menu-item"
 * - Active state is computed at render time based on current path
 * - Access control is evaluated at render time
 */
export interface MenuService {
  // ----------------------------------------
  // INITIALIZATION
  // ----------------------------------------

  /**
   * Initialize menu system
   * @param config - Menu configuration
   * @param contentModule - Reference to content service
   * @param routerModule - Reference to router service
   */
  init(config: MenuConfig, contentModule: ContentService, routerModule?: RouterService): void;

  // ----------------------------------------
  // MENU MANAGEMENT
  // ----------------------------------------

  /**
   * Create a new menu
   * @param input - Menu data
   * @returns Created menu
   */
  createMenu(input: MenuInput): Promise<Menu>;

  /**
   * Get a menu by ID
   * @param id - Menu ID
   * @returns Menu or null if not found
   */
  getMenu(id: string): Menu | null;

  /**
   * Update a menu
   * @param id - Menu ID
   * @param input - Updated data
   * @returns Updated menu
   */
  updateMenu(id: string, input: Partial<MenuInput>): Promise<Menu>;

  /**
   * Delete a menu (and all its items)
   * @param id - Menu ID
   */
  deleteMenu(id: string): Promise<void>;

  /**
   * List all menus
   * @returns Array of menus
   */
  listMenus(): Menu[];

  // ----------------------------------------
  // MENU ITEM MANAGEMENT
  // ----------------------------------------

  /**
   * Create a new menu item
   * @param input - Menu item data
   * @returns Created menu item
   */
  createMenuItem(input: MenuItemInput): Promise<MenuItem>;

  /**
   * Get a menu item by ID
   * @param id - Menu item ID
   * @returns Menu item or null
   */
  getMenuItem(id: string): MenuItem | null;

  /**
   * Update a menu item
   * @param id - Menu item ID
   * @param input - Updated data
   * @returns Updated menu item
   */
  updateMenuItem(id: string, input: Partial<MenuItemInput>): Promise<MenuItem>;

  /**
   * Delete a menu item
   * @param id - Menu item ID
   * @param options - { deleteChildren: boolean, reassignTo: string }
   */
  deleteMenuItem(id: string, options?: { deleteChildren?: boolean; reassignTo?: string }): Promise<void>;

  /**
   * List menu items with filtering
   * @param options - Query options
   * @returns Paginated menu item list
   */
  listMenuItems(options?: MenuItemListOptions): MenuItemListResult;

  /**
   * Move menu item to new parent
   * @param id - Menu item ID
   * @param newParentId - New parent ID (null for root)
   * @param newMenuId - New menu ID (if moving between menus)
   */
  moveMenuItem(id: string, newParentId: string | null, newMenuId?: string): Promise<MenuItem>;

  /**
   * Reorder menu items at same level
   * @param itemIds - Item IDs in desired order
   */
  reorderMenuItems(itemIds: string[]): Promise<void>;

  // ----------------------------------------
  // RENDERING
  // ----------------------------------------

  /**
   * Render a menu tree with resolved URLs and active states
   * @param menuId - Menu ID
   * @param options - Render options
   * @returns Menu tree ready for templating
   */
  renderMenu(menuId: string, options?: MenuRenderOptions): MenuItemResolved[];

  /**
   * Get the active trail for current path
   * @param menuId - Menu ID
   * @param currentPath - Current URL path
   * @returns Array of menu item IDs from root to active item
   */
  getActiveTrail(menuId: string, currentPath: string): string[];

  /**
   * Get breadcrumb items for current path
   * @param menuId - Menu ID
   * @param currentPath - Current URL path
   * @returns Breadcrumb items from root to current
   */
  getBreadcrumbs(menuId: string, currentPath: string): MenuItemResolved[];

  // ----------------------------------------
  // CONTENT INTEGRATION
  // ----------------------------------------

  /**
   * Create menu item for content (auto-link)
   * @param contentType - Content type
   * @param contentId - Content ID
   * @param menuId - Target menu
   * @param options - { parentId, weight, title }
   */
  linkContent(
    contentType: string,
    contentId: string,
    menuId: string,
    options?: { parentId?: string; weight?: number; title?: string }
  ): Promise<MenuItem>;

  /**
   * Find menu items linking to content
   * @param contentType - Content type
   * @param contentId - Content ID
   * @returns Menu items linking to this content
   */
  findItemsByContent(contentType: string, contentId: string): MenuItem[];

  /**
   * Update menu items when content changes
   * Called via hook when content is updated/deleted
   * @param contentType - Content type
   * @param contentId - Content ID
   * @param action - 'update' | 'delete'
   */
  syncContentLinks(contentType: string, contentId: string, action: 'update' | 'delete'): Promise<void>;

  // ----------------------------------------
  // UTILITIES
  // ----------------------------------------

  /**
   * Validate menu item hierarchy (detect cycles)
   * @param itemId - Item ID
   * @param newParentId - Proposed parent ID
   * @returns True if valid
   */
  validateHierarchy(itemId: string, newParentId: string): boolean;

  /**
   * Resolve URL for menu item
   * @param item - Menu item
   * @returns Resolved URL
   */
  resolveUrl(item: MenuItem): string;

  /**
   * Check if user can access menu item
   * @param item - Menu item
   * @param user - User with roles/permissions
   * @returns True if accessible
   */
  checkAccess(item: MenuItem, user?: { roles?: string[]; permissions?: string[] }): boolean;

  /**
   * Export menu to portable format
   * @param menuId - Menu ID
   * @returns Exportable menu structure
   */
  exportMenu(menuId: string): { menu: Menu; items: MenuItem[] };

  /**
   * Import menu from portable format
   * @param data - Exported menu data
   * @param options - { overwrite: boolean }
   */
  importMenu(data: { menu: Menu; items: MenuItem[] }, options?: { overwrite?: boolean }): Promise<Menu>;
}

// ============================================
// CONFIGURATION
// ============================================

/**
 * Menu system configuration
 */
export interface MenuConfig {
  /** Enable menu system */
  enabled?: boolean;

  /** Default menus to create on init */
  defaultMenus?: MenuInput[];

  /** Cache rendered menus */
  cacheRendered?: boolean;

  /** Cache TTL in seconds */
  cacheTTL?: number;

  /** Auto-sync content links */
  autoSyncContent?: boolean;
}

// ============================================
// HOOKS
// ============================================

/**
 * Hook: menu:beforeRender
 * Fired before rendering a menu
 * Context: { menuId: string, options: MenuRenderOptions }
 */

/**
 * Hook: menu:afterRender
 * Fired after rendering a menu (can modify items)
 * Context: { menuId: string, items: MenuItemResolved[] }
 */

/**
 * Hook: menu:beforeCreateItem
 * Fired before creating a menu item
 * Context: { input: MenuItemInput, menu: Menu }
 */

/**
 * Hook: menu:afterCreateItem
 * Fired after creating a menu item
 * Context: { item: MenuItem, menu: Menu }
 */

/**
 * Hook: menu:resolveUrl
 * Fired when resolving menu item URL (can override)
 * Context: { item: MenuItem, url: string }
 */

/**
 * Hook: menu:checkAccess
 * Fired when checking menu item access (can override)
 * Context: { item: MenuItem, user: any, allowed: boolean }
 */

// ============================================
// CLI COMMANDS
// ============================================

/**
 * menu:list - List all menus
 * menu:show <menu-id> - Show menu structure
 * menu:create <id> <title> - Create menu
 * menu:delete <menu-id> - Delete menu
 * menu:add-item <menu-id> <title> <link> [--parent=<id>] - Add item
 * menu:remove-item <item-id> - Remove item
 * menu:export <menu-id> [--output=<file>] - Export menu
 * menu:import <file> [--overwrite] - Import menu
 */

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

interface RouterService {
  match(method: string, url: string): { handler: Function; params: Record<string, string>; route: any } | null;
  urlFor(routeName: string, params?: Record<string, string>): string | null;
}
