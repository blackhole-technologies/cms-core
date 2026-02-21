# TypeScript Port Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert every `.js` file to `.ts` with strict types, no `any`, running natively on Node 25.

**Architecture:** In-place rename of ~145 files. Node 25 runs `.ts` natively (strip-types). `tsc --noEmit` for type-checking only. No compiled output. Radial dependency graph — boot.js imports ~91 modules, ~87 of which are leaf nodes with zero internal core dependencies.

**Tech Stack:** TypeScript 5.9, Node 25, `@types/node`

---

### Task 0: Pre-Conversion Cleanup

**Files:**
- Delete: all `core/*.d.ts`, `core/*.d.ts.map`, `core/*.js.map`
- Delete: all `core/**/*.d.ts`, `core/**/*.d.ts.map`, `core/**/*.js.map` in subdirectories
- Delete: all existing `core/*.ts` files (fresh start)
- Delete: all compiled `.js` in `core/database/`, `core/storage/`, `core/search/` (keep the `.ts` sources only if they were the originals — but per design we start from `.js`)
- Delete: `tsconfig.build.json`
- Delete: `core/services/*.cjs` files

**Step 1: Delete all stale TypeScript artifacts**

```bash
# Declaration files and source maps
find core/ -name '*.d.ts' -delete
find core/ -name '*.d.ts.map' -delete
find core/ -name '*.js.map' -delete

# Existing .ts source files (fresh start from .js)
find core/ -name '*.ts' -delete

# Compiled .js in subdirectories (these were compiled from .ts)
rm -f core/database/*.js core/storage/*.js core/search/*.js

# CJS files in services/
rm -f core/services/*.cjs core/services/*.cjs.map

# Old build config
rm -f tsconfig.build.json
```

**Step 2: Verify cleanup**

```bash
find core/ -name '*.ts' -o -name '*.d.ts' -o -name '*.js.map' | wc -l
# Expected: 0
```

**Step 3: Commit cleanup**

```bash
git add -A core/ tsconfig.build.json
git commit -m "chore: remove stale TS artifacts before full conversion"
```

---

### Task 1: Update tsconfig.json and package.json

**Files:**
- Modify: `tsconfig.json`
- Modify: `package.json`

**Step 1: Replace tsconfig.json**

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
    "server.ts",
    "build.ts"
  ],
  "exclude": [
    "node_modules",
    "public",
    "themes",
    "content"
  ]
}
```

**Step 2: Update package.json**

- Change `"main"` to `"index.ts"`
- Change scripts:
  - `"start"` → `"node server.ts"`
  - `"start:raw"` → `"node index.ts"`
  - `"typecheck"` → `"tsc"`
  - `"build"` → `"node build.ts"`
  - `"build:watch"` → `"node build.ts --watch"`
- Remove `"build:ts"` and `"build:ts:watch"` scripts

**Step 3: Commit**

```bash
git add tsconfig.json package.json
git commit -m "chore: update tsconfig and package.json for native TS execution"
```

---

### Task 2: Convert Foundation Files (Tier 0 — no internal imports)

These files have zero imports from other `core/` files. They define the base types everything else uses.

**Files (3):**
- Rename: `core/utils.js` → `core/utils.ts`
- Rename: `core/config.js` → `core/config.ts`
- Rename: `core/services.js` → `core/services.ts`

**Step 1: Rename files**

```bash
git mv core/utils.js core/utils.ts
git mv core/config.js core/config.ts
git mv core/services.js core/services.ts
```

**Step 2: Convert core/utils.ts**

- Add parameter types and return types to all exported functions
- Type the utility functions: `escapeHtml(str: string): string`, `deepMerge`, `generateId`, etc.
- Update any internal import extensions from `.js` to `.ts`

**Step 3: Convert core/config.ts**

- Type the config state: `let config: Record<string, unknown> = {}`
- Type `load()`, `get(key: string)`, `set(key: string, value: unknown)` signatures
- Define a `SiteConfig` interface for known config shape

**Step 4: Convert core/services.ts**

- Define `ServiceDescriptor` interface:
  ```typescript
  interface ServiceDescriptor {
    factory: () => unknown;
    instance: unknown;
    singleton: boolean;
  }
  ```
- Type the registry: `const services: Record<string, ServiceDescriptor> = {}`
- Type `register(name: string, factory: () => unknown, options?: { singleton?: boolean }): void`
- Type `get(name: string): unknown` (callers cast at call site)

**Step 5: Verify**

```bash
npx tsc 2>&1 | head -20
# Expect: errors only from files not yet converted (importing .js that doesn't exist)
```

**Step 6: Commit**

```bash
git add core/utils.ts core/config.ts core/services.ts
git commit -m "feat(ts): convert foundation files — utils, config, services"
```

---

### Task 3: Convert Infrastructure Files (Tier 1 — depend on foundation)

**Files (9):**
- `core/hooks.js` → `core/hooks.ts`
- `core/cache.js` → `core/cache.ts`
- `core/template.js` → `core/template.ts`
- `core/auth.js` → `core/auth.ts`
- `core/csrf.js` → `core/csrf.ts`
- `core/ratelimit.js` → `core/ratelimit.ts`
- `core/router.js` → `core/router.ts`
- `core/server.js` → `core/server.ts`
- `core/static.js` → `core/static.ts`

**Step 1: Rename all 9 files**

```bash
git mv core/hooks.js core/hooks.ts
git mv core/cache.js core/cache.ts
git mv core/template.js core/template.ts
git mv core/auth.js core/auth.ts
git mv core/csrf.js core/csrf.ts
git mv core/ratelimit.js core/ratelimit.ts
git mv core/router.js core/router.ts
git mv core/server.js core/server.ts
git mv core/static.js core/static.ts
```

**Step 2: Define shared HTTP types at top of core/router.ts**

```typescript
import { IncomingMessage, ServerResponse } from 'node:http';

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  context: RequestContext
) => Promise<void> | void;

