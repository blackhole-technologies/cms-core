/**
 * entity-types.js - Entity Type and Bundle System
 *
 * DRUPAL-INSPIRED ARCHITECTURE:
 * =============================
 * This module implements a two-level content architecture:
 * 
 * 1. ENTITY TYPES (base definitions)
 *    - Define base fields common to all bundles (e.g., title, status, created)
 *    - Define entity keys (id, uuid, bundle, label)
 *    - Specify capabilities (revisionable, translatable)
 *    - Examples: node, user, taxonomy_term, media
 *
 * 2. BUNDLES (content types)
 *    - Attach to an entity type
 *    - Add bundle-specific fields via field instances
 *    - Configure display modes
 *    - Examples: article, page (bundles of node)
 *
 * FIELD STORAGE SEPARATION:
 * ========================
 * Fields are defined in two parts:
 * 
 * 1. Field Storage (global definition)
 *    - Field type, cardinality, storage settings
 *    - Can be reused across bundles
 *    - ID format: field_{name}
 *
 * 2. Field Instance (per-bundle)
 *    - References a field storage
 *    - Bundle-specific: label, required, default, display
 *    - ID format: {entity_type}.{bundle}.{field_name}
 */

import { join } from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

// ============================================
// REGISTRIES
// ============================================

const entityTypes = {};
const bundles = {};
const fieldStorages = {};
const fieldInstances = {};
const displayModes = {};

let configDir = null;
let contentTypesService = null;

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize the entity type system
 * 
 * @param {string} baseDir - Base directory
 * @param {Object} contentTypes - Content types service (for integration)
 */
export function init(baseDir, contentTypes = null) {
  configDir = join(baseDir, 'config', 'entity-types');
  contentTypesService = contentTypes;
  
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  
  registerBuiltinEntityTypes();
  loadStoredConfigs();
  
  console.log(`[entity-types] Initialized (${Object.keys(entityTypes).length} entity types, ${countBundles()} bundles)`);
}

function countBundles() {
  return Object.values(bundles).reduce((sum, b) => sum + Object.keys(b).length, 0);
}

function registerBuiltinEntityTypes() {
  // Node (content)
  registerEntityType('node', {
    label: 'Content',
    labelPlural: 'Content items',
    entityKeys: { id: 'id', uuid: 'uuid', bundle: 'type', label: 'title', status: 'status' },
    revisionable: true,
    translatable: true,
    baseFields: {
      title: { type: 'string', label: 'Title', required: true },
      status: { type: 'boolean', label: 'Published', default: true },
      created: { type: 'timestamp', label: 'Created', computed: true },
      changed: { type: 'timestamp', label: 'Changed', computed: true },
      author: { type: 'entity_reference', label: 'Author', target: 'user' },
    },
  });
  
  // User
  registerEntityType('user', {
    label: 'User',
    labelPlural: 'Users',
    entityKeys: { id: 'id', uuid: 'uuid', label: 'name' },
    revisionable: false,
    translatable: false,
    baseFields: {
      name: { type: 'string', label: 'Username', required: true },
      email: { type: 'email', label: 'Email', required: true },
      status: { type: 'boolean', label: 'Active', default: true },
      created: { type: 'timestamp', label: 'Created', computed: true },
      roles: { type: 'list_string', label: 'Roles', default: ['authenticated'] },
    },
  });
  
  // Taxonomy term
  registerEntityType('taxonomy_term', {
    label: 'Taxonomy term',
    labelPlural: 'Taxonomy terms',
    entityKeys: { id: 'id', uuid: 'uuid', bundle: 'vocabulary', label: 'name' },
    revisionable: true,
    translatable: true,
    baseFields: {
      name: { type: 'string', label: 'Name', required: true },
      description: { type: 'text', label: 'Description' },
      weight: { type: 'integer', label: 'Weight', default: 0 },
      parent: { type: 'entity_reference', label: 'Parent term', target: 'taxonomy_term' },
    },
  });
  
  // Media
  registerEntityType('media', {
    label: 'Media',
    labelPlural: 'Media items',
    entityKeys: { id: 'id', uuid: 'uuid', bundle: 'bundle', label: 'name' },
    revisionable: true,
    translatable: true,
    baseFields: {
      name: { type: 'string', label: 'Name', required: true },
      status: { type: 'boolean', label: 'Published', default: true },
      created: { type: 'timestamp', label: 'Created', computed: true },
    },
  });
}

