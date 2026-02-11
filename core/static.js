/**
 * static.js - Static File Serving
 *
 * WHY STATIC FILE SERVING:
 * ========================
 * A CMS needs to serve static assets like CSS, JavaScript, images, and fonts.
 * These files don't change per-request and can be served directly from disk.
 *
 * DESIGN DECISIONS:
 * ================
 *
 * 1. SEPARATE /public/ DIRECTORY
 *    Static files live in /public to clearly separate them from:
 *    - Application code (/core, /modules)
 *    - Content (/content)
 *    - Configuration (/config)
 *
 *    This separation:
 *    - Makes deployment clearer (copy /public to CDN)
 *    - Prevents accidental exposure of server code
 *    - Follows conventions (Express, Rails, etc.)
 *
 * 2. URL PREFIX /public/
 *    Static files are served under /public/* URLs:
 *    - /public/css/style.css → /public/css/style.css
 *    - /public/js/main.js → /public/js/main.js
 *
 *    Why not serve from root (/css/style.css)?
 *    - Explicit is better than implicit
 *    - No collision with dynamic routes
 *    - Easy to proxy/cache at CDN level
 *
 * 3. SECURITY: DIRECTORY TRAVERSAL PREVENTION
 *    Malicious requests might try:
 *    - /public/../config/site.json
 *    - /public/../../etc/passwd
 *
 *    We prevent this by:
 *    - Resolving the full path
 *    - Checking it starts with /public directory
 *    - Rejecting any path that escapes
 *
 * 4. MIME TYPES
 *    Browsers need Content-Type headers to handle files correctly.
 *    We map file extensions to MIME types.
 *    Unknown extensions get application/octet-stream (binary download).
 *
 * WHAT THIS DOESN'T DO:
 * ====================
 * - Caching headers (Cache-Control, ETag, Last-Modified)
 * - Compression (gzip, brotli)
 * - Range requests (partial content for video)
 * - Directory listings
 *
 * For production, consider:
 * - Nginx/Apache for static files
 * - CDN for global distribution
 * - Build tools for bundling/minification
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, extname, resolve, normalize } from 'node:path';

/**
 * MIME type mapping
 *
 * Maps file extensions to Content-Type headers.
 *
 * WHY THESE TYPES:
 * - html/css/js: Core web files
 * - json: API responses, config files
 * - Images: png, jpg, gif, svg for graphics
 * - ico: Favicons
 * - Fonts: woff, woff2, ttf for custom typography
 * - txt: Plain text files
 *
 * WHY NOT USE A LIBRARY:
 * - Zero dependencies philosophy
 * - We only need common web types
 * - Easy to extend if needed
 */
const MIME_TYPES = {
  // Text formats
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',

  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',

  // Videos
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.m4v': 'video/x-m4v',

  // Fonts
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'font/otf',

  // Other
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.map': 'application/json',  // Source maps
};

/**
 * Video extensions that support range requests
 */
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v'];

/**
 * Default MIME type for unknown extensions
 *
 * WHY octet-stream:
 * - Signals "binary data, download it"
 * - Safe fallback (won't execute as script)
 * - Browser will prompt to save file
 */
const DEFAULT_MIME_TYPE = 'application/octet-stream';

/**
 * Get MIME type for a file path
 *
 * @param {string} filePath - Path to file (uses extension)
 * @returns {string} - MIME type string
 *
 * @example
 * getMimeType('/public/css/style.css')  // 'text/css; charset=utf-8'
 * getMimeType('/public/logo.png')       // 'image/png'
 * getMimeType('/public/data.xyz')       // 'application/octet-stream'
 */
export function getMimeType(filePath) {
  const ext = extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || DEFAULT_MIME_TYPE;
}

