/**
 * plugins.js - Plugin System
 *
 * WHY PLUGINS (vs Modules):
 * ========================
 * Modules are core CMS extensions that have full system access.
 * Plugins are third-party extensions with restricted permissions.
 *
 * KEY DIFFERENCES:
 * - Modules live in /modules/, plugins in /plugins/
 * - Plugins declare required permissions upfront
 * - Plugins get a restricted context (only permitted APIs)
 * - Plugins have their own config.json for settings
 * - Plugins require explicit version compatibility
 *
 * PLUGIN LIFECYCLE:
 * 1. Discovery: Scan /plugins/ for valid plugin directories
 * 2. Validation: Check plugin.json manifest is valid
 * 3. Load: Import index.js and call hook_init()
 * 4. Activate: If enabled, call hook_activate()
 * 5. Register hooks: Wire hook_routes, hook_cli, etc.
 *
 * PERMISSION MODEL:
 * Plugins declare permissions in plugin.json:
 * {
 *   "permissions": ["content.read", "content.update"]
 * }
 *
 * The plugin context only exposes APIs matching these permissions.
 * Attempting to access unauthorized APIs throws an error.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as router from './router.js';
import * as cli from './cli.js';

/**
 * Plugin registry
 * Structure: { name: { manifest, exports, context, status, config } }
 */
const plugins = {};

/**
 * Configuration
 */
let pluginsDir = null;
let enabledPlugins = [];
let coreVersion = '0.0.0';

/**
 * Auto-reload state
 * WHY THIS EXISTS:
 * Tracks which plugins have pending changes and auto-reload settings.
 * Enables development workflow where plugins reload automatically on save.
 */
let autoReloadEnabled = false;
let autoReloadMode = false; // true | false | 'prompt'
let watchDebounce = 500;
const changedPlugins = new Map(); // name -> { timestamp, files: Set, changeType }

/**
 * Boot context reference for hot-swap operations
 */
let bootContext = null;

/**
 * Hook registration options for hot-swap
 */
let hookOptions = null;

/**
 * Initialize the plugin system
 *
 * @param {string} baseDir - Project root directory
 * @param {Object} pluginsConfig - Plugin configuration from site.json
 * @param {string} version - Core CMS version
 */
export function init(baseDir, pluginsConfig = {}, version = '0.0.0') {
  pluginsDir = pluginsConfig.directory
    ? join(baseDir, pluginsConfig.directory)
    : join(baseDir, 'plugins');

  enabledPlugins = pluginsConfig.enabled || [];
  coreVersion = version;

  // Ensure plugins directory exists
  if (!existsSync(pluginsDir)) {
    mkdirSync(pluginsDir, { recursive: true });
  }
}

/**
 * Compare semantic versions
 *
 * @param {string} v1 - First version
 * @param {string} v2 - Second version
 * @returns {number} - -1 if v1 < v2, 0 if equal, 1 if v1 > v2
 * @private
 */
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 < p2) return -1;
    if (p1 > p2) return 1;
  }

  return 0;
}

/**
 * Validate a plugin manifest
 *
 * @param {Object} manifest - Plugin manifest object
 * @returns {{ valid: boolean, errors: string[] }}
 *
 * REQUIRED FIELDS:
 * - name: string, alphanumeric with hyphens
 * - version: string, semver format
 * - description: string
 *
 * OPTIONAL FIELDS:
 * - author: string
 * - dependencies: string[] (other plugin names)
 * - minCoreVersion: string (minimum CMS version)
 * - permissions: string[] (required permissions)
 * - config: object (default config values)
 */
