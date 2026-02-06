/**
 * router.js - HTTP Route Registry with Middleware Support
 *
 * WHY THIS EXISTS:
 * The CMS needs a way to map HTTP requests to handlers:
 * - Core provides system routes (/, /health)
 * - Modules add their own routes via hooks
 * - Routes need to support path parameters (/hello/:name)
 * - Middleware provides request/response processing pipeline
 *
 * PATH PARAMETER SYNTAX:
 * /users/:id → matches /users/123, params = { id: '123' }
 * /posts/:category/:slug → matches /posts/tech/hello, params = { category: 'tech', slug: 'hello' }
 *
 * MIDDLEWARE DESIGN:
 * - Global middleware runs for every request
 * - Path-specific middleware runs for matching paths
 * - Middleware can respond directly (halting chain) or call next()
 * - Signature: async (req, res, context, next) => {}
 *
 * WHY NOT USE A LIBRARY:
 * - Zero dependencies philosophy
 * - Simple enough to implement ourselves
 * - Full control over behavior
 */

/**
 * Route registry
 * Structure: [{ method, path, handler, description, source, pattern, paramNames }]
 *
 * WHY ARRAY (not object):
 * Routes are matched in order of registration.
 * More specific routes should be registered first.
 * Array preserves insertion order.
 */
const routes = [];

/**
 * Middleware registry
 * Structure: [{ handler, path, name, source }]
 *
 * WHY SEPARATE FROM ROUTES:
 * Middleware runs before route matching.
 * Global middleware (path=null) runs on all requests.
 * Path-specific middleware runs on matching path prefixes.
 */
const middleware = [];

/**
 * Convert a path pattern to a regex and extract param names
 *
 * @param {string} path - Route path like "/hello/:name"
 * @returns {{ pattern: RegExp, paramNames: string[] }}
 *
 * WHY PRECOMPILE:
 * Regex compilation is expensive. We do it once at registration,
 * not on every request. This keeps matching fast.
 *
 * PATTERN EXAMPLES:
 * "/hello" → /^\/hello$/
 * "/hello/:name" → /^\/hello\/([^\/]+)$/
 * "/posts/:category/:slug" → /^\/posts\/([^\/]+)\/([^\/]+)$/
 */
function compilePath(path) {
  const paramNames = [];

  // Escape special regex chars, then replace :param with capture groups
  const regexStr = path
    // Escape dots, etc (common in URLs)
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    // Replace :paramName with capture group
    .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (match, paramName) => {
      paramNames.push(paramName);
      return '([^\\/]+)'; // Match anything except /
    });

  return {
    pattern: new RegExp(`^${regexStr}$`),
    paramNames,
  };
}

/**
 * Register a route
 *
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} path - URL path pattern (e.g., "/hello/:name")
 * @param {Function} handler - async (req, res, params, context) => void
 * @param {string} description - Help text for this route
 * @param {string} source - "core" or module name
 *
 * WHY INCLUDE DESCRIPTION:
 * Useful for debugging and introspection.
 * Can list all routes with their purposes.
 *
 * WHY INCLUDE SOURCE:
 * Know which module provided which route.
 * Helps with debugging and documentation.
 */
function registerInternal(method, path, handler, description, source = 'core') {
  const { pattern, paramNames } = compilePath(path);

  routes.push({
    method: method.toUpperCase(),
    path,
    handler,
    description,
    source,
    pattern,
    paramNames,
  });
}

/**
 * Register a core route
 */
export function register(method, path, handler, description) {
  registerInternal(method, path, handler, description, 'core');
}

/**
 * Register a route with explicit source (for plugins)
 *
 * @param {string} method - HTTP method
 * @param {string} path - URL path pattern
 * @param {Function} handler - Route handler
 * @param {string} description - Help text
 * @param {string} source - Source identifier
 */
export { registerInternal };

/**
 * Create a register function for a specific module
 *
 * WHY FACTORY FUNCTION:
 * Same pattern as CLI - each module gets a register function
 * that automatically tracks which module the route came from.
 *
 * @param {string} moduleName - The module registering routes
 * @returns {Function} - register(method, path, handler, description)
 */
