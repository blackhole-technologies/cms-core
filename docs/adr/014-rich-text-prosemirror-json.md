# ADR-014: Rich text — ProseMirror JSON (TipTap native)

## Status
Accepted (2026-04-25)

## Context
Rich-text storage format choice.

- **HTML**: lossy (round-trip through editor mangles), unqueryable structurally, conflates content with presentation.
- **Markdown**: limited expressiveness (no rich blocks), still ambiguous around nesting.
- **Lexical JSON** (Payload v3 default since the move off Slate): Meta-backed, growing ecosystem.
- **ProseMirror JSON** (TipTap native): mature, well-specified, widely deployed (Notion-likes, Atlassian, GitLab use ProseMirror).
- **Portable Text** (Sanity): JSON spec for rich text with first-class custom blocks. Independent spec, multiple ecosystem renderers.

TipTap is already a dependency. Storing TipTap's output (ProseMirror JSON) in `jsonb` is the lowest-friction path. Portable Text and Lexical interop happens at the serializer boundary, not the storage boundary.

## Decision
Store rich-text as ProseMirror JSON in `jsonb` columns.

- Serializers provided:
  - `toHTML(pm)` — for SSR / delivery API via `@tiptap/html`
  - `toMarkdown(pm)` — for exports / AI ingestion
  - `toPortableText(pm)` — for Sanity ecosystem interop
- Custom block types (image with focal point, callout, CTA) are first-class ProseMirror nodes — round-trip through the editor without flattening to HTML.
- Never store HTML.

## Consequences

**Positive:**
- TipTap is already a dep; no extra editor framework.
- Round-trip lossless through editor — what editors see is what's stored.
- Queryable JSON in Postgres (jsonb path queries) for content searches that need structure.
- Custom blocks are first-class — image with focal point survives every render.

**Negative:**
- ProseMirror's adoption smaller than Lexical's growing ecosystem.
- Custom serializers (toMarkdown, toPortableText) need maintenance as the editor's schema evolves.
- jsonb size for long documents can be substantial; monitoring needed.

## References
- prosemirror.net
- tiptap.dev (built on ProseMirror)
- portabletext.org/specification/ (interop format, adopted via serializer)
- Lexical (compared alternative): lexical.dev
- Roadmap: T10; Phase 9
