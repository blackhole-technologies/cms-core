# ADR-003: Config Management with UUIDs and dependency graph

## Status
Accepted (2026-04-25)

## Context
Config (content types, roles, views, menus) needs to round-trip across environments without breaking references when entities are renamed.

- **Code-only config** (Payload): git-friendly, but no mid-production schema evolution story — editor-side changes to content types require a redeploy.
- **SaaS config** (Sanity, Contentful): no git workflow at all. Schema lives in the vendor's UI; PR review impossible.
- **Drupal Config Management**: every config entity has a UUID; every exported YAML declares `dependencies: { config: [...], module: [...] }`; import does topological sort + three-way diff. The only model that survives rename-refactor-redeploy in production.

Renames that break references is the canonical breakage mode. UUID identity is what fixes it.

## Decision
Adopt Drupal's Config Management pattern.

- Every config entity gets a UUID column (backfill migration on existing data).
- Export command walks the active config store and emits `config/sync/{type}.{uuid}.yaml`.
- SHA256 manifest at `config/sync/.manifest` detects tampering.
- Three-way diff engine: active vs sync vs last-imported. Topological-sort import in dependency order.
- Partial import by subtree works (CLI: `cms config:import --only=content_type.article`).
- CI gate: `config/sync/` hash must match runtime state on the `next` branch.

## Consequences

**Positive:**
- Renames don't break references — UUID is the stable identifier.
- Config changes are PR-reviewable as YAML diffs.
- Partial subtree imports enable selective config promotion.
- Differentiator: no Node CMS has this in 2026.

**Negative:**
- UUID-everywhere requires a backfill migration for existing config.
- The three-way diff engine is non-trivial; budget weeks.
- Editorial users of Sanity/Contentful won't expect "edit in code, push, redeploy" semantics — needs onboarding.

## References
- Drupal source: `core/lib/Drupal/Core/Config/ConfigImporter.php`
- Drupal source: `core/lib/Drupal/Core/Config/ConfigInstaller.php`
- Drupal source: `core/lib/Drupal/Core/Config/Entity/ConfigEntityBase.php`
- Roadmap: Phase 4
