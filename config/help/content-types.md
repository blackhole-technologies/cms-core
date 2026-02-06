---
title: Content Types
module: admin
route: /admin/config/content-types
related: content-management, fields, workflow
keywords: content type, schema, fields, structure
---

## Content Types

Content types define the structure and fields for different kinds of content on your site.

### What is a Content Type?

A content type is a template that defines:
- What fields are available
- Field types and validation rules
- Workflow settings
- Display options

Common examples: **Article**, **Page**, **Event**, **Product**

### Creating a Content Type

1. Go to **Admin > Config > Content Types**
2. Click **Create Content Type**
3. Enter a name and machine name
4. Configure default settings
5. Add fields to your type

### Field Types

Each content type can have multiple fields:

- **Text** - Short text inputs
- **Textarea** - Long text content
- **Number** - Numeric values
- **Date** - Date/time values
- **Boolean** - Yes/no checkboxes
- **Select** - Dropdown selections
- **Reference** - Links to other content

### Field Configuration

For each field you can configure:
- **Label** - Display name
- **Required** - Must be filled in
- **Default value** - Pre-populated value
- **Validation** - Rules and constraints
- **Help text** - Guidance for editors

### Content Type Settings

- **Workflow** - Enable approval workflows
- **Revisions** - Track content history
- **Comments** - Allow user comments
- **URL Pattern** - How URLs are generated

### Best Practices

- Keep content types focused on one purpose
- Use clear, descriptive field names
- Provide help text for complex fields
- Plan your content structure before creating types
