/**
 * typed-data.js - Typed Data Resolver Service
 *
 * WHY THIS EXISTS:
 * Provides utilities for defining data schemas, validating data against schemas,
 * and transforming data. Supports nested structures, array validation, type
 * coercion, and custom validators. Essential for form validation, API contracts,
 * and data integrity.
 *
 * Drupal equivalent: TypedDataManager, DataDefinitionInterface
 *
 * DESIGN DECISION:
 * - Schema-based validation (not class-based)
 * - Support for nested object and array validation
 * - Type coercion for common conversions
 * - Path-based property access for deep nesting
 * - Extensible with custom validators
 *
 * @example Define and validate a schema
 * ```javascript
 * typedData.defineSchema('user', {
 *   type: 'object',
 *   properties: {
 *     name: { type: 'string', required: true },
 *     age: { type: 'number', min: 0 },
 *     email: { type: 'string', pattern: /^.+@.+$/ },
 *   },
 * });
 *
 * const result = typedData.validate({ name: 'Alice', age: 30 }, 'user');
 * if (!result.valid) {
 *   console.log('Errors:', result.errors);
 * }
 * ```
 */

// ============================================
// TYPE DEFINITIONS
// ============================================

/** Supported schema data types */
type SchemaType = 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object';

/** Custom validator function — returns true if valid, or an error message string */
type CustomValidator = (value: unknown) => true | string;

/** Schema property definition for nested object validation */
export interface SchemaDefinition {
  /** The expected data type */
  type: SchemaType;
  /** Human-readable schema name (added internally) */
  name?: string;
  /** Whether this field is required */
  required?: boolean;
  /** Property definitions for object types */
  properties?: Record<string, SchemaDefinition>;
  /** Item schema for array types */
  items?: SchemaDefinition;
  /** Default value when not provided */
  default?: unknown;
  /** Custom validation function */
  validator?: CustomValidator;
  /** Minimum value (numbers) or length (strings/arrays) */
  min?: number | string;
  /** Maximum value (numbers) or length (strings/arrays) */
  max?: number | string;
  /** Pattern to match (strings only) */
  pattern?: RegExp;
  /** Allowed values */
  enum?: unknown[];
}

/** Result of a validation operation */
export interface ValidationResult {
  /** Whether the data passed validation */
  valid: boolean;
  /** List of validation error messages */
  errors: string[];
  /** The data after type coercion */
  coerced: unknown;
}

/** The public typed data API surface */
export interface TypedDataAPI {
  defineSchema: typeof defineSchema;
  getSchema: typeof getSchema;
  validate: typeof validate;
  resolveValue: typeof resolveValue;
  hasSchema: typeof hasSchema;
  listSchemas: typeof listSchemas;
  clearSchemas: typeof clearSchemas;
}

/**
 * Schema registry
 * Structure: { schemaName: schemaDefinition }
 */
const schemas: Record<string, SchemaDefinition> = {};

/**
 * Define a data schema
 *
 * @param {string} name - Schema identifier
 * @param {Object} schema - Schema definition
 * @param {string} schema.type - Data type (string, number, boolean, date, array, object)
 * @param {boolean} [schema.required] - Whether field is required
 * @param {Object} [schema.properties] - Property definitions for objects
 * @param {Object} [schema.items] - Item definition for arrays
 * @param {*} [schema.default] - Default value if not provided
 * @param {Function} [schema.validator] - Custom validation function
 * @param {number} [schema.min] - Min value (for numbers) or length (for strings/arrays)
 * @param {number} [schema.max] - Max value (for numbers) or length (for strings/arrays)
 * @param {RegExp} [schema.pattern] - Pattern to match (for strings)
 * @param {*[]} [schema.enum] - Allowed values
 *
 * WHY FLEXIBLE SCHEMA:
 * Different use cases need different constraints. Forms need min/max length,
 * APIs need enum values, database models need custom validators.
 */
