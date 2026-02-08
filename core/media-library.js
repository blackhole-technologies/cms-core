/**
 * media-library.js - Reusable Media Entity Management
 *
 * WHY THIS EXISTS:
 * =================
 * Media Library provides a centralized repository for all media assets,
 * enabling reuse across content. Inspired by Drupal's Media module:
 *
 * - Media as entities (not just files) with metadata
 * - Multiple media types (image, video, audio, document, remote_video)
 * - Thumbnail generation and image style integration
 * - Media browser widget for content editing
 * - Usage tracking (where is each media used)
 *
 * KEY DIFFERENCES FROM media.js:
 * ==============================
 * media.js = File storage and upload handling (low-level)
 * media-library.js = Media entity management (high-level)
 *
 * A "media entity" wraps a file with:
 * - Name and alt text
 * - MIME type and dimensions
 * - Thumbnail
 * - Usage references
 * - Metadata (author, license, tags)
 *
 * STORAGE STRATEGY:
 * =================
 * /content
 *   /media-entity
 *     /<id>.json          <- Media entity data
 * /media
 *   /<year>/<month>       <- Actual files (via media.js)
 *
 * WHY SEPARATE ENTITY STORAGE:
 * - Media entities are content, not just files
 * - Can have revisions, workflow status, etc.
 * - Enables media-specific querying and filtering
 * - Keeps file storage simple (media.js)
 *
 * DESIGN DECISIONS:
 * =================
 * - Uses content service for entity storage (consistency)
 * - Uses media service for file handling
 * - Thumbnail generation via image-styles
 * - Hooks for extensibility
 * - Lazy usage tracking (computed on demand)
 */

import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

// ============================================
// MODULE STATE
// ============================================

let baseDir = null;
let mediaService = null;
let contentService = null;
let imageStylesService = null;
let hooksService = null;
let oembedService = null;

/**
 * Media type definitions
 * Structure: { typeId: MediaTypeDefinition, ... }
 */
const mediaTypes = {};

/**
 * Configuration
 */
let config = {
  enabled: true,
  contentType: 'media-entity',
  thumbnailStyle: 'thumbnail',
  allowedTypes: ['image', 'video', 'audio', 'document', 'remote_video'],
  maxFileSize: 50 * 1024 * 1024, // 50MB
  imageExtensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'],
  videoExtensions: ['mp4', 'webm', 'ogg', 'mov', 'avi'],
  audioExtensions: ['mp3', 'wav', 'ogg', 'aac', 'm4a'],
  documentExtensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv'],
};

// ============================================
// TYPE DEFINITIONS (JSDoc)
// ============================================

/**
 * @typedef {Object} MediaTypeDefinition
 * @property {string} id - Type identifier (image, video, etc.)
 * @property {string} label - Human-readable name
 * @property {string} description - Type description
 * @property {string[]} extensions - Allowed file extensions
 * @property {string[]} mimeTypes - Allowed MIME types
 * @property {Object} schema - Additional fields for this type
 * @property {Function} validate - Custom validation function
 */

/**
 * @typedef {Object} MediaEntity
 * @property {string} id - Entity ID
 * @property {string} type - Entity type (always "media-entity")
 * @property {string} mediaType - Media type (image, video, etc.)
 * @property {string} name - Display name
 * @property {string} filename - Original filename
 * @property {string} path - File path (relative to media directory)
 * @property {string} mimeType - MIME type
 * @property {number} size - File size in bytes
 * @property {Object} metadata - Type-specific metadata
 * @property {string} thumbnail - Thumbnail path (for images/videos)
 * @property {string[]} tags - Categorization tags
 * @property {string} alt - Alt text (for images)
 * @property {string} caption - Caption/description
 * @property {string} credit - Credit/attribution
 * @property {string} status - published/draft
 * @property {string} created - ISO timestamp
 * @property {string} updated - ISO timestamp
 */

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize the media library system
 *
 * @param {Object} options - Initialization options
 * @param {string} options.baseDir - Base directory
 * @param {Object} options.media - Media service reference
 * @param {Object} options.content - Content service reference
 * @param {Object} options.imageStyles - Image styles service reference
 * @param {Object} options.hooks - Hooks service reference
 * @param {Object} options.config - Configuration overrides
 */
