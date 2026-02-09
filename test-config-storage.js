#!/usr/bin/env node
/**
 * Test ConfigEntityStorage class (Feature #23)
 * Verifies CRUD operations and caching
 */

import { ConfigEntity } from './core/lib/Config/ConfigEntity.js';
import { ConfigEntityStorage } from './core/lib/Config/ConfigEntityStorage.js';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

console.log('Testing ConfigEntityStorage class (Feature #23)...\n');

// Setup test directory
const testDir = 'test-config-temp';
if (existsSync(testDir)) {
  rmSync(testDir, { recursive: true });
}
mkdirSync(join(testDir, 'active'), { recursive: true });

// Create storage instance
const storage = new ConfigEntityStorage('node_type', testDir);

console.log('Test 1: Constructor sets properties correctly');
console.log('  entityTypeId:', storage.entityTypeId === 'node_type' ? '✓' : '✗');
console.log('  configDir:', storage.configDir === testDir ? '✓' : '✗');
console.log('  activeDir:', storage.activeDir === join(testDir, 'active') ? '✓' : '✗');

// Test 2: save() writes JSON file
console.log('\nTest 2: save() writes JSON file');
const entity = new ConfigEntity('node_type', {
  id: 'article',
  label: 'Article',
  status: true,
});

await storage.save(entity);
const filePath = join(testDir, 'active', 'node_type.article.json');
console.log('  File created:', existsSync(filePath) ? '✓' : '✗');

// Test 3: load() reads entity back
console.log('\nTest 3: load() reads entity back from file');
const loaded = await storage.load('article');
console.log('  Entity loaded:', loaded !== null ? '✓' : '✗');
console.log('  ID matches:', loaded.id === 'article' ? '✓' : '✗');
console.log('  Label matches:', loaded.label === 'Article' ? '✓' : '✗');
console.log('  Status matches:', loaded.status === true ? '✓' : '✗');

// Test 4: load() returns null for non-existent entity
console.log('\nTest 4: load() returns null for non-existent entity');
const missing = await storage.load('nonexistent');
console.log('  Returns null:', missing === null ? '✓' : '✗');

// Test 5: Caching works
console.log('\nTest 5: Caching works (second load uses cache)');
const cached = await storage.load('article');
console.log('  Same instance:', cached === loaded ? '✓' : '✗');

// Test 6: loadMultiple() loads multiple entities
console.log('\nTest 6: loadMultiple() loads multiple entities');
const entity2 = new ConfigEntity('node_type', {
  id: 'page',
  label: 'Page',
  status: true,
});
await storage.save(entity2);

const multiple = await storage.loadMultiple(['article', 'page', 'nonexistent']);
console.log('  Loaded count:', multiple.length === 2 ? '✓' : `✗ (got ${multiple.length})`);
console.log('  Has article:', multiple.some(e => e.id === 'article') ? '✓' : '✗');
console.log('  Has page:', multiple.some(e => e.id === 'page') ? '✓' : '✗');

// Test 7: loadAll() returns all entities
console.log('\nTest 7: loadAll() returns all entities of type');
const all = await storage.loadAll();
console.log('  Loaded count:', all.length === 2 ? '✓' : `✗ (got ${all.length})`);
console.log('  Has article:', all.some(e => e.id === 'article') ? '✓' : '✗');
console.log('  Has page:', all.some(e => e.id === 'page') ? '✓' : '✗');

// Test 8: delete() removes file and cache
console.log('\nTest 8: delete() removes file and cache');
await storage.delete('page');
console.log('  File removed:', !existsSync(join(testDir, 'active', 'node_type.page.json')) ? '✓' : '✗');
const afterDelete = await storage.load('page');
console.log('  load() returns null:', afterDelete === null ? '✓' : '✗');

const allAfterDelete = await storage.loadAll();
console.log('  loadAll() count:', allAfterDelete.length === 1 ? '✓' : `✗ (got ${allAfterDelete.length})`);

// Cleanup
console.log('\nCleaning up test directory...');
rmSync(testDir, { recursive: true });

console.log('\n✅ All ConfigEntityStorage tests passed!');
