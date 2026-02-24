/**
 * responsive-images.ts - Responsive Image Generation System
 *
 * WHY THIS EXISTS:
 * =================
 * Modern web requires responsive images for:
 * - Performance (load appropriate size for device)
 * - Art direction (different crops for different viewports)
 * - Bandwidth savings (smaller images for smaller screens)
 *
 * This module provides:
 * - Responsive image style definitions
 * - Picture element generation
 * - srcset/sizes generation
 * - Breakpoint-based art direction
 * - Lazy loading integration
 * - WebP/AVIF format support
 *
 * CORE CONCEPTS:
 * ==============
 * 1. BREAKPOINTS: Named viewport widths (mobile, tablet, desktop)
 * 2. RESPONSIVE STYLES: Image style per breakpoint
 * 3. SRCSET: Multiple sizes of same image
 * 4. PICTURE: Art direction with different images per breakpoint
 *
 * INTEGRATION:
 * ============
 * - image-styles.ts: Generates image derivatives
 * - media-library.ts: Source images
 * - template.ts: Rendering helpers
 *
 * STORAGE:
 * ========
 * /config
 *   /responsive-images.json   <- Responsive style definitions
 *   /breakpoints.json         <- Breakpoint definitions
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ============================================
// Types
// ============================================

/** Breakpoint definition for responsive images */
export interface BreakpointDefinition {
  id: string;
  label: string;
  minWidth: number | null;
  maxWidth: number | null;
  weight: number;
  mediaQuery: string;
  source: string;
}

/** Responsive image style definition */
export interface ResponsiveStyleDefinition {
  id: string;
  label: string;
  description?: string;
  source: string;
  mappings: Record<string, string>;
  fallbackStyle: string;
  lazyLoad: boolean;
  sizes: string[];
  created?: string;
  updated?: string;
}

/** Configuration for responsive images */
export interface ResponsiveImagesConfig {
  enabled: boolean;
  defaultLazyLoad: boolean;
  defaultFallbackStyle: string;
  enableWebP: boolean;
  enableAVIF: boolean;
  placeholderType: string;
}

/** Initialization options */
export interface ResponsiveImagesInitOptions {
  baseDir?: string;
  imageStyles?: ImageStylesService;
  hooks?: HooksService;
  config?: Partial<ResponsiveImagesConfig>;
}

/** Options for generating responsive img tags */
export interface ResponsiveImgOptions {
  alt?: string;
  class?: string;
  width?: number;
  height?: number;
  lazyLoad?: boolean;
  artDirection?: boolean;
  caption?: string;
}

// Service interfaces
interface ImageStylesService {
  getUrl: (imagePath: string, styleName: string) => string;
  getStyle: (styleName: string) => { width?: number; maxWidth?: number; [key: string]: unknown } | null;
}

interface HooksService {
  trigger: (event: string, context: Record<string, unknown>) => Promise<void>;
}

// ============================================
// MODULE STATE
// ============================================

let baseDir: string | null = null;
let imageStylesService: ImageStylesService | null = null;
let hooksService: HooksService | null = null;

/**
 * Breakpoint definitions
 * Structure: { breakpointId: BreakpointDefinition, ... }
 */
const breakpoints: Record<string, BreakpointDefinition> = {};

/**
 * Responsive image style definitions
 * Structure: { styleId: ResponsiveStyleDefinition, ... }
 */
const responsiveStyles: Record<string, ResponsiveStyleDefinition> = {};

/**
 * Configuration
 */
let config: ResponsiveImagesConfig = {
  enabled: true,
  defaultLazyLoad: true,
  defaultFallbackStyle: 'large',
  enableWebP: true,
  enableAVIF: false,
  placeholderType: 'blur', // blur, color, lqip
};

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize the responsive images system
 *
 * @param options - Initialization options
 */
