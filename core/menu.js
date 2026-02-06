/**
 * menu.js - Menu Management System
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
 * Menus stored as content items (type: "menu")
 * Menu items stored as content items (type: "menu-item")
 * This leverages existing content API for CRUD operations
 *
 * DESIGN DECISIONS:
 * - No external dependencies (zero-dependency requirement)
 * - Active state computed at render time based on current path
 * - Access control evaluated at render time
 * - Hierarchical structure built from flat item list
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as hooks from './hooks.js';

/**
 * Configuration
 */
let config = {
  enabled: true,
  cacheRendered: false,
  cacheTTL: 300,
  autoSyncContent: true,
};

/**
 * Services and paths
 */
let contentService = null;
let routerService = null;
let baseDir = null;

/**
 * Default menus to create on init
 */
const DEFAULT_MENUS = [
  {
    id: 'main',
    title: 'Main Navigation',
    description: 'Primary site navigation',
    locked: true,
    maxDepth: -1,
  },
  {
    id: 'footer',
    title: 'Footer',
    description: 'Footer navigation links',
    locked: true,
    maxDepth: 1,
  },
  {
    id: 'admin',
    title: 'Administration',
    description: 'Admin menu',
    locked: true,
    maxDepth: 2,
  },
];

/**
 * Initialize menu system
 *
 * WHY SEPARATE INIT:
 * - Allows dependency injection of content service
 * - Defers filesystem operations until needed
 * - Can be re-initialized for testing
 *
 * @param {Object} menuConfig - Menu configuration
 * @param {Object} content - Content service reference
 * @param {Object} router - Router service reference (optional)
 * @param {string} baseDirPath - Base directory for content storage
 */
export function init(menuConfig = {}, content = null, router = null, baseDirPath = null) {
  config = { ...config, ...menuConfig };
  contentService = content;
  routerService = router;
  baseDir = baseDirPath;

  if (!contentService) {
    throw new Error('[menu] Content service is required');
  }

  // Register content types for menus
  registerMenuTypes();

  // Create default menus if they don't exist
  // Config may provide strings (IDs) or full objects
  const configMenus = config.defaultMenus || null;
  const defaultMenus = configMenus
    ? configMenus.map(m => typeof m === 'string'
      ? DEFAULT_MENUS.find(d => d.id === m) || { id: m, title: m.charAt(0).toUpperCase() + m.slice(1), description: '' }
      : m)
    : DEFAULT_MENUS;

  for (const menuInput of defaultMenus) {
    const existing = contentService.read('menu', menuInput.id);
    if (!existing) {
      createMenuSync(menuInput);
    }
  }

  // Register content hooks for auto-sync
  if (config.autoSyncContent) {
    hooks.register('content:afterUpdate', handleContentUpdate, 10, 'menu');
    hooks.register('content:afterDelete', handleContentDelete, 10, 'menu');
  }
}

/**
 * Register menu and menu-item content types
 *
 * WHY AS CONTENT TYPES:
 * - Reuses existing content storage and API
 * - Gets automatic JSON file handling
 * - Can use content list/filter features
 */
function registerMenuTypes() {
  // Register menu type
  contentService.register('menu', {
    title: { type: 'string', required: true },
    description: { type: 'string' },
    locked: { type: 'boolean', default: false },
    maxDepth: { type: 'number', default: -1 },
    created: { type: 'string', auto: 'timestamp' },
    updated: { type: 'string', auto: 'timestamp' },
  });

  // Register menu-item type
  contentService.register('menu-item', {
    menuId: { type: 'string', required: true },
    title: { type: 'string', required: true },
    itemType: { type: 'string', default: 'internal' },
    link: { type: 'string' },
    contentType: { type: 'string' },
    contentId: { type: 'string' },
    routeName: { type: 'string' },
    routeParams: { type: 'object' },
    parentId: { type: 'string', default: null },
    weight: { type: 'number', default: 0 },
    depth: { type: 'number', default: 0 },
    classes: { type: 'array' },
    attributes: { type: 'object' },
    enabled: { type: 'boolean', default: true },
    expanded: { type: 'boolean', default: false },
    roles: { type: 'array' },
    permissions: { type: 'array' },
    created: { type: 'string', auto: 'timestamp' },
    updated: { type: 'string', auto: 'timestamp' },
  });
}

// ============================================
// MENU MANAGEMENT
// ============================================

