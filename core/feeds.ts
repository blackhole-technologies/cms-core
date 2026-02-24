/**
 * feeds.ts - Content Syndication & Feed Generation
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

// ============================================================================
// Types
// ============================================================================

/** Feed format type */
type FeedFormat = 'rss' | 'atom' | 'json';

/** Configuration for a specific feed type */
interface FeedTypeConfig {
  enabled: boolean;
  title: string | null;
  description: string;
  limit: number;
  includeContent: boolean;
  contentField: string;
  titleField: string;
  dateField: string;
  authorField: string;
  slugField: string;
  linkTemplate: string;
  formats: FeedFormat[];
  language: string;
  copyright: string | null;
  image: string | null;
  categories: string[];
}

/** Global feed configuration */
interface FeedConfig {
  enabled: boolean;
  defaultLimit: number;
  baseUrl: string;
  types: Record<string, Partial<FeedTypeConfig>>;
}

/** Content service interface (subset used by feeds) */
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
  body?: string;
  author?: string;
  created?: string;
  updated?: string;
  category?: string | string[];
  image?: string;
  [field: string]: unknown;
}

/** Feed listing entry */
interface FeedListEntry {
  type: string;
  enabled: boolean;
  title: string | null;
  description: string;
  limit: number;
  formats: FeedFormat[];
  itemCount: number;
  urls: {
    rss: string;
    atom: string;
    json: string;
  };
}

/** Feed validation result */
interface FeedValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  feedConfig?: FeedTypeConfig;
  itemCount?: number;
}

/** Discovery link entry */
interface DiscoveryLink {
  rel: string;
  type: string;
  title: string;
  href: string;
}

/** Options for feed item retrieval */
interface FeedItemOptions {
  limit?: number;
}

/** Options for feed generation */
interface FeedGenerateOptions {
  limit?: number;
}

// ============================================================================
// Configuration
// ============================================================================

let config: FeedConfig = {
  enabled: true,
  defaultLimit: 20,
  baseUrl: 'http://localhost:3000',
  types: {},
};

// ============================================================================
// Services
// ============================================================================

let contentService: ContentService | null = null;
let baseDir: string | null = null;
let feedsConfigPath: string | null = null;

/**
 * Default feed configuration for a type
 */