export function init(options = {}) {
  baseDir = options.baseDir;
  mediaService = options.media;
  contentService = options.content;
  imageStylesService = options.imageStyles;
  hooksService = options.hooks;
  oembedService = options.oembed || null;

  if (options.config) {
    config = { ...config, ...options.config };
  }

  // Register media entity content type
  if (contentService) {
    registerMediaContentType();
  }

  // Register built-in media types
  registerBuiltinMediaTypes();

  console.log(`[media-library] Initialized (${Object.keys(mediaTypes).length} media types)`);
}

/**
 * Register the media-entity content type
 */
function registerMediaContentType() {
  // Check if already registered
  if (contentService.hasType && contentService.hasType(config.contentType)) {
    return;
  }

  // Register via content service
  // WHY try both names: content.js exports register() not registerType().
  // We check both for forward compatibility.
  const registerFn = contentService.registerType || contentService.register;
  if (registerFn) {
    try {
      registerFn(config.contentType, {
        name: { type: 'string', required: true },
        mediaType: { type: 'string', required: true },
        filename: {
          type: 'string',
          required: true,
          constraints: {
            FileExtension: ['jpg', 'jpeg', 'png', 'gif', 'pdf', 'doc', 'docx', 'mp4', 'webm']
          }
        },
        path: { type: 'string', required: true },
        mimeType: { type: 'string' },
        size: { type: 'number' },
        metadata: { type: 'object' },
        thumbnail: { type: 'string' },
        tags: { type: 'array' },
        alt: { type: 'string', required: false },  // Required for images, validated in createMediaEntity
        caption: { type: 'string' },
        credit: { type: 'string' },
        folder: { type: 'string', required: false },  // Folder path for organization (e.g., 'Photos/2024')
      }, 'core:media-library');
    } catch (err) {
      // Type may already be registered by another module
      if (!err.message.includes('already registered')) {
        console.warn(`[media-library] Could not register content type: ${err.message}`);
      }
    }
  }
}

// ============================================
// BUILT-IN MEDIA TYPES
// ============================================

/**
 * Register built-in media type definitions
 */
function registerBuiltinMediaTypes() {
  // Image
  mediaTypes.image = {
    id: 'image',
    label: 'Image',
    description: 'Photographs, illustrations, and graphics',
    extensions: config.imageExtensions,
    mimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
    schema: {
      width: { type: 'number' },
      height: { type: 'number' },
      alt: { type: 'string', required: true },
    },
    icon: 'image',
  };

  // Video
  mediaTypes.video = {
    id: 'video',
    label: 'Video',
    description: 'Video files',
    extensions: config.videoExtensions,
    mimeTypes: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo'],
    schema: {
      width: { type: 'number' },
      height: { type: 'number' },
      duration: { type: 'number' },
    },
    icon: 'video',
  };

  // Audio
  mediaTypes.audio = {
    id: 'audio',
    label: 'Audio',
    description: 'Audio files and podcasts',
    extensions: config.audioExtensions,
    mimeTypes: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/mp4'],
    schema: {
      duration: { type: 'number' },
      bitrate: { type: 'number' },
    },
    icon: 'audio',
  };

  // Document
  mediaTypes.document = {
    id: 'document',
    label: 'Document',
    description: 'PDFs, office documents, and text files',
    extensions: config.documentExtensions,
    mimeTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'text/csv',
    ],
    schema: {
      pageCount: { type: 'number' },
    },
    icon: 'document',
  };

  // Remote Video (YouTube, Vimeo, etc.)
  mediaTypes.remote_video = {
    id: 'remote_video',
    label: 'Remote Video',
    description: 'YouTube, Vimeo, and other embedded videos',
    extensions: [],
    mimeTypes: [],
    schema: {
      url: { type: 'string', required: true },
      provider: { type: 'string' },
      videoId: { type: 'string' },
      embedUrl: { type: 'string' },
    },
    icon: 'video-remote',
    isRemote: true,
  };
}

// ============================================
// MEDIA TYPE MANAGEMENT
// ============================================

/**
 * Register a custom media type
 *
 * @param {MediaTypeDefinition} typeDefinition - Type definition
 * @returns {MediaTypeDefinition}
 */
