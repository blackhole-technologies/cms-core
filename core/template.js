/**
 * template.js - Simple Template Engine
 *
 * WHY A TEMPLATE ENGINE:
 * ======================
 * A CMS needs to render dynamic HTML pages. Templates separate:
 * - Structure (HTML layout)
 * - Content (data to display)
 * - Logic (loops, conditionals)
 *
 * This keeps HTML out of JavaScript and makes themes possible.
 *
 * DESIGN DECISIONS:
 * =================
 *
 * 1. MUSTACHE-LIKE SYNTAX
 *    We use {{variable}} syntax, similar to Mustache/Handlebars.
 *    Why this syntax:
 *    - Familiar to many developers
 *    - Easy to read in HTML
 *    - Won't conflict with HTML or JS
 *    - Simple to parse with regex
 *
 * 2. NO EXTERNAL DEPENDENCIES
 *    Following the zero-deps philosophy, we implement our own engine.
 *    It's simpler than Handlebars but covers common cases:
 *    - Variable substitution: {{name}}
 *    - Loops: {{#each items}}...{{/each}}
 *    - Conditionals: {{#if condition}}...{{/if}}
 *    - Nested properties: {{user.name}}
 *
 * 3. FILE-BASED TEMPLATES
 *    Templates are .html files in theme directories.
 *    This allows:
 *    - Editing with any HTML editor
 *    - Syntax highlighting
 *    - Version control
 *    - Theme switching
 *
 * 4. LAYOUT SYSTEM
 *    Templates can use {{content}} to insert rendered content.
 *    This enables wrapper layouts:
 *    - layout.html wraps page content
 *    - page.html provides the inner content
 *    - Render page → insert into layout
 *
 * WHAT THIS DOESN'T DO:
 * ====================
 * - Partials/includes (could add later)
 * - Helpers/formatters (could add later)
 * - Caching (templates read from disk each time)
 * - Escaping (caller must escape user content)
 *
 * SECURITY NOTE:
 * ==============
 * This engine does NOT auto-escape HTML. If you render user input,
 * you must escape it first to prevent XSS attacks:
 *
 *   const safe = escapeHtml(userInput);
 *   render('template.html', { content: safe });
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Base directory for templates (set by init)
 */
let themeDir = null;

/**
 * i18n service reference for translation helper
 */
let i18nService = null;

/**
 * Set i18n service for template translations
 *
 * @param {Object} service - i18n service instance
 */
export function setI18n(service) {
  i18nService = service;
}

/**
 * Initialize template system with theme directory
 *
 * @param {string} themePath - Absolute path to active theme
 *
 * WHY INIT:
 * - Decouples from boot sequence
 * - Makes testing easier
 * - Allows theme switching
 */
export function init(themePath) {
  themeDir = themePath;
}

/**
 * Get the current theme directory
 */
export function getThemeDir() {
  return themeDir;
}

/**
 * Get a value from a nested object using dot notation
 *
 * @param {Object} obj - Object to search
 * @param {string} path - Dot-separated path (e.g., 'user.name')
 * @returns {*} - Value at path, or undefined if not found
 *
 * WHY DOT NOTATION:
 * Allows accessing nested data in templates:
 *   {{user.name}} → data.user.name
 *   {{post.author.email}} → data.post.author.email
 *
 * @example
 * getNestedValue({ user: { name: 'Ernie' } }, 'user.name')
 * // Returns: 'Ernie'
 */
function getNestedValue(obj, path) {
  if (!path || !obj) return undefined;

  const parts = path.split('.');
  let current = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[part];
  }

  return current;
}

/**
 * Check if a value is "truthy" for template conditionals
 *
 * @param {*} value - Value to check
 * @returns {boolean}
 *
 * TRUTHY RULES:
 * - Empty arrays are falsy (for cleaner {{#if items}} usage)
 * - Empty strings are falsy
 * - null/undefined are falsy
 * - Everything else follows JavaScript truthiness
 */
function isTruthy(value) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (value === '') {
    return false;
  }
  return Boolean(value);
}

