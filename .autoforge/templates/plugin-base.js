/**
 * META-PATTERN TEMPLATE: PluginBase
 * ==================================
 * 
 * Drupal equivalent: PluginBase.php
 * 
 * Base class for all plugins. Provides standard access to plugin ID,
 * definition metadata, and runtime configuration. Plugin authors extend
 * this (or use the functional factory pattern — both are supported).
 * 
 * @example Class-based plugin (extend PluginBase)
 * ```javascript
 * // modules/mymod/plugins/block/WelcomeBlock.js
 * import { PluginBase } from '../../../../core/lib/Plugin/PluginBase.js';
 * 
 * export const definition = {
 *   id: 'welcome_block',
 *   label: 'Welcome Block',
 *   category: 'Content',
 * };
 * 
 * export default class WelcomeBlock extends PluginBase {
 *   build() {
 *     return {
 *       '#type': 'markup',
 *       '#markup': `<h2>Welcome, ${this.getConfiguration().username || 'Guest'}!</h2>`,
 *     };
 *   }
 * }
 * ```
 * 
 * @example Functional plugin (export factory function)
 * ```javascript
 * // modules/mymod/plugins/block/WelcomeBlock.js
 * export const definition = {
 *   id: 'welcome_block',
 *   label: 'Welcome Block',
 *   category: 'Content',
 * };
 * 
 * export default function create(configuration, pluginId, definition, services) {
 *   return {
 *     build() {
 *       return {
 *         '#type': 'markup',
 *         '#markup': `<h2>Welcome, ${configuration.username || 'Guest'}!</h2>`,
 *       };
 *     },
 *   };
 * }
 * ```
 * 
 * Both patterns are equivalent. Use whichever fits your style.
 * The PluginManager supports both — it calls the default export as a
 * constructor (if class) or function (if factory).
 */

export class PluginBase {
  /**
   * @param {Object} configuration - Runtime configuration for this instance
   * @param {string} pluginId - The plugin ID from the definition
   * @param {Object} pluginDefinition - The full plugin definition metadata
   */
  constructor(configuration = {}, pluginId = '', pluginDefinition = {}) {
    /** @private */
    this._configuration = configuration;
    /** @private */
    this._pluginId = pluginId;
    /** @private */
    this._pluginDefinition = pluginDefinition;
  }

  /**
   * Get the plugin ID.
   * @returns {string}
   */
  getPluginId() {
    return this._pluginId;
  }

  /**
   * Get the full plugin definition (metadata from the definition export).
   * @returns {Object}
   */
  getPluginDefinition() {
    return this._pluginDefinition;
  }

  /**
   * Get the runtime configuration.
   * @returns {Object}
   */
  getConfiguration() {
    return this._configuration;
  }

  /**
   * Set a configuration value.
   * @param {string} key
   * @param {*} value
   * @returns {this}
   */
  setConfiguration(key, value) {
    this._configuration[key] = value;
    return this;
  }

  /**
   * Default configuration form (override in subclasses).
   * Returns a render array for the plugin's settings form.
   * @param {Object} form - Current form state
   * @returns {Object} Render array
   */
  buildConfigurationForm(form = {}) {
    return form;
  }

  /**
   * Validate the configuration form (override in subclasses).
   * @param {Object} form
   * @param {Object} formState
   */
  validateConfigurationForm(form, formState) {
    // Override in subclass
  }

  /**
   * Submit the configuration form (override in subclasses).
   * @param {Object} form
   * @param {Object} formState
   */
  submitConfigurationForm(form, formState) {
    // Override in subclass
  }
}
