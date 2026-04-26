/**
 * theme-engine.js - Layout and Skin Theme System
 *
 * ARCHITECTURE:
 * - Layouts: Structural templates (regions, HTML skeleton)
 * - Skins: Visual styling (CSS variables, overrides)
 * - Admin: Separate system with fixed layout, limited skins
 *
 * DIRECTORY STRUCTURE:
 * themes/
 * ├── layouts/           # Public site layouts
 * │   └── {layout}/
 * │       ├── manifest.json
 * │       └── templates/
 * ├── skins/             # Public site skins
 * │   └── {skin}/
 * │       ├── manifest.json
 * │       ├── variables.css
 * │       └── overrides.css
 * └── admin/
 *     ├── layout/        # Fixed admin layout
 *     └── skins/         # Limited admin skins (3)
 *
 * CONFIG (site.json):
 * {
 *   "theme": { "layout": "immersive", "skin": "consciousness-dark" },
 *   "adminTheme": { "skin": "default" }
 * }
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================================
// Types
// ============================================================================

/**
 * Layout manifest shape — everything a layout's manifest.json may contain,
 * plus the resolved absolute `path` we inject after loading from disk.
 */
interface LayoutManifest {
  id?: string;
  name?: string;
  description?: string;
  regions?: string[];
  preview?: string;
  compatibleSkins?: string[];
  path: string;
  [key: string]: unknown;
}

/**
 * Skin manifest shape — both public and admin skins use the same structure.
 */
interface SkinManifest {
  id?: string;
  name?: string;
  description?: string;
  preview?: string;
  compatibleLayouts?: string[];
  /** Optional override for the variables.css file name. */
  variables?: string;
  /** Optional override for the overrides.css file name. */
  overrides?: string;
  path: string;
  [key: string]: unknown;
}

/** Options for init(). */
interface InitOptions {
  baseDir?: string;
  config?: ThemeConfig;
}

/** Shape of the site config subset this module reads/writes. */
interface ThemeConfig {
  theme?: {
    layout?: string;
    skin?: string;
  };
  adminTheme?: {
    skin?: string;
  };
  [key: string]: unknown;
}

/** Compact layout listing row. */
interface LayoutListItem {
  id: string | undefined;
  name: string | undefined;
  description: string | undefined;
  regions: string[];
  preview: string | undefined;
  compatibleSkins: string[];
}

/** Compact skin listing row. */
interface SkinListItem {
  id: string | undefined;
  name: string | undefined;
  description: string | undefined;
  preview: string | undefined;
  compatibleLayouts: string[];
}

/** Admin skin listing row (no compatibleLayouts field). */
interface AdminSkinListItem {
  id: string | undefined;
  name: string | undefined;
  description: string | undefined;
  preview: string | undefined;
}

/** Shape returned by getActiveTheme(). */
interface ActiveTheme {
  layout: {
    id: string | undefined;
    name: string | undefined;
    regions: string[];
    path: string;
  } | null;
  skin: {
    id: string | undefined;
    name: string | undefined;
    cssPaths: string[];
  } | null;
}

/** Shape returned by getThemeContext(). */
interface ThemeContext {
  layout: ActiveTheme['layout'];
  skin: ActiveTheme['skin'];
  adminSkin: {
    id: string | undefined;
    name: string | undefined;
    cssPaths: string[];
  } | null;
  cssLinks: string[];
  adminCssLinks: string[];
}

/** Return shape of refresh(). */
interface RefreshResult {
  layouts: number;
  skins: number;
  adminSkins: number;
}

/** Return shape of manifest validators. */
interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ============================================================================
// State
// ============================================================================

let baseDir: string | null = null;
let config: ThemeConfig = {};
const layoutCache: Map<string, LayoutManifest> = new Map();
const skinCache: Map<string, SkinManifest> = new Map();
const adminSkinCache: Map<string, SkinManifest> = new Map();

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the theme engine
 */
