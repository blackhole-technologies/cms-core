/**
 * @file
 * Form processing engine for CMS-Core.
 *
 * FormBuilder is the orchestrator that turns HTTP POST into the
 * build → alter → validate → submit pipeline. Key responsibilities:
 * - Build form render arrays from FormBase classes
 * - Fire form alter hooks (lets any module modify any form)
 * - Populate FormState from submitted values
 * - Orchestrate validation and submission flow
 * - Handle form rebuilds and redirects
 *
 * Drupal equivalent: FormBuilder.php
 *
 * @see .autoforge/templates/form-base.js for form class examples
 */

import { randomUUID } from 'node:crypto';
import { FormState } from './FormState.js';

// WHY: Symbol-based private state prevents external manipulation of the
// form building infrastructure. Only setInfrastructure() can wire dependencies.
const SERVICES = Symbol('services');
const HOOKS = Symbol('hooks');
const FORM_REGISTRY = Symbol('form_registry');

export class FormBuilder {
  /**
   * Create a new FormBuilder.
   *
   * WHY: Constructor takes no arguments. Infrastructure is wired later via
   * setInfrastructure() after DI container is compiled. This matches the
   * pattern used by PluginManager and other core subsystems.
   */
  constructor() {
    // WHY: Initialize to null to signal "not yet wired"
    this[SERVICES] = null;
    this[HOOKS] = null;

    // WHY: Form registry maps form IDs to form classes. This allows
    // retrieveForm() to look up a form class by its ID from POST data.
    // When a form is submitted, we only have the #form_id hidden field value,
    // not the original class reference.
    this[FORM_REGISTRY] = new Map();
  }

  /**
   * Wire up infrastructure references.
   *
   * WHY: Called during boot after DI container and hook system are ready.
   * Separates construction from infrastructure wiring, allowing FormBuilder
   * to be instantiated early in the boot process.
   *
   * @param {Container} services - DI container for service injection
   * @param {HookManager} hooks - Hook system for form alter hooks
   */
  setInfrastructure(services, hooks) {
    this[SERVICES] = services;
    this[HOOKS] = hooks;
  }

  /**
   * Build a form render array from a form class.
   *
   * WHY: This is the entry point for all form rendering. It instantiates
   * the form class, creates a FormState, builds the render array, injects
   * hidden fields for CSRF protection, and fires alter hooks.
   *
   * The alter hook mechanism is the KILLER FEATURE of the form system.
   * ANY module can modify ANY form via hook_form_alter and hook_form_ID_alter.
   * This is how SEO modules add meta fields to content forms, how scheduling
   * modules add publish dates, etc.
   *
   * The returned object contains:
   * - form: The render array (ready to pass to Renderer)
   * - formState: The FormState instance (tracks values/errors)
   * - formInstance: The FormBase instance (needed for processForm)
   *
   * Drupal equivalent: FormBuilder::getForm()
   *
   * @param {Function} formClass - FormBase subclass constructor
   * @returns {Promise<{form: Object, formState: FormState, formInstance: Object}>}
   */
  async getForm(formClass) {
    // WHY: Instantiate form class with services for dependency injection.
    // Form classes need access to entity storage, mailers, etc.
    const formInstance = new formClass(this[SERVICES]);

    // WHY: Create fresh FormState for this form build. Each request gets
    // its own state to track values, errors, and submission metadata.
    const formState = new FormState();

    // WHY: Call buildForm() to get the render array structure.
    // Subclasses define their fields here.
    let form = formInstance.buildForm(formState);

    // WHY: Get form ID for alter hooks and hidden field
    const formId = formInstance.getFormId();

    // WHY: Inject hidden #form_id field for form routing on submit.
    // When POST comes in, we use this to look up which form class to use.
    form['#form_id'] = {
      '#type': 'hidden',
      '#value': formId,
    };

    // WHY: Inject hidden #form_build_id for CSRF protection.
    // Each form render gets a unique ID. On submit, we validate it matches.
    form['#form_build_id'] = {
      '#type': 'hidden',
      '#value': randomUUID(),
    };

    // WHY: Fire form alter hooks to let other modules modify the form.
    // This is executed AFTER the form is built but BEFORE it's rendered.
    //
    // Two hooks fire in order:
    // 1. hook_form_alter - GENERIC hook that fires for ALL forms
    //    Example: A form styling module that adds CSS classes to every form
    //
    // 2. hook_form_{formId}_alter - SPECIFIC hook for this exact form
    //    Example: hook_form_contact_form_alter only runs for contact form
    //
    // WHY THIS ORDER:
    // Generic hooks run first so specific hooks can override generic changes.
    // If a global hook adds a field, a form-specific hook can remove it.
    if (this[HOOKS]) {
      // Fire generic form_alter hook (runs for ALL forms)
      form = await this[HOOKS].alter('form', form, { formState, formId });

      // Fire specific form_{formId}_alter hook (runs for THIS form only)
      form = await this[HOOKS].alter(`form_${formId}`, form, { formState });
    }

    return { form, formState, formInstance };
  }

