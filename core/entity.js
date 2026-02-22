/**
 * entity.js - Entity API Abstraction Layer
 *
 * Unified API for content, users, terms, media, blocks, menu links.
 * Inspired by Drupal's Entity API - provides consistent interface across entity types.
 *
 * WHY ENTITY ABSTRACTION:
 * - Unified CRUD operations across all content types
 * - Consistent query interface regardless of storage backend
 * - Centralized access control and validation
 * - Hooks for extending entity behavior
 * - Support for entity references and relationships
 *
 * ENTITY STRUCTURE:
 * {
 *   entityType: 'content',
 *   bundle: 'article',
 *   id: 'article-1',
 *   uuid: '550e8400-e29b-41d4-a716-446655440000',
 *   label: 'My Article',
 *   created: '2024-01-15T12:00:00.000Z',
 *   updated: '2024-01-15T12:00:00.000Z',
 *   author: 'user-1',
 *   status: 'published',
 *   fields: { ... }
 * }
 *
 * SUPPORTED ENTITY TYPES:
 * - content: Articles, pages, custom content types
 * - user: User accounts
 * - term: Taxonomy terms
 * - media: Files, images, videos
 * - block: Layout blocks
 * - menu_link: Menu navigation items
 */

import { randomUUID } from 'node:crypto';
import * as hooks from './hooks.ts';

/**
 * Entity type registry
 * Maps entity type names to their storage backends and configuration
 */
const entityTypes = new Map();

/**
 * Storage backend references
 */
let contentStorage = null;
let taxonomyStorage = null;
let authStorage = null;
let mediaStorage = null;
let blocksStorage = null;

/**
 * Initialize entity system with storage backends
 *
 * @param {Object} storage - Storage backend references
 * @param {Object} storage.content - Content storage
 * @param {Object} storage.taxonomy - Taxonomy storage
 * @param {Object} storage.auth - Auth/user storage
 * @param {Object} storage.media - Media storage
 * @param {Object} storage.blocks - Block storage
 */
export function init(storage = {}) {
  contentStorage = storage.content || null;
  taxonomyStorage = storage.taxonomy || null;
  authStorage = storage.auth || null;
  mediaStorage = storage.media || null;
  blocksStorage = storage.blocks || null;

  // Register built-in entity types
  registerEntityType('content', {
    storage: contentStorage,
    labelField: 'title',
    bundleField: 'type',
    idField: 'id',
    hooks: true
  });

  registerEntityType('user', {
    storage: authStorage,
    labelField: 'username',
    bundleField: null,
    idField: 'id',
    hooks: true
  });

  registerEntityType('term', {
    storage: taxonomyStorage,
    labelField: 'name',
    bundleField: 'vocabulary',
    idField: 'id',
    hooks: true
  });

  registerEntityType('media', {
    storage: mediaStorage,
    labelField: 'filename',
    bundleField: 'type',
    idField: 'id',
    hooks: true
  });

  registerEntityType('block', {
    storage: blocksStorage,
    labelField: 'title',
    bundleField: 'type',
    idField: 'id',
    hooks: true
  });

  registerEntityType('menu_link', {
    storage: null,
    labelField: 'title',
    bundleField: 'menu',
    idField: 'id',
    hooks: true
  });
}

/**
 * Register an entity type
 *
 * @param {string} type - Entity type name
 * @param {Object} config - Entity type configuration
 * @param {Object} config.storage - Storage backend
 * @param {string} config.labelField - Field to use for entity label
 * @param {string|null} config.bundleField - Field containing bundle/subtype
 * @param {string} config.idField - Field containing entity ID
 * @param {boolean} config.hooks - Enable hooks for this entity type
 */
export function registerEntityType(type, config) {
  if (!config.storage && type !== 'menu_link') {
    throw new Error(`Entity type "${type}" requires storage backend`);
  }

  entityTypes.set(type, {
    storage: config.storage,
    labelField: config.labelField || 'title',
    bundleField: config.bundleField,
    idField: config.idField || 'id',
    hooks: config.hooks !== false
  });
}

/**
 * Get entity type configuration
 *
 * @param {string} type - Entity type name
 * @returns {Object|null} Entity type configuration
 */
export function getEntityType(type) {
  return entityTypes.get(type) || null;
}

/**
 * List all registered entity types
 *
 * @returns {Array<string>} Entity type names
 */
