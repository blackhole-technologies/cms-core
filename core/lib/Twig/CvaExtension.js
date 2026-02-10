import { validateCvaConfig } from './CvaSchema.js';

/**
 * CvaExtension.js - Class Variance Authority (CVA) for template system
 *
 * WHAT IS CVA:
 * ============
 * CVA (Class Variance Authority) is a utility for building variant-based
 * component APIs. It allows defining a set of CSS class variants and
 * dynamically selecting which classes to apply based on props.
 *
 * WHY CVA:
 * ========
 * - Centralized variant definitions (single source of truth)
 * - Type-safe variant selection (via schema validation)
 * - Compound variants (apply classes when multiple conditions match)
 * - Default variants (sensible defaults without explicit props)
 * - DRY principle (define once, use everywhere)
 *
 * EXAMPLE USAGE:
 * ==============
 * Template:
 *   {{cva button base="btn" variants.size.sm="btn-sm" variants.size.lg="btn-lg"
 *        variants.intent.primary="btn-primary" variants.intent.secondary="btn-secondary"
 *        props.size="sm" props.intent="primary"}}
 *
 * Output: "btn btn-sm btn-primary"
 *
 * HOW IT WORKS:
 * =============
 * 1. Parse config object (base, variants, defaultVariants, compoundVariants)
 * 2. Apply base classes (always included)
 * 3. For each variant in props, look up corresponding classes
 * 4. Check compound variants - apply classes when conditions match
 * 5. Merge and deduplicate all classes
 * 6. Return final space-separated string
 */

/**
 * Apply CVA (Class Variance Authority) configuration
 *
 * @param {string} element - Base element type (e.g., 'button', 'div')
 * @param {object} config - CVA configuration
 * @param {string} config.base - Base CSS classes (always applied)
 * @param {object} config.variants - Variant definitions {variantName: {value: 'classes'}}
 * @param {object} config.defaultVariants - Default variant values
 * @param {array} config.compoundVariants - Compound variant rules
 * @param {object} props - Selected variant values
 * @returns {string} - Space-separated CSS classes
 *
 * @example
 * const config = {
 *   base: 'btn',
 *   variants: {
 *     size: { sm: 'btn-sm', lg: 'btn-lg' },
 *     intent: { primary: 'btn-primary', secondary: 'btn-secondary' }
 *   },
 *   defaultVariants: { size: 'sm', intent: 'primary' },
 *   compoundVariants: [
 *     { size: 'sm', intent: 'primary', class: 'btn-sm-primary' }
 *   ]
 * };
 *
 * applyCva('button', config, { size: 'sm', intent: 'primary' });
 * // Returns: 'btn btn-sm btn-primary btn-sm-primary'
 */
export function applyCva(element, config, props = {}) {
  // Validate config structure using schema validator
  const validation = validateCvaConfig(config);
  if (!validation.valid) {
    const errorList = validation.errors.join('; ');
    throw new Error(`Invalid CVA config: ${errorList}`);
  }

  // Collect all classes
  const classes = [];

  // 1. Always apply base classes
  classes.push(config.base);

  // 2. Merge defaultVariants with props (props override defaults)
  const defaultVariants = config.defaultVariants || {};
  const mergedProps = { ...defaultVariants, ...props };

  // 3. Apply variant classes based on props
  const variants = config.variants || {};
  for (const [variantName, variantConfig] of Object.entries(variants)) {
    const selectedValue = mergedProps[variantName];

    if (selectedValue !== undefined && variantConfig[selectedValue]) {
      classes.push(variantConfig[selectedValue]);
    }
  }

  // 4. Apply compound variants (when multiple conditions match)
  const compoundVariants = config.compoundVariants || [];
  for (const compound of compoundVariants) {
    if (matchesCompoundVariant(compound, mergedProps)) {
      // Compound can have 'class' or 'classes' property
      const compoundClasses = compound.class || compound.classes;
      if (compoundClasses) {
        classes.push(compoundClasses);
      }
    }
  }

  // 5. Merge and deduplicate classes
  return mergeClasses(classes);
}

/**
 * Check if current props match a compound variant's conditions
 *
 * @param {object} compound - Compound variant rule
 * @param {object} props - Current variant values
 * @returns {boolean} - True if all conditions match
 *
 * @example
 * matchesCompoundVariant(
 *   { size: 'sm', intent: 'primary', class: 'btn-sm-primary' },
 *   { size: 'sm', intent: 'primary', disabled: false }
 * );
 * // Returns: true (size and intent match, disabled is ignored)
 */
function matchesCompoundVariant(compound, props) {
  // All conditions (except 'class' and 'classes') must match
  const conditions = Object.entries(compound).filter(
    ([key]) => key !== 'class' && key !== 'classes'
  );

  return conditions.every(([key, value]) => props[key] === value);
}

