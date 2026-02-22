/**
 * Contact Forms System
 *
 * WHY THIS EXISTS:
 * Contact forms are a core CMS feature providing:
 * - User-to-site communication (general inquiries, support)
 * - User-to-user messaging (personal contact forms)
 * - Form submission storage and management
 * - Email notification integration
 * - Spam protection via flood control and honeypot
 *
 * DRUPAL HERITAGE:
 * Inspired by Drupal's Contact module which provides:
 * - Multiple named contact forms with different recipients
 * - Personal contact forms for reaching users directly
 * - Moderation and submission management
 * - Integration with mail system
 *
 * STORAGE STRATEGY:
 * - Forms stored as JSON files with human-readable IDs (direct file I/O)
 * - Submissions stored via content service (auto-generated IDs)
 * - This avoids ID mismatch issues (see MEMORY.md)
 *
 * DESIGN DECISIONS:
 * - Zero dependencies (Node.js built-in only)
 * - Flood control in-memory (lightweight, suitable for single-node)
 * - Email integration optional (logs if not configured)
 * - Honeypot field names randomized per-boot for better spam protection
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import * as hooks from './hooks.ts';

/**
 * Configuration
 */
let config = {
  enabled: true,
  defaultForm: 'general',
  floodLimit: 5,
  floodInterval: 3600, // seconds
  personalEnabled: true,
  storeSubmissions: true,
};

/**
 * Module references and paths
 */
let content = null;
let email = null;
let baseDir = '';
let formDir = '';
let submissionDir = '';

/**
 * Flood control tracking
 * Map<identifier, Array<timestamp>>
 */
const floodTracker = new Map();

/**
 * Honeypot field name (randomized per boot)
 * WHY RANDOM: Static honeypot fields can be detected by bots
 */
const honeypotField = `field_${Math.random().toString(36).substr(2, 9)}`;

/**
 * Content type names
 */
const FORM_TYPE = 'contact-form';
const SUBMISSION_TYPE = 'contact-submission';

/**
 * Initialize contact forms system
 *
 * WHY SEPARATE INIT:
 * - Allows dependency injection of content and email services
 * - Defers filesystem setup until needed
 * - Can be re-initialized for testing
 *
 * @param {Object} contactConfig - Contact configuration from site.json
 * @param {Object} contentModule - Content service reference
 * @param {Object} emailModule - Email service reference (optional)
 */
export function init(contactConfig = {}, contentModule, emailModule = null) {
  config = { ...config, ...contactConfig };
  content = contentModule;
  email = emailModule;

  if (!content) {
    throw new Error('[contact] Content service is required');
  }

  // Setup directories
  baseDir = contactConfig.baseDir || process.cwd();
  formDir = join(baseDir, 'content', FORM_TYPE);
  submissionDir = join(baseDir, 'content', SUBMISSION_TYPE);

  mkdirSync(formDir, { recursive: true });
  mkdirSync(submissionDir, { recursive: true });

  // Register content types
  registerContentTypes();

  // Create default form if none exist
  const forms = listForms();
  if (forms.length === 0) {
    createDefaultForm();
  }

  // Start flood cleanup interval (every 5 minutes)
  setInterval(() => cleanupFloodTracker(), 300000);

  console.log(`[contact] Initialized (${forms.length} forms, email: ${email ? 'enabled' : 'disabled'}, honeypot: ${honeypotField})`);
}

/**
 * Register contact form content types
 *
 * WHY AS CONTENT TYPES:
 * - Submissions leverage content API for filtering/pagination
 * - Forms stored directly to avoid ID mismatch (see menu.js pattern)
 */
function registerContentTypes() {
  // Submissions use content service (auto-generated IDs)
  content.register(SUBMISSION_TYPE, {
    formId: { type: 'string', required: true },
    name: { type: 'string', required: true },
    email: { type: 'string', required: true },
    subject: { type: 'string', required: true },
    message: { type: 'string', required: true },
    copySent: { type: 'boolean', default: false },
    ip: { type: 'string' },
    userAgent: { type: 'string' },
    userId: { type: 'string' },
    created: { type: 'string', auto: 'timestamp' },
  });
}

/**
 * Create default "general" contact form
 *
 * WHY SYNC:
 * - Called during init, must complete before system ready
 * - Direct file write avoids content service ID generation
 */
