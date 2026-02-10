/**
 * CvaSchema.js - CVA Configuration Schema Validation
 *
 * WHAT THIS DOES:
 * ===============
 * Validates CVA (Class Variance Authority) configuration objects
 * to ensure they follow the correct schema and provide helpful
 * error messages when they don't.
 *
 * WHY VALIDATION:
 * ===============
 * - Catch config errors early (at definition time, not runtime)
 * - Provide clear error messages for debugging
 * - Document expected structure (schema as documentation)
 * - Prevent silent failures from malformed configs
 *
 * CVA CONFIG SCHEMA:
 * ==================
 * {
 *   base: string (required) - Base CSS classes always applied
 *   variants: object (optional) - Variant definitions
 *     {
 *       [variantName]: {
 *         [variantValue]: string (CSS classes for this value)
 *       }
 *     }
 *   defaultVariants: object (optional) - Default variant selections
 *     {
 *       [variantName]: string (default value for this variant)
 *     }
 *   compoundVariants: array (optional) - Compound variant rules
 *     [
 *       {
 *         [variantName]: string (condition value),
 *         class: string (CSS classes to apply when all conditions match)
 *         // OR
 *         classes: string
 *       }
 *     ]
 * }
 *
 * VALIDATION RULES:
 * =================
 * 1. Config must be an object
 * 2. base property is required and must be a non-empty string
 * 3. variants (if present) must be an object
 * 4. Each variant must be an object mapping values to CSS class strings
 * 5. defaultVariants (if present) must be an object
 * 6. Each defaultVariant key must exist in variants
 * 7. Each defaultVariant value must be a valid variant value
 * 8. compoundVariants (if present) must be an array
 * 9. Each compound variant must have at least one condition
 * 10. Each compound variant must have 'class' or 'classes' property
 * 11. Compound variant conditions must reference valid variants
 */

/**
 * Validate a CVA configuration object
 *
 * @param {*} config - Configuration to validate
 * @returns {object} - Validation result {valid: boolean, errors: string[]}
 *
 * @example
 * // Valid config
 * validateCvaConfig({
 *   base: 'btn',
 *   variants: {
 *     size: { sm: 'btn-sm', lg: 'btn-lg' }
 *   }
 * });
 * // Returns: {valid: true, errors: []}
 *
 * // Invalid config
 * validateCvaConfig({
 *   variants: { size: {} }
 * });
 * // Returns: {valid: false, errors: ['Missing required "base" property']}
 */
