/**
 * AccessResult - Cacheable access control results
 *
 * Drupal equivalent: AccessResult.php
 *
 * Provides three access states (ALLOWED, FORBIDDEN, NEUTRAL) with cache metadata
 * for building composable access control systems.
 *
 * Why use AccessResult instead of boolean checks:
 * - Carries reason for denial (helpful for debugging/logging)
 * - Includes cache metadata (contexts, tags, max-age)
 * - Composable via orIf/andIf combinators
 * - Explicit NEUTRAL state for "no opinion" checks
 *
 * @example
 * // Instead of: if (!user.hasPermission('edit')) return res.status(403).send();
 * // Use: const result = AccessResult.forbidden('Missing permission: edit');
 *
 * // Combining checks:
 * const permCheck = user.hasPermission('edit')
 *   ? AccessResult.allowed()
 *   : AccessResult.neutral();
 * const ownerCheck = entity.uid === user.id
 *   ? AccessResult.allowed()
 *   : AccessResult.neutral();
 * const combined = permCheck.orIf(ownerCheck); // ALLOWED if either passes
 */

// Private symbol for storing reason (prevents external modification)
const REASON = Symbol('reason');

export class AccessResult {
  /**
   * @param {string} state - One of: 'allowed', 'forbidden', 'neutral'
   * @param {string} reason - Human-readable reason (mainly for forbidden/neutral)
   */
  constructor(state, reason) {
    this._state = state;
    this[REASON] = reason;

    // Cache metadata (for future cache integration)
    this._cacheContexts = [];
    this._cacheTags = [];
    this._cacheMaxAge = undefined;
  }

  /**
   * Factory: Create an ALLOWED result
   * @returns {AccessResult}
   */
  static allowed() {
    return new AccessResult('allowed');
  }

  /**
   * Factory: Create a FORBIDDEN result with reason
   * @param {string} reason - Why access is forbidden
   * @returns {AccessResult}
   */
  static forbidden(reason) {
    return new AccessResult('forbidden', reason);
  }

  /**
   * Factory: Create a NEUTRAL result (no opinion)
   * @param {string} reason - Why this check has no opinion
   * @returns {AccessResult}
   */
  static neutral(reason) {
    return new AccessResult('neutral', reason);
  }

  /**
   * Check if result is ALLOWED
   * @returns {boolean}
   */
  isAllowed() {
    return this._state === 'allowed';
  }

  /**
   * Check if result is FORBIDDEN
   * @returns {boolean}
   */
  isForbidden() {
    return this._state === 'forbidden';
  }

  /**
   * Check if result is NEUTRAL
   * @returns {boolean}
   */
  isNeutral() {
    return this._state === 'neutral';
  }

  /**
   * Get the reason string (for forbidden/neutral results)
   * @returns {string|undefined}
   */
  getReason() {
    return this[REASON];
  }

  /**
   * Combine with another result using OR logic
   * - FORBIDDEN wins over everything
   * - ALLOWED wins over NEUTRAL
   * - Cache metadata is merged
   *
   * @param {AccessResult} other - Another access result
   * @returns {AccessResult} Combined result
   *
   * @example
   * // User can edit if they have permission OR own the content
   * permissionCheck.orIf(ownershipCheck)
   */
  orIf(other) {
    let result;

    // FORBIDDEN wins over everything
    if (this.isForbidden() || other.isForbidden()) {
      const reason = this.isForbidden() ? this.getReason() : other.getReason();
      result = AccessResult.forbidden(reason);
    }
    // ALLOWED wins over NEUTRAL
    else if (this.isAllowed() || other.isAllowed()) {
      result = AccessResult.allowed();
    }
    // Both are NEUTRAL
    else {
      result = AccessResult.neutral();
    }

    // Merge cache metadata from both results
    result._cacheContexts = [...this._cacheContexts, ...other._cacheContexts];
    result._cacheTags = [...this._cacheTags, ...other._cacheTags];

    return result;
  }

  /**
   * Combine with another result using AND logic
   * - FORBIDDEN wins over everything
   * - NEUTRAL wins over ALLOWED (both must be ALLOWED for result to be ALLOWED)
   * - Cache metadata is merged
   *
   * @param {AccessResult} other - Another access result
   * @returns {AccessResult} Combined result
   *
   * @example
   * // User can edit if they have permission AND content is not locked
   * permissionCheck.andIf(lockCheck)
   */
  andIf(other) {
    let result;

    // FORBIDDEN wins over everything
    if (this.isForbidden() || other.isForbidden()) {
      const reason = this.isForbidden() ? this.getReason() : other.getReason();
      result = AccessResult.forbidden(reason);
    }
    // If either is NEUTRAL, result is NEUTRAL
    else if (this.isNeutral() || other.isNeutral()) {
      result = AccessResult.neutral();
    }
    // Both are ALLOWED
    else {
      result = AccessResult.allowed();
    }

    // Merge cache metadata from both results
    result._cacheContexts = [...this._cacheContexts, ...other._cacheContexts];
    result._cacheTags = [...this._cacheTags, ...other._cacheTags];

    return result;
  }

  /**
   * Add cache contexts (what makes this result vary)
   *
   * @param {string[]} contexts - Cache context IDs (e.g., ['user.permissions', 'url.path'])
   * @returns {AccessResult} this (for chaining)
   *
   * Common contexts:
   * - 'user' - Varies per user
   * - 'user.permissions' - Varies when user permissions change
   * - 'user.roles' - Varies when user roles change
   * - 'url.path' - Varies per URL path
   */
  addCacheContexts(contexts) {
    this._cacheContexts.push(...contexts);
    return this;
  }

  /**
   * Add cache tags (what invalidates this result)
   *
   * @param {string[]} tags - Cache tag IDs (e.g., ['node:42', 'user:1'])
   * @returns {AccessResult} this (for chaining)
   *
   * When any of these entities change, cached access results are invalidated.
   */
  addCacheTags(tags) {
    this._cacheTags.push(...tags);
    return this;
  }

  /**
   * Mark this result as varying per user permissions
   * Shorthand for addCacheContexts(['user.permissions'])
   *
   * @returns {AccessResult} this (for chaining)
   */
  cachePerPermissions() {
    return this.addCacheContexts(['user.permissions']);
  }

  /**
   * Mark this result as varying per user
   * Shorthand for addCacheContexts(['user'])
   *
   * @returns {AccessResult} this (for chaining)
   */
  cachePerUser() {
    return this.addCacheContexts(['user']);
  }
}
