/**
 * Form API - Drupal-Style Form Builder
 *
 * @version 1.0.0
 *
 * Provides programmatic form building, validation, and processing
 * with support for AJAX, conditional states, and file uploads.
 */

import crypto from 'node:crypto';

// ============================================
// Types
// ============================================

/** Attributes map for HTML elements */
interface FormAttributes {
  [key: string]: string | boolean | number | undefined;
}

/** A form element -- the fundamental unit of the Form API */
interface FormElement {
  '#type'?: string;
  '#id'?: string;
  '#name'?: string;
  '#value'?: unknown;
  '#default_value'?: unknown;
  '#title'?: string;
  '#title_display'?: string;
  '#description'?: string;
  '#required'?: boolean;
  '#error'?: string;
  '#attributes'?: FormAttributes;
  '#method'?: string;
  '#action'?: string;
  '#tree'?: boolean;
  '#parents'?: string[];
  '#form_id'?: string;
  '#token'?: string;
  '#validate'?: Array<FormHandler>;
  '#submit'?: Array<FormHandler>;
  '#states'?: Record<string, unknown>;
  '#ajax'?: Record<string, unknown>;
  '#options'?: Record<string, string>;
  '#multiple'?: boolean;
  '#return_value'?: string;
  '#button_type'?: string;
  '#collapsible'?: boolean;
  '#collapsed'?: boolean;
  '#open'?: boolean;
  '#markup'?: string;
  '#maxlength'?: number;
  '#size'?: number;
  '#placeholder'?: string;
  '#autocomplete'?: string;
  '#rows'?: number;
  '#cols'?: number;
  '#min'?: number;
  '#max'?: number;
  '#step'?: number;
  '#pattern'?: string;
  '#pattern_error'?: string;
  '#machine_name'?: { source?: string; maxlength?: number };
  '#source_field'?: string;
  '#upload_validators'?: Record<string, unknown[]>;
  '#max_filesize'?: unknown;
  '#header'?: string[];
  '#delta'?: number;
  '#checked'?: boolean;
  [key: string]: unknown;
}

/** A handler function (validate or submit) */
type FormHandler = ((form: FormElement, formState: FormState) => void | Promise<void>) | string;

/** Form state object tracks values, errors, and metadata */
interface FormState {
  formId?: string;
  values: Record<string, unknown>;
  input: Record<string, unknown>;
  errors: FormError[];
  storage: Record<string, unknown>;
  rebuild: boolean;
  redirect: string | null;
  cached: boolean;
  buildInfo: Record<string, unknown>;
  formToken?: string;
}

/** A validation error on a form element */
interface FormError {
  name: string;
  message: string;
  element: FormElement | null;
}

/** An element type definition in the registry */
interface ElementTypeDefinition {
  input_type?: string;
  container?: boolean;
  process: string[];
}

/** Cached form entry */
interface FormCacheEntry {
  form: FormElement;
  formState: FormState;
  timestamp: number;
}

/** Result of processing a form submission */
interface FormProcessResult {
  status: string;
  error?: string;
  errors?: FormError[];
  form?: FormElement;
  values?: Record<string, unknown>;
  redirect?: string | null;
}

/** An HTTP request with body for form processing */
interface FormRequest {
  body?: Record<string, unknown>;
}

// Form element type registry
const ELEMENT_TYPES: Record<string, ElementTypeDefinition> = {
  textfield: {
    input_type: 'text',
    process: ['processTextfield']
  },
  textarea: {
    input_type: 'textarea',
    process: ['processTextarea']
  },
  password: {
    input_type: 'password',
    process: ['processPassword']
  },
  select: {
    input_type: 'select',
    process: ['processSelect']
  },
  checkboxes: {
    input_type: 'checkboxes',
    process: ['processCheckboxes']
  },
  radios: {
    input_type: 'radios',
    process: ['processRadios']
  },
  checkbox: {
    input_type: 'checkbox',
    process: ['processCheckbox']
  },
  hidden: {
    input_type: 'hidden',
    process: ['processHidden']
  },
  submit: {
    input_type: 'submit',
    process: ['processSubmit']
  },
  button: {
    input_type: 'button',
    process: ['processButton']
  },
  fieldset: {
    container: true,
    process: ['processFieldset']
  },
  details: {
    container: true,
    process: ['processDetails']
  },
  container: {
    container: true,
    process: ['processContainer']
  },
  item: {
    process: ['processItem']
  },
  markup: {
    process: ['processMarkup']
  },
  managed_file: {
    input_type: 'file',
    process: ['processManagedFile']
  },
  date: {
    input_type: 'date',
    process: ['processDate']
  },
  datetime: {
    input_type: 'datetime-local',
    process: ['processDateTime']
  },
  number: {
    input_type: 'number',
    process: ['processNumber']
  },
  email: {
    input_type: 'email',
    process: ['processEmail']
  },
  url: {
    input_type: 'url',
    process: ['processUrl']
  },
  tel: {
    input_type: 'tel',
    process: ['processTel']
  },
  color: {
    input_type: 'color',
    process: ['processColor']
  },
  range: {
    input_type: 'range',
    process: ['processRange']
  },
  tableselect: {
    process: ['processTableselect']
  },
  vertical_tabs: {
    container: true,
    process: ['processVerticalTabs']
  },
  weight: {
    input_type: 'select',
    process: ['processWeight']
  },
  machine_name: {
    input_type: 'text',
    process: ['processMachineName']
  },
  path: {
    input_type: 'text',
    process: ['processPath']
  },
  language_select: {
    input_type: 'select',
    process: ['processLanguageSelect']
  }
};