export function validateCvaConfig(config) {
  const errors = [];

  // Rule 1: Config must be an object
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    errors.push('Config must be an object');
    return { valid: false, errors };
  }

  // Rule 2: base is required and must be a non-empty string
  if (!config.base) {
    errors.push('Missing required "base" property');
  } else if (typeof config.base !== 'string') {
    errors.push('"base" must be a string');
  } else if (config.base.trim() === '') {
    errors.push('"base" cannot be empty');
  }

  // Rule 3 & 4: variants (if present) must be valid
  if (config.variants !== undefined) {
    const variantErrors = validateVariants(config.variants);
    errors.push(...variantErrors);
  }

  // Rule 5, 6, 7: defaultVariants (if present) must be valid
  if (config.defaultVariants !== undefined) {
    const defaultErrors = validateDefaultVariants(
      config.defaultVariants,
      config.variants || {}
    );
    errors.push(...defaultErrors);
  }

  // Rule 8, 9, 10, 11: compoundVariants (if present) must be valid
  if (config.compoundVariants !== undefined) {
    const compoundErrors = validateCompoundVariants(
      config.compoundVariants,
      config.variants || {}
    );
    errors.push(...compoundErrors);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate variants object
 *
 * @param {*} variants - Variants to validate
 * @returns {string[]} - Array of error messages
 */
function validateVariants(variants) {
  const errors = [];

  if (typeof variants !== 'object' || Array.isArray(variants)) {
    errors.push('"variants" must be an object');
    return errors;
  }

  // Check each variant definition
  for (const [variantName, variantConfig] of Object.entries(variants)) {
    if (typeof variantConfig !== 'object' || Array.isArray(variantConfig)) {
      errors.push(`Variant "${variantName}" must be an object mapping values to CSS classes`);
      continue;
    }

    // Check that variant has at least one value
    const values = Object.keys(variantConfig);
    if (values.length === 0) {
      errors.push(`Variant "${variantName}" must have at least one value`);
    }

    // Check that each value maps to a string
    for (const [value, classes] of Object.entries(variantConfig)) {
      if (typeof classes !== 'string') {
        errors.push(`Variant "${variantName}.${value}" must map to a string (CSS classes)`);
      }
    }
  }

  return errors;
}

/**
 * Validate defaultVariants object
 *
 * @param {*} defaultVariants - Default variants to validate
 * @param {object} variants - Variants definition (for validation)
 * @returns {string[]} - Array of error messages
 */
function validateDefaultVariants(defaultVariants, variants) {
  const errors = [];

  if (typeof defaultVariants !== 'object' || Array.isArray(defaultVariants)) {
    errors.push('"defaultVariants" must be an object');
    return errors;
  }

  // Check each default variant
  for (const [variantName, defaultValue] of Object.entries(defaultVariants)) {
    // Check that variant exists in variants
    if (!variants[variantName]) {
      errors.push(`Default variant "${variantName}" does not exist in variants`);
      continue;
    }

    // Check that default value is valid for this variant
    if (!variants[variantName][defaultValue]) {
      const validValues = Object.keys(variants[variantName]).join(', ');
      errors.push(
        `Default value "${defaultValue}" for variant "${variantName}" is not valid. ` +
        `Valid values: ${validValues}`
      );
    }
  }

  return errors;
}

/**
 * Validate compoundVariants array
 *
 * @param {*} compoundVariants - Compound variants to validate
 * @param {object} variants - Variants definition (for validation)
 * @returns {string[]} - Array of error messages
 */
function validateCompoundVariants(compoundVariants, variants) {
  const errors = [];

  if (!Array.isArray(compoundVariants)) {
    errors.push('"compoundVariants" must be an array');
    return errors;
  }

  // Check each compound variant rule
  compoundVariants.forEach((compound, index) => {
    if (typeof compound !== 'object' || Array.isArray(compound)) {
      errors.push(`Compound variant at index ${index} must be an object`);
      return;
    }

    // Check that compound has 'class' or 'classes' property
    if (!compound.class && !compound.classes) {
      errors.push(`Compound variant at index ${index} must have "class" or "classes" property`);
    }

    // Check that 'class' or 'classes' is a string
    if (compound.class && typeof compound.class !== 'string') {
      errors.push(`Compound variant at index ${index}: "class" must be a string`);
    }
    if (compound.classes && typeof compound.classes !== 'string') {
      errors.push(`Compound variant at index ${index}: "classes" must be a string`);
    }

    // Count conditions (all properties except 'class' and 'classes')
    const conditions = Object.keys(compound).filter(
      key => key !== 'class' && key !== 'classes'
    );

    if (conditions.length === 0) {
      errors.push(`Compound variant at index ${index} must have at least one condition`);
      return;
    }

    // Check that conditions reference valid variants
    for (const conditionName of conditions) {
      if (!variants[conditionName]) {
        errors.push(
          `Compound variant at index ${index}: condition "${conditionName}" does not exist in variants`
        );
        continue;
      }

      // Check that condition value is valid for the variant
      const conditionValue = compound[conditionName];
      if (!variants[conditionName][conditionValue]) {
        const validValues = Object.keys(variants[conditionName]).join(', ');
        errors.push(
          `Compound variant at index ${index}: value "${conditionValue}" for condition "${conditionName}" is not valid. ` +
          `Valid values: ${validValues}`
        );
      }
    }
  });

  return errors;
}

/**
 * Assert that a config is valid (throws on invalid)
 *
 * @param {*} config - Configuration to validate
 * @throws {Error} - If config is invalid
 *
 * USE THIS IN PRODUCTION CODE:
 * Call this when defining CVA configs to catch errors early.
 *
 * @example
 * const buttonConfig = {
 *   base: 'btn',
 *   variants: { size: { sm: 'btn-sm' } }
 * };
 *
 * assertValidCvaConfig(buttonConfig); // Throws if invalid
 */
export function assertValidCvaConfig(config) {
  const result = validateCvaConfig(config);

  if (!result.valid) {
    const errorList = result.errors.map(err => `  - ${err}`).join('\n');
    throw new Error(`Invalid CVA configuration:\n${errorList}`);
  }
}

/**
 * Get a human-readable description of the CVA schema
 *
 * @returns {string} - Schema documentation
 *
 * USE THIS FOR DEVELOPER GUIDANCE:
 * Show this when developers need to understand the expected format.
 */
export function getCvaSchemaDocumentation() {
  return `
CVA Configuration Schema
========================

Required Properties:
-------------------
  base: string
    - Base CSS classes always applied to the element
    - Cannot be empty
    - Example: "btn" or "btn rounded"

Optional Properties:
-------------------
  variants: object
    - Defines variant options and their CSS classes
    - Each variant has a name (key) and value mappings (object)
    - Example:
      {
        size: { sm: "btn-sm", lg: "btn-lg" },
        intent: { primary: "btn-primary", secondary: "btn-secondary" }
      }

  defaultVariants: object
    - Specifies default values for variants
    - Keys must match variant names
    - Values must be valid variant values
    - Example: { size: "sm", intent: "primary" }

  compoundVariants: array
    - Rules that apply classes when multiple conditions match
    - Each rule is an object with:
      - Conditions: variant name/value pairs
      - class or classes: CSS classes to apply
    - Example:
      [
        { size: "sm", intent: "primary", class: "btn-sm-primary" }
      ]

Complete Example:
----------------
{
  base: "btn rounded transition",
  variants: {
    size: {
      sm: "text-sm px-2 py-1",
      md: "text-base px-4 py-2",
      lg: "text-lg px-6 py-3"
    },
    intent: {
      primary: "bg-blue-500 text-white",
      secondary: "bg-gray-500 text-white",
      danger: "bg-red-500 text-white"
    }
  },
  defaultVariants: {
    size: "md",
    intent: "primary"
  },
  compoundVariants: [
    {
      size: "sm",
      intent: "primary",
      class: "font-bold"
    }
  ]
}
`;
}
