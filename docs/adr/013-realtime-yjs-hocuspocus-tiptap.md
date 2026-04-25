# ADR-013: Real-time collaboration — Yjs + Hocuspocus + TipTap

## Status
Accepted (2026-04-25)

## Context
Multi-user editing for CMS content. Two architectural families:

- **Patch-diff** (Sanity's `mendoza`): proprietary algorithm, server-mediated, opaque to debug from outside. Excellent for scalar fields.
- **CRDT** (Yjs, Automerge): mathematically conflict-free, open-source, the basis of Notion / Linear / Cal.com docs in 2026. Best for unbounded text where any two operations must commute.

TipTap (already a dep) has first-class `@tiptap/extension-collaboration` and `-collaboration-cursor` built on Yjs. Hocuspocus is the Yjs server from the TipTap team with Postgres persistence.

For scalar fields (title, slug, select), Yjs is overkill — its `Y.Text` and `Y.Map` are heavier than necessary. Sanity's patch-op vocabulary (`set`, `unset`, `insert:{before|after|replace}`, `diffMatchPatch`) over WebSocket is the right primitive.

## Decision
Hybrid: Yjs for rich text, patch-ops for scalars.

- **Rich-text fields** use TipTap's collaboration extensions backed by Yjs. Hocuspocus server with Postgres persistence (`yjs_documents` table).
- **Scalar fields** use Sanity's patch vocabulary over WebSocket.
- Single `/api/realtime` endpoint multiplexes both protocols.
- Presence indicators (active users, cursors) ride on the same connection.

## Consequences

**Positive:**
- Industry-standard for rich-text collab in 2026 (Notion, Linear, Cal.com docs).
- Hocuspocus's Postgres persistence stays on the Postgres-only stack.
- Conflict-free guarantee from CRDT for unbounded text.
- Patch-ops keep the scalar-field surface light.

**Negative:**
- Yjs documents are opaque binary blobs — harder to debug than patch-ops.
- Two protocols (Yjs + patch-ops) increase the realtime surface area.
- Hocuspocus operational maturity is younger than the underlying Yjs.

## References
- tiptap.dev/docs/editor/extensions/functionality/collaboration
- tiptap.dev/hocuspocus
- sanity.io/docs/http-patches (patch-op vocabulary, adopted)
- github.com/sanity-io/mendoza (referenced, not adopted)
- Roadmap: T9; Phase 12
