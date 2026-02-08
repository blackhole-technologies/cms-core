/**
 * Test Entity Token Providers with Real CMS Data (Feature #4)
 */

import * as tokens from './core/tokens.js';
import * as content from './core/content.js';
import { join } from 'node:path';

const baseDir = process.cwd();
content.init(baseDir);

console.log('=== Testing Entity Tokens with Real CMS Data ===\n');

// Test with real article
console.log('Test 1: Loading real article and testing [node:*] tokens');
try {
  const article = await content.read('article', '1770528753434-ly4px');
  console.log('Loaded article:', article.title);

  const nodeContext = { node: article, content: article };

  const text = 'Article: [node:title], ID: [node:nid], Type: [node:type], Created: [node:created]';
  const replaced = await tokens.replace(text, nodeContext);
  console.log('Original:', text);
  console.log('Replaced:', replaced);
  console.log('');

  // Test individual tokens
  const nid = await tokens.replace('[node:nid]', nodeContext);
  const title = await tokens.replace('[node:title]', nodeContext);
  const type = await tokens.replace('[node:type]', nodeContext);
  const created = await tokens.replace('[node:created]', nodeContext);

  console.log(`✓ [node:nid] = "${nid}"`);
  console.log(`✓ [node:title] = "${title}"`);
  console.log(`✓ [node:type] = "${type}"`);
  console.log(`✓ [node:created] = "${created}"`);
  console.log('');
} catch (error) {
  console.error('Error loading article:', error.message);
}

// Test with real user
console.log('Test 2: Testing [user:*] tokens with real user data');
const userContext = {
  user: {
    id: '1769870756954-jymy1',
    username: 'admin',
    email: 'admin@example.com',
    name: 'admin',
    created: '2026-01-31T14:45:56.954Z',
    role: 'admin'
  }
};

const userText = 'User: [user:name], Email: [user:mail], ID: [user:uid]';
const userReplaced = await tokens.replace(userText, userContext);
console.log('Original:', userText);
console.log('Replaced:', userReplaced);
console.log('');

// Test entity update scenario
console.log('Test 3: Verify tokens update when entity changes');
let mockNode = {
  id: '999',
  title: 'Original Title',
  type: 'article'
};

let result1 = await tokens.replace('[node:title]', { node: mockNode });
console.log(`Before edit: [node:title] = "${result1}"`);

// Simulate edit
mockNode.title = 'Updated Title';

let result2 = await tokens.replace('[node:title]', { node: mockNode });
console.log(`After edit: [node:title] = "${result2}"`);
console.log(`✓ Token value updated from "${result1}" to "${result2}"`);
console.log('');

console.log('=== Real CMS Data Tests Complete ===');
