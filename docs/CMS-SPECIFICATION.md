# CMS-Core Feature Specification

**Version:** 1.0.0
**Status:** Living Document
**Last Updated:** 2026-02-03

---

## Overview

This document defines what "fully-featured Drupal-like CMS" means for the cms-core project. It categorizes features into three tiers: MUST HAVE (core functionality), SHOULD HAVE (expected in production CMS), and NICE TO HAVE (advanced features).

cms-core is a zero-dependency Node.js CMS inspired by Drupal pre-9 architecture, built with ES modules and a hook-based extensibility system.

---

## 1. CONTENT MANAGEMENT

### 1.1 Content Operations (MUST HAVE)

**Content CRUD**
- Create, read, update, delete content items
- Content types with custom fields
- Field types: text, textarea, rich text, number, boolean, date, email, URL
- Content validation with 29+ validators
- Flat-file JSON storage (zero-dependency)

**Content Organization**
- Content type definitions (archetypes)
- Field-level configuration
- Content relationships (references)
- Content cloning/duplication

**Search & Discovery**
- Full-text search across content
- Content listing with filtering
- Content sorting by field values

### 1.2 Advanced Content Features (SHOULD HAVE)

**Revisions & History**
- Content revision tracking
- Revision comparison
- Rollback to previous versions
- Configurable retention (max 10 revisions per item default)

**Workflow & Publishing**
- Status management: draft, published, scheduled, archived
- Scheduled publishing/unpublishing
- Content locking (prevent concurrent edits)
- Soft delete with trash/restore (30-day retention)

**Content Validation**
- 29 built-in validators:
  - Basic: required, minLength, maxLength, pattern
  - Format: email, url, phoneNumber, zipCode, creditCard
  - Numeric: min, max, integer, positive, negative
  - Date: dateAfter, dateBefore, dateRange, futureDate, pastDate
  - Advanced: fileSize, fileType, imageWidth, unique, custom, async
- Custom validation rules
- Field-level and cross-field validation
- Validation error messages

**Content Enhancement**
- Computed fields (dynamic fields calculated from other data)
- Content blueprints/templates
- Content comparison & merge tools
- Content favorites/bookmarks

### 1.3 Advanced Features (NICE TO HAVE)

**Multi-tenancy**
- Content spaces/sites
- Per-space content isolation

**Content Import/Export**
- Bulk import from CSV/JSON
- Content export with references
- Content transfer between instances

**Versioned Content**
- Content branches
- Content staging environments

---

## 2. CONTENT TYPES & FIELDS

### 2.1 Field System (MUST HAVE)

**Core Field Types** (21 total)
- `text` - Single-line text
- `textarea` - Multi-line text
- `richtext` - HTML editor
- `number` - Numeric values
- `boolean` - True/false
- `date` - Date/time
- `email` - Email address
- `url` - Web URL
- `select` - Dropdown selection
- `multiselect` - Multiple selection
- `reference` - Content reference
- `file` - File upload
- `image` - Image upload
- `json` - Structured data
- `tags` - Tag list
- `geo` - Geographic coordinates
- `color` - Color picker
- `range` - Numeric range
- `rating` - Star/numeric rating
- `phone` - Phone number
- `markdown` - Markdown text

**Field Configuration**
- Label and description
- Default values
- Required/optional
- Validation rules
- Help text

### 2.2 Content Type Builder (SHOULD HAVE)

**Archetype System**
- Define custom content types (archetypes)
- Field assignment to types
- Field ordering
- Field groups/sections
- Type-level configuration
- JSON-based type definitions

**Field Management**
- Add/remove fields from types
- Reorder fields
- Configure field display
- Field-level permissions

### 2.3 Advanced Field Features (NICE TO HAVE)

**Field Groups**
- Group related fields
- Collapsible field groups
- Tabbed field groups

**Conditional Fields**
- Show/hide based on other field values
- Dynamic required/optional

**Computed Fields**
- Auto-calculate from other fields
- Custom computation logic

---

## 3. SITE BUILDING

### 3.1 URL Management (MUST HAVE)

**Slugs & Aliases**
- Auto-generated URL slugs
- Custom URL aliases
- Unicode to ASCII transliteration
- Slug uniqueness enforcement
- Configurable separator and max length
- Old URL redirects (301)

**Routing**
- Pattern-based routing
- Dynamic route parameters
- Route middleware support

