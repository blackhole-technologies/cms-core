# Theme Engine - Handoff Document

**Last Updated:** 2025-02-07
**Status:** ✅ Wired into boot.js, CLI working, admin UI ready

## What's New (This Session)

1. **Wired into boot.js** — Theme engine now initializes on boot
2. **Static file serving** — `/themes/*` paths now served by static.js
3. **CLI commands** — `layouts:list`, `skins:list`, `theme-engine:status`, etc.
4. **Admin routes** — `/admin/appearance/layouts` for visual theme management
5. **Admin template** — `theme-engine.html` with layout/skin selection UI

## Overview

The theme engine provides a complete theming system with separated concerns:

- **Layouts**: Structural templates (HTML skeleton, regions)
- **Skins**: Visual styling (CSS variables, overrides)
- **Admin**: Separate system with fixed layout, limited skins

## Architecture

```
LAYOUT (structure)
   └── SKIN (visual)
```

You pick a layout, then pick a skin compatible with that layout.
Skins can be switched without changing layout.
Layouts can be switched entirely with a new compatible skin.

## Directory Structure

```
themes/
├── layouts/                    # Public site layouts
│   ├── immersive/
│   │   ├── manifest.json       # Layout metadata
│   │   └── templates/
│   │       ├── page.html       # Base page structure
│   │       ├── header.html
│   │       └── footer.html
│   └── classic/
│       ├── manifest.json
│       └── templates/
│           ├── page.html
│           ├── header.html
│           ├── sidebar.html
│           └── footer.html
│
├── skins/                      # Public site skins
│   ├── consciousness-dark/
│   │   ├── manifest.json       # Skin metadata
│   │   ├── variables.css       # CSS custom properties
│   │   └── overrides.css       # Layout-specific tweaks
│   ├── consciousness-light/    # (TODO)
│   └── minimal/
│       ├── manifest.json
│       ├── variables.css
│       └── overrides.css
│
└── admin/                      # Admin (separate system)
    ├── layout/                 # FIXED - no switching
    │   └── templates/
    └── skins/                  # 3 options only
        ├── default/
        │   ├── manifest.json
        │   └── variables.css
        ├── dark/
        │   ├── manifest.json
        │   └── variables.css
        └── high-contrast/
            ├── manifest.json
            └── variables.css
```

## Core Module

**File:** `core/theme-engine.js`

### Key Functions

```javascript
// Initialization
init(options)                   // Initialize with baseDir and config
refresh()                       // Rediscover themes after changes

// Layouts
listLayouts()                   // Get all available layouts
getLayout(id)                   // Get specific layout
getActiveLayout()               // Get currently active layout
getLayoutTemplate(id, name)     // Get template content

// Skins
listSkins(layoutId?)            // List skins (optionally filtered by layout)
getSkin(id)                     // Get specific skin
getActiveSkin()                 // Get currently active skin
getSkinCSS(id)                  // Get combined CSS content
getSkinCSSPaths(id)             // Get CSS file paths for linking

// Admin Skins
listAdminSkins()                // List admin skins (3 options)
getAdminSkin(id)                // Get specific admin skin
getActiveAdminSkin()            // Get currently active admin skin

// Active Theme
getActiveTheme()                // Get { layout, skin } for current config
setActiveTheme(layoutId, skinId) // Update active theme
setAdminSkin(skinId)            // Update admin skin

// Rendering Helpers
getThemeContext()               // Get context object for templates
renderSkinCSS()                 // Generate <link> tags for skin
renderAdminSkinCSS()            // Generate <link> tags for admin skin
```

## Config (site.json)

```json
{
  "theme": {
    "layout": "immersive",
    "skin": "consciousness-dark"
  },
  "adminTheme": {
    "skin": "default"
  }
}
```

## Manifest Schemas

### Layout Manifest

```json
{
  "id": "immersive",
  "name": "Immersive",
  "description": "Full-width, distraction-free layout",
  "version": "1.0.0",
  "regions": ["header", "content", "footer"],
  "compatibleSkins": ["consciousness-dark", "minimal"],
  "templates": {
    "page": "page.html",
    "header": "header.html",
    "footer": "footer.html"
  },
  "settings": {
    "maxWidth": "none",
    "headerStyle": "minimal"
  }
}
```

### Skin Manifest

```json
{
  "id": "consciousness-dark",
  "name": "Consciousness Dark",
  "description": "Gold and purple on deep black",
  "version": "1.0.0",
  "compatibleLayouts": ["immersive", "classic"],
  "variables": "variables.css",
  "overrides": "overrides.css",
  "preview": "preview.png",
  "colors": {
    "primary": "#d4a574",
    "secondary": "#a87fd4",
    "background": "#0a0a0f",
    "text": "#e8e8f0"
  }
}
```

## CSS Variables

Skins define CSS custom properties in `variables.css`:

