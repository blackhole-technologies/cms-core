/**
 * AJAX Framework - Drupal Style
 *
 * Command-based AJAX system where server returns array of commands
 * and client executes them sequentially.
 *
 * @version 1.0.0
 */

import type { IncomingMessage } from 'node:http';

// ============================================================================
// Types
// ============================================================================

/** Insert method variants for DOM insertion commands */
type InsertMethod = 'replaceWith' | 'append' | 'prepend' | 'after' | 'before';

/** Message type variants for display commands */
type MessageType = 'status' | 'warning' | 'error' | 'info';

/** Base shape for all AJAX commands — command discriminator is required */
interface AjaxCommandBase {
  command: string;
}

interface InsertCommand extends AjaxCommandBase {
  command: 'insert';
  selector: string;
  data: string;
  method: InsertMethod;
}

interface RemoveCommand extends AjaxCommandBase {
  command: 'remove';
  selector: string;
}

interface EmptyCommand extends AjaxCommandBase {
  command: 'empty';
  selector: string;
}

interface CssCommand extends AjaxCommandBase {
  command: 'css';
  selector: string;
  property: string;
  value: string;
}

interface AddClassCommand extends AjaxCommandBase {
  command: 'addClass';
  selector: string;
  classes: string;
}

interface RemoveClassCommand extends AjaxCommandBase {
  command: 'removeClass';
  selector: string;
  classes: string;
}

interface AttrCommand extends AjaxCommandBase {
  command: 'attr';
  selector: string;
  attribute: string;
  value: string;
}

interface RemoveAttrCommand extends AjaxCommandBase {
  command: 'removeAttr';
  selector: string;
  attribute: string;
}

interface HtmlCommand extends AjaxCommandBase {
  command: 'html';
  selector: string;
  data: string;
}

interface TextCommand extends AjaxCommandBase {
  command: 'text';
  selector: string;
  data: string;
}

interface ValCommand extends AjaxCommandBase {
  command: 'val';
  selector: string;
  value: string;
}

interface ShowCommand extends AjaxCommandBase {
  command: 'show';
  selector: string;
}

interface HideCommand extends AjaxCommandBase {
  command: 'hide';
  selector: string;
}

interface ToggleCommand extends AjaxCommandBase {
  command: 'toggle';
  selector: string;
}

interface FadeInCommand extends AjaxCommandBase {
  command: 'fadeIn';
  selector: string;
  duration: number;
}

interface FadeOutCommand extends AjaxCommandBase {
  command: 'fadeOut';
  selector: string;
  duration: number;
}

interface SlideDownCommand extends AjaxCommandBase {
  command: 'slideDown';
  selector: string;
  duration: number;
}

interface SlideUpCommand extends AjaxCommandBase {
  command: 'slideUp';
  selector: string;
  duration: number;
}

interface SetErrorCommand extends AjaxCommandBase {
  command: 'setError';
  selector: string;
  message: string;
}

interface ClearErrorsCommand extends AjaxCommandBase {
  command: 'clearErrors';
  selector: string;
}

interface RedirectCommand extends AjaxCommandBase {
  command: 'redirect';
  url: string;
}

interface RefreshCommand extends AjaxCommandBase {
  command: 'refresh';
}

interface ScrollToCommand extends AjaxCommandBase {
  command: 'scrollTo';
  selector: string;
  options: Record<string, unknown>;
}

interface OpenDialogCommand extends AjaxCommandBase {
  command: 'openDialog';
  selector: string;
  content: string;
  options: Record<string, unknown>;
}

interface CloseDialogCommand extends AjaxCommandBase {
  command: 'closeDialog';
  selector: string;
}

interface SettingsCommand extends AjaxCommandBase {
  command: 'settings';
  settings: Record<string, unknown>;
  merge: boolean;
}

interface MessageCommand extends AjaxCommandBase {
  command: 'message';
  text: string;
  type: MessageType;
}

interface InvokeCommand extends AjaxCommandBase {
  command: 'invoke';
  selector: string;
  method: string;
  args: unknown[];
}

