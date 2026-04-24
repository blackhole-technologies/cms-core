# cms-core Top-Tier Roadmap to 1.0

**Date:** 2026-04-24
**Status:** Active — approved blueprint, awaiting Phase 0 PR 0.1
**Supersedes:** `docs/plans/2026-02-22-typescript-port.md` (absorbs its in-flight work into Phase 1; see [Relationship to prior plans](#relationship-to-prior-plans))

---

## Contents

- [North Star](#north-star)
- [The Three Drupal Innovations That Are the Differentiator](#the-three-drupal-innovations-that-are-the-differentiator)
- [Architectural Blueprint — System by System](#architectural-blueprint--system-by-system)
- [Tooling & Infrastructure Decisions](#tooling--infrastructure-decisions)
- [Guiding Principles (The Invariants)](#guiding-principles-the-invariants)
- [Implementation Plan — 16 Phases](#implementation-plan--16-phases)
- [Phase Dependency Graph](#phase-dependency-graph)
- [Relationship to Prior Plans](#relationship-to-prior-plans)
- [References & Citations](#references--citations)

---

## North Star

cms-core becomes the first Node.js + TypeScript CMS that ships Drupal's three hardest-to-replicate patterns — **Cache Tags**, **Config Management with UUIDs + dependency graph**, and **Field API with base-plus-configurable storage split** — on top of a Payload-class developer experience (code-first schema, typed access control, function-composition plugins) and a Postgres-only stack (no Redis, no external job queue, no external search by default).

The TypeScript port is the throughline, not a separate project. Every file that exists as `.js` at the start of this plan either (a) ports to `.ts` during its feature phase, split if it exceeds size ceilings, or (b) gets deleted if its replacement supersedes it.

**Success criteria for 1.0:**
- Zero `.js` files in `src/`
- Postgres-only runtime (optional S3-compat for media, optional Meilisearch for search at scale)
- Cache Tags operational end-to-end (entity mutation → GIN-indexed invalidation → CDN `Cache-Tag` header)
- Config Management with UUID round-trip verified against rename-refactor scenarios
- Field API with per-field side tables and unlimited cardinality via `delta` column
- 80%+ test coverage on `src/core/{security,entities,storage,cache,config}`
- Admin largest file < 800 LOC (split from the current 17,545-line `modules/admin/index.js`)
- WCAG 2.2 AA passing on 20 top admin routes
- Load-tested P99 < 100ms at 10k entities, < 300ms at 100k, < 1s at 1M
- Threat-modeled (STRIDE per subsystem) with a security test suite covering every surface

---

## The Three Drupal Innovations That Are the Differentiator

Most of the blueprint that follows is Payload-shaped because Payload is the architectural benchmark for a TS-first CMS. Three Drupal patterns have **no serious implementation in any Node CMS today**, and implementing them is how cms-core leapfrogs Payload rather than chases it.

### 1. Cache Tags with bubbleable metadata

Drupal's render pipeline propagates cacheability up the tree — a node teaser inside a listing inside a page emits `['node:123', 'node:456', ...]` all the way to the HTTP response's `X-Drupal-Cache-Tags` header. One `Cache::invalidateTags(['node:123'])` call invalidates every cached render that used it, across every cache bin and every CDN via `Surrogate-Key`.

- Source: `core/lib/Drupal/Core/Cache/Cache.php`, `core/lib/Drupal/Core/Render/BubbleableMetadata.php`, `core/lib/Drupal/Core/Cache/CacheableMetadata.php`
- No Node CMS has this. Payload has per-query cache invalidation but no tag propagation. Sanity caches on its delivery edge with opaque TTLs.
- **cms-core implementation plan:** Phase 3. `cache_entries(cache_key TEXT PRIMARY KEY, payload JSONB, tags TEXT[], expires_at TIMESTAMPTZ)` with a GIN index on `tags`. A `CacheableRenderContext` TS class accumulates tags during render. Invalidation is `DELETE FROM cache_entries WHERE tags && $1::text[]` — array-overlap with GIN is microsecond-fast. Hook wiring on `entity:afterSave/afterDelete` makes invalidation automatic.

### 2. Config Management with UUIDs + dependency graph

Every config entity carries a UUID; every exported YAML declares `dependencies: { config: [...], module: [...] }`; import does topological sort + three-way diff (active vs sync vs last-imported). Renames don't break references. Partial imports by subtree work. SHA256 manifest detects tampering.

- Source: `core/lib/Drupal/Core/Config/ConfigImporter.php`, `ConfigInstaller.php`, `Entity/ConfigEntityBase.php`
- Payload's config is code-only (good for version control, but no mid-production schema evolution story). Sanity's and Contentful's config is SaaS-side (no git workflow). Drupal's is the one that survives rename-refactor-redeploy cycles in production.
- **cms-core implementation plan:** Phase 4. UUID column on every config entity (backfill migration). Export command walks config, emits `config/sync/{type}.{uuid}.yaml`. Import parses, topologically sorts by dependencies, runs three-way diff, applies in dependency order. CLI: `cms config:export`, `cms config:import`, `cms config:diff`.

### 3. Field API — base fields (columns) + configurable fields (side tables)

Drupal stores `title`, `status`, `author` in `node_field_data` (base fields — columns on the entity table). But `field_body` gets its own `node__field_body` table with columns `entity_id, revision_id, bundle, delta, langcode, field_body_value, field_body_format`. `delta` handles cardinality — 1 row per value for unlimited-cardinality fields. Multi-column fields (like rich text with `value` + `format`) get multiple `value_*` columns in the side table.

- Source: `core/lib/Drupal/Core/Field/FieldItemInterface.php`, `core/lib/Drupal/Core/Entity/Sql/SqlContentEntityStorageSchema.php`
- Payload does column-per-field in Postgres (fast but rigid — schema changes on every field addition). Sanity stores everything as jsonb (flexible but unqueryable without custom indexing). Drupal's hybrid is the only model that's *both* indexable and flexible.
- **cms-core implementation plan:** Phase 2. Base tables per entity type (`content_article`) with base-field columns. Per-field side tables (`field_body`, `field_gallery`) generated from field definitions. `FieldStorageSchemaBuilder` service emits the DDL.

**Why these three, not more:** Drupal has dozens of clever patterns (render arrays, typed data, form API, views, migrate API). Most are either not uniquely Drupal's (render arrays are just React's virtual DOM in a different suit) or are complexity hits that don't justify their cost in a TS+Node context (typed data overlaps TS's type system; form API is heavier than needed for Zod-driven forms). These three are the ones that are (a) genuinely uninvented elsewhere in the Node CMS ecosystem, and (b) still deliver production value in 2026.

---

## Architectural Blueprint — System by System

Every subsystem names the platform it's derived from, with file paths or doc URLs. Where a pattern is adopted, adapted, or rejected, the reasoning cites the platform, not abstract trade-offs.

### Data model — Drupal Field API + Craft 5 nested entities

**Adopt:**
- **Entity types** (article, page, user, media) get a base table: `content_article` with columns for base fields (title, slug, status, author_id, created, updated, uuid).
- **Configurable fields** (body, gallery, blocks) get per-field side tables with `(entity_type, entity_id, revision_id, bundle, delta, langcode, value_*)`.
- **Nested entities (Matrix/Blocks)** — Craft 5's refactored model: blocks are full entity rows in the same `content_*` tables, owned by a parent via `(parent_id, parent_field, sort_order)`. No JSONB blob for blocks. Every block is a first-class queryable, searchable row. Source: `vendor/craftcms/cms/src/fields/Matrix.php` (Craft 5 rewrote this away from the old `matrixblocks` JSON table).
- **Strong vs weak references** (Sanity): default references are strong (publish-blocked if target missing); `weak: true` opts out. Postgres FKs with `ON DELETE RESTRICT` for strong, no FK for weak.

### Schema definition — Payload's config-object, TS-first

**Adopt:** Schema is a TS config object. Single source of truth drives DB schema generation, admin UI rendering, REST routes, GraphQL types, and generated TS client types. Source: `packages/payload/src/collections/config/types.ts`.

```ts
export const Posts: CollectionConfig = {
  slug: 'posts',
  admin: { useAsTitle: 'title' },
  access: { read: ({ req }) => req.user ? true : { _status: { equals: 'published' } } },
  versions: { drafts: { autosave: { interval: 2000 } } },
  hooks: { beforeChange: [populateSlug] },
  fields: [
    { name: 'title', type: 'text', required: true, localized: true, validate: z.string().min(3) },
    { name: 'body', type: 'richText', editor: tiptap({ extensions: [...] }) },
    { name: 'author', type: 'relationship', relationTo: 'users',
      access: { read: ({ req }) => !!req.user } },
    { name: 'blocks', type: 'blocks', blockTypes: ['hero', 'cta', 'testimonial'] },
  ],
}
```

The `Field` type is a discriminated union keyed on `type`. An admin-first schema-builder UI still exists for Drupal parity, but it emits a `CollectionConfig` file into the repo — codebase is source of truth, UI is a convenience.

### DB adapter — Payload's factory pattern over Drizzle

**Adopt:** Adapter is a factory function: `postgresAdapter({ pool, schemaName })` returns a `DatabaseAdapter` object implementing ~30 methods (`find`, `findOne`, `create`, `updateOne`, `beginTransaction`, `migrate`, etc.). Not a class. Trivially swappable in `cmscore.config.ts`. Source: `packages/payload/src/database/types.ts`, `packages/db-postgres/src/index.ts`, `packages/drizzle/src/schema/buildDrizzleTable.ts`.

**Drizzle + drizzle-kit (dev) + Atlas (prod)** for migrations. Payload v3 went to Drizzle; Atlas (Ariga, Go binary) is the 2026 production migration tool of record — declarative, linting, Kubernetes operator. drizzle-kit generates migrations from schema diff for local dev; Atlas handles the production roll with proper validation.

The hottest code in this layer is the `Where`-object → Drizzle-SQL translator (Payload's `buildQuery/parseParams.ts`). Budget weeks for the equivalent. It's unavoidable if we want unified authorization + query filtering (next subsystem).

### Access control — Payload's `boolean | Where` pattern

**Adopt:** An access function returns `true` (allow all), `false` (deny), or a `Where` object that scopes the query instead of rejecting. Source: `packages/payload/src/auth/types.ts`.

```ts
const readAccess: Access = ({ req: { user } }) => {
  if (!user) return { _status: { equals: 'published' } }
  if (user.role === 'admin') return true
  return { or: [{ _status: { equals: 'published' } }, { author: { equals: user.id } }] }
}
```

List endpoints transparently filter to visible rows; no row-load-then-check N+1. Field-level access applied during serialization in `afterRead`: one schema serves admin, editor, and public without duplicate DTOs. Replaces Drupal's slower entity-access hook chain.

### Hooks — Payload's array-of-functions, three-scope model

**Adopt:** Each hook key is an array. Scopes: `config.hooks` (global), `CollectionConfig.hooks`, `Field.hooks`. Source: `packages/payload/src/fields/hooks/` (beforeValidate/, beforeChange/, afterChange/, afterRead/).

Ordering for a create operation:

```
beforeOperation → field beforeValidate → collection beforeValidate → validate
  → field beforeChange → collection beforeChange → DB write
  → field afterChange → collection afterChange
  → field afterRead → collection afterRead → afterOperation
```

Field-scoped hooks mean `slug` auto-population lives on the field itself, not in a 200-line collection-level `beforeChange` switch. Plugins append to hook arrays without wrapper-hell.

### Rendering & caching — Drupal Cache Tags (see Drupal innovation #1)

The architectural centerpiece. Ships **before any other scale optimization** because no other caching strategy composes as cleanly.

- Every entity exposes `getCacheTags(): string[]` returning e.g. `['content:article:123', 'content:article_list', 'user:5']`.
- A `CacheableRenderContext` class accumulates tags as nested renders complete (`merge()` — the `BubbleableMetadata` equivalent).
- Tagged invalidation fires on `entity:afterSave` / `afterDelete` hooks automatically — no manual cache bookkeeping.
- HTTP responses emit `Cache-Tag` and `Surrogate-Key` headers for CDN integration (Fastly, Cloudflare, Varnish all support this).

### Config management — Drupal UUIDs + dependency graph (see Drupal innovation #2)

`config/sync/{type}.{uuid}.yaml` per config entity, each declaring `dependencies: { config: [...], module: [...] }`. Export walks the active config store, writes sorted YAML. Import parses, topo-sorts by dependencies, runs a three-way diff, then creates/updates/deletes in dependency order. SHA256 manifest at `config/sync/.manifest` for tamper detection.

Every content type, role, permission set, webform, menu, view — all config entities, all exportable, all UUIDable, all diff-reviewable in PRs.

### Rich text — ProseMirror JSON (TipTap native) + Portable Text adapter

**Adopt:** TipTap is already a dep. It emits ProseMirror JSON. Store that in a `jsonb` column. Provide serializers:
- `toHTML(pm)` — for SSR / delivery API via `@tiptap/html`
- `toMarkdown(pm)` — for exports / AI ingestion
- `toPortableText(pm)` — for Sanity ecosystem interop

Payload stores Lexical JSON (moved off Slate in v3). Sanity stores Portable Text. Both are variants of the same idea: structured JSON is queryable, extensible, and lossless; HTML is not. Source: `github.com/portabletext/portabletext` for the spec.

Custom block types (image with focal point, callout, CTA) become first-class ProseMirror nodes — round-trip through the editor without flattening to HTML.

### Media — Payload's upload providers + Sanity's URL transforms

**Adopt both patterns:**

**Upload provider interface** (Payload `packages/payload/src/uploads/`): `UploadAdapter` with `handleUpload`, `handleDelete`, `generateURL`, `staticHandler`. First-party adapters: local-disk, S3 (via `@aws-sdk/client-s3`), Cloudflare R2, Vercel Blob.

**URL-transform endpoint** (Sanity's hotspot/crop model, docs at `sanity.io/docs/image-url`): `GET /media/:id?w=800&h=600&fit=crop&fp-x=0.5&fp-y=0.3&q=80&format=auto`. Sharp pipeline, output cached to disk/R2 keyed by hash of the param string. Focal points persisted as `{x, y}` on the asset row — editors set hotspot once at upload time; every downstream render respects it.

Payload does build-time sizes only (a limitation). Matching Sanity's on-demand pipeline is a cms-core differentiator.

### Revisions / drafts / releases / live preview

**Versions as parallel `_v` tables** (Payload). Opt-in per collection via `versions: { drafts: { autosave: { interval: 2000 } } }`. Source: `packages/payload/src/versions/saveVersion.ts`, `packages/drizzle/src/schema/build.ts`. Schema mirrored to `content_article__v` with extra columns `parent, version, latest, autosave, _status`.

**Releases** (Contentful pattern). A `releases(id, title, state)` table + `release_items(release_id, entity_type, entity_id)` join. `POST /releases/:id/publish` runs a single transaction promoting all items. Scheduled via `scheduled_actions(release_id, run_at, action)` polled by graphile-worker. Beats "environments" (full content branches) for the 90% use case of staging a launch batch.

**Live preview** (Craft's signed-token model). `POST /preview/tokens` returns a JWT with `{ entityType, draftId, exp: now + 1h }`. Preview route validates token, swaps draft for canonical, renders normally. Iframe in admin auto-refreshes on autosave via SSE.

### Real-time collaboration — Yjs + Hocuspocus + TipTap

**Adopt:** TipTap has first-class `@tiptap/extension-collaboration` and `@tiptap/extension-collaboration-cursor` built on Yjs. Hocuspocus is the Yjs server from the TipTap team with Postgres persistence. This is what Notion-likes, Linear, Cal.com's docs ship in 2026. Sanity's `mendoza` (patch-diff, not CRDT) is proprietary and better-avoided for self-hosted.

**For scalar field collaboration** (title, slug, select fields), adopt Sanity's patch-op vocabulary (`set`, `unset`, `insert:{before|after|replace}`, `diffMatchPatch`) over WebSocket rather than Yjs. Yjs for long-form text inside rich-text fields; patch-ops for everything else. Both over `/api/realtime`. Source: `sanity.io/docs/http-patches`.

### Localization — Payload's field-level + `_locales` join table

**Adopt:** `field.localized: true` is per-field. In Postgres, localized fields split into `content_article_locales(entity_id, _locale, title, body_ref, ...)`. Per-request `?locale=es&fallbackLocale=en`, empty values fall back during `afterRead`. `?locale=all` returns `{ en: ..., es: ... }`. Source: `packages/drizzle/src/schema/traverseFields.ts`.

### API layer — three tiers, REST + OpenAPI + typed SDK primary

**Adopt from Contentful:** three-API split maps to three route prefixes with different caching/auth policies:
- `/api/delivery/*` — published content only, aggressive caching (Cache-Tag header), API-token auth, rate-limited per-token. CDN-cacheable.
- `/api/preview/*` — drafts + published, bypass cache, short-lived JWT preview token.
- `/api/admin/*` — full CRUD, session auth, CSRF, audit-logged.

Core operations live as pure functions in `src/core/entities/operations/*.ts` — `findByID`, `create`, `update`, `delete`, `find`. REST routes and GraphQL resolvers are thin wrappers. Zero duplication between transports. Source: `packages/payload/src/collections/operations/`, `packages/next/src/routes/rest/`, `packages/graphql/src/resolvers/`.

**GraphQL ships as an optional plugin, not core.** GraphQL adoption for CMS delivery is declining relative to REST + typed SDK + framework Server Actions. Payload tracks this internally. REST + OpenAPI + auto-generated TS SDK covers 95% of consumers; GraphQL stays first-party via `@cms-core/plugin-graphql` for the 5% that need it.

### Plugins — Payload's config-transformer functions

**Adopt:** A plugin is `(options) => (config: Config): Config`. Mutates/extends collections, globals, hooks, endpoints, admin components, returns new config. Source: `packages/plugin-seo/src/index.ts`, `packages/plugin-stripe/src/index.ts`, `packages/plugin-search/src/index.ts`.

```ts
export const seoPlugin = (opts) => (config) => ({
  ...config,
  collections: config.collections?.map(c =>
    opts.collections?.includes(c.slug)
      ? { ...c, fields: [...c.fields, metaGroupField(opts)] }
      : c),
})
```

Composition is `pipe(p1, p2, p3)(baseConfig)`. No lifecycle, no registration API, trivially testable. Replaces Drupal's hook-plus-plugin-system with something far simpler.

### Jobs — graphile-worker (LISTEN/NOTIFY)

**Adopt:** Postgres-native, Redis-free. Sub-5ms job pickup latency via `LISTEN/NOTIFY` (pg-boss polls every 2s by default). Handles ~196k jobs/sec on competent hardware. Benjie Gillam's code quality is exceptional. Source: `worker.graphile.org`.

### Search — Postgres FTS default, pluggable provider

**Adopt:** `tsvector` column per content type + GIN index. On `afterSave`, update the search index via hook. Query via `websearch_to_tsquery`. Works to ~1M rows with mixed content before typo tolerance, faceted search, and relevance tuning start breaking. Above that scale: a **SearchProvider interface** (mirroring Payload's upload providers) with first-party adapters for Meilisearch, Typesense, OpenSearch. Default stays Postgres FTS.

### Sessions & auth — better-auth + Drizzle adapter + Postgres table

**Adopt better-auth.** Lucia was archived by its author in March 2025 ("Lucia is getting deprecated"); successor is **better-auth** (Bereket Engida) — Drizzle/Prisma/Kysely adapters, Postgres-backed sessions, OAuth, 2FA, passkeys, organizations. This is the 2026 canonical choice.

Session table in Postgres (`sessions(id, user_id, created, expires, last_seen, user_agent, ip, revoked, device_label)`), signed cookie as reference. Enables: force-logout, per-user session listing, credential-change revocation, multi-instance deployment.

Force-rotation of `admin/admin`: CLI `cms init-admin` required on first boot; web-based setup wizard refuses to complete without ≥ 14-char strong password.

### Observability — pino + OpenTelemetry + audit log

**Adopt:** Pino is what Payload and Fastify ship. Structured JSON, 5x Winston's throughput, per-request child loggers via AsyncLocalStorage. Zero `console.*` in `src/` (lint-enforced).

Audit log table with tamper-evidence: `audit_log(timestamp, actor_id, action, target_type, target_id, before jsonb, after jsonb, row_hash, prev_row_hash)`. Each row's hash chains to the previous — mutation detectable via chain re-verification. Append-only enforced by a Postgres trigger.

`/metrics` Prometheus endpoint. OpenTelemetry exporter behind a flag. Grafana dashboard templates committed in `ops/grafana/`. SLO doc.

### Admin UI — modernize server-rendered, islands for complex widgets

**Explicit non-rewrite decision.** Rewriting templates to a Next.js/React/Vue SPA violates the TS-port-first priority and is not required for top-tier quality.

Counter-evidence for why server-rendered is still a top-tier choice in 2026: Rails + Hotwire, Laravel + Livewire, Phoenix LiveView all demonstrate the pattern at scale. HTMX has pushed this further in the Node ecosystem. Ghost's Ember admin is universally acknowledged as their biggest tech debt — no public rewrite has materialized in 3+ years. Admin rewrites are rewrite-or-die gambits.

The plan: **keep server-rendered templates, modernize them.**

- Template engine gains partial support (`{{> form-field}}`) — ~50 LOC addition. Eliminates the 90/137 inline-style template problem.
- A typed component contract (`defineComponent({ name, props: z.object({...}), template: 'form-field.html' })`) so partials aren't stringly-typed.
- Islands for complex widgets — rich-text editor (TipTap), media browser, drag-drop builders, live-preview iframe. Each island is a small React/TipTap bundle mounted at a `data-island="…"` root, not a full admin SPA. esbuild already in the pipeline.
- Design system: tokens stay in `admin.css`, inline-style templates migrated, dark mode via `light-dark()` CSS function instead of override layer.
- Accessibility: skip links, `aria-live` on batch/async flows, focus-visible discipline, `<dialog>` element for modals, `aria-invalid` + `aria-describedby` on forms.

---

## Tooling & Infrastructure Decisions

Grounded in what Payload/Sanity/Drupal/Craft/Ghost/Keystone actually ship in 2026. Each decision has a precedent.

| # | Concern | Choice | Precedent |
|---|---------|--------|-----------|
| T1 | ORM / query layer | **drizzle-orm** over `pg` | Payload v3 migrated off Mongoose-style adapters to Drizzle for all SQL databases. Smaller than Prisma (no Rust engine binary), typed without codegen, schema-as-code. |
| T2 | Migration tool | **drizzle-kit** (dev) + **Atlas** (prod) | drizzle-kit for schema-diff-based dev migrations. Atlas (Ariga, Go) for production — declarative state, linting, Kubernetes operator. |
| T3 | Logger | **pino** | Payload uses pino. Fastify ships pino. 5× faster than Winston. JSON-structured. Child loggers for request correlation. |
| T4 | Auth / sessions | **better-auth** + Drizzle adapter | Lucia archived March 2025. better-auth is the community-converged successor. Postgres-backed sessions, OAuth, 2FA, passkeys, organizations. |
| T5 | Background jobs | **graphile-worker** | LISTEN/NOTIFY for sub-5ms pickup. Postgres-only (no Redis). 196k jobs/sec. Alternative pg-boss has broader adoption but polls (2s default). |
| T6 | Full-text search | **Postgres FTS** default + provider interface | tsvector + GIN scales to ~1M rows. Meilisearch adapter as first-party reference for beyond that. |
| T7 | Media storage | **UploadAdapter** abstraction (Payload model) | local / S3 / R2 / Vercel Blob. `@aws-sdk/client-s3` v3 (modular, tree-shakable). |
| T8 | Image transforms | **sharp** + URL-param pipeline (Sanity model) | Focal points in asset metadata. Disk/R2 cache keyed by hash(params). On-demand, not build-time. |
| T9 | Realtime / collab | **Yjs + Hocuspocus + TipTap** | Notion, Linear, Cal.com docs all use Yjs. TipTap has first-class Yjs extensions. Hocuspocus is the Yjs server from the TipTap team, with Postgres persistence. |
| T10 | Rich text storage | **ProseMirror JSON** (TipTap native) | Store as jsonb. Serialize to HTML / Markdown / Portable Text on demand. Never store HTML. |
| T11 | API shape | **REST + OpenAPI + typed SDK** primary; GraphQL as plugin | GraphQL adoption for CMS delivery is declining relative to REST + typed clients. Payload tracks this. |
| T12 | Testing | **vitest** + **testcontainers-postgres** + **Playwright** | vitest has won over Jest in the TS/ESM world by 2026. Real Postgres per test suite via testcontainers. Playwright for e2e (Microsoft has surpassed Cypress on features). |
| T13 | Security headers | **helmet** baseline + custom CSRF + nonce-based CSP | helmet is standard. CSP needs nonce + `strict-dynamic` (Google / GitHub / banks). |
| T14 | Rate limiting | **rate-limiter-flexible** + Postgres adapter | Mature, has Postgres driver, Redis-free. Hand-roll alternative is 50 LOC if zero-deps matters. |
| T15 | Email | **nodemailer** + provider adapter interface | Ghost and Payload both use nodemailer with adapter plugins for SMTP / Resend / SES / Mailgun. React Email for templates. |

---

## Guiding Principles (The Invariants)

Non-negotiable for every phase. Violating one of these means the phase is wrong.

1. **TypeScript strictness never loosens.** `strict + noUncheckedIndexedAccess` stays on. Any new `any`, `!`, or `@ts-expect-error` requires a `TYPE-DEBT.md` entry with a retirement commit hash.
2. **No file survives this plan as `.js`** inside `src/`. Vendor code in `node_modules/` is not our problem.
3. **No file over 500 lines in `src/core`, no file over 800 lines in `src/modules`**, except generated code. Hard ceiling enforced by CI lint (Phase 0 PR 0.1).
4. **Every mutation path has a test.** Security mutations (login, CSRF, upload, role change) have integration tests; data mutations have unit tests.
5. **Every external surface has a boundary contract.** HTTP routes validated at the edge (Zod); plugin registrations validated at register time; DB queries via a typed query builder, never string concat.
6. **CI is the truth.** Green typecheck + lint + test + schema-drift + size + layers on every commit. Red CI = cannot merge.
7. **Reversible steps only.** Every phase ships behind a feature flag or dual-write bridge until the cut-over commit. No big-bang Friday.
8. **Concurrent port-plus-refactor.** Every `.js → .ts` move also splits the file if it exceeds ceilings. Never "port first, split later."

---

## Implementation Plan — 16 Phases

167 PRs total. Phase numbers are scope groupings, not strict sequence — consult the [dependency graph](#phase-dependency-graph) for the real order (some phases run in parallel once their dependencies land).

### Phase 0 — Guardrails

**Intent:** CI hard-fails on any regression in type, lint, test, file size, layer boundary, or schema drift.

| PR | Scope | Exit criteria |
|---|---|---|
| 0.1 | `scripts/check-file-size.ts` + CI job | Fails on any `src/**/*.ts` > 500 LOC (core) or > 800 LOC (modules); ignores files listed in `.size-ignore` |
| 0.2 | `scripts/check-layer-boundaries.ts` + CI job | Enforces: core never imports from modules; security never imports from rendering; storage never imports from http; rendering never imports from storage directly |
| 0.3 | `.github/workflows/ci.yml` rewrite | Required status checks: `typecheck`, `lint`, `test`, `size`, `layers`, `schema-drift` (placeholder). Branch protection on `main` + `next` |
| 0.4 | `lefthook.yml` + `package.json` scripts | Pre-commit runs biome format-check + typecheck on staged TS/JS; pre-push runs full test |
| 0.5 | `.gitignore` additions + `git filter-repo` cleanup PR | Removes `backups/`, `content/.{cache,locks,sessions,queue,previews,search,notifications,activity}/`, `logs/`, `.playwright-mcp/`, `.archive/` from tracking and history |
| 0.6 | `docs/adr/001` through `docs/adr/018` | One ADR per architectural decision, each citing the top-tier source |
| 0.7 | `CONTRIBUTING.md` rewrite + `next` branch | PR flow: feature branches → `next` → squash-merge → periodic `next`→`main` releases |
| 0.8 | `scripts/check-schema-drift.ts` stub | Placeholder that becomes real in Phase 2 |

**Phase exit:** intentional violation of any check produces red CI. Clean `next` is green. `docs/adr/` has all 18 decisions.

### Phase 1 — Restructure + first TS port wave

**Intent:** All code under `src/` in the layered structure. All core `.js` ported. All modules-not-scheduled-for-later-refactor ported. Three big files (`boot.js`, `workspaces.js`, `cli.js`) ported AND split.

**Target directory shape:**

```
src/
  core/
    boot/              # init, discover, register, run — was boot.js
    http/              # server, router, middleware, ajax
    security/          # auth, csrf, captcha, honeypot, ban, permissions
    entities/          # entity, fields, content-types, field-storage
    storage/           # db client, migrations, repositories, cache
    rendering/         # template engine, views, theme loader
    config/            # config-management, archetypes, blueprints
    ai/                # ai-*, provider registry, agents, stats
    cli/               # CLI subcommands — was cli.js
    workspaces/        # workspace subpackage — was workspaces.js
    observability/     # logger, audit, analytics, metrics, health
    plugins/           # plugin-type-manager, hooks, dependencies, discovery
  modules/             # feature modules (admin, users, media, linkit, …)
  themes/              # default, admin, layouts, skins
  types/               # shared types consumed across core/modules
migrations/            # numbered SQL migrations (Atlas + drizzle-kit)
tests/
  unit/
  integration/
  security/            # dedicated security test suite
  load/                # load test harness
docs/
  adr/
  architecture.md
  security.md
  plugin-development.md
  deployment.md
```

| PR | Scope | Exit criteria |
|---|---|---|
| 1.1 | `scripts/restructure.ts` (ts-morph AST codemod) | Takes `mapping.json`; executes `git mv`; rewrites imports via AST; emits diff report. Unit-tested on a fixture project |
| 1.2 | `src/core/security/*` moved (already `.ts`) | Tests pass; layer lint green |
| 1.3 | `src/core/entities/*` + `src/core/storage/*` | Tests pass |
| 1.4 | `src/core/rendering/*` + `src/core/config/*` + `src/core/ai/*` + `src/core/observability/*` | Tests pass |
| 1.5 | `src/core/plugins/*` + `src/core/http/*` | Tests pass |
| 1.6 | `boot.js` (4,463 LOC) ported + split → `src/core/boot/{init,discover,register,run,types}.ts` + orchestrator `index.ts` | Each phase-file < 400 LOC; `BootContext` type threads phases; eliminates module-level mutable registries; hook-name schema validation added |
| 1.7 | `workspaces.js` (3,951 LOC) ported + split → `src/core/workspaces/` | Facade + `lib/` helpers; no file > 500 LOC |
| 1.8 | `cli.js` (2,479 LOC) ported + split → `src/core/cli/commands/{init,migrate,users,export,import,health}.ts` + dispatcher | Uses `node:util parseArgs`; `cms --help` preserved; all commands work |
| 1.9 | Remaining core `.js`: `backup`, `contact`, `graphql`, `jsonapi`, `plugins.js`, `webform`, `cache-backend`, +9 others | `find src/core -name '*.js'` empty |
| 1.10 | Small modules ported (not scheduled for later refactor): `hello`, `cookie-consent`, `icons`, `field-group`, `linkit`, `tagify-widget`, `webhooks`, `tasks`, `forge`, `icon_pack_example`, `test*` | Remaining `.js` in `src/modules` limited to: `admin/` (Phase 6), `users/` (Phase 10), `media/` (Phase 8), `ai*/` (Phase 2) |
| 1.11 | Path aliases via `tsconfig.json` + Node `imports` field | `@core/*`, `@modules/*`, `@types/*` work in tsc and runtime |
| 1.12 | `scripts/check-js-remaining.ts` + CI job | Fails on `.js` outside allow-list; allow-list shrinks each phase |

**Phase exit:** `src/core/` has zero `.js`. Directory matches target. Path aliases work. Tests and layer lint green.

### Phase 2 — Postgres foundation + Field API

**Intent:** Flat-file content storage is gone. Postgres is source of truth. Field API (Drupal base+configurable split) is implemented. Drizzle adapter pattern in place. Load-tested at 10k/100k/1M rows.

**Critical path of the entire plan. Do not compress.**

| PR | Scope | Exit criteria |
|---|---|---|
| 2.1 | Install `drizzle-orm`, `drizzle-kit`, `pg`, `@types/pg`; `src/core/storage/db.ts` connection factory with pool config; `ops/compose.yml` reference deployment with Postgres | `cms health` reports DB connection; pool size = `cpu*2+1` default |
| 2.2 | Initial migration `0001_core_schema.sql` — foundational tables: `users`, `sessions`, `roles`, `permissions`, `role_permissions`, `audit_log`, `config`, `cache_entries` | `drizzle-kit migrate` up + down succeed on fresh DB; schema snapshot committed |
| 2.3 | Migration `0002_entity_metadata.sql` — `entity_type_definitions`, `field_storage_definitions`, `field_instance_definitions` | Metadata tables introspectable |
| 2.4 | `EntityTypeSchemaBuilder` — generates base table DDL per entity type from config | `buildBaseTable(articleType)` produces correct SQL; 5 entity-type fixtures pass |
| 2.5 | `FieldStorageSchemaBuilder` — per-field side tables with `(entity_type, entity_id, revision_id, bundle, delta, langcode, value_*)` | Unlimited-cardinality creates row-per-value; single-cardinality enforces `UNIQUE (entity_type, entity_id)` |
| 2.6 | Nested-entity schema (Craft 5): `parent_id, parent_field, sort_order` on `content_*` tables | Block rows correctly attributed; re-ordering works |
| 2.7 | `DatabaseAdapter` interface in `src/core/storage/adapter/types.ts` — 30 methods | Interface matches Payload's `BaseDatabaseAdapter` shape; documented method-by-method |
| 2.8 | `postgresAdapter({ pool, schemaName })` factory over Drizzle | `db.find({ entityType: 'article', where: {...}, limit: 10 })` returns typed rows |
| 2.9 | `Where → SQL` translator | Fuzz test: 10,000 random Where objects translate without error; covers scalar ops, logical, nested relationship traversal, exists/null |
| 2.10 | Repository layer — `src/core/storage/repositories/base.ts` + per-entity-type repos | Lint rule: `db.select()` outside repositories fails; tests mock repositories, not DB |
| 2.11 | `FieldType` plugin registry — 21 existing types ported | Each has Zod config schema + `schema()` method emitting column DDL |
| 2.12 | `FieldWidget` plugin registry | Every field type has default widget; custom widgets registerable per-field |
| 2.13 | `FieldFormatter` plugin registry | Formatters handle list / detail / teaser display modes |
| 2.14 | Dual-write bridge — writes go to both flat-file and PG; reads from PG; `USE_LEGACY_STORAGE` flag | Integration test: write → verify PG row + flat-file row, hashes match |
| 2.15 | `scripts/migrate-flat-to-pg.ts` | Idempotent (UUID dedupe); progress bar; checksums emitted; tested on 100-entity fixture |
| 2.16 | `scripts/verify-migration.ts` | Produces `migration-diff.json`; exits non-zero on mismatch |
| 2.17 | Production migration on the 18,638-file dataset | `migration-baseline.md` committed with timing, fix-list, checksums. All `/content/` data in PG |
| 2.18 | Cut-over — flat-file writes removed; flag removed; dual-write code deleted | `git grep flatFileWrite` empty in `src/` |
| 2.19 | Load test `tests/load/phase-2-baseline.k6.js` | Baseline committed: P99 < 100ms @ 10k, < 300ms @ 100k, < 1s @ 1M. Sustained-write benchmark: 100 concurrent writers, zero lost rows |

**Phase exit:** Postgres is sole source of truth. `/content/` no longer written by server (still readable for imports, retained for config export in Phase 4). Field API is the storage model. Load targets committed. `scripts/check-schema-drift.ts` has real check (pg_dump diff vs committed snapshot).

### Phase 3 — Cache Tags + BubbleableMetadata (~7 PRs)

Drupal innovation #1. `cache_entries` table with GIN index on `tags`. `CacheableRenderContext` TS class accumulates tags. `Entity.getCacheTags()` contract. Auto-invalidation via `entity:afterSave/afterDelete` hooks. `Cache-Tag` + `Surrogate-Key` HTTP response headers. Load benchmark: 100k cached pages, invalidate 1% by tag, measure latency.

**Depends on:** Phase 2.
**Exit:** tagged invalidation works; CDN headers correct; load benchmark meets targets.

### Phase 4 — Config Management with UUIDs + dependencies (~9 PRs)

Drupal innovation #2. UUID column on every config entity (backfill migration). `dependencies:` declaration on config-entity interfaces. Export command walks config, emits `config/sync/{type}.{uuid}.yaml`. SHA256 manifest. Three-way diff engine (active/sync/last-imported). Topological-sort import. Partial import by subtree. CLI commands `cms config:export/import/diff`.

**Depends on:** Phase 2.
**Exit:** rename-safe round-trip works; partial subtree import works; CI gate on `config/sync/` hash matching runtime state.

### Phase 5 — Access control + hooks + plugin system (~8 PRs)

Payload's `Access` pattern (`boolean | Where`) with field-level access at serialization. Hook registry with three scopes (global/collection/field), typed lifecycle ordering. Plugin-as-config-transformer (`(opts) => (cfg) => cfg`). Route-level permission middleware; default-deny on `/admin/*`; permission metadata required per route (lint-enforced). Remove `admin/admin` default; first-run CLI wizard + web-based setup.

**Depends on:** Phase 2, Phase 4 (roles/permissions are config entities).
**Exit:** `Access` filters list queries at SQL layer; field-level access strips fields correctly; lint blocks admin routes missing `permissions` metadata; `admin/admin` grep empty.

### Phase 6 — Admin module split + server-rendered modernization (~16 PRs)

17,545-line `modules/admin/index.js` split into seven feature routers (content/users/config/system/media/ai/tools). AST-based split codemod + snapshot-test harness as safety net. Template engine gains `{{> partial}}` support (~50 LOC). Extract canonical partials (breadcrumb, flash, button, form-field, data-table, empty-state, page-header, confirm-dialog). Migrate 137 inline-style templates off hardcoded colors. Dark mode via `light-dark()` CSS function — override layer deleted. Class-name normalization codemod (`btn-small → btn-sm`, `flash|messages|alert → alert`). Accessibility pass: skip links, `aria-live`, focus-visible, `<dialog>`, `aria-invalid` + `aria-describedby`. Fix shipped-broken items (lock countdown).

**Depends on:** Phase 5 (permission middleware integrates at router level).
**Exit:** `modules/admin/index.js` deleted; largest admin file < 800 LOC; Axe scan zero violations on 20 top admin routes; keyboard-only nav through create flow; snapshot harness diff empty.

### Phase 7 — Security hardening (~7 PRs)

Magic-byte upload validation (port of `file-type`, 40 LOC). CSP nonce + `strict-dynamic` middleware — report-only, then enforcing. `safeFetch(url, opts)` wrapper with DNS-rebinding guard, private-range rejection, redirect cap — lint bans raw `fetch()`. Security headers (HSTS 1y preload, X-Content-Type-Options, Referrer-Policy, Permissions-Policy). Rate limiting via `rate-limiter-flexible` + Postgres adapter, aggressive on `/login` and `/admin/login`. Audit-log tamper-evidence: per-row `(row_hash, prev_row_hash)` chain + Postgres trigger blocking non-append writes. Dedicated `tests/security/` — auth timing-attack resistance, CSRF replay, permission bypass, upload vectors, SSRF.

**Depends on:** Phase 6.
**Exit:** security test suite passes; CSP enforcing; audit-chain verification script passes.

### Phase 8 — Media + image transforms + uploads (~10 PRs)

`UploadAdapter` interface (Payload model). First-party adapters: local-disk, S3, Cloudflare R2, Vercel Blob. URL-transform route `/media/:id?w=…&h=…&fit=…&fp-x=…&fp-y=…&q=…&format=…` → sharp → derivative cache keyed by `hash(params)`. Focal points in asset metadata. Image re-encoding on upload (strip EXIF, normalize format, limit input pixels). Port `modules/media/` to TS during this phase.

**Depends on:** Phase 2.
**Exit:** four upload adapters pass contract tests; transform pipeline produces expected output; EXIF stripped; 10MB decompression-bomb test returns error.

### Phase 9 — Rich text + islands architecture (~7 PRs)

ProseMirror JSON as canonical rich-text storage (TipTap native). Serializers: `toHTML`, `toMarkdown`, `toPortableText`. Islands build pipeline (esbuild multi-entry). Islands: TipTap editor, media browser, drag-drop block builder, live-preview iframe. `data-island="…"` mount convention; each island < 80KB gzip.

**Depends on:** Phase 6, Phase 8.
**Exit:** editor island round-trips content losslessly; SSR-rendered page from same JSON matches editor output byte-for-byte via HTML serializer; bundle sizes within budget.

### Phase 10 — Sessions + auth modernization (~9 PRs)

`better-auth` with Drizzle adapter. Sessions table migration; cookie format change (ID + HMAC signature only, no embedded state). Per-user session list UI. Force-logout endpoint. Device labeling (user-agent + last-IP). 2FA TOTP flag-gated. Passkeys flag-gated. First-run admin setup wizard (refuses completion without ≥ 14-char strong password). Port `modules/users/` to TS during this phase.

**Depends on:** Phase 5, Phase 2.
**Exit:** legacy in-memory session map deleted; password-change revokes all sessions instantly; force-logout works across simulated multi-instance.

### Phase 11 — Revisions + releases + live preview (~9 PRs)

Payload's `_v` parallel tables, opt-in per collection. `saveVersion` hook post-write; server-side autosave debounce. `find({ draft: true })` routing. Contentful-style **Releases**: `releases` + `release_items` tables, atomic publish via single transaction, `scheduled_actions` polled by graphile-worker. Craft's **live preview**: JWT preview tokens, preview route swaps draft for canonical, SSE stream for autosave refresh.

**Depends on:** Phase 2, Phase 13.
**Exit:** versioned collection rolls back to v-N; release publishes 50 entities atomically; preview-token scoping enforces entity + expiry.

### Phase 12 — Real-time collaboration (~6 PRs)

Hocuspocus server with Postgres persistence (`yjs_documents` table). TipTap `@tiptap/extension-collaboration` + cursors. `/api/realtime` WebSocket multiplexing Yjs + scalar-field patch-ops. Sanity's patch vocabulary (`set`, `unset`, `insert`, `diffMatchPatch`). Presence indicators. Conflict resolution tests.

**Depends on:** Phase 9, Phase 10.
**Exit:** two simulated users converge on rich text after 1000 mixed edits; scalar patch-ops serialize correctly.

### Phase 13 — Jobs + search (~10 PRs)

`graphile-worker` install + job registry + typed task interface. Jobs: scheduled publish, webhook delivery, email send, image derivation, search-index update. `SearchProvider` interface with Postgres FTS (default) and Meilisearch (reference third-party). Admin search UI with typo tolerance when provider supports it.

**Depends on:** Phase 2.
**Exit:** job pickup latency < 10ms (LISTEN/NOTIFY verified); 10k jobs/sec sustained without backlog; provider swap works without application code change.

### Phase 14 — API tiering + operations layer (~9 PRs)

Core operations as pure functions in `src/core/entities/operations/*.ts` (`findByID`, `create`, `update`, `delete`, `find`, `findMany`). Three route prefixes: `/api/delivery/*` (published, Cache-Tag'd, API-token auth, aggressive caching), `/api/preview/*` (drafts, short-lived JWT, bypass cache), `/api/admin/*` (full CRUD, session auth, CSRF, audit-logged). Auto-generated OpenAPI spec from operation signatures. Auto-generated typed TS SDK (`@cms-core/sdk`). GraphQL extracted to `@cms-core/plugin-graphql` (optional). Per-tier rate-limit policies.

**Depends on:** Phase 3, Phase 5, Phase 7.
**Exit:** same operation function serves all three tiers; OpenAPI validates against real requests; typed SDK used in at least one integration test fixture.

### Phase 15 — Observability + performance (~10 PRs)

pino install + `src/core/observability/logger.ts`. AsyncLocalStorage request correlation (`request_id` in every log line). Lint rule bans `console.*` in `src/`. OpenTelemetry wiring behind `OTEL_ENABLED` flag. `/metrics` Prometheus endpoint (internal-only). Drizzle slow-query plugin (> 50ms with call stack). Connection pool instrumentation. Graceful shutdown (SIGTERM drains, closes pool, flushes logs). Grafana dashboard templates in `ops/grafana/`. SLO doc in `docs/slo.md`. Load-test regression harness on every PR.

**Depends on:** all earlier phases.
**Exit:** zero `console.*` in `src/`; `/metrics` scrape-able; dashboard imports cleanly; SLO document committed.

### Phase 16 — Quality + docs + 1.0 (~11 PRs)

Coverage push to 80% on `src/core/{security,entities,storage,cache,config}`, 60% on `src/modules/admin`. Property-based tests (`fast-check`) on hooks, template engine, Where→SQL translator. Threat model (`docs/security/threat-model.md`) — STRIDE per subsystem. Architecture doc with mermaid diagrams. Plugin development guide with worked example (newsletter plugin). Deployment guide (Docker Compose, PG tuning, backup/restore, secret rotation). README rewrite — real screenshots, honest feature grid, "why over Payload/Sanity/Drupal" section. Example plugin repo (`@cms-core/example-plugin-newsletter`) public. `1.0-rc1` tag. 30-day soak on real deployment. `1.0` tag.

**Depends on:** everything.
**Exit:** all exit criteria above green; 1.0 tagged.

---

## Phase Dependency Graph

| Phase | Title | PR count | Depends on |
|---|---|---|---|
| 0 | Guardrails | 8 | — |
| 1 | Restructure + TS port wave 1 | 12 | 0 |
| 2 | Postgres + Field API | 19 | 1 |
| 3 | Cache Tags | 7 | 2 |
| 4 | Config Management | 9 | 2 |
| 5 | Access control + hooks + plugins | 8 | 2, 4 |
| 6 | Admin split + modernization | 16 | 5 |
| 7 | Security hardening | 7 | 6 |
| 8 | Media + transforms | 10 | 2 |
| 9 | Rich text + islands | 7 | 6, 8 |
| 10 | Auth modernization | 9 | 5, 2 |
| 11 | Revisions + releases + preview | 9 | 2, 13 |
| 12 | Real-time collab | 6 | 9, 10 |
| 13 | Jobs + search | 10 | 2 |
| 14 | API tiering | 9 | 3, 5, 7 |
| 15 | Observability | 10 | all |
| 16 | Quality + docs + 1.0 | 11 | all |

**Total: 167 PRs across 16 phases.**

Critical path: 0 → 1 → 2 → 5 → 6 → 7 → 9 → 12 → 15 → 16. Phases 3, 4, 8, 10, 11, 13, 14 run in parallel with the critical path once their dependencies land.

---

## Relationship to Prior Plans

This document **supersedes** `docs/plans/2026-02-22-typescript-port.md`.

The 2026-02-22 plan is a tactical 15-task mechanical port of `.js → .ts`. It's been partially executed: v0.2.0 (2026-04-20) shipped Batch 1 of leaf modules (8 of 43) plus security fixes. As of this document's date, 16 core `.js` files remain plus all module `.js` files.

The 2026-02-22 plan's **typing patterns and mechanical approach remain valid** and are reused by this plan:
- The `RequestContext`, `RouteHandler`, `HookHandler` type definitions (Tasks 2–3) become foundation types for Phase 1.
- The tier-based conversion ordering (Foundation → Infrastructure → Content → Storage → Leaf batches) informs Phase 1's PR sequencing.
- The "Conversion Reference: Typing Patterns" section at the bottom of the old plan is referenced as-is for every port in Phase 1.

The 2026-02-22 plan is **superseded** on the following points:
- It treats the TS port as the goal. This plan treats it as the throughline — a means to the 16-phase top-tier ambition.
- It ports `boot.js`, `cli.js`, `workspaces.js`, and `modules/admin/index.js` in-place. This plan ports-and-splits them concurrently, landing each as a set of files conforming to size ceilings.
- It doesn't address the directory restructure (everything still at `core/` root flat). This plan restructures to `src/core/<subsystem>/` in Phase 1 as part of the same moves.
- It doesn't address Postgres, Field API, Cache Tags, Config Management, admin module split, security hardening, or observability. Those phases land after the TS port completes in Phase 1.

**Operational guidance:** contributors executing in-flight Batch 2 / Batch 3 work from the 2026-02-22 plan should finish current batch, then switch to this plan's Phase 1 PRs for the remaining ports. The remaining batches in the old plan are replaced by PRs 1.6 through 1.10 here.

---

## References & Citations

### Payload CMS (`github.com/payloadcms/payload`)
- Config-object collection schema: `packages/payload/src/collections/config/types.ts`
- Field type union: `packages/payload/src/fields/config/types.ts`
- Access control (`boolean | Where`): `packages/payload/src/auth/types.ts`, operations in `packages/payload/src/collections/operations/find.ts`
- Field-level hooks: `packages/payload/src/fields/hooks/` (beforeValidate/, beforeChange/, afterChange/, afterRead/)
- Database adapter interface: `packages/payload/src/database/types.ts`
- Drizzle-backed Postgres adapter: `packages/db-postgres/src/index.ts`, `packages/drizzle/src/schema/buildDrizzleTable.ts`, `packages/drizzle/src/queries/buildQuery.ts`
- Versions (`_v` tables): `packages/payload/src/versions/saveVersion.ts`
- Localization (`_locales` side tables): `packages/drizzle/src/schema/traverseFields.ts`
- Plugin transformers: `packages/plugin-seo/src/index.ts`, `packages/plugin-stripe/src/index.ts`, `packages/plugin-search/src/index.ts`
- Jobs queue: `packages/payload/src/queues/operations/runJobs/index.ts`

### Sanity (`sanity.io`, `github.com/sanity-io/sanity`)
- Schema in TS: `sanity.io/docs/schema-types`
- Portable Text spec: `portabletext.org/specification/`, `github.com/portabletext/portabletext`
- GROQ spec: `github.com/sanity-io/groq/blob/main/spec/03-execution.md` *(referenced but not adopted)*
- HTTP patches: `sanity.io/docs/http-patches`
- Mendoza diff algorithm: `github.com/sanity-io/mendoza` *(referenced but not adopted — use Yjs instead)*
- Image URL transforms: `sanity.io/docs/image-url`

### Contentful
- Content model + validation: `contentful.com/developers/docs/references/content-management-api/`
- Localization: `contentful.com/developers/docs/tutorials/general/setting-locales`
- Releases + App Framework: `contentful.com/developers/docs/extensibility/app-framework/working-with-releases`

### Drupal 10/11 (`github.com/drupal/drupal`)
- Entity API: `core/lib/Drupal/Core/Entity/EntityTypeInterface.php`, `EntityStorageInterface.php`, `ContentEntityBase.php`
- Field API: `core/lib/Drupal/Core/Field/FieldItemInterface.php`, `FieldItemListInterface.php`, `core/lib/Drupal/Core/Field/Plugin/Field/FieldType/`
- SQL schema generation: `core/lib/Drupal/Core/Entity/Sql/SqlContentEntityStorageSchema.php`
- Typed Data: `core/lib/Drupal/Core/TypedData/TypedDataManager.php`, `DataDefinition.php`
- Config Management: `core/lib/Drupal/Core/Config/ConfigInstaller.php`, `ConfigImporter.php`, `Entity/ConfigEntityBase.php`
- Cache Tags: `core/lib/Drupal/Core/Cache/Cache.php`, `CacheableMetadata.php`, `core/lib/Drupal/Core/Render/BubbleableMetadata.php`
- Plugin API: `core/lib/Drupal/Core/Plugin/DefaultPluginManager.php`, `core/lib/Drupal/Component/Plugin/Discovery/`
- OOP Hooks (D11.1+): `core/lib/Drupal/Core/Hook/Attribute/Hook.php`
- Views: `core/modules/views/src/Plugin/views/`
- Migrate API: `core/modules/migrate/src/Plugin/migrate/`

### Craft CMS 5 (`github.com/craftcms/cms`)
- Elements: `vendor/craftcms/cms/src/base/Element.php`, `src/elements/Entry.php`
- Matrix (nested entities, 5.x rewrite): `src/fields/Matrix.php`, `src/services/Entries.php`
- Project Config: `src/services/ProjectConfig.php`
- Element Queries: `src/elements/db/ElementQuery.php`, `src/elements/db/EntryQuery.php`
- Drafts, Revisions, Live Preview: `craftcms.com/docs/5.x/system/drafts-revisions.html`

### 2026 Toolchain
- Drizzle: `orm.drizzle.team`
- Atlas (migrations): `atlasgo.io`
- pino: `getpino.io`
- better-auth: `better-auth.com`
- graphile-worker: `worker.graphile.org`
- Yjs: `github.com/yjs/yjs`
- Hocuspocus: `tiptap.dev/hocuspocus`
- TipTap Collaboration: `tiptap.dev/docs/editor/extensions/functionality/collaboration`
- `rate-limiter-flexible`: `github.com/animir/node-rate-limiter-flexible`
- testcontainers-node: `node.testcontainers.org`
- vitest: `vitest.dev`
- Playwright: `playwright.dev`
- helmet: `helmetjs.github.io`

### 2026 State-of-the-Art Notes
- Lucia deprecated (author announcement, March 2025) — better-auth is the community-converged successor
- Payload acquired by Figma (2025) and shipped v3 with Next.js App Router admin integration
- Ember.js remains Ghost's admin framework in 2026 with no public rewrite — treated as tech debt, not aspirational pattern
- Payload v3 migrated SQL databases from Mongoose-style adapters to Drizzle
- GraphQL adoption for CMS delivery declining relative to REST + typed SDK patterns (Payload's internal tracking + ecosystem evidence)
