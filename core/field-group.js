/**
 * Field Group Service
 *
 * WHY THIS EXISTS:
 * Drupal's Field Group module allows grouping fields into logical containers
 * (fieldsets, tabs, accordions, details) to improve form organization and UX.
 * This provides the same capability for CMS-Core.
 *
 * ARCHITECTURE:
 * - Groups stored as JSON files in content/field-groups/
 * - Each group has a formatter (fieldset, tabs, accordion, details)
 * - Groups can be nested (parent_name references another group)
 * - Groups are scoped by entity_type, bundle, and display mode
 *
 * STORAGE:
 * Field groups stored in content/field-groups/groups.json with structure:
 * {
 *   id: string,              // Unique identifier
 *   entity_type: string,     // e.g., 'node', 'user'
 *   bundle: string,          // e.g., 'article', 'page'
 *   mode: string,            // Display mode: 'default', 'full', 'teaser'
 *   group_name: string,      // Machine name
 *   label: string,           // Human-readable label
 *   format_type: string,     // 'fieldset', 'tabs', 'accordion', 'details'
 *   format_settings: object, // Formatter-specific settings
 *   parent_name: string,     // Parent group name (for nesting)
 *   weight: number,          // Sort order
 *   children: array          // Field names or group names
 * }
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as fieldsetFormatter from './formatters/field-group/fieldset.formatter.js';
import * as tabsFormatter from './formatters/field-group/tabs.formatter.js';
import * as accordionFormatter from './formatters/field-group/accordion.formatter.js';
import * as detailsFormatter from './formatters/field-group/details.formatter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Module state
let initialized = false;
let config = {};
let storageDir = null;
let storageFile = null;

// In-memory storage (Map for fast lookup)
// Key: group ID, Value: group object
const groups = new Map();

/**
 * Initialize the field group service
 *
 * WHY INIT FUNCTION:
 * Services need configuration (storage path, settings) before use.
 * Separating init from module load allows testing with different configs.
 */
export async function init(configuration = {}) {
  config = {
    contentDir: './content',
    ...configuration,
  };

  // Set up storage directory
  storageDir = path.join(config.contentDir, 'field-groups');
  storageFile = path.join(storageDir, 'groups.json');

  // Create storage directory if needed
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }

  // Load persisted groups
  loadGroups();

  // Register built-in formatters
  registerFormatter('fieldset', fieldsetFormatter.render);
  registerFormatter('tabs_horizontal', tabsFormatter.render);
  registerFormatter('tabs_vertical', tabsFormatter.render);
  registerFormatter('accordion', accordionFormatter.render);
  registerFormatter('details', detailsFormatter.render);

  initialized = true;
  console.log('[field-group] Service initialized');
}

/**
 * Load groups from persistence file
 *
 * WHY IN-MEMORY MAP:
 * Fast lookups by ID, supports hierarchy building.
 * File storage provides persistence across restarts.
 */
function loadGroups() {
  if (!storageFile || !fs.existsSync(storageFile)) {
    return;
  }

  try {
    const data = JSON.parse(fs.readFileSync(storageFile, 'utf8'));
    groups.clear();

    for (const group of data) {
      groups.set(group.id, group);
    }

    console.log(`[field-group] Loaded ${groups.size} group(s)`);
  } catch (error) {
    console.error('[field-group] Failed to load groups:', error.message);
  }
}

/**
 * Save groups to persistence file
 *
 * WHY SAVE ENTIRE MAP:
 * Simpler than incremental updates, and group count stays manageable.
 * Future optimization: delta updates if group count grows large.
 */
