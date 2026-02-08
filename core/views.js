/**
 * views.js - Views/Query Builder System
 *
 * WHY THIS EXISTS:
 * =====================
 * Views provide a powerful way to query, filter, sort, and display content.
 * Inspired by Drupal Views, this system enables non-developers to create
 * complex content listings without writing code.
 *
 * KEY CONCEPTS:
 * - View definitions: Named query configurations stored in JSON
 * - Filters: Conditions to narrow content selection
 * - Sorts: Order results by field values
 * - Fields: Select which properties to include in results
 * - Display modes: Different renderings (page, block, embed)
 * - Relationships: Join related content types
 * - Contextual filters: Dynamic filters from URL/context
 * - Aggregation: Count, sum, average numeric fields
 *
 * STORAGE STRATEGY:
 * =================
 * /config
 *   /views.json          <- All view definitions
 *
 * WHY FLAT FILE:
 * - Views are configuration, not content
 * - Read frequently, written rarely
 * - Easy to version control and deploy
 * - Small data set (typically < 100 views)
 *
 * DESIGN DECISIONS:
 * =================
 * - Zero external dependencies (Node.js standard library only)
 * - View execution uses content service under the hood
 * - Caching is per-view configurable
 * - Hooks allow extensibility (before/after query, render)
 * - Filters use same operators as content service
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as hooks from './hooks.js';
import * as cache from './cache.js';

/**
 * Module state
 */
let baseDir = null;
let contentService = null;
let hooksService = null;
let viewsPath = null;
let views = {};
let config = {
  enabled: true,
  cacheEnabled: true,
  cacheTTL: 300,
  defaultLimit: 10,
  maxLimit: 100,
};

/**
 * Valid filter operators
 */
const OPERATORS = {
  '=': 'eq',
  '!=': 'ne',
  '>': 'gt',
  '>=': 'gte',
  '<': 'lt',
  '<=': 'lte',
  'contains': 'contains',
  'in': 'in',
  'between': 'between',
  'null': 'null',
  'not_null': 'not_null',
};

/**
 * Valid display modes
 */
const DISPLAY_MODES = ['page', 'block', 'embed', 'feed', 'attachment'];

/**
 * Valid pager types
 */
const PAGER_TYPES = ['full', 'mini', 'infinite', 'none'];

/**
 * Valid aggregation functions
 */
const AGGREGATIONS = ['count', 'sum', 'avg', 'min', 'max'];

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize views system
 *
 * @param {string} dir - Base directory
 * @param {Object} content - Content service
 * @param {Object} hooksRef - Hooks service reference
 * @param {Object} viewsConfig - Configuration
 */
export function init(dir, content, hooksRef = null, viewsConfig = {}) {
  baseDir = dir;
  contentService = content;
  hooksService = hooksRef || hooks;
  config = { ...config, ...viewsConfig };

  // Set up views storage path
  const configDir = join(baseDir, 'config');
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  viewsPath = join(configDir, 'views.json');
  loadViews();
}

// ============================================
// STORAGE MANAGEMENT
// ============================================

/**
 * Load views from disk
 * WHY PRIVATE: Internal state management
 */
function loadViews() {
  if (existsSync(viewsPath)) {
    try {
      const data = JSON.parse(readFileSync(viewsPath, 'utf-8'));
      views = data;
    } catch (e) {
      console.error('[views] Failed to load views:', e.message);
      views = {};
    }
  }
}

/**
 * Save views to disk
 * WHY ATOMIC: Write prevents corruption
 */
function saveViews() {
  try {
    writeFileSync(viewsPath, JSON.stringify(views, null, 2) + '\n');
  } catch (e) {
    console.error('[views] Failed to save views:', e.message);
    throw new Error('Failed to save views configuration');
  }
}

// ============================================
// VIEW MANAGEMENT
// ============================================

/**
 * Validate view configuration
 *
 * @param {Object} viewConfig - View configuration
 * @throws {Error} If validation fails
 */