export function validatePlugin(manifest) {
  const errors = [];

  // Required fields
  if (!manifest.name || typeof manifest.name !== 'string') {
    errors.push('Missing or invalid "name" field');
  } else if (!/^[a-z][a-z0-9-]*$/.test(manifest.name)) {
    errors.push('Plugin name must be lowercase alphanumeric with hyphens, starting with a letter');
  }

  if (!manifest.version || typeof manifest.version !== 'string') {
    errors.push('Missing or invalid "version" field');
  } else if (!/^\d+\.\d+\.\d+/.test(manifest.version)) {
    errors.push('Version must be in semver format (e.g., 1.0.0)');
  }

  if (!manifest.description || typeof manifest.description !== 'string') {
    errors.push('Missing or invalid "description" field');
  }

  // Optional field validation
  if (manifest.dependencies && !Array.isArray(manifest.dependencies)) {
    errors.push('"dependencies" must be an array');
  }

  if (manifest.permissions && !Array.isArray(manifest.permissions)) {
    errors.push('"permissions" must be an array');
  }

  if (manifest.minCoreVersion) {
    if (!/^\d+\.\d+\.\d+/.test(manifest.minCoreVersion)) {
      errors.push('"minCoreVersion" must be in semver format');
    } else if (compareVersions(manifest.minCoreVersion, coreVersion) > 0) {
      errors.push(`Plugin requires core version ${manifest.minCoreVersion}, but running ${coreVersion}`);
    }
  }

  if (manifest.config && typeof manifest.config !== 'object') {
    errors.push('"config" must be an object');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Available permissions and their API mappings
 *
 * WHY PERMISSION MAPPING:
 * Permissions like "content.read" map to specific service methods.
 * This allows fine-grained access control.
 */
const PERMISSION_MAPPING = {
  // Content permissions
  'content.read': ['content.read', 'content.list', 'content.listAll', 'content.search', 'content.listTypes', 'content.hasType', 'content.getSchema'],
  'content.create': ['content.create'],
  'content.update': ['content.update'],
  'content.delete': ['content.remove', 'content.delete'],

  // Cache permissions
  'cache.read': ['cache.get', 'cache.has', 'cache.stats'],
  'cache.write': ['cache.set', 'cache.delete', 'cache.clear'],

  // Media permissions
  'media.read': ['media.getMimeType', 'media.isImageFile', 'media.isVideoFile', 'media.getFileType', 'media.isAllowedType', 'media.getAllowedExtensions'],
  'media.upload': ['media.parseUpload', 'media.saveFile'],
  'media.delete': ['media.deleteFile'],

  // Template permissions
  'template.render': ['template.render', 'template.renderString', 'template.renderWithLayout', 'template.escapeHtml'],

  // Config permissions (read-only)
  'config.read': ['config.site', 'config.modules'],

  // Hooks permissions
  'hooks.register': ['hooks.register'],
  'hooks.trigger': ['hooks.trigger', 'hooks.invoke'],
};

/**
 * Check if a permission allows a specific method
 *
 * @param {string[]} permissions - Granted permissions
 * @param {string} service - Service name
 * @param {string} method - Method name
 * @returns {boolean}
 * @private
 */
function isMethodAllowed(permissions, service, method) {
  const fullMethod = `${service}.${method}`;

  for (const perm of permissions) {
    const allowed = PERMISSION_MAPPING[perm] || [];
    if (allowed.includes(fullMethod)) {
      return true;
    }
  }

  return false;
}

/**
 * Create a permission-restricted context for a plugin
 *
 * @param {Object} plugin - Plugin info with manifest
 * @param {Object} context - Full boot context
 * @returns {Object} - Restricted context with only permitted APIs
 *
 * WHY RESTRICTED CONTEXT:
 * - Security: Plugins can't access more than declared
 * - Transparency: Users know exactly what a plugin can do
 * - Stability: Plugins can't break core functionality
 */
export function createPluginContext(plugin, context) {
  const permissions = plugin.manifest.permissions || [];
  const pluginName = plugin.manifest.name;

  /**
   * Create a proxy that checks permissions on method access
   */
  function createServiceProxy(serviceName, service) {
    return new Proxy(service, {
      get(target, prop) {
        // Allow typeof checks and non-function properties
        if (typeof target[prop] !== 'function') {
          return target[prop];
        }

        // Check if this method is allowed
        if (!isMethodAllowed(permissions, serviceName, prop)) {
          return function() {
            throw new Error(
              `Plugin '${pluginName}' lacks permission for ${serviceName}.${prop}. ` +
              `Declared permissions: [${permissions.join(', ')}]`
            );
          };
        }

        // Return bound method
        return target[prop].bind(target);
      },
    });
  }

  // Build restricted services object
  const restrictedServices = {
    get(name) {
      const service = context.services.get(name);
      if (!service) return null;

      // Create proxied service with permission checks
      return createServiceProxy(name, service);
    },
  };

  // Build restricted context
  const restrictedContext = {
    baseDir: context.baseDir,
    config: permissions.some(p => p.startsWith('config.'))
      ? {
          site: context.config.site,
          modules: context.config.modules,
        }
      : null,
    services: restrictedServices,
    hooks: permissions.some(p => p.startsWith('hooks.'))
      ? context.hooks
      : {
          register: () => { throw new Error(`Plugin '${pluginName}' lacks hooks.register permission`); },
          trigger: () => { throw new Error(`Plugin '${pluginName}' lacks hooks.trigger permission`); },
        },
    // Plugin-specific data
    plugin: {
      name: pluginName,
      version: plugin.manifest.version,
      path: plugin.path,
      config: plugin.config,
      permissions,
    },
  };

  return restrictedContext;
}

/**
 * Load a plugin configuration
 *
 * @param {string} pluginPath - Path to plugin directory
 * @returns {Object} - Plugin config or default
 * @private
 */
function loadPluginConfig(pluginPath) {
  const configPath = join(pluginPath, 'config.json');

  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    console.warn(`[plugins] Failed to load config for plugin at ${pluginPath}: ${error.message}`);
    return {};
  }
}

/**
 * Save plugin configuration
 *
 * @param {string} name - Plugin name
 * @param {Object} config - Configuration to save
 * @returns {boolean} - Success
 */
export function savePluginConfig(name, config) {
  const plugin = plugins[name];
  if (!plugin) {
    throw new Error(`Plugin not found: ${name}`);
  }

  const configPath = join(plugin.path, 'config.json');

  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    plugin.config = config;
    return true;
  } catch (error) {
    console.error(`[plugins] Failed to save config for ${name}: ${error.message}`);
    return false;
  }
}

