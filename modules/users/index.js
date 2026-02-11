/**
 * users/index.js - User Authentication Module
 *
 * This module provides:
 * - User content type (username, password hash, role, email, lastLogin)
 * - API token content type for programmatic access
 * - Login/logout routes
 * - Session-based authentication
 * - API token authentication
 * - Role-based access control (RBAC)
 * - Admin route protection via middleware
 * - User and token management pages
 * - RESTful API endpoints for content
 *
 * AUTHENTICATION METHODS:
 * =======================
 * 1. Session cookies (browser) - Set via /login
 * 2. API tokens (CLI/scripts) - Authorization: Bearer <token>
 *
 * ROLES AND PERMISSIONS:
 * ======================
 * - admin: Full access (wildcard *)
 * - editor: content.create, content.read, content.update, content.delete
 * - viewer: content.read only
 *
 * DEFAULT USERS:
 * ==============
 * On first boot (if no users exist), creates:
 * - admin / admin (role: admin)
 * - editor / editor (role: editor)
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

// Get the directory of this module for loading templates
const __dirname = dirname(fileURLToPath(import.meta.url));

// Valid roles for validation
const VALID_ROLES = ['admin', 'editor', 'viewer'];

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
 * Parse JSON body from request
 */
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
      }
    });

    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error('Invalid JSON'));
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
 * Validate email format
 * Returns true if email is valid or empty (email is optional)
 */