### 3.2 Taxonomy (SHOULD HAVE)

**Categorization**
- Hierarchical categories/terms
- Multiple vocabularies (taxonomies)
- Tag-style free tagging
- Term references in content

**Taxonomy Management**
- Create/edit/delete terms
- Term hierarchy (parent/child)
- Term descriptions
- Term metadata

### 3.3 Menus & Navigation (SHOULD HAVE)

**Menu System**
- Multiple menu instances
- Menu item hierarchy
- Menu links to content
- External links
- Custom menu items

**Menu Rendering**
- Nested menu rendering
- Active trail highlighting
- Menu depth limits

### 3.4 Blocks & Regions (NICE TO HAVE)

**Block System**
- Define block types
- Place blocks in regions
- Block visibility rules
- Block configuration

**Layout Regions**
- Theme-defined regions
- Region-based content placement

### 3.5 Views (NICE TO HAVE)

**Dynamic Content Lists**
- Configure content queries
- Filter by field values
- Sort and pagination
- Display formats (table, grid, list)

---

## 4. USER MANAGEMENT

### 4.1 Authentication (MUST HAVE)

**User Accounts**
- User registration
- Login/logout
- Password hashing (bcrypt)
- Session management
- CSRF protection

**Password Management**
- Secure password storage
- Password reset flow
- Email-based password recovery

### 4.2 Authorization (MUST HAVE)

**Roles & Permissions**
- Role-based access control (RBAC)
- Default roles: anonymous, authenticated, admin
- Permission system
- User-role assignment

**Content Permissions**
- Create/edit/delete per content type
- View published/unpublished
- Content ownership checks

### 4.3 Advanced User Features (SHOULD HAVE)

**User Profiles**
- Extended user data
- Profile fields
- User avatars

**User Activity**
- Activity feed/timeline
- Login history
- Content authorship tracking

**Notifications**
- User notifications
- Email notifications
- In-app notifications
- Configurable channels

---

## 5. THEMING

### 5.1 Template System (MUST HAVE)

**Template Engine**
- Mustache-like syntax
- Variable interpolation: `{{variable}}`
- Conditionals: `{{#if}}...{{/if}}`
- Loops: `{{#each}}...{{/each}}`
- Partials: `{{> partial}}`
- Helpers/filters

**Template Files**
- HTML-based templates
- Template inheritance
- Template suggestions (fallback chain)

**Theme Structure**
```
themes/
└── [theme-name]/
    ├── manifest.json
    ├── templates/
    ├── css/
    └── js/
```

### 5.2 Theme Configuration (SHOULD HAVE)

**Theme Settings**
- Theme metadata (name, version, description)
- Theme regions
- Template directory structure
- Asset paths

**Theme Switching**
- Active theme selection
- Per-user theme (NICE TO HAVE)

### 5.3 Asset Management (SHOULD HAVE)

**Static Assets**
- CSS/JS file organization
- Asset aggregation (NICE TO HAVE)
- Minification (NICE TO HAVE)
- CDN support (NICE TO HAVE)

**Public Files**
- Serve static files from `/public`
- CSS, JS, images, fonts
- Content-Security-Policy headers

---

## 6. DEVELOPER EXPERIENCE

### 6.1 Hook System (MUST HAVE)

**Event-Based Extension**
- Hook registration
- Hook invocation
- Alter hooks (data transformation)
- Action hooks (event listeners)

**Hook Naming Convention**
- `[module]_[entity]_[operation]`
- Example: `admin_content_save`

**Core Hooks**
- `boot` - Module initialization
- `routes` - Register routes
- `services` - Register services
- `cli` - Register CLI commands
- Content lifecycle hooks
- User lifecycle hooks

### 6.2 Module System (MUST HAVE)

**Module Structure**
```
modules/
└── [module-name]/
    ├── manifest.json
    ├── index.js
    └── templates/
```

**Module API**
- `register(services)` - Register services
- `boot(services)` - Initialize module
- Hook exports
- Service exports

**Module Discovery**
- Auto-scan `/modules` directory
- Load enabled modules from config
- Dependency resolution
- Module ordering

### 6.3 Service Container (MUST HAVE)

**Dependency Injection**
- Service registration
- Service resolution
- Singleton services
- Service configuration

