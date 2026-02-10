#!/usr/bin/env node
/**
 * Integration test for Plugin Type Manager (Feature #1)
 * Tests that it's properly registered and accessible during boot
 */

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { boot } from './core/boot.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('Testing Plugin Type Manager Integration...\n');

(async () => {
  try {
    // Boot the CMS
    const context = await boot(__dirname, { quiet: true });

    console.log('✓ CMS booted successfully');

    // Check that plugin_type.manager service exists
    const manager = context.services.get('plugin_type.manager');
    if (!manager) {
      throw new Error('plugin_type.manager service not found');
    }
    console.log('✓ plugin_type.manager service is registered');

    // Check that it has the expected methods
    const expectedMethods = [
      'registerPluginType',
      'getPluginType',
      'listPluginTypes',
      'getPluginTypesByCategory',
      'validatePluginType',
      'createPluginInstance',
      'hasPluginType',
      'clearPluginTypes',
    ];

    for (const method of expectedMethods) {
      if (typeof manager[method] !== 'function') {
        throw new Error(`Missing method: ${method}`);
      }
    }
    console.log('✓ All expected methods are present');

    // Register a test plugin type
    manager.registerPluginType('test_type', {
      label: 'Test Type',
      description: 'Integration test type',
      category: 'test',
    });
    console.log('✓ Can register plugin types');

    // Retrieve the type
    const testType = manager.getPluginType('test_type');
    if (!testType || testType.label !== 'Test Type') {
      throw new Error('Failed to retrieve registered type');
    }
    console.log('✓ Can retrieve registered plugin types');

    // List all types
    const types = manager.listPluginTypes();
    if (!Array.isArray(types) || types.length === 0) {
      throw new Error('listPluginTypes() returned invalid result');
    }
    console.log(`✓ listPluginTypes() returned ${types.length} type(s)`);

    // Filter by category
    const testTypes = manager.getPluginTypesByCategory('test');
    if (testTypes.length !== 1 || testTypes[0].name !== 'test_type') {
      throw new Error('Category filtering failed');
    }
    console.log('✓ Can filter plugin types by category');

    // Create an instance
    const instance = manager.createPluginInstance('test_type', {
      id: 'test_instance',
      custom: 'value',
    });
    if (!instance || instance.getPluginId() !== 'test_instance') {
      throw new Error('Failed to create plugin instance');
    }
    console.log('✓ Can create plugin instances');

    // Validate instance
    const validation = manager.validatePluginType('test_type', instance);
    if (!validation.valid) {
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
    }
    console.log('✓ Can validate plugin instances');

    console.log('\n' + '='.repeat(50));
    console.log('All integration tests passed!');
    console.log('='.repeat(50));

    process.exit(0);
  } catch (error) {
    console.error('\n✗ Integration test failed:');
    console.error(error.message);
    console.error(error.stack);
    process.exit(1);
  }
})();
