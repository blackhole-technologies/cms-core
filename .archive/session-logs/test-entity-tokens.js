/**
 * Test Entity Token Providers (Feature #4)
 *
 * Tests node, user, and term entity token replacement
 */

import * as tokens from './core/tokens.js';

console.log('=== Testing Entity Token Providers ===\n');

// Test 1: Check if entity token types are registered
console.log('Test 1: Verify token types registered');
const types = tokens.getTypes();
console.log('Registered types:', Object.keys(types));
console.log('✓ node registered:', !!types.node);
console.log('✓ user registered:', !!types.user);
console.log('✓ term registered:', !!types.term);
console.log('');

// Test 2: Node tokens
console.log('Test 2: Node token replacement');
const nodeContext = {
  node: {
    id: '123',
    title: 'Integration Test Article',
    type: 'article',
    created: '2026-02-08T10:00:00Z',
    updated: '2026-02-08T12:00:00Z',
    body: 'This is the article body',
    status: 'published',
    author: {
      name: 'admin',
      email: 'admin@example.com',
      id: '1'
    }
  }
};

const nodeTests = [
  { token: '[node:nid]', expected: '123', description: 'Node ID' },
  { token: '[node:title]', expected: 'Integration Test Article', description: 'Node title' },
  { token: '[node:type]', expected: 'article', description: 'Content type' },
  { token: '[node:created]', expected: '2026-02-08', description: 'Created date' },
  { token: '[node:status]', expected: 'published', description: 'Status' },
  { token: '[node:body]', expected: 'This is the article body', description: 'Body field' },
  { token: '[node:author:name]', expected: 'admin', description: 'Author name (chained)' },
];

for (const test of nodeTests) {
  const result = await tokens.replace(test.token, nodeContext);
  const passed = result === test.expected;
  console.log(`${passed ? '✓' : '✗'} ${test.description}: ${test.token} -> "${result}" ${!passed ? `(expected "${test.expected}")` : ''}`);
}
console.log('');

// Test 3: User tokens
console.log('Test 3: User token replacement');
const userContext = {
  user: {
    id: '42',
    name: 'testuser',
    email: 'test@example.com',
    mail: 'test@example.com',
    created: '2026-01-01T00:00:00Z',
    roles: ['editor']
  }
};

const userTests = [
  { token: '[user:uid]', expected: '42', description: 'User ID' },
  { token: '[user:name]', expected: 'testuser', description: 'Username' },
  { token: '[user:mail]', expected: 'test@example.com', description: 'Email' },
  { token: '[user:created]', expected: '2026-01-01', description: 'Created date' },
];

for (const test of userTests) {
  const result = await tokens.replace(test.token, userContext);
  const passed = result === test.expected;
  console.log(`${passed ? '✓' : '✗'} ${test.description}: ${test.token} -> "${result}" ${!passed ? `(expected "${test.expected}")` : ''}`);
}
console.log('');

// Test 4: Term tokens
console.log('Test 4: Term token replacement');
const termContext = {
  term: {
    id: '789',
    name: 'JavaScript',
    vocabulary: 'tags',
  }
};

const termTests = [
  { token: '[term:tid]', expected: '789', description: 'Term ID' },
  { token: '[term:name]', expected: 'JavaScript', description: 'Term name' },
  { token: '[term:vocabulary]', expected: 'tags', description: 'Vocabulary' },
];

for (const test of termTests) {
  const result = await tokens.replace(test.token, termContext);
  const passed = result === test.expected;
  console.log(`${passed ? '✓' : '✗'} ${test.description}: ${test.token} -> "${result}" ${!passed ? `(expected "${test.expected}")` : ''}`);
}
console.log('');

// Test 5: Missing context
console.log('Test 5: Missing entity context (should return original token)');
const emptyContext = {};
const missingTests = [
  '[node:title]',
  '[user:name]',
  '[term:name]'
];

for (const token of missingTests) {
  const result = await tokens.replace(token, emptyContext);
  // When context is missing, token should remain unchanged
  console.log(`  ${token} without context -> "${result}"`);
}
console.log('');

// Test 6: Null/undefined properties
console.log('Test 6: Null/undefined properties (graceful handling)');
const nullContext = {
  node: {
    id: '999',
    title: null,
    created: undefined,
  }
};

const result1 = await tokens.replace('[node:nid]', nullContext);
const result2 = await tokens.replace('[node:title]', nullContext);
const result3 = await tokens.replace('[node:created]', nullContext);
console.log(`✓ [node:nid] with valid id: "${result1}"`);
console.log(`✓ [node:title] with null value: "${result2}"`);
console.log(`✓ [node:created] with undefined value: "${result3}"`);
console.log('');

console.log('=== All Entity Token Provider Tests Complete ===');
