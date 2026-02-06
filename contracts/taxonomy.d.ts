/**
 * taxonomy.d.ts - Taxonomy System Contracts
 *
 * WHY THIS EXISTS:
 * Taxonomy provides hierarchical categorization of content through:
 * - Vocabularies: Named collections of terms (e.g., "Categories", "Tags")
 * - Terms: Individual taxonomy items with optional hierarchy
 * - Content tagging: Linking content to terms
 *
 * DRUPAL HERITAGE:
 * Inspired by Drupal's taxonomy module which provides:
 * - Multiple vocabularies per site
 * - Hierarchical or flat term structures
 * - Term references from any content type
 *
 * STORAGE STRATEGY:
 * /content
 *   /vocabulary/
 *     categories.json
 *     tags.json
 *   /term/
 *     category-news.json
 *     tag-javascript.json
 */

// ============================================
// VOCABULARY
// ============================================

/**
 * Vocabulary definition
 * A vocabulary is a container for related terms
 */
export interface Vocabulary {
  /** Unique machine name (e.g., "categories", "tags") */
  id: string;

  /** Human-readable name (e.g., "Categories", "Tags") */
  name: string;

  /** Optional description of this vocabulary's purpose */
  description?: string;

  /** Whether terms can have parent/child relationships */
  hierarchical: boolean;

  /** Maximum nesting depth (0 = flat, -1 = unlimited) */
  maxDepth: number;

  /** Whether multiple terms from this vocabulary can be assigned to content */
  multipleSelection: boolean;

  /** Whether new terms can be created during content editing */
  allowCreate: boolean;

  /** Weight for ordering vocabularies in UI */
  weight: number;

  /** ISO timestamp when created */
  created: string;

  /** ISO timestamp when last modified */
  updated: string;
}

/**
 * Options for creating/updating a vocabulary
 */
export interface VocabularyInput {
  id?: string;
  name: string;
  description?: string;
  hierarchical?: boolean;
  maxDepth?: number;
  multipleSelection?: boolean;
  allowCreate?: boolean;
  weight?: number;
}

// ============================================
// TERM
// ============================================

/**
 * Term definition
 * A term is a single taxonomy item within a vocabulary
 */
export interface Term {
  /** Unique identifier */
  id: string;

  /** Vocabulary this term belongs to */
  vocabularyId: string;

  /** Human-readable name (e.g., "JavaScript", "News") */
  name: string;

  /** URL-friendly slug (e.g., "javascript", "news") */
  slug: string;

  /** Optional description */
  description?: string;

  /** Parent term ID for hierarchical vocabularies (null for root) */
  parentId: string | null;

  /** Weight for ordering terms at same level */
  weight: number;

  /** Computed depth in hierarchy (0 for root terms) */
  depth: number;

  /** Computed path of ancestor term IDs */
  path: string[];

  /** ISO timestamp when created */
  created: string;

  /** ISO timestamp when last modified */
  updated: string;
}

/**
 * Options for creating/updating a term
 */
export interface TermInput {
  vocabularyId: string;
  name: string;
  slug?: string;
  description?: string;
  parentId?: string | null;
  weight?: number;
}

/**
 * Term with computed hierarchy information
 */
export interface TermWithHierarchy extends Term {
  /** Direct child terms */
  children: TermWithHierarchy[];

  /** Number of content items tagged with this term */
  contentCount: number;
}

// ============================================
// TERM REFERENCE
// ============================================

/**
 * Reference linking content to terms
 * Stored as a field on content items
 */
export interface TermReference {
  /** Term ID being referenced */
  termId: string;

  /** Vocabulary ID (denormalized for fast lookups) */
  vocabularyId: string;
}

// ============================================
// QUERY OPTIONS
// ============================================

/**
 * Options for listing terms
 */
export interface TermListOptions {
  /** Filter by vocabulary */
  vocabularyId?: string;

  /** Filter by parent (null for root terms only) */
  parentId?: string | null;

  /** Include children recursively */
  includeChildren?: boolean;

  /** Maximum depth to traverse (-1 for all) */
  maxDepth?: number;

  /** Sort field */
  sort?: 'name' | 'weight' | 'created' | 'updated';

  /** Sort direction */
  order?: 'asc' | 'desc';

  /** Pagination offset */
  offset?: number;

  /** Pagination limit */
  limit?: number;

