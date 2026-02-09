/**
 * ConfigEntityStorage - File-based CRUD for config entities
 *
 * Drupal equivalent: ConfigEntityStorage.php
 *
 * Persists config entities as JSON files in config/active/{entityTypeId}.{id}.json
 * Provides caching layer for performance and supports export to staging.
 *
 * Storage layout:
 * - config/active/   — Active configuration (runtime)
 * - config/staging/  — Exported configuration (deployment)
 *
 * @example
 * const storage = new ConfigEntityStorage('node_type', 'config');
 *
 * // Save a config entity
 * const entity = new ConfigEntity('node_type', { id: 'article', label: 'Article' });
 * await storage.save(entity);
 * // Writes to: config/active/node_type.article.json
 *
 * // Load by ID
 * const loaded = await storage.load('article');
 *
 * // Load all entities of this type
 * const all = await storage.loadAll();
 *
 * // Delete
 * await storage.delete('article');
 */

import { readFile, writeFile, unlink, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigEntity } from './ConfigEntity.js';

// Symbol-based private state for internal storage
// WHY: Prevents external code from directly accessing/modifying internal state
// WHY: Provides true privacy without relying on naming conventions (_cache)
const ENTITY_TYPE_ID = Symbol('entityTypeId');
const CONFIG_DIR = Symbol('configDir');
const ACTIVE_DIR = Symbol('activeDir');
const STAGING_DIR = Symbol('stagingDir');
const CACHE = Symbol('cache');

export class ConfigEntityStorage {
  /**
   * Create a storage handler for a config entity type.
   *
   * @param {string} entityTypeId - Entity type ID (e.g., 'node_type', 'view')
   * @param {string} configDir - Base config directory (default: 'config')
   */
  constructor(entityTypeId, configDir = 'config') {
    // Store as Symbol-based private properties
    // WHY: True privacy - cannot be accessed or modified from outside
    this[ENTITY_TYPE_ID] = entityTypeId;
    this[CONFIG_DIR] = configDir;
    this[ACTIVE_DIR] = join(configDir, 'active');
    this[STAGING_DIR] = join(configDir, 'staging');
    this[CACHE] = new Map();

    // Public read-only accessors for backward compatibility and testing
    // WHY: Allows tests and external code to read values but not modify internals
    this.entityTypeId = entityTypeId;
    this.configDir = configDir;
    this.activeDir = this[ACTIVE_DIR];
    this.stagingDir = this[STAGING_DIR];
    this._cache = this[CACHE];
  }

  /**
   * Build file path for an entity ID.
   * Format: {activeDir}/{entityTypeId}.{id}.json
   *
   * @param {string} id - Entity ID
   * @returns {string} Full file path
   */
  _getFilePath(id) {
    return join(this[ACTIVE_DIR], `${this[ENTITY_TYPE_ID]}.${id}.json`);
  }

  /**
   * Create a new config entity instance (in memory only).
   *
   * WHY: Matches Drupal pattern: $storage->create($values) returns unsaved entity.
   * Caller must call save() to persist. This allows modification before save.
   *
   * @param {Object} values - Initial entity values
   * @returns {ConfigEntity} New entity instance (NOT saved to disk)
   */
  create(values = {}) {
    // WHY: Generate UUID if not provided
    // ConfigEntity constructor handles this, but we pass entityTypeId explicitly
    const entity = new ConfigEntity(this.entityTypeId, values);

    // WHY: Return unsaved entity - caller must call save() to persist
    return entity;
  }

  /**
   * Load a config entity by ID.
   *
   * @param {string} id - Entity ID
   * @returns {Promise<ConfigEntity|null>} Entity or null if not found
   */
  async load(id) {
    // Check cache first
    if (this[CACHE].has(id)) {
      return this[CACHE].get(id);
    }

    const filePath = this._getFilePath(id);

    // File doesn't exist
    if (!existsSync(filePath)) {
      return null;
    }

    // Read and parse JSON
    const content = await readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    // Create ConfigEntity instance
    const entity = new ConfigEntity(this[ENTITY_TYPE_ID], data);

    // Cache it
    this[CACHE].set(id, entity);

    return entity;
  }

  /**
   * Save a config entity to file storage.
   *
   * @param {ConfigEntity} entity - The entity to save
   * @returns {Promise<void>}
   * @throws {Error} If entity doesn't have getConfigName() method
   */
  async save(entity) {
    // Validate entity has getConfigName() method
    // WHY: ConfigEntity contract requires this for file path generation
    if (!entity || typeof entity.getConfigName !== 'function') {
      throw new Error(
        'ConfigEntityStorage.save() requires entity with getConfigName() method. ' +
        'Ensure you are passing a ConfigEntity instance.'
      );
    }

    // Ensure active directory exists (lazy initialization)
    // WHY: Only create directories when actually needed, not in constructor
    if (!existsSync(this[ACTIVE_DIR])) {
      await mkdir(this[ACTIVE_DIR], { recursive: true });
    }

    // Build file path from entity
    const filePath = join(this[ACTIVE_DIR], `${entity.getConfigName()}.json`);

    // Serialize and write
    const json = JSON.stringify(entity.toJSON(), null, 2);
    await writeFile(filePath, json, 'utf-8');

    // Update cache
    this[CACHE].set(entity.id, entity);
  }

