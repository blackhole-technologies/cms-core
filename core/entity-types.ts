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
// TYPE DEFINITIONS
// ============================================

/** Base field definition within an entity type */
export interface BaseFieldDef {
  type: string;
  label: string;
  required?: boolean;
  default?: unknown;
  computed?: boolean;
  target?: string;
}

/** Entity key mappings (which fields serve as id, label, etc.) */
export interface EntityKeys {
  id: string;
  uuid?: string;
  bundle?: string;
  label?: string;
  status?: string;
}

/** Full entity type definition */
export interface EntityTypeDefinition {
  id: string;
  label: string;
  labelPlural: string;
  entityKeys: EntityKeys;
  revisionable: boolean;
  translatable: boolean;
  baseFields: Record<string, BaseFieldDef>;
}

/** Bundle (content type) definition */
export interface BundleDefinition {
  entityType: string;
  name: string;
  label: string;
  description: string;
}

/** Field storage definition */
export interface FieldStorageDefinition {
  name: string;
  type: string;
  cardinality: number;
  translatable: boolean;
  settings: Record<string, unknown>;
}

/** Field instance definition (per-bundle) */
export interface FieldInstanceDefinition {
  id: string;
  entityType: string;
  bundle: string;
  storage: string;
  label: string;
  description: string;
  required: boolean;
  defaultValue?: unknown;
  weight: number;
  settings: Record<string, unknown>;
}

/** Display mode definition */
export interface DisplayModeDefinition {
  id: string;
  entityType: string;
  bundle: string;
  mode: string;
  label: string;
  enabled: boolean;
  fields: Record<string, Record<string, unknown>>;
}

/** Content types service interface for integration */
interface ContentTypesServiceRef {
  registerFromBundle?: (name: string, config: Record<string, unknown>) => void;
  [key: string]: unknown;
}

// ============================================
// REGISTRIES
// ============================================

const entityTypes: Record<string, EntityTypeDefinition> = {};
const bundles: Record<string, Record<string, BundleDefinition>> = {};
const fieldStorages: Record<string, FieldStorageDefinition> = {};
const fieldInstances: Record<string, FieldInstanceDefinition> = {};
const displayModes: Record<string, DisplayModeDefinition> = {};

let configDir: string | null = null;
let contentTypesService: ContentTypesServiceRef | null = null;

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize the entity type system
 * 
 * @param {string} baseDir - Base directory
 * @param {Object} contentTypes - Content types service (for integration)
 */
export function init(baseDir: string, contentTypes: ContentTypesServiceRef | null = null): void {
  configDir = join(baseDir, 'config', 'entity-types');
  contentTypesService = contentTypes;
  
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  
  registerBuiltinEntityTypes();
  loadStoredConfigs();
  
  console.log(`[entity-types] Initialized (${Object.keys(entityTypes).length} entity types, ${countBundles()} bundles)`);
}

function countBundles(): number {
  return Object.values(bundles).reduce((sum: number, b) => sum + Object.keys(b).length, 0);
}

function registerBuiltinEntityTypes(): void {
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

function loadStoredConfigs(): void {
  const files = [
    { path: 'field_storages.json', target: fieldStorages },
    { path: 'field_instances.json', target: fieldInstances },
    { path: 'bundles.json', target: bundles },
    { path: 'display_modes.json', target: displayModes },
  ];
  
  for (const { path, target } of files) {
    const fullPath = join(configDir!, path);
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
      } catch (e: unknown) {
        console.error(`[entity-types] Failed to load ${path}:`, e instanceof Error ? e.message : String(e));
      }
    }
  }
}

function saveConfigs(): void {
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
    } catch (e: unknown) {
      console.error(`[entity-types] Failed to save ${path}:`, e instanceof Error ? e.message : String(e));
    }
  }
}

// ============================================
// ENTITY TYPE MANAGEMENT
// ============================================

