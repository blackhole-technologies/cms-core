/**
 * entity-reference.js - Entity Reference System
 *
 * WHY THIS EXISTS:
 * ================
 * Content items often reference other content (author, tags, related posts).
 * This module provides:
 * - Type-safe entity references
 * - Reverse reference tracking (find what references an item)
 * - Cascade deletion rules (restrict, nullify, cascade)
 * - Reference validation (ensure targets exist)
 * - Lazy/eager loading of referenced content
 * - Autocomplete search for reference fields
 *
 * REFERENCE STORAGE:
 * ==================
 * Single reference stored as:
 * { "_ref": "user", "id": "user-123" }
 *
 * Multi-value reference stored as:
 * { "_ref": "term", "ids": ["term-1", "term-2"] }
 *
 * FIELD CONFIGURATION:
 * ====================
 * {
 *   author: {
 *     type: 'reference',
 *     target: 'user',
 *     cardinality: 1,
 *     required: true,
 *     cascade: 'restrict'
 *   },
 *   tags: {
 *     type: 'reference',
 *     target: 'term',
 *     vocabulary: 'tags',
 *     cardinality: -1,
 *     cascade: 'nullify'
 *   }
 * }
 *
 * CASCADE OPTIONS:
 * ================
 * - 'restrict': Prevent deletion if referenced
 * - 'nullify': Set reference to null
 * - 'cascade': Delete referencing content
 *
 * ZERO DEPENDENCIES:
 * ==================
 * Uses only Node.js standard library and existing content/fields modules.
 */

import * as hooks from './hooks.js';

// ============================================
// MODULE STATE
// ============================================

let contentModule = null;
let fieldsModule = null;
let config = {
  cacheResolvedRefs: true,
  maxDepth: 3,
  autocompleteLimit: 25
};

// Resolved reference cache: { "type:id:field": resolvedValue }
const refCache = new Map();

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize entity reference system
 *
 * @param {Object} content - Content module
 * @param {Object} fields - Fields module
 * @param {Object} cfg - Configuration
 */
export function init(content, fields, cfg = {}) {
  contentModule = content;
  fieldsModule = fields;
  config = { ...config, ...cfg };

  // Register reference field types if not already registered
  if (fields && typeof fields.registerFieldType === 'function') {
    registerReferenceFields(fields);
  }

  // Set up hooks for cascade deletion
  hooks.register('content:beforeDelete', handleCascadeDelete);
  hooks.register('content:afterDelete', clearReferenceCache);
}

/**
 * Get current configuration
 */
export function getConfig() {
  return { ...config };
}

// ============================================
// REFERENCE CREATION
// ============================================

/**
 * Create a reference object
 *
 * @param {string} targetType - Type of target content
 * @param {string|string[]} targetId - ID(s) of target content
 * @returns {Object} Reference object
 */
export function createReference(targetType, targetId) {
  if (!targetType) {
    throw new Error('Reference target type is required');
  }

  if (Array.isArray(targetId)) {
    // Multi-value reference
    const validIds = targetId.filter(id => id != null && id !== '');
    return {
      _ref: targetType,
      ids: validIds
    };
  } else {
    // Single reference
    if (!targetId) {
      return null;
    }
    return {
      _ref: targetType,
      id: targetId
    };
  }
}

/**
 * Check if value is a reference object
 */
export function isReference(value) {
  return value && typeof value === 'object' && value._ref;
}

/**
 * Get referenced IDs from a reference value
 */
export function getReferencedIds(value) {
  if (!isReference(value)) {
    return [];
  }

  if (value.ids) {
    return [...value.ids];
  } else if (value.id) {
    return [value.id];
  }

  return [];
}

// ============================================
// REFERENCE RESOLUTION
// ============================================

/**
 * Resolve a single reference to actual content
 *
 * @param {Object} ref - Reference object
 * @param {Object} options - Resolution options
 * @returns {Object|null} Resolved content or null
 */