// Form storage (in-memory cache)
const formCache: Map<string, FormCacheEntry> = new Map();
const formTokens: Map<string, string> = new Map();

/**
 * Build a form structure.
 *
 * @param formId - Unique form identifier
 * @param formState - Current form state
 * @param args - Additional arguments passed to form builder
 * @returns Form render array
 */
export function buildForm(formId: string, formState?: FormState | null, ...args: unknown[]): FormElement {
  if (!formId || typeof formId !== 'string') {
    throw new Error('Form ID must be a non-empty string');
  }

  formState = formState || createFormState();
  formState.formId = formId;
  formState.buildInfo = formState.buildInfo || {};
  formState.buildInfo.args = args;

  // Generate form token for CSRF protection
  const formToken = generateFormToken(formId);
  formState.formToken = formToken;

  // Create base form array
  const form: FormElement = {
    '#type': 'form',
    '#id': formId,
    '#method': 'POST',
    '#action': '',
    '#attributes': {},
    '#tree': false,
    '#parents': [],
    '#form_id': formId,
    '#token': formToken
  };

  // Add CSRF token field
  form['form_token'] = {
    '#type': 'hidden',
    '#value': formToken,
    '#name': 'form_token'
  };

  form['form_id'] = {
    '#type': 'hidden',
    '#value': formId,
    '#name': 'form_id'
  };

  // Cache form
  formCache.set(formId, { form, formState, timestamp: Date.now() });

  return form;
}

/**
 * Process form submission from HTTP request.
 *
 * @param formId - Form identifier
 * @param request - HTTP request object with body
 * @returns Result object with status and data/errors
 */
export async function processForm(formId: string, request: FormRequest): Promise<FormProcessResult> {
  const cached = formCache.get(formId);
  if (!cached) {
    return { status: 'error', error: 'Form not found or expired' };
  }

  const { form, formState } = cached;
  const formValues = (request.body || {}) as Record<string, unknown>;

  // Validate CSRF token
  if (!validateFormToken(formId, formValues.form_token as string | undefined)) {
    return { status: 'error', error: 'Invalid form token' };
  }

  // Extract form values
  formState.values = extractFormValues(form, formValues);
  formState.input = formValues;

  // Execute validate handlers
  await executeHandlers('validate', form, formState);

  // Check for validation errors
  if (hasErrors(formState)) {
    return {
      status: 'invalid',
      errors: getErrors(formState),
      form: await rebuildForm(form, formState)
    };
  }

  // Execute submit handlers
  await executeHandlers('submit', form, formState);

  return {
    status: 'success',
    values: formState.values,
    redirect: formState.redirect || null
  };
}

/**
 * Validate form values.
 *
 * @param form - Form render array
 * @param formState - Form state object
 */
export function validateForm(form: FormElement, formState: FormState): void {
  // Validate required fields
  validateRequiredFields(form, formState);

  // Validate element-specific constraints
  validateElements(form, formState);

  // Execute custom validators
  if (form['#validate']) {
    for (const validator of form['#validate']) {
      if (typeof validator === 'function') {
        validator(form, formState);
      }
    }
  }
}

/**
 * Submit form after successful validation.
 *
 * @param form - Form render array
 * @param formState - Form state object
 */
export function submitForm(form: FormElement, formState: FormState): void {
  if (form['#submit']) {
    for (const handler of form['#submit']) {
      if (typeof handler === 'function') {
        handler(form, formState);
      }
    }
  }
}

/**
 * Render form to HTML.
 *
 * @param form - Form render array
 * @returns HTML string
 */
export function renderForm(form: FormElement): string {
  const processedForm = processFormElements(form, createFormState());
  return renderElement(processedForm);
}

/**
 * Set validation error on an element.
 *
 * @param formState - Form state object
 * @param element - Form element
 * @param message - Error message
 */
export function setError(formState: FormState, element: FormElement, message: string): void {
  formState.errors = formState.errors || [];
  const name = (element['#name'] || element['#id'] || 'unknown') as string;
  formState.errors.push({ name, message, element });
}

/**
 * Set validation error by element name.
 *
 * @param formState - Form state object
 * @param name - Element name
 * @param message - Error message
 */
