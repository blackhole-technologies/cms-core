/**
 * field-storage.js - Drupal-Style Entity Field Storage System
 *
 * WHY FIELD STORAGE:
 * =================
 * Drupal uses a flexible field storage system where each configurable field
 * is stored in a dedicated table. This allows fields to be added/removed
 * without altering the main entity tables.
 *
 * ARCHITECTURE:
 * - Field Storage: Cross-bundle field definition (shared across bundles)
 * - Field Config: Per-bundle field configuration (label, settings, etc)
 * - Field Data: Actual field values stored in dedicated tables
 *
 * TABLE STRUCTURE:
 * Each field gets its own table: {entity_type}__field_{field_name}
 * | entity_id | revision_id | langcode | delta | {columns} |
 * |-----------|-------------|----------|-------|-----------|
 * | 1         | 1           | en       | 0     | ...       |
 *
 * BENEFITS:
 * - Add/remove fields without schema changes
 * - Efficient queries on specific fields
 * - Multi-value support (multiple rows per entity)
 * - Revision tracking per field
 * - Translation support per field value
 *
 * STORAGE BACKEND:
 * Unlike Drupal which uses SQL, this uses JSON files for simplicity.
 * Structure: /storage/field_storage/{entity_type}__field_{field_name}.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

// ============================================
// TYPES
// ============================================

/** Column type mapping for field types */
type ColumnType = 'string' | 'text' | 'int' | 'float' | 'decimal' | 'bool' | 'datetime' | 'json';

/** Field type definition with columns and settings */
interface FieldTypeDefinition {
  columns: Record<string, ColumnType>;
  settings: Record<string, unknown>;
}

/** Field storage definition (cross-bundle) */
interface FieldStorageDef {
  field_name: string;
  entity_type: string;
  type: string;
  cardinality: number;
  translatable: boolean;
  settings: Record<string, unknown>;
  created: string;
}

/** Field storage creation input */
interface FieldStorageInput {
  field_name: string;
  entity_type: string;
  type: string;
  cardinality?: number;
  translatable?: boolean;
  settings?: Record<string, unknown>;
}

/** Field config definition (per-bundle) */
interface FieldConfigDef {
  field_name: string;
  entity_type: string;
  bundle: string;
  label: string;
  description: string;
  required: boolean;
  default_value: unknown[];
  settings: Record<string, unknown>;
  created: string;
  updated?: string;
}

/** Field config creation input */
interface FieldConfigInput {
  field_name: string;
  entity_type: string;
  bundle: string;
  label: string;
  description?: string;
  required?: boolean;
  default_value?: unknown | unknown[];
  settings?: Record<string, unknown>;
}

/** Field data row */
interface FieldDataRow {
  entity_id: number | string;
  revision_id: number;
  langcode: string;
  delta: number;
  [key: string]: unknown;
}

/** Field data file structure */
interface FieldDataFile {
  rows: FieldDataRow[];
}

/** Init options */
interface FieldStorageInitOptions {
  basePath?: string;
}

/**
 * Field type definitions
 * Each field type defines its storage columns
 */
