#!/usr/bin/env node
/**
 * Test script for Plugin Type Manager (Feature #1)
 */

import * as pluginTypeManager from '../../core/plugin-type-manager.js';

console.log('Testing Plugin Type Manager...\n');

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

// Test 1: Register a plugin type
test('registerPluginType() registers a plugin type', () => {
  pluginTypeManager.registerPluginType('field_type', {
    label: 'Field Type',
    description: 'Base type for content fields',
    category: 'field',
    baseClass: 'FieldTypeBase',
    defaultSettings: { required: false, label: 'visible' },
  });

  const type = pluginTypeManager.getPluginType('field_type');
  if (!type) throw new Error('Type not registered');
  if (type.label !== 'Field Type') throw new Error('Label mismatch');
});

// Test 2: Get plugin type
test('getPluginType() retrieves registered type', () => {
  const type = pluginTypeManager.getPluginType('field_type');
  if (!type) throw new Error('Type not found');
  if (type.category !== 'field') throw new Error('Category mismatch');
  if (type.defaultSettings.required !== false) throw new Error('Default settings not applied');
});

// Test 3: List plugin types
test('listPluginTypes() returns all types', () => {
  pluginTypeManager.registerPluginType('block_type', {
    label: 'Block Type',
    description: 'Base type for blocks',
    category: 'block',
  });

  const types = pluginTypeManager.listPluginTypes();
  if (types.length < 2) throw new Error('Expected at least 2 types');

  const fieldType = types.find(t => t.name === 'field_type');
  const blockType = types.find(t => t.name === 'block_type');
  if (!fieldType || !blockType) throw new Error('Types missing from list');
});

// Test 4: Get plugin types by category
test('getPluginTypesByCategory() filters by category', () => {
  const fieldTypes = pluginTypeManager.getPluginTypesByCategory('field');
  if (fieldTypes.length !== 1) throw new Error('Expected 1 field type');
  if (fieldTypes[0].name !== 'field_type') throw new Error('Wrong type returned');
});

// Test 5: Validate plugin type with valid instance
test('validatePluginType() accepts valid instance', () => {
  const instance = {
    getPluginId: () => 'string',
    getPluginDefinition: () => ({ label: 'String' }),
  };

  const result = pluginTypeManager.validatePluginType('field_type', instance);
  if (!result.valid) throw new Error(`Validation failed: ${result.errors.join(', ')}`);
  if (result.errors.length > 0) throw new Error('Unexpected validation errors');
});

// Test 6: Validate plugin type with invalid instance
test('validatePluginType() rejects invalid instance', () => {
  const instance = {
    getPluginId: () => null, // Invalid - should be string
  };

  const result = pluginTypeManager.validatePluginType('field_type', instance);
  if (result.valid) throw new Error('Should have failed validation');
  if (result.errors.length === 0) throw new Error('Expected validation errors');
});

// Test 7: Validate unknown plugin type
test('validatePluginType() handles unknown type', () => {
  const result = pluginTypeManager.validatePluginType('nonexistent', {});
  if (result.valid) throw new Error('Should have failed for unknown type');
  if (!result.errors.some(e => e.includes('Unknown plugin type'))) {
    throw new Error('Expected unknown type error');
  }
});

// Test 8: Create plugin instance
test('createPluginInstance() creates instance with defaults', () => {
  const instance = pluginTypeManager.createPluginInstance('field_type', {
    id: 'test_field',
    label: 'Test Field',
  });

  if (!instance) throw new Error('Instance not created');
  if (instance.getPluginId() !== 'test_field') throw new Error('Plugin ID mismatch');

  const config = instance.getConfiguration();
  if (config.label !== 'Test Field') throw new Error('Config not applied');
  if (config.required !== false) throw new Error('Defaults not merged');
});

// Test 9: Create instance with custom factory
test('createPluginInstance() uses custom factory', () => {
  pluginTypeManager.registerPluginType('custom_type', {
    label: 'Custom Type',
    factory: (config) => {
      return {
        customMethod: () => 'custom result',
        ...config,
      };
    },
  });

  const instance = pluginTypeManager.createPluginInstance('custom_type', { foo: 'bar' });
  if (typeof instance.customMethod !== 'function') throw new Error('Custom factory not used');
  if (instance.customMethod() !== 'custom result') throw new Error('Custom method failed');
  if (instance.foo !== 'bar') throw new Error('Config not passed to factory');
});

// Test 10: hasPluginType check
test('hasPluginType() checks existence', () => {
  if (!pluginTypeManager.hasPluginType('field_type')) {
    throw new Error('Should return true for existing type');
  }
  if (pluginTypeManager.hasPluginType('nonexistent')) {
    throw new Error('Should return false for nonexistent type');
  }
});

// Test 11: Schema validation with required fields
test('validatePluginType() validates required fields', () => {
  pluginTypeManager.registerPluginType('strict_type', {
    label: 'Strict Type',
    schema: {
      required: ['id', 'label'],
    },
  });

  const invalidInstance = { id: 'test' }; // Missing 'label'
  const result = pluginTypeManager.validatePluginType('strict_type', invalidInstance);

  if (result.valid) throw new Error('Should fail validation for missing required field');
  if (!result.errors.some(e => e.includes('label'))) {
    throw new Error('Should mention missing label field');
  }
});

// Test 12: Schema validation with type checking
test('validatePluginType() validates field types', () => {
  pluginTypeManager.registerPluginType('typed_type', {
    label: 'Typed Type',
    schema: {
      properties: {
        count: { type: 'number' },
        name: { type: 'string' },
      },
    },
  });

  const invalidInstance = { count: 'not a number', name: 'valid' };
  const result = pluginTypeManager.validatePluginType('typed_type', invalidInstance);

  if (result.valid) throw new Error('Should fail validation for wrong type');
  if (!result.errors.some(e => e.includes('count'))) {
    throw new Error('Should mention count field type error');
  }
});

// Summary
console.log('\n' + '='.repeat(50));
console.log(`Tests: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed > 0) {
  process.exit(1);
}
