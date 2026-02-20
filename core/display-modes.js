/**
 * display-modes.js - Display/View Modes System
 *
 * WHY THIS EXISTS:
 * Content needs to be displayed differently in different contexts:
 * - Full article page: show everything
 * - Teaser in listing: show summary only
 * - Search result: show title + snippet
 * - RSS feed: show formatted for XML
 *
 * WHY NOT HARD-CODE DISPLAY LOGIC:
 * Different content types need different field arrangements.
 * Site builders need to configure without touching code.
 * Themes may need to override default display configurations.
 *
 * DESIGN DECISION: Configuration-driven display
 * Instead of templates for every variation, we configure how fields
 * are formatted and ordered. Templates receive pre-formatted output.
 */

import fs from 'fs/promises';
import path from 'path';
import * as hooks from './hooks.js';

/**
 * Runtime state
 * WHY SEPARATE FROM CONFIG:
 * Config is serialized JSON, state includes runtime functions (formatters)
 */
let baseDir = null;
let contentTypesModule = null;
let templateModule = null;

/**
 * Storage for view modes configuration
 * Structure: { id: { label, description, settings } }
 */
const viewModes = {
  full: { label: 'Full content', description: 'Complete content display' },
  teaser: { label: 'Teaser', description: 'Brief preview with link to full content' },
  card: { label: 'Card', description: 'Compact card layout for grids and listings' },
  search_result: { label: 'Search result', description: 'Compact display for search results' },
  embedded: { label: 'Embedded', description: 'Inline display when referenced from other content' },
  table_row: { label: 'Table row', description: 'Single-row display for tabular listings' },
  rss: { label: 'RSS', description: 'Content formatted for RSS feeds' },
  token: { label: 'Token', description: 'Minimal display for token replacement' },
};

/**
 * Display configurations per content type per view mode
 * Structure: { contentType: { viewMode: { fields: { fieldName: config } } } }
 */
const displays = {};

/**
 * Field formatters registry
 * Structure: { formatterName: renderFunction }
 *
 * WHY FUNCTION REGISTRY:
 * Different field types need different rendering logic.
 * Modules can register custom formatters for specialized display.
 */
const formatters = {
  /**
   * Default text formatter - renders as-is
   */
  text_default: (value, settings = {}) => {
    if (value == null) return '';
    return String(value);
  },

  /**
   * Trimmed text formatter - cuts at length, adds ellipsis
   */
  text_trimmed: (value, settings = {}) => {
    if (value == null) return '';
    const text = String(value);
    const length = settings.length || 200;
    if (text.length <= length) return text;
    return text.substring(0, length).trimEnd() + '...';
  },

  /**
   * Image formatter - renders image tag with alt text
   */
  image: (value, settings = {}) => {
    if (!value || !value.url) return '';
    const style = settings.style || 'original';
    const alt = value.alt || '';
    const url = value.url;
    return `<img src="${url}" alt="${alt}" data-style="${style}" />`;
  },

  /**
   * Entity reference label formatter - displays linked entity label
   */
  entity_reference_label: (value, settings = {}) => {
    if (!value) return '';
    if (Array.isArray(value)) {
      return value.map(v => v.label || v.title || v.id || '').join(', ');
    }
    return value.label || value.title || value.id || '';
  },

  /**
   * Link formatter - renders anchor tag
   */
  link: (value, settings = {}) => {
    if (!value || !value.url) return '';
    const url = value.url;
    const title = value.title || url;
    const target = settings.target || '_self';
    return `<a href="${url}" target="${target}">${title}</a>`;
  },

  /**
   * Date formatter - formats date with pattern
   */
  date: (value, settings = {}) => {
    if (!value) return '';
    const date = new Date(value);
    if (isNaN(date)) return String(value);

    const format = settings.format || 'medium';
    const formats = {
      short: { dateStyle: 'short' },
      medium: { dateStyle: 'medium' },
      long: { dateStyle: 'long' },
      full: { dateStyle: 'full', timeStyle: 'medium' }
    };

    const options = formats[format] || formats.medium;
    return new Intl.DateTimeFormat('en-US', options).format(date);
  },

  /**
   * Number formatter - formats numeric values
   */
  number: (value, settings = {}) => {
    if (value == null) return '';
    const num = Number(value);
    if (isNaN(num)) return String(value);

    const decimals = settings.decimals ?? 0;
    return num.toFixed(decimals);
  },

  /**
   * Boolean formatter - displays yes/no or custom labels
   */
  boolean: (value, settings = {}) => {
    const truthy = settings.truthy || 'Yes';
    const falsy = settings.falsy || 'No';
    return value ? truthy : falsy;
  }
};