/**
 * Discover plugins in the plugins directory
 *
 * @returns {Array<{ name, path, manifest, valid, errors }>}
 */
export function discover() {
  if (!pluginsDir || !existsSync(pluginsDir)) {
    return [];
  }

  const discovered = [];

  const entries = readdirSync(pluginsDir);

  for (const entry of entries) {
    const pluginPath = join(pluginsDir, entry);
    const stat = statSync(pluginPath);

    if (!stat.isDirectory()) continue;

    // Check for plugin.json
    const manifestPath = join(pluginPath, 'plugin.json');
    if (!existsSync(manifestPath)) continue;

    try {
      const raw = readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(raw);

      const validation = validatePlugin(manifest);

      discovered.push({
        name: manifest.name || entry,
        path: pluginPath,
        manifest,
        valid: validation.valid,
        errors: validation.errors,
      });
    } catch (error) {
      discovered.push({
        name: entry,
        path: pluginPath,
        manifest: null,
        valid: false,
        errors: [`Failed to parse plugin.json: ${error.message}`],
      });
    }
  }

  return discovered;
}

/**
 * Load a plugin from a directory
 *
 * @param {string} pluginPath - Path to plugin directory
 * @param {Object} context - Boot context (full, not restricted)
 * @returns {Promise<Object>} - Loaded plugin info
 */
export async function loadPlugin(pluginPath, context) {
  // Read manifest
  const manifestPath = join(pluginPath, 'plugin.json');

  if (!existsSync(manifestPath)) {
    throw new Error(`No plugin.json found at ${pluginPath}`);
  }

  const raw = readFileSync(manifestPath, 'utf-8');
  const manifest = JSON.parse(raw);

  // Validate
  const validation = validatePlugin(manifest);
  if (!validation.valid) {
    throw new Error(`Invalid plugin manifest: ${validation.errors.join(', ')}`);
  }

  const name = manifest.name;

  // Check dependencies
  if (manifest.dependencies && manifest.dependencies.length > 0) {
    for (const dep of manifest.dependencies) {
      if (!plugins[dep] || plugins[dep].status !== 'active') {
        throw new Error(`Plugin '${name}' requires plugin '${dep}' which is not active`);
      }
    }
  }

  // Load config
  const config = {
    ...manifest.config || {},
    ...loadPluginConfig(pluginPath),
  };

  // Create plugin entry
  const plugin = {
    name,
    path: pluginPath,
    manifest,
    config,
    exports: null,
    context: null,
    status: 'loaded',
  };

  // Load index.js
  const indexPath = join(pluginPath, 'index.js');

  if (existsSync(indexPath)) {
    try {
      plugin.exports = await import(indexPath);

      // Create restricted context
      plugin.context = createPluginContext(plugin, context);

      // Call hook_init if exists
      if (plugin.exports.hook_init) {
        await plugin.exports.hook_init(plugin.context);
      }
    } catch (error) {
      plugin.status = 'error';
      plugin.error = error.message;
      throw error;
    }
  }

  // Register plugin
  plugins[name] = plugin;

  return plugin;
}

