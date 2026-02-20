/**
 * Media Module
 *
 * Provides media upload and management functionality for the CMS.
 * Handles file uploads via both admin UI and API endpoints.
 */

import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { join, extname } from 'node:path';

/**
 * Content hook - register media content type
 */
export function hook_content(register, context) {
  // Media content type stores metadata about uploaded files
  register('media', {
    filename: { type: 'string', required: true },
    path: { type: 'string', required: true },
    mimetype: { type: 'string', required: true },
    size: { type: 'number', required: true },
    alt: { type: 'string', required: false },
  });
}

/**
 * Boot hook - initialize media system
 */
export async function hook_boot(context) {
  console.log('[media] Media module initialized');
}

/**
 * Middleware hook - serve media files
 */
export function hook_middleware(use, context) {
  const media = context.services.get('media');

  // Serve files from /media/*
  // Supports range requests for video streaming
  use(async (req, res, ctx, next) => {
    const url = req.url || '/';
    const path = url.split('?')[0];

    // Only handle GET requests for /media/*
    if (req.method !== 'GET') {
      await next();
      return;
    }

    // Get file path from URL
    const relativePath = path.slice(7); // Remove '/media/'

    if (!relativePath) {
      await next();
      return;
    }

    try {
      const absolutePath = media.getFilePath(relativePath);

      if (!existsSync(absolutePath)) {
        await next();
        return;
      }

      const stats = statSync(absolutePath);
      const fileSize = stats.size;
      const mimeType = media.getMimeType(absolutePath);
      const isVideo = media.isVideoFile(absolutePath);

      // Handle range requests for video files
      // WHY RANGE REQUESTS:
      // - Essential for video seeking without downloading entire file
      // - Browser sends "Range: bytes=start-end"
      // - Server responds with 206 Partial Content
      if (isVideo && req.headers.range) {
        const range = req.headers.range;
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        // Validate range
        if (isNaN(start) || start < 0 || start >= fileSize) {
          res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
          res.end();
          return;
        }

        const clampedEnd = Math.min(end, fileSize - 1);
        const chunkSize = clampedEnd - start + 1;

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${clampedEnd}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': mimeType,
          'Cache-Control': 'public, max-age=31536000',
        });

        const stream = createReadStream(absolutePath, { start, end: clampedEnd });
        stream.pipe(res);
        return;
      }

      // Serve full file (non-range request)
      const fileContent = readFileSync(absolutePath);

      const headers = {
        'Content-Type': mimeType,
        'Content-Length': fileContent.length,
        'Cache-Control': 'public, max-age=31536000',
      };

      // For video files, indicate range requests are supported
      if (isVideo) {
        headers['Accept-Ranges'] = 'bytes';
      }

      res.writeHead(200, headers);
      res.end(fileContent);
    } catch (error) {
      console.error(`[media] Error serving file: ${error.message}`);
      await next();
    }
  }, 'media-serve', '/media');
}

/**
 * Routes hook - register media routes
 */
