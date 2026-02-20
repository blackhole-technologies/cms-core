#!/usr/bin/env node
/**
 * Test script for Typed Data Service (Feature #2)
 */

import * as typedData from './core/typed-data.js';

console.log('Testing Typed Data Service...\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${error.message}`);
    failed++;
  }
}

// Clean state before tests
typedData.clearSchemas();

// Test 1: Define a schema
test('defineSchema() registers a schema', () => {
  typedData.defineSchema('user', {
    type: 'object',
    properties: {
      name: { type: 'string', required: true },
      age: { type: 'number' },
    },
  });

  const schema = typedData.getSchema('user');
  if (!schema) throw new Error('Schema not registered');
  if (schema.type !== 'object') throw new Error('Type mismatch');
});

// Test 2: Get schema
test('getSchema() retrieves registered schema', () => {
  const schema = typedData.getSchema('user');
  if (!schema) throw new Error('Schema not found');
  if (!schema.properties.name) throw new Error('Properties not stored');
});

// Test 3: Validate valid data
test('validate() accepts valid data', () => {
  const result = typedData.validate({ name: 'Alice', age: 30 }, 'user');
  if (!result.valid) throw new Error(`Validation failed: ${result.errors.join(', ')}`);
  if (result.errors.length > 0) throw new Error('Unexpected errors');
});

// Test 4: Validate missing required field
test('validate() rejects missing required field', () => {
  const result = typedData.validate({ age: 30 }, 'user');
  if (result.valid) throw new Error('Should have failed validation');
  if (!result.errors.some(e => e.includes('required'))) {
    throw new Error('Should mention required field');
  }
});

// Test 5: Type coercion - string to number
test('validate() coerces string to number', () => {
  const result = typedData.validate({ name: 'Bob', age: '25' }, 'user');
  if (!result.valid) throw new Error(`Validation failed: ${result.errors.join(', ')}`);
  if (typeof result.coerced.age !== 'number') throw new Error('Age not coerced to number');
  if (result.coerced.age !== 25) throw new Error('Coercion value incorrect');
});

// Test 6: Nested schema validation
test('validate() validates nested objects', () => {
  typedData.defineSchema('profile', {
    type: 'object',
    properties: {
      user: {
        type: 'object',
        properties: {
          name: { type: 'string', required: true },
          email: { type: 'string', pattern: /^.+@.+$/ },
        },
      },
    },
  });

  const result = typedData.validate(
    { user: { name: 'Alice', email: 'alice@example.com' } },
    'profile'
  );

  if (!result.valid) throw new Error(`Validation failed: ${result.errors.join(', ')}`);
});

// Test 7: Nested schema - missing required nested field
test('validate() catches missing nested required field', () => {
  const result = typedData.validate({ user: { email: 'alice@example.com' } }, 'profile');
  if (result.valid) throw new Error('Should have failed for missing nested field');
  if (!result.errors.some(e => e.includes('name'))) {
    throw new Error('Should mention missing name field');
  }
});

// Test 8: Array validation
test('validate() validates arrays', () => {
  typedData.defineSchema('tags', {
    type: 'array',
    items: { type: 'string' },
    min: 1,
    max: 5,
  });

  const result = typedData.validate(['tag1', 'tag2', 'tag3'], 'tags');
  if (!result.valid) throw new Error(`Validation failed: ${result.errors.join(', ')}`);
});

// Test 9: Array validation - min/max length
test('validate() enforces array min/max length', () => {
  const result = typedData.validate([], 'tags');
  if (result.valid) throw new Error('Should have failed for empty array (min: 1)');
  if (!result.errors.some(e => e.includes('Minimum length'))) {
    throw new Error('Should mention minimum length');
  }
});

// Test 10: resolveValue with nested path
test('resolveValue() accesses nested properties', () => {
  const data = { user: { profile: { name: 'Bob' } } };
  const value = typedData.resolveValue(data, 'user.profile.name');
  if (value !== 'Bob') throw new Error(`Expected 'Bob', got ${value}`);
});

// Test 11: resolveValue with array index
test('resolveValue() handles array indices', () => {
  const data = { users: [{ name: 'Alice' }, { name: 'Bob' }] };
  const value = typedData.resolveValue(data, 'users[1].name');
  if (value !== 'Bob') throw new Error(`Expected 'Bob', got ${value}`);
});

// Test 12: resolveValue with missing path
test('resolveValue() returns undefined for missing path', () => {
  const data = { user: { name: 'Alice' } };
  const value = typedData.resolveValue(data, 'user.email');
  if (value !== undefined) throw new Error('Expected undefined');
});

