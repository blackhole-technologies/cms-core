/**
 * text-formats.ts - Text Format and Filter System
 *
 * WHY THIS EXISTS:
 * User-generated content needs transformation before display:
 * - Security: strip malicious HTML tags
 * - UX: convert URLs to links, line breaks to paragraphs
 * - Flexibility: different content types need different processing
 *
 * INSPIRED BY: Drupal's text format system
 * - Named text formats (plain_text, basic_html, full_html)
 * - Each format has filters that transform text
 * - Filters run in weight order (like middleware)
 * - Role-based permissions control format access
 *
 * DESIGN DECISIONS:
 * - Zero dependencies (Node.js stdlib only)
 * - Filter chain pattern (each filter transforms text)
 * - Weight-based ordering (predictable execution)
 * - Caching support (avoid re-processing identical text)
 * - Hook integration (extensibility)
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import * as hooks from './hooks.ts';

// ===========================================
// Types
// ===========================================

/** Settings passed to a filter's process function */
interface FilterSettings {
  [key: string]: unknown;
}

/** A filter implementation containing the transform function and default settings */
interface FilterImplementation {
  process: (text: string, settings: FilterSettings) => string;
  defaults: FilterSettings;
}

/** Configuration for registering a filter */
interface FilterConfig {
  process: (text: string, settings: FilterSettings) => string;
  defaults?: FilterSettings;
}

/** A single filter entry within a text format's filter chain */
interface FilterChainEntry {
  weight: number;
  status: boolean;
  settings?: FilterSettings;
}

/** A text format definition with its filter chain and access control */
interface TextFormat {
  label: string;
  weight: number;
  filters: Record<string, FilterChainEntry>;
  roles: string[];
}

/** Configuration for creating a new text format */
interface TextFormatConfig {
  label: string;
  weight?: number;
  filters?: Record<string, FilterChainEntry>;
  roles?: string[];
}

/** A cache instance that supports get, set, and clear operations */
interface CacheInstance {
  get(key: string): unknown;
  set(key: string, value: unknown, ttl: number): void;
  clear(pattern: string): void;
}

/** A user object for access control checks */
interface TextFormatUser {
  roles?: string[];
}

// ===========================================
// State
// ===========================================

/**
 * Base directory for configuration files
 */
let baseDir = './data';

/**
 * Cache instance (optional, passed in init)
 */
let cache: CacheInstance | null = null;

/**
 * Registered text formats
 * Structure: { formatId: { label, weight, filters, roles } }
 */
const formats: Record<string, TextFormat> = {};

/**
 * Registered filter implementations
 * Structure: { filterName: { process, defaults } }
 */
const filters: Record<string, FilterImplementation> = {};

/**
 * Default format ID for fallback
 */
let defaultFormatId = 'plain_text';

// ===========================================
// Initialization
// ===========================================

/**
 * Initialize text format system
 *
 * @param dir - Base directory for config files
 * @param cacheInstance - Optional cache instance
 */
export async function init(dir = './data', cacheInstance: CacheInstance | null = null): Promise<void> {
  baseDir = dir;
  cache = cacheInstance;

  // Register built-in filters
  registerBuiltInFilters();

  // Load formats from config
  await loadFormats();
}

/**
 * Register all built-in filters
 */
