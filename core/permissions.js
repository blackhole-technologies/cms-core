/**
 * permissions.js - Granular Permissions System
 *
 * WHY THIS EXISTS:
 * The auth module provides basic role-based permissions (admin/editor/viewer).
 * This module extends that with:
 * - Content-type specific permissions (can edit articles but not pages)
 * - Field-level permissions (can edit title but not publish_date)
 * - Own vs any permissions (can edit own articles but not others)
 * - Permission inheritance (roles inherit from other roles)
 * - Custom permissions (modules can define their own)
 *
 * DESIGN DECISIONS:
 * =================
 *
 * 1. PERMISSION NAMING CONVENTION
 *    Format: module.type.operation[.scope]
 *    Examples:
 *    - content.article.view
 *    - content.article.edit.own
 *    - content.article.edit.any
 *    - admin.access
 *    - media.upload
 *
 * 2. ROLE INHERITANCE
 *    Roles can inherit from other roles.
 *    Example: editor inherits from author inherits from authenticated
 *    This reduces duplication and makes permission management easier.
 *
 * 3. WILDCARD SUPPORT
 *    - "*" grants all permissions (admin)
 *    - "content.*" grants all content permissions
 *    - "content.article.*" grants all article permissions
 *
 * 4. OWN VS ANY
 *    Operations can have .own or .any scope:
 *    - .own: Can only perform on own content
 *    - .any: Can perform on any content
 *    Both can be granted independently.
 *
 * 5. FIELD-LEVEL PERMISSIONS
 *    Control access to specific fields:
 *    - content.article.field.publish_date.view
 *    - content.article.field.publish_date.edit
 *
 * 6. HOOKS INTEGRATION
 *    Emits hooks for:
 *    - permission:check - before checking permission
 *    - permission:denied - when permission denied
 *
 * STORAGE:
 * ========
 * Permissions are stored in config/permissions.json.
 * This file defines:
 * - Available permissions (registry)
 * - Roles and their permissions
 * - Role inheritance
 *
 * @module permissions
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as hooks from './hooks.js';

/**
 * Base directory (set by init)
 */
let baseDir = null;

/**
 * Auth module reference (set by init)
 */
let authModule = null;

/**
 * Permissions configuration
 * Loaded from config/permissions.json
 */
let permissionsConfig = {
  permissions: {},
  roles: {},
};

/**
 * Resolved role permissions cache
 * Map<role, Set<permission>>
 * Includes inherited permissions
 */
const resolvedPermissionsCache = new Map();

/**
 * Initialize permissions system
 *
 * @param {string} dir - Base directory
 * @param {Object} auth - Auth module reference
 *
 * WHY AUTH INTEGRATION:
 * Permissions build on auth's role system.
 * We need to access user roles from auth.
 */
export async function init(dir, auth) {
  baseDir = dir;
  authModule = auth;

  await loadPermissions();
}

/**
 * Load permissions from config file
 */
async function loadPermissions() {
  const configPath = join(baseDir, 'config', 'permissions.json');

  try {
    const data = await readFile(configPath, 'utf-8');
    permissionsConfig = JSON.parse(data);

    // Clear cache on reload
    resolvedPermissionsCache.clear();

    console.log('[permissions] Loaded permissions config');
  } catch (err) {
    if (err.code === 'ENOENT') {
      // Create default config
      permissionsConfig = createDefaultConfig();
      await savePermissions();
      console.log('[permissions] Created default permissions config');
    } else {
      console.error('[permissions] Failed to load config:', err.message);
      throw err;
    }
  }
}

/**
 * Save permissions to config file
 */
async function savePermissions() {
  const configPath = join(baseDir, 'config', 'permissions.json');

  try {
    await writeFile(
      configPath,
      JSON.stringify(permissionsConfig, null, 2),
      'utf-8'
    );

    // Clear cache when saving
    resolvedPermissionsCache.clear();
  } catch (err) {
    console.error('[permissions] Failed to save config:', err.message);
    throw err;
  }
}

/**
 * Create default permissions configuration
 *
 * @returns {Object} - Default config
 */
