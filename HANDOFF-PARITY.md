# Drupal CMS ↔ CMS Core Parity — Handoff

## Context

A thorough parity analysis was done comparing `experiments/drupal-cms` (Drupal 11 with ~79 contrib modules, DDEV, MariaDB 11.8, PHP 8.4) against `experiments/cms-core` (zero-dep Node.js CMS with JSON flat-file storage, 107 core files). The goal: close every feature gap to bring CMS Core to full parity with Drupal CMS, **excluding** the Perspective Engine custom modules (`perspective_kb`, `perspective_ai`).

A deep filesystem audit was performed on 2026-02-19 to verify every claim. Several items originally flagged as gaps were found to already be implemented.

## Parity Status

### Already Implemented (verified against filesystem)

| Feature | Location | Verification |
|---------|----------|--------------|
| Template auto-escaping | `core/template.js` line 596 | `{{var}}` calls `escapeHtml()`, `{{{var}}}` is raw. NOTE: stale comment at line 56 says "does NOT auto-escape" — the comment is wrong, the code is correct. |
| Session persistence | `core/auth.js` line 86+ | File-backed in `content/.sessions/active.json`. Debounced writes, loads on boot. Survives server restart. |
| Command palette (Coffee) | `public/js/command-palette.js` | Ctrl+K with fuzzy search, keyboard navigation |
| SMTP email delivery | `core/email.js` lines 317+ | Full SMTP via raw `node:net` sockets — EHLO, AUTH PLAIN/LOGIN, STARTTLS. Three transports: console, smtp, sendmail |
| Email templates | `core/email.js` | Template loading from `templates/email/`, subject extraction |
| Accessibility checker | `core/accessibility.js` (38KB) | WCAG 2.1 inspired: alt text, heading hierarchy, link text, empty elements, ARIA checks |
| Autosave forms | `public/js/admin.js` line 396 | localStorage-based autosave on `data-autosave` forms |
| SEO analysis (Yoast-style) | `core/seo.js` (47KB) | Flesch-Kincaid readability, keyword density, title/meta length, heading structure, content analysis, scoring |
| AI chatbot (admin) | `admin-layout.html` line 220 + `modules/admin/index.js` line 14542 | Floating FAB + expandable chat panel, `POST /admin/api/ai/chat`, conversation with AI provider |
| Breadcrumbs | `core/menu.js` line 703 `getBreadcrumbs()` + `core/theme-system.js` | Menu-driven breadcrumb generation, exposed to templates |
| Honeypot (contact forms) | `core/contact.js` line 66 | Randomized honeypot field name per-boot, validation at line 807. Contact-form-specific only. |

### Remaining: 6 Features to Implement

---

### 1. Login by Email (Small — ~15 lines changed)

**What Drupal has:** `login_emailusername` module — users can log in with email or username.

**What CMS Core has:** Username-only login. The handler is at `modules/users/index.js` line 751. Field `username` is parsed from POST body (line 754). User lookup is `users.find(u => u.username === username)` at line 763. Email is an optional profile field (line 231: `email: { type: 'string', required: false }`).

**What to change:**

1. In `modules/users/index.js` line 761-763, add email-based lookup:
```js
// Find user by username or email
const users = content.list('user').items;
const identifier = username; // form field is still named "username"
let user = null;
if (identifier.includes('@')) {
  user = users.find(u => u.email === identifier);
}
if (!user) {
  user = users.find(u => u.username === identifier);
}
```

2. In `modules/users/templates/login.html` line 16, change label from "Username" to "Username or email":
```html
<label for="username">Username or email</label>
```

3. In `modules/users/templates/login.html` line 22, update placeholder:
```html
placeholder="Enter username or email"
```

---

### 2. General-Purpose Honeypot (Small — new file ~80 lines)

**What Drupal has:** `honeypot` module — hidden field + minimum time check on ALL forms.

**What CMS Core has:** Contact-form-specific honeypot in `core/contact.js` line 66. Not available for other forms.

**What to do:** Create `core/honeypot.js` as a general-purpose anti-spam module:
- `generateFields()` — returns HTML for a hidden `<input name="website" style="display:none">` + a hidden timestamp field (HMAC-signed, same pattern as CSRF in `core/csrf.js`)
- `validate(formData)` — rejects if honeypot field is filled OR form submitted in < 3 seconds
- Hook into form rendering to inject fields, hook into form processing to validate
- Config in `site.json` under `honeypot: { enabled: true, minTime: 3 }`
- Register in `core/boot.js` imports (line ~105) and REGISTER phase
- Apply to: all public-facing forms (content, comments, user registration)

