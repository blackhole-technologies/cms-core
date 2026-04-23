/**
 * archetypes.js - Content Type Builder
 *
 * WHY THIS EXISTS:
 * Allow admins to create custom content types without code changes:
 * - Dynamic schema definition through UI
 * - Field configuration with validation rules
 * - Content type import/export for sharing
 * - Separation of system vs custom types
 *
 * DESIGN DECISIONS:
 * - Stored as JSON files in /config/archetypes/
 * - Loaded on boot, registered as content types
 * - System types (user, comment) are read-only
 * - Supports all 21 field types from fields.js
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';

// ============= Types =============

/** Field definition as stored in an archetype schema */
interface ArchetypeField {
  type: string;
  options?: unknown[];
  target?: string;
  from?: string;
  [key: string]: unknown;
}

/** In-memory archetype record (includes internal _path) */
interface ArchetypeRecord {
  name: string;
  label: string;
  description: string;
  icon: string;
  fields: Record<string, ArchetypeField>;
  workflow: { enabled: boolean };
  revisions: { enabled: boolean; max: number };
  comments: { enabled: boolean };
  search: { enabled: boolean; fields: string[] };
  createdAt: string;
  updatedAt: string;
  isSystem: boolean;
  source?: string;
  _path?: string;
  itemCount?: number;
  [key: string]: unknown;
}

/** Schema shape for validation */
interface ArchetypeSchema {
  fields?: Record<string, ArchetypeField>;
  label?: string;
  description?: string;
  icon?: string;
  workflow?: { enabled: boolean };
  revisions?: { enabled: boolean; max: number };
  comments?: { enabled: boolean };
  search?: { enabled: boolean; fields: string[] };
  name?: string;
  [key: string]: unknown;
}

/** Minimal content service interface */
interface ContentService {
  listTypes(): Array<{ type: string; schema: unknown; source?: string }>;
  register(type: string, fields: unknown, source: string): void;
  list(type: string): { total: number };
}

/** Minimal fields service interface */
interface FieldsService {
  listTypes(): string[];
}

/** Archetype config */
interface ArchetypeConfig {
  enabled?: boolean;
  directory?: string;
}

// ============= State =============

/**
 * Configuration
 */
let config: ArchetypeConfig & { enabled: boolean; directory: string } = {
  enabled: true,
  directory: './config/archetypes',
};

/**
 * Storage
 */
let baseDir: string | null = null;
let archetypesDir: string | null = null;
let contentService: ContentService | null = null;
let fieldsService: FieldsService | null = null;

/**
 * Loaded archetypes
 */
const archetypes = new Map<string, ArchetypeRecord>();

/**
 * System type names (not editable via UI)
 */
const SYSTEM_TYPES = new Set([
  'user',
  'apitoken',
  'webhook',
  'comment',
  'media',
  'taskrun',
  'notification',
  'preview',
]);

/**
 * Default icons for common content types
 */
const DEFAULT_ICONS: Record<string, string> = {
  article: '📝',
  page: '📄',
  post: '📰',
  product: '📦',
  event: '📅',
  person: '👤',
  gallery: '🖼️',
  video: '🎬',
  podcast: '🎙️',
  faq: '❓',
  testimonial: '💬',
  portfolio: '🎨',
  service: '⚙️',
  project: '📋',
  team: '👥',
  default: '📁',
};

/**
 * Initialize archetypes system
 *
 * @param {string} dir - Base directory
 * @param {Object} contentSvc - Content service
 * @param {Object} fieldsSvc - Fields service
 * @param {Object} archetypeConfig - Configuration
 */
export function init(dir: string, contentSvc: ContentService | null, fieldsSvc: FieldsService | null, archetypeConfig: ArchetypeConfig = {}): void {
  baseDir = dir;
  contentService = contentSvc;
  fieldsService = fieldsSvc;

  config = { ...config, ...archetypeConfig };

  archetypesDir = join(dir, config.directory.replace('./', ''));
  if (!existsSync(archetypesDir)) {
    mkdirSync(archetypesDir, { recursive: true });
  }

  // Load all archetypes
  loadAll();
}

/**
 * Load all archetype definitions
 */
