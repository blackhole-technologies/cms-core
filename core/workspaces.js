/**
 * workspaces.js - Workspace Staging Environment System
 *
 * WHY THIS EXISTS:
 * Based on Drupal's workspaces module. Provides isolated staging environments
 * for content changes. Changes in a workspace don't affect the live site until
 * the workspace is explicitly published.
 *
 * CORE CONCEPT:
 * - Workspace = isolated staging environment with id, label, status
 * - Changes in workspace don't affect live content
 * - Publishing a workspace copies all changes to live
 * - Role-based permissions control who can create/edit/publish workspaces
 *
 * STORAGE:
 * config/workspaces/ directory contains one JSON file per workspace:
 *   config/workspaces/{id}.json
 *
 * WORKSPACE ENTITY STRUCTURE:
 * {
 *   id: string (UUID),
 *   label: string (human-readable name),
 *   machineName: string (URL-safe slug),
 *   status: 'active' | 'archived',
 *   owner: string (user ID who created it),
 *   created: string (ISO timestamp),
 *   updated: string (ISO timestamp),
 *   parent: string | null (parent workspace ID for nesting),
 *   description: string (optional),
 * }
 *
 * PERMISSIONS:
 * - workspace.create - Create new workspaces
 * - workspace.edit - Edit workspace metadata
 * - workspace.delete - Delete workspaces
 * - workspace.publish - Publish workspace to live
 * - workspace.view - View workspace contents
 * - workspace.switch - Switch active workspace
 *
 * @module workspaces
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// ============================================================================
// Module State
// ============================================================================

/** Base directory for CMS */
let baseDir = null;

/** Directory where workspace entities are stored */
let workspacesDir = null;

/** In-memory cache of workspace entities (Map<id, workspace>) */
const workspaceCache = new Map();

/** Reference to hooks system for event emission */
let hooksModule = null;

/** Reference to permissions system for access control */
let permissionsModule = null;

/** Reference to audit system for logging actions */
let auditModule = null;

/** Reference to content system for association cleanup */
let contentModule = null;

/**
 * Workspace content associations directory.
 * Stores JSON files tracking which content items belong to which workspace.
 * File: config/workspace-associations/{workspaceId}.json
 * Format: { items: [{ type, id, operation, timestamp }] }
 *
 * WHY SEPARATE DIR:
 * Content associations are per-workspace. Storing them alongside workspace
 * entities keeps related data together. When a workspace is deleted, we
 * simply remove the associations file.
 */
let associationsDir = null;

/** Activity log directory for per-workspace action tracking */
let activityDir = null;

/**
 * Active workspace session state.
 *
 * WHY TWO TRACKING MECHANISMS:
 * 1. CLI: Stores active workspace in config/workspace-active.json for persistence
 *    across CLI invocations (each `node index.js` is a new process)
 * 2. HTTP: Stores active workspace per session using X-Workspace header or
 *    session cookie extension. In-memory Map<sessionId, workspaceId>.
 *
 * Drupal uses a session-based approach where the active workspace is stored
 * in $_SESSION['workspace']. We adapt this for both CLI and HTTP contexts.
 */

/** File path for CLI active workspace persistence */
let activeWorkspaceFile = null;

/** In-memory active workspace per HTTP session: Map<sessionId, workspaceId> */
const sessionWorkspaces = new Map();

/** Module name for service registration */
export const name = 'workspaces';

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the workspaces system.
 *
 * WHY SEPARATE INIT:
 * Boot sequence requires explicit initialization order.
 * Workspaces must init after content, permissions, and hooks are ready.
 *
 * @param {Object} options - Init configuration
 * @param {string} options.baseDir - CMS root directory
 * @param {Object} [options.hooks] - Hooks module reference
 * @param {Object} [options.permissions] - Permissions module reference
 * @param {Object} [options.audit] - Audit module reference
 */
export function init(options) {
  baseDir = options.baseDir;
  hooksModule = options.hooks || null;
  permissionsModule = options.permissions || null;
  auditModule = options.audit || null;

  contentModule = options.content || null;

  // Ensure workspace storage directory exists
  workspacesDir = join(baseDir, 'config', 'workspaces');
  if (!existsSync(workspacesDir)) {
    mkdirSync(workspacesDir, { recursive: true });
  }

  // Ensure associations directory exists
  associationsDir = join(baseDir, 'config', 'workspace-associations');
  if (!existsSync(associationsDir)) {
    mkdirSync(associationsDir, { recursive: true });
  }

  // Ensure activity log directory exists
  activityDir = join(baseDir, 'config', 'workspace-activity');
  if (!existsSync(activityDir)) {
    mkdirSync(activityDir, { recursive: true });
  }

  // Active workspace file for CLI persistence
  activeWorkspaceFile = join(baseDir, 'config', 'workspace-active.json');

  // Load all existing workspaces into cache
  loadAllWorkspaces();

  // Register workspace permissions if permissions module available
  if (permissionsModule && typeof permissionsModule.definePermission === 'function') {
    registerWorkspacePermissions();
  }

  console.log(`[workspaces] Initialized with ${workspaceCache.size} workspace(s)`);
}

/**
 * Load all workspace files from disk into cache.
 *
 * WHY CACHE:
 * Workspaces are referenced frequently (every content query checks active workspace).
 * Loading once at boot avoids repeated file reads. Cache invalidated on write.
 */
function loadAllWorkspaces() {
  workspaceCache.clear();

  if (!existsSync(workspacesDir)) return;

  const files = readdirSync(workspacesDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    try {
      const data = readFileSync(join(workspacesDir, file), 'utf-8');
      const workspace = JSON.parse(data);
      workspaceCache.set(workspace.id, workspace);
    } catch (err) {
      console.error(`[workspaces] Failed to load ${file}:`, err.message);
    }
  }
}

// ============================================================================
// Permission Registration
// ============================================================================

/**
 * Register workspace-specific permissions in the permissions system.
 *
 * WHY HERE:
 * Follows Drupal's pattern where each module declares its own permissions.
 * This keeps permission definitions co-located with the code that checks them.
 */
function registerWorkspacePermissions() {
  const perms = {
    'workspace.create': 'Create new workspaces',
    'workspace.edit': 'Edit workspace metadata',
    'workspace.delete': 'Delete workspaces',
    'workspace.publish': 'Publish workspace to live',
    'workspace.view': 'View workspace contents',
    'workspace.switch': 'Switch active workspace',
  };

  for (const [perm, label] of Object.entries(perms)) {
    try {
      permissionsModule.definePermission(perm, label, 'workspaces');
    } catch (err) {
      // Permission may already be defined - that's ok
      console.warn(`[workspaces] Permission ${perm} already defined`);
    }
  }
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Create a new workspace entity.
 *
 * WHY UUID FOR ID:
 * UUIDs are globally unique, collision-free, and don't leak creation order.
 * Machine name provides human-readable reference (like Drupal's machine names).
 *
 * @param {Object} data - Workspace data
 * @param {string} data.label - Human-readable name (e.g., "Staging Environment")
 * @param {string} [data.machineName] - URL-safe slug (auto-generated from label if omitted)
 * @param {string} [data.status='active'] - Status: 'active' or 'archived'
 * @param {string} [data.owner] - User ID of creator
 * @param {string} [data.description] - Optional description
 * @param {string} [data.parent] - Parent workspace ID for nesting
 * @param {Object} [user] - User performing the action (for permission check)
 * @returns {Object} Created workspace entity
 * @throws {Error} If label missing or permission denied
 */
export async function create(data, user = null) {
  // Permission check
  if (user && permissionsModule) {
    const allowed = await checkPermission(user, 'create');
    if (!allowed) {
      const err = new Error('Permission denied: workspace.create');
      err.code = 'PERMISSION_DENIED';
      err.status = 403;
      throw err;
    }
  }

  if (!data.label || typeof data.label !== 'string' || !data.label.trim()) {
    throw new Error('Workspace label is required');
  }

  const now = new Date().toISOString();
  const id = randomUUID();

  // Generate machine name from label if not provided
  const machineName = data.machineName || generateMachineName(data.label);

  // Check for duplicate machine name
  for (const ws of workspaceCache.values()) {
    if (ws.machineName === machineName) {
      throw new Error(`Workspace with machine name "${machineName}" already exists`);
    }
  }

  const workspace = {
    id,
    label: data.label.trim(),
    machineName,
    status: data.status === 'archived' ? 'archived' : 'active',
    owner: data.owner || (user ? user.id : null),
    created: now,
    updated: now,
    parent: data.parent || null,
    description: data.description || '',
    assignees: data.assignees || [],
    expiresAt: data.expiresAt || null,
  };

  // Persist to disk
  saveWorkspace(workspace);

  // Update cache
  workspaceCache.set(id, workspace);

  // Emit hook
  if (hooksModule) {
    try {
      await hooksModule.emit('workspace:created', workspace);
    } catch (e) {
      // Non-blocking hook failure
    }
  }

  // Audit log
  if (auditModule && typeof auditModule.log === 'function') {
    auditModule.log('workspace.create', {
      workspaceId: id,
      label: workspace.label,
      userId: user?.id,
    });
  }

  // Activity log: workspace creation is logged as the first entry
  logActivity(workspace.id, 'workspace.create', {
    label: workspace.label,
    machineName: workspace.machineName,
  }, user);

  return workspace;
}

/**
 * Get a workspace by ID.
 *
 * @param {string} id - Workspace UUID
 * @returns {Object|null} Workspace entity or null if not found
 */
export function get(id) {
  return workspaceCache.get(id) || null;
}

/**
 * Get a workspace by machine name.
 *
 * @param {string} machineName - URL-safe machine name
 * @returns {Object|null} Workspace entity or null if not found
 */
export function getByMachineName(machineName) {
  for (const ws of workspaceCache.values()) {
    if (ws.machineName === machineName) {
      return ws;
    }
  }
  return null;
}

/**
 * List all workspaces, optionally filtered by status.
 *
 * @param {Object} [options] - Filter options
 * @param {string} [options.status] - Filter by status ('active' or 'archived')
 * @returns {Object[]} Array of workspace entities
 */
export function list(options = {}) {
  let workspaces = Array.from(workspaceCache.values());

  if (options.status) {
    workspaces = workspaces.filter(ws => ws.status === options.status);
  }

  // Sort by creation date (newest first)
  workspaces.sort((a, b) => new Date(b.created) - new Date(a.created));

  return workspaces;
}

/**
 * Update a workspace entity.
 *
 * @param {string} id - Workspace UUID
 * @param {Object} updates - Fields to update
 * @param {Object} [user] - User performing the action
 * @returns {Object} Updated workspace entity
 * @throws {Error} If workspace not found or permission denied
 */
export async function update(id, updates, user = null) {
  // Permission check
  if (user && permissionsModule) {
    const allowed = await checkPermission(user, 'edit');
    if (!allowed) {
      const err = new Error('Permission denied: workspace.edit');
      err.code = 'PERMISSION_DENIED';
      err.status = 403;
      throw err;
    }
  }

  const workspace = workspaceCache.get(id);
  if (!workspace) {
    throw new Error(`Workspace not found: ${id}`);
  }

  // Only allow updating specific fields
  const allowedFields = ['label', 'status', 'description', 'parent', 'expiresAt'];
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      workspace[field] = updates[field];
    }
  }

  // Validate status
  if (workspace.status !== 'active' && workspace.status !== 'archived') {
    workspace.status = 'active';
  }

  workspace.updated = new Date().toISOString();

  // Persist
  saveWorkspace(workspace);
  workspaceCache.set(id, workspace);

  // Emit hook
  if (hooksModule) {
    try {
      await hooksModule.emit('workspace:updated', workspace);
    } catch (e) {
      // Non-blocking
    }
  }

  // Activity log
  logActivity(id, 'workspace.update', {
    fields: Object.keys(updates).filter(k => allowedFields.includes(k)),
  }, user);

  return workspace;
}

/**
 * Delete a workspace.
 *
 * @param {string} id - Workspace UUID
 * @param {Object} [user] - User performing the action
 * @returns {boolean} True if deleted
 * @throws {Error} If workspace not found or permission denied
 */
export async function remove(id, user = null) {
  // Permission check
  if (user && permissionsModule) {
    const allowed = await checkPermission(user, 'delete');
    if (!allowed) {
      const err = new Error('Permission denied: workspace.delete');
      err.code = 'PERMISSION_DENIED';
      err.status = 403;
      throw err;
    }
  }

  const workspace = workspaceCache.get(id);
  if (!workspace) {
    throw new Error(`Workspace not found: ${id}`);
  }

  // If this is the active workspace, clear it
  const active = getActiveWorkspace();
  if (active && active.id === id) {
    setActiveWorkspace(null);
  }

  // Clean up associated content mappings BEFORE deleting workspace
  // WHY BEFORE: Once workspace entity is gone, we'd lose the ID reference
  const removedCount = removeAssociations(id);

  // Remove workspace entity from disk
  const filePath = join(workspacesDir, `${id}.json`);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }

  // Remove from cache
  workspaceCache.delete(id);

  // Emit hook
  if (hooksModule) {
    try {
      await hooksModule.emit('workspace:deleted', { id, label: workspace.label, removedAssociations: removedCount });
    } catch (e) {
      // Non-blocking
    }
  }

  // Audit log
  if (auditModule && typeof auditModule.log === 'function') {
    auditModule.log('workspace.delete', {
      workspaceId: id,
      label: workspace.label,
      userId: user?.id,
      removedAssociations: removedCount,
    });
  }

  // Activity log — log before removing workspace
  // Note: we log BEFORE returning, even though workspace entity is deleted.
  // The activity file itself is cleaned up below.
  logActivity(id, 'workspace.delete', {
    label: workspace.label,
    removedAssociations: removedCount,
  }, user);

  // Clean up activity log file
  const activityPath = join(activityDir, `${id}.json`);
  if (existsSync(activityPath)) {
    unlinkSync(activityPath);
  }

  return { deleted: true, removedAssociations: removedCount };
}

