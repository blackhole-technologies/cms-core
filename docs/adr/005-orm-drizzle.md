# ADR-005: ORM — drizzle-orm

## Status
Accepted (2026-04-25)

## Context
SQL access layer choice for cms-core.

- **Raw `pg`**: fastest, untyped, no schema-as-code. Manual joins, manual mapping.
- **Prisma**: best typing, but a Rust engine binary (slow startup, awkward in serverless), separate codegen step required.
- **Mongoose-style adapters** (Payload v2 era): heavier abstraction; Payload v3 migrated *off* this pattern.
- **Drizzle**: schema-as-code in TS, types derived without codegen, supports Postgres / SQLite / MySQL with the same API. Smaller than Prisma; no Rust binary.

Payload v3 migrated all SQL databases to Drizzle in 2024, providing a large CMS-shaped reference codebase.

## Decision
Adopt drizzle-orm as the query layer.

- Schema lives in `src/core/storage/schema/*.ts` as Drizzle table definitions.
- Types are derived directly from the schema (`InferSelectModel<typeof articles>`); no codegen step.
- Repository layer wraps Drizzle: lint rule blocks `db.select()` outside `src/core/storage/repositories/*`.
- The `DatabaseAdapter` interface (Payload pattern, see ADR-007) sits *above* Drizzle, allowing future adapters (e.g., a planetscale-style Vitess adapter) without touching application code.

## Consequences

**Positive:**
- Type-safe queries from schema — no codegen step, no separate `prisma generate`.
- Postgres-first usage leverages jsonb, GIN, FTS, LISTEN/NOTIFY — all stack-aligned.
- Adopted by Payload v3 — a large reference implementation in our problem space.
- Schema-as-code reviewable in PRs.

**Negative:**
- Drizzle's API is younger than Prisma's; advanced features (e.g., row-level security helpers) are still landing.
- Migrations split across two tools (drizzle-kit dev + Atlas prod, see ADR-006) instead of one.
- No first-party visual schema browser (Prisma Studio, etc).

## References
- orm.drizzle.team
- Payload source: `packages/db-postgres/src/index.ts`
- Payload source: `packages/drizzle/src/schema/buildDrizzleTable.ts`
- Roadmap: T1; Phase 2 PR 2.1