function loadAll() {
  archetypes.clear();

  if (!existsSync(archetypesDir!)) return;

  const files = readdirSync(archetypesDir!).filter((f: string) => f.endsWith('.json'));

  for (const file of files) {
    try {
      const path = join(archetypesDir!, file);
      const data = JSON.parse(readFileSync(path, 'utf-8'));
      const name = basename(file, '.json');

      archetypes.set(name, {
        ...data,
        name,
        isSystem: false,
        _path: path,
      });
    } catch (error) {
      console.warn(`[archetypes] Failed to load ${file}: ${(error as Error).message}`);
    }
  }
}

/**
 * Get storage path for an archetype
 *
 * @param {string} name
 * @returns {string}
 */
function getPath(name: string): string {
  return join(archetypesDir!, `${name}.json`);
}

/**
 * Validate archetype name
 *
 * @param {string} name
 * @returns {{ valid: boolean, error?: string }}
 */
function validateName(name: string): { valid: boolean; error?: string } {
  if (!name || typeof name !== 'string') {
    return { valid: false, error: 'Name is required' };
  }

  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    return { valid: false, error: 'Name must start with lowercase letter and contain only lowercase letters, numbers, and underscores' };
  }

  if (name.length > 50) {
    return { valid: false, error: 'Name must be 50 characters or less' };
  }

  if (SYSTEM_TYPES.has(name)) {
    return { valid: false, error: `"${name}" is a reserved system type` };
  }

  return { valid: true };
}

/**
 * Validate schema definition
 *
 * @param {Object} schema
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSchema(schema: ArchetypeSchema | null | undefined): { valid: boolean; errors: string[] } {
  const errors = [];

  if (!schema || typeof schema !== 'object') {
    errors.push('Schema must be an object');
    return { valid: false, errors };
  }

  if (!schema.fields || typeof schema.fields !== 'object') {
    errors.push('Schema must have a fields object');
    return { valid: false, errors };
  }

  const fieldTypes = (fieldsService && typeof fieldsService.listTypes === 'function')
    ? fieldsService.listTypes()
    : [
      'string', 'text', 'markdown', 'html', 'number', 'integer', 'float',
      'boolean', 'date', 'datetime', 'time', 'email', 'url', 'slug',
      'select', 'multiselect', 'reference', 'file', 'image', 'json', 'array',
    ];

  for (const [fieldName, fieldDef] of Object.entries(schema.fields as Record<string, ArchetypeField>)) {
    // Validate field name
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(fieldName)) {
      errors.push(`Field "${fieldName}": invalid name format`);
      continue;
    }

    // Validate field type
    if (!fieldDef.type) {
      errors.push(`Field "${fieldName}": type is required`);
      continue;
    }

    if (!fieldTypes.includes(fieldDef.type)) {
      errors.push(`Field "${fieldName}": unknown type "${fieldDef.type}"`);
    }

    // Type-specific validation
    if (fieldDef.type === 'select' || fieldDef.type === 'multiselect') {
      if (!fieldDef.options || !Array.isArray(fieldDef.options) || fieldDef.options.length === 0) {
        errors.push(`Field "${fieldName}": select fields require options array`);
      }
    }

    if (fieldDef.type === 'reference') {
      if (!fieldDef.target) {
        errors.push(`Field "${fieldName}": reference fields require target type`);
      }
    }

    if (fieldDef.type === 'slug' && fieldDef.from) {
      if (!schema.fields[fieldDef.from]) {
        errors.push(`Field "${fieldName}": slug source field "${fieldDef.from}" not found`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Create a new archetype
 *
 * @param {string} name
 * @param {Object} definition
 * @returns {{ success: boolean, error?: string, archetype?: Object }}
 */
