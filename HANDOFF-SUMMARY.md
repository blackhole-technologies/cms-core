# CMS Core - Handoff Summary

## Current Version: 0.0.76

## Project Overview

Zero-dependency Node.js CMS inspired by Drupal's architecture.

**Key Principles:**
- ES Modules only (no CommonJS)
- No external dependencies
- Hook-based extensibility
- Five-phase boot sequence
- Dual-mode: HTTP server or CLI

## Quick Start

```bash
cd experiments/cms-core

# CLI mode
node index.js help
node index.js feeds:list

# Server mode
node index.js
# → http://localhost:3000/admin
# → http://localhost:3000/graphql (playground)
# → http://localhost:3000/feed/greeting.rss (feeds)
```

## Directory Structure

```
cms-core/
├── core/           # Core modules (35 files)
├── config/         # site.json, modules.json, archetypes/, feeds.json
├── content/        # Flat-file JSON storage
├── modules/        # admin, users, media, tasks, etc.
├── themes/         # default theme
├── plugins/        # seo plugin
├── public/         # Static assets (css, js)
├── logs/           # Analytics, audit logs, api-usage/
└── backups/        # Backup archives
```

## Core Services (63)

| Service | Description |
|---------|-------------|
| content | Flat-file JSON CRUD with revisions |
| auth | Sessions, passwords, RBAC, CSRF |
| search | Full-text indexing |
| i18n | Internationalization |
| audit | Action logging |
| plugins | Hot-reloadable plugins |
| queue | Background jobs |
| scheduler | Cron-like tasks |
| backup | Full/incremental backups |
| analytics | Event tracking & stats |
| blueprints | Content templates |
| favorites | Content bookmarks |
| compare | Content comparison & merge |
| activity | Activity feed & timeline |
| archetypes | Content type builder |
| apiVersion | API versioning & deprecation |
| graphql | GraphQL API layer |
| feeds | RSS/Atom/JSON Feed syndication |
| sitemap | XML Sitemap & SEO tools |
| menu | Menu management & navigation |
| contact | Contact forms, submissions, flood control |
| ban | IP banning with CIDR support, middleware |
| history | Content read tracking per user (NEW) |
| notifications | User notifications |
| email | SMTP/console transport |
| comments | Threaded comments |
| oembed | Embed providers |
| fields | 21 field types |
| validation | 29 validators |
| preview | Token-based previews |
| cache | TTL-based caching |
| ratelimit | Sliding window |
| locks | Content locking |
| slugs | URL slug management |
| trash | Soft delete with retention |
| webhooks | Event dispatch |
| template | Mustache-like rendering |
| watcher | File watching & hot reload |
| transfer | Import/export |
| media | File uploads |
| views | Views/query builder |
| regions | Theme regions |
| layoutBuilder | Section-based page layouts |
| mediaLibrary | Reusable media entity management (NEW) |
| editor | WYSIWYG editor configuration (NEW) |
| responsiveImages | Breakpoints & responsive image rendering (NEW) |
| jsonapi | JSON:API 1.1 compliant API (NEW) |
| workflowAdvanced | Advanced workflow states |
| entityReference | Entity relationships |
| permissions | Granular permissions |
| forms | Form builder |
| pathAliases | URL aliases (pathauto) |
| imageStyles | Image derivatives |
| cron | Cron management |
| configManagement | Config import/export |
| contentTypes | Content type builder |
| displayModes | View modes |
| batch | Batch operations |
| status | Status reporting |
| contextual | Contextual links |
| help | Help system |
| tokens | Token replacement |
| textFormats | Text filters |
| entity | Entity API |
| actions | Actions/rules |
| userFields | Profile fields |
| themeSettings | Theme config |

## Recent Versions

