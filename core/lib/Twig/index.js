/**
 * Twig Extensions - Barrel Export
 *
 * This module exports all Twig-related extensions and utilities
 * for the CMS template system.
 *
 * AVAILABLE EXPORTS:
 * ==================
 * - applyCva: Apply CVA configuration and return CSS classes
 * - parseCvaHelper: Parse CVA helper syntax from templates
 * - validateCvaConfig: Validate a CVA configuration object
 * - assertValidCvaConfig: Assert config is valid (throws on error)
 * - getCvaSchemaDocumentation: Get human-readable schema docs
 */

export {
  applyCva,
  parseCvaHelper
} from './CvaExtension.js';

export {
  validateCvaConfig,
  assertValidCvaConfig,
  getCvaSchemaDocumentation
} from './CvaSchema.js';
