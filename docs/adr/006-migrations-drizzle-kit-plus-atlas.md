# ADR-006: Migrations — drizzle-kit (dev) + Atlas (prod)

## Status
Accepted (2026-04-25)

## Context
Schema migration strategy.

- **drizzle-kit alone**: schema-diff-based, fast for dev. Limited prod safety: no preflight linting (e.g., "this drops a non-empty column"), no shadow-database validation, no Kubernetes operator.
- **Atlas alone**: declarative-state, production-grade migrations with linting and a Kubernetes operator. Less ergonomic for the diff-as-you-edit dev loop.
- **Both, layered**: drizzle-kit for the dev loop (auto-generate from schema diff), Atlas for production (declarative state + lint gates).

## Decision
Use drizzle-kit and Atlas together.

- **Local dev**: `drizzle-kit generate` produces SQL migrations from schema changes. Fast iteration.
- **Production**: Atlas applies migrations with linting (catches dangerous DDL like `DROP COLUMN` on a non-empty table without explicit acknowledgment).
- Generated SQL files in `migrations/` are the artifact both tools consume — drizzle-kit emits them, Atlas applies them in prod.

## Consequences

**Positive:**
- Dev velocity: schema change → save TS → `drizzle-kit generate` → migration ready.
- Production safety: Atlas's lint rules block dangerous DDL before deploy.
- Atlas's Kubernetes operator integrates with future ops automation.

**Negative:**
- Two tools in the migration story instead of one. Onboarding tax.
- Migrations are SQL files, not auto-derived in prod — humans must review what drizzle-kit emits before it's applied.
- Atlas is a Go binary; CI runners need it installed.

## References
- orm.drizzle.team (drizzle-kit)
- atlasgo.io
- Roadmap: T2; Phase 2 PR 2.2
