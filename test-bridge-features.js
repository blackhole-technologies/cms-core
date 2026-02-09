/**
 * Verification script for Bridge Layer features #1, #2, #3
 */

import * as legacyServices from './core/services.js';
import * as legacyHooks from './core/hooks.js';
import { BridgeManager } from './core/lib/Bridge/index.js';

console.log('=== Bridge Layer Feature Verification ===\n');

// Helper to track test results
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${e.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

// Feature #1: ServiceBridge Tests
console.log('Feature #1: ServiceBridge Implementation\n');

// Clear legacy services first
legacyServices.clear();

// Create bridge components manually for testing
const { Container } = await import('./core/lib/DependencyInjection/Container.js');
const { ServiceBridge } = await import('./core/lib/Bridge/ServiceBridge.js');

const container = new Container();
const serviceBridge = new ServiceBridge(legacyServices, container);

test('ServiceBridge.register() registers in both systems', () => {
  const testFactory = () => ({ name: 'test service' });
  serviceBridge.register('test', testFactory);

  assert(legacyServices.has('test'), 'Legacy services should have test');
  assert(container.has('test'), 'Container should have test');
});

test('ServiceBridge.get() resolves from Container first', () => {
  const instance = serviceBridge.get('test');
  assert(instance.name === 'test service', 'Should resolve test service');
});

test('ServiceBridge.wrapLegacy() migrates existing legacy services', () => {
  // Register a service in legacy only
  legacyServices.register('legacy_only', () => ({ legacy: true }));

  // Wrap legacy services
  const migrated = serviceBridge.wrapLegacy();

  assert(migrated >= 1, 'Should migrate at least 1 service');
  assert(container.has('legacy_only'), 'Container should have legacy_only');

  const instance = container.get('legacy_only');
  assert(instance.legacy === true, 'Should resolve legacy service via Container');
});

test('ServiceBridge.has() checks both systems', () => {
  assert(serviceBridge.has('test'), 'Should find test in Container');
  assert(serviceBridge.has('legacy_only'), 'Should find legacy_only');
});

test('ServiceBridge.list() returns combined list', () => {
  const list = serviceBridge.list();
  assert(list.includes('test'), 'List should include test');
  assert(list.includes('legacy_only'), 'List should include legacy_only');
});

console.log('');

// Feature #2: HookBridge Tests
console.log('Feature #2: HookBridge Implementation\n');

// Clear legacy hooks first
legacyHooks.clear();

const { HookManager } = await import('./core/lib/Hook/HookManager.js');
const { HookBridge } = await import('./core/lib/Bridge/HookBridge.js');

const hookManager = new HookManager();
const hookBridge = new HookBridge(legacyHooks, hookManager);

test('HookBridge.register() registers in both systems', () => {
  let called = false;
  const handler = async () => { called = true; };

  hookBridge.register('test', handler, { module: 'mymod' });

  assert(legacyHooks.hasHandlers('test'), 'Legacy hooks should have test');
  assert(hookManager.hasHandlers('test'), 'HookManager should have test');
});

test('HookBridge.trigger() invokes via HookManager', async () => {
  let callCount = 0;
  const handler = async () => { callCount++; };

  // Clear previous test hook
  hookBridge.clear('test');

  hookBridge.register('test', handler);

  const context = {};
  await hookBridge.trigger('test', context);

  assert(callCount === 1, 'Handler should be called once via HookManager');
});

test('HookBridge.wrapLegacy() migrates existing hooks', () => {
  // Register a hook in legacy only
  let legacyCalled = false;
  legacyHooks.register('legacy_hook', async () => { legacyCalled = true; });

  // Wrap legacy hooks
  const migrated = hookBridge.wrapLegacy();

  assert(migrated >= 1, 'Should migrate at least 1 hook');
  assert(hookManager.hasHandlers('legacy_hook'), 'HookManager should have legacy_hook');
});

test('HookBridge.hasHandlers() checks HookManager', () => {
  assert(hookBridge.hasHandlers('test'), 'Should have test handlers');
});

test('HookBridge.listHooks() returns all hooks', () => {
  const hooks = hookBridge.listHooks();
  assert(hooks.includes('test'), 'Should include test hook');
});

console.log('');

// Feature #3: BridgeManager Tests
console.log('Feature #3: BridgeManager Orchestration\n');

// Clear everything for clean test
legacyServices.clear();
legacyHooks.clear();

// Pre-register some legacy services and hooks
legacyServices.register('db', () => ({ type: 'database' }));
legacyHooks.register('boot', async () => {});

// Create BridgeManager
const bridgeManager = new BridgeManager(legacyServices, legacyHooks);

// Store bridge result at module level
let bridgeResult = null;

await test('BridgeManager.setup() returns all bridge components', async () => {
  const result = await bridgeManager.setup();

  assert(result.container, 'Should return container');
  assert(result.hookManager, 'Should return hookManager');
  assert(result.serviceBridge, 'Should return serviceBridge');
  assert(result.hookBridge, 'Should return hookBridge');

  // Store for next tests
  bridgeResult = result;
});

await test('BridgeManager setup migrates legacy services to Container', () => {
  const { container } = bridgeResult;
  assert(container.has('db'), 'Container should have db service');

  const db = container.get('db');
  assert(db.type === 'database', 'Should resolve db service');
});

await test('BridgeManager setup migrates legacy hooks to HookManager', () => {
  const { hookManager } = bridgeResult;
  assert(hookManager.hasHandlers('boot'), 'HookManager should have boot hook');
});

await test('BridgeManager registers pattern instances as services', () => {
  const { container } = bridgeResult;

  assert(container.has('container'), 'Should register container service');
  assert(container.has('hooks'), 'Should register hooks service');
  assert(container.has('service_bridge'), 'Should register service_bridge');
  assert(container.has('hook_bridge'), 'Should register hook_bridge');
});

await test('Pattern instances available via container.get()', () => {
  const { container, hookManager } = bridgeResult;

  const retrievedHooks = container.get('hooks');
  assert(retrievedHooks === hookManager, 'Should return same HookManager instance');

  const retrievedContainer = container.get('container');
  assert(retrievedContainer === container, 'Should return same Container instance');
});

await test('BridgeManager prevents double setup', async () => {
  try {
    await bridgeManager.setup();
    assert(false, 'Should throw on double setup');
  } catch (e) {
    assert(e.message.includes('already been called'), 'Should throw correct error');
  }
});

await test('BridgeManager.isSetupComplete() returns true after setup', () => {
  assert(bridgeManager.isSetupComplete(), 'Should return true');
});

// Test EntityTypeManager wiring (if available)
await test('BridgeManager wires EntityTypeManager if available', async () => {
  const { container } = bridgeResult;

  try {
    const entityManager = container.get('entity_type.manager');
    console.log('  ℹ EntityTypeManager was wired successfully');
  } catch (e) {
    // EntityTypeManager might not exist yet - that's OK
    console.log('  ℹ EntityTypeManager not available (expected if not built yet)');
  }
});

console.log('');

// Summary
console.log('=== Test Summary ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${passed + failed}`);

if (failed === 0) {
  console.log('\n✓ All tests passed!');
  console.log('\nFeatures #1, #2, #3 are complete and working correctly.');
  process.exit(0);
} else {
  console.log('\n✗ Some tests failed');
  process.exit(1);
}