  /** Include content counts */
  includeContentCount?: boolean;
}

/**
 * Result of a term list query
 */
export interface TermListResult {
  items: Term[];
  total: number;
  offset: number;
  limit: number;
}

/**
 * Options for finding content by terms
 */
export interface ContentByTermOptions {
  /** Term IDs to match (OR logic) */
  termIds?: string[];

  /** Vocabulary IDs to filter by */
  vocabularyIds?: string[];

  /** Content type to filter by */
  contentType?: string;

  /** Match all terms (AND logic) vs any term (OR logic) */
  matchAll?: boolean;

  /** Include content tagged with child terms */
  includeChildren?: boolean;

  /** Pagination offset */
  offset?: number;

  /** Pagination limit */
  limit?: number;
}

// ============================================
// SERVICE INTERFACE
// ============================================

/**
 * TaxonomyService provides full taxonomy management
 *
 * DESIGN NOTES:
 * - Vocabularies are registered like content types
 * - Terms are stored as content items of type "term"
 * - Content references terms via TermReference fields
 * - Hierarchy is computed and cached for performance
 */
export interface TaxonomyService {
  // ----------------------------------------
  // INITIALIZATION
  // ----------------------------------------

  /**
   * Initialize taxonomy system
   * @param config - Taxonomy configuration
   * @param contentModule - Reference to content service
   */
  init(config: TaxonomyConfig, contentModule: ContentService): void;

  // ----------------------------------------
  // VOCABULARY MANAGEMENT
  // ----------------------------------------

  /**
   * Create a new vocabulary
   * @param input - Vocabulary data
   * @returns Created vocabulary
   */
  createVocabulary(input: VocabularyInput): Promise<Vocabulary>;

  /**
   * Get a vocabulary by ID
   * @param id - Vocabulary ID
   * @returns Vocabulary or null if not found
   */
  getVocabulary(id: string): Vocabulary | null;

  /**
   * Update a vocabulary
   * @param id - Vocabulary ID
   * @param input - Updated data
   * @returns Updated vocabulary
   */
  updateVocabulary(id: string, input: Partial<VocabularyInput>): Promise<Vocabulary>;

  /**
   * Delete a vocabulary (and optionally all its terms)
   * @param id - Vocabulary ID
   * @param options - { deleteTerms: boolean }
   */
  deleteVocabulary(id: string, options?: { deleteTerms?: boolean }): Promise<void>;

  /**
   * List all vocabularies
   * @returns Array of vocabularies
   */
  listVocabularies(): Vocabulary[];

  // ----------------------------------------
  // TERM MANAGEMENT
  // ----------------------------------------

  /**
   * Create a new term
   * @param input - Term data
   * @returns Created term
   */
  createTerm(input: TermInput): Promise<Term>;

  /**
   * Get a term by ID
   * @param id - Term ID
   * @returns Term or null if not found
   */
  getTerm(id: string): Term | null;

  /**
   * Get a term by slug within a vocabulary
   * @param vocabularyId - Vocabulary ID
   * @param slug - Term slug
   * @returns Term or null if not found
   */
  getTermBySlug(vocabularyId: string, slug: string): Term | null;

  /**
   * Update a term
   * @param id - Term ID
   * @param input - Updated data
   * @returns Updated term
   */
  updateTerm(id: string, input: Partial<TermInput>): Promise<Term>;

  /**
   * Delete a term
   * @param id - Term ID
   * @param options - { reassignTo: string, deleteChildren: boolean }
   */
  deleteTerm(id: string, options?: { reassignTo?: string; deleteChildren?: boolean }): Promise<void>;

  /**
   * List terms with filtering and pagination
   * @param options - Query options
   * @returns Paginated term list
   */
  listTerms(options?: TermListOptions): TermListResult;

  /**
   * Get term hierarchy tree
   * @param vocabularyId - Vocabulary ID
   * @returns Root terms with nested children
   */
  getTermTree(vocabularyId: string): TermWithHierarchy[];

  /**
   * Move term to new parent
   * @param id - Term ID
   * @param newParentId - New parent term ID (null for root)
   */
  moveTerm(id: string, newParentId: string | null): Promise<Term>;

  /**
   * Reorder terms at same level
   * @param termIds - Term IDs in desired order
   */
  reorderTerms(termIds: string[]): Promise<void>;

  // ----------------------------------------
  // CONTENT INTEGRATION
  // ----------------------------------------