| Version | Feature |
|---------|---------|
| 0.0.76 | Phase 4 - Media Library, WYSIWYG Editor, Responsive Images, JSON:API |
| 0.0.75 | Layout Builder - Section-based layouts, blocks in regions, per-content overrides, admin UI |
| 0.0.74 | Content History - Per-user read tracking, new/updated badges, LRU cache |
| 0.0.73 | IP Ban - CIDR ranges, temporary bans, middleware, admin UI |
| 0.0.72 | Contact forms - Forms CRUD, submissions, flood control, email, honeypot spam protection |
| 0.0.71 | Menu system - Admin UI, CLI, default menus, hierarchy, breadcrumbs |
| 0.0.70 | Phase 3 - Tokens, Text Formats, Entity API, Actions/Rules, User Fields, Theme Settings |
| 0.0.65 | Phase 2.5 - Content Types, Display Modes, Batch, Status, Contextual, Help |
| 0.0.61 | Phase 2 - Views, Regions, Workflow, Permissions, Forms, Aliases, Images, Cron, Config |
| 0.0.60 | XML Sitemap & SEO tools |
| 0.0.59 | RSS/Atom/JSON Feed syndication |
| 0.0.58 | GraphQL API layer |
| 0.0.57 | API versioning & deprecation |
| 0.0.56 | Archetypes - Content type builder |
| 0.0.55 | Activity feed & timeline |
| 0.0.54 | Content comparison & merge tools |

## CLI Commands (170+)

```bash
# Views
views:list                                    # List all views
views:create <name> [--type=article]          # Create view
views:execute <name>                          # Execute view query
views:config <name>                           # Show view config

# Workflow
workflow:list                                 # List workflow states
workflow:transition <type> <id> <state>       # Transition content

# Permissions
perms:list                                    # List all permissions
perms:grant <role> <permission>               # Grant permission
perms:revoke <role> <permission>              # Revoke permission
perms:check <user> <permission>               # Check permission

# Forms
forms:list                                    # List form definitions
forms:create <name>                           # Create form
forms:validate <name> <data>                  # Validate form data

# Path Aliases
paths:list                                    # List URL aliases
paths:create <path> <alias>                   # Create alias
paths:delete <alias>                          # Delete alias

# Images
images:styles                                 # List image styles
images:create-style <name>                    # Create image style
images:generate <file> <style>                # Generate derivative

# Cron
cron:list                                     # List cron jobs
cron:run [job]                                # Run cron job(s)
cron:schedule <job> <interval>                # Schedule job

# Config Management
config:export [--path=./exports]              # Export configuration
config:import <path>                          # Import configuration
config:diff <path>                            # Compare configs

# Content Types
types:list                                    # List content types
types:create <name>                           # Create content type
types:fields <type>                           # Show type fields

# Display Modes
display:list                                  # List display modes
display:create <name>                         # Create display mode
display:config <type> <mode>                  # Configure display

# Batch Operations
batch:list                                    # List batch operations
batch:run <operation> [--limit=100]           # Run batch operation
batch:status <id>                             # Check batch status

# Status & Reporting
status:system                                 # System status report
status:modules                                # Module status
status:requirements                           # Check requirements

# Tokens
tokens:list                                   # List available tokens
tokens:replace <text>                         # Replace tokens in text
tokens:create <name> <value>                  # Create custom token

# Text Formats
formats:list                                  # List text formats
formats:create <name>                         # Create text format
formats:process <format> <text>               # Process text with format

# Entity API
entity:types                                  # List entity types
entity:load <type> <id>                       # Load entity
entity:save <type> <data>                     # Save entity
entity:delete <type> <id>                     # Delete entity

# Actions/Rules
actions:list                                  # List available actions
actions:execute <action> [--data]             # Execute action
actions:create <name>                         # Create custom action

# User Fields
user:fields                                   # List user fields
user:field-create <name> <type>               # Create user field
user:field-delete <name>                      # Delete user field

# Theme Settings
theme:settings                                # Show theme settings
theme:set <key> <value>                       # Set theme setting
theme:regions                                 # List theme regions

# Menus
menu:list                                     # List all menus
menu:create <name>                            # Create menu
menu:delete <name>                            # Delete menu
menu:items <menu>                             # List menu items
menu:add <menu> <title> <path> [--weight=N]   # Add menu item
menu:remove <menu> <id>                       # Remove menu item
menu:move <menu> <id> --parent=<id>           # Move menu item
menu:render <menu>                            # Render menu tree

# Media Library (NEW)
media:library                                 # List media items
media:library --type=image --limit=50         # Filter by type
media:stats                                   # Show library statistics
media:types                                   # List media types
media:usage <id>                              # Show where media is used

# WYSIWYG Editor (NEW)
editor:formats                                # List editor formats
editor:buttons                                # List toolbar buttons
editor:buttons --category=formatting          # Filter by category
editor:config <format>                        # Show format config as JSON

# Responsive Images (NEW)
images:breakpoints                            # List responsive breakpoints
images:responsive                             # List responsive styles
images:render <path> <style>                  # Generate responsive HTML
images:render <path> <style> --picture        # Generate <picture> element

# JSON:API (NEW)
jsonapi:resources                             # Show JSON:API configuration
jsonapi:fetch <type>                          # Fetch resources via API
jsonapi:fetch <type> <id> --include=author    # Include relationships

# Contact Forms
contact:list                                  # List forms with stats
contact:create <id> [title] [recipients]      # Create form
contact:delete <id>                           # Delete form + submissions
contact:submissions <id>                      # List submissions
contact:submit [id]                           # Submit test message
contact:export <id>                           # Export form + submissions

# Sitemap & SEO
sitemap:generate [--type=article] [--index]  # Generate XML sitemap
sitemap:stats                                 # Sitemap statistics
sitemap:ping                                  # Ping search engines
seo:audit [type] [id]                         # Run SEO audit
seo:config <type> [--priority=0.8]           # Configure sitemap
robots:generate                               # Generate robots.txt

# Feeds
feeds:list                                # List available feeds
feeds:generate <type> [--format=rss]      # Generate feed output
feeds:validate <type>                     # Validate feed config
feeds:config <type> [--enable] [--limit]  # Configure feed

# GraphQL
graphql:schema                            # Print generated schema
graphql:types                             # List GraphQL types
graphql:query <query>                     # Execute GraphQL query

# API Versioning
api:versions                              # List API versions
api:deprecations                          # Show deprecation warnings

# Archetypes
archetypes:list                           # List content types
archetypes:show <name>                    # Show type details

# Content, Activity, Favorites, Blueprints, Analytics, Backup...
```

