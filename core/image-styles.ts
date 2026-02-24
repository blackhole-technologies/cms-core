/**
 * image-styles.ts - Image Processing and Styles System
 *
 * WHY THIS EXISTS:
 * ================
 * CMSes need to generate multiple image versions (thumbnails, responsive sizes, etc.).
 * This module defines "styles" - named sets of transformations - and generates derivatives
 * on demand.
 *
 * ZERO DEPENDENCIES APPROACH:
 * ===========================
 * We don't bundle sharp, imagemagick, or other heavy image libs. Instead:
 * 1. Read image dimensions from file headers (PNG, JPEG, GIF, WebP)
 * 2. Shell out to ImageMagick/GraphicsMagick if available for actual processing
 * 3. Return original with metadata if no processing tools available
 *
 * WHY NOT SHARP:
 * - Sharp requires native bindings (platform-specific)
 * - Heavy dependency for a core module
 * - Many deployments already have ImageMagick installed
 * - Graceful degradation if tools not available
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { execSync } from 'node:child_process';
import * as hooks from './hooks.ts';

// ============================================================================
// Types
// ============================================================================

/** Image dimensions result */
interface ImageDimensions {
  width: number;
  height: number;
  format: string;
}

/** Image effect definition */
interface ImageEffect {
  type: 'scale' | 'crop' | 'rotate' | 'quality' | 'convert';
  width?: number;
  height?: number;
  upscale?: boolean;
  anchor?: string;
  angle?: number;
  value?: number;
  format?: string;
  quality?: number;
}

/** Breakpoint configuration for responsive styles */
interface BreakpointConfig {
  width: number;
  [key: string]: unknown;
}

/** Style configuration */
interface StyleConfig {
  label?: string;
  effects?: ImageEffect[];
  breakpoints?: Record<string, BreakpointConfig>;
  [key: string]: unknown;
}

/** Style list entry */
interface StyleListEntry {
  name: string;
  label: string;
}

/** Derivative result */
interface DerivativeResult {
  path: string;
  url: string;
  width: number;
  height: number;
}

/** Srcset result */
interface SrcsetResult {
  srcset: string;
  sizes: string;
  src: string | null;
}

/** Placeholder result */
interface PlaceholderResult {
  url: string | null;
  dataUri: string;
}

/** Anchor point coordinates */
interface AnchorPoint {
  x: number;
  y: number;
}

/** Media module interface */
interface MediaModule {
  getMediaDir(): string;
  getFilePath(mediaId: string): string;
  getMimeType(filePath: string): string;
}

/** Processing tool type */
type ProcessingToolType = 'sharp' | 'imagemagick' | 'graphicsmagick' | null;

// ============================================================================
// Configuration
// ============================================================================

let baseDir: string | null = null;
let mediaModule: MediaModule | null = null;
let stylesConfig: Record<string, StyleConfig> = {};
let derivativesDir: string | null = null;

// Cache for image dimensions
const dimensionsCache: Map<string, ImageDimensions> = new Map();

/**
 * Available image processing tools (detected at runtime)
 */
let processingTool: ProcessingToolType = null;

/**
 * Anchor points for cropping
 */
const ANCHOR_POINTS: Record<string, AnchorPoint> = {
  'center': { x: 0.5, y: 0.5 },
  'top-left': { x: 0, y: 0 },
  'top': { x: 0.5, y: 0 },
  'top-right': { x: 1, y: 0 },
  'left': { x: 0, y: 0.5 },
  'right': { x: 1, y: 0.5 },
  'bottom-left': { x: 0, y: 1 },
  'bottom': { x: 0.5, y: 1 },
  'bottom-right': { x: 1, y: 1 },
};

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize image styles system
 */
export function init(projectBaseDir: string, media: MediaModule): void {
  baseDir = projectBaseDir;
  mediaModule = media;

  // Setup derivatives directory
  derivativesDir = join(media.getMediaDir(), 'derivatives');
  if (!existsSync(derivativesDir)) {
    mkdirSync(derivativesDir, { recursive: true });
  }

  // Load styles configuration
  loadStylesConfig();

  // Detect available image processing tools
  detectProcessingTool();

  console.log(`[image-styles] Initialized with tool: ${processingTool ?? 'none (metadata-only mode)'}`);
}

