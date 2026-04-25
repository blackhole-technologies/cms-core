# ADR-001: Field API — base fields + configurable fields split

## Status
Accepted (2026-04-25)

## Context
Storage of fields on entities admits three approaches:

- **Column-per-field** (Payload's default for SQL): fast, indexable, but every field addition requires a schema migration. Rigid in the face of editorial schema evolution.
- **All-jsonb** (Sanity's default): flexible, no migrations, but unqueryable without per-content-type custom indexing. Aggregate queries (faceted search, sorts) get expensive.
- **Hybrid: base columns + per-field side tables** (Drupal): base fields like `title`, `status`, `author_id` are columns on the entity table; configurable fields like `body`, `gallery`, `blocks` get their own side tables.

A top-tier CMS needs *both* indexability and flexibility. Column-per-field rules out mid-production schema evolution; all-jsonb rules out the kind of queries Views and Releases will need.

## Decision
Adopt Drupal's hybrid model.

- Base fields per entity type live on `content_<type>` tables: e.g. `content_article(uuid, title, slug, status, author_id, created, updated)`.
- Configurable fields get a per-field side table: `field_body(entity_type, entity_id, revision_id, bundle, delta, langcode, value, format)`.
- `delta` handles cardinality — one row per value for unlimited-cardinality fields. Unique constraint on `(entity_type, entity_id)` enforces single-cardinality where appropriate.
- Multi-column fields (rich text with `value` + `format`) get multiple `value_*` columns in the side table.
- A `FieldStorageSchemaBuilder` service emits the DDL from field definitions.

## Consequences

**Positive:**
- Indexable (base) and flexible (configurable) at the same time.
- Schema changes for new configurable fields are additive — no migration of existing rows.
- Unlimited cardinality and localization fall out of the model via `delta` and `langcode`.

**Negative:**
- Configurable-field reads require a join to the side table.
- The schema-builder is non-trivial: it owns DDL emission and migration generation.
- No Node CMS has shipped this — we're building from Drupal's PHP source as the reference.

## References
- Drupal source: `core/lib/Drupal/Core/Field/FieldItemInterface.php`
- Drupal source: `core/lib/Drupal/Core/Entity/Sql/SqlContentEntityStorageSchema.php`
- Roadmap: Phase 2 PRs 2.4, 2.5, 2.11
