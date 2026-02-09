/**
 * ConfigEntity - Base class for all config entities.
 *
 * Config entities are structured configuration that can be exported, imported,
 * and versioned. Unlike content entities (user data), config entities define
 * system behavior: content types, views, image styles, roles, text formats,
 * workflows, vocabularies, blocks, menus, filter formats, languages, etc.
 *
 * Storage: config/active/{entityTypeId}.{id}.json
 * Export: config/staging/ (for deployment)
 *
 * @example
 * const entity = new ConfigEntity('node_type', {
 *   id: 'article',
 *   label: 'Article',
 *   status: true,
 * });
 *
 * entity.set('description', 'Use for articles');
 * entity.isDirty(); // true
 * entity.toJSON(); // Plain object representation
 * entity.getConfigName(); // 'node_type.article'
 */

import { randomUUID } from 'node:crypto';

// Use Symbol for truly private storage of original state
const ORIGINAL = Symbol('original');

export class ConfigEntity {
  /**
   * Create a new config entity.
   *
   * @param {string} entityTypeId - Config entity type (e.g., 'node_type', 'view')
   * @param {Object} values - Initial config values
   */
  constructor(entityTypeId, values = {}) {
    // Store entity type for getConfigName()
    this.entityTypeId = entityTypeId;

    // Core properties - generate UUID if not provided
    this.uuid = values.uuid || randomUUID();
    this.id = values.id || null;
    this.label = values.label || '';

    // Status defaults to true (enabled)
    this.status = values.status !== undefined ? values.status : true;

    // Dependencies track module/config/content dependencies
    this.dependencies = values.dependencies || {};

    // Language code defaults to English
    this.langcode = values.langcode || 'en';

    // Store all additional properties from values
    Object.keys(values).forEach(key => {
      if (!this.hasOwnProperty(key)) {
        this[key] = values[key];
      }
    });

    // Store original snapshot for dirty tracking using structuredClone
    // WHY: structuredClone creates a deep copy, so nested object changes are tracked
    this[ORIGINAL] = structuredClone(this._getCurrentState());
  }

  /**
   * Get current state as plain object for comparison.
   * WHY PRIVATE: Only used internally for dirty tracking.
   */
  _getCurrentState() {
    const state = {};
    // Capture all own properties except the original snapshot symbol
    Object.keys(this).forEach(key => {
      if (key !== 'entityTypeId') {
        state[key] = this[key];
      }
    });
    return state;
  }

  /**
   * Get a config value.
   *
   * @param {string} key - Property name
   * @returns {*} Property value
   */
  get(key) {
    return this[key];
  }

  /**
   * Set a config value.
   *
   * @param {string} key - Property name
   * @param {*} value - Property value
   * @returns {ConfigEntity} this (for chaining)
   */
  set(key, value) {
    this[key] = value;
    return this;
  }

  /**
   * Check if entity has been modified since creation/load.
   *
   * WHY: Dirty tracking enables save optimizations and prevents unnecessary writes.
   * Uses structuredClone comparison to detect deep changes.
   *
   * @returns {boolean} true if modified, false if unchanged
   */
  isDirty() {
    const current = structuredClone(this._getCurrentState());
    const original = structuredClone(this[ORIGINAL]);

    // Compare JSON representations for deep equality check
    return JSON.stringify(current) !== JSON.stringify(original);
  }

  /**
   * Serialize to plain object for JSON storage.
   *
   * @returns {Object} Plain object representation
   */
  toJSON() {
    const result = {};

    // Include all own properties except entityTypeId and Symbol
    Object.keys(this).forEach(key => {
      if (key !== 'entityTypeId') {
        result[key] = this[key];
      }
    });

    return result;
  }

  /**
   * Get config name for file storage.
   * Format: {entityTypeId}.{id}
   *
   * Example: 'node_type.article' for content type 'article'
   *
   * @returns {string} Config file name (without .json extension)
   */
  getConfigName() {
    return `${this.entityTypeId}.${this.id}`;
  }
}
