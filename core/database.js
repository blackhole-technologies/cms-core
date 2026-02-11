/**
 * Database Abstraction Layer
 * Version: 1.0.0
 *
 * Provides Drupal-style query builder over JSON file storage.
 * Simulates SQL semantics for familiar API.
 *
 * Storage structure:
 *   content/_tables/
 *     node.json       // [{ nid: 1, type: 'article', ... }, ...]
 *     users.json
 *     taxonomy_term.json
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default storage path
const STORAGE_PATH = path.join(__dirname, '..', 'content', '_tables');

/**
 * Database class - main entry point
 */
export class Database {
  constructor(storagePath = STORAGE_PATH) {
    this.storagePath = storagePath;
    this.transactionStack = [];
    this.inTransaction = false;
  }

  /**
   * Initialize database (create storage directory)
   */
  async initialize() {
    try {
      await fs.mkdir(this.storagePath, { recursive: true });
    } catch (error) {
      throw new DatabaseError(`Failed to initialize database: ${error.message}`);
    }
  }

  /**
   * Create SELECT query
   */
  select(table, alias = null) {
    return new SelectQuery(this, table, alias);
  }

  /**
   * Create INSERT query
   */
  insert(table) {
    return new InsertQuery(this, table);
  }

  /**
   * Create UPDATE query
   */
  update(table) {
    return new UpdateQuery(this, table);
  }

  /**
   * Create DELETE query
   */
  delete(table) {
    return new DeleteQuery(this, table);
  }

  /**
   * Get schema manager
   */
  schema() {
    return new Schema(this);
  }

  /**
   * Start transaction
   */
  async transaction() {
    this.inTransaction = true;
    this.transactionStack.push({});
  }

  /**
   * Commit transaction
   */
  async commit() {
    if (!this.inTransaction) {
      throw new DatabaseError('No transaction in progress');
    }
    this.transactionStack.pop();
    if (this.transactionStack.length === 0) {
      this.inTransaction = false;
    }
  }

  /**
   * Rollback transaction
   */
  async rollback() {
    if (!this.inTransaction) {
      throw new DatabaseError('No transaction in progress');
    }
    // Restore from transaction snapshot (simplified - in production would restore files)
    this.transactionStack.pop();
    if (this.transactionStack.length === 0) {
      this.inTransaction = false;
    }
  }

  /**
   * Get table file path
   */
  getTablePath(table) {
    return path.join(this.storagePath, `${table}.json`);
  }

