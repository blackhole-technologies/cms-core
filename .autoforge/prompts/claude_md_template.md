# CMS-Core Architecture

## Overview
Zero-dependency Node.js CMS inspired by Drupal. v0.0.80, 106 core services, 29 modules.

## 8 Meta-Patterns
1. **Plugin** — plugin managers + plugin bases
2. **Entity** — content entities (nodes, users) + config entities (settings, types)
3. **Config** — JSON configuration with schema validation
4. **Hook** — event system (hook_boot, hook_routes, hook_content, hook_cron, hook_install)
5. **Render** — render arrays, template resolution, output pipeline
6. **DI** — service container with dependency injection
7. **Access** — AccessResult (allowed/neutral/forbidden)
8. **Form** — form API with validation, submission, AJAX

## Directory Structure
- `core/lib/` — Foundation patterns ONLY
- `modules/<name>/` — ALL features, content types, field types, UI
- `core/components/` — Standalone utilities
- `config/` — JSON configuration
- `themes/` — Theme engine
- `.autoforge/templates/` — Pattern templates for new code
- `.autoforge/specs/` — Stage specs (stage1-8)

## Module Conventions
- `modules/<name>/manifest.json` — metadata
- `modules/<name>/index.js` — hook exports
- Register in `config/modules.json`

## Templates (in .autoforge/templates/)
Use these, don't invent new patterns:
- `plugin-manager.js` / `plugin-base.js`
- `content-entity.js` / `config-entity.js`
- `service-provider.js`
- `hook-implementation.js`
- `form-base.js`
- `access-result.js`
- `render-element.js`
- `entity-storage.js`

## File Hygiene
No files at project root. Output goes to:
- Progress → `.autoforge/progress.txt`
- Tests → `tests/unit/`, `tests/integration/`, `tests/browser/`
- Source → `core/`, `modules/`, `config/`, `content/`, `themes/`, `public/`

## Quick Start
```bash
node index.js  # http://localhost:3001
```
