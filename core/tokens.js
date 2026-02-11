/**
 * tokens.js - Token/Placeholder Replacement System
 * v1.0.0
 *
 * WHY THIS EXISTS:
 * Content often needs dynamic placeholders like [site:name] or [user:email]
 * replaced with actual values. Inspired by Drupal's Token module, this provides:
 * - Standardized token format: [type:property] or [type:property:modifier]
 * - Type-based organization (site, user, content, date, etc.)
 * - Chained tokens: [content:author:name]
 * - Safe HTML escaping by default
 * - Extensibility for custom token types
 *
 * WHY NOT A TEMPLATE ENGINE:
 * Template engines are for structure. Tokens are for simple replacements
 * within existing text. Different use cases.
 *
 * DESIGN DECISION: Zero dependencies
 * Uses only Node.js standard library for maximum portability.
 */

import { trigger } from './hooks.js';

/**
 * Token type registry
 * Structure: { type: { name, description, tokens: { tokenName: info } } }
 */
const types = {};

/**
 * Token handler registry
 * Structure: { 'type:token': callback }
 */
const handlers = {};

/**
 * Configuration
 */
let config = {
  pattern: /\[([a-zA-Z0-9_-]+):([a-zA-Z0-9_:-]+)\]/g,
  escapeHtml: true,
};

/**
 * Initialize token system
 *
 * @param {Object} options - Configuration options
 * @param {RegExp} options.pattern - Custom token pattern regex
 * @param {boolean} options.escapeHtml - HTML escape by default
 *
 * WHY LAZY INIT:
 * System works out of box with defaults. Init only needed for customization.
 */
export function init(options = {}) {
  config = { ...config, ...options };

  // Register core token types
  registerCoreTypes();
}

/**
 * Register a token type
 *
 * @param {string} type - Type identifier (e.g., 'site', 'user')
 * @param {Object} info - Type metadata
 * @param {string} info.name - Human-readable name
 * @param {string} info.description - Type description
 * @param {Object} info.tokens - Token definitions { tokenName: { name, description } }
 *
 * WHY SEPARATE TYPE REGISTRATION:
 * Allows discovery of available tokens without executing handlers.
 * UI can list tokens before needing actual values.
 */
export function registerType(type, info) {
  if (!type || typeof type !== 'string') {
    throw new Error('Token type must be a non-empty string');
  }

  if (!info || !info.name) {
    throw new Error('Token type info must include name');
  }

  types[type] = {
    name: info.name,
    description: info.description || '',
    tokens: info.tokens || {},
  };
}

/**
 * Register a token handler
 *
 * @param {string} type - Token type (e.g., 'site')
 * @param {string} name - Token name (e.g., 'name')
 * @param {Function} callback - Handler function(context, chain, modifier)
 *
 * WHY SEPARATE HANDLER REGISTRATION:
 * Decouples metadata (registerType) from logic (registerToken).
 * Type can be defined with static info, handlers added dynamically.
 *
 * Handler signature: (context, chain, modifier) => value
 * - context: Full context object (user, content, site, etc.)
 * - chain: Array of chained properties ['author', 'name'] for [content:author:name]
 * - modifier: Special modifier like 'raw'
 */
export function registerToken(type, name, callback) {
  if (!type || !name) {
    throw new Error('Token type and name are required');
  }

  if (typeof callback !== 'function') {
    throw new Error('Token callback must be a function');
  }

  const key = `${type}:${name}`;
  handlers[key] = callback;
}

/**
 * Replace all tokens in text
 *
 * @param {string} text - Text containing tokens
 * @param {Object} context - Context object with data for replacement
 * @returns {Promise<string>} - Text with tokens replaced
 *
 * WHY ASYNC:
 * Token handlers may need to fetch data (database, API, etc.)
 * Async allows handlers flexibility without blocking.
 */