export function setErrorByName(formState: FormState, name: string, message: string): void {
  formState.errors = formState.errors || [];
  formState.errors.push({ name, message, element: null });
}

/**
 * Get all validation errors.
 *
 * @param formState - Form state object
 * @returns Array of error objects
 */
export function getErrors(formState: FormState): FormError[] {
  return formState.errors || [];
}

/**
 * Check if form has validation errors.
 *
 * @param formState - Form state object
 * @returns True if errors exist
 */
export function hasErrors(formState: FormState): boolean {
  return formState.errors && formState.errors.length > 0;
}

/**
 * Execute form handlers (validate or submit).
 *
 * @param type - Handler type ('validate' or 'submit')
 * @param form - Form render array
 * @param formState - Form state object
 */
export async function executeHandlers(type: string, form: FormElement, formState: FormState): Promise<void> {
  const handlerKey = `#${type}` as keyof FormElement;

  // Execute form-level handlers
  const handlers = form[handlerKey];
  if (Array.isArray(handlers)) {
    for (const handler of handlers) {
      if (typeof handler === 'function') {
        await (handler as (f: FormElement, s: FormState) => void | Promise<void>)(form, formState);
      } else if (typeof handler === 'string') {
        // Named handler - would lookup from registry
        console.warn(`Named handler not implemented: ${handler}`);
      }
    }
  }

  // Execute element-level handlers recursively
  await executeElementHandlers(type, form, formState);
}

/**
 * Process a single form element.
 *
 * @param element - Form element
 * @param formState - Form state object
 * @returns Processed element
 */
export function processElement(element: FormElement, formState: FormState): FormElement {
  if (!element || typeof element !== 'object') {
    return element;
  }

  const type = element['#type'] as string | undefined;
  if (!type) {
    return element;
  }

  const elementType = ELEMENT_TYPES[type];
  if (!elementType) {
    throw new Error(`Unknown form element type: ${type}`);
  }

  // Execute process callbacks
  if (elementType.process) {
    for (const processCallback of elementType.process) {
      const processor = PROCESSORS[processCallback];
      if (typeof processor === 'function') {
        element = processor(element, formState);
      }
    }
  }

  // Process children recursively
  for (const key in element) {
    if (key.startsWith('#') || typeof element[key] !== 'object') {
      continue;
    }
    element[key] = processElement(element[key] as FormElement, formState);
  }

  return element;
}

/**
 * Prepare element for rendering.
 *
 * @param element - Form element
 * @returns Prepared element
 */
export function prepareElement(element: FormElement): FormElement {
  if (!element || typeof element !== 'object') {
    return element;
  }

  // Set defaults
  element['#id'] = element['#id'] || generateElementId(element);
  element['#name'] = element['#name'] || element['#id'];
  element['#attributes'] = element['#attributes'] || {};
  element['#title_display'] = element['#title_display'] || 'before';

  // Process conditional states
  if (element['#states']) {
    processStates(element);
  }

  // Process AJAX
  if (element['#ajax']) {
    processAjax(element);
  }

  return element;
}

/**
 * Render element to HTML.
 *
 * @param element - Form element
 * @returns HTML string
 */
export function renderElement(element: FormElement): string {
  if (!element || typeof element !== 'object') {
    return String(element || '');
  }

  const type = element['#type'] as string | undefined;
  // `RENDERERS.default` is always defined at module load (see definition below),
  // but tsc widens Record<string, …> access to include `undefined`.
  // The `!` is a type-only assertion; the value is known-safe at runtime.
  const renderer = (type && RENDERERS[type]) || RENDERERS.default!;

  return renderer(element);
}

