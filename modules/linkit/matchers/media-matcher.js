/**
 * Media Matcher - Searches media entities
 *
 * SEARCH STRATEGY:
 * ================
 * - Searches across filename, alt text, and title
 * - Filename matches score higher (2x weight)
 * - Returns media URL and file metadata
 *
 * FIELDS SEARCHED:
 * ================
 * - filename: Primary search field (highest weight)
 * - alt: Alternative text description
 * - title: Media title if available
 * - mimetype: File type for filtering
 */

import { calculateScore } from '../index.js';

export default class MediaMatcher {
  constructor(services) {
    this.services = services;
    this.media = services.get('media');
  }

  /**
   * Search media entities
   *
   * @param {string} query - Search query (already lowercased)
   * @returns {Promise<Array>} - Matching media items with scores
   */
  async search(query) {
    const results = [];

    try {
      // List all media items
      const items = this.media.list();

      for (const item of items) {
        const match = this.matchItem(item, query);
        if (match) {
          results.push(match);
        }
      }
    } catch (error) {
      console.error('[linkit] Error searching media:', error);
    }

    return results;
  }

  /**
   * Check if a media item matches the query
   *
   * @param {Object} item - Media item
   * @param {string} query - Search query (lowercased)
   * @returns {Object|null} - Match result or null
   */
  matchItem(item, query) {
    let maxScore = 0;
    let matchedField = null;

    // Check filename (highest priority)
    if (item.filename) {
      const filenameScore = calculateScore(item.filename, query) * 2; // 2x weight
      if (filenameScore > maxScore) {
        maxScore = filenameScore;
        matchedField = 'filename';
      }
    }

    // Check alt text
    if (item.alt) {
      const altScore = calculateScore(item.alt, query);
      if (altScore > maxScore) {
        maxScore = altScore;
        matchedField = 'alt';
      }
    }

    // Check title
    if (item.title) {
      const titleScore = calculateScore(item.title, query);
      if (titleScore > maxScore) {
        maxScore = titleScore;
        matchedField = 'title';
      }
    }

    // Return match if score > 0
    if (maxScore > 0) {
      return {
        id: item.id || item.filename,
        title: item.filename,
        type: 'media',
        entityType: item.mimetype || 'unknown',
        url: item.url || `/media/${item.filename}`,
        score: maxScore,
        metadata: {
          mimetype: item.mimetype,
          size: item.size,
          uploaded: item.uploaded,
          matchedField
        }
      };
    }

    return null;
  }
}