function validateViewConfig(viewConfig) {
  if (!viewConfig.name) {
    throw new Error('View name is required');
  }

  if (!viewConfig.contentType) {
    throw new Error('View contentType is required');
  }

  if (viewConfig.display && !DISPLAY_MODES.includes(viewConfig.display)) {
    throw new Error(`Invalid display mode: ${viewConfig.display}. Must be one of: ${DISPLAY_MODES.join(', ')}`);
  }

  if (viewConfig.pager?.type && !PAGER_TYPES.includes(viewConfig.pager.type)) {
    throw new Error(`Invalid pager type: ${viewConfig.pager.type}. Must be one of: ${PAGER_TYPES.join(', ')}`);
  }

  // Validate filters
  if (viewConfig.filters) {
    if (!Array.isArray(viewConfig.filters)) {
      throw new Error('View filters must be an array');
    }

    for (const filter of viewConfig.filters) {
      if (!filter.field) {
        throw new Error('Filter field is required');
      }
      if (!filter.op) {
        throw new Error('Filter operator is required');
      }
      if (!OPERATORS[filter.op] && !['null', 'not_null'].includes(filter.op)) {
        throw new Error(`Invalid filter operator: ${filter.op}`);
      }
      if (!['null', 'not_null'].includes(filter.op) && filter.value === undefined) {
        throw new Error(`Filter value is required for operator: ${filter.op}`);
      }
    }
  }

  // Validate filterLogic
  if (viewConfig.filterLogic && !['AND', 'OR'].includes(viewConfig.filterLogic)) {
    throw new Error('View filterLogic must be "AND" or "OR"');
  }

  // Validate sort
  if (viewConfig.sort) {
    if (!Array.isArray(viewConfig.sort)) {
      throw new Error('View sort must be an array');
    }

    for (const sort of viewConfig.sort) {
      if (!sort.field) {
        throw new Error('Sort field is required');
      }
      if (sort.dir && !['asc', 'desc'].includes(sort.dir)) {
        throw new Error(`Invalid sort direction: ${sort.dir}. Must be 'asc' or 'desc'`);
      }
    }
  }

  // Validate aggregation
  if (viewConfig.aggregation) {
    if (!viewConfig.aggregation.function) {
      throw new Error('Aggregation function is required');
    }
    if (!AGGREGATIONS.includes(viewConfig.aggregation.function)) {
      throw new Error(`Invalid aggregation function: ${viewConfig.aggregation.function}. Must be one of: ${AGGREGATIONS.join(', ')}`);
    }
    if (['sum', 'avg', 'min', 'max'].includes(viewConfig.aggregation.function) && !viewConfig.aggregation.field) {
      throw new Error(`Aggregation field is required for function: ${viewConfig.aggregation.function}`);
    }
  }
}

/**
 * Create a new view
 *
 * @param {string} id - View ID
 * @param {Object} viewConfig - View configuration
 * @returns {Promise<Object>} Created view
 */