export type MiddlewareHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  context: RequestContext,
  next: () => Promise<void>
) => Promise<void> | void;

export interface RequestContext {
  user?: { id: string; name: string; role: string };
  session?: { id: string; userId: string; timestamp: number };
  [key: string]: unknown;
}

export interface RouteDescriptor {
  method: string;
  path: string;
  handler: RouteHandler;
  description: string;
  source: string;
  pattern: RegExp;
  paramNames: string[];
}
```

**Step 3: Define hook types in core/hooks.ts**

```typescript
export type HookHandler = (context: Record<string, unknown>) => void | Promise<void>;

interface HookEntry {
  handler: HookHandler;
  priority: number;
  source: string | null;
}
```

**Step 4: Convert all 9 files**

For each file:
1. Update import extensions `.js` → `.ts`
2. Convert any `require()` → `import`
3. Add parameter types and return types to every exported function
4. Type module-level state variables
5. Use `IncomingMessage`/`ServerResponse` from `node:http` for HTTP handlers

**Step 5: Verify**

```bash
npx tsc 2>&1 | grep -c "error TS"
# Track error count — should be decreasing
```

**Step 6: Commit**

```bash
git add core/hooks.ts core/cache.ts core/template.ts core/auth.ts core/csrf.ts core/ratelimit.ts core/router.ts core/server.ts core/static.ts
git commit -m "feat(ts): convert infrastructure — hooks, cache, template, auth, csrf, ratelimit, router, server, static"
```

---

### Task 4: Convert Content & Data Layer

**Files (13+):**
- `core/content.js` → `core/content.ts` (NOTE: content.js is listed as deleted in git status — check if source exists)
- `core/fields.js` → `core/fields.ts`
- `core/validation.js` → `core/validation.ts`
- `core/entity.js` → `core/entity.ts`
- `core/entity-types.js` → `core/entity-types.ts`
- `core/entity-view-builder.js` → `core/entity-view-builder.ts`
- `core/entity-reference.js` → `core/entity-reference.ts`
- `core/taxonomy.js` → `core/taxonomy.ts`
- `core/menu.js` → `core/menu.ts`
- `core/comments.js` → `core/comments.ts`
- `core/content-types.js` → `core/content-types.ts`
- `core/field-storage.js` → `core/field-storage.ts`
- `core/typed-data.js` → `core/typed-data.ts`

**Step 1: Check content.js status**

```bash
git status core/content.js
# If deleted, check if core/content.ts already exists as the source
# If neither exists, check git log for last known version
```

**Step 2: Define core content types (at top of core/content.ts)**

```typescript
export interface ContentItem {
  id: string;
  type: string;
  title?: string;
  status?: string;
  created: string;
  updated: string;
  author?: string;
  slug?: string;
  [key: string]: unknown;
}

