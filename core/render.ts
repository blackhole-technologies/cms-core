/**
 * Render Array System
 *
 * Drupal's render arrays are nested structures that describe what to render, not how.
 * The renderer walks the tree, applies transformations, and produces HTML.
 *
 * @module core/render
 * @version 1.0.0
 */

import { escapeHtml } from './utils.ts';

// ===========================================
// Types
// ===========================================

/** HTML attributes keyed by attribute name */
interface HtmlAttributes {
  [key: string]: string | boolean | null | undefined | string[] | Record<string, unknown>;
}

/** Attached assets for a render element */
interface AttachedAssets {
  library: Set<string> | string[];
  drupalSettings: Record<string, unknown>;
  html_head: unknown[];
  html_head_link: unknown[];
  http_header: unknown[];
}

/** Cache configuration on a render element */
interface RenderCacheConfig {
  tags?: string[];
  contexts?: string[];
  max_age?: number;
}

/** Cache metadata extracted from a render element */
interface CacheMetadataResult {
  tags: string[];
  contexts: string[];
  maxAge: number | null;
}

/** A render array element -- the fundamental unit of Drupal-style rendering */
interface RenderElement {
  '#type'?: string;
  '#theme'?: string;
  '#theme_wrappers'?: string | string[];
  '#markup'?: string;
  '#plain_text'?: string;
  '#children'?: string;
  '#prefix'?: string;
  '#suffix'?: string;
  '#printed'?: boolean;
  '#access'?: boolean;
  '#weight'?: number;
  '#cache'?: RenderCacheConfig;
  '#attached'?: Partial<AttachedAssets>;
  '#pre_render'?: Array<(element: RenderElement, context: RenderContext) => RenderElement | void>;
  '#post_render'?: Array<(html: string, element: RenderElement, context: RenderContext) => string | void>;
  '#attributes'?: HtmlAttributes;
  '#title'?: string;
  '#open'?: boolean;
  '#items'?: Array<string | { value?: string; attributes?: HtmlAttributes }>;
  '#list_type'?: string;
  '#header'?: Array<string | { data?: string; attributes?: HtmlAttributes }>;
  /** Table rows (array) or textarea rows (number) */
  '#rows'?: Array<{ data?: unknown[]; attributes?: HtmlAttributes } | unknown[]> | number;
  '#caption'?: string;
  '#action'?: string;
  '#method'?: string;
  '#name'?: string;
  '#input_type'?: string;
  '#default_value'?: unknown;
  '#value'?: unknown;
  '#required'?: boolean;
  '#options'?: Record<string, string>;
  '#multiple'?: boolean;
  '#return_value'?: string;
  '#checked'?: boolean;
  '#button_type'?: string;
  '#tag'?: string;
  '#url'?: string;
  '#template'?: string;
  '#context'?: Record<string, unknown>;
  '#text'?: string;
  '#format'?: string;
  '#label'?: string;
  '#label_display'?: string;
  '#cols'?: number;
  [key: string]: unknown;
}

/** A render function that takes an element and context and produces HTML */
type RenderFunction = (element: RenderElement, context: RenderContext) => string;

/** The result of renderRoot including cache metadata */
interface RenderRootResult {
  html: string;
  cacheTags: string[];
  cacheContexts: string[];
  cacheMaxAge: number | null;
  attachedAssets: {
    library: string[];
    drupalSettings: Record<string, unknown>;
    html_head: unknown[];
    html_head_link: unknown[];
    http_header: unknown[];
  };
}

/**
 * Render context - tracks metadata during render process
 */
class RenderContext {
  cacheTags: Set<string>;
  cacheContexts: Set<string>;
  cacheMaxAge: number | null;
  attachedAssets: {
    library: Set<string>;
    drupalSettings: Record<string, unknown>;
    html_head: unknown[];
    html_head_link: unknown[];
    http_header: unknown[];
  };

  constructor() {
    this.cacheTags = new Set();
    this.cacheContexts = new Set();
    this.cacheMaxAge = null;
    this.attachedAssets = {
      library: new Set(),
      drupalSettings: {},
      html_head: [],
      html_head_link: [],
      http_header: []
    };
  }