export function createArchetype(name: string, definition: ArchetypeSchema): { success: boolean; error?: string; archetype?: ArchetypeRecord } {
  // Validate name
  const nameCheck = validateName(name);
  if (!nameCheck.valid) {
    return { success: false, error: nameCheck.error };
  }

  // Check if already exists
  if (archetypes.has(name)) {
    return { success: false, error: `Archetype "${name}" already exists` };
  }

  // Check if content type already exists from module
  if (contentService) {
    const types = contentService.listTypes();
    if (types.find((t: { type: string }) => t.type === name)) {
      return { success: false, error: `Content type "${name}" already exists (from module)` };
    }
  }

  // Validate schema
  const schemaCheck = validateSchema(definition);
  if (!schemaCheck.valid) {
    return { success: false, error: schemaCheck.errors.join('; ') };
  }

  const now = new Date().toISOString();
  // fields is guaranteed non-undefined here because validateSchema passed
  const fields = definition.fields as Record<string, ArchetypeField>;
  const archetype: ArchetypeRecord = {
    name,
    label: definition.label || name.charAt(0).toUpperCase() + name.slice(1),
    description: definition.description || '',
    icon: definition.icon || DEFAULT_ICONS[name] || DEFAULT_ICONS['default'] || '📁',
    fields,
    workflow: definition.workflow || { enabled: false },
    revisions: definition.revisions || { enabled: true, max: 10 },
    comments: definition.comments || { enabled: false },
    search: definition.search || { enabled: true, fields: Object.keys(fields).slice(0, 3) },
    createdAt: now,
    updatedAt: now,
    isSystem: false,
  };

  // Save to file
  const path = getPath(name);
  try {
    writeFileSync(path, JSON.stringify(archetype, null, 2) + '\n');
  } catch (error) {
    return { success: false, error: `Failed to save: ${(error as Error).message}` };
  }

  // Store in memory
  archetypes.set(name, { ...archetype, _path: path });

  // Register with content service
  if (contentService) {
    contentService.register(name, archetype.fields, 'archetype');
  }

  return { success: true, archetype };
}

/**
 * Update an archetype
 *
 * @param {string} name
 * @param {Object} updates
 * @returns {{ success: boolean, error?: string, archetype?: Object }}
 */
export function updateArchetype(name: string, updates: ArchetypeSchema): { success: boolean; error?: string; archetype?: ArchetypeRecord } {
  const existing = archetypes.get(name);
  if (!existing) {
    return { success: false, error: `Archetype "${name}" not found` };
  }

  if (existing.isSystem) {
    return { success: false, error: 'Cannot modify system content types' };
  }

  // If updating fields, validate
  if (updates.fields) {
    const schemaCheck = validateSchema({ fields: updates.fields });
    if (!schemaCheck.valid) {
      return { success: false, error: schemaCheck.errors.join('; ') };
    }
  }

  const updated = {
    ...existing,
    ...updates,
    name, // Name cannot change
    isSystem: false,
    updatedAt: new Date().toISOString(),
  };

  // Remove internal properties before saving
  const toSave = { ...updated };
  delete toSave._path;

  // Save to file
  try {
    writeFileSync(existing._path!, JSON.stringify(toSave, null, 2) + '\n');
  } catch (error) {
    return { success: false, error: `Failed to save: ${(error as Error).message}` };
  }

  // Update in memory
  archetypes.set(name, { ...updated, _path: existing._path });

  return { success: true, archetype: updated };
}

/**
 * Delete an archetype
 *
 * @param {string} name
 * @param {Object} options
 * @returns {{ success: boolean, error?: string }}
 */
export function deleteArchetype(name: string, options: { force?: boolean } = {}): { success: boolean; error?: string } {
  const existing = archetypes.get(name);
  if (!existing) {
    return { success: false, error: `Archetype "${name}" not found` };
  }

  if (existing.isSystem) {
    return { success: false, error: 'Cannot delete system content types' };
  }

  // Check if content exists
  if (contentService && !options.force) {
    const items = contentService.list(name);
    if (items.total > 0) {
      return { success: false, error: `Cannot delete: ${items.total} items exist. Use --force to delete anyway.` };
    }
  }

  // Delete file
  try {
    if (existsSync(existing._path!)) {
      unlinkSync(existing._path!);
    }
  } catch (error) {
    return { success: false, error: `Failed to delete: ${(error as Error).message}` };
  }

  // Remove from memory
  archetypes.delete(name);

  return { success: true };
}

/**
 * Get an archetype by name
 *
 * @param {string} name
 * @returns {Object|null}
 */
