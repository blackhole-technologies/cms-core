/**
 * services.js - Simple Service Container
 *
 * WHY THIS EXISTS:
 * Modules need shared services (database, cache, logger) but shouldn't
 * create their own instances. A service container provides:
 * - Single source of truth for shared resources
 * - Lazy instantiation (create services only when first needed)
 * - Testability (swap real services for mocks)
 * - Decoupling (modules don't import each other directly)
 *
 * WHY NOT DEPENDENCY INJECTION FRAMEWORK:
 * Full DI (like InversifyJS) adds complexity we don't need yet.
 * This simple container covers 90% of use cases.
 * If we outgrow it, we can swap implementations later.
 *
 * DESIGN DECISION: No auto-wiring
 * Services must be registered explicitly. This makes the dependency
 * graph visible and prevents "magic" that's hard to debug.
 */

/**
 * Service storage
 * Structure: { serviceName: { factory, instance, singleton } }
 *
 * WHY STORE FACTORY + INSTANCE:
 * - Factory: Function that creates the service
 * - Instance: Cached result for singletons
 * - Singleton: Whether to cache (default true for services)
 */
const services = {};

/**
 * Register a service factory
 *
 * @param {string} name - Service identifier (e.g., "db", "cache", "logger")
 * @param {Function} factory - Function that returns the service instance
 * @param {Object} options - { singleton: true } by default
 *
 * WHY FACTORY FUNCTION (not direct instance):
 * - Lazy creation: Service isn't created until first use
 * - Fresh instances: Non-singletons get new instance each time
 * - Async support: Factory can be async if service needs setup
 *
 * Example:
 *   register('db', () => new Database(config.db))
 *   register('requestId', () => crypto.randomUUID(), { singleton: false })
 */
export function register(name, factory, options = {}) {
  // WHY DEFAULT TO SINGLETON:
  // Most services (db, cache, logger) should be shared.
  // Per-request services are the exception, not the rule.
  const singleton = options.singleton !== false;

  // WHY ALLOW RE-REGISTRATION:
  // Enables testing (swap real service for mock) and
  // environment-specific overrides (dev vs prod logger).
  // If you need "register once" semantics, check has() first.
  services[name] = {
    factory,
    instance: null,
    singleton,
  };
}

/**
 * Get a service instance
 *
 * @param {string} name - Service identifier
 * @returns {*} - The service instance
 * @throws {Error} - If service not registered
 *
 * WHY THROW ON MISSING (not return undefined):
 * Fail fast. If code asks for 'db' and it doesn't exist,
 * that's a configuration error, not a "maybe" situation.
 */
export function get(name) {
  const service = services[name];

  if (!service) {
    // WHY HELPFUL ERROR MESSAGE:
    // When debugging at 2am, "Service 'db' not found" beats "undefined is not a function"
    throw new Error(
      `Service "${name}" not registered. ` +
      `Available services: ${Object.keys(services).join(', ') || 'none'}`
    );
  }

  // WHY LAZY INSTANTIATION:
  // Only create services that are actually used.
  // A module might register many services, but not all get called.
  if (service.singleton) {
    if (!service.instance) {
      service.instance = service.factory();
    }
    return service.instance;
  }

  // Non-singleton: fresh instance each time
  return service.factory();
}

/**
 * Check if a service is registered
 *
 * WHY THIS EXISTS:
 * Optional dependencies. A module might use cache if available,
 * but work without it:
 *   if (has('cache')) { get('cache').set(...) }
 */
export function has(name) {
  return name in services;
}

/**
 * List all registered service names
 *
 * WHY THIS EXISTS:
 * Debugging and introspection. See what's available.
 * Useful in REPL or admin dashboard.
 */
export function list() {
  return Object.keys(services);
}

/**
 * Clear a service (or all services)
 *
 * WHY THIS EXISTS:
 * Testing cleanup. Reset state between tests.
 * Also useful for hot-reloading in development.
 */
export function clear(name) {
  if (name) {
    delete services[name];
  } else {
    for (const key of Object.keys(services)) {
      delete services[key];
    }
  }
}

/**
 * Reset a singleton's cached instance (force re-creation on next get)
 *
 * WHY THIS EXISTS:
 * Sometimes you need to refresh a service without re-registering.
 * Example: Database reconnection after connection loss.
 */
export function reset(name) {
  if (services[name]) {
    services[name].instance = null;
  }
}
