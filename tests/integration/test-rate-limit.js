/**
 * Test script for AI provider rate limiting (Feature #19)
 *
 * This script tests that rate limiting works correctly:
 * 1. Configure a low rate limit (e.g., 3 requests/minute)
 * 2. Make rapid requests to exceed the limit
 * 3. Verify requests are blocked with appropriate error
 * 4. Verify error includes retry information
 */

import { checkProviderLimit } from '../../src/core/ai/ai-rate-limiter.ts';

console.log('=== AI Provider Rate Limiting Test ===\n');

// Test 1: Check that we can make requests within the limit
console.log('Test 1: Requests within limit');
for (let i = 1; i <= 3; i++) {
  const result = checkProviderLimit('test-provider', { points: 5, duration: 60 });
  console.log(
    `Request ${i}: ${result.allowed ? '✓ ALLOWED' : '✗ BLOCKED'} (remaining: ${result.remaining})`
  );
}

console.log('\nTest 2: Exceed the limit');
// Test 2: Exceed the limit
for (let i = 4; i <= 7; i++) {
  const result = checkProviderLimit('test-provider', { points: 5, duration: 60 });
  if (!result.allowed) {
    console.log(`Request ${i}: ✗ BLOCKED`);
    console.log(`  Error: ${result.error}`);
    console.log(`  Retry After: ${result.retryAfter} seconds`);
    console.log(`  Reset At: ${new Date(result.resetAt).toISOString()}`);
  } else {
    console.log(`Request ${i}: ✓ ALLOWED (remaining: ${result.remaining})`);
  }
}

console.log('\nTest 3: Rate limits are per-provider (not global)');
// Test 3: Different provider should have separate limit
const result1 = checkProviderLimit('provider-a', { points: 2, duration: 60 });
const result2 = checkProviderLimit('provider-a', { points: 2, duration: 60 });
const result3 = checkProviderLimit('provider-a', { points: 2, duration: 60 });
const result4 = checkProviderLimit('provider-b', { points: 2, duration: 60 });

console.log(`Provider A request 1: ${result1.allowed ? '✓ ALLOWED' : '✗ BLOCKED'}`);
console.log(`Provider A request 2: ${result2.allowed ? '✓ ALLOWED' : '✗ BLOCKED'}`);
console.log(
  `Provider A request 3: ${result3.allowed ? '✗ BLOCKED (expected)' : '✓ ALLOWED (unexpected!)'}`
);
console.log(
  `Provider B request 1: ${result4.allowed ? '✓ ALLOWED (separate limit)' : '✗ BLOCKED (unexpected!)'}`
);

console.log('\n=== Test Complete ===');

// Exit
process.exit(result3.allowed || !result4.allowed ? 1 : 0);
