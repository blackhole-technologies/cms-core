/**
 * views.d.ts - Views System Contracts (Query Builder)
 *
 * WHY THIS EXISTS:
 * Views provides a visual/configurable query builder for content:
 * - Create lists of content without writing code
 * - Filter, sort, paginate content
 * - Multiple display formats (list, table, grid, RSS)
 * - Exposed filters for user interaction
 *
 * DRUPAL HERITAGE:
 * Inspired by Drupal's Views module which provides:
 * - GUI-based query building
 * - Relationships between content types
 * - Multiple displays per view
 * - Exposed filters and sorting
 * - Contextual filters (from URL)
 *
 * STORAGE STRATEGY:
 * /content
 *   /view/
 *     <id>.json
 */

// ============================================
// VIEW DEFINITION
// ============================================

/**
 * View definition
 * A view is a saved query configuration
 */
export interface View {
  /** Unique machine name (e.g., "recent_posts", "user_articles") */
  id: string;

  /** Human-readable title */
  title: string;

  /** Optional description */
  description?: string;

  /** Base content type to query */
  baseType: string;

  /** Field configuration */
  fields: ViewField[];

  /** Filter criteria */
  filters: ViewFilter[];

  /** Sort criteria */
  sorts: ViewSort[];

  /** Relationships to other content types */
  relationships: ViewRelationship[];

  /** Display configurations */
  displays: ViewDisplay[];

  /** Whether view is enabled */
  enabled: boolean;

  /** Tags for organizing views */
  tags?: string[];

  /** ISO timestamp when created */
  created: string;

  /** ISO timestamp when last modified */
  updated: string;
}

/**
 * Options for creating/updating a view
 */
export interface ViewInput {
  id?: string;
  title: string;
  description?: string;
  baseType: string;
  fields?: ViewField[];
  filters?: ViewFilter[];
  sorts?: ViewSort[];
  relationships?: ViewRelationship[];
  displays?: ViewDisplay[];
  enabled?: boolean;
  tags?: string[];
}

// ============================================
// VIEW FIELDS
// ============================================

/**
 * Field in view output
 */
export interface ViewField {
  /** Unique field ID within view */
  id: string;

  /** Content field name (e.g., "title", "created") */
  field: string;

  /** Optional relationship this field comes from */
  relationship?: string;

  /** Display label (null to hide label) */
  label: string | null;

  /** Formatter for this field */
  formatter?: ViewFieldFormatter;

  /** Whether field is excluded from display (but available for tokens) */
  exclude: boolean;

  /** Custom CSS classes */
  classes?: string[];

  /** Custom template for this field */
  template?: string;

  /** Weight for ordering */
  weight: number;
}

/**
 * Field formatter configuration
 */
export interface ViewFieldFormatter {
  /** Formatter type (e.g., "default", "date", "link", "image", "trim") */
  type: string;

  /** Formatter settings */
  settings: Record<string, any>;
}

/**
 * Common formatter types:
 *
 * default - Raw value
 * trim - Truncate text { length: number, ellipsis: string }
 * date - Date format { format: string }
 * link - Wrap in link { path: string, target: string }
 * image - Image display { style: string, link: boolean }
 * list - Array as list { separator: string, type: 'ul'|'ol'|'inline' }
 * boolean - Yes/No display { yes: string, no: string }
 * number - Number format { decimals: number, prefix: string, suffix: string }
 */

// ============================================
// VIEW FILTERS
// ============================================

/**
 * Filter operator types
 */
export type FilterOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'greater_than'
  | 'less_than'
  | 'greater_equal'
  | 'less_equal'
  | 'between'
  | 'not_between'
  | 'in'
  | 'not_in'
  | 'is_null'
  | 'is_not_null'
  | 'regex'
  ;

/**
 * Filter definition
 */
export interface ViewFilter {
  /** Unique filter ID within view */
  id: string;

  /** Content field to filter on */
  field: string;

  /** Optional relationship this field comes from */
  relationship?: string;

  /** Filter operator */
  operator: FilterOperator;

  /** Filter value(s) */
  value: any;

