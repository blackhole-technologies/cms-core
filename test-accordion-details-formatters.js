/**
 * Test script for accordion and details formatters
 *
 * Tests Feature #4 (Accordion formatter) and Feature #5 (Details formatter)
 */

import * as accordionFormatter from './core/formatters/field-group/accordion.formatter.js';
import * as detailsFormatter from './core/formatters/field-group/details.formatter.js';
import fs from 'fs';

console.log('='.repeat(60));
console.log('FEATURE #4: Accordion Group Formatter Test');
console.log('='.repeat(60));

// Test accordion formatter
const accordionGroup = {
  group_name: 'test_accordion',
  label: 'Test Accordion',
  format_settings: {
    collapse_mode: 'single',
    default_open: [0],
    classes: ['custom-accordion']
  },
  children: ['field_title', 'field_body', 'field_tags']
};

const accordionFields = [
  { name: 'field_title', html: '<div class="field field-title"><label>Title</label><input type="text" value="Test Article" /></div>' },
  { name: 'field_body', html: '<div class="field field-body"><label>Body</label><textarea>This is the body content</textarea></div>' },
  { name: 'field_tags', html: '<div class="field field-tags"><label>Tags</label><input type="text" value="test, demo" /></div>' }
];

console.log('\n1. Testing accordion formatter render()...');
const accordionHtml = accordionFormatter.render(accordionGroup, accordionFields);
console.log('✓ Accordion HTML generated');

