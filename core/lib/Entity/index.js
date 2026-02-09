/**
 * Entity System - Barrel Export
 * Version: 1.0.0
 *
 * Re-exports all entity system components for convenient importing.
 *
 * Components:
 * - EntityQuery: Fluent query builder for entity queries
 * - ConditionGroup: Condition group for complex query logic
 * - EntityTypeManager: Entity type registry and handler resolver
 * - EntityType: Value object representing an entity type definition
 *
 * Usage:
 *   import { EntityQuery, EntityTypeManager } from 'core/lib/Entity/index.js';
 *
 * @example
 * // Create entity type manager
 * const manager = new EntityTypeManager();
 * manager.register('node', {
 *   label: 'Content',
 *   handlers: { storage: nodeStorage }
 * });
 *
 * // Query entities
 * const query = manager.getQuery('node');
 * const ids = await query
 *   .accessCheck(false)
 *   .condition('type', 'article')
 *   .sort('created', 'DESC')
 *   .range(0, 10)
 *   .execute();
 */

export { EntityQuery, ConditionGroup } from './EntityQuery.js';
export { EntityTypeManager, EntityType } from './EntityTypeManager.js';
