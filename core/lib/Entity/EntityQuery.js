/**
 * @file
 * Fluent query builder for entity queries.
 *
 * Provides a chainable API for building complex entity queries with
 * conditions, sorting, and pagination. Storage handlers execute the
 * queries against their backend (JSON files, SQLite, etc.).
 *
 * Drupal equivalent: EntityQuery.php, QueryInterface.php
 *
 * @see .autoforge/templates/entity-storage.js for storage integration
 */

// WHY: Symbol-based private state prevents external mutation
const CONDITIONS = Symbol('conditions');
const GROUPS = Symbol('groups');
const CONJUNCTION = Symbol('conjunction');
const ROOT_GROUP = Symbol('rootGroup');
const SORTS = Symbol('sorts');
const RANGE = Symbol('range');
const COUNT_MODE = Symbol('countMode');
const ACCESS_CHECK = Symbol('accessCheck');
const ENTITY_TYPE_ID = Symbol('entityTypeId');
const STORAGE = Symbol('storage');
const ACCESS_HANDLER = Symbol('accessHandler');

/**
 * Valid query operators.
 *
 * WHY: Centralized list for validation and error messages.
 * These operators are supported by storage backends like JsonFileEntityStorage.
 */
const VALID_OPERATORS = new Set([
  '=',
  '<>',
  '!=',  // Normalized to <> internally
  '>',
  '>=',
  '<',
  '<=',
  'IN',
  'NOT IN',
  'BETWEEN',
  'IS NULL',
  'IS NOT NULL',
  'STARTS_WITH',
  'CONTAINS',
  'ENDS_WITH'
]);

/**
 * A group of conditions combined with AND or OR conjunction.
 *
 * Supports nesting via addGroup() for complex query logic like:
 * WHERE (status = 1 OR featured = 1) AND type = 'article'
 *
 * @example
 * const group = new ConditionGroup('OR');
 * group.condition('status', true).condition('featured', true);
 */
export class ConditionGroup {
  /**
   * Create a new condition group.
   *
   * @param {string} [conjunction='AND'] - Logical conjunction: 'AND' or 'OR'
   */
  constructor(conjunction = 'AND') {
    // WHY: Private arrays prevent direct mutation, ensuring integrity
    this[CONDITIONS] = [];
    this[GROUPS] = [];

    // WHY: Store conjunction for SQL/query generation
    this[CONJUNCTION] = conjunction;
  }

  /**
   * Add a condition to this group.
   *
   * WHY: Validates operators immediately to fail fast with helpful errors.
   * != is normalized to <> to match SQL standard.
   *
   * @param {string} field - Field name to filter on
   * @param {*} value - Value to compare against
   * @param {string} [operator='='] - Comparison operator
   * @returns {this} For method chaining
   * @throws {Error} If operator is invalid
   */
  condition(field, value, operator = '=') {
    // WHY: Validate operator against allowed set before adding
    if (!VALID_OPERATORS.has(operator)) {
      const ops = [...VALID_OPERATORS].sort().join(', ');
      throw new Error(
        `Invalid query operator: "${operator}". Valid operators are: ${ops}`
      );
    }

    // WHY: Normalize != to <> for SQL compatibility
    const normalizedOp = operator === '!=' ? '<>' : operator;

    this[CONDITIONS].push({
      field,
      value,
      operator: normalizedOp
    });

    return this;
  }

  /**
   * Add an "exists" condition (field IS NOT NULL).
   *
   * WHY: Syntactic sugar for a common pattern. More readable than
   * .condition('field', null, 'IS NOT NULL').
   *
   * @param {string} field - Field name
   * @returns {this} For method chaining
   */
  exists(field) {
    return this.condition(field, null, 'IS NOT NULL');
  }

  /**
   * Add a "not exists" condition (field IS NULL).
   *
   * WHY: Syntactic sugar for a common pattern.
   *
   * @param {string} field - Field name
   * @returns {this} For method chaining
   */
  notExists(field) {
    return this.condition(field, null, 'IS NULL');
  }

