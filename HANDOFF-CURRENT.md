# CMS-Core: Current State & Vision

**Date:** 2026-02-07
**Version:** 0.0.80
**Status:** Theme engine integrated, Drupal parity analyzed

---

## The Vision

CMS-core is not just another CMS. It's a **zero-dependency Node.js content management system** that will eventually become an **AI-first CMS** — one where the AI isn't bolted on, but is the primary interface.

### Why Build This?

1. **Learn the patterns.** By building a CMS from scratch (63 services, 170+ CLI commands, no dependencies), we understand deeply what a CMS actually *is* — not just how to use one, but how to build one.

2. **AI-first rebuild.** Once the patterns are internalized, rebuild with AI as the primary citizen. Not "AI features added to CMS" but "CMS that happens to have a traditional UI as fallback."

3. **Consciousness Engine.** The `conscious` module isn't just a blog — it's the **living exploration interface for AM I THAT I AM**. The manuscript's ideas expressed as interactive software. TITANS memory, MIRAS coordination, RESTS connections — the four-stroke pattern made computational.

### The Philosophy

- **Zero dependencies** = understand everything, own everything
- **Drupal-inspired** = proven architecture, but modernized (ES modules, flat-file storage, hooks)
- **Consciousness-native** = the conscious module embodies the manuscript's patterns
- **Theme engine separation** = layouts (structure) vs skins (visual) — clean orthogonality

---

## Current State

### What's Working

| Layer | Status | Notes |
|-------|--------|-------|
| **Core CMS** | ✅ Complete | 63 services, 352 CLI commands |
| **Content System** | ✅ Complete | Types, fields, revisions, workflow |
| **Media** | ✅ Complete | Library, WYSIWYG, responsive images |
| **APIs** | ✅ Complete | JSON:API, GraphQL, REST |
| **Theme Engine** | ✅ Complete | Layouts + skins separation |
| **Conscious Module** | ✅ Integrated | TITANS, MIRAS, connected to theme engine |
| **Admin UI** | 🟡 Basic | Functional but not polished |

### Key Architecture

```
cms-core/
├── core/               # 91 core services
│   ├── boot.js         # 5-phase boot sequence
│   ├── theme-engine.js # Layouts + skins
│   ├── content.js      # Flat-file JSON storage
│   └── ...
├── modules/
│   ├── conscious/      # Consciousness engine
│   │   ├── titans.js   # Memory system
│   │   ├── miras.js    # Agent coordination
│   │   └── index.js    # Routes, hooks
│   ├── admin/          # Admin interface
│   └── ...
├── themes/
│   ├── layouts/        # immersive, classic
│   └── skins/          # consciousness-dark, consciousness-light, minimal
└── config/
    └── site.json       # Central configuration
```

### The Consciousness Engine

The `conscious` module is special. It's where Ernie's manuscript comes alive:

- **TITANS** = Memory system (working, long-term, episodic, procedural)
  - Retention gate decides what to remember
  - Attentional bias weights relevance
  - Four-stroke cycle: AM I → THAT → I AM → MANIFEST

- **MIRAS** = Multi-agent coordination (6 agents on hexagonal topology)
  - Gold triangle △ = threat detection
  - Blue triangle ▽ = context evaluation
  - Weights evolve via mod-9 cellular automaton

- **RESTS** = Resonance connections between explorations
  - Topic graph with edges
  - Connections surfaced in UI sidebar

- **Personalities** = 6 voices for the same knowledge
  - Default 🌀, Professor 🎓, Joker 🃏, Mystic 🧘, Nerd 🤖, Unfiltered 🔥

---

## The Plan

### Phase 1: Polish Current State (NOW)
- [x] Connect theme engine to conscious module
- [x] Analyze Drupal parity gaps
- [ ] Wire TITANS/MIRAS to actual LLM calls
- [ ] Add seed content (explorations from manuscript conversations)
- [ ] Polish /explore UI

