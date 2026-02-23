/**
 * fields.js - Field Type Registry and Widget System
 *
 * WHY THIS EXISTS:
 * ================
 * Content forms need various input types (text, numbers, dates, colors, etc).
 * Each field type has its own:
 * - Rendering logic (what HTML to output)
 * - Validation rules (what values are valid)
 * - Parsing logic (how to convert form input to stored value)
 *
 * This module provides a registry of field types that can be extended
 * with custom types. The admin forms use this to render appropriate
 * widgets for each field in a content type's schema.
 *
 * BUILT-IN FIELD TYPES:
 * ====================
 * - string: Single-line text input
 * - text: Multi-line textarea
 * - number: Numeric input with min/max
 * - boolean: Checkbox
 * - date: Date picker
 * - datetime: Date and time picker
 * - select: Dropdown selection
 * - multiselect: Multiple selection
 * - reference: Content reference picker
 * - references: Multiple content references
 * - embed: oEmbed URL field
 * - color: Color picker
 * - url: URL input with validation
 * - email: Email input with validation
 * - file: File upload
 * - image: Image upload with preview
 * - json: JSON editor
 * - markdown: Markdown editor
 * - html: Rich text editor (basic)
 * - slug: Slug input with auto-generate
 * - group: Field grouping container
 *
 * CONDITIONAL FIELDS:
 * ==================
 * Fields can have showIf/hideIf conditions:
 * {
 *   color: {
 *     type: 'color',
 *     showIf: { field: 'featured', value: true }
 *   }
 * }
 *
 * FIELD GROUPS:
 * =============
 * Related fields can be grouped:
 * {
 *   metadata: {
 *     type: 'group',
 *     label: 'Metadata',
 *     collapsible: true,
 *     fields: {
 *       author: { type: 'reference', target: 'user' },
 *       publishDate: { type: 'datetime' }
 *     }
 *   }
 * }
 *
 * FORM TABS:
 * ==========
 * Content types can define tabbed layouts:
 * {
 *   _formLayout: {
 *     tabs: [
 *       { name: 'Content', fields: ['title', 'body'] },
 *       { name: 'SEO', fields: ['metaTitle', 'metaDescription'] }
 *     ]
 *   }
 * }
 */

// ============================================
// TYPES
// ============================================

/** Field definition from content type schema */
interface FieldDef {
  type: string;
  name?: string;
  id?: string;
  label?: string;
  required?: boolean;
  hint?: string;
  description?: string;
  default?: unknown;
  defaultValue?: unknown;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  step?: number;
  pattern?: string;
  placeholder?: string;
  rows?: number;
  options?: Array<string | { value: string; label: string }>;
  target?: string;
  targetType?: string;
  multiple?: boolean;
  accept?: string;
  maxSize?: number;
  showIf?: { field: string; value: unknown };
  hideIf?: { field: string; value: unknown };
  collapsible?: boolean;
  collapsed?: boolean;
  fields?: Record<string, FieldDef>;
  source?: string;
  oembedUrl?: string;
  validate?: (value: unknown) => boolean | string;
  parse?: (value: unknown) => unknown;
  format?: (value: unknown) => unknown;
  render?: (field: FieldDef, value: unknown, options: RenderOptions) => string;
  widget?: string;
  [key: string]: unknown;
}

/** Field type configuration as stored in the registry */
interface FieldTypeConfig {
  name: string;
  label: string;
  widget: string;
  defaultValue: unknown;
  validate: (value: unknown, field?: unknown) => boolean | string | { valid: boolean; error?: string };
  parse: (value: unknown, field?: unknown) => unknown;
  format: (value: unknown) => unknown;
  render: ((field: FieldDef, value: unknown, options: RenderOptions) => string) | null;
  options: Record<string, unknown>;
  source: string;
  description: string;
}

/** Render options passed to widget renderers */
interface RenderOptions {
  [key: string]: unknown;
}

/** Tab definition for form layout */
interface FormTab {
  name: string;
  fields: string[];
}

/** Widget renderer function */
type WidgetRenderer = (field: FieldDef, value: unknown, options: RenderOptions, fieldType?: FieldTypeConfig) => string;

/** Validation error */
interface FieldValidationError {
  field: string;
  message: string;
  value?: unknown;
}

/** Site configuration for init */
interface FieldsConfig {
  fields?: {
    customTypes?: Record<string, Partial<FieldTypeConfig>>;
  };
  [key: string]: unknown;
}

// ============================================
// FIELD TYPE REGISTRY
// ============================================

/**
 * Registry of field types
 * Structure: { typeName: { config } }
 */
const fieldTypes: Record<string, FieldTypeConfig> = {};

/**
 * Initialize field system with built-in types
 *
 * WHY SEPARATE INIT:
 * Allows configuration to be passed (e.g., custom types from config).
 * Called during boot sequence after config is loaded.
 *
 * @param {Object} config - Site configuration
 */
export function init(config: FieldsConfig = {}): void {
  // Register all built-in field types
  registerBuiltinTypes();

  // Register custom types from config
  const customTypes = config.fields?.customTypes || {};
  for (const [name, typeConfig] of Object.entries(customTypes) as Array<[string, Partial<FieldTypeConfig>]>) {
    registerFieldType(name, { ...typeConfig, source: 'config' });
  }

  const typeCount = Object.keys(fieldTypes).length;
  console.log(`[fields] Initialized (${typeCount} field types)`);
}

/**
 * Register a custom field type
 *
 * WHY ALLOW CUSTOM TYPES:
 * Projects often need specialized inputs (e.g., phone numbers,
 * currency, coordinates). Custom types allow extending without
 * modifying core code.
 *
 * @param {string} name - Unique type name
 * @param {Object} config - Field type configuration
 */
export function registerFieldType(name: string, config: Partial<FieldTypeConfig>): void {
  // WHY VALIDATE NAME:
  // Prevents conflicts and ensures consistent naming
  if (!name || typeof name !== 'string') {
    throw new Error('Field type name must be a non-empty string');
  }

  // WHY ALLOW OVERRIDE:
  // Modules might want to enhance built-in types
  fieldTypes[name] = {
    name,
    label: config.label || name.charAt(0).toUpperCase() + name.slice(1),
    widget: config.widget || 'text',
    defaultValue: config.defaultValue ?? null,
    validate: config.validate || (() => true),
    parse: config.parse || ((v: unknown) => v),
    format: config.format || ((v: unknown) => v),
    render: config.render || null,
    options: config.options || {},
    source: config.source || 'custom',
    description: config.description || ''
  };
}

