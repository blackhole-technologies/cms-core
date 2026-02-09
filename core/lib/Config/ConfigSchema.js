/**
 * ConfigSchema - Validates configuration entities against schema definitions
 *
 * Provides runtime validation for config entities to ensure data integrity.
 * Checks required fields, types, and constraints before saving.
 *
 * @example
 * const schema = {
 *   id: { type: 'string', required: true },
 *   label: { type: 'string', required: true },
 *   weight: { type: 'number', min: 0, max: 100 },
 *   options: { type: 'array' }
 * };
 *
 * const result = ConfigSchema.validate(entity, schema);
 * if (!result.valid) {
 *   console.error('Validation errors:', result.errors);
 * }
 */
export class ConfigSchema {
  /**
   * Validate entity data against a schema definition
   *
   * @param {Object} entity - Entity data to validate
   * @param {Object} schema - Schema definition with field rules
   * @returns {{valid: boolean, errors: string[]}} Validation result
   *
   * @example
   * const result = ConfigSchema.validate(
   *   { id: 'test', label: 'Test' },
   *   {
   *     id: { type: 'string', required: true },
   *     label: { type: 'string', required: true }
   *   }
   * );
   */
  static validate(entity, schema) {
    const errors = [];

    // Validate each field defined in schema
    for (const [fieldName, fieldSchema] of Object.entries(schema)) {
      const value = entity[fieldName];
      const hasValue = value !== undefined && value !== null;

      // Check required fields
      if (fieldSchema.required && !hasValue) {
        errors.push(`Field '${fieldName}' is required but missing`);
        continue; // Skip type/constraint checks for missing required fields
      }

      // Skip validation if field is optional and not provided
      if (!hasValue) {
        continue;
      }

      // Check type
      const actualType = ConfigSchema._getType(value);
      if (fieldSchema.type && actualType !== fieldSchema.type) {
        errors.push(
          `Field '${fieldName}' should be type '${fieldSchema.type}' but got '${actualType}'`
        );
        continue; // Skip constraint checks if type is wrong
      }

      // Check constraints based on type
      if (fieldSchema.type === 'number') {
        if (fieldSchema.min !== undefined && value < fieldSchema.min) {
          errors.push(
            `Field '${fieldName}' must be >= ${fieldSchema.min} but got ${value}`
          );
        }
        if (fieldSchema.max !== undefined && value > fieldSchema.max) {
          errors.push(
            `Field '${fieldName}' must be <= ${fieldSchema.max} but got ${value}`
          );
        }
      }

      if (fieldSchema.type === 'string') {
        if (fieldSchema.minLength !== undefined && value.length < fieldSchema.minLength) {
          errors.push(
            `Field '${fieldName}' must be at least ${fieldSchema.minLength} characters but got ${value.length}`
          );
        }
        if (fieldSchema.maxLength !== undefined && value.length > fieldSchema.maxLength) {
          errors.push(
            `Field '${fieldName}' must be at most ${fieldSchema.maxLength} characters but got ${value.length}`
          );
        }
        if (fieldSchema.pattern !== undefined) {
          const regex = new RegExp(fieldSchema.pattern);
          if (!regex.test(value)) {
            errors.push(
              `Field '${fieldName}' must match pattern '${fieldSchema.pattern}' but got '${value}'`
            );
          }
        }
      }

      if (fieldSchema.type === 'array') {
        if (fieldSchema.minItems !== undefined && value.length < fieldSchema.minItems) {
          errors.push(
            `Field '${fieldName}' must have at least ${fieldSchema.minItems} items but got ${value.length}`
          );
        }
        if (fieldSchema.maxItems !== undefined && value.length > fieldSchema.maxItems) {
          errors.push(
            `Field '${fieldName}' must have at most ${fieldSchema.maxItems} items but got ${value.length}`
          );
        }
      }

      // Check enum constraint (works for any type)
      if (fieldSchema.enum !== undefined) {
        if (!fieldSchema.enum.includes(value)) {
          errors.push(
            `Field '${fieldName}' must be one of [${fieldSchema.enum.join(', ')}] but got '${value}'`
          );
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get the type of a value for validation purposes
   *
   * WHY SEPARATE METHOD: JavaScript's typeof is insufficient
   * - typeof [] returns 'object', not 'array'
   * - typeof null returns 'object', not 'null'
   * - We need array as a distinct type for validation
   *
   * @private
   * @param {*} value - Value to check
   * @returns {string} Type name (string, number, boolean, object, array, null, undefined)
   */
  static _getType(value) {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }
}
