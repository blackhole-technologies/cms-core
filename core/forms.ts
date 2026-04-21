/**
 * forms.js - Form Builder System
 *
 * WHY THIS EXISTS:
 * ================
 * Content editing requires dynamic forms. This module provides:
 * - Form definitions from field schemas
 * - Multiple form modes (create/edit/inline)
 * - Field widgets with different input types
 * - Conditional field visibility
 * - Form validation integration
 * - Multi-step wizard forms
 * - Form state tracking
 *
 * ARCHITECTURE:
 * =============
 * Forms integrate with:
 * - fields.js: Field type definitions and widgets
 * - validation.js: Validation rules and execution
 * - template.js: HTML rendering
 *
 * @version 1.0.0
 */

// ============================================
// DEPENDENCIES
// ============================================

import * as fields from './fields.ts';
import * as validation from './validation.ts';
import * as template from './template.ts';

// ============================================
// Types
// ============================================

/** Configuration for the forms system */
interface FormsConfig {
  defaultMode: string;
  enableState: boolean;
  enableMultiStep: boolean;
}

/** A form field configuration within a form definition */
interface FormFieldConfig {
  widget: string;
  group?: string;
  weight?: number;
}

/** A form group configuration */
interface FormGroupConfig {
  label: string;
  weight?: number;
  collapsed?: boolean;
  collapsible?: boolean;
}

/** Multi-step form step definition */
interface FormStep {
  label: string;
  description?: string;
  fields?: string[];
}

/** Conditional visibility rule for a field */
interface FormCondition {
  field?: string;
  value?: unknown;
  op?: string;
}

/** Form callbacks configuration */
interface FormCallbacks {
  onBuild: FormLifecycleCallback | null;
  onValidate: FormValidateCallback | null;
  onSubmit: FormSubmitCallback | null;
}

/** A form definition stored in the registry */
interface FormDefinition {
  id: string;
  contentType: string | null;
  mode: string;
  groups: Record<string, FormGroupConfig>;
  fields: Record<string, FormFieldConfig>;
  conditions: Record<string, FormCondition>;
  steps: FormStep[] | null;
  validation: Record<string, unknown>;
  callbacks: FormCallbacks;
}

/** A built form structure ready for rendering */
interface BuiltForm {
  id: string;
  contentType: string;
  mode: string;
  groups: Record<string, FormGroupConfig>;
  fields: Record<string, BuiltFormField>;
  conditions: Record<string, FormCondition>;
  steps: FormStep[] | null;
  content: Record<string, unknown> | null;
}

/** A built field within a form */
interface BuiltFormField {
  name: string;
  definition: FieldDefinition;
  config: FormFieldConfig;
  widget: string;
  group: string;
  weight: number;
  value: unknown;
}

/** A field definition from the schema */
interface FieldDefinition {
  type?: string;
  label?: string;
  hint?: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  [key: string]: unknown;
}

/** Widget renderer and parser */
interface WidgetConfig {
  render: ((field: FieldWithId, value: unknown, options: Record<string, unknown>) => string) | null;
  parse: ((value: unknown) => unknown) | null;
  description: string;
}

/** Field with id added for rendering.
 *
 * Narrows `type` to a required string (the base `FieldDefinition.type` is
 * optional because raw schema entries may omit it). Callers must supply a
 * default (e.g. 'string') when building a FieldWithId so downstream
 * renderers/parsers that expect `FieldDef` receive a non-undefined type.
 */
interface FieldWithId extends FieldDefinition {
  name: string;
  id: string;
  type: string;
}

/** Form state for tracking server-side session */
interface FormStateData {
  fields: Record<string, unknown>;
  errors: Record<string, string>;
  dirty: string[];
  step: number;
}

/** Validation result from the validation module */
interface ValidationResult {
  valid: boolean;
  errors: Array<{ field: string; message: string }>;
}

/** Form processing result */
interface FormProcessResult {
  success: boolean;
  content?: Record<string, unknown>;
  errors?: Record<string, string>;
}

