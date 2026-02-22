/**
 * hooks.ts - Event Registry for Module Hooks
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

// ============================================================================
// Types
// ============================================================================

/** A hook handler receives a mutable context object and optionally returns a promise */
export type HookHandler = (context: Record<string, unknown>) => void | Promise<void>;

/** Internal entry stored per hook name */
interface HookEntry {
    handler: HookHandler;
    priority: number;
    source: string | null;
}

// ============================================================================
// State
// ============================================================================
/**
 * Storage for registered hooks
 * Structure: { hookName: [{ handler, priority, source }] }
 *
 * WHY A PLAIN OBJECT:
 * Map would work, but object literals are more debuggable in console
 * and we don't need Map's key flexibility (our keys are always strings)
 */
const registry: Record<string, HookEntry[]> = {};

// ============================================================================
// Core API
// ============================================================================
/**
 * Register a handler for a hook
 *
 * WHY PRIORITY DEFAULTS TO 10:
 * Leaves room for "earlier" priorities (1-9) without negative numbers.
 * Most modules use default priority; special cases can go lower.
 */
export function register(
    hookName: string,
    handler: HookHandler,
    priority: number = 10,
    source: string | null = null
): void {
    // WHY LAZY INITIALIZATION:
    // We don't know all hook names upfront. Modules define their own hooks.
    // Creating arrays on-demand means zero configuration needed.
    if (!registry[hookName]) {
        registry[hookName] = [];
    }
    registry[hookName]!.push({ handler, priority, source });
    // WHY SORT ON REGISTER (not on trigger):
    // Sorting is O(n log n), but registrations happen once at boot.
    // Triggers may happen many times during runtime.
    registry[hookName]!.sort((a, b) => a.priority - b.priority);
}

/**
 * Trigger a hook, calling all registered handlers in priority order
 *
 * WHY CONTEXT IS MUTABLE:
 * Allows "filter" style hooks where each handler transforms the data.
 * Example: "content:render" hook lets each module modify HTML output.
 *
 * WHY SEQUENTIAL (not parallel):
 * Handlers may depend on previous handlers' modifications.
 * Parallel execution would create race conditions.
 */
export async function trigger(
    hookName: string,
    context: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
    const handlers = registry[hookName] ?? [];
    for (const { handler } of handlers) {
        try {
            // WHY AWAIT EVEN IF SYNC:
            // Consistent behavior regardless of handler implementation.
            await handler(context);
        }
        catch (error: unknown) {
            // WHY LOG AND CONTINUE (not throw):
            // One broken module shouldn't crash the whole site.
            const message = error instanceof Error ? error.message : String(error);
            console.error(`[hooks] Error in "${hookName}" handler:`, message);
        }
    }
    return context;
}

/**
 * Check if any handlers are registered for a hook
 *
 * WHY THIS EXISTS:
 * Allows conditional logic like "only do expensive operation if someone cares"
 */
export function hasHandlers(hookName: string): boolean {
    return (registry[hookName]?.length ?? 0) > 0;
}

/** Get count of registered handlers (useful for debugging) */
export function getHandlerCount(hookName: string): number {
    return registry[hookName]?.length ?? 0;
}

/**
 * Clear all handlers for a hook (mainly for testing)
 *
 * WHY NOT EXPORT registry DIRECTLY:
 * Encapsulation. Tests can reset state without knowing internal structure.
 */
export function clear(hookName?: string): void {
    if (hookName) {
        delete registry[hookName];
    }
    else {
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
 */
export async function invoke(
    hookName: string,
    context: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
    return trigger(hookName, context);
}

/**
 * Alter hook - allows modules to modify data structures
 *
 * WHY THIS EXISTS:
 * Common pattern where core defines a data structure (like plugin definitions)
 * and modules need to modify/add/remove entries.
 *
 * Automatically appends "_alter" to the hook name for convention.
 *
 * Example:
 *   await hooks.alter('plugin_info', definitions, { type: 'field' });
 *   // Triggers "plugin_info_alter" hook with definitions Map
 */
export async function alter(
    hookName: string,
    data: unknown,
    context: Record<string, unknown> = {}
): Promise<unknown> {
    // Append _alter suffix if not already present
    const alterHookName = hookName.endsWith('_alter') ? hookName : `${hookName}_alter`;
    // Pass both data and context to handlers
    const alterContext: Record<string, unknown> = { data, ...context };
    await trigger(alterHookName, alterContext);
    return data;
}

/**
 * Get all registered hook names
 *
 * WHY THIS EXISTS:
 * Debugging and introspection. See what hooks have handlers registered.
 */
export function listHooks(): string[] {
    return Object.keys(registry);
}