export function registerMediaType(typeDefinition) {
  if (!typeDefinition.id) {
    throw new Error('Media type ID is required');
  }

  if (mediaTypes[typeDefinition.id]) {
    throw new Error(`Media type "${typeDefinition.id}" already exists`);
  }

  mediaTypes[typeDefinition.id] = {
    id: typeDefinition.id,
    label: typeDefinition.label || typeDefinition.id,
    description: typeDefinition.description || '',
    extensions: typeDefinition.extensions || [],
    mimeTypes: typeDefinition.mimeTypes || [],
    schema: typeDefinition.schema || {},
    icon: typeDefinition.icon || 'file',
    isRemote: typeDefinition.isRemote || false,
    validate: typeDefinition.validate || null,
  };

  return mediaTypes[typeDefinition.id];
}

/**
 * Get a media type definition
 *
 * @param {string} id - Type ID
 * @returns {MediaTypeDefinition|null}
 */
export function getMediaType(id) {
  return mediaTypes[id] || null;
}

/**
 * List all media types
 *
 * @returns {MediaTypeDefinition[]}
 */
export function listMediaTypes() {
  return Object.values(mediaTypes);
}

/**
 * Detect media type from file extension or MIME type
 *
 * @param {string} filename - File name or path
 * @param {string} mimeType - MIME type (optional)
 * @returns {string|null} - Media type ID or null
 */
export function detectMediaType(filename, mimeType = null) {
  const ext = filename.split('.').pop().toLowerCase();

  for (const [typeId, typeDef] of Object.entries(mediaTypes)) {
    if (typeDef.isRemote) continue;

    if (typeDef.extensions.includes(ext)) {
      return typeId;
    }

    if (mimeType && typeDef.mimeTypes.includes(mimeType)) {
      return typeId;
    }
  }

  return null;
}

// ============================================
// MEDIA ENTITY MANAGEMENT
// ============================================

/**
 * Create a new media entity from an uploaded file
 *
 * @param {Object} file - Uploaded file data
 * @param {Buffer|string} file.data - File data or path
 * @param {string} file.filename - Original filename
 * @param {string} file.mimeType - MIME type
 * @param {number} file.size - File size
 * @param {Object} options - Additional options
 * @returns {Promise<MediaEntity>}
 */
export async function createFromUpload(file, options = {}) {
  // Detect media type
  const mediaType = options.mediaType || detectMediaType(file.filename, file.mimeType);
  if (!mediaType) {
    throw new Error(`Unsupported file type: ${file.filename}`);
  }

  const typeDef = getMediaType(mediaType);
  if (!typeDef) {
    throw new Error(`Unknown media type: ${mediaType}`);
  }

  // Validate file size
  if (file.size > config.maxFileSize) {
    const actualMB = (file.size / (1024 * 1024)).toFixed(2);
    const maxMB = (config.maxFileSize / (1024 * 1024)).toFixed(1);
    throw new Error(`File too large: ${actualMB}MB (max: ${maxMB}MB)`);
  }

  // Validate alt text for images (accessibility requirement)
  // WHY: WCAG 2.1 Level A requires alt text on all non-decorative images
  // for screen reader accessibility. Enforcing at upload prevents inaccessible content.
  if (mediaType === 'image' && (!options.alt || options.alt.trim() === '')) {
    throw new Error('Alt text is required for image uploads (accessibility requirement)');
  }

  // Fire before hook
  if (hooksService) {
    await hooksService.trigger('media-library:beforeCreate', { file, options, mediaType });
  }

  // Upload file via media service
  let uploadResult;
  if (mediaService && mediaService.upload) {
    uploadResult = await mediaService.upload(file.data, file.filename, {
      mimeType: file.mimeType,
    });
  } else {
    throw new Error('Media service not available');
  }

  // Extract metadata for images
  let metadata = options.metadata || {};
  if (mediaType === 'image') {
    // Could integrate with image-size or sharp for dimensions
    metadata = {
      ...metadata,
      width: options.width || null,
      height: options.height || null,
    };
  }

  // Generate thumbnail for images
  let thumbnail = null;
  if (mediaType === 'image' && imageStylesService) {
    try {
      thumbnail = await imageStylesService.generate(
        uploadResult.path,
        config.thumbnailStyle
      );
    } catch (e) {
      console.warn('[media-library] Thumbnail generation failed:', e.message);
    }
  }

  // Create media entity
  const entity = {
    name: options.name || file.filename.replace(/\.[^.]+$/, ''),
    mediaType,
    filename: file.filename,
    path: uploadResult.path,
    mimeType: file.mimeType,
    size: file.size,
    metadata,
    thumbnail,
    tags: options.tags || [],
    alt: options.alt || '',
    caption: options.caption || '',
    credit: options.credit || '',
    folder: options.folder || '',  // Folder path for organization
    status: options.status || 'published',
  };

  // Save via content service
  const created = await contentService.create(config.contentType, entity);

  // Fire after hook
  if (hooksService) {
    await hooksService.trigger('media-library:afterCreate', { entity: created, file });
  }

  return created;
}