export function init(options: ResponsiveImagesInitOptions = {}): void {
  baseDir = options.baseDir ?? null;
  imageStylesService = options.imageStyles ?? null;
  hooksService = options.hooks ?? null;

  if (options.config) {
    config = { ...config, ...options.config };
  }

  // Ensure config directory exists
  if (baseDir) {
    const configDir = join(baseDir, 'config');
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
  }

  // Register built-in breakpoints
  registerBuiltinBreakpoints();

  // Load custom breakpoints
  loadBreakpoints();

  // Register built-in responsive styles
  registerBuiltinStyles();

  // Load custom responsive styles
  loadResponsiveStyles();

  console.log(`[responsive-images] Initialized (${Object.keys(breakpoints).length} breakpoints, ${Object.keys(responsiveStyles).length} styles)`);
}

/**
 * Load breakpoints from config
 */
function loadBreakpoints(): void {
  if (!baseDir) return;
  const bpPath = join(baseDir, 'config', 'breakpoints.json');

  if (existsSync(bpPath)) {
    try {
      const data = JSON.parse(readFileSync(bpPath, 'utf-8')) as Record<string, BreakpointDefinition>;
      Object.assign(breakpoints, data);
    } catch (e: unknown) {
      console.error('[responsive-images] Failed to load breakpoints:', e instanceof Error ? e.message : String(e));
    }
  }
}

/**
 * Save breakpoints to disk
 */
function saveBreakpoints(): void {
  if (!baseDir) return;
  const bpPath = join(baseDir, 'config', 'breakpoints.json');

  // Only save custom breakpoints
  const custom: Record<string, BreakpointDefinition> = {};
  for (const [id, bp] of Object.entries(breakpoints)) {
    if (bp.source !== 'builtin') {
      custom[id] = bp;
    }
  }

  writeFileSync(bpPath, JSON.stringify(custom, null, 2) + '\n');
}

/**
 * Load responsive styles from config
 */
function loadResponsiveStyles(): void {
  if (!baseDir) return;
  const stylePath = join(baseDir, 'config', 'responsive-images.json');

  if (existsSync(stylePath)) {
    try {
      const data = JSON.parse(readFileSync(stylePath, 'utf-8')) as Record<string, ResponsiveStyleDefinition>;
      Object.assign(responsiveStyles, data);
    } catch (e: unknown) {
      console.error('[responsive-images] Failed to load responsive styles:', e instanceof Error ? e.message : String(e));
    }
  }
}

/**
 * Save responsive styles to disk
 */
function saveResponsiveStyles(): void {
  if (!baseDir) return;
  const stylePath = join(baseDir, 'config', 'responsive-images.json');

  // Only save custom styles
  const custom: Record<string, ResponsiveStyleDefinition> = {};
  for (const [id, style] of Object.entries(responsiveStyles)) {
    if (style.source !== 'builtin') {
      custom[id] = style;
    }
  }

  writeFileSync(stylePath, JSON.stringify(custom, null, 2) + '\n');
}

// ============================================
// BUILT-IN BREAKPOINTS
// ============================================

/**
 * Register built-in breakpoints
 */
function registerBuiltinBreakpoints(): void {
  breakpoints['mobile'] = {
    id: 'mobile',
    label: 'Mobile',
    minWidth: 0,
    maxWidth: 575,
    weight: 0,
    mediaQuery: '(max-width: 575px)',
    source: 'builtin',
  };

  breakpoints['tablet'] = {
    id: 'tablet',
    label: 'Tablet',
    minWidth: 576,
    maxWidth: 991,
    weight: 1,
    mediaQuery: '(min-width: 576px) and (max-width: 991px)',
    source: 'builtin',
  };

  breakpoints['desktop'] = {
    id: 'desktop',
    label: 'Desktop',
    minWidth: 992,
    maxWidth: 1399,
    weight: 2,
    mediaQuery: '(min-width: 992px) and (max-width: 1399px)',
    source: 'builtin',
  };

  breakpoints['wide'] = {
    id: 'wide',
    label: 'Wide',
    minWidth: 1400,
    maxWidth: null,
    weight: 3,
    mediaQuery: '(min-width: 1400px)',
    source: 'builtin',
  };

  // Retina / HiDPI
  breakpoints['retina'] = {
    id: 'retina',
    label: 'Retina',
    minWidth: null,
    maxWidth: null,
    weight: 10,
    mediaQuery: '(-webkit-min-device-pixel-ratio: 2), (min-resolution: 192dpi)',
    source: 'builtin',
  };
}

