/**
 * webhooks.js - Webhook Dispatch System
 *
 * WHY THIS EXISTS:
 * Webhooks allow external systems to be notified when content changes.
 * This enables:
 * - Build triggers (rebuild static site when content changes)
 * - Search index updates (reindex on content save)
 * - Notification systems (Slack/Discord messages)
 * - Third-party integrations (Zapier, IFTTT)
 *
 * DESIGN DECISIONS:
 * =================
 *
 * 1. ASYNC FIRE (non-blocking)
 *    Webhook requests are fired and forgotten. We don't wait for
 *    responses before returning to the caller. This prevents slow
 *    external services from blocking content operations.
 *
 * 2. OPTIONAL SIGNATURES
 *    Webhooks can include an HMAC-SHA256 signature in the
 *    X-Webhook-Signature header. This allows receivers to verify
 *    the request came from this CMS and wasn't tampered with.
 *
 * 3. SIMPLE RETRY (none)
 *    We don't retry failed webhooks. For production, you'd want
 *    a queue system with retry logic. This is intentionally simple.
 *
 * 4. LOGGING
 *    All webhook fires are logged with status for debugging.
 *    Success: "[webhook] Fired event → url (200)"
 *    Failure: "[webhook] Failed event → url (timeout)"
 */

import { createHmac } from 'node:crypto';
import { request } from 'node:http';
import { request as httpsRequest } from 'node:https';

/**
 * Webhook registry
 * Structure: { event: [{ url, secret, id }] }
 *
 * WHY GROUP BY EVENT:
 * - Fast lookup when firing events
 * - Multiple webhooks can listen to same event
 * - Easy to list all webhooks for an event
 */
const webhooks = {};

/**
 * Register a webhook
 *
 * @param {string} event - Event name (e.g., "content:afterCreate")
 * @param {string} url - URL to POST to when event fires
 * @param {string} secret - Optional secret for HMAC signing
 * @param {string} id - Optional ID for tracking (for removal)
 *
 * @example
 * register('content:afterCreate', 'https://example.com/hook', 'my-secret', 'hook-1');
 */
export function register(event, url, secret = null, id = null) {
  if (!webhooks[event]) {
    webhooks[event] = [];
  }

  webhooks[event].push({ url, secret, id });
}

/**
 * Remove a webhook by ID
 *
 * @param {string} id - Webhook ID to remove
 * @returns {boolean} - true if removed, false if not found
 */
export function remove(id) {
  let removed = false;

  for (const event of Object.keys(webhooks)) {
    const before = webhooks[event].length;
    webhooks[event] = webhooks[event].filter(w => w.id !== id);

    if (webhooks[event].length < before) {
      removed = true;
    }

    // Clean up empty event arrays
    if (webhooks[event].length === 0) {
      delete webhooks[event];
    }
  }

  return removed;
}

/**
 * Clear all webhooks for an event or all webhooks
 *
 * @param {string} event - Optional event to clear (clears all if not provided)
 */
export function clear(event = null) {
  if (event) {
    delete webhooks[event];
  } else {
    for (const key of Object.keys(webhooks)) {
      delete webhooks[key];
    }
  }
}

/**
 * List all registered webhooks
 *
 * @returns {Array<{event, url, id}>} - Array of webhook info (secrets hidden)
 */
export function list() {
  const result = [];

  for (const [event, hooks] of Object.entries(webhooks)) {
    for (const { url, id, secret } of hooks) {
      result.push({
        event,
        url,
        id,
        hasSecret: !!secret,
      });
    }
  }

  return result;
}

/**
 * Sign a payload with HMAC-SHA256
 *
 * @param {string} payload - JSON string to sign
 * @param {string} secret - Secret key for HMAC
 * @returns {string} - Hex-encoded signature
 *
 * WHY HMAC-SHA256:
 * - Industry standard for webhook signatures
 * - GitHub, Stripe, Slack all use similar schemes
 * - Fast and secure
 */
