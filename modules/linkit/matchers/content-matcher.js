/**
 * Content Matcher - Searches content entities
 *
 * SEARCH STRATEGY:
 * ================
 * - Searches across title, body text, and path aliases
 * - Title matches score higher than body matches (3x weight)
 * - Exact matches score higher than partial matches
 * - Returns URL path for direct linking
 *
 * FIELDS SEARCHED:
 * ================
 * - title: Primary search field (highest weight)
 * - body: Secondary search field
 * - summary: If available
 * - Any string field in the content schema
 */

import { calculateScore } from '../index.js';

export default class ContentMatcher {
  constructor(services) {
    this.services = services;
    this.content = services.get('content');
  }

  /**
   * Search content entities
   *
   * @param {string} query - Search query (already lowercased)
   * @returns {Promise<Array>} - Matching content items with scores
   */
  async search(query) {
    const results = [];

    // Get all content types
    const types = this.content.listTypes();

    for (const { type } of types) {
      try {
        // List all items of this content type
        const { items } = this.content.list(type);

        for (const item of items) {
          const match = this.matchItem(item, type, query);
          if (match) {
            results.push(match);
          }
        }
      } catch (error) {
        console.error(`[linkit] Error searching content type ${type}:`, error);
      }
    }

    return results;
  }

  /**
   * Check if a content item matches the query
   *
   * @param {Object} item - Content item
   * @param {string} type - Content type
   * @param {string} query - Search query (lowercased)
   * @returns {Object|null} - Match result or null
   */
  matchItem(item, type, query) {
    let maxScore = 0;
    let matchedField = null;

    // Check title (highest priority)
    if (item.title) {
      const titleScore = calculateScore(item.title, query) * 3; // 3x weight
      if (titleScore > maxScore) {
        maxScore = titleScore;
        matchedField = 'title';
      }
    }

    // Check body field
    if (item.body) {
      const bodyScore = calculateScore(item.body, query);
      if (bodyScore > maxScore) {
        maxScore = bodyScore;
        matchedField = 'body';
      }
    }

    // Check summary field
    if (item.summary) {
      const summaryScore = calculateScore(item.summary, query) * 2; // 2x weight
      if (summaryScore > maxScore) {
        maxScore = summaryScore;
        matchedField = 'summary';
      }
    }

    // Check other string fields (lower priority)
    for (const [key, value] of Object.entries(item)) {
      if (typeof value === 'string' && key !== 'title' && key !== 'body' && key !== 'summary') {
        const fieldScore = calculateScore(value, query);
        if (fieldScore > maxScore) {
          maxScore = fieldScore;
          matchedField = key;
        }
      }
    }

    // Return match if score > 0
    if (maxScore > 0) {
      return {
        id: item.id,
        title: item.title || item.name || `Untitled ${type}`,
        type: 'content',
        entityType: type,
        url: `/content/${type}/${item.id}`,
        score: maxScore,
        metadata: {
          created: item.created,
          updated: item.updated,
          matchedField
        }
      };
    }

    return null;
  }
}
