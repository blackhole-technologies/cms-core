# Contributing to cms-core

Thanks for considering a contribution. This document explains the dev setup, the conventions the project follows, and how to land a change.

If anything below is out of date with what's actually true in CI or the codebase, **the codebase wins** — please open a PR fixing this doc.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating you agree to uphold its terms.

---

## Branching model

```
feature/* ─→ next ─→ main
```

- **`main`** — released-software line. Every commit is signed and verified. Branch protection blocks direct pushes, force-pushes, deletions. All 8 required CI checks must be green; one PR approval required.
- **`next`** — long-lived integration branch. Feature PRs land here first. Same protection as `main` *minus* the signed-commit requirement (see [`.github/BRANCH-PROTECTION.md`](.github/BRANCH-PROTECTION.md) for the full delta).
- **`feature/*`** (or `pr/*`, `fix/*`) — short-lived branches you push. Open a PR into `next`. Squash-merge produces a clean linear history.
- **Releases** — periodic `next → main` merges (squash, signed by GitHub via web UI).

`main` is for releases, not for daily commits. If a PR would normally target `main` (e.g., a Phase 0 bootstrap PR establishing this very flow), call it out in the PR description.

---

## Development setup

### Prerequisites

- Node.js 22.x, 24.x, or 25.x
- A POSIX shell (Linux, macOS, WSL on Windows)
- Postgres 16+ (will be required from Phase 2 onward; not yet)

### Clone and install

```bash
git clone https://github.com/blackhole-technologies/cms-core.git
cd cms-core
npm install         # also installs lefthook hooks via `npm prepare`
npm start           # serves on http://localhost:3001
```

### Useful commands

```bash
npm run typecheck       # tsc --noEmit
npm run lint            # biome check
npm run lint:fix        # biome check --write
npm run format          # biome format --write
npm test                # node --test
npm run check:size      # file-size ceilings (.size-ignore grandfathers existing)
npm run check:layers    # layer-boundary lint (.layer-ignore for exceptions)
npm run check:drift     # schema-drift placeholder (real in Phase 2)
npm run check           # composite: typecheck → lint → test → size → layers → drift
```

`npm run check` is the source of truth — what CI runs is the same chain.

---

## Git hooks (lefthook)

`npm install` runs `npm prepare` which installs lefthook hooks at `.git/hooks/pre-commit` and `pre-push`.

- **pre-commit** — runs `biome check --write` on staged TS/JS/JSON files. Fixes are auto-restaged. Sub-second.
- **pre-push** — runs the full `npm run check` chain. Slower (~10–30s today) but bounded; push is a less-frequent boundary than commit.

If a hook fails, **fix the underlying issue**. Don't `--no-verify`. Hooks exist because we got bitten by skipping checks before, and CI will fail on the same things anyway.

### One safety rule from a past incident

**Never run `lefthook run <hook>` manually on a dirty tree.** If `{staged_files}` expands to empty, biome falls back to scanning the whole repo with `--write` and can clobber unstaged work. Hooks are safe on real commits (always have staged files) — only manual dry-runs trigger this. The `lefthook.yml` shell guard mitigates it but the rule still stands.

---

## Conventions

### Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/) informally:

- `feat(scope):` — new functionality
- `fix(scope):` — bug fix
- `chore(scope):` — non-functional change (deps, config, tooling)
- `docs:` — documentation only
- `refactor(scope):` — restructuring without behavior change
- `test(scope):` — adding or fixing tests
- `feat(ts):` — TypeScript port work

Not enforced by commitlint, but consistency helps with `git log` archaeology.

### Signed commits

`main` requires signed-and-verified commits. Two paths:

1. **Squash-merge via the GitHub web UI** — GitHub signs the resulting merge commit with its own key. Source PR commits don't need to be signed individually.
2. **Locally signed commits** — set up GPG or SSH signing:

```bash
# SSH (preferred — uses your existing SSH key):
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true

# GPG:
gpg --full-generate-key
git config --global user.signingkey <key-id>
git config --global commit.gpgsign true
```

