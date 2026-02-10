# CMS-Core

Zero-dependency Node.js CMS with Drupal-inspired architecture.

## Quick Start

```bash
./init.sh                        # Start server on http://localhost:3001
node index.js help               # List 300+ CLI commands
node index.js modules:list       # Show enabled modules
```

## Technology Stack

- **Runtime:** Node.js 20+ (ES modules)
- **Dependencies:** ZERO npm packages
- **Storage:** Flat-file JSON
- **Server:** node:http (port 3001)
- **Architecture:** Service pattern (init/register exports)

## Project Structure

```
cms-core/
├── index.js              # Entry point (server + CLI)
├── init.sh               # Dev environment setup
├── core/                 # 91 core services
├── modules/              # Feature modules
├── config/               # JSON configuration
├── content/              # Flat-file content storage
├── themes/               # Theme engine
└── public/               # Static assets
```

## Core Features

- Content types with 21 field types
- Revision history
- Workflow state machine
- Media library
- JSON:API and GraphQL
- Theme engine (layouts + skins)
- Taxonomy, Comments, Search
- **Token system with fallback chains** (see below)
- 300+ CLI commands

### Token Fallback System

Smart token replacement with OR-separated fallback chains for graceful handling of missing data:

```javascript
// Basic fallback: use field:title, or "Untitled" if empty
{field:title|"Untitled"}

// Multi-level fallback: try multiple sources
{field:title|field:name|"No Title"}

// URL generation with fallbacks
<a href="/articles/{field:slug|field:title|"article"}">Read more</a>

// SEO meta tags
<title>{field:metaTitle|field:title|"Untitled"} | [site:name]</title>
```

**Features:**
- Left-to-right evaluation (stops at first non-empty value)
- Mixed with standard tokens: `{fallback|"default"}` and `[standard:token]`
- Quoted literals: `"double"` or `'single'` with escape support
- Performance: <5ms per token, early termination

**See:** [docs/token-fallback.md](docs/token-fallback.md) for full documentation

## Key APIs

```bash
# Content CRUD
node index.js content:create article '{"title":"Hello"}'
node index.js content:list --type=article
node index.js content:get article my-post

# Workflow
node index.js workflows:list
node index.js workflows:transition article my-post publish

# HTTP API
curl http://localhost:3001/jsonapi/node/article
curl http://localhost:3001/api/content/article
```

## Architecture

Every core service follows the pattern:

```javascript
export const name = 'serviceName';
export function init(context) { /* setup */ }
export function register(context, state) { /* hooks */ }
```

## License

MIT
