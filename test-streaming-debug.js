/**
 * Debug streaming functionality
 */

import { executeChat, userMessage } from './modules/ai/operations/chat.js';
import providerManager from './modules/ai/core/provider-manager.js';

console.log('🔍 Debugging streaming functionality\n');

const provider = await providerManager.loadProvider('test-provider', { apiKey: 'test-key' });
const messages = [userMessage('Test')];

console.log('Testing streaming...');
const result = executeChat(provider, messages, { stream: true });

console.log('Result type:', typeof result);
console.log('Result constructor:', result.constructor.name);
console.log('Is Promise:', result instanceof Promise);
console.log('Has then:', typeof result.then);
console.log('Has Symbol.asyncIterator:', typeof result[Symbol.asyncIterator]);
console.log('Has Symbol.iterator:', typeof result[Symbol.iterator]);

// If it's a promise, await it
if (result instanceof Promise) {
  console.log('\nAwaiting promise...');
  const awaited = await result;
  console.log('Awaited type:', typeof awaited);
  console.log('Awaited constructor:', awaited.constructor.name);
  console.log('Awaited has Symbol.asyncIterator:', typeof awaited[Symbol.asyncIterator]);

  if (typeof awaited[Symbol.asyncIterator] === 'function') {
    console.log('\n✓ Awaited result is async iterable!');
    console.log('Consuming stream...');
    for await (const chunk of awaited) {
      console.log('Chunk:', chunk);
    }
  }
} else if (typeof result[Symbol.asyncIterator] === 'function') {
  console.log('\n✓ Direct result is async iterable!');
  console.log('Consuming stream...');
  for await (const chunk of result) {
    console.log('Chunk:', chunk);
  }
}
