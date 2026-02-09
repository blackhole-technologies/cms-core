/**
 * AccessPolicy - Base class for access control policies
 *
 * Drupal equivalent: ContentEntityAccessControlHandler.php, EntityAccessControlHandler.php
 *
 * Access policies implement the check() method to make access decisions.
 * Multiple policies can be combined to create layered access control.
 *
 * Why use AccessPolicy classes:
 * - Separates access logic from business logic
 * - Allows testing access rules independently
 * - Policies are composable (combine via combineAccessResults)
 * - Each policy is focused on a single concern (permission, ownership, status, etc.)
 *
 * @example Permission-based policy
 * ```javascript
 * import { AccessPolicy } from './AccessPolicy.js';
 * import { AccessResult } from './AccessResult.js';
 *
 * export class PermissionPolicy extends AccessPolicy {
 *   check(account, operation, context) {
 *     const permission = `${operation} ${context.entityType}`;
 *     if (account.hasPermission(permission)) {
 *       return AccessResult.allowed().cachePerPermissions();
 *     }
 *     return AccessResult.neutral(`No ${permission} permission`);
 *   }
 * }
 * ```
 *
 * @example Ownership policy
 * ```javascript
 * export class OwnershipPolicy extends AccessPolicy {
 *   check(account, operation, context) {
 *     if (['update', 'delete'].includes(operation)) {
 *       const ownPermission = `${operation} own ${context.entityType}`;
 *       if (account.hasPermission(ownPermission) && context.entity.uid === account.id) {
 *         return AccessResult.allowed()
 *           .cachePerPermissions()
 *           .cachePerUser();
 *       }
 *     }
 *     return AccessResult.neutral();
 *   }
 * }
 * ```
 *
 * @example Using multiple policies
 * ```javascript
 * import { combineAccessResults } from './AccessResult.js';
 *
 * const policies = [
 *   new AdminBypassPolicy(),
 *   new PermissionPolicy(),
 *   new OwnershipPolicy(),
 *   new StatusPolicy(),
 * ];
 *
 * const results = policies.map(p => p.check(account, 'update', { entity }));
 * const access = combineAccessResults(results);
 *
 * if (access.isAllowed()) {
 *   // Grant access
 * }
 * ```
 */

import { AccessResult } from './AccessResult.js';

export class AccessPolicy {
  /**
   * Check access for a given account, operation, and context
   *
   * This is a base implementation that returns NEUTRAL.
   * Subclasses should override this method to implement actual access logic.
   *
   * @param {Object} account - User account object with permissions, roles, etc.
   * @param {string} operation - Operation being performed (view, update, delete, create, etc.)
   * @param {Object} context - Additional context (entity, bundle, etc.)
   * @returns {AccessResult} Access result (ALLOWED, FORBIDDEN, or NEUTRAL)
   *
   * @example
   * // Override in subclass:
   * check(account, operation, context) {
   *   if (account.isAdmin) {
   *     return AccessResult.allowed().cachePerUser();
   *   }
   *   return AccessResult.neutral();
   * }
   */
  check(account, operation, context) {
    // Base implementation returns NEUTRAL (no opinion)
    // Subclasses override to implement specific access logic
    return AccessResult.neutral();
  }
}
