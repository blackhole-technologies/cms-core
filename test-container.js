// Test script for Feature 6: Container element type handler

import { Renderer } from './core/lib/Render/Renderer.js';

console.log('=== Testing Container element type handler ===\n');

const renderer = new Renderer();
await renderer.discoverElementTypes();

// Test 1: Container with two children
console.log('Test 1: Container with two children');
const containerWithChildren = {
  '#type': 'container',
  '#attributes': { class: 'my-container' },
  'child1': { '#markup': '<p>First child</p>' },
  'child2': { '#markup': '<p>Second child</p>' }
};

const html1 = await renderer.render(containerWithChildren);
console.log('Rendered HTML:');
console.log(html1);
console.log('Has <div>:', html1.includes('<div') ? '✓' : '✗');
console.log('Has class="my-container":', html1.includes('class="my-container"') ? '✓' : '✗');
console.log('Has both children:', html1.includes('First child') && html1.includes('Second child') ? '✓' : '✗');
console.log();

// Test 2: Empty container
console.log('Test 2: Empty container (no children, no markup)');
const emptyContainer = {
  '#type': 'container'
};

const html2 = await renderer.render(emptyContainer);
console.log('Rendered HTML:', JSON.stringify(html2));
console.log('Returns empty string:', html2 === '' ? '✓' : '✗');
console.log();

// Test 3: Container with #markup
console.log('Test 3: Container with #markup');
const containerWithMarkup = {
  '#type': 'container',
  '#markup': '<p>Direct markup</p>'
};

const html3 = await renderer.render(containerWithMarkup);
console.log('Rendered HTML:');
console.log(html3);
console.log('Has <div>:', html3.includes('<div') ? '✓' : '✗');
console.log('Has markup content:', html3.includes('Direct markup') ? '✓' : '✗');
console.log();

console.log('=== All tests complete ===');