/**
 * Get a field type configuration
 *
 * @param {string} name - Field type name
 * @returns {Object|null} Field type config or null
 */
export function getFieldType(name: string): FieldTypeConfig | null {
  return fieldTypes[name] || null;
}

/**
 * List all registered field types
 *
 * @returns {Array} Array of field type configs
 */
export function listFieldTypes(): FieldTypeConfig[] {
  return Object.values(fieldTypes).sort((a: FieldTypeConfig, b: FieldTypeConfig) => a.name.localeCompare(b.name));
}

/**
 * Check if a field type exists
 *
 * @param {string} name - Field type name
 * @returns {boolean}
 */
export function hasFieldType(name: string): boolean {
  return name in fieldTypes;
}

// ============================================
// FIELD RENDERING
// ============================================

/**
 * Render a field widget to HTML
 *
 * WHY CENTRALIZED RENDERING:
 * - Consistent HTML structure across all fields
 * - Easy to add new field types
 * - Handles conditional logic uniformly
 *
 * @param {Object} field - Field definition from schema
 * @param {*} value - Current field value
 * @param {Object} options - Render options
 * @returns {string} HTML string
 */
export function renderField(field: FieldDef, value: unknown, options: RenderOptions = {}): string {
  const fieldType = getFieldType(field.type);
  if (!fieldType) {
    // Fallback to string type for unknown types
    return renderStringField(field, value, options);
  }

  // Use custom render if provided
  if (fieldType.render) {
    return fieldType.render(field, value, options);
  }

  // Use widget-based rendering
  const widget = fieldType.widget;
  const renderer = widgetRenderers[widget as keyof typeof widgetRenderers];
  if (renderer) {
    return renderer(field, value, options, fieldType);
  }

  // Final fallback
  return renderStringField(field, value, options);
}

/**
 * Render a complete form field with label and wrapper
 *
 * @param {string} name - Field name
 * @param {Object} field - Field definition
 * @param {*} value - Current value
 * @param {Object} options - Render options
 * @returns {string} HTML string
 */
export function renderFormField(name: string, field: FieldDef, value: unknown, options: RenderOptions = {}): string {
  const fieldType = getFieldType(field.type) || getFieldType('string');
  const id = `field-${name}`;
  const required = field.required ? '<span class="required">*</span>' : '';
  const label = field.label || name;
  const hint = field.hint || field.description || '';
  const hintHtml = hint ? `<small class="field-hint">${escapeHtml(hint)}</small>` : '';

  // Conditional attributes
  const conditionalAttrs = buildConditionalAttrs(field);

  // Render the input widget
  const input = renderField({ ...field, name, id }, value, options);

  return `
    <div class="form-group form-group-${field.type || 'string'}"${conditionalAttrs}>
      <label for="${id}">
        ${escapeHtml(label)}
        ${required}
      </label>
      ${input}
      ${hintHtml}
    </div>
  `;
}

/**
 * Render a field group
 *
 * @param {string} name - Group name
 * @param {Object} group - Group definition
 * @param {Object} values - Current values for fields in group
 * @param {Object} options - Render options
 * @returns {string} HTML string
 */
export function renderFieldGroup(name: string, group: FieldDef, values: Record<string, unknown>, options: RenderOptions = {}): string {
  const label = group.label || name;
  const collapsible = group.collapsible ? 'collapsible' : '';
  const collapsed = group.collapsed ? 'collapsed' : '';

  let fieldsHtml = '';
  for (const [fieldName, fieldDef] of Object.entries(group.fields || {}) as Array<[string, FieldDef]>) {
    const fieldValue = values?.[fieldName] ?? fieldDef.default ?? null;
    fieldsHtml += renderFormField(fieldName, fieldDef, fieldValue, options);
  }

  return `
    <fieldset class="field-group ${collapsible} ${collapsed}" data-group="${escapeHtml(name)}">
      <legend class="field-group-legend" ${collapsible ? 'onclick="toggleFieldGroup(this)"' : ''}>
        ${escapeHtml(label)}
        ${collapsible ? '<span class="collapse-icon"></span>' : ''}
      </legend>
      <div class="field-group-content">
        ${fieldsHtml}
      </div>
    </fieldset>
  `;
}

/**
 * Render form tabs
 *
 * @param {Array} tabs - Tab definitions
 * @param {Object} schema - Content type schema
 * @param {Object} values - Current values
 * @param {Object} options - Render options
 * @returns {string} HTML string
 */
export function renderFormTabs(tabs: FormTab[], schema: Record<string, FieldDef>, values: Record<string, unknown>, options: RenderOptions = {}): string {
  if (!tabs || tabs.length === 0) return '';

  // Tab navigation
  let navHtml = '<div class="form-tabs"><ul class="form-tab-nav">';
  tabs.forEach((tab, i) => {
    const active = i === 0 ? 'active' : '';
    navHtml += `<li class="form-tab-item ${active}" data-tab="${i}" onclick="switchFormTab(${i})">${escapeHtml(tab.name)}</li>`;
  });
  navHtml += '</ul></div>';

  // Tab content
  let contentHtml = '<div class="form-tab-content">';
  tabs.forEach((tab, i) => {
    const active = i === 0 ? 'active' : '';
    contentHtml += `<div class="form-tab-panel ${active}" data-tab-panel="${i}">`;

    for (const fieldName of (tab.fields || [])) {
      const fieldDef = schema[fieldName];
      if (!fieldDef) continue;

      if (fieldDef.type === 'group') {
        contentHtml += renderFieldGroup(fieldName, fieldDef, (values?.[fieldName] || {}) as Record<string, unknown>, options);
      } else {
        const fieldValue = values?.[fieldName] ?? fieldDef.default ?? null;
        contentHtml += renderFormField(fieldName, fieldDef, fieldValue, options);
      }
    }

    contentHtml += '</div>';
  });
  contentHtml += '</div>';

  return navHtml + contentHtml;
}

// ============================================
// FIELD VALIDATION
// ============================================

/**
 * Validate a field value
 *
 * @param {Object} field - Field definition
 * @param {*} value - Value to validate
 * @returns {Object} { valid: boolean, error?: string }
 */
