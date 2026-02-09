/**
 * HookBridge.js - Bridge layer between legacy core/hooks.js and new HookManager
 *
 * WHY THIS EXISTS:
 * CMS-Core is migrating from legacy hooks.js to the new HookManager.
 * This bridge allows both systems to coexist during the transition:
 * - Registrations go to BOTH systems (backward compatibility)
 * - Triggers use HookManager (which includes legacy-registered handlers)
 * - Existing modules keep working without changes
 * - New code can use HookManager exclusively
 *
 * DESIGN DECISIONS:
 * - HookManager handles ALL triggering - single source of truth
 * - Register to BOTH systems - ensures backward compatibility
 * - wrapLegacy() migrates existing handlers - smooth transition path
 * - Deprecation warnings guide developers to new API
 *
 * Drupal equivalent: No direct equivalent (Drupal didn't have dual hook systems)
 */

// WHY SYMBOL: Track if this is first deprecation warning (avoid spam)
const DEPRECATION_LOGGED = Symbol('deprecationLogged');

export class HookBridge {
  /**
   * Create a hook bridge between legacy and new systems.
   *
   * @param {Object} legacyHooks - The legacy core/hooks.js module
   * @param {HookManager} hookManager - The new HookManager instance
   */
  constructor(legacyHooks, hookManager) {
    // WHY: Store references to both systems
    this._legacy = legacyHooks;
    this._hookManager = hookManager;

    // WHY: Track which hooks logged deprecation (avoid spam)
    this[DEPRECATION_LOGGED] = new Set();
  }

  /**
   * Register a handler in BOTH legacy and new systems.
   *
   * WHY BOTH: Ensures backward compatibility during migration.
   * If anything directly calls legacy hooks.trigger(), handlers still fire.
   * New HookManager.invoke() includes all handlers from both systems.
   *
   * @param {string} hookName - Hook name (e.g., 'boot', 'entity:presave')
   * @param {Function} handler - Handler function to call when hook fires
   * @param {Object} options - Registration options
   * @param {number} [options.priority=10] - Execution priority (lower runs first)
   * @param {string} [options.module] - Module name for debugging
   * @param {boolean} [options.once=false] - Auto-remove after first execution
   * @returns {HookBridge} - Returns this for method chaining
   *
   * @example
   * ```javascript
   * bridge.register('entity:presave', async (entity) => {
   *   entity.set('changed', Date.now());
   * }, { module: 'mymod', priority: 10 });
   * ```
   */
  register(hookName, handler, options = {}) {
    const {
      priority = 10,
      module = null,
      once = false,
    } = options;

    // WHY: Register in legacy system with old API signature
    // Legacy hooks.register() takes (hookName, handler, priority, source)
    this._legacy.register(hookName, handler, priority, module);

    // WHY: Register in new HookManager with full options
    // HookManager supports richer metadata (module, once, etc.)
    this._hookManager.on(hookName, handler, {
      priority,
      module,
      once,
    });

    return this;
  }

  /**
   * Trigger a hook using the new HookManager.
   *
   * WHY HOOKMANAGER ONLY:
   * - HookManager is the single source of truth
   * - HookManager already has ALL handlers (legacy + new)
   * - Triggering legacy separately would run handlers twice
   * - HookManager has better error handling and features
   *
   * @param {string} hookName - Hook to trigger
   * @param {*} context - Data passed to each handler
   * @returns {Promise<*>} - Modified context after all handlers
   *
   * @example
   * ```javascript
   * await bridge.trigger('entity:presave', { entity, isNew: true });
   * ```
   */
  async trigger(hookName, context = {}) {
    // WHY: Delegate to HookManager.trigger() (which returns context)
    // HookManager includes handlers registered via both systems
    return this._hookManager.trigger(hookName, context);
  }