function createDefaultForm() {
  const form = {
    id: 'general',
    title: 'General Inquiry',
    recipients: ['admin@example.com'],
    reply: '',
    message: 'Your message has been sent. Thank you.',
    redirect: '',
    weight: 0,
    enabled: true,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };

  const filePath = join(formDir, `${form.id}.json`);
  writeFileSync(filePath, JSON.stringify(form, null, 2) + '\n');
  console.log(`[contact] Created default form: ${form.id}`);
}

// ============================================
// FORM CRUD
// ============================================

/**
 * Read form from disk (direct file I/O)
 *
 * WHY DIRECT I/O:
 * - Forms have human-readable IDs (general, support, etc.)
 * - Content service would generate timestamp-based IDs
 * - Direct I/O ensures ID matches filename (see MEMORY.md)
 *
 * @param {string} id - Form ID
 * @returns {Object|null} Form data or null
 */
function readFormSync(id) {
  const filePath = join(formDir, `${id}.json`);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error(`[contact] Error reading form ${id}:`, error.message);
    return null;
  }
}

/**
 * Write form to disk (direct file I/O)
 *
 * @param {string} id - Form ID
 * @param {Object} data - Form data
 */
function writeFormSync(id, data) {
  const now = new Date().toISOString();
  const form = {
    ...data,
    id,
    updated: now,
  };

  const filePath = join(formDir, `${id}.json`);
  writeFileSync(filePath, JSON.stringify(form, null, 2) + '\n');
}

/**
 * List all contact forms
 *
 * @returns {Array<Object>} All forms
 */
export function listForms() {
  if (!existsSync(formDir)) return [];

  const files = readdirSync(formDir).filter(f => f.endsWith('.json'));
  const forms = files
    .map(f => {
      const id = f.replace('.json', '');
      return readFormSync(id);
    })
    .filter(Boolean)
    .sort((a, b) => a.weight - b.weight);

  return forms;
}

/**
 * Get a single form
 *
 * @param {string} formId - Form ID
 * @returns {Object|null} Form or null
 */
export function getForm(formId) {
  return readFormSync(formId);
}

/**
 * Create a new contact form
 *
 * @param {Object} data - Form data
 * @param {string} data.id - Form ID (required, human-readable)
 * @param {string} data.title - Form title
 * @param {Array<string>} data.recipients - Email recipients
 * @param {string} data.reply - Reply-to address (optional)
 * @param {string} data.message - Auto-reply message (optional)
 * @param {string} data.redirect - Redirect URL after submission (optional)
 * @param {number} data.weight - Sort order
 * @param {boolean} data.enabled - Form enabled
 * @returns {Promise<Object>} Created form
 */
export async function createForm(data) {
  if (!data.id) {
    throw new Error('Form ID is required');
  }

  if (!data.title) {
    throw new Error('Form title is required');
  }

  if (!data.recipients || data.recipients.length === 0) {
    throw new Error('At least one recipient is required');
  }

  // Check if form already exists
  const existing = readFormSync(data.id);
  if (existing) {
    throw new Error(`Form "${data.id}" already exists`);
  }

  // Trigger before hook
  await hooks.trigger('contact:beforeCreateForm', { data });

  const form = {
    id: data.id,
    title: data.title,
    recipients: data.recipients,
    reply: data.reply || '',
    message: data.message || 'Your message has been sent.',
    redirect: data.redirect || '',
    weight: data.weight !== undefined ? data.weight : 0,
    enabled: data.enabled !== undefined ? data.enabled : true,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };

  writeFormSync(form.id, form);

  // Trigger after hook
  await hooks.trigger('contact:afterCreateForm', { form });

  return form;
}

/**
 * Update a contact form
 *
 * @param {string} formId - Form ID
 * @param {Object} data - Updated fields
 * @returns {Promise<Object>} Updated form
 */
export async function updateForm(formId, data) {
  const form = readFormSync(formId);
  if (!form) {
    throw new Error(`Form "${formId}" not found`);
  }

  // Trigger before hook
  await hooks.trigger('contact:beforeUpdateForm', { form, data });

  const updated = {
    ...form,
    ...data,
    id: formId, // Preserve ID
    updated: new Date().toISOString(),
  };

  writeFormSync(formId, updated);

  // Trigger after hook
  await hooks.trigger('contact:afterUpdateForm', { form: updated });

  return updated;
}

/**
 * Delete a contact form
 *
 * WHY DELETE SUBMISSIONS:
 * - Orphaned submissions are confusing
 * - Follows Drupal's cascade delete pattern
 * - User can export submissions before deleting form
 *
 * @param {string} formId - Form ID
 * @returns {Promise<boolean>} Success
 */