export function validateField(field: FieldDef, value: unknown): { valid: boolean; error?: string } {
  const fieldType = getFieldType(field.type);

  // Required check
  if (field.required && (value === null || value === undefined || value === '')) {
    return { valid: false, error: `${field.label || field.name || 'Field'} is required` };
  }

  // Skip further validation if empty and not required
  if (value === null || value === undefined || value === '') {
    return { valid: true };
  }

  // Type-specific validation
  if (fieldType?.validate) {
    const result = fieldType.validate(value, field);
    if (result === false) {
      return { valid: false, error: `Invalid ${field.type || 'value'}` };
    }
    if (typeof result === 'string') {
      return { valid: false, error: result };
    }
    if (typeof result === 'object' && result.valid === false) {
      return result;
    }
  }

  // Custom validator
  if (field.validate && typeof field.validate === 'function') {
    const result = (field.validate as (value: unknown, field?: unknown) => boolean | string)(value, field);
    if (result === false) {
      return { valid: false, error: `Validation failed for ${field.name || 'field'}` };
    }
    if (typeof result === 'string') {
      return { valid: false, error: result };
    }
  }

  // Min/max length for strings
  if (typeof value === 'string') {
    if (field.minLength && value.length < field.minLength) {
      return { valid: false, error: `Must be at least ${field.minLength} characters` };
    }
    if (field.maxLength && value.length > field.maxLength) {
      return { valid: false, error: `Must be at most ${field.maxLength} characters` };
    }
    if (field.pattern) {
      const regex = new RegExp(field.pattern);
      if (!regex.test(value)) {
        return { valid: false, error: (field.patternMessage as string) || 'Invalid format' };
      }
    }
  }

  // Min/max for numbers
  if (typeof value === 'number') {
    if (field.min !== undefined && value < field.min) {
      return { valid: false, error: `Must be at least ${field.min}` };
    }
    if (field.max !== undefined && value > field.max) {
      return { valid: false, error: `Must be at most ${field.max}` };
    }
  }

  return { valid: true };
}

/**
 * Validate all fields in a schema
 *
 * @param {Object} schema - Content type schema
 * @param {Object} values - Values to validate
 * @returns {Object} { valid: boolean, errors: { fieldName: error } }
 */
export function validateFields(schema: Record<string, FieldDef>, values: Record<string, unknown>): { valid: boolean; errors: Record<string, string | undefined> } {
  const errors: Record<string, string | undefined> = {};
  let valid = true;

  for (const [name, field] of Object.entries(schema) as Array<[string, FieldDef]>) {
    // Skip system fields and layout
    if (name.startsWith('_')) continue;

    // Handle groups
    if (field.type === 'group') {
      const groupResult = validateFields(field.fields || {}, (values?.[name] || {}) as Record<string, unknown>);
      if (!groupResult.valid) {
        valid = false;
        for (const [subName, error] of Object.entries(groupResult.errors)) {
          errors[`${name}.${subName}`] = error;
        }
      }
      continue;
    }

    const result = validateField({ ...field, name }, values?.[name]);
    if (!result.valid) {
      valid = false;
      errors[name] = result.error;
    }
  }

  return { valid, errors };
}

// ============================================
// FIELD PARSING
// ============================================

/**
 * Parse a form input value to the appropriate type
 *
 * WHY PARSE:
 * Form submissions come as strings. We need to convert
 * them to the appropriate types (numbers, booleans, arrays, etc).
 *
 * @param {Object} field - Field definition
 * @param {*} rawValue - Raw form value
 * @returns {*} Parsed value
 */
export function parseField(field: FieldDef, rawValue: unknown): unknown {
  const fieldType = getFieldType(field.type);

  // Use type-specific parser if available
  if (fieldType?.parse) {
    return fieldType.parse(rawValue, field);
  }

  // Default parsing based on type
  switch (field.type) {
    case 'number':
      if (rawValue === '' || rawValue === null || rawValue === undefined) return null;
      const num = Number(rawValue);
      return isNaN(num) ? null : num;

    case 'boolean':
      return rawValue === 'true' || rawValue === '1' || rawValue === true;

    case 'date':
    case 'datetime':
      if (!rawValue) return null;
      const date = new Date(rawValue as string | number);
      return isNaN(date.getTime()) ? null : date.toISOString();

    case 'multiselect':
    case 'references':
      if (Array.isArray(rawValue)) return rawValue;
      if (typeof rawValue === 'string') {
        return rawValue.split(',').map(v => v.trim()).filter(Boolean);
      }
      return [];

    case 'json':
      if (typeof rawValue === 'string') {
        try {
          return JSON.parse(rawValue);
        } catch {
          return null;
        }
      }
      return rawValue;

    default:
      return rawValue;
  }
}

/**
 * Parse all fields from form data
 *
 * @param {Object} schema - Content type schema
 * @param {Object} formData - Raw form data
 * @returns {Object} Parsed values
 */
export function parseFields(schema: Record<string, FieldDef>, formData: Record<string, unknown>): Record<string, unknown> {
  const values: Record<string, unknown> = {};

  for (const [name, field] of Object.entries(schema) as Array<[string, FieldDef]>) {
    // Skip system fields and layout
    if (name.startsWith('_')) continue;

    // Handle groups
    if (field.type === 'group') {
      values[name] = parseFields(field.fields || {}, (formData[name] || {}) as Record<string, unknown>);
      continue;
    }

    if (name in formData) {
      values[name] = parseField(field, formData[name]);
    }
  }

  return values;
}

// ============================================
// WIDGET RENDERERS
// ============================================

const widgetRenderers: Record<string, WidgetRenderer> = {
  text: renderStringField,
  textarea: renderTextareaField,
  number: renderNumberField,
  checkbox: renderCheckboxField,
  date: renderDateField,
  datetime: renderDatetimeField,
  select: renderSelectField,
  multiselect: renderMultiselectField,
  reference: renderReferenceField,
  references: renderReferencesField,
  color: renderColorField,
  url: renderUrlField,
  email: renderEmailField,
  file: renderFileField,
  image: renderImageField,
  json: renderJsonField,
  markdown: renderMarkdownField,
  html: renderHtmlField,
  slug: renderSlugField,
  embed: renderEmbedField
};

function renderStringField(field: FieldDef, value: unknown, options: RenderOptions): string {
  const attrs = buildInputAttrs(field, value, 'text');
  return `<input ${attrs}>`;
}

function renderTextareaField(field: FieldDef, value: unknown, options: RenderOptions): string {
  const id = field.id || `field-${field.name}`;
  const name = field.name;
  const required = field.required ? 'required' : '';
  const rows = field.rows || 5;
  const placeholder = field.placeholder || `Enter ${field.label || field.name}`;
  const safeValue = escapeHtml(value || '');

  return `<textarea id="${id}" name="${name}" class="form-input form-textarea" rows="${rows}" placeholder="${placeholder}" ${required}>${safeValue}</textarea>`;
}