export function init(options: InitOptions = {}): void {
  baseDir = options.baseDir || process.cwd();
  config = options.config || {};

  // Clear caches
  layoutCache.clear();
  skinCache.clear();
  adminSkinCache.clear();

  // Discover themes
  discoverLayouts();
  discoverSkins();
  discoverAdminSkins();

  const layoutCount = layoutCache.size;
  const skinCount = skinCache.size;
  const adminSkinCount = adminSkinCache.size;

  console.log(
    `[theme-engine] Initialized (${layoutCount} layouts, ${skinCount} skins, ${adminSkinCount} admin skins)`
  );
}

/**
 * Discover available layouts
 */
function discoverLayouts(): void {
  if (!baseDir) return;
  const layoutsDir = join(baseDir, 'themes', 'layouts');
  if (!existsSync(layoutsDir)) return;

  const dirs = readdirSync(layoutsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const dir of dirs) {
    const manifestPath = join(layoutsDir, dir, 'manifest.json');
    if (existsSync(manifestPath)) {
      try {
        const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Partial<LayoutManifest>;
        const manifest: LayoutManifest = { ...raw, path: join(layoutsDir, dir) };
        layoutCache.set(manifest.id || dir, manifest);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn(`[theme-engine] Failed to load layout ${dir}:`, message);
      }
    }
  }
}

/**
 * Discover available skins
 */
function discoverSkins(): void {
  if (!baseDir) return;
  const skinsDir = join(baseDir, 'themes', 'skins');
  if (!existsSync(skinsDir)) return;

  const dirs = readdirSync(skinsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const dir of dirs) {
    const manifestPath = join(skinsDir, dir, 'manifest.json');
    if (existsSync(manifestPath)) {
      try {
        const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Partial<SkinManifest>;
        const manifest: SkinManifest = { ...raw, path: join(skinsDir, dir) };
        skinCache.set(manifest.id || dir, manifest);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn(`[theme-engine] Failed to load skin ${dir}:`, message);
      }
    }
  }
}

/**
 * Discover admin skins
 */
function discoverAdminSkins(): void {
  if (!baseDir) return;
  const adminSkinsDir = join(baseDir, 'themes', 'admin', 'skins');
  if (!existsSync(adminSkinsDir)) return;

  const dirs = readdirSync(adminSkinsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const dir of dirs) {
    const manifestPath = join(adminSkinsDir, dir, 'manifest.json');
    if (existsSync(manifestPath)) {
      try {
        const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Partial<SkinManifest>;
        const manifest: SkinManifest = { ...raw, path: join(adminSkinsDir, dir) };
        adminSkinCache.set(manifest.id || dir, manifest);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn(`[theme-engine] Failed to load admin skin ${dir}:`, message);
      }
    }
  }
}

// ============================================
// LAYOUTS
// ============================================

/**
 * List all available layouts
 */
export function listLayouts(): LayoutListItem[] {
  return Array.from(layoutCache.values()).map((l) => ({
    id: l.id,
    name: l.name,
    description: l.description,
    regions: l.regions || [],
    preview: l.preview,
    compatibleSkins: l.compatibleSkins || [],
  }));
}

/**
 * Get a specific layout
 */
export function getLayout(id: string): LayoutManifest | null {
  return layoutCache.get(id) || null;
}

/**
 * Get the active layout
 */
export function getActiveLayout(): LayoutManifest | null {
  const layoutId = config.theme?.layout || 'classic';
  return getLayout(layoutId) || getLayout('classic') || layoutCache.values().next().value || null;
}

/**
 * Get layout template path
 */
export function getLayoutTemplatePath(layoutId: string, templateName: string): string | null {
  const layout = getLayout(layoutId);
  if (!layout) return null;
  return join(layout.path, 'templates', templateName);
}

/**
 * Get layout template content
 */
