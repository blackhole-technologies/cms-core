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

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import * as hooks from './hooks.js';

/**
 * Base directory (project root)
 * WHY MUTABLE: Can be overridden for testing
 */
let baseDir = null;

/**
 * Active theme name
 * WHY CACHED: Avoid repeated file reads
 */
let activeThemeName = 'default';

/**
 * Cached theme metadata
 * Structure: { themeName: { name, version, settings, setting_groups, color_schemes } }
 */
const themeCache = {};

/**
 * Cached user settings
 * Structure: { themeName: { settingKey: value } }
 */
const userSettingsCache = {};

/**
 * Initialize the theme settings system
 *
 * @param {string} dir - Project root directory
 *
 * WHY EXPLICIT INIT:
 * Makes directory dependencies clear and testable
 */
export function init(dir) {
  baseDir = dir;

  // Load active theme from config if exists
  const configPath = join(baseDir, 'config', 'theme.json');
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      activeThemeName = config.active || 'default';
    } catch (error) {
      console.error('[theme-settings] Failed to load theme config:', error.message);
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
 * @returns {Array<Object>} - Array of theme metadata
 *
 * WHY SCAN DIRECTORY:
 * Themes can be added without code changes
 */
export function getThemes() {
  if (!baseDir) {
    throw new Error('[theme-settings] Not initialized. Call init() first.');
  }

  const themesDir = join(baseDir, 'themes');
  if (!existsSync(themesDir)) {
    return [];
  }

  const themes = [];
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
        active: themeName === activeThemeName
      });
    } catch (error) {
      console.error(`[theme-settings] Failed to load theme "${themeName}":`, error.message);
    }
  }

  return themes;
}

/**
 * Get theme metadata
 *
 * @param {string} name - Theme name
 * @returns {Object} - Theme metadata
 *
 * WHY CACHE:
 * Theme metadata doesn't change at runtime
 */
export function getTheme(name) {
  if (!baseDir) {
    throw new Error('[theme-settings] Not initialized. Call init() first.');
  }

  return loadThemeMetadata(name);
}

/**
 * Get active theme name
 *
 * @returns {string} - Active theme name
 */
export function getActiveTheme() {
  return activeThemeName;
}

/**
 * Set active theme
 *
 * @param {string} name - Theme name
 *
 * WHY SAVE TO CONFIG:
 * Persists across restarts
 */
export async function setActiveTheme(name) {
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
 * @param {string} themeName - Theme name (defaults to active)
 * @returns {Object} - Merged settings
 *
 * WHY MERGE:
 * User overrides take precedence over theme defaults
 */
export function getSettings(themeName = null) {
  if (!baseDir) {
    throw new Error('[theme-settings] Not initialized. Call init() first.');
  }

  const theme = themeName || activeThemeName;
  const metadata = loadThemeMetadata(theme);
  const userSettings = loadUserSettings(theme);

  // Extract default values from schema
  const defaults = {};
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
 *
 * @param {string} themeName - Theme name
 * @param {string} key - Setting key
 * @returns {*} - Setting value
 */
export function getSetting(themeName, key) {
  const settings = getSettings(themeName);
  return settings[key];
}

/**
 * Set single setting value
 *
 * @param {string} themeName - Theme name
 * @param {string} key - Setting key
 * @param {*} value - Setting value
 *
 * WHY VALIDATE:
 * Ensures value matches type defined in theme.json
 */
export async function setSetting(themeName, key, value) {
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
    settings: userSettings
  });

  return true;
}

/**
 * Save multiple settings at once
 *
 * @param {string} themeName - Theme name
 * @param {Object} settings - Settings object
 */
export async function saveSettings(themeName, settings) {
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
  const updated = { ...current, ...settings };

  // Save
  saveUserSettings(theme, updated);

  // Trigger hook
  await hooks.trigger('theme:settings', {
    theme,
    settings: updated
  });

  return true;
}

/**
 * Get default settings for a theme
 *
 * @param {string} themeName - Theme name
 * @returns {Object} - Default settings
 */
export function getDefaultSettings(themeName) {
  if (!baseDir) {
    throw new Error('[theme-settings] Not initialized. Call init() first.');
  }

  const theme = themeName || activeThemeName;
  const metadata = loadThemeMetadata(theme);

  const defaults = {};
  if (metadata.settings) {
    for (const [key, schema] of Object.entries(metadata.settings)) {
      defaults[key] = schema.default;
    }
  }

  return defaults;
}

/**
 * Reset settings to defaults
 *
 * @param {string} themeName - Theme name
 */
export async function resetSettings(themeName) {
  if (!baseDir) {
    throw new Error('[theme-settings] Not initialized. Call init() first.');
  }

  const theme = themeName || activeThemeName;

  // Clear user settings
  const settingsPath = join(baseDir, 'config', 'theme-settings.json');
  let allSettings = {};

  if (existsSync(settingsPath)) {
    try {
      allSettings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    } catch (error) {
      console.error('[theme-settings] Failed to load theme settings:', error.message);
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
    reset: true
  });

  return true;
}