  /**
   * Delete a config entity.
   *
   * @param {string} id - Entity ID to delete
   * @returns {Promise<void>}
   */
  async delete(id) {
    const filePath = this._getFilePath(id);

    // Delete file if exists
    // WHY: Gracefully handle missing files - not an error to delete something that doesn't exist
    if (existsSync(filePath)) {
      await unlink(filePath);
    }

    // Remove from cache
    this[CACHE].delete(id);
  }

  /**
   * Load multiple entities by their IDs.
   *
   * @param {string[]} ids - Array of entity IDs
   * @returns {Promise<Map<string, ConfigEntity>>} Map of id→entity (nulls skipped)
   */
  async loadMultiple(ids) {
    const entities = new Map();

    for (const id of ids) {
      const entity = await this.load(id);
      // WHY: Skip nulls - only include entities that actually exist
      if (entity) {
        entities.set(id, entity);
      }
    }

    return entities;
  }

  /**
   * Load all config entities of this type.
   *
   * Scans the active directory for files matching pattern:
   * {entityTypeId}.*.json
   *
   * @returns {Promise<Map<string, ConfigEntity>>} Map of id→entity
   */
  async loadAll() {
    // Ensure directory exists (lazy initialization)
    if (!existsSync(this[ACTIVE_DIR])) {
      return new Map();
    }

    // Read directory
    const files = await readdir(this[ACTIVE_DIR]);

    // Filter to files matching this entity type
    const prefix = `${this[ENTITY_TYPE_ID]}.`;
    const matchingFiles = files.filter(f =>
      f.startsWith(prefix) && f.endsWith('.json')
    );

    // Extract IDs and load entities
    const entities = new Map();
    for (const file of matchingFiles) {
      // Extract ID: "node_type.article.json" → "article"
      const id = file.slice(prefix.length, -5); // Remove prefix and .json
      const entity = await this.load(id);
      if (entity) {
        entities.set(id, entity);
      }
    }

    return entities;
  }

  /**
   * Export all config entities to staging directory.
   *
   * WHY: Config management workflow for deployments. Active config is what's
   * running in the current environment. Staging is the exportable snapshot
   * that gets committed to version control and deployed to other environments.
   *
   * @returns {Promise<number>} Count of exported entities
   */
  async exportToStaging() {
    // Ensure staging directory exists (lazy initialization)
    if (!existsSync(this.stagingDir)) {
      await mkdir(this.stagingDir, { recursive: true });
    }

    // Load all entities of this type
    const entities = await this.loadAll();

    // Export each entity to staging
    for (const [id, entity] of entities) {
      const filename = `${entity.getConfigName()}.json`;
      const targetPath = join(this.stagingDir, filename);
      const json = JSON.stringify(entity.toJSON(), null, 2);
      await writeFile(targetPath, json, 'utf-8');
    }

    return entities.size;
  }

  /**
   * Import config entities from staging directory to active.
   *
   * WHY: Deployment workflow - after pulling staging config from version control,
   * import it to activate in the target environment. Clears cache to ensure fresh
   * state after import.
   *
   * @returns {Promise<number>} Count of imported entities
   */
  async importFromStaging() {
    // Ensure staging directory exists
    if (!existsSync(this.stagingDir)) {
      return 0;
    }

    // Ensure active directory exists
    if (!existsSync(this.activeDir)) {
      await mkdir(this.activeDir, { recursive: true });
    }

    // Read staging directory
    const files = await readdir(this.stagingDir);

    // Filter to files matching this entity type
    const prefix = `${this.entityTypeId}.`;
    const matchingFiles = files.filter(f =>
      f.startsWith(prefix) && f.endsWith('.json')
    );

    // Copy each file from staging to active
    for (const file of matchingFiles) {
      const sourcePath = join(this.stagingDir, file);
      const targetPath = join(this.activeDir, file);

      // Read from staging
      const content = await readFile(sourcePath, 'utf-8');
      const data = JSON.parse(content);

      // Write to active
      await writeFile(targetPath, JSON.stringify(data, null, 2), 'utf-8');
    }

    // Clear cache to ensure fresh state
    // WHY: Imported config may have different values than cached entities
    this._cache.clear();

    return matchingFiles.length;
  }

