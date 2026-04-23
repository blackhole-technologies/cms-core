/**
 * api-version.ts - API Versioning and Deprecation
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
import type { IncomingMessage, ServerResponse } from 'node:http';

// ============================================================================
// Types
// ============================================================================

/** Version status constants */
const VERSION_STATUS = {
  BETA: 'beta',
  STABLE: 'stable',
  DEPRECATED: 'deprecated',
  SUNSET: 'sunset',
} as const;

type VersionStatus = typeof VERSION_STATUS[keyof typeof VERSION_STATUS];

/** API version configuration object */
interface VersionConfig {
  version: string;
  status: VersionStatus;
  releasedAt: string | null;
  deprecatedAt: string | null;
  sunsetAt: string | null;
  changes: string[];
  description: string;
}

/** Input for registerVersion */
interface VersionConfigInput {
  status?: VersionStatus;
  releasedAt?: string | null;
  deprecatedAt?: string | null;
  sunsetAt?: string | null;
  changes?: string[];
  description?: string;
}

/** Transformer functions for a version */
interface VersionTransformer {
  list?: (data: Record<string, unknown>) => Record<string, unknown>;
  item?: (data: Record<string, unknown>) => Record<string, unknown>;
  error?: (error: Record<string, unknown>) => Record<string, unknown>;
}

/** Deprecation info returned to callers */
interface DeprecationInfo {
  version: string;
  deprecatedAt: string | null;
  sunsetAt: string | null;
  message: string;
}

/** Endpoint deprecation record */
interface EndpointDeprecation {
  version: string;
  endpoint: string;
  deprecatedAt: string;
  sunsetAt: string | null;
  alternative: string | null;
  message: string;
}

/** API versioning configuration */
interface ApiVersionConfig {
  enabled: boolean;
  defaultVersion: string;
  versions: Record<string, VersionConfigInput>;
  trackUsage: boolean;
}

/** Analytics service — only the `track` method is used */
interface AnalyticsService {
  track(event: string, data: Record<string, unknown>): void;
}

/** Express-compatible request with apiVersion injected by middleware */
interface VersionedRequest extends IncomingMessage {
  apiVersion?: string;
  url: string;
  query?: Record<string, string>;
  searchParams?: { get(name: string): string | null };
  headers: Record<string, string | string[] | undefined>;
  method?: string;
}

// ============================================================================
// Module state
// ============================================================================

/**
 * Configuration
 */
let config: ApiVersionConfig = {
  enabled: true,
  defaultVersion: 'v1',
  versions: {},
  trackUsage: true,
};

/**
 * Storage
 */
let baseDir: string | null = null;
let usageDir: string | null = null;
let analyticsService: AnalyticsService | null = null;

/**
 * Registered versions
 */
const versions = new Map<string, VersionConfig>();

/**
 * Response transformers per version
 */
const transformers = new Map<string, VersionTransformer>();

/**
 * Endpoint deprecations
 */
const endpointDeprecations = new Map<string, EndpointDeprecation>();



/**
 * Initialize API versioning
 */