  /**
   * Merge another context into this one
   */
  merge(other: Partial<RenderContext> | null): void {
    if (!other) return;

    if (other.cacheTags) {
      other.cacheTags.forEach(tag => this.cacheTags.add(tag));
    }

    if (other.cacheContexts) {
      other.cacheContexts.forEach(ctx => this.cacheContexts.add(ctx));
    }

    if (other.cacheMaxAge !== null && other.cacheMaxAge !== undefined) {
      if (this.cacheMaxAge === null) {
        this.cacheMaxAge = other.cacheMaxAge;
      } else {
        this.cacheMaxAge = Math.min(this.cacheMaxAge, other.cacheMaxAge);
      }
    }

    if (other.attachedAssets) {
      const assets = other.attachedAssets;
      if (assets.library) {
        assets.library.forEach(lib => this.attachedAssets.library.add(lib));
      }
      if (assets.drupalSettings) {
        Object.assign(this.attachedAssets.drupalSettings, assets.drupalSettings);
      }
      (['html_head', 'html_head_link', 'http_header'] as const).forEach(key => {
        if (assets[key]) {
          this.attachedAssets[key].push(...assets[key]);
        }
      });
    }
  }
}

/**
 * Registered element types
 * Maps type name to render function
 */
const elementTypes: Map<string, RenderFunction> = new Map();

/**
 * Registered theme hooks
 * Maps theme name to render function
 */
const themeRegistry: Map<string, RenderFunction> = new Map();

/**
 * Main render function - converts render array to HTML
 *
 * @param element - Render array element
 * @param context - Optional render context
 * @returns Rendered HTML
 */
export function render(element: RenderElement | null | undefined, context: RenderContext | null = null): string {
  if (!element || typeof element !== 'object') {
    return '';
  }

  const ctx = context || new RenderContext();
  const html = doRender(element, ctx);

  return html;
}

/**
 * Render with full page context
 * Includes cache metadata and attached assets in result
 *
 * @param element - Render array element
 * @returns Object with html and context metadata
 */
export function renderRoot(element: RenderElement): RenderRootResult {
  const context = new RenderContext();
  const html = render(element, context);

  return {
    html,
    cacheTags: Array.from(context.cacheTags),
    cacheContexts: Array.from(context.cacheContexts),
    cacheMaxAge: context.cacheMaxAge,
    attachedAssets: {
      library: Array.from(context.attachedAssets.library),
      drupalSettings: context.attachedAssets.drupalSettings,
      html_head: context.attachedAssets.html_head,
      html_head_link: context.attachedAssets.html_head_link,
      http_header: context.attachedAssets.http_header
    }
  };
}

/**
 * Render without theme layer
 * Used for AJAX responses and similar
 *
 * @param element - Render array element
 * @returns Rendered HTML
 */
export function renderPlain(element: RenderElement | null | undefined): string {
  if (!element || typeof element !== 'object') {
    return '';
  }

  // Clone and remove theme
  const plain = { ...element };
  delete plain['#theme'];
  delete plain['#theme_wrappers'];

  return render(plain);
}

/**
 * Process element - apply pre_render and post_render callbacks
 *
 * @param element - Render array element
 * @param context - Render context
 * @returns Processed element
 */
export function processElement(element: RenderElement | null, context: RenderContext): RenderElement | null {
  if (!element || element['#printed']) {
    return element;
  }

  // Apply pre_render callbacks
  if (element['#pre_render']) {
    const callbacks = Array.isArray(element['#pre_render'])
      ? element['#pre_render']
      : [element['#pre_render']];

    for (const callback of callbacks) {
      if (typeof callback === 'function') {
        element = callback(element, context) || element;
      }
    }
  }

  return element;
}

/**
 * Apply post-render callbacks
 *
 * @param html - Rendered HTML
 * @param element - Original element
 * @param context - Render context
 * @returns Processed HTML
 */
function applyPostRender(html: string, element: RenderElement, context: RenderContext): string {
  if (!element['#post_render']) {
    return html;
  }

  const callbacks = Array.isArray(element['#post_render'])
    ? element['#post_render']
    : [element['#post_render']];

  for (const callback of callbacks) {
    if (typeof callback === 'function') {
      html = callback(html, element, context) || html;
    }
  }

  return html;
}

