/**
 * Reference - Declarative Dependency Reference
 * =============================================
 *
 * WHY THIS EXISTS:
 * Allows declaring service dependencies without circular import issues.
 * Instead of importing a service directly, you create a Reference that
 * the container resolves at runtime.
 *
 * Drupal equivalent: Symfony\Component\DependencyInjection\Reference
 *
 * @example Basic usage
 * ```javascript
 * import { Reference } from './core/lib/DependencyInjection/Reference.js';
 *
 * // In service definition:
 * {
 *   id: 'node.storage',
 *   factory: NodeStorage,
 *   deps: [
 *     new Reference('entity_type.manager'),
 *     new Reference('database'),
 *   ]
 * }
 * ```
 *
 * @example Optional dependency
 * ```javascript
 * // Create optional reference by prefixing with '?'
 * new Reference('?logger')
 * ```
 */

export class Reference {
  /**
   * Create a reference to a service
   *
   * @param {string} serviceId - Service identifier (e.g., 'database', 'entity_type.manager')
   *
   * WHY STORE AS PROPERTY:
   * Simple value object pattern. Just needs to carry the service ID
   * for the container to resolve later.
   */
  constructor(serviceId) {
    if (!serviceId || typeof serviceId !== 'string') {
      throw new Error('Reference serviceId must be a non-empty string');
    }

    /**
     * The service identifier to resolve
     * @type {string}
     */
    this.serviceId = serviceId;
  }

  /**
   * Check if this is an optional reference
   *
   * @returns {boolean} True if service ID starts with '?'
   *
   * WHY THIS HELPER:
   * Makes it easier to check if a dependency is optional
   * without manually parsing the string.
   */
  isOptional() {
    return this.serviceId.startsWith('?');
  }

  /**
   * Get the service ID without the optional prefix
   *
   * @returns {string} Service ID without leading '?'
   *
   * WHY THIS HELPER:
   * Container needs the actual service name, not the prefixed version.
   */
  getId() {
    return this.isOptional() ? this.serviceId.slice(1) : this.serviceId;
  }

  /**
   * String representation for debugging
   *
   * @returns {string} String representation
   */
  toString() {
    return `Reference(${this.serviceId})`;
  }
}