// Element processors
const PROCESSORS: Record<string, (element: FormElement, formState: FormState) => FormElement> = {
  processTextfield(element: FormElement, _formState: FormState): FormElement {
    element['#attributes'] = element['#attributes'] || {};
    element['#attributes'].type = 'text';

    if (element['#maxlength']) {
      element['#attributes'].maxlength = element['#maxlength'];
    }
    if (element['#size']) {
      element['#attributes'].size = element['#size'];
    }
    if (element['#placeholder']) {
      element['#attributes'].placeholder = element['#placeholder'];
    }
    if (element['#autocomplete']) {
      element['#attributes'].autocomplete = element['#autocomplete'];
    }

    return element;
  },

  processTextarea(element: FormElement, _formState: FormState): FormElement {
    element['#attributes'] = element['#attributes'] || {};

    if (element['#rows']) {
      element['#attributes'].rows = element['#rows'];
    }
    if (element['#cols']) {
      element['#attributes'].cols = element['#cols'];
    }
    if (element['#placeholder']) {
      element['#attributes'].placeholder = element['#placeholder'];
    }

    return element;
  },

  processPassword(element: FormElement, _formState: FormState): FormElement {
    element['#attributes'] = element['#attributes'] || {};
    element['#attributes'].type = 'password';

    if (element['#maxlength']) {
      element['#attributes'].maxlength = element['#maxlength'];
    }

    return element;
  },

  processSelect(element: FormElement, _formState: FormState): FormElement {
    element['#options'] = element['#options'] || {};

    if (element['#multiple']) {
      element['#attributes'] = element['#attributes'] || {};
      element['#attributes'].multiple = true;
    }

    if (element['#size']) {
      element['#attributes'] = element['#attributes'] || {};
      element['#attributes'].size = element['#size'];
    }

    return element;
  },

  processCheckboxes(element: FormElement, _formState: FormState): FormElement {
    element['#options'] = element['#options'] || {};
    element['#tree'] = true;
    return element;
  },

  processRadios(element: FormElement, _formState: FormState): FormElement {
    element['#options'] = element['#options'] || {};
    return element;
  },

  processCheckbox(element: FormElement, _formState: FormState): FormElement {
    element['#attributes'] = element['#attributes'] || {};
    element['#attributes'].type = 'checkbox';

    if (element['#return_value']) {
      element['#attributes'].value = element['#return_value'];
    } else {
      element['#attributes'].value = '1';
    }

    return element;
  },

  processHidden(element: FormElement, _formState: FormState): FormElement {
    element['#attributes'] = element['#attributes'] || {};
    element['#attributes'].type = 'hidden';
    return element;
  },

  processSubmit(element: FormElement, _formState: FormState): FormElement {
    element['#attributes'] = element['#attributes'] || {};
    element['#attributes'].type = 'submit';
    element['#button_type'] = element['#button_type'] || 'primary';
    return element;
  },

  processButton(element: FormElement, _formState: FormState): FormElement {
    element['#attributes'] = element['#attributes'] || {};
    element['#attributes'].type = 'button';
    return element;
  },

  processFieldset(element: FormElement, _formState: FormState): FormElement {
    element['#collapsible'] = element['#collapsible'] || false;
    element['#collapsed'] = element['#collapsed'] || false;
    return element;
  },

  processDetails(element: FormElement, _formState: FormState): FormElement {
    element['#open'] = element['#open'] !== false;
    return element;
  },

  processContainer(element: FormElement, _formState: FormState): FormElement {
    return element;
  },

  processItem(element: FormElement, _formState: FormState): FormElement {
    return element;
  },

  processMarkup(element: FormElement, _formState: FormState): FormElement {
    return element;
  },

  processManagedFile(element: FormElement, _formState: FormState): FormElement {
    element['#attributes'] = element['#attributes'] || {};
    element['#attributes'].type = 'file';

    if (element['#upload_validators']) {
      // Process upload validators
      const validators = element['#upload_validators'] as Record<string, unknown[]>;

      if (validators.file_validate_extensions) {
        const extensions = validators.file_validate_extensions[0] as string;
        element['#attributes'].accept = extensions
          .split(' ')
          .map((ext: string) => `.${ext}`)
          .join(',');
      }

      if (validators.file_validate_size) {
        // Store for server-side validation
        element['#max_filesize'] = validators.file_validate_size[0];
      }
    }

    if (element['#multiple']) {
      element['#attributes'].multiple = true;
    }

    return element;
  },

  processDate(element: FormElement, _formState: FormState): FormElement {
    element['#attributes'] = element['#attributes'] || {};
    element['#attributes'].type = 'date';

    if (element['#min']) {
      element['#attributes'].min = element['#min'];
    }
    if (element['#max']) {
      element['#attributes'].max = element['#max'];
    }

    return element;
  },

  processDateTime(element: FormElement, _formState: FormState): FormElement {
    element['#attributes'] = element['#attributes'] || {};
    element['#attributes'].type = 'datetime-local';

    if (element['#min']) {
      element['#attributes'].min = element['#min'];
    }
    if (element['#max']) {
      element['#attributes'].max = element['#max'];
    }

    return element;
  },

  processNumber(element: FormElement, _formState: FormState): FormElement {
    element['#attributes'] = element['#attributes'] || {};
    element['#attributes'].type = 'number';

    if (element['#min'] !== undefined) {
      element['#attributes'].min = element['#min'];
    }
    if (element['#max'] !== undefined) {
      element['#attributes'].max = element['#max'];
    }
    if (element['#step']) {
      element['#attributes'].step = element['#step'];
    }

    return element;
  },

  processEmail(element: FormElement, _formState: FormState): FormElement {
    element['#attributes'] = element['#attributes'] || {};
    element['#attributes'].type = 'email';
    return element;
  },

  processUrl(element: FormElement, _formState: FormState): FormElement {
    element['#attributes'] = element['#attributes'] || {};
    element['#attributes'].type = 'url';
    return element;
  },

  processTel(element: FormElement, _formState: FormState): FormElement {
    element['#attributes'] = element['#attributes'] || {};
    element['#attributes'].type = 'tel';
    return element;
  },

  processColor(element: FormElement, _formState: FormState): FormElement {
    element['#attributes'] = element['#attributes'] || {};
    element['#attributes'].type = 'color';
    return element;
  },

  processRange(element: FormElement, _formState: FormState): FormElement {
    element['#attributes'] = element['#attributes'] || {};
    element['#attributes'].type = 'range';

    if (element['#min'] !== undefined) {
      element['#attributes'].min = element['#min'];
    }
    if (element['#max'] !== undefined) {
      element['#attributes'].max = element['#max'];
    }
    if (element['#step']) {
      element['#attributes'].step = element['#step'];
    }

    return element;
  },

  processTableselect(element: FormElement, _formState: FormState): FormElement {
    element['#header'] = element['#header'] || [];
    element['#options'] = element['#options'] || {};
    element['#multiple'] = element['#multiple'] !== false;
    return element;
  },

  processVerticalTabs(element: FormElement, _formState: FormState): FormElement {
    return element;
  },

  processWeight(element: FormElement, _formState: FormState): FormElement {
    element['#delta'] = element['#delta'] || 10;
    element['#options'] = {} as Record<string, string>;

    const delta = element['#delta'] as number;
    for (let i = -delta; i <= delta; i++) {
      (element['#options'] as Record<string, string>)[String(i)] = String(i);
    }

    return element;
  },

  processMachineName(element: FormElement, _formState: FormState): FormElement {
    element['#attributes'] = element['#attributes'] || {};
    element['#attributes'].type = 'text';
    element['#pattern'] = element['#pattern'] || '^[a-z0-9_]+$';

    if (element['#machine_name']) {
      const config = element['#machine_name'] as { source?: string; maxlength?: number };
      element['#source_field'] = config.source;
      element['#maxlength'] = config.maxlength || 64;
    }

    return element;
  },

  processPath(element: FormElement, _formState: FormState): FormElement {
    element['#attributes'] = element['#attributes'] || {};
    element['#attributes'].type = 'text';
    element['#pattern'] = element['#pattern'] || '^[a-zA-Z0-9/_-]+$';
    return element;
  },

  processLanguageSelect(element: FormElement, _formState: FormState): FormElement {
    element['#options'] = element['#options'] || {
      'en': 'English',
      'es': 'Spanish',
      'fr': 'French',
      'de': 'German',
      'it': 'Italian',
      'pt': 'Portuguese',
      'ru': 'Russian',
      'zh': 'Chinese',
      'ja': 'Japanese',
      'ar': 'Arabic'
    };
    return element;
  }
};

