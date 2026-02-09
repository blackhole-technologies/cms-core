# CMS-Core — Architecture Bible

> Zero-dependency Node.js CMS with Drupal architectural parity.
> Every extensibility pattern from Drupal, implemented in modern JavaScript.

---

## The 8 Meta-Patterns

CMS-Core's architecture reduces to 8 repeating patterns. Learn these and you can build anything:

| # | Pattern | What It Is | Template |
|---|---------|-----------|----------|
| 1 | **PluginManager** | Universal extensibility (field types, blocks, filters, etc.) | `.autoforge/templates/plugin-manager.js` |
| 2 | **ContentEntity** | User data (nodes, users, comments, media, files) | `.autoforge/templates/content-entity.js` |
| 3 | **ConfigEntity** | System config (content types, views, image styles, roles) | `.autoforge/templates/config-entity.js` |
| 4 | **EntityStorage** | CRUD + queries for entities (JSON files, future SQLite) | `.autoforge/templates/entity-storage.js` |
| 5 | **Container (DI)** | Service registration with dependencies and tags | `.autoforge/templates/service-provider.js` |
| 6 | **HookManager** | Unified event/hook system with alter support | `.autoforge/templates/hook-implementation.js` |
| 7 | **Render Array** | Structured output with caching and theming | `.autoforge/templates/render-element.js` |
| 8 | **FormBase** | Forms with cross-module alter support | `.autoforge/templates/form-base.js` |

**Read the templates.** They have full JSDoc, examples, and Drupal equivalents.

---

## Directory Structure

### Current Layout
```
cms-core/
├── CLAUDE.md              ← THIS FILE (architecture guide)
├── index.js               ← Entry point (starts HTTP server on port 3001)
├── config/
│   ├── site.json           ← Site settings
│   ├── modules.json        ← Enabled module list
│   ├── active/             ← Active config entities (JSON files)
│   └── staging/            ← Config export staging
├── core/                   ← FRAMEWORK CODE ONLY
│   ├── boot.js             ← Module loader, service registry
│   ├── server.js           ← HTTP server
│   ├── router.js           ← Route registry
│   ├── auth.js             ← Authentication
│   ├── database.js         ← SQLite helpers
│   ├── config.js           ← Config loader (site.json, modules.json)
│   ├── utils.js            ← Utilities
│   ├── static.js           ← Static file serving
│   └── lib/                ← PATTERN IMPLEMENTATIONS
│       ├── Plugin/         ← PluginManager, PluginBase, Discovery
│       ├── Entity/         ← EntityType, ContentEntityBase, Storage, Query
│       ├── Field/          ← FieldType/Widget/Formatter PluginManagers
│       ├── Config/         ← ConfigEntity, ConfigEntityStorage, Schema
│       ├── DependencyInjection/ ← Container, Reference
│       ├── Hook/           ← HookManager
│       ├── Render/         ← Renderer, BubbleableMetadata, LazyBuilder
│       ├── Theme/          ← ThemeRegistry, ThemeNegotiator
│       ├── Access/         ← AccessResult, AccessPolicy
│       ├── Form/           ← FormBuilder, FormState, FormBase
│       ├── Routing/        ← Router enhancements, ParamConverter
│       ├── Extension/      ← ModuleInstaller, ModuleHandler
│       ├── Serialization/  ← Serializer, Normalizers
│       ├── Rest/           ← ResourcePluginManager, EntityResource
│       ├── Queue/          ← QueueFactory, DatabaseQueue
│       ├── Migration/      ← MigrationManager, Source/Process/Destination
│       ├── Layout/         ← LayoutPluginManager, Section, SectionComponent
│       └── Recipe/         ← Recipe, RecipeRunner, RecipeValidator
├── modules/                ← ALL FEATURES GO HERE
│   ├── node/               ← Content (articles, pages)
│   ├── users/              ← User management
│   ├── taxonomy/           ← Vocabularies and terms
│   ├── comment/            ← Comments
│   ├── media/              ← Media library
│   ├── block/              ← Block types and placements
│   ├── views/              ← Content listings
│   ├── search/             ← Search backends
│   ├── editor/             ← Rich text editor
│   ├── filter/             ← Text filters
│   ├── image/              ← Image styles and effects
│   ├── path_alias/         ← URL aliases
│   ├── layout_builder/     ← Visual page composition
│   ├── workspaces/         ← Content staging
│   ├── admin/              ← Admin interface
│   └── ...                 ← More modules
├── content/                ← JSON content storage
├── themes/                 ← Theme layouts
├── public/                 ← Static assets
├── recipes/                ← Reusable site configurations
└── .autoforge/
    ├── templates/          ← Meta-pattern templates (READ THESE)
    ├── specs/              ← Stage specifications
    └── prompts/            ← Agent prompts
```

### What Goes Where

| You're building... | Put it in... | Pattern to follow |
|---|---|---|
| A new extensible subsystem (like field types) | `core/lib/{Subsystem}/` | PluginManager template |
| A new entity type (like media, comment) | `modules/{name}/` + register via hook | ContentEntity template |
| A new config entity type (like image style) | `modules/{name}/` + ConfigEntity | ConfigEntity template |
| A new plugin instance (like a field type) | `modules/{mod}/plugins/{type}/{Name}.js` | Plugin file convention |
| A new module feature | `modules/{name}/` with manifest.json + index.js | module-pattern.js template |
| A fix to an existing core pattern | `core/lib/{existing}/` | Match existing style |
| A new service | `modules/{name}/services.js` | service-provider.js template |

---