const FIELD_TYPES: Record<string, FieldTypeDefinition> = {
  'string': {
    columns: { value: 'string' },
    settings: { max_length: 255 }
  },
  'string_long': {
    columns: { value: 'text' },
    settings: {}
  },
  'text': {
    columns: { value: 'text', format: 'string' },
    settings: { default_format: 'plain_text' }
  },
  'text_long': {
    columns: { value: 'text', format: 'string' },
    settings: { default_format: 'plain_text' }
  },
  'text_with_summary': {
    columns: { value: 'text', summary: 'text', format: 'string' },
    settings: { default_format: 'plain_text', display_summary: true }
  },
  'integer': {
    columns: { value: 'int' },
    settings: { min: null, max: null }
  },
  'decimal': {
    columns: { value: 'decimal' },
    settings: { precision: 10, scale: 2 }
  },
  'float': {
    columns: { value: 'float' },
    settings: {}
  },
  'boolean': {
    columns: { value: 'bool' },
    settings: {}
  },
  'email': {
    columns: { value: 'string' },
    settings: {}
  },
  'link': {
    columns: { uri: 'string', title: 'string', options: 'json' },
    settings: { link_type: 16 } // external + internal
  },
  'datetime': {
    columns: { value: 'datetime' },
    settings: { datetime_type: 'datetime' }
  },
  'timestamp': {
    columns: { value: 'int' },
    settings: {}
  },
  'entity_reference': {
    columns: { target_id: 'int' },
    settings: { target_type: null }
  },
  'file': {
    columns: { target_id: 'int', display: 'bool', description: 'string' },
    settings: { file_directory: '', file_extensions: 'txt' }
  },
  'image': {
    columns: {
      target_id: 'int',
      alt: 'string',
      title: 'string',
      width: 'int',
      height: 'int'
    },
    settings: {
      file_directory: '',
      file_extensions: 'png gif jpg jpeg',
      max_filesize: '',
      max_resolution: '',
      min_resolution: '',
      alt_field: true,
      alt_field_required: true,
      title_field: false,
      title_field_required: false
    }
  },
  'list_string': {
    columns: { value: 'string' },
    settings: { allowed_values: [] }
  },
  'list_integer': {
    columns: { value: 'int' },
    settings: { allowed_values: [] }
  },
  'list_float': {
    columns: { value: 'float' },
    settings: { allowed_values: [] }
  }
};

// Storage paths
let storageBasePath: string = './storage';
let fieldStorageDir: string | null = null;
let fieldConfigDir: string | null = null;

// In-memory caches
const fieldStorageCache: Map<string, FieldStorageDef> = new Map();
const fieldConfigCache: Map<string, FieldConfigDef> = new Map();

/**
 * Initialize field storage system
 *
 * @param {Object} options - Configuration options
 * @param {string} options.basePath - Base path for storage files
 */
export function init(options: FieldStorageInitOptions = {}): void {
  storageBasePath = options.basePath || './storage';
  fieldStorageDir = join(storageBasePath, 'field_storage');
  fieldConfigDir = join(storageBasePath, 'field_config');

  // Ensure directories exist
  if (!existsSync(storageBasePath)) {
    mkdirSync(storageBasePath, { recursive: true });
  }
  if (!existsSync(fieldStorageDir)) {
    mkdirSync(fieldStorageDir, { recursive: true });
  }
  if (!existsSync(fieldConfigDir)) {
    mkdirSync(fieldConfigDir, { recursive: true });
  }

  // Preload all field storages and configs
  _loadAllFieldStorages();
  _loadAllFieldConfigs();
}

/**
 * Get field columns for a field type
 *
 * @param {string} fieldType - Field type name
 * @returns {Object} Column definitions
 */
export function getFieldColumns(fieldType: string): Record<string, ColumnType> {
  const definition = FIELD_TYPES[fieldType];
  if (!definition) {
    throw new Error(`Unknown field type: ${fieldType}`);
  }
  return definition.columns;
}

/**
 * Get field table name
 *
 * @param {string} entityType - Entity type (e.g., 'node', 'user')
 * @param {string} fieldName - Field name (e.g., 'body', 'field_image')
 * @returns {string} Table name
 */
export function getFieldTableName(entityType: string, fieldName: string): string {
  // Normalize field name (remove field_ prefix if present for the table name)
  const normalizedName = fieldName.startsWith('field_') ? fieldName : `field_${fieldName}`;
  return `${entityType}__${normalizedName}`;
}

/**
 * Ensure field storage file exists
 *
 * @param {string} entityType - Entity type
 * @param {string} fieldName - Field name
 * @returns {string} Path to field data file
 */
export function ensureFieldTable(entityType: string, fieldName: string): string {
  const tableName = getFieldTableName(entityType, fieldName);
  const filePath = join(fieldStorageDir!, `${tableName}.json`);

  if (!existsSync(filePath)) {
    // Initialize empty field data
    writeFileSync(filePath, JSON.stringify({ rows: [] }, null, 2), 'utf8');
  }

  return filePath;
}

