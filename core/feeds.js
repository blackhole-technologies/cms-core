/**
 * feeds.js - Content Syndication & Feed Generation
 *
 * WHY THIS EXISTS:
 * Generate RSS, Atom, and JSON feeds for content syndication:
 * - Auto-generate feeds from content types
 * - Customizable feed configuration per type
 * - Standard format compliance
 * - Feed auto-discovery support
 *
 * DESIGN DECISIONS:
 * - No external XML library - template-based generation
 * - Per-type configuration stored in config
 * - Supports RSS 2.0, Atom 1.0, JSON Feed 1.1
 * - Content filtering by status (published only)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Configuration
 */
let config = {
  enabled: true,
  defaultLimit: 20,
  baseUrl: 'http://localhost:3000',
  types: {},
};

/**
 * Services
 */
let contentService = null;
let baseDir = null;
let feedsConfigPath = null;

/**
 * Default feed configuration for a type
 */
const DEFAULT_FEED_CONFIG = {
  enabled: false,
  title: null, // Auto-generated from type name
  description: '',
  limit: 20,
  includeContent: true,
  contentField: 'body',
  titleField: 'title',
  dateField: 'created',
  authorField: 'author',
  slugField: 'slug',
  linkTemplate: '/{{type}}/{{slug}}',
  formats: ['rss', 'atom', 'json'],
  language: 'en',
  copyright: null,
  image: null,
  categories: [],
};

/**
 * Initialize feeds service
 *
 * @param {string} dir - Base directory
 * @param {Object} content - Content service
 * @param {Object} feedsConfig - Configuration
 */
export function init(dir, content, feedsConfig = {}) {
  baseDir = dir;
  contentService = content;

  config = { ...config, ...feedsConfig };

  // Load per-type configurations
  feedsConfigPath = join(baseDir, 'config', 'feeds.json');
  loadFeedsConfig();
}

/**
 * Load feeds configuration from file
 */
function loadFeedsConfig() {
  if (existsSync(feedsConfigPath)) {
    try {
      const data = JSON.parse(readFileSync(feedsConfigPath, 'utf-8'));
      config.types = { ...config.types, ...data };
    } catch (e) {
      // Ignore parse errors
    }
  }
}

/**
 * Save feeds configuration to file
 */
function saveFeedsConfig() {
  const configDir = join(baseDir, 'config');
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  writeFileSync(feedsConfigPath, JSON.stringify(config.types, null, 2) + '\n');
}

/**
 * Get feed configuration for a type
 *
 * @param {string} type - Content type
 * @returns {Object}
 */
export function getFeedConfig(type) {
  const typeConfig = config.types[type] || {};
  return {
    ...DEFAULT_FEED_CONFIG,
    title: capitalizeFirst(type) + ' Feed',
    ...typeConfig,
  };
}

/**
 * Set feed configuration for a type
 *
 * @param {string} type - Content type
 * @param {Object} feedConfig - Feed configuration
 * @returns {Object}
 */
export function setFeedConfig(type, feedConfig) {
  config.types[type] = {
    ...getFeedConfig(type),
    ...feedConfig,
  };

  saveFeedsConfig();

  return config.types[type];
}

/**
 * List all available feeds
 *
 * @returns {Array}
 */
export function listFeeds() {
  if (!contentService) return [];

  const types = contentService.listTypes();
  const feeds = [];

  for (const { type } of types) {
    const feedConfig = getFeedConfig(type);
    const itemCount = contentService.list(type, { limit: 1 }).total;

    feeds.push({
      type,
      enabled: feedConfig.enabled,
      title: feedConfig.title,
      description: feedConfig.description,
      limit: feedConfig.limit,
      formats: feedConfig.formats,
      itemCount,
      urls: {
        rss: `/feed/${type}.rss`,
        atom: `/feed/${type}.atom`,
        json: `/feed/${type}.json`,
      },
    });
  }

  return feeds;
}

/**
 * Get feed items for a type
 *
 * @param {string} type - Content type
 * @param {Object} options - Options
 * @returns {Array}
 */
function getFeedItems(type, options = {}) {
  const feedConfig = getFeedConfig(type);
  const limit = options.limit || feedConfig.limit || config.defaultLimit;

  // Get published content sorted by date
  const result = contentService.list(type, {
    limit,
    sort: feedConfig.dateField || 'created',
    order: 'desc',
    filters: [{ field: 'status', op: 'eq', value: 'published' }],
  });

  // If no published items, get all items
  if (result.items.length === 0) {
    const allResult = contentService.list(type, {
      limit,
      sort: feedConfig.dateField || 'created',
      order: 'desc',
    });
    return allResult.items;
  }

  return result.items;
}