function createDefaultConfig() {
  return {
    permissions: {
      // Content permissions
      'content.*.view': {
        label: 'View all content types',
        module: 'content',
      },
      'content.*.create': {
        label: 'Create all content types',
        module: 'content',
      },
      'content.*.edit.own': {
        label: 'Edit own content',
        module: 'content',
      },
      'content.*.edit.any': {
        label: 'Edit any content',
        module: 'content',
      },
      'content.*.delete.own': {
        label: 'Delete own content',
        module: 'content',
      },
      'content.*.delete.any': {
        label: 'Delete any content',
        module: 'content',
      },
      'content.*.publish': {
        label: 'Publish content',
        module: 'content',
      },

      // Admin permissions
      'admin.access': {
        label: 'Access admin area',
        module: 'admin',
      },
      'admin.config': {
        label: 'Manage configuration',
        module: 'admin',
      },
      'admin.users': {
        label: 'Manage users',
        module: 'admin',
      },
      'admin.permissions': {
        label: 'Manage permissions',
        module: 'admin',
      },

      // Media permissions
      'media.upload': {
        label: 'Upload media',
        module: 'media',
      },
      'media.delete.own': {
        label: 'Delete own media',
        module: 'media',
      },
      'media.delete.any': {
        label: 'Delete any media',
        module: 'media',
      },
    },

    roles: {
      anonymous: {
        label: 'Anonymous User',
        permissions: ['content.*.view'],
      },

      authenticated: {
        label: 'Authenticated User',
        inherits: ['anonymous'],
        permissions: [],
      },

      author: {
        label: 'Author',
        inherits: ['authenticated'],
        permissions: [
          'admin.access',
          'content.*.create',
          'content.*.edit.own',
          'content.*.delete.own',
          'media.upload',
          'media.delete.own',
        ],
      },

      editor: {
        label: 'Editor',
        inherits: ['author'],
        permissions: [
          'content.*.edit.any',
          'content.*.delete.any',
          'content.*.publish',
          'media.delete.any',
        ],
      },

      admin: {
        label: 'Administrator',
        permissions: ['*'],
      },
    },
  };
}

/**
 * Define a new permission
 *
 * @param {string} name - Permission name (e.g., 'content.article.view')
 * @param {string} label - Human-readable label
 * @param {string} module - Module that owns this permission
 */
export function definePermission(name, label, module = 'custom') {
  if (!name || typeof name !== 'string') {
    throw new TypeError('Permission name must be a non-empty string');
  }

  permissionsConfig.permissions[name] = {
    label: label || name,
    module,
    custom: true,
  };

  resolvedPermissionsCache.clear();
}

/**
 * Get all defined permissions
 *
 * @returns {Object} - Permission definitions
 */
export function getPermissions() {
  return { ...permissionsConfig.permissions };
}

/**
 * Get permissions by module
 *
 * @param {string} module - Module name
 * @returns {Object} - Permissions for that module
 */
export function getPermissionsByModule(module) {
  const result = {};

  for (const [name, def] of Object.entries(permissionsConfig.permissions)) {
    if (def.module === module) {
      result[name] = def;
    }
  }

  return result;
}

/**
 * Assign permission to a role
 *
 * @param {string} role - Role name
 * @param {string} permission - Permission to assign
 */
export async function assignPermission(role, permission) {
  if (!permissionsConfig.roles[role]) {
    throw new Error(`Role not found: ${role}`);
  }

  const roleConfig = permissionsConfig.roles[role];

  if (!roleConfig.permissions) {
    roleConfig.permissions = [];
  }

  if (!roleConfig.permissions.includes(permission)) {
    roleConfig.permissions.push(permission);
    await savePermissions();
  }
}

/**
 * Remove permission from a role
 *
 * @param {string} role - Role name
 * @param {string} permission - Permission to remove
 */
export async function removePermission(role, permission) {
  if (!permissionsConfig.roles[role]) {
    throw new Error(`Role not found: ${role}`);
  }

  const roleConfig = permissionsConfig.roles[role];

  if (roleConfig.permissions) {
    const index = roleConfig.permissions.indexOf(permission);
    if (index !== -1) {
      roleConfig.permissions.splice(index, 1);
      await savePermissions();
    }
  }
}

/**
 * Create a new role
 *
 * @param {string} name - Role name
 * @param {Object} config - Role configuration
 * @param {string} config.label - Human-readable label
 * @param {string[]} [config.inherits] - Roles to inherit from
 * @param {string[]} [config.permissions] - Permissions to assign
 */
export async function createRole(name, config) {
  if (!name || typeof name !== 'string') {
    throw new TypeError('Role name must be a non-empty string');
  }

  if (permissionsConfig.roles[name]) {
    throw new Error(`Role already exists: ${name}`);
  }

  permissionsConfig.roles[name] = {
    label: config.label || name,
    inherits: config.inherits || [],
    permissions: config.permissions || [],
  };

  await savePermissions();
}

