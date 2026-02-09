/**
 * META-PATTERN TEMPLATE: EntityStorage
 * ======================================
 * 
 * Drupal equivalent: EntityStorageBase.php, SqlContentEntityStorage.php
 * 
 * Storage handler for content entities. CMS-Core uses JSON file storage
 * (with a future path to SQLite). Each entity type can have its own
 * storage handler, or use the default JsonFileEntityStorage.
 * 
 * @example Using entity storage
 * ```javascript
 * const storage = entityTypeManager.getStorage('node');
 * 
 * // CRUD
 * const entity = storage.create({ title: 'Test', type: 'article' });
 * await storage.save(entity);
 * const loaded = await storage.load(entity.id());
 * await storage.delete(loaded.id());
 * 
 * // Queries
 * const ids = await storage.getQuery()
 *   .condition('type', 'article')
 *   .condition('status', true)
 *   .sort('created', 'DESC')
 *   .range(0, 10)
 *   .execute();
 * const entities = await storage.loadMultiple(ids);
 * ```
 * 
 * @example Custom storage handler for a module
 * ```javascript
 * // modules/node/services.js
 * export function register(container) {
 *   container.register('node.storage', (entityTypeManager, database) => {
 *     const entityType = entityTypeManager.getDefinition('node');
 *     return new JsonFileEntityStorage(entityType, 'content/node');
 *   }, {
 *     deps: ['entity_type.manager', 'database'],
 *     tags: ['entity_storage'],
 *   });
 * }
 * ```
 */

import { ContentEntityBase } from './content-entity.js';
// In actual implementation, import from core/lib/Entity/
// import { EntityQuery } from './EntityQuery.js';

const { randomUUID } = await import('node:crypto');
const { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } = await import('node:fs');
const { join } = await import('node:path');

/**
 * Abstract base for entity storage handlers.
 */
export class EntityStorageBase {
  /**
   * @param {EntityType} entityType - The entity type definition
   */
  constructor(entityType) {
    this._entityType = entityType;
  }

  /**
   * Create a new entity (not yet saved).
   * @param {Object} values - Initial field values
   * @returns {ContentEntityBase}
   */
  create(values = {}) {
    // Auto-generate UUID if not provided
    if (!values[this._entityType.keys.uuid]) {
      values[this._entityType.keys.uuid] = randomUUID();
    }
    // Set timestamps
    if (!values.created) values.created = new Date().toISOString();
    values.changed = new Date().toISOString();

    return new ContentEntityBase(this._entityType, values, { isNew: true });
  }

  /** @abstract */
  async load(id) { throw new Error('Subclass must implement load()'); }
  /** @abstract */
  async save(entity) { throw new Error('Subclass must implement save()'); }
  /** @abstract */
  async delete(id) { throw new Error('Subclass must implement delete()'); }
  /** @abstract */
  async loadAll() { throw new Error('Subclass must implement loadAll()'); }

  /**
   * Load multiple entities by ID.
   * @param {Array<string|number>} ids
   * @returns {Promise<Map<string, ContentEntityBase>>}
   */
  async loadMultiple(ids) {
    const results = new Map();
    for (const id of ids) {
      const entity = await this.load(id);
      if (entity) results.set(String(id), entity);
    }
    return results;
  }

  /**
   * Get a query builder for this entity type.
   * @returns {EntityQuery}
   */
  getQuery() {
    // In actual implementation, return new EntityQuery(this._entityType.id, this);
    throw new Error('Import and use EntityQuery from core/lib/Entity/EntityQuery.js');
  }
}

/**
 * JSON file-based entity storage.
 * 
 * Stores each entity as: {storageDir}/{id}.json
 * 
 * This is the default storage for CMS-Core. Suitable for small-to-medium
 * datasets. For high-volume data, implement SqlEntityStorage extending
 * EntityStorageBase.
 */
