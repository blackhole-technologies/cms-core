# ADR-016: Logging — pino + AsyncLocalStorage correlation

## Status
Accepted (2026-04-25)

## Context
Application logging for production CMS.

- **Winston**: mature but slow (5× slower than pino on identical workloads). Stream-based, with broad transport ecosystem.
- **Bunyan**: deprecated; original maintainer moved on.
- **pino**: 5× Winston's throughput, JSON-structured by default, child loggers for request correlation. Adopted by Payload v3, Fastify, and many of the high-perf TS frameworks.
- **`console.*`**: never the answer for production; output structure varies by framework, no correlation, perf cost.

Per-request log correlation (one ID threading through every log line in that request's scope) is essential for debugging production. Two ways to do it:
- **Threading context manually** through every function call (annoying, error-prone).
- **AsyncLocalStorage** — Node's built-in continuation-local-storage primitive. Set context once in middleware, every log call inside the request can access it.

## Decision
pino throughout, with AsyncLocalStorage-based child loggers for request correlation.

- `src/core/observability/logger.ts` exports the root pino instance.
- Per-request middleware creates a child logger with `request_id` and stores it in AsyncLocalStorage.
- Lint rule bans `console.*` in `src/`.
- Pretty-printing in dev via `pino-pretty`; structured JSON in prod for log aggregators.
- Transports for Loki / Datadog / Cloudwatch land via pino's transport ecosystem.

## Consequences

**Positive:**
- Production-grade structured logging.
- AsyncLocalStorage lets every code path emit correlated logs without threading context manually.
- pino's transport ecosystem covers all major aggregators.
- Adopted by Payload — a sizable reference deployment story.

**Negative:**
- AsyncLocalStorage has perf overhead (~5–10% on hot paths in benchmarks). Worth benchmarking before scaling out.
- pino's API is less plugin-rich than Winston's; some niche transports require shims.
- Lint rule banning `console.*` requires migration of existing code (legacy modules currently use `console.*`).

## References
- getpino.io
- Node docs: AsyncLocalStorage — nodejs.org/api/async_context.html
- Roadmap: T3; Phase 15
