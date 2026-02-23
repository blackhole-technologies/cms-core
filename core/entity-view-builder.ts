/**
 * entity-view-builder.js - Entity View Builder Utilities
 *
 * WHY THIS EXISTS:
 * Building entity (content) views requires coordinating display modes, field
 * formatters, field ordering, visibility, and rendering. This service provides
 * programmatic access to the entity rendering pipeline, enabling modules to
 * build custom views, alter rendering, and define display modes.
 *
 * Drupal equivalent: EntityViewBuilder, EntityDisplayRepository
 *
 * DESIGN DECISION:
 * - Display mode registry for different view contexts (full, teaser, compact, search_result)
 * - Field formatter system for rendering field values
 * - Hooks for preprocessing views before rendering
 * - Support for field-level configuration per display mode
 * - Generates render structure (not final HTML) for flexibility
 *
 * @example Build a view
 * ```javascript
 * const viewBuilder = services.get('entity_view_builder');
 *
 * // Build view structure for an entity
 * const view = viewBuilder.buildView(entity, 'teaser');
 *
 * // Render the view to HTML
 * const html = viewBuilder.renderView(view);
 * ```
 *
 * @example Define a display mode
 * ```javascript
 * viewBuilder.defineDisplayMode('article', 'teaser', {
 *   fields: {
 *     title: { visible: true, weight: 0, formatter: 'plain' },
 *     body: { visible: true, weight: 10, formatter: 'truncate', settings: { maxLength: 200 } },
 *     created: { visible: true, weight: 20, formatter: 'date', settings: { format: 'short' } },
 *     author: { visible: false }
 *   }
 * });
 * ```
 */

// ============================================
// TYPE DEFINITIONS
// ============================================

/** Configuration for a single field within a display mode */
export interface FieldDisplayConfig {
  /** Whether the field is visible in this display mode */
  visible?: boolean;
  /** Sort order — lower values appear first */
  weight?: number;
  /** Name of the formatter to use */
  formatter?: string;
  /** Formatter-specific settings */
  settings?: Record<string, unknown>;
}

/** Configuration for an entire display mode */
export interface DisplayModeConfig {
  /** Field display configurations keyed by field name */
  fields: Record<string, FieldDisplayConfig>;
}

/** A formatted field in a view structure */
export interface ViewField {
  /** Field machine name */
  name: string;
  /** Raw field value */
  value: unknown;
  /** Formatted (rendered) value */
  formatted: string;
  /** Sort weight */
  weight: number;
  /** Formatter type used */
  formatter: string;
  /** Formatter settings applied */
  settings: Record<string, unknown>;
}

/** A built view structure ready for rendering */
export interface EntityView {
  /** The source entity */
  entity: Record<string, unknown>;
  /** Entity type (e.g., 'content', 'user') */
  entityType: string;
  /** Bundle/subtype (e.g., 'article', 'page') */
  bundle: string;
  /** Display mode name */
  displayMode: string;
  /** Ordered, formatted fields */
  fields: ViewField[];
}

/** Field formatter function signature */
type FieldFormatter = (value: unknown, settings: Record<string, unknown>) => string;

/** Preprocessor function signature — mutates view in-place before render */
type ViewPreprocessor = (view: EntityView, entity: Record<string, unknown>, displayMode: string) => void;

/** The public entity view builder API surface */
export interface EntityViewBuilderAPI {
  defineDisplayMode: typeof defineDisplayMode;
  getDisplayMode: typeof getDisplayMode;
  registerFormatter: typeof registerFormatter;
  getFormatter: typeof getFormatter;
  listFormatters: typeof listFormatters;
  formatField: typeof formatField;
  registerPreprocessor: typeof registerPreprocessor;
  buildView: typeof buildView;
  renderView: typeof renderView;
}

/**
 * Display mode registry
 * Structure: { entityType: { bundle: { displayMode: config } } }
 */
