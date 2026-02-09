/**
 * ServiceBridge.js - Bridge layer between legacy core/services.js and new Container
 *
 * WHY THIS EXISTS:
 * CMS-Core is migrating from legacy services.js to the new DI Container.
 * This bridge allows both systems to coexist during the transition:
 * - Registrations go to BOTH systems (backward compatibility)
 * - Lookups prefer new Container (forward migration)
 * - Existing modules keep working without changes
 * - New code can use Container exclusively
 *
 * DESIGN DECISIONS:
 * - Container first on get() - encourages migration to new system
 * - Register to BOTH systems - ensures backward compatibility
 * - Deprecation warnings on legacy-only access - guides developers
 * - wrapLegacy() migrates existing services - smooth transition path
 *
 * Drupal equivalent: No direct equivalent (Drupal didn't have dual systems)
 */

// WHY SYMBOL: Track if this is first deprecation warning (avoid spam)
const DEPRECATION_LOGGED = Symbol('deprecationLogged');

export class ServiceBridge {
  /**
   * Create a service bridge between legacy and new systems.
   *
   * @param {Object} legacyServices - The legacy core/services.js module
   * @param {Container} container - The new DI Container instance
   */
  constructor(legacyServices, container) {
    // WHY: Store references to both systems
    this._legacy = legacyServices;
    this._container = container;

    // WHY: Track which services are legacy-only (for deprecation warnings)
    this[DEPRECATION_LOGGED] = new Set();
  }

  /**
   * Register a service in BOTH legacy and new systems.
   *
   * WHY BOTH: Ensures backward compatibility during migration.
   * Existing code using legacy services.get() keeps working.
   * New code using container.get() works immediately.
   *
   * @param {string} name - Service identifier
   * @param {Function} factory - Factory function that creates the service
   * @param {Array<string>} deps - Dependency service names (for Container)
   * @returns {ServiceBridge} - Returns this for method chaining
   *
   * @example
   * ```javascript
   * bridge.register('database', () => new Database(), []);
   * bridge.register('node.storage', (db) => new NodeStorage(db), ['database']);
   * ```
   */
  register(name, factory, deps = []) {
    // WHY: Register in legacy system with original API
    // Legacy services.register() takes (name, factory, options)
    this._legacy.register(name, factory, { singleton: true });

    // WHY: Register in new Container with dependency support
    // Container needs deps array for automatic resolution
    this._container.register(name, factory, {
      deps,
      singleton: true,
    });

    return this;
  }

  /**
   * Get a service instance, preferring the new Container.
   *
   * WHY CONTAINER FIRST:
   * - Container has better dependency resolution
   * - Container supports tags, decorators, lazy loading
   * - Encourages migration to new system
   * - Falls back to legacy for compatibility
   *
   * @param {string} name - Service identifier
   * @returns {*} - Service instance
   * @throws {Error} - If service not found in either system
   */
  get(name) {
    // WHY: Try Container first
    if (this._container.has(name)) {
      return this._container.get(name);
    }

    // WHY: Fall back to legacy if Container doesn't have it
    if (this._legacy.has(name)) {
      // WHY: Log deprecation warning once per service (not every access)
      // This guides developers to migrate without spamming console
      if (!this[DEPRECATION_LOGGED].has(name)) {
        console.warn(
          `[ServiceBridge] Accessing legacy-only service "${name}". ` +
          `Consider registering it in the Container via BridgeManager.setup(). ` +
          `Legacy services.js will be deprecated in a future release.`
        );
        this[DEPRECATION_LOGGED].add(name);
      }

      return this._legacy.get(name);
    }

    // WHY: Neither system has it - throw descriptive error
    throw new Error(
      `Service "${name}" not found in Container or legacy services. ` +
      `Available services: ${this.list().join(', ')}`
    );
  }

  /**
   * Check if a service exists in either system.
   *
   * @param {string} name - Service identifier
   * @returns {boolean} - True if service exists
   */
  has(name) {
    return this._container.has(name) || this._legacy.has(name);
  }

  /**
   * List all registered service names from both systems.
   *
   * WHY COMBINED: Gives complete view of available services.
   * Useful for debugging and introspection.
   *
   * @returns {string[]} - Array of all service names
   */
  list() {
    // WHY: Combine lists from both systems, remove duplicates
    const containerServices = this._container.list();
    const legacyServices = this._legacy.list();
    return [...new Set([...containerServices, ...legacyServices])];
  }

  /**
   * Migrate all existing legacy services to the Container.
   *
   * WHY THIS EXISTS:
   * When BridgeManager.setup() runs, legacy services may already be
   * registered (during early boot). This method migrates them to the
   * Container so both systems have the same services.
   *
   * IMPORTANT: This is called ONCE during boot setup, not on every service access.
   *
   * @returns {number} - Number of services migrated
   *
   * @example
   * ```javascript
   * // In boot.js after creating bridge:
   * const migratedCount = serviceBridge.wrapLegacy();
   * console.log(`Migrated ${migratedCount} legacy services to Container`);
   * ```
   */
  wrapLegacy() {
    const legacyNames = this._legacy.list();
    let migrated = 0;

    for (const name of legacyNames) {
      // WHY: Skip if already in Container (avoid duplicate registration)
      if (this._container.has(name)) {
        continue;
      }

      // WHY: Create wrapper factory that delegates to legacy system
      // This allows Container to provide legacy services without re-implementing them
      const factory = () => this._legacy.get(name);

      // WHY: Register in Container with zero dependencies
      // Legacy services don't have explicit dependency metadata,
      // so we register them as standalone services
      this._container.register(name, factory, {
        deps: [], // WHY: Legacy services don't declare dependencies
        singleton: true, // WHY: Match legacy behavior (most services are singletons)
      });

      migrated++;
    }

    return migrated;
  }

  /**
   * Reset cached instances in both systems.
   *
   * WHY THIS EXISTS:
   * Testing and hot-reloading need to force service re-creation.
   * This resets both systems to ensure consistency.
   *
   * @returns {ServiceBridge} - Returns this for method chaining
   */
  reset() {
    this._container.reset();
    // WHY: Legacy services.js uses reset() for individual services
    // We need to reset all of them - iterate and reset each
    const legacyNames = this._legacy.list();
    for (const name of legacyNames) {
      this._legacy.reset(name);
    }
    return this;
  }
}
