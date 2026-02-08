/**
 * oembed.js - oEmbed Discovery and Embedding System
 *
 * WHY THIS EXISTS:
 * Content often needs to embed external media (videos, tweets, etc.).
 * oEmbed is a standard protocol for fetching embeddable representations
 * of URLs without scraping or custom integrations per provider.
 *
 * FEATURES:
 * - Auto-discovery of oEmbed endpoints from HTML pages
 * - Built-in provider registry for major platforms
 * - Response caching to avoid repeated fetches
 * - Custom provider registration
 *
 * OEMBED PROTOCOL:
 * 1. Consumer (us) sends URL to provider's oEmbed endpoint
 * 2. Provider returns JSON with embed metadata and HTML
 * 3. We cache and render the HTML in templates
 *
 * SECURITY CONSIDERATIONS:
 * - Only fetch from registered/discovered oEmbed endpoints
 * - Sanitize HTML before rendering (XSS prevention)
 * - Respect provider rate limits via caching
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';

// Configuration
let enabled = true;
let cacheTtl = 604800;  // 7 days in seconds
let maxWidth = 800;
let maxHeight = 600;
let timeout = 10000;    // 10 second timeout
let contentDir = './content';

// Cache directory
let cacheDir = null;
let thumbnailCacheDir = null;

// Provider registry
// Structure: { name: { pattern: RegExp, endpoint: string, transform?: fn } }
const providers = new Map();

/**
 * Initialize the oEmbed system
 * @param {object} config - Configuration object
 */
export function init(config = {}) {
  if (config.enabled !== undefined) enabled = config.enabled;
  if (config.cacheTtl !== undefined) cacheTtl = config.cacheTtl;
  if (config.maxWidth !== undefined) maxWidth = config.maxWidth;
  if (config.maxHeight !== undefined) maxHeight = config.maxHeight;
  if (config.timeout !== undefined) timeout = config.timeout;
  if (config.contentDir !== undefined) contentDir = config.contentDir;

  // Set up cache directory
  cacheDir = path.join(contentDir, '.cache', 'oembed');
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  // Set up thumbnail cache directory in media folder (accessible via /media/*)
  thumbnailCacheDir = path.join(contentDir, '..', 'media', 'oembed-cache');
  if (!fs.existsSync(thumbnailCacheDir)) {
    fs.mkdirSync(thumbnailCacheDir, { recursive: true });
  }

  // Register built-in providers
  registerBuiltinProviders();

  // Register custom providers from config
  if (config.providers) {
    for (const [name, providerConfig] of Object.entries(config.providers)) {
      registerProvider(name, providerConfig.pattern, providerConfig.endpoint, providerConfig);
    }
  }

  console.log(`[oembed] Initialized (cache TTL: ${cacheTtl}s, providers: ${providers.size})`);
}

/**
 * Register built-in oEmbed providers
 */
