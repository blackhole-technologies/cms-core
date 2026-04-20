# Security Policy

## Reporting a Vulnerability

If you have discovered a security vulnerability in `cms-core`, please report
it privately. **Do not file a public GitHub issue.**

**Email:** ernestomsaavedra@hotmail.com
**Subject prefix:** `[cms-core security]`

Please include:

- A clear description of the vulnerability and its potential impact.
- Steps to reproduce, including the affected version (`git rev-parse HEAD`).
- Any suggested mitigation, if you have one.

## Response

- We aim to acknowledge receipt within **72 hours**.
- We aim to provide an initial assessment within **7 days**.
- We coordinate disclosure with the reporter; default disclosure window is
  **90 days** from the initial report, or earlier if a fix is shipped.

## Scope

The following are in-scope for security reports:

- The CMS core (`core/`) and bundled modules (`modules/`).
- The HTTP server, authentication, session handling, CSRF protection,
  rate limiting, password storage, and input validation surfaces.
- Default themes and admin templates.

The following are out-of-scope:

- Vulnerabilities requiring physical access to the server filesystem.
- Self-inflicted misconfiguration (e.g., publishing the cookie secret).
- Third-party dependencies; report those upstream (see `package.json`).

## Supported Versions

| Version | Supported       |
|---------|-----------------|
| `1.x`   | Yes             |
| `0.x`   | Best effort     |
| `< 0.1` | No              |
