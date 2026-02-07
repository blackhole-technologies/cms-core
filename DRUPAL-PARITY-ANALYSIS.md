# Drupal CMS 2.0 Parity Analysis

**Created:** 2026-02-07
**Purpose:** Identify what cms-core needs to match Drupal CMS 2.0 feature set

---

## Executive Summary

Drupal CMS 2.0 ships with **75 core modules** + **67 contrib modules** = 142 total modules.
CMS-core has **63 core services** + **9 modules** + **352 CLI commands**.

**CMS-core is strong on:** Core CMS functionality, CLI tooling, content management
**CMS-core is missing:** AI integration, visual builders, accessibility tools, advanced SEO

---

## Feature Comparison Matrix

### ✅ CMS-Core Has (Drupal Parity Achieved)

| Feature | CMS-Core | Drupal |
|---------|----------|--------|
| Content Types | `contentTypes.js` | node module |
| Fields System | `fields.js` (21 types) | field module |
| Revisions | content service | node module |
| Workflow/Moderation | `workflow-advanced.js` | content_moderation |
| Scheduling | `scheduler.js` | scheduler contrib |
| Search | `search.js` | search module |
| Media Library | `media-library.js` | media_library |
| WYSIWYG Editor | `editor.js` | ckeditor5 |
| Responsive Images | `responsive-images.js` | responsive_image |
| JSON:API | `jsonapi.js` | jsonapi |
| GraphQL | `graphql.js` | (requires contrib) |
| Views/Queries | `views.js` | views |
| Layout Builder | `layout-builder.js` | layout_builder |
| Taxonomy | `taxonomy.js` | taxonomy |
| Comments | `comments.js` | comment |
| Users/Auth | `auth.js` | user |
| Permissions | `permissions.js` | user |
| Menus | `menu.js` | menu_ui |
| Path Aliases | `path-aliases.js` | path, pathauto |
| Sitemap | `sitemap.js` | simple_sitemap |
| Contact Forms | `contact.js` | contact, webform (partial) |
| i18n | `i18n.js` | language, locale |
| Cache | `cache.js` | dynamic_page_cache |
| Backup | `backup.js` | (requires contrib) |
| Analytics | `analytics.js` | google_tag |
| Tokens | `tokens.js` | token |
| Actions/Rules | `actions.js` | (partial - see ECA) |
| Webhooks | `webhooks.js` | (requires contrib) |
| Email | `email.js` | symfony_mailer_lite |
| Trash/Soft Delete | `trash` module | trash contrib |
| IP Ban | `ban.js` | ban |
| Feeds (RSS/Atom) | `feeds.js` | (requires contrib) |
| oEmbed | `oembed.js` | media |
| Breadcrumbs | `menu.js` | easy_breadcrumb |
| Theme System | `theme-engine.js` | twig themes |

### ⚠️ Partial Implementation (Needs Work)

| Feature | CMS-Core Status | Drupal Has | Gap |
|---------|-----------------|------------|-----|
| SEO Tools | Basic sitemap | yoast_seo, metatag, seo_checklist | Real-time SEO analysis, meta tags UI, checklist |
| Form Builder | Basic forms | webform (massive) | Conditional logic, multi-step, submissions management |
| Rules Engine | Basic actions | ECA + BPMN.io | Visual rule builder, event-condition-action UI |
| Accessibility | None | editoria11y | Automatic a11y checking, inline warnings |
| Content Moderation | Basic workflow | scheduler_content_moderation_integration | Workflow + scheduling integration |
| Link Management | None | linkit, redirect | Link picker dialog, redirect management |
| Image Cropping | None | crop, focal_point | Interactive crop UI, focal point selection |

### ❌ CMS-Core Missing Entirely

| Feature | Drupal Module(s) | Priority | Complexity |
|---------|------------------|----------|------------|
| **AI Agents** | ai_agents, ai, ai_dashboard | 🔴 HIGH | HIGH |
| **Canvas (Experience Builder)** | canvas | 🔴 HIGH | VERY HIGH |
| **Visual Rule Builder** | eca, bpmn_io | 🟡 MEDIUM | HIGH |
| **Accessibility Checker** | editoria11y | 🟡 MEDIUM | MEDIUM |
| **Real-time SEO** | yoast_seo | 🟡 MEDIUM | MEDIUM |
| **Advanced Webforms** | webform | 🟡 MEDIUM | HIGH |
| **Content Moderation + Scheduling** | scheduler_content_moderation_integration | 🟡 MEDIUM | LOW |
| **Image Focal Point** | focal_point, crop | 🟢 LOW | MEDIUM |
| **Link Picker** | linkit | 🟢 LOW | LOW |
| **Redirects** | redirect | 🟢 LOW | LOW |
| **Autosave** | autosave_form | 🟢 LOW | LOW |
| **Coffee (Command Palette)** | coffee | 🟢 LOW | LOW |
| **Infinite Scroll** | views_infinite_scroll | 🟢 LOW | LOW |
| **Klaro (Cookie Consent)** | klaro | 🟢 LOW | LOW |
| **CAPTCHA** | captcha, friendlycaptcha | 🟢 LOW | LOW |