**Core Services** (35+ services)
- `content` - Content CRUD
- `auth` - Authentication
- `cache` - Caching
- `search` - Search indexing
- `template` - Rendering
- `router` - HTTP routing
- `email` - Email delivery
- `notifications` - User notifications
- `media` - File uploads
- `queue` - Background jobs
- `scheduler` - Cron tasks
- `backup` - Backup/restore
- `analytics` - Event tracking
- `webhooks` - Outbound webhooks
- `graphql` - GraphQL API
- `feeds` - RSS/Atom/JSON
- `sitemap` - XML sitemap
- And 18 more...

### 6.4 Plugin System (SHOULD HAVE)

**Hot-Reloadable Plugins**
- Plugin directory: `/plugins`
- File watching & auto-reload
- Plugin lifecycle hooks
- Plugin configuration

**Plugin Structure**
```
plugins/
└── [plugin-name]/
    ├── manifest.json
    └── index.js
```

### 6.5 CLI Tools (SHOULD HAVE)

**Command-Line Interface**
- 100+ CLI commands
- Command registration via hooks
- Help system
- Interactive prompts

**Core Commands**
- Content: create, read, update, delete, list, search
- Users: create, list, assign roles
- System: cache clear, backup, restore
- Media: upload, list, stats
- Analytics: events, stats, trends
- Sitemap: generate, stats, ping
- GraphQL: schema, query, types
- Feeds: list, generate, validate

**CLI Architecture**
- Dual-mode: CLI or HTTP server
- Parse command-line arguments
- Output formatting
- Error handling

### 6.6 API Patterns (SHOULD HAVE)

**REST API**
- CRUD endpoints per content type
- JSON request/response
- API versioning (v1, v2)
- API deprecation warnings
- Rate limiting
- API usage tracking

**GraphQL API**
- Schema auto-generation from content types
- Query interface
- Pagination support
- GraphQL Playground
- Introspection
- Max depth protection

**Feed API**
- RSS 2.0
- Atom 1.0
- JSON Feed 1.1
- Per-type feed configuration

---

## 7. ADMINISTRATION

### 7.1 Admin UI (MUST HAVE)

**Dashboard**
- System overview
- Quick stats
- Recent activity

**Content Management UI**
- Content listing
- Content creation forms
- Content editing interface
- Bulk operations

**Admin Routes** (15+)
- `/admin` - Dashboard
- `/admin/content` - Content management
- `/admin/users` - User management
- `/admin/media` - File manager
- `/admin/analytics` - Statistics
- `/admin/favorites` - Bookmarks
- `/admin/compare` - Comparison tool
- `/admin/activity` - Activity feed
- `/admin/archetypes` - Type builder
- `/admin/graphql` - GraphQL explorer
- `/admin/feeds` - Feed management
- `/admin/seo` - SEO dashboard
- `/admin/api` - API docs
- And more...

### 7.2 Configuration Management (SHOULD HAVE)

**Configuration Storage**
- JSON-based configuration
- `/config/site.json` - Site settings
- `/config/modules.json` - Enabled modules
- `/config/archetypes/*.json` - Content types
- `/config/feeds.json` - Feed definitions
- `/config/sitemap.json` - Sitemap config

**Configuration API**
- Read/write config values
- Config validation
- Environment-specific config

**Settings Management**
- Feature flags
- Service configuration
- Module settings

### 7.3 Backup & Restore (SHOULD HAVE)

**Backup System**
- Full backups (content + config)
- Incremental backups
- Scheduled backups (cron)
- Retention policies (daily/weekly/monthly)
- Backup to `/backups` directory

**Restore**
- Restore from backup archive
- Selective restore
- Backup validation

**CLI Commands**
- `backup:create` - Create backup
- `backup:list` - List backups
- `backup:restore <id>` - Restore backup
- `backup:schedule` - Configure schedule

---

## 8. MEDIA & FILES

### 8.1 File Management (MUST HAVE)

**File Uploads**
- Upload via API
- File type validation
- File size limits
- Storage in `/content/media`

**Image Handling**
- Image metadata extraction
- MIME type detection
- File extension validation

**Media Library**
- List uploaded files
- File metadata
- File deletion

### 8.2 Media Features (SHOULD HAVE)

**File Browser**
- Visual file picker
- Search files
- Filter by type
- Pagination

**File References**
- Link files to content
- Image/file field types
- Track file usage

### 8.3 Advanced Media (NICE TO HAVE)