export async function deleteForm(formId) {
  const form = readFormSync(formId);
  if (!form) {
    throw new Error(`Form "${formId}" not found`);
  }

  // Trigger before hook
  await hooks.trigger('contact:beforeDeleteForm', { form });

  // Delete all submissions for this form
  const submissions = listSubmissions(formId, { limit: 100000 });
  for (const submission of submissions.items) {
    await deleteSubmission(submission.id);
  }

  // Delete form file
  const filePath = join(formDir, `${formId}.json`);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }

  // Trigger after hook
  await hooks.trigger('contact:afterDeleteForm', { formId });

  return true;
}

// ============================================
// SUBMISSION HANDLING
// ============================================

/**
 * Submit a contact form
 *
 * WHY VALIDATION FIRST:
 * - Fail fast, before flood check or storage
 * - Reduces load from malicious submissions
 * - Clear error messages improve UX
 *
 * @param {string} formId - Form ID
 * @param {Object} submission - Submission data
 * @param {string} submission.name - Sender name
 * @param {string} submission.email - Sender email
 * @param {string} submission.subject - Subject line
 * @param {string} submission.message - Message body
 * @param {boolean} submission.copy - Send copy to sender
 * @param {Object} options - Request context
 * @param {string} options.ip - Client IP
 * @param {string} options.userAgent - User agent
 * @param {Object} options.user - Authenticated user (optional)
 * @returns {Promise<Object>} Result { success, message, redirect }
 */
export async function submitForm(formId, submission, options = {}) {
  if (!config.enabled) {
    throw new Error('Contact forms are disabled');
  }

  // Get form
  const form = readFormSync(formId);
  if (!form) {
    throw new Error(`Form "${formId}" not found`);
  }

  if (!form.enabled) {
    throw new Error('This contact form is currently disabled');
  }

  // Validate required fields
  if (!submission.name || !submission.name.trim()) {
    throw new Error('Name is required');
  }

  if (!submission.email || !submission.email.trim()) {
    throw new Error('Email is required');
  }

  if (!validateEmail(submission.email)) {
    throw new Error('Valid email address is required');
  }

  if (!submission.subject || !submission.subject.trim()) {
    throw new Error('Subject is required');
  }

  if (!submission.message || !submission.message.trim()) {
    throw new Error('Message is required');
  }

  // Check flood control
  const identifier = options.user?.id || options.ip || 'unknown';
  if (checkFlood(identifier)) {
    throw new Error(`Too many submissions. Please wait ${config.floodInterval} seconds and try again.`);
  }

  // Trigger before hook (spam filters can reject here)
  const hookContext = {
    formId,
    submission,
    options,
    reject: false,
    rejectReason: null,
  };
  await hooks.trigger('contact:beforeSubmit', hookContext);

  if (hookContext.reject) {
    throw new Error(hookContext.rejectReason || 'Submission rejected');
  }

  // Store submission if configured
  let storedSubmission = null;
  if (config.storeSubmissions) {
    const submissionData = {
      formId,
      name: submission.name.trim(),
      email: submission.email.trim(),
      subject: submission.subject.trim(),
      message: submission.message.trim(),
      copySent: submission.copy || false,
      ip: options.ip || null,
      userAgent: options.userAgent || null,
      userId: options.user?.id || null,
    };

    storedSubmission = await content.create(SUBMISSION_TYPE, submissionData);
  }

  // Send email to recipients
  try {
    sendContactEmail(form, submission, options);
  } catch (error) {
    console.error('[contact] Error sending email:', error.message);
    // Don't throw - submission was stored, email is secondary
  }

  // Send copy to sender if requested
  if (submission.copy) {
    try {
      sendCopyEmail(form, submission, options);
    } catch (error) {
      console.error('[contact] Error sending copy:', error.message);
    }
  }

  // Record flood control
  recordFlood(identifier);

  // Trigger after hook
  await hooks.trigger('contact:afterSubmit', {
    formId,
    submission: storedSubmission,
    form,
  });

  return {
    success: true,
    message: form.message,
    redirect: form.redirect || null,
  };
}

/**
 * Send contact email to form recipients
 *
 * WHY SEPARATE FUNCTION:
 * - Easier to mock in tests
 * - Can be overridden via hooks
 * - Graceful fallback if email not configured
 *
 * @param {Object} form - Contact form
 * @param {Object} submission - Submission data
 * @param {Object} options - Request context
 */