function loadStoredConfigs() {
  const files = [
    { path: 'field_storages.json', target: fieldStorages },
    { path: 'field_instances.json', target: fieldInstances },
    { path: 'bundles.json', target: bundles },
    { path: 'display_modes.json', target: displayModes },
  ];
  
  for (const { path, target } of files) {
    const fullPath = join(configDir, path);
    if (existsSync(fullPath)) {
      try {
        const stored = JSON.parse(readFileSync(fullPath, 'utf-8'));
        if (path === 'bundles.json') {
          for (const [et, b] of Object.entries(stored)) {
            if (!bundles[et]) bundles[et] = {};
            Object.assign(bundles[et], b);
          }
        } else {
          Object.assign(target, stored);
        }
      } catch (e) {
        console.error(`[entity-types] Failed to load ${path}:`, e.message);
      }
    }
  }
}

function saveConfigs() {
  if (!configDir) return;
  
  const files = [
    { path: 'field_storages.json', data: fieldStorages },
    { path: 'field_instances.json', data: fieldInstances },
    { path: 'bundles.json', data: bundles },
    { path: 'display_modes.json', data: displayModes },
  ];
  
  for (const { path, data } of files) {
    try {
      writeFileSync(join(configDir, path), JSON.stringify(data, null, 2));
    } catch (e) {
      console.error(`[entity-types] Failed to save ${path}:`, e.message);
    }
  }
}

// ============================================
// ENTITY TYPE MANAGEMENT
// ============================================

export function registerEntityType(id, definition) {
  entityTypes[id] = {
    id,
    label: definition.label || id,
    labelPlural: definition.labelPlural || definition.label + 's',
    entityKeys: definition.entityKeys || { id: 'id' },
    revisionable: definition.revisionable || false,
    translatable: definition.translatable || false,
    baseFields: definition.baseFields || {},
  };
  
  if (!bundles[id]) bundles[id] = {};
}

export function getEntityType(id) {
  return entityTypes[id] || null;
}

export function listEntityTypes() {
  return Object.values(entityTypes);
}

export function hasEntityType(id) {
  return id in entityTypes;
}

// ============================================
// BUNDLE MANAGEMENT
// ============================================

export function registerBundle(entityTypeId, bundleName, definition = {}) {
  if (!entityTypes[entityTypeId]) {
    throw new Error(`Entity type "${entityTypeId}" does not exist`);
  }
  
  if (!bundles[entityTypeId]) bundles[entityTypeId] = {};
  
  bundles[entityTypeId][bundleName] = {
    entityType: entityTypeId,
    name: bundleName,
    label: definition.label || bundleName,
    description: definition.description || '',
  };
  
  createDefaultDisplayModes(entityTypeId, bundleName);
  saveConfigs();
  
  return bundles[entityTypeId][bundleName];
}

export function getBundle(entityTypeId, bundleName) {
  return bundles[entityTypeId]?.[bundleName] || null;
}

export function listBundles(entityTypeId) {
  return bundles[entityTypeId] ? Object.values(bundles[entityTypeId]) : [];
}

export function deleteBundle(entityTypeId, bundleName) {
  if (!bundles[entityTypeId]?.[bundleName]) {
    throw new Error(`Bundle "${bundleName}" does not exist`);
  }
  
  // Clean up field instances
  const prefix = `${entityTypeId}.${bundleName}.`;
  for (const key of Object.keys(fieldInstances)) {
    if (key.startsWith(prefix)) delete fieldInstances[key];
  }
  for (const key of Object.keys(displayModes)) {
    if (key.startsWith(prefix)) delete displayModes[key];
  }
  
  delete bundles[entityTypeId][bundleName];
  saveConfigs();
}

// ============================================
// FIELD STORAGE MANAGEMENT
// ============================================

export function registerFieldStorage(fieldName, definition) {
  if (fieldStorages[fieldName]) {
    throw new Error(`Field storage "${fieldName}" already exists`);
  }
  
  fieldStorages[fieldName] = {
    name: fieldName,
    type: definition.type,
    cardinality: definition.cardinality || 1,
    translatable: definition.translatable || false,
    settings: definition.settings || {},
  };
  
  saveConfigs();
  return fieldStorages[fieldName];
}

export function getFieldStorage(fieldName) {
  return fieldStorages[fieldName] || null;
}

