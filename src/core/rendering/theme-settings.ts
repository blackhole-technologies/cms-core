/**
 * theme-settings.js - Theme Settings and Configuration System
 *
 * WHY THIS EXISTS:
 * Themes need configurable options without code changes:
 * - Logo, favicon, colors, layout options
 * - Per-theme defaults with user overrides
 * - CSS variable generation from settings
 * - Live preview in templates
 *
 * WHY NOT IN THEME-MANAGER:
 * Settings are data-focused (read/write config)
 * Theme manager is code-focused (load/render themes)
 * Separation keeps both modules focused
 *
 * DESIGN DECISION: Two-level storage
 * - theme.json: theme-defined defaults and schema
 * - theme-settings.json: user overrides per theme
 * This allows themes to ship with sensible defaults
 * while users can customize without modifying theme files
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as hooks from '../../../core/hooks.ts';

// ============================================================================
// Types
// ============================================================================

/** A single setting's schema: type + default + label + any UI hints. */
interface SettingSchema {
  type: 'text' | 'color' | 'image' | 'select' | 'toggle' | string;
  default?: unknown;
  label?: string;
  description?: string;
  options?: unknown;
  [key: string]: unknown;
}

/** Shape of theme.json — theme metadata + settings schema + color schemes. */
interface ThemeMetadata {
  name?: string;
  version?: string;
  description?: string;
  screenshot?: string | null;
  settings?: Record<string, SettingSchema>;
  setting_groups?: Record<string, unknown>;
  color_schemes?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

/** Merged settings: one key-value pair per setting. */
type SettingsValues = Record<string, unknown>;

/** Summary of a theme for listing in the UI. */
interface ThemeListItem {
  id: string;
  name: string;
  version: string;
  description: string;
  screenshot: string | null;
  active: boolean;
}

// ============================================================================
// Module state
// ============================================================================

/**
 * Base directory (project root)
 * WHY MUTABLE: Can be overridden for testing
 */
let baseDir: string | null = null;

/**
 * Active theme name
 * WHY CACHED: Avoid repeated file reads
 */
let activeThemeName: string = 'default';

/**
 * Cached theme metadata
 * Structure: { themeName: { name, version, settings, setting_groups, color_schemes } }
 */
const themeCache: Record<string, ThemeMetadata> = {};

/**
 * Cached user settings
 * Structure: { themeName: { settingKey: value } }
 */
const userSettingsCache: Record<string, SettingsValues> = {};

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize the theme settings system
 *
 * WHY EXPLICIT INIT:
 * Makes directory dependencies clear and testable
 */
export function init(dir: string): void {
  baseDir = dir;

  // Load active theme from config if exists
  const configPath = join(baseDir, 'config', 'theme.json');
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8')) as { active?: string };
      activeThemeName = config.active || 'default';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[theme-settings] Failed to load theme config:', message);
    }
  }

  // Ensure config directory exists
  const configDir = join(baseDir, 'config');
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
}

/**
 * Get list of available themes
 *
 * WHY SCAN DIRECTORY:
 * Themes can be added without code changes
 */