// Element renderers
const RENDERERS: Record<string, (element: FormElement) => string> = {
  form(element: FormElement): string {
    const attrs = renderAttributes({
      id: element['#id'],
      method: element['#method'] || 'POST',
      action: element['#action'] || '',
      ...element['#attributes']
    });

    const children = renderChildren(element);

    return `<form${attrs}>\n${children}\n</form>`;
  },

  textfield(element: FormElement): string {
    return renderInput(element);
  },

  textarea(element: FormElement): string {
    const attrs = renderAttributes({
      id: element['#id'],
      name: element['#name'],
      ...element['#attributes']
    });

    const value = escapeHtml(String(element['#value'] || element['#default_value'] || ''));

    return wrapWithLabel(element, `<textarea${attrs}>${value}</textarea>`);
  },

  password(element: FormElement): string {
    return renderInput(element);
  },

  select(element: FormElement): string {
    const attrs = renderAttributes({
      id: element['#id'],
      name: element['#name'],
      ...element['#attributes']
    });

    const options = renderOptions(
      (element['#options'] || {}) as Record<string, string>,
      element['#value'] || element['#default_value']
    );

    return wrapWithLabel(element, `<select${attrs}>${options}</select>`);
  },

  checkboxes(element: FormElement): string {
    const items: string[] = [];
    const selectedValues = (element['#value'] || element['#default_value'] || []) as string[];

    for (const [key, label] of Object.entries((element['#options'] || {}) as Record<string, string>)) {
      const checked = selectedValues.includes(key) ? ' checked' : '';
      const id = `${element['#id'] as string}-${key}`;

      items.push(
        `<div class="form-checkbox">` +
        `<input type="checkbox" id="${id}" name="${element['#name'] as string}[${key}]" value="${escapeHtml(key)}"${checked}>` +
        `<label for="${id}">${escapeHtml(label)}</label>` +
        `</div>`
      );
    }

    return wrapWithLabel(element, items.join('\n'), false);
  },

  radios(element: FormElement): string {
    const items: string[] = [];
    const selectedValue = element['#value'] || element['#default_value'];

    for (const [key, label] of Object.entries((element['#options'] || {}) as Record<string, string>)) {
      const checked = selectedValue === key ? ' checked' : '';
      const id = `${element['#id'] as string}-${key}`;

      items.push(
        `<div class="form-radio">` +
        `<input type="radio" id="${id}" name="${element['#name'] as string}" value="${escapeHtml(key)}"${checked}>` +
        `<label for="${id}">${escapeHtml(label)}</label>` +
        `</div>`
      );
    }

    return wrapWithLabel(element, items.join('\n'), false);
  },

  checkbox(element: FormElement): string {
    const checked = element['#value'] || element['#default_value'] ? ' checked' : '';
    const attrs = renderAttributes({
      id: element['#id'],
      name: element['#name'],
      ...element['#attributes']
    });

    return wrapWithLabel(
      element,
      `<input${attrs}${checked}>`,
      true,
      'after'
    );
  },

  hidden(element: FormElement): string {
    const attrs = renderAttributes({
      type: 'hidden',
      id: element['#id'],
      name: element['#name'],
      value: String(element['#value'] || element['#default_value'] || ''),
      ...element['#attributes']
    });

    return `<input${attrs}>`;
  },

  submit(element: FormElement): string {
    const attrs = renderAttributes({
      type: 'submit',
      id: element['#id'],
      name: element['#name'] || 'submit',
      value: String(element['#value'] || 'Submit'),
      class: `button button-${element['#button_type'] || 'primary'}`,
      ...element['#attributes']
    });

    return `<button${attrs}>${escapeHtml(String(element['#value'] || 'Submit'))}</button>`;
  },

  button(element: FormElement): string {
    const attrs = renderAttributes({
      type: 'button',
      id: element['#id'],
      name: element['#name'],
      class: 'button',
      ...element['#attributes']
    });

    return `<button${attrs}>${escapeHtml(String(element['#value'] || 'Button'))}</button>`;
  },

  fieldset(element: FormElement): string {
    const attrs = renderAttributes(element['#attributes'] || {});
    const legend = element['#title'] ? `<legend>${escapeHtml(element['#title'] as string)}</legend>` : '';
    const description = element['#description'] ? `<div class="description">${escapeHtml(element['#description'] as string)}</div>` : '';
    const children = renderChildren(element);

    return `<fieldset${attrs}>\n${legend}${description}\n${children}\n</fieldset>`;
  },

  details(element: FormElement): string {
    const attrs = renderAttributes({
      open: element['#open'],
      ...element['#attributes']
    });
    const summary = element['#title'] ? `<summary>${escapeHtml(element['#title'] as string)}</summary>` : '';
    const description = element['#description'] ? `<div class="description">${escapeHtml(element['#description'] as string)}</div>` : '';
    const children = renderChildren(element);

    return `<details${attrs}>\n${summary}${description}\n${children}\n</details>`;
  },

  container(element: FormElement): string {
    const attrs = renderAttributes(element['#attributes'] || {});
    const children = renderChildren(element);

    return `<div${attrs}>\n${children}\n</div>`;
  },

  item(element: FormElement): string {
    const markup = (element['#markup'] || '') as string;
    return wrapWithLabel(element, markup, false);
  },

  markup(element: FormElement): string {
    return (element['#markup'] || '') as string;
  },

  managed_file(element: FormElement): string {
    return renderInput(element);
  },

  date(element: FormElement): string {
    return renderInput(element);
  },

  datetime(element: FormElement): string {
    return renderInput(element);
  },

  number(element: FormElement): string {
    return renderInput(element);
  },

  email(element: FormElement): string {
    return renderInput(element);
  },

  url(element: FormElement): string {
    return renderInput(element);
  },

  tel(element: FormElement): string {
    return renderInput(element);
  },

  color(element: FormElement): string {
    return renderInput(element);
  },

  range(element: FormElement): string {
    return renderInput(element);
  },

  tableselect(element: FormElement): string {
    const header = (element['#header'] || []) as string[];
    // Tableselect narrows the generic `#options: Record<string,string>` shape
    // (declared on FormElement) to per-row cell arrays. Cast via `unknown`
    // since the base and narrowed types do not structurally overlap.
    const options = (element['#options'] || {}) as unknown as Record<string, string[]>;
    const selectedValues = (element['#value'] || element['#default_value'] || []) as string | string[];

    let html = '<table class="tableselect">';
    html += '<thead><tr>';

    if (element['#multiple']) {
      html += '<th class="select-all"></th>';
    }

    for (const col of header) {
      html += `<th>${escapeHtml(col)}</th>`;
    }

    html += '</tr></thead><tbody>';

    for (const [key, row] of Object.entries(options)) {
      html += '<tr>';

      if (element['#multiple']) {
        const checked = Array.isArray(selectedValues) && selectedValues.includes(key) ? ' checked' : '';
        html += `<td><input type="checkbox" name="${element['#name'] as string}[${key}]" value="${escapeHtml(key)}"${checked}></td>`;
      } else {
        const checked = selectedValues === key ? ' checked' : '';
        html += `<td><input type="radio" name="${element['#name'] as string}" value="${escapeHtml(key)}"${checked}></td>`;
      }

      for (const cell of row) {
        html += `<td>${escapeHtml(cell)}</td>`;
      }

      html += '</tr>';
    }

    html += '</tbody></table>';

    return wrapWithLabel(element, html, false);
  },

  vertical_tabs(element: FormElement): string {
    const children = renderChildren(element);
    return `<div class="vertical-tabs">\n${children}\n</div>`;
  },

  weight(element: FormElement): string {
    // `RENDERERS.select` is defined at module load; `!` is a type-only assertion.
    return RENDERERS.select!(element);
  },

  machine_name(element: FormElement): string {
    return renderInput(element);
  },

  path(element: FormElement): string {
    return renderInput(element);
  },

  language_select(element: FormElement): string {
    // `RENDERERS.select` is defined at module load; `!` is a type-only assertion.
    return RENDERERS.select!(element);
  },

  default(element: FormElement): string {
    return renderChildren(element);
  }
};

