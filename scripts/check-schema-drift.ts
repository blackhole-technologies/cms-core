#!/usr/bin/env node
/**
 * Schema-drift check — placeholder.
 *
 * WHY this file exists NOW:
 *   Invariant #6 of the top-tier roadmap ("CI is the truth") requires schema-drift
 *   to be a required status check from Phase 0 forward. The real check — comparing
 *   committed Drizzle schema against a pg_dump of the migrated database — lands
 *   in Phase 2 (PR 2.2 wires the real check). Until then, this placeholder
 *   occupies the CI slot so the pipeline shape is final from the start.
 *
 * WHAT it does today:
 *   Succeeds, prints a marker line. Exit 0.
 *
 * WHAT it will do once wired up in Phase 2 PR 2.2:
 *   - Run all pending migrations against a throwaway Postgres instance.
 *   - pg_dump --schema-only the result.
 *   - Compare against the committed schema snapshot (ops/schema-snapshot.sql).
 *   - Fail on any textual diff. This catches the "schema was modified via hotfix
 *     ALTER TABLE on prod and the code forgot" class of bug at PR-review time.
 *
 * See: docs/plans/2026-04-24-top-tier-roadmap.md (Phase 0 PR 0.3 + Phase 2 PR 2.2).
 */

console.log('schema-drift: placeholder (real check wires in Phase 2 PR 2.2)');
process.exit(0);
