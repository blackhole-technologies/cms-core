/**
 * boot.js - Boot Sequence Orchestrator
 *
 * WHY THIS EXISTS:
 * A CMS has many moving parts that must initialize in the right order:
 * 1. Configuration must load before modules can read settings
 * 2. Discovery must run before modules can be loaded
 * 3. Services must register before modules can use them
 * 4. All modules must initialize before handling requests
 *
 * Boot phases provide:
 * - Explicit ordering with clear boundaries
 * - Error handling at each phase (fail fast, fail clear)
 * - Hook points for modules to extend boot behavior
 * - Debugging visibility (know exactly where boot failed)
 *
 * DESIGN DECISION: Five phases
 * INIT → DISCOVER → REGISTER → BOOT → READY
 *
 * Each phase completes fully before the next starts.
 * This prevents race conditions and makes debugging straightforward.
 *
 * WHY NOT JUST async/await EVERYTHING:
 * Phases provide semantic meaning. "Failed during REGISTER" tells you
 * more than "failed on line 47". Phases are checkpoints.
 */

import { join } from 'node:path';
import * as config from './config.ts';
import * as discovery from './discovery.js';
import * as dependencies from './dependencies.js';
import * as hooks from './hooks.ts';
import * as services from './services.ts';
import * as watcher from './watcher.js';
import * as cli from './cli.js';
import * as router from './router.ts';
import * as server from './server.ts';
import * as content from './content.ts';
import * as template from './template.ts';
import * as auth from './auth.ts';
import * as cache from './cache.ts';
import * as media from './media.ts';
import * as scheduler from './scheduler.ts';
import * as transfer from './transfer.js';
import * as ratelimit from './ratelimit.ts';
import * as plugins from './plugins.js';
import * as search from './search.ts';
import * as i18n from './i18n.js';
import * as comments from './comments.ts';
import * as audit from './audit.ts';
import * as queue from './queue.ts';
import * as oembed from './oembed.ts';
import * as fields from './fields.ts';
import * as validation from './validation.ts';
import * as preview from './preview.js';
import * as email from './email.js';
import * as notifications from './notifications.js';
import * as backup from './backup.js';
import * as analytics from './analytics.ts';
import * as blueprints from './blueprints.js';
import * as favorites from './favorites.js';
import * as compare from './compare.js';
import * as activity from './activity.ts';
import * as archetypes from './archetypes.js';
import * as apiVersion from './api-version.js';
import * as graphql from './graphql.js';
import * as feeds from './feeds.ts';
import * as sitemap from './sitemap.ts';
import * as taxonomy from './taxonomy.ts';
import * as menu from './menu.ts';
import * as blocks from './blocks.js';
import * as views from './views.js';
import * as regions from './regions.js';
import * as layoutBuilder from './layout-builder.js';
import * as mediaLibrary from './media-library.ts';
import * as editor from './editor.js';
import * as responsiveImages from './responsive-images.ts';
import * as jsonapi from './jsonapi.js';
import * as workflowAdvanced from './workflow-advanced.js';
import * as entityReference from './entity-reference.ts';
import * as permissions from './permissions.js';
import * as forms from './forms.js';
import * as pathAliases from './path-aliases.ts';
import * as imageStyles from './image-styles.ts';
import * as cron from './cron.ts';
import * as configManagement from './config-management.js';
import * as tokens from './tokens.ts';
import * as textFormats from './text-formats.js';
import * as entity from './entity.ts';
import * as actions from './actions.ts';
import * as userFields from './user-fields.js';
import * as themeSettings from './theme-settings.js';
import * as contentTypes from './content-types.ts';
import * as displayModes from './display-modes.js';
import * as batch from './batch.js';
import * as status from './status.js';
import * as contextual from './contextual.js';
import * as help from './help.js';
import * as contact from './contact.js';
import * as ban from './ban.js';
import * as checklist from './checklist.js';
import * as history from './history.js';
import * as aiRegistry from './ai-registry.ts';
import * as aiStats from './ai-stats.ts';
import * as aiProviderManager from './ai-provider-manager.ts';
import * as functionCallPlugins from './function-call-plugins.ts';
import * as honeypot from './honeypot.js';
import * as captcha from './captcha.js';
import * as sdc from './sdc.js';
import * as aiAgents from './ai-agents.ts';
import * as webform from './webform.js';

/**
 * Boot phase definitions
 *
 * WHY EXPORT PHASES:
 * Modules may need to check current phase or reference phase names.
 * Exporting as const object prevents typos (IDE autocomplete).
 */
export const PHASES = {
  INIT: 'INIT',           // Load configuration
  DISCOVER: 'DISCOVER',   // Find modules and themes
  REGISTER: 'REGISTER',   // Register services and hooks
  BOOT: 'BOOT',           // Initialize modules
  READY: 'READY',         // System ready for requests
};

/**
 * Current boot phase (for introspection)
 */
let currentPhase = null;

/**
 * Get current boot phase
 */
export function getPhase() {
  return currentPhase;
}

/**
 * Main boot function - orchestrates the entire startup sequence
 *
 * @param {string} baseDir - Project root directory (where index.js lives)
 * @param {Object} options - Boot options
 * @param {boolean} options.quiet - Suppress boot logs (for CLI mode)
 * @returns {Promise<Object>} - Boot context with services, config, etc.
 *
 * WHY ACCEPT baseDir AS PARAMETER:
 * - Makes testing possible (point to test fixtures)
 * - No magic __dirname resolution (ESM makes this tricky anyway)
 * - Explicit is better than implicit
 *
 * WHY QUIET OPTION:
 * CLI mode needs clean output - only command results.
 * Boot logs would clutter the terminal and break scripting.
 */