## Admin Routes

- `/admin` - Dashboard
- `/admin/views` - Views builder (NEW)
- `/admin/views/create` - Create view (NEW)
- `/admin/views/:name` - Edit view (NEW)
- `/admin/permissions` - Permissions matrix (NEW)
- `/admin/permissions/roles` - Role management (NEW)
- `/admin/forms` - Form builder (NEW)
- `/admin/forms/:name` - Edit form (NEW)
- `/admin/paths` - URL aliases (NEW)
- `/admin/images/styles` - Image styles (NEW)
- `/admin/cron` - Cron jobs (NEW)
- `/admin/config` - Config management (NEW)
- `/admin/types` - Content types builder (NEW)
- `/admin/types/:name` - Edit content type (NEW)
- `/admin/display` - Display modes (NEW)
- `/admin/batch` - Batch operations (NEW)
- `/admin/status` - Status report (NEW)
- `/admin/tokens` - Token browser (NEW)
- `/admin/formats` - Text formats (NEW)
- `/admin/actions` - Actions/rules (NEW)
- `/admin/user-fields` - User profile fields (NEW)
- `/admin/theme` - Theme settings (NEW)
- `/admin/menus` - Menu management (NEW)
- `/admin/menus/:name` - Menu items (NEW)
- `/admin/menus/:name/add` - Add menu item
- `/admin/contact-forms` - Contact forms list (NEW)
- `/admin/contact-forms/:id/edit` - Edit contact form
- `/admin/contact-forms/:id/submissions` - Form submissions
- `/admin/media/library` - Media library browser (NEW)
- `/admin/media/library/:id` - Media item details (NEW)
- `/admin/editor` - Editor formats management (NEW)
- `/admin/editor/config/:format` - Editor config JSON (NEW)
- `/admin/responsive-images` - Responsive image styles (NEW)
- `/admin/jsonapi` - JSON:API explorer (NEW)
- `/admin/seo` - SEO dashboard
- `/admin/seo/audit` - SEO audit results
- `/admin/feeds` - Feed management
- `/admin/graphql` - GraphQL Explorer
- `/admin/api` - API documentation
- `/admin/api/versions` - API version status
- `/admin/archetypes` - Content type builder
- `/admin/activity` - Activity feed
- `/admin/compare` - Compare tool
- `/admin/favorites` - Favorites management
- `/admin/content` - Content management
- `/admin/blueprints` - Template management
- `/admin/analytics` - Statistics dashboard
- `/admin/users` - User management
- `/admin/media` - File uploads