  /** Filter group (for OR logic between groups) */
  group?: string;

  /** Whether this filter is exposed to users */
  exposed: boolean;

  /** Exposed filter configuration */
  expose?: ExposedFilterConfig;

  /** Whether filter is required when exposed */
  required: boolean;
}

/**
 * Exposed filter configuration
 */
export interface ExposedFilterConfig {
  /** Label shown to user */
  label: string;

  /** Input identifier (form field name) */
  identifier: string;

  /** Input widget type */
  widget: 'textfield' | 'select' | 'multiselect' | 'date' | 'daterange' | 'checkbox' | 'autocomplete';

  /** Options for select/multiselect */
  options?: Array<{ value: any; label: string }>;

  /** Placeholder text */
  placeholder?: string;

  /** Default value */
  defaultValue?: any;

  /** Allow user to choose operator */
  exposeOperator?: boolean;

  /** Operators available to user */
  availableOperators?: FilterOperator[];

  /** Remember last value */
  remember?: boolean;
}

// ============================================
// VIEW SORTING
// ============================================

/**
 * Sort definition
 */
export interface ViewSort {
  /** Unique sort ID within view */
  id: string;

  /** Content field to sort by */
  field: string;

  /** Optional relationship this field comes from */
  relationship?: string;

  /** Sort direction */
  direction: 'asc' | 'desc';

  /** Whether sort is exposed to users */
  exposed: boolean;

  /** Exposed sort configuration */
  expose?: {
    label: string;
    identifier: string;
  };

  /** Weight for ordering multiple sorts */
  weight: number;
}

// ============================================
// VIEW RELATIONSHIPS
// ============================================

/**
 * Relationship to another content type
 * Enables querying related content (like SQL JOIN)
 */
export interface ViewRelationship {
  /** Unique relationship ID within view */
  id: string;

  /** Human-readable label */
  label: string;

  /** Field on base type that references target */
  field: string;

  /** Target content type */
  targetType: string;

  /** Whether relationship is required (INNER vs LEFT JOIN) */
  required: boolean;
}

// ============================================
// VIEW DISPLAYS
// ============================================

/**
 * Display format types
 */
export type DisplayType =
  | 'page'       // Full page with path
  | 'block'      // Block for regions
  | 'embed'      // Embeddable (for templates)
  | 'feed'       // RSS/Atom feed
  | 'export'     // Data export (JSON/CSV)
  ;

/**
 * Display format configuration
 */
export interface DisplayFormat {
  /** Format type */
  type: 'list' | 'table' | 'grid' | 'unformatted' | 'custom';

  /** Settings for this format */
  settings: {
    /** For grid: number of columns */
    columns?: number;

    /** Row CSS classes */
    rowClass?: string;

    /** Grouping field */
    groupingField?: string;

    /** Custom template name */
    template?: string;

    /** Table: sortable columns */
    sortable?: boolean;

    /** Table: show column headers */
    showHeaders?: boolean;
  };
}

/**
 * View display definition
 * A view can have multiple displays with different settings
 */
export interface ViewDisplay {
  /** Unique display ID within view */
  id: string;

  /** Display type */
  type: DisplayType;

  /** Display title */
  title: string;

  /** Display format */
  format: DisplayFormat;

  /** URL path (for page/feed types) */
  path?: string;

  /** Items per page (0 = no limit) */
  itemsPerPage: number;

  /** Enable pager */
  pager: boolean;

  /** Pager configuration */
  pagerConfig?: {
    type: 'full' | 'mini' | 'load_more' | 'infinite';
    label?: string;
    loadMoreLabel?: string;
  };

  /** Header content/blocks */
  header?: DisplayAttachment[];

  /** Footer content/blocks */
  footer?: DisplayAttachment[];

  /** Empty text when no results */
  emptyText?: string;

  /** Override fields from main view */
  fieldOverrides?: Partial<ViewField>[];

  /** Override filters from main view */
  filterOverrides?: Partial<ViewFilter>[];

  /** Additional CSS classes */
  classes?: string[];

  /** Whether display is enabled */
  enabled: boolean;

