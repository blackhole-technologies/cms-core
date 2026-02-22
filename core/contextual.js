/**
 * contextual.js - Contextual Links System for In-Place Editing
 *
 * WHY THIS EXISTS:
 * Provides edit/delete/manage links that appear when hovering over content.
 * Similar to Drupal's contextual links - shows actions relevant to the
 * specific piece of content being viewed.
 *
 * DESIGN DECISIONS:
 * =================
 *
 * 1. CONTEXT TYPES
 *    Different types of content need different links:
 *    - content: edit, delete, translate
 *    - block: configure, delete
 *    - menu: edit items, reorder, delete
 *    - view: configure, duplicate, export
 *
 * 2. PERMISSION CHECKING
 *    Only show links the user can access.
 *    Integrates with permissions.js for granular control.
 *
 * 3. LINK GROUPS
 *    Links organized by action type:
 *    - primary: edit, view
 *    - secondary: translate, clone
 *    - danger: delete, unpublish
 *
 * 4. DYNAMIC LINKS
 *    Links computed at runtime based on context.
 *    Template variables replaced with actual values.
 *    Conditional links show based on content state.
 *
 * 5. DESTINATIONS
 *    After action, return to current page.
 *    Destination passed as query param.
 *
 * 6. AJAX SUPPORT
 *    Provides data attributes for JS-based editing.
 *    Can render full HTML or just data for client-side rendering.
 *
 * @module contextual
 */

import * as hooks from './hooks.ts';

/**
 * Registered contextual link definitions
 * Structure: Map<contextType, Map<linkId, config>>
 *
 * WHY NESTED MAPS:
 * Fast lookup by context type, then by link ID.
 * Makes adding/removing links efficient.
 */
const registry = new Map();

/**
 * Permissions module reference (set by init)
 */
let permissionsModule = null;

/**
 * Router module reference (set by init)
 */
let routerModule = null;

/**
 * Current destination URL (for "return to this page")
 */
let currentDestination = null;

/**
 * Initialize contextual links system
 *
 * @param {Object} permissions - Permissions module
 * @param {Object} router - Router module
 *
 * WHY DEPENDENCY INJECTION:
 * Contextual links need to check permissions and build URLs.
 * Injecting dependencies makes testing easier and avoids circular imports.
 */
export function init(permissions, router) {
  permissionsModule = permissions;
  routerModule = router;
}

/**
 * Register contextual links for a context type
 *
 * @param {string} contextType - Context type (e.g., 'content', 'block')
 * @param {Object} links - Link definitions
 *
 * @example
 * register('content', {
 *   'edit': {
 *     title: 'Edit',
 *     path: '/admin/content/{{type}}/{{id}}/edit',
 *     permission: 'content.{{type}}.edit',
 *     weight: 0,
 *     icon: 'edit'
 *   }
 * });
 */
export function register(contextType, links) {
  if (!contextType || typeof contextType !== 'string') {
    throw new TypeError('Context type must be a non-empty string');
  }

  if (!links || typeof links !== 'object') {
    throw new TypeError('Links must be an object');
  }

  // Get or create context map
  if (!registry.has(contextType)) {
    registry.set(contextType, new Map());
  }

  const contextMap = registry.get(contextType);

  // Add each link
  for (const [linkId, config] of Object.entries(links)) {
    validateLinkConfig(config);
    contextMap.set(linkId, normalizeConfig(config));
  }
}

/**
 * Validate link configuration
 *
 * @param {Object} config - Link config
 * @throws {TypeError} If config is invalid
 */
function validateLinkConfig(config) {
  if (!config.title || typeof config.title !== 'string') {
    throw new TypeError('Link config must have a title string');
  }

  if (!config.path || typeof config.path !== 'string') {
    throw new TypeError('Link config must have a path string');
  }

  if (config.weight !== undefined && typeof config.weight !== 'number') {
    throw new TypeError('Link weight must be a number');
  }

  if (config.condition && typeof config.condition !== 'function') {
    throw new TypeError('Link condition must be a function');
  }
}

/**
 * Normalize link configuration
 *
 * @param {Object} config - Raw config
 * @returns {Object} - Normalized config
 */
function normalizeConfig(config) {
  return {
    title: config.title,
    path: config.path,
    permission: config.permission || null,
    weight: config.weight ?? 10,
    icon: config.icon || null,
    confirm: config.confirm || null,
    condition: config.condition || null,
    group: config.group || 'primary',
    attributes: config.attributes || {},
  };
}

/**
 * Add a single link to a context type
 *
 * @param {string} contextType - Context type
 * @param {string} linkId - Link identifier
 * @param {Object} config - Link configuration
 */