## How to Create a New Plugin Type

1. Instantiate PluginManager in `core/lib/{Subsystem}/{Type}PluginManager.js`:
```javascript
import { PluginManager } from '../Plugin/PluginManager.js';
export const myTypeManager = new PluginManager('my_type', {
  subdir: 'my_type',
  alterHook: 'my_type_info_alter',
  defaults: { category: 'General' },
});
```

2. Modules contribute plugins at `modules/{mod}/plugins/my_type/{PluginName}.js`:
```javascript
export const definition = { id: 'my_plugin', label: 'My Plugin' };
export default function create(config, id, def, services) {
  return { /* plugin instance */ };
}
```

3. Use: `const instance = await myTypeManager.createInstance('my_plugin');`

---

## How to Create a New Entity Type

1. Register in your module's entity type hook:
```javascript
export function hook_entity_type_info(ctx) {
  ctx.entityTypeManager.register('my_entity', {
    label: 'My Entity',
    keys: { id: 'id', uuid: 'uuid', label: 'title' },
    handlers: { storage: myStorage, access: myAccess },
    baseFieldDefinitions: {
      id: { type: 'integer', label: 'ID', readOnly: true },
      title: { type: 'string', label: 'Title', required: true },
    },
  });
}
```

2. Create storage handler (or use JsonFileEntityStorage)
3. Create access handler (or use EntityAccessControlHandler)

---

## How to Create a New Module

Every module lives in `modules/{name}/` with minimum two files:

**manifest.json:**
```json
{
  "name": "my_module",
  "version": "1.0.0",
  "description": "What this module does",
  "dependencies": []
}
```

**index.js:**
```javascript
export function hook_boot(ctx) {
  // Register services, set up hooks
}

export function hook_routes(ctx) {
  ctx.router.get('/api/mymod/items', handler);
}
```

**Optional services.js:**
```javascript
export function register(container) {
  container.register('mymod.service', (dep1, dep2) => {
    return new MyService(dep1, dep2);
  }, { deps: ['database', 'hooks'], tags: ['my_tag'] });
}
```

Enable by adding to `config/modules.json`.

---

## How Services Work

Services are registered through the DI Container:

```javascript
// Register (in module's services.js or hook_boot)
container.register('my.service', (database) => new MyService(database), {
  deps: ['database'],
  tags: ['entity_storage'],
  singleton: true,
});

// Use (anywhere with access to services)
const myService = services.get('my.service');

// Find by tag
const allStorages = container.getTagged('entity_storage');

// Optional dependency (null if not registered)
container.register('x', (required, optional) => ..., {
  deps: ['required', '?optional'],
});
```

---

## How Hooks Work

CMS-Core has a unified hook system. Convention hooks and runtime hooks go through the same HookManager:

```javascript
// Convention hooks (module exports — auto-registered during boot)
export function hook_boot(ctx) { }
export function hook_routes(ctx) { }
export function hook_entity_type_info(ctx) { }

// Runtime hooks (registered explicitly)
hooks.on('entity:presave', handler, { module: 'mymod', priority: 10 });

// Alter hooks (cross-module modification)
hooks.onAlter('form_node_edit', (form) => { form.extra = {...}; return form; });

// Backward compatible
hooks.register('event', handler, priority);  // → hooks.on()
hooks.trigger('event', context);             // → hooks.invoke()
```

---

## Naming Conventions

| Thing | Convention | Example |
|-------|-----------|---------|
| Module directory | `snake_case` | `modules/path_alias/` |
| Plugin file | `PascalCase.js` | `plugins/field_type/StringItem.js` |
| Plugin ID | `snake_case` | `'string_textfield'` |
| Service ID | `dot.separated` | `'entity_type.manager'` |
| Hook name | `colon:separated` | `'entity:presave'` |
| Config entity file | `{type}.{id}.json` | `node_type.article.json` |
| Entity storage dir | `content/{type}/` | `content/node/` |
| Core lib directory | `PascalCase/` | `core/lib/DependencyInjection/` |

---

## Anti-Patterns (What NOT To Do)

1. **❌ Don't hardcode extensible things.** If it could have variations (field types, block types, filters), use PluginManager.
2. **❌ Don't put feature code in `core/`.** Features go in `modules/`. Core is framework only.
3. **❌ Don't use inline permission checks.** Use AccessResult objects with cache metadata.
4. **❌ Don't use raw HTML strings for output.** Use render arrays so cache metadata bubbles.
5. **❌ Don't create separate hook systems.** Everything goes through HookManager.
6. **❌ Don't manually register services in boot.js.** Use module `services.js` files.
7. **❌ Don't store config in code.** Use ConfigEntity for exportable configuration.
8. **❌ Don't use external npm dependencies.** Node.js built-ins only.
9. **❌ Don't use synchronous I/O in hot paths.** All methods that might do I/O should be async.
10. **❌ Don't subclass PluginManager.** Instantiate it with different parameters instead.

---

## Running the Server

```bash
node index.js          # Starts on port 3001
```

Verify: `curl http://localhost:3001/` returns JSON with site info.

## Database

SQLite via `core/database.js` for relational data. JSON files in `content/` for entity storage. Config entities in `config/active/`.

## Key Principle

**ONE pattern, MANY instances.** PluginManager is instantiated ~40 times (once per plugin type). ContentEntityBase is instantiated for every entity type. ConfigEntity covers all config types. The patterns don't change — only the data they hold.

## Drupal Reference

Local Drupal core for comparison:
```
/Users/Alchemy/Projects/experiments/drupal-cms/web/core/modules/
```
