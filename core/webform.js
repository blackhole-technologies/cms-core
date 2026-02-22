/**
 * Webform Builder - Configurable Form System
 *
 * WHY THIS EXISTS:
 * Contact forms handle simple contact-us scenarios, but a CMS needs
 * arbitrary user-defined forms: surveys, registrations, applications,
 * order forms, feedback collectors. Webform provides:
 * - Admin-defined form structures (no code required)
 * - 15+ element types with validation
 * - Conditional logic (show/hide fields based on other fields)
 * - Multi-step wizard with progress indicator
 * - Submission storage, viewing, CSV export
 * - Email and webhook handlers on submission
 *
 * DRUPAL HERITAGE:
 * Inspired by Drupal's Webform module (drupal.org/project/webform):
 * - Forms as configuration (YAML in Drupal, JSON here)
 * - Element types with settings
 * - Conditional visibility (states API)
 * - Handlers for email, remote post, etc.
 * - Submission management with export
 *
 * STORAGE STRATEGY:
 * - Form definitions: config/webforms/<id>.json (direct file I/O, human-readable IDs)
 * - Submissions: content/webform-submissions/<formId>/<timestamp>.json (direct file I/O)
 * - This avoids content service ID mismatch and keeps submissions organized by form
 *
 * DESIGN DECISIONS:
 * - Zero dependencies (Node.js built-in only)
 * - Form definitions are JSON config, not code
 * - Elements array (ordered) rather than object (unordered)
 * - Conditional logic evaluated server-side for validation, client-side for UX
 * - Multi-step uses page_break elements to split into wizard pages
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import * as hooks from './hooks.ts';

// ============================================
// STATE
// ============================================

let baseDir = '';
let formDir = '';
let submissionBaseDir = '';
let emailService = null;
let contentService = null;

// ============================================
// ELEMENT TYPES
// ============================================

/**
 * Supported element types and their validation/rendering metadata.
 *
 * WHY REGISTRY PATTERN:
 * - Central place to define what's available
 * - Easy to extend with custom types
 * - Each type knows its HTML input type and validation rules
 */
const ELEMENT_TYPES = {
  textfield:   { inputType: 'text',            label: 'Text field',     hasOptions: false },
  textarea:    { inputType: 'textarea',        label: 'Text area',      hasOptions: false },
  email:       { inputType: 'email',           label: 'Email',          hasOptions: false },
  number:      { inputType: 'number',          label: 'Number',         hasOptions: false },
  url:         { inputType: 'url',             label: 'URL',            hasOptions: false },
  tel:         { inputType: 'tel',             label: 'Phone',          hasOptions: false },
  date:        { inputType: 'date',            label: 'Date',           hasOptions: false },
  select:      { inputType: 'select',          label: 'Select list',    hasOptions: true },
  checkboxes:  { inputType: 'checkboxes',      label: 'Checkboxes',     hasOptions: true },
  radios:      { inputType: 'radios',          label: 'Radio buttons',  hasOptions: true },
  file:        { inputType: 'file',            label: 'File upload',    hasOptions: false },
  hidden:      { inputType: 'hidden',          label: 'Hidden',         hasOptions: false },
  markup:      { inputType: 'markup',          label: 'Markup/HTML',    hasOptions: false, noInput: true },
  fieldset:    { inputType: 'fieldset',        label: 'Fieldset',       hasOptions: false, container: true },
  page_break:  { inputType: 'page_break',      label: 'Page break',     hasOptions: false, noInput: true },
};

// ============================================
// CONDITIONAL OPERATORS
// ============================================

/**
 * Operators for conditional logic (showIf / requiredIf).
 *
 * WHY SERVER-SIDE EVALUATION:
 * - Client-side JS handles show/hide for UX
 * - Server-side re-evaluates for validation (can't trust client)
 * - Both use the same operator definitions
 */
