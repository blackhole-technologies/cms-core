#!/usr/bin/env node
/**
 * Test script for Conditions Service (Feature #3)
 */

import * as conditions from '../../core/conditions.ts';

console.log('Testing Conditions Service...\n');

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
conditions.clearConditions();

// Re-register built-in conditions (they were cleared)
conditions.registerCondition('hasRole', (config, context) => {
  const user = context.user || context.currentUser;
  if (!user) return false;
  const roles = user.roles || [];
  return roles.includes(config.role);
});

conditions.registerCondition('hasPermission', (config, context) => {
  const user = context.user || context.currentUser;
  if (!user) return false;
  const permissions = user.permissions || [];
  return permissions.includes(config.permission);
});

conditions.registerCondition('fieldEquals', (config, context) => {
  const entity = context.entity || context.data || context;
  const resolveFieldValue = (entity, path) => {
    const parts = path.split('.');
    let current = entity;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }
    return current;
  };
  const actualValue = resolveFieldValue(entity, config.field);
  return actualValue == config.value;
});

conditions.registerCondition('fieldEmpty', (config, context) => {
  const entity = context.entity || context.data || context;
  const resolveFieldValue = (entity, path) => {
    const parts = path.split('.');
    let current = entity;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }
    return current;
  };
  const value = resolveFieldValue(entity, config.field);
  return value === null || value === undefined || value === '';
});

// Test 1: Register a condition
test('registerCondition() registers a condition', () => {
  conditions.registerCondition('testCondition', (config, context) => {
    return context.test === true;
  });

  if (!conditions.hasConditionType('testCondition')) {
    throw new Error('Condition not registered');
  }
});

// Test 2: hasRole built-in condition
test('hasRole condition checks user roles', () => {
  const context = { user: { roles: ['admin', 'editor'] } };
  const result = conditions.evaluateCondition({ type: 'hasRole', role: 'admin' }, context);

  if (!result.passes) throw new Error('Should pass for admin role');
});

// Test 3: hasRole negative case
test('hasRole condition returns false for missing role', () => {
  const context = { user: { roles: ['editor'] } };
  const result = conditions.evaluateCondition({ type: 'hasRole', role: 'admin' }, context);

  if (result.passes) throw new Error('Should fail for missing role');
});

// Test 4: hasPermission condition
test('hasPermission condition checks user permissions', () => {
  const context = { user: { permissions: ['content.edit', 'content.delete'] } };
  const result = conditions.evaluateCondition(
    { type: 'hasPermission', permission: 'content.edit' },
    context
  );

  if (!result.passes) throw new Error('Should pass for granted permission');
});

// Test 5: fieldEquals condition
test('fieldEquals condition checks field values', () => {
  const context = { entity: { status: 'published' } };
  const result = conditions.evaluateCondition(
    { type: 'fieldEquals', field: 'status', value: 'published' },
    context
  );

  if (!result.passes) throw new Error('Should pass when field equals value');
});

// Test 6: fieldEquals with nested path
test('fieldEquals condition supports nested paths', () => {
  const context = { entity: { user: { profile: { name: 'Alice' } } } };
  const result = conditions.evaluateCondition(
    { type: 'fieldEquals', field: 'user.profile.name', value: 'Alice' },
    context
  );

  if (!result.passes) throw new Error('Should pass for nested field');
});

// Test 7: fieldEmpty condition
test('fieldEmpty condition detects empty fields', () => {
  const context = { entity: { description: '' } };
  const result = conditions.evaluateCondition(
    { type: 'fieldEmpty', field: 'description' },
    context
  );

  if (!result.passes) throw new Error('Should pass for empty field');
});

// Test 8: fieldEmpty with null/undefined
test('fieldEmpty condition handles null and undefined', () => {
  const context1 = { entity: { description: null } };
  const result1 = conditions.evaluateCondition(
    { type: 'fieldEmpty', field: 'description' },
    context1
  );
  if (!result1.passes) throw new Error('Should pass for null');

  const context2 = { entity: {} };
  const result2 = conditions.evaluateCondition(
    { type: 'fieldEmpty', field: 'description' },
    context2
  );
  if (!result2.passes) throw new Error('Should pass for undefined');
});

// Test 9: AND operator - all true
test('AND operator requires all conditions to pass', () => {
  const context = { user: { roles: ['admin', 'editor'] } };
  const result = conditions.evaluateCondition(
    {
      operator: 'AND',
      conditions: [
        { type: 'hasRole', role: 'admin' },
        { type: 'hasRole', role: 'editor' },
      ],
    },
    context
  );

  if (!result.passes) throw new Error('AND should pass when all conditions true');
});

// Test 10: AND operator - one false
test('AND operator fails when any condition fails', () => {
  const context = { user: { roles: ['editor'] } };
  const result = conditions.evaluateCondition(
    {
      operator: 'AND',
      conditions: [
        { type: 'hasRole', role: 'admin' },
        { type: 'hasRole', role: 'editor' },
      ],
    },
    context
  );

  if (result.passes) throw new Error('AND should fail when one condition is false');
});

