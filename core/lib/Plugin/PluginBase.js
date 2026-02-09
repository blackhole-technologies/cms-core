/**
 * @file
 * Base class for all plugins in CMS-Core.
 *
 * WHY THIS EXISTS:
 * Provides standard interface for accessing plugin metadata and configuration.
 * Plugin authors can extend this class for class-based plugins, or use the
 * functional factory pattern — PluginManager supports both.
 *
 * Drupal equivalent: PluginBase.php
 *
 * @see .autoforge/templates/plugin-base.js for usage examples
 */

export class PluginBase {
  /**
   * Create a new plugin instance.
   *
   * WHY: Constructor signature matches what PluginManager passes to class-based plugins.
   * All three parameters are provided by PluginManager.createInstance().
   *
   * @param {Object} configuration - Runtime configuration for this instance
   * @param {string} pluginId - The plugin ID from the definition
   * @param {Object} pluginDefinition - The full plugin definition metadata
   */
  constructor(configuration = {}, pluginId = '', pluginDefinition = {}) {
    // WHY: Store as private properties to enforce access through getters
    // This allows subclasses to override getters if needed (rare but useful)
    /** @private */
    this._configuration = configuration;

    /** @private */
    this._pluginId = pluginId;

    /** @private */
    this._pluginDefinition = pluginDefinition;
  }

  /**
   * Get the plugin ID.
   *
   * WHY: Every plugin instance needs to know its ID for introspection,
   * logging, error messages, and hook dispatch.
   *
   * @returns {string} The plugin ID (e.g., 'string', 'text_textfield')
   */
  getPluginId() {
    return this._pluginId;
  }

  /**
   * Get the full plugin definition.
   *
   * WHY: Provides access to all metadata from the plugin's definition export:
   * label, description, category, default settings, etc. Useful for rendering
   * UIs that show available plugins or display plugin metadata.
   *
   * @returns {Object} The complete definition object
   */
  getPluginDefinition() {
    return this._pluginDefinition;
  }

  /**
   * Get the runtime configuration.
   *
   * WHY: Plugins need access to their instance-specific configuration.
   * For example, a text field plugin's maxLength setting, or a block's
   * visibility rules. This is the runtime config, not the default config
   * from the definition.
   *
   * @returns {Object} The configuration object
   */
  getConfiguration() {
    return this._configuration;
  }

  /**
   * Set a configuration value.
   *
   * WHY: Allows runtime reconfiguration of plugin instances. Returns this
   * for method chaining. Mutates the configuration object in place.
   *
   * @param {string} key - Configuration key
   * @param {*} value - New value
   * @returns {this} For method chaining
   */
  setConfiguration(key, value) {
    this._configuration[key] = value;
    return this;
  }

  /**
   * Build the configuration form for this plugin.
   *
   * WHY: Many plugins need settings forms (field types, blocks, formatters).
   * This provides a standard hook. Subclasses override to add their fields.
   * Returns a render array (FormAPI-compatible structure).
   *
   * @param {Object} form - Current form state
   * @returns {Object} Render array for the plugin's settings form
   */
  buildConfigurationForm(form = {}) {
    // WHY: Default implementation returns form unchanged. Subclasses add fields.
    return form;
  }

  /**
   * Validate the configuration form.
   *
   * WHY: Plugins can enforce constraints on their settings. Called before
   * submitConfigurationForm(). Subclasses add validation errors to formState.
   *
   * @param {Object} form - The form render array
   * @param {Object} formState - Form state with values and errors
   */
  validateConfigurationForm(form, formState) {
    // WHY: No-op by default. Override in subclass to add validation.
  }

  /**
   * Handle configuration form submission.
   *
   * WHY: Called after validation passes. Subclasses extract form values
   * and update this._configuration as needed.
   *
   * @param {Object} form - The form render array
   * @param {Object} formState - Form state with submitted values
   */
  submitConfigurationForm(form, formState) {
    // WHY: No-op by default. Override in subclass to process submission.
  }
}