---

## Deep Dive: High-Priority Missing Features

### 1. AI Agents (🔴 HIGH PRIORITY)

**Drupal Architecture (from actual code review):**

```
ai_agents/
├── src/
│   ├── Plugin/
│   │   ├── AiAgent/           # Agent implementations
│   │   │   ├── FieldType.php  # 889 lines - field manipulation
│   │   │   ├── ContentType.php
│   │   │   └── TaxonomyAgent.php
│   │   ├── AiFunctionCall/    # Executable actions
│   │   │   ├── CreateFieldStorageConfig.php
│   │   │   ├── ManipulateFieldConfig.php
│   │   │   └── ...
│   │   └── AiAgentValidation/ # Output validators
│   ├── PluginBase/
│   │   └── AiAgentBase.php    # Base class with LLM calls
│   └── Service/
│       ├── AgentHelper.php    # Prompt building, response parsing
│       └── FieldAgent/FieldAgentHelper.php
└── prompts/
    └── field_type_agent/
        ├── determineFieldTask.yml      # Triage prompt (routing)
        ├── determineStorageSettings.yml
        ├── determineFieldConfigurations.yml
        └── answerQuestion.yml
```

**Key Patterns:**
1. **YAML Prompt Files** with structure:
   ```yaml
   preferred_model: gpt-4o
   preferred_llm: openai
   is_triage: true        # Routes to sub-agents
   weight: 0              # Priority
   prompt:
     introduction: >      # System prompt
       You are a Drupal developer...
     context:             # Injected data
       - entity_types: {{ entity_types }}
       - field_types: {{ field_types }}
   output:                # Expected JSON schema
     type: json
     schema: {...}
   ```

2. **Triage Pattern:** First agent (`is_triage: true`) routes to specialized agents
3. **Context Injection:** Entity types, field types, existing config passed to prompts
4. **Function Calls:** Actions like `CreateFieldStorageConfig` are plugins
5. **Validation:** Response validated against schema before execution

**What CMS-Core Needs:**

```
core/ai-agents.js
├── AgentBase class
├── PromptLoader (YAML → structured prompt)
├── ContextBuilder (entity types, fields, etc.)
├── ResponseParser (JSON extraction, validation)
└── FunctionRegistry (executable actions)

config/prompts/
└── field-agent/
    ├── triage.yml
    └── create-field.yml
```

**Estimated Effort:** 4-5 days (more complex than initially thought)

---

### 2. Canvas / Experience Builder (🔴 HIGH PRIORITY)

**What Drupal Has:**
- Visual page builder without code
- Drag-and-drop components
- Component library integration
- Design system support
- AI-assisted component creation
- Works without developer involvement

**What CMS-Core Needs:**
1. Visual component library browser
2. Drag-and-drop page composition
3. Component slot/region system
4. Real-time preview
5. Export to layout builder format
6. Design system token integration

**Estimated Effort:** 5-7 days (complex frontend work)

---

### 3. ECA / Visual Rules Engine (🟡 MEDIUM PRIORITY)

**Drupal Architecture (from actual code review):**

```
eca/
├── src/
│   ├── Processor.php          # Core execution engine
│   │   - Listens to ALL Drupal events
│   │   - Matches against ECA models
│   │   - Executes condition→action chains
│   │   - Recursion protection
│   ├── Entity/
│   │   └── Eca.php            # Config entity (stores models)
│   ├── Plugin/
│   │   ├── Action/            # Action plugins
│   │   │   └── ActionBase.php # Base with token, state, event access
│   │   ├── ECA/
│   │   │   ├── Condition/     # Condition plugins
│   │   │   └── Event/         # Event plugins
│   │   └── DataType/          # Custom data types
│   └── Token/                 # Token replacement service
└── modules/
    ├── eca_content/           # Content entity events/actions
    ├── eca_user/              # User events/actions
    └── eca_queue/             # Queue actions
```

**Key Patterns:**
1. **Event Subscription:** Processor subscribes to ALL Symfony events
2. **Model Matching:** For each event, finds matching ECA config entities
3. **Execution Chain:** Event → Conditions (AND/OR) → Actions
4. **Token System:** `[node:title]`, `[current-user:name]` for dynamic values
5. **State Service:** Share data between actions in same execution
6. **BPMN.io Integration:** Visual modeler exports to ECA config format

**What CMS-Core Needs:**