export interface ListOptions {
  page?: number;
  limit?: number;
  search?: string | null;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  filters?: Record<string, unknown> | null;
}

export interface ListResult {
  items: ContentItem[];
  total: number;
  page: number;
  pages: number;
}

export interface Schema {
  [fieldName: string]: FieldDef;
}

export interface FieldDef {
  type: string;
  required?: boolean;
  label?: string;
  [key: string]: unknown;
}
```

**Step 3: Rename and convert all 13 files**

For each: rename, update imports, add types, resolve errors.

**Step 4: Verify**

```bash
npx tsc 2>&1 | grep -c "error TS"
```

**Step 5: Commit**

```bash
git add core/content.ts core/fields.ts core/validation.ts core/entity.ts core/entity-types.ts core/entity-view-builder.ts core/entity-reference.ts core/taxonomy.ts core/menu.ts core/comments.ts core/content-types.ts core/field-storage.ts core/typed-data.ts
git commit -m "feat(ts): convert content & data layer — content, fields, validation, entity, taxonomy, menu"
```

---

### Task 5: Convert Storage & Database Subsystems

**Files:**
- `core/database.js` → `core/database.ts`
- `core/pg-client.js` → `core/pg-client.ts`
- Recreate `core/database/types.ts`, `core/database/backend-pg.ts`, `core/database/migrations.ts` from the `.js` versions
- Recreate `core/storage/provider.ts`, `core/storage/file-provider.ts`, `core/storage/pg-provider.ts` from `.js`
- Recreate `core/search/pg-backend.ts` from `.js`

**NOTE:** The subdirectory files were originally `.ts` that compiled to `.js`. After Task 0 cleanup, both were deleted. Convert from the `.js` that was committed to git (use `git show HEAD:core/database/types.js` etc. to recover if needed).

**Step 1: Rename core-level files**

```bash
git mv core/database.js core/database.ts
git mv core/pg-client.js core/pg-client.ts
```

**Step 2: Recreate subdirectory files as .ts (convert from last committed .js)**

For each subdirectory file: create the `.ts` version with full types from the `.js` source.

**Step 3: Verify and commit**

```bash
git add core/database.ts core/pg-client.ts core/database/ core/storage/ core/search/
git commit -m "feat(ts): convert storage & database subsystems"
```

---

### Task 6: Convert Leaf Core Files — Batch A (AI & Analytics)

**Files (14):**
- `core/ai-agents.js`, `core/ai-provider-manager.js`, `core/ai-rate-limiter.js`, `core/ai-registry.js`, `core/ai-stats.js`
- `core/analytics.js`, `core/audit.js`, `core/activity.js`
- `core/actions.js`, `core/conditions.js`
- `core/queue.js`, `core/cron.js`, `core/scheduler.js`
- `core/function-call-plugins.js`

**Step 1: Rename all 14**

```bash
for f in core/ai-agents.js core/ai-provider-manager.js core/ai-rate-limiter.js core/ai-registry.js core/ai-stats.js core/analytics.js core/audit.js core/activity.js core/actions.js core/conditions.js core/queue.js core/cron.js core/scheduler.js core/function-call-plugins.js; do
  git mv "$f" "${f%.js}.ts"