function registerBuiltinProviders() {
  // YouTube
  registerProvider('youtube', [
    /https?:\/\/(?:www\.)?youtube\.com\/watch\?v=[\w-]+/,
    /https?:\/\/youtu\.be\/[\w-]+/,
    /https?:\/\/(?:www\.)?youtube\.com\/embed\/[\w-]+/,
    /https?:\/\/(?:www\.)?youtube\.com\/shorts\/[\w-]+/,
  ], 'https://www.youtube.com/oembed');

  // Vimeo
  registerProvider('vimeo', [
    /https?:\/\/(?:www\.)?vimeo\.com\/\d+/,
    /https?:\/\/player\.vimeo\.com\/video\/\d+/,
  ], 'https://vimeo.com/api/oembed.json');

  // Twitter/X
  registerProvider('twitter', [
    /https?:\/\/(?:www\.)?twitter\.com\/\w+\/status\/\d+/,
    /https?:\/\/(?:www\.)?x\.com\/\w+\/status\/\d+/,
  ], 'https://publish.twitter.com/oembed');

  // Instagram
  registerProvider('instagram', [
    /https?:\/\/(?:www\.)?instagram\.com\/p\/[\w-]+/,
    /https?:\/\/(?:www\.)?instagram\.com\/reel\/[\w-]+/,
  ], 'https://api.instagram.com/oembed');

  // SoundCloud
  registerProvider('soundcloud', [
    /https?:\/\/soundcloud\.com\/[\w-]+\/[\w-]+/,
  ], 'https://soundcloud.com/oembed');

  // Spotify
  registerProvider('spotify', [
    /https?:\/\/open\.spotify\.com\/(track|album|playlist|episode)\/[\w]+/,
  ], 'https://open.spotify.com/oembed');

  // CodePen
  registerProvider('codepen', [
    /https?:\/\/codepen\.io\/[\w-]+\/pen\/[\w]+/,
  ], 'https://codepen.io/api/oembed');

  // TikTok
  registerProvider('tiktok', [
    /https?:\/\/(?:www\.)?tiktok\.com\/@[\w.-]+\/video\/\d+/,
  ], 'https://www.tiktok.com/oembed');

  // Flickr
  registerProvider('flickr', [
    /https?:\/\/(?:www\.)?flickr\.com\/photos\/[\w@-]+\/\d+/,
  ], 'https://www.flickr.com/services/oembed/');

  // Giphy
  registerProvider('giphy', [
    /https?:\/\/giphy\.com\/gifs\/[\w-]+/,
    /https?:\/\/media\.giphy\.com\/media\/[\w]+\/giphy\.gif/,
  ], 'https://giphy.com/services/oembed');
}

/**
 * Register an oEmbed provider
 * @param {string} name - Provider name
 * @param {RegExp|RegExp[]} patterns - URL pattern(s) to match
 * @param {string} endpoint - oEmbed endpoint URL
 * @param {object} options - Additional options
 */
export function registerProvider(name, patterns, endpoint, options = {}) {
  const patternArray = Array.isArray(patterns) ? patterns : [patterns];

  providers.set(name, {
    name,
    patterns: patternArray,
    endpoint,
    format: options.format || 'json',
    transform: options.transform || null,
  });
}

/**
 * Get all registered providers
 * @returns {Array} Array of provider info
 */
export function getProviders() {
  const result = [];

  for (const [name, provider] of providers) {
    result.push({
      name,
      endpoint: provider.endpoint,
      patterns: provider.patterns.map(p => p.toString()),
    });
  }

  return result;
}

/**
 * Find provider for URL
 * @param {string} url - URL to check
 * @returns {object|null} Provider or null
 */
export function findProvider(url) {
  for (const [name, provider] of providers) {
    for (const pattern of provider.patterns) {
      if (pattern.test(url)) {
        return provider;
      }
    }
  }
  return null;
}

/**
 * Generate cache key from URL
 * @param {string} url - URL to hash
 * @returns {string} Cache key
 */
function getCacheKey(url) {
  return crypto.createHash('md5').update(url).digest('hex');
}

/**
 * Get cached embed data
 * @param {string} url - Original URL
 * @returns {object|null} Cached data or null
 */
function getFromCache(url) {
  if (!cacheDir) return null;

  const key = getCacheKey(url);
  const cachePath = path.join(cacheDir, `${key}.json`);

  if (!fs.existsSync(cachePath)) {
    return null;
  }

  try {
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));

    // Check if expired
    const fetchedAt = new Date(data.fetchedAt);
    const age = (Date.now() - fetchedAt.getTime()) / 1000;

    if (age > cacheTtl) {
      // Expired
      return null;
    }

    return data;
  } catch (error) {
    return null;
  }
}

/**
 * Save embed data to cache
 * @param {string} url - Original URL
 * @param {object} oembed - oEmbed response
 */