export async function createView(id, viewConfig) {
  // Validate input
  validateViewConfig(viewConfig);

  // Check for duplicate ID
  if (views[id]) {
    throw new Error(`View "${id}" already exists`);
  }

  // Build view object
  const now = new Date().toISOString();

  // WHY: Build displays array from config. Each display has its own type, settings, path, format.
  // This mirrors Drupal Views where a single view can have page, block, and feed displays.
  const displays = viewConfig.displays || [{
    id: 'default',
    type: viewConfig.display || 'page',
    label: (viewConfig.display || 'page').charAt(0).toUpperCase() + (viewConfig.display || 'page').slice(1),
    path: viewConfig.path || null,
    displayMode: viewConfig.displayMode || 'table',
    template: viewConfig.template || null,
    pager: {
      type: viewConfig.pager?.type || 'full',
      limit: viewConfig.pager?.limit || config.defaultLimit,
    },
    isDefault: true,
  }];

  const view = {
    id,
    name: viewConfig.name,
    description: viewConfig.description || '',
    contentType: viewConfig.contentType,
    display: viewConfig.display || 'page',
    displays,
    path: viewConfig.path || null,
    filters: viewConfig.filters || [],
    filterLogic: viewConfig.filterLogic || 'AND',
    contextualFilters: viewConfig.contextualFilters || [],
    sort: viewConfig.sort || [],
    pager: {
      type: viewConfig.pager?.type || 'full',
      limit: viewConfig.pager?.limit || config.defaultLimit,
      offset: viewConfig.pager?.offset || 0,
    },
    fields: viewConfig.fields || [],
    relationships: viewConfig.relationships || [],
    aggregation: viewConfig.aggregation || null,
    cache: {
      enabled: viewConfig.cache?.enabled ?? config.cacheEnabled,
      ttl: viewConfig.cache?.ttl || config.cacheTTL,
    },
    created: now,
    updated: now,
  };

  // Fire before hook
  await hooksService.trigger('views:beforeCreate', { id, viewConfig, view });

  // Save view
  views[id] = view;
  saveViews();

  // Fire after hook
  await hooksService.trigger('views:afterCreate', { view });

  return view;
}

/**
 * Get a view by ID
 *
 * @param {string} id - View ID
 * @returns {Object|null} View configuration or null
 */
export function getViewConfig(id) {
  return views[id] || null;
}

/**
 * Update a view
 *
 * @param {string} id - View ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated view
 */
export async function updateView(id, updates) {
  const view = views[id];
  if (!view) {
    throw new Error(`View "${id}" not found`);
  }

  // Validate updates
  const updated = { ...view, ...updates };
  validateViewConfig(updated);

  // Fire before hook
  await hooksService.trigger('views:beforeUpdate', { view, updates });

  // Apply updates
  views[id] = {
    ...updated,
    id: view.id, // ID cannot be changed
    created: view.created,
    updated: new Date().toISOString(),
  };

  saveViews();

  // Clear cache for this view
  if (cache.isEnabled && cache.isEnabled()) {
    cache.delete(`view:${id}`);
  }

  // Fire after hook
  await hooksService.trigger('views:afterUpdate', { view: views[id] });

  return views[id];
}

/**
 * Delete a view
 *
 * @param {string} id - View ID
 * @returns {Promise<void>}
 */
export async function deleteView(id) {
  const view = views[id];
  if (!view) {
    throw new Error(`View "${id}" not found`);
  }

  // Fire before hook
  await hooksService.trigger('views:beforeDelete', { view });

  // Delete view
  delete views[id];
  saveViews();

  // Clear cache
  if (cache.isEnabled && cache.isEnabled()) {
    cache.delete(`view:${id}`);
  }

  // Fire after hook
  await hooksService.trigger('views:afterDelete', { viewId: id });
}

/**
 * List all views
 *
 * @param {Object} options - Filtering options
 * @returns {Array<Object>} Array of views
 */
export function listViews(options = {}) {
  let viewList = Object.values(views);

  // Filter by content type
  if (options.contentType) {
    viewList = viewList.filter(v => v.contentType === options.contentType);
  }

  // Filter by display mode
  if (options.display) {
    viewList = viewList.filter(v => v.display === options.display);
  }

  return viewList;
}

// ============================================
// VIEW EXECUTION
// ============================================

/**
 * Apply contextual filters to view
 *
 * @param {Object} view - View configuration
 * @param {Object} context - Execution context
 * @returns {Array} Resolved filters
 */
