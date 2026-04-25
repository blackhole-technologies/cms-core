# ADR-017: Admin UI — server-rendered + islands (non-rewrite)

## Status
Accepted (2026-04-25)

## Context
Admin-UI architecture for a CMS in 2026.

- **SPA rewrite** (Next.js / React / Vue): the obvious modern path. **Risk**: rewrite-or-die gambits historically over-promise and under-deliver. Ghost's Ember admin is universally acknowledged as their biggest tech debt — no public rewrite has materialized in 3+ years. Sanity Studio is React-SPA but Sanity is JAMstack-shaped, not server-shaped.
- **Server-rendered + progressive enhancement**: Rails + Hotwire, Laravel + Livewire, Phoenix LiveView all demonstrate this pattern at top-tier quality in 2026. HTMX has pushed this further in the Node ecosystem.
- **Hybrid**: keep server-rendering, mount React/TipTap **islands** for genuinely interactive widgets only (rich-text editor, media browser, drag-drop builders, live preview iframe). Each island a small bundle, not a full SPA.

cms-core already has 100+ server-rendered templates (~17,545 LOC `modules/admin/index.js`). Throwing them out for an SPA rewrite would consume a year and stake the project on a rewrite gamble. The TS port is already absorbing the file-split refactor; admin SPA rewrite would explode scope.

## Decision
**Explicit non-rewrite.** Keep server-rendered admin; modernize incrementally.

- Template engine gains partial support (`{{> form-field}}`) — ~50 LOC addition. Eliminates the inline-style template problem.
- Typed component contract: `defineComponent({ name, props: z.object({...}), template: 'form-field.html' })`. Partials are no longer stringly-typed.
- **Islands** for complex widgets only — rich-text editor (TipTap), media browser, drag-drop block builder, live-preview iframe. Each island is mounted at a `data-island="..."` root, < 80KB gzip.
- esbuild is already in the pipeline; islands ride that.
- Design system: tokens stay in `admin.css`. Inline-style templates migrate. Dark mode via `light-dark()` CSS function — override layer deleted.
- Accessibility: skip links, `aria-live` on batch flows, focus-visible discipline, `<dialog>` for modals, `aria-invalid` + `aria-describedby` on forms.

## Consequences

**Positive:**
- Ships incrementally; doesn't gamble on a multi-quarter rewrite.
- Islands bound JS to where it actually helps (editor, browser, builder).
- Existing 100+ templates migrate one-by-one rather than all-or-nothing.
- Server-rendered admin is faster to first byte than SPA admin.

**Negative:**
- Some interactions (drag-and-drop, complex forms) feel less fluid than native SPA until islands mount.
- Existing 100+ templates have inline styles to migrate — meaningful manual work.
- Recruiting bias: candidates expect "modern admin UI = React SPA"; need to articulate the choice.

## References
- Rails Hotwire: hotwired.dev
- Phoenix LiveView: phoenixframework.org/blog/build-a-real-time-twitter-clone-in-15-minutes-with-live-view-and-phoenix-1-5
- Ghost admin tech-debt context: forum.ghost.org (Ember admin discussions, multi-year)
- Roadmap: Phase 6
