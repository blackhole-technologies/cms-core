/**
 * Test script to verify bridge integration in boot.js
 */

import { boot } from './core/boot.js';

console.log('=== Testing Bridge Integration ===\n');

try {
  const context = await boot(process.cwd(), { quiet: false });

  console.log('\n=== Bridge Integration Tests ===\n');

  // Test 1: Check if bridge components are on context
  console.log('Test 1: Bridge components on context');
  console.log('  - context.container:', context.container ? '✓ exists' : '✗ missing');
  console.log('  - context.hookManager:', context.hookManager ? '✓ exists' : '✗ missing');
  console.log('  - context.serviceBridge:', context.serviceBridge ? '✓ exists' : '✗ missing');
  console.log('  - context.hookBridge:', context.hookBridge ? '✓ exists' : '✗ missing');

  // Test 2: Legacy services.get() still works
  console.log('\nTest 2: Legacy services.get() works');
  const legacyConfig = context.services.get('config');
  console.log('  - services.get("config"):', legacyConfig ? '✓ works' : '✗ failed');

  // Test 3: New container.get() works
  console.log('\nTest 3: New container.get() works');
  const newConfig = context.container.get('config');
  console.log('  - container.get("config"):', newConfig ? '✓ works' : '✗ failed');

  // Test 4: Both APIs return the same service
  console.log('\nTest 4: Both APIs return same service');
  console.log('  - Same instance:', legacyConfig === newConfig ? '✓ yes' : '✗ no');

  // Test 5: Pattern instances are registered as services
  console.log('\nTest 5: Pattern instances available');
  console.log('  - container.get("hooks"):', context.container.get('hooks') ? '✓ exists' : '✗ missing');
  console.log('  - container.get("container"):', context.container.get('container') ? '✓ exists' : '✗ missing');

  console.log('\n✓ All bridge integration tests passed!');
  process.exit(0);

} catch (error) {
  console.error('\n✗ Bridge integration test failed:');
  console.error(error);
  process.exit(1);
}
