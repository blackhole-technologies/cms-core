# ADR-018: Testing — vitest + testcontainers-postgres + Playwright

## Status
Accepted (2026-04-25)

## Context
Test framework selection for a TS-strict CMS in 2026.

- **Jest**: long-time default, but TS/ESM support has been rough for years (`ts-jest` workarounds, ESM transform issues). Slowed dev loops in TS-first codebases.
- **vitest**: ESM-native, Vite-powered, watch mode is fast. Has won over Jest in the TS/ESM world by 2026 (state-of-the-art notes in the roadmap doc).
- **node:test**: built-in, no deps. Less ergonomic; smaller mocking story.

Storage testing is the second axis. Mocking the database is a known anti-pattern: mocked tests pass, prod migrations fail. **testcontainers-node** spins up real Postgres per test suite; integration tests hit a real database with the real schema.

End-to-end testing:
- **Cypress**: long-time leader; UI excellent.
- **Playwright** (Microsoft): has surpassed Cypress on features by 2026 — multi-browser parallel, codegen, trace viewer with full DOM-and-network playback, native Node-process integration. CI-friendlier.

## Decision
- **Unit + integration**: vitest.
- **Storage layer**: real Postgres via testcontainers-node — never mock the DB.
- **End-to-end + security**: Playwright. Dedicated `tests/security/` suite for auth timing-attack resistance, CSRF replay, permission bypass, upload vectors, SSRF.

## Consequences

**Positive:**
- Real Postgres in CI catches mock/prod divergence (the bug class that broke previous projects).
- vitest's watch mode + speed = developer ergonomics; no `ts-jest` config arms race.
- Playwright's trace viewer makes CI failures reproducible — one click into the failed run shows the DOM, network, and console at every step.
- testcontainers + Playwright are both Docker-friendly; GitHub Actions has Docker out of the box.

**Negative:**
- testcontainers requires Docker on CI runners. Fine for GH Actions; non-trivial for some self-hosted setups.
- vitest is still maturing for some advanced Jest-specific features (`jest.useFakeTimers` semantics differ in edge cases).
- Playwright's three-browser default (Chromium / Firefox / WebKit) costs CI time; pin to Chromium for the inner loop, broaden in nightly runs.

## References
- vitest.dev
- node.testcontainers.org
- playwright.dev
- Roadmap: T12; Phase 16
