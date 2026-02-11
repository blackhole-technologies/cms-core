/**
 * Form API - Drupal-Style Form Builder
 *
 * @version 1.0.0
 *
 * Provides programmatic form building, validation, and processing
 * with support for AJAX, conditional states, and file uploads.
 */

import crypto from 'node:crypto';

// Form element type registry
const ELEMENT_TYPES = {
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
  },
  icon_autocomplete: {
    input_type: 'text',
    process: ['processIconAutocomplete']
  }
};

// Form storage (in-memory cache)
const formCache = new Map();
const formTokens = new Map();

/**
 * Build a form structure.
 *
 * @param {string} formId - Unique form identifier
 * @param {Object} formState - Current form state
 * @param {...*} args - Additional arguments passed to form builder
 * @returns {Object} Form render array
 */
export function buildForm(formId, formState, ...args) {
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
  const form = {
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
 * @param {string} formId - Form identifier
 * @param {Object} request - HTTP request object with body
 * @returns {Object} Result object with status and data/errors
 */
export async function processForm(formId, request) {
  const cached = formCache.get(formId);
  if (!cached) {
    return { status: 'error', error: 'Form not found or expired' };
  }

  const { form, formState } = cached;
  const formValues = request.body || {};

  // Validate CSRF token
  if (!validateFormToken(formId, formValues.form_token)) {
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
 * @param {Object} form - Form render array
 * @param {Object} formState - Form state object
 */
export function validateForm(form, formState) {
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
 * @param {Object} form - Form render array
 * @param {Object} formState - Form state object
 */
export function submitForm(form, formState) {
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
 * @param {Object} form - Form render array
 * @returns {string} HTML string
 */
export function renderForm(form) {
  const processedForm = processFormElements(form, {});
  return renderElement(processedForm);
}

/**
 * Set validation error on an element.
 *
 * @param {Object} formState - Form state object
 * @param {Object} element - Form element
 * @param {string} message - Error message
 */
export function setError(formState, element, message) {
  formState.errors = formState.errors || [];
  const name = element['#name'] || element['#id'] || 'unknown';
  formState.errors.push({ name, message, element });
}

/**
 * Set validation error by element name.
 *
 * @param {Object} formState - Form state object
 * @param {string} name - Element name
 * @param {string} message - Error message
 */
export function setErrorByName(formState, name, message) {
  formState.errors = formState.errors || [];
  formState.errors.push({ name, message, element: null });
}

/**
 * Get all validation errors.
 *
 * @param {Object} formState - Form state object
 * @returns {Array} Array of error objects
 */
export function getErrors(formState) {
  return formState.errors || [];
}

/**
 * Check if form has validation errors.
 *
 * @param {Object} formState - Form state object
 * @returns {boolean} True if errors exist
 */
export function hasErrors(formState) {
  return formState.errors && formState.errors.length > 0;
}

/**
 * Execute form handlers (validate or submit).
 *
 * @param {string} type - Handler type ('validate' or 'submit')
 * @param {Object} form - Form render array
 * @param {Object} formState - Form state object
 */
export async function executeHandlers(type, form, formState) {
  const handlerKey = `#${type}`;

  // Execute form-level handlers
  if (form[handlerKey]) {
    for (const handler of form[handlerKey]) {
      if (typeof handler === 'function') {
        await handler(form, formState);
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
 * @param {Object} element - Form element
 * @param {Object} formState - Form state object
 * @returns {Object} Processed element
 */
export function processElement(element, formState) {
  if (!element || typeof element !== 'object') {
    return element;
  }

  const type = element['#type'];
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
      if (typeof PROCESSORS[processCallback] === 'function') {
        element = PROCESSORS[processCallback](element, formState);
      }
    }
  }

  // Process children recursively
  for (const key in element) {
    if (key.startsWith('#') || typeof element[key] !== 'object') {
      continue;
    }
    element[key] = processElement(element[key], formState);
  }

  return element;
}

/**
 * Prepare element for rendering.
 *
 * @param {Object} element - Form element
 * @returns {Object} Prepared element
 */
export function prepareElement(element) {
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
 * @param {Object} element - Form element
 * @returns {string} HTML string
 */
export function renderElement(element) {
  if (!element || typeof element !== 'object') {
    return String(element || '');
  }

  const type = element['#type'];
  const renderer = RENDERERS[type] || RENDERERS.default;

  return renderer(element);
}

// Element processors
const PROCESSORS = {
  processTextfield(element, formState) {
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

  processTextarea(element, formState) {
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

  processPassword(element, formState) {
    element['#attributes'] = element['#attributes'] || {};
    element['#attributes'].type = 'password';

    if (element['#maxlength']) {
      element['#attributes'].maxlength = element['#maxlength'];
    }

    return element;
  },

  processSelect(element, formState) {
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

  processCheckboxes(element, formState) {
    element['#options'] = element['#options'] || {};
    element['#tree'] = true;
    return element;
  },

  processRadios(element, formState) {
    element['#options'] = element['#options'] || {};
    return element;
  },

  processCheckbox(element, formState) {
    element['#attributes'] = element['#attributes'] || {};
    element['#attributes'].type = 'checkbox';

    if (element['#return_value']) {
      element['#attributes'].value = element['#return_value'];
    } else {
      element['#attributes'].value = '1';
    }

    return element;
  },

  processHidden(element, formState) {
    element['#attributes'] = element['#attributes'] || {};
    element['#attributes'].type = 'hidden';
    return element;
  },

  processSubmit(element, formState) {
    element['#attributes'] = element['#attributes'] || {};
    element['#attributes'].type = 'submit';
    element['#button_type'] = element['#button_type'] || 'primary';
    return element;
  },

  processButton(element, formState) {
    element['#attributes'] = element['#attributes'] || {};
    element['#attributes'].type = 'button';
    return element;
  },

  processFieldset(element, formState) {
    element['#collapsible'] = element['#collapsible'] || false;
    element['#collapsed'] = element['#collapsed'] || false;
    return element;
  },

  processDetails(element, formState) {
    element['#open'] = element['#open'] !== false;
    return element;
  },

  processContainer(element, formState) {
    return element;
  },

  processItem(element, formState) {
    return element;
  },

  processMarkup(element, formState) {
    return element;
  },

  processManagedFile(element, formState) {
    element['#attributes'] = element['#attributes'] || {};
    element['#attributes'].type = 'file';

    if (element['#upload_validators']) {
      // Process upload validators
      const validators = element['#upload_validators'];

      if (validators.file_validate_extensions) {
        const extensions = validators.file_validate_extensions[0];
        element['#attributes'].accept = extensions
          .split(' ')
          .map(ext => `.${ext}`)
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

  processDate(element, formState) {
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

  processDateTime(element, formState) {
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

  processNumber(element, formState) {
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

  processEmail(element, formState) {
    element['#attributes'] = element['#attributes'] || {};
    element['#attributes'].type = 'email';
    return element;
  },

  processUrl(element, formState) {
    element['#attributes'] = element['#attributes'] || {};
    element['#attributes'].type = 'url';
    return element;
  },

  processTel(element, formState) {
    element['#attributes'] = element['#attributes'] || {};
    element['#attributes'].type = 'tel';
    return element;
  },

  processColor(element, formState) {
    element['#attributes'] = element['#attributes'] || {};
    element['#attributes'].type = 'color';
    return element;
  },

  processRange(element, formState) {
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

  processTableselect(element, formState) {
    element['#header'] = element['#header'] || [];
    element['#options'] = element['#options'] || {};
    element['#multiple'] = element['#multiple'] !== false;
    return element;
  },

  processVerticalTabs(element, formState) {
    return element;
  },

  processWeight(element, formState) {
    element['#delta'] = element['#delta'] || 10;
    element['#options'] = {};

    for (let i = -element['#delta']; i <= element['#delta']; i++) {
      element['#options'][i] = String(i);
    }

    return element;
  },

  processMachineName(element, formState) {
    element['#attributes'] = element['#attributes'] || {};
    element['#attributes'].type = 'text';
    element['#pattern'] = element['#pattern'] || '^[a-z0-9_]+$';

    if (element['#machine_name']) {
      const config = element['#machine_name'];
      element['#source_field'] = config.source;
      element['#maxlength'] = config.maxlength || 64;
    }

    return element;
  },

  processPath(element, formState) {
    element['#attributes'] = element['#attributes'] || {};
    element['#attributes'].type = 'text';
    element['#pattern'] = element['#pattern'] || '^[a-zA-Z0-9/_-]+$';
    return element;
  },

  processLanguageSelect(element, formState) {
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
  },

  processIconAutocomplete(element, formState) {
    element['#attributes'] = element['#attributes'] || {};
    element['#attributes'].type = 'text';
    element['#attributes'].class = element['#attributes'].class || '';
    element['#attributes'].class += ' icon-autocomplete';
    element['#attributes']['data-icon-pack'] = element['#icon_pack'] || '';
    element['#attributes']['data-show-preview'] = element['#show_preview'] !== false;

    if (element['#placeholder']) {
      element['#attributes'].placeholder = element['#placeholder'];
    }

    return element;
  }
};

// Element renderers
const RENDERERS = {
  form(element) {
    const attrs = renderAttributes({
      id: element['#id'],
      method: element['#method'] || 'POST',
      action: element['#action'] || '',
      ...element['#attributes']
    });

    const children = renderChildren(element);

    return `<form${attrs}>\n${children}\n</form>`;
  },

  textfield(element) {
    return renderInput(element);
  },

  textarea(element) {
    const attrs = renderAttributes({
      id: element['#id'],
      name: element['#name'],
      ...element['#attributes']
    });

    const value = escapeHtml(element['#value'] || element['#default_value'] || '');

    return wrapWithLabel(element, `<textarea${attrs}>${value}</textarea>`);
  },

  password(element) {
    return renderInput(element);
  },

  select(element) {
    const attrs = renderAttributes({
      id: element['#id'],
      name: element['#name'],
      ...element['#attributes']
    });

    const options = renderOptions(element['#options'], element['#value'] || element['#default_value']);

    return wrapWithLabel(element, `<select${attrs}>${options}</select>`);
  },

  checkboxes(element) {
    const items = [];
    const selectedValues = element['#value'] || element['#default_value'] || [];

    for (const [key, label] of Object.entries(element['#options'])) {
      const checked = selectedValues.includes(key) ? ' checked' : '';
      const id = `${element['#id']}-${key}`;

      items.push(
        `<div class="form-checkbox">` +
        `<input type="checkbox" id="${id}" name="${element['#name']}[${key}]" value="${escapeHtml(key)}"${checked}>` +
        `<label for="${id}">${escapeHtml(label)}</label>` +
        `</div>`
      );
    }

    return wrapWithLabel(element, items.join('\n'), false);
  },

  radios(element) {
    const items = [];
    const selectedValue = element['#value'] || element['#default_value'];

    for (const [key, label] of Object.entries(element['#options'])) {
      const checked = selectedValue === key ? ' checked' : '';
      const id = `${element['#id']}-${key}`;

      items.push(
        `<div class="form-radio">` +
        `<input type="radio" id="${id}" name="${element['#name']}" value="${escapeHtml(key)}"${checked}>` +
        `<label for="${id}">${escapeHtml(label)}</label>` +
        `</div>`
      );
    }

    return wrapWithLabel(element, items.join('\n'), false);
  },

  checkbox(element) {
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

  hidden(element) {
    const attrs = renderAttributes({
      type: 'hidden',
      id: element['#id'],
      name: element['#name'],
      value: element['#value'] || element['#default_value'] || '',
      ...element['#attributes']
    });

    return `<input${attrs}>`;
  },

  submit(element) {
    const attrs = renderAttributes({
      type: 'submit',
      id: element['#id'],
      name: element['#name'] || 'submit',
      value: element['#value'] || 'Submit',
      class: `button button-${element['#button_type'] || 'primary'}`,
      ...element['#attributes']
    });

    return `<button${attrs}>${escapeHtml(element['#value'] || 'Submit')}</button>`;
  },

  button(element) {
    const attrs = renderAttributes({
      type: 'button',
      id: element['#id'],
      name: element['#name'],
      class: 'button',
      ...element['#attributes']
    });

    return `<button${attrs}>${escapeHtml(element['#value'] || 'Button')}</button>`;
  },

  fieldset(element) {
    const attrs = renderAttributes(element['#attributes'] || {});
    const legend = element['#title'] ? `<legend>${escapeHtml(element['#title'])}</legend>` : '';
    const description = element['#description'] ? `<div class="description">${escapeHtml(element['#description'])}</div>` : '';
    const children = renderChildren(element);

    return `<fieldset${attrs}>\n${legend}${description}\n${children}\n</fieldset>`;
  },

  details(element) {
    const attrs = renderAttributes({
      open: element['#open'],
      ...element['#attributes']
    });
    const summary = element['#title'] ? `<summary>${escapeHtml(element['#title'])}</summary>` : '';
    const description = element['#description'] ? `<div class="description">${escapeHtml(element['#description'])}</div>` : '';
    const children = renderChildren(element);

    return `<details${attrs}>\n${summary}${description}\n${children}\n</details>`;
  },

  container(element) {
    const attrs = renderAttributes(element['#attributes'] || {});
    const children = renderChildren(element);

    return `<div${attrs}>\n${children}\n</div>`;
  },

  item(element) {
    const markup = element['#markup'] || '';
    return wrapWithLabel(element, markup, false);
  },

  markup(element) {
    return element['#markup'] || '';
  },

  managed_file(element) {
    return renderInput(element);
  },

  date(element) {
    return renderInput(element);
  },

  datetime(element) {
    return renderInput(element);
  },

  number(element) {
    return renderInput(element);
  },

  email(element) {
    return renderInput(element);
  },

  url(element) {
    return renderInput(element);
  },

  tel(element) {
    return renderInput(element);
  },

  color(element) {
    return renderInput(element);
  },

  range(element) {
    return renderInput(element);
  },

  tableselect(element) {
    const header = element['#header'] || [];
    const options = element['#options'] || {};
    const selectedValues = element['#value'] || element['#default_value'] || [];

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
        const checked = selectedValues.includes(key) ? ' checked' : '';
        html += `<td><input type="checkbox" name="${element['#name']}[${key}]" value="${escapeHtml(key)}"${checked}></td>`;
      } else {
        const checked = selectedValues === key ? ' checked' : '';
        html += `<td><input type="radio" name="${element['#name']}" value="${escapeHtml(key)}"${checked}></td>`;
      }

      for (const cell of row) {
        html += `<td>${escapeHtml(cell)}</td>`;
      }

      html += '</tr>';
    }

    html += '</tbody></table>';

    return wrapWithLabel(element, html, false);
  },

  vertical_tabs(element) {
    const children = renderChildren(element);
    return `<div class="vertical-tabs">\n${children}\n</div>`;
  },

  weight(element) {
    return RENDERERS.select(element);
  },

  machine_name(element) {
    return renderInput(element);
  },

  path(element) {
    return renderInput(element);
  },

  language_select(element) {
    return RENDERERS.select(element);
  },

  icon_autocomplete(element) {
    const inputHtml = renderInput(element);
    const previewId = `${element['#id']}-preview`;

    // Add icon preview container after input
    const preview = element['#show_preview'] !== false
      ? `<div id="${previewId}" class="icon-preview" style="display:inline-block;margin-left:10px;vertical-align:middle;"></div>`
      : '';

    // Add autocomplete dropdown container
    const dropdown = `<div id="${element['#id']}-dropdown" class="icon-autocomplete-dropdown" style="display:none;position:absolute;background:white;border:1px solid #ddd;border-radius:4px;max-height:300px;overflow-y:auto;z-index:1000;box-shadow:0 2px 8px rgba(0,0,0,0.15);"></div>`;

    return inputHtml + preview + dropdown;
  },

  default(element) {
    return renderChildren(element);
  }
};

// Helper functions

function createFormState() {
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

function generateFormToken(formId) {
  const token = crypto.randomBytes(32).toString('hex');
  formTokens.set(formId, token);
  return token;
}

function validateFormToken(formId, token) {
  const storedToken = formTokens.get(formId);
  return storedToken && storedToken === token;
}

function extractFormValues(form, input) {
  const values = {};

  for (const key in form) {
    if (key.startsWith('#')) {
      continue;
    }

    const element = form[key];
    if (!element || typeof element !== 'object') {
      continue;
    }

    const name = element['#name'] || key;

    if (element['#tree']) {
      values[key] = extractTreeValues(element, input[name] || {});
    } else if (name in input) {
      values[key] = input[name];
    } else if (element['#default_value'] !== undefined) {
      values[key] = element['#default_value'];
    }

    // Recursively extract from containers
    const type = element['#type'];
    if (type && ELEMENT_TYPES[type] && ELEMENT_TYPES[type].container) {
      Object.assign(values, extractFormValues(element, input));
    }
  }

  return values;
}

function extractTreeValues(element, input) {
  const values = {};

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

function validateRequiredFields(form, formState) {
  for (const key in form) {
    if (key.startsWith('#')) {
      continue;
    }

    const element = form[key];
    if (!element || typeof element !== 'object') {
      continue;
    }

    if (element['#required']) {
      const value = formState.values[key];

      if (value === undefined || value === null || value === '') {
        setError(formState, element, `${element['#title'] || key} is required.`);
      }
    }

    // Recursively validate containers
    const type = element['#type'];
    if (type && ELEMENT_TYPES[type] && ELEMENT_TYPES[type].container) {
      validateRequiredFields(element, formState);
    }
  }
}

function validateElements(form, formState) {
  for (const key in form) {
    if (key.startsWith('#')) {
      continue;
    }

    const element = form[key];
    if (!element || typeof element !== 'object') {
      continue;
    }

    const value = formState.values[key];
    const type = element['#type'];

    // Type-specific validation
    if (type === 'email' && value) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        setError(formState, element, `${element['#title'] || key} must be a valid email address.`);
      }
    }

    if (type === 'url' && value) {
      try {
        new URL(value);
      } catch {
        setError(formState, element, `${element['#title'] || key} must be a valid URL.`);
      }
    }

    if (type === 'number' && value !== undefined && value !== '') {
      const num = Number(value);

      if (isNaN(num)) {
        setError(formState, element, `${element['#title'] || key} must be a number.`);
      } else {
        if (element['#min'] !== undefined && num < element['#min']) {
          setError(formState, element, `${element['#title'] || key} must be at least ${element['#min']}.`);
        }
        if (element['#max'] !== undefined && num > element['#max']) {
          setError(formState, element, `${element['#title'] || key} must be at most ${element['#max']}.`);
        }
      }
    }

    // Pattern validation
    if (element['#pattern'] && value) {
      const regex = new RegExp(element['#pattern']);
      if (!regex.test(value)) {
        const message = element['#pattern_error'] || `${element['#title'] || key} format is invalid.`;
        setError(formState, element, message);
      }
    }

    // Recursively validate containers
    if (type && ELEMENT_TYPES[type] && ELEMENT_TYPES[type].container) {
      validateElements(element, formState);
    }
  }
}

async function executeElementHandlers(type, form, formState) {
  for (const key in form) {
    if (key.startsWith('#')) {
      continue;
    }

    const element = form[key];
    if (!element || typeof element !== 'object') {
      continue;
    }

    const handlerKey = `#${type}`;
    if (element[handlerKey]) {
      for (const handler of element[handlerKey]) {
        if (typeof handler === 'function') {
          await handler(element, formState);
        }
      }
    }

    // Recursively execute handlers
    const elementType = element['#type'];
    if (elementType && ELEMENT_TYPES[elementType] && ELEMENT_TYPES[elementType].container) {
      await executeElementHandlers(type, element, formState);
    }
  }
}

function processFormElements(form, formState) {
  const processed = { ...form };

  for (const key in processed) {
    if (key.startsWith('#')) {
      continue;
    }

    if (typeof processed[key] === 'object' && processed[key] !== null) {
      processed[key] = processElement(processed[key], formState);
      processed[key] = prepareElement(processed[key]);
    }
  }

  return processed;
}

async function rebuildForm(form, formState) {
  formState.rebuild = true;
  const rebuilt = processFormElements(form, formState);

  // Attach error messages
  for (const error of getErrors(formState)) {
    if (error.name && rebuilt[error.name]) {
      rebuilt[error.name]['#error'] = error.message;
    }
  }

  return rebuilt;
}

function processStates(element) {
  const states = element['#states'];
  element['#attributes'] = element['#attributes'] || {};
  element['#attributes']['data-states'] = JSON.stringify(states);
}

function processAjax(element) {
  const ajax = element['#ajax'];
  element['#attributes'] = element['#attributes'] || {};
  element['#attributes']['data-ajax'] = JSON.stringify(ajax);
}

function generateElementId(element) {
  const name = element['#name'] || 'element';
  return `edit-${name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`;
}

function renderInput(element) {
  const attrs = renderAttributes({
    type: element['#attributes']?.type || 'text',
    id: element['#id'],
    name: element['#name'],
    value: element['#value'] || element['#default_value'] || '',
    ...element['#attributes']
  });

  return wrapWithLabel(element, `<input${attrs}>`);
}

function renderAttributes(attrs) {
  const parts = [];

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

function renderOptions(options, selectedValue) {
  const items = [];

  for (const [key, label] of Object.entries(options)) {
    const selected = key === selectedValue ? ' selected' : '';
    items.push(`<option value="${escapeHtml(key)}"${selected}>${escapeHtml(label)}</option>`);
  }

  return items.join('\n');
}

function renderChildren(element) {
  const children = [];

  for (const key in element) {
    if (key.startsWith('#')) {
      continue;
    }

    if (typeof element[key] === 'object' && element[key] !== null) {
      children.push(renderElement(element[key]));
    }
  }

  return children.join('\n');
}

function wrapWithLabel(element, input, inline = true, position = null) {
  const titleDisplay = position || element['#title_display'] || 'before';
  const title = element['#title'];
  const description = element['#description'];
  const error = element['#error'];

  let html = '';

  if (titleDisplay === 'before' && title) {
    html += `<label for="${element['#id']}">${escapeHtml(title)}</label>\n`;
  }

  if (error) {
    html += `<div class="error">${escapeHtml(error)}</div>\n`;
  }

  html += input;

  if (titleDisplay === 'after' && title) {
    html += `\n<label for="${element['#id']}">${escapeHtml(title)}</label>`;
  }

  if (description) {
    html += `\n<div class="description">${escapeHtml(description)}</div>`;
  }

  if (!inline && titleDisplay !== 'none') {
    html = `<div class="form-item">\n${html}\n</div>`;
  }

  return html;
}

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };

  return String(text).replace(/[&<>"']/g, char => map[char]);
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
