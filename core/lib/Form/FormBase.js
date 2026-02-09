/**
 * @file
 * Base classes for forms in CMS-Core.
 *
 * WHY THIS EXISTS:
 * FormBase provides the foundation for all forms in CMS-Core. Forms are render
 * arrays with #type elements (textfield, select, etc.) that get built, altered
 * by other modules via hook_form_alter, validated, and submitted.
 *
 * ConfirmFormBase is a specialized form for delete/confirmation operations,
 * providing a standard UI pattern with question, description, confirm/cancel.
 *
 * The KEY feature: hook_form_alter lets ANY module modify ANY form. This is
 * how SEO modules add meta fields to content forms, scheduling modules add
 * publish dates, etc.
 *
 * Drupal equivalent: FormBase.php, FormInterface.php, ConfirmFormBase.php
 *
 * @see .autoforge/templates/form-base.js for usage examples and element types
 */

// WHY: Symbol-based private state prevents external manipulation of services.
// Forms must access services through the constructor-provided reference.
const SERVICES = Symbol('services');

/**
 * Base class for all forms in CMS-Core.
 *
 * WHY: Provides standard form lifecycle methods (build, validate, submit) and
 * enforces the getFormId() contract. Subclasses override these methods to
 * implement specific forms (contact forms, entity edit forms, etc.).
 */
export class FormBase {
  /**
   * Create a new form.
   *
   * WHY: Constructor accepts services container so form classes can access
   * dependencies (entity storage, mailer, etc.) without coupling to globals.
   *
   * @param {Object} services - Service container or object with get() method
   */
  constructor(services) {
    // WHY: Store services in Symbol-keyed property to prevent external access
    // while allowing subclasses to use this._services pattern for DX
    this[SERVICES] = services;

    // WHY: Expose via underscore property for subclass convenience
    // This matches Drupal convention and keeps code readable
    this._services = services;
  }

  /**
   * Get the unique form ID.
   *
   * WHY: Every form needs a unique ID for hook_form_alter dispatch, form
   * registry lookup, and CSRF token validation. Subclasses MUST override.
   *
   * @returns {string} The form ID (e.g., 'contact_form', 'node_edit')
   * @throws {Error} If subclass doesn't implement this method
   */
  getFormId() {
    throw new Error('Subclass must implement getFormId()');
  }

  /**
   * Build the form render array.
   *
   * WHY: Default implementation returns empty object for minimal forms or
   * forms that only use alter hooks. Most subclasses override to add fields.
   *
   * Form render arrays use #type elements:
   * - textfield, textarea, email, password, number, hidden
   * - select (with #options), radios, checkboxes, checkbox
   * - submit, button, link
   * - details (collapsible), fieldset, actions
   *
   * Properties: #title, #description, #required, #default_value, #weight, etc.
   *
   * @param {FormState} formState - Form state with values, errors, entity
   * @returns {Object} Render array with form elements
   */
  buildForm(formState) {
    // WHY: Empty object is valid for forms that are purely built via alter hooks
    // or for base classes where all logic is in subclasses
    return {};
  }

  /**
   * Validate form submission.
   *
   * WHY: Default is no-op because many forms don't need validation beyond
   * HTML5 required/pattern attributes. Subclasses override to add validation
   * logic and call formState.setError() for invalid fields.
   *
   * @param {Object} form - The built form render array
   * @param {FormState} formState - Form state with submitted values
   */
  validateForm(form, formState) {
    // WHY: No-op by default. Override in subclass to add validation.
    // Example: formState.setError('email', 'Invalid email address');
  }

  /**
   * Handle form submission.
   *
   * WHY: Default is no-op because some forms are purely for display or handled
   * by alter hooks. Subclasses override to save data, send emails, etc.
   *
   * Called ONLY if validateForm() passed (no errors set). Use formState to:
   * - Get submitted values: formState.getValue('field_name')
   * - Set redirect: formState.setRedirect('/path')
   * - Trigger rebuild: formState.setRebuild(true)
   *
   * @param {Object} form - The built form render array
   * @param {FormState} formState - Form state with submitted values
   * @returns {Promise<void>} Async submission handling
   */
  async submitForm(form, formState) {
    // WHY: No-op by default. Override in subclass to process submission.
    // Example: await storage.save(entity); formState.setRedirect('/node/123');
  }
}

/**
 * Base class for confirmation forms (delete, discard changes, etc.).
 *
 * WHY: Confirmation forms have a standard pattern: question, description,
 * confirm button, cancel link. This class implements buildForm() to create
 * that UI automatically. Subclasses only need to provide text and handle submit.
 *
 * Used for delete operations, irreversible actions, and workflow confirmations.
 */
export class ConfirmFormBase extends FormBase {
  /**
   * Get the confirmation question.
   *
   * WHY: Every confirmation form needs a clear question. Subclasses override
   * to provide context-specific text (e.g., "Delete article 'Hello World'?").
   *
   * @returns {string} The question text
   * @throws {Error} If subclass doesn't implement this method
   */
  getQuestion() {
    throw new Error('Subclass must implement getQuestion()');
  }

  /**
   * Get the cancel URL.
   *
   * WHY: User needs a way to back out of the confirmation. Subclasses override
   * to return the appropriate cancel destination (e.g., entity view page).
   *
   * @returns {string} The cancel URL path
   * @throws {Error} If subclass doesn't implement this method
   */
  getCancelUrl() {
    throw new Error('Subclass must implement getCancelUrl()');
  }

  /**
   * Get the confirmation description (optional).
   *
   * WHY: Some confirmations need additional context or warnings. Default is
   * empty string. Override to add text like "This action cannot be undone."
   *
   * @returns {string} The description text (can be empty)
   */
  getDescription() {
    return '';
  }

  /**
   * Get the confirm button text.
   *
   * WHY: Default is generic "Confirm" but some operations need specific text
   * like "Delete", "Discard changes", "Publish now". Override for clarity.
   *
   * @returns {string} The confirm button label
   */
  getConfirmText() {
    return 'Confirm';
  }

  /**
   * Build the confirmation form render array.
   *
   * WHY: Provides consistent UI for all confirmation forms. Uses the question,
   * description, and button text from getters to construct a standard layout.
   *
   * Subclasses rarely need to override this — just implement the getters and
   * submitForm() instead.
   *
   * @param {FormState} formState - Form state (entity context if applicable)
   * @returns {Object} Render array with question, description, actions
   */
  buildForm(formState) {
    // WHY: Build render array from getter methods so subclasses control content
    const form = {
      '#title': this.getQuestion(),
    };

    // WHY: Only add description if subclass provided one (avoid empty <p> tags)
    const description = this.getDescription();
    if (description) {
      form.description = {
        '#type': 'markup',
        '#markup': `<p>${description}</p>`,
      };
    }

    // WHY: Actions container groups buttons with standard styling
    form.actions = {
      '#type': 'actions',
      confirm: {
        '#type': 'submit',
        '#value': this.getConfirmText(),
      },
      cancel: {
        '#type': 'link',
        '#title': 'Cancel',
        '#url': this.getCancelUrl(),
      },
    };

    return form;
  }
}