  /**
   * Invoke a hook using the new HookManager.
   *
   * WHY SEPARATE FROM trigger():
   * - invoke() returns undefined (fire-and-forget semantics)
   * - trigger() returns context (mutation pattern)
   * - Both delegate to HookManager
   *
   * @param {string} hookName - Hook to invoke
   * @param {*} context - Data passed to each handler
   * @returns {Promise<undefined>} - Returns undefined after execution
   */
  async invoke(hookName, context = {}) {
    // WHY: Delegate to HookManager.invoke() (which returns undefined)
    return this._hookManager.invoke(hookName, context);
  }

  /**
   * Check if any handlers are registered for a hook.
   *
   * WHY CHECK HOOKMANAGER ONLY:
   * HookManager already contains all handlers from both systems
   * (migrated via wrapLegacy() during setup).
   *
   * @param {string} hookName - Hook name to check
   * @returns {boolean} - True if handlers exist
   */
  hasHandlers(hookName) {
    return this._hookManager.hasHandlers(hookName);
  }

  /**
   * Get handler count for a hook.
   *
   * @param {string} hookName - Hook name
   * @returns {number} - Number of registered handlers
   */
  getHandlerCount(hookName) {
    return this._hookManager.getHandlerCount(hookName);
  }

  /**
   * List all registered hook names.
   *
   * @returns {string[]} - Array of hook names
   */
  listHooks() {
    return this._hookManager.listHooks();
  }

  /**
   * Migrate all existing legacy hook handlers to HookManager.
   *
   * WHY THIS EXISTS:
   * When BridgeManager.setup() runs, legacy hooks may already be
   * registered (during early boot). This method migrates them to
   * HookManager so both systems have the same handlers.
   *
   * IMPORTANT: This is called ONCE during boot setup.
   *
   * HOW IT WORKS:
   * Legacy hooks.js stores handlers in a private registry object.
   * We can't directly access it, so we use a workaround:
   * 1. Get list of hooks via listHooks()
   * 2. For each hook, get handler count via getHandlerCount()
   * 3. If count > 0, handlers exist (they're already in legacy registry)
   *
   * LIMITATION:
   * We can't migrate the actual handler functions from legacy registry
   * because core/hooks.js doesn't expose them. Instead, we create a
   * wrapper in HookManager that delegates to legacy.trigger().
   *
   * This means:
   * - HookManager.invoke() → calls legacy.trigger() → runs legacy handlers
   * - Both systems stay in sync during transition
   *
   * @returns {number} - Number of hooks migrated
   */
  wrapLegacy() {
    const legacyHookNames = this._legacy.listHooks();
    let migrated = 0;

    for (const hookName of legacyHookNames) {
      const count = this._legacy.getHandlerCount(hookName);

      // WHY: Skip if no handlers registered
      if (count === 0) {
        continue;
      }

      // WHY: Check if HookManager already has handlers for this hook
      // Avoid creating duplicate wrapper if migration already happened
      if (this._hookManager.hasHandlers(hookName)) {
        // Already migrated (handlers registered via bridge.register())
        continue;
      }

      // WHY: Get actual handler functions from legacy registry
      // This preserves handler behavior including return values
      // (needed for invokeAll() data-collection pattern)
      const legacyHandlers = this._legacy.getHandlers(hookName);

      // WHY: Register each legacy handler individually in HookManager
      // This preserves priority order and source tracking
      for (const { handler, priority, source } of legacyHandlers) {
        this._hookManager.on(hookName, handler, {
          priority,
          module: source || '__legacy__',
        });
      }

      migrated++;
    }

    return migrated;
  }

  /**
   * Clear all handlers for a hook (or all hooks).
   *
   * WHY CLEAR BOTH:
   * Ensures both systems stay in sync during testing/hot-reload.
   *
   * @param {string} hookName - Hook to clear (null = all hooks)
   * @returns {HookBridge} - Returns this for method chaining
   */
  clear(hookName = null) {
    this._legacy.clear(hookName);
    this._hookManager.clear(hookName);
    return this;
  }
}