const OPERATORS = {
  equals:       (fieldVal, targetVal) => String(fieldVal) === String(targetVal),
  not_equals:   (fieldVal, targetVal) => String(fieldVal) !== String(targetVal),
  contains:     (fieldVal, targetVal) => String(fieldVal).includes(String(targetVal)),
  not_contains: (fieldVal, targetVal) => !String(fieldVal).includes(String(targetVal)),
  is_empty:     (fieldVal) => !fieldVal || String(fieldVal).trim() === '',
  is_not_empty: (fieldVal) => fieldVal && String(fieldVal).trim() !== '',
  greater_than: (fieldVal, targetVal) => Number(fieldVal) > Number(targetVal),
  less_than:    (fieldVal, targetVal) => Number(fieldVal) < Number(targetVal),
};

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize the webform system.
 *
 * @param {Object} webformConfig - Configuration from site.json
 * @param {Object} contentModule - Content service for submissions
 * @param {Object} emailModule - Email service (optional)
 */
export function init(webformConfig = {}, contentModule = null, emailModule = null) {
  baseDir = webformConfig.baseDir || process.cwd();
  contentService = contentModule;
  emailService = emailModule;

  formDir = join(baseDir, 'config', 'webforms');
  submissionBaseDir = join(baseDir, 'content', 'webform-submissions');

  mkdirSync(formDir, { recursive: true });
  mkdirSync(submissionBaseDir, { recursive: true });

  const forms = listForms();
  console.log(`[webform] Initialized (${forms.length} forms, email: ${emailService ? 'enabled' : 'disabled'})`);
}

// ============================================
// FORM CRUD
// ============================================

/**
 * Read a webform definition from disk.
 *
 * @param {string} id - Webform ID
 * @returns {Object|null} Webform definition or null
 */
function readFormSync(id) {
  const filePath = join(formDir, `${id}.json`);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`[webform] Error reading form ${id}:`, err.message);
    return null;
  }
}

/**
 * Write a webform definition to disk.
 *
 * @param {string} id - Webform ID
 * @param {Object} data - Webform data
 */
function writeFormSync(id, data) {
  const form = { ...data, id, updated: new Date().toISOString() };
  const filePath = join(formDir, `${id}.json`);
  writeFileSync(filePath, JSON.stringify(form, null, 2) + '\n');
}

/**
 * List all webforms.
 *
 * @returns {Array<Object>} All webform definitions
 */
export function listForms() {
  if (!existsSync(formDir)) return [];
  return readdirSync(formDir)
    .filter(f => f.endsWith('.json'))
    .map(f => readFormSync(f.replace('.json', '')))
    .filter(Boolean)
    .sort((a, b) => (a.weight || 0) - (b.weight || 0));
}

/**
 * Get a single webform.
 *
 * @param {string} id - Webform ID
 * @returns {Object|null} Webform or null
 */
export function getForm(id) {
  return readFormSync(id);
}

/**
 * Create a new webform.
 *
 * @param {Object} data - Webform data
 * @param {string} data.id - Machine name (lowercase, hyphens, underscores)
 * @param {string} data.title - Human-readable title
 * @param {Array} data.elements - Form elements
 * @param {Object} data.settings - Form settings
 * @param {Array} data.handlers - Submission handlers
 * @returns {Object} Created webform
 */
export async function createForm(data) {
  if (!data.id) throw new Error('Webform ID is required');
  if (!data.title) throw new Error('Webform title is required');
  if (readFormSync(data.id)) throw new Error(`Webform "${data.id}" already exists`);

  await hooks.trigger('webform:beforeCreate', { data });

  const form = {
    id: data.id,
    title: data.title,
    description: data.description || '',
    status: data.status || 'open',       // open, closed, scheduled
    elements: data.elements || [],
    settings: {
      submitLabel: 'Submit',
      confirmationMessage: 'Thank you for your submission.',
      confirmationType: 'message',       // message, redirect, inline
      redirectUrl: '',
      limitPerUser: 0,                   // 0 = unlimited
      limitTotal: 0,
      ...data.settings,
    },
    handlers: data.handlers || [],
    weight: data.weight || 0,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };

  writeFormSync(form.id, form);
  await hooks.trigger('webform:afterCreate', { form });
  return form;
}

