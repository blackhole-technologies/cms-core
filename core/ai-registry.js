/**
 * ai-registry.js - AI Module Registry Service
 *
 * WHY THIS EXISTS:
 * The CMS needs a centralized registry for AI-related modules (providers, tools, processors).
 * This service discovers AI modules, tracks their capabilities, and provides a unified
 * query interface for the AI dashboard and other components.
 *
 * DESIGN DECISIONS:
 * - Integrates with existing module discovery system
 * - Categorizes modules by AI type (provider, tool, processor, agent)
 * - Stores metadata about capabilities and status
 * - In-memory registry for fast lookups
 * - CLI commands for inspection and debugging
 *
 * USAGE:
 *   const aiRegistry = services.get('ai-registry');
 *   const providers = aiRegistry.getByType('provider');
 *   const module = aiRegistry.getModule('anthropic-provider');
 *   const all = aiRegistry.listAll();
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Service state
 */
let baseDir = null;
let initialized = false;

/**
 * AI module registry
 * Structure: Map<moduleName, moduleMetadata>
 *
 * WHY MAP INSTEAD OF OBJECT:
 * - Faster lookups for module queries
 * - Better iteration performance
 * - No prototype pollution issues
 */
const registry = new Map();

/**
 * Type index for fast queries by AI module type
 * Structure: Map<aiType, Set<moduleName>>
 */
const typeIndex = new Map();

/**
 * Initialize AI registry service
 *
 * @param {string} baseDirPath - Base directory for modules
 */
export function init(baseDirPath) {
  if (!baseDirPath) {
    throw new Error('[ai-registry] Base directory is required');
  }

  baseDir = baseDirPath;
  initialized = true;

  console.log('[ai-registry] Service initialized');
}

/**
 * Register an AI module in the registry
 *
 * WHY SEPARATE REGISTRATION:
 * - Allows modules to self-register during boot
 * - Decouples discovery from registration
 * - Enables dynamic registration (hot-reload, plugins)
 *
 * @param {Object} moduleInfo - Module information
 * @param {string} moduleInfo.name - Module name
 * @param {string} moduleInfo.type - AI type: provider|tool|processor|agent
 * @param {Object} moduleInfo.capabilities - Module capabilities
 * @param {string} moduleInfo.status - Status: active|inactive|error
 * @param {Object} moduleInfo.manifest - Full manifest.json content
 * @param {string} moduleInfo.path - Absolute path to module directory
 */
export function register(moduleInfo) {
  if (!initialized) {
    throw new Error('[ai-registry] Service not initialized. Call init() first.');
  }

  const { name, type, capabilities, status, manifest, path } = moduleInfo;

  // Validate required fields
  if (!name || !type) {
    console.error('[ai-registry] Cannot register module: name and type are required');
    return false;
  }

  // Validate AI type
  const validTypes = ['provider', 'tool', 'processor', 'agent'];
  if (!validTypes.includes(type)) {
    console.error(`[ai-registry] Invalid AI type "${type}". Must be one of: ${validTypes.join(', ')}`);
    return false;
  }

  // Store in registry
  registry.set(name, {
    name,
    type,
    capabilities: capabilities || {},
    status: status || 'active',
    manifest: manifest || {},
    path: path || null,
    registeredAt: new Date().toISOString(),
  });

  // Update type index
  if (!typeIndex.has(type)) {
    typeIndex.set(type, new Set());
  }
  typeIndex.get(type).add(name);

  console.log(`[ai-registry] Registered AI module: ${name} (${type})`);
  return true;
}

/**
 * Discover AI modules from the modules directory
 *
 * WHY SEPARATE FROM CORE DISCOVERY:
 * - AI modules have specific metadata requirements
 * - Need to extract AI-specific fields from manifest
 * - Allows filtering for AI capabilities
 *
 * This scans modules/ for any module with ai: true or aiType in manifest.json
 *
 * @param {Array} modules - Array of discovered modules from core/discovery.js
 */
export function discoverAIModules(modules) {
  if (!initialized) {
    throw new Error('[ai-registry] Service not initialized. Call init() first.');
  }

  let discovered = 0;

  for (const module of modules) {
    const { manifest, path, name } = module;

    // Check if module declares itself as AI-related
    // Looking for manifest.ai: true or manifest.aiType
    if (!manifest.ai && !manifest.aiType) {
      continue;
    }

    // Extract AI metadata
    const aiType = manifest.aiType || 'tool'; // Default to 'tool' if not specified
    const capabilities = manifest.aiCapabilities || manifest.capabilities || {};
    const status = manifest.disabled ? 'inactive' : 'active';

    // Register the AI module
    const registered = register({
      name,
      type: aiType,
      capabilities,
      status,
      manifest,
      path,
    });

    if (registered) {
      discovered++;
    }
  }

  console.log(`[ai-registry] Discovered ${discovered} AI modules`);
  return discovered;
}

/**
 * Get all registered AI modules
 *
 * @returns {Array} - Array of AI module metadata
 */
export function listAll() {
  return Array.from(registry.values());
}

/**
 * Get AI modules by type
 *
 * @param {string} type - AI type: provider|tool|processor|agent
 * @returns {Array} - Array of matching AI modules
 */
export function getByType(type) {
  const moduleNames = typeIndex.get(type);
  if (!moduleNames) {
    return [];
  }

  return Array.from(moduleNames).map(name => registry.get(name));
}

/**
 * Get a specific AI module by name
 *
 * @param {string} name - Module name
 * @returns {Object|null} - Module metadata or null if not found
 */
export function getModule(name) {
  return registry.get(name) || null;
}

/**
 * Get registry statistics
 *
 * @returns {Object} - Stats about registered AI modules
 */
export function getStats() {
  const stats = {
    total: registry.size,
    byType: {},
    byStatus: { active: 0, inactive: 0, error: 0 },
  };

  // Count by type
  for (const [type, moduleNames] of typeIndex.entries()) {
    stats.byType[type] = moduleNames.size;
  }

  // Count by status
  for (const module of registry.values()) {
    if (stats.byStatus[module.status] !== undefined) {
      stats.byStatus[module.status]++;
    }
  }

  return stats;
}

/**
 * Update the status of a registered AI module
 *
 * @param {string} name - Module name
 * @param {string} status - New status: active|inactive|error
 * @returns {boolean} - True if updated, false if module not found or invalid status
 */
export function updateStatus(name, status) {
  const module = registry.get(name);
  if (!module) {
    console.error(`[ai-registry] Cannot update status: module "${name}" not found`);
    return false;
  }

  const validStatuses = ['active', 'inactive', 'error'];
  if (!validStatuses.includes(status)) {
    console.error(`[ai-registry] Invalid status "${status}". Must be one of: ${validStatuses.join(', ')}`);
    return false;
  }

  module.status = status;
  console.log(`[ai-registry] Updated module "${name}" status to "${status}"`);
  return true;
}

/**
 * Check if a module is registered
 *
 * @param {string} name - Module name
 * @returns {boolean}
 */
export function has(name) {
  return registry.has(name);
}

/**
 * Clear the registry (mainly for testing)
 */
export function clear() {
  registry.clear();
  typeIndex.clear();
  console.log('[ai-registry] Registry cleared');
}

/**
 * Service name for registration
 */
export const name = 'ai-registry';
