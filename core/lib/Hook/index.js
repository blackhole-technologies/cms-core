/**
 * Hook System - Barrel Export
 *
 * Unified hook system for CMS-Core.
 * Provides event-driven extensibility for modules.
 *
 * @example
 * ```javascript
 * import { HookManager } from './core/lib/Hook/index.js';
 *
 * const hooks = new HookManager();
 *
 * // Register handlers
 * hooks.on('entity:presave', handler);
 *
 * // Invoke hooks
 * await hooks.invoke('entity:presave', { entity });
 *
 * // Alter hooks
 * const form = await hooks.alter('form', originalForm);
 * ```
 */

export { HookManager } from './HookManager.js';
