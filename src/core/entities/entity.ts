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
import * as hooks from '../../../core/hooks.ts';

// ============================================
// TYPE DEFINITIONS
// ============================================

/** Generic storage backend — modules provide different method shapes */
interface StorageBackend {
  [key: string]: unknown;
}

/**
 * Call a method on a storage backend by name.
 * Storage backends are untyped (come from JS modules with dynamic dispatch),
 * so we use this helper to safely invoke methods without noUncheckedIndexedAccess issues.
 */
function callStorage(
  storage: StorageBackend | null,
  method: string,
  ...args: unknown[]
): Promise<unknown> {
  const fn = (storage as Record<string, unknown>)?.[method];
  if (typeof fn !== 'function') {
    throw new Error(`Storage backend does not implement method: ${method}`);
  }
  return fn.apply(storage, args) as Promise<unknown>;
}

/** Entity type configuration in the registry */
export interface EntityTypeConfig {
  storage: StorageBackend | null;
  labelField: string;
  bundleField: string | null;
  idField: string;
  hooks: boolean;
}

/** Base entity structure — all entities share these core fields */
export interface Entity {
  entityType: string;
  bundle: string | null;
  id: string | null;
  uuid: string;
  created: string;
  updated: string;
  [key: string]: unknown;
}

/** Storage init configuration */
interface StorageConfig {
  content?: StorageBackend | null;
  taxonomy?: StorageBackend | null;
  auth?: StorageBackend | null;
  media?: StorageBackend | null;
  blocks?: StorageBackend | null;
}

/** Query condition */
interface QueryCondition {
  field: string;
  value: unknown;
  operator: string;
}

/** Query sort */
interface QuerySort {
  field: string;
  direction: string;
}

/** Query builder returned by query() */
export interface EntityQueryBuilder {
  condition: (field: string, value: unknown, operator?: string) => EntityQueryBuilder;
  sort: (field: string, direction?: string) => EntityQueryBuilder;
  range: (start: number, limit: number) => EntityQueryBuilder;
  execute: () => Promise<Entity[]>;
}

/**
 * Entity type registry
 * Maps entity type names to their storage backends and configuration
 */
const entityTypes: Map<string, EntityTypeConfig> = new Map();

/**
 * Storage backend references
 */