export function getThemes(): ThemeListItem[] {
  if (!baseDir) {
    throw new Error('[theme-settings] Not initialized. Call init() first.');
  }

  const themesDir = join(baseDir, 'themes');
  if (!existsSync(themesDir)) {
    return [];
  }

  const themes: ThemeListItem[] = [];
  const entries = readdirSync(themesDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const themeName = entry.name;
    const themeJsonPath = join(themesDir, themeName, 'theme.json');

    if (!existsSync(themeJsonPath)) continue;

    try {
      const theme = loadThemeMetadata(themeName);
      themes.push({
        id: themeName,
        name: theme.name || themeName,
        version: theme.version || '1.0.0',
        description: theme.description || '',
        screenshot: theme.screenshot || null,
        active: themeName === activeThemeName,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[theme-settings] Failed to load theme "${themeName}":`, message);
    }
  }

  return themes;
}

/**
 * Get theme metadata
 *
 * WHY CACHE:
 * Theme metadata doesn't change at runtime
 */
export function getTheme(name: string): ThemeMetadata {
  if (!baseDir) {
    throw new Error('[theme-settings] Not initialized. Call init() first.');
  }

  return loadThemeMetadata(name);
}

/**
 * Get active theme name
 */
export function getActiveTheme(): string {
  return activeThemeName;
}

/**
 * Set active theme
 *
 * WHY SAVE TO CONFIG:
 * Persists across restarts
 */
export async function setActiveTheme(name: string): Promise<boolean> {
  if (!baseDir) {
    throw new Error('[theme-settings] Not initialized. Call init() first.');
  }

  // Validate theme exists
  const themePath = join(baseDir, 'themes', name, 'theme.json');
  if (!existsSync(themePath)) {
    throw new Error(`[theme-settings] Theme not found: ${name}`);
  }

  // Trigger deactivation hook for old theme
  if (activeThemeName) {
    await hooks.trigger(`theme:deactivate:${activeThemeName}`, { theme: activeThemeName });
  }

  // Update active theme
  const oldTheme = activeThemeName;
  activeThemeName = name;

  // Save to config
  const configPath = join(baseDir, 'config', 'theme.json');
  writeFileSync(configPath, JSON.stringify({ active: name }, null, 2), 'utf-8');

  // Trigger activation hook
  await hooks.trigger(`theme:activate:${name}`, { theme: name, previousTheme: oldTheme });

  return true;
}

/**
 * Get settings for a theme (merged defaults + user overrides)
 *
 * WHY MERGE:
 * User overrides take precedence over theme defaults
 */
export function getSettings(themeName: string | null = null): SettingsValues {
  if (!baseDir) {
    throw new Error('[theme-settings] Not initialized. Call init() first.');
  }

  const theme = themeName || activeThemeName;
  const metadata = loadThemeMetadata(theme);
  const userSettings = loadUserSettings(theme);

  // Extract default values from schema
  const defaults: SettingsValues = {};
  if (metadata.settings) {
    for (const [key, schema] of Object.entries(metadata.settings)) {
      defaults[key] = schema.default;
    }
  }

  // Merge with user overrides
  return { ...defaults, ...userSettings };
}

/**
 * Get single setting value
 */
export function getSetting(themeName: string | null, key: string): unknown {
  const settings = getSettings(themeName);
  return settings[key];
}

/**
 * Set single setting value
 *
 * WHY VALIDATE:
 * Ensures value matches type defined in theme.json
 */
export async function setSetting(
  themeName: string | null,
  key: string,
  value: unknown
): Promise<boolean> {
  if (!baseDir) {
    throw new Error('[theme-settings] Not initialized. Call init() first.');
  }

  const theme = themeName || activeThemeName;
  const metadata = loadThemeMetadata(theme);

  // Validate setting exists in schema
  if (!metadata.settings || !metadata.settings[key]) {
    throw new Error(`[theme-settings] Unknown setting "${key}" for theme "${theme}"`);
  }

  // Validate type
  const schema = metadata.settings[key];
  if (!validateSettingValue(schema.type, value)) {
    throw new Error(
      `[theme-settings] Invalid value type for "${key}". ` +
        `Expected ${schema.type}, got ${typeof value}`
    );
  }

  // Load current user settings
  const userSettings = loadUserSettings(theme);
  userSettings[key] = value;

  // Save
  saveUserSettings(theme, userSettings);

  // Trigger hook
  await hooks.trigger('theme:settings', {
    theme,
    key,
    value,
    settings: userSettings,
  });

  return true;
}

/**
 * Save multiple settings at once
 */
export async function saveSettings(
  themeName: string | null,
  settings: SettingsValues
): Promise<boolean> {
  if (!baseDir) {
    throw new Error('[theme-settings] Not initialized. Call init() first.');
  }

  const theme = themeName || activeThemeName;
  const metadata = loadThemeMetadata(theme);

  // Validate all settings
  for (const [key, value] of Object.entries(settings)) {
    if (!metadata.settings || !metadata.settings[key]) {
      throw new Error(`[theme-settings] Unknown setting "${key}" for theme "${theme}"`);
    }

    const schema = metadata.settings[key];
    if (!validateSettingValue(schema.type, value)) {
      throw new Error(
        `[theme-settings] Invalid value type for "${key}". ` +
          `Expected ${schema.type}, got ${typeof value}`
      );
    }
  }

  // Load current and merge
  const current = loadUserSettings(theme);
  const updated: SettingsValues = { ...current, ...settings };

  // Save
  saveUserSettings(theme, updated);

  // Trigger hook
  await hooks.trigger('theme:settings', {
    theme,
    settings: updated,
  });

  return true;
}

/**
 * Get default settings for a theme
 */
export function getDefaultSettings(themeName: string | null): SettingsValues {
  if (!baseDir) {
    throw new Error('[theme-settings] Not initialized. Call init() first.');
  }

  const theme = themeName || activeThemeName;
  const metadata = loadThemeMetadata(theme);

  const defaults: SettingsValues = {};
  if (metadata.settings) {
    for (const [key, schema] of Object.entries(metadata.settings)) {
      defaults[key] = schema.default;
    }
  }

  return defaults;
}

/**
 * Reset settings to defaults
 */
export async function resetSettings(themeName: string | null): Promise<boolean> {
  if (!baseDir) {
    throw new Error('[theme-settings] Not initialized. Call init() first.');
  }

  const theme = themeName || activeThemeName;

  // Clear user settings
  const settingsPath = join(baseDir, 'config', 'theme-settings.json');
  let allSettings: Record<string, SettingsValues> = {};

  if (existsSync(settingsPath)) {
    try {
      allSettings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<
        string,
        SettingsValues
      >;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[theme-settings] Failed to load theme settings:', message);
    }
  }

  // Remove this theme's settings
  delete allSettings[theme];
  delete userSettingsCache[theme];

  // Save
  writeFileSync(settingsPath, JSON.stringify(allSettings, null, 2), 'utf-8');

  // Trigger hook
  await hooks.trigger('theme:settings', {
    theme,
    settings: getDefaultSettings(theme),
    reset: true,
  });

  return true;
}

/**
 * Generate CSS variables from theme settings
 *
 * WHY CSS VARIABLES:
 * Allows settings to affect styling without recompiling CSS
 * Templates can reference --theme-primary-color directly
 */
export function generateCSS(themeName: string | null = null): string {
  const theme = themeName || activeThemeName;
  const settings = getSettings(theme);
  const metadata = loadThemeMetadata(theme);

  const cssVars: string[] = [];

  if (metadata.settings) {
    for (const [key, schema] of Object.entries(metadata.settings)) {
      const value = settings[key];

      // Only generate CSS vars for color and text types
      if (schema.type === 'color' || schema.type === 'text') {
        if (value !== null && value !== undefined) {
          // Convert setting_key to --theme-setting-key
          const cssVarName = `--theme-${key.replace(/_/g, '-')}`;
          cssVars.push(`  ${cssVarName}: ${String(value)};`);
        }
      }
    }
  }

  if (cssVars.length === 0) {
    return '';
  }

  return ':root {\n' + cssVars.join('\n') + '\n}';
}

/**
 * Get color schemes for a theme
 */
export function getColorSchemes(themeName: string | null): Record<string, Record<string, unknown>> {
  if (!baseDir) {
    throw new Error('[theme-settings] Not initialized. Call init() first.');
  }

  const theme = themeName || activeThemeName;
  const metadata = loadThemeMetadata(theme);

  return metadata.color_schemes || {};
}

/**
 * Apply a color scheme to theme settings
 */
export async function applyColorScheme(
  themeName: string | null,
  schemeName: string
): Promise<boolean> {
  if (!baseDir) {
    throw new Error('[theme-settings] Not initialized. Call init() first.');
  }

  const theme = themeName || activeThemeName;
  const metadata = loadThemeMetadata(theme);

  if (!metadata.color_schemes || !metadata.color_schemes[schemeName]) {
    throw new Error(`[theme-settings] Color scheme "${schemeName}" not found in theme "${theme}"`);
  }

  const scheme = metadata.color_schemes[schemeName];

  // Apply scheme values to matching settings
  await saveSettings(theme, scheme);

  return true;
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Load theme metadata from theme.json
 *
 * WHY CACHE:
 * Theme metadata is read-only at runtime
 */
function loadThemeMetadata(name: string): ThemeMetadata {
  // Check cache
  if (themeCache[name]) {
    return themeCache[name];
  }

  if (!baseDir) {
    throw new Error('[theme-settings] Not initialized. Call init() first.');
  }

  const themePath = join(baseDir, 'themes', name, 'theme.json');

  if (!existsSync(themePath)) {
    throw new Error(`[theme-settings] Theme not found: ${name}`);
  }

  try {
    const raw = readFileSync(themePath, 'utf-8');
    const metadata = JSON.parse(raw) as ThemeMetadata;

    // Cache
    themeCache[name] = metadata;

    return metadata;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[theme-settings] Failed to load theme "${name}": ${message}`);
  }
}

/**
 * Load user settings for a theme
 *
 * WHY CACHE:
 * Settings are read frequently during rendering
 */
function loadUserSettings(name: string): SettingsValues {
  // Check cache
  if (userSettingsCache[name]) {
    return userSettingsCache[name];
  }

  if (!baseDir) {
    throw new Error('[theme-settings] Not initialized. Call init() first.');
  }

  const settingsPath = join(baseDir, 'config', 'theme-settings.json');

  if (!existsSync(settingsPath)) {
    userSettingsCache[name] = {};
    return {};
  }

  try {
    const raw = readFileSync(settingsPath, 'utf-8');
    const allSettings = JSON.parse(raw) as Record<string, SettingsValues>;
    const settings = allSettings[name] || {};

    // Cache
    userSettingsCache[name] = settings;

    return settings;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[theme-settings] Failed to load user settings:', message);
    userSettingsCache[name] = {};
    return {};
  }
}

/**
 * Save user settings for a theme
 *
 * WHY ATOMIC WRITE:
 * Read all settings, update one theme, write all
 * Prevents data loss if multiple themes exist
 */
function saveUserSettings(name: string, settings: SettingsValues): void {
  if (!baseDir) {
    throw new Error('[theme-settings] Not initialized. Call init() first.');
  }

  const settingsPath = join(baseDir, 'config', 'theme-settings.json');

  // Load all current settings
  let allSettings: Record<string, SettingsValues> = {};
  if (existsSync(settingsPath)) {
    try {
      const raw = readFileSync(settingsPath, 'utf-8');
      allSettings = JSON.parse(raw) as Record<string, SettingsValues>;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[theme-settings] Failed to load existing settings:', message);
    }
  }

  // Update this theme's settings
  allSettings[name] = settings;

  // Write back
  writeFileSync(settingsPath, JSON.stringify(allSettings, null, 2), 'utf-8');

  // Update cache
  userSettingsCache[name] = settings;
}

/**
 * Validate setting value against type
 *
 * WHY BASIC VALIDATION:
 * Type checking prevents obvious mistakes
 * Advanced validation (e.g., valid color hex) can be added later
 */
function validateSettingValue(type: string, value: unknown): boolean {
  // Null/undefined are valid for all types (means "use default")
  if (value === null || value === undefined) {
    return true;
  }

  switch (type) {
    case 'text':
    case 'color':
    case 'image':
    case 'select':
      return typeof value === 'string';

    case 'toggle':
      return typeof value === 'boolean';

    default:
      // Unknown type - be permissive
      return true;
  }
}
