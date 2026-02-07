# CMS-Core — Claude Code Project Harness

## Identity

**Project:** CMS-Core  
**Version:** 0.0.80  
**Philosophy:** Zero-dependency Node.js CMS with Drupal-inspired architecture  
**Vision:** AI-first CMS where AI is the primary interface

---

## Quick Start

```bash
cd /Users/Alchemy/Projects/experiments/cms-core
node index.js                    # Start server → http://localhost:3001
node index.js help               # List 352 CLI commands
node index.js modules:list       # Show enabled modules
```

---

## Agent System

This project uses specialized agents for different tasks. See `.claude/agents/`:

| Agent | Purpose | Model |
|-------|---------|-------|
| **coder** | Feature implementation, service creation | Sonnet |
| **deep-dive** | Architecture analysis, Drupal research | Opus |
| **reviewer** | Code review, pattern validation | Sonnet |

### Agent Selection

```
Implementing features?  → coder agent
Researching patterns?   → deep-dive agent  
Reviewing changes?      → reviewer agent
```

---

## Project Structure

```
cms-core/
├── index.js              # Entry point (server/CLI)
├── CLAUDE.md             # This file
├── HANDOFF-CURRENT.md    # Current state documentation
│
├── core/                 # 91 core services (~76k lines)
│   ├── boot.js           # 5-phase boot sequence
│   ├── content.js        # Content CRUD, revisions
│   ├── fields.js         # Field system (21 types)
│   ├── workflow-advanced.js # State machine
│   └── ...
│
├── modules/              # Feature modules
│   ├── conscious/        # Consciousness engine (TITANS, MIRAS)
│   ├── admin/            # Admin UI
│   └── ...
│
├── config/               # JSON configuration
│   ├── site.json         # Site settings
│   ├── content-types.json
│   ├── workflows.json
│   └── ...
│
├── content/              # Flat-file content storage
├── themes/               # Theme engine (layouts + skins)
│
└── .claude/              # Claude Code configuration
    ├── agents/           # Agent personas
    ├── templates/        # Prompt templates
    ├── skills/           # Reusable skills
    └── commands/         # Slash commands
```

---

## Core Principles

### 1. Zero Dependencies

**No npm packages.** Everything built from Node.js built-ins:
- `node:http` — HTTP server
- `node:fs` — File system
- `node:path` — Path utilities  
- `node:crypto` — Cryptography

Never suggest installing packages. Build it yourself.

### 2. Service Pattern

Every core service follows this pattern:

```javascript
export const name = 'serviceName';

export function init(context) {
  const state = {};
  
  // Register CLI commands
  context.cli.register('service:command', async (args) => {
    // Implementation
    return true;
  });
  
  return state;
}

export function register(context, state) {
  // Register hooks
  context.hooks.on('event:name', async (data) => {
    // Handler
  });
}
```

### 3. Drupal-Inspired Architecture

Study Drupal patterns and adapt for JavaScript:

| Drupal | CMS-Core |
|--------|----------|
| ContentEntityType | Content type (config JSON) |
| Plugin system | Service pattern |
| Hook system | Event emitters (context.hooks) |
| ConfigEntityType | JSON config files |
| Services (DI) | context.serviceName |

**Drupal Reference:**
```
/Users/Alchemy/Projects/experiments/drupal-cms/web/core/modules/
```

### 4. Flat-File Storage

All data stored as JSON files:
```
content/{type}/{id}.json           # Content items
content/{type}/{id}/revisions/     # Revision history
config/{config}.json               # Configuration
```

---

## Key APIs

### Content
```javascript
context.content.create('article', { title: 'Hello', body: {...} });
context.content.get('article', 'my-post');
context.content.update('article', 'my-post', { title: 'Updated' });
context.content.delete('article', 'my-post');
context.content.list('article', { status: 'published', limit: 10 });
```

### Hooks
```javascript
context.hooks.on('content:afterCreate', async (content) => { });
context.hooks.emit('custom:event', data);
```

### CLI
```javascript
context.cli.register('command:name', async (args) => {
  console.log('Output');
  return true;
});
```

