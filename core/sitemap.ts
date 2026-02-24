/**
 * sitemap.ts - XML Sitemap & SEO Tools
 *
 * WHY THIS EXISTS:
 * Generate XML sitemaps and provide SEO audit tools:
 * - XML sitemap for search engine indexing
 * - Sitemap index for large sites (>50k URLs)
 * - robots.txt generation
 * - SEO audit checks per content type
 *
 * DESIGN DECISIONS:
 * - No external XML library - template-based generation
 * - Per-type configuration for URL patterns and priorities
 * - Sitemap protocol 0.9 compliance
 * - robots.txt with sitemap reference
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================================
// Types
// ============================================================================

/** Sitemap type configuration */
interface SitemapTypeConfig {
  enabled: boolean;
  changefreq: string;
  priority: number;
  urlTemplate: string;
  lastmodField: string;
  statusFilter: string;
}

/** Robots.txt rule */
interface RobotsRule {
  userAgent?: string;
  allow?: string | string[];
  disallow?: string | string[];
}

/** Global sitemap configuration */
interface SitemapConfig {
  enabled: boolean;
  siteUrl: string;
  maxUrlsPerSitemap: number;
  types: Record<string, Partial<SitemapTypeConfig>>;
  robotsRules: RobotsRule[];
  excludePaths: string[];
}

/** Content service interface (subset used by sitemap) */
interface ContentService {
  listTypes(): Array<{ type: string }>;
  list(type: string, options?: Record<string, unknown>): { items: ContentItem[]; total: number };
}

/** Content item with dynamic fields */
interface ContentItem {
  id: string;
  title?: string;
  name?: string;
  slug?: string;
  status?: string;
  created?: string;
  updated?: string;
  body?: string;
  content?: string;
  metaDescription?: string;
  description?: string;
  summary?: string;
  [field: string]: unknown;
}

/** SEO severity levels */
type SeoSeverity = 'error' | 'warning' | 'info';

/** SEO audit issue */
interface SeoIssue {
  id: string;
  type: string;
  field: string;
  severity: SeoSeverity;
  message: string;
  suggestion: string;
}

/** SEO audit result */
interface SeoAuditResult {
  errors: SeoIssue[];
  warnings: SeoIssue[];
  info: SeoIssue[];
  summary: {
    total: number;
    passed: number;
    issues: number;
  };
}

/** Sitemap URL entry */
interface SitemapUrlEntry {
  loc: string;
  lastmod: string;
  changefreq: string;
  priority: number;
}

/** Sitemap statistics */
interface SitemapStats {
  totalUrls: number;
  byType: Array<{
    type: string;
    enabled: boolean;
    count: number;
    priority: number;
    changefreq: string;
  }>;
  lastGenerated: string | null;
}

/** Sitemap type listing entry */
interface SitemapTypeEntry {
  type: string;
  enabled: boolean;
  priority: number;
  changefreq: string;
  urlTemplate: string;
  itemCount: number;
}

/** Ping result for a single search engine */
interface PingResult {
  success: boolean;
  message: string;
}

// ============================================================================
// Configuration
// ============================================================================

let config: SitemapConfig = {
  enabled: true,
  siteUrl: 'http://localhost:3000',
  maxUrlsPerSitemap: 50000,
  types: {},
  robotsRules: [],
  excludePaths: ['/admin/', '/api/', '/graphql'],
};

// ============================================================================
// Services
// ============================================================================

let contentService: ContentService | null = null;
let baseDir: string | null = null;
let sitemapConfigPath: string | null = null;

/**
 * Default sitemap configuration for a type
 */
const DEFAULT_SITEMAP_CONFIG: SitemapTypeConfig = {
  enabled: true,
  changefreq: 'weekly',
  priority: 0.5,
  urlTemplate: '/{{type}}/{{slug}}',
  lastmodField: 'updated',
  statusFilter: 'published',
};

/**
 * SEO audit severity levels
 */
const SEVERITY: Record<string, SeoSeverity> = {
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
};

/**
 * Initialize sitemap service
 *
 * @param dir - Base directory
 * @param content - Content service
 * @param sitemapConfig - Configuration
 */