function registerBuiltInFilters(): void {
  // Plain text - escape all HTML
  registerFilter('filter_plain', {
    process: (text: string): string => {
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    },
    defaults: {},
  });

  // HTML filter - strip/allow specific tags
  registerFilter('filter_html', {
    process: (text: string, settings: FilterSettings): string => {
      const allowedTags = (settings.allowed_tags as string) || '<p><br><strong><em><a><ul><ol><li><h2><h3><blockquote>';

      // Parse allowed tags into array
      const tagPattern = /<([a-z][a-z0-9]*)\b[^>]*>/gi;
      const allowed = new Set<string>();
      let match: RegExpExecArray | null;
      while ((match = tagPattern.exec(allowedTags)) !== null) {
        allowed.add(match[1]!.toLowerCase());
      }

      // Strip disallowed tags
      return text.replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (fullMatch: string, tagName: string): string => {
        const tag = tagName.toLowerCase();
        if (allowed.has(tag)) {
          return fullMatch; // Keep allowed tags
        }
        return ''; // Strip disallowed tags
      });
    },
    defaults: {
      allowed_tags: '<p><br><strong><em><a><ul><ol><li><h2><h3><blockquote>',
    },
  });

  // Auto-paragraph - convert line breaks to <p> and <br>
  registerFilter('filter_autop', {
    process: (text: string): string => {
      // Split into blocks (double line breaks)
      const blocks = text.split(/\n\s*\n/);

      return blocks
        .map(block => {
          // Don't wrap existing HTML tags
          if (block.trim().startsWith('<')) {
            return block;
          }

          // Convert single line breaks to <br>
          const withBreaks = block.replace(/\n/g, '<br>\n');

          // Wrap in <p> tags
          return `<p>${withBreaks}</p>`;
        })
        .join('\n\n');
    },
    defaults: {},
  });

  // URL filter - auto-link URLs
  registerFilter('filter_url', {
    process: (text: string, settings: FilterSettings): string => {
      const maxLength = (settings.length as number) || 72;

      // URL regex pattern
      const urlPattern = /\b(https?:\/\/[^\s<]+)/g;

      return text.replace(urlPattern, (url: string): string => {
        // Truncate long URLs
        let displayUrl = url;
        if (url.length > maxLength) {
          displayUrl = url.substring(0, maxLength - 3) + '...';
        }

        return `<a href="${url}" rel="nofollow">${displayUrl}</a>`;
      });
    },
    defaults: {
      length: 72,
    },
  });

  // HTML corrector - fix broken HTML
  registerFilter('filter_htmlcorrector', {
    process: (text: string): string => {
      // Stack to track open tags
      const stack: string[] = [];
      const voidTags = new Set(['br', 'hr', 'img', 'input', 'meta', 'link']);

      // Find all tags
      const tagPattern = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;
      const tags: Array<{ match: string; tag: string; isClosing: boolean; index: number }> = [];
      let match: RegExpExecArray | null;

      while ((match = tagPattern.exec(text)) !== null) {
        const isClosing = match[0].startsWith('</');
        const tagName = match[1]!.toLowerCase();

        tags.push({
          match: match[0],
          tag: tagName,
          isClosing,
          index: match.index,
        });
      }

      // Process tags and track unclosed ones
      for (const { tag, isClosing } of tags) {
        if (voidTags.has(tag)) {
          continue; // Skip void tags
        }

        if (isClosing) {
          // Pop matching opening tag
          if (stack.length > 0 && stack[stack.length - 1] === tag) {
            stack.pop();
          }
        } else {
          // Push opening tag
          stack.push(tag);
        }
      }

      // Append missing closing tags
      let result = text;
      while (stack.length > 0) {
        const tag = stack.pop();
        result += `</${tag}>`;
      }

      return result;
    },
    defaults: {},
  });
}

// ===========================================
// Filter Registration
// ===========================================

/**
 * Register a filter implementation
 *
 * @param name - Filter identifier
 * @param config - Filter configuration with process function and optional defaults
 */
export function registerFilter(name: string, config: FilterConfig): void {
  if (!config.process || typeof config.process !== 'function') {
    throw new Error(`Filter "${name}" must have a process function`);
  }

  filters[name] = {
    process: config.process,
    defaults: config.defaults || {},
  };
}

// ===========================================
// Format Management
// ===========================================

/**
 * Load formats from config file
 */
