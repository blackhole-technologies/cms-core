/**
 * Update System - Drupal Style
 *
 * Handles schema changes and data migrations between versions.
 * Each module can define hook_update_N() functions.
 *
 * SECURITY HARDENING (Task 17 + 18, v0.2.0):
 *   - downloadModuleUpdate() now validates every filename in a registry
 *     response with assertSafeChildPath() to reject path-traversal (../..),
 *     absolute paths, and null-byte injection before writing to disk.
 *   - getRegistryUrl() rejects any scheme other than https:// (localhost and
 *     127.0.0.1 are permitted on http for local-dev registries).
 *   - downloadModuleUpdate()/autoUpdate() reject downgrades via compareVersions.
 *   - The `autoCheck` default is now false. Operators must opt in.
 *   - Optional per-file SHA-256 manifest verification (when registry supplies
 *     `files[filename].sha256`) after each write.
 *
 * Signature verification (e.g. Ed25519 over the catalog payload) is a larger
 * supply-chain workstream and is intentionally deferred; callers should treat
 * the registry URL as trusted and rely on TLS + the above guards until then.
 *
 * @version 1.0.0
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

// ============================================================================
// Types
// ============================================================================

type SchemaVersions = Record<string, number>;

interface InstalledModuleInfo {
  version: number | string;
  installed?: string;
  updatedAt?: string;
}
type InstalledModules = Record<string, InstalledModuleInfo>;

interface UpdateLogEntry {
  module?: string;
  version?: number | string;
  success?: boolean;
  message?: string;
  duration?: number;
  timestamp: string;
  type?: string;
}
type UpdateLog = UpdateLogEntry[];

/** Sandbox passed to each update_N() function. */
interface UpdateSandbox {
  '#finished': number;
  initialized: boolean;
  [key: string]: unknown;
}

type UpdateFunction = (sandbox: UpdateSandbox) => string | Promise<string>;

interface UpdateRunResult {
  success: boolean;
  message?: string;
  error?: string;
  duration: number;
}

interface ModuleUpdateRecord {
  module: string;
  version: number;
  success: boolean;
  message?: string;
  error?: string;
  duration: number;
}

interface RunUpdatesResult {
  success: boolean;
  message: string;
  results: ModuleUpdateRecord[];
}

interface ModuleSchema {
  tables?: Record<string, unknown>;
  [key: string]: unknown;
}

interface RequirementReport {
  severity: 'error' | 'warning' | 'info';
  message: string;
  [key: string]: unknown;
}

interface ModuleInstallExports {
  schema?: () => ModuleSchema | Promise<ModuleSchema>;
  requirements?: (phase: string) => RequirementReport[] | Promise<RequirementReport[]>;
  install?: () => void | Promise<void>;
  uninstall?: () => void | Promise<void>;
  [key: string]: unknown;
}

interface RegistryConfig {
  url: string;
  checkInterval: number;
  autoCheck: boolean;
  lastCheck: string | null;
}

interface RegistryCatalogEntry {
  latest?: string;
  version?: string;
  changelog?: string | null;
  downloadUrl?: string | null;
  [key: string]: unknown;
}
interface RegistryCatalog {
  modules?: Record<string, RegistryCatalogEntry>;
}

interface AvailableUpdate {
  module: string;
  currentVersion: string;
  latestVersion: string;
  changelog: string | null;
  downloadUrl: string | null;
}

interface PackageFileEntry {
  /** File contents, either as a string or a JSON-serializable object. */
  content?: string | unknown;
  /** Optional SHA-256 hex digest of the UTF-8 content for verification. */
  sha256?: string;
}

interface RegistryPackage {
  downloadUrl?: string;
  tarball?: string;
  files?: Record<string, string | PackageFileEntry | unknown>;
}

// ============================================================================
// Configuration
// ============================================================================

const CONFIG_DIR = process.env.CMS_CONFIG_DIR || './config';
const MODULES_DIR = process.env.CMS_MODULES_DIR || './modules';
const SCHEMA_VERSIONS_FILE = join(CONFIG_DIR, 'schema-versions.json');
const INSTALLED_MODULES_FILE = join(CONFIG_DIR, 'installed-modules.json');
const UPDATE_LOG_FILE = join(CONFIG_DIR, 'update-log.json');

// In-memory caches
let schemaVersionsCache: SchemaVersions | null = null;
let installedModulesCache: InstalledModules | null = null;
let updateLogCache: UpdateLog | null = null;

