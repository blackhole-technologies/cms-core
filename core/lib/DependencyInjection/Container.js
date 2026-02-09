/**
 * Dependency Injection Container
 * ==============================
 *
 * Drupal equivalent: Symfony DependencyInjection Container
 *
 * Manages service registration, lazy instantiation, and dependency resolution.
 * Services are defined with factories and dependencies, then resolved on-demand.
 *
 * @example Basic registration
 * ```javascript
 * container.register('database', () => new Database(), {
 *   singleton: true,
 *   tags: ['service']
 * });
 *
 * container.register('node.storage', (db) => new NodeStorage(db), {
 *   deps: ['database'],
 *   tags: ['entity_storage']
 * });
 *
 * const storage = container.get('node.storage'); // Resolves database first
 * ```
 */

// WHY SYMBOL: Private field that can't be accidentally accessed or collided with
const _resolving = Symbol('resolving');

export class Container {
  constructor() {
    // Service definitions: name → {factory, deps, tags, singleton, alias}
    this._definitions = new Map();

    // Cached singleton instances: name → instance
    this._instances = new Map();

    // Tag index: tag → Set<serviceName>
    this._tags = new Map();

    // Track services currently being resolved (circular dependency detection)
    // WHY SET: Fast O(1) lookup to detect if service is already in resolution chain
    // WHY SYMBOL: Prevents external code from manipulating this critical safety mechanism
    this[_resolving] = new Set();
  }

  /**
   * Register a service with the container.
   *
   * @param {string} name - Service identifier (e.g., 'node.storage')
   * @param {Function} factory - Factory function that receives resolved dependencies
   * @param {Object} options - Registration options
   * @param {string[]} options.deps - Array of dependency service names
   * @param {string[]} options.tags - Array of tags for service discovery
   * @param {boolean} options.singleton - If true, instance is cached (default: true)
   * @param {string} options.alias - Alternative name for this service
   *
   * @example With dependencies
   * ```javascript
   * container.register('node.storage', (entityManager, database) => {
   *   return new NodeStorage(entityManager, database);
   * }, {
   *   deps: ['entity_type.manager', 'database'],
   *   tags: ['entity_storage'],
   *   singleton: true
   * });
   * ```
   *
   * @example With optional dependency (prefix with '?')
   * ```javascript
   * container.register('cache.service', (backend, logger) => {
   *   return new CacheService(backend, logger); // logger may be null
   * }, {
   *   deps: ['cache.backend', '?logger']
   * });
   * ```
   */
  register(name, factory, options = {}) {
    const {
      deps = [],
      tags = [],
      singleton = true,
      alias = null,
    } = options;

    // Store service definition (without alias field in the main service)
    this._definitions.set(name, {
      factory,
      deps,
      tags,
      singleton,
    });

    // Index by tags for discovery
    for (const tag of tags) {
      if (!this._tags.has(tag)) {
        this._tags.set(tag, new Set());
      }
      this._tags.get(tag).add(name);
    }

    // If alias provided, register it as a reference to the main service
    if (alias) {
      this._definitions.set(alias, {
        factory: null,
        deps: [],
        tags: [],
        singleton: false,
        alias: name, // Points to the real service
      });
    }

    return this; // Enable chaining
  }