/**
 * Create a new menu
 *
 * @param {Object} input - Menu data
 * @returns {Promise<Object>} Created menu
 */
export async function createMenu(input) {
  // Trigger before hook
  await hooks.trigger('menu:beforeCreate', { input });

  const menu = createMenuSync(input);

  // Trigger after hook
  await hooks.trigger('menu:afterCreate', { menu });

  return menu;
}

/**
 * Create menu synchronously (for init)
 */
function createMenuSync(input) {
  const now = new Date().toISOString();
  const menu = {
    id: input.id || generateMenuId(input.title),
    title: input.title,
    description: input.description || '',
    locked: input.locked || false,
    maxDepth: input.maxDepth !== undefined ? input.maxDepth : -1,
    created: now,
    updated: now,
  };

  // Direct write for sync init
  const menuDir = join(baseDir, 'content', 'menu');
  if (!existsSync(menuDir)) {
    mkdirSync(menuDir, { recursive: true });
  }

  const filePath = join(menuDir, `${menu.id}.json`);
  if (!existsSync(filePath)) {
    writeFileSync(filePath, JSON.stringify(menu, null, 2) + '\n');
  }

  return menu;
}

/**
 * Get a menu by ID
 *
 * @param {string} id - Menu ID
 * @returns {Object|null} Menu or null
 */
export function getMenu(id) {
  return contentService.read('menu', id);
}

/**
 * Update a menu
 *
 * @param {string} id - Menu ID
 * @param {Object} input - Updated data
 * @returns {Promise<Object>} Updated menu
 */
export async function updateMenu(id, input) {
  const menu = getMenu(id);
  if (!menu) {
    throw new Error(`Menu "${id}" not found`);
  }

  if (menu.locked && input.id && input.id !== id) {
    throw new Error(`Cannot change ID of locked menu "${id}"`);
  }

  // Trigger before hook
  await hooks.trigger('menu:beforeUpdate', { menu, input });

  const updates = {
    ...input,
    updated: new Date().toISOString(),
  };

  const updated = await contentService.update('menu', id, updates);

  // Trigger after hook
  await hooks.trigger('menu:afterUpdate', { menu: updated });

  return updated;
}

/**
 * Delete a menu (and all its items)
 *
 * @param {string} id - Menu ID
 */
export async function deleteMenu(id) {
  const menu = getMenu(id);
  if (!menu) {
    throw new Error(`Menu "${id}" not found`);
  }

  if (menu.locked) {
    throw new Error(`Cannot delete locked menu "${id}"`);
  }

  // Trigger before hook
  await hooks.trigger('menu:beforeDelete', { menu });

  // Delete all menu items
  const items = listMenuItems({ menuId: id });
  for (const item of items.items) {
    await contentService.delete('menu-item', item.id);
  }

  // Delete menu
  await contentService.delete('menu', id);

  // Trigger after hook
  await hooks.trigger('menu:afterDelete', { menuId: id });
}

/**
 * List all menus
 *
 * @returns {Array<Object>} Array of menus
 */
export function listMenus() {
  const result = contentService.list('menu', { limit: 10000 });
  return result.items;
}

// ============================================
// MENU ITEM MANAGEMENT
// ============================================

/**
 * Create a new menu item
 *
 * @param {Object} input - Menu item data
 * @returns {Promise<Object>} Created menu item
 */
export async function createMenuItem(input) {
  // Validate menu exists
  const menu = getMenu(input.menuId);
  if (!menu) {
    throw new Error(`Menu "${input.menuId}" not found`);
  }

  // Validate parent exists if specified
  if (input.parentId) {
    const parent = getMenuItem(input.parentId);
    if (!parent) {
      throw new Error(`Parent menu item "${input.parentId}" not found`);
    }
    if (parent.menuId !== input.menuId) {
      throw new Error('Parent must be in same menu');
    }
  }

  // Trigger before hook
  await hooks.trigger('menu:beforeCreateItem', { input, menu });

  const depth = calculateDepth(input.parentId);

  // Don't set id - let the content service generate a consistent file-based ID
  const itemData = {
    menuId: input.menuId,
    title: input.title,
    itemType: input.type || 'internal',
    link: input.link || null,
    contentType: input.contentType,
    contentId: input.contentId,
    routeName: input.routeName,
    routeParams: input.routeParams,
    parentId: input.parentId || null,
    weight: input.weight !== undefined ? input.weight : 0,
    depth,
    classes: input.classes || [],
    attributes: input.attributes || {},
    enabled: input.enabled !== undefined ? input.enabled : true,
    expanded: input.expanded !== undefined ? input.expanded : false,
    roles: input.roles || [],
    permissions: input.permissions || [],
  };

  // Store as content - returns item with generated id matching filename
  const item = await contentService.create('menu-item', itemData);

  // Trigger after hook
  await hooks.trigger('menu:afterCreateItem', { item, menu });

  return item;
}

