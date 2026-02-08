/**
 * image-styles.js - Image Processing and Styles System
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
 *
 * IMAGE DERIVATIVES:
 * ==================
 * Original: media/2024/01/photo.jpg
 * Derivative: media/derivatives/thumbnail/2024/01/photo.jpg
 *
 * Structure benefits:
 * - Mirrors original directory structure
 * - Easy to find derivatives for an original
 * - Can delete all derivatives of a style (rm -rf derivatives/thumbnail)
 * - Source path preserved for debugging
 *
 * FOCAL POINTS:
 * =============
 * When cropping, you can specify where the "important" part of the image is:
 * - Default: center
 * - Options: center, top-left, top, top-right, left, right, bottom-left, bottom, bottom-right
 * - Custom: {x: 0.5, y: 0.3} (percentages, 0-1)
 *
 * RESPONSIVE IMAGES:
 * ==================
 * Generate multiple sizes for <img srcset>:
 *   <img src="photo.jpg"
 *        srcset="photo-480.jpg 480w, photo-768.jpg 768w, photo-1200.jpg 1200w"
 *        sizes="100vw">
 *
 * This module generates those variants and provides the srcset string.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { execSync } from 'node:child_process';
import * as hooks from './hooks.js';

// ===========================================
// Configuration
// ===========================================

let baseDir = null;
let mediaModule = null;
let stylesConfig = {};
let derivativesDir = null;

// Cache for image dimensions
const dimensionsCache = new Map();

/**
 * Available image processing tools (detected at runtime)
 */
let processingTool = null;

/**
 * Anchor points for cropping
 */
const ANCHOR_POINTS = {
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

// ===========================================
// Initialization
// ===========================================

/**
 * Initialize image styles system
 *
 * @param {string} projectBaseDir - Project root directory
 * @param {Object} media - Media module instance
 */
export function init(projectBaseDir, media) {
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

  console.log(`[image-styles] Initialized with tool: ${processingTool || 'none (metadata-only mode)'}`);
}

/**
 * Load styles configuration from config/image-styles.json
 */
function loadStylesConfig() {
  const configPath = join(baseDir, 'config', 'image-styles.json');

  if (existsSync(configPath)) {
    try {
      const data = readFileSync(configPath, 'utf-8');
      const config = JSON.parse(data);
      stylesConfig = config.styles || {};
      console.log(`[image-styles] Loaded ${Object.keys(stylesConfig).length} styles from config`);
    } catch (error) {
      console.error(`[image-styles] Failed to load config: ${error.message}`);
      stylesConfig = {};
    }
  } else {
    console.warn(`[image-styles] No config found at ${configPath}`);
  }
}

/**
 * Detect available image processing tool
 * Priority: convert (ImageMagick) > gm (GraphicsMagick)
 */
function detectProcessingTool() {
  try {
    execSync('convert -version', { stdio: 'ignore' });
    processingTool = 'imagemagick';
    return;
  } catch (e) {
    // ImageMagick not found
  }

  try {
    execSync('gm version', { stdio: 'ignore' });
    processingTool = 'graphicsmagick';
    return;
  } catch (e) {
    // GraphicsMagick not found
  }

  processingTool = null;
}

// ===========================================
// Style Management
// ===========================================

/**
 * Define or update an image style
 *
 * @param {string} name - Style name
 * @param {Object} config - Style configuration
 * @param {string} config.label - Human-readable label
 * @param {Array} config.effects - Array of effect definitions
 * @param {Object} config.breakpoints - For responsive styles
 */
export function defineStyle(name, config) {
  stylesConfig[name] = config;

  // Persist to config file
  saveStylesConfig();
}

/**
 * Get a style definition
 *
 * @param {string} name - Style name
 * @returns {Object|null} Style config or null if not found
 */
export function getStyle(name) {
  return stylesConfig[name] || null;
}

/**
 * List all defined styles
 *
 * @returns {Array<{ name: string, label: string }>}
 */
export function listStyles() {
  return Object.entries(stylesConfig).map(([name, config]) => ({
    name,
    label: config.label || name,
  }));
}

/**
 * Save styles configuration to disk
 */
function saveStylesConfig() {
  const configPath = join(baseDir, 'config', 'image-styles.json');
  const config = { styles: stylesConfig };

  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error(`[image-styles] Failed to save config: ${error.message}`);
  }
}

// ===========================================
// Image Dimension Reading
// ===========================================

