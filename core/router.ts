/**
 * router.ts - HTTP Route Registry with Middleware Support
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

import type { IncomingMessage, ServerResponse } from 'node:http';

// ============================================================================
// Types
// ============================================================================

/** Context object passed to route handlers and middleware */
export interface RequestContext {
    user?: { id: string; name: string; role: string };
    session?: { id: string; userId: string; timestamp: number };
    baseDir?: string;
    services?: Map<string, unknown>;
    _parsedBody?: Record<string, unknown>;
    [key: string]: unknown;
}

/** Route handler signature — handles a matched HTTP request */
export type RouteHandler = (
    req: IncomingMessage,
    res: ServerResponse,
    params: Record<string, string>,
    context: RequestContext
) => Promise<void> | void;

/** Middleware handler signature — processes request before/after route handler */
export type MiddlewareHandler = (
    req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
    next: () => Promise<void>
) => Promise<void> | void;

/** A compiled route descriptor stored in the registry */
export interface RouteDescriptor {
    method: string;
    path: string;
    handler: RouteHandler;
    description: string;
    source: string;
    pattern: RegExp;
    paramNames: string[];
}

/** A middleware entry stored in the registry */
interface MiddlewareEntry {
    handler: MiddlewareHandler;
    path: string | null;
    name: string;
    source: string;
}

/** Result of a successful route match */
interface RouteMatch {
    handler: RouteHandler;
    params: Record<string, string>;
    route: RouteDescriptor;
}

/** Route info returned by list functions */
interface RouteInfo {
    method: string;
    path: string;
    description: string;
    source: string;
}

/** Middleware info returned by list functions */
interface MiddlewareInfo {
    name: string;
    path: string | null;
    source: string;
}

/** Module-scoped register function type */
export type ModuleRegisterFn = (
    method: string,
    path: string,
    handler: RouteHandler,
    description: string
) => void;

/** Module-scoped middleware registration function type */
export type ModuleMiddlewareFn = (
    handler: MiddlewareHandler,
    name: string,
    path?: string | null
) => void;

// ============================================================================
// State
// ============================================================================
/**
 * Route registry
 * Structure: [{ method, path, handler, description, source, pattern, paramNames }]
 *
 * WHY ARRAY (not object):
 * Routes are matched in order of registration.
 * More specific routes should be registered first.
 * Array preserves insertion order.
 */
const routes: RouteDescriptor[] = [];

/**
 * Middleware registry
 * Structure: [{ handler, path, name, source }]
 *
 * WHY SEPARATE FROM ROUTES:
 * Middleware runs before route matching.
 * Global middleware (path=null) runs on all requests.
 * Path-specific middleware runs on matching path prefixes.
 */
const middleware: MiddlewareEntry[] = [];

// ============================================================================
// Path Compilation (Private)
// ============================================================================
/**
 * Convert a path pattern to a regex and extract param names
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
function compilePath(path: string): { pattern: RegExp; paramNames: string[] } {
    const paramNames: string[] = [];

    // Escape special regex chars, then replace :param with capture groups
    const regexStr = path
        // Escape dots, etc (common in URLs)
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        // Replace :paramName with capture group
        .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_match: string, paramName: string) => {
            paramNames.push(paramName);
            return '([^\\/]+)'; // Match anything except /
        });

    return {
        pattern: new RegExp(`^${regexStr}$`),
        paramNames,
    };
}

// ============================================================================
// Route Registration
// ============================================================================
/**
 * Register a route (internal — tracks source)
 *
 * WHY INCLUDE DESCRIPTION:
 * Useful for debugging and introspection.
 *
 * WHY INCLUDE SOURCE:
 * Know which module provided which route.
 */
