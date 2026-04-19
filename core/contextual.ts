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

// ============================================================================
// Types
// ============================================================================

/** Arbitrary context data passed when resolving a link (entity snapshot). */
type ContextData = Record<string, unknown>;

/** User object supplied to permission checks. Shape depends on auth layer. */
type User = unknown;

/**
 * Condition function for showing a link — receives the context object and
 * returns a boolean. Any throw is caught and treated as "do not show".
 */
type ConditionFn = (context: ContextData) => boolean;

/** Raw link definition as passed to register()/addLink(). */
interface RawLinkConfig {
  title: string;
  path: string;
  permission?: string | null;
  weight?: number;
  icon?: string | null;
  confirm?: string | null;
  condition?: ConditionFn | null;
  group?: string;
  attributes?: Record<string, string | number | boolean>;
}

/** Normalized link configuration stored in the registry. */
interface NormalizedLinkConfig {
  title: string;
  path: string;
  permission: string | null;
  weight: number;
  icon: string | null;
  confirm: string | null;
  condition: ConditionFn | null;
  group: string;
  attributes: Record<string, string | number | boolean>;
}

/** Link returned from getLinks() after resolution and sorting. */
interface ResolvedLink {
  id: string;
  title: string;
  path: string;
  weight: number;
  icon: string | null;
  confirm: string | null;
  group: string;
  attributes: Record<string, string | number | boolean>;
}

/** Permissions module interface (injected via init). */
interface PermissionsModule {
  hasPermission(user: User, permission: string): boolean | Promise<boolean>;
}

/** Router module interface (injected via init). */
interface RouterModule {
  // Router is opaque to this module — we never call it directly,
  // but keep the reference to mirror the original JS behaviour.
  [key: string]: unknown;
}

/** Hook context passed to contextual:alter / contextual:render. */
interface ContextualHookContext {
  contextType: string;
  context: ContextData;
  user: User;
  links: ResolvedLink[];
  html?: string | null;
  /** Allow hook handlers to attach additional keys. */
  [key: string]: unknown;
}

// ============================================================================
// Module state
// ============================================================================

/**
 * Registered contextual link definitions
 * Structure: Map<contextType, Map<linkId, config>>
 *
 * WHY NESTED MAPS:
 * Fast lookup by context type, then by link ID.
 * Makes adding/removing links efficient.
 */
const registry: Map<string, Map<string, NormalizedLinkConfig>> = new Map();

/**
 * Permissions module reference (set by init)
 */
let permissionsModule: PermissionsModule | null = null;

/**
 * Router module reference (set by init)
 */
let routerModule: RouterModule | null = null;

/**
 * Current destination URL (for "return to this page")
 */
let currentDestination: string | null = null;

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize contextual links system
 *
 * WHY DEPENDENCY INJECTION:
 * Contextual links need to check permissions and build URLs.
 * Injecting dependencies makes testing easier and avoids circular imports.
 */
export function init(permissions: PermissionsModule, router: RouterModule): void {
  permissionsModule = permissions;
  routerModule = router;
}

/**
 * Register contextual links for a context type
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
export function register(contextType: string, links: Record<string, RawLinkConfig>): void {
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

  const contextMap = registry.get(contextType) as Map<string, NormalizedLinkConfig>;

  // Add each link
  for (const [linkId, config] of Object.entries(links)) {
    validateLinkConfig(config);
    contextMap.set(linkId, normalizeConfig(config));
  }
}

/**
 * Validate link configuration
 *
 * @throws TypeError If config is invalid
 */
function validateLinkConfig(config: RawLinkConfig): void {
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
 */
function normalizeConfig(config: RawLinkConfig): NormalizedLinkConfig {
  return {
    title: config.title,
    path: config.path,
    permission: config.permission ?? null,
    weight: config.weight ?? 10,
    icon: config.icon ?? null,
    confirm: config.confirm ?? null,
    condition: config.condition ?? null,
    group: config.group || 'primary',
    attributes: config.attributes || {},
  };
}

/**
 * Add a single link to a context type
 */
export function addLink(contextType: string, linkId: string, config: RawLinkConfig): void {
  if (!registry.has(contextType)) {
    registry.set(contextType, new Map());
  }

  validateLinkConfig(config);

  const contextMap = registry.get(contextType) as Map<string, NormalizedLinkConfig>;
  contextMap.set(linkId, normalizeConfig(config));
}

/**
 * Remove a link from a context type
 *
 * @returns True if link was removed
 */
export function removeLink(contextType: string, linkId: string): boolean {
  if (!registry.has(contextType)) {
    return false;
  }

  const contextMap = registry.get(contextType) as Map<string, NormalizedLinkConfig>;
  return contextMap.delete(linkId);
}

/**
 * Replace template variables in a string
 *
 * WHY DOUBLE BRACES:
 * Common template syntax, easy to spot in URLs.
 * Example: /admin/content/{{type}}/{{id}}/edit
 */
function replaceTemplateVars(template: string, context: ContextData): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match: string, key: string) => {
    // Look for key in context, support nested paths
    const value = getNestedValue(context, key);
    return value !== undefined ? String(value) : match;
  });
}

