# CMS Core - Handoff Document

## Version
**0.0.81** - Entity Types System (Drupal-style bundles)

---

## SESSION: 2026-02-07 - Template Fixes + Drupal Deep Dive

### COMPLETED
- Fixed template name mismatches (code expected different names than actual files):
  - `content-type-list.html` → `content-types-list.html`
  - `content-type-form.html` → `content-types-edit.html`
  - `content-type-fields.html` → `content-types-fields.html`
  - `content-type-field-form.html` → `content-types-field-edit.html`
- Created missing templates:
  - `content-type-display.html` — Manage display modes
  - `theme-list.html` — Appearance page with theme grid
- Fixed service name mismatches:
  - `ctx.services.get('theme')` → `ctx.services.get('themeEngine')`
  - `ctx.services.get('action')` → `ctx.services.get('actions')`
  - `ctx.services.get('rule')` → `ctx.services.get('actions')` (rules are part of actions)
- Fixed template syntax (engine doesn't support `{{this.prop}}`, just `{{prop}}`)
- Added `fieldCount` to content types list
- Added `isActive` flag to themes list

### PAGES NOW WORKING
- `/admin/structure/types` — Lists all content types
- `/admin/appearance` — Shows layouts with theme cards
- `/admin/config/actions` — Actions list (empty state)
- `/admin/config/rules` — Rules list (empty state)

### DRUPAL DEEP DIVE COMPLETED ✓
Created comprehensive doc: `docs/DRUPAL-DEEP-DIVE.md` (23KB)

**Source Code Analyzed:**
- `ContentEntityBase.php` (25KB) - Entity architecture, lazy fields, translations
- `FieldStorageConfig.php` (20KB) - Two-level field system, cardinality, schemas
- `ViewExecutable.php` (30KB) - Query builder, handlers, displays, exposed filters
- `Section.php` (12KB) - Layout sections, components, regions, serialization
- `FormBuilder.php` (25KB) - Form caching, multi-step, AJAX handling

**Key Architectural Patterns Documented:**

1. **Entity System**
   - ContentEntityBase with lazy field loading
   - Entity keys cache for performance
   - Built-in revision and translation tracking
   - Values stored as `$values[$field][$langcode]`

2. **Field Storage**
   - Two-level: FieldStorageConfig (global) + FieldConfig (per-bundle)
   - Cardinality: 1, n, or UNLIMITED (-1)
   - Schema generated from field type class
   - Indexes merged: custom + field type defaults

3. **Views Query Builder**
   - Handler types: field, argument, sort, filter, relationship, header/footer/empty
   - Execution flow: initDisplay → initHandlers → preQuery → execute → postExecute
   - Exposed filters with session "remember" support
   - Multiple displays per view (page, block, feed)

4. **Layout Builder**
   - Section = layoutId + layoutSettings + components[]
   - Components keyed by UUID with region + weight
   - toArray()/fromArray() for serialization
   - Weight-based ordering with insert helpers

5. **Form API**
   - buildForm → retrieveForm → prepareForm → processForm
   - Form caching for multi-step (POST only)
   - build_id preservation for AJAX
   - FormState tracks all form state

**Implementation Priorities for CMS Core:**
- HIGH: Entity/Bundle separation, Two-level fields, Display modes
- MEDIUM: Views query builder, Config export/import, Plugin discovery
- LOWER: Layout sections, Form state machine, Revision UI

### IMPLEMENTED: Entity Types System
New file: `core/entity-types.js` (17KB)

Drupal-style two-level architecture now in CMS Core:
- 4 built-in entity types: `node`, `user`, `taxonomy_term`, `media`
- Each has: baseFields, entityKeys, revisionable, translatable flags
- Bundle management for content types
- Field storage (global) + field instances (per-bundle)
- Display modes: full, teaser, card, search_result
- Config persisted to `config/entity-types/*.json`

Boot log confirms:
```
[entity-types] Initialized (4 entity types, 0 bundles)
[boot] Entity Types/Bundles enabled
```

### TOKEN USAGE
- Session start: 44k/200k (22%)
- Current: ~130k/200k (~65%)
- Hourly: 75% left · Weekly: 6% left

---

## SESSION: 2026-02-04 - v0.0.71 Menu System + v0.0.72 Contact Forms

### COMPLETED
- **v0.0.71**: Full menu system (core/menu.js, admin UI, 10 CLI commands, 11 admin routes)
- **v0.0.72**: Contact forms module (core/contact.js, admin UI, 6 CLI commands, 8 admin routes)
- **v0.0.73**: IP ban module (core/ban.js, admin UI, 4 CLI commands, 3 admin routes)
- **v0.0.74**: Content history tracking (core/history.js, admin UI, 5 CLI commands, 2 admin routes)

### v0.0.74 FILES
- `core/history.js` — Content read tracking service
  - Per-user history in `content/history/{userId}.json`
  - In-memory LRU cache (100 users) for dashboard performance
  - New/updated detection for content badges
  - Bulk unread counting
  - Auto-trim old entries (configurable max per user)
- `modules/admin/templates/history.html` — History overview page
- `core/boot.js` — Import + init + register
- `modules/admin/index.js` — 2 admin routes + 5 CLI commands
- `config/site.json` — History config, bumped to 0.0.74

### v0.0.73 FILES
- `core/ban.js` — IP ban service
  - Single-file storage (content/ban/bans.json)
  - In-memory cache for fast middleware lookups
  - CIDR range support (IPv4)
  - Temporary bans with expiry
  - IPv6-mapped IPv4 normalization
  - Global middleware (runs on every request)
- `modules/admin/templates/ban-list.html` — Ban management UI
- `core/boot.js` — Import + init + register + middleware
- `modules/admin/index.js` — 3 admin routes + 4 CLI commands
- `config/site.json` — Ban config, bumped to 0.0.73

### v0.0.72 FILES
- `core/contact.js` — Contact forms service (887 lines)
  - Form CRUD (direct file I/O to avoid content service ID mismatch)
  - Submission handling via content service
  - Flood control (in-memory, 5/hour default)
  - Email integration (uses email service, logs if not configured)
  - Honeypot spam protection (random field name per boot)
  - Personal contact forms (user-to-user)
  - Export functionality
- `modules/admin/templates/contact-forms.html` — Form list page
- `modules/admin/templates/contact-form-edit.html` — Edit/create form
- `modules/admin/templates/contact-submissions.html` — Submissions list
- `modules/admin/templates/contact-submission-view.html` — View submission
- `core/boot.js` — Added import + init + register for contact service
- `modules/admin/index.js` — Added 8 admin routes + 6 CLI commands
- `config/site.json` — Added contact config, bumped to 0.0.72

### CLI COMMANDS
```
contact:list           - List all contact forms with stats
contact:create <id>    - Create contact form
contact:delete <id>    - Delete contact form and submissions
contact:submissions <id> - List submissions for a form
contact:submit [id]    - Submit test message to form
contact:export <id>    - Export form with all submissions as JSON
```

### ADMIN ROUTES
```
GET  /admin/contact-forms                           - List forms
POST /admin/contact-forms                           - Create form
GET  /admin/contact-forms/:id/edit                  - Edit form
POST /admin/contact-forms/:id/update                - Update form
POST /admin/contact-forms/:id/delete                - Delete form
GET  /admin/contact-forms/:id/submissions           - List submissions
GET  /admin/contact-forms/:formId/submissions/:id   - View submission
POST /admin/contact-forms/:formId/submissions/:id/delete - Delete submission
POST /admin/contact-forms/:id/submissions/delete-all    - Bulk delete
```

### KNOWN PATTERNS (from MEMORY.md)
- Content service ID mismatch: use direct file I/O for human-readable IDs
- Boolean filters must be strings: `{ enabled: 'true' }`
- Config objects are frozen: spread before adding properties
- `limit: 10000` not `limit: -1` (pagination bug)

### DRUPAL GAP ANALYSIS
Completed full analysis of Drupal 11's 75 core modules vs CMS-Core. See:
`/private/tmp/claude-502/.../scratchpad/drupal-gap-analysis.md`

### NEXT PRIORITIES (from gap analysis)
1. Layout Discovery + Builder (page composition)
2. Content Translation (per-field multilingual)
3. REST API Framework (generic RESTful resources)
4. Workspaces (content staging)
5. History (content read tracking)
6. IP Ban (security)

---

## SESSION: 2026-02-03 - Making it ACTUALLY like Drupal

### CRITICAL CONTEXT
User requested authentic Drupal architecture, not shallow imitation.
Read `~/.claude/claude.md` for MAXIMUM DELEGATION PROTOCOL.
Read `contracts/DRUPAL-CORE.md` for TypeScript interfaces.

### AGENTS IN PROGRESS (Check these first!)
```
/private/tmp/claude-502/-Users-Alchemy-Projects-experiments-cms-core/tasks/ad2231f.output - render.js
/private/tmp/claude-502/-Users-Alchemy-Projects-experiments-cms-core/tasks/a499d4f.output - form.js (Form API)
/private/tmp/claude-502/-Users-Alchemy-Projects-experiments-cms-core/tasks/a0b780d.output - theme-system.js
/private/tmp/claude-502/-Users-Alchemy-Projects-experiments-cms-core/tasks/a3838bf.output - cache-backend.js
/private/tmp/claude-502/-Users-Alchemy-Projects-experiments-cms-core/tasks/a34c210.output - database.js
/private/tmp/claude-502/-Users-Alchemy-Projects-experiments-cms-core/tasks/adb6b1a.output - field-storage.js
/private/tmp/claude-502/-Users-Alchemy-Projects-experiments-cms-core/tasks/a458dff.output - ajax.js
/private/tmp/claude-502/-Users-Alchemy-Projects-experiments-cms-core/tasks/af59efa.output - update.js
/private/tmp/claude-502/-Users-Alchemy-Projects-experiments-cms-core/tasks/a9c093c.output - themes/admin/
```

### CONTRACT LOCATION
`/Users/Alchemy/Projects/experiments/cms-core/contracts/DRUPAL-CORE.md`

### NEXT STEPS
1. Check agent outputs - integrate completed modules
2. Update boot.js to use render.js instead of template.js
3. Convert admin templates to Form API
4. Wire cache-backend.js with tag invalidation
5. Apply admin theme to /admin routes
6. Test full Drupal-like workflow

### SESSION METRICS
- 68 agents spawned
- ~4.5M tokens delegated
- 71 core modules, 101 templates, 300 CLI commands

---

## Previous Version
**0.0.55** - Activity Feed & Timeline

## Project Overview

CMS Core is a JavaScript-based content management system inspired by Drupal's pre-9 architecture. It emphasizes:

- **Zero external dependencies** - Built entirely on Node.js standard library
- **ES Modules** - Modern JavaScript with `import`/`export` (not CommonJS)
- **Hook-based extensibility** - Modules extend core through convention-based exports
- **Five-phase boot sequence** - Explicit ordering for predictable initialization
- **Dual-mode operation** - Runs as HTTP server or CLI tool from same entry point

### Philosophy
- Explicit over implicit
- Convention over configuration
- Fail fast, fail clear
- Simple enough to understand completely

## Directory Structure

```
cms-core/
├── core/                   # Core system modules
│   ├── audit.js           # Audit logging system
│   ├── auth.js            # Session management, password hashing, RBAC, CSRF, session tracking
│   ├── boot.js            # Boot sequence orchestrator (5 phases)
│   ├── cache.js           # In-memory TTL-based caching
│   ├── cli.js             # Command-line interface registry
│   ├── config.js          # JSON config loading with validation
│   ├── content.js         # Flat-file JSON content storage with revisions & computed fields
│   ├── csrf.js            # CSRF token generation and validation
│   ├── dependencies.js    # Module dependency resolution
│   ├── discovery.js       # Module/theme scanning
│   ├── hooks.js           # Pub/sub event system
│   ├── media.js           # Media upload and file handling
│   ├── oembed.js          # oEmbed discovery and embedding system
│   ├── fields.js          # Field type registry and widget system
│   ├── validation.js      # Content validation rules and validators
│   ├── preview.js         # Content preview token management
│   ├── email.js           # Email sending system (console/SMTP/sendmail)
│   ├── notifications.js   # User notification system (app/email/webhook)
│   ├── backup.js          # Backup and restore system
│   ├── analytics.js       # Analytics and statistics tracking
│   ├── blueprints.js      # Content templates and blueprints
│   ├── favorites.js       # Content favorites/bookmarks system
│   ├── compare.js         # Content comparison and merge tools
│   ├── activity.js        # Activity feed and timeline
│   ├── plugins.js         # Plugin system with permissions
│   ├── queue.js           # Background job queue with progress tracking
│   ├── ratelimit.js       # Rate limiting with sliding window algorithm
│   ├── router.js          # HTTP route registry with middleware
│   ├── search.js          # Full-text search indexing
│   ├── i18n.js            # Internationalization and localization
│   ├── scheduler.js       # Cron-like task scheduling
│   ├── server.js          # HTTP server wrapper
│   ├── services.js        # Service container (DI)
│   ├── static.js          # Static file serving with range requests
│   ├── slugify.js         # URL slug generation utilities
│   ├── template.js        # Mustache-like template engine
│   ├── transfer.js        # Import/export system
│   ├── watcher.js         # Filesystem watcher with hot reload
│   └── webhooks.js        # Webhook dispatch system
├── config/                 # Configuration files
│   ├── site.json          # Site metadata and settings
│   └── modules.json       # Enabled modules list
├── content/               # Content storage (JSON files)
│   └── <type>/            # Each content type is a directory
│       ├── <id>.json      # Each content item is a JSON file
│       └── .revisions/    # Revision history
│           └── <id>/      # Revisions per item
│               └── <timestamp>.json
├── locales/               # Translation files
│   ├── en.json            # English (default)
│   ├── es.json            # Spanish
│   └── fr.json            # French
├── media/                 # Uploaded media files
│   └── <year>/<month>/    # Organized by date
│       └── <timestamp>-<filename>
├── logs/                  # Runtime logs
│   ├── watcher.log        # Filesystem change log
│   └── audit/             # Audit logs
│       └── <year>/        # Year directory
│           └── <month>.json  # Monthly audit log
├── plugins/               # Third-party plugins
│   └── seo/               # Example SEO plugin
│       ├── plugin.json    # Plugin manifest
│       ├── index.js       # Plugin entry point
│       └── config.json    # Plugin configuration
├── modules/               # Installable modules
│   ├── admin/             # Web-based admin interface
│   │   ├── manifest.json
│   │   ├── index.js
│   │   └── templates/
│   │       ├── dashboard.html
│   │       ├── dashboard-v2.html
│   │       ├── content-list.html
│   │       ├── content-form.html
│   │       ├── export.html
│   │       ├── import.html
│   │       ├── import-preview.html
│   │       ├── modules.html
│   │       ├── revisions-list.html
│   │       ├── revision-view.html
│   │       ├── revision-diff.html
│   │       ├── cache.html
│   │       ├── ratelimit.html
│   │       ├── plugins-list.html
│   │       ├── plugin-detail.html
│   │       ├── search.html
│   │       ├── i18n-list.html
│   │       ├── i18n-edit.html
│   │       ├── i18n-new.html
│   │       ├── content-translate.html
│   │       ├── audit.html
│   │       ├── queue.html
│   │       └── queue-job.html
│   ├── hello/             # Example module with full hook usage
│   │   ├── manifest.json
│   │   └── index.js
│   ├── media/             # Media upload module
│   │   ├── manifest.json
│   │   ├── index.js
│   │   └── templates/
│   │       ├── media-list.html
│   │       └── media-upload.html
│   ├── tasks/             # Scheduled task module
│   │   ├── manifest.json
│   │   ├── index.js
│   │   └── templates/
│   │       ├── tasks-list.html
│   │       └── task-history.html
│   ├── test/              # Minimal test module
│   │   ├── manifest.json
│   │   └── index.js
│   ├── users/             # User authentication module
│   │   ├── manifest.json
│   │   ├── index.js
│   │   └── templates/
│   │       ├── login.html
│   │       ├── users-list.html
│   │       ├── user-form.html
│   │       ├── user-edit.html
│   │       ├── user-password.html
│   │       └── tokens.html
│   └── webhooks/          # Webhook management module
│       ├── manifest.json
│       ├── index.js
│       └── templates/
│           ├── webhooks-list.html
│           └── webhook-form.html
├── public/                # Static assets
│   ├── css/
│   │   ├── style.css      # Site styles
│   │   └── admin.css      # Admin interface styles
│   └── js/                # JavaScript files
├── themes/                # Theme packages
│   └── default/
│       ├── manifest.json
│       ├── templates/
│       │   ├── layout.html
│       │   ├── page.html
│       │   └── error.html
│       └── assets/
├── index.js               # Dual-mode entry point
├── package.json           # NPM package config
└── HANDOFF.md             # This file
```

## Architecture

### Boot Phases

The system initializes through five sequential phases:

```
INIT → DISCOVER → REGISTER → BOOT → READY
```

| Phase | What Happens |
|-------|--------------|
| **INIT** | Load config files (`site.json`, `modules.json`) |
| **DISCOVER** | Scan `/modules` and `/themes` for valid packages |
| **REGISTER** | Register services, wire hooks, register CLI/routes/middleware/content/schedule |
| **BOOT** | Fire `boot` hook - modules initialize |
| **READY** | Fire `ready` hook, start watcher, start HTTP server, start scheduler |

### Service Container

Services are registered lazily and accessed through `context.services`:

```javascript
// Registration (in boot.js)
services.register('config', () => context.config);
services.register('router', () => router);

// Access (in modules)
const server = context.services.get('server');
const content = context.services.get('content');
```

**Available Services:**

| Service | Description |
|---------|-------------|
| `config` | Site and module configuration |
| `hooks` | Event pub/sub system |
| `watcher` | Filesystem watcher |
| `cli` | CLI command registry |
| `router` | HTTP route registry |
| `server` | HTTP server instance |
| `cache` | In-memory cache |
| `content` | Content CRUD operations |
| `media` | Media file handling |
| `scheduler` | Task scheduling |
| `template` | Template rendering |
| `auth` | Authentication, authorization, session management |
| `transfer` | Import/export operations |
| `ratelimit` | Rate limiting service |
| `search` | Full-text search indexing |
| `i18n` | Internationalization and localization |
| `audit` | Audit logging and event tracking |
| `plugins` | Plugin management |
| `queue` | Background job queue with progress tracking |
| `oembed` | oEmbed discovery and embedding |
| `favorites` | Content favorites/bookmarks system |
| `compare` | Content comparison and merge tools |

### Hook System

Modules extend core through exported hook functions:

```javascript
// Convention: export function hook_<hookName>

export async function hook_boot(context) {
  // Fires during BOOT phase
}

export async function hook_ready(context) {
  // Fires during READY phase
}

export function hook_cli(register, context) {
  register('mymod:command', handler, 'Description');
}

export function hook_routes(register, context) {
  register('GET', '/mymod/path', handler, 'Description');
}

export function hook_content(register, context) {
  register('mytype', { field: { type: 'string', required: true } });
}

export function hook_middleware(use, context) {
  use(async (req, res, ctx, next) => { await next(); }, 'name', '/path');
}

export function hook_schedule(schedule, context) {
  schedule('taskname', '0 * * * *', handler, { description: '...' });
}
```

**Available Hooks:**

| Hook | Signature | Purpose |
|------|-----------|---------|
| `boot` | `(context)` | Module initialization |
| `ready` | `(context)` | Post-initialization |
| `cli` | `(register, context)` | Register CLI commands |
| `routes` | `(register, context)` | Register HTTP routes |
| `content` | `(register, context)` | Register content types |
| `middleware` | `(use, context)` | Register middleware |
| `schedule` | `(schedule, context)` | Register scheduled tasks |
| `computed` | `(register, context)` | Register computed fields |

## Content System

Flat-file JSON storage. Each content type is a directory, each item is a JSON file.

### Content Object Format

```json
{
  "id": "1705123456789-x7k9m",
  "type": "greeting",
  "created": "2024-01-13T10:30:00.000Z",
  "updated": "2024-01-13T10:30:00.000Z",
  "name": "Ernie",
  "message": "Welcome!"
}
```

### Content API

```javascript
const content = context.services.get('content');

// CRUD
const item = await content.create('type', data);
const item = content.read('type', 'id');
const item = await content.update('type', 'id', data);
const deleted = await content.remove('type', 'id');

// Read with populate (embed related content)
const post = content.read('post', 'id', { populate: ['author', 'tags'] });
console.log(post.author.username);  // Embedded user object

// List with pagination, search, and filters
const result = content.list('type', {
  page: 1,
  limit: 20,
  search: 'query',
  sortBy: 'created',
  sortOrder: 'desc',
  filters: {
    status: 'published',           // Exact match
    'views__gt': '100',            // Greater than
    'role__in': 'admin,editor',    // Value in list
    author: 'userId123',           // Filter by relation ID
  },
  populate: ['author'],            // Embed related content
});
// Returns: { items, total, page, limit, pages, filters }

// Search across types
const results = content.search('query', ['type1', 'type2']);

// Filter utilities
const filters = content.parseFiltersFromQuery(url.searchParams, schema);
const queryString = content.formatFiltersForQuery(filters);
const operators = content.getFilterOperators();

// Introspection
const types = content.listTypes();
const hasType = content.hasType('type');
const schema = content.getSchema('type');

// Relations
const userPosts = content.getRelated('user', 'userId', 'author', 'post');
const relations = content.getRelationFields('post');
const refs = content.checkReferences('user', 'userId');

// Revisions
const revisions = content.getRevisions('type', 'id');
const oldVersion = content.getRevision('type', 'id', 'timestamp');
const restored = await content.revertTo('type', 'id', 'timestamp');
const diff = content.diffRevisions('type', 'id', 'ts1', 'ts2');
const deleted = content.pruneRevisions('type', 'id', keepCount);
```

### Registered Content Types

| Type | Module | Fields |
|------|--------|--------|
| `greeting` | hello | name (string, required), message (string, required) |
| `user` | users | username (required), password (required), role, email, lastLogin |
| `apitoken` | users | userId (required), token (required), name (required) |
| `webhook` | webhooks | event, url, secret, enabled |
| `media` | media | filename, path, mimetype, size, alt |
| `taskrun` | tasks | name, startedAt, completedAt, duration, status, result |

### Content Filter Operators

Filter content by field values using query parameters or the `filters` option:

| Operator | Syntax | Description | Example |
|----------|--------|-------------|---------|
| `eq` | `field=value` | Exact match (default) | `?status=published` |
| `ne` | `field__ne=value` | Not equal | `?status__ne=draft` |
| `gt` | `field__gt=value` | Greater than | `?views__gt=100` |
| `gte` | `field__gte=value` | Greater than or equal | `?created__gte=2024-01-01` |
| `lt` | `field__lt=value` | Less than | `?age__lt=30` |
| `lte` | `field__lte=value` | Less than or equal | `?price__lte=99` |
| `contains` | `field__contains=str` | String contains (case-insensitive) | `?name__contains=john` |
| `startswith` | `field__startswith=str` | String starts with | `?title__startswith=How` |
| `endswith` | `field__endswith=str` | String ends with | `?email__endswith=.com` |
| `in` | `field__in=a,b,c` | Value in comma-separated list | `?role__in=admin,editor` |

**URL Examples:**
```
GET /content/user?role=admin
GET /content/user?role__in=admin,editor
GET /content/post?status=published&created__gte=2024-01-01
GET /api/content/greeting?name__contains=john&limit=10
```

**Code Example:**
```javascript
const result = content.list('user', {
  filters: {
    role: 'admin',                    // Exact match
    'created__gte': '2024-01-01',     // After Jan 1, 2024
    'name__contains': 'smith',        // Name contains "smith"
  }
});
```

### Content Relationships

Define relationships between content types using the `relation` field type.

**Relationship Types:**

| Type | Storage | Description |
|------|---------|-------------|
| `belongsTo` | Single ID string | Many-to-one (e.g., post → author) |
| `hasMany` | Computed | One-to-many (query inverse belongsTo) |
| `belongsToMany` | Array of IDs | Many-to-many (e.g., post ↔ tags) |

**Schema Definition:**
```javascript
export function hook_content(register, context) {
  register('post', {
    title: { type: 'string', required: true },
    author: { type: 'relation', target: 'user', relation: 'belongsTo' },
    tags: { type: 'relation', target: 'tag', relation: 'belongsToMany' },
  });
}
```

**Creating Content with Relations:**
```javascript
// Create a post with author reference
const post = await content.create('post', {
  title: 'Hello World',
  author: 'userId123',           // belongsTo: single ID
  tags: ['tagId1', 'tagId2'],    // belongsToMany: array of IDs
});
```

**Populating Relations:**
```javascript
// Read with embedded relations
const post = content.read('post', postId, { populate: ['author', 'tags'] });
console.log(post.author.username);    // Embedded user object
console.log(post.tags[0].name);       // Embedded tag objects

// Populate all relations
const post = content.read('post', postId, { populate: ['*'] });

// List with populate
const result = content.list('post', { populate: ['author'] });
```

**Reverse Queries (hasMany):**
```javascript
// Find all posts by a user
const userPosts = content.getRelated('user', userId, 'author', 'post');
// Same as: content.list('post', { filters: { author: userId } })
```

**Referential Integrity:**
```javascript
// Check what references a content item before deleting
const refs = content.checkReferences('user', userId);
if (refs.length > 0) {
  console.log(`Cannot delete: ${refs.length} items reference this user`);
  // refs = [{ type: 'post', id: 'postId', field: 'author' }, ...]
}
```

**Introspection:**
```javascript
// Get all relation fields for a type
const relations = content.getRelationFields('post');
// [{ field: 'author', target: 'user', relation: 'belongsTo' }, ...]
```

**Validation:**
- Relation targets are validated (target type must exist)
- Relation values are validated (correct format for relation type)
- Referential integrity is checked (referenced content must exist)
- Invalid references throw descriptive errors

### Content Lifecycle Hooks

```javascript
// Available hooks (register via hooks.register())
'content:beforeCreate'  // { type, data } - data is mutable
'content:afterCreate'   // { type, item }
'content:beforeUpdate'  // { type, id, data, existing }
'content:afterUpdate'   // { type, item }
'content:beforeDelete'  // { type, id }
'content:afterDelete'   // { type, id }
```

## Caching

In-memory TTL-based cache with pattern invalidation.

### Configuration

```json
{
  "cache": {
    "enabled": true,
    "ttl": 300,
    "apiTtl": 60
  }
}
```

### Cache API

```javascript
const cache = context.services.get('cache');

cache.set('key', value, ttl);
cache.get('key');
cache.delete('key');
cache.clear('pattern*');
cache.has('key');
cache.ttl('key');
cache.stats();

// Key generators
cache.itemKey('type', 'id');
cache.listKey('type', { page, limit });
cache.apiKey('GET', '/path');
```

## Media System

File uploads with multipart/form-data parsing.

### Storage Structure
```
/media/<year>/<month>/<timestamp>-<filename>
```

### Allowed File Types

| Category | Extensions |
|----------|------------|
| Images | .jpg, .jpeg, .png, .gif, .webp, .svg |
| Videos | .mp4, .webm, .mov, .avi, .mkv, .m4v |
| Documents | .pdf, .doc, .docx, .txt, .md |
| Data | .json, .csv |

### Media API

```javascript
const media = context.services.get('media');

// Parse upload
const { fields, files } = await media.parseUpload(req);

// Save file
const saved = media.saveFile(files[0]);
// Returns: { path, relativePath, filename, size, type }

// Delete file
media.deleteFile(relativePath);

// Utilities
media.getMimeType('file.jpg');
media.isImageFile('file.jpg');
media.isVideoFile('file.mp4');
media.getFileType('file.pdf');  // 'image', 'video', or 'document'
media.isAllowedType('file.exe');
media.getAllowedExtensions();
```

### Video Streaming

Video files support HTTP range requests for seeking:

```
GET /media/2026/01/video.mp4
→ 200 OK with Accept-Ranges: bytes

GET /media/2026/01/video.mp4 (Range: bytes=1000-2000)
→ 206 Partial Content with Content-Range header
```

## Scheduled Tasks

Cron-like scheduler using setInterval with minute granularity.

### Cron Expression Format

```
minute hour day-of-month month day-of-week
  *     *        *         *       *
```

| Field | Range |
|-------|-------|
| minute | 0-59 |
| hour | 0-23 |
| day of month | 1-31 |
| month | 1-12 |
| day of week | 0-6 (0 = Sunday) |

### Supported Patterns

| Pattern | Example | Description |
|---------|---------|-------------|
| `*` | `* * * * *` | Any value |
| `N` | `0 * * * *` | Specific value |
| `*/N` | `*/5 * * * *` | Every N units |
| `N-M` | `0 9-17 * * *` | Range |
| `N,M,O` | `0,30 * * * *` | List |

### Common Expressions

| Expression | Description |
|------------|-------------|
| `* * * * *` | Every minute |
| `*/5 * * * *` | Every 5 minutes |
| `0 * * * *` | Hourly |
| `0 0 * * *` | Daily at midnight |
| `0 0 * * 0` | Weekly on Sunday |
| `0 0 1 * *` | Monthly on the 1st |

### Scheduler API

```javascript
const scheduler = context.services.get('scheduler');

// Register task
scheduler.schedule('name', '0 * * * *', async () => {
  return 'result';
}, { description: '...' });

// Unregister
scheduler.unschedule('name');

// Manual run
const result = await scheduler.run('name');
// { status: 'success'|'error', duration, result|error }

// List/Get
const tasks = scheduler.list();
const task = scheduler.get('name');

// History
const history = scheduler.history('name', 20);

// Control
scheduler.start(context);
scheduler.stop();
scheduler.running();

// Utilities
scheduler.describeCron('0 * * * *');  // "hourly"
scheduler.formatDate(new Date());
```

### Built-in Tasks

| Task | Schedule | Description |
|------|----------|-------------|
| `tasks:cleanup` | `0 * * * *` | Clear expired cache entries |
| `tasks:stats` | `0 0 * * *` | Log content statistics |

## Authentication

### Session-Based Auth

Sessions use signed cookies with in-memory tracking:

**Cookie Format:**
```
cms_session=sessionId.userId.timestamp.signature
```

- **sessionId**: UUID identifying this session
- **userId**: User ID
- **timestamp**: Creation time (for expiry)
- **signature**: HMAC-SHA256 of sessionId.userId.timestamp

**Cookie Options:** HttpOnly, SameSite=Lax, Max-Age=86400 (24 hours)

### Session Tracking

Sessions are tracked in memory for invalidation support:

```javascript
Map<sessionId, { userId, createdAt, lastActivity }>
```

### API Token Auth

```
Authorization: Bearer cms_<base64-payload>
```

The payload contains:
- userId
- timestamp
- signature (HMAC of userId.timestamp)

### Auth API

```javascript
const auth = context.services.get('auth');

// Sessions
const sessionId = auth.createSession(res, userId);
auth.destroySession(res, req);
const session = auth.getSession(req);
// Returns: { userId, sessionId } | null

// Session management
const count = auth.invalidateSessions(userId);
const count = auth.invalidateOtherSessions(userId, exceptSessionId);
const count = auth.getActiveSessionCount(userId);
const sessions = auth.getAllSessions();
const stats = auth.getSessionStats();

// Passwords
const hash = auth.hashPassword('password');
const valid = auth.verifyPassword('password', hash);

// Tokens
const token = auth.generateToken(userId);
const data = auth.verifyToken(token);

// From request (session OR token)
const authInfo = auth.getAuthFromRequest(req);
// { userId, method: 'session'|'token', sessionId? }

// RBAC
auth.hasPermission(user, 'content.create');
auth.hasRole(user, 'admin');
auth.getRolePermissions('editor');
auth.getRoles();
```

### CSRF Protection

CSRF tokens protect against malicious form submissions.

**Token Format:** `timestamp.signature`

Where signature = HMAC-SHA256(sessionId + timestamp, secret)

**Configuration:**
```json
{
  "csrf": {
    "enabled": true,
    "tokenExpiry": 3600
  }
}
```

**Template Helpers:**
```html
<!-- Hidden input field for forms -->
{{csrfField}}
<!-- Output: <input type="hidden" name="_csrf" value="..."> -->

<!-- Meta tag for JavaScript AJAX -->
{{csrfMeta}}
<!-- Output: <meta name="csrf-token" content="..."> -->

<!-- Raw token value -->
{{csrfToken}}
```

**CSRF API:**
```javascript
const auth = context.services.get('auth');

const token = auth.getCSRFToken(req);
const valid = auth.validateCSRFToken(req, token);
const token = auth.extractCSRFToken(req, ctx);
const middleware = auth.requireCSRF({ exemptPaths, exemptMethods });
const status = auth.getCSRFStatus();
const cleared = auth.clearCSRFTokens();
```

### Session Invalidation

Sessions are automatically invalidated in these scenarios:

| Event | Behavior |
|-------|----------|
| User changes OWN role | Destroy session, redirect to /login |
| Admin changes OTHER user's role | Invalidate all sessions for that user |
| Password changed (self) | Invalidate OTHER sessions, keep current |
| Admin changes other's password | Invalidate all sessions for that user |
| User deleted | Invalidate all sessions before deletion |

### Roles and Permissions

| Role | Permissions |
|------|-------------|
| `admin` | `*` (all) |
| `editor` | `content.create`, `content.read`, `content.update`, `content.delete` |
| `viewer` | `content.read` |

### Default Users

| Username | Password | Role |
|----------|----------|------|
| `admin` | `admin` | admin |
| `editor` | `editor` | editor |

## Rate Limiting

Sliding window algorithm to prevent abuse.

### Configuration

```json
{
  "rateLimit": {
    "enabled": true,
    "login": { "points": 5, "duration": 60, "blockDuration": 300 },
    "api": { "points": 100, "duration": 60 },
    "admin": { "points": 60, "duration": 60 }
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `points` | varies | Max requests allowed in window |
| `duration` | 60 | Time window in seconds |
| `blockDuration` | 0 | Block duration after exceeding (0 = no block) |

### Rate Limit API

```javascript
const ratelimit = context.services.get('ratelimit');

// Check limit
const result = ratelimit.checkLimit(key, { points, duration, blockDuration, reason });
// { allowed, remaining, resetAt, retryAfter, blocked }

// Create configured limiter
const limiter = ratelimit.createLimiter({ points, duration, blockDuration });

// Middleware factory
const middleware = ratelimit.rateLimit({ keyGenerator, points, duration });

// Manual control
ratelimit.blockKey(key, seconds, reason);
ratelimit.clearKey(key);

// Statistics
const stats = ratelimit.getStats();
// { totalRequests, blockedRequests, activeKeys, blockedKeys }

const blocked = ratelimit.getBlocked();
// [{ key, reason, blockedAt, expiresAt }]
```

### Response Headers

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1705123456
```

When blocked:
```
HTTP/1.1 429 Too Many Requests
Retry-After: 300
```

### Default Limits

| Endpoint | Points | Duration | Block |
|----------|--------|----------|-------|
| `/login` | 5 | 60s | 5min |
| `/api/*` | 100 | 60s | - |
| `/admin/*` | 60 | 60s | - |

## Plugin System

Third-party extensions with restricted permissions, separate from core modules.

### Plugin vs Module

| Aspect | Module | Plugin |
|--------|--------|--------|
| Location | `/modules/` | `/plugins/` |
| Manifest | `manifest.json` | `plugin.json` |
| Permissions | Full access | Declared only |
| Configuration | Site-wide | Per-plugin `config.json` |
| Dependencies | Other modules | Other plugins |
| Version check | None | `minCoreVersion` |

### Configuration

```json
{
  "plugins": {
    "enabled": ["seo", "analytics"],
    "directory": "./plugins"
  }
}
```

### Plugin Structure

```
/plugins/<name>/
  plugin.json     # Manifest (required)
  index.js        # Main entry (required)
  config.json     # Plugin-specific config (optional)
```

### Plugin Manifest (plugin.json)

```json
{
  "name": "seo",
  "version": "1.0.0",
  "description": "SEO metadata for content",
  "author": "Developer Name",
  "dependencies": [],
  "minCoreVersion": "0.0.28",
  "permissions": ["content.read", "content.update"],
  "config": {
    "defaultTitle": "My Site"
  }
}
```

### Plugin Permissions

| Permission | Access |
|------------|--------|
| `content.read` | `content.read`, `content.list`, `content.search`, etc. |
| `content.create` | `content.create` |
| `content.update` | `content.update` |
| `content.delete` | `content.remove`, `content.delete` |
| `cache.read` | `cache.get`, `cache.has`, `cache.stats` |
| `cache.write` | `cache.set`, `cache.delete`, `cache.clear` |
| `media.read` | Media file info methods |
| `media.upload` | `media.parseUpload`, `media.saveFile` |
| `media.delete` | `media.deleteFile` |
| `template.render` | All template methods |
| `config.read` | Site and module config access |
| `hooks.register` | `hooks.register` |
| `hooks.trigger` | `hooks.trigger`, `hooks.invoke` |

### Plugin Lifecycle

```javascript
// 1. hook_init - Called when plugin is loaded
export async function hook_init(context) {
  console.log('Plugin initialized');
}

// 2. hook_activate - Called when enabled plugin starts
export async function hook_activate(context) {
  console.log('Plugin activated');
}

// 3. hook_deactivate - Called before plugin unload (hot-swap)
export async function hook_deactivate(context) {
  console.log('Plugin deactivating - cleanup here');
}

// 4. Standard hooks (same as modules)
export function hook_cli(register, context) { }
export function hook_routes(register, context) { }
export function hook_content(register, context) { }
export function hook_middleware(use, context) { }
export function hook_schedule(schedule, context) { }
```

### Plugin Context

Plugins receive a restricted context with only permitted APIs:

```javascript
// Inside plugin hook
export function hook_routes(register, context) {
  // context.plugin - Plugin metadata
  context.plugin.name        // 'seo'
  context.plugin.version     // '1.0.0'
  context.plugin.config      // { defaultTitle: 'My Site' }
  context.plugin.permissions // ['content.read', ...]

  // context.services - Permission-checked services
  const content = context.services.get('content');

  // This works (content.read permission granted)
  const item = content.read('post', 'id');

  // This throws error (content.delete not permitted)
  await content.remove('post', 'id');
  // Error: Plugin 'seo' lacks permission for content.remove
}
```

### Plugin API

```javascript
const plugins = context.services.get('plugins');

// Discovery
const discovered = plugins.discover();
// [{ name, path, manifest, valid, errors }]

// Management
const plugin = plugins.getPlugin('seo');
const list = plugins.listPlugins();
const enabled = plugins.getEnabledPlugins();
const isEnabled = plugins.isEnabled('seo');

// Validation
const result = plugins.validatePlugin(manifest);
// { valid: boolean, errors: string[] }

// Configuration
plugins.savePluginConfig('seo', { defaultTitle: 'New Title' });
```

### CLI Commands

```bash
# List all plugins
node index.js plugins:list

# Enable/disable plugins (requires restart)
node index.js plugins:enable <name>
node index.js plugins:disable <name>

# Create new plugin scaffold
node index.js plugins:create <name>

# Validate plugin
node index.js plugins:validate <name>

# Hot-swap operations (no restart required)
node index.js plugins:activate <name>    # Hot-load and activate
node index.js plugins:deactivate <name>  # Hot-unload
node index.js plugins:reload <name>      # Reload (deactivate + activate)
```

### Admin UI

| Route | Description |
|-------|-------------|
| `GET /admin/plugins` | List all plugins |
| `GET /admin/plugins/:name` | Plugin details and config |
| `POST /admin/plugins/:name/config` | Save plugin config |
| `POST /admin/plugins/:name/activate` | Hot-activate a plugin |
| `POST /admin/plugins/:name/deactivate` | Hot-deactivate a plugin |
| `POST /admin/plugins/:name/reload` | Hot-reload a plugin |

### Hot-Swap Plugin Operations

Plugins can be activated, deactivated, and reloaded without restarting the server.

**Hot-Swap API:**
```javascript
const plugins = context.services.get('plugins');

// Hot-load and activate (true = hot-swap mode)
await plugins.activatePlugin('seo', true);

// Hot-unload (removes routes, CLI, middleware)
await plugins.deactivatePlugin('seo');

// Reload plugin code (deactivate + fresh import + activate)
await plugins.reloadPlugin('seo');
```

**Plugin Deactivation Lifecycle:**
```javascript
// Optional hook called when plugin is deactivated
export async function hook_deactivate(context) {
  // Clean up resources, close connections, etc.
  console.log('[myplugin] Deactivating...');
}
```

**What Gets Unregistered on Deactivate:**
- All routes registered by the plugin
- All CLI commands registered by the plugin
- All middleware registered by the plugin

**Reloading Plugins:**
When you modify a plugin's code and want to apply changes:
1. The plugin is deactivated (routes/CLI/middleware removed)
2. The plugin module is re-imported with cache-busting
3. Config is reloaded from config.json
4. Plugin context is recreated
5. `hook_init` is called again
6. Plugin is reactivated with `hook_activate`

### Example Plugin

The included `seo` plugin demonstrates:
- Permission-restricted context
- Route registration (`/sitemap.xml`, `/robots.txt`)
- CLI commands (`seo:status`, `seo:sitemap`)
- Plugin configuration

```javascript
// plugins/seo/index.js
export function hook_routes(register, context) {
  register('GET', '/sitemap.xml', async (req, res, params, ctx) => {
    const content = context.services.get('content');
    const types = content.listTypes(); // Works - has content.read
    // Generate sitemap...
  }, 'Generate sitemap.xml');
}
```

## Webhooks

Fire HTTP requests on content events.

### Payload Format

```json
{
  "event": "content:afterCreate",
  "type": "greeting",
  "item": { ... },
  "timestamp": "2024-01-13T10:30:00.000Z"
}
```

### Signature Verification

If secret configured:
```
X-Webhook-Signature: sha256=<hmac-of-body>
```

```javascript
const expectedSig = 'sha256=' + crypto
  .createHmac('sha256', secret)
  .update(body)
  .digest('hex');
```

## Content Revision System

### Overview
Every time content is updated, the previous version is automatically saved as a revision.

### Configuration

```json
{
  "revisions": {
    "enabled": true,
    "maxPerItem": 10
  }
}
```

### Storage Structure

```
/content/<type>/
  <id>.json              # Current version
  .revisions/            # Hidden revisions directory
    <id>/                # Revisions for this item
      2024-01-15T12-00-00.000Z.json
      2024-01-15T11-00-00.000Z.json
```

### Revision API

```javascript
const content = context.services.get('content');

// List revisions (newest first)
const revisions = content.getRevisions('type', 'id');
// [{ timestamp: '...', size: 245 }, ...]

// Get specific revision
const oldVersion = content.getRevision('type', 'id', 'timestamp');

// Revert (saves current as new revision first)
const restored = await content.revertTo('type', 'id', 'timestamp');

// Compare revisions (use 'current' for current version)
const diff = content.diffRevisions('type', 'id', 'ts1', 'ts2');
// { ts1, ts2, changes: [{ field, from, to, type }] }

// Prune old revisions
const deleted = content.pruneRevisions('type', 'id', keepCount);
```

## Import/Export System

### Export Format

```json
{
  "version": "0.0.25",
  "exported": "2024-01-15T12:00:00Z",
  "content": {
    "greeting": [
      { "id": "123-abc", "type": "greeting", "created": "...", ... }
    ]
  },
  "config": {
    "site": { "name": "...", "theme": "...", ... },
    "modules": { "enabled": ["admin", "users", ...] }
  },
  "media": [
    { "contentId": "...", "path": "/media/2024/01/photo.jpg", "size": 12345 }
  ]
}
```

### Transfer API

```javascript
const transfer = context.services.get('transfer');

// Export
const data = transfer.exportContent(['greeting'], { includeMedia: false });
const siteData = transfer.exportSite({ includeMedia: true });

// Import
const result = await transfer.importContent(data, {
  overwrite: false,
  dryRun: true,
});

const siteResult = await transfer.importSite(data, {
  overwrite: false,
  dryRun: false,
  importConfig: false,
});

// Validation
const validation = transfer.validateExport(data);
const compat = transfer.checkCompatibility(data);
```

### Import Options

| Option | Default | Description |
|--------|---------|-------------|
| `overwrite` | `false` | Replace existing content with matching IDs |
| `dryRun` | `false` | Preview changes without committing |
| `importConfig` | `false` | Import site.json and modules.json |

## CLI Commands

### Core Commands

| Command | Description |
|---------|-------------|
| `help` | Show all commands |
| `modules:list` | List discovered modules |
| `modules:enable <name>` | Enable a module |
| `modules:disable <name>` | Disable a module |
| `modules:deps` | Show dependency tree |
| `config:show` | Display configuration |
| `watcher:log [n]` | Show watcher logs |
| `content:types` | List content types |
| `content:list <type>` | List content (--page, --limit, --search, --filter) |
| `content:search <query>` | Search all content |
| `content:create <type> <json>` | Create content |
| `content:delete <type> <id>` | Delete content |
| `content:revisions <type> <id>` | List revisions for content item |
| `content:revert <type> <id> <ts>` | Revert content to a revision |
| `content:diff <type> <id> <ts1> <ts2>` | Show diff between revisions |
| `revisions:prune [--keep=N]` | Prune old revisions (default: keep 10) |
| `cache:stats` | Show cache statistics |
| `cache:clear [pattern]` | Clear cache |
| `csrf:status` | Show CSRF protection status |
| `csrf:clear` | Clear all CSRF tokens |
| `ratelimit:status` | Show rate limit statistics |
| `ratelimit:clear <key>` | Clear rate limit for a key |
| `ratelimit:block <key> <seconds>` | Block a key for duration |
| `tasks:list` | Show scheduled tasks |
| `tasks:run <name>` | Run task manually |
| `tasks:history [name]` | Show task history |
| `export:content [types...]` | Export content to JSON (--output, --include-media) |
| `export:site` | Full site export (--output) |
| `import:content <file>` | Import content (--dry-run, --overwrite) |
| `import:site <file>` | Import full site (--dry-run, --import-config) |
| `search:query <query>` | Search content (--type, --limit) |
| `search:rebuild [type]` | Rebuild search index |
| `search:stats` | Show search index statistics |
| `i18n:list` | List available locales |
| `i18n:export <locale>` | Export translations (--output=file) |
| `i18n:import <locale> <file>` | Import translations (--replace) |
| `i18n:missing [locale]` | Show missing translations |
| `i18n:add <code>` | Add new locale |
| `i18n:set <locale> <key> <value>` | Set a translation key |
| `audit:list [--user=X] [--action=X] [--days=N]` | Query audit logs |
| `audit:stats [--days=N]` | Show audit statistics |
| `audit:export [--from=X] [--to=X] [--output=X]` | Export audit logs |
| `audit:prune [--days=N]` | Delete old audit logs |
| `queue:list [--status=X]` | List queue jobs |
| `queue:run [--limit=N]` | Process pending jobs |
| `queue:status <id>` | Show job status and progress |
| `queue:cancel <id>` | Cancel a pending job |
| `queue:retry <id>` | Retry a failed job |
| `queue:clear [--status=X]` | Clear jobs by status |
| `queue:stats` | Show queue statistics |
| `bulk:publish <type> <id,id,id>` | Bulk publish content |
| `bulk:unpublish <type> <id,id,id>` | Bulk unpublish content |
| `bulk:delete <type> <id,id,id>` | Bulk delete content |
| `bulk:update <type> <id,id,id> --field.X=Y` | Bulk update content |
| `oembed:fetch <url>` | Fetch oEmbed data for URL |
| `oembed:providers` | List registered oEmbed providers |
| `oembed:cache` | Show oEmbed cache statistics |
| `oembed:clear-cache [url]` | Clear oEmbed cache |
| `oembed:check <url>` | Check if URL is supported |
| `fields:list` | List all registered field types |
| `fields:types` | Show detailed field type information |
| `fields:info <type>` | Show info about a specific field type |
| `validators:list` | List all registered validators |
| `validate:content <type> <id>` | Validate existing content item |
| `validate:type <type>` | Validate all content of a type |
| `validate:all` | Validate all content |
| `validate:rules <type>` | Show validation rules for a type |
| `preview:create <type> <id>` | Create a preview token |
| `preview:list [type] [id]` | List active preview tokens |
| `preview:revoke <token>` | Revoke a preview token |
| `preview:cleanup` | Remove expired tokens |
| `preview:url <type> <id>` | Create and output preview URL |
| `preview:stats` | Show preview token statistics |
| `email:test <email>` | Send a test email |
| `email:verify` | Verify email configuration |
| `email:log [limit]` | Show recent email log |
| `email:templates` | List email templates |
| `notify:send <userId> [type] [title] [message]` | Send a notification |
| `notify:list <userId> [--unread]` | List notifications for a user |
| `notify:read <id \| --all userId>` | Mark notification(s) as read |
| `notify:stats` | Show notification statistics |
| `notify:types` | List notification types |
| `notify:prefs <userId> [type] [channel] [on\|off]` | View/set user preferences |
| `backup:create [--incremental]` | Create a backup |
| `backup:list [--limit=N]` | List backups |
| `backup:info <id>` | Show backup details |
| `backup:verify <id>` | Verify backup integrity |
| `backup:restore <id> [--dry-run] [--content-only]` | Restore from backup |
| `backup:delete <id>` | Delete a backup |
| `backup:prune [--dry-run]` | Apply retention policy |
| `backup:stats` | Show backup statistics |
| `analytics:summary [--period=X]` | Show analytics summary |
| `analytics:content [type] [--top=N]` | Show top content |
| `analytics:users [--top=N]` | Show most active users |
| `analytics:events [--type=X] [--days=N]` | Show event log |
| `analytics:aggregate` | Run manual aggregation |
| `analytics:stats` | Show analytics system stats |
| `analytics:cleanup [--dry-run]` | Clean up old data |

### Module Commands

| Command | Module | Description |
|---------|--------|-------------|
| `hello:greet [name]` | hello | Greet someone |
| `hello:info` | hello | Show module info |
| `test:ping` | test | Respond with pong |
| `admin:stats` | admin | Dashboard statistics |
| `users:list` | users | List all users with roles and last login |
| `users:delete <username>` | users | Delete a user (with safeguards) |
| `users:role <username> <role>` | users | Change user role |
| `sessions:list` | users | Show active sessions |
| `sessions:clear <username>` | users | Invalidate all sessions for user |

## HTTP Routes

### Core Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Site information |
| GET | `/health` | Health check |
| GET | `/public/*` | Static files |
| GET | `/content` | List content types |
| GET | `/content/:type` | List content (paginated) |
| GET | `/content/:type/:id` | Get content item |
| POST | `/content/:type` | Create content |
| PUT | `/content/:type/:id` | Update content |
| DELETE | `/content/:type/:id` | Delete content |

### Auth Routes (users module)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/login` | Login form |
| POST | `/login` | Process login |
| GET | `/logout` | Logout |
| GET | `/admin/users` | List users |
| GET | `/admin/users/new` | Create user form |
| POST | `/admin/users` | Create user |
| GET | `/admin/users/:id/edit` | Edit user form |
| POST | `/admin/users/:id` | Update user |
| POST | `/admin/users/:id/delete` | Delete user |
| GET | `/admin/users/:id/password` | Change password form |
| POST | `/admin/users/:id/password` | Change password |
| GET | `/admin/users/:id/tokens` | List API tokens |
| POST | `/admin/users/:id/tokens` | Create token |
| POST | `/admin/users/:id/tokens/:tokenId/delete` | Revoke token |

### API Routes (users module)

| Method | Path | Permission |
|--------|------|------------|
| GET | `/api/content/:type` | content.read |
| GET | `/api/content/:type/:id` | content.read |
| POST | `/api/content/:type` | content.create |
| PUT | `/api/content/:type/:id` | content.update |
| DELETE | `/api/content/:type/:id` | content.delete |
| GET | `/api/media` | content.read |
| POST | `/api/media` | content.create |
| DELETE | `/api/media/:id` | content.delete |
| GET | `/api/search` | Full-text search |

### Admin Routes

| Method | Path | Module |
|--------|------|--------|
| GET | `/admin` | admin |
| GET | `/admin/content` | admin |
| GET | `/admin/content/:type` | admin |
| GET | `/admin/content/:type/new` | admin |
| POST | `/admin/content/:type` | admin |
| GET | `/admin/content/:type/:id/edit` | admin |
| POST | `/admin/content/:type/:id` | admin |
| POST | `/admin/content/:type/:id/delete` | admin |
| GET | `/admin/content/:type/:id/revisions` | admin |
| GET | `/admin/content/:type/:id/revisions/:ts` | admin |
| POST | `/admin/content/:type/:id/revisions/:ts/revert` | admin |
| GET | `/admin/content/:type/:id/revisions/:ts/diff` | admin |
| GET | `/admin/modules` | admin |
| GET | `/admin/cache` | admin |
| POST | `/admin/cache/clear` | admin |
| GET | `/admin/ratelimit` | admin |
| POST | `/admin/ratelimit/:key/clear` | admin |
| GET | `/admin/export` | admin |
| POST | `/admin/export/content` | admin |
| POST | `/admin/export/site` | admin |
| GET | `/admin/import` | admin |
| POST | `/admin/import` | admin |
| GET | `/admin/webhooks` | webhooks |
| GET | `/admin/webhooks/new` | webhooks |
| POST | `/admin/webhooks` | webhooks |
| POST | `/admin/webhooks/:id/delete` | webhooks |
| POST | `/admin/webhooks/:id/test` | webhooks |
| GET | `/admin/media` | media |
| GET | `/admin/media/upload` | media |
| POST | `/admin/media/upload` | media |
| POST | `/admin/media/:id/delete` | media |
| GET | `/admin/tasks` | tasks |
| POST | `/admin/tasks/:name/run` | tasks |
| GET | `/admin/tasks/:name/history` | tasks |
| GET | `/admin/search` | admin (search) |
| GET | `/admin/search/status` | admin (search) |
| POST | `/admin/search/rebuild` | admin (search) |
| GET | `/admin/i18n` | admin (i18n) |
| GET | `/admin/i18n/new` | admin (i18n) |
| POST | `/admin/i18n/new` | admin (i18n) |
| GET | `/admin/i18n/:code` | admin (i18n) |
| POST | `/admin/i18n/:code` | admin (i18n) |
| POST | `/admin/i18n/:code/add-key` | admin (i18n) |
| GET | `/admin/i18n/:code/export` | admin (i18n) |
| POST | `/admin/i18n/import` | admin (i18n) |
| GET | `/admin/content/:type/:id/translate` | admin (i18n) |
| GET | `/admin/content/:type/:id/translate/:locale` | admin (i18n) |
| POST | `/admin/content/:type/:id/translate/:locale` | admin (i18n) |
| POST | `/admin/content/:type/:id/translate/:locale/delete` | admin (i18n) |
| GET | `/admin/audit` | admin (audit) |
| GET | `/admin/audit/export` | admin (audit) |
| GET | `/admin/audit/user/:id` | admin (audit) |
| GET | `/admin/audit/content/:type/:id` | admin (audit) |

### Other Module Routes

| Method | Path | Module |
|--------|------|--------|
| GET | `/hello` | hello |
| GET | `/hello/page` | hello |
| GET | `/hello/:name` | hello |
| GET | `/ping` | test |
| GET | `/media/*` | media (file serving) |

## Middleware

### Registered Middleware

| Name | Path | Module | Purpose |
|------|------|--------|---------|
| `requestLog` | global | core | Log all requests |
| `responseTime` | global | core | Add X-Response-Time header |
| `auth` | `/admin` | users | Session authentication |
| `api-auth` | `/api` | users | API token authentication |
| `api-cache` | `/api` | users | Cache API responses |
| `webhooks` | `/admin/webhooks` | webhooks | Webhook-specific middleware |
| `access` | `/admin` | admin | Access control |
| `csrf` | `/admin` | admin | CSRF token validation |
| `media-serve` | `/media` | media | Serve media files |

## Configuration Files

### config/site.json

```json
{
  "name": "My Site",
  "version": "0.0.33",
  "port": 3000,
  "env": "development",
  "theme": "default",
  "sessionSecret": "your-secret-key-min-16-chars",
  "i18n": {
    "enabled": true,
    "defaultLocale": "en",
    "locales": ["en", "es", "fr"],
    "fallback": true
  },
  "cache": {
    "enabled": true,
    "ttl": 300,
    "apiTtl": 60
  },
  "revisions": {
    "enabled": true,
    "maxPerItem": 10
  },
  "csrf": {
    "enabled": true,
    "tokenExpiry": 3600
  },
  "rateLimit": {
    "enabled": true,
    "login": {
      "points": 5,
      "duration": 60,
      "blockDuration": 300
    },
    "api": {
      "points": 100,
      "duration": 60
    },
    "admin": {
      "points": 60,
      "duration": 60
    }
  },
  "search": {
    "enabled": true,
    "minWordLength": 2,
    "fuzzy": false
  },
  "media": {
    "maxFileSize": 10485760
  }
}
```

### config/modules.json

```json
{
  "enabled": [
    "hello",
    "test",
    "users",
    "webhooks",
    "media",
    "admin",
    "tasks"
  ]
}
```

## Creating a New Module

### 1. Create Directory Structure

```
modules/mymodule/
├── manifest.json
├── index.js
└── templates/      (optional)
    └── page.html
```

### 2. Create manifest.json

```json
{
  "name": "mymodule",
  "version": "1.0.0",
  "description": "What this module does",
  "dependencies": ["users"],
  "provides": ["myservice"]
}
```

### 3. Create index.js

```javascript
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadTemplate(name) {
  return readFileSync(join(__dirname, 'templates', name), 'utf-8');
}

// Boot hook - initialize module
export async function hook_boot(context) {
  console.log('[mymodule] Initializing...');
}

// Ready hook - post-initialization
export async function hook_ready(context) {
  console.log('[mymodule] Ready!');
}

// CLI commands
export function hook_cli(register, context) {
  register('mymodule:status', async (args, ctx) => {
    console.log('Status: OK');
  }, 'Show module status');
}

// HTTP routes
export function hook_routes(register, context) {
  const server = context.services.get('server');
  const template = context.services.get('template');

  register('GET', '/mymodule', async (req, res, params, ctx) => {
    server.json(res, { status: 'ok' });
  }, 'Module endpoint');

  register('GET', '/mymodule/page', async (req, res, params, ctx) => {
    const pageTemplate = loadTemplate('page.html');
    const html = template.renderString(pageTemplate, { title: 'My Page' });
    server.html(res, html);
  }, 'Module page');
}

// Content types
export function hook_content(register, context) {
  register('mytype', {
    name: { type: 'string', required: true },
    value: { type: 'number', required: false },
  });
}

// Middleware
export function hook_middleware(use, context) {
  use(async (req, res, ctx, next) => {
    console.log(`[mymodule] ${req.method} ${req.url}`);
    await next();
  }, 'logger', '/mymodule');
}

// Scheduled tasks
export function hook_schedule(schedule, context) {
  schedule('mymodule:cleanup', '0 * * * *', async () => {
    console.log('[mymodule] Running cleanup...');
    return 'done';
  }, { description: 'Hourly cleanup' });
}
```

### 4. Enable the Module

Add to `config/modules.json`:
```json
{
  "enabled": ["...", "mymodule"]
}
```

Or use CLI:
```bash
node index.js modules:enable mymodule
```

## Template System

Mustache-like syntax:

```html
<!-- Variables -->
{{title}}
{{user.name}}

<!-- HTML escaping (automatic) -->
{{userInput}}

<!-- Conditionals -->
{{#if loggedIn}}
  <p>Welcome!</p>
{{else}}
  <p>Please log in.</p>
{{/if}}

<!-- Loops -->
{{#each items}}
  <li>{{name}} - Index: {{@index}}</li>
{{/each}}

<!-- Special loop variables -->
{{@index}}  <!-- 0-based index -->
{{@first}}  <!-- true if first item -->
{{@last}}   <!-- true if last item -->

<!-- CSRF helpers -->
{{csrfField}}  <!-- Hidden input -->
{{csrfMeta}}   <!-- Meta tag -->
{{csrfToken}}  <!-- Raw token -->

<!-- i18n helpers -->
{{t "key"}}                    <!-- Translate key -->
{{t "key" param="value"}}      <!-- With interpolation -->
{{locale}}                     <!-- Current locale code -->
```

### Template API

```javascript
const template = context.services.get('template');

template.render('page.html', data);
template.renderString('<h1>{{title}}</h1>', data);
template.renderWithLayout('layout.html', content, data);
template.escapeHtml(userInput);
```

## Implemented Features

- [x] Five-phase boot sequence (INIT → DISCOVER → REGISTER → BOOT → READY)
- [x] Module discovery with manifest.json
- [x] Hook system with priorities and async support
- [x] Service container with lazy instantiation
- [x] JSON config loading with deep freeze
- [x] Filesystem watcher with hot reload
- [x] CLI system with source tracking
- [x] HTTP server with request logging
- [x] Router with path parameters and regex matching
- [x] Response helpers (json, text, html)
- [x] Dual-mode entry point (server/CLI)
- [x] Quiet mode for CLI
- [x] Flat-file content storage
- [x] Content type registration via hooks
- [x] Content CRUD with validation
- [x] Content REST endpoints
- [x] Content CLI commands
- [x] Schema validation (types, required)
- [x] JSON body parsing
- [x] Static file serving
- [x] MIME type detection
- [x] Directory traversal protection
- [x] Template engine (variables, conditionals, loops)
- [x] Layout system with {{content}}
- [x] Theme support
- [x] HTML escaping
- [x] Admin module with dashboard
- [x] Form data parsing
- [x] Flash messages
- [x] Middleware system (global and path-specific)
- [x] Request logging middleware
- [x] Response time header
- [x] Session-based authentication
- [x] Password hashing (SHA-256 + salt)
- [x] Users module with login/logout
- [x] Admin route protection
- [x] Default admin/editor users
- [x] Role-based access control
- [x] Permission checking
- [x] API tokens (Bearer auth)
- [x] Token management UI
- [x] RESTful API endpoints
- [x] Module dependencies
- [x] Dependency validation
- [x] Circular dependency detection
- [x] Topological sort for load order
- [x] Content lifecycle hooks
- [x] Webhook system
- [x] Webhook signatures (HMAC-SHA256)
- [x] Webhook testing
- [x] Content pagination
- [x] Content search
- [x] In-memory caching with TTL
- [x] Cache invalidation on writes
- [x] API response caching
- [x] Cache admin UI and CLI
- [x] Media upload system
- [x] Multipart form parsing
- [x] Media file storage (year/month)
- [x] Media admin UI
- [x] Media API endpoints
- [x] Video support (mp4, webm, mov, etc.)
- [x] Range requests (HTTP 206)
- [x] Scheduled tasks with cron expressions
- [x] Task admin UI
- [x] Task CLI commands
- [x] Task run history
- [x] Import/export system
- [x] Content export (JSON format)
- [x] Site export (content + config + media manifest)
- [x] Content import with dry-run preview
- [x] Site import with config option
- [x] Export/import CLI commands
- [x] Export/import admin UI
- [x] Content revision system
- [x] Automatic revision on update
- [x] Revision list/view/revert
- [x] Revision diff comparison
- [x] Configurable max revisions per item
- [x] Revision pruning
- [x] CSRF protection
- [x] Session-bound CSRF tokens
- [x] Token validation middleware
- [x] Template helpers ({{csrfField}}, {{csrfMeta}})
- [x] CSRF CLI commands
- [x] Rate limiting (sliding window algorithm)
- [x] Request throttling by IP/session
- [x] Configurable limits per endpoint type
- [x] Automatic blocking with expiry
- [x] Rate limit CLI commands
- [x] Rate limit admin UI
- [x] User management UI (edit, delete)
- [x] User email and lastLogin fields
- [x] Password change with confirmation
- [x] Prevent delete own account/last admin
- [x] Username uniqueness validation
- [x] Email format validation
- [x] User management CLI commands
- [x] Active session tracking
- [x] Session invalidation on role change
- [x] Session invalidation on password change
- [x] Session invalidation on user deletion
- [x] Session management CLI commands
- [x] Content field filtering with operators
- [x] Filter operators: eq, ne, gt, gte, lt, lte, contains, startswith, endswith, in
- [x] Filter UI in admin content list
- [x] Filter support in API endpoints
- [x] Content relationships (belongsTo, belongsToMany)
- [x] Relation field type in schemas
- [x] Populate option for read() and list()
- [x] Referential integrity validation
- [x] Reverse queries with getRelated()
- [x] Reference checking before delete
- [x] Plugin system with permission model
- [x] Plugin lifecycle (init, activate, deactivate)
- [x] Plugin permission enforcement
- [x] Plugin configuration (config.json)
- [x] Plugin CLI commands
- [x] Plugin admin UI
- [x] Example SEO plugin
- [x] Hot-swap plugin capability
- [x] activatePlugin() - hot-load without restart
- [x] deactivatePlugin() - hot-unload without restart
- [x] reloadPlugin() - deactivate then activate
- [x] Route/CLI/middleware unregistration
- [x] Hot-swap admin UI buttons
- [x] Hot-swap CLI commands
- [x] Plugin filesystem watcher
- [x] Detect plugin.json, index.js, config.json changes
- [x] Plugin change notifications (console prompts)
- [x] onPluginChange() subscription API
- [x] plugins:changes CLI command
- [x] Debounced change detection
- [x] Plugin auto-reload mode
- [x] autoReload config option (true | false | "prompt")
- [x] plugins:autoload CLI command
- [x] plugins:watch CLI command
- [x] plugins:reload-changed CLI command
- [x] Admin UI changed plugin badges
- [x] Admin UI auto-reload status indicator
- [x] One-click reload button for changed plugins
- [x] Content workflow system
- [x] Publishing statuses (draft, pending, published, archived)
- [x] Status change hooks (beforeStatusChange, afterStatusChange, published, unpublished)
- [x] Scheduled publishing with auto-publish task
- [x] Public API filtering (only published content)
- [x] Workflow CLI commands
- [x] Workflow admin UI with status tabs and badges
- [x] Full-text search indexing
- [x] Inverted index with term positions
- [x] Multi-word queries (AND default)
- [x] Phrase search with quotes
- [x] Field-specific search (field:term)
- [x] Term exclusion (-term)
- [x] Relevance scoring (TF-IDF)
- [x] Search result highlighting
- [x] Auto-indexing on content changes
- [x] Search CLI commands
- [x] Search admin UI
- [x] Search API endpoint
- [x] Internationalization (i18n) system
- [x] UI translation files (/locales/*.json)
- [x] Translation helper {{t "key"}}
- [x] Interpolation support {{param}}
- [x] Locale detection (query > cookie > Accept-Language > default)
- [x] Content translation support (_translations field)
- [x] Translatable fields in schema
- [x] i18n CLI commands
- [x] i18n admin UI
- [x] Content translation UI
- [x] Audit logging system
- [x] Action tracking (auth, content, user, plugin, config, export/import)
- [x] Audit log storage (/logs/audit/year/month.json)
- [x] Audit query with filters (user, action, date, result)
- [x] Audit statistics and reporting
- [x] Audit log export (JSON, CSV)
- [x] Audit log pruning with retention
- [x] Audit CLI commands
- [x] Audit admin UI

## Known Limitations

### Security
- SHA-256 for passwords (use bcrypt in production)
- No HTTPS enforcement
- Sessions in memory (lost on restart)

### Scalability
- In-memory cache (lost on restart)
- Flat-file storage (not for high traffic)
- Single-server only

### Features
- No content versioning (revisions only)
- No file size limits enforced client-side

## Content Workflow System (v0.0.31)

### Overview
Publishing workflow with content statuses and scheduled publishing.

### Configuration

```json
{
  "workflow": {
    "enabled": true,
    "defaultStatus": "draft",
    "scheduleCheckInterval": 60
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `false` | Enable workflow system |
| `defaultStatus` | `draft` | Default status for new content |
| `scheduleCheckInterval` | `60` | Seconds between scheduled publish checks |

### Content Statuses

| Status | Description | Public Visibility |
|--------|-------------|-------------------|
| `draft` | Work in progress | Hidden |
| `pending` | Awaiting review or scheduled | Hidden |
| `published` | Live content | Visible |
| `archived` | No longer active | Hidden |

### Workflow Fields

Content items with workflow enabled have these additional fields:

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Current workflow status |
| `publishedAt` | ISO timestamp | When content was first published |
| `scheduledAt` | ISO timestamp | When pending content should auto-publish |

### Workflow API

```javascript
const content = context.services.get('content');

// Get workflow config
const config = content.getWorkflowConfig();
// { enabled, defaultStatus, scheduleCheckInterval, statuses }

// Change status
await content.setStatus('post', 'id', 'published');
await content.setStatus('post', 'id', 'pending', { scheduledAt: '2024-02-01T10:00:00Z' });

// Shortcuts
await content.publish('post', 'id');
await content.unpublish('post', 'id');
await content.archive('post', 'id');
await content.schedulePublish('post', 'id', '2024-02-01T10:00:00Z');

// Filter by status
const drafts = content.getByStatus('post', 'draft');
const published = content.getByStatus('post', 'published');
const all = content.getByStatus('post', 'all');

// Process scheduled content (auto-publish)
const published = await content.processScheduled();
// Returns: [{ type, id, title }, ...]

// Public API (only published by default)
const publicItems = content.listPublic('post');
const publicItem = content.readPublic('post', 'id');

// Admin API (all statuses)
const allItems = content.listPublic('post', { includeAll: true });
const anyItem = content.readPublic('post', 'id', { includeAll: true });
```

### Workflow Hooks

```javascript
// Before status change - can throw to prevent
hooks.register('content:beforeStatusChange', async ({ type, id, from, to }) => {
  if (to === 'published' && !hasApproval(type, id)) {
    throw new Error('Approval required');
  }
});

// After status change
hooks.register('content:afterStatusChange', async ({ type, id, from, to, item }) => {
  console.log(`${type}/${id} changed from ${from} to ${to}`);
});

// When content is published
hooks.register('content:published', async ({ type, item }) => {
  notifySubscribers(item);
});

// When content is unpublished
hooks.register('content:unpublished', async ({ type, item }) => {
  clearCache(item);
});
```

### Per-Type Workflow Options

Restrict status transitions in content type schema:

```javascript
export function hook_content(register, context) {
  register('article', {
    title: { type: 'string', required: true },
    _workflow: {
      allowedTransitions: {
        draft: ['pending', 'published'],
        pending: ['draft', 'published'],
        published: ['draft', 'archived'],
        archived: ['draft'],
      }
    }
  });
}
```

### CLI Commands

```bash
# Publish content
node index.js content:publish <type> <id>
# → Published post/abc123

# Unpublish content
node index.js content:unpublish <type> <id>

# Archive content
node index.js content:archive <type> <id>

# Schedule publishing
node index.js content:schedule <type> <id> <datetime>
# → Scheduled post/abc123 for 2024-02-01T10:00:00Z

# Show content status
node index.js content:status <type> <id>
# → post/abc123: published (published at Jan 15, 2024)

# Process scheduled content (run manually)
node index.js workflow:process
# → Published 3 item(s)

# Show workflow status
node index.js workflow:status
# → Workflow: enabled
# → Default status: draft
# → Pending items: 5
# → Scheduled: 2
```

### Scheduled Task

The `workflow:publish` task runs every minute to check for scheduled content:

```javascript
// modules/tasks/index.js
schedule('workflow:publish', '* * * * *', async () => {
  const published = await content.processScheduled();
  return `Published ${published.length} item(s)`;
}, { description: 'Auto-publish scheduled content' });
```

### Admin Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/admin/content/:type/:id/publish` | Publish content |
| POST | `/admin/content/:type/:id/unpublish` | Unpublish content |
| POST | `/admin/content/:type/:id/archive` | Archive content |
| POST | `/admin/content/:type/:id/schedule` | Schedule publishing |

### Admin UI

The admin content list includes:
- **Status tabs**: Filter by All, Draft, Pending, Published, Archived
- **Status badges**: Color-coded status indicator on each item
- **Publish/Unpublish buttons**: Quick actions in item list
- **Scheduled info**: Shows scheduled date for pending items

The admin content form includes:
- **Status dropdown**: Change status directly
- **Workflow actions**: Publish/Unpublish/Archive buttons
- **Schedule form**: Date picker for scheduled publishing
- **Status metadata**: Shows current status, published date, scheduled date

---

## Plugin Filesystem Watcher (v0.0.30)

### Overview
Automatically detects plugin file changes and prompts for reload.

### Watched Files
- `plugin.json` - Plugin manifest changes
- `index.js` - Plugin code changes
- `config.json` - Plugin configuration changes
- Other files - General file changes

### Change Detection
When a plugin file changes:
1. The watcher logs the change with timestamp
2. If the plugin is active, a console prompt suggests reload
3. Subscribers are notified via `onPluginChange()` callback

### API

**Subscribe to plugin changes:**
```javascript
import * as watcher from './core/watcher.js';

const unsubscribe = watcher.onPluginChange((change) => {
  console.log(`Plugin ${change.pluginName} changed (${change.changeType})`);
  // change.changeType: 'code', 'manifest', 'config', 'file', 'created', 'deleted'
});

// Later: unsubscribe to stop receiving notifications
unsubscribe();
```

**Get recent plugin changes:**
```javascript
const changes = watcher.getRecentPluginChanges(10);
// Returns array of { timestamp, type, path, message }
```

### CLI Commands

```bash
# Show recent plugin file changes
node index.js plugins:changes [limit]

# Example output:
#   + [12:34:56] plugins/seo/index.js
#       Plugin code changed: seo — reload to apply
```

### Console Output
When an active plugin's code changes:
```
[watcher] Plugin 'seo' changed (code) — use 'plugins:reload seo' to apply
```

---

## Full-Text Search System (v0.0.32)

### Overview
Inverted index-based full-text search across all content with relevance scoring and highlighting.

### Configuration

```json
{
  "search": {
    "enabled": true,
    "minWordLength": 2,
    "fuzzy": false
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `false` | Enable search indexing |
| `minWordLength` | `2` | Minimum word length to index |
| `fuzzy` | `false` | Enable fuzzy matching for typos |

### Index Structure

```
/content/.search/
  index.json    # Inverted index
  meta.json     # Index metadata
```

The inverted index maps terms to document locations:
```javascript
{
  "hello": [
    { type: "greeting", id: "abc", field: "message", positions: [0, 15], tf: 0.5, weight: 1 }
  ]
}
```

### Searchable Fields

Mark fields as searchable in content type schemas:

```javascript
export function hook_content(register, context) {
  register('article', {
    title: { type: 'string', searchable: true, weight: 2 },
    body: { type: 'string', searchable: true, weight: 1 },
    author: { type: 'string' },  // Not indexed (searchable: false by default)
  });
}
```

### Search Query Syntax

| Syntax | Example | Description |
|--------|---------|-------------|
| Simple | `hello world` | AND search for all terms |
| Phrase | `"hello world"` | Exact phrase match |
| Field | `title:welcome` | Search in specific field |
| Exclude | `-draft` | Exclude documents with term |
| Combined | `title:welcome -archived` | Mix multiple operators |

### Search API

```javascript
const search = context.services.get('search');

// Build/rebuild index
const result = search.buildIndex();         // All types
const result = search.buildIndex('article'); // Single type

// Index single item
search.indexItem('article', item);

// Remove from index
search.removeFromIndex('article', 'itemId');

// Search
const results = search.search('hello world', {
  types: ['article', 'greeting'],  // Limit to types
  fields: ['title', 'body'],       // Limit to fields
  limit: 20,                       // Max results
  offset: 0,                       // Pagination
  highlight: true,                 // Include snippets
});
// Returns: { results, total, query, took }

// Get statistics
const stats = search.getStats();
```

### Auto-Indexing

Content changes are automatically indexed via hooks:
- `content:afterCreate` — Index new item
- `content:afterUpdate` — Re-index item
- `content:afterDelete` — Remove from index

### CLI Commands

```bash
# Search content
node index.js search:query "hello world"
node index.js search:query "title:welcome" --type=article --limit=10

# Rebuild index
node index.js search:rebuild          # All types
node index.js search:rebuild article  # Single type

# View statistics
node index.js search:stats
```

**Example Output:**
```
$ node index.js search:rebuild
Rebuilding search index...
Indexed 45 items across 5 types
  article: 20 items, 15234 terms
  greeting: 15 items, 892 terms
  user: 10 items, 156 terms

$ node index.js search:query "hello world"
Search results for "hello world" (5 found, 12ms):

  [0.95] greeting/abc123 - Hello World Greeting
         "...says <<Hello>> <<World>> to everyone..."
  [0.82] article/def456 - Welcome Post
         "...<<Hello>> and welcome to the <<world>>..."
```

### REST API

```
GET /api/search?q=hello&type=article&limit=20&highlight=true
```

Response:
```json
{
  "results": [
    {
      "type": "article",
      "id": "abc123",
      "score": 0.95,
      "item": { ... },
      "highlights": {
        "title": "...<<Hello>> World...",
        "body": "...says <<hello>> to..."
      }
    }
  ],
  "total": 5,
  "query": "hello",
  "took": 12
}
```

### Admin Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/search` | Search admin page |
| GET | `/admin/search/status` | Index statistics (JSON) |
| POST | `/admin/search/rebuild` | Rebuild entire index |

### Relevance Scoring

Results are scored using TF-IDF:
- **TF (Term Frequency)**: How often the term appears in the document
- **IDF (Inverse Document Frequency)**: How rare the term is across all documents
- **Field Weight**: Higher-weighted fields boost score

```
score = TF × IDF × field_weight
```

### Text Processing

1. **Tokenization**: Split on whitespace, remove punctuation
2. **Normalization**: Lowercase all text
3. **Stemming**: Remove common suffixes (ing, ed, s, er, etc.)
4. **Stop Words**: Filter common words (the, a, is, are, etc.)

---

## Internationalization System (v0.0.33)

### Overview
Multi-language support for both UI strings and content translations.

### Configuration

```json
{
  "i18n": {
    "enabled": true,
    "defaultLocale": "en",
    "locales": ["en", "es", "fr"],
    "fallback": true
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `false` | Enable i18n system |
| `defaultLocale` | `en` | Default/fallback locale |
| `locales` | `["en"]` | List of supported locales |
| `fallback` | `true` | Fall back to default if translation missing |

### Translation File Structure

```
/locales/
  en.json    # Default English
  es.json    # Spanish
  fr.json    # French
```

**Translation file format:**
```json
{
  "common.save": "Save",
  "common.cancel": "Cancel",
  "content.created": "Created {{type}} successfully",
  "errors.not_found": "{{type}} with ID {{id}} not found"
}
```

### i18n API

```javascript
const i18n = context.services.get('i18n');

// Basic translation
i18n.t('common.save');                    // "Save"
i18n.t('content.created', { type: 'article' }); // "Created article successfully"

// With specific locale
i18n.t('common.save', {}, 'es');          // "Guardar"

// Locale detection from request
const locale = i18n.getLocale(req);       // Detects from query/cookie/header

// Get available locales
const locales = i18n.getAvailableLocales();
// [{ code: 'en', name: 'English', keyCount: 45, isDefault: true }, ...]

// Manage translations
i18n.setTranslation('es', 'common.save', 'Guardar');
i18n.deleteTranslation('es', 'common.save');
i18n.saveLocale('es');

// Get missing translations
const missing = i18n.getMissingKeys('es');
const stats = i18n.getCompletionStats('es');

// Create new locale
i18n.createLocale('de');

// Export/Import
const data = i18n.exportTranslations('es');
i18n.importTranslations('es', data, merge);

// Configuration
const config = i18n.getConfig();
const enabled = i18n.isEnabled();
i18n.setDefaultLocale('es');
```

### Locale Detection Priority

1. **Query parameter**: `?locale=es`
2. **Cookie**: `locale=es`
3. **Accept-Language header**: `Accept-Language: es-ES,es;q=0.9,en;q=0.8`
4. **Default locale**: From config

### Template Helpers

```html
<!-- Translate a key -->
{{t "common.save"}}

<!-- With interpolation -->
{{t "content.created" type="article"}}

<!-- Current locale -->
<html lang="{{locale}}">
```

### Content Translation

Content items can store translations for each locale:

```json
{
  "id": "abc123",
  "title": "Hello World",
  "body": "Welcome to the site",
  "_translations": {
    "es": {
      "title": "Hola Mundo",
      "body": "Bienvenido al sitio"
    },
    "fr": {
      "title": "Bonjour le monde",
      "body": "Bienvenue sur le site"
    }
  }
}
```

**Translatable Fields:**

Mark fields in schema:
```javascript
register('article', {
  title: { type: 'string', translatable: true },
  slug: { type: 'string', translatable: false },
  body: { type: 'string', translatable: true },
});
```

Auto-detected translatable fields: `title`, `name`, `description`, `body`, `content`, `summary`, `excerpt`

**Content Translation API:**

```javascript
// Get translated content
const item = i18n.getContentTranslation('article', 'id', 'es');
// Returns merged item with _locale field

// Set content translation
await i18n.setContentTranslation('article', 'id', 'es', {
  title: 'Hola Mundo',
  body: 'Bienvenido...',
});

// Delete content translation
await i18n.deleteContentTranslation('article', 'id', 'es');

// Get translation status
const status = i18n.getContentTranslationStatus('article', 'id');
// { en: { translated: 5, total: 5, percentage: 100 }, es: { translated: 3, total: 5, percentage: 60 } }

// Get translatable fields for a type
const fields = i18n.getTranslatableFields(schema);
```

### CLI Commands

```bash
# List locales
node index.js i18n:list

# Export translations
node index.js i18n:export es
node index.js i18n:export es --output=spanish.json

# Import translations
node index.js i18n:import es spanish.json
node index.js i18n:import es spanish.json --replace

# Show missing translations
node index.js i18n:missing
node index.js i18n:missing es

# Add new locale
node index.js i18n:add de

# Set translation
node index.js i18n:set es common.save Guardar
```

### Admin Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/i18n` | Locales overview |
| GET | `/admin/i18n/new` | Add locale form |
| POST | `/admin/i18n/new` | Create locale |
| GET | `/admin/i18n/:code` | Edit translations |
| POST | `/admin/i18n/:code` | Save translations |
| POST | `/admin/i18n/:code/add-key` | Add new key |
| GET | `/admin/i18n/:code/export` | Download JSON |
| POST | `/admin/i18n/import` | Upload translations |

### Content Translation Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/content/:type/:id/translate` | Translation overview |
| GET | `/admin/content/:type/:id/translate/:locale` | Edit translation |
| POST | `/admin/content/:type/:id/translate/:locale` | Save translation |
| POST | `/admin/content/:type/:id/translate/:locale/delete` | Delete translation |

### Admin UI Features

**Locales List (`/admin/i18n`):**
- Locale list with completion percentages
- Progress bars for translation status
- Quick export buttons
- Import form with file upload

**Translation Editor (`/admin/i18n/:code`):**
- Side-by-side default and target translation
- Search/filter translations
- Filter by missing/translated
- Add new keys inline
- Textarea for long values

**Content Translation (`/admin/content/:type/:id/translate`):**
- Status grid showing completion per locale
- Edit form with original and translation side-by-side
- Delete translation option

---

## Audit Logging System (v0.0.34)

### Overview
Track all significant user actions for security monitoring, compliance, and debugging.

### Configuration

```json
{
  "audit": {
    "enabled": true,
    "retention": 90,
    "logLevel": "info",
    "excludeActions": []
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Enable audit logging |
| `retention` | `90` | Days to keep logs (0 = forever) |
| `logLevel` | `info` | Minimum level to log (info, warning, security) |
| `excludeActions` | `[]` | Actions to exclude from logging |

### Storage Structure

```
/logs/audit/
  2024/
    01.json    # January 2024 logs
    02.json    # February 2024 logs
  2025/
    01.json
```

### Audit Entry Format

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2024-01-15T12:00:00.000Z",
  "action": "content.create",
  "level": "info",
  "userId": "user123",
  "username": "admin",
  "ip": "192.168.1.1",
  "userAgent": "Mozilla/5.0...",
  "details": {
    "type": "article",
    "id": "abc123",
    "title": "New Post"
  },
  "result": "success",
  "error": null
}
```

### Logged Actions

| Category | Actions |
|----------|---------|
| `auth` | `auth.login`, `auth.logout`, `auth.failed` |
| `content` | `content.create`, `content.update`, `content.delete`, `content.publish`, `content.unpublish`, `content.archive` |
| `user` | `user.create`, `user.update`, `user.delete`, `user.role_change` |
| `plugin` | `plugin.activate`, `plugin.deactivate`, `plugin.install` |
| `config` | `config.update` |
| `export` | `export.content`, `export.site` |
| `import` | `import.content`, `import.site` |

### Log Levels

| Level | Actions |
|-------|---------|
| `info` | Standard operations (content CRUD, etc.) |
| `warning` | Failed attempts, validation errors |
| `security` | Authentication, role changes, deletions |

### Audit API

```javascript
const audit = context.services.get('audit');

// Log an action
audit.log('content.create', { type: 'article', id: 'abc' }, { req, user });

// Convenience methods
audit.logAuth('login', user, req);
audit.logContent('create', 'article', 'abc123', user, req, { title: 'New' });
audit.logUser('role_change', targetUser, adminUser, req, { from: 'editor', to: 'admin' });
audit.logPlugin('activate', 'seo', user, req);
audit.logConfig('update', user, req, { field: 'siteName' });
audit.logExport('content', user, req, { types: ['article'] });
audit.logImport('site', user, req, { items: 45 });
audit.logSystem('startup', { version: '0.0.34' });

// Query logs
const result = audit.query({
  action: 'content.create',
  username: 'admin',
  days: 7,
  result: 'success',
}, { limit: 100, offset: 0 });
// Returns: { entries, total, limit, offset, from, to }

// Get by user
const userLogs = audit.getByUser('userId', { limit: 50 });

// Get by content item
const contentLogs = audit.getByContent('article', 'abc123');

// Get statistics
const stats = audit.getStats({ days: 30 });
// { total, byAction, byUser, byResult, byLevel, byDay, topIPs }

// Export logs
const json = audit.exportLogs({ days: 30 }, 'json');
const csv = audit.exportLogs({ action: 'auth.*' }, 'csv');

// Prune old logs
const pruned = audit.prune(90);  // Delete logs older than 90 days
// Returns: { deleted: 1234, files: [...] }

// Get single entry
const entry = audit.getEntry('entry-uuid');

// List log files
const files = audit.listLogFiles();
// [{ year, month, path, size, count }, ...]

// Get unique actions
const actions = audit.getUniqueActions();

// Check configuration
const config = audit.getConfig();
const enabled = audit.isEnabled();

// Flush pending writes
audit.flush();
```

### CLI Commands

```bash
# Query audit logs
node index.js audit:list
node index.js audit:list --user=admin --days=7
node index.js audit:list --action=content.create --result=success
node index.js audit:list --ip=192.168.1.1 --limit=100

# Show statistics
node index.js audit:stats
node index.js audit:stats --days=7

# Export logs
node index.js audit:export --output=audit.json
node index.js audit:export --format=csv --days=30 --output=audit.csv
node index.js audit:export --action=auth.* --user=admin

# Prune old logs
node index.js audit:prune
node index.js audit:prune --days=30
```

**Example Output:**

```
$ node index.js audit:list --days=1
Recent audit events (last 1 days):
============================================================
  2024-01-15 12:00:00 [auth.login] admin from 192.168.1.1
  2024-01-15 12:05:00 [content.create] admin article/abc123 from 192.168.1.1
  2024-01-15 12:10:00 [content.publish] admin article/abc123 from 192.168.1.1
  2024-01-15 12:15:00 [auth.failed] anonymous from 10.0.0.5 - failure (invalid password)

Total: 4 events (showing 4)

$ node index.js audit:stats
Audit statistics (last 30 days):
========================================
  Total events: 1,234

  By action:
    content.create: 456
    content.update: 312
    auth.login: 189
    auth.failed: 23

  By user:
    admin: 678
    editor: 445

  By result:
    success: 1198
    failure: 36

  Top IPs:
    192.168.1.1: 890
    10.0.0.5: 234
```

### Admin Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/audit` | Audit log viewer with filters |
| GET | `/admin/audit/export` | Export logs as JSON/CSV |
| GET | `/admin/audit/user/:id` | Logs for specific user |
| GET | `/admin/audit/content/:type/:id` | Logs for specific content |

### Admin UI Features

**Audit Log Viewer (`/admin/audit`):**
- Statistics summary (total events, success/failure counts, active users)
- Filterable log table (action, user, result, date range)
- Search across logs
- Pagination for large result sets
- Export buttons (JSON, CSV)
- Color-coded action badges
- Expandable details view

**Filters:**
- Action type dropdown
- Username text input
- Result (success/failure)
- Time range (24h, 7d, 30d, 90d)
- Free-text search

### Query Options

| Filter | Description | Example |
|--------|-------------|---------|
| `action` | Filter by action (supports prefix with `.*`) | `content.create`, `auth.*` |
| `userId` | Filter by user ID | `user123` |
| `username` | Filter by username | `admin` |
| `ip` | Filter by IP address | `192.168.1.1` |
| `result` | Filter by result | `success`, `failure` |
| `level` | Filter by log level | `info`, `warning`, `security` |
| `from` | Start date (ISO) | `2024-01-01` |
| `to` | End date (ISO) | `2024-01-31` |
| `days` | Last N days | `7` |
| `search` | Search in action/username/details | `article` |

### Automatic Logging

Audit events are automatically logged by wrapping core operations. To add audit logging to custom operations:

```javascript
// In your module
export function hook_routes(register, context) {
  const audit = context.services.get('audit');
  const auth = context.services.get('auth');

  register('POST', '/mymodule/action', async (req, res, params, ctx) => {
    const user = auth.getAuthFromRequest(req);

    try {
      // Do operation...
      audit.log('mymodule.action', { someDetail: 'value' }, { req, user });
      // Return success
    } catch (error) {
      audit.log('mymodule.action', { error: error.message }, { req, user, result: 'failure', error: error.message });
      throw error;
    }
  });
}
```

### REST API

```
GET /api/audit?action=content.create&days=7
Authorization: Bearer <token>
```

Response:
```json
{
  "entries": [...],
  "total": 45,
  "limit": 100,
  "offset": 0,
  "from": "2024-01-08T00:00:00.000Z",
  "to": "2024-01-15T23:59:59.999Z"
}
```

---

## Plugin Auto-Reload System (v0.0.35)

### Overview
Automatic plugin reload during development without manual intervention.

### Configuration

```json
{
  "plugins": {
    "enabled": ["seo"],
    "directory": "./plugins",
    "autoReload": true,
    "watchDebounce": 500
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `autoReload` | `false` | Auto-reload mode: `true`, `false`, or `"prompt"` |
| `watchDebounce` | `500` | Milliseconds to debounce rapid file changes |

### Auto-Reload Modes

| Mode | Behavior |
|------|----------|
| `true` | Automatically reload plugins when files change |
| `false` | Ignore file changes (plugins must be manually reloaded) |
| `"prompt"` | Log changes to console but require manual reload |

### How It Works

1. File watcher detects changes in `/plugins/` directory
2. Changed plugins are marked with pending status
3. Based on mode:
   - **true**: Plugin is automatically reloaded
   - **prompt**: Message logged, user runs `plugins:reload <name>`
   - **false**: No action taken

### Watched Files

Changes to these files trigger reload consideration:
- `plugin.json` - Plugin manifest
- `index.js` - Plugin code
- `config.json` - Plugin configuration
- `**/*.js` - All JavaScript files in plugin directory

### API

```javascript
const plugins = context.services.get('plugins');

// Configure auto-reload
plugins.initAutoReload(config);
plugins.enableAutoReload(true);      // Enable auto-reload
plugins.enableAutoReload('prompt');  // Enable prompt mode
plugins.disableAutoReload();         // Disable auto-reload

// Check status
plugins.isAutoReloadEnabled();  // true if mode === true
plugins.getAutoReloadMode();    // true | false | 'prompt'
plugins.getWatchDebounce();     // Debounce milliseconds

// Track changes
plugins.markPluginChanged('seo', 'code', 'plugins/seo/index.js');
plugins.clearPluginChanged('seo');
plugins.hasPluginChanged('seo');
plugins.getChangedPlugins();
// Returns: [{ name, timestamp, files, changeType }]

// Handle changes
await plugins.handlePluginChange(change);
// Called automatically by watcher

// Reload changed plugins
const result = await plugins.reloadChangedPlugins();
// Returns: { reloaded: string[], failed: [{ name, error }] }
```

### CLI Commands

```bash
# Show auto-reload status
node index.js plugins:autoload

# Enable auto-reload
node index.js plugins:autoload on

# Disable auto-reload
node index.js plugins:autoload off

# Enable prompt mode
node index.js plugins:autoload prompt

# Watch for changes in real-time
node index.js plugins:watch

# Reload all changed plugins
node index.js plugins:reload-changed
```

**Example Output:**

```
$ node index.js plugins:autoload
Plugin Auto-Reload Status
========================================
Mode: true
Watch debounce: 500ms

Plugins with pending changes:
  - seo (code, 2 file(s))

$ node index.js plugins:watch
Watching plugins for changes...
Press Ctrl+C to stop.

Auto-reload mode: true

[12:00:01] plugins/seo/index.js changed
[plugins] Auto-reloading 'seo'...
[plugins] Auto-reloaded 'seo' successfully
[12:00:15] plugins/analytics/config.json changed
[plugins] Auto-reloading 'analytics'...
[plugins] Auto-reloaded 'analytics' successfully

$ node index.js plugins:autoload prompt
Auto-reload mode: PROMPT
Plugin file changes will be logged but not auto-reloaded.

$ node index.js
[plugins] Plugin 'seo' changed — run 'plugins:reload seo' to apply

$ node index.js plugins:reload-changed
Reloading 2 changed plugin(s)...

Reloaded:
  ✓ seo
  ✓ analytics
```

### Admin UI

The plugin list (`/admin/plugins`) shows:

**Changed Plugin Indicator:**
- Blue "!" badge on plugins with pending changes
- Row highlighted in light blue
- "Files changed" text under plugin name
- Quick "Reload" button next to changed plugins

**Auto-Reload Status Banner:**
- Shows when plugins have pending changes
- Displays current auto-reload mode
- Color-coded badge: green (on), yellow (prompt), gray (off)

**New Commands Section:**
- Lists all auto-reload CLI commands
- Shows current mode setting

**Status Legend Update:**
- Added "Changed" status with blue badge

### Console Output

With `autoReload: true`:
```
[plugins] Auto-reloading 'seo'...
[plugins] Auto-reloaded 'seo' successfully
```

With `autoReload: "prompt"`:
```
[plugins] Plugin 'seo' changed — run 'plugins:reload seo' to apply
```

With `autoReload: false`:
```
(no output)
```

### Error Handling

If auto-reload fails:
```
[plugins] Auto-reload failed for 'seo': SyntaxError: Unexpected token
```

The plugin remains marked as "changed" so the user can fix the error and try again.

### Development Workflow

**Recommended workflow:**

1. Start server with `autoReload: true` in `site.json`
2. Edit plugin files in your editor
3. Changes are automatically detected and reloaded
4. Check console for success/error messages

**For production:**
- Set `autoReload: false`
- Use explicit `plugins:reload <name>` commands
- Or deploy and restart the server

---

## Content Computed Fields (v0.0.36)

### Overview
Virtual properties calculated on-read, not stored in the JSON file. Useful for derived data like word counts, read times, and cross-content calculations.

### Configuration

```json
{
  "content": {
    "computedFields": true,
    "cacheComputed": false
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `computedFields` | `true` | Enable computed field resolution |
| `cacheComputed` | `false` | Cache computed values (not recommended for dynamic data) |

### Registration Methods

**1. Schema-based (in hook_content):**

```javascript
export function hook_content(register, context) {
  register('article', {
    title: { type: 'string', required: true },
    body: { type: 'string', required: true },
    // Computed fields defined in schema
    wordCount: {
      type: 'computed',
      compute: (item) => item.body ? item.body.split(/\s+/).length : 0,
      description: 'Word count of body'
    },
    readTime: {
      type: 'computed',
      compute: (item) => Math.ceil((item.body?.split(/\s+/).length || 0) / 200),
      description: 'Estimated read time in minutes'
    }
  });
}
```

**2. Hook-based (in hook_computed):**

```javascript
export async function hook_computed(register, context) {
  // Sync computed field
  register('article', 'isNew', (item) => {
    const created = new Date(item.created);
    const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
    return created.getTime() > threeDaysAgo;
  }, { description: 'True if created within 3 days' });

  // Async computed field
  register('article', 'authorName', async (item, context) => {
    const user = context.services.get('content').read('user', item.authorId);
    return user?.name || 'Unknown';
  }, { async: true, description: 'Author display name' });
}
```

### API

```javascript
const content = context.services.get('content');

// Register computed field
content.registerComputed('article', 'wordCount', (item) => {
  return item.body ? item.body.split(/\s+/).length : 0;
}, { description: 'Word count', async: false });

// Get computed field definitions for a type
const fields = content.getComputedFields('article');
// Returns: { wordCount: { compute, description, async }, ... }

// Check if type has computed fields
content.hasComputedFields('article'); // true

// Resolve computed fields for an item
const resolved = await content.resolveComputed(item, { type: 'article' });
// Returns: { wordCount: 150, readTime: 1, isNew: true, ... }

// Batch resolve for multiple items
const results = await content.resolveComputedBatch(items, { type: 'article' });

// Read with computed fields (async version)
const article = await content.readAsync('article', 'abc123');
// Item includes computed fields: { ...data, wordCount: 150, readTime: 1 }

// List with computed fields
const result = content.list('article', { includeComputed: true });
// Each item in result.items includes computed fields
```

### Computed Field Options

```javascript
register('type', 'field', computeFn, {
  description: 'Human-readable description',
  async: true,       // Mark as async (required if computeFn returns Promise)
  cache: false,      // Per-field cache override
  showInList: true,  // Show in admin list view (future)
});
```

### CLI Commands

```bash
# List computed fields for a type
node index.js content:computed article
# Output:
# Computed Fields for 'article':
#   wordCount - Word count of body (sync)
#   readTime - Estimated read time in minutes (sync)
#   isNew - True if created within 3 days (sync)
#   authorName - Author display name (async)

# Test computed values for a specific item
node index.js content:test-computed article abc123
# Output:
# Testing computed fields for article/abc123:
#   wordCount: 150
#   readTime: 1
#   isNew: true
#   authorName: John Doe

# Show content types with computed field counts
node index.js content:types
# Output:
# Content Types:
#   article (15 items, module:blog)
#     Fields: title*, body*, author
#     Computed: wordCount, readTime, isNew, authorName (4)
```

### Admin UI

**Content Types List (`/admin/content`):**
- New "Computed" column showing count of computed fields
- Hover for field names

**Content Edit Form (`/admin/content/:type/:id/edit`):**
- "Computed Fields" section with dashed border
- Fields displayed as read-only with italic labels
- Gray styling to indicate non-editable
- Field descriptions shown as hints

### How read() and list() Work

**read() behavior:**
- By default, returns raw stored data (no computed fields)
- Use `readAsync()` to get computed fields included
- Or call `resolveComputed()` separately

**list() behavior:**
- Default: Returns raw items (computed fields not resolved)
- With `includeComputed: true`: Resolves computed after pagination
- This ensures filtering/sorting works on stored fields only

### Example Module with Computed Fields

```javascript
// modules/blog/index.js

export function hook_content(register, context) {
  register('post', {
    title: { type: 'string', required: true },
    body: { type: 'string', required: true },
    tags: { type: 'array' },
  });
}

export async function hook_computed(register, context) {
  // Word count
  register('post', 'wordCount', (item) => {
    return (item.body || '').split(/\s+/).filter(Boolean).length;
  }, { description: 'Body word count' });

  // Reading time
  register('post', 'readTime', (item) => {
    const words = (item.body || '').split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(words / 200));
  }, { description: 'Minutes to read' });

  // Is recent?
  register('post', 'isRecent', (item) => {
    const created = new Date(item.created);
    const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    return created.getTime() > weekAgo;
  }, { description: 'Created within 7 days' });

  // Tag count
  register('post', 'tagCount', (item) => {
    return Array.isArray(item.tags) ? item.tags.length : 0;
  }, { description: 'Number of tags' });
}
```

### Error Handling

If a compute function throws:
- The field value is set to `null`
- Error is logged to console
- Other computed fields still resolve

```
[content] Computed field 'authorName' failed for article/abc123: TypeError: Cannot read property 'name' of undefined
```

### Performance Notes

- Computed fields resolve after pagination (list doesn't compute all items)
- Async fields are awaited in parallel with `Promise.all`
- Consider caching for expensive computations
- Schema-based fields are extracted during type registration

---

## Content Slug Generation & Permalinks (v0.0.37)

### Overview
URL-friendly slugs auto-generated from content titles with history tracking for redirects.

### Configuration

```json
{
  "slugs": {
    "enabled": true,
    "separator": "-",
    "maxLength": 100,
    "redirectOld": true,
    "historyLimit": 10
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Enable slug generation |
| `separator` | `"-"` | Word separator in slugs |
| `maxLength` | `100` | Maximum slug length |
| `redirectOld` | `true` | Redirect old slugs to current |
| `historyLimit` | `10` | Max old slugs to keep per item |

### Schema Definition

```javascript
export function hook_content(register, context) {
  register('article', {
    title: { type: 'string', required: true },
    body: { type: 'string', required: true },
    // Slug field definition
    slug: {
      type: 'slug',
      from: 'title',        // Auto-generate from this field
      unique: true,         // Must be unique within type
      editable: true,       // Allow manual override
      trackHistory: true    // Keep old slugs for redirects
    }
  });
}
```

### Slug Field Options

| Option | Default | Description |
|--------|---------|-------------|
| `from` | `'title'` | Source field for auto-generation |
| `unique` | `true` | Enforce uniqueness within type |
| `editable` | `true` | Allow manual slug editing |
| `trackHistory` | `true` | Track old slugs for redirects |

### Auto-Generation

When content is created without a slug:

1. Source field value is taken (e.g., "Hello World!")
2. Converted to lowercase: "hello world!"
3. Unicode transliterated: "café" → "cafe"
4. Special chars replaced with separator: "hello-world"
5. Uniqueness ensured: "hello-world-1" if exists

### API

```javascript
const content = context.services.get('content');

// Get content by slug
const article = content.getBySlug('article', 'hello-world');

// Resolve permalink (with redirect support)
const result = content.resolvePermalink('article', 'old-slug');
// Returns: { found: true, redirect: true, currentSlug: 'new-slug' }
// Or: { found: true, item: {...} }
// Or: { found: false }

// Check if slug exists
content.slugExists('article', 'hello-world');
content.slugExists('article', 'hello-world', excludeId);

// Get slug info for item
const info = content.getSlugInfo('article', 'abc123');
// Returns: { slug: 'hello-world', history: ['old-title', 'original'] }

// List all slugs for type
const slugs = content.listSlugs('article');
// Returns: [{ slug, id, history }, ...]

// Check for slug field
content.hasSlugField('article');  // true/false
content.getSlugFieldDef('article');  // { name, from, unique, ... }

// Maintenance
await content.regenerateMissingSlugs('article');
content.checkSlugs('article');  // Find duplicates/invalid
```

### HTTP Routes

```bash
# Get content by slug
GET /content/:type/by-slug/:slug

# Examples:
curl "http://localhost:3000/content/article/by-slug/hello-world"
# Returns: { "id": "abc123", "title": "Hello World!", "slug": "hello-world", ... }

# Old slug returns 301 redirect
curl -v "http://localhost:3000/content/article/by-slug/old-title"
# HTTP/1.1 301 Moved Permanently
# Location: /content/article/by-slug/new-title
```

### CLI Commands

```bash
# Show slug and history for item
node index.js content:slug <type> <id>

# List all slugs for type
node index.js slugs:list <type>

# Regenerate missing slugs
node index.js slugs:fix [type]

# Check for duplicate/invalid slugs
node index.js slugs:check [type]
```

**Example Output:**

```
$ node index.js content:slug article abc123
Slug for article/abc123:
  current: hello-world
  history: (none)

$ node index.js slugs:list article
Slugs for article:
  hello-world → abc123
  hello-world-1 → def456
  my-post → ghi789 (history: old-title, original-post)

$ node index.js slugs:fix
Regenerating missing slugs...
  article: 3 slug(s) generated
Total: 3 fixed, 0 errors

$ node index.js slugs:check
Checking slugs...
  All slugs are valid and unique.
```

### Admin UI

The content edit form (`/admin/content/:type/:id/edit`) shows:

**Permalink Section:**
- Current slug displayed as `/type/slug-here`
- "Edit" button to modify slug manually
- Input validation (lowercase, hyphens, numbers only)
- History display with "will redirect" note

**Slug Field in Forms:**
- Slug field auto-populated on create
- Warning if entered slug already exists
- Preview as user types (client-side)

### Slug Utilities (core/slugify.js)

```javascript
import { slugify, generateUniqueSlug, validateSlug, transliterate } from './slugify.js';

// Basic slugification
slugify('Hello World!');           // 'hello-world'
slugify('Café au Lait');           // 'cafe-au-lait'
slugify('Price: $100!');           // 'price-dollar100'

// With options
slugify('Hello World', {
  lowercase: true,      // default: true
  separator: '-',       // default: '-'
  maxLength: 50,        // default: 100
  transliterate: true,  // default: true
});

// Generate unique slug
const slug = await generateUniqueSlug('hello-world', async (s) => {
  return content.slugExists('article', s);
});
// Returns: 'hello-world' or 'hello-world-1' if exists

// Validate slug format
const result = validateSlug('hello-world');
// Returns: { valid: true, errors: [] }

// Transliterate unicode
transliterate('Ñoño');  // 'Nono'
transliterate('Москва');  // 'Moskva'
```

### Slug History & Redirects

When a slug changes:

1. Old slug added to `_slugHistory` array
2. History trimmed to `historyLimit`
3. Old slugs return 301 redirects to current

```javascript
// Item structure with history
{
  "id": "abc123",
  "title": "New Title",
  "slug": "new-title",
  "_slugHistory": ["old-title", "original-title"]
}
```

### Error Handling

**Duplicate Slug:**
```
Error: Slug "hello-world" already exists for type "article"
```

**Invalid Slug Format:**
```
Error: Invalid slug: Slug must contain only lowercase letters, numbers, and hyphens
```

### Performance Notes

- Slug index built on first access, updated on write
- Index stored in memory (rebuilds on restart)
- `getBySlug()` is O(1) lookup via index
- History checking adds minimal overhead

---

## Content Trash & Soft Delete (v0.0.38)

### Overview
Soft delete with recovery capability. Deleted content moves to trash instead of being permanently removed.

### Configuration

```json
{
  "trash": {
    "enabled": true,
    "retention": 30,
    "autoPurge": true
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Enable soft delete / trash |
| `retention` | `30` | Days to keep trashed items |
| `autoPurge` | `true` | Auto-delete items older than retention |

### Storage Structure

Trashed items are stored in a hidden `.trash` directory:

```
/content
  /.trash/
    /article/
      abc123.json
    /greeting/
      def456.json
  /article/
    xyz789.json
```

**Trashed Item Format:**
```json
{
  "id": "abc123",
  "type": "article",
  "title": "Hello World",
  "...originalFields": "...",
  "_trashedAt": "2024-01-15T12:00:00.000Z",
  "_trashedBy": "admin",
  "_originalPath": "/content/article/abc123.json"
}
```

### API

```javascript
const content = context.services.get('content');

// Soft delete (moves to trash)
await content.remove('article', 'abc123');
// Console: "Moved article/abc123 to trash"

// Permanent delete (bypasses trash)
await content.remove('article', 'abc123', { permanent: true });

// Restore from trash
const item = await content.restore('article', 'abc123');

// Permanently delete from trash
await content.purge('article', 'abc123');

// Get single trashed item
const trashed = content.getTrash('article', 'abc123');

// List trashed items
const allTrash = content.listTrash();
const articleTrash = content.listTrash('article');
const oldTrash = content.listTrash(null, { olderThanDays: 20 });

// Empty trash
await content.emptyTrash();                          // All trash
await content.emptyTrash('article');                 // Type only
await content.emptyTrash(null, { olderThanDays: 30 }); // Old items only

// Get trash statistics
const stats = content.getTrashStats();
// Returns: { total, byType, oldestDays, autoPurgeIn, retention, autoPurgeEnabled }

// Check if in trash
content.isInTrash('article', 'abc123');

// Auto-purge (called by scheduled task)
await content.autoPurgeTrash();
```

### CLI Commands

```bash
# List trashed items
node index.js trash:list [type] [--days=N]

# Restore item from trash
node index.js trash:restore <type> <id>

# Permanently delete from trash
node index.js trash:purge <type> <id>

# Empty trash
node index.js trash:empty [type] [--older-than=N]

# Show trash statistics
node index.js trash:stats
```

**Example Output:**

```
$ node index.js trash:list
Trashed items:
  article/abc123 - "Hello World" - trashed 2024-01-15 by admin (15 days ago)
  greeting/def456 - "Old Greeting" - trashed 2024-01-10 by editor (20 days ago)
    ⚠ Auto-purge in 5 days

$ node index.js trash:restore article abc123
Restored article/abc123

$ node index.js trash:stats
Trash statistics:
  Total items: 12
  By type:
    article: 5
    greeting: 4
    user: 3
  Oldest: 25 days ago
  Auto-purge in: 5 days (for oldest items)
  Retention: 30 days
  Auto-purge: enabled

$ node index.js trash:empty --older-than=20
Purged 3 items older than 20 days
```

### Scheduled Task

**trash:autopurge** - Runs daily at 2 AM
- Permanently deletes items older than retention period
- Only runs if `autoPurge: true` in config
- Logs results to console

### Admin UI

**GET /admin/trash** - Trash management page

Features:
- Table: Type, Item, Trashed date, By, Days remaining, Actions
- Restore and Purge buttons per item
- Empty All Trash button
- Filter tabs by content type
- Warning banner for items about to be auto-purged
- Auto-purge notice showing upcoming purges

### Hooks

New hooks fired during trash operations:

| Hook | When Fired | Context |
|------|------------|---------|
| `content:trashed` | After item moved to trash | `{ type, id, item }` |
| `content:restored` | After item restored | `{ type, id, item }` |
| `content:beforePurge` | Before permanent delete | `{ type, id }` |
| `content:afterPurge` | After permanent delete | `{ type, id }` |

### Modified Behavior

**remove() function:**
```javascript
// Default: soft delete (move to trash)
await content.remove('article', 'abc123');

// Options:
await content.remove('article', 'abc123', {
  permanent: true,     // Skip trash, delete immediately
  trashedBy: 'admin',  // Record who deleted
});
```

**afterDelete hook:**
```javascript
hooks.register('content:afterDelete', async ({ type, id, permanent, trashed }) => {
  if (trashed) {
    console.log(`${type}/${id} moved to trash`);
  } else {
    console.log(`${type}/${id} permanently deleted`);
  }
});
```

### Error Handling

**Restore conflicts:**
- If item with same ID already exists, restore fails
- User should delete existing item first

**Trash disabled:**
- If `trash.enabled: false`, remove() permanently deletes
- All trash functions still work for existing trashed items

---

## v0.0.39 - Content Cloning & Duplication

### Configuration

In `config/site.json`:
```json
{
  "content": {
    "clonePrefix": "Copy of ",
    "cloneDeep": false
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `clonePrefix` | `"Copy of "` | Prefix added to cloned item titles |
| `cloneDeep` | `false` | Default deep clone behavior |

### Content Functions

```javascript
import * as content from './core/content.js';

// Basic clone
const cloned = await content.clone('article', 'abc123');
// Creates new article with "Copy of " prefix on title

// Clone with custom prefix
const cloned = await content.clone('article', 'abc123', {
  prefix: 'Draft - '
});

// Clone with field overrides
const cloned = await content.clone('article', 'abc123', {
  fields: {
    status: 'draft',
    author: 'newAuthor'
  }
});

// Deep clone (includes referenced items)
const cloned = await content.clone('article', 'abc123', {
  deep: true
});
// Also clones items referenced by belongsTo/belongsToMany fields
// Updates references in cloned item to point to new clones

// Full options
const cloned = await content.clone('article', 'abc123', {
  prefix: 'Copy of ',      // Title prefix
  deep: false,             // Clone referenced items
  fields: {}               // Field overrides
});
```

### CLI Commands

```bash
# Basic clone
node index.js content:clone <type> <id>

# Clone with options
node index.js content:clone <type> <id> --prefix="Draft - "
node index.js content:clone <type> <id> --deep

# Duplicate (alias for clone)
node index.js content:duplicate <type> <id>
```

**Example Output:**

```
$ node index.js content:clone article abc123
Cloned article/abc123 → article/def456

$ node index.js content:clone article abc123 --deep
Cloned article/abc123 → article/def456
  Also cloned:
    author/xyz789 → author/uvw012
    category/cat1 → category/cat2
```

### Admin UI

**Clone Button** - On content edit form (`/admin/content/:type/:id/edit`)
- Located in content-meta section
- Opens modal with options:
  - Title prefix input (default: "Copy of ")
  - Deep clone checkbox
- POST to `/admin/content/:type/:id/clone`
- Redirects to edit page for cloned item

**Clone Route:**
```
POST /admin/content/:type/:id/clone
Body: { prefix?: string, deep?: boolean, field_*?: any }
```

### Hooks

New hook fired during clone:

| Hook | When Fired | Context |
|------|------------|---------|
| `content:cloned` | After item cloned | `{ type, sourceId, clonedId, clonedItem, deep, alsoCloned }` |

### Deep Clone Behavior

When `deep: true`:
1. Scans cloned item for relation fields (belongsTo, belongsToMany)
2. Recursively clones referenced items
3. Updates references in cloned item to point to new clones
4. Prevents circular references with visited set
5. Returns list of all cloned items in hook context

**Example:**
```javascript
// Original article references author/xyz and categories [cat1, cat2]
const cloned = await content.clone('article', 'abc123', { deep: true });
// Clones: article, author, cat1, cat2
// New article references new author and new categories
```

### Error Handling

- Source item not found: Returns null
- Invalid type: Returns null
- Clone fails: Throws error
- Deep clone with circular refs: Handled via visited tracking

---

## v0.0.40 - Content Locking & Edit Collision Prevention

### Overview

Prevents edit collisions by tracking which users are editing content. Locks auto-expire after timeout and can be forcefully released by admins.

### Configuration

In `config/site.json`:
```json
{
  "locks": {
    "enabled": true,
    "timeout": 1800,
    "gracePeriod": 60
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `true` | Enable content locking |
| `timeout` | `1800` | Lock timeout in seconds (30 min) |
| `gracePeriod` | `60` | Grace period after expiry (1 min) |

### Lock Structure

```json
{
  "type": "article",
  "id": "abc123",
  "userId": "user456",
  "username": "editor",
  "acquiredAt": "2024-01-15T12:00:00.000Z",
  "expiresAt": "2024-01-15T12:30:00.000Z",
  "lastActivity": "2024-01-15T12:10:00.000Z"
}
```

### Content Functions

```javascript
import * as content from './core/content.js';

// Acquire lock
const lock = content.acquireLock('article', 'abc123', 'userId', {
  username: 'editor',
  timeout: 1800,  // optional override
});

// Release lock
content.releaseLock('article', 'abc123', 'userId');

// Check lock status
const status = content.checkLock('article', 'abc123');
// Returns: { locked, userId, username, acquiredAt, expiresAt, expiresIn }

// Refresh/extend lock
const refreshed = content.refreshLock('article', 'abc123', 'userId');

// Force release (admin)
const released = content.forceReleaseLock('article', 'abc123');

// List all locks
const locks = content.listLocks();       // All
const locks = content.listLocks('article'); // By type

// Cleanup expired
const removed = content.cleanupExpiredLocks();

// Get stats
const stats = content.getLockStats();
// Returns: { total, byType, soonestExpiry, enabled, timeout, gracePeriod }

// Get config
const config = content.getLockConfig();
```

### Update with Lock Check

The `update()` function now checks locks:

```javascript
// Normal update - checks lock
await content.update('article', 'abc123', data, { userId: 'userId' });

// Force update - bypasses lock check
await content.update('article', 'abc123', data, { force: true });
```

If locked by another user, throws error with code `LOCKED`:
```javascript
try {
  await content.update('article', 'abc123', data, { userId: 'otherUser' });
} catch (error) {
  if (error.code === 'LOCKED') {
    console.log(`Locked by ${error.lockedBy}, expires in ${error.expiresIn}s`);
  }
}
```

### CLI Commands

```bash
# List all active locks
node index.js locks:list [type]

# Check lock status
node index.js locks:check <type> <id>

# Force release lock
node index.js locks:release <type> <id>

# Remove expired locks
node index.js locks:cleanup

# Show lock statistics
node index.js locks:stats
```

**Example Output:**

```
$ node index.js locks:list
Active locks:
  article/abc123 - locked by editor since 12:00:00 PM (expires in 20 min)
  greeting/def456 - locked by admin since 11:45:00 AM (expires in 5 min)

$ node index.js locks:check article abc123
Lock status for article/abc123:
  Locked: yes
  By: editor (user/user456)
  Since: 2024-01-15T12:00:00.000Z
  Expires: 2024-01-15T12:30:00.000Z (in 20 minutes)

$ node index.js locks:release article abc123
Released lock on article/abc123
  Was held by: editor

$ node index.js locks:stats
Lock statistics:
  Total active: 2
  By type:
    article: 1
    greeting: 1
  Soonest expiry: in 5 minutes
  Timeout: 1800 seconds
  Grace period: 60 seconds
  Enabled: true
```

### Admin Routes

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/admin/content/:type/:id/lock` | Acquire lock |
| DELETE | `/admin/content/:type/:id/lock` | Release lock |
| POST | `/admin/content/:type/:id/lock/refresh` | Extend lock |
| GET | `/admin/locks` | List all locks |
| DELETE | `/admin/locks/:type/:id` | Force release (admin) |
| POST | `/admin/locks/:type/:id/release` | Force release via POST |

**Acquire Lock:**
```bash
curl -X POST "http://localhost:3000/admin/content/article/abc123/lock"
# Response: { "locked": true, "expiresAt": "...", "expiresIn": 1800 }
```

**Release Lock:**
```bash
curl -X DELETE "http://localhost:3000/admin/content/article/abc123/lock"
# Response: { "released": true }
```

**Refresh Lock:**
```bash
curl -X POST "http://localhost:3000/admin/content/article/abc123/lock/refresh"
# Response: { "refreshed": true, "expiresAt": "...", "expiresIn": 1800 }
```

### Admin UI

**Edit Page (`/admin/content/:type/:id/edit`):**

When user has lock:
- Green banner: "🔒 You are editing this article. Lock expires in 25m 30s. [Release Lock]"
- Countdown timer showing time remaining
- Warning banner (red) when < 5 minutes remaining
- Auto-refresh every 5 minutes to extend lock
- Lock released on page unload

When locked by another user:
- Yellow banner: "🔒 Locked by editor. You cannot edit until they release the lock or it expires."
- Form fields disabled
- Admin sees "Take Over" button to force release

**Locks Page (`/admin/locks`):**
- Table of all active locks
- Filter by content type
- Force release button per lock
- Info box explaining lock behavior

### Lock Persistence

Locks stored in `/content/.locks/index.json`:
- Persisted across server restarts
- Auto-cleanup of expired locks on startup
- In-memory cache for fast access

### Grace Period

After a lock expires, there's a configurable grace period:
- Original user can reclaim lock during grace
- Other users cannot acquire until grace ends
- Prevents lost work due to brief inactivity

### Hooks

No new hooks added. Lock operations are synchronous and internal.

### Error Handling

**Update blocked:**
```javascript
{
  error: 'locked',
  message: 'Content is locked by editor',
  lockedBy: 'editor',
  lockedByUserId: 'user456',
  expiresIn: 1200,
  expiresAt: '2024-01-15T12:30:00.000Z'
}
```

**Lock acquisition failed:**
- Returns `null` if already locked by another user
- Returns lock object if same user (refreshes)

---

## v0.0.41 - Content Comments & Annotations

### Overview

Full commenting system for content items with threading, moderation workflow, and spam detection hooks.

### Configuration

In `config/site.json`:
```json
{
  "comments": {
    "enabled": true,
    "defaultStatus": "pending",
    "autoApproveUsers": true,
    "maxDepth": 3,
    "requireEmail": true
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `true` | Enable comments system |
| `defaultStatus` | `"pending"` | Default status for new comments |
| `autoApproveUsers` | `true` | Auto-approve comments from logged-in users |
| `maxDepth` | `3` | Maximum reply nesting depth |
| `requireEmail` | `true` | Require email for guest comments |

### Comment Schema

Comments are stored as a built-in content type (`comment`):

```json
{
  "id": "1234567890-abc",
  "contentType": "article",
  "contentId": "xyz789",
  "parentId": null,
  "author": "John Doe",
  "authorId": "user123",
  "email": "john@example.com",
  "body": "Great article!",
  "status": "pending",
  "ip": "192.168.1.1",
  "userAgent": "Mozilla/5.0...",
  "created": "2024-01-15T12:00:00.000Z",
  "updated": "2024-01-15T12:00:00.000Z"
}
```

### Comment Functions

```javascript
import * as comments from './core/comments.js';

// Add comment
const comment = await comments.addComment('article', 'xyz789', {
  author: 'John',
  email: 'john@example.com',
  body: 'Great post!',
  parentId: null,  // or parent comment ID for replies
}, {
  user: ctx.session?.user,  // auto-approve if logged in
  ip: req.socket.remoteAddress,
  userAgent: req.headers['user-agent'],
});

// Get comments for content
const result = comments.getComments('article', 'xyz789', {
  status: 'approved',  // null = all statuses
  threaded: true,      // nest replies
  limit: 50,
  offset: 0,
});
// Returns: { comments, total, offset, limit, threaded }

// Get single comment
const comment = comments.getComment('commentId');

// Moderation actions
await comments.approveComment('commentId');
await comments.spamComment('commentId');
await comments.trashComment('commentId');
await comments.deleteComment('commentId');  // permanent

// Get moderation queue
const queue = comments.getModerationQueue({ limit: 50 });

// Get all comments with filters
const all = comments.getAllComments({
  status: 'approved',
  contentType: 'article',
  author: 'john',
  limit: 50,
});

// Get comment count
const count = comments.getCommentCount('article', 'xyz789', 'approved');

// Bulk actions
const result = await comments.bulkAction(['id1', 'id2'], 'approve');
// result: { success: 2, failed: 0, errors: [] }

// Statistics
const stats = comments.getStats();
// { total, byStatus, byContentType, pending }

// Recent comments
const recent = comments.getRecentComments(10);
```

### CLI Commands

```bash
# List comments with filters
node index.js comments:list [--status=pending] [--type=article] [--limit=20]

# List pending comments (shorthand)
node index.js comments:pending

# Approve comment
node index.js comments:approve <id>

# Mark as spam
node index.js comments:spam <id>

# Trash comment
node index.js comments:trash <id>

# Delete permanently
node index.js comments:delete <id>

# Statistics
node index.js comments:stats
```

**Example Output:**

```
$ node index.js comments:pending
Pending comments (5):
  [abc123] on article/xyz789 by "John" - "Great post! I really..."
  [def456] on article/xyz789 by "Jane" - "Thanks for sharing..."

$ node index.js comments:approve abc123
Approved comment abc123
  Author: John
  On: article/xyz789

$ node index.js comments:stats
Comment statistics:
  Total: 156
  By status:
    approved: 120
    pending: 5
    spam: 28
    trash: 3
  By content type:
    article: 140
    greeting: 16
```

### Admin Routes

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/admin/comments` | Moderation queue |
| GET | `/admin/comments?status=X` | Comments by status |
| GET | `/admin/content/:type/:id/comments` | Comments for content |
| POST | `/admin/comments/:id/approve` | Approve comment |
| POST | `/admin/comments/:id/spam` | Mark as spam |
| POST | `/admin/comments/:id/trash` | Move to trash |
| POST | `/admin/comments/:id/delete` | Delete permanently |
| POST | `/admin/comments/bulk` | Bulk action |

### Admin UI

**Moderation Page (`/admin/comments`):**
- Tabs: Pending, Approved, Spam, Trash with counts
- Each comment shows: author, excerpt, target content, date
- Actions: Approve, Spam, Trash per comment
- Bulk select with dropdown action
- Filter by content type

**Content Comments (`/admin/content/:type/:id/comments`):**
- Stats bar: total, approved, pending, spam
- Filter tabs by status
- Full comment body display
- Quick moderation actions

### Hooks

| Hook | When Fired | Context |
|------|------------|---------|
| `comments:beforeCreate` | Before comment saved | Comment data, can modify or set status='spam' |
| `comments:afterCreate` | After comment saved | `{ comment, targetType, targetId }` |
| `comments:statusChanged` | After status change | `{ comment, oldStatus, newStatus }` |

**Spam Detection Example:**
```javascript
hooks.register('comments:beforeCreate', async (ctx) => {
  // Simple spam detection
  if (ctx.body.includes('http://') && ctx.body.includes('buy now')) {
    ctx.status = 'spam';
  }
});
```

### Threading

Comments support threaded replies up to `maxDepth`:

```javascript
// Top-level comment
const parent = await comments.addComment('article', 'xyz', {
  author: 'John',
  body: 'Great post!',
});

// Reply
const reply = await comments.addComment('article', 'xyz', {
  author: 'Jane',
  body: 'I agree!',
  parentId: parent.id,
});

// Get threaded
const result = comments.getComments('article', 'xyz', { threaded: true });
// result.comments[0].replies = [{ ...reply, replies: [] }]
```

### Error Handling

- Content not found: Throws error
- Max depth exceeded: Throws error
- Parent comment not found: Throws error
- Email required (guest): Throws error
- Comments disabled: Throws error

---

## Job Queue System (v0.0.42)

### Overview
Background job queue for long-running operations with progress tracking, retry logic, and persistence.

### Configuration

```json
{
  "queue": {
    "enabled": true,
    "concurrency": 5,
    "retryDelay": 60,
    "maxRetries": 3,
    "archiveAfter": 7
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Enable/disable queue system |
| `concurrency` | `5` | Max parallel jobs |
| `retryDelay` | `60` | Seconds between retry attempts |
| `maxRetries` | `3` | Max retry attempts for failed jobs |
| `archiveAfter` | `7` | Days before completed jobs are archived |

### Job Structure

```json
{
  "id": "job_1234567890_abc123",
  "type": "bulk:publish",
  "status": "running",
  "priority": 5,
  "data": {
    "contentType": "article",
    "ids": ["id1", "id2", "id3"]
  },
  "progress": {
    "total": 3,
    "completed": 1,
    "failed": 0
  },
  "result": null,
  "createdAt": "2024-01-15T10:00:00.000Z",
  "startedAt": "2024-01-15T10:00:05.000Z",
  "completedAt": null,
  "error": null,
  "retries": 0,
  "maxRetries": 3,
  "createdBy": "user123"
}
```

### Job Statuses

| Status | Description |
|--------|-------------|
| `pending` | Waiting to be processed |
| `running` | Currently executing |
| `completed` | Finished successfully |
| `failed` | Finished with error |
| `cancelled` | Cancelled by user |

### Built-in Job Types

| Type | Description |
|------|-------------|
| `bulk:publish` | Publish multiple content items |
| `bulk:unpublish` | Unpublish multiple content items |
| `bulk:archive` | Archive multiple content items |
| `bulk:delete` | Delete multiple content items |
| `bulk:update` | Update multiple content items with same data |
| `bulk:export` | Export content to file |
| `bulk:import` | Import content from file |

### Queue API

```javascript
const queue = context.services.get('queue');

// Add a job
const job = queue.addJob('bulk:publish', {
  contentType: 'article',
  ids: ['id1', 'id2', 'id3']
}, { priority: 1 });

// Get job status
const status = queue.getJob(job.id);

// List jobs
const pending = queue.listJobs('pending');
const all = queue.listJobs();

// Cancel pending job
queue.cancelJob(job.id);

// Retry failed job
queue.retryJob(job.id);

// Process queue manually
const results = await queue.processQueue(10);

// Clear completed jobs
queue.clearJobs('completed');

// Get statistics
const stats = queue.getStats();
```

### Custom Job Handlers

```javascript
queue.registerHandler('mymodule:process', async (job, updateProgress, context) => {
  const items = job.data.items;
  const results = { success: 0, failed: 0, errors: [] };

  for (let i = 0; i < items.length; i++) {
    try {
      // Process item...
      results.success++;
    } catch (error) {
      results.failed++;
      results.errors.push({ id: items[i], error: error.message });
    }

    // Update progress
    updateProgress({
      completed: results.success + results.failed,
      failed: results.failed
    });
  }

  return results;
});
```

### Admin Routes

| Route | Description |
|-------|-------------|
| `GET /admin/queue` | Queue dashboard |
| `GET /admin/queue/:id` | Job details |
| `POST /admin/queue/process` | Process pending jobs |
| `POST /admin/queue/clear` | Clear completed jobs |
| `POST /admin/queue/:id/cancel` | Cancel pending job |
| `POST /admin/queue/:id/retry` | Retry failed job |
| `POST /admin/queue/:id/delete` | Delete job |

---

## Bulk Operations (v0.0.42)

### Overview
Bulk operations for managing multiple content items at once, integrated with the queue system for large batches.

### Content API

```javascript
const content = context.services.get('content');

// Bulk publish
const results = await content.bulkPublish('article', ['id1', 'id2', 'id3']);

// Bulk unpublish
const results = await content.bulkUnpublish('article', ['id1', 'id2', 'id3']);

// Bulk archive
const results = await content.bulkArchive('article', ['id1', 'id2', 'id3']);

// Bulk delete
const results = await content.bulkDelete('article', ['id1', 'id2', 'id3'], {
  permanent: false,  // Use trash
  userId: 'user123'
});

// Bulk update
const results = await content.bulkUpdate('article', ['id1', 'id2', 'id3'], {
  category: 'news',
  featured: true
});

// Bulk status change
const results = await content.bulkStatusChange('article', ['id1', 'id2', 'id3'], 'published');

// Get IDs by filter (for bulk operations)
const ids = content.getIdsByFilter('article', { status: 'draft', 'created__lt': '2024-01-01' });
```

### Results Structure

```json
{
  "success": 8,
  "failed": 2,
  "errors": [
    { "id": "id5", "error": "Content not found" },
    { "id": "id9", "error": "Permission denied" }
  ],
  "items": [...]
}
```

### Admin UI

The content list (`/admin/content/:type`) now includes:
- Checkbox selection for each item
- Bulk actions bar with "With selected" dropdown
- Actions: Publish, Unpublish, Archive, Delete
- Confirmation modal with count
- Progress feedback for large batches

### CLI Commands

```bash
# Bulk publish
node index.js bulk:publish article id1,id2,id3

# Bulk delete
node index.js bulk:delete greeting id1,id2,id3 --permanent

# Bulk update with fields
node index.js bulk:update article id1,id2,id3 --field.status=draft --field.featured=true

# Use --async for background processing
node index.js bulk:publish article id1,id2,id3,id4,id5 --async
```

### Hooks

| Hook | Parameters | Description |
|------|------------|-------------|
| `content:bulkUpdate` | `{ type, ids, data, results }` | After bulk update |
| `content:bulkDelete` | `{ type, ids, permanent, results }` | After bulk delete |
| `content:bulkPublish` | `{ type, ids, results }` | After bulk publish |
| `content:bulkUnpublish` | `{ type, ids, results }` | After bulk unpublish |
| `content:bulkArchive` | `{ type, ids, results }` | After bulk archive |
| `content:bulkStatusChange` | `{ type, ids, status, results }` | After status change |

---

## oEmbed System (v0.0.43)

### Overview
oEmbed support for embedding external content (videos, social posts, etc.) with auto-discovery and caching.

### Configuration

```json
{
  "oembed": {
    "enabled": true,
    "cacheTtl": 604800,
    "maxWidth": 800,
    "maxHeight": 600,
    "timeout": 10000,
    "providers": {
      "custom": {
        "pattern": "https://example\\.com/.*",
        "endpoint": "https://example.com/oembed"
      }
    }
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Enable/disable oEmbed system |
| `cacheTtl` | `604800` | Cache TTL in seconds (7 days) |
| `maxWidth` | `800` | Default max width for embeds |
| `maxHeight` | `600` | Default max height for embeds |
| `timeout` | `10000` | Request timeout in ms |
| `providers` | `{}` | Custom oEmbed providers |

### Built-in Providers

| Provider | Patterns |
|----------|----------|
| YouTube | youtube.com/watch, youtu.be, youtube.com/shorts |
| Vimeo | vimeo.com |
| Twitter/X | twitter.com, x.com |
| Instagram | instagram.com/p, instagram.com/reel |
| SoundCloud | soundcloud.com |
| Spotify | open.spotify.com |
| CodePen | codepen.io/pen |
| TikTok | tiktok.com |
| Flickr | flickr.com |
| Giphy | giphy.com |

### oEmbed API

```javascript
const oembed = context.services.get('oembed');

// Fetch embed data for URL
const embed = await oembed.fetchEmbed('https://youtube.com/watch?v=xyz');
// {
//   type: 'video',
//   title: 'Video Title',
//   author_name: 'Channel',
//   provider_name: 'YouTube',
//   html: '<iframe ...></iframe>',
//   width: 560,
//   height: 315,
//   cached: false,
//   fetchedAt: '2024-01-15T12:00:00Z'
// }

// Auto-discover oEmbed endpoint
const endpoint = await oembed.discoverEmbed(url);

// Check URL support
const support = oembed.checkSupport(url);
// { supported: true, provider: 'youtube', discoverable: false }

// Register custom provider
oembed.registerProvider('custom', /https:\/\/example\.com\/.*/, 'https://example.com/oembed');

// List providers
const providers = oembed.getProviders();

// Cache management
oembed.clearCache(url);     // Clear specific URL
oembed.clearCache();        // Clear all
const stats = oembed.getCacheStats();
```

### Embed Field Type

Define embed fields in content schemas:

```javascript
register('article', {
  body: { type: 'string' },
  featuredVideo: {
    type: 'embed',
    providers: ['youtube', 'vimeo'],  // Optional whitelist
    maxWidth: 800,
    maxHeight: 450
  }
});
```

### Embed Storage Format

```json
{
  "featuredVideo": {
    "url": "https://youtube.com/watch?v=abc123",
    "oembed": {
      "type": "video",
      "title": "Video Title",
      "author_name": "Channel Name",
      "provider_name": "YouTube",
      "html": "<iframe ...></iframe>",
      "width": 560,
      "height": 315,
      "thumbnail_url": "https://..."
    },
    "fetchedAt": "2024-01-15T12:00:00.000Z"
  }
}
```

### Template Helper

```html
<!-- Render embed field -->
{{embed article.featuredVideo}}

<!-- Output -->
<div class="embed embed-video">
  <iframe width="560" height="315" src="https://www.youtube.com/embed/abc123" ...></iframe>
</div>
```

### Admin API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/admin/oembed/preview?url=X` | GET | Fetch and preview embed |
| `/admin/oembed/providers` | GET | List providers and config |
| `/admin/oembed/check?url=X` | GET | Check URL support |
| `/admin/oembed/clear-cache` | POST | Clear embed cache |

### CLI Commands

```bash
# Fetch embed data
node index.js oembed:fetch "https://youtube.com/watch?v=dQw4w9WgXcQ"
# oEmbed data:
#   Type: video
#   Title: Rick Astley - Never Gonna Give You Up
#   Provider: YouTube
#   Dimensions: 560x315
#   Cached: no

# List providers
node index.js oembed:providers
# Registered oEmbed providers (10):
#   youtube - https://www.youtube.com/oembed
#   vimeo - https://vimeo.com/api/oembed.json
#   ...

# Check URL support
node index.js oembed:check "https://vimeo.com/12345"
# URL: https://vimeo.com/12345
#   Supported: yes
#   Provider: vimeo

# Cache management
node index.js oembed:cache
node index.js oembed:clear-cache
node index.js oembed:clear-cache "https://specific-url.com"
```

### oEmbed Response Types

| Type | Description | Typical Fields |
|------|-------------|----------------|
| `video` | Video player | html, width, height |
| `photo` | Image | url, width, height |
| `rich` | Rich content | html |
| `link` | Link preview | title, author_name |

### Caching Strategy

- Responses cached in `/content/.cache/oembed/<hash>.json`
- Cache key is MD5 hash of URL
- TTL configurable (default 7 days)
- Auto-refresh on access if expired
- Clear via CLI or admin API

---

## Field System (v0.0.44)

### Overview
Content forms and custom field widgets provide a comprehensive system for rendering form inputs based on content type schemas. Each field type has its own rendering, validation, and parsing logic.

### Built-in Field Types (20)
| Type | Widget | Description |
|------|--------|-------------|
| `string` | text | Single-line text input |
| `text` | textarea | Multi-line text area |
| `number` | number | Numeric input with min/max |
| `boolean` | checkbox | True/false checkbox |
| `date` | date | Date picker |
| `datetime` | datetime | Date and time picker |
| `select` | select | Dropdown selection |
| `multiselect` | multiselect | Multiple selection checkboxes |
| `reference` | reference | Content reference picker |
| `references` | references | Multiple content references |
| `embed` | embed | oEmbed URL field |
| `color` | color | Color picker |
| `url` | url | URL input with validation |
| `email` | email | Email input with validation |
| `file` | file | File upload |
| `image` | image | Image upload with preview |
| `json` | json | JSON data editor |
| `markdown` | markdown | Markdown editor with preview |
| `html` | html | Rich text / HTML editor |
| `slug` | slug | URL-friendly slug input |
| `group` | group | Field grouping container |

### Field Definition Options
```javascript
register('article', {
  title: {
    type: 'string',
    required: true,
    maxLength: 200,
    label: 'Article Title',
    hint: 'Enter a descriptive title'
  },
  category: {
    type: 'select',
    options: ['news', 'tutorial', 'review'],
    default: 'news'
  },
  color: {
    type: 'color',
    showIf: { field: 'featured', value: true }  // conditional field
  },
  metadata: {
    type: 'group',
    label: 'Metadata',
    collapsible: true,
    fields: {
      author: { type: 'reference', target: 'user' },
      publishDate: { type: 'datetime' }
    }
  }
});
```

### Conditional Fields
Fields can be shown/hidden based on other field values:
```javascript
{
  showIf: { field: 'type', value: 'video' },   // Show if type equals 'video'
  hideIf: { field: 'status', value: 'draft' }  // Hide if status equals 'draft'
}
```

### Field Groups
Related fields can be grouped together:
```javascript
{
  metadata: {
    type: 'group',
    label: 'Metadata',
    collapsible: true,  // Can collapse/expand
    collapsed: false,   // Initial state
    fields: {
      author: { type: 'reference', target: 'user' },
      tags: { type: 'multiselect', options: [...] }
    }
  }
}
```

### Form Tabs
Content types can define tabbed form layouts:
```javascript
{
  _formLayout: {
    tabs: [
      { name: 'Content', fields: ['title', 'body', 'excerpt'] },
      { name: 'SEO', fields: ['metaTitle', 'metaDescription', 'slug'] },
      { name: 'Settings', fields: ['status', 'publishDate', 'author'] }
    ]
  }
}
```

### Custom Field Types
Register custom field types in config or code:

**Via config (site.json):**
```json
{
  "fields": {
    "customTypes": {
      "phone": {
        "label": "Phone Number",
        "widget": "text",
        "description": "Phone number with validation"
      }
    }
  }
}
```

**Via code:**
```javascript
import * as fields from './core/fields.js';

fields.registerFieldType('currency', {
  label: 'Currency',
  widget: 'number',
  defaultValue: 0,
  validate: (value) => typeof value === 'number' && value >= 0,
  parse: (value) => parseFloat(value) || 0,
  format: (value) => value.toFixed(2),
  description: 'Currency amount with 2 decimal places'
});
```

### Field Validation
Validation runs on create/update:
```javascript
const result = fields.validateField(fieldDef, value);
// { valid: true } or { valid: false, error: 'Error message' }

const results = fields.validateFields(schema, formData);
// { valid: boolean, errors: { fieldName: 'error message' } }
```

### Field Parsing
Convert form input to stored values:
```javascript
const parsed = fields.parseField(fieldDef, rawValue);
const allParsed = fields.parseFields(schema, formData);
```

### Rendering Fields
```javascript
// Single field input
const html = fields.renderField(fieldDef, value, options);

// Complete form field with label
const html = fields.renderFormField(name, fieldDef, value, options);

// Field group
const html = fields.renderFieldGroup(name, groupDef, values, options);

// Tabbed form
const html = fields.renderFormTabs(tabs, schema, values, options);
```

### CLI Commands
| Command | Description |
|---------|-------------|
| `fields:list` | List all registered field types |
| `fields:types` | Show detailed field type information |
| `fields:info <type>` | Show info about a specific field type |

### Configuration
```json
{
  "fields": {
    "customTypes": {
      "phone": {
        "label": "Phone Number",
        "widget": "text",
        "description": "Phone number input"
      }
    }
  }
}
```

### JavaScript for Admin Forms
The fields module provides JavaScript for form interactivity:
- Conditional field visibility (show/hide)
- Field group collapse/expand
- Form tab switching
- Color picker sync
- Slug generation from title
- Image preview on upload
- Embed URL preview
- Markdown toolbar and preview

---

## Validation System (v0.0.45)

### Overview
Content validation rules and custom validators provide comprehensive data validation before storage. Includes built-in validators for common patterns and support for async validators (unique checks, existence checks).

### Built-in Validators (25)
| Validator | Description |
|-----------|-------------|
| `required` | Field must have a value |
| `minLength` | Minimum string length |
| `maxLength` | Maximum string length |
| `min` | Minimum number value |
| `max` | Maximum number value |
| `pattern` | Must match regex pattern |
| `email` | Valid email format |
| `url` | Valid URL format |
| `slug` | Valid URL slug format |
| `oneOf` | Value must be in list |
| `unique` | Must be unique within type (async) |
| `exists` | Referenced item must exist (async) |
| `match` | Must match another field |
| `before` | Date must be before another field |
| `after` | Date must be after another field |
| `fileType` | Allowed file extensions |
| `fileSize` | Maximum file size |
| `alphanumeric` | Only letters and numbers |
| `alpha` | Only letters |
| `numeric` | Must be numeric |
| `integer` | Must be whole number |
| `positive` | Must be positive |
| `json` | Valid JSON format |
| `color` | Valid hex color |
| `date` | Valid date format |
| `future` | Date must be in the future |
| `past` | Date must be in the past |
| `minItems` | Minimum array items |
| `maxItems` | Maximum array items |

### Schema Validation Syntax
```javascript
register('article', {
  title: {
    type: 'string',
    required: true,
    minLength: 5,
    maxLength: 200
  },
  email: {
    type: 'email',
    validate: ['required', 'email', 'unique']
  },
  password: {
    type: 'string',
    validate: ['required', { minLength: 8 }, { pattern: /[A-Z]/, message: 'Must contain uppercase' }]
  },
  confirmPassword: {
    type: 'string',
    validate: [{ match: 'password', message: 'Passwords must match' }]
  },
  publishDate: {
    type: 'datetime',
    validate: [{ after: 'created', message: 'Must be after creation' }]
  },
  category: {
    type: 'select',
    validate: [{ oneOf: ['news', 'tutorial', 'review'] }]
  }
});
```

### Custom Validators
Register custom validators in code:
```javascript
import * as validation from './core/validation.js';

// Sync validator
validation.registerValidator('strongPassword', (value, options, context) => {
  if (!/[A-Z]/.test(value)) return 'Must contain uppercase';
  if (!/[0-9]/.test(value)) return 'Must contain number';
  if (value.length < 8) return 'Must be at least 8 characters';
  return true;
}, { description: 'Strong password requirements' });

// Async validator
validation.registerValidator('uniqueEmail', async (value, options, context) => {
  const existing = await context.content.search(value, ['user']);
  if (existing.length > 0 && existing[0].id !== context.id) {
    return 'Email already in use';
  }
  return true;
}, { description: 'Email must be unique', async: true });
```

### Cross-Field Validation
Validate relationships between fields:
```javascript
register('event', {
  startDate: { type: 'datetime', required: true },
  endDate: { type: 'datetime', required: true },
  _validate: (data) => {
    if (new Date(data.endDate) <= new Date(data.startDate)) {
      return { field: 'endDate', message: 'End date must be after start date' };
    }
    return true;
  }
});
```

### Validation API
```javascript
import * as validation from './core/validation.js';

// Validate content against schema
const result = await validation.validate('article', data, { schema, id });
// { valid: true, errors: [] }
// { valid: false, errors: [{ field, rule, message }] }

// Validate single field
const fieldResult = await validation.validateField(fieldDef, value, context);
// [{ rule, message }]

// Validate all content of a type
const typeResult = await validation.validateType('article', schema);
// { total, valid, invalid, errors: { id: [...] } }

// Get validation rules summary
const rules = validation.getRulesSummary(schema);
// { title: ['required', 'minLength'], email: ['email', 'unique'] }

// Format errors for API response
const response = validation.formatErrors(result.errors);
// { error: 'Validation failed', errors: [...] }
```

### CLI Commands
| Command | Description |
|---------|-------------|
| `validators:list` | List all registered validators |
| `validate:content <type> <id>` | Validate existing content item |
| `validate:type <type>` | Validate all content of a type |
| `validate:all` | Validate all content |
| `validate:rules <type>` | Show validation rules for a type |

### Configuration
```json
{
  "validation": {
    "enabled": true,
    "stopOnFirst": false
  }
}
```

### API Error Response
When validation fails on API endpoints:
```json
{
  "error": "Validation failed",
  "errors": [
    { "field": "title", "rule": "minLength", "message": "Must be at least 5 characters" },
    { "field": "email", "rule": "unique", "message": "Must be unique (conflicts with abc123)" }
  ]
}
```

---

## Preview System (v0.0.46)

### Overview
Content preview tokens allow sharing draft content before publishing. Tokens have configurable expiration, view limits, and optional password protection.

### Token Format
```
prev_<random12chars>
Example: prev_x7k9m2p5abc1
```

### Token Structure
```json
{
  "token": "prev_abc123xyz",
  "type": "article",
  "id": "abc123",
  "createdAt": "2024-01-15T12:00:00.000Z",
  "expiresAt": "2024-01-22T12:00:00.000Z",
  "createdBy": "user456",
  "views": 3,
  "maxViews": null,
  "passwordHash": null,
  "revoked": false
}
```

### Creating Preview Tokens
```javascript
import * as preview from './core/preview.js';

// Basic preview (7-day expiry)
const token = preview.createPreviewToken('article', 'abc123');

// Custom options
const token = preview.createPreviewToken('article', 'abc123', {
  expiresIn: '3d',      // 3 days (or seconds as number)
  maxViews: 10,         // Limit views
  password: 'secret',   // Password protect
  createdBy: 'user456'  // Track who created
});

// Returns:
// {
//   token: 'prev_x7k9m2p5abc1',
//   url: '/preview/prev_x7k9m2p5abc1',
//   expiresAt: '2024-01-18T12:00:00.000Z',
//   hasPassword: false
// }
```

### Validating Tokens
```javascript
const result = preview.validatePreviewToken(token, password);
// { valid: true, data: { type, id, expiresAt, views, maxViews } }
// { valid: false, error: 'Token expired' }
// { valid: false, error: 'Password required', requiresPassword: true }
```

### Token Management
```javascript
// Revoke (keeps in storage, marks as revoked)
preview.revokePreviewToken(token);

// Delete completely
preview.deletePreviewToken(token);

// List tokens (optionally filter by type/id)
const tokens = preview.listPreviewTokens();
const tokens = preview.listPreviewTokens('article');
const tokens = preview.listPreviewTokens('article', 'abc123');

// Cleanup expired
const removed = preview.cleanupExpiredTokens();

// Statistics
const stats = preview.getStats();
// { total, active, expired, revoked, totalViews }
```

### CLI Commands
| Command | Description |
|---------|-------------|
| `preview:create <type> <id>` | Create preview token |
| `preview:list [type] [id]` | List active tokens |
| `preview:revoke <token>` | Revoke a token |
| `preview:cleanup` | Remove expired tokens |
| `preview:url <type> <id>` | Create and output URL |
| `preview:stats` | Show statistics |

### CLI Options
```bash
# Create with 3-day expiry
node index.js preview:create article abc123 --expires=3d

# Create with view limit
node index.js preview:create article abc123 --max-views=10

# Create with password
node index.js preview:create article abc123 --password=secret

# All options
node index.js preview:create article abc123 --expires=7d --max-views=50 --password=secret
```

### Configuration
```json
{
  "preview": {
    "enabled": true,
    "defaultExpiry": 604800,
    "maxExpiry": 2592000,
    "requireAuth": false,
    "baseUrl": ""
  }
}
```

### Preview URL Routes
| Route | Description |
|-------|-------------|
| `GET /preview/:token` | View preview (public) |
| `POST /preview/:token` | Submit password for protected preview |

### Preview Toolbar
When viewing a preview, a toolbar is injected at the top of the page:
- Shows "Preview Mode" badge
- Displays content type and ID
- Shows status (Draft/Pending/Scheduled)
- Links: Edit, Exit Preview
- Adds `<meta name="robots" content="noindex, nofollow">`

### Admin Routes
| Route | Method | Description |
|-------|--------|-------------|
| `/admin/content/:type/:id/preview` | POST | Create preview token |
| `/admin/content/:type/:id/previews` | GET | List tokens for content |
| `/admin/preview/:token` | DELETE | Revoke token |

### Storage
- Tokens stored in `/content/.previews/tokens.json`
- Expired tokens cleaned up on boot and periodically
- Tokens expired >24 hours are automatically removed

### Security
- Tokens are cryptographically random (9 bytes = 12 base64 chars)
- Passwords are salted and hashed (SHA-256)
- Expiration prevents permanent access
- View limits prevent unlimited sharing
- Revocation provides immediate access removal
- noindex meta tag prevents search engine indexing

---

## Next Planned Feature: v0.0.50 - Enhanced Plugin Permissions

### Overview
Fine-grained plugin permission system with runtime permission checking and audit logging.

### Specification
- Permission groups (read, write, admin)
- Runtime permission warnings
- Permission audit trail
- Admin UI for permission management

---

## v0.0.49 - Content Analytics & Statistics Dashboard

### Analytics System (`core/analytics.js`)

Event tracking and statistics aggregation for content performance analysis.

```javascript
import * as analytics from './analytics.js';

// Initialize
analytics.init(config, baseDir, scheduler, content, hooks);

// Track events
analytics.track('pageview', { path: '/article/hello' }, { ip, userAgent, userId });
analytics.trackPageView('/article/hello', context);
analytics.trackContentView('article', 'abc123', context);
analytics.trackApiRequest('GET', '/api/content', 200, 45, context);
analytics.trackSearch('hello world', 10, context);

// Get statistics
const summary = analytics.getSummary('week');
const pageViews = analytics.getPageViews({ days: 30 });
const contentStats = analytics.getContentStats('article');
const userActivity = analytics.getUserActivity('admin');
const popular = analytics.getPopularContent('article', { days: 30, limit: 10 });

// Chart data
const chartData = analytics.getChartData('pageviews', { days: 30 });

// Aggregation
analytics.runAggregation();
const cached = analytics.getCachedSummary();
```

**Events Tracked:**
- `pageview` - Page/content viewed
- `content.view` - Specific content viewed
- `content.create` - Content created
- `content.update` - Content updated
- `search` - Search performed
- `login` - User logged in
- `api.request` - API request made

**Storage:**
```
/logs/analytics/<year>/<month>/<day>.json  # Daily event logs
/logs/analytics/.aggregates/summary.json    # Pre-computed summaries
```

**Configuration:**
```json
{
  "analytics": {
    "enabled": true,
    "trackPageViews": true,
    "trackApi": true,
    "retention": 90,
    "aggregateSchedule": "0 * * * *"
  }
}
```

### CLI Commands

```bash
# Summary and overview
node index.js analytics:summary                    # Default: last week
node index.js analytics:summary --period=day       # Last 24 hours
node index.js analytics:summary --period=month     # Last 30 days

# Content analytics
node index.js analytics:content                    # Top content (all types)
node index.js analytics:content article            # Top articles only
node index.js analytics:content --top=20           # Top 20
node index.js analytics:content --days=7           # Last 7 days

# User activity
node index.js analytics:users                      # Most active users
node index.js analytics:users --top=20             # Top 20 users

# Event log
node index.js analytics:events                     # All recent events
node index.js analytics:events --type=pageview     # Page views only
node index.js analytics:events --type=login        # Logins only
node index.js analytics:events --days=3 --limit=50 # Last 3 days, 50 events

# Maintenance
node index.js analytics:aggregate                  # Run aggregation manually
node index.js analytics:stats                      # System statistics
node index.js analytics:cleanup                    # Delete old data
node index.js analytics:cleanup --dry-run          # Preview cleanup
```

### Dashboard Metrics

The analytics system provides:
- **Page views** - Total and unique visitors by day
- **Content performance** - Top content by views
- **User activity** - Most active users (logins, edits, creates)
- **API usage** - Request counts and response times
- **Search analytics** - Popular search queries
- **Trend data** - Time-series data for charts

---

## v0.0.48 - Content Backup & Restore System

### Backup System (`core/backup.js`)

Full and incremental backup system with scheduled backups and retention policies.

```javascript
import * as backup from './backup.js';

// Initialize
backup.init(config, baseDir, contentService, scheduler, hooks);

// Create full backup
const result = await backup.createBackup({ type: 'full' });

// Create incremental backup
const incr = await backup.createBackup({ type: 'incremental' });

// List backups
const backups = backup.listBackups();

// Get backup details
const b = backup.getBackup('backup_20240115_120000');

// Verify backup integrity
const verification = backup.verifyBackup('backup_20240115_120000');

// Restore from backup
const restore = await backup.restoreBackup('backup_20240115_120000', {
  dryRun: true,       // Preview changes
  contentOnly: false   // Also restore config/media
});

// Delete a backup
backup.deleteBackup('backup_20240115_120000');

// Apply retention policy
backup.pruneBackups({ dryRun: false });
```

**Backup Types:**
- `full` - Complete snapshot of all content, config, media, plugins
- `incremental` - Only changes since last backup (references parent)

**Backup Contents:**
```
/backups/<id>/
  manifest.json     # Backup metadata with checksums
  content.json      # All content items (or delta for incremental)
  config/           # Configuration files
  media/            # Media files (or references for incremental)
  plugins/          # Plugin configurations
```

**Manifest Structure:**
```json
{
  "id": "backup_20240115_120000",
  "type": "full",
  "created": "2024-01-15T12:00:00.000Z",
  "size": 15234567,
  "itemCount": 450,
  "checksum": "sha256:abc123...",
  "parent": null,
  "manifest": {
    "content": { "article": 25, "page": 10 },
    "config": ["site.json", "modules.json"],
    "media": 45,
    "plugins": 3
  }
}
```

**Configuration:**
```json
{
  "backup": {
    "enabled": true,
    "path": "./backups",
    "schedule": "0 2 * * *",
    "incremental": null,
    "retention": {
      "daily": 7,
      "weekly": 4,
      "monthly": 3
    }
  }
}
```

**Retention Policy:**
- Keep N most recent daily backups
- Keep one backup per week for N weeks
- Keep one backup per month for N months
- Automatically prune old backups

### CLI Commands

```bash
# Create backups
node index.js backup:create               # Full backup
node index.js backup:create --incremental # Incremental backup

# List and inspect
node index.js backup:list                 # List all backups
node index.js backup:list --limit=5       # Limit results
node index.js backup:info backup_20240115_120000

# Verify integrity
node index.js backup:verify backup_20240115_120000

# Restore
node index.js backup:restore backup_20240115_120000 --dry-run
node index.js backup:restore backup_20240115_120000
node index.js backup:restore backup_20240115_120000 --content-only

# Manage backups
node index.js backup:delete backup_20240115_120000
node index.js backup:prune --dry-run      # Preview retention cleanup
node index.js backup:prune                # Apply retention policy
node index.js backup:stats                # Show statistics
```

---

## v0.0.47 - Content Notifications & Email System

### Email System (`core/email.js`)

Multi-transport email system supporting console, SMTP, and sendmail.

```javascript
import * as email from './email.js';

// Initialize
email.init({ transport: 'smtp', from: 'cms@example.com' }, baseDir, templateEngine);

// Send email
await email.send('user@example.com', 'Subject', '<p>Body</p>', { html: true });

// Send template email
await email.sendTemplate('user@example.com', 'welcome', { name: 'John' });

// Verify configuration
const result = await email.verify();
```

**Transports:**
- `console` - Log to console (development)
- `smtp` - Send via SMTP server
- `sendmail` - Use local sendmail binary

**Configuration:**
```json
{
  "email": {
    "transport": "console",
    "from": "noreply@example.com",
    "fromName": "CMS",
    "smtp": {
      "host": "smtp.example.com",
      "port": 587,
      "secure": false,
      "user": "username",
      "pass": "password"
    }
  }
}
```

### Notification System (`core/notifications.js`)

User notification system with multiple channels and preferences.

```javascript
import * as notifications from './notifications.js';

// Initialize
notifications.init(config, baseDir, emailService, webhooksService);

// Send notification
await notifications.send('user123', {
  type: 'content.published',
  title: 'Article Published',
  message: 'Your article "Hello World" has been published.',
  link: '/articles/hello-world'
});

// Get user notifications
const result = notifications.getForUser('user123', { unreadOnly: true });

// Mark as read
notifications.markRead('notif_abc123');
notifications.markAllRead('user123');

// User preferences
const prefs = notifications.getUserPreferences('user123');
notifications.setPreference('user123', 'content.commented', 'email', true);
```

**Notification Types:**
- `content.published` - Content published
- `content.updated` - Content updated
- `content.commented` - Comment on content
- `content.mentioned` - Mentioned in content
- `workflow.pending` - Awaiting approval
- `workflow.approved` - Workflow approved
- `workflow.rejected` - Workflow rejected
- `user.welcome` - New user welcome
- `system.alert` - System alerts

**Channels:**
- `app` - In-app notifications (stored, shown in UI)
- `email` - Email notifications
- `webhook` - Webhook notifications for integrations

**Configuration:**
```json
{
  "notifications": {
    "enabled": true,
    "maxPerUser": 100,
    "defaultChannels": ["app"]
  }
}
```

### CLI Commands

```bash
# Email commands
node index.js email:test user@example.com    # Send test email
node index.js email:verify                   # Verify email config
node index.js email:log 20                   # Show last 20 emails
node index.js email:templates                # List email templates

# Notification commands
node index.js notify:send user123 system.alert "Test" "Hello!"
node index.js notify:list user123            # List all notifications
node index.js notify:list user123 --unread   # Unread only
node index.js notify:read notif_abc123       # Mark one as read
node index.js notify:read --all user123      # Mark all as read
node index.js notify:stats                   # Statistics
node index.js notify:types                   # List types with defaults
node index.js notify:prefs user123           # View preferences
node index.js notify:prefs user123 content.commented email on  # Set preference
```

---

## v0.0.50 - Analytics Admin Dashboard UI

### Admin Analytics Routes

Added web-based analytics dashboard to the admin module.

**Routes:**
| Route | Description |
|-------|-------------|
| `GET /admin/analytics` | Main analytics dashboard |
| `GET /admin/analytics/content` | Content performance table |
| `GET /admin/analytics/content/:type/:id` | Single content statistics |
| `GET /admin/analytics/users` | User activity table |
| `GET /api/analytics/chart/views` | JSON data for views chart |
| `GET /api/analytics/chart/content` | JSON data for content chart |
| `GET /api/analytics/summary` | JSON summary data |

### Dashboard Features

**Main Dashboard (`/admin/analytics`):**
- Period selector: Today, Week, Month
- Summary cards: Page Views, Unique Visitors, Content Created, User Logins
- Bar chart visualization for page views over time
- Top 10 content table with links to details
- Recent activity feed showing last 20 events
- Additional stats: Content Views, Content Updated, API Requests, Searches

**Content Analytics (`/admin/analytics/content`):**
- Filter by content type dropdown
- Filter by time period (7, 30, 90 days)
- Table with: Title, Type, Views, Unique Views, Last Viewed
- Links to individual content stats and edit pages
- Summary cards: Total Views, Content Items, Avg Views/Item

**Content Detail (`/admin/analytics/content/:type/:id`):**
- Content info card with type, ID, creation date
- Stats cards: Total Views, Unique Visitors, Views This Week, Views Today
- 30-day bar chart of daily views
- Recent views table showing timestamp, visitor (user or masked IP), user agent

**User Activity (`/admin/analytics/users`):**
- Filter by time period (7, 30, 90 days)
- Summary cards: Total Logins, Content Created, Content Updated, Active Users
- User table: Username, Role, Logins, Created, Updated, Total Actions, Last Active
- Activity breakdown horizontal bar chart

### Templates Added

```
modules/admin/templates/
├── analytics.html           # Main dashboard
├── analytics-content.html   # Content performance table
├── analytics-users.html     # User activity table
└── analytics-detail.html    # Single content statistics
```

### Chart Rendering

Uses inline SVG for simple bar charts with no external dependencies:
- Dynamic height calculation based on max value
- Hover tooltips showing exact values
- Responsive design for mobile
- Day labels on x-axis

### Navigation Update

Added "Analytics" link to admin navigation bar in:
- `modules/admin/templates/dashboard.html`
- All analytics templates

### API Endpoints

```bash
# Get views chart data
curl http://localhost:3000/api/analytics/chart/views?days=7
# Response: { metric, labels: [], data: [], total }

# Get content chart data
curl http://localhost:3000/api/analytics/chart/content?days=30
# Response: { metric, labels: [], data: [], total }

# Get summary
curl http://localhost:3000/api/analytics/summary?period=week
# Response: { period, startDate, endDate, pageViews, contentViews, ... }
```

### Usage

```bash
# Start server
node index.js

# Open browser to admin dashboard
open http://localhost:3000/admin/analytics

# View content analytics
open http://localhost:3000/admin/analytics/content

# View user activity
open http://localhost:3000/admin/analytics/users

# View specific content stats
open http://localhost:3000/admin/analytics/content/article/abc123
```

---

## v0.0.51 - Content Blueprints & Templates

### Blueprint System (`core/blueprints.js`)

Reusable content templates that pre-fill forms with default values.

```javascript
import * as blueprints from './blueprints.js';

// Initialize
blueprints.init(config, baseDir, contentService);

// CRUD operations
const bp = blueprints.create('Blog Post', 'article', {
  title: 'New Blog Post',
  body: '## Introduction\n\n## Content',
  status: 'draft'
}, { description: 'Standard blog template', locked: ['status'] });

const blueprint = blueprints.get('bp_abc123');
const list = blueprints.list('article'); // Filter by type
blueprints.update('bp_abc123', { name: 'Updated Name' });
blueprints.remove('bp_abc123');

// Apply blueprint to create content
const result = blueprints.apply('bp_abc123', { title: 'My Post' }, { username: 'admin' });
// Returns: { content: {...}, blueprint: { id, name } }

// Create blueprint from existing content
const newBp = blueprints.createFromContent('article', 'content_id', 'My Template');
```

**Blueprint Structure:**
```json
{
  "id": "bp_abc123",
  "name": "Blog Post Template",
  "description": "Standard blog post with SEO fields",
  "type": "article",
  "template": {
    "title": "New Blog Post",
    "body": "## Introduction\n\n## Content",
    "status": "draft"
  },
  "locked": ["status"],
  "createdAt": "2024-01-15T12:00:00.000Z",
  "updatedAt": "2024-01-15T12:00:00.000Z",
  "createdBy": "admin",
  "usageCount": 45
}
```

**Placeholder Support:**
| Placeholder | Replaced With |
|-------------|---------------|
| `{{date}}` | Current date (YYYY-MM-DD) |
| `{{datetime}}` | Current ISO datetime |
| `{{user}}` | Current username |
| `{{userId}}` | Current user ID |
| `{{random}}` | Random 8-character string |
| `{{sequence:name}}` | Auto-incrementing number |

**Locked Fields:**
Fields listed in `locked` array cannot be overridden when applying the blueprint.

**Storage:**
```
/content/.blueprints/
├── bp_abc123.json
├── bp_def456.json
└── .sequences.json    # Sequence counters
```

### CLI Commands

```bash
# List blueprints
node index.js blueprints:list
node index.js blueprints:list --type=article

# Create blueprint
node index.js blueprints:create "Blog Post" article '{"title":"New Post","status":"draft"}'
node index.js blueprints:create "Product" article '{"title":"Product Name"}' --locked=status

# Show blueprint details
node index.js blueprints:show bp_abc123

# Apply blueprint (create content)
node index.js blueprints:apply bp_abc123
node index.js blueprints:apply bp_abc123 --field.title="My Custom Title"

# Create blueprint from existing content
node index.js blueprints:from-content article abc123 "My Template"

# Delete blueprint
node index.js blueprints:delete bp_abc123

# Statistics
node index.js blueprints:stats
```

### Admin Routes

| Route | Description |
|-------|-------------|
| `GET /admin/blueprints` | List all blueprints |
| `GET /admin/blueprints/new` | Create blueprint form |
| `POST /admin/blueprints` | Create blueprint |
| `GET /admin/blueprints/:id` | Edit blueprint form |
| `POST /admin/blueprints/:id` | Update blueprint |
| `POST /admin/blueprints/:id/delete` | Delete blueprint |
| `POST /admin/content/:type/:id/to-blueprint` | Create blueprint from content |

### Admin Templates

```
modules/admin/templates/
├── blueprints-list.html    # List with usage stats
└── blueprint-form.html     # Create/edit form
```

### Configuration

```json
{
  "blueprints": {
    "enabled": true
  }
}
```

### Usage Examples

**Creating a blog post blueprint:**
```bash
node index.js blueprints:create "Blog Post" article '{
  "title": "New Blog Post - {{date}}",
  "body": "## Introduction\n\nWrite your intro here.\n\n## Main Content\n\nYour content goes here.\n\n## Conclusion\n\nWrap up your post.",
  "status": "draft",
  "author": "{{user}}"
}'
```

**Applying with overrides:**
```bash
node index.js blueprints:apply bp_x7k9m2 --field.title="My First Post" --field.category="tech"
```

**Using sequences:**
```bash
# Template with: "title": "Article #{{sequence:articles}}"
# First apply:  "Article #1"
# Second apply: "Article #2"
```

---

## v0.0.52 - Keyboard Shortcuts & Navigation

### Keyboard Shortcuts (`public/js/shortcuts.js`)

Vanilla JavaScript keyboard shortcut handler for admin interface.

**Features:**
- Global navigation shortcuts (g h, g c, etc.)
- Context-aware shortcuts (different on list vs edit pages)
- Help modal triggered by `?`
- Cross-platform support (cmd on Mac, ctrl elsewhere)
- Row selection with j/k navigation
- No dependencies

### Global Shortcuts

| Keys | Action |
|------|--------|
| `?` | Show shortcuts help modal |
| `g h` | Go to dashboard |
| `g c` | Go to content |
| `g b` | Go to blueprints |
| `g u` | Go to users |
| `g m` | Go to media |
| `g p` | Go to plugins |
| `g a` | Go to analytics |
| `g s` | Go to search |
| `/` | Focus search input |
| `esc` | Close modal / cancel |

### Content List Shortcuts

| Keys | Action |
|------|--------|
| `n` | New content |
| `j` | Select next row |
| `k` | Select previous row |
| `enter` | Edit selected item |
| `d` | Delete selected (with confirm) |
| `p` | Publish selected |
| `r` | Refresh list |

### Content Edit Shortcuts

| Keys | Action |
|------|--------|
| `ctrl+s` / `cmd+s` | Save |
| `ctrl+shift+s` / `cmd+shift+s` | Save and continue |
| `ctrl+p` / `cmd+p` | Publish |
| `ctrl+d` / `cmd+d` | Save as draft |
| `ctrl+shift+p` / `cmd+shift+p` | Preview |
| `esc` | Cancel / go back |

### CLI Command

```bash
node index.js shortcuts:list
```

Shows all available keyboard shortcuts grouped by context.

### Templates Updated

Added shortcuts script to:
- `templates/dashboard.html` - context: global
- `templates/content-list.html` - context: content-list
- `templates/content-form.html` - context: content-edit
- `templates/blueprints-list.html` - context: blueprints

### Usage

The shortcuts are automatically initialized on admin pages:

```html
<script src="/public/js/shortcuts.js"></script>
<script>Shortcuts.init({ context: 'content-list' });</script>
```

### Help Modal

Press `?` on any admin page to see:

```
┌─────────────────────────────────────────────┐
│ Keyboard Shortcuts                     [×]  │
├─────────────────────────────────────────────┤
│ Global                                      │
│   ?          Show this help                 │
│   g h        Go to dashboard                │
│   ...                                       │
│                                             │
│ Content List                                │
│   n          New content                    │
│   j / k      Navigate down / up             │
│   ...                                       │
└─────────────────────────────────────────────┘
```

### Row Selection

In list views, use `j`/`k` to navigate rows. Selected row is highlighted with blue background. Press `enter` to edit, `d` to delete.

---

## v0.0.53 - Content Favorites & Bookmarks

### Favorites System (`core/favorites.js`)

Per-user content bookmarking with labels and quick access.

```javascript
import * as favorites from './favorites.js';

// Initialize
favorites.init(baseDir, content);

// Core operations
favorites.addFavorite(userId, contentType, contentId, label?);
favorites.removeFavorite(userId, contentType, contentId);
favorites.toggleFavorite(userId, contentType, contentId, label?);
favorites.isFavorite(userId, contentType, contentId);

// Query favorites
favorites.getFavorites(userId, {
  contentType: 'article',     // Filter by type
  sortBy: 'addedAt',          // 'addedAt', 'label', 'contentType'
  sortOrder: 'desc',
  limit: 10,
  includeContent: true,       // Embed full content objects
});

// Update label
favorites.updateLabel(userId, contentType, contentId, newLabel);

// Popular content
favorites.getPopularFavorites(limit?, contentType?);
favorites.getFavoriteCount(contentType, contentId);

// Management
favorites.getUsersWithFavorites();
favorites.clearUserFavorites(userId);
```

**Storage:**
```
/content/.favorites/<userId>.json
```

**Favorite Object:**
```json
{
  "userId": "admin",
  "contentType": "article",
  "contentId": "abc123",
  "label": "Review this later",
  "addedAt": "2024-01-15T12:00:00.000Z"
}
```

### CLI Commands

```bash
# List favorites
node index.js favorites:list admin                    # List user's favorites
node index.js favorites:list                          # Default: admin user

# Add favorite
node index.js favorites:add admin article abc123
node index.js favorites:add admin article abc123 --label="Review this"

# Remove favorite
node index.js favorites:remove admin article abc123

# Popular content
node index.js favorites:popular                       # Top 10
node index.js favorites:popular --limit=20            # Top 20
```

### Admin Routes

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/admin/favorites` | List user's favorites |
| POST | `/admin/favorites` | Add a favorite |
| POST | `/admin/favorites/:type/:id/delete` | Remove a favorite |
| POST | `/admin/favorites/:type/:id/label` | Update favorite label |
| POST | `/admin/content/:type/:id/favorite` | Toggle favorite status |
| GET | `/api/favorites` | JSON list of favorites |
| GET | `/api/favorites/popular` | Most favorited content |

### Admin UI Features

1. **Dashboard Widget**
   - "Your Favorites" section on dashboard
   - Shows 5 most recent favorites
   - Quick links to favorited content
   - "View All" link to full list

2. **Content List Stars**
   - Star icon (☆/★) on each content card
   - Click to toggle favorite instantly (AJAX)
   - Visual feedback on state change

3. **Favorites Page** (`/admin/favorites`)
   - Full list with labels
   - Filter by content type
   - Sort by date/label/type
   - Edit labels inline
   - Remove favorites

### Templates Added

- `modules/admin/templates/favorites.html` - Favorites management page

### Templates Updated

- `modules/admin/templates/dashboard.html` - Added favorites widget
- `modules/admin/templates/content-list.html` - Added star icons with AJAX toggle

### Next Planned (v0.0.54)

- Content comparison and merge tools (implemented below)

---

## v0.0.54 - Content Comparison & Merge Tools

### Compare System (`core/compare.js`)

Side-by-side comparison and three-way merge for content items and revisions.

```javascript
import * as compare from './compare.js';

// Initialize
compare.init(content);

// Compare two items
const result = compare.compare(itemA, itemB, {
  ignoreFields: ['id', 'created', 'updated'],
  textDiff: true,
});

// Compare with revision
const revResult = compare.compareWithRevision(type, id, timestamp);

// Compare two revisions
const diffResult = compare.compareRevisions(type, id, tsA, tsB);

// Diff single field
const fieldDiff = compare.diff(valueA, valueB);

// Text diff (line by line)
const textDiff = compare.diffText(textA, textB);

// Three-way merge
const mergeResult = compare.merge(base, ours, theirs, strategy);

// Get conflicts
const conflicts = compare.getConflicts(base, ours, theirs);

// Apply merge
await compare.applyMerge(type, id, mergeResult, resolutions);

// Simple two-way merge
const result = await compare.mergeFrom(type, targetId, sourceId, {
  strategy: 'theirs',
  fields: ['title', 'body'],
});
```

**Comparison Result:**
```json
{
  "equal": false,
  "fields": {
    "title": { "status": "modified", "a": "Hello", "b": "Hello World" },
    "body": { "status": "unchanged", "value": "..." },
    "category": { "status": "added", "b": "news" },
    "tags": { "status": "removed", "a": ["old"] }
  },
  "summary": { "unchanged": 5, "modified": 2, "added": 1, "removed": 1 }
}
```

**Field Status Types:**
- `unchanged` - Same value in both
- `modified` - Different values
- `added` - Only in B (right side)
- `removed` - Only in A (left side)

**Merge Strategies:**
- `ours` - Prefer left/original changes on conflict
- `theirs` - Prefer right/incoming changes on conflict
- `manual` - Require explicit resolution for conflicts
- `auto` - Auto-merge non-conflicting, flag true conflicts

### CLI Commands

```bash
# Compare two items
node index.js content:compare article abc123 def456

# Compare with revision
node index.js content:compare article abc123 --revision=2024-01-10T12:00:00Z

# Merge content
node index.js content:merge article abc123 --from=def456 --strategy=theirs

# Show field diff
node index.js content:diff article abc123 --field=body --revision=<ts>
```

### Admin Routes

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/admin/compare` | Compare tool landing page |
| GET | `/admin/content/:type/:id/compare` | Compare picker or comparison view |
| GET | `/admin/content/:type/:id/compare?with=:otherId` | Compare two items |
| GET | `/admin/content/:type/:id/compare?revision=:ts` | Compare with revision |
| POST | `/admin/content/:type/:id/merge` | Apply merge |
| GET | `/admin/content/:type/:id/merge?from=:sourceId` | Merge conflict resolution UI |
| POST | `/admin/content/:type/:id/merge/resolve` | Apply resolved merge |

### Admin UI Features

1. **Compare Tool** (`/admin/compare`)
   - Select content type and IDs to compare
   - Quick access from any content edit page

2. **Comparison View**
   - Side-by-side field comparison
   - Color-coded status (modified, added, removed)
   - Inline diff for text fields
   - Line-by-line changes highlighted

3. **Merge UI**
   - Auto-merged changes listed
   - Conflict resolution with radio buttons
   - Preview of each option (ours/theirs/base)
   - Apply or cancel merge

### Templates Added

- `modules/admin/templates/compare.html` - Comparison view
- `modules/admin/templates/merge.html` - Merge conflict resolution

## v0.0.55 - Activity Feed & Timeline

### Activity System (`core/activity.js`)

Provides user-friendly activity tracking separate from audit logs.

```javascript
import * as activity from './activity.js';

// Initialize
activity.init(baseDir, contentService, { enabled: true, aggregateWindow: 300000 });

// Record activity
activity.record('content.update', user, { type: 'article', id: 'abc', title: 'Hello' }, { fields: ['title'] });

// Get activity feed (with smart aggregation)
const result = activity.getFeed({ limit: 20, aggregate: true });
// Returns: { activities: [...], total: number }

// Get user's activity
const userActivity = activity.getForUser(userId, { limit: 20 });

// Get content timeline
const timeline = activity.getForContent('article', 'abc123');

// Get statistics
const stats = activity.getStats({ days: 30 });
// Returns: { total, byAction, byActor, byTargetType, topContent }

// Convenience methods
activity.recordContentCreate(user, type, id, title);
activity.recordContentUpdate(user, type, id, title, ['field1', 'field2']);
activity.recordContentPublish(user, type, id, title);
activity.recordUserLogin(user);
```

### Activity Types

```javascript
const ACTIVITY_TYPES = {
  CONTENT_CREATE: 'content.create',
  CONTENT_UPDATE: 'content.update',
  CONTENT_DELETE: 'content.delete',
  CONTENT_PUBLISH: 'content.publish',
  CONTENT_UNPUBLISH: 'content.unpublish',
  CONTENT_ARCHIVE: 'content.archive',
  CONTENT_CLONE: 'content.clone',
  CONTENT_COMMENT: 'content.comment',
  USER_LOGIN: 'user.login',
  USER_CREATE: 'user.create',
  MEDIA_UPLOAD: 'media.upload',
  WORKFLOW_APPROVE: 'workflow.approve',
  WORKFLOW_REJECT: 'workflow.reject',
  SYSTEM_BACKUP: 'system.backup',
};
```

### Activity Structure

```json
{
  "id": "act_abc123def456",
  "action": "content.update",
  "actor": {
    "id": "user123",
    "username": "admin",
    "type": "user"
  },
  "target": {
    "type": "article",
    "id": "abc123",
    "title": "Hello World"
  },
  "data": {
    "fields": ["title", "body"]
  },
  "timestamp": "2024-01-15T12:00:00.000Z"
}
```

### Aggregation

Similar activities are automatically grouped:
- "admin updated article/abc123 (3 times) - 5 min ago"
- Groups by same actor + action + target within configurable window (default 5 minutes)

### CLI Commands

```bash
# Show activity feed
activity:feed [--limit=20] [--action=content.update] [--days=30]

# Show user's activity
activity:user <userId> [--limit=20]

# Show content timeline
activity:content <type> <id>

# Show statistics
activity:stats [--days=30]
```

### Admin Routes

- `GET /admin/activity` - Global activity feed with pagination and filters
- `GET /admin/activity/user/:userId` - User-specific activity stream
- `GET /admin/content/:type/:id/activity` - Content timeline (vertical)
- `GET /api/activity/feed` - JSON API for widgets

### Dashboard Widget

Activity widget added to admin dashboard showing 5 most recent activities:
- Color-coded action icons
- Linked actor and target names
- Aggregation display ("3 times")
- Relative timestamps

### Configuration

```json
{
  "activity": {
    "enabled": true,
    "aggregateWindow": 300000,
    "retention": 90
  }
}
```

### Templates Added

- `modules/admin/templates/activity-feed.html` - Activity feed page
- `modules/admin/templates/activity-timeline.html` - Content timeline view
- Updated `modules/admin/templates/dashboard.html` - Added activity widget

### Next Planned (v0.0.56)

- Activity notifications integration
- Real-time activity updates (SSE)
- Activity export/report generation
- Bulk activity filters

---

*This document enables a fresh Claude instance to continue development from v0.0.55.*