function registerInternal(
    method: string,
    path: string,
    handler: RouteHandler,
    description: string,
    source: string = 'core'
): void {
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
export function register(
    method: string,
    path: string,
    handler: RouteHandler,
    description: string
): void {
    registerInternal(method, path, handler, description, 'core');
}

/**
 * Register a route with explicit source (for plugins)
 */
export { registerInternal };

/**
 * Create a register function for a specific module
 *
 * WHY FACTORY FUNCTION:
 * Same pattern as CLI - each module gets a register function
 * that automatically tracks which module the route came from.
 */
export function createModuleRegister(moduleName: string): ModuleRegisterFn {
    return function registerForModule(
        method: string,
        path: string,
        handler: RouteHandler,
        description: string
    ): void {
        registerInternal(method, path, handler, description, moduleName);
    };
}

// ============================================================================
// Route Matching
// ============================================================================
/**
 * Match a request to a route
 *
 * WHY RETURN OBJECT (not just handler):
 * The caller needs both the handler and the extracted params.
 * Including the route info helps with logging.
 */
export function match(method: string, url: string): RouteMatch | null {
    const upperMethod = method.toUpperCase();

    // Parse URL to get path without query string
    // WHY SPLIT ON ?: URL might have query params
    const path = url.split('?')[0]!;

    for (const route of routes) {
        // Check method first (fast rejection)
        if (route.method !== upperMethod) {
            continue;
        }

        // Try to match the pattern
        const matchResult = path.match(route.pattern);
        if (!matchResult) {
            continue;
        }

        // Extract params from capture groups
        // matchResult[0] is the full match, matchResult[1..n] are capture groups
        const params: Record<string, string> = {};
        for (let i = 0; i < route.paramNames.length; i++) {
            params[route.paramNames[i]!] = decodeURIComponent(matchResult[i + 1]!);
        }

        return {
            handler: route.handler,
            params,
            route,
        };
    }

    return null;
}

// ============================================================================
// Route Introspection
// ============================================================================
/**
 * List all registered routes
 */
export function list(): RouteInfo[] {
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
export function listCore(): RouteInfo[] {
    return list().filter(r => r.source === 'core');
}

/**
 * List module routes only
 */
export function listModule(): RouteInfo[] {
    return list().filter(r => r.source !== 'core');
}

/**
 * Get route count
 */
export function count(): number {
    return routes.length;
}

/**
 * Clear all routes (mainly for testing)
 */
export function clear(): void {
    routes.length = 0;
}

/**
 * Unregister routes by source
 *
 * WHY THIS EXISTS:
 * Hot-swap plugins need to remove their routes when deactivated.
 * This allows clean unloading without restarting the server.
 */
export function unregisterBySource(source: string): number {
    const before = routes.length;
    // Filter out routes from the specified source
    for (let i = routes.length - 1; i >= 0; i--) {
        if (routes[i]!.source === source) {
            routes.splice(i, 1);
        }
    }
    return before - routes.length;
}

// ============================================================================
// Middleware System
// ============================================================================
/**
 * Register middleware (internal — tracks source)
 *
 * MIDDLEWARE SIGNATURE:
 * async (req, res, context, next) => {
 *   // Do something before route handler
 *   await next();  // Continue to next middleware/route
 *   // Do something after route handler
 * }
 *
 * WHY PATH PREFIX (not exact match):
 * /admin middleware should run for /admin, /admin/content, /admin/modules, etc.
 */
function useInternal(
    handler: MiddlewareHandler,
    path: string | null,
    name: string,
    source: string = 'core'
): void {
    middleware.push({
        handler,
        path: path || null, // null means global
        name,
        source,
    });
}

/**
 * Register core middleware
 */
export function use(
    handler: MiddlewareHandler,
    name: string,
    path: string | null = null
): void {
    useInternal(handler, path, name, 'core');
}

/**
 * Register middleware with explicit source (for plugins)
 */
export { useInternal };

/**
 * Create a middleware registration function for a specific module
 */
export function createModuleMiddleware(moduleName: string): ModuleMiddlewareFn {
    return function useForModule(
        handler: MiddlewareHandler,
        name: string,
        path: string | null = null
    ): void {
        // For module middleware, prepend module name to the name
        const fullName = `${moduleName}:${name || 'middleware'}`;
        useInternal(handler, path, fullName, moduleName);
    };
}

/**
 * Run middleware chain for a request
 *
 * EXECUTION ORDER:
 * 1. Global middleware (path === null) in registration order
 * 2. Path-specific middleware matching the request path, in registration order
 *
 * WHY RETURN BOOLEAN:
 * Caller needs to know if middleware handled the response.
 * If res.writableEnded is true, don't continue to route handler.
 */
export async function runMiddleware(
    req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
    path: string
): Promise<boolean> {
    // Collect applicable middleware
    // Global middleware first, then path-specific
    const applicable = middleware.filter(mw => {
        if (mw.path === null) {
            return true; // Global middleware always runs
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

    async function next(): Promise<void> {
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
        }
        catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`[middleware] Error in ${mw.name}: ${message}`);
            // Re-throw to let server handle it
            throw error;
        }
    }

    // Start the chain
    await next();

    // Return whether to continue to route handler
    return !res.writableEnded;
}

// ============================================================================
// Middleware Introspection
// ============================================================================
/**
 * List all registered middleware
 */
export function listMiddleware(): MiddlewareInfo[] {
    return middleware.map(({ name, path, source }) => ({
        name,
        path,
        source,
    }));
}

/**
 * List global middleware only
 */
export function listGlobalMiddleware(): MiddlewareInfo[] {
    return listMiddleware().filter(m => m.path === null);
}

/**
 * List path-specific middleware only
 */
export function listPathMiddleware(): MiddlewareInfo[] {
    return listMiddleware().filter(m => m.path !== null);
}

/**
 * Get middleware count
 */
export function middlewareCount(): number {
    return middleware.length;
}

/**
 * Clear all middleware (mainly for testing)
 */
export function clearMiddleware(): void {
    middleware.length = 0;
}

/**
 * Unregister middleware by source
 *
 * WHY THIS EXISTS:
 * Hot-swap plugins need to remove their middleware when deactivated.
 */
export function unregisterMiddlewareBySource(source: string): number {
    const before = middleware.length;
    for (let i = middleware.length - 1; i >= 0; i--) {
        if (middleware[i]!.source === source) {
            middleware.splice(i, 1);
        }
    }
    return before - middleware.length;
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
