# Changelog

All notable changes to `cms-core` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
from `1.0.0` onward. Pre-1.0 minor bumps signal milestone progress, not API
stability.

## [Unreleased]

## [0.2.0] — 2026-04-20

### Security
- **CAPTCHA proof-of-work: align client and server hashing.** The previous
  implementation computed plain SHA-256 on the client (`crypto.subtle.digest`)
  and HMAC-SHA256 on the server (`createHmac('sha256', challenge).update(nonce)`).
  These produce different digests, so honest PoW submissions always failed.
  Both sides now compute plain `SHA-256(challenge || nonce)`; HMAC is retained
  only for signing the PoW envelope so the difficulty bits cannot be tampered
  with. Added `tests/unit/test-captcha-pow.js` round-tripping a client-equivalent
  nonce search against the server's `verifyPow()`.
- **Update system: reject path traversal in `downloadModuleUpdate`.** Every
  filename received from the registry now passes through
  `assertSafeChildPath()`, which rejects null-byte injection, absolute paths,
  and `../`-traversal before `writeFile` is called.
- **Update system: enforce HTTPS for the module registry.**
  `assertSafeRegistryUrl()` rejects any scheme other than `https://` for
  registry URLs, with an explicit allow-list for `localhost`, `127.0.0.1`, and
  `::1` to keep local development workflows working.
- **Update system: reject downgrades.** `downloadModuleUpdate()` now calls
  `compareVersions()` against the currently installed version and refuses to
  install a version that is not newer, blocking rollback attacks.
- **Update system: `registryConfig.autoCheck` now defaults to `false`.**
  Operators must explicitly opt in to automatic registry polling.
- **Update system: optional per-file SHA-256 verification.** When the registry
  supplies a digest in `files[filename].sha256`, `downloadModuleUpdate()`
  verifies it after each write and refuses mismatches.
- Ed25519 signing of the registry catalog is a larger supply-chain
  workstream and is intentionally deferred to a follow-up task; the file
  header calls this out.

### Changed
- Ported the following `core/*.js` files to TypeScript with full type
  annotations (Task 9 of the port plan, partial pass): `captcha`, `update`,
  `honeypot`, `discovery`, `ban`, `checklist`, `dependencies`,
  `math-evaluator`.
- Each port adds explicit interfaces for domain types and replaces
  `any`-style usage with `unknown` + narrowing. No behavioural changes.

### Deferred
- The remainder of Task 9 (~35 leaf `core/*.js` files, including the large
  `boot.js`, `cli.js`, `workspaces.js`, `graphql.js`, `jsonapi.js`,
  `plugins.js`, `backup.js`, `webform.js`) is scheduled for `0.2.1`/`0.3.0`.
- Task 10 (`core/lib/`) and Tasks 11–15 (modules, entry points, import sweep)
  remain scheduled toward `1.0.0`.

## [0.1.0] — 2026-04-20

### Added
- `LICENSE` (MIT) at repo root.
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1),
  `SECURITY.md`.
- GitHub issue templates (`bug`, `feature`, `config`) and PR template.
- GitHub Actions `ci` workflow: typecheck + lint + test on Node 22 / 24 / 25.
- GitHub Actions `release` workflow: drafts a GitHub Release on tag push.
- Biome lint + format configuration (`biome.json`).
- `node --test`-based test runner; `npm test`, `npm run test:watch`,
  `npm run check` scripts.
- `TYPE-DEBT.md` catalogue of existing `any` occurrences (burns down before
  `1.0.0`).
- README badges, "Project status" section, screenshots, inspiration credit
  to Drupal CMS.
- Two new SDC components: `accordion` and `accordion-container`.
- Dark-mode pass for 14 admin templates + admin.css override layer extension.
- Parity audit v4 (`PARITY-REPORT-2026-02-21.md`); 95.2% parity with Drupal CMS.

### Changed
- README dependency claim corrected: "Zero runtime dependencies in the
  framework core. Optional integrations: TipTap (`@tiptap/*`), `sharp` for
  image processing."
- Runtime state files (`content/.sessions/`, `content/**/.revisions/`,
  `config/.registry.json`, `.autoforge/*.db`) now `.gitignore`d.
- Older parity reports moved to `docs/archive/`.

### TypeScript Port (in flight, see [port plan](docs/plans/2026-02-22-typescript-port.md))
- Tasks 0–8 of the port plan are complete (foundation, infrastructure, content
  & data, database, AI/analytics/scheduling, media/SEO/search, UI/forms/rendering).
- Tasks 9–15 (remaining `core/*.js`, `core/lib/`, `boot.ts`, modules, root
  entry points, import sweep, verification) are scheduled for `0.2.0` →
  `1.0.0`.

[Unreleased]: https://github.com/blackhole-technologies/cms-core/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/blackhole-technologies/cms-core/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/blackhole-technologies/cms-core/releases/tag/v0.1.0