function saveGroups() {
  if (!storageFile) return;

  try {
    const data = Array.from(groups.values());
    fs.writeFileSync(storageFile, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('[field-group] Failed to save groups:', error.message);
  }
}

/**
 * Generate unique ID for a field group
 *
 * WHY THIS FORMAT:
 * Format: {entity_type}.{bundle}.{mode}.{group_name}
 * This ensures uniqueness and makes groups self-describing.
 */
function generateId(entity_type, bundle, mode, group_name) {
  return `${entity_type}.${bundle}.${mode}.${group_name}`;
}

/**
 * Create a new field group
 *
 * @param {object} data - Group configuration
 * @returns {object} Created group
 *
 * WHY VALIDATION:
 * Invalid groups cause runtime errors in rendering.
 * Fail early with clear messages.
 */
export async function createGroup(data) {
  if (!initialized) {
    throw new Error('Field group service not initialized. Call init() first.');
  }

  // Validate required fields
  const required = ['entity_type', 'bundle', 'group_name', 'label', 'format_type'];
  for (const field of required) {
    if (!data[field]) {
      throw new Error(`Field group missing required field: ${field}`);
    }
  }

  // Default mode
  const mode = data.mode || 'default';

  // Generate ID
  const id = generateId(data.entity_type, data.bundle, mode, data.group_name);

  // Check uniqueness: group_name must be unique per entity_type/bundle/mode
  if (groups.has(id)) {
    throw new Error(
      `Field group "${data.group_name}" already exists for ${data.entity_type}.${data.bundle}.${mode}`
    );
  }

  // Build group object
  const group = {
    id,
    entity_type: data.entity_type,
    bundle: data.bundle,
    mode,
    group_name: data.group_name,
    label: data.label,
    format_type: data.format_type,
    format_settings: data.format_settings || {},
    parent_name: data.parent_name || null,
    weight: data.weight || 0,
    children: data.children || [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Store in memory and persist
  groups.set(id, group);
  saveGroups();

  return group;
}

/**
 * Get a field group by ID
 *
 * @param {string} id - Group ID
 * @returns {object|null} Group or null if not found
 */
export async function getGroup(id) {
  if (!initialized) {
    throw new Error('Field group service not initialized');
  }

  return groups.get(id) || null;
}

/**
 * Get all field groups for an entity type/bundle/mode
 *
 * @param {string} entity_type - Entity type
 * @param {string} bundle - Bundle name
 * @param {string} mode - Display mode (default: 'default')
 * @returns {array} Array of groups
 *
 * WHY FILTER BY MODE:
 * Different display modes (default, full, teaser) may have
 * different field groupings for the same content type.
 */
export async function getGroupsByEntityType(entity_type, bundle, mode = 'default') {
  if (!initialized) {
    throw new Error('Field group service not initialized');
  }

  const result = [];
  for (const group of groups.values()) {
    if (
      group.entity_type === entity_type &&
      group.bundle === bundle &&
      group.mode === mode
    ) {
      result.push(group);
    }
  }

  // Sort by weight
  result.sort((a, b) => a.weight - b.weight);
  return result;
}

/**
 * Update a field group
 *
 * @param {string} id - Group ID
 * @param {object} data - Updated fields
 * @returns {object} Updated group
 */
export async function updateGroup(id, data) {
  if (!initialized) {
    throw new Error('Field group service not initialized');
  }

  // Check group exists
  const existing = groups.get(id);
  if (!existing) {
    throw new Error(`Field group not found: ${id}`);
  }

  // If renaming, check uniqueness
  if (data.group_name && data.group_name !== existing.group_name) {
    const newId = generateId(existing.entity_type, existing.bundle, existing.mode, data.group_name);
    if (groups.has(newId)) {
      throw new Error(
        `Field group "${data.group_name}" already exists for ${existing.entity_type}.${existing.bundle}.${existing.mode}`
      );
    }
  }

  // Build updated group
  const updated = {
    ...existing,
    ...data,
    // Don't allow changing core identity fields
    id: existing.id,
    entity_type: existing.entity_type,
    bundle: existing.bundle,
    mode: existing.mode,
    created_at: existing.created_at,
    updated_at: new Date().toISOString(),
  };

  // Update in memory and persist
  groups.set(id, updated);
  saveGroups();

  return updated;
}

/**
 * Delete a field group
 *
 * @param {string} id - Group ID
 * @returns {boolean} True if deleted
 */
export async function deleteGroup(id) {
  if (!initialized) {
    throw new Error('Field group service not initialized');
  }

  const deleted = groups.delete(id);
  if (deleted) {
    saveGroups();
  }
  return deleted;
}

/**
 * Get field group hierarchy (tree structure)
 *
 * @param {string} entity_type - Entity type
 * @param {string} bundle - Bundle name
 * @param {string} mode - Display mode
 * @returns {array} Tree of groups and fields
 *
 * WHY HIERARCHY:
 * Groups can be nested (tabs containing fieldsets, etc.).
 * Rendering requires knowing the full tree structure.
 *
 * ALGORITHM:
 * 1. Get all groups for this entity/bundle/mode
 * 2. Build tree from parent_name relationships
 * 3. Root groups (parent_name = null) are top level
 * 4. Children attached recursively
 */
export async function getGroupHierarchy(entity_type, bundle, mode = 'default') {
  if (!initialized) {
    throw new Error('Field group service not initialized');
  }

  // Get all groups
  const allGroups = await getGroupsByEntityType(entity_type, bundle, mode);

  // Build lookup map
  const groupMap = new Map();
  for (const group of allGroups) {
    groupMap.set(group.group_name, { ...group, _children: [] });
  }

  // Build tree
  const roots = [];
  for (const group of groupMap.values()) {
    if (!group.parent_name) {
      roots.push(group);
    } else {
      const parent = groupMap.get(group.parent_name);
      if (parent) {
        parent._children.push(group);
      } else {
        // Orphaned group - add to roots
        roots.push(group);
      }
    }
  }

  // Sort by weight at each level
  function sortByWeight(nodes) {
    nodes.sort((a, b) => a.weight - b.weight);
    for (const node of nodes) {
      if (node._children.length > 0) {
        sortByWeight(node._children);
      }
    }
  }
  sortByWeight(roots);

  return roots;
}

/**
 * Reorder children within a group
 *
 * @param {string} group_id - Group ID
 * @param {array} ordered_children - Array of child names in desired order
 * @returns {object} Updated group
 *
 * WHY THIS FUNCTION:
 * Drag-and-drop reordering in UI needs to update child order.
 * This provides atomic operation for reordering.
 */
export async function reorderChildren(group_id, ordered_children) {
  if (!initialized) {
    throw new Error('Field group service not initialized');
  }

  const group = groups.get(group_id);
  if (!group) {
    throw new Error(`Field group not found: ${group_id}`);
  }

  // Update children array
  return await updateGroup(group_id, {
    children: ordered_children,
  });
}

/**
 * Register formatter for field groups
 *
 * @param {string} type - Formatter type (e.g., 'fieldset', 'tabs')
 * @param {Function} formatter - Render function
 *
 * WHY REGISTRY:
 * Multiple formatters need to be available (fieldset, tabs, accordion, details).
 * Registry allows adding custom formatters without modifying core.
 */
const formatters = new Map();

export function registerFormatter(type, formatter) {
  formatters.set(type, formatter);
  console.log(`[field-group] Registered formatter: ${type}`);
}

/**
 * Get formatter by type
 *
 * @param {string} type - Formatter type
 * @returns {Function|null} Formatter function or null
 */
export function getFormatter(type) {
  return formatters.get(type) || null;
}

/**
 * List all registered formatters
 *
 * @returns {array} Array of formatter type names
 */
export function listFormatters() {
  return Array.from(formatters.keys());
}

/**
 * Service name for registration
 * WHY EXPORT NAME:
 * Service container uses this for registration:
 * services.register(fieldGroup.name, () => fieldGroup)
 */
export const name = 'field-group';

/**
 * Register CLI commands
 *
 * WHY SEPARATE REGISTER:
 * CLI commands need access to initialized service.
 * Boot process calls this after init().
 */
export function register(registerCommand) {
  registerCommand('field-group:create', async (args) => {
    // Parse args - support both positional and flag-style arguments
    let entity_type, bundle, group_name, label, mode, format_type;

    // Check if using flag-style arguments (--key=value)
    const hasFlags = args.some(arg => arg.startsWith('--'));

    if (hasFlags) {
      // Parse flag-style arguments
      const parseFlag = (flag) => {
        const match = args.find(a => a.startsWith(`--${flag}=`));
        return match ? match.split('=').slice(1).join('=') : null;
      };

      entity_type = parseFlag('entity-type');
      bundle = parseFlag('bundle');
      group_name = parseFlag('name');
      label = parseFlag('label');
      mode = parseFlag('mode') || 'default';
      format_type = parseFlag('format') || 'fieldset';
    } else {
      // Parse positional arguments
      [entity_type, bundle, group_name, label] = args;
      mode = 'default';
      format_type = 'fieldset';
    }

    if (!entity_type || !bundle || !group_name || !label) {
      console.log('Usage: field-group:create <entity-type> <bundle> <group-name> <label>');
      console.log('   or: field-group:create --entity-type=node --bundle=article --name=test_group --label="Test Group" [--mode=default] [--format=fieldset]');
      console.log('Example: field-group:create node article basic_info "Basic Information"');
      console.log('Example: field-group:create --entity-type=node --bundle=article --name=test_group --label="Test Group" --format=fieldset');
      return;
    }

    const data = {
      entity_type,
      bundle,
      group_name,
      label,
      mode,
      format_type,
      format_settings: {},
      parent_name: null,
      weight: 0,
      children: [],
    };

    const group = await createGroup(data);
    console.log('\nField group created:');
    console.log(JSON.stringify(group, null, 2));
    return group;
  });

  registerCommand('field-group:list', async (args) => {
    const [entity_type, bundle] = args;

    if (!entity_type || !bundle) {
      console.log('Usage: field-group:list <entity-type> <bundle>');
      console.log('Example: field-group:list node article');
      return;
    }

    const mode = 'default';
    const groupList = await getGroupsByEntityType(entity_type, bundle, mode);
    console.log(`\nField groups for ${entity_type}.${bundle}.${mode}:`);
    if (groupList.length === 0) {
      console.log('  (none)');
    } else {
      console.log(JSON.stringify(groupList, null, 2));
    }
    return groupList;
  });

  registerCommand('field-group:get', async (args) => {
    const [id] = args;

    if (!id) {
      console.log('Usage: field-group:get <id>');
      console.log('Example: field-group:get node.article.default.basic_info');
      return;
    }

    const group = await getGroup(id);
    if (group) {
      console.log('\nField group:');
      console.log(JSON.stringify(group, null, 2));
    } else {
      console.log(`\nField group not found: ${id}`);
    }
    return group;
  });

  registerCommand('field-group:delete', async (args) => {
    const [id] = args;

    if (!id) {
      console.log('Usage: field-group:delete <id>');
      console.log('Example: field-group:delete node.article.default.basic_info');
      return;
    }

    const deleted = await deleteGroup(id);
    if (deleted) {
      console.log(`\nField group deleted: ${id}`);
    } else {
      console.log(`\nField group not found: ${id}`);
    }
    return deleted;
  });

  registerCommand('field-group:hierarchy', async (args) => {
    const [entity_type, bundle] = args;

    if (!entity_type || !bundle) {
      console.log('Usage: field-group:hierarchy <entity-type> <bundle>');
      console.log('Example: field-group:hierarchy node article');
      return;
    }

    const mode = 'default';
    const hierarchy = await getGroupHierarchy(entity_type, bundle, mode);
    console.log(`\nField group hierarchy for ${entity_type}.${bundle}.${mode}:`);
    console.log(JSON.stringify(hierarchy, null, 2));
    return hierarchy;
  });
}