/**
 * Activate an enabled plugin
 *
 * @param {string} name - Plugin name
 * @param {boolean} hotSwap - Whether this is a hot-swap activation
 * @returns {Promise<boolean>}
 *
 * WHY HOT-SWAP PARAMETER:
 * When hot-swapping, we need to re-register hooks.
 * On normal boot, hooks are registered separately in registerPluginHooks().
 */
export async function activatePlugin(name, hotSwap = false) {
  const plugin = plugins[name];

  if (!plugin) {
    throw new Error(`Plugin not found: ${name}`);
  }

  if (plugin.status === 'active') {
    return true; // Already active
  }

  if (plugin.status === 'error') {
    throw new Error(`Cannot activate plugin '${name}': ${plugin.error}`);
  }

  try {
    // Call hook_activate if exists
    if (plugin.exports?.hook_activate) {
      await plugin.exports.hook_activate(plugin.context);
    }

    plugin.status = 'active';

    // Hot-swap: register hooks now
    if (hotSwap && hookOptions) {
      await registerSinglePluginHooks(plugin, hookOptions);
    }

    return true;
  } catch (error) {
    plugin.status = 'error';
    plugin.error = error.message;
    throw error;
  }
}

/**
 * Deactivate an active plugin (hot-unload)
 *
 * @param {string} name - Plugin name
 * @returns {Promise<boolean>}
 *
 * WHY THIS EXISTS:
 * Hot-swap capability allows plugins to be unloaded without restart.
 * This removes all routes, CLI commands, middleware, and tasks registered by the plugin.
 */
export async function deactivatePlugin(name) {
  const plugin = plugins[name];

  if (!plugin) {
    throw new Error(`Plugin not found: ${name}`);
  }

  if (plugin.status !== 'active') {
    return true; // Not active, nothing to do
  }

  try {
    // Call hook_deactivate if exists
    if (plugin.exports?.hook_deactivate) {
      await plugin.exports.hook_deactivate(plugin.context);
    }

    // Unregister routes registered by this plugin
    const routeSource = `plugin:${name}`;
    const removedRoutes = router.unregisterBySource(routeSource);

    // Unregister middleware registered by this plugin
    const removedMiddleware = router.unregisterMiddlewareBySource(routeSource);

    // Unregister CLI commands registered by this plugin
    // Plugin CLI commands are prefixed with plugin name
    const removedCli = cli.unregisterBySource(routeSource);

    plugin.status = 'loaded';  // Back to loaded but not active

    console.log(`[plugins] Deactivated '${name}': removed ${removedRoutes} routes, ${removedMiddleware} middleware, ${removedCli} CLI commands`);

    return true;
  } catch (error) {
    console.error(`[plugins] Error deactivating '${name}': ${error.message}`);
    throw error;
  }
}

/**
 * Reload a plugin (deactivate then activate)
 *
 * @param {string} name - Plugin name
 * @returns {Promise<boolean>}
 *
 * WHY THIS EXISTS:
 * Allows updating a plugin's code and reloading without server restart.
 */