// Test 13: String validation with min/max length
test('validate() enforces string min/max length', () => {
  typedData.defineSchema('username', {
    type: 'string',
    min: 3,
    max: 20,
  });

  const tooShort = typedData.validate('ab', 'username');
  if (tooShort.valid) throw new Error('Should have failed for too short');

  const tooLong = typedData.validate('a'.repeat(21), 'username');
  if (tooLong.valid) throw new Error('Should have failed for too long');

  const valid = typedData.validate('alice', 'username');
  if (!valid.valid) throw new Error('Should have passed for valid length');
});

// Test 14: Number validation with min/max
test('validate() enforces number min/max', () => {
  typedData.defineSchema('age', {
    type: 'number',
    min: 0,
    max: 150,
  });

  const tooLow = typedData.validate(-1, 'age');
  if (tooLow.valid) throw new Error('Should have failed for negative');

  const tooHigh = typedData.validate(200, 'age');
  if (tooHigh.valid) throw new Error('Should have failed for too high');

  const valid = typedData.validate(30, 'age');
  if (!valid.valid) throw new Error('Should have passed for valid range');
});

// Test 15: Pattern validation
test('validate() enforces pattern matching', () => {
  typedData.defineSchema('email', {
    type: 'string',
    pattern: /^[^@]+@[^@]+\.[^@]+$/,
  });

  const invalid = typedData.validate('notanemail', 'email');
  if (invalid.valid) throw new Error('Should have failed for invalid email');

  const valid = typedData.validate('alice@example.com', 'email');
  if (!valid.valid) throw new Error('Should have passed for valid email');
});

// Test 16: Custom validator
test('validate() runs custom validators', () => {
  typedData.defineSchema('even_number', {
    type: 'number',
    validator: (value) => {
      return value % 2 === 0 ? true : 'Must be an even number';
    },
  });

  const invalid = typedData.validate(3, 'even_number');
  if (invalid.valid) throw new Error('Should have failed for odd number');
  if (!invalid.errors.some(e => e.includes('even'))) {
    throw new Error('Should mention even number requirement');
  }

  const valid = typedData.validate(4, 'even_number');
  if (!valid.valid) throw new Error('Should have passed for even number');
});

// Test 17: Default values
test('validate() applies default values', () => {
  typedData.defineSchema('config', {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: true },
      count: { type: 'number', default: 10 },
    },
  });

  const result = typedData.validate({}, 'config');
  if (!result.valid) throw new Error('Should have passed with defaults');
  if (result.coerced.enabled !== true) throw new Error('Default not applied');
  if (result.coerced.count !== 10) throw new Error('Default not applied');
});

// Test 18: Boolean coercion
test('validate() coerces strings to boolean', () => {
  typedData.defineSchema('flag', { type: 'boolean' });

  const trueStrings = ['true', 'True', 'TRUE', '1', 'yes'];
  for (const str of trueStrings) {
    const result = typedData.validate(str, 'flag');
    if (!result.valid || result.coerced !== true) {
      throw new Error(`Failed to coerce "${str}" to true`);
    }
  }

  const falseStrings = ['false', 'False', 'FALSE', '0', 'no'];
  for (const str of falseStrings) {
    const result = typedData.validate(str, 'flag');
    if (!result.valid || result.coerced !== false) {
      throw new Error(`Failed to coerce "${str}" to false`);
    }
  }
});

// Test 19: Date validation and coercion
test('validate() validates and coerces dates', () => {
  typedData.defineSchema('timestamp', { type: 'date' });

  // Valid date string
  const result1 = typedData.validate('2025-01-01', 'timestamp');
  if (!result1.valid) throw new Error('Should have passed for valid date string');
  if (!(result1.coerced instanceof Date)) throw new Error('Should coerce to Date');

  // Invalid date string
  const result2 = typedData.validate('not a date', 'timestamp');
  if (result2.valid) throw new Error('Should have failed for invalid date');
});

// Test 20: Enum validation
test('validate() enforces enum values', () => {
  typedData.defineSchema('status', {
    type: 'string',
    enum: ['pending', 'active', 'completed'],
  });

  const invalid = typedData.validate('unknown', 'status');
  if (invalid.valid) throw new Error('Should have failed for value not in enum');

  const valid = typedData.validate('active', 'status');
  if (!valid.valid) throw new Error('Should have passed for enum value');
});

// Summary
console.log('\n' + '='.repeat(50));
console.log(`Tests: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed > 0) {
  process.exit(1);
}
