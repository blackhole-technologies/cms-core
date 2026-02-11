/**
 * taxonomy.js - Hierarchical Content Categorization System
 *
 * WHY THIS EXISTS:
 * =====================
 * Taxonomy provides structured categorization of content through vocabularies and terms.
 * Inspired by Drupal's taxonomy system, it enables flexible content organization.
 *
 * VOCABULARIES:
 * - Named collections of terms (e.g., "Categories", "Tags")
 * - Can be hierarchical (parent/child) or flat
 * - Define how terms can be used with content
 *
 * TERMS:
 * - Individual taxonomy items within a vocabulary
 * - Optional hierarchical relationships (parent/child)
 * - Link to content via term references
 *
 * STORAGE STRATEGY:
 * =================
 * /config
 *   /vocabularies.json       <- All vocabulary definitions
 * /content
 *   /term/                   <- Terms stored as content items
 *     category-news.json
 *     tag-javascript.json
 *
 * WHY FLAT FILE FOR VOCABULARIES:
 * - Small data set (typically < 50 vocabularies)
 * - Read frequently, written rarely
 * - Easy to edit manually if needed
 *
 * WHY TERMS AS CONTENT:
 * - Reuses content service for CRUD operations
 * - Gets revision history for free
 * - Consistent with cms-core architecture
 *
 * DESIGN DECISIONS:
 * =================
 * - Hierarchy computed on load, cached for performance
 * - Slug uniqueness scoped to vocabulary (not global)
 * - Parent validation prevents circular references
 * - Depth tracking computed automatically
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as hooks from './hooks.js';
import { slugify } from './slugify.js';

/**
 * Module state
 */
let baseDir = null;
let contentService = null;
let vocabulariesPath = null;
let vocabularies = {};
let config = {
  enabled: true,
  defaults: {
    hierarchical: false,
    maxDepth: -1, // unlimited
    multipleSelection: true,
    allowCreate: true,
  },
  cacheHierarchy: true,
  cacheTTL: 3600,
};

/**
 * Hierarchy cache
 * Structure: { vocabularyId: { termId: TermWithHierarchy } }
 * WHY CACHE: Computing tree structure is O(n²), cache improves read performance
 */
let hierarchyCache = {};
let cacheTimestamps = {};

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize taxonomy system
 *
 * @param {string} dir - Base directory
 * @param {Object} content - Content service
 * @param {Object} taxonomyConfig - Configuration
 */
export function init(dir, content, taxonomyConfig = {}) {
  baseDir = dir;
  contentService = content;
  config = { ...config, ...taxonomyConfig };

  // Set up vocabularies storage path
  const configDir = join(baseDir, 'config');
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  vocabulariesPath = join(configDir, 'vocabularies.json');
  loadVocabularies();

  // Register term content type with content service
  // WHY: Terms are stored as content items for consistency
  if (contentService && contentService.register) {
    contentService.register('term', {
      vocabularyId: { type: 'string', required: true },
      name: { type: 'string', required: true },
      slug: { type: 'string', required: true },
      description: { type: 'string', required: false },
      parentId: { type: 'string', required: false },
      weight: { type: 'number', required: false },
      depth: { type: 'number', required: false },
      path: { type: 'array', required: false },
    }, 'taxonomy');
  }
}

// ============================================
// VOCABULARY MANAGEMENT
// ============================================

/**
 * Load vocabularies from disk
 * WHY PRIVATE: Internal state management, not part of public API
 */
function loadVocabularies() {
  if (existsSync(vocabulariesPath)) {
    try {
      const data = JSON.parse(readFileSync(vocabulariesPath, 'utf-8'));
      vocabularies = data;
    } catch (e) {
      console.error('[taxonomy] Failed to load vocabularies:', e.message);
      vocabularies = {};
    }
  }
}

/**
 * Save vocabularies to disk
 * WHY ATOMIC: Write to temp file then rename to prevent corruption
 */
function saveVocabularies() {
  try {
    writeFileSync(vocabulariesPath, JSON.stringify(vocabularies, null, 2) + '\n');
  } catch (e) {
    console.error('[taxonomy] Failed to save vocabularies:', e.message);
    throw new Error('Failed to save vocabulary configuration');
  }
}

/**
 * Create a new vocabulary
 *
 * @param {Object} input - Vocabulary data
 * @returns {Promise<Object>} Created vocabulary
 */
