/**
 * AJAX Framework - Drupal Style
 *
 * Command-based AJAX system where server returns array of commands
 * and client executes them sequentially.
 *
 * @version 1.0.0
 */

/**
 * Server-side AJAX response builder
 */
export class AjaxResponse {
  constructor() {
    this.commands = [];
  }

  /**
   * Add a custom command
   * @param {Object} command - Command object with at minimum a 'command' property
   */
  addCommand(command) {
    if (!command || typeof command !== 'object') {
      throw new TypeError('Command must be an object');
    }
    if (!command.command) {
      throw new Error('Command object must have a "command" property');
    }
    this.commands.push(command);
    return this;
  }

  /**
   * Insert HTML at a selector with specified method
   * @param {string} selector - CSS selector
   * @param {string} html - HTML content
   * @param {string} method - Insert method (replaceWith, append, prepend, after, before)
   */
  insert(selector, html, method = 'replaceWith') {
    return this.addCommand({
      command: 'insert',
      selector,
      data: html,
      method
    });
  }

  /**
   * Insert HTML after element
   */
  after(selector, html) {
    return this.insert(selector, html, 'after');
  }

  /**
   * Insert HTML before element
   */
  before(selector, html) {
    return this.insert(selector, html, 'before');
  }

  /**
   * Append HTML to element
   */
  append(selector, html) {
    return this.insert(selector, html, 'append');
  }

  /**
   * Prepend HTML to element
   */
  prepend(selector, html) {
    return this.insert(selector, html, 'prepend');
  }

  /**
   * Replace element with HTML
   */
  replace(selector, html) {
    return this.insert(selector, html, 'replaceWith');
  }

  /**
   * Remove element(s)
   */
  remove(selector) {
    return this.addCommand({
      command: 'remove',
      selector
    });
  }

  /**
   * Empty element's contents
   */
  empty(selector) {
    return this.addCommand({
      command: 'empty',
      selector
    });
  }

  /**
   * Set CSS property
   */
  css(selector, property, value) {
    return this.addCommand({
      command: 'css',
      selector,
      property,
      value
    });
  }

  /**
   * Add CSS class(es)
   */
  addClass(selector, classes) {
    return this.addCommand({
      command: 'addClass',
      selector,
      classes
    });
  }

  /**
   * Remove CSS class(es)
   */
  removeClass(selector, classes) {
    return this.addCommand({
      command: 'removeClass',
      selector,
      classes
    });
  }

  /**
   * Set attribute
   */
  attr(selector, attribute, value) {
    return this.addCommand({
      command: 'attr',
      selector,
      attribute,
      value
    });
  }

  /**
   * Remove attribute
   */
  removeAttr(selector, attribute) {
    return this.addCommand({
      command: 'removeAttr',
      selector,
      attribute
    });
  }

  /**
   * Set HTML content
   */
  html(selector, html) {
    return this.addCommand({
      command: 'html',
      selector,
      data: html
    });
  }

  /**
   * Set text content
   */
  text(selector, text) {
    return this.addCommand({
      command: 'text',
      selector,
      data: text
    });
  }

  /**
   * Set form element value
   */
  val(selector, value) {
    return this.addCommand({
      command: 'val',
      selector,
      value
    });
  }

  /**
   * Show element(s)
   */
  show(selector) {
    return this.addCommand({
      command: 'show',
      selector
    });
  }

  /**
   * Hide element(s)
   */
  hide(selector) {
    return this.addCommand({
      command: 'hide',
      selector
    });
  }

  /**
   * Toggle element visibility
   */
  toggle(selector) {
    return this.addCommand({
      command: 'toggle',
      selector
    });
  }

  /**
   * Fade in element
   */
  fadeIn(selector, duration = 400) {
    return this.addCommand({
      command: 'fadeIn',
      selector,
      duration
    });
  }

  /**
   * Fade out element
   */
  fadeOut(selector, duration = 400) {
    return this.addCommand({
      command: 'fadeOut',
      selector,
      duration
    });
  }

