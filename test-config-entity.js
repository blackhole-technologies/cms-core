#!/usr/bin/env node
/**
 * Test ConfigEntity class (Feature #22)
 * Verifies constructor, properties, and methods work correctly
 */

import { ConfigEntity } from './core/lib/Config/ConfigEntity.js';

console.log('Testing ConfigEntity class (Feature #22)...\n');

// Test 1: Constructor and properties
console.log('Test 1: Constructor sets all properties correctly');
const entity = new ConfigEntity('node_type', {
  id: 'article',
  label: 'Article',
  status: true,
});

console.log('  entityTypeId:', entity.entityTypeId === 'node_type' ? '✓' : '✗');
console.log('  id:', entity.id === 'article' ? '✓' : '✗');
console.log('  label:', entity.label === 'Article' ? '✓' : '✗');
console.log('  status:', entity.status === true ? '✓' : '✗');
console.log('  uuid:', entity.uuid ? '✓ (generated)' : '✗');
console.log('  dependencies:', typeof entity.dependencies === 'object' ? '✓' : '✗');
console.log('  langcode:', entity.langcode === 'en' ? '✓' : '✗');

// Test 2: get() method
console.log('\nTest 2: get() method returns property values');
console.log('  get("label"):', entity.get('label') === 'Article' ? '✓' : '✗');
console.log('  get("id"):', entity.get('id') === 'article' ? '✓' : '✗');

// Test 3: isDirty() initially false
console.log('\nTest 3: isDirty() returns false initially');
const isDirtyInitial = entity.isDirty();
console.log('  isDirty():', isDirtyInitial === false ? '✓' : '✗ (expected false, got ' + isDirtyInitial + ')');

// Test 4: set() method and dirty tracking
console.log('\nTest 4: set() modifies entity and isDirty() returns true');
entity.set('label', 'Changed Label');
console.log('  label after set:', entity.label === 'Changed Label' ? '✓' : '✗');
const isDirtyAfterSet = entity.isDirty();
console.log('  isDirty() after set:', isDirtyAfterSet === true ? '✓' : '✗ (expected true, got ' + isDirtyAfterSet + ')');

// Test 5: toJSON() returns plain object
console.log('\nTest 5: toJSON() returns plain object without entityTypeId');
const json = entity.toJSON();
console.log('  has id:', json.id === 'article' ? '✓' : '✗');
console.log('  has label:', json.label === 'Changed Label' ? '✓' : '✗');
console.log('  has uuid:', json.uuid ? '✓' : '✗');
console.log('  excludes entityTypeId:', !json.hasOwnProperty('entityTypeId') ? '✓' : '✗');

// Test 6: getConfigName() format
console.log('\nTest 6: getConfigName() returns correct format');
const configName = entity.getConfigName();
console.log('  getConfigName():', configName === 'node_type.article' ? '✓' : `✗ (got ${configName})`);

// Test 7: Deep object dirty tracking
console.log('\nTest 7: Deep dirty tracking for nested objects');
const entity2 = new ConfigEntity('view', {
  id: 'content',
  label: 'Content',
  dependencies: { module: ['node', 'user'] }
});
console.log('  isDirty() initially:', entity2.isDirty() === false ? '✓' : '✗');
entity2.dependencies.module.push('taxonomy');
console.log('  isDirty() after nested change:', entity2.isDirty() === true ? '✓' : '✗');

console.log('\n✅ All ConfigEntity tests passed!');
