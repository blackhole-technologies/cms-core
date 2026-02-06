/**
 * blueprints.js - Content Templates and Blueprints
 *
 * WHY THIS EXISTS:
 * ================
 * Content creators often need to create similar content repeatedly:
 * - Blog posts with consistent structure
 * - Product pages with standard fields
 * - Landing pages with predefined layouts
 *
 * Blueprints provide reusable templates that:
 * - Pre-fill forms with default values
 * - Enforce consistency across content
 * - Speed up content creation
 * - Allow locked fields that can't be overridden
 *
 * STORAGE:
 * ========
 * Blueprints are stored in /content/.blueprints/<id>.json
 * This keeps them with content but in a hidden directory.
 *
 * PLACEHOLDERS:
 * =============
 * Templates can include dynamic placeholders:
 * - {{date}} - Current date (YYYY-MM-DD)
 * - {{datetime}} - Current datetime (ISO)
 * - {{user}} - Current username
 * - {{userId}} - Current user ID
 * - {{random}} - Random 8-char string
 * - {{sequence:name}} - Auto-incrementing number
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

// ============================================
// STATE
// ============================================

/**
 * Configuration
 */
let config = {
  enabled: true
};

/**
 * Base directory for content
 */
let baseDir = '';

/**
 * Blueprints directory
 */
let blueprintsDir = '';

/**
 * Content service reference
 */
let contentService = null;

/**
 * Sequence counters for {{sequence:name}} placeholders
 */
let sequences = {};
let sequencesFile = '';

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize blueprints system
 *
 * @param {Object} cfg - Configuration
 * @param {string} base - Base directory
 * @param {Object} content - Content service
 */
export function init(cfg = {}, base = '', content = null) {
  config = { ...config, ...cfg };
  baseDir = base;
  contentService = content;

  blueprintsDir = join(baseDir, 'content', '.blueprints');
  sequencesFile = join(blueprintsDir, '.sequences.json');

  // Ensure directory exists
  if (!existsSync(blueprintsDir)) {
    mkdirSync(blueprintsDir, { recursive: true });
  }

  // Load sequences
  loadSequences();

  const count = list().length;
  console.log(`[blueprints] Initialized (${count} blueprints)`);
}

/**
 * Load sequence counters from disk
 */
function loadSequences() {
  if (existsSync(sequencesFile)) {
    try {
      sequences = JSON.parse(readFileSync(sequencesFile, 'utf-8'));
    } catch (e) {
      sequences = {};
    }
  }
}

/**
 * Save sequence counters to disk
 */
function saveSequences() {
  try {
    writeFileSync(sequencesFile, JSON.stringify(sequences, null, 2));
  } catch (e) {
    console.error('[blueprints] Failed to save sequences:', e.message);
  }
}

/**
 * Generate a unique blueprint ID
 */
function generateId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 7);
  return `bp_${timestamp}${random}`;
}

/**
 * Get file path for a blueprint
 */
function getBlueprintFile(id) {
  return join(blueprintsDir, `${id}.json`);
}

// ============================================
// CRUD OPERATIONS
// ============================================

/**
 * Create a new blueprint
 *
 * @param {string} name - Blueprint name
 * @param {string} type - Content type this blueprint is for
 * @param {Object} template - Template data (field values)
 * @param {Object} options - Additional options
 * @returns {Object} Created blueprint
 */
export function create(name, type, template, options = {}) {
  if (!config.enabled) {
    throw new Error('Blueprints are disabled');
  }

  if (!name || typeof name !== 'string') {
    throw new Error('Blueprint name is required');
  }

  if (!type || typeof type !== 'string') {
    throw new Error('Content type is required');
  }

  // Validate content type exists
  if (contentService && !contentService.hasType(type)) {
    throw new Error(`Unknown content type: ${type}`);
  }

  const id = generateId();
  const now = new Date().toISOString();

  const blueprint = {
    id,
    name: name.trim(),
    description: options.description || '',
    type,
    template: template || {},
    locked: options.locked || [],
    createdAt: now,
    updatedAt: now,
    createdBy: options.createdBy || 'system',
    usageCount: 0
  };

  // Save to disk
  const filePath = getBlueprintFile(id);
  writeFileSync(filePath, JSON.stringify(blueprint, null, 2));

  return blueprint;
}

