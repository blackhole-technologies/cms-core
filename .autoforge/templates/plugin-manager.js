/**
 * META-PATTERN TEMPLATE: PluginManager
 * =====================================
 * 
 * Drupal equivalent: DefaultPluginManager.php (~40 subclasses)
 * 
 * ONE class that handles discovery, caching, instantiation, and alter hooks
 * for ANY plugin type. In Drupal, every extensible subsystem has its own
 * PluginManager subclass. In CMS-Core, we parameterize ONE class.
 * 
 * Plugin types this covers: field_type, field_widget, field_formatter,
 * block, filter, image_effect, search_backend, queue_worker, rest_resource,
 * layout, migration_source, migration_process, migration_destination, etc.
 * 
 * @example Creating a new plugin type
 * ```javascript
 * // In core/lib/Field/FieldTypePluginManager.js:
 * import { PluginManager } from '../Plugin/PluginManager.js';
 * 
 * export const fieldTypeManager = new PluginManager('field_type', {
 *   subdir: 'field_type',
 *   alterHook: 'field_info_alter',
 *   defaults: {
 *     category: 'General',
 *     defaultWidget: null,
 *     defaultFormatter: null,
 *   },
 * });
 * ```
 * 
 * @example Creating a plugin (what module authors write)
 * ```javascript
 * // modules/text/plugins/field_type/StringItem.js
 * export const definition = {
 *   id: 'string',
 *   label: 'Text (plain)',
 *   description: 'A short plain text string.',
 *   category: 'Text',
 *   defaultWidget: 'string_textfield',
 *   defaultFormatter: 'string',
 *   defaultSettings: { maxLength: 255 },
 * };
 * 
 * export default function create(configuration, pluginId, definition, services) {
 *   return {
 *     ...definition,
 *     schema(settings) { return { type: 'string', maxLength: settings.maxLength || 255 }; },
 *     isEmpty(value) { return value === null || value === undefined || value === ''; },
 *   };
 * }
 * ```
 * 
 * Directory convention: modules/{module}/plugins/{pluginType}/{PluginName}.js
 * Each plugin file MUST export: definition (object with id), default/create (factory function)
 */

const PLUGIN_CACHE = Symbol('pluginCache');

export class PluginManager {
  /**
   * @param {string} type - Plugin type ID (e.g., 'field_type', 'block', 'filter')
   * @param {Object} options
   * @param {string} options.subdir - Subdirectory under modules/*/plugins/ (defaults to type)
   * @param {string} options.alterHook - Hook name for definition altering (defaults to '{type}_info_alter')
   * @param {Function} options.baseClass - Required base class check (optional)
   * @param {Object} options.defaults - Default definition values merged into every plugin
   */
  constructor(type, options = {}) {
    this.type = type;
    this.subdir = options.subdir || type;
    this.alterHook = options.alterHook || `${type}_info_alter`;
    this.baseClass = options.baseClass || null;
    this.defaults = options.defaults || {};

    /** @private */
    this[PLUGIN_CACHE] = null;

    /** @private — populated via setInfrastructure() during boot */
    this._modulePaths = [];
    this._services = null;
    this._hooks = null;
  }

  /**
   * Wire up infrastructure references. Called during container compilation.
   * 
   * @param {Container} services - DI container
   * @param {HookManager} hooks - Hook system
   * @param {Array<{name: string, path: string}>} modulePaths - Discovered modules
   */
  setInfrastructure(services, hooks, modulePaths) {
    this._services = services;
    this._hooks = hooks;
    this._modulePaths = modulePaths;
  }

  /**
   * Get all plugin definitions. Discovers on first call, caches after.
   * Drupal equivalent: DefaultPluginManager::getDefinitions()
   * 
   * @returns {Promise<Map<string, Object>>} Map of pluginId → definition
   */
  async getDefinitions() {
    if (this[PLUGIN_CACHE]) return this[PLUGIN_CACHE];

    const definitions = new Map();

    for (const { name: moduleName, path: modulePath } of this._modulePaths) {
      const pluginDir = `${modulePath}/plugins/${this.subdir}`;

      try {
        const { readdirSync } = await import('node:fs');
        const entries = readdirSync(pluginDir, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.name.endsWith('.js')) continue;

          const pluginPath = `${pluginDir}/${entry.name}`;
          const pluginModule = await import(pluginPath);

          if (!pluginModule.definition) {
            console.warn(`[plugin:${this.type}] ${pluginPath} missing definition export`);
            continue;
          }

          const def = {
            ...this.defaults,
            ...pluginModule.definition,
            _module: moduleName,
            _path: pluginPath,
            _factory: pluginModule.default || pluginModule.create,
          };

          if (!def.id) {
            console.warn(`[plugin:${this.type}] ${pluginPath} definition missing 'id'`);
            continue;
          }

          definitions.set(def.id, def);
        }
      } catch (e) {
        if (e.code !== 'ENOENT') {
          console.error(`[plugin:${this.type}] Error scanning ${pluginDir}:`, e.message);
        }
      }
    }

    // Fire alter hook — modules can modify any plugin's definition
    if (this._hooks) {
      await this._hooks.invoke(this.alterHook, { definitions });
    }

    this[PLUGIN_CACHE] = definitions;
    return definitions;
  }

  /**
   * Get a single plugin definition by ID.
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async getDefinition(id) {
    const defs = await this.getDefinitions();
    return defs.get(id) || null;
  }

  /**
   * Check if a plugin exists.
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async hasDefinition(id) {
    const defs = await this.getDefinitions();
    return defs.has(id);
  }

  /**
   * Create a plugin instance.
   * Drupal equivalent: DefaultPluginManager::createInstance()
   * 
   * @param {string} id - Plugin ID
   * @param {Object} configuration - Runtime configuration
   * @returns {Promise<Object>} Plugin instance
   */
  async createInstance(id, configuration = {}) {
    const def = await this.getDefinition(id);
    if (!def) {
      const available = [...(await this.getDefinitions()).keys()].join(', ');
      throw new Error(`Plugin "${id}" of type "${this.type}" not found. Available: ${available}`);
    }

    if (typeof def._factory === 'function') {
      const instance = await def._factory(configuration, id, def, this._services);
      if (instance) {
        instance._pluginId = id;
        instance._pluginDefinition = def;
      }
      return instance;
    }

    // No factory — return a basic wrapper
    return {
      _pluginId: id,
      _pluginDefinition: def,
      _configuration: configuration,
      getPluginId() { return id; },
      getPluginDefinition() { return def; },
      getConfiguration() { return configuration; },
    };
  }

  /**
   * Clear cached definitions. Call after module install/uninstall.
   */
  clearCachedDefinitions() {
    this[PLUGIN_CACHE] = null;
  }
}
