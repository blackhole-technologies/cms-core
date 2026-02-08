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
  pattern: /\[([a-zA-Z0-9_-]+):([a-zA-Z0-9_:\-\/ ]+)\]/g,
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
 * Render token tree for hierarchical display
 *
 * @param {Array|string} tokenTypes - Token types to include (array or single type)
 * @param {Object} options - Tree rendering options
 * @param {number} options.maxDepth - Maximum tree depth (default: 3)
 * @param {boolean} options.sorted - Sort categories and tokens alphabetically (default: true)
 * @param {Object} options.context - Context for availability filtering
 * @returns {Array} - Hierarchical tree structure
 *
 * WHY TREE STRUCTURE:
 * Token browser UI needs to show nested tokens hierarchically.
 * E.g., [node:author:name] should appear as: Node > Author > Name
 * Tree makes it easier for users to discover available tokens.
 *
 * TREE STRUCTURE:
 * [
 *   {
 *     type: 'node',
 *     label: 'Node (content)',
 *     description: 'Tokens for content nodes',
 *     tokens: [
 *       {
 *         name: 'title',
 *         label: 'Node title',
 *         description: 'The node title',
 *         token: '[node:title]',
 *         children: []
 *       },
 *       {
 *         name: 'author',
 *         label: 'Author',
 *         description: 'The node author',
 *         token: '[node:author]',
 *         children: [
 *           { name: 'name', label: 'Name', token: '[node:author:name]', children: [] }
 *         ]
 *       }
 *     ]
 *   }
 * ]
 */
export function getTokenTree(tokenTypes = null, options = {}) {
  const {
    maxDepth = 3,
    sorted = true,
    context = {},
  } = options;

  // Determine which types to include
  let typeKeys;
  if (tokenTypes === null) {
    typeKeys = Object.keys(types);
  } else if (Array.isArray(tokenTypes)) {
    typeKeys = tokenTypes.filter(t => types[t]);
  } else if (typeof tokenTypes === 'string') {
    typeKeys = types[tokenTypes] ? [tokenTypes] : [];
  } else {
    typeKeys = [];
  }

  // Build tree structure
  const tree = typeKeys.map(typeKey => {
    const typeInfo = types[typeKey];

    return {
      type: typeKey,
      label: typeInfo.name,
      description: typeInfo.description,
      tokens: buildTokensForType(typeKey, typeInfo, maxDepth),
    };
  });

  // Sort if requested
  if (sorted) {
    tree.sort((a, b) => a.label.localeCompare(b.label));
    tree.forEach(category => {
      sortTokenTree(category.tokens);
    });
  }

  return tree;
}

/**
 * Build token list for a specific type
 *
 * WHY SEPARATE FUNCTION:
 * Recursively builds nested token structures.
 * Keeps getTokenTree() clean and readable.
 */
function buildTokensForType(typeKey, typeInfo, maxDepth, currentDepth = 1) {
  if (currentDepth > maxDepth) {
    return [];
  }

  const tokensList = [];

  for (const [tokenName, tokenDef] of Object.entries(typeInfo.tokens)) {
    const tokenItem = {
      name: tokenName,
      label: tokenDef.name,
      description: tokenDef.description,
      token: `[${typeKey}:${tokenName}]`,
      example: tokenDef.example || '',
      children: [],
    };

    // Check if this token can have children (object-returning tokens)
    // E.g., [node:author] returns an object, so it can have :name, :email children
    // We detect this by checking if handler returns object type
    // For now, we use a heuristic: tokens named 'author', 'user', 'parent' likely have children
    const hasChildren = ['author', 'user', 'parent', 'term'].includes(tokenName);

    if (hasChildren && currentDepth < maxDepth) {
      // Add common child tokens for entity references
      const childTokens = getChildTokensFor(tokenName);
      tokenItem.children = childTokens.map(child => ({
        name: child.name,
        label: child.label,
        description: child.description,
        token: `[${typeKey}:${tokenName}:${child.name}]`,
        example: child.example || '',
        children: [],
      }));
    }

    tokensList.push(tokenItem);
  }

  return tokensList;
}

/**
 * Get child tokens for entity reference tokens
 *
 * WHY HARDCODED:
 * In a full implementation, this would introspect the handler return type.
 * For now, we use common entity field patterns.
 */
function getChildTokensFor(tokenName) {
  const childMap = {
    author: [
      { name: 'name', label: 'Author name', description: 'The author\'s username' },
      { name: 'mail', label: 'Author email', description: 'The author\'s email address' },
      { name: 'uid', label: 'Author ID', description: 'The author\'s user ID' },
    ],
    user: [
      { name: 'name', label: 'User name', description: 'The username' },
      { name: 'mail', label: 'User email', description: 'The user email address' },
      { name: 'uid', label: 'User ID', description: 'The user ID' },
    ],
    parent: [
      { name: 'name', label: 'Parent name', description: 'The parent entity name' },
      { name: 'id', label: 'Parent ID', description: 'The parent entity ID' },
    ],
    term: [
      { name: 'name', label: 'Term name', description: 'The term name' },
      { name: 'tid', label: 'Term ID', description: 'The term ID' },
      { name: 'vocabulary', label: 'Vocabulary', description: 'The vocabulary machine name' },
    ],
  };

  return childMap[tokenName] || [];
}