export function createModuleRegister(moduleName) {
  return function registerForModule(method, path, handler, description) {
    registerInternal(method, path, handler, description, moduleName);
  };
}

/**
 * Match a request to a route
 *
 * @param {string} method - HTTP method
 * @param {string} url - Request URL path
 * @returns {{ handler, params, route } | null}
 *
 * WHY RETURN OBJECT (not just handler):
 * The caller needs both the handler and the extracted params.
 * Including the route info helps with logging.
 */
export function match(method, url) {
  const upperMethod = method.toUpperCase();

  // Parse URL to get path without query string
  // WHY SPLIT ON ?: URL might have query params
  const path = url.split('?')[0];

  for (const route of routes) {
    // Check method first (fast rejection)
    if (route.method !== upperMethod) {
      continue;
    }

    // Try to match the pattern
    const match = path.match(route.pattern);
    if (!match) {
      continue;
    }

    // Extract params from capture groups
    // match[0] is the full match, match[1..n] are capture groups
    const params = {};
    for (let i = 0; i < route.paramNames.length; i++) {
      params[route.paramNames[i]] = decodeURIComponent(match[i + 1]);
    }

    return {
      handler: route.handler,
      params,
      route,
    };
  }

  return null;
}

/**
 * List all registered routes
 *
 * @returns {Array<{method, path, description, source}>}
 */
export function list() {
  return routes.map(({ method, path, description, source }) => ({
    method,
    path,
    description,
    source,
  }));
}

/**
 * List core routes only
 */
export function listCore() {
  return list().filter(r => r.source === 'core');
}

/**
 * List module routes only
 */
export function listModule() {
  return list().filter(r => r.source !== 'core');
}

/**
 * Get route count
 */
export function count() {
  return routes.length;
}

/**
 * Clear all routes (mainly for testing)
 */
export function clear() {
  routes.length = 0;
}

/**
 * Unregister routes by source
 *
 * @param {string} source - Source name (module or plugin name)
 * @returns {number} - Number of routes removed
 *
 * WHY THIS EXISTS:
 * Hot-swap plugins need to remove their routes when deactivated.
 * This allows clean unloading without restarting the server.
 */
export function unregisterBySource(source) {
  const before = routes.length;

  // Filter out routes from the specified source
  for (let i = routes.length - 1; i >= 0; i--) {
    if (routes[i].source === source) {
      routes.splice(i, 1);
    }
  }

  return before - routes.length;
}

/**
 * Clear all middleware (mainly for testing)
 */
export function clearMiddleware() {
  middleware.length = 0;
}

/**
 * ROUTE HANDLER SIGNATURE:
 *
 * Handlers receive four arguments:
 *
 *   async function handler(req, res, params, context) {
 *     // req: Node's http.IncomingMessage
 *     // res: Node's http.ServerResponse
 *     // params: Path parameters { name: 'value' }
 *     // context: Boot context (config, services, modules, etc.)
 *
 *     res.writeHead(200, { 'Content-Type': 'text/plain' });
 *     res.end('Hello!');
 *   }
 *
 * WHY PASS CONTEXT:
 * Handlers need access to config, services, etc.
 * Passing context avoids global state and makes testing easier.
 *
 * WHY req/res FIRST:
 * Familiar to anyone who's used Node's http module.
 * Easy to migrate to/from Express-style handlers.
 */

// ==========================================
// MIDDLEWARE SYSTEM
// ==========================================

/**
 * Register middleware
 *
 * @param {Function} handler - async (req, res, context, next) => {}
 * @param {string|null} path - Path prefix to match, or null for global
 * @param {string} name - Middleware name for logging
 * @param {string} source - "core" or module name
 *
 * MIDDLEWARE SIGNATURE:
 * async (req, res, context, next) => {
 *   // Do something before route handler
 *   await next();  // Continue to next middleware/route
 *   // Do something after route handler
 * }
 *
 * OR respond directly to halt the chain:
 * async (req, res, context, next) => {
 *   res.writeHead(401);
 *   res.end('Unauthorized');
 *   // Don't call next() - halts processing
 * }
 *
 * WHY PATH PREFIX (not exact match):
 * /admin middleware should run for /admin, /admin/content, /admin/modules, etc.
 * This is the common use case for path-specific middleware.
 */