/**
 * Get a menu item by ID
 *
 * @param {string} id - Menu item ID
 * @returns {Object|null} Menu item or null
 */
export function getMenuItem(id) {
  return contentService.read('menu-item', id);
}

/**
 * Update a menu item
 *
 * @param {string} id - Menu item ID
 * @param {Object} input - Updated data
 * @returns {Promise<Object>} Updated menu item
 */
export async function updateMenuItem(id, input) {
  const item = getMenuItem(id);
  if (!item) {
    throw new Error(`Menu item "${id}" not found`);
  }

  // Validate hierarchy changes
  if (input.parentId !== undefined && input.parentId !== item.parentId) {
    if (input.parentId) {
      if (!validateHierarchy(id, input.parentId)) {
        throw new Error('Invalid hierarchy: would create cycle');
      }
    }
  }

  // Trigger before hook
  await hooks.trigger('menu:beforeUpdateItem', { item, input });

  // Recalculate depth if parent changed
  let depth = item.depth;
  if (input.parentId !== undefined && input.parentId !== item.parentId) {
    depth = calculateDepth(input.parentId);
  }

  const updates = {
    ...input,
    depth,
    updated: new Date().toISOString(),
  };

  const updated = await contentService.update('menu-item', id, updates);

  // Update depths of all descendants if parent changed
  if (input.parentId !== undefined && input.parentId !== item.parentId) {
    await updateDescendantDepths(id);
  }

  // Trigger after hook
  await hooks.trigger('menu:afterUpdateItem', { item: updated });

  return updated;
}

/**
 * Delete a menu item
 *
 * @param {string} id - Menu item ID
 * @param {Object} options - Deletion options
 */
export async function deleteMenuItem(id, options = {}) {
  const item = getMenuItem(id);
  if (!item) {
    throw new Error(`Menu item "${id}" not found`);
  }

  // Trigger before hook
  await hooks.trigger('menu:beforeDeleteItem', { item, options });

  // Handle children
  const children = listMenuItems({ parentId: id });

  if (options.deleteChildren) {
    // Recursively delete children
    for (const child of children.items) {
      await deleteMenuItem(child.id, { deleteChildren: true });
    }
  } else if (options.reassignTo !== undefined) {
    // Reassign children to new parent
    for (const child of children.items) {
      await updateMenuItem(child.id, { parentId: options.reassignTo });
    }
  } else if (children.items.length > 0) {
    // Default: reassign to item's parent
    for (const child of children.items) {
      await updateMenuItem(child.id, { parentId: item.parentId });
    }
  }

  // Delete item
  await contentService.delete('menu-item', id);

  // Trigger after hook
  await hooks.trigger('menu:afterDeleteItem', { itemId: id });
}

/**
 * List menu items with filtering
 *
 * @param {Object} options - Query options
 * @returns {Object} Paginated menu item list
 */
export function listMenuItems(options = {}) {
  // Content service expects filters as object with field__operator keys
  const filters = {};

  if (options.menuId) {
    filters.menuId = options.menuId;
  }

  if (options.parentId !== undefined) {
    filters.parentId = options.parentId;
  }

  if (options.enabled !== undefined) {
    // Content service filter expects string values for boolean comparison
    filters.enabled = String(options.enabled);
  }

  const sortBy = options.sort || 'weight';
  const sortOrder = options.order || 'asc';
  // Use large limit instead of -1 to avoid slice(0, -1) bug in content service pagination
  const limit = options.limit && options.limit > 0 ? options.limit : 10000;

  return contentService.list('menu-item', {
    filters,
    sortBy,
    sortOrder,
    limit,
  });
}

/**
 * Move menu item to new parent
 *
 * @param {string} id - Menu item ID
 * @param {string|null} newParentId - New parent ID (null for root)
 * @param {string} newMenuId - New menu ID (if moving between menus)
 * @returns {Promise<Object>} Updated menu item
 */