## Sitemap Routes (NEW)

- `GET /sitemap.xml` - Main sitemap or index
- `GET /sitemap-:type.xml` - Per-type sitemap
- `GET /robots.txt` - Robots file

## Feed Routes

- `GET /feed/:type.rss` - RSS 2.0 feed
- `GET /feed/:type.atom` - Atom 1.0 feed
- `GET /feed/:type.json` - JSON Feed 1.1
- `GET /feed/:type` - Default (RSS) feed

## GraphQL Routes

- `GET /graphql` - GraphQL Playground
- `POST /graphql` - GraphQL endpoint

## JSON:API Routes (NEW)

- `GET /jsonapi` - Entry point (list resource types)
- `GET /jsonapi/{type}` - List resources
- `POST /jsonapi/{type}` - Create resource
- `GET /jsonapi/{type}/{id}` - Get resource
- `PATCH /jsonapi/{type}/{id}` - Update resource
- `DELETE /jsonapi/{type}/{id}` - Delete resource
- `GET /jsonapi/{type}/{id}/relationships/{rel}` - Get relationship

## API Routes

- `GET /api/versions` - List API versions
- `GET /api/v1/content/:type` - List content (v1)
- `GET /api/v2/content/:type` - List content (v2)

## Configuration

`config/site.json` - All feature flags and settings.

Key sections: cache, revisions, slugs, trash, workflow, csrf, rateLimit, audit, locks, comments, queue, oembed, validation, preview, email, notifications, backup, analytics, blueprints, activity, archetypes, api, graphql, feeds, plugins.

## v0.0.60 Changes

### Sitemap & SEO System (`core/sitemap.js`)

```javascript
// Generate XML sitemap
const xml = sitemap.generateSitemap('article');

// Generate full sitemap (all types)
const fullXml = sitemap.generateFullSitemap();

// Generate sitemap index (for >50k URLs)
const index = sitemap.generateSitemapIndex();

// Generate robots.txt
const robots = sitemap.generateRobotsTxt();

// Configure sitemap for a type
sitemap.setSitemapConfig('article', {
  enabled: true,
  priority: 0.8,
  changefreq: 'weekly',
  urlTemplate: '/article/{{slug}}',
});

// Run SEO audit
const audit = sitemap.auditSEO('article');

// Ping search engines
const results = await sitemap.pingSearchEngines();
```

### SEO Configuration

```json
{
  "seo": {
    "enabled": true,
    "siteUrl": "http://localhost:3000"
  }
}
```

Per-type configuration stored in `config/sitemap.json`:
```json
{
  "article": {
    "enabled": true,
    "changefreq": "weekly",
    "priority": 0.8,
    "urlTemplate": "/article/{{slug}}",
    "lastmodField": "updated",
    "statusFilter": "published"
  }
}
```

### Features

- **XML Sitemap 0.9**: Full protocol compliance
- **Sitemap Index**: Auto-generated for large sites (>50k URLs)
- **robots.txt**: Configurable with sitemap reference
- **SEO Audit**: Check for missing titles, descriptions, alt text
- **Search Engine Ping**: Notify Bing about updates
- **Per-Type Config**: Priority, change frequency, URL templates

### SEO Audit Checks

- Missing title
- Title too long (>60 chars)
- Missing meta description
- Description too long (>160 chars)
- Missing URL slug
- Empty content body
- Images missing alt text
- Multiple H1 tags

### New Templates

- `modules/admin/templates/seo-dashboard.html`
- `modules/admin/templates/seo-audit.html`

## Testing

```bash
# Test Phase 3 features
node index.js tokens:list
node index.js tokens:replace "Hello [user:name]!"
node index.js formats:list
node index.js formats:process html "<p>Test</p>"
node index.js entity:types
node index.js actions:list
node index.js user:fields
node index.js theme:settings

# Test Phase 2.5 features
node index.js types:list
node index.js display:list
node index.js batch:list
node index.js status:system
node index.js status:modules

# Test Phase 2 features
node index.js views:list
node index.js workflow:list
node index.js perms:list
node index.js forms:list
node index.js paths:list
node index.js images:styles
node index.js cron:list
node index.js config:export

# Test sitemap
node index.js sitemap:stats
node index.js sitemap:generate --type=greeting | head -15
node index.js seo:audit greeting

# Test via HTTP
curl "http://localhost:3000/admin/views"
curl "http://localhost:3000/admin/permissions"
curl "http://localhost:3000/admin/tokens"
curl "http://localhost:3000/sitemap.xml"

# System test
node index.js admin:stats
```