/**
 * Generate item link from template
 *
 * @param {Object} item - Content item
 * @param {string} type - Content type
 * @param {Object} feedConfig - Feed configuration
 * @returns {string}
 */
function generateItemLink(item, type, feedConfig) {
  let link = feedConfig.linkTemplate || '/{{type}}/{{id}}';

  link = link.replace(/\{\{type\}\}/g, type);
  link = link.replace(/\{\{id\}\}/g, item.id);
  link = link.replace(/\{\{slug\}\}/g, item[feedConfig.slugField] || item.slug || item.id);

  // Replace any remaining {{field}} patterns
  link = link.replace(/\{\{(\w+)\}\}/g, (match, field) => {
    return item[field] || '';
  });

  return config.baseUrl + link;
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
 * Format date for RSS (RFC 822)
 *
 * @param {string|Date} date
 * @returns {string}
 */
function formatRssDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toUTCString();
}

/**
 * Format date for Atom (ISO 8601)
 *
 * @param {string|Date} date
 * @returns {string}
 */
function formatAtomDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString();
}

/**
 * Generate RSS 2.0 feed
 *
 * @param {string} type - Content type
 * @param {Object} options - Options
 * @returns {string}
 */
export function generateRSS(type, options = {}) {
  const feedConfig = getFeedConfig(type);
  const items = getFeedItems(type, options);
  const now = new Date();

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">');
  lines.push('  <channel>');
  lines.push(`    <title>${escapeXml(feedConfig.title)}</title>`);
  lines.push(`    <link>${escapeXml(config.baseUrl)}</link>`);
  lines.push(`    <description>${escapeXml(feedConfig.description || feedConfig.title)}</description>`);
  lines.push(`    <language>${escapeXml(feedConfig.language)}</language>`);
  lines.push(`    <lastBuildDate>${formatRssDate(now)}</lastBuildDate>`);
  lines.push(`    <atom:link href="${escapeXml(config.baseUrl)}/feed/${type}.rss" rel="self" type="application/rss+xml"/>`);

  if (feedConfig.copyright) {
    lines.push(`    <copyright>${escapeXml(feedConfig.copyright)}</copyright>`);
  }

  if (feedConfig.image) {
    lines.push('    <image>');
    lines.push(`      <url>${escapeXml(feedConfig.image)}</url>`);
    lines.push(`      <title>${escapeXml(feedConfig.title)}</title>`);
    lines.push(`      <link>${escapeXml(config.baseUrl)}</link>`);
    lines.push('    </image>');
  }

  for (const item of items) {
    const title = item[feedConfig.titleField] || item.title || item.name || 'Untitled';
    const link = generateItemLink(item, type, feedConfig);
    const date = item[feedConfig.dateField] || item.created;
    const content = feedConfig.includeContent ? (item[feedConfig.contentField] || item.body || '') : '';
    const author = item[feedConfig.authorField] || item.author || '';

    lines.push('    <item>');
    lines.push(`      <title>${escapeXml(title)}</title>`);
    lines.push(`      <link>${escapeXml(link)}</link>`);
    lines.push(`      <guid isPermaLink="true">${escapeXml(link)}</guid>`);
    lines.push(`      <pubDate>${formatRssDate(date)}</pubDate>`);

    if (author) {
      lines.push(`      <author>${escapeXml(author)}</author>`);
    }

    if (content) {
      // Use description for summary, content:encoded for full content
      const summary = content.length > 500 ? content.substring(0, 500) + '...' : content;
      lines.push(`      <description>${escapeXml(summary)}</description>`);
      lines.push(`      <content:encoded><![CDATA[${content}]]></content:encoded>`);
    }

    // Categories
    if (item.category) {
      const cats = Array.isArray(item.category) ? item.category : [item.category];
      for (const cat of cats) {
        lines.push(`      <category>${escapeXml(cat)}</category>`);
      }
    }

    lines.push('    </item>');
  }

  lines.push('  </channel>');
  lines.push('</rss>');

  return lines.join('\n');
}

/**
 * Generate Atom feed
 *
 * @param {string} type - Content type
 * @param {Object} options - Options
 * @returns {string}
 */
