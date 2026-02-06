/**
 * hello/index.js - Test Module for Discovery Validation
 *
 * WHY THIS MODULE EXISTS:
 * This is a minimal "smoke test" module that proves:
 * 1. Discovery correctly finds modules in /modules
 * 2. Manifest.json is parsed and validated
 * 3. Hook exports follow the established pattern
 * 4. The module system works end-to-end
 *
 * HOOK PATTERN EXPLAINED:
 * ========================
 *
 * Modules communicate with core through "hooks" - named extension points
 * where modules can inject behavior. The pattern is:
 *
 *   1. Core defines hook names (e.g., "boot:ready", "content:beforeSave")
 *   2. Modules export functions named `hook_<hookName>` (with : replaced by _)
 *   3. During boot, core loads modules and registers these exports as handlers
 *   4. When core triggers a hook, all registered handlers run in priority order
 *
 * WHY EXPORT FUNCTIONS (not register manually):
 * - Declarative: Just export, no imperative registration code
 * - Discoverable: Core can inspect exports to know what hooks module uses
 * - Testable: Import and call hook functions directly in tests
 * - Self-documenting: manifest.json lists hooks, exports implement them
 *
 * NAMING CONVENTION:
 * - Hook name: "boot:ready" (colon-separated namespace)
 * - Export name: "hook_boot_ready" (underscores, prefixed with hook_)
 *
 * WHY THE hook_ PREFIX:
 * - Distinguishes hook handlers from other exports (utils, constants)
 * - Allows modules to export both `hook_boot` and `boot` (different purposes)
 * - Easy to grep/find all hooks in a module: `grep "hook_" index.js`
 *
 * HANDLER SIGNATURE:
 * All hook handlers receive a context object and can be async:
 *
 *   export async function hook_name(context) {
 *     // context contains phase-specific data
 *     // modify context to affect downstream behavior
 *     // throw to abort (in strict mode)
 *   }
 *
 * CONTEXT OBJECT:
 * The context passed to hooks varies by phase but typically includes:
 * - baseDir: Project root path
 * - config: Loaded configuration
 * - services: Service container
 * - hooks: Hook registry
 * - Plus phase-specific data
 *
 * Handlers can READ context for information and MUTATE it to affect
 * later handlers or core behavior. This is intentional - it enables
 * "filter" style hooks where data passes through a chain of handlers.
 */

/**
 * Boot phase hook handler
 *
 * WHEN THIS RUNS:
 * During the BOOT phase, after all modules are registered but before
 * the system is marked as ready. This is where modules should:
 * - Initialize their internal state
 * - Set up connections (database, cache, external APIs)
 * - Register their own services
 *
 * WHY boot (not init):
 * - init: Core loads config (modules not involved yet)
 * - discover: Core finds modules (modules not loaded yet)
 * - register: Modules register services/hooks (setup, not run)
 * - boot: Modules initialize (THIS ONE - actually start things)
 * - ready: Everything started, accepting requests
 *
 * @param {Object} context - Boot context with config, services, etc.
 */
export async function hook_boot(context) {
  // WHY ASYNC (even though we just log):
  // Consistency with other hooks that may need async.
  // Real modules might await database connections here.

  console.log('[hello] Boot hook fired');

  // Example: A real module might do:
  // const db = await connectToDatabase(context.config.database);
  // context.services.register('db', () => db);
}

/**
 * Ready phase hook handler
 *
 * WHEN THIS RUNS:
 * After all modules have booted, right before the system accepts requests.
 * This is the final hook in the boot sequence. Use it to:
 * - Log startup complete messages
 * - Start background jobs
 * - Open HTTP server (though core usually does this)
 * - Send "I'm alive" notifications
 *
 * WHY A SEPARATE ready HOOK:
 * A module might need other modules to be fully booted before it can
 * start. The ready hook guarantees everything is initialized.
 *
 * Example: A "metrics" module might start collecting stats only after
 * the database module has connected in its boot hook.
 *
 * @param {Object} context - Full boot context, all modules initialized
 */
export async function hook_ready(context) {
  console.log('[hello] Ready hook fired - Hello from the module system!');

  // WHY LOG SITE NAME:
  // Demonstrates that modules can access core config through context.
  // This proves the hook received proper context.
  if (context.config?.site?.name) {
    console.log(`[hello] Running on site: ${context.config.site.name}`);
  }
}

/**
 * CLI hook handler
 *
 * WHEN THIS RUNS:
 * During the REGISTER phase, after all modules are loaded.
 * The register function is passed in, allowing modules to add
 * their own CLI commands.
 *
 * WHY register IS PASSED (not imported):
 * - Decouples modules from CLI internals
 * - register function automatically tracks module source
 * - Module doesn't need to know its own name
 *
 * @param {Function} register - register(name, handler, description)
 * @param {Object} context - Boot context
 */
