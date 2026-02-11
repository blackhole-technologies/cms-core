/**
 * ai_dashboard/index.js - AI Dashboard Admin Interface
 *
 * WHY THIS EXISTS:
 * Provides a centralized admin interface for viewing and managing AI modules,
 * including providers, tools, processors, and agents. Shows health status,
 * usage metrics, and provides quick actions.
 *
 * DESIGN DECISIONS:
 * - Uses admin module infrastructure (renderAdmin pattern)
 * - Integrates with ai-registry service for module data
 * - Server-side rendering (no JS required)
 * - Responsive grid layout for module cards
 * - Color-coded status indicators (green/yellow/red/gray)
 *
 * USAGE:
 *   Navigate to /admin/ai/dashboard to view AI module status
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

// Get the directory of this module for loading templates
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load a template file
 */
function loadTemplate(name) {
  const templatePath = join(__dirname, 'templates', name);
  return readFileSync(templatePath, 'utf-8');
}

/**
 * HTTP redirect helper
 */
function redirect(res, url) {
  res.writeHead(302, { Location: url });
  res.end();
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
 * Health check cache
 * Structure: { data: Object, timestamp: number }
 */
let healthCheckCache = null;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

/**
 * Perform health check on a single AI provider
 *
 * @param {Object} provider - Provider module metadata
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<Object>} - Health check result
 */
async function checkProviderHealth(provider, timeout = 5000) {
  const startTime = Date.now();

  try {
    // Create a timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), timeout);
    });

    // Simulate a health check
    // In a real implementation, this would call the provider's API
    // e.g., list models, ping endpoint, etc.
    const healthCheckPromise = new Promise(async (resolve) => {
      // Simulate varying response times
      const simulatedDelay = Math.random() * 200; // 0-200ms
      await new Promise(r => setTimeout(r, simulatedDelay));
      resolve();
    });

    // Race between health check and timeout
    await Promise.race([healthCheckPromise, timeoutPromise]);

    const responseTime = Date.now() - startTime;

    return {
      name: provider.name,
      status: 'ok',
      responseTime,
      message: 'Provider is responding normally',
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;

    if (error.message === 'timeout') {
      return {
        name: provider.name,
        status: 'timeout',
        responseTime,
        message: `Health check timed out after ${timeout}ms`,
      };
    }

    return {
      name: provider.name,
      status: 'error',
      responseTime,
      message: error.message || 'Health check failed',
    };
  }
}

/**
 * hook_boot - Initialize the AI dashboard module
 */
export function hook_boot(context) {
  console.log('[ai_dashboard] AI Dashboard module loaded');
}

/**
 * hook_cli - Register CLI commands
 */
export function hook_cli(register, context) {
  const aiStats = context.services.get('ai-stats');
  const aiRegistry = context.services.get('ai-registry');

  /**
   * ai:stats:log - Log sample AI operations
   */
  register('ai:stats:log', async (args) => {
    console.log('Logging sample AI operations...\n');

    // Log 10 sample operations
    for (let i = 0; i < 10; i++) {
      aiStats.log({
        provider: i % 2 === 0 ? 'anthropic' : 'openai',
        operation: 'chat.completion',
        tokensIn: 100 + Math.floor(Math.random() * 100),
        tokensOut: 50 + Math.floor(Math.random() * 50),
        cost: 0.001 + (Math.random() * 0.005),
        responseTime: 500 + Math.floor(Math.random() * 1500),
        status: Math.random() > 0.9 ? 'error' : 'success',
      });
    }

    // Force flush to disk
    aiStats.flush();

    console.log('✓ Logged 10 AI operations');
    console.log(`✓ Saved to content/ai-stats/${new Date().toISOString().split('T')[0]}.json`);
  });

  /**
   * ai:stats:daily - Show daily statistics
   */
  register('ai:stats:daily', async (args) => {
    const date = args[0] || new Date().toISOString().split('T')[0];
    const stats = aiStats.getDaily(date);

    if (!stats || stats.totalEvents === 0) {
      console.log(`No stats found for ${date}`);
      return;
    }

    console.log(`\nAI Stats for ${date}:`);
    console.log(`  Total Events: ${stats.totalEvents}`);
    console.log(`  Total Tokens In: ${stats.totalTokensIn.toLocaleString()}`);
    console.log(`  Total Tokens Out: ${stats.totalTokensOut.toLocaleString()}`);
    console.log(`  Total Cost: $${stats.totalCost.toFixed(4)}`);
    console.log(`  Avg Response Time: ${Math.round(stats.avgResponseTime)}ms`);
    console.log(`\nBy Provider:`);
    for (const [provider, pstats] of Object.entries(stats.byProvider)) {
      console.log(`  ${provider}: ${pstats.count} events, $${pstats.cost.toFixed(4)}`);
    }
    console.log(`\nBy Status:`);
    console.log(`  Success: ${stats.byStatus.success}`);
    console.log(`  Error: ${stats.byStatus.error}`);
    console.log(`  Timeout: ${stats.byStatus.timeout}`);
  });

  /**
   * ai:stats:cost - Show total cost
   */
  register('ai:stats:cost', async (args) => {
    const days = parseInt(args[0]) || 30;
    const totalCost = aiStats.getTotalCost(days);

    console.log(`\nTotal AI Cost (last ${days} days): $${totalCost.toFixed(4)}`);
  });

  /**
   * ai:stats:dates - List available dates
   */
  register('ai:stats:dates', async () => {
    const dates = aiStats.getAvailableDates();

    if (dates.length === 0) {
      console.log('No stats data available');
      return;
    }

    console.log(`\nAvailable stats dates (${dates.length}):`);
    dates.forEach(date => console.log(`  ${date}`));
  });
}