### Workflow
```javascript
context.workflow.getState('article', 'my-post');
context.workflow.transition('article', 'my-post', 'publish', userId);
context.workflow.canTransition('article', 'my-post', 'publish', userId);
```

---

## Drupal Parity Status

### Implemented (~90%)
✅ Content types + fields  
✅ Revisions  
✅ Workflow states + transitions  
✅ Media library  
✅ JSON:API + GraphQL  
✅ Theme engine  
✅ Views (basic)  
✅ Taxonomy  
✅ Comments  
✅ Search  

### Priority Gaps
| Feature | Drupal Module | Effort | Notes |
|---------|---------------|--------|-------|
| **Pending Revisions** | content_moderation | 2 days | Decouple published/default_revision |
| **Workspaces** | workspaces | 5-6 days | Staging environments |
| **Views UI** | views_ui | 4-5 days | Visual query builder |
| **Layout Builder UI** | layout_builder | 5-7 days | Drag-drop composition |

---

## The Conscious Module

Special module implementing consciousness patterns:

### TITANS (Memory System)
- Working Memory — Current context
- Long-term Memory — Persistent patterns
- Episodic Memory — Event sequences
- Procedural Memory — How-to knowledge

### MIRAS (Agent Coordination)
- 6 agents on hexagonal topology
- Gold triangle △ = threat detection
- Blue triangle ▽ = context evaluation

### RESTS (Resonance Connections)
- Topic graph connecting explorations
- Edges represent conceptual relationships

---

## Development Workflow

### 1. Before Coding
```bash
# Read current state
cat HANDOFF-CURRENT.md

# Check Drupal equivalent (if applicable)
ls /Users/Alchemy/Projects/experiments/drupal-cms/web/core/modules/{module}/
```

### 2. Implementation
- Follow service pattern
- Add WHY comments for complex logic
- Use async/await (not callbacks)
- Handle errors explicitly

### 3. Testing
```bash
# Test CLI
node index.js yourservice:command

# Test routes
curl http://localhost:3001/api/your-endpoint
```

### 4. Documentation
- Update HANDOFF-CURRENT.md for significant changes
- Add WHY comments in code

---

## CLI Command Categories

```bash
# Content
node index.js content:list --type=article
node index.js content:create article '{"title":"Test"}'

# Workflow
node index.js workflows:list
node index.js workflows:transition article my-post publish

# Modules
node index.js modules:list
node index.js conscious:stats

# Theme
node index.js theme-engine:status
node index.js theme-engine:set immersive consciousness-dark

# Media
node index.js media:library
node index.js styles:list
```

---

## Handoff Documents

| Document | Purpose |
|----------|---------|
| `CLAUDE.md` | This file — project harness |
| `HANDOFF-CURRENT.md` | Current state, recent changes |
| `DRUPAL-PARITY-ANALYSIS.md` | Feature comparison |
| `CONSCIOUS-MODULE-HANDOFF.md` | TITANS + MIRAS details |
| `docs/` | Feature documentation |

---

## Drupal Research

For pattern research, see:
- **Local installation:** `/Users/Alchemy/Projects/experiments/drupal-cms/web/core/modules/`
- **Analysis docs:** `/Users/Alchemy/clawd/memory/drupal-*.md`
- **Skill:** `.claude/skills/drupal-research/SKILL.md`

### Key Modules to Study
| For Feature | Study Module |
|-------------|--------------|
| Pending revisions | content_moderation |
| Workspaces | workspaces |
| Visual layouts | layout_builder |
| Query builder | views, views_ui |

---

## Remember

**This is an AI-first CMS in development.**

The goal isn't to clone Drupal — it's to understand Drupal's patterns deeply, then build something where AI is the primary interface.

The conscious module (`modules/conscious/`) is where the manuscript's ideas become software:
- TITANS = memory patterns (AM I → THAT → I AM → MANIFEST)
- MIRAS = coordination patterns (hexagonal topology)
- RESTS = resonance patterns (topic connections)

Build with that vision in mind.
