/**
 * CVA Functionality Test
 * Tests all three features: CVA function, schema validation, compound variants
 */

import { applyCva, parseCvaHelper } from '../../core/lib/Twig/CvaExtension.js';
import { validateCvaConfig, assertValidCvaConfig } from '../../core/lib/Twig/CvaSchema.js';

console.log('='.repeat(60));
console.log('CVA Feature Test Suite');
console.log('='.repeat(60));

// Test counters
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✓ ${message}`);
    passed++;
  } else {
    console.log(`✗ ${message}`);
    failed++;
  }
}

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    console.log(`✓ ${message}`);
    console.log(`  Result: "${actual}"`);
    passed++;
  } else {
    console.log(`✗ ${message}`);
    console.log(`  Expected: "${expected}"`);
    console.log(`  Actual: "${actual}"`);
    failed++;
  }
}

// =============================================================================
// FEATURE #1: CVA Function Implementation
// =============================================================================
console.log('\n' + '='.repeat(60));
console.log('Feature #1: CVA Function (html_cva) Implementation');
console.log('='.repeat(60));

const buttonConfig = {
  base: 'btn rounded transition',
  variants: {
    size: {
      sm: 'text-sm px-2 py-1',
      md: 'text-base px-4 py-2',
      lg: 'text-lg px-6 py-3'
    },
    intent: {
      primary: 'bg-blue-500 text-white hover:bg-blue-600',
      secondary: 'bg-gray-500 text-white hover:bg-gray-600',
      danger: 'bg-red-500 text-white hover:bg-red-600'
    }
  },
  defaultVariants: {
    size: 'md',
    intent: 'primary'
  }
};

// Test 1.1: Base classes always applied
const result1 = applyCva('button', buttonConfig, { size: 'sm', intent: 'primary' });
assert(result1.includes('btn'), 'Test 1.1: Base class "btn" is applied');
assert(result1.includes('rounded'), 'Test 1.2: Base class "rounded" is applied');
assert(result1.includes('transition'), 'Test 1.3: Base class "transition" is applied');

// Test 1.2: Variant classes applied based on props
assert(result1.includes('text-sm'), 'Test 1.4: Variant size=sm applies "text-sm"');
assert(result1.includes('bg-blue-500'), 'Test 1.5: Variant intent=primary applies "bg-blue-500"');

// Test 1.3: Default variants used when props not provided
const result2 = applyCva('button', buttonConfig, {});
assert(result2.includes('text-base'), 'Test 1.6: Default size=md applies "text-base"');
assert(result2.includes('bg-blue-500'), 'Test 1.7: Default intent=primary applies "bg-blue-500"');

// Test 1.4: Props override defaults
const result3 = applyCva('button', buttonConfig, { size: 'lg' });
assert(result3.includes('text-lg'), 'Test 1.8: size=lg overrides default md');
assert(result3.includes('bg-blue-500'), 'Test 1.9: intent uses default when not specified');

// =============================================================================
// FEATURE #2: Variant Definition Schema
// =============================================================================
console.log('\n' + '='.repeat(60));
console.log('Feature #2: Variant Definition Schema');
console.log('='.repeat(60));

// Test 2.1: Valid config passes validation
const validConfig = {
  base: 'btn',
  variants: {
    size: { sm: 'btn-sm', lg: 'btn-lg' }
  },
  defaultVariants: { size: 'sm' }
};

const validation1 = validateCvaConfig(validConfig);
assert(validation1.valid === true, 'Test 2.1: Valid config passes validation');
assert(validation1.errors.length === 0, 'Test 2.2: Valid config has no errors');

// Test 2.2: Missing base fails validation
const invalidConfig1 = {
  variants: { size: { sm: 'btn-sm' } }
};

const validation2 = validateCvaConfig(invalidConfig1);
assert(validation2.valid === false, 'Test 2.3: Config without base fails validation');
assert(validation2.errors.length > 0, 'Test 2.4: Missing base produces error message');

// Test 2.3: Invalid default variant fails
const invalidConfig2 = {
  base: 'btn',
  variants: { size: { sm: 'btn-sm' } },
  defaultVariants: { size: 'invalid' }
};

const validation3 = validateCvaConfig(invalidConfig2);
assert(validation3.valid === false, 'Test 2.5: Invalid default variant fails validation');

// Test 2.4: assertValidCvaConfig throws on invalid
let threwError = false;
try {
  assertValidCvaConfig(invalidConfig1);
} catch (e) {
  threwError = true;
}
assert(threwError, 'Test 2.6: assertValidCvaConfig throws on invalid config');

// =============================================================================
// FEATURE #3: Compound Variant Support
// =============================================================================
console.log('\n' + '='.repeat(60));
console.log('Feature #3: Compound Variant Support');
console.log('='.repeat(60));

const compoundConfig = {
  base: 'btn',
  variants: {
    size: {
      sm: 'text-sm px-2',
      md: 'text-base px-4',
      lg: 'text-lg px-6'
    },
    intent: {
      primary: 'bg-blue-500',
      secondary: 'bg-gray-500'
    }
  },
  defaultVariants: {
    size: 'md',
    intent: 'primary'
  },
  compoundVariants: [
    {
      size: 'sm',
      intent: 'primary',
      class: 'font-bold shadow-md'
    },
    {
      size: 'lg',
      intent: 'secondary',
      class: 'border-2'
    }
  ]
};

// Test 3.1: Compound variant applied when conditions match
const result4 = applyCva('button', compoundConfig, { size: 'sm', intent: 'primary' });
assert(result4.includes('font-bold'), 'Test 3.1: Compound classes applied when size=sm AND intent=primary');
assert(result4.includes('shadow-md'), 'Test 3.2: Multiple compound classes applied together');

// Test 3.2: Compound variant NOT applied when conditions don't match
const result5 = applyCva('button', compoundConfig, { size: 'sm', intent: 'secondary' });
assert(!result5.includes('font-bold'), 'Test 3.3: Compound not applied when intent doesn\'t match');

// Test 3.3: Multiple compound variants can apply
const result6 = applyCva('button', compoundConfig, { size: 'lg', intent: 'secondary' });
assert(result6.includes('border-2'), 'Test 3.4: Different compound variant applies with different conditions');

// Test 3.4: Compound validates in schema
const compoundValidation = validateCvaConfig(compoundConfig);
assert(compoundValidation.valid === true, 'Test 3.5: Config with compound variants passes validation');

// =============================================================================
// FEATURE #4: CSS Class Merging and Deduplication
// =============================================================================
console.log('\n' + '='.repeat(60));
console.log('Feature #4: CSS Class Merging and Deduplication');
console.log('='.repeat(60));

const dedupConfig = {
  base: 'btn btn-primary',  // Intentional duplicate
  variants: {
    size: { sm: 'btn text-sm' }  // 'btn' appears in base too
  }
};

const result7 = applyCva('button', dedupConfig, { size: 'sm' });
const classes = result7.split(' ');
const btnCount = classes.filter(c => c === 'btn').length;
assert(btnCount === 1, 'Test 4.1: Duplicate "btn" class is deduplicated');

// =============================================================================
// INTEGRATION TEST: Full Example
// =============================================================================
console.log('\n' + '='.repeat(60));
console.log('Integration Test: Complete Button Example');
console.log('='.repeat(60));

const fullResult = applyCva('button', compoundConfig, { size: 'sm', intent: 'primary' });
const expectedClasses = ['btn', 'text-sm', 'px-2', 'bg-blue-500', 'font-bold', 'shadow-md'];
let allPresent = true;
for (const cls of expectedClasses) {
  if (!fullResult.includes(cls)) {
    console.log(`  Missing: ${cls}`);
    allPresent = false;
  }
}
assert(allPresent, 'Test 5.1: All expected classes present in output');

// =============================================================================
// RESULTS
// =============================================================================
console.log('\n' + '='.repeat(60));
console.log('Test Results');
console.log('='.repeat(60));
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${passed + failed}`);
console.log(`Success Rate: ${Math.round((passed / (passed + failed)) * 100)}%`);
console.log('='.repeat(60));

if (failed === 0) {
  console.log('\n✅ ALL TESTS PASSED - CVA FEATURES VERIFIED\n');
  process.exit(0);
} else {
  console.log(`\n❌ ${failed} TEST(S) FAILED\n`);
  process.exit(1);
}