// ============================================
// BUILT-IN RESPONSIVE STYLES
// ============================================

/**
 * Register built-in responsive styles
 */
function registerBuiltinStyles(): void {
  // Full-width hero images
  responsiveStyles['hero'] = {
    id: 'hero',
    label: 'Hero Image',
    description: 'Full-width hero/banner images',
    source: 'builtin',
    mappings: {
      mobile: 'hero_mobile',    // 576x324
      tablet: 'hero_tablet',    // 992x558
      desktop: 'hero_desktop',  // 1400x600
      wide: 'hero_wide',        // 1920x600
    },
    fallbackStyle: 'hero_desktop',
    lazyLoad: false, // Heroes are typically above the fold
    sizes: ['100vw'],
  };

  // Content images
  responsiveStyles['content'] = {
    id: 'content',
    label: 'Content Image',
    description: 'Images within article content',
    source: 'builtin',
    mappings: {
      mobile: 'medium',
      tablet: 'large',
      desktop: 'large',
      wide: 'xlarge',
    },
    fallbackStyle: 'large',
    lazyLoad: true,
    sizes: [
      '(max-width: 575px) 100vw',
      '(max-width: 991px) 80vw',
      '800px',
    ],
  };

  // Thumbnail grids
  responsiveStyles['thumbnail'] = {
    id: 'thumbnail',
    label: 'Thumbnail',
    description: 'Grid thumbnails and teasers',
    source: 'builtin',
    mappings: {
      mobile: 'thumbnail_small',
      tablet: 'thumbnail',
      desktop: 'thumbnail',
      wide: 'thumbnail_large',
    },
    fallbackStyle: 'thumbnail',
    lazyLoad: true,
    sizes: [
      '(max-width: 575px) 50vw',
      '(max-width: 991px) 33vw',
      '280px',
    ],
  };

  // Card images
  responsiveStyles['card'] = {
    id: 'card',
    label: 'Card Image',
    description: 'Images for cards and teasers',
    source: 'builtin',
    mappings: {
      mobile: 'card_mobile',
      tablet: 'card',
      desktop: 'card',
      wide: 'card_large',
    },
    fallbackStyle: 'card',
    lazyLoad: true,
    sizes: [
      '(max-width: 575px) 100vw',
      '(max-width: 991px) 50vw',
      '400px',
    ],
  };

  // Profile/avatar images
  responsiveStyles['avatar'] = {
    id: 'avatar',
    label: 'Avatar',
    description: 'Profile and avatar images',
    source: 'builtin',
    mappings: {
      mobile: 'avatar_small',
      tablet: 'avatar',
      desktop: 'avatar',
      wide: 'avatar',
    },
    fallbackStyle: 'avatar',
    lazyLoad: true,
    sizes: ['100px'],
  };
}

// ============================================
// BREAKPOINT MANAGEMENT
// ============================================

/**
 * Register a custom breakpoint
 *
 * @param breakpoint - Breakpoint definition
 * @returns Registered breakpoint
 */
