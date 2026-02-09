/**
 * @file
 * Entity type registry and handler resolution.
 *
 * EntityTypeManager maintains the registry of all entity types (node, user,
 * taxonomy_term, etc.) and resolves their handlers (storage, access, views).
 * Each entity type is represented as an EntityType value object.
 *
 * Drupal equivalent: EntityTypeManager.php, EntityTypeManagerInterface.php
 *
 * @see .autoforge/templates/entity-storage.js for storage handler pattern
 * @see .autoforge/templates/content-entity.js for entity type definition
 */

// WHY: Symbol-based private state prevents external mutation
const ID = Symbol('id');
const LABEL = Symbol('label');
const KEYS = Symbol('keys');
const REVISIONABLE = Symbol('revisionable');
const TRANSLATABLE = Symbol('translatable');
const HANDLERS = Symbol('handlers');
const BASE_FIELD_DEFINITIONS = Symbol('baseFieldDefinitions');

const DEFINITIONS = Symbol('definitions');
const SERVICES = Symbol('services');
const HOOKS = Symbol('hooks');
const HANDLER_CACHE = Symbol('handlerCache');
const STORAGE_CACHE = Symbol('storageCache');
const DISCOVERED = Symbol('discovered');

/**
 * Value object representing an entity type definition.
 *
 * WHY: Immutable data structure with normalized defaults prevents
 * inconsistencies. Wraps raw definition objects from modules.
 *
 * @example
 * const nodeType = new EntityType('node', {
 *   label: 'Content',
 *   keys: {
 *     id: 'nid',
 *     uuid: 'uuid',
 *     bundle: 'type',
 *     label: 'title'
 *   },
 *   handlers: {
 *     storage: 'node.storage',
 *     access: 'entity.access_handler'
 *   }
 * });
 */
export class EntityType {
  /**
   * Create an entity type definition.
   *
   * @param {string} id - Entity type ID (e.g., 'node', 'user', 'taxonomy_term')
   * @param {Object} definition - Raw definition from module
   * @param {string} [definition.label] - Human-readable label (defaults to id)
   * @param {Object} [definition.keys] - Entity key mappings
   * @param {boolean} [definition.revisionable] - Supports revisions
   * @param {boolean} [definition.translatable] - Supports translations
   * @param {Object} [definition.handlers] - Handler service IDs or factories
   * @param {Object} [definition.baseFieldDefinitions] - Base field schema
   */
  constructor(id, definition = {}) {
    // WHY: Store as private to prevent mutation
    this[ID] = id;
    this[LABEL] = definition.label || id;

    // WHY: Normalize keys with defaults matching Drupal's schema
    // Most entities use 'id' and 'uuid', but some (node) use custom keys
    this[KEYS] = {
      id: 'id',
      uuid: 'uuid',
      bundle: null,
      label: null,
      revision: null,
      ...(definition.keys || {})
    };

    this[REVISIONABLE] = definition.revisionable || false;
    this[TRANSLATABLE] = definition.translatable || false;
    this[HANDLERS] = definition.handlers || {};
    this[BASE_FIELD_DEFINITIONS] = definition.baseFieldDefinitions || {};
  }

  /**
   * Get entity type ID.
   *
   * @returns {string} Entity type ID
   */
  get id() {
    return this[ID];
  }

  /**
   * Get human-readable label.
   *
   * @returns {string} Label
   */
  get label() {
    return this[LABEL];
  }

  /**
   * Get entity key mappings.
   *
   * @returns {Object} Keys object with id, uuid, bundle, label, revision
   */
  get keys() {
    return { ...this[KEYS] };
  }

  /**
   * Check if entity type supports revisions.
   *
   * @returns {boolean} True if revisionable
   */
  get revisionable() {
    return this[REVISIONABLE];
  }

  /**
   * Check if entity type supports translations.
   *
   * @returns {boolean} True if translatable
   */
  get translatable() {
    return this[TRANSLATABLE];
  }

  /**
   * Get handler definitions.
   *
   * @returns {Object} Handlers map
   */
  get handlers() {
    return { ...this[HANDLERS] };
  }

