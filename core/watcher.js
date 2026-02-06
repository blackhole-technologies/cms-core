/**
 * watcher.js - Advanced Filesystem Watcher
 *
 * WHY THIS EXISTS:
 * During development, you want to know when files change:
 * - New modules added → need to restart to activate
 * - Config changed → can hot-reload without restart
 * - Module code changed → need to restart to apply
 * - New themes added → detected for admin UI
 *
 * This watcher provides:
 * - Recursive watching of /modules, /themes, /config
 * - Semantic detection (new module vs. code change vs. config update)
 * - Hot reload for configs in development mode
 * - Persistent log file for debugging
 *
 * WHY NODE'S BUILT-IN fs.watch:
 * - No external dependencies
 * - Works across platforms (with some quirks)
 * - Good enough for development use
 *
 * KNOWN LIMITATION:
 * fs.watch can fire multiple events for a single file change.
 * We debounce to handle this, but it's not perfect.
 */

import { watch, existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { join, basename, dirname, relative } from 'node:path';
import * as config from './config.js';

/**
 * Active watchers (so we can stop them later)
 */
const watchers = [];

/**
 * Recent events log (circular buffer, last 50)
 */
const recentEvents = [];
const MAX_EVENTS = 50;

/**
 * Debounce tracking to prevent duplicate events
 * WHY: fs.watch often fires 2-3 times for one file change
 */
const debounceMap = new Map();
const DEBOUNCE_MS = 100;

/**
 * Base directory and config reference
 */
let baseDir = null;
let siteConfig = null;
let logFilePath = null;

/**
 * Track known modules/themes/plugins for change detection
 */
const knownModules = new Set();
const knownThemes = new Set();
const knownPlugins = new Set();

/**
 * Plugin change callbacks - modules can subscribe to plugin changes
 * WHY CALLBACKS:
 * Allows plugin system to react to file changes without tight coupling.
 * Boot.js wires this up to trigger reload prompts.
 */
const pluginChangeCallbacks = [];

/**
 * Format timestamp for logging
 * WHY ISO FORMAT: Sortable, unambiguous, standard
 */
function timestamp() {
  return new Date().toISOString();
}

/**
 * Log an event to console, memory buffer, and log file
 *
 * @param {string} eventType - WATCHING, CREATED, MODIFIED, DELETED, etc.
 * @param {string} path - Relative path that changed
 * @param {string} message - Optional additional message
 */
function logEvent(eventType, path, message = null) {
  const ts = timestamp();
  const paddedType = eventType.padEnd(8);
  const logLine = `[watcher] ${ts} | ${paddedType} | ${path}`;

  // Console output
  console.log(logLine);
  if (message) {
    console.log(`[watcher] ${message}`);
  }

  // Memory buffer (circular)
  const event = { timestamp: ts, type: eventType, path, message };
  recentEvents.push(event);
  if (recentEvents.length > MAX_EVENTS) {
    recentEvents.shift();
  }

  // File log (append)
  if (logFilePath) {
    try {
      let fileContent = logLine + '\n';
      if (message) {
        fileContent += `[watcher] ${message}\n`;
      }
      appendFileSync(logFilePath, fileContent);
    } catch (error) {
      // WHY SILENT FAIL:
      // Log file errors shouldn't crash the system.
      // Console output still works.
      console.error(`[watcher] Failed to write log file: ${error.message}`);
    }
  }
}

/**
 * Debounce wrapper for event handling
 * WHY: fs.watch fires multiple times for single changes
 *
 * @param {string} key - Unique key for this event (path + type)
 * @param {Function} callback - Function to call after debounce
 */
function debounce(key, callback) {
  if (debounceMap.has(key)) {
    clearTimeout(debounceMap.get(key));
  }
  debounceMap.set(key, setTimeout(() => {
    debounceMap.delete(key);
    callback();
  }, DEBOUNCE_MS));
}

/**
 * Handle changes in /modules directory
 */
function handleModuleChange(eventType, filename, fullPath) {
  const relativePath = relative(baseDir, fullPath);

  // New manifest.json = new module detected
  if (filename === 'manifest.json') {
    if (eventType === 'rename') {
      // 'rename' can mean created or deleted - check existence
      if (existsSync(fullPath)) {
        // New manifest - try to read module name
        try {
          const manifest = JSON.parse(readFileSync(fullPath, 'utf-8'));
          const moduleName = manifest.name || basename(dirname(fullPath));
          knownModules.add(moduleName);
          logEvent('CREATED', relativePath,
            `New module detected: ${moduleName} — restart to activate`);
        } catch {
          logEvent('CREATED', relativePath,
            'New module detected — restart to activate');
        }
      } else {
        // Manifest deleted
        const moduleName = basename(dirname(fullPath));
        knownModules.delete(moduleName);
        logEvent('DELETED', relativePath,
          `Module removed: ${moduleName} — restart to deactivate`);
      }
    } else if (eventType === 'change') {
      logEvent('MODIFIED', relativePath);
    }
    return;
  }

  // index.js changed = module code changed
  if (filename === 'index.js') {
    const moduleName = basename(dirname(fullPath));
    if (eventType === 'change') {
      logEvent('MODIFIED', relativePath,
        `Module code changed: ${moduleName} — restart to apply`);
    } else if (eventType === 'rename' && existsSync(fullPath)) {
      logEvent('CREATED', relativePath,
        `Module code added: ${moduleName} — restart to apply`);
    }
    return;
  }

  // Other files in modules
  if (eventType === 'change') {
    logEvent('MODIFIED', relativePath);
  } else if (eventType === 'rename') {
    if (existsSync(fullPath)) {
      logEvent('CREATED', relativePath);
    } else {
      logEvent('DELETED', relativePath);
    }
  }
}

/**
 * Handle changes in /themes directory
 */
function handleThemeChange(eventType, filename, fullPath) {
  const relativePath = relative(baseDir, fullPath);

  // New manifest.json in themes = new theme
  if (filename === 'manifest.json') {
    if (eventType === 'rename' && existsSync(fullPath)) {
      try {
        const manifest = JSON.parse(readFileSync(fullPath, 'utf-8'));
        const themeName = manifest.name || basename(dirname(fullPath));
        knownThemes.add(themeName);
        logEvent('CREATED', relativePath,
          `New theme detected: ${themeName}`);
      } catch {
        logEvent('CREATED', relativePath,
          'New theme detected');
      }
    } else if (eventType === 'rename' && !existsSync(fullPath)) {
      const themeName = basename(dirname(fullPath));
      knownThemes.delete(themeName);
      logEvent('DELETED', relativePath,
        `Theme removed: ${themeName}`);
    } else if (eventType === 'change') {
      logEvent('MODIFIED', relativePath);
    }
    return;
  }

  // Other theme files
  if (eventType === 'change') {
    logEvent('MODIFIED', relativePath);
  } else if (eventType === 'rename') {
    if (existsSync(fullPath)) {
      logEvent('CREATED', relativePath);
    } else {
      logEvent('DELETED', relativePath);
    }
  }
}

/**
 * Handle changes in /plugins directory
 *
 * WHY WATCH PLUGINS:
 * - Hot-swap capability means plugins can be reloaded without restart
 * - Detecting changes enables prompt-for-reload workflow
 * - Development mode can auto-reload on change
 */
function handlePluginChange(eventType, filename, fullPath) {
  const relativePath = relative(baseDir, fullPath);
  const pathParts = relativePath.split('/');

  // Plugin name is the directory under plugins/
  // e.g., plugins/seo/index.js -> pluginName = 'seo'
  const pluginName = pathParts.length >= 2 ? pathParts[1] : null;

  if (!pluginName) return;

  // plugin.json changes - new or modified plugin manifest
  if (filename === 'plugin.json') {
    if (eventType === 'rename') {
      if (existsSync(fullPath)) {
        try {
          const manifest = JSON.parse(readFileSync(fullPath, 'utf-8'));
          const name = manifest.name || pluginName;
          knownPlugins.add(name);
          logEvent('CREATED', relativePath,
            `New plugin detected: ${name}`);
          notifyPluginChange(name, 'created', relativePath);
        } catch {
          logEvent('CREATED', relativePath,
            'New plugin detected (manifest parse error)');
        }
      } else {
        knownPlugins.delete(pluginName);
        logEvent('DELETED', relativePath,
          `Plugin removed: ${pluginName}`);
        notifyPluginChange(pluginName, 'deleted', relativePath);
      }
    } else if (eventType === 'change') {
      logEvent('MODIFIED', relativePath,
        `Plugin manifest changed: ${pluginName} — reload to apply`);
      notifyPluginChange(pluginName, 'manifest', relativePath);
    }
    return;
  }

  // index.js changes - plugin code modified
  if (filename === 'index.js') {
    if (eventType === 'change') {
      logEvent('MODIFIED', relativePath,
        `Plugin code changed: ${pluginName} — reload to apply`);
      notifyPluginChange(pluginName, 'code', relativePath);
    } else if (eventType === 'rename' && existsSync(fullPath)) {
      logEvent('CREATED', relativePath,
        `Plugin code added: ${pluginName}`);
      notifyPluginChange(pluginName, 'code', relativePath);
    }
    return;
  }

  // config.json changes - plugin configuration modified
  if (filename === 'config.json') {
    if (eventType === 'change') {
      logEvent('MODIFIED', relativePath,
        `Plugin config changed: ${pluginName} — reload to apply`);
      notifyPluginChange(pluginName, 'config', relativePath);
    } else if (eventType === 'rename') {
      if (existsSync(fullPath)) {
        logEvent('CREATED', relativePath,
          `Plugin config added: ${pluginName}`);
      } else {
        logEvent('DELETED', relativePath,
          `Plugin config removed: ${pluginName}`);
      }
      notifyPluginChange(pluginName, 'config', relativePath);
    }
    return;
  }

  // Other plugin files
  if (eventType === 'change') {
    logEvent('MODIFIED', relativePath);
    notifyPluginChange(pluginName, 'file', relativePath);
  } else if (eventType === 'rename') {
    if (existsSync(fullPath)) {
      logEvent('CREATED', relativePath);
    } else {
      logEvent('DELETED', relativePath);
    }
    notifyPluginChange(pluginName, 'file', relativePath);
  }
}

/**
 * Notify listeners about plugin changes
 *
 * @param {string} pluginName - Name of the changed plugin
 * @param {string} changeType - Type: 'code', 'manifest', 'config', 'file', 'created', 'deleted'
 * @param {string} path - Relative path that changed
 * @private
 */
function notifyPluginChange(pluginName, changeType, path) {
  for (const callback of pluginChangeCallbacks) {
    try {
      callback({ pluginName, changeType, path, timestamp: timestamp() });
    } catch (error) {
      console.error(`[watcher] Plugin change callback error: ${error.message}`);
    }
  }
}

/**
 * Register a callback for plugin changes
 *
 * @param {Function} callback - Called with { pluginName, changeType, path, timestamp }
 * @returns {Function} - Unsubscribe function
 *
 * WHY RETURN UNSUBSCRIBE:
 * Allows callers to clean up when they no longer need notifications.
 * Important for hot-swap scenarios where listeners may come and go.
 */
export function onPluginChange(callback) {
  pluginChangeCallbacks.push(callback);
  return () => {
    const index = pluginChangeCallbacks.indexOf(callback);
    if (index > -1) {
      pluginChangeCallbacks.splice(index, 1);
    }
  };
}

/**
 * Get list of recently changed plugins
 *
 * @param {number} limit - Maximum number of entries to return
 * @returns {Array} - Recent plugin change events
 */
export function getRecentPluginChanges(limit = 10) {
  return recentEvents
    .filter(e => e.path.startsWith('plugins/'))
    .slice(-limit)
    .reverse();
}

/**
 * Handle changes in /config directory
 */
function handleConfigChange(eventType, filename, fullPath) {
  const relativePath = relative(baseDir, fullPath);

  // Only care about .json files
  if (!filename.endsWith('.json')) {
    return;
  }

  if (eventType === 'change') {
    logEvent('MODIFIED', relativePath);

    // Hot reload in development mode
    // WHY CHECK ENV:
    // Production shouldn't auto-reload - too risky.
    // Development benefits from fast iteration.
    if (siteConfig?.env === 'development') {
      const configName = filename.replace('.json', '');
      try {
        config.reload(configName);
        logEvent('RELOADED', relativePath,
          `Config reloaded: ${filename}`);
      } catch (error) {
        logEvent('ERROR', relativePath,
          `Config reload failed: ${error.message}`);
      }
    }
  } else if (eventType === 'rename') {
    if (existsSync(fullPath)) {
      logEvent('CREATED', relativePath,
        `New config file: ${filename}`);
    } else {
      logEvent('DELETED', relativePath,
        `Config file removed: ${filename}`);
    }
  }
}

/**
 * Create a watcher for a directory
 *
 * @param {string} dir - Directory to watch
 * @param {string} type - 'modules', 'themes', or 'config'
 */
function watchDirectory(dir, type) {
  if (!existsSync(dir)) {
    console.warn(`[watcher] Directory not found, skipping: ${dir}`);
    return null;
  }

  try {
    // WHY RECURSIVE: true
    // We want to catch changes in subdirectories (module/index.js, etc.)
    const watcher = watch(dir, { recursive: true }, (eventType, filename) => {
      if (!filename) return;

      const fullPath = join(dir, filename);
      const debounceKey = `${type}:${filename}:${eventType}`;

      // Debounce to handle duplicate fs.watch events
      debounce(debounceKey, () => {
        switch (type) {
          case 'modules':
            handleModuleChange(eventType, basename(filename), fullPath);
            break;
          case 'themes':
            handleThemeChange(eventType, basename(filename), fullPath);
            break;
          case 'config':
            handleConfigChange(eventType, basename(filename), fullPath);
            break;
          case 'plugins':
            handlePluginChange(eventType, basename(filename), fullPath);
            break;
        }
      });
    });

    watcher.on('error', (error) => {
      console.error(`[watcher] Error watching ${type}: ${error.message}`);
    });

    return watcher;
  } catch (error) {
    console.error(`[watcher] Failed to watch ${type}: ${error.message}`);
    return null;
  }
}

/**
 * Start watching directories
 *
 * @param {string} dir - Base directory (project root)
 * @param {Object} cfg - Site configuration (for env check)
 */
export function start(dir, cfg) {
  baseDir = dir;
  siteConfig = cfg;

  // Setup log directory and file
  const logsDir = join(baseDir, 'logs');
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }
  logFilePath = join(logsDir, 'watcher.log');

  // Directories to watch
  const pluginsDir = cfg?.plugins?.directory
    ? join(baseDir, cfg.plugins.directory)
    : join(baseDir, 'plugins');

  const watchDirs = [
    { path: join(baseDir, 'modules'), type: 'modules' },
    { path: join(baseDir, 'themes'), type: 'themes' },
    { path: join(baseDir, 'config'), type: 'config' },
    { path: pluginsDir, type: 'plugins' },
  ];

  // Start watchers
  const watchedNames = [];
  for (const { path, type } of watchDirs) {
    const watcher = watchDirectory(path, type);
    if (watcher) {
      watchers.push(watcher);
      watchedNames.push(type);
    }
  }

  // Log startup
  const hotReloadStatus = siteConfig?.env === 'development'
    ? 'hot config reload enabled'
    : 'hot reload disabled (not in development)';

  logEvent('WATCHING', watchedNames.join(', '),
    `File watcher started (${hotReloadStatus})`);

  return true;
}

/**
 * Stop all watchers
 */
export function stop() {
  for (const watcher of watchers) {
    try {
      watcher.close();
    } catch {
      // Ignore errors during cleanup
    }
  }
  watchers.length = 0;

  logEvent('STOPPED', '-', 'File watcher stopped');

  return true;
}

/**
 * Get recent events (last 50)
 *
 * WHY THIS EXISTS:
 * Useful for admin UI or debugging - see what changed recently
 */
export function getLog() {
  return [...recentEvents];
}

/**
 * Check if watcher is running
 */
export function isRunning() {
  return watchers.length > 0;
}

/**
 * Get watched directory count
 */
export function getWatchCount() {
  return watchers.length;
}
