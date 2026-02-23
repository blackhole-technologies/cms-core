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
// TYPES
// ============================================

/** Validator function: returns true if valid, or an error message string */
type ValidatorFn = (value: unknown, options: unknown, context: ValidationContext) => true | string | Promise<true | string>;

/** Cross-field validator function */
type CrossFieldValidator = (data: Record<string, unknown>, context: ValidationContext) => true | string | CrossFieldResult | Promise<true | string | CrossFieldResult>;

/** Cross-field validation result */
interface CrossFieldResult {
  field?: string;
  rule?: string;
  message?: string;
}

/** Registered validator entry */
interface ValidatorEntry {
  fn: ValidatorFn;
  description: string;
  async: boolean;
  source: string;
}

/** Validation rule extracted from a field definition */
interface ValidationRule {
  name: string;
  options?: unknown;
  message?: string;
  fn?: ValidatorFn;
}

/** Validation error */
interface ValidationError {
  field?: string;
  rule: string;
  message: string;
}

/** Validation result */
interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/** Validation context passed to validators */
interface ValidationContext {
  type: string;
  id: string | null;
  isUpdate: boolean;
  data: Record<string, unknown>;
  content: ContentServiceRef | null;
  fieldName?: string;
}

/** Field definition (partial) */
interface FieldDef {
  type?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string | RegExp;
  patternMessage?: string;
  validate?: Array<string | Record<string, unknown> | ValidatorFn>;
  fields?: Record<string, FieldDef>;
  [key: string]: unknown;
}

/** Content service reference */
interface ContentServiceRef {
  list: (type: string, options?: Record<string, unknown>) => { items: Array<Record<string, unknown>>; total: number };
  listAll?: (type: string) => Array<Record<string, unknown>>;
  get: (type: string, id: string) => Record<string, unknown> | null;
}

/** Validate options */
interface ValidateOptions {
  schema?: Record<string, FieldDef>;
  id?: string;
  isUpdate?: boolean;
}

/** Validate type result */
interface ValidateTypeResult {
  total: number;
  valid: number;
  invalid: number;
  errors: Record<string, ValidationError[]>;
}

/** Validator info (for listing) */
interface ValidatorInfo {
  name: string;
  description: string;
  async: boolean;
  source: string;
}

/** Register validator options */
interface RegisterValidatorOptions {
  description?: string;
  async?: boolean;
  source?: string;
}

/** Formatted error response */
interface FormattedErrorResponse {
  error: string;
  errors: Array<{ field: string | undefined; rule: string; message: string }>;
}

/** Context creation options */
interface ContextOptions {
  id?: string;
  isUpdate?: boolean;
}

// ============================================
// VALIDATOR REGISTRY
// ============================================

/**
 * Registry of validators
 * Structure: { name: { fn, description, async } }
 */
const validators: Record<string, ValidatorEntry> = {};

/**
 * Content service reference (set during init)
 */
let contentService: ContentServiceRef | null = null;

/**
 * Configuration
 */
let config: { enabled: boolean; stopOnFirst: boolean } = {
  enabled: true,
  stopOnFirst: false  // Stop on first error per field
};

/**
 * Initialize validation system
 *
 * @param {Object} cfg - Configuration
 * @param {Object} content - Content service for async validators
 */
