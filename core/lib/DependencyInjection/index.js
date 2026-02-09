/**
 * Dependency Injection System
 * ============================
 *
 * Barrel export for the DI container and related classes.
 *
 * @example
 * ```javascript
 * import { Container, Reference } from './core/lib/DependencyInjection/index.js';
 *
 * const container = new Container();
 * container.register('database', () => new Database());
 * const db = container.get('database');
 *
 * // Using references for declarative dependencies
 * container.register('node.storage', (db) => new NodeStorage(db), {
 *   deps: [new Reference('database')]
 * });
 * ```
 */

export { Container } from './Container.js';
export { Reference } from './Reference.js';
