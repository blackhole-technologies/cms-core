/**
 * Link Substitution Service
 *
 * WHY THIS EXISTS:
 * ================
 * When content contains links to entities (content, media, users), we want to store
 * entity references rather than raw URLs. This ensures links remain valid even if:
 * - Entity URLs change (path alias updates)
 * - URL structure changes
 * - Entities are moved or renamed
 *
 * ARCHITECTURE:
 * =============
 * - Tokens format: {entity:type:id} (e.g., {entity:node:abc123})
 * - Substitution happens at render time, not storage time
 * - Caching prevents redundant entity lookups
 * - Graceful degradation for missing entities
 *
 * USAGE:
 * ======
 * const text = "Check out {entity:content:abc123} and {entity:user:xyz789}";
 * const rendered = await substituteLinks(text, services);
 * // Result: "Check out <a href='/content/abc123'>My Article</a> and <a href='/admin/users/xyz789'>John</a>"
 */

/**
 * Token pattern: {entity:type:id}
 * Matches: {entity:content:abc123}, {entity:user:xyz789}, etc.
 */
const ENTITY_TOKEN_PATTERN = /\{entity:(\w+):([^}]+)\}/g;

/**
 * In-memory cache for entity URLs
 * Key: "type:id", Value: { url, title, timestamp }
 */
const urlCache = new Map();
const CACHE_TTL = 60000; // 1 minute

/**
 * Create an entity token for storage
 * @param {string} entityType - Entity type (content, user, media)
 * @param {string} entityId - Entity ID
 * @returns {string} Token string
 */
export function createEntityToken(entityType, entityId) {
  return `{entity:${entityType}:${entityId}}`;
}

/**
 * Parse an entity token
 * @param {string} token - Token string
 * @returns {object|null} { type, id } or null if invalid
 */
export function parseEntityToken(token) {
  const match = token.match(/^\{entity:(\w+):([^}]+)\}$/);
  if (!match) return null;
  return {
    type: match[1],
    id: match[2]
  };
}

/**
 * Get entity URL from cache or fetch
 * @param {string} entityType - Entity type
 * @param {string} entityId - Entity ID
 * @param {object} services - Service container
 * @returns {Promise<object|null>} { url, title } or null
 */
async function getEntityUrl(entityType, entityId, services) {
  const cacheKey = `${entityType}:${entityId}`;

  // Check cache
  const cached = urlCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    return { url: cached.url, title: cached.title };
  }

  // Fetch entity
  let entity = null;
  let url = null;
  let title = null;

  try {
    switch (entityType) {
      case 'content':
      case 'node':
        const contentService = services.get('content');
        if (contentService) {
          entity = await contentService.getContent(entityId);
          if (entity) {
            url = `/content/${entity.type}/${entity.id}`;
            title = entity.title || 'Untitled';
          }
        }
        break;

      case 'user':
        const userService = services.get('users');
        if (userService) {
          entity = await userService.getUser(entityId);
          if (entity) {
            url = `/admin/users/${entity.id}`;
            title = entity.username || entity.email || 'Unknown user';
          }
        }
        break;

      case 'media':
        const mediaService = services.get('media');
        if (mediaService) {
          entity = await mediaService.getMedia(entityId);
          if (entity) {
            url = entity.url || `/media/${entity.id}`;
            title = entity.name || entity.filename || 'Media file';
          }
        }
        break;

      default:
        console.warn(`[linkit-substitution] Unknown entity type: ${entityType}`);
        return null;
    }

    if (url && title) {
      // Cache result
      urlCache.set(cacheKey, { url, title, timestamp: Date.now() });
      return { url, title };
    }

    return null;
  } catch (error) {
    console.error(`[linkit-substitution] Error fetching ${entityType}:${entityId}:`, error);
    return null;
  }
}

/**
 * Substitute all entity tokens in text with HTML links
 * @param {string} text - Text containing entity tokens
 * @param {object} services - Service container
 * @param {object} options - Substitution options
 * @returns {Promise<string>} Text with tokens replaced by links
 */