export function init(dir: string, content: ContentService, sitemapConfig: Partial<SitemapConfig> = {}): void {
  baseDir = dir;
  contentService = content;

  config = { ...config, ...sitemapConfig };

  // Load per-type configurations
  sitemapConfigPath = join(baseDir, 'config', 'sitemap.json');
  loadSitemapConfig();
}

/**
 * Load sitemap configuration from file
 */
function loadSitemapConfig(): void {
  if (!sitemapConfigPath) return;
  if (existsSync(sitemapConfigPath)) {
    try {
      const data = JSON.parse(readFileSync(sitemapConfigPath, 'utf-8')) as Record<string, Partial<SitemapTypeConfig>>;
      config.types = { ...config.types, ...data };
    } catch (_e) {
      // Ignore parse errors
    }
  }
}

/**
 * Save sitemap configuration to file
 */
function saveSitemapConfig(): void {
  if (!baseDir || !sitemapConfigPath) return;
  const configDir = join(baseDir, 'config');
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  writeFileSync(sitemapConfigPath, JSON.stringify(config.types, null, 2) + '\n');
}

/**
 * Get sitemap configuration for a type
 *
 * @param type - Content type
 * @returns Sitemap configuration with defaults applied
 */
export function getSitemapConfig(type: string): SitemapTypeConfig {
  const typeConfig = config.types[type] ?? {};
  return {
    ...DEFAULT_SITEMAP_CONFIG,
    ...typeConfig,
  };
}

/**
 * Set sitemap configuration for a type
 *
 * @param type - Content type
 * @param sitemapConfig - Sitemap configuration
 * @returns Updated configuration
 */
export function setSitemapConfig(type: string, sitemapConfig: Partial<SitemapTypeConfig>): SitemapTypeConfig {
  const merged: SitemapTypeConfig = {
    ...getSitemapConfig(type),
    ...sitemapConfig,
  };
  config.types[type] = merged;

  saveSitemapConfig();

  return merged;
}

/**
 * Escape XML special characters
 *
 * @param str - String to escape
 * @returns Escaped string
 */
function escapeXml(str: string | null | undefined): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Format date for sitemap (W3C Datetime)
 *
 * @param date - Date string or Date object
 * @returns W3C Datetime formatted date (YYYY-MM-DD)
 */
function formatSitemapDate(date: string | Date | undefined): string {
  if (!date) return new Date().toISOString().split('T')[0]!;
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().split('T')[0]!;
}

/**
 * Generate URL from template
 *
 * @param item - Content item
 * @param type - Content type
 * @param typeConfig - Type configuration
 * @returns Absolute URL
 */
function generateUrl(item: ContentItem, type: string, typeConfig: SitemapTypeConfig): string {
  let url = typeConfig.urlTemplate || '/{{type}}/{{id}}';

  url = url.replace(/\{\{type\}\}/g, type);
  url = url.replace(/\{\{id\}\}/g, item.id);
  url = url.replace(/\{\{slug\}\}/g, item.slug ?? item.id);

  // Replace any remaining {{field}} patterns
  url = url.replace(/\{\{(\w+)\}\}/g, (_match: string, field: string) => {
    return String(item[field] ?? '');
  });

  return config.siteUrl + url;
}

/**
 * Get content items for sitemap
 *
 * @param type - Content type
 * @returns Array of content items
 */
function getSitemapItems(type: string): ContentItem[] {
  if (!contentService) return [];
  const typeConfig = getSitemapConfig(type);

  // Get content filtered by status
  const result = contentService.list(type, {
    limit: config.maxUrlsPerSitemap,
    sort: typeConfig.lastmodField || 'updated',
    order: 'desc',
  });

  // Filter by status if specified
  if (typeConfig.statusFilter) {
    return result.items.filter(item => item.status === typeConfig.statusFilter);
  }

  return result.items;
}

/**
 * Generate XML sitemap for a specific type
 *
 * @param type - Content type
 * @param _options - Options (reserved for future use)
 * @returns XML sitemap string
 */