/**
 * Create a media entity for a remote video
 *
 * @param {string} url - Video URL (YouTube, Vimeo, etc.)
 * @param {Object} options - Additional options
 * @returns {Promise<MediaEntity>}
 */
export async function createFromUrl(url, options = {}) {
  // Parse video URL
  const videoInfo = parseVideoUrl(url);
  if (!videoInfo) {
    throw new Error('Unsupported video URL');
  }

  // Fire before hook
  if (hooksService) {
    await hooksService.trigger('media-library:beforeCreate', { url, options, mediaType: 'remote_video' });
  }

  // Fetch oEmbed metadata to enrich entity with title, author, dimensions, etc.
  // WHY: Basic URL parsing only gives us provider/videoId. oEmbed gives us
  // rich metadata (title, author, thumbnail, dimensions) from the provider's API.
  let oembedData = null;
  if (oembedService) {
    try {
      oembedData = await oembedService.fetchEmbed(url);
    } catch (err) {
      // oEmbed fetch is best-effort; continue with basic URL-parsed info
      console.warn(`[media-library] oEmbed fetch failed for ${url}: ${err.message}`);
    }
  }

  // Create media entity with oEmbed-enriched metadata
  const entity = {
    name: options.name || (oembedData && oembedData.title) || `${videoInfo.provider} video`,
    mediaType: 'remote_video',
    filename: url,
    path: url,
    mimeType: 'video/embed',
    size: 0,
    metadata: {
      url,
      provider: videoInfo.provider,
      videoId: videoInfo.videoId,
      embedUrl: videoInfo.embedUrl,
      // oEmbed-extracted metadata stored alongside parsed info
      oembed: oembedData ? {
        type: oembedData.type || null,
        title: oembedData.title || null,
        author_name: oembedData.author_name || null,
        author_url: oembedData.author_url || null,
        provider_name: oembedData.provider_name || null,
        provider_url: oembedData.provider_url || null,
        thumbnail_url: oembedData.thumbnail_url || null,
        thumbnail_url_cached: oembedData.thumbnail_url_cached || null,
        thumbnail_width: oembedData.thumbnail_width || null,
        thumbnail_height: oembedData.thumbnail_height || null,
        html: oembedData.html || null,
        width: oembedData.width || null,
        height: oembedData.height || null,
      } : null,
    },
    thumbnail: (oembedData && (oembedData.thumbnail_url_cached || oembedData.thumbnail_url)) || videoInfo.thumbnailUrl || null,
    tags: options.tags || [],
    alt: options.alt || (oembedData && oembedData.title) || '',
    caption: options.caption || '',
    credit: options.credit || (oembedData && oembedData.author_name) || videoInfo.provider,
    status: options.status || 'published',
  };

  // Save via content service
  const created = await contentService.create(config.contentType, entity);

  // Fire after hook
  if (hooksService) {
    await hooksService.trigger('media-library:afterCreate', { entity: created, url });
  }

  return created;
}

/**
 * Parse a video URL to extract provider and ID
 *
 * @param {string} url - Video URL
 * @returns {Object|null}
 */