/**
 * Process {{#each items}}...{{/each}} blocks
 *
 * @param {string} template - Template string
 * @param {Object} data - Data context
 * @returns {string} - Template with each blocks processed
 *
 * EACH BLOCK SYNTAX:
 * {{#each items}}
 *   <li>{{name}} - {{value}}</li>
 * {{/each}}
 *
 * Inside the block:
 * - Item properties are available directly: {{name}}, {{value}}
 * - {{@index}} gives the current index (0-based)
 * - {{@first}} is true for first item
 * - {{@last}} is true for last item
 *
 * WHY REGEX:
 * Simple and works for non-nested blocks.
 * Nested each blocks are not supported (would need a parser).
 */
function processEachBlocks(template, data) {
  // Match innermost each blocks first (those without nested each blocks inside)
  // This regex matches each blocks that don't contain other each blocks
  const innerEachRegex = /\{\{#each\s+(\w+(?:\.\w+)*)\}\}((?:(?!\{\{#each)[\s\S])*?)\{\{\/each\}\}/g;

  let result = template;
  let prevResult;

  // Process iteratively until no more each blocks (handles nesting inside-out)
  do {
    prevResult = result;
    result = result.replace(innerEachRegex, (match, varPath, innerTemplate) => {
      const items = getNestedValue(data, varPath);

      // If not an array or empty, return nothing
      if (!Array.isArray(items) || items.length === 0) {
        return '';
      }

      // Render inner template for each item
      return items.map((item, index) => {
        // Create context for this iteration
        // Item properties are merged with special @ variables
        const itemContext = {
          ...data,           // Parent data still accessible
          ...(typeof item === 'object' ? item : { this: item }),
          '@index': index,
          '@first': index === 0,
          '@last': index === items.length - 1,
        };

        // Process if blocks and variables for this item
        return processIfBlocks(innerTemplate, itemContext);
      }).join('');
    });
  } while (result !== prevResult);

  return result;
}

/**
 * Process {{#if condition}}...{{/if}} blocks
 *
 * @param {string} template - Template string
 * @param {Object} data - Data context
 * @returns {string} - Template with if blocks processed
 *
 * IF BLOCK SYNTAX:
 * {{#if hasItems}}
 *   <p>There are items!</p>
 * {{/if}}
 *
 * WITH ELSE:
 * {{#if loggedIn}}
 *   <p>Welcome back!</p>
 * {{else}}
 *   <p>Please log in.</p>
 * {{/if}}
 *
 * TRUTHINESS:
 * - Empty arrays are falsy
 * - Empty strings are falsy
 * - null/undefined are falsy
 * - 0 is falsy
 * - Everything else is truthy
 */
function processIfBlocks(template, data) {
  // Process innermost if blocks first (those without nested if blocks inside)
  // This regex matches if blocks that don't contain other if blocks
  const innerIfRegex = /\{\{#if\s+(\w+(?:\.\w+)*)\}\}((?:(?!\{\{#if)[\s\S])*?)\{\{\/if\}\}/g;

  let result = template;
  let prevResult;

  // Process iteratively until no more if blocks (handles nesting inside-out)
  do {
    prevResult = result;
    result = result.replace(innerIfRegex, (match, varPath, innerContent) => {
      const value = getNestedValue(data, varPath);
      const isTrue = isTruthy(value);

      // Check for {{else}} block
      const elseParts = innerContent.split(/\{\{else\}\}/);
      const trueBranch = elseParts[0];
      const falseBranch = elseParts[1] || '';

      // Return appropriate branch (will be processed again in next iteration if nested)
      return isTrue ? trueBranch : falseBranch;
    });
  } while (result !== prevResult);

  // Process variables after all if blocks are resolved
  return processVariables(result, data);
}

/**
 * Process {{variable}} substitutions
 *
 * @param {string} template - Template string
 * @param {Object} data - Data context
 * @returns {string} - Template with variables replaced
 *
 * VARIABLE SYNTAX:
 * {{name}} → data.name
 * {{user.email}} → data.user.email
 * {{@index}} → loop index
 *
 * SPECIAL HELPERS:
 * {{csrfField}} → <input type="hidden" name="_csrf" value="...">
 * {{csrfToken}} → raw CSRF token value
 * {{csrfMeta}} → <meta name="csrf-token" content="...">
 * {{t "key"}} → Translated string
 * {{t "key" param="value"}} → Translated string with interpolation
 * {{locale}} → Current locale code
 *
 * MISSING VARIABLES:
 * If a variable is not found, it's replaced with empty string.
 * This prevents {{undefined}} from appearing in output.
 */
function processVariables(template, data) {
  // First, handle {{t "key"}} translation helper
  // Matches: {{t "key"}} or {{t "key" param="value" param2="value2"}}
  const tRegex = /\{\{t\s+"([^"]+)"(?:\s+([^}]+))?\}\}/g;

  let result = template.replace(tRegex, (match, key, paramsStr) => {
    if (!i18nService) {
      return key; // Return key if i18n not initialized
    }

    // Parse parameters if present
    const params = {};
    if (paramsStr) {
      // Match param="value" patterns
      const paramRegex = /(\w+)="([^"]*)"/g;
      let paramMatch;
      while ((paramMatch = paramRegex.exec(paramsStr)) !== null) {
        params[paramMatch[1]] = paramMatch[2];
      }
    }

    // Get locale from data context or use default
    const locale = data._locale || null;

    return i18nService.t(key, params, locale);
  });

  // Match {{varName}} or {{nested.path}} or {{@special}}
  const varRegex = /\{\{(@?\w+(?:\.\w+)*)\}\}/g;

  return result.replace(varRegex, (match, varPath) => {
    // Handle CSRF helpers
    // WHY SPECIAL HELPERS:
    // CSRF tokens need to be included in every form.
    // These helpers make it easy without manual construction.
    if (varPath === 'csrfField') {
      const token = getNestedValue(data, 'csrfToken') || '';
      return `<input type="hidden" name="_csrf" value="${escapeHtml(token)}">`;
    }

    if (varPath === 'csrfMeta') {
      const token = getNestedValue(data, 'csrfToken') || '';
      return `<meta name="csrf-token" content="${escapeHtml(token)}">`;
    }

    // Handle locale helper
    if (varPath === 'locale') {
      if (i18nService) {
        return data._locale || i18nService.getDefaultLocale();
      }
      return data._locale || 'en';
    }

    // Handle embed helper
    // Usage: {{embed fieldName}} - renders embed HTML from field value
    if (varPath.startsWith('embed ')) {
      const fieldPath = varPath.substring(6).trim();
      const embedValue = getNestedValue(data, fieldPath);
      return renderEmbedField(embedValue);
    }

    const value = getNestedValue(data, varPath);

    // Convert value to string
    if (value === undefined || value === null) {
      return '';
    }

    // Arrays and objects get JSON stringified
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    return String(value);
  });
}

/**
 * Render a template string with data
 *
 * @param {string} templateString - Template content
 * @param {Object} data - Data to inject
 * @returns {string} - Rendered HTML
 *
 * PROCESSING ORDER:
 * 1. {{#each}} blocks (loops)
 * 2. {{#if}} blocks (conditionals)
 * 3. {{variable}} substitutions
 *
 * WHY THIS ORDER:
 * - Each blocks may contain if blocks and variables
 * - If blocks may contain variables
 * - Variables are the simplest, processed last
 *
 * @example
 * renderString('<h1>{{title}}</h1>', { title: 'Hello' })
 * // Returns: '<h1>Hello</h1>'
 */
export function renderString(templateString, data = {}) {
  let result = templateString;

  // Process blocks in order
  // Each blocks may contain if blocks (handled internally)
  // If blocks may contain nested if blocks (handled internally)
  // Both call processVariables at the end
  result = processEachBlocks(result, data);
  result = processIfBlocks(result, data);

  return result;
}

/**
 * Render a template file with data
 *
 * @param {string} templatePath - Path to template (relative to theme/templates/)
 * @param {Object} data - Data to inject
 * @returns {string} - Rendered HTML
 * @throws {Error} - If template file not found
 *
 * @example
 * // Renders themes/default/templates/page.html
 * render('page.html', { title: 'My Page', body: '<p>Content</p>' })
 */
export function render(templatePath, data = {}) {
  if (!themeDir) {
    throw new Error('Template system not initialized. Call init() first.');
  }

  const fullPath = join(themeDir, 'templates', templatePath);

  if (!existsSync(fullPath)) {
    throw new Error(`Template not found: ${templatePath}`);
  }

  const templateContent = readFileSync(fullPath, 'utf-8');
  return renderString(templateContent, data);
}

/**
 * Render content within a layout
 *
 * @param {string} layoutPath - Path to layout template
 * @param {string} content - Rendered content to insert
 * @param {Object} data - Additional data for layout
 * @returns {string} - Complete page HTML
 *
 * HOW LAYOUTS WORK:
 * 1. Render your content template (e.g., page.html)
 * 2. Call renderWithLayout() with the result
 * 3. Layout template uses {{content}} to place it
 *
 * @example
 * const pageContent = render('page.html', { title: 'Hello', body: '...' });
 * const fullPage = renderWithLayout('layout.html', pageContent, { siteTitle: 'My Site' });
 */
export function renderWithLayout(layoutPath, content, data = {}) {
  return render(layoutPath, { ...data, content });
}

/**
 * Escape HTML special characters
 *
 * @param {string} str - String to escape
 * @returns {string} - Escaped string safe for HTML
 *
 * USE THIS FOR USER INPUT:
 * Always escape user-provided content before rendering
 * to prevent XSS attacks.
 *
 * @example
 * const safe = escapeHtml(userComment);
 * render('comment.html', { text: safe });
 */
export function escapeHtml(str) {
  if (typeof str !== 'string') {
    return String(str);
  }

  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Render an embed field value as HTML
 *
 * @param {object} embed - Embed field value { url, oembed, fetchedAt }
 * @param {object} options - Render options
 * @returns {string} - HTML string
 *
 * WHY SEPARATE FUNCTION:
 * Embeds need special handling - they contain pre-rendered HTML
 * from oEmbed providers that should be rendered as-is (not escaped).
 *
 * @example
 * {{embed article.featuredVideo}}
 * // Returns: <div class="embed embed-video"><iframe ...></iframe></div>
 */
export function renderEmbedField(embed, options = {}) {
  if (!embed || !embed.url) {
    return '';
  }

  const { className = 'embed' } = options;

  // If we have cached oEmbed HTML, use it
  if (embed.oembed && embed.oembed.html) {
    const type = embed.oembed.type || 'rich';
    return `<div class="${className} ${className}-${type}">${embed.oembed.html}</div>`;
  }

  // If we have a thumbnail, show that with link
  if (embed.oembed && embed.oembed.thumbnail_url) {
    const title = escapeHtml(embed.oembed.title || 'View content');
    return `<div class="${className} ${className}-thumbnail">
      <a href="${escapeHtml(embed.url)}" target="_blank" rel="noopener">
        <img src="${escapeHtml(embed.oembed.thumbnail_url)}" alt="${title}" />
        <span class="embed-title">${title}</span>
      </a>
    </div>`;
  }

  // Fallback: just show link
  const title = escapeHtml(embed.oembed?.title || embed.url);
  return `<div class="${className} ${className}-link">
    <a href="${escapeHtml(embed.url)}" target="_blank" rel="noopener">${title}</a>
  </div>`;
}

/**
 * TEMPLATE SYNTAX REFERENCE:
 *
 * VARIABLES:
 * {{name}}           - Simple variable
 * {{user.email}}     - Nested property
 * {{@index}}         - Loop index (in #each)
 *
 * CONDITIONALS:
 * {{#if hasItems}}
 *   <p>Has items</p>
 * {{else}}
 *   <p>No items</p>
 * {{/if}}
 *
 * LOOPS:
 * {{#each items}}
 *   <li>{{name}}</li>
 * {{/each}}
 *
 * LAYOUT:
 * In layout.html: {{content}}
 * Marks where page content is inserted.
 *
 * EXAMPLE TEMPLATE:
 * <!DOCTYPE html>
 * <html>
 * <head><title>{{title}}</title></head>
 * <body>
 *   {{#if user}}
 *     <p>Welcome, {{user.name}}!</p>
 *   {{/if}}
 *
 *   {{#each posts}}
 *     <article>
 *       <h2>{{title}}</h2>
 *       <p>{{summary}}</p>
 *     </article>
 *   {{/each}}
 *
 *   {{content}}
 * </body>
 * </html>
 */