export function generateAtom(type, options = {}) {
  const feedConfig = getFeedConfig(type);
  const items = getFeedItems(type, options);
  const now = new Date();

  const feedUrl = `${config.baseUrl}/feed/${type}.atom`;
  const feedId = feedUrl;

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<feed xmlns="http://www.w3.org/2005/Atom">');
  lines.push(`  <title>${escapeXml(feedConfig.title)}</title>`);
  lines.push(`  <subtitle>${escapeXml(feedConfig.description || '')}</subtitle>`);
  lines.push(`  <link href="${escapeXml(feedUrl)}" rel="self" type="application/atom+xml"/>`);
  lines.push(`  <link href="${escapeXml(config.baseUrl)}" rel="alternate" type="text/html"/>`);
  lines.push(`  <id>${escapeXml(feedId)}</id>`);
  lines.push(`  <updated>${formatAtomDate(now)}</updated>`);

  if (feedConfig.copyright) {
    lines.push(`  <rights>${escapeXml(feedConfig.copyright)}</rights>`);
  }

  if (feedConfig.image) {
    lines.push(`  <icon>${escapeXml(feedConfig.image)}</icon>`);
  }

  // Generator
  lines.push('  <generator uri="https://github.com/cms-core" version="0.0.59">CMS Core</generator>');

  for (const item of items) {
    const title = item[feedConfig.titleField] || item.title || item.name || 'Untitled';
    const link = generateItemLink(item, type, feedConfig);
    const date = item[feedConfig.dateField] || item.created;
    const updated = item.updated || date;
    const content = feedConfig.includeContent ? (item[feedConfig.contentField] || item.body || '') : '';
    const author = item[feedConfig.authorField] || item.author || '';

    lines.push('  <entry>');
    lines.push(`    <title>${escapeXml(title)}</title>`);
    lines.push(`    <link href="${escapeXml(link)}" rel="alternate" type="text/html"/>`);
    lines.push(`    <id>${escapeXml(link)}</id>`);
    lines.push(`    <published>${formatAtomDate(date)}</published>`);
    lines.push(`    <updated>${formatAtomDate(updated)}</updated>`);

    if (author) {
      lines.push('    <author>');
      lines.push(`      <name>${escapeXml(author)}</name>`);
      lines.push('    </author>');
    }

    if (content) {
      // Use summary for short, content for full
      const summary = content.length > 500 ? content.substring(0, 500) + '...' : content;
      lines.push(`    <summary type="text">${escapeXml(summary)}</summary>`);
      lines.push(`    <content type="html"><![CDATA[${content}]]></content>`);
    }

    // Categories
    if (item.category) {
      const cats = Array.isArray(item.category) ? item.category : [item.category];
      for (const cat of cats) {
        lines.push(`    <category term="${escapeXml(cat)}"/>`);
      }
    }

    lines.push('  </entry>');
  }

  lines.push('</feed>');

  return lines.join('\n');
}

/**
 * Generate JSON Feed
 *
 * @param {string} type - Content type
 * @param {Object} options - Options
 * @returns {string}
 */
export function generateJSON(type, options = {}) {
  const feedConfig = getFeedConfig(type);
  const items = getFeedItems(type, options);

  const feed = {
    version: 'https://jsonfeed.org/version/1.1',
    title: feedConfig.title,
    home_page_url: config.baseUrl,
    feed_url: `${config.baseUrl}/feed/${type}.json`,
    description: feedConfig.description || undefined,
    language: feedConfig.language,
    items: [],
  };

  if (feedConfig.image) {
    feed.icon = feedConfig.image;
  }

  for (const item of items) {
    const title = item[feedConfig.titleField] || item.title || item.name || 'Untitled';
    const link = generateItemLink(item, type, feedConfig);
    const date = item[feedConfig.dateField] || item.created;
    const updated = item.updated || date;
    const content = feedConfig.includeContent ? (item[feedConfig.contentField] || item.body || '') : '';
    const author = item[feedConfig.authorField] || item.author || '';

    const feedItem = {
      id: item.id,
      title,
      url: link,
      date_published: formatAtomDate(date),
    };

    if (updated !== date) {
      feedItem.date_modified = formatAtomDate(updated);
    }

    if (content) {
      feedItem.content_html = content;
      if (content.length > 500) {
        feedItem.summary = content.substring(0, 500) + '...';
      }
    }

    if (author) {
      feedItem.authors = [{ name: author }];
    }

    if (item.category) {
      feedItem.tags = Array.isArray(item.category) ? item.category : [item.category];
    }

    if (item.image) {
      feedItem.image = item.image.startsWith('http') ? item.image : config.baseUrl + item.image;
    }

    feed.items.push(feedItem);
  }

  return JSON.stringify(feed, null, 2);
}

