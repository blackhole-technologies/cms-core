/**
 * @file
 * Core Renderer for processing render arrays into HTML.
 *
 * Handles element type dispatch, recursive child rendering, weight sorting,
 * access checking, cache metadata bubbling, lazy builder resolution, and
 * prefix/suffix wrapping.
 *
 * Drupal equivalent: Renderer.php, RendererInterface.php
 *
 * @see .autoforge/templates/render-element.js for render array convention
 */

import { RenderArray } from './RenderArray.js';
import { CacheMetadata } from './CacheMetadata.js';

/**
 * Symbol for private element type handler registry.
 *
 * WHY: Use Symbol to prevent external code from directly manipulating the
 * handler registry. All registration must go through registerElementType().
 */
const ELEMENT_TYPES = Symbol('elementTypes');

/**
 * Symbol for infrastructure references (services and hooks).
 *
 * WHY: Matches PluginManager pattern. Infrastructure is wired up after
 * construction via setInfrastructure().
 */
const INFRASTRUCTURE = Symbol('infrastructure');

/**
 * Main renderer class for processing render arrays.
 *
 * WHY: Central orchestrator for the rendering pipeline. Dispatches to element
 * type handlers, manages recursion, bubbles cache metadata, resolves lazy
 * builders, and applies access control.
 */
export class Renderer {
  /**
   * Create a new Renderer instance.
   *
   * WHY: Constructor accepts optional configuration to allow dependency
   * injection and testing. Production code will call discoverElementTypes()
   * during boot to load built-in handlers.
   *
   * @param {Object} [options] - Configuration options
   * @param {Map<string, Object>} [options.elementTypes] - Pre-configured element type handlers
   * @param {Object} [options.hooks] - Hook manager reference
   */
  constructor(options = {}) {
    // WHY: Initialize private handler registry
    this[ELEMENT_TYPES] = options.elementTypes || new Map();

    // WHY: Initialize infrastructure references (set later via setInfrastructure)
    this[INFRASTRUCTURE] = {
      services: null,
      hooks: options.hooks || null
    };
  }

  /**
   * Wire up infrastructure references.
   *
   * WHY: Matches PluginManager pattern. Called during container compilation
   * after all modules are discovered. Separates construction from wiring.
   *
   * @param {Container} services - DI container
   * @param {HookManager} hooks - Hook system
   */
  setInfrastructure(services, hooks) {
    this[INFRASTRUCTURE].services = services;
    this[INFRASTRUCTURE].hooks = hooks;
  }

  /**
   * Register an element type handler.
   *
   * WHY: Element types are extensible — modules can register their own handlers.
   * Handler must have 'type' string and 'render' async method.
   *
   * @param {Object} handler - Element type handler
   * @param {string} handler.type - Element type identifier
   * @param {Function} handler.render - Async render method (element, renderer) => HTML
   * @throws {Error} If handler is missing type or render method
   */
  registerElementType(handler) {
    // WHY: Validate handler has required interface
    if (!handler || typeof handler !== 'object') {
      throw new Error('Element type handler must be an object');
    }

    if (!handler.type || typeof handler.type !== 'string') {
      throw new Error('Element type handler must have a "type" string property');
    }

    if (typeof handler.render !== 'function') {
      throw new Error(`Element type handler "${handler.type}" must have a "render" method`);
    }

    // WHY: Store handler keyed by type for O(1) lookup during rendering
    this[ELEMENT_TYPES].set(handler.type, handler);
  }

  /**
   * Discover and register built-in element types.
   *
   * WHY: Core provides Markup, HtmlTag, Container, and Table handlers out of
   * the box. This method dynamically imports and registers them all.
   *
   * Called once during boot after Renderer is instantiated.
   */
  async discoverElementTypes() {
    // WHY: Dynamic imports allow element types to be loaded on demand and
    // prevent circular dependency issues
    const builtInTypes = [
      './Element/Markup.js',
      './Element/HtmlTag.js',
      './Element/Container.js',
      './Element/Table.js'
    ];

    for (const modulePath of builtInTypes) {
      try {
        // WHY: Import the module (default export is the handler object)
        const module = await import(modulePath);
        const handler = module.default;

        // WHY: Register the handler automatically
        this.registerElementType(handler);
      } catch (err) {
        // WHY: Log error but don't fail boot — missing element types are not fatal
        console.error(`Failed to load element type from ${modulePath}:`, err.message);
      }
    }
  }