/** Union of all known typed AJAX commands */
export type AjaxCommand =
  | InsertCommand
  | RemoveCommand
  | EmptyCommand
  | CssCommand
  | AddClassCommand
  | RemoveClassCommand
  | AttrCommand
  | RemoveAttrCommand
  | HtmlCommand
  | TextCommand
  | ValCommand
  | ShowCommand
  | HideCommand
  | ToggleCommand
  | FadeInCommand
  | FadeOutCommand
  | SlideDownCommand
  | SlideUpCommand
  | SetErrorCommand
  | ClearErrorsCommand
  | RedirectCommand
  | RefreshCommand
  | ScrollToCommand
  | OpenDialogCommand
  | CloseDialogCommand
  | SettingsCommand
  | MessageCommand
  | InvokeCommand;

/** Options for createAjaxElement */
interface AjaxElementOptions {
  callback?: (form: Record<string, unknown>, formState: Record<string, unknown>, request: IncomingMessage) => AjaxResponse | Record<string, unknown>;
  wrapper?: string;
  method?: InsertMethod;
  effect?: string;
  speed?: string | number;
  event?: string;
  prevent?: string;
  progress?: { type: string; message: string };
  url?: string;
  options?: Record<string, unknown>;
  errorHandler?: (error: Error, response: AjaxResponse) => void;
}

/**
 * Server-side AJAX response builder
 */
export class AjaxResponse {
  commands: AjaxCommand[] = [];