/**
 * Load styles configuration from config/image-styles.json
 */
function loadStylesConfig(): void {
  const configPath = join(baseDir!, 'config', 'image-styles.json');

  if (existsSync(configPath)) {
    try {
      const data = readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(data) as Record<string, unknown>;
      stylesConfig = (parsed.styles as Record<string, StyleConfig>) ?? {};
      console.log(`[image-styles] Loaded ${Object.keys(stylesConfig).length} styles from config`);
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[image-styles] Failed to load config: ${errMsg}`);
      stylesConfig = {};
    }
  } else {
    console.warn(`[image-styles] No config found at ${configPath}`);
  }
}

/**
 * Detect available image processing tool
 * Priority: sharp (npm) > convert (ImageMagick) > gm (GraphicsMagick)
 */
function detectProcessingTool(): void {
  // Try Sharp first -- best quality and performance, installed via npm
  try {
    // Dynamic import check -- Sharp is an optional dependency
    const sharpPath = require.resolve('sharp');
    if (sharpPath) {
      processingTool = 'sharp';
      return;
    }
  } catch {
    // Sharp not installed
  }

  try {
    execSync('convert -version', { stdio: 'ignore' });
    processingTool = 'imagemagick';
    return;
  } catch {
    // ImageMagick not found
  }

  try {
    execSync('gm version', { stdio: 'ignore' });
    processingTool = 'graphicsmagick';
    return;
  } catch {
    // GraphicsMagick not found
  }

  processingTool = null;
}

// ============================================================================
// Style Management
// ============================================================================

/**
 * Define or update an image style
 */
export function defineStyle(name: string, config: StyleConfig): void {
  stylesConfig[name] = config;

  // Persist to config file
  saveStylesConfig();
}

/**
 * Get a style definition
 */
export function getStyle(name: string): StyleConfig | null {
  return stylesConfig[name] ?? null;
}

/**
 * List all defined styles
 */
export function listStyles(): StyleListEntry[] {
  return Object.entries(stylesConfig).map(([name, config]) => ({
    name,
    label: (config.label as string) ?? name,
  }));
}

/**
 * Save styles configuration to disk
 */
function saveStylesConfig(): void {
  const configPath = join(baseDir!, 'config', 'image-styles.json');
  const configObj = { styles: stylesConfig };

  try {
    writeFileSync(configPath, JSON.stringify(configObj, null, 2));
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[image-styles] Failed to save config: ${errMsg}`);
  }
}

// ============================================================================
// Image Dimension Reading
// ============================================================================

/**
 * Get image dimensions from file header
 * Supports: PNG, JPEG, GIF, WebP
 */