/**
 * Generate feed in specified format
 *
 * @param {string} type - Content type
 * @param {string} format - Feed format (rss, atom, json)
 * @param {Object} options - Options
 * @returns {string}
 */
export function generateFeed(type, format = 'rss', options = {}) {
  switch (format.toLowerCase()) {
    case 'atom':
      return generateAtom(type, options);
    case 'json':
      return generateJSON(type, options);
    case 'rss':
    default:
      return generateRSS(type, options);
  }
}

/**
 * Validate feed configuration
 *
 * @param {string} type - Content type
 * @returns {Object}
 */
export function validateFeed(type) {
  const errors = [];
  const warnings = [];

  // Check if type exists
  if (!contentService) {
    errors.push('Content service not available');
    return { valid: false, errors, warnings };
  }

  const types = contentService.listTypes();
  const typeExists = types.some(t => t.type === type);

  if (!typeExists) {
    errors.push(`Content type "${type}" does not exist`);
    return { valid: false, errors, warnings };
  }

  const feedConfig = getFeedConfig(type);

  // Check title field exists
  const typeSchema = types.find(t => t.type === type)?.schema || {};
  if (feedConfig.titleField !== 'title' && feedConfig.titleField !== 'name') {
    if (!typeSchema[feedConfig.titleField]) {
      warnings.push(`Title field "${feedConfig.titleField}" not found in schema`);
    }
  }

  // Check content field exists
  if (feedConfig.includeContent && feedConfig.contentField !== 'body') {
    if (!typeSchema[feedConfig.contentField]) {
      warnings.push(`Content field "${feedConfig.contentField}" not found in schema`);
    }
  }

  // Check date field exists
  if (feedConfig.dateField !== 'created' && feedConfig.dateField !== 'updated') {
    if (!typeSchema[feedConfig.dateField]) {
      warnings.push(`Date field "${feedConfig.dateField}" not found in schema`);
    }
  }

  // Check for content
  const itemCount = contentService.list(type, { limit: 1 }).total;
  if (itemCount === 0) {
    warnings.push('No content items found for this type');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    feedConfig,
    itemCount,
  };
}

/**
 * Get auto-discovery link tags for HTML head
 *
 * @param {string} type - Content type (optional, returns all if not specified)
 * @returns {Array}
 */
export function getDiscoveryLinks(type = null) {
  const links = [];
  const feeds = listFeeds();

  for (const feed of feeds) {
    if (!feed.enabled) continue;
    if (type && feed.type !== type) continue;

    if (feed.formats.includes('rss')) {
      links.push({
        rel: 'alternate',
        type: 'application/rss+xml',
        title: feed.title + ' (RSS)',
        href: feed.urls.rss,
      });
    }

    if (feed.formats.includes('atom')) {
      links.push({
        rel: 'alternate',
        type: 'application/atom+xml',
        title: feed.title + ' (Atom)',
        href: feed.urls.atom,
      });
    }

    if (feed.formats.includes('json')) {
      links.push({
        rel: 'alternate',
        type: 'application/feed+json',
        title: feed.title + ' (JSON)',
        href: feed.urls.json,
      });
    }
  }

  return links;
}

/**
 * Generate HTML link tags for auto-discovery
 *
 * @param {string} type - Content type (optional)
 * @returns {string}
 */
export function getDiscoveryHTML(type = null) {
  const links = getDiscoveryLinks(type);
  return links.map(link =>
    `<link rel="${link.rel}" type="${link.type}" title="${escapeXml(link.title)}" href="${escapeXml(link.href)}">`
  ).join('\n');
}

/**
 * Get content type for feed format
 *
 * @param {string} format
 * @returns {string}
 */
export function getContentType(format) {
  switch (format.toLowerCase()) {
    case 'atom':
      return 'application/atom+xml; charset=utf-8';
    case 'json':
      return 'application/feed+json; charset=utf-8';
    case 'rss':
    default:
      return 'application/rss+xml; charset=utf-8';
  }
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
 * Set base URL
 *
 * @param {string} url
 */
export function setBaseUrl(url) {
  config.baseUrl = url.replace(/\/$/, ''); // Remove trailing slash
}

/**
 * Check if feeds are enabled
 *
 * @returns {boolean}
 */
export function isEnabled() {
  return config.enabled;
}

/**
 * Capitalize first letter
 *
 * @param {string} str
 * @returns {string}
 */
function capitalizeFirst(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}
