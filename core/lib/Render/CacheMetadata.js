/**
 * @file
 * Cache metadata for render arrays.
 *
 * CacheMetadata encapsulates cache tags, contexts, and max-age for a render
 * array. As render arrays are rendered recursively, cache metadata bubbles up
 * from children to parents, enabling proper cache invalidation and variation.
 *
 * Drupal equivalent: CacheableMetadata.php, CacheableDependencyInterface.php
 *
 * @see .autoforge/templates/render-element.js for render array convention
 */

const TAGS = Symbol('tags');
const CONTEXTS = Symbol('contexts');
const MAX_AGE = Symbol('maxAge');

export class CacheMetadata {
  /**
   * Create cache metadata.
   *
   * WHY: Cache metadata flows through the render tree. As children render,
   * their cache metadata merges into parents. This allows deep dependencies
   * (e.g., a field accessing a referenced entity) to bubble cache tags up to
   * the page level, ensuring proper invalidation.
   *
   * @param {Object} options - Cache metadata options
   * @param {Array<string>|Set<string>} [options.tags] - Cache tags (e.g., 'node:42')
   * @param {Array<string>|Set<string>} [options.contexts] - Cache contexts (e.g., 'user.permissions')
   * @param {number} [options.max_age] - Max age in seconds (-1 = uncacheable)
   */
  constructor(options = {}) {
    // WHY: Use Sets for automatic deduplication during merge operations
    this[TAGS] = new Set(options.tags || []);
    this[CONTEXTS] = new Set(options.contexts || []);

    // WHY: Default to -1 (uncacheable) for safety. Explicit cacheability
    // must be declared, not assumed.
    this[MAX_AGE] = options.max_age !== undefined ? options.max_age : -1;
  }

  /**
   * Get cache tags.
   *
   * @returns {Set<string>} Cache tags
   */
  get tags() {
    return this[TAGS];
  }

  /**
   * Get cache contexts.
   *
   * @returns {Set<string>} Cache contexts
   */
  get contexts() {
    return this[CONTEXTS];
  }

  /**
   * Get max age.
   *
   * @returns {number} Max age in seconds
   */
  get maxAge() {
    return this[MAX_AGE];
  }

  /**
   * Merge another CacheMetadata into this one.
   *
   * WHY: As render arrays render recursively, child cache metadata merges
   * into parents. Union tags and contexts (all dependencies must propagate),
   * take minimum max_age (most restrictive caching wins).
   *
   * @param {CacheMetadata} other - Cache metadata to merge
   * @returns {CacheMetadata} This instance for chaining
   */
  merge(other) {
    if (!other) {
      return this;
    }

    // WHY: Union tags - all cache tags from children must propagate to parent
    // so invalidating any deep dependency invalidates the entire tree
    for (const tag of other.tags) {
      this[TAGS].add(tag);
    }

    // WHY: Union contexts - if any child varies by a context, parent must too
    for (const context of other.contexts) {
      this[CONTEXTS].add(context);
    }

    // WHY: Take minimum max_age - most restrictive caching wins. If any child
    // is uncacheable (-1), parent becomes uncacheable. If child expires in
    // 5 minutes and parent in 1 hour, use 5 minutes.
    if (this[MAX_AGE] === -1 || other.maxAge === -1) {
      this[MAX_AGE] = -1;
    } else {
      this[MAX_AGE] = Math.min(this[MAX_AGE], other.maxAge);
    }

    return this;
  }

  /**
   * Create CacheMetadata from a render array's #cache property.
   *
   * WHY: Static factory for extracting cache metadata from render arrays.
   * Centralizes the #cache property reading logic.
   *
   * @param {Object} element - Render array
   * @returns {CacheMetadata} Cache metadata instance
   */
  static createFromRenderArray(element) {
    if (!element || !element['#cache']) {
      return new CacheMetadata();
    }

    const cache = element['#cache'];
    return new CacheMetadata({
      tags: cache.tags || [],
      contexts: cache.contexts || [],
      max_age: cache.max_age !== undefined ? cache.max_age : -1,
    });
  }

  /**
   * Apply this cache metadata to a render array's #cache property.
   *
   * WHY: After bubbling cache metadata up the tree, write it back to the
   * render array so subsequent operations can access it.
   *
   * @param {Object} element - Render array to apply metadata to
   * @returns {CacheMetadata} This instance for chaining
   */
  applyTo(element) {
    if (!element) {
      return this;
    }

    // WHY: Convert Sets back to arrays for JSON serialization and
    // consistency with render array convention
    element['#cache'] = {
      tags: Array.from(this[TAGS]),
      contexts: Array.from(this[CONTEXTS]),
      max_age: this[MAX_AGE],
    };

    return this;
  }

  /**
   * Clone this cache metadata.
   *
   * WHY: Useful for creating independent copies when branching render trees.
   *
   * @returns {CacheMetadata} New instance with same metadata
   */
  clone() {
    return new CacheMetadata({
      tags: Array.from(this[TAGS]),
      contexts: Array.from(this[CONTEXTS]),
      max_age: this[MAX_AGE],
    });
  }

  /**
   * Check if this metadata allows caching.
   *
   * @returns {boolean} True if max_age >= 0
   */
  isCacheable() {
    return this[MAX_AGE] >= 0;
  }

  /**
   * Convert to plain object for debugging.
   *
   * @returns {Object} Plain object representation
   */
  toJSON() {
    return {
      tags: Array.from(this[TAGS]),
      contexts: Array.from(this[CONTEXTS]),
      max_age: this[MAX_AGE],
    };
  }

  /**
   * Normalize maxAge: convert Infinity to -1 (uncacheable).
   *
   * WHY: When collecting cache metadata, we start with Infinity to allow
   * minimum operations to work correctly. At the end, if no children specified
   * a max_age, Infinity should become -1 (uncacheable by default).
   *
   * @returns {CacheMetadata} This instance for chaining
   */
  normalize() {
    if (this[MAX_AGE] === Infinity) {
      this[MAX_AGE] = -1;
    }
    return this;
  }
}
