#!/usr/bin/env node
/**
 * Comprehensive Regression Test for Feature #1: Plugin Type Manager
 *
 * Verification Steps from app_spec.txt:
 * 1. Create core/plugin-type-manager.js with init/register exports ✓
 * 2. Implement registerPluginType(typeName, definition) method ✓
 * 3. Implement getPluginType(typeName) for retrieval ✓
 * 4. Implement listPluginTypes() to return all registered types ✓
 * 5. Implement validatePluginType(typeName, instance) for validation ✓
 * 6. Add createPluginInstance(typeName, config) factory method ✓
 * 7. Support plugin type metadata (label, description, category) ✓
 * 8. Add getPluginTypesByCategory(category) filtering ✓
 * 9. Test plugin type registration via CLI: node index.js plugin-types:list ✓
 * 10. Verify plugin type validation catches invalid configurations ✓
 * 11. Ensure service is available in context.services ✓
 */

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { boot } from '../../core/boot.js';
import * as pluginTypeManager from '../../core/plugin-type-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('='.repeat(60));
console.log('REGRESSION TEST: Feature #1 - Plugin Type Manager');
console.log('='.repeat(60));
console.log('');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${error.message}`);
    failed++;
  }
}

async function runTests() {
  console.log('STEP 1: Module Structure Tests\n');

  test('core/plugin-type-manager.js exports init function', () => {
    if (typeof pluginTypeManager.init !== 'function') {
      throw new Error('init function not exported');
    }
  });

  test('core/plugin-type-manager.js exports register function', () => {
    if (typeof pluginTypeManager.register !== 'function') {
      throw new Error('register function not exported');
    }
  });

  console.log('');
  console.log('STEP 2: API Methods Tests\n');

  // Clear any existing types for clean test
  pluginTypeManager.clearPluginTypes();

  test('registerPluginType() works correctly', () => {
    pluginTypeManager.registerPluginType('test_type', {
      label: 'Test Type',
      description: 'Test plugin type',
      category: 'test',
    });
    const type = pluginTypeManager.getPluginType('test_type');
    if (!type || type.label !== 'Test Type') {
      throw new Error('Type not properly registered');
    }
  });

  test('getPluginType() retrieves registered types', () => {
    const type = pluginTypeManager.getPluginType('test_type');
    if (!type) throw new Error('Type not found');
    if (type.name !== 'test_type') throw new Error('Type name mismatch');
  });

  test('listPluginTypes() returns all registered types', () => {
    const types = pluginTypeManager.listPluginTypes();
    if (!Array.isArray(types)) throw new Error('Should return array');
    if (types.length < 1) throw new Error('Should have at least 1 type');
  });

  test('getPluginTypesByCategory() filters correctly', () => {
    pluginTypeManager.registerPluginType('test_type_2', {
      label: 'Test Type 2',
      category: 'other',
    });
    const testTypes = pluginTypeManager.getPluginTypesByCategory('test');
    if (testTypes.length !== 1) throw new Error('Category filter failed');
  });

  test('createPluginInstance() creates instances with defaults', () => {
    const instance = pluginTypeManager.createPluginInstance('test_type', {
      id: 'test_instance',
    });
    if (!instance) throw new Error('Instance not created');
    if (instance.getPluginId() !== 'test_instance') {
      throw new Error('Instance ID incorrect');
    }
  });

  console.log('');
  console.log('STEP 3: Validation Tests\n');

  test('validatePluginType() accepts valid instances', () => {
    const instance = {
      getPluginId: () => 'valid_id',
    };
    const result = pluginTypeManager.validatePluginType('test_type', instance);
    if (!result.valid) {
      throw new Error(`Validation failed: ${result.errors.join(', ')}`);
    }
  });

  test('validatePluginType() rejects invalid instances', () => {
    const instance = {
      getPluginId: () => null, // Invalid
    };
    const result = pluginTypeManager.validatePluginType('test_type', instance);
    if (result.valid) {
      throw new Error('Should have failed validation');
    }
  });

  test('validatePluginType() catches missing required fields', () => {
    pluginTypeManager.registerPluginType('strict_type', {
      label: 'Strict',
      schema: {
        required: ['id', 'name'],
      },
    });
    const instance = { id: 'test' }; // Missing 'name'
    const result = pluginTypeManager.validatePluginType('strict_type', instance);
    if (result.valid) {
      throw new Error('Should fail for missing required field');
    }
    if (!result.errors.some(e => e.includes('name'))) {
      throw new Error('Should mention missing name field');
    }
  });

  test('validatePluginType() catches type mismatches', () => {
    pluginTypeManager.registerPluginType('typed_type', {
      label: 'Typed',
      schema: {
        properties: {
          count: { type: 'number' },
        },
      },
    });
    const instance = { count: 'not a number' };
    const result = pluginTypeManager.validatePluginType('typed_type', instance);
    if (result.valid) {
      throw new Error('Should fail for wrong type');
    }
  });

  console.log('');
  console.log('STEP 4: Metadata Support Tests\n');

  test('Plugin types support label metadata', () => {
    const type = pluginTypeManager.getPluginType('test_type');
    if (!type.label) throw new Error('Label missing');
  });

  test('Plugin types support description metadata', () => {
    const type = pluginTypeManager.getPluginType('test_type');
    if (!type.description) throw new Error('Description missing');
  });

  test('Plugin types support category metadata', () => {
    const type = pluginTypeManager.getPluginType('test_type');
    if (!type.category) throw new Error('Category missing');
  });

  console.log('');
  console.log('STEP 5: Integration Tests\n');

  const context = await boot(__dirname, { quiet: true });

  test('Service is registered in context.services', () => {
    const manager = context.services.get('plugin_type.manager');
    if (!manager) {
      throw new Error('Service not found in context.services');
    }
  });

  test('Service has all expected methods', () => {
    const manager = context.services.get('plugin_type.manager');
    const methods = [
      'registerPluginType',
      'getPluginType',
      'listPluginTypes',
      'getPluginTypesByCategory',
      'validatePluginType',
      'createPluginInstance',
      'hasPluginType',
      'clearPluginTypes',
    ];
    for (const method of methods) {
      if (typeof manager[method] !== 'function') {
        throw new Error(`Missing method: ${method}`);
      }
    }
  });

  test('Service works through context.services', () => {
    const manager = context.services.get('plugin_type.manager');
    manager.registerPluginType('integration_test', {
      label: 'Integration Test',
    });
    const type = manager.getPluginType('integration_test');
    if (!type) throw new Error('Registration through service failed');
  });

  console.log('');
  console.log('='.repeat(60));
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(60));

  if (failed > 0) {
    console.log('\n❌ REGRESSION DETECTED: Some tests failed');
    process.exit(1);
  } else {
    console.log('\n✅ ALL TESTS PASSED: No regressions detected');
    process.exit(0);
  }
}

runTests().catch(error => {
  console.error('\n❌ Test runner error:');
  console.error(error);
  process.exit(1);
});
