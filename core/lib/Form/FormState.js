/**
 * @file
 * Form state management for CMS-Core.
 *
 * Tracks form values, errors, submission state, and entity context during
 * the build → validate → submit lifecycle. FormState instances are passed
 * through all form methods and accumulate validation errors, redirect URLs,
 * and rebuild flags that control form flow.
 *
 * Drupal equivalent: FormStateInterface.php
 *
 * @see .autoforge/templates/form-base.js for usage examples
 */

// WHY: Symbol-based private state prevents external manipulation of form state.
// Forms must use the public API (setValue, setError, etc.) which enforces
// method chaining and type safety.
const VALUES = Symbol('values');
const ERRORS = Symbol('errors');
const REDIRECT = Symbol('redirect');
const ENTITY = Symbol('entity');
const REBUILD = Symbol('rebuild');
const SUBMITTED = Symbol('submitted');
const STORAGE = Symbol('storage');
const TEMPORARY = Symbol('temporary');

export class FormState {
  /**
   * Create a new form state.
   *
   * WHY: Constructor accepts initial values for entity forms that pre-populate
   * fields from database. Empty object for new forms.
   *
   * @param {Object} [initialValues={}] - Initial form values (e.g., from entity)
   */
  constructor(initialValues = {}) {
    // WHY: Map for O(1) field value lookups instead of object property access
    this[VALUES] = new Map(Object.entries(initialValues));

    // WHY: Separate map for errors so we can iterate errors independently
    this[ERRORS] = new Map();

    // WHY: Single value storage for metadata that doesn't need Map structure
    this[REDIRECT] = null;
    this[ENTITY] = null;
    this[REBUILD] = false;
    this[SUBMITTED] = false;

    // WHY: Storage persists across multi-step form submissions (e.g., wizards).
    // Temporary values are for processing state that doesn't persist.
    this[STORAGE] = new Map();
    this[TEMPORARY] = new Map();
  }

  // ========================================================================
  // Value Handling
  // ========================================================================

  /**
   * Get a single form value.
   *
   * WHY: Returns undefined for missing values instead of null to match
   * JavaScript convention for Map.get().
   *
   * @param {string} key - Field name
   * @returns {*} Field value or undefined
   */
  getValue(key) {
    return this[VALUES].get(key);
  }

  /**
   * Get all form values.
   *
   * WHY: Returns plain object instead of Map for easy destructuring and
   * JSON serialization in submit handlers.
   *
   * @returns {Object} All field values as plain object
   */
  getValues() {
    return Object.fromEntries(this[VALUES]);
  }

  /**
   * Set a single form value.
   *
   * WHY: Returns this for method chaining:
   * formState.setValue('name', 'x').setValue('email', 'y')
   *
   * @param {string} key - Field name
   * @param {*} value - Field value
   * @returns {FormState} this for chaining
   */
  setValue(key, value) {
    this[VALUES].set(key, value);
    return this;
  }

  /**
   * Merge multiple values into form state.
   *
   * WHY: Used by FormBuilder.processForm() to populate state from HTTP POST.
   * Merges instead of replacing to preserve values set by buildForm().
   *
   * @param {Object} values - Object of field values to merge
   * @returns {FormState} this for chaining
   */
  setValues(values) {
    for (const [key, value] of Object.entries(values)) {
      this[VALUES].set(key, value);
    }
    return this;
  }

  // ========================================================================
  // Error Handling
  // ========================================================================

  /**
   * Set a validation error for a field.
   *
   * WHY: Errors are keyed by field name so we can highlight the specific
   * field with invalid input. Message is user-facing.
   *
   * @param {string} field - Field name that has error
   * @param {string} message - User-facing error message
   * @returns {FormState} this for chaining
   */
  setError(field, message) {
    this[ERRORS].set(field, message);
    return this;
  }

  /**
   * Set a validation error by field name.
   *
   * WHY: Alias for setError() to match Drupal API. Some developers
   * prefer the explicit "ByName" suffix.
   *
   * @param {string} field - Field name that has error
   * @param {string} message - User-facing error message
   * @returns {FormState} this for chaining
   */
  setErrorByName(field, message) {
    return this.setError(field, message);
  }

  /**
   * Get error message for a field.
   *
   * WHY: Returns null instead of undefined to explicitly signal "no error"
   * for template rendering (null is more semantic than undefined).
   *
   * @param {string} field - Field name
   * @returns {string|null} Error message or null
   */
  getError(field) {
    return this[ERRORS].get(field) || null;
  }

  /**
   * Get all validation errors.
   *
   * WHY: Plain object for template rendering. Form themes iterate errors
   * to display summary messages.
   *
   * @returns {Object} All errors as {field: message}
   */
  getErrors() {
    return Object.fromEntries(this[ERRORS]);
  }