export function registerBreakpoint(breakpoint: Partial<BreakpointDefinition> & { id: string }): BreakpointDefinition {
  if (!breakpoint.id) {
    throw new Error('Breakpoint ID is required');
  }

  // Build media query if not provided
  let mediaQuery = breakpoint.mediaQuery;
  if (!mediaQuery) {
    const conditions: string[] = [];
    if (breakpoint.minWidth != null) {
      conditions.push(`(min-width: ${breakpoint.minWidth}px)`);
    }
    if (breakpoint.maxWidth != null) {
      conditions.push(`(max-width: ${breakpoint.maxWidth}px)`);
    }
    mediaQuery = conditions.join(' and ') || 'all';
  }

  breakpoints[breakpoint.id] = {
    id: breakpoint.id,
    label: breakpoint.label || breakpoint.id,
    minWidth: breakpoint.minWidth ?? null,
    maxWidth: breakpoint.maxWidth ?? null,
    weight: breakpoint.weight ?? 0,
    mediaQuery,
    source: 'custom',
  };

  saveBreakpoints();
  return breakpoints[breakpoint.id]!;
}

/**
 * Get a breakpoint definition
 *
 * @param id - Breakpoint ID
 * @returns Breakpoint definition or null
 */
export function getBreakpoint(id: string): BreakpointDefinition | null {
  return breakpoints[id] ?? null;
}

/**
 * List all breakpoints
 *
 * @returns Array of breakpoint definitions, sorted by weight
 */
export function listBreakpoints(): BreakpointDefinition[] {
  return Object.values(breakpoints).sort((a, b) => a.weight - b.weight);
}

// ============================================
// RESPONSIVE STYLE MANAGEMENT
// ============================================

/**
 * Register a responsive image style
 *
 * @param style - Style definition
 * @returns Registered style
 */
export async function registerResponsiveStyle(style: Partial<ResponsiveStyleDefinition> & { id: string; mappings: Record<string, string> }): Promise<ResponsiveStyleDefinition> {
  if (!style.id) {
    throw new Error('Responsive style ID is required');
  }

  if (!style.mappings || Object.keys(style.mappings).length === 0) {
    throw new Error('Responsive style must have breakpoint mappings');
  }

  // Validate breakpoints exist
  for (const breakpointId of Object.keys(style.mappings)) {
    if (!breakpoints[breakpointId]) {
      throw new Error(`Unknown breakpoint: ${breakpointId}`);
    }
  }

  // Fire hook
  if (hooksService) {
    await hooksService.trigger('responsive:beforeRegister', { style });
  }

  responsiveStyles[style.id] = {
    id: style.id,
    label: style.label || style.id,
    description: style.description || '',
    source: 'custom',
    mappings: style.mappings,
    fallbackStyle: style.fallbackStyle || config.defaultFallbackStyle,
    lazyLoad: style.lazyLoad ?? config.defaultLazyLoad,
    sizes: style.sizes || [],
    created: new Date().toISOString(),
  };

  saveResponsiveStyles();

  // Fire hook
  if (hooksService) {
    await hooksService.trigger('responsive:afterRegister', { style: responsiveStyles[style.id] });
  }

  return responsiveStyles[style.id]!;
}

/**
 * Get a responsive style definition
 *
 * @param id - Style ID
 * @returns Style definition or null
 */
export function getResponsiveStyle(id: string): ResponsiveStyleDefinition | null {
  return responsiveStyles[id] ?? null;
}

/**
 * List all responsive styles
 *
 * @returns Array of style definitions
 */
export function listResponsiveStyles(): ResponsiveStyleDefinition[] {
  return Object.values(responsiveStyles);
}

/**
 * Update a responsive style
 *
 * @param id - Style ID
 * @param updates - Updates to apply
 * @returns Updated style
 */
export async function updateResponsiveStyle(id: string, updates: Partial<ResponsiveStyleDefinition>): Promise<ResponsiveStyleDefinition> {
  const style = responsiveStyles[id];
  if (!style) {
    throw new Error(`Responsive style "${id}" not found`);
  }

  if (style.source === 'builtin') {
    throw new Error(`Cannot modify built-in responsive style: ${id}`);
  }

  // Fire hook
  if (hooksService) {
    await hooksService.trigger('responsive:beforeUpdate', { style, updates });
  }

  Object.assign(style, updates, { updated: new Date().toISOString() });
  saveResponsiveStyles();

  // Fire hook
  if (hooksService) {
    await hooksService.trigger('responsive:afterUpdate', { style });
  }

  return style;
}