function renderNumberField(field: FieldDef, value: unknown, options: RenderOptions): string {
  const attrs = buildInputAttrs(field, value, 'number');
  const min = field.min !== undefined ? `min="${field.min}"` : '';
  const max = field.max !== undefined ? `max="${field.max}"` : '';
  const step = field.step !== undefined ? `step="${field.step}"` : '';
  return `<input ${attrs} ${min} ${max} ${step}>`;
}

function renderCheckboxField(field: FieldDef, value: unknown, options: RenderOptions): string {
  const id = field.id || `field-${field.name}`;
  const name = field.name;
  const checked = value ? 'checked' : '';

  return `
    <label class="checkbox-wrapper">
      <input type="checkbox" id="${id}" name="${name}" value="true" ${checked}>
      <span class="checkbox-label-text">${escapeHtml(field.checkboxLabel || 'Yes')}</span>
    </label>
  `;
}

function renderDateField(field: FieldDef, value: unknown, options: RenderOptions): string {
  const attrs = buildInputAttrs(field, value ? String(value).split('T')[0] : '', 'date');
  return `<input ${attrs}>`;
}

function renderDatetimeField(field: FieldDef, value: unknown, options: RenderOptions): string {
  // Convert ISO string to datetime-local format
  let localValue = '';
  if (value) {
    const date = new Date(value as string | number);
    if (!isNaN(date.getTime())) {
      localValue = date.toISOString().slice(0, 16);
    }
  }
  const attrs = buildInputAttrs(field, localValue, 'datetime-local');
  return `<input ${attrs}>`;
}

function renderSelectField(field: FieldDef, value: unknown, options: RenderOptions): string {
  const id = field.id || `field-${field.name}`;
  const name = field.name;
  const required = field.required ? 'required' : '';

  let optionsHtml = (field.placeholder as unknown) !== false
    ? `<option value="">${escapeHtml(field.placeholder || '-- Select --')}</option>`
    : '';

  const fieldOptions = field.options || [];
  for (const opt of fieldOptions) {
    const optValue = typeof opt === 'object' ? opt.value : opt;
    const optLabel = typeof opt === 'object' ? opt.label : opt;
    const selected = optValue === value ? 'selected' : '';
    optionsHtml += `<option value="${escapeHtml(optValue)}" ${selected}>${escapeHtml(optLabel)}</option>`;
  }

  return `<select id="${id}" name="${name}" class="form-input form-select" ${required}>${optionsHtml}</select>`;
}

function renderMultiselectField(field: FieldDef, value: unknown, options: RenderOptions): string {
  const id = field.id || `field-${field.name}`;
  const name = field.name;
  const values = Array.isArray(value) ? value : [];

  let optionsHtml = '';
  const fieldOptions = field.options || [];
  for (const opt of fieldOptions) {
    const optValue = typeof opt === 'object' ? opt.value : opt;
    const optLabel = typeof opt === 'object' ? opt.label : opt;
    const checked = values.includes(optValue) ? 'checked' : '';
    optionsHtml += `
      <label class="multiselect-option">
        <input type="checkbox" name="${name}" value="${escapeHtml(optValue)}" ${checked}>
        <span>${escapeHtml(optLabel)}</span>
      </label>
    `;
  }

  return `<div id="${id}" class="form-multiselect">${optionsHtml}</div>`;
}

function renderReferenceField(field: FieldDef, value: unknown, options: RenderOptions): string {
  const id = field.id || `field-${field.name}`;
  const name = field.name;
  const target = field.target || 'content';
  const required = field.required ? 'required' : '';

  // In a real implementation, this would fetch available items
  // For now, render a text input for the reference ID
  return `
    <div class="reference-field" data-target="${escapeHtml(target)}">
      <input type="text" id="${id}" name="${name}" value="${escapeHtml(value || '')}" class="form-input" placeholder="Enter ${target} ID" ${required}>
      <button type="button" class="btn btn-small" onclick="openReferencePicker('${name}', '${target}')">Browse</button>
    </div>
  `;
}

function renderReferencesField(field: FieldDef, value: unknown, options: RenderOptions): string {
  const id = field.id || `field-${field.name}`;
  const name = field.name;
  const target = field.target || 'content';
  const values = Array.isArray(value) ? value : [];

  return `
    <div class="references-field" data-target="${escapeHtml(target)}" id="${id}">
      <input type="hidden" name="${name}" value="${escapeHtml(values.join(','))}">
      <ul class="reference-list">
        ${values.map(v => `<li class="reference-item" data-id="${escapeHtml(v)}">${escapeHtml(v)} <button type="button" onclick="removeReference('${name}', '${v}')">&times;</button></li>`).join('')}
      </ul>
      <button type="button" class="btn btn-small" onclick="openReferencePicker('${name}', '${target}', true)">Add ${target}</button>
    </div>
  `;
}

function renderColorField(field: FieldDef, value: unknown, options: RenderOptions): string {
  const id = field.id || `field-${field.name}`;
  const name = field.name;
  const safeValue = value || field.default || '#000000';

  return `
    <div class="color-field">
      <input type="color" id="${id}" name="${name}" value="${escapeHtml(safeValue)}" class="form-color">
      <input type="text" value="${escapeHtml(safeValue)}" class="form-input form-color-text" pattern="#[0-9a-fA-F]{6}" oninput="syncColor(this, '${id}')">
    </div>
  `;
}

function renderUrlField(field: FieldDef, value: unknown, options: RenderOptions): string {
  const attrs = buildInputAttrs(field, value, 'url');
  return `<input ${attrs} pattern="https?://.+">`;
}

function renderEmailField(field: FieldDef, value: unknown, options: RenderOptions): string {
  const attrs = buildInputAttrs(field, value, 'email');
  return `<input ${attrs}>`;
}

function renderFileField(field: FieldDef, value: unknown, options: RenderOptions): string {
  const id = field.id || `field-${field.name}`;
  const name = field.name;
  const accept = field.accept || '*/*';
  const required = field.required && !value ? 'required' : '';

  let preview = '';
  if (value) {
    preview = `<div class="file-preview"><a href="${escapeHtml(value)}" target="_blank">${escapeHtml(String(value).split('/').pop())}</a></div>`;
  }

  return `
    <div class="file-field">
      ${preview}
      <input type="file" id="${id}" name="${name}" accept="${accept}" class="form-file" ${required}>
      ${value ? `<input type="hidden" name="${name}_existing" value="${escapeHtml(value)}">` : ''}
    </div>
  `;
}