async function ensureConfigDir(): Promise<void> {
  if (!existsSync(CONFIG_DIR)) {
    await mkdir(CONFIG_DIR, { recursive: true });
  }
}

async function loadSchemaVersions(): Promise<SchemaVersions> {
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
    schemaVersionsCache = JSON.parse(data) as SchemaVersions;
    return schemaVersionsCache;
  } catch (error) {
    throw new Error(`Failed to load schema versions: ${(error as Error).message}`);
  }
}

async function saveSchemaVersions(versions: SchemaVersions): Promise<void> {
  await ensureConfigDir();
  try {
    await writeFile(SCHEMA_VERSIONS_FILE, JSON.stringify(versions, null, 2), 'utf-8');
    schemaVersionsCache = versions;
  } catch (error) {
    throw new Error(`Failed to save schema versions: ${(error as Error).message}`);
  }
}

async function loadInstalledModules(): Promise<InstalledModules> {
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
    installedModulesCache = JSON.parse(data) as InstalledModules;
    return installedModulesCache;
  } catch (error) {
    throw new Error(`Failed to load installed modules: ${(error as Error).message}`);
  }
}

async function saveInstalledModules(modules: InstalledModules): Promise<void> {
  await ensureConfigDir();
  try {
    await writeFile(INSTALLED_MODULES_FILE, JSON.stringify(modules, null, 2), 'utf-8');
    installedModulesCache = modules;
  } catch (error) {
    throw new Error(`Failed to save installed modules: ${(error as Error).message}`);
  }
}

async function loadUpdateLog(): Promise<UpdateLog> {
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
    updateLogCache = JSON.parse(data) as UpdateLog;
    return updateLogCache;
  } catch (error) {
    throw new Error(`Failed to load update log: ${(error as Error).message}`);
  }
}

async function saveUpdateLog(log: UpdateLog): Promise<void> {
  await ensureConfigDir();
  try {
    await writeFile(UPDATE_LOG_FILE, JSON.stringify(log, null, 2), 'utf-8');
    updateLogCache = log;
  } catch (error) {
    throw new Error(`Failed to save update log: ${(error as Error).message}`);
  }
}

async function logUpdate(
  module: string,
  version: number | string,
  success: boolean,
  message: string,
  duration: number
): Promise<void> {
  const log = await loadUpdateLog();
  log.push({
    module,
    version,
    success,
    message: message || '',
    duration,
    timestamp: new Date().toISOString(),
  });
  await saveUpdateLog(log);
}

/**
 * Get current schema version for a module.
 */
export async function getSchemaVersion(module: string): Promise<number> {
  if (typeof module !== 'string' || !module) {
    throw new Error('Module name must be a non-empty string');
  }
  const versions = await loadSchemaVersions();
  return versions[module] || 0;
}

