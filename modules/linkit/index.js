/**
 * Linkit Module - Link Autocomplete Service
 *
 * WHY THIS EXISTS:
 * ================
 * Content editors need an easy way to link to internal content without remembering
 * exact URLs or IDs. This module provides autocomplete suggestions for content,
 * media, and users as they type in WYSIWYG editors or link fields.
 *
 * FEATURES:
 * =========
 * - Fuzzy search across content, media, and user entities
 * - Relevance-based ranking (exact matches score higher)
 * - Entity type filtering (search only content, only media, etc.)
 * - Returns structured results with title, type, URL, metadata
 * - Integrates with existing content/media/users services
 * - API endpoint for autocomplete: GET /api/linkit/autocomplete?q=query&types=content,media
 *
 * ARCHITECTURE:
 * =============
 * - Core matcher service with pluggable entity-specific matchers
 * - Each matcher (content, media, users) implements custom search logic
 * - Scoring algorithm ranks results by relevance
 * - RESTful API endpoint for client-side integration
 *
 * USAGE:
 * ======
 * API Request:
 *   GET /api/linkit/autocomplete?q=hello&types=content
 *
 * API Response:
 *   [
 *     {
 *       "id": "abc123",
 *       "title": "Hello World Post",
 *       "type": "content",
 *       "entityType": "post",
 *       "url": "/content/post/abc123",
 *       "metadata": { "created": "2024-01-15T..." }
 *     }
 *   ]
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync } from 'node:fs';

// Get the directory of this module
const __dirname = dirname(fileURLToPath(import.meta.url));

// Module state
let services = null;
let initialized = false;

// Profile storage paths
const PROFILES_DIR = '/Users/Alchemy/Projects/experiments/cms-core/content/linkit-profiles';
const getProfilePath = (id) => join(PROFILES_DIR, `${id}.json`);

/**
 * Load matcher modules
 */
let contentMatcher = null;
let mediaMatcher = null;
let userMatcher = null;

/**
 * Boot hook - initializes the linkit service
 */
export async function hook_boot(context) {
  services = context.services;

  // Lazy-load matchers
  const { default: ContentMatcher } = await import('./matchers/content-matcher.js');
  const { default: MediaMatcher } = await import('./matchers/media-matcher.js');
  const { default: UserMatcher } = await import('./matchers/user-matcher.js');

  contentMatcher = new ContentMatcher(services);
  mediaMatcher = new MediaMatcher(services);
  userMatcher = new UserMatcher(services);

  // Ensure default profile exists
  ensureDefaultProfile();

  console.log('[linkit] Link autocomplete service initialized');
}

/**
 * Routes hook - registers API endpoints
 */
