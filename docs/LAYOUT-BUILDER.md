# Layout Builder

Section-based visual page composition for cms-core.

## Overview

Layout Builder enables drag-and-drop page building through:

- **Layouts**: Named templates defining column structures (1-col, 2-col, hero, etc.)
- **Sections**: Instances of layouts placed on a page
- **Components**: Blocks or inline content placed within section regions
- **Overrides**: Per-content customizations

## Quick Start

```javascript
// Get the service
const layoutBuilder = ctx.services.get('layoutBuilder');

// Create a section with 2-column layout
const section = layoutBuilder.createSection('two_column', {
  label: 'My Content Section',
});

// Add a block to the left column
layoutBuilder.addComponent(section, 'left', {
  type: 'block',
  blockId: 'my-block-id',
});

// Render the section
const html = await layoutBuilder.renderSection(section, context);
```

## Built-in Layouts

| Layout | Regions | Description |
|--------|---------|-------------|
| `one_column` | main | Full-width single column |
| `two_column` | left, right | Two equal 50/50 columns |
| `two_column_wide_left` | main, sidebar | 66% / 33% split |
| `two_column_wide_right` | sidebar, main | 33% / 66% split |
| `three_column` | left, center, right | Three equal columns |
| `four_column` | col1-4 | Four equal columns |
| `hero` | content | Full-width hero section |
| `card_grid` | cards | Responsive auto-fill grid |

## API Reference

### Layout Definitions

```javascript
// Register a custom layout
await layoutBuilder.registerLayout({
  id: 'my_layout',
  label: 'My Custom Layout',
  description: 'A layout for special pages',
  category: 'custom',
  regions: [
    { id: 'header', label: 'Header', width: '100%', weight: 0 },
    { id: 'content', label: 'Content', width: '70%', weight: 1 },
    { id: 'sidebar', label: 'Sidebar', width: '30%', weight: 2 },
  ],
  settings: {
    maxWidth: '1200px',
    padding: '2rem',
    gap: '1.5rem',
  },
});

// Get a layout
const layout = layoutBuilder.getLayout('two_column');

// List all layouts
const layouts = layoutBuilder.listLayouts();

// List layouts by category
const simpleLayouts = layoutBuilder.listLayouts({ category: 'simple' });

// List categories
const categories = layoutBuilder.listCategories();
```

### Section Management

```javascript
// Create a section
const section = layoutBuilder.createSection('two_column', {
  label: 'Features Section',
  weight: 0,
  settings: { backgroundColor: '#f5f5f5' },
});

// Add components
layoutBuilder.addComponent(section, 'left', {
  type: 'block',
  blockId: 'feature-block-1',
  weight: 0,
});

layoutBuilder.addComponent(section, 'right', {
  type: 'inline',
  content: { html: '<p>Custom content</p>' },
  weight: 0,
});

// Move a component
layoutBuilder.moveComponent(section, 'component-id', 'right', 1);

// Remove a component
layoutBuilder.removeComponent(section, 'left', 'component-id');

// Reorder sections
const reordered = layoutBuilder.reorderSections(sections, ['id1', 'id3', 'id2']);

// Clone a section
const cloned = layoutBuilder.cloneSection(section);
```

### Default Layouts (Per Content Type)

```javascript
// Set default layout for a content type
await layoutBuilder.setDefaultLayout('landing_page', [
  layoutBuilder.createSection('hero'),
  layoutBuilder.createSection('three_column'),
  layoutBuilder.createSection('one_column'),
]);

// Get default layout
const defaultLayout = layoutBuilder.getDefaultLayout('landing_page');

// Remove default
layoutBuilder.removeDefaultLayout('landing_page');
```

### Content Layout Overrides

```javascript
// Get layout for specific content
const layout = layoutBuilder.getContentLayout('article', 'article-123');

// Set layout override for content
await layoutBuilder.setContentLayout('article', 'article-123', sections);

// Clear override (revert to default)
await layoutBuilder.clearContentLayout('article', 'article-123');
```

### Rendering

```javascript
// Render a single section
const sectionHtml = await layoutBuilder.renderSection(section, {
  user: currentUser,
  services: ctx.services,
});

// Render complete layout
const html = await layoutBuilder.renderLayout(sections, context);

// Render content's layout
const contentHtml = await layoutBuilder.renderContentLayout(
  'article',
  'article-123',
  context
);
```

### Import/Export

```javascript
// Export layout configuration
const exported = layoutBuilder.exportLayout(sections);
// Returns: { version, exported, sections }

// Import layout configuration
const imported = layoutBuilder.importLayout(exportedData);
// Returns sections with regenerated IDs
```

## CLI Commands

```bash
# List available layouts
node index.js layout:list

# List sections in a default layout
node index.js layout:sections article

# Add a block to a layout
node index.js layout:add-block article hero content block-123

# Render layout to HTML
node index.js layout:render article
```

## Configuration

In `config/site.json`:

```json
{
  "layoutBuilder": {
    "enabled": true,
    "allowOverrides": true,
    "defaultLayout": "one_column",
    "cacheEnabled": true,
    "cacheTTL": 300
  }
}
```

## Hooks

| Hook | Trigger |
|------|---------|
| `layout:beforeRegister` | Before registering a layout |
| `layout:afterRegister` | After registering a layout |
| `layout:beforeRenderSection` | Before rendering a section |
| `layout:afterRenderSection` | After rendering a section |
| `layout:beforeRender` | Before rendering full layout |
| `layout:afterRender` | After rendering full layout |
| `layout:beforeRenderComponent` | Before rendering a component |
| `layout:afterRenderComponent` | After rendering a component |

## Storage

- **Layout definitions**: `config/layouts.json`
- **Default layouts**: `config/layout-defaults.json`
- **Content overrides**: Stored in content item's `_layout` field
