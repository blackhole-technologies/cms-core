/**
 * template.ts - Simple Template Engine
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
 * - Escaping (auto-escape is built in — see below)
 *
 * SECURITY NOTE:
 * ==============
 * This engine auto-escapes HTML in {{variable}} output to prevent XSS.
 * Use {{{variable}}} (triple braces) for trusted raw HTML only.
 * See processVariables() for implementation.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================================
// Types
// ============================================================================

/** Template data context — inherently untyped since templates are dynamic */
type TemplateData = Record<string, unknown>;

/** i18n service interface for translation support */
interface I18nService {
    t(key: string, params: Record<string, string>, locale: string | null): string;
    getDefaultLocale(): string;
}

/** SDC (Single Directory Components) service interface */
interface SDCService {
    hasComponents(): boolean;
    resetCssTracking(): void;
    processComponents(
        template: string,
        data: TemplateData,
        renderFn: (template: string, data: TemplateData) => string
    ): string;
}

/** Embed field value shape */
interface EmbedField {
    url: string;
    oembed?: {
        html?: string;
        type?: string;
        title?: string;
        thumbnail_url?: string;
    };
}

/** Options for renderEmbedField */
interface EmbedRenderOptions {
    className?: string;
}

// ============================================================================
// State
// ============================================================================

/**
 * Base directory for templates (set by init)
 */
let themeDir: string | null = null;

/**
 * Global template data merged into every render call.
 * Used for site-wide variables like GTM ID, analytics scripts, etc.
 */
let templateGlobals: TemplateData = {};

/**
 * i18n service reference for translation helper
 */
let i18nService: I18nService | null = null;

/**
 * SDC (Single Directory Components) service reference.
 * Set via setSdc() during boot. Enables {{component "name" prop="val"}} syntax.
 */
let sdcService: SDCService | null = null;

/**
 * Set i18n service for template translations
 *
 * @param service - i18n service instance
 */
export function setI18n(service: I18nService): void {
  i18nService = service;
}

/**
 * Set SDC service for component rendering.
 * @param service - SDC service instance (from core/sdc.js)
 */
export function setSdc(service: SDCService): void {
  sdcService = service;
}

/**
 * Initialize template system with theme directory
 *
 * @param themePath - Absolute path to active theme
 *
 * WHY INIT:
 * - Decouples from boot sequence
 * - Makes testing easier
 * - Allows theme switching
 */
export function init(themePath: string): void {
  themeDir = themePath;
}

/**
 * Get the current theme directory
 */
export function getThemeDir(): string | null {
  return themeDir;
}

/**
 * Set global template variables merged into every render call.
 * Useful for site-wide data like GTM ID, analytics config, etc.
 *
 * @param globals - Key-value pairs to merge
 */
export function setGlobals(globals: TemplateData): void {
  templateGlobals = { ...templateGlobals, ...globals };
}

/**
 * Get a value from a nested object using dot notation
 *
 * @param obj - Object to search
 * @param path - Dot-separated path (e.g., 'user.name')
 * @returns Value at path, or undefined if not found
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
function getNestedValue(obj: TemplateData, path: string): unknown {
  if (!path || !obj) return undefined;

  // Handle ../ parent context traversal
  let current: unknown = obj;
  let remainingPath = path;

  while (remainingPath.startsWith('../')) {
    if (current && typeof current === 'object' && '__parent__' in (current as TemplateData)) {
      current = (current as TemplateData).__parent__;
    }
    remainingPath = remainingPath.substring(3);
  }

  // Handle ./ current context prefix (just strip it)
  if (remainingPath.startsWith('./')) {
    remainingPath = remainingPath.substring(2);
  }

  const parts = remainingPath.split('.');
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Check if a value is "truthy" for template conditionals
 *
 * @param value - Value to check
 * @returns boolean
 *
 * TRUTHY RULES:
 * - Empty arrays are falsy (for cleaner {{#if items}} usage)
 * - Empty strings are falsy
 * - null/undefined are falsy
 * - Everything else follows JavaScript truthiness
 */
