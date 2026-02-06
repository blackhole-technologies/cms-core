/**
 * content-types.js - Content Type Management System
 *
 * WHY THIS EXISTS:
 * ================
 * Content types define the structure of content (like Drupal's content types).
 * Each type has fields, settings, and can be organized into bundles.
 * This provides a Field UI-like interface for managing content structure.
 *
 * FEATURES:
 * ========
 * - Content type definitions with machine names, labels, descriptions
 * - Field instances per content type with configuration
 * - Field settings: required, default, cardinality, help text, weight
 * - Field ordering in forms/display using weights
 * - Content type bundles for grouping similar types
 * - Default fields (title, created, updated) added automatically
 * - Type-specific settings (publishing, revisions, preview)
 * - Import/export of content type definitions
 * - Field reuse across multiple types
 * - Type locking to prevent modification of system types
 *
 * STORAGE:
 * =======
 * config/content-types.json:
 * {
 *   "article": {
 *     "label": "Article",
 *     "description": "Use for news, blog posts",
 *     "bundle": "content",
 *     "locked": false,
 *     "fields": {
 *       "title": { "type": "text", "required": true, "weight": 0 },
 *       "body": { "type": "richtext", "weight": 10 }
 *     },
 *     "settings": {
 *       "publishable": true,
 *       "revisions": true,
 *       "preview": true
 *     }
 *   }
 * }
 */

import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ============================================
// MODULE STATE
// ============================================

let baseDirectory = null;
let fieldsModule = null;
let validationModule = null;

/**
 * Content types registry
 * Structure: { typeId: { label, description, fields, settings, ... } }
 */
const contentTypes = {};

/**
 * Configuration
 */
let config = {
  enabled: true,
  configFile: 'config/content-types.json',
  defaultBundle: 'content',
  defaultFields: {
    title: { type: 'string', required: true, maxLength: 255, weight: 0, label: 'Title' },
    created: { type: 'datetime', required: true, weight: 997, label: 'Created', readonly: true },
    updated: { type: 'datetime', required: true, weight: 998, label: 'Updated', readonly: true },
    status: { type: 'select', options: ['draft', 'published', 'archived'], default: 'draft', weight: 999, label: 'Status' }
  }
};

/**
 * Hooks registry
 * Structure: { eventName: [handlers] }
 */
const hooks = {
  'contentType:create': [],
  'contentType:update': [],
  'contentType:delete': [],
  'field:add': [],
  'field:remove': []
};

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize content types system
 *
 * WHY SEPARATE INIT:
 * Allows dependency injection of fields and validation modules.
 * Called during boot sequence after base systems are loaded.
 *
 * @param {string} baseDir - Base directory path
 * @param {Object} fields - Fields module instance
 * @param {Object} validation - Validation module instance
 * @param {Object} cfg - Configuration overrides
 */
export async function init(baseDir, fields = null, validation = null, cfg = {}) {
  baseDirectory = baseDir;
  fieldsModule = fields;
  validationModule = validation;
  config = { ...config, ...cfg };

  // Load content types from config file
  await loadContentTypes();

  const count = Object.keys(contentTypes).length;
  console.log(`[content-types] Initialized (${count} types)`);
}

/**
 * Load content types from config file
 */
async function loadContentTypes() {
  const configPath = join(baseDirectory, config.configFile);

  try {
    const data = await fs.readFile(configPath, 'utf-8');
    const types = JSON.parse(data);

    for (const [id, typeDef] of Object.entries(types)) {
      contentTypes[id] = normalizeType(id, typeDef);
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      // Config file doesn't exist yet, that's ok
      console.log('[content-types] No config file found, starting fresh');
    } else {
      console.error('[content-types] Failed to load config:', err.message);
      throw err;
    }
  }
}

/**
 * Save content types to config file
 */
async function saveContentTypes() {
  const configPath = join(baseDirectory, config.configFile);

  // Ensure directory exists
  await fs.mkdir(dirname(configPath), { recursive: true });

  // Serialize types (remove readonly computed fields)
  const serializable = {};
  for (const [id, type] of Object.entries(contentTypes)) {
    serializable[id] = {
      label: type.label,
      description: type.description,
      bundle: type.bundle,
      locked: type.locked,
      fields: type.fields,
      settings: type.settings
    };
  }

  await fs.writeFile(configPath, JSON.stringify(serializable, null, 2), 'utf-8');
}

