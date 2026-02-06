/**
 * webhooks/index.js - Webhook Management Module
 *
 * This module provides:
 * - Webhook content type for storing webhook configurations
 * - Admin UI for managing webhooks
 * - Integration with content lifecycle hooks
 * - Test endpoint for verifying webhook delivery
 *
 * HOW IT WORKS:
 * =============
 * 1. At boot, load all webhooks from content storage
 * 2. Register them with the webhook dispatch system
 * 3. Listen for content:after* events
 * 4. Fire matching webhooks with content payload
 *
 * WEBHOOK PAYLOAD FORMAT:
 * ======================
 * {
 *   "event": "content:afterCreate",
 *   "type": "greeting",
 *   "item": { ...content object... },
 *   "timestamp": "2024-01-15T10:30:00.000Z"
 * }
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import * as webhooksCore from '../../core/webhooks.js';

// Get the directory of this module for loading templates
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load a template file from this module's templates directory
 */
function loadTemplate(name) {
  const templatePath = join(__dirname, 'templates', name);
  return readFileSync(templatePath, 'utf-8');
}

/**
 * Parse URL-encoded form data from request body
 */
function parseFormBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1024 * 1024) {
        reject(new Error('Form data too large'));
      }
    });

    req.on('end', () => {
      try {
        const data = {};
        const pairs = body.split('&');

        for (const pair of pairs) {
          const [key, value] = pair.split('=').map(s => decodeURIComponent(s.replace(/\+/g, ' ')));
          if (key) {
            data[key] = value || '';
          }
        }

        resolve(data);
      } catch (error) {
        reject(new Error('Invalid form data'));
      }
    });

    req.on('error', reject);
  });
}

/**
 * Get flash message from query string
 */
function getFlashMessage(url) {
  const urlObj = new URL(url, 'http://localhost');
  const success = urlObj.searchParams.get('success');
  const error = urlObj.searchParams.get('error');

  if (success) {
    return { type: 'success', message: decodeURIComponent(success) };
  }
  if (error) {
    return { type: 'error', message: decodeURIComponent(error) };
  }
  return null;
}

/**
 * Boot hook - load webhooks from content and register them
 */
export async function hook_boot(context) {
  const content = context.services.get('content');
  const hooks = context.services.get('hooks');

  // Check if webhook content type exists
  if (!content.hasType('webhook')) {
    console.log('[webhooks] Webhook content type not yet registered, skipping load');
    return;
  }

  // Load all webhooks from content
  const result = content.list('webhook');
  const storedWebhooks = result.items || [];
  let enabledCount = 0;

  for (const webhook of storedWebhooks) {
    if (webhook.enabled) {
      // Register with core webhook system
      webhooksCore.register(
        webhook.event,
        webhook.url,
        webhook.secret || null,
        webhook.id
      );
      enabledCount++;
      console.log(`[webhooks] Registered: ${webhook.event} → ${webhook.url}`);
    }
  }

  console.log(`[webhooks] Loaded ${enabledCount} webhook(s)`);

  // Wire up content lifecycle hooks to fire webhooks
  // WHY HERE (not in hook_content):
  // - Need hooks service which isn't available in hook_content
  // - Content hooks fire after all modules are loaded

  hooks.register('content:afterCreate', async (ctx) => {
    webhooksCore.fire('content:afterCreate', {
      event: 'content:afterCreate',
      type: ctx.type,
      item: ctx.item,
      timestamp: new Date().toISOString(),
    });
  }, 100, 'webhooks'); // Low priority - run after other handlers

  hooks.register('content:afterUpdate', async (ctx) => {
    webhooksCore.fire('content:afterUpdate', {
      event: 'content:afterUpdate',
      type: ctx.type,
      item: ctx.item,
      timestamp: new Date().toISOString(),
    });
  }, 100, 'webhooks');

  hooks.register('content:afterDelete', async (ctx) => {
    webhooksCore.fire('content:afterDelete', {
      event: 'content:afterDelete',
      type: ctx.type,
      id: ctx.id,
      timestamp: new Date().toISOString(),
    });
  }, 100, 'webhooks');
}

/**
 * Content hook - register webhook content type
 */
export function hook_content(register, context) {
  register('webhook', {
    event: { type: 'string', required: true },    // e.g., "content:afterCreate"
    url: { type: 'string', required: true },      // Webhook URL
    secret: { type: 'string', required: false },  // Optional HMAC secret
    enabled: { type: 'boolean', required: false }, // Enable/disable
  });
}

/**
 * Routes hook - register webhook admin routes
 */
