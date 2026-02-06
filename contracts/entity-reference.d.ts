/**
 * entity-reference.d.ts - Entity Reference System Contracts
 *
 * WHY THIS EXISTS:
 * Content items often need to reference other content:
 * - Article references its author (User)
 * - Product references its category (Taxonomy Term)
 * - Recipe references ingredients (Products)
 *
 * Entity references provide:
 * - Type-safe relationships between content types
 * - Automatic reference validation
 * - Bidirectional relationship queries
 * - Referential integrity (optional)
 *
 * DRUPAL HERITAGE:
 * Inspired by Drupal's Entity Reference module which provides:
 * - Reference fields on any entity type
 * - Target type/bundle filtering
 * - Selection handlers (views, manual)
 * - Reference counting for usage tracking
 *
 * STORAGE STRATEGY:
 * References are stored as field values on content items.
 * An index tracks reverse references for fast lookups.
 *
 * /content
 *   /.references/
 *     index.json      - Reverse reference index
 */

// ============================================
// REFERENCE FIELD DEFINITION
// ============================================

/**
 * Reference cardinality
 */
export type ReferenceCardinality = 'single' | 'multiple' | 'unlimited';

/**
 * Reference field definition
 * Used in content type schemas to define reference fields
 */
export interface ReferenceField {
  /** Field type identifier */
  type: 'reference' | 'references';

  /** Human-readable label */
  label?: string;

  /** Field description */
  description?: string;

  /** Target content type(s) */
  target: string | string[];

  /** Whether field is required */
  required?: boolean;

  /** Cardinality for 'references' type */
  cardinality?: ReferenceCardinality;

  /** Maximum number of references (for 'multiple' cardinality) */
  maxItems?: number;

  /** Selection handler configuration */
  selection?: SelectionHandler;

  /** Display handler configuration */
  display?: DisplayHandler;

  /** Referential integrity mode */
  integrity?: 'none' | 'restrict' | 'cascade' | 'nullify';

  /** Enable reverse reference index */
  indexed?: boolean;

  /** Default value(s) */
  defaultValue?: string | string[] | null;
}

/**
 * Selection handler configuration
 * Determines how users select references in admin UI
 */
export interface SelectionHandler {
  /** Handler type */
  type: 'default' | 'views' | 'autocomplete' | 'select' | 'checkboxes' | 'modal';

  /** Handler settings */
  settings: {
    /** For views handler: view ID and display */
    viewId?: string;
    displayId?: string;

    /** For autocomplete: minimum characters */
    minChars?: number;

    /** For autocomplete: maximum suggestions */
    maxSuggestions?: number;

    /** For select/checkboxes: limit options */
    limitOptions?: number;

    /** Sort options */
    sort?: { field: string; direction: 'asc' | 'desc' };

    /** Filter options */
    filter?: Record<string, any>;

    /** Allow creating new items inline */
    allowCreate?: boolean;

    /** Label field for display */
    labelField?: string;

    /** Additional fields to show */
    displayFields?: string[];
  };
}

/**
 * Display handler configuration
 * Determines how references are rendered
 */
export interface DisplayHandler {
  /** Handler type */
  type: 'default' | 'label' | 'rendered' | 'link' | 'custom';

  /** Handler settings */
  settings: {
    /** For rendered: view mode */
    viewMode?: string;

    /** For link: link field */
    linkField?: string;

    /** For custom: template */
    template?: string;

    /** Separator for multiple references */
    separator?: string;

    /** Show as list */
    asList?: boolean;

    /** List type */
    listType?: 'ul' | 'ol' | 'inline';
  };
}

// ============================================
// ENTITY REFERENCE
// ============================================

/**
 * Entity reference value
 * The actual reference stored on content items
 */
export interface EntityReference {
  /** Target content type */
  targetType: string;

  /** Target content ID */
  targetId: string;

  /** Optional: cached target label (for display efficiency) */
  targetLabel?: string;

  /** Optional: reference metadata */
  meta?: Record<string, any>;
}

/**
 * Resolved entity reference
 * Reference with loaded target content
 */
export interface EntityReferenceResolved extends EntityReference {
  /** Loaded target content */
  target: any;

  /** Whether target exists */
  exists: boolean;
}

// ============================================
// REVERSE REFERENCE INDEX
// ============================================

/**
 * Reverse reference entry
 * Tracks which content items reference a given item
 */
export interface ReverseReference {
  /** Source content type */
  sourceType: string;

  /** Source content ID */
  sourceId: string;

  /** Field on source that holds the reference */
  field: string;

  /** Timestamp when reference was created */
  created: string;
}

/**
 * Reference index structure
 */
export interface ReferenceIndex {
  /** Version for migrations */
  version: string;

  /** Forward index: "type:id:field" -> ["targetType:targetId", ...] */
  forward: Record<string, string[]>;

  /** Reverse index: "type:id" -> [ReverseReference, ...] */
  reverse: Record<string, ReverseReference[]>;

  /** Last rebuild timestamp */
  lastRebuild: string | null;
}

// ============================================
// QUERY OPTIONS
// ============================================

/**
 * Options for finding references
 */