export async function resolveReference(ref, options = {}) {
  if (!isReference(ref)) {
    return ref;
  }

  const { _ref: targetType, id } = ref;

  if (!id) {
    return null;
  }

  // Check cache
  const cacheKey = `${targetType}:${id}`;
  if (config.cacheResolvedRefs && refCache.has(cacheKey)) {
    return refCache.get(cacheKey);
  }

  try {
    // Fire pre-resolve hook
    await hooks.fire('reference:beforeResolve', { targetType, id, options });

    // Load content
    const content = await contentModule.load(targetType, id, options);

    // Cache result
    if (config.cacheResolvedRefs && content) {
      refCache.set(cacheKey, content);
    }

    // Fire post-resolve hook
    await hooks.fire('reference:afterResolve', { targetType, id, content });

    return content;
  } catch (err) {
    // Content not found or error loading
    return null;
  }
}

/**
 * Resolve all references in a content object
 *
 * @param {Object} content - Content object with references
 * @param {number} depth - How deep to resolve nested references
 * @param {Object} options - Resolution options
 * @returns {Object} Content with resolved references
 */
export async function resolveReferences(content, depth = 1, options = {}) {
  if (!content || depth <= 0 || depth > config.maxDepth) {
    return content;
  }

  const type = content.type;
  const schema = contentModule.getSchema(type);

  if (!schema || !schema.fields) {
    return content;
  }

  const resolved = { ...content };

  // Find all reference fields
  for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
    if (fieldDef.type !== 'reference' && fieldDef.type !== 'references') {
      continue;
    }

    const value = content[fieldName];

    if (!value) {
      continue;
    }

    if (isReference(value)) {
      if (value.ids) {
        // Multi-value reference
        const resolved_items = [];
        for (const id of value.ids) {
          const ref = createReference(value._ref, id);
          const item = await resolveReference(ref, options);
          if (item) {
            // Recursively resolve nested references
            const nested = await resolveReferences(item, depth - 1, options);
            resolved_items.push(nested);
          }
        }
        resolved[fieldName] = resolved_items;
      } else if (value.id) {
        // Single reference
        const item = await resolveReference(value, options);
        if (item) {
          resolved[fieldName] = await resolveReferences(item, depth - 1, options);
        }
      }
    }
  }

  return resolved;
}

// ============================================
// REVERSE REFERENCES
// ============================================

/**
 * Find all content that references a specific item
 *
 * @param {string} targetType - Type of referenced content
 * @param {string} targetId - ID of referenced content
 * @param {Object} options - Query options
 * @returns {Array} Array of { type, id, field } objects
 */
export async function findReferencesTo(targetType, targetId, options = {}) {
  const references = [];

  // Get all content types
  const types = contentModule.getTypes ? contentModule.getTypes() : [];

  for (const type of types) {
    const schema = contentModule.getSchema(type);
    if (!schema || !schema.fields) {
      continue;
    }

    // Find reference fields that target this type
    const refFields = [];
    for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
      if ((fieldDef.type === 'reference' || fieldDef.type === 'references') &&
          fieldDef.target === targetType) {
        refFields.push(fieldName);
      }
    }

    if (refFields.length === 0) {
      continue;
    }

    // Query all content of this type
    const items = await contentModule.query(type, {}, { limit: -1 });

    for (const item of items) {
      for (const fieldName of refFields) {
        const value = item[fieldName];

        if (!isReference(value)) {
          continue;
        }

        const ids = getReferencedIds(value);

        if (ids.includes(targetId)) {
          references.push({
            type: item.type,
            id: item.id,
            field: fieldName,
            content: options.includeContent ? item : undefined
          });
        }
      }
    }
  }

  return references;
}

// ============================================
// VALIDATION
// ============================================

/**
 * Validate that a reference points to existing content
 *
 * @param {Object} ref - Reference object
 * @returns {boolean} True if valid
 */
export async function validateReference(ref) {
  if (!isReference(ref)) {
    return false;
  }

  const { _ref: targetType, id, ids } = ref;

  if (!targetType) {
    return false;
  }

  // Validate single reference
  if (id) {
    try {
      const content = await contentModule.load(targetType, id);
      return !!content;
    } catch {
      return false;
    }
  }

  // Validate multi-value reference
  if (ids && Array.isArray(ids)) {
    for (const itemId of ids) {
      try {
        const content = await contentModule.load(targetType, itemId);
        if (!content) {
          return false;
        }
      } catch {
        return false;
      }
    }
    return true;
  }

  return false;
}

