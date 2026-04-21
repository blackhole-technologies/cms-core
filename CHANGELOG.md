# Changelog

All notable changes to `cms-core` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
from `1.0.0` onward. Pre-1.0 minor bumps signal milestone progress, not API
stability.

## [Unreleased]

## [0.1.0] — 2026-MM-DD

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

[Unreleased]: https://github.com/blackhole-technologies/cms-core/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/blackhole-technologies/cms-core/releases/tag/v0.1.0