export function hook_cli(register, context) {
  /**
   * hello:greet [name] - Greet someone by name
   *
   * Examples:
   *   node index.js hello:greet        → "Hello, World!"
   *   node index.js hello:greet Ernie  → "Hello, Ernie!"
   */
  register('hello:greet', async (args, ctx) => {
    const name = args[0] || 'World';
    console.log(`Hello, ${name}!`);
  }, 'Greet someone by name');

  /**
   * hello:info - Show module information
   *
   * Reads from the module's manifest.json to display
   * name, version, and description.
   */
  register('hello:info', async (args, ctx) => {
    // Find this module's info from context
    const moduleInfo = ctx.modules.find(m => m.name === 'hello');

    if (!moduleInfo) {
      console.log('Module info not available.');
      return;
    }

    console.log('\nModule: hello');
    console.log(`  Version: ${moduleInfo.version}`);
    console.log(`  Description: ${moduleInfo.description || 'No description'}`);

    if (moduleInfo.wiredHooks?.length > 0) {
      console.log(`  Hooks: ${moduleInfo.wiredHooks.join(', ')}`);
    }

    console.log('');
  }, 'Show hello module info');
}

/**
 * Routes hook handler
 *
 * WHEN THIS RUNS:
 * During the REGISTER phase, after CLI hooks.
 * The register function is passed in, allowing modules to add HTTP routes.
 *
 * ROUTE HANDLER SIGNATURE:
 * async function handler(req, res, params, context)
 *   - req: Node's http.IncomingMessage
 *   - res: Node's http.ServerResponse
 *   - params: Path parameters { name: 'value' }
 *   - context: Boot context (config, services, modules, etc.)
 *
 * @param {Function} register - register(method, path, handler, description)
 * @param {Object} context - Boot context
 */
export function hook_routes(register, context) {
  // Get server helpers for response formatting
  const server = context.services.get('server');
  const template = context.services.get('template');

  /**
   * GET /hello → returns "Hello, World!"
   */
  register('GET', '/hello', async (req, res, params, ctx) => {
    server.text(res, 'Hello, World!');
  }, 'Say hello');

  /**
   * GET /hello/page → returns a themed HTML page
   *
   * Demonstrates the template system:
   * 1. Render page.html with content data
   * 2. Wrap in layout.html with site data
   * 3. Return full HTML page
   *
   * NOTE: This must be registered BEFORE /hello/:name
   * because routes match in registration order.
   */
  register('GET', '/hello/page', async (req, res, params, ctx) => {
    // Render the page content
    const pageContent = template.render('page.html', {
      title: 'Hello Page',
      body: '<p>This is a themed page from the hello module.</p><p>It demonstrates the template system with layouts, variables, and more.</p>',
    });

    // Wrap in layout
    const fullPage = template.renderWithLayout('layout.html', pageContent, {
      title: 'Hello Page',
      siteName: ctx.config.site.name,
      version: ctx.config.site.version,
    });

    server.html(res, fullPage);
  }, 'Themed hello page');

  /**
   * GET /hello/:name → returns "Hello, <name>!"
   *
   * NOTE: Parameterized routes should be registered AFTER
   * specific routes like /hello/page.
   */
  register('GET', '/hello/:name', async (req, res, params, ctx) => {
    server.text(res, `Hello, ${params.name}!`);
  }, 'Greet someone');
}

/**
 * Content hook handler
 *
 * WHEN THIS RUNS:
 * During the REGISTER phase, after routes hooks.
 * The register function is passed in, allowing modules to define
 * content types with their schemas.
 *
 * CONTENT TYPE SCHEMA:
 * Each field definition specifies:
 * - type: 'string' | 'number' | 'boolean' | 'array' | 'object'
 * - required: true | false
 *
 * @param {Function} register - register(type, schema)
 * @param {Object} context - Boot context
 */
export function hook_content(register, context) {
  /**
   * greeting content type
   *
   * A simple content type for storing greetings.
   * Demonstrates the content system with minimal fields.
   *
   * Example content:
   * {
   *   "id": "1705123456789-x7k9m",
   *   "type": "greeting",
   *   "created": "2024-01-13T...",
   *   "updated": "2024-01-13T...",
   *   "name": "Ernie",
   *   "message": "Welcome!"
   * }
   */
  register('greeting', {
    name: { type: 'string', required: true },
    message: { type: 'string', required: true },
  });
}

/**
 * EXTENDING THIS MODULE:
 *
 * To add more hooks, follow this pattern:
 *
 * 1. Add hook name to manifest.json "hooks" array
 * 2. Export a function named hook_<name>
 * 3. Document when it runs and what context it receives
 *
 * Common hooks a module might implement:
 *
 * - hook_boot: Initialize module
 * - hook_ready: Post-initialization tasks
 * - hook_cli: Register CLI commands
 * - hook_routes: Register HTTP routes
 * - hook_content: Register content types
 * - hook_shutdown: Cleanup before exit (graceful shutdown)
 * - hook_content_beforeSave: Modify content before saving
 * - hook_content_afterSave: React to saved content
 * - hook_render: Modify rendered output
 *
 * The hook_ prefix is mandatory. Core ignores exports without it.
 */