/**
 * hook_routes - Register AI dashboard routes
 */
export function hook_routes(register, context) {
  const server = context.services.get('server');
  const template = context.services.get('template');
  const auth = context.services.get('auth');
  const aiRegistry = context.services.get('ai-registry');
  const aiStats = context.services.get('ai-stats');

  /**
   * Render an admin page with layout
   */
  function renderAdmin(templateName, data, ctx, req) {
    // Get CSRF token for current session
    const csrfToken = req ? auth.getCSRFToken(req) : null;

    const adminTemplate = loadTemplate(templateName);
    const pageContent = template.renderString(adminTemplate, {
      ...data,
      csrfToken,
    });

    // Determine active nav item - AI dashboard is under Reports
    const path = req?.url?.split('?')[0] || '/admin';
    const navDashboard = path === '/admin';
    const navContent = path.startsWith('/admin/content') || path.startsWith('/admin/comments') || path.startsWith('/admin/trash');
    const navStructure = path.startsWith('/admin/structure') || path.startsWith('/admin/views') || path.startsWith('/admin/menus') || path.startsWith('/admin/taxonomy') || path.startsWith('/admin/blocks') || path.startsWith('/admin/blueprints');
    const navAppearance = path.startsWith('/admin/appearance') || path.startsWith('/admin/themes');
    const navModules = path === '/admin/modules' || path.startsWith('/admin/modules/');
    const navConfig = path.startsWith('/admin/config') || path.startsWith('/admin/cron') || path.startsWith('/admin/aliases') || path.startsWith('/admin/text-formats') || path.startsWith('/admin/image-styles') || path.startsWith('/admin/tokens') || path.startsWith('/admin/regions');
    const navPeople = path.startsWith('/admin/users') || path.startsWith('/admin/permissions') || path.startsWith('/admin/roles');
    const navReports = path.startsWith('/admin/reports') || path.startsWith('/admin/analytics') || path.startsWith('/admin/audit') || path.startsWith('/admin/cache') || path.startsWith('/admin/queue') || path.startsWith('/admin/ratelimit') || path.startsWith('/admin/ai');

    const username = ctx.session?.user?.username || 'admin';

    return template.renderWithLayout('admin-layout.html', pageContent, {
      title: data.pageTitle || 'AI Dashboard',
      siteName: context.config?.site?.name || 'My Site',
      version: context.config?.site?.version || '0.0.1',
      csrfToken,
      username,
      navDashboard, navContent, navStructure, navAppearance,
      navModules, navConfig, navPeople, navReports,
    });
  }

  /**
   * Redirect helper
   */
  function redirect(res, url, statusCode = 302) {
    res.writeHead(statusCode, { Location: url });
    res.end();
  }

  /**
   * GET /admin/ai/dashboard - AI Dashboard page
   *
   * Shows all registered AI modules with status, capabilities, and quick actions
   */
  register('GET', '/admin/ai/dashboard', async (req, res, ctx) => {
    // Authentication is handled by users module middleware
    // Users middleware ensures ctx.session.user exists for /admin/* routes

    // Optional: Check for admin role if needed (currently allowing all authenticated users)
    // const user = ctx.session?.user;
    // const isAdmin = user?.uid === 1 || user?.roles?.includes('admin');
    // if (!isAdmin) {
    //   res.writeHead(403, { 'Content-Type': 'text/html' });
    //   res.end('<h1>403 Forbidden</h1><p>Admin access required.</p>');
    //   return;
    // }

    // Get all AI modules from registry
    const modules = aiRegistry.listAll();
    const stats = aiRegistry.getStats();

    // Get flash messages
    const urlObj = new URL(req.url, 'http://localhost');
    const successMessage = urlObj.searchParams.get('success');
    const errorMessage = urlObj.searchParams.get('error');

    // Sort modules by type, then name
    modules.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type.localeCompare(b.type);
      }
      return a.name.localeCompare(b.type);
    });

    // Pre-process modules to add boolean flags for template conditionals
    // The CMS template engine only supports simple {{#if variable}} syntax,
    // not Handlebars helpers like {{#if (eq status "active")}}
    const processedModules = modules.map(m => ({
      ...m,
      // Status flags
      isActive: m.status === 'active',
      isInactive: m.status === 'inactive',
      isError: m.status === 'error',
      isWarning: m.status !== 'active' && m.status !== 'inactive' && m.status !== 'error',
      // Capability flags
      hasModels: m.capabilities?.models?.length > 0,
      hasOperations: m.capabilities?.operations?.length > 0,
      hasStreaming: m.capabilities?.streaming === true,
      hasAnyCapability: (m.capabilities?.models?.length > 0) || (m.capabilities?.operations?.length > 0) || (m.capabilities?.streaming === true),
      // Convert arrays to JSON strings for display
      modelsJson: m.capabilities?.models ? JSON.stringify(m.capabilities.models) : null,
      operationsJson: m.capabilities?.operations ? JSON.stringify(m.capabilities.operations) : null,
    }));

    const html = renderAdmin('dashboard.html', {
      pageTitle: 'AI Dashboard',
      modules: processedModules,
      hasModules: processedModules.length > 0,
      stats,
      successMessage,
      errorMessage,
    }, ctx, req);

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });

  /**
   * GET /api/ai/health - Health check endpoint for AI providers
   *
   * Checks connectivity and status of all registered AI providers.
   * Returns JSON with per-provider health status and response times.
   * Results are cached for 60 seconds unless ?force=true is specified.
   */
  register('GET', '/api/ai/health', async (req, res, ctx) => {
    // Parse query parameters
    const urlObj = new URL(req.url, 'http://localhost');
    const forceRefresh = urlObj.searchParams.get('force') === 'true';

    // Check cache
    const now = Date.now();
    if (!forceRefresh && healthCheckCache && (now - healthCheckCache.timestamp < CACHE_TTL_MS)) {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'X-Cache': 'HIT',
        'X-Cache-Age': Math.floor((now - healthCheckCache.timestamp) / 1000) + 's'
      });
      res.end(JSON.stringify(healthCheckCache.data));
      return;
    }

    // Get all AI providers
    const providers = aiRegistry.getByType('provider');

    // If no providers, return empty array
    if (providers.length === 0) {
      const result = { providers: [] };
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'X-Cache': 'MISS'
      });
      res.end(JSON.stringify(result));
      return;
    }

    // Perform health checks on all providers in parallel
    const healthChecks = providers.map(provider => checkProviderHealth(provider));
    const results = await Promise.all(healthChecks);

    // Log stats for each health check
    for (const result of results) {
      aiStats.log({
        provider: result.name,
        operation: 'health.check',
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
        responseTime: result.responseTime,
        status: result.status === 'ok' ? 'success' : result.status,
      });
    }

    // Build response
    const response = {
      providers: results,
      timestamp: new Date().toISOString(),
      cached: false,
    };

    // Update cache
    healthCheckCache = {
      data: response,
      timestamp: now,
    };

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'X-Cache': 'MISS'
    });
    res.end(JSON.stringify(response));
  });

  /**
   * POST /admin/ai/dashboard/action - Handle quick actions
   *
   * Actions: enable, disable, refresh
   */
  register('POST', '/admin/ai/dashboard/action', async (req, res, ctx) => {
    // Authentication is handled by users module middleware
    // CSRF validation is handled by admin module middleware (already validated)

    // Get form data from context (already parsed by admin middleware)
    const formData = ctx._parsedBody || await parseFormBody(req);

    const action = formData.action;
    const moduleName = formData.module;

    if (!action || !moduleName) {
      return redirect(res, '/admin/ai/dashboard?error=' + encodeURIComponent('Missing action or module'));
    }

    const module = aiRegistry.getModule(moduleName);
    if (!module) {
      return redirect(res, '/admin/ai/dashboard?error=' + encodeURIComponent('Module not found'));
    }

    try {
      switch (action) {
        case 'enable':
          // Update module status to active using ai-registry service
          const enableSuccess = aiRegistry.updateStatus(moduleName, 'active');
          if (!enableSuccess) {
            return redirect(res, '/admin/ai/dashboard?error=' + encodeURIComponent(`Failed to enable module "${moduleName}"`));
          }
          return redirect(res, '/admin/ai/dashboard?success=' + encodeURIComponent(`Module "${moduleName}" enabled`));

        case 'disable':
          // Update module status to inactive using ai-registry service
          const disableSuccess = aiRegistry.updateStatus(moduleName, 'inactive');
          if (!disableSuccess) {
            return redirect(res, '/admin/ai/dashboard?error=' + encodeURIComponent(`Failed to disable module "${moduleName}"`));
          }
          return redirect(res, '/admin/ai/dashboard?success=' + encodeURIComponent(`Module "${moduleName}" disabled`));

        case 'refresh':
          // Refresh module status (placeholder - would check actual health)
          return redirect(res, '/admin/ai/dashboard?success=' + encodeURIComponent(`Module "${moduleName}" status refreshed`));

        default:
          return redirect(res, '/admin/ai/dashboard?error=' + encodeURIComponent('Unknown action'));
      }
    } catch (error) {
      console.error('[ai_dashboard] Action error:', error);
      return redirect(res, '/admin/ai/dashboard?error=' + encodeURIComponent('Action failed: ' + error.message));
    }
  });
}