// ============================================================================
// Field Storage Definitions (Cross-Bundle)
// ============================================================================

/**
 * Create field storage definition
 *
 * Field storage is shared across all bundles. It defines the field's
 * fundamental properties: name, type, cardinality, etc.
 *
 * @param {Object} definition - Field storage definition
 * @param {string} definition.field_name - Machine name of the field
 * @param {string} definition.entity_type - Entity type (node, user, etc)
 * @param {string} definition.type - Field type (text, integer, etc)
 * @param {number} definition.cardinality - Max values (-1 = unlimited, default 1)
 * @param {boolean} definition.translatable - Whether field is translatable
 * @param {Object} definition.settings - Field type specific settings
 * @returns {Object} Created field storage
 */
export function createFieldStorage(definition: FieldStorageInput): FieldStorageDef {
  const {
    field_name,
    entity_type,
    type,
    cardinality = 1,
    translatable = false,
    settings = {}
  } = definition;

  // Validation
  if (!field_name || typeof field_name !== 'string') {
    throw new Error('field_name is required and must be a string');
  }
  if (!entity_type || typeof entity_type !== 'string') {
    throw new Error('entity_type is required and must be a string');
  }
  if (!type || typeof type !== 'string') {
    throw new Error('type is required and must be a string');
  }
  if (!FIELD_TYPES[type]) {
    throw new Error(`Unknown field type: ${type}`);
  }
  if (typeof cardinality !== 'number' || (cardinality < -1 || cardinality === 0)) {
    throw new Error('cardinality must be a positive integer or -1 for unlimited');
  }

  // Check if already exists
  const existing = getFieldStorage(entity_type, field_name);
  if (existing) {
    throw new Error(`Field storage already exists: ${entity_type}.${field_name}`);
  }

  // Merge with default settings
  const fieldTypeDefinition = FIELD_TYPES[type]!;
  const mergedSettings = { ...fieldTypeDefinition.settings, ...settings };

  // Create storage definition
  const storage: FieldStorageDef = {
    field_name,
    entity_type,
    type,
    cardinality,
    translatable,
    settings: mergedSettings,
    created: new Date().toISOString()
  };

  // Save to disk
  const fileName = `${entity_type}.${field_name}.json`;
  const filePath = join(fieldStorageDir!, fileName);
  writeFileSync(filePath, JSON.stringify(storage, null, 2), 'utf8');

  // Update cache
  const cacheKey = `${entity_type}.${field_name}`;
  fieldStorageCache.set(cacheKey, storage);

  // Ensure field data table exists
  ensureFieldTable(entity_type, field_name);

  return storage;
}

/**
 * Get field storage definition
 *
 * @param {string} entityType - Entity type
 * @param {string} fieldName - Field name
 * @returns {Object|null} Field storage or null if not found
 */
export function getFieldStorage(entityType: string, fieldName: string): FieldStorageDef | null {
  const cacheKey = `${entityType}.${fieldName}`;

  // Check cache first
  if (fieldStorageCache.has(cacheKey)) {
    return fieldStorageCache.get(cacheKey)!;
  }

  // Try to load from disk
  const fileName = `${entityType}.${fieldName}.json`;
  const filePath = join(fieldStorageDir!, fileName);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const storage = JSON.parse(readFileSync(filePath, 'utf8')) as FieldStorageDef;
    fieldStorageCache.set(cacheKey, storage);
    return storage;
  } catch (error) {
    console.error(`Failed to load field storage ${cacheKey}:`, error);
    return null;
  }
}

/**
 * Load all field storages for an entity type
 *
 * @param {string} entityType - Entity type
 * @returns {Array} Array of field storage definitions
 */
export function loadFieldStorages(entityType: string): FieldStorageDef[] {
  const storages: FieldStorageDef[] = [];

  if (!existsSync(fieldStorageDir!)) {
    return storages;
  }

  const files = readdirSync(fieldStorageDir!);
  const prefix = `${entityType}.`;

  for (const file of files) {
    if (file.startsWith(prefix) && file.endsWith('.json')) {
      const fieldName = file.slice(prefix.length, -5); // Remove prefix and .json
      const storage = getFieldStorage(entityType, fieldName);
      if (storage) {
        storages.push(storage);
      }
    }
  }

  return storages;
}