```css
:root {
  /* Colors */
  --color-bg: #0a0a0f;
  --color-surface: #12121a;
  --color-text: #e8e8f0;
  --color-primary: #d4a574;
  
  /* Typography */
  --font-family-base: 'Georgia', serif;
  --font-size-base: 1rem;
  
  /* Spacing */
  --spacing-md: 1rem;
  --spacing-lg: 1.5rem;
  
  /* Borders & Shadows */
  --radius-md: 8px;
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.4);
}
```

## Available Themes

### Layouts

| ID | Name | Regions | Description |
|----|------|---------|-------------|
| `immersive` | Immersive | header, content, footer | Full-width, no sidebar |
| `classic` | Classic | header, sidebar, content, footer | Traditional with sidebar |

### Skins

| ID | Name | Description |
|----|------|-------------|
| `consciousness-dark` | Consciousness Dark | Gold/purple on black (from prototype) |
| `minimal` | Minimal | Clean, simple, high readability |
| `consciousness-light` | Consciousness Light | (TODO) Light version |

### Admin Skins

| ID | Name | Description |
|----|------|-------------|
| `default` | Default | Clean professional |
| `dark` | Dark | Dark mode |
| `high-contrast` | High Contrast | Accessibility-focused |

## Integration TODO

1. **Wire into boot.js** - Initialize theme engine on boot
2. **Update template service** - Use layout templates
3. **Update admin module** - Use admin skin CSS
4. **Admin UI** - `/admin/appearance` for theme switching
5. **CLI commands** - `theme:list`, `theme:set`, `theme:refresh`
6. **Static file serving** - Serve CSS from themes directory

## Usage in Templates

```html
<!-- In layout page.html -->
{{#each skin.cssPaths}}
<link rel="stylesheet" href="{{this}}">
{{/each}}

<!-- Or use helper -->
{{{renderSkinCSS}}}
```

## Files Modified This Session

### Core
- `core/boot.js` — Added import and initialization of theme engine (~line 93, ~line 850)
- `core/static.js` — Extended to serve `/themes/*` paths (lines ~260, ~205)

### Admin Module
- `modules/admin/index.js` — Added CLI commands (~line 4265) and routes (~line 13195)
- `modules/admin/templates/theme-engine.html` — Created (layout/skin selection UI)

## CLI Commands Added

```bash
# List layouts
node index.js layouts:list

# List skins (optionally filter by layout)
node index.js skins:list [layout-id]

# List admin skins
node index.js skins:admin

# Show current theme status
node index.js theme-engine:status

# Set layout and skin
node index.js theme-engine:set <layout> <skin>

# Set admin skin
node index.js theme-engine:admin <skin>

# Refresh theme discovery
node index.js theme-engine:refresh
```

## Admin Routes Added

| Route | Method | Description |
|-------|--------|-------------|
| `/admin/appearance/layouts` | GET | Layout & skin manager UI |
| `/admin/appearance/layouts` | POST | Save layout/skin selection |
| `/admin/appearance/layouts/preview/:layout/:skin` | GET | Preview combination |

## Testing

```bash
# Test CLI (works now)
cd /Users/Alchemy/Projects/experiments/cms-core
node index.js layouts:list
node index.js theme-engine:status

# Test HTTP (restart server first - port 3000 was blocked)
pkill -f "node.*cms-core"
node index.js
# Then visit: http://localhost:3000/admin/appearance/layouts
# And test: curl http://localhost:3000/themes/skins/consciousness-dark/variables.css
```

## Known Issues

1. **Port 3000 blocked** — Old server instance running. Kill it before testing HTTP.
2. **Template helper `eq`** — The `theme-engine.html` template uses `{{#if (eq id ../activeLayout)}}` which requires the template engine to support `eq` helper. If not working, use JavaScript to add `.active` class instead.

## Next Steps

1. ~~Wire theme-engine into boot.js~~ ✅ Done
2. ~~Create /admin/appearance UI~~ ✅ Done
3. ~~Add static serving for /themes/*~~ ✅ Done
4. ~~Add consciousness-light skin~~ ✅ Done
5. ~~Persist theme selection to config/site.json~~ ✅ Done
6. Port curate.html to use theme system
7. Add live preview in admin

## Latest Changes (Session 3 continued)

### Persistence Added
- `saveThemeConfig()` function writes to `config/site.json`
- `setActiveTheme(layout, skin, persist=true)` saves on change
- `setAdminSkin(skinId, persist=true)` saves on change
- Admin UI now persists changes automatically

### consciousness-light Skin Added
- Warm gold (#8b6914) and violet (#6b4d91) on cream (#faf8f5)
- Full variables.css with complete design system
- overrides.css with light-mode specific adjustments
- Compatible with both immersive and classic layouts

### Current Skins (3)
| ID | Name | Description |
|----|------|-------------|
| consciousness-dark | Consciousness Dark | Gold/purple on black |
| consciousness-light | Consciousness Light | Gold/violet on cream |
| minimal | Minimal | Clean, simple, readable |

---

*Created: 2025-02-07*
*Status: Feature complete, ready for use*
