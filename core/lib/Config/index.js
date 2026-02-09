/**
 * Config Entity System - Barrel export
 *
 * Exports all config entity components:
 * - ConfigEntity: Base class for config entities
 * - ConfigEntityStorage: File-based CRUD storage
 *
 * @example
 * import { ConfigEntity, ConfigEntityStorage } from 'core/lib/Config/index.js';
 *
 * const storage = new ConfigEntityStorage('node_type', 'config');
 * const entity = new ConfigEntity('node_type', { id: 'article', label: 'Article' });
 * await storage.save(entity);
 */

export { ConfigEntity } from './ConfigEntity.js';
export { ConfigEntityStorage } from './ConfigEntityStorage.js';
