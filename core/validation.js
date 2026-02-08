/**
 * validation.js - Content Validation Rule System
 *
 * WHY THIS EXISTS:
 * ================
 * Content needs validation before storage to ensure data integrity.
 * This module provides:
 * - Built-in validation rules (required, minLength, email, etc.)
 * - Custom validator registration
 * - Async validators for server-side checks (unique, exists)
 * - Cross-field validation
 * - Detailed error reporting
 *
 * VALIDATION FLOW:
 * ===============
 * 1. Schema defines validation rules per field
 * 2. On create/update, validate() is called
 * 3. Each field runs through its validators
 * 4. Cross-field validators run last
 * 5. Returns { valid: bool, errors: [...] }
 *
 * RULE SYNTAX:
 * ===========
 * validate: ['required', 'email']
 * validate: [{ minLength: 5 }, { maxLength: 100 }]
 * validate: [{ pattern: /[A-Z]/, message: 'Must have uppercase' }]
 * validate: [{ custom: (v) => v.length > 0 || 'Required' }]
 *
 * ASYNC VALIDATORS:
 * ================
 * Validators can be async for database checks:
 * - unique: Check value doesn't exist elsewhere
 * - exists: Check referenced item exists
 */

// ============================================
// VALIDATOR REGISTRY
// ============================================

/**
 * Registry of validators
 * Structure: { name: { fn, description, async } }
 */
const validators = {};

/**
 * Content service reference (set during init)
 */
let contentService = null;

/**
 * Configuration
 */
let config = {
  enabled: true,
  stopOnFirst: false  // Stop on first error per field
};

/**
 * Initialize validation system
 *
 * @param {Object} cfg - Configuration
 * @param {Object} content - Content service for async validators
 */
export function init(cfg = {}, content = null) {
  config = { ...config, ...cfg };
  contentService = content;

  // Register built-in validators
  registerBuiltinValidators();

  const count = Object.keys(validators).length;
  console.log(`[validation] Initialized (${count} validators)`);
}

// ============================================
// VALIDATOR REGISTRATION
// ============================================

/**
 * Register a custom validator
 *
 * @param {string} name - Validator name
 * @param {Function} fn - Validator function (value, options, context) => true | string
 * @param {Object} options - { description, async }
 */
export function registerValidator(name, fn, options = {}) {
  if (!name || typeof name !== 'string') {
    throw new Error('Validator name must be a non-empty string');
  }
  if (typeof fn !== 'function') {
    throw new Error('Validator must be a function');
  }

  validators[name] = {
    fn,
    description: options.description || '',
    async: options.async || false,
    source: options.source || 'custom'
  };
}

/**
 * Get a validator by name
 *
 * @param {string} name - Validator name
 * @returns {Object|null} Validator config or null
 */
export function getValidator(name) {
  return validators[name] || null;
}

/**
 * List all registered validators
 *
 * @returns {Array} Array of validator info
 */
