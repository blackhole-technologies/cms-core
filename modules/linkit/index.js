/**
 * Linkit Module - Link Autocomplete Service
 *
 * WHY THIS EXISTS:
 * ================
 * Content editors need an easy way to link to internal content without remembering
 * exact URLs or IDs. This module provides autocomplete suggestions for content,
 * media, and users as they type in WYSIWYG editors or link fields.
 *
 * FEATURES:
 * =========
 * - Fuzzy search across content, media, and user entities
 * - Relevance-based ranking (exact matches score higher)
 * - Entity type filtering (search only content, only media, etc.)
 * - Returns structured results with title, type, URL, metadata
 * - Integrates with existing content/media/users services
 * - API endpoint for autocomplete: GET /api/linkit/autocomplete?q=query&types=content,media
 *
 * ARCHITECTURE:
 * =============
 * - Core matcher service with pluggable entity-specific matchers
 * - Each matcher (content, media, users) implements custom search logic
 * - Scoring algorithm ranks results by relevance
 * - RESTful API endpoint for client-side integration
 *
 * USAGE:
 * ======
 * API Request:
 *   GET /api/linkit/autocomplete?q=hello&types=content
 *
 * API Response:
 *   [
 *     {
 *       "id": "abc123",
 *       "title": "Hello World Post",
 *       "type": "content",
 *       "entityType": "post",
 *       "url": "/content/post/abc123",
 *       "metadata": { "created": "2024-01-15T..." }
 *     }
 *   ]
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

// Get the directory of this module
const __dirname = dirname(fileURLToPath(import.meta.url));

// Module state
let services = null;
let initialized = false;

/**
 * Load matcher modules
 */
let contentMatcher = null;
let mediaMatcher = null;
let userMatcher = null;

/**
 * Boot hook - initializes the linkit service
 */
export async function hook_boot(context) {
  services = context.services;

  // Lazy-load matchers
  const { default: ContentMatcher } = await import('./matchers/content-matcher.js');
  const { default: MediaMatcher } = await import('./matchers/media-matcher.js');
  const { default: UserMatcher } = await import('./matchers/user-matcher.js');

  contentMatcher = new ContentMatcher(services);
  mediaMatcher = new MediaMatcher(services);
  userMatcher = new UserMatcher(services);

  console.log('[linkit] Link autocomplete service initialized');
}

/**
 * Routes hook - registers API endpoints
 */
export async function hook_routes(register, context) {
  const server = context.services?.get('server');

  if (!server) {
    console.warn('[linkit] Server service not available, skipping routes');
    return;
  }

  // Autocomplete API endpoint
  register('GET', '/api/linkit/autocomplete', async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const query = url.searchParams.get('q') || '';
      const typesParam = url.searchParams.get('types') || 'content,media,user';
      const types = typesParam.split(',').map(t => t.trim());

      // Validate query
      if (!query || query.length < 2) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([]));
        return;
      }

      // Search across requested entity types
      const results = await search(query, types);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(results));
    } catch (error) {
      console.error('[linkit] Autocomplete error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  });

  // Demo page route
  register('GET', '/linkit/demo', async (req, res) => {
    try {
      const html = loadTemplate('demo.html');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Demo page not found');
    }
  });

  // WYSIWYG integration demo route
  register('GET', '/linkit/wysiwyg', async (req, res) => {
    try {
      const html = loadTemplate('wysiwyg-demo.html');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('WYSIWYG demo page not found');
    }
  });

  console.log('[linkit] Registered API routes: /api/linkit/autocomplete, /linkit/demo, /linkit/wysiwyg');
}

/**
 * Load a template file from this module's templates directory
 */
function loadTemplate(name) {
  const templatePath = join(__dirname, 'templates', name);
  return readFileSync(templatePath, 'utf-8');
}

/**
 * Core search function - searches across multiple entity types
 *
 * @param {string} query - Search query string
 * @param {Array<string>} types - Entity types to search: ['content', 'media', 'user']
 * @returns {Promise<Array>} - Sorted results by relevance
 */
export async function search(query, types = ['content', 'media', 'user']) {
  const results = [];
  const queryLower = query.toLowerCase();

  // Search each entity type
  for (const type of types) {
    let typeResults = [];

    switch (type) {
      case 'content':
        if (contentMatcher) {
          typeResults = await contentMatcher.search(queryLower);
        }
        break;

      case 'media':
        if (mediaMatcher) {
          typeResults = await mediaMatcher.search(queryLower);
        }
        break;

      case 'user':
        if (userMatcher) {
          typeResults = await userMatcher.search(queryLower);
        }
        break;

      default:
        console.warn(`[linkit] Unknown entity type: ${type}`);
    }

    results.push(...typeResults);
  }

  // Sort by score (descending), then by creation date (newest first)
  results.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    // Use created timestamp if available
    const aTime = a.metadata?.created ? new Date(a.metadata.created).getTime() : 0;
    const bTime = b.metadata?.created ? new Date(b.metadata.created).getTime() : 0;
    return bTime - aTime;
  });

  // Remove score from results (internal ranking detail)
  return results.map(({ score, ...result }) => result);
}

/**
 * Calculate relevance score for a search match
 *
 * Scoring algorithm:
 * - Exact match (case-insensitive): 100 points
 * - Starts with query: 50 points
 * - Contains query: 25 points
 * - Word boundary match: +10 points
 *
 * @param {string} text - Text to search in
 * @param {string} query - Query string (already lowercased)
 * @returns {number} - Score (0 = no match, higher = better match)
 */
export function calculateScore(text, query) {
  if (!text || !query) return 0;

  const textLower = text.toLowerCase();

  // Exact match
  if (textLower === query) {
    return 100;
  }

  // Starts with query
  if (textLower.startsWith(query)) {
    return 50;
  }

  // Contains query
  if (textLower.includes(query)) {
    let score = 25;

    // Bonus for word boundary match (query appears at start of a word)
    const wordBoundaryRegex = new RegExp(`\\b${escapeRegex(query)}`, 'i');
    if (wordBoundaryRegex.test(text)) {
      score += 10;
    }

    return score;
  }

  return 0;
}

/**
 * Escape special regex characters
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Get configuration for a specific matcher
 * Allows customization of search behavior per entity type
 *
 * @param {string} matcherType - 'content', 'media', or 'user'
 * @returns {Object} - Matcher configuration
 */
export function getMatcherConfig(matcherType) {
  // Default configurations
  const configs = {
    content: {
      searchFields: ['title', 'body', 'summary'],
      maxResults: 10,
      titleWeight: 3, // Title matches are 3x more important
      bodyWeight: 1
    },
    media: {
      searchFields: ['filename', 'alt', 'title'],
      maxResults: 10,
      filenameWeight: 2,
      altWeight: 1
    },
    user: {
      searchFields: ['username', 'email', 'displayName'],
      maxResults: 10,
      usernameWeight: 3,
      emailWeight: 1
    }
  };

  return configs[matcherType] || {};
}
