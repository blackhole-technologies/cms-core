/**
 * api-version.js - API Versioning and Deprecation
 *
 * WHY THIS EXISTS:
 * Manage API versions to support backwards compatibility:
 * - Multiple concurrent API versions
 * - Graceful deprecation with warnings
 * - Response transformation per version
 * - Usage tracking for migration planning
 *
 * DESIGN DECISIONS:
 * - Version detection via URL prefix, header, or query param
 * - Deprecation/Sunset headers per RFC 8594
 * - Per-version response transformers
 * - Analytics integration for usage tracking
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Configuration
 */
let config = {
  enabled: true,
  defaultVersion: 'v1',
  versions: {},
  trackUsage: true,
};

/**
 * Storage
 */
let baseDir = null;
let usageDir = null;
let analyticsService = null;

/**
 * Registered versions
 */
const versions = new Map();

/**
 * Response transformers per version
 */
const transformers = new Map();

/**
 * Endpoint deprecations
 */
const endpointDeprecations = new Map();

/**
 * Version status types
 */
const VERSION_STATUS = {
  BETA: 'beta',
  STABLE: 'stable',
  DEPRECATED: 'deprecated',
  SUNSET: 'sunset',
};

/**
 * Initialize API versioning
 *
 * @param {string} dir - Base directory
 * @param {Object} analytics - Analytics service (optional)
 * @param {Object} apiConfig - Configuration
 */
export function init(dir, analytics = null, apiConfig = {}) {
  baseDir = dir;
  analyticsService = analytics;

  config = { ...config, ...apiConfig };

  usageDir = join(baseDir, 'logs', 'api-usage');
  if (!existsSync(usageDir)) {
    mkdirSync(usageDir, { recursive: true });
  }

  // Register configured versions
  if (config.versions) {
    for (const [version, versionConfig] of Object.entries(config.versions)) {
      registerVersion(version, versionConfig);
    }
  }

  // Register default transformers
  registerDefaultTransformers();
}

/**
 * Register an API version
 *
 * @param {string} version - Version identifier (e.g., "v1", "v2")
 * @param {Object} versionConfig - Version configuration
 */
export function registerVersion(version, versionConfig = {}) {
  const normalizedVersion = normalizeVersion(version);

  versions.set(normalizedVersion, {
    version: normalizedVersion,
    status: versionConfig.status || VERSION_STATUS.STABLE,
    releasedAt: versionConfig.releasedAt || null,
    deprecatedAt: versionConfig.deprecatedAt || null,
    sunsetAt: versionConfig.sunsetAt || null,
    changes: versionConfig.changes || [],
    description: versionConfig.description || '',
  });
}

/**
 * Register default response transformers
 */
function registerDefaultTransformers() {
  // v1 transformer: legacy format
  transformers.set('v1', {
    list: (data) => ({
      items: data.items || data.data || [],
      total: data.total ?? data.meta?.total ?? 0,
    }),
    item: (data) => data.data || data,
    error: (error) => ({
      error: error.message || error.error || 'Unknown error',
      code: error.code || error.statusCode || 500,
    }),
  });

  // v2 transformer: modern format with metadata
  transformers.set('v2', {
    list: (data) => ({
      data: data.items || data.data || [],
      meta: {
        total: data.total ?? data.meta?.total ?? 0,
        page: data.page ?? data.meta?.page ?? 1,
        limit: data.limit ?? data.meta?.limit ?? 20,
        pages: data.pages ?? data.meta?.pages ?? Math.ceil((data.total || 0) / (data.limit || 20)),
      },
    }),
    item: (data) => ({
      data: data.data || data,
      meta: {
        version: data.version || data._version || 1,
        updatedAt: data.updatedAt || data.updated || null,
      },
    }),
    error: (error) => ({
      error: {
        message: error.message || 'Unknown error',
        code: error.code || 'UNKNOWN_ERROR',
        details: error.details || null,
      },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: error.requestId || null,
      },
    }),
  });

  // v3 transformer: extended format
  transformers.set('v3', {
    list: (data) => ({
      data: data.items || data.data || [],
      meta: {
        pagination: {
          total: data.total ?? data.meta?.total ?? 0,
          page: data.page ?? data.meta?.page ?? 1,
          limit: data.limit ?? data.meta?.limit ?? 20,
          pages: data.pages ?? data.meta?.pages ?? 1,
          hasMore: (data.page || 1) < (data.pages || 1),
        },
        filters: data.filters || {},
        sort: data.sort || null,
      },
      links: {
        self: data.links?.self || null,
        next: data.links?.next || null,
        prev: data.links?.prev || null,
      },
    }),
    item: (data) => ({
      data: data.data || data,
      meta: {
        version: data.version || data._version || 1,
        createdAt: data.createdAt || data.created || null,
        updatedAt: data.updatedAt || data.updated || null,
        createdBy: data.createdBy || null,
        updatedBy: data.updatedBy || null,
      },
      links: {
        self: data.links?.self || null,
      },
    }),
    error: (error) => ({
      errors: [{
        status: String(error.statusCode || error.code || 500),
        code: error.code || 'UNKNOWN_ERROR',
        title: error.title || 'Error',
        detail: error.message || 'An unknown error occurred',
        source: error.source || null,
      }],
      meta: {
        timestamp: new Date().toISOString(),
        requestId: error.requestId || null,
      },
    }),
  });
}

