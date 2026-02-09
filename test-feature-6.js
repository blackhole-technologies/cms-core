#!/usr/bin/env node
/**
 * Test script for Feature #6: EntityType class
 */

import { EntityType } from './core/lib/Entity/EntityTypeManager.js';

console.log('Testing Feature #6: EntityType class\n');

// Mock storage handler for testing
const mockStorage = { type: 'storage', name: 'mockStorage' };

// Create EntityType instance as per verification steps
const et = new EntityType('node', {
  label: 'Content',
  keys: {
    id: 'nid',
    uuid: 'uuid',
    bundle: 'type',
    label: 'title'
  },
  handlers: {
    storage: mockStorage
  }
});

console.log('Created EntityType instance');

// Run all verification steps
const tests = [
  { name: 'et.id === "node"', actual: et.id, expected: 'node' },
  { name: 'et.label === "Content"', actual: et.label, expected: 'Content' },
  { name: 'et.keys.id === "nid"', actual: et.keys.id, expected: 'nid' },
  { name: 'et.keys.bundle === "type"', actual: et.keys.bundle, expected: 'type' },
  { name: 'et.keys.revision === null', actual: et.keys.revision, expected: null },
  { name: 'et.hasHandler("storage") === true', actual: et.hasHandler('storage'), expected: true },
  { name: 'et.hasHandler("view_builder") === false', actual: et.hasHandler('view_builder'), expected: false },
];

let passed = 0;
let failed = 0;

tests.forEach(test => {
  const success = test.actual === test.expected;
  if (success) {
    console.log(`✓ ${test.name}`);
    passed++;
  } else {
    console.log(`✗ ${test.name} - Expected: ${test.expected}, Got: ${test.actual}`);
    failed++;
  }
});

// Test toJSON()
const json = et.toJSON();
console.log('\ntoJSON() output:', JSON.stringify(json, null, 2));

// Verify toJSON returns plain object
if (typeof json === 'object' && json !== null && json.id === 'node') {
  console.log('✓ toJSON() returns plain object');
  passed++;
} else {
  console.log('✗ toJSON() does not return valid plain object');
  failed++;
}

// Test default values
const etDefaults = new EntityType('file');
console.log('\nTesting defaults for EntityType("file"):');
const defaultTests = [
  { name: 'label defaults to id', actual: etDefaults.label, expected: 'file' },
  { name: 'keys.id defaults to "id"', actual: etDefaults.keys.id, expected: 'id' },
  { name: 'keys.uuid defaults to "uuid"', actual: etDefaults.keys.uuid, expected: 'uuid' },
  { name: 'keys.bundle defaults to null', actual: etDefaults.keys.bundle, expected: null },
  { name: 'keys.label defaults to null', actual: etDefaults.keys.label, expected: null },
  { name: 'keys.revision defaults to null', actual: etDefaults.keys.revision, expected: null },
  { name: 'revisionable defaults to false', actual: etDefaults.revisionable, expected: false },
  { name: 'translatable defaults to false', actual: etDefaults.translatable, expected: false },
];

defaultTests.forEach(test => {
  const success = test.actual === test.expected;
  if (success) {
    console.log(`✓ ${test.name}`);
    passed++;
  } else {
    console.log(`✗ ${test.name} - Expected: ${test.expected}, Got: ${test.actual}`);
    failed++;
  }
});

// Test getKey() and hasKey()
console.log('\nTesting getKey() and hasKey():');
const keyTests = [
  { name: 'getKey("id") returns "nid"', actual: et.getKey('id'), expected: 'nid' },
  { name: 'getKey("revision") returns null', actual: et.getKey('revision'), expected: null },
  { name: 'getKey("nonexistent") returns null', actual: et.getKey('nonexistent'), expected: null },
  { name: 'hasKey("id") returns true', actual: et.hasKey('id'), expected: true },
  { name: 'hasKey("bundle") returns true', actual: et.hasKey('bundle'), expected: true },
  { name: 'hasKey("revision") returns false', actual: et.hasKey('revision'), expected: false },
  { name: 'hasKey("nonexistent") returns false', actual: et.hasKey('nonexistent'), expected: false },
];

keyTests.forEach(test => {
  const success = test.actual === test.expected;
  if (success) {
    console.log(`✓ ${test.name}`);
    passed++;
  } else {
    console.log(`✗ ${test.name} - Expected: ${test.expected}, Got: ${test.actual}`);
    failed++;
  }
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Total: ${passed + failed} tests`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`${'='.repeat(50)}`);

process.exit(failed > 0 ? 1 : 0);
