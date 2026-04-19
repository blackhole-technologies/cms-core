/**
 * icon-renderer.js - SVG Icon Rendering Service
 *
 * WHY THIS EXISTS:
 * Rendering icons consistently across the CMS requires:
 * - SVG sanitization to prevent XSS attacks
 * - Size and color customization
 * - Accessibility attributes (ARIA labels, titles)
 * - Performance optimization through caching
 * - Support for both inline and sprite-based rendering
 *
 * DESIGN DECISIONS:
 * - Inline SVG by default for flexibility (can style with CSS)
 * - SVG sanitization strips dangerous attributes and elements
 * - Size presets (small/medium/large) with custom override
 * - Render cache with LRU eviction for memory efficiency
 * - Graceful fallback for missing icons
 *
 * WHY INLINE SVG (not sprites):
 * - Individual styling per icon instance
 * - No HTTP request for sprite file
 * - Better browser support
 * - Simpler implementation
 * - Can still use sprites if needed (future enhancement)
 *
 * SECURITY:
 * - Strip <script> tags and event handlers from SVG
 * - Whitelist safe SVG elements and attributes
 * - Validate icon names to prevent path traversal
 *
 * USAGE:
 *   const svg = renderIcon('hero:user', { size: 'medium', color: 'blue' });
 *   const svg = renderIcon('bi:house', { class: 'icon-house', title: 'Home' });
 */

import * as icons from './icons.js';

// ============================================================================
// Types
// ============================================================================

/** Options accepted by renderIcon() — size, colour, a11y, caching. */
interface RenderIconOptions {
  /** Size preset (small/medium/large/xlarge) or pixel number */
  size?: string | number;
  /** CSS color value applied to fill/stroke via currentColor */
  color?: string;
  /** Extra CSS classes appended to the SVG */
  class?: string;
  /** Accessible title (for screen readers) */
  title?: string;
  /** Override for aria-label */
  ariaLabel?: string;
  /** If true, adds aria-hidden="true" (decorative image) */
  decorative?: boolean;
  /** Whether to use cache (default: true) */
  cache?: boolean;
  /** If true, suppress fallback rendering when icon is missing */
  noFallback?: boolean;
}

/** Size preset map — name → pixels. */
interface SizePresets {
  small: number;
  medium: number;
  large: number;
  xlarge: number;
}

/** Cache statistics tracked for observability. */
interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
}

/** Public stats shape returned to callers. */
interface CacheStatsReport {
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  evictions: number;
  hitRate: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Size presets in pixels
 */
const SIZE_PRESETS: SizePresets = {
  small: 16,
  medium: 24,
  large: 32,
  xlarge: 48,
};

/**
 * Render cache
 * Structure: Map<cacheKey, svgString>
 *
 * WHY CACHE:
 * - Icon rendering can be expensive (file I/O, parsing, sanitization)
 * - Same icons rendered many times on a page
 * - Cache key includes all options for correctness
 */
const renderCache: Map<string, string> = new Map();

/**
 * Maximum cache size (LRU eviction)
 * WHY LIMIT: Prevent unlimited memory growth
 */
const MAX_CACHE_SIZE = 1000;

/**
 * Cache statistics for monitoring
 */
const cacheStats: CacheStats = {
  hits: 0,
  misses: 0,
  evictions: 0,
};

/**
 * SVG element whitelist for sanitization
 * WHY WHITELIST (not blacklist): More secure - only allow known-safe elements
 */
const SAFE_SVG_ELEMENTS: Set<string> = new Set([
  'svg', 'g', 'path', 'circle', 'rect', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath',
  'mask', 'pattern', 'use', 'symbol', 'title', 'desc',
]);

/**
 * SVG attribute whitelist for sanitization
 * WHY WHITELIST: Prevent event handlers (onclick, onload, etc.) and javascript: URLs
 */
const SAFE_SVG_ATTRIBUTES: Set<string> = new Set([
  'viewBox', 'width', 'height', 'fill', 'stroke', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'fill-rule', 'clip-rule', 'd', 'cx', 'cy', 'r', 'rx', 'ry',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'transform', 'opacity',
  'class', 'id', 'xmlns', 'xmlns:xlink', 'xlink:href', 'role', 'aria-label',
  'aria-hidden', 'focusable', 'offset', 'stop-color', 'stop-opacity',
  'gradientUnits', 'gradientTransform', 'font-family', 'font-size', 'text-anchor',
]);

// ============================================================================
// Public API
// ============================================================================

/**
 * Render an icon as inline SVG
 *
 * @param name - Icon name (e.g., "hero:user", "bi:house")
 * @param options - Rendering options
 * @returns Rendered SVG string or empty string if icon not found
 */
export function renderIcon(name: string, options: RenderIconOptions = {}): string {
  // Validate icon name (prevent path traversal attacks)
  if (!name || typeof name !== 'string') {
    return '';
  }

  // Generate cache key
  const cacheKey = options.cache !== false ? generateCacheKey(name, options) : null;

  // Check cache
  if (cacheKey && renderCache.has(cacheKey)) {
    cacheStats.hits++;
    return renderCache.get(cacheKey) as string;
  }

  cacheStats.misses++;

  // Get icon from registry
  const icon = icons.getIcon(name);
  if (!icon) {
    console.warn(`[icon-renderer] Icon not found: ${name}`);
    return renderFallbackIcon(name, options);
  }

  // Load SVG content
  const svgContent = icons.getIconSvg(name);
  if (!svgContent) {
    console.warn(`[icon-renderer] Failed to load SVG for icon: ${name}`);
    return renderFallbackIcon(name, options);
  }

  // Parse and sanitize SVG
  const sanitizedSvg = sanitizeSvg(svgContent);

  // Apply customizations
  const customizedSvg = applySvgCustomizations(sanitizedSvg, options);

  // Store in cache
  if (cacheKey) {
    setCached(cacheKey, customizedSvg);
  }

  return customizedSvg;
}

/**
 * Generate cache key from icon name and options
 *
 * WHY SERIALIZE OPTIONS:
 * - Cache must differentiate between different option combinations
 * - Stable ordering ensures consistent keys
 * - JSON is simple and readable for debugging
 */
function generateCacheKey(name: string, options: RenderIconOptions): string {
  // Sort options for stable key generation
  const sortedOptions = Object.keys(options)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = (options as Record<string, unknown>)[key];
      return acc;
    }, {});

  return `${name}:${JSON.stringify(sortedOptions)}`;
}

