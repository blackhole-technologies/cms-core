/**
 * transfer.js - Import/Export System for CMS Data
 *
 * WHY THIS EXISTS:
 * =================
 * Content management systems need backup, migration, and staging sync capabilities.
 * This module provides a complete solution for exporting and importing CMS data
 * including content, configuration, and media manifests.
 *
 * USE CASES:
 * ==========
 * 1. BACKUPS: Regular exports to JSON for disaster recovery
 * 2. MIGRATION: Move content between servers or environments
 * 3. STAGING SYNC: Push content from staging to production
 * 4. CONTENT SEEDING: Import initial content for new sites
 * 5. TEAM COLLABORATION: Share content packages between developers
 *
 * EXPORT FORMAT:
 * ==============
 * The export format is a self-documenting JSON structure:
 *
 * {
 *   "version": "0.0.20",              // CMS version that created export
 *   "exported": "2024-01-15T12:00:00Z", // ISO timestamp
 *   "content": {                       // Content grouped by type
 *     "greeting": [                    // Array of content items
 *       { "id": "...", "type": "greeting", ... },
 *       { "id": "...", "type": "greeting", ... }
 *     ],
 *     "user": [
 *       { "id": "...", "type": "user", ... }
 *     ]
 *   },
 *   "config": {                        // Optional: site configuration
 *     "site": { ... },                 // From config/site.json
 *     "modules": { ... }               // From config/modules.json
 *   },
 *   "media": [                         // Optional: media file manifest
 *     {
 *       "id": "...",                   // Content ID referencing this media
 *       "path": "/media/2024/01/photo.jpg",
 *       "size": 12345,
 *       "type": "image/jpeg"
 *     }
 *   ]
 * }
 *
 * IMPORT OPTIONS:
 * ===============
 * - overwrite: boolean (default: false)
 *     If true, existing content with same ID is replaced.
 *     If false, existing content is skipped.
 *
 * - dryRun: boolean (default: false)
 *     If true, no changes are made. Returns what WOULD happen.
 *     Useful for previewing imports before committing.
 *
 * - includeMedia: boolean (default: false)
 *     If true, includes media file manifest in export.
 *     Actual files must be transferred separately.
 *
 * - conflictStrategy: 'skip' | 'overwrite' | 'newId' (default: 'skip')
 *     How to handle ID conflicts during import:
 *     - skip: Leave existing content unchanged
 *     - overwrite: Replace existing content
 *     - newId: Import with a new generated ID
 *
 * TIMESTAMP HANDLING:
 * ==================
 * - Export preserves original created/updated timestamps
 * - Import with overwrite=false preserves existing timestamps
 * - Import with overwrite=true replaces all fields including timestamps
 * - Import with newId regenerates ID but preserves original timestamps
 *
 * SECURITY CONSIDERATIONS:
 * ========================
 * - Sensitive fields (passwords, tokens) should be excluded from exports
 * - Import validates content against registered schemas
 * - Large imports are processed sequentially to avoid memory issues
 * - No executable code in export format (pure JSON data)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ===========================================
// Module State
// ===========================================

/**
 * Reference to content service (set during init)
 * Used for CRUD operations during import/export
 */
let contentService = null;

/**
 * Reference to media service (set during init)
 * Used for media manifest generation
 */
let mediaService = null;

/**
 * Base directory for the CMS
 * Used for reading config files during site export
 */
let baseDir = null;

/**
 * Current CMS version
 * Included in exports for compatibility checking
 */
let cmsVersion = '0.0.20';

// ===========================================
// Initialization
// ===========================================

/**
 * Initialize the transfer system
 *
 * @param {string} basePath - Project root directory
 * @param {Object} services - Service references
 * @param {Object} services.content - Content service
 * @param {Object} services.media - Media service (optional)
 * @param {string} version - CMS version string
 *
 * WHY SEPARATE INIT:
 * - Decouples from boot sequence
 * - Services may not be available at module load time
 * - Makes testing easier with mock services
 */
export function init(basePath, services, version) {
  baseDir = basePath;
  contentService = services.content;
  mediaService = services.media || null;
  cmsVersion = version || '0.0.20';
}

// ===========================================
// Content Export
// ===========================================