  /** Access control */
  access?: {
    roles?: string[];
    permissions?: string[];
  };

  /** Cache configuration */
  cache?: {
    mode: 'none' | 'time' | 'tag';
    maxAge?: number;
    tags?: string[];
  };
}

/**
 * Header/Footer attachment
 */
export interface DisplayAttachment {
  /** Attachment type */
  type: 'text' | 'block' | 'result_summary' | 'exposed_filters';

  /** Content (for text type) */
  content?: string;

  /** Block ID (for block type) */
  blockId?: string;

  /** Only show when results exist */
  hideEmpty?: boolean;
}

// ============================================
// VIEW EXECUTION
// ============================================

/**
 * Runtime parameters for executing a view
 */
export interface ViewExecuteOptions {
  /** Display ID to use */
  displayId?: string;

  /** Exposed filter values */
  filters?: Record<string, any>;

  /** Exposed sort values */
  sorts?: Record<string, 'asc' | 'desc'>;

  /** Contextual filter values */
  contextual?: any[];

  /** Page number (1-based) */
  page?: number;

  /** Override items per page */
  limit?: number;

  /** Skip items */
  offset?: number;

  /** Render context */
  context?: RenderContext;
}

/**
 * View execution result
 */
export interface ViewResult {
  /** Result items */
  items: any[];

  /** Total matching items (before pagination) */
  total: number;

  /** Current page */
  page: number;

  /** Items per page */
  limit: number;

  /** Total pages */
  totalPages: number;

  /** Pager info */
  pager: {
    hasPrevious: boolean;
    hasNext: boolean;
    previousPage: number | null;
    nextPage: number | null;
    pages: number[];
  };

  /** Execution time in ms */
  executionTime: number;

  /** Query that was executed (for debugging) */
  query?: any;
}

/**
 * Rendered view output
 */
export interface ViewRendered {
  /** Rendered HTML */
  html: string;

  /** View result data */
  result: ViewResult;

  /** Display used */
  display: ViewDisplay;

  /** Cache metadata */
  cache?: {
    hit: boolean;
    key: string;
    age: number;
  };
}

// ============================================
// SERVICE INTERFACE
// ============================================

/**
 * ViewsService provides query building and execution
 *
 * DESIGN NOTES:
 * - Views are stored as content items of type "view"
 * - Execution uses content service filtering capabilities
 * - Relationships enable cross-content-type queries
 * - Caching improves performance for repeated queries
 */
export interface ViewsService {
  // ----------------------------------------
  // INITIALIZATION
  // ----------------------------------------

  /**
   * Initialize views system
   * @param config - Views configuration
   * @param contentModule - Reference to content service
   */
  init(config: ViewsConfig, contentModule: ContentService): void;

  // ----------------------------------------
  // VIEW MANAGEMENT
  // ----------------------------------------

  /**
   * Create a new view
   * @param input - View data
   * @returns Created view
   */
  createView(input: ViewInput): Promise<View>;

  /**
   * Get a view by ID
   * @param id - View ID
   * @returns View or null
   */
  getView(id: string): View | null;

  /**
   * Update a view
   * @param id - View ID
   * @param input - Updated data
   * @returns Updated view
   */
  updateView(id: string, input: Partial<ViewInput>): Promise<View>;

  /**
   * Delete a view
   * @param id - View ID
   */
  deleteView(id: string): Promise<void>;

  /**
   * List all views
   * @param options - { tag, enabled }
   * @returns Array of views
   */
  listViews(options?: { tag?: string; enabled?: boolean }): View[];

  /**
   * Clone a view
   * @param id - Source view ID
   * @param newId - New view ID
   * @returns Cloned view
   */
  cloneView(id: string, newId: string): Promise<View>;

  // ----------------------------------------
  // DISPLAY MANAGEMENT
  // ----------------------------------------

  /**
   * Add display to view
   * @param viewId - View ID
   * @param display - Display configuration
   * @returns Updated view
   */
  addDisplay(viewId: string, display: Omit<ViewDisplay, 'id'>): Promise<View>;

