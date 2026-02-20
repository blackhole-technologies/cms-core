# CMS-Core

Zero-dependency Node.js CMS with Drupal-inspired architecture.

**Version:** 0.0.80 | **Services:** 106 | **Modules:** 29 | **CLI Commands:** 352+

## Quick Start

```bash
node index.js                    # Start server on http://localhost:3001
node index.js help               # List all CLI commands
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
├── core/                 # 106 core services
├── modules/              # 29 feature modules
├── config/               # JSON configuration
├── content/              # Flat-file content storage
├── themes/               # Theme engine (layouts + skins)
├── specs/                # 20 feature specifications
├── tests/                # Test suite (unit, integration, browser, fixtures)
├── docs/                 # Technical documentation
├── engines/              # Conversation engine (Python/FastAPI)
├── public/               # Static assets
└── .archive/             # Archived sessions and logs
```

## Core Features

- Content types with 21 field types
- Revision history and workflow state machine
- Media library with WYSIWYG and responsive images
- JSON:API, GraphQL, and REST APIs
- Theme engine (layouts + skins separation)
- Token system with fallback chains
- AI provider system (Anthropic, OpenAI, Ollama)
- Taxonomy, comments, search, i18n
- 352+ CLI commands

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

Boot sequence: INIT → DISCOVER → REGISTER → BOOT → READY

## Documentation

- [Token Fallback System](docs/token-fallback.md)
- [CMS Specification](docs/CMS-SPECIFICATION.md)
- [Design System](docs/DESIGN-SYSTEM.md)
- [JSON:API](docs/JSONAPI.md)
- [Media Library](docs/MEDIA-LIBRARY.md)

## License

MIT
