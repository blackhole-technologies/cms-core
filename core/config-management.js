/**
 * config-management.js - Configuration Import/Export and Sync System
 *
 * WHY THIS EXISTS:
 * - Export/import full configuration state for backup/migration
 * - Sync configurations between development/staging/production
 * - Track configuration changes over time
 * - Validate configs against schemas before import
 * - Prevent accidental changes to locked configs
 * - Support environment-specific overrides
 *
 * DESIGN DECISIONS:
 * - Zero dependencies (Node.js standard library only)
 * - Archive format is ZIP-like tar with JSON manifest
 * - Hooks for integration with other systems
 * - Environment variables via {{ENV:X}} placeholder syntax
 * - Partial exports allow selective configuration sharing
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { createGzip, createUnzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { createReadStream, createWriteStream } from 'node:fs';

/**
 * Configuration registry and state
 */
let baseDir = null;
let configDir = null;
const registry = {
  configs: new Map(),
  environments: {},
  history: [],
  locked: new Set(),
  hooks: new Map()
};

/**
 * Initialize config management system
 *
 * @param {string} basePath - Project root directory
 *
 * WHY EXPLICIT INIT:
 * - Makes paths explicit and testable
 * - Loads existing registry if present
 * - Sets up default environment configurations
 */
export function init(basePath) {
  baseDir = basePath;
  configDir = join(baseDir, 'config');

  if (!existsSync(configDir)) {
    throw new Error(`Config directory not found: ${configDir}`);
  }

  // Load registry if exists, otherwise initialize
  const registryPath = join(configDir, '.registry.json');
  if (existsSync(registryPath)) {
    const data = JSON.parse(readFileSync(registryPath, 'utf-8'));

    // Restore configurations
    if (data.configs) {
      for (const [name, config] of Object.entries(data.configs)) {
        registry.configs.set(name, config);
      }
    }

    // Restore environments
    if (data.environments) {
      registry.environments = data.environments;
    }

    // Restore locked configs
    if (data.locked) {
      data.locked.forEach(name => registry.locked.add(name));
    }
  } else {
    // Initialize default environments
    registry.environments = {
      development: {},
      staging: {},
      production: {}
    };
  }

  // Auto-discover existing config files
  _discoverConfigs();
}

/**
 * Discover and register existing config files
 *
 * WHY AUTO-DISCOVERY:
 * - Reduces manual registration boilerplate
 * - Ensures all configs are tracked
 */
function _discoverConfigs() {
  const files = readdirSync(configDir);

  for (const file of files) {
    if (file.endsWith('.json') && !file.startsWith('.')) {
      const name = file.replace('.json', '');

      // Skip if already registered
      if (!registry.configs.has(name)) {
        registerConfig(name, file, null);
      }
    }
  }
}

/**
 * Register a configuration file
 *
 * @param {string} name - Config identifier
 * @param {string} file - Filename (relative to config dir)
 * @param {string|null} schema - Schema filename (optional)
 * @returns {Object} - Registered config metadata
 *
 * WHY SCHEMA IS OPTIONAL:
 * - Not all configs need strict validation
 * - Schemas can be added incrementally
 */
export function registerConfig(name, file, schema = null) {
  if (registry.configs.has(name)) {
    throw new Error(`Config "${name}" already registered`);
  }

  const config = {
    name,
    file,
    schema,
    locked: false,
    registeredAt: new Date().toISOString()
  };

  registry.configs.set(name, config);
  _saveRegistry();

  return config;
}

/**
 * Get configuration data
 *
 * @param {string} name - Config name
 * @returns {Object} - Configuration object
 */
export function getConfig(name) {
  const config = registry.configs.get(name);

  if (!config) {
    throw new Error(`Config "${name}" not registered`);
  }

  const filePath = join(configDir, config.file);

  if (!existsSync(filePath)) {
    throw new Error(`Config file not found: ${filePath}`);
  }

  const data = JSON.parse(readFileSync(filePath, 'utf-8'));
  return data;
}

/**
 * Set configuration data
 *
 * @param {string} name - Config name
 * @param {Object} value - New configuration value
 *
 * WHY VALIDATION HERE:
 * - Prevents invalid configs from being saved
 * - Enforces locking restrictions
 */
export function setConfig(name, value) {
  const config = registry.configs.get(name);

  if (!config) {
    throw new Error(`Config "${name}" not registered`);
  }

  if (registry.locked.has(name)) {
    throw new Error(`Config "${name}" is locked`);
  }

  // Validate against schema if present
  if (config.schema) {
    validateConfig(name, value);
  }

  // Trigger before-change hook
  _triggerHook('config:beforeChange', { name, value });

  const filePath = join(configDir, config.file);
  const oldValue = existsSync(filePath)
    ? JSON.parse(readFileSync(filePath, 'utf-8'))
    : null;

  // Write new config
  writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');

  // Record history
  _recordHistory(name, oldValue, value);

  // Trigger after-change hook
  _triggerHook('config:afterChange', { name, value, oldValue });
}