export function getImageDimensions(filePath: string): ImageDimensions | null {
  // Check cache first
  if (dimensionsCache.has(filePath)) {
    return dimensionsCache.get(filePath)!;
  }

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const buffer = readFileSync(filePath);
    const dimensions = readDimensionsFromBuffer(buffer);

    if (dimensions) {
      dimensionsCache.set(filePath, dimensions);
    }

    return dimensions;
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[image-styles] Failed to read dimensions from ${filePath}: ${errMsg}`);
    return null;
  }
}

/**
 * Read dimensions from image buffer
 * Implements basic header parsing for common formats
 */
function readDimensionsFromBuffer(buffer: Buffer): ImageDimensions | null {
  // PNG: Check signature and read IHDR chunk
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    // PNG signature: \x89PNG
    // IHDR chunk starts at byte 16 (after signature and chunk length/type)
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { width, height, format: 'png' };
  }

  // JPEG: Check for JFIF/Exif markers
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
    // JPEG signature: 0xFFD8
    return readJPEGDimensions(buffer);
  }

  // GIF: Check signature
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    // GIF signature: GIF
    const width = buffer.readUInt16LE(6);
    const height = buffer.readUInt16LE(8);
    return { width, height, format: 'gif' };
  }

  // WebP: Check signature
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
    // RIFF container
    if (buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
      // WebP signature
      return readWebPDimensions(buffer);
    }
  }

  return null;
}

/**
 * Read JPEG dimensions from buffer
 * Scans for SOF (Start Of Frame) markers
 */
function readJPEGDimensions(buffer: Buffer): ImageDimensions | null {
  let offset = 2; // Skip initial 0xFFD8

  while (offset < buffer.length) {
    // Find next marker
    if (buffer[offset] !== 0xFF) {
      offset++;
      continue;
    }

    const marker = buffer[offset + 1]!;

    // SOF markers (Start Of Frame)
    if ((marker >= 0xC0 && marker <= 0xC3) ||
        (marker >= 0xC5 && marker <= 0xC7) ||
        (marker >= 0xC9 && marker <= 0xCB) ||
        (marker >= 0xCD && marker <= 0xCF)) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return { width, height, format: 'jpeg' };
    }

    // Skip this segment
    const segmentLength = buffer.readUInt16BE(offset + 2);
    offset += segmentLength + 2;
  }

  return null;
}

/**
 * Read WebP dimensions from buffer
 */
function readWebPDimensions(buffer: Buffer): ImageDimensions | null {
  // VP8 (lossy)
  if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x20) {
    const width = buffer.readUInt16LE(26) & 0x3FFF;
    const height = buffer.readUInt16LE(28) & 0x3FFF;
    return { width, height, format: 'webp' };
  }

  // VP8L (lossless)
  if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x4C) {
    const bits = buffer.readUInt32LE(21);
    const width = ((bits & 0x3FFF) + 1);
    const height = (((bits >> 14) & 0x3FFF) + 1);
    return { width, height, format: 'webp' };
  }

  // VP8X (extended)
  if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x58) {
    const width = (buffer.readUIntLE(24, 3) + 1);
    const height = (buffer.readUIntLE(27, 3) + 1);
    return { width, height, format: 'webp' };
  }

  return null;
}

// ============================================================================
// Derivative Generation
// ============================================================================

/**
 * Get derivative image, generating if needed
 */
export async function getDerivative(mediaId: string, styleName: string): Promise<DerivativeResult> {
  const style = getStyle(styleName);
  if (!style) {
    throw new Error(`Unknown style: ${styleName}`);
  }

  const derivativePath = getDerivativePath(mediaId, styleName);

  // Generate if doesn't exist
  if (!existsSync(derivativePath)) {
    await generateDerivative(mediaId, styleName);
  }

  // Get dimensions
  const dimensions = getImageDimensions(derivativePath);

  return {
    path: derivativePath,
    url: `/media/derivatives/${styleName}/${mediaId}`,
    width: dimensions?.width ?? 0,
    height: dimensions?.height ?? 0,
  };
}

/**
 * Generate derivative image
 */
export async function generateDerivative(mediaId: string, styleName: string): Promise<string> {
  const style = getStyle(styleName);
  if (!style) {
    throw new Error(`Unknown style: ${styleName}`);
  }

  const sourcePath = mediaModule!.getFilePath(mediaId);
  if (!existsSync(sourcePath)) {
    throw new Error(`Source image not found: ${mediaId}`);
  }

  const derivativePath = getDerivativePath(mediaId, styleName);

  // Ensure derivative directory exists
  const derivativeDir = dirname(derivativePath);
  if (!existsSync(derivativeDir)) {
    mkdirSync(derivativeDir, { recursive: true });
  }

  // Trigger before hook
  const context: Record<string, unknown> = {
    mediaId,
    styleName,
    style,
    sourcePath,
    derivativePath,
  };
  await hooks.trigger('image:beforeProcess', context);

  // Process image
  if (processingTool && style.effects) {
    await processImageWithEffects(sourcePath, derivativePath, style.effects);
  } else {
    // Fallback: copy original
    const buffer = readFileSync(sourcePath);
    writeFileSync(derivativePath, buffer);
  }

  // Trigger after hook
  await hooks.trigger('image:afterProcess', context);

  return derivativePath;
}

/**
 * Get path for derivative image
 */
function getDerivativePath(mediaId: string, styleName: string): string {
  return join(derivativesDir!, styleName, mediaId);
}

/**
 * Process image with effects using available tool
 */
async function processImageWithEffects(sourcePath: string, outputPath: string, effects: ImageEffect[]): Promise<void> {
  if (processingTool === 'sharp') {
    await processWithSharp(sourcePath, outputPath, effects);
  } else if (processingTool === 'imagemagick') {
    await processWithImageMagick(sourcePath, outputPath, effects);
  } else if (processingTool === 'graphicsmagick') {
    await processWithGraphicsMagick(sourcePath, outputPath, effects);
  } else {
    throw new Error('No image processing tool available');
  }
}

/**
 * Process image with Sharp (npm package)
 * Provides high-quality, fast image processing without external tools.
 *
 * WHY Record<string, unknown>:
 * Sharp is an optional dependency without bundled types in this project.
 * We use a loosely-typed pipeline to avoid hard dependency on @types/sharp.
 */
async function processWithSharp(sourcePath: string, outputPath: string, effects: ImageEffect[]): Promise<void> {
  // Dynamic import since Sharp is optional
  let sharp: (input: string) => Record<string, unknown>;
  try {
    sharp = ((await import('sharp')) as Record<string, unknown>).default as (input: string) => Record<string, unknown>;
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    throw new Error('Sharp module not available: ' + errMsg);
  }

  let pipeline = sharp(sourcePath) as Record<string, unknown>;
  let cmsQuality: number | undefined;

  for (const effect of effects) {
    switch (effect.type) {
      case 'scale': {
        const opts: Record<string, unknown> = {};
        if (effect.width) opts['width'] = effect.width;
        if (effect.height) opts['height'] = effect.height;
        if (!effect.upscale) opts['withoutEnlargement'] = true;
        opts['fit'] = 'inside';
        pipeline = (pipeline['resize'] as (opts: Record<string, unknown>) => Record<string, unknown>)(opts);
        break;
      }

      case 'crop': {
        // Map anchor names to Sharp gravity
        const gravityMap: Record<string, string> = {
          'center': 'centre',
          'top-left': 'northwest',
          'top': 'north',
          'top-right': 'northeast',
          'left': 'west',
          'right': 'east',
          'bottom-left': 'southwest',
          'bottom': 'south',
          'bottom-right': 'southeast',
        };
        const opts: Record<string, unknown> = {
          width: effect.width,
          height: effect.height,
          fit: 'cover',
          position: gravityMap[effect.anchor ?? 'center'] ?? 'centre',
        };
        pipeline = (pipeline['resize'] as (opts: Record<string, unknown>) => Record<string, unknown>)(opts);
        break;
      }

      case 'rotate':
        pipeline = (pipeline['rotate'] as (angle: number) => Record<string, unknown>)(effect.angle ?? 0);
        break;

      case 'quality': {
        // Quality is applied at output time -- store for later
        cmsQuality = effect.value;
        break;
      }

      case 'convert': {
        // Format conversion (e.g., to WebP)
        if (effect.format === 'webp') {
          pipeline = (pipeline['webp'] as (opts: Record<string, unknown>) => Record<string, unknown>)({ quality: effect.quality ?? 80 });
        } else if (effect.format === 'avif') {
          pipeline = (pipeline['avif'] as (opts: Record<string, unknown>) => Record<string, unknown>)({ quality: effect.quality ?? 50 });
        } else if (effect.format === 'png') {
          pipeline = (pipeline['png'] as () => Record<string, unknown>)();
        } else if (effect.format === 'jpeg' || effect.format === 'jpg') {
          pipeline = (pipeline['jpeg'] as (opts: Record<string, unknown>) => Record<string, unknown>)({ quality: effect.quality ?? 85 });
        }
        break;
      }
    }
  }

  // Apply quality if set and output is JPEG/WebP
  if (cmsQuality !== undefined) {
    const ext = outputPath.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'jpg' || ext === 'jpeg') {
      pipeline = (pipeline['jpeg'] as (opts: Record<string, unknown>) => Record<string, unknown>)({ quality: cmsQuality });
    } else if (ext === 'webp') {
      pipeline = (pipeline['webp'] as (opts: Record<string, unknown>) => Record<string, unknown>)({ quality: cmsQuality });
    }
  }

  await (pipeline['toFile'] as (path: string) => Promise<void>)(outputPath);
}

/**
 * Process image with ImageMagick
 */
async function processWithImageMagick(sourcePath: string, outputPath: string, effects: ImageEffect[]): Promise<void> {
  const commands: string[] = ['convert', escapePathForShell(sourcePath)];

  for (const effect of effects) {
    switch (effect.type) {
      case 'scale':
        commands.push('-resize', buildResizeSpec(effect));
        break;

      case 'crop':
        commands.push('-gravity', effect.anchor ?? 'center');
        commands.push('-crop', `${effect.width}x${effect.height}+0+0`);
        commands.push('+repage');
        break;

      case 'rotate':
        commands.push('-rotate', (effect.angle ?? 0).toString());
        break;

      case 'quality':
        commands.push('-quality', (effect.value ?? 85).toString());
        break;
    }
  }

  commands.push(escapePathForShell(outputPath));

  try {
    execSync(commands.join(' '), { stdio: 'pipe' });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`ImageMagick processing failed: ${errMsg}`);
  }
}

/**
 * Process image with GraphicsMagick
 */
async function processWithGraphicsMagick(sourcePath: string, outputPath: string, effects: ImageEffect[]): Promise<void> {
  const commands: string[] = ['gm', 'convert', escapePathForShell(sourcePath)];

  for (const effect of effects) {
    switch (effect.type) {
      case 'scale':
        commands.push('-resize', buildResizeSpec(effect));
        break;

      case 'crop':
        commands.push('-gravity', effect.anchor ?? 'center');
        commands.push('-crop', `${effect.width}x${effect.height}+0+0`);
        commands.push('+repage');
        break;

      case 'rotate':
        commands.push('-rotate', (effect.angle ?? 0).toString());
        break;

      case 'quality':
        commands.push('-quality', (effect.value ?? 85).toString());
        break;
    }
  }

  commands.push(escapePathForShell(outputPath));

  try {
    execSync(commands.join(' '), { stdio: 'pipe' });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`GraphicsMagick processing failed: ${errMsg}`);
  }
}

/**
 * Build resize specification for ImageMagick/GraphicsMagick
 */
function buildResizeSpec(effect: ImageEffect): string {
  const { width, height, upscale } = effect;
  const upscaleFlag = upscale === false ? '>' : '';

  if (width && height) {
    return `${width}x${height}${upscaleFlag}`;
  } else if (width) {
    return `${width}${upscaleFlag}`;
  } else if (height) {
    return `x${height}${upscaleFlag}`;
  }

  return '';
}

/**
 * Escape file path for shell command
 */
function escapePathForShell(filePath: string): string {
  return `"${filePath.replace(/"/g, '\\"')}"`;
}