export async function substituteLinks(text, services, options = {}) {
  if (!text || typeof text !== 'string') {
    return text;
  }

  const {
    placeholder = '[Link unavailable]', // Placeholder for missing entities
    format = 'html', // 'html' or 'markdown'
    linkClass = '', // CSS class for links
    openInNewTab = false // Whether to add target="_blank"
  } = options;

  // Find all entity tokens
  const tokens = [];
  let match;
  const pattern = new RegExp(ENTITY_TOKEN_PATTERN);

  while ((match = pattern.exec(text)) !== null) {
    tokens.push({
      token: match[0],
      type: match[1],
      id: match[2],
      index: match.index
    });
  }

  if (tokens.length === 0) {
    return text; // No tokens to substitute
  }

  // Fetch all entity URLs in parallel
  const entityPromises = tokens.map(t => getEntityUrl(t.type, t.id, services));
  const entityResults = await Promise.all(entityPromises);

  // Build replacement map
  const replacements = new Map();
  tokens.forEach((token, index) => {
    const entity = entityResults[index];

    if (entity) {
      // Create link
      let link;
      if (format === 'markdown') {
        link = `[${entity.title}](${entity.url})`;
      } else {
        const classAttr = linkClass ? ` class="${linkClass}"` : '';
        const targetAttr = openInNewTab ? ' target="_blank" rel="noopener noreferrer"' : '';
        link = `<a href="${entity.url}"${classAttr}${targetAttr}>${entity.title}</a>`;
      }
      replacements.set(token.token, link);
    } else {
      // Entity not found - use placeholder
      if (format === 'markdown') {
        replacements.set(token.token, placeholder);
      } else {
        replacements.set(token.token, `<span class="linkit-missing">${placeholder}</span>`);
      }
    }
  });

  // Replace all tokens
  let result = text;
  replacements.forEach((replacement, token) => {
    result = result.replace(new RegExp(escapeRegex(token), 'g'), replacement);
  });

  return result;
}

/**
 * Substitute entity tokens with plain URLs (no HTML)
 * @param {string} text - Text containing entity tokens
 * @param {object} services - Service container
 * @returns {Promise<string>} Text with tokens replaced by URLs
 */
export async function substituteUrls(text, services) {
  if (!text || typeof text !== 'string') {
    return text;
  }

  // Find all entity tokens
  const tokens = [];
  let match;
  const pattern = new RegExp(ENTITY_TOKEN_PATTERN);

  while ((match = pattern.exec(text)) !== null) {
    tokens.push({
      token: match[0],
      type: match[1],
      id: match[2]
    });
  }

  if (tokens.length === 0) {
    return text;
  }

  // Fetch all entity URLs in parallel
  const entityPromises = tokens.map(t => getEntityUrl(t.type, t.id, services));
  const entityResults = await Promise.all(entityPromises);

  // Build replacement map
  const replacements = new Map();
  tokens.forEach((token, index) => {
    const entity = entityResults[index];
    if (entity) {
      replacements.set(token.token, entity.url);
    } else {
      // Keep token if entity not found
      replacements.set(token.token, token.token);
    }
  });

  // Replace all tokens
  let result = text;
  replacements.forEach((replacement, token) => {
    result = result.replace(new RegExp(escapeRegex(token), 'g'), replacement);
  });

  return result;
}

/**
 * Clear the URL cache
 */
export function clearCache() {
  urlCache.clear();
}

/**
 * Get cache statistics
 * @returns {object} Cache stats
 */
export function getCacheStats() {
  return {
    size: urlCache.size,
    entries: Array.from(urlCache.keys())
  };
}

/**
 * Escape special regex characters
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default {
  createEntityToken,
  parseEntityToken,
  substituteLinks,
  substituteUrls,
  clearCache,
  getCacheStats
};