// ============================================================================
// Active Workspace Session Management
// ============================================================================

/**
 * Set the active workspace for CLI context.
 *
 * WHY PERSISTENT FILE:
 * Each CLI invocation (node index.js ...) is a separate process.
 * To maintain workspace context across commands, we store the active
 * workspace ID in a persistent JSON file. This mirrors Drupal's session-based
 * approach but adapted for stateless CLI usage.
 *
 * @param {string} workspaceId - Workspace UUID to set as active (or null to clear)
 * @returns {Object|null} The workspace that was set active, or null if cleared
 * @throws {Error} If workspace not found
 */
export function setActiveWorkspace(workspaceId) {
  if (!activeWorkspaceFile) {
    throw new Error('Workspaces not initialized');
  }

  if (!workspaceId || workspaceId === 'live' || workspaceId === 'none') {
    // Clear active workspace (return to live)
    if (existsSync(activeWorkspaceFile)) {
      unlinkSync(activeWorkspaceFile);
    }
    return null;
  }

  // Resolve by ID or machine name
  const workspace = resolveWorkspace(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  // Persist active workspace
  const data = {
    workspaceId: workspace.id,
    machineName: workspace.machineName,
    label: workspace.label,
    setAt: new Date().toISOString(),
  };
  writeFileSync(activeWorkspaceFile, JSON.stringify(data, null, 2), 'utf-8');

  return workspace;
}

/**
 * Get the currently active workspace for CLI context.
 *
 * @returns {Object|null} Active workspace entity, or null if on live
 */
export function getActiveWorkspace() {
  if (!activeWorkspaceFile || !existsSync(activeWorkspaceFile)) {
    return null;
  }

  try {
    const data = JSON.parse(readFileSync(activeWorkspaceFile, 'utf-8'));
    if (!data.workspaceId) return null;

    // Verify workspace still exists
    const workspace = workspaceCache.get(data.workspaceId);
    if (!workspace) {
      // Workspace was deleted, clean up stale reference
      unlinkSync(activeWorkspaceFile);
      return null;
    }
    return workspace;
  } catch {
    return null;
  }
}

/**
 * Set active workspace for an HTTP session.
 *
 * WHY SESSION MAP:
 * HTTP requests are stateless. Each user has their own session, and each
 * session can be in a different workspace. The X-Workspace header provides
 * per-request workspace context.
 *
 * @param {string} sessionId - Session identifier
 * @param {string} workspaceId - Workspace UUID (or null to clear)
 */
export function setSessionWorkspace(sessionId, workspaceId) {
  if (!workspaceId) {
    sessionWorkspaces.delete(sessionId);
  } else {
    sessionWorkspaces.set(sessionId, workspaceId);
  }
}

/**
 * Get the active workspace for an HTTP session.
 *
 * @param {string} sessionId - Session identifier
 * @returns {Object|null} Active workspace entity, or null if on live
 */
export function getSessionWorkspace(sessionId) {
  const wsId = sessionWorkspaces.get(sessionId);
  if (!wsId) return null;
  return workspaceCache.get(wsId) || null;
}

/**
 * Get the active workspace context for a request or CLI.
 *
 * WHY UNIFIED:
 * Other modules need to check the active workspace without caring
 * whether we're in CLI or HTTP mode. This provides a single entry point.
 *
 * @param {Object} [req] - HTTP request (for session-based lookup)
 * @returns {Object|null} Active workspace entity, or null if on live
 */
export function getWorkspaceContext(req = null) {
  // HTTP: Check X-Workspace header first
  if (req) {
    const headerWs = req.headers?.['x-workspace'];
    if (headerWs) {
      return resolveWorkspace(headerWs);
    }
    // Check session
    if (req.sessionId) {
      return getSessionWorkspace(req.sessionId);
    }
  }

  // CLI: Check persistent active workspace
  return getActiveWorkspace();
}

// ============================================================================
// Content Associations
// ============================================================================

/**
 * Associate content with a workspace.
 *
 * WHY TRACK ASSOCIATIONS:
 * Drupal's workspaces module tracks which content items have been modified
 * in a workspace. This is essential for:
 * 1. Publishing workspace (know what to copy to live)
 * 2. Deleting workspace (know what associations to clean up)
 * 3. Conflict detection (know what changed)
 *
 * @param {string} workspaceId - Workspace UUID
 * @param {string} contentType - Content type name
 * @param {string} contentId - Content item ID
 * @param {string} [operation='edit'] - What was done: 'create', 'edit', 'delete'
 * @param {Object} [options={}] - Additional options
 * @param {string} [options.revisionId] - Revision ID (timestamp) for this association
 * @returns {Object} The association entry
 */
export function associateContent(workspaceId, contentType, contentId, operation = 'edit', options = {}) {
  if (!associationsDir) {
    throw new Error('Workspaces not initialized');
  }

  const workspace = workspaceCache.get(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  // Enforce expiration — expired workspaces are read-only
  enforceNotExpired(workspaceId);

  const associations = getAssociations(workspaceId);
  const existing = associations.items.findIndex(
    a => a.type === contentType && a.id === contentId
  );

  // WHY REVISION ID IN ASSOCIATION:
  // Tracks which specific revision of the content is in this workspace.
  // Essential for conflict detection and workspace publishing — need to know
  // which version was the starting point for workspace edits.
  const revisionId = options.revisionId || new Date().toISOString();

  const entry = {
    type: contentType,
    id: contentId,
    operation,
    revisionId,
    timestamp: new Date().toISOString(),
  };

  if (existing !== -1) {
    // Update existing association
    associations.items[existing] = entry;
  } else {
    associations.items.push(entry);
  }

  saveAssociations(workspaceId, associations);

  // Activity log
  logActivity(workspaceId, `content.${operation}`, {
    contentType,
    contentId,
  }, null);

  return entry;
}

/**
 * Get all content associations for a workspace.
 *
 * @param {string} workspaceId - Workspace UUID
 * @returns {Object} Associations object with items array
 */
export function getAssociations(workspaceId) {
  if (!associationsDir) return { items: [] };

  const filePath = join(associationsDir, `${workspaceId}.json`);
  if (existsSync(filePath)) {
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch {
      return { items: [] };
    }
  }
  return { items: [] };
}

/**
 * Remove all content associations for a workspace.
 *
 * WHY ON DELETE:
 * When a workspace is deleted, its associated content mappings must be
 * cleaned up. Orphaned associations would cause confusion and errors
 * when querying content.
 *
 * @param {string} workspaceId - Workspace UUID
 * @returns {number} Number of associations removed
 */
export function removeAssociations(workspaceId) {
  if (!associationsDir) return 0;

  const filePath = join(associationsDir, `${workspaceId}.json`);
  if (existsSync(filePath)) {
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf-8'));
      const count = data.items ? data.items.length : 0;
      unlinkSync(filePath);
      return count;
    } catch {
      try { unlinkSync(filePath); } catch { /* noop */ }
      return 0;
    }
  }
  return 0;
}

/**
 * Save associations to disk.
 *
 * @param {string} workspaceId - Workspace UUID
 * @param {Object} associations - Associations object
 */
function saveAssociations(workspaceId, associations) {
  const filePath = join(associationsDir, `${workspaceId}.json`);
  writeFileSync(filePath, JSON.stringify(associations, null, 2), 'utf-8');
}

/**
 * Remove a specific content association from a workspace.
 *
 * @param {string} workspaceId - Workspace UUID
 * @param {string} contentType - Content type name
 * @param {string} contentId - Content item ID
 * @returns {boolean} True if removed
 */
export function removeContentAssociation(workspaceId, contentType, contentId) {
  const associations = getAssociations(workspaceId);
  const before = associations.items.length;
  associations.items = associations.items.filter(
    a => !(a.type === contentType && a.id === contentId)
  );
  if (associations.items.length < before) {
    saveAssociations(workspaceId, associations);

    // Activity log
    logActivity(workspaceId, 'content.remove_association', {
      contentType,
      contentId,
    }, null);

    return true;
  }
  return false;
}

// ============================================================================
// Permission Checking
// ============================================================================

/**
 * Check if a user has a specific workspace permission.
 *
 * WHY SEPARATE CHECK:
 * Workspace operations need permission checks beyond standard content permissions.
 * This provides a clean API for other modules to verify workspace access.
 *
 * WHY TRY/CATCH ON hasPermission:
 * The permissions module's hasPermission calls hooks.emit which may not exist
 * in the hooks module (it uses hooks.trigger). We fall back to direct role
 * permission resolution when the hook-based path fails.
 *
 * @param {Object} user - User object with role
 * @param {string} operation - Operation: 'create', 'edit', 'delete', 'publish', 'view', 'switch'
 * @returns {boolean} True if user has permission
 */
export async function checkPermission(user, operation) {
  if (!permissionsModule) {
    // No permissions module = allow all (development mode)
    return true;
  }

  if (!user || !user.role) {
    return false;
  }

  const permission = `workspace.${operation}`;

  try {
    return await permissionsModule.hasPermission(user, permission);
  } catch (err) {
    // Fallback: check role permissions directly if hasPermission fails
    // (e.g., hooks.emit not a function)
    try {
      const rolePerms = permissionsModule.getRolePermissions(user.role);
      if (!rolePerms || rolePerms.length === 0) return false;

      // Check for exact match or wildcard
      for (const perm of rolePerms) {
        if (perm === '*') return true;
        if (perm === permission) return true;
        // Wildcard matching: "workspace.*" matches "workspace.create"
        if (perm.endsWith('.*')) {
          const prefix = perm.slice(0, -2);
          if (permission.startsWith(prefix + '.') || permission === prefix) {
            return true;
          }
        }
      }
      return false;
    } catch (e) {
      // If all else fails, deny access
      return false;
    }
  }
}

/**
 * Get workspace permissions for a specific user.
 *
 * @param {Object} user - User object with role
 * @returns {Object} Map of operation → boolean
 */
export async function getUserPermissions(user) {
  const operations = ['create', 'edit', 'delete', 'publish', 'view', 'switch'];
  const result = {};

  for (const op of operations) {
    result[op] = await checkPermission(user, op);
  }

  return result;
}

// ============================================================================
// Workspace User Assignment
// ============================================================================

/**
 * Assign a user to a workspace.
 *
 * WHY ASSIGNMENT:
 * Drupal's workspaces module supports assigning specific users to workspaces.
 * This controls who can collaborate within a workspace — only assigned users
 * (and the owner) can view and edit workspace content. Admins bypass assignment
 * checks via the wildcard permission.
 *
 * @param {string} workspaceId - Workspace UUID or machine name
 * @param {string} userId - User ID to assign
 * @param {Object} [user] - User performing the action (for permission check)
 * @returns {Object} Updated workspace entity
 * @throws {Error} If workspace not found or user already assigned
 */
export async function assignUser(workspaceId, userId, user = null) {
  if (user && permissionsModule) {
    const allowed = await checkPermission(user, 'edit');
    if (!allowed) {
      const err = new Error('Permission denied: workspace.edit');
      err.code = 'PERMISSION_DENIED';
      err.status = 403;
      throw err;
    }
  }

  const workspace = resolveWorkspace(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  // Initialize assignees array if missing (backward compat with older workspaces)
  if (!Array.isArray(workspace.assignees)) {
    workspace.assignees = [];
  }

  if (workspace.assignees.includes(userId)) {
    throw new Error(`User "${userId}" is already assigned to workspace "${workspace.label}"`);
  }

  workspace.assignees.push(userId);
  workspace.updated = new Date().toISOString();
  saveWorkspace(workspace);
  workspaceCache.set(workspace.id, workspace);

  // Audit log
  if (auditModule && typeof auditModule.log === 'function') {
    auditModule.log('workspace.assignUser', {
      workspaceId: workspace.id,
      workspaceLabel: workspace.label,
      assignedUserId: userId,
      performedBy: user?.id,
    });
  }

  return workspace;
}

/**
 * Unassign a user from a workspace.
 *
 * @param {string} workspaceId - Workspace UUID or machine name
 * @param {string} userId - User ID to unassign
 * @param {Object} [user] - User performing the action (for permission check)
 * @returns {Object} Updated workspace entity
 * @throws {Error} If workspace not found or user not assigned
 */
export async function unassignUser(workspaceId, userId, user = null) {
  if (user && permissionsModule) {
    const allowed = await checkPermission(user, 'edit');
    if (!allowed) {
      const err = new Error('Permission denied: workspace.edit');
      err.code = 'PERMISSION_DENIED';
      err.status = 403;
      throw err;
    }
  }

  const workspace = resolveWorkspace(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  if (!Array.isArray(workspace.assignees)) {
    workspace.assignees = [];
  }

  const idx = workspace.assignees.indexOf(userId);
  if (idx === -1) {
    throw new Error(`User "${userId}" is not assigned to workspace "${workspace.label}"`);
  }

  workspace.assignees.splice(idx, 1);
  workspace.updated = new Date().toISOString();
  saveWorkspace(workspace);
  workspaceCache.set(workspace.id, workspace);

  // Audit log
  if (auditModule && typeof auditModule.log === 'function') {
    auditModule.log('workspace.unassignUser', {
      workspaceId: workspace.id,
      workspaceLabel: workspace.label,
      removedUserId: userId,
      performedBy: user?.id,
    });
  }

  return workspace;
}

/**
 * Check if a user is assigned to (or has access to) a workspace.
 *
 * WHY ACCESS CHECK:
 * Only the owner, assigned users, and admins (wildcard permission) can access
 * a workspace. This prevents unauthorized users from viewing or modifying
 * workspace content.
 *
 * @param {string} workspaceId - Workspace UUID or machine name
 * @param {Object} user - User object with id and role
 * @returns {boolean} True if user has access
 */
export async function isUserAssigned(workspaceId, user) {
  if (!user || !user.id) return false;

  const workspace = resolveWorkspace(workspaceId);
  if (!workspace) return false;

  // Owner always has access
  if (workspace.owner === user.id) return true;

  // Check assignees list
  if (Array.isArray(workspace.assignees) && workspace.assignees.includes(user.id)) {
    return true;
  }

  // Admin role (wildcard permission) bypasses assignment
  if (permissionsModule) {
    try {
      const hasView = await checkPermission(user, 'view');
      if (hasView) {
        // Check if user's role has wildcard — admins can access any workspace
        const rolePerms = permissionsModule.getRolePermissions(user.role);
        if (rolePerms && rolePerms.includes('*')) return true;
      }
    } catch {
      // Fall through
    }
  }

  return false;
}

/**
 * Get all workspaces assigned to a user.
 *
 * @param {string} userId - User ID
 * @returns {Object[]} Array of workspace entities the user is assigned to
 */
export function getAssignedWorkspaces(userId) {
  const result = [];
  for (const ws of workspaceCache.values()) {
    if (ws.owner === userId) {
      result.push(ws);
      continue;
    }
    if (Array.isArray(ws.assignees) && ws.assignees.includes(userId)) {
      result.push(ws);
    }
  }
  return result;
}

// ============================================================================
// Nested Workspace Hierarchy
// ============================================================================

/**
 * Get direct children of a workspace.
 *
 * WHY CHILDREN:
 * Nested workspaces form a hierarchy: parent → child → grandchild.
 * Children inherit content from their parent and publish UP the chain
 * (child → parent → live) rather than directly to live.
 *
 * @param {string} workspaceId - Workspace UUID or machine name
 * @returns {Object[]} Array of child workspace entities
 */
export function getChildren(workspaceId) {
  const workspace = resolveWorkspace(workspaceId);
  if (!workspace) return [];

  const children = [];
  for (const ws of workspaceCache.values()) {
    if (ws.parent === workspace.id) {
      children.push(ws);
    }
  }
  return children;
}

/**
 * Get the full hierarchy chain from a workspace up to root (live).
 *
 * WHY HIERARCHY:
 * Knowing the full ancestor chain is needed for content inheritance
 * (content flows down: live → parent → child) and for publish operations
 * (changes flow up: child → parent → live).
 *
 * @param {string} workspaceId - Workspace UUID or machine name
 * @returns {Object[]} Array from root to leaf, empty if workspace not found
 */
export function getHierarchy(workspaceId) {
  const workspace = resolveWorkspace(workspaceId);
  if (!workspace) return [];

  const chain = [workspace];
  let current = workspace;
  const visited = new Set([current.id]);

  // Walk up the parent chain
  while (current.parent) {
    const parent = workspaceCache.get(current.parent);
    if (!parent || visited.has(parent.id)) break; // Prevent circular
    visited.add(parent.id);
    chain.unshift(parent); // Add at beginning (root first)
    current = parent;
  }

  return chain;
}

/**
 * Publish a workspace's content to its parent workspace (not to live).
 *
 * WHY PUBLISH TO PARENT:
 * In a nested workspace hierarchy, publishing moves content UP one level.
 * A child workspace publishes to its parent, and the parent can then
 * publish to live (or to its own parent). This creates a staged review
 * pipeline: dev → staging → live.
 *
 * FLOW:
 * 1. Get all associations from the child workspace
 * 2. For each content item: associate it with the parent workspace
 * 3. Copy workspace content to parent's workspace copy format
 * 4. Remove associations from child workspace
 *
 * @param {string} childId - Child workspace UUID or machine name
 * @param {Object} [options] - Options
 * @param {Object} [user] - User performing the action
 * @returns {Object} Result with published items
 */
export async function publishToParent(childId, options = {}, user = null) {
  const child = resolveWorkspace(childId);
  if (!child) {
    throw new Error(`Workspace not found: ${childId}`);
  }

  if (!child.parent) {
    throw new Error(`Workspace "${child.label}" has no parent. Use workspace:publish to publish directly to live.`);
  }

  const parent = workspaceCache.get(child.parent);
  if (!parent) {
    throw new Error(`Parent workspace not found: ${child.parent}`);
  }

  const associations = getAssociations(child.id);
  if (!associations.items || associations.items.length === 0) {
    return {
      published: true,
      childId: child.id,
      childLabel: child.label,
      parentId: parent.id,
      parentLabel: parent.label,
      itemCount: 0,
      items: [],
      message: 'Child workspace has no content to publish to parent',
    };
  }

  const childPrefix = child.id.substring(0, 8);
  const parentPrefix = parent.id.substring(0, 8);
  const contentDir = join(baseDir, 'content');
  const results = [];
  const errors = [];

  for (const association of [...associations.items]) {
    try {
      const { type: contentType, id: contentId, operation } = association;

      if (operation === 'create') {
        // Content created in child — re-associate with parent
        const contentPath = join(contentDir, contentType, `${contentId}.json`);
        if (existsSync(contentPath)) {
          const item = JSON.parse(readFileSync(contentPath, 'utf-8'));
          // Update workspace reference to parent
          item._workspace = parent.id;
          writeFileSync(contentPath, JSON.stringify(item, null, 2) + '\n');
        }
        associateContent(parent.id, contentType, contentId, 'create');
      } else if (operation === 'edit') {
        // Content edited in child — move workspace copy to parent's format
        const childCopyId = `ws-${childPrefix}-${contentId}`;
        const parentCopyId = `ws-${parentPrefix}-${contentId}`;

        const childCopyPath = join(contentDir, contentType, `${childCopyId}.json`);
        if (existsSync(childCopyPath)) {
          const childCopy = JSON.parse(readFileSync(childCopyPath, 'utf-8'));

          // Update workspace references
          childCopy._workspace = parent.id;
          childCopy.id = parentCopyId;

          // Write parent's workspace copy
          const parentCopyPath = join(contentDir, contentType, `${parentCopyId}.json`);
          writeFileSync(parentCopyPath, JSON.stringify(childCopy, null, 2) + '\n');

          // Remove child's workspace copy
          unlinkSync(childCopyPath);
        }
        associateContent(parent.id, contentType, contentId, 'edit');
      }

      // Remove from child's associations
      removeContentAssociation(child.id, contentType, contentId);

      results.push({
        contentType,
        contentId,
        operation,
        from: child.label,
        to: parent.label,
      });
    } catch (err) {
      errors.push({
        contentId: association.id,
        contentType: association.type,
        error: err.message,
      });
    }
  }

  // Audit log
  if (auditModule && typeof auditModule.log === 'function') {
    auditModule.log('workspace.publishToParent', {
      childId: child.id,
      childLabel: child.label,
      parentId: parent.id,
      parentLabel: parent.label,
      itemCount: results.length,
      userId: user?.id,
    });
  }

  return {
    published: true,
    childId: child.id,
    childLabel: child.label,
    parentId: parent.id,
    parentLabel: parent.label,
    itemCount: results.length,
    items: results,
    errors: errors.length > 0 ? errors : undefined,
    message: errors.length > 0
      ? `Published ${results.length} items from "${child.label}" to "${parent.label}" with ${errors.length} error(s)`
      : `Successfully published ${results.length} item(s) from "${child.label}" to "${parent.label}"`,
  };
}

// ============================================================================
// Workspace Expiration
// ============================================================================

/**
 * Check if a workspace has expired.
 *
 * WHY EXPIRATION:
 * Workspaces may have a limited lifespan (e.g., a sprint, a campaign launch).
 * After the expiration date, the workspace becomes read-only to prevent stale
 * changes from being published. This follows the principle of "don't publish
 * forgotten workspace changes months later."
 *
 * @param {string} workspaceId - Workspace UUID or machine name
 * @returns {boolean} True if workspace has expired
 */
export function isExpired(workspaceId) {
  const workspace = resolveWorkspace(workspaceId);
  if (!workspace) return false;

  if (!workspace.expiresAt) return false;

  const expirationDate = new Date(workspace.expiresAt);
  return expirationDate <= new Date();
}

/**
 * Get expiration status details for a workspace.
 *
 * @param {string} workspaceId - Workspace UUID or machine name
 * @returns {Object} Expiration status: { expired, expiresAt, remainingMs, remainingHuman }
 */
export function getExpirationStatus(workspaceId) {
  const workspace = resolveWorkspace(workspaceId);
  if (!workspace) return { expired: false, expiresAt: null };

  if (!workspace.expiresAt) {
    return { expired: false, expiresAt: null, remainingMs: null, remainingHuman: 'No expiration set' };
  }

  const expirationDate = new Date(workspace.expiresAt);
  const now = new Date();
  const remainingMs = expirationDate.getTime() - now.getTime();
  const expired = remainingMs <= 0;

  let remainingHuman;
  if (expired) {
    const agoMs = Math.abs(remainingMs);
    const hours = Math.floor(agoMs / 3600000);
    const days = Math.floor(hours / 24);
    remainingHuman = days > 0 ? `Expired ${days} day(s) ago` : `Expired ${hours} hour(s) ago`;
  } else {
    const hours = Math.floor(remainingMs / 3600000);
    const days = Math.floor(hours / 24);
    remainingHuman = days > 0 ? `${days} day(s) remaining` : `${hours} hour(s) remaining`;
  }

  return {
    expired,
    expiresAt: workspace.expiresAt,
    remainingMs,
    remainingHuman,
  };
}

/**
 * Enforce that a workspace is not expired before allowing write operations.
 *
 * @param {string} workspaceId - Workspace UUID or machine name
 * @throws {Error} If workspace is expired (code: WORKSPACE_EXPIRED, status: 403)
 */
function enforceNotExpired(workspaceId) {
  if (isExpired(workspaceId)) {
    const workspace = resolveWorkspace(workspaceId);
    const label = workspace ? workspace.label : workspaceId;
    const err = new Error(`Workspace "${label}" has expired and is read-only. Expiration: ${workspace.expiresAt}`);
    err.code = 'WORKSPACE_EXPIRED';
    err.status = 403;
    throw err;
  }
}

/**
 * Set an expiration date on a workspace.
 *
 * @param {string} workspaceId - Workspace UUID or machine name
 * @param {string|null} expiresAt - ISO date string, or null to remove expiration
 * @param {Object} [user] - User performing the action
 * @returns {Object} Updated workspace
 */
export async function setExpiration(workspaceId, expiresAt, user = null) {
  const workspace = resolveWorkspace(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  // Validate date if provided
  if (expiresAt !== null) {
    const date = new Date(expiresAt);
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid date: ${expiresAt}`);
    }
    workspace.expiresAt = date.toISOString();
  } else {
    workspace.expiresAt = null;
  }

  workspace.updated = new Date().toISOString();
  saveWorkspace(workspace);
  workspaceCache.set(workspace.id, workspace);

  // Activity log
  logActivity(workspace.id, 'workspace.set_expiration', {
    expiresAt: workspace.expiresAt,
  }, user);

  return workspace;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a URL-safe machine name from a label.
 *
 * WHY MACHINE NAMES:
 * Following Drupal's pattern where entities have both a human-readable label
 * and a machine-readable identifier. Machine names are used in URLs, CLI, and config.
 *
 * @param {string} label - Human-readable label
 * @returns {string} URL-safe machine name
 */
function generateMachineName(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 64);
}

/**
 * Save a workspace entity to disk.
 *
 * @param {Object} workspace - Workspace entity
 */
function saveWorkspace(workspace) {
  const filePath = join(workspacesDir, `${workspace.id}.json`);
  writeFileSync(filePath, JSON.stringify(workspace, null, 2), 'utf-8');
}

// ============================================================================
// CLI Argument Parsing
// ============================================================================

/**
 * Parse raw CLI args array into positional args and named options.
 *
 * WHY CUSTOM PARSER:
 * CLI framework passes raw string[] from process.argv. Module CLI handlers
 * need both positional arguments and --key=value flags. This parser handles
 * both without external dependencies.
 *
 * @param {string[]} rawArgs - Raw CLI arguments
 * @returns {{ positional: string[], options: Object }}
 */
function parseCliArgs(rawArgs) {
  const positional = [];
  const options = {};

  for (const arg of rawArgs) {
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const key = arg.substring(2, eqIdx);
        options[key] = arg.substring(eqIdx + 1);
      } else {
        options[arg.substring(2)] = true;
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      // Short flag like -l (boolean)
      options[arg.substring(1)] = true;
    } else {
      positional.push(arg);
    }
  }

  return { positional, options };
}

// ============================================================================
// CLI Registration
// ============================================================================

/**
 * Register CLI commands for workspace management.
 *
 * @param {Function} register - CLI register function
 */
export function registerCli(register) {
  // workspace:create <machineName> --label="Label"
  register('workspace:create', async (args) => {
    const { positional, options } = parseCliArgs(args);
    const machineName = positional[0];
    const label = options.label || options.l || machineName;

    if (!machineName && !label) {
      console.log('Usage: workspace:create <machineName> --label="Workspace Label"');
      return false;
    }

    try {
      // Resolve parent workspace if --parent flag provided
      let parentId = null;
      if (options.parent) {
        const parentWs = resolveWorkspace(options.parent);
        if (!parentWs) {
          console.error(`\u2717 Parent workspace not found: ${options.parent}`);
          return false;
        }
        parentId = parentWs.id;
      }

      // Parse expiration date if --expires flag provided
      let expiresAt = null;
      if (options.expires) {
        const date = new Date(options.expires);
        if (isNaN(date.getTime())) {
          console.error(`\u2717 Invalid expiration date: ${options.expires}`);
          return false;
        }
        expiresAt = date.toISOString();
      }

      const workspace = await create({
        label: label || machineName,
        machineName: machineName || undefined,
        description: options.description || options.d || '',
        parent: parentId,
        expiresAt,
      });

      console.log(`\u2713 Workspace created: ${workspace.label}`);
      console.log(`  ID: ${workspace.id}`);
      console.log(`  Machine name: ${workspace.machineName}`);
      console.log(`  Status: ${workspace.status}`);
      if (workspace.parent) {
        const parentWs = get(workspace.parent);
        console.log(`  Parent: ${parentWs ? parentWs.label : workspace.parent}`);
      }
      if (workspace.expiresAt) {
        console.log(`  Expires: ${workspace.expiresAt}`);
      }
      return true;
    } catch (err) {
      console.error(`\u2717 Failed to create workspace: ${err.message}`);
      return false;
    }
  }, 'Create a new workspace');

  // workspace:list [--status=active|archived]
  register('workspace:list', async (args) => {
    const { options } = parseCliArgs(args);
    const status = options.status || options.s;
    const results = list({ status });

    if (results.length === 0) {
      console.log('No workspaces found.');
      return true;
    }

    console.log(`Workspaces (${results.length}):`);
    console.log('\u2500'.repeat(80));

    for (const ws of results) {
      const statusBadge = ws.status === 'active' ? '[active]' : '[archived]';
      const expiredBadge = isExpired(ws.id) ? ' [EXPIRED]' : '';
      console.log(`  ${ws.machineName} ${statusBadge}${expiredBadge}`);
      console.log(`    Label: ${ws.label}`);
      console.log(`    ID: ${ws.id}`);
      console.log(`    Created: ${ws.created}`);
      if (ws.description) {
        console.log(`    Description: ${ws.description}`);
      }
      if (ws.expiresAt) {
        const expStatus = getExpirationStatus(ws.id);
        console.log(`    Expires: ${ws.expiresAt} (${expStatus.remainingHuman})`);
      }
      console.log('');
    }

    return true;
  }, 'List all workspaces');

  // workspace:delete <id|machineName> --confirm
  register('workspace:delete', async (args) => {
    const { positional, options } = parseCliArgs(args);
    const identifier = positional[0];
    if (!identifier) {
      console.log('Usage: workspace:delete <id|machineName> --confirm');
      console.log('The --confirm flag is required to prevent accidental deletion.');
      return false;
    }

    try {
      const workspace = resolveWorkspace(identifier);
      if (!workspace) {
        console.error(`\u2717 Workspace not found: ${identifier}`);
        return false;
      }

      // Require --confirm flag to prevent accidental deletion
      // WHY CONFIRMATION:
      // Workspace deletion is destructive — it removes the workspace entity
      // and all associated content mappings. This follows the Drupal pattern
      // of requiring explicit confirmation for destructive batch operations.
      if (!options.confirm) {
        const associations = getAssociations(workspace.id);
        const itemCount = associations.items ? associations.items.length : 0;
        console.log(`\u26A0 Workspace "${workspace.label}" (${workspace.id}) will be permanently deleted.`);
        if (itemCount > 0) {
          console.log(`  This workspace has ${itemCount} associated content item(s) that will be unlinked.`);
        }
        console.log(`  To confirm, re-run with --confirm flag:`);
        console.log(`  workspace:delete ${identifier} --confirm`);
        return false;
      }

      const result = await remove(workspace.id);
      console.log(`\u2713 Workspace deleted: ${workspace.label} (${workspace.id})`);
      if (result.removedAssociations > 0) {
        console.log(`  Cleaned up ${result.removedAssociations} content association(s)`);
      }
      return true;
    } catch (err) {
      console.error(`\u2717 Failed to delete workspace: ${err.message}`);
      return false;
    }
  }, 'Delete a workspace (requires --confirm)');

  // workspace:show <id|machineName>
  register('workspace:show', async (args) => {
    const { positional } = parseCliArgs(args);
    const identifier = positional[0];
    if (!identifier) {
      console.log('Usage: workspace:show <id|machineName>');
      return false;
    }

    const workspace = resolveWorkspace(identifier);
    if (!workspace) {
      console.error(`\u2717 Workspace not found: ${identifier}`);
      return false;
    }

    console.log(JSON.stringify(workspace, null, 2));
    return true;
  }, 'Show workspace details');

  // workspace:update <id|machineName> --label="New Label" --status=archived
  register('workspace:update', async (args) => {
    const { positional, options } = parseCliArgs(args);
    const identifier = positional[0];
    if (!identifier) {
      console.log('Usage: workspace:update <id|machineName> --label="New Label" --status=active|archived');
      return false;
    }

    const workspace = resolveWorkspace(identifier);
    if (!workspace) {
      console.error(`\u2717 Workspace not found: ${identifier}`);
      return false;
    }

    const updates = {};
    if (options.label) updates.label = options.label;
    if (options.status) updates.status = options.status;
    if (options.description) updates.description = options.description;

    try {
      const updated = await update(workspace.id, updates);
      console.log(`\u2713 Workspace updated: ${updated.label}`);
      console.log(JSON.stringify(updated, null, 2));
      return true;
    } catch (err) {
      console.error(`\u2717 Failed to update workspace: ${err.message}`);
      return false;
    }
  }, 'Update workspace metadata');

  // workspace:switch <id|machineName|live>
  register('workspace:switch', async (args) => {
    const { positional } = parseCliArgs(args);
    const identifier = positional[0];
    if (!identifier) {
      console.log('Usage: workspace:switch <id|machineName|live>');
      console.log('Use "live" to return to the live (default) workspace.');
      return false;
    }

    try {
      if (identifier === 'live' || identifier === 'none') {
        setActiveWorkspace(null);
        console.log('\u2713 Switched to live workspace (no active workspace)');
        return true;
      }

      const workspace = setActiveWorkspace(identifier);
      console.log(`\u2713 Active workspace set to: ${workspace.label} (${workspace.machineName})`);
      console.log(`  ID: ${workspace.id}`);
      console.log(`  All content commands will now operate in this workspace context.`);
      return true;
    } catch (err) {
      console.error(`\u2717 Failed to switch workspace: ${err.message}`);
      return false;
    }
  }, 'Switch active workspace');

  // workspace:active - Show the currently active workspace
  register('workspace:active', async () => {
    const active = getActiveWorkspace();
    if (!active) {
      console.log('Active workspace: live (default)');
      console.log('No workspace is currently active. Content commands operate on live data.');
      return true;
    }

    console.log(`Active workspace: ${active.label} (${active.machineName})`);
    console.log(`  ID: ${active.id}`);
    console.log(`  Status: ${active.status}`);
    console.log(`  Set via: config/workspace-active.json`);

    // Show association count
    const associations = getAssociations(active.id);
    const count = associations.items ? associations.items.length : 0;
    console.log(`  Content items: ${count}`);
    return true;
  }, 'Show currently active workspace');

  // workspace:current - Alias for workspace:active
  register('workspace:current', async () => {
    const active = getActiveWorkspace();
    if (!active) {
      console.log('Active workspace: live (default)');
      console.log('No workspace is currently active. Content commands operate on live data.');
      return true;
    }

    console.log(`Active workspace: ${active.label} (${active.machineName})`);
    console.log(`  ID: ${active.id}`);
    console.log(`  Status: ${active.status}`);
    console.log(`  Set via: config/workspace-active.json`);

    const associations = getAssociations(active.id);
    const count = associations.items ? associations.items.length : 0;
    console.log(`  Content items: ${count}`);
    return true;
  }, 'Show currently active workspace (alias for workspace:active)');

  // workspace:permissions <user-role>
  register('workspace:permissions', async (args) => {
    const { positional } = parseCliArgs(args);
    const role = positional[0];
    if (!role) {
      console.log('Usage: workspace:permissions <role>');
      console.log('Shows workspace permissions for a given role.');
      return false;
    }

    const mockUser = { role };
    const perms = await getUserPermissions(mockUser);

    console.log(`Workspace permissions for role "${role}":`);
    console.log('\u2500'.repeat(40));
    for (const [op, allowed] of Object.entries(perms)) {
      const icon = allowed ? '\u2713' : '\u2717';
      console.log(`  ${icon} workspace.${op}`);
    }

    return true;
  }, 'Show workspace permissions for a role');

  // workspace:assign <workspaceId|machineName> <userId>
  register('workspace:assign', async (args) => {
    const { positional } = parseCliArgs(args);
    const identifier = positional[0];
    const userId = positional[1];

    if (!identifier || !userId) {
      console.log('Usage: workspace:assign <workspaceId|machineName> <userId>');
      console.log('Assign a user to a workspace for collaboration.');
      return false;
    }

    try {
      const workspace = await assignUser(identifier, userId);
      console.log(`\u2713 User "${userId}" assigned to workspace "${workspace.label}"`);
      console.log(`  Assignees: ${workspace.assignees.join(', ')}`);
      return true;
    } catch (err) {
      console.error(`\u2717 Failed to assign user: ${err.message}`);
      return false;
    }
  }, 'Assign a user to a workspace');

  // workspace:unassign <workspaceId|machineName> <userId>
  register('workspace:unassign', async (args) => {
    const { positional } = parseCliArgs(args);
    const identifier = positional[0];
    const userId = positional[1];

    if (!identifier || !userId) {
      console.log('Usage: workspace:unassign <workspaceId|machineName> <userId>');
      console.log('Remove a user from a workspace.');
      return false;
    }

    try {
      const workspace = await unassignUser(identifier, userId);
      console.log(`\u2713 User "${userId}" removed from workspace "${workspace.label}"`);
      const remaining = workspace.assignees.length;
      console.log(`  Remaining assignees: ${remaining > 0 ? workspace.assignees.join(', ') : '(none)'}`);
      return true;
    } catch (err) {
      console.error(`\u2717 Failed to unassign user: ${err.message}`);
      return false;
    }
  }, 'Remove a user from a workspace');

  // workspace:assigned <userId> - Show workspaces assigned to a user
  register('workspace:assigned', async (args) => {
    const { positional } = parseCliArgs(args);
    const userId = positional[0];

    if (!userId) {
      console.log('Usage: workspace:assigned <userId>');
      console.log('Show all workspaces assigned to a user.');
      return false;
    }

    const workspaces = getAssignedWorkspaces(userId);
    if (workspaces.length === 0) {
      console.log(`No workspaces assigned to user "${userId}".`);
      return true;
    }

    console.log(`Workspaces for user "${userId}" (${workspaces.length}):`);
    console.log('\u2500'.repeat(60));
    for (const ws of workspaces) {
      const role = ws.owner === userId ? '[owner]' : '[assigned]';
      console.log(`  ${ws.machineName} ${role} — ${ws.label}`);
      console.log(`    ID: ${ws.id}`);
    }
    return true;
  }, 'Show workspaces assigned to a user');

  // workspace:check-access <workspaceId|machineName> <userId> - Check if user can access workspace
  register('workspace:check-access', async (args) => {
    const { positional } = parseCliArgs(args);
    const identifier = positional[0];
    const userId = positional[1];

    if (!identifier || !userId) {
      console.log('Usage: workspace:check-access <workspaceId|machineName> <userId>');
      return false;
    }

    // Build a minimal user object for checking
    // In a real system, we'd look up the user from the users module
    let userObj = { id: userId, role: 'anonymous' };

    // Try to find the user in content to get their role
    if (contentModule) {
      try {
        const users = await contentModule.list('user');
        const found = users.find(u => u.id === userId || u.username === userId);
        if (found) {
          userObj = { id: found.id, role: found.role || 'authenticated', username: found.username };
        }
      } catch {
        // Fallback to minimal user
      }
    }

    const hasAccess = await isUserAssigned(identifier, userObj);
    const workspace = resolveWorkspace(identifier);
    const wsLabel = workspace ? workspace.label : identifier;

    if (hasAccess) {
      console.log(`\u2713 User "${userId}" HAS access to workspace "${wsLabel}"`);
      if (workspace && workspace.owner === userObj.id) {
        console.log(`  Reason: user is the workspace owner`);
      } else if (workspace && Array.isArray(workspace.assignees) && workspace.assignees.includes(userObj.id)) {
        console.log(`  Reason: user is in the assignees list`);
      } else {
        console.log(`  Reason: user has admin-level permissions`);
      }
    } else {
      console.log(`\u2717 User "${userId}" does NOT have access to workspace "${wsLabel}"`);
      console.log(`  To grant access: workspace:assign ${identifier} ${userId}`);
    }
    return true;
  }, 'Check if a user can access a workspace');

  // workspace:children <workspaceId|machineName> - List child workspaces
  register('workspace:children', async (args) => {
    const { positional } = parseCliArgs(args);
    const identifier = positional[0];

    if (!identifier) {
      console.log('Usage: workspace:children <workspaceId|machineName>');
      console.log('Show direct child workspaces of a parent workspace.');
      return false;
    }

    const workspace = resolveWorkspace(identifier);
    if (!workspace) {
      console.error(`\u2717 Workspace not found: ${identifier}`);
      return false;
    }

    const children = getChildren(workspace.id);
    if (children.length === 0) {
      console.log(`Workspace "${workspace.label}" has no child workspaces.`);
      return true;
    }

    console.log(`Children of "${workspace.label}" (${children.length}):`);
    console.log('\u2500'.repeat(60));
    for (const child of children) {
      const assoc = getAssociations(child.id);
      const count = assoc.items ? assoc.items.length : 0;
      console.log(`  ${child.machineName} — ${child.label}`);
      console.log(`    ID: ${child.id}  Status: ${child.status}  Items: ${count}`);
    }
    return true;
  }, 'List child workspaces of a parent');

  // workspace:hierarchy <workspaceId|machineName> - Show workspace ancestor chain
  register('workspace:hierarchy', async (args) => {
    const { positional } = parseCliArgs(args);
    const identifier = positional[0];

    if (!identifier) {
      console.log('Usage: workspace:hierarchy <workspaceId|machineName>');
      console.log('Show the full parent chain from root (live) to the given workspace.');
      return false;
    }

    const workspace = resolveWorkspace(identifier);
    if (!workspace) {
      console.error(`\u2717 Workspace not found: ${identifier}`);
      return false;
    }

    const chain = getHierarchy(workspace.id);

    console.log('Workspace hierarchy:');
    console.log('  [live]');
    for (let i = 0; i < chain.length; i++) {
      const indent = '  '.repeat(i + 2);
      const ws = chain[i];
      const marker = ws.id === workspace.id ? '\u25B6' : '\u2502';
      console.log(`${indent}${marker} ${ws.machineName} (${ws.label})`);
    }
    // Show children of current workspace
    const children = getChildren(workspace.id);
    if (children.length > 0) {
      const childIndent = '  '.repeat(chain.length + 2);
      for (const child of children) {
        console.log(`${childIndent}\u2514 ${child.machineName} (${child.label})`);
      }
    }
    return true;
  }, 'Show workspace ancestor chain');

  // workspace:publish-to-parent <childWorkspace> - Publish child workspace content to parent
  register('workspace:publish-to-parent', async (args) => {
    const { positional } = parseCliArgs(args);
    const identifier = positional[0];

    if (!identifier) {
      console.log('Usage: workspace:publish-to-parent <workspaceId|machineName>');
      console.log('Publish workspace content to its parent workspace (not to live).');
      return false;
    }

    try {
      const result = await publishToParent(identifier);
      console.log(`\u2713 ${result.message}`);
      for (const item of result.items) {
        console.log(`  \u2713 ${item.contentType}/${item.contentId} [${item.operation}] → ${item.to}`);
      }
      return true;
    } catch (err) {
      console.error(`\u2717 Failed: ${err.message}`);
      return false;
    }
  }, 'Publish workspace content to parent workspace');

  // workspace:publish-content <workspaceId|machineName> <contentId>
  register('workspace:publish-content', async (args) => {
    const { positional } = parseCliArgs(args);
    const workspaceIdentifier = positional[0];
    const contentId = positional[1];

    if (!workspaceIdentifier || !contentId) {
      console.log('Usage: workspace:publish-content <workspaceId|machineName> <contentId>');
      console.log('Publishes a single content item from the workspace to live.');
      return false;
    }

    try {
      const result = await publishContent(workspaceIdentifier, contentId);
      console.log(`\u2713 Published content from workspace "${result.workspaceLabel}" to live`);
      console.log(`  Content type: ${result.contentType}`);
      console.log(`  Content ID: ${result.contentId}`);
      console.log(`  Operation: ${result.operation}`);
      console.log(`  Workspace association removed`);
      return true;
    } catch (err) {
      console.error(`\u2717 Failed to publish content: ${err.message}`);
      return false;
    }
  }, 'Publish single content item from workspace to live');

  // workspace:associations <workspaceId|machineName> - List content associated with workspace
  register('workspace:associations', async (args) => {
    const { positional } = parseCliArgs(args);
    const identifier = positional[0];

    if (!identifier) {
      console.log('Usage: workspace:associations <workspaceId|machineName>');
      return false;
    }

    const workspace = resolveWorkspace(identifier);
    if (!workspace) {
      console.error(`\u2717 Workspace not found: ${identifier}`);
      return false;
    }

    const associations = getAssociations(workspace.id);
    if (!associations.items || associations.items.length === 0) {
      console.log(`Workspace "${workspace.label}" has no associated content.`);
      return true;
    }

    console.log(`Content in workspace "${workspace.label}" (${associations.items.length} items):`);
    console.log('\u2500'.repeat(80));
    for (const item of associations.items) {
      console.log(`  ${item.type}/${item.id} [${item.operation}] (${item.timestamp})`);
    }
    return true;
  }, 'List content associated with a workspace');

  // workspace:publish <workspaceId|machineName> [--force]
  register('workspace:publish', async (args) => {
    const { positional, options } = parseCliArgs(args);
    const identifier = positional[0];

    if (!identifier) {
      console.log('Usage: workspace:publish <workspaceId|machineName> [--force]');
      console.log('Publishes all content from the workspace to live.');
      console.log('Options:');
      console.log('  --force  Skip conflict validation and publish anyway');
      return false;
    }

    try {
      const workspace = resolveWorkspace(identifier);
      if (!workspace) {
        console.error(`\u2717 Workspace not found: ${identifier}`);
        return false;
      }

      // Show what will be published
      const associations = getAssociations(workspace.id);
      const itemCount = associations.items ? associations.items.length : 0;
      if (itemCount === 0) {
        console.log(`Workspace "${workspace.label}" has no content to publish.`);
        return true;
      }

      console.log(`Publishing workspace "${workspace.label}" (${itemCount} item(s))...`);

      const result = await publishWorkspace(identifier, {
        validateConflicts: !options.force,
      });

      console.log(`\u2713 ${result.message}`);
      for (const item of result.items) {
        console.log(`  \u2713 ${item.contentType}/${item.contentId} [${item.operation}]`);
      }
      if (result.errors && result.errors.length > 0) {
        for (const err of result.errors) {
          console.log(`  \u2717 ${err.contentType}/${err.contentId}: ${err.error}`);
        }
      }

      // Show remaining associations (should be empty after full publish)
      const remaining = getAssociations(workspace.id);
      const remainCount = remaining.items ? remaining.items.length : 0;
      if (remainCount === 0) {
        console.log(`  Workspace is now empty (all content published to live).`);
      } else {
        console.log(`  ${remainCount} item(s) remaining in workspace (due to errors).`);
      }

      return true;
    } catch (err) {
      if (err.code === 'WORKSPACE_CONFLICTS') {
        console.error(`\u2717 ${err.message}`);
        if (err.conflicts) {
          for (const c of err.conflicts) {
            console.error(`  - ${c.contentType}/${c.contentId}: ${c.message}`);
            if (c.conflictingFields && c.conflictingFields.length > 0) {
              console.error(`    Conflicting fields: ${c.conflictingFields.map(f => f.field).join(', ')}`);
            }
          }
        }
        return false;
      }
      console.error(`\u2717 Failed to publish workspace: ${err.message}`);
      return false;
    }
  }, 'Publish all workspace content to live');

  // workspace:conflicts <workspaceId|machineName>
  register('workspace:conflicts', async (args) => {
    const { positional } = parseCliArgs(args);
    const identifier = positional[0];

    if (!identifier) {
      console.log('Usage: workspace:conflicts <workspaceId|machineName>');
      console.log('Detect conflicts between workspace content and live content.');
      return false;
    }

    try {
      const workspace = resolveWorkspace(identifier);
      if (!workspace) {
        console.error(`\u2717 Workspace not found: ${identifier}`);
        return false;
      }

      const conflicts = detectConflicts(workspace.id);

      if (conflicts.length === 0) {
        console.log(`\u2713 No conflicts detected in workspace "${workspace.label}".`);
        console.log(`  Workspace can be published safely.`);
        return true;
      }

      console.log(`\u26A0 ${conflicts.length} conflict(s) detected in workspace "${workspace.label}":`);
      console.log('\u2500'.repeat(80));

      for (const conflict of conflicts) {
        console.log(`  ${conflict.contentType}/${conflict.contentId}`);
        console.log(`    Workspace copy modified: ${conflict.workspaceModified}`);
        console.log(`    Live version modified:   ${conflict.liveModified}`);
        console.log(`    Workspace associated at: ${conflict.workspaceAssociatedAt}`);

        if (conflict.conflictingFields && conflict.conflictingFields.length > 0) {
          console.log(`    Conflicting fields:`);
          for (const f of conflict.conflictingFields) {
            const wsVal = typeof f.workspaceValue === 'string'
              ? f.workspaceValue.substring(0, 50)
              : JSON.stringify(f.workspaceValue).substring(0, 50);
            const liveVal = typeof f.liveValue === 'string'
              ? f.liveValue.substring(0, 50)
              : JSON.stringify(f.liveValue).substring(0, 50);
            console.log(`      - ${f.field}: workspace="${wsVal}" vs live="${liveVal}"`);
          }
        }
        console.log('');
      }

      console.log(`To publish anyway, use: workspace:publish ${identifier} --force`);
      return true;
    } catch (err) {
      console.error(`\u2717 Failed to check conflicts: ${err.message}`);
      return false;
    }
  }, 'Detect conflicts between workspace and live content');

  // workspace:diff <workspaceId|machineName>
  register('workspace:diff', async (args) => {
    const { positional } = parseCliArgs(args);
    const identifier = positional[0];

    if (!identifier) {
      console.log('Usage: workspace:diff <workspaceId|machineName>');
      console.log('Show differences between workspace content and live content.');
      return false;
    }

    try {
      const diff = diffWorkspace(identifier);

      if (diff.items.length === 0) {
        console.log(`Workspace "${diff.workspaceLabel}" has no changes.`);
        return true;
      }

      console.log(`Workspace "${diff.workspaceLabel}" — ${diff.summary.total} change(s):`);
      console.log(`  Added: ${diff.summary.added}  Modified: ${diff.summary.modified}  Deleted: ${diff.summary.deleted}`);
      console.log('\u2500'.repeat(80));

      for (const item of diff.items) {
        const opBadge = item.operation === 'added' ? '[+added]'
          : item.operation === 'deleted' ? '[-deleted]'
          : '[~modified]';

        console.log(`\n  ${item.contentType}/${item.contentId} ${opBadge}`);
        console.log(`    Title: ${item.title}`);

        if (item.fields.length === 0) {
          console.log(`    (no field changes)`);
        } else {
          for (const f of item.fields) {
            if (f.change === 'added') {
              const val = typeof f.newValue === 'string'
                ? f.newValue.substring(0, 60)
                : JSON.stringify(f.newValue).substring(0, 60);
              console.log(`    + ${f.field}: ${val}`);
            } else if (f.change === 'removed') {
              const val = typeof f.oldValue === 'string'
                ? f.oldValue.substring(0, 60)
                : JSON.stringify(f.oldValue).substring(0, 60);
              console.log(`    - ${f.field}: ${val}`);
            } else if (f.change === 'modified') {
              const oldVal = typeof f.oldValue === 'string'
                ? f.oldValue.substring(0, 40)
                : JSON.stringify(f.oldValue).substring(0, 40);
              const newVal = typeof f.newValue === 'string'
                ? f.newValue.substring(0, 40)
                : JSON.stringify(f.newValue).substring(0, 40);
              console.log(`    ~ ${f.field}: "${oldVal}" → "${newVal}"`);
            }
          }
        }
      }

      return true;
    } catch (err) {
      console.error(`\u2717 Failed to generate diff: ${err.message}`);
      return false;
    }
  }, 'Show differences between workspace and live content');

  // workspace:activity <workspace> [--limit=N] [--action=type]
  register('workspace:activity', async (args) => {
    const { positional, options } = parseCliArgs(args);
    const workspaceRef = positional[0];

    if (!workspaceRef) {
      console.log('Usage: workspace:activity <workspace-id-or-machine-name> [--limit=N] [--action=type]');
      return false;
    }

    try {
      const workspace = resolveWorkspace(workspaceRef);
      if (!workspace) {
        console.log(`Workspace not found: ${workspaceRef}`);
        return false;
      }

      const limit = options.limit ? parseInt(options.limit, 10) : 50;
      const log = getActivityLog(workspace.id, {
        limit,
        action: options.action,
      });

      console.log(`\nActivity Log: ${workspace.label} (${workspace.machineName})`);
      console.log('='.repeat(60));

      if (log.length === 0) {
        console.log('No activity recorded.');
        return true;
      }

      for (const entry of log) {
        const time = new Date(entry.timestamp).toLocaleString();
        const user = entry.user ? entry.user.name || entry.user.id : 'system';
        const details = Object.entries(entry.details || {})
          .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
          .join(', ');
        console.log(`[${time}] ${entry.action} by ${user}${details ? ' — ' + details : ''}`);
      }

      console.log(`\nShowing ${log.length} entries`);
      return true;
    } catch (err) {
      console.log(`Error: ${err.message}`);
      return false;
    }
  }, 'View workspace activity log');

  // workspace:analytics <workspace> - Show workspace analytics (changes, age, breakdown)
  register('workspace:analytics', async (args) => {
    const { positional } = parseCliArgs(args);
    const workspaceRef = positional[0];

    if (!workspaceRef) {
      console.log('Usage: workspace:analytics <workspace-id-or-machine-name>');
      console.log('Shows workspace statistics: change count, age, content type breakdown.');
      return false;
    }

    try {
      const analytics = getWorkspaceAnalytics(workspaceRef);

      console.log(`\nWorkspace Analytics: ${analytics.workspace.label} (${analytics.workspace.machineName})`);
      console.log('═'.repeat(60));

      // Overview
      console.log(`\n  Status:       ${analytics.workspace.status}`);
      console.log(`  Age:          ${analytics.age.display}`);
      console.log(`  Created:      ${new Date(analytics.age.created).toLocaleString()}`);
      console.log(`  Changes:      ${analytics.changeCount} content item(s)`);
      console.log(`  Activities:   ${analytics.activity.totalActions} logged action(s)`);
      console.log(`  Children:     ${analytics.childrenCount} child workspace(s)`);
      if (analytics.workspace.parent) {
        console.log(`  Parent:       ${analytics.workspace.parent}`);
      }
      // Show expiration status if set
      if (analytics.workspace.expiresAt) {
        const expStatus = getExpirationStatus(analytics.workspace.id);
        console.log(`  Expires:      ${analytics.workspace.expiresAt} (${expStatus.remainingHuman})`);
        if (expStatus.expired) {
          console.log(`  \u26A0 EXPIRED — workspace is read-only`);
        }
      }

      // Staleness
      if (analytics.staleness.isStale) {
        console.log(`\n  ⚠ STALE: No activity for ${analytics.staleness.daysSinceLastActivity} day(s)`);
      } else if (analytics.staleness.daysSinceLastActivity !== null) {
        console.log(`  Last active:  ${analytics.staleness.daysSinceLastActivity} day(s) ago`);
      }

      // Content type breakdown
      if (analytics.contentTypeBreakdown.length > 0) {
        console.log(`\n  Content Type Breakdown:`);
        console.log('  ' + '─'.repeat(50));
        for (const t of analytics.contentTypeBreakdown) {
          const ops = Object.entries(t.operations)
            .filter(([, v]) => v > 0)
            .map(([k, v]) => `${v} ${k}`)
            .join(', ');
          console.log(`    ${t.type}: ${t.count} change(s) (${ops})`);
          if (t.latestChange) {
            console.log(`      Latest: ${new Date(t.latestChange).toLocaleString()}`);
          }
        }
      } else {
        console.log(`\n  No content changes in this workspace.`);
      }

      // Activity breakdown
      if (Object.keys(analytics.activity.actionBreakdown).length > 0) {
        console.log(`\n  Activity Breakdown:`);
        console.log('  ' + '─'.repeat(50));
        const sorted = Object.entries(analytics.activity.actionBreakdown)
          .sort((a, b) => b[1] - a[1]);
        for (const [action, count] of sorted) {
          console.log(`    ${action}: ${count}`);
        }
      }

      // Children
      if (analytics.children.length > 0) {
        console.log(`\n  Child Workspaces:`);
        console.log('  ' + '─'.repeat(50));
        for (const child of analytics.children) {
          console.log(`    ${child.label} (${child.machineName})`);
        }
      }

      console.log('');
      return true;
    } catch (err) {
      console.error(`✗ ${err.message}`);
      return false;
    }
  }, 'Show workspace analytics (changes, age, content type breakdown)');

  // workspace:set-expiration <workspace> <date|"none"> - Set or remove expiration date
  register('workspace:set-expiration', async (args) => {
    const { positional } = parseCliArgs(args);
    const identifier = positional[0];
    const dateStr = positional[1];

    if (!identifier || !dateStr) {
      console.log('Usage: workspace:set-expiration <workspaceId|machineName> <ISO-date|"none">');
      console.log('Examples:');
      console.log('  workspace:set-expiration staging 2026-03-01T00:00:00Z');
      console.log('  workspace:set-expiration staging none    # remove expiration');
      return false;
    }

    try {
      const expiresAt = dateStr === 'none' ? null : dateStr;
      const workspace = await setExpiration(identifier, expiresAt);

      if (workspace.expiresAt) {
        const status = getExpirationStatus(workspace.id);
        console.log(`\u2713 Expiration set for workspace "${workspace.label}"`);
        console.log(`  Expires: ${workspace.expiresAt}`);
        console.log(`  Status: ${status.remainingHuman}`);
      } else {
        console.log(`\u2713 Expiration removed for workspace "${workspace.label}"`);
      }
      return true;
    } catch (err) {
      console.error(`\u2717 Failed: ${err.message}`);
      return false;
    }
  }, 'Set or remove workspace expiration date');

  // workspace:expiration <workspace> - Check expiration status
  register('workspace:expiration', async (args) => {
    const { positional } = parseCliArgs(args);
    const identifier = positional[0];

    if (!identifier) {
      console.log('Usage: workspace:expiration <workspaceId|machineName>');
      return false;
    }

    const workspace = resolveWorkspace(identifier);
    if (!workspace) {
      console.error(`\u2717 Workspace not found: ${identifier}`);
      return false;
    }

    const status = getExpirationStatus(workspace.id);

    console.log(`Workspace: ${workspace.label} (${workspace.machineName})`);
    if (!workspace.expiresAt) {
      console.log('  No expiration date set');
    } else {
      console.log(`  Expires: ${workspace.expiresAt}`);
      console.log(`  Status: ${status.remainingHuman}`);
      if (status.expired) {
        console.log('  \u26A0 This workspace is READ-ONLY (expired)');
      }
    }
    return true;
  }, 'Check workspace expiration status');
}

/**
 * Resolve a workspace from an ID or machine name.
 *
 * @param {string} identifier - UUID or machine name
 * @returns {Object|null} Workspace entity or null
 */
function resolveWorkspace(identifier) {
  // Try by ID first
  const byId = get(identifier);
  if (byId) return byId;

  // Try by machine name
  return getByMachineName(identifier);
}

// ============================================================================
// Publish Operations
// ============================================================================

/**
 * Publish a single content item from a workspace to live.
 *
 * WHY SINGLE PUBLISH:
 * Drupal's workspaces module supports publishing individual content items
 * from a workspace. This allows selective deployment of changes rather than
 * requiring an all-or-nothing workspace publish.
 *
 * FLOW:
 * 1. Find the workspace copy of the content (ws-{prefix}-{originalId} or newly created)
 * 2. Read the workspace copy data
 * 3. Overwrite the live version with workspace data (stripping workspace metadata)
 * 4. Delete the workspace copy file
 * 5. Remove the workspace-content association
 *
 * @param {string} workspaceId - Workspace UUID or machine name
 * @param {string} contentId - Content item ID (the original live ID)
 * @param {Object} [user] - User performing the action (for permission check)
 * @returns {Object} Result with published content details
 * @throws {Error} If workspace/content not found or permission denied
 */
export async function publishContent(workspaceId, contentId, user = null) {
  // Permission check
  if (user && permissionsModule) {
    const allowed = await checkPermission(user, 'publish');
    if (!allowed) {
      const err = new Error('Permission denied: workspace.publish');
      err.code = 'PERMISSION_DENIED';
      err.status = 403;
      throw err;
    }
  }

  // Resolve workspace
  const workspace = resolveWorkspace(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  // Check that the content is associated with this workspace
  const associations = getAssociations(workspace.id);
  const association = associations.items.find(
    a => a.id === contentId
  );

  if (!association) {
    throw new Error(`Content "${contentId}" is not associated with workspace "${workspace.label}"`);
  }

  const contentType = association.type;
  const wsPrefix = workspace.id.substring(0, 8);
  const contentDir = join(baseDir, 'content');

  /**
   * Read a content JSON file directly from disk.
   * WHY DIRECT FILE READ:
   * The content module's read() has workspace-aware logic that would
   * interfere with our publish operation. We need raw file access to
   * read workspace copies and write live content without triggering
   * workspace hooks or redirections.
   */
  function readContentFile(type, id) {
    const filePath = join(contentDir, type, `${id}.json`);
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch {
      return null;
    }
  }

  // Determine if this was a create or edit operation
  if (association.operation === 'create') {
    // Content was created in the workspace — it has _workspace field.
    // To publish: remove the _workspace field so it becomes live content.
    const item = readContentFile(contentType, contentId);

    if (!item) {
      throw new Error(`Content "${contentId}" (type: ${contentType}) not found`);
    }

    // Remove workspace metadata to make it live content
    delete item._workspace;
    delete item._originalId;
    delete item._originalType;

    // Write back
    const filePath = join(contentDir, contentType, `${contentId}.json`);
    writeFileSync(filePath, JSON.stringify(item, null, 2) + '\n');

  } else {
    // Content was edited in the workspace — a workspace copy exists
    // with ID ws-{prefix}-{originalId}
    const workspaceCopyId = `ws-${wsPrefix}-${contentId}`;

    // Read the workspace copy
    const workspaceCopy = readContentFile(contentType, workspaceCopyId);

    if (!workspaceCopy) {
      throw new Error(`Workspace copy "${workspaceCopyId}" not found for content "${contentId}"`);
    }

    // Read the current live version for merge
    const currentLive = readContentFile(contentType, contentId);

    /**
     * MERGE NON-CONFLICTING CHANGES
     *
     * WHY MERGE:
     * When a workspace edits field A and live edits field B of the same content,
     * both changes should be preserved on publish. A full overwrite would lose
     * the live changes to field B. This follows Drupal's workspaces module
     * approach of automatic merge for non-conflicting field-level changes.
     *
     * STRATEGY (three-way merge):
     * 1. Find the ORIGINAL BASELINE — the content as it existed when the
     *    workspace copy was first created (using revision history)
     * 2. Diff workspace copy vs baseline → identify workspace-changed fields
     * 3. Start with current live content (preserves all live-side changes)
     * 4. Overlay ONLY workspace-changed fields on top
     * 5. Result: merged content with both sets of changes preserved
     *
     * For conflicting fields (both workspace and live changed the same field),
     * workspace version wins — the user was already warned by conflict detection
     * and chose to publish anyway (or there were no true conflicts).
     */
    let mergedContent;

    if (currentLive) {
      // Metadata fields that should not participate in merge comparison
      const metaFields = new Set([
        'id', '_workspace', '_originalId', '_originalType',
        'updated', 'created', 'revisions',
      ]);

      /**
       * Find the original baseline from revision history.
       *
       * WHY REVISIONS:
       * The workspace copy was created at a specific point in time. The revision
       * closest to (but not after) the association timestamp represents the content
       * state when the workspace copy was branched. By comparing the workspace copy
       * against this baseline, we can determine exactly which fields the workspace
       * user actually changed, vs fields that were inherited unchanged from the original.
       */
      let baseline = null;
      const revisionsDir = join(contentDir, contentType, '.revisions', contentId);
      if (existsSync(revisionsDir)) {
        try {
          const revFiles = readdirSync(revisionsDir)
            .filter(f => f.endsWith('.json'))
            .sort(); // Chronological order

          // Find the revision closest to (at or before) the workspace association timestamp
          const assocTime = new Date(association.timestamp).getTime();
          let bestRevFile = null;
          for (const rf of revFiles) {
            // Revision filename is a timestamp like 2026-02-08T02-37-35.551Z.json
            const revTimestamp = rf.replace('.json', '').replace(/-/g, (m, offset) => {
              // Convert filename back to ISO timestamp for comparison:
              // 2026-02-08T02-37-35.551Z → 2026-02-08T02:37:35.551Z
              // Hyphens in date part (positions 4,7) stay as hyphens
              // Hyphens in time part become colons
              return offset > 9 ? ':' : m;
            });
            const revTime = new Date(revTimestamp).getTime();
            if (!isNaN(revTime) && revTime <= assocTime) {
              bestRevFile = rf;
            }
          }
          if (bestRevFile) {
            const revPath = join(revisionsDir, bestRevFile);
            baseline = JSON.parse(readFileSync(revPath, 'utf-8'));
          }
        } catch {
          // If revision lookup fails, fall through to non-baseline merge
        }
      }

      // Start with current live content (preserves any live-side changes)
      mergedContent = { ...currentLive };

      if (baseline) {
        // THREE-WAY MERGE: Compare workspace copy against baseline to find
        // which fields the workspace actually changed, then apply only those.
        for (const key of Object.keys(workspaceCopy)) {
          if (metaFields.has(key)) continue;

          const wsVal = JSON.stringify(workspaceCopy[key]);
          const baseVal = JSON.stringify(baseline[key]);

          // If workspace value differs from baseline, the workspace changed this field
          if (wsVal !== baseVal) {
            mergedContent[key] = workspaceCopy[key];
          }
          // If workspace value == baseline value, workspace didn't change it.
          // Keep the current live version (which may have been updated independently).
        }

        // Also check for fields that exist in workspace copy but not in baseline
        // (new fields added by workspace)
        for (const key of Object.keys(workspaceCopy)) {
          if (metaFields.has(key)) continue;
          if (!(key in baseline)) {
            mergedContent[key] = workspaceCopy[key];
          }
        }
      } else {
        // No baseline found — fall back to simple workspace-wins-on-diff merge.
        // This is less precise but still better than full overwrite.
        for (const key of Object.keys(workspaceCopy)) {
          if (metaFields.has(key)) continue;

          const wsVal = JSON.stringify(workspaceCopy[key]);
          const liveVal = JSON.stringify(currentLive[key]);

          if (wsVal !== liveVal) {
            mergedContent[key] = workspaceCopy[key];
          }
        }
      }
    } else {
      // No live version exists (edge case) — use workspace copy as-is
      mergedContent = { ...workspaceCopy };
    }

    // Restore correct metadata
    mergedContent.id = contentId;
    delete mergedContent._workspace;
    delete mergedContent._originalId;
    delete mergedContent._originalType;
    mergedContent.updated = new Date().toISOString();

    // Write merged content to live
    const livePath = join(contentDir, contentType, `${contentId}.json`);
    writeFileSync(livePath, JSON.stringify(mergedContent, null, 2) + '\n');

    // Delete the workspace copy
    const copyPath = join(contentDir, contentType, `${workspaceCopyId}.json`);
    if (existsSync(copyPath)) {
      unlinkSync(copyPath);
    }
  }

  // Activity log
  logActivity(workspace.id, 'workspace.publish_content', {
    contentType,
    contentId,
  }, user);

  // Remove the content association from the workspace
  removeContentAssociation(workspace.id, contentType, contentId);

  // Emit hook
  if (hooksModule) {
    try {
      await hooksModule.emit('workspace:contentPublished', {
        workspaceId: workspace.id,
        workspaceLabel: workspace.label,
        contentType,
        contentId,
        operation: association.operation,
      });
    } catch (e) {
      // Non-blocking
    }
  }

  // Audit log
  if (auditModule && typeof auditModule.log === 'function') {
    auditModule.log('workspace.publishContent', {
      workspaceId: workspace.id,
      workspaceLabel: workspace.label,
      contentType,
      contentId,
      operation: association.operation,
      userId: user?.id,
    });
  }

  return {
    published: true,
    workspaceId: workspace.id,
    workspaceLabel: workspace.label,
    contentType,
    contentId,
    operation: association.operation,
  };
}

// ============================================================================
// Publish Entire Workspace
// ============================================================================

/**
 * Publish an entire workspace to live.
 *
 * WHY BULK PUBLISH:
 * Drupal's workspaces module supports publishing all workspace changes
 * at once. This is the primary workflow: make changes in a staging
 * workspace, review them, then deploy everything to live in one operation.
 *
 * FLOW:
 * 1. Get all associations for the workspace
 * 2. Optionally validate for conflicts (if validateConflicts=true)
 * 3. Publish each associated content item using publishContent()
 * 4. Clear all workspace associations
 * 5. Workspace still exists but is empty (can be reused or deleted)
 *
 * @param {string} workspaceId - Workspace UUID or machine name
 * @param {Object} [options] - Options
 * @param {boolean} [options.validateConflicts=true] - Check for conflicts before publishing
 * @param {Object} [user] - User performing the action (for permission check)
 * @returns {Object} Result with published items count and details
 * @throws {Error} If workspace not found, permission denied, or conflicts detected
 */
export async function publishWorkspace(workspaceId, options = {}, user = null) {
  const validateConflicts = options.validateConflicts !== false;

  // Permission check
  if (user && permissionsModule) {
    const allowed = await checkPermission(user, 'publish');
    if (!allowed) {
      const err = new Error('Permission denied: workspace.publish');
      err.code = 'PERMISSION_DENIED';
      err.status = 403;
      throw err;
    }
  }

  // Resolve workspace
  const workspace = resolveWorkspace(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  // Get all associations
  const associations = getAssociations(workspace.id);
  if (!associations.items || associations.items.length === 0) {
    return {
      published: true,
      workspaceId: workspace.id,
      workspaceLabel: workspace.label,
      itemCount: 0,
      items: [],
      message: 'Workspace has no content to publish',
    };
  }

  // Validate for conflicts if requested
  if (validateConflicts) {
    const conflicts = detectConflicts(workspace.id);
    if (conflicts.length > 0) {
      const err = new Error(
        `Cannot publish workspace "${workspace.label}": ${conflicts.length} conflict(s) detected. ` +
        `Use workspace:conflicts to view details, or publish with --force to skip validation.`
      );
      err.code = 'WORKSPACE_CONFLICTS';
      err.status = 409;
      err.conflicts = conflicts;
      throw err;
    }
  }

  // Publish each content item
  const results = [];
  const errors = [];

  for (const association of [...associations.items]) {
    try {
      const result = await publishContent(workspace.id, association.id, user);
      results.push(result);
    } catch (err) {
      errors.push({
        contentId: association.id,
        contentType: association.type,
        error: err.message,
      });
    }
  }

  // Emit hook
  if (hooksModule) {
    try {
      await hooksModule.emit('workspace:published', {
        workspaceId: workspace.id,
        workspaceLabel: workspace.label,
        publishedCount: results.length,
        errorCount: errors.length,
      });
    } catch (e) {
      // Non-blocking
    }
  }

  // Audit log
  if (auditModule && typeof auditModule.log === 'function') {
    auditModule.log('workspace.publish', {
      workspaceId: workspace.id,
      workspaceLabel: workspace.label,
      publishedCount: results.length,
      errorCount: errors.length,
      userId: user?.id,
    });
  }

  // Activity log
  logActivity(workspace.id, 'workspace.publish', {
    itemCount: results.length,
    errorCount: errors.length,
  }, user);

  return {
    published: true,
    workspaceId: workspace.id,
    workspaceLabel: workspace.label,
    itemCount: results.length,
    items: results,
    errors: errors.length > 0 ? errors : undefined,
    message: errors.length > 0
      ? `Published ${results.length} items with ${errors.length} error(s)`
      : `Successfully published ${results.length} item(s) to live`,
  };
}

// ============================================================================
// Conflict Detection
// ============================================================================

/**
 * Detect conflicts between workspace content and live content.
 *
 * WHY CONFLICT DETECTION:
 * When a workspace has edits to content that was also modified in live
 * (after the workspace copy was created), publishing would overwrite
 * those live changes. Conflict detection warns the user before this
 * data loss occurs.
 *
 * DETECTION METHOD:
 * For each 'edit' association in the workspace:
 * 1. Read the workspace copy (ws-{prefix}-{originalId})
 * 2. Read the live version
 * 3. Compare the 'updated' timestamps: if live was updated AFTER the
 *    workspace copy was created, there's a potential conflict
 * 4. Optionally compare individual field values for specificity
 *
 * @param {string} workspaceId - Workspace UUID or machine name
 * @returns {Array} Array of conflict objects, empty if no conflicts
 */
export function detectConflicts(workspaceId) {
  const workspace = resolveWorkspace(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  const associations = getAssociations(workspace.id);
  if (!associations.items || associations.items.length === 0) {
    return [];
  }

  const conflicts = [];
  const wsPrefix = workspace.id.substring(0, 8);
  const contentDir = join(baseDir, 'content');

  for (const association of associations.items) {
    // Only edits can conflict (creates are new content, no live version to conflict with)
    if (association.operation !== 'edit') {
      continue;
    }

    const contentType = association.type;
    const contentId = association.id;
    const workspaceCopyId = `ws-${wsPrefix}-${contentId}`;

    // Read workspace copy
    const wsCopyPath = join(contentDir, contentType, `${workspaceCopyId}.json`);
    if (!existsSync(wsCopyPath)) continue;

    let wsCopy;
    try {
      wsCopy = JSON.parse(readFileSync(wsCopyPath, 'utf-8'));
    } catch {
      continue;
    }

    // Read live version
    const livePath = join(contentDir, contentType, `${contentId}.json`);
    if (!existsSync(livePath)) continue;

    let liveContent;
    try {
      liveContent = JSON.parse(readFileSync(livePath, 'utf-8'));
    } catch {
      continue;
    }

    // Compare timestamps: if live was modified after the workspace copy was created,
    // there's a potential conflict
    const wsCreatedAt = new Date(association.timestamp);
    const liveUpdatedAt = new Date(liveContent.updated || liveContent.created);

    if (liveUpdatedAt > wsCreatedAt) {
      // Live content was modified after the workspace copy was created
      // Identify conflicting fields
      const conflictingFields = findConflictingFields(wsCopy, liveContent);

      conflicts.push({
        contentType,
        contentId,
        workspaceCopyId,
        workspaceModified: wsCopy.updated || wsCopy.created,
        liveModified: liveContent.updated || liveContent.created,
        workspaceAssociatedAt: association.timestamp,
        conflictingFields,
        message: `Content "${contentId}" (${contentType}) was modified in live after workspace copy was created`,
      });
    }
  }

  return conflicts;
}

/**
 * Find which fields differ between workspace copy and live content.
 *
 * WHY FIELD-LEVEL DIFF:
 * Knowing which specific fields conflict helps users make informed
 * decisions about which version to keep. This follows Drupal's approach
 * of showing field-level differences in content moderation.
 *
 * @param {Object} wsCopy - Workspace copy of content
 * @param {Object} liveContent - Live version of content
 * @returns {Array} Array of { field, workspaceValue, liveValue }
 */
function findConflictingFields(wsCopy, liveContent) {
  const conflicts = [];
  // Skip metadata fields that are expected to differ
  const skipFields = new Set([
    'id', '_workspace', '_originalId', '_originalType',
    'updated', 'created', 'revisions',
  ]);

  // Compare all fields in the workspace copy against live
  const allKeys = new Set([
    ...Object.keys(wsCopy),
    ...Object.keys(liveContent),
  ]);

  for (const key of allKeys) {
    if (skipFields.has(key)) continue;

    const wsVal = wsCopy[key];
    const liveVal = liveContent[key];

    // Deep comparison
    const wsStr = JSON.stringify(wsVal);
    const liveStr = JSON.stringify(liveVal);

    if (wsStr !== liveStr) {
      conflicts.push({
        field: key,
        workspaceValue: wsVal,
        liveValue: liveVal,
      });
    }
  }

  return conflicts;
}

// ============================================================================
// Workspace Diff
// ============================================================================

/**
 * Generate a diff between workspace content and live content.
 *
 * WHY DIFF:
 * Users need to see what changes exist in a workspace before publishing.
 * Shows modified, added, and deleted content items with field-level diffs.
 *
 * @param {string} workspaceId - Workspace UUID or machine name
 * @returns {Object} Diff result with items array and summary
 * @throws {Error} If workspace not found
 */
export function diffWorkspace(workspaceId) {
  const workspace = resolveWorkspace(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  const associations = getAssociations(workspace.id);
  if (!associations.items || associations.items.length === 0) {
    return {
      workspaceId: workspace.id,
      workspaceLabel: workspace.label,
      items: [],
      summary: { added: 0, modified: 0, deleted: 0, total: 0 },
    };
  }

  const wsPrefix = workspace.id.substring(0, 8);
  const contentDir = join(baseDir, 'content');
  const diffItems = [];
  let added = 0;
  let modified = 0;
  let deleted = 0;

  function readContentFile(type, id) {
    const filePath = join(contentDir, type, `${id}.json`);
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch {
      return null;
    }
  }

  const skipFields = new Set([
    'id', '_workspace', '_originalId', '_originalType',
    'updated', 'created', 'revisions',
  ]);

  for (const association of associations.items) {
    const { type: contentType, id: contentId, operation, timestamp } = association;

    if (operation === 'create') {
      const item = readContentFile(contentType, contentId);
      const fields = [];
      if (item) {
        for (const [key, value] of Object.entries(item)) {
          if (skipFields.has(key)) continue;
          fields.push({ field: key, change: 'added', newValue: value });
        }
      }
      diffItems.push({
        contentType, contentId, operation: 'added',
        title: item?.title || contentId, timestamp, fields,
      });
      added++;
    } else if (operation === 'edit') {
      const workspaceCopyId = `ws-${wsPrefix}-${contentId}`;
      const wsCopy = readContentFile(contentType, workspaceCopyId);
      const liveContent = readContentFile(contentType, contentId);
      if (!wsCopy) continue;

      const fields = [];
      if (liveContent) {
        const allKeys = new Set([...Object.keys(wsCopy), ...Object.keys(liveContent)]);
        for (const key of allKeys) {
          if (skipFields.has(key)) continue;
          const wsVal = wsCopy[key];
          const liveVal = liveContent[key];
          if (JSON.stringify(wsVal) !== JSON.stringify(liveVal)) {
            if (liveVal === undefined) {
              fields.push({ field: key, change: 'added', newValue: wsVal });
            } else if (wsVal === undefined) {
              fields.push({ field: key, change: 'removed', oldValue: liveVal });
            } else {
              fields.push({ field: key, change: 'modified', oldValue: liveVal, newValue: wsVal });
            }
          }
        }
      } else {
        for (const [key, value] of Object.entries(wsCopy)) {
          if (skipFields.has(key)) continue;
          fields.push({ field: key, change: 'added', newValue: value });
        }
      }
      diffItems.push({
        contentType, contentId, operation: 'modified',
        title: wsCopy?.title || liveContent?.title || contentId, timestamp, fields,
      });
      modified++;
    } else if (operation === 'delete') {
      const liveContent = readContentFile(contentType, contentId);
      const fields = [];
      if (liveContent) {
        for (const [key, value] of Object.entries(liveContent)) {
          if (skipFields.has(key)) continue;
          fields.push({ field: key, change: 'removed', oldValue: value });
        }
      }
      diffItems.push({
        contentType, contentId, operation: 'deleted',
        title: liveContent?.title || contentId, timestamp, fields,
      });
      deleted++;
    }
  }

  return {
    workspaceId: workspace.id,
    workspaceLabel: workspace.label,
    items: diffItems,
    summary: { added, modified, deleted, total: diffItems.length },
  };
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register REST API routes for workspace management.
 *
 * @param {Object} router - Router module
 * @param {Object} auth - Auth module for route protection
 */
export function registerRoutes(router, auth) {
  // GET /api/workspaces - List all workspaces
  router.register('GET', '/api/workspaces', async (req, res) => {
    const status = req.query?.status;
    const workspaces = list({ status });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: workspaces, count: workspaces.length }));
  });

  // POST /api/workspaces - Create workspace
  router.register('POST', '/api/workspaces', async (req, res) => {
    try {
      const body = await parseBody(req);
      const user = req.user || null;
      const workspace = await create(body, user);

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: workspace }));
    } catch (err) {
      const status = err.status || 400;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  // GET /api/workspaces/:id - Get workspace
  router.register('GET', '/api/workspaces/:id', async (req, res) => {
    const workspace = resolveWorkspace(req.params.id);
    if (!workspace) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Workspace not found' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: workspace }));
  });

  // PUT /api/workspaces/:id - Update workspace
  router.register('PUT', '/api/workspaces/:id', async (req, res) => {
    try {
      const body = await parseBody(req);
      const user = req.user || null;
      const workspace = resolveWorkspace(req.params.id);

      if (!workspace) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Workspace not found' }));
        return;
      }

      const updated = await update(workspace.id, body, user);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: updated }));
    } catch (err) {
      const status = err.status || 400;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  // DELETE /api/workspaces/:id - Delete workspace
  router.register('DELETE', '/api/workspaces/:id', async (req, res) => {
    try {
      const user = req.user || null;
      const workspace = resolveWorkspace(req.params.id);

      if (!workspace) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Workspace not found' }));
        return;
      }

      const result = await remove(workspace.id, user);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, deleted: workspace.id, removedAssociations: result.removedAssociations }));
    } catch (err) {
      const status = err.status || 400;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  // GET /api/workspaces/:id/permissions - Get user permissions for workspace
  router.register('GET', '/api/workspaces/:id/permissions', async (req, res) => {
    const user = req.user || null;
    const perms = await getUserPermissions(user);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: perms }));
  });

  // POST /api/workspaces/:id/publish - Publish entire workspace to live
  router.register('POST', '/api/workspaces/:id/publish', async (req, res) => {
    try {
      const user = req.user || null;
      const workspace = resolveWorkspace(req.params.id);

      if (!workspace) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Workspace not found' }));
        return;
      }

      const body = await parseBody(req);
      const force = body.force === true;

      const result = await publishWorkspace(workspace.id, {
        validateConflicts: !force,
      }, user);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: result }));
    } catch (err) {
      const status = err.status || 400;
      const response = { error: err.message };
      if (err.conflicts) {
        response.conflicts = err.conflicts;
      }
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    }
  });

  // GET /api/workspaces/:id/conflicts - Detect conflicts
  router.register('GET', '/api/workspaces/:id/conflicts', async (req, res) => {
    try {
      const workspace = resolveWorkspace(req.params.id);

      if (!workspace) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Workspace not found' }));
        return;
      }

      const conflicts = detectConflicts(workspace.id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: conflicts, count: conflicts.length, hasConflicts: conflicts.length > 0 }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  // GET /api/workspaces/:id/diff - Diff workspace content against live
  router.register('GET', '/api/workspaces/:id/diff', async (req, res) => {
    try {
      const workspace = resolveWorkspace(req.params.id);

      if (!workspace) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Workspace not found' }));
        return;
      }

      const diff = diffWorkspace(workspace.id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: diff }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  // GET /api/workspaces/:id/activity - Get workspace activity log
  router.register('GET', '/api/workspaces/:id/activity', async (req, res) => {
    try {
      const workspace = resolveWorkspace(req.params.id);

      if (!workspace) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Workspace not found' }));
        return;
      }

      const limit = req.query?.limit ? parseInt(req.query.limit, 10) : 50;
      const action = req.query?.action || null;

      const log = getActivityLog(workspace.id, { limit, action });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: log, count: log.length, workspaceId: workspace.id, workspaceLabel: workspace.label }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  // GET /api/workspaces/:id/analytics - Workspace analytics
  router.register('GET', '/api/workspaces/:id/analytics', async (req, res) => {
    try {
      const analytics = getWorkspaceAnalytics(req.params.id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: analytics }));
    } catch (err) {
      const status = err.message.includes('not found') ? 404 : 400;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

/**
 * Parse request body as JSON.
 *
 * @param {Object} req - HTTP request
 * @returns {Object} Parsed body
 */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    // If body already parsed by middleware
    if (req.body) {
      resolve(req.body);
      return;
    }

    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// ============================================================================
// Service API (for other modules)
// ============================================================================

/**
 * Log an activity entry for a workspace.
 *
 * WHY PER-WORKSPACE LOGS:
 * Follows Drupal's pattern where workspace-scoped actions are tracked
 * independently. This enables viewing activity for a specific workspace
 * without scanning global logs.
 *
 * @param {string} workspaceId - Workspace UUID
 * @param {string} action - Action type (e.g. 'content.create', 'workspace.publish')
 * @param {Object} [details] - Action-specific details
 * @param {Object} [user] - User who performed the action
 */
export function logActivity(workspaceId, action, details = {}, user = null) {
  if (!activityDir) return;

  const entry = {
    timestamp: new Date().toISOString(),
    action,
    user: user ? { id: user.id, name: user.name || user.username || user.id } : null,
    details,
  };

  const filePath = join(activityDir, `${workspaceId}.json`);
  let log = [];

  if (existsSync(filePath)) {
    try {
      log = JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch {
      log = [];
    }
  }

  // Prepend newest entry (reverse chronological)
  log.unshift(entry);

  // Cap at 1000 entries per workspace to prevent unbounded growth
  if (log.length > 1000) {
    log = log.slice(0, 1000);
  }

  writeFileSync(filePath, JSON.stringify(log, null, 2) + '\n');
}

/**
 * Get the activity log for a workspace.
 *
 * @param {string} workspaceId - Workspace UUID or machine name
 * @param {Object} [options] - Filter options
 * @param {number} [options.limit] - Max entries to return (default: 50)
 * @param {string} [options.action] - Filter by action type
 * @returns {Array} Activity log entries
 */
export function getActivityLog(workspaceId, options = {}) {
  const workspace = resolveWorkspace(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  if (!activityDir) return [];

  const filePath = join(activityDir, `${workspace.id}.json`);
  if (!existsSync(filePath)) return [];

  let log;
  try {
    log = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return [];
  }

  // Filter by action type if specified
  if (options.action) {
    log = log.filter(entry => entry.action === options.action);
  }

  // Apply limit (default 50)
  const limit = options.limit || 50;
  return log.slice(0, limit);
}

/**
 * Get the count of workspaces by status.
 *
 * @returns {Object} { active: number, archived: number, total: number }
 */
export function getStats() {
  let active = 0;
  let archived = 0;

  for (const ws of workspaceCache.values()) {
    if (ws.status === 'active') active++;
    else archived++;
  }

  return { active, archived, total: workspaceCache.size };
}

/**
 * Get detailed analytics for a specific workspace.
 *
 * WHY ANALYTICS:
 * Provides stakeholders with insights into workspace activity:
 * - How many changes have been staged
 * - How old the workspace is (helps identify stale workspaces)
 * - Which content types are affected (impact assessment)
 * - Activity frequency (is the workspace actively used?)
 *
 * Follows Drupal's workspace analytics pattern for monitoring
 * staging environments before publication.
 *
 * @param {string} workspaceId - Workspace UUID or machine name
 * @returns {Object} Analytics data including change count, age, content type breakdown
 * @throws {Error} If workspace not found
 */
export function getWorkspaceAnalytics(workspaceId) {
  const workspace = resolveWorkspace(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  // --- Change count ---
  const associations = getAssociations(workspace.id);
  const items = associations.items || [];
  const changeCount = items.length;

  // --- Workspace age ---
  const created = new Date(workspace.created);
  const now = new Date();
  const ageMs = now - created;
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
  const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
  const ageMinutes = Math.floor(ageMs / (1000 * 60));

  // Human-readable age string
  let ageDisplay;
  if (ageDays > 0) {
    ageDisplay = `${ageDays} day${ageDays !== 1 ? 's' : ''}`;
  } else if (ageHours > 0) {
    ageDisplay = `${ageHours} hour${ageHours !== 1 ? 's' : ''}`;
  } else {
    ageDisplay = `${ageMinutes} minute${ageMinutes !== 1 ? 's' : ''}`;
  }

  // --- Content type breakdown ---
  // Group associations by content type with operation counts
  const typeBreakdown = {};
  for (const item of items) {
    const type = item.type || 'unknown';
    if (!typeBreakdown[type]) {
      typeBreakdown[type] = {
        type,
        count: 0,
        operations: { create: 0, edit: 0 },
        latestChange: null,
      };
    }
    typeBreakdown[type].count++;
    const op = item.operation || 'edit';
    if (typeBreakdown[type].operations[op] !== undefined) {
      typeBreakdown[type].operations[op]++;
    } else {
      typeBreakdown[type].operations[op] = 1;
    }
    // Track latest change timestamp per type
    if (item.timestamp) {
      if (!typeBreakdown[type].latestChange || item.timestamp > typeBreakdown[type].latestChange) {
        typeBreakdown[type].latestChange = item.timestamp;
      }
    }
  }

  // Convert to sorted array (most changes first)
  const contentTypeBreakdown = Object.values(typeBreakdown)
    .sort((a, b) => b.count - a.count);

  // --- Activity summary from log ---
  let activityCount = 0;
  let latestActivity = null;
  let oldestActivity = null;
  const activityTypes = {};

  try {
    const log = getActivityLog(workspace.id, { limit: 1000 });
    activityCount = log.length;

    if (log.length > 0) {
      latestActivity = log[0].timestamp;
      oldestActivity = log[log.length - 1].timestamp;

      // Count activity types
      for (const entry of log) {
        const action = entry.action || 'unknown';
        activityTypes[action] = (activityTypes[action] || 0) + 1;
      }
    }
  } catch {
    // Activity log may not exist yet
  }

  // --- Staleness indicator ---
  // A workspace is considered stale if it has no activity for 7+ days
  let isStale = false;
  let daysSinceLastActivity = null;
  if (latestActivity) {
    const lastActivityDate = new Date(latestActivity);
    daysSinceLastActivity = Math.floor((now - lastActivityDate) / (1000 * 60 * 60 * 24));
    isStale = daysSinceLastActivity >= 7;
  } else {
    // No activity recorded, use creation date
    daysSinceLastActivity = ageDays;
    isStale = ageDays >= 7;
  }

  // --- Children workspaces ---
  const children = getChildren(workspace.id);

  return {
    workspace: {
      id: workspace.id,
      label: workspace.label,
      machineName: workspace.machineName,
      status: workspace.status,
      created: workspace.created,
      updated: workspace.updated,
      parent: workspace.parent || null,
      description: workspace.description || '',
    },
    changeCount,
    age: {
      days: ageDays,
      hours: ageHours,
      minutes: ageMinutes,
      display: ageDisplay,
      created: workspace.created,
    },
    contentTypeBreakdown,
    activity: {
      totalActions: activityCount,
      latestActivity,
      oldestActivity,
      actionBreakdown: activityTypes,
    },
    staleness: {
      isStale,
      daysSinceLastActivity,
    },
    children: children.map(c => ({
      id: c.id,
      label: c.label,
      machineName: c.machineName,
    })),
    childrenCount: children.length,
  };
}

/**
 * Check if the workspaces module is initialized.
 *
 * @returns {boolean}
 */
export function isInitialized() {
  return baseDir !== null;
}