**Image Processing**
- Image resizing
- Thumbnail generation
- Image optimization
- Multiple formats (WebP, AVIF)

**oEmbed Support**
- Embed YouTube, Vimeo, etc.
- Provider registry
- URL to embed conversion
- Cache embed responses

---

## 9. SECURITY

### 9.1 Core Security (MUST HAVE)

**Authentication Security**
- Password hashing (bcrypt)
- Secure session handling
- Session expiry
- CSRF token validation

**Input Validation**
- Field-level validation
- SQL injection prevention (N/A - no SQL)
- XSS prevention
- File upload validation

**Access Control**
- Permission checks
- Role-based access
- Content ownership validation

### 9.2 Additional Security (SHOULD HAVE)

**Rate Limiting**
- Sliding window algorithm
- Login rate limits (5 attempts/minute)
- API rate limits (100 requests/minute)
- Admin rate limits (60 requests/minute)
- Configurable per-endpoint

**Audit Logging**
- User action tracking
- Content change logs
- Authentication events
- Admin actions
- Log retention (90 days)

**Content Security**
- Content locking (prevent concurrent edits)
- Lock timeout (30 minutes)
- Lock stealing protection
- Grace period for idle locks

### 9.3 Advanced Security (NICE TO HAVE)

**Two-Factor Authentication**
- TOTP support
- Backup codes
- Trusted devices

**IP Restrictions**
- IP whitelist/blacklist
- Admin IP restrictions

**Security Headers**
- Content-Security-Policy
- X-Frame-Options
- X-Content-Type-Options

---

## 10. PERFORMANCE

### 10.1 Caching (SHOULD HAVE)

**Cache System**
- TTL-based in-memory cache
- Cache keys
- Cache invalidation
- Cache statistics

**Cache Strategies**
- Page caching
- API response caching (60s TTL)
- Computed field caching
- oEmbed response caching (7 days)

### 10.2 Optimization (SHOULD HAVE)

**Search Optimization**
- Full-text index
- Incremental indexing
- Configurable min word length
- Fuzzy search (optional)

**Query Optimization**
- Filter at storage layer
- Limit result sets
- Pagination

### 10.3 Advanced Performance (NICE TO HAVE)

**Static Rendering**
- Pre-render pages
- Cache HTML output
- Incremental static regeneration

**Database**
- Migrate from flat-file to SQLite/PostgreSQL
- Query optimization
- Connection pooling

---

## 11. BACKGROUND PROCESSING

### 11.1 Queue System (SHOULD HAVE)

**Job Queue**
- Add jobs to queue
- Process jobs in background
- Job priorities
- Retry failed jobs (max 3 attempts)
- Job concurrency (5 concurrent)

**Job Types**
- Email sending
- Content indexing
- Backup creation
- Report generation
- File processing

**Queue Management**
- Queue status
- Failed jobs
- Job archival (after 7 days)

### 11.2 Scheduler (SHOULD HAVE)

**Cron-like Scheduling**
- Schedule tasks with cron expressions
- Task execution tracking
- Task history
- Last run tracking

**Scheduled Tasks**
- Backup creation
- Analytics aggregation
- Content publishing/unpublishing
- Cache cleanup
- Index rebuilding

---

## 12. ANALYTICS & REPORTING

### 12.1 Analytics (SHOULD HAVE)

**Event Tracking**
- Page views
- API requests
- User actions
- Content events

**Analytics Data**
- Event logs
- Aggregate statistics
- Hourly aggregation
- Retention (90 days)

**Reports**
- Most viewed content
- Active users
- API usage
- Popular routes

### 12.2 Admin Analytics (SHOULD HAVE)

**Dashboard Stats**
- Content counts by type
- User counts by role
- Recent activity
- System health

**Trends**
- Daily trends
- Weekly trends
- Event trends

---

## 13. INTERNATIONALIZATION

### 13.1 i18n Support (SHOULD HAVE)

**Locale System**
- Multiple locales (en, es, fr default)
- Default locale configuration
- Locale fallback

**Translation**
- String translation
- Translation files
- Runtime translation lookup

**Content Translation**
- Translatable content fields
- Per-language content variants

### 13.2 Advanced i18n (NICE TO HAVE)

**RTL Support**
- Right-to-left languages
- Direction-aware CSS