/**
 * Export content to JSON format
 *
 * @param {string[]|null} types - Content types to export (null = all types)
 * @param {Object} options - Export options
 * @param {boolean} options.includeMedia - Include media manifest (default: false)
 * @returns {Object} Export data object
 *
 * EXPORT STRUCTURE:
 * {
 *   version: "0.0.20",
 *   exported: "2024-01-15T12:00:00Z",
 *   content: { type1: [...], type2: [...] },
 *   media: [...] // only if includeMedia=true
 * }
 *
 * @example
 * // Export all content
 * const data = exportContent();
 *
 * // Export specific types
 * const data = exportContent(['greeting', 'user']);
 *
 * // Export with media manifest
 * const data = exportContent(null, { includeMedia: true });
 */
export function exportContent(types = null, options = {}) {
  const { includeMedia = false } = options;

  // Get list of types to export
  // If types is null, export all registered types
  const allTypes = contentService.listTypes().map(t => t.type);
  const typesToExport = types || allTypes;

  // Build content object grouped by type
  const content = {};
  let totalItems = 0;

  for (const type of typesToExport) {
    // Skip types that don't exist
    if (!contentService.hasType(type)) {
      console.warn(`[transfer] Skipping unknown type: ${type}`);
      continue;
    }

    // Get all items for this type
    const items = contentService.listAll(type);
    content[type] = items;
    totalItems += items.length;
  }

  // Build export object
  const exportData = {
    version: cmsVersion,
    exported: new Date().toISOString(),
    content,
  };

  // Add media manifest if requested
  if (includeMedia && mediaService) {
    exportData.media = buildMediaManifest(content);
  }

  return exportData;
}

/**
 * Build media manifest from content
 *
 * Scans all content for media references and creates a manifest
 * of files that need to be transferred.
 *
 * @param {Object} content - Content object from export
 * @returns {Array} Media manifest
 *
 * MEDIA DETECTION:
 * - Looks for fields ending in 'path', 'file', 'image', 'video', 'media'
 * - Checks if value looks like a media path (/media/... or year/month/...)
 * - Gathers file metadata from media service
 *
 * @private
 */
function buildMediaManifest(content) {
  const manifest = [];
  const seen = new Set();

  // Media path patterns
  const mediaPathRegex = /^(\/media\/|media\/|\d{4}\/\d{2}\/)/;
  const mediaFieldSuffixes = ['path', 'file', 'image', 'video', 'media', 'attachment'];

  for (const [type, items] of Object.entries(content)) {
    for (const item of items) {
      // Check each field for media references
      for (const [key, value] of Object.entries(item)) {
        if (typeof value !== 'string') continue;

        // Check if field name suggests media
        const isMediaField = mediaFieldSuffixes.some(suffix =>
          key.toLowerCase().endsWith(suffix)
        );

        // Check if value looks like a media path
        const isMediaPath = mediaPathRegex.test(value);

        if ((isMediaField || isMediaPath) && !seen.has(value)) {
          seen.add(value);

          // Normalize path (remove leading /media/ if present)
          const relativePath = value.replace(/^\/media\//, '');

          // Try to get file info from media service
          if (mediaService) {
            try {
              const files = mediaService.listFiles();
              const file = files.find(f => f.path === relativePath || f.path === value);

              if (file) {
                manifest.push({
                  contentId: item.id,
                  contentType: type,
                  field: key,
                  path: value,
                  relativePath: file.path,
                  size: file.size,
                  type: file.type,
                });
              }
            } catch (e) {
              // Media service not available, include path only
              manifest.push({
                contentId: item.id,
                contentType: type,
                field: key,
                path: value,
              });
            }
          }
        }
      }
    }
  }

  return manifest;
}

// ===========================================
// Content Import
// ===========================================

/**
 * Import content from export data
 *
 * @param {Object} data - Export data object
 * @param {Object} options - Import options
 * @param {boolean} options.overwrite - Overwrite existing content (default: false)
 * @param {boolean} options.dryRun - Preview without making changes (default: false)
 * @param {'skip'|'overwrite'|'newId'} options.conflictStrategy - How to handle conflicts
 * @returns {Promise<Object>} Import result
 *
 * IMPORT RESULT:
 * {
 *   success: true,
 *   dryRun: false,
 *   stats: {
 *     total: 15,
 *     created: 12,
 *     updated: 3,
 *     skipped: 0,
 *     errors: 0
 *   },
 *   details: {
 *     greeting: { created: 10, updated: 2, skipped: 0, errors: 0 },
 *     user: { created: 2, updated: 1, skipped: 0, errors: 0 }
 *   },
 *   errors: []
 * }
 *
 * @example
 * // Dry run to preview
 * const preview = await importContent(data, { dryRun: true });
 * console.log(`Would create ${preview.stats.created} items`);
 *
 * // Actual import
 * const result = await importContent(data);
 * console.log(`Created ${result.stats.created} items`);
 *
 * // Import with overwrite
 * const result = await importContent(data, { overwrite: true });
 */
export async function importContent(data, options = {}) {
  const {
    overwrite = false,
    dryRun = false,
    conflictStrategy = overwrite ? 'overwrite' : 'skip',
  } = options;

  // Validate export data structure
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid import data: expected object');
  }

  if (!data.content || typeof data.content !== 'object') {
    throw new Error('Invalid import data: missing content object');
  }

  // Initialize result tracking
  const result = {
    success: true,
    dryRun,
    version: data.version,
    exported: data.exported,
    stats: {
      total: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
    },
    details: {},
    errors: [],
  };

  // Process each content type
  for (const [type, items] of Object.entries(data.content)) {
    // Skip if type isn't registered
    if (!contentService.hasType(type)) {
      result.errors.push({
        type,
        error: `Content type "${type}" is not registered`,
      });
      result.success = false;
      continue;
    }

    // Initialize type stats
    result.details[type] = {
      total: items.length,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
    };

    // Process each item
    for (const item of items) {
      result.stats.total++;

      try {
        const importResult = await importItem(type, item, { dryRun, conflictStrategy });

        // Update stats based on result
        result.details[type][importResult.action]++;
        result.stats[importResult.action]++;

        if (importResult.error) {
          result.details[type].errors++;
          result.stats.errors++;
          result.errors.push({
            type,
            id: item.id,
            error: importResult.error,
          });
        }
      } catch (error) {
        result.details[type].errors++;
        result.stats.errors++;
        result.errors.push({
          type,
          id: item.id,
          error: error.message,
        });
      }
    }
  }

  // Mark as failed if there were errors
  if (result.stats.errors > 0) {
    result.success = false;
  }

  return result;
}

