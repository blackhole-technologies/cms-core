/**
 * media-library.ts - Reusable Media Entity Management
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
 * KEY DIFFERENCES FROM media.ts:
 * ==============================
 * media.ts = File storage and upload handling (low-level)
 * media-library.ts = Media entity management (high-level)
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
 *   /<year>/<month>       <- Actual files (via media.ts)
 *
 * WHY SEPARATE ENTITY STORAGE:
 * - Media entities are content, not just files
 * - Can have revisions, workflow status, etc.
 * - Enables media-specific querying and filtering
 * - Keeps file storage simple (media.ts)
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
// Types
// ============================================

/** Schema field definition */
interface SchemaFieldDef {
  type: string;
  required?: boolean;
}

/** Media type definition */
export interface MediaTypeDefinition {
  id: string;
  label: string;
  description: string;
  extensions: string[];
  mimeTypes: string[];
  schema: Record<string, SchemaFieldDef>;
  icon: string;
  isRemote?: boolean;
  validate?: ((entity: MediaEntity) => boolean) | null;
}

/** A media entity stored in the content system */
export interface MediaEntity {
  id: string;
  type: string;
  mediaType: string;
  name: string;
  filename: string;
  path: string;
  mimeType: string;
  size: number;
  metadata: Record<string, unknown>;
  thumbnail: string | null;
  tags: string[];
  alt: string;
  caption: string;
  credit: string;
  status: string;
  created: string;
  updated: string;
  _usage?: UsageReference[];
  [key: string]: unknown;
}

/** Usage reference for tracking where a media entity is used */
export interface UsageReference {
  contentType: string;
  contentId: string;
  field: string;
  added: string;
}

/** Media library configuration */
export interface MediaLibraryConfig {
  enabled: boolean;
  contentType: string;
  thumbnailStyle: string;
  allowedTypes: string[];
  maxFileSize: number;
  imageExtensions: string[];
  videoExtensions: string[];
  audioExtensions: string[];
  documentExtensions: string[];
}

/** Video info extracted from URL */
interface VideoInfo {
  provider: string;
  videoId: string;
  embedUrl: string;
  thumbnailUrl: string | null;
}

/** Initialization options */
export interface MediaLibraryInitOptions {
  baseDir?: string;
  media?: MediaService;
  content?: ContentService;
  imageStyles?: ImageStylesService;
  hooks?: HooksService;
  config?: Partial<MediaLibraryConfig>;
}

/** Upload file input */
export interface UploadFileInput {
  data: Buffer | string;
  filename: string;
  mimeType: string;
  size: number;
}

/** Create options */
export interface CreateOptions {
  mediaType?: string;
  name?: string;
  width?: number;
  height?: number;
  metadata?: Record<string, unknown>;
  tags?: string[];
  alt?: string;
  caption?: string;
  credit?: string;
  status?: string;
}

/** Create from URL options */
export interface CreateFromUrlOptions {
  name?: string;
  tags?: string[];
  alt?: string;
  caption?: string;
  credit?: string;
  status?: string;
}

/** List options for filtering */
export interface ListOptions {
  mediaType?: string;
  search?: string;
  tags?: string[];
  page?: number;
  limit?: number;
  sort?: string;
  order?: string;
}

/** Delete options */
export interface DeleteOptions {
  deleteFile?: boolean;
}

/** Browser widget options */
export interface BrowserOptions {
  allowedTypes?: string[];
  multiple?: boolean;
  initialType?: string;
}

/** Browser widget data */
export interface BrowserData {
  types: MediaTypeDefinition[];
  items: unknown;
  config: {
    allowedTypes: string[];
    multiple: boolean;
    uploadEnabled: boolean;
    maxFileSize: number;
  };
}

/** Embed options */
export interface EmbedOptions {
  width?: number;
  height?: number;
}

/** Media library stats */
export interface MediaLibraryStats {
  total: number;
  byType: Record<string, number>;
  totalSize: number;
  recentlyAdded: number;
}

// Service interfaces (subset of what these services provide)
interface MediaService {
  upload?: (data: Buffer | string, filename: string, options: Record<string, unknown>) => Promise<{ path: string }>;
  delete?: (path: string) => Promise<void>;
}

interface ContentService {
  hasType?: (type: string) => boolean;
  registerType?: (type: string, schema: Record<string, SchemaFieldDef>, source: string) => void;
  create: (type: string, data: Record<string, unknown>) => Promise<MediaEntity>;
  read: (type: string, id: string) => MediaEntity | null;
  update: (type: string, id: string, data: Record<string, unknown>) => Promise<MediaEntity>;
  remove: (type: string, id: string) => Promise<void>;
  list: (type: string, options?: Record<string, unknown>) => { items: MediaEntity[] };
}

