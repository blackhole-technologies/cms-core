/**
 * favorites.js - Content Favorites/Bookmarks System
 *
 * Allows users to bookmark content for quick access.
 *
 * STORAGE STRATEGY:
 * =================
 * Favorites are stored per-user in /content/.favorites/<userId>.json
 * This keeps favorites separate from regular content and allows
 * efficient per-user lookups without scanning all content.
 *
 * DESIGN DECISIONS:
 * =================
 *
 * 1. PER-USER STORAGE
 *    Each user has their own favorites file. This makes reads fast
 *    and avoids contention between users.
 *
 * 2. CUSTOM LABELS
 *    Users can add optional labels/notes to favorites for context.
 *    "Why did I bookmark this?" is answered by the label.
 *
 * 3. CONTENT VALIDATION
 *    When adding a favorite, we validate the content exists.
 *    When listing favorites, we filter out deleted content.
 *
 * 4. POPULARITY TRACKING
 *    Track how many users have favorited each item.
 *    Useful for discovering popular content.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

// ===========================================
// Module State
// ===========================================

let baseDir = null;
let contentService = null;

/**
 * Get the favorites storage directory
 * @returns {string} Path to favorites directory
 */
function getFavoritesDir() {
  return join(baseDir, 'content', '.favorites');
}

/**
 * Get path to a user's favorites file
 * @param {string} userId - User ID
 * @returns {string} Path to user's favorites JSON file
 */
function getUserFavoritesPath(userId) {
  return join(getFavoritesDir(), `${userId}.json`);
}

/**
 * Ensure favorites directory exists
 */
function ensureFavoritesDir() {
  const dir = getFavoritesDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Load a user's favorites from disk
 * @param {string} userId - User ID
 * @returns {Object[]} Array of favorite objects
 */
function loadUserFavorites(userId) {
  const filePath = getUserFavoritesPath(userId);

  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const data = readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`[favorites] Error loading favorites for ${userId}: ${error.message}`);
    return [];
  }
}

/**
 * Save a user's favorites to disk
 * @param {string} userId - User ID
 * @param {Object[]} favorites - Array of favorite objects
 */
function saveUserFavorites(userId, favorites) {
  ensureFavoritesDir();
  const filePath = getUserFavoritesPath(userId);

  try {
    writeFileSync(filePath, JSON.stringify(favorites, null, 2), 'utf-8');
  } catch (error) {
    console.error(`[favorites] Error saving favorites for ${userId}: ${error.message}`);
    throw error;
  }
}

// ===========================================
// Initialization
// ===========================================

/**
 * Initialize favorites module
 *
 * @param {string} projectRoot - Project root directory
 * @param {Object} content - Content service reference
 */
export function init(projectRoot, content) {
  baseDir = projectRoot;
  contentService = content;
  ensureFavoritesDir();
  console.log('[favorites] Favorites module initialized');
}

// ===========================================
// Core Operations
// ===========================================

/**
 * Add content to user's favorites
 *
 * @param {string} userId - User ID
 * @param {string} contentType - Content type
 * @param {string} contentId - Content ID
 * @param {string} [label] - Optional label/note
 * @returns {Object} The created favorite object
 * @throws {Error} If content doesn't exist
 *
 * @example
 * const fav = favorites.addFavorite('admin', 'article', 'abc123', 'Review this');
 */
export function addFavorite(userId, contentType, contentId, label = null) {
  if (!userId || !contentType || !contentId) {
    throw new Error('userId, contentType, and contentId are required');
  }

  // Validate content exists
  if (contentService) {
    const item = contentService.read(contentType, contentId);
    if (!item) {
      throw new Error(`Content not found: ${contentType}/${contentId}`);
    }
  }

  const favorites = loadUserFavorites(userId);

  // Check if already favorited
  const existing = favorites.find(
    f => f.contentType === contentType && f.contentId === contentId
  );

  if (existing) {
    // Update label if provided
    if (label !== null) {
      existing.label = label;
      saveUserFavorites(userId, favorites);
    }
    return existing;
  }

  // Create new favorite
  const favorite = {
    userId,
    contentType,
    contentId,
    label: label || null,
    addedAt: new Date().toISOString(),
  };

  favorites.unshift(favorite); // Add to beginning (most recent first)
  saveUserFavorites(userId, favorites);

  console.log(`[favorites] Added favorite for ${userId}: ${contentType}/${contentId}`);
  return favorite;
}

