/**
 * theme-system.js - Drupal-Style Theme Layer
 *
 * WHY A THEME SYSTEM:
 * ===================
 * Drupal's theme system separates presentation from logic through:
 * - Theme hooks (render functions)
 * - Preprocess functions (modify variables before rendering)
 * - Template suggestions (override templates by context)
 * - Template inheritance (base → sub-theme)
 * - Asset libraries (CSS/JS bundles)
 *
 * This allows themes to override ANY presentation without touching core code.
 *
 * ARCHITECTURE:
 * =============
 * 1. THEME REGISTRY
 *    Central registry of all theme hooks and their definitions.
 *    Maps hook names → {variables, template, preprocess, type}
 *
 * 2. THEME HOOKS
 *    Named render points (e.g., 'node', 'field', 'page')
 *    Each hook defines default variables and rendering logic
 *
 * 3. PREPROCESS FUNCTIONS
 *    Functions that modify variables before template rendering
 *    Execution order: hook_preprocess → theme_preprocess → template
 *
 * 4. TEMPLATE SUGGESTIONS
 *    Hierarchical template override system:
 *    node--article--full.html > node--article.html > node--1.html > node.html
 *
 * 5. RENDER ARRAYS
 *    Structured data format describing what to render
 *    { '#theme': 'node', '#node': {...}, '#view_mode': 'full' }
 *
 * DESIGN DECISIONS:
 * =================
 * - Zero dependencies (Node.js stdlib only)
 * - ES Modules
 * - Mustache-like template syntax
 * - File-based template discovery
 * - In-memory registry (rebuild on theme change)
 * - Lazy template loading
 * - Cache-aware (integrates with cache.js)
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename, extname, dirname } from 'node:path';
import { renderString, escapeHtml } from './template.ts';

// ============================================================================
// Types
// ============================================================================

/** Variables passed into a theme hook — arbitrary data bag. */
type ThemeVariables = Record<string, unknown>;

/** Preprocess function signature: mutates (or replaces) the vars in place. */
type PreprocessFn = (vars: ThemeVariables) => void;

/** Theme hook definition as stored in the registry. */
interface HookDefinition {
  variables: ThemeVariables;
  template: string;
  preprocess: PreprocessFn[] | string[];
  type: string;
  pattern: string | null;
}

/** Partial hook definition as accepted by registerThemeHook(). */
interface HookDefinitionInput {
  variables?: ThemeVariables;
  template?: string;
  preprocess?: PreprocessFn[] | string[];
  type?: string;
  pattern?: string | null;
}

/** Shape of the core hooks table (keys are hook names). */
type CoreHooksMap = Record<string, HookDefinitionInput>;

/** Shape of a theme.info.json file. */
interface ThemeInfo {
  name?: string;
  type?: string;
  description?: string;
  version?: string;
  base_theme?: string | null;
  regions?: Record<string, string>;
  libraries?: Record<string, LibraryDefinitionInput>;
  settings?: Record<string, unknown>;
  features?: string[];
  [key: string]: unknown;
}

/** Active theme record. */
interface ActiveThemeRecord {
  name: string;
  path: string;
  info: ThemeInfo;
}

/** Options accepted by init() / setActiveTheme(). */
interface InitOptions {
  cacheService?: CacheService | null;
  themeName?: string;
}

/** Minimal cache-service contract used by this module. Currently opaque. */
interface CacheService {
  [key: string]: unknown;
}

/** Library definition as accepted by registerLibrary() and theme.info.json. */
interface LibraryDefinitionInput {
  css?: string[];
  js?: string[];
  dependencies?: string[];
}

/** Normalized library entry. */
interface LibraryDefinition {
  css: string[];
  js: string[];
  dependencies: string[];
}

/** Options for buildJsTag(). */
interface JsTagOptions {
  async?: boolean;
  defer?: boolean;
  module?: boolean;
}