done
```

**Step 2: Convert each — add types, update imports**

**Step 3: Commit**

```bash
git add core/ai-*.ts core/analytics.ts core/audit.ts core/activity.ts core/actions.ts core/conditions.ts core/queue.ts core/cron.ts core/scheduler.ts core/function-call-plugins.ts
git commit -m "feat(ts): convert AI, analytics, actions, scheduling core files"
```

---

### Task 7: Convert Leaf Core Files — Batch B (Media, SEO, Search)

**Files (12):**
- `core/media.js`, `core/media-library.js`, `core/image-styles.js`, `core/responsive-images.js`, `core/oembed.js`
- `core/search.js`
- `core/seo.js`, `core/sitemap.js`, `core/path-aliases.js`, `core/feeds.js`
- `core/slugify.js`, `core/tokens.js`

**Step 1: Rename all 12**

```bash
for f in core/media.js core/media-library.js core/image-styles.js core/responsive-images.js core/oembed.js core/search.js core/seo.js core/sitemap.js core/path-aliases.js core/feeds.js core/slugify.js core/tokens.js; do
  git mv "$f" "${f%.js}.ts"
done
```

**Step 2: Convert each — add types, update imports**

**Step 3: Commit**

```bash
git add core/media.ts core/media-library.ts core/image-styles.ts core/responsive-images.ts core/oembed.ts core/search.ts core/seo.ts core/sitemap.ts core/path-aliases.ts core/feeds.ts core/slugify.ts core/tokens.ts
git commit -m "feat(ts): convert media, SEO, search, slugify core files"
```

---

### Task 8: Convert Leaf Core Files — Batch C (UI, Forms, Rendering)

**Files (16):**
- `core/form.js`, `core/forms.js`
- `core/render.js`, `core/regions.js`, `core/blocks.js`, `core/layout-builder.js`
- `core/editor.js`, `core/text-formats.js`
- `core/theme-system.js`, `core/theme-engine.js`, `core/theme-settings.js`
- `core/sdc.js`, `core/display-modes.js`, `core/contextual.js`
- `core/accessibility.js`, `core/icon-renderer.js`

**Step 1: Rename all 16**

```bash
for f in core/form.js core/forms.js core/render.js core/regions.js core/blocks.js core/layout-builder.js core/editor.js core/text-formats.js core/theme-system.js core/theme-engine.js core/theme-settings.js core/sdc.js core/display-modes.js core/contextual.js core/accessibility.js core/icon-renderer.js; do
  git mv "$f" "${f%.js}.ts"