function sendContactEmail(form, submission, options) {
  if (!email) {
    console.log('[contact] Email not configured, logging submission:');
    console.log(`[contact] Form: ${form.title} (${form.id})`);
    console.log(`[contact] From: ${submission.name} <${submission.email}>`);
    console.log(`[contact] Subject: ${submission.subject}`);
    console.log(`[contact] To: ${form.recipients.join(', ')}`);
    return;
  }

  const body = `
Name: ${submission.name}
Email: ${submission.email}
Subject: ${submission.subject}

Message:
${submission.message}

---
Sent from contact form: ${form.title}
IP: ${options.ip || 'unknown'}
User Agent: ${options.userAgent || 'unknown'}
User ID: ${options.user?.id || 'guest'}
`.trim();

  for (const recipient of form.recipients) {
    email.send({
      to: recipient,
      from: form.reply || submission.email,
      replyTo: submission.email,
      subject: `[Contact] ${submission.subject}`,
      body,
    });
  }

  console.log(`[contact] Sent to ${form.recipients.length} recipient(s)`);
}

/**
 * Send copy to submitter
 *
 * @param {Object} form - Contact form
 * @param {Object} submission - Submission data
 * @param {Object} options - Request context
 */
function sendCopyEmail(form, submission, options) {
  if (!email) {
    console.log('[contact] Email not configured, skipping copy to sender');
    return;
  }

  const body = `
This is a copy of your message sent via ${form.title}:

Subject: ${submission.subject}
Message:
${submission.message}

---
Your message has been sent to ${form.recipients.length} recipient(s).
`.trim();

  email.send({
    to: submission.email,
    from: form.reply || form.recipients[0],
    subject: `Copy: ${submission.subject}`,
    body,
  });

  console.log(`[contact] Sent copy to ${submission.email}`);
}

/**
 * List submissions for a form
 *
 * @param {string} formId - Form ID (null for all submissions)
 * @param {Object} options - Query options
 * @param {number} options.limit - Max results
 * @param {number} options.offset - Skip results
 * @param {string} options.sort - Sort field
 * @param {string} options.order - Sort order (asc/desc)
 * @returns {Object} Paginated submissions
 */
export function listSubmissions(formId = null, options = {}) {
  const filters = {};

  if (formId) {
    filters.formId = formId;
  }

  const sortBy = options.sort || 'created';
  const sortOrder = options.order || 'desc';
  const limit = options.limit || 50;
  const offset = options.offset || 0;

  return content.list(SUBMISSION_TYPE, {
    filters,
    sortBy,
    sortOrder,
    limit,
    offset,
  });
}

/**
 * Get a single submission
 *
 * @param {string} id - Submission ID
 * @returns {Object|null} Submission or null
 */
export function getSubmission(id) {
  return content.read(SUBMISSION_TYPE, id);
}

/**
 * Delete a submission
 *
 * @param {string} id - Submission ID
 * @returns {Promise<boolean>} Success
 */
export async function deleteSubmission(id) {
  const submission = content.read(SUBMISSION_TYPE, id);
  if (!submission) {
    throw new Error(`Submission "${id}" not found`);
  }

  // Trigger before hook
  await hooks.trigger('contact:beforeDeleteSubmission', { submission });

  const result = await content.remove(SUBMISSION_TYPE, id, { permanent: true });

  // Trigger after hook
  await hooks.trigger('contact:afterDeleteSubmission', { id });

  return result;
}

/**
 * Get submission statistics
 *
 * @returns {Object} Stats by form
 */
export function getSubmissionStats() {
  const allSubmissions = content.list(SUBMISSION_TYPE, { limit: 100000 });
  const byForm = {};

  for (const submission of allSubmissions.items) {
    byForm[submission.formId] = (byForm[submission.formId] || 0) + 1;
  }

  return {
    total: allSubmissions.total,
    byForm,
  };
}

// ============================================
// FLOOD CONTROL
// ============================================

/**
 * Check if identifier has exceeded rate limit
 *
 * WHY IN-MEMORY:
 * - Fast lookups (no disk I/O)
 * - Suitable for single-node deployment
 * - Automatic cleanup via interval
 * - For multi-node, would use Redis or similar
 *
 * @param {string} identifier - IP address or user ID
 * @returns {boolean} True if rate limit exceeded
 */
export function checkFlood(identifier) {
  if (!config.floodLimit || config.floodLimit <= 0) {
    return false; // Flood control disabled
  }

  const timestamps = floodTracker.get(identifier) || [];
  const now = Date.now();
  const windowStart = now - (config.floodInterval * 1000);

  // Count submissions within window
  const recentCount = timestamps.filter(ts => ts > windowStart).length;

  return recentCount >= config.floodLimit;
}