export async function hook_routes(register, context) {
  const server = context.services?.get('server');

  if (!server) {
    console.warn('[linkit] Server service not available, skipping routes');
    return;
  }

  // Autocomplete API endpoint
  register('GET', '/api/linkit/autocomplete', async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const query = url.searchParams.get('q') || '';
      const typesParam = url.searchParams.get('types') || 'content,media,user';
      const types = typesParam.split(',').map(t => t.trim());

      // Validate query
      if (!query || query.length < 2) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([]));
        return;
      }

      // Search across requested entity types
      const results = await search(query, types);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(results));
    } catch (error) {
      console.error('[linkit] Autocomplete error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  });

  // Demo page route
  register('GET', '/linkit/demo', async (req, res) => {
    try {
      const html = loadTemplate('demo.html');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Demo page not found');
    }
  });

  // WYSIWYG integration demo route
  register('GET', '/linkit/wysiwyg', async (req, res) => {
    try {
      const html = loadTemplate('wysiwyg-demo.html');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('WYSIWYG demo page not found');
    }
  });

  // ============================================================================
  // PROFILE ADMIN ROUTES
  // ============================================================================

  // List all profiles
  register('GET', '/admin/linkit/profiles', async (req, res) => {
    try {
      const profiles = getAllProfiles();
      const html = renderProfilesListPage(profiles);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (error) {
      console.error('[linkit] Error listing profiles:', error);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal server error');
    }
  });

  // New profile form
  register('GET', '/admin/linkit/profiles/new', async (req, res) => {
    try {
      // Get CSRF token from auth service
      const auth = context.services?.get('auth');
      const csrfToken = auth ? auth.getCSRFToken(req) : '';

      const html = renderProfileFormPage(null, csrfToken);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (error) {
      console.error('[linkit] Error rendering new profile form:', error);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal server error');
    }
  });

  // Edit profile form
  register('GET', '/admin/linkit/profiles/:id/edit', async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const id = url.pathname.split('/')[4]; // Extract ID from path
      const profile = getProfile(id);

      if (!profile) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Profile not found');
        return;
      }

      // Get CSRF token from auth service
      const auth = context.services?.get('auth');
      const csrfToken = auth ? auth.getCSRFToken(req) : '';

      const html = renderProfileFormPage(profile, csrfToken);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (error) {
      console.error('[linkit] Error rendering edit profile form:', error);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal server error');
    }
  });

  // Create profile (POST)
  register('POST', '/admin/linkit/profiles', async (req, res) => {
    try {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const profile = createProfile(data);
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(profile));
        } catch (error) {
          console.error('[linkit] Error creating profile:', error);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid request data' }));
        }
      });
    } catch (error) {
      console.error('[linkit] Error in create profile handler:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  });

  // Update profile (PUT)
  register('PUT', '/admin/linkit/profiles/:id', async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const id = url.pathname.split('/')[4]; // Extract ID from path

      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const profile = updateProfile(id, data);

          if (!profile) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Profile not found' }));
            return;
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(profile));
        } catch (error) {
          console.error('[linkit] Error updating profile:', error);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid request data' }));
        }
      });
    } catch (error) {
      console.error('[linkit] Error in update profile handler:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  });

  // Delete profile (DELETE)
  register('DELETE', '/admin/linkit/profiles/:id', async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const id = url.pathname.split('/')[4]; // Extract ID from path

      const success = deleteProfile(id);

      if (!success) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Profile not found' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Profile deleted' }));
    } catch (error) {
      console.error('[linkit] Error deleting profile:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  });

  console.log('[linkit] Registered routes: /api/linkit/autocomplete, /linkit/demo, /linkit/wysiwyg, /admin/linkit/profiles');
}

/**
 * Load a template file from this module's templates directory
 */
function loadTemplate(name) {
  const templatePath = join(__dirname, 'templates', name);
  return readFileSync(templatePath, 'utf-8');
}

/**
 * ============================================================================
 * ADMIN UI RENDERING
 * ============================================================================
 */

/**
 * Render the profiles list page
 */
function renderProfilesListPage(profiles) {
  const profileRows = profiles.map(p => `
    <tr>
      <td><strong>${escapeHtml(p.name)}</strong></td>
      <td><code>${escapeHtml(p.id)}</code></td>
      <td>${p.entity_types.join(', ')}</td>
      <td>${Object.keys(p.matchers).filter(k => p.matchers[k].enabled).length} enabled</td>
      <td>${new Date(p.updated).toLocaleString()}</td>
      <td>
        <a href="/admin/linkit/profiles/${p.id}/edit" class="btn btn-sm">Edit</a>
        <button onclick="deleteProfile('${p.id}')" class="btn btn-sm btn-danger">Delete</button>
      </td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Linkit Profiles - CMS Admin</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f5f5f5; padding: 20px; }
    .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { font-size: 28px; margin-bottom: 10px; color: #333; }
    .breadcrumb { color: #666; font-size: 14px; margin-bottom: 20px; }
    .breadcrumb a { color: #0066cc; text-decoration: none; }
    .breadcrumb a:hover { text-decoration: underline; }
    .header-actions { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    .btn { display: inline-block; padding: 8px 16px; background: #0066cc; color: white; text-decoration: none; border-radius: 4px; border: none; cursor: pointer; font-size: 14px; }
    .btn:hover { background: #0052a3; }
    .btn-sm { padding: 6px 12px; font-size: 13px; }
    .btn-danger { background: #dc3545; }
    .btn-danger:hover { background: #c82333; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e0e0e0; }
    th { background: #f8f9fa; font-weight: 600; color: #555; }
    tr:hover { background: #f8f9fa; }
    .empty-state { text-align: center; padding: 60px 20px; color: #666; }
    .empty-state-icon { font-size: 48px; margin-bottom: 20px; opacity: 0.3; }
  </style>
</head>
<body>
  <div class="container">
    <div class="breadcrumb">
      <a href="/admin">Admin</a> / <a href="/admin/config">Configuration</a> / Linkit Profiles
    </div>

    <div class="header-actions">
      <h1>Linkit Profiles</h1>
      <a href="/admin/linkit/profiles/new" class="btn">+ Create Profile</a>
    </div>

    ${profiles.length === 0 ? `
      <div class="empty-state">
        <div class="empty-state-icon">🔗</div>
        <h2>No profiles yet</h2>
        <p>Create your first linkit profile to configure link autocomplete behavior.</p>
        <br>
        <a href="/admin/linkit/profiles/new" class="btn">Create Profile</a>
      </div>
    ` : `
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>ID</th>
            <th>Entity Types</th>
            <th>Matchers</th>
            <th>Last Updated</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${profileRows}
        </tbody>
      </table>
    `}
  </div>

  <script>
    async function deleteProfile(id) {
      if (!confirm('Are you sure you want to delete this profile?')) return;

      try {
        const res = await fetch(\`/admin/linkit/profiles/\${id}\`, { method: 'DELETE' });
        if (res.ok) {
          location.reload();
        } else {
          alert('Failed to delete profile');
        }
      } catch (error) {
        console.error('Delete error:', error);
        alert('Error deleting profile');
      }
    }
  </script>
</body>
</html>`;
}

/**
 * Render the profile form page (create or edit)
 */
function renderProfileFormPage(profile, csrfToken = '') {
  const isEdit = !!profile;
  const title = isEdit ? `Edit Profile: ${profile.name}` : 'Create Profile';
  const submitUrl = isEdit ? `/admin/linkit/profiles/${profile.id}` : '/admin/linkit/profiles';
  const method = isEdit ? 'PUT' : 'POST';

  const data = profile || {
    name: '',
    description: '',
    entity_types: ['content', 'media', 'user'],
    matchers: {
      content: { enabled: true, maxResults: 10, minSearchLength: 2 },
      media: { enabled: true, maxResults: 10, minSearchLength: 2 },
      user: { enabled: true, maxResults: 10, minSearchLength: 2 }
    },
    permissions: { roles: ['authenticated'] }
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="csrf-token" content="${escapeHtml(csrfToken)}">
  <title>${title} - CMS Admin</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f5f5f5; padding: 20px; }
    .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { font-size: 28px; margin-bottom: 10px; color: #333; }
    .breadcrumb { color: #666; font-size: 14px; margin-bottom: 20px; }
    .breadcrumb a { color: #0066cc; text-decoration: none; }
    .breadcrumb a:hover { text-decoration: underline; }
    .form-group { margin-bottom: 20px; }
    label { display: block; font-weight: 600; margin-bottom: 8px; color: #333; font-size: 14px; }
    input[type="text"], textarea { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; font-family: inherit; }
    textarea { resize: vertical; min-height: 80px; }
    .checkbox-group { display: flex; flex-direction: column; gap: 8px; }
    .checkbox-item { display: flex; align-items: center; gap: 8px; }
    .checkbox-item input[type="checkbox"] { width: auto; }
    .matcher-config { border: 1px solid #ddd; border-radius: 4px; padding: 15px; margin-bottom: 15px; background: #f8f9fa; }
    .matcher-config h3 { font-size: 16px; margin-bottom: 10px; color: #555; }
    .matcher-settings { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 10px; }
    .matcher-settings input[type="number"] { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
    .form-actions { display: flex; gap: 10px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; }
    .btn { padding: 10px 20px; background: #0066cc; color: white; text-decoration: none; border-radius: 4px; border: none; cursor: pointer; font-size: 14px; }
    .btn:hover { background: #0052a3; }
    .btn-secondary { background: #6c757d; }
    .btn-secondary:hover { background: #5a6268; }
    .help-text { font-size: 13px; color: #666; margin-top: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="breadcrumb">
      <a href="/admin">Admin</a> / <a href="/admin/config">Configuration</a> / <a href="/admin/linkit/profiles">Linkit Profiles</a> / ${isEdit ? 'Edit' : 'New'}
    </div>

    <h1>${title}</h1>

    <form id="profileForm" onsubmit="return handleSubmit(event)">
      <!-- Basic Information -->
      <div class="form-group">
        <label for="name">Profile Name *</label>
        <input type="text" id="name" name="name" value="${escapeHtml(data.name)}" required>
        <div class="help-text">A descriptive name for this profile</div>
      </div>

      <div class="form-group">
        <label for="description">Description</label>
        <textarea id="description" name="description">${escapeHtml(data.description)}</textarea>
        <div class="help-text">Optional description of when to use this profile</div>
      </div>

      <!-- Entity Types -->
      <div class="form-group">
        <label>Entity Types</label>
        <div class="checkbox-group">
          <div class="checkbox-item">
            <input type="checkbox" id="type_content" value="content" ${data.entity_types.includes('content') ? 'checked' : ''}>
            <label for="type_content">Content (articles, pages, etc.)</label>
          </div>
          <div class="checkbox-item">
            <input type="checkbox" id="type_media" value="media" ${data.entity_types.includes('media') ? 'checked' : ''}>
            <label for="type_media">Media (images, files, etc.)</label>
          </div>
          <div class="checkbox-item">
            <input type="checkbox" id="type_user" value="user" ${data.entity_types.includes('user') ? 'checked' : ''}>
            <label for="type_user">Users</label>
          </div>
        </div>
        <div class="help-text">Select which entity types should appear in autocomplete</div>
      </div>

      <!-- Matcher Configuration -->
      <div class="form-group">
        <label>Matcher Settings</label>

        <div class="matcher-config">
          <div style="display: flex; align-items: center; gap: 10px;">
            <input type="checkbox" id="matcher_content_enabled" ${data.matchers.content?.enabled ? 'checked' : ''}>
            <h3 style="margin: 0;">Content Matcher</h3>
          </div>
          <div class="matcher-settings">
            <div>
              <label style="font-size: 12px;">Max Results</label>
              <input type="number" id="matcher_content_maxResults" value="${data.matchers.content?.maxResults || 10}" min="1" max="50">
            </div>
            <div>
              <label style="font-size: 12px;">Min Search Length</label>
              <input type="number" id="matcher_content_minSearchLength" value="${data.matchers.content?.minSearchLength || 2}" min="1" max="10">
            </div>
          </div>
        </div>

        <div class="matcher-config">
          <div style="display: flex; align-items: center; gap: 10px;">
            <input type="checkbox" id="matcher_media_enabled" ${data.matchers.media?.enabled ? 'checked' : ''}>
            <h3 style="margin: 0;">Media Matcher</h3>
          </div>
          <div class="matcher-settings">
            <div>
              <label style="font-size: 12px;">Max Results</label>
              <input type="number" id="matcher_media_maxResults" value="${data.matchers.media?.maxResults || 10}" min="1" max="50">
            </div>
            <div>
              <label style="font-size: 12px;">Min Search Length</label>
              <input type="number" id="matcher_media_minSearchLength" value="${data.matchers.media?.minSearchLength || 2}" min="1" max="10">
            </div>
          </div>
        </div>

        <div class="matcher-config">
          <div style="display: flex; align-items: center; gap: 10px;">
            <input type="checkbox" id="matcher_user_enabled" ${data.matchers.user?.enabled ? 'checked' : ''}>
            <h3 style="margin: 0;">User Matcher</h3>
          </div>
          <div class="matcher-settings">
            <div>
              <label style="font-size: 12px;">Max Results</label>
              <input type="number" id="matcher_user_maxResults" value="${data.matchers.user?.maxResults || 10}" min="1" max="50">
            </div>
            <div>
              <label style="font-size: 12px;">Min Search Length</label>
              <input type="number" id="matcher_user_minSearchLength" value="${data.matchers.user?.minSearchLength || 2}" min="1" max="10">
            </div>
          </div>
        </div>
      </div>

      <!-- Permissions -->
      <div class="form-group">
        <label for="roles">Allowed Roles (comma-separated)</label>
        <input type="text" id="roles" name="roles" value="${data.permissions.roles.join(', ')}">
        <div class="help-text">User roles that can use this profile (e.g., authenticated, editor, admin)</div>
      </div>

      <!-- Form Actions -->
      <div class="form-actions">
        <button type="submit" class="btn">${isEdit ? 'Update Profile' : 'Create Profile'}</button>
        <a href="/admin/linkit/profiles" class="btn btn-secondary">Cancel</a>
      </div>
    </form>
  </div>

  <script>
    async function handleSubmit(event) {
      event.preventDefault();

      // Get CSRF token from meta tag
      const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');

      const formData = {
        name: document.getElementById('name').value,
        description: document.getElementById('description').value,
        entity_types: ['content', 'media', 'user'].filter(type =>
          document.getElementById('type_' + type).checked
        ),
        matchers: {
          content: {
            enabled: document.getElementById('matcher_content_enabled').checked,
            maxResults: parseInt(document.getElementById('matcher_content_maxResults').value),
            minSearchLength: parseInt(document.getElementById('matcher_content_minSearchLength').value)
          },
          media: {
            enabled: document.getElementById('matcher_media_enabled').checked,
            maxResults: parseInt(document.getElementById('matcher_media_maxResults').value),
            minSearchLength: parseInt(document.getElementById('matcher_media_minSearchLength').value)
          },
          user: {
            enabled: document.getElementById('matcher_user_enabled').checked,
            maxResults: parseInt(document.getElementById('matcher_user_maxResults').value),
            minSearchLength: parseInt(document.getElementById('matcher_user_minSearchLength').value)
          }
        },
        permissions: {
          roles: document.getElementById('roles').value.split(',').map(r => r.trim()).filter(r => r)
        }
      };

      try {
        const headers = {
          'Content-Type': 'application/json'
        };

        // Add CSRF token if available
        if (csrfToken) {
          headers['X-CSRF-Token'] = csrfToken;
        }

        const res = await fetch(\`${submitUrl}\`, {
          method: \`${method}\`,
          headers: headers,
          body: JSON.stringify(formData)
        });

        if (res.ok) {
          window.location.href = '/admin/linkit/profiles';
        } else {
          const error = await res.json();
          alert('Error: ' + (error.error || 'Failed to save profile'));
        }
      } catch (error) {
        console.error('Submit error:', error);
        alert('Error saving profile');
      }

      return false;
    }
  </script>
</body>
</html>`;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Core search function - searches across multiple entity types
 *
 * @param {string} query - Search query string
 * @param {Array<string>} types - Entity types to search: ['content', 'media', 'user']
 * @returns {Promise<Array>} - Sorted results by relevance
 */
export async function search(query, types = ['content', 'media', 'user']) {
  const results = [];
  const queryLower = query.toLowerCase();

  // Search each entity type
  for (const type of types) {
    let typeResults = [];

    switch (type) {
      case 'content':
        if (contentMatcher) {
          typeResults = await contentMatcher.search(queryLower);
        }
        break;

      case 'media':
        if (mediaMatcher) {
          typeResults = await mediaMatcher.search(queryLower);
        }
        break;

      case 'user':
        if (userMatcher) {
          typeResults = await userMatcher.search(queryLower);
        }
        break;

      default:
        console.warn(`[linkit] Unknown entity type: ${type}`);
    }

    results.push(...typeResults);
  }

  // Sort by score (descending), then by creation date (newest first)
  results.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    // Use created timestamp if available
    const aTime = a.metadata?.created ? new Date(a.metadata.created).getTime() : 0;
    const bTime = b.metadata?.created ? new Date(b.metadata.created).getTime() : 0;
    return bTime - aTime;
  });

  // Remove score from results (internal ranking detail)
  return results.map(({ score, ...result }) => result);
}

/**
 * Calculate relevance score for a search match
 *
 * Scoring algorithm:
 * - Exact match (case-insensitive): 100 points
 * - Starts with query: 50 points
 * - Contains query: 25 points
 * - Word boundary match: +10 points
 *
 * @param {string} text - Text to search in
 * @param {string} query - Query string (already lowercased)
 * @returns {number} - Score (0 = no match, higher = better match)
 */
export function calculateScore(text, query) {
  if (!text || !query) return 0;

  const textLower = text.toLowerCase();

  // Exact match
  if (textLower === query) {
    return 100;
  }

  // Starts with query
  if (textLower.startsWith(query)) {
    return 50;
  }

  // Contains query
  if (textLower.includes(query)) {
    let score = 25;

    // Bonus for word boundary match (query appears at start of a word)
    const wordBoundaryRegex = new RegExp(`\\b${escapeRegex(query)}`, 'i');
    if (wordBoundaryRegex.test(text)) {
      score += 10;
    }

    return score;
  }

  return 0;
}

/**
 * Escape special regex characters
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Get configuration for a specific matcher
 * Allows customization of search behavior per entity type
 *
 * @param {string} matcherType - 'content', 'media', or 'user'
 * @returns {Object} - Matcher configuration
 */
export function getMatcherConfig(matcherType) {
  // Default configurations
  const configs = {
    content: {
      searchFields: ['title', 'body', 'summary'],
      maxResults: 10,
      titleWeight: 3, // Title matches are 3x more important
      bodyWeight: 1
    },
    media: {
      searchFields: ['filename', 'alt', 'title'],
      maxResults: 10,
      filenameWeight: 2,
      altWeight: 1
    },
    user: {
      searchFields: ['username', 'email', 'displayName'],
      maxResults: 10,
      usernameWeight: 3,
      emailWeight: 1
    }
  };

  return configs[matcherType] || {};
}

/**
 * ============================================================================
 * PROFILE MANAGEMENT API
 * ============================================================================
 *
 * Linkit profiles define what entity types are available in autocomplete,
 * search settings, and permissions. Profiles allow configuring different
 * link autocomplete behaviors for different user roles or contexts.
 *
 * Profile Structure:
 * {
 *   id: "default",
 *   name: "Default Profile",
 *   description: "Standard link autocomplete configuration",
 *   entity_types: ["content", "media", "user"],
 *   matchers: {
 *     content: { enabled: true, maxResults: 10, minSearchLength: 2 },
 *     media: { enabled: true, maxResults: 5, minSearchLength: 2 },
 *     user: { enabled: false }
 *   },
 *   permissions: {
 *     roles: ["authenticated", "editor", "admin"]
 *   },
 *   created: "2024-01-15T10:30:00.000Z",
 *   updated: "2024-01-15T10:30:00.000Z"
 * }
 */

/**
 * Generate a unique profile ID
 */
function generateProfileId() {
  return `profile_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create a new linkit profile
 *
 * @param {Object} profileData - Profile configuration
 * @param {string} profileData.name - Profile name
 * @param {string} [profileData.description] - Profile description
 * @param {Array<string>} [profileData.entity_types] - Enabled entity types
 * @param {Object} [profileData.matchers] - Matcher configurations
 * @param {Object} [profileData.permissions] - Permission settings
 * @returns {Object} - Created profile with ID
 */
export function createProfile(profileData) {
  const now = new Date().toISOString();
  const profile = {
    id: profileData.id || generateProfileId(),
    name: profileData.name || 'Untitled Profile',
    description: profileData.description || '',
    entity_types: profileData.entity_types || ['content', 'media', 'user'],
    matchers: profileData.matchers || {
      content: { enabled: true, maxResults: 10, minSearchLength: 2 },
      media: { enabled: true, maxResults: 10, minSearchLength: 2 },
      user: { enabled: true, maxResults: 10, minSearchLength: 2 }
    },
    permissions: profileData.permissions || {
      roles: ['authenticated']
    },
    created: now,
    updated: now
  };

  // Write to file
  const filePath = getProfilePath(profile.id);
  writeFileSync(filePath, JSON.stringify(profile, null, 2), 'utf-8');

  console.log(`[linkit] Created profile: ${profile.id}`);
  return profile;
}

/**
 * Get a profile by ID
 *
 * @param {string} id - Profile ID
 * @returns {Object|null} - Profile data or null if not found
 */
export function getProfile(id) {
  const filePath = getProfilePath(id);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`[linkit] Error reading profile ${id}:`, error);
    return null;
  }
}

/**
 * Get all profiles
 *
 * @returns {Array<Object>} - Array of all profiles
 */
export function getAllProfiles() {
  if (!existsSync(PROFILES_DIR)) {
    return [];
  }

  try {
    const files = readdirSync(PROFILES_DIR);
    const profiles = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        const id = file.replace('.json', '');
        const profile = getProfile(id);
        if (profile) {
          profiles.push(profile);
        }
      }
    }

    // Sort by creation date (newest first)
    profiles.sort((a, b) => new Date(b.created) - new Date(a.created));

    return profiles;
  } catch (error) {
    console.error('[linkit] Error reading profiles:', error);
    return [];
  }
}

/**
 * Update a profile
 *
 * @param {string} id - Profile ID
 * @param {Object} updates - Fields to update
 * @returns {Object|null} - Updated profile or null if not found
 */
export function updateProfile(id, updates) {
  const profile = getProfile(id);

  if (!profile) {
    return null;
  }

  // Merge updates
  const updatedProfile = {
    ...profile,
    ...updates,
    id: profile.id, // ID cannot be changed
    created: profile.created, // Created date cannot be changed
    updated: new Date().toISOString()
  };

  // Write to file
  const filePath = getProfilePath(id);
  writeFileSync(filePath, JSON.stringify(updatedProfile, null, 2), 'utf-8');

  console.log(`[linkit] Updated profile: ${id}`);
  return updatedProfile;
}

/**
 * Delete a profile
 *
 * @param {string} id - Profile ID
 * @returns {boolean} - True if deleted, false if not found
 */
export function deleteProfile(id) {
  const filePath = getProfilePath(id);

  if (!existsSync(filePath)) {
    return false;
  }

  try {
    unlinkSync(filePath);
    console.log(`[linkit] Deleted profile: ${id}`);
    return true;
  } catch (error) {
    console.error(`[linkit] Error deleting profile ${id}:`, error);
    return false;
  }
}

/**
 * Initialize default profile if none exist
 */
export function ensureDefaultProfile() {
  const profiles = getAllProfiles();

  if (profiles.length === 0) {
    createProfile({
      id: 'default',
      name: 'Default Profile',
      description: 'Standard configuration for link autocomplete',
      entity_types: ['content', 'media', 'user'],
      matchers: {
        content: { enabled: true, maxResults: 10, minSearchLength: 2 },
        media: { enabled: true, maxResults: 10, minSearchLength: 2 },
        user: { enabled: true, maxResults: 10, minSearchLength: 2 }
      },
      permissions: {
        roles: ['authenticated', 'editor', 'admin']
      }
    });
    console.log('[linkit] Created default profile');
  }
}