/**
 * Remove content from user's favorites
 *
 * @param {string} userId - User ID
 * @param {string} contentType - Content type
 * @param {string} contentId - Content ID
 * @returns {boolean} True if removed, false if not found
 *
 * @example
 * favorites.removeFavorite('admin', 'article', 'abc123');
 */
export function removeFavorite(userId, contentType, contentId) {
  if (!userId || !contentType || !contentId) {
    throw new Error('userId, contentType, and contentId are required');
  }

  const favorites = loadUserFavorites(userId);
  const initialLength = favorites.length;

  const filtered = favorites.filter(
    f => !(f.contentType === contentType && f.contentId === contentId)
  );

  if (filtered.length === initialLength) {
    return false; // Nothing was removed
  }

  saveUserFavorites(userId, filtered);
  console.log(`[favorites] Removed favorite for ${userId}: ${contentType}/${contentId}`);
  return true;
}

/**
 * Toggle favorite status for content
 *
 * @param {string} userId - User ID
 * @param {string} contentType - Content type
 * @param {string} contentId - Content ID
 * @param {string} [label] - Optional label (used if adding)
 * @returns {Object} { added: boolean, favorite: Object|null }
 *
 * @example
 * const result = favorites.toggleFavorite('admin', 'article', 'abc123');
 * console.log(result.added ? 'Added' : 'Removed');
 */
export function toggleFavorite(userId, contentType, contentId, label = null) {
  if (isFavorite(userId, contentType, contentId)) {
    removeFavorite(userId, contentType, contentId);
    return { added: false, favorite: null };
  } else {
    const favorite = addFavorite(userId, contentType, contentId, label);
    return { added: true, favorite };
  }
}

/**
 * Check if content is favorited by user
 *
 * @param {string} userId - User ID
 * @param {string} contentType - Content type
 * @param {string} contentId - Content ID
 * @returns {boolean} True if favorited
 *
 * @example
 * if (favorites.isFavorite('admin', 'article', 'abc123')) {
 *   console.log('This is a favorite!');
 * }
 */
export function isFavorite(userId, contentType, contentId) {
  const favorites = loadUserFavorites(userId);
  return favorites.some(
    f => f.contentType === contentType && f.contentId === contentId
  );
}

/**
 * Get user's favorites with optional filtering
 *
 * @param {string} userId - User ID
 * @param {Object} [options] - Query options
 * @param {string} [options.contentType] - Filter by content type
 * @param {string} [options.sortBy] - Sort field: 'addedAt', 'label', 'contentType'
 * @param {string} [options.sortOrder] - Sort order: 'asc' or 'desc'
 * @param {number} [options.limit] - Max items to return
 * @param {boolean} [options.includeContent] - Include full content objects
 * @returns {Object[]} Array of favorite objects (with content if requested)
 *
 * @example
 * const favs = favorites.getFavorites('admin', {
 *   contentType: 'article',
 *   limit: 10,
 *   includeContent: true
 * });
 */
export function getFavorites(userId, options = {}) {
  const {
    contentType = null,
    sortBy = 'addedAt',
    sortOrder = 'desc',
    limit = null,
    includeContent = false,
  } = options;

  let favorites = loadUserFavorites(userId);

  // Filter by content type
  if (contentType) {
    favorites = favorites.filter(f => f.contentType === contentType);
  }

  // Validate content still exists and include content data if requested
  if (contentService) {
    favorites = favorites
      .map(f => {
        const content = contentService.read(f.contentType, f.contentId);
        if (!content) return null; // Content was deleted

        if (includeContent) {
          return { ...f, content };
        }
        return f;
      })
      .filter(f => f !== null);
  }

  // Sort
  favorites.sort((a, b) => {
    let aVal, bVal;

    switch (sortBy) {
      case 'label':
        aVal = (a.label || '').toLowerCase();
        bVal = (b.label || '').toLowerCase();
        break;
      case 'contentType':
        aVal = a.contentType;
        bVal = b.contentType;
        break;
      case 'addedAt':
      default:
        aVal = new Date(a.addedAt).getTime();
        bVal = new Date(b.addedAt).getTime();
        break;
    }

    if (sortOrder === 'asc') {
      return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    } else {
      return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
    }
  });

  // Limit
  if (limit && limit > 0) {
    favorites = favorites.slice(0, limit);
  }

  return favorites;
}