const displayModes: Record<string, Record<string, Record<string, DisplayModeConfig>>> = {};

/**
 * Field formatter registry
 * Structure: { formatterType: formatterFunction }
 */
const fieldFormatters: Record<string, FieldFormatter> = {};

/**
 * Preprocessing hooks
 * Structure: { entityType: [preprocessFunctions] }
 */
const preprocessHooks: Record<string, ViewPreprocessor[]> = {};

/**
 * Define a display mode for an entity bundle
 *
 * @param {string} entityType - Entity type (e.g., 'content', 'user')
 * @param {string} bundle - Bundle/subtype (e.g., 'article', 'page')
 * @param {string} displayMode - Display mode name (e.g., 'full', 'teaser')
 * @param {Object} config - Display mode configuration
 * @param {Object} config.fields - Field configurations keyed by field name
 * @param {boolean} config.fields[].visible - Whether field is visible
 * @param {number} config.fields[].weight - Sort order (lower = earlier)
 * @param {string} config.fields[].formatter - Formatter type to use
 * @param {Object} [config.fields[].settings] - Formatter-specific settings
 *
 * WHY SEPARATE DISPLAY MODES:
 * Different contexts need different representations. Full article view shows
 * everything; teaser shows title + summary; search results show snippet + link.
 */
export function defineDisplayMode(entityType: string, bundle: string, displayMode: string, config: DisplayModeConfig): void {
  if (!entityType || typeof entityType !== 'string') {
    throw new Error('Entity type must be a non-empty string');
  }

  if (!bundle || typeof bundle !== 'string') {
    throw new Error('Bundle must be a non-empty string');
  }

  if (!displayMode || typeof displayMode !== 'string') {
    throw new Error('Display mode must be a non-empty string');
  }

  if (!config || typeof config !== 'object') {
    throw new Error('Display mode config must be an object');
  }

  if (!config.fields || typeof config.fields !== 'object') {
    throw new Error('Display mode config must have fields object');
  }

  // Initialize nested structure
  if (!displayModes[entityType]) {
    displayModes[entityType] = {};
  }

  if (!displayModes[entityType][bundle]) {
    displayModes[entityType][bundle] = {};
  }

  displayModes[entityType][bundle][displayMode] = config;
}

/**
 * Get display mode configuration
 *
 * @param {string} entityType - Entity type
 * @param {string} bundle - Bundle name
 * @param {string} displayMode - Display mode name
 * @returns {Object|null} Display mode config or null if not found
 */
export function getDisplayMode(entityType: string, bundle: string, displayMode: string): DisplayModeConfig | null {
  return displayModes[entityType]?.[bundle]?.[displayMode] ?? null;
}

/**
 * Register a field formatter
 *
 * @param {string} formatterType - Formatter identifier (e.g., 'plain', 'html', 'truncate')
 * @param {Function} formatter - Function(fieldValue, settings) => formattedValue
 *
 * WHY FUNCTION-BASED:
 * Formatters are simple transformations. Function-based API is cleaner
 * than class-based for this use case.
 */
export function registerFormatter(formatterType: string, formatter: FieldFormatter): void {
  if (!formatterType || typeof formatterType !== 'string') {
    throw new Error('Formatter type must be a non-empty string');
  }

  if (typeof formatter !== 'function') {
    throw new Error(`Formatter for "${formatterType}" must be a function`);
  }

  fieldFormatters[formatterType] = formatter;
}

/**
 * Get a field formatter
 *
 * @param {string} formatterType - Formatter type
 * @returns {Function|null} Formatter function or null
 */
export function getFormatter(formatterType: string): FieldFormatter | null {
  return fieldFormatters[formatterType] ?? null;
}

/**
 * List all registered formatters
 *
 * @returns {string[]} Array of formatter type names
 */
export function listFormatters(): string[] {
  return Object.keys(fieldFormatters);
}

