#!/usr/bin/env node
/**
 * Test Script for Feature #1: Token replacement service
 *
 * This script tests all verification steps for the token replacement service.
 */

import * as tokens from './core/tokens.js';

console.log('=== Feature #1: Token Replacement Service ===\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${error.message}`);
    failed++;
  }
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\n  Expected: ${expected}\n  Actual: ${actual}`);
  }
}

function assertTrue(value, message) {
  if (!value) {
    throw new Error(message);
  }
}

// Step 2: Verify token replacement service is registered
test('Token service exports exist', () => {
  assertTrue(typeof tokens.replace === 'function', 'replace() should be a function');
  assertTrue(typeof tokens.registerType === 'function', 'registerType() should be a function');
  assertTrue(typeof tokens.registerToken === 'function', 'registerToken() should be a function');
  assertTrue(typeof tokens.scan === 'function', 'scan() should be a function');
  assertTrue(typeof tokens.parseToken === 'function', 'parseToken() should be a function');
});

// Step 3-6: Test basic token replacement with [site:name]
test('Basic token replacement: [site:name]', async () => {
  const text = '[site:name]';
  const context = { site: { name: 'Test Site' } };
  const result = await tokens.replace(text, context);
  assertEquals(result, 'Test Site', 'Should replace [site:name] with "Test Site"');
});

// Step 7-8: Test multiple tokens in one string
test('Multiple tokens: [current-user:name] created [content:title]', async () => {
  const text = '[current-user:name] created [content:title]';
  const context = {
    user: { name: 'John Doe' },
    content: { title: 'Test Article' }
  };
  const result = await tokens.replace(text, context);
  assertEquals(result, 'John Doe created Test Article', 'Should replace both tokens correctly');
});

// Step 9: Test token with no available data returns original token unchanged
test('Missing context returns original token', async () => {
  const text = '[content:title]';
  const context = {}; // No content in context
  const result = await tokens.replace(text, context);
  assertEquals(result, '[content:title]', 'Should keep original token when data unavailable');
});

// Step 10: Test nested/chained token patterns
test('Chained tokens: [content:author:name]', async () => {
  const text = '[content:author:name]';
  const context = {
    content: {
      author: { name: 'Jane Smith', email: 'jane@example.com' }
    }
  };
  const result = await tokens.replace(text, context);
  assertEquals(result, 'Jane Smith', 'Should resolve chained token path');
});

// Step 11: Test token caching/performance (basic check)
test('Token replacement is performant', async () => {
  const text = '[site:name] [site:name] [site:name]';
  const context = { site: { name: 'Fast Site' } };
  const start = Date.now();
  const result = await tokens.replace(text, context);
  const duration = Date.now() - start;
  assertEquals(result, 'Fast Site Fast Site Fast Site', 'Should replace all occurrences');
  assertTrue(duration < 100, `Should complete in <100ms (took ${duration}ms)`);
});

// Step 12: Test graceful handling of null/undefined context
test('Null/undefined context handled gracefully', async () => {
  const text = '[site:name]';
  let result = await tokens.replace(text, null);
  assertEquals(result, '[site:name]', 'Should handle null context');

  result = await tokens.replace(text, undefined);
  assertEquals(result, '[site:name]', 'Should handle undefined context');

  result = await tokens.replace(text);
  assertEquals(result, '[site:name]', 'Should handle missing context parameter');
});

// Step 13: Test token service logs errors for malformed tokens (parse function)
test('Malformed tokens handled correctly', () => {
  const malformed = '[notokenname]';
  const parsed = tokens.parseToken(malformed);
  assertEquals(parsed, null, 'Should return null for malformed token');

  const validParsed = tokens.parseToken('[site:name]');
  assertTrue(validParsed !== null, 'Should parse valid token');
  assertEquals(validParsed.type, 'site', 'Should extract type correctly');
  assertEquals(validParsed.name, 'name', 'Should extract name correctly');
});

// Test built-in token types are registered
test('Core token types are registered', () => {
  const types = tokens.getTypes();
  assertTrue(types['site'] !== undefined, 'site token type should be registered');
  assertTrue(types['date'] !== undefined, 'date token type should be registered');
  assertTrue(types['current-user'] !== undefined, 'current-user token type should be registered');
  assertTrue(types['content'] !== undefined, 'content token type should be registered');
});

// Test date tokens
test('Date tokens work correctly', async () => {
  const text = '[date:short]';
  const result = await tokens.replace(text, {});
  // Should return a date string, not the original token
  assertTrue(result !== '[date:short]', 'Should replace date token');
  assertTrue(result.match(/\d{1,2}\/\d{1,2}\/\d{4}/), 'Should be valid date format');
});

// Test HTML escaping
test('HTML is escaped by default', async () => {
  const text = '[content:title]';
  const context = { content: { title: '<script>alert("xss")</script>' } };
  const result = await tokens.replace(text, context);
  assertTrue(result.includes('&lt;'), 'Should escape < character');
  assertTrue(result.includes('&gt;'), 'Should escape > character');
  assertTrue(!result.includes('<script>'), 'Should not contain raw script tag');
});

// Test raw modifier disables HTML escaping
test('Raw modifier disables HTML escaping', async () => {
  const text = '[content:title:raw]';
  const context = { content: { title: '<b>Bold</b>' } };
  const result = await tokens.replace(text, context);
  assertEquals(result, '<b>Bold</b>', 'Raw modifier should preserve HTML');
});

// Test scan function
test('Scan function finds all tokens', () => {
  const text = 'Welcome [current-user:name]! You have [site:name] access. Today is [date:medium].';
  const found = tokens.scan(text);
  assertEquals(found.length, 3, 'Should find 3 tokens');
  assertEquals(found[0].type, 'current-user', 'First token type should be current-user');
  assertEquals(found[1].type, 'site', 'Second token type should be site');
  assertEquals(found[2].type, 'date', 'Third token type should be date');
});

// Test validate function
test('Validate function detects invalid tokens', () => {
  const text = '[invalid-type:token] and [site:name]';
  const validation = tokens.validate(text);
  assertEquals(validation.valid, false, 'Should detect invalid token');
  assertTrue(validation.errors.length > 0, 'Should have error messages');
  assertTrue(validation.errors[0].token === '[invalid-type:token]', 'Should identify the invalid token');
});

// Test getBrowserData
test('getBrowserData returns structured data', () => {
  const data = tokens.getBrowserData({});
  assertTrue(Array.isArray(data.types), 'Should return types array');
  assertTrue(data.types.length > 0, 'Should have registered types');

  const siteType = data.types.find(t => t.id === 'site');
  assertTrue(siteType !== undefined, 'Should include site type');
  assertTrue(Array.isArray(siteType.tokens), 'Type should have tokens array');
  assertTrue(siteType.tokens.length > 0, 'Site type should have tokens');
});

// Summary
console.log(`\n=== Test Results ===`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);

if (failed === 0) {
  console.log('\n✓ All tests passed! Feature #1 is ready.');
  process.exit(0);
} else {
  console.log(`\n✗ ${failed} test(s) failed.`);
  process.exit(1);
}
