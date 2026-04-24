# Branch Protection Configuration

GitHub branch protection rules must be applied via the **Settings → Branches** UI
or via `gh api` — they cannot be declared in workflow YAML. This document is the
source of truth for the exact rules to apply; apply it exactly.

Referenced from: `docs/plans/2026-04-24-top-tier-roadmap.md` (Phase 0 PR 0.3,
Invariant #6 "CI is the truth").

---

## Protected branches

Both `main` and `next` are protected. `next` is the long-lived development branch;
PRs land there and `next` → `main` releases are cut periodically.

---

## Common rules (apply to BOTH `main` and `next`)

### Require a pull request before merging
- [x] **Require approvals:** 1 approval
- [x] **Dismiss stale pull request approvals when new commits are pushed**
- [x] **Require review from Code Owners** (activates when `CODEOWNERS` exists)

### Require status checks to pass before merging
- [x] **Require branches to be up to date before merging**
- Required status checks (exact check names — must match `name:` in `ci.yml`):
  - `typecheck`
  - `lint`
  - `test (Node 22.x)`
  - `test (Node 24.x)`
  - `test (Node 25.x)`
  - `file-size`
  - `layer-boundaries`
  - `schema-drift`

### Conversations & history
- [x] **Require conversation resolution before merging**
- [x] **Require linear history** (squash-merge produces a clean line)

### Pushes
- [x] **Restrict who can push to matching branches** — maintainers only
- [x] **Block force pushes**
- [x] **Do not allow deletions**

---

## `main`-only additions

- [x] **Require signed commits** (GPG or SSH)
- [x] **Do not allow bypassing the above settings** (even for admins — no exceptions)

Rationale: `main` is the released-software line. Every commit there should be
verifiable and no one — not even an admin in a hurry — bypasses the checks.

---

## `next`-only delta

- [ ] **Require signed commits** — *off*. `next` is the primary dev branch; signed
  commits on every feature PR would add too much friction. Signing is required only
  at the `next → main` promotion point.

---

## Applying the rules

### Option A — GitHub UI (fastest, one-time)
1. **Settings → Branches → Branch protection rules → Add rule**
2. Branch name pattern: `main`, then repeat for `next`
3. Check the boxes above for each branch.

### Option B — `gh api` (scriptable, for ops automation later)
```bash
# Example for 'main' — run with GH_TOKEN set to a classic PAT with `repo` scope.
gh api -X PUT "repos/:owner/:repo/branches/main/protection" \
  -H "Accept: application/vnd.github+json" \
  -f required_status_checks.strict=true \
  -F 'required_status_checks.contexts[]=typecheck' \
  -F 'required_status_checks.contexts[]=lint' \
  -F 'required_status_checks.contexts[]=test (Node 22.x)' \
  -F 'required_status_checks.contexts[]=test (Node 24.x)' \
  -F 'required_status_checks.contexts[]=test (Node 25.x)' \
  -F 'required_status_checks.contexts[]=file-size' \
  -F 'required_status_checks.contexts[]=layer-boundaries' \
  -F 'required_status_checks.contexts[]=schema-drift' \
  -f required_pull_request_reviews.required_approving_review_count=1 \
  -f required_pull_request_reviews.dismiss_stale_reviews=true \
  -f required_conversation_resolution=true \
  -f required_linear_history=true \
  -f allow_force_pushes=false \
  -f allow_deletions=false \
  -f required_signatures=true \
  -f enforce_admins=true
```

The REST reference: https://docs.github.com/en/rest/branches/branch-protection

---

## Maintenance

When a new required status check is added to `ci.yml`, this document must be
updated in the same PR and the branch protection rules re-applied — otherwise
the new check is advisory until someone notices. The converse applies when a
check is removed: update this doc and remove the rule (a required check that
never runs blocks every merge).
