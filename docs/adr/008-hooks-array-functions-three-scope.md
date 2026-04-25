# ADR-008: Hooks — array-of-functions, three-scope model

## Status
Accepted (2026-04-25)

## Context
Lifecycle extension points are central to CMS extensibility.

- **WordPress filter/action API**: dynamic, untyped, ordering via integer priority, registration ceremony (`add_action`).
- **Drupal `hook_*`**: function-naming-convention magic; OOP attribute hooks landed in 11.1+ but pre-11 code is everywhere.
- **Payload's array hooks**: each hook key is a TS array of functions. Three scopes (config / collection / field). Order is array position. Adding a hook is `hooks.beforeChange.push(fn)`.

Field-scoped hooks are the killer feature: slug auto-population belongs on the slug field, not buried in a 200-line collection-level `beforeChange` switch.

## Decision
Adopt Payload's hook model.

- Each hook key is a TypeScript array of typed functions.
- Three scopes: `config.hooks` (global), `CollectionConfig.hooks`, `Field.hooks`.
- Lifecycle ordering for a create operation:
  ```
  beforeOperation
    → field beforeValidate → collection beforeValidate → validate
    → field beforeChange → collection beforeChange → DB write
    → field afterChange → collection afterChange
    → field afterRead → collection afterRead
  → afterOperation
  ```
- Plugins append to hook arrays without wrapper-hell.

## Consequences

**Positive:**
- Field-scoped hooks reduce collection-level complexity dramatically.
- Plugins compose by `hooks.beforeChange.push(fn)` — no registration API.
- Typed function signatures catch wrong hook usage at compile time.

**Negative:**
- Hook order is implicit in array position — convention required to avoid order-fragility bugs.
- The three-scope ordering takes onboarding to internalize.
- No built-in priority system (WordPress-style) — order is determined by registration order.

## References
- Payload source: `packages/payload/src/fields/hooks/`
- Payload source directories: `beforeValidate/`, `beforeChange/`, `afterChange/`, `afterRead/`
- Roadmap: Phase 5
