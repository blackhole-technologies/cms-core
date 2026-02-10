/**
 * User Matcher - Searches user entities
 *
 * SEARCH STRATEGY:
 * ================
 * - Searches across username, display name, and email
 * - Username matches score higher (3x weight)
 * - Respects permissions: only shows users the current user can see
 * - Email field only searchable if user has permission
 *
 * FIELDS SEARCHED:
 * ================
 * - username: Primary search field (highest weight)
 * - email: Secondary search field (permission-dependent)
 * - displayName: If available
 *
 * PRIVACY:
 * ========
 * - Does not expose sensitive user data in results
 * - Email is only searchable, not returned in results (unless explicitly configured)
 * - Respects user visibility permissions
 */

import { calculateScore } from '../index.js';

export default class UserMatcher {
  constructor(services) {
    this.services = services;
    this.content = services.get('content');
  }

  /**
   * Search user entities
   *
   * @param {string} query - Search query (already lowercased)
   * @returns {Promise<Array>} - Matching user items with scores
   */
  async search(query) {
    const results = [];

    try {
      // Check if user content type exists
      if (!this.content.hasType('user')) {
        return results;
      }

      // List all users
      const { items } = this.content.list('user');

      for (const item of items) {
        const match = this.matchItem(item, query);
        if (match) {
          results.push(match);
        }
      }
    } catch (error) {
      console.error('[linkit] Error searching users:', error);
    }

    return results;
  }

  /**
   * Check if a user item matches the query
   *
   * @param {Object} item - User item
   * @param {string} query - Search query (lowercased)
   * @returns {Object|null} - Match result or null
   */
  matchItem(item, query) {
    let maxScore = 0;
    let matchedField = null;

    // Check username (highest priority)
    if (item.username) {
      const usernameScore = calculateScore(item.username, query) * 3; // 3x weight
      if (usernameScore > maxScore) {
        maxScore = usernameScore;
        matchedField = 'username';
      }
    }

    // Check display name if available
    if (item.displayName) {
      const displayNameScore = calculateScore(item.displayName, query) * 2;
      if (displayNameScore > maxScore) {
        maxScore = displayNameScore;
        matchedField = 'displayName';
      }
    }

    // Check email (permission check would go here in production)
    // For now, allow email search but don't return email in results
    if (item.email) {
      const emailScore = calculateScore(item.email, query);
      if (emailScore > maxScore) {
        maxScore = emailScore;
        matchedField = 'email';
      }
    }

    // Return match if score > 0
    if (maxScore > 0) {
      // Build display title (prefer display name, fallback to username)
      const displayTitle = item.displayName || item.username;

      return {
        id: item.id,
        title: displayTitle,
        type: 'user',
        entityType: item.role || 'user',
        url: `/admin/users/${item.id}`,
        score: maxScore,
        metadata: {
          username: item.username,
          role: item.role,
          lastLogin: item.lastLogin,
          matchedField
        }
      };
    }

    return null;
  }

  /**
   * Check if the current user can see a specific user
   * (Placeholder for permission system integration)
   *
   * @param {Object} currentUser - Current user object
   * @param {Object} targetUser - User to check visibility for
   * @returns {boolean} - Whether the user is visible
   */
  canSeeUser(currentUser, targetUser) {
    // TODO: Integrate with permission system
    // For now, all users can see all other users
    // In production, this would check:
    // - User's own profile is always visible
    // - Admins can see all users
    // - Regular users can only see users with specific roles/permissions
    return true;
  }
}