/**
 * Merge and deduplicate CSS classes
 *
 * @param {array} classLists - Array of space-separated class strings
 * @returns {string} - Deduplicated space-separated classes
 *
 * WHY DEDUPLICATE:
 * Compound variants and overlapping configs can produce duplicate classes.
 * Deduplication keeps HTML clean and prevents specificity issues.
 *
 * @example
 * mergeClasses(['btn btn-primary', 'btn-sm', 'btn btn-primary']);
 * // Returns: 'btn btn-primary btn-sm'
 */
function mergeClasses(classLists) {
  const allClasses = classLists
    .filter(Boolean)
    .flatMap(classList => classList.split(/\s+/))
    .filter(Boolean);

  // Use Set for deduplication while preserving order
  const uniqueClasses = [...new Set(allClasses)];

  return uniqueClasses.join(' ');
}

/**
 * Parse CVA helper syntax in templates
 *
 * TEMPLATE SYNTAX:
 * ================
 * {{cva element config props}}
 *
 * Where:
 * - element: Base HTML element (e.g., 'button', 'div')
 * - config: JSON object or reference to data variable containing config
 * - props: JSON object or reference to data variable containing selected variants
 *
 * EXAMPLES:
 * =========
 * 1. Inline config:
 *    {{cva button {"base":"btn","variants":{"size":{"sm":"btn-sm"}}} {"size":"sm"}}}
 *
 * 2. Reference data variables:
 *    {{cva button buttonConfig buttonProps}}
 *    (where buttonConfig and buttonProps are in the template data)
 *
 * 3. Mixed (config from data, props inline):
 *    {{cva button buttonConfig {"size":"sm","intent":"primary"}}}
 */
export function parseCvaHelper(helperString, data) {
  // Match: cva element config props
  // Element can be: button, div, span, etc.
  // Config and props can be: JSON objects or variable references
  const match = helperString.match(/^cva\s+(\w+)\s+(.+)$/);

  if (!match) {
    throw new Error('Invalid CVA helper syntax. Expected: {{cva element config props}}');
  }

  const element = match[1];
  const argsString = match[2].trim();

  // Parse arguments (config and props)
  // They can be JSON objects or variable names
  const args = parseArguments(argsString, data);

  if (args.length < 1) {
    throw new Error('CVA helper requires at least a config argument');
  }

  const config = args[0];
  const props = args[1] || {};

  return applyCva(element, config, props);
}

/**
 * Parse arguments from helper string
 *
 * Handles:
 * - JSON objects: {"key":"value"}
 * - Variable references: varName or nested.path
 * - Mixed: config object + props object
 *
 * @param {string} argsString - Arguments string from helper
 * @param {object} data - Template data context
 * @returns {array} - Parsed arguments
 */
function parseArguments(argsString, data) {
  const args = [];
  let current = '';
  let depth = 0;
  let inString = false;
  let stringChar = null;

  for (let i = 0; i < argsString.length; i++) {
    const char = argsString[i];
    const prevChar = i > 0 ? argsString[i - 1] : '';

    // Track string boundaries
    if ((char === '"' || char === "'") && prevChar !== '\\') {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
        stringChar = null;
      }
    }

    // Track object depth
    if (!inString) {
      if (char === '{') depth++;
      if (char === '}') depth--;
    }

    // Split on spaces when not in object or string
    if (char === ' ' && depth === 0 && !inString) {
      if (current.trim()) {
        args.push(parseArgument(current.trim(), data));
        current = '';
      }
    } else {
      current += char;
    }
  }

  // Add last argument
  if (current.trim()) {
    args.push(parseArgument(current.trim(), data));
  }

  return args;
}

/**
 * Parse a single argument (JSON or variable reference)
 *
 * @param {string} arg - Argument string
 * @param {object} data - Template data context
 * @returns {*} - Parsed value
 */
function parseArgument(arg, data) {
  // Try parsing as JSON
  if (arg.startsWith('{') || arg.startsWith('[')) {
    try {
      return JSON.parse(arg);
    } catch (e) {
      throw new Error(`Invalid JSON in CVA helper: ${arg}`);
    }
  }

  // Otherwise treat as variable reference
  return getNestedValue(data, arg);
}

/**
 * Get nested value from object using dot notation
 *
 * @param {object} obj - Object to search
 * @param {string} path - Dot-separated path (e.g., 'user.name')
 * @returns {*} - Value at path, or undefined
 */
function getNestedValue(obj, path) {
  if (!path || !obj) return undefined;

  const parts = path.split('.');
  let current = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[part];
  }

  return current;
}
