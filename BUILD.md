# Build Instructions

## Requirements

- Node.js 18.x or higher (ES modules support)
- No external dependencies (uses Node.js built-ins only)

## Quick Start

```bash
# Navigate to project
cd experiments/cms-core

# Run the CMS
node index.js
# or
npm start
```

## Project Structure

```
cms-core/
├── core/               # Core system modules
│   ├── boot.js         # Boot sequence orchestrator
│   ├── config.js       # Configuration loader
│   ├── discovery.js    # Module/theme discovery
│   ├── hooks.js        # Event registry
│   └── services.js     # Service container
├── modules/            # Installable modules (empty by default)
├── themes/             # Installable themes (empty by default)
├── config/             # JSON configuration files
│   ├── site.json       # Site metadata
│   └── modules.json    # Enabled modules list
├── content/            # Content storage (empty by default)
├── index.js            # Entry point
└── package.json        # Package metadata
```

## Boot Sequence

The CMS boots in five phases:

1. **INIT** - Load configuration files from `/config`
2. **DISCOVER** - Scan `/modules` and `/themes` for extensions
3. **REGISTER** - Register services and module hooks
4. **BOOT** - Initialize all enabled modules
5. **READY** - System ready (HTTP server would start here)

## Creating a Module

1. Create a directory in `/modules` (e.g., `/modules/my-module`)
2. Add a `manifest.json`:

```json
{
  "name": "my-module",
  "version": "1.0.0",
  "description": "My custom module"
}
```

3. Add the module to `/config/modules.json`:

```json
{
  "enabled": ["my-module"]
}
```

4. Create an `index.js` with register/boot exports (coming in v0.0.2)

## Environment Configuration

Edit `/config/site.json` to change:

- `name` - Site display name
- `version` - Site version
- `env` - Environment (`development`, `staging`, `production`)

## Troubleshooting

### "Config directory not found"
Ensure you're running from the project root where `/config` exists.

### "Config file not found"
Check that the required JSON files exist in `/config`.

### "Invalid JSON"
Validate your JSON files (trailing commas are not allowed in JSON).

## Development

No build step required - this is vanilla ES modules JavaScript.

For development:
```bash
# Watch mode (requires nodemon)
npx nodemon index.js
```
