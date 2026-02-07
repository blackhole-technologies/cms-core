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

  // Ensure workspace storage directory exists
  workspacesDir = join(baseDir, 'config', 'workspaces');
  if (!existsSync(workspacesDir)) {
    mkdirSync(workspacesDir, { recursive: true });
  }

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
  const allowedFields = ['label', 'status', 'description', 'parent'];
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

  // Remove from disk
  const filePath = join(workspacesDir, `${id}.json`);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }

  // Remove from cache
  workspaceCache.delete(id);

  // Emit hook
  if (hooksModule) {
    try {
      await hooksModule.emit('workspace:deleted', { id, label: workspace.label });
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
    });
  }

  return true;
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
      const workspace = await create({
        label: label || machineName,
        machineName: machineName || undefined,
        description: options.description || options.d || '',
      });

      console.log(`\u2713 Workspace created: ${workspace.label}`);
      console.log(`  ID: ${workspace.id}`);
      console.log(`  Machine name: ${workspace.machineName}`);
      console.log(`  Status: ${workspace.status}`);
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
      console.log(`  ${ws.machineName} ${statusBadge}`);
      console.log(`    Label: ${ws.label}`);
      console.log(`    ID: ${ws.id}`);
      console.log(`    Created: ${ws.created}`);
      if (ws.description) {
        console.log(`    Description: ${ws.description}`);
      }
      console.log('');
    }

    return true;
  }, 'List all workspaces');

  // workspace:delete <id|machineName>
  register('workspace:delete', async (args) => {
    const { positional } = parseCliArgs(args);
    const identifier = positional[0];
    if (!identifier) {
      console.log('Usage: workspace:delete <id|machineName>');
      return false;
    }

    try {
      const workspace = resolveWorkspace(identifier);
      if (!workspace) {
        console.error(`\u2717 Workspace not found: ${identifier}`);
        return false;
      }

      await remove(workspace.id);
      console.log(`\u2713 Workspace deleted: ${workspace.label} (${workspace.id})`);
      return true;
    } catch (err) {
      console.error(`\u2717 Failed to delete workspace: ${err.message}`);
      return false;
    }
  }, 'Delete a workspace');

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

      await remove(workspace.id, user);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, deleted: workspace.id }));
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
 * Check if the workspaces module is initialized.
 *
 * @returns {boolean}
 */
export function isInitialized() {
  return baseDir !== null;
}