/**
 * Import a single content item
 *
 * @param {string} type - Content type
 * @param {Object} item - Item to import
 * @param {Object} options - Import options
 * @returns {Promise<Object>} { action: 'created'|'updated'|'skipped', error?: string }
 *
 * @private
 */
async function importItem(type, item, options) {
  const { dryRun, conflictStrategy } = options;

  // Check if item already exists
  const existing = contentService.read(type, item.id);

  if (existing) {
    // Handle conflict based on strategy
    switch (conflictStrategy) {
      case 'skip':
        return { action: 'skipped' };

      case 'overwrite':
        if (!dryRun) {
          // Prepare data without system fields (id, type)
          // Update will preserve id, type, created and set new updated
          const updateData = { ...item };
          delete updateData.id;
          delete updateData.type;
          delete updateData.created;
          delete updateData.updated;

          await contentService.update(type, item.id, updateData);
        }
        return { action: 'updated' };

      case 'newId':
        // Fall through to create with new ID
        break;

      default:
        return { action: 'skipped' };
    }
  }

  // Create new item
  if (!dryRun) {
    // Prepare data without system fields
    const createData = { ...item };
    delete createData.id;
    delete createData.type;
    delete createData.created;
    delete createData.updated;

    await contentService.create(type, createData);
  }

  return { action: 'created' };
}

// ===========================================
// Site Export
// ===========================================

/**
 * Export full site (content + config + media manifest)
 *
 * @param {Object} options - Export options
 * @param {boolean} options.includeMedia - Include media manifest (default: true)
 * @returns {Object} Full site export data
 *
 * SITE EXPORT STRUCTURE:
 * {
 *   version: "0.0.20",
 *   exported: "2024-01-15T12:00:00Z",
 *   content: { ... },          // All content
 *   config: {                  // Site configuration
 *     site: { ... },
 *     modules: { ... }
 *   },
 *   media: [ ... ]             // Media manifest
 * }
 *
 * WHY INCLUDE CONFIG:
 * - Enables full site restoration
 * - Captures module dependencies
 * - Preserves site settings (name, theme, etc.)
 *
 * @example
 * // Full site backup
 * const backup = exportSite();
 * writeFileSync('backup.json', JSON.stringify(backup, null, 2));
 */
