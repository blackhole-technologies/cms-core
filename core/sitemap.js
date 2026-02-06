/**
 * sitemap.js - XML Sitemap & SEO Tools
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

/**
 * Configuration
 */
let config = {
  enabled: true,
  siteUrl: 'http://localhost:3000',
  maxUrlsPerSitemap: 50000,
  types: {},
  robotsRules: [],
  excludePaths: ['/admin/', '/api/', '/graphql'],
};

/**
 * Services
 */
let contentService = null;
let baseDir = null;
let sitemapConfigPath = null;

/**
 * Default sitemap configuration for a type
 */
const DEFAULT_SITEMAP_CONFIG = {
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
const SEVERITY = {
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
};

/**
 * Initialize sitemap service
 *
 * @param {string} dir - Base directory
 * @param {Object} content - Content service
 * @param {Object} sitemapConfig - Configuration
 */
export function init(dir, content, sitemapConfig = {}) {
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
function loadSitemapConfig() {
  if (existsSync(sitemapConfigPath)) {
    try {
      const data = JSON.parse(readFileSync(sitemapConfigPath, 'utf-8'));
      config.types = { ...config.types, ...data };
    } catch (e) {
      // Ignore parse errors
    }
  }
}

/**
 * Save sitemap configuration to file
 */
function saveSitemapConfig() {
  const configDir = join(baseDir, 'config');
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  writeFileSync(sitemapConfigPath, JSON.stringify(config.types, null, 2) + '\n');
}

/**
 * Get sitemap configuration for a type
 *
 * @param {string} type - Content type
 * @returns {Object}
 */
export function getSitemapConfig(type) {
  const typeConfig = config.types[type] || {};
  return {
    ...DEFAULT_SITEMAP_CONFIG,
    ...typeConfig,
  };
}

/**
 * Set sitemap configuration for a type
 *
 * @param {string} type - Content type
 * @param {Object} sitemapConfig - Sitemap configuration
 * @returns {Object}
 */
export function setSitemapConfig(type, sitemapConfig) {
  config.types[type] = {
    ...getSitemapConfig(type),
    ...sitemapConfig,
  };

  saveSitemapConfig();

  return config.types[type];
}

/**
 * Escape XML special characters
 *
 * @param {string} str
 * @returns {string}
 */
function escapeXml(str) {
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
 * @param {string|Date} date
 * @returns {string}
 */
function formatSitemapDate(date) {
  if (!date) return new Date().toISOString().split('T')[0];
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().split('T')[0];
}

/**
 * Generate URL from template
 *
 * @param {Object} item - Content item
 * @param {string} type - Content type
 * @param {Object} typeConfig - Type configuration
 * @returns {string}
 */
function generateUrl(item, type, typeConfig) {
  let url = typeConfig.urlTemplate || '/{{type}}/{{id}}';

  url = url.replace(/\{\{type\}\}/g, type);
  url = url.replace(/\{\{id\}\}/g, item.id);
  url = url.replace(/\{\{slug\}\}/g, item.slug || item.id);

  // Replace any remaining {{field}} patterns
  url = url.replace(/\{\{(\w+)\}\}/g, (match, field) => {
    return item[field] || '';
  });

  return config.siteUrl + url;
}

/**
 * Get content items for sitemap
 *
 * @param {string} type - Content type
 * @returns {Array}
 */
function getSitemapItems(type) {
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
 * @param {string} type - Content type
 * @param {Object} options - Options
 * @returns {string}
 */
export function generateSitemap(type, options = {}) {
  const typeConfig = getSitemapConfig(type);
  const items = getSitemapItems(type);

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');

  for (const item of items) {
    const loc = generateUrl(item, type, typeConfig);
    const lastmod = formatSitemapDate(item[typeConfig.lastmodField] || item.updated || item.created);
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
 * @param {Object} options - Options
 * @returns {string}
 */
export function generateFullSitemap(options = {}) {
  if (!contentService) return '';

  const types = contentService.listTypes();
  let totalUrls = 0;
  const allUrls = [];

  for (const { type } of types) {
    const typeConfig = getSitemapConfig(type);
    if (!typeConfig.enabled) continue;

    const items = getSitemapItems(type);

    for (const item of items) {
      const loc = generateUrl(item, type, typeConfig);
      const lastmod = formatSitemapDate(item[typeConfig.lastmodField] || item.updated || item.created);

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

  const lines = [];
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
 * @returns {string}
 */
export function generateSitemapIndex() {
  if (!contentService) return '';

  const types = contentService.listTypes();
  const now = formatSitemapDate(new Date());

  const lines = [];
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
 * @param {Object} options - Options
 * @returns {string}
 */
export function generateRobotsTxt(options = {}) {
  const lines = [];

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
 * @param {string} sitemapUrl - Sitemap URL (optional, uses default)
 * @returns {Promise<Object>}
 */
export async function pingSearchEngines(sitemapUrl = null) {
  const url = sitemapUrl || `${config.siteUrl}/sitemap.xml`;
  const results = {
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
    } catch (error) {
      results[endpoint.name] = {
        success: false,
        message: error.message,
      };
    }
  }

  return results;
}

/**
 * Audit SEO for content items
 *
 * @param {string} type - Content type (optional, audits all if not specified)
 * @param {string} id - Content ID (optional, audits all of type if not specified)
 * @returns {Object}
 */
export function auditSEO(type = null, id = null) {
  if (!contentService) {
    return { errors: [], warnings: [], info: [], summary: { total: 0, passed: 0, issues: 0 } };
  }

  const issues = [];
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
 * @param {Object} item - Content item
 * @param {string} type - Content type
 * @returns {Array}
 */
function auditItem(item, type) {
  const issues = [];

  // Check title
  const title = item.title || item.name || '';
  if (!title) {
    issues.push({
      id: item.id,
      type,
      field: 'title',
      severity: SEVERITY.ERROR,
      message: 'Missing title',
      suggestion: 'Add a descriptive title for this content',
    });
  } else if (title.length > 60) {
    issues.push({
      id: item.id,
      type,
      field: 'title',
      severity: SEVERITY.WARNING,
      message: `Title too long (${title.length} chars)`,
      suggestion: 'Keep title under 60 characters for better search display',
    });
  }

  // Check meta description
  const description = item.metaDescription || item.description || item.summary || '';
  if (!description) {
    issues.push({
      id: item.id,
      type,
      field: 'metaDescription',
      severity: SEVERITY.WARNING,
      message: 'Missing meta description',
      suggestion: 'Add a meta description for better search snippets',
    });
  } else if (description.length > 160) {
    issues.push({
      id: item.id,
      type,
      field: 'metaDescription',
      severity: SEVERITY.WARNING,
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
      severity: SEVERITY.WARNING,
      message: 'Missing URL slug',
      suggestion: 'Generate a URL-friendly slug from the title',
    });
  }

  // Check body/content
  const body = item.body || item.content || '';
  if (!body || body.trim().length === 0) {
    issues.push({
      id: item.id,
      type,
      field: 'body',
      severity: SEVERITY.ERROR,
      message: 'Empty content body',
      suggestion: 'Add content to this item',
    });
  } else if (body.length < 300) {
    issues.push({
      id: item.id,
      type,
      field: 'body',
      severity: SEVERITY.INFO,
      message: `Short content (${body.length} chars)`,
      suggestion: 'Consider adding more content for better SEO',
    });
  }

  // Check images for alt text (simple check for img tags without alt)
  const imgWithoutAlt = body.match(/<img(?![^>]*alt=)[^>]*>/gi);
  if (imgWithoutAlt && imgWithoutAlt.length > 0) {
    issues.push({
      id: item.id,
      type,
      field: 'body',
      severity: SEVERITY.WARNING,
      message: `${imgWithoutAlt.length} image(s) missing alt text`,
      suggestion: 'Add alt attributes to all images for accessibility and SEO',
    });
  }

  // Check H1 usage
  const h1Count = (body.match(/<h1[^>]*>/gi) || []).length;
  if (h1Count > 1) {
    issues.push({
      id: item.id,
      type,
      field: 'body',
      severity: SEVERITY.WARNING,
      message: `Multiple H1 tags (${h1Count} found)`,
      suggestion: 'Use only one H1 tag per page',
    });
  }

  return issues;
}

/**
 * Get sitemap statistics
 *
 * @returns {Object}
 */
export function getStats() {
  if (!contentService) {
    return { totalUrls: 0, byType: [], lastGenerated: null };
  }

  const types = contentService.listTypes();
  const stats = {
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
 * @returns {Array}
 */
export function listTypes() {
  if (!contentService) return [];

  const types = contentService.listTypes();
  const result = [];

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
 * @returns {Object}
 */
export function getConfig() {
  return { ...config };
}

/**
 * Set site URL
 *
 * @param {string} url
 */
export function setSiteUrl(url) {
  config.siteUrl = url.replace(/\/$/, ''); // Remove trailing slash
}

/**
 * Check if sitemap is enabled
 *
 * @returns {boolean}
 */
export function isEnabled() {
  return config.enabled;
}

/**
 * Determine if we need a sitemap index (>50k URLs)
 *
 * @returns {boolean}
 */
export function needsSitemapIndex() {
  const stats = getStats();
  return stats.totalUrls > config.maxUrlsPerSitemap;
}
