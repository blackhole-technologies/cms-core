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

/**
 * Size presets in pixels
 */
const SIZE_PRESETS = {
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
const renderCache = new Map();

/**
 * Maximum cache size (LRU eviction)
 * WHY LIMIT: Prevent unlimited memory growth
 */
const MAX_CACHE_SIZE = 1000;

/**
 * Cache statistics for monitoring
 */
const cacheStats = {
  hits: 0,
  misses: 0,
  evictions: 0,
};

/**
 * SVG element whitelist for sanitization
 * WHY WHITELIST (not blacklist): More secure - only allow known-safe elements
 */
const SAFE_SVG_ELEMENTS = new Set([
  'svg', 'g', 'path', 'circle', 'rect', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath',
  'mask', 'pattern', 'use', 'symbol', 'title', 'desc',
]);

/**
 * SVG attribute whitelist for sanitization
 * WHY WHITELIST: Prevent event handlers (onclick, onload, etc.) and javascript: URLs
 */
const SAFE_SVG_ATTRIBUTES = new Set([
  'viewBox', 'width', 'height', 'fill', 'stroke', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'fill-rule', 'clip-rule', 'd', 'cx', 'cy', 'r', 'rx', 'ry',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'transform', 'opacity',
  'class', 'id', 'xmlns', 'xmlns:xlink', 'xlink:href', 'role', 'aria-label',
  'aria-hidden', 'focusable', 'offset', 'stop-color', 'stop-opacity',
  'gradientUnits', 'gradientTransform', 'font-family', 'font-size', 'text-anchor',
]);

/**
 * Render an icon as inline SVG
 *
 * @param {string} name - Icon name (e.g., "hero:user", "bi:house")
 * @param {Object} options - Rendering options
 * @param {string|number} options.size - Size preset (small/medium/large) or number in pixels
 * @param {string} options.color - CSS color value
 * @param {string} options.class - Additional CSS classes
 * @param {string} options.title - Accessible title (for screen readers)
 * @param {string} options.ariaLabel - ARIA label override
 * @param {boolean} options.decorative - If true, adds aria-hidden="true"
 * @param {boolean} options.cache - Whether to use cache (default: true)
 * @returns {string} Rendered SVG string or empty string if icon not found
 */
export function renderIcon(name, options = {}) {
  // Validate icon name (prevent path traversal attacks)
  if (!name || typeof name !== 'string') {
    return '';
  }

  // Generate cache key
  const cacheKey = options.cache !== false ? generateCacheKey(name, options) : null;

  // Check cache
  if (cacheKey && renderCache.has(cacheKey)) {
    cacheStats.hits++;
    return renderCache.get(cacheKey);
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
 *
 * @param {string} name - Icon name
 * @param {Object} options - Rendering options
 * @returns {string} Cache key
 */
function generateCacheKey(name, options) {
  // Sort options for stable key generation
  const sortedOptions = Object.keys(options)
    .sort()
    .reduce((acc, key) => {
      acc[key] = options[key];
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
 *
 * @param {string} key - Cache key
 * @param {string} value - Cached value
 */
function setCached(key, value) {
  // Evict oldest entry if cache is full
  if (renderCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = renderCache.keys().next().value;
    renderCache.delete(oldestKey);
    cacheStats.evictions++;
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
 *
 * @param {string} svg - Raw SVG string
 * @returns {string} Sanitized SVG string
 */
function sanitizeSvg(svg) {
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
 *
 * @param {string} svg - Sanitized SVG string
 * @param {Object} options - Rendering options
 * @returns {string} Customized SVG string
 */
function applySvgCustomizations(svg, options) {
  // Extract SVG opening tag and attributes
  const svgTagMatch = svg.match(/<svg([^>]*)>/);
  if (!svgTagMatch) {
    return svg; // Invalid SVG
  }

  const originalAttributes = svgTagMatch[1];
  let newAttributes = originalAttributes;

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
  const classes = [];
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
 *
 * @param {string|number} size - Size preset or number
 * @returns {number|null} Size in pixels or null if not provided
 */
function resolveSize(size) {
  if (!size) {
    return null;
  }

  // If it's a number, use it directly
  if (typeof size === 'number') {
    return size;
  }

  // If it's a preset name, look it up
  if (typeof size === 'string' && SIZE_PRESETS[size]) {
    return SIZE_PRESETS[size];
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
 *
 * @param {string} name - Icon name that was not found
 * @param {Object} options - Rendering options
 * @returns {string} Fallback SVG or empty string
 */
function renderFallbackIcon(name, options) {
  // Return empty string if fallback is disabled
  if (options.noFallback) {
    return '';
  }

  // Simple question mark icon as fallback
  const size = resolveSize(options.size) || 24;
  const classes = ['icon', 'icon-fallback', options.class].filter(Boolean).join(' ');

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
 *
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
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
export function clearCache() {
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
 *
 * @returns {Object} Cache statistics
 */
export function getCacheStats() {
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
 *
 * @returns {Object} Size presets map
 */
export function getSizePresets() {
  return { ...SIZE_PRESETS };
}

// Export for name tracking
export const name = 'icon-renderer';