export function init(dir: string, analytics: AnalyticsService | null = null, apiConfig: Partial<ApiVersionConfig> = {}): void {
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
 */
export function registerVersion(version: string, versionConfig: VersionConfigInput = {}): void {
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
function registerDefaultTransformers(): void {
  // Helper: safely read a sub-object field from Record<string,unknown>
  const meta = (d: Record<string, unknown>) => (d['meta'] as Record<string, unknown> | undefined) ?? {};
  const links = (d: Record<string, unknown>) => (d['links'] as Record<string, unknown> | undefined) ?? {};

  // v1 transformer: legacy format
  transformers.set('v1', {
    list: (data): Record<string, unknown> => ({
      items: data['items'] || data['data'] || [],
      total: (data['total'] ?? meta(data)['total']) ?? 0,
    }),
    item: (data): Record<string, unknown> => (data['data'] as Record<string, unknown> | undefined) ?? data,
    error: (error): Record<string, unknown> => ({
      error: error['message'] || error['error'] || 'Unknown error',
      code: error['code'] || error['statusCode'] || 500,
    }),
  });

  // v2 transformer: modern format with metadata
  transformers.set('v2', {
    list: (data): Record<string, unknown> => ({
      data: data['items'] || data['data'] || [],
      meta: {
        total: (data['total'] ?? meta(data)['total']) ?? 0,
        page: (data['page'] ?? meta(data)['page']) ?? 1,
        limit: (data['limit'] ?? meta(data)['limit']) ?? 20,
        pages: (data['pages'] ?? meta(data)['pages']) ?? Math.ceil(((data['total'] as number) || 0) / ((data['limit'] as number) || 20)),
      },
    }),
    item: (data): Record<string, unknown> => ({
      data: data['data'] || data,
      meta: {
        version: data['version'] || data['_version'] || 1,
        updatedAt: data['updatedAt'] || data['updated'] || null,
      },
    }),
    error: (error): Record<string, unknown> => ({
      error: {
        message: error['message'] || 'Unknown error',
        code: error['code'] || 'UNKNOWN_ERROR',
        details: error['details'] || null,
      },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: error['requestId'] || null,
      },
    }),
  });

  // v3 transformer: extended format
  transformers.set('v3', {
    list: (data): Record<string, unknown> => ({
      data: data['items'] || data['data'] || [],
      meta: {
        pagination: {
          total: (data['total'] ?? meta(data)['total']) ?? 0,
          page: (data['page'] ?? meta(data)['page']) ?? 1,
          limit: (data['limit'] ?? meta(data)['limit']) ?? 20,
          pages: (data['pages'] ?? meta(data)['pages']) ?? 1,
          hasMore: ((data['page'] as number) || 1) < ((data['pages'] as number) || 1),
        },
        filters: data['filters'] || {},
        sort: data['sort'] || null,
      },
      links: {
        self: links(data)['self'] || null,
        next: links(data)['next'] || null,
        prev: links(data)['prev'] || null,
      },
    }),
    item: (data): Record<string, unknown> => ({
      data: data['data'] || data,
      meta: {
        version: data['version'] || data['_version'] || 1,
        createdAt: data['createdAt'] || data['created'] || null,
        updatedAt: data['updatedAt'] || data['updated'] || null,
        createdBy: data['createdBy'] || null,
        updatedBy: data['updatedBy'] || null,
      },
      links: {
        self: links(data)['self'] || null,
      },
    }),
    error: (error): Record<string, unknown> => ({
      errors: [{
        status: String(error['statusCode'] || error['code'] || 500),
        code: error['code'] || 'UNKNOWN_ERROR',
        title: error['title'] || 'Error',
        detail: error['message'] || 'An unknown error occurred',
        source: error['source'] || null,
      }],
      meta: {
        timestamp: new Date().toISOString(),
        requestId: error['requestId'] || null,
      },
    }),
  });
}

/**
 * Normalize version string
 */
function normalizeVersion(version: string | null | undefined): string {
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
 */
export function getVersion(req: VersionedRequest): string {
  // 1. URL prefix: /api/v1/...
  const urlMatch = req.url?.match(/\/api\/(v\d+)\//);
  if (urlMatch) {
    return normalizeVersion(urlMatch[1]);
  }

  // 2. X-API-Version header
  const headerVersion = req.headers['x-api-version'];
  if (typeof headerVersion === 'string') {
    return normalizeVersion(headerVersion);
  }

  // 3. Accept header: application/vnd.cms.v1+json
  const acceptHeader = req.headers['accept'];
  if (typeof acceptHeader === 'string') {
    const acceptMatch = acceptHeader.match(/application\/vnd\.cms\.(v\d+)\+json/);
    if (acceptMatch) {
      return normalizeVersion(acceptMatch[1]);
    }
  }

  // 4. Query parameter: ?api_version=1
  const queryVersion = req.query?.['api_version'] ?? req.searchParams?.get('api_version');
  if (queryVersion) {
    return normalizeVersion(queryVersion);
  }

  // 5. Default
  return config.defaultVersion;
}

/**
 * Check if a version is deprecated
 */
export function isDeprecated(version: string): boolean {
  const v = versions.get(normalizeVersion(version));
  if (!v) return false;

  return v.status === VERSION_STATUS.DEPRECATED || v.status === VERSION_STATUS.SUNSET;
}

/**
 * Check if a version is sunset (no longer supported)
 */
export function isSunset(version: string): boolean {
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
 */
export function getDeprecationInfo(version: string): DeprecationInfo | null {
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
 */
export function getDeprecations(): Array<Record<string, unknown>> {
  const deprecations: Array<Record<string, unknown>> = [];

  // Version deprecations
  for (const [version, versionConfig] of versions) {
    if (isDeprecated(version)) {
      deprecations.push({
        type: 'version',
        version,
        deprecatedAt: versionConfig.deprecatedAt,
        sunsetAt: versionConfig.sunsetAt,
        message: `API version ${version} is deprecated`,
      });
    }
  }

  // Endpoint deprecations
  for (const [, deprecation] of endpointDeprecations) {
    deprecations.push({
      type: 'endpoint',
      ...deprecation,
    });
  }

  return deprecations;
}

/** Input for deprecateEndpoint */
interface DeprecateEndpointInfo {
  deprecatedAt?: string;
  sunsetAt?: string | null;
  alternative?: string | null;
  message?: string;
}

/**
 * Register an endpoint deprecation
 */
export function deprecateEndpoint(version: string, endpoint: string, info: DeprecateEndpointInfo = {}): void {
  const key = `${normalizeVersion(version)}:${endpoint}`;

  endpointDeprecations.set(key, {
    version: normalizeVersion(version),
    endpoint,
    deprecatedAt: info.deprecatedAt ?? new Date().toISOString().split('T')[0] ?? '',
    sunsetAt: info.sunsetAt || null,
    alternative: info.alternative || null,
    message: info.message || `Endpoint ${endpoint} is deprecated in ${version}`,
  });
}

/**
 * Check if an endpoint is deprecated
 */
export function getEndpointDeprecation(version: string, endpoint: string): EndpointDeprecation | null {
  const key = `${normalizeVersion(version)}:${endpoint}`;
  return endpointDeprecations.get(key) || null;
}

/**
 * Get version info
 */
export function getVersionInfo(version: string): VersionConfig | null {
  return versions.get(normalizeVersion(version)) || null;
}

/**
 * List all versions
 */
export function listVersions(): Array<VersionConfig & { isDefault: boolean; isCurrent: boolean }> {
  const result: Array<VersionConfig & { isDefault: boolean; isCurrent: boolean }> = [];

  for (const [version, versionConfig] of versions) {
    result.push({
      ...versionConfig,
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
 */
export function getLatestStableVersion(): string {
  for (const [version, versionConfig] of versions) {
    if (versionConfig.status === VERSION_STATUS.STABLE) {
      return version;
    }
  }
  return config.defaultVersion;
}

/**
 * Transform response for a specific version
 */
export function transformResponse(data: Record<string, unknown>, version: string, type: 'list' | 'item' | 'error' = 'item'): Record<string, unknown> {
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
 */
export function registerTransformer(version: string, transformer: VersionTransformer): void {
  transformers.set(normalizeVersion(version), transformer);
}

/**
 * Create version middleware
 */
export function versionMiddleware(): (req: VersionedRequest, res: ServerResponse, next: () => void) => void {
  return (req: VersionedRequest, res: ServerResponse, next: () => void) => {
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
 */
function trackUsage(version: string, endpoint: string, method: string = 'GET'): void {
  if (!usageDir) return;

  const today = new Date().toISOString().split('T')[0];
  const usageFile = join(usageDir, `${today}.json`);

  let usage: Record<string, { total: number; endpoints: Record<string, number> }> = {};
  if (existsSync(usageFile)) {
    try {
      usage = JSON.parse(readFileSync(usageFile, 'utf-8')) as Record<string, { total: number; endpoints: Record<string, number> }>;
    } catch {
      usage = {};
    }
  }

  if (!usage[version]) {
    usage[version] = { total: 0, endpoints: {} };
  }

  usage[version]!.total++;

  const endpointKey = `${method} ${endpoint.split('?')[0] ?? ''}`;
  const versionUsage = usage[version]!;
  versionUsage.endpoints[endpointKey] = (versionUsage.endpoints[endpointKey] ?? 0) + 1;

  try {
    writeFileSync(usageFile, JSON.stringify(usage, null, 2) + '\n');
  } catch {
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

/** Options for getUsageStats */
interface UsageStatsOptions {
  days?: number;
}

/** Usage stats result */
interface UsageStats {
  period: { days: number; start: string | null; end: string | null };
  versions: Record<string, { total: number; endpoints: Record<string, number>; byDay: Record<string, number> }>;
  total: number;
}

/**
 * Get usage stats
 */
export function getUsageStats(options: UsageStatsOptions = {}): UsageStats {
  const { days = 7 } = options;

  const stats: UsageStats = {
    period: { days, start: null, end: null },
    versions: {},
    total: 0,
  };

  // usageDir is null when no analytics path is configured; nothing to aggregate
  if (!usageDir) return stats;

  const now = new Date();
  stats.period.end = now.toISOString().split('T')[0] ?? null;

  for (let i = 0; i < days; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0] ?? '';

    if (i === days - 1) {
      stats.period.start = dateStr;
    }

    const usageFile = join(usageDir, `${dateStr}.json`);
    if (existsSync(usageFile)) {
      try {
        const dayUsage = JSON.parse(readFileSync(usageFile, 'utf-8')) as Record<string, { total?: number; endpoints?: Record<string, number> }>;

        for (const [version, data] of Object.entries(dayUsage)) {
          if (!stats.versions[version]) {
            stats.versions[version] = {
              total: 0,
              endpoints: {},
              byDay: {},
            };
          }

          const vStats = stats.versions[version]!;
          vStats.total += data.total ?? 0;
          if (dateStr) {
            vStats.byDay[dateStr] = data.total ?? 0;
          }
          stats.total += data.total ?? 0;

          for (const [endpoint, count] of Object.entries(data.endpoints ?? {})) {
            vStats.endpoints[endpoint] = (vStats.endpoints[endpoint] ?? 0) + count;
          }
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  return stats;
}

/**
 * Get changelog for all versions
 */
export function getChangelog(): Array<{ version: string; releasedAt: string | null; status: VersionStatus; changes: string[] }> {
  const changelog: Array<{ version: string; releasedAt: string | null; status: VersionStatus; changes: string[] }> = [];

  for (const [version, versionConfig] of versions) {
    if (versionConfig.changes && versionConfig.changes.length > 0) {
      changelog.push({
        version,
        releasedAt: versionConfig.releasedAt,
        status: versionConfig.status,
        changes: versionConfig.changes,
      });
    }
  }

  // Sort by version descending
  changelog.sort((a, b) => b.version.localeCompare(a.version));

  return changelog;
}

/**
 * Get API documentation structure
 */
export function getApiDocs(): Record<string, unknown> {
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
 */
function getEndpointDocs(): Array<Record<string, unknown>> {
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
 */
export function getConfig(): ApiVersionConfig {
  return { ...config };
}

/**
 * Check if API versioning is enabled
 */
export function isEnabled(): boolean {
  return config.enabled;
}

/**
 * Get version status constants
 */
export function getVersionStatuses(): typeof VERSION_STATUS {
  return { ...VERSION_STATUS };
}
