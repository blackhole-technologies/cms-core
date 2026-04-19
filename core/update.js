/**
 * Update System - Drupal Style
 *
 * Handles schema changes and data migrations between versions.
 * Each module can define hook_update_N() functions.
 *
 * @version 1.0.0
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { pathToFileURL } from 'url';

// Configuration
const CONFIG_DIR = process.env.CMS_CONFIG_DIR || './config';
const MODULES_DIR = process.env.CMS_MODULES_DIR || './modules';
const SCHEMA_VERSIONS_FILE = join(CONFIG_DIR, 'schema-versions.json');
const INSTALLED_MODULES_FILE = join(CONFIG_DIR, 'installed-modules.json');
const UPDATE_LOG_FILE = join(CONFIG_DIR, 'update-log.json');

// In-memory caches
let schemaVersionsCache = null;
let installedModulesCache = null;
let updateLogCache = null;

/**
 * Initialize configuration directory
 */
async function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    await mkdir(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Load schema versions from disk
 */
async function loadSchemaVersions() {
  if (schemaVersionsCache !== null) {
    return schemaVersionsCache;
  }

  await ensureConfigDir();

  if (!existsSync(SCHEMA_VERSIONS_FILE)) {
    schemaVersionsCache = {};
    return schemaVersionsCache;
  }

  try {
    const data = await readFile(SCHEMA_VERSIONS_FILE, 'utf-8');
    schemaVersionsCache = JSON.parse(data);
    return schemaVersionsCache;
  } catch (error) {
    throw new Error(`Failed to load schema versions: ${error.message}`);
  }
}

/**
 * Save schema versions to disk
 */
async function saveSchemaVersions(versions) {
  await ensureConfigDir();

  try {
    await writeFile(
      SCHEMA_VERSIONS_FILE,
      JSON.stringify(versions, null, 2),
      'utf-8'
    );
    schemaVersionsCache = versions;
  } catch (error) {
    throw new Error(`Failed to save schema versions: ${error.message}`);
  }
}

/**
 * Load installed modules from disk
 */
async function loadInstalledModules() {
  if (installedModulesCache !== null) {
    return installedModulesCache;
  }

  await ensureConfigDir();

  if (!existsSync(INSTALLED_MODULES_FILE)) {
    installedModulesCache = {};
    return installedModulesCache;
  }

  try {
    const data = await readFile(INSTALLED_MODULES_FILE, 'utf-8');
    installedModulesCache = JSON.parse(data);
    return installedModulesCache;
  } catch (error) {
    throw new Error(`Failed to load installed modules: ${error.message}`);
  }
}

/**
 * Save installed modules to disk
 */
async function saveInstalledModules(modules) {
  await ensureConfigDir();

  try {
    await writeFile(
      INSTALLED_MODULES_FILE,
      JSON.stringify(modules, null, 2),
      'utf-8'
    );
    installedModulesCache = modules;
  } catch (error) {
    throw new Error(`Failed to save installed modules: ${error.message}`);
  }
}

/**
 * Load update log from disk
 */
async function loadUpdateLog() {
  if (updateLogCache !== null) {
    return updateLogCache;
  }

  await ensureConfigDir();

  if (!existsSync(UPDATE_LOG_FILE)) {
    updateLogCache = [];
    return updateLogCache;
  }

  try {
    const data = await readFile(UPDATE_LOG_FILE, 'utf-8');
    updateLogCache = JSON.parse(data);
    return updateLogCache;
  } catch (error) {
    throw new Error(`Failed to load update log: ${error.message}`);
  }
}

/**
 * Save update log to disk
 */
async function saveUpdateLog(log) {
  await ensureConfigDir();

  try {
    await writeFile(
      UPDATE_LOG_FILE,
      JSON.stringify(log, null, 2),
      'utf-8'
    );
    updateLogCache = log;
  } catch (error) {
    throw new Error(`Failed to save update log: ${error.message}`);
  }
}

/**
 * Log an update execution
 */
async function logUpdate(module, version, success, message, duration) {
  const log = await loadUpdateLog();

  log.push({
    module,
    version,
    success,
    message: message || '',
    duration,
    timestamp: new Date().toISOString()
  });

  await saveUpdateLog(log);
}

/**
 * Get current schema version for a module
 */
export async function getSchemaVersion(module) {
  if (typeof module !== 'string' || !module) {
    throw new Error('Module name must be a non-empty string');
  }

  const versions = await loadSchemaVersions();
  return versions[module] || 0;
}

/**
 * Set schema version for a module
 */
export async function setSchemaVersion(module, version) {
  if (typeof module !== 'string' || !module) {
    throw new Error('Module name must be a non-empty string');
  }

  if (typeof version !== 'number' || version < 0 || !Number.isInteger(version)) {
    throw new Error('Version must be a non-negative integer');
  }

  const versions = await loadSchemaVersions();
  versions[module] = version;
  await saveSchemaVersions(versions);
}

/**
 * Get last installed version for a module
 */
export async function getLastInstalledVersion(module) {
  if (typeof module !== 'string' || !module) {
    throw new Error('Module name must be a non-empty string');
  }

  const installed = await loadInstalledModules();
  return installed[module]?.version || null;
}

/**
 * Check if a module is installed
 */
export async function isModuleInstalled(module) {
  if (typeof module !== 'string' || !module) {
    throw new Error('Module name must be a non-empty string');
  }

  const installed = await loadInstalledModules();
  return !!installed[module];
}

/**
 * Get list of installed modules
 */
export async function getInstalledModules() {
  const installed = await loadInstalledModules();
  return Object.keys(installed);
}

/**
 * Load module file (updates, install, etc.)
 */
async function loadModuleFile(module, filename) {
  const modulePath = join(MODULES_DIR, module, filename);

  if (!existsSync(modulePath)) {
    return null;
  }

  try {
    const moduleUrl = pathToFileURL(modulePath).href;
    return await import(moduleUrl);
  } catch (error) {
    throw new Error(`Failed to load ${filename} for module ${module}: ${error.message}`);
  }
}

/**
 * Get available updates from a module's updates file
 */
async function getModuleUpdates(module) {
  const updatesModule = await loadModuleFile(module, 'updates.js');

  if (!updatesModule) {
    return {};
  }

  // Extract update functions (update_NNNN)
  const updates = {};
  const updatePattern = /^update_(\d+)$/;

  for (const [key, value] of Object.entries(updatesModule)) {
    const match = key.match(updatePattern);
    if (match && typeof value === 'function') {
      updates[parseInt(match[1], 10)] = value;
    }
  }

  return updates;
}

/**
 * Get all available updates across all modules
 */
export async function getAvailableUpdates() {
  const modules = await getInstalledModules();
  const allUpdates = {};

  for (const module of modules) {
    const updates = await getModuleUpdates(module);
    if (Object.keys(updates).length > 0) {
      allUpdates[module] = updates;
    }
  }

  return allUpdates;
}

/**
 * Get pending updates (not yet run)
 */
export async function getPendingUpdates() {
  const available = await getAvailableUpdates();
  const pending = {};

  for (const [module, updates] of Object.entries(available)) {
    const currentVersion = await getSchemaVersion(module);
    const pendingVersions = {};

    for (const [version, func] of Object.entries(updates)) {
      if (version > currentVersion) {
        pendingVersions[version] = func;
      }
    }

    if (Object.keys(pendingVersions).length > 0) {
      pending[module] = pendingVersions;
    }
  }

  return pending;
}

/**
 * Sort updates by version number across all modules
 */
function sortUpdatesByVersion(updates) {
  const sorted = [];

  for (const [module, moduleUpdates] of Object.entries(updates)) {
    for (const [version, func] of Object.entries(moduleUpdates)) {
      sorted.push({
        module,
        version: parseInt(version, 10),
        func
      });
    }
  }

  // Sort by version number (ascending)
  sorted.sort((a, b) => a.version - b.version);

  return sorted;
}

/**
 * Run a single update with sandbox support
 */
async function runSingleUpdate(module, version, func) {
  const sandbox = {
    '#finished': 0,
    initialized: false
  };

  let result = '';
  let iterations = 0;
  const maxIterations = 1000; // Prevent infinite loops

  const startTime = Date.now();

  try {
    while (sandbox['#finished'] < 1 && iterations < maxIterations) {
      result = await func(sandbox);
      iterations++;

      // Ensure #finished is valid
      if (typeof sandbox['#finished'] !== 'number') {
        sandbox['#finished'] = 1;
      }

      sandbox['#finished'] = Math.max(0, Math.min(1, sandbox['#finished']));

      // If no explicit finish set, assume complete
      if (!sandbox.hasOwnProperty('#finished')) {
        sandbox['#finished'] = 1;
      }
    }

    if (iterations >= maxIterations) {
      throw new Error(`Update exceeded maximum iterations (${maxIterations})`);
    }

    const duration = Date.now() - startTime;
    await logUpdate(module, version, true, result || 'Update completed', duration);

    return {
      success: true,
      message: result || 'Update completed',
      duration
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    await logUpdate(module, version, false, error.message, duration);

    return {
      success: false,
      error: error.message,
      duration
    };
  }
}

/**
 * Run a specific update
 */
export async function runUpdate(module, number) {
  if (typeof module !== 'string' || !module) {
    throw new Error('Module name must be a non-empty string');
  }

  if (typeof number !== 'number' || number < 0 || !Number.isInteger(number)) {
    throw new Error('Update number must be a non-negative integer');
  }

  const updates = await getModuleUpdates(module);
  const func = updates[number];

  if (!func) {
    throw new Error(`Update ${number} not found for module ${module}`);
  }

  const result = await runSingleUpdate(module, number, func);

  if (result.success) {
    await setSchemaVersion(module, number);
  }

  return result;
}

/**
 * Run updates
 */
export async function runUpdates(updates = null) {
  const toRun = updates || await getPendingUpdates();

  if (Object.keys(toRun).length === 0) {
    return {
      success: true,
      message: 'No updates to run',
      results: []
    };
  }

  const sorted = sortUpdatesByVersion(toRun);
  const results = [];

  for (const { module, version, func } of sorted) {
    const result = await runSingleUpdate(module, version, func);

    results.push({
      module,
      version,
      ...result
    });

    if (result.success) {
      await setSchemaVersion(module, version);
    } else {
      // Stop on first failure
      return {
        success: false,
        message: `Update failed: ${module}.update_${version}`,
        results
      };
    }
  }

  return {
    success: true,
    message: `Successfully ran ${results.length} update(s)`,
    results
  };
}

/**
 * Get module schema from install file
 */
export async function getModuleSchema(module) {
  if (typeof module !== 'string' || !module) {
    throw new Error('Module name must be a non-empty string');
  }

  const installModule = await loadModuleFile(module, 'install.js');

  if (!installModule || !installModule.schema) {
    return null;
  }

  if (typeof installModule.schema !== 'function') {
    throw new Error(`Schema for module ${module} must be a function`);
  }

  return installModule.schema();
}

/**
 * Check module requirements
 */
export async function checkRequirements(module, phase = 'install') {
  if (typeof module !== 'string' || !module) {
    throw new Error('Module name must be a non-empty string');
  }

  const installModule = await loadModuleFile(module, 'install.js');

  if (!installModule || !installModule.requirements) {
    return [];
  }

  if (typeof installModule.requirements !== 'function') {
    throw new Error(`Requirements for module ${module} must be a function`);
  }

  return installModule.requirements(phase);
}

/**
 * Install module schema
 */
export async function installSchema(module) {
  if (typeof module !== 'string' || !module) {
    throw new Error('Module name must be a non-empty string');
  }

  const schema = await getModuleSchema(module);

  if (!schema) {
    return;
  }

  // Create tables from schema
  if (schema.tables) {
    for (const [tableName, tableSpec] of Object.entries(schema.tables)) {
      await createTable(tableName, tableSpec);
    }
  }
}

/**
 * Uninstall module schema
 */
export async function uninstallSchema(module) {
  if (typeof module !== 'string' || !module) {
    throw new Error('Module name must be a non-empty string');
  }

  const schema = await getModuleSchema(module);

  if (!schema || !schema.tables) {
    return;
  }

  // Drop tables in reverse order to handle dependencies
  const tables = Object.keys(schema.tables).reverse();

  for (const tableName of tables) {
    await dropTable(tableName);
  }
}

/**
 * Install a module
 */
export async function installModule(module) {
  if (typeof module !== 'string' || !module) {
    throw new Error('Module name must be a non-empty string');
  }

  if (await isModuleInstalled(module)) {
    throw new Error(`Module ${module} is already installed`);
  }

  // Check requirements
  const requirements = await checkRequirements(module, 'install');
  const errors = requirements.filter(r => r.severity === 'error');

  if (errors.length > 0) {
    throw new Error(`Module ${module} has unmet requirements: ${errors.map(e => e.message).join(', ')}`);
  }

  // Install schema
  await installSchema(module);

  // Run install hook
  const installHook = await loadModuleFile(module, 'install.js');

  if (installHook && installHook.install) {
    if (typeof installHook.install !== 'function') {
      throw new Error(`Install hook for module ${module} must be a function`);
    }

    await installHook.install();
  }

  // Mark as installed
  const installed = await loadInstalledModules();
  const updates = await getModuleUpdates(module);
  const versions = Object.keys(updates).map(v => parseInt(v, 10));
  const latestVersion = versions.length > 0 ? Math.max(...versions) : 0;

  installed[module] = {
    version: latestVersion,
    installed: new Date().toISOString()
  };

  await saveInstalledModules(installed);
  await setSchemaVersion(module, latestVersion);
}

/**
 * Uninstall a module
 */
export async function uninstallModule(module) {
  if (typeof module !== 'string' || !module) {
    throw new Error('Module name must be a non-empty string');
  }

  if (!await isModuleInstalled(module)) {
    throw new Error(`Module ${module} is not installed`);
  }

  // Run uninstall hook
  const installHook = await loadModuleFile(module, 'install.js');

  if (installHook && installHook.uninstall) {
    if (typeof installHook.uninstall !== 'function') {
      throw new Error(`Uninstall hook for module ${module} must be a function`);
    }

    await installHook.uninstall();
  }

  // Uninstall schema
  await uninstallSchema(module);

  // Remove from installed modules
  const installed = await loadInstalledModules();
  delete installed[module];
  await saveInstalledModules(installed);

  // Remove schema version
  const versions = await loadSchemaVersions();
  delete versions[module];
  await saveSchemaVersions(versions);
}

// Database update functions
// These are stubs - implement based on your database layer

/**
 * Add a field to a table
 */
export async function addField(table, field, spec) {
  if (!table || !field || !spec) {
    throw new Error('Table, field, and spec are required');
  }

  // TODO: Implement based on database layer
  console.log(`Adding field ${field} to table ${table}`, spec);
}

/**
 * Drop a field from a table
 */
export async function dropField(table, field) {
  if (!table || !field) {
    throw new Error('Table and field are required');
  }

  // TODO: Implement based on database layer
  console.log(`Dropping field ${field} from table ${table}`);
}

/**
 * Change a field in a table
 */
export async function changeField(table, field, newName, spec) {
  if (!table || !field || !newName || !spec) {
    throw new Error('Table, field, newName, and spec are required');
  }

  // TODO: Implement based on database layer
  console.log(`Changing field ${field} to ${newName} in table ${table}`, spec);
}

/**
 * Create a table
 */
export async function createTable(table, spec) {
  if (!table || !spec) {
    throw new Error('Table and spec are required');
  }

  // TODO: Implement based on database layer
  console.log(`Creating table ${table}`, spec);
}

/**
 * Drop a table
 */
export async function dropTable(table) {
  if (!table) {
    throw new Error('Table is required');
  }

  // TODO: Implement based on database layer
  console.log(`Dropping table ${table}`);
}

/**
 * Add an index to a table
 */
export async function addIndex(table, name, fields) {
  if (!table || !name || !fields) {
    throw new Error('Table, name, and fields are required');
  }

  // TODO: Implement based on database layer
  console.log(`Adding index ${name} to table ${table}`, fields);
}

/**
 * Drop an index from a table
 */
export async function dropIndex(table, name) {
  if (!table || !name) {
    throw new Error('Table and name are required');
  }

  // TODO: Implement based on database layer
  console.log(`Dropping index ${name} from table ${table}`);
}

/**
 * Rename a table
 */
export async function renameTable(oldName, newName) {
  if (!oldName || !newName) {
    throw new Error('Old name and new name are required');
  }

  // TODO: Implement based on database layer
  console.log(`Renaming table ${oldName} to ${newName}`);
}

/**
 * Execute a SQL query
 */
export async function query(sql) {
  if (!sql) {
    throw new Error('SQL query is required');
  }

  // TODO: Implement based on database layer
  console.log('Executing query:', sql);
  return [];
}

/**
 * Batch update helper
 */
export async function batchUpdate(table, callback, batchSize = 100) {
  if (!table || !callback) {
    throw new Error('Table and callback are required');
  }

  if (typeof callback !== 'function') {
    throw new Error('Callback must be a function');
  }

  if (typeof batchSize !== 'number' || batchSize < 1) {
    throw new Error('Batch size must be a positive number');
  }

  // TODO: Implement based on database layer
  console.log(`Batch updating table ${table} with batch size ${batchSize}`);
}

/**
 * Entity update helper
 */
export async function entityUpdate(entityType, callback) {
  if (!entityType || !callback) {
    throw new Error('Entity type and callback are required');
  }

  if (typeof callback !== 'function') {
    throw new Error('Callback must be a function');
  }

  // TODO: Implement based on entity system
  console.log(`Updating entities of type ${entityType}`);
}

/**
 * Get update report
 */
export async function getUpdateReport() {
  const pending = await getPendingUpdates();
  const installed = await getInstalledModules();
  const versions = await loadSchemaVersions();
  const log = await loadUpdateLog();

  const report = {
    installed_modules: installed.length,
    total_pending_updates: 0,
    pending_by_module: {},
    current_versions: versions,
    recent_updates: log.slice(-10).reverse()
  };

  for (const [module, updates] of Object.entries(pending)) {
    const count = Object.keys(updates).length;
    report.total_pending_updates += count;
    report.pending_by_module[module] = {
      count,
      versions: Object.keys(updates).map(v => parseInt(v, 10)).sort((a, b) => a - b)
    };
  }

  return report;
}

/**
 * Format update output for display
 */
export function formatUpdateOutput(results) {
  if (!results || !results.results) {
    return 'No results to format';
  }

  let output = `Update Results (${results.success ? 'SUCCESS' : 'FAILED'}):\n`;
  output += `${results.message}\n\n`;

  for (const result of results.results) {
    const status = result.success ? '✓' : '✗';
    output += `${status} ${result.module}.update_${result.version}`;

    if (result.duration) {
      output += ` (${result.duration}ms)`;
    }

    output += '\n';

    if (result.message) {
      output += `  ${result.message}\n`;
    }

    if (result.error) {
      output += `  Error: ${result.error}\n`;
    }
  }

  return output;
}

// ============================================
// AUTO-UPDATE FROM REGISTRY
// ============================================

const REGISTRY_CONFIG_FILE = join(CONFIG_DIR, 'registry.json');
let registryConfig = {
  url: 'https://registry.cms-core.io/api/v1',
  checkInterval: 86400000,  // 24 hours in ms
  autoCheck: true,
  lastCheck: null,
};

/**
 * Load registry configuration from disk, or initialize with defaults.
 */
async function loadRegistryConfig() {
  await ensureConfigDir();
  if (existsSync(REGISTRY_CONFIG_FILE)) {
    try {
      const data = await readFile(REGISTRY_CONFIG_FILE, 'utf-8');
      registryConfig = { ...registryConfig, ...JSON.parse(data) };
    } catch { /* use defaults */ }
  }
  return registryConfig;
}

/**
 * Save registry configuration to disk.
 */
async function saveRegistryConfig() {
  await ensureConfigDir();
  await writeFile(REGISTRY_CONFIG_FILE, JSON.stringify(registryConfig, null, 2), 'utf-8');
}

/**
 * Get or set the module registry URL.
 * @param {string} [url] - New registry URL (if setting)
 * @returns {string} Current registry URL
 */
export async function getRegistryUrl(url) {
  await loadRegistryConfig();
  if (url) {
    registryConfig.url = url;
    await saveRegistryConfig();
  }
  return registryConfig.url;
}

/**
 * Check the remote registry for available module updates.
 * Compares locally installed module versions against the registry catalog.
 *
 * @returns {{ available: Object[], lastCheck: string, registryUrl: string }}
 *   available: Array of { module, currentVersion, latestVersion, changelog }
 */
export async function checkRegistryForUpdates() {
  await loadRegistryConfig();
  const installed = await loadInstalledModules();
  const available = [];

  try {
    // Fetch the registry catalog (list of available module versions)
    const catalogUrl = `${registryConfig.url}/catalog`;
    const response = await fetch(catalogUrl, {
      headers: { 'User-Agent': 'CMS-Core-Update/1.0' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`Registry returned ${response.status}: ${response.statusText}`);
    }

    const catalog = await response.json();

    // Compare installed versions against registry
    for (const [module, info] of Object.entries(installed)) {
      const remoteModule = catalog.modules?.[module];
      if (!remoteModule) continue;

      const currentVersion = info.version || '0.0.0';
      const latestVersion = remoteModule.latest || remoteModule.version;

      if (latestVersion && compareVersions(latestVersion, currentVersion) > 0) {
        available.push({
          module,
          currentVersion,
          latestVersion,
          changelog: remoteModule.changelog || null,
          downloadUrl: remoteModule.downloadUrl || null,
        });
      }
    }

    // Update last check timestamp
    registryConfig.lastCheck = new Date().toISOString();
    await saveRegistryConfig();

  } catch (error) {
    console.warn(`[update] Registry check failed: ${error.message}`);
    return {
      available: [],
      error: error.message,
      lastCheck: registryConfig.lastCheck,
      registryUrl: registryConfig.url,
    };
  }

  return {
    available,
    lastCheck: registryConfig.lastCheck,
    registryUrl: registryConfig.url,
  };
}

/**
 * Download a module update from the registry and extract it into modules/.
 * Does NOT run update hooks — call runUpdates() after downloading.
 *
 * @param {string} module - Module name
 * @param {string} version - Target version
 * @returns {{ success: boolean, message: string }}
 */
export async function downloadModuleUpdate(module, version) {
  await loadRegistryConfig();

  try {
    // Fetch module package metadata
    const metaUrl = `${registryConfig.url}/modules/${module}/${version}`;
    const metaRes = await fetch(metaUrl, {
      headers: { 'User-Agent': 'CMS-Core-Update/1.0' },
      signal: AbortSignal.timeout(15000),
    });

    if (!metaRes.ok) {
      throw new Error(`Registry returned ${metaRes.status} for ${module}@${version}`);
    }

    const meta = await metaRes.json();
    const downloadUrl = meta.downloadUrl || meta.tarball;

    if (!downloadUrl) {
      throw new Error(`No download URL for ${module}@${version}`);
    }

    // Download the module package
    const pkgRes = await fetch(downloadUrl, {
      signal: AbortSignal.timeout(60000),
    });

    if (!pkgRes.ok) {
      throw new Error(`Download failed: ${pkgRes.status}`);
    }

    const moduleDir = join(MODULES_DIR, module);
    if (!existsSync(moduleDir)) {
      await mkdir(moduleDir, { recursive: true });
    }

    // Write the package data (JSON module bundle)
    const packageData = await pkgRes.json();

    // Write each file from the package
    for (const [filename, content] of Object.entries(packageData.files || {})) {
      const filePath = join(moduleDir, filename);
      const fileDir = dirname(filePath);
      if (!existsSync(fileDir)) {
        await mkdir(fileDir, { recursive: true });
      }
      await writeFile(filePath, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf-8');
    }

    // Update installed module version
    const installed = await loadInstalledModules();
    if (installed[module]) {
      installed[module].version = version;
      installed[module].updatedAt = new Date().toISOString();
    }
    await saveInstalledModules(installed);

    // Log the update
    const log = await loadUpdateLog();
    log.push({
      type: 'registry_download',
      module,
      version,
      timestamp: new Date().toISOString(),
    });
    await saveUpdateLog(log);

    return { success: true, message: `Downloaded ${module}@${version}` };

  } catch (error) {
    return { success: false, message: `Failed to download ${module}@${version}: ${error.message}` };
  }
}

/**
 * Orchestrate a full auto-update: check registry, download updates, run migrations.
 *
 * @param {Object} options
 * @param {boolean} options.dryRun - Only check, don't download or run updates
 * @param {string[]} options.modules - Only update specific modules (default: all)
 * @returns {{ checked: number, downloaded: number, updated: number, results: Object[] }}
 */
export async function autoUpdate(options = {}) {
  const { dryRun = false, modules: onlyModules = null } = options;
  const report = { checked: 0, downloaded: 0, updated: 0, results: [] };

  // Step 1: Check registry
  const check = await checkRegistryForUpdates();
  let available = check.available || [];
  report.checked = available.length;

  if (onlyModules) {
    available = available.filter(u => onlyModules.includes(u.module));
  }

  if (dryRun || available.length === 0) {
    report.results = available.map(u => ({
      module: u.module,
      currentVersion: u.currentVersion,
      latestVersion: u.latestVersion,
      action: dryRun ? 'would_update' : 'up_to_date',
    }));
    return report;
  }

  // Step 2: Download each update
  for (const update of available) {
    const dlResult = await downloadModuleUpdate(update.module, update.latestVersion);
    if (dlResult.success) {
      report.downloaded++;
      report.results.push({
        module: update.module,
        currentVersion: update.currentVersion,
        latestVersion: update.latestVersion,
        action: 'downloaded',
      });
    } else {
      report.results.push({
        module: update.module,
        action: 'download_failed',
        error: dlResult.message,
      });
    }
  }

  // Step 3: Run pending update hooks for downloaded modules
  const pending = await getPendingUpdates();
  for (const update of available) {
    if (pending[update.module]) {
      try {
        const updateResults = await runUpdates({ [update.module]: pending[update.module] });
        if (updateResults.success) {
          report.updated++;
        }
      } catch (err) {
        report.results.push({
          module: update.module,
          action: 'update_hooks_failed',
          error: err.message,
        });
      }
    }
  }

  return report;
}

/**
 * Compare two semver-like version strings.
 * Returns >0 if a > b, <0 if a < b, 0 if equal.
 */
function compareVersions(a, b) {
  const pa = (a || '0').split('.').map(Number);
  const pb = (b || '0').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}