async function loadFormats(): Promise<void> {
  const configPath = join(baseDir, 'config', 'text-formats.json');

  if (!existsSync(configPath)) {
    // Create default formats
    await createDefaultFormats();
    return;
  }

  try {
    const data = await readFile(configPath, 'utf8');
    const parsedConfig: { formats?: Record<string, TextFormat>; default?: string } = JSON.parse(data);

    // Load formats
    for (const [id, format] of Object.entries(parsedConfig.formats || {})) {
      formats[id] = format;
    }

    // Set default format
    if (parsedConfig.default) {
      defaultFormatId = parsedConfig.default;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[text-formats] Failed to load config:', message);
    await createDefaultFormats();
  }
}

/**
 * Save formats to config file
 */
async function saveFormats(): Promise<void> {
  const configPath = join(baseDir, 'config', 'text-formats.json');
  const configDir = join(baseDir, 'config');

  // Ensure config directory exists
  if (!existsSync(configDir)) {
    await mkdir(configDir, { recursive: true });
  }

  const configData = {
    formats,
    default: defaultFormatId,
  };

  await writeFile(configPath, JSON.stringify(configData, null, 2), 'utf8');
}

/**
 * Create default text formats
 */
async function createDefaultFormats(): Promise<void> {
  // Plain text format
  formats.plain_text = {
    label: 'Plain text',
    weight: 10,
    filters: {
      filter_plain: { weight: 0, status: true },
      filter_autop: { weight: 10, status: true },
      filter_url: { weight: 20, status: true, settings: { length: 72 } },
    },
    roles: ['anonymous', 'authenticated'],
  };

  // Basic HTML format
  formats.basic_html = {
    label: 'Basic HTML',
    weight: 0,
    filters: {
      filter_html: {
        weight: 0,
        status: true,
        settings: {
          allowed_tags: '<p><br><strong><em><a><ul><ol><li><h2><h3><blockquote>',
        },
      },
      filter_autop: { weight: 10, status: true },
      filter_url: { weight: 20, status: true, settings: { length: 72 } },
      filter_htmlcorrector: { weight: 100, status: true },
    },
    roles: ['authenticated'],
  };

  // Full HTML format
  formats.full_html = {
    label: 'Full HTML',
    weight: -10,
    filters: {
      filter_url: { weight: 20, status: true, settings: { length: 72 } },
      filter_htmlcorrector: { weight: 100, status: true },
    },
    roles: ['admin'],
  };

  defaultFormatId = 'plain_text';

  await saveFormats();
}

/**
 * Get all text formats
 *
 * @returns All registered formats
 */
export function getFormats(): Record<string, TextFormat> {
  return { ...formats };
}

/**
 * Get a specific text format
 *
 * @param id - Format identifier
 * @returns Format config or null if not found
 */
export function getFormat(id: string): TextFormat | null {
  return formats[id] ? { ...formats[id] } : null;
}

/**
 * Create a new text format
 *
 * @param id - Format identifier
 * @param config - Format configuration
 */
export async function createFormat(id: string, config: TextFormatConfig): Promise<void> {
  if (formats[id]) {
    throw new Error(`Format "${id}" already exists`);
  }

  formats[id] = {
    label: config.label,
    weight: config.weight || 0,
    filters: config.filters || {},
    roles: config.roles || ['authenticated'],
  };

  await saveFormats();

  // Trigger hook
  await hooks.trigger('format:created', { id, format: formats[id] });
}

/**
 * Update an existing text format
 *
 * @param id - Format identifier
 * @param config - Updated configuration
 */
export async function updateFormat(id: string, config: Partial<TextFormat>): Promise<void> {
  if (!formats[id]) {
    throw new Error(`Format "${id}" not found`);
  }

  formats[id] = {
    ...formats[id],
    ...config,
  };

  await saveFormats();

  // Clear cache for this format
  if (cache) {
    cache.clear(`text-format:${id}:*`);
  }

  // Trigger hook
  await hooks.trigger('format:updated', { id, format: formats[id] });
}

/**
 * Delete a text format
 *
 * @param id - Format identifier
 */
export async function deleteFormat(id: string): Promise<void> {
  if (!formats[id]) {
    throw new Error(`Format "${id}" not found`);
  }

  if (id === defaultFormatId) {
    throw new Error('Cannot delete default format');
  }

  delete formats[id];

  await saveFormats();

  // Clear cache
  if (cache) {
    cache.clear(`text-format:${id}:*`);
  }

  // Trigger hook
  await hooks.trigger('format:deleted', { id });
}

// ===========================================
// Text Processing
// ===========================================

/**
 * Process text through a filter chain
 *
 * @param text - Input text
 * @param formatId - Format identifier
 * @returns Processed text
 */
export async function processText(text: string, formatId: string): Promise<string> {
  const format = formats[formatId];

  if (!format) {
    throw new Error(`Format "${formatId}" not found`);
  }

  // Check cache
  if (cache) {
    const cacheKey = `text-format:${formatId}:${hashText(text)}`;
    const cached = cache.get(cacheKey);

    if (typeof cached === 'string') {
      return cached;
    }
  }

  // Sort filters by weight
  const filterChain = Object.entries(format.filters)
    .filter(([_, filterConfig]) => filterConfig.status)
    .sort((a, b) => a[1].weight - b[1].weight);

  // Apply filters in sequence
  let result = text;

  for (const [filterName, filterConfig] of filterChain) {
    const settings: FilterSettings = { ...filters[filterName]?.defaults, ...filterConfig.settings };
    result = await processFilter(result, filterName, settings);
  }

  // Trigger hook for post-processing
  const context: { text: string; formatId: string } = { text: result, formatId };
  await hooks.trigger('filter:process', context);
  result = context.text;

  // Cache result
  if (cache) {
    const cacheKey = `text-format:${formatId}:${hashText(text)}`;
    cache.set(cacheKey, result, 3600); // Cache for 1 hour
  }

  return result;
}

/**
 * Process text through a single filter
 *
 * @param text - Input text
 * @param filterName - Filter identifier
 * @param settings - Filter settings
 * @returns Processed text
 */
export async function processFilter(text: string, filterName: string, settings: FilterSettings = {}): Promise<string> {
  const filter = filters[filterName];

  if (!filter) {
    console.warn(`[text-formats] Unknown filter: ${filterName}`);
    return text;
  }

  try {
    const mergedSettings: FilterSettings = { ...filter.defaults, ...settings };
    return filter.process(text, mergedSettings);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[text-formats] Error in filter "${filterName}":`, message);
    return text; // Return original text on error
  }
}

// ===========================================
// User Access Control
// ===========================================

/**
 * Get text formats available to a user
 *
 * @param user - User object with roles
 * @returns Formats accessible to user
 */
export function getFormatsForUser(user: TextFormatUser | null): Record<string, TextFormat> {
  const userRoles = user?.roles || ['anonymous'];

  const available: Record<string, TextFormat> = {};

  for (const [id, format] of Object.entries(formats)) {
    // Check if user has any of the required roles
    const hasAccess = format.roles.some(role => userRoles.includes(role));

    if (hasAccess) {
      available[id] = format;
    }
  }

  return available;
}

/**
 * Get default format for a user
 *
 * @param user - User object with roles
 * @returns Default format ID for user
 */
export function getDefaultFormat(user: TextFormatUser | null): string {
  const available = getFormatsForUser(user);

  // Use system default if user has access
  if (available[defaultFormatId]) {
    return defaultFormatId;
  }

  // Otherwise return first available format
  const formatIds = Object.keys(available).sort((a, b) => {
    return (available[a]?.weight ?? 0) - (available[b]?.weight ?? 0);
  });

  return formatIds[0] || 'plain_text';
}

/**
 * Set the system default format
 *
 * @param formatId - Format identifier
 */
export async function setDefaultFormat(formatId: string): Promise<void> {
  if (!formats[formatId]) {
    throw new Error(`Format "${formatId}" not found`);
  }

  defaultFormatId = formatId;
  await saveFormats();
}

// ===========================================
// Utilities
// ===========================================

/**
 * Generate a simple hash of text for cache keys
 *
 * @param text - Text to hash
 * @returns Hash string
 */
function hashText(text: string): string {
  let hash = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  return Math.abs(hash).toString(36);
}

// ===========================================
// Exports
// ===========================================

export default {
  init,
  registerFilter,
  getFormats,
  getFormat,
  createFormat,
  updateFormat,
  deleteFormat,
  processText,
  processFilter,
  getFormatsForUser,
  getDefaultFormat,
  setDefaultFormat,
};