/**
 * Normalize a content type definition
 *
 * WHY NORMALIZE:
 * Ensures all types have required fields and default values.
 * Adds default fields (title, created, updated) if missing.
 *
 * @param {string} id - Type ID
 * @param {Object} typeDef - Type definition
 * @returns {Object} Normalized type
 */
function normalizeType(id, typeDef) {
  const normalized = {
    id,
    label: typeDef.label || id.charAt(0).toUpperCase() + id.slice(1),
    description: typeDef.description || '',
    bundle: typeDef.bundle || config.defaultBundle,
    locked: typeDef.locked || false,
    fields: {},
    settings: {
      publishable: true,
      revisions: false,
      preview: false,
      ...typeDef.settings
    }
  };

  // Merge default fields with type fields
  const allFields = { ...config.defaultFields, ...typeDef.fields };

  // Sort fields by weight
  const fieldEntries = Object.entries(allFields).sort((a, b) => {
    const weightA = a[1].weight ?? 500;
    const weightB = b[1].weight ?? 500;
    return weightA - weightB;
  });

  for (const [name, field] of fieldEntries) {
    normalized.fields[name] = {
      ...field,
      weight: field.weight ?? 500
    };
  }

  return normalized;
}

// ============================================
// CONTENT TYPE CRUD
// ============================================

/**
 * Create a new content type
 *
 * @param {string} id - Machine name (lowercase, alphanumeric, hyphens)
 * @param {Object} typeConfig - Type configuration
 * @returns {Promise<Object>} Created type
 */
export async function createType(id, typeConfig) {
  // Validate ID
  if (!id || typeof id !== 'string') {
    throw new Error('Type ID must be a non-empty string');
  }
  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    throw new Error('Type ID must start with a letter and contain only lowercase letters, numbers, and hyphens');
  }
  if (contentTypes[id]) {
    throw new Error(`Content type "${id}" already exists`);
  }

  // Create normalized type
  const type = normalizeType(id, typeConfig);

  // Run hooks
  await runHooks('contentType:create', { id, type });

  // Save to registry
  contentTypes[id] = type;

  // Persist to disk
  await saveContentTypes();

  console.log(`[content-types] Created type: ${id}`);
  return type;
}

/**
 * Update an existing content type
 *
 * @param {string} id - Type ID
 * @param {Object} updates - Updates to apply
 * @returns {Promise<Object>} Updated type
 */
export async function updateType(id, updates) {
  const type = contentTypes[id];
  if (!type) {
    throw new Error(`Content type "${id}" not found`);
  }

  // Check if locked
  if (type.locked) {
    throw new Error(`Content type "${id}" is locked and cannot be modified`);
  }

  // Merge updates (preserve fields separately)
  const updated = {
    ...type,
    label: updates.label ?? type.label,
    description: updates.description ?? type.description,
    bundle: updates.bundle ?? type.bundle,
    settings: { ...type.settings, ...updates.settings }
  };

  // Don't allow field updates through updateType - use addField/updateField instead
  // This ensures proper validation and hooks for field changes

  // Run hooks
  await runHooks('contentType:update', { id, before: type, after: updated });

  // Save to registry
  contentTypes[id] = updated;

  // Persist to disk
  await saveContentTypes();

  console.log(`[content-types] Updated type: ${id}`);
  return updated;
}

/**
 * Delete a content type
 *
 * WHY REQUIRE CONFIRMATION:
 * Deleting a type can affect existing content.
 * Caller should handle content migration/deletion.
 *
 * @param {string} id - Type ID
 * @param {Object} options - { force: boolean }
 * @returns {Promise<void>}
 */
export async function deleteType(id, options = {}) {
  const type = contentTypes[id];
  if (!type) {
    throw new Error(`Content type "${id}" not found`);
  }

  // Check if locked
  if (type.locked && !options.force) {
    throw new Error(`Content type "${id}" is locked and cannot be deleted without force option`);
  }

  // Run hooks (allows modules to prevent deletion or clean up)
  await runHooks('contentType:delete', { id, type });

  // Remove from registry
  delete contentTypes[id];

  // Persist to disk
  await saveContentTypes();

  console.log(`[content-types] Deleted type: ${id}`);
}

