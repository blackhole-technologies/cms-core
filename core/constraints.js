/**
 * constraints.js - Constraint Plugin Architecture for Content Validation
 *
 * WHY THIS EXISTS:
 * ================
 * Drupal uses a constraint-based validation system where each constraint
 * is a named plugin implementing validate(). This module provides:
 *
 * - Plugin registry: constraints registered by name
 * - Violation objects: structured error reporting (not just strings)
 * - Batch validation: ALL violations collected, not one-at-a-time
 * - Runtime registration: new constraints can be added after boot
 * - Content type binding: constraints configured per-field in content types
 *
 * CONSTRAINT PATTERN (Drupal-inspired):
 * =====================================
 * Each constraint is a plugin with:
 *   - id: unique machine name (e.g., 'Required', 'Length')
 *   - label: human-readable name
 *   - validate(value, options, context): returns array of violations
 *
 * VIOLATION OBJECT:
 * ================
 * {
 *   constraint: 'Required',        // Constraint ID that failed
 *   field: 'title',                // Field path that failed
 *   message: 'Title is required',  // Human-readable message
 *   value: null,                   // The invalid value
 *   code: 'REQUIRED'               // Machine-readable error code
 * }
 *
 * CONSTRAINT CONFIGURATION:
 * ========================
 * In content-types.json, constraints are defined per-field:
 * {
 *   "title": {
 *     "type": "string",
 *     "required": true,
 *     "constraints": {
 *       "Required": {},
 *       "Length": { "min": 1, "max": 255 }
 *     }
 *   }
 * }
 *
 * Or inferred from field properties (required, minLength, maxLength, etc.)
 */

// ============================================
// CONSTRAINT REGISTRY
// ============================================

/**
 * Registry of constraint plugins
 * Structure: { constraintId: { id, label, validate, description } }
 */
const constraints = {};

/**
 * Content service reference (set during init)
 */
let contentService = null;

/**
 * Configuration
 */
let config = {
  enabled: true
};

// ============================================
// INITIALIZATION
// ============================================

export const name = 'constraints';

/**
 * Initialize constraint system
 *
 * WHY SEPARATE INIT:
 * Called during boot after content service is available.
 * Content service needed for constraints like Unique that query existing data.
 *
 * @param {Object} cfg - Configuration
 * @param {Object} content - Content service reference
 */
export function init(cfg = {}, content = null) {
  config = { ...config, ...cfg };
  contentService = content;

  // Register all built-in constraints
  registerBuiltinConstraints();

  const count = Object.keys(constraints).length;
  console.log(`[constraints] Initialized (${count} constraint plugins)`);
}

// ============================================
// CONSTRAINT REGISTRATION
// ============================================

/**
 * Register a constraint plugin
 *
 * WHY PLUGIN PATTERN:
 * - Modules can add custom validation logic at runtime
 * - Each constraint is self-contained with its own validate()
 * - Follows Drupal's TypedDataConstraint pattern
 *
 * @param {string} id - Constraint ID (e.g., 'Required', 'Length')
 * @param {Object} plugin - Constraint plugin definition
 * @param {string} plugin.label - Human-readable name
 * @param {string} plugin.description - What this constraint validates
 * @param {Function} plugin.validate - (value, options, context) => Violation[]
 */
export function register(id, plugin) {
  if (!id || typeof id !== 'string') {
    throw new Error('Constraint ID must be a non-empty string');
  }
  if (!plugin || typeof plugin.validate !== 'function') {
    throw new Error(`Constraint "${id}" must have a validate() method`);
  }

  constraints[id] = {
    id,
    label: plugin.label || id,
    description: plugin.description || '',
    validate: plugin.validate,
    source: plugin.source || 'custom'
  };
}

/**
 * Get a constraint by ID
 *
 * @param {string} id - Constraint ID
 * @returns {Object|null} Constraint plugin or null
 */
export function get(id) {
  return constraints[id] || null;
}

/**
 * Check if a constraint exists
 *
 * @param {string} id - Constraint ID
 * @returns {boolean}
 */
export function has(id) {
  return id in constraints;
}

/**
 * List all registered constraints
 *
 * @returns {Array} Array of { id, label, description, source }
 */