export function registerEntityType(id: string, definition: Partial<EntityTypeDefinition> & { baseFields?: Record<string, BaseFieldDef> }): void {
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

export function getEntityType(id: string): EntityTypeDefinition | null {
  return entityTypes[id] ?? null;
}

export function listEntityTypes(): EntityTypeDefinition[] {
  return Object.values(entityTypes);
}

export function hasEntityType(id: string): boolean {
  return id in entityTypes;
}

// ============================================
// BUNDLE MANAGEMENT
// ============================================

export function registerBundle(entityTypeId: string, bundleName: string, definition: Partial<BundleDefinition> = {}): BundleDefinition {
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

export function getBundle(entityTypeId: string, bundleName: string): BundleDefinition | null {
  return bundles[entityTypeId]?.[bundleName] ?? null;
}

export function listBundles(entityTypeId: string): BundleDefinition[] {
  return bundles[entityTypeId] ? Object.values(bundles[entityTypeId]) : [];
}

export function deleteBundle(entityTypeId: string, bundleName: string): void {
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

export function registerFieldStorage(fieldName: string, definition: Partial<FieldStorageDefinition> & { type: string }): FieldStorageDefinition {
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

export function getFieldStorage(fieldName: string): FieldStorageDefinition | null {
  return fieldStorages[fieldName] ?? null;
}

export function listFieldStorages(): FieldStorageDefinition[] {
  return Object.values(fieldStorages);
}

export function updateFieldStorage(fieldName: string, updates: Partial<FieldStorageDefinition>): FieldStorageDefinition {
  if (!fieldStorages[fieldName]) {
    throw new Error(`Field storage "${fieldName}" does not exist`);
  }
  
  const storage = fieldStorages[fieldName];
  if (updates.settings) Object.assign(storage.settings, updates.settings);
  if (updates.translatable !== undefined) storage.translatable = updates.translatable;
  
  saveConfigs();
  return storage;
}

export function deleteFieldStorage(fieldName: string): void {
  const inUse = Object.values(fieldInstances).some((i: FieldInstanceDefinition) => i.storage === fieldName);
  if (inUse) {
    throw new Error(`Cannot delete field storage "${fieldName}" - in use`);
  }
  
  delete fieldStorages[fieldName];
  saveConfigs();
}

// ============================================
// FIELD INSTANCE MANAGEMENT
// ============================================

export function createFieldInstance(entityTypeId: string, bundleName: string, fieldName: string, settings: Partial<FieldInstanceDefinition> = {}): FieldInstanceDefinition {
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

export function getFieldInstance(entityTypeId: string, bundleName: string, fieldName: string): FieldInstanceDefinition | null {
  return fieldInstances[`${entityTypeId}.${bundleName}.${fieldName}`] ?? null;
}

export function listFieldInstances(entityTypeId: string, bundleName: string): FieldInstanceDefinition[] {
  const prefix = `${entityTypeId}.${bundleName}.`;
  return Object.entries(fieldInstances)
    .filter(([key]) => key.startsWith(prefix))
    .map(([, instance]) => instance)
    .sort((a, b) => (a.weight || 0) - (b.weight || 0));
}

export function updateFieldInstance(entityTypeId: string, bundleName: string, fieldName: string, updates: Partial<FieldInstanceDefinition>): FieldInstanceDefinition {
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

export function deleteFieldInstance(entityTypeId: string, bundleName: string, fieldName: string): void {
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

function createDefaultDisplayModes(entityTypeId: string, bundleName: string): void {
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

export function getDisplayMode(entityTypeId: string, bundleName: string, mode: string): DisplayModeDefinition | null {
  return displayModes[`${entityTypeId}.${bundleName}.${mode}`] ?? null;
}

export function listDisplayModes(entityTypeId: string, bundleName: string): DisplayModeDefinition[] {
  const prefix = `${entityTypeId}.${bundleName}.`;
  return Object.entries(displayModes)
    .filter(([key]) => key.startsWith(prefix))
    .map(([, mode]) => mode);
}

export function updateDisplayMode(entityTypeId: string, bundleName: string, mode: string, updates: Partial<DisplayModeDefinition>): DisplayModeDefinition {
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

export function setFieldDisplay(entityTypeId: string, bundleName: string, mode: string, fieldName: string, config: Record<string, unknown>): void {
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
export function getBundleSchema(entityTypeId: string, bundleName: string): Record<string, unknown> | null {
  const entityType = entityTypes[entityTypeId];
  if (!entityType) return null;
  
  const bundle = bundles[entityTypeId]?.[bundleName];
  if (!bundle) return null;
  
  const schema: Record<string, Record<string, unknown>> = { ...entityType.baseFields } as unknown as Record<string, Record<string, unknown>>;
  
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
export function getBundleFields(entityTypeId: string, bundleName: string): Record<string, unknown>[] {
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
export function syncBundleToContentTypes(entityTypeId: string, bundleName: string): void {
  if (!contentTypesService) return;
  
  const schema = getBundleSchema(entityTypeId, bundleName);
  if (!schema) return;
  
  const bundle = bundles[entityTypeId]?.[bundleName];
  if (!bundle) return;
  
  // Convert to content-types format
  const typeConfig: { label: string; description: string; fields: Record<string, Record<string, unknown>> } = {
    label: bundle.label,
    description: bundle.description,
    fields: {},
  };

  for (const [fieldName, fieldDef] of Object.entries(schema)) {
    const def = fieldDef as Record<string, unknown>;
    typeConfig.fields[fieldName] = {
      type: def.type,
      label: def.label,
      required: (def.required as boolean) || false,
      default: def.default,
    };
  }
  
  // Register with content-types if method exists
  if (contentTypesService.registerFromBundle) {
    contentTypesService.registerFromBundle(bundleName, typeConfig);
  }
}