let contentStorage: StorageBackend | null = null;
let taxonomyStorage: StorageBackend | null = null;
let authStorage: StorageBackend | null = null;
let mediaStorage: StorageBackend | null = null;
let blocksStorage: StorageBackend | null = null;

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
export function init(storage: StorageConfig = {}): void {
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
    hooks: true,
  });

  registerEntityType('user', {
    storage: authStorage,
    labelField: 'username',
    bundleField: null,
    idField: 'id',
    hooks: true,
  });

  registerEntityType('term', {
    storage: taxonomyStorage,
    labelField: 'name',
    bundleField: 'vocabulary',
    idField: 'id',
    hooks: true,
  });

  registerEntityType('media', {
    storage: mediaStorage,
    labelField: 'filename',
    bundleField: 'type',
    idField: 'id',
    hooks: true,
  });

  registerEntityType('block', {
    storage: blocksStorage,
    labelField: 'title',
    bundleField: 'type',
    idField: 'id',
    hooks: true,
  });

  registerEntityType('menu_link', {
    storage: null,
    labelField: 'title',
    bundleField: 'menu',
    idField: 'id',
    hooks: true,
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
export function registerEntityType(
  type: string,
  config: Partial<EntityTypeConfig> & { storage: StorageBackend | null }
): void {
  if (!config.storage && type !== 'menu_link') {
    throw new Error(`Entity type "${type}" requires storage backend`);
  }

  entityTypes.set(type, {
    storage: config.storage,
    labelField: config.labelField || 'title',
    bundleField: config.bundleField ?? null,
    idField: config.idField || 'id',
    hooks: config.hooks !== false,
  });
}

/**
 * Get entity type configuration
 *
 * @param {string} type - Entity type name
 * @returns {Object|null} Entity type configuration
 */
export function getEntityType(type: string): EntityTypeConfig | null {
  return entityTypes.get(type) ?? null;
}

/**
 * List all registered entity types
 *
 * @returns {Array<string>} Entity type names
 */
export function listEntityTypes(): string[] {
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
export async function create(
  entityType: string,
  bundle: string,
  data: Record<string, unknown>
): Promise<Entity> {
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
    ...data,
  };

  // Validate entity
  await validate(entity);

  // Pre-save hook
  if (typeConfig.hooks) {
    await hooks.trigger('entity:presave', { entity, isNew: true });
    await hooks.trigger(`entity:${entityType}:presave`, { entity, isNew: true });
  }

  // Create via storage backend
  let savedEntity: Entity;
  switch (entityType) {
    case 'content':
      savedEntity = (await callStorage(typeConfig.storage, 'create', bundle, entity)) as Entity;
      break;
    case 'user':
      savedEntity = (await callStorage(typeConfig.storage, 'createUser', entity)) as Entity;
      break;
    case 'term':
      savedEntity = (await callStorage(
        typeConfig.storage,
        'createTerm',
        (entity as Record<string, unknown>).vocabulary,
        entity
      )) as Entity;
      break;
    case 'media':
      savedEntity = (await callStorage(typeConfig.storage, 'create', entity)) as Entity;
      break;
    case 'block':
      savedEntity = (await callStorage(typeConfig.storage, 'create', entity)) as Entity;
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
export async function load(entityType: string, id: string): Promise<Entity | null> {
  const typeConfig = getEntityType(entityType);
  if (!typeConfig) {
    throw new Error(`Unknown entity type: ${entityType}`);
  }

  let entity: Entity | null;
  switch (entityType) {
    case 'content':
      entity = (await callStorage(typeConfig.storage, 'get', id)) as Entity | null;
      break;
    case 'user':
      entity = (await callStorage(typeConfig.storage, 'getUser', id)) as Entity | null;
      break;
    case 'term':
      entity = (await callStorage(typeConfig.storage, 'getTerm', id)) as Entity | null;
      break;
    case 'media':
      entity = (await callStorage(typeConfig.storage, 'get', id)) as Entity | null;
      break;
    case 'block':
      entity = (await callStorage(typeConfig.storage, 'get', id)) as Entity | null;
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
export async function loadMultiple(entityType: string, ids: string[]): Promise<Entity[]> {
  const entities = await Promise.all(ids.map((id) => load(entityType, id)));
  return entities.filter((entity) => entity !== null);
}

/**
 * Save an entity (update if exists, create if new)
 *
 * @param {Object} entity - Entity to save
 * @returns {Promise<Object>} Saved entity
 */
export async function save(entity: Entity): Promise<Entity> {
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
  let savedEntity: Entity;
  switch (entity.entityType) {
    case 'content':
      savedEntity = (
        isNew
          ? await callStorage(typeConfig.storage, 'create', entity.bundle, entity)
          : await callStorage(typeConfig.storage, 'update', entity.id, entity)
      ) as Entity;
      break;
    case 'user':
      savedEntity = (
        isNew
          ? await callStorage(typeConfig.storage, 'createUser', entity)
          : await callStorage(typeConfig.storage, 'updateUser', entity.id, entity)
      ) as Entity;
      break;
    case 'term':
      savedEntity = (
        isNew
          ? await callStorage(
              typeConfig.storage,
              'createTerm',
              (entity as Record<string, unknown>).vocabulary,
              entity
            )
          : await callStorage(typeConfig.storage, 'updateTerm', entity.id, entity)
      ) as Entity;
      break;
    case 'media':
      savedEntity = (
        isNew
          ? await callStorage(typeConfig.storage, 'create', entity)
          : await callStorage(typeConfig.storage, 'update', entity.id, entity)
      ) as Entity;
      break;
    case 'block':
      savedEntity = (
        isNew
          ? await callStorage(typeConfig.storage, 'create', entity)
          : await callStorage(typeConfig.storage, 'update', entity.id, entity)
      ) as Entity;
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
export async function deleteEntity(entityType: string, id: string): Promise<boolean> {
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
  let deleted: boolean;
  switch (entityType) {
    case 'content':
      deleted = (await callStorage(typeConfig.storage, 'delete', id)) as boolean;
      break;
    case 'user':
      deleted = (await callStorage(typeConfig.storage, 'deleteUser', id)) as boolean;
      break;
    case 'term':
      deleted = (await callStorage(typeConfig.storage, 'deleteTerm', id)) as boolean;
      break;
    case 'media':
      deleted = (await callStorage(typeConfig.storage, 'delete', id)) as boolean;
      break;
    case 'block':
      deleted = (await callStorage(typeConfig.storage, 'delete', id)) as boolean;
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
export function query(entityType: string): EntityQueryBuilder {
  const typeConfig = getEntityType(entityType);
  if (!typeConfig) {
    throw new Error(`Unknown entity type: ${entityType}`);
  }

  const conditions: QueryCondition[] = [];
  const sorts: QuerySort[] = [];
  let rangeStart = 0;
  let rangeLimit: number | null = null;

  return {
    condition(field: string, value: unknown, operator: string = '='): EntityQueryBuilder {
      conditions.push({ field, value, operator });
      return this;
    },

    sort(field: string, direction: string = 'asc'): EntityQueryBuilder {
      sorts.push({ field, direction });
      return this;
    },

    range(start: number, limit: number): EntityQueryBuilder {
      rangeStart = start;
      rangeLimit = limit;
      return this;
    },

    async execute(): Promise<Entity[]> {
      // Load all entities of this type
      let entities: Entity[] = [];

      switch (entityType) {
        case 'content': {
          const types = (await callStorage(typeConfig.storage, 'listTypes')) as string[];
          for (const type of types) {
            const items = (await callStorage(typeConfig.storage, 'list', type)) as Entity[];
            entities.push(...items.map((item: Entity) => ({ ...item, entityType, bundle: type })));
          }
          break;
        }
        case 'user': {
          const users = (await callStorage(typeConfig.storage, 'listUsers')) as Entity[];
          entities = users.map((user: Entity) => ({ ...user, entityType, bundle: null }));
          break;
        }
        case 'term': {
          const vocabs = (await callStorage(typeConfig.storage, 'listVocabularies')) as string[];
          for (const vocab of vocabs) {
            const terms = (await callStorage(typeConfig.storage, 'listTerms', vocab)) as Entity[];
            entities.push(...terms.map((term: Entity) => ({ ...term, entityType, bundle: vocab })));
          }
          break;
        }
        case 'media':
          entities = ((await callStorage(typeConfig.storage, 'list')) as Entity[]).map(
            (item: Entity) => ({ ...item, entityType, bundle: item.type as string | null })
          );
          break;
        case 'block':
          entities = ((await callStorage(typeConfig.storage, 'list')) as Entity[]).map(
            (item: Entity) => ({ ...item, entityType, bundle: item.type as string | null })
          );
          break;
      }

      // Apply conditions
      entities = entities.filter((entity) => {
        return conditions.every((cond) => {
          const fieldValue = entity[cond.field];

          // Cast to comparable types for relational operators
          const fv = fieldValue as string | number | boolean | null | undefined;
          const cv = cond.value as string | number | boolean | null | undefined;

          switch (cond.operator) {
            case '=':
              return fv === cv;
            case '!=':
              return fv !== cv;
            case '>':
              return (fv as number) > (cv as number);
            case '>=':
              return (fv as number) >= (cv as number);
            case '<':
              return (fv as number) < (cv as number);
            case '<=':
              return (fv as number) <= (cv as number);
            case 'IN':
              return Array.isArray(cond.value) && (cond.value as unknown[]).includes(fieldValue);
            case 'CONTAINS':
              return Array.isArray(fieldValue) && (fieldValue as unknown[]).includes(cond.value);
            default:
              return true;
          }
        });
      });

      // Apply sorts
      for (const sort of sorts.reverse()) {
        entities.sort((a, b) => {
          const aVal = a[sort.field] as string | number | undefined;
          const bVal = b[sort.field] as string | number | undefined;
          const mult = sort.direction === 'desc' ? -1 : 1;

          if (aVal! < bVal!) return -1 * mult;
          if (aVal! > bVal!) return 1 * mult;
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
    },
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
export async function access(
  entity: Entity,
  operation: string,
  user: Record<string, unknown>
): Promise<boolean> {
  const context: Record<string, unknown> = { entity, operation, user, access: true };

  await hooks.trigger('entity:access', context);
  await hooks.trigger(`entity:${entity.entityType}:access`, context);

  return context.access as boolean;
}

/**
 * Validate entity
 *
 * @param {Object} entity - Entity to validate
 * @returns {Promise<void>} Throws if validation fails
 */
export async function validate(entity: Entity): Promise<void> {
  const errors: string[] = [];
  const context: Record<string, unknown> = { entity, errors };

  await hooks.trigger('entity:validate', context);
  await hooks.trigger(`entity:${entity.entityType}:validate`, context);

  if ((context.errors as string[]).length > 0) {
    throw new Error(`Validation failed: ${(context.errors as string[]).join(', ')}`);
  }
}

/**
 * Get entity label
 *
 * @param {Object} entity - Entity
 * @returns {string} Entity label
 */
export function getLabel(entity: Entity): string {
  const typeConfig = getEntityType(entity.entityType);
  if (!typeConfig) {
    return entity.id || 'Unknown';
  }

  return (entity[typeConfig.labelField] as string) || entity.id || 'Untitled';
}

/**
 * Get entity bundle
 *
 * @param {Object} entity - Entity
 * @param {Object} typeConfig - Entity type config (optional)
 * @returns {string|null} Bundle name
 */
export function getBundle(
  entity: Record<string, unknown>,
  typeConfig: EntityTypeConfig | null = null
): string | null {
  if (!typeConfig) {
    typeConfig = getEntityType(entity.entityType as string);
  }

  if (!typeConfig || !typeConfig.bundleField) {
    return null;
  }

  return (entity[typeConfig.bundleField] as string) || null;
}

/**
 * Serialize entity to array/object for storage
 *
 * @param {Object} entity - Entity to serialize
 * @returns {Object} Serialized entity
 */
export function toArray(entity: Entity): Record<string, unknown> {
  return { ...entity };
}

/**
 * Deserialize entity from storage
 *
 * @param {string} entityType - Entity type
 * @param {Object} data - Serialized data
 * @returns {Object} Entity object
 */
export function fromArray(
  entityType: string,
  data: Record<string, unknown>
): Record<string, unknown> {
  const typeConfig = getEntityType(entityType);
  return {
    ...data,
    entityType,
    bundle: getBundle(data, typeConfig),
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
  fromArray,
};
