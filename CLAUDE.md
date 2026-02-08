# CMS-Core — Architecture Guide

## Project Structure

CMS-Core has two main code locations:

- **`core/`** — Foundational services (boot, auth, database, content, fields, cache, etc.). ~90 files. Modify these when fixing bugs or extending existing core behaviour.
- **`modules/`** — Self-contained feature packages. New features typically go here unless they extend an existing core service.

### Creating a New Module

Every module lives in `modules/<module-name>/` and requires TWO files minimum:

```
modules/<module-name>/
  manifest.json    ← module metadata, dependencies, version
  index.js         ← module code with hook exports
```

#### manifest.json
```json
{
  "name": "<module-name>",
  "version": "1.0.0",
  "description": "What this module does",
  "dependencies": []
}
```

#### index.js — Hook Pattern
Modules export hook functions. Available hooks:

```javascript
// Called during boot — register services, config, CLI commands
export function hook_boot(ctx) {
  // ctx.services — service registry
  // ctx.config — site configuration
  // ctx.db — database helpers
}

// Called when routes are being set up — register HTTP endpoints
export function hook_routes(ctx) {
  const { router } = ctx;
  router.get('/api/<module>/items', async (req, res) => { ... });
  router.post('/api/<module>/items', async (req, res) => { ... });
  // Admin pages:
  router.get('/admin/<module>', async (req, res) => { ... });
}

// Called on content events — react to content changes
export function hook_content(ctx) { }

// Called on cron runs — periodic tasks
export function hook_cron(ctx) { }

// Called during install — create database tables, seed data
export function hook_install(ctx) { }
```

### Enabling a Module

After creating the module, add its name to `config/modules.json`:
```json
["admin", "users", "media", "tasks", "hello", "conscious", "curate", "webhooks", "test", "YOUR_NEW_MODULE"]
```

## Project Structure

```
cms-core/
├── index.js           # Entry point — starts HTTP server (NO arguments needed)
├── config/
│   ├── site.json      # Site name, port (3001), settings
│   └── modules.json   # List of enabled module names
├── core/              # ❌ DO NOT ADD FILES HERE — foundational services only
│   ├── boot.js        # Module loader, service registry
│   ├── static.js      # Static file serving
│   ├── theme-engine.js# Theme rendering
│   ├── database.js    # SQLite helpers
│   ├── auth.js        # Authentication
│   ├── content.js     # Content CRUD
│   ├── fields.js      # Field type system
│   └── ...            # ~90 other core services
├── modules/           # ✅ ALL NEW CODE GOES HERE
│   ├── admin/         # Admin panel
│   ├── users/         # User management
│   ├── media/         # Media library
│   ├── conscious/     # AI consciousness engine
│   ├── curate/        # Content curation
│   ├── tasks/         # Task management
│   └── <your-module>/ # YOUR NEW MODULE
├── content/           # JSON content storage
├── themes/            # Theme layouts and skins
├── public/            # Static assets
└── logs/
```

## Running the Server

```bash
node index.js          # Starts on port 3001
```

Verify: `curl http://localhost:3001/` should return JSON with site info.

## Database

CMS-Core uses SQLite via `core/database.js`. Content is stored as JSON files in `content/`.
Modules can create their own SQLite tables via `hook_install`.

## When to Use What

| You're building... | Put it in... |
|---|---|
| A new self-contained feature (trash, scheduler, SEO, AI) | `modules/<name>/` with manifest.json |
| A fix or extension to an existing core service | `core/<existing-file>.js` |
| A new foundational service used by many modules | `core/<new-service>.js` (rare — check with project context first) |
| New content types or config | `content/` or `config/` |

**When in doubt, check the phase context or project context for specific guidance.**

## Key Conventions

1. **New modules need `manifest.json`** and must be added to `config/modules.json`
2. **Use hook pattern** in modules — `hook_boot`, `hook_routes`, `hook_content`, `hook_cron`, `hook_install`
3. **Test on port 3001** — `curl` or browser automation
4. **Commit after each feature** — descriptive message with feature ID
5. **Zero npm dependencies** — Node.js built-ins only