/**
 * Sort children by #weight property
 *
 * @param element - Render array element
 * @returns Sorted child keys
 */
export function sortChildren(element: RenderElement | null | undefined): string[] {
  if (!element || typeof element !== 'object') {
    return [];
  }

  const children: Array<{ key: string; weight: number }> = [];

  for (const key in element) {
    // Skip properties that start with #
    if (key.startsWith('#')) continue;

    const child = element[key];
    if (child && typeof child === 'object') {
      children.push({
        key,
        weight: (child as RenderElement)['#weight'] || 0
      });
    }
  }

  // Sort by weight, then by key for stability
  children.sort((a, b) => {
    if (a.weight !== b.weight) {
      return a.weight - b.weight;
    }
    return a.key.localeCompare(b.key);
  });

  return children.map(c => c.key);
}

/**
 * Extract cache metadata from element
 *
 * @param element - Render array element
 * @returns Cache metadata
 */
export function getCacheMetadata(element: RenderElement | null | undefined): CacheMetadataResult {
  if (!element || typeof element !== 'object') {
    return { tags: [], contexts: [], maxAge: null };
  }

  const cache = element['#cache'] || {};

  return {
    tags: cache.tags || [],
    contexts: cache.contexts || [],
    maxAge: cache.max_age !== undefined ? cache.max_age : null
  };
}

/**
 * Bubble cache metadata from element to context
 *
 * @param element - Render array element
 * @param context - Render context
 */
function bubbleCacheMetadata(element: RenderElement | null, context: RenderContext): void {
  if (!element || !context) return;

  const cache = getCacheMetadata(element);

  cache.tags.forEach(tag => context.cacheTags.add(tag));
  cache.contexts.forEach(ctx => context.cacheContexts.add(ctx));

  if (cache.maxAge !== null) {
    if (context.cacheMaxAge === null) {
      context.cacheMaxAge = cache.maxAge;
    } else {
      context.cacheMaxAge = Math.min(context.cacheMaxAge, cache.maxAge);
    }
  }
}

/**
 * Bubble attached assets from element to context
 *
 * @param element - Render array element
 * @param context - Render context
 */
function bubbleAttachedAssets(element: RenderElement | null, context: RenderContext): void {
  if (!element || !context) return;

  const attached = element['#attached'] as Partial<AttachedAssets> | undefined;
  if (!attached) return;

  if (attached.library) {
    const libs = Array.isArray(attached.library) ? attached.library : [attached.library];
    (libs as string[]).forEach(lib => context.attachedAssets.library.add(lib));
  }

  if (attached.drupalSettings) {
    Object.assign(context.attachedAssets.drupalSettings, attached.drupalSettings);
  }

  (['html_head', 'html_head_link', 'http_header'] as const).forEach(key => {
    if (attached[key]) {
      const items = Array.isArray(attached[key]) ? attached[key] : [attached[key]];
      context.attachedAssets[key].push(...(items as unknown[]));
    }
  });
}

/**
 * Internal recursive render function
 *
 * @param element - Render array element
 * @param context - Render context
 * @returns Rendered HTML
 */
export function doRender(element: RenderElement | string | number | null | undefined, context: RenderContext): string {
  // Handle non-objects
  if (!element || typeof element !== 'object') {
    if (typeof element === 'string') return element;
    if (typeof element === 'number') return String(element);
    return '';
  }

  const el = element as RenderElement;

  // Skip if already printed
  if (el['#printed']) {
    return '';
  }

  // Check access
  if (el['#access'] === false) {
    return '';
  }

  // Bubble cache metadata
  bubbleCacheMetadata(el, context);

  // Bubble attached assets
  bubbleAttachedAssets(el, context);

  // Process element (pre_render)
  const processed = processElement(el, context);
  if (!processed) return '';

  // If element has pre-rendered children, use them
  if (processed['#children'] !== undefined) {
    let html = processed['#children'] as string;

    // Apply prefix/suffix
    if (processed['#prefix']) html = (processed['#prefix'] as string) + html;
    if (processed['#suffix']) html = html + (processed['#suffix'] as string);

    // Apply post_render
    html = applyPostRender(html, processed, context);

    return html;
  }

  let html = '';

  // Render by theme hook
  if (processed['#theme']) {
    html = renderTheme(processed, context);
  }
  // Render by type
  else if (processed['#type']) {
    html = renderType(processed, context);
  }
  // Render markup
  else if (processed['#markup'] !== undefined) {
    html = processed['#markup'] as string;
  }
  // Render plain text
  else if (processed['#plain_text'] !== undefined) {
    html = escapeHtml(processed['#plain_text'] as string);
  }
  // Render children only
  else {
    html = renderChildren(processed, context);
  }

  // Apply prefix/suffix
  if (processed['#prefix']) html = (processed['#prefix'] as string) + html;
  if (processed['#suffix']) html = html + (processed['#suffix'] as string);

  // Apply theme wrappers
  if (processed['#theme_wrappers']) {
    html = applyThemeWrappers(html, processed, context);
  }

  // Apply post_render callbacks
  html = applyPostRender(html, processed, context);

  return html;
}