/**
 * Validate all references in content before save
 */
async function validateContentReferences(data) {
  const { type, content } = data;
  const schema = contentModule.getSchema(type);

  if (!schema || !schema.fields) {
    return;
  }

  const errors = [];

  for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
    if (fieldDef.type !== 'reference' && fieldDef.type !== 'references') {
      continue;
    }

    const value = content[fieldName];

    if (!value) {
      continue;
    }

    if (isReference(value)) {
      const isValid = await validateReference(value);
      if (!isValid) {
        errors.push(`Invalid reference in field '${fieldName}'`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Reference validation failed: ${errors.join(', ')}`);
  }
}

// ============================================
// CASCADE DELETION
// ============================================

/**
 * Handle cascade rules when content is deleted
 */
async function handleCascadeDelete(data) {
  const { type, id } = data;

  // Fire pre-delete hook
  await hooks.fire('reference:beforeDelete', { type, id });

  // Find all references to this content
  const references = await findReferencesTo(type, id);

  if (references.length === 0) {
    return;
  }

  // Group references by their cascade setting
  const restrict = [];
  const nullify = [];
  const cascade = [];

  for (const ref of references) {
    const schema = contentModule.getSchema(ref.type);
    const fieldDef = schema?.fields?.[ref.field];
    const cascadeRule = fieldDef?.cascade || 'restrict';

    if (cascadeRule === 'restrict') {
      restrict.push(ref);
    } else if (cascadeRule === 'nullify') {
      nullify.push(ref);
    } else if (cascadeRule === 'cascade') {
      cascade.push(ref);
    }
  }

  // Handle restrict: prevent deletion
  if (restrict.length > 0) {
    const list = restrict.map(r => `${r.type}:${r.id}`).join(', ');
    throw new Error(
      `Cannot delete ${type}:${id} - referenced by: ${list}. ` +
      `Delete those items first or change cascade setting.`
    );
  }

  // Handle nullify: clear the reference
  for (const ref of nullify) {
    const content = await contentModule.load(ref.type, ref.id);
    const value = content[ref.field];

    if (isReference(value)) {
      if (value.ids) {
        // Multi-value: remove this ID
        value.ids = value.ids.filter(refId => refId !== id);
      } else if (value.id === id) {
        // Single value: set to null
        content[ref.field] = null;
      }
    }

    await contentModule.update(ref.type, ref.id, content);
  }

  // Handle cascade: delete referencing content
  for (const ref of cascade) {
    await contentModule.delete(ref.type, ref.id);
  }
}

/**
 * Delete content with cascade rules applied
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 */
export async function deleteWithCascade(type, id) {
  return contentModule.delete(type, id);
}

// ============================================
// AUTOCOMPLETE SEARCH
// ============================================

/**
 * Search for referenceable content (for autocomplete)
 *
 * @param {string} targetType - Type to search
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {Array} Matching content items
 */
export async function searchReferenceable(targetType, query, options = {}) {
  const limit = options.limit || config.autocompleteLimit;

  // Get schema to find searchable fields
  const schema = contentModule.getSchema(targetType);
  const searchFields = options.searchFields || ['title', 'name', 'label'];

  // Build query filters
  const filters = {};

  if (query) {
    // Simple text matching (could be enhanced with search module)
    filters._search = query;
  }

  if (options.filters) {
    Object.assign(filters, options.filters);
  }

  // Query content
  const results = await contentModule.query(targetType, filters, {
    limit,
    sort: options.sort || { created: 'desc' }
  });

  // Format for autocomplete
  return results.map(item => ({
    value: item.id,
    label: item.title || item.name || item.label || item.id,
    type: item.type,
    _content: options.includeContent ? item : undefined
  }));
}

// ============================================
// CACHE MANAGEMENT
// ============================================

/**
 * Clear reference cache
 */
export function clearReferenceCache(type, id) {
  if (type && id) {
    refCache.delete(`${type}:${id}`);
  } else {
    refCache.clear();
  }
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  return {
    size: refCache.size,
    enabled: config.cacheResolvedRefs
  };
}

// ============================================
// FIELD REGISTRATION
// ============================================

/**
 * Register reference field types with fields module
 */
function registerReferenceFields(fields) {
  // Single reference field
  if (!fields.getFieldType('reference')) {
    fields.registerFieldType('reference', {
      render(value, field, content) {
        const refId = value?.id;
        if (!refId) {
          return '<em>No reference</em>';
        }

        const targetType = field.target || value._ref;
        return `
          <div class="reference-display" data-type="${targetType}" data-id="${refId}">
            <span class="reference-label">${targetType}:${refId}</span>
          </div>
        `;
      },

      widget(field, value, errors) {
        const targetType = field.target || 'content';
        const currentId = value?.id || '';

        return `
          <div class="reference-widget" data-target="${targetType}">
            <input type="hidden"
              name="${field.name}"
              value='${JSON.stringify(value || {})}'
              class="reference-value" />
            <input type="text"
              class="reference-autocomplete"
              placeholder="Search ${targetType}..."
              value="${currentId}"
              autocomplete="off" />
            <div class="reference-results"></div>
          </div>
        `;
      },

      parse(input) {
        try {
          const parsed = JSON.parse(input);
          if (isReference(parsed)) {
            return parsed;
          }
        } catch {}
        return null;
      },

      async validate(value, field) {
        if (field.required && !value?.id) {
          return 'This reference is required';
        }

        if (value && isReference(value)) {
          const isValid = await validateReference(value);
          if (!isValid) {
            return 'Referenced content does not exist';
          }
        }

        return null;
      }
    });
  }

  // Multi-value reference field
  if (!fields.getFieldType('references')) {
    fields.registerFieldType('references', {
      render(value, field, content) {
        const ids = value?.ids || [];
        if (ids.length === 0) {
          return '<em>No references</em>';
        }

        const targetType = field.target || value._ref;
        const items = ids.map(id =>
          `<li>${targetType}:${id}</li>`
        ).join('');

        return `<ul class="references-display">${items}</ul>`;
      },

      widget(field, value, errors) {
        const targetType = field.target || 'content';
        const currentIds = value?.ids || [];

        return `
          <div class="references-widget" data-target="${targetType}">
            <input type="hidden"
              name="${field.name}"
              value='${JSON.stringify(value || {})}'
              class="references-value" />
            <div class="references-selected">
              ${currentIds.map(id => `
                <span class="reference-tag" data-id="${id}">
                  ${id}
                  <button type="button" class="remove-reference">×</button>
                </span>
              `).join('')}
            </div>
            <input type="text"
              class="references-autocomplete"
              placeholder="Add ${targetType}..."
              autocomplete="off" />
            <div class="references-results"></div>
          </div>
        `;
      },

      parse(input) {
        try {
          const parsed = JSON.parse(input);
          if (isReference(parsed)) {
            return parsed;
          }
        } catch {}
        return { ids: [] };
      },

      async validate(value, field) {
        const ids = value?.ids || [];

        if (field.required && ids.length === 0) {
          return 'At least one reference is required';
        }

        if (value && isReference(value)) {
          const isValid = await validateReference(value);
          if (!isValid) {
            return 'One or more referenced items do not exist';
          }
        }

        return null;
      }
    });
  }
}

// ============================================
// HOOKS
// ============================================

// Register validation hook
hooks.register('content:beforeCreate', validateContentReferences);
hooks.register('content:beforeUpdate', validateContentReferences);

// ============================================
// EXPORTS
// ============================================

export default {
  init,
  getConfig,
  createReference,
  isReference,
  getReferencedIds,
  resolveReference,
  resolveReferences,
  findReferencesTo,
  validateReference,
  deleteWithCascade,
  searchReferenceable,
  clearReferenceCache,
  getCacheStats
};