function isValidEmail(email) {
  if (!email || email.trim() === '') return true;
  // Basic email regex - checks for x@y.z format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Check if username is unique (excluding a specific user ID for edits)
 */
function isUsernameUnique(content, username, excludeId = null) {
  const users = content.list('user').items;
  return !users.some(u => u.username === username && u.id !== excludeId);
}

/**
 * Count admin users
 */
function countAdminUsers(content) {
  const users = content.list('user').items;
  return users.filter(u => u.role === 'admin').length;
}

/**
 * Boot hook - create default users if needed
 */
export async function hook_boot(context) {
  const content = context.services.get('content');
  const auth = context.services.get('auth');

  // Check if user content type exists
  if (!content.hasType('user')) {
    console.log('[users] User content type not yet registered, skipping default user check');
    return;
  }

  const usersResult = content.list('user');
  const users = usersResult.items || [];

  if (users.length === 0) {
    // Create default admin user
    const adminPassword = auth.hashPassword('admin');
    await content.create('user', {
      username: 'admin',
      password: adminPassword,
      role: 'admin',
      email: '',
      lastLogin: null,
    });
    console.log('[users] Created default admin user (username: admin, password: admin)');

    // Create default editor user
    const editorPassword = auth.hashPassword('editor');
    await content.create('user', {
      username: 'editor',
      password: editorPassword,
      role: 'editor',
      email: '',
      lastLogin: null,
    });
    console.log('[users] Created default editor user (username: editor, password: editor)');
  } else {
    console.log(`[users] Found ${users.length} existing user(s)`);
  }
}

/**
 * Content hook - register user and apitoken content types
 */
export function hook_content(register, context) {
  // User content type
  register('user', {
    username: { type: 'string', required: true },
    password: { type: 'string', required: true }, // Stored as hash
    role: { type: 'string', required: false },    // admin, editor, viewer
    email: { type: 'string', required: false },   // Optional email
    lastLogin: { type: 'string', required: false }, // ISO timestamp of last login
  });

  // API token content type
  register('apitoken', {
    userId: { type: 'string', required: true },
    token: { type: 'string', required: true },
    name: { type: 'string', required: true },     // e.g., "My CLI token"
  });
}

/**
 * CLI hook - register user management commands
 */
export function hook_cli(register, context) {
  const content = context.services.get('content');
  const auth = context.services.get('auth');

  /**
   * users:list - List all users with roles and last login
   */
  register('users:list', async (args, ctx) => {
    const users = content.list('user').items;

    if (users.length === 0) {
      console.log('No users found.');
      return;
    }

    console.log('Users:');
    for (const user of users) {
      const lastLogin = user.lastLogin
        ? user.lastLogin
        : 'never';
      console.log(`  ${user.username} (${user.role || 'editor'}) - last login: ${lastLogin}`);
    }
  }, 'List all users with roles and last login');

  /**
   * users:delete <username> - Delete a user
   */
  register('users:delete', async (args, ctx) => {
    const username = args[0];

    if (!username) {
      console.error('Usage: users:delete <username>');
      return;
    }

    const users = content.list('user').items;
    const user = users.find(u => u.username === username);

    if (!user) {
      console.error(`Error: User not found: ${username}`);
      return;
    }

    // Check if this is the last admin
    if (user.role === 'admin') {
      const adminCount = countAdminUsers(content);
      if (adminCount <= 1) {
        console.error('Error: Cannot delete the last admin user');
        return;
      }
    }

    // Delete the user
    await content.remove('user', user.id);

    // Also delete their API tokens
    const tokens = content.list('apitoken').items.filter(t => t.userId === user.id);
    for (const token of tokens) {
      await content.remove('apitoken', token.id);
    }

    console.log(`Deleted user: ${username}`);
  }, 'Delete a user (with safeguards)');

  /**
   * users:role <username> <role> - Change user role
   */
  register('users:role', async (args, ctx) => {
    const username = args[0];
    const newRole = args[1];

    if (!username || !newRole) {
      console.error('Usage: users:role <username> <role>');
      console.error('Valid roles: admin, editor, viewer');
      return;
    }

    if (!VALID_ROLES.includes(newRole)) {
      console.error(`Error: Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`);
      return;
    }

    const users = content.list('user').items;
    const user = users.find(u => u.username === username);

    if (!user) {
      console.error(`Error: User not found: ${username}`);
      return;
    }

    // Check if demoting last admin
    if (user.role === 'admin' && newRole !== 'admin') {
      const adminCount = countAdminUsers(content);
      if (adminCount <= 1) {
        console.error('Error: Cannot demote the last admin user');
        return;
      }
    }

    // Invalidate user's sessions when role changes
    const invalidated = auth.invalidateSessions(user.id);

    await content.update('user', user.id, { role: newRole });
    console.log(`Changed ${username} role to ${newRole}`);
    if (invalidated > 0) {
      console.log(`Invalidated ${invalidated} session(s)`);
    }
  }, 'Change user role (admin, editor, viewer)');

  /**
   * sessions:list - Show active sessions
   */
  register('sessions:list', async (args, ctx) => {
    const stats = auth.getSessionStats();
    const users = content.list('user').items;

    // Create username lookup map
    const usernames = new Map();
    for (const user of users) {
      usernames.set(user.id, user.username);
    }

    if (stats.size === 0) {
      console.log('No active sessions.');
      return;
    }

    console.log('Active sessions:');
    for (const [userId, data] of stats.entries()) {
      const username = usernames.get(userId) || userId;
      const lastActivity = new Date(data.lastActivity).toISOString();
      const sessionWord = data.count === 1 ? 'session' : 'sessions';
      console.log(`  ${username} - ${data.count} ${sessionWord} (last: ${lastActivity})`);
    }
  }, 'Show active sessions');

  /**
   * sessions:clear <username> - Invalidate all sessions for user
   */
  register('sessions:clear', async (args, ctx) => {
    const username = args[0];

    if (!username) {
      console.error('Usage: sessions:clear <username>');
      return;
    }

    const users = content.list('user').items;
    const user = users.find(u => u.username === username);

    if (!user) {
      console.error(`Error: User not found: ${username}`);
      return;
    }

    const cleared = auth.invalidateSessions(user.id);
    console.log(`Cleared ${cleared} session(s) for ${username}`);
  }, 'Invalidate all sessions for user');
}

/**
 * Middleware hook - protect admin routes with auth and permissions
 */
export function hook_middleware(use, context) {
  // Authentication middleware for /admin/*
  use(async (req, res, ctx, next) => {
    const auth = ctx.services.get('auth');
    const content = ctx.services.get('content');

    // Check session
    const session = auth.getSession(req);

    if (!session) {
      // No valid session - redirect to login
      res.writeHead(302, { Location: '/login' });
      res.end();
      return;
    }

    // Session valid - load user data
    const user = content.read('user', session.userId);

    if (!user) {
      // User no longer exists - destroy session and redirect
      auth.destroySession(res);
      res.writeHead(302, { Location: '/login?error=' + encodeURIComponent('Session expired') });
      res.end();
      return;
    }

    // Attach user and session to request for route handlers
    req.user = {
      id: user.id,
      username: user.username,
      role: user.role || 'editor',
      email: user.email || '',
      sessionId: session.sessionId,
    };

    // Check permissions based on path
    const url = req.url || '/';
    const path = url.split('?')[0];
    const method = req.method || 'GET';

    // /admin/users/* requires admin role
    if (path.startsWith('/admin/users')) {
      if (!auth.hasRole(req.user, 'admin')) {
        res.writeHead(403, { 'Content-Type': 'text/html' });
        res.end('<h1>403 Forbidden</h1><p>Admin access required.</p><p><a href="/admin">Back to Dashboard</a></p>');
        return;
      }
    }

    // /admin/content/* permission checks
    if (path.startsWith('/admin/content')) {
      // Check specific permissions based on action
      if (path.includes('/new') || (method === 'POST' && !path.includes('/delete'))) {
        if (!auth.hasPermission(req.user, 'content.create')) {
          res.writeHead(403, { 'Content-Type': 'text/html' });
          res.end('<h1>403 Forbidden</h1><p>Permission denied: content.create</p><p><a href="/admin">Back to Dashboard</a></p>');
          return;
        }
      } else if (path.includes('/edit')) {
        if (!auth.hasPermission(req.user, 'content.update')) {
          res.writeHead(403, { 'Content-Type': 'text/html' });
          res.end('<h1>403 Forbidden</h1><p>Permission denied: content.update</p><p><a href="/admin">Back to Dashboard</a></p>');
          return;
        }
      } else if (path.includes('/delete')) {
        if (!auth.hasPermission(req.user, 'content.delete')) {
          res.writeHead(403, { 'Content-Type': 'text/html' });
          res.end('<h1>403 Forbidden</h1><p>Permission denied: content.delete</p><p><a href="/admin">Back to Dashboard</a></p>');
          return;
        }
      } else {
        // Default: read permission for viewing
        if (!auth.hasPermission(req.user, 'content.read')) {
          res.writeHead(403, { 'Content-Type': 'text/html' });
          res.end('<h1>403 Forbidden</h1><p>Permission denied: content.read</p><p><a href="/admin">Back to Dashboard</a></p>');
          return;
        }
      }
    }

    // Continue to route handler
    await next();
  }, 'auth', '/admin');

  // API authentication middleware for /api/*
  use(async (req, res, ctx, next) => {
    const auth = ctx.services.get('auth');
    const content = ctx.services.get('content');
    const server = ctx.services.get('server');
    const path = (req.url || '/').split('?')[0];

    // Public API routes that don't require authentication
    const publicPaths = [
      '/api/consciousness/stats',
      '/api/consciousness/bridges',
      '/api/consciousness/featured',
      '/api/consciousness/connections',
      '/api/consciousness/personalities',
      '/api/consciousness/chat',
      '/api/consciousness/interpret',
      '/api/health',
      '/api/ai/health',
      '/api/ai/metrics',
    ];
    
    if (publicPaths.some(p => path.startsWith(p))) {
      await next();
      return;
    }

    // Check for authentication (session or token)
    const authInfo = auth.getAuthFromRequest(req);

    if (!authInfo) {
      server.json(res, {
        error: 'Unauthorized',
        message: 'API token required',
      }, 401);
      return;
    }

    // If using token, verify it exists in our token store
    if (authInfo.method === 'token') {
      const tokens = content.list('apitoken').items;
      const authHeader = req.headers.authorization;
      const tokenValue = authHeader.slice(7); // Remove 'Bearer '

      const validToken = tokens.find(t => t.token === tokenValue);
      if (!validToken) {
        server.json(res, {
          error: 'Unauthorized',
          message: 'Invalid or revoked token',
        }, 401);
        return;
      }
    }

    // Load user data
    const user = content.read('user', authInfo.userId);

    if (!user) {
      server.json(res, {
        error: 'Unauthorized',
        message: 'User not found',
      }, 401);
      return;
    }

    // Attach user to request
    req.user = {
      id: user.id,
      username: user.username,
      role: user.role || 'editor',
    };
    req.authMethod = authInfo.method;

    // Continue to route handler
    await next();
  }, 'api-auth', '/api');

  // API response caching middleware for GET /api/*
  // WHY SEPARATE MIDDLEWARE:
  // - Runs after authentication (only cache authenticated responses)
  // - Adds X-Cache header for cache debugging
  // - Uses shorter TTL for API responses (60s default)
  use(async (req, res, ctx, next) => {
    const cache = ctx.services.get('cache');
    const cacheConfig = ctx.config.site.cache || {};

    // Only cache GET requests
    if (req.method !== 'GET') {
      await next();
      return;
    }

    // Skip if caching disabled
    if (!cacheConfig.enabled) {
      await next();
      return;
    }

    const url = req.url || '/';
    const cacheKey = cache.apiKey('GET', url);

    // Check cache for existing response
    const cached = cache.get(cacheKey);
    if (cached) {
      // Cache hit - respond immediately
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.writeHead(cached.status || 200);
      res.end(cached.body);
      return;
    }

    // Cache miss - capture response for caching
    res.setHeader('X-Cache', 'MISS');

    // Store original end method
    const originalEnd = res.end.bind(res);
    let responseBody = '';

    // Override end to capture response
    res.end = function(data, encoding) {
      if (data) {
        responseBody = typeof data === 'string' ? data : data.toString();
      }

      // Cache the response (only successful responses)
      if (res.statusCode >= 200 && res.statusCode < 400) {
        const apiTtl = cacheConfig.apiTtl || 60;
        cache.set(cacheKey, {
          status: res.statusCode,
          body: responseBody,
        }, apiTtl);
      }

      // Call original end
      return originalEnd(data, encoding);
    };

    await next();
  }, 'api-cache', '/api');
}

/**
 * Routes hook - register authentication and API routes
 */
export function hook_routes(register, context) {
  const server = context.services.get('server');
  const content = context.services.get('content');
  const template = context.services.get('template');
  const auth = context.services.get('auth');

  /**
   * Render a page with layout
   */
  function renderPage(templateName, data, ctx, req) {
    const pageTemplate = loadTemplate(templateName);
    const csrfToken = req ? auth.getCSRFToken(req) : '';
    const pageContent = template.renderString(pageTemplate, { ...data, csrfToken });

    return template.renderWithLayout('layout.html', pageContent, {
      title: data.pageTitle || 'CMS',
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
   * Check API permission and return error if denied
   */
  function checkApiPermission(req, res, permission) {
    if (!auth.hasPermission(req.user, permission)) {
      server.json(res, {
        error: 'Forbidden',
        message: `Permission denied: ${permission}`,
      }, 403);
      return false;
    }
    return true;
  }

  /**
   * Format last login for display
   */
  function formatLastLogin(lastLogin) {
    if (!lastLogin) return 'Never';
    const date = new Date(lastLogin);
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // ==========================================
  // Public Routes (no auth required)
  // ==========================================

  /**
   * GET /login - Login form
   */
  register('GET', '/login', async (req, res, params, ctx) => {
    // If already logged in, redirect to admin
    const session = auth.getSession(req);
    if (session) {
      redirect(res, '/admin');
      return;
    }

    const flash = getFlashMessage(req.url);

    const html = renderPage('login.html', {
      pageTitle: 'Login',
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Login form');

  /**
   * POST /login - Process login
   */
  register('POST', '/login', async (req, res, params, ctx) => {
    try {
      const formData = await parseFormBody(req);
      const { username, password } = formData;

      if (!username || !password) {
        redirect(res, '/login?error=' + encodeURIComponent('Username and password required'));
        return;
      }

      // Find user by username
      const users = content.list('user').items;
      const user = users.find(u => u.username === username);

      if (!user) {
        redirect(res, '/login?error=' + encodeURIComponent('Invalid username or password'));
        return;
      }

      // Verify password
      if (!auth.verifyPassword(password, user.password)) {
        redirect(res, '/login?error=' + encodeURIComponent('Invalid username or password'));
        return;
      }

      // Update lastLogin timestamp
      await content.update('user', user.id, {
        lastLogin: new Date().toISOString(),
      });

      // Create session
      auth.createSession(res, user.id);

      // Redirect to admin
      redirect(res, '/admin');

    } catch (error) {
      console.error('[users] Login error:', error.message);
      redirect(res, '/login?error=' + encodeURIComponent('Login failed'));
    }
  }, 'Process login');

  /**
   * GET /logout - Logout and clear session
   */
  register('GET', '/logout', async (req, res, params, ctx) => {
    auth.destroySession(res);
    redirect(res, '/?success=' + encodeURIComponent('Logged out successfully'));
  }, 'Logout');

  // ==========================================
  // Admin Routes - User Management (admin only)
  // ==========================================

  /**
   * GET /admin/users - List all users
   */
  register('GET', '/admin/users', async (req, res, params, ctx) => {
    const adminCount = countAdminUsers(content);
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

    const users = content.list('user').items.map(user => {
      const lastLoginDate = user.lastLogin ? new Date(user.lastLogin).getTime() : 0;
      const noRecentLogin = !user.lastLogin || lastLoginDate < thirtyDaysAgo;

      return {
        id: user.id,
        username: user.username,
        role: user.role || 'editor',
        email: user.email || '',
        lastLogin: user.lastLogin || null,
        lastLoginFormatted: formatLastLogin(user.lastLogin),
        createdFormatted: new Date(user.created).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        }),
        isCurrent: user.id === req.user.id,
        isLastAdmin: user.role === 'admin' && adminCount <= 1,
        canDelete: user.id !== req.user.id && !(user.role === 'admin' && adminCount <= 1),
        noRecentLogin,
      };
    });

    const flash = getFlashMessage(req.url);

    const html = renderPage('users-list.html', {
      pageTitle: 'Users',
      users,
      hasUsers: users.length > 0,
      userCount: users.length,
      currentUser: req.user,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'List users');

  /**
   * GET /admin/users/new - Create user form
   */
  register('GET', '/admin/users/new', async (req, res, params, ctx) => {
    const flash = getFlashMessage(req.url);
    const roles = auth.getRoles();

    const html = renderPage('user-form.html', {
      pageTitle: 'Create User',
      isCreate: true,
      currentUser: req.user,
      roles,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Create user form');

  /**
   * POST /admin/users - Create user
   */
  register('POST', '/admin/users', async (req, res, params, ctx) => {
    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const { username, password, passwordConfirm, role, email } = formData;

      // Validation
      if (!username || !password) {
        redirect(res, '/admin/users/new?error=' + encodeURIComponent('Username and password required'));
        return;
      }

      if (password !== passwordConfirm) {
        redirect(res, '/admin/users/new?error=' + encodeURIComponent('Passwords do not match'));
        return;
      }

      if (!isUsernameUnique(content, username)) {
        redirect(res, '/admin/users/new?error=' + encodeURIComponent('Username already exists'));
        return;
      }

      if (!isValidEmail(email)) {
        redirect(res, '/admin/users/new?error=' + encodeURIComponent('Invalid email format'));
        return;
      }

      const userRole = role || 'editor';
      if (!VALID_ROLES.includes(userRole)) {
        redirect(res, '/admin/users/new?error=' + encodeURIComponent('Invalid role'));
        return;
      }

      // Hash password and create user
      const hashedPassword = auth.hashPassword(password);

      await content.create('user', {
        username,
        password: hashedPassword,
        role: userRole,
        email: email || '',
        lastLogin: null,
      });

      redirect(res, '/admin/users?success=' + encodeURIComponent('User created successfully'));

    } catch (error) {
      console.error('[users] Create user error:', error.message);
      redirect(res, '/admin/users/new?error=' + encodeURIComponent(error.message));
    }
  }, 'Create user');

  /**
   * GET /admin/users/:id/edit - Edit user form
   */
  register('GET', '/admin/users/:id/edit', async (req, res, params, ctx) => {
    const { id } = params;

    const user = content.read('user', id);
    if (!user) {
      redirect(res, '/admin/users?error=' + encodeURIComponent('User not found'));
      return;
    }

    const flash = getFlashMessage(req.url);
    const adminCount = countAdminUsers(content);

    const html = renderPage('user-edit.html', {
      pageTitle: `Edit User: ${user.username}`,
      user: {
        id: user.id,
        username: user.username,
        email: user.email || '',
        role: user.role || 'editor',
      },
      roles: VALID_ROLES.map(r => ({
        value: r,
        label: r.charAt(0).toUpperCase() + r.slice(1),
        selected: r === (user.role || 'editor'),
      })),
      isCurrent: user.id === req.user.id,
      isLastAdmin: user.role === 'admin' && adminCount <= 1,
      currentUser: req.user,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Edit user form');

  /**
   * POST /admin/users/:id - Update user
   */
  register('POST', '/admin/users/:id', async (req, res, params, ctx) => {
    const { id } = params;

    const user = content.read('user', id);
    if (!user) {
      redirect(res, '/admin/users?error=' + encodeURIComponent('User not found'));
      return;
    }

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const { username, email, role } = formData;

      // Validation
      if (!username) {
        redirect(res, `/admin/users/${id}/edit?error=` + encodeURIComponent('Username is required'));
        return;
      }

      if (!isUsernameUnique(content, username, id)) {
        redirect(res, `/admin/users/${id}/edit?error=` + encodeURIComponent('Username already exists'));
        return;
      }

      if (!isValidEmail(email)) {
        redirect(res, `/admin/users/${id}/edit?error=` + encodeURIComponent('Invalid email format'));
        return;
      }

      const newRole = role || user.role || 'editor';
      if (!VALID_ROLES.includes(newRole)) {
        redirect(res, `/admin/users/${id}/edit?error=` + encodeURIComponent('Invalid role'));
        return;
      }

      // Check if demoting last admin
      if (user.role === 'admin' && newRole !== 'admin') {
        const adminCount = countAdminUsers(content);
        if (adminCount <= 1) {
          redirect(res, `/admin/users/${id}/edit?error=` + encodeURIComponent('Cannot demote the last admin user'));
          return;
        }
      }

      // Check if role is changing
      const roleChanged = newRole !== (user.role || 'editor');
      const isSelf = id === req.user.id;

      await content.update('user', id, {
        username,
        email: email || '',
        role: newRole,
      });

      // Handle session invalidation on role change
      if (roleChanged) {
        if (isSelf) {
          // User changed their own role - destroy session and redirect to login
          auth.destroySession(res, req);
          redirect(res, '/login?success=' + encodeURIComponent('Your role has changed. Please log in again.'));
          return;
        } else {
          // Admin changed another user's role - invalidate their sessions
          auth.invalidateSessions(id);
        }
      }

      redirect(res, '/admin/users?success=' + encodeURIComponent('User updated successfully'));

    } catch (error) {
      console.error('[users] Update user error:', error.message);
      redirect(res, `/admin/users/${id}/edit?error=` + encodeURIComponent(error.message));
    }
  }, 'Update user');

  /**
   * POST /admin/users/:id/delete - Delete user
   */
  register('POST', '/admin/users/:id/delete', async (req, res, params, ctx) => {
    const { id } = params;

    const user = content.read('user', id);
    if (!user) {
      redirect(res, '/admin/users?error=' + encodeURIComponent('User not found'));
      return;
    }

    // Cannot delete yourself
    if (id === req.user.id) {
      redirect(res, '/admin/users?error=' + encodeURIComponent('Cannot delete your own account'));
      return;
    }

    // Cannot delete last admin
    if (user.role === 'admin') {
      const adminCount = countAdminUsers(content);
      if (adminCount <= 1) {
        redirect(res, '/admin/users?error=' + encodeURIComponent('Cannot delete the last admin user'));
        return;
      }
    }

    // Invalidate all sessions for the user before deletion
    auth.invalidateSessions(id);

    // Delete user and their tokens
    await content.remove('user', id);

    const tokens = content.list('apitoken').items.filter(t => t.userId === id);
    for (const token of tokens) {
      await content.remove('apitoken', token.id);
    }

    redirect(res, '/admin/users?success=' + encodeURIComponent(`Deleted user: ${user.username}`));
  }, 'Delete user');

  /**
   * GET /admin/users/:id/password - Change password form
   */
  register('GET', '/admin/users/:id/password', async (req, res, params, ctx) => {
    const { id } = params;

    const user = content.read('user', id);
    if (!user) {
      redirect(res, '/admin/users?error=' + encodeURIComponent('User not found'));
      return;
    }

    const flash = getFlashMessage(req.url);
    const isSelf = id === req.user.id;

    const html = renderPage('user-password.html', {
      pageTitle: `Change Password: ${user.username}`,
      user: {
        id: user.id,
        username: user.username,
      },
      isSelf,
      currentUser: req.user,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'Change password form');

  /**
   * POST /admin/users/:id/password - Change password
   */
  register('POST', '/admin/users/:id/password', async (req, res, params, ctx) => {
    const { id } = params;

    const user = content.read('user', id);
    if (!user) {
      redirect(res, '/admin/users?error=' + encodeURIComponent('User not found'));
      return;
    }

    try {
      const formData = ctx._parsedBody || await parseFormBody(req);
      const { currentPassword, newPassword, confirmPassword } = formData;

      const isSelf = id === req.user.id;

      // If changing own password, require current password
      if (isSelf) {
        if (!currentPassword) {
          redirect(res, `/admin/users/${id}/password?error=` + encodeURIComponent('Current password is required'));
          return;
        }

        if (!auth.verifyPassword(currentPassword, user.password)) {
          redirect(res, `/admin/users/${id}/password?error=` + encodeURIComponent('Current password is incorrect'));
          return;
        }
      }

      if (!newPassword) {
        redirect(res, `/admin/users/${id}/password?error=` + encodeURIComponent('New password is required'));
        return;
      }

      if (newPassword !== confirmPassword) {
        redirect(res, `/admin/users/${id}/password?error=` + encodeURIComponent('Passwords do not match'));
        return;
      }

      const hashedPassword = auth.hashPassword(newPassword);
      await content.update('user', id, { password: hashedPassword });

      // Invalidate other sessions for this user (keep current session if self)
      if (isSelf) {
        const invalidated = auth.invalidateOtherSessions(id, req.user.sessionId);
        if (invalidated > 0) {
          redirect(res, '/admin/users?success=' + encodeURIComponent(`Password changed. ${invalidated} other session(s) logged out.`));
          return;
        }
      } else {
        // Admin changing someone else's password - invalidate all their sessions
        auth.invalidateSessions(id);
      }

      redirect(res, '/admin/users?success=' + encodeURIComponent('Password changed successfully'));

    } catch (error) {
      console.error('[users] Change password error:', error.message);
      redirect(res, `/admin/users/${id}/password?error=` + encodeURIComponent(error.message));
    }
  }, 'Change password');

  // ==========================================
  // Admin Routes - API Token Management
  // ==========================================

  /**
   * GET /admin/users/:id/tokens - List user's API tokens
   */
  register('GET', '/admin/users/:id/tokens', async (req, res, params, ctx) => {
    const { id } = params;

    // Get user
    const user = content.read('user', id);
    if (!user) {
      redirect(res, '/admin/users?error=' + encodeURIComponent('User not found'));
      return;
    }

    // Get user's tokens
    const allTokens = content.list('apitoken').items;
    const userTokens = allTokens
      .filter(t => t.userId === id)
      .map(t => ({
        id: t.id,
        name: t.name,
        // Show only first/last 4 chars of token for security
        tokenPreview: t.token.substring(0, 8) + '...' + t.token.slice(-4),
        createdFormatted: new Date(t.created).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
      }));

    const flash = getFlashMessage(req.url);

    // Check for newly created token to display
    const urlObj = new URL(req.url, 'http://localhost');
    const newToken = urlObj.searchParams.get('newToken');

    const html = renderPage('tokens.html', {
      pageTitle: `API Tokens - ${user.username}`,
      user: { id: user.id, username: user.username },
      tokens: userTokens,
      hasTokens: userTokens.length > 0,
      tokenCount: userTokens.length,
      currentUser: req.user,
      newToken,
      hasNewToken: !!newToken,
      flash,
      hasFlash: !!flash,
    }, ctx, req);

    server.html(res, html);
  }, 'List user tokens');

  /**
   * POST /admin/users/:id/tokens - Create new API token
   */
  register('POST', '/admin/users/:id/tokens', async (req, res, params, ctx) => {
    const { id } = params;

    try {
      // Verify user exists
      const user = content.read('user', id);
      if (!user) {
        redirect(res, '/admin/users?error=' + encodeURIComponent('User not found'));
        return;
      }

      const formData = ctx._parsedBody || await parseFormBody(req);
      const { name } = formData;

      if (!name) {
        redirect(res, `/admin/users/${id}/tokens?error=` + encodeURIComponent('Token name required'));
        return;
      }

      // Generate token
      const token = auth.generateToken(id);

      // Store token in database
      await content.create('apitoken', {
        userId: id,
        token,
        name,
      });

      // Redirect with token shown once
      redirect(res, `/admin/users/${id}/tokens?success=` + encodeURIComponent('Token created') + '&newToken=' + encodeURIComponent(token));

    } catch (error) {
      console.error('[users] Create token error:', error.message);
      redirect(res, `/admin/users/${id}/tokens?error=` + encodeURIComponent(error.message));
    }
  }, 'Create API token');

  /**
   * POST /admin/users/:id/tokens/:tokenId/delete - Revoke token
   */
  register('POST', '/admin/users/:id/tokens/:tokenId/delete', async (req, res, params, ctx) => {
    const { id, tokenId } = params;

    // Verify token exists and belongs to user
    const token = content.read('apitoken', tokenId);

    if (!token || token.userId !== id) {
      redirect(res, `/admin/users/${id}/tokens?error=` + encodeURIComponent('Token not found'));
      return;
    }

    // Delete token
    await content.remove('apitoken', tokenId);

    redirect(res, `/admin/users/${id}/tokens?success=` + encodeURIComponent('Token revoked'));
  }, 'Revoke API token');

  // ==========================================
  // API Routes (token auth, JSON responses)
  // ==========================================

  /**
   * GET /api/content/:type - List content with filters (requires content.read)
   * Query params: ?page=1&limit=20&search=hello&sort=created&order=desc&field=value&field__gt=10
   */
  register('GET', '/api/content/:type', async (req, res, params, ctx) => {
    if (!checkApiPermission(req, res, 'content.read')) return;

    const { type } = params;

    if (!content.hasType(type)) {
      server.json(res, { error: 'Not Found', message: `Unknown content type: ${type}` }, 404);
      return;
    }

    // Parse query parameters including filters
    const url = new URL(req.url, 'http://localhost');
    const schema = content.getSchema(type);

    const options = {
      page: parseInt(url.searchParams.get('page')) || 1,
      limit: parseInt(url.searchParams.get('limit')) || 20,
      search: url.searchParams.get('search') || null,
      sortBy: url.searchParams.get('sort') || 'created',
      sortOrder: url.searchParams.get('order') || 'desc',
      filters: content.parseFiltersFromQuery(url.searchParams, schema),
    };

    const result = content.list(type, options);
    server.json(res, result);
  }, 'API: List content with filters');

  /**
   * GET /api/content/:type/:id - Get content item (requires content.read)
   */
  register('GET', '/api/content/:type/:id', async (req, res, params, ctx) => {
    if (!checkApiPermission(req, res, 'content.read')) return;

    const { type, id } = params;

    if (!content.hasType(type)) {
      server.json(res, { error: 'Not Found', message: `Unknown content type: ${type}` }, 404);
      return;
    }

    const item = content.read(type, id);

    if (!item) {
      server.json(res, { error: 'Not Found', message: `Content not found: ${type}/${id}` }, 404);
      return;
    }

    server.json(res, item);
  }, 'API: Get content item');

  /**
   * POST /api/content/:type - Create content (requires content.create)
   */
  register('POST', '/api/content/:type', async (req, res, params, ctx) => {
    if (!checkApiPermission(req, res, 'content.create')) return;

    const { type } = params;

    if (!content.hasType(type)) {
      server.json(res, { error: 'Not Found', message: `Unknown content type: ${type}` }, 404);
      return;
    }

    try {
      const data = await parseJsonBody(req);
      const item = await content.create(type, data);
      server.json(res, item, 201);
    } catch (error) {
      server.json(res, { error: 'Bad Request', message: error.message }, 400);
    }
  }, 'API: Create content');

  /**
   * PUT /api/content/:type/:id - Update content (requires content.update)
   */
  register('PUT', '/api/content/:type/:id', async (req, res, params, ctx) => {
    if (!checkApiPermission(req, res, 'content.update')) return;

    const { type, id } = params;

    if (!content.hasType(type)) {
      server.json(res, { error: 'Not Found', message: `Unknown content type: ${type}` }, 404);
      return;
    }

    try {
      const data = await parseJsonBody(req);
      const item = await content.update(type, id, data);

      if (!item) {
        server.json(res, { error: 'Not Found', message: `Content not found: ${type}/${id}` }, 404);
        return;
      }

      server.json(res, item);
    } catch (error) {
      server.json(res, { error: 'Bad Request', message: error.message }, 400);
    }
  }, 'API: Update content');

  /**
   * DELETE /api/content/:type/:id - Delete content (requires content.delete)
   */
  register('DELETE', '/api/content/:type/:id', async (req, res, params, ctx) => {
    if (!checkApiPermission(req, res, 'content.delete')) return;

    const { type, id } = params;

    if (!content.hasType(type)) {
      server.json(res, { error: 'Not Found', message: `Unknown content type: ${type}` }, 404);
      return;
    }

    const deleted = await content.remove(type, id);

    if (!deleted) {
      server.json(res, { error: 'Not Found', message: `Content not found: ${type}/${id}` }, 404);
      return;
    }

    server.json(res, { deleted: true, type, id });
  }, 'API: Delete content');
}