// Helper functions

function createFormState(): FormState {
  return {
    values: {},
    input: {},
    errors: [],
    storage: {},
    rebuild: false,
    redirect: null,
    cached: false,
    buildInfo: {}
  };
}

function generateFormToken(formId: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  formTokens.set(formId, token);
  return token;
}

function validateFormToken(formId: string, token: string | undefined): boolean {
  const storedToken = formTokens.get(formId);
  return !!storedToken && storedToken === token;
}

function extractFormValues(form: FormElement, input: Record<string, unknown>): Record<string, unknown> {
  const values: Record<string, unknown> = {};

  for (const key in form) {
    if (key.startsWith('#')) {
      continue;
    }

    const element = form[key] as FormElement | null;
    if (!element || typeof element !== 'object') {
      continue;
    }

    const name = (element['#name'] || key) as string;

    if (element['#tree']) {
      values[key] = extractTreeValues(element, (input[name] || {}) as Record<string, unknown>);
    } else if (name in input) {
      values[key] = input[name];
    } else if (element['#default_value'] !== undefined) {
      values[key] = element['#default_value'];
    }

    // Recursively extract from containers
    const type = element['#type'] as string | undefined;
    if (type && ELEMENT_TYPES[type] && ELEMENT_TYPES[type]!.container) {
      Object.assign(values, extractFormValues(element, input));
    }
  }

  return values;
}