/**
 * Get a content type by ID
 *
 * @param {string} id - Type ID
 * @returns {Object|null} Type definition or null
 */
export function getType(id) {
  return contentTypes[id] || null;
}

/**
 * List all content types
 *
 * @param {Object} options - { bundle: string }
 * @returns {Array} Array of type definitions
 */
export function listTypes(options = {}) {
  let types = Object.values(contentTypes);

  // Filter by bundle
  if (options.bundle) {
    types = types.filter(t => t.bundle === options.bundle);
  }

  // Sort by label
  types.sort((a, b) => a.label.localeCompare(b.label));

  return types;
}

/**
 * Check if a content type exists
 *
 * @param {string} id - Type ID
 * @returns {boolean}
 */
export function hasType(id) {
  return id in contentTypes;
}

// ============================================
// FIELD MANAGEMENT
// ============================================

/**
 * Add a field to a content type
 *
 * @param {string} typeId - Content type ID
 * @param {string} fieldName - Field name
 * @param {Object} fieldConfig - Field configuration
 * @returns {Promise<Object>} Updated type
 */
export async function addField(typeId, fieldName, fieldConfig) {
  const type = contentTypes[typeId];
  if (!type) {
    throw new Error(`Content type "${typeId}" not found`);
  }
  if (type.locked) {
    throw new Error(`Content type "${typeId}" is locked`);
  }
  if (type.fields[fieldName]) {
    throw new Error(`Field "${fieldName}" already exists on type "${typeId}"`);
  }

  // Validate field name
  if (!fieldName || typeof fieldName !== 'string') {
    throw new Error('Field name must be a non-empty string');
  }
  if (!/^[a-z][a-z0-9_]*$/i.test(fieldName)) {
    throw new Error('Field name must start with a letter and contain only letters, numbers, and underscores');
  }

  // Validate field type
  if (fieldsModule && !fieldsModule.hasFieldType(fieldConfig.type)) {
    throw new Error(`Unknown field type: ${fieldConfig.type}`);
  }

  // Add field
  type.fields[fieldName] = {
    ...fieldConfig,
    weight: fieldConfig.weight ?? 500
  };

  // Run hooks
  await runHooks('field:add', { typeId, fieldName, fieldConfig });

  // Persist
  await saveContentTypes();

  console.log(`[content-types] Added field "${fieldName}" to type "${typeId}"`);
  return type;
}

/**
 * Update a field configuration
 *
 * @param {string} typeId - Content type ID
 * @param {string} fieldName - Field name
 * @param {Object} updates - Field updates
 * @returns {Promise<Object>} Updated type
 */
export async function updateField(typeId, fieldName, updates) {
  const type = contentTypes[typeId];
  if (!type) {
    throw new Error(`Content type "${typeId}" not found`);
  }
  if (type.locked) {
    throw new Error(`Content type "${typeId}" is locked`);
  }
  if (!type.fields[fieldName]) {
    throw new Error(`Field "${fieldName}" not found on type "${typeId}"`);
  }

  // Check if field is readonly (e.g., created, updated)
  const field = type.fields[fieldName];
  if (field.readonly) {
    throw new Error(`Field "${fieldName}" is readonly and cannot be modified`);
  }

  // Merge updates
  type.fields[fieldName] = {
    ...field,
    ...updates,
    weight: updates.weight ?? field.weight
  };

  // Persist
  await saveContentTypes();

  console.log(`[content-types] Updated field "${fieldName}" on type "${typeId}"`);
  return type;
}

/**
 * Remove a field from a content type
 *
 * WHY REQUIRE CONFIRMATION:
 * Removing a field deletes data from existing content.
 * Caller should handle data migration.
 *
 * @param {string} typeId - Content type ID
 * @param {string} fieldName - Field name
 * @param {Object} options - { force: boolean }
 * @returns {Promise<Object>} Updated type
 */