export function defineSchema(name: string, schema: SchemaDefinition): void {
  if (!name || typeof name !== 'string') {
    throw new Error('Schema name must be a non-empty string');
  }

  if (!schema || typeof schema !== 'object') {
    throw new Error(`Schema definition for "${name}" must be an object`);
  }

  if (!schema.type) {
    throw new Error(`Schema "${name}" must specify a type`);
  }

  schemas[name] = {
    name,
    ...schema,
  };
}

/**
 * Get a schema definition
 *
 * @param {string} name - Schema identifier
 * @returns {Object|null} - Schema definition or null
 */
export function getSchema(name: string): SchemaDefinition | null {
  return schemas[name] ?? null;
}

/**
 * Validate data against a schema
 *
 * @param {*} data - Data to validate
 * @param {string|Object} schemaOrName - Schema name or schema object
 * @returns {Object} - { valid: boolean, errors: string[], coerced: * }
 *
 * WHY RETURN COERCED VALUE:
 * Type coercion (e.g., "123" → 123) is common. Return the coerced value
 * so caller can use it without re-processing.
 */
export function validate(data: unknown, schemaOrName: string | SchemaDefinition): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    coerced: data,
  };

  // Resolve schema
  let schema;
  if (typeof schemaOrName === 'string') {
    schema = schemas[schemaOrName];
    if (!schema) {
      result.valid = false;
      result.errors.push(`Unknown schema: ${schemaOrName}`);
      return result;
    }
  } else if (typeof schemaOrName === 'object' && schemaOrName !== null && 'type' in schemaOrName && schemaOrName.type) {
    schema = schemaOrName;
  } else {
    result.valid = false;
    result.errors.push('Schema must be a name or schema object');
    return result;
  }

  // Validate using the schema
  const validation = validateValue(data, schema, '');

  return {
    valid: validation.valid,
    errors: validation.errors,
    coerced: validation.coerced,
  };
}

/**
 * Validate a single value against a schema
 *
 * @param {*} value - Value to validate
 * @param {Object} schema - Schema definition
 * @param {string} path - Property path (for error messages)
 * @returns {Object} - { valid: boolean, errors: string[], coerced: * }
 *
 * WHY PATH PARAMETER:
 * Nested validation needs to show which property failed.
 * "name is required" vs "user.profile.name is required"
 */
function validateValue(value: unknown, schema: SchemaDefinition, path: string = ''): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    coerced: value,
  };

  const prefix = path ? `${path}: ` : '';

  // Required check
  if (schema.required && (value === undefined || value === null || value === '')) {
    result.valid = false;
    result.errors.push(`${prefix}Field is required`);
    return result;
  }

  // If not required and not provided, use default
  if ((value === undefined || value === null) && 'default' in schema) {
    result.coerced = schema.default;
    return result;
  }

  // If not provided and not required, skip validation
  if (value === undefined || value === null) {
    return result;
  }

  // Type-specific validation
  switch (schema.type) {
    case 'string':
      result.coerced = coerceString(value);
      validateString(result.coerced, schema, prefix, result);
      break;

    case 'number':
      result.coerced = coerceNumber(value);
      validateNumber(result.coerced, schema, prefix, result);
      break;

    case 'boolean':
      result.coerced = coerceBoolean(value);
      validateBoolean(result.coerced, schema, prefix, result);
      break;

    case 'date':
      result.coerced = coerceDate(value);
      validateDate(result.coerced, schema, prefix, result);
      break;

    case 'array':
      result.coerced = value; // Arrays are not coerced
      validateArray(result.coerced, schema, path, result);
      break;

    case 'object':
      result.coerced = value; // Objects are not coerced
      validateObject(result.coerced, schema, path, result);
      break;

    default:
      result.valid = false;
      result.errors.push(`${prefix}Unknown type: ${schema.type}`);
  }

  // Custom validator
  if (schema.validator && typeof schema.validator === 'function') {
    try {
      const customResult = schema.validator(result.coerced);
      if (customResult !== true) {
        result.valid = false;
        result.errors.push(`${prefix}${customResult || 'Custom validation failed'}`);
      }
    } catch (error: unknown) {
      result.valid = false;
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`${prefix}Validator error: ${message}`);
    }
  }

  return result;
}

/**
 * Coercion utilities
 */
function coerceString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
}