// ============================================================================
// Responsive Images
// ============================================================================

/**
 * Get responsive srcset for an image
 */
export async function getResponsiveSrcset(mediaId: string, styleName: string): Promise<SrcsetResult> {
  const style = getStyle(styleName);
  if (!style || !style.breakpoints) {
    throw new Error(`Style "${styleName}" is not a responsive style`);
  }

  const srcsetParts: string[] = [];
  let defaultSrc: string | null = null;

  for (const [breakpointName, bpConfig] of Object.entries(style.breakpoints)) {
    // Create temporary style for this breakpoint
    const breakpointStyle: StyleConfig = {
      label: `${style.label ?? styleName} - ${breakpointName}`,
      effects: [
        { type: 'scale', width: bpConfig.width, upscale: false }
      ],
    };

    const breakpointStyleName = `${styleName}_${breakpointName}`;
    stylesConfig[breakpointStyleName] = breakpointStyle;

    const derivative = await getDerivative(mediaId, breakpointStyleName);
    srcsetParts.push(`${derivative.url} ${bpConfig.width}w`);

    if (!defaultSrc) {
      defaultSrc = derivative.url;
    }
  }

  return {
    srcset: srcsetParts.join(', '),
    sizes: '100vw',
    src: defaultSrc,
  };
}