export async function reloadPlugin(name) {
  const plugin = plugins[name];

  if (!plugin) {
    throw new Error(`Plugin not found: ${name}`);
  }

  const wasActive = plugin.status === 'active';

  // Deactivate if active
  if (wasActive) {
    await deactivatePlugin(name);
  }

  // Re-import the plugin module to get fresh code
  // Note: Node.js caches imports, so we need to bust the cache
  const indexPath = join(plugin.path, 'index.js');

  if (existsSync(indexPath)) {
    try {
      // Add timestamp to bust module cache
      const cacheBuster = `?t=${Date.now()}`;
      plugin.exports = await import(indexPath + cacheBuster);

      // Reload config
      plugin.config = {
        ...plugin.manifest.config || {},
        ...loadPluginConfig(plugin.path),
      };

      // Re-create context with fresh config
      if (bootContext) {
        plugin.context = createPluginContext(plugin, bootContext);
      }

      // Call hook_init again
      if (plugin.exports.hook_init) {
        await plugin.exports.hook_init(plugin.context);
      }
    } catch (error) {
      plugin.status = 'error';
      plugin.error = error.message;
      throw error;
    }
  }

  // Reactivate if was active
  if (wasActive) {
    await activatePlugin(name, true);  // hot-swap mode
  }

  console.log(`[plugins] Reloaded '${name}'`);
  return true;
}

/**
 * Get a loaded plugin by name
 *
 * @param {string} name - Plugin name
 * @returns {Object|null} - Plugin info or null
 */
export function getPlugin(name) {
  return plugins[name] || null;
}

/**
 * List all loaded plugins
 *
 * @returns {Array<{ name, version, description, status, permissions }>}
 */
export function listPlugins() {
  return Object.values(plugins).map(p => ({
    name: p.name,
    version: p.manifest.version,
    description: p.manifest.description,
    author: p.manifest.author || null,
    status: p.status,
    permissions: p.manifest.permissions || [],
    dependencies: p.manifest.dependencies || [],
    minCoreVersion: p.manifest.minCoreVersion || null,
    path: p.path,
    config: p.config,
    error: p.error || null,
  }));
}

/**
 * Check if a plugin is enabled in configuration
 *
 * @param {string} name - Plugin name
 * @returns {boolean}
 */
export function isEnabled(name) {
  return enabledPlugins.includes(name);
}

/**
 * Get list of enabled plugins from configuration
 *
 * @returns {string[]}
 */
export function getEnabledPlugins() {
  return [...enabledPlugins];
}

/**
 * Load and activate all enabled plugins
 *
 * @param {Object} context - Boot context
 * @returns {Promise<{ loaded: number, activated: number, errors: Array }>}
 */
export async function loadAllPlugins(context) {
  const discovered = discover();
  const results = {
    loaded: 0,
    activated: 0,
    errors: [],
  };

  // Sort by dependencies (simple approach: plugins without deps first)
  const sorted = [...discovered].sort((a, b) => {
    const aDeps = a.manifest?.dependencies?.length || 0;
    const bDeps = b.manifest?.dependencies?.length || 0;
    return aDeps - bDeps;
  });

  for (const info of sorted) {
    // Skip invalid plugins
    if (!info.valid) {
      results.errors.push({
        name: info.name,
        phase: 'validation',
        error: info.errors.join(', '),
      });
      continue;
    }

    try {
      // Load plugin
      await loadPlugin(info.path, context);
      results.loaded++;

      // Activate if enabled
      if (isEnabled(info.name)) {
        await activatePlugin(info.name);
        results.activated++;
      }
    } catch (error) {
      results.errors.push({
        name: info.name,
        phase: plugins[info.name]?.status === 'loaded' ? 'activation' : 'loading',
        error: error.message,
      });
    }
  }

  return results;
}

/**
 * Register hooks for a single plugin
 *
 * @param {Object} plugin - Plugin object
 * @param {Object} options - Hook registration options
 * @private
 *
 * WHY SEPARATE FUNCTION:
 * Used by both registerPluginHooks (boot) and activatePlugin (hot-swap).
 */
