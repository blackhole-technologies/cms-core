# ADR-004: Schema-as-code via TypeScript config object

## Status
Accepted (2026-04-25)

## Context
Three approaches to defining content schema:

- **Admin-UI-driven** (Drupal, Craft): schema lives in the database, editable through the UI. Versionable only via Drupal's Config Management YAML export. The UI is source of truth.
- **Code-only** (Keystone, early Payload): schema is a TS object in the repo. Codebase is source of truth. No admin schema-builder UI.
- **Code-with-admin-builder** (Payload v3): TS config object is source of truth, but a schema-builder UI emits config files into the repo. Best of both — devs get git, editors get a UI that doesn't fork from code.

The discriminated-union typing of fields (`Field` keyed on `type`) gives type-safe field configs without manual narrowing.

## Decision
Adopt Payload's `CollectionConfig` pattern.

- Schema is a TypeScript config object: `{ slug, fields, hooks, access, versions, admin }`.
- Single source of truth drives DB schema generation, admin UI rendering, REST routes, GraphQL types (when plugin enabled), and the generated TS client SDK.
- The `Field` type is a discriminated union keyed on `type` — `text`, `richText`, `relationship`, `blocks`, etc.
- An admin-first schema-builder UI exists (Drupal-parity), but **emits a `CollectionConfig` file into the repo**. Codebase is source of truth, UI is convenience.

## Consequences

**Positive:**
- Codebase is the source of truth; PRs review schema changes.
- Generated TS client = zero drift between server and client types.
- Plugin authors compose new fields/collections by mutating the config object.
- One schema, many transports (REST + GraphQL + admin UI).

**Negative:**
- Editors who only know the UI are constrained when ops want to edit code-side.
- Reflection-style introspection (Drupal-style admin-builds-config-from-DB) requires the schema-builder UI to also write back to the repo — non-trivial.
- TS-only — no escape hatch for non-TS plugin authors.

## References
- Payload source: `packages/payload/src/collections/config/types.ts`
- Payload source: `packages/payload/src/fields/config/types.ts`
- Roadmap: Phase 2, Phase 5
