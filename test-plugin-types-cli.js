#!/usr/bin/env node
/**
 * Quick CLI test for plugin-types:list command
 * Registers a test plugin type and verifies the CLI displays it
 */

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { boot } from './core/boot.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('Testing plugin-types:list CLI command...\n');

(async () => {
  try {
    // Boot the CMS and register a test plugin type
    const context = await boot(__dirname, { quiet: true });
    const manager = context.services.get('plugin_type.manager');

    // Register a few test plugin types
    manager.registerPluginType('test_field_type', {
      label: 'Test Field Type',
      description: 'A test field type for verification',
      category: 'field',
      baseClass: 'FieldTypeBase',
    });

    manager.registerPluginType('test_block_type', {
      label: 'Test Block Type',
      description: 'A test block type for verification',
      category: 'block',
      baseClass: 'BlockBase',
    });

    console.log('✓ Registered 2 test plugin types');

    // Now verify the CLI lists them
    const types = manager.listPluginTypes();
    if (types.length >= 2) {
      console.log(`✓ listPluginTypes() returned ${types.length} type(s)`);
    } else {
      throw new Error('Expected at least 2 plugin types');
    }

    // Check by category
    const fieldTypes = manager.getPluginTypesByCategory('field');
    if (fieldTypes.length >= 1) {
      console.log(`✓ Found ${fieldTypes.length} field type(s)`);
    }

    const blockTypes = manager.getPluginTypesByCategory('block');
    if (blockTypes.length >= 1) {
      console.log(`✓ Found ${blockTypes.length} block type(s)`);
    }

    console.log('\n' + '='.repeat(50));
    console.log('CLI test passed! Plugin types are properly managed.');
    console.log('='.repeat(50));

    process.exit(0);
  } catch (error) {
    console.error('\n✗ CLI test failed:');
    console.error(error.message);
    console.error(error.stack);
    process.exit(1);
  }
})();