  /**
   * Render a render array to HTML.
   *
   * WHY: Main rendering pipeline. Processes metadata, dispatches to handlers,
   * renders children, applies access control, bubbles cache metadata, and
   * wraps with prefix/suffix.
   *
   * @param {Object} element - Render array to process
   * @returns {Promise<string>} HTML string
   */
  async render(element) {
    // WHY: Step 1 - Normalize element (sets defaults for #type, #weight, #access)
    RenderArray.normalize(element);

    // WHY: Step 2 - Access control. If #access is false, skip rendering entirely.
    // This is how permission checks gate content visibility.
    if (element['#access'] === false) {
      return '';
    }

    let html = '';

    // WHY: Step 3 - Dispatch to element type handler if registered
    const handler = this[ELEMENT_TYPES].get(element['#type']);
    if (handler) {
      // WHY: Call handler's render method, passing this Renderer for recursive calls
      html = await handler.render(element, this);
    } else {
      // WHY: Step 4 - Unknown element type. Log warning but don't fail.
      // Fall through to rendering children (element acts as container).
      if (element['#type'] && element['#type'] !== 'container') {
        console.warn(
          `No handler registered for element type "${element['#type']}". ` +
          `Rendering as container. Available types: ${[...this[ELEMENT_TYPES].keys()].join(', ')}`
        );
      }

      // WHY: Step 5 - Render children for unknown types (fallback to container behavior)
      html = await this.renderChildren(element);
    }

    // WHY: Step 6 - Apply #prefix before content
    if (element['#prefix']) {
      html = String(element['#prefix']) + html;
    }

    // WHY: Step 7 - Apply #suffix after content
    if (element['#suffix']) {
      html = html + String(element['#suffix']);
    }

    // WHY: Step 8 - Cache metadata bubbling happens during renderChildren()
    // and is handled by renderRoot() for top-level elements. Individual
    // render() calls don't need to track metadata separately.

    return html;
  }

  /**
   * Render all children of a render array.
   *
   * WHY: Children are any properties that don't start with '#'. They're sorted
   * by #weight, rendered recursively, and concatenated. This is how nested
   * structures become flat HTML.
   *
   * @param {Object} element - Parent render array
   * @returns {Promise<string>} Concatenated HTML of all children
   */
  async renderChildren(element) {
    // WHY: Extract and sort children by weight
    const childEntries = RenderArray.children(element);

    // WHY: Render each child recursively and collect results
    const childPromises = childEntries.map(([key, child]) => this.render(child));
    const childHtmlArray = await Promise.all(childPromises);

    // WHY: Concatenate all child HTML into single string
    return childHtmlArray.join('');
  }

  /**
   * Render a render array and collect cache metadata for the entire tree.
   *
   * WHY: Top-level rendering for pages. Returns both HTML and cache metadata
   * so the response can set appropriate HTTP cache headers.
   *
   * @param {Object} element - Root render array
   * @returns {Promise<{html: string, cacheMetadata: CacheMetadata}>}
   */
  async renderRoot(element) {
    // WHY: Create root cache metadata collector
    const rootCache = new CacheMetadata();

    // WHY: Recursively collect cache metadata from entire tree
    this._collectCacheMetadata(element, rootCache);

    // WHY: Render the element to HTML
    const html = await this.render(element);

    // WHY: Handle lazy builders if present
    if (element['#type'] === 'lazy_builder') {
      return await this._renderLazyBuilder(element);
    }

    return { html, cacheMetadata: rootCache };
  }

  /**
   * Recursively collect cache metadata from render array tree.
   *
   * WHY: Cache tags and contexts must bubble up from children to parents.
   * This enables efficient cache invalidation — when node:42 changes, all
   * pages containing that node are invalidated via cache tags.
   *
   * @param {Object} element - Render array to traverse
   * @param {CacheMetadata} collector - Cache metadata accumulator
   * @private
   */
  _collectCacheMetadata(element, collector) {
    // WHY: Read cache metadata from this element
    if (element['#cache']) {
      const elementCache = CacheMetadata.createFromRenderArray(element);
      collector.merge(elementCache);
    }

    // WHY: Recursively collect from all children
    const childEntries = RenderArray.children(element);
    for (const [key, child] of childEntries) {
      if (RenderArray.isRenderArray(child)) {
        this._collectCacheMetadata(child, collector);
      }
    }
  }

  /**
   * Render a lazy builder element.
   *
   * WHY: Lazy builders defer expensive rendering until needed. The #callback
   * is invoked with #args, returning a render array that's rendered normally.
   * This enables expensive content to be cached separately or skipped entirely.
   *
   * @param {Object} element - Lazy builder element
   * @param {Function} element['#callback'] - Async callback returning render array
   * @param {Array} element['#args'] - Arguments passed to callback
   * @returns {Promise<{html: string, cacheMetadata: CacheMetadata}>}
   * @private
   */
  async _renderLazyBuilder(element) {
    const callback = element['#callback'];
    const args = element['#args'] || [];

    // WHY: Validate callback exists and is callable
    if (typeof callback !== 'function') {
      console.error('Lazy builder element missing #callback function');
      return { html: '', cacheMetadata: new CacheMetadata() };
    }

    try {
      // WHY: Invoke callback to get the actual render array
      const renderArray = await callback(...args);

      // WHY: Render the returned render array normally
      const result = await this.renderRoot(renderArray);

      // WHY: Merge lazy builder's cache metadata with result
      if (element['#cache']) {
        const builderCache = CacheMetadata.createFromRenderArray(element);
        result.cacheMetadata.merge(builderCache);
      }

      return result;
    } catch (err) {
      console.error('Lazy builder callback failed:', err);
      return { html: '', cacheMetadata: new CacheMetadata() };
    }
  }
}
