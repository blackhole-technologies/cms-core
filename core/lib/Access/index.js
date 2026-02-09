/**
 * Access System - Barrel Export
 *
 * Re-exports all Access system classes and functions for convenient importing.
 *
 * @example
 * import { AccessResult, combineAccessResults, AccessPolicy } from './core/lib/Access/index.js';
 *
 * // Use in access control:
 * const result = AccessResult.allowed().cachePerPermissions();
 *
 * // Combine multiple policies:
 * const combined = combineAccessResults([
 *   permissionPolicy.check(account, 'view', entity),
 *   ownershipPolicy.check(account, 'view', entity),
 * ]);
 */

export { AccessResult, combineAccessResults } from './AccessResult.js';
export { AccessPolicy } from './AccessPolicy.js';
