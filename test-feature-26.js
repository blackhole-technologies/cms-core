/**
 * Feature #26 Test: Config system barrel export and round-trip test
 *
 * Tests:
 * - Barrel export works (all classes importable)
 * - Config directories created automatically
 * - Full workflow: create → save → load → modify → save → verify persistence
 */

import fs from 'fs';
import path from 'path';
import { ConfigEntity, ConfigEntityStorage, ConfigSchema } from './core/lib/Config/index.js';

console.log('Testing Feature #26: Config system barrel export and round-trip\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.error(`   ${error.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Test 1: Barrel export works
test('Barrel export - all classes imported', () => {
  assert(typeof ConfigEntity === 'function', 'ConfigEntity should be a class');
  assert(typeof ConfigEntityStorage === 'function', 'ConfigEntityStorage should be a class');
  assert(typeof ConfigSchema === 'function', 'ConfigSchema should be a class');
});

// Test 2: Config directories exist
test('Config directories created automatically', () => {
  const activeDir = path.join(process.cwd(), 'config', 'active');
  const stagingDir = path.join(process.cwd(), 'config', 'staging');

  assert(fs.existsSync(activeDir), `Active directory should exist: ${activeDir}`);
  assert(fs.existsSync(stagingDir), `Staging directory should exist: ${stagingDir}`);
});

// Clean up any previous test data
const testFilePath = path.join(process.cwd(), 'config', 'active', 'test_type.test1.json');
if (fs.existsSync(testFilePath)) {
  fs.unlinkSync(testFilePath);
}

// Test 3-10: Full round-trip workflow
const storage = new ConfigEntityStorage('test_type', 'config');

// Test 3: Create entity
test('Create entity', () => {
  const entity = new ConfigEntity('test_type', { id: 'test1', label: 'Test 1' });
  assert(entity.get('id') === 'test1', 'Entity ID should be test1');
  assert(entity.get('label') === 'Test 1', 'Entity label should be Test 1');
});

// Test 4: Save entity
test('Save entity to storage', () => {
  const entity = new ConfigEntity('test_type', { id: 'test1', label: 'Test 1' });
  storage.save(entity);
  assert(fs.existsSync(testFilePath), `File should exist: ${testFilePath}`);
});

// Test 5: Load entity
test('Load entity from storage', () => {
  const entity = storage.load('test1');
  assert(entity !== null, 'Loaded entity should not be null');
  assert(entity.get('id') === 'test1', 'Loaded entity ID should be test1');
  assert(entity.get('label') === 'Test 1', 'Loaded entity label should be Test 1');
});

// Test 6: Modify entity
test('Modify entity', () => {
  const entity = storage.load('test1');
  entity.set('label', 'Modified');
  assert(entity.get('label') === 'Modified', 'Entity label should be Modified');
  assert(entity.isDirty(), 'Entity should be dirty after modification');
});

// Test 7: Save modified entity
test('Save modified entity', () => {
  const entity = storage.load('test1');
  entity.set('label', 'Modified');
  storage.save(entity);

  // Read file directly to verify save
  const fileContent = fs.readFileSync(testFilePath, 'utf-8');
  const savedData = JSON.parse(fileContent);
  assert(savedData.label === 'Modified', 'Saved file should have modified label');
});

// Test 8: Clear cache and reload
test('Clear cache and reload entity', () => {
  // Clear the cache
  storage._cache.clear();

  // Load entity again (should read from filesystem)
  const entity = storage.load('test1');
  assert(entity !== null, 'Reloaded entity should not be null');
  assert(entity.get('label') === 'Modified', 'Reloaded entity should have modified label');
});

// Test 9: exportToStaging works
test('Export to staging directory', () => {
  const count = storage.exportToStaging();
  assert(count >= 1, `Should export at least 1 entity, got ${count}`);

  const stagingFilePath = path.join(process.cwd(), 'config', 'staging', 'test_type.test1.json');
  assert(fs.existsSync(stagingFilePath), `Staging file should exist: ${stagingFilePath}`);

  const stagingContent = fs.readFileSync(stagingFilePath, 'utf-8');
  const stagingData = JSON.parse(stagingContent);
  assert(stagingData.label === 'Modified', 'Staging file should have modified label');

  // Clean up staging file
  fs.unlinkSync(stagingFilePath);
});

// Test 10: ConfigSchema validates entity
test('ConfigSchema validates entity', () => {
  const entity = storage.load('test1');
  const schema = {
    id: { type: 'string', required: true },
    label: { type: 'string', required: true }
  };

  const result = ConfigSchema.validate(entity.toJSON(), schema);
  assert(result.valid, `Entity should pass validation, got errors: ${result.errors.join(', ')}`);
});

// Test 11: Multiple entities
test('Work with multiple entities', () => {
  // Create second entity
  const entity2 = new ConfigEntity('test_type', { id: 'test2', label: 'Test 2' });
  storage.save(entity2);

  // Load all entities
  const allEntities = storage.loadAll();
  assert(allEntities.length >= 2, `Should load at least 2 entities, got ${allEntities.length}`);

  const ids = allEntities.map(e => e.get('id'));
  assert(ids.includes('test1'), 'Should include test1');
  assert(ids.includes('test2'), 'Should include test2');

  // Clean up test2
  storage.delete('test2');
});

// Test 12: Delete entity
test('Delete entity', () => {
  storage.delete('test1');
  assert(!fs.existsSync(testFilePath), 'File should be deleted');

  const entity = storage.load('test1');
  assert(entity === null, 'Deleted entity should return null');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