/** Content service interface for form processing */
interface ContentServiceInterface {
  create(contentType: string, data: Record<string, unknown>): unknown;
  update(contentType: string, id: string, data: Record<string, unknown>): unknown;
}

/** Content item with at least an id */
interface ContentItem {
  id?: string;
  [key: string]: unknown;
}

/** Lifecycle callback types */
type FormLifecycleCallback = (form: FormDefinition, context: Record<string, unknown>) => void;
type FormValidateCallback = (data: Record<string, unknown>, result: ValidationResult) => Promise<{ valid: boolean; errors?: Array<{ field: string; message: string }> } | null>;
type FormSubmitCallback = (parsed: Record<string, unknown>, content: ContentItem | null, contentService: ContentServiceInterface | null) => Promise<FormProcessResult | null>;
type FormHookCallback = (...args: unknown[]) => void | Promise<void>;

// ============================================
// FORM REGISTRY
// ============================================

/**
 * Registry of form definitions
 * Structure: { formId: { config } }
 */
const forms: Record<string, FormDefinition> = {};

/**
 * Widget registry: maps widget names to custom renderers
 * Structure: { widgetName: { render: fn, parse: fn } }
 */
const widgets: Record<string, WidgetConfig> = {};

/**
 * Form state storage (server-side session)
 * Structure: { formId: { fields: {}, errors: {}, dirty: [], step: 0 } }
 */
const formStates: Map<string, FormStateData> = new Map();

/**
 * Hook registry for form lifecycle events
 */
const hooks: Record<string, FormHookCallback[]> = {
  'form:build': [],
  'form:validate': [],
  'form:submit': [],
  'form:alter': []
};

/**
 * Configuration
 */
let config: FormsConfig = {
  defaultMode: 'default',
  enableState: true,
  enableMultiStep: true
};

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize forms system
 *
 * WHY SEPARATE INIT:
 * - Allows dependency injection
 * - Configurable during boot
 * - Testable in isolation
 *
 * @param cfg - Configuration options
 */
export function init(cfg: Partial<FormsConfig> = {}): void {
  config = { ...config, ...cfg };
  console.log('[forms] Initialized');
}

// ============================================
// FORM DEFINITION
// ============================================

/**
 * Define a form configuration
 *
 * @param id - Unique form ID
 * @param formConfig - Form configuration
 * @returns Form definition
 *
 * @example
 * defineForm('article_form', {
 *   contentType: 'article',
 *   mode: 'default',
 *   groups: {
 *     main: { label: 'Content', weight: 0 },
 *     meta: { label: 'Metadata', weight: 10 }
 *   },
 *   fields: {
 *     title: { widget: 'textfield', group: 'main', weight: 0 },
 *     body: { widget: 'textarea', group: 'main', weight: 10 }
 *   }
 * })
 */
export function defineForm(id: string, formConfig: Partial<FormDefinition> & { contentType?: string; mode?: string; onBuild?: FormLifecycleCallback; onValidate?: FormValidateCallback; onSubmit?: FormSubmitCallback }): FormDefinition {
  if (!id || typeof id !== 'string') {
    throw new Error('Form ID must be a non-empty string');
  }

  forms[id] = {
    id,
    contentType: formConfig.contentType || null,
    mode: formConfig.mode || config.defaultMode,
    groups: formConfig.groups || {},
    fields: formConfig.fields || {},
    conditions: formConfig.conditions || {},
    steps: formConfig.steps || null, // For multi-step forms
    validation: formConfig.validation || {},
    callbacks: {
      onBuild: formConfig.onBuild || null,
      onValidate: formConfig.onValidate || null,
      onSubmit: formConfig.onSubmit || null
    }
  };

  return forms[id]!;
}

/**
 * Get a form definition
 *
 * @param id - Form ID
 * @returns Form definition or null
 */
export function getForm(id: string): FormDefinition | null {
  return forms[id] || null;
}

/**
 * List all registered forms
 *
 * @returns Array of form IDs
 */
export function listForms(): string[] {
  return Object.keys(forms).sort();
}

