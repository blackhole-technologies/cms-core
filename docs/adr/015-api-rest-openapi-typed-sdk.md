# ADR-015: API shape — REST + OpenAPI + typed SDK; GraphQL as plugin

## Status
Accepted (2026-04-25)

## Context
API style for CMS delivery.

- **GraphQL**: dominated CMS delivery 2018–2022 (Sanity, Contentful). Adoption now declining relative to REST + typed clients + framework Server Actions in 2026 (Payload's internal tracking; ecosystem evidence). Operational complexity (N+1, query-cost analysis, persistent queries) is substantial.
- **REST + OpenAPI + auto-generated typed SDK**: deterministic caching (URLs are cache keys), typed client ergonomics rival GraphQL when the SDK is generated from an OpenAPI spec.
- **tRPC**: TS-only, framework-coupled. Wrong for a CMS that has non-TS consumers.

Three usage tiers exist for any CMS API and they have different caching/auth profiles:

- **Delivery** (published content): aggressive caching, API-token auth, rate-limited per-token.
- **Preview** (drafts): bypass cache, short-lived JWT.
- **Admin** (full CRUD): session auth, CSRF, audit-logged.

These map cleanly to three route prefixes.

## Decision
REST + OpenAPI + typed SDK as the primary API shape; GraphQL as an optional plugin.

- Three route prefixes with distinct policies:
  - `/api/delivery/*` — published only, `Cache-Tag` header, API-token auth, rate-limited.
  - `/api/preview/*` — drafts + published, JWT auth, bypass cache.
  - `/api/admin/*` — full CRUD, session auth, CSRF, audit-logged.
- Core operations as pure functions in `src/core/entities/operations/*.ts`: `findByID`, `find`, `create`, `update`, `delete`, `findMany`. REST routes and (optional) GraphQL resolvers are thin wrappers over the same operation functions — zero duplication.
- Auto-generated OpenAPI spec from operation signatures.
- Auto-generated typed TS SDK in `@cms-core/sdk`.
- GraphQL extracted to `@cms-core/plugin-graphql` for the minority that need it.

## Consequences

**Positive:**
- Three tiers map cleanly to caching and auth — no per-route ad-hoc rules.
- Typed SDK ergonomics rival GraphQL's typed client.
- Same operation function serves all transports — single source of truth.
- REST URLs are CDN-cache-key-friendly out of the box.

**Negative:**
- Sanity migrators expect GraphQL — plugin gives them a path but adds setup.
- OpenAPI spec generation must stay in lockstep with operation signatures.
- Typed SDK regeneration becomes a release-step ritual.

## References
- Payload source: `packages/payload/src/collections/operations/`
- Payload source: `packages/next/src/routes/rest/`
- Contentful three-API split: contentful.com/developers/docs/references/content-management-api/
- Roadmap: T11; Phase 14
