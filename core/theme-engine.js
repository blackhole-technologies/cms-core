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

import { join } from 'node:path';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

// State
let baseDir = null;
let config = null;
let layoutCache = new Map();
let skinCache = new Map();
let adminSkinCache = new Map();

/**
 * Initialize the theme engine
 */
export function init(options = {}) {
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
  
  console.log(`[theme-engine] Initialized (${layoutCount} layouts, ${skinCount} skins, ${adminSkinCount} admin skins)`);
}

/**
 * Discover available layouts
 */
function discoverLayouts() {
  const layoutsDir = join(baseDir, 'themes', 'layouts');
  if (!existsSync(layoutsDir)) return;
  
  const dirs = readdirSync(layoutsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
  
  for (const dir of dirs) {
    const manifestPath = join(layoutsDir, dir, 'manifest.json');
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        manifest.path = join(layoutsDir, dir);
        layoutCache.set(manifest.id || dir, manifest);
      } catch (e) {
        console.warn(`[theme-engine] Failed to load layout ${dir}:`, e.message);
      }
    }
  }
}

/**
 * Discover available skins
 */
function discoverSkins() {
  const skinsDir = join(baseDir, 'themes', 'skins');
  if (!existsSync(skinsDir)) return;
  
  const dirs = readdirSync(skinsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
  
  for (const dir of dirs) {
    const manifestPath = join(skinsDir, dir, 'manifest.json');
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        manifest.path = join(skinsDir, dir);
        skinCache.set(manifest.id || dir, manifest);
      } catch (e) {
        console.warn(`[theme-engine] Failed to load skin ${dir}:`, e.message);
      }
    }
  }
}

/**
 * Discover admin skins
 */
function discoverAdminSkins() {
  const adminSkinsDir = join(baseDir, 'themes', 'admin', 'skins');
  if (!existsSync(adminSkinsDir)) return;
  
  const dirs = readdirSync(adminSkinsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
  
  for (const dir of dirs) {
    const manifestPath = join(adminSkinsDir, dir, 'manifest.json');
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        manifest.path = join(adminSkinsDir, dir);
        adminSkinCache.set(manifest.id || dir, manifest);
      } catch (e) {
        console.warn(`[theme-engine] Failed to load admin skin ${dir}:`, e.message);
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
export function listLayouts() {
  return Array.from(layoutCache.values()).map(l => ({
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
export function getLayout(id) {
  return layoutCache.get(id) || null;
}

/**
 * Get the active layout
 */
export function getActiveLayout() {
  const layoutId = config.theme?.layout || 'classic';
  return getLayout(layoutId) || getLayout('classic') || layoutCache.values().next().value;
}

/**
 * Get layout template path
 */
export function getLayoutTemplatePath(layoutId, templateName) {
  const layout = getLayout(layoutId);
  if (!layout) return null;
  return join(layout.path, 'templates', templateName);
}

/**
 * Get layout template content
 */
export function getLayoutTemplate(layoutId, templateName) {
  const path = getLayoutTemplatePath(layoutId, templateName);
  if (!path || !existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}

// ============================================
// SKINS
// ============================================

/**
 * List all available skins
 * @param {string} layoutId - Optional: filter by layout compatibility
 */
export function listSkins(layoutId = null) {
  let skins = Array.from(skinCache.values());
  
  if (layoutId) {
    skins = skins.filter(s => {
      // If skin specifies compatible layouts, check it
      if (s.compatibleLayouts && s.compatibleLayouts.length > 0) {
        return s.compatibleLayouts.includes(layoutId);
      }
      // If layout specifies compatible skins, check it
      const layout = getLayout(layoutId);
      if (layout?.compatibleSkins && layout.compatibleSkins.length > 0) {
        return layout.compatibleSkins.includes(s.id);
      }
      // Default: compatible
      return true;
    });
  }
  
  return skins.map(s => ({
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
export function getSkin(id) {
  return skinCache.get(id) || null;
}

/**
 * Get the active skin
 */
export function getActiveSkin() {
  const skinId = config.theme?.skin || 'minimal';
  return getSkin(skinId) || getSkin('minimal') || skinCache.values().next().value;
}

/**
 * Get skin CSS (variables + overrides combined)
 */
export function getSkinCSS(skinId) {
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
export function getSkinCSSPaths(skinId) {
  const skin = getSkin(skinId);
  if (!skin) return [];
  
  const paths = [];
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
export function listAdminSkins() {
  return Array.from(adminSkinCache.values()).map(s => ({
    id: s.id,
    name: s.name,
    description: s.description,
    preview: s.preview,
  }));
}

/**
 * Get admin skin
 */
export function getAdminSkin(id) {
  return adminSkinCache.get(id) || null;
}

/**
 * Get active admin skin
 */
export function getActiveAdminSkin() {
  const skinId = config.adminTheme?.skin || 'default';
  return getAdminSkin(skinId) || getAdminSkin('default') || adminSkinCache.values().next().value;
}

/**
 * Get admin skin CSS
 */
export function getAdminSkinCSS(skinId) {
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
export function getAdminSkinCSSPaths(skinId) {
  const skin = getAdminSkin(skinId);
  if (!skin) return [];
  
  const paths = [];
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
export function getActiveTheme() {
  const layout = getActiveLayout();
  const skin = getActiveSkin();
  
  return {
    layout: layout ? {
      id: layout.id,
      name: layout.name,
      regions: layout.regions || [],
      path: layout.path,
    } : null,
    skin: skin ? {
      id: skin.id,
      name: skin.name,
      cssPaths: getSkinCSSPaths(skin.id),
    } : null,
  };
}

/**
 * Set the active theme
 */
export function setActiveTheme(layoutId, skinId) {
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
export function setAdminSkin(skinId) {
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
export function getThemeContext() {
  const theme = getActiveTheme();
  const adminSkin = getActiveAdminSkin();
  
  return {
    layout: theme.layout,
    skin: theme.skin,
    adminSkin: adminSkin ? {
      id: adminSkin.id,
      name: adminSkin.name,
      cssPaths: getAdminSkinCSSPaths(adminSkin.id),
    } : null,
    cssLinks: theme.skin?.cssPaths || [],
    adminCssLinks: adminSkin ? getAdminSkinCSSPaths(adminSkin.id) : [],
  };
}

/**
 * Render CSS link tags for current skin
 */
export function renderSkinCSS() {
  const paths = getSkinCSSPaths(getActiveSkin()?.id);
  return paths.map(p => `<link rel="stylesheet" href="${p}">`).join('\n');
}

/**
 * Render CSS link tags for admin skin
 */
export function renderAdminSkinCSS() {
  const paths = getAdminSkinCSSPaths(getActiveAdminSkin()?.id);
  return paths.map(p => `<link rel="stylesheet" href="${p}">`).join('\n');
}

// ============================================
// THEME VALIDATION
// ============================================

/**
 * Validate a layout manifest
 */
export function validateLayout(manifest) {
  const errors = [];
  
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
export function validateSkin(manifest) {
  const errors = [];
  
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
export function refresh() {
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