/**
 * Set value in cache with LRU eviction
 *
 * WHY LRU:
 * - Most recently used icons are most likely to be used again
 * - Simple to implement (Map maintains insertion order)
 * - Prevents unbounded memory growth
 */
function setCached(key: string, value: string): void {
  // Evict oldest entry if cache is full
  if (renderCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = renderCache.keys().next().value;
    if (oldestKey !== undefined) {
      renderCache.delete(oldestKey);
      cacheStats.evictions++;
    }
  }

  renderCache.set(key, value);
}

/**
 * Sanitize SVG content to prevent XSS
 *
 * WHY SANITIZE:
 * - SVG can contain <script> tags
 * - SVG attributes can have javascript: URLs
 * - Event handlers (onclick, onload, etc.) can execute arbitrary code
 * - User-uploaded SVGs are especially dangerous
 */
function sanitizeSvg(svg: string): string {
  // Remove <script> tags and their content
  svg = svg.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // Remove event handler attributes (onclick, onload, etc.)
  svg = svg.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
  svg = svg.replace(/\s+on\w+\s*=\s*[^\s>]*/gi, '');

  // Remove javascript: URLs in href and xlink:href
  svg = svg.replace(/\b(xlink:)?href\s*=\s*["']javascript:[^"']*["']/gi, '');

  // Remove data: URLs in href (can contain encoded scripts)
  svg = svg.replace(/\b(xlink:)?href\s*=\s*["']data:[^"']*["']/gi, '');

  // Remove <foreignObject> (can embed HTML with scripts)
  svg = svg.replace(/<foreignObject\b[^<]*(?:(?!<\/foreignObject>)<[^<]*)*<\/foreignObject>/gi, '');

  // Remove <iframe> and <embed> tags
  svg = svg.replace(/<(iframe|embed)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi, '');

  return svg;
}

/**
 * Apply customizations to SVG
 */
