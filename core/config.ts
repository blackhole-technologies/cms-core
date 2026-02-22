/**
 * config.ts - Configuration Loader
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
 *
 * DESIGN DECISION: Eager loading at boot
 * All configs are loaded during INIT phase. This means:
 * - Fail fast if config is missing or invalid
 * - No filesystem access during request handling
 * - Configs are frozen (immutable) after load
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================================
// Types
// ============================================================================

/** A parsed JSON configuration value — recursive union covering all JSON types */
export type ConfigValue =
    | string
    | number
    | boolean
    | null
    | ConfigValue[]
    | { [key: string]: ConfigValue };

/** A loaded configuration object (top-level is always an object in our JSON files) */
export type ConfigObject = Readonly<{ [key: string]: ConfigValue }>;

// ============================================================================
// State
// ============================================================================

/** Cached configuration objects */
const configs: Record<string, ConfigObject> = {};

/** Path to config directory (mutable for testing) */
let configDir: string | null = null;

// ============================================================================
// Private Helpers
// ============================================================================

/**
 * Deep freeze an object (recursive Object.freeze)
 *
 * WHY FREEZE BEFORE RECURSING:
 * Prevents issues if object has circular references
 */
function deepFreeze<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    Object.freeze(obj);
    for (const value of Object.values(obj as Record<string, unknown>)) {
        deepFreeze(value);
    }
    return obj;
}

// ============================================================================
// Core API
// ============================================================================

/**
 * Initialize the config loader with a base directory
 *
 * WHY EXPLICIT INITIALIZATION (not auto-detect):
 * - Makes the config location explicit and debuggable
 * - Allows tests to point to test-specific config directories
 * - No magic __dirname guessing that breaks in ESM
 */
export function init(baseDir: string): void {
    configDir = join(baseDir, 'config');
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
 * WHY FREEZE:
 * Configs should be immutable after load. If code accidentally
 * modifies config, that's a bug. Object.freeze makes it throw.
 *
 * WHY SYNC READ (not async):
 * Config loading happens at boot, before any async operations.
 * Sync is simpler and there's no performance benefit to async here.
 */
export function load(name: string): ConfigObject {
    if (!configDir) {
        throw new Error(`Config not initialized. Call config.init(baseDir) first.`);
    }
    const cached = configs[name];
    if (cached) {
        return cached;
    }
    const filePath = join(configDir, `${name}.json`);
    if (!existsSync(filePath)) {
        throw new Error(
            `Config file not found: ${filePath}\n` +
            `Create this file or check the config name.`
        );
    }
    try {
        const raw = readFileSync(filePath, 'utf-8');
        const parsed: unknown = JSON.parse(raw);
        const frozen = deepFreeze(parsed) as ConfigObject;
        configs[name] = frozen;
        return frozen;
    }
    catch (error: unknown) {
        if (error instanceof SyntaxError) {
            throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
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
export function get(name: string): ConfigObject | null {
    return configs[name] ?? null;
}

/** Check if a config has been loaded */
export function has(name: string): boolean {
    return name in configs;
}

/** List all loaded config names */
export function list(): string[] {
    return Object.keys(configs);
}

/**
 * Clear cached configs (mainly for testing)
 */
export function clear(): void {
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
 */
export function reload(name: string): ConfigObject {
    delete configs[name];
    return load(name);
}

/**
 * Get the config directory path
 *
 * WHY THIS EXISTS:
 * The watcher needs to know where configs live to watch them.
 */
export function getConfigDir(): string | null {
    return configDir;
}