/**
 * Render children of element
 *
 * @param element - Render array element
 * @param context - Render context
 * @returns Rendered children HTML
 */
export function renderChildren(element: RenderElement | null | undefined, context: RenderContext): string {
  if (!element || typeof element !== 'object') {
    return '';
  }

  const childKeys = sortChildren(element);
  const parts: string[] = [];

  for (const key of childKeys) {
    const child = element[key] as RenderElement;
    const childHtml = doRender(child, context);
    if (childHtml) {
      parts.push(childHtml);
    }
  }

  return parts.join('');
}

/**
 * Render element using theme hook
 *
 * @param element - Render array element
 * @param context - Render context
 * @returns Rendered HTML
 */
function renderTheme(element: RenderElement, context: RenderContext): string {
  const theme = element['#theme'] as string;

  if (!themeRegistry.has(theme)) {
    console.warn(`Theme hook '${theme}' not registered`);
    return renderChildren(element, context);
  }

  const themeFunc = themeRegistry.get(theme)!;
  return themeFunc(element, context);
}

/**
 * Render element using type
 *
 * @param element - Render array element
 * @param context - Render context
 * @returns Rendered HTML
 */
function renderType(element: RenderElement, context: RenderContext): string {
  const type = element['#type'] as string;

  if (!elementTypes.has(type)) {
    console.warn(`Element type '${type}' not registered`);
    return renderChildren(element, context);
  }

  const typeFunc = elementTypes.get(type)!;
  return typeFunc(element, context);
}

/**
 * Apply theme wrappers around rendered content
 *
 * @param html - Inner HTML
 * @param element - Render array element
 * @param context - Render context
 * @returns Wrapped HTML
 */
function applyThemeWrappers(html: string, element: RenderElement, context: RenderContext): string {
  const wrappers = Array.isArray(element['#theme_wrappers'])
    ? element['#theme_wrappers']
    : [element['#theme_wrappers'] as string];

  for (const wrapper of wrappers) {
    if (themeRegistry.has(wrapper)) {
      const wrapperFunc = themeRegistry.get(wrapper)!;
      const wrapperElement: RenderElement = { ...element, '#children': html };
      html = wrapperFunc(wrapperElement, context);
    }
  }

  return html;
}

/**
 * Build HTML attributes string from attributes array
 *
 * @param attributes - Attributes object
 * @returns HTML attributes string
 */
function buildAttributes(attributes: HtmlAttributes | null | undefined): string {
  if (!attributes || typeof attributes !== 'object') {
    return '';
  }

  const parts: string[] = [];

  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) {
      continue;
    }

    // Handle boolean attributes
    if (value === true) {
      parts.push(escapeHtml(key));
      continue;
    }

    // Handle array values (like class)
    if (Array.isArray(value)) {
      const joined = (value as string[]).filter(v => v).join(' ');
      if (joined) {
        parts.push(`${escapeHtml(key)}="${escapeHtml(joined)}"`);
      }
      continue;
    }

    // Handle object values (convert to JSON for data attributes)
    if (typeof value === 'object') {
      parts.push(`${escapeHtml(key)}='${escapeHtml(JSON.stringify(value))}'`);
      continue;
    }

    parts.push(`${escapeHtml(key)}="${escapeHtml(String(value))}"`);
  }

  return parts.length > 0 ? ' ' + parts.join(' ') : '';
}

