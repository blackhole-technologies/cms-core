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
let workspacesService = null;

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
  workspacesService = options.workspaces || null;

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
function toResource(item, type, fields = null, includeRevisionMeta = false) {
  const resourceConfig = getResourceConfig(type);

  // Build attributes
  const attributes = {};
  const schema = contentService?.getSchema?.(resourceConfig?.contentType || type) || {};

  // Revision metadata fields to expose when includeRevisionMeta is true
  // WHY: Normally _ prefixed fields are internal, but for allRevisions mode
  // callers need _revisionTimestamp, _isHistoricalRevision, _revisions, _revisionCount
  const revisionMetaFields = ['_revisionTimestamp', '_isHistoricalRevision', '_revisions', '_revisionCount'];

  for (const [key, value] of Object.entries(item)) {
    // Skip system fields and relationships
    if (['id', 'type', 'created', 'updated', '_id'].includes(key)) continue;

    // Allow revision metadata through when requested
    if (key.startsWith('_')) {
      if (includeRevisionMeta && revisionMetaFields.includes(key)) {
        // Include revision metadata as meta attribute
      } else {
        continue;
      }
    }

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

  // Add revision metadata to resource meta when includeRevisionMeta is true
  // WHY IN META: JSON:API spec uses meta for non-attribute data. Revision
  // metadata is about the resource's versioning, not its content fields.
  if (includeRevisionMeta) {
    resource.meta = resource.meta || {};

    if (item._revisionTimestamp) {
      resource.meta.revisionTimestamp = item._revisionTimestamp;
    }
    if (item._isHistoricalRevision !== undefined) {
      resource.meta.isHistoricalRevision = item._isHistoricalRevision;
    }
    if (item._revisionCount !== undefined) {
      resource.meta.revisionCount = item._revisionCount;
    }
    // Convert _revisions array to JSON:API format
    if (item._revisions && Array.isArray(item._revisions)) {
      resource.meta.revisions = item._revisions.map(rev => ({
        type,
        id: rev.id,
        attributes: Object.fromEntries(
          Object.entries(rev).filter(([k]) =>
            !['id', 'type', 'created', 'updated', '_id'].includes(k) &&
            !k.startsWith('_')
          )
        ),
        meta: {
          revisionTimestamp: rev._revisionTimestamp,
          isHistoricalRevision: rev._isHistoricalRevision,
          isDefaultRevision: rev.isDefaultRevision,
        },
      }));
    }

    // Remove _ prefixed fields from attributes (already in meta)
    delete attributes._revisionTimestamp;
    delete attributes._isHistoricalRevision;
    delete attributes._revisions;
    delete attributes._revisionCount;
  }

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
 * WHY CONSTRAINT VIOLATION HANDLING:
 * Constraint violations from the validation system throw errors with
 * error.code === 'CONSTRAINT_VIOLATION' and error.violations array.
 * These must be returned as 422 Unprocessable Entity with per-field
 * violation details in JSON:API error format, following Drupal's pattern.
 *
 * @param {Object} res - HTTP response
 * @param {JsonApiError|Error} error - Error object
 */
function sendError(res, error) {
  // Handle constraint violations as 422 with per-field details
  if (error.code === 'CONSTRAINT_VIOLATION' && Array.isArray(error.violations)) {
    const errors = error.violations.map(v => ({
      status: '422',
      title: 'Constraint Violation',
      detail: v.message,
      code: v.code || v.constraint,
      source: {
        pointer: `/data/attributes/${v.field}`
      },
      meta: {
        constraint: v.constraint,
        field: v.field
      }
    }));

    sendJsonApi(res, { errors }, 422);
    return;
  }

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
// WORKSPACE CONTEXT
// ============================================

/**
 * Resolve workspace context from HTTP request.
 *
 * WHY PER-REQUEST WORKSPACE:
 * HTTP requests are stateless. Each API client may be working in a different
 * workspace. The X-Workspace header provides per-request workspace context,
 * following the same pattern as Drupal's workspace negotiator.
 *
 * Supported header values:
 * - Workspace UUID: resolves to specific workspace
 * - Machine name: resolves to workspace by machineName
 * - 'live': explicitly forces live (no workspace) context
 * - Absent: defaults to live context
 *
 * @param {IncomingMessage} req - HTTP request
 * @returns {string|null} Workspace ID, 'live', or null (live context)
 */
/**
 * Resolve authenticated user from request
 *
 * WHY IN JSON:API MODULE (not middleware):
 * The users module registers auth middleware for /admin/* and /api/* paths,
 * but NOT for /jsonapi/*. Rather than adding another middleware registration,
 * we handle auth resolution here since we already have access to authService.
 * This keeps JSON:API self-contained and avoids coupling to module middleware.
 *
 * @param {IncomingMessage} req - HTTP request
 * @returns {Object|null} User object or null if unauthenticated
 */
function resolveUserFromRequest(req) {
  if (!authService || !contentService) return null;

  // Check session cookie or Bearer token
  const authInfo = authService.getAuthFromRequest(req);
  if (!authInfo) return null;

  // Load user data
  const user = contentService.read('user', authInfo.userId);
  if (!user) return null;

  return {
    id: user.id,
    username: user.username,
    role: user.role || 'editor',
  };
}

/**
 * Resolve workspace context from X-Workspace header
 *
 * @param {IncomingMessage} req - HTTP request
 * @returns {string|null} Workspace ID, 'live', or null (live context)
 */
function resolveWorkspaceFromRequest(req) {
  if (!workspacesService) return null;

  const headerValue = req.headers?.['x-workspace'];
  if (!headerValue) return null;

  // Explicit live context
  if (headerValue === 'live' || headerValue === 'none') return 'live';

  // Resolve workspace by ID or machine name
  const workspace = workspacesService.getWorkspaceContext(req);
  if (workspace) return workspace.id;

  // Header provided but workspace not found - return null (treat as live)
  return null;
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

  // Check auth - resolve user from request (session cookie or Bearer token)
  if (!resourceConfig.publicRead && !resolveUserFromRequest(req)) {
    sendError(res, new JsonApiError(401, 'Unauthorized', 'Authentication required'));
    return;
  }

  try {
    const url = new URL(req.url, 'http://localhost');
    const queryParams = parseQueryParams(url);

    // Resolve workspace context from X-Workspace header
    // WHY PER-REQUEST:
    // Each API client can work in a different workspace.
    // Without header: returns live content only.
    // With header: returns workspace + live content (workspace overlays live).
    const workspaceId = resolveWorkspaceFromRequest(req);

    // Check for allRevisions include parameter
    // WHY: JSON:API spec uses ?include= for compound documents.
    // We extend this pattern to support allRevisions as a special keyword
    // that triggers returning all revision data inline.
    const includeAllRevisions = queryParams.include.includes('allRevisions');

    // Build content query options
    const queryOptions = {
      offset: queryParams.page.offset,
      limit: queryParams.page.limit,
      sort: queryParams.sort[0]?.field || 'created',
      order: queryParams.sort[0]?.order || 'desc',
      filters: [],
      workspaceId,
      includeAllRevisions,
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
    const data = result.items.map(item => toResource(item, type, fields, includeAllRevisions));

    // Handle includes (filter out allRevisions from normal include resolution)
    const included = [];
    const normalIncludes = queryParams.include.filter(i => i !== 'allRevisions');
    if (normalIncludes.length > 0) {
      for (const item of result.items) {
        await resolveIncludes(item, type, normalIncludes, included, queryParams.fields, 0);
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

    const meta = {
      total: result.total,
      offset: queryParams.page.offset,
      limit: queryParams.page.limit,
    };

    // Include workspace context in meta when X-Workspace header is used
    if (workspaceId && workspaceId !== 'live') {
      meta.workspace = workspaceId;
    }

    const document = {
      data,
      meta,
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

  if (!resourceConfig.publicRead && !resolveUserFromRequest(req)) {
    sendError(res, new JsonApiError(401, 'Unauthorized', 'Authentication required'));
    return;
  }

  try {
    // Resolve workspace context from X-Workspace header
    const workspaceId = resolveWorkspaceFromRequest(req);

    let item = null;

    // If in a workspace context, check for workspace copy first
    // WHY CHECK WORKSPACE COPY:
    // When content is edited in a workspace, a workspace copy is created with
    // ID format: ws-{workspaceIdPrefix}-{originalId}. The API should return
    // the workspace version transparently when queried with workspace header.
    if (workspaceId && workspaceId !== 'live') {
      const workspaceCopyId = `ws-${workspaceId.substring(0, 8)}-${id}`;
      // WHY skipWorkspace: JSON:API manages its own workspace resolution via
      // X-Workspace header. We don't want read()'s CLI workspace logic to interfere.
      const wsItem = contentService.read(resourceConfig.contentType, workspaceCopyId, { skipWorkspace: true });
      if (wsItem && wsItem._workspace === workspaceId) {
        item = wsItem;
      }
    }

    // Parse query params early so we can use allRevisions in read()
    const url = new URL(req.url, 'http://localhost');
    const queryParams = parseQueryParams(url);
    const includeAllRevisions = queryParams.include.includes('allRevisions');

    // Fall back to reading the original item
    if (!item) {
      item = contentService.read(resourceConfig.contentType, id, {
        skipWorkspace: true,
        includeAllRevisions,
      });
    }

    if (!item) {
      sendError(res, new JsonApiError(404, 'Not Found', `Resource "${type}/${id}" not found`));
      return;
    }

    // If in live context and item is workspace-only, don't expose it
    if (!workspaceId && item._workspace) {
      sendError(res, new JsonApiError(404, 'Not Found', `Resource "${type}/${id}" not found`));
      return;
    }

    const fields = queryParams.fields[type] || null;
    const data = toResource(item, type, fields, includeAllRevisions);

    // Add workspace metadata to response
    if (workspaceId && workspaceId !== 'live') {
      data.meta = data.meta || {};
      data.meta.workspace = workspaceId;
      if (item._workspace) {
        data.meta.isWorkspaceCopy = true;
        if (item._originalId) {
          data.meta.originalId = item._originalId;
        }
      }
    }

    // Handle includes (filter out allRevisions from normal include resolution)
    const included = [];
    const normalIncludes = queryParams.include.filter(i => i !== 'allRevisions');
    if (normalIncludes.length > 0) {
      await resolveIncludes(item, type, normalIncludes, included, queryParams.fields, 0);
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

  if (!resourceConfig.publicWrite && !resolveUserFromRequest(req)) {
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

    // Tag content with workspace if X-Workspace header present
    // WHY TAG ON CREATE:
    // Content created via API with workspace header should be isolated
    // to that workspace, just like content created via CLI in a workspace context
    const workspaceId = resolveWorkspaceFromRequest(req);
    if (workspaceId && workspaceId !== 'live') {
      data._workspace = workspaceId;
    }

    const created = await contentService.create(resourceConfig.contentType, data);

    // Track workspace association
    if (workspaceId && workspaceId !== 'live' && workspacesService) {
      try {
        workspacesService.associateContent(workspaceId, resourceConfig.contentType, created.id, 'create');
      } catch { /* non-critical */ }
    }

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
 *
 * WHY WORKSPACE-AWARE UPDATE:
 * When X-Workspace header is present, editing live content should create a
 * workspace copy instead of modifying the live version. This mirrors Drupal's
 * workspaces module where edits in a workspace are isolated from live.
 * If a workspace copy already exists, it gets updated directly.
 */
async function handleUpdate(req, res, params, ctx) {
  const { type, id } = params;

  const resourceConfig = getResourceConfig(type);
  if (!resourceConfig) {
    sendError(res, new JsonApiError(404, 'Not Found', `Resource type "${type}" not found`));
    return;
  }

  if (!resourceConfig.publicWrite && !resolveUserFromRequest(req)) {
    sendError(res, new JsonApiError(401, 'Unauthorized', 'Authentication required'));
    return;
  }

  try {
    // Resolve workspace context from X-Workspace header
    const workspaceId = resolveWorkspaceFromRequest(req);

    let existing = null;
    let targetId = id;

    if (workspaceId && workspaceId !== 'live') {
      // In workspace context: check for workspace copy first
      const workspaceCopyId = `ws-${workspaceId.substring(0, 8)}-${id}`;
      const wsCopy = contentService.read(resourceConfig.contentType, workspaceCopyId, { skipWorkspace: true });

      if (wsCopy && wsCopy._workspace === workspaceId) {
        // Workspace copy exists — update it
        existing = wsCopy;
        targetId = workspaceCopyId;
      } else {
        // No workspace copy — read the live version to create a workspace copy
        const liveItem = contentService.read(resourceConfig.contentType, id, { skipWorkspace: true });
        if (!liveItem) {
          sendError(res, new JsonApiError(404, 'Not Found', `Resource "${type}/${id}" not found`));
          return;
        }

        // Create a workspace copy with the edits applied
        const doc = await parseBody(req);
        if (!doc.data) {
          throw new JsonApiError(400, 'Bad Request', 'Missing data object');
        }
        const data = fromResource(doc.data);

        const wsCopyData = {
          ...liveItem,
          ...data,
          id: workspaceCopyId,
          _workspace: workspaceId,
          _originalId: id,
          _originalType: resourceConfig.contentType,
          updated: new Date().toISOString(),
        };

        const created = await contentService.create(resourceConfig.contentType, wsCopyData);

        // Track workspace association
        if (workspacesService) {
          try {
            workspacesService.associateContent(workspaceId, resourceConfig.contentType, id, 'edit');
          } catch { /* non-critical */ }
        }

        // Return the workspace copy as if it were the original
        const resource = toResource(created, type);
        resource.id = id; // Present with original ID for API consistency
        resource.meta = resource.meta || {};
        resource.meta.workspace = workspaceId;
        resource.meta.isWorkspaceCopy = true;

        sendJsonApi(res, {
          data: resource,
          links: { self: `${config.basePath}/${type}/${id}` },
        });
        return;
      }
    } else {
      // Live context — read the live version
      existing = contentService.read(resourceConfig.contentType, id, { skipWorkspace: true });
    }

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

    const data = fromResource(doc.data);
    const updated = await contentService.update(resourceConfig.contentType, targetId, data);

    const resource = toResource(updated, type);
    // If this is a workspace copy, present with the original ID
    if (workspaceId && workspaceId !== 'live' && targetId !== id) {
      resource.id = id;
      resource.meta = resource.meta || {};
      resource.meta.workspace = workspaceId;
      resource.meta.isWorkspaceCopy = true;
    }

    sendJsonApi(res, {
      data: resource,
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
 *
 * WHY WORKSPACE-AWARE DELETE:
 * When X-Workspace header is present, deleting should only affect
 * the workspace copy (if one exists). Live content should NOT be
 * deleted from a workspace context — that would leak workspace
 * operations into live. Instead, workspace deletions remove the
 * workspace-specific copy and its association.
 */
async function handleDelete(req, res, params, ctx) {
  const { type, id } = params;

  const resourceConfig = getResourceConfig(type);
  if (!resourceConfig) {
    sendError(res, new JsonApiError(404, 'Not Found', `Resource type "${type}" not found`));
    return;
  }

  if (!resourceConfig.publicWrite && !resolveUserFromRequest(req)) {
    sendError(res, new JsonApiError(401, 'Unauthorized', 'Authentication required'));
    return;
  }

  try {
    // Resolve workspace context from X-Workspace header
    const workspaceId = resolveWorkspaceFromRequest(req);

    if (workspaceId && workspaceId !== 'live') {
      // In workspace context:
      // 1. If content was created in workspace, delete it
      // 2. If content is a workspace copy of live, delete the copy
      // 3. Do NOT delete live content from workspace context

      // Check for workspace-created content (has _workspace field with matching ID)
      const item = contentService.read(resourceConfig.contentType, id, { skipWorkspace: true });
      if (item && item._workspace === workspaceId) {
        // Content was created in this workspace — safe to delete
        await contentService.remove(resourceConfig.contentType, id);
        if (workspacesService) {
          try {
            workspacesService.removeContentAssociation(workspaceId, resourceConfig.contentType, id);
          } catch { /* non-critical */ }
        }
        res.statusCode = 204;
        res.end();
        return;
      }

      // Check for workspace copy (ws-{prefix}-{id})
      const workspaceCopyId = `ws-${workspaceId.substring(0, 8)}-${id}`;
      const wsCopy = contentService.read(resourceConfig.contentType, workspaceCopyId, { skipWorkspace: true });
      if (wsCopy && wsCopy._workspace === workspaceId) {
        // Delete the workspace copy, not the live original
        await contentService.remove(resourceConfig.contentType, workspaceCopyId);
        if (workspacesService) {
          try {
            workspacesService.removeContentAssociation(workspaceId, resourceConfig.contentType, id);
          } catch { /* non-critical */ }
        }
        res.statusCode = 204;
        res.end();
        return;
      }

      // Live content with no workspace copy — cannot delete from workspace
      sendError(res, new JsonApiError(403, 'Forbidden',
        `Cannot delete live content "${type}/${id}" from workspace context. ` +
        `Publish the workspace first or switch to live context.`));
      return;
    }

    // Live context — standard deletion
    const existing = contentService.read(resourceConfig.contentType, id, { skipWorkspace: true });
    if (!existing) {
      sendError(res, new JsonApiError(404, 'Not Found', `Resource "${type}/${id}" not found`));
      return;
    }

    // Don't allow deleting workspace content from live context
    if (existing._workspace) {
      sendError(res, new JsonApiError(403, 'Forbidden',
        `Resource "${type}/${id}" belongs to workspace "${existing._workspace}". ` +
        `Use the workspace context to manage this content.`));
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

  if (!resourceConfig.publicWrite && !resolveUserFromRequest(req)) {
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