/**
 * Check if a form exists
 *
 * @param id - Form ID
 * @returns true if form exists
 */
export function hasForm(id: string): boolean {
  return id in forms;
}

// ============================================
// FORM BUILDING
// ============================================

/**
 * Build a form structure from content type schema
 *
 * @param contentType - Content type name
 * @param mode - Form mode (default, compact, inline)
 * @param schema - Content type schema
 * @param content - Existing content (for edit mode)
 * @returns Form structure
 *
 * WHY BUILD VS DEFINE:
 * - defineForm: Manual form configuration
 * - buildForm: Auto-generate from schema
 * Most forms are auto-generated from schemas.
 */
export function buildForm(contentType: string, mode: string, schema: Record<string, FieldDefinition>, content: Record<string, unknown> | null = null): BuiltForm {
  const formId = `${contentType}_${mode}`;

  // Check for existing form definition
  let form = getForm(formId);
  if (!form) {
    // Auto-generate from schema
    form = autoGenerateForm(contentType, mode, schema);
  }

  // Run form:build hooks
  for (const hook of hooks['form:build']!) {
    hook(form, { contentType, mode, schema, content });
  }

  // Build field structures
  const fieldStructures: Record<string, BuiltFormField> = {};
  for (const [fieldName, fieldConfig] of Object.entries(form.fields)) {
    const fieldDef = schema[fieldName];
    if (!fieldDef) continue;

    fieldStructures[fieldName] = {
      name: fieldName,
      definition: fieldDef,
      config: fieldConfig,
      widget: fieldConfig.widget || getFieldWidget(fieldDef.type || 'string'),
      group: fieldConfig.group || 'default',
      weight: fieldConfig.weight ?? 0,
      value: content?.[fieldName] ?? fieldDef.default ?? null
    };
  }

  return {
    id: formId,
    contentType,
    mode,
    groups: form.groups,
    fields: fieldStructures,
    conditions: form.conditions,
    steps: form.steps,
    content
  };
}

/**
 * Auto-generate form from schema
 *
 * @param contentType - Content type
 * @param mode - Form mode
 * @param schema - Content schema
 * @returns Form definition
 */
function autoGenerateForm(contentType: string, mode: string, schema: Record<string, FieldDefinition>): FormDefinition {
  const groups: Record<string, FormGroupConfig> = {
    default: { label: 'Content', weight: 0 }
  };

  const fieldConfigs: Record<string, FormFieldConfig> = {};
  let weight = 0;

  for (const [name, fieldDef] of Object.entries(schema)) {
    // Skip system fields
    if (name.startsWith('_')) continue;

    fieldConfigs[name] = {
      widget: getFieldWidget(fieldDef.type || 'string'),
      group: 'default',
      weight: weight++
    };
  }

  return defineForm(`${contentType}_${mode}`, {
    contentType,
    mode,
    groups,
    fields: fieldConfigs
  });
}

/**
 * Get default widget for field type
 *
 * @param fieldType - Field type name
 * @returns Widget name
 */
export function getFieldWidget(fieldType: string): string {
  const fieldTypeConfig = fields.getFieldType(fieldType);
  return fieldTypeConfig?.widget || 'text';
}

// ============================================
// FORM RENDERING
// ============================================

/**
 * Render a form to HTML
 *
 * @param formId - Form ID
 * @param content - Content data
 * @param errors - Validation errors { fieldName: error }
 * @param options - Render options
 * @returns HTML string
 */
export function renderForm(formId: string, content: Record<string, unknown> | null = null, errors: Record<string, string> = {}, options: Record<string, unknown> = {}): string {
  const form = getForm(formId);
  if (!form) {
    throw new Error(`Form not found: ${formId}`);
  }

  const schema = (options.schema || {}) as Record<string, FieldDefinition>;
  const built = buildForm(form.contentType || '', form.mode, schema, content);

  // Multi-step form?
  if (built.steps && config.enableMultiStep) {
    return renderMultiStepForm(built, errors, options);
  }

  // Regular form
  return renderRegularForm(built, errors, options);
}