  /**
   * Add a nested condition group.
   *
   * WHY: Enables complex queries like: (A OR B) AND (C OR D)
   *
   * @param {ConditionGroup} conditionGroup - Nested group
   * @returns {this} For method chaining
   */
  addGroup(conditionGroup) {
    this[GROUPS].push(conditionGroup);
    return this;
  }

  /**
   * Get all conditions in this group.
   *
   * @returns {Array<{field: string, value: *, operator: string}>}
   */
  getConditions() {
    return this[CONDITIONS];
  }

  /**
   * Get all nested condition groups.
   *
   * @returns {Array<ConditionGroup>}
   */
  getGroups() {
    return this[GROUPS];
  }

  /**
   * Get the conjunction for this group.
   *
   * @returns {string} 'AND' or 'OR'
   */
  getConjunction() {
    return this[CONJUNCTION];
  }
}

/**
 * Fluent query builder for entity queries.
 *
 * Builds a query object that is executed by the storage handler.
 * Access checking is optional but recommended for security.
 *
 * WHY: Separates query building from execution. Storage backends
 * can optimize queries for their specific implementation (SQL, file scan, etc.)
 *
 * @example
 * const query = new EntityQuery('node', storage);
 * const ids = await query
 *   .accessCheck(true)
 *   .condition('type', 'article')
 *   .condition('status', true)
 *   .sort('created', 'DESC')
 *   .range(0, 10)
 *   .execute();
 */
export class EntityQuery {
  /**
   * Create a new entity query.
   *
   * @param {string} entityTypeId - Entity type ID (e.g., 'node', 'user')
   * @param {Object} storage - Storage handler with executeQuery() method
   * @param {Object} [options] - Optional configuration
   * @param {Object} [options.accessHandler] - Access handler for permission checks
   * @throws {Error} If storage lacks executeQuery() method
   */
  constructor(entityTypeId, storage, options = {}) {
    // WHY: Validate storage has required method before proceeding
    if (!storage || typeof storage.executeQuery !== 'function') {
      throw new Error(
        'EntityQuery requires a storage handler with an executeQuery() method'
      );
    }

    this[ENTITY_TYPE_ID] = entityTypeId;
    this[STORAGE] = storage;
    this[ACCESS_HANDLER] = options.accessHandler || null;

    // WHY: Root group holds all top-level conditions (AND by default)
    this[ROOT_GROUP] = new ConditionGroup('AND');

    // WHY: Track sorts, range, and query mode
    this[SORTS] = [];
    this[RANGE] = null;
    this[COUNT_MODE] = false;

    // WHY: undefined means accessCheck() was never called (triggers warning)
    // false means accessCheck(false) was explicitly called
    this[ACCESS_CHECK] = undefined;
  }

  /**
   * Add a condition to the root AND group.
   *
   * @param {string} field - Field name
   * @param {*} value - Value to compare
   * @param {string} [operator='='] - Comparison operator
   * @returns {this} For method chaining
   */
  condition(field, value, operator) {
    this[ROOT_GROUP].condition(field, value, operator);
    return this;
  }

  /**
   * Add an "exists" condition (field IS NOT NULL).
   *
   * @param {string} field - Field name
   * @returns {this} For method chaining
   */
  exists(field) {
    this[ROOT_GROUP].exists(field);
    return this;
  }

  /**
   * Add a "not exists" condition (field IS NULL).
   *
   * @param {string} field - Field name
   * @returns {this} For method chaining
   */
  notExists(field) {
    this[ROOT_GROUP].notExists(field);
    return this;
  }

  /**
   * Create and add an AND condition group.
   *
   * WHY: Returns the NEW group (not the query) so conditions are added to it.
   * This breaks the chain intentionally.
   *
   * @returns {ConditionGroup} The new AND group
   *
   * @example
   * const query = new EntityQuery('node', storage);
   * const andGroup = query.andConditionGroup();
   * andGroup.condition('status', true).condition('promoted', true);
   * query.condition('type', 'article'); // Back to main query
   */
  andConditionGroup() {
    const group = new ConditionGroup('AND');
    this[ROOT_GROUP].addGroup(group);
    return group;
  }