  /**
   * Check if form has any validation errors.
   *
   * WHY: Used by FormBuilder to decide whether to call submitForm().
   * If errors exist, submission is skipped and form is rebuilt.
   *
   * @returns {boolean} true if errors exist
   */
  hasErrors() {
    return this[ERRORS].size > 0;
  }

  /**
   * Clear all validation errors.
   *
   * WHY: Used when rebuilding form after fixing errors, or when
   * re-validating after AJAX updates.
   *
   * @returns {FormState} this for chaining
   */
  clearErrors() {
    this[ERRORS].clear();
    return this;
  }

  // ========================================================================
  // Submission State
  // ========================================================================

  /**
   * Check if form was submitted.
   *
   * WHY: Distinguishes initial form display (GET) from form submission (POST).
   * validateForm() and submitForm() only run if form was submitted.
   *
   * @returns {boolean} true if form was submitted
   */
  isSubmitted() {
    return this[SUBMITTED];
  }

  /**
   * Mark form as submitted.
   *
   * WHY: Set by FormBuilder.processForm() when handling POST request.
   * Triggers validation and submission flow.
   *
   * @param {boolean} flag - Submitted state
   * @returns {FormState} this for chaining
   */
  setSubmitted(flag) {
    this[SUBMITTED] = flag;
    return this;
  }

  /**
   * Check if form needs to be rebuilt.
   *
   * WHY: Multi-step forms and AJAX forms use rebuild to re-render with
   * current values but without redirecting. Example: "Add another item" button.
   *
   * @returns {boolean} true if form should be rebuilt
   */
  isRebuilding() {
    return this[REBUILD];
  }

  /**
   * Set rebuild flag.
   *
   * WHY: Set by submitForm() when form needs re-display instead of redirect.
   * FormBuilder detects this and re-calls buildForm() with current state.
   *
   * @param {boolean} flag - Rebuild state
   * @returns {FormState} this for chaining
   */
  setRebuild(flag) {
    this[REBUILD] = flag;
    return this;
  }

  // ========================================================================
  // Redirect and Entity Handling
  // ========================================================================

  /**
   * Set redirect URL for successful submission.
   *
   * WHY: submitForm() sets this to navigate user after save.
   * Example: after creating node, redirect to /node/123.
   *
   * @param {string} url - Redirect URL
   * @returns {FormState} this for chaining
   */
  setRedirect(url) {
    this[REDIRECT] = url;
    return this;
  }

  /**
   * Get redirect URL.
   *
   * WHY: FormBuilder uses this after successful submission to determine
   * where to send the user.
   *
   * @returns {string|null} Redirect URL or null
   */
  getRedirect() {
    return this[REDIRECT];
  }

  /**
   * Set entity being edited.
   *
   * WHY: Entity forms (NodeForm, UserForm) attach the entity to state so
   * buildForm() can access current values and submitForm() can save changes.
   *
   * @param {Object} entity - Entity being edited
   * @returns {FormState} this for chaining
   */
  setEntity(entity) {
    this[ENTITY] = entity;
    return this;
  }

  /**
   * Get entity being edited.
   *
   * WHY: buildForm() uses this to populate #default_value from entity fields.
   * submitForm() uses this to save modified entity.
   *
   * @returns {Object|null} Entity or null for non-entity forms
   */
  getEntity() {
    return this[ENTITY];
  }

  // ========================================================================
  // Storage and Temporary Values
  // ========================================================================

  /**
   * Store arbitrary data that persists across form rebuilds.
   *
   * WHY: Multi-step forms use storage to track wizard state (e.g., step number,
   * partial data). Storage survives rebuild but not across HTTP requests.
   *
   * @param {string} key - Storage key
   * @param {*} value - Storage value
   * @returns {FormState} this for chaining
   */
  setStorage(key, value) {
    this[STORAGE].set(key, value);
    return this;
  }

  /**
   * Get stored data.
   *
   * WHY: Retrieve wizard state between steps. Returns null for missing keys
   * to signal "not set" for conditional logic.
   *
   * @param {string} key - Storage key
   * @returns {*} Storage value or null
   */
  getStorage(key) {
    return this[STORAGE].get(key) || null;
  }

  /**
   * Store temporary processing data.
   *
   * WHY: Temporary values are for internal processing state that doesn't
   * need to persist. Example: AJAX callback metadata, processing flags.
   *
   * @param {string} key - Temporary key
   * @param {*} value - Temporary value
   * @returns {FormState} this for chaining
   */
  setTemporaryValue(key, value) {
    this[TEMPORARY].set(key, value);
    return this;
  }

  /**
   * Get temporary value.
   *
   * WHY: Access processing state set during validation or submission.
   *
   * @param {string} key - Temporary key
   * @returns {*} Temporary value or null
   */
  getTemporaryValue(key) {
    return this[TEMPORARY].get(key) || null;
  }
}