function useInternal(handler, path, name, source = 'core') {
  middleware.push({
    handler,
    path: path || null,  // null means global
    name,
    source,
  });
}

/**
 * Register core middleware
 *
 * @param {Function} handler - Middleware function
 * @param {string} name - Middleware name
 * @param {string|null} path - Optional path prefix
 */
export function use(handler, name, path = null) {
  useInternal(handler, path, name, 'core');
}

/**
 * Register middleware with explicit source (for plugins)
 */
export { useInternal };

/**
 * Create a middleware registration function for a specific module
 *
 * @param {string} moduleName - The module registering middleware
 * @returns {Function} - use(handler, name, path?)
 */
export function createModuleMiddleware(moduleName) {
  return function useForModule(handler, name, path = null) {
    // For module middleware, prepend module name to the name
    const fullName = `${moduleName}:${name || 'middleware'}`;
    useInternal(handler, path, fullName, moduleName);
  };
}

/**
 * Run middleware chain for a request
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {Object} context - Boot context
 * @param {string} path - Request path
 * @returns {Promise<boolean>} - true if should continue to route, false if middleware responded
 *
 * EXECUTION ORDER:
 * 1. Global middleware (path === null) in registration order
 * 2. Path-specific middleware matching the request path, in registration order
 *
 * WHY RETURN BOOLEAN:
 * Caller needs to know if middleware handled the response.
 * If res.writableEnded is true, don't continue to route handler.
 */
export async function runMiddleware(req, res, context, path) {
  // Collect applicable middleware
  // Global middleware first, then path-specific
  const applicable = middleware.filter(mw => {
    if (mw.path === null) {
      return true;  // Global middleware always runs
    }
    // Path-specific: check if request path starts with middleware path
    return path.startsWith(mw.path);
  });

  // If no middleware, continue to route
  if (applicable.length === 0) {
    return true;
  }

  // Build the middleware chain
  let index = 0;

  async function next() {
    // If response already ended, stop
    if (res.writableEnded) {
      return;
    }

    // Get next middleware
    const mw = applicable[index++];

    if (!mw) {
      // No more middleware, done
      return;
    }

    // Run the middleware
    try {
      await mw.handler(req, res, context, next);
    } catch (error) {
      console.error(`[middleware] Error in ${mw.name}: ${error.message}`);
      // Re-throw to let server handle it
      throw error;
    }
  }

  // Start the chain
  await next();

  // Return whether to continue to route handler
  return !res.writableEnded;
}

/**
 * List all registered middleware
 *
 * @returns {Array<{name, path, source}>}
 */
export function listMiddleware() {
  return middleware.map(({ name, path, source }) => ({
    name,
    path,
    source,
  }));
}

/**
 * List global middleware only
 */
export function listGlobalMiddleware() {
  return listMiddleware().filter(m => m.path === null);
}

/**
 * List path-specific middleware only
 */
export function listPathMiddleware() {
  return listMiddleware().filter(m => m.path !== null);
}

/**
 * Get middleware count
 */
export function middlewareCount() {
  return middleware.length;
}

/**
 * Unregister middleware by source
 *
 * @param {string} source - Source name (module or plugin name)
 * @returns {number} - Number of middleware removed
 *
 * WHY THIS EXISTS:
 * Hot-swap plugins need to remove their middleware when deactivated.
 */
export function unregisterMiddlewareBySource(source) {
  const before = middleware.length;

  for (let i = middleware.length - 1; i >= 0; i--) {
    if (middleware[i].source === source) {
      middleware.splice(i, 1);
    }
  }

  return before - middleware.length;
}
