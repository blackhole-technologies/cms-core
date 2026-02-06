/**
 * config.js - Configuration Loader
 *
 * WHY THIS EXISTS:
 * Configuration should be:
 * - External to code (change without redeploying)
 * - Environment-aware (dev vs staging vs prod)
 * - Type-safe-ish (validate on load, not at runtime)
 * - Centralized (one place to look for all settings)
 *
 * WHY JSON (not YAML, TOML, or .env):
 * - JSON is native to JavaScript (no parser dependency)
 * - Supports nested structures (unlike .env)
 * - Human-readable and widely understood
 * - Easy to validate with JSON Schema later
 *
 * DESIGN DECISION: Eager loading at boot
 * All configs are loaded during INIT phase. This means:
 * - Fail fast if config is missing or invalid
 * - No filesystem access during request handling
 * - Configs are frozen (immutable) after load
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Cached configuration objects
 * WHY CACHE: Configs are loaded once at boot, read many times after
 */
const configs = {};

/**
 * Path to config directory
 * WHY MUTABLE: Can be overridden for testing
 */
let configDir = null;

/**
 * Initialize the config loader with a base directory
 *
 * @param {string} baseDir - Project root directory (where /config lives)
 *
 * WHY EXPLICIT INITIALIZATION (not auto-detect):
 * - Makes the config location explicit and debuggable
 * - Allows tests to point to test-specific config directories
 * - No magic __dirname guessing that breaks in ESM
 */
export function init(baseDir) {
  configDir = join(baseDir, 'config');

  // WHY CHECK DIRECTORY EXISTS:
  // Fail fast with helpful error if directory is missing.
  // Better than cryptic "ENOENT" errors later.
  if (!existsSync(configDir)) {
    throw new Error(
      `Config directory not found: ${configDir}\n` +
      `Make sure /config exists in your project root.`
    );
  }
}

/**
 * Load a JSON config file
 *
 * @param {string} name - Config name (without .json extension)
 * @returns {Object} - Parsed and frozen config object
 *
 * WHY FREEZE:
 * Configs should be immutable after load. If code accidentally
 * modifies config, that's a bug. Object.freeze makes it throw.
 *
 * Example:
 *   const site = load('site'); // loads /config/site.json
 */
export function load(name) {
  // WHY CHECK INIT:
  // Provide helpful error if someone forgets to call init()
  if (!configDir) {
    throw new Error(
      `Config not initialized. Call config.init(baseDir) first.`
    );
  }

  // WHY CACHE CHECK:
  // Don't re-read filesystem for same config
  if (configs[name]) {
    return configs[name];
  }

  const filePath = join(configDir, `${name}.json`);

  // WHY CHECK FILE EXISTS:
  // Provide helpful error with the exact path we tried
  if (!existsSync(filePath)) {
    throw new Error(
      `Config file not found: ${filePath}\n` +
      `Create this file or check the config name.`
    );
  }

  try {
    // WHY SYNC READ (not async):
    // Config loading happens at boot, before any async operations.
    // Sync is simpler and there's no performance benefit to async here.
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);

    // WHY DEEP FREEZE:
    // Shallow freeze wouldn't protect nested objects.
    // We use a simple recursive freeze.
    const frozen = deepFreeze(parsed);

    // Cache for future calls
    configs[name] = frozen;

    return frozen;
  } catch (error) {
    // WHY WRAP ERROR:
    // Add context about which file failed to parse
    if (error instanceof SyntaxError) {
      throw new Error(
        `Invalid JSON in ${filePath}: ${error.message}`
      );
    }
    throw error;
  }
}

/**
 * Get a previously loaded config (doesn't load if not cached)
 *
 * WHY THIS EXISTS:
 * Sometimes you want to check if a config was loaded without
 * triggering a load. Useful for optional configs.
 */
export function get(name) {
  return configs[name] || null;
}

/**
 * Check if a config has been loaded
 */
export function has(name) {
  return name in configs;
}

/**
 * List all loaded config names
 */
export function list() {
  return Object.keys(configs);
}

/**
 * Clear cached configs (mainly for testing)
 */
export function clear() {
  for (const key of Object.keys(configs)) {
    delete configs[key];
  }
  configDir = null;
}

/**
 * Reload a specific config from disk
 *
 * WHY THIS EXISTS:
 * Hot reload in development mode. When a config file changes,
 * the watcher calls this to refresh the cached config.
 *
 * @param {string} name - Config name (without .json extension)
 * @returns {Object} - Fresh config object (frozen)
 *
 * WHY NOT JUST DELETE AND LOAD:
 * This is exactly what we do, but wrapped in a function for clarity.
 * The name "reload" communicates intent better than delete+load.
 */
export function reload(name) {
  // Remove from cache to force re-read
  delete configs[name];

  // Load fresh from disk
  return load(name);
}

/**
 * Get the config directory path
 *
 * WHY THIS EXISTS:
 * The watcher needs to know where configs live to watch them.
 */
export function getConfigDir() {
  return configDir;
}

/**
 * Deep freeze an object (recursive Object.freeze)
 *
 * WHY NOT USE A LIBRARY:
 * This is simple enough to implement ourselves.
 * Avoids a dependency for 10 lines of code.
 *
 * @param {*} obj - Object to freeze
 * @returns {*} - Frozen object (same reference)
 */
function deepFreeze(obj) {
  // WHY CHECK TYPE:
  // Only freeze actual objects, not primitives
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  // WHY FREEZE BEFORE RECURSING:
  // Prevents issues if object has circular references
  Object.freeze(obj);

  // Recursively freeze nested objects
  for (const value of Object.values(obj)) {
    deepFreeze(value);
  }

  return obj;
}