function renderImageField(field: FieldDef, value: unknown, options: RenderOptions): string {
  const id = field.id || `field-${field.name}`;
  const name = field.name;
  const accept = field.accept || 'image/*';
  const required = field.required && !value ? 'required' : '';

  // AI alt text generation settings (default enabled)
  const autoGenerateAlt = field.autoGenerateAlt !== false;
  const altFieldName = `${name}_alt`;
  const altValue = field.altValue || '';

  let preview = '';
  if (value) {
    preview = `<div class="image-preview"><img src="${escapeHtml(value)}" alt="Preview" style="max-width: 200px; max-height: 200px;"></div>`;
  }

  return `
    <div class="image-field" data-auto-alt="${autoGenerateAlt}">
      ${preview}
      <input type="file" id="${id}" name="${name}" accept="${accept}" class="form-file" ${required} onchange="handleImageUpload(this, '${id}', ${autoGenerateAlt})">
      ${value ? `<input type="hidden" name="${name}_existing" value="${escapeHtml(value)}">` : ''}

      <!-- Alt text field -->
      <div class="alt-text-field" style="margin-top: 10px;">
        <label for="${id}_alt" style="display: block; margin-bottom: 5px; font-weight: 500;">
          Alt Text ${autoGenerateAlt ? '<span class="ai-badge" title="AI-generated">🤖 AI</span>' : ''}
        </label>
        <div style="display: flex; gap: 8px; align-items: flex-start;">
          <input type="text" id="${id}_alt" name="${altFieldName}" value="${escapeHtml(altValue)}"
                 class="form-input" placeholder="Describe the image for accessibility"
                 style="flex: 1;">
          ${autoGenerateAlt ? `
            <button type="button" class="btn btn-sm" onclick="regenerateAltText('${id}')"
                    title="Regenerate AI alt text" style="white-space: nowrap;">
              🔄 Regenerate
            </button>
          ` : ''}
        </div>
        <div id="${id}_alt_status" class="alt-text-status" style="margin-top: 5px; font-size: 0.875rem;"></div>
        <div id="${id}_alt_quality" class="alt-text-quality" style="margin-top: 5px; font-size: 0.875rem;"></div>
      </div>
    </div>
  `;
}

function renderJsonField(field: FieldDef, value: unknown, options: RenderOptions): string {
  const id = field.id || `field-${field.name}`;
  const name = field.name;
  const rows = field.rows || 10;
  const safeValue = typeof value === 'string' ? value : JSON.stringify(value, null, 2) || '';

  return `
    <div class="json-field">
      <textarea id="${id}" name="${name}" class="form-input form-json" rows="${rows}">${escapeHtml(safeValue)}</textarea>
      <div class="json-error" id="${id}-error" style="display: none;"></div>
    </div>
  `;
}

function renderMarkdownField(field: FieldDef, value: unknown, options: RenderOptions): string {
  const id = field.id || `field-${field.name}`;
  const name = field.name;
  const rows = field.rows || 15;
  const safeValue = escapeHtml(value || '');

  return `
    <div class="markdown-field">
      <div class="markdown-toolbar">
        <button type="button" onclick="insertMarkdown('${id}', 'bold')" title="Bold">B</button>
        <button type="button" onclick="insertMarkdown('${id}', 'italic')" title="Italic">I</button>
        <button type="button" onclick="insertMarkdown('${id}', 'link')" title="Link">🔗</button>
        <button type="button" onclick="insertMarkdown('${id}', 'code')" title="Code">&lt;/&gt;</button>
        <button type="button" onclick="toggleMarkdownPreview('${id}')" title="Preview">👁</button>
      </div>
      <textarea id="${id}" name="${name}" class="form-input form-markdown" rows="${rows}">${safeValue}</textarea>
      <div class="markdown-preview" id="${id}-preview" style="display: none;"></div>
    </div>
  `;
}

function renderHtmlField(field: FieldDef, value: unknown, options: RenderOptions): string {
  const id = field.id || `field-${field.name}`;
  const name = field.name;
  const rows = field.rows || 10;
  const safeValue = escapeHtml(value || '');

  return `
    <div class="html-field">
      <textarea id="${id}" name="${name}" class="form-input form-html" rows="${rows}" data-editor="richtext">${safeValue}</textarea>
    </div>
  `;
}

function renderSlugField(field: FieldDef, value: unknown, options: RenderOptions): string {
  const id = field.id || `field-${field.name}`;
  const name = field.name;
  const source = field.source || 'title';
  const required = field.required ? 'required' : '';

  return `
    <div class="slug-field">
      <input type="text" id="${id}" name="${name}" value="${escapeHtml(value || '')}" class="form-input form-slug" pattern="[a-z0-9-]+" ${required}>
      <button type="button" class="btn btn-small" onclick="generateSlug('${id}', '${source}')">Generate</button>
    </div>
  `;
}