export function listEntityTypes() {
  return Array.from(entityTypes.keys());
}

/**
 * Create a new entity
 *
 * @param {string} entityType - Entity type name
 * @param {string} bundle - Entity bundle/subtype
 * @param {Object} data - Entity data
 * @returns {Promise<Object>} Created entity
 */
export async function create(entityType, bundle, data) {
  const typeConfig = getEntityType(entityType);
  if (!typeConfig) {
    throw new Error(`Unknown entity type: ${entityType}`);
  }

  // Build entity structure
  const entity = {
    entityType,
    bundle,
    id: null,
    uuid: randomUUID(),
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    ...data
  };

  // Validate entity
  await validate(entity);

  // Pre-save hook
  if (typeConfig.hooks) {
    await hooks.trigger('entity:presave', { entity, isNew: true });
    await hooks.trigger(`entity:${entityType}:presave`, { entity, isNew: true });
  }

  // Create via storage backend
  let savedEntity;
  switch (entityType) {
    case 'content':
      savedEntity = await typeConfig.storage.create(bundle, entity);
      break;
    case 'user':
      savedEntity = await typeConfig.storage.createUser(entity);
      break;
    case 'term':
      savedEntity = await typeConfig.storage.createTerm(entity.vocabulary, entity);
      break;
    case 'media':
      savedEntity = await typeConfig.storage.create(entity);
      break;
    case 'block':
      savedEntity = await typeConfig.storage.create(entity);
      break;
    default:
      throw new Error(`Entity type "${entityType}" does not support create()`);
  }

  // Post-save hook
  if (typeConfig.hooks) {
    await hooks.trigger('entity:postsave', { entity: savedEntity, isNew: true });
    await hooks.trigger(`entity:${entityType}:postsave`, { entity: savedEntity, isNew: true });
  }

  return savedEntity;
}

/**
 * Load an entity by ID
 *
 * @param {string} entityType - Entity type name
 * @param {string} id - Entity ID
 * @returns {Promise<Object|null>} Entity or null if not found
 */
export async function load(entityType, id) {
  const typeConfig = getEntityType(entityType);
  if (!typeConfig) {
    throw new Error(`Unknown entity type: ${entityType}`);
  }

  let entity;
  switch (entityType) {
    case 'content':
      entity = await typeConfig.storage.get(id);
      break;
    case 'user':
      entity = await typeConfig.storage.getUser(id);
      break;
    case 'term':
      entity = await typeConfig.storage.getTerm(id);
      break;
    case 'media':
      entity = await typeConfig.storage.get(id);
      break;
    case 'block':
      entity = await typeConfig.storage.get(id);
      break;
    default:
      throw new Error(`Entity type "${entityType}" does not support load()`);
  }

  if (!entity) {
    return null;
  }

  // Add entity type metadata
  entity.entityType = entityType;
  entity.bundle = getBundle(entity, typeConfig);

  // Load hook
  if (typeConfig.hooks) {
    await hooks.trigger('entity:load', { entity });
    await hooks.trigger(`entity:${entityType}:load`, { entity });
  }

  return entity;
}

/**
 * Load multiple entities by ID
 *
 * @param {string} entityType - Entity type name
 * @param {Array<string>} ids - Entity IDs
 * @returns {Promise<Array<Object>>} Array of entities
 */
export async function loadMultiple(entityType, ids) {
  const entities = await Promise.all(
    ids.map(id => load(entityType, id))
  );
  return entities.filter(entity => entity !== null);
}

/**
 * Save an entity (update if exists, create if new)
 *
 * @param {Object} entity - Entity to save
 * @returns {Promise<Object>} Saved entity
 */
