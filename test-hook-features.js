/**
 * Test script for Hook System Features #17, #18, #19
 *
 * This tests:
 * - Feature #17: HookManager.on() registers handlers with priority sorting
 * - Feature #18: HookManager.invoke() executes handlers sequentially with error handling
 * - Feature #19: HookManager.alter() chains data transformations
 */

import { HookManager } from './core/lib/Hook/index.js';

// Test counters and results
let testsPassed = 0;
let testsFailed = 0;
const results = [];

function assert(condition, message) {
  if (condition) {
    testsPassed++;
    results.push(`✅ ${message}`);
  } else {
    testsFailed++;
    results.push(`❌ ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('Testing Hook System Features #17, #18, #19');
  console.log('='.repeat(60));
  console.log();

  // ============================================================
  // FEATURE #17: HookManager.on() - Handler Registration
  // ============================================================
  console.log('FEATURE #17: Testing HookManager.on()...\n');

  const hooks = new HookManager();

  // Test 1: Basic registration
  const handler1 = async () => {};
  const result = hooks.on('test', handler1, { priority: 5, module: 'mymod' });
  assert(result === hooks, 'on() returns this for chaining');
  assert(hooks.hasHandlers('test'), 'Handler registered for "test" hook');
  assert(hooks.getHandlerCount('test') === 1, 'Handler count is 1');

  // Test 2: Priority sorting
  const executionOrder = [];
  hooks.on('priority_test', async () => executionOrder.push('priority-5'), { priority: 5 });
  hooks.on('priority_test', async () => executionOrder.push('priority-1'), { priority: 1 });
  hooks.on('priority_test', async () => executionOrder.push('priority-10'), { priority: 10 });

  await hooks.invoke('priority_test');
  assert(executionOrder[0] === 'priority-1', 'Priority 1 runs first');
  assert(executionOrder[1] === 'priority-5', 'Priority 5 runs second');
  assert(executionOrder[2] === 'priority-10', 'Priority 10 runs third');

  // Test 3: Method chaining
  const chainHooks = new HookManager();
  const chainResult = chainHooks
    .on('a', async () => {})
    .on('b', async () => {})
    .on('c', async () => {});
  assert(chainResult === chainHooks, 'Chaining returns HookManager instance');
  assert(chainHooks.listHooks().length === 3, 'All chained hooks registered');

  console.log('\n✅ Feature #17: HookManager.on() - ALL TESTS PASSED\n');
  console.log('='.repeat(60));
  console.log();

  // ============================================================
  // FEATURE #18: HookManager.invoke() - Sequential Execution
  // ============================================================
  console.log('FEATURE #18: Testing HookManager.invoke()...\n');

  const invokeHooks = new HookManager();

  // Test 1: Sequential execution
  const executionLog = [];
  invokeHooks.on('seq_test', async () => {
    executionLog.push('handler1-start');
    await new Promise(resolve => setTimeout(resolve, 10));
    executionLog.push('handler1-end');
  }, { priority: 1 });

  invokeHooks.on('seq_test', async () => {
    executionLog.push('handler2-start');
    await new Promise(resolve => setTimeout(resolve, 5));
    executionLog.push('handler2-end');
  }, { priority: 2 });

  invokeHooks.on('seq_test', async () => {
    executionLog.push('handler3-start');
    executionLog.push('handler3-end');
  }, { priority: 3 });

  await invokeHooks.invoke('seq_test');
  assert(executionLog[0] === 'handler1-start', 'Handler 1 starts first');
  assert(executionLog[1] === 'handler1-end', 'Handler 1 completes before handler 2 starts');
  assert(executionLog[2] === 'handler2-start', 'Handler 2 starts after handler 1');
  assert(executionLog[3] === 'handler2-end', 'Handler 2 completes');
  assert(executionLog[4] === 'handler3-start', 'Handler 3 starts after handler 2');
  assert(executionLog[5] === 'handler3-end', 'Handler 3 completes');

  // Test 2: Error handling (handler #2 throws, handler #3 still runs)
  const errorLog = [];
  invokeHooks.on('error_test', async () => {
    errorLog.push('handler1');
  }, { priority: 1 });

  invokeHooks.on('error_test', async () => {
    errorLog.push('handler2');
    throw new Error('Intentional test error');
  }, { priority: 2 });

  invokeHooks.on('error_test', async () => {
    errorLog.push('handler3');
  }, { priority: 3 });

  // Suppress error output for test
  const originalError = console.error;
  console.error = () => {};
  await invokeHooks.invoke('error_test');
  console.error = originalError;

  assert(errorLog.length === 3, 'All 3 handlers executed despite error in handler 2');
  assert(errorLog[0] === 'handler1', 'Handler 1 executed');
  assert(errorLog[1] === 'handler2', 'Handler 2 executed before throwing');
  assert(errorLog[2] === 'handler3', 'Handler 3 executed after handler 2 error');

  // Test 3: Once-handlers auto-remove
  let onceCount = 0;
  invokeHooks.on('once_test', async () => {
    onceCount++;
  }, { once: true });

  assert(invokeHooks.hasHandlers('once_test'), 'Once-handler registered');
  await invokeHooks.invoke('once_test');
  assert(onceCount === 1, 'Once-handler executed first time');
  await invokeHooks.invoke('once_test');
  assert(onceCount === 1, 'Once-handler NOT executed second time');
  assert(!invokeHooks.hasHandlers('once_test'), 'Once-handler removed after execution');

  // Test 4: invokeAll() collects return values
  invokeHooks.on('collect_test', async () => 'result1', { priority: 1 });
  invokeHooks.on('collect_test', async () => 'result2', { priority: 2 });
  invokeHooks.on('collect_test', async () => 'result3', { priority: 3 });

  const collected = await invokeHooks.invokeAll('collect_test');
  assert(Array.isArray(collected), 'invokeAll returns array');
  assert(collected.length === 3, 'invokeAll collected 3 results');
  assert(collected[0] === 'result1', 'First result is "result1"');
  assert(collected[1] === 'result2', 'Second result is "result2"');
  assert(collected[2] === 'result3', 'Third result is "result3"');

  // Test 5: No handlers returns undefined/empty array
  const noHandlerResult = await invokeHooks.invoke('nonexistent');
  assert(noHandlerResult === undefined, 'invoke() returns undefined when no handlers');

  const noHandlerCollect = await invokeHooks.invokeAll('nonexistent');
  assert(Array.isArray(noHandlerCollect) && noHandlerCollect.length === 0,
         'invokeAll() returns empty array when no handlers');

  console.log('\n✅ Feature #18: HookManager.invoke() - ALL TESTS PASSED\n');
  console.log('='.repeat(60));
  console.log();

  // ============================================================
  // FEATURE #19: HookManager.alter() - Data Transformation
  // ============================================================
  console.log('FEATURE #19: Testing HookManager.alter()...\n');

  const alterHooks = new HookManager();

  // Test 1: Single alter hook
  alterHooks.onAlter('form', (form) => {
    return { ...form, extra: true };
  });

  let form = { a: 1 };
  form = await alterHooks.alter('form', form);
  assert(form.a === 1, 'Original property preserved');
  assert(form.extra === true, 'Alter hook added "extra" property');

  // Test 2: Multiple alter hooks chain
  const chainAlterHooks = new HookManager();
  chainAlterHooks.onAlter('form', (form) => {
    return { ...form, extra: true };
  }, { priority: 1 });

  chainAlterHooks.onAlter('form', (form) => {
    return { ...form, more: 123 };
  }, { priority: 2 });

  chainAlterHooks.onAlter('form', (form) => {
    return { ...form, final: 'value' };
  }, { priority: 3 });

  let chainedForm = { a: 1 };
  chainedForm = await chainAlterHooks.alter('form', chainedForm);
  assert(chainedForm.a === 1, 'Original property preserved in chain');
  assert(chainedForm.extra === true, 'First alter hook applied');
  assert(chainedForm.more === 123, 'Second alter hook applied');
  assert(chainedForm.final === 'value', 'Third alter hook applied');

  // Test 3: Alter hook that returns undefined (keeps existing data)
  const undefAlterHooks = new HookManager();
  undefAlterHooks.onAlter('data', (data) => {
    data.mutated = true;  // Mutate in place
    // Don't return anything (undefined)
  });

  let mutatedData = { x: 1 };
  mutatedData = await undefAlterHooks.alter('data', mutatedData);
  assert(mutatedData.x === 1, 'Original data preserved when handler returns undefined');
  assert(mutatedData.mutated === true, 'In-place mutation still works');

  // Test 4: onAlter() is shorthand for on(hookName + '_alter')
  const shorthandHooks = new HookManager();
  shorthandHooks.onAlter('test', (data) => ({ ...data, altered: true }));
  assert(shorthandHooks.hasHandlers('test_alter'), 'onAlter registers handler for "test_alter"');

  let testData = { original: true };
  testData = await shorthandHooks.alter('test', testData);
  assert(testData.altered === true, 'Alter hook applied via onAlter shorthand');

  // Test 5: No alter hooks returns data unchanged
  const noAlterHooks = new HookManager();
  const unchanged = { x: 1, y: 2 };
  const result5 = await noAlterHooks.alter('nonexistent', unchanged);
  assert(result5 === unchanged, 'alter() returns original data when no handlers');
  assert(result5.x === 1 && result5.y === 2, 'Data unchanged when no alter hooks');

  // Test 6: Alter with context parameter
  const contextHooks = new HookManager();
  contextHooks.onAlter('form', (form, context) => {
    if (context.formId === 'node_edit') {
      return { ...form, node_specific: true };
    }
    return form;
  });

  let contextForm = { title: 'Test' };
  contextForm = await contextHooks.alter('form', contextForm, { formId: 'node_edit' });
  assert(contextForm.node_specific === true, 'Alter hook receives context parameter');

  console.log('\n✅ Feature #19: HookManager.alter() - ALL TESTS PASSED\n');
  console.log('='.repeat(60));
  console.log();

  // ============================================================
  // FINAL RESULTS
  // ============================================================
  console.log('='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));
  console.log();

  for (const result of results) {
    console.log(result);
  }

  console.log();
  console.log('='.repeat(60));
  console.log(`TOTAL: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('='.repeat(60));

  if (testsFailed === 0) {
    console.log();
    console.log('🎉 ALL FEATURES VERIFIED:');
    console.log('   ✅ Feature #17: HookManager.on() registers handlers with priority sorting');
    console.log('   ✅ Feature #18: HookManager.invoke() executes handlers sequentially');
    console.log('   ✅ Feature #19: HookManager.alter() chains data transformations');
    console.log();
    process.exit(0);
  } else {
    console.log();
    console.log('❌ SOME TESTS FAILED');
    console.log();
    process.exit(1);
  }
}

// Run tests
runTests().catch(error => {
  console.error('Test execution failed:', error);
  process.exit(1);
});