export function hook_routes(register, context) {
  const server = context.services.get('server');
  const content = context.services.get('content');
  const template = context.services.get('template');
  const media = context.services.get('media');
  const auth = context.services.get('auth');

  /**
   * Render admin template with layout
   */
  function renderAdmin(templateName, data, ctx) {
    const templatePath = join(import.meta.dirname, 'templates', templateName);
    const templateContent = readFileSync(templatePath, 'utf-8');
    const rendered = template.renderString(templateContent, data);
    return template.renderWithLayout('layout.html', rendered, {
      ...data,
      siteName: ctx.config.site.name,
    });
  }

  /**
   * Format file size for display
   */
  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  /**
   * Format date for display
   */
  function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /**
   * Redirect helper
   */
  function redirect(res, url) {
    res.writeHead(302, { Location: url });
    res.end();
  }

  /**
   * Get flash message from URL
   */
  function getFlashMessage(url) {
    const urlObj = new URL(url, 'http://localhost');
    const success = urlObj.searchParams.get('success');
    const error = urlObj.searchParams.get('error');
    if (success) return { type: 'success', message: decodeURIComponent(success) };
    if (error) return { type: 'error', message: decodeURIComponent(error) };
    return null;
  }

  // ==========================================
  // Admin Routes
  // ==========================================

  /**
   * GET /admin/media - List uploaded media
   */
  register('GET', '/admin/media', async (req, res, params, ctx) => {
    const result = content.list('media', { limit: 50 });
    const items = result.items.map(item => ({
      ...item,
      sizeFormatted: formatSize(item.size),
      createdFormatted: formatDate(item.created),
      isImage: media.isImageFile(item.filename),
      isVideo: media.isVideoFile(item.filename),
      fileType: media.getFileType(item.filename),
      url: `/media/${item.path}`,
    }));

    const flash = getFlashMessage(req.url);

    const html = renderAdmin('media-list.html', {
      pageTitle: 'Media Library',
      items,
      hasItems: items.length > 0,
      totalCount: result.total,
      allowedTypes: media.getAllowedExtensions().join(', '),
      maxSize: formatSize(media.getMaxFileSize()),
      flash,
      hasFlash: !!flash,
    }, ctx);

    server.html(res, html);
  }, 'Media library');

  /**
   * GET /admin/media/upload - Upload form
   */
  register('GET', '/admin/media/upload', async (req, res, params, ctx) => {
    const flash = getFlashMessage(req.url);

    const html = renderAdmin('media-upload.html', {
      pageTitle: 'Upload Media',
      allowedTypes: media.getAllowedExtensions().join(', '),
      maxSize: formatSize(media.getMaxFileSize()),
      flash,
      hasFlash: !!flash,
    }, ctx);

    server.html(res, html);
  }, 'Upload form');

  /**
   * POST /admin/media/upload - Handle single or bulk file upload
   *
   * Accepts one or many files in a single multipart request.
   * For XHR/fetch callers: returns JSON with per-file results.
   * For HTML form callers: redirects back to media list.
   */
  register('POST', '/admin/media/upload', async (req, res, params, ctx) => {
    try {
      const { fields, files } = await media.parseUpload(req);

      if (files.length === 0) {
        // Detect XHR vs form submission
        const accept = req.headers['accept'] || '';
        if (accept.includes('application/json')) {
          server.json(res, { error: 'No file selected', results: [] }, 400);
        } else {
          redirect(res, '/admin/media/upload?error=' + encodeURIComponent('No file selected'));
        }
        return;
      }

      // Process all files in the request (supports bulk upload)
      const results = [];
      for (const file of files) {
        try {
          const saved = media.saveFile(file);
          await content.create('media', {
            filename: saved.filename,
            path: saved.relativePath,
            mimetype: saved.type,
            size: saved.size,
            alt: fields.alt || '',
          });
          results.push({ success: true, filename: file.originalName, path: saved.relativePath });
        } catch (err) {
          results.push({ success: false, filename: file.originalName, error: err.message });
        }
      }

      const successCount = results.filter(r => r.success).length;
      const accept = req.headers['accept'] || '';

      if (accept.includes('application/json')) {
        server.json(res, { results, uploaded: successCount, total: files.length });
      } else {
        const msg = successCount === 1
          ? `Uploaded: ${results[0].filename}`
          : `Uploaded ${successCount} of ${files.length} files`;
        redirect(res, '/admin/media?success=' + encodeURIComponent(msg));
      }
    } catch (error) {
      console.error('[media] Upload error:', error.message);
      const accept = req.headers['accept'] || '';
      if (accept.includes('application/json')) {
        server.json(res, { error: error.message, results: [] }, 500);
      } else {
        redirect(res, '/admin/media/upload?error=' + encodeURIComponent(error.message));
      }
    }
  }, 'Handle single or bulk upload');

  /**
   * POST /admin/media/:id/delete - Delete media
   */
  register('POST', '/admin/media/:id/delete', async (req, res, params, ctx) => {
    const { id } = params;

    // Get media item
    const item = content.read('media', id);

    if (!item) {
      redirect(res, '/admin/media?error=' + encodeURIComponent('Media not found'));
      return;
    }

    try {
      // Delete file from disk
      media.deleteFile(item.path);

      // Delete content entry
      await content.remove('media', id);

      redirect(res, '/admin/media?success=' + encodeURIComponent(`Deleted: ${item.filename}`));
    } catch (error) {
      console.error('[media] Delete error:', error.message);
      redirect(res, '/admin/media?error=' + encodeURIComponent(error.message));
    }
  }, 'Delete media');

  // ==========================================
  // API Routes
  // ==========================================

  /**
   * Check API permission helper
   */
  function checkApiPermission(req, res, permission) {
    if (!req.user) {
      server.json(res, { error: 'Unauthorized', message: 'Authentication required' }, 401);
      return false;
    }

    if (!auth.hasPermission(req.user, permission)) {
      server.json(res, { error: 'Forbidden', message: `Permission denied: ${permission}` }, 403);
      return false;
    }

    return true;
  }

  /**
   * GET /api/media - List media
   */
  register('GET', '/api/media', async (req, res, params, ctx) => {
    if (!checkApiPermission(req, res, 'content.read')) return;

    const url = new URL(req.url, 'http://localhost');
    const page = parseInt(url.searchParams.get('page')) || 1;
    const limit = parseInt(url.searchParams.get('limit')) || 20;

    const result = content.list('media', { page, limit });

    // Add URLs to items
    const items = result.items.map(item => ({
      ...item,
      url: `/media/${item.path}`,
    }));

    server.json(res, { ...result, items });
  }, 'API: List media');

  /**
   * POST /api/media - Upload media via API
   */
  register('POST', '/api/media', async (req, res, params, ctx) => {
    if (!checkApiPermission(req, res, 'content.create')) return;

    try {
      // Parse multipart form data
      const { fields, files } = await media.parseUpload(req);

      if (files.length === 0) {
        server.json(res, { error: 'Bad Request', message: 'No file provided' }, 400);
        return;
      }

      const file = files[0];

      // Save file to disk
      const saved = media.saveFile(file);

      // Create media content entry
      const mediaItem = await content.create('media', {
        filename: saved.filename,
        path: saved.relativePath,
        mimetype: saved.type,
        size: saved.size,
        alt: fields.alt || '',
      });

      // Add URL to response
      server.json(res, {
        ...mediaItem,
        url: `/media/${saved.relativePath}`,
      }, 201);
    } catch (error) {
      console.error('[media] API upload error:', error.message);
      server.json(res, { error: 'Upload Failed', message: error.message }, 400);
    }
  }, 'API: Upload media');

  /**
   * DELETE /api/media/:id - Delete media via API
   */
  register('DELETE', '/api/media/:id', async (req, res, params, ctx) => {
    if (!checkApiPermission(req, res, 'content.delete')) return;

    const { id } = params;

    // Get media item
    const item = content.read('media', id);

    if (!item) {
      server.json(res, { error: 'Not Found', message: 'Media not found' }, 404);
      return;
    }

    try {
      // Delete file from disk
      media.deleteFile(item.path);

      // Delete content entry
      await content.remove('media', id);

      server.json(res, { deleted: true, id });
    } catch (error) {
      console.error('[media] API delete error:', error.message);
      server.json(res, { error: 'Delete Failed', message: error.message }, 500);
    }
  }, 'API: Delete media');
}
