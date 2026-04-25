/**
 * Test suite for entity-view-builder.js
 */

import * as entityViewBuilder from '../../src/core/entities/entity-view-builder.ts';

// Mock services and container for registration
const mockServices = {
  register: (name, factory) => {},
};

const mockContainer = {
  register: (name, factory, options) => {},
};

// Initialize the service (this sets up default display modes)
entityViewBuilder.register(mockServices, mockContainer);

// Test counter
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`✓ ${message}`);
  } else {
    failed++;
    console.error(`✗ ${message}`);
  }
}

function assertEquals(actual, expected, message) {
  if (actual === expected) {
    passed++;
    console.log(`✓ ${message}`);
  } else {
    failed++;
    console.error(`✗ ${message}`);
    console.error(`  Expected: ${JSON.stringify(expected)}`);
    console.error(`  Actual: ${JSON.stringify(actual)}`);
  }
}

console.log('\n=== Entity View Builder Tests ===\n');

// Test 1: Register and get formatter
console.log('Test 1: Register and get formatter');
entityViewBuilder.registerFormatter('test_formatter', (value) => `formatted:${value}`);
const formatter = entityViewBuilder.getFormatter('test_formatter');
assert(typeof formatter === 'function', 'Formatter is a function');
assert(formatter('hello') === 'formatted:hello', 'Formatter works correctly');

// Test 2: List formatters includes built-ins
console.log('\nTest 2: List formatters');
const formatters = entityViewBuilder.listFormatters();
assert(formatters.includes('plain'), 'Includes plain formatter');
assert(formatters.includes('html'), 'Includes html formatter');
assert(formatters.includes('truncate'), 'Includes truncate formatter');
assert(formatters.includes('date'), 'Includes date formatter');
assert(formatters.includes('link'), 'Includes link formatter');
assert(formatters.includes('test_formatter'), 'Includes custom formatter');

// Test 3: Plain formatter
console.log('\nTest 3: Plain formatter');
const plainResult = entityViewBuilder.formatField('Hello World', 'plain');
assertEquals(plainResult, 'Hello World', 'Plain formatter returns value as-is');

// Test 4: Truncate formatter
console.log('\nTest 4: Truncate formatter');
const longText = 'This is a very long text that should be truncated';
const truncated = entityViewBuilder.formatField(longText, 'truncate', { maxLength: 20 });
assert(truncated.length <= 20, 'Truncated text is within maxLength');
assert(truncated.endsWith('...'), 'Truncated text ends with suffix');

// Test 5: Date formatter
console.log('\nTest 5: Date formatter');
const testDate = new Date('2024-01-15T12:00:00Z');
const dateFormatted = entityViewBuilder.formatField(testDate, 'date', { format: 'short' });
assert(dateFormatted.length > 0, 'Date formatter returns non-empty string');
assert(!dateFormatted.includes('Invalid'), 'Date formatter returns valid date string');

// Test 6: Link formatter
console.log('\nTest 6: Link formatter');
const linkHtml = entityViewBuilder.formatField('http://example.com', 'link', { text: 'Example' });
assert(linkHtml.includes('<a href='), 'Link formatter returns anchor tag');
assert(linkHtml.includes('Example'), 'Link formatter includes text');

// Test 7: Define and get display mode
console.log('\nTest 7: Define and get display mode');
entityViewBuilder.defineDisplayMode('content', 'article', 'test_mode', {
  fields: {
    title: { visible: true, weight: 0, formatter: 'plain' },
    body: { visible: true, weight: 10, formatter: 'truncate', settings: { maxLength: 100 } },
  },
});
const displayMode = entityViewBuilder.getDisplayMode('content', 'article', 'test_mode');
assert(displayMode !== null, 'Display mode is defined');
assert(displayMode.fields.title !== undefined, 'Display mode has title field');
assert(displayMode.fields.body !== undefined, 'Display mode has body field');

// Test 8: Build view with display mode
console.log('\nTest 8: Build view with display mode');
const testEntity = {
  entityType: 'content',
  bundle: 'article',
  type: 'article',
  id: 'test-1',
  label: 'Test Article',
  fields: {
    title: 'My Test Title',
    body: 'This is the body content that should be truncated when using the test_mode display mode.',
    author: 'admin',
  },
};

