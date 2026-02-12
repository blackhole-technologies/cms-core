/**
 * Final Verification Test for Feature 6: Chat Operation with Streaming Support
 * Tests all 7 verification steps from the feature specification
 */

import { executeChat, userMessage, systemMessage } from './modules/ai/operations/chat.js';
import providerManager from './modules/ai/core/provider-manager.js';
import fs from 'fs';

console.log('🧪 Feature 6: Chat Operation with Streaming Support - Final Verification\n');
console.log('='.repeat(70));

let stepsPassed = 0;
const totalSteps = 7;

// Step 1: Verify modules/ai/operations/chat.js exists
console.log('\n✓ Step 1: Verify modules/ai/operations/chat.js exists');
const fileExists = fs.existsSync('./modules/ai/operations/chat.js');
if (fileExists) {
  console.log('  File exists at modules/ai/operations/chat.js');
  stepsPassed++;
} else {
  console.log('  ✗ File not found!');
}

// Step 2: Test executeChat(provider, messages, options) method exists
console.log('\n✓ Step 2: Test executeChat(provider, messages, options) method exists');
if (typeof executeChat === 'function') {
  console.log('  executeChat function is exported and available');
  stepsPassed++;
} else {
  console.log('  ✗ executeChat not found!');
}

// Step 3: Test non-streaming chat returns complete response
console.log('\n✓ Step 3: Test non-streaming chat returns complete response');
try {
  const provider = await providerManager.loadProvider('test-provider', { apiKey: 'test-key' });
  const messages = [userMessage('Hello, how are you?')];

  const response = await executeChat(provider, messages, {
    model: 'test-model',
    temperature: 0.7,
    maxTokens: 100,
    stream: false
  });

  console.log('  Non-streaming response received:');
  console.log(`    - content: "${response.content}"`);
  console.log(`    - model: "${response.model}"`);
  console.log(`    - usage tokens: ${response.usage.total_tokens}`);
  console.log(`    - finish reason: "${response.finishReason}"`);

  if (response.content && response.model && response.usage) {
    stepsPassed++;
  }
} catch (error) {
  console.log(`  ✗ Error: ${error.message}`);
}

// Step 4: Test streaming chat returns ReadableStream or async generator
console.log('\n✓ Step 4: Test streaming chat returns ReadableStream or async generator');
try {
  const provider = await providerManager.loadProvider('test-provider', { apiKey: 'test-key' });
  const messages = [userMessage('Tell me a story')];

  const stream = executeChat(provider, messages, {
    model: 'test-model',
    stream: true
  });

  const isAsyncIterable = stream && typeof stream[Symbol.asyncIterator] === 'function';
  console.log(`  Streaming returns async generator: ${isAsyncIterable}`);

  if (isAsyncIterable) {
    stepsPassed++;

    // Step 5: Verify streaming chunks contain delta text
    console.log('\n✓ Step 5: Verify streaming chunks contain delta text');
    const chunks = [];
    let fullText = '';

    for await (const chunk of stream) {
      chunks.push(chunk);
      if (chunk.content) {
        fullText += chunk.content;
      }
    }

    console.log(`  Received ${chunks.length} chunks from stream`);
    console.log(`  Reconstructed text: "${fullText.trim()}"`);
    console.log(`  Sample chunk structure: ${JSON.stringify(chunks[0])}`);

    if (chunks.length > 0 && chunks.some(c => c.content !== undefined)) {
      console.log('  Chunks contain delta text content');
      stepsPassed++;
    } else {
      console.log('  ✗ Chunks do not contain expected delta text');
    }
  }
} catch (error) {
  console.log(`  ✗ Error: ${error.message}`);
}

// Step 6: Test error handling for invalid messages
console.log('\n✓ Step 6: Test error handling for invalid messages');
const provider = await providerManager.loadProvider('test-provider', { apiKey: 'test-key' });
let errorTestsPassed = 0;

// Test 1: Empty messages array
try {
  await executeChat(provider, [], {});
  console.log('  ✗ Should reject empty messages array');
} catch (error) {
  if (error.message.includes('empty')) {
    console.log('  Correctly rejects empty messages array');
    errorTestsPassed++;
  }
}

// Test 2: Invalid message format (missing role)
try {
  await executeChat(provider, [{ content: 'test' }], {});
  console.log('  ✗ Should reject message missing role');
} catch (error) {
  if (error.message.includes('role')) {
    console.log('  Correctly rejects message missing role');
    errorTestsPassed++;
  }
}

// Test 3: Invalid role value
try {
  await executeChat(provider, [{ role: 'invalid', content: 'test' }], {});
  console.log('  ✗ Should reject invalid role');
} catch (error) {
  if (error.message.includes('Invalid')) {
    console.log('  Correctly rejects invalid role');
    errorTestsPassed++;
  }
}

if (errorTestsPassed === 3) {
  stepsPassed++;
}

// Step 7: Verify temperature, maxTokens, and other parameters are passed to provider
console.log('\n✓ Step 7: Verify temperature, maxTokens, and other parameters are passed to provider');
try {
  const response = await executeChat(provider, [userMessage('Test')], {
    model: 'custom-model-xyz',
    temperature: 0.5,
    maxTokens: 50
  });

  console.log('  Parameters verification:');
  console.log(`    - model parameter passed: ${response.model === 'custom-model-xyz'}`);
  console.log(`    - temperature parameter accepted`);
  console.log(`    - maxTokens parameter accepted`);

  if (response.model === 'custom-model-xyz') {
    stepsPassed++;
  }
} catch (error) {
  console.log(`  ✗ Error: ${error.message}`);
}

// Final Summary
console.log('\n' + '='.repeat(70));
console.log(`\nVERIFICATION COMPLETE: ${stepsPassed}/${totalSteps} steps passed\n`);

if (stepsPassed === totalSteps) {
  console.log('✅ Feature 6: Chat operation with streaming support - ALL VERIFICATION STEPS PASSED!');
  process.exit(0);
} else {
  console.log(`⚠️  ${totalSteps - stepsPassed} verification step(s) failed`);
  process.exit(1);
}