function extractTreeValues(element: FormElement, input: Record<string, unknown>): Record<string, unknown> {
  const values: Record<string, unknown> = {};

  for (const key in element) {
    if (key.startsWith('#')) {
      continue;
    }

    if (key in input) {
      values[key] = input[key];
    }
  }

  return values;
}

function validateRequiredFields(form: FormElement, formState: FormState): void {
  for (const key in form) {
    if (key.startsWith('#')) {
      continue;
    }

    const element = form[key] as FormElement | null;
    if (!element || typeof element !== 'object') {
      continue;
    }

    if (element['#required']) {
      const value = formState.values[key];

      if (value === undefined || value === null || value === '') {
        setError(formState, element, `${(element['#title'] || key) as string} is required.`);
      }
    }

    // Recursively validate containers
    const type = element['#type'] as string | undefined;
    if (type && ELEMENT_TYPES[type] && ELEMENT_TYPES[type]!.container) {
      validateRequiredFields(element, formState);
    }
  }
}

function validateElements(form: FormElement, formState: FormState): void {
  for (const key in form) {
    if (key.startsWith('#')) {
      continue;
    }

    const element = form[key] as FormElement | null;
    if (!element || typeof element !== 'object') {
      continue;
    }

    const value = formState.values[key] as string | undefined;
    const type = element['#type'] as string | undefined;

    // Type-specific validation
    if (type === 'email' && value) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        setError(formState, element, `${(element['#title'] || key) as string} must be a valid email address.`);
      }
    }

    if (type === 'url' && value) {
      try {
        new URL(value);
      } catch {
        setError(formState, element, `${(element['#title'] || key) as string} must be a valid URL.`);
      }
    }

    if (type === 'number' && value !== undefined && value !== '') {
      const num = Number(value);

      if (isNaN(num)) {
        setError(formState, element, `${(element['#title'] || key) as string} must be a number.`);
      } else {
        if (element['#min'] !== undefined && num < (element['#min'] as number)) {
          setError(formState, element, `${(element['#title'] || key) as string} must be at least ${element['#min']}.`);
        }
        if (element['#max'] !== undefined && num > (element['#max'] as number)) {
          setError(formState, element, `${(element['#title'] || key) as string} must be at most ${element['#max']}.`);
        }
      }
    }

    // Pattern validation
    if (element['#pattern'] && value) {
      const regex = new RegExp(element['#pattern'] as string);
      if (!regex.test(value)) {
        const message = (element['#pattern_error'] || `${(element['#title'] || key) as string} format is invalid.`) as string;
        setError(formState, element, message);
      }
    }

    // Recursively validate containers
    if (type && ELEMENT_TYPES[type] && ELEMENT_TYPES[type]!.container) {
      validateElements(element, formState);
    }
  }
}

