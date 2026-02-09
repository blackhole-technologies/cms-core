/**
 * META-PATTERN TEMPLATE: Render Element
 * =======================================
 * 
 * Drupal equivalent: RenderElement, FormElement, render arrays convention
 * 
 * EVERYTHING in CMS-Core's output is a render array. Pages, forms, blocks,
 * fields, entities, tables, lists, messages — all render arrays. This
 * enables cache metadata bubbling, lazy building, and theme overrides.
 * 
 * A render array is a plain object where:
 * - Properties starting with '#' are metadata (#type, #markup, #cache, etc.)
 * - Other properties are child render arrays
 * - Children are rendered recursively and concatenated
 * 
 * @example Basic render arrays
 * ```javascript
 * // Simple markup
 * { '#type': 'markup', '#markup': '<p>Hello World</p>' }
 * 
 * // Container with children
 * {
 *   '#type': 'container',
 *   '#attributes': { class: ['content-wrapper'], id: 'main-content' },
 *   header: {
 *     '#type': 'markup',
 *     '#markup': '<h1>Page Title</h1>',
 *     '#weight': -10,
 *   },
 *   body: {
 *     '#type': 'markup',
 *     '#markup': '<p>Page content here</p>',
 *     '#weight': 0,
 *   },
 * }
 * 
 * // HTML tag
 * { '#type': 'html_tag', '#tag': 'span', '#value': 'text', '#attributes': { class: ['label'] } }
 * 
 * // Link
 * { '#type': 'link', '#title': 'Click here', '#url': '/about' }
 * 
 * // Table
 * {
 *   '#type': 'table',
 *   '#header': ['Name', 'Email', 'Role'],
 *   '#rows': [
 *     ['Alice', 'alice@example.com', 'Admin'],
 *     ['Bob', 'bob@example.com', 'Editor'],
 *   ],
 *   '#empty': 'No users found.',
 * }
 * 
 * // Item list
 * {
 *   '#type': 'item_list',
 *   '#title': 'Recent articles',
 *   '#items': ['Article 1', 'Article 2', 'Article 3'],
 *   '#list_type': 'ul',
 * }
 * 
 * // Collapsible details
 * {
 *   '#type': 'details',
 *   '#title': 'Advanced options',
 *   '#open': false,
 *   setting1: { '#type': 'textfield', '#title': 'Setting 1' },
 *   setting2: { '#type': 'checkbox', '#title': 'Enable feature' },
 * }
 * ```
 * 
 * @example Render array with caching
 * ```javascript
 * {
 *   '#type': 'markup',
 *   '#markup': '<div>Expensive content</div>',
 *   '#cache': {
 *     tags: ['node:42', 'node_list'],      // Invalidated when these change
 *     contexts: ['user.permissions'],        // Varies by these contexts
 *     max_age: 3600,                        // Valid for 1 hour
 *   },
 * }
 * ```
 * 
 * @example Lazy builder (deferred rendering)
 * ```javascript
 * // Instead of rendering expensive content inline, use a lazy builder
 * // that generates a placeholder and resolves later.
 * {
 *   '#type': 'lazy_builder',
 *   '#callback': async (userId) => {
 *     const user = await loadUser(userId);
 *     return { '#type': 'markup', '#markup': `<span>${user.name}</span>` };
 *   },
 *   '#args': [currentUserId],
 *   '#cache': { contexts: ['user'] },
 * }
 * ```
 * 
 * @example Entity render array (built by EntityViewBuilder)
 * ```javascript
 * // EntityViewBuilder.view() returns:
 * {
 *   '#type': 'entity',
 *   '#entity_type': 'node',
 *   '#entity': nodeEntity,
 *   '#view_mode': 'full',
 *   '#cache': {
 *     tags: ['node:42'],
 *     contexts: ['user.permissions'],
 *   },
 *   // Field render arrays added by field formatters:
 *   title: {
 *     '#type': 'markup',
 *     '#markup': '<h1>Article Title</h1>',
 *     '#weight': -100,
 *   },
 *   body: {
 *     '#type': 'markup',
 *     '#markup': '<div class="field-body">Content...</div>',
 *     '#weight': 0,
 *   },
 * }
 * ```
 * 
 * @example Page render array (full page structure)
 * ```javascript
 * {
 *   '#type': 'page',
 *   '#theme': 'page',
 *   '#title': 'My Page',
 *   '#attached': {
 *     css: ['core/css/base.css', 'themes/default/style.css'],
 *     js: ['core/js/app.js'],
 *   },
 *   header: {
 *     '#type': 'region',
 *     '#region': 'header',
 *     site_branding: { '#type': 'markup', '#markup': '<h1>Site Name</h1>' },
 *     main_menu: { '#type': 'menu', '#menu_name': 'main' },
 *   },
 *   content: {
 *     '#type': 'region',
 *     '#region': 'content',
 *     // Entity render array or other content
 *   },
 *   sidebar: {
 *     '#type': 'region',
 *     '#region': 'sidebar',
 *     // Block render arrays
 *   },
 *   footer: {
 *     '#type': 'region',
 *     '#region': 'footer',
 *   },
 * }
 * ```
 * 
 * Key render array properties:
 * - #type: Element type (dispatched to handler)
 * - #markup: Raw HTML string
 * - #tag: HTML tag name (for html_tag type)
 * - #value: Content for html_tag
 * - #attributes: {class, id, ...} for HTML attributes
 * - #weight: Sort order (lower = earlier)
 * - #access: Boolean — skip rendering if false
 * - #prefix: HTML before this element
 * - #suffix: HTML after this element
 * - #cache: {tags, contexts, max_age} cache metadata
 * - #attached: {css, js} asset attachments
 * - #theme: Theme hook to use for rendering
 * - #title: Title text
 * 
 * The Renderer processes render arrays by:
 * 1. Check #access (skip if false)
 * 2. Sort children by #weight
 * 3. Dispatch to element type handler by #type
 * 4. Recursively render child render arrays
 * 5. Collect and bubble up cache metadata
 * 6. Apply #prefix and #suffix
 * 7. Resolve lazy builders
 */

// This file is a reference template. See core/lib/Render/ for implementation.
