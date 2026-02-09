/**
 * @file
 * Universal Plugin Manager for CMS-Core.
 *
 * ONE class that handles discovery, caching, instantiation, and alter hooks
 * for ANY plugin type. Replaces ~40 Drupal PluginManager subclasses with
 * a single parameterized implementation.
 *
 * Drupal equivalent: DefaultPluginManager.php
 *
 * @see .autoforge/templates/plugin-manager.js for full documentation
 */

const PLUGIN_CACHE = Symbol('pluginCache');

export class PluginManager {
  /**
   * Create a new plugin manager.
   *
   * @param {string} type - Plugin type ID (e.g., 'field_type', 'block', 'filter')
   * @param {Object} options - Configuration options
   * @param {string} [options.subdir] - Subdirectory under modules plugins directory (defaults to type)
   * @param {string} [options.alterHook] - Hook name for definition altering (defaults to type_info_alter)
   * @param {Function} [options.baseClass] - Required base class for validation (optional)
   * @param {Object} [options.defaults] - Default definition values merged into every plugin
   */
  constructor(type, options = {}) {
    // WHY: Store type for error messages and debugging
    this.type = type;

    // WHY: Subdirectory defaults to type name but can be overridden
    this.subdir = options.subdir || type;

    // WHY: Alter hook defaults to convention but can be customized
    this.alterHook = options.alterHook || `${type}_info_alter`;

    // WHY: Optional base class for type checking plugin instances
    this.baseClass = options.baseClass || null;

    // WHY: Default values merged into every plugin definition
    this.defaults = options.defaults || {};

    // WHY: Private cache using Symbol to prevent external access
    this[PLUGIN_CACHE] = null;

    // WHY: Infrastructure references set later via setInfrastructure()
    // during boot. This allows PluginManager to be instantiated early
    // before DI container and module discovery are complete.
    this._modulePaths = [];
    this._services = null;
    this._hooks = null;
  }

  /**
   * Wire up infrastructure references.
   *
   * WHY: Called during container compilation after all modules are discovered.
   * Separates construction from infrastructure wiring.
   *
   * @param {Container} services - DI container for plugin factory injection
   * @param {HookManager} hooks - Hook system for alter hooks
   * @param {Array<{name: string, path: string}>} modulePaths - Discovered modules
   */
  setInfrastructure(services, hooks, modulePaths) {
    this._services = services;
    this._hooks = hooks;
    this._modulePaths = modulePaths;
  }

  /**
   * Get all plugin definitions.
   *
   * WHY: Lazy discovery on first call, then cached. Scans all modules'
   * plugins/{subdir}/ directories, imports .js files, reads definition exports.
   *
   * Drupal equivalent: DefaultPluginManager::getDefinitions()
   *
   * @returns {Promise<Map<string, Object>>} Map of pluginId → definition
   */
  async getDefinitions() {
    // WHY: Return cached definitions if already discovered
    if (this[PLUGIN_CACHE]) return this[PLUGIN_CACHE];

    const definitions = new Map();

    // WHY: Scan each module's plugin directory for this type
    for (const { name: moduleName, path: modulePath } of this._modulePaths) {
      const pluginDir = `${modulePath}/plugins/${this.subdir}`;

      try {
        const { readdirSync } = await import('node:fs');
        const entries = readdirSync(pluginDir, { withFileTypes: true });

        for (const entry of entries) {
          // WHY: Only process .js files
          if (!entry.name.endsWith('.js')) continue;

          const pluginPath = `${pluginDir}/${entry.name}`;

          // WHY: Dynamic import allows modules to be discovered at runtime
          const pluginModule = await import(pluginPath);

          // WHY: Skip files without definition export
          if (!pluginModule.definition) {
            console.warn(`[plugin:${this.type}] ${pluginPath} missing definition export`);
            continue;
          }

          // WHY: Merge defaults with plugin definition, add metadata
          const def = {
            ...this.defaults,
            ...pluginModule.definition,
            _module: moduleName,
            _path: pluginPath,
            _factory: pluginModule.default || pluginModule.create,
          };

          // WHY: Validate that plugin has an ID
          if (!def.id) {
            console.warn(`[plugin:${this.type}] ${pluginPath} definition missing 'id'`);
            continue;
          }

          definitions.set(def.id, def);
        }
      } catch (e) {
        // WHY: ENOENT is expected when module has no plugins of this type
        if (e.code !== 'ENOENT') {
          console.error(`[plugin:${this.type}] Error scanning ${pluginDir}:`, e.message);
        }
      }
    }

    // WHY: Fire alter hook so modules can modify any plugin's definition
    if (this._hooks) {
      await this._hooks.invoke(this.alterHook, { definitions });
    }

    // WHY: Cache for subsequent calls
    this[PLUGIN_CACHE] = definitions;
    return definitions;
  }

  /**
   * Get a single plugin definition by ID.
   *
   * @param {string} id - Plugin ID
   * @returns {Promise<Object|null>} Definition object or null if not found
   */
  async getDefinition(id) {
    const defs = await this.getDefinitions();
    return defs.get(id) || null;
  }

  /**
   * Check if a plugin exists.
   *
   * @param {string} id - Plugin ID
   * @returns {Promise<boolean>} True if plugin exists
   */
  async hasDefinition(id) {
    const defs = await this.getDefinitions();
    return defs.has(id);
  }

  /**
   * Create a plugin instance.
   *
   * WHY: Uses plugin's factory function if available, otherwise returns
   * a basic wrapper with getPluginId/getPluginDefinition/getConfiguration.
   *
   * Drupal equivalent: DefaultPluginManager::createInstance()
   *
   * @param {string} id - Plugin ID
   * @param {Object} configuration - Runtime configuration passed to factory
   * @returns {Promise<Object>} Plugin instance
   * @throws {Error} If plugin ID not found
   */
  async createInstance(id, configuration = {}) {
    const def = await this.getDefinition(id);

    // WHY: Throw descriptive error listing available plugins
    if (!def) {
      const available = [...(await this.getDefinitions()).keys()].join(', ');
      throw new Error(
        `Plugin "${id}" of type "${this.type}" not found. Available: ${available}`
      );
    }

    // WHY: If plugin has factory function, use it
    if (typeof def._factory === 'function') {
      const instance = await def._factory(configuration, id, def, this._services);

      // WHY: Attach metadata to instance for introspection
      if (instance) {
        instance._pluginId = id;
        instance._pluginDefinition = def;
      }
      return instance;
    }

    // WHY: No factory — return basic wrapper (PluginInstance pattern)
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
   * Clear cached definitions.
   *
   * WHY: Call after module install/uninstall to force rediscovery.
   *
   * @returns {void}
   */
  clearCachedDefinitions() {
    this[PLUGIN_CACHE] = null;
  }
}