export async function moveMenuItem(id, newParentId, newMenuId = null) {
  const item = getMenuItem(id);
  if (!item) {
    throw new Error(`Menu item "${id}" not found`);
  }

  // Validate new parent
  if (newParentId) {
    if (!validateHierarchy(id, newParentId)) {
      throw new Error('Invalid hierarchy: would create cycle');
    }
  }

  const updates = { parentId: newParentId };

  // If moving to different menu, validate and update
  if (newMenuId && newMenuId !== item.menuId) {
    const newMenu = getMenu(newMenuId);
    if (!newMenu) {
      throw new Error(`Menu "${newMenuId}" not found`);
    }
    updates.menuId = newMenuId;
  }

  return updateMenuItem(id, updates);
}

/**
 * Reorder menu items at same level
 *
 * @param {Array<string>} itemIds - Item IDs in desired order
 */
export async function reorderMenuItems(itemIds) {
  // Update weight of each item based on position
  for (let i = 0; i < itemIds.length; i++) {
    await updateMenuItem(itemIds[i], { weight: i });
  }
}

// ============================================
// RENDERING
// ============================================

/**
 * Render a menu tree with resolved URLs and active states
 *
 * @param {string} menuId - Menu ID
 * @param {Object} options - Render options
 * @returns {Array<Object>} Menu tree ready for templating
 */
export function renderMenu(menuId, options = {}) {
  const menu = getMenu(menuId);
  if (!menu) {
    return [];
  }

  // Trigger before render hook
  hooks.trigger('menu:beforeRender', { menuId, options });

  // Get all items for this menu
  const result = listMenuItems({
    menuId,
    enabled: options.includeDisabled ? undefined : true,
  });

  let items = result.items;

  // Filter by access control
  if (options.user) {
    items = items.filter(item => checkAccess(item, options.user));
  }

  // Build tree structure
  const tree = buildTree(items, null, options);

  // Resolve URLs and active states
  const resolved = tree.map(item => resolveMenuItem(item, options));

  // Trigger after render hook
  hooks.trigger('menu:afterRender', { menuId, items: resolved });

  return resolved;
}

/**
 * Build hierarchical tree from flat item list
 *
 * WHY RECURSIVE:
 * - Natural representation of tree structure
 * - Handles arbitrary nesting depth
 * - Simpler than iterative stack-based approach
 *
 * @param {Array} items - Flat list of menu items
 * @param {string|null} parentId - Parent ID to filter by
 * @param {Object} options - Render options
 * @returns {Array} Tree of menu items
 */
function buildTree(items, parentId, options) {
  const maxDepth = options.maxDepth !== undefined ? options.maxDepth : -1;
  const startLevel = options.startLevel || 0;

  const children = items
    .filter(item => item.parentId === parentId)
    .sort((a, b) => a.weight - b.weight);

  return children
    .map(item => {
      // Skip if beyond max depth
      if (maxDepth !== -1 && item.depth >= maxDepth) {
        return null;
      }

      // Skip if before start level
      if (item.depth < startLevel) {
        return null;
      }

      // Recursively get children
      const itemChildren = buildTree(items, item.id, options);

      return {
        ...item,
        children: itemChildren,
      };
    })
    .filter(item => item !== null);
}

/**
 * Resolve menu item URLs and active states
 *
 * @param {Object} item - Menu item with children
 * @param {Object} options - Render options
 * @returns {Object} Resolved menu item
 */
function resolveMenuItem(item, options) {
  const url = resolveUrl(item);
  const currentPath = options.currentPath || '';

  // Check if this item is active
  const active = currentPath === url || currentPath === item.link;

  // Check if in active trail (current path starts with this URL)
  const activeTrail = active || currentPath.startsWith(url + '/');

  // Resolve children recursively
  const children = item.children.map(child => resolveMenuItem(child, options));

  // Also consider in trail if any child is in trail
  const childInTrail = children.some(child => child.activeTrail);

  return {
    ...item,
    url,
    active,
    activeTrail: activeTrail || childInTrail,
    children,
  };
}

/**
 * Get the active trail for current path
 *
 * @param {string} menuId - Menu ID
 * @param {string} currentPath - Current URL path
 * @returns {Array<string>} Array of menu item IDs from root to active
 */
export function getActiveTrail(menuId, currentPath) {
  const rendered = renderMenu(menuId, { currentPath });
  const trail = [];

  function findTrail(items) {
    for (const item of items) {
      if (item.active || item.activeTrail) {
        trail.push(item.id);
        if (item.children.length > 0) {
          findTrail(item.children);
        }
        return true;
      }
    }
    return false;
  }

  findTrail(rendered);
  return trail;
}

