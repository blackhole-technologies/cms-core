# TypeScript Port — Full Conversion Design

**Date:** 2026-02-22
**Status:** Approved

---

## Goal

Convert the entire CMS codebase from JavaScript to TypeScript. Every `.js` file becomes `.ts`. No exceptions, no `any`, no `@ts-ignore`, strict mode throughout. The project runs TypeScript natively on Node 25 — no compilation step, no `.js` output.

## Constraints

- **Zero runtime dependencies** — only Node built-ins + `@types/node`
- **No `src/` or `dist/`** — files stay exactly where they are
- **No compiled artifacts** — no `.js`, `.d.ts`, or `.js.map` alongside source
- **Node 25 native execution** — `node server.ts`, strip-types built-in
- **`tsc --noEmit` only** — TypeScript compiler used as checker, not emitter
- **Strict mode** — `strict: true`, `noUncheckedIndexedAccess: true`
- **No `any`** — use `unknown` + type guards for genuinely dynamic values

## Scope

| Category | Files | Lines (approx) |
|----------|-------|-----------------|
| Core modules | ~112 | ~88,000 |
| Module entry points | 29 | ~30,000 |
| Root files (index, server, build) | 3 | ~500 |
| **Total** | **~145** | **~118,000** |

## Pre-Conversion Cleanup

Delete before starting conversion:

1. All existing `core/*.d.ts`, `core/*.d.ts.map`, `core/*.js.map`
2. All `core/**/*.d.ts`, `core/**/*.d.ts.map`, `core/**/*.js.map` in subdirectories
3. All existing `core/*.ts` files (fresh start from `.js` source)
4. All compiled `.js` in `core/database/`, `core/storage/`, `core/search/` subdirectories
5. `tsconfig.build.json` (no longer needed)

## Conversion Rules

For every file:

1. **Rename:** `git mv foo.js foo.ts`
2. **Imports:** Update `'./x.js'` → `'./x.ts'` in all import statements
3. **Lazy requires:** Convert 7 remaining `require('node:...')` → top-level `import`
4. **Function signatures:** Add parameter types and return types to every exported function
5. **Module state:** Type all module-level variables (`const services = {}` → `Record<string, ServiceEntry>`)
6. **HTTP layer:** Use `IncomingMessage` / `ServerResponse` from `node:http`
7. **Dynamic values:** Use `unknown` + type guards, never `any`
8. **Interfaces:** Define interfaces for core data structures (ContentItem, User, Config, etc.)

## Runtime Model

```
node server.ts          # Run the CMS (Node 25 native TS)
npx tsc                 # Type-check only (noEmit: true)
```

No build step. No watch mode for compilation. Development is: edit `.ts`, restart node.

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  },
  "include": [
    "core/**/*.ts",
    "modules/**/*.ts",
    "index.ts",
    "server.ts"
  ],
  "exclude": [
    "node_modules",
    "public",
    "themes",
    "content"
  ]
}
```

## package.json Changes

```json
{
  "main": "index.ts",
  "scripts": {
    "start": "node server.ts",
    "start:raw": "node index.ts",
    "typecheck": "tsc",
    "build": "node build.ts",
    "build:watch": "node build.ts --watch"
  }
}
```

Remove `build:ts` and `build:ts:watch` scripts (no longer applicable).

## Conversion Order

The conversion is a single pass (not incremental), but files should be processed in dependency order to minimize cascading errors during the port:

### Phase 1: Foundation (no internal imports)
- `core/utils.ts`, `core/config.ts`, `core/services.ts`

### Phase 2: Infrastructure
- `core/hooks.ts`, `core/cache.ts`, `core/template.ts`
- `core/auth.ts`, `core/csrf.ts`, `core/ratelimit.ts`
- `core/router.ts`, `core/server.ts`, `core/static.ts`

### Phase 3: Content & Data
- `core/content.ts` (was `core/content.js`, deleted — check if `.ts` exists)
- `core/fields.ts`, `core/validation.ts`, `core/entity.ts`
- `core/taxonomy.ts`, `core/menu.ts`, `core/comments.ts`
- Storage providers: `core/storage/*.ts`
- Database: `core/database/*.ts`

### Phase 4: Features
- All remaining `core/*.ts` files (search, media, SEO, analytics, etc.)

### Phase 5: Modules
- `modules/admin/index.ts` (17.5K lines — largest file)
- All other `modules/*/index.ts`

### Phase 6: Root
- `index.ts`, `server.ts`, `build.ts`

## Verification

The port is complete when:

1. `npx tsc` exits with zero errors
2. `node server.ts` starts the CMS successfully
3. No `.js`, `.d.ts`, or `.js.map` files remain in `core/` or `modules/`
4. Zero uses of `any` or `@ts-ignore` in the codebase
5. All imports use `.ts` extensions
