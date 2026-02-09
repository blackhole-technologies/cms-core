#!/usr/bin/env node
/**
 * Test Feature #4: FormBuilder basic form building
 *
 * Verifies that FormBuilder can instantiate form classes, create FormState,
 * call buildForm(), inject hidden fields, and return the correct structure.
 */

import { FormBuilder } from './core/lib/Form/FormBuilder.js';
import { FormState } from './core/lib/Form/FormState.js';

// Mock FormBase for testing
class TestForm {
  constructor(services) {
    this._services = services;
  }

  getFormId() {
    return 'test_form';
  }

  buildForm(formState) {
    return {
      name: {
        '#type': 'textfield',
        '#title': 'Name',
        '#required': true,
      },
      email: {
        '#type': 'email',
        '#title': 'Email',
      },
      actions: {
        '#type': 'actions',
        submit: {
          '#type': 'submit',
          '#value': 'Submit',
        },
      },
    };
  }

  validateForm(form, formState) {
    // No-op for basic test
  }

  async submitForm(form, formState) {
    // No-op for basic test
  }
}

// Test runner
const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

async function runTests() {
  console.log('Testing Feature #4: FormBuilder basic form building\n');

  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`✓ ${name}`);
      passed++;
    } catch (error) {
      console.log(`✗ ${name}`);
      console.log(`  ${error.message}`);
      failed++;
    }
  }

  console.log(`\n${passed}/${tests.length} tests passed`);
  process.exit(failed > 0 ? 1 : 0);
}

// ============================================================================
// Tests
// ============================================================================

test('FormBuilder can be instantiated', () => {
  const builder = new FormBuilder();
  if (!(builder instanceof FormBuilder)) {
    throw new Error('FormBuilder not instantiated correctly');
  }
});

test('FormBuilder.setInfrastructure() sets services and hooks', () => {
  const builder = new FormBuilder();
  const mockServices = { get: () => null };
  const mockHooks = { invoke: () => null };

  builder.setInfrastructure(mockServices, mockHooks);
  // Cannot directly test Symbol properties, but no error = success
});

test('FormBuilder.getForm() returns correct structure', async () => {
  const builder = new FormBuilder();
  const mockServices = { get: () => null };
  const mockHooks = { invoke: () => null };
  builder.setInfrastructure(mockServices, mockHooks);

  const result = await builder.getForm(TestForm);

  if (!result.form) throw new Error('Missing form property');
  if (!result.formState) throw new Error('Missing formState property');
  if (!result.formInstance) throw new Error('Missing formInstance property');
});

test('getForm() instantiates form class with services', async () => {
  const builder = new FormBuilder();
  const mockServices = { get: () => null };
  const mockHooks = { invoke: () => null };
  builder.setInfrastructure(mockServices, mockHooks);

  const result = await builder.getForm(TestForm);

  if (!(result.formInstance instanceof TestForm)) {
    throw new Error('formInstance is not instance of TestForm');
  }
});

test('getForm() creates new FormState', async () => {
  const builder = new FormBuilder();
  const mockServices = { get: () => null };
  const mockHooks = { invoke: () => null };
  builder.setInfrastructure(mockServices, mockHooks);

  const result = await builder.getForm(TestForm);

  if (!(result.formState instanceof FormState)) {
    throw new Error('formState is not instance of FormState');
  }
});

test('getForm() calls buildForm() and returns render array', async () => {
  const builder = new FormBuilder();
  const mockServices = { get: () => null };
  const mockHooks = { invoke: () => null };
  builder.setInfrastructure(mockServices, mockHooks);

  const result = await builder.getForm(TestForm);

  if (!result.form.name) throw new Error('Missing name field from buildForm');
  if (!result.form.email) throw new Error('Missing email field from buildForm');
  if (!result.form.actions) throw new Error('Missing actions from buildForm');
});

test('getForm() injects #form_id hidden field', async () => {
  const builder = new FormBuilder();
  const mockServices = { get: () => null };
  const mockHooks = { invoke: () => null };
  builder.setInfrastructure(mockServices, mockHooks);

  const result = await builder.getForm(TestForm);

  if (!result.form['#form_id']) {
    throw new Error('Missing #form_id field');
  }
  if (result.form['#form_id']['#type'] !== 'hidden') {
    throw new Error('#form_id is not hidden type');
  }
  if (result.form['#form_id']['#value'] !== 'test_form') {
    throw new Error('#form_id value is not test_form');
  }
});