export interface ReferenceFindOptions {
  /** Source content type filter */
  sourceType?: string;

  /** Source field filter */
  field?: string;

  /** Include reference metadata */
  includeMeta?: boolean;

  /** Sort by */
  sort?: 'created' | 'sourceType' | 'field';

  /** Sort direction */
  order?: 'asc' | 'desc';

  /** Pagination offset */
  offset?: number;

  /** Pagination limit */
  limit?: number;
}

/**
 * Result of reference query
 */
export interface ReferenceFindResult {
  items: ReverseReference[];
  total: number;
  offset: number;
  limit: number;
}

// ============================================
// SERVICE INTERFACE
// ============================================

/**
 * EntityReferenceService provides reference management
 *
 * DESIGN NOTES:
 * - Integrates with content service via hooks
 * - Maintains reverse reference index
 * - Validates references on save
 * - Handles referential integrity
 */
export interface EntityReferenceService {
  // ----------------------------------------
  // INITIALIZATION
  // ----------------------------------------

  /**
   * Initialize entity reference system
   * @param config - Reference configuration
   * @param contentModule - Reference to content service
   */
  init(config: EntityReferenceConfig, contentModule: ContentService): void;

  // ----------------------------------------
  // FIELD REGISTRATION
  // ----------------------------------------

  /**
   * Register a reference field on a content type
   * Called automatically when content type with reference field is registered
   * @param contentType - Content type
   * @param fieldName - Field name
   * @param fieldDef - Field definition
   */
  registerField(contentType: string, fieldName: string, fieldDef: ReferenceField): void;

  /**
   * Get reference fields for a content type
   * @param contentType - Content type
   * @returns Map of field name to definition
   */
  getFields(contentType: string): Record<string, ReferenceField>;

  /**
   * Get all reference fields across all types
   * @returns Map of "type:field" to definition
   */
  getAllFields(): Record<string, ReferenceField>;

  // ----------------------------------------
  // REFERENCE VALIDATION
  // ----------------------------------------

  /**
   * Validate a reference value
   * @param fieldDef - Field definition
   * @param value - Reference value(s)
   * @returns Validation result
   */
  validate(fieldDef: ReferenceField, value: any): {
    valid: boolean;
    errors: string[];
  };

  /**
   * Validate all references in content item
   * @param contentType - Content type
   * @param data - Content data
   * @returns Validation result
   */
  validateAll(contentType: string, data: any): {
    valid: boolean;
    errors: Array<{ field: string; message: string }>;
  };

  /**
   * Check if target exists
   * @param targetType - Target content type
   * @param targetId - Target content ID
   * @returns True if exists
   */
  targetExists(targetType: string, targetId: string): boolean;

  // ----------------------------------------
  // REFERENCE RESOLUTION
  // ----------------------------------------

  /**
   * Resolve a single reference
   * @param ref - Reference value
   * @returns Resolved reference with loaded target
   */
  resolve(ref: EntityReference): EntityReferenceResolved;

  /**
   * Resolve multiple references
   * @param refs - Reference values
   * @returns Resolved references
   */
  resolveMultiple(refs: EntityReference[]): EntityReferenceResolved[];

  /**
   * Resolve all references in content item
   * @param contentType - Content type
   * @param data - Content data
   * @param options - { fields, depth }
   * @returns Content with resolved references
   */
  resolveAll(
    contentType: string,
    data: any,
    options?: { fields?: string[]; depth?: number }
  ): any;

  // ----------------------------------------
  // REVERSE REFERENCE QUERIES
  // ----------------------------------------

  /**
   * Find content that references a given item
   * @param targetType - Target content type
   * @param targetId - Target content ID
   * @param options - Query options
   * @returns Referencing content
   */
  findReferencingContent(
    targetType: string,
    targetId: string,
    options?: ReferenceFindOptions
  ): ReferenceFindResult;

  /**
   * Count references to an item
   * @param targetType - Target content type
   * @param targetId - Target content ID
   * @param options - { sourceType, field }
   * @returns Reference count
   */
  countReferences(
    targetType: string,
    targetId: string,
    options?: { sourceType?: string; field?: string }
  ): number;

  /**
   * Check if item is referenced by anything
   * @param targetType - Target content type
   * @param targetId - Target content ID
   * @returns True if referenced
   */
  isReferenced(targetType: string, targetId: string): boolean;

  // ----------------------------------------
  // REFERENTIAL INTEGRITY
  // ----------------------------------------

  /**
   * Check what would happen if item is deleted
   * @param contentType - Content type
   * @param contentId - Content ID
   * @returns Impact analysis
   */
  analyzeDeleteImpact(contentType: string, contentId: string): {
    /** References that would be orphaned */
    orphaned: ReverseReference[];
    /** References with 'restrict' integrity (would block delete) */
    blocked: ReverseReference[];
    /** References with 'cascade' integrity (would cascade delete) */
    cascaded: ReverseReference[];
    /** References with 'nullify' integrity (would be set to null) */
    nullified: ReverseReference[];
  };