/** Meta tag descriptor accepted by renderHead(). */
interface MetaTag {
  charset?: string;
  name?: string;
  property?: string;
  content?: string;
}

/** Options accepted by renderHead(). */
interface RenderHeadOptions {
  title?: string;
  meta?: MetaTag[];
  js?: string[];
}

/**
 * Render array as understood by renderElement().
 * Any key starting with `#` is an "instruction" (e.g. `#theme`, `#node`).
 */
type RenderElement = Record<string, unknown>;

// ============================================================================
// Module state
// ============================================================================

/**
 * Theme registry
 * Structure: { hookName: { variables, template, preprocess, type, pattern } }
 */
const registry: Map<string, HookDefinition> = new Map();

/**
 * Active theme info
 */
let activeTheme: ActiveThemeRecord | null = null;

/**
 * Template cache
 * Maps template path → compiled template string
 */
const templateCache: Map<string, string> = new Map();

/**
 * Preprocess function registry
 * Maps hook name → array of preprocess functions
 */
const preprocessFunctions: Map<string, PreprocessFn[]> = new Map();

/**
 * Theme suggestions cache
 * Maps cache key → array of suggestion paths
 */
const suggestionsCache: Map<string, string[]> = new Map();

/**
 * Asset libraries registry
 * Maps library name → { css: [], js: [], dependencies: [] }
 */
const libraries: Map<string, LibraryDefinition> = new Map();

/**
 * Attached libraries (per request)
 * Set of library names to include in page
 */
const attachedLibraries: Set<string> = new Set();

/**
 * Cache service reference (optional)
 */
let cacheService: CacheService | null = null;

/**
 * Core theme hooks
 * These are available in all themes
 */