export async function save(entity) {
  if (!entity.entityType) {
    throw new Error('Entity missing entityType field');
  }

  const typeConfig = getEntityType(entity.entityType);
  if (!typeConfig) {
    throw new Error(`Unknown entity type: ${entity.entityType}`);
  }

  const isNew = !entity.id;

  // Update timestamp
  entity.updated = new Date().toISOString();
  if (isNew) {
    entity.created = entity.created || entity.updated;
    entity.uuid = entity.uuid || randomUUID();
  }

  // Validate entity
  await validate(entity);

  // Pre-save hook
  if (typeConfig.hooks) {
    await hooks.trigger('entity:presave', { entity, isNew });
    await hooks.trigger(`entity:${entity.entityType}:presave`, { entity, isNew });
  }

  // Save via storage backend
  let savedEntity;
  switch (entity.entityType) {
    case 'content':
      savedEntity = isNew
        ? await typeConfig.storage.create(entity.bundle, entity)
        : await typeConfig.storage.update(entity.id, entity);
      break;
    case 'user':
      savedEntity = isNew
        ? await typeConfig.storage.createUser(entity)
        : await typeConfig.storage.updateUser(entity.id, entity);
      break;
    case 'term':
      savedEntity = isNew
        ? await typeConfig.storage.createTerm(entity.vocabulary, entity)
        : await typeConfig.storage.updateTerm(entity.id, entity);
      break;
    case 'media':
      savedEntity = isNew
        ? await typeConfig.storage.create(entity)
        : await typeConfig.storage.update(entity.id, entity);
      break;
    case 'block':
      savedEntity = isNew
        ? await typeConfig.storage.create(entity)
        : await typeConfig.storage.update(entity.id, entity);
      break;
    default:
      throw new Error(`Entity type "${entity.entityType}" does not support save()`);
  }

  // Post-save hook
  if (typeConfig.hooks) {
    await hooks.trigger('entity:postsave', { entity: savedEntity, isNew });
    await hooks.trigger(`entity:${entity.entityType}:postsave`, { entity: savedEntity, isNew });
  }

  return savedEntity;
}

/**
 * Delete an entity
 *
 * @param {string} entityType - Entity type name
 * @param {string} id - Entity ID
 * @returns {Promise<boolean>} True if deleted
 */
export async function deleteEntity(entityType, id) {
  const typeConfig = getEntityType(entityType);
  if (!typeConfig) {
    throw new Error(`Unknown entity type: ${entityType}`);
  }

  // Load entity for hooks
  const entity = await load(entityType, id);
  if (!entity) {
    return false;
  }

  // Pre-delete hook
  if (typeConfig.hooks) {
    await hooks.trigger('entity:predelete', { entity });
    await hooks.trigger(`entity:${entityType}:predelete`, { entity });
  }

  // Delete via storage backend
  let deleted;
  switch (entityType) {
    case 'content':
      deleted = await typeConfig.storage.delete(id);
      break;
    case 'user':
      deleted = await typeConfig.storage.deleteUser(id);
      break;
    case 'term':
      deleted = await typeConfig.storage.deleteTerm(id);
      break;
    case 'media':
      deleted = await typeConfig.storage.delete(id);
      break;
    case 'block':
      deleted = await typeConfig.storage.delete(id);
      break;
    default:
      throw new Error(`Entity type "${entityType}" does not support delete()`);
  }

  // Post-delete hook
  if (typeConfig.hooks && deleted) {
    await hooks.trigger('entity:postdelete', { entity });
    await hooks.trigger(`entity:${entityType}:postdelete`, { entity });
  }

  return deleted;
}

/**
 * Create query builder for entity type
 *
 * @param {string} entityType - Entity type name
 * @returns {Object} Query builder
 */