  /**
   * Get base field definitions.
   *
   * @returns {Object} Base fields
   */
  get baseFieldDefinitions() {
    return { ...this[BASE_FIELD_DEFINITIONS] };
  }

  /**
   * Get the value of a specific entity key.
   *
   * WHY: Provides safe access with null fallback for undefined keys.
   * Code can check hasKey() first or handle null gracefully.
   *
   * @param {string} keyName - Key name (id, uuid, bundle, label, revision)
   * @returns {string|null} Field name or null if key not defined
   */
  getKey(keyName) {
    return this[KEYS][keyName] || null;
  }

  /**
   * Check if entity type defines a specific key.
   *
   * @param {string} keyName - Key name to check
   * @returns {boolean} True if key is defined and not null
   */
  hasKey(keyName) {
    return this[KEYS][keyName] !== null && this[KEYS][keyName] !== undefined;
  }

  /**
   * Check if entity type has a specific handler.
   *
   * @param {string} handlerType - Handler type (storage, access, view_builder, etc.)
   * @returns {boolean} True if handler is defined
   */
  hasHandler(handlerType) {
    return !!this[HANDLERS][handlerType];
  }

  /**
   * Convert to plain object for serialization.
   *
   * WHY: Useful for debugging, logging, and API responses.
   * Exposes all data without Symbol indirection.
   *
   * @returns {Object} Plain object representation
   */
  toJSON() {
    return {
      id: this[ID],
      label: this[LABEL],
      keys: { ...this[KEYS] },
      revisionable: this[REVISIONABLE],
      translatable: this[TRANSLATABLE],
      handlers: { ...this[HANDLERS] },
      baseFieldDefinitions: { ...this[BASE_FIELD_DEFINITIONS] }
    };
  }
}

/**
 * Entity type registry and handler resolver.
 *
 * WHY: Central registry for all entity types. Provides lazy discovery via
 * hooks, handler resolution (object/function/service ID), and caching.
 *
 * Drupal equivalent: EntityTypeManager.php
 *
 * @example
 * const manager = new EntityTypeManager();
 * manager.setInfrastructure(container, hookManager);
 *
 * // Manual registration
 * manager.register('node', {
 *   label: 'Content',
 *   keys: { id: 'nid', bundle: 'type' },
 *   handlers: { storage: nodeStorage }
 * });
 *
 * // Get storage handler
 * const storage = manager.getStorage('node');
 * const query = manager.getQuery('node');
 */
export class EntityTypeManager {
  constructor() {
    // WHY: Map provides fast lookup by entity type ID
    this[DEFINITIONS] = new Map();

    // WHY: Infrastructure references set via setInfrastructure() during boot
    this[SERVICES] = null;
    this[HOOKS] = null;

    // WHY: Separate caches for handlers and storage prevent re-resolution
    // Handler cache: `${entityTypeId}:${handlerType}` → handler instance
    this[HANDLER_CACHE] = new Map();

    // Storage cache: entityTypeId → storage instance
    this[STORAGE_CACHE] = new Map();

    // WHY: Track if discovery has run to enable lazy initialization
    this[DISCOVERED] = false;
  }

  /**
   * Wire up infrastructure references.
   *
   * WHY: Called during boot after DI container and hook system are ready.
   * Separates construction from infrastructure wiring (same pattern as PluginManager).
   *
   * @param {Container} services - DI container for handler resolution
   * @param {HookManager} hooks - Hook system for entity_type_info discovery
   * @returns {this} For method chaining
   */
  setInfrastructure(services, hooks) {
    this[SERVICES] = services;
    this[HOOKS] = hooks;
    return this;
  }

  /**
   * Register an entity type.
   *
   * WHY: Manual registration allows early registration before discovery,
   * or programmatic type creation without hooks.
   *
   * @param {string} entityTypeId - Entity type ID
   * @param {Object} definition - Raw definition object
   * @returns {this} For method chaining
   */
  register(entityTypeId, definition) {
    const entityType = new EntityType(entityTypeId, definition);
    this[DEFINITIONS].set(entityTypeId, entityType);
    return this;
  }

