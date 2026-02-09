/**
 * Feature #5 Verification: Boot.js bridge integration
 *
 * Tests all acceptance criteria from the spec:
 * 1. After boot, both legacy services.get('x') and container.get('x') work
 * 2. Modules loaded after bridge setup have hooks in both systems
 * 3. Boot completes without errors
 */

import { boot } from './core/boot.js';

console.log('=== Feature #5: Boot.js Bridge Integration ===\n');

// Patch server.start to avoid port binding
import * as server from './core/server.js';
const originalStart = server.start;
server.start = async () => {
  console.log('[TEST] Skipping server.start() to avoid port binding');
};

try {
  const context = await boot(process.cwd(), { quiet: true });

  console.log('\n=== Verification Tests ===\n');

  // Test 1: Both legacy and new APIs work for the same service
  console.log('Test 1: Legacy services.get() and new container.get() work');
  const legacyConfig = context.services.get('config');
  const newConfig = context.container.get('config');

  if (!legacyConfig) throw new Error('Legacy services.get("config") failed');
  if (!newConfig) throw new Error('New container.get("config") failed');
  if (legacyConfig !== newConfig) throw new Error('Different instances returned');

  console.log('  ✓ services.get("config") works');
  console.log('  ✓ container.get("config") works');
  console.log('  ✓ Both return the same instance');

  // Test 2: Multiple services work in both systems
  console.log('\nTest 2: Multiple services accessible from both systems');
  const services = ['hooks', 'content', 'cache', 'router'];
  let passed = 0;

  for (const svc of services) {
    const legacy = context.services.get(svc);
    const modern = context.container.get(svc);

    if (legacy && modern && legacy === modern) {
      passed++;
    } else {
      throw new Error(`Service "${svc}" not bridged correctly`);
    }
  }

  console.log(`  ✓ All ${passed} test services bridged correctly`);

  // Test 3: Modules registered hooks in both systems
  console.log('\nTest 3: Modules have hooks registered in both systems');

  // Check legacy hooks
  const legacyHookExists = context.hooks.getHandlers &&
                           context.hooks.getHandlers('boot').length > 0;

  // Check new HookManager
  const newHookExists = context.hookManager.getHandlers &&
                        context.hookManager.getHandlers('boot').length > 0;

  if (!legacyHookExists) throw new Error('Legacy hooks.getHandlers("boot") has no handlers');
  if (!newHookExists) throw new Error('New hookManager.getHandlers("boot") has no handlers');

  console.log('  ✓ Legacy hooks system has handlers');
  console.log('  ✓ New HookManager has handlers');

  // Test 4: Bridge components on context
  console.log('\nTest 4: Bridge components accessible on context');

  if (!context.container) throw new Error('context.container missing');
  if (!context.hookManager) throw new Error('context.hookManager missing');
  if (!context.serviceBridge) throw new Error('context.serviceBridge missing');
  if (!context.hookBridge) throw new Error('context.hookBridge missing');

  console.log('  ✓ context.container exists');
  console.log('  ✓ context.hookManager exists');
  console.log('  ✓ context.serviceBridge exists');
  console.log('  ✓ context.hookBridge exists');

  // Test 5: Pattern instances registered as services
  console.log('\nTest 5: Pattern instances available via container');

  const containerSvc = context.container.get('container');
  const hooksSvc = context.container.get('hooks');

  if (!containerSvc) throw new Error('container.get("container") failed');
  if (!hooksSvc) throw new Error('container.get("hooks") failed');
  if (containerSvc !== context.container) throw new Error('container service is not the container');
  if (hooksSvc !== context.hookManager) throw new Error('hooks service is not the hookManager');

  console.log('  ✓ Container registered as service "container"');
  console.log('  ✓ HookManager registered as service "hooks"');

  // Test 6: Boot completed without errors
  console.log('\nTest 6: Boot sequence completed');
  console.log('  ✓ No errors during boot (would have thrown)');
  console.log('  ✓ All phases completed successfully');

  console.log('\n=== All Tests Passed ===');
  console.log('✓ Feature #5 verified successfully');
  console.log('  - Legacy services.get() works');
  console.log('  - New container.get() works');
  console.log('  - Both return same instances');
  console.log('  - Modules registered hooks in both systems');
  console.log('  - Bridge components on context');
  console.log('  - Boot completed without errors');

  process.exit(0);

} catch (error) {
  console.error('\n✗ Feature #5 verification failed:');
  console.error(error.message);
  console.error(error.stack);
  process.exit(1);
}
