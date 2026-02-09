/**
 * @file
 * Container element type handler for wrapping children in a div.
 *
 * The default wrapper element. Renders children inside a <div> with attributes.
 * If there are no children and no #markup, renders nothing.
 *
 * Drupal equivalent: Container element (render element plugin)
 *
 * @see .autoforge/templates/render-element.js for usage examples
 */

import { Attribute } from '../Attribute.js';

/**
 * Container element type handler.
 *
 * WHY: Export object with type and render method. This pattern allows the
 * Renderer to register handlers by type and dispatch to them.
 */
export default {
  /**
   * Element type identifier.
   *
   * WHY: Used by Renderer to map #type values to handlers.
   */
  type: 'container',

  /**
   * Render container element.
   *
   * WHY: Provides a semantic wrapper for grouping related content. Used
   * extensively throughout the CMS for organizing page sections, forms, etc.
   *
   * @param {Object} element - Render array with #attributes and children
   * @param {Object} renderer - Renderer instance for recursive child rendering
   * @returns {Promise<string>} HTML string
   */
  async render(element, renderer) {
    const attributes = element['#attributes'] || {};

    // WHY: Render children first to check if we have any content.
    // Empty containers should not render wrapper divs.
    const childrenHtml = await renderer.renderChildren(element);

    // WHY: If no children and no #markup, render nothing.
    // Empty divs clutter the DOM without providing value.
    if (!childrenHtml && !element['#markup']) {
      return '';
    }

    // WHY: Convert attributes object to HTML attribute string.
    const attrStr = new Attribute(attributes).toString();

    // WHY: Combine #markup (if present) with rendered children.
    // #markup provides direct HTML content alongside child render arrays.
    const markup = element['#markup'] || '';
    const content = markup + childrenHtml;

    // WHY: Wrap content in a div with attributes.
    // Container always uses <div> — it's the most semantically neutral wrapper.
    return `<div${attrStr}>${content}</div>`;
  }
};
