#!/usr/bin/env node
/**
 * Test Feature #6: FormBuilder form processing with validation and submission
 *
 * Verifies that processForm() correctly handles the full form lifecycle:
 * build → populate → validate → submit (if valid)
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
    // No-op by default - subclasses override
  }

  async submitForm(form, formState) {
    // No-op by default - subclasses override
  }
}

// Form with validation
class ValidatingForm extends TestForm {
  validateForm(form, formState) {
    const name = formState.getValue('name');
    if (!name || name.trim() === '') {
      formState.setError('name', 'Name is required');
    }

    const email = formState.getValue('email');
    if (email && !email.includes('@')) {
      formState.setError('email', 'Email must contain @');
    }
  }
}

// Form with submission
class SubmittingForm extends TestForm {
  constructor(services) {
    super(services);
    this.submitted = false;
    this.submittedValues = null;
  }

  async submitForm(form, formState) {
    this.submitted = true;
    this.submittedValues = formState.getValues();
    formState.setRedirect('/success');
  }
}

// Form with both validation and submission
class CompleteForm extends TestForm {
  constructor(services) {
    super(services);
    this.validated = false;
    this.submitted = false;
  }

  validateForm(form, formState) {
    this.validated = true;
    const email = formState.getValue('email');
    if (!email || !email.includes('@')) {
      formState.setError('email', 'Valid email required');
    }
  }

  async submitForm(form, formState) {
    this.submitted = true;
    formState.setRedirect('/done');
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
  console.log('Testing Feature #6: FormBuilder form processing\n');

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

test('processForm() calls getForm() to build form', async () => {
  const builder = new FormBuilder();
  const mockServices = { get: () => null };
  const mockHooks = { alter: async (name, data) => data };
  builder.setInfrastructure(mockServices, mockHooks);

  const result = await builder.processForm(TestForm, { name: 'Test' });

  if (!result.form) {
    throw new Error('processForm did not build form');
  }
  if (!result.formState) {
    throw new Error('processForm did not create formState');
  }
  if (!result.formInstance) {
    throw new Error('processForm did not create formInstance');
  }
});

test('processForm() populates formState with submittedValues', async () => {
  const builder = new FormBuilder();
  const mockServices = { get: () => null };
  const mockHooks = { alter: async (name, data) => data };
  builder.setInfrastructure(mockServices, mockHooks);

  const submittedValues = {
    name: 'John Doe',
    email: 'john@example.com',
  };

  const result = await builder.processForm(TestForm, submittedValues);

  if (result.formState.getValue('name') !== 'John Doe') {
    throw new Error('formState missing name value');
  }
  if (result.formState.getValue('email') !== 'john@example.com') {
    throw new Error('formState missing email value');
  }
});

test('processForm() marks formState as submitted', async () => {
  const builder = new FormBuilder();
  const mockServices = { get: () => null };
  const mockHooks = { alter: async (name, data) => data };
  builder.setInfrastructure(mockServices, mockHooks);

  const result = await builder.processForm(TestForm, { name: 'Test' });

  if (!result.formState.isSubmitted()) {
    throw new Error('formState not marked as submitted');
  }
});

test('processForm() calls validateForm()', async () => {
  const builder = new FormBuilder();
  const mockServices = { get: () => null };
  const mockHooks = { alter: async (name, data) => data };
  builder.setInfrastructure(mockServices, mockHooks);

  const result = await builder.processForm(CompleteForm, { email: 'test@example.com' });

  if (!result.formInstance.validated) {
    throw new Error('validateForm was not called');
  }
});

test('processForm() calls submitForm() when validation passes', async () => {
  const builder = new FormBuilder();
  const mockServices = { get: () => null };
  const mockHooks = { alter: async (name, data) => data };
  builder.setInfrastructure(mockServices, mockHooks);

  const result = await builder.processForm(CompleteForm, {
    email: 'valid@example.com',
  });

  if (!result.formInstance.submitted) {
    throw new Error('submitForm was not called');
  }
});

test('processForm() does NOT call submitForm() when validation fails', async () => {
  const builder = new FormBuilder();
  const mockServices = { get: () => null };
  const mockHooks = { alter: async (name, data) => data };
  builder.setInfrastructure(mockServices, mockHooks);

  const result = await builder.processForm(CompleteForm, {
    email: 'invalid-email',  // No @ symbol
  });

  if (result.formInstance.submitted) {
    throw new Error('submitForm should not be called when validation fails');
  }
});

test('processForm() reflects validation errors in formState', async () => {
  const builder = new FormBuilder();
  const mockServices = { get: () => null };
  const mockHooks = { alter: async (name, data) => data };
  builder.setInfrastructure(mockServices, mockHooks);

  const result = await builder.processForm(ValidatingForm, {
    name: '',  // Empty name
    email: 'no-at-sign',  // Invalid email
  });

  if (!result.formState.hasErrors()) {
    throw new Error('formState should have errors');
  }

  const nameError = result.formState.getError('name');
  if (!nameError) {
    throw new Error('formState missing name error');
  }

  const emailError = result.formState.getError('email');
  if (!emailError) {
    throw new Error('formState missing email error');
  }
});

test('processForm() with valid data has no errors', async () => {
  const builder = new FormBuilder();
  const mockServices = { get: () => null };
  const mockHooks = { alter: async (name, data) => data };
  builder.setInfrastructure(mockServices, mockHooks);

  const result = await builder.processForm(ValidatingForm, {
    name: 'John Doe',
    email: 'john@example.com',
  });

  if (result.formState.hasErrors()) {
    const errors = result.formState.getErrors();
    throw new Error(`formState should not have errors: ${JSON.stringify(errors)}`);
  }
});

test('processForm() skips validation/submit when submittedValues is empty', async () => {
  const builder = new FormBuilder();
  const mockServices = { get: () => null };
  const mockHooks = { alter: async (name, data) => data };
  builder.setInfrastructure(mockServices, mockHooks);

  const result = await builder.processForm(CompleteForm, {});

  if (result.formState.isSubmitted()) {
    throw new Error('formState should not be marked as submitted for empty values');
  }
  if (result.formInstance.validated) {
    throw new Error('validateForm should not be called for empty values');
  }
  if (result.formInstance.submitted) {
    throw new Error('submitForm should not be called for empty values');
  }
});

test('processForm() returns correct structure', async () => {
  const builder = new FormBuilder();
  const mockServices = { get: () => null };
  const mockHooks = { alter: async (name, data) => data };
  builder.setInfrastructure(mockServices, mockHooks);

  const result = await builder.processForm(TestForm, { name: 'Test' });

  if (!result.form) {
    throw new Error('Result missing form property');
  }
  if (!result.formState) {
    throw new Error('Result missing formState property');
  }
  if (!result.formInstance) {
    throw new Error('Result missing formInstance property');
  }
  if (!(result.formInstance instanceof TestForm)) {
    throw new Error('formInstance is not instance of TestForm');
  }
  if (!(result.formState instanceof FormState)) {
    throw new Error('formState is not instance of FormState');
  }
});

test('Validation runs before submission', async () => {
  const builder = new FormBuilder();
  const mockServices = { get: () => null };
  const mockHooks = { alter: async (name, data) => data };
  builder.setInfrastructure(mockServices, mockHooks);

  const callOrder = [];

  class OrderTestForm extends TestForm {
    validateForm(form, formState) {
      callOrder.push('validate');
      formState.setError('test', 'error');
    }

    async submitForm(form, formState) {
      callOrder.push('submit');
    }
  }

  await builder.processForm(OrderTestForm, { name: 'Test' });

  if (callOrder.length !== 1) {
    throw new Error(`Expected 1 call, got ${callOrder.length}`);
  }
  if (callOrder[0] !== 'validate') {
    throw new Error('validate should be called');
  }
  // submit should NOT be in callOrder because validation failed
});

test('Submission runs after successful validation', async () => {
  const builder = new FormBuilder();
  const mockServices = { get: () => null };
  const mockHooks = { alter: async (name, data) => data };
  builder.setInfrastructure(mockServices, mockHooks);

  const callOrder = [];

  class OrderTestForm extends TestForm {
    validateForm(form, formState) {
      callOrder.push('validate');
      // No errors - validation passes
    }

    async submitForm(form, formState) {
      callOrder.push('submit');
    }
  }

  await builder.processForm(OrderTestForm, { name: 'Test' });

  if (callOrder.length !== 2) {
    throw new Error(`Expected 2 calls, got ${callOrder.length}`);
  }
  if (callOrder[0] !== 'validate') {
    throw new Error('validate should be called first');
  }
  if (callOrder[1] !== 'submit') {
    throw new Error('submit should be called second');
  }
});

test('submitForm can set redirect in formState', async () => {
  const builder = new FormBuilder();
  const mockServices = { get: () => null };
  const mockHooks = { alter: async (name, data) => data };
  builder.setInfrastructure(mockServices, mockHooks);

  const result = await builder.processForm(SubmittingForm, {
    name: 'Test',
    email: 'test@example.com',
  });

  if (result.formState.getRedirect() !== '/success') {
    throw new Error('submitForm did not set redirect');
  }
});

test('submitForm receives formState with submitted values', async () => {
  const builder = new FormBuilder();
  const mockServices = { get: () => null };
  const mockHooks = { alter: async (name, data) => data };
  builder.setInfrastructure(mockServices, mockHooks);

  const submittedValues = {
    name: 'Jane Smith',
    email: 'jane@example.com',
  };

  const result = await builder.processForm(SubmittingForm, submittedValues);

  if (!result.formInstance.submittedValues) {
    throw new Error('submitForm did not receive values');
  }
  if (result.formInstance.submittedValues.name !== 'Jane Smith') {
    throw new Error('submitForm did not receive correct name');
  }
  if (result.formInstance.submittedValues.email !== 'jane@example.com') {
    throw new Error('submitForm did not receive correct email');
  }
});

// Run all tests
runTests();
