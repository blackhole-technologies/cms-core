/**
 * Test suite for block variant system
 */

import * as blocks from '../../core/blocks.ts';

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

console.log('\n=== Block Variant System Tests ===\n');

// Initialize blocks system (needed for registration)
blocks.init('.', null, { builtinTypes: false });

// Test 1: Register a block type
console.log('Test 1: Register a block type');
blocks.registerBlockType({
  id: 'test_block',
  label: 'Test Block',
  description: 'A test block for variant testing',
  category: 'testing',
  schema: {
    title: { type: 'string', required: true },
    content: { type: 'text' },
  },
  defaults: {
    title: 'Default Title',
    content: 'Default content',
  },
});

const blockType = blocks.getBlockType('test_block');
assert(blockType !== null, 'Block type is registered');
assert(blockType.id === 'test_block', 'Block type has correct ID');

// Test 2: Register a variant
console.log('\nTest 2: Register a variant');
blocks.registerBlockVariant('test_block', 'compact', {
  label: 'Compact View',
  description: 'A compact version of the block',
  schema: {
    showIcon: { type: 'boolean' },
  },
  defaults: {
    showIcon: true,
  },
});

const variant = blocks.getBlockVariant('test_block', 'compact');
assert(variant !== null, 'Variant is registered');
assert(variant.name === 'compact', 'Variant has correct name');
assert(variant.label === 'Compact View', 'Variant has correct label');

// Test 3: List variants
console.log('\nTest 3: List variants');
const variants = blocks.listBlockVariants('test_block');
assert(Array.isArray(variants), 'listBlockVariants returns array');
assert(variants.length === 1, 'One variant registered');
assert(variants[0].name === 'compact', 'Variant appears in list');

// Test 4: Get variants (object form)
console.log('\nTest 4: Get variants object');
const variantsObj = blocks.getBlockVariants('test_block');
assert(typeof variantsObj === 'object', 'getBlockVariants returns object');
assert(variantsObj.compact !== undefined, 'Compact variant exists in object');

// Test 5: Check variant existence
console.log('\nTest 5: Check variant existence');
assert(blocks.hasBlockVariant('test_block', 'compact') === true, 'hasBlockVariant returns true for existing variant');
assert(blocks.hasBlockVariant('test_block', 'nonexistent') === false, 'hasBlockVariant returns false for non-existing variant');

// Test 6: Register multiple variants
console.log('\nTest 6: Register multiple variants');
blocks.registerBlockVariant('test_block', 'highlighted', {
  label: 'Highlighted',
  description: 'A highlighted version with special styling',
  defaults: {
    backgroundColor: '#ffeb3b',
  },
});

blocks.registerBlockVariant('test_block', 'minimal', {
  label: 'Minimal',
  description: 'Minimal version with no extras',
  defaults: {
    title: 'Minimal',
  },
});

const allVariants = blocks.listBlockVariants('test_block');
assert(allVariants.length === 3, 'Three variants registered');

// Test 7: Build variant config (inheritance)
console.log('\nTest 7: Build variant config with inheritance');
const compactConfig = blocks.buildVariantConfig('test_block', 'compact');
assert(compactConfig !== null, 'Variant config is built');
assert(compactConfig.variant === 'compact', 'Config includes variant name');
assert(compactConfig.variantLabel === 'Compact View', 'Config includes variant label');

// Check schema merging
assert(compactConfig.schema.title !== undefined, 'Inherits base schema field: title');
assert(compactConfig.schema.content !== undefined, 'Inherits base schema field: content');
assert(compactConfig.schema.showIcon !== undefined, 'Includes variant schema field: showIcon');

// Check defaults merging
assert(compactConfig.defaults.title === 'Default Title', 'Inherits base default: title');
assert(compactConfig.defaults.content === 'Default content', 'Inherits base default: content');
assert(compactConfig.defaults.showIcon === true, 'Includes variant default: showIcon');

// Test 8: Variant overrides base defaults
console.log('\nTest 8: Variant overrides base defaults');
const minimalConfig = blocks.buildVariantConfig('test_block', 'minimal');
assert(minimalConfig.defaults.title === 'Minimal', 'Variant default overrides base default');
assert(minimalConfig.defaults.content === 'Default content', 'Non-overridden default is inherited');

// Test 9: Build config without variant (returns base)
console.log('\nTest 9: Build config without variant');
const baseConfig = blocks.buildVariantConfig('test_block', null);
assert(baseConfig.variant === undefined, 'No variant specified');
assert(baseConfig.defaults.title === 'Default Title', 'Uses base defaults');

// Test 10: Error handling - variant on non-existent block type
console.log('\nTest 10: Error handling - non-existent block type');
try {
  blocks.registerBlockVariant('nonexistent_block', 'test', {
    label: 'Test',
  });
  assert(false, 'Should throw error for non-existent block type');
} catch (error) {
  assert(error.message.includes('does not exist'), 'Throws error for non-existent block type');
}

// Test 11: Error handling - missing label
console.log('\nTest 11: Error handling - missing label');
try {
  blocks.registerBlockVariant('test_block', 'invalid', {
    description: 'Missing label',
  });
  assert(false, 'Should throw error for missing label');
} catch (error) {
  assert(error.message.includes('label'), 'Throws error for missing label');
}

// Test 12: Custom render function in variant
console.log('\nTest 12: Custom render function in variant');
blocks.registerBlockVariant('test_block', 'custom_render', {
  label: 'Custom Render',
  render: (block) => `<div class="custom">${block.settings?.title || 'Custom'}</div>`,
});

const customConfig = blocks.buildVariantConfig('test_block', 'custom_render');
assert(typeof customConfig.render === 'function', 'Variant has custom render function');
const rendered = customConfig.render({ settings: { title: 'Test' } });
assert(rendered.includes('custom'), 'Custom render function produces output');
assert(rendered.includes('Test'), 'Custom render uses block settings');

// Test 13: Custom template in variant
console.log('\nTest 13: Custom template in variant');
blocks.registerBlockVariant('test_block', 'custom_template', {
  label: 'Custom Template',
  template: 'blocks/test_block--compact.html',
});

const templateConfig = blocks.buildVariantConfig('test_block', 'custom_template');
assert(templateConfig.template === 'blocks/test_block--compact.html', 'Variant has custom template');

// Test 14: Variant-specific metadata
console.log('\nTest 14: Variant metadata');
blocks.registerBlockVariant('test_block', 'with_preview', {
  label: 'With Preview',
  description: 'A variant with preview image',
  preview_image: '/images/preview-compact.png',
});

const metaVariant = blocks.getBlockVariant('test_block', 'with_preview');
assert(metaVariant.description === 'A variant with preview image', 'Variant has description');
assert(metaVariant.preview_image === '/images/preview-compact.png', 'Variant has preview image');

// Test 15: Get variants for block type with no variants
console.log('\nTest 15: Block type with no variants');
blocks.registerBlockType({
  id: 'no_variants_block',
  label: 'No Variants Block',
});

const noVariants = blocks.listBlockVariants('no_variants_block');
assert(noVariants.length === 0, 'Block with no variants returns empty array');

const noVariantsObj = blocks.getBlockVariants('no_variants_block');
assert(Object.keys(noVariantsObj).length === 0, 'Block with no variants returns empty object');

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