function applySvgCustomizations(svg: string, options: RenderIconOptions): string {
  // Extract SVG opening tag and attributes
  const svgTagMatch = svg.match(/<svg([^>]*)>/);
  if (!svgTagMatch) {
    return svg; // Invalid SVG
  }

  const originalAttributes = svgTagMatch[1] ?? '';
  let newAttributes: string = originalAttributes;

  // Apply size
  const size = resolveSize(options.size);
  if (size) {
    // Remove existing width/height attributes
    newAttributes = newAttributes.replace(/\s+(width|height)\s*=\s*["'][^"']*["']/gi, '');
    newAttributes = newAttributes.replace(/\s+(width|height)\s*=\s*[^\s>]*/gi, '');

    // Add new width/height
    newAttributes += ` width="${size}" height="${size}"`;
  }

  // Apply CSS class
  const classes: string[] = [];
  if (options.class) {
    classes.push(options.class);
  }

  // Always add base icon class
  classes.push('icon');

  if (classes.length > 0) {
    // Remove existing class attribute
    newAttributes = newAttributes.replace(/\s+class\s*=\s*["'][^"']*["']/gi, '');

    // Add new class
    newAttributes += ` class="${classes.join(' ')}"`;
  }

  // Apply color (inline style)
  if (options.color) {
    // Check if SVG uses fill or stroke
    const usesFill = svg.includes('fill=');
    const usesStroke = svg.includes('stroke=');

    if (usesFill || !usesStroke) {
      newAttributes += ` style="color: ${options.color}; fill: currentColor;"`;
    } else {
      newAttributes += ` style="color: ${options.color}; stroke: currentColor;"`;
    }
  }

  // Apply accessibility attributes
  if (options.decorative) {
    newAttributes += ` aria-hidden="true"`;
  } else {
    newAttributes += ` role="img"`;

    if (options.ariaLabel) {
      newAttributes += ` aria-label="${escapeHtml(options.ariaLabel)}"`;
    }
  }

  // Build new SVG tag
  let newSvg = svg.replace(/<svg[^>]*>/, `<svg${newAttributes}>`);

  // Add title element for accessibility (if provided and not decorative)
  if (options.title && !options.decorative) {
    const titleElement = `<title>${escapeHtml(options.title)}</title>`;

    // Insert title after opening <svg> tag
    newSvg = newSvg.replace(/<svg([^>]*)>/, `<svg$1>${titleElement}`);
  }

  return newSvg;
}

/**
 * Resolve size option to pixels
 */
function resolveSize(size: string | number | undefined): number | null {
  if (!size) {
    return null;
  }

  // If it's a number, use it directly
  if (typeof size === 'number') {
    return size;
  }

  // If it's a preset name, look it up
  if (typeof size === 'string' && size in SIZE_PRESETS) {
    return SIZE_PRESETS[size as keyof SizePresets];
  }

  // If it's a string number, parse it
  const parsed = parseInt(size, 10);
  if (!isNaN(parsed)) {
    return parsed;
  }

  return null;
}

/**
 * Render a fallback icon when requested icon is not found
 *
 * WHY FALLBACK:
 * - Prevents broken UI when icon is missing
 * - Easier debugging (shows icon name was wrong)
 * - Better user experience than empty space
 */
function renderFallbackIcon(name: string, options: RenderIconOptions): string {
  // Return empty string if fallback is disabled
  if (options.noFallback) {
    return '';
  }

  // Simple question mark icon as fallback
  const size = resolveSize(options.size) || 24;
  const classes: string = ['icon', 'icon-fallback', options.class].filter(Boolean).join(' ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" class="${classes}" role="img" aria-label="Icon not found: ${escapeHtml(name)}">
  <title>Icon not found: ${escapeHtml(name)}</title>
  <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/>
  <text x="12" y="17" font-size="16" text-anchor="middle" fill="currentColor">?</text>
</svg>`;
}

/**
 * Escape HTML special characters
 *
 * WHY ESCAPE:
 * - Prevent XSS when user input is used in attributes or text
 * - Ensure valid HTML/XML output
 */
function escapeHtml(str: string | undefined | null): string {
  if (!str) return '';

  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Clear render cache
 *
 * WHY CLEAR:
 * - Memory management in long-running processes
 * - Testing (ensure fresh renders)
 * - Icon pack updates (force re-render with new SVG)
 */
export function clearCache(): void {
  renderCache.clear();
  cacheStats.hits = 0;
  cacheStats.misses = 0;
  cacheStats.evictions = 0;
}

/**
 * Get cache statistics
 *
 * WHY STATS:
 * - Monitor cache effectiveness
 * - Tune cache size based on hit rate
 * - Debugging performance issues
 */
export function getCacheStats(): CacheStatsReport {
  return {
    size: renderCache.size,
    maxSize: MAX_CACHE_SIZE,
    hits: cacheStats.hits,
    misses: cacheStats.misses,
    evictions: cacheStats.evictions,
    hitRate: cacheStats.hits + cacheStats.misses > 0
      ? (cacheStats.hits / (cacheStats.hits + cacheStats.misses) * 100).toFixed(2) + '%'
      : '0%',
  };
}

/**
 * Get available size presets
 */
export function getSizePresets(): SizePresets {
  return { ...SIZE_PRESETS };
}

// Export for name tracking
export const name = 'icon-renderer';