function renderEmbedField(field: FieldDef, value: unknown, options: RenderOptions): string {
  const id = field.id || `field-${field.name}`;
  const name = field.name;
  const valueObj = value as Record<string, unknown> | null;
  const embedValue = (valueObj && typeof valueObj === 'object' ? valueObj.url : value) || '';
  const required = field.required ? 'required' : '';

  let preview = '';
  const oembed = valueObj && typeof valueObj === 'object' ? valueObj.oembed as Record<string, unknown> | undefined : undefined;
  if (oembed?.html) {
    preview = `<div class="embed-preview">${oembed.html}</div>`;
  }

  return `
    <div class="embed-field">
      <input type="url" id="${id}" name="${name}" value="${escapeHtml(embedValue)}" class="form-input" placeholder="Enter URL to embed" ${required}>
      <button type="button" class="btn btn-small" onclick="previewEmbed('${id}')">Preview</button>
      ${preview}
      <div class="embed-preview-container" id="${id}-preview"></div>
    </div>
  `;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function buildInputAttrs(field: FieldDef, value: unknown, type: string = 'text'): string {
  const id = field.id || `field-${field.name}`;
  const name = field.name;
  const required = field.required ? 'required' : '';
  const placeholder = field.placeholder || `Enter ${field.label || field.name}`;
  const safeValue = escapeHtml(value ?? '');
  const maxLength = field.maxLength ? `maxlength="${field.maxLength}"` : '';
  const minLength = field.minLength ? `minlength="${field.minLength}"` : '';

  return `type="${type}" id="${id}" name="${name}" value="${safeValue}" class="form-input" placeholder="${placeholder}" ${required} ${maxLength} ${minLength}`;
}

function buildConditionalAttrs(field: FieldDef): string {
  const attrs = [];

  if (field.showIf) {
    attrs.push(`data-show-if-field="${escapeHtml(field.showIf.field)}"`);
    attrs.push(`data-show-if-value="${escapeHtml(String(field.showIf.value))}"`);
  }

  if (field.hideIf) {
    attrs.push(`data-hide-if-field="${escapeHtml(field.hideIf.field)}"`);
    attrs.push(`data-hide-if-value="${escapeHtml(String(field.hideIf.value))}"`);
  }

  return attrs.length ? ' ' + attrs.join(' ') : '';
}

function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================
// BUILT-IN FIELD TYPES
// ============================================

function registerBuiltinTypes(): void {
  // String - single line text
  registerFieldType('string', {
    label: 'Text',
    widget: 'text',
    defaultValue: '',
    description: 'Single-line text input',
    source: 'core'
  });

  // Text - multiline
  registerFieldType('text', {
    label: 'Text Area',
    widget: 'textarea',
    defaultValue: '',
    description: 'Multi-line text area',
    source: 'core'
  });

  // Number
  registerFieldType('number', {
    label: 'Number',
    widget: 'number',
    defaultValue: null,
    description: 'Numeric input with min/max support',
    validate: (value, field) => {
      if (typeof value !== 'number' || isNaN(value)) {
        return 'Must be a valid number';
      }
      return true;
    },
    parse: (value) => {
      if (value === '' || value === null || value === undefined) return null;
      const num = Number(value);
      return isNaN(num) ? null : num;
    },
    source: 'core'
  });

  // Boolean
  registerFieldType('boolean', {
    label: 'Checkbox',
    widget: 'checkbox',
    defaultValue: false,
    description: 'True/false checkbox',
    parse: (value) => value === 'true' || value === '1' || value === true,
    source: 'core'
  });

  // Date
  registerFieldType('date', {
    label: 'Date',
    widget: 'date',
    defaultValue: null,
    description: 'Date picker',
    validate: (value) => {
      if (!value) return true;
      const date = new Date(value as string | number);
      return !isNaN(date.getTime()) || 'Invalid date';
    },
    source: 'core'
  });

  // Datetime
  registerFieldType('datetime', {
    label: 'Date & Time',
    widget: 'datetime',
    defaultValue: null,
    description: 'Date and time picker',
    validate: (value) => {
      if (!value) return true;
      const date = new Date(value as string | number);
      return !isNaN(date.getTime()) || 'Invalid date/time';
    },
    source: 'core'
  });

  // Select
  registerFieldType('select', {
    label: 'Dropdown',
    widget: 'select',
    defaultValue: null,
    description: 'Single selection dropdown',
    source: 'core'
  });

  // Multiselect
  registerFieldType('multiselect', {
    label: 'Multi-Select',
    widget: 'multiselect',
    defaultValue: [],
    description: 'Multiple selection checkboxes',
    parse: (value) => {
      if (Array.isArray(value)) return value;
      if (typeof value === 'string') return value.split(',').filter(Boolean);
      return [];
    },
    source: 'core'
  });

  // Reference
  registerFieldType('reference', {
    label: 'Reference',
    widget: 'reference',
    defaultValue: null,
    description: 'Reference to another content item',
    source: 'core'
  });

  // References
  registerFieldType('references', {
    label: 'References',
    widget: 'references',
    defaultValue: [],
    description: 'Multiple references to content items',
    parse: (value) => {
      if (Array.isArray(value)) return value;
      if (typeof value === 'string') return value.split(',').filter(Boolean);
      return [];
    },
    source: 'core'
  });

  // Embed (oEmbed)
  registerFieldType('embed', {
    label: 'Embed',
    widget: 'embed',
    defaultValue: null,
    description: 'Embeddable URL (YouTube, Vimeo, etc.)',
    validate: (value) => {
      if (!value) return true;
      const url = typeof value === 'object' && value !== null ? (value as Record<string, unknown>).url : value;
      if (!url) return true;
      try {
        new URL(url as string);
        return true;
      } catch {
        return 'Invalid URL';
      }
    },
    source: 'core'
  });

  // Color
  registerFieldType('color', {
    label: 'Color',
    widget: 'color',
    defaultValue: '#000000',
    description: 'Color picker',
    validate: (value) => {
      if (!value) return true;
      return /^#[0-9a-f]{6}$/i.test(String(value)) || 'Invalid color format (use #RRGGBB)';
    },
    parse: (value) => value ? String(value).toLowerCase() : null,
    source: 'core'
  });

  // URL
  registerFieldType('url', {
    label: 'URL',
    widget: 'url',
    defaultValue: '',
    description: 'URL input with validation',
    validate: (value) => {
      if (!value) return true;
      try {
        new URL(String(value));
        return true;
      } catch {
        return 'Invalid URL';
      }
    },
    source: 'core'
  });

  // Email
  registerFieldType('email', {
    label: 'Email',
    widget: 'email',
    defaultValue: '',
    description: 'Email input with validation',
    validate: (value) => {
      if (!value) return true;
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value)) || 'Invalid email address';
    },
    source: 'core'
  });

  // File
  registerFieldType('file', {
    label: 'File',
    widget: 'file',
    defaultValue: null,
    description: 'File upload',
    source: 'core'
  });

  // Image
  registerFieldType('image', {
    label: 'Image',
    widget: 'image',
    defaultValue: null,
    description: 'Image upload with preview',
    source: 'core'
  });

  // JSON
  registerFieldType('json', {
    label: 'JSON',
    widget: 'json',
    defaultValue: null,
    description: 'JSON data editor',
    validate: (value) => {
      if (!value) return true;
      if (typeof value === 'object') return true;
      try {
        JSON.parse(String(value));
        return true;
      } catch (e) {
        return 'Invalid JSON: ' + (e instanceof Error ? e.message : String(e));
      }
    },
    parse: (value) => {
      if (typeof value === 'object') return value;
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      }
      return null;
    },
    source: 'core'
  });

  // Markdown
  registerFieldType('markdown', {
    label: 'Markdown',
    widget: 'markdown',
    defaultValue: '',
    description: 'Markdown text editor',
    source: 'core'
  });

  // HTML
  registerFieldType('html', {
    label: 'HTML',
    widget: 'html',
    defaultValue: '',
    description: 'Rich text / HTML editor',
    source: 'core'
  });

  // Slug
  registerFieldType('slug', {
    label: 'Slug',
    widget: 'slug',
    defaultValue: '',
    description: 'URL-friendly slug',
    validate: (value) => {
      if (!value) return true;
      return /^[a-z0-9-]+$/.test(String(value)) || 'Slug must contain only lowercase letters, numbers, and hyphens';
    },
    parse: (value) => value ? String(value).toLowerCase().replace(/[^a-z0-9-]/g, '-') : '',
    source: 'core'
  });

  // Group (container for related fields)
  registerFieldType('group', {
    label: 'Field Group',
    widget: 'group',
    defaultValue: {},
    description: 'Group related fields together',
    source: 'core'
  });
}