const DEFAULT_FEED_CONFIG: FeedTypeConfig = {
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
 * @param dir - Base directory
 * @param content - Content service
 * @param feedsConfig - Configuration
 */
export function init(dir: string, content: ContentService, feedsConfig: Partial<FeedConfig> = {}): void {
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
function loadFeedsConfig(): void {
  if (!feedsConfigPath) return;
  if (existsSync(feedsConfigPath)) {
    try {
      const data = JSON.parse(readFileSync(feedsConfigPath, 'utf-8')) as Record<string, Partial<FeedTypeConfig>>;
      config.types = { ...config.types, ...data };
    } catch (_e) {
      // Ignore parse errors
    }
  }
}

/**
 * Save feeds configuration to file
 */
function saveFeedsConfig(): void {
  if (!baseDir || !feedsConfigPath) return;
  const configDir = join(baseDir, 'config');
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  writeFileSync(feedsConfigPath, JSON.stringify(config.types, null, 2) + '\n');
}

/**
 * Get feed configuration for a type
 *
 * @param type - Content type
 * @returns Feed configuration with defaults applied
 */
export function getFeedConfig(type: string): FeedTypeConfig {
  const typeConfig = config.types[type] ?? {};
  return {
    ...DEFAULT_FEED_CONFIG,
    title: capitalizeFirst(type) + ' Feed',
    ...typeConfig,
  };
}

/**
 * Set feed configuration for a type
 *
 * @param type - Content type
 * @param feedConfig - Feed configuration
 * @returns Updated configuration
 */
export function setFeedConfig(type: string, feedConfig: Partial<FeedTypeConfig>): FeedTypeConfig {
  const merged: FeedTypeConfig = {
    ...getFeedConfig(type),
    ...feedConfig,
  };
  config.types[type] = merged;

  saveFeedsConfig();

  return merged;
}

/**
 * List all available feeds
 *
 * @returns Array of feed listing entries
 */
export function listFeeds(): FeedListEntry[] {
  if (!contentService) return [];

  const types = contentService.listTypes();
  const feeds: FeedListEntry[] = [];

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
 * @param type - Content type
 * @param options - Options
 * @returns Array of content items
 */
function getFeedItems(type: string, options: FeedItemOptions = {}): ContentItem[] {
  if (!contentService) return [];
  const feedConfig = getFeedConfig(type);
  const limit = options.limit ?? feedConfig.limit ?? config.defaultLimit;

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
 * @param item - Content item
 * @param type - Content type
 * @param feedConfig - Feed configuration
 * @returns Absolute URL
 */
function generateItemLink(item: ContentItem, type: string, feedConfig: FeedTypeConfig): string {
  let link = feedConfig.linkTemplate || '/{{type}}/{{id}}';

  link = link.replace(/\{\{type\}\}/g, type);
  link = link.replace(/\{\{id\}\}/g, item.id);
  const slugValue = item[feedConfig.slugField];
  link = link.replace(/\{\{slug\}\}/g, String(slugValue ?? item.slug ?? item.id));

  // Replace any remaining {{field}} patterns
  link = link.replace(/\{\{(\w+)\}\}/g, (_match: string, field: string) => {
    return String(item[field] ?? '');
  });

  return config.baseUrl + link;
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
 * Format date for RSS (RFC 822)
 *
 * @param date - Date string or Date object
 * @returns RFC 822 formatted date
 */
function formatRssDate(date: string | Date | undefined): string {
  const d = date instanceof Date ? date : new Date(date ?? Date.now());
  return d.toUTCString();
}

/**
 * Format date for Atom (ISO 8601)
 *
 * @param date - Date string or Date object
 * @returns ISO 8601 formatted date
 */
function formatAtomDate(date: string | Date | undefined): string {
  const d = date instanceof Date ? date : new Date(date ?? Date.now());
  return d.toISOString();
}

/**
 * Generate RSS 2.0 feed
 *
 * @param type - Content type
 * @param options - Options
 * @returns RSS XML string
 */
export function generateRSS(type: string, options: FeedGenerateOptions = {}): string {
  const feedConfig = getFeedConfig(type);
  const items = getFeedItems(type, options);
  const now = new Date();

  const lines: string[] = [];
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
    const title = String(item[feedConfig.titleField] ?? item.title ?? item.name ?? 'Untitled');
    const link = generateItemLink(item, type, feedConfig);
    const date = item[feedConfig.dateField] as string | undefined ?? item.created;
    const content = feedConfig.includeContent ? String(item[feedConfig.contentField] ?? item.body ?? '') : '';
    const author = String(item[feedConfig.authorField] ?? item.author ?? '');

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
 * @param type - Content type
 * @param options - Options
 * @returns Atom XML string
 */
export function generateAtom(type: string, options: FeedGenerateOptions = {}): string {
  const feedConfig = getFeedConfig(type);
  const items = getFeedItems(type, options);
  const now = new Date();

  const feedUrl = `${config.baseUrl}/feed/${type}.atom`;
  const feedId = feedUrl;

  const lines: string[] = [];
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
    const title = String(item[feedConfig.titleField] ?? item.title ?? item.name ?? 'Untitled');
    const link = generateItemLink(item, type, feedConfig);
    const date = item[feedConfig.dateField] as string | undefined ?? item.created;
    const updated = (item.updated as string | undefined) ?? date;
    const content = feedConfig.includeContent ? String(item[feedConfig.contentField] ?? item.body ?? '') : '';
    const author = String(item[feedConfig.authorField] ?? item.author ?? '');

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

/** JSON Feed item structure */
interface JsonFeedItem {
  id: string;
  title: string;
  url: string;
  date_published: string;
  date_modified?: string;
  content_html?: string;
  summary?: string;
  authors?: Array<{ name: string }>;
  tags?: string[];
  image?: string;
}

/** JSON Feed structure */
interface JsonFeed {
  version: string;
  title: string | null;
  home_page_url: string;
  feed_url: string;
  description?: string;
  language: string;
  icon?: string;
  items: JsonFeedItem[];
}

/**
 * Generate JSON Feed
 *
 * @param type - Content type
 * @param options - Options
 * @returns JSON Feed string
 */
export function generateJSON(type: string, options: FeedGenerateOptions = {}): string {
  const feedConfig = getFeedConfig(type);
  const items = getFeedItems(type, options);

  const feed: JsonFeed = {
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
    const title = String(item[feedConfig.titleField] ?? item.title ?? item.name ?? 'Untitled');
    const link = generateItemLink(item, type, feedConfig);
    const date = item[feedConfig.dateField] as string | undefined ?? item.created;
    const updated = (item.updated as string | undefined) ?? date;
    const content = feedConfig.includeContent ? String(item[feedConfig.contentField] ?? item.body ?? '') : '';
    const author = String(item[feedConfig.authorField] ?? item.author ?? '');

    const feedItem: JsonFeedItem = {
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
      const img = String(item.image);
      feedItem.image = img.startsWith('http') ? img : config.baseUrl + img;
    }

    feed.items.push(feedItem);
  }

  return JSON.stringify(feed, null, 2);
}

/**
 * Generate feed in specified format
 *
 * @param type - Content type
 * @param format - Feed format (rss, atom, json)
 * @param options - Options
 * @returns Feed string
 */
export function generateFeed(type: string, format: string = 'rss', options: FeedGenerateOptions = {}): string {
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
 * @param type - Content type
 * @returns Validation result
 */
export function validateFeed(type: string): FeedValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

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
  const typeEntry = types.find(t => t.type === type);
  const typeSchema = ((typeEntry as Record<string, unknown> | undefined)?.schema ?? {}) as Record<string, unknown>;
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
 * @param type - Content type (optional, returns all if not specified)
 * @returns Array of discovery link objects
 */
export function getDiscoveryLinks(type: string | null = null): DiscoveryLink[] {
  const links: DiscoveryLink[] = [];
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
 * @param type - Content type (optional)
 * @returns HTML string of link tags
 */
export function getDiscoveryHTML(type: string | null = null): string {
  const links = getDiscoveryLinks(type);
  return links.map(link =>
    `<link rel="${link.rel}" type="${link.type}" title="${escapeXml(link.title)}" href="${escapeXml(link.href)}">`
  ).join('\n');
}

/**
 * Get content type for feed format
 *
 * @param format - Feed format
 * @returns MIME content type
 */
export function getContentType(format: string): string {
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
 * @returns Copy of current configuration
 */
export function getConfig(): FeedConfig {
  return { ...config };
}

/**
 * Set base URL
 *
 * @param url - Base URL
 */
export function setBaseUrl(url: string): void {
  config.baseUrl = url.replace(/\/$/, ''); // Remove trailing slash
}

/**
 * Check if feeds are enabled
 *
 * @returns Whether feeds are enabled
 */
export function isEnabled(): boolean {
  return config.enabled;
}

/**
 * Capitalize first letter
 *
 * @param str - String to capitalize
 * @returns Capitalized string
 */
function capitalizeFirst(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}
