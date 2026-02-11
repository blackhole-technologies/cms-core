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
        return res.status(400).json({ error: 'Icon name is required' });
      }

      const iconRenderer = services.get('icon-renderer');
      const svg = iconRenderer.renderIcon(name, options);

      return res.json({
        svg,
        name,
        options,
      });
    } catch (error) {
      console.error('[icons] Render error:', error);
      return res.status(500).json({ error: 'Failed to render icon' });
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

      return res.json(stats);
    } catch (error) {
      console.error('[icons] Stats error:', error);
      return res.status(500).json({ error: 'Failed to get stats' });
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

      return res.json({ success: true, message: 'Cache cleared' });
    } catch (error) {
      console.error('[icons] Clear cache error:', error);
      return res.status(500).json({ error: 'Failed to clear cache' });
    }
  });

  /**
   * GET /api/icons/list
   * List all available icons
   */
  register('GET','/api/icons/list', async (req, res) => {
    try {
      const icons = services.get('icons');
      const packId = req.query.pack;

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

      return res.json({
        icons: iconsList,
        count: iconsList.length,
      });
    } catch (error) {
      console.error('[icons] List error:', error);
      return res.status(500).json({ error: 'Failed to list icons' });
    }
  });

  /**
   * GET /api/icons/search
   * Search for icons
   */
  register('GET','/api/icons/search', async (req, res) => {
    try {
      const { q, pack, limit } = req.query;

      if (!q) {
        return res.status(400).json({ error: 'Search query (q) is required' });
      }

      const icons = services.get('icons');
      const results = icons.searchIcons(q, {
        packId: pack,
        limit: limit ? parseInt(limit, 10) : 50,
      });

      return res.json({
        results,
        count: results.length,
        query: q,
      });
    } catch (error) {
      console.error('[icons] Search error:', error);
      return res.status(500).json({ error: 'Failed to search icons' });
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

      return res.json({
        packs,
        count: packs.length,
      });
    } catch (error) {
      console.error('[icons] Packs error:', error);
      return res.status(500).json({ error: 'Failed to list packs' });
    }
  });

  console.log('[icons] Registered API routes: /api/icons/*');
}