// Test 11: OR operator - at least one true
test('OR operator passes when at least one condition passes', () => {
  const context = { user: { roles: ['editor'] } };
  const result = conditions.evaluateCondition(
    {
      operator: 'OR',
      conditions: [
        { type: 'hasRole', role: 'admin' },
        { type: 'hasRole', role: 'editor' },
      ],
    },
    context
  );

  if (!result.passes) throw new Error('OR should pass when one condition is true');
});

// Test 12: OR operator - all false
test('OR operator fails when all conditions fail', () => {
  const context = { user: { roles: ['viewer'] } };
  const result = conditions.evaluateCondition(
    {
      operator: 'OR',
      conditions: [
        { type: 'hasRole', role: 'admin' },
        { type: 'hasRole', role: 'editor' },
      ],
    },
    context
  );

  if (result.passes) throw new Error('OR should fail when all conditions are false');
});

// Test 13: Negation (NOT)
test('Negation inverts condition result', () => {
  const context = { user: { roles: ['editor'] } };
  const result = conditions.evaluateCondition(
    {
      negate: true,
      condition: { type: 'hasRole', role: 'admin' },
    },
    context
  );

  if (!result.passes) throw new Error('NOT should invert false to true');
});

// Test 14: Negation of true condition
test('Negation inverts true to false', () => {
  const context = { user: { roles: ['admin'] } };
  const result = conditions.evaluateCondition(
    {
      negate: true,
      condition: { type: 'hasRole', role: 'admin' },
    },
    context
  );

  if (result.passes) throw new Error('NOT should invert true to false');
});

// Test 15: Nested logical operators
test('Nested logical operators work correctly', () => {
  const context = {
    user: { roles: ['editor'], permissions: ['content.edit'] },
    entity: { status: 'published' },
  };

  // (hasRole(editor) AND hasPermission(content.edit)) OR fieldEquals(status, draft)
  const result = conditions.evaluateCondition(
    {
      operator: 'OR',
      conditions: [
        {
          operator: 'AND',
          conditions: [
            { type: 'hasRole', role: 'editor' },
            { type: 'hasPermission', permission: 'content.edit' },
          ],
        },
        { type: 'fieldEquals', field: 'status', value: 'draft' },
      ],
    },
    context
  );

  if (!result.passes) throw new Error('Nested operators should evaluate correctly');
});

// Test 16: Debug mode produces trace
test('Debug mode produces evaluation trace', () => {
  conditions.setDebugMode(true);

  const context = { user: { roles: ['admin'] } };
  const result = conditions.evaluateCondition(
    { type: 'hasRole', role: 'admin' },
    context
  );

  conditions.setDebugMode(false);

  if (!Array.isArray(result.trace)) throw new Error('Trace should be an array');
  if (result.trace.length === 0) throw new Error('Trace should not be empty in debug mode');
});

// Test 17: List condition types
test('listConditionTypes() returns registered types', () => {
  const types = conditions.listConditionTypes();
  if (!Array.isArray(types)) throw new Error('Should return array');
  if (!types.includes('hasRole')) throw new Error('Should include hasRole');
  if (!types.includes('hasPermission')) throw new Error('Should include hasPermission');
  if (!types.includes('fieldEquals')) throw new Error('Should include fieldEquals');
  if (!types.includes('fieldEmpty')) throw new Error('Should include fieldEmpty');
});

// Test 18: hasConditionType check
test('hasConditionType() checks existence', () => {
  if (!conditions.hasConditionType('hasRole')) {
    throw new Error('Should return true for existing type');
  }
  if (conditions.hasConditionType('nonexistent')) {
    throw new Error('Should return false for nonexistent type');
  }
});

// Test 19: Error on unknown condition type
test('evaluateCondition() throws error for unknown type', () => {
  try {
    conditions.evaluateCondition({ type: 'unknownType' }, {});
    throw new Error('Should have thrown error');
  } catch (error) {
    if (!error.message.includes('Unknown condition type')) {
      throw new Error('Wrong error message');
    }
  }
});

// Test 20: Complex nested condition with negation
test('Complex condition: AND with negated OR', () => {
  const context = {
    user: { roles: ['editor'], permissions: ['content.edit'] },
    entity: { status: 'draft', featured: false },
  };

  // hasRole(editor) AND NOT(featured=true OR status=archived)
  const result = conditions.evaluateCondition(
    {
      operator: 'AND',
      conditions: [
        { type: 'hasRole', role: 'editor' },
        {
          negate: true,
          condition: {
            operator: 'OR',
            conditions: [
              { type: 'fieldEquals', field: 'featured', value: true },
              { type: 'fieldEquals', field: 'status', value: 'archived' },
            ],
          },
        },
      ],
    },
    context
  );

  if (!result.passes) throw new Error('Complex nested condition should pass');
});

// Summary
console.log('\n' + '='.repeat(50));
console.log(`Tests: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed > 0) {
  process.exit(1);
}
