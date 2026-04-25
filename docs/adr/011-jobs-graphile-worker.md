# ADR-011: Background jobs — graphile-worker

## Status
Accepted (2026-04-25)

## Context
Background job queue for scheduled-publish, webhook delivery, email send, image derivation, search-index updates.

- **BullMQ**: Redis-backed, broadly adopted, mature. Adds a Redis dependency to the stack.
- **pg-boss**: Postgres-backed, polling-based (default 2-second interval). Stays on Postgres-only stack but pickup latency is bounded by polling.
- **graphile-worker**: Postgres-native, **LISTEN/NOTIFY-based**. Sub-5ms job pickup latency. ~196k jobs/sec on competent hardware. Author Benjie Gillam (PostGraphile maintainer).

The North Star is Postgres-only. Adding Redis just for jobs would violate that principle. graphile-worker is the only Postgres-native option that achieves Redis-level pickup latency.

## Decision
Adopt graphile-worker.

- Job table created via graphile-worker's migrations.
- `src/core/storage/jobs.ts` registers typed task definitions.
- Each task is a function `(payload, helpers) => Promise<void>` with typed payload via Zod.
- Jobs landing in Phase 13: scheduled publish, webhook delivery, email send, image derivation, search-index update.

## Consequences

**Positive:**
- Stays on Postgres-only stack — no Redis dependency.
- Sub-5ms pickup means scheduled-publish feels real-time to editors.
- Throughput far exceeds CMS-realistic workloads.
- Excellent code quality — Benjie Gillam's libraries are reference-grade.

**Negative:**
- LISTEN/NOTIFY connections are long-lived; pool sizing matters more than for polling.
- Smaller community than BullMQ; rarer Stack Overflow answers.
- Postgres failover semantics for in-flight jobs need careful testing.

## References
- worker.graphile.org
- pg-boss (compared alternative): github.com/timgit/pg-boss
- Roadmap: T5; Phase 13