  /**
   * Execute an EntityQuery against config entity storage.
   *
   * WHY: Provides query support for ConfigEntityStorage, making it compatible
   * with EntityTypeManager.getQuery(). Loads all entities and filters in memory
   * (config entities are small, typically <1000 total).
   *
   * @param {EntityQuery} query - Query object with conditions, sorts, range
   * @returns {Promise<Array<string>|number>} Entity IDs or count if query._count
   */
  async executeQuery(query) {
    // Load all entities of this type (returns Map)
    const entitiesMap = await this.loadAll();

    // Convert Map to array for filtering
    const entities = Array.from(entitiesMap.values());

    // Apply conditions
    let filtered = entities.filter(entity => {
      return this._matchesConditions(entity, query._conditions);
    });

    // Apply sorting
    if (query._sorts && query._sorts.length > 0) {
      filtered = this._sortEntities(filtered, query._sorts);
    }

    // Return count if requested
    if (query._count) {
      return filtered.length;
    }

    // Extract IDs
    let ids = filtered.map(entity => entity.id);

    // Apply range (pagination)
    if (query._range) {
      const { start, length } = query._range;
      ids = ids.slice(start, start + length);
    }

    return ids;
  }

  /**
   * Check if an entity matches all query conditions.
   *
   * WHY: Private helper for executeQuery. Supports common operators used in
   * config entity queries (=, <>, IN, STARTS_WITH, CONTAINS).
   *
   * @param {ConfigEntity} entity - Entity to check
   * @param {Array} conditions - Array of condition objects
   * @returns {boolean} True if all conditions match
   * @private
   */
  _matchesConditions(entity, conditions) {
    for (const { field, value, operator } of conditions) {
      const entityValue = entity.get(field);

      let matches = false;

      switch (operator) {
        case '=':
          matches = entityValue === value;
          break;

        case '<>':
        case '!=':
          matches = entityValue !== value;
          break;

        case '>':
          matches = entityValue > value;
          break;

        case '>=':
          matches = entityValue >= value;
          break;

        case '<':
          matches = entityValue < value;
          break;

        case '<=':
          matches = entityValue <= value;
          break;

        case 'IN':
          // WHY: Value should be an array for IN operator
          matches = Array.isArray(value) && value.includes(entityValue);
          break;

        case 'NOT IN':
          matches = Array.isArray(value) && !value.includes(entityValue);
          break;

        case 'STARTS_WITH':
          // WHY: String operator - check if entity value starts with search value
          matches = typeof entityValue === 'string' &&
                    typeof value === 'string' &&
                    entityValue.startsWith(value);
          break;

        case 'CONTAINS':
          // WHY: String operator - check if entity value contains search value
          matches = typeof entityValue === 'string' &&
                    typeof value === 'string' &&
                    entityValue.includes(value);
          break;

        case 'ENDS_WITH':
          matches = typeof entityValue === 'string' &&
                    typeof value === 'string' &&
                    entityValue.endsWith(value);
          break;

        case 'IS NULL':
          matches = entityValue === null || entityValue === undefined;
          break;

        case 'IS NOT NULL':
          matches = entityValue !== null && entityValue !== undefined;
          break;

        default:
          // WHY: Unknown operator - fail the match to avoid false positives
          matches = false;
      }

      // WHY: AND logic - if any condition fails, entity doesn't match
      if (!matches) {
        return false;
      }
    }

    // All conditions passed
    return true;
  }

  /**
   * Sort entities by field(s).
   *
   * WHY: Private helper for executeQuery. Applies multiple sorts in order
   * (first sort is primary, subsequent sorts break ties).
   *
   * @param {Array<ConfigEntity>} entities - Entities to sort
   * @param {Array<{field: string, direction: string}>} sorts - Sort definitions
   * @returns {Array<ConfigEntity>} Sorted entities
   * @private
   */
  _sortEntities(entities, sorts) {
    // WHY: Sort in place for performance (we already have a filtered copy)
    return entities.sort((a, b) => {
      for (const { field, direction } of sorts) {
        const aValue = a.get(field);
        const bValue = b.get(field);

        let comparison = 0;

        // WHY: Handle null/undefined values (always sort to end)
        if (aValue === null || aValue === undefined) {
          comparison = 1;
        } else if (bValue === null || bValue === undefined) {
          comparison = -1;
        } else if (aValue < bValue) {
          comparison = -1;
        } else if (aValue > bValue) {
          comparison = 1;
        }

        // WHY: If values are different, apply direction and return
        if (comparison !== 0) {
          return direction === 'DESC' ? -comparison : comparison;
        }

        // WHY: Values are equal, continue to next sort field
      }

      // WHY: All sort fields are equal
      return 0;
    });
  }
}