**Locale Detection**
- Browser language detection
- URL-based locale
- User preference

---

## 14. SEO & DISCOVERABILITY

### 14.1 SEO Tools (SHOULD HAVE)

**XML Sitemap**
- Auto-generate sitemap.xml
- Per-type sitemaps
- Sitemap index (for >50k URLs)
- Configurable changefreq, priority
- Search engine ping (Bing)

**Robots.txt**
- Generate robots.txt
- Sitemap reference
- Configurable rules

**SEO Audit**
- Check missing titles
- Check title length (<60 chars)
- Check meta descriptions
- Check description length (<160 chars)
- Check image alt text
- Check H1 tags

### 14.2 Metadata (SHOULD HAVE)

**Meta Tags**
- Page title
- Meta description
- Canonical URL
- Open Graph tags
- Twitter Cards

**Structured Data**
- JSON-LD support
- Schema.org markup
- Rich snippets

---

## 15. EXTENSIBILITY

### 15.1 Hook Architecture (MUST HAVE)

**Hook Types**
- Action hooks - Execute code on events
- Filter hooks - Transform data
- Alter hooks - Modify configurations

**Hook Registration**
- Modules register hooks via exports
- Priority-based execution
- Hook metadata

### 15.2 Service Architecture (MUST HAVE)

**Service Pattern**
- Singleton services
- Service dependencies
- Service lifecycle
- Service configuration

**Service API**
- `services.register(name, instance)` - Register service
- `services.get(name)` - Get service
- `services.has(name)` - Check if exists

### 15.3 Module Dependencies (NICE TO HAVE)

**Dependency Resolution**
- Declare module dependencies
- Topological sorting
- Circular dependency detection
- Optional dependencies

---

## 16. DEVELOPER TOOLS

### 16.1 Development Mode (SHOULD HAVE)

**File Watching**
- Watch plugin directory
- Auto-reload on changes
- Configurable debounce (500ms)

**Debug Tools**
- Verbose logging
- Error traces
- Performance profiling

### 16.2 Testing Support (NICE TO HAVE)

**Test Utilities**
- Test content creation
- Mock services
- Fixture data

**API Testing**
- REST endpoint testing
- GraphQL query testing

---

## 17. COMMENTS & DISCUSSION

### 17.1 Comment System (SHOULD HAVE)

**Comments**
- Threaded comments
- Comment nesting (max depth: 3)
- Comment status (pending, approved, spam)
- Auto-approve authenticated users
- Require email for anonymous

**Comment Moderation**
- Approve/reject comments
- Mark as spam
- Delete comments

---

## 18. WEBHOOKS & INTEGRATIONS

### 18.1 Webhooks (SHOULD HAVE)

**Outbound Webhooks**
- Trigger on events
- HTTP POST to URL
- Retry on failure
- Event filtering

**Webhook Events**
- Content created/updated/deleted
- User created/updated
- Custom events

### 18.2 Integrations (NICE TO HAVE)

**Third-Party Services**
- OAuth providers
- Payment gateways
- Marketing tools
- Analytics platforms

---

## Feature Matrix

| Feature Category | MUST HAVE | SHOULD HAVE | NICE TO HAVE | Current Status |
|-----------------|-----------|-------------|--------------|----------------|
| Content CRUD | ✓ | ✓ | ✓ | ✓ Implemented |
| Content Types | ✓ | ✓ | Partial | ✓ Implemented |
| Field System | ✓ | ✓ | Partial | ✓ 21 types |
| Search | ✓ | ✓ | - | ✓ Implemented |
| Revisions | - | ✓ | - | ✓ Implemented |
| Workflow | - | ✓ | - | ✓ Implemented |
| User Auth | ✓ | ✓ | - | ✓ Implemented |
| RBAC | ✓ | ✓ | - | ✓ Implemented |
| Templates | ✓ | ✓ | - | ✓ Implemented |
| Hooks | ✓ | - | - | ✓ Implemented |
| Modules | ✓ | - | - | ✓ Implemented |
| Services | ✓ | - | - | ✓ 35 services |
| Plugins | - | ✓ | - | ✓ Implemented |
| CLI | - | ✓ | - | ✓ 100+ commands |
| REST API | - | ✓ | - | ✓ Implemented |
| GraphQL | - | ✓ | - | ✓ Implemented |
| Admin UI | ✓ | ✓ | - | ✓ 15+ routes |
| Config Mgmt | - | ✓ | - | ✓ JSON-based |
| Backup | - | ✓ | - | ✓ Implemented |
| Media | ✓ | ✓ | Partial | ✓ Implemented |
| Security | ✓ | ✓ | Partial | ✓ Implemented |
| Caching | - | ✓ | - | ✓ Implemented |
| Queue | - | ✓ | - | ✓ Implemented |
| Scheduler | - | ✓ | - | ✓ Implemented |
| Analytics | - | ✓ | - | ✓ Implemented |
| i18n | - | ✓ | Partial | ✓ Implemented |
| SEO | - | ✓ | - | ✓ Implemented |
| Comments | - | ✓ | - | ✓ Implemented |
| Webhooks | - | ✓ | - | ✓ Implemented |
| Taxonomy | - | ✓ | - | ⚠ Pending |
| Menus | - | ✓ | - | ⚠ Pending |
| Blocks | - | - | ✓ | ⚠ Pending |
| Views | - | - | ✓ | ⚠ Pending |