  /**
   * Slide down element
   */
  slideDown(selector, duration = 400) {
    return this.addCommand({
      command: 'slideDown',
      selector,
      duration
    });
  }

  /**
   * Slide up element
   */
  slideUp(selector, duration = 400) {
    return this.addCommand({
      command: 'slideUp',
      selector,
      duration
    });
  }

  /**
   * Display form error
   */
  setError(selector, message) {
    return this.addCommand({
      command: 'setError',
      selector,
      message
    });
  }

  /**
   * Clear form errors
   */
  clearErrors(selector) {
    return this.addCommand({
      command: 'clearErrors',
      selector
    });
  }

  /**
   * Redirect to URL
   */
  redirect(url) {
    return this.addCommand({
      command: 'redirect',
      url
    });
  }

  /**
   * Refresh page
   */
  refresh() {
    return this.addCommand({
      command: 'refresh'
    });
  }

  /**
   * Scroll to element
   */
  scrollTo(selector, options = {}) {
    return this.addCommand({
      command: 'scrollTo',
      selector,
      options
    });
  }

  /**
   * Open dialog
   */
  openDialog(selector, content, options = {}) {
    return this.addCommand({
      command: 'openDialog',
      selector,
      content,
      options
    });
  }

  /**
   * Close dialog
   */
  closeDialog(selector) {
    return this.addCommand({
      command: 'closeDialog',
      selector
    });
  }

  /**
   * Update client-side settings
   */
  settings(settings, merge = true) {
    return this.addCommand({
      command: 'settings',
      settings,
      merge
    });
  }

  /**
   * Display message
   */
  message(text, type = 'status') {
    return this.addCommand({
      command: 'message',
      text,
      type
    });
  }

  /**
   * Invoke method on element
   */
  invoke(selector, method, args = []) {
    return this.addCommand({
      command: 'invoke',
      selector,
      method,
      args
    });
  }

  /**
   * Convert to JSON for response
   */
  toJSON() {
    return this.commands;
  }
}

/**
 * Generate client-side JavaScript for handling AJAX commands
 */
