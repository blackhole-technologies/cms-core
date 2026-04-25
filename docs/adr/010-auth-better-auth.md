# ADR-010: Auth — better-auth (over Lucia)

## Status
Accepted (2026-04-25)

## Context
Sessions and authentication library choice for a TS CMS in 2026.

- **Lucia**: was the canonical TS-first auth library. **Archived March 2025** by its author (Pilcrow). New Lucia projects are not recommended.
- **NextAuth / Auth.js**: framework-coupled (Next.js-first), opinionated about session storage, harder to use outside Next.
- **better-auth** (Bereket Engida): the community-converged successor to Lucia. Drizzle / Prisma / Kysely adapters, Postgres-backed sessions, OAuth, 2FA, passkeys, organizations. TS-native, framework-agnostic.
- **Hand-rolled**: never the right answer for a CMS; auth bugs are CVE territory.

## Decision
Adopt better-auth with the Drizzle adapter.

- Session table in Postgres: `sessions(id, user_id, created, expires, last_seen, user_agent, ip, revoked, device_label)`.
- Signed cookie holds the session id reference, not state.
- Enables: force-logout, per-user session listing, credential-change revocation, multi-instance deployment.
- 2FA TOTP and passkeys land flag-gated in Phase 10.
- First-run admin setup wizard refuses to complete without a ≥ 14-character strong password — the `admin/admin` default is removed at the same time.

## Consequences

**Positive:**
- Postgres-backed sessions enable enterprise behaviors (force-logout, audit, multi-instance) for free.
- 2FA + passkey roadmap is built-in, not a third-party patchwork.
- Active maintenance — community-converged successor to Lucia is the safest 2026 bet.

**Negative:**
- Younger than Lucia; smaller community, though growing fast post-Lucia archival.
- Migration path from custom auth (current cms-core) needs careful planning — Phase 10 PRs 10.1–10.9.
- API surface still settling (recent breaking changes in 1.x).

## References
- better-auth.com
- Lucia archival announcement: github.com/pilcrowOnPaper/lucia (March 2025)
- Roadmap: T4; Phase 10
