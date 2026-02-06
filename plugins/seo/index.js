/**
 * SEO Plugin
 *
 * Provides SEO metadata functionality for CMS Core:
 * - Adds metaDescription field to content types
 * - Generates sitemap.xml
 * - Generates robots.txt
 *
 * DEMONSTRATES:
 * - Plugin lifecycle (hook_init, hook_activate)
 * - Permission-restricted context usage
 * - Route registration from plugins
 * - CLI commands from plugins
 */

/**
 * Called when the plugin is loaded
 *
 * @param {Object} context - Plugin context (permission-restricted)
 */
export async function hook_init(context) {
  console.log('[seo] Plugin initialized');
  console.log('[seo] Permissions:', context.plugin.permissions.join(', '));
}

/**
 * Called when the plugin is activated (enabled in config)
 *
 * @param {Object} context - Plugin context (permission-restricted)
 */
export async function hook_activate(context) {
  console.log('[seo] Plugin activated');
  console.log('[seo] Default title:', context.plugin.config.defaultTitle);
}

/**
 * Register CLI commands
 *
 * Note: Commands are automatically prefixed with plugin name (seo:)
 *
 * @param {Function} register - (command, handler, description)
 * @param {Object} context - Plugin context
 */
export function hook_cli(register, context) {
  // seo:status - Show SEO configuration
  register('status', async (args, ctx) => {
    console.log('\nSEO Plugin Status');
    console.log('=================');
    console.log('Version:', context.plugin.version);
    console.log('Config:');
    console.log('  Default Title:', context.plugin.config.defaultTitle);
    console.log('  Default Description:', context.plugin.config.defaultDescription);
    console.log('  Sitemap Enabled:', context.plugin.config.sitemapEnabled);
    console.log('  Robots Enabled:', context.plugin.config.robotsEnabled);
    console.log('');
  }, 'Show SEO plugin status and configuration');

  // seo:sitemap - Preview sitemap content
  register('sitemap', async (args, ctx) => {
    const content = context.services.get('content');
    const sitemap = generateSitemap(content, context.plugin.config);
    console.log(sitemap);
  }, 'Preview sitemap.xml content');

  // seo:robots - Preview robots.txt content
  register('robots', async (args, ctx) => {
    const robots = generateRobots(context.plugin.config);
    console.log(robots);
  }, 'Preview robots.txt content');
}

/**
 * Register HTTP routes
 *
 * @param {Function} register - (method, path, handler, description)
 * @param {Object} context - Plugin context
 */
export function hook_routes(register, context) {
  // GET /seo/status - JSON status endpoint
  register('GET', '/seo/status', async (req, res, params, ctx) => {
    const server = ctx.services.get('server');
    server.json(res, {
      plugin: 'seo',
      version: context.plugin.version,
      config: {
        defaultTitle: context.plugin.config.defaultTitle,
        sitemapEnabled: context.plugin.config.sitemapEnabled,
        robotsEnabled: context.plugin.config.robotsEnabled,
      },
    });
  }, 'SEO plugin status');

  // GET /seo/sitemap OR /sitemap.xml - Generate sitemap
  register('GET', '/seo/sitemap', async (req, res, params, ctx) => {
    if (!context.plugin.config.sitemapEnabled) {
      res.writeHead(404);
      res.end('Sitemap disabled');
      return;
    }

    const content = context.services.get('content');
    const sitemap = generateSitemap(content, context.plugin.config);

    res.writeHead(200, { 'Content-Type': 'application/xml' });
    res.end(sitemap);
  }, 'Generate sitemap.xml');

  // Also serve at /sitemap.xml
  register('GET', '/sitemap.xml', async (req, res, params, ctx) => {
    if (!context.plugin.config.sitemapEnabled) {
      res.writeHead(404);
      res.end('Sitemap disabled');
      return;
    }

    const content = context.services.get('content');
    const sitemap = generateSitemap(content, context.plugin.config);

    res.writeHead(200, { 'Content-Type': 'application/xml' });
    res.end(sitemap);
  }, 'Generate sitemap.xml (alias)');

  // GET /robots.txt - Generate robots.txt
  register('GET', '/robots.txt', async (req, res, params, ctx) => {
    if (!context.plugin.config.robotsEnabled) {
      res.writeHead(404);
      res.end('Robots.txt disabled');
      return;
    }

    const robots = generateRobots(context.plugin.config);

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(robots);
  }, 'Generate robots.txt');
}

/**
 * Generate sitemap XML from content
 *
 * @param {Object} content - Content service
 * @param {Object} config - Plugin config
 * @returns {string} - Sitemap XML
 */
function generateSitemap(content, config) {
  const types = content.listTypes();
  const urls = [];

  // Add homepage
  urls.push({
    loc: '/',
    priority: '1.0',
    changefreq: 'daily',
  });

  // Add content pages
  for (const { type } of types) {
    // Skip internal types
    if (type === 'user' || type === 'apitoken' || type === 'taskrun') {
      continue;
    }

    const items = content.listAll(type);

    for (const item of items) {
      urls.push({
        loc: `/content/${type}/${item.id}`,
        lastmod: item.updated.split('T')[0],
        priority: '0.7',
        changefreq: 'weekly',
      });
    }
  }

  // Build XML
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  for (const url of urls) {
    xml += '  <url>\n';
    xml += `    <loc>${escapeXml(url.loc)}</loc>\n`;
    if (url.lastmod) {
      xml += `    <lastmod>${url.lastmod}</lastmod>\n`;
    }
    xml += `    <changefreq>${url.changefreq}</changefreq>\n`;
    xml += `    <priority>${url.priority}</priority>\n`;
    xml += '  </url>\n';
  }

  xml += '</urlset>';

  return xml;
}

/**
 * Generate robots.txt content
 *
 * @param {Object} config - Plugin config
 * @returns {string} - robots.txt content
 */
function generateRobots(config) {
  let txt = 'User-agent: *\n';
  txt += 'Allow: /\n';
  txt += '\n';
  txt += '# Admin area\n';
  txt += 'Disallow: /admin/\n';
  txt += 'Disallow: /api/\n';
  txt += '\n';

  if (config.sitemapEnabled) {
    txt += '# Sitemap\n';
    txt += 'Sitemap: /sitemap.xml\n';
  }

  return txt;
}

/**
 * Escape special XML characters
 *
 * @param {string} str - String to escape
 * @returns {string} - Escaped string
 */
function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
