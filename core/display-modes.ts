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

import fs from 'node:fs/promises';
import path from 'node:path';
import * as hooks from './hooks.ts';

// ============================================================================
// Types
// ============================================================================

/** Metadata describing a view-mode (id → label/description). */
interface ViewModeConfig {
  label: string;
  description: string;
  settings?: Record<string, unknown>;
}

/** Per-field display configuration within a view-mode. */
interface FieldDisplayConfig {
  weight?: number;
  label?: 'above' | 'inline' | 'hidden' | string;
  formatter?: string;
  settings?: Record<string, unknown>;
  /** When true, render even when the field value is null/undefined. */
  showEmpty?: boolean;
}

/** Mapping of field name → display config for a specific view-mode. */
type FieldDisplayMap = Record<string, FieldDisplayConfig>;

/** View-mode display definition: wraps the per-field configs. */
interface DisplayConfig {
  fields: FieldDisplayMap;
}

/**
 * Formatter functions take a raw field value (of any shape coming out of
 * the content store) and return an HTML/string representation for display.
 */
type FormatterFn = (value: unknown, settings?: Record<string, unknown>) => string;

/** Shape of the JSON config file on disk. */
interface DisplayModesConfigFile {
  view_modes?: Record<string, ViewModeConfig>;
  displays?: Record<string, Record<string, DisplayConfig>>;
}

/** Minimal content-entity shape we operate on. */
interface ContentEntity {
  type: string;
  id?: unknown;
  created?: unknown;
  updated?: unknown;
  author?: unknown;
  [key: string]: unknown;
}

/** Result record produced for a single rendered field. */
interface RenderedField {
  name: string;
  label: string;
  value: unknown;
  formatted: string;
  weight: number;
}

/** Final shape returned by renderContent(). */
interface RenderedContent {
  contentType: string;
  viewMode: string;
  content: ContentEntity;
  fields: RenderedField[];
  metadata: {
    id: unknown;
    created: unknown;
    updated: unknown;
    author: unknown;
  };
}

/** Export shape returned by exportConfig(). */
interface ExportedConfig {
  view_modes: Record<string, ViewModeConfig>;
  displays: Record<string, Record<string, DisplayConfig>>;
}

/**
 * Optional content-types module (injected via init) - kept opaque because
 * this module never actually calls it; the reference is preserved for
 * future use / parity with JS version.
 */
type ContentTypesModule = Record<string, unknown>;

/** Optional template module (injected via init) - same rationale as above. */
type TemplateModule = Record<string, unknown>;

// ============================================================================
// Runtime state
// ============================================================================

/**
 * Runtime state
 * WHY SEPARATE FROM CONFIG:
 * Config is serialized JSON, state includes runtime functions (formatters)
 */
let baseDir: string | null = null;
let contentTypesModule: ContentTypesModule | null = null;
let templateModule: TemplateModule | null = null;

/**
 * Storage for view modes configuration
 * Structure: { id: { label, description, settings } }
 */