  /**
   * Load table data
   */
  async loadTable(table) {
    const tablePath = this.getTablePath(table);
    try {
      const data = await fs.readFile(tablePath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw new DatabaseError(`Failed to load table ${table}: ${error.message}`);
    }
  }

  /**
   * Save table data
   */
  async saveTable(table, data) {
    const tablePath = this.getTablePath(table);
    try {
      await fs.writeFile(tablePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      throw new DatabaseError(`Failed to save table ${table}: ${error.message}`);
    }
  }

  /**
   * Get next auto-increment ID for table
   */
  async getNextId(table, idField = 'id') {
    const data = await this.loadTable(table);
    if (data.length === 0) {
      return 1;
    }
    const maxId = Math.max(...data.map(row => row[idField] || 0));
    return maxId + 1;
  }
}

/**
 * SELECT query builder
 */
export class SelectQuery {
  constructor(db, table, alias = null) {
    this.db = db;
    this.table = table;
    this.tableAlias = alias || table;
    this.selectFields = [];
    this.conditionGroups = [new ConditionGroup()];
    this.orderByFields = [];
    this.rangeStart = null;
    this.rangeLength = null;
    this.joins = [];
    this.groupByFields = [];
    this.havingConditions = [];
    this.isDistinct = false;
  }

  /**
   * Add fields to select
   */
  fields(alias, fields = null) {
    if (fields === null) {
      // Select all fields from alias
      this.selectFields.push({ alias, field: '*' });
    } else if (Array.isArray(fields)) {
      fields.forEach(field => {
        this.selectFields.push({ alias, field, fieldAlias: null });
      });
    } else {
      // Object with field => alias mapping
      Object.entries(fields).forEach(([field, fieldAlias]) => {
        this.selectFields.push({ alias, field, fieldAlias });
      });
    }
    return this;
  }

  /**
   * Add single field
   */
  addField(alias, field, fieldAlias = null) {
    this.selectFields.push({ alias, field, fieldAlias });
    return this;
  }

  /**
   * Add condition
   */
  condition(field, value, operator = '=') {
    this.getCurrentConditionGroup().condition(field, value, operator);
    return this;
  }

  /**
   * Get current condition group
   */
  getCurrentConditionGroup() {
    return this.conditionGroups[this.conditionGroups.length - 1];
  }

  /**
   * Add WHERE condition group
   */
  where(conditionGroup) {
    this.conditionGroups[0] = conditionGroup;
    return this;
  }

  /**
   * Create OR condition group
   */
  orConditionGroup() {
    const group = new ConditionGroup('OR');
    this.getCurrentConditionGroup().addGroup(group);
    return group;
  }

  /**
   * Create AND condition group
   */
  andConditionGroup() {
    const group = new ConditionGroup('AND');
    this.getCurrentConditionGroup().addGroup(group);
    return group;
  }

  /**
   * Add IS NULL condition
   */
  isNull(field) {
    this.getCurrentConditionGroup().isNull(field);
    return this;
  }

  /**
   * Add IS NOT NULL condition
   */
  isNotNull(field) {
    this.getCurrentConditionGroup().isNotNull(field);
    return this;
  }

  /**
   * Add ORDER BY
   */
  orderBy(field, direction = 'ASC') {
    this.orderByFields.push({ field, direction: direction.toUpperCase() });
    return this;
  }

  /**
   * Order randomly
   */
  orderRandom() {
    this.orderByFields.push({ field: null, direction: 'RANDOM' });
    return this;
  }

  /**
   * Set range (LIMIT/OFFSET)
   */
  range(start, length) {
    this.rangeStart = start;
    this.rangeLength = length;
    return this;
  }

  /**
   * Add JOIN
   */
  join(table, alias, condition, type = 'INNER') {
    this.joins.push({ table, alias, condition, type });
    return this;
  }

  /**
   * Add LEFT JOIN
   */
  leftJoin(table, alias, condition) {
    return this.join(table, alias, condition, 'LEFT');
  }

  /**
   * Add RIGHT JOIN
   */
  rightJoin(table, alias, condition) {
    return this.join(table, alias, condition, 'RIGHT');
  }

  /**
   * Add INNER JOIN
   */
  innerJoin(table, alias, condition) {
    return this.join(table, alias, condition, 'INNER');
  }

  /**
   * Add GROUP BY
   */
  groupBy(field) {
    this.groupByFields.push(field);
    return this;
  }

  /**
   * Add HAVING condition
   */
  havingCondition(field, value, operator = '=') {
    this.havingConditions.push({ field, value, operator });
    return this;
  }

  /**
   * Set DISTINCT
   */
  distinct() {
    this.isDistinct = true;
    return this;
  }

  /**
   * Create count query
   */
  countQuery() {
    const countQuery = new SelectQuery(this.db, this.table, this.tableAlias);
    countQuery.conditionGroups = this.conditionGroups;
    countQuery.joins = this.joins;
    countQuery.addField(this.tableAlias, 'COUNT(*)', 'count');
    return countQuery;
  }

  /**
   * Execute query
   */
  async execute() {
    // Load main table
    let rows = await this.db.loadTable(this.table);

    // Apply joins
    if (this.joins.length > 0) {
      rows = await this.applyJoins(rows);
    }

    // Apply conditions
    rows = this.applyConditions(rows);

    // Apply GROUP BY
    if (this.groupByFields.length > 0) {
      rows = this.applyGroupBy(rows);
    }

    // Apply HAVING
    if (this.havingConditions.length > 0) {
      rows = this.applyHaving(rows);
    }

    // Apply ORDER BY
    if (this.orderByFields.length > 0) {
      rows = this.applyOrderBy(rows);
    }

    // Apply DISTINCT
    if (this.isDistinct) {
      rows = this.applyDistinct(rows);
    }

    // Apply RANGE (LIMIT/OFFSET)
    if (this.rangeStart !== null || this.rangeLength !== null) {
      const start = this.rangeStart || 0;
      const end = this.rangeLength !== null ? start + this.rangeLength : undefined;
      rows = rows.slice(start, end);
    }

    // Select fields
    rows = this.selectFieldsFromRows(rows);

    return new ResultSet(rows);
  }

  /**
   * Apply joins to rows
   */
  async applyJoins(rows) {
    for (const join of this.joins) {
      const joinTable = await this.db.loadTable(join.table);
      const newRows = [];

      for (const row of rows) {
        const matchingRows = joinTable.filter(joinRow => {
          return this.evaluateJoinCondition(row, joinRow, join.condition);
        });

        if (matchingRows.length === 0 && (join.type === 'LEFT' || join.type === 'RIGHT')) {
          // For outer joins, include row with null joined fields
          newRows.push({ ...row, [join.alias]: null });
        } else {
          matchingRows.forEach(joinRow => {
            newRows.push({ ...row, [join.alias]: joinRow });
          });
        }
      }

      rows = newRows;
    }

    return rows;
  }

  /**
   * Evaluate join condition
   */
  evaluateJoinCondition(leftRow, rightRow, condition) {
    // Parse condition like "n.uid = u.uid"
    const match = condition.match(/^(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)$/);
    if (!match) {
      throw new DatabaseError(`Invalid join condition: ${condition}`);
    }

    const [, leftAlias, leftField, rightAlias, rightField] = match;

    const leftValue = this.getFieldValue(leftRow, leftAlias, leftField);
    const rightValue = this.getFieldValue(rightRow, rightAlias, rightField);

    return leftValue === rightValue;
  }

  /**
   * Get field value from row with alias support
   */
  getFieldValue(row, alias, field) {
    if (alias === this.tableAlias) {
      return row[field];
    }

    // Check if it's a joined table
    const join = this.joins.find(j => j.alias === alias);
    if (join && row[alias]) {
      return row[alias][field];
    }

    return row[field];
  }

  /**
   * Apply conditions to rows
   */
  applyConditions(rows) {
    return rows.filter(row => {
      return this.conditionGroups[0].evaluate(row, this.tableAlias);
    });
  }

  /**
   * Apply GROUP BY
   */
  applyGroupBy(rows) {
    const groups = {};

    rows.forEach(row => {
      const key = this.groupByFields.map(field => {
        const fieldName = field.replace(`${this.tableAlias}.`, '');
        return row[fieldName];
      }).join('|');

      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(row);
    });

    // Return first row from each group (simplified - real implementation would handle aggregates)
    return Object.values(groups).map(group => group[0]);
  }

  /**
   * Apply HAVING conditions
   */
  applyHaving(rows) {
    return rows.filter(row => {
      return this.havingConditions.every(condition => {
        const fieldName = condition.field.replace(`${this.tableAlias}.`, '');
        return this.evaluateOperator(row[fieldName], condition.value, condition.operator);
      });
    });
  }

  /**
   * Apply ORDER BY
   */
  applyOrderBy(rows) {
    if (this.orderByFields.some(f => f.direction === 'RANDOM')) {
      return rows.sort(() => Math.random() - 0.5);
    }

    return rows.sort((a, b) => {
      for (const orderField of this.orderByFields) {
        const fieldName = orderField.field.replace(`${this.tableAlias}.`, '');
        const aVal = a[fieldName];
        const bVal = b[fieldName];

        let comparison = 0;
        if (aVal < bVal) comparison = -1;
        if (aVal > bVal) comparison = 1;

        if (comparison !== 0) {
          return orderField.direction === 'DESC' ? -comparison : comparison;
        }
      }
      return 0;
    });
  }

  /**
   * Apply DISTINCT
   */
  applyDistinct(rows) {
    const seen = new Set();
    return rows.filter(row => {
      const key = JSON.stringify(row);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * Select specific fields from rows
   */
  selectFieldsFromRows(rows) {
    if (this.selectFields.length === 0) {
      return rows;
    }

    return rows.map(row => {
      const newRow = {};

      this.selectFields.forEach(({ alias, field, fieldAlias }) => {
        if (field === '*') {
          // Select all fields from alias
          if (alias === this.tableAlias) {
            Object.assign(newRow, row);
          } else {
            const join = this.joins.find(j => j.alias === alias);
            if (join && row[alias]) {
              Object.assign(newRow, row[alias]);
            }
          }
        } else if (field.startsWith('COUNT(')) {
          // Handle COUNT aggregate
          newRow[fieldAlias || 'count'] = rows.length;
        } else {
          const value = this.getFieldValue(row, alias, field);
          newRow[fieldAlias || field] = value;
        }
      });

      return newRow;
    });
  }

  /**
   * Evaluate operator
   */
  evaluateOperator(fieldValue, value, operator) {
    switch (operator.toUpperCase()) {
      case '=':
        return fieldValue === value;
      case '<>':
      case '!=':
        return fieldValue !== value;
      case '<':
        return fieldValue < value;
      case '<=':
        return fieldValue <= value;
      case '>':
        return fieldValue > value;
      case '>=':
        return fieldValue >= value;
      case 'IN':
        return Array.isArray(value) && value.includes(fieldValue);
      case 'NOT IN':
        return Array.isArray(value) && !value.includes(fieldValue);
      case 'LIKE':
        const pattern = value.replace(/%/g, '.*').replace(/_/g, '.');
        return new RegExp(`^${pattern}$`, 'i').test(String(fieldValue));
      case 'BETWEEN':
        return Array.isArray(value) && fieldValue >= value[0] && fieldValue <= value[1];
      default:
        throw new DatabaseError(`Unsupported operator: ${operator}`);
    }
  }
}

/**
 * INSERT query builder
 */
export class InsertQuery {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.insertFields = {};
  }

  /**
   * Set fields to insert
   */
  fields(fields) {
    this.insertFields = fields;
    return this;
  }

  /**
   * Execute insert
   */
  async execute() {
    const rows = await this.db.loadTable(this.table);

    // Auto-generate ID if not provided
    if (!this.insertFields.id && !this.insertFields.nid && !this.insertFields.uid) {
      const idField = this.table === 'node' ? 'nid' : this.table === 'users' ? 'uid' : 'id';
      this.insertFields[idField] = await this.db.getNextId(this.table, idField);
    }

    // Add timestamps
    const now = Math.floor(Date.now() / 1000);
    if (!this.insertFields.created) {
      this.insertFields.created = now;
    }
    if (!this.insertFields.changed) {
      this.insertFields.changed = now;
    }

    rows.push(this.insertFields);
    await this.db.saveTable(this.table, rows);

    const idField = this.table === 'node' ? 'nid' : this.table === 'users' ? 'uid' : 'id';
    return this.insertFields[idField];
  }
}

/**
 * UPDATE query builder
 */
export class UpdateQuery {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.updateFields = {};
    this.conditionGroup = new ConditionGroup();
  }

  /**
   * Set fields to update
   */
  fields(fields) {
    this.updateFields = fields;
    return this;
  }

  /**
   * Add condition
   */
  condition(field, value, operator = '=') {
    this.conditionGroup.condition(field, value, operator);
    return this;
  }

  /**
   * Execute update
   */
  async execute() {
    const rows = await this.db.loadTable(this.table);

    // Update changed timestamp
    const now = Math.floor(Date.now() / 1000);
    if (!this.updateFields.changed) {
      this.updateFields.changed = now;
    }

    let updatedCount = 0;

    const newRows = rows.map(row => {
      if (this.conditionGroup.evaluate(row)) {
        updatedCount++;
        return { ...row, ...this.updateFields };
      }
      return row;
    });

    await this.db.saveTable(this.table, newRows);
    return updatedCount;
  }
}

/**
 * DELETE query builder
 */
export class DeleteQuery {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.conditionGroup = new ConditionGroup();
  }

  /**
   * Add condition
   */
  condition(field, value, operator = '=') {
    this.conditionGroup.condition(field, value, operator);
    return this;
  }

  /**
   * Execute delete
   */
  async execute() {
    const rows = await this.db.loadTable(this.table);

    const newRows = rows.filter(row => {
      return !this.conditionGroup.evaluate(row);
    });

    const deletedCount = rows.length - newRows.length;
    await this.db.saveTable(this.table, newRows);
    return deletedCount;
  }
}

/**
 * Condition group for complex WHERE clauses
 */
export class ConditionGroup {
  constructor(type = 'AND') {
    this.type = type; // AND or OR
    this.conditions = [];
    this.groups = [];
  }

  /**
   * Add condition
   */
  condition(field, value, operator = '=') {
    this.conditions.push({ field, value, operator });
    return this;
  }

  /**
   * Add IS NULL condition
   */
  isNull(field) {
    this.conditions.push({ field, value: null, operator: 'IS NULL' });
    return this;
  }

  /**
   * Add IS NOT NULL condition
   */
  isNotNull(field) {
    this.conditions.push({ field, value: null, operator: 'IS NOT NULL' });
    return this;
  }

  /**
   * Add nested condition group
   */
  addGroup(group) {
    this.groups.push(group);
    return this;
  }

  /**
   * Evaluate conditions against row
   */
  evaluate(row, alias = null) {
    const conditionResults = this.conditions.map(condition => {
      let fieldName = condition.field;

      // Remove alias prefix if present
      if (alias && fieldName.startsWith(`${alias}.`)) {
        fieldName = fieldName.substring(alias.length + 1);
      }

      const fieldValue = row[fieldName];

      if (condition.operator === 'IS NULL') {
        return fieldValue === null || fieldValue === undefined;
      }
      if (condition.operator === 'IS NOT NULL') {
        return fieldValue !== null && fieldValue !== undefined;
      }

      return this.evaluateOperator(fieldValue, condition.value, condition.operator);
    });

    const groupResults = this.groups.map(group => group.evaluate(row, alias));

    const allResults = [...conditionResults, ...groupResults];

    if (this.type === 'AND') {
      return allResults.every(result => result);
    } else {
      return allResults.some(result => result);
    }
  }

  /**
   * Evaluate operator (same as SelectQuery)
   */
  evaluateOperator(fieldValue, value, operator) {
    switch (operator.toUpperCase()) {
      case '=':
        return fieldValue === value;
      case '<>':
      case '!=':
        return fieldValue !== value;
      case '<':
        return fieldValue < value;
      case '<=':
        return fieldValue <= value;
      case '>':
        return fieldValue > value;
      case '>=':
        return fieldValue >= value;
      case 'IN':
        return Array.isArray(value) && value.includes(fieldValue);
      case 'NOT IN':
        return Array.isArray(value) && !value.includes(fieldValue);
      case 'LIKE':
        const pattern = value.replace(/%/g, '.*').replace(/_/g, '.');
        return new RegExp(`^${pattern}$`, 'i').test(String(fieldValue));
      case 'BETWEEN':
        return Array.isArray(value) && fieldValue >= value[0] && fieldValue <= value[1];
      default:
        throw new DatabaseError(`Unsupported operator: ${operator}`);
    }
  }
}

/**
 * Result set
 */
export class ResultSet {
  constructor(rows) {
    this.rows = rows;
    this.currentIndex = 0;
  }

  /**
   * Fetch all rows
   */
  fetchAll() {
    return this.rows;
  }

  /**
   * Fetch single row as associative array
   */
  fetchAssoc() {
    if (this.currentIndex >= this.rows.length) {
      return null;
    }
    return this.rows[this.currentIndex++];
  }

  /**
   * Fetch column values
   */
  fetchCol(column = 0) {
    if (typeof column === 'number') {
      return this.rows.map(row => Object.values(row)[column]);
    }
    return this.rows.map(row => row[column]);
  }

  /**
   * Fetch single field value
   */
  fetchField() {
    if (this.rows.length === 0) {
      return null;
    }
    const firstRow = this.rows[0];
    return Object.values(firstRow)[0];
  }

  /**
   * Fetch row as object
   */
  fetchObject() {
    if (this.currentIndex >= this.rows.length) {
      return null;
    }
    return this.rows[this.currentIndex++];
  }

  /**
   * Get row count
   */
  rowCount() {
    return this.rows.length;
  }
}

/**
 * Schema management
 */
export class Schema {
  constructor(db) {
    this.db = db;
  }

  /**
   * Create table
   */
  async createTable(name, spec) {
    const tablePath = this.db.getTablePath(name);

    // Check if table exists
    try {
      await fs.access(tablePath);
      throw new DatabaseError(`Table ${name} already exists`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    // Create empty table with schema metadata
    const tableData = {
      _schema: spec,
      _rows: []
    };

    await fs.writeFile(tablePath, JSON.stringify(tableData, null, 2), 'utf-8');
  }

  /**
   * Drop table
   */
  async dropTable(name) {
    const tablePath = this.db.getTablePath(name);

    try {
      await fs.unlink(tablePath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new DatabaseError(`Table ${name} does not exist`);
      }
      throw new DatabaseError(`Failed to drop table ${name}: ${error.message}`);
    }
  }

  /**
   * Check if table exists
   */
  async tableExists(name) {
    const tablePath = this.db.getTablePath(name);

    try {
      await fs.access(tablePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Add field to table
   */
  async addField(table, field, spec) {
    const rows = await this.db.loadTable(table);

    // Add field to all existing rows with default value
    const defaultValue = spec.default !== undefined ? spec.default : null;
    const newRows = rows.map(row => ({
      ...row,
      [field]: defaultValue
    }));

    await this.db.saveTable(table, newRows);
  }

  /**
   * Drop field from table
   */
  async dropField(table, field) {
    const rows = await this.db.loadTable(table);

    const newRows = rows.map(row => {
      const { [field]: removed, ...rest } = row;
      return rest;
    });

    await this.db.saveTable(table, newRows);
  }

  /**
   * Check if field exists
   */
  async fieldExists(table, field) {
    const rows = await this.db.loadTable(table);

    if (rows.length === 0) {
      return false;
    }

    return field in rows[0];
  }

  /**
   * Add index (metadata only in JSON implementation)
   */
  async addIndex(table, name, fields) {
    // In JSON implementation, indexes are just metadata
    // Real implementation would create index structures
    return true;
  }

  /**
   * Drop index
   */
  async dropIndex(table, name) {
    return true;
  }

  /**
   * Check if index exists
   */
  async indexExists(table, name) {
    return false;
  }

  /**
   * Add primary key
   */
  async addPrimaryKey(table, fields) {
    // Metadata only
    return true;
  }

  /**
   * Drop primary key
   */
  async dropPrimaryKey(table) {
    return true;
  }

  /**
   * Add unique key
   */
  async addUniqueKey(table, name, fields) {
    return true;
  }

  /**
   * Drop unique key
   */
  async dropUniqueKey(table, name) {
    return true;
  }

  /**
   * Change field (rename and/or modify spec)
   */
  async changeField(table, field, newName, spec) {
    const rows = await this.db.loadTable(table);

    const newRows = rows.map(row => {
      if (field !== newName) {
        const value = row[field];
        const { [field]: removed, ...rest } = row;
        return { ...rest, [newName]: value };
      }
      return row;
    });

    await this.db.saveTable(table, newRows);
  }
}

/**
 * Database error class
 */
export class DatabaseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DatabaseError';
  }
}

/**
 * Create default database instance
 */
export function createDatabase(storagePath = STORAGE_PATH) {
  return new Database(storagePath);
}

export default Database;