export function getClientScript() {
  return `
(function() {
  'use strict';

  // Global settings storage
  window.drupalSettings = window.drupalSettings || {};

  // AJAX command processors
  const commandProcessors = {
    // DOM manipulation
    insert: function(command) {
      const elements = document.querySelectorAll(command.selector);
      elements.forEach(el => {
        const temp = document.createElement('div');
        temp.innerHTML = command.data;
        const newContent = temp.firstChild;

        switch(command.method) {
          case 'replaceWith':
            el.replaceWith(newContent);
            break;
          case 'append':
            el.appendChild(newContent);
            break;
          case 'prepend':
            el.insertBefore(newContent, el.firstChild);
            break;
          case 'after':
            el.parentNode.insertBefore(newContent, el.nextSibling);
            break;
          case 'before':
            el.parentNode.insertBefore(newContent, el);
            break;
        }
      });
    },

    remove: function(command) {
      const elements = document.querySelectorAll(command.selector);
      elements.forEach(el => el.remove());
    },

    empty: function(command) {
      const elements = document.querySelectorAll(command.selector);
      elements.forEach(el => el.innerHTML = '');
    },

    html: function(command) {
      const elements = document.querySelectorAll(command.selector);
      elements.forEach(el => el.innerHTML = command.data);
    },

    text: function(command) {
      const elements = document.querySelectorAll(command.selector);
      elements.forEach(el => el.textContent = command.data);
    },

    val: function(command) {
      const elements = document.querySelectorAll(command.selector);
      elements.forEach(el => el.value = command.value);
    },

    // CSS
    css: function(command) {
      const elements = document.querySelectorAll(command.selector);
      elements.forEach(el => el.style[command.property] = command.value);
    },

    addClass: function(command) {
      const elements = document.querySelectorAll(command.selector);
      const classes = command.classes.split(' ');
      elements.forEach(el => el.classList.add(...classes));
    },

    removeClass: function(command) {
      const elements = document.querySelectorAll(command.selector);
      const classes = command.classes.split(' ');
      elements.forEach(el => el.classList.remove(...classes));
    },

    // Attributes
    attr: function(command) {
      const elements = document.querySelectorAll(command.selector);
      elements.forEach(el => el.setAttribute(command.attribute, command.value));
    },

    removeAttr: function(command) {
      const elements = document.querySelectorAll(command.selector);
      elements.forEach(el => el.removeAttribute(command.attribute));
    },

    // Visibility
    show: function(command) {
      const elements = document.querySelectorAll(command.selector);
      elements.forEach(el => el.style.display = '');
    },

    hide: function(command) {
      const elements = document.querySelectorAll(command.selector);
      elements.forEach(el => el.style.display = 'none');
    },

    toggle: function(command) {
      const elements = document.querySelectorAll(command.selector);
      elements.forEach(el => {
        el.style.display = el.style.display === 'none' ? '' : 'none';
      });
    },

    // Effects
    fadeIn: function(command) {
      const elements = document.querySelectorAll(command.selector);
      elements.forEach(el => {
        el.style.opacity = '0';
        el.style.display = '';
        el.style.transition = \`opacity \${command.duration}ms\`;
        setTimeout(() => el.style.opacity = '1', 10);
      });
    },

    fadeOut: function(command) {
      const elements = document.querySelectorAll(command.selector);
      elements.forEach(el => {
        el.style.transition = \`opacity \${command.duration}ms\`;
        el.style.opacity = '0';
        setTimeout(() => el.style.display = 'none', command.duration);
      });
    },

    slideDown: function(command) {
      const elements = document.querySelectorAll(command.selector);
      elements.forEach(el => {
        el.style.height = '0';
        el.style.overflow = 'hidden';
        el.style.display = '';
        const height = el.scrollHeight;
        el.style.transition = \`height \${command.duration}ms\`;
        setTimeout(() => el.style.height = height + 'px', 10);
        setTimeout(() => {
          el.style.height = '';
          el.style.overflow = '';
        }, command.duration);
      });
    },

    slideUp: function(command) {
      const elements = document.querySelectorAll(command.selector);
      elements.forEach(el => {
        const height = el.scrollHeight;
        el.style.height = height + 'px';
        el.style.overflow = 'hidden';
        el.style.transition = \`height \${command.duration}ms\`;
        setTimeout(() => el.style.height = '0', 10);
        setTimeout(() => el.style.display = 'none', command.duration);
      });
    },

    // Form errors
    setError: function(command) {
      const elements = document.querySelectorAll(command.selector);
      elements.forEach(el => {
        el.classList.add('error');
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = command.message;
        el.parentNode.insertBefore(errorDiv, el.nextSibling);
      });
    },

    clearErrors: function(command) {
      const elements = document.querySelectorAll(command.selector);
      elements.forEach(el => {
        el.classList.remove('error');
        const errors = el.parentNode.querySelectorAll('.error-message');
        errors.forEach(err => err.remove());
      });
    },

    // Navigation
    redirect: function(command) {
      window.location.href = command.url;
    },

    refresh: function(command) {
      window.location.reload();
    },

    scrollTo: function(command) {
      const element = document.querySelector(command.selector);
      if (element) {
        element.scrollIntoView({
          behavior: command.options.behavior || 'smooth',
          block: command.options.block || 'start',
          inline: command.options.inline || 'nearest'
        });
      }
    },

    // Dialog
    openDialog: function(command) {
      const dialog = document.querySelector(command.selector) || createDialog(command.selector);
      dialog.innerHTML = command.content;
      dialog.style.display = 'block';

      if (command.options.modal) {
        const overlay = document.createElement('div');
        overlay.className = 'dialog-overlay';
        overlay.onclick = () => {
          if (!command.options.persistent) {
            commandProcessors.closeDialog({ selector: command.selector });
          }
        };
        document.body.appendChild(overlay);
      }
    },

    closeDialog: function(command) {
      const dialog = document.querySelector(command.selector);
      if (dialog) {
        dialog.style.display = 'none';
        const overlay = document.querySelector('.dialog-overlay');
        if (overlay) overlay.remove();
      }
    },

    // Settings
    settings: function(command) {
      if (command.merge) {
        Object.assign(window.drupalSettings, command.settings);
      } else {
        window.drupalSettings = command.settings;
      }
    },

    // Messages
    message: function(command) {
      const messageContainer = document.querySelector('.messages') || createMessageContainer();
      const message = document.createElement('div');
      message.className = \`message message--\${command.type}\`;
      message.textContent = command.text;
      messageContainer.appendChild(message);

      // Auto-remove after 5 seconds
      setTimeout(() => message.remove(), 5000);
    },

    // Custom invocation
    invoke: function(command) {
      const elements = document.querySelectorAll(command.selector);
      elements.forEach(el => {
        if (typeof el[command.method] === 'function') {
          el[command.method](...command.args);
        }
      });
    }
  };

  // Helper: Create dialog element
  function createDialog(selector) {
    const dialog = document.createElement('div');
    dialog.className = 'ajax-dialog';
    const id = selector.replace('#', '');
    dialog.id = id;
    document.body.appendChild(dialog);
    return dialog;
  }

  // Helper: Create message container
  function createMessageContainer() {
    const container = document.createElement('div');
    container.className = 'messages';
    document.body.insertBefore(container, document.body.firstChild);
    return container;
  }

  // Process AJAX response
  function processAjaxResponse(commands) {
    if (!Array.isArray(commands)) {
      console.error('AJAX response must be an array of commands');
      return;
    }

    commands.forEach(command => {
      const processor = commandProcessors[command.command];
      if (processor) {
        try {
          processor(command);
        } catch (error) {
          console.error(\`Error processing AJAX command '\${command.command}':\`, error);
        }
      } else {
        console.warn(\`Unknown AJAX command: \${command.command}\`);
      }
    });
  }

  // Attach AJAX behavior to forms
  function attachFormBehaviors() {
    document.querySelectorAll('[data-ajax]').forEach(element => {
      const ajaxConfig = JSON.parse(element.getAttribute('data-ajax') || '{}');
      const event = ajaxConfig.event || 'submit';

      element.addEventListener(event, async function(e) {
        const prevent = ajaxConfig.prevent || event;
        if (prevent) {
          e.preventDefault();
        }

        // Show progress indicator
        if (ajaxConfig.progress) {
          showProgress(element, ajaxConfig.progress);
        }

        try {
          const url = ajaxConfig.url || element.action || window.location.href;
          const method = ajaxConfig.method || element.method || 'POST';

          const formData = element.tagName === 'FORM'
            ? new FormData(element)
            : new FormData();

          const response = await fetch(url, {
            method: method,
            body: formData,
            headers: {
              'X-Requested-With': 'XMLHttpRequest'
            }
          });

          if (!response.ok) {
            throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
          }

          const commands = await response.json();
          processAjaxResponse(commands);

        } catch (error) {
          console.error('AJAX request failed:', error);
          commandProcessors.message({
            text: 'An error occurred. Please try again.',
            type: 'error'
          });
        } finally {
          // Hide progress indicator
          if (ajaxConfig.progress) {
            hideProgress(element);
          }
        }
      });
    });
  }

  // Progress indicators
  function showProgress(element, config) {
    const type = config.type || 'throbber';
    const message = config.message || 'Loading...';

    const progress = document.createElement('div');
    progress.className = \`ajax-progress ajax-progress--\${type}\`;
    progress.innerHTML = \`<div class="throbber"></div><div class="message">\${message}</div>\`;
    progress.setAttribute('data-progress-for', element.id || '');

    element.parentNode.insertBefore(progress, element.nextSibling);
  }

  function hideProgress(element) {
    const progress = element.parentNode.querySelector('.ajax-progress');
    if (progress) {
      progress.remove();
    }
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachFormBehaviors);
  } else {
    attachFormBehaviors();
  }

  // Expose public API
  window.Drupal = window.Drupal || {};
  window.Drupal.ajax = {
    processResponse: processAjaxResponse,
    attachBehaviors: attachFormBehaviors
  };

})();
`.trim();
}

