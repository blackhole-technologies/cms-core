/**
 * Test script for Feature #29: combineAccessResults() and AccessPolicy class
 */

import { AccessResult, combineAccessResults } from './core/lib/Access/AccessResult.js';
import { AccessPolicy } from './core/lib/Access/AccessPolicy.js';

console.log('Testing Feature #29: combineAccessResults() and AccessPolicy class\n');

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

// ===== Test combineAccessResults() function =====
console.log('\n--- Testing combineAccessResults() ---');

// Short-circuit on FORBIDDEN
const test1 = combineAccessResults([
  AccessResult.allowed(),
  AccessResult.neutral(),
  AccessResult.forbidden('x')
]);
test('combineAccessResults([allowed(), neutral(), forbidden("x")]).isForbidden() === true',
  test1.isForbidden() === true);
test('Forbidden reason is preserved', test1.getReason() === 'x');

// ALLOWED wins over NEUTRAL
const test2 = combineAccessResults([
  AccessResult.allowed(),
  AccessResult.neutral()
]);
test('combineAccessResults([allowed(), neutral()]).isAllowed() === true',
  test2.isAllowed() === true);

// All NEUTRAL = NEUTRAL
const test3 = combineAccessResults([
  AccessResult.neutral(),
  AccessResult.neutral()
]);
test('combineAccessResults([neutral(), neutral()]).isNeutral() === true',
  test3.isNeutral() === true);

// FORBIDDEN appears early in list
const test4 = combineAccessResults([
  AccessResult.allowed(),
  AccessResult.forbidden('early exit'),
  AccessResult.allowed()
]);
test('FORBIDDEN in middle of list is returned',
  test4.isForbidden() && test4.getReason() === 'early exit');

// Empty array edge case
const test5 = combineAccessResults([]);
test('Empty array returns NEUTRAL', test5.isNeutral() === true);

// Single result
const test6 = combineAccessResults([AccessResult.allowed()]);
test('Single result returns that result', test6.isAllowed() === true);

// Multiple ALLOWED
const test7 = combineAccessResults([
  AccessResult.allowed(),
  AccessResult.allowed(),
  AccessResult.allowed()
]);
test('Multiple ALLOWED returns ALLOWED', test7.isAllowed() === true);

// Order matters: first FORBIDDEN wins
const test8a = combineAccessResults([
  AccessResult.forbidden('first'),
  AccessResult.forbidden('second')
]);
test('First FORBIDDEN wins (reason check)', test8a.getReason() === 'first');

// Order doesn't matter for ALLOWED vs NEUTRAL
const test9a = combineAccessResults([AccessResult.neutral(), AccessResult.allowed()]);
const test9b = combineAccessResults([AccessResult.allowed(), AccessResult.neutral()]);
test('Order-independent for ALLOWED vs NEUTRAL (neutral first)',
  test9a.isAllowed() === true);
test('Order-independent for ALLOWED vs NEUTRAL (allowed first)',
  test9b.isAllowed() === true);

// ===== Test AccessPolicy class =====
console.log('\n--- Testing AccessPolicy class ---');

// Base AccessPolicy exists and is constructable
const policy = new AccessPolicy();
test('AccessPolicy class is constructable', policy instanceof AccessPolicy);

// Base check() method exists and returns NEUTRAL
const account = { id: 1, hasPermission: () => false };
const operation = 'view';
const context = { entity: { id: 42 } };

const result = policy.check(account, operation, context);
test('AccessPolicy.check() method exists and is callable', typeof policy.check === 'function');
test('Base check() returns AccessResult', result instanceof AccessResult);
test('Base check() returns NEUTRAL by default', result.isNeutral() === true);

// Test subclass pattern
class TestPolicy extends AccessPolicy {
  check(account, operation, context) {
    if (account.isAdmin) {
      return AccessResult.allowed();
    }
    return AccessResult.forbidden('Not admin');
  }
}

const adminAccount = { isAdmin: true };
const userAccount = { isAdmin: false };

const testPolicy = new TestPolicy();
const adminResult = testPolicy.check(adminAccount, 'delete', {});
const userResult = testPolicy.check(userAccount, 'delete', {});

test('Subclass can override check()', adminResult.isAllowed() === true);
test('Subclass override works correctly', userResult.isForbidden() === true);

// Test combining multiple policies
class AlwaysAllowPolicy extends AccessPolicy {
  check() { return AccessResult.allowed(); }
}

class AlwaysForbidPolicy extends AccessPolicy {
  check() { return AccessResult.forbidden('Nope'); }
}

const policies = [
  new AlwaysAllowPolicy(),
  new AccessPolicy(), // NEUTRAL
  new AlwaysAllowPolicy(),
];

const combinedResult = combineAccessResults(policies.map(p => p.check(account, 'view', {})));
test('Combining policy results works', combinedResult.isAllowed() === true);

const policiesWithForbid = [
  new AlwaysAllowPolicy(),
  new AlwaysForbidPolicy(),
  new AlwaysAllowPolicy(),
];

const combinedForbid = combineAccessResults(policiesWithForbid.map(p => p.check(account, 'view', {})));
test('FORBIDDEN policy blocks access in combination', combinedForbid.isForbidden() === true);

console.log(`\n${'='.repeat(60)}`);
console.log(`Total: ${passCount + failCount} tests`);
console.log(`✅ Passed: ${passCount}`);
console.log(`❌ Failed: ${failCount}`);
console.log(`${'='.repeat(60)}\n`);

if (failCount === 0) {
  console.log('🎉 All tests passed! Feature #29 is complete.\n');
  process.exit(0);
} else {
  console.log('⚠️  Some tests failed. Review implementation.\n');
  process.exit(1);
}