/**
 * Record a submission for flood control
 *
 * @param {string} identifier - IP address or user ID
 */
function recordFlood(identifier) {
  if (!config.floodLimit || config.floodLimit <= 0) {
    return;
  }

  const timestamps = floodTracker.get(identifier) || [];
  timestamps.push(Date.now());
  floodTracker.set(identifier, timestamps);
}

/**
 * Clean up expired flood control entries
 *
 * WHY PERIODIC CLEANUP:
 * - Prevents memory leak
 * - Removes old tracking data
 * - Runs every 5 minutes automatically
 */
function cleanupFloodTracker() {
  const now = Date.now();
  const windowStart = now - (config.floodInterval * 1000);

  for (const [identifier, timestamps] of floodTracker.entries()) {
    const recent = timestamps.filter(ts => ts > windowStart);

    if (recent.length === 0) {
      floodTracker.delete(identifier);
    } else {
      floodTracker.set(identifier, recent);
    }
  }

  console.log(`[contact] Flood tracker cleanup: ${floodTracker.size} active identifiers`);
}

// ============================================
// PERSONAL CONTACT
// ============================================

/**
 * Submit a personal contact message to a user
 *
 * WHY SEPARATE FROM FORMS:
 * - Dynamic recipient (any user)
 * - Different permission model
 * - Can't be pre-configured as form
 *
 * @param {string} targetUserId - Target user ID
 * @param {Object} submission - Message data
 * @param {Object} options - Request context
 * @returns {Promise<Object>} Result
 */
export async function submitPersonalContact(targetUserId, submission, options = {}) {
  if (!config.enabled || !config.personalEnabled) {
    throw new Error('Personal contact is disabled');
  }

  // Get target user (would use user service in real implementation)
  // For now, assume we have content service with user type
  const targetUser = content.read('user', targetUserId);
  if (!targetUser) {
    throw new Error(`User "${targetUserId}" not found`);
  }

  if (!targetUser.email) {
    throw new Error('User has no email address');
  }

  // Create a virtual form for this personal contact
  const virtualForm = {
    id: `personal-${targetUserId}`,
    title: `Personal Contact to ${targetUser.name || targetUserId}`,
    recipients: [targetUser.email],
    reply: '',
    message: 'Your message has been sent.',
    redirect: '',
    enabled: true,
  };

  // Use standard submit flow
  return submitForm(virtualForm.id, submission, {
    ...options,
    _virtualForm: virtualForm,
  });
}

// ============================================
// SPAM PROTECTION
// ============================================

/**
 * Validate honeypot field
 *
 * WHY HONEYPOT:
 * - Simple, effective bot detection
 * - No user friction (hidden field)
 * - Complements flood control
 * - Field name randomized per boot
 *
 * @param {Object} formData - Raw form data from request
 * @returns {boolean} True if spam detected (honeypot filled)
 */
export function validateHoneypot(formData) {
  // If honeypot field exists and is filled, it's spam
  return formData[honeypotField] && formData[honeypotField].trim().length > 0;
}

/**
 * Get honeypot field name
 *
 * WHY EXPOSE:
 * - Frontend needs to know field name to render hidden input
 * - Randomized per boot, so must be provided by backend
 *
 * @returns {string} Honeypot field name
 */
export function getHoneypotField() {
  return honeypotField;
}

// ============================================
// UTILITIES
// ============================================

/**
 * Validate email address format
 *
 * WHY SIMPLE REGEX:
 * - Good enough for 99% of cases
 * - Full RFC 5322 validation is overkill
 * - Prevents obviously invalid input
 *
 * @param {string} email - Email address
 * @returns {boolean} True if valid format
 */
function validateEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

/**
 * Get configuration
 *
 * @returns {Object} Current configuration
 */
export function getConfig() {
  return { ...config };
}

/**
 * Check if contact forms are enabled
 *
 * @returns {boolean}
 */
export function isEnabled() {
  return config.enabled;
}

/**
 * Export form with submissions
 *
 * WHY EXPORT:
 * - Backup before deleting form
 * - Data portability
 * - Analysis in external tools
 *
 * @param {string} formId - Form ID
 * @returns {Object} Exportable data
 */
export function exportForm(formId) {
  const form = readFormSync(formId);
  if (!form) {
    throw new Error(`Form "${formId}" not found`);
  }

  const submissions = listSubmissions(formId, { limit: 100000 });

  return {
    form,
    submissions: submissions.items,
    exportedAt: new Date().toISOString(),
  };
}
