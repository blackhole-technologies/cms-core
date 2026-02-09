/**
 * META-PATTERN TEMPLATE: Event Subscriber
 * =========================================
 * 
 * Drupal equivalent: EventSubscriberInterface, kernel events
 * 
 * In CMS-Core, the HookManager IS the event system. "Event subscribers"
 * are simply hook handlers registered with specific naming conventions.
 * This template shows the subscriber pattern using the hook system.
 * 
 * While Drupal has a separate Symfony EventDispatcher, CMS-Core unifies
 * hooks and events into one system. This reduces complexity while
 * preserving the same capabilities.
 * 
 * @example Event subscriber as a class (Drupal style)
 * ```javascript
 * // modules/audit/subscribers/ContentAuditSubscriber.js
 * 
 * export class ContentAuditSubscriber {
 *   constructor(auditLog, currentUser) {
 *     this._auditLog = auditLog;
 *     this._currentUser = currentUser;
 *   }
 * 
 *   // Declare which events/hooks to subscribe to
 *   static getSubscribedEvents() {
 *     return {
 *       'entity:insert': { method: 'onEntityInsert', priority: 100 },
 *       'entity:update': { method: 'onEntityUpdate', priority: 100 },
 *       'entity:delete': { method: 'onEntityDelete', priority: 100 },
 *     };
 *   }
 * 
 *   async onEntityInsert(entity) {
 *     await this._auditLog.record({
 *       action: 'create',
 *       entityType: entity.getEntityTypeId(),
 *       entityId: entity.id(),
 *       userId: this._currentUser.id,
 *       timestamp: new Date().toISOString(),
 *     });
 *   }
 * 
 *   async onEntityUpdate(entity) {
 *     await this._auditLog.record({
 *       action: 'update',
 *       entityType: entity.getEntityTypeId(),
 *       entityId: entity.id(),
 *       changes: entity.getChangedFields(),
 *       userId: this._currentUser.id,
 *       timestamp: new Date().toISOString(),
 *     });
 *   }
 * 
 *   async onEntityDelete(entity) {
 *     await this._auditLog.record({
 *       action: 'delete',
 *       entityType: entity.getEntityTypeId(),
 *       entityId: entity.id(),
 *       userId: this._currentUser.id,
 *       timestamp: new Date().toISOString(),
 *     });
 *   }
 * }
 * ```
 * 
 * @example Registering event subscribers in a module
 * ```javascript
 * // modules/audit/index.js
 * import { ContentAuditSubscriber } from './subscribers/ContentAuditSubscriber.js';
 * 
 * export function hook_boot(ctx) {
 *   const hooks = ctx.services.get('hooks');
 *   const auditLog = ctx.services.get('audit.log');
 *   const currentUser = ctx.services.get('current_user');
 * 
 *   const subscriber = new ContentAuditSubscriber(auditLog, currentUser);
 * 
 *   // Auto-register all subscribed events
 *   for (const [event, config] of Object.entries(
 *     ContentAuditSubscriber.getSubscribedEvents()
 *   )) {
 *     hooks.on(event, subscriber[config.method].bind(subscriber), {
 *       module: 'audit',
 *       priority: config.priority,
 *     });
 *   }
 * }
 * ```
 * 
 * @example Simple functional subscriber (preferred for most cases)
 * ```javascript
 * // modules/notifications/index.js
 * export function hook_boot(ctx) {
 *   const hooks = ctx.services.get('hooks');
 *   const mailer = ctx.services.get('mailer');
 * 
 *   // Subscribe to user registration
 *   hooks.on('user:register', async (user) => {
 *     await mailer.send({
 *       to: user.get('mail'),
 *       subject: 'Welcome!',
 *       body: `Welcome to the site, ${user.label()}!`,
 *     });
 *   }, { module: 'notifications', priority: 50 });
 * 
 *   // Subscribe to content publication
 *   hooks.on('entity:update', async (entity) => {
 *     if (entity.getEntityTypeId() === 'node' &&
 *         entity.hasChanged('status') &&
 *         entity.get('status') === true) {
 *       // Node was just published
 *       await notifySubscribers(entity);
 *     }
 *   }, { module: 'notifications' });
 * }
 * ```
 * 
 * Standard event/hook names:
 * 
 * Entity lifecycle:
 * - entity:presave    — before save (insert or update)
 * - entity:insert     — after first save (new entity)
 * - entity:update     — after subsequent save (existing entity)
 * - entity:predelete  — before delete
 * - entity:delete     — after delete
 * 
 * Request lifecycle:
 * - request:begin     — HTTP request received
 * - request:end       — HTTP response sent
 * - request:exception — unhandled exception
 * 
 * Module lifecycle:
 * - module:installed   — module installed
 * - module:uninstalled — module uninstalled
 * 
 * System:
 * - system:ready       — all modules loaded
 * - system:shutdown    — graceful shutdown
 * - cron:run           — cron execution
 */

// This file is a reference template. The actual event system is the HookManager.