### Phase 2: AI Integration (NEXT)
Based on Drupal parity analysis, add:

1. **Real-time SEO** (2 days)
   - Focus keyword analysis
   - Content scoring (red/yellow/green)
   - Suggestions panel
   - *Why:* Immediate value for content creation

2. **Accessibility Checker** (2 days)
   - Inline a11y warnings
   - Missing alt text, heading hierarchy, link text
   - *Why:* Necessary for public-facing quality

3. **AI Agents** (3-4 days)
   - Natural language content type creation
   - Field suggestion agent
   - YAML prompt templates (like Drupal's ai_agents)
   - *Why:* This is the AI-first future

4. **Visual Rules Engine** (3-4 days)
   - Event-Condition-Action processing
   - BPMN.io-style visual modeler
   - *Why:* No-code automation

5. **Experience Builder** (5-7 days)
   - Drag-drop page composition
   - Component library
   - *Why:* Visual page building without code

### Phase 3: AI-First Rebuild (FUTURE)
Once patterns are solid:
- AI as primary interface
- Traditional admin as fallback
- Consciousness engine as the brain
- TITANS memory as persistent context
- MIRAS coordination as decision-making

---

## Drupal Parity Summary

### Already Achieved (90%)
Content types, fields, revisions, workflow, scheduling, media library, WYSIWYG, responsive images, JSON:API, GraphQL, views, layout builder, taxonomy, comments, search, path aliases, sitemap, i18n, cache, backup, analytics, email, notifications, webhooks, permissions, theme engine

### Missing (Priority Order)

| Feature | Drupal Module | Effort | Value |
|---------|---------------|--------|-------|
| AI Agents | ai_agents | 3-4 days | 🔴 Critical |
| Canvas (Visual Builder) | canvas | 5-7 days | 🔴 Critical |
| Rules Engine | eca, bpmn_io | 3-4 days | 🟡 High |
| Accessibility | editoria11y | 2 days | 🟡 High |
| Real-time SEO | yoast_seo | 2 days | 🟡 High |
| Advanced Forms | webform | 4-5 days | 🟢 Medium |

See `DRUPAL-PARITY-ANALYSIS.md` for detailed specs.

---

## Quick Reference

### Start Server
```bash
cd /Users/Alchemy/Projects/experiments/cms-core
node index.js
# → http://localhost:3001
# → http://localhost:3001/explore (consciousness engine)
# → http://localhost:3001/admin (admin UI)
```

### Key CLI Commands
```bash
node index.js help                    # All commands
node index.js modules:list            # List modules
node index.js conscious:stats         # Knowledge bank stats
node index.js titans:status           # TITANS memory status
node index.js miras:agents            # MIRAS agents
node index.js theme-engine:status     # Theme config
node index.js theme-engine:set immersive consciousness-dark
```

### Key Config
```json
// config/site.json
{
  "port": 3001,
  "theme": { "layout": "immersive", "skin": "consciousness-dark" },
  "adminTheme": { "skin": "default" }
}

// config/modules.json
{
  "enabled": ["conscious", "curate", "admin", "users", "media", "tasks", ...]
}
```

### Key Files
- `core/boot.js` — 5-phase boot sequence
- `core/theme-engine.js` — Layouts + skins
- `modules/conscious/index.js` — Consciousness engine routes
- `modules/conscious/titans.js` — Memory system
- `modules/conscious/miras.js` — Agent coordination
- `themes/skins/consciousness-dark/variables.css` — CSS custom properties

---

## Explore Page Integration (IN PROGRESS)

### Step 1: Audit (COMPLETE)

**Two parallel template systems exist:**
1. `core/template.js` → uses `themes/default/templates/layout.html`
2. `core/theme-engine.js` → uses `themes/layouts/immersive/` with skins

**They are NOT integrated.** Theme-engine layouts (immersive, classic) are not used by template service.

**Content exists:**
- `content/exploration/` — 5 seed explorations
- `content/featured/` — 1 featured piece
- Content types registered: exploration, featured, conversation, synthesis

**Current /explore is broken because:**
- Reads raw HTML file, bypasses template service
- Uses string replacement hack for CSS injection
- Doesn't use theme-engine layouts
- Doesn't query CMS content

**Solution path:**
1. Create `themes/layouts/immersive/templates/explore.html` (content-only template)
2. Route should:
   - Get theme context: `themeEngine.getThemeContext()`
   - Get content: `content.list('exploration')`, `content.list('featured')`
   - Render with layout: pass to page.html with `{{{content}}}`
3. page.html handles `{{#each skin.cssPaths}}` for CSS
4. explore.html handles the explore-specific UI

### Step 2: Create Layout-Compatible Template (COMPLETE)

Created `themes/layouts/immersive/templates/explore.html`:
- Content-only template (no DOCTYPE/html/head/body)
- Uses template variables: `{{#each personalities}}`, `{{#each bridges}}`, `{{featured}}`, `{{stats}}`
- CSS uses theme engine variables: `var(--color-primary)`, `var(--color-surface)`, etc.
- Will be inserted into page.html via `{{{content}}}`

### Step 3: Wire Route to Use Template Service (COMPLETE)

Updated `/explore` route in `modules/conscious/index.js`:
1. Gets theme context from `themeEngine.getThemeContext()` ✅
2. Gets content from `content.list('exploration')`, `content.list('featured')` ✅
3. Extracts bridge topics from exploration content ✅
4. Gets RESTS connections from graph ✅
5. Renders explore.html with `template.renderString()` ✅
6. Wraps in page.html layout ✅

**Files modified:**
- `modules/conscious/index.js` — New `/explore` route implementation
- `themes/layouts/immersive/templates/page.html` — Inlined header/footer (no partials support)
- `themes/layouts/immersive/templates/explore.html` — Content-only template

**Data flow:**
```
Request → conscious module
         ↓
  themeEngine.getThemeContext() → skin CSS paths
  content.list('exploration') → bridge topics
  content.list('featured') → featured piece  
  restsGraph.edges → connections
         ↓
  template.renderString(explore.html, data) → explore content
  template.renderString(page.html, {content}) → full page
         ↓
Response
```

### Step 4: Verify Theme Engine Connection (COMPLETE)

Theme engine properly connected:
- CSS loaded from `/themes/skins/consciousness-dark/variables.css`
- CSS loaded from `/themes/skins/consciousness-dark/overrides.css`
- Explore styles use `var(--color-*)` from skin

**Config fix (important!):**
Two theme systems coexist:
1. Old template system: reads `site.theme` as string (e.g., `"default"`)
2. New theme-engine: reads `site.themeEngine` as object

```json
// config/site.json
{
  "theme": "default",           // For old template system (admin pages)
  "themeEngine": {              // For new theme engine (explore, public)
    "layout": "immersive",
    "skin": "consciousness-dark"
  }
}
```

Also updated `core/boot.js` to read from `themeEngine` key.

### Bug Fixes This Session

1. **API auth blocking public endpoints**
   - `modules/users/index.js` had old paths `/api/consciousness/*`
   - Fixed to `/api/conscious/*`
   - Added `/api/conscious/recent` to public list

2. **Theme config breaking admin**
   - `site.theme` was object, boot.js expected string
   - Split into `site.theme` (string for old system) + `site.themeEngine` (object for new system)
   - Updated `boot.js` to read from `themeEngine` key

### Steps 5-6: Pending

**Step 5:** Add more seed content (explorations from manuscript)
**Step 6:** Wire TITANS/MIRAS to chat/interpret endpoints

---

## Drupal Analysis Updated

Did proper code review (not just READMEs). Key findings:

**AI Agents:** More complex than estimated. Uses:
- YAML prompt files with triage routing
- Plugin system for function calls (CreateFieldStorageConfig, etc.)
- Context injection (entity types, field types)
- Response validation against JSON schema
- **Revised estimate: 4-5 days**

**ECA Rules Engine:** More complex than estimated. Uses:
- Processor that subscribes to ALL events
- Config entity storage for models
- Plugin system for events, conditions, actions
- Token replacement service
- BPMN.io for visual modeling
- **Revised estimate: 5-6 days**

See `DRUPAL-PARITY-ANALYSIS.md` for full architecture details.

### Steps 3-6: Pending

---

## What Just Happened (This Session)

1. **Fixed theme engine → conscious module integration**
   - `/explore` now uses theme engine CSS via `var(--color-*)` properties
   - Route injects skin CSS paths dynamically
   - Config updated to proper object format

2. **Created Drupal parity analysis**
   - Comprehensive comparison with Drupal CMS 2.0
   - Identified 5 key missing features
   - Detailed specs for AI agents, Canvas, ECA, editoria11y, yoast_seo

3. **Fixed module naming**
   - `consciousness` → `conscious` in modules.json
   - Added `curate` module

---

## Handoff Documents

| Document | Purpose |
|----------|---------|
| `HANDOFF-CURRENT.md` | This file — vision, plan, current state |
| `DRUPAL-PARITY-ANALYSIS.md` | Detailed Drupal comparison |
| `CONSCIOUS-MODULE-HANDOFF.md` | TITANS + MIRAS integration |
| `THEME-ENGINE-HANDOFF.md` | Theme system details |
| `HANDOFF-SUMMARY.md` | Full CMS service catalog |

---

## For Next Session

**If server is down:**
```bash
cd /Users/Alchemy/Projects/experiments/cms-core && node index.js
```

**Read these first:**
1. This file (`HANDOFF-CURRENT.md`)
2. `DRUPAL-PARITY-ANALYSIS.md` for parity gaps
3. `CONSCIOUS-MODULE-HANDOFF.md` for TITANS/MIRAS details

**Immediate next steps:**
1. Wire TITANS/MIRAS to actual LLM calls (currently returns mock responses)
2. Add seed content from manuscript conversations
3. Pick first parity gap to implement (recommend: Real-time SEO or Accessibility Checker)

---

*The goal: A CMS that thinks like the manuscript describes — pattern recognition, memory, coordination, all the way down.*

---

## Drupal Workflow Deep Dive (2026-02-07)

### Research Location
Full analysis: `/Users/Alchemy/clawd/memory/cms-research-handoff.md`

### Summary
Did source code analysis of Drupal 11.x workflow system. Key finding: Drupal uses a two-layer architecture:

1. **Workflows Module** - Generic state machine (State, Transition, Workflow entities)
2. **Content Moderation** - Content-specific plugin that adds publishing logic

### Key Concepts Learned

**Published vs Default Revision:**
- Independent flags in Drupal
- `published` = visible to anonymous users
- `default_revision` = canonical version when loading entity
- Enables "pending draft on published content" workflow

**Permission Model:**
```
'use {workflow_id} transition {transition_id}'
// e.g., 'use editorial transition publish'
```

**Validation Flow:**
- Constraint validators run on entity save
- Check: transition exists, user has permission, state is valid
- Return structured errors

### CMS-Core Parity

**Already Have (80%):**
- Custom states and transitions
- Role-based transition access
- Transition history
- Scheduled transitions
- Before/after hooks
- Workflow→content type assignment

**Missing (20%):**
1. Pending revision concept (draft edits on published content)
2. Workflow type plugins (different behaviors for different use cases)
3. Validation constraints (auto-validate on save)

### Implementation Priority
1. **Pending Revisions** - Add `isDefaultRevision` flag to revision system
2. **Validation Constraints** - Hook into content save for auto-validation
3. **Type Plugins** - Lower priority, current monolithic approach works