/**
 * Register element type renderer
 *
 * @param type - Element type name
 * @param renderer - Render function
 */
export function registerElementType(type: string, renderer: RenderFunction): void {
  if (typeof renderer !== 'function') {
    throw new TypeError('Renderer must be a function');
  }
  elementTypes.set(type, renderer);
}

/**
 * Register theme hook
 *
 * @param hook - Theme hook name
 * @param renderer - Render function
 */
export function registerTheme(hook: string, renderer: RenderFunction): void {
  if (typeof renderer !== 'function') {
    throw new TypeError('Renderer must be a function');
  }
  themeRegistry.set(hook, renderer);
}

/**
 * Unregister element type
 *
 * @param type - Element type name
 */
export function unregisterElementType(type: string): void {
  elementTypes.delete(type);
}

/**
 * Unregister theme hook
 *
 * @param hook - Theme hook name
 */
export function unregisterTheme(hook: string): void {
  themeRegistry.delete(hook);
}

// ============================================================================
// Built-in Element Types
// ============================================================================

/**
 * Markup element - raw HTML
 */
registerElementType('markup', (element: RenderElement, context: RenderContext): string => {
  let html = (element['#markup'] as string) || '';

  // Render children if present
  const children = renderChildren(element, context);
  if (children) {
    html += children;
  }

  return html;
});

/**
 * Plain text element - escaped text
 */
registerElementType('plain_text', (element: RenderElement, _context: RenderContext): string => {
  return escapeHtml((element['#plain_text'] as string) || '');
});

/**
 * Container element - div wrapper
 */
registerElementType('container', (element: RenderElement, context: RenderContext): string => {
  const attributes = (element['#attributes'] as HtmlAttributes) || {};
  const attrString = buildAttributes(attributes);

  const children = renderChildren(element, context);

  if (!children && element['#markup'] === undefined && element['#plain_text'] === undefined) {
    return '';
  }

  let content = children;
  if (element['#markup']) content += element['#markup'] as string;
  if (element['#plain_text']) content += escapeHtml(element['#plain_text'] as string);

  return `<div${attrString}>${content}</div>`;
});

/**
 * HTML tag element - arbitrary HTML tag
 */
registerElementType('html_tag', (element: RenderElement, context: RenderContext): string => {
  const tag = (element['#tag'] as string) || 'div';
  const attributes = (element['#attributes'] as HtmlAttributes) || {};
  const attrString = buildAttributes(attributes);

  // Self-closing tags
  const voidElements = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr'
  ]);

  if (voidElements.has(tag)) {
    return `<${tag}${attrString}>`;
  }

  let content = '';
  if (element['#value'] !== undefined) {
    content = element['#value'] as string;
  } else {
    content = renderChildren(element, context);
  }

  return `<${tag}${attrString}>${content}</${tag}>`;
});

/**
 * Link element - anchor tag
 */
registerElementType('link', (element: RenderElement, _context: RenderContext): string => {
  const url = (element['#url'] as string) || '#';
  const title = (element['#title'] as string) || '';
  const attributes = (element['#attributes'] as HtmlAttributes) || {};

  // Merge href into attributes
  const linkAttrs: HtmlAttributes = { ...attributes, href: url };
  const attrString = buildAttributes(linkAttrs);

  return `<a${attrString}>${escapeHtml(title)}</a>`;
});

/**
 * Inline template element - simple template string
 */
registerElementType('inline_template', (element: RenderElement, _context: RenderContext): string => {
  const tmpl = (element['#template'] as string) || '';
  const contextData = (element['#context'] as Record<string, unknown>) || {};

  // Simple template replacement: {{ variable }}
  let html = tmpl;
  for (const [key, value] of Object.entries(contextData)) {
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    html = html.replace(regex, escapeHtml(String(value)));
  }

  return html;
});

/**
 * Processed text element - text with format applied
 */