  /**
   * Get a service instance, resolving dependencies recursively.
   *
   * WHY RECURSIVE: Dependencies may have their own dependencies.
   * WHY CACHING: Singletons should only be instantiated once.
   *
   * @param {string} name - Service name (or alias)
   * @returns {*} Service instance
   * @throws {Error} If service not found or circular dependency detected
   *
   * @example
   * ```javascript
   * const storage = container.get('node.storage');
   * // Automatically resolves 'entity_type.manager' and 'database' first
   * ```
   */
  get(name) {
    // Handle optional dependencies (prefixed with '?')
    const isOptional = name.startsWith('?');
    const actualName = isOptional ? name.slice(1) : name;

    // Check if service exists
    if (!this._definitions.has(actualName)) {
      if (isOptional) {
        return null; // Optional dependency not found
      }

      // Throw descriptive error with available services
      const available = Array.from(this._definitions.keys()).slice(0, 10);
      const list = available.join(', ');
      const more = this._definitions.size > 10 ? `, and ${this._definitions.size - 10} more` : '';
      throw new Error(
        `Service '${actualName}' not found. Available services: ${list}${more}`
      );
    }

    // Circular dependency detection
    // WHY CHECK BEFORE RESOLUTION: If this service is already being resolved,
    // we've hit a cycle (A → B → C → A). Show the full chain to help debugging.
    if (this[_resolving].has(actualName)) {
      const chain = Array.from(this[_resolving]);
      chain.push(actualName); // Add the duplicate to show the cycle
      throw new Error(
        `Circular dependency detected: ${chain.join(' → ')}`
      );
    }

    const definition = this._definitions.get(actualName);

    // Handle aliases (redirect to target service)
    // WHY CHECK: Prevent infinite recursion if alias points to itself
    if (definition.alias && definition.alias !== actualName) {
      return this.get(definition.alias);
    }

    // Return cached singleton if available
    // WHY BEFORE RESOLUTION TRACKING: Cached instances don't need dependency resolution
    if (definition.singleton && this._instances.has(actualName)) {
      return this._instances.get(actualName);
    }

    // Track that we're resolving this service (for cycle detection)
    this[_resolving].add(actualName);

    try {
      // Resolve dependencies recursively
      const resolvedDeps = definition.deps.map(dep => this.get(dep));

      // Call factory with resolved dependencies
      const instance = definition.factory(...resolvedDeps);

      // Cache singleton instances
      if (definition.singleton) {
        this._instances.set(actualName, instance);
      }

      return instance;
    } finally {
      // WHY FINALLY: Always clean up resolution tracking, even if factory throws
      // This ensures the container remains usable after errors
      this[_resolving].delete(actualName);
    }
  }

  /**
   * Get all services tagged with a specific tag.
   *
   * WHY USEFUL: Allows discovering all implementations of a pattern
   * (e.g., all entity storages, all plugin managers).
   *
   * @param {string} tag - Tag to search for
   * @returns {Array<{name: string, service: *}>} Array of service objects
   *
   * @example
   * ```javascript
   * const storages = container.getTagged('entity_storage');
   * // [{name: 'node.storage', service: NodeStorage}, ...]
   * ```
   */
  getTagged(tag) {
    if (!this._tags.has(tag)) {
      return [];
    }

    const serviceNames = Array.from(this._tags.get(tag));
    return serviceNames.map(name => ({
      name,
      service: this.get(name),
    }));
  }

  /**
   * Check if a service is registered.
   *
   * @param {string} name - Service name
   * @returns {boolean}
   */
  has(name) {
    return this._definitions.has(name);
  }

  /**
   * List all registered service names.
   *
   * @returns {string[]} Array of service names
   */
  list() {
    return Array.from(this._definitions.keys());
  }

  /**
   * Clear cached singleton instances (keeps definitions).
   *
   * WHY NEEDED: For testing, hot-reloading, or forcing re-instantiation.
   * Definitions remain so services can be re-created.
   *
   * @example
   * ```javascript
   * container.reset(); // Clear all cached instances
   * const storage = container.get('node.storage'); // Creates new instance
   * ```
   */
  reset() {
    this._instances.clear();
    return this;
  }

  /**
   * Get a lazy proxy for a service.
   *
   * WHY LAZY: Defers instantiation until first property access.
   * Useful for circular dependencies or optional heavy services.
   *
   * @param {string} name - Service name
   * @returns {Proxy} Proxy that instantiates on first access
   *
   * @example
   * ```javascript
   * const storage = container.getLazy('node.storage');
   * // Not instantiated yet
   *
   * await storage.loadAll(); // Now instantiated and method called
   * ```
   */
  getLazy(name) {
    let instance = null;

    return new Proxy({}, {
      get: (target, prop) => {
        // Instantiate on first property access
        if (instance === null) {
          instance = this.get(name);
        }

        const value = instance[prop];

        // Bind methods to preserve context
        if (typeof value === 'function') {
          return value.bind(instance);
        }

        return value;
      },

      set: (target, prop, value) => {
        // Instantiate on first property set
        if (instance === null) {
          instance = this.get(name);
        }

        instance[prop] = value;
        return true;
      },

      has: (target, prop) => {
        if (instance === null) {
          instance = this.get(name);
        }
        return prop in instance;
      },
    });
  }

  /**
   * Register a module's service provider.
   *
   * WHY PATTERN: Modules export a register(container) function.
   * This method calls it and tracks which module registered what.
   *
   * @param {string} moduleName - Module identifier
   * @param {Function} registrar - Function that receives container
   *
   * @example
   * ```javascript
   * // In core/boot.js:
   * const { register } = await import('./modules/node/services.js');
   * container.registerProvider('node', register);
   * ```
   */
  registerProvider(moduleName, registrar) {
    // Call the module's registration function
    registrar(this);
    return this;
  }

