/**
 * Feature #25 Test: ConfigSchema validation
 *
 * Tests:
 * - Required field validation
 * - Type checking (string, number, boolean, object, array)
 * - Constraint validation (min, max, pattern, etc.)
 */

import { ConfigSchema } from './core/lib/Config/ConfigSchema.js';

console.log('Testing Feature #25: ConfigSchema validation\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.error(`   ${error.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Test schema from feature spec
const basicSchema = {
  id: { type: 'string', required: true },
  label: { type: 'string', required: true }
};

// Test 1: Missing required field
test('Missing required field returns error', () => {
  const result = ConfigSchema.validate({ id: 'test' }, basicSchema);
  assert(!result.valid, 'Should be invalid');
  assert(result.errors.length === 1, `Expected 1 error, got ${result.errors.length}`);
  assert(
    result.errors[0].includes('label') && result.errors[0].includes('required'),
    `Expected error about missing label, got: ${result.errors[0]}`
  );
});

// Test 2: Valid entity passes
test('Valid entity passes validation', () => {
  const result = ConfigSchema.validate(
    { id: 'test', label: 'Test' },
    basicSchema
  );
  assert(result.valid, `Should be valid, got errors: ${result.errors.join(', ')}`);
  assert(result.errors.length === 0, `Expected 0 errors, got ${result.errors.length}`);
});

// Test 3: Type mismatch (number instead of string)
test('Type mismatch returns error', () => {
  const result = ConfigSchema.validate(
    { id: 123, label: 'Test' },
    basicSchema
  );
  assert(!result.valid, 'Should be invalid');
  assert(
    result.errors.some(e => e.includes('id') && e.includes('type')),
    `Expected type error for id, got: ${result.errors.join(', ')}`
  );
});

// Test 4: Number constraints (min/max)
test('Number constraints (min/max)', () => {
  const schema = {
    weight: { type: 'number', min: 0, max: 100 }
  };

  // Below min
  let result = ConfigSchema.validate({ weight: -5 }, schema);
  assert(!result.valid, 'Should reject weight < 0');
  assert(
    result.errors.some(e => e.includes('>=') && e.includes('0')),
    `Expected min error, got: ${result.errors.join(', ')}`
  );

  // Above max
  result = ConfigSchema.validate({ weight: 150 }, schema);
  assert(!result.valid, 'Should reject weight > 100');
  assert(
    result.errors.some(e => e.includes('<=') && e.includes('100')),
    `Expected max error, got: ${result.errors.join(', ')}`
  );

  // Within range
  result = ConfigSchema.validate({ weight: 50 }, schema);
  assert(result.valid, `Should accept weight 50, got errors: ${result.errors.join(', ')}`);
});

// Test 5: String constraints (minLength, maxLength, pattern)
test('String length constraints', () => {
  const schema = {
    code: { type: 'string', minLength: 3, maxLength: 10 }
  };

  let result = ConfigSchema.validate({ code: 'ab' }, schema);
  assert(!result.valid, 'Should reject string too short');

  result = ConfigSchema.validate({ code: 'this-is-way-too-long' }, schema);
  assert(!result.valid, 'Should reject string too long');

  result = ConfigSchema.validate({ code: 'valid' }, schema);
  assert(result.valid, 'Should accept string within length');
});

// Test 6: String pattern constraint
test('String pattern constraint', () => {
  const schema = {
    email: { type: 'string', pattern: '^[^@]+@[^@]+\\.[^@]+$' }
  };

  let result = ConfigSchema.validate({ email: 'invalid' }, schema);
  assert(!result.valid, 'Should reject invalid email');

  result = ConfigSchema.validate({ email: 'user@example.com' }, schema);
  assert(result.valid, 'Should accept valid email');
});

// Test 7: Array type detection
test('Array type detection', () => {
  const schema = {
    items: { type: 'array' }
  };

  let result = ConfigSchema.validate({ items: 'not-array' }, schema);
  assert(!result.valid, 'Should reject non-array');

  result = ConfigSchema.validate({ items: [] }, schema);
  assert(result.valid, 'Should accept empty array');

  result = ConfigSchema.validate({ items: [1, 2, 3] }, schema);
  assert(result.valid, 'Should accept array with items');
});

// Test 8: Array item constraints
test('Array item count constraints', () => {
  const schema = {
    tags: { type: 'array', minItems: 1, maxItems: 5 }
  };

  let result = ConfigSchema.validate({ tags: [] }, schema);
  assert(!result.valid, 'Should reject array with too few items');

  result = ConfigSchema.validate({ tags: [1, 2, 3, 4, 5, 6] }, schema);
  assert(!result.valid, 'Should reject array with too many items');

  result = ConfigSchema.validate({ tags: ['a', 'b', 'c'] }, schema);
  assert(result.valid, 'Should accept array within bounds');
});

// Test 9: Object type
test('Object type detection', () => {
  const schema = {
    config: { type: 'object' }
  };

  let result = ConfigSchema.validate({ config: 'not-object' }, schema);
  assert(!result.valid, 'Should reject non-object');

  result = ConfigSchema.validate({ config: {} }, schema);
  assert(result.valid, 'Should accept empty object');

  result = ConfigSchema.validate({ config: { key: 'value' } }, schema);
  assert(result.valid, 'Should accept object with properties');
});

// Test 10: Boolean type
test('Boolean type detection', () => {
  const schema = {
    enabled: { type: 'boolean' }
  };

  let result = ConfigSchema.validate({ enabled: 'true' }, schema);
  assert(!result.valid, 'Should reject string "true" for boolean');

  result = ConfigSchema.validate({ enabled: 1 }, schema);
  assert(!result.valid, 'Should reject number 1 for boolean');

  result = ConfigSchema.validate({ enabled: true }, schema);
  assert(result.valid, 'Should accept boolean true');

  result = ConfigSchema.validate({ enabled: false }, schema);
  assert(result.valid, 'Should accept boolean false');
});

// Test 11: Enum constraint
test('Enum constraint', () => {
  const schema = {
    status: { type: 'string', enum: ['draft', 'published', 'archived'] }
  };

  let result = ConfigSchema.validate({ status: 'invalid' }, schema);
  assert(!result.valid, 'Should reject value not in enum');

  result = ConfigSchema.validate({ status: 'published' }, schema);
  assert(result.valid, 'Should accept value in enum');
});

// Test 12: Optional fields
test('Optional fields can be omitted', () => {
  const schema = {
    id: { type: 'string', required: true },
    description: { type: 'string' } // optional
  };

  const result = ConfigSchema.validate({ id: 'test' }, schema);
  assert(result.valid, 'Should accept entity missing optional field');
});

// Test 13: Multiple errors
test('Multiple errors reported', () => {
  const schema = {
    id: { type: 'string', required: true },
    label: { type: 'string', required: true },
    weight: { type: 'number', required: true }
  };

  const result = ConfigSchema.validate({ id: 'test' }, schema);
  assert(!result.valid, 'Should be invalid');
  assert(result.errors.length === 2, `Expected 2 errors, got ${result.errors.length}`);
});

// Test 14: Null vs undefined handling
test('Null and undefined treated as missing', () => {
  const schema = {
    id: { type: 'string', required: true }
  };

  let result = ConfigSchema.validate({ id: null }, schema);
  assert(!result.valid, 'Should reject null for required field');

  result = ConfigSchema.validate({ id: undefined }, schema);
  assert(!result.valid, 'Should reject undefined for required field');
});

// Test 15: Complex schema from feature spec
test('Complex schema validation', () => {
  const schema = {
    id: { type: 'string', required: true, pattern: '^[a-z_]+$' },
    label: { type: 'string', required: true, minLength: 1, maxLength: 255 },
    weight: { type: 'number', min: -100, max: 100 },
    status: { type: 'boolean' },
    dependencies: { type: 'object' },
    tags: { type: 'array', maxItems: 10 }
  };

  const validEntity = {
    id: 'my_config',
    label: 'My Config',
    weight: 10,
    status: true,
    dependencies: { module: ['core'] },
    tags: ['tag1', 'tag2']
  };

  const result = ConfigSchema.validate(validEntity, schema);
  assert(result.valid, `Should be valid, got errors: ${result.errors.join(', ')}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