/**
 * Format a field value using a formatter
 *
 * @param {*} fieldValue - Field value to format
 * @param {string} formatterType - Formatter type to use
 * @param {Object} [settings={}] - Formatter-specific settings
 * @returns {*} Formatted value
 */
export function formatField(fieldValue: unknown, formatterType: string, settings: Record<string, unknown> = {}): string {
  const formatter = fieldFormatters[formatterType];

  if (!formatter) {
    // Fallback to plain formatter
    console.warn(`[entity-view-builder] Unknown formatter "${formatterType}", using plain`);
    return String(fieldValue || '');
  }

  return formatter(fieldValue, settings);
}

/**
 * Register a preprocessing hook
 *
 * @param {string} entityType - Entity type to preprocess
 * @param {Function} preprocessor - Function(view, entity, displayMode) => void
 *
 * WHY PREPROCESSING:
 * Modules may want to alter views before rendering (add fields, change
 * formatters, inject metadata). Preprocessing hooks enable customization.
 */
export function registerPreprocessor(entityType: string, preprocessor: ViewPreprocessor): void {
  if (!entityType || typeof entityType !== 'string') {
    throw new Error('Entity type must be a non-empty string');
  }

  if (typeof preprocessor !== 'function') {
    throw new Error('Preprocessor must be a function');
  }

  if (!preprocessHooks[entityType]) {
    preprocessHooks[entityType] = [];
  }

  preprocessHooks[entityType].push(preprocessor);
}

/**
 * Build a view structure for an entity
 *
 * @param {Object} entity - Entity object
 * @param {string} displayMode - Display mode to use (default: 'full')
 * @returns {Object} View structure ready for rendering
 *
 * WHY RETURN STRUCTURE (not HTML):
 * Returning a render structure allows modules to alter the view before
 * rendering. This is more flexible than returning HTML directly.
 *
 * VIEW STRUCTURE:
 * {
 *   entity: { ... },
 *   entityType: 'content',
 *   bundle: 'article',
 *   displayMode: 'teaser',
 *   fields: [
 *     { name: 'title', value: '...', formatted: '...', weight: 0 },
 *     { name: 'body', value: '...', formatted: '...', weight: 10 },
 *   ]
 * }
 */
export function buildView(entity: Record<string, unknown>, displayMode: string = 'full'): EntityView {
  if (!entity || typeof entity !== 'object') {
    throw new Error('Entity must be an object');
  }

  const entityType = (entity.entityType as string) || 'content';
  const bundle = (entity.bundle as string) || (entity.type as string) || 'default';

  // Get display mode configuration
  const config = getDisplayMode(entityType, bundle, displayMode);

  // If no config exists, build default view with all fields
  if (!config) {
    console.warn(`[entity-view-builder] No display mode "${displayMode}" for ${entityType}:${bundle}, using default`);
    return buildDefaultView(entity, entityType, bundle, displayMode);
  }

  // Build field list based on configuration
  const fields: ViewField[] = [];

  // WHY CHECK entity.fields THEN entity:
  // Some entities wrap fields in entity.fields, others have fields directly.
  // Try entity.fields first (structured format), fall back to entity itself.
  const entityFields = (entity.fields as Record<string, unknown>) || entity;

  for (const [fieldName, fieldConfig] of Object.entries(config.fields)) {
    // Skip hidden fields
    if (fieldConfig.visible === false) {
      continue;
    }

    const fieldValue = entityFields[fieldName];
    const formatterType = fieldConfig.formatter || 'plain';
    const settings = fieldConfig.settings || {};

    // Format the field value
    const formatted = formatField(fieldValue, formatterType, settings);

    fields.push({
      name: fieldName,
      value: fieldValue,
      formatted: formatted,
      weight: fieldConfig.weight || 0,
      formatter: formatterType,
      settings: settings,
    });
  }

  // Sort fields by weight
  fields.sort((a, b) => a.weight - b.weight);

  // Build view structure
  const view: EntityView = {
    entity,
    entityType,
    bundle,
    displayMode,
    fields,
  };

  // Run preprocessing hooks
  const hooks = preprocessHooks[entityType] ?? [];
  for (const preprocessor of hooks) {
    preprocessor(view, entity, displayMode);
  }

  return view;
}

