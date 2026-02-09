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
}