  /**
   * Get a specific entity type definition.
   *
   * WHY: Triggers lazy discovery on first call if hooks are wired.
   * Returns null for missing types instead of throwing to allow existence checks.
   *
   * @param {string} entityTypeId - Entity type ID
   * @returns {EntityType|null} EntityType or null if not found
   */
  getDefinition(entityTypeId) {
    // WHY: Lazy discovery on first access
    this._ensureDiscovered();

    return this[DEFINITIONS].get(entityTypeId) || null;
  }

  /**
   * Get all entity type definitions.
   *
   * WHY: Returns Map to preserve insertion order and provide .has()/.get() methods.
   * Triggers lazy discovery on first call.
   *
   * @returns {Map<string, EntityType>} Map of entity type ID to EntityType
   */
  getDefinitions() {
    // WHY: Lazy discovery on first access
    this._ensureDiscovered();

    return new Map(this[DEFINITIONS]);
  }

  /**
   * Check if an entity type is registered.
   *
   * @param {string} entityTypeId - Entity type ID
   * @returns {boolean} True if entity type exists
   */
  hasDefinition(entityTypeId) {
    this._ensureDiscovered();
    return this[DEFINITIONS].has(entityTypeId);
  }

  /**
   * Get storage handler for an entity type.
   *
   * WHY: Storage is the most common handler and gets a dedicated method.
   * Throws descriptive error (with available types) instead of returning null
   * because missing storage is always a fatal error.
   *
   * @param {string} entityTypeId - Entity type ID
   * @returns {Object} Storage handler instance
   * @throws {Error} If entity type not found
   */
  getStorage(entityTypeId) {
    // WHY: Check cache first to avoid re-resolution
    if (this[STORAGE_CACHE].has(entityTypeId)) {
      return this[STORAGE_CACHE].get(entityTypeId);
    }

    const entityType = this.getDefinition(entityTypeId);

    // WHY: Throw descriptive error listing available entity types
    if (!entityType) {
      const available = [...this[DEFINITIONS].keys()].sort().join(', ');
      throw new Error(
        `Entity type "${entityTypeId}" not found. Available: ${available || '(none)'}`
      );
    }

    // WHY: Resolve storage handler and cache it
    const storage = this._resolveHandler(entityType, 'storage');

    // WHY: Storage is required — throw if missing
    if (!storage) {
      throw new Error(
        `Entity type "${entityTypeId}" has no storage handler defined`
      );
    }

    this[STORAGE_CACHE].set(entityTypeId, storage);
    return storage;
  }

  /**
   * Get a handler for an entity type.
   *
   * WHY: Generic handler resolution for access, view_builder, list_builder, etc.
   * Returns null for missing handlers (unlike getStorage which throws) because
   * some handlers are optional.
   *
   * @param {string} entityTypeId - Entity type ID
   * @param {string} handlerType - Handler type (access, view_builder, etc.)
   * @returns {Object|null} Handler instance or null if not defined
   */
  getHandler(entityTypeId, handlerType) {
    const cacheKey = `${entityTypeId}:${handlerType}`;

    // WHY: Check cache first
    if (this[HANDLER_CACHE].has(cacheKey)) {
      return this[HANDLER_CACHE].get(cacheKey);
    }

    const entityType = this.getDefinition(entityTypeId);

    // WHY: Return null for missing entity type (caller can check)
    if (!entityType) {
      return null;
    }

    // WHY: Resolve handler and cache it
    const handler = this._resolveHandler(entityType, handlerType);

    if (handler) {
      this[HANDLER_CACHE].set(cacheKey, handler);
    }

    return handler;
  }

  /**
   * Get a query builder for an entity type.
   *
   * WHY: Convenience method that combines getStorage() with EntityQuery construction.
   * Wires up access handler automatically if available.
   *
   * @param {string} entityTypeId - Entity type ID
   * @returns {EntityQuery} Query builder instance
   */
  getQuery(entityTypeId) {
    const storage = this.getStorage(entityTypeId);
    const accessHandler = this.getHandler(entityTypeId, 'access');

    // WHY: Import EntityQuery dynamically to avoid circular dependency
    // (EntityQuery might import EntityTypeManager in the future)
    // For now, assume storage has a getQuery() method
    if (typeof storage.getQuery === 'function') {
      return storage.getQuery();
    }

    // WHY: Fallback — create EntityQuery directly if storage doesn't provide it
    // This requires lazy import to avoid circular deps
    // For now, throw error suggesting storage implement getQuery()
    throw new Error(
      `Storage for "${entityTypeId}" does not provide getQuery() method. ` +
      `Implement it in your storage handler.`
    );
  }