/**
 * Get a blueprint by ID
 *
 * @param {string} id - Blueprint ID
 * @returns {Object|null} Blueprint or null if not found
 */
export function get(id) {
  if (!id) return null;

  const filePath = getBlueprintFile(id);
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (e) {
    console.error(`[blueprints] Error reading blueprint ${id}:`, e.message);
    return null;
  }
}

/**
 * List all blueprints
 *
 * @param {string} type - Optional content type filter
 * @returns {Object[]} Array of blueprints
 */
export function list(type = null) {
  if (!existsSync(blueprintsDir)) {
    return [];
  }

  const files = readdirSync(blueprintsDir)
    .filter(f => f.startsWith('bp_') && f.endsWith('.json'));

  const blueprints = [];

  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(blueprintsDir, file), 'utf-8'));
      if (!type || data.type === type) {
        blueprints.push(data);
      }
    } catch (e) {
      // Skip invalid files
    }
  }

  // Sort by name
  blueprints.sort((a, b) => a.name.localeCompare(b.name));

  return blueprints;
}

/**
 * Update a blueprint
 *
 * @param {string} id - Blueprint ID
 * @param {Object} updates - Fields to update
 * @returns {Object} Updated blueprint
 */
export function update(id, updates) {
  const blueprint = get(id);
  if (!blueprint) {
    throw new Error(`Blueprint not found: ${id}`);
  }

  // Fields that can be updated
  const allowedUpdates = ['name', 'description', 'template', 'locked'];

  for (const key of allowedUpdates) {
    if (updates[key] !== undefined) {
      blueprint[key] = updates[key];
    }
  }

  blueprint.updatedAt = new Date().toISOString();

  // Save to disk
  const filePath = getBlueprintFile(id);
  writeFileSync(filePath, JSON.stringify(blueprint, null, 2));

  return blueprint;
}

/**
 * Delete a blueprint
 *
 * @param {string} id - Blueprint ID
 * @returns {boolean} True if deleted
 */
export function remove(id) {
  const filePath = getBlueprintFile(id);
  if (!existsSync(filePath)) {
    return false;
  }

  unlinkSync(filePath);
  return true;
}

// ============================================
// PLACEHOLDER PROCESSING
// ============================================

/**
 * Process placeholders in a value
 *
 * @param {*} value - Value to process
 * @param {Object} context - Context with user info
 * @returns {*} Processed value
 */
function processPlaceholders(value, context = {}) {
  if (typeof value !== 'string') {
    return value;
  }

  const now = new Date();

  // Replace placeholders
  let result = value
    .replace(/\{\{date\}\}/g, now.toISOString().split('T')[0])
    .replace(/\{\{datetime\}\}/g, now.toISOString())
    .replace(/\{\{user\}\}/g, context.username || 'anonymous')
    .replace(/\{\{userId\}\}/g, context.userId || '')
    .replace(/\{\{random\}\}/g, Math.random().toString(36).substring(2, 10));

  // Handle sequence placeholders: {{sequence:name}}
  const sequencePattern = /\{\{sequence:(\w+)\}\}/g;
  result = result.replace(sequencePattern, (match, seqName) => {
    if (!sequences[seqName]) {
      sequences[seqName] = 0;
    }
    sequences[seqName]++;
    saveSequences();
    return String(sequences[seqName]);
  });

  return result;
}

/**
 * Process all placeholders in a template object
 *
 * @param {Object} template - Template object
 * @param {Object} context - Context with user info
 * @returns {Object} Processed template
 */
function processTemplate(template, context = {}) {
  const result = {};

  for (const [key, value] of Object.entries(template)) {
    if (typeof value === 'string') {
      result[key] = processPlaceholders(value, context);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = processTemplate(value, context);
    } else {
      result[key] = value;
    }
  }

  return result;
}