test('getForm() injects #form_build_id with UUID', async () => {
  const builder = new FormBuilder();
  const mockServices = { get: () => null };
  const mockHooks = { invoke: () => null };
  builder.setInfrastructure(mockServices, mockHooks);

  const result = await builder.getForm(TestForm);

  if (!result.form['#form_build_id']) {
    throw new Error('Missing #form_build_id field');
  }
  if (result.form['#form_build_id']['#type'] !== 'hidden') {
    throw new Error('#form_build_id is not hidden type');
  }
  // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (!uuidPattern.test(result.form['#form_build_id']['#value'])) {
    throw new Error('#form_build_id value is not a valid UUID');
  }
});

test('getForm() generates unique #form_build_id on each call', async () => {
  const builder = new FormBuilder();
  const mockServices = { get: () => null };
  const mockHooks = { invoke: () => null };
  builder.setInfrastructure(mockServices, mockHooks);

  const result1 = await builder.getForm(TestForm);
  const result2 = await builder.getForm(TestForm);

  if (result1.form['#form_build_id']['#value'] === result2.form['#form_build_id']['#value']) {
    throw new Error('Form build IDs are not unique');
  }
});

test('processForm() builds form and returns structure', async () => {
  const builder = new FormBuilder();
  const mockServices = { get: () => null };
  const mockHooks = { invoke: () => null };
  builder.setInfrastructure(mockServices, mockHooks);

  const result = await builder.processForm(TestForm, {});

  if (!result.form) throw new Error('Missing form property');
  if (!result.formState) throw new Error('Missing formState property');
  if (!result.formInstance) throw new Error('Missing formInstance property');
});

test('processForm() populates formState with submitted values', async () => {
  const builder = new FormBuilder();
  const mockServices = { get: () => null };
  const mockHooks = { invoke: () => null };
  builder.setInfrastructure(mockServices, mockHooks);

  const submittedValues = { name: 'John Doe', email: 'john@example.com' };
  const result = await builder.processForm(TestForm, submittedValues);

  if (result.formState.getValue('name') !== 'John Doe') {
    throw new Error('formState does not contain submitted name');
  }
  if (result.formState.getValue('email') !== 'john@example.com') {
    throw new Error('formState does not contain submitted email');
  }
});

test('processForm() marks formState as submitted', async () => {
  const builder = new FormBuilder();
  const mockServices = { get: () => null };
  const mockHooks = { invoke: () => null };
  builder.setInfrastructure(mockServices, mockHooks);

  const result = await builder.processForm(TestForm, { name: 'Test' });

  if (!result.formState.isSubmitted()) {
    throw new Error('formState not marked as submitted');
  }
});

test('processForm() calls validateForm()', async () => {
  let validateCalled = false;

  class ValidatingForm extends TestForm {
    validateForm(form, formState) {
      validateCalled = true;
    }
  }

  const builder = new FormBuilder();
  const mockServices = { get: () => null };
  const mockHooks = { invoke: () => null };
  builder.setInfrastructure(mockServices, mockHooks);

  await builder.processForm(ValidatingForm, { name: 'Test' });

  if (!validateCalled) {
    throw new Error('validateForm was not called');
  }
});

test('processForm() calls submitForm() if no errors', async () => {
  let submitCalled = false;

  class SubmittingForm extends TestForm {
    async submitForm(form, formState) {
      submitCalled = true;
    }
  }

  const builder = new FormBuilder();
  const mockServices = { get: () => null };
  const mockHooks = { invoke: () => null };
  builder.setInfrastructure(mockServices, mockHooks);

  await builder.processForm(SubmittingForm, { name: 'Test' });

  if (!submitCalled) {
    throw new Error('submitForm was not called');
  }
});

test('processForm() does NOT call submitForm() if validation errors exist', async () => {
  let submitCalled = false;

  class ErrorForm extends TestForm {
    validateForm(form, formState) {
      formState.setError('name', 'Name is required');
    }

    async submitForm(form, formState) {
      submitCalled = true;
    }
  }

  const builder = new FormBuilder();
  const mockServices = { get: () => null };
  const mockHooks = { invoke: () => null };
  builder.setInfrastructure(mockServices, mockHooks);

  await builder.processForm(ErrorForm, { name: '' });

  if (submitCalled) {
    throw new Error('submitForm should not be called when errors exist');
  }
});

test('processForm() skips validation/submit if submittedValues is empty', async () => {
  let validateCalled = false;

  class TrackingForm extends TestForm {
    validateForm(form, formState) {
      validateCalled = true;
    }
  }

  const builder = new FormBuilder();
  const mockServices = { get: () => null };
  const mockHooks = { invoke: () => null };
  builder.setInfrastructure(mockServices, mockHooks);

  await builder.processForm(TrackingForm, {});

  if (validateCalled) {
    throw new Error('validateForm should not be called for empty submission');
  }
});

// Run all tests
runTests();