export function listFieldStorages() {
  return Object.values(fieldStorages);
}

export function updateFieldStorage(fieldName, updates) {
  if (!fieldStorages[fieldName]) {
    throw new Error(`Field storage "${fieldName}" does not exist`);
  }
  
  const storage = fieldStorages[fieldName];
  if (updates.settings) Object.assign(storage.settings, updates.settings);
  if (updates.translatable !== undefined) storage.translatable = updates.translatable;
  
  saveConfigs();
  return storage;
}

export function deleteFieldStorage(fieldName) {
  const inUse = Object.values(fieldInstances).some(i => i.storage === fieldName);
  if (inUse) {
    throw new Error(`Cannot delete field storage "${fieldName}" - in use`);
  }
  
  delete fieldStorages[fieldName];
  saveConfigs();
}

// ============================================
// FIELD INSTANCE MANAGEMENT
// ============================================

export function createFieldInstance(entityTypeId, bundleName, fieldName, settings = {}) {
  const storage = fieldStorages[fieldName];
  if (!storage) {
    throw new Error(`Field storage "${fieldName}" does not exist`);
  }
  
  if (!bundles[entityTypeId]?.[bundleName]) {
    throw new Error(`Bundle "${bundleName}" does not exist for "${entityTypeId}"`);
  }
  
  const instanceId = `${entityTypeId}.${bundleName}.${fieldName}`;
  
  if (fieldInstances[instanceId]) {
    throw new Error(`Field instance "${instanceId}" already exists`);
  }
  
  fieldInstances[instanceId] = {
    id: instanceId,
    entityType: entityTypeId,
    bundle: bundleName,
    storage: fieldName,
    label: settings.label || storage.name,
    description: settings.description || '',
    required: settings.required || false,
    defaultValue: settings.defaultValue,
    weight: settings.weight || 0,
    settings: settings.settings || {},
  };
  
  saveConfigs();
  return fieldInstances[instanceId];
}

export function getFieldInstance(entityTypeId, bundleName, fieldName) {
  return fieldInstances[`${entityTypeId}.${bundleName}.${fieldName}`] || null;
}

export function listFieldInstances(entityTypeId, bundleName) {
  const prefix = `${entityTypeId}.${bundleName}.`;
  return Object.entries(fieldInstances)
    .filter(([key]) => key.startsWith(prefix))
    .map(([, instance]) => instance)
    .sort((a, b) => (a.weight || 0) - (b.weight || 0));
}

export function updateFieldInstance(entityTypeId, bundleName, fieldName, updates) {
  const instanceId = `${entityTypeId}.${bundleName}.${fieldName}`;
  const instance = fieldInstances[instanceId];
  
  if (!instance) {
    throw new Error(`Field instance "${instanceId}" does not exist`);
  }
  
  if (updates.label !== undefined) instance.label = updates.label;
  if (updates.description !== undefined) instance.description = updates.description;
  if (updates.required !== undefined) instance.required = updates.required;
  if (updates.defaultValue !== undefined) instance.defaultValue = updates.defaultValue;
  if (updates.weight !== undefined) instance.weight = updates.weight;
  if (updates.settings) Object.assign(instance.settings, updates.settings);
  
  saveConfigs();
  return instance;
}

export function deleteFieldInstance(entityTypeId, bundleName, fieldName) {
  const instanceId = `${entityTypeId}.${bundleName}.${fieldName}`;
  if (!fieldInstances[instanceId]) {
    throw new Error(`Field instance "${instanceId}" does not exist`);
  }
  
  delete fieldInstances[instanceId];
  saveConfigs();
}

// ============================================
// DISPLAY MODES
// ============================================

const DEFAULT_MODES = ['full', 'teaser', 'card', 'search_result'];

function createDefaultDisplayModes(entityTypeId, bundleName) {
  for (const mode of DEFAULT_MODES) {
    const key = `${entityTypeId}.${bundleName}.${mode}`;
    if (!displayModes[key]) {
      displayModes[key] = {
        id: key,
        entityType: entityTypeId,
        bundle: bundleName,
        mode,
        label: mode.charAt(0).toUpperCase() + mode.slice(1).replace('_', ' '),
        enabled: mode === 'full',
        fields: {},
      };
    }
  }
}

