# Handoff: Complete Parity Audit v4

## Mission

Perform a **fresh, exhaustive parity audit** between two codebases — from scratch, no shortcuts, no reliance on previous reports. The user explicitly rejected incremental approaches and wants a deep-dive into EVERY layer of both codebases.

## Codebases

- **Drupal CMS**: `~/Projects/experiments/drupal-cms`
- **CMS Core**: `~/Projects/experiments/cms-core`

## Critical Context

Previous reports (v1-v3 in `PARITY-REPORT-2026-02-*.md`) had significant errors — they marked features as missing that were already fully implemented. The user does NOT trust those reports. **Do not reference them. Start fresh.**

## What the User Wants

A comprehensive analysis covering **every dimension** of both codebases, not just "modules vs modules". The user specifically called out that a prior attempt missed:

- **Themes** (Drupal: Mercury, Gin, byte_theme, easy_email_theme; CMS Core: default, admin, layouts, skins)
- **Libraries/Dependencies** (Drupal: ~79 composer packages; CMS Core: 0 runtime deps + core/lib/ class library)
- **Frontend assets** (CSS, JS, icons, editor bundles)
- **SDC components** (both sides now have 23+ components)
- **Configuration/Recipes** (Drupal: 20 install recipes; CMS Core: config/*.json)
- **Admin UI** (templates, routes, dashboards)
- **API layer** (REST, JSON:API, GraphQL)
- **Core subsystem architecture** (Entity API, Plugin API, Form API, Render API, etc.)

## Audit Plan — All Dimensions

### Phase 1: Drupal CMS Full Inventory
1. **Contrib modules** — Read every `.info.yml` in `web/modules/contrib/`, enumerate ALL sub-modules (AI has 14+, ECA has 21+, Metatag has 19+, Canvas has 5+, Webform has 24+)
2. **Themes** — `web/themes/contrib/` (Mercury, Gin, byte_theme, easy_email_theme). For Mercury: read every SDC component directory. For Gin: understand admin capabilities.
3. **Core modules** — `web/core/modules/` — what Drupal core provides out of the box
4. **Recipes** — `recipes/` — what install recipes exist and what they configure
5. **Composer dependencies** — `composer.json` / `composer.lock` — what PHP packages are pulled in
6. **Configuration** — any `.yml` config files, install profiles

### Phase 2: CMS Core Full Inventory
1. **Core JS files** — Read EVERY file in `core/*.js` (109 files, ~93K lines). Not just filenames — read exports and understand actual capabilities
2. **Lib classes** — `core/lib/` — Entity, Plugin, Form, Render, Config, DI, Access, Hook, Bridge, Twig subsystems (42 files)
3. **Modules** — `modules/` (30 modules) — read each index.js
4. **Admin module** — `modules/admin/index.js` (17K lines) — enumerate ALL routes and capabilities
5. **Admin templates** — `modules/admin/templates/` (131 .html files) — what admin UIs exist
6. **Themes** — `themes/default/`, `themes/admin/`, `themes/layouts/`, `themes/skins/`
7. **SDC components** — `themes/default/components/` (25 components) — read component.json schemas
8. **Frontend assets** — `public/js/` (admin.js, command-palette.js, editor.bundle.js, experience-builder.js, etc.), `public/css/`, `public/icons/`
9. **Configuration** — `config/*.json` (site.json, modules.json, etc.)
10. **API endpoints** — grep for route registrations across all files

### Phase 3: Cross-Reference — Module Parity Matrix
Map every Drupal contrib module + core capability to CMS Core. For each:
- Read the ACTUAL source code on both sides
- Rate as FULL / PARTIAL / NONE / N/A with EVIDENCE (file paths, function names, line numbers)
- Note what specific sub-features are present or missing

### Phase 4: Cross-Reference — Theme Parity
- Mercury (23 SDC) vs CMS Core default theme (25 SDC) — component-by-component comparison
- Gin vs CMS Core admin theme — feature-by-feature (dark mode, accent colors, sidebar, toolbar)
- CVA support on both sides

### Phase 5: Cross-Reference — Architecture Parity
- Drupal core subsystems vs CMS Core lib classes (Entity, Plugin, Form, Render, Config, DI, Access, Hook, Twig)
- Database layer (MariaDB vs flat-file JSON + database.js abstraction)
- Caching (Drupal cache bins vs CMS Core cache.js + cache-backend.js)
- Routing (Symfony router vs CMS Core router.js)
- Template engine (Twig vs custom mustache-like)

### Phase 6: Cross-Reference — API Parity
- REST endpoints on both sides
- JSON:API support
- GraphQL support
- Authentication/session handling

### Phase 7: Cross-Reference — Frontend Parity
- Editor (CKEditor 5 vs editor.js + editor.bundle.js)
- Admin JS capabilities (command palette, shortcuts, experience builder, media modal, field widgets)
- CSS architecture (Tailwind/Gin vs vanilla CSS)

### Phase 8: Unique Features
- Features in CMS Core with NO Drupal equivalent
- Features in Drupal with NO CMS Core equivalent
- Architectural differences that aren't module-specific

### Phase 9: Write Report
- Executive summary with scores
- Full parity matrix with evidence
- Gap analysis with effort estimates
- Change log noting this is v4, a from-scratch audit

## Execution Strategy

- Launch parallel agents for Phases 1 and 2 (they're independent)
- Do Phases 3-8 yourself after agents return (cross-referencing requires holding both inventories in context)
- Use `sonnet` or `haiku` agents for the inventory phases to save time
- For CMS Core: actually READ the key files, don't just list filenames
- For Drupal: read `.info.yml` + key PHP files to understand actual capabilities

## Output

Write the final report to: `~/Projects/experiments/cms-core/PARITY-REPORT-2026-02-21.md` (overwrite the existing one)

## User Preferences

- The user cares about accuracy over speed
- The user wants EVIDENCE for every rating (file paths, function names)
- The user does NOT want shortcuts or assumptions
- The user wants ALL dimensions covered, not just "modules"
- Previous reports had errors — verify everything by reading source code