/**
 * Export configurations to archive
 *
 * @param {string[]|null} names - Config names to export (null = all)
 * @returns {Promise<string>} - Path to archive file
 *
 * WHY GZIP:
 * - Config files compress well (JSON is verbose)
 * - Standard format, readable by common tools
 * - Native Node.js support
 */
export async function exportConfig(names = null) {
  const exportNames = names || Array.from(registry.configs.keys());

  // Validate all requested configs exist
  for (const name of exportNames) {
    if (!registry.configs.has(name)) {
      throw new Error(`Config "${name}" not registered`);
    }
  }

  // Trigger before-export hook
  _triggerHook('config:beforeExport', { names: exportNames });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archiveName = `config-export-${timestamp}.json.gz`;
  const archivePath = join(baseDir, 'backups', archiveName);

  // Ensure backup directory exists
  const backupDir = join(baseDir, 'backups');
  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true });
  }

  // Build export package
  const exportData = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    configs: {}
  };

  for (const name of exportNames) {
    const config = registry.configs.get(name);
    const data = getConfig(name);

    exportData.configs[name] = {
      file: config.file,
      schema: config.schema,
      data,
      checksum: _checksum(data)
    };
  }

  // Write compressed archive
  const json = JSON.stringify(exportData, null, 2);
  const input = Buffer.from(json, 'utf-8');

  await pipeline(
    createReadStream(Buffer.from(input)),
    createGzip(),
    createWriteStream(archivePath)
  ).catch(() => {
    // Fallback to uncompressed if gzip fails
    writeFileSync(archivePath.replace('.gz', ''), json, 'utf-8');
    return archivePath.replace('.gz', '');
  });

  // Trigger after-export hook
  _triggerHook('config:afterExport', { names: exportNames, path: archivePath });

  return archivePath;
}

/**
 * Export all configurations
 *
 * @returns {Promise<string>} - Path to archive file
 */
export async function exportAllConfig() {
  return exportConfig(null);
}

/**
 * Import configurations from archive
 *
 * @param {string} archivePath - Path to archive file
 * @param {Object} options - Import options
 * @param {boolean} options.overwrite - Overwrite existing configs
 * @param {boolean} options.validate - Validate before import
 * @param {boolean} options.dryRun - Preview changes without applying
 * @returns {Object} - Import result summary
 *
 * WHY DRY RUN:
 * - Allows review of changes before applying
 * - Prevents accidental overwrites
 */
export async function importConfig(archivePath, options = {}) {
  const {
    overwrite = false,
    validate = true,
    dryRun = false
  } = options;

  if (!existsSync(archivePath)) {
    throw new Error(`Archive not found: ${archivePath}`);
  }

  // Read archive (try compressed first, then fallback to raw JSON)
  let exportData;

  try {
    // Try to decompress
    const chunks = [];
    await pipeline(
      createReadStream(archivePath),
      createUnzip(),
      async function* (source) {
        for await (const chunk of source) {
          chunks.push(chunk);
        }
      }
    );
    exportData = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  } catch {
    // Fallback to raw JSON
    exportData = JSON.parse(readFileSync(archivePath, 'utf-8'));
  }

  // Trigger before-import hook
  _triggerHook('config:beforeImport', { archivePath, options });

  const result = {
    imported: [],
    skipped: [],
    failed: [],
    dryRun
  };

  // Process each config
  for (const [name, configData] of Object.entries(exportData.configs)) {
    try {
      // Check if locked
      if (registry.locked.has(name)) {
        result.skipped.push({ name, reason: 'locked' });
        continue;
      }

      // Check if exists and overwrite not allowed
      if (registry.configs.has(name) && !overwrite) {
        result.skipped.push({ name, reason: 'exists' });
        continue;
      }

      // Validate checksum
      const checksum = _checksum(configData.data);
      if (checksum !== configData.checksum) {
        result.failed.push({ name, reason: 'checksum mismatch' });
        continue;
      }

      // Validate against schema if requested
      if (validate && configData.schema) {
        try {
          validateConfig(name, configData.data);
        } catch (error) {
          result.failed.push({ name, reason: `validation: ${error.message}` });
          continue;
        }
      }

      // Apply changes (unless dry run)
      if (!dryRun) {
        // Register if new
        if (!registry.configs.has(name)) {
          registerConfig(name, configData.file, configData.schema);
        }

        // Write config data
        const filePath = join(configDir, configData.file);
        writeFileSync(filePath, JSON.stringify(configData.data, null, 2), 'utf-8');

        // Record history
        _recordHistory(name, null, configData.data, 'import');
      }

      result.imported.push(name);
    } catch (error) {
      result.failed.push({ name, reason: error.message });
    }
  }

  // Trigger after-import hook
  _triggerHook('config:afterImport', { archivePath, result });

  return result;
}