export async function removeField(typeId, fieldName, options = {}) {
  const type = contentTypes[typeId];
  if (!type) {
    throw new Error(`Content type "${typeId}" not found`);
  }
  if (type.locked && !options.force) {
    throw new Error(`Content type "${typeId}" is locked`);
  }
  if (!type.fields[fieldName]) {
    throw new Error(`Field "${fieldName}" not found on type "${typeId}"`);
  }

  // Check if field is readonly
  const field = type.fields[fieldName];
  if (field.readonly && !options.force) {
    throw new Error(`Field "${fieldName}" is readonly and cannot be removed without force option`);
  }

  // Run hooks
  await runHooks('field:remove', { typeId, fieldName, field });

  // Remove field
  delete type.fields[fieldName];

  // Persist
  await saveContentTypes();

  console.log(`[content-types] Removed field "${fieldName}" from type "${typeId}"`);
  return type;
}

/**
 * Reorder fields by setting weights
 *
 * @param {string} typeId - Content type ID
 * @param {Object} weights - { fieldName: weight }
 * @returns {Promise<Object>} Updated type
 */
export async function reorderFields(typeId, weights) {
  const type = contentTypes[typeId];
  if (!type) {
    throw new Error(`Content type "${typeId}" not found`);
  }
  if (type.locked) {
    throw new Error(`Content type "${typeId}" is locked`);
  }

  // Update weights
  for (const [fieldName, weight] of Object.entries(weights)) {
    if (type.fields[fieldName]) {
      type.fields[fieldName].weight = weight;
    }
  }

  // Re-normalize to sort fields
  contentTypes[typeId] = normalizeType(typeId, type);

  // Persist
  await saveContentTypes();

  console.log(`[content-types] Reordered fields for type "${typeId}"`);
  return contentTypes[typeId];
}

/**
 * Get fields for a content type (sorted by weight)
 *
 * @param {string} typeId - Content type ID
 * @returns {Object} Fields object
 */
export function getTypeFields(typeId) {
  const type = contentTypes[typeId];
  if (!type) {
    return null;
  }
  return type.fields;
}

// ============================================
// VALIDATION
// ============================================

/**
 * Validate content data against a content type
 *
 * @param {string} typeId - Content type ID
 * @param {Object} data - Content data to validate
 * @param {Object} options - Validation options
 * @returns {Promise<Object>} { valid: boolean, errors: [...] }
 */