/**
 * Render a regular (single-page) form
 *
 * @param built - Built form structure
 * @param errors - Validation errors
 * @param options - Render options
 * @returns HTML string
 */
function renderRegularForm(built: BuiltForm, errors: Record<string, string>, options: Record<string, unknown>): string {
  const { action = '', method = 'POST', cssClass = 'cms-form' } = options as { action?: string; method?: string; cssClass?: string };

  // Group fields
  const groupedFields: Record<string, Array<BuiltFormField & { name: string }>> = {};
  for (const [name, field] of Object.entries(built.fields)) {
    const group = field.group || 'default';
    if (!groupedFields[group]) {
      groupedFields[group] = [];
    }
    // Spread first so an explicit `name` (the map key) overrides any stale
    // name that may have been written to the field definition earlier.
    groupedFields[group]!.push({ ...field, name });
  }

  // Sort groups by weight
  const sortedGroups = Object.entries(built.groups)
    .sort(([, a], [, b]) => (a.weight ?? 0) - (b.weight ?? 0));

  let html = `<form id="${built.id}" action="${template.escapeHtml(action as string)}" method="${method}" class="${cssClass}">`;

  // Render each group
  for (const [groupName, groupConfig] of sortedGroups) {
    const groupFields = groupedFields[groupName] || [];
    if (groupFields.length === 0) continue;

    // Sort fields by weight
    groupFields.sort((a, b) => (a.weight ?? 0) - (b.weight ?? 0));

    const collapsed = groupConfig.collapsed ? 'collapsed' : '';
    const collapsible = groupConfig.collapsible ? 'collapsible' : '';

    html += `<fieldset class="form-group ${collapsible} ${collapsed}" data-group="${groupName}">`;

    if (groupConfig.label) {
      const clickAttr = collapsible ? ' onclick="toggleFieldGroup(this)"' : '';
      html += `<legend class="form-group-legend"${clickAttr}>`;
      html += template.escapeHtml(groupConfig.label);
      if (collapsible) html += '<span class="collapse-icon"></span>';
      html += '</legend>';
    }

    html += '<div class="form-group-content">';

    // Render fields
    for (const field of groupFields) {
      const error = errors[field.name] || null;
      html += renderFormField(field, error, built.conditions);
    }

    html += '</div></fieldset>';
  }

  // Form actions
  html += '<div class="form-actions">';
  html += '<button type="submit" class="btn btn-primary">Save</button>';
  html += '<button type="button" class="btn btn-secondary" onclick="history.back()">Cancel</button>';
  html += '</div>';

  html += '</form>';

  return html;
}

/**
 * Render a single form field
 *
 * @param field - Field structure
 * @param error - Validation error
 * @param conditions - Conditional visibility rules
 * @returns HTML string
 */
function renderFormField(field: BuiltFormField & { name: string }, error: string | null, conditions: Record<string, FormCondition>): string {
  const { name, definition, value, widget } = field;
  const fieldId = `field-${name}`;

  // Check for conditional visibility
  const condition = conditions[name];
  let conditionalAttrs = '';
  if (condition) {
    if (condition.field && condition.value !== undefined) {
      conditionalAttrs = ` data-show-if-field="${template.escapeHtml(condition.field)}" data-show-if-value="${template.escapeHtml(String(condition.value))}"`;
    }
    if (condition.op === 'not_empty') {
      conditionalAttrs = ` data-show-if-field="${template.escapeHtml(condition.field || '')}" data-show-if-not-empty="true"`;
    }
  }

  const required = definition.required ? '<span class="required">*</span>' : '';
  const label = definition.label || name;
  const hint = definition.hint || definition.description || '';
  const errorClass = error ? ' has-error' : '';
  const errorHtml = error ? `<div class="field-error">${template.escapeHtml(error)}</div>` : '';
  const hintHtml = hint ? `<small class="field-hint">${template.escapeHtml(hint)}</small>` : '';

  // Get widget renderer
  const widgetRenderer = widgets[widget];
  // Default `type` to 'string' when absent — matches the runtime fallback
  // already used below in the form-field class name (`definition.type || 'string'`).
  const fieldWithId: FieldWithId = { ...definition, type: definition.type || 'string', name, id: fieldId };

  let inputHtml: string;
  if (widgetRenderer && widgetRenderer.render) {
    inputHtml = widgetRenderer.render(fieldWithId, value, {});
  } else {
    inputHtml = fields.renderField(fieldWithId, value, {});
  }

  return `
    <div class="form-field form-field-${definition.type || 'string'}${errorClass}"${conditionalAttrs}>
      <label for="${fieldId}">
        ${template.escapeHtml(label)}
        ${required}
      </label>
      ${inputHtml}
      ${hintHtml}
      ${errorHtml}
    </div>
  `;
}