/**
 * Check if a path is safe (doesn't escape the public directory)
 *
 * @param {string} publicDir - Absolute path to /public directory
 * @param {string} requestedPath - The resolved absolute path
 * @returns {boolean} - true if path is within publicDir
 *
 * SECURITY:
 * This is the critical security check. A path is safe only if
 * the resolved absolute path starts with the public directory.
 *
 * Attack examples this prevents:
 * - /public/../config/site.json → resolves outside /public
 * - /public/css/../../core/boot.js → resolves outside /public
 * - /public/%2e%2e/config/site.json → URL-decoded ..
 *
 * WHY resolve() + startsWith():
 * - resolve() normalizes the path (removes .., ., etc.)
 * - startsWith() ensures we're still in /public
 * - Simple and hard to get wrong
 */
function isPathSafe(publicDir, requestedPath) {
  // Normalize both paths to handle any edge cases
  const normalizedPublic = normalize(publicDir);
  const normalizedRequest = normalize(requestedPath);

  // The requested path must start with the public directory
  // We add a separator to prevent /publicOther from matching /public
  return normalizedRequest.startsWith(normalizedPublic + '/') ||
         normalizedRequest === normalizedPublic;
}

/**
 * Serve a static file
 *
 * @param {string} baseDir - Project root directory
 * @param {string} urlPath - URL path (e.g., '/public/css/style.css')
 * @param {http.ServerResponse} res - HTTP response object
 * @param {string} method - HTTP method (GET or HEAD)
 * @returns {boolean} - true if file was served, false if not found
 *
 * WHAT THIS DOES:
 * 1. Validates the URL path starts with /public/
 * 2. Constructs the file path
 * 3. Checks for directory traversal attacks
 * 4. Checks if file exists and is a file (not directory)
 * 5. Reads and serves the file with correct MIME type
 *
 * RETURN VALUE:
 * - Returns true if file was served (response sent)
 * - Returns false if file not found (caller should handle 404)
 *
 * WHY RETURN BOOLEAN:
 * Allows the server to fall back to route matching if static
 * file isn't found. This enables patterns like:
 * - Try static file
 * - If not found, try dynamic route
 * - If not found, return 404
 *
 * @example
 * if (serve(baseDir, '/public/style.css', res)) {
 *   // File was served
 * } else {
 *   // File not found, try routes
 * }
 */
export function serve(baseDir, urlPath, res, method = 'GET', req = null) {
  // Only handle /public/ URLs
  // WHY CHECK HERE:
  // Defense in depth - don't assume caller validated
  if (!urlPath.startsWith('/public/') && urlPath !== '/public') {
    return false;
  }

  // Convert URL path to file path
  // /public/css/style.css → <baseDir>/public/css/style.css
  //
  // WHY NOT STRIP /public/:
  // The URL structure mirrors the directory structure.
  // Less magic, easier to understand.
  const relativePath = urlPath.slice(1);  // Remove leading /
  const publicDir = join(baseDir, 'public');
  const filePath = resolve(baseDir, relativePath);

  // SECURITY CHECK: Prevent directory traversal
  // This is the most important security measure
  if (!isPathSafe(publicDir, filePath)) {
    // Log the attempt for security monitoring
    console.warn(`[static] Blocked directory traversal attempt: ${urlPath}`);
    return false;
  }

  // Check if file exists
  if (!existsSync(filePath)) {
    return false;
  }

  // Check if it's a file (not a directory)
  // WHY CHECK:
  // - Directories shouldn't be served
  // - Prevents accidental directory listing
  // - stat() would fail anyway on directory read
  let stats;
  try {
    stats = statSync(filePath);
    if (!stats.isFile()) {
      return false;
    }
  } catch (error) {
    // stat failed - file might have been deleted between exists and stat
    return false;
  }

  // Get MIME type
  const mimeType = getMimeType(filePath);
  const fileSize = stats.size;
  const ext = extname(filePath).toLowerCase();

  // Check if this is a video file that might need range requests
  const isVideo = VIDEO_EXTENSIONS.includes(ext);

  // Handle range requests for video files
  // WHY RANGE REQUESTS:
  // - Allows seeking in videos without downloading entire file
  // - Browser sends "Range: bytes=start-end" header
  // - Server responds with 206 Partial Content
  // - Essential for video playback UX
  if (isVideo && req && req.headers.range) {
    return serveRangeRequest(filePath, fileSize, mimeType, req, res);
  }

  // Read and serve the file (non-range request)
  try {
    const content = readFileSync(filePath);

    const headers = {
      'Content-Type': mimeType,
      'Content-Length': content.length,
    };

    // For video files, indicate that range requests are supported
    if (isVideo) {
      headers['Accept-Ranges'] = 'bytes';
    }

    res.writeHead(200, headers);

    // HEAD requests get headers only, no body
    // WHY CHECK METHOD:
    // HEAD is used to check content-type, size, etc. without downloading.
    // Useful for browser caching, link validators, etc.
    if (method === 'HEAD') {
      res.end();
    } else {
      res.end(content);
    }

    return true;
  } catch (error) {
    // Read failed - permissions issue, file deleted, etc.
    console.error(`[static] Failed to read file ${filePath}: ${error.message}`);
    return false;
  }
}