function signPayload(payload, secret) {
  return createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

/**
 * Fire webhooks for an event
 *
 * @param {string} event - Event name (e.g., "content:afterCreate")
 * @param {Object} payload - Data to send (will be JSON-stringified)
 *
 * WHAT HAPPENS:
 * 1. Find all webhooks registered for this event
 * 2. For each webhook:
 *    a. Stringify the payload
 *    b. If secret provided, generate HMAC signature
 *    c. POST to URL with JSON body
 *    d. Log success/failure
 *
 * WHY ASYNC (no await on requests):
 * - Don't block content operations on external services
 * - Slow webhooks shouldn't affect user experience
 * - Fire-and-forget pattern is simpler
 *
 * @example
 * fire('content:afterCreate', {
 *   event: 'content:afterCreate',
 *   type: 'greeting',
 *   item: { id: '123', name: 'Ernie' },
 *   timestamp: new Date().toISOString()
 * });
 */
export function fire(event, payload) {
  const hooks = webhooks[event] || [];

  if (hooks.length === 0) {
    return;
  }

  const body = JSON.stringify(payload);

  for (const { url, secret } of hooks) {
    // Fire each webhook asynchronously
    fireOne(event, url, body, secret);
  }
}

/**
 * Fire a single webhook (internal)
 *
 * @param {string} event - Event name (for logging)
 * @param {string} url - URL to POST to
 * @param {string} body - JSON body string
 * @param {string} secret - Optional secret for signing
 */
function fireOne(event, url, body, secret) {
  try {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const requester = isHttps ? httpsRequest : request;

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'User-Agent': 'CMS-Core-Webhook/1.0',
    };

    // Add signature if secret provided
    if (secret) {
      const signature = signPayload(body, secret);
      headers['X-Webhook-Signature'] = `sha256=${signature}`;
    }

    const options = {
      method: 'POST',
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      headers,
      timeout: 10000, // 10 second timeout
    };

    const req = requester(options, (res) => {
      // Consume response to free up socket
      res.resume();

      const status = res.statusCode;
      if (status >= 200 && status < 300) {
        console.log(`[webhook] Fired ${event} → ${url} (${status})`);
      } else {
        console.log(`[webhook] Failed ${event} → ${url} (${status})`);
      }
    });

    // Handle errors
    req.on('error', (error) => {
      console.log(`[webhook] Failed ${event} → ${url} (${error.message})`);
    });

    // Handle timeout
    req.on('timeout', () => {
      req.destroy();
      console.log(`[webhook] Failed ${event} → ${url} (timeout)`);
    });

    // Send the body
    req.write(body);
    req.end();

  } catch (error) {
    console.log(`[webhook] Failed ${event} → ${url} (${error.message})`);
  }
}

/**
 * Fire a test webhook
 *
 * @param {string} url - URL to test
 * @param {string} secret - Optional secret for signing
 * @returns {Promise<{success: boolean, status: number, error: string}>}
 *
 * WHY PROMISE (unlike fire):
 * - Test needs to wait for response
 * - User wants to see if webhook works
 * - One-off operation, blocking is fine
 */
export function test(url, secret = null) {
  return new Promise((resolve) => {
    const payload = {
      event: 'webhook:test',
      message: 'This is a test webhook from CMS Core',
      timestamp: new Date().toISOString(),
    };

    const body = JSON.stringify(payload);

    try {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === 'https:';
      const requester = isHttps ? httpsRequest : request;

      const headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'CMS-Core-Webhook/1.0',
      };

      if (secret) {
        const signature = signPayload(body, secret);
        headers['X-Webhook-Signature'] = `sha256=${signature}`;
      }

      const options = {
        method: 'POST',
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        headers,
        timeout: 10000,
      };

      const req = requester(options, (res) => {
        res.resume();
        const status = res.statusCode;
        resolve({
          success: status >= 200 && status < 300,
          status,
          error: null,
        });
      });

      req.on('error', (error) => {
        resolve({
          success: false,
          status: 0,
          error: error.message,
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          success: false,
          status: 0,
          error: 'timeout',
        });
      });

      req.write(body);
      req.end();

    } catch (error) {
      resolve({
        success: false,
        status: 0,
        error: error.message,
      });
    }
  });
}