export function addLink(contextType, linkId, config) {
  if (!registry.has(contextType)) {
    registry.set(contextType, new Map());
  }

  validateLinkConfig(config);

  const contextMap = registry.get(contextType);
  contextMap.set(linkId, normalizeConfig(config));
}

/**
 * Remove a link from a context type
 *
 * @param {string} contextType - Context type
 * @param {string} linkId - Link identifier
 * @returns {boolean} - True if link was removed
 */
export function removeLink(contextType, linkId) {
  if (!registry.has(contextType)) {
    return false;
  }

  const contextMap = registry.get(contextType);
  return contextMap.delete(linkId);
}

/**
 * Replace template variables in a string
 *
 * @param {string} template - Template string with {{var}} placeholders
 * @param {Object} context - Context data
 * @returns {string} - String with variables replaced
 *
 * WHY DOUBLE BRACES:
 * Common template syntax, easy to spot in URLs.
 * Example: /admin/content/{{type}}/{{id}}/edit
 */
function replaceTemplateVars(template, context) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    // Look for key in context, support nested paths
    const value = getNestedValue(context, key);
    return value !== undefined ? String(value) : match;
  });
}

/**
 * Get nested value from object by path
 *
 * @param {Object} obj - Object to search
 * @param {string} path - Dot-separated path (e.g., 'user.id')
 * @returns {*} - Value or undefined
 */
function getNestedValue(obj, path) {
  const keys = path.split('.');
  let value = obj;

  for (const key of keys) {
    if (value && typeof value === 'object' && key in value) {
      value = value[key];
    } else {
      return undefined;
    }
  }

  return value;
}

/**
 * Check if user has permission for a link
 *
 * @param {Object} user - User object
 * @param {string} permission - Permission string (may have templates)
 * @param {Object} context - Context data
 * @returns {Promise<boolean>} - True if user has permission
 */
async function checkLinkPermission(user, permission, context) {
  if (!permission) {
    // No permission required
    return true;
  }

  if (!permissionsModule) {
    console.warn('[contextual] Permissions module not initialized');
    return false;
  }

  // Replace template vars in permission string
  const actualPermission = replaceTemplateVars(permission, context);

  return await permissionsModule.hasPermission(user, actualPermission);
}

/**
 * Check if link condition is met
 *
 * @param {Function|null} condition - Condition function
 * @param {Object} context - Context data
 * @returns {boolean} - True if condition met or no condition
 */
function checkCondition(condition, context) {
  if (!condition) {
    return true;
  }

  try {
    return Boolean(condition(context));
  } catch (error) {
    console.error('[contextual] Error in link condition:', error.message);
    return false;
  }
}

/**
 * Get links for a context
 *
 * @param {string} contextType - Context type
 * @param {Object} context - Context data (content, block, etc.)
 * @param {Object} user - Current user
 * @returns {Promise<Array>} - Array of link objects
 *
 * PROCESS:
 * 1. Get registered links for context type
 * 2. Filter by permission
 * 3. Filter by condition
 * 4. Replace template variables
 * 5. Sort by weight
 * 6. Emit hook for alteration
 */
export async function getLinks(contextType, context = {}, user = null) {
  if (!registry.has(contextType)) {
    return [];
  }

  const contextMap = registry.get(contextType);
  const links = [];

  // Process each registered link
  for (const [linkId, config] of contextMap.entries()) {
    // Check permission
    const hasPermission = await checkLinkPermission(user, config.permission, context);
    if (!hasPermission) {
      continue;
    }

    // Check condition
    if (!checkCondition(config.condition, context)) {
      continue;
    }

    // Build link object
    const link = {
      id: linkId,
      title: replaceTemplateVars(config.title, context),
      path: replaceTemplateVars(config.path, context),
      weight: config.weight,
      icon: config.icon,
      confirm: config.confirm,
      group: config.group,
      attributes: { ...config.attributes },
    };

    // Add destination param
    if (currentDestination) {
      link.path += (link.path.includes('?') ? '&' : '?') + `destination=${encodeURIComponent(currentDestination)}`;
    }

    links.push(link);
  }

  // Sort by weight
  links.sort((a, b) => a.weight - b.weight);

  // Allow modules to alter links
  const hookContext = {
    contextType,
    context,
    user,
    links,
  };

  await hooks.trigger('contextual:alter', hookContext);

  return hookContext.links;
}

/**
 * Render links as HTML
 *
 * @param {string} contextType - Context type
 * @param {Object} context - Context data
 * @param {Object} user - Current user
 * @returns {Promise<string>} - HTML string
 *
 * OUTPUT FORMAT:
 * <div class="contextual-links" data-context-type="content">
 *   <button class="contextual-trigger">Actions</button>
 *   <ul class="contextual-menu">
 *     <li class="contextual-link primary">
 *       <a href="/path" data-icon="edit">Edit</a>
 *     </li>
 *   </ul>
 * </div>
 */