export async function setSchemaVersion(module: string, version: number): Promise<void> {
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

export async function getLastInstalledVersion(
  module: string
): Promise<number | string | null> {
  if (typeof module !== 'string' || !module) {
    throw new Error('Module name must be a non-empty string');
  }
  const installed = await loadInstalledModules();
  return installed[module]?.version ?? null;
}

export async function isModuleInstalled(module: string): Promise<boolean> {
  if (typeof module !== 'string' || !module) {
    throw new Error('Module name must be a non-empty string');
  }
  const installed = await loadInstalledModules();
  return !!installed[module];
}

export async function getInstalledModules(): Promise<string[]> {
  const installed = await loadInstalledModules();
  return Object.keys(installed);
}

async function loadModuleFile(
  module: string,
  filename: string
): Promise<(ModuleInstallExports & Record<string, unknown>) | null> {
  const modulePath = join(MODULES_DIR, module, filename);
  if (!existsSync(modulePath)) {
    return null;
  }
  try {
    const moduleUrl = pathToFileURL(modulePath).href;
    return (await import(moduleUrl)) as ModuleInstallExports & Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Failed to load ${filename} for module ${module}: ${(error as Error).message}`
    );
  }
}

async function getModuleUpdates(module: string): Promise<Record<number, UpdateFunction>> {
  const updatesModule = await loadModuleFile(module, 'updates.js');
  if (!updatesModule) return {};

  const updates: Record<number, UpdateFunction> = {};
  const updatePattern = /^update_(\d+)$/;
  for (const [key, value] of Object.entries(updatesModule)) {
    const match = key.match(updatePattern);
    if (match && match[1] && typeof value === 'function') {
      updates[parseInt(match[1], 10)] = value as UpdateFunction;
    }
  }
  return updates;
}

export async function getAvailableUpdates(): Promise<
  Record<string, Record<number, UpdateFunction>>
> {
  const modules = await getInstalledModules();
  const allUpdates: Record<string, Record<number, UpdateFunction>> = {};
  for (const module of modules) {
    const updates = await getModuleUpdates(module);
    if (Object.keys(updates).length > 0) {
      allUpdates[module] = updates;
    }
  }
  return allUpdates;
}

export async function getPendingUpdates(): Promise<
  Record<string, Record<number, UpdateFunction>>
> {
  const available = await getAvailableUpdates();
  const pending: Record<string, Record<number, UpdateFunction>> = {};

  for (const [module, updates] of Object.entries(available)) {
    const currentVersion = await getSchemaVersion(module);
    const pendingVersions: Record<number, UpdateFunction> = {};

    for (const [versionStr, func] of Object.entries(updates)) {
      const version = parseInt(versionStr, 10);
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

interface SortedUpdate {
  module: string;
  version: number;
  func: UpdateFunction;
}

function sortUpdatesByVersion(
  updates: Record<string, Record<number, UpdateFunction>>
): SortedUpdate[] {
  const sorted: SortedUpdate[] = [];
  for (const [module, moduleUpdates] of Object.entries(updates)) {
    for (const [versionStr, func] of Object.entries(moduleUpdates)) {
      sorted.push({
        module,
        version: parseInt(versionStr, 10),
        func,
      });
    }
  }
  sorted.sort((a, b) => a.version - b.version);
  return sorted;
}

async function runSingleUpdate(
  module: string,
  version: number,
  func: UpdateFunction
): Promise<UpdateRunResult> {
  const sandbox: UpdateSandbox = {
    '#finished': 0,
    initialized: false,
  };

  let result = '';
  let iterations = 0;
  const maxIterations = 1000; // Prevent infinite loops
  const startTime = Date.now();

  try {
    while (sandbox['#finished'] < 1 && iterations < maxIterations) {
      result = await func(sandbox);
      iterations++;

      if (typeof sandbox['#finished'] !== 'number') {
        sandbox['#finished'] = 1;
      }

      sandbox['#finished'] = Math.max(0, Math.min(1, sandbox['#finished']));

      if (!Object.prototype.hasOwnProperty.call(sandbox, '#finished')) {
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
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const message = (error as Error).message;
    await logUpdate(module, version, false, message, duration);
    return {
      success: false,
      error: message,
      duration,
    };
  }
}

export async function runUpdate(module: string, number: number): Promise<UpdateRunResult> {
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

export async function runUpdates(
  updates: Record<string, Record<number, UpdateFunction>> | null = null
): Promise<RunUpdatesResult> {
  const toRun = updates || (await getPendingUpdates());

  if (Object.keys(toRun).length === 0) {
    return {
      success: true,
      message: 'No updates to run',
      results: [],
    };
  }

  const sorted = sortUpdatesByVersion(toRun);
  const results: ModuleUpdateRecord[] = [];

  for (const { module, version, func } of sorted) {
    const result = await runSingleUpdate(module, version, func);
    results.push({
      module,
      version,
      ...result,
    });

    if (result.success) {
      await setSchemaVersion(module, version);
    } else {
      return {
        success: false,
        message: `Update failed: ${module}.update_${version}`,
        results,
      };
    }
  }

  return {
    success: true,
    message: `Successfully ran ${results.length} update(s)`,
    results,
  };
}

export async function getModuleSchema(module: string): Promise<ModuleSchema | null> {
  if (typeof module !== 'string' || !module) {
    throw new Error('Module name must be a non-empty string');
  }

  const installModule = await loadModuleFile(module, 'install.js');
  if (!installModule || !installModule.schema) return null;
  if (typeof installModule.schema !== 'function') {
    throw new Error(`Schema for module ${module} must be a function`);
  }
  return installModule.schema();
}

export async function checkRequirements(
  module: string,
  phase: string = 'install'
): Promise<RequirementReport[]> {
  if (typeof module !== 'string' || !module) {
    throw new Error('Module name must be a non-empty string');
  }

  const installModule = await loadModuleFile(module, 'install.js');
  if (!installModule || !installModule.requirements) return [];
  if (typeof installModule.requirements !== 'function') {
    throw new Error(`Requirements for module ${module} must be a function`);
  }
  return installModule.requirements(phase);
}

export async function installSchema(module: string): Promise<void> {
  if (typeof module !== 'string' || !module) {
    throw new Error('Module name must be a non-empty string');
  }

  const schema = await getModuleSchema(module);
  if (!schema) return;

  if (schema.tables) {
    for (const [tableName, tableSpec] of Object.entries(schema.tables)) {
      await createTable(tableName, tableSpec);
    }
  }
}

export async function uninstallSchema(module: string): Promise<void> {
  if (typeof module !== 'string' || !module) {
    throw new Error('Module name must be a non-empty string');
  }

  const schema = await getModuleSchema(module);
  if (!schema || !schema.tables) return;

  const tables = Object.keys(schema.tables).reverse();
  for (const tableName of tables) {
    await dropTable(tableName);
  }
}

export async function installModule(module: string): Promise<void> {
  if (typeof module !== 'string' || !module) {
    throw new Error('Module name must be a non-empty string');
  }

  if (await isModuleInstalled(module)) {
    throw new Error(`Module ${module} is already installed`);
  }

  const requirements = await checkRequirements(module, 'install');
  const errors = requirements.filter((r) => r.severity === 'error');
  if (errors.length > 0) {
    throw new Error(
      `Module ${module} has unmet requirements: ${errors.map((e) => e.message).join(', ')}`
    );
  }

  await installSchema(module);

  const installHook = await loadModuleFile(module, 'install.js');
  if (installHook && installHook.install) {
    if (typeof installHook.install !== 'function') {
      throw new Error(`Install hook for module ${module} must be a function`);
    }
    await installHook.install();
  }

  const installed = await loadInstalledModules();
  const updates = await getModuleUpdates(module);
  const versions = Object.keys(updates).map((v) => parseInt(v, 10));
  const latestVersion = versions.length > 0 ? Math.max(...versions) : 0;

  installed[module] = {
    version: latestVersion,
    installed: new Date().toISOString(),
  };

  await saveInstalledModules(installed);
  await setSchemaVersion(module, latestVersion);
}

export async function uninstallModule(module: string): Promise<void> {
  if (typeof module !== 'string' || !module) {
    throw new Error('Module name must be a non-empty string');
  }

  if (!(await isModuleInstalled(module))) {
    throw new Error(`Module ${module} is not installed`);
  }

  const installHook = await loadModuleFile(module, 'install.js');
  if (installHook && installHook.uninstall) {
    if (typeof installHook.uninstall !== 'function') {
      throw new Error(`Uninstall hook for module ${module} must be a function`);
    }
    await installHook.uninstall();
  }

  await uninstallSchema(module);

  const installed = await loadInstalledModules();
  delete installed[module];
  await saveInstalledModules(installed);

  const versions = await loadSchemaVersions();
  delete versions[module];
  await saveSchemaVersions(versions);
}

// ============================================================================
// Database update stubs (implementations are database-layer specific)
// ============================================================================

export async function addField(table: string, field: string, spec: unknown): Promise<void> {
  if (!table || !field || !spec) {
    throw new Error('Table, field, and spec are required');
  }
  console.log(`Adding field ${field} to table ${table}`, spec);
}

export async function dropField(table: string, field: string): Promise<void> {
  if (!table || !field) {
    throw new Error('Table and field are required');
  }
  console.log(`Dropping field ${field} from table ${table}`);
}

export async function changeField(
  table: string,
  field: string,
  newName: string,
  spec: unknown
): Promise<void> {
  if (!table || !field || !newName || !spec) {
    throw new Error('Table, field, newName, and spec are required');
  }
  console.log(`Changing field ${field} to ${newName} in table ${table}`, spec);
}

export async function createTable(table: string, spec: unknown): Promise<void> {
  if (!table || !spec) {
    throw new Error('Table and spec are required');
  }
  console.log(`Creating table ${table}`, spec);
}

export async function dropTable(table: string): Promise<void> {
  if (!table) {
    throw new Error('Table is required');
  }
  console.log(`Dropping table ${table}`);
}

export async function addIndex(
  table: string,
  name: string,
  fields: unknown
): Promise<void> {
  if (!table || !name || !fields) {
    throw new Error('Table, name, and fields are required');
  }
  console.log(`Adding index ${name} to table ${table}`, fields);
}

export async function dropIndex(table: string, name: string): Promise<void> {
  if (!table || !name) {
    throw new Error('Table and name are required');
  }
  console.log(`Dropping index ${name} from table ${table}`);
}

export async function renameTable(oldName: string, newName: string): Promise<void> {
  if (!oldName || !newName) {
    throw new Error('Old name and new name are required');
  }
  console.log(`Renaming table ${oldName} to ${newName}`);
}

export async function query(sql: string): Promise<unknown[]> {
  if (!sql) {
    throw new Error('SQL query is required');
  }
  console.log('Executing query:', sql);
  return [];
}

export async function batchUpdate(
  table: string,
  callback: (...args: unknown[]) => unknown,
  batchSize: number = 100
): Promise<void> {
  if (!table || !callback) {
    throw new Error('Table and callback are required');
  }
  if (typeof callback !== 'function') {
    throw new Error('Callback must be a function');
  }
  if (typeof batchSize !== 'number' || batchSize < 1) {
    throw new Error('Batch size must be a positive number');
  }
  console.log(`Batch updating table ${table} with batch size ${batchSize}`);
}

export async function entityUpdate(
  entityType: string,
  callback: (...args: unknown[]) => unknown
): Promise<void> {
  if (!entityType || !callback) {
    throw new Error('Entity type and callback are required');
  }
  if (typeof callback !== 'function') {
    throw new Error('Callback must be a function');
  }
  console.log(`Updating entities of type ${entityType}`);
}

interface UpdateReport {
  installed_modules: number;
  total_pending_updates: number;
  pending_by_module: Record<string, { count: number; versions: number[] }>;
  current_versions: SchemaVersions;
  recent_updates: UpdateLogEntry[];
}

export async function getUpdateReport(): Promise<UpdateReport> {
  const pending = await getPendingUpdates();
  const installed = await getInstalledModules();
  const versions = await loadSchemaVersions();
  const log = await loadUpdateLog();

  const report: UpdateReport = {
    installed_modules: installed.length,
    total_pending_updates: 0,
    pending_by_module: {},
    current_versions: versions,
    recent_updates: log.slice(-10).reverse(),
  };

  for (const [module, updates] of Object.entries(pending)) {
    const count = Object.keys(updates).length;
    report.total_pending_updates += count;
    report.pending_by_module[module] = {
      count,
      versions: Object.keys(updates)
        .map((v) => parseInt(v, 10))
        .sort((a, b) => a - b),
    };
  }

  return report;
}

export function formatUpdateOutput(results: RunUpdatesResult | null | undefined): string {
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

// ============================================================================
// AUTO-UPDATE FROM REGISTRY
// ============================================================================

const REGISTRY_CONFIG_FILE = join(CONFIG_DIR, 'registry.json');

// SECURITY: autoCheck defaults to FALSE — operators must opt in explicitly.
// Previously this was true; see Task 18 in CHANGELOG.
let registryConfig: RegistryConfig = {
  url: 'https://registry.cms-core.io/api/v1',
  checkInterval: 86_400_000, // 24 hours in ms
  autoCheck: false,
  lastCheck: null,
};

async function loadRegistryConfig(): Promise<RegistryConfig> {
  await ensureConfigDir();
  if (existsSync(REGISTRY_CONFIG_FILE)) {
    try {
      const data = await readFile(REGISTRY_CONFIG_FILE, 'utf-8');
      registryConfig = {
        ...registryConfig,
        ...(JSON.parse(data) as Partial<RegistryConfig>),
      };
    } catch {
      /* use defaults */
    }
  }
  return registryConfig;
}

async function saveRegistryConfig(): Promise<void> {
  await ensureConfigDir();
  await writeFile(
    REGISTRY_CONFIG_FILE,
    JSON.stringify(registryConfig, null, 2),
    'utf-8'
  );
}

/**
 * SECURITY GUARD (Task 17): assert that `filename` resolves under `moduleDir`.
 * Rejects:
 *   - null-byte injection (filename contains "\0")
 *   - absolute paths (e.g. "/etc/passwd" or "C:\\windows")
 *   - path-traversal (e.g. "../../../outside")
 * Returns the resolved absolute path, which callers should use instead of
 * re-joining the unvalidated filename.
 */
function assertSafeChildPath(moduleDir: string, filename: string): string {
  if (filename.includes('\0')) throw new Error('null byte in filename');
  if (path.isAbsolute(filename)) throw new Error(`absolute path rejected: ${filename}`);
  const resolvedPath = path.resolve(moduleDir, filename);
  const resolvedBase = path.resolve(moduleDir) + path.sep;
  // Allow the module dir itself in the edge case of "." (not expected in practice)
  if (
    resolvedPath !== path.resolve(moduleDir) &&
    !resolvedPath.startsWith(resolvedBase)
  ) {
    throw new Error(`path-traversal filename rejected: ${filename}`);
  }
  return resolvedPath;
}

/**
 * SECURITY GUARD (Task 18): require HTTPS for any registry URL, except for
 * explicit local-development hosts (localhost, 127.0.0.1, ::1).
 */
function assertSafeRegistryUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid registry URL: ${url}`);
  }
  if (parsed.protocol === 'https:') return;
  if (
    parsed.protocol === 'http:' &&
    (parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '::1')
  ) {
    return;
  }
  throw new Error(
    `Registry URL must use https:// (got ${parsed.protocol}//${parsed.hostname})`
  );
}