  /**
   * Update display
   * @param viewId - View ID
   * @param displayId - Display ID
   * @param display - Updated display data
   * @returns Updated view
   */
  updateDisplay(viewId: string, displayId: string, display: Partial<ViewDisplay>): Promise<View>;

  /**
   * Remove display
   * @param viewId - View ID
   * @param displayId - Display ID
   * @returns Updated view
   */
  removeDisplay(viewId: string, displayId: string): Promise<View>;

  // ----------------------------------------
  // FIELD MANAGEMENT
  // ----------------------------------------

  /**
   * Add field to view
   * @param viewId - View ID
   * @param field - Field configuration
   * @returns Updated view
   */
  addField(viewId: string, field: Omit<ViewField, 'id'>): Promise<View>;

  /**
   * Update field
   * @param viewId - View ID
   * @param fieldId - Field ID
   * @param field - Updated field data
   * @returns Updated view
   */
  updateField(viewId: string, fieldId: string, field: Partial<ViewField>): Promise<View>;

  /**
   * Remove field
   * @param viewId - View ID
   * @param fieldId - Field ID
   * @returns Updated view
   */
  removeField(viewId: string, fieldId: string): Promise<View>;

  /**
   * Reorder fields
   * @param viewId - View ID
   * @param fieldIds - Field IDs in desired order
   * @returns Updated view
   */
  reorderFields(viewId: string, fieldIds: string[]): Promise<View>;

  // ----------------------------------------
  // FILTER MANAGEMENT
  // ----------------------------------------

  /**
   * Add filter to view
   * @param viewId - View ID
   * @param filter - Filter configuration
   * @returns Updated view
   */
  addFilter(viewId: string, filter: Omit<ViewFilter, 'id'>): Promise<View>;

  /**
   * Update filter
   * @param viewId - View ID
   * @param filterId - Filter ID
   * @param filter - Updated filter data
   * @returns Updated view
   */
  updateFilter(viewId: string, filterId: string, filter: Partial<ViewFilter>): Promise<View>;

  /**
   * Remove filter
   * @param viewId - View ID
   * @param filterId - Filter ID
   * @returns Updated view
   */
  removeFilter(viewId: string, filterId: string): Promise<View>;

  // ----------------------------------------
  // SORT MANAGEMENT
  // ----------------------------------------

  /**
   * Add sort to view
   * @param viewId - View ID
   * @param sort - Sort configuration
   * @returns Updated view
   */
  addSort(viewId: string, sort: Omit<ViewSort, 'id'>): Promise<View>;

  /**
   * Update sort
   * @param viewId - View ID
   * @param sortId - Sort ID
   * @param sort - Updated sort data
   * @returns Updated view
   */
  updateSort(viewId: string, sortId: string, sort: Partial<ViewSort>): Promise<View>;

  /**
   * Remove sort
   * @param viewId - View ID
   * @param sortId - Sort ID
   * @returns Updated view
   */
  removeSort(viewId: string, sortId: string): Promise<View>;

  // ----------------------------------------
  // RELATIONSHIP MANAGEMENT
  // ----------------------------------------

  /**
   * Add relationship to view
   * @param viewId - View ID
   * @param relationship - Relationship configuration
   * @returns Updated view
   */
  addRelationship(viewId: string, relationship: Omit<ViewRelationship, 'id'>): Promise<View>;

  /**
   * Remove relationship
   * @param viewId - View ID
   * @param relationshipId - Relationship ID
   * @returns Updated view
   */
  removeRelationship(viewId: string, relationshipId: string): Promise<View>;

  // ----------------------------------------
  // EXECUTION
  // ----------------------------------------

  /**
   * Execute a view and return results
   * @param viewId - View ID
   * @param options - Execution options
   * @returns View results
   */
  execute(viewId: string, options?: ViewExecuteOptions): Promise<ViewResult>;

  /**
   * Execute and render a view
   * @param viewId - View ID
   * @param options - Execution options
   * @returns Rendered view
   */
  render(viewId: string, options?: ViewExecuteOptions): Promise<ViewRendered>;

