/**
 * Unit Tests for Token Fallback System
 * Tests Features #1, #2, #3
 */

import {
  parseTokenWithFallbacks,
  isLiteral,
  extractLiteral,
  evaluateFallbackChain,
  replaceWithFallbacks,
  registerToken,
} from '../../core/tokens.ts';

// Color helpers for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
};

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`${colors.green}✓${colors.reset} ${message}`);
    passed++;
  } else {
    console.log(`${colors.red}✗${colors.reset} ${message}`);
    failed++;
  }
}

function assertEquals(actual, expected, message) {
  const isEqual = JSON.stringify(actual) === JSON.stringify(expected);
  if (isEqual) {
    console.log(`${colors.green}✓${colors.reset} ${message}`);
    passed++;
  } else {
    console.log(`${colors.red}✗${colors.reset} ${message}`);
    console.log(`  Expected: ${JSON.stringify(expected)}`);
    console.log(`  Actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

console.log(`\n${colors.blue}=== Token Fallback System Tests ===${colors.reset}\n`);

// ==================================================================
// FEATURE #1 TESTS: parseTokenWithFallbacks()
// ==================================================================
console.log(`${colors.yellow}Feature #1: Token OR fallback logic parsing${colors.reset}`);

// Test 1.1: Parse simple 2-option fallback
const test1 = parseTokenWithFallbacks('{field:title|field:name}');
assertEquals(test1, ['field:title', 'field:name'], 'Parse 2-option fallback');

// Test 1.2: Parse 3-option fallback with literal
const test2 = parseTokenWithFallbacks('{field:title|field:name|"Untitled"}');
assertEquals(test2, ['field:title', 'field:name', '"Untitled"'], 'Parse 3-option fallback with literal');

// Test 1.3: Parse fallback with single quotes
const test3 = parseTokenWithFallbacks("{field:title|'Default Title'}");
assertEquals(test3, ['field:title', "'Default Title'"], 'Parse fallback with single quotes');

// Test 1.4: Parse fallback with escaped quotes
const test4 = parseTokenWithFallbacks('{field:title|"Say \\"Hello\\""}');
assertEquals(test4, ['field:title', '"Say \\"Hello\\""'], 'Parse fallback with escaped quotes');

// Test 1.5: Parse fallback without braces
const test5 = parseTokenWithFallbacks('field:title|field:name|"Default"');
assertEquals(test5, ['field:title', 'field:name', '"Default"'], 'Parse fallback without braces');

// Test 1.6: Parse fallback with bracket syntax
const test6 = parseTokenWithFallbacks('[field:title|field:name]');
assertEquals(test6, ['field:title', 'field:name'], 'Parse fallback with bracket syntax');

// Test 1.7: Parse single option (no fallback)
const test7 = parseTokenWithFallbacks('{field:title}');
assertEquals(test7, ['field:title'], 'Parse single option (no fallback)');

// Test 1.8: Parse empty string
const test8 = parseTokenWithFallbacks('');
assertEquals(test8, [], 'Parse empty string returns empty array');

// Test 1.9: Parse with whitespace
const test9 = parseTokenWithFallbacks('{ field:title | field:name | "Default" }');
assertEquals(test9, ['field:title', 'field:name', '"Default"'], 'Parse with whitespace around pipes');

// Test 1.10: Parse 5+ option chain
const test10 = parseTokenWithFallbacks('{a|b|c|d|e|"final"}');
assertEquals(test10, ['a', 'b', 'c', 'd', 'e', '"final"'], 'Parse 5+ option chain');

// ==================================================================
// FEATURE #3 TESTS: isLiteral() and extractLiteral()
// ==================================================================
console.log(`\n${colors.yellow}Feature #3: Default value support - literal handling${colors.reset}`);

// Test 3.1: Detect double-quoted literal
assert(isLiteral('"Hello"'), 'Detect double-quoted literal');

// Test 3.2: Detect single-quoted literal
assert(isLiteral("'World'"), 'Detect single-quoted literal');

// Test 3.3: Reject non-quoted string
assert(!isLiteral('field:title'), 'Reject non-quoted string');

// Test 3.4: Reject mismatched quotes
assert(!isLiteral('"Hello\''), 'Reject mismatched quotes');

// Test 3.5: Extract double-quoted literal
assertEquals(extractLiteral('"Hello World"'), 'Hello World', 'Extract double-quoted literal');

// Test 3.6: Extract single-quoted literal
assertEquals(extractLiteral("'Test Value'"), 'Test Value', 'Extract single-quoted literal');

// Test 3.7: Extract with escaped quotes
assertEquals(extractLiteral('"Say \\"Hi\\""'), 'Say "Hi"', 'Extract with escaped double quotes');

// Test 3.8: Extract with escaped single quotes
assertEquals(extractLiteral("'It\\'s working'"), "It's working", 'Extract with escaped single quotes');

// Test 3.9: Extract with newline
assertEquals(extractLiteral('"Line 1\\nLine 2"'), 'Line 1\nLine 2', 'Extract with newline escape');

// Test 3.10: Extract with tab
assertEquals(extractLiteral('"Col1\\tCol2"'), 'Col1\tCol2', 'Extract with tab escape');

// Test 3.11: Extract with backslash
assertEquals(extractLiteral('"C:\\\\Users"'), 'C:\\Users', 'Extract with backslash escape');

// Test 3.12: Extract empty string literal
assertEquals(extractLiteral('""'), '', 'Extract empty string literal');

// Test 3.13: Extract whitespace-only literal
assertEquals(extractLiteral('"   "'), '   ', 'Extract whitespace-only literal');

// ==================================================================
// FEATURE #2 TESTS: evaluateFallbackChain()
// ==================================================================
console.log(`\n${colors.yellow}Feature #2: Chained token evaluation${colors.reset}`);

// Register test tokens
registerToken('field', 'title', (ctx) => ctx.entity?.title || null);
registerToken('field', 'name', (ctx) => ctx.entity?.name || null);
registerToken('field', 'slug', (ctx) => ctx.entity?.slug || null);
registerToken('field', 'empty', () => '');
registerToken('field', 'whitespace', () => '   ');
registerToken('field', 'zero', () => '0');
registerToken('field', 'false', () => false);

// Test 2.1: First option has value (stop immediately)
const test11 = await evaluateFallbackChain(
  ['[field:title]', '[field:name]', '"Default"'],
  { entity: { title: 'My Title' } }
);
assertEquals(test11, 'My Title', 'Return first non-empty value (title)');

// Test 2.2: First option empty, second has value
const test12 = await evaluateFallbackChain(
  ['[field:title]', '[field:name]', '"Default"'],
  { entity: { name: 'My Name' } }
);
assertEquals(test12, 'My Name', 'Skip empty first, return second value (name)');

// Test 2.3: Both tokens empty, use literal default
const test13 = await evaluateFallbackChain(
  ['[field:title]', '[field:name]', '"Untitled"'],
  { entity: {} }
);
assertEquals(test13, 'Untitled', 'All tokens empty, return literal default');

// Test 2.4: All options empty (including literal)
const test14 = await evaluateFallbackChain(
  ['[field:title]', '[field:name]', '""'],
  { entity: {} }
);
assertEquals(test14, '', 'All options empty including literal, return empty string');

// Test 2.5: Whitespace is considered empty
const test15 = await evaluateFallbackChain(
  ['[field:whitespace]', '"Fallback"'],
  {}
);
assertEquals(test15, 'Fallback', 'Whitespace-only value triggers fallback');

// Test 2.6: Zero is NOT empty
const test16 = await evaluateFallbackChain(
  ['[field:zero]', '"Fallback"'],
  {}
);
assertEquals(test16, '0', 'Zero is valid value (not empty)');

// Test 2.7: False is NOT empty
const test17 = await evaluateFallbackChain(
  ['[field:false]', '"Fallback"'],
  {}
);
assertEquals(test17, 'false', 'False is valid value (not empty)');

// Test 2.8: Multiple levels - skip several empty options
const test18 = await evaluateFallbackChain(
  ['[field:title]', '[field:name]', '[field:slug]', '"Final Fallback"'],
  { entity: { slug: 'my-slug' } }
);
assertEquals(test18, 'my-slug', 'Skip multiple empty options, return first non-empty');

// Test 2.9: Empty array of fallbacks
const test19 = await evaluateFallbackChain([], {});
assertEquals(test19, '', 'Empty fallback array returns empty string');

// Test 2.10: Single literal option
const test20 = await evaluateFallbackChain(['"Direct Value"'], {});
assertEquals(test20, 'Direct Value', 'Single literal option returns literal');

// Test 2.11: Token without brackets
const test21 = await evaluateFallbackChain(
  ['field:title', '"Fallback"'],
  { entity: { title: 'Works' } }
);
assertEquals(test21, 'Works', 'Handle token reference without brackets');

// ==================================================================
// INTEGRATION TESTS: replaceWithFallbacks()
// ==================================================================
console.log(`\n${colors.yellow}Integration: replaceWithFallbacks()${colors.reset}`);

// Test I.1: Replace with first option
const testI1 = await replaceWithFallbacks(
  'Title: {field:title|field:name|"Untitled"}',
  { entity: { title: 'My Article' } }
);
assertEquals(testI1, 'Title: My Article', 'Replace with first option value');

// Test I.2: Replace with fallback option
const testI2 = await replaceWithFallbacks(
  'Title: {field:title|field:name|"Untitled"}',
  { entity: { name: 'Article Name' } }
);
assertEquals(testI2, 'Title: Article Name', 'Replace with fallback option value');

// Test I.3: Replace with literal default
const testI3 = await replaceWithFallbacks(
  'Title: {field:title|field:name|"Untitled"}',
  { entity: {} }
);
assertEquals(testI3, 'Title: Untitled', 'Replace with literal default value');

// Test I.4: Multiple fallback tokens in one string
const testI4 = await replaceWithFallbacks(
  'Title: {field:title|"No Title"}, Slug: {field:slug|"no-slug"}',
  { entity: { title: 'Article' } }
);
assertEquals(testI4, 'Title: Article, Slug: no-slug', 'Replace multiple fallback tokens');

// Test I.5: Mix of fallback and standard tokens
const testI5 = await replaceWithFallbacks(
  '{field:title|"Untitled"} - [site:name]',
  { entity: {}, site: { name: 'My Site' } }
);
assertEquals(testI5, 'Untitled - My Site', 'Mix fallback and standard tokens');

// Test I.6: Fallback token appears multiple times
const testI6 = await replaceWithFallbacks(
  '{field:title|"Untitled"} and {field:title|"Untitled"} again',
  { entity: { title: 'Test' } }
);
assertEquals(testI6, 'Test and Test again', 'Same fallback token appears multiple times');

// Test I.7: Empty text
const testI7 = await replaceWithFallbacks('', {});
assertEquals(testI7, '', 'Empty text returns empty string');

// Test I.8: No tokens in text
const testI8 = await replaceWithFallbacks('Plain text with no tokens', {});
assertEquals(testI8, 'Plain text with no tokens', 'No tokens in text returns unchanged');

// Test I.9: Complex nested expressions
const testI9 = await replaceWithFallbacks(
  'URL: {field:slug|field:name|"default"}.html',
  { entity: { slug: 'my-article' } }
);
assertEquals(testI9, 'URL: my-article.html', 'Complex expression with suffix');

// Test I.10: Special characters in literal
const testI10 = await replaceWithFallbacks(
  '{field:title|"N/A - No Title"}',
  { entity: {} }
);
assertEquals(testI10, 'N/A - No Title', 'Special characters in literal default');

// ==================================================================
// SUMMARY
// ==================================================================
console.log(`\n${colors.blue}=== Test Summary ===${colors.reset}`);
console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
console.log(`${colors.red}Failed: ${failed}${colors.reset}`);
console.log(`Total: ${passed + failed}\n`);

if (failed === 0) {
  console.log(`${colors.green}✓ All tests passed!${colors.reset}\n`);
  process.exit(0);
} else {
  console.log(`${colors.red}✗ Some tests failed${colors.reset}\n`);
  process.exit(1);
}