/**
 * Delete field storage
 *
 * WARNING: This deletes all field data across all bundles!
 *
 * @param {string} entityType - Entity type
 * @param {string} fieldName - Field name
 * @returns {boolean} True if deleted, false if not found
 */
export function deleteFieldStorage(entityType: string, fieldName: string): boolean {
  const cacheKey = `${entityType}.${fieldName}`;

  // Check if exists
  const storage = getFieldStorage(entityType, fieldName);
  if (!storage) {
    return false;
  }

  // Delete field storage definition
  const fileName = `${entityType}.${fieldName}.json`;
  const filePath = join(fieldStorageDir!, fileName);

  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }

  // Delete field data table
  const tableName = getFieldTableName(entityType, fieldName);
  const dataFilePath = join(fieldStorageDir!, `${tableName}.json`);

  if (existsSync(dataFilePath)) {
    unlinkSync(dataFilePath);
  }

  // Remove from cache
  fieldStorageCache.delete(cacheKey);

  // Delete all field configs for this field
  const configs = loadFieldConfigs(entityType);
  for (const config of configs) {
    if (config.field_name === fieldName) {
      deleteFieldConfig(entityType, config.bundle, fieldName);
    }
  }

  return true;
}

// ============================================================================
// Field Configurations (Per-Bundle)
// ============================================================================

/**
 * Create field configuration for a bundle
 *
 * Field config is bundle-specific. It defines how the field appears
 * and behaves on a particular bundle (e.g., 'article' vs 'page').
 *
 * @param {Object} config - Field configuration
 * @param {string} config.field_name - Field name (must exist in field storage)
 * @param {string} config.entity_type - Entity type
 * @param {string} config.bundle - Bundle name
 * @param {string} config.label - Human-readable label
 * @param {string} config.description - Help text
 * @param {boolean} config.required - Whether field is required
 * @param {Array} config.default_value - Default value(s)
 * @param {Object} config.settings - Bundle-specific settings
 * @returns {Object} Created field config
 */
export function createFieldConfig(config: FieldConfigInput): FieldConfigDef {
  const {
    field_name,
    entity_type,
    bundle,
    label,
    description = '',
    required = false,
    default_value = [],
    settings = {}
  } = config;

  // Validation
  if (!field_name || typeof field_name !== 'string') {
    throw new Error('field_name is required and must be a string');
  }
  if (!entity_type || typeof entity_type !== 'string') {
    throw new Error('entity_type is required and must be a string');
  }
  if (!bundle || typeof bundle !== 'string') {
    throw new Error('bundle is required and must be a string');
  }
  if (!label || typeof label !== 'string') {
    throw new Error('label is required and must be a string');
  }

  // Verify field storage exists
  const storage = getFieldStorage(entity_type, field_name);
  if (!storage) {
    throw new Error(`Field storage does not exist: ${entity_type}.${field_name}`);
  }

  // Check if config already exists
  const existing = getFieldConfig(entity_type, bundle, field_name);
  if (existing) {
    throw new Error(`Field config already exists: ${entity_type}.${bundle}.${field_name}`);
  }

  // Create config
  const fieldConfig: FieldConfigDef = {
    field_name,
    entity_type,
    bundle,
    label,
    description,
    required,
    default_value: Array.isArray(default_value) ? default_value : [default_value],
    settings,
    created: new Date().toISOString()
  };

  // Save to disk
  const fileName = `${entity_type}.${bundle}.${field_name}.json`;
  const filePath = join(fieldConfigDir!, fileName);
  writeFileSync(filePath, JSON.stringify(fieldConfig, null, 2), 'utf8');

  // Update cache
  const cacheKey = `${entity_type}.${bundle}.${field_name}`;
  fieldConfigCache.set(cacheKey, fieldConfig);

  return fieldConfig;
}