---

### 3. Math CAPTCHA (Medium — new file ~120 lines)

**What Drupal has:** `captcha` + `friendlycaptcha` modules.

**What to do:** Create `core/captcha.js`:
- `generate()` — math problem (e.g., "What is 7 + 4?"), answer stored in HMAC-signed token (pattern from `core/csrf.js`)
- `renderField()` — returns HTML: question text + input + hidden token
- `validate(answer, token)` — verifies answer matches token
- Config in `site.json` under `captcha: { enabled: true, difficulty: 'simple' }`
- Difficulty levels: `simple` (addition only, operands 1-10), `medium` (add/subtract, 1-20), `hard` (multiply, 1-12)
- Apply to: contact forms, any anonymous form
- Register in `core/boot.js`

---

### 4. Privacy Policy Auto-Page (Small — ~40 lines)

**What Drupal has:** `drupal_cms_privacy_basic` recipe auto-creates a privacy policy page.

**What to do:** In `core/boot.js` READY phase, check if a content item of type `page` with slug `privacy-policy` exists. If not, auto-create one with starter text. Add "Privacy Policy" link to footer menu.

**Starter content:**
```json
{
  "title": "Privacy Policy",
  "slug": "privacy-policy",
  "body": "<h2>Privacy Policy</h2><p>This privacy policy describes how we collect, use, and protect your personal information...</p><h3>Information We Collect</h3><p>[Describe what you collect]</p><h3>How We Use Information</h3><p>[Describe usage]</p><h3>Contact</h3><p>[Contact details]</p>",
  "status": "published"
}
```

**Config:** `site.json` → `privacy: { autoCreate: true }`

---

### 5. Single Directory Components — SDC (Large — new file ~200 lines)

**What Drupal has:** SDC system in Mercury theme — self-contained components in `themes/<theme>/components/<name>/` with `component.yml`, template, and CSS.

**What CMS Core has:** No `core/sdc.js`, no `components/` directories in themes. Themes have `themes/default/`, `themes/admin/`, `themes/layouts/`, `themes/skins/` but no component system.

**What to do:** Create `core/sdc.js`:

**Discovery:**
- On boot, scan `themes/<active-theme>/components/` for directories
- Each component dir must have `component.json` (metadata + props schema — use JSON not YAML to maintain zero-dep) and `<name>.html` (template)
- Optional `<name>.css` (auto-loaded)

**component.json format:**
```json
{
  "name": "card",
  "description": "A content card with image, title, and body",
  "props": {
    "title": { "type": "string", "required": true },
    "image": { "type": "string" },
    "body": { "type": "string" },
    "link": { "type": "string" }
  }
}
```

**Rendering:**
- Add `{{component "card" title="Hello" body="World"}}` syntax to `core/template.js`
- Parse the component tag, look up in registry, validate props, render with component's template
- Inject component CSS into page `<head>`

**Registration in boot.js:**
- Import sdc, call `sdc.init(themePath)` during REGISTER phase
- Make available via services: `services.register('sdc', () => sdc)`

---

### 6. AI Agents Framework (Large — new file ~250 lines)

**What Drupal has:** `drupal/ai_agents` — full plugin architecture with AiAgentInterface, Plugin system (AiAgent, AiAgentValidation, AiAssistantAction, AiFunctionCall, AiFunctionGroup), tasks, events, entity support. Also 14 AI sub-modules in the `ai` contrib including ai_automators, ai_ckeditor, ai_content_suggestions, ai_logging, ai_search, ai_translate, ai_validations.

**What CMS Core has:** AI provider system (`ai-provider-manager.js`, `ai-registry.js`, `ai-rate-limiter.js`, `ai-stats.js`), providers (Anthropic, OpenAI, Ollama), operations (chat, embeddings, TTS, STT, image gen, classification, moderation), function-call-plugins.js. But no "agents" — autonomous AI entities that use tools to accomplish tasks.

**What to do:** Create `core/ai-agents.js`:

**Agent Registry:**
- `registerAgent(id, config)` — register with name, description, tools, system prompt
- `getAgent(id)` / `listAgents()` / `executeAgent(id, input, context)`

**Tool System:**
- Tools: `{ name, description, parameters, execute(params, context) }`
- Built-in tools: `readContent`, `listContent`, `createContent`, `updateContent`, `analyzeContent`

**Built-in Agents:**
1. **Field Agent** — auto-fills content fields from title/context
2. **SEO Agent** — generates meta descriptions, suggests tags

