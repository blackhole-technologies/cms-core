#!/usr/bin/env node
/**
 * Test Feature #5: FormBuilder form alter hook integration
 *
 * Verifies that FormBuilder fires form_alter and form_{formId}_alter hooks
 * after buildForm(), allowing modules to modify any form.
 */

import { FormBuilder } from './core/lib/Form/FormBuilder.js';
import { FormState } from './core/lib/Form/FormState.js';
import { HookManager } from './core/lib/Hook/HookManager.js';

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

  validateForm(form, formState) {}
  async submitForm(form, formState) {}
}

class ContactForm extends TestForm {
  getFormId() {
    return 'contact_form';
  }

  buildForm(formState) {
    return {
      email: {
        '#type': 'email',
        '#title': 'Email',
      },
      message: {
        '#type': 'textarea',
        '#title': 'Message',
      },
      actions: {
        '#type': 'actions',
        submit: {
          '#type': 'submit',
          '#value': 'Send',
        },
      },
    };
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
  console.log('Testing Feature #5: FormBuilder form alter hook integration\n');

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

test('form_alter hook fires for all forms', async () => {
  const builder = new FormBuilder();
  const hooks = new HookManager();
  const mockServices = { get: () => null };
  builder.setInfrastructure(mockServices, hooks);

  let alterCalled = false;

  // Register generic form_alter hook
  hooks.onAlter('form', (form) => {
    alterCalled = true;
    return form;
  }, { module: 'test' });

  await builder.getForm(TestForm);

  if (!alterCalled) {
    throw new Error('form_alter hook was not called');
  }
});

test('form_alter hook receives form, formState, and formId', async () => {
  const builder = new FormBuilder();
  const hooks = new HookManager();
  const mockServices = { get: () => null };
  builder.setInfrastructure(mockServices, hooks);

  let receivedForm = null;
  let receivedContext = null;

  hooks.onAlter('form', (form, context) => {
    receivedForm = form;
    receivedContext = context;
    return form;
  }, { module: 'test' });

  await builder.getForm(TestForm);

  if (!receivedForm) {
    throw new Error('form_alter did not receive form');
  }
  if (!receivedContext) {
    throw new Error('form_alter did not receive context');
  }
  if (!(receivedContext.formState instanceof FormState)) {
    throw new Error('context.formState is not a FormState instance');
  }
  if (receivedContext.formId !== 'test_form') {
    throw new Error('context.formId is not test_form');
  }
});

test('form_alter can add fields to the form', async () => {
  const builder = new FormBuilder();
  const hooks = new HookManager();
  const mockServices = { get: () => null };
  builder.setInfrastructure(mockServices, hooks);

  // Register hook that adds a field
  hooks.onAlter('form', (form) => {
    form.added_field = {
      '#type': 'textfield',
      '#title': 'Added Field',
    };
    return form;
  }, { module: 'test' });

  const result = await builder.getForm(TestForm);

  if (!result.form.added_field) {
    throw new Error('form_alter did not add field');
  }
  if (result.form.added_field['#title'] !== 'Added Field') {
    throw new Error('Added field does not have correct title');
  }
});

test('form_{formId}_alter fires for specific form', async () => {
  const builder = new FormBuilder();
  const hooks = new HookManager();
  const mockServices = { get: () => null };
  builder.setInfrastructure(mockServices, hooks);

  let specificAlterCalled = false;

  // Register form_test_form_alter hook
  hooks.onAlter('form_test_form', (form) => {
    specificAlterCalled = true;
    return form;
  }, { module: 'test' });

  await builder.getForm(TestForm);

  if (!specificAlterCalled) {
    throw new Error('form_test_form_alter hook was not called');
  }
});

test('form_{formId}_alter does NOT fire for other forms', async () => {
  const builder = new FormBuilder();
  const hooks = new HookManager();
  const mockServices = { get: () => null };
  builder.setInfrastructure(mockServices, hooks);

  let contactAlterCalled = false;

  // Register form_contact_form_alter hook
  hooks.onAlter('form_contact_form', (form) => {
    contactAlterCalled = true;
    return form;
  }, { module: 'test' });

  // Build TestForm (NOT ContactForm)
  await builder.getForm(TestForm);

  if (contactAlterCalled) {
    throw new Error('form_contact_form_alter should not fire for TestForm');
  }
});

test('Both form_alter and form_{formId}_alter fire in correct order', async () => {
  const builder = new FormBuilder();
  const hooks = new HookManager();
  const mockServices = { get: () => null };
  builder.setInfrastructure(mockServices, hooks);

  const callOrder = [];

  // Register generic form_alter
  hooks.onAlter('form', (form) => {
    callOrder.push('generic');
    return form;
  }, { module: 'test' });

  // Register specific form_test_form_alter
  hooks.onAlter('form_test_form', (form) => {
    callOrder.push('specific');
    return form;
  }, { module: 'test' });

  await builder.getForm(TestForm);

  if (callOrder.length !== 2) {
    throw new Error(`Expected 2 hooks to fire, got ${callOrder.length}`);
  }
  if (callOrder[0] !== 'generic') {
    throw new Error('Generic hook should fire first');
  }
  if (callOrder[1] !== 'specific') {
    throw new Error('Specific hook should fire second');
  }
});

test('Multiple modules can alter the same form', async () => {
  const builder = new FormBuilder();
  const hooks = new HookManager();
  const mockServices = { get: () => null };
  builder.setInfrastructure(mockServices, hooks);

  // Module A adds field1
  hooks.onAlter('form', (form) => {
    form.field1 = { '#type': 'textfield', '#title': 'Field 1' };
    return form;
  }, { module: 'module_a' });

  // Module B adds field2
  hooks.onAlter('form', (form) => {
    form.field2 = { '#type': 'textfield', '#title': 'Field 2' };
    return form;
  }, { module: 'module_b' });

  const result = await builder.getForm(TestForm);

  if (!result.form.field1) {
    throw new Error('Module A did not add field1');
  }
  if (!result.form.field2) {
    throw new Error('Module B did not add field2');
  }
});

test('Specific hook can override generic hook changes', async () => {
  const builder = new FormBuilder();
  const hooks = new HookManager();
  const mockServices = { get: () => null };
  builder.setInfrastructure(mockServices, hooks);

  // Generic hook adds a field
  hooks.onAlter('form', (form) => {
    form.test_field = {
      '#type': 'textfield',
      '#title': 'Original Title',
    };
    return form;
  }, { module: 'generic' });

  // Specific hook modifies that field
  hooks.onAlter('form_test_form', (form) => {
    if (form.test_field) {
      form.test_field['#title'] = 'Modified Title';
    }
    return form;
  }, { module: 'specific' });

  const result = await builder.getForm(TestForm);

  if (result.form.test_field['#title'] !== 'Modified Title') {
    throw new Error('Specific hook did not override generic hook');
  }
});

test('Hooks can access and modify formState', async () => {
  const builder = new FormBuilder();
  const hooks = new HookManager();
  const mockServices = { get: () => null };
  builder.setInfrastructure(mockServices, hooks);

  hooks.onAlter('form', (form, context) => {
    // Set a value in formState
    context.formState.setValue('hook_set', 'test_value');
    return form;
  }, { module: 'test' });

  const result = await builder.getForm(TestForm);

  if (result.formState.getValue('hook_set') !== 'test_value') {
    throw new Error('Hook did not modify formState');
  }
});

test('Alter hooks work with ContactForm (different form ID)', async () => {
  const builder = new FormBuilder();
  const hooks = new HookManager();
  const mockServices = { get: () => null };
  builder.setInfrastructure(mockServices, hooks);

  let contactAlterCalled = false;

  hooks.onAlter('form_contact_form', (form) => {
    contactAlterCalled = true;
    form.phone = {
      '#type': 'tel',
      '#title': 'Phone',
    };
    return form;
  }, { module: 'test' });

  const result = await builder.getForm(ContactForm);

  if (!contactAlterCalled) {
    throw new Error('form_contact_form_alter did not fire');
  }
  if (!result.form.phone) {
    throw new Error('Hook did not add phone field');
  }
});

test('FormBuilder works without hooks infrastructure', async () => {
  const builder = new FormBuilder();
  const mockServices = { get: () => null };
  // Don't call setInfrastructure with hooks (hooks is null)
  builder.setInfrastructure(mockServices, null);

  // Should not crash even without hooks
  const result = await builder.getForm(TestForm);

  if (!result.form) {
    throw new Error('getForm failed without hooks');
  }
});

test('Altered form retains original fields', async () => {
  const builder = new FormBuilder();
  const hooks = new HookManager();
  const mockServices = { get: () => null };
  builder.setInfrastructure(mockServices, hooks);

  hooks.onAlter('form', (form) => {
    form.extra = { '#type': 'textfield' };
    return form;
  }, { module: 'test' });

  const result = await builder.getForm(TestForm);

  // Original fields should still exist
  if (!result.form.name) {
    throw new Error('Original name field was lost');
  }
  if (!result.form.actions) {
    throw new Error('Original actions field was lost');
  }
  // New field should also exist
  if (!result.form.extra) {
    throw new Error('Alter hook did not add extra field');
  }
});

// Run all tests
runTests();