/**
 * Render a multi-step form
 *
 * @param built - Built form structure
 * @param errors - Validation errors
 * @param options - Render options
 * @returns HTML string
 */
function renderMultiStepForm(built: BuiltForm, errors: Record<string, string>, options: Record<string, unknown>): string {
  const { currentStep = 0 } = options as { currentStep?: number };
  const steps = built.steps;

  if (!steps || steps.length === 0) {
    return renderRegularForm(built, errors, options);
  }

  let html = `<form id="${built.id}" class="cms-form multi-step-form" data-current-step="${currentStep}">`;

  // Progress indicator
  html += '<div class="form-steps">';
  steps.forEach((step, idx) => {
    const active = idx === currentStep ? 'active' : '';
    const complete = idx < currentStep ? 'complete' : '';
    html += `<div class="form-step-indicator ${active} ${complete}">${idx + 1}. ${template.escapeHtml(step.label)}</div>`;
  });
  html += '</div>';

  // Render all steps (hide non-current)
  steps.forEach((step, idx) => {
    const visible = idx === currentStep ? '' : ' style="display:none"';
    html += `<div class="form-step-panel" data-step="${idx}"${visible}>`;
    html += `<h2>${template.escapeHtml(step.label)}</h2>`;
    if (step.description) {
      html += `<p class="step-description">${template.escapeHtml(step.description)}</p>`;
    }

    // Render fields for this step
    for (const fieldName of (step.fields || [])) {
      const field = built.fields[fieldName];
      if (!field) continue;

      const error = errors[fieldName] || null;
      // Spread first so `name: fieldName` (the map key) authoritatively
      // overrides whatever `name` is already on the stored field.
      html += renderFormField({ ...field, name: fieldName }, error, built.conditions);
    }

    html += '</div>';
  });

  // Navigation
  html += '<div class="form-actions">';
  if (currentStep > 0) {
    html += '<button type="button" class="btn btn-secondary" onclick="previousFormStep()">Previous</button>';
  }
  if (currentStep < steps.length - 1) {
    html += '<button type="button" class="btn btn-primary" onclick="nextFormStep()">Next</button>';
  } else {
    html += '<button type="submit" class="btn btn-primary">Submit</button>';
  }
  html += '<button type="button" class="btn btn-secondary" onclick="history.back()">Cancel</button>';
  html += '</div>';

  html += '</form>';

  return html;
}

// ============================================
// FORM VALIDATION
// ============================================

/**
 * Validate form data
 *
 * @param formId - Form ID
 * @param data - Form data to validate
 * @param schema - Content type schema
 * @returns Validation result { valid: bool, errors: {} }
 */
export async function validateForm(formId: string, data: Record<string, unknown>, schema: Record<string, FieldDefinition>): Promise<ValidationResult> {
  const form = getForm(formId);
  if (!form) {
    throw new Error(`Form not found: ${formId}`);
  }

  // Run form:validate hooks
  for (const hook of hooks['form:validate']!) {
    await hook(form, data);
  }

  // Use validation.js to validate against schema
  const result = await validation.validate(form.contentType || '', data, { schema }) as ValidationResult;

  // Custom form validation
  if (form.callbacks.onValidate) {
    const customResult = await form.callbacks.onValidate(data, result);
    if (customResult && typeof customResult === 'object') {
      result.valid = result.valid && customResult.valid;
      result.errors = [...result.errors, ...(customResult.errors || [])];
    }
  }

  return result;
}

