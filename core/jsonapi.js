/**
 * jsonapi.js - JSON:API Specification Compliant API
 *
 * WHY THIS EXISTS:
 * =================
 * JSON:API (https://jsonapi.org) is a specification for building APIs in JSON.
 * It provides standardized:
 *
 * - Resource objects with type/id/attributes/relationships
 * - Compound documents (includes)
 * - Sparse fieldsets
 * - Sorting, pagination, filtering
 * - Error objects
 *
 * This module provides a fully spec-compliant JSON:API layer on top of
 * the content service, enabling headless CMS usage with any frontend.
 *
 * SPEC COMPLIANCE:
 * ================
 * - JSON:API 1.1 (https://jsonapi.org/format/1.1/)
 * - Content-Type: application/vnd.api+json
 * - Compound documents with ?include=
 * - Sparse fieldsets with ?fields[type]=
 * - Sorting with ?sort=
 * - Pagination with ?page[offset]= and ?page[limit]=
 * - Filtering with ?filter[field][op]=value
 *
 * ROUTES:
 * =======
 * GET    /jsonapi/{type}           List resources
 * POST   /jsonapi/{type}           Create resource
 * GET    /jsonapi/{type}/{id}      Get single resource
 * PATCH  /jsonapi/{type}/{id}      Update resource
 * DELETE /jsonapi/{type}/{id}      Delete resource
 * GET    /jsonapi/{type}/{id}/relationships/{rel}  Get relationship
 * PATCH  /jsonapi/{type}/{id}/relationships/{rel}  Update relationship
 *
 * DESIGN DECISIONS:
 * =================
 * - Separate from existing GraphQL/REST APIs
 * - Uses content service for storage
 * - Hooks for custom filtering/transformations
 * - Relationship handling via entity-reference service
 */

import { join } from 'node:path';

// ============================================
// MODULE STATE
// ============================================

let contentService = null;
let entityReferenceService = null;
let authService = null;
let hooksService = null;
let routerService = null;

/**
 * Resource type configurations
 * Structure: { type: ResourceConfig, ... }
 */
const resourceConfigs = {};

/**
 * Configuration
 */
let config = {
  enabled: true,
  basePath: '/jsonapi',
  defaultPageLimit: 20,
  maxPageLimit: 100,
  includeDepth: 3,
  allowAnonymousRead: true,
  allowAnonymousWrite: false,
};

// ============================================
// CONSTANTS
// ============================================

const CONTENT_TYPE = 'application/vnd.api+json';
const API_VERSION = '1.1';

// ============================================
// TYPE DEFINITIONS (JSDoc)
// ============================================

/**
 * @typedef {Object} ResourceConfig
 * @property {string} type - JSON:API type name
 * @property {string} contentType - Internal content type name
 * @property {Object} attributes - Attribute mappings
 * @property {Object} relationships - Relationship definitions
 * @property {string[]} defaultFields - Default fields to include
 * @property {boolean} publicRead - Allow anonymous read
 * @property {boolean} publicWrite - Allow anonymous write
 */

/**
 * @typedef {Object} JsonApiDocument
 * @property {Object|Object[]} data - Primary data
 * @property {Object[]} included - Included resources
 * @property {Object} meta - Meta information
 * @property {Object} links - Pagination/self links
 * @property {Object[]} errors - Error objects
 */

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize JSON:API module
 *
 * @param {Object} options - Initialization options
 */
export function init(options = {}) {
  contentService = options.content;
  entityReferenceService = options.entityReference;
  authService = options.auth;
  hooksService = options.hooks;
  routerService = options.router;

  if (options.config) {
    config = { ...config, ...options.config };
  }

  // Auto-register routes if router provided
  if (routerService && config.enabled) {
    registerRoutes();
  }

  console.log(`[jsonapi] Initialized (base: ${config.basePath})`);
}

// ============================================
// ROUTE REGISTRATION
// ============================================

/**
 * Register all JSON:API routes
 */