**Integration:**
- Register in `core/boot.js`
- Admin endpoints: `GET /admin/ai/agents`, `POST /admin/api/ai/agent/:id/execute`
- Use `ai-provider-manager.js` for AI calls

---

## Architecture Notes for Implementor

### Key Patterns in CMS Core

- **Zero external deps** (except TipTap for editor and Sharp for images). Use Node built-ins only.
- **Boot phases:** INIT → DISCOVER → REGISTER → BOOT → READY. New modules register in REGISTER phase.
- **Service container:** `core/services.js` (4KB) — `register(name, factory)`, `get(name)`. Singletons.
- **Hook system:** `core/hooks.js` (6KB) — `invoke(hookName, context)`. Modules implement hooks in `init()`.
- **Router:** `core/router.js` (12KB) — `register(method, path, handler, description)` with `:param` syntax.
- **Templates:** `core/template.js` (24KB) — `{{var}}` (escaped), `{{{var}}}` (raw), `{{#each}}`, `{{#if}}`.
- **Content:** `core/content.js` (137KB) — flat-file JSON in `content/<type>/<id>.json`.
- **Config:** JSON files in `config/` directory (24 files), loaded by `core/config.js`.
- **Admin module:** `modules/admin/index.js` — massive file with all admin routes. ~120 admin templates.
- **CSRF:** All POST forms need `{{csrfField}}` and CSRF validation (pattern in `core/csrf.js`).
- **Auth:** Sessions via signed cookies, file-backed persistence in `content/.sessions/active.json`.
- **HMAC pattern:** Used in CSRF (`core/csrf.js`), auth (`core/auth.js`). Reuse for captcha/honeypot tokens.

### How to Add a New Core Module

1. Create `core/<module>.js` with `init(config, context)` export
2. Import in `core/boot.js` (around line 105)
3. Add to REGISTER phase: `<module>.init(config.<module>, context)`
4. Add config section to `config/site.json`
5. Register routes via `router.register()`
6. Register services via `services.register()`

### Files You'll Touch

| Task | Files |
|------|-------|
| Login by email | `modules/users/index.js` (line 761-763), `modules/users/templates/login.html` (lines 16, 22) |
| Honeypot | New `core/honeypot.js`, `core/boot.js` (import + REGISTER), `config/site.json` |
| CAPTCHA | New `core/captcha.js`, `core/boot.js` (import + REGISTER), `config/site.json` |
| Privacy policy | `core/boot.js` (READY phase), `config/site.json` |
| SDC | New `core/sdc.js`, `core/template.js` (add component syntax), `core/boot.js` |
| AI Agents | New `core/ai-agents.js`, `core/boot.js`, `modules/admin/index.js` |

### Running the Project

```bash
cd /Users/Alchemy/Projects/experiments/cms-core
node server.js        # Starts on port 3001
# Login: admin/admin
```

### Drupal CMS (for reference)

```bash
cd /Users/Alchemy/Projects/experiments/drupal-cms
ddev start            # Starts at https://drupal-cms.ddev.site
```

## Errata from Original Parity Analysis

The original analysis (the document that asked "check this for accuracy") had these errors, now corrected:

1. **Template auto-escaping**: Claimed missing/gap — actually implemented at `core/template.js:596`
2. **Session persistence**: Claimed "in-memory, won't survive restart" — actually file-backed
3. **Email**: Claimed "console-only stub" — actually has full SMTP+STARTTLS+AUTH
4. **Command palette**: Claimed "Not implemented" — `public/js/command-palette.js` exists
5. **Autosave forms**: Claimed "Not implemented" — exists in `public/js/admin.js:396`
6. **Yoast SEO analysis**: Claimed "Not implemented" — `core/seo.js` (47KB) is a full analyzer
7. **Breadcrumbs**: Claimed "Not mentioned" — `core/menu.js:703` `getBreadcrumbs()`
8. **Honeypot**: Claimed "Not implemented" — partial in `core/contact.js:66` (contact-only)
9. **Drupal deps "~60"**: Actually ~79 drupal/* packages in composer.json
10. **CMS Core admin templates "~130"**: Actually ~120
11. **Drupal AI sub-modules**: 14 sub-modules in `ai` contrib not listed (ai_automators, ai_chatbot, ai_ckeditor, ai_content_suggestions, ai_eca, ai_external_moderation, ai_logging, ai_observability, ai_search, ai_translate, ai_validations, field_widget_actions, ai_api_explorer, ai_assistant_api)
12. **Email templates**: Claimed "Not implemented" — template system exists in `core/email.js`
