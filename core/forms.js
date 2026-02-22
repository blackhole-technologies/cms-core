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

import * as fields from './fields.js';
import * as validation from './validation.js';
import * as template from './template.ts';

// ============================================
// FORM REGISTRY
// ============================================

/**
 * Registry of form definitions
 * Structure: { formId: { config } }
 */
const forms = {};

/**
 * Widget registry: maps widget names to custom renderers
 * Structure: { widgetName: { render: fn, parse: fn } }
 */
const widgets = {};

/**
 * Form state storage (server-side session)
 * Structure: { formId: { fields: {}, errors: {}, dirty: [], step: 0 } }
 */
const formStates = new Map();

/**
 * Hook registry for form lifecycle events
 */
const hooks = {
  'form:build': [],
  'form:validate': [],
  'form:submit': [],
  'form:alter': []
};

/**
 * Configuration
 */
let config = {
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
 * @param {Object} fieldsModule - fields.js module
 * @param {Object} validationModule - validation.js module
 * @param {Object} templateModule - template.js module
 * @param {Object} cfg - Configuration options
 */
export function init(cfg = {}) {
  config = { ...config, ...cfg };
  console.log('[forms] Initialized');
}

// ============================================
// FORM DEFINITION
// ============================================

/**
 * Define a form configuration
 *
 * @param {string} id - Unique form ID
 * @param {Object} formConfig - Form configuration
 * @returns {Object} Form definition
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
export function defineForm(id, formConfig) {
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

  return forms[id];
}

/**
 * Get a form definition
 *
 * @param {string} id - Form ID
 * @returns {Object|null} Form definition or null
 */
export function getForm(id) {
  return forms[id] || null;
}

/**
 * List all registered forms
 *
 * @returns {Array} Array of form IDs
 */
export function listForms() {
  return Object.keys(forms).sort();
}

/**
 * Check if a form exists
 *
 * @param {string} id - Form ID
 * @returns {boolean}
 */
export function hasForm(id) {
  return id in forms;
}

// ============================================
// FORM BUILDING
// ============================================

/**
 * Build a form structure from content type schema
 *
 * @param {string} contentType - Content type name
 * @param {string} mode - Form mode (default, compact, inline)
 * @param {Object} schema - Content type schema
 * @param {Object} content - Existing content (for edit mode)
 * @returns {Object} Form structure
 *
 * WHY BUILD VS DEFINE:
 * - defineForm: Manual form configuration
 * - buildForm: Auto-generate from schema
 * Most forms are auto-generated from schemas.
 */
export function buildForm(contentType, mode, schema, content = null) {
  const formId = `${contentType}_${mode}`;

  // Check for existing form definition
  let form = getForm(formId);
  if (!form) {
    // Auto-generate from schema
    form = autoGenerateForm(contentType, mode, schema);
  }

  // Run form:build hooks
  for (const hook of hooks['form:build']) {
    hook(form, { contentType, mode, schema, content });
  }

  // Build field structures
  const fieldStructures = {};
  for (const [fieldName, fieldConfig] of Object.entries(form.fields)) {
    const fieldDef = schema[fieldName];
    if (!fieldDef) continue;

    fieldStructures[fieldName] = {
      name: fieldName,
      definition: fieldDef,
      config: fieldConfig,
      widget: fieldConfig.widget || getFieldWidget(fieldDef.type),
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
 * @param {string} contentType - Content type
 * @param {string} mode - Form mode
 * @param {Object} schema - Content schema
 * @returns {Object} Form definition
 */
function autoGenerateForm(contentType, mode, schema) {
  const groups = {
    default: { label: 'Content', weight: 0 }
  };

  const fieldConfigs = {};
  let weight = 0;

  for (const [name, fieldDef] of Object.entries(schema)) {
    // Skip system fields
    if (name.startsWith('_')) continue;

    fieldConfigs[name] = {
      widget: getFieldWidget(fieldDef.type),
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
 * @param {string} fieldType - Field type name
 * @returns {string} Widget name
 */
export function getFieldWidget(fieldType) {
  const fieldTypeConfig = fields.getFieldType(fieldType);
  return fieldTypeConfig?.widget || 'text';
}

// ============================================
// FORM RENDERING
// ============================================

/**
 * Render a form to HTML
 *
 * @param {string} formId - Form ID
 * @param {Object} content - Content data
 * @param {Object} errors - Validation errors { fieldName: error }
 * @param {Object} options - Render options
 * @returns {string} HTML string
 */
export function renderForm(formId, content = null, errors = {}, options = {}) {
  const form = getForm(formId);
  if (!form) {
    throw new Error(`Form not found: ${formId}`);
  }

  const schema = options.schema || {};
  const built = buildForm(form.contentType, form.mode, schema, content);

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
 * @param {Object} built - Built form structure
 * @param {Object} errors - Validation errors
 * @param {Object} options - Render options
 * @returns {string} HTML string
 */
function renderRegularForm(built, errors, options) {
  const { action = '', method = 'POST', cssClass = 'cms-form' } = options;

  // Group fields
  const groupedFields = {};
  for (const [name, field] of Object.entries(built.fields)) {
    const group = field.group || 'default';
    if (!groupedFields[group]) {
      groupedFields[group] = [];
    }
    groupedFields[group].push({ name, ...field });
  }

  // Sort groups by weight
  const sortedGroups = Object.entries(built.groups)
    .sort(([, a], [, b]) => (a.weight ?? 0) - (b.weight ?? 0));

  let html = `<form id="${built.id}" action="${template.escapeHtml(action)}" method="${method}" class="${cssClass}">`;

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
 * @param {Object} field - Field structure
 * @param {string|null} error - Validation error
 * @param {Object} conditions - Conditional visibility rules
 * @returns {string} HTML string
 */
function renderFormField(field, error, conditions) {
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
      conditionalAttrs = ` data-show-if-field="${template.escapeHtml(condition.field)}" data-show-if-not-empty="true"`;
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
  const fieldWithId = { ...definition, name, id: fieldId };

  let inputHtml;
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
 * @param {Object} built - Built form structure
 * @param {Object} errors - Validation errors
 * @param {Object} options - Render options
 * @returns {string} HTML string
 */
function renderMultiStepForm(built, errors, options) {
  const { currentStep = 0 } = options;
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
      html += renderFormField({ name: fieldName, ...field }, error, built.conditions);
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
 * @param {string} formId - Form ID
 * @param {Object} data - Form data to validate
 * @param {Object} schema - Content type schema
 * @returns {Promise<Object>} { valid: bool, errors: {} }
 */
export async function validateForm(formId, data, schema) {
  const form = getForm(formId);
  if (!form) {
    throw new Error(`Form not found: ${formId}`);
  }

  // Run form:validate hooks
  for (const hook of hooks['form:validate']) {
    await hook(form, data);
  }

  // Use validation.js to validate against schema
  const result = await validation.validate(form.contentType, data, { schema });

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
 * @param {string} formId - Form ID
 * @param {Object} data - Submitted form data
 * @param {Object} options - Processing options { schema, content, contentService }
 * @returns {Promise<Object>} { success: bool, content?: obj, errors?: obj }
 */
export async function processForm(formId, data, options = {}) {
  const form = getForm(formId);
  if (!form) {
    throw new Error(`Form not found: ${formId}`);
  }

  const { schema = {}, content = null, contentService = null } = options;

  // Parse form data using field parsers
  const parsed = {};
  for (const [fieldName, fieldDef] of Object.entries(schema)) {
    if (fieldName.startsWith('_')) continue;
    if (fieldName in data) {
      parsed[fieldName] = fields.parseField(fieldDef, data[fieldName]);
    }
  }

  // Validate
  const validationResult = await validateForm(formId, parsed, schema);
  if (!validationResult.valid) {
    return {
      success: false,
      errors: validationResult.errors.reduce((acc, e) => {
        acc[e.field] = e.message;
        return acc;
      }, {})
    };
  }

  // Run form:submit hooks
  for (const hook of hooks['form:submit']) {
    await hook(form, parsed, content);
  }

  // Custom submit handler
  if (form.callbacks.onSubmit) {
    const result = await form.callbacks.onSubmit(parsed, content, contentService);
    if (result) return result;
  }

  // Default: save via content service
  let saved;
  if (contentService) {
    if (content && content.id) {
      saved = contentService.update(form.contentType, content.id, parsed);
    } else {
      saved = contentService.create(form.contentType, parsed);
    }
  }

  return {
    success: true,
    content: saved || parsed
  };
}

// ============================================
// WIDGET REGISTRATION
// ============================================

/**
 * Register a custom widget
 *
 * @param {string} name - Widget name
 * @param {Object} config - Widget config { render, parse }
 */
export function registerWidget(name, config) {
  if (!name || typeof name !== 'string') {
    throw new Error('Widget name must be a non-empty string');
  }

  widgets[name] = {
    render: config.render || null,
    parse: config.parse || null,
    description: config.description || ''
  };
}

/**
 * Get a widget configuration
 *
 * @param {string} name - Widget name
 * @returns {Object|null}
 */
export function getWidget(name) {
  return widgets[name] || null;
}

// ============================================
// FORM STATE MANAGEMENT
// ============================================

/**
 * Get form state
 *
 * @param {string} formId - Form ID
 * @returns {Object} Form state { fields, errors, dirty, step }
 */
export function getFormState(formId) {
  if (!config.enableState) return null;

  if (!formStates.has(formId)) {
    formStates.set(formId, {
      fields: {},
      errors: {},
      dirty: [],
      step: 0
    });
  }

  return formStates.get(formId);
}

/**
 * Set form state
 *
 * @param {string} formId - Form ID
 * @param {Object} state - State to set
 */
export function setFormState(formId, state) {
  if (!config.enableState) return;

  const current = getFormState(formId);
  formStates.set(formId, { ...current, ...state });
}

/**
 * Clear form state
 *
 * @param {string} formId - Form ID
 */
export function clearFormState(formId) {
  formStates.delete(formId);
}

/**
 * Set field visibility
 *
 * @param {string} formId - Form ID
 * @param {string} fieldName - Field name
 * @param {boolean} visible - Visible state
 */
export function setFieldVisibility(formId, fieldName, visible) {
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
 * @param {string} event - Hook event name
 * @param {Function} callback - Hook callback
 */
export function registerHook(event, callback) {
  if (!hooks[event]) {
    throw new Error(`Unknown hook event: ${event}`);
  }

  hooks[event].push(callback);
}

/**
 * Run form:alter hooks
 *
 * @param {Object} form - Form definition
 * @returns {Object} Altered form
 */
export function runAlterHooks(form) {
  for (const hook of hooks['form:alter']) {
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
 * @returns {string} JavaScript code
 */
export function getFormScript() {
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