// ============================================
// FORM JAVASCRIPT (for admin pages)
// ============================================

/**
 * Get JavaScript code for form interactivity
 *
 * @returns {string} JavaScript code
 */
export function getFormScript(): string {
  return `
<script>
// Conditional field visibility
function initConditionalFields() {
  document.querySelectorAll('[data-show-if-field], [data-hide-if-field]').forEach(function(el) {
    var showField = el.dataset.showIfField;
    var showValue = el.dataset.showIfValue;
    var hideField = el.dataset.hideIfField;
    var hideValue = el.dataset.hideIfValue;

    function update() {
      var show = true;
      if (showField) {
        var input = document.querySelector('[name="' + showField + '"]');
        if (input) {
          var val = input.type === 'checkbox' ? input.checked.toString() : input.value;
          show = val === showValue;
        }
      }
      if (hideField) {
        var input = document.querySelector('[name="' + hideField + '"]');
        if (input) {
          var val = input.type === 'checkbox' ? input.checked.toString() : input.value;
          if (val === hideValue) show = false;
        }
      }
      el.style.display = show ? '' : 'none';
    }

    // Initial state
    update();

    // Watch for changes
    var watchFields = [showField, hideField].filter(Boolean);
    watchFields.forEach(function(fname) {
      var input = document.querySelector('[name="' + fname + '"]');
      if (input) {
        input.addEventListener('change', update);
        input.addEventListener('input', update);
      }
    });
  });
}

// Toggle field group collapse
function toggleFieldGroup(legend) {
  var fieldset = legend.parentElement;
  fieldset.classList.toggle('collapsed');
}

// Switch form tabs
function switchFormTab(index) {
  document.querySelectorAll('.form-tab-item').forEach(function(el, i) {
    el.classList.toggle('active', i === index);
  });
  document.querySelectorAll('.form-tab-panel').forEach(function(el, i) {
    el.classList.toggle('active', i === index);
  });
}

// Color field sync
function syncColor(textInput, colorId) {
  var colorInput = document.getElementById(colorId);
  if (colorInput && /^#[0-9a-f]{6}$/i.test(textInput.value)) {
    colorInput.value = textInput.value;
  }
}

// Generate slug from source field
function generateSlug(slugFieldId, sourceFieldName) {
  var sourceField = document.querySelector('[name="' + sourceFieldName + '"]');
  var slugField = document.getElementById(slugFieldId);
  if (sourceField && slugField) {
    var slug = sourceField.value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    slugField.value = slug;
  }
}

// Enhanced image upload with AI alt text generation
async function handleImageUpload(input, fieldId, autoGenerateAlt) {
  // Show preview
  previewImage(input, fieldId);

  // Generate AI alt text if enabled
  if (autoGenerateAlt && input.files && input.files[0]) {
    const statusEl = document.getElementById(fieldId + '_alt_status');
    const altInput = document.getElementById(fieldId + '_alt');
    const qualityEl = document.getElementById(fieldId + '_alt_quality');

    try {
      statusEl.innerHTML = '<span style="color: #0066cc;">⏳ Generating AI alt text...</span>';

      // Convert image to base64
      const file = input.files[0];
      const base64 = await fileToBase64(file);

      // Call AI alt text generation API
      const response = await fetch('/api/generate-alt-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, filename: file.name })
      });

      if (!response.ok) throw new Error('Generation failed');

      const result = await response.json();

      // Populate alt text field
      altInput.value = result.altText;
      altInput.dataset.aiGenerated = 'true';
      altInput.dataset.provider = result.provider;
      altInput.dataset.confidence = result.confidence;

      statusEl.innerHTML = '<span style="color: #28a745;">✓ Generated by ' + result.provider + ' (' + Math.round(result.confidence * 100) + '% confidence)</span>';

      // Score the quality
      scoreAltTextQuality(fieldId);

    } catch (error) {
      console.error('Alt text generation failed:', error);
      statusEl.innerHTML = '<span style="color: #dc3545;">⚠️ AI generation failed. Please enter manually.</span>';
    }
  }
}

// Regenerate alt text for an image
async function regenerateAltText(fieldId) {
  const imageInput = document.getElementById(fieldId);
  if (!imageInput.files || !imageInput.files[0]) {
    alert('Please select an image first');
    return;
  }

  // Reuse upload handler
  await handleImageUpload(imageInput, fieldId, true);
}

// Score alt text quality
async function scoreAltTextQuality(fieldId) {
  const altInput = document.getElementById(fieldId + '_alt');
  const qualityEl = document.getElementById(fieldId + '_alt_quality');

  if (!altInput.value) {
    qualityEl.innerHTML = '';
    return;
  }

  try {
    const response = await fetch('/api/score-alt-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ altText: altInput.value })
    });

    if (!response.ok) throw new Error('Scoring failed');

    const result = await response.json();

    // Display quality score with color coding
    let color = '#28a745'; // Green
    if (result.score < 60) color = '#dc3545'; // Red
    else if (result.score < 75) color = '#ffc107'; // Yellow

    const suggestions = result.suggestions.length > 0
      ? '<br><small>' + result.suggestions.slice(0, 2).join('. ') + '</small>'
      : '';

    qualityEl.innerHTML = '<span style="color: ' + color + ';">Quality: ' + result.score + '/100 (' + result.rating + ')' + suggestions + '</span>';

  } catch (error) {
    console.error('Quality scoring failed:', error);
  }
}

// Convert file to base64
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // Extract base64 data (remove data:image/...;base64, prefix)
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Image preview (original function)
function previewImage(input, fieldId) {
  var preview = input.parentElement.querySelector('.image-preview');
  if (!preview) {
    preview = document.createElement('div');
    preview.className = 'image-preview';
    input.parentElement.insertBefore(preview, input);
  }
  if (input.files && input.files[0]) {
    var reader = new FileReader();
    reader.onload = function(e) {
      preview.innerHTML = '<img src="' + e.target.result + '" alt="Preview" style="max-width: 200px; max-height: 200px;">';
    };
    reader.readAsDataURL(input.files[0]);
  }
}

// Embed preview
function previewEmbed(fieldId) {
  var input = document.getElementById(fieldId);
  var container = document.getElementById(fieldId + '-preview');
  if (!input || !container || !input.value) return;

  container.innerHTML = '<p>Loading preview...</p>';
  fetch('/admin/oembed/preview?url=' + encodeURIComponent(input.value))
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.error) {
        container.innerHTML = '<p class="error">' + data.error + '</p>';
      } else if (data.html) {
        container.innerHTML = data.html;
      } else {
        container.innerHTML = '<p>No preview available</p>';
      }
    })
    .catch(function(err) {
      container.innerHTML = '<p class="error">Failed to load preview</p>';
    });
}

// Markdown toolbar
function insertMarkdown(fieldId, type) {
  var textarea = document.getElementById(fieldId);
  if (!textarea) return;

  var start = textarea.selectionStart;
  var end = textarea.selectionEnd;
  var text = textarea.value;
  var selected = text.substring(start, end);
  var insert = '';

  switch (type) {
    case 'bold':
      insert = '**' + (selected || 'bold text') + '**';
      break;
    case 'italic':
      insert = '_' + (selected || 'italic text') + '_';
      break;
    case 'link':
      insert = '[' + (selected || 'link text') + '](url)';
      break;
    case 'code':
      insert = selected.includes('\\n') ? '\\n\`\`\`\\n' + selected + '\\n\`\`\`\\n' : '\`' + (selected || 'code') + '\`';
      break;
  }

  textarea.value = text.substring(0, start) + insert + text.substring(end);
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = start + insert.length;
}

// Markdown preview toggle
function toggleMarkdownPreview(fieldId) {
  var textarea = document.getElementById(fieldId);
  var preview = document.getElementById(fieldId + '-preview');
  if (!textarea || !preview) return;

  if (preview.style.display === 'none') {
    // Simple markdown to HTML (basic)
    var html = textarea.value
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      .replace(/\\*\\*(.*)\\*\\*/gim, '<strong>$1</strong>')
      .replace(/\\*(.*)\\*/gim, '<em>$1</em>')
      .replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/gim, '<a href="$2">$1</a>')
      .replace(/\`([^\`]+)\`/gim, '<code>$1</code>')
      .replace(/\\n/gim, '<br>');
    preview.innerHTML = html;
    preview.style.display = 'block';
    textarea.style.display = 'none';
  } else {
    preview.style.display = 'none';
    textarea.style.display = '';
  }
}

// Reference picker placeholder
function openReferencePicker(fieldName, targetType, multiple) {
  alert('Reference picker for ' + targetType + ' (not yet implemented)');
}

function removeReference(fieldName, refId) {
  var container = document.querySelector('.references-field[data-target]');
  if (!container) return;
  var hidden = container.querySelector('input[type="hidden"]');
  var item = container.querySelector('[data-id="' + refId + '"]');
  if (item) item.remove();
  if (hidden) {
    var values = hidden.value.split(',').filter(function(v) { return v !== refId; });
    hidden.value = values.join(',');
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', initConditionalFields);
</script>
  `;
}

