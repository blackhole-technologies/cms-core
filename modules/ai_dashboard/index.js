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
 * hook_boot - Initialize the AI dashboard module
 */
export function hook_boot(context) {
  console.log('[ai_dashboard] AI Dashboard module loaded');
}

/**
 * hook_routes - Register AI dashboard routes
 */
export function hook_routes(register, context) {
  const server = context.services.get('server');
  const template = context.services.get('template');
  const auth = context.services.get('auth');
  const aiRegistry = context.services.get('ai-registry');

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

    const html = renderAdmin('dashboard.html', {
      pageTitle: 'AI Dashboard',
      modules,
      stats,
      successMessage,
      errorMessage,
    }, ctx, req);

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });

  /**
   * POST /admin/ai/dashboard/action - Handle quick actions
   *
   * Actions: enable, disable, refresh
   */
  register('POST', '/admin/ai/dashboard/action', async (req, res, ctx) => {
    // Authentication is handled by users module middleware
    // CSRF validation is handled by admin module middleware

    // Verify CSRF token
    const csrfToken = auth.getCSRFToken(req);
    const formData = await parseFormBody(req);

    if (formData.csrf_token !== csrfToken) {
      return redirect(res, '/admin/ai/dashboard?error=' + encodeURIComponent('Invalid CSRF token'));
    }

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
          // Update module status to active
          module.status = 'active';
          return redirect(res, '/admin/ai/dashboard?success=' + encodeURIComponent(`Module "${moduleName}" enabled`));

        case 'disable':
          // Update module status to inactive
          module.status = 'inactive';
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
