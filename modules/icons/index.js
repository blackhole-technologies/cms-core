/**
 * icons module - Icon System API Endpoints
 *
 * Provides HTTP API for icon rendering and management.
 */

/**
 * Module boot hook - Register routes
 */
export function hook_boot(context) {
  // Icon services are already registered in core boot
  // This module just adds API endpoints
}

/**
 * Module routes hook - Define API endpoints
 */
export function hook_routes(register, context) {
  const { services } = context;

  /**
   * POST /api/icons/render
   * Render an icon with options
   *
   * Body: { name: string, options: object }
   * Response: { svg: string, cached: boolean }
   */
  register('POST', '/api/icons/render', async (req, res) => {
    try {
      const { name, options = {} } = req.body;

      if (!name) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Icon name is required' }));
      }

      const iconRenderer = services.get('icon-renderer');
      const svg = iconRenderer.renderIcon(name, options);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        svg,
        name,
        options,
      }));
    } catch (error) {
      console.error('[icons] Render error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Failed to render icon' }));
    }
  });

  /**
   * GET /api/icons/stats
   * Get cache statistics
   */
  register('GET','/api/icons/stats', async (req, res) => {
    try {
      const iconRenderer = services.get('icon-renderer');
      const stats = iconRenderer.getCacheStats();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(stats));
    } catch (error) {
      console.error('[icons] Stats error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Failed to get stats' }));
    }
  });

  /**
   * POST /api/icons/cache/clear
   * Clear render cache
   */
  register('POST','/api/icons/cache/clear', async (req, res) => {
    try {
      const iconRenderer = services.get('icon-renderer');
      iconRenderer.clearCache();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, message: 'Cache cleared' }));
    } catch (error) {
      console.error('[icons] Clear cache error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Failed to clear cache' }));
    }
  });

  /**
   * GET /api/icons/list
   * List all available icons
   */
  register('GET','/api/icons/list', async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const packId = url.searchParams.get('pack');

      const icons = services.get('icons');

      let iconsList;
      if (packId) {
        iconsList = icons.getIconsByPack(packId);
      } else {
        // Get all icons from registry (workaround - no listAll method)
        const packs = icons.listPacks();
        iconsList = [];
        for (const pack of packs) {
          const packIcons = icons.getIconsByPack(pack.id);
          iconsList.push(...packIcons);
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        icons: iconsList,
        count: iconsList.length,
      }));
    } catch (error) {
      console.error('[icons] List error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Failed to list icons' }));
    }
  });

  /**
   * GET /api/icons/search
   * Search for icons
   */
  register('GET','/api/icons/search', async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const q = url.searchParams.get('q');
      const pack = url.searchParams.get('pack');
      const limit = url.searchParams.get('limit');

      if (!q) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Search query (q) is required' }));
      }

      const icons = services.get('icons');
      const results = icons.searchIcons(q, {
        packId: pack,
        limit: limit ? parseInt(limit, 10) : 50,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        results,
        count: results.length,
        query: q,
      }));
    } catch (error) {
      console.error('[icons] Search error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Failed to search icons' }));
    }
  });

  /**
   * GET /api/icons/packs
   * List all icon packs
   */
  register('GET','/api/icons/packs', async (req, res) => {
    try {
      const icons = services.get('icons');
      const packs = icons.listPacks();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        packs,
        count: packs.length,
      }));
    } catch (error) {
      console.error('[icons] Packs error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Failed to list packs' }));
    }
  });

  /**
   * GET /icons/autocomplete-demo
   * Demo page for icon autocomplete form element
   */
  register('GET', '/icons/autocomplete-demo', async (req, res) => {
    try {
      const { readFileSync } = await import('node:fs');
      const { join, dirname } = await import('node:path');
      const { fileURLToPath } = await import('node:url');

      const __dirname = dirname(fileURLToPath(import.meta.url));
      const templatePath = join(__dirname, 'templates', 'autocomplete-demo.html');
      const html = readFileSync(templatePath, 'utf-8');

      return res.writeHead(200, { 'Content-Type': 'text/html' }).end(html);
    } catch (error) {
      console.error('[icons] Demo page error:', error);
      res.writeHead(500, { 'Content-Type': 'text/html' });
      return res.end('Demo page not found');
    }
  });

  console.log('[icons] Registered API routes: /api/icons/*');
  console.log('[icons] Registered demo page: /icons/autocomplete-demo');
}