  /**
   * Get exposed filters for a display
   * @param viewId - View ID
   * @param displayId - Display ID
   * @returns Exposed filter configurations
   */
  getExposedFilters(viewId: string, displayId?: string): ExposedFilterConfig[];

  /**
   * Get exposed sorts for a display
   * @param viewId - View ID
   * @param displayId - Display ID
   * @returns Exposed sort configurations
   */
  getExposedSorts(viewId: string, displayId?: string): Array<{ label: string; identifier: string }>;

  // ----------------------------------------
  // CACHING
  // ----------------------------------------

  /**
   * Clear view cache
   * @param viewId - View ID (all if omitted)
   * @param displayId - Display ID (all displays if omitted)
   */
  clearCache(viewId?: string, displayId?: string): void;

  /**
   * Invalidate cache by tag
   * @param tag - Cache tag
   */
  invalidateByTag(tag: string): void;

  // ----------------------------------------
  // UTILITIES
  // ----------------------------------------

  /**
   * Preview a view (execute without saving)
   * @param view - View configuration (unsaved)
   * @param options - Execution options
   * @returns Preview results
   */
  preview(view: ViewInput, options?: ViewExecuteOptions): Promise<ViewResult>;

  /**
   * Get available fields for content type
   * @param contentType - Content type
   * @returns Available fields
   */
  getAvailableFields(contentType: string): Array<{ field: string; label: string; type: string }>;

  /**
   * Export view to portable format
   * @param viewId - View ID
   * @returns Exportable view data
   */
  exportView(viewId: string): View;

  /**
   * Import view from portable format
   * @param data - Exported view data
   * @param options - { overwrite: boolean }
   */
  importView(data: View, options?: { overwrite?: boolean }): Promise<View>;

  /**
   * Register custom formatter
   * @param name - Formatter name
   * @param formatter - Formatter function
   */
  registerFormatter(
    name: string,
    formatter: (value: any, settings: Record<string, any>, item: any) => string
  ): void;
}

// ============================================
// CONFIGURATION
// ============================================

/**
 * Views system configuration
 */
export interface ViewsConfig {
  /** Enable views system */
  enabled?: boolean;

  /** Default items per page */
  defaultItemsPerPage?: number;

  /** Maximum items per page */
  maxItemsPerPage?: number;

  /** Cache configuration */
  cache?: {
    enabled?: boolean;
    defaultMode?: 'none' | 'time' | 'tag';
    defaultMaxAge?: number;
  };

  /** Register routes for page displays */
  registerRoutes?: boolean;
}

// ============================================
// HOOKS
// ============================================

/**
 * Hook: views:beforeExecute
 * Fired before executing a view
 * Context: { view: View, display: ViewDisplay, options: ViewExecuteOptions }
 */

/**
 * Hook: views:afterExecute
 * Fired after executing (can modify results)
 * Context: { view: View, result: ViewResult }
 */

/**
 * Hook: views:beforeRender
 * Fired before rendering
 * Context: { view: View, display: ViewDisplay, result: ViewResult }
 */

/**
 * Hook: views:afterRender
 * Fired after rendering (can modify html)
 * Context: { view: View, html: string }
 */

/**
 * Hook: views:buildQuery
 * Fired when building query (can modify filters/sorts)
 * Context: { view: View, filters: ViewFilter[], sorts: ViewSort[] }
 */

// ============================================
// CLI COMMANDS
// ============================================

/**
 * views:list [--tag=<tag>] - List views
 * views:show <id> - Show view configuration
 * views:create <id> <title> <base-type> - Create view
 * views:delete <id> - Delete view
 * views:execute <id> [--display=<id>] [--limit=<n>] - Execute view
 * views:export <id> [--output=<file>] - Export view
 * views:import <file> [--overwrite] - Import view
 * views:clear-cache [<id>] - Clear view cache
 */

// ============================================
// RENDER CONTEXT STUB (for type reference)
// ============================================

interface RenderContext {
  path: string;
  query: Record<string, string>;
  user?: { id: string; roles: string[] };
  content?: { type: string; id: string; data: any };
  services: any;
  [key: string]: any;
}

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
}
