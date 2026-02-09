/**
 * Test script for Feature #27: AccessResult factory methods and state checks
 */

import { AccessResult } from './core/lib/Access/AccessResult.js';

console.log('Testing Feature #27: AccessResult factory methods and state checks\n');

let passCount = 0;
let failCount = 0;

function test(description, condition) {
  if (condition) {
    console.log(`✅ PASS: ${description}`);
    passCount++;
  } else {
    console.log(`❌ FAIL: ${description}`);
    failCount++;
  }
}

// Test 1: allowed() factory creates ALLOWED state
const allowedResult = AccessResult.allowed();
test('AccessResult.allowed().isAllowed() === true', allowedResult.isAllowed() === true);
test('allowed result is not forbidden', allowedResult.isForbidden() === false);
test('allowed result is not neutral', allowedResult.isNeutral() === false);

// Test 2: forbidden() factory creates FORBIDDEN state with reason
const forbiddenResult = AccessResult.forbidden('no perm');
test('AccessResult.forbidden("no perm").getReason() === "no perm"', forbiddenResult.getReason() === 'no perm');
test('forbidden result is forbidden', forbiddenResult.isForbidden() === true);
test('forbidden result is not allowed', forbiddenResult.isAllowed() === false);
test('forbidden result is not neutral', forbiddenResult.isNeutral() === false);

// Test 3: neutral() factory creates NEUTRAL state
const neutralResult = AccessResult.neutral();
test('AccessResult.neutral().isNeutral() === true', neutralResult.isNeutral() === true);
test('neutral result is not allowed', neutralResult.isAllowed() === false);
test('neutral result is not forbidden', neutralResult.isForbidden() === false);

// Test 4: neutral with reason
const neutralWithReason = AccessResult.neutral('no opinion');
test('neutral can have reason', neutralWithReason.getReason() === 'no opinion');

// Test 5: Check internal structure
test('AccessResult has _state property', allowedResult._state === 'allowed');
test('AccessResult has _cacheContexts array', Array.isArray(allowedResult._cacheContexts));
test('AccessResult has _cacheTags array', Array.isArray(allowedResult._cacheTags));
test('AccessResult has _cacheMaxAge property', allowedResult.hasOwnProperty('_cacheMaxAge'));

// Test 6: Symbol-based private reason storage
const reasonSymbol = Object.getOwnPropertySymbols(allowedResult).find(s => s.description === 'reason');
test('AccessResult uses Symbol for reason storage', reasonSymbol !== undefined);

console.log(`\n${'='.repeat(60)}`);
console.log(`Total: ${passCount + failCount} tests`);
console.log(`✅ Passed: ${passCount}`);
console.log(`❌ Failed: ${failCount}`);
console.log(`${'='.repeat(60)}\n`);

if (failCount === 0) {
  console.log('🎉 All tests passed! Feature #27 is complete.\n');
  process.exit(0);
} else {
  console.log('⚠️  Some tests failed. Review implementation.\n');
  process.exit(1);
}
