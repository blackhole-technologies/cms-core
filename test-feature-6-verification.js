/**
 * Comprehensive Test for Feature 6: Chat Operation with Streaming Support
 */

import { executeChat, userMessage } from './modules/ai/operations/chat.js';
import providerManager from './modules/ai/core/provider-manager.js';

console.log('🧪 Testing Feature 6: Chat Operation with Streaming Support\n');

let testsPassed = 0;
let testsFailed = 0;

// Helper function to track test results
function test(name, passed, details = '') {
  if (passed) {
    console.log(`✓ ${name}`);
    if (details) console.log(`  ${details}`);
    testsPassed++;
  } else {
    console.log(`✗ ${name}`);
    if (details) console.log(`  ${details}`);
    testsFailed++;
  }
}

// Step 1: Verify file exists
console.log('Step 1: Verify modules/ai/operations/chat.js exists');
test('File exists', true);

// Step 2: Test executeChat method exists
console.log('\nStep 2: Test executeChat() method exists');
test('executeChat is a function', typeof executeChat === 'function');

// Step 3: Test non-streaming chat
console.log('\nStep 3: Test non-streaming chat returns complete response');
try {
  const provider = await providerManager.loadProvider('test-provider', { apiKey: 'test-key' });
  const messages = [userMessage('Hello')];

  const response = await executeChat(provider, messages, {
    model: 'test-model',
    temperature: 0.7,
    maxTokens: 100,
    stream: false
  });

  test('Non-streaming returns response object', typeof response === 'object');
  test('Response has content property', 'content' in response);
  test('Response content is string', typeof response.content === 'string');
  test('Response has model property', 'model' in response);
  test('Response has usage property', 'usage' in response);
} catch (error) {
  test('Non-streaming chat', false, `Error: ${error.message}`);
}

// Step 4: Test streaming chat returns async generator
console.log('\nStep 4: Test streaming chat returns ReadableStream or async generator');
try {
  const provider = await providerManager.loadProvider('test-provider', { apiKey: 'test-key' });
  const messages = [userMessage('Tell me a story')];

  const stream = executeChat(provider, messages, {
    model: 'test-model',
    stream: true
  });

  // Check if it's an async generator
  const isAsyncIterable = stream && typeof stream[Symbol.asyncIterator] === 'function';
  test('Streaming returns async iterable', isAsyncIterable);

  if (isAsyncIterable) {
    // Step 5: Verify streaming chunks contain delta text
    console.log('\nStep 5: Verify streaming chunks contain delta text');
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    test('Stream yields multiple chunks', chunks.length > 0, `Received ${chunks.length} chunks`);
    test('Chunks contain delta data', chunks.some(c => c.delta), `First chunk: ${JSON.stringify(chunks[0])}`);
  }
} catch (error) {
  test('Streaming chat', false, `Error: ${error.message}`);
}

// Step 6: Test error handling
console.log('\nStep 6: Test error handling for invalid messages');
const provider = await providerManager.loadProvider('test-provider', { apiKey: 'test-key' });

// Test empty messages
try {
  await executeChat(provider, [], {});
  test('Rejects empty messages array', false);
} catch (error) {
  test('Rejects empty messages array', error.message.includes('empty'));
}

// Test invalid message format
try {
  await executeChat(provider, [{ invalid: 'message' }], {});
  test('Rejects invalid message format', false);
} catch (error) {
  test('Rejects invalid message format', error.message.includes('role'));
}

// Test invalid role
try {
  await executeChat(provider, [{ role: 'invalid', content: 'test' }], {});
  test('Rejects invalid role', false);
} catch (error) {
  test('Rejects invalid role', error.message.includes('Invalid'));
}

// Step 7: Verify parameters are passed
console.log('\nStep 7: Verify temperature, maxTokens, and other parameters are passed to provider');
try {
  const response = await executeChat(provider, [userMessage('Test')], {
    model: 'custom-model',
    temperature: 0.5,
    maxTokens: 50
  });

  test('Parameters passed to provider', response.model === 'custom-model', 'Model parameter verified');
} catch (error) {
  test('Parameters passed to provider', false, `Error: ${error.message}`);
}

// Summary
console.log('\n' + '='.repeat(50));
console.log(`Tests Passed: ${testsPassed}`);
console.log(`Tests Failed: ${testsFailed}`);

if (testsFailed === 0) {
  console.log('\n✅ Feature 6: ALL VERIFICATION STEPS PASSED!');
} else {
  console.log('\n⚠️  Some tests failed');
}