export async function boot(baseDir, options = {}) {
  const { quiet = false } = options;

  // WHY CONDITIONAL LOGGING:
  // In quiet mode (CLI), we skip informational logs.
  // Errors still go to stderr.
  const log = quiet ? () => {} : console.log.bind(console);

  log('[boot] Starting CMS boot sequence...');
  log(`[boot] Base directory: ${baseDir}`);

  /**
   * Boot context - passed through all phases and returned at end
   *
   * WHY A CONTEXT OBJECT:
   * - Phases can add data for later phases
   * - Modules get access to everything they need
   * - Easy to extend without changing function signatures
   */
  const context = {
    baseDir,
    config: null,
    modules: [],
    themes: [],
    services,
    hooks,
  };

  try {
    // ========================================
    // PHASE: INIT
    // Load configuration files
    // ========================================
    currentPhase = PHASES.INIT;
    log(`\n[boot] === PHASE: ${PHASES.INIT} ===`);

    // Initialize config loader with base directory
    config.init(baseDir);

    // Load required configs
    // WHY LOAD SPECIFIC CONFIGS (not all):
    // Only load what we need. Unknown configs stay on disk
    // until something explicitly requests them.
    const siteConfig = config.load('site');
    const modulesConfig = config.load('modules');

    context.config = {
      site: siteConfig,
      modules: modulesConfig,
    };

    log(`[boot] Site: ${siteConfig.name} v${siteConfig.version}`);
    log(`[boot] Environment: ${siteConfig.env}`);

    // Initialize PostgreSQL if enabled in config/database.json
    // WHY DURING INIT:
    // The database must be ready before content.init() in REGISTER phase.
    // Migrations run here so all tables exist before services start.
    let dbConfig = null;
    try { dbConfig = config.load('database'); } catch { /* no database.json — flat-file mode */ }
    if (dbConfig && dbConfig.enabled) {
      try {
        const { createPool } = await import('./pg-client.js');
        const { runMigrations } = await import('./database/migrations.js');

        log('[boot] PostgreSQL enabled — connecting...');
        const pool = await createPool(dbConfig);
        context.dbPool = pool;

        const migrationCount = await runMigrations(pool);
        if (migrationCount > 0) {
          log(`[boot] Ran ${migrationCount} database migration(s)`);
        }

        log('[boot] ✓ PostgreSQL connected');
        services.register('database', () => pool);
      } catch (dbError) {
        console.error(`[boot] PostgreSQL connection failed: ${dbError.message}`);
        console.error('[boot] Falling back to flat-file storage');
        context.dbPool = null;
      }
    }

    log(`[boot] ✓ ${PHASES.INIT} complete`);

    // Trigger hook for modules that need to run after config loads
    await hooks.trigger('boot:init', context);

    // ========================================
    // PHASE: DISCOVER
    // Scan for modules and themes
    // ========================================
    currentPhase = PHASES.DISCOVER;
    log(`\n[boot] === PHASE: ${PHASES.DISCOVER} ===`);

    // Initialize discovery with base directory
    discovery.init(baseDir);

    // Scan for modules and themes
    context.modules = discovery.scan('modules');
    context.themes = discovery.scan('themes');

    log(`[boot] Found ${context.modules.length} module(s)`);
    log(`[boot] Found ${context.themes.length} theme(s)`);

    // List discovered items
    for (const mod of context.modules) {
      log(`[boot]   - ${mod.name}@${mod.version}`);
    }
    for (const theme of context.themes) {
      log(`[boot]   - ${theme.name}@${theme.version} (theme)`);
    }

    log(`[boot] ✓ ${PHASES.DISCOVER} complete`);

    // Trigger hook for modules that need to run after discovery
    await hooks.trigger('boot:discover', context);

    // ========================================
    // DEPENDENCY RESOLUTION
    // Validate and sort modules before registration
    // ========================================
    const enabledModules = context.config.modules.enabled || [];

    // Filter to only enabled and discovered modules
    const enabledDiscovered = context.modules.filter(m => enabledModules.includes(m.name));

    if (enabledDiscovered.length > 0) {
      // Check for circular dependencies
      // WHY CHECK FIRST:
      // Circular dependencies cause topological sort to fail.
      // Detecting them separately gives us better error messages.
      const cycles = dependencies.detectCircular(enabledDiscovered);

      if (cycles.length > 0) {
        // Format cycle for clear error message
        const cycleStr = cycles[0].join(' → ');
        console.error(`[boot] ERROR: Circular dependency detected: ${cycleStr}`);
        throw new Error(`Circular dependency: ${cycleStr}`);
      }

      // Validate all dependencies are present and enabled
      const validation = dependencies.validateDependencies(context.modules, enabledModules);

      if (!validation.valid) {
        for (const err of validation.errors) {
          console.error(`[boot] ERROR: Module '${err.module}' requires '${err.missing}' which is ${err.reason}`);
        }
        const first = validation.errors[0];
        throw new Error(`Missing dependency: '${first.module}' requires '${first.missing}'`);
      }

      // Sort modules in dependency order
      // WHY SORT:
      // Dependencies must be loaded before dependents.
      // Topological sort ensures this order.
      const sortedModules = dependencies.topologicalSort(enabledDiscovered);
      const loadOrder = sortedModules.map(m => m.name);

      log(`[boot] Module load order: ${loadOrder.join(', ')}`);

      // Update context.modules to reflect sorted order for enabled modules
      // Keep the sorted modules for loading, but maintain full list for reference
      context.sortedModules = sortedModules;
    } else {
      context.sortedModules = [];
    }

    // ========================================
    // PHASE: REGISTER
    // Register services and module hooks
    // ========================================
    currentPhase = PHASES.REGISTER;
    log(`\n[boot] === PHASE: ${PHASES.REGISTER} ===`);

    // Register core services
    // WHY REGISTER HERE (not in services.js):
    // Services.js is generic infrastructure. Boot.js knows about
    // the specific services this CMS needs.

    // Register config as a service so modules can access it
    services.register('config', () => context.config);

    // Register hooks as a service
    services.register('hooks', () => hooks);

    // Register watcher as a service
    // WHY HERE (not started yet):
    // Registration is about making things available.
    // The watcher is started later in READY phase.
    services.register('watcher', () => watcher);

    // Register CLI as a service
    // WHY A SERVICE:
    // Modules may want to register their own commands.
    // Accessing CLI via services keeps the pattern consistent.
    services.register('cli', () => cli);

    // Register router and server as services
    services.register('router', () => router);
    services.register('server', () => server);

    // Register core middleware
    // WHY HERE (not in server.js):
    // Middleware registration needs boot context.
    // Boot.js coordinates initialization order.

    // Request logging middleware
    // Logs method, path, status, and duration for every request
    router.use(async (req, res, context, next) => {
      await next();

      // Log after response is complete
      const method = req.method || 'GET';
      const url = req.url || '/';
      const duration = Date.now() - (req.startTime || Date.now());
      const status = res.statusCode || 200;

      console.log(`[server] ${method} ${url} → ${status} (${duration}ms)`);
    }, 'requestLog');

    log('[boot] Middleware registered: requestLog (global)');

    // Response time middleware
    // Adds X-Response-Time header to all responses
    router.use(async (req, res, context, next) => {
      await next();

      // Add response time header if not already sent
      if (!res.headersSent) {
        const duration = Date.now() - (req.startTime || Date.now());
        res.setHeader('X-Response-Time', `${duration}ms`);
      }
    }, 'responseTime');

    log('[boot] Middleware registered: responseTime (global)');

    // Initialize IP ban system
    // WHY EARLY: Ban check must run before all other processing
    const banConfig = context.config.site.ban || { enabled: true };
    ban.init(banConfig, baseDir);
    services.register('ban', () => ban);
    if (banConfig.enabled !== false) {
      router.use(ban.middleware(), 'ipBan');
      log(`[boot] IP ban enabled (${ban.getStats().total} active bans)`);
    }

    // Initialize and register cache as a service
    // WHY CACHE:
    // - Reduces disk I/O for frequently accessed content
    // - Improves response times for API requests
    // - Configurable TTL for different use cases
    const cacheConfig = context.config.site.cache || { enabled: false, ttl: 300 };
    cache.init(cacheConfig);
    services.register('cache', () => cache);

    if (cacheConfig.enabled) {
      log(`[boot] Cache enabled (TTL: ${cacheConfig.ttl}s)`);
    }

    // Register content as a service
    // WHY A SERVICE:
    // Modules need access to content CRUD operations.
    // Content types are registered via hook_content.
    const revisionsConfig = context.config.site.revisions || { enabled: true, maxPerItem: 10 };
    const workflowConfig = context.config.site.workflow || { enabled: false, defaultStatus: 'draft' };
    const contentConfig = context.config.site.content || { computedFields: true, cacheComputed: false };
    content.init(baseDir, cacheConfig, revisionsConfig, workflowConfig);

    // Initialize storage provider based on database config
    // WHY AFTER content.init():
    // content.init() sets contentDir which the provider needs.
    // WHY BEFORE content.initComputed():
    // Computed fields may read content, so storage must be ready.
    if (context.dbPool) {
      const { PgProvider } = await import('./storage/pg-provider.js');
      const pgProvider = new PgProvider(context.dbPool);
      await content.initStorage(pgProvider);
      log('[boot] Content storage: PostgreSQL');
    } else {
      const { FileProvider } = await import('./storage/file-provider.js');
      const fileProvider = new FileProvider();
      await content.initStorage(fileProvider);
      log('[boot] Content storage: flat-file');
    }

    content.initComputed(contentConfig);
    const slugsConfig = context.config.site.slugs || { enabled: true };
    content.initSlugs(slugsConfig);
    services.register('content', () => content);

    if (workflowConfig.enabled) {
      log(`[boot] Workflow enabled (default status: ${workflowConfig.defaultStatus})`);
    }

    if (revisionsConfig.enabled) {
      log(`[boot] Revisions enabled (max ${revisionsConfig.maxPerItem} per item)`);
    }

    if (contentConfig.computedFields !== false) {
      log(`[boot] Computed fields enabled`);
    }

    if (slugsConfig.enabled !== false) {
      log(`[boot] Slugs enabled (separator: ${slugsConfig.separator || '-'}, max: ${slugsConfig.maxLength || 100})`);
    }

    // Initialize trash system
    const trashConfig = context.config.site.trash || { enabled: true };
    content.initTrash(trashConfig);

    if (trashConfig.enabled !== false) {
      log(`[boot] Trash enabled (retention: ${trashConfig.retention || 30} days, auto-purge: ${trashConfig.autoPurge !== false})`);
    }

    // Initialize clone system
    content.initClone(contentConfig);

    // Initialize locking system
    const locksConfig = context.config.site.locks || { enabled: true };
    content.initLocks(locksConfig);
    if (context.dbPool) {
      const locksModule = await import('./locks.js');
      await locksModule.initDb(context.dbPool);
      log('[boot] Content locks: PostgreSQL');
    }

    if (locksConfig.enabled !== false) {
      log(`[boot] Content locking enabled (timeout: ${locksConfig.timeout || 1800}s, grace: ${locksConfig.gracePeriod || 60}s)`);
    }

    // Initialize queue system
    // WHY AFTER LOCKS:
    // Queue processes bulk operations that may need locking.
    const queueConfig = context.config.site.queue || { enabled: true };
    queue.init({
      ...queueConfig,
      contentDir: join(baseDir, 'content'),
      context,
    });
    if (context.dbPool) {
      await queue.initDb(context.dbPool);
      log('[boot] Job queue: PostgreSQL');
    }
    services.register('queue', () => queue);

    if (queueConfig.enabled !== false) {
      log(`[boot] Queue enabled (concurrency: ${queueConfig.concurrency || 5}, retries: ${queueConfig.maxRetries || 3})`);
    }

    // Initialize oEmbed system
    // WHY AFTER QUEUE:
    // oEmbed fetches external resources which could be queued for large imports.
    const oembedConfig = context.config.site.oembed || { enabled: true };
    oembed.init({
      ...oembedConfig,
      contentDir: join(baseDir, 'content'),
    });
    services.register('oembed', () => oembed);

    if (oembedConfig.enabled !== false) {
      log(`[boot] oEmbed enabled (cache TTL: ${oembedConfig.cacheTtl || 604800}s, providers: ${oembed.getProviders().length})`);
    }

    // Initialize fields system
    // WHY AFTER OEMBED:
    // Fields may include embed field types that use oEmbed.
    const fieldsConfig = context.config.site.fields || {};
    fields.init(fieldsConfig);
    services.register('fields', () => fields);

    // Initialize validation system
    // WHY AFTER FIELDS:
    // Validation uses field definitions for type-aware validation.
    const validationConfig = context.config.site.validation || { enabled: true };
    validation.init(validationConfig, content);
    services.register('validation', () => validation);

    // Initialize preview system
    // WHY AFTER VALIDATION:
    // Preview needs content service to fetch draft content.
    const previewConfig = context.config.site.preview || { enabled: true };
    preview.init(previewConfig, baseDir, content);
    services.register('preview', () => preview);

    // Initialize email system
    // WHY BEFORE NOTIFICATIONS:
    // Notifications may send emails, so email must init first.
    const emailConfig = context.config.site.email || { transport: 'console' };
    email.init(emailConfig, baseDir, template);
    services.register('email', () => email);

    if (emailConfig.transport !== 'console') {
      log(`[boot] Email enabled (transport: ${emailConfig.transport})`);
    }

    // Initialize notifications system
    // WHY AFTER EMAIL:
    // Notifications can send emails and trigger webhooks.
    const notificationsConfig = context.config.site.notifications || { enabled: true };
    notifications.init(notificationsConfig, baseDir, email, null);
    services.register('notifications', () => notifications);

    if (context.dbPool) {
      await notifications.initDb(context.dbPool);
      log('[boot] Notifications: PostgreSQL');
    }

    if (notificationsConfig.enabled !== false) {
      log(`[boot] Notifications enabled (max per user: ${notificationsConfig.maxPerUser || 100})`);
    }

    // Initialize comments system
    const commentsConfig = context.config.site.comments || { enabled: true };
    comments.init(commentsConfig, content);
    services.register('comments', () => comments);

    if (commentsConfig.enabled !== false) {
      log(`[boot] Comments enabled (default: ${commentsConfig.defaultStatus || 'pending'}, auto-approve: ${commentsConfig.autoApproveUsers !== false})`);
    }

    // Initialize content history tracking
    // WHY AFTER COMMENTS: History needs content service context
    const historyConfig = context.config.site.history || { enabled: true };
    history.init(historyConfig, baseDir);
    services.register('history', () => history);

    if (context.dbPool) {
      await history.initDb(context.dbPool);
      log('[boot] Content history: PostgreSQL');
    }

    log('[boot] Content history tracking enabled');

    // Initialize contact forms
    // WHY AFTER COMMENTS: Contact forms follow same pattern (content + email)
    const contactConfig = { ...(context.config.site.contact || { enabled: true }), baseDir };
    contact.init(contactConfig, content, email);
    services.register('contact', () => contact);
    log('[boot] Contact forms enabled');

    // Initialize webform builder
    // WHY AFTER CONTACT: Webform follows same pattern (forms + submissions)
    // but supports arbitrary user-defined forms with conditional logic.
    const webformConfig = { ...(context.config.site.webform || { enabled: true }), baseDir };
    webform.init(webformConfig, content, email);
    services.register('webform', () => webform);
    log('[boot] Webform builder enabled');

    // Initialize search indexing
    // WHY AFTER CONTENT:
    // Search needs content service to index items
    // and hooks service for auto-indexing on changes.
    const searchConfig = context.config.site.search || { enabled: false };
    search.init(baseDir, searchConfig, content, hooks);
    services.register('search', () => search);

    // Register and activate PostgreSQL search backend when database is enabled
    if (context.dbPool && searchConfig.enabled !== false) {
      const { createPgSearchBackend } = await import('./search/pg-backend.js');
      search.registerBackend('postgres', {
        create: () => createPgSearchBackend(context.dbPool),
      });
      await search.setBackend('postgres');
      log('[boot] Search backend: PostgreSQL (tsvector)');
    } else if (searchConfig.enabled) {
      log(`[boot] Search indexing enabled (fuzzy: ${searchConfig.fuzzy || false})`);
    }

    // Initialize i18n system
    // WHY AFTER SEARCH:
    // i18n needs content service for content translations
    // and should be available for template rendering.
    const i18nConfig = context.config.site.i18n || { enabled: false };
    i18n.init(baseDir, i18nConfig, content);
    services.register('i18n', () => i18n);

    if (i18nConfig.enabled) {
      log(`[boot] i18n enabled (default: ${i18nConfig.defaultLocale || 'en'}, locales: ${(i18nConfig.locales || ['en']).join(', ')})`);
    }

    // Initialize audit logging system
    // WHY AFTER I18N:
    // Audit needs to be available for all subsequent operations.
    // Logs all significant user actions for security and compliance.
    const auditConfig = context.config.site.audit || { enabled: true };
    audit.init(baseDir, auditConfig);
    services.register('audit', () => audit);

    if (context.dbPool) {
      await audit.initDb(context.dbPool);
      log('[boot] Audit log: PostgreSQL');
    }

    if (auditConfig.enabled) {
      log(`[boot] Audit logging enabled (retention: ${auditConfig.retention || 90} days, level: ${auditConfig.logLevel || 'info'})`);
    }

    // Initialize AI registry system
    // WHY AFTER AUDIT:
    // AI registry needs to be available for AI modules to register themselves.
    // Provides centralized tracking of AI providers, tools, and processors.
    aiRegistry.init(baseDir);
    services.register('ai-registry', () => aiRegistry);
    log('[boot] AI registry initialized');

    // Initialize AI stats tracking service
    // Logs AI operations for monitoring, billing, and optimization.
    aiStats.init(baseDir);
    services.register('ai-stats', () => aiStats);

    if (context.dbPool) {
      await aiStats.initDb(context.dbPool);
      log('[boot] AI stats: PostgreSQL');
    }

    log('[boot] AI stats service initialized');

    // Initialize AI provider manager
    // WHY AFTER AI REGISTRY:
    // Provider manager needs access to services, hooks, and module paths.
    // Manages discovery, loading, and instantiation of AI provider plugins.
    aiProviderManager.init({
      services,
      hooks,
      modulePaths: context.modules.map(m => ({ name: m.name, path: m.path }))
    });
    services.register('ai-provider-manager', () => aiProviderManager);
    log('[boot] AI provider manager initialized');

    // Initialize vector/semantic search with AI provider for embeddings
    search.initVectorSearch(aiProviderManager, hooks);
    log('[boot] Vector search initialized');

    // Initialize function call plugins service
    // WHY AFTER AI PROVIDER MANAGER:
    // Function call plugins provide tools for AI agents to interact with CMS.
    // Manages discovery, registration, and execution of AI agent tools.
    functionCallPlugins.init(context);
    services.register('function-call-plugins', () => functionCallPlugins);
    log('[boot] Function call plugins service initialized');

    // Initialize AI Agents framework
    // WHY HERE: Needs content service and AI provider manager already registered.
    aiAgents.init({ services });
    services.register('ai-agents', () => aiAgents);
    log('[boot] AI Agents framework initialized');

    // Initialize honeypot anti-spam
    // WHY HERE: Must be available before any form rendering.
    honeypot.init(context.config.site.honeypot, { sessionSecret: context.config.site.sessionSecret });
    services.register('honeypot', () => honeypot);
    log('[boot] Honeypot anti-spam initialized');

    // Initialize CAPTCHA
    // WHY HERE: Must be available before any form rendering.
    captcha.init(context.config.site.captcha, { sessionSecret: context.config.site.sessionSecret });
    services.register('captcha', () => captcha);
    log('[boot] CAPTCHA initialized');

    // Register media as a service
    // WHY A SERVICE:
    // Modules need access to file uploads and media management.
    // Media stores files in /media/<year>/<month>/<filename>
    const mediaConfig = context.config.site.media || {};
    media.init(baseDir, mediaConfig);
    services.register('media', () => media);

    if (mediaConfig.maxFileSize) {
      log(`[boot] Media max file size: ${Math.round(mediaConfig.maxFileSize / 1024 / 1024)}MB`);
    }

    // Register scheduler as a service
    // WHY A SERVICE:
    // Modules need access to schedule tasks and query task status.
    // Scheduler runs tasks on cron-like schedules.
    services.register('scheduler', () => scheduler);

    // Initialize transfer system
    // WHY A SERVICE:
    // Modules need access to export/import functionality.
    // Transfer provides backup, migration, and staging sync.
    transfer.init(baseDir, { content, media }, context.config.site.version);
    services.register('transfer', () => transfer);

    // Initialize backup system
    // WHY AFTER SCHEDULER:
    // Backup system registers scheduled tasks for automated backups.
    const backupConfig = context.config.site.backup || { enabled: true };
    backup.init(backupConfig, baseDir, content, scheduler, hooks);
    services.register('backup', () => backup);

    if (backupConfig.enabled !== false) {
      log(`[boot] Backup system enabled (path: ${backupConfig.path || './backups'})`);
    }

    // Initialize analytics system
    // WHY AFTER CONTENT:
    // Analytics tracks content views and hooks into content events.
    const analyticsConfig = context.config.site.analytics || { enabled: true };
    analytics.init(analyticsConfig, baseDir, scheduler, content, hooks);
    services.register('analytics', () => analytics);

    if (context.dbPool) {
      await analytics.initDb(context.dbPool);
      log('[boot] Analytics: PostgreSQL');
    }

    // Initialize blueprints
    const blueprintsConfig = context.config.site.blueprints || { enabled: true };
    blueprints.init(blueprintsConfig, baseDir, content);
    services.register('blueprints', () => blueprints);
    log('[boot] Blueprints enabled');

    // Initialize favorites system
    // WHY AFTER BLUEPRINTS:
    // Favorites depends on content service for validation.
    // Both are content-related features.
    favorites.init(baseDir, content);
    services.register('favorites', () => favorites);

    if (context.dbPool) {
      await favorites.initDb(context.dbPool);
      log('[boot] Favorites: PostgreSQL');
    }

    log('[boot] Favorites enabled');

    // Initialize compare/merge tools
    // WHY AFTER FAVORITES:
    // Compare depends on content service for reading items and revisions.
    compare.init(content);
    services.register('compare', () => compare);
    log('[boot] Compare/merge tools enabled');

    // Initialize activity feed system
    // WHY AFTER COMPARE:
    // Activity tracks all content operations and needs content service.
    const activityConfig = context.config.site.activity || { enabled: true };
    activity.init(baseDir, content, activityConfig);
    services.register('activity', () => activity);

    if (context.dbPool) {
      await activity.initDb(context.dbPool);
      log('[boot] Activity feed: PostgreSQL');
    }

    log('[boot] Activity feed enabled');

    // Initialize archetypes (content type builder)
    // WHY AFTER ACTIVITY:
    // Archetypes define content types, needs content and fields services.
    const archetypesConfig = context.config.site.archetypes || { enabled: true };
    archetypes.init(baseDir, content, fields, archetypesConfig);
    archetypes.registerAll(); // Register custom types with content service
    services.register('archetypes', () => archetypes);
    log('[boot] Archetypes enabled');

    // Initialize API versioning
    // WHY AFTER ARCHETYPES:
    // API versioning may need analytics for usage tracking.
    const apiConfig = context.config.site.api || { enabled: true, defaultVersion: 'v1' };
    apiVersion.init(baseDir, analytics, apiConfig);
    services.register('apiVersion', () => apiVersion);
    log('[boot] API versioning enabled');

    // Initialize GraphQL
    // WHY AFTER API VERSION:
    // GraphQL needs content service for schema generation.
    const graphqlConfig = context.config.site.graphql || { enabled: true };
    graphql.init(content, auth, graphqlConfig);
    services.register('graphql', () => graphql);
    log('[boot] GraphQL enabled');

    // Initialize feeds
    // WHY AFTER GRAPHQL:
    // Feeds need content service to generate feed items.
    const feedsConfig = {
      ...(context.config.site.feeds || { enabled: true }),
      baseUrl: `http://localhost:${context.config.site.port || 3000}`,
    };
    feeds.init(baseDir, content, feedsConfig);
    services.register('feeds', () => feeds);
    log('[boot] Feeds enabled');

    // Initialize sitemap
    // WHY AFTER FEEDS:
    // Sitemap needs content service to generate URLs.
    const sitemapConfig = {
      ...(context.config.site.seo || { enabled: true }),
      siteUrl: `http://localhost:${context.config.site.port || 3000}`,
    };
    sitemap.init(baseDir, content, sitemapConfig);
    services.register('sitemap', () => sitemap);
    log('[boot] Sitemap/SEO enabled');

    // Initialize taxonomy
    // WHY EARLY: Other services may need to reference terms
    const taxonomyConfig = context.config.site.taxonomy || { enabled: true };
    taxonomy.init(baseDir, content, taxonomyConfig);
    services.register('taxonomy', () => taxonomy);
    log('[boot] Taxonomy enabled');

    // Initialize menu
    // WHY AFTER TAXONOMY: Menus may reference taxonomy terms
    const menuConfig = context.config.site.menu || { enabled: true };
    menu.init(menuConfig, content, router, baseDir);
    services.register('menu', () => menu);
    log('[boot] Menu system enabled');

    // Initialize blocks
    // WHY AFTER MENU: Block types include menu blocks
    const blocksConfig = context.config.site.blocks || { enabled: true };
    blocks.init(baseDir, template, blocksConfig);
    services.register('blocks', () => blocks);
    log('[boot] Block system enabled');

    // Phase 2 Systems
    // WHY HERE: After core taxonomy/menu/blocks initialization

    const viewsConfig = context.config.site.views || { enabled: true };
    if (viewsConfig.enabled) {
      views.init(baseDir, content, hooks, viewsConfig);
      services.register('views', () => views);
      log('[boot] Views system enabled');
    }

    const regionsConfig = context.config.site.regions || { enabled: true };
    if (regionsConfig.enabled) {
      regions.init(baseDir, blocks, template);
      services.register('regions', () => regions);
      log('[boot] Regions system enabled');
    }

    const workflowAdvConfig = context.config.site.workflowAdvanced || { enabled: true };
    if (workflowAdvConfig.enabled) {
      await workflowAdvanced.init(baseDir, content, scheduler, hooks);
      services.register('workflowAdvanced', () => workflowAdvanced);
      log('[boot] Advanced workflow enabled');
    }

    const entityRefConfig = context.config.site.entityReference || { enabled: true };
    if (entityRefConfig.enabled) {
      entityReference.init(content, fields, entityRefConfig);
      services.register('entityReference', () => entityReference);
      log('[boot] Entity reference system enabled');
    }

    const permissionsConfig = context.config.site.permissions || { enabled: true };
    if (permissionsConfig.enabled) {
      await permissions.init(baseDir, auth);
      services.register('permissions', () => permissions);
      log('[boot] Permissions system enabled');
    }

    const formsConfig = context.config.site.forms || { enabled: true };
    if (formsConfig.enabled) {
      forms.init(formsConfig);
      services.register('forms', () => forms);
      log('[boot] Forms system enabled');
    }

    const pathAliasesConfig = context.config.site.pathAliases || { enabled: true };
    if (pathAliasesConfig.enabled) {
      await pathAliases.init(baseDir, router, content, hooks);
      services.register('pathAliases', () => pathAliases);
      log('[boot] Path aliases enabled');
    }

    const imageStylesConfig = context.config.site.imageStyles || { enabled: true };
    if (imageStylesConfig.enabled) {
      imageStyles.init(baseDir, media);
      services.register('imageStyles', () => imageStyles);
      log('[boot] Image styles enabled');
    }

    const cronConfig = context.config.site.cron || { enabled: true };
    if (cronConfig.enabled) {
      await cron.init(baseDir, scheduler, hooks);
      services.register('cron', () => cron);
      log('[boot] Cron system enabled');
    }

    const configMgmtConfig = context.config.site.configManagement || { enabled: true };
    if (configMgmtConfig.enabled) {
      configManagement.init(baseDir);
      services.register('configManagement', () => configManagement);
      log('[boot] Configuration management enabled');
    }

    // Phase 3 Systems
    // WHY HERE: After all dependencies are initialized

    const tokensConfig = context.config.site.tokens || { enabled: true };
    const textFormatsConfig = context.config.site.textFormats || { enabled: true };
    const entityConfig = context.config.site.entity || { enabled: true };
    const actionsConfig = context.config.site.actions || { enabled: true };
    const userFieldsConfig = context.config.site.userFields || { enabled: true };
    const themeSettingsConfig = context.config.site.themeSettings || { enabled: true };
    const contentTypesConfig = context.config.site.contentTypes || { enabled: true };
    const displayModesConfig = context.config.site.displayModes || { enabled: true };
    const batchConfig = context.config.site.batch || { enabled: true };
    const statusConfig = context.config.site.status || { enabled: true };
    const contextualConfig = context.config.site.contextual || { enabled: true };
    const helpConfig = context.config.site.help || { enabled: true };

    // Tokens first (used by others)
    if (tokensConfig.enabled) {
      tokens.init(tokensConfig);
      services.register('tokens', () => tokens);
      log('[boot] Token system enabled');
    }

    // Text formats (uses cache)
    if (textFormatsConfig.enabled) {
      await textFormats.init(baseDir, cache);
      services.register('textFormats', () => textFormats);
      log('[boot] Text formats enabled');
    }

    // Content types (uses fields, validation)
    if (contentTypesConfig.enabled) {
      await contentTypes.init(baseDir, fields, validation);
      services.register('contentTypes', () => contentTypes);
      log('[boot] Content types builder enabled');
    }

    // Display modes (uses contentTypes, template)
    if (displayModesConfig.enabled) {
      await displayModes.init(baseDir, contentTypes, template);
      services.register('displayModes', () => displayModes);
      log('[boot] Display modes enabled');
    }

    // Entity API (uses content, taxonomy, auth, media, blocks)
    if (entityConfig.enabled) {
      entity.init({ content, taxonomy, auth, media, blocks });
      services.register('entity', () => entity);
      log('[boot] Entity API enabled');
    }

    // Actions (uses hooks, email, tokens)
    if (actionsConfig.enabled) {
      actions.init(baseDir, hooks, email, tokens);
      services.register('actions', () => actions);
      log('[boot] Actions/Rules enabled');
    }

    // User fields (uses fields, validation, auth)
    if (userFieldsConfig.enabled) {
      await userFields.init(baseDir, fields, validation, auth);
      services.register('userFields', () => userFields);
      log('[boot] User profile fields enabled');
    }

    // Theme settings
    if (themeSettingsConfig.enabled) {
      themeSettings.init(baseDir);
      services.register('themeSettings', () => themeSettings);
      log('[boot] Theme settings enabled');
    }

    // Batch (uses queue, hooks)
    if (batchConfig.enabled) {
      batch.init(baseDir, queue, hooks);
      services.register('batch', () => batch);
      log('[boot] Batch operations enabled');
    }

    // Status (uses services)
    if (statusConfig.enabled) {
      status.init(baseDir, services);
      services.register('status', () => status);
      log('[boot] Status reporting enabled');
    }

    // Contextual (uses permissions, router)
    if (contextualConfig.enabled) {
      contextual.init(permissions, router);
      services.register('contextual', () => contextual);
      log('[boot] Contextual links enabled');
    }

    // Help
    if (helpConfig.enabled) {
      help.init(baseDir, {}, hooks);
      services.register('help', () => help);
      log('[boot] Help system enabled');
    }

    // Checklist / site status checks
    checklist.init(baseDir);
    services.register('checklist', () => checklist);
    log('[boot] Checklist system enabled');

    // ========================================
    // Phase 4 Systems - Layout Builder, Media Library, Editor, etc.
    // WHY HERE: After all Phase 3 systems are initialized
    // ========================================

    const layoutBuilderConfig = context.config.site.layoutBuilder || { enabled: true };
    if (layoutBuilderConfig.enabled) {
      layoutBuilder.init(baseDir, content, blocks, layoutBuilderConfig);
      if (layoutBuilder.setHooks) layoutBuilder.setHooks(hooks);
      if (layoutBuilder.setTemplate) layoutBuilder.setTemplate(template);
      services.register('layoutBuilder', () => layoutBuilder);
      log('[boot] Layout Builder enabled');
    }

    const mediaLibraryConfig = context.config.site.mediaLibrary || { enabled: true };
    if (mediaLibraryConfig.enabled) {
      mediaLibrary.init({
        baseDir,
        media,
        content,
        imageStyles,
        hooks,
        config: mediaLibraryConfig,
      });
      services.register('mediaLibrary', () => mediaLibrary);
      log('[boot] Media Library enabled');
    }

    const editorConfig = context.config.site.editor || { enabled: true };
    if (editorConfig.enabled) {
      editor.init({
        baseDir,
        textFormats,
        mediaLibrary,
        oembed,
        hooks,
        config: editorConfig,
      });
      services.register('editor', () => editor);
      log('[boot] WYSIWYG Editor enabled');
    }

    const responsiveImagesConfig = context.config.site.responsiveImages || { enabled: true };
    if (responsiveImagesConfig.enabled) {
      responsiveImages.init({
        baseDir,
        imageStyles,
        hooks,
        config: responsiveImagesConfig,
      });
      services.register('responsiveImages', () => responsiveImages);
      log('[boot] Responsive Images enabled');
    }

    const jsonapiConfig = context.config.site.jsonapi || { enabled: true };
    if (jsonapiConfig.enabled) {
      jsonapi.init({
        content,
        entityReference,
        auth,
        hooks,
        router,
        config: jsonapiConfig,
      });
      // NOTE: autoRegisterContentTypes() is called later, after modules
      // register their content types via hook_content (see below).
      services.register('jsonapi', () => jsonapi);
      log(`[boot] JSON:API enabled (${jsonapiConfig.basePath || '/jsonapi'})`);
    }

    if (analyticsConfig.enabled !== false) {
      log(`[boot] Analytics enabled (retention: ${analyticsConfig.retention || 90} days)`);
    }

    // Register template as a service
    // WHY A SERVICE:
    // Modules need to render themed templates.
    // Template system needs to know the active theme location.
    const themeName = context.config.site.theme || 'default';
    const themeInfo = context.themes.find(t => t.name === themeName);

    if (themeInfo) {
      template.init(themeInfo.path);
      // Connect i18n service to template for {{t "key"}} helper
      template.setI18n(i18n);
      // Initialize SDC and connect to template for {{component "name"}} syntax
      sdc.init(themeInfo.path);
      template.setSdc(sdc);
      // Set global template variables (GTM, site-wide data)
      const analyticsConfig = context.config.site.analytics || {};
      template.setGlobals({
        gtmId: analyticsConfig.gtmId || '',
        siteName: context.config.site.name || 'CMS',
        version: context.config.site.version || '1.0.0',
      });
      if (analyticsConfig.gtmId) {
        log(`[boot] GTM enabled: ${analyticsConfig.gtmId}`);
      }
      services.register('sdc', () => sdc);
      services.register('template', () => template);
      log(`[boot] Theme loaded: ${themeName}`);
    } else {
      console.warn(`[boot] Theme "${themeName}" not found, templates disabled`);
      // Register a no-op template service
      services.register('template', () => ({
        render: () => { throw new Error('No theme loaded'); },
        renderString: template.renderString,
        renderWithLayout: () => { throw new Error('No theme loaded'); },
        escapeHtml: template.escapeHtml,
      }));
    }

    // Register auth as a service
    // WHY A SERVICE:
    // Modules need access to session management and password hashing.
    // Auth is initialized with the session secret from config.
    const sessionSecret = context.config.site.sessionSecret || 'default-secret-change-me';
    auth.init(sessionSecret, baseDir);
    if (context.dbPool) {
      await auth.initDb(context.dbPool);
      log('[boot] Auth sessions: PostgreSQL');
    }
    services.register('auth', () => auth);

    // Initialize CSRF protection
    // WHY AFTER AUTH:
    // CSRF tokens are tied to sessions, so auth must be initialized first.
    const csrfConfig = context.config.site.csrf || { enabled: true, tokenExpiry: 3600 };
    auth.initCSRF(csrfConfig);

    if (csrfConfig.enabled) {
      log(`[boot] CSRF protection enabled (token expiry: ${csrfConfig.tokenExpiry}s)`);
    }

    // Initialize rate limiting
    // WHY AFTER AUTH:
    // Rate limiting may use session info for per-user limits.
    const rateLimitConfig = context.config.site.rateLimit || { enabled: true };
    ratelimit.init(rateLimitConfig);
    services.register('ratelimit', () => ratelimit);

    if (rateLimitConfig.enabled) {
      log(`[boot] Rate limiting enabled (login: ${rateLimitConfig.login?.points || 5}/min, api: ${rateLimitConfig.api?.points || 100}/min)`);
    }

    log(`[boot] Registered core services: ${services.list().join(', ')}`);

    // Load enabled modules and wire their hooks
    // WHY HERE (not in BOOT phase):
    // Registration is about "declaring what you offer", not "starting up".
    // Hooks are wired during REGISTER so they're ready when BOOT fires.
    // WHY USE sortedModules:
    // Modules are sorted in dependency order so dependencies load first.
    const sortedModules = context.sortedModules || [];

    for (const moduleInfo of sortedModules) {
      const moduleName = moduleInfo.name;

      try {
        // WHY DYNAMIC IMPORT:
        // - Modules are discovered at runtime, not known at compile time
        // - Allows lazy loading (only load what's enabled)
        // - Works with ES modules (require() doesn't work in ESM)
        const modulePath = join(moduleInfo.path, 'index.js');
        const moduleExports = await import(modulePath);

        // Scan exports for hook_* functions
        // WHY THIS PATTERN:
        // - Declarative: modules just export functions, no registration API
        // - Discoverable: we can see all hooks a module provides
        // - Convention over configuration: hook_boot → 'boot' hook
        const wiredHooks = [];

        for (const [exportName, exportValue] of Object.entries(moduleExports)) {
          // Only process hook_* exports that are functions
          if (!exportName.startsWith('hook_') || typeof exportValue !== 'function') {
            continue;
          }

          // Convert hook_boot_ready → 'boot:ready', hook_boot → 'boot'
          // WHY REPLACE _ WITH : (after first):
          // Allows namespaced hooks like 'content:beforeSave'
          // First underscore is the hook_ prefix, subsequent are namespace separators
          const hookName = exportName
            .slice(5) // Remove 'hook_' prefix
            .replace(/_/g, ':'); // Replace underscores with colons for namespacing

          // For simple hooks like hook_boot, hookName is just 'boot'
          // No colon replacement needed if there's no underscore
          const simpleName = hookName.includes(':') ? hookName : hookName;

          // Register the hook handler
          // WHY PASS MODULE NAME AS SOURCE:
          // Helps with debugging - know which module registered which hook
          hooks.register(simpleName, exportValue, 10, moduleName);
          wiredHooks.push(simpleName);

          log(`[boot] Wired hook: ${moduleName}.${simpleName}`);
        }

        // Store module exports for later use
        moduleInfo.exports = moduleExports;
        moduleInfo.wiredHooks = wiredHooks;

      } catch (error) {
        // WHY LOG AND CONTINUE:
        // One broken module shouldn't prevent others from loading.
        // In production, you might want stricter handling.
        console.error(`[boot] Failed to load module "${moduleName}": ${error.message}`);
      }
    }

    // Invoke CLI hook to let modules register commands
    // WHY SEPARATE FROM HOOK WIRING:
    // CLI commands need a special registration function that tracks
    // which module registered which command. We pass a module-specific
    // register function to each module's hook_cli export.
    for (const moduleInfo of sortedModules) {
      const moduleName = moduleInfo.name;
      if (!moduleInfo?.exports?.hook_cli) continue;

      try {
        // Create a register function that tracks this module as the source
        const moduleRegister = cli.createModuleRegister(moduleName);
        await moduleInfo.exports.hook_cli(moduleRegister, context);
      } catch (error) {
        console.error(`[boot] Failed to register CLI commands for "${moduleName}": ${error.message}`);
      }
    }

    // Log CLI registration if any module commands were added
    const moduleCommands = cli.listModule();
    if (moduleCommands.length > 0) {
      log(`[boot] CLI commands registered from modules: ${moduleCommands.map(c => c.name).join(', ')}`);
    }

    // Discover AI modules
    // WHY AFTER MODULE LOADING:
    // AI registry needs to scan module manifests to find AI-specific modules
    // This happens after modules are discovered but doesn't require them to be booted
    const aiModuleCount = aiRegistry.discoverAIModules(context.modules);
    if (aiModuleCount > 0) {
      log(`[boot] AI modules discovered: ${aiModuleCount}`);
    }

    // Register core routes
    // WHY HERE (not in server.js):
    // Boot.js knows about the CMS context and what routes make sense.
    // Server.js is generic HTTP infrastructure.
    router.register('GET', '/', async (req, res, params, ctx) => {
      server.json(res, {
        name: ctx.config.site.name,
        version: ctx.config.site.version,
        env: ctx.config.site.env,
        modules: ctx.config.modules.enabled || [],
      });
    }, 'Site information');

    router.register('GET', '/health', async (req, res, params, ctx) => {
      server.json(res, {
        status: 'ok',
        uptime: process.uptime(),
      });
    }, 'Health check');

    // Prometheus-compatible metrics endpoint for monitoring
    router.register('GET', '/metrics', async (req, res, params, ctx) => {
      const lines = [];
      const now = Date.now();

      // System metrics
      const mem = process.memoryUsage();
      lines.push('# HELP process_uptime_seconds Process uptime in seconds');
      lines.push('# TYPE process_uptime_seconds gauge');
      lines.push(`process_uptime_seconds ${process.uptime().toFixed(1)}`);

      lines.push('# HELP process_heap_bytes Process heap size in bytes');
      lines.push('# TYPE process_heap_bytes gauge');
      lines.push(`process_heap_bytes{type="used"} ${mem.heapUsed}`);
      lines.push(`process_heap_bytes{type="total"} ${mem.heapTotal}`);

      lines.push('# HELP process_rss_bytes Resident set size in bytes');
      lines.push('# TYPE process_rss_bytes gauge');
      lines.push(`process_rss_bytes ${mem.rss}`);

      // AI stats metrics (if available)
      try {
        const aiStats = ctx.services.get('ai-stats');
        if (aiStats) {
          const today = new Date().toISOString().split('T')[0];
          const daily = aiStats.getDaily(today);

          lines.push('# HELP cms_ai_requests_total Total AI requests today');
          lines.push('# TYPE cms_ai_requests_total gauge');
          lines.push(`cms_ai_requests_total ${daily.totalEvents}`);

          lines.push('# HELP cms_ai_tokens_total Total AI tokens today');
          lines.push('# TYPE cms_ai_tokens_total gauge');
          lines.push(`cms_ai_tokens_total{direction="in"} ${daily.totalTokensIn}`);
          lines.push(`cms_ai_tokens_total{direction="out"} ${daily.totalTokensOut}`);

          lines.push('# HELP cms_ai_cost_dollars Total AI cost today in dollars');
          lines.push('# TYPE cms_ai_cost_dollars gauge');
          lines.push(`cms_ai_cost_dollars ${daily.totalCost.toFixed(6)}`);

          lines.push('# HELP cms_ai_avg_response_ms Average AI response time in ms');
          lines.push('# TYPE cms_ai_avg_response_ms gauge');
          lines.push(`cms_ai_avg_response_ms ${daily.avgResponseTime.toFixed(1)}`);

          lines.push('# HELP cms_ai_requests_by_status AI requests by status today');
          lines.push('# TYPE cms_ai_requests_by_status gauge');
          for (const [status, count] of Object.entries(daily.byStatus)) {
            lines.push(`cms_ai_requests_by_status{status="${status}"} ${count}`);
          }

          // Per-provider breakdown
          lines.push('# HELP cms_ai_requests_by_provider AI requests by provider today');
          lines.push('# TYPE cms_ai_requests_by_provider gauge');
          for (const [provider, stats] of Object.entries(daily.byProvider)) {
            lines.push(`cms_ai_requests_by_provider{provider="${provider}"} ${stats.count}`);
          }
        }
      } catch {
        // AI stats service not available — skip
      }

      // Content metrics
      try {
        const contentSvc = ctx.services.get('content');
        if (contentSvc) {
          const types = contentSvc.listTypes?.() || [];
          lines.push('# HELP cms_content_types_total Number of content types');
          lines.push('# TYPE cms_content_types_total gauge');
          lines.push(`cms_content_types_total ${types.length}`);
        }
      } catch {
        // Content service not available — skip
      }

      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
      res.end(lines.join('\n') + '\n');
    }, 'Prometheus metrics endpoint');

    // Checklist API — runs site status checks
    router.register('GET', '/api/checklist', async (req, res, params, ctx) => {
      try {
        const checklistSvc = ctx.services.get('checklist');
        const results = await checklistSvc.runAll();
        server.json(res, results);
      } catch (err) {
        server.json(res, { error: err.message }, 500);
      }
    }, 'Run site checklist');

    router.register('GET', '/api/checklist/last', async (req, res, params, ctx) => {
      try {
        const checklistSvc = ctx.services.get('checklist');
        const last = checklistSvc.getLastRun();
        if (!last) {
          server.json(res, { error: 'No previous check run found' }, 404);
          return;
        }
        server.json(res, last);
      } catch (err) {
        server.json(res, { error: err.message }, 500);
      }
    }, 'Get last checklist results');

    // Invoke routes hook to let modules register routes
    // WHY AFTER CLI HOOK:
    // Same pattern - modules get a register function that tracks source.
    for (const moduleInfo of sortedModules) {
      const moduleName = moduleInfo.name;
      if (!moduleInfo?.exports?.hook_routes) continue;

      try {
        const moduleRegister = router.createModuleRegister(moduleName);
        await moduleInfo.exports.hook_routes(moduleRegister, context);
      } catch (error) {
        console.error(`[boot] Failed to register routes for "${moduleName}": ${error.message}`);
      }
    }

    // Log route registration
    const moduleRoutes = router.listModule();
    if (moduleRoutes.length > 0) {
      log(`[boot] Routes registered from modules: ${moduleRoutes.map(r => `${r.method} ${r.path}`).join(', ')}`);
    }

    // Invoke middleware hook to let modules register middleware
    // WHY AFTER ROUTES:
    // Modules may want to register middleware for their routes.
    // Middleware runs before route handlers.
    for (const moduleInfo of sortedModules) {
      const moduleName = moduleInfo.name;
      if (!moduleInfo?.exports?.hook_middleware) continue;

      try {
        const moduleMiddleware = router.createModuleMiddleware(moduleName);
        await moduleInfo.exports.hook_middleware(moduleMiddleware, context);
      } catch (error) {
        console.error(`[boot] Failed to register middleware for "${moduleName}": ${error.message}`);
      }
    }

    // Log middleware registration from modules
    const pathMiddleware = router.listPathMiddleware();
    if (pathMiddleware.length > 0) {
      log(`[boot] Middleware registered from modules: ${pathMiddleware.map(m => `${m.name}:${m.path}`).join(', ')}`);
    }

    // Invoke content hook to let modules register content types
    // WHY AFTER ROUTES:
    // Content types may depend on routes being registered.
    // Modules get a register function that tracks source.
    for (const moduleInfo of sortedModules) {
      const moduleName = moduleInfo.name;
      if (!moduleInfo?.exports?.hook_content) continue;

      try {
        const moduleRegister = content.createModuleRegister(moduleName);
        await moduleInfo.exports.hook_content(moduleRegister, context);
      } catch (error) {
        console.error(`[boot] Failed to register content types for "${moduleName}": ${error.message}`);
      }
    }

    // Register built-in content types (comments)
    if ((context.config.site.comments?.enabled) !== false) {
      const commentsRegister = content.createModuleRegister('core:comments');
      comments.registerContentType(commentsRegister);
    }

    // Log content type registration
    const registeredTypes = content.listTypes();
    if (registeredTypes.length > 0) {
      log(`[boot] Content types registered: ${registeredTypes.map(t => t.type).join(', ')}`);
    }

    // Now that all content types are registered (from config AND modules),
    // auto-register them as JSON:API resources so /jsonapi/{type} works.
    const jsonapiService = services.get('jsonapi');
    if (jsonapiService) {
      jsonapiService.autoRegisterContentTypes();
      log(`[boot] JSON:API resources registered for ${registeredTypes.length} content type(s)`);
    }

    // Invoke computed hook to let modules register computed fields
    // WHY AFTER CONTENT TYPES:
    // Computed fields are defined per content type, so types must exist first.
    for (const moduleInfo of sortedModules) {
      const moduleName = moduleInfo.name;
      if (!moduleInfo?.exports?.hook_computed) continue;

      try {
        const moduleRegister = content.createComputedRegister(moduleName);
        await moduleInfo.exports.hook_computed(moduleRegister, context);
      } catch (error) {
        console.error(`[boot] Failed to register computed fields for "${moduleName}": ${error.message}`);
      }
    }

    // Log computed fields registration
    let computedCount = 0;
    for (const typeInfo of registeredTypes) {
      const fields = content.getComputedFields(typeInfo.type);
      computedCount += Object.keys(fields).length;
    }
    if (computedCount > 0) {
      log(`[boot] Computed fields registered: ${computedCount} total`);
    }

    // Invoke schedule hook to let modules register scheduled tasks
    // WHY AFTER CONTENT HOOK:
    // Scheduled tasks may need to access content types.
    // Modules get a schedule function that prefixes task names with module name.
    for (const moduleInfo of sortedModules) {
      const moduleName = moduleInfo.name;
      if (!moduleInfo?.exports?.hook_schedule) continue;

      try {
        const moduleScheduler = scheduler.createModuleScheduler(moduleName);
        await moduleInfo.exports.hook_schedule(moduleScheduler, context);
      } catch (error) {
        console.error(`[boot] Failed to register scheduled tasks for "${moduleName}": ${error.message}`);
      }
    }

    // Log scheduled task registration
    const registeredTasks = scheduler.list();
    if (registeredTasks.length > 0) {
      log(`[boot] Scheduled tasks registered: ${registeredTasks.map(t => t.name).join(', ')}`);
    }

    // ========================================
    // PLUGIN SYSTEM
    // Load and activate enabled plugins
    // ========================================

    // Initialize plugin system
    const pluginsConfig = context.config.site.plugins || { enabled: [], directory: './plugins' };
    plugins.init(baseDir, pluginsConfig, context.config.site.version);
    plugins.initAutoReload(pluginsConfig);
    services.register('plugins', () => plugins);

    // Load all plugins
    const pluginResults = await plugins.loadAllPlugins(context);

    if (pluginResults.loaded > 0 || pluginResults.errors.length > 0) {
      log(`[boot] Loaded ${pluginResults.loaded} plugin(s), activated ${pluginResults.activated}`);

      // Log active plugins
      const activePlugins = plugins.listPlugins().filter(p => p.status === 'active');
      if (activePlugins.length > 0) {
        log(`[boot] Active plugins: ${activePlugins.map(p => p.name).join(', ')}`);
      }

      // Log plugin errors
      for (const err of pluginResults.errors) {
        console.error(`[boot] Plugin '${err.name}' error during ${err.phase}: ${err.error}`);
      }
    }

    // Register plugin hooks (CLI, routes, content, middleware, schedule)
    // WHY SEPARATE REGISTRATION:
    // Plugins use restricted contexts, so we need to wire their hooks
    // through our controlled registration functions.
    await plugins.registerPluginHooks(context, {
      cliRegister: cli.createModuleRegister('plugin'),
      routeRegister: router.createModuleRegister('plugin'),
      contentRegister: content.createModuleRegister('plugin'),
      middlewareUse: router.createModuleMiddleware('plugin'),
      scheduleTask: scheduler.createModuleScheduler('plugin'),
    });

    // Register content API routes
    // WHY CORE ROUTES:
    // Content CRUD is fundamental CMS functionality.
    // These routes work with any registered content type.

    // GET /content - List all content types
    router.register('GET', '/content', async (req, res, params, ctx) => {
      const types = content.listTypes().map(({ type, schema, source }) => ({
        type,
        source,
        fields: Object.entries(schema).map(([name, def]) => ({
          name,
          type: def.type,
          required: def.required || false,
        })),
      }));
      server.json(res, types);
    }, 'List all content types');

    // GET /content/:type - List content with pagination, search, and filters
    // Query params: ?page=1&limit=20&search=hello&sort=created&order=desc&field=value&field__gt=10
    router.register('GET', '/content/:type', async (req, res, params, ctx) => {
      const { type } = params;

      if (!content.hasType(type)) {
        server.json(res, { error: 'Unknown content type', type }, 404);
        return;
      }

      // Parse query parameters
      const url = new URL(req.url, 'http://localhost');
      const schema = content.getSchema(type);

      const options = {
        page: parseInt(url.searchParams.get('page')) || 1,
        limit: parseInt(url.searchParams.get('limit')) || 20,
        search: url.searchParams.get('search') || null,
        sortBy: url.searchParams.get('sort') || 'created',
        sortOrder: url.searchParams.get('order') || 'desc',
        // Parse field filters from query params
        filters: content.parseFiltersFromQuery(url.searchParams, schema),
      };

      const result = content.list(type, options);
      server.json(res, result);
    }, 'List content with pagination and filters');

    // GET /content/:type/:id - Get single content item
    router.register('GET', '/content/:type/:id', async (req, res, params, ctx) => {
      const { type, id } = params;

      if (!content.hasType(type)) {
        server.json(res, { error: 'Unknown content type', type }, 404);
        return;
      }

      const item = content.read(type, id);

      if (!item) {
        server.json(res, { error: 'Content not found', type, id }, 404);
        return;
      }

      server.json(res, item);
    }, 'Get single content item');

    // POST /content/:type - Create content
    router.register('POST', '/content/:type', async (req, res, params, ctx) => {
      const { type } = params;

      if (!content.hasType(type)) {
        server.json(res, { error: 'Unknown content type', type }, 404);
        return;
      }

      try {
        const data = await content.parseBody(req);
        const item = await content.create(type, data);
        server.json(res, item, 201);
      } catch (error) {
        server.json(res, { error: error.message }, 400);
      }
    }, 'Create content');

    // PUT /content/:type/:id - Update content
    router.register('PUT', '/content/:type/:id', async (req, res, params, ctx) => {
      const { type, id } = params;

      if (!content.hasType(type)) {
        server.json(res, { error: 'Unknown content type', type }, 404);
        return;
      }

      try {
        const data = await content.parseBody(req);
        const item = await content.update(type, id, data);

        if (!item) {
          server.json(res, { error: 'Content not found', type, id }, 404);
          return;
        }

        server.json(res, item);
      } catch (error) {
        server.json(res, { error: error.message }, 400);
      }
    }, 'Update content');

    // DELETE /content/:type/:id - Delete content
    router.register('DELETE', '/content/:type/:id', async (req, res, params, ctx) => {
      const { type, id } = params;

      if (!content.hasType(type)) {
        server.json(res, { error: 'Unknown content type', type }, 404);
        return;
      }

      const deleted = await content.remove(type, id);

      if (!deleted) {
        server.json(res, { error: 'Content not found', type, id }, 404);
        return;
      }

      server.json(res, { deleted: true, type, id });
    }, 'Delete content');

    // GET /content/:type/by-slug/:slug - Get content by slug (with redirect support)
    router.register('GET', '/content/:type/by-slug/:slug', async (req, res, params, ctx) => {
      const { type, slug } = params;

      if (!content.hasType(type)) {
        server.json(res, { error: 'Unknown content type', type }, 404);
        return;
      }

      const result = content.resolvePermalink(type, slug);

      if (!result.found) {
        server.json(res, { error: 'Content not found', type, slug }, 404);
        return;
      }

      // Handle redirect for old slugs
      if (result.redirect) {
        res.writeHead(301, {
          'Location': `/content/${type}/by-slug/${result.currentSlug}`,
          'Content-Type': 'application/json',
        });
        res.end(JSON.stringify({
          redirect: true,
          currentSlug: result.currentSlug,
          location: `/content/${type}/by-slug/${result.currentSlug}`,
        }));
        return;
      }

      server.json(res, result.item);
    }, 'Get content by slug with redirect support');

    // Register search API routes
    // GET /api/search?q=query&type=article&limit=20&highlight=true
    router.register('GET', '/api/search', async (req, res, params, ctx) => {
      const url = new URL(req.url, 'http://localhost');
      const query = url.searchParams.get('q') || '';
      const type = url.searchParams.get('type');
      const limit = parseInt(url.searchParams.get('limit')) || 20;
      const offset = parseInt(url.searchParams.get('offset')) || 0;
      const highlight = url.searchParams.get('highlight') !== 'false';

      if (!query) {
        server.json(res, { error: 'Query parameter "q" is required' }, 400);
        return;
      }

      const types = type ? [type] : null;
      const facetsParam = url.searchParams.get('facets');
      const facets = facetsParam ? facetsParam.split(',') : null;

      const result = search.search(query, { types, limit, offset, highlight, facets });

      server.json(res, result);
    }, 'Search content via API');

    // GET /api/search/facets?fields=status,_type&type=article
    router.register('GET', '/api/search/facets', async (req, res, params, ctx) => {
      const url = new URL(req.url, 'http://localhost');
      const fieldsParam = url.searchParams.get('fields') || '_type,status';
      const type = url.searchParams.get('type');
      const facetFields = fieldsParam.split(',').map(f => f.trim());
      const types = type ? [type] : null;

      const facets = search.getFacets(facetFields, { types });
      server.json(res, { facets });
    }, 'Get facet counts for content filtering');

    // GET /api/search/semantic?q=query&type=article&limit=10
    router.register('GET', '/api/search/semantic', async (req, res, params, ctx) => {
      const url = new URL(req.url, 'http://localhost');
      const query = url.searchParams.get('q') || '';
      const type = url.searchParams.get('type');
      const limit = parseInt(url.searchParams.get('limit')) || 10;

      if (!query) {
        server.json(res, { error: 'Query parameter "q" is required' }, 400);
        return;
      }

      const types = type ? [type] : null;
      const result = await search.semanticSearch(query, { types, limit });
      server.json(res, result);
    }, 'Semantic/vector search via API');

    // Register content CLI commands
    // WHY HERE (not in cli.js):
    // Content commands depend on the content module.
    // Boot.js coordinates initialization order.

    // content:types - List registered content types
    cli.register('content:types', async (args, ctx) => {
      const types = content.listTypes();

      if (types.length === 0) {
        console.log('\nNo content types registered.');
        console.log('Modules can register types via hook_content.\n');
        return;
      }

      console.log('\nContent types:');

      for (const { type, schema, source } of types) {
        const computedFields = content.getComputedFields(type);
        const computedCount = Object.keys(computedFields).length;
        const computedInfo = computedCount > 0 ? ` [${computedCount} computed]` : '';

        console.log(`  ${type} (from: ${source})${computedInfo}`);

        for (const [fieldName, fieldDef] of Object.entries(schema)) {
          if (fieldDef.type === 'computed') {
            const asyncMarker = fieldDef.async ? ' async' : '';
            console.log(`    - ${fieldName}: computed${asyncMarker}`);
          } else {
            const required = fieldDef.required ? ' (required)' : '';
            console.log(`    - ${fieldName}: ${fieldDef.type}${required}`);
          }
        }

        // Show hook-registered computed fields
        for (const [fieldName, fieldDef] of Object.entries(computedFields)) {
          if (fieldDef.source !== 'schema') {
            const asyncMarker = fieldDef.async ? ' async' : '';
            console.log(`    - ${fieldName}: computed${asyncMarker} (via hook)`);
          }
        }
      }

      console.log('');
    }, 'List registered content types');

    // content:computed <type> - List computed fields for a type
    cli.register('content:computed', async (args, ctx) => {
      if (args.length === 0) {
        // Show all computed fields across all types
        const types = content.listTypes();
        let hasAny = false;

        console.log('\nComputed fields by type:');

        for (const { type } of types) {
          const fields = content.getComputedFields(type);
          const fieldNames = Object.keys(fields);

          if (fieldNames.length > 0) {
            hasAny = true;
            console.log(`\n  ${type}:`);
            for (const [name, def] of Object.entries(fields)) {
              const asyncMarker = def.async ? ' (async)' : '';
              const source = def.source || 'unknown';
              console.log(`    - ${name}${asyncMarker} [${source}]`);
            }
          }
        }

        if (!hasAny) {
          console.log('\n  No computed fields registered.');
          console.log('  Modules can register via hook_computed or in schema with type: "computed".');
        }

        console.log('');
        return;
      }

      const type = args[0];

      if (!content.hasType(type)) {
        console.error(`Unknown content type: "${type}"`);
        throw new Error('Unknown content type');
      }

      const fields = content.getComputedFields(type);
      const fieldNames = Object.keys(fields);

      console.log(`\nComputed fields for ${type}:`);

      if (fieldNames.length === 0) {
        console.log('  No computed fields defined.\n');
        return;
      }

      for (const [name, def] of Object.entries(fields)) {
        const asyncMarker = def.async ? ' (async)' : '';
        const source = def.source || 'unknown';

        // Get first line of compute function for preview
        const fnStr = def.compute.toString();
        const preview = fnStr.length > 60 ? fnStr.slice(0, 60) + '...' : fnStr;

        console.log(`  ${name}${asyncMarker} [${source}]`);
        console.log(`    ${preview}`);
      }

      console.log('');
    }, 'List computed fields for a content type');

    // content:test-computed <type> <id> - Test computed values for a content item
    cli.register('content:test-computed', async (args, ctx) => {
      if (args.length < 2) {
        console.error('Usage: content:test-computed <type> <id>');
        console.error('Example: content:test-computed article abc123');
        throw new Error('Type and ID required');
      }

      const [type, id] = args;

      if (!content.hasType(type)) {
        console.error(`Unknown content type: "${type}"`);
        throw new Error('Unknown content type');
      }

      const fields = content.getComputedFields(type);

      if (Object.keys(fields).length === 0) {
        console.log(`\nNo computed fields for type "${type}".\n`);
        return;
      }

      // Read item without computed fields first
      const item = content.read(type, id, { computed: false });

      if (!item) {
        console.error(`Content not found: ${type}/${id}`);
        throw new Error('Content not found');
      }

      console.log(`\nComputed values for ${type}/${id}:`);

      for (const [name, def] of Object.entries(fields)) {
        try {
          let value;
          if (def.async) {
            value = await def.compute(item, context);
          } else {
            value = def.compute(item, context);
          }

          const displayValue = typeof value === 'object'
            ? JSON.stringify(value)
            : String(value);

          console.log(`  ${name}: ${displayValue}`);
        } catch (error) {
          console.log(`  ${name}: [ERROR] ${error.message}`);
        }
      }

      console.log('');
    }, 'Test computed values for a content item');

    // content:slug <type> <id> - Show slug and history for item
    cli.register('content:slug', async (args, ctx) => {
      if (args.length < 2) {
        console.error('Usage: content:slug <type> <id>');
        console.error('Example: content:slug article abc123');
        throw new Error('Type and ID required');
      }

      const [type, id] = args;
      const content = ctx.services.get('content');

      if (!content.hasType(type)) {
        throw new Error(`Unknown content type: ${type}`);
      }

      const slugInfo = content.getSlugInfo(type, id);
      if (!slugInfo) {
        throw new Error(`Content not found: ${type}/${id}`);
      }

      console.log(`\nSlug for ${type}/${id}:`);
      console.log(`  current: ${slugInfo.slug || '(none)'}`);
      if (slugInfo.history.length > 0) {
        console.log(`  history: ${slugInfo.history.join(', ')}`);
      } else {
        console.log('  history: (none)');
      }
      console.log('');
    }, 'Show slug and history for a content item');

    // slugs:list <type> - List all slugs for a type
    cli.register('slugs:list', async (args, ctx) => {
      if (args.length === 0) {
        console.error('Usage: slugs:list <type>');
        console.error('Example: slugs:list article');
        throw new Error('Type required');
      }

      const type = args[0];
      const content = ctx.services.get('content');

      if (!content.hasType(type)) {
        throw new Error(`Unknown content type: ${type}`);
      }

      const slugs = content.listSlugs(type);

      console.log(`\nSlugs for ${type}:`);
      if (slugs.length === 0) {
        console.log('  No slugs found (type may not have slug field)');
      } else {
        for (const { slug, id, history } of slugs) {
          if (history.length > 0) {
            console.log(`  ${slug} → ${id} (history: ${history.join(', ')})`);
          } else {
            console.log(`  ${slug} → ${id}`);
          }
        }
      }
      console.log('');
    }, 'List all slugs for a content type');

    // slugs:fix [type] - Regenerate missing slugs
    cli.register('slugs:fix', async (args, ctx) => {
      const content = ctx.services.get('content');
      const types = args.length > 0 ? [args[0]] : content.listTypes().map(t => t.type);

      console.log('\nRegenerating missing slugs...\n');

      let totalFixed = 0;
      let totalErrors = 0;

      for (const type of types) {
        if (!content.hasSlugField(type)) {
          continue;
        }

        const result = await content.regenerateMissingSlugs(type);
        totalFixed += result.fixed;
        totalErrors += result.errors.length;

        if (result.fixed > 0) {
          console.log(`  ${type}: ${result.fixed} slug(s) generated`);
        }
        for (const err of result.errors) {
          console.log(`  ${type}/${err.id}: ERROR - ${err.error}`);
        }
      }

      console.log(`\nTotal: ${totalFixed} fixed, ${totalErrors} errors\n`);
    }, 'Regenerate missing slugs for content types');

    // slugs:check [type] - Find duplicate or invalid slugs
    cli.register('slugs:check', async (args, ctx) => {
      const content = ctx.services.get('content');
      const type = args.length > 0 ? args[0] : null;

      console.log('\nChecking slugs...\n');

      const result = content.checkSlugs(type);

      if (result.duplicates.length === 0 && result.invalid.length === 0) {
        console.log('  All slugs are valid and unique.\n');
        return;
      }

      if (result.duplicates.length > 0) {
        console.log('Duplicate slugs:');
        for (const dup of result.duplicates) {
          console.log(`  ${dup.type}/${dup.slug}: ${dup.count} items (${dup.ids.join(', ')})`);
        }
        console.log('');
      }

      if (result.invalid.length > 0) {
        console.log('Invalid slugs:');
        for (const inv of result.invalid) {
          console.log(`  ${inv.type}/${inv.id}: "${inv.slug}" - ${inv.errors.join(', ')}`);
        }
        console.log('');
      }
    }, 'Find duplicate or invalid slugs');

    // trash:list [type] [--days=N] - List trashed items
    cli.register('trash:list', async (args, ctx) => {
      const content = ctx.services.get('content');
      const type = args.find(a => !a.startsWith('--')) || null;

      let olderThanDays = 0;
      for (const arg of args) {
        if (arg.startsWith('--days=')) {
          olderThanDays = parseInt(arg.slice(7)) || 0;
        }
      }

      const items = content.listTrash(type, { olderThanDays });
      const trashConfig = content.getTrashConfig();

      console.log('\nTrashed items:');
      if (items.length === 0) {
        console.log('  (none)\n');
        return;
      }

      for (const item of items) {
        const trashedDate = new Date(item._trashedAt).toLocaleDateString();
        const title = item.title || item.name || item.id;
        const by = item._trashedBy || 'unknown';
        console.log(`  ${item.type}/${item.id} - "${title}" - trashed ${trashedDate} by ${by} (${item._daysInTrash} days ago)`);
        if (item._daysRemaining <= 5 && trashConfig.autoPurge) {
          console.log(`    ⚠ Auto-purge in ${item._daysRemaining} days`);
        }
      }
      console.log('');
    }, 'List trashed items');

    // trash:restore <type> <id> - Restore item from trash
    cli.register('trash:restore', async (args, ctx) => {
      if (args.length < 2) {
        console.error('Usage: trash:restore <type> <id>');
        console.error('Example: trash:restore article abc123');
        throw new Error('Type and ID required');
      }

      const [type, id] = args;
      const content = ctx.services.get('content');

      const item = await content.restore(type, id);
      if (!item) {
        throw new Error(`Item not found in trash: ${type}/${id}`);
      }

      console.log(`\nRestored ${type}/${id}\n`);
    }, 'Restore item from trash');

    // trash:purge <type> <id> - Permanently delete from trash
    cli.register('trash:purge', async (args, ctx) => {
      if (args.length < 2) {
        console.error('Usage: trash:purge <type> <id>');
        console.error('Example: trash:purge article abc123');
        throw new Error('Type and ID required');
      }

      const [type, id] = args;
      const content = ctx.services.get('content');

      const success = await content.purge(type, id);
      if (!success) {
        throw new Error(`Item not found in trash: ${type}/${id}`);
      }

      console.log(`\nPermanently deleted ${type}/${id}\n`);
    }, 'Permanently delete item from trash');

    // trash:empty [type] [--older-than=N] - Empty trash
    cli.register('trash:empty', async (args, ctx) => {
      const content = ctx.services.get('content');
      const type = args.find(a => !a.startsWith('--')) || null;

      let olderThanDays = 0;
      for (const arg of args) {
        if (arg.startsWith('--older-than=')) {
          olderThanDays = parseInt(arg.slice(13)) || 0;
        }
      }

      const result = await content.emptyTrash(type, { olderThanDays });

      if (olderThanDays > 0) {
        console.log(`\nPurged ${result.purged} items older than ${olderThanDays} days`);
      } else if (type) {
        console.log(`\nPurged ${result.purged} ${type} items from trash`);
      } else {
        console.log(`\nPurged ${result.purged} items from trash`);
      }

      if (result.errors.length > 0) {
        console.log(`Errors: ${result.errors.length}`);
        for (const err of result.errors) {
          console.log(`  ${err.type}/${err.id}: ${err.error}`);
        }
      }
      console.log('');
    }, 'Empty trash');

    // trash:stats - Show trash statistics
    cli.register('trash:stats', async (args, ctx) => {
      const content = ctx.services.get('content');
      const stats = content.getTrashStats();

      console.log('\nTrash statistics:');
      console.log(`  Total items: ${stats.total}`);

      if (stats.total > 0) {
        console.log('  By type:');
        for (const [type, count] of Object.entries(stats.byType)) {
          console.log(`    ${type}: ${count}`);
        }
        console.log(`  Oldest: ${stats.oldestDays} days ago`);
        if (stats.autoPurgeEnabled && stats.autoPurgeIn !== null) {
          if (stats.autoPurgeIn === 0) {
            console.log('  Auto-purge: pending (oldest items ready for purge)');
          } else {
            console.log(`  Auto-purge in: ${stats.autoPurgeIn} days (for oldest items)`);
          }
        }
      }

      console.log(`  Retention: ${stats.retention} days`);
      console.log(`  Auto-purge: ${stats.autoPurgeEnabled ? 'enabled' : 'disabled'}\n`);
    }, 'Show trash statistics');

    // content:clone <type> <id> [--prefix="Copy of "] [--deep] [--field.X=Y] - Clone content
    cli.register('content:clone', async (args, ctx) => {
      if (args.length < 2) {
        console.error('Usage: content:clone <type> <id> [options]');
        console.error('Options:');
        console.error('  --prefix="Copy of "  Prefix for title/name');
        console.error('  --suffix=""          Suffix for title/name');
        console.error('  --deep               Clone referenced items');
        console.error('  --field.X=Y          Override field X with value Y');
        console.error('Example: content:clone article abc123 --prefix="" --field.title="New Title"');
        throw new Error('Type and ID required');
      }

      const content = ctx.services.get('content');
      const type = args[0];
      const id = args[1];

      // Parse options
      const options = { fields: {} };
      for (const arg of args.slice(2)) {
        if (arg.startsWith('--prefix=')) {
          options.prefix = arg.slice(9).replace(/^["']|["']$/g, '');
        } else if (arg.startsWith('--suffix=')) {
          options.suffix = arg.slice(9).replace(/^["']|["']$/g, '');
        } else if (arg === '--deep') {
          options.deep = true;
        } else if (arg === '--include-translations') {
          options.includeTranslations = true;
        } else if (arg.startsWith('--field.')) {
          const match = arg.match(/^--field\.([^=]+)=(.*)$/);
          if (match) {
            options.fields[match[1]] = match[2].replace(/^["']|["']$/g, '');
          }
        }
      }

      if (!content.hasType(type)) {
        throw new Error(`Unknown content type: ${type}`);
      }

      const clone = await content.clone(type, id, options);

      const titleField = clone.title || clone.name || clone.id;
      console.log(`\nCloned ${type}/${id} → ${type}/${clone.id}`);
      console.log(`  Title: "${titleField}"`);
      if (clone.slug) {
        console.log(`  Slug: ${clone.slug}`);
      }
      if (clone.status) {
        console.log(`  Status: ${clone.status}`);
      }

      if (clone._clonedReferences && clone._clonedReferences.length > 0) {
        console.log('  Also cloned:');
        for (const ref of clone._clonedReferences) {
          console.log(`    ${ref.type}/${ref.original} → ${ref.type}/${ref.clone}`);
        }
      }
      console.log('');
    }, 'Clone content item');

    // content:duplicate <type> <id> - Shorthand for clone with defaults
    cli.register('content:duplicate', async (args, ctx) => {
      if (args.length < 2) {
        console.error('Usage: content:duplicate <type> <id>');
        console.error('Shorthand for: content:clone <type> <id>');
        throw new Error('Type and ID required');
      }

      const content = ctx.services.get('content');
      const [type, id] = args;

      if (!content.hasType(type)) {
        throw new Error(`Unknown content type: ${type}`);
      }

      const clone = await content.clone(type, id);

      const titleField = clone.title || clone.name || clone.id;
      console.log(`\nDuplicated ${type}/${id} → ${type}/${clone.id}`);
      console.log(`  Title: "${titleField}"`);
      console.log('');
    }, 'Duplicate content item (shorthand for clone)');

    // locks:list [type] - List all active locks
    cli.register('locks:list', async (args, ctx) => {
      const content = ctx.services.get('content');
      const typeFilter = args[0] || null;

      const locks = content.listLocks(typeFilter);

      if (locks.length === 0) {
        console.log('\nNo active locks.');
        if (typeFilter) {
          console.log(`  (filtered by type: ${typeFilter})`);
        }
        console.log('');
        return;
      }

      console.log('\nActive locks:');
      for (const lock of locks) {
        const acquiredDate = new Date(lock.acquiredAt);
        const expiresMin = Math.ceil(lock.expiresIn / 60);
        const status = lock.inGracePeriod ? ' (in grace period)' : '';
        console.log(`  ${lock.type}/${lock.id} - locked by ${lock.username} since ${acquiredDate.toLocaleTimeString()} (expires in ${expiresMin} min)${status}`);
      }
      console.log('');
    }, 'List all active content locks');

    // locks:check <type> <id> - Check lock status for item
    cli.register('locks:check', async (args, ctx) => {
      if (args.length < 2) {
        console.error('Usage: locks:check <type> <id>');
        throw new Error('Type and ID required');
      }

      const content = ctx.services.get('content');
      const [type, id] = args;

      const status = content.checkLock(type, id);

      console.log(`\nLock status for ${type}/${id}:`);
      if (!status.locked) {
        console.log('  Locked: no');
        if (status.wasExpired) {
          console.log('  (Lock recently expired)');
        }
      } else {
        console.log('  Locked: yes');
        console.log(`  By: ${status.username} (user/${status.userId})`);
        console.log(`  Since: ${status.acquiredAt}`);
        console.log(`  Expires: ${status.expiresAt} (in ${Math.ceil(status.expiresIn / 60)} minutes)`);
        if (status.inGracePeriod) {
          console.log('  Status: In grace period');
        }
      }
      console.log('');
    }, 'Check lock status for content item');

    // locks:release <type> <id> - Force release lock
    cli.register('locks:release', async (args, ctx) => {
      if (args.length < 2) {
        console.error('Usage: locks:release <type> <id>');
        throw new Error('Type and ID required');
      }

      const content = ctx.services.get('content');
      const [type, id] = args;

      const released = content.forceReleaseLock(type, id);

      if (released) {
        console.log(`\nReleased lock on ${type}/${id}`);
        console.log(`  Was held by: ${released.username}`);
      } else {
        console.log(`\nNo active lock on ${type}/${id}`);
      }
      console.log('');
    }, 'Force release a content lock');

    // locks:cleanup - Remove all expired locks
    cli.register('locks:cleanup', async (args, ctx) => {
      const content = ctx.services.get('content');
      const removed = content.cleanupExpiredLocks();

      console.log(`\nCleaned up ${removed} expired lock(s).`);
      console.log('');
    }, 'Remove all expired locks');

    // locks:stats - Show lock statistics
    cli.register('locks:stats', async (args, ctx) => {
      const content = ctx.services.get('content');
      const stats = content.getLockStats();

      console.log('\nLock statistics:');
      console.log(`  Total active: ${stats.total}`);
      if (Object.keys(stats.byType).length > 0) {
        console.log('  By type:');
        for (const [type, count] of Object.entries(stats.byType)) {
          console.log(`    ${type}: ${count}`);
        }
      }
      if (stats.soonestExpiry) {
        const expiresIn = Math.ceil((new Date(stats.soonestExpiry) - new Date()) / 60000);
        console.log(`  Soonest expiry: in ${expiresIn} minutes`);
      }
      console.log(`  Timeout: ${stats.timeout} seconds`);
      console.log(`  Grace period: ${stats.gracePeriod} seconds`);
      console.log(`  Enabled: ${stats.enabled}`);
      console.log('');
    }, 'Show lock statistics');

    // comments:list [--status=pending] [--type=article] - List comments
    cli.register('comments:list', async (args, ctx) => {
      const comments = ctx.services.get('comments');

      // Parse options
      const options = { status: null, contentType: null, limit: 20 };
      for (const arg of args) {
        if (arg.startsWith('--status=')) {
          options.status = arg.slice(9);
        } else if (arg.startsWith('--type=')) {
          options.contentType = arg.slice(7);
        } else if (arg.startsWith('--limit=')) {
          options.limit = parseInt(arg.slice(8)) || 20;
        }
      }

      const result = comments.getAllComments(options);

      if (result.comments.length === 0) {
        console.log('\nNo comments found.');
        console.log('');
        return;
      }

      const statusLabel = options.status || 'all';
      console.log(`\nComments (${statusLabel}, showing ${result.comments.length} of ${result.total}):`);
      for (const comment of result.comments) {
        const excerpt = comment.body.slice(0, 40) + (comment.body.length > 40 ? '...' : '');
        const statusBadge = comment.status === 'pending' ? '[PENDING]' : `[${comment.status}]`;
        console.log(`  ${statusBadge} ${comment.id} on ${comment.contentType}/${comment.contentId} by "${comment.author}" - "${excerpt}"`);
      }
      console.log('');
    }, 'List comments with filters');

    // comments:pending - List pending comments (shorthand)
    cli.register('comments:pending', async (args, ctx) => {
      const comments = ctx.services.get('comments');
      const result = comments.getModerationQueue({ limit: 50 });

      if (result.comments.length === 0) {
        console.log('\nNo pending comments.');
        console.log('');
        return;
      }

      console.log(`\nPending comments (${result.total}):`);
      for (const comment of result.comments) {
        const excerpt = comment.body.slice(0, 40) + (comment.body.length > 40 ? '...' : '');
        console.log(`  [${comment.id}] on ${comment.contentType}/${comment.contentId} by "${comment.author}" - "${excerpt}"`);
      }
      console.log('');
    }, 'List pending comments for moderation');

    // comments:approve <id> - Approve comment
    cli.register('comments:approve', async (args, ctx) => {
      if (args.length < 1) {
        console.error('Usage: comments:approve <id>');
        throw new Error('Comment ID required');
      }

      const comments = ctx.services.get('comments');
      const id = args[0];

      const updated = await comments.approveComment(id);
      console.log(`\nApproved comment ${id}`);
      console.log(`  Author: ${updated.author}`);
      console.log(`  On: ${updated.contentType}/${updated.contentId}`);
      console.log('');
    }, 'Approve a pending comment');

    // comments:spam <id> - Mark comment as spam
    cli.register('comments:spam', async (args, ctx) => {
      if (args.length < 1) {
        console.error('Usage: comments:spam <id>');
        throw new Error('Comment ID required');
      }

      const comments = ctx.services.get('comments');
      const id = args[0];

      const updated = await comments.spamComment(id);
      console.log(`\nMarked comment ${id} as spam`);
      console.log(`  Author: ${updated.author}`);
      console.log('');
    }, 'Mark comment as spam');

    // comments:trash <id> - Trash comment
    cli.register('comments:trash', async (args, ctx) => {
      if (args.length < 1) {
        console.error('Usage: comments:trash <id>');
        throw new Error('Comment ID required');
      }

      const comments = ctx.services.get('comments');
      const id = args[0];

      const updated = await comments.trashComment(id);
      console.log(`\nTrashed comment ${id}`);
      console.log('');
    }, 'Move comment to trash');

    // comments:delete <id> - Permanently delete comment
    cli.register('comments:delete', async (args, ctx) => {
      if (args.length < 1) {
        console.error('Usage: comments:delete <id>');
        throw new Error('Comment ID required');
      }

      const comments = ctx.services.get('comments');
      const id = args[0];

      await comments.deleteComment(id);
      console.log(`\nDeleted comment ${id}`);
      console.log('');
    }, 'Permanently delete comment');

    // comments:stats - Show comment statistics
    cli.register('comments:stats', async (args, ctx) => {
      const comments = ctx.services.get('comments');
      const stats = comments.getStats();

      console.log('\nComment statistics:');
      console.log(`  Total: ${stats.total}`);
      if (Object.keys(stats.byStatus).length > 0) {
        console.log('  By status:');
        for (const [status, count] of Object.entries(stats.byStatus)) {
          console.log(`    ${status}: ${count}`);
        }
      }
      if (Object.keys(stats.byContentType).length > 0) {
        console.log('  By content type:');
        for (const [type, count] of Object.entries(stats.byContentType)) {
          console.log(`    ${type}: ${count}`);
        }
      }
      console.log('');
    }, 'Show comment statistics');

    // content:list <type> [--page=N] [--limit=N] [--search=term] [--filter="field=value"] - List content with pagination and filters
    cli.register('content:list', async (args, ctx) => {
      if (args.length === 0) {
        console.error('Usage: content:list <type> [--page=N] [--limit=N] [--search=term] [--filter="field=value"]');
        console.error('Example: node index.js content:list greeting --page=1 --limit=10');
        console.error('Example: node index.js content:list user --filter="role=admin" --filter="created__gte=2024-01-01"');
        console.error('\nFilter operators: eq (default), ne, gt, gte, lt, lte, contains, startswith, endswith, in');
        throw new Error('Content type required');
      }

      // Parse type and options
      const type = args[0];
      const options = { page: 1, limit: 20, search: null, filters: {} };

      for (const arg of args.slice(1)) {
        if (arg.startsWith('--page=')) {
          options.page = parseInt(arg.slice(7)) || 1;
        } else if (arg.startsWith('--limit=')) {
          options.limit = parseInt(arg.slice(8)) || 20;
        } else if (arg.startsWith('--search=')) {
          options.search = arg.slice(9);
        } else if (arg.startsWith('--filter=')) {
          // Parse filter in format "field=value" or "field__op=value"
          const filterStr = arg.slice(9);
          const eqIndex = filterStr.indexOf('=');
          if (eqIndex > 0) {
            const key = filterStr.slice(0, eqIndex);
            const value = filterStr.slice(eqIndex + 1);
            options.filters[key] = value;
          }
        }
      }

      // Convert empty filters object to null
      if (Object.keys(options.filters).length === 0) {
        options.filters = null;
      }

      if (!content.hasType(type)) {
        console.error(`Unknown content type: "${type}"`);
        console.error('Use "content:types" to see available types.');
        throw new Error('Unknown content type');
      }

      const result = content.list(type, options);

      if (result.total === 0) {
        console.log(`\nNo ${type} content found.`);
        if (options.search) {
          console.log(`Search: "${options.search}" returned no results.`);
        }
        if (options.filters) {
          console.log(`Filters: ${JSON.stringify(options.filters)} returned no results.`);
        }
        console.log(`Create some with: content:create ${type} '{"field":"value"}'\n`);
        return;
      }

      const startItem = (result.page - 1) * result.limit + 1;
      const endItem = Math.min(result.page * result.limit, result.total);

      // Show filters in header if any
      const filterInfo = options.filters ? ` [filtered]` : '';
      console.log(`\n${type} content${filterInfo} (showing ${startItem}-${endItem} of ${result.total}):\n`);

      for (const item of result.items) {
        console.log(`  ID: ${item.id}`);
        console.log(`  Created: ${item.created}`);

        // Show user fields (exclude system fields)
        const userFields = Object.entries(item)
          .filter(([k]) => !['id', 'type', 'created', 'updated'].includes(k));

        for (const [key, value] of userFields) {
          const displayValue = typeof value === 'string' && value.length > 50
            ? value.substring(0, 47) + '...'
            : JSON.stringify(value);
          console.log(`  ${key}: ${displayValue}`);
        }

        console.log('');
      }

      if (result.pages > 1) {
        console.log(`Page ${result.page} of ${result.pages}`);
      }

      // Show active filters
      if (options.filters) {
        console.log(`Active filters: ${Object.entries(options.filters).map(([k, v]) => `${k}=${v}`).join(', ')}`);
      }
    }, 'List content with pagination and filters');

    // content:search <query> - Search across all content types
    cli.register('content:search', async (args, ctx) => {
      if (args.length === 0) {
        console.error('Usage: content:search <query>');
        console.error('Example: node index.js content:search hello');
        throw new Error('Search query required');
      }

      const query = args.join(' ');
      const results = content.search(query);

      if (results.length === 0) {
        console.log(`\nNo results found for "${query}".\n`);
        return;
      }

      console.log(`\nFound ${results.length} result(s) for "${query}":\n`);

      for (const { type, item } of results) {
        // Find the matching field(s) for context
        const matchingFields = [];
        for (const [key, value] of Object.entries(item)) {
          if (typeof value === 'string' && value.toLowerCase().includes(query.toLowerCase())) {
            const displayValue = value.length > 40 ? value.substring(0, 37) + '...' : value;
            matchingFields.push(`${key}="${displayValue}"`);
          }
        }

        console.log(`  [${type}] ${item.id}: ${matchingFields.join(', ')}`);
      }

      console.log('');
    }, 'Search across all content types');

    // content:create <type> <json> - Create content from JSON
    cli.register('content:create', async (args, ctx) => {
      if (args.length < 2) {
        console.error('Usage: content:create <type> <json>');
        console.error('Example: node index.js content:create greeting \'{"name":"Ernie","message":"Hello!"}\'');
        throw new Error('Type and JSON data required');
      }

      const type = args[0];
      const jsonStr = args.slice(1).join(' ');

      if (!content.hasType(type)) {
        console.error(`Unknown content type: "${type}"`);
        console.error('Use "content:types" to see available types.');
        throw new Error('Unknown content type');
      }

      let data;
      try {
        data = JSON.parse(jsonStr);
      } catch (error) {
        console.error('Invalid JSON:', error.message);
        throw new Error('Invalid JSON');
      }

      const item = await content.create(type, data);
      console.log('\nCreated:');
      console.log(JSON.stringify(item, null, 2));
      console.log('');
    }, 'Create content from JSON');

    // content:delete <type> <id> - Delete content
    cli.register('content:delete', async (args, ctx) => {
      if (args.length < 2) {
        console.error('Usage: content:delete <type> <id>');
        console.error('Example: node index.js content:delete greeting 1705123456789-x7k9m');
        throw new Error('Type and ID required');
      }

      const [type, id] = args;

      if (!content.hasType(type)) {
        console.error(`Unknown content type: "${type}"`);
        throw new Error('Unknown content type');
      }

      const deleted = await content.remove(type, id);

      if (deleted) {
        console.log(`Deleted ${type}/${id}`);
      } else {
        console.log(`Not found: ${type}/${id}`);
      }
    }, 'Delete content by type and ID');

    // ==================================================
    // Revision CLI Commands
    // ==================================================

    // content:revisions <type> <id> - List revisions for an item
    cli.register('content:revisions', async (args, ctx) => {
      if (args.length < 2) {
        console.error('Usage: content:revisions <type> <id>');
        console.error('Example: content:revisions greeting abc123');
        throw new Error('Type and ID required');
      }

      const [type, id] = args;

      if (!content.hasType(type)) {
        console.error(`Unknown content type: "${type}"`);
        throw new Error('Unknown content type');
      }

      const current = content.read(type, id);
      if (!current) {
        console.error(`Content not found: ${type}/${id}`);
        throw new Error('Content not found');
      }

      const revisions = content.getRevisions(type, id);

      console.log(`\nRevisions for ${type}/${id}:`);
      console.log(`  ${current.updated} (current)`);

      if (revisions.length === 0) {
        console.log('  (no previous revisions)');
      } else {
        for (const rev of revisions) {
          console.log(`  ${rev.timestamp}`);
        }
      }

      console.log('');
    }, 'List revisions for a content item');

    // content:revert <type> <id> <timestamp> - Revert to a revision
    cli.register('content:revert', async (args, ctx) => {
      if (args.length < 3) {
        console.error('Usage: content:revert <type> <id> <timestamp>');
        console.error('Example: content:revert greeting abc123 2024-01-15T11:30:00.000Z');
        throw new Error('Type, ID, and timestamp required');
      }

      const [type, id, timestamp] = args;

      if (!content.hasType(type)) {
        console.error(`Unknown content type: "${type}"`);
        throw new Error('Unknown content type');
      }

      const restored = await content.revertTo(type, id, timestamp);

      if (!restored) {
        console.error(`Revision not found: ${type}/${id}@${timestamp}`);
        throw new Error('Revision not found');
      }

      console.log(`Reverted ${type}/${id} to ${timestamp}`);
      console.log('(previous version saved as new revision)');
    }, 'Revert content to a previous revision');

    // content:diff <type> <id> <ts1> <ts2> - Show diff between revisions
    cli.register('content:diff', async (args, ctx) => {
      if (args.length < 4) {
        console.error('Usage: content:diff <type> <id> <ts1> <ts2>');
        console.error('Use "current" for ts1 or ts2 to compare with current version');
        console.error('Example: content:diff greeting abc123 2024-01-15T11:00:00.000Z current');
        throw new Error('Type, ID, and two timestamps required');
      }

      const [type, id, ts1, ts2] = args;

      if (!content.hasType(type)) {
        console.error(`Unknown content type: "${type}"`);
        throw new Error('Unknown content type');
      }

      const diff = content.diffRevisions(type, id, ts1, ts2);

      if (!diff) {
        console.error('Could not compute diff (one or both versions not found)');
        throw new Error('Diff failed');
      }

      console.log(`\nDiff: ${type}/${id}`);
      console.log(`  From: ${diff.ts1}`);
      console.log(`  To:   ${diff.ts2}`);
      console.log('');

      if (diff.changes.length === 0) {
        console.log('  No changes detected.');
      } else {
        for (const change of diff.changes) {
          const fromStr = JSON.stringify(change.from);
          const toStr = JSON.stringify(change.to);

          if (change.type === 'added') {
            console.log(`  + ${change.field}: ${toStr}`);
          } else if (change.type === 'removed') {
            console.log(`  - ${change.field}: ${fromStr}`);
          } else {
            console.log(`  ~ ${change.field}:`);
            console.log(`      from: ${fromStr}`);
            console.log(`      to:   ${toStr}`);
          }
        }
      }

      console.log('');
    }, 'Show diff between two revisions');

    // revisions:prune [--keep=N] - Prune old revisions across all content
    cli.register('revisions:prune', async (args, ctx) => {
      let keep = 10;

      for (const arg of args) {
        if (arg.startsWith('--keep=')) {
          keep = parseInt(arg.slice(7)) || 10;
        }
      }

      console.log(`Pruning revisions (keeping ${keep} per item)...`);

      let totalDeleted = 0;
      let itemsProcessed = 0;

      // Iterate through all content types
      for (const { type } of content.listTypes()) {
        const items = content.listAll(type);

        for (const item of items) {
          const deleted = content.pruneRevisions(type, item.id, keep);
          if (deleted > 0) {
            totalDeleted += deleted;
            itemsProcessed++;
          }
        }
      }

      if (totalDeleted === 0) {
        console.log('No revisions to prune.');
      } else {
        console.log(`Deleted ${totalDeleted} revision(s) from ${itemsProcessed} item(s).`);
      }
    }, 'Prune old revisions across all content');

    // ==================================================
    // Workflow CLI Commands
    // ==================================================

    // content:publish <type> <id> - Publish content
    cli.register('content:publish', async (args, ctx) => {
      if (args.length < 2) {
        console.error('Usage: content:publish <type> <id>');
        throw new Error('Type and ID required');
      }

      const [type, id] = args;

      if (!content.hasType(type)) {
        console.error(`Unknown content type: "${type}"`);
        throw new Error('Unknown content type');
      }

      const item = await content.publish(type, id);

      if (!item) {
        console.error(`Not found: ${type}/${id}`);
        throw new Error('Content not found');
      }

      console.log(`Published ${type}/${id}`);
    }, 'Publish content');

    // content:unpublish <type> <id> - Unpublish content
    cli.register('content:unpublish', async (args, ctx) => {
      if (args.length < 2) {
        console.error('Usage: content:unpublish <type> <id>');
        throw new Error('Type and ID required');
      }

      const [type, id] = args;

      if (!content.hasType(type)) {
        console.error(`Unknown content type: "${type}"`);
        throw new Error('Unknown content type');
      }

      const item = await content.unpublish(type, id);

      if (!item) {
        console.error(`Not found: ${type}/${id}`);
        throw new Error('Content not found');
      }

      console.log(`Unpublished ${type}/${id} (status: draft)`);
    }, 'Unpublish content (set to draft)');

    // content:archive <type> <id> - Archive content
    cli.register('content:archive', async (args, ctx) => {
      if (args.length < 2) {
        console.error('Usage: content:archive <type> <id>');
        throw new Error('Type and ID required');
      }

      const [type, id] = args;

      if (!content.hasType(type)) {
        console.error(`Unknown content type: "${type}"`);
        throw new Error('Unknown content type');
      }

      const item = await content.archive(type, id);

      if (!item) {
        console.error(`Not found: ${type}/${id}`);
        throw new Error('Content not found');
      }

      console.log(`Archived ${type}/${id}`);
    }, 'Archive content');

    // content:schedule <type> <id> <datetime> - Schedule publishing
    cli.register('content:schedule', async (args, ctx) => {
      if (args.length < 3) {
        console.error('Usage: content:schedule <type> <id> <datetime>');
        console.error('Example: content:schedule article abc123 "2024-01-20T09:00:00Z"');
        throw new Error('Type, ID, and datetime required');
      }

      const [type, id, datetime] = args;

      if (!content.hasType(type)) {
        console.error(`Unknown content type: "${type}"`);
        throw new Error('Unknown content type');
      }

      const publishDate = new Date(datetime);
      if (isNaN(publishDate.getTime())) {
        console.error(`Invalid datetime: "${datetime}"`);
        throw new Error('Invalid datetime');
      }

      const item = await content.schedulePublish(type, id, publishDate);

      if (!item) {
        console.error(`Not found: ${type}/${id}`);
        throw new Error('Content not found');
      }

      console.log(`Scheduled ${type}/${id} for ${publishDate.toISOString()}`);
    }, 'Schedule content for future publishing');

    // content:status <type> [--status=draft] - List content by status
    cli.register('content:status', async (args, ctx) => {
      if (args.length < 1) {
        console.error('Usage: content:status <type> [--status=draft|pending|published|archived|all]');
        throw new Error('Type required');
      }

      const type = args[0];
      let status = 'all';

      for (const arg of args.slice(1)) {
        if (arg.startsWith('--status=')) {
          status = arg.slice(9);
        }
      }

      if (!content.hasType(type)) {
        console.error(`Unknown content type: "${type}"`);
        throw new Error('Unknown content type');
      }

      const result = content.getByStatus(type, status, { limit: 50 });

      if (result.total === 0) {
        console.log(`\nNo ${type} items with status "${status}".`);
        return;
      }

      const statusLabel = status === 'all' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1);
      console.log(`\n${statusLabel} ${type} items (${result.total} total):\n`);

      for (const item of result.items) {
        const itemStatus = item.status || 'draft';
        const title = item.title || item.name || item.id;
        const created = item.created ? item.created.split('T')[0] : '';
        const scheduled = item.scheduledAt ? ` (scheduled: ${item.scheduledAt.split('T')[0]})` : '';
        console.log(`  ${item.id} - ${title} [${itemStatus}] (created ${created})${scheduled}`);
      }

      console.log('');
    }, 'List content by status');

    // workflow:process - Manually run scheduled publish check
    cli.register('workflow:process', async (args, ctx) => {
      console.log('Processing scheduled content...\n');

      const published = await content.processScheduled();

      if (published.length === 0) {
        console.log('No scheduled content ready for publishing.');
      } else {
        console.log(`Published ${published.length} item(s):`);
        for (const item of published) {
          console.log(`  ${item.type}/${item.id}`);
        }
      }
    }, 'Process scheduled content (auto-publish)');

    // workflow:status - Show workflow configuration
    cli.register('workflow:status', async (args, ctx) => {
      const config = content.getWorkflowConfig();

      console.log('\nWorkflow Configuration:');
      console.log('=======================');
      console.log(`  Enabled:        ${config.enabled ? 'Yes' : 'No'}`);
      console.log(`  Default Status: ${config.defaultStatus}`);
      console.log(`  Check Interval: ${config.scheduleCheckInterval}s`);
      console.log(`  Valid Statuses: ${config.statuses.join(', ')}`);
      console.log('');
    }, 'Show workflow configuration');

    // ==================================================
    // Search CLI Commands
    // ==================================================

    // search:query <query> [--type=article] [--limit=20] - Search content
    cli.register('search:query', async (args, ctx) => {
      if (args.length === 0) {
        console.error('Usage: search:query <query> [--type=article] [--limit=20]');
        console.error('Example: search:query "hello world"');
        console.error('Example: search:query title:welcome -draft');
        throw new Error('Query required');
      }

      // Parse arguments
      const queryParts = [];
      let types = null;
      let limit = 20;

      for (const arg of args) {
        if (arg.startsWith('--type=')) {
          types = [arg.slice(7)];
        } else if (arg.startsWith('--limit=')) {
          limit = parseInt(arg.slice(8)) || 20;
        } else {
          queryParts.push(arg);
        }
      }

      const query = queryParts.join(' ');
      const result = search.search(query, { types, limit, highlight: true });

      if (result.total === 0) {
        console.log(`\nNo results for "${query}"\n`);
        return;
      }

      console.log(`\nSearch results for "${query}" (${result.total} found, ${result.took}ms):\n`);

      for (const hit of result.results) {
        const title = hit.item?.title || hit.item?.name || hit.id;
        console.log(`  [${hit.score.toFixed(2)}] ${hit.type}/${hit.id} - ${title}`);

        if (hit.highlights) {
          for (const [field, snippet] of Object.entries(hit.highlights)) {
            console.log(`         "${snippet}"`);
          }
        }
      }

      console.log('');
    }, 'Search content');

    // search:rebuild [type] - Rebuild search index
    cli.register('search:rebuild', async (args, ctx) => {
      const type = args[0] || null;

      console.log('Rebuilding search index...');

      const result = search.buildIndex(type);

      console.log(`Indexed ${result.docs} items across ${result.types} types`);

      const stats = search.getStats();
      for (const [typeName, typeStats] of Object.entries(stats.typeStats)) {
        console.log(`  ${typeName}: ${typeStats.docs} items, ${typeStats.terms} terms`);
      }
    }, 'Rebuild search index');

    // search:stats - Show search index statistics
    cli.register('search:stats', async (args, ctx) => {
      const stats = search.getStats();

      console.log('\nSearch Index Statistics:');
      console.log('========================');
      console.log(`  Enabled:      ${stats.enabled ? 'Yes' : 'No'}`);
      console.log(`  Total Docs:   ${stats.totalDocs}`);
      console.log(`  Total Terms:  ${stats.totalTerms}`);
      console.log(`  Last Rebuild: ${stats.lastRebuild || 'never'}`);
      console.log(`  Fuzzy:        ${stats.config.fuzzy ? 'Yes' : 'No'}`);
      console.log(`  Min Word Len: ${stats.config.minWordLength}`);
      console.log('');

      if (Object.keys(stats.typeStats).length > 0) {
        console.log('  Per-Type Stats:');
        for (const [type, typeStats] of Object.entries(stats.typeStats)) {
          console.log(`    ${type}: ${typeStats.docs} docs, ${typeStats.terms} terms`);
        }
        console.log('');
      }
    }, 'Show search index statistics');

    // ==================================================
    // i18n CLI Commands
    // ==================================================

    // i18n:list - List available locales
    cli.register('i18n:list', async (args, ctx) => {
      const locales = i18n.getAvailableLocales();
      const defaultLocale = i18n.getDefaultLocale();

      console.log('\nAvailable Locales:');
      console.log('==================');

      for (const locale of locales) {
        const isDefault = locale.code === defaultLocale ? ' (default)' : '';
        const stats = i18n.getCompletionStats(locale.code);
        console.log(`  ${locale.code} - ${locale.name}${isDefault}`);
        console.log(`    Keys: ${stats.translated}/${stats.total} (${stats.percentage}% complete)`);
      }

      console.log('');
    }, 'List available locales');

    // i18n:export <locale> - Export translations
    cli.register('i18n:export', async (args, ctx) => {
      if (args.length === 0) {
        console.error('Usage: i18n:export <locale> [--output=file.json]');
        throw new Error('Locale required');
      }

      const locale = args[0];
      let outputFile = null;

      for (const arg of args.slice(1)) {
        if (arg.startsWith('--output=')) {
          outputFile = arg.slice(9);
        }
      }

      const data = i18n.exportTranslations(locale);

      if (outputFile) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(outputFile, JSON.stringify(data, null, 2) + '\n');
        console.log(`Exported ${locale} to ${outputFile}`);
        console.log(`  ${Object.keys(data.translations).length} keys`);
      } else {
        console.log(JSON.stringify(data, null, 2));
      }
    }, 'Export translations for a locale');

    // i18n:import <locale> <file> - Import translations
    cli.register('i18n:import', async (args, ctx) => {
      if (args.length < 2) {
        console.error('Usage: i18n:import <locale> <file> [--replace]');
        throw new Error('Locale and file required');
      }

      const locale = args[0];
      const filePath = args[1];
      const merge = !args.includes('--replace');

      const { readFileSync, existsSync } = await import('node:fs');

      if (!existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        throw new Error('File not found');
      }

      const json = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(json);

      const result = i18n.importTranslations(locale, data, merge);

      console.log(`Imported translations to ${locale}`);
      console.log(`  Added: ${result.added}`);
      console.log(`  Updated: ${result.updated}`);
    }, 'Import translations from JSON file');

    // i18n:missing [locale] - Show missing translations
    cli.register('i18n:missing', async (args, ctx) => {
      const locale = args[0] || null;
      const locales = locale ? [locale] : i18n.getAvailableLocales().map(l => l.code);
      const defaultLocale = i18n.getDefaultLocale();

      console.log('\nMissing Translations:');
      console.log('=====================');

      for (const code of locales) {
        if (code === defaultLocale) continue; // Skip default locale

        const missing = i18n.getMissingKeys(code);

        if (missing.length === 0) {
          console.log(`  ${code}: Complete!`);
        } else {
          console.log(`  ${code}: ${missing.length} missing`);
          for (const key of missing.slice(0, 10)) {
            console.log(`    - ${key}`);
          }
          if (missing.length > 10) {
            console.log(`    ... and ${missing.length - 10} more`);
          }
        }
      }

      console.log('');
    }, 'Show missing translations');

    // i18n:add <code> - Add new locale
    cli.register('i18n:add', async (args, ctx) => {
      if (args.length === 0) {
        console.error('Usage: i18n:add <locale-code>');
        console.error('Example: i18n:add de');
        throw new Error('Locale code required');
      }

      const code = args[0];

      try {
        const created = i18n.createLocale(code);
        if (created) {
          console.log(`Created locale: ${code}`);
          console.log('Add translations in /locales/' + code + '.json');
        } else {
          console.log(`Locale ${code} already exists`);
        }
      } catch (error) {
        console.error(`Error: ${error.message}`);
        throw error;
      }
    }, 'Add a new locale');

    // i18n:set <locale> <key> <value> - Set a translation
    cli.register('i18n:set', async (args, ctx) => {
      if (args.length < 3) {
        console.error('Usage: i18n:set <locale> <key> <value>');
        throw new Error('Locale, key, and value required');
      }

      const [locale, key, ...valueParts] = args;
      const value = valueParts.join(' ');

      i18n.setTranslation(locale, key, value);
      i18n.saveLocale(locale);

      console.log(`Set ${locale}.${key} = "${value}"`);
    }, 'Set a translation key');

    // ==================================================
    // Audit CLI Commands
    // ==================================================

    // audit:list - Query audit logs
    cli.register('audit:list', async (args, ctx) => {
      const filters = {};
      const options = { limit: 50 };

      // Parse arguments
      for (const arg of args) {
        if (arg.startsWith('--user=')) {
          filters.username = arg.slice(7);
        } else if (arg.startsWith('--action=')) {
          filters.action = arg.slice(9);
        } else if (arg.startsWith('--days=')) {
          filters.days = parseInt(arg.slice(7));
        } else if (arg.startsWith('--result=')) {
          filters.result = arg.slice(9);
        } else if (arg.startsWith('--limit=')) {
          options.limit = parseInt(arg.slice(8));
        } else if (arg.startsWith('--ip=')) {
          filters.ip = arg.slice(5);
        }
      }

      // Default to 7 days if not specified
      if (!filters.days && !filters.from && !filters.to) {
        filters.days = 7;
      }

      const result = audit.query(filters, options);

      console.log(`\nRecent audit events (last ${filters.days || 30} days):`);
      console.log('='.repeat(60));

      if (result.entries.length === 0) {
        console.log('  No events found matching filters');
      } else {
        for (const entry of result.entries) {
          const time = entry.timestamp.replace('T', ' ').slice(0, 19);
          const user = entry.username || 'anonymous';
          const ip = entry.ip ? ` from ${entry.ip}` : '';
          const resultStr = entry.result === 'success' ? '' : ` - ${entry.result}`;
          const errorStr = entry.error ? ` (${entry.error})` : '';

          // Format details for common actions
          let details = '';
          if (entry.action.startsWith('content.') && entry.details) {
            details = ` ${entry.details.type}/${entry.details.id}`;
          }

          console.log(`  ${time} [${entry.action}] ${user}${details}${ip}${resultStr}${errorStr}`);
        }
      }

      console.log(`\nTotal: ${result.total} events (showing ${result.entries.length})`);
      console.log('');
    }, 'Query audit logs');

    // audit:stats - Show audit statistics
    cli.register('audit:stats', async (args, ctx) => {
      let days = 30;

      for (const arg of args) {
        if (arg.startsWith('--days=')) {
          days = parseInt(arg.slice(7));
        }
      }

      const stats = audit.getStats({ days });

      console.log(`\nAudit statistics (last ${days} days):`);
      console.log('='.repeat(40));
      console.log(`  Total events: ${stats.total.toLocaleString()}`);

      console.log('\n  By action:');
      const actions = Object.entries(stats.byAction).slice(0, 10);
      for (const [action, count] of actions) {
        console.log(`    ${action}: ${count}`);
      }

      console.log('\n  By user:');
      const users = Object.entries(stats.byUser).slice(0, 10);
      for (const [user, count] of users) {
        console.log(`    ${user}: ${count}`);
      }

      console.log('\n  By result:');
      for (const [result, count] of Object.entries(stats.byResult)) {
        console.log(`    ${result}: ${count}`);
      }

      if (Object.keys(stats.topIPs).length > 0) {
        console.log('\n  Top IPs:');
        for (const [ip, count] of Object.entries(stats.topIPs).slice(0, 5)) {
          console.log(`    ${ip}: ${count}`);
        }
      }

      console.log('');
    }, 'Show audit statistics');

    // audit:export - Export audit logs
    cli.register('audit:export', async (args, ctx) => {
      const filters = {};
      let outputFile = null;
      let format = 'json';

      for (const arg of args) {
        if (arg.startsWith('--from=')) {
          filters.from = arg.slice(7);
        } else if (arg.startsWith('--to=')) {
          filters.to = arg.slice(5);
        } else if (arg.startsWith('--days=')) {
          filters.days = parseInt(arg.slice(7));
        } else if (arg.startsWith('--output=')) {
          outputFile = arg.slice(9);
        } else if (arg.startsWith('--format=')) {
          format = arg.slice(9);
        } else if (arg.startsWith('--action=')) {
          filters.action = arg.slice(9);
        } else if (arg.startsWith('--user=')) {
          filters.username = arg.slice(7);
        }
      }

      const data = audit.exportLogs(filters, format);

      if (outputFile) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(outputFile, data);
        const result = audit.query(filters, { limit: Number.MAX_SAFE_INTEGER });
        console.log(`Exported ${result.total} audit entries to ${outputFile}`);
      } else {
        console.log(data);
      }
    }, 'Export audit logs');

    // audit:prune - Delete old audit logs
    cli.register('audit:prune', async (args, ctx) => {
      let days = null;

      for (const arg of args) {
        if (arg.startsWith('--days=')) {
          days = parseInt(arg.slice(7));
        }
      }

      const result = audit.prune(days);

      if (result.deleted > 0) {
        console.log(`Pruned ${result.deleted} audit entries`);
        console.log(`Deleted files:`);
        for (const file of result.files) {
          console.log(`  - ${file}`);
        }
      } else {
        console.log('No audit entries to prune');
      }
    }, 'Delete old audit logs');

    // cache:stats - Show cache statistics
    cli.register('cache:stats', async (args, ctx) => {
      const stats = cache.stats();

      console.log('\nCache Statistics:');
      console.log('=================');
      console.log(`  Status:   ${context.config.site.cache?.enabled ? 'Enabled' : 'Disabled'}`);
      console.log(`  TTL:      ${context.config.site.cache?.ttl || 300}s`);
      console.log(`  Size:     ${stats.size} entries`);
      console.log(`  Hits:     ${stats.hits}`);
      console.log(`  Misses:   ${stats.misses}`);
      console.log(`  Hit Rate: ${stats.hitRate}`);
      console.log(`  Sets:     ${stats.sets}`);
      console.log(`  Deletes:  ${stats.deletes}`);
      console.log(`  Clears:   ${stats.clears}`);

      if (stats.keys.length > 0 && stats.keys.length <= 20) {
        console.log('\n  Cached keys:');
        for (const key of stats.keys) {
          const ttlRemaining = cache.ttl(key);
          console.log(`    - ${key} (TTL: ${ttlRemaining}s)`);
        }
      } else if (stats.keys.length > 20) {
        console.log(`\n  ${stats.keys.length} keys cached (too many to list)`);
      }

      console.log('');
    }, 'Show cache statistics');

    // cache:clear [pattern] - Clear cache
    cli.register('cache:clear', async (args, ctx) => {
      const pattern = args[0] || null;

      if (pattern) {
        const count = cache.clear(pattern);
        console.log(`Cleared ${count} cache entries matching "${pattern}"`);
      } else {
        const count = cache.clear();
        console.log(`Cleared all ${count} cache entries`);
      }
    }, 'Clear cache (all or matching pattern)');

    // csrf:status - Show CSRF protection status
    cli.register('csrf:status', async (args, ctx) => {
      const status = auth.getCSRFStatus();

      console.log('\nCSRF Protection Status:');
      console.log('=======================');
      console.log(`  Enabled:       ${status.enabled ? 'Yes' : 'No'}`);
      console.log(`  Token Expiry:  ${status.tokenExpiry}s`);
      console.log(`  Active Tokens: ${status.activeTokenCount}`);
      console.log('');
    }, 'Show CSRF protection status');

    // csrf:clear - Clear all CSRF tokens
    cli.register('csrf:clear', async (args, ctx) => {
      const count = auth.clearCSRFTokens();
      console.log(`Cleared ${count} CSRF token(s)`);
      console.log('All users will need to refresh forms to get new tokens.');
    }, 'Clear all CSRF tokens (force re-auth)');

    // ==================================================
    // Rate Limiting CLI Commands
    // ==================================================

    // ratelimit:status - Show rate limiting status
    cli.register('ratelimit:status', async (args, ctx) => {
      const config = ratelimit.getConfig();
      const blocked = ratelimit.getBlocked();
      const stats = ratelimit.getStats();

      console.log('\nRate Limiting Status:');
      console.log('=====================');
      console.log(`  Enabled: ${config.enabled ? 'Yes' : 'No'}`);
      console.log('');
      console.log('  Limits:');
      console.log(`    login: ${config.login.points} requests / ${config.login.duration}s (block: ${config.login.blockDuration}s)`);
      console.log(`    api:   ${config.api.points} requests / ${config.api.duration}s`);
      console.log(`    admin: ${config.admin.points} requests / ${config.admin.duration}s`);
      console.log('');
      console.log(`  Tracked entries: ${stats.totalEntries}`);
      console.log(`  Total timestamps: ${stats.totalTimestamps}`);
      console.log(`  Memory estimate: ~${Math.round(stats.memoryEstimate / 1024)}KB`);
      console.log('');

      if (blocked.length === 0) {
        console.log('  Currently blocked: 0 IPs');
      } else {
        console.log(`  Currently blocked: ${blocked.length} IP(s)`);
        for (const entry of blocked) {
          // Extract IP from key (e.g., "login:192.168.1.1" -> "192.168.1.1")
          const ip = entry.key.split(':').slice(1).join(':');
          console.log(`    ${ip} - blocked until ${entry.blockedUntilFormatted} (${entry.reason})`);
        }
      }
      console.log('');
    }, 'Show rate limiting status and blocked IPs');

    // ratelimit:clear [ip] - Clear rate limit blocks
    cli.register('ratelimit:clear', async (args, ctx) => {
      const ip = args[0] || null;

      if (ip) {
        const count = ratelimit.clearKey(ip);
        if (count > 0) {
          console.log(`Cleared rate limit data for ${ip}`);
        } else {
          console.log(`No rate limit data found for ${ip}`);
        }
      } else {
        const count = ratelimit.clearKey(null);
        console.log(`Cleared all rate limit data (${count} entries)`);
      }
    }, 'Clear rate limit blocks (all or specific IP)');

    // ratelimit:block <ip> [duration] - Manually block an IP
    cli.register('ratelimit:block', async (args, ctx) => {
      if (args.length === 0) {
        console.error('Usage: ratelimit:block <ip> [duration_seconds]');
        console.error('Example: ratelimit:block 192.168.1.50 3600');
        throw new Error('IP address required');
      }

      const ip = args[0];
      const duration = parseInt(args[1]) || 3600; // Default 1 hour

      const result = ratelimit.blockKey(ip, duration, 'manual');
      console.log(`Blocked ${ip} until ${result.blockedUntilFormatted} (${duration}s)`);
    }, 'Manually block an IP address');

    // tasks:list - Show all scheduled tasks
    cli.register('tasks:list', async (args, ctx) => {
      const tasks = scheduler.list();

      if (tasks.length === 0) {
        console.log('\nNo scheduled tasks registered.');
        console.log('Modules can register tasks via hook_schedule.\n');
        return;
      }

      console.log('\nScheduled tasks:');

      for (const task of tasks) {
        console.log(`  ${task.name}`);
        console.log(`    Schedule: ${task.cronExpr} (${scheduler.describeCron(task.cronExpr)})`);
        console.log(`    Last run: ${task.lastRun ? scheduler.formatDate(task.lastRun) : 'never'}`);
        console.log(`    Next run: ${scheduler.formatDate(task.nextRun)}`);
        console.log(`    Status: ${task.lastStatus}${task.lastError ? ` (${task.lastError})` : ''}`);
        console.log('');
      }
    }, 'Show all scheduled tasks');

    // tasks:run <name> - Manually run a task
    cli.register('tasks:run', async (args, ctx) => {
      if (args.length === 0) {
        console.error('Usage: tasks:run <name>');
        console.error('Example: tasks:run tasks:cleanup');
        throw new Error('Task name required');
      }

      const name = args[0];

      try {
        const result = await scheduler.run(name);

        if (result.status === 'success') {
          if (result.result) {
            console.log(`Result: ${typeof result.result === 'string' ? result.result : JSON.stringify(result.result)}`);
          }
        } else {
          console.error(`Failed: ${result.error}`);
        }
      } catch (error) {
        console.error(`Error: ${error.message}`);
        throw error;
      }
    }, 'Manually run a scheduled task');

    // tasks:history [name] - Show recent task runs
    cli.register('tasks:history', async (args, ctx) => {
      const name = args[0] || null;
      const limit = 20;

      const history = scheduler.history(name, limit);

      if (history.length === 0) {
        if (name) {
          console.log(`\nNo history found for task: ${name}\n`);
        } else {
          console.log('\nNo task history found.\n');
        }
        return;
      }

      const title = name ? `Task history for "${name}":` : 'Recent task runs:';
      console.log(`\n${title}\n`);

      for (const entry of history) {
        const started = new Date(entry.startedAt);
        const dateStr = started.toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });

        const status = entry.status === 'success' ? '+' : 'x';
        const duration = entry.duration ? `${entry.duration}ms` : '-';

        console.log(`  ${status} [${dateStr}] ${entry.name} (${duration})`);

        if (entry.status === 'error' && entry.result) {
          console.log(`    Error: ${entry.result}`);
        }
      }

      console.log('');
    }, 'Show recent task runs');

    // ==================================================
    // Import/Export CLI Commands
    // ==================================================

    // export:content [types...] - Export content to JSON
    cli.register('export:content', async (args, ctx) => {
      // Parse arguments: types and options
      const types = [];
      let outputFile = null;
      let includeMedia = false;

      for (const arg of args) {
        if (arg.startsWith('--output=')) {
          outputFile = arg.slice(9);
        } else if (arg === '--include-media') {
          includeMedia = true;
        } else if (!arg.startsWith('--')) {
          types.push(arg);
        }
      }

      // Export content
      const data = transfer.exportContent(
        types.length > 0 ? types : null,
        { includeMedia }
      );

      // Calculate totals for summary
      let totalItems = 0;
      const typeCounts = [];
      for (const [type, items] of Object.entries(data.content)) {
        totalItems += items.length;
        typeCounts.push(`${items.length} ${type}(s)`);
      }

      // Output to file or stdout
      if (outputFile) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(outputFile, JSON.stringify(data, null, 2) + '\n');
        console.log(`Exported ${totalItems} item(s) to ${outputFile}`);
        console.log(`  ${typeCounts.join(', ')}`);
      } else {
        // Write to stdout for piping
        console.log(JSON.stringify(data, null, 2));
        // Summary to stderr so it doesn't interfere with piping
        console.error(`\nExported ${totalItems} item(s)`);
        console.error(`  ${typeCounts.join(', ')}`);
      }
    }, 'Export content to JSON (stdout or --output=file)');

    // export:site --output=backup.json - Full site export
    cli.register('export:site', async (args, ctx) => {
      let outputFile = null;

      for (const arg of args) {
        if (arg.startsWith('--output=')) {
          outputFile = arg.slice(9);
        }
      }

      const data = transfer.exportSite({ includeMedia: true });

      // Calculate totals
      let totalItems = 0;
      for (const items of Object.values(data.content)) {
        totalItems += items.length;
      }

      if (outputFile) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(outputFile, JSON.stringify(data, null, 2) + '\n');
        console.log(`Full site exported to ${outputFile}`);
        console.log(`  ${totalItems} content item(s)`);
        console.log(`  ${Object.keys(data.content).length} content type(s)`);
        if (data.media) {
          console.log(`  ${data.media.length} media file(s) in manifest`);
        }
      } else {
        console.log(JSON.stringify(data, null, 2));
        console.error(`\nFull site exported`);
        console.error(`  ${totalItems} content item(s)`);
      }
    }, 'Export full site (content + config + media manifest)');

    // import:content <file> [--dry-run] [--overwrite] - Import content
    cli.register('import:content', async (args, ctx) => {
      if (args.length === 0) {
        console.error('Usage: import:content <file> [--dry-run] [--overwrite]');
        console.error('Example: import:content backup.json --dry-run');
        throw new Error('File path required');
      }

      // Parse arguments
      const filePath = args[0];
      let dryRun = false;
      let overwrite = false;

      for (const arg of args.slice(1)) {
        if (arg === '--dry-run') dryRun = true;
        if (arg === '--overwrite') overwrite = true;
      }

      // Read and parse file
      const { readFileSync, existsSync } = await import('node:fs');

      if (!existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        throw new Error('File not found');
      }

      let data;
      try {
        const json = readFileSync(filePath, 'utf-8');
        data = transfer.parseImportData(json);
      } catch (error) {
        console.error(`Failed to parse file: ${error.message}`);
        throw error;
      }

      // Check compatibility
      const compat = transfer.checkCompatibility(data);
      if (compat.warnings.length > 0) {
        console.log('Warnings:');
        for (const warn of compat.warnings) {
          console.log(`  ⚠ ${warn}`);
        }
      }

      if (!compat.compatible) {
        console.error('Compatibility errors:');
        for (const err of compat.errors) {
          console.error(`  ✗ ${err}`);
        }
        throw new Error('Import not compatible with current system');
      }

      // Perform import
      const result = await transfer.importContent(data, { dryRun, overwrite });

      if (dryRun) {
        console.log('Dry run - no changes made');
        console.log('Would import:');
      } else {
        console.log('Import complete:');
      }

      for (const [type, stats] of Object.entries(result.details)) {
        const parts = [];
        if (stats.created > 0) parts.push(`${stats.created} new`);
        if (stats.updated > 0) parts.push(`${stats.updated} updated`);
        if (stats.skipped > 0) parts.push(`${stats.skipped} skipped`);
        if (stats.errors > 0) parts.push(`${stats.errors} errors`);
        console.log(`  - ${stats.total} ${type}(s) (${parts.join(', ')})`);
      }

      console.log(`\nTotal: ${result.stats.total} items`);
      console.log(`  Created: ${result.stats.created}`);
      console.log(`  Updated: ${result.stats.updated}`);
      console.log(`  Skipped: ${result.stats.skipped}`);

      if (result.errors.length > 0) {
        console.log(`\nErrors (${result.errors.length}):`);
        for (const err of result.errors.slice(0, 5)) {
          console.log(`  ✗ ${err.type}/${err.id}: ${err.error}`);
        }
        if (result.errors.length > 5) {
          console.log(`  ... and ${result.errors.length - 5} more`);
        }
      }
    }, 'Import content from JSON file');

    // ==================================================
    // Plugin CLI Commands
    // ==================================================

    // plugins:list - List all plugins
    cli.register('plugins:list', async (args, ctx) => {
      const discovered = plugins.discover();
      const loaded = plugins.listPlugins();
      const enabled = plugins.getEnabledPlugins();

      if (discovered.length === 0) {
        console.log('\nNo plugins found in ./plugins/');
        console.log('Create one with: plugins:create <name>\n');
        return;
      }

      console.log('\nPlugins:');

      for (const info of discovered) {
        const plugin = loaded.find(p => p.name === info.name);
        const isEnabled = enabled.includes(info.name);
        const status = plugin?.status || (info.valid ? 'not loaded' : 'invalid');

        let statusIcon = ' ';
        if (status === 'active') statusIcon = '✓';
        else if (status === 'loaded') statusIcon = '○';
        else if (status === 'error' || status === 'invalid') statusIcon = '✗';

        const version = info.manifest?.version || '?';
        const desc = info.manifest?.description || '(no description)';
        const enabledStr = isEnabled ? 'enabled' : 'disabled';

        console.log(`  ${statusIcon} ${info.name} (${version}) - ${enabledStr} - ${desc}`);

        if (!info.valid) {
          for (const err of info.errors) {
            console.log(`      Error: ${err}`);
          }
        } else if (plugin?.error) {
          console.log(`      Error: ${plugin.error}`);
        }
      }

      console.log('\nStatus: ✓ active, ○ loaded, ✗ error, (space) not loaded');
      console.log('');
    }, 'List all installed plugins');

    // plugins:enable <name> - Enable a plugin
    cli.register('plugins:enable', async (args, ctx) => {
      if (args.length === 0) {
        console.error('Usage: plugins:enable <name>');
        throw new Error('Plugin name required');
      }

      const name = args[0];
      const discovered = plugins.discover();
      const pluginInfo = discovered.find(p => p.name === name);

      if (!pluginInfo) {
        console.error(`Plugin not found: ${name}`);
        console.error('Use "plugins:list" to see available plugins.');
        throw new Error('Plugin not found');
      }

      if (!pluginInfo.valid) {
        console.error(`Plugin '${name}' has validation errors:`);
        for (const err of pluginInfo.errors) {
          console.error(`  - ${err}`);
        }
        throw new Error('Invalid plugin');
      }

      // Check if already enabled
      const enabled = plugins.getEnabledPlugins();
      if (enabled.includes(name)) {
        console.log(`Plugin '${name}' is already enabled.`);
        return;
      }

      // Update site.json
      const { readFileSync, writeFileSync } = await import('node:fs');
      const configPath = join(baseDir, 'config', 'site.json');
      const siteConfig = JSON.parse(readFileSync(configPath, 'utf-8'));

      if (!siteConfig.plugins) {
        siteConfig.plugins = { enabled: [], directory: './plugins' };
      }
      if (!siteConfig.plugins.enabled) {
        siteConfig.plugins.enabled = [];
      }

      siteConfig.plugins.enabled.push(name);
      writeFileSync(configPath, JSON.stringify(siteConfig, null, 2) + '\n');

      console.log(`Enabled plugin: ${name}`);
      console.log('Restart required to activate.');
    }, 'Enable a plugin (requires restart)');

    // plugins:disable <name> - Disable a plugin
    cli.register('plugins:disable', async (args, ctx) => {
      if (args.length === 0) {
        console.error('Usage: plugins:disable <name>');
        throw new Error('Plugin name required');
      }

      const name = args[0];
      const enabled = plugins.getEnabledPlugins();

      if (!enabled.includes(name)) {
        console.log(`Plugin '${name}' is not enabled.`);
        return;
      }

      // Update site.json
      const { readFileSync, writeFileSync } = await import('node:fs');
      const configPath = join(baseDir, 'config', 'site.json');
      const siteConfig = JSON.parse(readFileSync(configPath, 'utf-8'));

      siteConfig.plugins.enabled = siteConfig.plugins.enabled.filter(p => p !== name);
      writeFileSync(configPath, JSON.stringify(siteConfig, null, 2) + '\n');

      console.log(`Disabled plugin: ${name}`);
      console.log('Restart required to deactivate.');
    }, 'Disable a plugin (requires restart)');

    // plugins:create <name> - Create a new plugin scaffold
    cli.register('plugins:create', async (args, ctx) => {
      if (args.length === 0) {
        console.error('Usage: plugins:create <name>');
        console.error('Example: plugins:create my-plugin');
        throw new Error('Plugin name required');
      }

      const name = args[0];

      try {
        const result = plugins.createPluginScaffold(name);
        console.log(`Created plugin scaffold at ${result.path}/`);
        for (const file of result.files) {
          console.log(`  ${file}`);
        }
        console.log('\nTo enable: plugins:enable ' + name);
      } catch (error) {
        console.error(`Failed to create plugin: ${error.message}`);
        throw error;
      }
    }, 'Create a new plugin scaffold');

    // plugins:validate <name> - Validate a plugin
    cli.register('plugins:validate', async (args, ctx) => {
      if (args.length === 0) {
        console.error('Usage: plugins:validate <name>');
        throw new Error('Plugin name required');
      }

      const name = args[0];
      const discovered = plugins.discover();
      const pluginInfo = discovered.find(p => p.name === name);

      if (!pluginInfo) {
        console.error(`Plugin not found: ${name}`);
        throw new Error('Plugin not found');
      }

      if (!pluginInfo.valid) {
        console.log(`\nPlugin '${name}' is INVALID:\n`);
        for (const err of pluginInfo.errors) {
          console.log(`  ✗ ${err}`);
        }
        console.log('');
        throw new Error('Plugin validation failed');
      }

      const manifest = pluginInfo.manifest;
      console.log(`\nPlugin '${name}' is valid\n`);
      console.log(`  Version: ${manifest.version}`);
      console.log(`  Description: ${manifest.description}`);
      if (manifest.author) {
        console.log(`  Author: ${manifest.author}`);
      }
      console.log(`  Permissions: ${manifest.permissions?.length > 0 ? manifest.permissions.join(', ') : 'none'}`);
      console.log(`  Dependencies: ${manifest.dependencies?.length > 0 ? manifest.dependencies.join(', ') : 'none'}`);
      if (manifest.minCoreVersion) {
        console.log(`  Min Core Version: ${manifest.minCoreVersion}`);
      }
      console.log('');
    }, 'Validate a plugin manifest and permissions');

    // ==================================================
    // Hot-Swap Plugin Commands
    // ==================================================

    // plugins:activate <name> - Hot-load a plugin without restart
    cli.register('plugins:activate', async (args, ctx) => {
      if (args.length === 0) {
        console.error('Usage: plugins:activate <name>');
        throw new Error('Plugin name required');
      }

      const name = args[0];
      const plugin = plugins.getPlugin(name);

      if (!plugin) {
        // Plugin not loaded yet, try to load it
        const discovered = plugins.discover();
        const pluginInfo = discovered.find(p => p.name === name);

        if (!pluginInfo) {
          console.error(`Plugin not found: ${name}`);
          throw new Error('Plugin not found');
        }

        if (!pluginInfo.valid) {
          console.error(`Plugin '${name}' has validation errors`);
          throw new Error('Invalid plugin');
        }

        // Load the plugin first
        await plugins.loadPlugin(pluginInfo.path, ctx);
      }

      // Activate the plugin (hot-swap mode)
      await plugins.activatePlugin(name, true);
      console.log(`Plugin '${name}' activated (hot-loaded)`);
    }, 'Hot-load and activate a plugin without restart');

    // plugins:deactivate <name> - Hot-unload a plugin without restart
    cli.register('plugins:deactivate', async (args, ctx) => {
      if (args.length === 0) {
        console.error('Usage: plugins:deactivate <name>');
        throw new Error('Plugin name required');
      }

      const name = args[0];
      const plugin = plugins.getPlugin(name);

      if (!plugin) {
        console.error(`Plugin '${name}' is not loaded`);
        throw new Error('Plugin not loaded');
      }

      if (plugin.status !== 'active') {
        console.log(`Plugin '${name}' is not active (status: ${plugin.status})`);
        return;
      }

      await plugins.deactivatePlugin(name);
      console.log(`Plugin '${name}' deactivated (hot-unloaded)`);
    }, 'Hot-unload a plugin without restart');

    // plugins:reload <name> - Reload a plugin (deactivate + reactivate)
    cli.register('plugins:reload', async (args, ctx) => {
      if (args.length === 0) {
        console.error('Usage: plugins:reload <name>');
        throw new Error('Plugin name required');
      }

      const name = args[0];
      const plugin = plugins.getPlugin(name);

      if (!plugin) {
        console.error(`Plugin '${name}' is not loaded`);
        throw new Error('Plugin not loaded');
      }

      await plugins.reloadPlugin(name);
      console.log(`Plugin '${name}' reloaded`);
    }, 'Reload a plugin (hot-swap: deactivate + reactivate)');

    // plugins:changes - Show recent plugin file changes
    cli.register('plugins:changes', async (args, ctx) => {
      const limit = parseInt(args[0]) || 10;
      const changes = watcher.getRecentPluginChanges(limit);

      if (changes.length === 0) {
        console.log('\nNo recent plugin changes detected.');
        console.log('The watcher tracks changes to plugins/ directory.\n');
        return;
      }

      console.log('\nRecent plugin changes:\n');

      for (const change of changes) {
        const icon = change.type === 'CREATED' ? '+' :
                     change.type === 'DELETED' ? '-' :
                     change.type === 'MODIFIED' ? '~' : ' ';
        console.log(`  ${icon} [${change.timestamp.split('T')[1].slice(0, 8)}] ${change.path}`);
        if (change.message) {
          console.log(`      ${change.message}`);
        }
      }

      console.log('');
    }, 'Show recent plugin file changes');

    // plugins:watch - Show real-time plugin file changes (continuous)
    cli.register('plugins:watch', async (args, ctx) => {
      console.log('\nWatching plugins for changes...');
      console.log('Press Ctrl+C to stop.\n');

      const mode = plugins.getAutoReloadMode();
      console.log(`Auto-reload mode: ${mode}`);
      console.log('');

      // Keep the process running and show changes as they happen
      // The watcher is already running, we just need to subscribe
      const unsubscribe = watcher.onPluginChange((change) => {
        const { pluginName, changeType, path, timestamp } = change;
        const time = timestamp.split('T')[1].slice(0, 8);
        console.log(`[${time}] ${path} changed`);

        if (mode === true) {
          // handlePluginChange is called by boot's subscriber
          // We just show what happened
        } else if (mode === 'prompt') {
          console.log(`         Run 'plugins:reload ${pluginName}' to apply`);
        }
      });

      // Keep process alive until interrupted
      await new Promise((resolve) => {
        process.on('SIGINT', () => {
          unsubscribe();
          console.log('\n\nStopped watching.');
          resolve();
        });
      });
    }, 'Show real-time plugin file changes (continuous)');

    // plugins:autoload [on|off|prompt] - Toggle auto-reload mode
    cli.register('plugins:autoload', async (args, ctx) => {
      if (args.length === 0) {
        // Show current status
        const mode = plugins.getAutoReloadMode();
        const changed = plugins.getChangedPlugins();

        console.log(`\nPlugin Auto-Reload Status`);
        console.log('='.repeat(40));
        console.log(`Mode: ${mode}`);
        console.log(`Watch debounce: ${plugins.getWatchDebounce()}ms`);

        if (changed.length > 0) {
          console.log(`\nPlugins with pending changes:`);
          for (const c of changed) {
            console.log(`  - ${c.name} (${c.changeType}, ${c.files.length} file(s))`);
          }
        } else {
          console.log(`\nNo plugins with pending changes.`);
        }

        console.log('');
        return;
      }

      const setting = args[0].toLowerCase();

      if (setting === 'on' || setting === 'true') {
        plugins.enableAutoReload(true);
        console.log('Auto-reload mode: ON');
        console.log('Plugins will automatically reload when files change.');
      } else if (setting === 'off' || setting === 'false') {
        plugins.disableAutoReload();
        console.log('Auto-reload mode: OFF');
        console.log('Plugin file changes will be ignored.');
      } else if (setting === 'prompt') {
        plugins.enableAutoReload('prompt');
        console.log('Auto-reload mode: PROMPT');
        console.log('Plugin file changes will be logged but not auto-reloaded.');
      } else {
        console.error('Usage: plugins:autoload [on|off|prompt]');
        console.error('  on     - Automatically reload plugins on file change');
        console.error('  off    - Ignore plugin file changes');
        console.error('  prompt - Log changes but require manual reload');
        throw new Error('Invalid setting');
      }
    }, 'Toggle plugin auto-reload mode (on|off|prompt)');

    // plugins:reload-changed - Reload all plugins with pending changes
    cli.register('plugins:reload-changed', async (args, ctx) => {
      const changed = plugins.getChangedPlugins();

      if (changed.length === 0) {
        console.log('\nNo plugins with pending changes.\n');
        return;
      }

      console.log(`\nReloading ${changed.length} changed plugin(s)...`);

      const result = await plugins.reloadChangedPlugins();

      if (result.reloaded.length > 0) {
        console.log(`\nReloaded:`);
        for (const name of result.reloaded) {
          console.log(`  ✓ ${name}`);
        }
      }

      if (result.failed.length > 0) {
        console.log(`\nFailed:`);
        for (const { name, error } of result.failed) {
          console.log(`  ✗ ${name}: ${error}`);
        }
      }

      console.log('');
    }, 'Reload all plugins with pending changes');

    // import:site <file> [--dry-run] - Import full site
    cli.register('import:site', async (args, ctx) => {
      if (args.length === 0) {
        console.error('Usage: import:site <file> [--dry-run] [--import-config]');
        console.error('Example: import:site backup.json --dry-run');
        throw new Error('File path required');
      }

      // Parse arguments
      const filePath = args[0];
      let dryRun = false;
      let importConfig = false;

      for (const arg of args.slice(1)) {
        if (arg === '--dry-run') dryRun = true;
        if (arg === '--import-config') importConfig = true;
      }

      // Read and parse file
      const { readFileSync, existsSync } = await import('node:fs');

      if (!existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        throw new Error('File not found');
      }

      let data;
      try {
        const json = readFileSync(filePath, 'utf-8');
        data = transfer.parseImportData(json);
      } catch (error) {
        console.error(`Failed to parse file: ${error.message}`);
        throw error;
      }

      // Perform import
      const result = await transfer.importSite(data, { dryRun, importConfig });

      if (dryRun) {
        console.log('Dry run - no changes made\n');
      }

      // Content results
      console.log('Content import:');
      console.log(`  Total: ${result.content.stats.total}`);
      console.log(`  Created: ${result.content.stats.created}`);
      console.log(`  Updated: ${result.content.stats.updated}`);
      console.log(`  Skipped: ${result.content.stats.skipped}`);

      // Config results
      console.log('\nConfig import:');
      if (result.config.site.imported) {
        console.log('  ✓ site.json imported');
      } else if (result.config.site.wouldImport) {
        console.log('  ○ site.json would be imported');
      } else if (result.config.site.skipped) {
        console.log('  - site.json skipped (use --import-config)');
      }

      if (result.config.modules.imported) {
        console.log('  ✓ modules.json imported (restart required)');
      } else if (result.config.modules.wouldImport) {
        console.log('  ○ modules.json would be imported');
      } else if (result.config.modules.skipped) {
        console.log('  - modules.json skipped (use --import-config)');
      }

      if (!result.success) {
        console.log('\n⚠ Import completed with errors');
      }
    }, 'Import full site from JSON file');

    log(`[boot] ✓ ${PHASES.REGISTER} complete`);

    // Trigger hook for modules that need to run after registration
    await hooks.trigger('boot:register', context);

    // ========================================
    // PHASE: BOOT
    // Initialize all registered modules
    // ========================================
    currentPhase = PHASES.BOOT;
    log(`\n[boot] === PHASE: ${PHASES.BOOT} ===`);

    // Fire 'boot' hook - modules do their initialization here
    // WHY INVOKE (not trigger):
    // Semantic clarity: we're invoking module boot handlers,
    // not triggering an event. (They're the same function.)
    await hooks.invoke('boot', context);

    log(`[boot] ✓ ${PHASES.BOOT} complete`);

    // ========================================
    // PHASE: READY
    // System is ready to handle requests
    // ========================================
    currentPhase = PHASES.READY;
    log(`\n[boot] === PHASE: ${PHASES.READY} ===`);

    // Fire 'ready' hook - all modules initialized, system accepting requests
    // WHY BEFORE "CMS is ready" LOG:
    // Module ready hooks run first, then core confirms readiness.
    // This order makes log output more logical.
    await hooks.invoke('ready', context);

    // Wire ECA hook→event bridges
    // WHY IN READY PHASE: All modules must be initialized so hooks exist.
    // This connects content/user/system hooks to the ECA rule engine,
    // so rules configured in /admin/eca fire automatically.
    actions.wireHooks(hooks, content);
    log('[boot] ECA hook→event bridges wired');

    // Auto-create privacy policy page if configured and missing
    // WHY IN READY PHASE: Content service must be fully initialized.
    // Drupal parity: equivalent to drupal_cms_privacy_basic recipe.
    if (context.config.site.privacy?.autoCreate !== false) {
      try {
        const pages = content.list('page').items || [];
        const hasPrivacy = pages.some(p => p.slug === 'privacy-policy');
        if (!hasPrivacy) {
          await content.create('page', {
            title: 'Privacy Policy',
            slug: 'privacy-policy',
            body: '<h2>Privacy Policy</h2>' +
              '<p>This privacy policy describes how we collect, use, and protect your personal information.</p>' +
              '<h3>Information We Collect</h3>' +
              '<p>We may collect information you provide directly, such as your name and email address when you create an account or submit a form.</p>' +
              '<h3>How We Use Information</h3>' +
              '<p>We use collected information to provide and improve our services, respond to inquiries, and communicate with you.</p>' +
              '<h3>Data Protection</h3>' +
              '<p>We implement appropriate security measures to protect your personal information against unauthorized access or disclosure.</p>' +
              '<h3>Your Rights</h3>' +
              '<p>You have the right to access, correct, or delete your personal information. Contact us to exercise these rights.</p>' +
              '<h3>Contact</h3>' +
              '<p>For privacy-related inquiries, please contact the site administrator.</p>',
            status: 'published'
          });
          log('[boot] Auto-created privacy policy page at /privacy-policy');
        }
      } catch (err) {
        log(`[boot] Could not auto-create privacy policy: ${err.message}`);
      }
    }

    // Start file watcher for development (skip in quiet/CLI mode)
    // WHY SKIP IN QUIET MODE:
    // CLI commands run and exit immediately.
    // No point starting watcher that would be stopped right away.
    if (!quiet) {
      // WHY IN READY PHASE:
      // All modules are loaded, config is set, system is stable.
      // Watcher needs the full context to make smart decisions.
      watcher.start(baseDir, context.config.site);
      const devMode = context.config.site.env === 'development';
      log(`[boot] File watcher started (dev mode: ${devMode ? 'hot config reload enabled' : 'hot reload disabled'})`);

      // Subscribe to plugin changes
      // WHY SUBSCRIBE:
      // Enable auto-reload or prompt-for-reload workflow when plugin files change.
      // In development, this helps with rapid iteration.
      watcher.onPluginChange(async (change) => {
        // Delegate to plugins module for auto-reload handling
        await plugins.handlePluginChange(change);
      });

      const autoReloadMode = plugins.getAutoReloadMode();
      log(`[boot] Plugin filesystem watcher enabled (auto-reload: ${autoReloadMode})`);

      // Start HTTP server (server mode only)
      // WHY CHECK !quiet:
      // CLI mode shouldn't start a server - it runs a command and exits.
      const port = context.config.site.port || 3000;
      await server.start(port, context);
      log(`[boot] HTTP server listening on http://localhost:${port}`);

      // Start scheduler (server mode only)
      // WHY SERVER MODE ONLY:
      // CLI commands run and exit immediately.
      // Scheduled tasks need the server running to be useful.
      const taskCount = scheduler.list().length;
      if (taskCount > 0) {
        scheduler.start(context);
        log(`[boot] Scheduler started with ${taskCount} task(s)`);
      }

      // Start queue processing (server mode only)
      // WHY SERVER MODE ONLY:
      // CLI commands process queue manually via queue:run command.
      // Auto-processing only makes sense for long-running server.
      const queueEnabled = context.config.site.queue?.enabled !== false;
      if (queueEnabled) {
        queue.registerBuiltinHandlers(context);
        queue.startProcessing(10); // Process every 10 seconds
        log(`[boot] Queue processing started`);
      }
    }

    log(`[boot] CMS is ready!`);
    log(`[boot] ✓ ${PHASES.READY} complete`);

    return context;

  } catch (error) {
    // WHY CATCH AT TOP LEVEL:
    // Add phase context to error message for easier debugging.
    // Re-throw so caller can handle (exit process, show error page, etc.)
    console.error(`\n[boot] ✗ FAILED during ${currentPhase} phase`);
    console.error(`[boot] Error: ${error.message}`);

    // Trigger error hook - modules might want to clean up
    await hooks.trigger('boot:error', { phase: currentPhase, error, context });

    throw error;
  }
}