```
core/eca.js
├── Processor
│   - hook into existing hook system
│   - match events against models
│   - execute condition→action chains
├── Model storage (config/eca/*.json)
├── Built-in Events:
│   - content:created, content:updated, content:deleted
│   - user:login, user:logout, user:created
│   - scheduler:run, cron:*
│   - form:submitted
├── Built-in Conditions:
│   - field:equals, field:contains, field:empty
│   - user:hasRole, user:isAuthenticated
│   - content:isType, content:hasStatus
├── Built-in Actions:
│   - content:publish, content:update, content:delete
│   - email:send, webhook:call
│   - token:set, log:write

modules/admin/routes/eca.js  # Admin UI for model building
```

**Estimated Effort:** 5-6 days (more complex than initially thought)

---

### 4. Accessibility Checker - editoria11y (🟡 MEDIUM PRIORITY)

**What Drupal Has:**
- Automatic accessibility scanning on page load
- Inline issue highlighting
- Focuses on content-author-fixable issues
- Works across views, layout builder, paragraphs
- CKEditor integration

**What CMS-Core Needs:**
1. DOM scanner for common a11y issues:
   - Missing alt text
   - Empty headings
   - Heading hierarchy
   - Low contrast (if computed)
   - Missing form labels
   - Link text issues ("click here")
2. Issue overlay UI
3. CKEditor plugin
4. Configuration (which checks to run)

**Estimated Effort:** 2 days

---

### 5. Real-time SEO - yoast_seo (🟡 MEDIUM PRIORITY)

**What Drupal Has:**
- Focus keyword analysis
- Content length check
- Keyword density
- Meta description preview
- Readability score
- Heading structure analysis
- Link analysis

**What CMS-Core Has:**
- Basic sitemap
- No real-time analysis

**What CMS-Core Needs:**
1. Focus keyword field
2. Real-time content analyzer:
   - Keyword in title, headings, first paragraph
   - Content length
   - Meta description length
   - Internal/external link ratio
3. Score visualization (red/yellow/green)
4. Suggestions panel

**Estimated Effort:** 2 days

---

## Theme Integration Issue

### Current Problem

The `/explore` page in the conscious module serves raw HTML with inline CSS:

```javascript
// modules/conscious/index.js
register('GET', '/explore', async (req, res) => {
  const html = readFileSync(templatePath, 'utf-8');  // Raw file read
  res.end(html);
});
```

The `explore.html` template has its own `:root` variables:
```css
:root {
    --bg: #0a0a0f;          /* Duplicates theme engine! */
    --surface: #12121a;
    ...
}
```

### What Should Happen

1. Template should include theme engine CSS via `<link>`:
   ```html
   <link rel="stylesheet" href="/themes/skins/consciousness-dark/variables.css">
   <link rel="stylesheet" href="/themes/skins/consciousness-dark/overrides.css">
   ```

2. Template should use standard variable names:
   ```css
   body { background: var(--color-bg); }  /* Not --bg */
   ```

3. Route should use theme engine to determine which skin:
   ```javascript
   const skin = themeEngine.getActiveSkin();
   const skinPaths = themeEngine.getSkinCSSPaths(skin.id);
   ```

### Fix Required

1. **Refactor explore.html:**
   - Remove inline `:root` CSS variables
   - Add `<link>` to skin CSS
   - Update variable names to match theme engine convention

2. **Update conscious module route:**
   - Get active skin from theme engine
   - Inject CSS paths into template
   - Or use template service with theme context

3. **Create layout integration:**
   - explore.html should extend the immersive layout
   - Use layout regions (header, content, footer)

---

## Recommended Priority Order

### Phase 1: Theme Integration (1 day)
1. Fix explore.html to use theme engine CSS
2. Wire conscious module to respect active skin
3. Test with consciousness-dark and consciousness-light

### Phase 2: SEO + Accessibility (3-4 days)
1. Add real-time SEO analyzer (yoast-style)
2. Add accessibility checker (editoria11y-style)
3. Integrate both into content editing forms

### Phase 3: AI Agents (3-4 days)
1. Create agent framework
2. Build content type agent
3. Build field type agent
4. Add CLI + admin UI

### Phase 4: Rules Engine (3-4 days)
1. Expand actions.js with condition system
2. Create event catalog
3. Build visual modeler (basic version)

### Phase 5: Experience Builder (5-7 days)
1. Component library system
2. Drag-drop composer
3. Design token integration

---

## Files to Create/Modify

### Theme Integration
- `modules/conscious/index.js` - Update /explore route
- `themes/default/templates/conscious/explore.html` - Refactor CSS
- `themes/layouts/immersive/templates/explore.html` - New layout-aware template

### New Core Services
- `core/seo-analyzer.js` - Real-time SEO
- `core/accessibility.js` - A11y checker
- `core/ai-agents.js` - AI agent framework
- `core/eca.js` - Event-Condition-Action engine
- `core/experience-builder.js` - Visual composer

### New Modules
- `modules/ai/` - AI agents module
- `modules/seo/` - SEO tools (extends existing seo plugin)
- `modules/eca/` - Rules engine

---

*Analysis complete. Start with Theme Integration, then proceed based on priorities.*