const view = entityViewBuilder.buildView(testEntity, 'test_mode');
assert(view !== null, 'View is built');
assert(view.displayMode === 'test_mode', 'View uses correct display mode');
assert(view.fields.length === 2, 'View has 2 visible fields (title and body)');
assert(view.fields[0].name === 'title', 'First field is title (weight 0)');
assert(view.fields[1].name === 'body', 'Second field is body (weight 10)');

// Test 9: Build view without display mode (default)
console.log('\nTest 9: Build view without display mode');
const defaultView = entityViewBuilder.buildView(testEntity, 'nonexistent_mode');
assert(defaultView !== null, 'Default view is built');
assert(defaultView.fields.length > 0, 'Default view has fields');

// Test 10: Render view to HTML
console.log('\nTest 10: Render view to HTML');
const html = entityViewBuilder.renderView(view);
assert(typeof html === 'string', 'Render returns string');
assert(html.includes('<div class="entity'), 'HTML contains entity wrapper');
assert(html.includes('entity--content'), 'HTML includes entity type class');
assert(html.includes('entity--article'), 'HTML includes bundle class');
assert(html.includes('entity--test_mode'), 'HTML includes display mode class');
assert(html.includes('Test Article'), 'HTML includes entity label');
assert(html.includes('field--title'), 'HTML includes title field');
assert(html.includes('field--body'), 'HTML includes body field');

// Test 11: Field visibility (hide field)
console.log('\nTest 11: Field visibility');
entityViewBuilder.defineDisplayMode('content', 'article', 'minimal', {
  fields: {
    title: { visible: true, weight: 0, formatter: 'plain' },
    body: { visible: false },
    author: { visible: false },
  },
});
const minimalView = entityViewBuilder.buildView(testEntity, 'minimal');
assert(minimalView.fields.length === 1, 'Hidden fields are excluded');
assert(minimalView.fields[0].name === 'title', 'Only visible field is included');

// Test 12: Field ordering by weight
console.log('\nTest 12: Field ordering');
entityViewBuilder.defineDisplayMode('content', 'article', 'weighted', {
  fields: {
    author: { visible: true, weight: 5, formatter: 'plain' },
    title: { visible: true, weight: 10, formatter: 'plain' },
    body: { visible: true, weight: 0, formatter: 'plain' },
  },
});
const weightedView = entityViewBuilder.buildView(testEntity, 'weighted');
assertEquals(weightedView.fields[0].name, 'body', 'First field has lowest weight (0)');
assertEquals(weightedView.fields[1].name, 'author', 'Second field has middle weight (5)');
assertEquals(weightedView.fields[2].name, 'title', 'Third field has highest weight (10)');

// Test 13: Built-in display modes
console.log('\nTest 13: Built-in display modes');
const fullMode = entityViewBuilder.getDisplayMode('content', 'default', 'full');
assert(fullMode !== null, 'Full display mode exists');

const teaserMode = entityViewBuilder.getDisplayMode('content', 'default', 'teaser');
assert(teaserMode !== null, 'Teaser display mode exists');

const compactMode = entityViewBuilder.getDisplayMode('content', 'default', 'compact');
assert(compactMode !== null, 'Compact display mode exists');

const searchMode = entityViewBuilder.getDisplayMode('content', 'default', 'search_result');
assert(searchMode !== null, 'Search result display mode exists');

// Test 14: Teaser mode truncates body
console.log('\nTest 14: Teaser mode truncation');
const testEntityLongBody = {
  ...testEntity,
  bundle: 'default',
  fields: {
    title: 'My Test Title',
    body: 'A'.repeat(500), // Very long body
    created: new Date(),
  },
};
const teaserView = entityViewBuilder.buildView(testEntityLongBody, 'teaser');
const bodyField = teaserView.fields.find((f) => f.name === 'body');
assert(bodyField !== undefined, 'Body field exists in teaser');
assert(bodyField.formatted.length < 300, 'Body is truncated in teaser mode');

// Test 15: Register and run preprocessor
console.log('\nTest 15: Preprocessor hooks');
let preprocessorRan = false;
entityViewBuilder.registerPreprocessor('content', (view, entity, displayMode) => {
  preprocessorRan = true;
  view.preprocessed = true;
});
const preprocessedView = entityViewBuilder.buildView(testEntity, 'test_mode');
assert(preprocessorRan, 'Preprocessor was executed');
assert(preprocessedView.preprocessed === true, 'Preprocessor modified view');

// Summary
console.log('\n=== Test Summary ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);

if (failed > 0) {
  console.log('\n❌ Some tests failed');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
  process.exit(0);
}