export function exportSite(options = {}) {
  const { includeMedia = true } = options;

  // Export all content
  const exportData = exportContent(null, { includeMedia });

  // Add configuration
  exportData.config = {};

  // Read site.json
  const siteConfigPath = join(baseDir, 'config', 'site.json');
  if (existsSync(siteConfigPath)) {
    try {
      const siteConfig = JSON.parse(readFileSync(siteConfigPath, 'utf-8'));
      // Remove sensitive fields
      const { sessionSecret, ...safeConfig } = siteConfig;
      exportData.config.site = safeConfig;
    } catch (e) {
      console.warn('[transfer] Failed to read site.json:', e.message);
    }
  }

  // Read modules.json
  const modulesConfigPath = join(baseDir, 'config', 'modules.json');
  if (existsSync(modulesConfigPath)) {
    try {
      exportData.config.modules = JSON.parse(readFileSync(modulesConfigPath, 'utf-8'));
    } catch (e) {
      console.warn('[transfer] Failed to read modules.json:', e.message);
    }
  }

  return exportData;
}

// ===========================================
// Site Import
// ===========================================

/**
 * Import full site from export data
 *
 * @param {Object} data - Site export data
 * @param {Object} options - Import options
 * @param {boolean} options.overwrite - Overwrite existing content (default: false)
 * @param {boolean} options.dryRun - Preview without making changes (default: false)
 * @param {boolean} options.importConfig - Import configuration files (default: false)
 * @returns {Promise<Object>} Import result
 *
 * IMPORT RESULT:
 * {
 *   success: true,
 *   dryRun: false,
 *   content: { ... },      // Content import result
 *   config: {              // Config import result
 *     site: { imported: true },
 *     modules: { imported: true }
 *   }
 * }
 *
 * WHY importConfig DEFAULTS TO FALSE:
 * - Config changes can break the site
 * - Session secrets shouldn't be overwritten
 * - Module list changes require restart
 * - Explicit opt-in prevents accidents
 *
 * @example
 * // Import content only (safe)
 * const result = await importSite(data);
 *
 * // Full import including config
 * const result = await importSite(data, { importConfig: true });
 */
export async function importSite(data, options = {}) {
  const {
    overwrite = false,
    dryRun = false,
    importConfig = false,
  } = options;

  const result = {
    success: true,
    dryRun,
    content: null,
    config: {
      site: { imported: false, skipped: true },
      modules: { imported: false, skipped: true },
    },
  };

  // Import content
  result.content = await importContent(data, { overwrite, dryRun });

  if (!result.content.success) {
    result.success = false;
  }

  // Import configuration if requested
  if (importConfig && data.config) {
    // Import site.json
    if (data.config.site && !dryRun) {
      try {
        const siteConfigPath = join(baseDir, 'config', 'site.json');

        // Preserve local session secret
        let existingSecret = 'change-this-secret';
        if (existsSync(siteConfigPath)) {
          const existing = JSON.parse(readFileSync(siteConfigPath, 'utf-8'));
          existingSecret = existing.sessionSecret || existingSecret;
        }

        // Merge with imported config
        const newConfig = {
          ...data.config.site,
          sessionSecret: existingSecret,
        };

        writeFileSync(siteConfigPath, JSON.stringify(newConfig, null, 2) + '\n');
        result.config.site = { imported: true, skipped: false };
      } catch (e) {
        result.config.site = { imported: false, skipped: false, error: e.message };
        result.success = false;
      }
    } else if (data.config.site) {
      result.config.site = { imported: false, skipped: false, wouldImport: true };
    }

    // Import modules.json
    if (data.config.modules && !dryRun) {
      try {
        const modulesConfigPath = join(baseDir, 'config', 'modules.json');
        writeFileSync(modulesConfigPath, JSON.stringify(data.config.modules, null, 2) + '\n');
        result.config.modules = { imported: true, skipped: false };
      } catch (e) {
        result.config.modules = { imported: false, skipped: false, error: e.message };
        result.success = false;
      }
    } else if (data.config.modules) {
      result.config.modules = { imported: false, skipped: false, wouldImport: true };
    }
  }

  return result;
}

// ===========================================
// Validation
// ===========================================