const CORE_HOOKS: CoreHooksMap = {
  // HTML structure
  html: {
    variables: { page: null, head: [], styles: [], scripts: [], language: 'en', dir: 'ltr' },
    template: 'html',
    type: 'base',
  },
  page: {
    variables: { content: null, header: null, footer: null, sidebar: null, title: '' },
    template: 'page',
    type: 'layout',
  },
  region: {
    variables: { content: null, region: '' },
    template: 'region',
    type: 'layout',
  },

  // Content
  node: {
    variables: { node: null, view_mode: 'full', content: {}, title_prefix: [], title_suffix: [] },
    template: 'node',
    type: 'entity',
    pattern: 'node__[bundle]__[view_mode]',
  },
  field: {
    variables: { field: null, items: [], label: '', label_display: 'above', field_name: '', field_type: '' },
    template: 'field',
    type: 'field',
    pattern: 'field__[field_name]__[bundle]',
  },
  field_item: {
    variables: { item: null },
    template: 'field-item',
    type: 'field',
  },
  comment: {
    variables: { comment: null, node: null, view_mode: 'full' },
    template: 'comment',
    type: 'entity',
  },

  // Lists
  item_list: {
    variables: { items: [], title: null, list_type: 'ul', wrapper_attributes: {}, attributes: {} },
    template: 'item-list',
    type: 'markup',
  },
  table: {
    variables: { header: [], rows: [], footer: [], caption: '', attributes: {}, sticky: false },
    template: 'table',
    type: 'markup',
  },
  pager: {
    variables: { current: 0, total: 0, quantity: 9, tags: {} },
    template: 'pager',
    type: 'navigation',
  },

  // Forms
  form: {
    variables: { element: null, attributes: {}, children: '' },
    template: 'form',
    type: 'form',
  },
  form_element: {
    variables: { element: null, label: '', description: '', errors: [], required: false },
    template: 'form-element',
    type: 'form',
  },
  form_element_label: {
    variables: { element: null, title: '', required: false },
    template: 'form-element-label',
    type: 'form',
  },
  input: {
    variables: { element: null, attributes: {} },
    template: 'input',
    type: 'form',
  },
  select: {
    variables: { element: null, options: [], attributes: {} },
    template: 'select',
    type: 'form',
  },
  textarea: {
    variables: { element: null, attributes: {} },
    template: 'textarea',
    type: 'form',
  },
  checkbox: {
    variables: { element: null, attributes: {} },
    template: 'checkbox',
    type: 'form',
  },
  radio: {
    variables: { element: null, attributes: {} },
    template: 'radio',
    type: 'form',
  },
  fieldset: {
    variables: { element: null, legend: '', children: '', description: '' },
    template: 'fieldset',
    type: 'form',
  },
  details: {
    variables: { element: null, summary: '', children: '', open: false },
    template: 'details',
    type: 'form',
  },

  // Navigation
  breadcrumb: {
    variables: { links: [] },
    template: 'breadcrumb',
    type: 'navigation',
  },
  menu: {
    variables: { menu_name: '', items: [], attributes: {} },
    template: 'menu',
    type: 'navigation',
  },
  menu_link: {
    variables: { title: '', url: '', below: [], attributes: {}, is_expanded: false, in_active_trail: false },
    template: 'menu-link',
    type: 'navigation',
  },
  tabs: {
    variables: { primary: [], secondary: [] },
    template: 'tabs',
    type: 'navigation',
  },

  // Messages & Status
  status_messages: {
    variables: { messages: {}, attributes: {} },
    template: 'status-messages',
    type: 'status',
  },
  maintenance_page: {
    variables: { title: 'Site under maintenance', content: '' },
    template: 'maintenance-page',
    type: 'page',
  },

  // Misc
  link: {
    variables: { title: '', url: '', attributes: {}, options: {} },
    template: 'link',
    type: 'markup',
  },
  image: {
    variables: { uri: '', alt: '', title: '', attributes: {}, width: null, height: null },
    template: 'image',
    type: 'media',
  },
  responsive_image: {
    variables: { uri: '', alt: '', title: '', sources: [], attributes: {} },
    template: 'responsive-image',
    type: 'media',
  },
  time: {
    variables: { timestamp: 0, text: '', attributes: {} },
    template: 'time',
    type: 'markup',
  },
  username: {
    variables: { user: null, link: true, attributes: {} },
    template: 'username',
    type: 'user',
  },
  container: {
    variables: { children: '', attributes: {} },
    template: 'container',
    type: 'markup',
  },
  html_tag: {
    variables: { tag: 'div', value: '', attributes: {} },
    template: 'html-tag',
    type: 'markup',
  },
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize theme system
 *
 * @param themePath - Absolute path to active theme directory
 * @param options - Initialization options
 */
export function init(themePath: string, options: InitOptions = {}): void {
  activeTheme = {
    name: options.themeName || basename(themePath),
    path: themePath,
    info: loadThemeInfo(themePath),
  };

  cacheService = options.cacheService || null;

  // Build theme registry
  rebuildRegistry();

  // Discover and register asset libraries
  discoverLibraries();
}

/**
 * Load theme .info file
 */
function loadThemeInfo(themePath: string): ThemeInfo {
  const infoPath = join(themePath, 'theme.info.json');

  if (!existsSync(infoPath)) {
    return {
      name: basename(themePath),
      type: 'theme',
      description: '',
      version: '1.0.0',
      base_theme: null,
      regions: {},
      libraries: {},
    };
  }

  try {
    return JSON.parse(readFileSync(infoPath, 'utf-8')) as ThemeInfo;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to parse theme.info.json: ${message}`);
    return { name: basename(themePath) };
  }
}

/**
 * Set cache service for theme system
 */
export function setCache(service: CacheService | null): void {
  cacheService = service;
}

/**
 * Get active theme info
 */
export function getActiveTheme(): ActiveThemeRecord | null {
  return activeTheme;
}

/**
 * Set active theme
 */
export function setActiveTheme(themePath: string, options: InitOptions = {}): void {
  init(themePath, options);
}

/**
 * Get theme registry
 */
export function getThemeRegistry(): Map<string, HookDefinition> {
  return registry;
}

/**
 * Register a theme hook
 */
export function registerThemeHook(hook: string, definition: HookDefinitionInput): void {
  registry.set(hook, {
    variables: definition.variables || {},
    template: definition.template || hook,
    preprocess: definition.preprocess || [],
    type: definition.type || 'markup',
    pattern: definition.pattern || null,
  });
}

/**
 * Rebuild theme registry
 * Discovers hooks from core and active theme
 */
export function rebuildRegistry(): void {
  registry.clear();
  preprocessFunctions.clear();
  suggestionsCache.clear();
  templateCache.clear();

  // Register core hooks
  for (const [hook, def] of Object.entries(CORE_HOOKS)) {
    registerThemeHook(hook, def);
  }

  // Discover theme-specific hooks
  if (activeTheme && activeTheme.path) {
    discoverThemeHooks(activeTheme.path);
  }

  // Register preprocess functions
  discoverPreprocessFunctions();
}

/**
 * Discover theme hooks from theme directory
 * Scans templates/ directory for .html files
 */
function discoverThemeHooks(themePath: string): void {
  const templatesDir = join(themePath, 'templates');

  if (!existsSync(templatesDir)) {
    return;
  }

  const files = readdirSync(templatesDir);

  for (const file of files) {
    if (extname(file) !== '.html') continue;

    const hookName = basename(file, '.html').replace(/-/g, '_');

    // Skip if already registered (core hooks take precedence)
    if (registry.has(hookName)) continue;

    // Register as generic markup hook
    registerThemeHook(hookName, {
      variables: {},
      template: basename(file, '.html'),
      type: 'markup',
    });
  }
}

/**
 * Discover preprocess functions
 * Looks for theme.preprocess.js in theme directory
 */
function discoverPreprocessFunctions(): void {
  if (!activeTheme || !activeTheme.path) return;

  const preprocessPath = join(activeTheme.path, 'theme.preprocess.js');

  if (!existsSync(preprocessPath)) return;

  try {
    import(preprocessPath)
      .then((module: Record<string, unknown>) => {
        // Register all exported functions
        for (const [name, fn] of Object.entries(module)) {
          if (typeof fn === 'function' && name.startsWith('preprocess_')) {
            const hook = name.replace('preprocess_', '');
            addPreprocessFunction(hook, fn as PreprocessFn);
          }
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Failed to load preprocess functions: ${message}`);
      });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to import preprocess module: ${message}`);
  }
}

/**
 * Add a preprocess function for a hook
 */
export function addPreprocessFunction(hook: string, fn: PreprocessFn): void {
  if (!preprocessFunctions.has(hook)) {
    preprocessFunctions.set(hook, []);
  }
  (preprocessFunctions.get(hook) as PreprocessFn[]).push(fn);
}

/**
 * Preprocess variables for a hook
 * Runs all registered preprocess functions
 */
export function preprocess(hook: string, variables: ThemeVariables): ThemeVariables {
  const functions = preprocessFunctions.get(hook) || [];

  // Create a copy to avoid mutations
  const vars: ThemeVariables = { ...variables };

  // Run each preprocess function
  for (const fn of functions) {
    try {
      fn(vars);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Preprocess function error for ${hook}: ${message}`);
    }
  }

  return vars;
}