export async function replace(text, context = {}) {
  if (!text || typeof text !== 'string') {
    return text;
  }

  // Find all tokens in text
  const tokens = scan(text);

  // Allow hooks to add/modify context
  const hookContext = { context, tokens };
  await trigger('token:beforeReplace', hookContext);

  // Replace each token
  let result = text;
  for (const token of tokens) {
    try {
      const value = await replaceToken(token, hookContext.context);
      if (value !== null && value !== undefined) {
        // WHY GLOBAL REPLACE:
        // Same token may appear multiple times in text
        result = result.split(token.full).join(value);
      }
    } catch (error) {
      console.error(`[tokens] Error replacing ${token.full}:`, error.message);
      // Keep original token on error
    }
  }

  // Allow hooks to modify final result
  const afterContext = { text: result, originalText: text, context: hookContext.context };
  await trigger('token:afterReplace', afterContext);

  return afterContext.text;
}

/**
 * Replace a single token
 *
 * @param {Object|string} token - Parsed token object or token string
 * @param {Object} context - Context object
 * @returns {Promise<string|null>} - Replacement value or null if not found
 *
 * WHY ACCEPT OBJECT OR STRING:
 * Internal calls already have parsed object. External calls might have string.
 * Flexibility without forcing callers to parse.
 */
export async function replaceToken(token, context = {}) {
  // Parse if string
  if (typeof token === 'string') {
    const parsed = parseToken(token);
    if (!parsed) return null;
    token = parsed;
  }

  const { type, name, chain, modifier } = token;
  const handlerKey = `${type}:${name}`;

  // Check for registered handler
  const handler = handlers[handlerKey];
  if (!handler) {
    // Allow hooks to provide value
    const hookContext = { token, context, value: null };
    await trigger('token:replace', hookContext);
    return hookContext.value !== null ? hookContext.value : null;
  }

  // Execute handler
  let value = await handler(context, chain, modifier);

  // Handle chained tokens (e.g., [content:author:name])
  // Handler returns object, we drill down the chain
  if (chain.length > 0 && value !== null && typeof value === 'object') {
    for (const prop of chain) {
      value = value?.[prop];
      if (value === null || value === undefined) break;
    }
  }

  // Convert to string
  if (value === null || value === undefined) {
    return null;
  }

  value = String(value);

  // HTML escape unless 'raw' modifier
  if (config.escapeHtml && modifier !== 'raw') {
    value = escapeHtml(value);
  }

  return value;
}

/**
 * Scan text for tokens
 *
 * @param {string} text - Text to scan
 * @returns {Array} - Array of parsed token objects
 *
 * WHY RETURN PARSED OBJECTS:
 * Avoids re-parsing when iterating for replacement.
 * Caller gets structured data immediately.
 */
export function scan(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const tokens = [];
  const matches = text.matchAll(config.pattern);

  for (const match of matches) {
    const parsed = parseToken(match[0]);
    if (parsed) {
      tokens.push(parsed);
    }
  }

  return tokens;
}

/**
 * Parse a token string into components
 *
 * @param {string} tokenStr - Token string like '[site:name]' or '[content:author:name:raw]'
 * @returns {Object|null} - Parsed token { full, type, name, chain, modifier }
 *
 * WHY INTERNAL FUNCTION:
 * Token parsing is implementation detail. Callers use scan() or replace().
 * But exported for debugging/testing purposes.
 */
export function parseToken(tokenStr) {
  if (!tokenStr || typeof tokenStr !== 'string') {
    return null;
  }

  // Remove brackets
  const inner = tokenStr.replace(/^\[|\]$/g, '');
  const parts = inner.split(':');

  if (parts.length < 2) {
    return null;
  }

  const type = parts[0];
  const name = parts[1];
  const chain = [];
  let modifier = null;

  // Parse chained properties and modifiers
  // [content:author:name:raw] -> chain: ['author', 'name'], modifier: 'raw'
  if (parts.length > 2) {
    for (let i = 2; i < parts.length; i++) {
      const part = parts[i];
      // Check if it's a known modifier
      if (part === 'raw') {
        modifier = part;
      } else {
        chain.push(part);
      }
    }
  }

  return {
    full: tokenStr,
    type,
    name,
    chain,
    modifier,
  };
}

/**
 * Validate tokens in text
 *
 * @param {string} text - Text to validate
 * @returns {Object} - { valid: boolean, errors: Array }
 *
 * WHY SEPARATE VALIDATION:
 * Forms/UI can check tokens before saving.
 * Better UX than discovering broken tokens at render time.
 */