/**
 * Configuration file path
 */
function getConfigPath() {
  return path.join(baseDir, 'config', 'display-modes.json');
}

/**
 * Initialize display modes system
 *
 * @param {string} dir - Base directory for CMS
 * @param {object} contentTypes - Content types module for field definitions
 * @param {object} template - Template module for rendering
 *
 * WHY INJECT DEPENDENCIES:
 * Loose coupling. Display system doesn't depend on specific implementations.
 * Makes testing easier (can inject mocks).
 */
export async function init(dir, contentTypes = null, template = null) {
  baseDir = dir;
  contentTypesModule = contentTypes;
  templateModule = template;

  try {
    await fs.mkdir(path.join(baseDir, 'config'), { recursive: true });

    const configPath = getConfigPath();
    const data = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(data);

    // Load view modes
    if (config.view_modes) {
      Object.assign(viewModes, config.view_modes);
    }

    // Load display configurations
    if (config.displays) {
      Object.assign(displays, config.displays);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('[display-modes] Error loading config:', error.message);
    }
    // File doesn't exist yet - will be created on first save
  }
}

/**
 * Save current configuration to disk
 *
 * WHY SEPARATE SAVE FUNCTION:
 * Config changes may come from UI. We want explicit control over
 * when changes are persisted vs. kept in memory.
 */
async function saveConfig() {
  const config = {
    view_modes: viewModes,
    displays: displays
  };

  const configPath = getConfigPath();
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
}

/**
 * Define a new view mode
 *
 * @param {string} id - Machine name (e.g., 'teaser')
 * @param {object} config - { label, description, settings }
 */
export async function defineViewMode(id, config) {
  if (!id || typeof id !== 'string') {
    throw new Error('View mode ID must be a non-empty string');
  }

  viewModes[id] = {
    label: config.label || id,
    description: config.description || '',
    settings: config.settings || {}
  };

  await saveConfig();
}

/**
 * Get all defined view modes
 *
 * @returns {object} - Map of view mode ID to configuration
 */
export function getViewModes() {
  return { ...viewModes };
}

/**
 * Get a specific view mode configuration
 *
 * @param {string} id - View mode ID
 * @returns {object|null} - View mode config or null if not found
 */
export function getViewMode(id) {
  return viewModes[id] ? { ...viewModes[id] } : null;
}

/**
 * Set display configuration for a content type's view mode
 *
 * @param {string} contentType - Content type machine name
 * @param {string} viewMode - View mode ID
 * @param {object} fieldConfigs - Map of field name to display config
 *
 * Field config structure:
 * {
 *   weight: 10,           // Sort order (lower = earlier)
 *   label: 'above',       // 'above' | 'inline' | 'hidden'
 *   formatter: 'text_default',  // Formatter ID
 *   settings: {}          // Formatter-specific settings
 * }
 */
export async function setDisplay(contentType, viewMode, fieldConfigs) {
  if (!contentType || !viewMode) {
    throw new Error('Content type and view mode are required');
  }

  if (!viewModes[viewMode]) {
    throw new Error(`View mode "${viewMode}" does not exist`);
  }

  if (!displays[contentType]) {
    displays[contentType] = {};
  }

  displays[contentType][viewMode] = {
    fields: fieldConfigs || {}
  };

  await saveConfig();
}

/**
 * Get display configuration for a content type's view mode
 *
 * @param {string} contentType - Content type machine name
 * @param {string} viewMode - View mode ID
 * @returns {object|null} - Display config or null if not configured
 *
 * WHY FALLBACK TO 'full':
 * If a view mode isn't configured, fall back to 'full' mode.
 * This ensures content always renders even if not fully configured.
 */
export function getDisplay(contentType, viewMode) {
  // Try requested view mode
  if (displays[contentType]?.[viewMode]) {
    return { ...displays[contentType][viewMode] };
  }

  // Fallback to 'full' mode if different
  if (viewMode !== 'full' && displays[contentType]?.full) {
    return { ...displays[contentType].full };
  }

  // Return null if no configuration exists
  return null;
}

/**
 * Set field visibility for specific view mode
 *
 * @param {string} contentType - Content type machine name
 * @param {string} viewMode - View mode ID
 * @param {string} fieldName - Field machine name
 * @param {boolean} visible - Whether field should be displayed
 */