async function registerSinglePluginHooks(plugin, options) {
  const {
    cliRegister,
    routeRegister,
    contentRegister,
    middlewareUse,
    scheduleTask,
  } = options;

  const exports = plugin.exports;
  if (!exports) return;

  const name = plugin.name;
  const ctx = plugin.context;
  const source = `plugin:${name}`;

  // Register CLI commands
  if (exports.hook_cli && cliRegister) {
    try {
      const pluginCliRegister = (cmd, handler, desc) => {
        // Use source tracking for hot-swap unregistration
        cli.registerInternal
          ? cli.registerInternal(`${name}:${cmd}`, handler, desc, source)
          : cliRegister(`${name}:${cmd}`, handler, desc);
      };
      await exports.hook_cli(pluginCliRegister, ctx);
    } catch (error) {
      console.error(`[plugins] Failed to register CLI for '${name}': ${error.message}`);
    }
  }

  // Register routes
  if (exports.hook_routes && routeRegister) {
    try {
      // Wrap to track source
      const pluginRouteRegister = (method, path, handler, desc) => {
        router.registerInternal
          ? router.registerInternal(method, path, handler, desc, source)
          : routeRegister(method, path, handler, desc);
      };
      await exports.hook_routes(pluginRouteRegister, ctx);
    } catch (error) {
      console.error(`[plugins] Failed to register routes for '${name}': ${error.message}`);
    }
  }

  // Register content types
  if (exports.hook_content && contentRegister) {
    try {
      await exports.hook_content(contentRegister, ctx);
    } catch (error) {
      console.error(`[plugins] Failed to register content types for '${name}': ${error.message}`);
    }
  }

  // Register middleware
  if (exports.hook_middleware && middlewareUse) {
    try {
      // Wrap to track source
      const pluginMiddlewareUse = (handler, mwName, path) => {
        router.useInternal
          ? router.useInternal(handler, path, `${name}:${mwName || 'middleware'}`, source)
          : middlewareUse(handler, mwName, path);
      };
      await exports.hook_middleware(pluginMiddlewareUse, ctx);
    } catch (error) {
      console.error(`[plugins] Failed to register middleware for '${name}': ${error.message}`);
    }
  }

  // Register scheduled tasks
  if (exports.hook_schedule && scheduleTask) {
    try {
      const pluginScheduler = (taskName, cron, handler, opts) => {
        scheduleTask(`${name}:${taskName}`, cron, handler, opts);
      };
      await exports.hook_schedule(pluginScheduler, ctx);
    } catch (error) {
      console.error(`[plugins] Failed to register scheduled tasks for '${name}': ${error.message}`);
    }
  }
}

/**
 * Register plugin hooks with the system
 *
 * @param {Object} context - Boot context
 * @param {Object} options - Hook registration options
 * @param {Function} options.cliRegister - CLI register function
 * @param {Function} options.routeRegister - Route register function
 * @param {Function} options.contentRegister - Content type register function
 * @param {Function} options.middlewareUse - Middleware use function
 * @param {Function} options.scheduleTask - Schedule task function
 */
export async function registerPluginHooks(context, options) {
  // Store for hot-swap operations
  bootContext = context;
  hookOptions = options;

  for (const plugin of Object.values(plugins)) {
    if (plugin.status !== 'active') continue;
    await registerSinglePluginHooks(plugin, options);
  }
}

/**
 * Create a new plugin scaffold
 *
 * @param {string} name - Plugin name
 * @returns {{ success: boolean, path: string, files: string[] }}
 */