done
```

**Step 2: Convert each — add types, update imports**

**Step 3: Commit**

```bash
git add core/form.ts core/forms.ts core/render.ts core/regions.ts core/blocks.ts core/layout-builder.ts core/editor.ts core/text-formats.ts core/theme-system.ts core/theme-engine.ts core/theme-settings.ts core/sdc.ts core/display-modes.ts core/contextual.ts core/accessibility.ts core/icon-renderer.ts
git commit -m "feat(ts): convert UI, forms, rendering, theming core files"
```

---

### Task 9: Convert Leaf Core Files — Batch D (Remaining)

**Files (~25):**
- `core/backup.js`, `core/ban.js`, `core/batch.js`, `core/blueprints.js`
- `core/cache-backend.js`, `core/captcha.js`, `core/checklist.js`, `core/cli.js`
- `core/compare.js`, `core/config-management.js`, `core/constraints.js`, `core/contact.js`
- `core/dependencies.js`, `core/discovery.js`
- `core/email.js`, `core/favorites.js`, `core/graphql.js`
- `core/help.js`, `core/history.js`, `core/honeypot.js`
- `core/i18n.js`, `core/icons.js`, `core/jsonapi.js`
- `core/locks.js`, `core/math-evaluator.js`
- `core/notifications.js`, `core/permissions.js`, `core/plugins.js`
- `core/preview.js`, `core/status.js`, `core/transfer.js`
- `core/update.js`, `core/user-fields.js`
- `core/views.js`, `core/watcher.js`, `core/webform.js`, `core/webhooks.js`
- `core/workflow-advanced.js`, `core/workspaces.js`
- `core/ajax.js`, `core/api-version.js`, `core/archetypes.js`
- `core/plugin-type-manager.js`

**Step 1: Rename all remaining core/*.js files**

```bash
for f in core/*.js; do
  git mv "$f" "${f%.js}.ts"
done
```

**Step 2: Convert each — add types, update imports**

**Step 3: Verify no .js remains in core/**

```bash
find core/ -name '*.js' | wc -l
# Expected: 0
```

**Step 4: Commit**

```bash
git add core/
git commit -m "feat(ts): convert all remaining core files"
```

---

### Task 10: Convert core/lib/ Subsystem

**Files (~40 across 10 subdirectories):**
- `core/lib/Access/` — AccessPolicy.js, AccessResult.js, index.js
- `core/lib/Bridge/` — DeprecationLogger.js, HookBridge.js, ServiceBridge.js, index.js
- `core/lib/Config/` — ConfigEntity.js, ConfigEntityStorage.js, ConfigSchema.js, index.js
- `core/lib/DependencyInjection/` — Container.js, Reference.js, index.js
- `core/lib/Entity/` — EntityQuery.js, EntityTypeManager.js, index.js
- `core/lib/Form/` — FormBase.js, FormBuilder.js, FormState.js, index.js
- `core/lib/Hook/` — HookManager.js, index.js
- `core/lib/Plugin/` — AIProvider.js, FunctionCallPlugin.js, FunctionCallPluginManager.js, PluginBase.js, PluginManager.js, index.js
- `core/lib/Render/` — Attribute.js, CacheMetadata.js, RenderArray.js, Renderer.js, index.js + Element/ subdir
- `core/lib/Twig/` — CvaExtension.js, CvaSchema.js, index.js

**Step 1: Rename all lib .js files**

```bash
find core/lib/ -name '*.js' -exec bash -c 'git mv "$0" "${0%.js}.ts"' {} \;
```

**Step 2: Convert each — add class types, interface exports, method signatures**

These files use class-based patterns (PluginBase, FormBase, etc.) — add proper class member types, constructor parameter types, and method return types.

**Step 3: Verify and commit**

```bash
find core/lib/ -name '*.js' | wc -l
# Expected: 0
git add core/lib/
git commit -m "feat(ts): convert core/lib/ — Access, Bridge, Config, DI, Entity, Form, Hook, Plugin, Render, Twig"
```

---

### Task 11: Convert Boot Orchestrator

**Files (1):**
- `core/boot.js` → `core/boot.ts` (4,472 lines, 91 imports)

**Step 1: Rename**

```bash
git mv core/boot.js core/boot.ts
```

**Step 2: Update all ~91 import statements**

Change every `from './xxx.js'` → `from './xxx.ts'`

**Step 3: Type boot phases**

```typescript
interface BootPhase {
  name: string;
  fn: () => Promise<void>;
}

interface BootContext {
  config: Record<string, unknown>;
  modules: ModuleDescriptor[];
  [key: string]: unknown;
}

interface ModuleDescriptor {
  name: string;
  path: string;
  hooks: Record<string, Function>;
}
```

**Step 4: Type all phase functions and module loading**

**Step 5: Verify and commit**

```bash
git add core/boot.ts
git commit -m "feat(ts): convert boot orchestrator — 91 imports updated"
```

---

### Task 12: Convert Modules

**Files (29 modules):**

Process in order of size (largest first — most likely to surface type issues):

1. `modules/admin/index.js` (17,545 lines) — the beast
2. `modules/ai_dashboard/index.js` (2,449 lines)
3. `modules/ai_image_alt/index.js` (1,687 lines)
4. `modules/users/index.js` (1,615 lines)
5. `modules/linkit/index.js` (1,122 lines)
6. `modules/tagify-widget/index.js` (1,039 lines)
7. All remaining 23 modules (< 900 lines each)

**Step 1: Rename all module entry points**

```bash
for f in modules/*/index.js; do
  git mv "$f" "${f%.js}.ts"
