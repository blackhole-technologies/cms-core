// Test script for Feature 1: RenderArray utility class

import { RenderArray } from './core/lib/Render/RenderArray.js';

console.log('=== Testing RenderArray utility class ===\n');

// Test 1: children() method
console.log('Test 1: children() method');
const testElement = {
  a: { '#weight': 5 },
  '#type': 'container',
  b: { '#weight': -10 },
  c: {}  // no weight, should default to 0
};

const children = RenderArray.children(testElement);
console.log('Input:', JSON.stringify(testElement, null, 2));
console.log('Children (sorted by weight):', children.map(([key, child]) => `${key} (weight: ${child['#weight'] || 0})`));
console.log('Expected order: b (-10), c (0), a (5)');
console.log('Pass:', children[0][0] === 'b' && children[1][0] === 'c' && children[2][0] === 'a' ? '✓' : '✗');
console.log();

// Test 2: isRenderArray() method
console.log('Test 2: isRenderArray() method');
console.log('isRenderArray({}):', RenderArray.isRenderArray({}), '(expected: true)');
console.log('isRenderArray(null):', RenderArray.isRenderArray(null), '(expected: false)');
console.log('isRenderArray("string"):', RenderArray.isRenderArray("string"), '(expected: false)');
console.log('isRenderArray(undefined):', RenderArray.isRenderArray(undefined), '(expected: false)');
console.log('Pass:',
  RenderArray.isRenderArray({}) === true &&
  RenderArray.isRenderArray(null) === false &&
  RenderArray.isRenderArray("string") === false &&
  RenderArray.isRenderArray(undefined) === false ? '✓' : '✗'
);
console.log();

// Test 3: normalize() with #markup
console.log('Test 3: normalize() with #markup');
const markupElement = { '#markup': '<p>hi</p>' };
RenderArray.normalize(markupElement);
console.log('Input: { "#markup": "<p>hi</p>" }');
console.log('After normalize:', JSON.stringify(markupElement, null, 2));
console.log('Has #type "markup":', markupElement['#type'] === 'markup' ? '✓' : '✗');
console.log('Has #weight 0:', markupElement['#weight'] === 0 ? '✓' : '✗');
console.log('Has #access true:', markupElement['#access'] === true ? '✓' : '✗');
console.log();

// Test 4: normalize() without #markup
console.log('Test 4: normalize() without #markup');
const containerElement = { foo: 'bar' };
RenderArray.normalize(containerElement);
console.log('Input: { foo: "bar" }');
console.log('After normalize:', JSON.stringify(containerElement, null, 2));
console.log('Has #type "container":', containerElement['#type'] === 'container' ? '✓' : '✗');
console.log('Has #weight 0:', containerElement['#weight'] === 0 ? '✓' : '✗');
console.log('Has #access true:', containerElement['#access'] === true ? '✓' : '✗');
console.log();

console.log('=== All tests complete ===');