/**
 * Compare configurations with archive
 *
 * @param {string} archivePath - Path to archive file
 * @returns {Promise<Object>} - Diff result
 *
 * WHY DIFF:
 * - Preview changes before import
 * - Identify configuration drift
 * - Support review workflows
 */
export async function diffConfig(archivePath) {
  if (!existsSync(archivePath)) {
    throw new Error(`Archive not found: ${archivePath}`);
  }

  // Read archive
  let exportData;

  try {
    const chunks = [];
    await pipeline(
      createReadStream(archivePath),
      createUnzip(),
      async function* (source) {
        for await (const chunk of source) {
          chunks.push(chunk);
        }
      }
    );
    exportData = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  } catch {
    exportData = JSON.parse(readFileSync(archivePath, 'utf-8'));
  }

  const diff = {
    added: [],
    modified: [],
    removed: [],
    unchanged: []
  };

  // Check archive configs against current
  for (const [name, archiveConfig] of Object.entries(exportData.configs)) {
    if (!registry.configs.has(name)) {
      diff.added.push(name);
    } else {
      const currentData = getConfig(name);
      const archiveChecksum = _checksum(archiveConfig.data);
      const currentChecksum = _checksum(currentData);

      if (archiveChecksum !== currentChecksum) {
        diff.modified.push({
          name,
          archiveChecksum,
          currentChecksum
        });
      } else {
        diff.unchanged.push(name);
      }
    }
  }

  // Check for removed configs
  const archiveNames = Object.keys(exportData.configs);
  for (const name of registry.configs.keys()) {
    if (!archiveNames.includes(name)) {
      diff.removed.push(name);
    }
  }

  return diff;
}

/**
 * Validate configuration against schema
 *
 * @param {string} name - Config name
 * @param {Object} value - Config value to validate
 *
 * WHY BASIC VALIDATION:
 * - Full JSON Schema requires dependencies
 * - Basic type checking covers most cases
 * - Can be extended with schema library later
 */
export function validateConfig(name, value) {
  const config = registry.configs.get(name);

  if (!config || !config.schema) {
    return true; // No schema = always valid
  }

  const schemaPath = join(configDir, config.schema);

  if (!existsSync(schemaPath)) {
    throw new Error(`Schema file not found: ${schemaPath}`);
  }

  const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));

  // Basic type validation
  if (schema.type && typeof value !== schema.type) {
    throw new Error(
      `Invalid type for "${name}": expected ${schema.type}, got ${typeof value}`
    );
  }

  // Required properties
  if (schema.required && Array.isArray(schema.required)) {
    for (const prop of schema.required) {
      if (!(prop in value)) {
        throw new Error(`Missing required property: ${prop}`);
      }
    }
  }

  return true;
}

/**
 * Get configuration change history
 *
 * @param {string} name - Config name
 * @returns {Array} - History entries
 */
export function getConfigHistory(name) {
  return registry.history.filter(entry => entry.config === name);
}

/**
 * Lock a configuration (prevent changes)
 *
 * @param {string} name - Config name
 */
export function lockConfig(name) {
  if (!registry.configs.has(name)) {
    throw new Error(`Config "${name}" not registered`);
  }

  registry.locked.add(name);
  _saveRegistry();

  _triggerHook('config:locked', { name });
}

/**
 * Unlock a configuration (allow changes)
 *
 * @param {string} name - Config name
 */
export function unlockConfig(name) {
  registry.locked.delete(name);
  _saveRegistry();

  _triggerHook('config:unlocked', { name });
}

/**
 * Get environment-specific configuration
 *
 * @param {string} env - Environment name
 * @returns {Object} - Environment config overrides
 */
export function getEnvironmentConfig(env) {
  if (!registry.environments[env]) {
    throw new Error(`Unknown environment: ${env}`);
  }

  return registry.environments[env];
}

/**
 * Apply environment overrides to configuration
 *
 * @param {string} env - Environment name
 * @returns {Object} - Result of applying overrides
 *
 * WHY ENVIRONMENT OVERRIDES:
 * - Different values needed per environment
 * - Avoid maintaining separate config files
 * - Support secrets via environment variables
 */