function registerRoutes() {
  const base = config.basePath;

  // Entry point
  routerService.register('GET', base, handleEntryPoint, 'JSON:API entry point');

  // Collection routes
  routerService.register('GET', `${base}/:type`, handleCollection, 'List resources');
  routerService.register('POST', `${base}/:type`, handleCreate, 'Create resource');

  // Individual routes
  routerService.register('GET', `${base}/:type/:id`, handleRead, 'Get resource');
  routerService.register('PATCH', `${base}/:type/:id`, handleUpdate, 'Update resource');
  routerService.register('DELETE', `${base}/:type/:id`, handleDelete, 'Delete resource');

  // Relationship routes
  routerService.register('GET', `${base}/:type/:id/relationships/:relationship`, handleRelationshipRead, 'Get relationship');
  routerService.register('PATCH', `${base}/:type/:id/relationships/:relationship`, handleRelationshipUpdate, 'Update relationship');
}

// ============================================
// RESOURCE CONFIGURATION
// ============================================

/**
 * Register a resource type for JSON:API
 *
 * @param {ResourceConfig} resourceConfig - Resource configuration
 */
export function registerResource(resourceConfig) {
  if (!resourceConfig.type) {
    throw new Error('Resource type is required');
  }

  resourceConfigs[resourceConfig.type] = {
    type: resourceConfig.type,
    contentType: resourceConfig.contentType || resourceConfig.type,
    attributes: resourceConfig.attributes || {},
    relationships: resourceConfig.relationships || {},
    defaultFields: resourceConfig.defaultFields || null,
    publicRead: resourceConfig.publicRead ?? config.allowAnonymousRead,
    publicWrite: resourceConfig.publicWrite ?? config.allowAnonymousWrite,
  };

  return resourceConfigs[resourceConfig.type];
}

/**
 * Get resource configuration
 *
 * @param {string} type - Resource type
 * @returns {ResourceConfig|null}
 */
function getResourceConfig(type) {
  return resourceConfigs[type] || null;
}

/**
 * Auto-register content types as resources
 */
export function autoRegisterContentTypes() {
  if (!contentService) return;

  const types = contentService.listTypes();
  for (const typeInfo of types) {
    if (!resourceConfigs[typeInfo.type]) {
      registerResource({
        type: typeInfo.type,
        contentType: typeInfo.type,
      });
    }
  }
}

// ============================================
// REQUEST PARSING
// ============================================

/**
 * Parse JSON:API query parameters
 *
 * @param {URL} url - Request URL
 * @returns {Object} - Parsed parameters
 */
function parseQueryParams(url) {
  const params = {
    include: [],
    fields: {},
    filter: {},
    sort: [],
    page: {
      offset: 0,
      limit: config.defaultPageLimit,
    },
  };

  // Parse include
  const include = url.searchParams.get('include');
  if (include) {
    params.include = include.split(',').map(s => s.trim());
  }

  // Parse fields (sparse fieldsets)
  for (const [key, value] of url.searchParams.entries()) {
    const fieldsMatch = key.match(/^fields\[([^\]]+)\]$/);
    if (fieldsMatch) {
      params.fields[fieldsMatch[1]] = value.split(',').map(s => s.trim());
    }
  }

  // Parse filter
  for (const [key, value] of url.searchParams.entries()) {
    const filterMatch = key.match(/^filter\[([^\]]+)\](?:\[([^\]]+)\])?$/);
    if (filterMatch) {
      const field = filterMatch[1];
      const op = filterMatch[2] || 'eq';
      params.filter[field] = { op, value };
    }
  }

  // Parse sort
  const sort = url.searchParams.get('sort');
  if (sort) {
    params.sort = sort.split(',').map(field => {
      if (field.startsWith('-')) {
        return { field: field.slice(1), order: 'desc' };
      }
      return { field, order: 'asc' };
    });
  }

  // Parse pagination
  const pageOffset = url.searchParams.get('page[offset]');
  const pageLimit = url.searchParams.get('page[limit]');
  const pageNumber = url.searchParams.get('page[number]');
  const pageSize = url.searchParams.get('page[size]');

  if (pageOffset != null) {
    params.page.offset = parseInt(pageOffset) || 0;
  }
  if (pageLimit != null) {
    params.page.limit = Math.min(parseInt(pageLimit) || config.defaultPageLimit, config.maxPageLimit);
  }
  // Also support page[number]/page[size] style
  if (pageNumber != null && pageSize != null) {
    const size = Math.min(parseInt(pageSize) || config.defaultPageLimit, config.maxPageLimit);
    const number = parseInt(pageNumber) || 1;
    params.page.offset = (number - 1) * size;
    params.page.limit = size;
  }

  return params;
}