/**
 * Get breadcrumb items for current path
 *
 * @param {string} menuId - Menu ID
 * @param {string} currentPath - Current URL path
 * @returns {Array<Object>} Breadcrumb items from root to current
 */
export function getBreadcrumbs(menuId, currentPath) {
  const rendered = renderMenu(menuId, { currentPath });
  const breadcrumbs = [];

  function findBreadcrumbs(items) {
    for (const item of items) {
      if (item.active || item.activeTrail) {
        breadcrumbs.push({
          id: item.id,
          title: item.title,
          url: item.url,
          active: item.active,
        });
        if (item.children.length > 0) {
          findBreadcrumbs(item.children);
        }
        return true;
      }
    }
    return false;
  }

  findBreadcrumbs(rendered);
  return breadcrumbs;
}

// ============================================
// CONTENT INTEGRATION
// ============================================

/**
 * Create menu item for content (auto-link)
 *
 * @param {string} contentType - Content type
 * @param {string} contentId - Content ID
 * @param {string} menuId - Target menu
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Created menu item
 */
export async function linkContent(contentType, contentId, menuId, options = {}) {
  const content = contentService.read(contentType, contentId);
  if (!content) {
    throw new Error(`Content "${contentType}/${contentId}" not found`);
  }

  const title = options.title || content.title || content.name || 'Untitled';

  return createMenuItem({
    menuId,
    title,
    type: 'content',
    contentType,
    contentId,
    parentId: options.parentId || null,
    weight: options.weight !== undefined ? options.weight : 0,
  });
}

/**
 * Find menu items linking to content
 *
 * @param {string} contentType - Content type
 * @param {string} contentId - Content ID
 * @returns {Array<Object>} Menu items linking to this content
 */
export function findItemsByContent(contentType, contentId) {
  const result = contentService.list('menu-item', {
    filters: [
      { field: 'contentType', op: 'eq', value: contentType },
      { field: 'contentId', op: 'eq', value: contentId },
    ],
    limit: 10000,
  });

  return result.items;
}

/**
 * Update menu items when content changes
 *
 * @param {string} contentType - Content type
 * @param {string} contentId - Content ID
 * @param {string} action - 'update' | 'delete'
 */
export async function syncContentLinks(contentType, contentId, action) {
  const items = findItemsByContent(contentType, contentId);

  if (action === 'delete') {
    // Delete or disable menu items for deleted content
    for (const item of items) {
      await updateMenuItem(item.id, { enabled: false });
    }
  } else if (action === 'update') {
    // Update titles if content title changed
    const content = contentService.read(contentType, contentId);
    if (content) {
      const newTitle = content.title || content.name;
      if (newTitle) {
        for (const item of items) {
          await updateMenuItem(item.id, { title: newTitle });
        }
      }
    }
  }
}

/**
 * Hook handler for content updates
 */
async function handleContentUpdate(context) {
  const { type, id } = context;
  if (type !== 'menu' && type !== 'menu-item') {
    await syncContentLinks(type, id, 'update');
  }
}

/**
 * Hook handler for content deletion
 */
async function handleContentDelete(context) {
  const { type, id } = context;
  if (type !== 'menu' && type !== 'menu-item') {
    await syncContentLinks(type, id, 'delete');
  }
}

// ============================================
// UTILITIES
// ============================================

/**
 * Validate menu item hierarchy (detect cycles)
 *
 * WHY IMPORTANT:
 * - Prevents infinite loops in tree building
 * - Maintains data integrity
 * - Circular references break rendering
 *
 * @param {string} itemId - Item ID
 * @param {string} newParentId - Proposed parent ID
 * @returns {boolean} True if valid
 */
export function validateHierarchy(itemId, newParentId) {
  if (!newParentId) return true;
  if (itemId === newParentId) return false;

  // Walk up the tree from new parent
  let current = newParentId;
  const visited = new Set();

  while (current) {
    if (current === itemId) {
      return false; // Cycle detected
    }

    if (visited.has(current)) {
      return false; // Already visited - existing cycle
    }

    visited.add(current);

    const parent = getMenuItem(current);
    if (!parent) break;

    current = parent.parentId;
  }

  return true;
}

/**
 * Resolve URL for menu item
 *
 * @param {Object} item - Menu item
 * @returns {string} Resolved URL
 */
