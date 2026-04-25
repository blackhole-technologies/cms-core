# ADR-012: Search — Postgres FTS default + provider interface

## Status
Accepted (2026-04-25)

## Context
Full-text search for CMS content.

- **Postgres FTS** (`tsvector` + GIN): bundled, no extra infrastructure. Scales to ~1M rows comfortably for plain-language search; weakens on typo tolerance, faceted search at high cardinality, and relevance tuning.
- **Meilisearch / Typesense**: typo-tolerant, fast facets, schemaless ingestion. Add an external service.
- **OpenSearch / Elasticsearch**: enterprise-grade, heavyweight to operate, overkill for default case.

Most cms-core deployments will be small-to-medium and Postgres FTS will be sufficient. The minority that need scale-out search shouldn't drag the dependency surface up for everyone.

## Decision
Default search to Postgres FTS, with a `SearchProvider` interface for swap-out.

- Per-content-type `tsvector` column maintained via `afterSave` hook + GIN index.
- Query via `websearch_to_tsquery` (handles natural-language operators).
- `SearchProvider` interface mirrors the `UploadAdapter` pattern (ADR-007 family): `index`, `delete`, `query`, `bulkReindex` methods.
- First-party reference adapter: `@cms-core/search-meilisearch` for scale-out cases.
- Default ships with Postgres FTS adapter; configuration swap doesn't change application code.

## Consequences

**Positive:**
- Out-of-box no-extra-infrastructure search.
- Provider swap on growing deployments doesn't refactor application code.
- Stays on Postgres-only stack for the default case.

**Negative:**
- Typo tolerance at scale requires the Meilisearch adapter; teams that need it out-of-the-box may pick a competitor.
- Postgres FTS hits walls at ~1M rows for faceted search and relevance tuning — operators need to know when to swap.
- Index maintenance via `afterSave` hook adds a small write-path cost.

## References
- postgresql.org/docs/current/textsearch.html
- meilisearch.com (reference third-party adapter)
- Roadmap: T6; Phase 13
