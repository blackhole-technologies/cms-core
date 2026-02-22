/**
 * services.ts - Simple Service Container
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
 *
 * DESIGN DECISION: No auto-wiring
 * Services must be registered explicitly. This makes the dependency
 * graph visible and prevents "magic" that's hard to debug.
 */

// ============================================================================
// Types
// ============================================================================

/** Options passed to register() */
export interface ServiceRegisterOptions {
    /** Whether to cache the instance (default: true). Set to false for
     *  transient services that should be freshly created on every get(). */
    singleton?: boolean;
}

/** Internal descriptor stored for each registered service */
interface ServiceDescriptor {
    /** Factory function that creates the service instance */
    factory: () => unknown;
    /** Cached instance for singletons (null until first get()) */
    instance: unknown;
    /** Whether to cache the instance */
    singleton: boolean;
}

// ============================================================================
// State
// ============================================================================

/**
 * Service storage
 * WHY STORE FACTORY + INSTANCE:
 * - Factory: Function that creates the service
 * - Instance: Cached result for singletons
 * - Singleton: Whether to cache (default true for services)
 */
const services: Record<string, ServiceDescriptor> = {};

// ============================================================================
// Core API
// ============================================================================

/**
 * Register a service factory
 *
 * WHY FACTORY FUNCTION (not direct instance):
 * - Lazy creation: Service isn't created until first use
 * - Fresh instances: Non-singletons get new instance each time
 * - Async support: Factory can be async if service needs setup
 *
 * WHY ALLOW RE-REGISTRATION:
 * Enables testing (swap real service for mock) and
 * environment-specific overrides (dev vs prod logger).
 */
export function register(
    name: string,
    factory: () => unknown,
    options: ServiceRegisterOptions = {}
): void {
    // WHY DEFAULT TO SINGLETON:
    // Most services (db, cache, logger) should be shared.
    const singleton = options.singleton !== false;
    services[name] = {
        factory: factory,
        instance: null,
        singleton,
    };
}

/**
 * Get a service instance
 *
 * WHY THROW ON MISSING (not return undefined):
 * Fail fast. If code asks for 'db' and it doesn't exist,
 * that's a configuration error, not a "maybe" situation.
 */
export function get(name: string): unknown {
    const service = services[name];
    if (!service) {
        throw new Error(
            `Service "${name}" not registered. ` +
            `Available services: ${Object.keys(services).join(', ') || 'none'}`
        );
    }
    // WHY LAZY INSTANTIATION:
    // Only create services that are actually used.
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
export function has(name: string): boolean {
    return name in services;
}

/**
 * List all registered service names
 *
 * WHY THIS EXISTS:
 * Debugging and introspection. See what's available.
 */
export function list(): string[] {
    return Object.keys(services);
}

/**
 * Clear a service (or all services)
 *
 * WHY THIS EXISTS:
 * Testing cleanup. Reset state between tests.
 * Also useful for hot-reloading in development.
 */
export function clear(name?: string): void {
    if (name) {
        delete services[name];
    }
    else {
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
export function reset(name: string): void {
    const service = services[name];
    if (service) {
        service.instance = null;
    }
}
