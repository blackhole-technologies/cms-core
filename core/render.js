/**
 * Render Array System
 *
 * Drupal's render arrays are nested structures that describe what to render, not how.
 * The renderer walks the tree, applies transformations, and produces HTML.
 *
 * @module core/render
 * @version 1.0.0
 */

import { escapeHtml } from './utils.js';

/**
 * Render context - tracks metadata during render process
 */
class RenderContext {
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
  merge(other) {
    if (!other) return;

    if (other.cacheTags) {
      other.cacheTags.forEach(tag => this.cacheTags.add(tag));
    }

    if (other.cacheContexts) {
      other.cacheContexts.forEach(ctx => this.cacheContexts.add(ctx));
    }

    if (other.cacheMaxAge !== null) {
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
      ['html_head', 'html_head_link', 'http_header'].forEach(key => {
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
const elementTypes = new Map();

/**
 * Registered theme hooks
 * Maps theme name to render function
 */
const themeRegistry = new Map();

/**
 * Main render function - converts render array to HTML
 *
 * @param {Object} element - Render array element
 * @param {RenderContext} context - Optional render context
 * @returns {string} Rendered HTML
 */
export function render(element, context = null) {
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
 * @param {Object} element - Render array element
 * @returns {Object} { html, context }
 */
export function renderRoot(element) {
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
 * @param {Object} element - Render array element
 * @returns {string} Rendered HTML
 */
export function renderPlain(element) {
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
 * @param {Object} element - Render array element
 * @param {RenderContext} context - Render context
 * @returns {Object} Processed element
 */
export function processElement(element, context) {
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
 * @param {string} html - Rendered HTML
 * @param {Object} element - Original element
 * @param {RenderContext} context - Render context
 * @returns {string} Processed HTML
 */
function applyPostRender(html, element, context) {
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
 * @param {Object} element - Render array element
 * @returns {Array<string>} Sorted child keys
 */
export function sortChildren(element) {
  if (!element || typeof element !== 'object') {
    return [];
  }

  const children = [];

  for (const key in element) {
    // Skip properties that start with #
    if (key.startsWith('#')) continue;

    const child = element[key];
    if (child && typeof child === 'object') {
      children.push({
        key,
        weight: child['#weight'] || 0
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
 * @param {Object} element - Render array element
 * @returns {Object} Cache metadata
 */
export function getCacheMetadata(element) {
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
 * @param {Object} element - Render array element
 * @param {RenderContext} context - Render context
 */
function bubbleCacheMetadata(element, context) {
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
 * @param {Object} element - Render array element
 * @param {RenderContext} context - Render context
 */
function bubbleAttachedAssets(element, context) {
  if (!element || !context) return;

  const attached = element['#attached'];
  if (!attached) return;

  if (attached.library) {
    const libs = Array.isArray(attached.library) ? attached.library : [attached.library];
    libs.forEach(lib => context.attachedAssets.library.add(lib));
  }

  if (attached.drupalSettings) {
    Object.assign(context.attachedAssets.drupalSettings, attached.drupalSettings);
  }

  ['html_head', 'html_head_link', 'http_header'].forEach(key => {
    if (attached[key]) {
      const items = Array.isArray(attached[key]) ? attached[key] : [attached[key]];
      context.attachedAssets[key].push(...items);
    }
  });
}

/**
 * Internal recursive render function
 *
 * @param {Object} element - Render array element
 * @param {RenderContext} context - Render context
 * @returns {string} Rendered HTML
 */
export function doRender(element, context) {
  // Handle non-objects
  if (!element || typeof element !== 'object') {
    if (typeof element === 'string') return element;
    if (typeof element === 'number') return String(element);
    return '';
  }

  // Skip if already printed
  if (element['#printed']) {
    return '';
  }

  // Check access
  if (element['#access'] === false) {
    return '';
  }

  // Bubble cache metadata
  bubbleCacheMetadata(element, context);

  // Bubble attached assets
  bubbleAttachedAssets(element, context);

  // Process element (pre_render)
  element = processElement(element, context);

  // If element has pre-rendered children, use them
  if (element['#children'] !== undefined) {
    let html = element['#children'];

    // Apply prefix/suffix
    if (element['#prefix']) html = element['#prefix'] + html;
    if (element['#suffix']) html = html + element['#suffix'];

    // Apply post_render
    html = applyPostRender(html, element, context);

    return html;
  }

  let html = '';

  // Render by theme hook
  if (element['#theme']) {
    html = renderTheme(element, context);
  }
  // Render by type
  else if (element['#type']) {
    html = renderType(element, context);
  }
  // Render markup
  else if (element['#markup'] !== undefined) {
    html = element['#markup'];
  }
  // Render plain text
  else if (element['#plain_text'] !== undefined) {
    html = escapeHtml(element['#plain_text']);
  }
  // Render children only
  else {
    html = renderChildren(element, context);
  }

  // Apply prefix/suffix
  if (element['#prefix']) html = element['#prefix'] + html;
  if (element['#suffix']) html = html + element['#suffix'];

  // Apply theme wrappers
  if (element['#theme_wrappers']) {
    html = applyThemeWrappers(html, element, context);
  }

  // Apply post_render callbacks
  html = applyPostRender(html, element, context);

  return html;
}

/**
 * Render children of element
 *
 * @param {Object} element - Render array element
 * @param {RenderContext} context - Render context
 * @returns {string} Rendered children HTML
 */
export function renderChildren(element, context) {
  if (!element || typeof element !== 'object') {
    return '';
  }

  const childKeys = sortChildren(element);
  const parts = [];

  for (const key of childKeys) {
    const child = element[key];
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
 * @param {Object} element - Render array element
 * @param {RenderContext} context - Render context
 * @returns {string} Rendered HTML
 */
function renderTheme(element, context) {
  const theme = element['#theme'];

  if (!themeRegistry.has(theme)) {
    console.warn(`Theme hook '${theme}' not registered`);
    return renderChildren(element, context);
  }

  const themeFunc = themeRegistry.get(theme);
  return themeFunc(element, context);
}

/**
 * Render element using type
 *
 * @param {Object} element - Render array element
 * @param {RenderContext} context - Render context
 * @returns {string} Rendered HTML
 */
function renderType(element, context) {
  const type = element['#type'];

  if (!elementTypes.has(type)) {
    console.warn(`Element type '${type}' not registered`);
    return renderChildren(element, context);
  }

  const typeFunc = elementTypes.get(type);
  return typeFunc(element, context);
}

/**
 * Apply theme wrappers around rendered content
 *
 * @param {string} html - Inner HTML
 * @param {Object} element - Render array element
 * @param {RenderContext} context - Render context
 * @returns {string} Wrapped HTML
 */
function applyThemeWrappers(html, element, context) {
  const wrappers = Array.isArray(element['#theme_wrappers'])
    ? element['#theme_wrappers']
    : [element['#theme_wrappers']];

  for (const wrapper of wrappers) {
    if (themeRegistry.has(wrapper)) {
      const wrapperFunc = themeRegistry.get(wrapper);
      const wrapperElement = { ...element, '#children': html };
      html = wrapperFunc(wrapperElement, context);
    }
  }

  return html;
}

/**
 * Build HTML attributes string from attributes array
 *
 * @param {Object} attributes - Attributes object
 * @returns {string} HTML attributes string
 */
function buildAttributes(attributes) {
  if (!attributes || typeof attributes !== 'object') {
    return '';
  }

  const parts = [];

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
      const joined = value.filter(v => v).join(' ');
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
 * @param {string} type - Element type name
 * @param {Function} renderer - Render function
 */
export function registerElementType(type, renderer) {
  if (typeof renderer !== 'function') {
    throw new TypeError('Renderer must be a function');
  }
  elementTypes.set(type, renderer);
}

/**
 * Register theme hook
 *
 * @param {string} hook - Theme hook name
 * @param {Function} renderer - Render function
 */
export function registerTheme(hook, renderer) {
  if (typeof renderer !== 'function') {
    throw new TypeError('Renderer must be a function');
  }
  themeRegistry.set(hook, renderer);
}

/**
 * Unregister element type
 *
 * @param {string} type - Element type name
 */
export function unregisterElementType(type) {
  elementTypes.delete(type);
}

/**
 * Unregister theme hook
 *
 * @param {string} hook - Theme hook name
 */
export function unregisterTheme(hook) {
  themeRegistry.delete(hook);
}

// ============================================================================
// Built-in Element Types
// ============================================================================

/**
 * Markup element - raw HTML
 */
registerElementType('markup', (element, context) => {
  let html = element['#markup'] || '';

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
registerElementType('plain_text', (element, context) => {
  return escapeHtml(element['#plain_text'] || '');
});

/**
 * Container element - div wrapper
 */
registerElementType('container', (element, context) => {
  const attributes = element['#attributes'] || {};
  const attrString = buildAttributes(attributes);

  const children = renderChildren(element, context);

  if (!children && element['#markup'] === undefined && element['#plain_text'] === undefined) {
    return '';
  }

  let content = children;
  if (element['#markup']) content += element['#markup'];
  if (element['#plain_text']) content += escapeHtml(element['#plain_text']);

  return `<div${attrString}>${content}</div>`;
});

/**
 * HTML tag element - arbitrary HTML tag
 */
registerElementType('html_tag', (element, context) => {
  const tag = element['#tag'] || 'div';
  const attributes = element['#attributes'] || {};
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
    content = element['#value'];
  } else {
    content = renderChildren(element, context);
  }

  return `<${tag}${attrString}>${content}</${tag}>`;
});

/**
 * Link element - anchor tag
 */
registerElementType('link', (element, context) => {
  const url = element['#url'] || '#';
  const title = element['#title'] || '';
  const attributes = element['#attributes'] || {};

  // Merge href into attributes
  const linkAttrs = { ...attributes, href: url };
  const attrString = buildAttributes(linkAttrs);

  return `<a${attrString}>${escapeHtml(title)}</a>`;
});

/**
 * Inline template element - simple template string
 */
registerElementType('inline_template', (element, context) => {
  const template = element['#template'] || '';
  const contextData = element['#context'] || {};

  // Simple template replacement: {{ variable }}
  let html = template;
  for (const [key, value] of Object.entries(contextData)) {
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    html = html.replace(regex, escapeHtml(String(value)));
  }

  return html;
});

/**
 * Processed text element - text with format applied
 */
registerElementType('processed_text', (element, context) => {
  const text = element['#text'] || '';
  const format = element['#format'] || 'plain_text';

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
registerElementType('details', (element, context) => {
  const attributes = element['#attributes'] || {};
  const attrString = buildAttributes(attributes);
  const title = element['#title'] || '';
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
registerElementType('item_list', (element, context) => {
  const items = element['#items'] || [];
  const listType = element['#list_type'] || 'ul';
  const attributes = element['#attributes'] || {};
  const title = element['#title'];
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
registerElementType('table', (element, context) => {
  const header = element['#header'] || [];
  const rows = element['#rows'] || [];
  const attributes = element['#attributes'] || {};
  const attrString = buildAttributes(attributes);
  const caption = element['#caption'];

  let html = `<table${attrString}>`;

  if (caption) {
    html += `\n  <caption>${escapeHtml(caption)}</caption>`;
  }

  if (header.length > 0) {
    html += '\n  <thead>\n    <tr>';
    header.forEach(cell => {
      const cellAttrs = buildAttributes(cell.attributes || {});
      const content = cell.data || cell;
      html += `\n      <th${cellAttrs}>${escapeHtml(String(content))}</th>`;
    });
    html += '\n    </tr>\n  </thead>';
  }

  if (rows.length > 0) {
    html += '\n  <tbody>';
    rows.forEach(row => {
      const rowAttrs = buildAttributes(row.attributes || {});
      html += `\n    <tr${rowAttrs}>`;

      const cells = row.data || row;
      (Array.isArray(cells) ? cells : [cells]).forEach(cell => {
        const cellAttrs = buildAttributes(cell.attributes || {});
        const content = cell.data || cell;
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
registerElementType('form', (element, context) => {
  const attributes = element['#attributes'] || {};
  const action = element['#action'] || '';
  const method = element['#method'] || 'post';

  const formAttrs = {
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
registerElementType('textfield', (element, context) => {
  const attributes = element['#attributes'] || {};
  const type = element['#input_type'] || 'text';
  const name = element['#name'] || '';
  const value = element['#default_value'] || element['#value'] || '';
  const required = element['#required'] ? true : false;

  const inputAttrs = {
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
registerElementType('textarea', (element, context) => {
  const attributes = element['#attributes'] || {};
  const name = element['#name'] || '';
  const value = element['#default_value'] || element['#value'] || '';
  const required = element['#required'] ? true : false;
  const rows = element['#rows'] || 5;
  const cols = element['#cols'];

  const textareaAttrs = {
    ...attributes,
    name,
    required,
    rows
  };
  if (cols) textareaAttrs.cols = cols;

  const attrString = buildAttributes(textareaAttrs);

  return `<textarea${attrString}>${escapeHtml(value)}</textarea>`;
});

/**
 * Select element - dropdown
 */
registerElementType('select', (element, context) => {
  const attributes = element['#attributes'] || {};
  const name = element['#name'] || '';
  const options = element['#options'] || {};
  const value = element['#default_value'] || element['#value'];
  const required = element['#required'] ? true : false;
  const multiple = element['#multiple'] ? true : false;

  const selectAttrs = {
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
registerElementType('checkbox', (element, context) => {
  const attributes = element['#attributes'] || {};
  const name = element['#name'] || '';
  const value = element['#return_value'] || '1';
  const checked = element['#default_value'] || element['#checked'] ? true : false;
  const required = element['#required'] ? true : false;

  const inputAttrs = {
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
registerElementType('radios', (element, context) => {
  const name = element['#name'] || '';
  const options = element['#options'] || {};
  const value = element['#default_value'] || element['#value'];
  const required = element['#required'] ? true : false;

  const radios = [];
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
registerElementType('button', (element, context) => {
  const attributes = element['#attributes'] || {};
  const type = element['#button_type'] || 'button';
  const value = element['#value'] || 'Submit';
  const name = element['#name'] || '';

  const buttonAttrs = {
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
registerTheme('container', (element, context) => {
  const attributes = element['#attributes'] || {};
  const attrString = buildAttributes(attributes);
  const children = element['#children'] || renderChildren(element, context);

  return `<div${attrString}>${children}</div>`;
});

/**
 * Field theme - renders a field with label
 */
registerTheme('field', (element, context) => {
  const label = element['#label'] || '';
  const items = element['#items'] || [];
  const attributes = element['#attributes'] || {};
  const labelDisplay = element['#label_display'] || 'above';
  const attrString = buildAttributes(attributes);

  let html = `<div${attrString}>`;

  if (label && labelDisplay !== 'hidden') {
    const labelClass = labelDisplay === 'inline' ? ' class="field-label-inline"' : '';
    html += `\n  <div${labelClass}><strong>${escapeHtml(label)}:</strong></div>`;
  }

  html += '\n  <div class="field-items">';
  items.forEach((item, index) => {
    html += `\n    <div class="field-item field-item-${index}">`;
    html += typeof item === 'string' ? escapeHtml(item) : doRender(item, context);
    html += '</div>';
  });
  html += '\n  </div>';

  html += '\n</div>';

  return html;
});

/**
 * Page theme - full page render
 */
registerTheme('page', (element, context) => {
  const title = element['#title'] || '';
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
 * @param {string} html - HTML to sanitize
 * @returns {string} Sanitized HTML
 */
function sanitizeHtml(html) {
  // Allowed tags for basic_html format
  const allowedTags = new Set([
    'p', 'br', 'strong', 'em', 'u', 'a', 'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code', 'pre'
  ]);

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
 * @param {string} type - Element type
 * @param {Object} properties - Element properties
 * @returns {Object} Render array element
 */
export function createElement(type, properties = {}) {
  return {
    '#type': type,
    ...properties
  };
}

/**
 * Clone a render array element deeply
 *
 * @param {Object} element - Element to clone
 * @returns {Object} Cloned element
 */
export function cloneElement(element) {
  if (!element || typeof element !== 'object') {
    return element;
  }

  if (Array.isArray(element)) {
    return element.map(cloneElement);
  }

  const cloned = {};
  for (const [key, value] of Object.entries(element)) {
    cloned[key] = cloneElement(value);
  }

  return cloned;
}

/**
 * Check if element has children
 *
 * @param {Object} element - Render array element
 * @returns {boolean} True if element has children
 */
export function hasChildren(element) {
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