/**
 * Get nested value from object by path
 *
 * @param obj - Object to search
 * @param path - Dot-separated path (e.g., 'user.id')
 */
function getNestedValue(obj: ContextData, path: string): unknown {
  const keys = path.split('.');
  let value: unknown = obj;

  for (const key of keys) {
    if (value && typeof value === 'object' && key in (value as Record<string, unknown>)) {
      value = (value as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }

  return value;
}

/**
 * Check if user has permission for a link
 */
async function checkLinkPermission(
  user: User,
  permission: string | null,
  context: ContextData,
): Promise<boolean> {
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
 */
function checkCondition(condition: ConditionFn | null, context: ContextData): boolean {
  if (!condition) {
    return true;
  }

  try {
    return Boolean(condition(context));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[contextual] Error in link condition:', message);
    return false;
  }
}

/**
 * Get links for a context
 *
 * PROCESS:
 * 1. Get registered links for context type
 * 2. Filter by permission
 * 3. Filter by condition
 * 4. Replace template variables
 * 5. Sort by weight
 * 6. Emit hook for alteration
 */
export async function getLinks(
  contextType: string,
  context: ContextData = {},
  user: User = null,
): Promise<ResolvedLink[]> {
  if (!registry.has(contextType)) {
    return [];
  }

  const contextMap = registry.get(contextType) as Map<string, NormalizedLinkConfig>;
  const links: ResolvedLink[] = [];

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
    const link: ResolvedLink = {
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
  const hookContext: ContextualHookContext = {
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
export async function renderLinks(
  contextType: string,
  context: ContextData = {},
  user: User = null,
): Promise<string> {
  const links = await getLinks(contextType, context, user);

  if (links.length === 0) {
    return '';
  }

  // Emit render hook
  const hookContext: ContextualHookContext = {
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
    const attrs: string[] = [`href="${escapeHtml(link.path)}"`];

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
 * OUTPUT:
 * <div class="contextual-wrapper">
 *   [contextual links]
 *   [content]
 * </div>
 */
export async function renderWrapper(
  content: string,
  contextType: string,
  context: ContextData = {},
  user: User = null,
): Promise<string> {
  const linksHtml = await renderLinks(contextType, context, user);

  if (!linksHtml) {
    // No links, return content as-is
    return content;
  }

  const id = (context as { id?: unknown }).id;
  return `<div class="contextual-wrapper" data-context-id="${escapeHtml(String(id ?? 'unknown'))}">
  ${linksHtml}
  ${content}
</div>`;
}

/**
 * Check if any links exist for a context
 *
 * WHY THIS EXISTS:
 * Avoid expensive rendering if no links will show.
 * Can skip wrapper div entirely if no contextual links.
 */
export async function hasAnyLinks(
  contextType: string,
  context: ContextData = {},
  user: User = null,
): Promise<boolean> {
  const links = await getLinks(contextType, context, user);
  return links.length > 0;
}

/**
 * Set destination URL for return navigation
 *
 * WHY THIS EXISTS:
 * After editing content, user should return to the page they came from.
 * Set this to current page URL before rendering contextual links.
 */
export function setDestination(url: string): void {
  currentDestination = url;
}

/**
 * Get current destination URL
 */
export function getDestination(): string | null {
  return currentDestination;
}

/**
 * Clear current destination
 */
export function clearDestination(): void {
  currentDestination = null;
}

/**
 * Escape HTML special characters
 *
 * WHY NOT USE A LIBRARY:
 * Simple operation, no need for external dependency.
 * Protects against XSS in link attributes.
 */
function escapeHtml(str: string): string {
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
 */
export function listContextTypes(): string[] {
  return Array.from(registry.keys());
}

/**
 * Get all links for a context type (raw configs)
 */
export function getLinkConfigs(contextType: string): Record<string, NormalizedLinkConfig> {
  if (!registry.has(contextType)) {
    return {};
  }

  const contextMap = registry.get(contextType) as Map<string, NormalizedLinkConfig>;
  const result: Record<string, NormalizedLinkConfig> = {};

  for (const [linkId, config] of contextMap.entries()) {
    result[linkId] = { ...config };
  }

  return result;
}

/**
 * Clear all links for a context type
 *
 * @returns True if context type existed
 */
export function clearContext(contextType: string): boolean {
  return registry.delete(contextType);
}

/**
 * Clear all contextual links (mainly for testing)
 */
export function clear(): void {
  registry.clear();
}

/**
 * Check if contextual system is initialized
 */
export function isInitialized(): boolean {
  return permissionsModule !== null && routerModule !== null;
}
