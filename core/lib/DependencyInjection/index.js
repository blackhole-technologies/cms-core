/**
 * Dependency Injection System
 * ============================
 *
 * Barrel export for the DI container and related classes.
 *
 * @example
 * ```javascript
 * import { Container } from './core/lib/DependencyInjection/index.js';
 *
 * const container = new Container();
 * container.register('database', () => new Database());
 * const db = container.get('database');
 * ```
 */

export { Container } from './Container.js';