export async function renderLinks(contextType, context = {}, user = null) {
  const links = await getLinks(contextType, context, user);

  if (links.length === 0) {
    return '';
  }

  // Emit render hook
  const hookContext = {
    contextType,
    context,
    user,
    links,
    html: null,
  };

  await hooks.trigger('contextual:render', hookContext);

  // If hook provided HTML, use that
  if (hookContext.html) {
    return hookContext.html;
  }

  // Generate default HTML
  const menuItems = links.map(link => {
    const attrs = [`href="${escapeHtml(link.path)}"`];

    if (link.icon) {
      attrs.push(`data-icon="${escapeHtml(link.icon)}"`);
    }

    if (link.confirm) {
      attrs.push(`data-confirm="${escapeHtml(link.confirm)}"`);
    }

    // Add custom attributes
    for (const [key, value] of Object.entries(link.attributes)) {
      attrs.push(`${escapeHtml(key)}="${escapeHtml(String(value))}"`);
    }

    return `    <li class="contextual-link ${escapeHtml(link.group)}">
      <a ${attrs.join(' ')}>${escapeHtml(link.title)}</a>
    </li>`;
  }).join('\n');

  return `<div class="contextual-links" data-context-type="${escapeHtml(contextType)}">
  <button class="contextual-trigger" aria-label="Show actions">⋮</button>
  <ul class="contextual-menu" hidden>
${menuItems}
  </ul>
</div>`;
}

/**
 * Render wrapper with contextual links
 *
 * @param {string} content - Content HTML
 * @param {string} contextType - Context type
 * @param {Object} context - Context data
 * @param {Object} user - Current user
 * @returns {Promise<string>} - HTML with contextual links wrapper
 *
 * OUTPUT:
 * <div class="contextual-wrapper">
 *   [contextual links]
 *   [content]
 * </div>
 */
export async function renderWrapper(content, contextType, context = {}, user = null) {
  const linksHtml = await renderLinks(contextType, context, user);

  if (!linksHtml) {
    // No links, return content as-is
    return content;
  }

  return `<div class="contextual-wrapper" data-context-id="${escapeHtml(context.id || 'unknown')}">
  ${linksHtml}
  ${content}
</div>`;
}

/**
 * Check if any links exist for a context
 *
 * @param {string} contextType - Context type
 * @param {Object} context - Context data
 * @param {Object} user - Current user
 * @returns {Promise<boolean>} - True if any links available
 *
 * WHY THIS EXISTS:
 * Avoid expensive rendering if no links will show.
 * Can skip wrapper div entirely if no contextual links.
 */
export async function hasAnyLinks(contextType, context = {}, user = null) {
  const links = await getLinks(contextType, context, user);
  return links.length > 0;
}

/**
 * Set destination URL for return navigation
 *
 * @param {string} url - Destination URL
 *
 * WHY THIS EXISTS:
 * After editing content, user should return to the page they came from.
 * Set this to current page URL before rendering contextual links.
 */
export function setDestination(url) {
  currentDestination = url;
}

/**
 * Get current destination URL
 *
 * @returns {string|null} - Current destination or null
 */
export function getDestination() {
  return currentDestination;
}

/**
 * Clear current destination
 */
export function clearDestination() {
  currentDestination = null;
}

/**
 * Escape HTML special characters
 *
 * @param {string} str - String to escape
 * @returns {string} - Escaped string
 *
 * WHY NOT USE A LIBRARY:
 * Simple operation, no need for external dependency.
 * Protects against XSS in link attributes.
 */
function escapeHtml(str) {
  if (typeof str !== 'string') {
    return '';
  }

  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Get all registered context types
 *
 * @returns {string[]} - Array of context types
 */
export function listContextTypes() {
  return Array.from(registry.keys());
}

/**
 * Get all links for a context type (raw configs)
 *
 * @param {string} contextType - Context type
 * @returns {Object} - Link configs by ID
 */
export function getLinkConfigs(contextType) {
  if (!registry.has(contextType)) {
    return {};
  }

  const contextMap = registry.get(contextType);
  const result = {};

  for (const [linkId, config] of contextMap.entries()) {
    result[linkId] = { ...config };
  }

  return result;
}

/**
 * Clear all links for a context type
 *
 * @param {string} contextType - Context type
 * @returns {boolean} - True if context type existed
 */
export function clearContext(contextType) {
  return registry.delete(contextType);
}

/**
 * Clear all contextual links (mainly for testing)
 */
export function clear() {
  registry.clear();
}

/**
 * Check if contextual system is initialized
 *
 * @returns {boolean} - True if initialized
 */
export function isInitialized() {
  return permissionsModule !== null && routerModule !== null;
}