function applyContextualFilters(view, context) {
  const filters = [...view.filters];

  if (!view.contextualFilters || view.contextualFilters.length === 0) {
    return filters;
  }

  for (const ctxFilter of view.contextualFilters) {
    let value = null;

    // Resolve contextual filter value
    switch (ctxFilter.source) {
      case 'url':
        // URL argument: /articles/:category
        value = context.params?.[ctxFilter.param];
        break;

      case 'user':
        // Current user property
        value = context.user?.[ctxFilter.field];
        break;

      case 'date':
        // Date-based filtering
        value = new Date().toISOString();
        if (ctxFilter.adjust) {
          // Apply date adjustments (e.g., -7 days)
          const date = new Date(value);
          if (ctxFilter.adjust.days) {
            date.setDate(date.getDate() + ctxFilter.adjust.days);
          }
          value = date.toISOString();
        }
        break;

      case 'query':
        // Query string parameter
        value = context.query?.[ctxFilter.param];
        break;

      default:
        // Custom source via context
        value = context[ctxFilter.source];
    }

    // Skip if no value and filter is optional
    if (value === null || value === undefined) {
      if (ctxFilter.required) {
        throw new Error(`Required contextual filter not provided: ${ctxFilter.source}`);
      }
      continue;
    }

    // Add resolved filter
    filters.push({
      field: ctxFilter.field,
      op: ctxFilter.op || '=',
      value,
    });
  }

  return filters;
}

/**
 * Apply field selection to results
 *
 * @param {Array} items - Content items
 * @param {Array} fields - Fields to select
 * @returns {Array} Items with selected fields
 */
function selectFields(items, fields) {
  if (!fields || fields.length === 0) {
    return items;
  }

  // WHY: Fields can be strings ("title") or objects ({name: "title", label: "Custom Title", formatter: "raw"}).
  // Normalize to extract field names for data selection.
  const fieldNames = fields.map(f => typeof f === 'string' ? f : (f.name || f));

  return items.map(item => {
    const selected = {};

    // Always include system fields
    selected.id = item.id;
    selected.type = item.type;

    // Include selected fields
    for (const fieldName of fieldNames) {
      if (item[fieldName] !== undefined) {
        selected[fieldName] = item[fieldName];
      }
    }

    return selected;
  });
}

/**
 * Apply aggregation to results
 *
 * @param {Array} items - Content items
 * @param {Object} aggregation - Aggregation config
 * @returns {Object} Aggregated result
 */
function applyAggregation(items, aggregation) {
  if (!aggregation) {
    return null;
  }

  const func = aggregation.function;
  const field = aggregation.field;

  switch (func) {
    case 'count':
      return { count: items.length };

    case 'sum':
      return {
        sum: items.reduce((acc, item) => {
          const value = Number(item[field]) || 0;
          return acc + value;
        }, 0),
      };

    case 'avg':
      if (items.length === 0) return { avg: 0 };
      const sum = items.reduce((acc, item) => {
        const value = Number(item[field]) || 0;
        return acc + value;
      }, 0);
      return { avg: sum / items.length };

    case 'min':
      if (items.length === 0) return { min: null };
      return {
        min: items.reduce((min, item) => {
          const value = Number(item[field]);
          return value < min ? value : min;
        }, Number.MAX_VALUE),
      };

    case 'max':
      if (items.length === 0) return { max: null };
      return {
        max: items.reduce((max, item) => {
          const value = Number(item[field]);
          return value > max ? value : max;
        }, Number.MIN_VALUE),
      };

    default:
      return null;
  }
}

/**
 * Apply relationships to load referenced content
 *
 * @param {Array} items - Content items
 * @param {Array} relationships - Relationship configs
 * @returns {Promise<Array>} Items with related content loaded
 */
async function applyRelationships(items, relationships) {
  if (!relationships || relationships.length === 0) {
    return items;
  }

  for (const rel of relationships) {
    for (const item of items) {
      const refId = item[rel.field];
      if (!refId) continue;

      try {
        const related = contentService.read(rel.contentType, refId);
        item[rel.alias || `${rel.field}_ref`] = related;
      } catch (e) {
        // Related content not found - skip
        item[rel.alias || `${rel.field}_ref`] = null;
      }
    }
  }

  return items;
}