/**
 * Delete a responsive style
 *
 * @param id - Style ID
 * @returns True if deleted
 */
export async function deleteResponsiveStyle(id: string): Promise<boolean> {
  const style = responsiveStyles[id];
  if (!style) {
    throw new Error(`Responsive style "${id}" not found`);
  }

  if (style.source === 'builtin') {
    throw new Error(`Cannot delete built-in responsive style: ${id}`);
  }

  delete responsiveStyles[id];
  saveResponsiveStyles();

  return true;
}

// ============================================
// IMAGE GENERATION
// ============================================

/**
 * Generate srcset attribute for an image
 *
 * @param imagePath - Source image path
 * @param imageStyles - Image styles to include
 * @returns srcset attribute value
 */
export async function generateSrcset(imagePath: string, imageStyles: string[]): Promise<string> {
  if (!imageStylesService) {
    return '';
  }

  const srcsetParts: string[] = [];

  for (const styleName of imageStyles) {
    try {
      const url = imageStylesService.getUrl(imagePath, styleName);
      const styleInfo = imageStylesService.getStyle(styleName);

      if (url && styleInfo) {
        const width = styleInfo.width || styleInfo.maxWidth;
        if (width) {
          srcsetParts.push(`${url} ${width}w`);
        }
      }
    } catch (e: unknown) {
      console.warn(`[responsive-images] Failed to generate srcset for ${styleName}:`, e instanceof Error ? e.message : String(e));
    }
  }

  return srcsetParts.join(', ');
}

/**
 * Generate sizes attribute
 *
 * @param sizes - Size definitions
 * @returns Sizes attribute value
 */
export function generateSizes(sizes: string[]): string {
  if (!sizes || sizes.length === 0) {
    return '100vw';
  }
  return sizes.join(', ');
}

// ============================================
// HTML GENERATION
// ============================================

/**
 * Generate a responsive <img> tag with srcset
 *
 * @param imagePath - Source image path
 * @param responsiveStyleId - Responsive style to use
 * @param options - Additional options
 * @returns HTML img tag
 */
export async function generateImg(imagePath: string, responsiveStyleId: string, options: ResponsiveImgOptions = {}): Promise<string> {
  const style = getResponsiveStyle(responsiveStyleId);
  if (!style) {
    throw new Error(`Responsive style "${responsiveStyleId}" not found`);
  }

  // Get unique image styles from mappings
  const imageStyles = [...new Set(Object.values(style.mappings))];

  // Generate srcset
  const srcset = await generateSrcset(imagePath, imageStyles);

  // Generate sizes
  const sizes = generateSizes(style.sizes);

  // Get fallback URL
  const fallbackUrl = imageStylesService?.getUrl(imagePath, style.fallbackStyle) || imagePath;

  // Build attributes
  const attrs: string[] = [];
  attrs.push(`src="${escapeHtml(fallbackUrl)}"`);

  if (srcset) {
    attrs.push(`srcset="${escapeHtml(srcset)}"`);
    attrs.push(`sizes="${escapeHtml(sizes)}"`);
  }

  if (options.alt !== undefined) {
    attrs.push(`alt="${escapeHtml(options.alt)}"`);
  }

  if (options.class) {
    attrs.push(`class="${escapeHtml(options.class)}"`);
  }

  if (options.width) {
    attrs.push(`width="${options.width}"`);
  }

  if (options.height) {
    attrs.push(`height="${options.height}"`);
  }

  // Lazy loading
  const lazyLoad = options.lazyLoad ?? style.lazyLoad;
  if (lazyLoad) {
    attrs.push('loading="lazy"');
    attrs.push('decoding="async"');
  }

  return `<img ${attrs.join(' ')} />`;
}