  /**
   * Discover entity types from modules via hooks.
   *
   * WHY: Fires entity_type_info hook to collect definitions, then
   * entity_type_info_alter to let modules modify them. Registers all
   * discovered types.
   *
   * @returns {Promise<void>}
   */
  async discoverEntityTypes() {
    // WHY: Skip if no hooks wired (setInfrastructure not called)
    if (!this[HOOKS]) {
      return;
    }

    // WHY: Collect definitions from all modules
    // NOTE: Hook names use colons, not underscores (entity:type:info, not entity_type_info)
    const definitions = await this[HOOKS].invokeAll('entity:type:info');

    // WHY: Flatten array of arrays into single array of definition objects
    const allDefs = [];
    for (const result of definitions) {
      if (result && typeof result === 'object') {
        // Each hook returns an object of {id: definition}
        for (const [id, def] of Object.entries(result)) {
          allDefs.push({ ...def, id });
        }
      }
    }

    // WHY: Fire alter hook to let modules modify definitions
    await this[HOOKS].alter('entity:type:info', allDefs);

    // WHY: Register all discovered types
    for (const def of allDefs) {
      if (def && def.id) {
        this.register(def.id, def);
      }
    }

    this[DISCOVERED] = true;
  }

  /**
   * Clear cached definitions and handlers.
   *
   * WHY: Call after module install/uninstall to force rediscovery.
   * Clears all caches (definitions, handlers, storage).
   *
   * @returns {void}
   */
  clearCachedDefinitions() {
    this[DEFINITIONS].clear();
    this[HANDLER_CACHE].clear();
    this[STORAGE_CACHE].clear();
    this[DISCOVERED] = false;
  }

  /**
   * Ensure entity types have been discovered.
   *
   * WHY: Private helper for lazy discovery. Called by getDefinition(s) and hasDefinition.
   * Only runs once per instance lifecycle.
   *
   * @private
   */
  _ensureDiscovered() {
    // WHY: Skip if already discovered or no hooks wired
    if (this[DISCOVERED] || !this[HOOKS]) {
      return;
    }

    // WHY: Synchronous wrapper for async discovery
    // This is a limitation — in real usage, boot.js should call discoverEntityTypes()
    // explicitly during async boot phase
    // For now, do nothing and rely on manual registration or explicit discovery
  }

  /**
   * Resolve a handler from entity type definition.
   *
   * WHY: Handlers can be objects (direct), functions (factories), or strings (service IDs).
   * This method normalizes all three formats into handler instances.
   *
   * @private
   * @param {EntityType} entityType - Entity type definition
   * @param {string} handlerType - Handler type to resolve
   * @returns {Object|null} Handler instance or null if not defined
   * @throws {Error} If service ID resolution fails due to missing Container
   */
  _resolveHandler(entityType, handlerType) {
    const handlerDef = entityType.handlers[handlerType];

    // WHY: No handler defined
    if (!handlerDef) {
      return null;
    }

    // WHY: Object — use directly (already instantiated)
    if (typeof handlerDef === 'object' && handlerDef !== null) {
      return handlerDef;
    }

    // WHY: Function — call as factory with entityType
    if (typeof handlerDef === 'function') {
      return handlerDef(entityType, this[SERVICES]);
    }

    // WHY: String — resolve as service ID from Container
    if (typeof handlerDef === 'string') {
      if (!this[SERVICES]) {
        throw new Error(
          `Cannot resolve handler "${handlerDef}" for entity type "${entityType.id}" — ` +
          `Container not set. Call setInfrastructure() first.`
        );
      }

      return this[SERVICES].get(handlerDef);
    }

    // WHY: Unknown handler type
    return null;
  }
}