function parseVideoUrl(url) {
  // YouTube
  const youtubeMatch = url.match(
    /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/
  );
  if (youtubeMatch) {
    return {
      provider: 'youtube',
      videoId: youtubeMatch[1],
      embedUrl: `https://www.youtube.com/embed/${youtubeMatch[1]}`,
      thumbnailUrl: `https://img.youtube.com/vi/${youtubeMatch[1]}/hqdefault.jpg`,
    };
  }

  // Vimeo
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) {
    return {
      provider: 'vimeo',
      videoId: vimeoMatch[1],
      embedUrl: `https://player.vimeo.com/video/${vimeoMatch[1]}`,
      thumbnailUrl: null, // Vimeo requires API call for thumbnail
    };
  }

  return null;
}

/**
 * Get a media entity by ID
 *
 * @param {string} id - Entity ID
 * @returns {MediaEntity|null}
 */
export function get(id) {
  if (!contentService) return null;
  return contentService.read(config.contentType, id);
}

/**
 * Update a media entity
 *
 * @param {string} id - Entity ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<MediaEntity>}
 */
export async function update(id, updates) {
  // Fire before hook
  if (hooksService) {
    await hooksService.trigger('media-library:beforeUpdate', { id, updates });
  }

  const updated = await contentService.update(config.contentType, id, updates);

  // Fire after hook
  if (hooksService) {
    await hooksService.trigger('media-library:afterUpdate', { entity: updated });
  }

  return updated;
}

/**
 * Delete a media entity
 *
 * @param {string} id - Entity ID
 * @param {Object} options - Delete options
 * @param {boolean} options.deleteFile - Also delete the file (default: true)
 * @returns {Promise<boolean>}
 */
export async function remove(id, options = {}) {
  const entity = get(id);
  if (!entity) {
    throw new Error(`Media entity "${id}" not found`);
  }

  const deleteFile = options.deleteFile !== false;

  // Fire before hook
  if (hooksService) {
    await hooksService.trigger('media-library:beforeDelete', { entity, deleteFile });
  }

  // Delete file if requested and not remote
  if (deleteFile && mediaService && !entity.metadata?.url) {
    try {
      await mediaService.delete(entity.path);
    } catch (e) {
      console.warn('[media-library] Failed to delete file:', e.message);
    }
  }

  // Delete entity
  await contentService.remove(config.contentType, id);

  // Fire after hook
  if (hooksService) {
    await hooksService.trigger('media-library:afterDelete', { id, entity });
  }

  return true;
}

/**
 * List media entities with filtering
 *
 * @param {Object} options - Query options
 * @param {string} options.mediaType - Filter by media type
 * @param {string} options.search - Search in name
 * @param {string[]} options.tags - Filter by tags
 * @param {number} options.page - Page number
 * @param {number} options.limit - Items per page
 * @param {string} options.sort - Sort field
 * @param {string} options.order - Sort order (asc/desc)
 * @returns {Object}
 */
export function list(options = {}) {
  const queryOptions = {
    page: options.page || 1,
    limit: options.limit || 20,
    sortBy: options.sort || 'created',
    sortOrder: options.order || 'desc',
    filters: {},
  };

  // WHY OBJECT FORMAT:
  // content.list() expects filters as { field: value } or { 'field__op': value }
  // Array format was incorrectly used before and silently failed
  if (options.mediaType) {
    queryOptions.filters.mediaType = options.mediaType;
  }

  if (options.folder !== undefined) {
    queryOptions.filters.folder = options.folder;
  }

  if (options.search) {
    queryOptions.search = options.search;
  }

  // Note: Tag filtering would need content service enhancement
  // or post-query filtering

  return contentService.list(config.contentType, queryOptions);
}

// ============================================
// USAGE TRACKING
// ============================================

/**
 * List all folders containing media
 * WHY: Provides folder structure for UI navigation and organization
 *
 * @returns {Array<{path: string, count: number}>} Array of folders with media counts
 */
