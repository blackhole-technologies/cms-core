# Handoff: Admin Sidebar Fix

## What Was Done (Completed)

### 1. Fixed template name mismatches in `modules/admin/index.js`
All 6 references updated to match actual filenames on disk:
- `content-type-list.html` → `content-types-list.html`
- `content-type-form.html` → `content-types-edit.html` (2 places: new + edit)
- `content-type-fields.html` → `content-types-fields.html`
- `content-type-field-form.html` → `content-types-field-edit.html`
- `theme-list.html` → `themes-list.html`

### 2. Fixed appearance route service name in `modules/admin/index.js`
All 4 appearance routes used `ctx.services.get('theme')` but the service is registered as `themeSettings`. Since `.get()` throws (not returns null), this caused 500s. Fixed all 4 handlers to use `themeSettings` with try/catch.

### 3. Added `/admin/config` hub route in `modules/admin/index.js`
Inserted before the "Actions & Rules" section (~line 12596). Renders inline HTML with `admin-menu-grid` linking to: Text Formats, Image Styles, Path Aliases, Tokens, Actions, Rules, User Fields, Regions, SEO, Contact Forms, Permissions.

### 4. Added module enable/disable routes in `modules/admin/index.js`
Inserted after the `GET /admin/modules` route (~line 6191):
- `POST /admin/modules/:name/enable` — adds to `config/modules.json`
- `POST /admin/modules/:name/disable` — removes from `config/modules.json` (blocks disabling `admin`)

### 5. Updated `modules/admin/templates/modules.html`
Added "Operations" column with Enable/Disable form buttons per module. Fixed badge classes to `status-badge--published`/`status-badge--draft`.

### All pages verified returning 200:
- `/admin/structure/types`, `/admin/appearance`, `/admin/config`, `/admin/modules`, `/admin`

---

## What Remains (Not Done)

### Sidebar needs to use SLIDING DRAWERS, not accordion

**Current state of files:**
- `themes/default/templates/admin-layout.html` — has accordion-style sidebar with `<button class="sidebar-toggle">` per section, chevron CSS triangle, and JS `classList.toggle('open')`. Active section gets `open active` classes from server.
- `public/css/admin.css` — has dark sidebar (#333 bg), sections use `max-height` CSS transition to expand/collapse. Chevron rotates 90deg on open.

**User wants:** Sliding drawers like Drupal's admin toolbar tray. In Drupal, clicking a top-level menu item slides out a panel/tray from the side (or below the toolbar) containing that section's sub-links. It's NOT an accordion — it's a slide-out panel.

**Drupal's actual behavior:**
- The toolbar has top-level items (Content, Structure, etc.)
- Clicking one opens a "tray" — a sliding panel that appears to the right of or below the toolbar item
- Only one tray is open at a time (clicking another closes the current one)
- The tray slides in with a CSS transform/transition, not a height expand
- The toolbar can be oriented vertically (sidebar) or horizontally (top bar)

**What to implement:**
- Change the sidebar sections so clicking a toggle SLIDES the sub-menu in from the left (or fades/slides down) rather than accordion-expanding
- Use CSS `transform: translateX()` or similar slide transition
- Only one drawer open at a time
- Active section's drawer is open by default on page load

### Files to modify:
- `themes/default/templates/admin-layout.html` — update JS toggle logic
- `public/css/admin.css` — change from `max-height` transition to slide transform

### Key patterns in codebase:
- `renderAdmin()` is at `modules/admin/index.js:5309` — sets nav flags based on URL path
- Layout vars passed: `navDashboard, navContent, navStructure, navAppearance, navModules, navConfig, navPeople, navReports`
- Template engine uses `{{#if varName}}` for conditionals
- Server: `node index.js` from `experiments/cms-core/`, runs on port 3001
- Login: POST `/login` with `username=admin&password=admin`
- `ctx.services.get(name)` THROWS if service not found — always wrap in try/catch

### Pre-existing issues (not ours):
- `/admin/text-formats` uses `ctx.services.get('text_format')` but service is `textFormats` — 500
- `/admin/config/actions` uses `ctx.services.get('action')` but service is `actions` — 500
- These are the same pattern as the theme bug we fixed