export class JsonFileEntityStorage extends EntityStorageBase {
  /**
   * @param {EntityType} entityType
   * @param {string} storageDir - Directory to store JSON files
   */
  constructor(entityType, storageDir) {
    super(entityType);
    this._storageDir = storageDir;
    this._cache = new Map();

    // Ensure storage directory exists
    if (!existsSync(storageDir)) {
      mkdirSync(storageDir, { recursive: true });
    }
  }

  /**
   * Save an entity to a JSON file.
   * Generates ID for new entities via crypto.randomUUID().
   */
  async save(entity) {
    const idKey = this._entityType.keys.id;

    // Auto-generate ID for new entities
    if (entity.isNew() && !entity.id()) {
      entity.set(idKey, randomUUID());
    }

    // Update changed timestamp
    entity.set('changed', new Date().toISOString());

    const id = entity.id();
    const filePath = join(this._storageDir, `${id}.json`);
    writeFileSync(filePath, JSON.stringify(entity.toJSON(), null, 2), 'utf-8');
    this._cache.set(String(id), entity);

    return entity;
  }

  /**
   * Load an entity from its JSON file.
   * @param {string|number} id
   * @returns {Promise<ContentEntityBase|null>}
   */
  async load(id) {
    const cached = this._cache.get(String(id));
    if (cached) return cached;

    const filePath = join(this._storageDir, `${id}.json`);
    if (!existsSync(filePath)) return null;

    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    const entity = ContentEntityBase.fromStorage(this._entityType, data);
    this._cache.set(String(id), entity);
    return entity;
  }

  /**
   * Delete an entity's JSON file.
   * @param {string|number} id
   */
  async delete(id) {
    const filePath = join(this._storageDir, `${id}.json`);
    if (existsSync(filePath)) unlinkSync(filePath);
    this._cache.delete(String(id));
  }

  /**
   * Load all entities of this type.
   * @returns {Promise<Map<string, ContentEntityBase>>}
   */
  async loadAll() {
    const files = readdirSync(this._storageDir).filter(f => f.endsWith('.json'));
    const results = new Map();
    for (const file of files) {
      const id = file.slice(0, -5); // Remove .json
      const entity = await this.load(id);
      if (entity) results.set(id, entity);
    }
    return results;
  }

  /**
   * Execute a query against this storage.
   * Called by EntityQuery.execute().
   * 
   * @param {EntityQuery} query
   * @returns {Promise<Array<string>|number>} Entity IDs or count
   */
  async executeQuery(query) {
    const all = await this.loadAll();
    let entities = [...all.values()];

    // Apply conditions
    for (const { field, value, operator } of query._conditions) {
      entities = entities.filter(entity => {
        const fieldValue = entity.get(field);
        switch (operator) {
          case '=': return fieldValue === value;
          case '!=': return fieldValue !== value;
          case '>': return fieldValue > value;
          case '<': return fieldValue < value;
          case '>=': return fieldValue >= value;
          case '<=': return fieldValue <= value;
          case 'IN': return Array.isArray(value) && value.includes(fieldValue);
          case 'NOT IN': return Array.isArray(value) && !value.includes(fieldValue);
          case 'CONTAINS': return String(fieldValue).includes(String(value));
          case 'STARTS_WITH': return String(fieldValue).startsWith(String(value));
          case 'ENDS_WITH': return String(fieldValue).endsWith(String(value));
          case 'IS NULL': return fieldValue === null || fieldValue === undefined;
          case 'IS NOT NULL': return fieldValue !== null && fieldValue !== undefined;
          default: return fieldValue === value;
        }
      });
    }

    // Apply sorts
    for (const { field, direction } of [...query._sorts].reverse()) {
      entities.sort((a, b) => {
        const av = a.get(field), bv = b.get(field);
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return direction === 'DESC' ? -cmp : cmp;
      });
    }

    // Count mode
    if (query._count) return entities.length;

    // Apply range
    if (query._range) {
      entities = entities.slice(query._range.start, query._range.start + query._range.length);
    }

    // Return IDs
    return entities.map(e => e.id());
  }
}