  /**
   * Decorate (wrap) an existing service.
   *
   * WHY USEFUL: Allows modules to enhance other modules' services
   * without modifying them (Open/Closed Principle).
   *
   * @param {string} name - Service name to decorate
   * @param {Function} decorator - Function that receives inner service, returns wrapper
   *
   * @example
   * ```javascript
   * container.decorate('node.storage', (innerStorage) => {
   *   return {
   *     ...innerStorage,
   *     async save(entity) {
   *       console.log('Saving:', entity.id);
   *       return innerStorage.save(entity);
   *     }
   *   };
   * });
   * ```
   */
  decorate(name, decorator) {
    if (!this._definitions.has(name)) {
      throw new Error(`Cannot decorate unknown service: ${name}`);
    }

    const original = this._definitions.get(name);
    const originalFactory = original.factory;

    // Replace factory with decorated version
    this._definitions.set(name, {
      ...original,
      factory: (...deps) => {
        const innerService = originalFactory(...deps);
        return decorator(innerService);
      },
    });

    // Clear cached instance if it exists
    if (this._instances.has(name)) {
      this._instances.delete(name);
    }

    return this;
  }

  /**
   * Validate all registered service dependencies without instantiation.
   *
   * WHY STATIC ANALYSIS: Catches circular dependencies and missing services
   * at boot time, before any service is actually created. Much safer than
   * discovering cycles during runtime when a user action triggers resolution.
   *
   * @returns {Array<string>} Array of validation issues (empty if valid)
   *
   * @example
   * ```javascript
   * const issues = container.validateDependencies();
   * if (issues.length > 0) {
   *   console.error('Container validation failed:');
   *   issues.forEach(issue => console.error(`  - ${issue}`));
   *   process.exit(1);
   * }
   * ```
   */
  validateDependencies() {
    const issues = [];

    // Track visited services and current path for cycle detection
    // WHY THREE STATES (like DFS): WHITE=unvisited, GRAY=visiting, BLACK=done
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const state = new Map();

    // Initialize all services as WHITE (unvisited)
    for (const name of this._definitions.keys()) {
      state.set(name, WHITE);
    }

    /**
     * Depth-first traversal to detect cycles.
     *
     * WHY DFS: Can reconstruct the exact cycle path by tracking the current path.
     * WHY NOT BFS: BFS can detect cycles but can't easily show which nodes form the cycle.
     *
     * @param {string} name - Service name to visit
     * @param {string[]} path - Current resolution path
     */
    const visit = (name, path) => {
      const currentState = state.get(name);

      // If GRAY, we've found a cycle (back to a service on current path)
      if (currentState === GRAY) {
        const cycleStart = path.indexOf(name);
        const cycle = [...path.slice(cycleStart), name];
        issues.push(`Circular dependency: ${cycle.join(' → ')}`);
        return;
      }

      // If BLACK, already fully processed (no cycle through here)
      if (currentState === BLACK) {
        return;
      }

      // Mark as GRAY (currently visiting)
      state.set(name, GRAY);
      path.push(name);

      const definition = this._definitions.get(name);

      // Check each dependency
      for (const dep of definition.deps) {
        // Handle optional dependencies (prefixed with '?')
        const isOptional = dep.startsWith('?');
        const actualDep = isOptional ? dep.slice(1) : dep;

        // Skip aliases (they redirect, don't create cycles)
        const depDef = this._definitions.get(actualDep);
        if (depDef && depDef.alias) {
          // Check the alias target instead
          const target = depDef.alias;
          if (!this._definitions.has(target)) {
            issues.push(`Service '${name}' depends on alias '${actualDep}' which points to non-existent service '${target}'`);
          }
          continue;
        }

        // Validate dependency exists
        if (!this._definitions.has(actualDep)) {
          if (!isOptional) {
            issues.push(`Service '${name}' depends on non-existent service '${actualDep}'`);
          }
          // Optional missing dependency is OK - skip visiting it
          continue;
        }

        // Recursively visit dependency
        visit(actualDep, path);
      }

      // Mark as BLACK (fully processed)
      path.pop();
      state.set(name, BLACK);
    };

    // Visit all services (graph may be disconnected)
    for (const name of this._definitions.keys()) {
      const definition = this._definitions.get(name);

      // Skip aliases in top-level iteration (they're checked in visit())
      if (definition.alias) {
        continue;
      }

      if (state.get(name) === WHITE) {
        visit(name, []);
      }
    }

    return issues;
  }
}