// ============================================
// FORM PROCESSING
// ============================================

/**
 * Process form submission
 *
 * @param formId - Form ID
 * @param data - Submitted form data
 * @param options - Processing options { schema, content, contentService }
 * @returns Processing result
 */
export async function processForm(formId: string, data: Record<string, unknown>, options: { schema?: Record<string, FieldDefinition>; content?: ContentItem | null; contentService?: ContentServiceInterface | null } = {}): Promise<FormProcessResult> {
  const form = getForm(formId);
  if (!form) {
    throw new Error(`Form not found: ${formId}`);
  }

  const { schema = {}, content = null, contentService = null } = options;

  // Parse form data using field parsers.
  // `FieldDefinition.type` is optional (raw schemas may omit it), but
  // `fields.parseField` requires `FieldDef.type: string`. Default missing
  // types to 'string' so the parser takes the text-field code path —
  // mirrors the form-render default used in `renderFormField`.
  const parsed: Record<string, unknown> = {};
  for (const [fieldName, fieldDef] of Object.entries(schema)) {
    if (fieldName.startsWith('_')) continue;
    if (fieldName in data) {
      const typedFieldDef = { ...fieldDef, type: fieldDef.type || 'string' };
      parsed[fieldName] = fields.parseField(typedFieldDef, data[fieldName]);
    }
  }

  // Validate
  const validationResult = await validateForm(formId, parsed, schema);
  if (!validationResult.valid) {
    return {
      success: false,
      errors: validationResult.errors.reduce((acc: Record<string, string>, e) => {
        acc[e.field] = e.message;
        return acc;
      }, {})
    };
  }

  // Run form:submit hooks
  for (const hook of hooks['form:submit']!) {
    await hook(form, parsed, content);
  }

  // Custom submit handler
  if (form.callbacks.onSubmit) {
    const result = await form.callbacks.onSubmit(parsed, content, contentService);
    if (result) return result;
  }

  // Default: save via content service
  let saved: unknown;
  if (contentService) {
    if (content && content.id) {
      saved = contentService.update(form.contentType || '', content.id, parsed);
    } else {
      saved = contentService.create(form.contentType || '', parsed);
    }
  }

  return {
    success: true,
    content: (saved || parsed) as Record<string, unknown>
  };
}

// ============================================
// WIDGET REGISTRATION
// ============================================

/**
 * Register a custom widget
 *
 * @param name - Widget name
 * @param widgetConfig - Widget config { render, parse }
 */
export function registerWidget(name: string, widgetConfig: Partial<WidgetConfig> & { description?: string }): void {
  if (!name || typeof name !== 'string') {
    throw new Error('Widget name must be a non-empty string');
  }

  widgets[name] = {
    render: widgetConfig.render || null,
    parse: widgetConfig.parse || null,
    description: widgetConfig.description || ''
  };
}

/**
 * Get a widget configuration
 *
 * @param name - Widget name
 * @returns Widget config or null
 */
export function getWidget(name: string): WidgetConfig | null {
  return widgets[name] || null;
}

// ============================================
// FORM STATE MANAGEMENT
// ============================================

/**
 * Get form state
 *
 * @param formId - Form ID
 * @returns Form state { fields, errors, dirty, step }
 */
export function getFormState(formId: string): FormStateData | null {
  if (!config.enableState) return null;

  if (!formStates.has(formId)) {
    formStates.set(formId, {
      fields: {},
      errors: {},
      dirty: [],
      step: 0
    });
  }

  return formStates.get(formId) ?? null;
}

/**
 * Set form state
 *
 * @param formId - Form ID
 * @param state - State to set
 */
export function setFormState(formId: string, state: Partial<FormStateData>): void {
  if (!config.enableState) return;

  const current = getFormState(formId);
  formStates.set(formId, { ...current, ...state } as FormStateData);
}

