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
import * as hooks from './hooks.ts';
import { slugify } from './slugify.js';

// ============================================
// TYPES
// ============================================

/** Vocabulary definition */
interface VocabularyDef {
  id: string;
  name: string;
  description: string;
  hierarchical: boolean;
  maxDepth: number;
  multipleSelection: boolean;
  allowCreate: boolean;
  weight: number;
  created: string;
  updated: string;
}

/** Vocabulary creation input */
interface VocabularyInput {
  id?: string;
  name: string;
  description?: string;
  hierarchical?: boolean;
  maxDepth?: number;
  multipleSelection?: boolean;
  allowCreate?: boolean;
  weight?: number;
}

/** Term data as stored */
interface TermDef {
  id: string;
  vocabularyId: string;
  name: string;
  slug: string;
  description: string;
  parentId: string | null;
  weight: number;
  depth: number;
  path: string[];
  [key: string]: unknown;
}

/** Term creation input */
interface TermInput {
  vocabularyId: string;
  name: string;
  slug?: string;
  description?: string;
  parentId?: string | null;
  weight?: number;
  [key: string]: unknown;
}

/** Term with children for tree building */
interface TermWithChildren extends TermDef {
  children: TermWithChildren[];
  contentCount: number;
}

/** Content service interface for taxonomy operations */
interface TaxonomyContentService {
  register(type: string, fields: Record<string, unknown>, group?: string): void;
  create(type: string, data: Record<string, unknown>): Promise<TermDef>;
  read(type: string, id: string): TermDef | null;
  update(type: string, id: string, data: Record<string, unknown>): Promise<TermDef>;
  delete(type: string, id: string): Promise<void>;
  list(type: string, options: Record<string, unknown>): { items: TermDef[]; total: number };
}

/** List terms query options */
interface ListTermsOptions {
  vocabularyId?: string;
  parentId?: string | null;
  sort?: string;
  order?: string;
  offset?: number;
  limit?: number;
}

/** Delete vocabulary options */
interface DeleteVocabularyOptions {
  deleteTerms?: boolean;
}

/** Delete term options */
interface DeleteTermOptions {
  deleteChildren?: boolean;
  reassignTo?: string;
}

/** Find content by terms options */
interface FindContentByTermsOptions {
  termIds?: string[];
  vocabularyId?: string;
  contentType?: string;
  limit?: number;
  offset?: number;
}

/** Taxonomy configuration */
interface TaxonomyConfig {
  enabled: boolean;
  defaults: {
    hierarchical: boolean;
    maxDepth: number;
    multipleSelection: boolean;
    allowCreate: boolean;
  };
  cacheHierarchy: boolean;
  cacheTTL: number;
}

/**
 * Module state
 */