export function generateSitemap(type: string, _options: Record<string, unknown> = {}): string {
  const typeConfig = getSitemapConfig(type);
  const items = getSitemapItems(type);

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');

  for (const item of items) {
    const loc = generateUrl(item, type, typeConfig);
    const lastmod = formatSitemapDate(item[typeConfig.lastmodField] as string | undefined ?? item.updated ?? item.created);
    const changefreq = typeConfig.changefreq;
    const priority = typeConfig.priority;

    lines.push('  <url>');
    lines.push(`    <loc>${escapeXml(loc)}</loc>`);
    lines.push(`    <lastmod>${lastmod}</lastmod>`);
    lines.push(`    <changefreq>${changefreq}</changefreq>`);
    lines.push(`    <priority>${priority}</priority>`);
    lines.push('  </url>');
  }

  lines.push('</urlset>');

  return lines.join('\n');
}

/**
 * Generate combined sitemap for all types
 *
 * @param _options - Options (reserved for future use)
 * @returns XML sitemap string
 */
export function generateFullSitemap(_options: Record<string, unknown> = {}): string {
  if (!contentService) return '';

  const types = contentService.listTypes();
  let totalUrls = 0;
  const allUrls: SitemapUrlEntry[] = [];

  for (const { type } of types) {
    const typeConfig = getSitemapConfig(type);
    if (!typeConfig.enabled) continue;

    const items = getSitemapItems(type);

    for (const item of items) {
      const loc = generateUrl(item, type, typeConfig);
      const lastmod = formatSitemapDate(item[typeConfig.lastmodField] as string | undefined ?? item.updated ?? item.created);

      allUrls.push({
        loc,
        lastmod,
        changefreq: typeConfig.changefreq,
        priority: typeConfig.priority,
      });

      totalUrls++;
      if (totalUrls >= config.maxUrlsPerSitemap) break;
    }

    if (totalUrls >= config.maxUrlsPerSitemap) break;
  }

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');

  for (const url of allUrls) {
    lines.push('  <url>');
    lines.push(`    <loc>${escapeXml(url.loc)}</loc>`);
    lines.push(`    <lastmod>${url.lastmod}</lastmod>`);
    lines.push(`    <changefreq>${url.changefreq}</changefreq>`);
    lines.push(`    <priority>${url.priority}</priority>`);
    lines.push('  </url>');
  }

  lines.push('</urlset>');

  return lines.join('\n');
}

/**
 * Generate sitemap index for large sites
 *
 * @returns XML sitemap index string
 */
export function generateSitemapIndex(): string {
  if (!contentService) return '';

  const types = contentService.listTypes();
  const now = formatSitemapDate(new Date());

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');

  for (const { type } of types) {
    const typeConfig = getSitemapConfig(type);
    if (!typeConfig.enabled) continue;

    const itemCount = contentService.list(type, { limit: 1 }).total;
    if (itemCount === 0) continue;

    lines.push('  <sitemap>');
    lines.push(`    <loc>${escapeXml(config.siteUrl)}/sitemap-${type}.xml</loc>`);
    lines.push(`    <lastmod>${now}</lastmod>`);
    lines.push('  </sitemap>');
  }

  lines.push('</sitemapindex>');

  return lines.join('\n');
}

/**
 * Generate robots.txt
 *
 * @param _options - Options (reserved for future use)
 * @returns robots.txt content
 */
export function generateRobotsTxt(_options: Record<string, unknown> = {}): string {
  const lines: string[] = [];

  // Default user-agent
  lines.push('User-agent: *');
  lines.push('Allow: /');

  // Disallowed paths
  for (const path of config.excludePaths) {
    lines.push(`Disallow: ${path}`);
  }

  // Custom rules
  for (const rule of config.robotsRules) {
    if (rule.userAgent) {
      lines.push('');
      lines.push(`User-agent: ${rule.userAgent}`);
    }
    if (rule.allow) {
      for (const path of Array.isArray(rule.allow) ? rule.allow : [rule.allow]) {
        lines.push(`Allow: ${path}`);
      }
    }
    if (rule.disallow) {
      for (const path of Array.isArray(rule.disallow) ? rule.disallow : [rule.disallow]) {
        lines.push(`Disallow: ${path}`);
      }
    }
  }

  // Sitemap reference
  lines.push('');
  lines.push(`Sitemap: ${config.siteUrl}/sitemap.xml`);

  return lines.join('\n');
}