function coerceNumber(value: unknown): unknown {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return isNaN(parsed) ? value : parsed;
  }
  return value;
}

function coerceBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'true' || lower === '1' || lower === 'yes') return true;
    if (lower === 'false' || lower === '0' || lower === 'no') return false;
  }
  if (typeof value === 'number') return value !== 0;
  return Boolean(value);
}

function coerceDate(value: unknown): unknown {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return isNaN(date.getTime()) ? value : date;
  }
  return value;
}

/**
 * Type-specific validators
 */
function validateString(value: unknown, schema: SchemaDefinition, prefix: string, result: ValidationResult): void {
  if (typeof value !== 'string') {
    result.valid = false;
    result.errors.push(`${prefix}Must be a string`);
    return;
  }

  if (schema.min !== undefined && value.length < Number(schema.min)) {
    result.valid = false;
    result.errors.push(`${prefix}Minimum length is ${schema.min}`);
  }

  if (schema.max !== undefined && value.length > Number(schema.max)) {
    result.valid = false;
    result.errors.push(`${prefix}Maximum length is ${schema.max}`);
  }

  if (schema.pattern && !schema.pattern.test(value)) {
    result.valid = false;
    result.errors.push(`${prefix}Does not match pattern`);
  }

  if (schema.enum && !schema.enum.includes(value)) {
    result.valid = false;
    result.errors.push(`${prefix}Must be one of: ${schema.enum.join(', ')}`);
  }
}

function validateNumber(value: unknown, schema: SchemaDefinition, prefix: string, result: ValidationResult): void {
  if (typeof value !== 'number' || isNaN(value)) {
    result.valid = false;
    result.errors.push(`${prefix}Must be a number`);
    return;
  }

  if (schema.min !== undefined && value < Number(schema.min)) {
    result.valid = false;
    result.errors.push(`${prefix}Minimum value is ${schema.min}`);
  }

  if (schema.max !== undefined && value > Number(schema.max)) {
    result.valid = false;
    result.errors.push(`${prefix}Maximum value is ${schema.max}`);
  }

  if (schema.enum && !schema.enum.includes(value)) {
    result.valid = false;
    result.errors.push(`${prefix}Must be one of: ${schema.enum.join(', ')}`);
  }
}

function validateBoolean(value: unknown, schema: SchemaDefinition, prefix: string, result: ValidationResult): void {
  if (typeof value !== 'boolean') {
    result.valid = false;
    result.errors.push(`${prefix}Must be a boolean`);
  }
}

function validateDate(value: unknown, schema: SchemaDefinition, prefix: string, result: ValidationResult): void {
  if (!(value instanceof Date) || isNaN(value.getTime())) {
    result.valid = false;
    result.errors.push(`${prefix}Must be a valid date`);
    return;
  }

  if (schema.min) {
    const minDate = new Date(schema.min);
    if (value < minDate) {
      result.valid = false;
      result.errors.push(`${prefix}Date must be after ${minDate.toISOString()}`);
    }
  }

  if (schema.max) {
    const maxDate = new Date(schema.max);
    if (value > maxDate) {
      result.valid = false;
      result.errors.push(`${prefix}Date must be before ${maxDate.toISOString()}`);
    }
  }
}

function validateArray(value: unknown, schema: SchemaDefinition, path: string, result: ValidationResult): void {
  if (!Array.isArray(value)) {
    result.valid = false;
    result.errors.push(`${path ? path + ': ' : ''}Must be an array`);
    return;
  }

  if (schema.min !== undefined && value.length < Number(schema.min)) {
    result.valid = false;
    result.errors.push(`${path ? path + ': ' : ''}Minimum length is ${schema.min}`);
  }

  if (schema.max !== undefined && value.length > Number(schema.max)) {
    result.valid = false;
    result.errors.push(`${path ? path + ': ' : ''}Maximum length is ${schema.max}`);
  }

  // Validate items if schema provided
  if (schema.items) {
    const coercedItems: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      const itemPath = path ? `${path}[${i}]` : `[${i}]`;
      const itemResult = validateValue(value[i], schema.items, itemPath);

      if (!itemResult.valid) {
        result.valid = false;
        result.errors.push(...itemResult.errors);
      }

      coercedItems.push(itemResult.coerced);
    }
    result.coerced = coercedItems;
  }
}

