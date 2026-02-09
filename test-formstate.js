/**
 * Test suite for FormState (Features #1, #2, #3)
 */

import { FormState } from './core/lib/Form/FormState.js';

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
  const matches = JSON.stringify(actual) === JSON.stringify(expected);
  if (matches) {
    passed++;
    console.log(`✓ ${message}`);
  } else {
    failed++;
    console.error(`✗ ${message}`);
    console.error(`  Expected: ${JSON.stringify(expected)}`);
    console.error(`  Actual: ${JSON.stringify(actual)}`);
  }
}

console.log('='.repeat(60));
console.log('Feature #1: FormState value storage and retrieval');
console.log('='.repeat(60));

// Test 1.1: Constructor with initial values
const formState1 = new FormState({ name: 'test' });
assertEquals(formState1.getValue('name'), 'test', 'Constructor accepts initial values');

// Test 1.2: setValue and getValue
const formState2 = new FormState();
formState2.setValue('email', 'a@b.com');
assertEquals(formState2.getValue('email'), 'a@b.com', 'setValue stores value and getValue retrieves it');

// Test 1.3: Method chaining
const formState3 = new FormState();
const returnValue = formState3.setValue('foo', 'bar');
assert(returnValue === formState3, 'setValue returns this for chaining');

// Test 1.4: getValues returns plain object
const formState4 = new FormState({ name: 'Alice', email: 'alice@example.com' });
const values = formState4.getValues();
assertEquals(values, { name: 'Alice', email: 'alice@example.com' }, 'getValues returns plain object');

// Test 1.5: setValues merges values
const formState5 = new FormState({ name: 'Bob' });
formState5.setValues({ email: 'bob@example.com', phone: '555-1234' });
assertEquals(formState5.getValues(), { name: 'Bob', email: 'bob@example.com', phone: '555-1234' }, 'setValues merges values');

// Test 1.6: getValue returns undefined for missing values
const formState6 = new FormState();
assertEquals(formState6.getValue('missing'), undefined, 'getValue returns undefined for missing values');

console.log('');
console.log('='.repeat(60));
console.log('Feature #2: Error handling and submission state');
console.log('='.repeat(60));

// Test 2.1: setError and hasErrors
const formState7 = new FormState();
formState7.setError('email', 'Invalid');
assert(formState7.hasErrors(), 'setError causes hasErrors to return true');

// Test 2.2: getError retrieves specific error
assertEquals(formState7.getError('email'), 'Invalid', 'getError retrieves specific error message');

// Test 2.3: clearErrors
formState7.clearErrors();
assert(!formState7.hasErrors(), 'clearErrors removes all errors');

// Test 2.4: setErrorByName alias
const formState8 = new FormState();
formState8.setErrorByName('name', 'Required');
assertEquals(formState8.getError('name'), 'Required', 'setErrorByName is alias for setError');

// Test 2.5: getErrors returns plain object
const formState9 = new FormState();
formState9.setError('name', 'Required').setError('email', 'Invalid');
assertEquals(formState9.getErrors(), { name: 'Required', email: 'Invalid' }, 'getErrors returns all errors as plain object');

// Test 2.6: getError returns null for missing error
assertEquals(formState9.getError('phone'), null, 'getError returns null for missing error');

// Test 2.7: Error method chaining
const returnValue2 = formState9.setError('test', 'message');
assert(returnValue2 === formState9, 'setError returns this for chaining');

// Test 2.8: Submission state
const formState10 = new FormState();
assert(!formState10.isSubmitted(), 'isSubmitted defaults to false');
formState10.setSubmitted(true);
assert(formState10.isSubmitted(), 'setSubmitted sets submitted state');

// Test 2.9: Rebuild state
const formState11 = new FormState();
assert(!formState11.isRebuilding(), 'isRebuilding defaults to false');
formState11.setRebuild(true);
assert(formState11.isRebuilding(), 'setRebuild sets rebuild state');

// Test 2.10: State method chaining
const returnValue3 = formState11.setSubmitted(false);
assert(returnValue3 === formState11, 'setSubmitted returns this for chaining');
const returnValue4 = formState11.setRebuild(false);
assert(returnValue4 === formState11, 'setRebuild returns this for chaining');

console.log('');
console.log('='.repeat(60));
console.log('Feature #3: Redirect, entity, and storage handling');
console.log('='.repeat(60));

// Test 3.1: setRedirect and getRedirect
const formState12 = new FormState();
formState12.setRedirect('/node/1');
assertEquals(formState12.getRedirect(), '/node/1', 'setRedirect stores URL and getRedirect retrieves it');

// Test 3.2: Redirect method chaining
const returnValue5 = formState12.setRedirect('/node/2');
assert(returnValue5 === formState12, 'setRedirect returns this for chaining');

// Test 3.3: getRedirect defaults to null
const formState13 = new FormState();
assertEquals(formState13.getRedirect(), null, 'getRedirect defaults to null');