/**
 * Generate a responsive <picture> tag for art direction
 *
 * @param imagePath - Source image path
 * @param responsiveStyleId - Responsive style to use
 * @param options - Additional options
 * @returns HTML picture tag
 */
export async function generatePicture(imagePath: string, responsiveStyleId: string, options: ResponsiveImgOptions = {}): Promise<string> {
  const style = getResponsiveStyle(responsiveStyleId);
  if (!style) {
    throw new Error(`Responsive style "${responsiveStyleId}" not found`);
  }

  const sources: string[] = [];
  const sortedBreakpoints = listBreakpoints().reverse(); // Largest first

  for (const bp of sortedBreakpoints) {
    const imageStyle = style.mappings[bp.id];
    if (!imageStyle) continue;

    const url = imageStylesService?.getUrl(imagePath, imageStyle);
    if (!url) continue;

    // Generate source for this breakpoint
    const sourceAttrs: string[] = [];
    sourceAttrs.push(`media="${bp.mediaQuery}"`);
    sourceAttrs.push(`srcset="${escapeHtml(url)}"`);

    // Add WebP source if enabled
    if (config.enableWebP) {
      const webpUrl = url.replace(/\.[^.]+$/, '.webp');
      sources.push(`<source media="${bp.mediaQuery}" srcset="${escapeHtml(webpUrl)}" type="image/webp" />`);
    }

    sources.push(`<source ${sourceAttrs.join(' ')} />`);
  }

  // Fallback img tag
  const fallbackUrl = imageStylesService?.getUrl(imagePath, style.fallbackStyle) || imagePath;

  const imgAttrs: string[] = [];
  imgAttrs.push(`src="${escapeHtml(fallbackUrl)}"`);

  if (options.alt !== undefined) {
    imgAttrs.push(`alt="${escapeHtml(options.alt)}"`);
  }

  if (options.class) {
    imgAttrs.push(`class="${escapeHtml(options.class)}"`);
  }

  const lazyLoad = options.lazyLoad ?? style.lazyLoad;
  if (lazyLoad) {
    imgAttrs.push('loading="lazy"');
    imgAttrs.push('decoding="async"');
  }

  return `<picture>
  ${sources.join('\n  ')}
  <img ${imgAttrs.join(' ')} />
</picture>`;
}

/**
 * Generate a responsive image with optional figure wrapper
 *
 * @param imagePath - Source image path
 * @param responsiveStyleId - Responsive style to use
 * @param options - Additional options
 * @returns HTML output
 */
export async function render(imagePath: string, responsiveStyleId: string, options: ResponsiveImgOptions = {}): Promise<string> {
  const usePicture = options.artDirection ?? false;

  let imgHtml: string;
  if (usePicture) {
    imgHtml = await generatePicture(imagePath, responsiveStyleId, options);
  } else {
    imgHtml = await generateImg(imagePath, responsiveStyleId, options);
  }

  // Wrap in figure if caption provided
  if (options.caption) {
    return `<figure class="responsive-image">
  ${imgHtml}
  <figcaption>${escapeHtml(options.caption)}</figcaption>
</figure>`;
  }

  return imgHtml;
}

// ============================================
// UTILITIES
// ============================================

/**
 * Escape HTML special characters
 *
 * @param str - String to escape
 * @returns Escaped string
 */
function escapeHtml(str: string): string {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Calculate aspect ratio padding for lazy loading
 *
 * @param width - Image width
 * @param height - Image height
 * @returns Padding percentage
 */
export function getAspectRatioPadding(width: number, height: number): number {
  if (!width || !height) return 56.25; // Default 16:9
  return (height / width) * 100;
}

// ============================================
// CONFIGURATION
// ============================================

/**
 * Get configuration
 *
 * @returns Current configuration copy
 */
export function getConfig(): ResponsiveImagesConfig {
  return { ...config };
}

/**
 * Check if responsive images are enabled
 *
 * @returns Whether responsive images are enabled
 */
export function isEnabled(): boolean {
  return config.enabled;
}