export function getDisplayMode(entityTypeId, bundleName, mode) {
  return displayModes[`${entityTypeId}.${bundleName}.${mode}`] || null;
}

export function listDisplayModes(entityTypeId, bundleName) {
  const prefix = `${entityTypeId}.${bundleName}.`;
  return Object.entries(displayModes)
    .filter(([key]) => key.startsWith(prefix))
    .map(([, mode]) => mode);
}

export function updateDisplayMode(entityTypeId, bundleName, mode, updates) {
  const key = `${entityTypeId}.${bundleName}.${mode}`;
  
  if (!displayModes[key]) {
    displayModes[key] = {
      id: key, entityType: entityTypeId, bundle: bundleName, mode,
      label: mode, enabled: false, fields: {},
    };
  }
  
  const dm = displayModes[key];
  if (updates.label !== undefined) dm.label = updates.label;
  if (updates.enabled !== undefined) dm.enabled = updates.enabled;
  if (updates.fields) Object.assign(dm.fields, updates.fields);
  
  saveConfigs();
  return dm;
}

export function setFieldDisplay(entityTypeId, bundleName, mode, fieldName, config) {
  const key = `${entityTypeId}.${bundleName}.${mode}`;
  if (!displayModes[key]) {
    throw new Error(`Display mode "${mode}" does not exist`);
  }
  
  displayModes[key].fields[fieldName] = {
    weight: config.weight || 0,
    label: config.label || 'above',
    format: config.format || 'default',
    settings: config.settings || {},
    hidden: config.hidden || false,
  };
  
  saveConfigs();
}

// ============================================
// SCHEMA GENERATION
// ============================================

/**
 * Get full schema for a bundle (base fields + field instances)
 */
export function getBundleSchema(entityTypeId, bundleName) {
  const entityType = entityTypes[entityTypeId];
  if (!entityType) return null;
  
  const bundle = bundles[entityTypeId]?.[bundleName];
  if (!bundle) return null;
  
  const schema = { ...entityType.baseFields };
  
  for (const instance of listFieldInstances(entityTypeId, bundleName)) {
    const storage = fieldStorages[instance.storage];
    if (storage) {
      schema[instance.storage] = {
        type: storage.type,
        label: instance.label,
        required: instance.required,
        default: instance.defaultValue,
        cardinality: storage.cardinality,
        ...instance.settings,
      };
    }
  }
  
  return schema;
}

/**
 * Get all fields for a bundle (for admin UI)
 */
export function getBundleFields(entityTypeId, bundleName) {
  const entityType = entityTypes[entityTypeId];
  if (!entityType) return [];
  
  const fields = [];
  
  // Base fields
  for (const [name, def] of Object.entries(entityType.baseFields)) {
    fields.push({ name, ...def, source: 'base', entityType: entityTypeId });
  }
  
  // Field instances
  for (const instance of listFieldInstances(entityTypeId, bundleName)) {
    const storage = fieldStorages[instance.storage];
    if (storage) {
      fields.push({
        name: instance.storage,
        type: storage.type,
        label: instance.label,
        required: instance.required,
        cardinality: storage.cardinality,
        weight: instance.weight,
        source: 'field',
        entityType: entityTypeId,
        bundle: bundleName,
      });
    }
  }
  
  return fields.sort((a, b) => (a.weight || 0) - (b.weight || 0));
}

// ============================================
// INTEGRATION WITH CONTENT-TYPES SERVICE
// ============================================

/**
 * Sync a bundle to content-types service
 * This registers the bundle as a content type for backward compatibility
 */
export function syncBundleToContentTypes(entityTypeId, bundleName) {
  if (!contentTypesService) return;
  
  const schema = getBundleSchema(entityTypeId, bundleName);
  if (!schema) return;
  
  const bundle = bundles[entityTypeId]?.[bundleName];
  if (!bundle) return;
  
  // Convert to content-types format
  const typeConfig = {
    label: bundle.label,
    description: bundle.description,
    fields: {},
  };
  
  for (const [fieldName, fieldDef] of Object.entries(schema)) {
    typeConfig.fields[fieldName] = {
      type: fieldDef.type,
      label: fieldDef.label,
      required: fieldDef.required || false,
      default: fieldDef.default,
    };
  }
  
  // Register with content-types if method exists
  if (contentTypesService.registerFromBundle) {
    contentTypesService.registerFromBundle(bundleName, typeConfig);
  }
}