---

## Implementation Priorities

### Phase 1: Core Foundation (COMPLETE)
- ✓ Content CRUD
- ✓ Field system (21 types)
- ✓ Content types (archetypes)
- ✓ User authentication
- ✓ RBAC
- ✓ Template system
- ✓ Hook system
- ✓ Module system
- ✓ Service container

### Phase 2: Essential Features (COMPLETE)
- ✓ Search
- ✓ Revisions
- ✓ Workflow
- ✓ Admin UI
- ✓ Media management
- ✓ Cache system
- ✓ CLI tools
- ✓ REST API

### Phase 3: Advanced Features (CURRENT - v0.0.60)
- ✓ Queue & scheduler
- ✓ Backup/restore
- ✓ Analytics
- ✓ GraphQL
- ✓ Feeds (RSS/Atom/JSON)
- ✓ SEO tools (Sitemap, robots.txt, audit)
- ✓ Plugins
- ✓ Webhooks
- ✓ Comments

### Phase 4: Site Building (NEXT)
- ⚠ Taxonomy system
- ⚠ Menu system
- ⚠ Field groups/tabs in UI
- ⚠ Conditional field display
- ⚠ Field validation UI

### Phase 5: Polish & Scale (FUTURE)
- ⚠ Blocks & regions
- ⚠ Views (dynamic lists)
- ⚠ Image processing
- ⚠ Two-factor auth
- ⚠ Static rendering
- ⚠ Database migration

---

## Zero-Dependency Commitment

**Current Status:** Zero runtime dependencies

All features implemented using Node.js built-ins:
- `fs` - File system operations
- `http` - HTTP server
- `path` - Path utilities
- `crypto` - Hashing, tokens, UUIDs
- `url` - URL parsing
- `querystring` - Query parsing
- `stream` - Streaming

**Why Zero Dependencies?**
- Simplicity - No package.json bloat
- Security - No supply chain attacks
- Longevity - No dependency rot
- Control - Full code ownership
- Learning - Understand all code

**Trade-offs Accepted:**
- No external database (flat-file JSON)
- No image manipulation (basic metadata only)
- No advanced markdown/HTML parsing
- Basic template engine (no JSX/Vue/React)
- Manual implementation of common patterns

---

## Version History

| Version | Date | Features Added |
|---------|------|----------------|
| v0.0.60 | 2026-02-03 | XML Sitemap, SEO audit, robots.txt |
| v0.0.59 | 2026-02-03 | RSS/Atom/JSON Feed syndication |
| v0.0.58 | 2026-02-03 | GraphQL API layer |
| v0.0.57 | 2026-02-03 | API versioning & deprecation |
| v0.0.56 | 2026-02-03 | Archetypes (content type builder) |
| v0.0.55 | 2026-02-03 | Activity feed & timeline |
| v0.0.54 | 2026-02-03 | Content comparison & merge |

---

## References

- [Drupal 7 Architecture](https://www.drupal.org/docs/7)
- [Content Management Systems - Key Features](https://en.wikipedia.org/wiki/Content_management_system)
- [Node.js Documentation](https://nodejs.org/docs/)
- [ES Modules Specification](https://tc39.es/ecma262/#sec-modules)

---

**Document Version:** 1.0.0
**Generated:** 2026-02-03
**Next Review:** 2026-03-03
