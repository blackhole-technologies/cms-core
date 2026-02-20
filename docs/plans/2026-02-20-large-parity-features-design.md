# Large Parity Features Design

**Date:** 2026-02-20
**Features:** ECA Enhancement, Webform Builder, Experience Builder

---

## 1. ECA Enhancement

**Existing:** `core/actions.js` (events, conditions, actions, rules, execution, scheduling, logging), `core/conditions.js` (plugin system with AND/OR/NOT).

**Work:**
- Wire hook events to rule triggers in boot.js READY phase
- Add 15+ built-in events, 10+ conditions, 10+ actions
- Admin UI: form-based rule builder at `/admin/eca`
- No BPMN visual modeler (form-based MVP)

**Files:** `core/actions.js` (extend), `core/boot.js` (wire), `modules/admin/index.js` (routes), `modules/admin/templates/eca-*.html` (3 templates)

---

## 2. Webform Builder

**Existing:** `core/form.js` (18 element types, FormBuilder, FormState), `core/contact.js`, `core/fields.js` (conditional visibility).

**Work:**
- New `core/webform.js`: webform entities, element types, conditionals, multi-step, submissions, CSV export, email/webhook handlers
- Storage: `config/webforms/<id>.json`, `content/webform-submissions/<formId>/<ts>.json`
- Admin UI: form builder with drag-reorder, element config, handler config
- Public: `GET/POST /form/:id`

**Files:** New `core/webform.js`, `modules/admin/index.js` (routes), `modules/admin/templates/webform-*.html` (4 templates), `public/js/webform-builder.js`

---

## 3. Experience Builder (Visual Drag-Drop)

**Existing:** `core/layout-builder.js` (sections, layouts, components), `core/sdc.js` (component discovery).

**Work:**
- Visual canvas at `/admin/experience-builder/:type/:id`
- Component browser sidebar (SDC + blocks), search/filter, drag onto canvas
- Vanilla JS HTML5 DnD API, sortable within regions
- Component config panel from `component.json` schema
- Section add/reorder/delete, iframe live preview
- Saves to existing `_layout` field via layout-builder storage

**Files:** New `public/js/experience-builder.js`, `public/css/experience-builder.css`, `modules/admin/templates/experience-builder.html`, `modules/admin/index.js` (routes), `core/layout-builder.js` (extend API)

---

## Implementation Order

1. ECA Enhancement (extends existing code, lowest risk) — **DONE**
2. Webform Builder (new module, medium complexity) — **DONE**
3. Experience Builder (most frontend JS, highest complexity) — **DONE**

---

## Implementation Summary

### ECA Enhancement (completed)
- Extended `core/actions.js` with 14 events, 11 conditions, 15 actions
- Added `wireHooks()` bridging CMS lifecycle hooks to ECA rule engine
- Wired in `core/boot.js` READY phase
- Admin UI: `eca-list.html`, `eca-edit.html` with dynamic rows via `<template>` elements
- 6 admin routes at `/admin/eca/*`

### Webform Builder (completed)
- New `core/webform.js` (530+ lines): 15 element types, 8 conditional operators, multi-step via page_break, server-side validation, CSV export, email/webhook handlers, public HTML rendering
- Storage: `config/webforms/<id>.json`, `content/webform-submissions/<formId>/<id>.json`
- Admin UI: `webform-list.html`, `webform-edit.html`, `webform-submissions.html`
- 12 admin routes at `/admin/webforms/*`
- 2 public routes: `GET/POST /form/:id`
- Registered in boot.js as `webform` service

### Experience Builder (completed)
- New `public/js/experience-builder.js` (480+ lines): HTML5 DnD, component browser sidebar with search, section management, component placement/reorder/removal, save via JSON API
- New `public/css/experience-builder.css`: full layout for sidebar + canvas + modals
- New `modules/admin/templates/experience-builder.html`
- 5 admin routes: editor page + 4 JSON API endpoints (`/admin/xb/*`)
- Integrates with existing `layout-builder.js` for storage and `blocks`/`sdc` services for components
- Sidebar links added to admin layout for all three features
