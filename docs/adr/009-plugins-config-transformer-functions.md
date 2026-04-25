# ADR-009: Plugins — config-transformer functions

## Status
Accepted (2026-04-25)

## Context
Plugin systems vary widely.

- **Drupal**: `hook_*` + plugin manager + service container. Three lifecycle concepts; large surface area; OOP attributes added in D11.
- **WordPress**: hooks + filters + a global `register_*` API. Untyped, side-effecting registrations.
- **Keystone**: typed config object extension, but no first-class plugin contract.
- **Payload**: a plugin is `(opts) => (config: Config) => Config`. Pure function. Composition is `pipe(p1, p2, p3)(baseConfig)`.

Payload's pattern collapses plugin architecture into function composition. No registration ceremony, no lifecycle, trivially testable.

## Decision
Adopt Payload's plugin-as-config-transformer pattern.

- A plugin is a curried function: `(options) => (config: CMSConfig): CMSConfig`.
- Plugins receive the full config and return a new (or mutated) config.
- Composition is `const finalConfig = pipe(seoPlugin(opts1), stripePlugin(opts2))(baseConfig)`.
- No registration API, no lifecycle, no service container.

```ts
export const seoPlugin = (opts) => (config) => ({
  ...config,
  collections: config.collections?.map(c =>
    opts.collections?.includes(c.slug)
      ? { ...c, fields: [...c.fields, metaGroupField(opts)] }
      : c),
})
```

## Consequences

**Positive:**
- Plugins are pure functions — trivially testable in isolation.
- No registration ceremony.
- Composition is just function composition; order is explicit at the call site.
- Type-safe: each plugin's output is a `CMSConfig`, the next plugin's input.

**Negative:**
- Plugins need to know the full config shape — large API surface.
- Order of plugin application matters (later plugins see earlier plugins' output).
- No built-in conflict detection if two plugins clobber the same field.

## References
- Payload source: `packages/plugin-seo/src/index.ts`
- Payload source: `packages/plugin-stripe/src/index.ts`
- Payload source: `packages/plugin-search/src/index.ts`
- Roadmap: Phase 5
