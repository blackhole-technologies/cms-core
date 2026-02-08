/**
 * TEMPLATE: CMS-Core Module Pattern
 * 
 * Every module follows this structure. Used by ALL tiers.
 * Modules live in modules/<name>/ with manifest.json + index.js
 */

// modules/<name>/manifest.json
const manifest = {
  "name": "Module Name",
  "machine_name": "module_name",
  "version": "0.1.0",
  "description": "What this module does",
  "core_version": ">=0.0.80",
  "dependencies": [],  // other module machine_names
  "config": {
    "enabled": true,
    "settings": {}  // module-specific defaults
  }
};

// modules/<name>/index.js — Standard hooks
export function hook_boot(ctx) {
  // Called early — register services
  // ctx.services.register('service_name', serviceInstance)
}

export function hook_ready(ctx) {
  // Called after all modules booted — safe to use other services
  // Good place for: event subscriptions, scheduled tasks
}

export function hook_cli(ctx) {
  // Register CLI commands
  ctx.cli.register('module:command', {
    description: 'What this command does',
    arguments: {
      name: { description: 'Argument description', required: false }
    },
    options: {
      format: { description: 'Output format', default: 'table' }
    },
    async handler(args, options) {
      const service = ctx.services.get('service_name');
      const result = await service.doSomething();

      if (options.format === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        // Table output
        console.table(result);
      }
    }
  });
}

export function hook_routes(ctx) {
  // Register HTTP routes
  const router = ctx.router;

  // API routes
  router.get('/api/module_name/items', async (req, res) => {
    const service = ctx.services.get('service_name');
    const items = await service.list();
    res.json(items);
  });

  router.post('/api/module_name/items', async (req, res) => {
    const service = ctx.services.get('service_name');
    const item = await service.create(req.body);
    res.status(201).json(item);
  });

  // Admin routes (return rendered HTML via theme engine)
  router.get('/admin/module_name', async (req, res) => {
    const service = ctx.services.get('service_name');
    const items = await service.list();
    const theme = ctx.services.get('theme');
    res.send(theme.render('admin/module_name/list', { items }));
  });
}

export function hook_content(ctx) {
  // Register content types or field types
  return {
    types: {
      module_item: {
        label: 'Module Item',
        fields: {
          title: { type: 'string', required: true },
          status: { type: 'boolean', default: true }
        }
      }
    }
  };
}

/**
 * Service pattern — modules register services for others to use
 * 
 * class ModuleService {
 *   constructor(ctx) { this.ctx = ctx; this.store = ctx.services.get('storage'); }
 *   list(filters) { ... }
 *   get(id) { ... }
 *   create(data) { ... }
 *   update(id, data) { ... }
 *   remove(id) { ... }
 * }
 * 
 * Config is read from: config/module_name.json (flat-file JSON)
 * Content is stored in: content/module_item/<id>.json
 */
