/**
 * discovery.js - Module and Theme Discovery
 *
 * WHY THIS EXISTS:
 * A CMS needs to find and load extensions (modules/themes) without
 * hardcoding them. Discovery provides:
 * - Automatic detection of installed modules/themes
 * - Manifest validation (ensure extensions are properly configured)
 * - Dependency information (what order to load things)
 *
 * WHY MANIFEST.JSON (not package.json):
 * - Separates CMS metadata from npm metadata
 * - Allows non-npm packages to be modules
 * - Keeps CMS-specific fields in one place
 *
 * DESIGN DECISION: Discovery is separate from loading
 * This file only FINDS modules, it doesn't LOAD them.
 * Loading happens in boot.js during the REGISTER phase.
 * This separation makes testing easier and logic clearer.
 */

import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Cached discovery results
 */
const discovered = {
  modules: [],
  themes: [],
};

/**
 * Base directory for scanning
 */
let baseDir = null;

/**
 * Initialize discovery with project root
 *
 * @param {string} dir - Project root directory
 */
export function init(dir) {
  baseDir = dir;
}

/**
 * Scan a directory for extensions (modules or themes)
 *
 * @param {string} type - "modules" or "themes"
 * @returns {Array} - Array of discovered extension info
 *
 * WHY RETURN ARRAY OF OBJECTS (not just names):
 * Calling code needs manifest data to make decisions about
 * load order, compatibility, etc. Returning full info
 * avoids redundant filesystem reads.
 */
export function scan(type) {
  if (!baseDir) {
    throw new Error('Discovery not initialized. Call discovery.init(baseDir) first.');
  }

  const dir = join(baseDir, type);

  // WHY GRACEFUL HANDLING OF MISSING DIR:
  // Unlike config (which is required), having zero modules is valid.
  // A fresh install might not have any modules yet.
  if (!existsSync(dir)) {
    console.warn(`[discovery] Directory not found: ${dir}`);
    return [];
  }

  const results = [];

  // WHY SYNC (not async):
  // Discovery happens once at boot. Sync is simpler and
  // the performance difference is negligible for <100 modules.
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    console.error(`[discovery] Failed to read ${dir}:`, error.message);
    return [];
  }

  for (const entry of entries) {
    // WHY SKIP NON-DIRECTORIES:
    // Modules/themes must be directories containing manifest.json.
    // Files like .gitkeep or .DS_Store should be ignored.
    if (!entry.isDirectory()) {
      continue;
    }

    // WHY SKIP HIDDEN DIRECTORIES:
    // Directories starting with . are typically not modules
    // (e.g., .git, .vscode). Skip them to avoid confusion.
    if (entry.name.startsWith('.')) {
      continue;
    }

    const extDir = join(dir, entry.name);
    const manifestPath = join(extDir, 'manifest.json');

    // WHY REQUIRE MANIFEST:
    // A directory without manifest.json is not a valid module.
    // Maybe it's a work-in-progress or misconfigured.
    // Log a warning but don't treat it as an error.
    if (!existsSync(manifestPath)) {
      console.warn(
        `[discovery] Skipping ${type}/${entry.name}: no manifest.json found`
      );
      continue;
    }

    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

      // WHY VALIDATE MANIFEST:
      // Catch configuration errors early with helpful messages.
      // Required fields ensure modules are properly defined.
      const validation = validateManifest(manifest, entry.name);
      if (!validation.valid) {
        console.error(
          `[discovery] Invalid manifest in ${type}/${entry.name}: ${validation.error}`
        );
        continue;
      }

      results.push({
        name: manifest.name,
        version: manifest.version,
        description: manifest.description || '',
        dependencies: manifest.dependencies || [],
        provides: manifest.provides || [],
        path: extDir,
        manifest,
      });

    } catch (error) {
      // WHY CATCH AND LOG (not throw):
      // One broken module shouldn't prevent discovering others.
      // Log the error so users can fix it.
      console.error(
        `[discovery] Failed to parse ${manifestPath}: ${error.message}`
      );
    }
  }

  // Cache results
  discovered[type] = results;

  return results;
}

/**
 * Validate a manifest has required fields
 *
 * @param {Object} manifest - Parsed manifest.json
 * @param {string} dirName - Directory name (for error messages)
 * @returns {{ valid: boolean, error?: string }}
 *
 * WHY MINIMAL VALIDATION:
 * Start with just the essentials. We can add JSON Schema
 * validation later if manifests get more complex.
 */
function validateManifest(manifest, dirName) {
  // WHY NAME IS REQUIRED:
  // Modules are identified by name, not directory.
  // This allows moving modules without breaking references.
  if (!manifest.name) {
    return { valid: false, error: 'missing "name" field' };
  }

  // WHY NAME MUST MATCH DIRECTORY:
  // Prevents confusion when directory is "my-module" but
  // manifest says "totally-different-name". Keeps things predictable.
  if (manifest.name !== dirName) {
    return {
      valid: false,
      error: `"name" (${manifest.name}) must match directory name (${dirName})`,
    };
  }

  // WHY VERSION IS REQUIRED:
  // Enables dependency version checking later.
  // Semver compatibility is important for modules.
  if (!manifest.version) {
    return { valid: false, error: 'missing "version" field' };
  }

  return { valid: true };
}

/**
 * Get previously discovered extensions (doesn't re-scan)
 *
 * @param {string} type - "modules" or "themes"
 * @returns {Array} - Cached discovery results
 */
export function get(type) {
  return discovered[type] || [];
}

/**
 * Get all discovered extensions
 */
export function getAll() {
  return { ...discovered };
}

/**
 * Clear discovery cache (mainly for testing)
 */
export function clear() {
  discovered.modules = [];
  discovered.themes = [];
  baseDir = null;
}
