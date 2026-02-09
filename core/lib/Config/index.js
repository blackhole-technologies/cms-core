/**
 * Config Entity System - Barrel export
 *
 * Exports all config entity components:
 * - ConfigEntity: Base class for config entities
 * - ConfigEntityStorage: File-based CRUD storage
 * - ConfigSchema: Runtime validation for config entities
 *
 * @example
 * import { ConfigEntity, ConfigEntityStorage, ConfigSchema } from 'core/lib/Config/index.js';
 *
 * const storage = new ConfigEntityStorage('node_type', 'config');
 * const entity = new ConfigEntity('node_type', { id: 'article', label: 'Article' });
 * await storage.save(entity);
 *
 * // Validate before saving
 * const schema = { id: { type: 'string', required: true } };
 * const result = ConfigSchema.validate(entity, schema);
 * if (!result.valid) {
 *   console.error('Validation errors:', result.errors);
 * }
 */

import fs from 'fs';
import path from 'path';

// Ensure config directories exist
const configDir = path.join(process.cwd(), 'config');
const activeDir = path.join(configDir, 'active');
const stagingDir = path.join(configDir, 'staging');

fs.mkdirSync(activeDir, { recursive: true });
fs.mkdirSync(stagingDir, { recursive: true });

export { ConfigEntity } from './ConfigEntity.js';
export { ConfigEntityStorage } from './ConfigEntityStorage.js';
export { ConfigSchema } from './ConfigSchema.js';
