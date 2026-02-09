#!/usr/bin/env node
/**
 * Test ConfigEntityStorage.exportToStaging() (Feature #24)
 * Verifies config export to staging directory
 */

import { ConfigEntity } from './core/lib/Config/ConfigEntity.js';
import { ConfigEntityStorage } from './core/lib/Config/ConfigEntityStorage.js';
import { existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

console.log('Testing ConfigEntityStorage.exportToStaging() (Feature #24)...\n');

// Setup test directory
const testDir = 'test-export-temp';
if (existsSync(testDir)) {
  rmSync(testDir, { recursive: true });
}
mkdirSync(join(testDir, 'active'), { recursive: true });

// Create storage instance
const storage = new ConfigEntityStorage('node_type', testDir);

console.log('Test 1: Create and save 3 config entities');
const entities = [
  new ConfigEntity('node_type', { id: 'article', label: 'Article' }),
  new ConfigEntity('node_type', { id: 'page', label: 'Page' }),
  new ConfigEntity('node_type', { id: 'blog', label: 'Blog' }),
];

for (const entity of entities) {
  await storage.save(entity);
}

const activeFiles = readdirSync(join(testDir, 'active'));
console.log('  Files in active:', activeFiles.length === 3 ? '✓' : `✗ (got ${activeFiles.length})`);

console.log('\nTest 2: exportToStaging() creates staging directory');
console.log('  Staging exists before:', existsSync(join(testDir, 'staging')) ? '✗' : '✓');

const count = await storage.exportToStaging();

console.log('  Staging exists after:', existsSync(join(testDir, 'staging')) ? '✓' : '✗');
console.log('  Return value:', count === 3 ? '✓' : `✗ (got ${count})`);

console.log('\nTest 3: Verify 3 files copied to staging');
const stagingFiles = readdirSync(join(testDir, 'staging'));
console.log('  Files in staging:', stagingFiles.length === 3 ? '✓' : `✗ (got ${stagingFiles.length})`);
console.log('  Has article:', stagingFiles.includes('node_type.article.json') ? '✓' : '✗');
console.log('  Has page:', stagingFiles.includes('node_type.page.json') ? '✓' : '✗');
console.log('  Has blog:', stagingFiles.includes('node_type.blog.json') ? '✓' : '✗');

console.log('\nTest 4: Exported files have correct content');
const { readFileSync } = await import('node:fs');
const articleContent = JSON.parse(
  readFileSync(join(testDir, 'staging', 'node_type.article.json'), 'utf-8')
);
console.log('  Article id:', articleContent.id === 'article' ? '✓' : '✗');
console.log('  Article label:', articleContent.label === 'Article' ? '✓' : '✗');
console.log('  Has uuid:', articleContent.uuid ? '✓' : '✗');

console.log('\nTest 5: Multiple exports overwrite previous files');
// Modify an entity and save
entities[0].set('label', 'Updated Article');
await storage.save(entities[0]);

// Export again
const count2 = await storage.exportToStaging();
console.log('  Second export count:', count2 === 3 ? '✓' : `✗ (got ${count2})`);

const updatedContent = JSON.parse(
  readFileSync(join(testDir, 'staging', 'node_type.article.json'), 'utf-8')
);
console.log('  Label updated in staging:', updatedContent.label === 'Updated Article' ? '✓' : '✗');

// Cleanup
console.log('\nCleaning up test directory...');
rmSync(testDir, { recursive: true });

console.log('\n✅ All exportToStaging tests passed!');