export function validate(text) {
  const tokens = scan(text);
  const errors = [];

  for (const token of tokens) {
    const handlerKey = `${token.type}:${token.name}`;

    // Check if type exists
    if (!types[token.type]) {
      errors.push({
        token: token.full,
        error: `Unknown token type: ${token.type}`,
      });
      continue;
    }

    // Check if handler exists
    if (!handlers[handlerKey]) {
      errors.push({
        token: token.full,
        error: `Unknown token: ${token.type}:${token.name}`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get all registered token types
 *
 * @returns {Object} - Types registry
 */
export function getTypes() {
  return { ...types };
}

/**
 * Get tokens for a specific type
 *
 * @param {string} type - Token type
 * @returns {Object|null} - Type info with tokens
 */
export function getTokens(type) {
  return types[type] || null;
}

/**
 * Get available tokens for a context
 *
 * @param {Object} context - Context to check
 * @returns {Array} - Available token types
 *
 * WHY CONTEXT-AWARE:
 * Not all tokens available in all contexts.
 * E.g., [content:title] only works when content is in context.
 * UI can show only relevant tokens.
 */
export function getAvailableTokens(context = {}) {
  const available = [];

  // Always available
  available.push(types['site']);
  available.push(types['date']);

  // Context-dependent
  if (context.user || context.currentUser) {
    available.push(types['current-user']);
  }

  if (context.content) {
    available.push(types['content']);
  }

  if (context.term) {
    available.push(types['term']);
  }

  // Filter out undefined (in case type not registered)
  return available.filter(Boolean);
}

/**
 * Get data for token browser UI
 *
 * @param {Object} context - Context for availability check
 * @returns {Object} - Structured data for UI
 *
 * WHY SEPARATE METHOD:
 * UI needs different structure than internal registry.
 * This formats data for consumption by React/Vue/etc.
 */
export function getBrowserData(context = {}) {
  const available = getAvailableTokens(context);

  return {
    types: Object.keys(types).map(key => ({
      id: key,
      name: types[key].name,
      description: types[key].description,
      available: available.includes(types[key]),
      tokens: Object.keys(types[key].tokens).map(tokenKey => ({
        id: tokenKey,
        name: types[key].tokens[tokenKey].name,
        description: types[key].tokens[tokenKey].description,
        token: `[${key}:${tokenKey}]`,
        example: types[key].tokens[tokenKey].example || '',
      })),
    })),
  };
}

/**
 * HTML escape utility
 *
 * WHY INTERNAL:
 * Simple escaping for common cases. Not a full sanitization library.
 * Complex HTML needs proper sanitizer. This prevents basic XSS.
 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, char => map[char]);
}

/**
 * Register core token types and handlers
 *
 * WHY INTERNAL:
 * Called by init(). Separated for clarity.
 * These are the built-in tokens every system has.
 */
function registerCoreTypes() {
  // Site tokens
  registerType('site', {
    name: 'Site information',
    description: 'Tokens related to the site',
    tokens: {
      name: { name: 'Site name', description: 'The name of the site', example: 'My CMS Site' },
      url: { name: 'Site URL', description: 'The base URL of the site', example: 'https://example.com' },
      slogan: { name: 'Site slogan', description: 'The site slogan', example: 'Building the future' },
      mail: { name: 'Site email', description: 'The site contact email', example: 'admin@example.com' },
    },
  });

  registerToken('site', 'name', (ctx) => ctx.site?.name || 'Site Name');
  registerToken('site', 'url', (ctx) => ctx.site?.url || 'http://localhost');
  registerToken('site', 'slogan', (ctx) => ctx.site?.slogan || '');
  registerToken('site', 'mail', (ctx) => ctx.site?.mail || '');

  // Date tokens
  registerType('date', {
    name: 'Current date/time',
    description: 'Tokens for current date and time',
    tokens: {
      short: { name: 'Short date', description: 'Short date format', example: '02/03/2026' },
      medium: { name: 'Medium date', description: 'Medium date format', example: 'Feb 3, 2026' },
      long: { name: 'Long date', description: 'Long date format', example: 'February 3, 2026' },
      timestamp: { name: 'Unix timestamp', description: 'Unix timestamp in seconds', example: '1738540800' },
    },
  });

  registerToken('date', 'short', () => {
    const now = new Date();
    return now.toLocaleDateString('en-US');
  });

  registerToken('date', 'medium', () => {
    const now = new Date();
    return now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  });

  registerToken('date', 'long', () => {
    const now = new Date();
    return now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  });

  registerToken('date', 'timestamp', () => {
    return Math.floor(Date.now() / 1000);
  });

  // Current user tokens
  registerType('current-user', {
    name: 'Current user',
    description: 'Tokens for the currently logged in user',
    tokens: {
      name: { name: 'User name', description: 'The username', example: 'johndoe' },
      email: { name: 'User email', description: 'The user email address', example: 'john@example.com' },
      id: { name: 'User ID', description: 'The user ID', example: '123' },
      role: { name: 'User role', description: 'The user primary role', example: 'editor' },
    },
  });

  registerToken('current-user', 'name', (ctx) => {
    const user = ctx.user || ctx.currentUser;
    return user?.name || user?.username || 'Anonymous';
  });

  registerToken('current-user', 'email', (ctx) => {
    const user = ctx.user || ctx.currentUser;
    return user?.email || '';
  });

  registerToken('current-user', 'id', (ctx) => {
    const user = ctx.user || ctx.currentUser;
    return user?.id || '';
  });

  registerToken('current-user', 'role', (ctx) => {
    const user = ctx.user || ctx.currentUser;
    return user?.role || user?.roles?.[0] || '';
  });

  // Content tokens
  registerType('content', {
    name: 'Content',
    description: 'Tokens related to content entities',
    tokens: {
      id: { name: 'Content ID', description: 'The content ID', example: '456' },
      type: { name: 'Content type', description: 'The content type', example: 'article' },
      title: { name: 'Content title', description: 'The content title', example: 'My Article' },
      created: { name: 'Created date', description: 'When the content was created', example: '2026-02-03' },
      updated: { name: 'Updated date', description: 'When the content was last updated', example: '2026-02-03' },
      author: { name: 'Author', description: 'The content author (object with name, email)', example: 'John Doe' },
      field: { name: 'Field value', description: 'Access content fields (use chain: [content:field:body])', example: 'Field content' },
    },
  });

  registerToken('content', 'id', (ctx) => ctx.content?.id || '');
  registerToken('content', 'type', (ctx) => ctx.content?.type || '');
  registerToken('content', 'title', (ctx) => ctx.content?.title || '');
  registerToken('content', 'created', (ctx) => {
    if (!ctx.content?.created) return '';
    const date = new Date(ctx.content.created);
    return date.toISOString().split('T')[0];
  });
  registerToken('content', 'updated', (ctx) => {
    if (!ctx.content?.updated) return '';
    const date = new Date(ctx.content.updated);
    return date.toISOString().split('T')[0];
  });
  registerToken('content', 'author', (ctx) => ctx.content?.author || null);
  registerToken('content', 'field', (ctx, chain) => {
    if (!ctx.content?.fields || chain.length === 0) return '';
    return ctx.content.fields[chain[0]] || '';
  });

  // Term tokens (taxonomy)
  registerType('term', {
    name: 'Taxonomy term',
    description: 'Tokens for taxonomy terms',
    tokens: {
      id: { name: 'Term ID', description: 'The term ID', example: '789' },
      name: { name: 'Term name', description: 'The term name', example: 'Technology' },
      vocabulary: { name: 'Vocabulary', description: 'The vocabulary name', example: 'categories' },
      parent: { name: 'Parent term', description: 'The parent term (object)', example: 'News' },
    },
  });

  registerToken('term', 'id', (ctx) => ctx.term?.id || '');
  registerToken('term', 'name', (ctx) => ctx.term?.name || '');
  registerToken('term', 'vocabulary', (ctx) => ctx.term?.vocabulary || '');
  registerToken('term', 'parent', (ctx) => ctx.term?.parent || null);
}

// Auto-initialize with defaults
init();