export async function setFieldVisibility(contentType, viewMode, fieldName, visible) {
  if (!displays[contentType]) {
    displays[contentType] = {};
  }
  if (!displays[contentType][viewMode]) {
    displays[contentType][viewMode] = { fields: {} };
  }

  const fieldConfig = displays[contentType][viewMode].fields[fieldName] || {};

  if (!visible) {
    // Remove field from display
    delete displays[contentType][viewMode].fields[fieldName];
  } else {
    // Ensure field exists in display
    displays[contentType][viewMode].fields[fieldName] = {
      weight: fieldConfig.weight ?? 0,
      label: fieldConfig.label || 'above',
      formatter: fieldConfig.formatter || 'text_default',
      settings: fieldConfig.settings || {}
    };
  }

  await saveConfig();
}

/**
 * Set field weight (display order) for specific view mode
 *
 * @param {string} contentType - Content type machine name
 * @param {string} viewMode - View mode ID
 * @param {string} fieldName - Field machine name
 * @param {number} weight - Sort weight (lower = earlier)
 */
export async function setFieldWeight(contentType, viewMode, fieldName, weight) {
  if (!displays[contentType]?.[viewMode]?.fields[fieldName]) {
    throw new Error(`Field "${fieldName}" not configured for ${contentType}.${viewMode}`);
  }

  displays[contentType][viewMode].fields[fieldName].weight = weight;
  await saveConfig();
}

/**
 * Set field formatter and settings for specific view mode
 *
 * @param {string} contentType - Content type machine name
 * @param {string} viewMode - View mode ID
 * @param {string} fieldName - Field machine name
 * @param {string} formatter - Formatter ID
 * @param {object} settings - Formatter settings
 */
export async function setFieldFormatter(contentType, viewMode, fieldName, formatter, settings = {}) {
  if (!displays[contentType]?.[viewMode]?.fields[fieldName]) {
    throw new Error(`Field "${fieldName}" not configured for ${contentType}.${viewMode}`);
  }

  if (!formatters[formatter]) {
    throw new Error(`Formatter "${formatter}" does not exist`);
  }

  const fieldConfig = displays[contentType][viewMode].fields[fieldName];
  fieldConfig.formatter = formatter;
  fieldConfig.settings = settings;

  await saveConfig();
}

/**
 * Register a custom field formatter
 *
 * @param {string} name - Formatter machine name
 * @param {Function} renderFn - Function that formats field value
 *
 * Render function signature: (value, settings) => string
 *
 * WHY ALLOW CUSTOM FORMATTERS:
 * Sites may have specialized display needs not covered by core formatters.
 * For example: product prices with currency conversion, specialized date ranges.
 */
export function registerFormatter(name, renderFn) {
  if (!name || typeof name !== 'string') {
    throw new Error('Formatter name must be a non-empty string');
  }

  if (typeof renderFn !== 'function') {
    throw new Error('Formatter must be a function');
  }

  formatters[name] = renderFn;
}

/**
 * Get formatter function by name
 *
 * @param {string} formatterName - Formatter ID
 * @returns {Function|null} - Formatter function or null
 */
export function getFieldFormatter(formatterName) {
  return formatters[formatterName] || null;
}

/**
 * Get all registered formatters
 *
 * @returns {object} - Map of formatter name to function
 */
export function getFormatters() {
  return { ...formatters };
}

/**
 * Render a single field value using configured formatter
 *
 * @param {*} value - Field value to format
 * @param {object} fieldConfig - Display configuration for field
 * @returns {object} - { label, value, formatted }
 *
 * WHY RETURN OBJECT WITH LABEL:
 * Templates may want to show label above/inline/hidden.
 * Returning structured data gives template full control.
 */
function renderField(value, fieldConfig, fieldName) {
  const formatter = formatters[fieldConfig.formatter] || formatters.text_default;
  const formatted = formatter(value, fieldConfig.settings || {});

  return {
    name: fieldName,
    label: fieldConfig.label || 'above',
    value: value,
    formatted: formatted,
    weight: fieldConfig.weight ?? 0
  };
}

/**
 * Render content using specified view mode
 *
 * @param {object} content - Content entity with fields
 * @param {string} viewMode - View mode ID
 * @param {object} options - Additional rendering options
 * @returns {Promise<object>} - Rendered output with fields
 *
 * WHY ASYNC:
 * Allows hooks to perform async operations (fetch related content, etc.)
 */