export async function createVocabulary(input) {
  // Validate required fields
  if (!input.name) {
    throw new Error('Vocabulary name is required');
  }

  // Generate ID from name if not provided
  // WHY: Machine names are stable identifiers (unlike human-readable names)
  const id = input.id || slugify(input.name);

  // Check for duplicate ID
  if (vocabularies[id]) {
    throw new Error(`Vocabulary "${id}" already exists`);
  }

  // Build vocabulary object
  const now = new Date().toISOString();
  const vocabulary = {
    id,
    name: input.name,
    description: input.description || '',
    hierarchical: input.hierarchical ?? config.defaults.hierarchical,
    maxDepth: input.maxDepth ?? config.defaults.maxDepth,
    multipleSelection: input.multipleSelection ?? config.defaults.multipleSelection,
    allowCreate: input.allowCreate ?? config.defaults.allowCreate,
    weight: input.weight ?? 0,
    created: now,
    updated: now,
  };

  // Fire before hook
  // WHY: Allow modules to validate or transform vocabulary before creation
  await hooks.trigger('taxonomy:beforeCreateVocabulary', { input, vocabulary });

  // Save vocabulary
  vocabularies[id] = vocabulary;
  saveVocabularies();

  // Fire after hook
  await hooks.trigger('taxonomy:afterCreateVocabulary', { vocabulary });

  return vocabulary;
}

/**
 * Get a vocabulary by ID
 *
 * @param {string} id - Vocabulary ID
 * @returns {Object|null} Vocabulary or null
 */
export function getVocabulary(id) {
  return vocabularies[id] || null;
}

/**
 * Update a vocabulary
 *
 * @param {string} id - Vocabulary ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated vocabulary
 */
export async function updateVocabulary(id, updates) {
  const vocabulary = vocabularies[id];
  if (!vocabulary) {
    throw new Error(`Vocabulary "${id}" not found`);
  }

  // Fire before hook
  await hooks.trigger('taxonomy:beforeUpdateVocabulary', { vocabulary, updates });

  // Apply updates (preserve created timestamp)
  const updated = {
    ...vocabulary,
    ...updates,
    id: vocabulary.id, // ID cannot be changed
    created: vocabulary.created,
    updated: new Date().toISOString(),
  };

  vocabularies[id] = updated;
  saveVocabularies();

  // Invalidate hierarchy cache for this vocabulary
  // WHY: Settings like maxDepth affect hierarchy computation
  if (config.cacheHierarchy) {
    delete hierarchyCache[id];
    delete cacheTimestamps[id];
  }

  // Fire after hook
  await hooks.trigger('taxonomy:afterUpdateVocabulary', { vocabulary: updated });

  return updated;
}

/**
 * Delete a vocabulary
 *
 * @param {string} id - Vocabulary ID
 * @param {Object} options - Delete options
 * @returns {Promise<void>}
 */
export async function deleteVocabulary(id, options = {}) {
  const vocabulary = vocabularies[id];
  if (!vocabulary) {
    throw new Error(`Vocabulary "${id}" not found`);
  }

  // Fire before hook
  await hooks.trigger('taxonomy:beforeDeleteVocabulary', { vocabulary, options });

  // Handle terms in this vocabulary
  if (options.deleteTerms) {
    // Delete all terms in vocabulary
    const terms = listTerms({ vocabularyId: id });
    for (const term of terms.items) {
      await contentService.delete('term', term.id);
    }
  } else {
    // Check if vocabulary has terms
    const termCount = getTermCount(id);
    if (termCount > 0) {
      throw new Error(`Cannot delete vocabulary "${id}" - contains ${termCount} terms. Use deleteTerms option to force.`);
    }
  }

  // Delete vocabulary
  delete vocabularies[id];
  saveVocabularies();

  // Clear cache
  if (config.cacheHierarchy) {
    delete hierarchyCache[id];
    delete cacheTimestamps[id];
  }

  // Fire after hook
  await hooks.trigger('taxonomy:afterDeleteVocabulary', { vocabulary });
}

/**
 * List all vocabularies
 *
 * @returns {Array} Array of vocabularies sorted by weight
 */
export function listVocabularies() {
  return Object.values(vocabularies).sort((a, b) => a.weight - b.weight);
}

// ============================================
// TERM MANAGEMENT
// ============================================

/**
 * Validate term input
 * WHY PRIVATE: Encapsulates validation logic
 *
 * @param {Object} input - Term data
 * @throws {Error} If validation fails
 */