registerElementType('processed_text', (element: RenderElement, _context: RenderContext): string => {
  const text = (element['#text'] as string) || '';
  const format = (element['#format'] as string) || 'plain_text';

  // For now, just support plain_text and basic_html
  if (format === 'plain_text') {
    // Convert line breaks to <br>, escape HTML
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  if (format === 'basic_html') {
    // Allow basic HTML, sanitize dangerous tags
    return sanitizeHtml(text);
  }

  // Full HTML - passthrough (WARNING: only use with trusted input)
  return text;
});

/**
 * Details element - collapsible fieldset
 */
registerElementType('details', (element: RenderElement, context: RenderContext): string => {
  const attributes = (element['#attributes'] as HtmlAttributes) || {};
  const attrString = buildAttributes(attributes);
  const title = (element['#title'] as string) || '';
  const open = element['#open'] ? ' open' : '';

  const children = renderChildren(element, context);

  return `<details${attrString}${open}>
  <summary>${escapeHtml(title)}</summary>
  ${children}
</details>`;
});

/**
 * Item list element - ul or ol list
 */
registerElementType('item_list', (element: RenderElement, _context: RenderContext): string => {
  const items = (element['#items'] as Array<string | { value?: string; attributes?: HtmlAttributes }>) || [];
  const listType = (element['#list_type'] as string) || 'ul';
  const attributes = (element['#attributes'] as HtmlAttributes) || {};
  const title = element['#title'] as string | undefined;
  const attrString = buildAttributes(attributes);

  if (items.length === 0) {
    return '';
  }

  const itemsHtml = items.map(item => {
    if (typeof item === 'string') {
      return `  <li>${escapeHtml(item)}</li>`;
    }
    if (typeof item === 'object') {
      const itemAttrs = buildAttributes(item.attributes || {});
      const value = item.value || '';
      return `  <li${itemAttrs}>${escapeHtml(value)}</li>`;
    }
    return '';
  }).join('\n');

  let html = '';
  if (title) {
    html += `<h3>${escapeHtml(title)}</h3>\n`;
  }
  html += `<${listType}${attrString}>\n${itemsHtml}\n</${listType}>`;

  return html;
});

/**
 * Table element - HTML table
 */
registerElementType('table', (element: RenderElement, _context: RenderContext): string => {
  const header = (element['#header'] as Array<string | { data?: string; attributes?: HtmlAttributes }>) || [];
  const rows = (element['#rows'] as Array<{ data?: unknown[]; attributes?: HtmlAttributes } | unknown[]>) || [];
  const attributes = (element['#attributes'] as HtmlAttributes) || {};
  const attrString = buildAttributes(attributes);
  const caption = element['#caption'] as string | undefined;

  let html = `<table${attrString}>`;

  if (caption) {
    html += `\n  <caption>${escapeHtml(caption)}</caption>`;
  }

  if (header.length > 0) {
    html += '\n  <thead>\n    <tr>';
    header.forEach(cell => {
      const cellObj = cell as { data?: string; attributes?: HtmlAttributes };
      const cellAttrs = buildAttributes(cellObj.attributes || {});
      const content = cellObj.data || cell;
      html += `\n      <th${cellAttrs}>${escapeHtml(String(content))}</th>`;
    });
    html += '\n    </tr>\n  </thead>';
  }

  if (rows.length > 0) {
    html += '\n  <tbody>';
    rows.forEach(row => {
      const rowObj = row as { data?: unknown[]; attributes?: HtmlAttributes };
      const rowAttrs = buildAttributes(rowObj.attributes || {});
      html += `\n    <tr${rowAttrs}>`;

      const cells = rowObj.data || row;
      (Array.isArray(cells) ? cells : [cells]).forEach(cell => {
        const cellObj = cell as { data?: string; attributes?: HtmlAttributes };
        const cellAttrs = buildAttributes(cellObj.attributes || {});
        const content = cellObj.data || cell;
        html += `\n      <td${cellAttrs}>${escapeHtml(String(content))}</td>`;
      });

      html += '\n    </tr>';
    });
    html += '\n  </tbody>';
  }

  html += '\n</table>';

  return html;
});

/**
 * Form element - HTML form
 */
registerElementType('form', (element: RenderElement, context: RenderContext): string => {
  const attributes = (element['#attributes'] as HtmlAttributes) || {};
  const action = (element['#action'] as string) || '';
  const method = (element['#method'] as string) || 'post';

  const formAttrs: HtmlAttributes = {
    ...attributes,
    action,
    method
  };
  const attrString = buildAttributes(formAttrs);

  const children = renderChildren(element, context);

  return `<form${attrString}>\n${children}\n</form>`;
});

/**
 * Textfield element - text input
 */
registerElementType('textfield', (element: RenderElement, _context: RenderContext): string => {
  const attributes = (element['#attributes'] as HtmlAttributes) || {};
  const type = (element['#input_type'] as string) || 'text';
  const name = (element['#name'] as string) || '';
  const value = (element['#default_value'] as string) || (element['#value'] as string) || '';
  const required = element['#required'] ? true : false;

  const inputAttrs: HtmlAttributes = {
    ...attributes,
    type,
    name,
    value,
    required
  };
  const attrString = buildAttributes(inputAttrs);

  return `<input${attrString}>`;
});

/**
 * Textarea element - multiline text input
 */
registerElementType('textarea', (element: RenderElement, _context: RenderContext): string => {
  const attributes = (element['#attributes'] as HtmlAttributes) || {};
  const name = (element['#name'] as string) || '';
  const value = (element['#default_value'] as string) || (element['#value'] as string) || '';
  const required = element['#required'] ? true : false;
  const rows = (element['#rows'] as number) || 5;
  const cols = element['#cols'] as number | undefined;

  const textareaAttrs: HtmlAttributes = {
    ...attributes,
    name,
    required,
    rows: String(rows)
  };
  if (cols) textareaAttrs.cols = String(cols);

  const attrString = buildAttributes(textareaAttrs);

  return `<textarea${attrString}>${escapeHtml(value)}</textarea>`;
});

/**
 * Select element - dropdown
 */
registerElementType('select', (element: RenderElement, _context: RenderContext): string => {
  const attributes = (element['#attributes'] as HtmlAttributes) || {};
  const name = (element['#name'] as string) || '';
  const options = (element['#options'] as Record<string, string>) || {};
  const value = (element['#default_value'] as string) || (element['#value'] as string);
  const required = element['#required'] ? true : false;
  const multiple = element['#multiple'] ? true : false;

  const selectAttrs: HtmlAttributes = {
    ...attributes,
    name,
    required,
    multiple
  };
  const attrString = buildAttributes(selectAttrs);

  let optionsHtml = '';
  for (const [optValue, optLabel] of Object.entries(options)) {
    const selected = optValue === value ? ' selected' : '';
    optionsHtml += `\n  <option value="${escapeHtml(optValue)}"${selected}>${escapeHtml(optLabel)}</option>`;
  }

  return `<select${attrString}>${optionsHtml}\n</select>`;
});

/**
 * Checkbox element - checkbox input
 */
registerElementType('checkbox', (element: RenderElement, _context: RenderContext): string => {
  const attributes = (element['#attributes'] as HtmlAttributes) || {};
  const name = (element['#name'] as string) || '';
  const value = (element['#return_value'] as string) || '1';
  const checked = element['#default_value'] || element['#checked'] ? true : false;
  const required = element['#required'] ? true : false;

  const inputAttrs: HtmlAttributes = {
    ...attributes,
    type: 'checkbox',
    name,
    value,
    checked,
    required
  };
  const attrString = buildAttributes(inputAttrs);

  return `<input${attrString}>`;
});

/**
 * Radios element - radio button group
 */
registerElementType('radios', (element: RenderElement, _context: RenderContext): string => {
  const name = (element['#name'] as string) || '';
  const options = (element['#options'] as Record<string, string>) || {};
  const value = (element['#default_value'] as string) || (element['#value'] as string);
  const required = element['#required'] ? true : false;

  const radios: string[] = [];
  for (const [optValue, optLabel] of Object.entries(options)) {
    const checked = optValue === value ? ' checked' : '';
    const id = `${name}-${optValue}`;
    radios.push(
      `<div class="radio">
  <input type="radio" id="${escapeHtml(id)}" name="${escapeHtml(name)}" value="${escapeHtml(optValue)}"${checked}${required ? ' required' : ''}>
  <label for="${escapeHtml(id)}">${escapeHtml(optLabel)}</label>
</div>`
    );
  }

  return radios.join('\n');
});

/**
 * Button element - button or submit
 */
registerElementType('button', (element: RenderElement, _context: RenderContext): string => {
  const attributes = (element['#attributes'] as HtmlAttributes) || {};
  const type = (element['#button_type'] as string) || 'button';
  const value = (element['#value'] as string) || 'Submit';
  const name = (element['#name'] as string) || '';

  const buttonAttrs: HtmlAttributes = {
    ...attributes,
    type,
    name
  };
  const attrString = buildAttributes(buttonAttrs);

  return `<button${attrString}>${escapeHtml(value)}</button>`;
});

// ============================================================================
// Theme Functions
// ============================================================================

/**
 * Container theme wrapper
 */
registerTheme('container', (element: RenderElement, context: RenderContext): string => {
  const attributes = (element['#attributes'] as HtmlAttributes) || {};
  const attrString = buildAttributes(attributes);
  const children = (element['#children'] as string) || renderChildren(element, context);

  return `<div${attrString}>${children}</div>`;
});

/**
 * Field theme - renders a field with label
 */
registerTheme('field', (element: RenderElement, context: RenderContext): string => {
  const label = (element['#label'] as string) || '';
  const items = (element['#items'] as unknown[]) || [];
  const attributes = (element['#attributes'] as HtmlAttributes) || {};
  const labelDisplay = (element['#label_display'] as string) || 'above';
  const attrString = buildAttributes(attributes);

  let html = `<div${attrString}>`;

  if (label && labelDisplay !== 'hidden') {
    const labelClass = labelDisplay === 'inline' ? ' class="field-label-inline"' : '';
    html += `\n  <div${labelClass}><strong>${escapeHtml(label)}:</strong></div>`;
  }

  html += '\n  <div class="field-items">';
  items.forEach((item, index) => {
    html += `\n    <div class="field-item field-item-${index}">`;
    html += typeof item === 'string' ? escapeHtml(item) : doRender(item as RenderElement, context);
    html += '</div>';
  });
  html += '\n  </div>';

  html += '\n</div>';

  return html;
});

/**
 * Page theme - full page render
 */
registerTheme('page', (element: RenderElement, context: RenderContext): string => {
  const title = (element['#title'] as string) || '';
  const content = renderChildren(element, context);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
</head>
<body>
  <div class="page">
    <h1 class="page-title">${escapeHtml(title)}</h1>
    <div class="page-content">
      ${content}
    </div>
  </div>
</body>
</html>`;
});

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Basic HTML sanitization
 * Only allows safe tags, strips dangerous attributes
 *
 * @param html - HTML to sanitize
 * @returns Sanitized HTML
 */
function sanitizeHtml(html: string): string {
  // Remove script and style tags entirely
  html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  html = html.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Remove on* event attributes
  html = html.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
  html = html.replace(/\s*on\w+\s*=\s*[^\s>]*/gi, '');

  // Remove javascript: URLs
  html = html.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, '');
  html = html.replace(/src\s*=\s*["']javascript:[^"']*["']/gi, '');

  return html;
}

/**
 * Create a render array element
 * Helper function for building render arrays programmatically
 *
 * @param type - Element type
 * @param properties - Element properties
 * @returns Render array element
 */
export function createElement(type: string, properties: Partial<RenderElement> = {}): RenderElement {
  return {
    '#type': type,
    ...properties
  };
}

/**
 * Clone a render array element deeply
 *
 * @param element - Element to clone
 * @returns Cloned element
 */
export function cloneElement(element: unknown): unknown {
  if (!element || typeof element !== 'object') {
    return element;
  }

  if (Array.isArray(element)) {
    return element.map(cloneElement);
  }

  const cloned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(element as Record<string, unknown>)) {
    cloned[key] = cloneElement(value);
  }

  return cloned;
}

/**
 * Check if element has children
 *
 * @param element - Render array element
 * @returns True if element has children
 */
export function hasChildren(element: RenderElement | null | undefined): boolean {
  if (!element || typeof element !== 'object') {
    return false;
  }

  for (const key in element) {
    if (!key.startsWith('#') && element[key] && typeof element[key] === 'object') {
      return true;
    }
  }

  return false;
}

/**
 * Export render context for testing/debugging
 */
export { RenderContext };