/**
 * Parse request body as JSON:API document
 *
 * @param {IncomingMessage} req - HTTP request
 * @returns {Promise<Object>}
 */
async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const doc = JSON.parse(body);
        resolve(doc);
      } catch (e) {
        reject(new JsonApiError(400, 'Invalid JSON', 'Request body is not valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// ============================================
// RESPONSE BUILDING
// ============================================

/**
 * Convert internal content to JSON:API resource object
 *
 * @param {Object} item - Content item
 * @param {string} type - Resource type
 * @param {string[]} fields - Fields to include (sparse fieldset)
 * @returns {Object}
 */
function toResource(item, type, fields = null) {
  const resourceConfig = getResourceConfig(type);

  // Build attributes
  const attributes = {};
  const schema = contentService?.getSchema?.(resourceConfig?.contentType || type) || {};

  for (const [key, value] of Object.entries(item)) {
    // Skip system fields and relationships
    if (['id', 'type', 'created', 'updated', '_id'].includes(key)) continue;
    if (key.startsWith('_')) continue;

    // Apply sparse fieldset
    if (fields && !fields.includes(key)) continue;

    attributes[key] = value;
  }

  // Build relationships
  const relationships = {};
  if (resourceConfig?.relationships) {
    for (const [relName, relConfig] of Object.entries(resourceConfig.relationships)) {
      const relValue = item[relConfig.field || relName];
      if (relValue) {
        relationships[relName] = {
          data: Array.isArray(relValue)
            ? relValue.map(id => ({ type: relConfig.type, id }))
            : { type: relConfig.type, id: relValue },
          links: {
            self: `${config.basePath}/${type}/${item.id}/relationships/${relName}`,
            related: `${config.basePath}/${type}/${item.id}/${relName}`,
          },
        };
      }
    }
  }

  const resource = {
    type,
    id: item.id,
    attributes,
  };

  if (Object.keys(relationships).length > 0) {
    resource.relationships = relationships;
  }

  resource.links = {
    self: `${config.basePath}/${type}/${item.id}`,
  };

  return resource;
}

/**
 * Convert JSON:API resource to internal format
 *
 * @param {Object} resource - JSON:API resource
 * @returns {Object}
 */
function fromResource(resource) {
  const data = { ...resource.attributes };

  // Add relationships
  if (resource.relationships) {
    for (const [relName, relData] of Object.entries(resource.relationships)) {
      if (relData.data) {
        data[relName] = Array.isArray(relData.data)
          ? relData.data.map(r => r.id)
          : relData.data.id;
      }
    }
  }

  return data;
}

/**
 * Build JSON:API response
 *
 * @param {Object} res - HTTP response
 * @param {Object} document - JSON:API document
 * @param {number} status - HTTP status code
 */
function sendJsonApi(res, document, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', CONTENT_TYPE);

  const output = {
    jsonapi: { version: API_VERSION },
    ...document,
  };

  res.end(JSON.stringify(output, null, 2));
}

/**
 * Send JSON:API error response
 *
 * @param {Object} res - HTTP response
 * @param {JsonApiError|Error} error - Error object
 */
function sendError(res, error) {
  const status = error.status || 500;
  const errorObj = {
    status: String(status),
    title: error.title || error.message || 'Error',
    detail: error.detail || error.message,
  };

  if (error.source) {
    errorObj.source = error.source;
  }

  sendJsonApi(res, { errors: [errorObj] }, status);
}

// ============================================
// ERROR CLASS
// ============================================

/**
 * JSON:API Error class
 */
class JsonApiError extends Error {
  constructor(status, title, detail, source = null) {
    super(detail);
    this.status = status;
    this.title = title;
    this.detail = detail;
    this.source = source;
  }
}

// ============================================
// ROUTE HANDLERS
// ============================================

/**
 * Handle entry point (GET /jsonapi)
 */
async function handleEntryPoint(req, res, params, ctx) {
  const links = {};

  // List all available types
  for (const type of Object.keys(resourceConfigs)) {
    links[type] = `${config.basePath}/${type}`;
  }

  sendJsonApi(res, {
    meta: {
      version: API_VERSION,
      baseUrl: config.basePath,
    },
    links,
  });
}

/**
 * Handle collection GET (list resources)
 */
async function handleCollection(req, res, params, ctx) {
  const { type } = params;

  // Check resource exists
  const resourceConfig = getResourceConfig(type);
  if (!resourceConfig) {
    sendError(res, new JsonApiError(404, 'Not Found', `Resource type "${type}" not found`));
    return;
  }

  // Check auth
  if (!resourceConfig.publicRead && !ctx.user) {
    sendError(res, new JsonApiError(401, 'Unauthorized', 'Authentication required'));
    return;
  }

  try {
    const url = new URL(req.url, 'http://localhost');
    const queryParams = parseQueryParams(url);

    // Build content query options
    const queryOptions = {
      offset: queryParams.page.offset,
      limit: queryParams.page.limit,
      sort: queryParams.sort[0]?.field || 'created',
      order: queryParams.sort[0]?.order || 'desc',
      filters: [],
    };

    // Convert filters
    for (const [field, filter] of Object.entries(queryParams.filter)) {
      queryOptions.filters.push({
        field,
        op: filter.op,
        value: filter.value,
      });
    }

    // Execute query
    const result = contentService.list(resourceConfig.contentType, queryOptions);

    // Convert to JSON:API resources
    const fields = queryParams.fields[type] || null;
    const data = result.items.map(item => toResource(item, type, fields));

    // Handle includes
    const included = [];
    if (queryParams.include.length > 0) {
      for (const item of result.items) {
        await resolveIncludes(item, type, queryParams.include, included, queryParams.fields, 0);
      }
    }

    // Build pagination links
    const links = {
      self: `${config.basePath}/${type}`,
    };

    if (queryParams.page.offset > 0) {
      const prevOffset = Math.max(0, queryParams.page.offset - queryParams.page.limit);
      links.prev = `${config.basePath}/${type}?page[offset]=${prevOffset}&page[limit]=${queryParams.page.limit}`;
    }

    if (queryParams.page.offset + queryParams.page.limit < result.total) {
      const nextOffset = queryParams.page.offset + queryParams.page.limit;
      links.next = `${config.basePath}/${type}?page[offset]=${nextOffset}&page[limit]=${queryParams.page.limit}`;
    }

    const document = {
      data,
      meta: {
        total: result.total,
        offset: queryParams.page.offset,
        limit: queryParams.page.limit,
      },
      links,
    };

    if (included.length > 0) {
      document.included = deduplicateIncluded(included);
    }

    sendJsonApi(res, document);
  } catch (e) {
    sendError(res, e);
  }
}

/**
 * Handle single resource GET
 */
async function handleRead(req, res, params, ctx) {
  const { type, id } = params;

  const resourceConfig = getResourceConfig(type);
  if (!resourceConfig) {
    sendError(res, new JsonApiError(404, 'Not Found', `Resource type "${type}" not found`));
    return;
  }

  if (!resourceConfig.publicRead && !ctx.user) {
    sendError(res, new JsonApiError(401, 'Unauthorized', 'Authentication required'));
    return;
  }

  try {
    const item = contentService.read(resourceConfig.contentType, id);
    if (!item) {
      sendError(res, new JsonApiError(404, 'Not Found', `Resource "${type}/${id}" not found`));
      return;
    }

    const url = new URL(req.url, 'http://localhost');
    const queryParams = parseQueryParams(url);

    const fields = queryParams.fields[type] || null;
    const data = toResource(item, type, fields);

    // Handle includes
    const included = [];
    if (queryParams.include.length > 0) {
      await resolveIncludes(item, type, queryParams.include, included, queryParams.fields, 0);
    }

    const document = {
      data,
      links: {
        self: `${config.basePath}/${type}/${id}`,
      },
    };

    if (included.length > 0) {
      document.included = deduplicateIncluded(included);
    }

    sendJsonApi(res, document);
  } catch (e) {
    sendError(res, e);
  }
}

/**
 * Handle resource creation
 */
async function handleCreate(req, res, params, ctx) {
  const { type } = params;

  const resourceConfig = getResourceConfig(type);
  if (!resourceConfig) {
    sendError(res, new JsonApiError(404, 'Not Found', `Resource type "${type}" not found`));
    return;
  }

  if (!resourceConfig.publicWrite && !ctx.user) {
    sendError(res, new JsonApiError(401, 'Unauthorized', 'Authentication required'));
    return;
  }

  try {
    const doc = await parseBody(req);

    if (!doc.data) {
      throw new JsonApiError(400, 'Bad Request', 'Missing data object');
    }

    if (doc.data.type !== type) {
      throw new JsonApiError(409, 'Conflict', `Type mismatch: expected "${type}", got "${doc.data.type}"`);
    }

    const data = fromResource(doc.data);
    const created = await contentService.create(resourceConfig.contentType, data);

    sendJsonApi(res, {
      data: toResource(created, type),
      links: {
        self: `${config.basePath}/${type}/${created.id}`,
      },
    }, 201);
  } catch (e) {
    sendError(res, e);
  }
}

/**
 * Handle resource update
 */
async function handleUpdate(req, res, params, ctx) {
  const { type, id } = params;

  const resourceConfig = getResourceConfig(type);
  if (!resourceConfig) {
    sendError(res, new JsonApiError(404, 'Not Found', `Resource type "${type}" not found`));
    return;
  }

  if (!resourceConfig.publicWrite && !ctx.user) {
    sendError(res, new JsonApiError(401, 'Unauthorized', 'Authentication required'));
    return;
  }

  try {
    const existing = contentService.read(resourceConfig.contentType, id);
    if (!existing) {
      sendError(res, new JsonApiError(404, 'Not Found', `Resource "${type}/${id}" not found`));
      return;
    }

    const doc = await parseBody(req);

    if (!doc.data) {
      throw new JsonApiError(400, 'Bad Request', 'Missing data object');
    }

    if (doc.data.type !== type) {
      throw new JsonApiError(409, 'Conflict', `Type mismatch: expected "${type}", got "${doc.data.type}"`);
    }

    if (doc.data.id !== id) {
      throw new JsonApiError(409, 'Conflict', `ID mismatch: expected "${id}", got "${doc.data.id}"`);
    }

    const data = fromResource(doc.data);
    const updated = await contentService.update(resourceConfig.contentType, id, data);

    sendJsonApi(res, {
      data: toResource(updated, type),
      links: {
        self: `${config.basePath}/${type}/${id}`,
      },
    });
  } catch (e) {
    sendError(res, e);
  }
}

/**
 * Handle resource deletion
 */
async function handleDelete(req, res, params, ctx) {
  const { type, id } = params;

  const resourceConfig = getResourceConfig(type);
  if (!resourceConfig) {
    sendError(res, new JsonApiError(404, 'Not Found', `Resource type "${type}" not found`));
    return;
  }

  if (!resourceConfig.publicWrite && !ctx.user) {
    sendError(res, new JsonApiError(401, 'Unauthorized', 'Authentication required'));
    return;
  }

  try {
    const existing = contentService.read(resourceConfig.contentType, id);
    if (!existing) {
      sendError(res, new JsonApiError(404, 'Not Found', `Resource "${type}/${id}" not found`));
      return;
    }

    await contentService.remove(resourceConfig.contentType, id);

    res.statusCode = 204;
    res.end();
  } catch (e) {
    sendError(res, e);
  }
}

/**
 * Handle relationship read
 */
async function handleRelationshipRead(req, res, params, ctx) {
  const { type, id, relationship } = params;

  const resourceConfig = getResourceConfig(type);
  if (!resourceConfig) {
    sendError(res, new JsonApiError(404, 'Not Found', `Resource type "${type}" not found`));
    return;
  }

  const relConfig = resourceConfig.relationships?.[relationship];
  if (!relConfig) {
    sendError(res, new JsonApiError(404, 'Not Found', `Relationship "${relationship}" not found`));
    return;
  }

  try {
    const item = contentService.read(resourceConfig.contentType, id);
    if (!item) {
      sendError(res, new JsonApiError(404, 'Not Found', `Resource "${type}/${id}" not found`));
      return;
    }

    const field = relConfig.field || relationship;
    const relValue = item[field];

    let data = null;
    if (relValue) {
      data = Array.isArray(relValue)
        ? relValue.map(rid => ({ type: relConfig.type, id: rid }))
        : { type: relConfig.type, id: relValue };
    }

    sendJsonApi(res, {
      data,
      links: {
        self: `${config.basePath}/${type}/${id}/relationships/${relationship}`,
        related: `${config.basePath}/${type}/${id}/${relationship}`,
      },
    });
  } catch (e) {
    sendError(res, e);
  }
}

/**
 * Handle relationship update
 */
async function handleRelationshipUpdate(req, res, params, ctx) {
  const { type, id, relationship } = params;

  const resourceConfig = getResourceConfig(type);
  if (!resourceConfig) {
    sendError(res, new JsonApiError(404, 'Not Found', `Resource type "${type}" not found`));
    return;
  }

  const relConfig = resourceConfig.relationships?.[relationship];
  if (!relConfig) {
    sendError(res, new JsonApiError(404, 'Not Found', `Relationship "${relationship}" not found`));
    return;
  }

  if (!resourceConfig.publicWrite && !ctx.user) {
    sendError(res, new JsonApiError(401, 'Unauthorized', 'Authentication required'));
    return;
  }

  try {
    const item = contentService.read(resourceConfig.contentType, id);
    if (!item) {
      sendError(res, new JsonApiError(404, 'Not Found', `Resource "${type}/${id}" not found`));
      return;
    }

    const doc = await parseBody(req);
    const field = relConfig.field || relationship;

    let value = null;
    if (doc.data) {
      value = Array.isArray(doc.data)
        ? doc.data.map(r => r.id)
        : doc.data.id;
    }

    await contentService.update(resourceConfig.contentType, id, { [field]: value });

    sendJsonApi(res, {
      data: doc.data,
      links: {
        self: `${config.basePath}/${type}/${id}/relationships/${relationship}`,
        related: `${config.basePath}/${type}/${id}/${relationship}`,
      },
    });
  } catch (e) {
    sendError(res, e);
  }
}

// ============================================
// INCLUDES HANDLING
// ============================================

/**
 * Resolve includes for a resource
 *
 * @param {Object} item - Source item
 * @param {string} type - Resource type
 * @param {string[]} includePaths - Include paths
 * @param {Object[]} included - Accumulator for included resources
 * @param {Object} fields - Sparse fieldsets
 * @param {number} depth - Current depth
 */
async function resolveIncludes(item, type, includePaths, included, fields, depth) {
  if (depth >= config.includeDepth) return;

  const resourceConfig = getResourceConfig(type);
  if (!resourceConfig?.relationships) return;

  for (const path of includePaths) {
    const [firstPart, ...restParts] = path.split('.');
    const relConfig = resourceConfig.relationships[firstPart];

    if (!relConfig) continue;

    const field = relConfig.field || firstPart;
    const relValue = item[field];

    if (!relValue) continue;

    const relIds = Array.isArray(relValue) ? relValue : [relValue];

    for (const relId of relIds) {
      // Load related resource
      const relResourceConfig = getResourceConfig(relConfig.type);
      if (!relResourceConfig) continue;

      const relItem = contentService.read(relResourceConfig.contentType, relId);
      if (!relItem) continue;

      // Convert to JSON:API resource
      const relFields = fields[relConfig.type] || null;
      included.push(toResource(relItem, relConfig.type, relFields));

      // Recurse for nested includes
      if (restParts.length > 0) {
        await resolveIncludes(relItem, relConfig.type, [restParts.join('.')], included, fields, depth + 1);
      }
    }
  }
}

/**
 * Deduplicate included resources
 *
 * @param {Object[]} included - Included resources
 * @returns {Object[]}
 */
function deduplicateIncluded(included) {
  const seen = new Set();
  return included.filter(resource => {
    const key = `${resource.type}:${resource.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ============================================
// UTILITIES
// ============================================

/**
 * Get configuration
 *
 * @returns {Object}
 */
export function getConfig() {
  return { ...config };
}

/**
 * Check if JSON:API is enabled
 *
 * @returns {boolean}
 */
export function isEnabled() {
  return config.enabled;
}

/**
 * Export error class for external use
 */
export { JsonApiError };
