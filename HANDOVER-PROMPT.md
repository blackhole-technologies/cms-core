# CMS Core v0.0.31 - Handover Prompt

Copy this prompt to continue development:

---

In experiments/cms-core, continue CMS Core development from v0.0.31.

**Just completed:** Content workflow and publishing states
- Status field: draft, pending, published, archived
- Workflow functions: publish(), unpublish(), archive(), schedulePublish()
- Hooks: content:beforeStatusChange, content:afterStatusChange, content:published, content:unpublished
- Scheduled task (workflow:publish) runs every minute to auto-publish
- Public API returns only published content by default
- CLI commands for workflow management
- Admin UI with status tabs, badges, action buttons

**Key files modified:**
- core/content.js - workflow functions and status management
- core/boot.js - workflow CLI commands and config initialization
- modules/tasks/index.js - workflow:publish scheduled task
- modules/admin/index.js - workflow admin routes
- modules/admin/templates/content-list.html - status tabs/badges
- modules/admin/templates/content-form.html - status dropdown/actions
- public/css/admin.css - workflow styles
- config/site.json - workflow config enabled

**Next planned (v0.0.32):** Plugin auto-reload mode
- Auto-reload plugins in development mode when files change
- `plugins.autoReload: true` config option
- Admin UI badge for changed plugins

**Architecture:**
- Zero external dependencies (Node.js stdlib only)
- ES Modules (import/export)
- Hook-based extensibility
- Five-phase boot: INIT → DISCOVER → REGISTER → BOOT → READY
- Flat-file JSON content storage

Read HANDOFF.md for full documentation.

---
