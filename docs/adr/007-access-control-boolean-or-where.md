# ADR-007: Access control — `boolean | Where` pattern

## Status
Accepted (2026-04-25)

## Context
Authorization in CMS list endpoints. Two failure modes to avoid:

- **Load-then-check N+1**: WordPress and Drupal's traditional entity_access hook load each row, run permission checks, drop denied rows. For a 100-row list endpoint with relationships, this can fire thousands of permission checks.
- **List-without-auth**: skip per-row checks for performance, expose denied content. Worse than slow.

Payload's `Access` type sidesteps both: an access function returns `true | false | Where`. The `Where` is **pushed into the SQL query**, not applied row-by-row in application code.

## Decision
Adopt Payload's `Access` pattern.

- An access function takes `{ req, doc? }` and returns `true | false | Where`.
- `true` = allow all rows; `false` = deny everything; `Where` = filter the SQL query.
- List endpoints transparently filter to visible rows. Single-doc endpoints `false` → 403 / `Where` → 404 if doc doesn't match.
- Field-level access applied during serialization in `afterRead` — one schema serves admin / editor / public without duplicate DTOs.
- Default-deny middleware on `/admin/*`; routes must declare `permissions` metadata or fail lint.

```ts
const readAccess: Access = ({ req: { user } }) => {
  if (!user) return { _status: { equals: 'published' } }
  if (user.role === 'admin') return true
  return { or: [{ _status: { equals: 'published' } }, { author: { equals: user.id } }] }
}
```

## Consequences

**Positive:**
- Authorization composes with WHERE clauses at SQL — no N+1 of permission checks.
- One schema serves all audiences via field-level access in serialization.
- Replaces Drupal's slower entity_access hook chain.

**Negative:**
- `Where → SQL` translator becomes a hot code path; needs fuzz testing (Phase 2 PR 2.9).
- Field-level access in `afterRead` means denied fields are *computed then stripped* — not stripped at the SQL layer.
- Role-based shortcuts must compose with `Where` — careful design required.

## References
- Payload source: `packages/payload/src/auth/types.ts`
- Payload source: `packages/payload/src/collections/operations/find.ts`
- Roadmap: Phase 5