  /**
   * Add a custom command
   */
  addCommand(command: AjaxCommand): this {
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
   */
  insert(selector: string, html: string, method: InsertMethod = 'replaceWith'): this {
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
  after(selector: string, html: string): this {
    return this.insert(selector, html, 'after');
  }

  /**
   * Insert HTML before element
   */
  before(selector: string, html: string): this {
    return this.insert(selector, html, 'before');
  }

  /**
   * Append HTML to element
   */
  append(selector: string, html: string): this {
    return this.insert(selector, html, 'append');
  }

  /**
   * Prepend HTML to element
   */
  prepend(selector: string, html: string): this {
    return this.insert(selector, html, 'prepend');
  }

  /**
   * Replace element with HTML
   */
  replace(selector: string, html: string): this {
    return this.insert(selector, html, 'replaceWith');
  }

  /**
   * Remove element(s)
   */
  remove(selector: string): this {
    return this.addCommand({
      command: 'remove',
      selector
    });
  }

  /**
   * Empty element's contents
   */
  empty(selector: string): this {
    return this.addCommand({
      command: 'empty',
      selector
    });
  }

  /**
   * Set CSS property
   */
  css(selector: string, property: string, value: string): this {
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
  addClass(selector: string, classes: string): this {
    return this.addCommand({
      command: 'addClass',
      selector,
      classes
    });
  }

  /**
   * Remove CSS class(es)
   */
  removeClass(selector: string, classes: string): this {
    return this.addCommand({
      command: 'removeClass',
      selector,
      classes
    });
  }

  /**
   * Set attribute
   */
  attr(selector: string, attribute: string, value: string): this {
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
  removeAttr(selector: string, attribute: string): this {
    return this.addCommand({
      command: 'removeAttr',
      selector,
      attribute
    });
  }

  /**
   * Set HTML content
   */
  html(selector: string, html: string): this {
    return this.addCommand({
      command: 'html',
      selector,
      data: html
    });
  }

  /**
   * Set text content
   */
  text(selector: string, text: string): this {
    return this.addCommand({
      command: 'text',
      selector,
      data: text
    });
  }

  /**
   * Set form element value
   */
  val(selector: string, value: string): this {
    return this.addCommand({
      command: 'val',
      selector,
      value
    });
  }

  /**
   * Show element(s)
   */
  show(selector: string): this {
    return this.addCommand({
      command: 'show',
      selector
    });
  }

  /**
   * Hide element(s)
   */
  hide(selector: string): this {
    return this.addCommand({
      command: 'hide',
      selector
    });
  }

  /**
   * Toggle element visibility
   */
  toggle(selector: string): this {
    return this.addCommand({
      command: 'toggle',
      selector
    });
  }

  /**
   * Fade in element
   */
  fadeIn(selector: string, duration: number = 400): this {
    return this.addCommand({
      command: 'fadeIn',
      selector,
      duration
    });
  }

  /**
   * Fade out element
   */
  fadeOut(selector: string, duration: number = 400): this {
    return this.addCommand({
      command: 'fadeOut',
      selector,
      duration
    });
  }

  /**
   * Slide down element
   */
  slideDown(selector: string, duration: number = 400): this {
    return this.addCommand({
      command: 'slideDown',
      selector,
      duration
    });
  }

  /**
   * Slide up element
   */
  slideUp(selector: string, duration: number = 400): this {
    return this.addCommand({
      command: 'slideUp',
      selector,
      duration
    });
  }

  /**
   * Display form error
   */
  setError(selector: string, message: string): this {
    return this.addCommand({
      command: 'setError',
      selector,
      message
    });
  }

  /**
   * Clear form errors
   */
  clearErrors(selector: string): this {
    return this.addCommand({
      command: 'clearErrors',
      selector
    });
  }

  /**
   * Redirect to URL
   */
  redirect(url: string): this {
    return this.addCommand({
      command: 'redirect',
      url
    });
  }

  /**
   * Refresh page
   */
  refresh(): this {
    return this.addCommand({
      command: 'refresh'
    });
  }

  /**
   * Scroll to element
   */
  scrollTo(selector: string, options: Record<string, unknown> = {}): this {
    return this.addCommand({
      command: 'scrollTo',
      selector,
      options
    });
  }

  /**
   * Open dialog
   */
  openDialog(selector: string, content: string, options: Record<string, unknown> = {}): this {
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
  closeDialog(selector: string): this {
    return this.addCommand({
      command: 'closeDialog',
      selector
    });
  }

  /**
   * Update client-side settings
   */
  settings(settings: Record<string, unknown>, merge: boolean = true): this {
    return this.addCommand({
      command: 'settings',
      settings,
      merge
    });
  }

  /**
   * Display message
   */
  message(text: string, type: MessageType = 'status'): this {
    return this.addCommand({
      command: 'message',
      text,
      type
    });
  }

  /**
   * Invoke method on element
   */
  invoke(selector: string, method: string, args: unknown[] = []): this {
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
  toJSON(): AjaxCommand[] {
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
 */
export function processFormAjax(
  request: IncomingMessage,
  form: Record<string, unknown>,
  formState: Record<string, unknown>
): AjaxResponse {
  const response = new AjaxResponse();

  // Extract AJAX settings from form
  const ajaxSettings = (form['#ajax'] || {}) as Record<string, unknown>;
  const callback = ajaxSettings['callback'];

  if (!callback || typeof callback !== 'function') {
    throw new Error('Form AJAX callback must be a function');
  }

  try {
    // Execute callback
    const result = (callback as (form: Record<string, unknown>, formState: Record<string, unknown>, request: IncomingMessage) => unknown)(form, formState, request);

    // If callback returns AjaxResponse, use it
    if (result instanceof AjaxResponse) {
      return result;
    }

    // If callback returns renderable array, insert it
    if (result && typeof result === 'object') {
      const wrapper = (ajaxSettings['wrapper'] as string | undefined) || 'edit-wrapper';
      const method = (ajaxSettings['method'] as InsertMethod | undefined) || 'replaceWith';
      const html = renderElement(result as Record<string, unknown>);

      response.insert(`#${wrapper}`, html, method);
    }

  } catch (error) {
    // Handle errors
    response.message((error as Error).message, 'error');

    const errorHandler = ajaxSettings['errorHandler'] as ((error: Error, response: AjaxResponse) => void) | undefined;
    if (errorHandler) {
      errorHandler(error as Error, response);
    }
  }

  return response;
}

/**
 * Handle AJAX request routing
 */
export function handleAjaxRequest(
  request: IncomingMessage & { headers: Record<string, string | string[] | undefined> },
  callback: (request: IncomingMessage) => AjaxResponse
): string {
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
      (error as Error).message || 'An error occurred',
      'error'
    );
    return JSON.stringify(errorResponse.toJSON());
  }
}

/**
 * Helper: Render element to HTML string
 */
function renderElement(element: Record<string, unknown>): string {
  // This would integrate with your rendering system
  // Placeholder implementation
  if (typeof element === 'string') {
    return element;
  }

  if (element['#markup']) {
    return String(element['#markup']);
  }

  // Default: convert to string
  return String(element);
}

/**
 * Create AJAX-enabled element configuration
 */
export function createAjaxElement(options: AjaxElementOptions = {}): Record<string, unknown> {
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
 */
export function attachClientScript(html: string): string {
  const script = `<script>${getClientScript()}</script>`;

  // Insert before closing body tag
  if (html.includes('</body>')) {
    return html.replace('</body>', `${script}</body>`);
  }

  // Otherwise append
  return html + script;
}
