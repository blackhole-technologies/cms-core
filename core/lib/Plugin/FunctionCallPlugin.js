/**
 * @file
 * Base class for AI Function Call Plugins (AI Agent Tools).
 *
 * WHY THIS EXISTS:
 * AI agents need a standardized way to interact with CMS functionality.
 * Function call plugins provide a structured interface that maps directly
 * to AI provider function calling formats (Claude tools, GPT functions).
 *
 * Each plugin represents one tool the AI can invoke, with:
 * - name: Tool identifier sent to the AI model
 * - description: What the tool does (helps AI decide when to use it)
 * - parameters: JSON Schema defining expected parameters
 * - execute(): The actual implementation
 *
 * This extends PluginBase to inherit standard plugin metadata methods.
 *
 * @see .autoforge/templates/ai-function-call.js for usage examples
 */

import { PluginBase } from './PluginBase.js';

export class FunctionCallPlugin extends PluginBase {
  /**
   * Create a new function call plugin instance.
   *
   * WHY: Constructor accepts configuration, pluginId, and definition like all plugins.
   * Additionally accepts a serviceContainer reference for accessing CMS services.
   *
   * @param {Object} configuration - Runtime configuration for this instance
   * @param {string} pluginId - The plugin ID from the definition
   * @param {Object} pluginDefinition - The full plugin definition metadata
   * @param {Object} serviceContainer - DI container with CMS services
   */
  constructor(configuration = {}, pluginId = '', pluginDefinition = {}, serviceContainer = null) {
    super(configuration, pluginId, pluginDefinition);

    // WHY: Store service container so execute() can access CMS services
    /** @private */
    this._services = serviceContainer;
  }

  /**
   * Get the function name (tool identifier).
   *
   * WHY: This is the name sent to the AI model in the function calling request.
   * Defaults to pluginId but can be overridden in definition.
   *
   * @returns {string} The function name (e.g., 'create_content', 'list_users')
   */
  getName() {
    return this._pluginDefinition.name || this._pluginId;
  }

  /**
   * Get the function description.
   *
   * WHY: The AI model uses this to decide when to call this tool.
   * Should clearly explain what the function does and when to use it.
   *
   * @returns {string} Human-readable description
   */
  getDescription() {
    return this._pluginDefinition.description || '';
  }

  /**
   * Get the parameters schema.
   *
   * WHY: Defines the structure and types of parameters this function accepts.
   * Uses JSON Schema format compatible with OpenAI/Anthropic function calling.
   *
   * @returns {Object} JSON Schema object defining parameters
   */
  getParametersSchema() {
    return this._pluginDefinition.parameters || {
      type: 'object',
      properties: {},
    };
  }

  /**
   * Get required permission to execute this function.
   *
   * WHY: AI agents run with user permissions. Some tools should only be
   * available to users with specific permissions.
   *
   * @returns {string|null} Required permission string or null for no restriction
   */
  getPermission() {
    return this._pluginDefinition.permission || null;
  }

  /**
   * Execute the function call.
   *
   * WHY: This is where the actual tool logic lives. Receives validated parameters
   * from the AI and returns structured results.
   *
   * Base implementation throws - subclasses must override.
   *
   * @param {Object} params - Validated parameters from the AI
   * @param {Object} context - Execution context (user, services, etc.)
   * @returns {Promise<Object>} Result object to send back to the AI
   * @throws {Error} If not implemented by subclass
   */
  async execute(params, context) {
    throw new Error(
      `Function call plugin "${this.getName()}" must implement execute() method`
    );
  }

  /**
   * Get service container.
   *
   * WHY: Provides access to CMS services for subclasses.
   * Convenience method to avoid direct property access.
   *
   * @returns {Object|null} Service container or null
   */
  getServices() {
    return this._services;
  }

  /**
   * Convert to AI provider format (Claude/GPT).
   *
   * WHY: AI providers expect specific formats for function definitions.
   * This method generates the structure they need.
   *
   * @param {string} format - 'anthropic' or 'openai'
   * @returns {Object} Function definition in provider format
   */
  toAIFormat(format = 'openai') {
    const base = {
      name: this.getName(),
      description: this.getDescription(),
      parameters: this.getParametersSchema(),
    };

    if (format === 'anthropic') {
      // Anthropic Claude format (tools array)
      return {
        name: base.name,
        description: base.description,
        input_schema: base.parameters,
      };
    }

    // OpenAI format (functions array) - default
    return base;
  }
}