/**
 * Ping search engines about sitemap update
 *
 * @param sitemapUrl - Sitemap URL (optional, uses default)
 * @returns Results per search engine
 */
export async function pingSearchEngines(sitemapUrl: string | null = null): Promise<Record<string, PingResult>> {
  const url = sitemapUrl ?? `${config.siteUrl}/sitemap.xml`;
  const results: Record<string, PingResult> = {
    google: { success: false, message: '' },
    bing: { success: false, message: '' },
  };

  // Note: Google deprecated their ping endpoint in 2023
  // Keeping structure for Bing and future use
  const endpoints = [
    {
      name: 'google',
      url: `https://www.google.com/ping?sitemap=${encodeURIComponent(url)}`,
      deprecated: true,
    },
    {
      name: 'bing',
      url: `https://www.bing.com/ping?sitemap=${encodeURIComponent(url)}`,
      deprecated: false,
    },
  ];

  for (const endpoint of endpoints) {
    if (endpoint.deprecated) {
      results[endpoint.name] = {
        success: false,
        message: 'Endpoint deprecated - use Search Console instead',
      };
      continue;
    }

    try {
      // Using built-in fetch (Node 18+)
      const response = await fetch(endpoint.url, { method: 'GET' });
      results[endpoint.name] = {
        success: response.ok,
        message: response.ok ? 'Ping successful' : `HTTP ${response.status}`,
      };
    } catch (error: unknown) {
      results[endpoint.name] = {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return results;
}

/**
 * Audit SEO for content items
 *
 * @param type - Content type (optional, audits all if not specified)
 * @param id - Content ID (optional, audits all of type if not specified)
 * @returns SEO audit result
 */
export function auditSEO(type: string | null = null, id: string | null = null): SeoAuditResult {
  if (!contentService) {
    return { errors: [], warnings: [], info: [], summary: { total: 0, passed: 0, issues: 0 } };
  }

  const issues: SeoIssue[] = [];
  const types = type ? [{ type }] : contentService.listTypes();

  for (const { type: contentType } of types) {
    const result = contentService.list(contentType, { limit: 1000 });

    for (const item of result.items) {
      if (id && item.id !== id) continue;

      const itemIssues = auditItem(item, contentType);
      issues.push(...itemIssues);
    }
  }

  // Categorize issues
  const errors = issues.filter(i => i.severity === SEVERITY.ERROR);
  const warnings = issues.filter(i => i.severity === SEVERITY.WARNING);
  const info = issues.filter(i => i.severity === SEVERITY.INFO);

  // Calculate summary
  const totalItems = new Set(issues.map(i => i.id)).size || 0;
  const itemsWithIssues = new Set(issues.filter(i => i.severity !== SEVERITY.INFO).map(i => i.id)).size;

  return {
    errors,
    warnings,
    info,
    summary: {
      total: totalItems,
      passed: totalItems - itemsWithIssues,
      issues: itemsWithIssues,
    },
  };
}

/**
 * Audit a single content item for SEO issues
 *
 * @param item - Content item
 * @param type - Content type
 * @returns Array of SEO issues
 */
function auditItem(item: ContentItem, type: string): SeoIssue[] {
  const issues: SeoIssue[] = [];

  // Check title
  const title = item.title ?? item.name ?? '';
  if (!title) {
    issues.push({
      id: item.id,
      type,
      field: 'title',
      severity: SEVERITY.ERROR!,
      message: 'Missing title',
      suggestion: 'Add a descriptive title for this content',
    });
  } else if (title.length > 60) {
    issues.push({
      id: item.id,
      type,
      field: 'title',
      severity: SEVERITY.WARNING!,
      message: `Title too long (${title.length} chars)`,
      suggestion: 'Keep title under 60 characters for better search display',
    });
  }

  // Check meta description
  const description = item.metaDescription ?? item.description ?? item.summary ?? '';
  if (!description) {
    issues.push({
      id: item.id,
      type,
      field: 'metaDescription',
      severity: SEVERITY.WARNING!,
      message: 'Missing meta description',
      suggestion: 'Add a meta description for better search snippets',
    });
  } else if (description.length > 160) {
    issues.push({
      id: item.id,
      type,
      field: 'metaDescription',
      severity: SEVERITY.WARNING!,
      message: `Meta description too long (${description.length} chars)`,
      suggestion: 'Keep meta description under 160 characters',
    });
  }

  // Check slug
  if (!item.slug) {
    issues.push({
      id: item.id,
      type,
      field: 'slug',
      severity: SEVERITY.WARNING!,
      message: 'Missing URL slug',
      suggestion: 'Generate a URL-friendly slug from the title',
    });
  }

  // Check body/content
  const body = item.body ?? item.content ?? '';
  if (!body || String(body).trim().length === 0) {
    issues.push({
      id: item.id,
      type,
      field: 'body',
      severity: SEVERITY.ERROR!,
      message: 'Empty content body',
      suggestion: 'Add content to this item',
    });
  } else if (String(body).length < 300) {
    issues.push({
      id: item.id,
      type,
      field: 'body',
      severity: SEVERITY.INFO!,
      message: `Short content (${String(body).length} chars)`,
      suggestion: 'Consider adding more content for better SEO',
    });
  }

  // Check images for alt text (simple check for img tags without alt)
  const bodyStr = String(body);
  const imgWithoutAlt = bodyStr.match(/<img(?![^>]*alt=)[^>]*>/gi);
  if (imgWithoutAlt && imgWithoutAlt.length > 0) {
    issues.push({
      id: item.id,
      type,
      field: 'body',
      severity: SEVERITY.WARNING!,
      message: `${imgWithoutAlt.length} image(s) missing alt text`,
      suggestion: 'Add alt attributes to all images for accessibility and SEO',
    });
  }

  // Check H1 usage
  const h1Count = (bodyStr.match(/<h1[^>]*>/gi) ?? []).length;
  if (h1Count > 1) {
    issues.push({
      id: item.id,
      type,
      field: 'body',
      severity: SEVERITY.WARNING!,
      message: `Multiple H1 tags (${h1Count} found)`,
      suggestion: 'Use only one H1 tag per page',
    });
  }

  return issues;
}

/**
 * Get sitemap statistics
 *
 * @returns Sitemap statistics
 */
export function getStats(): SitemapStats {
  if (!contentService) {
    return { totalUrls: 0, byType: [], lastGenerated: null };
  }

  const types = contentService.listTypes();
  const stats: SitemapStats = {
    totalUrls: 0,
    byType: [],
    lastGenerated: new Date().toISOString(),
  };

  for (const { type } of types) {
    const typeConfig = getSitemapConfig(type);
    const items = getSitemapItems(type);

    stats.byType.push({
      type,
      enabled: typeConfig.enabled,
      count: items.length,
      priority: typeConfig.priority,
      changefreq: typeConfig.changefreq,
    });

    if (typeConfig.enabled) {
      stats.totalUrls += items.length;
    }
  }

  return stats;
}

/**
 * List all content types with sitemap status
 *
 * @returns Array of type entries
 */
export function listTypes(): SitemapTypeEntry[] {
  if (!contentService) return [];

  const types = contentService.listTypes();
  const result: SitemapTypeEntry[] = [];

  for (const { type } of types) {
    const typeConfig = getSitemapConfig(type);
    const itemCount = contentService.list(type, { limit: 1 }).total;

    result.push({
      type,
      enabled: typeConfig.enabled,
      priority: typeConfig.priority,
      changefreq: typeConfig.changefreq,
      urlTemplate: typeConfig.urlTemplate,
      itemCount,
    });
  }

  return result;
}

/**
 * Get configuration
 *
 * @returns Copy of current configuration
 */
export function getConfig(): SitemapConfig {
  return { ...config };
}

/**
 * Set site URL
 *
 * @param url - Site URL
 */
export function setSiteUrl(url: string): void {
  config.siteUrl = url.replace(/\/$/, ''); // Remove trailing slash
}

/**
 * Check if sitemap is enabled
 *
 * @returns Whether sitemap is enabled
 */
export function isEnabled(): boolean {
  return config.enabled;
}

/**
 * Determine if we need a sitemap index (>50k URLs)
 *
 * @returns Whether sitemap index is needed
 */
export function needsSitemapIndex(): boolean {
  const stats = getStats();
  return stats.totalUrls > config.maxUrlsPerSitemap;
}