/**
 * Get theme suggestions for a hook
 * Generates hierarchical list of template suggestions
 *
 * @example
 * getThemeSuggestions('node', { node: { type: 'article', id: 1 }, view_mode: 'full' })
 * // Returns: ['node--article--full', 'node--article', 'node--1', 'node']
 */
export function getThemeSuggestions(hook: string, variables: ThemeVariables = {}): string[] {
  const cacheKey = `${hook}:${JSON.stringify(variables)}`;

  if (suggestionsCache.has(cacheKey)) {
    return suggestionsCache.get(cacheKey) as string[];
  }

  const suggestions: string[] = [hook];
  const hookDef = registry.get(hook);

  if (!hookDef || !hookDef.pattern) {
    suggestionsCache.set(cacheKey, suggestions);
    return suggestions;
  }

  // Build suggestions from pattern
  // Pattern format: 'node__[bundle]__[view_mode]'
  const pattern = hookDef.pattern;
  const parts = pattern.split('__');
  const baseParts: string[] = [];

  for (const part of parts) {
    if (part.startsWith('[') && part.endsWith(']')) {
      const varName = part.slice(1, -1);
      const value = getVariableValue(variables, varName);

      if (value) {
        baseParts.push(sanitizeSuggestion(value));
        suggestions.unshift(baseParts.join('--'));
      }
    } else {
      baseParts.push(part);
    }
  }

  // Add entity ID suggestion if available
  const nodeVal = variables.node as { id?: unknown } | undefined;
  const nodeId = nodeVal?.id ?? (variables as { id?: unknown }).id;
  if (nodeId !== undefined && nodeId !== null) {
    suggestions.splice(1, 0, `${hook}--${String(nodeId)}`);
  }

  suggestionsCache.set(cacheKey, suggestions);
  return suggestions;
}

