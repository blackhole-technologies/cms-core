/**
 * Regression test for Feature 1: AI module registry service
 *
 * This test verifies:
 * 1. AI registry service exists and exports correct functions
 * 2. Module discovery finds AI modules
 * 3. AI modules are registered with correct metadata
 * 4. Query functions work (getByType, getModule, listAll)
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('\n='.repeat(60));
console.log('REGRESSION TEST: AI Module Registry Service (Feature 1)');
console.log('='.repeat(60));

let passed = 0;
let failed = 0;

async function test(description, fn) {
  try {
    await fn();
    console.log(`✓ ${description}`);
    passed++;
  } catch (error) {
    console.log(`✗ ${description}`);
    console.log(`  Error: ${error.message}`);
    failed++;
  }
}

async function runTests() {
  // Test 1: AI registry file exists
  await test('core/ai-registry.js exists', () => {
    const path = join(__dirname, 'core', 'ai-registry.js');
    if (!existsSync(path)) {
      throw new Error('File does not exist');
    }
  });

  // Test 2: Import AI registry module
  let aiRegistry;
  try {
    aiRegistry = await import('./core/ai-registry.js');
    console.log('✓ core/ai-registry.js can be imported');
    passed++;
  } catch (error) {
    console.log('✗ core/ai-registry.js can be imported');
    console.log(`  Error: ${error.message}`);
    failed++;
  }

  if (!aiRegistry) {
    console.log('\n❌ Cannot proceed - AI registry module failed to import');
    process.exit(1);
  }

  // Test 3: Check exports
  await test('Exports init function', () => {
    if (typeof aiRegistry.init !== 'function') {
      throw new Error('init is not a function');
    }
  });

  await test('Exports register function', () => {
    if (typeof aiRegistry.register !== 'function') {
      throw new Error('register is not a function');
    }
  });

  await test('Exports discoverAIModules function', () => {
    if (typeof aiRegistry.discoverAIModules !== 'function') {
      throw new Error('discoverAIModules is not a function');
    }
  });

  await test('Exports listAll function', () => {
    if (typeof aiRegistry.listAll !== 'function') {
      throw new Error('listAll is not a function');
    }
  });

  await test('Exports getByType function', () => {
    if (typeof aiRegistry.getByType !== 'function') {
      throw new Error('getByType is not a function');
    }
  });

  await test('Exports getModule function', () => {
    if (typeof aiRegistry.getModule !== 'function') {
      throw new Error('getModule is not a function');
    }
  });

  await test('Exports service name', () => {
    if (aiRegistry.name !== 'ai-registry') {
      throw new Error(`Expected name 'ai-registry', got '${aiRegistry.name}'`);
    }
  });

  // Test 4: Initialize registry
  await test('Can initialize AI registry', () => {
    aiRegistry.clear(); // Clear any previous state
    aiRegistry.init(__dirname);
  });

  // Test 5: Register test AI modules
  await test('Can register a provider module', () => {
    const result = aiRegistry.register({
      name: 'test-provider',
      type: 'provider',
      capabilities: { models: ['gpt-4'], streaming: true },
      status: 'active',
      manifest: {},
      path: '/test/path',
    });
    if (!result) {
      throw new Error('Registration returned false');
    }
  });

  await test('Can register a tool module', () => {
    const result = aiRegistry.register({
      name: 'test-tool',
      type: 'tool',
      capabilities: { operations: ['transform'] },
      status: 'active',
      manifest: {},
      path: '/test/path2',
    });
    if (!result) {
      throw new Error('Registration returned false');
    }
  });

  // Test 6: Query functions
  await test('listAll returns registered modules', () => {
    const all = aiRegistry.listAll();
    if (!Array.isArray(all)) {
      throw new Error('listAll did not return an array');
    }
    if (all.length < 2) {
      throw new Error(`Expected at least 2 modules, got ${all.length}`);
    }
  });

  await test('getByType returns provider modules', () => {
    const providers = aiRegistry.getByType('provider');
    if (!Array.isArray(providers)) {
      throw new Error('getByType did not return an array');
    }
    if (providers.length < 1) {
      throw new Error('Expected at least 1 provider module');
    }
    if (providers[0].type !== 'provider') {
      throw new Error('Module type is not "provider"');
    }
  });

  await test('getByType returns tool modules', () => {
    const tools = aiRegistry.getByType('tool');
    if (!Array.isArray(tools)) {
      throw new Error('getByType did not return an array');
    }
    if (tools.length < 1) {
      throw new Error('Expected at least 1 tool module');
    }
  });

  await test('getModule returns specific module', () => {
    const module = aiRegistry.getModule('test-provider');
    if (!module) {
      throw new Error('Module not found');
    }
    if (module.name !== 'test-provider') {
      throw new Error('Wrong module returned');
    }
    if (module.type !== 'provider') {
      throw new Error('Wrong module type');
    }
  });

  await test('getModule returns null for non-existent module', () => {
    const module = aiRegistry.getModule('non-existent-module');
    if (module !== null) {
      throw new Error('Expected null for non-existent module');
    }
  });

  // Test 7: Check test modules exist
  await test('ai_test module exists in modules/', () => {
    const path = join(__dirname, 'modules', 'ai_test', 'manifest.json');
    if (!existsSync(path)) {
      throw new Error('ai_test module does not exist');
    }
  });

  await test('ai_test manifest has AI metadata', async () => {
    const manifestPath = join(__dirname, 'modules', 'ai_test', 'manifest.json');
    const { readFileSync } = await import('node:fs');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

    if (!manifest.ai && !manifest.aiType) {
      throw new Error('Manifest missing AI metadata (ai or aiType field)');
    }
    if (manifest.aiType !== 'provider') {
      throw new Error(`Expected aiType 'provider', got '${manifest.aiType}'`);
    }
  });

  // Test 8: Discovery integration
  let aiTestDiscovered = false;
  await test('discoverAIModules processes modules correctly', async () => {
    const { readFileSync } = await import('node:fs');
    const manifestPath = join(__dirname, 'modules', 'ai_test', 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

    // Clear and re-init for clean discovery test
    aiRegistry.clear();
    aiRegistry.init(__dirname);

    // Simulate discovered modules
    const mockModules = [{
      name: 'ai_test',
      path: join(__dirname, 'modules', 'ai_test'),
      manifest: manifest,
    }];

    const count = aiRegistry.discoverAIModules(mockModules);
    if (count !== 1) {
      throw new Error(`Expected 1 discovered module, got ${count}`);
    }
    aiTestDiscovered = true;
  });

  await test('Discovered module is registered correctly', () => {
    if (!aiTestDiscovered) {
      throw new Error('Previous test did not run');
    }

    const module = aiRegistry.getModule('ai_test');
    if (!module) {
      // Debug: list all registered modules
      const all = aiRegistry.listAll();
      console.log('  Debug: Registered modules:', all.map(m => m.name).join(', '));
      throw new Error('ai_test module not registered');
    }
    if (module.type !== 'provider') {
      throw new Error('Wrong type for ai_test module');
    }
    if (!module.capabilities || !module.capabilities.models) {
      throw new Error('Missing capabilities.models');
    }
  });

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(60));

  if (failed > 0) {
    console.log('\n❌ REGRESSION DETECTED: Some tests failed');
    process.exit(1);
  } else {
    console.log('\n✅ ALL TESTS PASSED: Feature 1 is working correctly');
    process.exit(0);
  }
}

runTests().catch(error => {
  console.error('\n❌ Test execution error:', error);
  process.exit(1);
});