  /**
   * Get terms assigned to content
   * @param contentType - Content type
   * @param contentId - Content ID
   * @param vocabularyId - Optional vocabulary filter
   * @returns Assigned terms
   */
  getContentTerms(contentType: string, contentId: string, vocabularyId?: string): Term[];

  /**
   * Assign terms to content
   * @param contentType - Content type
   * @param contentId - Content ID
   * @param termIds - Term IDs to assign
   */
  assignTerms(contentType: string, contentId: string, termIds: string[]): Promise<void>;

  /**
   * Remove terms from content
   * @param contentType - Content type
   * @param contentId - Content ID
   * @param termIds - Term IDs to remove (all if omitted)
   */
  removeTerms(contentType: string, contentId: string, termIds?: string[]): Promise<void>;

  /**
   * Find content by terms
   * @param options - Query options
   * @returns Content items matching the term criteria
   */
  findContentByTerms(options: ContentByTermOptions): Promise<{ items: any[]; total: number }>;

  /**
   * Get content count for a term
   * @param termId - Term ID
   * @param includeChildren - Include content from child terms
   * @returns Content count
   */
  getTermContentCount(termId: string, includeChildren?: boolean): number;

  // ----------------------------------------
  // UTILITIES
  // ----------------------------------------

  /**
   * Generate unique slug for term
   * @param name - Term name
   * @param vocabularyId - Vocabulary ID
   * @returns Unique slug
   */
  generateSlug(name: string, vocabularyId: string): string;

  /**
   * Validate term hierarchy (detect cycles)
   * @param termId - Term ID
   * @param newParentId - Proposed parent ID
   * @returns True if valid, throws if cycle detected
   */
  validateHierarchy(termId: string, newParentId: string): boolean;

  /**
   * Rebuild term hierarchy cache
   */
  rebuildHierarchyCache(): void;
}

// ============================================
// CONFIGURATION
// ============================================

/**
 * Taxonomy system configuration
 */
export interface TaxonomyConfig {
  /** Enable taxonomy system */
  enabled?: boolean;

  /** Default vocabulary settings */
  defaults?: {
    hierarchical?: boolean;
    maxDepth?: number;
    multipleSelection?: boolean;
    allowCreate?: boolean;
  };

  /** Cache term hierarchy */
  cacheHierarchy?: boolean;

  /** Cache TTL in seconds */
  cacheTTL?: number;
}

// ============================================
// HOOKS
// ============================================

/**
 * Hook: taxonomy:beforeCreateVocabulary
 * Fired before creating a vocabulary
 * Context: { input: VocabularyInput }
 */

/**
 * Hook: taxonomy:afterCreateVocabulary
 * Fired after creating a vocabulary
 * Context: { vocabulary: Vocabulary }
 */

/**
 * Hook: taxonomy:beforeCreateTerm
 * Fired before creating a term
 * Context: { input: TermInput, vocabulary: Vocabulary }
 */

/**
 * Hook: taxonomy:afterCreateTerm
 * Fired after creating a term
 * Context: { term: Term, vocabulary: Vocabulary }
 */

/**
 * Hook: taxonomy:beforeDeleteTerm
 * Fired before deleting a term
 * Context: { term: Term, options: DeleteOptions }
 */

/**
 * Hook: taxonomy:afterAssignTerms
 * Fired after assigning terms to content
 * Context: { contentType: string, contentId: string, termIds: string[] }
 */

// ============================================
// CLI COMMANDS
// ============================================

/**
 * taxonomy:list-vocabularies - List all vocabularies
 * taxonomy:list-terms <vocabulary> - List terms in vocabulary
 * taxonomy:create-vocabulary <name> [--hierarchical] - Create vocabulary
 * taxonomy:create-term <vocabulary> <name> [--parent=<id>] - Create term
 * taxonomy:delete-term <id> [--reassign=<id>] - Delete term
 * taxonomy:rebuild-cache - Rebuild hierarchy cache
 */

// ============================================
// CONTENT SERVICE STUB (for type reference)
// ============================================

interface ContentService {
  create(type: string, data: any): Promise<any>;
  read(type: string, id: string): any;
  update(type: string, id: string, data: any): Promise<any>;
  delete(type: string, id: string): Promise<void>;
  list(type: string, options?: any): { items: any[]; total: number };
  register(type: string, schema: any): void;
}
