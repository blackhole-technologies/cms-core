/**
 * @file
 * Attribute class for generating HTML attribute strings from objects.
 *
 * Converts structured attribute objects into HTML-safe attribute strings.
 * Handles arrays (joined with spaces), booleans (presence/absence), string
 * escaping, and null/undefined filtering.
 *
 * Drupal equivalent: Attribute.php
 *
 * @see .autoforge/templates/render-element.js for #attributes usage
 */

const ATTRIBUTES = Symbol('attributes');

export class Attribute {
  /**
   * Create an Attribute instance.
   *
   * WHY: Store attributes in a private Symbol-keyed property to match
   * PluginManager pattern and prevent external mutation.
   *
   * @param {Object} attributes - Object of attribute name→value pairs
   */
  constructor(attributes = {}) {
    // WHY: Use Symbol for private storage to match core/lib pattern
    this[ATTRIBUTES] = { ...attributes };
  }

  /**
   * Convert attributes to HTML attribute string.
   *
   * WHY: Render arrays use structured objects for attributes. This converts
   * them to HTML-safe strings with proper escaping, space handling, and
   * boolean attribute support.
   *
   * @returns {string} HTML attribute string with leading space (e.g., ' class="a b" id="main"')
   */
  toString() {
    const attrs = this[ATTRIBUTES];
    const parts = [];

    for (const [name, value] of Object.entries(attrs)) {
      // WHY: Skip null and undefined entirely — no attribute output
      if (value === null || value === undefined) {
        continue;
      }

      // WHY: False booleans mean attribute is absent (skip)
      if (value === false) {
        continue;
      }

      // WHY: True booleans render as valueless attributes (e.g., <input disabled>)
      if (value === true) {
        parts.push(name);
        continue;
      }

      // WHY: Arrays are joined with spaces (common for class attributes)
      if (Array.isArray(value)) {
        const joined = value.filter(v => v !== null && v !== undefined).join(' ');
        if (joined) {
          parts.push(`${name}="${this._escape(joined)}"`);
        }
        continue;
      }

      // WHY: Strings are escaped and quoted
      parts.push(`${name}="${this._escape(String(value))}"`);
    }

    // WHY: Return with leading space so it can be concatenated into tags directly.
    // Empty attributes return empty string (no leading space).
    return parts.length > 0 ? ' ' + parts.join(' ') : '';
  }

  /**
   * Escape string for safe HTML attribute output.
   *
   * WHY: Prevent XSS by escaping quotes, ampersands, and angle brackets.
   * This is a minimal escape for attribute context.
   *
   * @param {string} str - String to escape
   * @returns {string} Escaped string
   */
  _escape(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Add CSS class(es) to the class attribute.
   *
   * WHY: Supports adding classes programmatically. Ensures class is always
   * an array for consistent handling.
   *
   * @param {string|Array<string>} classes - Class name(s) to add
   * @returns {this} For method chaining
   */
  addClass(classes) {
    const attrs = this[ATTRIBUTES];

    // WHY: Initialize as array if not set
    if (!attrs.class) {
      attrs.class = [];
    }

    // WHY: Ensure class is an array
    if (!Array.isArray(attrs.class)) {
      attrs.class = [attrs.class];
    }

    // WHY: Support both string and array input
    const toAdd = Array.isArray(classes) ? classes : [classes];
    attrs.class.push(...toAdd);

    return this;
  }

  /**
   * Remove CSS class from the class attribute.
   *
   * WHY: Supports removing classes programmatically.
   *
   * @param {string} className - Class name to remove
   * @returns {this} For method chaining
   */
  removeClass(className) {
    const attrs = this[ATTRIBUTES];

    if (!attrs.class) {
      return this;
    }

    // WHY: Ensure class is an array
    if (!Array.isArray(attrs.class)) {
      attrs.class = [attrs.class];
    }

    // WHY: Filter out all instances of the class
    attrs.class = attrs.class.filter(c => c !== className);

    // WHY: Clean up empty arrays
    if (attrs.class.length === 0) {
      delete attrs.class;
    }

    return this;
  }

  /**
   * Set an attribute value.
   *
   * WHY: Programmatic attribute modification.
   *
   * @param {string} name - Attribute name
   * @param {*} value - Attribute value
   * @returns {this} For method chaining
   */
  setAttribute(name, value) {
    this[ATTRIBUTES][name] = value;
    return this;
  }

  /**
   * Check if a CSS class is present.
   *
   * WHY: Conditional logic based on class presence.
   *
   * @param {string} className - Class name to check
   * @returns {boolean} True if class is present
   */
  hasClass(className) {
    const attrs = this[ATTRIBUTES];

    if (!attrs.class) {
      return false;
    }

    // WHY: Handle both string and array class values
    if (Array.isArray(attrs.class)) {
      return attrs.class.includes(className);
    }

    return attrs.class === className;
  }
}