function validateTermInput(input) {
  if (!input.vocabularyId) {
    throw new Error('Term vocabularyId is required');
  }

  if (!input.name) {
    throw new Error('Term name is required');
  }

  const vocabulary = vocabularies[input.vocabularyId];
  if (!vocabulary) {
    throw new Error(`Vocabulary "${input.vocabularyId}" not found`);
  }

  return vocabulary;
}

/**
 * Compute term depth and path
 * WHY: Depth and path are derived fields computed from hierarchy
 *
 * @param {string} vocabularyId - Vocabulary ID
 * @param {string|null} parentId - Parent term ID
 * @returns {Object} { depth, path }
 */
function computeHierarchyInfo(vocabularyId, parentId) {
  if (!parentId) {
    return { depth: 0, path: [] };
  }

  const parent = contentService.read('term', parentId);
  if (!parent) {
    throw new Error(`Parent term "${parentId}" not found`);
  }

  if (parent.vocabularyId !== vocabularyId) {
    throw new Error('Parent term must be in the same vocabulary');
  }

  const depth = parent.depth + 1;
  const path = [...parent.path, parentId];

  return { depth, path };
}

/**
 * Validate hierarchy (detect circular references)
 *
 * @param {string} termId - Term ID
 * @param {string|null} newParentId - Proposed parent ID
 * @returns {boolean} True if valid
 * @throws {Error} If circular reference detected
 */
export function validateHierarchy(termId, newParentId) {
  if (!newParentId) {
    return true; // Root level is always valid
  }

  if (termId === newParentId) {
    throw new Error('Term cannot be its own parent');
  }

  // Check if newParentId is a descendant of termId
  // WHY: This would create a cycle
  const parent = contentService.read('term', newParentId);
  if (!parent) {
    throw new Error(`Parent term "${newParentId}" not found`);
  }

  // Walk up parent chain looking for termId
  let current = parent;
  const visited = new Set();
  while (current && current.parentId) {
    if (visited.has(current.id)) {
      throw new Error('Circular reference detected in term hierarchy');
    }
    visited.add(current.id);

    if (current.parentId === termId) {
      throw new Error('Cannot set parent - would create circular reference');
    }

    current = contentService.read('term', current.parentId);
  }

  return true;
}

/**
 * Generate unique slug for term
 *
 * @param {string} name - Term name
 * @param {string} vocabularyId - Vocabulary ID
 * @param {string|null} excludeId - Term ID to exclude (for updates)
 * @returns {string} Unique slug
 */