export function createPluginScaffold(name) {
  // Validate name
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error('Plugin name must be lowercase alphanumeric with hyphens, starting with a letter');
  }

  const pluginPath = join(pluginsDir, name);

  if (existsSync(pluginPath)) {
    throw new Error(`Plugin directory already exists: ${pluginPath}`);
  }

  // Create directory
  mkdirSync(pluginPath, { recursive: true });

  const files = [];

  // Create plugin.json
  const manifest = {
    name,
    version: '1.0.0',
    description: `${name} plugin for CMS Core`,
    author: '',
    dependencies: [],
    minCoreVersion: coreVersion,
    permissions: ['content.read'],
    config: {
      enabled: true,
    },
  };
  writeFileSync(join(pluginPath, 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n');
  files.push('plugin.json');

  // Create index.js
  const indexContent = `/**
 * ${name} Plugin
 *
 * This plugin was scaffolded by CMS Core.
 * Edit this file to add your plugin functionality.
 */

/**
 * Called when the plugin is loaded
 * Use this for initial setup
 *
 * @param {Object} context - Plugin context (permission-restricted)
 */
export async function hook_init(context) {
  console.log('[${name}] Plugin initialized');
}

/**
 * Called when the plugin is activated (enabled in config)
 * Use this for activation-time setup
 *
 * @param {Object} context - Plugin context (permission-restricted)
 */
export async function hook_activate(context) {
  console.log('[${name}] Plugin activated');
  console.log('[${name}] Config:', context.plugin.config);
}

/**
 * Register CLI commands
 *
 * @param {Function} register - (command, handler, description)
 * @param {Object} context - Plugin context
 */
export function hook_cli(register, context) {
  register('status', async (args, ctx) => {
    console.log('${name} plugin is running');
    console.log('Version:', context.plugin.version);
    console.log('Config:', JSON.stringify(context.plugin.config, null, 2));
  }, 'Show ${name} plugin status');
}

/**
 * Register HTTP routes
 *
 * @param {Function} register - (method, path, handler, description)
 * @param {Object} context - Plugin context
 */
export function hook_routes(register, context) {
  register('GET', '/${name}/status', async (req, res, params, ctx) => {
    const server = context.services.get('server');
    server.json(res, {
      plugin: '${name}',
      version: context.plugin.version,
      status: 'active',
    });
  }, '${name} status endpoint');
}

/**
 * Register content types (requires content.create permission)
 * Uncomment and modify if your plugin needs custom content types
 *
 * @param {Function} register - (type, schema)
 * @param {Object} context - Plugin context
 */
// export function hook_content(register, context) {
//   register('${name}-item', {
//     title: { type: 'string', required: true },
//     data: { type: 'object', required: false },
//   });
// }
`;
  writeFileSync(join(pluginPath, 'index.js'), indexContent);
  files.push('index.js');

  // Create config.json
  const configContent = {
    enabled: true,
  };
  writeFileSync(join(pluginPath, 'config.json'), JSON.stringify(configContent, null, 2) + '\n');
  files.push('config.json');

  return {
    success: true,
    path: pluginPath,
    files,
  };
}

/**
 * Get permission descriptions for UI
 *
 * @returns {Object} - Permission name to description mapping
 */
export function getPermissionDescriptions() {
  return {
    'content.read': 'Read content items and list content types',
    'content.create': 'Create new content items',
    'content.update': 'Update existing content items',
    'content.delete': 'Delete content items',
    'cache.read': 'Read cache entries and statistics',
    'cache.write': 'Write, delete, and clear cache entries',
    'media.read': 'Read media file information',
    'media.upload': 'Upload new media files',
    'media.delete': 'Delete media files',
    'template.render': 'Render templates',
    'config.read': 'Read site and module configuration',
    'hooks.register': 'Register event hooks',
    'hooks.trigger': 'Trigger event hooks',
  };
}

/**
 * Clear all loaded plugins (for testing)
 */
export function clearPlugins() {
  for (const key of Object.keys(plugins)) {
    delete plugins[key];
  }
}

// ==========================================================
// AUTO-RELOAD FUNCTIONS
// ==========================================================

/**
 * Initialize auto-reload settings from config
 *
 * @param {Object} pluginsConfig - Plugin configuration from site.json
 */
export function initAutoReload(pluginsConfig = {}) {
  autoReloadMode = pluginsConfig.autoReload ?? false;
  watchDebounce = pluginsConfig.watchDebounce ?? 500;
  autoReloadEnabled = autoReloadMode === true;
}

/**
 * Enable auto-reload mode
 *
 * @param {boolean|string} mode - true, false, or 'prompt'
 *
 * WHY THREE MODES:
 * - true: Automatically reload plugins on file change
 * - false: Ignore file changes
 * - 'prompt': Log change but require manual reload
 */
export function enableAutoReload(mode = true) {
  autoReloadMode = mode;
  autoReloadEnabled = mode === true;
  console.log(`[plugins] Auto-reload mode: ${mode}`);
}

/**
 * Disable auto-reload mode
 */
export function disableAutoReload() {
  autoReloadMode = false;
  autoReloadEnabled = false;
  console.log('[plugins] Auto-reload disabled');
}

/**
 * Check if auto-reload is enabled
 *
 * @returns {boolean}
 */
export function isAutoReloadEnabled() {
  return autoReloadEnabled;
}

/**
 * Get current auto-reload mode
 *
 * @returns {boolean|string} - true, false, or 'prompt'
 */
export function getAutoReloadMode() {
  return autoReloadMode;
}

/**
 * Get the configured watch debounce time
 *
 * @returns {number} - Debounce milliseconds
 */
export function getWatchDebounce() {
  return watchDebounce;
}

/**
 * Mark a plugin as changed (pending reload)
 *
 * @param {string} name - Plugin name
 * @param {string} changeType - Type of change: 'code', 'manifest', 'config', 'file'
 * @param {string} filePath - Path that changed
 *
 * WHY TRACK CHANGES:
 * - Shows which plugins need attention in admin UI
 * - Enables batch reload of all changed plugins
 * - Provides context for why plugin needs reload
 */
export function markPluginChanged(name, changeType, filePath) {
  if (!changedPlugins.has(name)) {
    changedPlugins.set(name, {
      timestamp: new Date().toISOString(),
      files: new Set(),
      changeType,
    });
  }

  const entry = changedPlugins.get(name);
  entry.files.add(filePath);
  // Upgrade changeType priority: code > manifest > config > file
  const priority = { code: 3, manifest: 2, config: 1, file: 0 };
  if (priority[changeType] > priority[entry.changeType]) {
    entry.changeType = changeType;
  }
  entry.timestamp = new Date().toISOString();
}

/**
 * Clear the changed status for a plugin
 *
 * @param {string} name - Plugin name
 */
export function clearPluginChanged(name) {
  changedPlugins.delete(name);
}

/**
 * Get list of plugins with pending changes
 *
 * @returns {Array<{ name, timestamp, files, changeType }>}
 */
export function getChangedPlugins() {
  return Array.from(changedPlugins.entries()).map(([name, data]) => ({
    name,
    timestamp: data.timestamp,
    files: Array.from(data.files),
    changeType: data.changeType,
  }));
}

/**
 * Check if a plugin has pending changes
 *
 * @param {string} name - Plugin name
 * @returns {boolean}
 */
export function hasPluginChanged(name) {
  return changedPlugins.has(name);
}

/**
 * Handle a plugin file change event
 *
 * @param {Object} change - Change event from watcher
 * @param {string} change.pluginName - Plugin name
 * @param {string} change.changeType - Type of change
 * @param {string} change.path - File path that changed
 * @returns {Promise<boolean>} - True if plugin was reloaded
 *
 * WHY ASYNC:
 * Plugin reload is async, so this function awaits reload if auto-reload is on.
 */
export async function handlePluginChange(change) {
  const { pluginName, changeType, path } = change;
  const plugin = plugins[pluginName];

  // Mark as changed regardless of mode
  markPluginChanged(pluginName, changeType, path);

  // Only auto-reload if:
  // 1. Auto-reload is enabled (mode === true)
  // 2. Plugin is currently active
  // 3. Plugin exists and is loaded
  if (!autoReloadEnabled) {
    if (autoReloadMode === 'prompt' && plugin?.status === 'active') {
      console.log(`[plugins] Plugin '${pluginName}' changed — run 'plugins:reload ${pluginName}' to apply`);
    }
    return false;
  }

  if (!plugin) {
    console.log(`[plugins] Unknown plugin '${pluginName}' changed`);
    return false;
  }

  if (plugin.status !== 'active') {
    console.log(`[plugins] Plugin '${pluginName}' changed but not active`);
    return false;
  }

  // Attempt auto-reload
  try {
    console.log(`[plugins] Auto-reloading '${pluginName}'...`);
    await reloadPlugin(pluginName);
    clearPluginChanged(pluginName);
    console.log(`[plugins] Auto-reloaded '${pluginName}' successfully`);
    return true;
  } catch (error) {
    console.error(`[plugins] Auto-reload failed for '${pluginName}': ${error.message}`);
    // Keep marked as changed so user can fix and retry
    return false;
  }
}

/**
 * Reload all plugins with pending changes
 *
 * @returns {Promise<{ reloaded: string[], failed: Array<{ name, error }> }>}
 */
export async function reloadChangedPlugins() {
  const changed = getChangedPlugins();
  const reloaded = [];
  const failed = [];

  for (const { name } of changed) {
    const plugin = plugins[name];
    if (!plugin || plugin.status !== 'active') {
      continue;
    }

    try {
      await reloadPlugin(name);
      clearPluginChanged(name);
      reloaded.push(name);
    } catch (error) {
      failed.push({ name, error: error.message });
    }
  }

  return { reloaded, failed };
}