Add the public key to GitHub under [Settings → SSH and GPG keys](https://github.com/settings/keys) marked as a *signing* key.

`next` does NOT require signed commits — local signing is optional there.

### TypeScript discipline (per the roadmap's invariant #1)

- `tsconfig.json` runs in `strict` + `noUncheckedIndexedAccess`.
- Don't use `any` in new code. Prefer `unknown` with type guards for genuinely dynamic values.
- Any new `any`, `!`, or `@ts-expect-error` requires an entry in [`TYPE-DEBT.md`](TYPE-DEBT.md) with the planned retirement commit.
- `@ts-ignore` is not allowed (use `@ts-expect-error` with a comment explaining why).

### File size ceilings (per invariant #3)

- `core/`, `src/core/` — 500 lines max
- `modules/`, `src/modules/` — 800 lines max
- Files exceeding the ceiling are grandfathered in `.size-ignore` with a comment naming the roadmap phase that splits them. New violations fail CI.

If a file you're editing pushes over the ceiling, **split it in the same PR** rather than adding to `.size-ignore`. The ignore list shrinks every phase; it doesn't grow.

### Layer boundaries (per invariant #4)

`scripts/check-layer-boundaries.ts` enforces a directed dependency graph between subsystems. Currently zero violations. Adding a new boundary cross requires a justification in `.layer-ignore`.

---

## Testing

- Test runner: `node --test` (built-in). Vitest replaces this in Phase 16 (per [ADR-018](docs/adr/018-testing-vitest-testcontainers-playwright.md)).
- Unit tests in `tests/unit/`, integration tests in `tests/integration/`.
- New test files use `node:test` + `node:assert/strict`.
- **Every mutation path needs a test** (per invariant #4). Security mutations (login, CSRF, upload, role change) need integration tests; data mutations need unit tests.
- Tests are also opportunistic during the in-flight TS port: bug fixed during conversion → test in the same PR.

---

## Architectural Decision Records

`docs/adr/` holds the durable record of each architectural decision. New decisions get a new ADR file using the standard Nygard format (Status / Context / Decision / Consequences / References).

When to write a new ADR:

- Adopting a new dependency that affects more than one subsystem
- Choosing one pattern over another for a hot code path
- Departing from a decision a previous ADR captured (link to the prior ADR; mark its Status as "Superseded by ADR-NNN")

When **not** to write an ADR: ordinary refactors, bug fixes, formatting decisions, scoped style choices.

Number ADRs sequentially with three-digit zero-padding: `001-…`, `002-…`. Filename slug is kebab-case of the decision title.

---

## Pull request process

1. **Branch** off `main` (or `next` once it's the daily branch). Name it `feature/<scope>`, `fix/<scope>`, or `pr/<number>-<scope>` for roadmap PRs.
2. **Commit** with conventional-commits style.
3. **Run `npm run check` locally** — pre-push will run it anyway, but failing fast saves a CI cycle.
4. **Open the PR** against `next` (or `main` for explicit release PRs from `next`). The PR template asks for a summary and a test plan.
5. **CI must be green** — 8 required status checks (typecheck, lint, test ×3 Node versions, file-size, layer-boundaries, schema-drift).
6. **One approval required.** External-contributor PRs need a maintainer review; for solo / admin work, configure a co-maintainer or the merge button stays disabled.
7. **Squash-merge via the web UI** — produces one clean signed commit on the target branch. Linear-history rule is preserved.

If CI fails on something the local hooks should have caught, file an issue: the hooks should mirror CI exactly, and any drift is a bug.

---

## Safety rules from past incidents

These rules exist because we got bitten. Read them.

### 1. Don't dry-run lefthook on a dirty tree

`lefthook run pre-commit` with nothing staged makes `{staged_files}` expand to empty. Biome without args runs `--write` on the whole project, can clobber unstaged work. The `lefthook.yml` shell guard short-circuits the empty case, but manual dry-runs are still the trigger — avoid them.

### 2. Don't `git filter-repo` with uncommitted work in the tree

`git filter-repo` runs `git reset --hard` after the rewrite. Tracked-file modifications get reset to the new HEAD; untracked files are left alone. If you have unstaged changes when you run filter-repo, **they're gone**.

Before any history-rewriting operation:

```bash
# either commit:
git add -A && git commit -m 'temp: pre-rewrite snapshot'
# ...or stash with --include-untracked:
git stash push --include-untracked -m 'pre-rewrite'
# ...or backup the tree:
tar czf ../<repo>-backup-$(date +%F).tgz \
  --exclude='<repo>/node_modules' <repo>
```

Backup is non-optional for irreversible operations.

### 3. Don't bypass branch protection

`main` and `next` enforce admins. Don't disable protection to push a "quick fix" — fix the protection rules instead, in a PR that updates [`.github/BRANCH-PROTECTION.md`](.github/BRANCH-PROTECTION.md).

---

## In-flight work

The TypeScript port is in progress under the [top-tier roadmap](docs/plans/2026-04-24-top-tier-roadmap.md) — 16 phases, 167 PRs, leading to a 1.0 release.

Phase 0 (guardrails, this set of tooling and conventions) is shipping now. Phase 1 absorbs the remaining `core/*.js → .ts` conversions plus a directory restructure to `src/core/<subsystem>/`. Subsequent phases land Postgres + Field API, Cache Tags, Config Management, the admin module split, security hardening, observability, and 1.0 quality bar.

For bug fixes in current `core/*.js` files: small fixes are welcome and ship straight; larger refactors should wait for the file's port phase to avoid double-work.
