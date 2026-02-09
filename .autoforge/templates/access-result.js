/**
 * META-PATTERN TEMPLATE: AccessResult
 * =====================================
 * 
 * Drupal equivalent: AccessResult.php, AccessResultInterface.php
 * 
 * Cacheable access results that replace inline permission checks.
 * Instead of `if (user.role !== 'admin') return 403;`, code returns
 * AccessResult objects that carry cache metadata and can be combined.
 * 
 * Three states:
 * - ALLOWED: User has access. Can be overridden by FORBIDDEN.
 * - FORBIDDEN: User is denied. Always wins when combined.
 * - NEUTRAL: No opinion. Falls through to other checks.
 * 
 * Combination logic:
 * - orIf: FORBIDDEN wins, then ALLOWED, then NEUTRAL
 * - andIf: FORBIDDEN wins, both must be ALLOWED for ALLOWED, else NEUTRAL
 * 
 * @example Basic usage
 * ```javascript
 * import { AccessResult } from '../core/lib/Access/AccessResult.js';
 * 
 * // Permission check
 * function checkAccess(account, operation) {
 *   if (account.hasPermission('administer nodes')) {
 *     return AccessResult.allowed().cachePerPermissions();
 *   }
 *   if (operation === 'view' && account.hasPermission('view published content')) {
 *     return AccessResult.allowed().cachePerPermissions();
 *   }
 *   return AccessResult.neutral('No matching permission');
 * }
 * ```
 * 
 * @example Combining results from multiple access policies
 * ```javascript
 * import { AccessResult, combineAccessResults } from '../core/lib/Access/index.js';
 * 
 * const results = [
 *   permissionCheck(account, 'view'),      // ALLOWED
 *   ownershipCheck(entity, account),        // NEUTRAL (not owner)
 *   moderationCheck(entity),                // ALLOWED (published)
 * ];
 * 
 * const final = combineAccessResults(results);
 * // ALLOWED (first ALLOWED wins when no FORBIDDEN)
 * ```
 * 
 * @example Access handler for an entity type
 * ```javascript
 * // modules/node/NodeAccessControlHandler.js
 * import { AccessResult } from '../../core/lib/Access/AccessResult.js';
 * 
 * export class NodeAccessControlHandler {
 *   access(entity, operation, account) {
 *     // Admin bypass
 *     if (account.hasPermission('bypass node access')) {
 *       return AccessResult.allowed()
 *         .cachePerPermissions();
 *     }
 * 
 *     // Operation-specific check
 *     const perm = `${operation} ${entity.bundle()} content`;
 *     if (account.hasPermission(perm)) {
 *       return AccessResult.allowed()
 *         .cachePerPermissions()
 *         .addCacheTags([`node:${entity.id()}`]);
 *     }
 * 
 *     // Own content check
 *     if ((operation === 'update' || operation === 'delete')) {
 *       const ownPerm = `${operation} own ${entity.bundle()} content`;
 *       if (account.hasPermission(ownPerm) && entity.get('uid') === account.id) {
 *         return AccessResult.allowed()
 *           .cachePerPermissions()
 *           .cachePerUser();
 *       }
 *     }
 * 
 *     return AccessResult.neutral(`No ${operation} access to ${entity.bundle()}`);
 *   }
 * 
 *   createAccess(bundle, account) {
 *     const perm = `create ${bundle} content`;
 *     if (account.hasPermission(perm)) {
 *       return AccessResult.allowed().cachePerPermissions();
 *     }
 *     return AccessResult.neutral();
 *   }
 * }
 * ```
 * 
 * @example Route-level access declarations
 * ```javascript
 * // In route registration:
 * router.register('GET', '/node/{node}', {
 *   handler: viewController,
 *   access: {
 *     _entity_access: 'node.view',  // Checks entity access handler
 *   },
 * });
 * 
 * router.register('GET', '/admin/content', {
 *   handler: listController,
 *   access: {
 *     _permission: 'access content overview',  // Checks single permission
 *   },
 * });
 * 
 * router.register('GET', '/admin/config', {
 *   handler: configController,
 *   access: {
 *     _role: 'administrator',  // Checks role membership
 *   },
 * });
 * ```
 * 
 * Cache metadata on access results:
 * - cacheContexts: What makes this result vary (e.g., 'user.permissions', 'user')
 * - cacheTags: What invalidates this result (e.g., 'node:42')
 * - cacheMaxAge: How long this result is valid (-1 = permanent, 0 = uncacheable)
 */

const REASON = Symbol('reason');
const CACHE_TAGS = Symbol('cacheTags');
const CACHE_CONTEXTS = Symbol('cacheContexts');
const CACHE_MAX_AGE = Symbol('cacheMaxAge');

export class AccessResult {
  constructor(allowed, neutral = false) {
    this._allowed = allowed;
    this._neutral = neutral;
    this._forbidden = !allowed && !neutral;
    this[REASON] = '';
    this[CACHE_TAGS] = new Set();
    this[CACHE_CONTEXTS] = new Set();
    this[CACHE_MAX_AGE] = -1;
  }

  /** Create an ALLOWED result */
  static allowed() {
    return new AccessResult(true);
  }

  /** Create a FORBIDDEN result with reason */
  static forbidden(reason = '') {
    const result = new AccessResult(false);
    result[REASON] = reason;
    return result;
  }

  /** Create a NEUTRAL result (no opinion) */
  static neutral(reason = '') {
    const result = new AccessResult(false, true);
    result[REASON] = reason;
    return result;
  }

  isAllowed() { return this._allowed; }
  isForbidden() { return this._forbidden; }
  isNeutral() { return this._neutral; }
  getReason() { return this[REASON]; }

  /** Combine: FORBIDDEN wins, then ALLOWED, then NEUTRAL */
  orIf(other) {
    if (this.isForbidden() || other.isForbidden()) {
      return AccessResult.forbidden(this.isForbidden() ? this[REASON] : other[REASON]);
    }
    if (this.isAllowed() || other.isAllowed()) return AccessResult.allowed();
    return AccessResult.neutral();
  }

  /** Combine: both must be ALLOWED for ALLOWED */
  andIf(other) {
    if (this.isForbidden() || other.isForbidden()) {
      return AccessResult.forbidden(this.isForbidden() ? this[REASON] : other[REASON]);
    }
    if (this.isAllowed() && other.isAllowed()) return AccessResult.allowed();
    return AccessResult.neutral();
  }

  // ---- Cache metadata ----

  addCacheContexts(contexts) {
    for (const ctx of contexts) this[CACHE_CONTEXTS].add(ctx);
    return this;
  }

  addCacheTags(tags) {
    for (const tag of tags) this[CACHE_TAGS].add(tag);
    return this;
  }

  cachePerPermissions() {
    return this.addCacheContexts(['user.permissions']);
  }

  cachePerUser() {
    return this.addCacheContexts(['user']);
  }
}

/**
 * Combine multiple access results using orIf logic.
 * Short-circuits on first FORBIDDEN.
 */
export function combineAccessResults(results) {
  let combined = AccessResult.neutral();
  for (const result of results) {
    combined = combined.orIf(result);
    if (combined.isForbidden()) return combined;
  }
  return combined;
}
