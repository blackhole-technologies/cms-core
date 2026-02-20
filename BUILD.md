# Build Instructions

## Requirements

- Node.js 20+ (ES modules support)
- No external dependencies (uses Node.js built-ins only)

## Quick Start

```bash
node index.js        # Start CMS server
# or
npm start
```

Server starts at http://localhost:3001

## Project Structure

```
cms-core/
├── core/               # 106 core services
│   ├── boot.js         # 5-phase boot sequence
│   ├── config.js       # Configuration loader
│   ├── discovery.js    # Module/theme discovery
│   ├── hooks.js        # Event registry
│   └── services.js     # Service container
├── modules/            # 29 feature modules
├── themes/             # Layouts + skins
├── config/             # JSON configuration
│   ├── site.json       # Site metadata & theme config
│   └── modules.json    # Enabled modules list
├── content/            # Content storage (flat-file JSON)
├── tests/              # Test suite
│   ├── unit/           # Single-module tests
│   ├── integration/    # Cross-module tests
│   ├── browser/        # HTML test pages
│   ├── fixtures/       # Test data
│   └── scripts/        # Shell test scripts
└── index.js            # Entry point
```

## Boot Sequence

1. **INIT** — Load configuration from `/config`
2. **DISCOVER** — Scan `/modules` and `/themes`
3. **REGISTER** — Register services and hooks
4. **BOOT** — Initialize enabled modules
5. **READY** — HTTP server starts

## Running Tests

```bash
# Run a specific test
node tests/unit/test-typed-data.js
node tests/integration/test-fallback-chain.js

# Run all unit tests
for f in tests/unit/*.js; do node "$f"; done
```

## Configuration

Edit `config/site.json`:
- `port` — Server port (default: 3001)
- `theme` — Legacy template theme
- `themeEngine.layout` — Active layout (immersive, classic)
- `themeEngine.skin` — Active skin (consciousness-dark, etc.)

## Conversation Engine (Optional)

```bash
cd engines/conversation
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app
```

## Development

No build step — vanilla ES modules JavaScript. For watch mode:

```bash
npx nodemon index.js
```