/**
 * Process form AJAX callback
 * @param {Object} request - HTTP request object
 * @param {Object} form - Form array structure
 * @param {Object} formState - Form state object
 * @returns {AjaxResponse} AJAX response object
 */
export function processFormAjax(request, form, formState) {
  const response = new AjaxResponse();

  // Extract AJAX settings from form
  const ajaxSettings = form['#ajax'] || {};
  const callback = ajaxSettings.callback;

  if (!callback || typeof callback !== 'function') {
    throw new Error('Form AJAX callback must be a function');
  }

  try {
    // Execute callback
    const result = callback(form, formState, request);

    // If callback returns AjaxResponse, use it
    if (result instanceof AjaxResponse) {
      return result;
    }

    // If callback returns renderable array, insert it
    if (result && typeof result === 'object') {
      const wrapper = ajaxSettings.wrapper || 'edit-wrapper';
      const method = ajaxSettings.method || 'replaceWith';
      const html = renderElement(result);

      response.insert(`#${wrapper}`, html, method);
    }

  } catch (error) {
    // Handle errors
    response.message(error.message, 'error');

    if (ajaxSettings.errorHandler) {
      ajaxSettings.errorHandler(error, response);
    }
  }

  return response;
}

/**
 * Handle AJAX request routing
 * @param {Object} request - HTTP request object
 * @param {Function} callback - Callback function returning AjaxResponse
 * @returns {string} JSON string of commands
 */