/**
 * Update the label on an existing favorite
 *
 * @param {string} userId - User ID
 * @param {string} contentType - Content type
 * @param {string} contentId - Content ID
 * @param {string} label - New label (or null to clear)
 * @returns {Object|null} Updated favorite or null if not found
 */
export function updateLabel(userId, contentType, contentId, label) {
  const favorites = loadUserFavorites(userId);

  const favorite = favorites.find(
    f => f.contentType === contentType && f.contentId === contentId
  );

  if (!favorite) {
    return null;
  }

  favorite.label = label || null;
  saveUserFavorites(userId, favorites);

  return favorite;
}

/**
 * Get most favorited content across all users
 *
 * @param {number} [limit=10] - Max items to return
 * @param {string} [contentType] - Filter by content type
 * @returns {Object[]} Array of { contentType, contentId, count, content }
 *
 * @example
 * const popular = favorites.getPopularFavorites(10);
 * console.log(`Most popular: ${popular[0].contentType}/${popular[0].contentId} - ${popular[0].count} users`);
 */
export function getPopularFavorites(limit = 10, contentType = null) {
  const favoritesDir = getFavoritesDir();

  if (!existsSync(favoritesDir)) {
    return [];
  }

  // Count favorites across all users
  const counts = new Map(); // "type:id" -> count

  const files = readdirSync(favoritesDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    try {
      const data = readFileSync(join(favoritesDir, file), 'utf-8');
      const userFavorites = JSON.parse(data);

      for (const fav of userFavorites) {
        // Skip if filtering by type and doesn't match
        if (contentType && fav.contentType !== contentType) continue;

        const key = `${fav.contentType}:${fav.contentId}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    } catch (error) {
      // Skip invalid files
      continue;
    }
  }

  // Convert to array and sort by count
  const popular = Array.from(counts.entries())
    .map(([key, count]) => {
      const [type, id] = key.split(':');
      const result = { contentType: type, contentId: id, count };

      // Include content if available
      if (contentService) {
        const content = contentService.read(type, id);
        if (content) {
          result.content = content;
        }
      }

      return result;
    })
    .filter(item => item.content) // Only include items that still exist
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  return popular;
}

/**
 * Get count of favorites for a specific content item
 *
 * @param {string} contentType - Content type
 * @param {string} contentId - Content ID
 * @returns {number} Number of users who favorited this content
 */
export function getFavoriteCount(contentType, contentId) {
  const favoritesDir = getFavoritesDir();

  if (!existsSync(favoritesDir)) {
    return 0;
  }

  let count = 0;
  const files = readdirSync(favoritesDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    try {
      const data = readFileSync(join(favoritesDir, file), 'utf-8');
      const userFavorites = JSON.parse(data);

      if (userFavorites.some(f => f.contentType === contentType && f.contentId === contentId)) {
        count++;
      }
    } catch (error) {
      continue;
    }
  }

  return count;
}

/**
 * Get all user IDs who have favorites
 *
 * @returns {string[]} Array of user IDs
 */
export function getUsersWithFavorites() {
  const favoritesDir = getFavoritesDir();

  if (!existsSync(favoritesDir)) {
    return [];
  }

  return readdirSync(favoritesDir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
}

/**
 * Clear all favorites for a user
 *
 * @param {string} userId - User ID
 * @returns {number} Number of favorites removed
 */
export function clearUserFavorites(userId) {
  const favorites = loadUserFavorites(userId);
  const count = favorites.length;

  if (count > 0) {
    saveUserFavorites(userId, []);
    console.log(`[favorites] Cleared ${count} favorites for ${userId}`);
  }

  return count;
}

// ===========================================
// Default Export
// ===========================================

export default {
  init,
  addFavorite,
  removeFavorite,
  toggleFavorite,
  isFavorite,
  getFavorites,
  updateLabel,
  getPopularFavorites,
  getFavoriteCount,
  getUsersWithFavorites,
  clearUserFavorites,
};