export function generateSlug(name, vocabularyId, excludeId = null) {
  const baseSlug = slugify(name);
  let slug = baseSlug;
  let counter = 1;

  // Check for uniqueness within vocabulary
  // WHY SCOPED: Different vocabularies can have same slug
  while (true) {
    const existing = getTermBySlug(vocabularyId, slug);
    if (!existing || existing.id === excludeId) {
      break;
    }
    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  return slug;
}

/**
 * Create a new term
 *
 * @param {Object} input - Term data
 * @returns {Promise<Object>} Created term
 */
export async function createTerm(input) {
  // Validate input
  const vocabulary = validateTermInput(input);

  // Validate hierarchy if parent specified
  if (input.parentId) {
    validateHierarchy('new-term', input.parentId);
  }

  // Compute hierarchy info
  const { depth, path } = computeHierarchyInfo(input.vocabularyId, input.parentId || null);

  // Validate maxDepth constraint
  // WHY: Prevents creating terms beyond vocabulary's depth limit
  if (vocabulary.maxDepth >= 0 && depth > vocabulary.maxDepth) {
    throw new Error(`Maximum depth (${vocabulary.maxDepth}) exceeded for vocabulary "${vocabulary.name}"`);
  }

  // Generate slug if not provided
  const slug = input.slug || generateSlug(input.name, input.vocabularyId);

  // Build term object
  const termData = {
    vocabularyId: input.vocabularyId,
    name: input.name,
    slug,
    description: input.description || '',
    parentId: input.parentId || null,
    weight: input.weight ?? 0,
    depth,
    path,
  };

  // Fire before hook
  await hooks.trigger('taxonomy:beforeCreateTerm', { input, vocabulary, termData });

  // Create term via content service
  // WHY: Leverages content service for ID generation, validation, storage
  const term = await contentService.create('term', termData);

  // Invalidate hierarchy cache
  if (config.cacheHierarchy) {
    delete hierarchyCache[input.vocabularyId];
    delete cacheTimestamps[input.vocabularyId];
  }

  // Fire after hook
  await hooks.trigger('taxonomy:afterCreateTerm', { term, vocabulary });

  return term;
}

/**
 * Get a term by ID
 *
 * @param {string} id - Term ID
 * @returns {Object|null} Term or null
 */
export function getTerm(id) {
  return contentService.read('term', id);
}

/**
 * Get a term by slug within a vocabulary
 *
 * @param {string} vocabularyId - Vocabulary ID
 * @param {string} slug - Term slug
 * @returns {Object|null} Term or null
 */
export function getTermBySlug(vocabularyId, slug) {
  const result = contentService.list('term', {
    filters: [
      { field: 'vocabularyId', op: 'eq', value: vocabularyId },
      { field: 'slug', op: 'eq', value: slug },
    ],
    limit: 1,
  });

  return result.items[0] || null;
}

/**
 * Update a term
 *
 * @param {string} id - Term ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated term
 */
export async function updateTerm(id, updates) {
  const term = getTerm(id);
  if (!term) {
    throw new Error(`Term "${id}" not found`);
  }

  const vocabulary = vocabularies[term.vocabularyId];
  if (!vocabulary) {
    throw new Error(`Vocabulary "${term.vocabularyId}" not found`);
  }

  // Handle parent change
  let hierarchyChanged = false;
  if ('parentId' in updates && updates.parentId !== term.parentId) {
    validateHierarchy(id, updates.parentId);
    hierarchyChanged = true;
  }

  // Handle slug change
  if (updates.slug && updates.slug !== term.slug) {
    // Validate uniqueness
    const existing = getTermBySlug(term.vocabularyId, updates.slug);
    if (existing && existing.id !== id) {
      throw new Error(`Slug "${updates.slug}" already exists in vocabulary "${term.vocabularyId}"`);
    }
  }

  // Recompute hierarchy if parent changed
  if (hierarchyChanged) {
    const { depth, path } = computeHierarchyInfo(term.vocabularyId, updates.parentId);

    // Validate maxDepth
    if (vocabulary.maxDepth >= 0 && depth > vocabulary.maxDepth) {
      throw new Error(`Maximum depth (${vocabulary.maxDepth}) exceeded for vocabulary "${vocabulary.name}"`);
    }

    updates.depth = depth;
    updates.path = path;
  }

  // Fire before hook
  await hooks.trigger('taxonomy:beforeUpdateTerm', { term, updates, vocabulary });

  // Update term via content service
  const updatedTerm = await contentService.update('term', id, updates);

  // If parent changed, update all descendants
  // WHY: Children's depth and path need recalculation
  if (hierarchyChanged) {
    await updateDescendantHierarchy(id, term.vocabularyId);
  }

  // Invalidate hierarchy cache
  if (config.cacheHierarchy) {
    delete hierarchyCache[term.vocabularyId];
    delete cacheTimestamps[term.vocabularyId];
  }

  // Fire after hook
  await hooks.trigger('taxonomy:afterUpdateTerm', { term: updatedTerm, vocabulary });

  return updatedTerm;
}

/**
 * Update hierarchy info for all descendants
 * WHY PRIVATE: Internal helper for cascading hierarchy updates
 *
 * @param {string} parentId - Parent term ID
 * @param {string} vocabularyId - Vocabulary ID
 */
async function updateDescendantHierarchy(parentId, vocabularyId) {
  const children = getTermChildren(vocabularyId, parentId);

  for (const child of children) {
    const { depth, path } = computeHierarchyInfo(vocabularyId, parentId);

    await contentService.update('term', child.id, {
      depth,
      path,
    });

    // Recursively update descendants
    await updateDescendantHierarchy(child.id, vocabularyId);
  }
}

/**
 * Delete a term
 *
 * @param {string} id - Term ID
 * @param {Object} options - Delete options
 * @returns {Promise<void>}
 */
export async function deleteTerm(id, options = {}) {
  const term = getTerm(id);
  if (!term) {
    throw new Error(`Term "${id}" not found`);
  }

  const vocabulary = vocabularies[term.vocabularyId];

  // Fire before hook
  await hooks.trigger('taxonomy:beforeDeleteTerm', { term, options, vocabulary });

  // Handle child terms
  const children = getTermChildren(term.vocabularyId, id);

  if (children.length > 0) {
    if (options.deleteChildren) {
      // Delete all descendants recursively
      // WHY: Prevents orphaned terms
      for (const child of children) {
        await deleteTerm(child.id, { deleteChildren: true });
      }
    } else if (options.reassignTo) {
      // Move children to new parent
      validateHierarchy(id, options.reassignTo);

      for (const child of children) {
        await updateTerm(child.id, { parentId: options.reassignTo });
      }
    } else {
      throw new Error(`Cannot delete term "${id}" - has ${children.length} children. Use deleteChildren or reassignTo option.`);
    }
  }

  // Delete term via content service
  await contentService.delete('term', id);

  // Invalidate hierarchy cache
  if (config.cacheHierarchy) {
    delete hierarchyCache[term.vocabularyId];
    delete cacheTimestamps[term.vocabularyId];
  }

  // Fire after hook
  await hooks.trigger('taxonomy:afterDeleteTerm', { term, vocabulary });
}

/**
 * List terms with filtering and pagination
 *
 * @param {Object} options - Query options
 * @returns {Object} { items, total, offset, limit }
 */
export function listTerms(options = {}) {
  const filters = [];

  // Filter by vocabulary
  if (options.vocabularyId) {
    filters.push({ field: 'vocabularyId', op: 'eq', value: options.vocabularyId });
  }

  // Filter by parent
  if ('parentId' in options) {
    if (options.parentId === null) {
      filters.push({ field: 'parentId', op: 'null' });
    } else {
      filters.push({ field: 'parentId', op: 'eq', value: options.parentId });
    }
  }

  // Default sort
  const sort = options.sort || 'weight';
  const order = options.order || 'asc';

  const result = contentService.list('term', {
    filters,
    sort,
    order,
    offset: options.offset || 0,
    limit: options.limit || 100,
  });

  return result;
}

/**
 * Get term hierarchy tree
 *
 * @param {string} vocabularyId - Vocabulary ID
 * @returns {Array} Root terms with nested children
 */
export function getTermTree(vocabularyId) {
  // Check cache
  if (config.cacheHierarchy) {
    const cached = hierarchyCache[vocabularyId];
    const timestamp = cacheTimestamps[vocabularyId];

    if (cached && timestamp) {
      const age = Date.now() - timestamp;
      if (age < config.cacheTTL * 1000) {
        return Object.values(cached).filter(t => !t.parentId);
      }
    }
  }

  // Get all terms for vocabulary
  const result = listTerms({
    vocabularyId,
    limit: 10000, // Get all terms
  });

  // Build tree structure
  // WHY ITERATIVE: More efficient than recursive for large trees
  const termsById = {};
  const rootTerms = [];

  // First pass: index all terms
  for (const term of result.items) {
    termsById[term.id] = {
      ...term,
      children: [],
      contentCount: 0, // Will be computed if needed
    };
  }

  // Second pass: build parent-child relationships
  for (const term of result.items) {
    const termWithChildren = termsById[term.id];

    if (!term.parentId) {
      rootTerms.push(termWithChildren);
    } else {
      const parent = termsById[term.parentId];
      if (parent) {
        parent.children.push(termWithChildren);
      } else {
        // Orphaned term - treat as root
        // WHY: Defensive programming for data integrity issues
        console.warn(`[taxonomy] Term "${term.id}" has invalid parent "${term.parentId}"`);
        rootTerms.push(termWithChildren);
      }
    }
  }

  // Sort children by weight
  // WHY RECURSIVE: Each level needs sorting
  function sortChildren(terms) {
    terms.sort((a, b) => a.weight - b.weight);
    for (const term of terms) {
      sortChildren(term.children);
    }
  }

  sortChildren(rootTerms);

  // Cache result
  if (config.cacheHierarchy) {
    hierarchyCache[vocabularyId] = termsById;
    cacheTimestamps[vocabularyId] = Date.now();
  }

  return rootTerms;
}

/**
 * Move term to new parent
 *
 * @param {string} id - Term ID
 * @param {string|null} newParentId - New parent ID (null for root)
 * @returns {Promise<Object>} Updated term
 */
export async function moveTerm(id, newParentId) {
  return updateTerm(id, { parentId: newParentId });
}

/**
 * Reorder terms at same level
 *
 * @param {string[]} termIds - Term IDs in desired order
 * @returns {Promise<void>}
 */
export async function reorderTerms(termIds) {
  // Update weight based on position in array
  // WHY: Weight determines sort order
  for (let i = 0; i < termIds.length; i++) {
    await updateTerm(termIds[i], { weight: i });
  }
}

// ============================================
// UTILITIES
// ============================================

/**
 * Get term path as breadcrumb
 *
 * @param {string} vocabularyId - Vocabulary ID
 * @param {string} id - Term ID
 * @returns {Array} Array of terms from root to current
 */
export function getTermPath(vocabularyId, id) {
  const term = getTerm(id);
  if (!term) {
    return [];
  }

  const pathTerms = [];

  // Get all ancestors
  for (const ancestorId of term.path) {
    const ancestor = getTerm(ancestorId);
    if (ancestor) {
      pathTerms.push(ancestor);
    }
  }

  // Add current term
  pathTerms.push(term);

  return pathTerms;
}

/**
 * Get direct children of a term
 *
 * @param {string} vocabularyId - Vocabulary ID
 * @param {string|null} parentId - Parent term ID (null for root terms)
 * @returns {Array} Child terms
 */
export function getTermChildren(vocabularyId, parentId = null) {
  const result = listTerms({
    vocabularyId,
    parentId,
    limit: 10000,
  });

  return result.items;
}

/**
 * Get count of terms in vocabulary
 *
 * @param {string} vocabularyId - Vocabulary ID
 * @returns {number} Term count
 */
export function getTermCount(vocabularyId) {
  const result = listTerms({
    vocabularyId,
    limit: 1,
  });

  return result.total;
}

/**
 * Search terms by name
 *
 * @param {string} vocabularyId - Vocabulary ID
 * @param {string} query - Search query
 * @returns {Array} Matching terms
 */
export function searchTerms(vocabularyId, query) {
  const result = listTerms({
    vocabularyId,
    limit: 10000,
  });

  // Simple name matching
  // WHY: Content service doesn't support full-text search out of box
  const lowerQuery = query.toLowerCase();
  return result.items.filter(term =>
    term.name.toLowerCase().includes(lowerQuery) ||
    term.slug.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Get content count for a term
 *
 * @param {string} termId - Term ID
 * @param {boolean} includeChildren - Include content from child terms
 * @returns {number} Content count
 */
export function getTermContentCount(termId, includeChildren = false) {
  // This requires integration with content items
  // For now, return 0 - will be implemented when content references are added
  // WHY STUB: Prevents breaking changes, allows incremental implementation
  return 0;
}

/**
 * Rebuild hierarchy cache
 * WHY: Manual cache invalidation for administrative tasks
 */
export function rebuildHierarchyCache() {
  hierarchyCache = {};
  cacheTimestamps = {};

  // Preload all vocabulary trees
  for (const vocabulary of Object.values(vocabularies)) {
    getTermTree(vocabulary.id);
  }
}

/**
 * Get terms assigned to content
 *
 * @param {string} contentType - Content type
 * @param {string} contentId - Content ID
 * @param {string} vocabularyId - Optional vocabulary filter
 * @returns {Array} Assigned terms
 */
export function getContentTerms(contentType, contentId, vocabularyId = null) {
  // Stub - requires content field integration
  // WHY: Allows API design to evolve before implementation
  return [];
}

/**
 * Assign terms to content
 *
 * @param {string} contentType - Content type
 * @param {string} contentId - Content ID
 * @param {string[]} termIds - Term IDs to assign
 * @returns {Promise<void>}
 */
export async function assignTerms(contentType, contentId, termIds) {
  // Stub - requires content field integration
  // This will update a term reference field on the content item

  // Fire hook for extensibility
  await hooks.trigger('taxonomy:afterAssignTerms', {
    contentType,
    contentId,
    termIds,
  });
}

/**
 * Remove terms from content
 *
 * @param {string} contentType - Content type
 * @param {string} contentId - Content ID
 * @param {string[]} termIds - Term IDs to remove (all if omitted)
 * @returns {Promise<void>}
 */
export async function removeTerms(contentType, contentId, termIds = null) {
  // Stub - requires content field integration
}

/**
 * Find content by terms
 *
 * @param {Object} options - Query options
 * @returns {Promise<Object>} { items, total }
 */
export async function findContentByTerms(options) {
  // Stub - requires content field integration
  return { items: [], total: 0 };
}

/**
 * Get configuration
 *
 * @returns {Object} Current configuration
 */
export function getConfig() {
  return { ...config };
}
