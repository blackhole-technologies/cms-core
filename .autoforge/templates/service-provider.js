/**
 * META-PATTERN TEMPLATE: ServiceProvider
 * ========================================
 * 
 * Drupal equivalent: module.services.yml, ServiceProviderInterface
 * 
 * How modules register services with the DI container. Each module can
 * have a services.js file that exports a register(container) function.
 * Services are resolved lazily with dependency injection.
 * 
 * @example Module service registration
 * ```javascript
 * // modules/node/services.js
 * export function register(container) {
 *   // Register a storage service that depends on entity manager and database
 *   container.register('node.storage', (entityManager, database) => {
 *     return new NodeStorage(entityManager, database);
 *   }, {
 *     deps: ['entity_type.manager', 'database'],
 *     tags: ['entity_storage'],
 *     singleton: true,  // default — only instantiated once
 *   });
 * 
 *   // Register an access handler
 *   container.register('node.access', (entityManager) => {
 *     return new NodeAccessControlHandler(entityManager);
 *   }, {
 *     deps: ['entity_type.manager'],
 *     tags: ['entity_access'],
 *   });
 * 
 *   // Register with an alias
 *   container.register('node.route_provider', () => {
 *     return new NodeRouteProvider();
 *   }, {
 *     alias: 'node.routes',
 *   });
 * }
 * ```
 * 
 * @example Using services from other modules
 * ```javascript
 * // In any module's hook_boot:
 * export function hook_boot(context) {
 *   const nodeStorage = context.services.get('node.storage');
 *   const allNodes = await nodeStorage.loadAll();
 * }
 * ```
 * 
 * @example Finding services by tag
 * ```javascript
 * // Get all entity storage handlers
 * const storages = container.getTagged('entity_storage');
 * // Returns [{name: 'node.storage', service: NodeStorage}, ...]
 * ```
 * 
 * @example Optional dependencies
 * ```javascript
 * container.register('my.service', (required, optional) => {
 *   return new MyService(required, optional);
 * }, {
 *   deps: ['required.service', '?optional.service'],
 *   // If optional.service doesn't exist, null is passed
 * });
 * ```
 * 
 * @example Decorating (wrapping) another module's service
 * ```javascript
 * container.decorate('node.storage', (innerStorage) => {
 *   return {
 *     ...innerStorage,
 *     async save(entity) {
 *       console.log('Saving node:', entity.label());
 *       return innerStorage.save(entity);
 *     },
 *   };
 * });
 * ```
 * 
 * Naming convention for service IDs:
 * - {module}.{purpose} — e.g., 'node.storage', 'taxonomy.manager'
 * - {subsystem}.{component} — e.g., 'entity_type.manager', 'plugin.field_type'
 * - Core services use dot-separated descriptive names
 */

// This file is a template/reference — not meant to be imported directly.
// Module authors create their own services.js following this pattern.

/**
 * Example: Full module service provider
 * 
 * @param {Container} container - The DI container from core/lib/DependencyInjection/
 */
export function register(container) {
  // Primary service
  container.register('example.manager', (database, hooks) => {
    return new ExampleManager(database, hooks);
  }, {
    deps: ['database', 'hooks'],
    tags: ['manager'],
    singleton: true,
  });

  // Service with optional dependency
  container.register('example.formatter', (serializer, cache) => {
    return new ExampleFormatter(serializer, cache);
  }, {
    deps: ['serializer', '?cache.backend'],
  });
}

/**
 * How boot.js loads module services:
 * 
 * for (const module of enabledModules) {
 *   const servicesPath = `${module.path}/services.js`;
 *   if (existsSync(servicesPath)) {
 *     const { register } = await import(servicesPath);
 *     container.registerProvider(module.name, register);
 *   }
 * }
 * 
 * After all modules registered, resolve services on first .get() call.
 */
