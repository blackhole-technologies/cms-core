# Icon Pack Plugin Example

This module demonstrates how to register custom icon packs in CMS-Core using the icon pack plugin system.

## Overview

The icon pack plugin system allows modules to extend the icon registry by registering their own icon packs. Icons from plugin packs are automatically discovered, indexed, and made available throughout the system.

## How It Works

1. **Hook Implementation**: Modules implement `hook_icon_packs_info(context)`
2. **Pack Registration**: Call `context.registerPack()` with pack configuration
3. **Automatic Discovery**: Icons are scanned from the pack's path during boot
4. **Global Availability**: Icons become available via the icon service API

## Plugin API

### Hook: `hook_icon_packs_info`

**When it runs**: During icon service initialization in the BOOT phase

**Parameters**:
- `context.registerPack(config)` - Function to register an icon pack
- `context.baseDir` - Project base directory

### Pack Configuration Schema

```javascript
{
  id: 'unique-pack-id',           // Required: Unique identifier
  name: 'Human Readable Name',    // Required: Display name
  description: 'Pack description', // Optional: Brief description
  version: '1.0.0',                // Optional: Pack version
  type: 'svg',                     // Required: Icon format (currently only 'svg')
  path: 'modules/mymodule/icons',  // Required: Directory with icon files
  prefix: 'myprefix',              // Required: Prefix for icon IDs
}
```

### Icon Naming

Icons are identified as: `{prefix}:{filename}`

Examples:
- `modules/mymodule/icons/rocket.svg` → `myprefix:rocket`
- `modules/mymodule/icons/solid/star.svg` → `myprefix:solid/star`

## Creating Your Own Icon Pack Module

### Step 1: Create Module Structure

```bash
mkdir -p modules/my_icon_pack/icons
```

### Step 2: Create manifest.json

```json
{
  "name": "my_icon_pack",
  "version": "1.0.0",
  "description": "My custom icon pack",
  "core": "0.0.x",
  "hooks": ["icon_packs_info"]
}
```

### Step 3: Implement hook_icon_packs_info

```javascript
// modules/my_icon_pack/index.js
export function hook_icon_packs_info(context) {
  context.registerPack({
    id: 'myicons',
    name: 'My Icons',
    description: 'Custom icons for my application',
    version: '1.0.0',
    type: 'svg',
    path: 'modules/my_icon_pack/icons',
    prefix: 'myicons',
  });
}
```

### Step 4: Add SVG Icons

Place your SVG files in `modules/my_icon_pack/icons/`:

```
modules/my_icon_pack/
  icons/
    rocket.svg       # Accessible as: myicons:rocket
    star.svg         # Accessible as: myicons:star
    solid/
      heart.svg      # Accessible as: myicons:solid/heart
```

### Step 5: Enable Module

Add to `config/modules.json`:

```json
{
  "enabled": [
    "my_icon_pack"
  ]
}
```

## Using Icons from Plugin Packs

### In JavaScript

```javascript
// Get icon service
const icons = services.get('icons');

// Get icon metadata
const icon = icons.getIcon('example:rocket');

// Search across all packs (including plugins)
const results = icons.searchIcons('rocket');

// Get SVG content
const svg = icons.getIconSvg('example:rocket');
```

### Via API

```bash
# Search for icons (includes plugin packs)
curl http://localhost:3000/api/icons/search?q=rocket

# Render icon from plugin pack
curl -X POST http://localhost:3000/api/icons/render \
  -H "Content-Type: application/json" \
  -d '{"name": "example:rocket", "size": "medium"}'
```

### In Templates (after Feature #6)

```twig
{{ icon('example:rocket', {size: 'large'}) }}
```

## CLI Commands

```bash
# List all packs (plugin packs marked with [plugin])
node index.js icons:packs

# Search icons from all packs
node index.js icons:search rocket

# Register a pack manually
node index.js icons:register-pack public/icons/custom svg
```

## Icon Pack Formats

### Supported Formats

Currently, only SVG files are supported:
- Individual .svg files
- Organized in subdirectories for variants
- Recursive directory scanning

### Future Format Support

The plugin API is designed to support additional formats:
- SVG sprite sheets
- Icon fonts (web fonts)
- Multiple formats from a single pack

## Validation

The plugin system validates pack configuration:

- **Duplicate IDs**: Warning logged, pack registration skipped
- **Missing Required Fields**: Error thrown with helpful message
- **Invalid Path**: Warning logged during discovery
- **Invalid SVG**: Error logged, icon skipped

## Pack Metadata

Plugin packs are tracked separately from config-defined packs:

```javascript
{
  id: 'example',
  name: 'Example Icons',
  source: 'plugin',  // Distinguishes from 'config' packs
  iconCount: 3,      // Discovered during scan
  // ... other metadata
}
```

## Best Practices

1. **Unique Prefixes**: Choose prefixes that won't conflict with other packs
2. **Descriptive Names**: Use clear, searchable icon filenames
3. **Organization**: Group related icons in subdirectories
4. **Optimization**: Optimize SVGs before including them
5. **Documentation**: Document available icons in your module README

## Troubleshooting

### Pack Not Appearing

1. Check module is enabled in `config/modules.json`
2. Check hook name is correct: `hook_icon_packs_info` (with underscores)
3. Check pack path is relative to project root
4. Check SVG files exist in the pack path

### Icons Not Rendering

1. Verify pack was registered: `node index.js icons:packs`
2. Check icon ID format: `{prefix}:{filename}`
3. Search for icon: `node index.js icons:search {name}`
4. Check SVG file is valid XML

## Example: Font Awesome Integration

To integrate Font Awesome as a plugin pack:

```javascript
export function hook_icon_packs_info(context) {
  context.registerPack({
    id: 'fontawesome',
    name: 'Font Awesome',
    description: 'Font Awesome icon library',
    version: '6.0.0',
    type: 'svg',
    path: 'node_modules/@fortawesome/fontawesome-free/svgs',
    prefix: 'fa',
  });
}
```

Icons would be available as: `fa:solid/star`, `fa:brands/github`, etc.

## Testing

Test your icon pack module:

```bash
# Start server
npm start

# List packs (should show your pack with [plugin] label)
node index.js icons:packs

# Search your icons
node index.js icons:search {your-icon-name}

# Render via API
curl -X POST http://localhost:3000/api/icons/render \
  -H "Content-Type: application/json" \
  -d '{"name": "{your-prefix}:{icon-name}", "size": "large"}'
```

## Related Features

- **Feature #1**: Icon discovery and registry service (foundation)
- **Feature #2**: Icon autocomplete form element (uses plugin packs)
- **Feature #3**: Icon pack plugin system (this feature)
- **Feature #4**: SVG icon rendering service (renders plugin pack icons)
- **Feature #5**: Icon preview in admin UI (displays plugin pack icons)
- **Feature #6**: Twig function for icon rendering (accesses plugin packs)

## License

This example module is part of CMS-Core and follows the same license.
