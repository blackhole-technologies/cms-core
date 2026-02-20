# CMS Core Parity — Session Handoff (2026-02-20)

## What Was Done This Session

Parity score went from **~67% → ~84%** (60 FULL, 13 PARTIAL, 6 NONE).

### Large Features (previous session, continued here)
- **ECA** — `core/eca.js` — Event-Condition-Action no-code automation
- **Webform Builder** — `core/webform.js` — 15 element types, multi-step, CSV export
- **Experience Builder** — `public/js/experience-builder.js` + CSS + admin routes

### Medium Features (this session)
1. **Dark mode + accent colors** — `admin.js:initDarkMode`, `admin.css`, `admin-layout.html` — OS preference detection, color picker, hex→RGB, localStorage
2. **Per-entity metatags** — `admin/index.js` create/update handlers save `metaTitle`, `metaDescription`, `ogImage` to content JSON
3. **A11y checker overlay** — `admin.js:initA11yChecker` — floating toggle, checks images/headings/links/labels/buttons
4. **AI editor assistant** — `admin.js:initAIEditorAssist` + `POST /api/ai/editor-assist` — 6 actions (rewrite/summarize/expand/tone-formal/tone-casual/fix-grammar)
5. **AI auto-fill** — `POST /api/ai/auto-fill` + content-form button — generates title/summary/tags/slug
6. **AI content suggestions** — `POST /api/ai/content-suggestions` — readability/SEO/structure scoring
7. **AI translation** — `POST /api/ai/translate`
8. **AI validation** — `POST /api/ai/validate` — configurable rules
9. **AI API Explorer** — `GET /admin/ai-explorer` — interactive testing UI
10. **Vector/semantic search** — `core/search.js` additions + `GET /api/search/semantic` + auto-indexing hooks in `boot.js`
11. **SVG sanitization** — `core/media.js:saveFile` — strips scripts, event handlers, foreignObject
12. **Infinite scroll** — `admin.js:initInfiniteScroll` — IntersectionObserver on paginated lists
13. **Cookie consent bugfix** — `modules/cookie-consent/index.js` — fixed undefined `c` variable

### Quick Wins (previous session)
- GTM injection, password toggle, server-side autosave, cookie script gating, search exclusion

## What Remains — 19 Items

### NONE (6) — 3 actionable, 3 skip

| # | Module | Action |
|---|--------|--------|
| 38 | ai_assistant_api | **SKIP** — vendor-specific OpenAI Assistants |
| 42 | bpmn_io | **SKIP** — ECA covers functional need |
| 43 | modeler_api | **SKIP** — paired with bpmn_io |
| 64 | checklistapi | **BUILD** — Simple checklist data model in `core/checklist.js`, admin UI |
| 82 | sam | **SKIP** — unknown/niche |
| 83 | drupical | **BUILD** — Calendar view component for date-based content |

### PARTIAL (13) — all actionable

| # | Module | Gap | How to Fix |
|---|--------|-----|-----------|
| 14 | media_library_bulk_upload | No multi-file UI | Add `<input multiple>` + loop in media upload route, progress UI |
| 19 | better_exposed_filters | No enhanced filter widgets | Add checkbox/radio/range filter widgets to views JS |
| 26 | ai_agents (7 plugin types) | Only 2 agents | Add triage routing agent, validation agent, 3+ more plugin types in `core/ai-agents.js` |
| 32 | ai_logging | No full req/response logging | Extend `core/ai-stats.js` to store full request/response payloads |
| 33 | ai_observability | No Prometheus export | Add `GET /metrics` endpoint outputting Prometheus text format |
| 45 | ctools (entity view modes) | No view mode support | Add view mode registry to `core/content.js`, display config per mode |
| 48 | friendlycaptcha | Math CAPTCHA only | **OK as-is** — zero-dep alternative by design |
| 59 | admin_toolbar | No hover dropdowns | Add CSS `:hover` dropdown menus on nav items in `admin.css` |
| 65 | navigation_extra_tools | No extras dropdown | Add tools dropdown (clear cache, run cron, etc.) to toolbar |
| 67 | Mercury theme | Not SDC-native | Enhance `themes/default/` with more components, SDC patterns |
| 73 | easy_email | No attachments | Add attachment support to `core/email.js`, CSS inlining |
| 74 | search_api | No facets | Add faceted search (field-value counts) to `core/search.js` |
| 77 | automatic_updates | No auto-update | Add registry check + auto-download in `core/update.js` |

## Implementation Plan (recommended order)

### Batch 1: Quick wins (~30 min)
1. **Bulk media upload** — `admin/index.js` media route + multi-file input
2. **AI full logging** — extend `ai-stats.js` with request/response storage
3. **Prometheus metrics** — `GET /metrics` in boot.js
4. **Toolbar hover dropdowns** — CSS in `admin.css`
5. **Navigation extras dropdown** — tools menu in `admin-layout.html`
6. **Checklist API** — `core/checklist.js` + admin route

### Batch 2: Medium effort (~1 hr)
7. **Faceted search** — extend `search.js` with field-value aggregation
8. **Email attachments** — extend `email.js` with MIME multipart
9. **Calendar view** — date-based content display component
10. **Entity view modes** — view mode registry in content system
11. **AI agents expansion** — 5+ plugin types, triage routing

### Batch 3: Large effort (optional)
12. **Better exposed filters** — enhanced filter widget JS
13. **Mercury theme SDC** — component library expansion
14. **Auto-updates from registry** — registry polling + download

### Skip (by design)
- bpmn_io, modeler_api, sam, ai_assistant_api — vendor-specific or niche

## Key Files Modified This Session
- `core/boot.js` — vector search init, GTM globals
- `core/search.js` — vector index, semantic search, embedding functions
- `core/media.js` — SVG sanitization
- `core/template.js` — templateGlobals + setGlobals()
- `modules/admin/index.js` — webform routes, XB routes, AI endpoints (editor-assist, auto-fill, content-suggestions, translate, validate, ai-explorer), autosave, metatag save
- `modules/cookie-consent/index.js` — script gating + bugfix
- `public/js/admin.js` — dark mode, password toggle, a11y checker, AI editor toolbar, infinite scroll, server-side autosave
- `public/css/admin.css` — accent color picker styles
- `themes/default/templates/admin-layout.html` — accent picker, theme flash-prevention
- `themes/default/templates/layout.html` — GTM injection + headScripts
- `modules/admin/templates/content-form.html` — AI auto-fill button + script

## Architecture Patterns
- **Zero deps**: All features use vanilla JS, `node:` built-ins only
- **AI endpoints**: All use `ctx.services.get('ai-provider-manager')` with fallback heuristics when no provider configured
- **Storage**: JSON flat-files in `content/`, `config/`
- **Admin routes**: `register('METHOD', '/admin/path', handler)` pattern in `modules/admin/index.js`
- **Boot order**: INIT → DISCOVER → REGISTER → BOOT → READY in `core/boot.js`

## Parity Report
Full report: `PARITY-REPORT-2026-02-20.md` — updated with all changes