/**
 * Clear form state
 *
 * @param formId - Form ID
 */
export function clearFormState(formId: string): void {
  formStates.delete(formId);
}

/**
 * Set field visibility
 *
 * @param formId - Form ID
 * @param fieldName - Field name
 * @param visible - Visible state
 */
export function setFieldVisibility(formId: string, _fieldName: string, _visible: boolean): void {
  const form = getForm(formId);
  if (!form) return;

  // This is handled client-side via data attributes
  // Server-side tracking could be added here if needed
}

// ============================================
// HOOKS
// ============================================

/**
 * Register a form hook
 *
 * @param event - Hook event name
 * @param callback - Hook callback
 */
export function registerHook(event: string, callback: FormHookCallback): void {
  if (!hooks[event]) {
    throw new Error(`Unknown hook event: ${event}`);
  }

  hooks[event]!.push(callback);
}

/**
 * Run form:alter hooks
 *
 * @param form - Form definition
 * @returns Altered form
 */
export function runAlterHooks(form: FormDefinition): FormDefinition {
  for (const hook of hooks['form:alter']!) {
    hook(form);
  }
  return form;
}

// ============================================
// CLIENT-SIDE JAVASCRIPT
// ============================================

/**
 * Get JavaScript for form interactivity
 *
 * @returns JavaScript code
 */
export function getFormScript(): string {
  return `
<script>
// Multi-step form navigation
function nextFormStep() {
  var form = document.querySelector('.multi-step-form');
  if (!form) return;

  var currentStep = parseInt(form.dataset.currentStep || '0');
  var panels = form.querySelectorAll('.form-step-panel');
  if (currentStep >= panels.length - 1) return;

  panels[currentStep].style.display = 'none';
  panels[currentStep + 1].style.display = '';
  form.dataset.currentStep = currentStep + 1;

  updateStepIndicators(currentStep + 1);
}

function previousFormStep() {
  var form = document.querySelector('.multi-step-form');
  if (!form) return;

  var currentStep = parseInt(form.dataset.currentStep || '0');
  if (currentStep <= 0) return;

  var panels = form.querySelectorAll('.form-step-panel');
  panels[currentStep].style.display = 'none';
  panels[currentStep - 1].style.display = '';
  form.dataset.currentStep = currentStep - 1;

  updateStepIndicators(currentStep - 1);
}

function updateStepIndicators(currentStep) {
  var indicators = document.querySelectorAll('.form-step-indicator');
  indicators.forEach(function(ind, idx) {
    ind.classList.toggle('active', idx === currentStep);
    ind.classList.toggle('complete', idx < currentStep);
  });
}

// Conditional field visibility (imported from fields.js)
function initConditionalFields() {
  document.querySelectorAll('[data-show-if-field]').forEach(function(el) {
    var field = el.dataset.showIfField;
    var value = el.dataset.showIfValue;
    var notEmpty = el.dataset.showIfNotEmpty;

    function update() {
      var input = document.querySelector('[name="' + field + '"]');
      if (!input) return;

      var show = false;
      if (notEmpty) {
        show = input.value && input.value.trim() !== '';
      } else {
        var inputVal = input.type === 'checkbox' ? input.checked.toString() : input.value;
        show = inputVal === value;
      }

      el.style.display = show ? '' : 'none';
    }

    update();
    var input = document.querySelector('[name="' + field + '"]');
    if (input) {
      input.addEventListener('change', update);
      input.addEventListener('input', update);
    }
  });
}

// Initialize on load
document.addEventListener('DOMContentLoaded', function() {
  initConditionalFields();
});
</script>
  `.trim();
}

// ============================================
// EXPORTS
// ============================================

export default {
  init,
  defineForm,
  getForm,
  listForms,
  hasForm,
  buildForm,
  renderForm,
  validateForm,
  processForm,
  getFieldWidget,
  registerWidget,
  getWidget,
  getFormState,
  setFormState,
  clearFormState,
  setFieldVisibility,
  registerHook,
  runAlterHooks,
  getFormScript
};