/**
 * Update field configuration
 *
 * @param {Object} config - Updated field configuration
 * @returns {Object} Updated field config
 */
export function updateFieldConfig(config: FieldConfigInput): FieldConfigDef {
  const { field_name, entity_type, bundle } = config;

  // Verify config exists
  const existing = getFieldConfig(entity_type, bundle, field_name);
  if (!existing) {
    throw new Error(`Field config does not exist: ${entity_type}.${bundle}.${field_name}`);
  }

  // Verify field storage exists
  const storage = getFieldStorage(entity_type, field_name);
  if (!storage) {
    throw new Error(`Field storage does not exist: ${entity_type}.${field_name}`);
  }

  // Merge with existing (preserve created timestamp)
  const updated: FieldConfigDef = {
    ...existing,
    ...config,
    description: config.description ?? existing.description,
    required: config.required ?? existing.required,
    default_value: config.default_value !== undefined
      ? (Array.isArray(config.default_value) ? config.default_value : [config.default_value])
      : existing.default_value,
    settings: config.settings ?? existing.settings,
    created: existing.created,
    updated: new Date().toISOString()
  };

  // Save to disk
  const fileName = `${entity_type}.${bundle}.${field_name}.json`;
  const filePath = join(fieldConfigDir!, fileName);
  writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf8');

  // Update cache
  const cacheKey = `${entity_type}.${bundle}.${field_name}`;
  fieldConfigCache.set(cacheKey, updated);

  return updated;
}

/**
 * Get field configuration
 *
 * @param {string} entityType - Entity type
 * @param {string} bundle - Bundle name
 * @param {string} fieldName - Field name
 * @returns {Object|null} Field config or null if not found
 */
export function getFieldConfig(entityType: string, bundle: string, fieldName: string): FieldConfigDef | null {
  const cacheKey = `${entityType}.${bundle}.${fieldName}`;

  // Check cache first
  if (fieldConfigCache.has(cacheKey)) {
    return fieldConfigCache.get(cacheKey)!;
  }

  // Try to load from disk
  const fileName = `${entityType}.${bundle}.${fieldName}.json`;
  const filePath = join(fieldConfigDir!, fileName);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const fieldConfig = JSON.parse(readFileSync(filePath, 'utf8')) as FieldConfigDef;
    fieldConfigCache.set(cacheKey, fieldConfig);
    return fieldConfig;
  } catch (error) {
    console.error(`Failed to load field config ${cacheKey}:`, error);
    return null;
  }
}

/**
 * Load all field configurations for an entity type (optionally filtered by bundle)
 *
 * @param {string} entityType - Entity type
 * @param {string|null} bundle - Optional bundle filter
 * @returns {Array} Array of field configurations
 */
export function loadFieldConfigs(entityType: string, bundle: string | null = null): FieldConfigDef[] {
  const configs: FieldConfigDef[] = [];

  if (!existsSync(fieldConfigDir!)) {
    return configs;
  }

  const files = readdirSync(fieldConfigDir!);
  const prefix = bundle ? `${entityType}.${bundle}.` : `${entityType}.`;

  for (const file of files) {
    if (file.startsWith(prefix) && file.endsWith('.json')) {
      const parts = file.slice(0, -5).split('.');
      if (parts.length >= 3) {
        const [et, b, fn] = parts;
        if (et && b && fn) {
          const config = getFieldConfig(et, b, fn);
          if (config) {
            configs.push(config);
          }
        }
      }
    }
  }

  return configs;
}

/**
 * Delete field configuration
 *
 * @param {string} entityType - Entity type
 * @param {string} bundle - Bundle name
 * @param {string} fieldName - Field name
 * @returns {boolean} True if deleted, false if not found
 */
export function deleteFieldConfig(entityType: string, bundle: string, fieldName: string): boolean {
  const cacheKey = `${entityType}.${bundle}.${fieldName}`;

  // Check if exists
  const config = getFieldConfig(entityType, bundle, fieldName);
  if (!config) {
    return false;
  }

  // Delete file
  const fileName = `${entityType}.${bundle}.${fieldName}.json`;
  const filePath = join(fieldConfigDir!, fileName);

  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }

  // Remove from cache
  fieldConfigCache.delete(cacheKey);

  return true;
}

