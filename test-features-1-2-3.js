#!/usr/bin/env node
/**
 * Test Features #1, #2, #3 - ConfigEntityStorage
 */

import { ConfigEntity } from './core/lib/Config/ConfigEntity.js';
import { ConfigEntityStorage } from './core/lib/Config/ConfigEntityStorage.js';
import { rmSync, existsSync } from 'node:fs';

const TEST_DIR = 'config-test';

// Cleanup test directory
function cleanup() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

// Test runner
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`✗ ${name}`);
    console.log(`  ${error.message}`);
    failed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`✗ ${name}`);
    console.log(`  ${error.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

// ============================================================================
// FEATURE #1: ConfigEntityStorage class with proper initialization
// ============================================================================

console.log('\n=== FEATURE #1: ConfigEntityStorage class ===\n');

cleanup();

test('Constructor accepts (entityTypeId, configDir)', () => {
  const storage = new ConfigEntityStorage('node_type', TEST_DIR);
  assert(storage, 'Storage instance created');
});

test('Constructor uses default configDir', () => {
  const storage = new ConfigEntityStorage('node_type');
  assert(storage.configDir === 'config', 'Default configDir is "config"');
});

test('entityTypeId stored correctly', () => {
  const storage = new ConfigEntityStorage('node_type', TEST_DIR);
  assert(storage.entityTypeId === 'node_type', 'entityTypeId matches');
});

test('activeDir computed as {configDir}/active', () => {
  const storage = new ConfigEntityStorage('node_type', TEST_DIR);
  assert(storage.activeDir === `${TEST_DIR}/active`, 'activeDir path correct');
});

test('stagingDir computed as {configDir}/staging', () => {
  const storage = new ConfigEntityStorage('node_type', TEST_DIR);
  assert(storage.stagingDir === `${TEST_DIR}/staging`, 'stagingDir path correct');
});

test('No directories created in constructor', () => {
  cleanup();
  const storage = new ConfigEntityStorage('node_type', TEST_DIR);
  assert(!existsSync(TEST_DIR), 'Test directory not created');
  assert(!existsSync(storage.activeDir), 'Active directory not created');
  assert(!existsSync(storage.stagingDir), 'Staging directory not created');
});

test('Cache initialized as Map', () => {
  const storage = new ConfigEntityStorage('node_type', TEST_DIR);
  assert(storage._cache instanceof Map, 'Cache is a Map');
});

// ============================================================================
// FEATURE #2: save() and load() methods
// ============================================================================

console.log('\n=== FEATURE #2: save() and load() methods ===\n');

cleanup();

await asyncTest('save() validates entity has getConfigName()', async () => {
  const storage = new ConfigEntityStorage('node_type', TEST_DIR);
  const fakeEntity = { id: 'test' };

  let threw = false;
  try {
    await storage.save(fakeEntity);
  } catch (error) {
    threw = true;
    assert(error.message.includes('getConfigName'), 'Error mentions getConfigName');
  }

  assert(threw, 'save() throws descriptive error for invalid entity');
});

await asyncTest('save() creates active directory on first save', async () => {
  cleanup();
  const storage = new ConfigEntityStorage('node_type', TEST_DIR);
  const entity = new ConfigEntity('node_type', { id: 'article', label: 'Article' });

  await storage.save(entity);

  assert(existsSync(storage.activeDir), 'Active directory created');
});

await asyncTest('save() writes JSON file with correct path', async () => {
  cleanup();
  const storage = new ConfigEntityStorage('node_type', TEST_DIR);
  const entity = new ConfigEntity('node_type', { id: 'article', label: 'Article' });

  await storage.save(entity);

  const filePath = `${TEST_DIR}/active/node_type.article.json`;
  assert(existsSync(filePath), 'JSON file created at correct path');
});

await asyncTest('save() caches entity', async () => {
  cleanup();
  const storage = new ConfigEntityStorage('node_type', TEST_DIR);
  const entity = new ConfigEntity('node_type', { id: 'article', label: 'Article' });

  await storage.save(entity);

  assert(storage._cache.has('article'), 'Entity cached by ID');
  assert(storage._cache.get('article') === entity, 'Cached entity is same instance');
});

await asyncTest('load() returns null for non-existent entity', async () => {
  cleanup();
  const storage = new ConfigEntityStorage('node_type', TEST_DIR);

  const result = await storage.load('nonexistent');

  assert(result === null, 'load() returns null for missing file');
});

await asyncTest('load() reads and returns ConfigEntity', async () => {
  cleanup();
  const storage = new ConfigEntityStorage('node_type', TEST_DIR);
  const entity = new ConfigEntity('node_type', { id: 'article', label: 'Article' });

  await storage.save(entity);

  // Clear cache to force filesystem read
  storage._cache.clear();

  const loaded = await storage.load('article');

  assert(loaded instanceof ConfigEntity, 'Loaded entity is ConfigEntity instance');
  assert(loaded.id === 'article', 'Entity ID matches');
  assert(loaded.label === 'Article', 'Entity label matches');
});

await asyncTest('load() uses cache on second load', async () => {
  cleanup();
  const storage = new ConfigEntityStorage('node_type', TEST_DIR);
  const entity = new ConfigEntity('node_type', { id: 'article', label: 'Article' });

  await storage.save(entity);

  const load1 = await storage.load('article');
  const load2 = await storage.load('article');

  assert(load1 === load2, 'Second load returns cached instance');
});

// ============================================================================
// FEATURE #3: delete(), loadMultiple(), loadAll()
// ============================================================================

console.log('\n=== FEATURE #3: delete(), loadMultiple(), loadAll() ===\n');

cleanup();

await asyncTest('delete() removes file', async () => {
  cleanup();
  const storage = new ConfigEntityStorage('node_type', TEST_DIR);
  const entity = new ConfigEntity('node_type', { id: 'to_delete', label: 'Delete Me' });

  await storage.save(entity);

  const filePath = `${TEST_DIR}/active/node_type.to_delete.json`;
  assert(existsSync(filePath), 'File exists before delete');

  await storage.delete('to_delete');

  assert(!existsSync(filePath), 'File removed after delete');
});

await asyncTest('delete() clears cache entry', async () => {
  cleanup();
  const storage = new ConfigEntityStorage('node_type', TEST_DIR);
  const entity = new ConfigEntity('node_type', { id: 'to_delete', label: 'Delete Me' });

  await storage.save(entity);
  assert(storage._cache.has('to_delete'), 'Cache has entity before delete');

  await storage.delete('to_delete');

  assert(!storage._cache.has('to_delete'), 'Cache cleared after delete');
});

await asyncTest('delete() handles missing files gracefully', async () => {
  cleanup();
  const storage = new ConfigEntityStorage('node_type', TEST_DIR);

  // Should not throw
  await storage.delete('nonexistent');

  assert(true, 'delete() completes without throwing');
});

await asyncTest('loadMultiple() returns Map of id→entity', async () => {
  cleanup();
  const storage = new ConfigEntityStorage('node_type', TEST_DIR);

  await storage.save(new ConfigEntity('node_type', { id: 'article', label: 'Article' }));
  await storage.save(new ConfigEntity('node_type', { id: 'page', label: 'Page' }));
  await storage.save(new ConfigEntity('node_type', { id: 'blog', label: 'Blog' }));

  const result = await storage.loadMultiple(['article', 'page', 'nonexistent']);

  assert(result instanceof Map, 'loadMultiple returns Map');
  assert(result.size === 2, 'Map has 2 entries (skips nonexistent)');
  assert(result.has('article'), 'Map has article');
  assert(result.has('page'), 'Map has page');
  assert(!result.has('nonexistent'), 'Map does not have nonexistent');
  assert(result.get('article').label === 'Article', 'Entity data correct');
});

await asyncTest('loadAll() returns Map of all entities', async () => {
  cleanup();
  const storage = new ConfigEntityStorage('node_type', TEST_DIR);

  await storage.save(new ConfigEntity('node_type', { id: 'article', label: 'Article' }));
  await storage.save(new ConfigEntity('node_type', { id: 'page', label: 'Page' }));
  await storage.save(new ConfigEntity('node_type', { id: 'blog', label: 'Blog' }));

  const result = await storage.loadAll();

  assert(result instanceof Map, 'loadAll returns Map');
  assert(result.size === 3, 'Map has 3 entries');
  assert(result.has('article'), 'Map has article');
  assert(result.has('page'), 'Map has page');
  assert(result.has('blog'), 'Map has blog');
});

await asyncTest('loadAll() only loads matching entity type', async () => {
  cleanup();
  const storage1 = new ConfigEntityStorage('node_type', TEST_DIR);
  const storage2 = new ConfigEntityStorage('view', TEST_DIR);

  await storage1.save(new ConfigEntity('node_type', { id: 'article', label: 'Article' }));
  await storage2.save(new ConfigEntity('view', { id: 'frontpage', label: 'Frontpage' }));

  const nodeTypes = await storage1.loadAll();
  const views = await storage2.loadAll();

  assert(nodeTypes.size === 1, 'node_type storage loads only node_type entities');
  assert(views.size === 1, 'view storage loads only view entities');
  assert(nodeTypes.has('article'), 'Correct entity type loaded');
  assert(views.has('frontpage'), 'Correct entity type loaded');
});

// ============================================================================
// Summary
// ============================================================================

console.log(`\n${'='.repeat(60)}`);
console.log(`PASSED: ${passed}  FAILED: ${failed}`);
console.log(`${'='.repeat(60)}\n`);

cleanup();

process.exit(failed > 0 ? 1 : 0);
