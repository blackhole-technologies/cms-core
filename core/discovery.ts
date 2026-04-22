/**
 * discovery.ts - Module and Theme Discovery
 *
 * WHY THIS EXISTS:
 * A CMS needs to find and load extensions (modules/themes) without
 * hardcoding them. Discovery provides:
 * - Automatic detection of installed modules/themes
 * - Manifest validation (ensure extensions are properly configured)
 * - Dependency information (what order to load things)
 */

import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Manifest {
  name: string;
  version: string;
  description?: string;
  dependencies?: string[];
  provides?: string[];
  [key: string]: unknown;
}

export interface DiscoveredExtension {
  name: string;
  version: string;
  description: string;
  dependencies: string[];
  provides: string[];
  path: string;
  manifest: Manifest;
}

type ExtensionType = 'modules' | 'themes';

const discovered: Record<ExtensionType, DiscoveredExtension[]> = {
  modules: [],
  themes: [],
};

let baseDir: string | null = null;

export function init(dir: string): void {
  baseDir = dir;
}

export function scan(type: ExtensionType): DiscoveredExtension[] {
  if (!baseDir) {
    throw new Error('Discovery not initialized. Call discovery.init(baseDir) first.');
  }

  const dir = join(baseDir, type);

  if (!existsSync(dir)) {
    console.warn(`[discovery] Directory not found: ${dir}`);
    return [];
  }

  const results: DiscoveredExtension[] = [];

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    console.error(`[discovery] Failed to read ${dir}:`, (error as Error).message);
    return [];
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;

    const extDir = join(dir, entry.name);
    const manifestPath = join(extDir, 'manifest.json');

    if (!existsSync(manifestPath)) {
      console.warn(`[discovery] Skipping ${type}/${entry.name}: no manifest.json found`);
      continue;
    }

    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Manifest;

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
      console.error(
        `[discovery] Failed to parse ${manifestPath}: ${(error as Error).message}`
      );
    }
  }

  discovered[type] = results;
  return results;
}

/**
 * Validate a manifest has required fields.
 */
function validateManifest(
  manifest: Partial<Manifest>,
  dirName: string
): { valid: boolean; error?: string } {
  if (!manifest.name) {
    return { valid: false, error: 'missing "name" field' };
  }

  if (manifest.name !== dirName) {
    return {
      valid: false,
      error: `"name" (${manifest.name}) must match directory name (${dirName})`,
    };
  }

  if (!manifest.version) {
    return { valid: false, error: 'missing "version" field' };
  }

  return { valid: true };
}

export function get(type: ExtensionType): DiscoveredExtension[] {
  return discovered[type] || [];
}

export function getAll(): Record<ExtensionType, DiscoveredExtension[]> {
  return { ...discovered };
}

export function clear(): void {
  discovered.modules = [];
  discovered.themes = [];
  baseDir = null;
}