// ============================================================================
// Field Data Operations
// ============================================================================

/**
 * Load field values for an entity
 *
 * @param {string} entityType - Entity type
 * @param {number|string} entityId - Entity ID
 * @param {string} fieldName - Field name
 * @param {string} langcode - Language code (default 'en')
 * @param {number|null} revisionId - Revision ID (null for current)
 * @returns {Array} Array of field values
 */
export function loadFieldValues(entityType: string, entityId: number | string, fieldName: string, langcode: string = 'en', revisionId: number | null = null): Record<string, unknown>[] {
  const storage = getFieldStorage(entityType, fieldName);
  if (!storage) {
    throw new Error(`Field storage not found: ${entityType}.${fieldName}`);
  }

  const tableName = getFieldTableName(entityType, fieldName);
  const filePath = join(fieldStorageDir!, `${tableName}.json`);

  if (!existsSync(filePath)) {
    return [];
  }

  const data = JSON.parse(readFileSync(filePath, 'utf8')) as FieldDataFile;
  const rows: FieldDataRow[] = data.rows || [];

  // Filter rows
  const filtered = rows.filter((row: FieldDataRow) => {
    if (row.entity_id !== entityId) return false;
    if (row.langcode !== langcode) return false;
    if (revisionId !== null && row.revision_id !== revisionId) return false;
    return true;
  });

  // Sort by delta
  filtered.sort((a: FieldDataRow, b: FieldDataRow) => a.delta - b.delta);

  // Extract values (remove metadata)
  return filtered.map((row: FieldDataRow) => {
    const { entity_id, revision_id, langcode: _langcode, delta, ...values } = row;
    return values;
  });
}

/**
 * Save field values for an entity
 *
 * @param {string} entityType - Entity type
 * @param {number|string} entityId - Entity ID
 * @param {string} fieldName - Field name
 * @param {Array} values - Array of field values
 * @param {string} langcode - Language code (default 'en')
 * @param {number|null} revisionId - Revision ID
 */