/**
 * Get or set the module registry URL.
 */
export async function getRegistryUrl(url?: string): Promise<string> {
  await loadRegistryConfig();
  if (url) {
    assertSafeRegistryUrl(url);
    registryConfig.url = url;
    await saveRegistryConfig();
  }
  // Defence in depth: even on read, refuse to hand back a scheme we would refuse to write.
  assertSafeRegistryUrl(registryConfig.url);
  return registryConfig.url;
}

interface CheckRegistryResult {
  available: AvailableUpdate[];
  error?: string;
  lastCheck: string | null;
  registryUrl: string;
}

/**
 * Check the remote registry for available module updates.
 */
export async function checkRegistryForUpdates(): Promise<CheckRegistryResult> {
  await loadRegistryConfig();
  assertSafeRegistryUrl(registryConfig.url);

  const installed = await loadInstalledModules();
  const available: AvailableUpdate[] = [];

  try {
    const catalogUrl = `${registryConfig.url}/catalog`;
    const response = await fetch(catalogUrl, {
      headers: { 'User-Agent': 'CMS-Core-Update/1.0' },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`Registry returned ${response.status}: ${response.statusText}`);
    }

    const catalog = (await response.json()) as RegistryCatalog;

    for (const [module, info] of Object.entries(installed)) {
      const remoteModule = catalog.modules?.[module];
      if (!remoteModule) continue;

      const currentVersion = String(info.version ?? '0.0.0');
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

    registryConfig.lastCheck = new Date().toISOString();
    await saveRegistryConfig();
  } catch (error) {
    const msg = (error as Error).message;
    console.warn(`[update] Registry check failed: ${msg}`);
    return {
      available: [],
      error: msg,
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
 */
export async function downloadModuleUpdate(
  module: string,
  version: string
): Promise<{ success: boolean; message: string }> {
  await loadRegistryConfig();
  assertSafeRegistryUrl(registryConfig.url);

  // SECURITY (Task 18): reject downgrades. An attacker who compromises the
  // registry could otherwise force us to roll back to a vulnerable version.
  try {
    const installed = await loadInstalledModules();
    const currentVersion = String(installed[module]?.version ?? '0.0.0');
    if (installed[module] && compareVersions(version, currentVersion) <= 0) {
      return {
        success: false,
        message: `Refusing to install ${module}@${version}: not newer than installed ${currentVersion}`,
      };
    }
  } catch {
    /* If we can't determine current version, let the fetch proceed — the
       server may be freshly installed and have no installed-modules file. */
  }

  try {
    const metaUrl = `${registryConfig.url}/modules/${module}/${version}`;
    const metaRes = await fetch(metaUrl, {
      headers: { 'User-Agent': 'CMS-Core-Update/1.0' },
      signal: AbortSignal.timeout(15_000),
    });

    if (!metaRes.ok) {
      throw new Error(`Registry returned ${metaRes.status} for ${module}@${version}`);
    }

    const meta = (await metaRes.json()) as RegistryPackage;
    const downloadUrl = meta.downloadUrl || meta.tarball;

    if (!downloadUrl) {
      throw new Error(`No download URL for ${module}@${version}`);
    }

    const pkgRes = await fetch(downloadUrl, {
      signal: AbortSignal.timeout(60_000),
    });

    if (!pkgRes.ok) {
      throw new Error(`Download failed: ${pkgRes.status}`);
    }

    const moduleDir = join(MODULES_DIR, module);
    if (!existsSync(moduleDir)) {
      await mkdir(moduleDir, { recursive: true });
    }

    const packageData = (await pkgRes.json()) as RegistryPackage;

    // Write each file from the package, validating every filename first.
    for (const [filename, rawEntry] of Object.entries(packageData.files || {})) {
      // SECURITY (Task 17): gate every filename through the path-traversal check.
      const filePath = assertSafeChildPath(moduleDir, filename);
      const fileDir = dirname(filePath);
      if (!existsSync(fileDir)) {
        await mkdir(fileDir, { recursive: true });
      }

      // The registry may either hand us a raw string or a { content, sha256 } envelope.
      let contentString: string;
      let expectedSha256: string | undefined;
      if (
        rawEntry &&
        typeof rawEntry === 'object' &&
        !Array.isArray(rawEntry) &&
        'content' in (rawEntry as Record<string, unknown>)
      ) {
        const entry = rawEntry as PackageFileEntry;
        contentString =
          typeof entry.content === 'string'
            ? entry.content
            : JSON.stringify(entry.content, null, 2);
        expectedSha256 = entry.sha256;
      } else {
        contentString =
          typeof rawEntry === 'string' ? rawEntry : JSON.stringify(rawEntry, null, 2);
      }

      // SECURITY (Task 18, optional): verify per-file digest if the registry supplied one.
      if (expectedSha256) {
        const actual = createHash('sha256')
          .update(contentString, 'utf8')
          .digest('hex');
        if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
          throw new Error(
            `SHA-256 mismatch for ${filename}: expected ${expectedSha256}, got ${actual}`
          );
        }
      }

      await writeFile(filePath, contentString, 'utf-8');
    }

    const installed = await loadInstalledModules();
    if (installed[module]) {
      installed[module].version = version;
      installed[module].updatedAt = new Date().toISOString();
    }
    await saveInstalledModules(installed);

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
    return {
      success: false,
      message: `Failed to download ${module}@${version}: ${(error as Error).message}`,
    };
  }
}

interface AutoUpdateOptions {
  dryRun?: boolean;
  modules?: string[] | null;
}

interface AutoUpdateResultRow {
  module: string;
  currentVersion?: string;
  latestVersion?: string;
  action:
    | 'would_update'
    | 'up_to_date'
    | 'downloaded'
    | 'download_failed'
    | 'update_hooks_failed';
  error?: string;
}

interface AutoUpdateReport {
  checked: number;
  downloaded: number;
  updated: number;
  results: AutoUpdateResultRow[];
}

/**
 * Orchestrate a full auto-update: check registry, download updates, run migrations.
 */
export async function autoUpdate(
  options: AutoUpdateOptions = {}
): Promise<AutoUpdateReport> {
  const { dryRun = false, modules: onlyModules = null } = options;
  const report: AutoUpdateReport = {
    checked: 0,
    downloaded: 0,
    updated: 0,
    results: [],
  };

  const check = await checkRegistryForUpdates();
  let available = check.available || [];
  report.checked = available.length;

  if (onlyModules) {
    available = available.filter((u) => onlyModules.includes(u.module));
  }

  if (dryRun || available.length === 0) {
    report.results = available.map((u) => ({
      module: u.module,
      currentVersion: u.currentVersion,
      latestVersion: u.latestVersion,
      action: dryRun ? 'would_update' : 'up_to_date',
    }));
    return report;
  }

  for (const update of available) {
    // downloadModuleUpdate already enforces version monotonicity (Task 18).
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

  const pending = await getPendingUpdates();
  for (const update of available) {
    const modulePending = pending[update.module];
    if (modulePending) {
      try {
        const updateResults = await runUpdates({
          [update.module]: modulePending,
        });
        if (updateResults.success) {
          report.updated++;
        }
      } catch (err) {
        report.results.push({
          module: update.module,
          action: 'update_hooks_failed',
          error: (err as Error).message,
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
function compareVersions(a: string, b: string): number {
  const pa = (a || '0').split('.').map(Number);
  const pb = (b || '0').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}