/**
 * Build a default view when no display mode is configured
 *
 * @param {Object} entity - Entity object
 * @param {string} entityType - Entity type
 * @param {string} bundle - Bundle name
 * @param {string} displayMode - Display mode name
 * @returns {Object} View structure
 */
function buildDefaultView(entity: Record<string, unknown>, entityType: string, bundle: string, displayMode: string): EntityView {
  const fields: ViewField[] = [];

  // WHY CHECK entity.fields THEN entity:
  // Some entities wrap fields in entity.fields, others have fields directly.
  // Try entity.fields first (structured format), fall back to entity itself.
  const entityFields = (entity.fields as Record<string, unknown>) || entity;

  // Build field list with all fields visible
  // WHY FILTER METADATA FIELDS:
  // Skip internal metadata like id, type, bundle, entityType, etc.
  const metadataFields = new Set(['id', 'type', 'bundle', 'entityType', 'created', 'updated', 'status', 'isDefaultRevision', 'publishedAt', 'scheduledAt', '_layout']);

  for (const [fieldName, fieldValue] of Object.entries(entityFields)) {
    // Skip metadata fields in default view
    if (metadataFields.has(fieldName)) {
      continue;
    }

    // Skip undefined/null values
    if (fieldValue === undefined || fieldValue === null) {
      continue;
    }

    fields.push({
      name: fieldName,
      value: fieldValue,
      formatted: formatField(fieldValue, 'plain'),
      weight: 0,
      formatter: 'plain',
      settings: {},
    });
  }

  return {
    entity,
    entityType,
    bundle,
    displayMode,
    fields,
  };
}

/**
 * Render a view structure to HTML
 *
 * @param {Object} view - View structure from buildView()
 * @returns {string} Rendered HTML
 *
 * WHY SIMPLE HTML:
 * This is utility output for testing and debugging. Production rendering
 * should use the template system with proper theming.
 */
export function renderView(view: EntityView): string {
  if (!view || typeof view !== 'object') {
    throw new Error('View must be an object');
  }

  const { entity, entityType, bundle, displayMode, fields } = view;

  // Build HTML
  let html = `<div class="entity entity--${entityType} entity--${bundle} entity--${displayMode}">\n`;

  // Render entity label if available
  const label = (entity.label || entity.title || entity.name) as string | undefined;
  if (label) {
    html += `  <h2 class="entity__label">${escapeHtml(String(label))}</h2>\n`;
  }

  // Render fields
  for (const field of fields) {
    html += `  <div class="field field--${field.name}">\n`;
    html += `    <div class="field__label">${escapeHtml(field.name)}</div>\n`;
    html += `    <div class="field__value">${escapeHtml(String(field.formatted || ''))}</div>\n`;
    html += `  </div>\n`;
  }

  html += `</div>`;

  return html;
}

/**
 * Escape HTML special characters
 *
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================
// BUILT-IN FIELD FORMATTERS
// ============================================

/**
 * Plain text formatter - returns value as-is
 */
registerFormatter('plain', (value) => {
  return String(value || '');
});

/**
 * HTML formatter - returns value without escaping
 * WARNING: Use only with trusted content
 */
registerFormatter('html', (value) => {
  return String(value || '');
});

/**
 * Truncate formatter - limits text to N characters
 */
registerFormatter('truncate', (value: unknown, settings: Record<string, unknown> = {}): string => {
  const maxLength = (settings.maxLength as number) || 100;
  const suffix = (settings.suffix as string) || '...';
  const text = String(value || '');

  if (text.length <= maxLength) {
    return text;
  }

  return text.substring(0, maxLength - suffix.length) + suffix;
});