export function hook_routes(register, context) {
  const server = context.services.get('server');
  const content = context.services.get('content');
  const template = context.services.get('template');
  const auth = context.services.get('auth');

  /**
   * Render a page with layout
   */
  function renderPage(templateName, data, ctx) {
    const pageTemplate = loadTemplate(templateName);
    const pageContent = template.renderString(pageTemplate, data);

    return template.renderWithLayout('layout.html', pageContent, {
      title: data.pageTitle || 'Webhooks',
      siteName: ctx.config.site.name,
      version: ctx.config.site.version,
    });
  }

  /**
   * Redirect helper
   */
  function redirect(res, url) {
    res.writeHead(302, { Location: url });
    res.end();
  }

  /**
   * Available webhook events
   */
  const EVENTS = [
    { value: 'content:afterCreate', label: 'Content Created' },
    { value: 'content:afterUpdate', label: 'Content Updated' },
    { value: 'content:afterDelete', label: 'Content Deleted' },
  ];

  /**
   * GET /admin/webhooks - List all webhooks
   */
  register('GET', '/admin/webhooks', async (req, res, params, ctx) => {
    // Check admin permission
    if (!auth.hasRole(req.user, 'admin')) {
      res.writeHead(403, { 'Content-Type': 'text/html' });
      res.end('<h1>403 Forbidden</h1><p>Admin access required.</p><p><a href="/admin">Back to Dashboard</a></p>');
      return;
    }

    const webhooks = content.list('webhook').items.map(w => ({
      id: w.id,
      event: w.event,
      url: w.url,
      hasSecret: !!w.secret,
      enabled: w.enabled !== false, // Default to enabled
      createdFormatted: new Date(w.created).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
    }));

    const flash = getFlashMessage(req.url);

    const html = renderPage('webhooks-list.html', {
      pageTitle: 'Webhooks',
      webhooks,
      hasWebhooks: webhooks.length > 0,
      webhookCount: webhooks.length,
      currentUser: req.user,
      flash,
      hasFlash: !!flash,
    }, ctx);

    server.html(res, html);
  }, 'List webhooks');

  /**
   * GET /admin/webhooks/new - Create webhook form
   */
  register('GET', '/admin/webhooks/new', async (req, res, params, ctx) => {
    if (!auth.hasRole(req.user, 'admin')) {
      res.writeHead(403, { 'Content-Type': 'text/html' });
      res.end('<h1>403 Forbidden</h1><p>Admin access required.</p>');
      return;
    }

    const flash = getFlashMessage(req.url);

    const html = renderPage('webhook-form.html', {
      pageTitle: 'Create Webhook',
      isCreate: true,
      events: EVENTS,
      currentUser: req.user,
      flash,
      hasFlash: !!flash,
    }, ctx);

    server.html(res, html);
  }, 'Create webhook form');

  /**
   * POST /admin/webhooks - Create webhook
   */
  register('POST', '/admin/webhooks', async (req, res, params, ctx) => {
    if (!auth.hasRole(req.user, 'admin')) {
      server.json(res, { error: 'Forbidden' }, 403);
      return;
    }

    try {
      const formData = await parseFormBody(req);
      const { event, url, secret } = formData;

      if (!event || !url) {
        redirect(res, '/admin/webhooks/new?error=' + encodeURIComponent('Event and URL are required'));
        return;
      }

      // Validate URL
      try {
        new URL(url);
      } catch {
        redirect(res, '/admin/webhooks/new?error=' + encodeURIComponent('Invalid URL format'));
        return;
      }

      // Create webhook in content storage
      const webhook = await content.create('webhook', {
        event,
        url,
        secret: secret || null,
        enabled: true,
      });

      // Register with core webhook system
      webhooksCore.register(event, url, secret || null, webhook.id);

      redirect(res, '/admin/webhooks?success=' + encodeURIComponent('Webhook created'));

    } catch (error) {
      console.error('[webhooks] Create error:', error.message);
      redirect(res, '/admin/webhooks/new?error=' + encodeURIComponent(error.message));
    }
  }, 'Create webhook');

  /**
   * POST /admin/webhooks/:id/delete - Delete webhook
   */
  register('POST', '/admin/webhooks/:id/delete', async (req, res, params, ctx) => {
    if (!auth.hasRole(req.user, 'admin')) {
      server.json(res, { error: 'Forbidden' }, 403);
      return;
    }

    const { id } = params;

    // Remove from content storage
    const deleted = await content.remove('webhook', id);

    if (!deleted) {
      redirect(res, '/admin/webhooks?error=' + encodeURIComponent('Webhook not found'));
      return;
    }

    // Remove from core webhook system
    webhooksCore.remove(id);

    redirect(res, '/admin/webhooks?success=' + encodeURIComponent('Webhook deleted'));
  }, 'Delete webhook');

  /**
   * POST /admin/webhooks/:id/test - Test webhook
   */
  register('POST', '/admin/webhooks/:id/test', async (req, res, params, ctx) => {
    if (!auth.hasRole(req.user, 'admin')) {
      server.json(res, { error: 'Forbidden' }, 403);
      return;
    }

    const { id } = params;

    // Get webhook from storage
    const webhook = content.read('webhook', id);

    if (!webhook) {
      redirect(res, '/admin/webhooks?error=' + encodeURIComponent('Webhook not found'));
      return;
    }

    // Fire test webhook
    const result = await webhooksCore.test(webhook.url, webhook.secret);

    if (result.success) {
      redirect(res, '/admin/webhooks?success=' + encodeURIComponent(`Test successful (${result.status})`));
    } else {
      const errorMsg = result.error || `HTTP ${result.status}`;
      redirect(res, '/admin/webhooks?error=' + encodeURIComponent(`Test failed: ${errorMsg}`));
    }
  }, 'Test webhook');
}

/**
 * Middleware hook - protect webhook admin routes
 */
export function hook_middleware(use, context) {
  const auth = context.services.get('auth');

  // Note: /admin/* is already protected by users module
  // This middleware is for additional logging if needed
  use(async (req, res, ctx, next) => {
    // Just continue - main auth is handled by users module
    await next();
  }, 'webhooks', '/admin/webhooks');
}