export function getArchetype(name: string): ArchetypeRecord | null {
  return archetypes.get(name) || null;
}

/**
 * List all archetypes
 *
 * @param {Object} options
 * @returns {Array}
 */
export function listArchetypes(options: { includeSystem?: boolean; includeModules?: boolean } = {}): Array<Record<string, unknown>> {
  const { includeSystem = true, includeModules = true } = options;

  const result = [];

  // Add custom archetypes
  for (const [name, archetype] of archetypes) {
    result.push({
      ...archetype,
      source: 'archetype',
      itemCount: contentService ? contentService.list(name).total : 0,
    });
  }

  // Add module-defined types
  if (includeModules && contentService) {
    const types = contentService.listTypes();
    for (const { type, schema, source } of types) {
      // Skip if already in archetypes
      if (archetypes.has(type)) continue;

      const isSystem = SYSTEM_TYPES.has(type);
      if (!includeSystem && isSystem) continue;

      result.push({
        name: type,
        label: type.charAt(0).toUpperCase() + type.slice(1),
        icon: DEFAULT_ICONS[type] || (isSystem ? '⚙️' : '📁'),
        fields: schema,
        source: isSystem ? 'system' : source || 'module',
        isSystem,
        itemCount: contentService.list(type).total,
      });
    }
  }

  // Sort: custom first, then modules, then system
  result.sort((a, b) => {
    if (a.source === 'archetype' && b.source !== 'archetype') return -1;
    if (b.source === 'archetype' && a.source !== 'archetype') return 1;
    if (a.isSystem && !b.isSystem) return 1;
    if (!a.isSystem && b.isSystem) return -1;
    return a.name.localeCompare(b.name);
  });

  return result;
}

/**
 * Export an archetype as JSON
 *
 * @param {string} name
 * @returns {{ success: boolean, data?: Object, error?: string }}
 */
export function exportArchetype(name: string): { success: boolean; data?: Record<string, unknown>; error?: string } {
  const archetype = archetypes.get(name);
  if (!archetype) {
    // Try to get from content types
    if (contentService) {
      const types = contentService.listTypes();
      const found = types.find(t => t.type === name);
      if (found) {
        return {
          success: true,
          data: {
            name,
            label: name.charAt(0).toUpperCase() + name.slice(1),
            fields: found.schema,
            source: found.source,
            exportedAt: new Date().toISOString(),
          },
        };
      }
    }
    return { success: false, error: `Archetype "${name}" not found` };
  }

  const exportData = { ...archetype };
  delete exportData._path;
  delete exportData.itemCount;
  exportData.exportedAt = new Date().toISOString();

  return { success: true, data: exportData };
}

/**
 * Import an archetype from JSON
 *
 * @param {Object} data
 * @param {Object} options
 * @returns {{ success: boolean, archetype?: Object, error?: string }}
 */
export function importArchetype(data: ArchetypeSchema | null | undefined, options: { overwrite?: boolean; rename?: string | null } = {}): { success: boolean; archetype?: ArchetypeRecord; error?: string } {
  const { overwrite = false, rename = null } = options;

  if (!data || typeof data !== 'object') {
    return { success: false, error: 'Invalid import data' };
  }

  const name = rename || data.name;
  if (!name) {
    return { success: false, error: 'Archetype name is required' };
  }

  // Check if exists
  if (archetypes.has(name) && !overwrite) {
    return { success: false, error: `Archetype "${name}" already exists. Use overwrite option to replace.` };
  }

  // Validate
  const schemaCheck = validateSchema(data);
  if (!schemaCheck.valid) {
    return { success: false, error: schemaCheck.errors.join('; ') };
  }

  // Create or update
  if (archetypes.has(name) && overwrite) {
    return updateArchetype(name, data);
  } else {
    return createArchetype(name, data);
  }
}

/**
 * Get available field types
 *
 * @returns {Array}
 */