export function getLayoutTemplate(layoutId: string, templateName: string): string | null {
  const filePath = getLayoutTemplatePath(layoutId, templateName);
  if (!filePath || !existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf-8');
}

// ============================================
// SKINS
// ============================================

/**
 * List all available skins
 * @param layoutId - Optional: filter by layout compatibility
 */
export function listSkins(layoutId: string | null = null): SkinListItem[] {
  let skins: SkinManifest[] = Array.from(skinCache.values());

  if (layoutId) {
    skins = skins.filter((s) => {
      // If skin specifies compatible layouts, check it
      if (s.compatibleLayouts && s.compatibleLayouts.length > 0) {
        return s.compatibleLayouts.includes(layoutId);
      }
      // If layout specifies compatible skins, check it
      const layout = getLayout(layoutId);
      if (layout?.compatibleSkins && layout.compatibleSkins.length > 0 && s.id) {
        return layout.compatibleSkins.includes(s.id);
      }
      // Default: compatible
      return true;
    });
  }

  return skins.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    preview: s.preview,
    compatibleLayouts: s.compatibleLayouts || [],
  }));
}

/**
 * Get a specific skin
 */
export function getSkin(id: string): SkinManifest | null {
  return skinCache.get(id) || null;
}

/**
 * Get the active skin
 */
export function getActiveSkin(): SkinManifest | null {
  const skinId = config.theme?.skin || 'minimal';
  return getSkin(skinId) || getSkin('minimal') || skinCache.values().next().value || null;
}

/**
 * Get skin CSS (variables + overrides combined)
 */
export function getSkinCSS(skinId: string): string {
  const skin = getSkin(skinId);
  if (!skin) return '';

  let css = '';

  // Variables
  const varsPath = join(skin.path, skin.variables || 'variables.css');
  if (existsSync(varsPath)) {
    css += readFileSync(varsPath, 'utf-8') + '\n';
  }

  // Overrides
  const overridesPath = join(skin.path, skin.overrides || 'overrides.css');
  if (existsSync(overridesPath)) {
    css += readFileSync(overridesPath, 'utf-8') + '\n';
  }

  return css;
}

/**
 * Get skin CSS file paths (for linking)
 */
export function getSkinCSSPaths(skinId: string | undefined): string[] {
  if (!skinId) return [];
  const skin = getSkin(skinId);
  if (!skin) return [];

  const paths: string[] = [];
  const basePath = `/themes/skins/${skinId}`;

  if (skin.variables) paths.push(`${basePath}/${skin.variables}`);
  if (skin.overrides) paths.push(`${basePath}/${skin.overrides}`);

  return paths;
}

// ============================================
// ADMIN SKINS
// ============================================

/**
 * List admin skins
 */
export function listAdminSkins(): AdminSkinListItem[] {
  return Array.from(adminSkinCache.values()).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    preview: s.preview,
  }));
}

/**
 * Get admin skin
 */
export function getAdminSkin(id: string): SkinManifest | null {
  return adminSkinCache.get(id) || null;
}

/**
 * Get active admin skin
 */
export function getActiveAdminSkin(): SkinManifest | null {
  const skinId = config.adminTheme?.skin || 'default';
  return (
    getAdminSkin(skinId) || getAdminSkin('default') || adminSkinCache.values().next().value || null
  );
}

/**
 * Get admin skin CSS
 */
export function getAdminSkinCSS(skinId: string): string {
  const skin = getAdminSkin(skinId);
  if (!skin) return '';

  let css = '';

  const varsPath = join(skin.path, skin.variables || 'variables.css');
  if (existsSync(varsPath)) {
    css += readFileSync(varsPath, 'utf-8') + '\n';
  }

  const overridesPath = join(skin.path, skin.overrides || 'overrides.css');
  if (existsSync(overridesPath)) {
    css += readFileSync(overridesPath, 'utf-8') + '\n';
  }

  return css;
}

/**
 * Get admin skin CSS paths
 */
export function getAdminSkinCSSPaths(skinId: string | undefined): string[] {
  if (!skinId) return [];
  const skin = getAdminSkin(skinId);
  if (!skin) return [];

  const paths: string[] = [];
  const basePath = `/themes/admin/skins/${skinId}`;

  if (skin.variables) paths.push(`${basePath}/${skin.variables}`);
  if (skin.overrides) paths.push(`${basePath}/${skin.overrides}`);

  return paths;
}