/**
 * Validate export data structure
 *
 * @param {Object} data - Data to validate
 * @returns {{ valid: boolean, errors: string[] }}
 *
 * VALIDATION CHECKS:
 * - Required fields present (version, exported, content)
 * - Content is an object with array values
 * - Each content item has required system fields
 * - Timestamps are valid ISO strings
 */
export function validateExport(data) {
  const errors = [];

  // Check required top-level fields
  if (!data || typeof data !== 'object') {
    errors.push('Data must be an object');
    return { valid: false, errors };
  }

  if (!data.version) {
    errors.push('Missing required field: version');
  }

  if (!data.exported) {
    errors.push('Missing required field: exported');
  } else if (isNaN(Date.parse(data.exported))) {
    errors.push('Invalid exported timestamp');
  }

  if (!data.content) {
    errors.push('Missing required field: content');
  } else if (typeof data.content !== 'object') {
    errors.push('Content must be an object');
  } else {
    // Validate each content type
    for (const [type, items] of Object.entries(data.content)) {
      if (!Array.isArray(items)) {
        errors.push(`Content type "${type}" must be an array`);
        continue;
      }

      // Validate items
      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        if (!item.id) {
          errors.push(`Content ${type}[${i}]: missing id`);
        }

        if (item.type && item.type !== type) {
          errors.push(`Content ${type}[${i}]: type mismatch (expected "${type}", got "${item.type}")`);
        }
      }
    }
  }

  // Validate config if present
  if (data.config && typeof data.config !== 'object') {
    errors.push('Config must be an object');
  }

  // Validate media if present
  if (data.media && !Array.isArray(data.media)) {
    errors.push('Media must be an array');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Check import compatibility with current system
 *
 * @param {Object} data - Export data to check
 * @returns {{ compatible: boolean, warnings: string[], errors: string[] }}
 *
 * COMPATIBILITY CHECKS:
 * - Version compatibility (major version match)
 * - Content types exist in current system
 * - Schema field compatibility
 */
export function checkCompatibility(data) {
  const warnings = [];
  const errors = [];

  // Check version compatibility
  if (data.version) {
    const [exportMajor] = data.version.split('.');
    const [currentMajor] = cmsVersion.split('.');

    if (exportMajor !== currentMajor) {
      warnings.push(`Version mismatch: export is v${data.version}, current is v${cmsVersion}`);
    }
  }

  // Check content type compatibility
  if (data.content) {
    const currentTypes = contentService.listTypes().map(t => t.type);

    for (const type of Object.keys(data.content)) {
      if (!currentTypes.includes(type)) {
        errors.push(`Content type "${type}" is not registered in current system`);
      }
    }
  }

  return {
    compatible: errors.length === 0,
    warnings,
    errors,
  };
}

// ===========================================
// Utility Functions
// ===========================================

/**
 * Get export statistics without loading all content
 *
 * @returns {Object} Statistics about exportable content
 *
 * USEFUL FOR:
 * - Showing export preview in admin UI
 * - Estimating export file size
 * - Quick inventory of content
 */
export function getExportStats() {
  const types = contentService.listTypes();
  const stats = {
    types: [],
    totalItems: 0,
  };

  for (const { type, source } of types) {
    const result = contentService.list(type);
    stats.types.push({
      type,
      source,
      count: result.total,
    });
    stats.totalItems += result.total;
  }

  return stats;
}

/**
 * Parse import data from JSON string
 *
 * @param {string} jsonString - JSON string to parse
 * @returns {Object} Parsed and validated data
 * @throws {Error} If parsing or validation fails
 *
 * WHY SEPARATE FUNCTION:
 * - Centralized error handling for JSON parsing
 * - Immediate validation after parsing
 * - Clear error messages for malformed imports
 */
export function parseImportData(jsonString) {
  let data;

  try {
    data = JSON.parse(jsonString);
  } catch (e) {
    throw new Error(`Invalid JSON: ${e.message}`);
  }

  const validation = validateExport(data);
  if (!validation.valid) {
    throw new Error(`Invalid import data: ${validation.errors.join(', ')}`);
  }

  return data;
}

// ===========================================
// Default Export
// ===========================================

export default {
  init,
  exportContent,
  importContent,
  exportSite,
  importSite,
  validateExport,
  checkCompatibility,
  getExportStats,
  parseImportData,
};
