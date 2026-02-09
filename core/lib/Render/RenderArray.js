/**
 * @file
 * Render array utility functions for CMS-Core.
 *
 * Provides static methods for working with render arrays: extracting children,
 * type checking, and normalizing with default values. All methods are static —
 * this class is never instantiated.
 *
 * Drupal equivalent: Element.php, RenderElement.php (static helper methods)
 *
 * @see .autoforge/templates/render-element.js for render array convention
 */

export class RenderArray {
  /**
   * Get child render arrays from an element, sorted by weight.
   *
   * WHY: Render arrays use '#' prefix for metadata and other properties for
   * children. This extracts children and sorts them by #weight for consistent
   * rendering order across the entire tree.
   *
   * @param {Object} element - The render array to extract children from
   * @returns {Array<[string, Object]>} Array of [key, child] pairs sorted by #weight
   */
  static children(element) {
    // WHY: Return empty array for null/undefined to allow safe iteration
    if (!element || typeof element !== 'object') {
      return [];
    }

    // WHY: Extract all properties that don't start with '#' — these are children
    const childEntries = Object.entries(element).filter(([key]) => !key.startsWith('#'));

    // WHY: Sort by #weight (default 0, lower values render first).
    // This enables control over render order without manipulating object key order.
    return childEntries.sort(([keyA, childA], [keyB, childB]) => {
      const weightA = childA?.['#weight'] ?? 0;
      const weightB = childB?.['#weight'] ?? 0;
      return weightA - weightB;
    });
  }

  /**
   * Check if a value is a render array.
   *
   * WHY: Simple type check for render arrays — any non-null object qualifies.
   * Arrays, primitives, null, and undefined are not render arrays.
   *
   * @param {*} value - Value to check
   * @returns {boolean} True if value is a non-null object
   */
  static isRenderArray(value) {
    // WHY: Objects (including arrays) are typeof 'object', so check null explicitly
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  /**
   * Normalize a render array with default values.
   *
   * WHY: Ensures all render arrays have required properties even if the
   * developer didn't specify them. Simplifies downstream code by guaranteeing
   * these properties exist.
   *
   * @param {Object} element - The render array to normalize
   * @returns {Object} The same element reference (mutated)
   */
  static normalize(element) {
    // WHY: Don't normalize non-render-arrays
    if (!this.isRenderArray(element)) {
      return element;
    }

    // WHY: #type defaults based on content. If #markup is present, assume
    // 'markup' type (raw HTML passthrough). Otherwise default to 'container'
    // (generic wrapper that renders children).
    if (element['#type'] === undefined) {
      element['#type'] = element['#markup'] !== undefined ? 'markup' : 'container';
    }

    // WHY: #weight controls sort order. Default to 0 so elements render in
    // source order unless explicitly weighted.
    if (element['#weight'] === undefined) {
      element['#weight'] = 0;
    }

    // WHY: #access controls visibility. Default to true so elements render
    // unless explicitly denied.
    if (element['#access'] === undefined) {
      element['#access'] = true;
    }

    // WHY: Return element reference for chaining, though mutation happens in place
    return element;
  }
}