export function applyEnvironment(env) {
  const overrides = getEnvironmentConfig(env);
  const result = {
    applied: [],
    failed: []
  };

  for (const [key, value] of Object.entries(overrides)) {
    const [configName, ...path] = key.split('.');

    try {
      if (!registry.configs.has(configName)) {
        result.failed.push({ key, reason: 'config not found' });
        continue;
      }

      const config = getConfig(configName);

      // Apply nested path
      if (path.length === 0) {
        // Replace entire config
        setConfig(configName, value);
      } else {
        // Update nested property
        let target = config;
        for (let i = 0; i < path.length - 1; i++) {
          if (!target[path[i]]) {
            target[path[i]] = {};
          }
          target = target[path[i]];
        }
        target[path[path.length - 1]] = resolveEnvVars(value);
        setConfig(configName, config);
      }

      result.applied.push(key);
    } catch (error) {
      result.failed.push({ key, reason: error.message });
    }
  }

  _triggerHook('config:environmentApplied', { env, result });

  return result;
}

/**
 * Resolve environment variable placeholders
 *
 * @param {*} value - Value with potential placeholders
 * @returns {*} - Value with placeholders resolved
 *
 * WHY PLACEHOLDER SYNTAX:
 * - Explicit and easy to spot in configs
 * - Supports any environment variable
 * - Fails loudly if variable not set
 */
export function resolveEnvVars(value) {
  if (typeof value === 'string') {
    const match = value.match(/^\{\{ENV:(\w+)\}\}$/);

    if (match) {
      const envVar = match[1];

      if (!(envVar in process.env)) {
        throw new Error(`Environment variable not set: ${envVar}`);
      }

      return process.env[envVar];
    }
  } else if (Array.isArray(value)) {
    return value.map(resolveEnvVars);
  } else if (value && typeof value === 'object') {
    const resolved = {};
    for (const [k, v] of Object.entries(value)) {
      resolved[k] = resolveEnvVars(v);
    }
    return resolved;
  }

  return value;
}

/**
 * Register a hook callback
 *
 * @param {string} event - Hook event name
 * @param {Function} callback - Hook callback
 *
 * WHY HOOKS:
 * - Integration with audit logging
 * - Trigger notifications on config changes
 * - Custom validation logic
 */
export function on(event, callback) {
  if (!registry.hooks.has(event)) {
    registry.hooks.set(event, []);
  }

  registry.hooks.get(event).push(callback);
}

/**
 * Trigger hook callbacks
 *
 * @param {string} event - Hook event name
 * @param {Object} data - Event data
 */
function _triggerHook(event, data) {
  const hooks = registry.hooks.get(event);

  if (!hooks) {
    return;
  }

  for (const callback of hooks) {
    try {
      callback(data);
    } catch (error) {
      console.error(`Hook error [${event}]:`, error);
    }
  }
}

/**
 * Record configuration change in history
 *
 * @param {string} name - Config name
 * @param {*} oldValue - Previous value
 * @param {*} newValue - New value
 * @param {string} action - Action type
 */
function _recordHistory(name, oldValue, newValue, action = 'change') {
  registry.history.push({
    config: name,
    action,
    oldChecksum: oldValue ? _checksum(oldValue) : null,
    newChecksum: _checksum(newValue),
    timestamp: new Date().toISOString()
  });

  // Limit history size (keep last 100 entries per config)
  const configHistory = registry.history.filter(e => e.config === name);
  if (configHistory.length > 100) {
    const toRemove = configHistory.slice(0, configHistory.length - 100);
    registry.history = registry.history.filter(e => !toRemove.includes(e));
  }

  _saveRegistry();
}

/**
 * Calculate checksum of data
 *
 * @param {*} data - Data to checksum
 * @returns {string} - SHA256 checksum
 */
function _checksum(data) {
  const json = JSON.stringify(data);
  return createHash('sha256').update(json).digest('hex');
}

/**
 * Save registry to disk
 *
 * WHY PERSIST REGISTRY:
 * - Preserve config metadata across restarts
 * - Track locked configs
 * - Maintain history
 */
function _saveRegistry() {
  const registryPath = join(configDir, '.registry.json');

  const data = {
    configs: Object.fromEntries(registry.configs),
    environments: registry.environments,
    locked: Array.from(registry.locked),
    history: registry.history.slice(-1000) // Keep last 1000 entries
  };

  writeFileSync(registryPath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Get registry info (for debugging)
 *
 * @returns {Object} - Registry state
 */
export function getRegistry() {
  return {
    configs: Object.fromEntries(registry.configs),
    environments: registry.environments,
    locked: Array.from(registry.locked),
    historyCount: registry.history.length
  };
}

/**
 * Clear all data (testing only)
 *
 * WHY EXPOSED:
 * - Needed for test isolation
 * - Dangerous in production
 */
export function _clearForTesting() {
  baseDir = null;
  configDir = null;
  registry.configs.clear();
  registry.environments = {};
  registry.history = [];
  registry.locked.clear();
  registry.hooks.clear();
}
