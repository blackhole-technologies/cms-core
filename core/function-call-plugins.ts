/**
 * @file
 * FunctionCallPlugin Service - Central registry for AI agent tools
 *
 * WHY THIS EXISTS:
 * Provides a service for managing callable plugins that AI agents use as tools.
 * This service:
 * - Discovers callable plugins from all modules
 * - Provides tool registration API for modules
 * - Executes tools on behalf of AI agents
 * - Converts tools to AI provider formats (OpenAI, Anthropic)
 *
 * DESIGN PATTERN:
 * Service-based plugin management - plugins are discovered and registered
 * centrally, making them available to all AI agent implementations.
 */

// @ts-expect-error -- lib/Plugin is plain JS without declaration files
import { FunctionCallPluginManager } from './lib/Plugin/FunctionCallPluginManager.js';

// ============================================================================
// Types
// ============================================================================

/** Tool definition for registration */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  execute?: (params: Record<string, unknown>, context: ExecutionContext) => Promise<unknown>;
  [key: string]: unknown;
}

/** Context passed to tool execution */
export interface ExecutionContext {
  services?: ServiceContainer;
  user?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Service container interface */
interface ServiceContainer {
  get: (name: string) => unknown;
  [key: string]: unknown;
}

/** Hook manager interface */
interface HookManager {
  trigger: (name: string, data: Record<string, unknown>) => Promise<void>;
  register: (name: string, handler: (ctx: Record<string, unknown>) => void | Promise<void>) => void;
}

/** Boot context passed to init */
interface BootContext {
  modules?: string[];
  services?: ServiceContainer;
  hooks?: HookManager;
}

// ============================================================================
// State
// ============================================================================

/**
 * Plugin manager instance (singleton)
 */
let manager: InstanceType<typeof FunctionCallPluginManager> | null = null;

/**
 * Module paths for plugin discovery
 */
let modulePaths: string[] = [];

/**
 * Service container reference
 */
let services: ServiceContainer | null = null;

/**
 * Hook manager reference
 */
let hooks: HookManager | null = null;

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize the callable plugin service.
 *
 * WHY: Called during boot to set up infrastructure references.
 * Creates the plugin manager and wires it to the module system.
 *
 * @param context - Boot context with modules, services, hooks
 */
export function init(context: BootContext): void {
  modulePaths = context.modules || [];
  services = context.services || null;
  hooks = context.hooks || null;

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
 * @returns The plugin manager
 * @throws If not initialized
 */
export function getManager(): InstanceType<typeof FunctionCallPluginManager> {
  if (!manager) {
    throw new Error('Callable plugin service not initialized');
  }
  return manager;
}

/**
 * Register a callable plugin programmatically.
 *
 * WHY: Convenience method for modules to register tools.
 * Wraps the manager's registerTool method.
 *
 * @param definition - Plugin definition
 */
export async function registerTool(definition: ToolDefinition): Promise<void> {
  const mgr = getManager();
  return await mgr.registerTool(definition);
}

/**
 * Execute a callable plugin.
 *
 * WHY: Main entry point for AI agents to invoke tools.
 * Handles plugin lookup, permission checks, and execution.
 *
 * @param name - Tool name
 * @param params - Parameters from the AI
 * @param context - Execution context (user, services, etc.)
 * @returns Execution result
 */
export async function execute(name: string, params: Record<string, unknown>, context: ExecutionContext = {}): Promise<unknown> {
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
 * @param context - Execution context with user
 * @param format - 'openai' or 'anthropic'
 * @returns Array of tool definitions
 */
export async function getAvailableTools(context: ExecutionContext = {}, format: string = 'openai'): Promise<Array<Record<string, unknown>>> {
  const mgr = getManager();
  return await mgr.getAvailableTools(context, format);
}

/**
 * List all registered tool names.
 *
 * WHY: Quick way to see what tools are available.
 * Useful for debugging and CLI commands.
 *
 * @returns Array of tool names
 */
export async function listToolNames(): Promise<string[]> {
  const mgr = getManager();
  return await mgr.listToolNames();
}

/**
 * Get tool definitions grouped by category.
 *
 * WHY: Helps organize tools in UIs.
 *
 * @returns Object mapping categories to tool arrays
 */
export async function getToolsByCategory(): Promise<Record<string, unknown[]>> {
  const mgr = getManager();
  return await mgr.getToolsByCategory();
}

/**
 * Get all plugin definitions.
 *
 * WHY: Provides raw access to plugin definitions for advanced use cases.
 *
 * @returns Map of plugin ID to definition
 */
export async function getDefinitions(): Promise<Map<string, unknown>> {
  const mgr = getManager();
  return await mgr.getDefinitions();
}