export function list() {
  return Object.values(constraints)
    .map(c => ({
      id: c.id,
      label: c.label,
      description: c.description,
      source: c.source
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// ============================================
// VIOLATION FACTORY
// ============================================

/**
 * Create a constraint violation object
 *
 * WHY STRUCTURED VIOLATIONS:
 * - Machine-readable (code field for programmatic handling)
 * - Human-readable (message field for display)
 * - Traceable (constraint + field identify exact problem)
 * - JSON:API compatible error format
 *
 * @param {string} constraintId - Which constraint failed
 * @param {string} field - Which field failed
 * @param {string} message - Human-readable error message
 * @param {*} value - The invalid value
 * @param {string} code - Machine-readable error code
 * @returns {Object} Violation object
 */
export function createViolation(constraintId, field, message, value, code) {
  return {
    constraint: constraintId,
    field: field || null,
    message: message,
    value: value !== undefined ? value : null,
    code: code || constraintId.toUpperCase()
  };
}

// ============================================
// VALIDATION EXECUTION
// ============================================

/**
 * Validate content data against all configured constraints
 *
 * WHY COLLECT ALL VIOLATIONS:
 * - Users see every problem at once, not one-at-a-time
 * - Follows Drupal's ConstraintViolationList pattern
 * - More efficient than fix-one-resubmit-find-next
 *
 * @param {string} type - Content type name
 * @param {Object} data - Content data to validate
 * @param {Object} schema - Content type field definitions
 * @param {Object} options - { isUpdate, id }
 * @returns {Promise<Object>} { valid: bool, violations: Violation[] }
 */
export async function validate(type, data, schema, options = {}) {
  if (!config.enabled) {
    return { valid: true, violations: [] };
  }

  const violations = [];
  const context = {
    type,
    id: options.id || null,
    isUpdate: options.isUpdate || false,
    data,
    content: contentService
  };

  for (const [fieldName, fieldDef] of Object.entries(schema)) {
    // Skip system/internal fields
    if (fieldName.startsWith('_')) continue;

    // Skip readonly fields — they're auto-set by the system
    // WHY: Fields like 'created' and 'updated' are required+readonly,
    // meaning the system populates them. User data shouldn't need these.
    if (fieldDef.readonly) continue;

    const value = data[fieldName];

    // Get constraints for this field (explicit + inferred from field properties)
    const fieldConstraints = getFieldConstraints(fieldDef);

    for (const [constraintId, constraintOptions] of Object.entries(fieldConstraints)) {
      const constraint = constraints[constraintId];
      if (!constraint) {
        // Skip unknown constraints gracefully
        continue;
      }

      try {
        const fieldViolations = await constraint.validate(
          value,
          constraintOptions,
          { ...context, fieldName, fieldDef }
        );

        if (Array.isArray(fieldViolations)) {
          // Add field name to each violation
          for (const v of fieldViolations) {
            violations.push({
              ...v,
              field: v.field || fieldName
            });
          }
        }
      } catch (err) {
        violations.push(
          createViolation(constraintId, fieldName, err.message, value, 'CONSTRAINT_ERROR')
        );
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations
  };
}

/**
 * Validate and throw if violations found
 *
 * WHY SEPARATE METHOD:
 * - Convenience for content.create/update which expect throws
 * - Formats all violations into a single error message
 * - Attaches violations array to the error for programmatic access
 *
 * @param {string} type - Content type name
 * @param {Object} data - Content data
 * @param {Object} schema - Content type schema
 * @param {Object} options - Validation options
 * @throws {Error} With .violations property if validation fails
 */
export async function validateOrThrow(type, data, schema, options = {}) {
  const result = await validate(type, data, schema, options);

  if (!result.valid) {
    const messages = result.violations.map(v =>
      `${v.field}: ${v.message}`
    );
    const error = new Error(
      `Constraint violations on ${type}:\n  - ${messages.join('\n  - ')}`
    );
    error.violations = result.violations;
    error.code = 'CONSTRAINT_VIOLATION';
    throw error;
  }

  return result;
}

// ============================================
// FIELD CONSTRAINT EXTRACTION
// ============================================

/**
 * Extract constraints for a field from its definition
 *
 * WHY INFER FROM PROPERTIES:
 * - Backward compatible: existing field defs with `required: true` still work
 * - Explicit `constraints` object takes precedence
 * - Combines both for maximum flexibility
 *
 * @param {Object} fieldDef - Field definition
 * @returns {Object} { constraintId: options, ... }
 */
function getFieldConstraints(fieldDef) {
  const result = {};

  // 1. Infer from field properties (backward compatible)
  if (fieldDef.required) {
    result['Required'] = {};
  }
  if (fieldDef.minLength !== undefined || fieldDef.maxLength !== undefined) {
    result['Length'] = {};
    if (fieldDef.minLength !== undefined) result['Length'].min = fieldDef.minLength;
    if (fieldDef.maxLength !== undefined) result['Length'].max = fieldDef.maxLength;
  }
  if (fieldDef.pattern) {
    result['Regex'] = { pattern: fieldDef.pattern, message: fieldDef.patternMessage };
  }
  if (fieldDef.type === 'email') {
    result['Email'] = {};
  }
  if (fieldDef.type === 'url') {
    result['Url'] = {};
  }
  if (fieldDef.min !== undefined || fieldDef.max !== undefined) {
    result['Range'] = {};
    if (fieldDef.min !== undefined) result['Range'].min = fieldDef.min;
    if (fieldDef.max !== undefined) result['Range'].max = fieldDef.max;
  }

  // 2. Explicit constraints override/extend inferred ones
  if (fieldDef.constraints && typeof fieldDef.constraints === 'object') {
    for (const [id, options] of Object.entries(fieldDef.constraints)) {
      result[id] = options || {};
    }
  }

  return result;
}

// ============================================
// BUILT-IN CONSTRAINT PLUGINS
// ============================================

function registerBuiltinConstraints() {
  // Required — field must have a non-empty value
  register('Required', {
    label: 'Required',
    description: 'Validates that a field has a value (not null, undefined, or empty)',
    source: 'core',
    validate(value, options, context) {
      const violations = [];
      if (value === null || value === undefined || value === '') {
        violations.push(
          createViolation(
            'Required',
            context.fieldName,
            `${context.fieldDef?.label || context.fieldName} is required`,
            value,
            'REQUIRED'
          )
        );
      } else if (Array.isArray(value) && value.length === 0) {
        violations.push(
          createViolation(
            'Required',
            context.fieldName,
            `${context.fieldDef?.label || context.fieldName} is required`,
            value,
            'REQUIRED'
          )
        );
      }
      return violations;
    }
  });

  // Length — string min/max length
  register('Length', {
    label: 'Length',
    description: 'Validates string length (min/max)',
    source: 'core',
    validate(value, options, context) {
      const violations = [];
      // Skip empty values — Required handles that
      if (value === null || value === undefined || value === '') return violations;
      if (typeof value !== 'string') return violations;

      const label = context.fieldDef?.label || context.fieldName;

      if (options.min !== undefined && value.length < options.min) {
        violations.push(
          createViolation(
            'Length',
            context.fieldName,
            `${label} must be at least ${options.min} characters (got ${value.length})`,
            value,
            'TOO_SHORT'
          )
        );
      }
      if (options.max !== undefined && value.length > options.max) {
        violations.push(
          createViolation(
            'Length',
            context.fieldName,
            `${label} must be at most ${options.max} characters (got ${value.length})`,
            value,
            'TOO_LONG'
          )
        );
      }
      return violations;
    }
  });

  // Regex — value must match pattern
  register('Regex', {
    label: 'Regex',
    description: 'Validates value matches a regular expression pattern',
    source: 'core',
    validate(value, options, context) {
      const violations = [];
      if (value === null || value === undefined || value === '') return violations;

      const pattern = options.pattern instanceof RegExp
        ? options.pattern
        : new RegExp(options.pattern);

      if (!pattern.test(String(value))) {
        violations.push(
          createViolation(
            'Regex',
            context.fieldName,
            options.message || `${context.fieldDef?.label || context.fieldName} has an invalid format`,
            value,
            'PATTERN_MISMATCH'
          )
        );
      }
      return violations;
    }
  });

  // Email — valid email format
  register('Email', {
    label: 'Email',
    description: 'Validates email address format',
    source: 'core',
    validate(value, options, context) {
      const violations = [];
      if (value === null || value === undefined || value === '') return violations;

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        violations.push(
          createViolation(
            'Email',
            context.fieldName,
            'Invalid email address',
            value,
            'INVALID_EMAIL'
          )
        );
      }
      return violations;
    }
  });

  // Url — valid URL format
  register('Url', {
    label: 'URL',
    description: 'Validates URL format',
    source: 'core',
    validate(value, options, context) {
      const violations = [];
      if (value === null || value === undefined || value === '') return violations;

      try {
        new URL(value);
      } catch {
        violations.push(
          createViolation(
            'Url',
            context.fieldName,
            'Invalid URL',
            value,
            'INVALID_URL'
          )
        );
      }
      return violations;
    }
  });

  // Range — numeric min/max
  register('Range', {
    label: 'Range',
    description: 'Validates numeric value is within range',
    source: 'core',
    validate(value, options, context) {
      const violations = [];
      if (value === null || value === undefined || value === '') return violations;

      const num = Number(value);
      if (isNaN(num)) return violations;

      const label = context.fieldDef?.label || context.fieldName;

      if (options.min !== undefined && num < options.min) {
        violations.push(
          createViolation(
            'Range',
            context.fieldName,
            `${label} must be at least ${options.min}`,
            value,
            'TOO_LOW'
          )
        );
      }
      if (options.max !== undefined && num > options.max) {
        violations.push(
          createViolation(
            'Range',
            context.fieldName,
            `${label} must be at most ${options.max}`,
            value,
            'TOO_HIGH'
          )
        );
      }
      return violations;
    }
  });

  // Unique — value must be unique within content type
  register('Unique', {
    label: 'Unique',
    description: 'Validates value is unique within the content type',
    source: 'core',
    async validate(value, options, context) {
      const violations = [];
      if (value === null || value === undefined || value === '') return violations;
      if (!context.content || !context.type || !context.fieldName) return violations;

      const items = context.content.listAll
        ? context.content.listAll(context.type)
        : (context.content.list(context.type)?.items || []);

      for (const item of items) {
        // Skip self when updating
        if (context.id && item.id === context.id) continue;

        if (item[context.fieldName] === value) {
          violations.push(
            createViolation(
              'Unique',
              context.fieldName,
              `${context.fieldDef?.label || context.fieldName} must be unique (conflicts with ${item.id})`,
              value,
              'NOT_UNIQUE'
            )
          );
          break;
        }
      }
      return violations;
    }
  });

  // NotBlank — more strict than Required, trims whitespace
  register('NotBlank', {
    label: 'Not Blank',
    description: 'Validates that a trimmed string is not empty',
    source: 'core',
    validate(value, options, context) {
      const violations = [];
      if (value === null || value === undefined) return violations;
      if (typeof value === 'string' && value.trim() === '') {
        violations.push(
          createViolation(
            'NotBlank',
            context.fieldName,
            `${context.fieldDef?.label || context.fieldName} must not be blank`,
            value,
            'BLANK'
          )
        );
      }
      return violations;
    }
  });

  // EntityReference — validates referenced entity exists
  register('EntityReference', {
    label: 'Entity Reference',
    description: 'Validates entity reference field points to a valid, existing entity',
    source: 'core',
    async validate(value, options, context) {
      const violations = [];
      if (value === null || value === undefined || value === '') return violations;
      if (!context.content) return violations;

      // options can be: { type: 'user' } or just 'user'
      const targetType = typeof options === 'object' ? options.type : options;
      if (!targetType) {
        // No target type specified, skip validation
        return violations;
      }

      // Check if referenced entity exists
      try {
        const entity = context.content.read(targetType, value);
        if (!entity) {
          violations.push(
            createViolation(
              'EntityReference',
              context.fieldName,
              `Referenced ${targetType} "${value}" does not exist`,
              value,
              'INVALID_REFERENCE'
            )
          );
        }
      } catch (err) {
        // Entity type doesn't exist or other error
        violations.push(
          createViolation(
            'EntityReference',
            context.fieldName,
            `Invalid reference: ${err.message}`,
            value,
            'INVALID_REFERENCE'
          )
        );
      }

      return violations;
    }
  });

  // FileExtension — validates file has allowed extension
  register('FileExtension', {
    label: 'File Extension',
    description: 'Validates uploaded file has allowed extension',
    source: 'core',
    validate(value, options, context) {
      const violations = [];
      if (value === null || value === undefined || value === '') return violations;

      // options can be: { extensions: ['jpg', 'png'] } or ['jpg', 'png']
      const allowedExtensions = Array.isArray(options)
        ? options
        : (options?.extensions || []);

      if (allowedExtensions.length === 0) {
        // No restrictions, allow anything
        return violations;
      }

      // Extract filename from value (could be object with filename property or string)
      const filename = typeof value === 'object'
        ? (value.filename || value.name || value.path || '')
        : String(value);

      if (!filename) {
        // Can't determine filename, skip validation
        return violations;
      }

      // Skip validation for URLs (remote media like YouTube, Vimeo)
      // WHY: Remote video media entities store the full URL in the filename field.
      // URLs don't have file extensions, so we skip this constraint for them.
      if (filename.startsWith('http://') || filename.startsWith('https://')) {
        return violations;
      }

      // Extract extension (lowercase)
      const ext = filename.split('.').pop()?.toLowerCase() || '';

      // Normalize allowed extensions (remove leading dots, lowercase)
      const normalizedExtensions = allowedExtensions.map(e =>
        String(e).replace(/^\./, '').toLowerCase()
      );

      if (!normalizedExtensions.includes(ext)) {
        violations.push(
          createViolation(
            'FileExtension',
            context.fieldName,
            `File extension must be one of: ${normalizedExtensions.join(', ')}`,
            value,
            'INVALID_EXTENSION'
          )
        );
      }

      return violations;
    }
  });
}

// ============================================
// CLI COMMANDS
// ============================================

/**
 * Register CLI commands for constraint management
 *
 * @param {Object} cli - CLI service
 */
export function registerCLI(cli) {
  // constraints:list — List all registered constraint plugins
  cli.register('constraints:list', async () => {
    const all = list();
    console.log(`\nRegistered Constraints (${all.length}):\n`);
    for (const c of all) {
      console.log(`  ${c.id.padEnd(15)} ${c.description} [${c.source}]`);
    }
    console.log('');
    return true;
  }, 'List all registered constraint plugins');

  // constraints:validate <type> — Validate all content of a type using constraints
  cli.register('constraints:validate', async (args) => {
    if (args.length < 1) {
      console.error('Usage: constraints:validate <type>');
      throw new Error('Content type required');
    }

    const type = args[0];
    if (!contentService || !contentService.hasType(type)) {
      console.error(`Unknown content type: "${type}"`);
      throw new Error('Unknown content type');
    }

    const typeInfo = contentService.getType(type);
    const schema = typeInfo?.schema || {};
    const items = contentService.listAll
      ? contentService.listAll(type)
      : (contentService.list(type)?.items || []);

    console.log(`\nValidating ${items.length} ${type} items...\n`);

    let totalViolations = 0;
    for (const item of items) {
      const result = await validate(type, item, schema, { id: item.id });
      if (!result.valid) {
        console.log(`  ✗ ${item.id}:`);
        for (const v of result.violations) {
          console.log(`    - [${v.constraint}] ${v.field}: ${v.message}`);
          totalViolations++;
        }
      }
    }

    if (totalViolations === 0) {
      console.log('  ✓ All items pass constraint validation');
    } else {
      console.log(`\n  ${totalViolations} violation(s) found`);
    }
    console.log('');
    return true;
  }, 'Validate content using constraint plugins');

  // constraints:check <type> <field> — Show constraints configured for a field
  cli.register('constraints:check', async (args) => {
    if (args.length < 1) {
      console.error('Usage: constraints:check <type> [field]');
      throw new Error('Content type required');
    }

    const type = args[0];
    const fieldFilter = args[1];

    if (!contentService || !contentService.hasType(type)) {
      console.error(`Unknown content type: "${type}"`);
      throw new Error('Unknown content type');
    }

    const typeInfo = contentService.getType(type);
    const schema = typeInfo?.schema || {};

    console.log(`\nConstraints for ${type}:\n`);

    for (const [fieldName, fieldDef] of Object.entries(schema)) {
      if (fieldName.startsWith('_')) continue;
      if (fieldDef.readonly) continue;
      if (fieldFilter && fieldName !== fieldFilter) continue;

      const fieldConstraints = getFieldConstraints(fieldDef);
      const constraintIds = Object.keys(fieldConstraints);

      if (constraintIds.length > 0) {
        console.log(`  ${fieldName}:`);
        for (const [id, opts] of Object.entries(fieldConstraints)) {
          const optStr = Object.keys(opts).length > 0
            ? ` (${JSON.stringify(opts)})`
            : '';
          console.log(`    - ${id}${optStr}`);
        }
      }
    }
    console.log('');
    return true;
  }, 'Show constraints for a content type field');
}