/**
 * Get role configuration
 *
 * @param {string} role - Role name
 * @returns {Object|null} - Role config or null
 */
export function getRole(role) {
  return permissionsConfig.roles[role] || null;
}

/**
 * Get all roles
 *
 * @returns {Object} - All role configurations
 */
export function getRoles() {
  return { ...permissionsConfig.roles };
}

/**
 * Resolve all permissions for a role (including inherited)
 *
 * @param {string} role - Role name
 * @param {Set} [visited] - Track visited roles (prevent circular inheritance)
 * @returns {Set<string>} - Set of all permissions
 *
 * INHERITANCE RESOLUTION:
 * 1. Start with role's direct permissions
 * 2. For each inherited role, recursively get their permissions
 * 3. Combine all permissions into a single set
 * 4. Cache the result
 *
 * CIRCULAR INHERITANCE PROTECTION:
 * If role A inherits from B, and B inherits from A, we detect
 * this and skip to prevent infinite recursion.
 */
function resolveRolePermissions(role, visited = new Set()) {
  // Check cache
  if (resolvedPermissionsCache.has(role)) {
    return resolvedPermissionsCache.get(role);
  }

  const roleConfig = permissionsConfig.roles[role];
  if (!roleConfig) {
    return new Set();
  }

  // Detect circular inheritance
  if (visited.has(role)) {
    console.warn(`[permissions] Circular inheritance detected for role: ${role}`);
    return new Set();
  }

  visited.add(role);

  const permissions = new Set();

  // Add direct permissions
  if (roleConfig.permissions) {
    for (const perm of roleConfig.permissions) {
      permissions.add(perm);
    }
  }

  // Add inherited permissions
  if (roleConfig.inherits) {
    for (const inheritedRole of roleConfig.inherits) {
      const inheritedPerms = resolveRolePermissions(inheritedRole, new Set(visited));
      for (const perm of inheritedPerms) {
        permissions.add(perm);
      }
    }
  }

  // Cache and return
  resolvedPermissionsCache.set(role, permissions);
  return permissions;
}

/**
 * Get all permissions for a role (including inherited)
 *
 * @param {string} role - Role name
 * @returns {string[]} - Array of permissions
 */
export function getRolePermissions(role) {
  const permissions = resolveRolePermissions(role);
  return Array.from(permissions);
}

/**
 * Check if a permission matches a pattern
 *
 * @param {string} permission - Actual permission
 * @param {string} pattern - Permission pattern (may include wildcards)
 * @returns {boolean} - True if matches
 *
 * WILDCARD MATCHING:
 * - "*" matches everything
 * - "content.*" matches "content.article.view", "content.page.edit", etc.
 * - "content.article.*" matches "content.article.view", "content.article.edit", etc.
 *
 * EXAMPLES:
 * - matchPermission('content.article.view', '*') → true
 * - matchPermission('content.article.view', 'content.*') → true
 * - matchPermission('content.article.view', 'content.article.*') → true
 * - matchPermission('content.article.view', 'content.article.view') → true
 * - matchPermission('content.article.view', 'content.page.*') → false
 */
function matchPermission(permission, pattern) {
  // Exact match
  if (permission === pattern) {
    return true;
  }

  // Wildcard match
  if (pattern === '*') {
    return true;
  }

  // Prefix wildcard (e.g., "content.*")
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2); // Remove ".*"
    return permission.startsWith(prefix + '.');
  }

  return false;
}

/**
 * Check if user has a specific permission
 *
 * @param {Object} user - User object with role property
 * @param {string} permission - Permission to check
 * @returns {boolean} - True if user has permission
 *
 * PROCESS:
 * 1. Emit permission:check hook (allow override)
 * 2. Get user's role
 * 3. Resolve role's permissions (including inherited)
 * 4. Check if any permission matches (including wildcards)
 * 5. If denied, emit permission:denied hook
 *
 * @example
 * hasPermission({ role: 'editor' }, 'content.article.edit.any') // true
 * hasPermission({ role: 'author' }, 'content.article.edit.any') // false
 * hasPermission({ role: 'admin' }, 'anything.here') // true (wildcard)
 */