export async function validateContent(typeId, data, options = {}) {
  const type = contentTypes[typeId];
  if (!type) {
    throw new Error(`Content type "${typeId}" not found`);
  }

  // Use validation module if available
  if (validationModule && validationModule.validate) {
    return validationModule.validate(typeId, data, {
      schema: type.fields,
      ...options
    });
  }

  // Basic built-in validation
  const errors = [];

  for (const [fieldName, fieldDef] of Object.entries(type.fields)) {
    const value = data[fieldName];

    // Required check
    if (fieldDef.required && (value === null || value === undefined || value === '')) {
      errors.push({
        field: fieldName,
        rule: 'required',
        message: `${fieldDef.label || fieldName} is required`
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// ============================================
// IMPORT/EXPORT
// ============================================

/**
 * Export a content type definition
 *
 * @param {string} typeId - Content type ID
 * @returns {Object} Exportable type definition
 */
export function exportType(typeId) {
  const type = contentTypes[typeId];
  if (!type) {
    throw new Error(`Content type "${typeId}" not found`);
  }

  return {
    id: typeId,
    label: type.label,
    description: type.description,
    bundle: type.bundle,
    fields: type.fields,
    settings: type.settings,
    exportedAt: new Date().toISOString(),
    version: '1.0'
  };
}

/**
 * Import a content type definition
 *
 * @param {Object} typeConfig - Exported type configuration
 * @param {Object} options - { overwrite: boolean }
 * @returns {Promise<Object>} Imported type
 */
export async function importType(typeConfig, options = {}) {
  const id = typeConfig.id;

  if (!id) {
    throw new Error('Type configuration must include an id');
  }

  // Check if exists
  if (contentTypes[id] && !options.overwrite) {
    throw new Error(`Content type "${id}" already exists. Use overwrite option to replace.`);
  }

  // Check if locked
  if (contentTypes[id]?.locked && !options.force) {
    throw new Error(`Content type "${id}" is locked. Use force option to replace.`);
  }

  // Create or update
  if (contentTypes[id]) {
    // Update existing
    contentTypes[id] = normalizeType(id, typeConfig);
    await runHooks('contentType:update', { id, type: contentTypes[id] });
  } else {
    // Create new
    contentTypes[id] = normalizeType(id, typeConfig);
    await runHooks('contentType:create', { id, type: contentTypes[id] });
  }

  // Persist
  await saveContentTypes();

  console.log(`[content-types] Imported type: ${id}`);
  return contentTypes[id];
}

// ============================================
// HOOKS SYSTEM
// ============================================

/**
 * Register a hook handler
 *
 * @param {string} event - Hook event name
 * @param {Function} handler - Handler function
 */
export function registerHook(event, handler) {
  if (!hooks[event]) {
    hooks[event] = [];
  }
  hooks[event].push(handler);
}

/**
 * Run hooks for an event
 *
 * @param {string} event - Hook event name
 * @param {Object} context - Event context
 */
async function runHooks(event, context) {
  const handlers = hooks[event] || [];
  for (const handler of handlers) {
    try {
      await handler(context);
    } catch (err) {
      console.error(`[content-types] Hook error (${event}):`, err.message);
      // Continue running other hooks
    }
  }
}

// ============================================
// BUNDLES
// ============================================

/**
 * List all bundles
 *
 * @returns {Array} Array of { bundle, label, types: [...] }
 */
export function listBundles() {
  const bundlesMap = {};

  for (const type of Object.values(contentTypes)) {
    const bundle = type.bundle || config.defaultBundle;
    if (!bundlesMap[bundle]) {
      bundlesMap[bundle] = {
        bundle,
        label: bundle.charAt(0).toUpperCase() + bundle.slice(1),
        types: []
      };
    }
    bundlesMap[bundle].types.push(type.id);
  }

  return Object.values(bundlesMap).sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Get types in a bundle
 *
 * @param {string} bundle - Bundle name
 * @returns {Array} Array of type IDs
 */
export function getTypesInBundle(bundle) {
  return Object.values(contentTypes)
    .filter(t => t.bundle === bundle)
    .map(t => t.id);
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Lock a content type to prevent modifications
 *
 * @param {string} typeId - Type ID
 * @returns {Promise<Object>} Updated type
 */
export async function lockType(typeId) {
  const type = contentTypes[typeId];
  if (!type) {
    throw new Error(`Content type "${typeId}" not found`);
  }

  type.locked = true;
  await saveContentTypes();

  console.log(`[content-types] Locked type: ${typeId}`);
  return type;
}

/**
 * Unlock a content type
 *
 * @param {string} typeId - Type ID
 * @returns {Promise<Object>} Updated type
 */
export async function unlockType(typeId) {
  const type = contentTypes[typeId];
  if (!type) {
    throw new Error(`Content type "${typeId}" not found`);
  }

  type.locked = false;
  await saveContentTypes();

  console.log(`[content-types] Unlocked type: ${typeId}`);
  return type;
}

/**
 * Get content types configuration
 *
 * @returns {Object} Configuration
 */
export function getConfig() {
  return { ...config };
}

/**
 * Get statistics about content types
 *
 * @returns {Object} Statistics
 */
export function getStats() {
  const stats = {
    totalTypes: Object.keys(contentTypes).length,
    byBundle: {},
    lockedTypes: 0,
    totalFields: 0
  };

  for (const type of Object.values(contentTypes)) {
    const bundle = type.bundle || config.defaultBundle;
    stats.byBundle[bundle] = (stats.byBundle[bundle] || 0) + 1;

    if (type.locked) {
      stats.lockedTypes++;
    }

    stats.totalFields += Object.keys(type.fields).length;
  }

  return stats;
}

/**
 * Clear all content types (for testing)
 *
 * @returns {Promise<void>}
 */
export async function clearTypes() {
  for (const id of Object.keys(contentTypes)) {
    delete contentTypes[id];
  }
  await saveContentTypes();
  console.log('[content-types] Cleared all types');
}