let baseDir: string | null = null;
let contentService: TaxonomyContentService | null = null;
let vocabulariesPath: string | null = null;
let vocabularies: Record<string, VocabularyDef> = {};
let config: TaxonomyConfig = {
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
let hierarchyCache: Record<string, Record<string, TermWithChildren>> = {};
let cacheTimestamps: Record<string, number> = {};

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
export function init(dir: string, content: TaxonomyContentService, taxonomyConfig: Partial<TaxonomyConfig> = {}): void {
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
function loadVocabularies(): void {
  if (existsSync(vocabulariesPath!)) {
    try {
      const data = JSON.parse(readFileSync(vocabulariesPath!, 'utf-8')) as Record<string, VocabularyDef>;
      vocabularies = data;
    } catch (e) {
      console.error('[taxonomy] Failed to load vocabularies:', e instanceof Error ? e.message : String(e));
      vocabularies = {};
    }
  }
}

/**
 * Save vocabularies to disk
 * WHY ATOMIC: Write to temp file then rename to prevent corruption
 */
function saveVocabularies(): void {
  try {
    writeFileSync(vocabulariesPath!, JSON.stringify(vocabularies, null, 2) + '\n');
  } catch (e) {
    console.error('[taxonomy] Failed to save vocabularies:', e instanceof Error ? e.message : String(e));
    throw new Error('Failed to save vocabulary configuration');
  }
}

/**
 * Create a new vocabulary
 *
 * @param {Object} input - Vocabulary data
 * @returns {Promise<Object>} Created vocabulary
 */
export async function createVocabulary(input: VocabularyInput): Promise<VocabularyDef> {
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
  const vocabulary: VocabularyDef = {
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
export function getVocabulary(id: string): VocabularyDef | null {
  return vocabularies[id] || null;
}

/**
 * Update a vocabulary
 *
 * @param {string} id - Vocabulary ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated vocabulary
 */
export async function updateVocabulary(id: string, updates: Partial<VocabularyInput>): Promise<VocabularyDef> {
  const vocabulary = vocabularies[id];
  if (!vocabulary) {
    throw new Error(`Vocabulary "${id}" not found`);
  }

  // Fire before hook
  await hooks.trigger('taxonomy:beforeUpdateVocabulary', { vocabulary, updates });

  // Apply updates (preserve created timestamp)
  const updated: VocabularyDef = {
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
export async function deleteVocabulary(id: string, options: DeleteVocabularyOptions = {}): Promise<void> {
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
      await contentService!.delete('term', term.id);
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
export function listVocabularies(): VocabularyDef[] {
  return Object.values(vocabularies).sort((a: VocabularyDef, b: VocabularyDef) => a.weight - b.weight);
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
function validateTermInput(input: TermInput): VocabularyDef {
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
function computeHierarchyInfo(vocabularyId: string, parentId: string | null): { depth: number; path: string[] } {
  if (!parentId) {
    return { depth: 0, path: [] };
  }

  const parent = contentService!.read('term', parentId);
  if (!parent) {
    throw new Error(`Parent term "${parentId}" not found`);
  }

  if (parent.vocabularyId !== vocabularyId) {
    throw new Error('Parent term must be in the same vocabulary');
  }

  const depth = (parent.depth as number) + 1;
  const path = [...(parent.path as string[]), parentId];

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
export function validateHierarchy(termId: string, newParentId: string | null): boolean {
  if (!newParentId) {
    return true; // Root level is always valid
  }

  if (termId === newParentId) {
    throw new Error('Term cannot be its own parent');
  }

  // Check if newParentId is a descendant of termId
  // WHY: This would create a cycle
  const parent = contentService!.read('term', newParentId);
  if (!parent) {
    throw new Error(`Parent term "${newParentId}" not found`);
  }

  // Walk up parent chain looking for termId
  let current: TermDef | null = parent;
  const visited = new Set<string>();
  while (current && current.parentId) {
    if (visited.has(current.id)) {
      throw new Error('Circular reference detected in term hierarchy');
    }
    visited.add(current.id);

    if (current.parentId === termId) {
      throw new Error('Cannot set parent - would create circular reference');
    }

    current = contentService!.read('term', current.parentId);
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
export function generateSlug(name: string, vocabularyId: string, excludeId: string | null = null): string {
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
export async function createTerm(input: TermInput): Promise<TermDef> {
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
  const term = await contentService!.create('term', termData);

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
export function getTerm(id: string): TermDef | null {
  return contentService!.read('term', id);
}

/**
 * Get a term by slug within a vocabulary
 *
 * @param {string} vocabularyId - Vocabulary ID
 * @param {string} slug - Term slug
 * @returns {Object|null} Term or null
 */
export function getTermBySlug(vocabularyId: string, slug: string): TermDef | null {
  const result = contentService!.list('term', {
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
export async function updateTerm(id: string, updates: Partial<TermInput>): Promise<TermDef> {
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
    validateHierarchy(id, updates.parentId ?? null);
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
    const { depth, path } = computeHierarchyInfo(term.vocabularyId, updates.parentId ?? null);

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
  const updatedTerm = await contentService!.update('term', id, updates as Record<string, unknown>);

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
async function updateDescendantHierarchy(parentId: string, vocabularyId: string): Promise<void> {
  const children = getTermChildren(vocabularyId, parentId);

  for (const child of children) {
    const { depth, path } = computeHierarchyInfo(vocabularyId, parentId);

    await contentService!.update('term', child.id, {
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
export async function deleteTerm(id: string, options: DeleteTermOptions = {}): Promise<void> {
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
  await contentService!.delete('term', id);

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
export function listTerms(options: ListTermsOptions = {}): { items: TermDef[]; total: number } {
  const filters: Array<{ field: string; op: string; value?: unknown }> = [];

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

  const result = contentService!.list('term', {
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
export function getTermTree(vocabularyId: string): TermWithChildren[] {
  // Check cache
  if (config.cacheHierarchy) {
    const cached = hierarchyCache[vocabularyId];
    const timestamp = cacheTimestamps[vocabularyId];

    if (cached && timestamp) {
      const age = Date.now() - timestamp;
      if (age < config.cacheTTL * 1000) {
        return Object.values(cached).filter((t: TermWithChildren) => !t.parentId);
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
  const termsById: Record<string, TermWithChildren> = {};
  const rootTerms: TermWithChildren[] = [];

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
    const termWithChildren = termsById[term.id]!;

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
  function sortChildren(terms: TermWithChildren[]): void {
    terms.sort((a: TermWithChildren, b: TermWithChildren) => a.weight - b.weight);
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
export async function moveTerm(id: string, newParentId: string | null): Promise<TermDef> {
  return updateTerm(id, { parentId: newParentId });
}

/**
 * Reorder terms at same level
 *
 * @param {string[]} termIds - Term IDs in desired order
 * @returns {Promise<void>}
 */
export async function reorderTerms(termIds: string[]): Promise<void> {
  // Update weight based on position in array
  // WHY: Weight determines sort order
  for (let i = 0; i < termIds.length; i++) {
    await updateTerm(termIds[i]!, { weight: i });
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
export function getTermPath(vocabularyId: string, id: string): TermDef[] {
  const term = getTerm(id);
  if (!term) {
    return [];
  }

  const pathTerms: TermDef[] = [];

  // Get all ancestors
  for (const ancestorId of (term.path as string[])) {
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
export function getTermChildren(vocabularyId: string, parentId: string | null = null): TermDef[] {
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
export function getTermCount(vocabularyId: string): number {
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
export function searchTerms(vocabularyId: string, query: string): TermDef[] {
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
export function getTermContentCount(termId: string, includeChildren: boolean = false): number {
  // This requires integration with content items
  // For now, return 0 - will be implemented when content references are added
  // WHY STUB: Prevents breaking changes, allows incremental implementation
  return 0;
}

/**
 * Rebuild hierarchy cache
 * WHY: Manual cache invalidation for administrative tasks
 */
export function rebuildHierarchyCache(): void {
  hierarchyCache = {};
  cacheTimestamps = {};

  // Preload all vocabulary trees
  for (const vocab of Object.values(vocabularies)) {
    getTermTree(vocab.id);
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
export function getContentTerms(contentType: string, contentId: string, vocabularyId: string | null = null): TermDef[] {
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
export async function assignTerms(contentType: string, contentId: string, termIds: string[]): Promise<void> {
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
export async function removeTerms(contentType: string, contentId: string, termIds: string[] | null = null): Promise<void> {
  // Stub - requires content field integration
}

/**
 * Find content by terms
 *
 * @param {Object} options - Query options
 * @returns {Promise<Object>} { items, total }
 */
export async function findContentByTerms(options: FindContentByTermsOptions): Promise<{ items: unknown[]; total: number }> {
  // Stub - requires content field integration
  return { items: [], total: 0 };
}

/**
 * Get configuration
 *
 * @returns {Object} Current configuration
 */
export function getConfig(): TaxonomyConfig {
  return { ...config };
}