function saveToCache(url, oembed) {
  if (!cacheDir) return;

  const key = getCacheKey(url);
  const cachePath = path.join(cacheDir, `${key}.json`);

  const data = {
    url,
    oembed,
    fetchedAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(cachePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('[oembed] Cache write error:', error.message);
  }
}

/**
 * Make HTTP(S) request
 * @param {string} url - URL to fetch
 * @returns {Promise<object>} Response data
 */
function httpFetch(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'CMS-Core/1.0 oEmbed Client',
        'Accept': 'application/json',
      },
      timeout,
    };

    const req = client.request(options, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpFetch(res.headers.location).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

/**
 * Fetch HTML page for oEmbed discovery
 * @param {string} url - Page URL
 * @returns {Promise<string>} HTML content
 */
function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'CMS-Core/1.0 oEmbed Discovery',
        'Accept': 'text/html',
      },
      timeout,
    };

    const req = client.request(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchHtml(res.headers.location).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', chunk => {
        data += chunk;
        // Limit to first 50KB for discovery
        if (data.length > 50000) {
          req.destroy();
        }
      });
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

/**
 * Discover oEmbed endpoint from HTML page
 * @param {string} url - Page URL
 * @returns {Promise<string|null>} oEmbed endpoint URL or null
 */
export async function discoverEmbed(url) {
  try {
    const html = await fetchHtml(url);

    // Look for oEmbed link tags
    // <link rel="alternate" type="application/json+oembed" href="..." />
    const jsonMatch = html.match(/<link[^>]+type=["']application\/json\+oembed["'][^>]+href=["']([^"']+)["']/i);
    if (jsonMatch) {
      return jsonMatch[1].replace(/&amp;/g, '&');
    }

    // Also check for XML format
    const xmlMatch = html.match(/<link[^>]+type=["']text\/xml\+oembed["'][^>]+href=["']([^"']+)["']/i);
    if (xmlMatch) {
      return xmlMatch[1].replace(/&amp;/g, '&');
    }

    // Check alternate order (href before type)
    const altMatch = html.match(/<link[^>]+href=["']([^"']+)["'][^>]+type=["']application\/json\+oembed["']/i);
    if (altMatch) {
      return altMatch[1].replace(/&amp;/g, '&');
    }

    return null;
  } catch (error) {
    console.error('[oembed] Discovery error:', error.message);
    return null;
  }
}

/**
 * Download and cache thumbnail from URL
 * @param {string} thumbnailUrl - Thumbnail URL to download
 * @param {string} originalUrl - Original embed URL (for cache key)
 * @returns {Promise<string|null>} Local path to cached thumbnail or null
 */
async function downloadThumbnail(thumbnailUrl, originalUrl) {
  if (!thumbnailUrl || !thumbnailCacheDir) {
    return null;
  }

  try {
    // Generate filename from original URL hash + extension from thumbnail URL
    const hash = getCacheKey(originalUrl);
    const ext = path.extname(new URL(thumbnailUrl).pathname) || '.jpg';
    const filename = `thumb-${hash}${ext}`;
    const localPath = path.join(thumbnailCacheDir, filename);

    // Check if already cached
    if (fs.existsSync(localPath)) {
      return `/media/.cache/oembed/${filename}`;
    }

    // Download thumbnail
    const parsedUrl = new URL(thumbnailUrl);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': 'CMS-Core/1.0 oEmbed Thumbnail Fetcher',
        },
        timeout,
      };

      const req = client.request(options, (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          downloadThumbnail(res.headers.location, originalUrl).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        // Write to file
        const fileStream = fs.createWriteStream(localPath);
        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close();
          resolve(`/media/oembed-cache/${filename}`);
        });

        fileStream.on('error', (err) => {
          fs.unlink(localPath, () => {}); // Clean up partial file
          reject(err);
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Thumbnail download timeout'));
      });

      req.end();
    });
  } catch (error) {
    console.error('[oembed] Thumbnail download error:', error.message);
    return null;
  }
}

/**
 * Fetch oEmbed data for URL
 * @param {string} url - URL to embed
 * @param {object} options - Fetch options
 * @returns {Promise<object>} oEmbed response with metadata
 */
export async function fetchEmbed(url, options = {}) {
  if (!enabled) {
    throw new Error('oEmbed system is disabled');
  }

  const { skipCache = false, width, height } = options;

  // Check cache first
  if (!skipCache) {
    const cached = getFromCache(url);
    if (cached) {
      return {
        ...cached.oembed,
        url,
        cached: true,
        fetchedAt: cached.fetchedAt,
      };
    }
  }

  // Find registered provider
  let provider = findProvider(url);
  let endpoint = null;

  if (provider) {
    endpoint = provider.endpoint;
  } else {
    // Try auto-discovery
    endpoint = await discoverEmbed(url);
    if (!endpoint) {
      throw new Error('No oEmbed provider found for URL');
    }
  }

  // Build oEmbed request URL
  const oembedUrl = new URL(endpoint);
  oembedUrl.searchParams.set('url', url);
  oembedUrl.searchParams.set('format', 'json');

  if (width || maxWidth) {
    oembedUrl.searchParams.set('maxwidth', String(width || maxWidth));
  }
  if (height || maxHeight) {
    oembedUrl.searchParams.set('maxheight', String(height || maxHeight));
  }

  // Fetch oEmbed data
  const oembed = await httpFetch(oembedUrl.toString());

  // Validate response
  if (!oembed.type) {
    throw new Error('Invalid oEmbed response: missing type');
  }

  // Download and cache thumbnail if available
  if (oembed.thumbnail_url) {
    try {
      const localThumbnailPath = await downloadThumbnail(oembed.thumbnail_url, url);
      if (localThumbnailPath) {
        oembed.thumbnail_url_cached = localThumbnailPath;
        oembed.thumbnail_url_original = oembed.thumbnail_url;
      }
    } catch (error) {
      console.error('[oembed] Failed to cache thumbnail:', error.message);
      // Continue with remote thumbnail URL
    }
  }

  // Apply provider transform if any
  if (provider && provider.transform) {
    provider.transform(oembed);
  }

  // Cache the response
  saveToCache(url, oembed);

  return {
    ...oembed,
    url,
    cached: false,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Clear embed cache
 * @param {string} url - Specific URL to clear, or null for all
 * @returns {number} Number of entries cleared
 */
export function clearCache(url = null) {
  if (!cacheDir || !fs.existsSync(cacheDir)) {
    return 0;
  }

  if (url) {
    // Clear specific URL
    const key = getCacheKey(url);
    const cachePath = path.join(cacheDir, `${key}.json`);

    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
      return 1;
    }
    return 0;
  }

  // Clear all
  const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'));
  for (const file of files) {
    fs.unlinkSync(path.join(cacheDir, file));
  }
  return files.length;
}

/**
 * Get cache statistics
 * @returns {object} Cache stats
 */
export function getCacheStats() {
  if (!cacheDir || !fs.existsSync(cacheDir)) {
    return { entries: 0, size: 0, oldestEntry: null, newestEntry: null };
  }

  const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'));
  let totalSize = 0;
  let oldest = null;
  let newest = null;

  for (const file of files) {
    const filePath = path.join(cacheDir, file);
    const stat = fs.statSync(filePath);
    totalSize += stat.size;

    const mtime = stat.mtime.getTime();
    if (!oldest || mtime < oldest) oldest = mtime;
    if (!newest || mtime > newest) newest = mtime;
  }

  return {
    entries: files.length,
    size: totalSize,
    sizeFormatted: formatBytes(totalSize),
    oldestEntry: oldest ? new Date(oldest).toISOString() : null,
    newestEntry: newest ? new Date(newest).toISOString() : null,
  };
}

/**
 * Format bytes for display
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Validate embed field value
 * @param {object} value - Embed field value
 * @param {object} fieldDef - Field definition
 * @returns {object} Validation result
 */
export function validateEmbedField(value, fieldDef = {}) {
  if (!value || !value.url) {
    return { valid: false, error: 'URL is required' };
  }

  // Check URL format
  try {
    new URL(value.url);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  // Check provider whitelist if specified
  if (fieldDef.providers && fieldDef.providers.length > 0) {
    const provider = findProvider(value.url);
    if (!provider) {
      return { valid: false, error: 'URL not from allowed provider' };
    }
    if (!fieldDef.providers.includes(provider.name)) {
      return { valid: false, error: `Provider '${provider.name}' not allowed` };
    }
  }

  return { valid: true };
}

/**
 * Process embed field for storage
 * @param {string|object} value - URL string or embed object
 * @param {object} fieldDef - Field definition
 * @returns {Promise<object>} Processed embed data
 */
export async function processEmbedField(value, fieldDef = {}) {
  // Handle string input (just URL)
  if (typeof value === 'string') {
    value = { url: value };
  }

  // Validate
  const validation = validateEmbedField(value, fieldDef);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Fetch oEmbed data if not already present or stale
  const needsFetch = !value.oembed ||
    !value.fetchedAt ||
    (Date.now() - new Date(value.fetchedAt).getTime()) > cacheTtl * 1000;

  if (needsFetch) {
    try {
      const oembed = await fetchEmbed(value.url, {
        width: fieldDef.maxWidth,
        height: fieldDef.maxHeight,
      });

      return {
        url: value.url,
        oembed: {
          type: oembed.type,
          title: oembed.title,
          author_name: oembed.author_name,
          author_url: oembed.author_url,
          provider_name: oembed.provider_name,
          provider_url: oembed.provider_url,
          thumbnail_url: oembed.thumbnail_url,
          thumbnail_width: oembed.thumbnail_width,
          thumbnail_height: oembed.thumbnail_height,
          html: oembed.html,
          width: oembed.width,
          height: oembed.height,
        },
        fetchedAt: oembed.fetchedAt,
      };
    } catch (error) {
      // Store URL even if fetch fails
      return {
        url: value.url,
        oembed: null,
        error: error.message,
        fetchedAt: new Date().toISOString(),
      };
    }
  }

  return value;
}

/**
 * Render embed HTML
 * @param {object} embed - Embed field value
 * @param {object} options - Render options
 * @returns {string} HTML string
 */
export function renderEmbed(embed, options = {}) {
  if (!embed || !embed.url) {
    return '';
  }

  const { width, height, className = 'embed' } = options;

  // If we have cached oEmbed HTML, use it
  if (embed.oembed && embed.oembed.html) {
    let html = embed.oembed.html;

    // Optionally resize
    if (width) {
      html = html.replace(/width=["']\d+["']/g, `width="${width}"`);
    }
    if (height) {
      html = html.replace(/height=["']\d+["']/g, `height="${height}"`);
    }

    const type = embed.oembed.type || 'rich';
    return `<div class="${className} ${className}-${type}">${html}</div>`;
  }

  // If we have a thumbnail, show that with link
  if (embed.oembed && (embed.oembed.thumbnail_url_cached || embed.oembed.thumbnail_url)) {
    const title = embed.oembed.title || 'View content';
    const thumbnailSrc = embed.oembed.thumbnail_url_cached || embed.oembed.thumbnail_url;
    return `<div class="${className} ${className}-thumbnail">
      <a href="${escapeHtml(embed.url)}" target="_blank" rel="noopener">
        <img src="${escapeHtml(thumbnailSrc)}" alt="${escapeHtml(title)}" />
        <span class="embed-title">${escapeHtml(title)}</span>
      </a>
    </div>`;
  }

  // Fallback: just show link
  const title = embed.oembed?.title || embed.url;
  return `<div class="${className} ${className}-link">
    <a href="${escapeHtml(embed.url)}" target="_blank" rel="noopener">${escapeHtml(title)}</a>
  </div>`;
}

/**
 * Escape HTML entities
 */
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Get configuration
 * @returns {object} Current configuration
 */
export function getConfig() {
  return {
    enabled,
    cacheTtl,
    maxWidth,
    maxHeight,
    timeout,
    providerCount: providers.size,
  };
}

/**
 * Check if URL is supported
 * @param {string} url - URL to check
 * @returns {object} Support info
 */
export function checkSupport(url) {
  const provider = findProvider(url);

  return {
    supported: !!provider,
    provider: provider ? provider.name : null,
    discoverable: !provider, // Will try discovery if no provider
  };
}
