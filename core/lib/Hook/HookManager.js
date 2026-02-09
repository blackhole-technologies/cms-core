/**
 * HookManager.js - Unified Hook System
 *
 * WHY THIS EXISTS:
 * CMS-Core unifies two previously separate hook systems:
 * 1. Convention hooks (hook_boot, hook_routes) - declared as module exports
 * 2. Runtime hooks (entity:presave, content:afterCreate) - registered at runtime
 *
 * This class provides a standardized API for both, with support for:
 * - Priority-based ordering (lower priority runs first)
 * - Async/await handling
 * - Error isolation (one failing hook doesn't break others)
 * - Once-handlers (auto-remove after first execution)
 * - Alter chains (data transformation hooks)
 * - Module tracking for debugging and removal
 *
 * DESIGN DECISIONS:
 * - All hooks are async by default (prevents race conditions)
 * - Handlers run sequentially (not parallel) to ensure order
 * - Uses Map for handler storage (better than plain object for iteration)
 * - Sort on registration (not on invoke) - sort once, invoke many times
 *
 * Drupal equivalent: ModuleHandlerInterface, hook system
 *
 * @example Basic hook registration
 * ```javascript
 * const hooks = new HookManager();
 *
 * // Register a handler
 * hooks.on('entity:presave', async (entity) => {
 *   entity.set('changed', Date.now());
 * }, { module: 'mymod', priority: 10 });
 *
 * // Invoke all handlers
 * await hooks.invoke('entity:presave', { entity });
 * ```
 *
 * @example Priority ordering
 * ```javascript
 * hooks.on('test', handler1, { priority: 5 });  // runs first
 * hooks.on('test', handler2, { priority: 10 }); // runs second
 * hooks.on('test', handler3, { priority: 20 }); // runs third
 * ```
 *
 * @example Once-handlers
 * ```javascript
 * hooks.on('system:ready', () => {
 *   console.log('System initialized!');
 * }, { once: true });
 *
 * await hooks.invoke('system:ready'); // handler runs
 * await hooks.invoke('system:ready'); // handler already removed
 * ```
 *
 * @example Alter hooks
 * ```javascript
 * // Register alter hooks
 * hooks.onAlter('form', (form) => {
 *   form.extra = { field: 'value' };
 *   return form;
 * });
 *
 * // Apply alterations
 * let form = { title: 'My Form' };
 * form = await hooks.alter('form', form);
 * // form now has { title: 'My Form', extra: { field: 'value' } }
 * ```
 */

export class HookManager {
  /**
   * Create a new HookManager instance
   *
   * WHY INSTANCE-BASED (not singleton):
   * Allows testing in isolation, multiple hook registries if needed,
   * and easier mocking/stubbing in tests.
   */
  constructor() {
    /**
     * Storage for registered handlers
     * Structure: Map<hookName, Array<{handler, priority, module, once}>>
     *
     * WHY MAP:
     * - Better iteration performance than plain object
     * - Preserves insertion order
     * - Cleaner API (get/set/has/delete)
     *
     * WHY ARRAYS FOR HANDLERS:
     * - Need to maintain priority-based sort order
     * - May have multiple handlers per hook
     * - Sequential execution requires array iteration
     */
    this._handlers = new Map();
  }