export function query(entityType) {
  const typeConfig = getEntityType(entityType);
  if (!typeConfig) {
    throw new Error(`Unknown entity type: ${entityType}`);
  }

  const conditions = [];
  const sorts = [];
  let rangeStart = 0;
  let rangeLimit = null;

  return {
    condition(field, value, operator = '=') {
      conditions.push({ field, value, operator });
      return this;
    },

    sort(field, direction = 'asc') {
      sorts.push({ field, direction });
      return this;
    },

    range(start, limit) {
      rangeStart = start;
      rangeLimit = limit;
      return this;
    },

    async execute() {
      // Load all entities of this type
      let entities = [];

      switch (entityType) {
        case 'content':
          const types = await typeConfig.storage.listTypes();
          for (const type of types) {
            const items = await typeConfig.storage.list(type);
            entities.push(...items.map(item => ({ ...item, entityType, bundle: type })));
          }
          break;
        case 'user':
          const users = await typeConfig.storage.listUsers();
          entities = users.map(user => ({ ...user, entityType, bundle: null }));
          break;
        case 'term':
          const vocabs = await typeConfig.storage.listVocabularies();
          for (const vocab of vocabs) {
            const terms = await typeConfig.storage.listTerms(vocab);
            entities.push(...terms.map(term => ({ ...term, entityType, bundle: vocab })));
          }
          break;
        case 'media':
          entities = (await typeConfig.storage.list()).map(item => ({ ...item, entityType, bundle: item.type }));
          break;
        case 'block':
          entities = (await typeConfig.storage.list()).map(item => ({ ...item, entityType, bundle: item.type }));
          break;
      }

      // Apply conditions
      entities = entities.filter(entity => {
        return conditions.every(cond => {
          const fieldValue = entity[cond.field];

          switch (cond.operator) {
            case '=':
              return fieldValue === cond.value;
            case '!=':
              return fieldValue !== cond.value;
            case '>':
              return fieldValue > cond.value;
            case '>=':
              return fieldValue >= cond.value;
            case '<':
              return fieldValue < cond.value;
            case '<=':
              return fieldValue <= cond.value;
            case 'IN':
              return Array.isArray(cond.value) && cond.value.includes(fieldValue);
            case 'CONTAINS':
              return Array.isArray(fieldValue) && fieldValue.includes(cond.value);
            default:
              return true;
          }
        });
      });

      // Apply sorts
      for (const sort of sorts.reverse()) {
        entities.sort((a, b) => {
          const aVal = a[sort.field];
          const bVal = b[sort.field];
          const mult = sort.direction === 'desc' ? -1 : 1;

          if (aVal < bVal) return -1 * mult;
          if (aVal > bVal) return 1 * mult;
          return 0;
        });
      }

      // Apply range
      if (rangeLimit !== null) {
        entities = entities.slice(rangeStart, rangeStart + rangeLimit);
      } else if (rangeStart > 0) {
        entities = entities.slice(rangeStart);
      }

      return entities;
    }
  };
}

/**
 * Check entity access
 *
 * @param {Object} entity - Entity to check
 * @param {string} operation - Operation (view, update, delete)
 * @param {Object} user - User to check access for
 * @returns {Promise<boolean>} True if access granted
 */
export async function access(entity, operation, user) {
  const context = { entity, operation, user, access: true };

  await hooks.trigger('entity:access', context);
  await hooks.trigger(`entity:${entity.entityType}:access`, context);

  return context.access;
}

/**
 * Validate entity
 *
 * @param {Object} entity - Entity to validate
 * @returns {Promise<void>} Throws if validation fails
 */
export async function validate(entity) {
  const errors = [];
  const context = { entity, errors };

  await hooks.trigger('entity:validate', context);
  await hooks.trigger(`entity:${entity.entityType}:validate`, context);

  if (context.errors.length > 0) {
    throw new Error(`Validation failed: ${context.errors.join(', ')}`);
  }
}

/**
 * Get entity label
 *
 * @param {Object} entity - Entity
 * @returns {string} Entity label
 */
export function getLabel(entity) {
  const typeConfig = getEntityType(entity.entityType);
  if (!typeConfig) {
    return entity.id || 'Unknown';
  }

  return entity[typeConfig.labelField] || entity.id || 'Untitled';
}

/**
 * Get entity bundle
 *
 * @param {Object} entity - Entity
 * @param {Object} typeConfig - Entity type config (optional)
 * @returns {string|null} Bundle name
 */
export function getBundle(entity, typeConfig = null) {
  if (!typeConfig) {
    typeConfig = getEntityType(entity.entityType);
  }

  if (!typeConfig || !typeConfig.bundleField) {
    return null;
  }

  return entity[typeConfig.bundleField] || null;
}

/**
 * Serialize entity to array/object for storage
 *
 * @param {Object} entity - Entity to serialize
 * @returns {Object} Serialized entity
 */
export function toArray(entity) {
  return { ...entity };
}

/**
 * Deserialize entity from storage
 *
 * @param {string} entityType - Entity type
 * @param {Object} data - Serialized data
 * @returns {Object} Entity object
 */
export function fromArray(entityType, data) {
  const typeConfig = getEntityType(entityType);
  return {
    ...data,
    entityType,
    bundle: getBundle(data, typeConfig)
  };
}

export default {
  init,
  registerEntityType,
  getEntityType,
  listEntityTypes,
  create,
  load,
  loadMultiple,
  save,
  delete: deleteEntity,
  query,
  access,
  validate,
  getLabel,
  getBundle,
  toArray,
  fromArray
};