interface ImageStylesService {
  generate?: (path: string, style: string) => Promise<string>;
  getUrl?: (path: string, style: string) => string;
}

interface HooksService {
  trigger: (event: string, context: Record<string, unknown>) => Promise<void>;
}

// ============================================
// MODULE STATE
// ============================================

let baseDir: string | null = null;
let mediaService: MediaService | null = null;
let contentService: ContentService | null = null;
let imageStylesService: ImageStylesService | null = null;
let hooksService: HooksService | null = null;

/**
 * Media type definitions
 * Structure: { typeId: MediaTypeDefinition, ... }
 */
const mediaTypes: Record<string, MediaTypeDefinition> = {};

/**
 * Configuration
 */
let config: MediaLibraryConfig = {
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
// INITIALIZATION
// ============================================

/**
 * Initialize the media library system
 *
 * @param options - Initialization options
 */
export function init(options: MediaLibraryInitOptions = {}): void {
  baseDir = options.baseDir ?? null;
  mediaService = options.media ?? null;
  contentService = options.content ?? null;
  imageStylesService = options.imageStyles ?? null;
  hooksService = options.hooks ?? null;

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
function registerMediaContentType(): void {
  if (!contentService) return;

  // Check if already registered
  if (contentService.hasType && contentService.hasType(config.contentType)) {
    return;
  }

  // Register via content service
  if (contentService.registerType) {
    contentService.registerType(config.contentType, {
      name: { type: 'string', required: true },
      mediaType: { type: 'string', required: true },
      filename: { type: 'string', required: true },
      path: { type: 'string', required: true },
      mimeType: { type: 'string' },
      size: { type: 'number' },
      metadata: { type: 'object' },
      thumbnail: { type: 'string' },
      tags: { type: 'array' },
      alt: { type: 'string' },
      caption: { type: 'string' },
      credit: { type: 'string' },
    }, 'core:media-library');
  }
}

// ============================================
// BUILT-IN MEDIA TYPES
// ============================================

/**
 * Register built-in media type definitions
 */
function registerBuiltinMediaTypes(): void {
  // Image
  mediaTypes['image'] = {
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
  mediaTypes['video'] = {
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
  mediaTypes['audio'] = {
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
  mediaTypes['document'] = {
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
  mediaTypes['remote_video'] = {
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
 * @param typeDefinition - Type definition
 * @returns Registered type definition
 */
export function registerMediaType(typeDefinition: Partial<MediaTypeDefinition> & { id: string }): MediaTypeDefinition {
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

  return mediaTypes[typeDefinition.id]!;
}

/**
 * Get a media type definition
 *
 * @param id - Type ID
 * @returns Type definition or null
 */
export function getMediaType(id: string): MediaTypeDefinition | null {
  return mediaTypes[id] ?? null;
}

/**
 * List all media types
 *
 * @returns Array of type definitions
 */
export function listMediaTypes(): MediaTypeDefinition[] {
  return Object.values(mediaTypes);
}

/**
 * Detect media type from file extension or MIME type
 *
 * @param filename - File name or path
 * @param mimeType - MIME type (optional)
 * @returns Media type ID or null
 */
export function detectMediaType(filename: string, mimeType: string | null = null): string | null {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';

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
 * @param file - Uploaded file data
 * @param options - Additional options
 * @returns Created media entity
 */
export async function createFromUpload(file: UploadFileInput, options: CreateOptions = {}): Promise<MediaEntity> {
  if (!contentService) {
    throw new Error('Content service not available');
  }

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
    throw new Error(`File too large: ${file.size} bytes (max: ${config.maxFileSize})`);
  }

  // Fire before hook
  if (hooksService) {
    await hooksService.trigger('media-library:beforeCreate', { file, options, mediaType });
  }

  // Upload file via media service
  let uploadResult: { path: string };
  if (mediaService && mediaService.upload) {
    uploadResult = await mediaService.upload(file.data, file.filename, {
      mimeType: file.mimeType,
    });
  } else {
    throw new Error('Media service not available');
  }

  // Extract metadata for images
  let metadata: Record<string, unknown> = options.metadata || {};
  if (mediaType === 'image') {
    // Could integrate with image-size or sharp for dimensions
    metadata = {
      ...metadata,
      width: options.width || null,
      height: options.height || null,
    };
  }

  // Generate thumbnail for images
  let thumbnail: string | null = null;
  if (mediaType === 'image' && imageStylesService) {
    try {
      if (imageStylesService.generate) {
        thumbnail = await imageStylesService.generate(
          uploadResult.path,
          config.thumbnailStyle
        );
      }
    } catch (e: unknown) {
      console.warn('[media-library] Thumbnail generation failed:', e instanceof Error ? e.message : String(e));
    }
  }

  // Create media entity
  const entity: Record<string, unknown> = {
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
 * @param url - Video URL (YouTube, Vimeo, etc.)
 * @param options - Additional options
 * @returns Created media entity
 */
export async function createFromUrl(url: string, options: CreateFromUrlOptions = {}): Promise<MediaEntity> {
  if (!contentService) {
    throw new Error('Content service not available');
  }

  // Parse video URL
  const videoInfo = parseVideoUrl(url);
  if (!videoInfo) {
    throw new Error('Unsupported video URL');
  }

  // Fire before hook
  if (hooksService) {
    await hooksService.trigger('media-library:beforeCreate', { url, options, mediaType: 'remote_video' });
  }

  // Create media entity
  const entity: Record<string, unknown> = {
    name: options.name || `${videoInfo.provider} video`,
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
    },
    thumbnail: videoInfo.thumbnailUrl || null,
    tags: options.tags || [],
    alt: options.alt || '',
    caption: options.caption || '',
    credit: options.credit || videoInfo.provider,
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
 * @param url - Video URL
 * @returns Video info or null
 */
function parseVideoUrl(url: string): VideoInfo | null {
  // YouTube
  const youtubeMatch = url.match(
    /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/
  );
  if (youtubeMatch) {
    const videoId = youtubeMatch[1] ?? '';
    return {
      provider: 'youtube',
      videoId,
      embedUrl: `https://www.youtube.com/embed/${videoId}`,
      thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    };
  }

  // Vimeo
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) {
    const videoId = vimeoMatch[1] ?? '';
    return {
      provider: 'vimeo',
      videoId,
      embedUrl: `https://player.vimeo.com/video/${videoId}`,
      thumbnailUrl: null, // Vimeo requires API call for thumbnail
    };
  }

  return null;
}

/**
 * Get a media entity by ID
 *
 * @param id - Entity ID
 * @returns Media entity or null
 */
export function get(id: string): MediaEntity | null {
  if (!contentService) return null;
  return contentService.read(config.contentType, id);
}

/**
 * Update a media entity
 *
 * @param id - Entity ID
 * @param updates - Fields to update
 * @returns Updated media entity
 */
export async function update(id: string, updates: Record<string, unknown>): Promise<MediaEntity> {
  if (!contentService) {
    throw new Error('Content service not available');
  }

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
 * @param id - Entity ID
 * @param options - Delete options
 * @returns True if deleted
 */
export async function remove(id: string, options: DeleteOptions = {}): Promise<boolean> {
  if (!contentService) {
    throw new Error('Content service not available');
  }

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
      if (mediaService.delete) {
        await mediaService.delete(entity.path);
      }
    } catch (e: unknown) {
      console.warn('[media-library] Failed to delete file:', e instanceof Error ? e.message : String(e));
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
 * @param options - Query options
 * @returns Filtered list
 */
export function list(options: ListOptions = {}): { items: MediaEntity[] } {
  if (!contentService) {
    return { items: [] };
  }

  const queryOptions: Record<string, unknown> = {
    page: options.page || 1,
    limit: options.limit || 20,
    sort: options.sort || 'created',
    order: options.order || 'desc',
    filters: [] as Array<{ field: string; op: string; value: string }>,
  };

  if (options.mediaType) {
    (queryOptions['filters'] as Array<{ field: string; op: string; value: string }>).push({
      field: 'mediaType',
      op: 'eq',
      value: options.mediaType,
    });
  }

  if (options.search) {
    queryOptions['search'] = options.search;
  }

  // Note: Tag filtering would need content service enhancement
  // or post-query filtering

  return contentService.list(config.contentType, queryOptions);
}

// ============================================
// USAGE TRACKING
// ============================================

/**
 * Track where a media entity is used
 *
 * @param mediaId - Media entity ID
 * @param contentType - Referencing content type
 * @param contentId - Referencing content ID
 * @param field - Field name that references the media
 */
export async function trackUsage(mediaId: string, contentType: string, contentId: string, field: string): Promise<void> {
  const entity = get(mediaId);
  if (!entity) return;

  // Get or initialize usage array
  const usage: UsageReference[] = entity._usage || [];

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
 * @param mediaId - Media entity ID
 * @param contentType - Referencing content type
 * @param contentId - Referencing content ID
 */
export async function removeUsage(mediaId: string, contentType: string, contentId: string): Promise<void> {
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
 * @param mediaId - Media entity ID
 * @returns Array of usage references
 */
export function getUsage(mediaId: string): UsageReference[] {
  const entity = get(mediaId);
  if (!entity) return [];
  return entity._usage || [];
}

/**
 * Check if a media entity is in use
 *
 * @param mediaId - Media entity ID
 * @returns Whether the entity is in use
 */
export function isInUse(mediaId: string): boolean {
  const usage = getUsage(mediaId);
  return usage.length > 0;
}

// ============================================
// URL AND PATH HELPERS
// ============================================

/**
 * Get the public URL for a media entity
 *
 * @param mediaOrId - Media entity or ID
 * @param style - Image style (for images)
 * @returns URL or null
 */
export function getUrl(mediaOrId: string | MediaEntity, style: string | null = null): string | null {
  const entity = typeof mediaOrId === 'string' ? get(mediaOrId) : mediaOrId;
  if (!entity) return null;

  // Remote video
  if (entity.mediaType === 'remote_video') {
    return (entity.metadata?.url as string) || null;
  }

  // Image with style
  if (style && entity.mediaType === 'image' && imageStylesService) {
    if (imageStylesService.getUrl) {
      return imageStylesService.getUrl(entity.path, style);
    }
  }

  // Default path
  return `/media/${entity.path}`;
}

/**
 * Get thumbnail URL for a media entity
 *
 * @param mediaOrId - Media entity or ID
 * @returns Thumbnail URL or null
 */
export function getThumbnailUrl(mediaOrId: string | MediaEntity): string | null {
  const entity = typeof mediaOrId === 'string' ? get(mediaOrId) : mediaOrId;
  if (!entity) return null;

  // Use stored thumbnail
  if (entity.thumbnail) {
    return entity.thumbnail;
  }

  // For remote videos, use the thumbnail URL from metadata
  if (entity.mediaType === 'remote_video' && entity.metadata?.thumbnailUrl) {
    return entity.metadata.thumbnailUrl as string;
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
 * @param mediaOrId - Media entity or ID
 * @param options - Embed options
 * @returns Embed HTML or null
 */
export function getEmbed(mediaOrId: string | MediaEntity, options: EmbedOptions = {}): string | null {
  const entity = typeof mediaOrId === 'string' ? get(mediaOrId) : mediaOrId;
  if (!entity || entity.mediaType !== 'remote_video') return null;

  const width = options.width || 560;
  const height = options.height || 315;
  const embedUrl = entity.metadata?.embedUrl as string | undefined;

  if (!embedUrl) return null;

  return `<iframe width="${width}" height="${height}" src="${embedUrl}" frameborder="0" allowfullscreen></iframe>`;
}

// ============================================
// BROWSER WIDGET DATA
// ============================================

/**
 * Get data for the media browser widget
 *
 * @param options - Browser options
 * @returns Browser widget data
 */
export function getBrowserData(options: BrowserOptions = {}): BrowserData {
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
 * @param ids - Entity IDs
 * @param updates - Updates to apply
 * @returns Number of updated entities
 */
export async function bulkUpdate(ids: string[], updates: Record<string, unknown>): Promise<number> {
  let count = 0;

  for (const id of ids) {
    try {
      await update(id, updates);
      count++;
    } catch (e: unknown) {
      console.warn(`[media-library] Failed to update ${id}:`, e instanceof Error ? e.message : String(e));
    }
  }

  return count;
}

/**
 * Bulk delete media entities
 *
 * @param ids - Entity IDs
 * @param options - Delete options
 * @returns Number of deleted entities
 */
export async function bulkDelete(ids: string[], options: DeleteOptions = {}): Promise<number> {
  let count = 0;

  for (const id of ids) {
    try {
      await remove(id, options);
      count++;
    } catch (e: unknown) {
      console.warn(`[media-library] Failed to delete ${id}:`, e instanceof Error ? e.message : String(e));
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
 * @returns Statistics object
 */
export function getStats(): MediaLibraryStats {
  const allMedia = list({ limit: 10000 });
  const items = allMedia.items || [];

  const stats: MediaLibraryStats = {
    total: items.length,
    byType: {},
    totalSize: 0,
    recentlyAdded: 0,
  };

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  for (const item of items) {
    // Count by type
    stats.byType[item.mediaType] = (stats.byType[item.mediaType] ?? 0) + 1;

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
 * @returns Current configuration copy
 */
export function getConfig(): MediaLibraryConfig {
  return { ...config };
}

/**
 * Check if media library is enabled
 *
 * @returns Whether the library is enabled
 */
export function isEnabled(): boolean {
  return config.enabled;
}