// ============================================
// ACTIVE THEME
// ============================================

/**
 * Get the complete active theme (layout + skin)
 */
export function getActiveTheme(): ActiveTheme {
  const layout = getActiveLayout();
  const skin = getActiveSkin();

  return {
    layout: layout
      ? {
          id: layout.id,
          name: layout.name,
          regions: layout.regions || [],
          path: layout.path,
        }
      : null,
    skin: skin
      ? {
          id: skin.id,
          name: skin.name,
          cssPaths: getSkinCSSPaths(skin.id),
        }
      : null,
  };
}

/**
 * Set the active theme
 */
export function setActiveTheme(layoutId: string | null, skinId: string | null): ActiveTheme {
  // Validate
  if (layoutId && !getLayout(layoutId)) {
    throw new Error(`Layout not found: ${layoutId}`);
  }
  if (skinId && !getSkin(skinId)) {
    throw new Error(`Skin not found: ${skinId}`);
  }

  // Update config
  if (!config.theme) config.theme = {};
  if (layoutId) config.theme.layout = layoutId;
  if (skinId) config.theme.skin = skinId;

  return getActiveTheme();
}

/**
 * Set the active admin skin
 */
export function setAdminSkin(skinId: string): SkinManifest | null {
  if (!getAdminSkin(skinId)) {
    throw new Error(`Admin skin not found: ${skinId}`);
  }

  if (!config.adminTheme) config.adminTheme = {};
  config.adminTheme.skin = skinId;

  return getActiveAdminSkin();
}

// ============================================
// RENDERING HELPERS
// ============================================

/**
 * Get theme context for templates
 */
export function getThemeContext(): ThemeContext {
  const theme = getActiveTheme();
  const adminSkin = getActiveAdminSkin();

  return {
    layout: theme.layout,
    skin: theme.skin,
    adminSkin: adminSkin
      ? {
          id: adminSkin.id,
          name: adminSkin.name,
          cssPaths: getAdminSkinCSSPaths(adminSkin.id),
        }
      : null,
    cssLinks: theme.skin?.cssPaths || [],
    adminCssLinks: adminSkin ? getAdminSkinCSSPaths(adminSkin.id) : [],
  };
}

/**
 * Render CSS link tags for current skin
 */
export function renderSkinCSS(): string {
  const paths = getSkinCSSPaths(getActiveSkin()?.id);
  return paths.map((p) => `<link rel="stylesheet" href="${p}">`).join('\n');
}

/**
 * Render CSS link tags for admin skin
 */
export function renderAdminSkinCSS(): string {
  const paths = getAdminSkinCSSPaths(getActiveAdminSkin()?.id);
  return paths.map((p) => `<link rel="stylesheet" href="${p}">`).join('\n');
}

// ============================================
// THEME VALIDATION
// ============================================

/**
 * Validate a layout manifest
 */
export function validateLayout(manifest: Partial<LayoutManifest>): ValidationResult {
  const errors: string[] = [];

  if (!manifest.id) errors.push('Missing id');
  if (!manifest.name) errors.push('Missing name');
  if (!manifest.regions || !Array.isArray(manifest.regions)) {
    errors.push('Missing or invalid regions array');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a skin manifest
 */
export function validateSkin(manifest: Partial<SkinManifest>): ValidationResult {
  const errors: string[] = [];

  if (!manifest.id) errors.push('Missing id');
  if (!manifest.name) errors.push('Missing name');

  return { valid: errors.length === 0, errors };
}

// ============================================
// REFRESH
// ============================================

/**
 * Refresh theme discovery (after adding new themes)
 */
export function refresh(): RefreshResult {
  layoutCache.clear();
  skinCache.clear();
  adminSkinCache.clear();

  discoverLayouts();
  discoverSkins();
  discoverAdminSkins();

  return {
    layouts: layoutCache.size,
    skins: skinCache.size,
    adminSkins: adminSkinCache.size,
  };
}