  /**
   * Handle referential integrity on delete
   * @param contentType - Content type being deleted
   * @param contentId - Content ID being deleted
   * @returns Actions taken
   */
  handleDelete(contentType: string, contentId: string): Promise<{
    blocked: boolean;
    cascaded: string[];
    nullified: string[];
  }>;

  // ----------------------------------------
  // INDEX MANAGEMENT
  // ----------------------------------------

  /**
   * Update index when content is created/updated
   * Called via hook
   * @param contentType - Content type
   * @param contentId - Content ID
   * @param data - Content data
   */
  updateIndex(contentType: string, contentId: string, data: any): void;

  /**
   * Remove from index when content is deleted
   * Called via hook
   * @param contentType - Content type
   * @param contentId - Content ID
   */
  removeFromIndex(contentType: string, contentId: string): void;

  /**
   * Rebuild entire reference index
   * @param options - { contentTypes }
   * @returns Rebuild stats
   */
  rebuildIndex(options?: { contentTypes?: string[] }): Promise<{
    processed: number;
    references: number;
    duration: number;
  }>;

  /**
   * Verify index integrity
   * @returns Verification result
   */
  verifyIndex(): {
    valid: boolean;
    orphanedForward: string[];
    orphanedReverse: string[];
    missingForward: string[];
    missingReverse: string[];
  };

  // ----------------------------------------
  // SELECTION HANDLERS
  // ----------------------------------------

  /**
   * Get reference options for selection UI
   * @param fieldDef - Field definition
   * @param query - Search query (for autocomplete)
   * @param context - Render context
   * @returns Options for selection widget
   */
  getSelectionOptions(
    fieldDef: ReferenceField,
    query?: string,
    context?: any
  ): Promise<Array<{ value: string; label: string; data?: any }>>;

  /**
   * Register custom selection handler
   * @param name - Handler name
   * @param handler - Handler function
   */
  registerSelectionHandler(
    name: string,
    handler: (fieldDef: ReferenceField, query: string, context: any) => Promise<any[]>
  ): void;

  // ----------------------------------------
  // UTILITIES
  // ----------------------------------------

  /**
   * Create reference value
   * @param targetType - Target content type
   * @param targetId - Target content ID
   * @param meta - Optional metadata
   * @returns Reference object
   */
  createReference(
    targetType: string,
    targetId: string,
    meta?: Record<string, any>
  ): EntityReference;

  /**
   * Normalize reference value (handle various input formats)
   * @param value - Raw reference value
   * @param fieldDef - Field definition
   * @returns Normalized reference(s)
   */
  normalize(value: any, fieldDef: ReferenceField): EntityReference | EntityReference[] | null;

  /**
   * Get label for reference
   * @param ref - Reference
   * @returns Human-readable label
   */
  getLabel(ref: EntityReference): string;

  /**
   * Get URL for reference target
   * @param ref - Reference
   * @returns URL to target content
   */
  getUrl(ref: EntityReference): string | null;
}

// ============================================
// CONFIGURATION
// ============================================

/**
 * Entity reference configuration
 */
export interface EntityReferenceConfig {
  /** Enable reference system */
  enabled?: boolean;

  /** Maintain reverse reference index */
  indexEnabled?: boolean;

  /** Default referential integrity mode */
  defaultIntegrity?: 'none' | 'restrict' | 'cascade' | 'nullify';

  /** Cache resolved references */
  cacheResolved?: boolean;

  /** Cache TTL in seconds */
  cacheTTL?: number;

  /** Maximum resolution depth for nested references */
  maxDepth?: number;

  /** Default label field for targets */
  defaultLabelField?: string;
}

// ============================================
// HOOKS
// ============================================

/**
 * Hook: reference:beforeValidate
 * Fired before validating references
 * Context: { contentType: string, data: any, fields: ReferenceField[] }
 */

/**
 * Hook: reference:afterResolve
 * Fired after resolving references (can modify)
 * Context: { contentType: string, data: any, resolved: any }
 */

/**
 * Hook: reference:beforeDelete
 * Fired before handling delete (can prevent cascade)
 * Context: { contentType: string, contentId: string, impact: DeleteImpact }
 */

/**
 * Hook: reference:indexUpdated
 * Fired after index is updated
 * Context: { contentType: string, contentId: string, added: number, removed: number }
 */

// ============================================
// CLI COMMANDS
// ============================================

/**
 * reference:list <type> <id> - List references from content
 * reference:find <type> <id> - Find content referencing this item
 * reference:count <type> <id> - Count references to item
 * reference:rebuild-index [--type=<type>] - Rebuild reference index
 * reference:verify-index - Verify index integrity
 * reference:analyze-delete <type> <id> - Analyze delete impact
 */

// ============================================
// SERVICE STUB (for type reference)
// ============================================

interface ContentService {
  create(type: string, data: any): Promise<any>;
  read(type: string, id: string): any;
  update(type: string, id: string, data: any): Promise<any>;
  delete(type: string, id: string): Promise<void>;
  list(type: string, options?: any): { items: any[]; total: number };
  register(type: string, schema: any): void;
  getSchema(type: string): Record<string, any>;
  listTypes(): string[];
}