/**
 * Update an existing webform.
 *
 * @param {string} id - Webform ID
 * @param {Object} data - Fields to update
 * @returns {Object} Updated webform
 */
export async function updateForm(id, data) {
  const form = readFormSync(id);
  if (!form) throw new Error(`Webform "${id}" not found`);

  await hooks.trigger('webform:beforeUpdate', { form, data });

  const updated = {
    ...form,
    ...data,
    id,  // Preserve ID
    settings: { ...form.settings, ...(data.settings || {}) },
    updated: new Date().toISOString(),
  };

  writeFormSync(id, updated);
  await hooks.trigger('webform:afterUpdate', { form: updated });
  return updated;
}

/**
 * Delete a webform and all its submissions.
 *
 * @param {string} id - Webform ID
 * @returns {boolean} Success
 */
export async function deleteForm(id) {
  const form = readFormSync(id);
  if (!form) throw new Error(`Webform "${id}" not found`);

  await hooks.trigger('webform:beforeDelete', { form });

  // Delete all submissions
  const subDir = join(submissionBaseDir, id);
  if (existsSync(subDir)) {
    for (const file of readdirSync(subDir).filter(f => f.endsWith('.json'))) {
      unlinkSync(join(subDir, file));
    }
    // Remove directory (will fail if not empty, that's fine)
    try { unlinkSync(subDir); } catch { /* directory cleanup is best-effort */ }
  }

  // Delete form definition
  const filePath = join(formDir, `${id}.json`);
  if (existsSync(filePath)) unlinkSync(filePath);

  await hooks.trigger('webform:afterDelete', { id });
  return true;
}

// ============================================
// ELEMENT HELPERS
// ============================================

/**
 * Get available element types.
 *
 * @returns {Object} Element type registry
 */
export function getElementTypes() {
  return { ...ELEMENT_TYPES };
}

/**
 * Validate a single element definition.
 *
 * @param {Object} element - Element config
 * @returns {Array<string>} Validation errors (empty if valid)
 */
export function validateElementDef(element) {
  const errors = [];
  if (!element.key) errors.push('Element must have a key');
  if (!element.type) errors.push('Element must have a type');
  if (element.type && !ELEMENT_TYPES[element.type]) {
    errors.push(`Unknown element type: ${element.type}`);
  }
  if (ELEMENT_TYPES[element.type]?.hasOptions && (!element.options || element.options.length === 0)) {
    errors.push(`Element "${element.key}" of type "${element.type}" requires options`);
  }
  return errors;
}

// ============================================
// CONDITIONAL LOGIC
// ============================================

/**
 * Evaluate whether a conditional is met.
 *
 * WHY SERVER-SIDE:
 * Client JS handles visibility, but we must re-check on submit.
 * A hidden-but-required field should not block submission.
 * A shown-and-required field must block submission.
 *
 * @param {Object} condition - { field, operator, value }
 * @param {Object} submissionData - The submitted form values
 * @returns {boolean} Whether condition is met
 */
export function evaluateCondition(condition, submissionData) {
  if (!condition || !condition.field || !condition.operator) return true;

  const op = OPERATORS[condition.operator];
  if (!op) return true; // Unknown operator → treat as always visible

  const fieldVal = submissionData[condition.field];
  return op(fieldVal, condition.value);
}

/**
 * Check if an element is visible given current form values.
 *
 * @param {Object} element - Element definition
 * @param {Object} submissionData - Current form values
 * @returns {boolean} Whether element should be visible
 */
export function isElementVisible(element, submissionData) {
  if (!element.showIf) return true;
  return evaluateCondition(element.showIf, submissionData);
}

// ============================================
// MULTI-STEP HELPERS
// ============================================

/**
 * Split elements into pages based on page_break elements.
 *
 * WHY PAGE BREAKS:
 * Rather than a separate pages array, page_break elements within
 * the elements array mark page boundaries. This keeps the element
 * list flat and orderable — the builder just inserts dividers.
 *
 * @param {Array} elements - All form elements
 * @returns {Array<Object>} Pages with { title, elements } each
 */
