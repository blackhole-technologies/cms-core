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

import * as hooks from '../../../core/hooks.ts';

// ============================================
// TYPE DEFINITIONS
// ============================================

/** A single entity reference */
export interface SingleReference {
  _ref: string;
  id: string;
}

/** A multi-value entity reference */
export interface MultiReference {
  _ref: string;
  ids: string[];
}

/** Either type of reference */
export type ReferenceValue = SingleReference | MultiReference;

/** Configuration for the entity reference system */
export interface ReferenceConfig {
  cacheResolvedRefs: boolean;
  maxDepth: number;
  autocompleteLimit: number;
}

/** A reverse reference hit */
export interface ReverseReference {
  type: string;
  id: string;
  field: string;
  content?: Record<string, unknown>;
}

/** Autocomplete result entry */
export interface AutocompleteResult {
  value: string;
  label: string;
  type: string;
  _content?: Record<string, unknown>;
}

/** Content module interface — the subset used by entity-reference */
interface ContentModuleRef {
  load: (
    type: string,
    id: string,
    opts?: Record<string, unknown>
  ) => Promise<Record<string, unknown> | null>;
  getSchema: (type: string) => { fields?: Record<string, Record<string, unknown>> } | null;
  getTypes?: () => string[];
  query: (
    type: string,
    filters: Record<string, unknown>,
    opts?: Record<string, unknown>
  ) => Promise<Record<string, unknown>[]>;
  update: (
    type: string,
    id: string,
    data: Record<string, unknown>
  ) => Promise<Record<string, unknown>>;
  delete: (type: string, id: string) => Promise<boolean>;
  [key: string]: unknown;
}

/** Fields module interface — the subset used by entity-reference */
interface FieldsModuleRef {
  registerFieldType: (name: string, def: Record<string, unknown>) => void;
  getFieldType: (name: string) => Record<string, unknown> | null;
  [key: string]: unknown;
}

// ============================================
// MODULE STATE
// ============================================

let contentModule: ContentModuleRef | null = null;
let fieldsModule: FieldsModuleRef | null = null;
let config: ReferenceConfig = {
  cacheResolvedRefs: true,
  maxDepth: 3,
  autocompleteLimit: 25,
};

