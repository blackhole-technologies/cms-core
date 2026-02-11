/**
 * icon_pack_example/index.js - Example Icon Pack Plugin
 *
 * WHY THIS MODULE EXISTS:
 * Demonstrates how third-party modules can register custom icon packs
 * using the icon pack plugin system. This module shows the minimal
 * code needed to add a new icon pack.
 *
 * PLUGIN PATTERN:
 * 1. Implement hook_icon_packs_info(context)
 * 2. Call context.registerPack() with pack configuration
 * 3. Icons are automatically discovered from the pack's path
 *
 * PACK CONFIGURATION:
 * - id: Unique identifier for the pack (used in icon IDs)
 * - name: Human-readable name for the pack
 * - description: Brief description of the icon pack
 * - path: Directory containing SVG files (relative to project root)
 * - prefix: Prefix for icon IDs (e.g., "example" → "example:icon-name")
 * - type: Icon format (currently only "svg" is supported)
 * - version: Pack version (optional)
 *
 * ICON ID FORMAT:
 * Icons from this pack will be accessible as: "example:icon-name"
 * Example: icons.getIcon('example:rocket')
 */

/**
 * Icon pack registration hook
 *
 * WHEN THIS RUNS:
 * Called during the BOOT phase when the icon service initializes.
 * This is before icon discovery, so modules can register packs
 * before the filesystem scan happens.
 *
 * @param {Object} context - Hook context
 * @param {Function} context.registerPack - Function to register icon packs
 * @param {string} context.baseDir - Project base directory
 */
export function hook_icon_packs_info(context) {
  // Register a custom icon pack
  context.registerPack({
    id: 'example',
    name: 'Example Icons',
    description: 'Custom icon pack demonstrating the plugin system',
    version: '1.0.0',
    type: 'svg',
    path: 'modules/icon_pack_example/icons',
    prefix: 'example',
  });
}

/**
 * EXTENDING THIS EXAMPLE:
 *
 * To create your own icon pack module:
 *
 * 1. Create a new module directory: modules/your_icon_pack/
 * 2. Add manifest.json with "icon_packs_info" in hooks array
 * 3. Create index.js with hook_icon_packs_info implementation
 * 4. Add your SVG icons to: modules/your_icon_pack/icons/
 * 5. Enable the module in config/modules.json
 *
 * Your icons will be automatically discovered and available as:
 * "yourprefix:icon-name"
 *
 * SUPPORTED ICON FORMATS:
 * - SVG files (individual .svg files)
 * - Subdirectories (for organizing variants like solid/outline)
 *
 * ICON DISCOVERY:
 * - Recursive: Subdirectories are scanned for icons
 * - Variants: Icons in subdirs get variant tags (e.g., "solid", "outline")
 * - Naming: Filename (without .svg) becomes the icon name
 *
 * EXAMPLE DIRECTORY STRUCTURE:
 * modules/your_icon_pack/
 *   icons/
 *     rocket.svg          → "yourprefix:rocket"
 *     solid/
 *       star.svg          → "yourprefix:solid/star" (variant: solid)
 *     outline/
 *       star.svg          → "yourprefix:outline/star" (variant: outline)
 */
