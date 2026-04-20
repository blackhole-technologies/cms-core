# Contributing to cms-core

Thanks for considering a contribution. This document explains how to set up a
dev environment, the conventions the project follows, and how to get your
change merged.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By
participating you agree to uphold its terms.

## Development Setup

### Prerequisites

- Node.js 22.x, 24.x, or 25.x
- A POSIX-like shell (Linux, macOS, WSL on Windows)

### Install and run

```bash
git clone <your-fork-url> cms-core
cd cms-core
npm install
npm start          # serves on http://localhost:3001
```

Default admin login: `admin` / `admin` (change in `config/users.json`
before exposing to a network).

### Useful commands

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # biome check
npm run lint:fix    # biome check --write
npm run format      # biome format --write
npm test            # node --test
npm run check       # typecheck + lint + test (one shot)
```

## Project Structure

See [README.md](README.md#project-structure) for the high-level map.

## Conventions

### Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/) informally.
Common scopes:

- `feat(scope):` — new functionality
- `fix(scope):` — bug fix
- `chore(scope):` — non-functional change (deps, config, tooling)
- `docs:` — documentation only
- `refactor(scope):` — restructuring without behavior change
- `test(scope):` — adding or fixing tests
- `feat(ts):` — TypeScript port work

The convention is honored, not enforced — there's no commitlint in CI.

### TypeScript discipline

- `tsconfig.json` runs in `strict` mode with `noUncheckedIndexedAccess`.
- Do not use `any` in new code. Use `unknown` with type guards for
  genuinely dynamic values.
- Existing `any` occurrences are catalogued in [TYPE-DEBT.md](TYPE-DEBT.md)
  and burn down toward `1.0.0`. Don't add to that file in new code.
- `@ts-ignore` and `@ts-expect-error` are not allowed.

### File layout

- `core/` — framework subsystems. Service pattern: `export const name`,
  `export function init(ctx)`, `export function register(ctx, state)`.
- `modules/` — feature modules. Hook pattern: `export async function hook_<name>(ctx)`.
- `themes/` — themes and SDC components. See `themes/default/components/alert/`
  as a reference component.

### Tests

- Test runner: `node --test` (built-in).
- Unit tests in `tests/unit/`, integration tests in `tests/integration/`.
- New test files use `node:test` + `node:assert/strict`.
- Tests are opportunistic during the in-flight TS port: if you fix a bug or
  hit a surprise during conversion, add a test in the same PR. Backfill is
  a separate workstream after `1.0.0`.

## Pull Request Process

1. Fork, create a feature branch from `main`.
2. Make your change. Run `npm run check` locally.
3. Open a PR against `main`. Link any related issue.
4. CI must be green before merge. The `ci` status check runs typecheck +
   lint + tests on Node 22 / 24 / 25.
5. External contributor PRs require one review from a maintainer.

## In-Flight Work

The TypeScript port is in progress (see [the port plan](docs/plans/2026-02-22-typescript-port.md)
and [the roadmap design](docs/superpowers/specs/2026-04-17-cms-core-completion-roadmap-design.md)).
Avoid sweeping changes to `core/*.js` files until the port reaches them; small
bug fixes are welcome.