/**
 * Generate CSS variables from theme settings
 *
 * @param {string} themeName - Theme name (defaults to active)
 * @returns {string} - CSS variable declarations
 *
 * WHY CSS VARIABLES:
 * Allows settings to affect styling without recompiling CSS
 * Templates can reference --theme-primary-color directly
 */
export function generateCSS(themeName = null) {
  const theme = themeName || activeThemeName;
  const settings = getSettings(theme);
  const metadata = loadThemeMetadata(theme);

  const cssVars = [];

  if (metadata.settings) {
    for (const [key, schema] of Object.entries(metadata.settings)) {
      const value = settings[key];

      // Only generate CSS vars for color and text types
      if (schema.type === 'color' || schema.type === 'text') {
        if (value !== null && value !== undefined) {
          // Convert setting_key to --theme-setting-key
          const cssVarName = `--theme-${key.replace(/_/g, '-')}`;
          cssVars.push(`  ${cssVarName}: ${value};`);
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
 *
 * @param {string} themeName - Theme name
 * @returns {Object} - Color schemes
 */
export function getColorSchemes(themeName) {
  if (!baseDir) {
    throw new Error('[theme-settings] Not initialized. Call init() first.');
  }

  const theme = themeName || activeThemeName;
  const metadata = loadThemeMetadata(theme);

  return metadata.color_schemes || {};
}

/**
 * Apply a color scheme to theme settings
 *
 * @param {string} themeName - Theme name
 * @param {string} schemeName - Color scheme name
 */
export async function applyColorScheme(themeName, schemeName) {
  if (!baseDir) {
    throw new Error('[theme-settings] Not initialized. Call init() first.');
  }

  const theme = themeName || activeThemeName;
  const metadata = loadThemeMetadata(theme);

  if (!metadata.color_schemes || !metadata.color_schemes[schemeName]) {
    throw new Error(
      `[theme-settings] Color scheme "${schemeName}" not found in theme "${theme}"`
    );
  }

  const scheme = metadata.color_schemes[schemeName];

  // Apply scheme values to matching settings
  await saveSettings(theme, scheme);

  return true;
}

/**
 * Load theme metadata from theme.json
 *
 * @param {string} name - Theme name
 * @returns {Object} - Theme metadata
 *
 * WHY CACHE:
 * Theme metadata is read-only at runtime
 */
function loadThemeMetadata(name) {
  // Check cache
  if (themeCache[name]) {
    return themeCache[name];
  }

  const themePath = join(baseDir, 'themes', name, 'theme.json');

  if (!existsSync(themePath)) {
    throw new Error(`[theme-settings] Theme not found: ${name}`);
  }

  try {
    const raw = readFileSync(themePath, 'utf-8');
    const metadata = JSON.parse(raw);

    // Cache
    themeCache[name] = metadata;

    return metadata;
  } catch (error) {
    throw new Error(
      `[theme-settings] Failed to load theme "${name}": ${error.message}`
    );
  }
}

/**
 * Load user settings for a theme
 *
 * @param {string} name - Theme name
 * @returns {Object} - User settings
 *
 * WHY CACHE:
 * Settings are read frequently during rendering
 */
function loadUserSettings(name) {
  // Check cache
  if (userSettingsCache[name]) {
    return userSettingsCache[name];
  }

  const settingsPath = join(baseDir, 'config', 'theme-settings.json');

  if (!existsSync(settingsPath)) {
    userSettingsCache[name] = {};
    return {};
  }

  try {
    const raw = readFileSync(settingsPath, 'utf-8');
    const allSettings = JSON.parse(raw);
    const settings = allSettings[name] || {};

    // Cache
    userSettingsCache[name] = settings;

    return settings;
  } catch (error) {
    console.error('[theme-settings] Failed to load user settings:', error.message);
    userSettingsCache[name] = {};
    return {};
  }
}

/**
 * Save user settings for a theme
 *
 * @param {string} name - Theme name
 * @param {Object} settings - Settings object
 *
 * WHY ATOMIC WRITE:
 * Read all settings, update one theme, write all
 * Prevents data loss if multiple themes exist
 */
function saveUserSettings(name, settings) {
  const settingsPath = join(baseDir, 'config', 'theme-settings.json');

  // Load all current settings
  let allSettings = {};
  if (existsSync(settingsPath)) {
    try {
      const raw = readFileSync(settingsPath, 'utf-8');
      allSettings = JSON.parse(raw);
    } catch (error) {
      console.error('[theme-settings] Failed to load existing settings:', error.message);
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
 * @param {string} type - Setting type (text, color, image, select, toggle)
 * @param {*} value - Value to validate
 * @returns {boolean} - True if valid
 *
 * WHY BASIC VALIDATION:
 * Type checking prevents obvious mistakes
 * Advanced validation (e.g., valid color hex) can be added later
 */
function validateSettingValue(type, value) {
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