export function handleAjaxRequest(request, callback) {
  // Verify this is an AJAX request
  const isAjax = request.headers['x-requested-with'] === 'XMLHttpRequest';

  if (!isAjax) {
    throw new Error('Not an AJAX request');
  }

  try {
    const response = callback(request);

    if (!(response instanceof AjaxResponse)) {
      throw new TypeError('Callback must return AjaxResponse instance');
    }

    return JSON.stringify(response.toJSON());

  } catch (error) {
    const errorResponse = new AjaxResponse();
    errorResponse.message(
      error.message || 'An error occurred',
      'error'
    );
    return JSON.stringify(errorResponse.toJSON());
  }
}

/**
 * Helper: Render element to HTML string
 * @param {Object} element - Renderable element
 * @returns {string} HTML string
 */
function renderElement(element) {
  // This would integrate with your rendering system
  // Placeholder implementation
  if (typeof element === 'string') {
    return element;
  }

  if (element['#markup']) {
    return element['#markup'];
  }

  // Default: convert to string
  return String(element);
}

/**
 * Create AJAX-enabled element configuration
 * @param {Object} options - AJAX configuration
 * @returns {Object} Element with AJAX settings
 */
export function createAjaxElement(options = {}) {
  return {
    '#ajax': {
      callback: options.callback,
      wrapper: options.wrapper || 'edit-wrapper',
      method: options.method || 'replaceWith',
      effect: options.effect || 'fade',
      speed: options.speed || 'normal',
      event: options.event || 'change',
      prevent: options.prevent || options.event || 'change',
      progress: options.progress || {
        type: 'throbber',
        message: 'Loading...'
      },
      url: options.url,
      options: options.options || {}
    }
  };
}

/**
 * Attach client script to HTML page
 * @param {string} html - HTML content
 * @returns {string} HTML with AJAX script attached
 */
export function attachClientScript(html) {
  const script = `<script>${getClientScript()}</script>`;

  // Insert before closing body tag
  if (html.includes('</body>')) {
    return html.replace('</body>', `${script}</body>`);
  }

  // Otherwise append
  return html + script;
}
