/**
 * hooks.js - Event Registry for Module Hooks
 *
 * WHY THIS EXISTS:
 * Modules need a way to extend core behavior without modifying core code.
 * Hooks provide a pub/sub pattern where:
 * - Core defines extension points (e.g., "content:beforeSave")
 * - Modules register handlers for those points
 * - Core triggers hooks at appropriate times
 *
 * WHY NOT USE EventEmitter DIRECTLY:
 * We want explicit control over:
 * - Priority ordering (some hooks must run before others)
 * - Async handling (hooks may need to await async operations)
 * - Error isolation (one failing hook shouldn't break others)
 *
 * DESIGN DECISION: Hooks are async by default
 * Even if a handler is sync, we treat it as async. This allows modules
 * to be written without knowing if other handlers are async, preventing
 * subtle race conditions when modules are added later.
 */

/**
 * Storage for registered hooks
 * Structure: { hookName: [{ handler, priority }] }
 *
 * WHY A PLAIN OBJECT:
 * Map would work, but object literals are more debuggable in console
 * and we don't need Map's key flexibility (our keys are always strings)
 */
const registry = {};

/**
 * Register a handler for a hook
 *
 * @param {string} hookName - The hook to listen for (e.g., "boot", "ready")
 * @param {Function} handler - Async function to call when hook fires
 * @param {number} priority - Lower numbers run first (default: 10)
 * @param {string} source - Optional identifier for debugging (e.g., "hello")
 *
 * WHY PRIORITY DEFAULTS TO 10:
 * Leaves room for "earlier" priorities (1-9) without negative numbers.
 * Most modules use default priority; special cases can go lower.
 */
export function register(hookName, handler, priority = 10, source = null) {
  // WHY LAZY INITIALIZATION:
  // We don't know all hook names upfront. Modules define their own hooks.
  // Creating arrays on-demand means zero configuration needed.
  if (!registry[hookName]) {
    registry[hookName] = [];
  }

  registry[hookName].push({ handler, priority, source });

  // WHY SORT ON REGISTER (not on trigger):
  // Sorting is O(n log n), but registrations happen once at boot.
  // Triggers may happen many times during runtime.
  // Better to pay the cost once during startup.
  registry[hookName].sort((a, b) => a.priority - b.priority);
}

/**
 * Trigger a hook, calling all registered handlers in priority order
 *
 * @param {string} hookName - The hook to trigger
 * @param {*} context - Data passed to each handler (handlers may mutate it)
 * @returns {Promise<*>} - The context after all handlers have processed it
 *
 * WHY CONTEXT IS MUTABLE:
 * Allows "filter" style hooks where each handler transforms the data.
 * Example: "content:render" hook lets each module modify HTML output.
 *
 * WHY SEQUENTIAL (not parallel):
 * Handlers may depend on previous handlers' modifications.
 * Parallel execution would create race conditions.
 * If you need parallel, use separate hooks.
 */
export async function trigger(hookName, context = {}) {
  const handlers = registry[hookName] || [];

  // WHY FOR...OF (not forEach):
  // forEach doesn't await properly. for...of with await ensures
  // each handler completes before the next starts.
  for (const { handler } of handlers) {
    try {
      // WHY AWAIT EVEN IF SYNC:
      // Consistent behavior regardless of handler implementation.
      // No surprises when a sync handler becomes async later.
      await handler(context);
    } catch (error) {
      // WHY LOG AND CONTINUE (not throw):
      // One broken module shouldn't crash the whole site.
      // In production, you might want to report this differently.
      console.error(`[hooks] Error in "${hookName}" handler:`, error.message);
    }
  }

  return context;
}

/**
 * Check if any handlers are registered for a hook
 *
 * WHY THIS EXISTS:
 * Allows conditional logic like "only do expensive operation if someone cares"
 * Example: Skip serializing data if no hook is listening
 */
export function hasHandlers(hookName) {
  return (registry[hookName]?.length || 0) > 0;
}

/**
 * Get count of registered handlers (useful for debugging)
 */
export function getHandlerCount(hookName) {
  return registry[hookName]?.length || 0;
}

/**
 * Clear all handlers for a hook (mainly for testing)
 *
 * WHY NOT EXPORT registry DIRECTLY:
 * Encapsulation. Tests can reset state without knowing internal structure.
 * If we change from object to Map later, this API stays the same.
 */
export function clear(hookName) {
  if (hookName) {
    delete registry[hookName];
  } else {
    // Clear all - use with caution
    for (const key of Object.keys(registry)) {
      delete registry[key];
    }
  }
}

/**
 * Invoke a hook - alias for trigger()
 *
 * WHY ALIAS:
 * "invoke" reads more naturally in boot code: hooks.invoke('boot', context)
 * "trigger" reads better for events: hooks.trigger('content:saved', data)
 * Both do the same thing; use whichever fits your mental model.
 *
 * @param {string} hookName - The hook to invoke
 * @param {*} context - Data passed to each handler
 * @returns {Promise<*>} - The context after all handlers have processed it
 */
export async function invoke(hookName, context = {}) {
  return trigger(hookName, context);
}

/**
 * Get all registered hook names
 *
 * WHY THIS EXISTS:
 * Debugging and introspection. See what hooks have handlers registered.
 */
export function listHooks() {
  return Object.keys(registry);
}