export function listFolders() {
  const entities = list({ limit: 10000 });
  const folderMap = new Map();

  for (const entity of entities) {
    const folder = entity.folder || '';
    if (!folderMap.has(folder)) {
      folderMap.set(folder, 0);
    }
    folderMap.set(folder, folderMap.get(folder) + 1);
  }

  return Array.from(folderMap.entries())
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Move media entity to a different folder
 * WHY: Enables reorganization of media library without re-uploading files
 *
 * @param {string} mediaId - Media entity ID
 * @param {string} folder - Target folder path (e.g., 'Photos/2024')
 * @returns {Promise<Object>} Updated media entity
 */
export async function moveToFolder(mediaId, folder) {
  return await update(mediaId, { folder: folder || '' });
}

/**
 * Track where a media entity is used
 *
 * @param {string} mediaId - Media entity ID
 * @param {string} contentType - Referencing content type
 * @param {string} contentId - Referencing content ID
 * @param {string} field - Field name that references the media
 */
export async function trackUsage(mediaId, contentType, contentId, field) {
  const entity = get(mediaId);
  if (!entity) return;

  // Get or initialize usage array
  const usage = entity._usage || [];

  // Add reference if not already tracked
  const existing = usage.find(
    u => u.contentType === contentType && u.contentId === contentId && u.field === field
  );

  if (!existing) {
    usage.push({
      contentType,
      contentId,
      field,
      added: new Date().toISOString(),
    });

    await update(mediaId, { _usage: usage });
  }
}

/**
 * Remove usage tracking
 *
 * @param {string} mediaId - Media entity ID
 * @param {string} contentType - Referencing content type
 * @param {string} contentId - Referencing content ID
 */
export async function removeUsage(mediaId, contentType, contentId) {
  const entity = get(mediaId);
  if (!entity || !entity._usage) return;

  const usage = entity._usage.filter(
    u => !(u.contentType === contentType && u.contentId === contentId)
  );

  await update(mediaId, { _usage: usage });
}

/**
 * Get usage information for a media entity
 *
 * @param {string} mediaId - Media entity ID
 * @returns {Object[]}
 */
export function getUsage(mediaId) {
  const entity = get(mediaId);
  if (!entity) return [];
  return entity._usage || [];
}

/**
 * Check if a media entity is in use
 *
 * @param {string} mediaId - Media entity ID
 * @returns {boolean}
 */
export function isInUse(mediaId) {
  const usage = getUsage(mediaId);
  return usage.length > 0;
}

// ============================================
// MEDIA REPLACE
// ============================================

/**
 * Replace a media entity's file while preserving references
 *
 * WHY THIS EXISTS:
 * ================
 * When a media item needs to be replaced (e.g., updated logo, corrected image),
 * all content referencing it should automatically use the new file. This is the
 * Drupal "replace" pattern — the entity ID stays the same, only the file changes.
 *
 * ATOMICITY:
 * ==========
 * The replace operation updates the media entity in a single write. Since all
 * content references point to the media entity ID (not the file path), updating
 * the entity's path/filename atomically updates all references. No need to walk
 * through each referencing content item.
 *
 * @param {string} mediaId - ID of the media entity to replace
 * @param {Object} newFile - New file data
 * @param {Buffer} newFile.data - File data
 * @param {string} newFile.name - Filename
 * @param {string} newFile.type - MIME type
 * @param {number} newFile.size - File size in bytes
 * @param {Object} options - Replace options
 * @param {boolean} options.keepOldFile - If true, don't delete old file (default: false)
 * @returns {Promise<{entity: MediaEntity, oldPath: string, newPath: string, referencesUpdated: number}>}
 */
export async function replaceMedia(mediaId, newFile, options = {}) {
  const entity = get(mediaId);
  if (!entity) {
    throw new Error(`Media entity "${mediaId}" not found`);
  }

  // Remote videos can't be replaced with file uploads
  if (entity.mediaType === 'remote_video') {
    throw new Error('Cannot replace a remote video with a file upload. Update the URL instead.');
  }

  // Store old path for cleanup
  const oldPath = entity.path;
  const oldFilename = entity.filename;

  // Fire before hook
  if (hooksService) {
    await hooksService.trigger('media-library:beforeReplace', {
      mediaId,
      entity,
      newFile,
      options,
    });
  }

  // Save the new file via media service
  // WHY use mediaService.saveFile: Consistent file naming (timestamp prefix),
  // directory structure (year/month), and extension validation.
  let savedFile;
  if (mediaService && mediaService.saveFile) {
    savedFile = mediaService.saveFile({
      name: newFile.name,
      originalName: newFile.name,
      data: newFile.data,
      size: newFile.size,
      type: newFile.type,
    });
  } else {
    throw new Error('Media service not available for file storage');
  }

  // Detect media type of new file
  const newMediaType = detectMediaType(newFile.name, newFile.type);

  // Update the media entity with new file info
  // WHY: Entity ID stays the same, so all _usage references remain valid.
  // Content items reference by media entity ID, not file path.
  const updates = {
    filename: newFile.name,
    path: savedFile.relativePath,
    mimeType: newFile.type || savedFile.type,
    size: newFile.size,
  };

  // Update media type if it changed (e.g., replacing PNG with JPG is fine, both are 'image')
  if (newMediaType && newMediaType !== entity.mediaType) {
    updates.mediaType = newMediaType;
  }

  // Update thumbnail for images
  if ((newMediaType === 'image' || entity.mediaType === 'image') && imageStylesService) {
    try {
      updates.thumbnail = await imageStylesService.generate(
        savedFile.relativePath,
        config.thumbnailStyle
      );
    } catch (e) {
      // Thumbnail generation is best-effort
      console.warn('[media-library] Thumbnail generation failed during replace:', e.message);
    }
  }

  const updatedEntity = await update(mediaId, updates);

  // Delete old file unless explicitly told to keep it
  // WHY: Default is to remove — prevents orphaned files consuming disk space.
  // Option to keep allows archival workflows.
  if (!options.keepOldFile && mediaService && oldPath) {
    try {
      mediaService.deleteFile(oldPath);
    } catch (e) {
      // Old file deletion is best-effort (may already be gone)
      console.warn('[media-library] Failed to delete old file during replace:', e.message);
    }
  }

  // Count references (usage entries) that are now pointing to the new file
  const usage = getUsage(mediaId);
  const referencesUpdated = usage.length;

  // Fire after hook
  if (hooksService) {
    await hooksService.trigger('media-library:afterReplace', {
      entity: updatedEntity,
      oldPath,
      newPath: savedFile.relativePath,
      referencesUpdated,
    });
  }

  return {
    entity: updatedEntity,
    oldPath,
    newPath: savedFile.relativePath,
    oldFilename,
    newFilename: newFile.name,
    referencesUpdated,
  };
}

// ============================================
// URL AND PATH HELPERS
// ============================================

/**
 * Get the public URL for a media entity
 *
 * @param {string|MediaEntity} mediaOrId - Media entity or ID
 * @param {string} style - Image style (for images)
 * @returns {string|null}
 */
export function getUrl(mediaOrId, style = null) {
  const entity = typeof mediaOrId === 'string' ? get(mediaOrId) : mediaOrId;
  if (!entity) return null;

  // Remote video
  if (entity.mediaType === 'remote_video') {
    return entity.metadata?.url || null;
  }

  // Image with style
  if (style && entity.mediaType === 'image' && imageStylesService) {
    return imageStylesService.getUrl(entity.path, style);
  }

  // Default path
  return `/media/${entity.path}`;
}

/**
 * Get thumbnail URL for a media entity
 *
 * @param {string|MediaEntity} mediaOrId - Media entity or ID
 * @returns {string|null}
 */
export function getThumbnailUrl(mediaOrId) {
  const entity = typeof mediaOrId === 'string' ? get(mediaOrId) : mediaOrId;
  if (!entity) return null;

  // Use stored thumbnail
  if (entity.thumbnail) {
    return entity.thumbnail;
  }

  // For remote videos, use the thumbnail URL from metadata
  if (entity.mediaType === 'remote_video' && entity.metadata?.thumbnailUrl) {
    return entity.metadata.thumbnailUrl;
  }

  // For images, generate thumbnail on-the-fly
  if (entity.mediaType === 'image') {
    return getUrl(entity, config.thumbnailStyle);
  }

  // Type-specific placeholder
  return `/admin/assets/icons/media-${entity.mediaType}.svg`;
}

/**
 * Get embed code for remote videos
 *
 * @param {string|MediaEntity} mediaOrId - Media entity or ID
 * @param {Object} options - Embed options
 * @returns {string|null}
 */
export function getEmbed(mediaOrId, options = {}) {
  const entity = typeof mediaOrId === 'string' ? get(mediaOrId) : mediaOrId;
  if (!entity || entity.mediaType !== 'remote_video') return null;

  const width = options.width || 560;
  const height = options.height || 315;
  const embedUrl = entity.metadata?.embedUrl;

  if (!embedUrl) return null;

  return `<iframe width="${width}" height="${height}" src="${embedUrl}" frameborder="0" allowfullscreen></iframe>`;
}

// ============================================
// BROWSER WIDGET DATA
// ============================================

/**
 * Get data for the media browser widget
 *
 * @param {Object} options - Browser options
 * @param {string[]} options.allowedTypes - Allowed media types
 * @param {boolean} options.multiple - Allow multiple selection
 * @returns {Object}
 */
export function getBrowserData(options = {}) {
  const allowedTypes = options.allowedTypes || config.allowedTypes;

  return {
    types: listMediaTypes().filter(t => allowedTypes.includes(t.id)),
    items: list({ limit: 50, mediaType: options.initialType }),
    config: {
      allowedTypes,
      multiple: options.multiple || false,
      uploadEnabled: true,
      maxFileSize: config.maxFileSize,
    },
  };
}

// ============================================
// BULK OPERATIONS
// ============================================

/**
 * Bulk update media entities
 *
 * @param {string[]} ids - Entity IDs
 * @param {Object} updates - Updates to apply
 * @returns {Promise<number>} - Number of updated entities
 */
export async function bulkUpdate(ids, updates) {
  let count = 0;

  for (const id of ids) {
    try {
      await update(id, updates);
      count++;
    } catch (e) {
      console.warn(`[media-library] Failed to update ${id}:`, e.message);
    }
  }

  return count;
}

/**
 * Bulk delete media entities
 *
 * @param {string[]} ids - Entity IDs
 * @param {Object} options - Delete options
 * @returns {Promise<number>} - Number of deleted entities
 */
export async function bulkDelete(ids, options = {}) {
  let count = 0;

  for (const id of ids) {
    try {
      await remove(id, options);
      count++;
    } catch (e) {
      console.warn(`[media-library] Failed to delete ${id}:`, e.message);
    }
  }

  return count;
}

// ============================================
// STATISTICS
// ============================================

/**
 * Get media library statistics
 *
 * @returns {Object}
 */
export function getStats() {
  const allMedia = list({ limit: 10000 });
  const items = allMedia.items || [];

  const stats = {
    total: items.length,
    byType: {},
    totalSize: 0,
    recentlyAdded: 0,
  };

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  for (const item of items) {
    // Count by type
    stats.byType[item.mediaType] = (stats.byType[item.mediaType] || 0) + 1;

    // Total size
    stats.totalSize += item.size || 0;

    // Recently added
    if (new Date(item.created) > oneWeekAgo) {
      stats.recentlyAdded++;
    }
  }

  return stats;
}

// ============================================
// CONFIGURATION
// ============================================

/**
 * Get configuration
 *
 * @returns {Object}
 */
export function getConfig() {
  return { ...config };
}

/**
 * Check if media library is enabled
 *
 * @returns {boolean}
 */
export function isEnabled() {
  return config.enabled;
}

// ============================================
// CLI REGISTRATION
// ============================================

/**
 * Register CLI commands
 *
 * @param {Function} registerCommand - CLI command registration function
 */
export function register(registerCommand) {
  registerCommand('media:folders', async () => {
    const folders = listFolders();
    console.log('\nMedia Folders:\n');
    if (folders.length === 0) {
      console.log('  No folders found.');
      return;
    }
    for (const folder of folders) {
      const path = folder.path || '(root)';
      console.log(`  ${path} (${folder.count} items)`);
    }
  }, 'List all media folders');

  registerCommand('media:move', async (args) => {
    const [mediaId, folderPath] = args;
    if (!mediaId) {
      console.error('Usage: media:move <media-id> [folder-path]');
      return;
    }
    const updated = await moveToFolder(mediaId, folderPath || '');
    console.log(`Moved media ${mediaId} to folder: ${folderPath || '(root)'}`);
  }, 'Move media to a folder');

  registerCommand('media:list-folder', async (args) => {
    const [folderPath] = args;
    const items = list({ folder: folderPath || '', limit: 100 });
    console.log(`\nMedia in folder "${folderPath || '(root)'}": ${items.length} items\n`);
    for (const item of items) {
      console.log(`  ${item.id} - ${item.name} (${item.mediaType})`);
    }
  }, 'List media in a specific folder');
}