/**
 * Recursively sort token tree by label
 */
function sortTokenTree(tokens) {
  tokens.sort((a, b) => a.label.localeCompare(b.label));
  tokens.forEach(token => {
    if (token.children && token.children.length > 0) {
      sortTokenTree(token.children);
    }
  });
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
      custom: { name: 'Custom format', description: 'Custom date format using PHP-style format codes (use chain: [date:custom:Y-m-d])', example: '2026-02-08' },
    },
  });

  registerToken('date', 'short', (ctx) => {
    const now = new Date();
    const timezone = ctx.site?.timezone || 'America/Los_Angeles';
    return now.toLocaleDateString('en-US', { timeZone: timezone });
  });

  registerToken('date', 'medium', (ctx) => {
    const now = new Date();
    const timezone = ctx.site?.timezone || 'America/Los_Angeles';
    return now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: timezone });
  });

  registerToken('date', 'long', (ctx) => {
    const now = new Date();
    const timezone = ctx.site?.timezone || 'America/Los_Angeles';
    return now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: timezone });
  });

  registerToken('date', 'timestamp', () => {
    return Math.floor(Date.now() / 1000);
  });

  registerToken('date', 'custom', (ctx, chain) => {
    // Custom date format using PHP-style format codes
    // chain contains all parts after 'custom' (e.g., ['H', 'i', 's'] from [date:custom:H:i:s])
    // We need to join them back with ':' to reconstruct the format string
    if (!chain || chain.length === 0) {
      return new Date().toISOString().split('T')[0]; // Default to YYYY-MM-DD
    }

    // Reconstruct format string from chain parts (handles colons in format)
    const format = chain.join(':');
    const now = new Date();

    // PHP-style format code mappings to JavaScript
    const formatMap = {
      'Y': now.getFullYear().toString(),
      'm': String(now.getMonth() + 1).padStart(2, '0'),
      'd': String(now.getDate()).padStart(2, '0'),
      'H': String(now.getHours()).padStart(2, '0'),
      'i': String(now.getMinutes()).padStart(2, '0'),
      's': String(now.getSeconds()).padStart(2, '0'),
      'y': now.getFullYear().toString().slice(-2),
      'n': (now.getMonth() + 1).toString(),
      'j': now.getDate().toString(),
      'g': (now.getHours() % 12 || 12).toString(),
      'G': now.getHours().toString(),
      'a': now.getHours() < 12 ? 'am' : 'pm',
      'A': now.getHours() < 12 ? 'AM' : 'PM',
    };

    // Replace format codes
    let result = format;
    for (const [code, value] of Object.entries(formatMap)) {
      result = result.split(code).join(value);
    }

    return result;
  });

  // Current user tokens
  registerType('current-user', {
    name: 'Current user',
    description: 'Tokens for the currently logged in user',
    tokens: {
      name: { name: 'User name', description: 'The username', example: 'johndoe' },
      email: { name: 'User email', description: 'The user email address', example: 'john@example.com' },
      id: { name: 'User ID', description: 'The user ID', example: '123' },
      uid: { name: 'User ID (alias)', description: 'The user ID (Drupal alias for id)', example: '123' },
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

  registerToken('current-user', 'uid', (ctx) => {
    const user = ctx.user || ctx.currentUser;
    return user?.id || user?.uid || '';
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
  registerToken('term', 'name', (ctx) => ctx.term?.name || null);
  registerToken('term', 'vocabulary', (ctx) => ctx.term?.vocabulary || null);
  registerToken('term', 'parent', (ctx) => ctx.term?.parent || null);

  // Request tokens (HTTP request context)
  registerType('request', {
    name: 'Request context',
    description: 'Tokens for the current HTTP request',
    tokens: {
      path: { name: 'Request path', description: 'The current request path', example: '/admin/content' },
      query: { name: 'Query parameter', description: 'Extract query parameter (use chain: [request:query:page])', example: '1' },
      method: { name: 'HTTP method', description: 'The HTTP request method', example: 'GET' },
      host: { name: 'Host name', description: 'The request hostname', example: 'localhost:3001' },
      protocol: { name: 'Protocol', description: 'The request protocol', example: 'http' },
    },
  });

  registerToken('request', 'path', (ctx) => {
    const req = ctx.request || ctx.req;
    return req?.path || req?.url?.split('?')[0] || '';
  });

  registerToken('request', 'query', (ctx, chain) => {
    // chain[0] contains the query parameter name (e.g., 'page' from [request:query:page])
    if (!chain || chain.length === 0) return '';

    const req = ctx.request || ctx.req;
    const paramName = chain[0];

    // Try to get from req.query (Express-style)
    if (req?.query && req.query[paramName]) {
      return req.query[paramName];
    }

    // Fall back to parsing URL query string
    if (req?.url) {
      const url = new URL(req.url, 'http://localhost');
      return url.searchParams.get(paramName) || '';
    }

    return '';
  });

  registerToken('request', 'method', (ctx) => {
    const req = ctx.request || ctx.req;
    return req?.method || '';
  });

  registerToken('request', 'host', (ctx) => {
    const req = ctx.request || ctx.req;
    return req?.headers?.host || req?.hostname || '';
  });

  registerToken('request', 'protocol', (ctx) => {
    const req = ctx.request || ctx.req;
    return req?.protocol || (req?.headers?.['x-forwarded-proto']) || 'http';
  });
}

/**
 * Register entity token providers (Drupal-style)
 *
 * WHY SEPARATE FUNCTION:
 * Entity tokens (node, user, term) follow Drupal conventions with specific naming.
 * This provides aliases to the generic content/term types with Drupal-style tokens.
 *
 * ENTITY TYPES COVERED:
 * - node: Content entities (articles, pages, etc.)
 * - user: User entities
 * - term: Taxonomy term entities
 */
export function registerEntityProviders() {
  // Node tokens (Drupal-style content entity tokens)
  registerType('node', {
    name: 'Node (content)',
    description: 'Tokens for content nodes (articles, pages, etc.)',
    tokens: {
      nid: { name: 'Node ID', description: 'The node ID', example: '123' },
      title: { name: 'Node title', description: 'The node title', example: 'My Article' },
      type: { name: 'Content type', description: 'The content type machine name', example: 'article' },
      created: { name: 'Created date', description: 'When the node was created', example: '2026-02-08' },
      changed: { name: 'Changed date', description: 'When the node was last modified', example: '2026-02-08' },
      author: { name: 'Author', description: 'The node author (object with name, email, uid)', example: 'admin' },
      status: { name: 'Published status', description: 'Published or unpublished', example: 'published' },
      body: { name: 'Body field', description: 'The node body content', example: 'Article content...' },
    },
  });

  registerToken('node', 'nid', (ctx) => {
    const node = ctx.node || ctx.content;
    return node?.id || null;
  });

  registerToken('node', 'title', (ctx) => {
    const node = ctx.node || ctx.content;
    return node?.title || null;
  });

  registerToken('node', 'type', (ctx) => {
    const node = ctx.node || ctx.content;
    return node?.type || null;
  });

  registerToken('node', 'created', (ctx) => {
    const node = ctx.node || ctx.content;
    if (!node?.created) return null;
    const date = new Date(node.created);
    return date.toISOString().split('T')[0];
  });

  registerToken('node', 'changed', (ctx) => {
    const node = ctx.node || ctx.content;
    const timestamp = node?.updated || node?.changed;
    if (!timestamp) return null;
    const date = new Date(timestamp);
    return date.toISOString().split('T')[0];
  });

  registerToken('node', 'author', (ctx) => {
    const node = ctx.node || ctx.content;
    return node?.author || null;
  });

  registerToken('node', 'status', (ctx) => {
    const node = ctx.node || ctx.content;
    return node?.status || null;
  });

  registerToken('node', 'body', (ctx) => {
    const node = ctx.node || ctx.content;
    return node?.body || null;
  });

  // User tokens (Drupal-style user entity tokens)
  registerType('user', {
    name: 'User',
    description: 'Tokens for user entities',
    tokens: {
      uid: { name: 'User ID', description: 'The user ID', example: '1' },
      name: { name: 'Username', description: 'The username', example: 'admin' },
      mail: { name: 'Email address', description: 'The user email address', example: 'admin@example.com' },
      created: { name: 'Created date', description: 'When the user account was created', example: '2026-01-01' },
      access: { name: 'Last access', description: 'When the user last accessed the site', example: '2026-02-08' },
      roles: { name: 'User roles', description: 'The user roles (array)', example: 'administrator' },
    },
  });

  registerToken('user', 'uid', (ctx) => {
    const user = ctx.user || ctx.currentUser;
    return user?.id || null;
  });

  registerToken('user', 'name', (ctx) => {
    const user = ctx.user || ctx.currentUser;
    return user?.name || user?.username || null;
  });

  registerToken('user', 'mail', (ctx) => {
    const user = ctx.user || ctx.currentUser;
    return user?.email || user?.mail || null;
  });

  registerToken('user', 'created', (ctx) => {
    const user = ctx.user || ctx.currentUser;
    if (!user?.created) return null;
    const date = new Date(user.created);
    return date.toISOString().split('T')[0];
  });

  registerToken('user', 'access', (ctx) => {
    const user = ctx.user || ctx.currentUser;
    const timestamp = user?.access || user?.lastAccess;
    if (!timestamp) return null;
    const date = new Date(timestamp);
    return date.toISOString().split('T')[0];
  });

  registerToken('user', 'roles', (ctx) => {
    const user = ctx.user || ctx.currentUser;
    return user?.roles || user?.role || null;
  });

  // Term tokens (Drupal-style taxonomy term tokens)
  // Note: These enhance the existing 'term' type with Drupal naming conventions
  const existingTermType = getTokens('term');
  if (existingTermType) {
    // Add 'tid' as alias for 'id'
    registerToken('term', 'tid', (ctx) => ctx.term?.id || null);
  }
}

// Auto-initialize with defaults
init();
registerEntityProviders();
