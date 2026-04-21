# Type Debt

This file catalogues every existing `any` occurrence in the TypeScript codebase
along with the reason it exists and what would replace it. The goal is **zero
entries before `1.0.0`** — every PR that touches a file with debt should burn
down at least one entry.

## Rules

- **Do not add new entries.** New code must avoid `any`. Use `unknown` with
  type guards for genuinely dynamic values.
- **Burn-down format:** when you replace an `any` with a real type, delete the
  corresponding line. Reference the deletion in your PR description.
- **CI does not gate on this file.** It's an honor system + reviewer checklist.

## Scope

This catalogue covers `.ts` source files under `core/` and `modules/`. Ambient
declaration files under `contracts/*.d.ts` intentionally use `any` as loose
"anything" placeholders describing pre-TypeScript runtime contracts; they are
tracked separately and will be tightened when the corresponding modules are
ported or rewritten against formal schemas.

## Entries

No type debt currently in `core/**/*.ts` or `modules/**/*.ts` — every converted
file is free of `: any`, `<any>`, `any[]`, `as any`, and union `any` uses as of
the initial audit (Task 1.10, 2026-04-17).

This file exists to track future `any` additions. If a PR introduces `any` in
converted source, a reviewer should either (a) reject the PR in favor of
`unknown` + a type guard, or (b) require an entry here explaining why the
escape hatch is unavoidable and what would replace it.