// ============================================
// BLUEPRINT APPLICATION
// ============================================

/**
 * Apply a blueprint to create new content
 *
 * @param {string} blueprintId - Blueprint ID
 * @param {Object} overrides - Field values to override
 * @param {Object} context - Context with user info
 * @returns {Object} Created content
 */
export async function apply(blueprintId, overrides = {}, context = {}) {
  const blueprint = get(blueprintId);
  if (!blueprint) {
    throw new Error(`Blueprint not found: ${blueprintId}`);
  }

  if (!contentService) {
    throw new Error('Content service not available');
  }

  // Process template placeholders
  const processedTemplate = processTemplate(blueprint.template, context);

  // Merge with overrides (but respect locked fields)
  const data = { ...processedTemplate };

  for (const [key, value] of Object.entries(overrides)) {
    if (!blueprint.locked.includes(key)) {
      data[key] = value;
    }
  }

  // Create the content
  const content = await contentService.create(blueprint.type, data);

  // Update usage count
  blueprint.usageCount = (blueprint.usageCount || 0) + 1;
  blueprint.updatedAt = new Date().toISOString();
  writeFileSync(getBlueprintFile(blueprintId), JSON.stringify(blueprint, null, 2));

  return {
    content,
    blueprint: {
      id: blueprint.id,
      name: blueprint.name
    }
  };
}

/**
 * Create a blueprint from existing content
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {string} name - Blueprint name
 * @param {Object} options - Additional options
 * @returns {Object} Created blueprint
 */
export function createFromContent(type, id, name, options = {}) {
  if (!contentService) {
    throw new Error('Content service not available');
  }

  const content = contentService.read(type, id);
  if (!content) {
    throw new Error(`Content not found: ${type}/${id}`);
  }

  // Extract template from content (exclude system fields)
  const systemFields = ['id', 'created', 'updated', 'type', '_type'];
  const template = {};

  for (const [key, value] of Object.entries(content)) {
    if (!systemFields.includes(key)) {
      template[key] = value;
    }
  }

  return create(name, type, template, {
    description: options.description || `Created from ${type}/${id}`,
    createdBy: options.createdBy || 'system',
    locked: options.locked || []
  });
}

/**
 * Get template with placeholders processed (for preview)
 *
 * @param {string} blueprintId - Blueprint ID
 * @param {Object} context - Context with user info
 * @returns {Object} Processed template
 */
export function getProcessedTemplate(blueprintId, context = {}) {
  const blueprint = get(blueprintId);
  if (!blueprint) {
    return null;
  }

  return {
    ...blueprint,
    processedTemplate: processTemplate(blueprint.template, context)
  };
}

// ============================================
// UTILITIES
// ============================================

/**
 * Get blueprints for a content type (for dropdown)
 *
 * @param {string} type - Content type
 * @returns {Object[]} Blueprints with id and name
 */
export function getForType(type) {
  return list(type).map(bp => ({
    id: bp.id,
    name: bp.name,
    description: bp.description
  }));
}

/**
 * Check if a blueprint exists
 *
 * @param {string} id - Blueprint ID
 * @returns {boolean} True if exists
 */
export function exists(id) {
  return existsSync(getBlueprintFile(id));
}

/**
 * Get statistics
 *
 * @returns {Object} Blueprint statistics
 */
export function getStats() {
  const blueprints = list();
  const byType = {};

  let totalUsage = 0;

  for (const bp of blueprints) {
    byType[bp.type] = (byType[bp.type] || 0) + 1;
    totalUsage += bp.usageCount || 0;
  }

  return {
    enabled: config.enabled,
    total: blueprints.length,
    byType,
    totalUsage,
    sequences: Object.keys(sequences).length
  };
}

/**
 * Reset a sequence counter
 *
 * @param {string} name - Sequence name
 * @param {number} value - New value (default 0)
 */
export function resetSequence(name, value = 0) {
  sequences[name] = value;
  saveSequences();
}

/**
 * Get all sequence values
 *
 * @returns {Object} Sequence name -> value map
 */
export function getSequences() {
  return { ...sequences };
}