export function splitIntoPages(elements) {
  const pages = [];
  let current = { title: 'Page 1', elements: [] };

  for (const el of elements) {
    if (el.type === 'page_break') {
      pages.push(current);
      current = { title: el.label || `Page ${pages.length + 2}`, elements: [] };
    } else {
      current.elements.push(el);
    }
  }

  pages.push(current);
  return pages;
}

/**
 * Check if a webform is multi-step.
 *
 * @param {Object} form - Webform definition
 * @returns {boolean}
 */
export function isMultiStep(form) {
  return (form.elements || []).some(el => el.type === 'page_break');
}

// ============================================
// SUBMISSION HANDLING
// ============================================

/**
 * Submit a webform.
 *
 * @param {string} formId - Webform ID
 * @param {Object} data - Submitted values (keyed by element key)
 * @param {Object} options - { ip, userAgent, user }
 * @returns {Object} { success, message, redirect, submissionId }
 */
export async function submit(formId, data, options = {}) {
  const form = readFormSync(formId);
  if (!form) throw new Error(`Webform "${formId}" not found`);
  if (form.status !== 'open') throw new Error('This form is not accepting submissions');

  // Check total limit
  if (form.settings.limitTotal > 0) {
    const count = countSubmissions(formId);
    if (count >= form.settings.limitTotal) {
      throw new Error('This form has reached its submission limit');
    }
  }

  // Validate required fields (respecting conditional visibility)
  const errors = validateSubmission(form, data);
  if (errors.length > 0) {
    return { success: false, errors };
  }

  // Hook: before submit (spam filters, custom validation)
  const hookCtx = { formId, data, options, reject: false, rejectReason: null };
  await hooks.trigger('webform:beforeSubmit', hookCtx);
  if (hookCtx.reject) throw new Error(hookCtx.rejectReason || 'Submission rejected');

  // Store submission
  const submissionId = `${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
  const submission = {
    id: submissionId,
    formId,
    data,
    ip: options.ip || null,
    userAgent: options.userAgent || null,
    userId: options.user?.id || null,
    created: new Date().toISOString(),
  };

  const subDir = join(submissionBaseDir, formId);
  mkdirSync(subDir, { recursive: true });
  writeFileSync(join(subDir, `${submissionId}.json`), JSON.stringify(submission, null, 2) + '\n');

  // Run handlers (email, webhook, etc.)
  await runHandlers(form, submission);

  // Hook: after submit
  await hooks.trigger('webform:afterSubmit', { formId, submission, form });

  // Trigger ECA event
  await hooks.trigger('form:submit', { formId, submission, form });

  const result = {
    success: true,
    submissionId,
    message: form.settings.confirmationMessage,
  };

  if (form.settings.confirmationType === 'redirect' && form.settings.redirectUrl) {
    result.redirect = form.settings.redirectUrl;
  }

  return result;
}

/**
 * Validate a submission against form element definitions.
 *
 * @param {Object} form - Webform definition
 * @param {Object} data - Submitted values
 * @returns {Array<Object>} Validation errors [{ key, message }]
 */
export function validateSubmission(form, data) {
  const errors = [];

  for (const el of (form.elements || [])) {
    if (el.type === 'page_break' || el.type === 'markup' || el.type === 'fieldset') continue;
    if (!isElementVisible(el, data)) continue;

    const val = data[el.key];

    // Required check
    if (el.required && (!val || String(val).trim() === '')) {
      errors.push({ key: el.key, message: `${el.label || el.key} is required` });
      continue;
    }

    if (!val || String(val).trim() === '') continue; // Not required, no value → skip

    // Type-specific validation
    if (el.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
      errors.push({ key: el.key, message: `${el.label || el.key} must be a valid email` });
    }
    if (el.type === 'url' && !/^https?:\/\//.test(val)) {
      errors.push({ key: el.key, message: `${el.label || el.key} must be a valid URL` });
    }
    if (el.type === 'number') {
      const num = Number(val);
      if (isNaN(num)) {
        errors.push({ key: el.key, message: `${el.label || el.key} must be a number` });
      } else {
        if (el.min !== undefined && num < el.min) {
          errors.push({ key: el.key, message: `${el.label || el.key} must be at least ${el.min}` });
        }
        if (el.max !== undefined && num > el.max) {
          errors.push({ key: el.key, message: `${el.label || el.key} must be at most ${el.max}` });
        }
      }
    }
    if (el.maxLength && String(val).length > el.maxLength) {
      errors.push({ key: el.key, message: `${el.label || el.key} must be ${el.maxLength} characters or fewer` });
    }
    if (el.pattern) {
      try {
        if (!new RegExp(el.pattern).test(val)) {
          errors.push({ key: el.key, message: el.patternError || `${el.label || el.key} format is invalid` });
        }
      } catch { /* Invalid regex in config → skip validation */ }
    }
  }

  return errors;
}

// ============================================
// SUBMISSION STORAGE
// ============================================

/**
 * List submissions for a webform.
 *
 * @param {string} formId - Webform ID
 * @param {Object} options - { limit, offset, sort }
 * @returns {Object} { items, total }
 */
export function listSubmissions(formId, options = {}) {
  const subDir = join(submissionBaseDir, formId);
  if (!existsSync(subDir)) return { items: [], total: 0 };

  const files = readdirSync(subDir).filter(f => f.endsWith('.json'));
  let items = files.map(f => {
    try {
      return JSON.parse(readFileSync(join(subDir, f), 'utf8'));
    } catch { return null; }
  }).filter(Boolean);

  // Sort by created date (newest first by default)
  const sortOrder = options.sort === 'asc' ? 1 : -1;
  items.sort((a, b) => sortOrder * (new Date(b.created) - new Date(a.created)));

  const total = items.length;
  const offset = options.offset || 0;
  const limit = options.limit || 50;
  items = items.slice(offset, offset + limit);

  return { items, total };
}

/**
 * Get a single submission.
 *
 * @param {string} formId - Webform ID
 * @param {string} submissionId - Submission ID
 * @returns {Object|null}
 */
export function getSubmission(formId, submissionId) {
  const filePath = join(submissionBaseDir, formId, `${submissionId}.json`);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch { return null; }
}

/**
 * Delete a submission.
 *
 * @param {string} formId - Webform ID
 * @param {string} submissionId - Submission ID
 * @returns {boolean}
 */
export async function deleteSubmission(formId, submissionId) {
  const filePath = join(submissionBaseDir, formId, `${submissionId}.json`);
  if (!existsSync(filePath)) throw new Error('Submission not found');

  await hooks.trigger('webform:beforeDeleteSubmission', { formId, submissionId });
  unlinkSync(filePath);
  await hooks.trigger('webform:afterDeleteSubmission', { formId, submissionId });
  return true;
}

/**
 * Count submissions for a webform.
 *
 * @param {string} formId - Webform ID
 * @returns {number}
 */
export function countSubmissions(formId) {
  const subDir = join(submissionBaseDir, formId);
  if (!existsSync(subDir)) return 0;
  return readdirSync(subDir).filter(f => f.endsWith('.json')).length;
}

// ============================================
// CSV EXPORT
// ============================================

/**
 * Export submissions as CSV string.
 *
 * WHY CSV:
 * - Universal format (Excel, Google Sheets, R, Python)
 * - No dependencies needed to generate
 * - Stream-friendly for large datasets
 *
 * @param {string} formId - Webform ID
 * @returns {string} CSV content
 */
export function exportCsv(formId) {
  const form = readFormSync(formId);
  if (!form) throw new Error(`Webform "${formId}" not found`);

  const { items } = listSubmissions(formId, { limit: 100000, sort: 'asc' });
  if (items.length === 0) return '';

  // Build columns from form elements (skip non-input types)
  const columns = (form.elements || [])
    .filter(el => !ELEMENT_TYPES[el.type]?.noInput && el.type !== 'fieldset')
    .map(el => el.key);

  // Add metadata columns
  const allColumns = ['id', 'created', 'ip', 'userId', ...columns];

  // Escape CSV value
  const esc = (val) => {
    if (val === null || val === undefined) return '';
    const s = String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };

  const rows = [allColumns.join(',')];
  for (const sub of items) {
    const row = allColumns.map(col => {
      if (col === 'id') return esc(sub.id);
      if (col === 'created') return esc(sub.created);
      if (col === 'ip') return esc(sub.ip);
      if (col === 'userId') return esc(sub.userId);
      const val = sub.data?.[col];
      // Arrays (checkboxes) → join with semicolons
      if (Array.isArray(val)) return esc(val.join('; '));
      return esc(val);
    });
    rows.push(row.join(','));
  }

  return rows.join('\n');
}

// ============================================
// HANDLERS
// ============================================

/**
 * Run submission handlers (email, webhook).
 *
 * WHY HANDLER PATTERN:
 * Drupal Webform uses "handlers" — pluggable post-submission actions.
 * Email and webhook are the two most common. Each form can have
 * multiple handlers, each with its own settings.
 *
 * @param {Object} form - Webform definition
 * @param {Object} submission - Stored submission
 */
async function runHandlers(form, submission) {
  for (const handler of (form.handlers || [])) {
    try {
      if (handler.type === 'email') {
        await handleEmail(handler, form, submission);
      } else if (handler.type === 'webhook') {
        await handleWebhook(handler, form, submission);
      }
    } catch (err) {
      console.error(`[webform] Handler "${handler.type}" error for form "${form.id}":`, err.message);
    }
  }
}

/**
 * Email handler — sends notification when form is submitted.
 *
 * @param {Object} handler - { type: 'email', settings: { to, subject, body } }
 * @param {Object} form - Webform definition
 * @param {Object} submission - Submission data
 */
async function handleEmail(handler, form, submission) {
  const settings = handler.settings || {};
  const to = settings.to || '';
  if (!to) return;

  const subject = replaceTokens(settings.subject || `New submission: ${form.title}`, form, submission);
  const body = settings.body
    ? replaceTokens(settings.body, form, submission)
    : buildDefaultEmailBody(form, submission);

  if (emailService) {
    emailService.send({ to, subject, body });
    console.log(`[webform] Sent email to ${to} for form "${form.id}"`);
  } else {
    console.log(`[webform] Email handler (no email service): to=${to}, subject=${subject}`);
  }
}

/**
 * Webhook handler — POSTs submission data to an external URL.
 *
 * @param {Object} handler - { type: 'webhook', settings: { url, method, headers } }
 * @param {Object} form - Webform definition
 * @param {Object} submission - Submission data
 */
async function handleWebhook(handler, form, submission) {
  const settings = handler.settings || {};
  const url = settings.url;
  if (!url) return;

  const payload = JSON.stringify({
    formId: form.id,
    formTitle: form.title,
    submissionId: submission.id,
    data: submission.data,
    created: submission.created,
  });

  // Use dynamic import for ESM compatibility
  const parsedUrl = new URL(url);
  const mod = parsedUrl.protocol === 'https:'
    ? await import('node:https')
    : await import('node:http');

  return new Promise((resolve) => {
    const req = mod.request(url, {
      method: settings.method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...(settings.headers || {}),
      },
    }, (res) => {
      console.log(`[webform] Webhook ${url} responded ${res.statusCode}`);
      res.resume();
      resolve();
    });

    req.on('error', (err) => {
      console.error(`[webform] Webhook ${url} error:`, err.message);
      resolve();
    });

    req.write(payload);
    req.end();
  });
}

// ============================================
// TEMPLATE HELPERS
// ============================================

/**
 * Replace simple tokens in handler text.
 * Supports [form:title], [submission:id], [submission:created],
 * and [value:key] for submitted field values.
 *
 * @param {string} text - Text with tokens
 * @param {Object} form - Webform definition
 * @param {Object} submission - Submission data
 * @returns {string} Resolved text
 */
function replaceTokens(text, form, submission) {
  return text
    .replace(/\[form:title\]/g, form.title || '')
    .replace(/\[form:id\]/g, form.id || '')
    .replace(/\[submission:id\]/g, submission.id || '')
    .replace(/\[submission:created\]/g, submission.created || '')
    .replace(/\[value:([^\]]+)\]/g, (_, key) => {
      const val = submission.data?.[key];
      if (Array.isArray(val)) return val.join(', ');
      return val !== undefined ? String(val) : '';
    });
}

/**
 * Build a default email body from submission data.
 *
 * @param {Object} form - Webform definition
 * @param {Object} submission - Submission data
 * @returns {string} Email body
 */
function buildDefaultEmailBody(form, submission) {
  const lines = [`New submission for: ${form.title}`, `Submitted: ${submission.created}`, ''];

  for (const el of (form.elements || [])) {
    if (ELEMENT_TYPES[el.type]?.noInput || el.type === 'fieldset') continue;
    const val = submission.data?.[el.key];
    if (val === undefined || val === null) continue;
    const display = Array.isArray(val) ? val.join(', ') : String(val);
    lines.push(`${el.label || el.key}: ${display}`);
  }

  return lines.join('\n');
}

// ============================================
// PUBLIC RENDERING
// ============================================

/**
 * Render a webform as HTML for public display.
 *
 * WHY SERVER-SIDE RENDER:
 * - Works without JavaScript (progressive enhancement)
 * - SEO-friendly (form content in HTML)
 * - Client JS enhances with conditionals and multi-step
 *
 * @param {Object} form - Webform definition
 * @param {Object} values - Pre-filled values (for re-display on error)
 * @param {Array} errors - Validation errors [{ key, message }]
 * @param {number} currentPage - Current page index (for multi-step)
 * @returns {string} HTML string
 */
export function renderFormHtml(form, values = {}, errors = [], currentPage = 0) {
  const pages = splitIntoPages(form.elements || []);
  const multi = pages.length > 1;
  const errMap = {};
  for (const e of errors) errMap[e.key] = e.message;

  let html = '';

  // Progress bar for multi-step
  if (multi) {
    html += '<div class="webform-progress">';
    for (let i = 0; i < pages.length; i++) {
      const cls = i === currentPage ? 'active' : (i < currentPage ? 'completed' : '');
      html += `<span class="webform-step ${cls}">${pages[i].title}</span>`;
    }
    html += '</div>';
  }

  html += `<form method="POST" action="/form/${encodeURIComponent(form.id)}" class="webform" enctype="multipart/form-data">`;

  // Render current page elements (or all if not multi-step)
  const pageElements = multi ? pages[currentPage].elements : (form.elements || []);

  for (const el of pageElements) {
    html += renderElement(el, values, errMap);
  }

  // Navigation buttons
  html += '<div class="webform-actions">';
  if (multi && currentPage > 0) {
    html += `<button type="submit" name="_webform_page" value="${currentPage - 1}" class="btn btn-outline">Previous</button>`;
  }
  if (multi && currentPage < pages.length - 1) {
    html += `<button type="submit" name="_webform_page" value="${currentPage + 1}" class="btn btn-primary">Next</button>`;
  } else {
    html += `<button type="submit" class="btn btn-primary">${form.settings?.submitLabel || 'Submit'}</button>`;
  }
  html += '</div></form>';

  return html;
}

/**
 * Render a single form element as HTML.
 *
 * @param {Object} el - Element definition
 * @param {Object} values - Current values
 * @param {Object} errMap - Error messages keyed by element key
 * @returns {string} HTML
 */
function renderElement(el, values, errMap) {
  const type = ELEMENT_TYPES[el.type];
  if (!type) return '';

  // Data attributes for client-side conditional logic
  let dataAttrs = '';
  if (el.showIf) {
    dataAttrs = ` data-show-if-field="${escHtml(el.showIf.field)}" data-show-if-op="${escHtml(el.showIf.operator)}" data-show-if-value="${escHtml(el.showIf.value || '')}"`;
  }

  if (el.type === 'markup') {
    return `<div class="webform-element webform-markup"${dataAttrs}>${el.markup || ''}</div>`;
  }

  if (el.type === 'fieldset') {
    return `<fieldset class="webform-fieldset"${dataAttrs}><legend>${escHtml(el.label || '')}</legend></fieldset>`;
  }

  if (el.type === 'hidden') {
    return `<input type="hidden" name="${escHtml(el.key)}" value="${escHtml(values[el.key] || el.defaultValue || '')}">`;
  }

  const errClass = errMap[el.key] ? ' has-error' : '';
  const required = el.required ? ' required' : '';
  const reqMark = el.required ? ' <span class="required">*</span>' : '';

  let html = `<div class="webform-element webform-element--${el.type}${errClass}"${dataAttrs}>`;
  html += `<label for="wf-${escHtml(el.key)}">${escHtml(el.label || el.key)}${reqMark}</label>`;

  if (el.description) {
    html += `<div class="description">${escHtml(el.description)}</div>`;
  }

  const val = values[el.key] !== undefined ? values[el.key] : (el.defaultValue || '');

  switch (el.type) {
    case 'textarea':
      html += `<textarea id="wf-${escHtml(el.key)}" name="${escHtml(el.key)}"${required} rows="${el.rows || 5}" placeholder="${escHtml(el.placeholder || '')}">${escHtml(String(val))}</textarea>`;
      break;

    case 'select':
      html += `<select id="wf-${escHtml(el.key)}" name="${escHtml(el.key)}"${required}>`;
      html += '<option value="">- Select -</option>';
      for (const opt of (el.options || [])) {
        const sel = String(val) === String(opt.value) ? ' selected' : '';
        html += `<option value="${escHtml(opt.value)}"${sel}>${escHtml(opt.label)}</option>`;
      }
      html += '</select>';
      break;

    case 'checkboxes':
      for (const opt of (el.options || [])) {
        const checked = (Array.isArray(val) ? val : []).includes(opt.value) ? ' checked' : '';
        html += `<label class="checkbox-label"><input type="checkbox" name="${escHtml(el.key)}[]" value="${escHtml(opt.value)}"${checked}> ${escHtml(opt.label)}</label>`;
      }
      break;

    case 'radios':
      for (const opt of (el.options || [])) {
        const checked = String(val) === String(opt.value) ? ' checked' : '';
        html += `<label class="radio-label"><input type="radio" name="${escHtml(el.key)}" value="${escHtml(opt.value)}"${checked}${required}> ${escHtml(opt.label)}</label>`;
      }
      break;

    case 'file':
      html += `<input type="file" id="wf-${escHtml(el.key)}" name="${escHtml(el.key)}"${required} accept="${escHtml(el.accept || '')}">`;
      break;

    default:
      // Standard input types (text, email, number, url, tel, date)
      html += `<input type="${type.inputType}" id="wf-${escHtml(el.key)}" name="${escHtml(el.key)}" value="${escHtml(String(val))}"${required}`;
      if (el.placeholder) html += ` placeholder="${escHtml(el.placeholder)}"`;
      if (el.min !== undefined) html += ` min="${el.min}"`;
      if (el.max !== undefined) html += ` max="${el.max}"`;
      if (el.maxLength) html += ` maxlength="${el.maxLength}"`;
      if (el.pattern) html += ` pattern="${escHtml(el.pattern)}"`;
      html += '>';
  }

  if (errMap[el.key]) {
    html += `<div class="error-message">${escHtml(errMap[el.key])}</div>`;
  }

  html += '</div>';
  return html;
}

/**
 * Escape HTML special characters.
 *
 * @param {string} s - Raw string
 * @returns {string} Escaped string
 */
function escHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
