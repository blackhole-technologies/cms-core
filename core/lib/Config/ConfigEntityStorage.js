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

export class ConfigEntityStorage {
  /**
   * Create a storage handler for a config entity type.
   *
   * @param {string} entityTypeId - Entity type ID (e.g., 'node_type', 'view')
   * @param {string} configDir - Base config directory (default: 'config')
   */
  constructor(entityTypeId, configDir = 'config') {
    this.entityTypeId = entityTypeId;
    this.configDir = configDir;
    this.activeDir = join(configDir, 'active');

    // In-memory cache for loaded entities
    // WHY: Reduces filesystem I/O for frequently accessed config
    this._cache = new Map();
  }

  /**
   * Build file path for an entity ID.
   * Format: {activeDir}/{entityTypeId}.{id}.json
   *
   * @param {string} id - Entity ID
   * @returns {string} Full file path
   */
  _getFilePath(id) {
    return join(this.activeDir, `${this.entityTypeId}.${id}.json`);
  }

  /**
   * Load a config entity by ID.
   *
   * @param {string} id - Entity ID
   * @returns {Promise<ConfigEntity|null>} Entity or null if not found
   */
  async load(id) {
    // Check cache first
    if (this._cache.has(id)) {
      return this._cache.get(id);
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
    const entity = new ConfigEntity(this.entityTypeId, data);

    // Cache it
    this._cache.set(id, entity);

    return entity;
  }

  /**
   * Save a config entity to file storage.
   *
   * @param {ConfigEntity} entity - The entity to save
   * @returns {Promise<void>}
   */
  async save(entity) {
    // Ensure active directory exists
    if (!existsSync(this.activeDir)) {
      await mkdir(this.activeDir, { recursive: true });
    }

    // Build file path from entity
    const filePath = join(this.activeDir, `${entity.getConfigName()}.json`);

    // Serialize and write
    const json = JSON.stringify(entity.toJSON(), null, 2);
    await writeFile(filePath, json, 'utf-8');

    // Update cache
    this._cache.set(entity.id, entity);
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
    if (existsSync(filePath)) {
      await unlink(filePath);
    }

    // Remove from cache
    this._cache.delete(id);
  }

  /**
   * Load multiple entities by their IDs.
   *
   * @param {string[]} ids - Array of entity IDs
   * @returns {Promise<ConfigEntity[]>} Array of loaded entities (nulls filtered out)
   */
  async loadMultiple(ids) {
    const entities = [];

    for (const id of ids) {
      const entity = await this.load(id);
      if (entity) {
        entities.push(entity);
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
   * @returns {Promise<ConfigEntity[]>} Array of all entities
   */
  async loadAll() {
    // Ensure directory exists
    if (!existsSync(this.activeDir)) {
      return [];
    }

    // Read directory
    const files = await readdir(this.activeDir);

    // Filter to files matching this entity type
    const prefix = `${this.entityTypeId}.`;
    const matchingFiles = files.filter(f =>
      f.startsWith(prefix) && f.endsWith('.json')
    );

    // Extract IDs and load entities
    const entities = [];
    for (const file of matchingFiles) {
      // Extract ID: "node_type.article.json" → "article"
      const id = file.slice(prefix.length, -5); // Remove prefix and .json
      const entity = await this.load(id);
      if (entity) {
        entities.push(entity);
      }
    }

    return entities;
  }
}
