/**
 * media.js - Media Upload and File Handling System
 *
 * WHY THIS EXISTS:
 * =================
 * Content management isn't complete without media handling. This module
 * provides file upload capabilities while maintaining our zero-dependency
 * philosophy by implementing multipart/form-data parsing from scratch.
 *
 * MULTIPART/FORM-DATA PRIMER:
 * ===========================
 * When a browser uploads files, it uses the multipart/form-data encoding.
 * This format looks like:
 *
 *   POST /upload HTTP/1.1
 *   Content-Type: multipart/form-data; boundary=----WebKitFormBoundary7MA4YWxk
 *
 *   ------WebKitFormBoundary7MA4YWxk
 *   Content-Disposition: form-data; name="title"
 *
 *   My Photo
 *   ------WebKitFormBoundary7MA4YWxk
 *   Content-Disposition: form-data; name="file"; filename="photo.jpg"
 *   Content-Type: image/jpeg
 *
 *   <binary file data here>
 *   ------WebKitFormBoundary7MA4YWxk--
 *
 * KEY CONCEPTS:
 * - Boundary: A unique string separating parts (from Content-Type header)
 * - Each part has headers (Content-Disposition, optional Content-Type)
 * - Parts without filename are regular form fields
 * - Parts with filename are file uploads
 * - Final boundary ends with -- (double dash)
 *
 * FILE STORAGE STRATEGY:
 * ======================
 * Files are stored in: /media/<year>/<month>/<timestamp>-<originalname>
 *
 * Why this structure:
 * - Year/month directories prevent single-directory bloat
 * - Timestamp prefix ensures uniqueness
 * - Original filename preserved for human readability
 * - Easy to browse and backup by date
 *
 * Example: /media/2024/01/1705123456789-vacation-photo.jpg
 *
 * SECURITY CONSIDERATIONS:
 * ========================
 * - File extension whitelist (not blacklist) - only allow known safe types
 * - Size limits prevent disk exhaustion attacks
 * - Filename sanitization removes path traversal attempts
 * - No execution permissions on upload directory
 * - MIME type validation (basic - checks extension, not magic bytes)
 *
 * LIMITATIONS:
 * ============
 * - No image resizing (would require sharp/imagemagick)
 * - No virus scanning (would require external service)
 * - Synchronous file writes (fine for small files)
 * - In-memory parsing (files buffered in RAM during parse)
 */

import { writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

// ===========================================
// Configuration
// ===========================================

/**
 * Base directory for media storage
 * Set during init()
 */
let mediaDir = null;

/**
 * Maximum file size in bytes
 * Default: 10MB (configurable via init)
 */
let maxFileSize = 10 * 1024 * 1024;

/**
 * Allowed file extensions (lowercase, with dot)
 *
 * WHY WHITELIST:
 * - Blacklists are incomplete (new dangerous extensions emerge)
 * - Whitelists are explicit about what's allowed
 * - Easier to audit and understand
 */
const ALLOWED_EXTENSIONS = {
  // Images
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  // Videos
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.m4v': 'video/x-m4v',
  // Documents
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  // Data
  '.json': 'application/json',
  '.csv': 'text/csv',
};

/**
 * Image extensions for thumbnail/preview handling
 */
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

/**
 * Video extensions for video player handling
 */
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v'];

// ===========================================
// Initialization
// ===========================================

/**
 * Initialize media system
 *
 * @param {string} baseDir - Project root directory
 * @param {Object} config - Media configuration
 * @param {number} config.maxFileSize - Maximum file size in bytes
 */
export function init(baseDir, config = {}) {
  mediaDir = join(baseDir, 'media');

  // Apply configuration
  if (config.maxFileSize) {
    maxFileSize = config.maxFileSize;
  }

  // Ensure media directory exists
  if (!existsSync(mediaDir)) {
    mkdirSync(mediaDir, { recursive: true });
  }
}

// ===========================================
// Multipart Parser
// ===========================================

/**
 * Parse multipart/form-data request
 *
 * This is a zero-dependency implementation of multipart parsing.
 * It handles both regular form fields and file uploads.
 *
 * @param {http.IncomingMessage} req - HTTP request object
 * @returns {Promise<{ fields: Object, files: Array }>}
 *
 * IMPLEMENTATION NOTES:
 * ---------------------
 * 1. Extract boundary from Content-Type header
 * 2. Buffer the entire request body (limited by maxFileSize)
 * 3. Split by boundary markers
 * 4. Parse each part's headers and content
 * 5. Separate fields (no filename) from files (has filename)
 *
 * WHY BUFFER ENTIRE BODY:
 * - Simpler implementation than streaming
 * - File size limit prevents memory issues
 * - Works fine for files under ~50MB
 * - Streaming parser would be much more complex
 *
 * @example
 * const { fields, files } = await parseUpload(req);
 * console.log(fields.title);    // "My Photo"
 * console.log(files[0].name);   // "photo.jpg"
 * console.log(files[0].data);   // Buffer
 */
export function parseUpload(req) {
  return new Promise((resolve, reject) => {
    // Extract boundary from Content-Type header
    // Format: multipart/form-data; boundary=----WebKitFormBoundary...
    const contentType = req.headers['content-type'] || '';

    if (!contentType.includes('multipart/form-data')) {
      reject(new Error('Content-Type must be multipart/form-data'));
      return;
    }

    // Extract boundary string
    // The boundary in the body is prefixed with -- (two dashes)
    const boundaryMatch = contentType.match(/boundary=(.+)$/);
    if (!boundaryMatch) {
      reject(new Error('No boundary found in Content-Type header'));
      return;
    }

    const boundary = boundaryMatch[1].trim();
    // Remove quotes if present
    const cleanBoundary = boundary.replace(/^["']|["']$/g, '');

    // Buffer to collect request body
    const chunks = [];
    let totalSize = 0;

    req.on('data', (chunk) => {
      totalSize += chunk.length;

      // Enforce size limit
      if (totalSize > maxFileSize) {
        reject(new Error(`File too large. Maximum size is ${Math.round(maxFileSize / 1024 / 1024)}MB`));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on('error', reject);

    req.on('end', () => {
      try {
        // Combine all chunks into single buffer
        const body = Buffer.concat(chunks);

        // Parse the multipart data
        const result = parseMultipartBody(body, cleanBoundary);
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
  });
}

/**
 * Parse the multipart body buffer
 *
 * @param {Buffer} body - Complete request body
 * @param {string} boundary - Boundary string (without --)
 * @returns {{ fields: Object, files: Array }}
 *
 * PARSING ALGORITHM:
 * ------------------
 * 1. Split body by boundary markers
 * 2. Skip first part (empty, before first boundary)
 * 3. Skip last part (empty or just --, after final boundary)
 * 4. For each middle part:
 *    a. Split by \r\n\r\n to separate headers from content
 *    b. Parse Content-Disposition header for name and filename
 *    c. If filename exists, it's a file; otherwise, it's a field
 */
function parseMultipartBody(body, boundary) {
  const fields = {};
  const files = [];

  // Boundary in body is prefixed with --
  const boundaryBuffer = Buffer.from('--' + boundary);

  // Find all boundary positions
  const parts = [];
  let searchStart = 0;

  while (true) {
    const boundaryPos = body.indexOf(boundaryBuffer, searchStart);
    if (boundaryPos === -1) break;

    // Find end of this part (next boundary or end of body)
    const nextBoundaryPos = body.indexOf(boundaryBuffer, boundaryPos + boundaryBuffer.length);

    if (nextBoundaryPos === -1) {
      // Last part - content ends at body end minus trailing CRLF
      parts.push({
        start: boundaryPos + boundaryBuffer.length,
        end: body.length,
      });
      break;
    } else {
      parts.push({
        start: boundaryPos + boundaryBuffer.length,
        end: nextBoundaryPos,
      });
      searchStart = nextBoundaryPos;
    }
  }

  // Process each part
  for (const part of parts) {
    // Extract part content
    let partContent = body.slice(part.start, part.end);

    // Remove leading CRLF after boundary
    if (partContent[0] === 0x0d && partContent[1] === 0x0a) {
      partContent = partContent.slice(2);
    }

    // Remove trailing CRLF before next boundary
    if (partContent[partContent.length - 2] === 0x0d && partContent[partContent.length - 1] === 0x0a) {
      partContent = partContent.slice(0, -2);
    }

    // Check if this is the end marker
    if (partContent.length < 10) continue;

    // Find header/content separator (double CRLF)
    const separatorPos = findDoubleCRLF(partContent);
    if (separatorPos === -1) continue;

    // Parse headers
    const headersBuffer = partContent.slice(0, separatorPos);
    const contentBuffer = partContent.slice(separatorPos + 4); // Skip \r\n\r\n

    const headers = parsePartHeaders(headersBuffer.toString('utf-8'));

    // Extract name and filename from Content-Disposition
    // Format: form-data; name="fieldname"; filename="file.jpg"
    const disposition = headers['content-disposition'] || '';
    const nameMatch = disposition.match(/name="([^"]+)"/);
    const filenameMatch = disposition.match(/filename="([^"]+)"/);

    if (!nameMatch) continue;

    const name = nameMatch[1];

    if (filenameMatch) {
      // This is a file upload
      const filename = filenameMatch[1];
      const contentType = headers['content-type'] || 'application/octet-stream';

      files.push({
        fieldName: name,
        name: sanitizeFilename(filename),
        originalName: filename,
        type: contentType,
        size: contentBuffer.length,
        data: contentBuffer,
      });
    } else {
      // This is a regular form field
      fields[name] = contentBuffer.toString('utf-8');
    }
  }

  return { fields, files };
}

/**
 * Find position of double CRLF (\r\n\r\n) in buffer
 *
 * @param {Buffer} buffer
 * @returns {number} Position or -1 if not found
 */
function findDoubleCRLF(buffer) {
  for (let i = 0; i < buffer.length - 3; i++) {
    if (buffer[i] === 0x0d && buffer[i + 1] === 0x0a &&
        buffer[i + 2] === 0x0d && buffer[i + 3] === 0x0a) {
      return i;
    }
  }
  return -1;
}

/**
 * Parse part headers from string
 *
 * @param {string} headerStr - Headers as string
 * @returns {Object} Parsed headers (lowercase keys)
 */
function parsePartHeaders(headerStr) {
  const headers = {};
  const lines = headerStr.split('\r\n');

  for (const line of lines) {
    const colonPos = line.indexOf(':');
    if (colonPos > 0) {
      const key = line.slice(0, colonPos).trim().toLowerCase();
      const value = line.slice(colonPos + 1).trim();
      headers[key] = value;
    }
  }

  return headers;
}

/**
 * Sanitize filename for safe filesystem storage
 *
 * WHY SANITIZE:
 * - Prevent path traversal (../)
 * - Remove special characters that cause issues
 * - Ensure cross-platform compatibility
 *
 * @param {string} filename - Original filename
 * @returns {string} Sanitized filename
 */
function sanitizeFilename(filename) {
  return filename
    // Remove path components (keep only filename)
    .replace(/^.*[\\\/]/, '')
    // Remove null bytes
    .replace(/\0/g, '')
    // Replace spaces with dashes
    .replace(/\s+/g, '-')
    // Remove special characters except dots, dashes, underscores
    .replace(/[^a-zA-Z0-9.\-_]/g, '')
    // Collapse multiple dashes
    .replace(/-+/g, '-')
    // Remove leading/trailing dashes
    .replace(/^-|-$/g, '')
    // Limit length
    .slice(0, 200);
}

// ===========================================
// File Storage
// ===========================================

/**
 * Save an uploaded file to the media directory
 *
 * @param {Object} file - File object from parseUpload()
 * @param {Object} options - Save options
 * @param {string} options.directory - Custom subdirectory
 * @returns {{ path: string, relativePath: string, filename: string, size: number, type: string }}
 *
 * FILE NAMING:
 * - Prefix with timestamp for uniqueness
 * - Preserve original extension
 * - Store in year/month subdirectories
 *
 * @example
 * const { files } = await parseUpload(req);
 * const saved = saveFile(files[0]);
 * // saved.path = '/absolute/path/to/media/2024/01/1705123456789-photo.jpg'
 * // saved.relativePath = '2024/01/1705123456789-photo.jpg'
 */
export function saveFile(file, options = {}) {
  // Validate file extension
  const ext = extname(file.name).toLowerCase();
  if (!ALLOWED_EXTENSIONS[ext]) {
    throw new Error(`File type not allowed: ${ext}. Allowed types: ${Object.keys(ALLOWED_EXTENSIONS).join(', ')}`);
  }

  // Validate file size
  if (file.size > maxFileSize) {
    throw new Error(`File too large: ${Math.round(file.size / 1024 / 1024)}MB. Maximum: ${Math.round(maxFileSize / 1024 / 1024)}MB`);
  }

  // Determine storage directory
  const now = new Date();
  const year = now.getFullYear().toString();
  const month = String(now.getMonth() + 1).padStart(2, '0');

  const subDir = options.directory || `${year}/${month}`;
  const targetDir = join(mediaDir, subDir);

  // Ensure directory exists
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  // Generate unique filename
  const timestamp = Date.now();
  const safeName = file.name || 'upload';
  const filename = `${timestamp}-${safeName}`;
  const absolutePath = join(targetDir, filename);
  const relativePath = `${subDir}/${filename}`;

  // SVG sanitization: strip dangerous elements (script, event handlers, foreign objects)
  let fileData = file.data;
  if (ext === '.svg') {
    let svgContent = typeof fileData === 'string' ? fileData : fileData.toString('utf-8');
    // Remove script tags and their content
    svgContent = svgContent.replace(/<script[\s\S]*?<\/script>/gi, '');
    // Remove event handler attributes (onclick, onload, onerror, etc.)
    svgContent = svgContent.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, '');
    // Remove javascript: URLs
    svgContent = svgContent.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"');
    svgContent = svgContent.replace(/xlink:href\s*=\s*["']javascript:[^"']*["']/gi, 'xlink:href="#"');
    // Remove foreignObject (can embed HTML/JS)
    svgContent = svgContent.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
    // Remove use elements pointing to external resources
    svgContent = svgContent.replace(/<use[^>]+href\s*=\s*["']https?:\/\/[^"']*["'][^>]*\/?>/gi, '');
    fileData = Buffer.from(svgContent, 'utf-8');
  }

  // Write file
  writeFileSync(absolutePath, fileData);

  return {
    path: absolutePath,
    relativePath,
    filename,
    size: fileData.length || file.size,
    type: getMimeType(filename),
  };
}

/**
 * Delete a file from the media directory
 *
 * @param {string} relativePath - Path relative to media directory
 * @returns {boolean} True if deleted, false if not found
 *
 * SECURITY:
 * - Validates path stays within media directory
 * - Prevents path traversal attacks
 */
export function deleteFile(relativePath) {
  // Prevent path traversal
  if (relativePath.includes('..')) {
    throw new Error('Invalid path: path traversal not allowed');
  }

  const absolutePath = join(mediaDir, relativePath);

  // Ensure path is within media directory
  if (!absolutePath.startsWith(mediaDir)) {
    throw new Error('Invalid path: outside media directory');
  }

  if (!existsSync(absolutePath)) {
    return false;
  }

  try {
    unlinkSync(absolutePath);
    return true;
  } catch (error) {
    console.error(`[media] Failed to delete ${relativePath}: ${error.message}`);
    return false;
  }
}

/**
 * List files in the media directory
 *
 * @param {string} directory - Subdirectory to list (default: all)
 * @returns {Array<{ path: string, name: string, size: number, modified: Date, type: string, isImage: boolean }>}
 *
 * NOTE: This recursively lists all files. For large media libraries,
 * consider pagination or caching.
 */
export function listFiles(directory = '') {
  const targetDir = join(mediaDir, directory);

  if (!existsSync(targetDir)) {
    return [];
  }

  const files = [];

  function scanDir(dir, prefix = '') {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = join(dir, entry.name);

      if (entry.isDirectory()) {
        scanDir(absolutePath, relativePath);
      } else if (entry.isFile()) {
        const stats = statSync(absolutePath);
        files.push({
          path: relativePath,
          name: entry.name,
          size: stats.size,
          modified: stats.mtime,
          type: getMimeType(entry.name),
          isImage: isImageFile(entry.name),
        });
      }
    }
  }

  scanDir(targetDir);

  // Sort by modified date, newest first
  files.sort((a, b) => b.modified.getTime() - a.modified.getTime());

  return files;
}

/**
 * Get absolute path for a relative media path
 *
 * @param {string} relativePath - Path relative to media directory
 * @returns {string} Absolute filesystem path
 */
export function getFilePath(relativePath) {
  // Prevent path traversal
  if (relativePath.includes('..')) {
    throw new Error('Invalid path: path traversal not allowed');
  }

  return join(mediaDir, relativePath);
}

/**
 * Get the media directory path
 *
 * @returns {string} Absolute path to media directory
 */
export function getMediaDir() {
  return mediaDir;
}

// ===========================================
// MIME Type Handling
// ===========================================

/**
 * Get MIME type for a filename based on extension
 *
 * @param {string} filename - File name or path
 * @returns {string} MIME type or 'application/octet-stream' if unknown
 */
export function getMimeType(filename) {
  const ext = extname(filename).toLowerCase();
  return ALLOWED_EXTENSIONS[ext] || 'application/octet-stream';
}

/**
 * Check if a file is an image
 *
 * @param {string} filename - File name or path
 * @returns {boolean}
 */
export function isImageFile(filename) {
  const ext = extname(filename).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

/**
 * Check if a file is a video
 *
 * @param {string} filename - File name or path
 * @returns {boolean}
 */
export function isVideoFile(filename) {
  const ext = extname(filename).toLowerCase();
  return VIDEO_EXTENSIONS.includes(ext);
}

/**
 * Get the file type category
 *
 * @param {string} filename - File name or path
 * @returns {'image' | 'video' | 'document'} File type category
 */
export function getFileType(filename) {
  if (isImageFile(filename)) return 'image';
  if (isVideoFile(filename)) return 'video';
  return 'document';
}

/**
 * Check if a file extension is allowed
 *
 * @param {string} filename - File name or path
 * @returns {boolean}
 */
export function isAllowedType(filename) {
  const ext = extname(filename).toLowerCase();
  return ext in ALLOWED_EXTENSIONS;
}

/**
 * Get list of allowed extensions
 *
 * @returns {string[]} Array of allowed extensions (e.g., ['.jpg', '.png', ...])
 */
export function getAllowedExtensions() {
  return Object.keys(ALLOWED_EXTENSIONS);
}

/**
 * Get maximum file size
 *
 * @returns {number} Maximum file size in bytes
 */
export function getMaxFileSize() {
  return maxFileSize;
}

/**
 * Format file size for display
 *
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size (e.g., "1.5 MB")
 */
export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ===========================================
// Default Export
// ===========================================

export default {
  init,
  parseUpload,
  saveFile,
  deleteFile,
  listFiles,
  getFilePath,
  getMediaDir,
  getMimeType,
  isImageFile,
  isVideoFile,
  getFileType,
  isAllowedType,
  getAllowedExtensions,
  getMaxFileSize,
  formatFileSize,
};
