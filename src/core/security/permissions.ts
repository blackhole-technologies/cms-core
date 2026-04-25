/**
 * permissions.ts - Granular Permissions System
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
import * as hooks from '../../../core/hooks.ts';

// ============= Types =============

/** A single permission definition */
interface PermissionDef {
  label: string;
  module: string;
  custom?: boolean;
}

/** A role configuration */
interface RoleConfig {
  label: string;
  inherits?: string[];
  permissions?: string[];
}

/** The full permissions configuration stored on disk */
interface PermissionsConfig {
  permissions: Record<string, PermissionDef>;
  roles: Record<string, RoleConfig>;
}

/** A user object with at least a role and id */
interface UserRecord {
  role?: string;
  id?: string | number;
  [key: string]: unknown;
}

/** A content item with optional author_id */
interface ContentRecord {
  author_id?: string | number;
  [key: string]: unknown;
}

// ============================================================================
// State
// ============================================================================
/**
 * Base directory (set by init)
 */
let baseDir: string | null = null;
/**
 * Auth module reference (set by init)
 */
let authModule: unknown = null;
/**
 * Permissions configuration
 * Loaded from config/permissions.json
 */
let permissionsConfig: PermissionsConfig = {
  permissions: {},
  roles: {},
};
/**
 * Resolved role permissions cache
 * Map<role, Set<permission>>
 * Includes inherited permissions
 */
const resolvedPermissionsCache = new Map<string, Set<string>>();
// ============================================================================
// Initialization
// ============================================================================
/**
 * Initialize permissions system
 *
 * WHY AUTH INTEGRATION:
 * Permissions build on auth's role system.
 * We need to access user roles from auth.
 */
export async function init(dir: string, auth: unknown): Promise<void> {
  baseDir = dir;
  authModule = auth;
  await loadPermissions();
}
// ============================================================================
// Persistence (Private)
// ============================================================================
/**
 * Load permissions from config file
 */
async function loadPermissions(): Promise<void> {
  const configPath = join(baseDir!, 'config', 'permissions.json');
  try {
    const data = await readFile(configPath, 'utf-8');
    permissionsConfig = JSON.parse(data) as PermissionsConfig;
    // Clear cache on reload
    resolvedPermissionsCache.clear();
    console.log('[permissions] Loaded permissions config');
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') {
      // Create default config
      permissionsConfig = createDefaultConfig();
      await savePermissions();
      console.log('[permissions] Created default permissions config');
    } else {
      console.error('[permissions] Failed to load config:', nodeErr.message);
      throw err;
    }
  }
}
/**
 * Save permissions to config file
 */
async function savePermissions(): Promise<void> {
  const configPath = join(baseDir!, 'config', 'permissions.json');
  try {
    await writeFile(configPath, JSON.stringify(permissionsConfig, null, 2), 'utf-8');
    // Clear cache when saving
    resolvedPermissionsCache.clear();
  } catch (err) {
    console.error('[permissions] Failed to save config:', (err as Error).message);
    throw err;
  }
}
/**
 * Create default permissions configuration
 */