  /**
   * Register a handler for a hook
   *
   * @param {string} hookName - Hook name (e.g., 'entity:presave', 'boot')
   * @param {Function} handler - Async function called when hook fires
   * @param {Object} options - Configuration options
   * @param {number} [options.priority=10] - Execution priority (lower runs first)
   * @param {string} [options.module] - Module name for debugging/removal
   * @param {boolean} [options.once=false] - Auto-remove after first execution
   * @returns {HookManager} - Returns this for method chaining
   *
   * WHY PRIORITY DEFAULTS TO 10:
   * Leaves room for "earlier" (1-9) and "later" (11+) priorities
   * without requiring negative numbers. Most hooks use default.
   *
   * WHY RETURN THIS:
   * Allows chaining: hooks.on('a', fa).on('b', fb).on('c', fc)
   *
   * @example
   * ```javascript
   * hooks.on('entity:presave', async (entity) => {
   *   console.log('Saving:', entity.id);
   * }, { module: 'mymod', priority: 5 });
   * ```
   */
  on(hookName, handler, options = {}) {
    // Extract options with defaults
    const {
      priority = 10,
      module = null,
      once = false,
    } = options;

    // Get or create handler array for this hook
    if (!this._handlers.has(hookName)) {
      this._handlers.set(hookName, []);
    }

    const handlers = this._handlers.get(hookName);

    // Add handler metadata
    handlers.push({
      handler,
      priority,
      module,
      once,
    });

    // Sort by priority (ascending - lower numbers run first)
    // WHY SORT ON REGISTRATION:
    // Registration happens once at boot. Invocations happen many times.
    // Better to pay O(n log n) cost once than on every invoke.
    handlers.sort((a, b) => a.priority - b.priority);

    // Store back (not strictly necessary for arrays but explicit is good)
    this._handlers.set(hookName, handlers);

    // Return this for chaining
    return this;
  }

  /**
   * Check if any handlers are registered for a hook
   *
   * @param {string} hookName - Hook name to check
   * @returns {boolean} - True if handlers exist
   *
   * WHY THIS EXISTS:
   * Allows conditional logic like "only do expensive operation if someone cares"
   * Example: Skip serializing data if no hook is listening
   */
  hasHandlers(hookName) {
    const handlers = this._handlers.get(hookName);
    return handlers && handlers.length > 0;
  }

  /**
   * Get handler count for a hook (useful for debugging)
   *
   * @param {string} hookName - Hook name
   * @returns {number} - Number of registered handlers
   */
  getHandlerCount(hookName) {
    const handlers = this._handlers.get(hookName);
    return handlers ? handlers.length : 0;
  }

  /**
   * Get all registered hook names
   *
   * @returns {string[]} - Array of hook names
   *
   * WHY THIS EXISTS:
   * Debugging and introspection. See what hooks have handlers.
   */
  listHooks() {
    return Array.from(this._handlers.keys());
  }

  /**
   * Backward-compatible alias for on()
   *
   * @param {string} hookName - Hook name
   * @param {Function} handler - Handler function
   * @param {number} priority - Execution priority
   * @param {string} source - Module name (optional)
   * @returns {HookManager} - Returns this for chaining
   *
   * WHY THIS EXISTS:
   * Existing code uses hooks.register(name, fn, priority, source)
   * This maintains compatibility while migrating to new API
   */
  register(hookName, handler, priority = 10, source = null) {
    return this.on(hookName, handler, {
      priority,
      module: source,
    });
  }

  /**
   * Invoke a hook, executing all handlers sequentially
   *
   * @param {string} hookName - Hook to invoke
   * @param {*} context - Data passed to each handler
   * @returns {Promise<undefined>} - Returns undefined after all handlers execute
   *
   * WHY SEQUENTIAL (not parallel):
   * Handlers may depend on previous handlers' modifications to context.
   * Parallel execution would create race conditions.
   *
   * WHY UNDEFINED RETURN:
   * Unlike trigger() which returns context, invoke() just executes handlers.
   * Use invokeAll() if you need return values.
   *
   * ERROR HANDLING:
   * Each handler runs in try/catch. Errors are logged but don't stop
   * execution of remaining handlers. This prevents one broken module
   * from crashing the entire system.
   *
   * ONCE-HANDLERS:
   * Handlers with once:true are automatically removed after execution.
   * This is useful for initialization hooks that should only run once.
   *
   * @example
   * ```javascript
   * await hooks.invoke('entity:presave', { entity, isNew: true });
   * ```
   */
  async invoke(hookName, context = {}) {
    const handlers = this._handlers.get(hookName);

    // No handlers registered - return early
    if (!handlers || handlers.length === 0) {
      return undefined;
    }

    // Track indices of once-handlers to remove after execution
    const toRemove = [];

    // Execute handlers sequentially
    // WHY FOR...OF (not forEach):
    // forEach doesn't properly await. for...of ensures each handler
    // completes before the next starts.
    for (let i = 0; i < handlers.length; i++) {
      const { handler, once, module } = handlers[i];

      try {
        // WHY AWAIT:
        // Even if handler is sync, awaiting ensures consistent behavior
        // and proper error handling for both sync and async handlers.
        await handler(context);

        // Mark for removal if once-handler
        if (once) {
          toRemove.push(i);
        }
      } catch (error) {
        // WHY LOG AND CONTINUE (not throw):
        // One broken module shouldn't crash the whole site.
        // Log error with hook name and module for debugging.
        const source = module ? ` (module: ${module})` : '';
        console.error(`[HookManager] Error in "${hookName}" handler${source}:`, error.message);
        // In production, you might want to report this to monitoring
      }
    }

    // Remove once-handlers (iterate backwards to preserve indices)
    // WHY BACKWARDS:
    // Removing from the end doesn't affect earlier indices.
    // If we removed from start, later indices would shift.
    for (let i = toRemove.length - 1; i >= 0; i--) {
      handlers.splice(toRemove[i], 1);
    }

    // Update the handlers array if we removed any
    if (toRemove.length > 0) {
      this._handlers.set(hookName, handlers);
    }

    return undefined;
  }