/**
 * Serve a range request for video streaming
 *
 * @param {string} filePath - Absolute path to file
 * @param {number} fileSize - Total file size in bytes
 * @param {string} mimeType - MIME type
 * @param {http.IncomingMessage} req - HTTP request
 * @param {http.ServerResponse} res - HTTP response
 * @returns {boolean} - true if served
 *
 * RANGE REQUEST FORMAT:
 * Request: "Range: bytes=0-1023" (first 1024 bytes)
 * Response: 206 Partial Content
 *   Content-Range: bytes 0-1023/10000
 *   Content-Length: 1024
 *
 * WHY THIS MATTERS FOR VIDEO:
 * - User clicks to seek to middle of video
 * - Browser requests "Range: bytes=5000000-"
 * - Server sends only that portion
 * - Video plays from that point without waiting
 */
function serveRangeRequest(filePath, fileSize, mimeType, req, res) {
  const range = req.headers.range;

  // Parse range header
  // Format: "bytes=start-end" or "bytes=start-"
  const parts = range.replace(/bytes=/, '').split('-');
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

  // Validate range
  if (isNaN(start) || start < 0 || start >= fileSize) {
    // Invalid range - return 416 Range Not Satisfiable
    res.writeHead(416, {
      'Content-Range': `bytes */${fileSize}`,
    });
    res.end();
    return true;
  }

  // Clamp end to file size
  const clampedEnd = Math.min(end, fileSize - 1);
  const chunkSize = clampedEnd - start + 1;

  // Read just the requested portion
  // WHY NOT readFileSync:
  // - For large videos, reading entire file wastes memory
  // - We use createReadStream for efficiency
  const { createReadStream } = require('node:fs');
  const stream = createReadStream(filePath, { start, end: clampedEnd });

  res.writeHead(206, {
    'Content-Range': `bytes ${start}-${clampedEnd}/${fileSize}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': chunkSize,
    'Content-Type': mimeType,
  });

  stream.pipe(res);
  return true;
}

/**
 * Check if a URL path should be handled as static
 *
 * @param {string} urlPath - URL path to check
 * @returns {boolean} - true if path is for static files
 *
 * WHY SEPARATE FUNCTION:
 * Server.js can quickly check if a path is static
 * without going through the full serve() logic.
 */
export function isStaticPath(urlPath) {
  return urlPath.startsWith('/public/') || urlPath === '/public';
}

/**
 * EXTENDING STATIC FILE SERVING:
 *
 * To add more MIME types, add entries to MIME_TYPES object:
 *
 *   '.mp4': 'video/mp4',
 *   '.webm': 'video/webm',
 *
 * To add caching headers, modify the serve() function:
 *
 *   res.writeHead(200, {
 *     'Content-Type': mimeType,
 *     'Cache-Control': 'public, max-age=31536000',
 *     'ETag': computeETag(content),
 *   });
 *
 * To add compression, wrap the content:
 *
 *   const compressed = zlib.gzipSync(content);
 *   res.writeHead(200, {
 *     'Content-Encoding': 'gzip',
 *     ...
 *   });
 *
 * PRODUCTION RECOMMENDATIONS:
 * - Use Nginx/Apache for static files (faster, more features)
 * - Put static files on a CDN
 * - Enable HTTP/2 for multiplexing
 * - Use build tools to bundle and hash files
 */