function isTruthy(value: unknown): boolean {
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
 * @param template - Template string
 * @param data - Data context
 * @returns Template with each blocks processed
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
function processEachBlocks(template: string, data: TemplateData): string {
  // Match innermost each blocks first (those without nested each blocks inside)
  // This regex matches each blocks that don't contain other each blocks
  const innerEachRegex = /\{\{#each\s+((?:\.\.\/)*\w+(?:\.\w+)*)\}\}((?:(?!\{\{#each)[\s\S])*?)\{\{\/each\}\}/g;

  let result = template;
  let prevResult: string;

  // Process iteratively until no more each blocks (handles nesting inside-out)
  do {
    prevResult = result;
    result = result.replace(innerEachRegex, (_match: string, varPath: string, innerTemplate: string) => {
      const items = getNestedValue(data, varPath);

      // If not an array or empty, return nothing
      if (!Array.isArray(items) || items.length === 0) {
        return '';
      }

      // Render inner template for each item
      return items.map((item: unknown, index: number) => {
        // Create context for this iteration
        // Item properties are merged with special @ variables
        const itemContext: TemplateData = {
          ...data,           // Parent data still accessible
          ...(typeof item === 'object' && item !== null ? item as TemplateData : { this: item }),
          '@index': index,
          '@first': index === 0,
          '@last': index === items.length - 1,
          '__parent__': data, // Store parent context for ../ traversal
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
 * @param template - Template string
 * @param data - Data context
 * @returns Template with if blocks processed
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
/**
 * Evaluate a condition expression within template context.
 * Supports:
 *   - Simple variable path: "myVar", "../parentVar", "user.name"
 *   - (eq a b)    — equality comparison
 *   - (gt a b)    — greater-than comparison (numeric)
 *   - (includes arr item) — array/string includes check
 *   - (or a b)    — logical OR of two values
 *
 * String literals can be quoted with single or double quotes.
 */
function evaluateCondition(condExpr: string, data: TemplateData): boolean {
  const expr = condExpr.trim();

  // Subexpression: (helper arg1 arg2)
  const subMatch = expr.match(/^\((\w+)\s+([\s\S]+)\)$/);
  if (subMatch) {
    const helper = subMatch[1]!;
    // Parse arguments — split on whitespace but respect quoted strings
    const argsRaw = subMatch[2]!;
    const args: string[] = [];
    const argRegex = /(?:"([^"]*)"|'([^']*)'|((?:\.\.\/)*@?\w+(?:\.\w+)*))/g;
    let m: RegExpExecArray | null;
    while ((m = argRegex.exec(argsRaw)) !== null) {
      if (m[1] !== undefined) args.push(m[1]);        // double-quoted literal
      else if (m[2] !== undefined) args.push(m[2]);    // single-quoted literal
      else if (m[3] !== undefined) args.push(m[3]);    // variable path
    }

    // Resolve variable paths to values (literals stay as strings)
    const resolveArg = (arg: string): unknown => {
      // If the arg was a quoted literal it's already a string value
      // Check if it looks like a variable path (not purely numeric)
      if (/^[0-9.]+$/.test(arg)) return parseFloat(arg);
      // Resolve as variable from data context
      const val = getNestedValue(data, arg);
      return val !== undefined ? val : arg; // fallback to literal if not found
    };

    if (helper === 'eq') {
      const a = resolveArg(args[0]!);
      const b = resolveArg(args[1]!);
      return a == b; // loose equality to handle string/number comparisons
    }
    if (helper === 'gt') {
      const a = resolveArg(args[0]!);
      const b = resolveArg(args[1]!);
      return Number(a) > Number(b);
    }
    if (helper === 'includes') {
      const collection = resolveArg(args[0]!);
      const item = resolveArg(args[1]!);
      if (Array.isArray(collection)) return collection.includes(item);
      if (typeof collection === 'string' && typeof item === 'string') return collection.includes(item);
      return false;
    }
    if (helper === 'or') {
      return isTruthy(resolveArg(args[0]!)) || isTruthy(resolveArg(args[1]!));
    }

    // Unknown helper — treat as falsy
    return false;
  }

  // Simple variable path
  return isTruthy(getNestedValue(data, expr));
}

function processIfBlocks(template: string, data: TemplateData): string {
  // Match {{#if CONDITION}}...{{/if}} where CONDITION can be:
  //   - simple path: myVar, ../parentVar, user.name.length
  //   - subexpression: (eq status 'draft'), (includes roles 'admin'), etc.
  const innerIfRegex = /\{\{#if\s+((?:\([^)]+\))|(?:(?:\.\.\/)*@?\w+(?:\.\w+)*))\}\}((?:(?!\{\{#if)[\s\S])*?)\{\{\/if\}\}/g;

  let result = template;
  let prevResult: string;

  // Process iteratively until no more if blocks (handles nesting inside-out)
  do {
    prevResult = result;
    result = result.replace(innerIfRegex, (_match: string, condExpr: string, innerContent: string) => {
      const isTrue = evaluateCondition(condExpr, data);

      // Check for {{else}} block
      const elseParts = innerContent.split(/\{\{else\}\}/);
      const trueBranch = elseParts[0]!;
      const falseBranch = elseParts[1] || '';

      // Return appropriate branch (will be processed again in next iteration if nested)
      return isTrue ? trueBranch : falseBranch;
    });
  } while (result !== prevResult);

  // Process {{#unless condition}}...{{/unless}} blocks
  result = processUnlessBlocks(result, data);

  // Process Mustache-style section blocks: {{#name}}...{{/name}} and {{^name}}...{{/name}}
  result = processMustacheSections(result, data);

  // Process variables after all blocks are resolved
  return processVariables(result, data);
}

/**
 * Process {{#unless condition}}...{{/unless}} blocks
 *
 * UNLESS BLOCK SYNTAX:
 * {{#unless locked}}
 *   <button>Delete</button>
 * {{/unless}}
 *
 * Renders the content only when the condition is falsy.
 */
function processUnlessBlocks(template: string, data: TemplateData): string {
  // Support both simple paths AND subexpressions like (eq status 'draft')
  const innerUnlessRegex = /\{\{#unless\s+((?:\([^)]+\))|(?:(?:\.\.\/)*@?\w+(?:\.\w+)*))\}\}((?:(?!\{\{#unless)[\s\S])*?)\{\{\/unless\}\}/g;

  let result = template;
  let prevResult: string;

  do {
    prevResult = result;
    result = result.replace(innerUnlessRegex, (_match: string, condExpr: string, innerContent: string) => {
      const isTrue = evaluateCondition(condExpr, data);

      // Check for {{else}} block
      const elseParts = innerContent.split(/\{\{else\}\}/);
      const falseBranch = elseParts[0]!;
      const trueBranch = elseParts[1] || '';

      // Unless = inverse of if
      return isTrue ? trueBranch : falseBranch;
    });
  } while (result !== prevResult);

  return result;
}

/**
 * Process Mustache-style section blocks:
 *   {{#name}}...{{/name}} — truthy/iteration sections
 *   {{^name}}...{{/name}} — inverted sections (render when falsy)
 *
 * MUSTACHE SECTION RULES:
 * - If value is an array: iterate over items (like {{#each}})
 * - If value is truthy (non-array): render block once
 * - If value is falsy: skip block
 *
 * INVERTED SECTIONS:
 * - {{^name}}...{{/name}} renders when value is falsy
 *
 * WHY:
 * Many templates use standard Mustache syntax ({{#items}}...{{/items}})
 * instead of the explicit {{#each items}} or {{#if items}} forms.
 */
function processMustacheSections(template: string, data: TemplateData): string {
  // Process inverted sections {{^name}}...{{/name}} first
  const invertedRegex = /\{\{\^((?:\.\.\/)*\w+(?:\.\w+)*)\}\}((?:(?!\{\{\^)[\s\S])*?)\{\{\/\1\}\}/g;

  let result = template;
  let prevResult: string;

  do {
    prevResult = result;
    result = result.replace(invertedRegex, (_match: string, varPath: string, innerContent: string) => {
      const value = getNestedValue(data, varPath);
      return isTruthy(value) ? '' : innerContent;
    });
  } while (result !== prevResult);

  // Process truthy/iteration sections {{#name}}...{{/name}}
  // Match innermost sections (not containing nested # blocks with same syntax)
  const sectionRegex = /\{\{#(\w+(?:\.\w+)*)\}\}((?:(?!\{\{#\1\}\})[\s\S])*?)\{\{\/\1\}\}/g;

  do {
    prevResult = result;
    result = result.replace(sectionRegex, (_match: string, varPath: string, innerContent: string) => {
      const value = getNestedValue(data, varPath);

      // If value is an array: iterate
      if (Array.isArray(value)) {
        if (value.length === 0) return '';
        return value.map((item: unknown, index: number) => {
          const itemContext: TemplateData = {
            ...data,
            ...(typeof item === 'object' && item !== null ? item as TemplateData : { this: item }),
            '@index': index,
            '@first': index === 0,
            '@last': index === value.length - 1,
            '__parent__': data,
          };
          // Recursively process inner content for nested sections
          let rendered = processUnlessBlocks(innerContent, itemContext);
          rendered = processMustacheSections(rendered, itemContext);
          return processVariables(rendered, itemContext);
        }).join('');
      }

      // If truthy (non-array): render block once
      if (isTruthy(value)) {
        // If value is an object, merge its properties
        const _blockContext: TemplateData = typeof value === 'object' && value !== null
          ? { ...data, ...(value as TemplateData), '__parent__': data }
          : data;
        return innerContent;
      }

      // If falsy: skip
      return '';
    });
  } while (result !== prevResult);

  return result;
}

/**
 * Process {{variable}} and {{{variable}}} substitutions
 *
 * @param template - Template string
 * @param data - Data context
 * @returns Template with variables replaced
 *
 * VARIABLE SYNTAX:
 * {{name}} → data.name (HTML-escaped for XSS protection)
 * {{{name}}} → data.name (raw, unescaped - use for trusted HTML)
 * {{user.email}} → data.user.email (escaped)
 * {{@index}} → loop index
 *
 * ESCAPING:
 * Double braces {{}} auto-escape HTML to prevent XSS attacks.
 * Triple braces {{{}}} output raw HTML for trusted content like
 * pre-rendered HTML, CSRF fields, and admin-generated markup.
 *
 * SPECIAL HELPERS (always raw - they generate trusted HTML):
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
function processVariables(template: string, data: TemplateData): string {
  // First, handle {{t "key"}} translation helper
  // Matches: {{t "key"}} or {{t "key" param="value" param2="value2"}}
  const tRegex = /\{\{t\s+"([^"]+)"(?:\s+([^}]+))?\}\}/g;

  let result = template.replace(tRegex, (_match: string, key: string, paramsStr: string | undefined) => {
    if (!i18nService) {
      return key; // Return key if i18n not initialized
    }

    // Parse parameters if present
    const params: Record<string, string> = {};
    if (paramsStr) {
      // Match param="value" patterns
      const paramRegex = /(\w+)="([^"]*)"/g;
      let paramMatch: RegExpExecArray | null;
      while ((paramMatch = paramRegex.exec(paramsStr)) !== null) {
        params[paramMatch[1]!] = paramMatch[2]!;
      }
    }

    // Get locale from data context or use default
    const locale = (data._locale as string | null) || null;

    return i18nService.t(key, params, locale);
  });

  // Process triple-brace {{{variable}}} FIRST (raw/unescaped output)
  // WHY TRIPLE BRACES:
  // Some template values contain trusted HTML (e.g., pre-rendered content,
  // admin-generated markup). Triple braces bypass escaping for these cases.
  // Supports ../ parent context traversal and ./ current context prefix.
  const rawVarRegex = /\{\{\{((?:\.\.\/)*@?\w+(?:\.\w+)*)\}\}\}/g;

  result = result.replace(rawVarRegex, (_match: string, varPath: string) => {
    const value = getNestedValue(data, varPath);
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });

  // Then process double-brace {{variable}} (HTML-escaped output)
  // Supports ../ parent context and ./ current context prefix.
  const varRegex = /\{\{((?:\.\.\/)*@?\w+(?:\.\w+)*)\}\}/g;

  return result.replace(varRegex, (_match: string, varPath: string) => {
    // Strip ../ prefix for special helper checks, but use full path for getNestedValue
    const strippedPath = varPath.replace(/^(?:\.\.\/)+/, '');

    // Handle CSRF helpers - these generate trusted HTML, no escaping needed
    if (strippedPath === 'csrfField') {
      const token = getNestedValue(data, 'csrfToken') || '';
      return `<input type="hidden" name="_csrf" value="${escapeHtml(String(token))}">`;
    }

    if (strippedPath === 'csrfMeta') {
      const token = getNestedValue(data, 'csrfToken') || '';
      return `<meta name="csrf-token" content="${escapeHtml(String(token))}">`;
    }

    // Handle locale helper
    if (strippedPath === 'locale') {
      if (i18nService) {
        return (data._locale as string | undefined) || i18nService.getDefaultLocale();
      }
      return (data._locale as string | undefined) || 'en';
    }

    // Handle embed helper - returns trusted HTML from oEmbed
    if (strippedPath.startsWith('embed ')) {
      const fieldPath = strippedPath.substring(6).trim();
      const embedValue = getNestedValue(data, fieldPath);
      return renderEmbedField(embedValue as EmbedField | null | undefined);
    }

    const value = getNestedValue(data, varPath);

    // Convert value to string
    if (value === undefined || value === null) {
      return '';
    }

    // Arrays and objects get JSON stringified (escaped)
    if (typeof value === 'object') {
      return escapeHtml(JSON.stringify(value));
    }

    // Auto-escape HTML to prevent XSS
    return escapeHtml(String(value));
  });
}

/**
 * Render a template string with data
 *
 * @param templateString - Template content
 * @param data - Data to inject
 * @returns Rendered HTML
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
export function renderString(templateString: string, data: TemplateData = {}): string {
  let result = templateString;

  // Process SDC component tags first: {{component "name" prop="value"}}
  // WHY FIRST: Component output may contain {{#each}}, {{#if}}, {{var}} tags
  // that need to be processed by the subsequent passes.
  if (sdcService && sdcService.hasComponents()) {
    sdcService.resetCssTracking();
    result = sdcService.processComponents(result, data, renderString);
  }

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
 * @param templatePath - Path to template (relative to theme/templates/)
 * @param data - Data to inject
 * @returns Rendered HTML
 * @throws If template file not found
 *
 * @example
 * // Renders themes/default/templates/page.html
 * render('page.html', { title: 'My Page', body: '<p>Content</p>' })
 */
export function render(templatePath: string, data: TemplateData = {}): string {
  if (!themeDir) {
    throw new Error('Template system not initialized. Call init() first.');
  }

  const fullPath = join(themeDir, 'templates', templatePath);

  if (!existsSync(fullPath)) {
    throw new Error(`Template not found: ${templatePath}`);
  }

  const templateContent = readFileSync(fullPath, 'utf-8');
  return renderString(templateContent, { ...templateGlobals, ...data });
}

/**
 * Render content within a layout
 *
 * @param layoutPath - Path to layout template
 * @param content - Rendered content to insert
 * @param data - Additional data for layout
 * @returns Complete page HTML
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
export function renderWithLayout(
  layoutPath: string,
  content: string,
  data: TemplateData = {}
): string {
  return render(layoutPath, { ...data, content });
}

/**
 * Escape HTML special characters
 *
 * @param str - String to escape
 * @returns Escaped string safe for HTML
 *
 * USE THIS FOR USER INPUT:
 * Always escape user-provided content before rendering
 * to prevent XSS attacks.
 *
 * @example
 * const safe = escapeHtml(userComment);
 * render('comment.html', { text: safe });
 */
export function escapeHtml(str: string): string {
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
 * @param embed - Embed field value { url, oembed, fetchedAt }
 * @param options - Render options
 * @returns HTML string
 *
 * WHY SEPARATE FUNCTION:
 * Embeds need special handling - they contain pre-rendered HTML
 * from oEmbed providers that should be rendered as-is (not escaped).
 *
 * @example
 * {{embed article.featuredVideo}}
 * // Returns: <div class="embed embed-video"><iframe ...></iframe></div>
 */
export function renderEmbedField(
  embed: EmbedField | null | undefined,
  options: EmbedRenderOptions = {}
): string {
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
 * {{name}}           - Simple variable (HTML-escaped)
 * {{{name}}}         - Raw/unescaped output (for trusted HTML)
 * {{user.email}}     - Nested property (escaped)
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
