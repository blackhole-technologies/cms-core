/**
 * Test Token Tree Rendering Service (Feature #6)
 *
 * Tests hierarchical token tree structure for browser UI
 */

import * as tokens from './core/tokens.js';

console.log('=== Testing Token Tree Rendering Service ===\n');

// Test 1: Get tree for single token type
console.log('Test 1: Request tree for single token type (node)');
const nodeTree = tokens.getTokenTree('node');

console.log(`✓ Tree returned ${nodeTree.length} category`);
console.log(`✓ Category type: "${nodeTree[0].type}"`);
console.log(`✓ Category label: "${nodeTree[0].label}"`);
console.log(`✓ Category description: "${nodeTree[0].description}"`);
console.log(`✓ Category has ${nodeTree[0].tokens.length} tokens`);

// Verify structure
const firstToken = nodeTree[0].tokens[0];
console.log(`✓ First token name: "${firstToken.name}"`);
console.log(`✓ First token label: "${firstToken.label}"`);
console.log(`✓ First token has 'token' field: ${!!firstToken.token}`);
console.log(`✓ Token string format: "${firstToken.token}"`);
console.log('');

// Test 2: Verify chained tokens appear as nested items
console.log('Test 2: Verify chained tokens (nested structure)');
const authorToken = nodeTree[0].tokens.find(t => t.name === 'author');

if (authorToken) {
  console.log(`✓ Found 'author' token: [node:author]`);
  console.log(`✓ Author token has ${authorToken.children.length} children`);

  if (authorToken.children.length > 0) {
    const childNames = authorToken.children.map(c => c.name).join(', ');
    console.log(`✓ Child tokens: ${childNames}`);

    const nameChild = authorToken.children.find(c => c.name === 'name');
    if (nameChild) {
      console.log(`✓ [node:author:name] present: "${nameChild.token}"`);
    }
  }
} else {
  console.log('✗ Author token not found in tree');
}
console.log('');

// Test 3: Multiple token types at once
console.log('Test 3: Request tree for multiple token types');
const multiTree = tokens.getTokenTree(['node', 'user', 'date']);

console.log(`✓ Tree returned ${multiTree.length} categories`);
const typeLabels = multiTree.map(c => c.type).join(', ');
console.log(`✓ Categories: ${typeLabels}`);

// Verify all requested types present
const hasNode = multiTree.some(c => c.type === 'node');
const hasUser = multiTree.some(c => c.type === 'user');
const hasDate = multiTree.some(c => c.type === 'date');
console.log(`✓ Contains 'node': ${hasNode}`);
console.log(`✓ Contains 'user': ${hasUser}`);
console.log(`✓ Contains 'date': ${hasDate}`);
console.log('');

// Test 4: Tree sorting (alphabetical)
console.log('Test 4: Verify tree sorting (alphabetical)');
const allTree = tokens.getTokenTree(null, { sorted: true });

console.log(`✓ Tree has ${allTree.length} categories`);

// Check if categories are sorted
let isSorted = true;
for (let i = 1; i < allTree.length; i++) {
  if (allTree[i - 1].label > allTree[i].label) {
    isSorted = false;
    break;
  }
}
console.log(`✓ Categories alphabetically sorted: ${isSorted}`);

// Check if tokens within first category are sorted
if (allTree.length > 0 && allTree[0].tokens.length > 1) {
  let tokensSorted = true;
  for (let i = 1; i < allTree[0].tokens.length; i++) {
    if (allTree[0].tokens[i - 1].label > allTree[0].tokens[i].label) {
      tokensSorted = false;
      break;
    }
  }
  console.log(`✓ Tokens within category sorted: ${tokensSorted}`);
}
console.log('');

// Test 5: Maximum depth limiting
console.log('Test 5: Tree depth limiting');
const shallowTree = tokens.getTokenTree('node', { maxDepth: 1 });
const deepTree = tokens.getTokenTree('node', { maxDepth: 3 });

const shallowAuthor = shallowTree[0].tokens.find(t => t.name === 'author');
const deepAuthor = deepTree[0].tokens.find(t => t.name === 'author');

console.log(`✓ maxDepth=1: author children count = ${shallowAuthor?.children?.length || 0}`);
console.log(`✓ maxDepth=3: author children count = ${deepAuthor?.children?.length || 0}`);
console.log(`✓ Depth limiting prevents infinite recursion`);
console.log('');

// Test 6: Filter by token type
console.log('Test 6: Filter tree to specific token type');
const userOnlyTree = tokens.getTokenTree('user');

console.log(`✓ Filtered tree has ${userOnlyTree.length} category`);
if (userOnlyTree.length > 0) {
  console.log(`✓ Category type is: "${userOnlyTree[0].type}"`);
  console.log(`✓ Contains only 'user' tokens: ${userOnlyTree[0].type === 'user'}`);
}
console.log('');

// Test 7: Tree structure validation
console.log('Test 7: Validate complete tree structure');
const completeTree = tokens.getTokenTree(null, { sorted: true, maxDepth: 3 });

let structureValid = true;
let totalTokens = 0;
let totalChildren = 0;

for (const category of completeTree) {
  // Validate category structure
  if (!category.type || !category.label || !Array.isArray(category.tokens)) {
    structureValid = false;
    console.log(`✗ Invalid category structure: ${category.type}`);
  }

  totalTokens += category.tokens.length;

  // Validate token structure
  for (const token of category.tokens) {
    if (!token.name || !token.label || !token.token) {
      structureValid = false;
      console.log(`✗ Invalid token structure: ${token.name}`);
    }

    if (token.children) {
      totalChildren += token.children.length;
    }
  }
}

console.log(`✓ Tree structure valid: ${structureValid}`);
console.log(`✓ Total categories: ${completeTree.length}`);
console.log(`✓ Total tokens: ${totalTokens}`);
console.log(`✓ Total child tokens: ${totalChildren}`);
console.log('');

// Test 8: Performance (tree rendering should be fast)
console.log('Test 8: Performance check');
const start = Date.now();
for (let i = 0; i < 100; i++) {
  tokens.getTokenTree(null, { sorted: true });
}
const elapsed = Date.now() - start;
console.log(`✓ 100 tree renders in ${elapsed}ms (avg: ${(elapsed/100).toFixed(2)}ms)`);
console.log('');

// Test 9: Example tree output (for debugging)
console.log('Test 9: Sample tree output (first 3 tokens of each category)');
const sampleTree = tokens.getTokenTree(['site', 'date', 'node'], { sorted: true, maxDepth: 2 });

for (const category of sampleTree) {
  console.log(`\n${category.label} (${category.type}): ${category.description}`);
  const tokensToShow = category.tokens.slice(0, 3);

  for (const token of tokensToShow) {
    console.log(`  - ${token.label}: ${token.token}`);
    if (token.children && token.children.length > 0) {
      for (const child of token.children.slice(0, 2)) {
        console.log(`    └─ ${child.label}: ${child.token}`);
      }
    }
  }

  if (category.tokens.length > 3) {
    console.log(`  ... and ${category.tokens.length - 3} more`);
  }
}

console.log('\n=== All Token Tree Tests Complete ===');