/**
 * Execute a view query
 *
 * @param {string} id - View ID
 * @param {Object} context - Execution context
 * @returns {Promise<Object>} Query results
 */
export async function executeView(id, context = {}) {
  const view = views[id];
  if (!view) {
    throw new Error(`View "${id}" not found`);
  }

  // Check cache
  const cacheKey = `view:${id}:${JSON.stringify(context)}`;
  if (view.cache.enabled && cache.isEnabled && cache.isEnabled()) {
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  // Fire before query hook
  await hooksService.trigger('views:beforeQuery', { view, context });

  // Apply contextual filters
  let filters = applyContextualFilters(view, context);

  // WHY: Handle exposed filters - override from query params or remove if not provided
  // Exposed filters allow end users to dynamically filter results via form inputs.
  // When exposed=true:
  //   - If query param present with value → use that value
  //   - If query param present but empty → remove filter (show all)
  //   - If query param not present → remove filter (default for exposed is "show all")
  // This differs from non-exposed filters which always use their configured value.
  const queryParams = context.query || {};
  filters = filters.map(filter => {
    if (filter.exposed) {
      // Exposed filter behavior
      if (queryParams.hasOwnProperty(filter.field)) {
        const queryValue = queryParams[filter.field];

        // Empty query param = remove this filter (show all)
        if (queryValue === '') {
          return null;
        }

        // Override filter value with query param
        return {
          ...filter,
          value: queryValue,
        };
      } else {
        // WHY: No query param for exposed filter = don't filter (show all)
        // This allows the "Reset" link to work by removing all query params
        return null;
      }
    }
    return filter;
  }).filter(f => f !== null); // Remove null entries (empty/missing exposed filters)

  // WHY: Convert array-format filters to object-format for content.list()
  // content.list() expects filters as { "field": value, "field__op": value }
  // e.g. { "status": "published", "title__contains": "test" }
  // Views stores filters as array of { field, op, value } objects
  const filterObj = {};
  for (const f of filters) {
    const op = OPERATORS[f.op] || f.op;
    // 'eq' operator uses plain field name; others use field__op suffix
    const key = op === 'eq' ? f.field : `${f.field}__${op}`;
    filterObj[key] = f.value;
  }

  // Build query options
  const queryOptions = {
    filters: filterObj,
    filterLogic: view.filterLogic || 'AND',
    sortBy: view.sort[0]?.field || 'created',
    sortOrder: view.sort[0]?.dir || 'desc',
    page: view.pager.offset ? Math.floor(view.pager.offset / Math.min(view.pager.limit, config.maxLimit)) + 1 : 1,
    limit: Math.min(view.pager.limit, config.maxLimit),
  };

  // Apply additional sorts (content service only supports single sort, so we handle multiple sorts post-query)
  const additionalSorts = view.sort.slice(1);

  // Execute query
  let result = contentService.list(view.contentType, queryOptions);

  // Apply additional sorts if needed
  if (additionalSorts.length > 0) {
    result.items.sort((a, b) => {
      for (const sort of additionalSorts) {
        const aVal = a[sort.field];
        const bVal = b[sort.field];
        const dir = sort.dir === 'desc' ? -1 : 1;

        if (aVal < bVal) return -1 * dir;
        if (aVal > bVal) return 1 * dir;
      }
      return 0;
    });
  }

  // Fire after query hook (allows modification of results)
  await hooksService.trigger('views:afterQuery', { view, context, result });

  // Apply relationships
  if (view.relationships.length > 0) {
    result.items = await applyRelationships(result.items, view.relationships);
  }

  // Apply field selection
  if (view.fields.length > 0) {
    result.items = selectFields(result.items, view.fields);
  }

  // Apply aggregation
  let aggregated = null;
  if (view.aggregation) {
    aggregated = applyAggregation(result.items, view.aggregation);
  }

  // Build final result
  const finalResult = {
    view: {
      id: view.id,
      name: view.name,
      display: view.display,
    },
    items: result.items,
    total: result.total,
    offset: view.pager.offset,
    limit: view.pager.limit,
    pager: {
      type: view.pager.type,
      currentPage: Math.floor(view.pager.offset / view.pager.limit),
      totalPages: Math.ceil(result.total / view.pager.limit),
      hasNext: view.pager.offset + view.pager.limit < result.total,
      hasPrev: view.pager.offset > 0,
    },
    aggregation: aggregated,
  };

  // Cache result
  if (view.cache.enabled && cache.isEnabled && cache.isEnabled()) {
    cache.set(cacheKey, finalResult, view.cache.ttl);
  }

  return finalResult;
}

/**
 * Render view with template
 *
 * @param {string} id - View ID
 * @param {Object} context - Execution context
 * @param {Function} template - Template function (items, view) => string
 * @returns {Promise<string>} Rendered HTML
 */
export async function renderView(id, context = {}, template = null) {
  const result = await executeView(id, context);

  // Fire before render hook
  await hooksService.trigger('views:beforeRender', { view: result.view, result, context });

  // Use provided template or default
  let rendered = '';
  if (template) {
    rendered = template(result.items, result.view);
  } else {
    // Default JSON rendering
    rendered = JSON.stringify(result, null, 2);
  }

  // Fire after render hook
  await hooksService.trigger('views:afterRender', { view: result.view, result, rendered });

  return rendered;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Add filter to view
 *
 * @param {string} viewId - View ID
 * @param {Object} filter - Filter configuration
 * @returns {Promise<Object>} Updated view
 */
export async function addFilter(viewId, filter) {
  const view = views[viewId];
  if (!view) {
    throw new Error(`View "${viewId}" not found`);
  }

  const filters = [...view.filters, filter];
  return updateView(viewId, { filters });
}

/**
 * Add sort to view
 *
 * @param {string} viewId - View ID
 * @param {Object} sort - Sort configuration
 * @returns {Promise<Object>} Updated view
 */
export async function addSort(viewId, sort) {
  const view = views[viewId];
  if (!view) {
    throw new Error(`View "${viewId}" not found`);
  }

  const sorts = [...view.sort, sort];
  return updateView(viewId, { sort: sorts });
}

/**
 * Set fields to display
 *
 * @param {string} viewId - View ID
 * @param {Array<string>} fields - Field names
 * @returns {Promise<Object>} Updated view
 */
export async function setFields(viewId, fields) {
  const view = views[viewId];
  if (!view) {
    throw new Error(`View "${viewId}" not found`);
  }

  return updateView(viewId, { fields });
}

/**
 * Get configuration
 *
 * @returns {Object} Current configuration
 */
export function getConfig() {
  return { ...config };
}

/**
 * Check if views system is enabled
 *
 * @returns {boolean}
 */
export function isEnabled() {
  return config.enabled;
}

// ============================================
// DISPLAY MANAGEMENT
// ============================================

/**
 * Add a display to a view
 *
 * WHY: Drupal Views support multiple displays per view (page, block, feed).
 * Each display has its own settings (path, format, pager) while sharing
 * the underlying query configuration. This enables a single view to
 * render as both a page at /articles and a sidebar block.
 *
 * @param {string} viewId - View ID
 * @param {Object} displayConfig - Display configuration
 * @returns {Promise<Object>} Created display
 */
export async function addDisplay(viewId, displayConfig) {
  const view = views[viewId];
  if (!view) {
    throw new Error(`View "${viewId}" not found`);
  }

  if (!view.displays) view.displays = [];

  // WHY: Generate unique display ID by counting existing displays of same type.
  // Drupal uses this pattern (page_1, page_2, block_1) to allow multiple
  // displays of the same type on a single view.
  const typeCount = view.displays.filter(d => d.type === displayConfig.type).length;
  const displayId = displayConfig.type + '_' + (typeCount + 1);

  const display = {
    id: displayId,
    type: displayConfig.type,
    label: displayConfig.label || displayConfig.type.charAt(0).toUpperCase() + displayConfig.type.slice(1),
    path: displayConfig.path || null,
    displayMode: displayConfig.displayMode || 'table',
    template: displayConfig.template || null,
    pager: {
      type: displayConfig.pager?.type || 'full',
      limit: displayConfig.pager?.limit || config.defaultLimit,
    },
    isDefault: view.displays.length === 0,
  };

  view.displays.push(display);
  view.updated = new Date().toISOString();
  saveViews();

  // Fire hook so other modules can react
  await hooksService.trigger('views:displayAdded', { viewId, display });

  return display;
}

/**
 * Update a display's settings
 *
 * WHY: Each display has independent settings (title, format, path, pager).
 * Updating one display should not affect others in the same view.
 *
 * @param {string} viewId - View ID
 * @param {string} displayId - Display ID within the view
 * @param {Object} updates - Fields to update on the display
 * @returns {Promise<Object>} Updated display
 */
export async function updateDisplay(viewId, displayId, updates) {
  const view = views[viewId];
  if (!view) {
    throw new Error(`View "${viewId}" not found`);
  }

  const display = view.displays?.find(d => d.id === displayId);
  if (!display) {
    throw new Error(`Display "${displayId}" not found in view "${viewId}"`);
  }

  // WHY: Selective merge - preserve fields not in updates, overwrite those that are.
  // Special handling for nested pager object to avoid losing settings.
  if (updates.pager) {
    display.pager = { ...display.pager, ...updates.pager };
    delete updates.pager;
  }
  Object.assign(display, updates);

  view.updated = new Date().toISOString();
  saveViews();

  await hooksService.trigger('views:displayUpdated', { viewId, displayId, display });

  return display;
}

/**
 * Remove a display from a view
 *
 * @param {string} viewId - View ID
 * @param {string} displayId - Display ID to remove
 * @returns {Promise<void>}
 */
export async function removeDisplay(viewId, displayId) {
  const view = views[viewId];
  if (!view) {
    throw new Error(`View "${viewId}" not found`);
  }

  const idx = view.displays?.findIndex(d => d.id === displayId);
  if (idx === undefined || idx === -1) {
    throw new Error(`Display "${displayId}" not found in view "${viewId}"`);
  }

  const removed = view.displays.splice(idx, 1)[0];
  view.updated = new Date().toISOString();
  saveViews();

  await hooksService.trigger('views:displayRemoved', { viewId, displayId, display: removed });
}

/**
 * Get views that have page displays with paths configured
 *
 * WHY: Page displays with paths need to be served as actual URL routes.
 * This function collects all such routes so the server can register them.
 * Checks both the new per-display path and the legacy top-level path.
 *
 * @returns {Array<Object>} Array of { viewId, displayId, path, view, display }
 */
export function getPageDisplayRoutes() {
  const routes = [];
  for (const view of Object.values(views)) {
    // Check displays array for page displays with paths
    if (view.displays && Array.isArray(view.displays)) {
      for (const display of view.displays) {
        if (display.type === 'page' && display.path) {
          routes.push({
            viewId: view.id,
            displayId: display.id,
            path: display.path,
            view,
            display,
          });
        }
      }
    }

    // WHY: Also check legacy top-level path for backward compatibility.
    // Older views may have path set at the view level instead of per-display.
    if (view.path && view.display === 'page') {
      // Avoid duplicates if the same path is already in a display
      const alreadyAdded = routes.some(r => r.viewId === view.id && r.path === view.path);
      if (!alreadyAdded) {
        routes.push({
          viewId: view.id,
          displayId: 'default',
          path: view.path,
          view,
          display: view.displays?.[0] || { type: 'page', displayMode: 'table' },
        });
      }
    }
  }
  return routes;
}