async function executeElementHandlers(type: string, form: FormElement, formState: FormState): Promise<void> {
  for (const key in form) {
    if (key.startsWith('#')) {
      continue;
    }

    const element = form[key] as FormElement | null;
    if (!element || typeof element !== 'object') {
      continue;
    }

    const handlerKey = `#${type}`;
    const handlers = element[handlerKey];
    if (Array.isArray(handlers)) {
      for (const handler of handlers) {
        if (typeof handler === 'function') {
          await (handler as (el: FormElement, s: FormState) => void | Promise<void>)(element, formState);
        }
      }
    }

    // Recursively execute handlers
    const elementType = element['#type'] as string | undefined;
    if (elementType && ELEMENT_TYPES[elementType] && ELEMENT_TYPES[elementType]!.container) {
      await executeElementHandlers(type, element, formState);
    }
  }
}

function processFormElements(form: FormElement, formState: FormState): FormElement {
  const processed: FormElement = { ...form };

  for (const key in processed) {
    if (key.startsWith('#')) {
      continue;
    }

    if (typeof processed[key] === 'object' && processed[key] !== null) {
      processed[key] = processElement(processed[key] as FormElement, formState);
      processed[key] = prepareElement(processed[key] as FormElement);
    }
  }

  return processed;
}

async function rebuildForm(form: FormElement, formState: FormState): Promise<FormElement> {
  formState.rebuild = true;
  const rebuilt = processFormElements(form, formState);

  // Attach error messages
  for (const error of getErrors(formState)) {
    if (error.name && rebuilt[error.name]) {
      (rebuilt[error.name] as FormElement)['#error'] = error.message;
    }
  }

  return rebuilt;
}

function processStates(element: FormElement): void {
  const states = element['#states'];
  element['#attributes'] = element['#attributes'] || {};
  element['#attributes']['data-states'] = JSON.stringify(states);
}

function processAjax(element: FormElement): void {
  const ajax = element['#ajax'];
  element['#attributes'] = element['#attributes'] || {};
  element['#attributes']['data-ajax'] = JSON.stringify(ajax);
}

function generateElementId(element: FormElement): string {
  const name = (element['#name'] || 'element') as string;
  return `edit-${name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`;
}

function renderInput(element: FormElement): string {
  const attrs = renderAttributes({
    type: (element['#attributes'] as FormAttributes | undefined)?.type || 'text',
    id: element['#id'],
    name: element['#name'],
    value: String(element['#value'] || element['#default_value'] || ''),
    ...element['#attributes']
  });

  return wrapWithLabel(element, `<input${attrs}>`);
}

function renderAttributes(attrs: Record<string, unknown>): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) {
      continue;
    }

    if (value === true) {
      parts.push(key);
    } else {
      parts.push(`${key}="${escapeHtml(String(value))}"`);
    }
  }

  return parts.length > 0 ? ' ' + parts.join(' ') : '';
}

function renderOptions(options: Record<string, string>, selectedValue: unknown): string {
  const items: string[] = [];

  for (const [key, label] of Object.entries(options)) {
    const selected = key === selectedValue ? ' selected' : '';
    items.push(`<option value="${escapeHtml(key)}"${selected}>${escapeHtml(label)}</option>`);
  }

  return items.join('\n');
}

function renderChildren(element: FormElement): string {
  const children: string[] = [];

  for (const key in element) {
    if (key.startsWith('#')) {
      continue;
    }

    if (typeof element[key] === 'object' && element[key] !== null) {
      children.push(renderElement(element[key] as FormElement));
    }
  }

  return children.join('\n');
}

function wrapWithLabel(element: FormElement, input: string, inline: boolean = true, position: string | null = null): string {
  const titleDisplay = position || (element['#title_display'] || 'before') as string;
  const title = element['#title'] as string | undefined;
  const description = element['#description'] as string | undefined;
  const error = element['#error'] as string | undefined;

  let html = '';

  if (titleDisplay === 'before' && title) {
    html += `<label for="${element['#id'] as string}">${escapeHtml(title)}</label>\n`;
  }

  if (error) {
    html += `<div class="error">${escapeHtml(error)}</div>\n`;
  }

  html += input;

  if (titleDisplay === 'after' && title) {
    html += `\n<label for="${element['#id'] as string}">${escapeHtml(title)}</label>`;
  }

  if (description) {
    html += `\n<div class="description">${escapeHtml(description)}</div>`;
  }

  if (!inline && titleDisplay !== 'none') {
    html = `<div class="form-item">\n${html}\n</div>`;
  }

  return html;
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };

  return String(text).replace(/[&<>"']/g, (char: string) => map[char] ?? char);
}

export default {
  buildForm,
  processForm,
  validateForm,
  submitForm,
  renderForm,
  setError,
  setErrorByName,
  getErrors,
  hasErrors,
  executeHandlers,
  processElement,
  prepareElement,
  renderElement,
  ELEMENT_TYPES
};
