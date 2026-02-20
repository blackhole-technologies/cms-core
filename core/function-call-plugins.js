/**
 * @file
 * Function Call Plugin Service - Central registry for AI agent tools
 *
 * WHY THIS EXISTS:
 * Provides a service for managing function call plugins that AI agents use as tools.
 * This service:
 * - Discovers function call plugins from all modules
 * - Provides tool registration API for modules
 * - Executes tools on behalf of AI agents
 * - Converts tools to AI provider formats (OpenAI, Anthropic)
 *
 * DESIGN PATTERN:
 * Service-based plugin management - plugins are discovered and registered
 * centrally, making them available to all AI agent implementations.
 */

import { FunctionCallPluginManager } from './lib/Plugin/FunctionCallPluginManager.js';

/**
 * Plugin manager instance (singleton)
 * @type {FunctionCallPluginManager|null}
 */
let manager = null;

/**
 * Module paths for plugin discovery
 * @type {Array}
 */
let modulePaths = [];

/**
 * Service container reference
 * @type {Object|null}
 */
let services = null;

/**
 * Hook manager reference
 * @type {Object|null}
 */
let hooks = null;

/**
 * Initialize the function call plugin service.
 *
 * WHY: Called during boot to set up infrastructure references.
 * Creates the plugin manager and wires it to the module system.
 *
 * @param {Object} context - Boot context with modules, services, hooks
 * @returns {void}
 */
export function init(context) {
  modulePaths = context.modules || [];
  services = context.services;
  hooks = context.hooks;

  // WHY: Create manager if not already created
  if (!manager) {
    manager = new FunctionCallPluginManager();

    // WHY: Wire infrastructure to manager
    if (manager.setInfrastructure) {
      manager.setInfrastructure(services, hooks, modulePaths);
    }
  }

  console.log('[function-call-plugins] Initialized');
}

/**
 * Get the plugin manager instance.
 *
 * WHY: Provides access to the manager for other services.
 *
 * @returns {FunctionCallPluginManager} The plugin manager
 * @throws {Error} If not initialized
 */
export function getManager() {
  if (!manager) {
    throw new Error('Function call plugin service not initialized');
  }
  return manager;
}

/**
 * Register a function call plugin programmatically.
 *
 * WHY: Convenience method for modules to register tools.
 * Wraps the manager's registerTool method.
 *
 * @param {Object} definition - Plugin definition
 * @returns {Promise<void>}
 */
export async function registerTool(definition) {
  const mgr = getManager();
  return await mgr.registerTool(definition);
}

/**
 * Execute a function call plugin.
 *
 * WHY: Main entry point for AI agents to invoke tools.
 * Handles plugin lookup, permission checks, and execution.
 *
 * @param {string} name - Function/tool name
 * @param {Object} params - Parameters from the AI
 * @param {Object} context - Execution context (user, services, etc.)
 * @returns {Promise<Object>} Execution result
 */
export async function execute(name, params, context = {}) {
  const mgr = getManager();

  // WHY: Inject services into context if not already present
  if (!context.services && services) {
    context.services = services;
  }

  return await mgr.execute(name, params, context);
}

/**
 * Get all available tools for an AI agent.
 *
 * WHY: Returns tools in the format expected by AI providers.
 * Used when initializing AI agent sessions.
 *
 * @param {Object} context - Execution context with user
 * @param {string} format - 'openai' or 'anthropic'
 * @returns {Promise<Array<Object>>} Array of tool definitions
 */
export async function getAvailableTools(context = {}, format = 'openai') {
  const mgr = getManager();
  return await mgr.getAvailableTools(context, format);
}

/**
 * List all registered tool names.
 *
 * WHY: Quick way to see what tools are available.
 * Useful for debugging and CLI commands.
 *
 * @returns {Promise<Array<string>>} Array of tool names
 */
export async function listToolNames() {
  const mgr = getManager();
  return await mgr.listToolNames();
}

/**
 * Get tool definitions grouped by category.
 *
 * WHY: Helps organize tools in UIs.
 *
 * @returns {Promise<Object>} Object mapping categories to tool arrays
 */
export async function getToolsByCategory() {
  const mgr = getManager();
  return await mgr.getToolsByCategory();
}

/**
 * Get all plugin definitions.
 *
 * WHY: Provides raw access to plugin definitions for advanced use cases.
 *
 * @returns {Promise<Map>} Map of plugin ID to definition
 */
export async function getDefinitions() {
  const mgr = getManager();
  return await mgr.getDefinitions();
}
