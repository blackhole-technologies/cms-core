/**
 * @file
 * HtmlTag element type handler for rendering arbitrary HTML tags.
 *
 * Renders structured elements as HTML tags with attributes, values, and children.
 * Supports both self-closing tags (br, hr, img) and normal tags (div, span, p).
 *
 * Drupal equivalent: HtmlTag element (render element plugin)
 *
 * @see .autoforge/templates/render-element.js for usage examples
 */

import { Attribute } from '../Attribute.js';

/**
 * Self-closing HTML tags that don't need closing tags.
 *
 * WHY: These tags are void elements in HTML5 — they cannot have children
 * and must not have closing tags. Rendering <br></br> is invalid.
 */
const SELF_CLOSING_TAGS = new Set([
  'br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed',
  'param', 'source', 'track', 'wbr'
]);

/**
 * HtmlTag element type handler.
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
  type: 'html_tag',

  /**
   * Render html_tag element.
   *
   * WHY: Provides structured way to generate HTML tags with attributes.
   * This is safer than string concatenation and enables attribute manipulation.
   *
   * @param {Object} element - Render array with #tag, #attributes, #value
   * @param {Object} renderer - Renderer instance for recursive child rendering
   * @returns {Promise<string>} HTML string
   */
  async render(element, renderer) {
    const tag = element['#tag'];
    const value = element['#value'];
    const attributes = element['#attributes'] || {};

    // WHY: Tag is required — without it we can't render anything meaningful.
    if (!tag) {
      return '';
    }

    // WHY: Convert attributes object to HTML attribute string using Attribute class.
    // This handles arrays, booleans, escaping, etc.
    const attrStr = new Attribute(attributes).toString();

    // WHY: Self-closing tags have no content and no closing tag.
    // Rendering <br>text</br> is invalid HTML.
    if (SELF_CLOSING_TAGS.has(tag)) {
      return `<${tag}${attrStr}>`;
    }

    // WHY: For normal tags, render opening tag, content, children, then closing tag.
    let content = '';

    // WHY: Render #value first if present (inline text content).
    if (value !== null && value !== undefined) {
      content += String(value);
    }

    // WHY: Render children recursively and append to content.
    // Children come after #value in render order.
    const childrenHtml = await renderer.renderChildren(element);
    content += childrenHtml;

    return `<${tag}${attrStr}>${content}</${tag}>`;
  }
};