## v0.0.76 Changes

### Phase 4 Complete - Media & API Features

**New Core Services:**
- `core/media-library.js` - Reusable media entity management
- `core/editor.js` - WYSIWYG editor configuration
- `core/responsive-images.js` - Breakpoints & responsive rendering
- `core/jsonapi.js` - JSON:API 1.1 compliant API

**Media Library:**
- Media entities (not just files)
- Multiple types: image, video, audio, document, remote_video
- Usage tracking across content
- Automatic thumbnail generation
- YouTube/Vimeo remote video support
- Bulk operations

**WYSIWYG Editor:**
- Backend-agnostic configuration
- 4 built-in formats (minimal, basic, full, code)
- 44 toolbar buttons in 9 categories
- Text format integration
- Media embed processing
- Custom format registration

**Responsive Images:**
- 5 breakpoints (mobile, tablet, desktop, wide, retina)
- 5 built-in styles (hero, content, thumbnail, card, avatar)
- srcset/sizes generation
- Picture element for art direction
- WebP/AVIF support
- Lazy loading

**JSON:API:**
- Full JSON:API 1.1 spec compliance
- Compound documents (include)
- Sparse fieldsets (fields)
- Filtering with operators
- Sorting and pagination
- Relationship endpoints

**New Documentation:**
- `docs/MEDIA-LIBRARY.md`
- `docs/EDITOR.md`
- `docs/RESPONSIVE-IMAGES.md`
- `docs/JSONAPI.md`
- `docs/LAYOUT-BUILDER.md`

**New Admin Templates:**
- `modules/admin/templates/media-library.html`
- `modules/admin/templates/media-detail.html`
- `modules/admin/templates/editor-formats.html`
- `modules/admin/templates/responsive-images.html`
- `modules/admin/templates/jsonapi.html`

## v0.0.70 Changes

### Phase 3 Complete - Enterprise CMS Features

**New Core Services:**
- `core/tokens.js` - Token replacement system
- `core/textFormats.js` - Text filtering/processing
- `core/entity.js` - Entity API layer
- `core/actions.js` - Actions/rules engine
- `core/userFields.js` - User profile fields
- `core/themeSettings.js` - Theme configuration

**Token System:**
- Global tokens (site:name, date:now, user:name)
- Content tokens (content:title, content:id)
- Custom token registration
- Nested token support

**Text Formats:**
- Plain text, HTML, Markdown
- Filter chains (sanitize, line breaks, tokens)
- Custom format creation
- Security-focused sanitization

**Entity API:**
- Unified CRUD interface
- Entity type registration
- Field API integration
- Validation hooks

**Actions/Rules:**
- Event-triggered actions
- Conditional rules
- Content publishing workflows
- Email notifications
- Custom action registration

**User Fields:**
- Custom profile fields
- Field type support
- Validation rules
- Display configuration

**Theme Settings:**
- Logo/favicon upload
- Color schemes
- Layout options
- Custom CSS/JS injection

### Phase 2.5 Complete - Builder Tools

**New Core Services:**
- `core/contentTypes.js` - Content type builder
- `core/displayModes.js` - View modes
- `core/batch.js` - Batch operations
- `core/status.js` - Status reporting
- `core/contextual.js` - Contextual links
- `core/help.js` - Help system

**Content Types:**
- Dynamic type creation
- Field configuration UI
- Type-specific settings
- Type deletion with validation

**Display Modes:**
- Full, teaser, search result modes
- Field formatters
- Field visibility per mode
- Custom mode creation

**Batch Operations:**
- Bulk publish/unpublish
- Bulk delete
- Progress tracking
- Error handling

**Status Reporting:**
- System health checks
- Module compatibility
- Security updates
- Performance metrics

### Phase 2 Complete - Views & Advanced Features