export function getFieldTypes() {
  if (fieldsService && typeof fieldsService.listTypes === 'function') {
    return fieldsService.listTypes().map(type => ({
      type,
      label: type.charAt(0).toUpperCase() + type.slice(1),
      ...getFieldTypeInfo(type),
    }));
  }

  // Fallback list
  return [
    { type: 'string', label: 'String', description: 'Short text input' },
    { type: 'text', label: 'Text', description: 'Multi-line text' },
    { type: 'markdown', label: 'Markdown', description: 'Markdown editor' },
    { type: 'html', label: 'HTML', description: 'Rich text editor' },
    { type: 'number', label: 'Number', description: 'Numeric value' },
    { type: 'integer', label: 'Integer', description: 'Whole number' },
    { type: 'float', label: 'Float', description: 'Decimal number' },
    { type: 'boolean', label: 'Boolean', description: 'True/false toggle' },
    { type: 'date', label: 'Date', description: 'Date picker' },
    { type: 'datetime', label: 'DateTime', description: 'Date and time' },
    { type: 'time', label: 'Time', description: 'Time picker' },
    { type: 'email', label: 'Email', description: 'Email address' },
    { type: 'url', label: 'URL', description: 'Web URL' },
    { type: 'slug', label: 'Slug', description: 'URL-safe slug' },
    { type: 'select', label: 'Select', description: 'Single choice dropdown' },
    { type: 'multiselect', label: 'Multi-Select', description: 'Multiple choice' },
    { type: 'reference', label: 'Reference', description: 'Link to another item' },
    { type: 'file', label: 'File', description: 'File upload' },
    { type: 'image', label: 'Image', description: 'Image upload' },
    { type: 'json', label: 'JSON', description: 'JSON data' },
    { type: 'array', label: 'Array', description: 'List of values' },
  ];
}

/**
 * Get field type info
 *
 * @param {string} type
 * @returns {Object}
 */
function getFieldTypeInfo(type: string): Record<string, unknown> {
  const info: Record<string, Record<string, unknown>> = {
    string: { description: 'Short text input', hasMaxLength: true },
    text: { description: 'Multi-line text', hasMaxLength: true },
    markdown: { description: 'Markdown editor', hasMaxLength: true },
    html: { description: 'Rich text editor', hasMaxLength: true },
    number: { description: 'Numeric value', hasMin: true, hasMax: true },
    integer: { description: 'Whole number', hasMin: true, hasMax: true },
    float: { description: 'Decimal number', hasMin: true, hasMax: true },
    boolean: { description: 'True/false toggle', hasDefault: true },
    date: { description: 'Date picker' },
    datetime: { description: 'Date and time' },
    time: { description: 'Time picker' },
    email: { description: 'Email address' },
    url: { description: 'Web URL' },
    slug: { description: 'URL-safe slug', hasFrom: true, hasUnique: true },
    select: { description: 'Single choice dropdown', hasOptions: true },
    multiselect: { description: 'Multiple choice', hasOptions: true },
    reference: { description: 'Link to another item', hasTarget: true },
    file: { description: 'File upload', hasAccept: true },
    image: { description: 'Image upload' },
    json: { description: 'JSON data' },
    array: { description: 'List of values', hasItemType: true },
  };

  return info[type] || { description: 'Unknown field type' };
}

/**
 * Get content types for reference field targets
 *
 * @returns {Array}
 */
export function getReferenceTargets(): Array<{ name: string; source: string }> {
  const targets = [];

  // From archetypes
  for (const [name] of archetypes) {
    targets.push({ name, source: 'archetype' });
  }

  // From content service
  if (contentService) {
    for (const { type, source } of contentService.listTypes()) {
      if (!archetypes.has(type)) {
        targets.push({ name: type, source: source || 'module' });
      }
    }
  }

  return targets.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Check if a type is a system type
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isSystemType(name: string): boolean {
  return SYSTEM_TYPES.has(name);
}

/**
 * Register all archetypes with content service
 */
export function registerAll() {
  if (!contentService) return;

  for (const [name, archetype] of archetypes) {
    contentService.register(name, archetype.fields, 'archetype');
  }
}

/**
 * Get configuration
 *
 * @returns {Object}
 */
export function getConfig() {
  return { ...config };
}

/**
 * Check if archetypes are enabled
 *
 * @returns {boolean}
 */
export function isEnabled() {
  return config.enabled;
}