// Test 3.4: setEntity and getEntity
const mockEntity = { id: 1, title: 'Test Node' };
const formState14 = new FormState();
formState14.setEntity(mockEntity);
assert(formState14.getEntity() === mockEntity, 'setEntity stores entity and getEntity retrieves it');

// Test 3.5: Entity method chaining
const returnValue6 = formState14.setEntity(null);
assert(returnValue6 === formState14, 'setEntity returns this for chaining');

// Test 3.6: getEntity defaults to null
const formState15 = new FormState();
assertEquals(formState15.getEntity(), null, 'getEntity defaults to null');

// Test 3.7: setStorage and getStorage
const formState16 = new FormState();
formState16.setStorage('step', 2);
assertEquals(formState16.getStorage('step'), 2, 'setStorage stores value and getStorage retrieves it');

// Test 3.8: Storage method chaining
const returnValue7 = formState16.setStorage('page', 3);
assert(returnValue7 === formState16, 'setStorage returns this for chaining');

// Test 3.9: getStorage defaults to null
assertEquals(formState16.getStorage('missing'), null, 'getStorage returns null for missing keys');

// Test 3.10: setTemporaryValue and getTemporaryValue
const formState17 = new FormState();
formState17.setTemporaryValue('temp', 'x');
assertEquals(formState17.getTemporaryValue('temp'), 'x', 'setTemporaryValue stores value and getTemporaryValue retrieves it');

// Test 3.11: Temporary method chaining
const returnValue8 = formState17.setTemporaryValue('temp2', 'y');
assert(returnValue8 === formState17, 'setTemporaryValue returns this for chaining');

// Test 3.12: getTemporaryValue defaults to null
assertEquals(formState17.getTemporaryValue('missing'), null, 'getTemporaryValue returns null for missing keys');

// Test 3.13: Storage types can hold complex values
const formState18 = new FormState();
formState18.setStorage('complex', { nested: { data: [1, 2, 3] } });
const retrieved = formState18.getStorage('complex');
assertEquals(retrieved, { nested: { data: [1, 2, 3] } }, 'Storage can hold complex objects');

console.log('');
console.log('='.repeat(60));
console.log('Integration Tests');
console.log('='.repeat(60));

// Test I1: Full workflow simulation
const formState19 = new FormState({ name: 'Initial' });
formState19
  .setValue('email', 'user@example.com')
  .setValue('phone', '555-0000')
  .setSubmitted(true);

// Simulate validation
if (!formState19.getValue('email').includes('@')) {
  formState19.setError('email', 'Invalid email');
}

assert(!formState19.hasErrors(), 'Validation passed for valid email');

// Simulate submission
const mockEntity2 = { id: null };
formState19.setEntity(mockEntity2);
formState19.setRedirect('/node/new');

assert(formState19.isSubmitted(), 'Form is marked as submitted');
assertEquals(formState19.getRedirect(), '/node/new', 'Redirect URL is set');
assert(formState19.getEntity() === mockEntity2, 'Entity is attached to form state');

// Test I2: Multi-step form simulation
const formState20 = new FormState();
formState20.setStorage('current_step', 1);
formState20.setStorage('total_steps', 3);
formState20.setValue('step1_data', 'value');

// Advance to step 2
formState20.setStorage('current_step', 2);
formState20.setRebuild(true); // Rebuild instead of redirect

assert(formState20.isRebuilding(), 'Form is set to rebuild');
assertEquals(formState20.getStorage('current_step'), 2, 'Step counter advanced');
assertEquals(formState20.getValue('step1_data'), 'value', 'Previous step data persists');

// Test I3: Error handling workflow
const formState21 = new FormState();
formState21.setValues({ username: '', password: '123' });
formState21.setSubmitted(true);

// Validation
if (!formState21.getValue('username')) {
  formState21.setError('username', 'Username is required');
}
if (formState21.getValue('password').length < 8) {
  formState21.setError('password', 'Password must be at least 8 characters');
}

assert(formState21.hasErrors(), 'Multiple validation errors detected');
assertEquals(Object.keys(formState21.getErrors()).length, 2, 'Two errors recorded');

// Clear and re-validate with fixed values
formState21.clearErrors();
formState21.setValues({ username: 'john', password: 'secure123' });

if (!formState21.getValue('username')) {
  formState21.setError('username', 'Username is required');
}
if (formState21.getValue('password').length < 8) {
  formState21.setError('password', 'Password must be at least 8 characters');
}

assert(!formState21.hasErrors(), 'Validation passes after fixing errors');

console.log('');
console.log('='.repeat(60));
console.log('Results');
console.log('='.repeat(60));
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);

if (failed === 0) {
  console.log('\n✅ All tests passed!');
  process.exit(0);
} else {
  console.log(`\n❌ ${failed} test(s) failed`);
  process.exit(1);
}