// ============================================================================
// Placeholder Generation
// ============================================================================

/**
 * Get placeholder for lazy loading
 */
export async function getPlaceholder(mediaId: string, type: string = 'blur'): Promise<PlaceholderResult | null> {
  const sourcePath = mediaModule!.getFilePath(mediaId);
  if (!existsSync(sourcePath)) {
    return null;
  }

  const dimensions = getImageDimensions(sourcePath);
  if (!dimensions) {
    return null;
  }

  if (type === 'solid') {
    // Generate solid color placeholder (1x1 pixel)
    const color = '#f0f0f0';
    const dataUri = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${dimensions.width}' height='${dimensions.height}'%3E%3Crect width='${dimensions.width}' height='${dimensions.height}' fill='${color}'/%3E%3C/svg%3E`;

    return { url: null, dataUri };
  }

  if (type === 'blur' && processingTool) {
    // Generate tiny blurred version (20px wide)
    const placeholderStyle: StyleConfig = {
      label: 'Placeholder',
      effects: [
        { type: 'scale', width: 20, upscale: false },
        { type: 'quality', value: 50 },
      ],
    };

    stylesConfig['_placeholder'] = placeholderStyle;
    const derivative = await getDerivative(mediaId, '_placeholder');

    // Read as base64 data URI
    const buffer = readFileSync(derivative.path);
    const base64 = buffer.toString('base64');
    const mimeType = mediaModule!.getMimeType(derivative.path);
    const dataUri = `data:${mimeType};base64,${base64}`;

    return { url: derivative.url, dataUri };
  }

  return null;
}