export async function renderContent(content, viewMode = 'full', options = {}) {
  if (!content || !content.type) {
    throw new Error('Content must have a type property');
  }

  const contentType = content.type;
  const display = getDisplay(contentType, viewMode);

  if (!display) {
    throw new Error(`No display configuration for ${contentType}.${viewMode}`);
  }

  // Prepare rendering context for hooks
  const context = {
    content,
    contentType,
    viewMode,
    display,
    fields: [],
    options
  };

  // Hook: Allow modules to alter display configuration before render
  await hooks.trigger('display:beforeRender', context);

  // Sort fields by weight
  const fieldEntries = Object.entries(context.display.fields);
  fieldEntries.sort(([, a], [, b]) => (a.weight ?? 0) - (b.weight ?? 0));

  // Render each configured field
  for (const [fieldName, fieldConfig] of fieldEntries) {
    const value = content[fieldName];

    // Skip if field value is undefined/null and not configured to show empty
    if (value == null && !fieldConfig.showEmpty) {
      continue;
    }

    const rendered = renderField(value, fieldConfig, fieldName);

    // Hook: Allow modules to alter individual field rendering
    const fieldContext = { rendered, content, fieldName, fieldConfig };
    await hooks.trigger(`formatter:render.${fieldConfig.formatter}`, fieldContext);

    context.fields.push(fieldContext.rendered);
  }

  // Hook: Allow modules to alter final rendered output
  await hooks.trigger('display:render', context);

  return {
    contentType,
    viewMode,
    content,
    fields: context.fields,
    metadata: {
      id: content.id,
      created: content.created,
      updated: content.updated,
      author: content.author
    }
  };
}

/**
 * Build field display from content type field definitions
 *
 * WHY THIS EXISTS:
 * When a content type is created, we want default display configurations.
 * This generates sensible defaults based on field types.
 *
 * @param {string} contentType - Content type machine name
 * @param {object} fields - Field definitions from content type
 */
export async function buildDefaultDisplay(contentType, fields) {
  const defaultFields = {};
  let weight = 0;

  for (const [fieldName, fieldDef] of Object.entries(fields)) {
    // Map field types to default formatters
    const formatterMap = {
      text: 'text_default',
      textarea: 'text_default',
      number: 'number',
      boolean: 'boolean',
      date: 'date',
      image: 'image',
      link: 'link',
      entity_reference: 'entity_reference_label'
    };

    const formatter = formatterMap[fieldDef.type] || 'text_default';

    defaultFields[fieldName] = {
      weight: weight++,
      label: 'above',
      formatter,
      settings: {}
    };
  }

  // Create default display for 'full' mode
  await setDisplay(contentType, 'full', defaultFields);

  // Create teaser display with subset of fields
  const teaserFields = {};
  const teaserFieldNames = ['title', 'summary', 'image'];
  let teaserWeight = 0;

  for (const fieldName of teaserFieldNames) {
    if (defaultFields[fieldName]) {
      teaserFields[fieldName] = {
        ...defaultFields[fieldName],
        weight: teaserWeight++
      };

      // Apply teaser-specific settings
      if (fieldName === 'summary' && teaserFields[fieldName].formatter === 'text_default') {
        teaserFields[fieldName].formatter = 'text_trimmed';
        teaserFields[fieldName].settings = { length: 200 };
      }
    }
  }

  if (Object.keys(teaserFields).length > 0) {
    await setDisplay(contentType, 'teaser', teaserFields);
  }

  // Create card display — image + title only, trimmed tight
  const cardFields = {};
  let cardWeight = 0;
  for (const name of ['image', 'title']) {
    if (defaultFields[name]) {
      cardFields[name] = { ...defaultFields[name], weight: cardWeight++, label: 'hidden' };
    }
  }
  if (Object.keys(cardFields).length > 0) {
    await setDisplay(contentType, 'card', cardFields);
  }
}

/**
 * Delete display configuration for content type
 *
 * WHY THIS EXISTS:
 * When content type is deleted, clean up its display configs.
 *
 * @param {string} contentType - Content type machine name
 */
export async function deleteDisplay(contentType) {
  if (displays[contentType]) {
    delete displays[contentType];
    await saveConfig();
  }
}

/**
 * Export current configuration for backup/migration
 *
 * @returns {object} - Complete configuration object
 */
export function exportConfig() {
  return {
    view_modes: { ...viewModes },
    displays: JSON.parse(JSON.stringify(displays))
  };
}

/**
 * Import configuration from backup/migration
 *
 * @param {object} config - Configuration object to import
 */
export async function importConfig(config) {
  if (config.view_modes) {
    Object.assign(viewModes, config.view_modes);
  }

  if (config.displays) {
    Object.assign(displays, config.displays);
  }

  await saveConfig();
}