**New Core Services:**
- `core/views.js` - Views/query builder
- `core/regions.js` - Theme regions
- `core/workflowAdvanced.js` - Advanced workflow
- `core/entityReference.js` - Entity relationships
- `core/permissions.js` - Granular permissions
- `core/forms.js` - Form builder
- `core/pathAliases.js` - URL aliases
- `core/imageStyles.js` - Image derivatives
- `core/cron.js` - Cron management
- `core/configManagement.js` - Config import/export

**Views System:**
- Query builder with filters
- Sorting and paging
- Display templates
- Contextual filters
- Exposed filters

**Workflow:**
- Draft → Review → Published states
- Moderated content
- Revision comparison
- State transition rules

**Permissions:**
- Role-based access control
- Per-content-type permissions
- Custom permission creation
- Permission matrix UI

**Forms:**
- Drag-and-drop form builder
- Field validation
- Conditional fields
- Multi-step forms

**Path Aliases:**
- SEO-friendly URLs
- Pattern-based generation
- Bulk operations
- Redirect management

**Image Styles:**
- Preset image sizes
- Crop/scale/resize
- Lazy generation
- Cache management

## Next Suggested Features

- v0.0.72: Block system
- v0.0.73: REST API expansion
- v0.0.74: Taxonomy admin UI

## Files Modified This Session

### Phase 4 (v0.0.76)
- `core/media-library.js` - Created
- `core/editor.js` - Created
- `core/responsive-images.js` - Created
- `core/jsonapi.js` - Created
- `core/boot.js` - Added Phase 4 services
- `core/layout-builder.js` - Enhanced (v0.0.75)
- `modules/admin/index.js` - Added Phase 4 routes & CLI
- `modules/admin/templates/media-library.html` - Created
- `modules/admin/templates/media-detail.html` - Created
- `modules/admin/templates/editor-formats.html` - Created
- `modules/admin/templates/responsive-images.html` - Created
- `modules/admin/templates/jsonapi.html` - Created
- `docs/MEDIA-LIBRARY.md` - Created
- `docs/EDITOR.md` - Created
- `docs/RESPONSIVE-IMAGES.md` - Created
- `docs/JSONAPI.md` - Created
- `docs/LAYOUT-BUILDER.md` - Created
- `package.json` - v0.0.76

### Phase 3 (v0.0.70)
- `core/tokens.js` - Created
- `core/textFormats.js` - Created
- `core/entity.js` - Created
- `core/actions.js` - Created
- `core/userFields.js` - Created
- `core/themeSettings.js` - Created
- `core/boot.js` - Added Phase 3 services
- `modules/admin/index.js` - Added Phase 3 routes & CLI
- `config/site.json` - v0.0.70

### Phase 2.5 (v0.0.65)
- `core/contentTypes.js` - Created
- `core/displayModes.js` - Created
- `core/batch.js` - Created
- `core/status.js` - Created
- `core/contextual.js` - Created
- `core/help.js` - Created
- `core/boot.js` - Added Phase 2.5 services
- `modules/admin/index.js` - Added Phase 2.5 routes & CLI
- `config/site.json` - v0.0.65

### Phase 2 (v0.0.61)
- `core/views.js` - Created
- `core/regions.js` - Created
- `core/workflowAdvanced.js` - Created
- `core/entityReference.js` - Created
- `core/permissions.js` - Created
- `core/forms.js` - Created
- `core/pathAliases.js` - Created
- `core/imageStyles.js` - Created
- `core/cron.js` - Created
- `core/configManagement.js` - Created
- `core/boot.js` - Added Phase 2 services
- `modules/admin/index.js` - Added Phase 2 routes & CLI
- `config/site.json` - v0.0.61

### Previous (v0.0.60)
- `core/sitemap.js` - Created
- `modules/admin/templates/seo-dashboard.html` - Created
- `modules/admin/templates/seo-audit.html` - Created
- `HANDOFF-SUMMARY.md` - Updated

## Git Status

```
main branch
Latest: 9ed11c8 - Add keyboard shortcuts for admin UI (v0.0.52)
Uncommitted: v0.0.53-80
Ready to commit: v0.0.76 - Phase 4 (Media Library, WYSIWYG Editor, Responsive Images, JSON:API)
```

## Full Documentation

See `HANDOFF.md` for complete API documentation.

---

*Generated: 2026-02-07 | Version: 0.0.76*
