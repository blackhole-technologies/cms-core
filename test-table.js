// Test script for Feature 7: Table element type handler

import { Renderer } from './core/lib/Render/Renderer.js';

console.log('=== Testing Table element type handler ===\n');

const renderer = new Renderer();
await renderer.discoverElementTypes();

// Test 1: Table with header and rows
console.log('Test 1: Table with header and rows');
const tableWithData = {
  '#type': 'table',
  '#header': ['Name', 'Email'],
  '#rows': [
    ['Alice', 'alice@example.com'],
    ['Bob', 'bob@example.com']
  ],
  '#attributes': { class: 'user-table' }
};

const html1 = await renderer.render(tableWithData);
console.log('Rendered HTML:');
console.log(html1);
console.log('Has <table>:', html1.includes('<table') ? '✓' : '✗');
console.log('Has class="user-table":', html1.includes('class="user-table"') ? '✓' : '✗');
console.log('Has <thead>:', html1.includes('<thead>') ? '✓' : '✗');
console.log('Has <tbody>:', html1.includes('<tbody>') ? '✓' : '✗');
console.log('Has "Name" header:', html1.includes('Name') ? '✓' : '✗');
console.log('Has "Alice" data:', html1.includes('Alice') ? '✓' : '✗');
console.log('Has "alice@example.com":', html1.includes('alice@example.com') ? '✓' : '✗');
console.log();

// Test 2: Empty table with #empty message
console.log('Test 2: Empty table with #empty message');
const emptyTable = {
  '#type': 'table',
  '#header': ['Name', 'Email'],
  '#rows': [],
  '#empty': 'No users found'
};

const html2 = await renderer.render(emptyTable);
console.log('Rendered HTML:');
console.log(html2);
console.log('Shows empty message:', html2.includes('No users found') ? '✓' : '✗');
console.log();

// Test 3: Table with render array cells
console.log('Test 3: Table with render array cells');
const tableWithRenderArrays = {
  '#type': 'table',
  '#header': ['Name', 'Status'],
  '#rows': [
    [
      'Alice',
      { '#markup': '<span class="active">Active</span>' }
    ]
  ]
};

const html3 = await renderer.render(tableWithRenderArrays);
console.log('Rendered HTML:');
console.log(html3);
console.log('Has <table>:', html3.includes('<table') ? '✓' : '✗');
console.log('Has "Alice":', html3.includes('Alice') ? '✓' : '✗');
console.log('Has render array content:', html3.includes('<span class="active">Active</span>') ? '✓' : '✗');
console.log();

console.log('=== All tests complete ===');