  /**
   * Register a form class in the form registry.
   *
   * WHY: This allows retrieveForm() to look up a form class by its ID.
   * When processing a form submission, we only have the #form_id hidden field
   * value from POST data, not the original class reference. The registry
   * maps form IDs to their classes.
   *
   * @param {string} formId - The form ID (from getFormId())
   * @param {Function} formClass - FormBase subclass constructor
   */
  registerForm(formId, formClass) {
    this[FORM_REGISTRY].set(formId, formClass);
  }

  /**
   * Retrieve a form class from the registry by its ID.
   *
   * WHY: When a form is submitted, the POST data contains #form_id.
   * This method looks up the corresponding form class so we can
   * instantiate it and call its validate/submit methods.
   *
   * @param {string} formId - The form ID to look up
   * @returns {Function} The form class constructor
   * @throws {Error} If form ID not found (lists available IDs)
   */
  retrieveForm(formId) {
    if (!this[FORM_REGISTRY].has(formId)) {
      const availableIds = Array.from(this[FORM_REGISTRY].keys()).sort();
      throw new Error(
        `Unknown form ID "${formId}". ` +
        `Available forms: ${availableIds.length > 0 ? availableIds.join(', ') : 'none registered'}`
      );
    }
    return this[FORM_REGISTRY].get(formId);
  }

  /**
   * Process a form submission.
   *
   * WHY: This is the POST handler. It builds the form, populates FormState
   * from submitted values, runs validation, and if valid, runs submission.
   *
   * The flow:
   * 1. Build form (same as GET request)
   * 2. Populate FormState with POST data
   * 3. Mark as submitted
   * 4. Run validateForm()
   * 5. If no errors, run submitForm()
   * 6. Check if form needs rebuild (multi-step forms, ajax)
   * 7. If rebuilding, re-call buildForm with populated FormState
   * 8. Return {form, formState, formInstance}
   *
   * WHY REBUILD: Multi-step forms need to rebuild after each step to show
   * the next page. AJAX forms need to rebuild to reflect server-side changes.
   * The submit handler sets formState.setRebuild(true) to trigger this.
   *
   * Drupal equivalent: FormBuilder::submitForm()
   *
   * @param {Function} formClass - FormBase subclass constructor
   * @param {Object} submittedValues - POST data from HTTP request
   * @returns {Promise<{form: Object, formState: FormState, formInstance: Object}>}
   */
  async processForm(formClass, submittedValues) {
    // WHY: Build the form first to get formInstance and formState
    let { form, formState, formInstance } = await this.getForm(formClass);

    // WHY: Only process if submittedValues is not empty.
    // Empty object means this is a GET request or no data submitted.
    if (submittedValues && Object.keys(submittedValues).length > 0) {
      // WHY: Populate FormState with submitted values
      formState.setValues(submittedValues);

      // WHY: Mark as submitted to trigger validation and submission
      formState.setSubmitted(true);

      // WHY: Run validation. Form classes use formState.setError() to
      // report validation failures.
      formInstance.validateForm(form, formState);

      // WHY: Only submit if validation passed. If errors exist,
      // form will be rebuilt with error messages.
      if (!formState.hasErrors()) {
        await formInstance.submitForm(form, formState);
      }

      // WHY: Check if form needs rebuild. This happens in two scenarios:
      // 1. Validation errors - form rebuilds to show error messages
      // 2. Submit handler sets rebuild flag - multi-step forms, ajax updates
      //
      // When rebuilding, we re-call buildForm() with the POPULATED formState.
      // This preserves user input and lets the form class adjust its structure
      // based on submitted values (e.g., show step 2 of a wizard).
      if (formState.hasErrors() || formState.isRebuilding()) {
        // WHY: Re-call buildForm with populated formState. The form class
        // can use formState.getValue() to get user input and adjust the
        // structure accordingly.
        form = formInstance.buildForm(formState);

        // WHY: Get form ID for re-injecting hidden fields
        const formId = formInstance.getFormId();

        // WHY: Re-inject hidden fields (same as getForm())
        form['#form_id'] = {
          '#type': 'hidden',
          '#value': formId,
        };

        form['#form_build_id'] = {
          '#type': 'hidden',
          '#value': randomUUID(),
        };

        // WHY: Re-fire alter hooks on rebuilt form. Other modules need a chance
        // to alter the rebuilt structure. For example, if a multi-step form shows
        // different fields on step 2, alter hooks must run again.
        if (this[HOOKS]) {
          form = await this[HOOKS].alter('form', form, { formState, formId });
          form = await this[HOOKS].alter(`form_${formId}`, form, { formState });
        }
      }
    }

    return { form, formState, formInstance };
  }
}