/**
 * Normalize version string
 *
 * @param {string} version
 * @returns {string}
 */
function normalizeVersion(version) {
  if (!version) return config.defaultVersion;

  const v = String(version).toLowerCase().trim();

  // Handle numeric versions
  if (/^\d+$/.test(v)) {
    return `v${v}`;
  }

  // Handle "v1", "v2", etc.
  if (/^v\d+$/.test(v)) {
    return v;
  }

  return v;
}

/**
 * Get version from request
 *
 * Priority: URL prefix > Header > Query param > Default
 *
 * @param {Object} req - Request object
 * @returns {string}
 */
export function getVersion(req) {
  // 1. URL prefix: /api/v1/...
  const urlMatch = req.url?.match(/\/api\/(v\d+)\//);
  if (urlMatch) {
    return normalizeVersion(urlMatch[1]);
  }

  // 2. X-API-Version header
  const headerVersion = req.headers?.['x-api-version'];
  if (headerVersion) {
    return normalizeVersion(headerVersion);
  }

  // 3. Accept header: application/vnd.cms.v1+json
  const acceptHeader = req.headers?.accept;
  if (acceptHeader) {
    const acceptMatch = acceptHeader.match(/application\/vnd\.cms\.(v\d+)\+json/);
    if (acceptMatch) {
      return normalizeVersion(acceptMatch[1]);
    }
  }

  // 4. Query parameter: ?api_version=1
  const queryVersion = req.query?.api_version || req.searchParams?.get?.('api_version');
  if (queryVersion) {
    return normalizeVersion(queryVersion);
  }

  // 5. Default
  return config.defaultVersion;
}

/**
 * Check if a version is deprecated
 *
 * @param {string} version
 * @returns {boolean}
 */
export function isDeprecated(version) {
  const v = versions.get(normalizeVersion(version));
  if (!v) return false;

  return v.status === VERSION_STATUS.DEPRECATED || v.status === VERSION_STATUS.SUNSET;
}

/**
 * Check if a version is sunset (no longer supported)
 *
 * @param {string} version
 * @returns {boolean}
 */
export function isSunset(version) {
  const v = versions.get(normalizeVersion(version));
  if (!v) return false;

  if (v.status === VERSION_STATUS.SUNSET) return true;

  if (v.sunsetAt) {
    return new Date(v.sunsetAt) < new Date();
  }

  return false;
}

/**
 * Get deprecation info for a version
 *
 * @param {string} version
 * @returns {Object|null}
 */
export function getDeprecationInfo(version) {
  const v = versions.get(normalizeVersion(version));
  if (!v || !isDeprecated(version)) return null;

  return {
    version: v.version,
    deprecatedAt: v.deprecatedAt,
    sunsetAt: v.sunsetAt,
    message: `API version ${v.version} is deprecated${v.sunsetAt ? ` and will be removed on ${v.sunsetAt}` : ''}`,
  };
}

/**
 * Get all deprecations (versions and endpoints)
 *
 * @returns {Array}
 */
export function getDeprecations() {
  const deprecations = [];

  // Version deprecations
  for (const [version, config] of versions) {
    if (isDeprecated(version)) {
      deprecations.push({
        type: 'version',
        version,
        deprecatedAt: config.deprecatedAt,
        sunsetAt: config.sunsetAt,
        message: `API version ${version} is deprecated`,
      });
    }
  }

  // Endpoint deprecations
  for (const [key, deprecation] of endpointDeprecations) {
    deprecations.push({
      type: 'endpoint',
      ...deprecation,
    });
  }

  return deprecations;
}

/**
 * Register an endpoint deprecation
 *
 * @param {string} version
 * @param {string} endpoint
 * @param {Object} info
 */
export function deprecateEndpoint(version, endpoint, info = {}) {
  const key = `${normalizeVersion(version)}:${endpoint}`;

  endpointDeprecations.set(key, {
    version: normalizeVersion(version),
    endpoint,
    deprecatedAt: info.deprecatedAt || new Date().toISOString().split('T')[0],
    sunsetAt: info.sunsetAt || null,
    alternative: info.alternative || null,
    message: info.message || `Endpoint ${endpoint} is deprecated in ${version}`,
  });
}

/**
 * Check if an endpoint is deprecated
 *
 * @param {string} version
 * @param {string} endpoint
 * @returns {Object|null}
 */
export function getEndpointDeprecation(version, endpoint) {
  const key = `${normalizeVersion(version)}:${endpoint}`;
  return endpointDeprecations.get(key) || null;
}

/**
 * Get version info
 *
 * @param {string} version
 * @returns {Object|null}
 */
export function getVersionInfo(version) {
  return versions.get(normalizeVersion(version)) || null;
}

/**
 * List all versions
 *
 * @returns {Array}
 */
export function listVersions() {
  const result = [];

  for (const [version, config] of versions) {
    result.push({
      ...config,
      isDefault: version === config.defaultVersion,
      isCurrent: version === getLatestStableVersion(),
    });
  }

  // Sort: stable first, then by version number
  result.sort((a, b) => {
    if (a.status === VERSION_STATUS.STABLE && b.status !== VERSION_STATUS.STABLE) return -1;
    if (b.status === VERSION_STATUS.STABLE && a.status !== VERSION_STATUS.STABLE) return 1;
    return b.version.localeCompare(a.version);
  });

  return result;
}

/**
 * Get latest stable version
 *
 * @returns {string}
 */
export function getLatestStableVersion() {
  for (const [version, config] of versions) {
    if (config.status === VERSION_STATUS.STABLE) {
      return version;
    }
  }
  return config.defaultVersion;
}

/**
 * Transform response for a specific version
 *
 * @param {Object} data - Response data
 * @param {string} version - Target version
 * @param {string} type - Response type: 'list', 'item', 'error'
 * @returns {Object}
 */
export function transformResponse(data, version, type = 'item') {
  const normalizedVersion = normalizeVersion(version);
  const transformer = transformers.get(normalizedVersion);

  if (!transformer || !transformer[type]) {
    // Return data as-is if no transformer
    return data;
  }

  return transformer[type](data);
}

/**
 * Register a custom transformer for a version
 *
 * @param {string} version
 * @param {Object} transformer
 */
export function registerTransformer(version, transformer) {
  transformers.set(normalizeVersion(version), transformer);
}

/**
 * Create version middleware
 *
 * @returns {Function}
 */
export function versionMiddleware() {
  return (req, res, next) => {
    // Detect version
    const version = getVersion(req);
    req.apiVersion = version;

    // Check if version exists
    if (!versions.has(version)) {
      // Use default if version doesn't exist
      req.apiVersion = config.defaultVersion;
    }

    // Add version header to response
    res.setHeader('X-API-Version', req.apiVersion);

    // Add deprecation headers if needed
    if (isDeprecated(req.apiVersion)) {
      const info = getDeprecationInfo(req.apiVersion);
      res.setHeader('Deprecation', 'true');

      if (info?.sunsetAt) {
        const sunsetDate = new Date(info.sunsetAt);
        res.setHeader('Sunset', sunsetDate.toUTCString());
      }

      // Add Link header pointing to newer version
      const latest = getLatestStableVersion();
      if (latest !== req.apiVersion) {
        res.setHeader('Link', `</api/${latest}/>; rel="successor-version"`);
      }
    }

    // Track usage
    if (config.trackUsage) {
      trackUsage(req.apiVersion, req.url, req.method);
    }

    next();
  };
}

/**
 * Track API version usage
 *
 * @param {string} version
 * @param {string} endpoint
 * @param {string} method
 */
function trackUsage(version, endpoint, method = 'GET') {
  if (!usageDir) return;

  const today = new Date().toISOString().split('T')[0];
  const usageFile = join(usageDir, `${today}.json`);

  let usage = {};
  if (existsSync(usageFile)) {
    try {
      usage = JSON.parse(readFileSync(usageFile, 'utf-8'));
    } catch (e) {
      usage = {};
    }
  }

  if (!usage[version]) {
    usage[version] = { total: 0, endpoints: {} };
  }

  usage[version].total++;

  const endpointKey = `${method} ${endpoint.split('?')[0]}`;
  usage[version].endpoints[endpointKey] = (usage[version].endpoints[endpointKey] || 0) + 1;

  try {
    writeFileSync(usageFile, JSON.stringify(usage, null, 2) + '\n');
  } catch (e) {
    // Ignore write errors
  }

  // Also track in analytics if available
  if (analyticsService && typeof analyticsService.track === 'function') {
    analyticsService.track('api_request', {
      version,
      endpoint: endpointKey,
      deprecated: isDeprecated(version),
    });
  }
}

/**
 * Get usage stats
 *
 * @param {Object} options
 * @returns {Object}
 */
export function getUsageStats(options = {}) {
  const { days = 7 } = options;

  const stats = {
    period: { days, start: null, end: null },
    versions: {},
    total: 0,
  };

  const now = new Date();
  stats.period.end = now.toISOString().split('T')[0];

  for (let i = 0; i < days; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    if (i === days - 1) {
      stats.period.start = dateStr;
    }

    const usageFile = join(usageDir, `${dateStr}.json`);
    if (existsSync(usageFile)) {
      try {
        const dayUsage = JSON.parse(readFileSync(usageFile, 'utf-8'));

        for (const [version, data] of Object.entries(dayUsage)) {
          if (!stats.versions[version]) {
            stats.versions[version] = {
              total: 0,
              endpoints: {},
              byDay: {},
            };
          }

          stats.versions[version].total += data.total || 0;
          stats.versions[version].byDay[dateStr] = data.total || 0;
          stats.total += data.total || 0;

          for (const [endpoint, count] of Object.entries(data.endpoints || {})) {
            stats.versions[version].endpoints[endpoint] =
              (stats.versions[version].endpoints[endpoint] || 0) + count;
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  }

  return stats;
}

/**
 * Get changelog for all versions
 *
 * @returns {Array}
 */
export function getChangelog() {
  const changelog = [];

  for (const [version, config] of versions) {
    if (config.changes && config.changes.length > 0) {
      changelog.push({
        version,
        releasedAt: config.releasedAt,
        status: config.status,
        changes: config.changes,
      });
    }
  }

  // Sort by version descending
  changelog.sort((a, b) => b.version.localeCompare(a.version));

  return changelog;
}

/**
 * Get API documentation structure
 *
 * @returns {Object}
 */
export function getApiDocs() {
  return {
    versions: listVersions(),
    currentVersion: getLatestStableVersion(),
    defaultVersion: config.defaultVersion,
    endpoints: getEndpointDocs(),
    deprecations: getDeprecations(),
  };
}

/**
 * Get endpoint documentation
 *
 * @returns {Array}
 */
function getEndpointDocs() {
  // Return standard API endpoints
  return [
    {
      method: 'GET',
      path: '/api/{version}/content/{type}',
      description: 'List content items',
      parameters: [
        { name: 'type', in: 'path', required: true, description: 'Content type' },
        { name: 'page', in: 'query', description: 'Page number (default: 1)' },
        { name: 'limit', in: 'query', description: 'Items per page (default: 20)' },
        { name: 'sort', in: 'query', description: 'Sort field' },
        { name: 'order', in: 'query', description: 'Sort order: asc, desc' },
      ],
      versions: ['v1', 'v2', 'v3'],
    },
    {
      method: 'GET',
      path: '/api/{version}/content/{type}/{id}',
      description: 'Get single content item',
      parameters: [
        { name: 'type', in: 'path', required: true, description: 'Content type' },
        { name: 'id', in: 'path', required: true, description: 'Content ID' },
      ],
      versions: ['v1', 'v2', 'v3'],
    },
    {
      method: 'POST',
      path: '/api/{version}/content/{type}',
      description: 'Create content item',
      parameters: [
        { name: 'type', in: 'path', required: true, description: 'Content type' },
      ],
      versions: ['v1', 'v2', 'v3'],
    },
    {
      method: 'PUT',
      path: '/api/{version}/content/{type}/{id}',
      description: 'Update content item',
      parameters: [
        { name: 'type', in: 'path', required: true, description: 'Content type' },
        { name: 'id', in: 'path', required: true, description: 'Content ID' },
      ],
      versions: ['v1', 'v2', 'v3'],
    },
    {
      method: 'DELETE',
      path: '/api/{version}/content/{type}/{id}',
      description: 'Delete content item',
      parameters: [
        { name: 'type', in: 'path', required: true, description: 'Content type' },
        { name: 'id', in: 'path', required: true, description: 'Content ID' },
      ],
      versions: ['v1', 'v2', 'v3'],
    },
    {
      method: 'GET',
      path: '/api/{version}/search',
      description: 'Search content',
      parameters: [
        { name: 'q', in: 'query', required: true, description: 'Search query' },
        { name: 'type', in: 'query', description: 'Filter by content type' },
      ],
      versions: ['v1', 'v2', 'v3'],
    },
    {
      method: 'GET',
      path: '/api/versions',
      description: 'List available API versions',
      parameters: [],
      versions: ['all'],
    },
  ];
}

/**
 * Get configuration
 *
 * @returns {Object}
 */
export function getConfig() {
  return { ...config };
}

/**
 * Check if API versioning is enabled
 *
 * @returns {boolean}
 */
export function isEnabled() {
  return config.enabled;
}

/**
 * Get version status constants
 *
 * @returns {Object}
 */
export function getVersionStatuses() {
  return { ...VERSION_STATUS };
}