export async function hasPermission(user, permission) {
  // Hook: allow override
  const hookResult = await hooks.emit('permission:check', {
    user,
    permission,
  });

  // If hook explicitly grants/denies, use that
  if (hookResult.some(r => r?.granted === true)) {
    return true;
  }
  if (hookResult.some(r => r?.granted === false)) {
    await hooks.emit('permission:denied', { user, permission, reason: 'hook' });
    return false;
  }

  // No user or role
  if (!user || !user.role) {
    await hooks.emit('permission:denied', { user, permission, reason: 'no_role' });
    return false;
  }

  // Get role permissions
  const rolePermissions = resolveRolePermissions(user.role);

  // Check if any permission matches
  for (const userPerm of rolePermissions) {
    if (matchPermission(permission, userPerm)) {
      return true;
    }
  }

  // Permission denied
  await hooks.emit('permission:denied', { user, permission, reason: 'not_granted' });
  return false;
}

/**
 * Check if user has any of the given permissions
 *
 * @param {Object} user - User object
 * @param {string[]} permissions - Permissions to check
 * @returns {boolean} - True if user has at least one permission
 */
export async function hasAnyPermission(user, permissions) {
  for (const permission of permissions) {
    if (await hasPermission(user, permission)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if user has all of the given permissions
 *
 * @param {Object} user - User object
 * @param {string[]} permissions - Permissions to check
 * @returns {boolean} - True if user has all permissions
 */
export async function hasAllPermissions(user, permissions) {
  for (const permission of permissions) {
    if (!await hasPermission(user, permission)) {
      return false;
    }
  }
  return true;
}

/**
 * Check content access (handles own vs any)
 *
 * @param {Object} user - User object
 * @param {string} type - Content type (e.g., 'article')
 * @param {string} operation - Operation (e.g., 'edit', 'delete')
 * @param {Object} [content] - Content object (for ownership check)
 * @returns {boolean} - True if user has access
 *
 * OWNERSHIP CHECK:
 * If content.author_id matches user.id, check .own permission.
 * Otherwise, check .any permission.
 *
 * If no content provided (creating new), only check general permission.
 *
 * @example
 * // User can edit their own articles
 * checkContentAccess(user, 'article', 'edit', { author_id: user.id }) // true
 *
 * // User cannot edit others' articles (only has .own)
 * checkContentAccess(user, 'article', 'edit', { author_id: otherId }) // false
 *
 * // Editor can edit any articles
 * checkContentAccess(editor, 'article', 'edit', { author_id: otherId }) // true
 */
export async function checkContentAccess(user, type, operation, content = null) {
  // Check if operation supports own/any
  const hasOwnership = ['edit', 'delete', 'publish'].includes(operation);

  if (!hasOwnership || !content) {
    // No ownership check needed
    const permission = `content.${type}.${operation}`;
    return await hasPermission(user, permission);
  }

  // Check ownership
  const isOwner = content.author_id === user.id;

  if (isOwner) {
    // Check .own permission
    const ownPermission = `content.${type}.${operation}.own`;
    if (await hasPermission(user, ownPermission)) {
      return true;
    }
  }

  // Check .any permission
  const anyPermission = `content.${type}.${operation}.any`;
  return await hasPermission(user, anyPermission);
}

/**
 * Get permission matrix for admin UI
 *
 * @returns {Object} - Permission matrix data
 *
 * FORMAT:
 * {
 *   roles: ['admin', 'editor', 'author', 'authenticated', 'anonymous'],
 *   permissions: [
 *     { name: 'content.article.view', label: 'View articles', module: 'content' }
 *   ],
 *   matrix: {
 *     'admin': { 'content.article.view': true, ... },
 *     'editor': { 'content.article.view': true, ... }
 *   }
 * }
 */
export function getPermissionMatrix() {
  const roles = Object.keys(permissionsConfig.roles);
  const permissions = Object.entries(permissionsConfig.permissions).map(([name, def]) => ({
    name,
    label: def.label,
    module: def.module,
  }));

  const matrix = {};

  for (const role of roles) {
    matrix[role] = {};
    const rolePerms = resolveRolePermissions(role);

    for (const { name } of permissions) {
      // Check if role has this permission (including wildcards)
      let hasAccess = false;
      for (const rolePerm of rolePerms) {
        if (matchPermission(name, rolePerm)) {
          hasAccess = true;
          break;
        }
      }
      matrix[role][name] = hasAccess;
    }
  }

  return {
    roles,
    permissions,
    matrix,
  };
}

/**
 * Check if permissions system is initialized
 */
export function isInitialized() {
  return baseDir !== null;
}