export function resolveUrl(item) {
  // Allow hooks to override URL resolution
  const context = { item, url: null };
  hooks.trigger('menu:resolveUrl', context);
  if (context.url) return context.url;

  switch (item.itemType) {
    case 'external':
      return item.link || '#';

    case 'content':
      // Build URL from content type and ID
      if (item.contentType && item.contentId) {
        return `/${item.contentType}/${item.contentId}`;
      }
      return '#';

    case 'route':
      // Use router service if available
      if (routerService && item.routeName) {
        const url = routerService.urlFor(item.routeName, item.routeParams);
        if (url) return url;
      }
      return item.link || '#';

    case 'separator':
    case 'parent':
      return '#';

    case 'internal':
    default:
      return item.link || '#';
  }
}

/**
 * Check if user can access menu item
 *
 * @param {Object} item - Menu item
 * @param {Object} user - User with roles/permissions
 * @returns {boolean} True if accessible
 */
export function checkAccess(item, user = {}) {
  // Allow hooks to override access check
  const context = { item, user, allowed: true };
  hooks.trigger('menu:checkAccess', context);
  if (!context.allowed) return false;

  // Check roles
  if (item.roles && item.roles.length > 0) {
    const userRoles = user.roles || [];
    const hasRole = item.roles.some(role => userRoles.includes(role));
    if (!hasRole) return false;
  }

  // Check permissions
  if (item.permissions && item.permissions.length > 0) {
    const userPermissions = user.permissions || [];
    const hasPermission = item.permissions.some(perm => userPermissions.includes(perm));
    if (!hasPermission) return false;
  }

  return true;
}

/**
 * Export menu to portable format
 *
 * @param {string} menuId - Menu ID
 * @returns {Object} Exportable menu structure
 */
export function exportMenu(menuId) {
  const menu = getMenu(menuId);
  if (!menu) {
    throw new Error(`Menu "${menuId}" not found`);
  }

  const items = listMenuItems({ menuId, limit: 10000 });

  return {
    menu,
    items: items.items,
  };
}

/**
 * Import menu from portable format
 *
 * @param {Object} data - Exported menu data
 * @param {Object} options - Import options
 * @returns {Promise<Object>} Imported menu
 */
export async function importMenu(data, options = {}) {
  const { menu: menuData, items: itemsData } = data;

  // Check if menu exists
  let menu = getMenu(menuData.id);

  if (menu && !options.overwrite) {
    throw new Error(`Menu "${menuData.id}" already exists`);
  }

  if (menu) {
    // Update existing
    menu = await updateMenu(menuData.id, menuData);
  } else {
    // Create new
    menu = await createMenu(menuData);
  }

  // Import items
  const idMapping = {}; // Map old IDs to new IDs for parent references

  for (const itemData of itemsData) {
    const oldId = itemData.id;
    delete itemData.id; // Generate new ID

    // Remap parent ID if needed
    if (itemData.parentId && idMapping[itemData.parentId]) {
      itemData.parentId = idMapping[itemData.parentId];
    }

    const item = await createMenuItem({
      ...itemData,
      menuId: menu.id,
    });

    idMapping[oldId] = item.id;
  }

  return menu;
}

/**
 * Calculate depth based on parent
 *
 * @param {string|null} parentId - Parent item ID
 * @returns {number} Depth level (0 = root)
 */
function calculateDepth(parentId) {
  if (!parentId) return 0;

  const parent = getMenuItem(parentId);
  if (!parent) return 0;

  return parent.depth + 1;
}

/**
 * Update depths of all descendants
 *
 * @param {string} parentId - Parent item ID
 */
async function updateDescendantDepths(parentId) {
  const children = listMenuItems({ parentId });

  for (const child of children.items) {
    const newDepth = calculateDepth(parentId);
    await contentService.update('menu-item', child.id, { depth: newDepth });

    // Recursively update grandchildren
    await updateDescendantDepths(child.id);
  }
}

/**
 * Generate menu ID from title
 *
 * @param {string} title - Menu title
 * @returns {string} Menu ID
 */
function generateMenuId(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Generate unique menu item ID
 *
 * @returns {string} Menu item ID
 */
function generateMenuItemId() {
  return `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get configuration
 *
 * @returns {Object} Current configuration
 */
export function getConfig() {
  return { ...config };
}

/**
 * Check if menu system is enabled
 *
 * @returns {boolean}
 */
export function isEnabled() {
  return config.enabled;
}