// ============================================================================
// Cache Management
// ============================================================================

/**
 * Flush derivatives for a specific style
 */
export function flushDerivatives(styleName: string): void {
  const styleDir = join(derivativesDir!, styleName);

  if (!existsSync(styleDir)) {
    return;
  }

  try {
    removeDirectory(styleDir);
    console.log(`[image-styles] Flushed derivatives for style: ${styleName}`);
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[image-styles] Failed to flush derivatives: ${errMsg}`);
  }
}

/**
 * Flush all derivatives for a specific media file
 */
export function flushAllDerivatives(mediaId: string): void {
  for (const styleName of Object.keys(stylesConfig)) {
    const derivativePath = getDerivativePath(mediaId, styleName);

    if (existsSync(derivativePath)) {
      try {
        unlinkSync(derivativePath);
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(`[image-styles] Failed to delete derivative: ${errMsg}`);
      }
    }
  }

  console.log(`[image-styles] Flushed all derivatives for: ${mediaId}`);
}

/**
 * Remove directory recursively
 */
function removeDirectory(dirPath: string): void {
  if (!existsSync(dirPath)) {
    return;
  }

  const entries = readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);

    if (entry.isDirectory()) {
      removeDirectory(fullPath);
    } else {
      unlinkSync(fullPath);
    }
  }

  // Remove empty directory
  try {
    execSync(`rmdir "${dirPath}"`, { stdio: 'ignore' });
  } catch {
    // Fallback for non-empty or permission issues
  }
}

// ============================================================================
// Default Export
// ============================================================================

export default {
  init,
  defineStyle,
  getStyle,
  listStyles,
  getImageDimensions,
  getDerivative,
  generateDerivative,
  getResponsiveSrcset,
  getPlaceholder,
  flushDerivatives,
  flushAllDerivatives,
};
