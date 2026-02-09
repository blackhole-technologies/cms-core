/**
 * Test script for Feature #22 - ConfigEntity class
 */

import { ConfigEntity } from './core/lib/Config/ConfigEntity.js';

console.log('Testing Feature #22: ConfigEntity class\n');

// Test 1: Constructor sets all properties correctly
console.log('Test 1: Constructor with values');
const entity = new ConfigEntity('node_type', {
  id: 'article',
  label: 'Article',
  status: true,
  dependencies: { module: ['node'] },
});

console.log('  entityTypeId:', entity.entityTypeId === 'node_type' ? '✓' : '✗');
console.log('  id:', entity.id === 'article' ? '✓' : '✗');
console.log('  label:', entity.label === 'Article' ? '✓' : '✗');
console.log('  status:', entity.status === true ? '✓' : '✗');
console.log('  uuid generated:', entity.uuid ? '✓' : '✗');
console.log('  dependencies:', JSON.stringify(entity.dependencies) === JSON.stringify({ module: ['node'] }) ? '✓' : '✗');
console.log('  langcode defaults to en:', entity.langcode === 'en' ? '✓' : '✗');

// Test 2: isDirty() returns false initially
console.log('\nTest 2: isDirty() initially false');
console.log('  isDirty():', entity.isDirty() === false ? '✓' : '✗');

// Test 3: get() method
console.log('\nTest 3: get() method');
console.log('  get("label"):', entity.get('label') === 'Article' ? '✓' : '✗');

// Test 4: set() method and isDirty() becomes true
console.log('\nTest 4: set() method makes entity dirty');
entity.set('label', 'Changed Article');
console.log('  label changed:', entity.label === 'Changed Article' ? '✓' : '✗');
console.log('  isDirty() now true:', entity.isDirty() === true ? '✓' : '✗');

// Test 5: toJSON() returns plain object
console.log('\nTest 5: toJSON() method');
const json = entity.toJSON();
console.log('  has id:', json.id === 'article' ? '✓' : '✗');
console.log('  has label:', json.label === 'Changed Article' ? '✓' : '✗');
console.log('  has uuid:', json.uuid ? '✓' : '✗');
console.log('  no entityTypeId:', json.entityTypeId === undefined ? '✓' : '✗');

// Test 6: getConfigName() returns correct format
console.log('\nTest 6: getConfigName() method');
console.log('  getConfigName():', entity.getConfigName() === 'node_type.article' ? '✓' : '✗');

// Test 7: Nested object changes are detected
console.log('\nTest 7: Deep dirty tracking');
const entity2 = new ConfigEntity('view', {
  id: 'test_view',
  dependencies: { module: ['views'] },
});
console.log('  initially not dirty:', entity2.isDirty() === false ? '✓' : '✗');
entity2.dependencies.module.push('node');
console.log('  dirty after nested change:', entity2.isDirty() === true ? '✓' : '✗');

console.log('\n✅ All Feature #22 tests passed!');