/**
 * Get CSS styles for form widgets
 *
 * @returns {string} CSS code
 */
export function getFormStyles(): string {
  return `
<style>
/* Field Groups */
.field-group {
  border: 1px solid #dee2e6;
  border-radius: 4px;
  padding: 1rem;
  margin-bottom: 1rem;
}
.field-group-legend {
  font-weight: 600;
  padding: 0 0.5rem;
  cursor: default;
}
.field-group.collapsible .field-group-legend {
  cursor: pointer;
}
.field-group.collapsible .collapse-icon::after {
  content: ' ▼';
  font-size: 0.75rem;
}
.field-group.collapsed .collapse-icon::after {
  content: ' ▶';
}
.field-group.collapsed .field-group-content {
  display: none;
}

/* Form Tabs */
.form-tabs {
  margin-bottom: 1rem;
}
.form-tab-nav {
  display: flex;
  list-style: none;
  padding: 0;
  margin: 0;
  border-bottom: 2px solid #dee2e6;
}
.form-tab-item {
  padding: 0.75rem 1.25rem;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  transition: all 0.2s;
}
.form-tab-item:hover {
  background: #f8f9fa;
}
.form-tab-item.active {
  border-bottom-color: #0d6efd;
  color: #0d6efd;
  font-weight: 500;
}
.form-tab-panel {
  display: none;
  padding-top: 1rem;
}
.form-tab-panel.active {
  display: block;
}

/* Specific Field Styles */
.color-field {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}
.form-color {
  width: 50px;
  height: 38px;
  padding: 2px;
  cursor: pointer;
}
.form-color-text {
  width: 100px;
  font-family: monospace;
}

.slug-field {
  display: flex;
  gap: 0.5rem;
}
.slug-field .form-input {
  flex: 1;
  font-family: monospace;
}

.reference-field,
.references-field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.reference-field .form-input {
  flex: 1;
}
.reference-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.reference-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem;
  background: #f8f9fa;
  border-radius: 4px;
  margin-bottom: 0.25rem;
}

.embed-field .embed-preview,
.embed-field .embed-preview-container {
  margin-top: 0.5rem;
  padding: 0.5rem;
  background: #f8f9fa;
  border-radius: 4px;
}

.multiselect-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0;
}

.checkbox-wrapper {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}

.markdown-toolbar {
  display: flex;
  gap: 0.25rem;
  margin-bottom: 0.5rem;
}
.markdown-toolbar button {
  padding: 0.25rem 0.5rem;
  border: 1px solid #dee2e6;
  background: #fff;
  cursor: pointer;
  border-radius: 3px;
}
.markdown-toolbar button:hover {
  background: #f8f9fa;
}
.markdown-preview {
  padding: 1rem;
  border: 1px solid #dee2e6;
  border-radius: 4px;
  background: #fff;
  min-height: 100px;
}

.json-field .json-error {
  color: #dc3545;
  font-size: 0.875rem;
  margin-top: 0.25rem;
}

.image-preview,
.file-preview {
  margin-bottom: 0.5rem;
}
.image-preview img {
  border: 1px solid #dee2e6;
  border-radius: 4px;
}

/* Conditional field animation */
.form-group[data-show-if-field],
.form-group[data-hide-if-field] {
  transition: opacity 0.2s, max-height 0.2s;
}
</style>
  `;
}