export function listValidators() {
  return Object.entries(validators)
    .map(([name, v]) => ({
      name,
      description: v.description,
      async: v.async,
      source: v.source
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Check if a validator exists
 *
 * @param {string} name - Validator name
 * @returns {boolean}
 */
export function hasValidator(name) {
  return name in validators;
}

// ============================================
// VALIDATION EXECUTION
// ============================================

/**
 * Validate content data against a schema
 *
 * @param {string} type - Content type
 * @param {Object} data - Data to validate
 * @param {Object} options - { schema, id, isUpdate }
 * @returns {Promise<Object>} { valid: bool, errors: [...] }
 */
export async function validate(type, data, options = {}) {
  if (!config.enabled) {
    return { valid: true, errors: [] };
  }

  const errors = [];
  const schema = options.schema || {};
  const context = {
    type,
    id: options.id || null,
    isUpdate: options.isUpdate || false,
    data,
    content: contentService
  };

  // Validate each field
  for (const [fieldName, fieldDef] of Object.entries(schema)) {
    // Skip system fields and layout
    if (fieldName.startsWith('_')) continue;

    // Skip group type (handled separately)
    if (fieldDef.type === 'group') {
      // Recursively validate group fields
      const groupErrors = await validateGroup(fieldName, fieldDef, data[fieldName] || {}, context);
      errors.push(...groupErrors);
      continue;
    }

    const value = data[fieldName];
    const fieldErrors = await validateField(fieldDef, value, {
      ...context,
      fieldName
    });

    errors.push(...fieldErrors.map(e => ({
      field: fieldName,
      ...e
    })));
  }

  // Run cross-field validators
  if (schema._validate) {
    const crossResult = await runCrossFieldValidation(schema._validate, data, context);
    errors.push(...crossResult);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate a group of fields
 *
 * @param {string} groupName - Group name
 * @param {Object} groupDef - Group definition
 * @param {Object} data - Group data
 * @param {Object} context - Validation context
 * @returns {Promise<Array>} Array of errors
 */
async function validateGroup(groupName, groupDef, data, context) {
  const errors = [];

  for (const [fieldName, fieldDef] of Object.entries(groupDef.fields || {})) {
    const value = data[fieldName];
    const fieldErrors = await validateField(fieldDef, value, {
      ...context,
      fieldName: `${groupName}.${fieldName}`
    });

    errors.push(...fieldErrors.map(e => ({
      field: `${groupName}.${fieldName}`,
      ...e
    })));
  }

  return errors;
}

/**
 * Validate a single field value
 *
 * @param {Object} fieldDef - Field definition
 * @param {*} value - Value to validate
 * @param {Object} context - Validation context
 * @returns {Promise<Array>} Array of errors
 */
export async function validateField(fieldDef, value, context = {}) {
  const errors = [];

  // Get validation rules
  const rules = getFieldRules(fieldDef);

  for (const rule of rules) {
    const result = await runValidator(rule, value, context);

    if (result !== true) {
      errors.push({
        rule: rule.name || 'custom',
        message: typeof result === 'string' ? result : rule.message || `Validation failed: ${rule.name}`
      });

      if (config.stopOnFirst) {
        break;
      }
    }
  }

  return errors;
}

/**
 * Extract validation rules from field definition
 *
 * @param {Object} fieldDef - Field definition
 * @returns {Array} Array of rule objects
 */
function getFieldRules(fieldDef) {
  const rules = [];

  // Required
  if (fieldDef.required) {
    rules.push({ name: 'required' });
  }

  // Type-specific built-in rules
  if (fieldDef.minLength !== undefined) {
    rules.push({ name: 'minLength', options: fieldDef.minLength });
  }
  if (fieldDef.maxLength !== undefined) {
    rules.push({ name: 'maxLength', options: fieldDef.maxLength });
  }
  if (fieldDef.min !== undefined) {
    rules.push({ name: 'min', options: fieldDef.min });
  }
  if (fieldDef.max !== undefined) {
    rules.push({ name: 'max', options: fieldDef.max });
  }
  if (fieldDef.pattern) {
    rules.push({
      name: 'pattern',
      options: fieldDef.pattern,
      message: fieldDef.patternMessage
    });
  }

  // Type-based validators
  if (fieldDef.type === 'email') {
    rules.push({ name: 'email' });
  }
  if (fieldDef.type === 'url') {
    rules.push({ name: 'url' });
  }
  if (fieldDef.type === 'slug') {
    rules.push({ name: 'slug' });
  }

  // Explicit validate array
  if (Array.isArray(fieldDef.validate)) {
    for (const v of fieldDef.validate) {
      if (typeof v === 'string') {
        // Simple validator name
        rules.push({ name: v });
      } else if (typeof v === 'object') {
        // Validator with options
        const entries = Object.entries(v);
        if (entries.length > 0) {
          const [name, options] = entries[0];
          if (name === 'custom' && typeof options === 'function') {
            rules.push({ name: 'custom', fn: options, message: v.message });
          } else if (name === 'message') {
            // Skip message-only entries
            continue;
          } else {
            rules.push({ name, options, message: v.message });
          }
        }
      } else if (typeof v === 'function') {
        // Direct function
        rules.push({ name: 'custom', fn: v });
      }
    }
  }

  return rules;
}

/**
 * Run a single validator
 *
 * @param {Object} rule - Rule object { name, options, message, fn }
 * @param {*} value - Value to validate
 * @param {Object} context - Validation context
 * @returns {Promise<true|string>} true if valid, error message if not
 */
async function runValidator(rule, value, context) {
  // Custom inline function
  if (rule.fn) {
    try {
      const result = await rule.fn(value, rule.options, context);
      return result;
    } catch (e) {
      return e.message || 'Validation error';
    }
  }

  // Named validator
  const validator = validators[rule.name];
  if (!validator) {
    console.warn(`[validation] Unknown validator: ${rule.name}`);
    return true;  // Skip unknown validators
  }

  try {
    const result = await validator.fn(value, rule.options, context);
    if (result === true) return true;
    return rule.message || result || `Validation failed: ${rule.name}`;
  } catch (e) {
    return e.message || 'Validation error';
  }
}

/**
 * Run cross-field validation
 *
 * @param {Function|Array} validators - Cross-field validator(s)
 * @param {Object} data - Full data object
 * @param {Object} context - Validation context
 * @returns {Promise<Array>} Array of errors
 */
async function runCrossFieldValidation(validators, data, context) {
  const errors = [];
  const validatorList = Array.isArray(validators) ? validators : [validators];

  for (const validator of validatorList) {
    if (typeof validator !== 'function') continue;

    try {
      const result = await validator(data, context);
      if (result === true) continue;

      if (typeof result === 'string') {
        errors.push({ field: '_cross', rule: 'custom', message: result });
      } else if (result && typeof result === 'object') {
        errors.push({
          field: result.field || '_cross',
          rule: result.rule || 'custom',
          message: result.message || 'Validation failed'
        });
      }
    } catch (e) {
      errors.push({ field: '_cross', rule: 'custom', message: e.message });
    }
  }

  return errors;
}

/**
 * Validate all content of a specific type
 *
 * @param {string} type - Content type
 * @param {Object} schema - Type schema
 * @returns {Promise<Object>} { total, valid, invalid, errors: { id: [...] } }
 */
export async function validateType(type, schema) {
  if (!contentService) {
    throw new Error('Content service not initialized');
  }

  // Use listAll to get all items as an array
  const items = contentService.listAll ? contentService.listAll(type) : (contentService.list(type)?.items || []);
  const results = {
    total: items.length,
    valid: 0,
    invalid: 0,
    errors: {}
  };

  for (const item of items) {
    const result = await validate(type, item, { schema, id: item.id });

    if (result.valid) {
      results.valid++;
    } else {
      results.invalid++;
      results.errors[item.id] = result.errors;
    }
  }

  return results;
}

/**
 * Validate a single content item by ID
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {Object} schema - Type schema
 * @returns {Promise<Object>} { valid, errors }
 */
export async function validateContent(type, id, schema) {
  if (!contentService) {
    throw new Error('Content service not initialized');
  }

  const item = contentService.get(type, id);
  if (!item) {
    return {
      valid: false,
      errors: [{ field: '_id', rule: 'exists', message: 'Content not found' }]
    };
  }

  return validate(type, item, { schema, id });
}

// ============================================
// BUILT-IN VALIDATORS
// ============================================

function registerBuiltinValidators() {
  // Required - field must have a value
  registerValidator('required', (value) => {
    if (value === null || value === undefined || value === '') {
      return 'This field is required';
    }
    if (Array.isArray(value) && value.length === 0) {
      return 'This field is required';
    }
    return true;
  }, { description: 'Field must have a value', source: 'core' });

  // Min length - string minimum length
  registerValidator('minLength', (value, min) => {
    if (value === null || value === undefined || value === '') return true;
    if (typeof value !== 'string') return true;
    if (value.length < min) {
      return `Must be at least ${min} characters`;
    }
    return true;
  }, { description: 'Minimum string length', source: 'core' });

  // Max length - string maximum length
  registerValidator('maxLength', (value, max) => {
    if (value === null || value === undefined || value === '') return true;
    if (typeof value !== 'string') return true;
    if (value.length > max) {
      return `Must be at most ${max} characters`;
    }
    return true;
  }, { description: 'Maximum string length', source: 'core' });

  // Min - number minimum
  registerValidator('min', (value, min) => {
    if (value === null || value === undefined || value === '') return true;
    const num = Number(value);
    if (isNaN(num)) return true;
    if (num < min) {
      return `Must be at least ${min}`;
    }
    return true;
  }, { description: 'Minimum number value', source: 'core' });

  // Max - number maximum
  registerValidator('max', (value, max) => {
    if (value === null || value === undefined || value === '') return true;
    const num = Number(value);
    if (isNaN(num)) return true;
    if (num > max) {
      return `Must be at most ${max}`;
    }
    return true;
  }, { description: 'Maximum number value', source: 'core' });

  // Pattern - regex match
  registerValidator('pattern', (value, pattern) => {
    if (value === null || value === undefined || value === '') return true;
    const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
    if (!regex.test(String(value))) {
      return 'Invalid format';
    }
    return true;
  }, { description: 'Must match regex pattern', source: 'core' });

  // Email - valid email format
  registerValidator('email', (value) => {
    if (value === null || value === undefined || value === '') return true;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      return 'Invalid email address';
    }
    return true;
  }, { description: 'Valid email format', source: 'core' });

  // URL - valid URL format
  registerValidator('url', (value) => {
    if (value === null || value === undefined || value === '') return true;
    try {
      new URL(value);
      return true;
    } catch {
      return 'Invalid URL';
    }
  }, { description: 'Valid URL format', source: 'core' });

  // Slug - valid slug format
  registerValidator('slug', (value) => {
    if (value === null || value === undefined || value === '') return true;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
      return 'Slug must contain only lowercase letters, numbers, and hyphens';
    }
    return true;
  }, { description: 'Valid URL slug format', source: 'core' });

  // One of - value must be in list
  registerValidator('oneOf', (value, options) => {
    if (value === null || value === undefined || value === '') return true;
    const list = Array.isArray(options) ? options : [options];
    if (!list.includes(value)) {
      return `Must be one of: ${list.join(', ')}`;
    }
    return true;
  }, { description: 'Value must be in list', source: 'core' });

  // Unique - value must be unique within type (async)
  registerValidator('unique', async (value, options, context) => {
    if (value === null || value === undefined || value === '') return true;
    if (!context.content || !context.type || !context.fieldName) return true;

    // Use listAll if available, otherwise extract items from list result
    const items = context.content.listAll
      ? context.content.listAll(context.type)
      : (context.content.list(context.type)?.items || []);
    const fieldPath = context.fieldName.split('.');

    for (const item of items) {
      // Skip self when updating
      if (context.id && item.id === context.id) continue;

      // Get nested field value
      let itemValue = item;
      for (const part of fieldPath) {
        itemValue = itemValue?.[part];
      }

      if (itemValue === value) {
        return `Must be unique (conflicts with ${item.id})`;
      }
    }
    return true;
  }, { description: 'Value must be unique within type', async: true, source: 'core' });

  // Exists - referenced item must exist (async)
  registerValidator('exists', async (value, options, context) => {
    if (value === null || value === undefined || value === '') return true;
    if (!context.content) return true;

    const targetType = options?.type || options;
    if (!targetType) return true;

    const item = context.content.get(targetType, value);
    if (!item) {
      return `Referenced ${targetType} does not exist`;
    }
    return true;
  }, { description: 'Referenced item must exist', async: true, source: 'core' });

  // Match - must match another field
  registerValidator('match', (value, fieldName, context) => {
    if (value === null || value === undefined || value === '') return true;
    const otherValue = context.data?.[fieldName];
    if (value !== otherValue) {
      return `Must match ${fieldName}`;
    }
    return true;
  }, { description: 'Must match another field', source: 'core' });

  // Before - date must be before another field
  registerValidator('before', (value, fieldName, context) => {
    if (value === null || value === undefined || value === '') return true;
    const otherValue = context.data?.[fieldName];
    if (!otherValue) return true;

    const date = new Date(value);
    const otherDate = new Date(otherValue);

    if (isNaN(date.getTime()) || isNaN(otherDate.getTime())) return true;

    if (date >= otherDate) {
      return `Must be before ${fieldName}`;
    }
    return true;
  }, { description: 'Date must be before another field', source: 'core' });

  // After - date must be after another field
  registerValidator('after', (value, fieldName, context) => {
    if (value === null || value === undefined || value === '') return true;
    const otherValue = context.data?.[fieldName];
    if (!otherValue) return true;

    const date = new Date(value);
    const otherDate = new Date(otherValue);

    if (isNaN(date.getTime()) || isNaN(otherDate.getTime())) return true;

    if (date <= otherDate) {
      return `Must be after ${fieldName}`;
    }
    return true;
  }, { description: 'Date must be after another field', source: 'core' });

  // File type - allowed extensions
  registerValidator('fileType', (value, types) => {
    if (value === null || value === undefined || value === '') return true;

    const allowedTypes = Array.isArray(types) ? types : [types];
    const filename = typeof value === 'object' ? value.filename || value.name : value;
    if (!filename) return true;

    const ext = filename.split('.').pop()?.toLowerCase();
    const normalizedTypes = allowedTypes.map(t => t.replace(/^\./, '').toLowerCase());

    if (!normalizedTypes.includes(ext)) {
      return `File type must be: ${normalizedTypes.join(', ')}`;
    }
    return true;
  }, { description: 'Allowed file extensions', source: 'core' });

  // File size - max file size in bytes
  registerValidator('fileSize', (value, maxSize) => {
    if (value === null || value === undefined || value === '') return true;

    const size = typeof value === 'object' ? value.size : null;
    if (size === null) return true;

    if (size > maxSize) {
      const maxMB = (maxSize / (1024 * 1024)).toFixed(1);
      return `File size must be under ${maxMB}MB`;
    }
    return true;
  }, { description: 'Maximum file size in bytes', source: 'core' });

  // Alphanumeric - only letters and numbers
  registerValidator('alphanumeric', (value) => {
    if (value === null || value === undefined || value === '') return true;
    if (!/^[a-zA-Z0-9]+$/.test(value)) {
      return 'Must contain only letters and numbers';
    }
    return true;
  }, { description: 'Only letters and numbers', source: 'core' });

  // Alpha - only letters
  registerValidator('alpha', (value) => {
    if (value === null || value === undefined || value === '') return true;
    if (!/^[a-zA-Z]+$/.test(value)) {
      return 'Must contain only letters';
    }
    return true;
  }, { description: 'Only letters', source: 'core' });

  // Numeric - only numbers
  registerValidator('numeric', (value) => {
    if (value === null || value === undefined || value === '') return true;
    if (!/^-?\d+(\.\d+)?$/.test(String(value))) {
      return 'Must be a number';
    }
    return true;
  }, { description: 'Must be numeric', source: 'core' });

  // Integer - whole numbers only
  registerValidator('integer', (value) => {
    if (value === null || value === undefined || value === '') return true;
    if (!Number.isInteger(Number(value))) {
      return 'Must be a whole number';
    }
    return true;
  }, { description: 'Must be a whole number', source: 'core' });

  // Positive - positive numbers only
  registerValidator('positive', (value) => {
    if (value === null || value === undefined || value === '') return true;
    if (Number(value) <= 0) {
      return 'Must be positive';
    }
    return true;
  }, { description: 'Must be positive', source: 'core' });

  // JSON - valid JSON format
  registerValidator('json', (value) => {
    if (value === null || value === undefined || value === '') return true;
    if (typeof value === 'object') return true;
    try {
      JSON.parse(value);
      return true;
    } catch (e) {
      return 'Invalid JSON format';
    }
  }, { description: 'Valid JSON format', source: 'core' });

  // Color - valid hex color
  registerValidator('color', (value) => {
    if (value === null || value === undefined || value === '') return true;
    if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) {
      return 'Invalid color format (use #RGB or #RRGGBB)';
    }
    return true;
  }, { description: 'Valid hex color', source: 'core' });

  // Date - valid date format
  registerValidator('date', (value) => {
    if (value === null || value === undefined || value === '') return true;
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return 'Invalid date';
    }
    return true;
  }, { description: 'Valid date format', source: 'core' });

  // Future date - date must be in the future
  registerValidator('future', (value) => {
    if (value === null || value === undefined || value === '') return true;
    const date = new Date(value);
    if (isNaN(date.getTime())) return true;
    if (date <= new Date()) {
      return 'Date must be in the future';
    }
    return true;
  }, { description: 'Date must be in the future', source: 'core' });

  // Past date - date must be in the past
  registerValidator('past', (value) => {
    if (value === null || value === undefined || value === '') return true;
    const date = new Date(value);
    if (isNaN(date.getTime())) return true;
    if (date >= new Date()) {
      return 'Date must be in the past';
    }
    return true;
  }, { description: 'Date must be in the past', source: 'core' });

  // Array min items
  registerValidator('minItems', (value, min) => {
    if (value === null || value === undefined) return true;
    if (!Array.isArray(value)) return true;
    if (value.length < min) {
      return `Must have at least ${min} item(s)`;
    }
    return true;
  }, { description: 'Minimum array items', source: 'core' });

  // Array max items
  registerValidator('maxItems', (value, max) => {
    if (value === null || value === undefined) return true;
    if (!Array.isArray(value)) return true;
    if (value.length > max) {
      return `Must have at most ${max} item(s)`;
    }
    return true;
  }, { description: 'Maximum array items', source: 'core' });

  // Image dimensions - validate min/max width/height
  registerValidator('imageDimensions', (value, options) => {
    if (value === null || value === undefined || value === '') return true;

    // Extract dimensions from value object
    const width = typeof value === 'object' ? value.width : null;
    const height = typeof value === 'object' ? value.height : null;

    if (width === null || height === null) return true;

    const { minWidth, maxWidth, minHeight, maxHeight } = options || {};

    // Check minimum width
    if (minWidth !== undefined && width < minWidth) {
      return `Image width ${width}px is below minimum ${minWidth}px`;
    }

    // Check maximum width
    if (maxWidth !== undefined && width > maxWidth) {
      return `Image width ${width}px exceeds maximum ${maxWidth}px`;
    }

    // Check minimum height
    if (minHeight !== undefined && height < minHeight) {
      return `Image height ${height}px is below minimum ${minHeight}px`;
    }

    // Check maximum height
    if (maxHeight !== undefined && height > maxHeight) {
      return `Image height ${height}px exceeds maximum ${maxHeight}px`;
    }

    return true;
  }, { description: 'Image dimensions within min/max width/height', source: 'core' });

  // Date range - validate date within min/max range
  registerValidator('dateRange', (value, options) => {
    if (value === null || value === undefined || value === '') return true;

    const date = new Date(value);
    if (isNaN(date.getTime())) return 'Invalid date';

    const { minDate, maxDate } = options || {};

    // Check minimum date
    if (minDate !== undefined) {
      const min = new Date(minDate);
      if (isNaN(min.getTime())) return 'Invalid minimum date configuration';

      if (date < min) {
        return `Date ${date.toISOString().split('T')[0]} is before minimum ${min.toISOString().split('T')[0]}`;
      }
    }

    // Check maximum date
    if (maxDate !== undefined) {
      const max = new Date(maxDate);
      if (isNaN(max.getTime())) return 'Invalid maximum date configuration';

      if (date > max) {
        return `Date ${date.toISOString().split('T')[0]} is after maximum ${max.toISOString().split('T')[0]}`;
      }
    }

    return true;
  }, { description: 'Date within min/max range', source: 'core' });
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Create a validation context for field validation
 *
 * @param {string} type - Content type
 * @param {Object} data - Full data object
 * @param {Object} options - Additional options
 * @returns {Object} Validation context
 */
export function createContext(type, data, options = {}) {
  return {
    type,
    id: options.id || null,
    isUpdate: options.isUpdate || false,
    data,
    content: contentService
  };
}

/**
 * Format validation errors for API response
 *
 * @param {Array} errors - Array of error objects
 * @returns {Object} Formatted error response
 */
export function formatErrors(errors) {
  return {
    error: 'Validation failed',
    errors: errors.map(e => ({
      field: e.field,
      rule: e.rule,
      message: e.message
    }))
  };
}

/**
 * Get validation rules summary for a schema
 *
 * @param {Object} schema - Content type schema
 * @returns {Object} { fieldName: [rules] }
 */
export function getRulesSummary(schema) {
  const summary = {};

  for (const [name, field] of Object.entries(schema)) {
    if (name.startsWith('_')) continue;

    const rules = getFieldRules(field);
    if (rules.length > 0) {
      summary[name] = rules.map(r => r.name);
    }
  }

  return summary;
}