function createDefaultConfig(): PermissionsConfig {
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
// ============================================================================
// Permission Registry
// ============================================================================
/**
 * Define a new permission
 */
export function definePermission(name: string, label: string, module = 'custom'): void {
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
 */
export function getPermissions(): Record<string, PermissionDef> {
  return { ...permissionsConfig.permissions };
}
/**
 * Get permissions by module
 */
export function getPermissionsByModule(module: string): Record<string, PermissionDef> {
  const result: Record<string, PermissionDef> = {};
  for (const [name, def] of Object.entries(permissionsConfig.permissions)) {
    if (def.module === module) {
      result[name] = def;
    }
  }
  return result;
}
// ============================================================================
// Role Management
// ============================================================================
/**
 * Assign permission to a role
 */
export async function assignPermission(role: string, permission: string): Promise<void> {
  if (!permissionsConfig.roles[role]) {
    throw new Error(`Role not found: ${role}`);
  }
  const roleConfig = permissionsConfig.roles[role]!;
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
 */
export async function removePermission(role: string, permission: string): Promise<void> {
  if (!permissionsConfig.roles[role]) {
    throw new Error(`Role not found: ${role}`);
  }
  const roleConfig = permissionsConfig.roles[role]!;
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
 */
export async function createRole(
  name: string,
  config: { label?: string; inherits?: string[]; permissions?: string[] }
): Promise<void> {
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
 */
export function getRole(role: string): RoleConfig | null {
  return permissionsConfig.roles[role] ?? null;
}
/**
 * Get all roles
 */
export function getRoles(): Record<string, RoleConfig> {
  return { ...permissionsConfig.roles };
}
// ============================================================================
// Permission Resolution (Private)
// ============================================================================
/**
 * Resolve all permissions for a role (including inherited)
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
function resolveRolePermissions(role: string, visited = new Set<string>()): Set<string> {
  // Check cache
  if (resolvedPermissionsCache.has(role)) {
    return resolvedPermissionsCache.get(role)!;
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
  const permissions = new Set<string>();
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
 */
export function getRolePermissions(role: string): string[] {
  const permissions = resolveRolePermissions(role);
  return Array.from(permissions);
}
/**
 * Check if a permission matches a pattern
 *
 * WILDCARD MATCHING:
 * - "*" matches everything
 * - "content.*" matches "content.article.view", "content.page.edit", etc.
 * - "content.article.*" matches "content.article.view", "content.article.edit", etc.
 */
function matchPermission(permission: string, pattern: string): boolean {
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
// ============================================================================
// Permission Checking
// ============================================================================
/**
 * Check if user has a specific permission
 *
 * PROCESS:
 * 1. Emit permission:check hook (allow override)
 * 2. Get user's role
 * 3. Resolve role's permissions (including inherited)
 * 4. Check if any permission matches (including wildcards)
 * 5. If denied, emit permission:denied hook
 */
export async function hasPermission(
  user: UserRecord | null | undefined,
  permission: string
): Promise<boolean> {
  // Hook: allow override
  // The trigger returns the context — handlers can set `granted` on it
  const hookResult = await hooks.trigger('permission:check', {
    user,
    permission,
    granted: undefined,
  });
  // If hook explicitly grants/denies, use that
  if (hookResult.granted === true) {
    return true;
  }
  if (hookResult.granted === false) {
    await hooks.trigger('permission:denied', { user, permission, reason: 'hook' });
    return false;
  }
  // No user or role
  if (!user || !user.role) {
    await hooks.trigger('permission:denied', { user, permission, reason: 'no_role' });
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
  await hooks.trigger('permission:denied', { user, permission, reason: 'not_granted' });
  return false;
}
/**
 * Check if user has any of the given permissions
 */
export async function hasAnyPermission(
  user: UserRecord | null | undefined,
  permissions: string[]
): Promise<boolean> {
  for (const permission of permissions) {
    if (await hasPermission(user, permission)) {
      return true;
    }
  }
  return false;
}
/**
 * Check if user has all of the given permissions
 */
export async function hasAllPermissions(
  user: UserRecord | null | undefined,
  permissions: string[]
): Promise<boolean> {
  for (const permission of permissions) {
    if (!(await hasPermission(user, permission))) {
      return false;
    }
  }
  return true;
}
/**
 * Check content access (handles own vs any)
 *
 * OWNERSHIP CHECK:
 * If content.author_id matches user.id, check .own permission.
 * Otherwise, check .any permission.
 *
 * If no content provided (creating new), only check general permission.
 */
export async function checkContentAccess(
  user: UserRecord | null | undefined,
  type: string,
  operation: string,
  content: ContentRecord | null = null
): Promise<boolean> {
  // Check if operation supports own/any
  const hasOwnership = ['edit', 'delete', 'publish'].includes(operation);
  if (!hasOwnership || !content) {
    // No ownership check needed
    const permission = `content.${type}.${operation}`;
    return await hasPermission(user, permission);
  }
  // Check ownership
  const isOwner = content.author_id === user?.id;
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
// ============================================================================
// Admin UI Support
// ============================================================================
/**
 * Get permission matrix for admin UI
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
  const matrix: Record<string, Record<string, boolean>> = {};
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
export function isInitialized(): boolean {
  return baseDir !== null;
}