done
```

**Step 2: Convert modules/admin/index.ts**

This is the largest file. Key patterns to type:
- `parseFormBody(req: IncomingMessage): Promise<Record<string, string | string[]>>`
- All `hook_boot`, `hook_cli` exports with proper signatures
- Route handlers: `(req: IncomingMessage, res: ServerResponse, params: Record<string, string>, ctx: RequestContext) => Promise<void>`
- Template data objects passed to `renderAdmin()`

**Step 3: Convert remaining modules**

Each module follows the same pattern: exports `hook_boot`, `hook_cli`, and other hook functions.

**Step 4: Verify and commit**

```bash
find modules/ -name '*.js' | wc -l
# Expected: 0
git add modules/
git commit -m "feat(ts): convert all 29 modules"
```

---

### Task 13: Convert Root Entry Points

**Files (3):**
- `index.js` → `index.ts`
- `server.js` → `server.ts`
- `build.js` → `build.ts`

**Step 1: Rename**

```bash
git mv index.js index.ts
git mv server.js server.ts
git mv build.js build.ts
```

**Step 2: Convert each — update imports, add types**

**Step 3: Commit**

```bash
git add index.ts server.ts build.ts
git commit -m "feat(ts): convert root entry points"
```

---

### Task 14: Update All Cross-File Import Extensions

**Step 1: Global search for remaining `.js` import references**

```bash
grep -r "from '.*\.js'" core/ modules/ index.ts server.ts build.ts --include='*.ts' -l
```

**Step 2: Replace all `.js` extensions in imports with `.ts`**

For every file found, update import extensions.

**Step 3: Replace remaining `require()` calls with `import`**

The 7 known locations:
- `core/email.ts:623` — `require('node:fs')` → top-level import
- `core/activity.ts:852` — `require('node:fs')` → top-level import
- `core/actions.ts:850` — `require('node:https')` / `require('node:http')` → top-level import
- `core/static.ts:366` — `require('node:fs')` → top-level import
- `core/audit.ts:648` — `require('node:fs')` → top-level import
- `core/analytics.ts:874` — `require('fs')` → top-level import

**Step 4: Verify no `.js` imports remain**

```bash
grep -r "from '.*\.js'" core/ modules/ index.ts server.ts build.ts --include='*.ts' | wc -l
# Expected: 0
grep -r "require(" core/ modules/ --include='*.ts' | wc -l
# Expected: 0
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(ts): update all import extensions to .ts, remove require() calls"
```

---

### Task 15: Final Verification

**Step 1: Type-check the entire project**

```bash
npx tsc
# Expected: 0 errors
```

**Step 2: Verify no `any` or `@ts-ignore`**

```bash
grep -r '\bany\b' core/ modules/ index.ts server.ts --include='*.ts' | grep -v '// ' | grep -v 'unknown' | head -20
grep -r '@ts-ignore' core/ modules/ --include='*.ts' | wc -l
# Expected: 0
```

**Step 3: Verify no .js files remain in core/ or modules/**

```bash
find core/ -name '*.js' | wc -l
find modules/ -name '*.js' | wc -l
# Expected: 0 for both
```

**Step 4: Verify the CMS starts**

```bash
node server.ts &
sleep 3
curl -s http://localhost:3001 | head -5
kill %1
```

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat(ts): complete TypeScript port — all files converted, zero errors"
```

---

## Conversion Reference: Typing Patterns

### Pattern 1: Module State
```typescript
// Before (JS)
const items = {};

// After (TS)
interface ItemEntry { name: string; handler: Function; }
const items: Record<string, ItemEntry> = {};
```

### Pattern 2: Hook Handlers
```typescript
// Before (JS)
export async function hook_boot(context) { ... }

// After (TS)
export async function hook_boot(context: BootContext): Promise<void> { ... }
```

### Pattern 3: HTTP Handlers
```typescript
import { IncomingMessage, ServerResponse } from 'node:http';

// Before (JS)
function handleRequest(req, res, params, ctx) { ... }

// After (TS)
function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  ctx: RequestContext
): Promise<void> { ... }
```

### Pattern 4: Dynamic Lookups
```typescript
// Before (JS)
const value = obj[key];

// After (TS)
const value: unknown = obj[key]; // noUncheckedIndexedAccess makes this T | undefined
if (typeof value === 'string') {
  // value is string here
}
```

### Pattern 5: Lazy Node Built-in Imports
```typescript
// Before (JS)
const { createReadStream } = require('node:fs');

// After (TS) — move to top of file
import { createReadStream } from 'node:fs';
```