// Resolved reference cache: { "type:id": resolvedValue }
const refCache: Map<string, Record<string, unknown>> = new Map();

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
export function init(
  content: ContentModuleRef,
  fields: FieldsModuleRef | null,
  cfg: Partial<ReferenceConfig> = {}
): void {
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
export function getConfig(): ReferenceConfig {
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
export function createReference(
  targetType: string,
  targetId: string | string[]
): ReferenceValue | null {
  if (!targetType) {
    throw new Error('Reference target type is required');
  }

  if (Array.isArray(targetId)) {
    // Multi-value reference
    const validIds = targetId.filter((id) => id != null && id !== '');
    return {
      _ref: targetType,
      ids: validIds,
    };
  } else {
    // Single reference
    if (!targetId) {
      return null;
    }
    return {
      _ref: targetType,
      id: targetId,
    };
  }
}

/**
 * Check if value is a reference object
 */
export function isReference(value: unknown): value is ReferenceValue {
  return (
    value !== null && typeof value === 'object' && '_ref' in (value as Record<string, unknown>)
  );
}

/**
 * Get referenced IDs from a reference value
 */
export function getReferencedIds(value: unknown): string[] {
  if (!isReference(value)) {
    return [];
  }

  if ('ids' in value && Array.isArray((value as MultiReference).ids)) {
    return [...(value as MultiReference).ids];
  } else if ('id' in value && (value as SingleReference).id) {
    return [(value as SingleReference).id];
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
export async function resolveReference(
  ref: unknown,
  options: Record<string, unknown> = {}
): Promise<Record<string, unknown> | null> {
  if (!isReference(ref)) {
    return (ref as Record<string, unknown>) ?? null;
  }

  const { _ref: targetType, id } = ref as SingleReference;

  if (!id) {
    return null;
  }

  // Check cache
  const cacheKey = `${targetType}:${id}`;
  if (config.cacheResolvedRefs && refCache.has(cacheKey)) {
    return refCache.get(cacheKey) ?? null;
  }

  try {
    // Fire pre-resolve hook
    await hooks.trigger('reference:beforeResolve', { targetType, id, options });

    // Load content
    const content = await contentModule!.load(targetType, id, options);

    // Cache result
    if (config.cacheResolvedRefs && content) {
      refCache.set(cacheKey, content);
    }

    // Fire post-resolve hook
    await hooks.trigger('reference:afterResolve', { targetType, id, content });

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
export async function resolveReferences(
  content: Record<string, unknown>,
  depth: number = 1,
  options: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  if (!content || depth <= 0 || depth > config.maxDepth) {
    return content;
  }

  const type = content.type as string;
  const schema = contentModule!.getSchema(type);

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
      if ('ids' in value && Array.isArray((value as MultiReference).ids)) {
        // Multi-value reference
        const resolved_items: Record<string, unknown>[] = [];
        for (const id of (value as MultiReference).ids) {
          const ref = createReference(value._ref, id);
          const item = await resolveReference(ref, options);
          if (item) {
            // Recursively resolve nested references
            const nested = await resolveReferences(item, depth - 1, options);
            resolved_items.push(nested);
          }
        }
        resolved[fieldName] = resolved_items;
      } else if ('id' in value && (value as SingleReference).id) {
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
export async function findReferencesTo(
  targetType: string,
  targetId: string,
  options: Record<string, unknown> = {}
): Promise<ReverseReference[]> {
  const references: ReverseReference[] = [];

  // Get all content types
  const types = contentModule!.getTypes ? contentModule!.getTypes() : [];

  for (const type of types) {
    const schema = contentModule!.getSchema(type);
    if (!schema || !schema.fields) {
      continue;
    }

    // Find reference fields that target this type
    const refFields = [];
    for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
      if (
        (fieldDef.type === 'reference' || fieldDef.type === 'references') &&
        fieldDef.target === targetType
      ) {
        refFields.push(fieldName);
      }
    }

    if (refFields.length === 0) {
      continue;
    }

    // Query all content of this type
    const items = await contentModule!.query(type, {}, { limit: -1 });

    for (const item of items) {
      for (const fieldName of refFields) {
        const value = item[fieldName];

        if (!isReference(value)) {
          continue;
        }

        const ids = getReferencedIds(value);

        if (ids.includes(targetId)) {
          references.push({
            type: item.type as string,
            id: item.id as string,
            field: fieldName,
            content: options.includeContent ? item : undefined,
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
export async function validateReference(ref: unknown): Promise<boolean> {
  if (!isReference(ref)) {
    return false;
  }

  const refObj = ref as ReferenceValue;
  const targetType = refObj._ref;
  const id = 'id' in refObj ? (refObj as SingleReference).id : undefined;
  const ids = 'ids' in refObj ? (refObj as MultiReference).ids : undefined;

  if (!targetType) {
    return false;
  }

  // Validate single reference
  if (id) {
    try {
      const content = await contentModule!.load(targetType, id);
      return !!content;
    } catch {
      return false;
    }
  }

  // Validate multi-value reference
  if (ids && Array.isArray(ids)) {
    for (const itemId of ids) {
      try {
        const content = await contentModule!.load(targetType, itemId);
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
async function validateContentReferences(data: Record<string, unknown>): Promise<void> {
  const { type, content } = data as { type: string; content: Record<string, unknown> };
  const schema = contentModule!.getSchema(type);

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
async function handleCascadeDelete(data: Record<string, unknown>): Promise<void> {
  const { type, id } = data as { type: string; id: string };

  // Fire pre-delete hook
  await hooks.trigger('reference:beforeDelete', { type, id });

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
    const schema = contentModule!.getSchema(ref.type);
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
    const list = restrict.map((r) => `${r.type}:${r.id}`).join(', ');
    throw new Error(
      `Cannot delete ${type}:${id} - referenced by: ${list}. ` +
        `Delete those items first or change cascade setting.`
    );
  }

  // Handle nullify: clear the reference
  for (const ref of nullify) {
    const content = await contentModule!.load(ref.type, ref.id);
    if (!content) continue;
    const value = content[ref.field];

    if (isReference(value)) {
      if ('ids' in value && Array.isArray((value as MultiReference).ids)) {
        // Multi-value: remove this ID
        (value as MultiReference).ids = (value as MultiReference).ids.filter(
          (refId: string) => refId !== id
        );
      } else if ('id' in value && (value as SingleReference).id === id) {
        // Single value: set to null
        content[ref.field] = null;
      }
    }

    await contentModule!.update(ref.type, ref.id, content);
  }

  // Handle cascade: delete referencing content
  for (const ref of cascade) {
    await contentModule!.delete(ref.type, ref.id);
  }
}

/**
 * Delete content with cascade rules applied
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 */
export async function deleteWithCascade(type: string, id: string): Promise<boolean> {
  return contentModule!.delete(type, id);
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
export async function searchReferenceable(
  targetType: string,
  query: string,
  options: Record<string, unknown> = {}
): Promise<AutocompleteResult[]> {
  const limit = (options.limit as number) || config.autocompleteLimit;

  // Get schema to find searchable fields
  const schema = contentModule!.getSchema(targetType);
  const searchFields = (options.searchFields as string[]) || ['title', 'name', 'label'];

  // Build query filters
  const filters: Record<string, unknown> = {};

  if (query) {
    // Simple text matching (could be enhanced with search module)
    filters._search = query;
  }

  if (options.filters) {
    Object.assign(filters, options.filters);
  }

  // Query content
  const results = await contentModule!.query(targetType, filters, {
    limit,
    sort: options.sort || { created: 'desc' },
  });

  // Format for autocomplete
  return results.map((item) => ({
    value: item.id as string,
    label: (item.title || item.name || item.label || item.id) as string,
    type: item.type as string,
    _content: options.includeContent ? item : undefined,
  }));
}

// ============================================
// CACHE MANAGEMENT
// ============================================

/**
 * Clear reference cache
 */
export function clearReferenceCache(type?: string | Record<string, unknown>, id?: string): void {
  if (typeof type === 'string' && id) {
    refCache.delete(`${type}:${id}`);
  } else {
    refCache.clear();
  }
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { size: number; enabled: boolean } {
  return {
    size: refCache.size,
    enabled: config.cacheResolvedRefs,
  };
}

// ============================================
// FIELD REGISTRATION
// ============================================

/**
 * Register reference field types with fields module
 */
function registerReferenceFields(fields: FieldsModuleRef): void {
  // Single reference field
  if (!fields.getFieldType('reference')) {
    fields.registerFieldType('reference', {
      render(
        value: Record<string, unknown> | null,
        field: Record<string, unknown>,
        content: Record<string, unknown>
      ) {
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

      widget(
        field: Record<string, unknown>,
        value: Record<string, unknown> | null,
        errors: string[]
      ) {
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

      parse(input: string) {
        try {
          const parsed = JSON.parse(input);
          if (isReference(parsed)) {
            return parsed;
          }
        } catch {}
        return null;
      },

      async validate(value: Record<string, unknown> | null, field: Record<string, unknown>) {
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
      },
    });
  }

  // Multi-value reference field
  if (!fields.getFieldType('references')) {
    fields.registerFieldType('references', {
      render(
        value: Record<string, unknown> | null,
        field: Record<string, unknown>,
        content: Record<string, unknown>
      ) {
        const ids = (value?.ids || []) as string[];
        if (ids.length === 0) {
          return '<em>No references</em>';
        }

        const targetType = field.target || value?._ref;
        const items = ids.map((id: string) => `<li>${targetType}:${id}</li>`).join('');

        return `<ul class="references-display">${items}</ul>`;
      },

      widget(
        field: Record<string, unknown>,
        value: Record<string, unknown> | null,
        errors: string[]
      ) {
        const targetType = field.target || 'content';
        const currentIds = (value?.ids || []) as string[];

        return `
          <div class="references-widget" data-target="${targetType}">
            <input type="hidden"
              name="${field.name}"
              value='${JSON.stringify(value || {})}'
              class="references-value" />
            <div class="references-selected">
              ${currentIds
                .map(
                  (id: string) => `
                <span class="reference-tag" data-id="${id}">
                  ${id}
                  <button type="button" class="remove-reference">×</button>
                </span>
              `
                )
                .join('')}
            </div>
            <input type="text"
              class="references-autocomplete"
              placeholder="Add ${targetType}..."
              autocomplete="off" />
            <div class="references-results"></div>
          </div>
        `;
      },

      parse(input: string) {
        try {
          const parsed = JSON.parse(input);
          if (isReference(parsed)) {
            return parsed;
          }
        } catch {}
        return { ids: [] };
      },

      async validate(value: Record<string, unknown> | null, field: Record<string, unknown>) {
        const ids = (value?.ids || []) as string[];

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
      },
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
  getCacheStats,
};