/**
 * Get image dimensions from file header
 * Supports: PNG, JPEG, GIF, WebP
 *
 * @param {string} filePath - Absolute path to image file
 * @returns {{ width: number, height: number, format: string }|null}
 */
export function getImageDimensions(filePath) {
  // Check cache first
  if (dimensionsCache.has(filePath)) {
    return dimensionsCache.get(filePath);
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
  } catch (error) {
    console.error(`[image-styles] Failed to read dimensions from ${filePath}: ${error.message}`);
    return null;
  }
}

/**
 * Read dimensions from image buffer
 * Implements basic header parsing for common formats
 *
 * @param {Buffer} buffer - Image file buffer
 * @returns {{ width: number, height: number, format: string }|null}
 */
function readDimensionsFromBuffer(buffer) {
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
function readJPEGDimensions(buffer) {
  let offset = 2; // Skip initial 0xFFD8

  while (offset < buffer.length) {
    // Find next marker
    if (buffer[offset] !== 0xFF) {
      offset++;
      continue;
    }

    const marker = buffer[offset + 1];

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
function readWebPDimensions(buffer) {
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

// ===========================================
// Derivative Generation
// ===========================================

/**
 * Get derivative image, generating if needed
 *
 * @param {string} mediaId - Media file relative path (e.g., "2024/01/photo.jpg")
 * @param {string} styleName - Style name
 * @returns {{ path: string, url: string, width: number, height: number }|null}
 */
export async function getDerivative(mediaId, styleName) {
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
    width: dimensions?.width || 0,
    height: dimensions?.height || 0,
  };
}

/**
 * Get URL for derivative image (convenience wrapper around getDerivative)
 *
 * @param {string} mediaId - Media file relative path
 * @param {string} styleName - Style name
 * @returns {Promise<string>} URL to derivative
 */
export async function getUrl(mediaId, styleName) {
  const derivative = await getDerivative(mediaId, styleName);
  return derivative.url;
}

/**
 * Generate derivative image
 *
 * @param {string} mediaId - Media file relative path
 * @param {string} styleName - Style name
 * @returns {Promise<string>} Path to generated derivative
 */
export async function generateDerivative(mediaId, styleName) {
  const style = getStyle(styleName);
  if (!style) {
    throw new Error(`Unknown style: ${styleName}`);
  }

  const sourcePath = mediaModule.getFilePath(mediaId);
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
  const context = {
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
 *
 * @param {string} mediaId - Media file relative path
 * @param {string} styleName - Style name
 * @returns {string} Absolute path to derivative
 */
function getDerivativePath(mediaId, styleName) {
  return join(derivativesDir, styleName, mediaId);
}

/**
 * Process image with effects using available tool
 *
 * @param {string} sourcePath - Source image path
 * @param {string} outputPath - Output image path
 * @param {Array} effects - Array of effect definitions
 */
async function processImageWithEffects(sourcePath, outputPath, effects) {
  if (processingTool === 'imagemagick') {
    await processWithImageMagick(sourcePath, outputPath, effects);
  } else if (processingTool === 'graphicsmagick') {
    await processWithGraphicsMagick(sourcePath, outputPath, effects);
  } else {
    throw new Error('No image processing tool available');
  }
}

/**
 * Process image with ImageMagick
 */
async function processWithImageMagick(sourcePath, outputPath, effects) {
  const commands = ['convert', escapePath(sourcePath)];

  for (const effect of effects) {
    switch (effect.type) {
      case 'scale':
        commands.push('-resize', buildResizeSpec(effect));
        break;

      case 'crop':
        commands.push('-gravity', effect.anchor || 'center');
        commands.push('-crop', `${effect.width}x${effect.height}+0+0`);
        commands.push('+repage');
        break;

      case 'rotate':
        commands.push('-rotate', effect.angle.toString());
        break;

      case 'quality':
        commands.push('-quality', effect.value.toString());
        break;
    }
  }

  commands.push(escapePath(outputPath));

  try {
    execSync(commands.join(' '), { stdio: 'pipe' });
  } catch (error) {
    throw new Error(`ImageMagick processing failed: ${error.message}`);
  }
}

/**
 * Process image with GraphicsMagick
 */
async function processWithGraphicsMagick(sourcePath, outputPath, effects) {
  const commands = ['gm', 'convert', escapePath(sourcePath)];

  for (const effect of effects) {
    switch (effect.type) {
      case 'scale':
        commands.push('-resize', buildResizeSpec(effect));
        break;

      case 'crop':
        commands.push('-gravity', effect.anchor || 'center');
        commands.push('-crop', `${effect.width}x${effect.height}+0+0`);
        commands.push('+repage');
        break;

      case 'rotate':
        commands.push('-rotate', effect.angle.toString());
        break;

      case 'quality':
        commands.push('-quality', effect.value.toString());
        break;
    }
  }

  commands.push(escapePath(outputPath));

  try {
    execSync(commands.join(' '), { stdio: 'pipe' });
  } catch (error) {
    throw new Error(`GraphicsMagick processing failed: ${error.message}`);
  }
}

/**
 * Build resize specification for ImageMagick/GraphicsMagick
 */
function buildResizeSpec(effect) {
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
function escapePath(path) {
  return `"${path.replace(/"/g, '\\"')}"`;
}

// ===========================================
// Responsive Images
// ===========================================

/**
 * Get responsive srcset for an image
 *
 * @param {string} mediaId - Media file relative path
 * @param {string} styleName - Responsive style name
 * @returns {Promise<{ srcset: string, sizes: string, src: string }>}
 */
export async function getResponsiveSrcset(mediaId, styleName) {
  const style = getStyle(styleName);
  if (!style || !style.breakpoints) {
    throw new Error(`Style "${styleName}" is not a responsive style`);
  }

  const srcsetParts = [];
  let defaultSrc = null;

  for (const [breakpointName, config] of Object.entries(style.breakpoints)) {
    // Create temporary style for this breakpoint
    const breakpointStyle = {
      label: `${style.label} - ${breakpointName}`,
      effects: [
        { type: 'scale', width: config.width, upscale: false }
      ],
    };

    const breakpointStyleName = `${styleName}_${breakpointName}`;
    stylesConfig[breakpointStyleName] = breakpointStyle;

    const derivative = await getDerivative(mediaId, breakpointStyleName);
    srcsetParts.push(`${derivative.url} ${config.width}w`);

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

// ===========================================
// Placeholder Generation
// ===========================================

/**
 * Get placeholder for lazy loading
 *
 * @param {string} mediaId - Media file relative path
 * @param {string} type - 'blur' or 'solid'
 * @returns {{ url: string, dataUri: string }|null}
 */
export async function getPlaceholder(mediaId, type = 'blur') {
  const sourcePath = mediaModule.getFilePath(mediaId);
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
    const placeholderStyle = {
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
    const ext = extname(derivative.path).slice(1);
    const mimeType = mediaModule.getMimeType(derivative.path);
    const dataUri = `data:${mimeType};base64,${base64}`;

    return { url: derivative.url, dataUri };
  }

  return null;
}

// ===========================================
// Cache Management
// ===========================================

/**
 * Flush derivatives for a specific style
 *
 * @param {string} styleName - Style name
 */
export function flushDerivatives(styleName) {
  const styleDir = join(derivativesDir, styleName);

  if (!existsSync(styleDir)) {
    return;
  }

  try {
    removeDirectory(styleDir);
    console.log(`[image-styles] Flushed derivatives for style: ${styleName}`);
  } catch (error) {
    console.error(`[image-styles] Failed to flush derivatives: ${error.message}`);
  }
}

/**
 * Flush all derivatives for a specific media file
 *
 * @param {string} mediaId - Media file relative path
 */
export function flushAllDerivatives(mediaId) {
  for (const styleName of Object.keys(stylesConfig)) {
    const derivativePath = getDerivativePath(mediaId, styleName);

    if (existsSync(derivativePath)) {
      try {
        unlinkSync(derivativePath);
      } catch (error) {
        console.error(`[image-styles] Failed to delete derivative: ${error.message}`);
      }
    }
  }

  console.log(`[image-styles] Flushed all derivatives for: ${mediaId}`);
}

/**
 * Remove directory recursively
 */
function removeDirectory(dirPath) {
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
  } catch (e) {
    // Fallback for non-empty or permission issues
  }
}

// ===========================================
// Default Export
// ===========================================

export default {
  init,
  defineStyle,
  getStyle,
  listStyles,
  getImageDimensions,
  getDerivative,
  getUrl,
  generateDerivative,
  getResponsiveSrcset,
  getPlaceholder,
  flushDerivatives,
  flushAllDerivatives,
};