  /**
   * Create and add an OR condition group.
   *
   * WHY: Returns the NEW group (not the query) so conditions are added to it.
   *
   * @returns {ConditionGroup} The new OR group
   *
   * @example
   * const query = new EntityQuery('node', storage).accessCheck(false);
   * const orGroup = query.orConditionGroup();
   * orGroup.condition('status', 'published').condition('status', 'featured');
   * query.condition('type', 'article'); // Back to main query
   */
  orConditionGroup() {
    const group = new ConditionGroup('OR');
    this[ROOT_GROUP].addGroup(group);
    return group;
  }

  /**
   * Add a sort to the query.
   *
   * WHY: Multiple sorts are applied in order (first sort is primary).
   *
   * @param {string} field - Field name to sort by
   * @param {string} [direction='ASC'] - Sort direction: 'ASC' or 'DESC'
   * @returns {this} For method chaining
   * @throws {Error} If direction is invalid
   */
  sort(field, direction = 'ASC') {
    // WHY: Normalize to uppercase for compatibility with old entity.js
    // which uses lowercase 'asc'/'desc'. Accept both, store as uppercase.
    const normalized = String(direction).toUpperCase();

    // WHY: Validate direction to fail fast
    if (normalized !== 'ASC' && normalized !== 'DESC') {
      throw new Error(
        `Invalid sort direction: "${direction}". Must be "ASC" or "DESC".`
      );
    }

    this[SORTS].push({ field, direction: normalized });
    return this;
  }

  /**
   * Set pagination range.
   *
   * WHY: Applied after conditions and sorting for LIMIT/OFFSET behavior.
   *
   * @param {number} start - Starting offset (0-based)
   * @param {number} length - Number of results to return
   * @returns {this} For method chaining
   */
  range(start, length) {
    this[RANGE] = { start, length };
    return this;
  }

  /**
   * Enable count mode (return count instead of IDs).
   *
   * WHY: Storage backends can optimize COUNT queries vs full result sets.
   *
   * @returns {this} For method chaining
   */
  count() {
    this[COUNT_MODE] = true;
    return this;
  }

  /**
   * Enable or disable access checking.
   *
   * WHY: Explicit opt-in/opt-out prevents accidental security holes.
   * Calling this sets the flag so execute() won't warn.
   *
   * @param {boolean} enabled - Whether to check access permissions
   * @returns {this} For method chaining
   */
  accessCheck(enabled) {
    this[ACCESS_CHECK] = enabled;
    return this;
  }

  /**
   * Execute the query against the storage backend.
   *
   * WHY: Delegates to storage.executeQuery() so each backend can optimize.
   * Warns if accessCheck() was never called (security best practice).
   *
   * @returns {Promise<Array<string>|number>} Entity IDs or count
   */
  async execute() {
    // WHY: Warn about missing access check (undefined = never called)
    if (this[ACCESS_CHECK] === undefined) {
      console.warn(
        'Calling EntityQuery.execute() without explicitly calling .accessCheck() is deprecated.'
      );
    }

    // WHY: Storage backend handles actual query execution
    return this[STORAGE].executeQuery(this);
  }

  /**
   * Get flattened conditions from root group.
   *
   * WHY: Storage handlers read this to build actual queries.
   *
   * @returns {Array<{field: string, value: *, operator: string}>}
   */
  get _conditions() {
    return this[ROOT_GROUP].getConditions();
  }

  /**
   * Get sorts array.
   *
   * @returns {Array<{field: string, direction: string}>}
   */
  get _sorts() {
    return this[SORTS];
  }

  /**
   * Get pagination range.
   *
   * @returns {{start: number, length: number}|null}
   */
  get _range() {
    return this[RANGE];
  }

  /**
   * Get count mode flag.
   *
   * @returns {boolean}
   */
  get _count() {
    return this[COUNT_MODE];
  }

  /**
   * Get the full root condition group tree.
   *
   * WHY: Storage backends can use this for complex AND/OR logic.
   *
   * @returns {ConditionGroup}
   */
  get _rootGroup() {
    return this[ROOT_GROUP];
  }

  /**
   * Get entity type ID.
   *
   * @returns {string}
   */
  get _entityTypeId() {
    return this[ENTITY_TYPE_ID];
  }
}