export function init(cfg: Partial<typeof config> = {}, content: ContentServiceRef | null = null): void {
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
export function registerValidator(name: string, fn: ValidatorFn, options: RegisterValidatorOptions = {}): void {
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
export function getValidator(name: string): ValidatorEntry | null {
  return validators[name] || null;
}

/**
 * List all registered validators
 *
 * @returns {Array} Array of validator info
 */
export function listValidators(): ValidatorInfo[] {
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
export function hasValidator(name: string): boolean {
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
export async function validate(type: string, data: Record<string, unknown>, options: ValidateOptions = {}): Promise<ValidationResult> {
  if (!config.enabled) {
    return { valid: true, errors: [] };
  }

  const errors: ValidationError[] = [];
  const schema = options.schema || {};
  const context: ValidationContext = {
    type,
    id: options.id || null,
    isUpdate: options.isUpdate || false,
    data,
    content: contentService
  };

  // Validate each field
  for (const [fieldName, fieldDef] of Object.entries(schema) as Array<[string, FieldDef]>) {
    // Skip system fields and layout
    if (fieldName.startsWith('_')) continue;

    // Skip group type (handled separately)
    if (fieldDef.type === 'group') {
      // Recursively validate group fields
      const groupErrors = await validateGroup(fieldName, fieldDef, (data[fieldName] as Record<string, unknown>) || {}, context);
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
  if ((schema as Record<string, unknown>)._validate) {
    const crossResult = await runCrossFieldValidation((schema as Record<string, unknown>)._validate as CrossFieldValidator | CrossFieldValidator[], data, context);
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
async function validateGroup(groupName: string, groupDef: FieldDef, data: Record<string, unknown>, context: ValidationContext): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  for (const [fieldName, fieldDef] of Object.entries(groupDef.fields || {}) as Array<[string, FieldDef]>) {
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
export async function validateField(fieldDef: FieldDef, value: unknown, context: Partial<ValidationContext> = {}): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

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
function getFieldRules(fieldDef: FieldDef): ValidationRule[] {
  const rules: ValidationRule[] = [];

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
      } else if (typeof v === 'function') {
        // Direct function
        rules.push({ name: 'custom', fn: v as ValidatorFn });
      } else if (typeof v === 'object' && v !== null) {
        // Validator with options
        const vObj = v as Record<string, unknown>;
        const entries = Object.entries(vObj);
        if (entries.length > 0) {
          const [name, options] = entries[0]!;
          if (name === 'custom' && typeof options === 'function') {
            rules.push({ name: 'custom', fn: options as ValidatorFn, message: vObj.message as string | undefined });
          } else if (name === 'message') {
            // Skip message-only entries
            continue;
          } else {
            rules.push({ name, options, message: vObj.message as string | undefined });
          }
        }
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
async function runValidator(rule: ValidationRule, value: unknown, context: Partial<ValidationContext>): Promise<true | string> {
  // Custom inline function
  if (rule.fn) {
    try {
      const result = await rule.fn(value, rule.options, context as ValidationContext);
      return result;
    } catch (e) {
      return (e instanceof Error ? e.message : String(e)) || 'Validation error';
    }
  }

  // Named validator
  const validator = validators[rule.name];
  if (!validator) {
    console.warn(`[validation] Unknown validator: ${rule.name}`);
    return true;  // Skip unknown validators
  }

  try {
    const result = await validator.fn(value, rule.options, context as ValidationContext);
    if (result === true) return true;
    return rule.message || result || `Validation failed: ${rule.name}`;
  } catch (e) {
    return (e instanceof Error ? e.message : String(e)) || 'Validation error';
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
async function runCrossFieldValidation(crossValidators: CrossFieldValidator | CrossFieldValidator[], data: Record<string, unknown>, context: ValidationContext): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];
  const validatorList = Array.isArray(crossValidators) ? crossValidators : [crossValidators];

  for (const crossValidator of validatorList) {
    if (typeof crossValidator !== 'function') continue;

    try {
      const result = await crossValidator(data, context);
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
      errors.push({ field: '_cross', rule: 'custom', message: e instanceof Error ? e.message : String(e) });
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
export async function validateType(type: string, schema: Record<string, FieldDef>): Promise<ValidateTypeResult> {
  if (!contentService) {
    throw new Error('Content service not initialized');
  }

  // Use listAll to get all items as an array
  const items = contentService.listAll ? contentService.listAll(type) : (contentService.list(type)?.items || []);
  const results: ValidateTypeResult = {
    total: items.length,
    valid: 0,
    invalid: 0,
    errors: {}
  };

  for (const item of items) {
    const itemId = item.id as string;
    const result = await validate(type, item, { schema, id: itemId });

    if (result.valid) {
      results.valid++;
    } else {
      results.invalid++;
      results.errors[itemId] = result.errors;
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
export async function validateContent(type: string, id: string, schema: Record<string, FieldDef>): Promise<ValidationResult> {
  if (!contentService) {
    throw new Error('Content service not initialized');
  }

  const item = contentService.get(type, id) as Record<string, unknown> | null;
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

function registerBuiltinValidators(): void {
  // Required - field must have a value
  registerValidator('required', (value: unknown): true | string => {
    if (value === null || value === undefined || value === '') {
      return 'This field is required';
    }
    if (Array.isArray(value) && value.length === 0) {
      return 'This field is required';
    }
    return true;
  }, { description: 'Field must have a value', source: 'core' });

  // Min length - string minimum length
  registerValidator('minLength', (value: unknown, min: unknown): true | string => {
    if (value === null || value === undefined || value === '') return true;
    if (typeof value !== 'string') return true;
    if (value.length < Number(min)) {
      return `Must be at least ${min} characters`;
    }
    return true;
  }, { description: 'Minimum string length', source: 'core' });

  // Max length - string maximum length
  registerValidator('maxLength', (value: unknown, max: unknown): true | string => {
    if (value === null || value === undefined || value === '') return true;
    if (typeof value !== 'string') return true;
    if (value.length > Number(max)) {
      return `Must be at most ${max} characters`;
    }
    return true;
  }, { description: 'Maximum string length', source: 'core' });

  // Min - number minimum
  registerValidator('min', (value: unknown, min: unknown): true | string => {
    if (value === null || value === undefined || value === '') return true;
    const num = Number(value);
    if (isNaN(num)) return true;
    if (num < Number(min)) {
      return `Must be at least ${min}`;
    }
    return true;
  }, { description: 'Minimum number value', source: 'core' });

  // Max - number maximum
  registerValidator('max', (value: unknown, max: unknown): true | string => {
    if (value === null || value === undefined || value === '') return true;
    const num = Number(value);
    if (isNaN(num)) return true;
    if (num > Number(max)) {
      return `Must be at most ${max}`;
    }
    return true;
  }, { description: 'Maximum number value', source: 'core' });

  // Pattern - regex match
  registerValidator('pattern', (value: unknown, pattern: unknown): true | string => {
    if (value === null || value === undefined || value === '') return true;
    const regex = pattern instanceof RegExp ? pattern : new RegExp(String(pattern));
    if (!regex.test(String(value))) {
      return 'Invalid format';
    }
    return true;
  }, { description: 'Must match regex pattern', source: 'core' });

  // Email - valid email format
  registerValidator('email', (value: unknown): true | string => {
    if (value === null || value === undefined || value === '') return true;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(String(value))) {
      return 'Invalid email address';
    }
    return true;
  }, { description: 'Valid email format', source: 'core' });

  // URL - valid URL format
  registerValidator('url', (value: unknown): true | string => {
    if (value === null || value === undefined || value === '') return true;
    try {
      new URL(String(value));
      return true;
    } catch {
      return 'Invalid URL';
    }
  }, { description: 'Valid URL format', source: 'core' });

  // Slug - valid slug format
  registerValidator('slug', (value: unknown): true | string => {
    if (value === null || value === undefined || value === '') return true;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(value))) {
      return 'Slug must contain only lowercase letters, numbers, and hyphens';
    }
    return true;
  }, { description: 'Valid URL slug format', source: 'core' });

  // One of - value must be in list
  registerValidator('oneOf', (value: unknown, options: unknown): true | string => {
    if (value === null || value === undefined || value === '') return true;
    const list = Array.isArray(options) ? options : [options];
    if (!list.includes(value)) {
      return `Must be one of: ${list.join(', ')}`;
    }
    return true;
  }, { description: 'Value must be in list', source: 'core' });

  // Unique - value must be unique within type (async)
  registerValidator('unique', async (value: unknown, _options: unknown, context: ValidationContext): Promise<true | string> => {
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
      let itemValue: unknown = item;
      for (const part of fieldPath) {
        itemValue = (itemValue as Record<string, unknown>)?.[part];
      }

      if (itemValue === value) {
        return `Must be unique (conflicts with ${item.id})`;
      }
    }
    return true;
  }, { description: 'Value must be unique within type', async: true, source: 'core' });

  // Exists - referenced item must exist (async)
  registerValidator('exists', async (value: unknown, options: unknown, context: ValidationContext): Promise<true | string> => {
    if (value === null || value === undefined || value === '') return true;
    if (!context.content) return true;

    const optObj = options as Record<string, unknown> | string | null;
    const targetType = (typeof optObj === 'object' && optObj !== null ? optObj.type : optObj) as string | undefined;
    if (!targetType) return true;

    const item = context.content.get(targetType, String(value));
    if (!item) {
      return `Referenced ${targetType} does not exist`;
    }
    return true;
  }, { description: 'Referenced item must exist', async: true, source: 'core' });

  // Match - must match another field
  registerValidator('match', (value: unknown, fieldName: unknown, context: ValidationContext): true | string => {
    if (value === null || value === undefined || value === '') return true;
    const otherValue = context.data?.[String(fieldName)];
    if (value !== otherValue) {
      return `Must match ${fieldName}`;
    }
    return true;
  }, { description: 'Must match another field', source: 'core' });

  // Before - date must be before another field
  registerValidator('before', (value: unknown, fieldName: unknown, context: ValidationContext): true | string => {
    if (value === null || value === undefined || value === '') return true;
    const otherValue = context.data?.[String(fieldName)];
    if (!otherValue) return true;

    const date = new Date(String(value));
    const otherDate = new Date(String(otherValue));

    if (isNaN(date.getTime()) || isNaN(otherDate.getTime())) return true;

    if (date >= otherDate) {
      return `Must be before ${fieldName}`;
    }
    return true;
  }, { description: 'Date must be before another field', source: 'core' });

  // After - date must be after another field
  registerValidator('after', (value: unknown, fieldName: unknown, context: ValidationContext): true | string => {
    if (value === null || value === undefined || value === '') return true;
    const otherValue = context.data?.[String(fieldName)];
    if (!otherValue) return true;

    const date = new Date(String(value));
    const otherDate = new Date(String(otherValue));

    if (isNaN(date.getTime()) || isNaN(otherDate.getTime())) return true;

    if (date <= otherDate) {
      return `Must be after ${fieldName}`;
    }
    return true;
  }, { description: 'Date must be after another field', source: 'core' });

  // File type - allowed extensions
  registerValidator('fileType', (value: unknown, types: unknown): true | string => {
    if (value === null || value === undefined || value === '') return true;

    const allowedTypes = Array.isArray(types) ? types as string[] : [String(types)];
    const valObj = value as Record<string, unknown>;
    const filename = typeof value === 'object' && value !== null ? String(valObj.filename || valObj.name || '') : String(value);
    if (!filename) return true;

    const ext = filename.split('.').pop()?.toLowerCase();
    const normalizedTypes = allowedTypes.map((t: string) => t.replace(/^\./, '').toLowerCase());

    if (!normalizedTypes.includes(ext!)) {
      return `File type must be: ${normalizedTypes.join(', ')}`;
    }
    return true;
  }, { description: 'Allowed file extensions', source: 'core' });

  // File size - max file size in bytes
  registerValidator('fileSize', (value: unknown, maxSize: unknown): true | string => {
    if (value === null || value === undefined || value === '') return true;

    const valObj = value as Record<string, unknown>;
    const size = typeof value === 'object' && value !== null ? valObj.size as number | null : null;
    if (size === null || size === undefined) return true;

    const maxSizeNum = Number(maxSize);
    if (size > maxSizeNum) {
      const maxMB = (maxSizeNum / (1024 * 1024)).toFixed(1);
      return `File size must be under ${maxMB}MB`;
    }
    return true;
  }, { description: 'Maximum file size in bytes', source: 'core' });

  // Alphanumeric - only letters and numbers
  registerValidator('alphanumeric', (value: unknown): true | string => {
    if (value === null || value === undefined || value === '') return true;
    if (!/^[a-zA-Z0-9]+$/.test(String(value))) {
      return 'Must contain only letters and numbers';
    }
    return true;
  }, { description: 'Only letters and numbers', source: 'core' });

  // Alpha - only letters
  registerValidator('alpha', (value: unknown): true | string => {
    if (value === null || value === undefined || value === '') return true;
    if (!/^[a-zA-Z]+$/.test(String(value))) {
      return 'Must contain only letters';
    }
    return true;
  }, { description: 'Only letters', source: 'core' });

  // Numeric - only numbers
  registerValidator('numeric', (value: unknown): true | string => {
    if (value === null || value === undefined || value === '') return true;
    if (!/^-?\d+(\.\d+)?$/.test(String(value))) {
      return 'Must be a number';
    }
    return true;
  }, { description: 'Must be numeric', source: 'core' });

  // Integer - whole numbers only
  registerValidator('integer', (value: unknown): true | string => {
    if (value === null || value === undefined || value === '') return true;
    if (!Number.isInteger(Number(value))) {
      return 'Must be a whole number';
    }
    return true;
  }, { description: 'Must be a whole number', source: 'core' });

  // Positive - positive numbers only
  registerValidator('positive', (value: unknown): true | string => {
    if (value === null || value === undefined || value === '') return true;
    if (Number(value) <= 0) {
      return 'Must be positive';
    }
    return true;
  }, { description: 'Must be positive', source: 'core' });

  // JSON - valid JSON format
  registerValidator('json', (value: unknown): true | string => {
    if (value === null || value === undefined || value === '') return true;
    if (typeof value === 'object') return true;
    try {
      JSON.parse(String(value));
      return true;
    } catch (_e) {
      return 'Invalid JSON format';
    }
  }, { description: 'Valid JSON format', source: 'core' });

  // Color - valid hex color
  registerValidator('color', (value: unknown): true | string => {
    if (value === null || value === undefined || value === '') return true;
    if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(value))) {
      return 'Invalid color format (use #RGB or #RRGGBB)';
    }
    return true;
  }, { description: 'Valid hex color', source: 'core' });

  // Date - valid date format
  registerValidator('date', (value: unknown): true | string => {
    if (value === null || value === undefined || value === '') return true;
    const date = new Date(String(value));
    if (isNaN(date.getTime())) {
      return 'Invalid date';
    }
    return true;
  }, { description: 'Valid date format', source: 'core' });

  // Future date - date must be in the future
  registerValidator('future', (value: unknown): true | string => {
    if (value === null || value === undefined || value === '') return true;
    const date = new Date(String(value));
    if (isNaN(date.getTime())) return true;
    if (date <= new Date()) {
      return 'Date must be in the future';
    }
    return true;
  }, { description: 'Date must be in the future', source: 'core' });

  // Past date - date must be in the past
  registerValidator('past', (value: unknown): true | string => {
    if (value === null || value === undefined || value === '') return true;
    const date = new Date(String(value));
    if (isNaN(date.getTime())) return true;
    if (date >= new Date()) {
      return 'Date must be in the past';
    }
    return true;
  }, { description: 'Date must be in the past', source: 'core' });

  // Array min items
  registerValidator('minItems', (value: unknown, min: unknown): true | string => {
    if (value === null || value === undefined) return true;
    if (!Array.isArray(value)) return true;
    if (value.length < Number(min)) {
      return `Must have at least ${min} item(s)`;
    }
    return true;
  }, { description: 'Minimum array items', source: 'core' });

  // Array max items
  registerValidator('maxItems', (value: unknown, max: unknown): true | string => {
    if (value === null || value === undefined) return true;
    if (!Array.isArray(value)) return true;
    if (value.length > Number(max)) {
      return `Must have at most ${max} item(s)`;
    }
    return true;
  }, { description: 'Maximum array items', source: 'core' });
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
export function createContext(type: string, data: Record<string, unknown>, options: ContextOptions = {}): ValidationContext {
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
export function formatErrors(errors: ValidationError[]): FormattedErrorResponse {
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
export function getRulesSummary(schema: Record<string, FieldDef>): Record<string, string[]> {
  const summary: Record<string, string[]> = {};

  for (const [name, field] of Object.entries(schema) as Array<[string, FieldDef]>) {
    if (name.startsWith('_')) continue;

    const rules = getFieldRules(field);
    if (rules.length > 0) {
      summary[name] = rules.map(r => r.name);
    }
  }

  return summary;
}
