# Theme Engine - Handoff Document

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

## Next Steps

1. Add theme-engine to boot.js
2. Create admin appearance page
3. Add consciousness-light skin
4. Port curate.html to use theme system
5. Add live preview in admin

---

*Created: 2026-02-07*
*Status: Core built, integration pending*
