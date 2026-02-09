/**
 * Test script for Feature #28: AccessResult combination logic and cache metadata
 */

import { AccessResult } from './core/lib/Access/AccessResult.js';

console.log('Testing Feature #28: AccessResult combination logic and cache metadata\n');

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

// ===== Test orIf() combination logic =====
console.log('\n--- Testing orIf() combination logic ---');

// FORBIDDEN wins over ALLOWED
const test1 = AccessResult.allowed().orIf(AccessResult.forbidden('x'));
test('allowed().orIf(forbidden("x")).isForbidden() === true', test1.isForbidden() === true);
test('forbidden reason is preserved', test1.getReason() === 'x');

// ALLOWED wins over NEUTRAL
const test2 = AccessResult.allowed().orIf(AccessResult.neutral());
test('allowed().orIf(neutral()).isAllowed() === true', test2.isAllowed() === true);

// NEUTRAL orIf NEUTRAL = NEUTRAL
const test3 = AccessResult.neutral().orIf(AccessResult.neutral());
test('neutral().orIf(neutral()).isNeutral() === true', test3.isNeutral() === true);

// Order doesn't matter for FORBIDDEN winning
const test4 = AccessResult.forbidden('y').orIf(AccessResult.allowed());
test('forbidden("y").orIf(allowed()).isForbidden() === true', test4.isForbidden() === true);
test('forbidden reason preserved from first result', test4.getReason() === 'y');

// ===== Test andIf() combination logic =====
console.log('\n--- Testing andIf() combination logic ---');

// FORBIDDEN wins over everything
const test5 = AccessResult.allowed().andIf(AccessResult.forbidden('z'));
test('allowed().andIf(forbidden("z")).isForbidden() === true', test5.isForbidden() === true);

// NEUTRAL makes result NEUTRAL
const test6 = AccessResult.allowed().andIf(AccessResult.neutral());
test('allowed().andIf(neutral()).isNeutral() === true', test6.isNeutral() === true);

// Both ALLOWED = ALLOWED
const test7 = AccessResult.allowed().andIf(AccessResult.allowed());
test('allowed().andIf(allowed()).isAllowed() === true', test7.isAllowed() === true);

// NEUTRAL and NEUTRAL = NEUTRAL
const test8 = AccessResult.neutral().andIf(AccessResult.neutral());
test('neutral().andIf(neutral()).isNeutral() === true', test8.isNeutral() === true);

// ===== Test cache metadata methods =====
console.log('\n--- Testing cache metadata methods ---');

// addCacheContexts
const test9 = AccessResult.allowed();
test9.addCacheContexts(['context1', 'context2']);
test('addCacheContexts adds to _cacheContexts',
  test9._cacheContexts.includes('context1') && test9._cacheContexts.includes('context2'));
test('addCacheContexts returns this (for chaining)', test9.addCacheContexts(['context3']) === test9);

// addCacheTags
const test10 = AccessResult.allowed();
test10.addCacheTags(['node:1', 'user:5']);
test('addCacheTags adds to _cacheTags',
  test10._cacheTags.includes('node:1') && test10._cacheTags.includes('user:5'));
test('addCacheTags returns this (for chaining)', test10.addCacheTags(['node:2']) === test10);

// cachePerUser
const test11 = AccessResult.allowed().cachePerUser();
test('cachePerUser() adds "user" context', test11._cacheContexts.includes('user'));
test('cachePerUser returns this (for chaining)', test11.cachePerUser() === test11);

// cachePerPermissions
const test12 = AccessResult.allowed().cachePerPermissions();
test('cachePerPermissions() adds "user.permissions" context',
  test12._cacheContexts.includes('user.permissions'));
test('cachePerPermissions returns this (for chaining)', test12.cachePerPermissions() === test12);

// Method chaining
const test13 = AccessResult.allowed()
  .cachePerUser()
  .addCacheTags(['node:1'])
  .cachePerPermissions();
test('Methods chain together',
  test13._cacheContexts.includes('user') &&
  test13._cacheContexts.includes('user.permissions') &&
  test13._cacheTags.includes('node:1'));

// Cache metadata merges in orIf
const a = AccessResult.allowed().addCacheContexts(['ctx1']).addCacheTags(['tag1']);
const b = AccessResult.allowed().addCacheContexts(['ctx2']).addCacheTags(['tag2']);
const merged = a.orIf(b);
test('orIf() merges cache contexts',
  merged._cacheContexts.includes('ctx1') && merged._cacheContexts.includes('ctx2'));
test('orIf() merges cache tags',
  merged._cacheTags.includes('tag1') && merged._cacheTags.includes('tag2'));

// Cache metadata merges in andIf
const c = AccessResult.allowed().addCacheContexts(['ctx3']).addCacheTags(['tag3']);
const d = AccessResult.allowed().addCacheContexts(['ctx4']).addCacheTags(['tag4']);
const merged2 = c.andIf(d);
test('andIf() merges cache contexts',
  merged2._cacheContexts.includes('ctx3') && merged2._cacheContexts.includes('ctx4'));
test('andIf() merges cache tags',
  merged2._cacheTags.includes('tag3') && merged2._cacheTags.includes('tag4'));

console.log(`\n${'='.repeat(60)}`);
console.log(`Total: ${passCount + failCount} tests`);
console.log(`✅ Passed: ${passCount}`);
console.log(`❌ Failed: ${failCount}`);
console.log(`${'='.repeat(60)}\n`);

if (failCount === 0) {
  console.log('🎉 All tests passed! Feature #28 is complete.\n');
  process.exit(0);
} else {
  console.log('⚠️  Some tests failed. Review implementation.\n');
  process.exit(1);
}