function validateObject(value: unknown, schema: SchemaDefinition, path: string, result: ValidationResult): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    result.valid = false;
    result.errors.push(`${path ? path + ': ' : ''}Must be an object`);
    return;
  }

  // Validate properties if schema provided
  if (schema.properties) {
    const obj = value as Record<string, unknown>;
    const coercedObj: Record<string, unknown> = { ...obj };

    for (const [key, propSchema] of Object.entries(schema.properties)) {
      const propPath = path ? `${path}.${key}` : key;
      const propResult = validateValue(obj[key], propSchema, propPath);

      if (!propResult.valid) {
        result.valid = false;
        result.errors.push(...propResult.errors);
      }

      coercedObj[key] = propResult.coerced;
    }

    result.coerced = coercedObj;
  }
}

/**
 * Resolve a value at a nested path
 *
 * @param {Object} data - Data object
 * @param {string} path - Property path (e.g., 'user.profile.name')
 * @returns {*} - Value at path, or undefined
 *
 * WHY PATH-BASED ACCESS:
 * Nested property access is common in forms, templates, and APIs.
 * Safer than eval, cleaner than manual traversal.
 *
 * @example
 * const data = { user: { profile: { name: 'Alice' } } };
 * resolveValue(data, 'user.profile.name'); // 'Alice'
 * resolveValue(data, 'user.email'); // undefined
 */
export function resolveValue(data: unknown, path: string): unknown {
  if (!path || typeof path !== 'string') {
    return undefined;
  }

  if (!data || typeof data !== 'object') {
    return undefined;
  }

  const parts = path.split('.');
  let current: unknown = data;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }

    // Handle array indices: user.addresses[0].city
    const arrayMatch = part.match(/^(.+)\[(\d+)\]$/);
    if (arrayMatch) {
      const [, prop, index] = arrayMatch;
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[prop as string];
      if (!Array.isArray(current)) {
        return undefined;
      }
      current = current[parseInt(index as string, 10)];
    } else {
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }
  }

  return current;
}

/**
 * Check if a schema exists
 *
 * @param {string} name - Schema identifier
 * @returns {boolean} - True if schema exists
 */
export function hasSchema(name: string): boolean {
  return name in schemas;
}

/**
 * List all schema names
 *
 * @returns {string[]} - Array of schema names
 */
export function listSchemas(): string[] {
  return Object.keys(schemas);
}

/**
 * Clear all schemas (for testing)
 *
 * @returns {void}
 */
export function clearSchemas(): void {
  for (const key of Object.keys(schemas)) {
    delete schemas[key];
  }
}

/**
 * Initialize the typed data service
 *
 * @param {Object} context - Boot context
 * @returns {Object} - The typed data API
 */
export function init(_context: Record<string, unknown>): TypedDataAPI {
  return {
    defineSchema,
    getSchema,
    validate,
    resolveValue,
    hasSchema,
    listSchemas,
    clearSchemas,
  };
}

/**
 * Register with services container
 *
 * @param {Object} services - Legacy services object
 * @param {Object} container - DI container
 */
export function register(services: Record<string, unknown> | null, container: Record<string, unknown> | null): void {
  const api = {
    defineSchema,
    getSchema,
    validate,
    resolveValue,
    hasSchema,
    listSchemas,
    clearSchemas,
  };

  // Legacy pattern
  if (services && typeof services.register === 'function') {
    (services.register as (name: string, factory: () => TypedDataAPI) => void)('typed_data', () => api);
  }

  // New container pattern
  if (container && typeof container.register === 'function') {
    (container.register as (name: string, factory: () => TypedDataAPI, opts: Record<string, unknown>) => void)(
      'typed_data', () => api, { tags: ['data', 'validation'], singleton: true }
    );
  }
}

// Export default API
export default {
  init,
  register,
  defineSchema,
  getSchema,
  validate,
  resolveValue,
  hasSchema,
  listSchemas,
  clearSchemas,
};
