/**
 * server.js - HTTP Server with Middleware Support
 *
 * WHY THIS EXISTS:
 * A CMS needs to serve HTTP requests. This module provides:
 * - Simple server wrapper around Node's http module
 * - Middleware pipeline for request/response processing
 * - Request routing via the router module
 * - 404 handling for unmatched routes
 *
 * REQUEST FLOW:
 * 1. Global middleware runs (logging, timing, etc.)
 * 2. Path-specific middleware runs (auth for /admin, etc.)
 * 3. If middleware didn't respond, match and call route handler
 * 4. If no route matched, return 404
 *
 * WHY NOT USE EXPRESS/FASTIFY:
 * - Zero dependencies philosophy
 * - Simple use cases don't need framework overhead
 * - Educational: understand what frameworks do
 */

import { createServer } from 'node:http';
import * as router from './router.js';
import * as static_ from './static.js';

/**
 * Server instance (so we can stop it later)
 */
let server = null;

/**
 * Boot context (so handlers can access config, services, etc.)
 */
let bootContext = null;

/**
 * Format current timestamp for logging
 */
function timestamp() {
  return new Date().toISOString();
}

/**
 * Handle an incoming HTTP request
 *
 * REQUEST FLOW:
 * 1. Store start time for response timing
 * 2. Run middleware pipeline (global, then path-specific)
 * 3. If middleware responded, done
 * 4. Check for static files
 * 5. Match and call route handler
 * 6. 404 if no match
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function handleRequest(req, res) {
  const method = req.method || 'GET';
  const url = req.url || '/';
  const startTime = Date.now();

  // Store start time on request for response time middleware
  req.startTime = startTime;

  // Parse URL to get path without query string
  const path = url.split('?')[0];

  try {
    // RUN MIDDLEWARE PIPELINE
    // Global middleware runs first, then path-specific.
    // If middleware responds (sets res.writableEnded), we stop here.
    const shouldContinue = await router.runMiddleware(req, res, bootContext, path);

    if (!shouldContinue) {
      // Middleware handled the response
      return;
    }

    // STATIC FILE HANDLING
    // Check for static files before route matching.
    // This allows /public/* URLs to serve files directly.
    // If file not found, we fall through to route matching.
    // WHY GET AND HEAD:
    // - GET serves the file content
    // - HEAD serves headers only (for content-type checks)
    if ((method === 'GET' || method === 'HEAD') && static_.isStaticPath(path)) {
      const served = static_.serve(bootContext.baseDir, path, res, method);

      if (served) {
        return;
      }

      // File not found - return 404 for static paths
      // WHY NOT FALL THROUGH:
      // /public/* paths should only serve static files.
      // Falling through to routes could cause confusion.
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found', path: url }));
      return;
    }

    // Try to match a route
    const matched = router.match(method, url);

    if (matched) {
      // Route found - call the handler
      const { handler, params, route } = matched;

      try {
        await handler(req, res, params, bootContext);

      } catch (handlerError) {
        // Handler threw an error
        console.error(`[server] Handler error for ${method} ${url}:`, handlerError.message);

        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal Server Error' }));
        }
      }

    } else {
      // No route matched - 404
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found', path: url }));
    }

  } catch (error) {
    // Something went very wrong
    console.error(`[server] Critical error handling ${method} ${url}:`, error.message);

    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  }
}

/**
 * Start the HTTP server
 *
 * @param {number} port - Port to listen on
 * @param {Object} context - Boot context (config, services, modules, etc.)
 * @returns {Promise<void>}
 *
 * WHY ASYNC:
 * Server.listen() is callback-based. We wrap it in a promise
 * so callers can await it and know when the server is ready.
 */
export function start(port, context) {
  return new Promise((resolve, reject) => {
    // Store context for handlers
    bootContext = context;

    // Create the server
    server = createServer(handleRequest);

    // Handle server errors
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use`));
      } else {
        reject(error);
      }
    });

    // Start listening
    server.listen(port, () => {
      resolve();
    });
  });
}

/**
 * Stop the HTTP server
 *
 * @returns {Promise<void>}
 *
 * WHY GRACEFUL:
 * Closing the server stops accepting new connections.
 * Existing connections are allowed to finish.
 */
export function stop() {
  return new Promise((resolve, reject) => {
    if (!server) {
      resolve();
      return;
    }

    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        server = null;
        bootContext = null;
        resolve();
      }
    });
  });
}

/**
 * Check if server is running
 */
export function isRunning() {
  return server !== null && server.listening;
}

/**
 * Get server address (for logging)
 */
export function getAddress() {
  if (!server) return null;
  const addr = server.address();
  if (typeof addr === 'string') return addr;
  return `http://localhost:${addr.port}`;
}

/**
 * RESPONSE HELPERS:
 *
 * Handlers can use these helpers or write responses directly.
 * These are just convenience functions.
 */

/**
 * Send a JSON response
 *
 * @param {http.ServerResponse} res
 * @param {*} data - Data to JSON.stringify
 * @param {number} status - HTTP status code (default 200)
 */
export function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Send a plain text response
 *
 * @param {http.ServerResponse} res
 * @param {string} text - Text to send
 * @param {number} status - HTTP status code (default 200)
 */
export function text(res, text, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/plain' });
  res.end(text);
}

/**
 * Send an HTML response
 *
 * @param {http.ServerResponse} res
 * @param {string} html - HTML to send
 * @param {number} status - HTTP status code (default 200)
 */
export function html(res, html, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/html' });
  res.end(html);
}