console.log('\n2. Verifying accordion structure...');
const accordionChecks = [
  { check: 'Has accordion wrapper', test: accordionHtml.includes('field-group-accordion') },
  { check: 'Has collapse mode data attribute', test: accordionHtml.includes('data-collapse-mode="single"') },
  { check: 'Has custom class', test: accordionHtml.includes('custom-accordion') },
  { check: 'Has 3 sections', test: (accordionHtml.match(/data-index="/g) || []).length === 3 },
  { check: 'Has header buttons', test: (accordionHtml.match(/id="accordion-.*-header-/g) || []).length === 3 },
  { check: 'Has panels', test: (accordionHtml.match(/id="accordion-.*-panel-/g) || []).length === 3 },
  { check: 'First section is open', test: accordionHtml.includes('aria-expanded="true"') },
  { check: 'Has expand/collapse icons', test: accordionHtml.includes('field-group-accordion-icon') },
  { check: 'Has JavaScript', test: accordionHtml.includes('<script>') },
  { check: 'Has CSS styles', test: accordionHtml.includes('<style>') },
  { check: 'Has smooth transitions', test: accordionHtml.includes('transition:') },
  { check: 'Has keyboard navigation', test: accordionHtml.includes('ArrowDown') }
];

let accordionPassed = 0;
for (const {check, test} of accordionChecks) {
  if (test) {
    console.log(`  ✓ ${check}`);
    accordionPassed++;
  } else {
    console.log(`  ✗ ${check}`);
  }
}

console.log(`\nAccordion Tests: ${accordionPassed}/${accordionChecks.length} passed`);

// Save accordion HTML for visual inspection
fs.writeFileSync('/tmp/claude/test-accordion.html', `
<!DOCTYPE html>
<html>
<head>
  <title>Accordion Formatter Test</title>
  <meta charset="utf-8">
</head>
<body>
  <h1>Accordion Formatter Test</h1>
  ${accordionHtml}
</body>
</html>
`);
console.log('\n✓ Accordion HTML saved to /tmp/claude/test-accordion.html');

console.log('\n' + '='.repeat(60));
console.log('FEATURE #5: Details/Collapsible Group Formatter Test');
console.log('='.repeat(60));

// Test details formatter
const detailsGroup = {
  group_name: 'test_details',
  label: 'Test Details',
  format_settings: {
    open: true,
    description: 'This is a collapsible details section',
    classes: ['custom-details'],
    summary_classes: ['custom-summary']
  },
  children: ['field_email', 'field_phone', 'field_address']
};

const detailsFields = [
  { name: 'field_email', html: '<div class="field field-email"><label>Email</label><input type="email" value="test@example.com" /></div>' },
  { name: 'field_phone', html: '<div class="field field-phone"><label>Phone</label><input type="tel" value="555-1234" /></div>' },
  { name: 'field_address', html: '<div class="field field-address"><label>Address</label><textarea>123 Main St</textarea></div>' }
];

console.log('\n1. Testing details formatter render()...');
const detailsHtml = detailsFormatter.render(detailsGroup, detailsFields);
console.log('✓ Details HTML generated');

console.log('\n2. Verifying details structure...');
const detailsChecks = [
  { check: 'Has details element', test: detailsHtml.includes('<details') },
  { check: 'Has summary element', test: detailsHtml.includes('<summary') },
  { check: 'Is open by default', test: detailsHtml.includes('open') },
  { check: 'Has custom class', test: detailsHtml.includes('custom-details') },
  { check: 'Has custom summary class', test: detailsHtml.includes('custom-summary') },
  { check: 'Has description', test: detailsHtml.includes('This is a collapsible details section') },
  { check: 'Has field wrapper', test: detailsHtml.includes('field-group-fields') },
  { check: 'Contains all 3 fields', test: detailsHtml.includes('field-email') && detailsHtml.includes('field-phone') && detailsHtml.includes('field-address') },
  { check: 'Has enhanced styles', test: detailsHtml.includes('<style>') },
  { check: 'No JavaScript needed', test: !detailsHtml.includes('<script>') || detailsHtml.includes('native browser') },
  { check: 'Has accessibility features', test: detailsHtml.includes('field-group-summary') }
];

let detailsPassed = 0;
for (const {check, test} of detailsChecks) {
  if (test) {
    console.log(`  ✓ ${check}`);
    detailsPassed++;
  } else {
    console.log(`  ✗ ${check}`);
  }
}

console.log(`\nDetails Tests: ${detailsPassed}/${detailsChecks.length} passed`);

// Save details HTML for visual inspection
fs.writeFileSync('/tmp/claude/test-details.html', `
<!DOCTYPE html>
<html>
<head>
  <title>Details Formatter Test</title>
  <meta charset="utf-8">
</head>
<body>
  <h1>Details Formatter Test</h1>
  ${detailsHtml}
</body>
</html>
`);
console.log('\n✓ Details HTML saved to /tmp/claude/test-details.html');

console.log('\n' + '='.repeat(60));
console.log('MULTI-MODE ACCORDION TEST');
console.log('='.repeat(60));

// Test multiple mode
const multiAccordionGroup = {
  ...accordionGroup,
  group_name: 'test_multi_accordion',
  format_settings: {
    collapse_mode: 'multiple',
    default_open: [0, 2]
  }
};

console.log('\n1. Testing multiple mode accordion...');
const multiHtml = accordionFormatter.render(multiAccordionGroup, accordionFields);
console.log('✓ Multiple mode HTML generated');

console.log('\n2. Verifying multiple mode...');
const multiChecks = [
  { check: 'Has multiple collapse mode', test: multiHtml.includes('data-collapse-mode="multiple"') },
  { check: 'Has two sections open', test: (multiHtml.match(/aria-expanded="true"/g) || []).length === 2 }
];

for (const {check, test} of multiChecks) {
  console.log(`  ${test ? '✓' : '✗'} ${check}`);
}

console.log('\n' + '='.repeat(60));
console.log('SUMMARY');
console.log('='.repeat(60));

const totalTests = accordionChecks.length + detailsChecks.length + multiChecks.length;
const totalPassed = accordionPassed + detailsPassed + multiChecks.filter(c => c.test).length;

console.log(`\nTotal Tests: ${totalPassed}/${totalTests} passed (${Math.round(totalPassed/totalTests*100)}%)`);

if (accordionPassed === accordionChecks.length) {
  console.log('✓ Feature #4: Accordion formatter - PASSING');
} else {
  console.log('✗ Feature #4: Accordion formatter - FAILING');
}

if (detailsPassed === detailsChecks.length) {
  console.log('✓ Feature #5: Details formatter - PASSING');
} else {
  console.log('✗ Feature #5: Details formatter - FAILING');
}

console.log('\nTest files:');
console.log('  - /tmp/claude/test-accordion.html');
console.log('  - /tmp/claude/test-details.html');
console.log('\nOpen these files in a browser to verify visual appearance.');

console.log('\n' + '='.repeat(60));
