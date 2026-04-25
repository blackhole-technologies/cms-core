# ADR-002: Cache Tags with bubbleable metadata

## Status
Accepted (2026-04-25)

## Context
CDN cache invalidation is the hardest distributed-systems problem in CMS. Three common approaches:

- **TTL-only** (most Node CMSes): cheap to operate, wrong content for users until TTL elapses.
- **Path-based purge** (Sanity's edge cache): operator clears `/path/*` on publish; opaque, lossy when one entity appears across many pages.
- **Tag-based with bubbleable metadata** (Drupal): every cached render emits the tags of every entity that contributed to it, propagating up nested renders. Invalidate by tag → every cached output that used that entity drops at once.

No Node CMS ships tag-based invalidation today. Payload has per-query cache invalidation but no tag propagation. Sanity's delivery edge caches with opaque TTLs.

## Decision
Adopt Drupal's Cache Tags pattern.

- Storage: `cache_entries(cache_key TEXT PRIMARY KEY, payload JSONB, tags TEXT[], expires_at TIMESTAMPTZ)` with a **GIN index on `tags`**. Array-overlap (`tags && $1::text[]`) is the invalidation operator.
- A `CacheableRenderContext` TS class accumulates tags as nested renders complete (`merge()` is the `BubbleableMetadata` equivalent).
- Every entity exposes `getCacheTags(): string[]` returning e.g. `['content:article:123', 'content:article_list', 'user:5']`.
- Auto-fired on `entity:afterSave` / `afterDelete` hooks — no manual cache bookkeeping.
- HTTP responses emit `Cache-Tag` and `Surrogate-Key` headers for CDN integration (Fastly / Cloudflare / Varnish all support these).

## Consequences

**Positive:**
- Composable: nested renders' invalidations cost nothing extra to track at the parent.
- Microsecond-fast invalidation via GIN array-overlap.
- CDN-native — Fastly's `Surrogate-Key`, Cloudflare's `Cache-Tag` all map directly.
- Differentiator: no Node CMS has this in 2026.

**Negative:**
- Tag explosion if not bounded: lists and entity-ID tags both need to fire correctly. Requires discipline at the `getCacheTags()` site.
- New mental model for contributors who haven't built on Drupal — needs ADR + docs.
- Render context accumulation is a perf-sensitive code path.

## References
- Drupal source: `core/lib/Drupal/Core/Cache/Cache.php`
- Drupal source: `core/lib/Drupal/Core/Render/BubbleableMetadata.php`
- Drupal source: `core/lib/Drupal/Core/Cache/CacheableMetadata.php`
- Roadmap: Phase 3