/**
 * Date formatter - formats date values
 */
registerFormatter('date', (value: unknown, settings: Record<string, unknown> = {}): string => {
  const format = (settings.format as string) || 'medium';

  if (!value) {
    return '';
  }

  const date = value instanceof Date ? value : new Date(value as string | number);

  if (isNaN(date.getTime())) {
    return String(value);
  }

  // Format options
  const formats: Record<string, Intl.DateTimeFormatOptions> = {
    short: { dateStyle: 'short' },
    medium: { dateStyle: 'medium' },
    long: { dateStyle: 'long' },
    full: { dateStyle: 'full', timeStyle: 'short' },
  };

  const options = formats[format] ?? formats['medium'] as Intl.DateTimeFormatOptions;

  return date.toLocaleString('en-US', options);
});

/**
 * Link formatter - renders as an HTML link
 */
registerFormatter('link', (value: unknown, settings: Record<string, unknown> = {}): string => {
  const url = (settings.url as string) || String(value);
  const text = (settings.text as string) || String(value);

  if (!url) {
    return '';
  }

  return `<a href="${escapeHtml(String(url))}">${escapeHtml(String(text))}</a>`;
});

// ============================================
// DEFAULT DISPLAY MODES
// ============================================

/**
 * Define default display modes for common entity types
 */
function initializeDefaultDisplayModes(): void {
  // Content: Full mode - show all fields
  defineDisplayMode('content', 'default', 'full', {
    fields: {
      title: { visible: true, weight: 0, formatter: 'plain' },
      body: { visible: true, weight: 10, formatter: 'html' },
      created: { visible: true, weight: 20, formatter: 'date', settings: { format: 'medium' } },
      updated: { visible: true, weight: 30, formatter: 'date', settings: { format: 'medium' } },
      author: { visible: true, weight: 40, formatter: 'plain' },
    },
  });

  // Content: Teaser mode - summary view
  defineDisplayMode('content', 'default', 'teaser', {
    fields: {
      title: { visible: true, weight: 0, formatter: 'plain' },
      body: { visible: true, weight: 10, formatter: 'truncate', settings: { maxLength: 200 } },
      created: { visible: true, weight: 20, formatter: 'date', settings: { format: 'short' } },
    },
  });

  // Content: Compact mode - minimal view
  defineDisplayMode('content', 'default', 'compact', {
    fields: {
      title: { visible: true, weight: 0, formatter: 'plain' },
      created: { visible: true, weight: 10, formatter: 'date', settings: { format: 'short' } },
    },
  });

  // Content: Search result mode
  defineDisplayMode('content', 'default', 'search_result', {
    fields: {
      title: { visible: true, weight: 0, formatter: 'plain' },
      body: { visible: true, weight: 10, formatter: 'truncate', settings: { maxLength: 150 } },
    },
  });
}

// ============================================
// SERVICE REGISTRATION
// ============================================

/**
 * Register the entity view builder service
 *
 * @param {Object} services - Legacy services registry
 * @param {Object} container - DI container
 */
export function register(services: Record<string, unknown> | null, container: Record<string, unknown> | null): void {
  // Initialize default display modes
  initializeDefaultDisplayModes();

  const api = {
    defineDisplayMode,
    getDisplayMode,
    registerFormatter,
    getFormatter,
    listFormatters,
    formatField,
    registerPreprocessor,
    buildView,
    renderView,
  };

  // Legacy pattern
  if (services && typeof services.register === 'function') {
    (services.register as (name: string, factory: () => EntityViewBuilderAPI) => void)('entity_view_builder', () => api);
  }

  // New container pattern
  if (container && typeof container.register === 'function') {
    (container.register as (name: string, factory: () => EntityViewBuilderAPI, opts: Record<string, unknown>) => void)(
      'entity_view_builder', () => api, { tags: ['service', 'entity', 'rendering'], singleton: true }
    );
  }
}
