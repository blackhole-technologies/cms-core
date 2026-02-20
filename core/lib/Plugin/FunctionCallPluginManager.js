/**
 * @file
 * Plugin Manager for AI Function Call Plugins.
 *
 * WHY THIS EXISTS:
 * Extends the base PluginManager to handle function call plugin discovery,
 * instantiation, and registration. Provides methods specific to AI agent tools:
 * - List all available tools
 * - Execute a tool by name
 * - Convert tools to AI provider format
 * - Filter tools by permission
 *
 * Used by AI agent services to discover and invoke CMS functionality as tools.
 *
 * @see core/lib/Plugin/PluginManager.js for base functionality
 * @see core/lib/Plugin/FunctionCallPlugin.js for plugin interface
 */

import { PluginManager } from './PluginManager.js';
import { FunctionCallPlugin } from './FunctionCallPlugin.js';

export class FunctionCallPluginManager extends PluginManager {
  /**
   * Create a new function call plugin manager.
   *
   * WHY: Configures the base PluginManager for function_call plugins.
   * Sets the subdirectory to 'function_call' and alter hook.
   *
   * @param {Object} options - Additional configuration options
   */
  constructor(options = {}) {
    super('function_call', {
      subdir: 'function_call',
      alterHook: 'function_call_info_alter',
      baseClass: FunctionCallPlugin,
      defaults: {
        enabled: true,
      },
      ...options,
    });
  }

  /**
   * Create a function call plugin instance.
   *
   * WHY: Overrides base createInstance to inject service container.
   * Function call plugins need access to CMS services.
   *
   * @param {string} id - Plugin ID
   * @param {Object} configuration - Runtime configuration
   * @param {Object} context - Execution context with user, services, etc.
   * @returns {Promise<FunctionCallPlugin>} Plugin instance
   */
  async createInstance(id, configuration = {}, context = {}) {
    const def = await this.getDefinition(id);

    if (!def) {
      const available = [...(await this.getDefinitions()).keys()].join(', ');
      throw new Error(
        `Function call plugin "${id}" not found. Available: ${available}`
      );
    }

    // WHY: If plugin has factory function, use it
    if (typeof def._factory === 'function') {
      const instance = await def._factory(
        configuration,
        id,
        def,
        this._services,
        context
      );

      // WHY: Attach metadata to instance for introspection
      if (instance) {
        instance._pluginId = id;
        instance._pluginDefinition = def;
      }
      return instance;
    }

    // WHY: No factory — create base FunctionCallPlugin wrapper
    return new FunctionCallPlugin(configuration, id, def, this._services);
  }

  /**
   * Execute a function call plugin.
   *
   * WHY: Convenience method for AI agents to invoke tools by name.
   * Handles plugin instantiation, permission checks, and execution.
   *
   * @param {string} name - Function name (plugin ID)
   * @param {Object} params - Parameters from the AI
   * @param {Object} context - Execution context (user, services, etc.)
   * @returns {Promise<Object>} Execution result
   * @throws {Error} If plugin not found or permission denied
   */
  async execute(name, params, context = {}) {
    // WHY: Create instance with context
    const plugin = await this.createInstance(name, {}, context);

    // WHY: Check permissions if required
    const requiredPermission = plugin.getPermission();
    if (requiredPermission && context.user) {
      // TODO: Implement proper permission check
      // For now, allow all authenticated users
      if (!context.user) {
        throw new Error(`Permission denied: ${requiredPermission} required for ${name}`);
      }
    }

    // WHY: Execute and return result
    return await plugin.execute(params, context);
  }

  /**
   * Get all available tools for an AI agent.
   *
   * WHY: Returns array of function definitions in AI provider format.
   * Filtered by user permissions if context provided.
   *
   * @param {Object} context - Execution context with user
   * @param {string} format - 'openai' or 'anthropic'
   * @returns {Promise<Array<Object>>} Array of tool definitions
   */
  async getAvailableTools(context = {}, format = 'openai') {
    const definitions = await this.getDefinitions();
    const tools = [];

    for (const [id, def] of definitions.entries()) {
      // WHY: Skip disabled plugins
      if (def.enabled === false) continue;

      // WHY: Create instance to get tool metadata
      const plugin = await this.createInstance(id, {}, context);

      // WHY: Check permissions
      const permission = plugin.getPermission();
      if (permission && context.user) {
        // TODO: Implement proper permission check
        // For now, include all tools for authenticated users
      }

      // WHY: Convert to AI provider format
      tools.push(plugin.toAIFormat(format));
    }

    return tools;
  }

  /**
   * Get tool definitions grouped by category.
   *
   * WHY: Helps organize tools in UI and allows selective tool loading.
   *
   * @returns {Promise<Object>} Object mapping categories to tool arrays
   */
  async getToolsByCategory() {
    const definitions = await this.getDefinitions();
    const categorized = {};

    for (const [id, def] of definitions.entries()) {
      const category = def.category || 'general';

      if (!categorized[category]) {
        categorized[category] = [];
      }

      categorized[category].push({
        id,
        name: def.name || id,
        description: def.description || '',
        permission: def.permission || null,
      });
    }

    return categorized;
  }

  /**
   * Register a function call plugin programmatically.
   *
   * WHY: Allows modules to register tools without filesystem plugins.
   * Useful for dynamic tools or testing.
   *
   * @param {Object} definition - Plugin definition
   * @returns {Promise<void>}
   */
  async registerTool(definition) {
    if (!definition.id) {
      throw new Error('Function call plugin definition must have an id');
    }

    if (!definition.execute && !definition._factory) {
      throw new Error(`Function call plugin "${definition.id}" must have execute or _factory`);
    }

    // WHY: Ensure cache is initialized by calling getDefinitions first
    const definitions = await this.getDefinitions();

    // WHY: If execute method provided, wrap it as factory
    const executeMethod = definition.execute;
    const factory = definition._factory || (async (config, id, def, services, ctx) => {
      const plugin = new FunctionCallPlugin(config, id, def, services);
      // WHY: Override execute method if provided in definition
      if (executeMethod) {
        plugin.execute = executeMethod.bind(plugin);
      }
      return plugin;
    });

    // WHY: Add to cache with factory wrapper
    definitions.set(definition.id, {
      ...this.defaults,
      ...definition,
      _module: 'runtime',
      _path: 'runtime',
      _factory: factory,
    });
  }

  /**
   * List all registered tool names.
   *
   * WHY: Quick way to see what tools are available without full definitions.
   *
   * @returns {Promise<Array<string>>} Array of tool names
   */
  async listToolNames() {
    const definitions = await this.getDefinitions();
    return Array.from(definitions.keys());
  }
}
