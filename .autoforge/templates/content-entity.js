/**
 * META-PATTERN TEMPLATE: ContentEntityBase
 * ==========================================
 * 
 * Drupal equivalent: ContentEntityBase.php (1,552 lines)
 * 
 * ONE base class for ALL content entities: nodes, users, taxonomy terms,
 * comments, media, files, blocks, menu links, etc. Content entities are
 * user-created data stored in the database/files.
 * 
 * Content entities vs Config entities:
 * - Content = user data (articles, users, comments)
 * - Config = system settings (content types, views, image styles)
 * 
 * @example Defining an entity type (in a module)
 * ```javascript
 * // modules/node/index.js
 * export function hook_entity_type_info(context) {
 *   context.entityTypeManager.register('node', {
 *     label: 'Content',
 *     keys: { id: 'nid', uuid: 'uuid', bundle: 'type', label: 'title' },
 *     revisionable: true,
 *     handlers: { storage: nodeStorage, access: nodeAccess },
 *     baseFieldDefinitions: {
 *       nid: { type: 'integer', label: 'ID', readOnly: true },
 *       title: { type: 'string', label: 'Title', required: true },
 *       status: { type: 'boolean', label: 'Published', defaultValue: true },
 *     },
 *   });
 * }
 * ```
 * 
 * @example Working with content entities
 * ```javascript
 * const storage = entityTypeManager.getStorage('node');
 * 
 * // Create
 * const node = storage.create({ type: 'article', title: 'Hello World', status: true });
 * await storage.save(node);
 * 
 * // Load
 * const loaded = await storage.load(node.id());
 * console.log(loaded.label()); // 'Hello World'
 * 
 * // Query
 * const ids = await storage.getQuery()
 *   .condition('type', 'article')
 *   .condition('status', true)
 *   .sort('created', 'DESC')
 *   .range(0, 10)
 *   .execute();
 * 
 * // Update
 * loaded.set('title', 'Updated Title');
 * await storage.save(loaded);
 * 
 * // Delete
 * await storage.delete(loaded.id());
 * ```
 */

const FIELDS = Symbol('fields');
const ORIGINAL = Symbol('original');
const IS_NEW = Symbol('isNew');

export class ContentEntityBase {
  /**
   * @param {EntityType} entityType - The entity type definition
   * @param {Object} values - Initial field values
   * @param {Object} options
   * @param {boolean} options.isNew - Whether this is a new (unsaved) entity
   */
  constructor(entityType, values = {}, options = {}) {
    this._entityType = entityType;
    this[IS_NEW] = options.isNew !== false && !values[entityType.keys.id];
    this[FIELDS] = new Map();
    this[ORIGINAL] = null;

    // Populate fields from values
    for (const [key, value] of Object.entries(values)) {
      this[FIELDS].set(key, value);
    }

    // Snapshot original for change detection (not for new entities)
    if (!this[IS_NEW]) {
      this[ORIGINAL] = structuredClone(values);
    }
  }

  // ---- Identity ----

  /** Get the entity ID (value of the 'id' key field) */
  id() {
    return this[FIELDS].get(this._entityType.keys.id);
  }

  /** Get the entity UUID */
  uuid() {
    return this[FIELDS].get(this._entityType.keys.uuid);
  }

  /** Get the bundle (e.g., 'article' for a node) */
  bundle() {
    return this._entityType.keys.bundle
      ? this[FIELDS].get(this._entityType.keys.bundle)
      : this._entityType.id;
  }

  /** Get the human-readable label */
  label() {
    return this[FIELDS].get(this._entityType.keys.label) || '';
  }

  /** Get the entity type ID (e.g., 'node', 'user') */
  getEntityTypeId() {
    return this._entityType.id;
  }

  /** Whether this entity hasn't been saved yet */
  isNew() {
    return this[IS_NEW];
  }

  // ---- Field Access ----

  /**
   * Get a field value.
   * @param {string} fieldName
   * @returns {*}
   */
  get(fieldName) {
    return this[FIELDS].get(fieldName);
  }

  /**
   * Set a field value.
   * @param {string} fieldName
   * @param {*} value
   * @returns {this} For chaining
   */
  set(fieldName, value) {
    this[FIELDS].set(fieldName, value);
    return this;
  }

  /**
   * Check if a field exists on this entity.
   * @param {string} fieldName
   * @returns {boolean}
   */
  has(fieldName) {
    return this[FIELDS].has(fieldName);
  }

  // ---- Change Detection ----

  /**
   * Check if a specific field has been modified since load.
   * Always true for new entities.
   */
  hasChanged(fieldName) {
    if (this[IS_NEW]) return true;
    if (!this[ORIGINAL]) return true;
    return JSON.stringify(this[FIELDS].get(fieldName)) !==
      JSON.stringify(this[ORIGINAL][fieldName]);
  }

  /**
   * Get all field names that have been modified.
   * @returns {string[]}
   */
  getChangedFields() {
    if (this[IS_NEW] || !this[ORIGINAL]) return [...this[FIELDS].keys()];
    const changed = [];
    for (const [key, value] of this[FIELDS]) {
      if (JSON.stringify(value) !== JSON.stringify(this[ORIGINAL][key])) {
        changed.push(key);
      }
    }
    return changed;
  }

  // ---- Serialization ----

  /** Convert to plain object for JSON storage */
  toJSON() {
    const obj = {};
    for (const [key, value] of this[FIELDS]) {
      obj[key] = value;
    }
    return obj;
  }

  /**
   * Create entity from stored data (marks as not-new).
   * @param {EntityType} entityType
   * @param {Object} data
   * @returns {ContentEntityBase}
   */
  static fromStorage(entityType, data) {
    return new ContentEntityBase(entityType, data, { isNew: false });
  }

  // ---- Iteration ----

  /** Iterate over [fieldName, value] pairs */
  *[Symbol.iterator]() {
    yield* this[FIELDS].entries();
  }

  // ---- Revisions ----

  /** Get revision ID (only for revisionable entity types) */
  getRevisionId() {
    if (!this._entityType.revisionable) return null;
    return this[FIELDS].get(this._entityType.keys.revision);
  }

  /** Whether this is the default (published) revision */
  isDefaultRevision() {
    return this[FIELDS].get('isDefaultRevision') !== false;
  }
}
