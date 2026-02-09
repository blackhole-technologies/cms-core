/**
 * META-PATTERN TEMPLATE: FormBase
 * =================================
 * 
 * Drupal equivalent: FormBase.php, FormInterface.php, ConfirmFormBase.php
 * 
 * Forms in CMS-Core use render arrays (same as display). A form is a
 * render array with #type elements (textfield, select, checkbox, etc.)
 * that gets built, altered by other modules, validated, and submitted.
 * 
 * The KEY feature: hook_form_alter. ANY module can modify ANY form.
 * This is how SEO modules add meta fields to content forms, how
 * scheduling modules add publish dates, etc.
 * 
 * @example Defining a form
 * ```javascript
 * // modules/contact/forms/ContactForm.js
 * import { FormBase } from '../../../core/lib/Form/FormBase.js';
 * 
 * export class ContactForm extends FormBase {
 *   getFormId() {
 *     return 'contact_form';
 *   }
 * 
 *   buildForm(formState) {
 *     return {
 *       name: {
 *         '#type': 'textfield',
 *         '#title': 'Your name',
 *         '#required': true,
 *         '#maxlength': 100,
 *       },
 *       email: {
 *         '#type': 'email',
 *         '#title': 'Email address',
 *         '#required': true,
 *       },
 *       subject: {
 *         '#type': 'textfield',
 *         '#title': 'Subject',
 *         '#required': true,
 *       },
 *       message: {
 *         '#type': 'textarea',
 *         '#title': 'Message',
 *         '#required': true,
 *         '#rows': 8,
 *       },
 *       actions: {
 *         '#type': 'actions',
 *         submit: {
 *           '#type': 'submit',
 *           '#value': 'Send message',
 *         },
 *       },
 *     };
 *   }
 * 
 *   validateForm(form, formState) {
 *     const email = formState.getValue('email');
 *     if (email && !email.includes('@')) {
 *       formState.setError('email', 'Please enter a valid email address.');
 *     }
 *   }
 * 
 *   async submitForm(form, formState) {
 *     const mailer = this._services.get('mailer');
 *     await mailer.send({
 *       to: 'admin@example.com',
 *       subject: formState.getValue('subject'),
 *       body: formState.getValue('message'),
 *       replyTo: formState.getValue('email'),
 *     });
 *     formState.setRedirect('/contact/thanks');
 *   }
 * }
 * ```
 * 
 * @example Entity form (form for editing an entity)
 * ```javascript
 * // modules/node/forms/NodeForm.js
 * import { FormBase } from '../../../core/lib/Form/FormBase.js';
 * 
 * export class NodeForm extends FormBase {
 *   getFormId() {
 *     return 'node_edit';
 *   }
 * 
 *   buildForm(formState) {
 *     const entity = formState.getEntity();
 *     return {
 *       title: {
 *         '#type': 'textfield',
 *         '#title': 'Title',
 *         '#required': true,
 *         '#default_value': entity?.get('title') || '',
 *       },
 *       body: {
 *         '#type': 'text_format',  // Uses text format widget
 *         '#title': 'Body',
 *         '#default_value': entity?.get('body') || '',
 *       },
 *       status: {
 *         '#type': 'checkbox',
 *         '#title': 'Published',
 *         '#default_value': entity?.get('status') ?? true,
 *       },
 *       // Field widgets are auto-generated from entity field definitions
 *       // via EntityFormDisplay (populated by field system)
 *       actions: {
 *         '#type': 'actions',
 *         save: { '#type': 'submit', '#value': 'Save' },
 *         delete: { '#type': 'link', '#title': 'Delete', '#url': `/node/${entity?.id()}/delete` },
 *       },
 *     };
 *   }
 * 
 *   async submitForm(form, formState) {
 *     const storage = this._services.get('entity_type.manager').getStorage('node');
 *     const entity = formState.getEntity() || storage.create({});
 *     entity.set('title', formState.getValue('title'));
 *     entity.set('body', formState.getValue('body'));
 *     entity.set('status', formState.getValue('status'));
 *     await storage.save(entity);
 *     formState.setRedirect(`/node/${entity.id()}`);
 *   }
 * }
 * ```
 * 
 * @example Altering another module's form (the killer feature)
 * ```javascript
 * // modules/seo/index.js — adds SEO fields to ALL node forms
 * export function hook_boot(ctx) {
 *   const hooks = ctx.services.get('hooks');
 * 
 *   hooks.onAlter('form_node_edit', async (form, { formState }) => {
 *     form.seo_group = {
 *       '#type': 'details',
 *       '#title': 'SEO',
 *       '#weight': 90,
 *       '#open': false,
 *       meta_title: {
 *         '#type': 'textfield',
 *         '#title': 'Meta title',
 *         '#default_value': formState.getValue('meta_title') || '',
 *         '#maxlength': 60,
 *       },
 *       meta_description: {
 *         '#type': 'textarea',
 *         '#title': 'Meta description',
 *         '#rows': 3,
 *       },
 *     };
 *     return form;
 *   }, { module: 'seo' });
 * }
 * ```
 * 
 * @example Confirm form (for delete operations)
 * ```javascript
 * // modules/node/forms/NodeDeleteForm.js
 * import { ConfirmFormBase } from '../../../core/lib/Form/ConfirmFormBase.js';
 * 
 * export class NodeDeleteForm extends ConfirmFormBase {
 *   getFormId() { return 'node_delete_confirm'; }
 *   getQuestion() { return `Are you sure you want to delete "${this._entity.label()}"?`; }
 *   getCancelUrl() { return `/node/${this._entity.id()}`; }
 *   getDescription() { return 'This action cannot be undone.'; }
 * 
 *   async submitForm(form, formState) {
 *     const storage = this._services.get('entity_type.manager').getStorage('node');
 *     await storage.delete(this._entity.id());
 *     formState.setRedirect('/admin/content');
 *   }
 * }
 * ```
 * 
 * Form element types supported:
 * - textfield, textarea, email, password, number, hidden
 * - select (with #options), radios, checkboxes, checkbox
 * - submit, button, link
 * - details (collapsible), fieldset (visual group)
 * - actions (button container)
 * - date, datetime, color
 * - file, managed_file
 * 
 * Render array properties for form elements:
 * - #type: element type
 * - #title: label text
 * - #description: help text
 * - #required: boolean
 * - #default_value: initial value
 * - #options: for select/radios/checkboxes {value: label}
 * - #maxlength: for text inputs
 * - #min, #max: for numbers
 * - #rows: for textarea
 * - #weight: ordering (lower = earlier)
 * - #access: boolean (hide if false)
 * - #ajax: {callback, wrapper, effect} for dynamic updates
 * - #validate: array of validator functions
 * - #states: conditional visibility based on other fields
 */

// This file is a reference template. See core/lib/Form/ for implementation.

export class FormBase {
  constructor(services) {
    this._services = services;
  }

  /** Unique form ID. Override in subclass. */
  getFormId() {
    throw new Error('Subclass must implement getFormId()');
  }

  /** Build the form render array. Override in subclass. */
  buildForm(formState) {
    return {};
  }

  /** Validate form submission. Override in subclass. */
  validateForm(form, formState) {
    // Override for custom validation
  }

  /** Process form submission. Override in subclass. */
  async submitForm(form, formState) {
    // Override for submit handling
  }
}

export class ConfirmFormBase extends FormBase {
  getQuestion() { return 'Are you sure?'; }
  getCancelUrl() { return '/'; }
  getDescription() { return ''; }
  getConfirmText() { return 'Confirm'; }

  buildForm(formState) {
    return {
      '#title': this.getQuestion(),
      description: {
        '#type': 'markup',
        '#markup': `<p>${this.getDescription()}</p>`,
      },
      actions: {
        '#type': 'actions',
        confirm: { '#type': 'submit', '#value': this.getConfirmText() },
        cancel: { '#type': 'link', '#title': 'Cancel', '#url': this.getCancelUrl() },
      },
    };
  }
}
