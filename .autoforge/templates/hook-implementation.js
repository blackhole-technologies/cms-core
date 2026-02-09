/**
 * META-PATTERN TEMPLATE: Hook Implementation
 * =============================================
 * 
 * Drupal equivalent: hook system (ModuleHandlerInterface), hook_form_alter,
 * hook_entity_presave, hook_preprocess_HOOK, etc.
 * 
 * CMS-Core unifies two previously separate systems:
 * 1. Convention hooks (hook_boot, hook_routes) — declared as module exports
 * 2. Runtime hooks (content:beforeSave) — registered at runtime
 * 
 * The HookManager handles both. Convention hooks are auto-registered during
 * module load. Runtime hooks are registered explicitly.
 * 
 * @example Convention hooks (module exports)
 * ```javascript
 * // modules/mymod/index.js
 * 
 * // Boot hook — called during startup
 * export function hook_boot(ctx) {
 *   ctx.services.register('mymod.service', new MyService());
 * }
 * 
 * // Routes hook — register HTTP endpoints
 * export function hook_routes(ctx) {
 *   ctx.router.get('/api/mymod/items', handler);
 * }
 * 
 * // Entity type info — register entity types
 * export function hook_entity_type_info(ctx) {
 *   ctx.entityTypeManager.register('my_entity', { ... });
 * }
 * ```
 * 
 * @example Runtime hooks (registered during boot)
 * ```javascript
 * export function hook_boot(ctx) {
 *   const hooks = ctx.services.get('hooks');
 * 
 *   // React to entity save (like Drupal's hook_entity_presave)
 *   hooks.on('entity:presave', async (entity) => {
 *     if (entity.getEntityTypeId() === 'node') {
 *       entity.set('changed', new Date().toISOString());
 *     }
 *   }, { module: 'mymod', priority: 10 });
 * 
 *   // React to entity delete
 *   hooks.on('entity:delete', async (entity) => {
 *     console.log(`Deleted: ${entity.label()}`);
 *   }, { module: 'mymod' });
 * 
 *   // One-time hook (auto-removes after first fire)
 *   hooks.on('system:ready', async () => {
 *     console.log('System is ready!');
 *   }, { module: 'mymod', once: true });
 * }
 * ```
 * 
 * @example Alter hooks (cross-module modification)
 * ```javascript
 * export function hook_boot(ctx) {
 *   const hooks = ctx.services.get('hooks');
 * 
 *   // Alter ANY form (like Drupal's hook_form_alter)
 *   hooks.onAlter('form', async (form, { formId, formState }) => {
 *     if (formId === 'node_edit') {
 *       form.seo_group = {
 *         '#type': 'details',
 *         '#title': 'SEO',
 *         meta_title: { '#type': 'textfield', '#title': 'Meta title' },
 *       };
 *     }
 *     return form;
 *   }, { module: 'seo' });
 * 
 *   // Alter a SPECIFIC form (like Drupal's hook_form_FORM_ID_alter)
 *   hooks.onAlter('form_node_edit', async (form) => {
 *     form.scheduling = {
 *       '#type': 'details',
 *       '#title': 'Scheduling',
 *       publishAt: { '#type': 'datetime', '#title': 'Publish at' },
 *     };
 *     return form;
 *   }, { module: 'scheduler' });
 * 
 *   // Alter entity type definitions (like hook_entity_type_alter)
 *   hooks.onAlter('entity_type_info', async (types) => {
 *     const node = types.get('node');
 *     if (node) {
 *       node.baseFieldDefinitions.meta_title = {
 *         type: 'string', label: 'Meta title',
 *       };
 *     }
 *     return types;
 *   }, { module: 'seo' });
 * }
 * ```
 * 
 * @example Priority ordering
 * ```javascript
 * // Lower priority number = runs first
 * hooks.on('entity:presave', handler1, { priority: 5 });   // runs first
 * hooks.on('entity:presave', handler2, { priority: 10 });  // runs second
 * hooks.on('entity:presave', handler3, { priority: 100 }); // runs last
 * 
 * // Reorder another module's hook
 * hooks.reorder('entity:presave', 'other_module', 1); // move to front
 * 
 * // Remove another module's hook
 * hooks.remove('entity:presave', 'other_module');
 * ```
 * 
 * Hook naming conventions:
 * - entity:presave, entity:insert, entity:update, entity:delete
 * - form:{formId}, form:{formId}:validate, form:{formId}:submit
 * - {hookName}_alter (for alter hooks)
 * - module:installed, module:uninstalled
 * - system:ready, system:shutdown
 * - cron:run
 * 
 * The backward-compatible aliases ensure existing modules work:
 * - hooks.register(name, fn, priority) → hooks.on(name, fn, {priority})
 * - hooks.trigger(name, ctx) → hooks.invoke(name, ctx)
 */

// This file is a template/reference — not meant to be imported directly.
// The HookManager lives at core/lib/Hook/HookManager.js.

/**
 * Example: Complete module using the unified hook system
 */
export function hook_boot(ctx) {
  const hooks = ctx.services.get('hooks');

  // Subscribe to entity events
  hooks.on('entity:presave', async (entity) => {
    // Auto-generate slug from title
    if (entity.has('title') && !entity.get('slug')) {
      entity.set('slug', slugify(entity.get('title')));
    }
  }, { module: 'mymod', priority: 10 });

  // Alter forms from other modules
  hooks.onAlter('form_node_edit', async (form) => {
    form.mymod_settings = {
      '#type': 'details',
      '#title': 'My Module Settings',
      '#weight': 50,
    };
    return form;
  }, { module: 'mymod' });
}

function slugify(text) {
  return text.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
