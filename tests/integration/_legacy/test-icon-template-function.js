/**
 * Test script for icon template function (Feature 6)
 */

import * as icons from '../../core/icons.js';
import * as iconRenderer from '../../core/icon-renderer.ts';
import * as template from '../../core/template.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const baseDir = __dirname;

// Load config
const iconConfig = JSON.parse(readFileSync(join(baseDir, 'config/icons.json'), 'utf-8'));

// Initialize icons service
icons.init(iconConfig, baseDir);

// Set icon renderer in template service
template.setIconRenderer(iconRenderer);

console.log('\n=== Icon Template Function Test (Feature 6) ===\n');

// Test 1: Basic icon() function syntax
console.log('Test 1: Basic icon() function syntax');
const test1 = template.renderString('{{icon("hero:solid/user")}}', {});
console.log('✓ Basic icon():', test1.includes('<svg') && test1.includes('icon') ? 'PASS' : 'FAIL');

// Test 2: icon() with size option
console.log('\nTest 2: icon() with size options');
const test2small = template.renderString('{{icon("hero:solid/user", {size: "small"})}}', {});
console.log('✓ Size small:', test2small.includes('width="16"') ? 'PASS' : 'FAIL');

const test2large = template.renderString('{{icon("hero:solid/user", {size: "large"})}}', {});
console.log('✓ Size large:', test2large.includes('width="32"') ? 'PASS' : 'FAIL');

// Test 3: icon() with custom class
console.log('\nTest 3: icon() with custom class');
const test3 = template.renderString('{{icon("hero:solid/user", {class: "custom-icon"})}}', {});
console.log('✓ Custom class:', test3.includes('custom-icon') ? 'PASS' : 'FAIL');

// Test 4: icon() with accessibility options
console.log('\nTest 4: icon() with accessibility options');
const test4title = template.renderString('{{icon("hero:solid/user", {title: "User Profile"})}}', {});
console.log('✓ Title:', test4title.includes('User Profile') ? 'PASS' : 'FAIL');

const test4label = template.renderString('{{icon("hero:solid/user", {aria_label: "Profile Icon"})}}', {});
console.log('✓ ARIA label:', test4label.includes('aria-label="Profile Icon"') ? 'PASS' : 'FAIL');

// Test 5: Simple variable-style syntax
console.log('\nTest 5: Simple variable-style syntax');
const test5 = template.renderString('{{icon hero:solid/user}}', {});
console.log('✓ Variable syntax:', test5.includes('<svg') ? 'PASS' : 'FAIL');

// Test 6: Invalid icon name (should handle gracefully)
console.log('\nTest 6: Error handling');
const test6 = template.renderString('{{icon("nonexistent:icon")}}', {});
console.log('✓ Invalid icon:', test6.includes('?') || test6 === '' ? 'PASS' : 'FAIL');

// Test 7: Multiple icons in one template
console.log('\nTest 7: Multiple icons in template');
const test7 = template.renderString('{{icon("hero:solid/user")}} {{icon("hero:solid/home")}}', {});
const svgCount = (test7.match(/<svg/g) || []).length;
console.log('✓ Multiple icons:', svgCount === 2 ? 'PASS' : 'FAIL');

// Test 8: Icon in complex template
console.log('\nTest 8: Icon in complex template');
const complexTemplate = `
<div class="user-profile">
  <div class="avatar">{{icon("hero:solid/user", {size: "large"})}}</div>
  <h1>{{name}}</h1>
</div>
`;
const test8 = template.renderString(complexTemplate, { name: 'John Doe' });
console.log('✓ Complex template:', test8.includes('<svg') && test8.includes('John Doe') ? 'PASS' : 'FAIL');

// Test 9: Verify all rendering options work
console.log('\nTest 9: All rendering options');
const test9 = template.renderString(
  '{{icon("hero:solid/user", {size: "large", color: "blue", class: "test-icon", title: "Test", aria_label: "Test Icon"})}}',
  {}
);
const hasSize = test9.includes('width="32"');
const hasClass = test9.includes('test-icon');
const hasTitle = test9.includes('Test');
const hasAriaLabel = test9.includes('aria-label="Test Icon"');
console.log('✓ All options:', hasSize && hasClass && hasTitle && hasAriaLabel ? 'PASS' : 'FAIL');

console.log('\n=== Feature 6 Test Complete ===\n');
console.log('All tests verify that the Twig function (template icon helper) is working correctly.');
console.log('The icon() helper integrates with:');
console.log('  - Icon renderer service (Feature 4)');
console.log('  - Icon discovery service (Feature 1)');
console.log('  - Template rendering system\n');