export function saveFieldValues(entityType: string, entityId: number | string, fieldName: string, values: Record<string, unknown>[] | Record<string, unknown>, langcode: string = 'en', revisionId: number | null = null): void {
  const storage = getFieldStorage(entityType, fieldName);
  if (!storage) {
    throw new Error(`Field storage not found: ${entityType}.${fieldName}`);
  }

  // Ensure values is an array
  let valuesArray: Record<string, unknown>[];
  if (!Array.isArray(values)) {
    valuesArray = [values];
  } else {
    valuesArray = values;
  }

  // Validate cardinality
  if (storage.cardinality !== -1 && valuesArray.length > storage.cardinality) {
    throw new Error(
      `Field ${fieldName} cardinality is ${storage.cardinality}, but ${valuesArray.length} values provided`
    );
  }

  // Get field columns
  const columns = getFieldColumns(storage.type);

  // Validate each value has required columns
  for (const value of valuesArray) {
    for (const columnName of Object.keys(columns)) {
      if (value[columnName] === undefined) {
        throw new Error(`Missing required column '${columnName}' for field type ${storage.type}`);
      }
    }
  }

  const tableName = getFieldTableName(entityType, fieldName);
  const filePath = join(fieldStorageDir!, `${tableName}.json`);

  // Load existing data
  let data: FieldDataFile = { rows: [] };
  if (existsSync(filePath)) {
    data = JSON.parse(readFileSync(filePath, 'utf8')) as FieldDataFile;
  }

  // Remove existing values for this entity/langcode/revision
  data.rows = data.rows.filter((row: FieldDataRow) => {
    if (row.entity_id !== entityId) return true;
    if (row.langcode !== langcode) return true;
    if (revisionId !== null && row.revision_id !== revisionId) return true;
    return false;
  });

  // Add new values
  valuesArray.forEach((value: Record<string, unknown>, delta: number) => {
    data.rows.push({
      entity_id: entityId,
      revision_id: revisionId || 0,
      langcode,
      delta,
      ...value
    });
  });

  // Save to disk
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Delete field values for an entity
 *
 * @param {string} entityType - Entity type
 * @param {number|string} entityId - Entity ID
 * @param {string} fieldName - Field name
 * @param {string|null} langcode - Language code (null to delete all languages)
 * @param {number|null} revisionId - Revision ID (null to delete all revisions)
 */
export function deleteFieldValues(entityType: string, entityId: number | string, fieldName: string, langcode: string | null = null, revisionId: number | null = null): void {
  const storage = getFieldStorage(entityType, fieldName);
  if (!storage) {
    return; // Silently ignore if storage doesn't exist
  }

  const tableName = getFieldTableName(entityType, fieldName);
  const filePath = join(fieldStorageDir!, `${tableName}.json`);

  if (!existsSync(filePath)) {
    return;
  }

  const data = JSON.parse(readFileSync(filePath, 'utf8')) as FieldDataFile;

  // Filter out matching rows
  data.rows = data.rows.filter((row: FieldDataRow) => {
    if (row.entity_id !== entityId) return true;
    if (langcode !== null && row.langcode !== langcode) return true;
    if (revisionId !== null && row.revision_id !== revisionId) return true;
    return false;
  });

  // Save to disk
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// ============================================================================
// Field Item List Class
// ============================================================================

/**
 * Field Item List
 *
 * Provides an OOP interface for working with field values.
 * Similar to Drupal's FieldItemList.
 */
/** A single field item value object */
interface FieldItem {
  value?: unknown;
  target_id?: unknown;
  [key: string]: unknown;
}

export class FieldItemList {
  items: FieldItem[];
  storage: FieldStorageDef | null;

  /**
   * @param {Array} items - Field values
   * @param {Object} storage - Field storage definition
   */
  constructor(items: FieldItem[] = [], storage: FieldStorageDef | null = null) {
    this.items = items;
    this.storage = storage;
  }

  /**
   * Get item at delta
   */
  get(delta: number): FieldItem | null {
    return this.items[delta] || null;
  }

  /**
   * Set item at delta
   */
  set(delta: number, value: FieldItem): void {
    // Validate cardinality
    if (this.storage && this.storage.cardinality !== -1) {
      if (delta >= this.storage.cardinality) {
        throw new Error(`Delta ${delta} exceeds cardinality ${this.storage.cardinality}`);
      }
    }

    this.items[delta] = value;
  }

  /**
   * Add item to end
   */
  add(value: FieldItem): number {
    // Validate cardinality
    if (this.storage && this.storage.cardinality !== -1) {
      if (this.items.length >= this.storage.cardinality) {
        throw new Error(`Cannot add item, cardinality ${this.storage.cardinality} reached`);
      }
    }

    this.items.push(value);
    return this.items.length - 1; // Return delta
  }

  /**
   * Remove item at delta
   */
  remove(delta: number): boolean {
    if (delta >= 0 && delta < this.items.length) {
      this.items.splice(delta, 1);
      return true;
    }
    return false;
  }

  /**
   * Check if list is empty
   */
  isEmpty(): boolean {
    return this.items.length === 0;
  }

  /**
   * Get primary value (first item's value column)
   */
  getValue(): unknown {
    if (this.items.length === 0) return null;

    const firstItem = this.items[0]!;

    // For most field types, return the 'value' column
    if (firstItem.value !== undefined) {
      return firstItem.value;
    }

    // For entity references, return target_id
    if (firstItem.target_id !== undefined) {
      return firstItem.target_id;
    }

    // For complex fields, return the whole item
    return firstItem;
  }

  /**
   * Get all values
   */
  getValues(): unknown[] {
    return this.items.map((item: FieldItem) => {
      if (item.value !== undefined) return item.value;
      if (item.target_id !== undefined) return item.target_id;
      return item;
    });
  }

  /**
   * Set single value (replaces all items)
   */
  setValue(value: FieldItem | FieldItem[]): void {
    // Convert single value to array
    let valuesArray: FieldItem[];
    if (!Array.isArray(value)) {
      valuesArray = [value];
    } else {
      valuesArray = value;
    }

    // Validate cardinality
    if (this.storage && this.storage.cardinality !== -1) {
      if (valuesArray.length > this.storage.cardinality) {
        throw new Error(`Cannot set ${valuesArray.length} values, cardinality is ${this.storage.cardinality}`);
      }
    }

    this.items = valuesArray;
  }

  /**
   * Get item count
   */
  count(): number {
    return this.items.length;
  }

  /**
   * Iterator support
   */
  [Symbol.iterator](): Iterator<FieldItem> {
    return this.items[Symbol.iterator]();
  }

  /**
   * Convert to plain array
   */
  toArray(): FieldItem[] {
    return [...this.items];
  }

  /**
   * Convert to JSON
   */
  toJSON(): FieldItem[] {
    return this.items;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Load all field storages into cache
 */
function _loadAllFieldStorages(): void {
  if (!existsSync(fieldStorageDir!)) {
    return;
  }

  const files = readdirSync(fieldStorageDir!);

  for (const file of files) {
    if (file.endsWith('.json') && !file.includes('__field_')) {
      try {
        const storage = JSON.parse(readFileSync(join(fieldStorageDir!, file), 'utf8')) as FieldStorageDef;
        const cacheKey = `${storage.entity_type}.${storage.field_name}`;
        fieldStorageCache.set(cacheKey, storage);
      } catch (error) {
        console.error(`Failed to load field storage from ${file}:`, error);
      }
    }
  }
}

/**
 * Load all field configs into cache
 */
function _loadAllFieldConfigs(): void {
  if (!existsSync(fieldConfigDir!)) {
    return;
  }

  const files = readdirSync(fieldConfigDir!);

  for (const file of files) {
    if (file.endsWith('.json')) {
      try {
        const config = JSON.parse(readFileSync(join(fieldConfigDir!, file), 'utf8')) as FieldConfigDef;
        const cacheKey = `${config.entity_type}.${config.bundle}.${config.field_name}`;
        fieldConfigCache.set(cacheKey, config);
      } catch (error) {
        console.error(`Failed to load field config from ${file}:`, error);
      }
    }
  }
}

/**
 * Get all supported field types
 */
export function getFieldTypes(): string[] {
  return Object.keys(FIELD_TYPES);
}

/**
 * Get field type definition
 */
export function getFieldTypeDefinition(fieldType: string): FieldTypeDefinition | null {
  return FIELD_TYPES[fieldType] || null;
}

/**
 * Validate field value against field type
 */
export function validateFieldValue(fieldType: string, value: Record<string, unknown>): string[] {
  const definition = FIELD_TYPES[fieldType];
  if (!definition) {
    throw new Error(`Unknown field type: ${fieldType}`);
  }

  const columns = definition.columns;
  const errors: string[] = [];

  // Check all required columns exist
  for (const columnName of Object.keys(columns)) {
    if (value[columnName] === undefined) {
      errors.push(`Missing required column: ${columnName}`);
    }
  }

  // Basic type validation
  for (const [columnName, columnType] of Object.entries(columns) as Array<[string, ColumnType]>) {
    const val = value[columnName];
    if (val === undefined || val === null) continue;

    switch (columnType) {
      case 'int':
        if (!Number.isInteger(val)) {
          errors.push(`Column ${columnName} must be an integer`);
        }
        break;
      case 'float':
      case 'decimal':
        if (typeof val !== 'number') {
          errors.push(`Column ${columnName} must be a number`);
        }
        break;
      case 'bool':
        if (typeof val !== 'boolean') {
          errors.push(`Column ${columnName} must be a boolean`);
        }
        break;
      case 'string':
      case 'text':
        if (typeof val !== 'string') {
          errors.push(`Column ${columnName} must be a string`);
        }
        break;
    }
  }

  return errors;
}
