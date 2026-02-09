/**
 * @file
 * Markup element type handler for raw HTML passthrough.
 *
 * The simplest element type — returns the #markup property directly with no
 * processing. Used for pre-rendered HTML strings.
 *
 * Drupal equivalent: Markup element (render element plugin)
 *
 * @see .autoforge/templates/render-element.js for usage examples
 */

/**
 * Markup element type handler.
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
  type: 'markup',

  /**
   * Render markup element.
   *
   * WHY: Raw HTML passthrough. No processing, no children, no attributes.
   * This is the fastest element type — just return the string.
   *
   * @param {Object} element - Render array with #markup property
   * @param {Object} renderer - Renderer instance (unused for markup)
   * @returns {Promise<string>} The markup string
   */
  async render(element, renderer) {
    const markup = element['#markup'];

    // WHY: Safety check — if #markup is missing or not a string, return empty.
    // This prevents undefined from appearing in output.
    if (typeof markup !== 'string') {
      return '';
    }

    // WHY: Direct passthrough. No escaping, no processing. The caller is
    // responsible for ensuring the HTML is safe.
    return markup;
  }
};