/**
 * Get variable value from variables object
 * Supports nested paths (e.g., 'node.type')
 */
function getVariableValue(variables: ThemeVariables, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = variables;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return null;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Sanitize suggestion string for use in template name
 */
function sanitizeSuggestion(str: unknown): string {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Add a suggestion to a hook
 * Used by modules to add custom suggestions
 */
export function addSuggestion(hook: string, suggestion: string): void {
  // This would be called during render to dynamically add suggestions
  // For now, suggestions are generated via patterns
}

/**
 * Load template file
 */
export function loadTemplate(name: string): string | null {
  if (!activeTheme) {
    throw new Error('Theme system not initialized');
  }

  // Check cache first
  if (templateCache.has(name)) {
    return templateCache.get(name) as string;
  }

  // Convert underscores to hyphens for file name
  const fileName = name.replace(/_/g, '-') + '.html';
  const templatePath = join(activeTheme.path, 'templates', fileName);

  if (!existsSync(templatePath)) {
    return null;
  }

  const content = readFileSync(templatePath, 'utf-8');
  templateCache.set(name, content);

  return content;
}

/**
 * Render a template with variables
 */
export function renderTemplate(template: string, variables: ThemeVariables): string {
  return renderString(template, variables);
}

/**
 * Render a theme hook
 * Main entry point for theme rendering
 *
 * @example
 * theme('node', { node: { title: 'Hello', body: '...' }, view_mode: 'full' })
 */
export function theme(hook: string, variables: ThemeVariables = {}): string {
  const hookDef = registry.get(hook);

  if (!hookDef) {
    console.warn(`Unknown theme hook: ${hook}`);
    return '';
  }

  // Merge with default variables
  const vars: ThemeVariables = { ...hookDef.variables, ...variables };

  // Run preprocess functions
  const preprocessed = preprocess(hook, vars);

  // Get template suggestions
  const suggestions = getThemeSuggestions(hook, preprocessed);

  // Try each suggestion until we find a template
  let template: string | null = null;
  let usedSuggestion: string | null = null;

  for (const suggestion of suggestions) {
    template = loadTemplate(suggestion);
    if (template) {
      usedSuggestion = suggestion;
      break;
    }
  }

  if (!template) {
    console.warn(`No template found for hook: ${hook} (tried: ${suggestions.join(', ')})`);
    return renderFallback(hook, preprocessed);
  }

  // Add theme metadata to variables
  preprocessed._theme = {
    hook,
    suggestion: usedSuggestion,
    theme: activeTheme ? activeTheme.name : null,
  };

  // Render template
  try {
    return renderTemplate(template, preprocessed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error rendering ${hook}: ${message}`);
    return renderFallback(hook, preprocessed);
  }
}

/**
 * Alias for theme() to match Drupal naming
 */
export function render(hook: string, variables: ThemeVariables = {}): string {
  return theme(hook, variables);
}

/**
 * Render a render array
 * Processes structured render arrays into HTML
 *
 * @example
 * renderElement({
 *   '#theme': 'item_list',
 *   '#items': ['One', 'Two', 'Three'],
 *   '#title': 'My List'
 * })
 */
export function renderElement(element: unknown): string {
  if (!element || typeof element !== 'object') {
    return String(element || '');
  }

  // Already rendered
  if (typeof element === 'string') {
    return element;
  }

  // Array of elements
  if (Array.isArray(element)) {
    return element.map(renderElement).join('');
  }

  const el = element as RenderElement;

  // Extract theme and variables
  const { '#theme': hook, ...rest } = el;

  if (!hook) {
    // No theme - render children
    const children: string[] = [];
    for (const [key, value] of Object.entries(rest)) {
      if (!key.startsWith('#')) {
        children.push(renderElement(value));
      }
    }
    return children.join('');
  }

  // Convert #property format to variables
  const variables: ThemeVariables = {};
  for (const [key, value] of Object.entries(rest)) {
    if (key.startsWith('#')) {
      const varName = key.slice(1);
      variables[varName] = value;
    }
  }

  // Render using theme hook
  return theme(String(hook), variables);
}

/**
 * Fallback rendering when no template found
 */
function renderFallback(hook: string, variables: ThemeVariables): string {
  // Render children if available
  if (variables.children !== undefined && variables.children !== null) {
    return String(variables.children);
  }

  if (variables.content !== undefined && variables.content !== null) {
    return typeof variables.content === 'object'
      ? renderElement(variables.content)
      : String(variables.content);
  }

  // Last resort: JSON dump
  return `<!-- Fallback render for ${hook} -->\n<pre>${escapeHtml(JSON.stringify(variables, null, 2))}</pre>`;
}

/**
 * Clear all caches
 */
export function clearCache(): void {
  templateCache.clear();
  suggestionsCache.clear();
  attachedLibraries.clear();
}

/**
 * Clear template cache only
 */
export function clearTemplateCache(): void {
  templateCache.clear();
}

/**
 * Discover and register asset libraries from theme
 */
function discoverLibraries(): void {
  if (!activeTheme || !activeTheme.info.libraries) {
    return;
  }

  for (const [name, lib] of Object.entries(activeTheme.info.libraries)) {
    libraries.set(name, {
      css: lib.css || [],
      js: lib.js || [],
      dependencies: lib.dependencies || [],
    });
  }
}

/**
 * Register an asset library
 */
export function registerLibrary(name: string, definition: LibraryDefinitionInput): void {
  libraries.set(name, {
    css: definition.css || [],
    js: definition.js || [],
    dependencies: definition.dependencies || [],
  });
}

/**
 * Attach a library to the current page
 */
export function attachLibrary(name: string): void {
  if (!libraries.has(name)) {
    console.warn(`Unknown library: ${name}`);
    return;
  }

  const lib = libraries.get(name) as LibraryDefinition;

  // Attach dependencies first
  for (const dep of lib.dependencies) {
    attachLibrary(dep);
  }

  attachedLibraries.add(name);
}

/**
 * Get attached libraries for current page
 */
export function getAttachedLibraries(): Set<string> {
  return attachedLibraries;
}

/**
 * Get CSS files from attached libraries
 */
export function getAttachedCss(): string[] {
  const css: string[] = [];

  for (const name of attachedLibraries) {
    const lib = libraries.get(name);
    if (lib && lib.css) {
      css.push(...lib.css);
    }
  }

  return css;
}

/**
 * Get JS files from attached libraries
 */
export function getAttachedJs(): string[] {
  const js: string[] = [];

  for (const name of attachedLibraries) {
    const lib = libraries.get(name);
    if (lib && lib.js) {
      js.push(...lib.js);
    }
  }

  return js;
}

/**
 * Reset attached libraries (call at start of each request)
 */
export function resetAttachedLibraries(): void {
  attachedLibraries.clear();
}

/**
 * Build HTML link tag for CSS file
 */
export function buildCssTag(href: string): string {
  return `<link rel="stylesheet" href="${escapeHtml(href)}">`;
}

/**
 * Build HTML script tag for JS file
 */
export function buildJsTag(src: string, options: JsTagOptions = {}): string {
  const attrs: string[] = [];

  if (options.async) attrs.push('async');
  if (options.defer) attrs.push('defer');
  if (options.module) attrs.push('type="module"');

  const attrStr = attrs.length ? ' ' + attrs.join(' ') : '';

  return `<script src="${escapeHtml(src)}"${attrStr}></script>`;
}

/**
 * Render HTML head with attached assets
 */
export function renderHead(options: RenderHeadOptions = {}): string {
  const { title = '', meta = [] } = options;

  const parts: string[] = [];

  // Title
  if (title) {
    parts.push(`<title>${escapeHtml(title)}</title>`);
  }

  // Meta tags
  for (const tag of meta) {
    if (tag.charset) {
      parts.push(`<meta charset="${escapeHtml(tag.charset)}">`);
    } else if (tag.name && tag.content) {
      parts.push(`<meta name="${escapeHtml(tag.name)}" content="${escapeHtml(tag.content)}">`);
    } else if (tag.property && tag.content) {
      parts.push(`<meta property="${escapeHtml(tag.property)}" content="${escapeHtml(tag.content)}">`);
    }
  }

  // CSS
  for (const href of getAttachedCss()) {
    parts.push(buildCssTag(href));
  }

  // JS (in head if specified)
  const headJs = options.js || [];
  for (const src of headJs) {
    parts.push(buildJsTag(src, { defer: true }));
  }

  return parts.join('\n  ');
}

/**
 * Render attributes object as HTML attribute string
 *
 * @example
 * renderAttributes({ class: ['btn', 'btn-primary'], id: 'submit' })
 * // Returns: 'class="btn btn-primary" id="submit"'
 */
export function renderAttributes(attributes: Record<string, unknown> = {}): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) {
      continue;
    }

    if (value === true) {
      parts.push(key);
      continue;
    }

    if (Array.isArray(value)) {
      const joined = value.filter(Boolean).join(' ');
      if (joined) {
        parts.push(`${key}="${escapeHtml(joined)}"`);
      }
    } else {
      parts.push(`${key}="${escapeHtml(String(value))}"`);
    }
  }

  return parts.join(' ');
}

/**
 * Build CSS classes array from various inputs
 *
 * @example
 * buildClasses('btn', ['btn-primary'], { active: true, disabled: false })
 * // Returns: ['btn', 'btn-primary', 'active']
 */
export function buildClasses(...args: unknown[]): string[] {
  const classes: string[] = [];

  for (const arg of args) {
    if (!arg) continue;

    if (typeof arg === 'string') {
      classes.push(arg);
    } else if (Array.isArray(arg)) {
      classes.push(...(arg.filter(Boolean) as string[]));
    } else if (typeof arg === 'object') {
      for (const [key, value] of Object.entries(arg as Record<string, unknown>)) {
        if (value) classes.push(key);
      }
    }
  }

  return classes;
}

/**
 * Get theme setting value
 */
export function getThemeSetting(key: string, defaultValue: unknown = null): unknown {
  if (!activeTheme || !activeTheme.info.settings) {
    return defaultValue;
  }

  return activeTheme.info.settings[key] ?? defaultValue;
}

/**
 * Check if theme has a specific feature
 */
export function hasThemeFeature(feature: string): boolean {
  if (!activeTheme || !activeTheme.info.features) {
    return false;
  }

  return activeTheme.info.features.includes(feature);
}

/**
 * TEMPLATE HELPER FUNCTIONS
 * These can be called from templates via variables
 */

/**
 * Format a date/time timestamp
 */
export function formatDate(timestamp: number, format: string = 'medium'): string {
  const date = new Date(timestamp * 1000);

  const presets: Record<string, Intl.DateTimeFormatOptions> = {
    short: { dateStyle: 'short', timeStyle: 'short' },
    medium: { dateStyle: 'medium', timeStyle: 'short' },
    long: { dateStyle: 'long', timeStyle: 'medium' },
    full: { dateStyle: 'full', timeStyle: 'long' },
  };

  const options = presets[format] || presets.medium;

  return new Intl.DateTimeFormat('en', options).format(date);
}

/**
 * Truncate text to a specific length
 */
export function truncate(text: string, length: number = 100, suffix: string = '...'): string {
  if (!text || text.length <= length) {
    return text;
  }

  return text.slice(0, length - suffix.length) + suffix;
}

/**
 * Pluralize a word based on count
 */
export function pluralize(count: number, singular: string, plural: string | null = null): string {
  if (count === 1) {
    return singular;
  }

  return plural || singular + 's';
}

/**
 * Safe JSON encode for templates
 */
export function jsonEncode(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch (err) {
    return '{}';
  }
}

/**
 * CORE TEMPLATE IMPLEMENTATIONS
 * Default templates for core hooks (used when theme doesn't provide them)
 */

const FALLBACK_TEMPLATES: Record<string, string> = {
  'item-list': `
{{#if title}}<h3>{{title}}</h3>{{/if}}
<{{list_type}}{{#if attributes}} {{attributes}}{{/if}}>
  {{#each items}}
  <li>{{this}}</li>
  {{/each}}
</{{list_type}}>`,

  link: `<a href="{{url}}"{{#if attributes}} {{attributes}}{{/if}}>{{title}}</a>`,

  image: `<img src="{{uri}}" alt="{{alt}}"{{#if title}} title="{{title}}"{{/if}}{{#if attributes}} {{attributes}}{{/if}}>`,

  time: `<time datetime="{{timestamp}}"{{#if attributes}} {{attributes}}{{/if}}>{{text}}</time>`,

  container: `<div{{#if attributes}} {{attributes}}{{/if}}>{{children}}</div>`,

  'html-tag': `<{{tag}}{{#if attributes}} {{attributes}}{{/if}}>{{value}}</{{tag}}>`,
};

/**
 * Get fallback template content
 */
function getFallbackTemplate(name: string): string | null {
  return FALLBACK_TEMPLATES[name] || null;
}

/**
 * Override loadTemplate to check fallbacks
 */
const originalLoadTemplate = loadTemplate;
export { originalLoadTemplate as _loadTemplate };

// Re-export with fallback check
export function loadTemplateWithFallback(name: string): string | null {
  let template = originalLoadTemplate(name);

  if (!template) {
    template = getFallbackTemplate(name);
    if (template) {
      templateCache.set(name, template);
    }
  }

  return template;
}

/**
 * Export all for external use
 */
export default {
  init,
  theme,
  render,
  renderElement,
  getThemeRegistry,
  registerThemeHook,
  getThemeSuggestions,
  addSuggestion,
  preprocess,
  addPreprocessFunction,
  loadTemplate,
  renderTemplate,
  setActiveTheme,
  getActiveTheme,
  rebuildRegistry,
  clearCache,
  clearTemplateCache,
  registerLibrary,
  attachLibrary,
  getAttachedLibraries,
  getAttachedCss,
  getAttachedJs,
  resetAttachedLibraries,
  renderHead,
  renderAttributes,
  buildClasses,
  buildCssTag,
  buildJsTag,
  getThemeSetting,
  hasThemeFeature,
  setCache,
  // Helpers
  formatDate,
  truncate,
  pluralize,
  jsonEncode,
  escapeHtml,
};
