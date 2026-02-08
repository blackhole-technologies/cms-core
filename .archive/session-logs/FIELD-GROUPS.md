# CMS-Core Field Groups Feature Set

**Status:** Features created, ready for implementation
**Feature Count:** 7
**Category:** Field Infrastructure & Display

## Overview

Field groups provide advanced field organization and display capabilities, allowing fields to be grouped into logical sections with various visual formatters (fieldsets, tabs, accordions, collapsible details).

## Feature Breakdown

### Feature 0: Field Group Definition and Storage Service
**Priority:** Infrastructure (index 0)
**Description:** Core service for defining and storing field group configurations

**Key Capabilities:**
- CRUD operations for field groups
- Support for nested groups (groups within groups)
- Hierarchical structure management
- Per-entity-type/bundle/mode configuration

**Implementation Requirements:**
- SQLite table: `field_groups`
- Fields: id, entity_type, bundle, mode, group_name, label, format_type, format_settings, parent_name, weight, children
- Service pattern: name, init, register exports
- Validation: unique group_name per entity_type/bundle/mode

### Feature 1: Fieldset Group Formatter
**Depends on:** Feature 0
**Description:** HTML `<fieldset>/<legend>` formatter for field groups

**Key Capabilities:**
- Semantic HTML fieldset rendering
- Nested fieldset support
- Collapsible option
- Custom classes and attributes

### Feature 2: Tab Group Formatter (Horizontal/Vertical)
**Depends on:** Feature 0
**Description:** Tab-based field group display with orientation support

**Key Capabilities:**
- Horizontal and vertical tab layouts
- ARIA-compliant tab navigation
- Keyboard navigation (arrow keys, Home, End)
- Default tab configuration
- Nested group support

### Feature 3: Accordion Group Formatter
**Depends on:** Feature 0
**Description:** Collapsible accordion-style field group display

**Key Capabilities:**
- Single-expand mode (only one section open)
- Multi-expand mode (multiple sections open)
- Smooth animations
- Default open state configuration
- Keyboard navigation

### Feature 4: Details/Collapsible Group Formatter
**Depends on:** Feature 0
**Description:** Native HTML `<details>/<summary>` collapsible groups

**Key Capabilities:**
- Native browser collapse/expand
- Open/closed default state
- Nested details support
- Custom styling hooks

### Feature 5: Display Mode Group Configuration
**Depends on:** Features 0, 1, 2, 3, 4
**Description:** Per-display-mode field group configuration

**Key Capabilities:**
- Different group configurations per display mode (default, teaser, search_result, full)
- Custom display mode registration
- Mode-specific formatter selection
- Display context awareness

### Feature 6: Admin Route - Field Group Management
**Depends on:** Features 0, 1, 2, 3, 4, 5
**Description:** Admin UI for managing field groups per entity

**Key Capabilities:**
- Visual group creation/editing interface
- Drag-and-drop field assignment
- Drag-and-drop group reordering
- Nested group creation (visual hierarchy)
- Live preview pane with sample data
- Format-specific settings panels

**Routes:**
- GET `/admin/structure/entity/:entity_type/:bundle/field-groups/:mode`
- POST `/api/field-groups` (save configuration)

## CLI Commands

```bash
# Create a field group
node index.js field-group:create \
  --entity-type=node \
  --bundle=article \
  --mode=default \
  --name=test_group \
  --label='Test Group' \
  --format=fieldset

# List field groups
node index.js field-group:list \
  --entity-type=node \
  --bundle=article \
  --mode=teaser
```

## API Endpoints

```bash
# Get field groups for entity type/bundle/mode
GET /api/field-groups?entity_type=node&bundle=article&mode=teaser

# Create/update field group
POST /api/field-groups
{
  "entity_type": "node",
  "bundle": "article",
  "mode": "default",
  "group_name": "contact_info",
  "label": "Contact Information",
  "format_type": "fieldset",
  "format_settings": {
    "classes": ["contact-group"],
    "description": "Contact details for this article"
  },
  "children": ["field_email", "field_phone", "field_address"]
}
```

## Implementation Architecture

### Service Pattern
All components follow the CMS-Core service pattern:

```javascript
export const name = 'fieldGroup';
export function init(context) { /* database setup */ }
export function register(context, state) { /* register hooks */ }
```

### Formatter Pattern
Formatters implement a consistent interface:

```javascript
export function render(group, fields, entity) {
  // Returns HTML string
}
```

### Database Schema
```sql
CREATE TABLE field_groups (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,
  bundle TEXT NOT NULL,
  mode TEXT NOT NULL,
  group_name TEXT NOT NULL,
  label TEXT NOT NULL,
  format_type TEXT NOT NULL,
  format_settings TEXT, -- JSON
  parent_name TEXT,
  weight INTEGER DEFAULT 0,
  children TEXT, -- JSON array
  UNIQUE(entity_type, bundle, mode, group_name)
);
```

## Development Workflow

1. **Feature 0** must pass first (infrastructure)
2. **Features 1-4** can be implemented in parallel (formatters)
3. **Feature 5** depends on all formatters
4. **Feature 6** is the final integration (admin UI)

## Testing Strategy

Each feature includes comprehensive testing steps:
- Unit tests for service methods
- Integration tests for formatters
- Browser tests for UI components
- CLI verification tests
- API endpoint tests

## Next Steps

Run the implementation agent to begin feature development:

```bash
# Features are stored in SQLite database
# Check feature status:
node -e "console.log(require('better-sqlite3')('features.db').prepare('SELECT * FROM features').all())"

# Or use the MCP tools via Claude Code
```

---

**Created:** 2026-02-08
**Project:** cms-core
**Phase:** Field group infrastructure and display enhancements
