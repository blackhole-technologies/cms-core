# WYSIWYG Editor

Backend-agnostic rich text editor configuration for cms-core.

## Overview

The Editor module provides:

- **Format Configurations**: Toolbar buttons, allowed HTML, text format integration
- **50+ Toolbar Buttons**: All common formatting options defined
- **Pluggable Backend**: Works with any frontend editor (Quill, TipTap, CKEditor, etc.)
- **Media Embed Processing**: Server-side handling of embedded media
- **Text Format Integration**: Sanitization via text-formats service

## Design Philosophy

Unlike Drupal's CKEditor integration, this module is **backend-agnostic**:

1. It defines *configurations* (toolbars, formats, plugins)
2. The frontend consumes these configs via API
3. Any WYSIWYG library can be used
4. Server-side processing handles sanitization

## Quick Start

```javascript
// Get the service
const editor = ctx.services.get('editor');

// Get config for frontend
const config = editor.getEditorConfig('full');

// Process content before saving
const processed = await editor.processContent(htmlContent, 'full');
```

## Built-in Formats

| Format | Description | Use Case |
|--------|-------------|----------|
| `minimal` | Bold, italic, links only | Simple text fields |
| `basic` | Standard formatting, lists, headings | Most content |
| `full` | All features including tables, media | Power users |
| `code` | Optimized for code content | Technical docs |

## API Reference

### Editor Formats

```javascript
// Get format configuration
const format = editor.getFormat('basic');

// List all formats
const formats = editor.listFormats();

// Register custom format
await editor.registerFormat({
  id: 'blog',
  label: 'Blog Editor',
  description: 'Optimized for blog posts',
  toolbar: [
    ['bold', 'italic', '|', 'link', 'image'],
    ['heading2', 'heading3', '|', 'bulletList', 'orderedList'],
    ['blockquote', '|', 'undo', 'redo'],
  ],
  textFormat: 'basic_html',
  allowedHtmlTags: ['p', 'br', 'h2', 'h3', 'strong', 'em', 'a', 'ul', 'ol', 'li', 'blockquote', 'img'],
  allowedHtmlAttributes: {
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height'],
  },
  settings: {
    enterMode: 'p',
    autoParagraph: true,
  },
  plugins: {
    image: { enabled: true },
  },
});

// Update format
await editor.updateFormat('blog', { label: 'Updated Label' });

// Delete format
await editor.deleteFormat('blog');
```

### Toolbar Buttons

```javascript
// Get button definition
const button = editor.getButton('bold');
// Returns: { id, label, icon, category, command, toggle, tags, shortcut }

// List all buttons
const buttons = editor.listButtons();

// List by category
const formattingButtons = editor.listButtons('formatting');

// List categories
const categories = editor.listButtonCategories();
// Returns: ['formatting', 'headings', 'lists', 'alignment', 'insert', 'blocks', 'tables', 'history', 'utilities']

// Register custom button
editor.registerButton({
  id: 'customEmbed',
  label: 'Embed Widget',
  icon: 'widget',
  category: 'insert',
  command: 'insertWidget',
  dialog: 'widget',
});
```

### Frontend Configuration

```javascript
// Get config for frontend editor initialization
const config = editor.getEditorConfig('full');

// Returns:
// {
//   format: { id, label },
//   toolbar: [
//     [{ type: 'button', id: 'bold', label: 'Bold', ... }, ...],
//     ...
//   ],
//   settings: { ... },
//   allowedHtmlTags: [...],
//   allowedHtmlAttributes: { ... },
//   plugins: { ... },
//   endpoints: {
//     mediaLibrary: '/admin/media/library/browse',
//     linkAutocomplete: '/api/content/search',
//     oembed: '/api/oembed',
//   },
// }
```

### Content Processing

```javascript
// Process content before saving
const processed = await editor.processContent(htmlContent, 'basic');

// This:
// 1. Resolves media embeds: <media-embed data-media-id="..."> → actual embed
// 2. Resolves oembeds: <oembed url="..."> → actual embed
// 3. Sanitizes via text format service
```

## Button Categories

| Category | Buttons |
|----------|---------|
| `formatting` | bold, italic, underline, strikethrough, subscript, superscript, code |
| `headings` | heading1-6, paragraph |
| `lists` | bulletList, orderedList, indent, outdent |
| `alignment` | alignLeft, alignCenter, alignRight, alignJustify |
| `insert` | link, unlink, image, media, video |
| `blocks` | blockquote, codeBlock, horizontalRule |
| `tables` | table, tableAddRow*, tableAddColumn*, tableDelete* |
| `history` | undo, redo |
| `utilities` | clearFormatting, source, fullscreen, specialCharacters |

## CLI Commands

```bash
# List editor formats
node index.js editor:formats

# List toolbar buttons
node index.js editor:buttons
node index.js editor:buttons --category=formatting

# Show format config as JSON
node index.js editor:config basic
```

## Admin Routes

| Route | Description |
|-------|-------------|
| `GET /admin/editor` | Format management UI |
| `GET /admin/editor/config/:format` | Get format config as JSON |

## Configuration

In `config/site.json`:

```json
{
  "editor": {
    "enabled": true,
    "defaultFormat": "basic",
    "sanitizeOnSave": true,
    "processMediaEmbeds": true,
    "processOembeds": true
  }
}
```

## Hooks

| Hook | Trigger |
|------|---------|
| `editor:beforeRegisterFormat` | Before registering format |
| `editor:afterRegisterFormat` | After registering format |
| `editor:beforeProcess` | Before processing content |
| `editor:afterProcess` | After processing content |

## Frontend Integration

Example with a generic editor:

```javascript
// Fetch config from API
const response = await fetch('/admin/editor/config/full');
const config = await response.json();

// Initialize your editor with the toolbar
const editor = new MyEditor({
  toolbar: config.toolbar.map(row => 
    row.map(btn => btn.type === 'separator' ? '|' : btn.id)
  ),
  // ... other config
});

// On save, POST to your content endpoint
// Server will process via editor.processContent()
```