const viewModes: Record<string, ViewModeConfig> = {
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
const displays: Record<string, Record<string, DisplayConfig>> = {};

/**
 * Field formatters registry
 * Structure: { formatterName: renderFunction }
 *
 * WHY FUNCTION REGISTRY:
 * Different field types need different rendering logic.
 * Modules can register custom formatters for specialized display.
 */
const formatters: Record<string, FormatterFn> = {
  /**
   * Default text formatter - renders as-is
   */
  text_default: (value) => {
    if (value == null) return '';
    return String(value);
  },

  /**
   * Trimmed text formatter - cuts at length, adds ellipsis
   */
  text_trimmed: (value, settings = {}) => {
    if (value == null) return '';
    const text = String(value);
    const length = (settings.length as number) || 200;
    if (text.length <= length) return text;
    return text.substring(0, length).trimEnd() + '...';
  },

  /**
   * Image formatter - renders image tag with alt text
   */
  image: (value, settings = {}) => {
    const v = value as { url?: string; alt?: string } | null | undefined;
    if (!v || !v.url) return '';
    const style = (settings.style as string) || 'original';
    const alt = v.alt || '';
    const url = v.url;
    return `<img src="${url}" alt="${alt}" data-style="${style}" />`;
  },

  /**
   * Entity reference label formatter - displays linked entity label
   */
  entity_reference_label: (value) => {
    if (!value) return '';
    if (Array.isArray(value)) {
      return value
        .map((v: unknown) => {
          const o = v as { label?: string; title?: string; id?: unknown };
          return o.label || o.title || (o.id != null ? String(o.id) : '') || '';
        })
        .join(', ');
    }
    const o = value as { label?: string; title?: string; id?: unknown };
    return o.label || o.title || (o.id != null ? String(o.id) : '') || '';
  },

  /**
   * Link formatter - renders anchor tag
   */
  link: (value, settings = {}) => {
    const v = value as { url?: string; title?: string } | null | undefined;
    if (!v || !v.url) return '';
    const url = v.url;
    const title = v.title || url;
    const target = (settings.target as string) || '_self';
    return `<a href="${url}" target="${target}">${title}</a>`;
  },

  /**
   * Date formatter - formats date with pattern
   */
  date: (value, settings = {}) => {
    if (!value) return '';
    const date = new Date(value as string | number | Date);
    if (isNaN(date.getTime())) return String(value);

    const format = (settings.format as string) || 'medium';
    const formats: Record<string, Intl.DateTimeFormatOptions> = {
      short: { dateStyle: 'short' },
      medium: { dateStyle: 'medium' },
      long: { dateStyle: 'long' },
      full: { dateStyle: 'full', timeStyle: 'medium' },
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

    const decimals = (settings.decimals as number | undefined) ?? 0;
    return num.toFixed(decimals);
  },

  /**
   * Boolean formatter - displays yes/no or custom labels
   */
  boolean: (value, settings = {}) => {
    const truthy = (settings.truthy as string) || 'Yes';
    const falsy = (settings.falsy as string) || 'No';
    return value ? truthy : falsy;
  },
};

/**
 * Configuration file path
 */
function getConfigPath(): string {
  if (!baseDir) throw new Error('[display-modes] Not initialized. Call init() first.');
  return path.join(baseDir, 'config', 'display-modes.json');
}

/**
 * Initialize display modes system
 *
 * WHY INJECT DEPENDENCIES:
 * Loose coupling. Display system doesn't depend on specific implementations.
 * Makes testing easier (can inject mocks).
 */
export async function init(
  dir: string,
  contentTypes: ContentTypesModule | null = null,
  template: TemplateModule | null = null,
): Promise<void> {
  baseDir = dir;
  contentTypesModule = contentTypes;
  templateModule = template;

  try {
    await fs.mkdir(path.join(baseDir, 'config'), { recursive: true });

    const configPath = getConfigPath();
    const data = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(data) as DisplayModesConfigFile;

    // Load view modes
    if (config.view_modes) {
      Object.assign(viewModes, config.view_modes);
    }

    // Load display configurations
    if (config.displays) {
      Object.assign(displays, config.displays);
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== 'ENOENT') {
      console.error('[display-modes] Error loading config:', err.message);
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
async function saveConfig(): Promise<void> {
  const config: DisplayModesConfigFile = {
    view_modes: viewModes,
    displays: displays,
  };

  const configPath = getConfigPath();
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
}

/**
 * Define a new view mode
 */
export async function defineViewMode(id: string, config: Partial<ViewModeConfig>): Promise<void> {
  if (!id || typeof id !== 'string') {
    throw new Error('View mode ID must be a non-empty string');
  }

  viewModes[id] = {
    label: config.label || id,
    description: config.description || '',
    settings: config.settings || {},
  };

  await saveConfig();
}

/**
 * Get all defined view modes
 */
export function getViewModes(): Record<string, ViewModeConfig> {
  return { ...viewModes };
}

/**
 * Get a specific view mode configuration
 */
export function getViewMode(id: string): ViewModeConfig | null {
  return viewModes[id] ? { ...viewModes[id] } : null;
}

/**
 * Set display configuration for a content type's view mode
 *
 * Field config structure:
 * {
 *   weight: 10,           // Sort order (lower = earlier)
 *   label: 'above',       // 'above' | 'inline' | 'hidden'
 *   formatter: 'text_default',  // Formatter ID
 *   settings: {}          // Formatter-specific settings
 * }
 */
export async function setDisplay(
  contentType: string,
  viewMode: string,
  fieldConfigs: FieldDisplayMap,
): Promise<void> {
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
    fields: fieldConfigs || {},
  };

  await saveConfig();
}

/**
 * Get display configuration for a content type's view mode
 *
 * WHY FALLBACK TO 'full':
 * If a view mode isn't configured, fall back to 'full' mode.
 * This ensures content always renders even if not fully configured.
 */
export function getDisplay(contentType: string, viewMode: string): DisplayConfig | null {
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
 */
export async function setFieldVisibility(
  contentType: string,
  viewMode: string,
  fieldName: string,
  visible: boolean,
): Promise<void> {
  if (!displays[contentType]) {
    displays[contentType] = {};
  }
  if (!displays[contentType][viewMode]) {
    displays[contentType][viewMode] = { fields: {} };
  }

  const fieldConfig: FieldDisplayConfig = displays[contentType][viewMode].fields[fieldName] || {};

  if (!visible) {
    // Remove field from display
    delete displays[contentType][viewMode].fields[fieldName];
  } else {
    // Ensure field exists in display
    displays[contentType][viewMode].fields[fieldName] = {
      weight: fieldConfig.weight ?? 0,
      label: fieldConfig.label || 'above',
      formatter: fieldConfig.formatter || 'text_default',
      settings: fieldConfig.settings || {},
    };
  }

  await saveConfig();
}

/**
 * Set field weight (display order) for specific view mode
 */
export async function setFieldWeight(
  contentType: string,
  viewMode: string,
  fieldName: string,
  weight: number,
): Promise<void> {
  if (!displays[contentType]?.[viewMode]?.fields[fieldName]) {
    throw new Error(`Field "${fieldName}" not configured for ${contentType}.${viewMode}`);
  }

  displays[contentType][viewMode].fields[fieldName].weight = weight;
  await saveConfig();
}

/**
 * Set field formatter and settings for specific view mode
 */
export async function setFieldFormatter(
  contentType: string,
  viewMode: string,
  fieldName: string,
  formatter: string,
  settings: Record<string, unknown> = {},
): Promise<void> {
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
 * Render function signature: (value, settings) => string
 *
 * WHY ALLOW CUSTOM FORMATTERS:
 * Sites may have specialized display needs not covered by core formatters.
 * For example: product prices with currency conversion, specialized date ranges.
 */
export function registerFormatter(name: string, renderFn: FormatterFn): void {
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
 */
export function getFieldFormatter(formatterName: string): FormatterFn | null {
  return formatters[formatterName] || null;
}

/**
 * Get all registered formatters
 */
export function getFormatters(): Record<string, FormatterFn> {
  return { ...formatters };
}

/**
 * Render a single field value using configured formatter
 *
 * WHY RETURN OBJECT WITH LABEL:
 * Templates may want to show label above/inline/hidden.
 * Returning structured data gives template full control.
 */
function renderField(value: unknown, fieldConfig: FieldDisplayConfig, fieldName: string): RenderedField {
  const formatter: FormatterFn = (fieldConfig.formatter && formatters[fieldConfig.formatter])
    || formatters.text_default!;
  const formatted = formatter(value, fieldConfig.settings || {});

  return {
    name: fieldName,
    label: fieldConfig.label || 'above',
    value: value,
    formatted: formatted,
    weight: fieldConfig.weight ?? 0,
  };
}

/**
 * Render content using specified view mode
 *
 * WHY ASYNC:
 * Allows hooks to perform async operations (fetch related content, etc.)
 */
export async function renderContent(
  content: ContentEntity,
  viewMode: string = 'full',
  options: Record<string, unknown> = {},
): Promise<RenderedContent> {
  if (!content || !content.type) {
    throw new Error('Content must have a type property');
  }

  const contentType = content.type;
  const display = getDisplay(contentType, viewMode);

  if (!display) {
    throw new Error(`No display configuration for ${contentType}.${viewMode}`);
  }

  // Prepare rendering context for hooks
  interface DisplayHookContext {
    content: ContentEntity;
    contentType: string;
    viewMode: string;
    display: DisplayConfig;
    fields: RenderedField[];
    options: Record<string, unknown>;
    /** Allow hook handlers to attach additional keys. */
    [key: string]: unknown;
  }

  const context: DisplayHookContext = {
    content,
    contentType,
    viewMode,
    display,
    fields: [],
    options,
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
      author: content.author,
    },
  };
}

/**
 * Build field display from content type field definitions
 *
 * WHY THIS EXISTS:
 * When a content type is created, we want default display configurations.
 * This generates sensible defaults based on field types.
 */
export async function buildDefaultDisplay(
  contentType: string,
  fields: Record<string, { type?: string }>,
): Promise<void> {
  const defaultFields: FieldDisplayMap = {};
  let weight = 0;

  for (const [fieldName, fieldDef] of Object.entries(fields)) {
    // Map field types to default formatters
    const formatterMap: Record<string, string> = {
      text: 'text_default',
      textarea: 'text_default',
      number: 'number',
      boolean: 'boolean',
      date: 'date',
      image: 'image',
      link: 'link',
      entity_reference: 'entity_reference_label',
    };

    const formatter = (fieldDef.type && formatterMap[fieldDef.type]) || 'text_default';

    defaultFields[fieldName] = {
      weight: weight++,
      label: 'above',
      formatter,
      settings: {},
    };
  }

  // Create default display for 'full' mode
  await setDisplay(contentType, 'full', defaultFields);

  // Create teaser display with subset of fields
  const teaserFields: FieldDisplayMap = {};
  const teaserFieldNames = ['title', 'summary', 'image'];
  let teaserWeight = 0;

  for (const fieldName of teaserFieldNames) {
    if (defaultFields[fieldName]) {
      teaserFields[fieldName] = {
        ...defaultFields[fieldName],
        weight: teaserWeight++,
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
  const cardFields: FieldDisplayMap = {};
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
 */
export async function deleteDisplay(contentType: string): Promise<void> {
  if (displays[contentType]) {
    delete displays[contentType];
    await saveConfig();
  }
}

/**
 * Export current configuration for backup/migration
 */
export function exportConfig(): ExportedConfig {
  return {
    view_modes: { ...viewModes },
    displays: JSON.parse(JSON.stringify(displays)) as Record<string, Record<string, DisplayConfig>>,
  };
}

/**
 * Import configuration from backup/migration
 */
export async function importConfig(config: DisplayModesConfigFile): Promise<void> {
  if (config.view_modes) {
    Object.assign(viewModes, config.view_modes);
  }

  if (config.displays) {
    Object.assign(displays, config.displays);
  }

  await saveConfig();
}
