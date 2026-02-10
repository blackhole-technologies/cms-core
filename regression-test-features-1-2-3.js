#!/usr/bin/env node
/**
 * Regression Test for Features 1, 2, 3
 * Quick verification script for testing agent
 */

import {
  parseTokenWithFallbacks,
  isLiteral,
  extractLiteral,
  evaluateFallbackChain,
  replaceWithFallbacks,
  registerToken,
} from './core/tokens.js';

console.log('\n=== REGRESSION TEST: Features 1, 2, 3 ===\n');

let allPassed = true;

// Feature 1: Token OR Fallback Logic Service
console.log('Feature 1: Token OR Fallback Logic Service');
const parsed = parseTokenWithFallbacks('{field:title|field:name|"Untitled"}');
if (JSON.stringify(parsed) === JSON.stringify(['field:title', 'field:name', '"Untitled"'])) {
  console.log('✓ parseTokenWithFallbacks works correctly');
} else {
  console.log('✗ parseTokenWithFallbacks FAILED');
  allPassed = false;
}

// Feature 3: Default Value Support
console.log('\nFeature 3: Default Value Support');
if (isLiteral('"Hello"') === true && isLiteral('field:title') === false) {
  console.log('✓ isLiteral works correctly');
} else {
  console.log('✗ isLiteral FAILED');
  allPassed = false;
}

if (extractLiteral('"Hello World"') === 'Hello World') {
  console.log('✓ extractLiteral works correctly');
} else {
  console.log('✗ extractLiteral FAILED');
  allPassed = false;
}

// Feature 2: Chained Token Evaluation
console.log('\nFeature 2: Chained Token Evaluation');
registerToken('field', 'title', (ctx) => ctx.entity?.title || null);
registerToken('field', 'name', (ctx) => ctx.entity?.name || null);

const result1 = await evaluateFallbackChain(
  ['[field:title]', '[field:name]', '"Default"'],
  { entity: { title: 'My Title' } }
);

if (result1 === 'My Title') {
  console.log('✓ evaluateFallbackChain: first option works');
} else {
  console.log('✗ evaluateFallbackChain FAILED (first option)');
  allPassed = false;
}

const result2 = await evaluateFallbackChain(
  ['[field:title]', '[field:name]', '"Default"'],
  { entity: { name: 'My Name' } }
);

if (result2 === 'My Name') {
  console.log('✓ evaluateFallbackChain: fallback to second works');
} else {
  console.log('✗ evaluateFallbackChain FAILED (fallback)');
  allPassed = false;
}

const result3 = await evaluateFallbackChain(
  ['[field:title]', '[field:name]', '"Untitled"'],
  { entity: {} }
);

if (result3 === 'Untitled') {
  console.log('✓ evaluateFallbackChain: literal default works');
} else {
  console.log('✗ evaluateFallbackChain FAILED (literal default)');
  allPassed = false;
}

// Integration test
const result4 = await replaceWithFallbacks(
  'Title: {field:title|field:name|"Untitled"}',
  { entity: { title: 'Test Article' } }
);

if (result4 === 'Title: Test Article') {
  console.log('✓ replaceWithFallbacks integration works');
} else {
  console.log('✗ replaceWithFallbacks FAILED');
  allPassed = false;
}

console.log('\n=== RESULT ===');
if (allPassed) {
  console.log('✓ ALL FEATURES PASSING - No regression detected\n');
  process.exit(0);
} else {
  console.log('✗ REGRESSION DETECTED\n');
  process.exit(1);
}