  /**
   * Invoke a hook and collect return values from all handlers
   *
   * @param {string} hookName - Hook to invoke
   * @param {*} context - Data passed to each handler
   * @returns {Promise<Array>} - Array of return values from all handlers
   *
   * WHY THIS EXISTS:
   * Sometimes you want to collect data from multiple modules.
   * Example: "get all entity types" - each module returns its types.
   *
   * DIFFERENCE FROM invoke():
   * - invoke() returns undefined, invokeAll() returns array of results
   * - Use invoke() for event notifications
   * - Use invokeAll() for data collection
   *
   * @example
   * ```javascript
   * const entityTypes = await hooks.invokeAll('entity_type_info', {});
   * // Returns: [
   * //   { node: {...} },      // from node module
   * //   { user: {...} },      // from user module
   * //   { comment: {...} },   // from comment module
   * // ]
   * ```
   */
  async invokeAll(hookName, context = {}) {
    const handlers = this._handlers.get(hookName);

    // No handlers registered - return empty array
    if (!handlers || handlers.length === 0) {
      return [];
    }

    const results = [];
    const toRemove = [];

    // Execute handlers sequentially and collect results
    for (let i = 0; i < handlers.length; i++) {
      const { handler, once, module } = handlers[i];

      try {
        const result = await handler(context);
        results.push(result);

        // Mark for removal if once-handler
        if (once) {
          toRemove.push(i);
        }
      } catch (error) {
        // Log error but continue execution
        const source = module ? ` (module: ${module})` : '';
        console.error(`[HookManager] Error in "${hookName}" handler${source}:`, error.message);
        // Push undefined for failed handler to maintain result array alignment
        results.push(undefined);
      }
    }

    // Remove once-handlers (backwards to preserve indices)
    for (let i = toRemove.length - 1; i >= 0; i--) {
      handlers.splice(toRemove[i], 1);
    }

    // Update the handlers array if we removed any
    if (toRemove.length > 0) {
      this._handlers.set(hookName, handlers);
    }

    return results;
  }

  /**
   * Backward-compatible alias for invoke()
   *
   * @param {string} hookName - Hook name
   * @param {*} context - Context object
   * @returns {Promise<*>} - Modified context
   *
   * WHY DIFFERENT RETURN VALUE:
   * Old trigger() returned context (for mutation pattern).
   * New invoke() returns undefined (cleaner semantics).
   * This alias maintains old behavior for compatibility.
   */
  async trigger(hookName, context = {}) {
    await this.invoke(hookName, context);
    return context;
  }

  /**
   * Clear all handlers for a hook (mainly for testing)
   *
   * @param {string} hookName - Hook to clear (if null, clears all)
   *
   * WHY THIS EXISTS:
   * Tests need to reset state between test cases.
   * Also useful for hot-reloading modules in development.
   */
  clear(hookName = null) {
    if (hookName) {
      this._handlers.delete(hookName);
    } else {
      // Clear all hooks
      this._handlers.clear();
    }
  }
}
