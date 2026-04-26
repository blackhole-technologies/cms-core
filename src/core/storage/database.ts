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
const STORAGE_PATH: string = path.join(__dirname, '..', 'content', '_tables');

// ============================================================================
// Types
// ============================================================================

/** A single row in a table — string-keyed record with arbitrary values */
export type Row = Record<string, unknown>;

/** Specification for a select field entry */
interface SelectFieldEntry {
  alias: string;
  field: string;
  fieldAlias?: string | null;
}

/** A single condition used in WHERE / HAVING clauses */
interface Condition {
  field: string;
  value: unknown;
  operator: string;
}

/** Specification for a JOIN */
interface JoinSpec {
  table: string;
  alias: string;
  condition: string;
  type: 'INNER' | 'LEFT' | 'RIGHT';
}

/** Specification for ORDER BY */
interface OrderBySpec {
  field: string | null;
  direction: string;
}

/** Schema field specification — describes column metadata */
export interface FieldSpec {
  default?: unknown;
  [key: string]: unknown;
}

/** Table schema specification — describes the full table structure */
export interface TableSpec {
  [key: string]: unknown;
}

/** Node.js filesystem error with a `code` property */
interface NodeError extends Error {
  code?: string;
}

// ============================================================================
// Database
// ============================================================================

/**
 * Database class - main entry point
 */
export class Database {
  storagePath: string;
  transactionStack: Record<string, unknown>[];
  inTransaction: boolean;

  constructor(storagePath: string = STORAGE_PATH) {
    this.storagePath = storagePath;
    this.transactionStack = [];
    this.inTransaction = false;
  }

  /**
   * Initialize database (create storage directory)
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.storagePath, { recursive: true });
    } catch (err: unknown) {
      const error = err as NodeError;
      throw new DatabaseError(`Failed to initialize database: ${error.message}`);
    }
  }

  /**
   * Create SELECT query
   */
  select(table: string, alias: string | null = null): SelectQuery {
    return new SelectQuery(this, table, alias);
  }

  /**
   * Create INSERT query
   */
  insert(table: string): InsertQuery {
    return new InsertQuery(this, table);
  }

  /**
   * Create UPDATE query
   */
  update(table: string): UpdateQuery {
    return new UpdateQuery(this, table);
  }

  /**
   * Create DELETE query
   */
  delete(table: string): DeleteQuery {
    return new DeleteQuery(this, table);
  }

  /**
   * Get schema manager
   */
  schema(): Schema {
    return new Schema(this);
  }

  /**
   * Start transaction
   */
  async transaction(): Promise<void> {
    this.inTransaction = true;
    this.transactionStack.push({});
  }

  /**
   * Commit transaction
   */
  async commit(): Promise<void> {
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
  async rollback(): Promise<void> {
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
  getTablePath(table: string): string {
    return path.join(this.storagePath, `${table}.json`);
  }

  /**
   * Load table data
   */
  async loadTable(table: string): Promise<Row[]> {
    const tablePath = this.getTablePath(table);
    try {
      const data = await fs.readFile(tablePath, 'utf-8');
      return JSON.parse(data) as Row[];
    } catch (err: unknown) {
      const error = err as NodeError;
      if (error.code === 'ENOENT') {
        return [];
      }
      throw new DatabaseError(`Failed to load table ${table}: ${error.message}`);
    }
  }

  /**
   * Save table data
   */
  async saveTable(table: string, data: Row[]): Promise<void> {
    const tablePath = this.getTablePath(table);
    try {
      await fs.writeFile(tablePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err: unknown) {
      const error = err as NodeError;
      throw new DatabaseError(`Failed to save table ${table}: ${error.message}`);
    }
  }

  /**
   * Get next auto-increment ID for table
   */
  async getNextId(table: string, idField: string = 'id'): Promise<number> {
    const data = await this.loadTable(table);
    if (data.length === 0) {
      return 1;
    }
    const maxId = Math.max(
      ...data.map((row) => {
        const val = row[idField];
        return typeof val === 'number' ? val : 0;
      })
    );
    return maxId + 1;
  }
}

// ============================================================================
// SelectQuery
// ============================================================================

/**
 * SELECT query builder
 */
export class SelectQuery {
  private db: Database;
  private table: string;
  private tableAlias: string;
  private selectFields: SelectFieldEntry[];
  conditionGroups: ConditionGroup[];
  private orderByFields: OrderBySpec[];
  private rangeStart: number | null;
  private rangeLength: number | null;
  joins: JoinSpec[];
  private groupByFields: string[];
  private havingConditions: Condition[];
  private isDistinct: boolean;

  constructor(db: Database, table: string, alias: string | null = null) {
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
  fields(alias: string, fields: string[] | Record<string, string> | null = null): this {
    if (fields === null) {
      // Select all fields from alias
      this.selectFields.push({ alias, field: '*' });
    } else if (Array.isArray(fields)) {
      fields.forEach((field) => {
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
  addField(alias: string, field: string, fieldAlias: string | null = null): this {
    this.selectFields.push({ alias, field, fieldAlias });
    return this;
  }

  /**
   * Add condition
   */
  condition(field: string, value: unknown, operator: string = '='): this {
    this.getCurrentConditionGroup().condition(field, value, operator);
    return this;
  }

  /**
   * Get current condition group
   */
  getCurrentConditionGroup(): ConditionGroup {
    return this.conditionGroups[this.conditionGroups.length - 1]!;
  }

  /**
   * Add WHERE condition group
   */
  where(conditionGroup: ConditionGroup): this {
    this.conditionGroups[0] = conditionGroup;
    return this;
  }

  /**
   * Create OR condition group
   */
  orConditionGroup(): ConditionGroup {
    const group = new ConditionGroup('OR');
    this.getCurrentConditionGroup().addGroup(group);
    return group;
  }

  /**
   * Create AND condition group
   */
  andConditionGroup(): ConditionGroup {
    const group = new ConditionGroup('AND');
    this.getCurrentConditionGroup().addGroup(group);
    return group;
  }

  /**
   * Add IS NULL condition
   */
  isNull(field: string): this {
    this.getCurrentConditionGroup().isNull(field);
    return this;
  }

  /**
   * Add IS NOT NULL condition
   */
  isNotNull(field: string): this {
    this.getCurrentConditionGroup().isNotNull(field);
    return this;
  }

  /**
   * Add ORDER BY
   */
  orderBy(field: string, direction: string = 'ASC'): this {
    this.orderByFields.push({ field, direction: direction.toUpperCase() });
    return this;
  }

  /**
   * Order randomly
   */
  orderRandom(): this {
    this.orderByFields.push({ field: null, direction: 'RANDOM' });
    return this;
  }

  /**
   * Set range (LIMIT/OFFSET)
   */
  range(start: number, length: number): this {
    this.rangeStart = start;
    this.rangeLength = length;
    return this;
  }

  /**
   * Add JOIN
   */
  join(
    table: string,
    alias: string,
    condition: string,
    type: 'INNER' | 'LEFT' | 'RIGHT' = 'INNER'
  ): this {
    this.joins.push({ table, alias, condition, type });
    return this;
  }

  /**
   * Add LEFT JOIN
   */
  leftJoin(table: string, alias: string, condition: string): this {
    return this.join(table, alias, condition, 'LEFT');
  }

  /**
   * Add RIGHT JOIN
   */
  rightJoin(table: string, alias: string, condition: string): this {
    return this.join(table, alias, condition, 'RIGHT');
  }

  /**
   * Add INNER JOIN
   */
  innerJoin(table: string, alias: string, condition: string): this {
    return this.join(table, alias, condition, 'INNER');
  }

  /**
   * Add GROUP BY
   */
  groupBy(field: string): this {
    this.groupByFields.push(field);
    return this;
  }

  /**
   * Add HAVING condition
   */
  havingCondition(field: string, value: unknown, operator: string = '='): this {
    this.havingConditions.push({ field, value, operator });
    return this;
  }

  /**
   * Set DISTINCT
   */
  distinct(): this {
    this.isDistinct = true;
    return this;
  }

  /**
   * Create count query
   */
  countQuery(): SelectQuery {
    const countQuery = new SelectQuery(this.db, this.table, this.tableAlias);
    countQuery.conditionGroups = this.conditionGroups;
    countQuery.joins = this.joins;
    countQuery.addField(this.tableAlias, 'COUNT(*)', 'count');
    return countQuery;
  }

  /**
   * Execute query
   */
  async execute(): Promise<ResultSet> {
    // Load main table
    let rows: Row[] = await this.db.loadTable(this.table);

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
  private async applyJoins(rows: Row[]): Promise<Row[]> {
    for (const join of this.joins) {
      const joinTable: Row[] = await this.db.loadTable(join.table);
      const newRows: Row[] = [];

      for (const row of rows) {
        const matchingRows = joinTable.filter((joinRow) => {
          return this.evaluateJoinCondition(row, joinRow, join.condition);
        });

        if (matchingRows.length === 0 && (join.type === 'LEFT' || join.type === 'RIGHT')) {
          // For outer joins, include row with null joined fields
          newRows.push({ ...row, [join.alias]: null });
        } else {
          matchingRows.forEach((joinRow) => {
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
  private evaluateJoinCondition(leftRow: Row, rightRow: Row, condition: string): boolean {
    // Parse condition like "n.uid = u.uid"
    const match = condition.match(/^(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)$/);
    if (!match) {
      throw new DatabaseError(`Invalid join condition: ${condition}`);
    }

    const [, leftAlias, leftField, , rightField] = match;

    const leftValue = this.getFieldValue(leftRow, leftAlias!, leftField!);
    const rightValue = this.getFieldValue(rightRow, match[3]!, rightField!);

    return leftValue === rightValue;
  }

  /**
   * Get field value from row with alias support
   */
  private getFieldValue(row: Row, alias: string, field: string): unknown {
    if (alias === this.tableAlias) {
      return row[field];
    }

    // Check if it's a joined table
    const join = this.joins.find((j) => j.alias === alias);
    if (join && row[alias]) {
      const joinedRow = row[alias] as Row;
      return joinedRow[field];
    }

    return row[field];
  }

  /**
   * Apply conditions to rows
   */
  private applyConditions(rows: Row[]): Row[] {
    return rows.filter((row) => {
      return this.conditionGroups[0]!.evaluate(row, this.tableAlias);
    });
  }

  /**
   * Apply GROUP BY
   */
  private applyGroupBy(rows: Row[]): Row[] {
    const groups: Record<string, Row[]> = {};

    rows.forEach((row) => {
      const key = this.groupByFields
        .map((field) => {
          const fieldName = field.replace(`${this.tableAlias}.`, '');
          return row[fieldName];
        })
        .join('|');

      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key]!.push(row);
    });

    // Return first row from each group (simplified - real implementation would handle aggregates)
    return Object.values(groups).map((group) => group[0]!);
  }

  /**
   * Apply HAVING conditions
   */
  private applyHaving(rows: Row[]): Row[] {
    return rows.filter((row) => {
      return this.havingConditions.every((condition) => {
        const fieldName = condition.field.replace(`${this.tableAlias}.`, '');
        return evaluateOperator(row[fieldName], condition.value, condition.operator);
      });
    });
  }

  /**
   * Apply ORDER BY
   */
  private applyOrderBy(rows: Row[]): Row[] {
    if (this.orderByFields.some((f) => f.direction === 'RANDOM')) {
      return rows.sort(() => Math.random() - 0.5);
    }

    return rows.sort((a, b) => {
      for (const orderField of this.orderByFields) {
        const fieldName = (orderField.field ?? '').replace(`${this.tableAlias}.`, '');
        const aVal = a[fieldName];
        const bVal = b[fieldName];

        let comparison = 0;
        if ((aVal as number) < (bVal as number)) comparison = -1;
        if ((aVal as number) > (bVal as number)) comparison = 1;

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
  private applyDistinct(rows: Row[]): Row[] {
    const seen = new Set<string>();
    return rows.filter((row) => {
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
  private selectFieldsFromRows(rows: Row[]): Row[] {
    if (this.selectFields.length === 0) {
      return rows;
    }

    return rows.map((row) => {
      const newRow: Row = {};

      this.selectFields.forEach(({ alias, field, fieldAlias }) => {
        if (field === '*') {
          // Select all fields from alias
          if (alias === this.tableAlias) {
            Object.assign(newRow, row);
          } else {
            const join = this.joins.find((j) => j.alias === alias);
            if (join && row[alias]) {
              Object.assign(newRow, row[alias] as Row);
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
  evaluateOperator(fieldValue: unknown, value: unknown, operator: string): boolean {
    return evaluateOperator(fieldValue, value, operator);
  }
}

// ============================================================================
// InsertQuery
// ============================================================================

/**
 * INSERT query builder
 */
export class InsertQuery {
  private db: Database;
  private table: string;
  private insertFields: Row;

  constructor(db: Database, table: string) {
    this.db = db;
    this.table = table;
    this.insertFields = {};
  }

  /**
   * Set fields to insert
   */
  fields(fields: Row): this {
    this.insertFields = fields;
    return this;
  }

  /**
   * Execute insert
   */
  async execute(): Promise<unknown> {
    const rows = await this.db.loadTable(this.table);

    // Auto-generate ID if not provided
    if (!this.insertFields['id'] && !this.insertFields['nid'] && !this.insertFields['uid']) {
      const idField = this.table === 'node' ? 'nid' : this.table === 'users' ? 'uid' : 'id';
      this.insertFields[idField] = await this.db.getNextId(this.table, idField);
    }

    // Add timestamps
    const now = Math.floor(Date.now() / 1000);
    if (!this.insertFields['created']) {
      this.insertFields['created'] = now;
    }
    if (!this.insertFields['changed']) {
      this.insertFields['changed'] = now;
    }

    rows.push(this.insertFields);
    await this.db.saveTable(this.table, rows);

    const idField = this.table === 'node' ? 'nid' : this.table === 'users' ? 'uid' : 'id';
    return this.insertFields[idField];
  }
}

// ============================================================================
// UpdateQuery
// ============================================================================

/**
 * UPDATE query builder
 */
export class UpdateQuery {
  private db: Database;
  private table: string;
  private updateFields: Row;
  private conditionGroup: ConditionGroup;

  constructor(db: Database, table: string) {
    this.db = db;
    this.table = table;
    this.updateFields = {};
    this.conditionGroup = new ConditionGroup();
  }

  /**
   * Set fields to update
   */
  fields(fields: Row): this {
    this.updateFields = fields;
    return this;
  }

  /**
   * Add condition
   */
  condition(field: string, value: unknown, operator: string = '='): this {
    this.conditionGroup.condition(field, value, operator);
    return this;
  }

  /**
   * Execute update
   */
  async execute(): Promise<number> {
    const rows = await this.db.loadTable(this.table);

    // Update changed timestamp
    const now = Math.floor(Date.now() / 1000);
    if (!this.updateFields['changed']) {
      this.updateFields['changed'] = now;
    }

    let updatedCount = 0;

    const newRows = rows.map((row) => {
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

// ============================================================================
// DeleteQuery
// ============================================================================

/**
 * DELETE query builder
 */
export class DeleteQuery {
  private db: Database;
  private table: string;
  private conditionGroup: ConditionGroup;

  constructor(db: Database, table: string) {
    this.db = db;
    this.table = table;
    this.conditionGroup = new ConditionGroup();
  }

  /**
   * Add condition
   */
  condition(field: string, value: unknown, operator: string = '='): this {
    this.conditionGroup.condition(field, value, operator);
    return this;
  }

  /**
   * Execute delete
   */
  async execute(): Promise<number> {
    const rows = await this.db.loadTable(this.table);

    const newRows = rows.filter((row) => {
      return !this.conditionGroup.evaluate(row);
    });

    const deletedCount = rows.length - newRows.length;
    await this.db.saveTable(this.table, newRows);
    return deletedCount;
  }
}

// ============================================================================
// ConditionGroup
// ============================================================================

/**
 * Condition group for complex WHERE clauses
 */
export class ConditionGroup {
  private type: 'AND' | 'OR';
  private conditions: Condition[];
  private groups: ConditionGroup[];

  constructor(type: 'AND' | 'OR' = 'AND') {
    this.type = type; // AND or OR
    this.conditions = [];
    this.groups = [];
  }

  /**
   * Add condition
   */
  condition(field: string, value: unknown, operator: string = '='): this {
    this.conditions.push({ field, value, operator });
    return this;
  }

  /**
   * Add IS NULL condition
   */
  isNull(field: string): this {
    this.conditions.push({ field, value: null, operator: 'IS NULL' });
    return this;
  }

  /**
   * Add IS NOT NULL condition
   */
  isNotNull(field: string): this {
    this.conditions.push({ field, value: null, operator: 'IS NOT NULL' });
    return this;
  }

  /**
   * Add nested condition group
   */
  addGroup(group: ConditionGroup): this {
    this.groups.push(group);
    return this;
  }

  /**
   * Evaluate conditions against row
   */
  evaluate(row: Row, alias: string | null = null): boolean {
    const conditionResults = this.conditions.map((condition) => {
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

      return evaluateOperator(fieldValue, condition.value, condition.operator);
    });

    const groupResults = this.groups.map((group) => group.evaluate(row, alias));

    const allResults = [...conditionResults, ...groupResults];

    if (this.type === 'AND') {
      return allResults.every((result) => result);
    } else {
      return allResults.some((result) => result);
    }
  }
}

// ============================================================================
// Shared operator evaluation
// ============================================================================

/**
 * Evaluate operator — shared between SelectQuery, ConditionGroup, and HAVING
 */
function evaluateOperator(fieldValue: unknown, value: unknown, operator: string): boolean {
  switch (operator.toUpperCase()) {
    case '=':
      return fieldValue === value;
    case '<>':
    case '!=':
      return fieldValue !== value;
    case '<':
      return (fieldValue as number) < (value as number);
    case '<=':
      return (fieldValue as number) <= (value as number);
    case '>':
      return (fieldValue as number) > (value as number);
    case '>=':
      return (fieldValue as number) >= (value as number);
    case 'IN':
      return Array.isArray(value) && value.includes(fieldValue);
    case 'NOT IN':
      return Array.isArray(value) && !value.includes(fieldValue);
    case 'LIKE': {
      const pattern = String(value).replace(/%/g, '.*').replace(/_/g, '.');
      return new RegExp(`^${pattern}$`, 'i').test(String(fieldValue));
    }
    case 'BETWEEN':
      return (
        Array.isArray(value) &&
        (fieldValue as number) >= (value[0] as number) &&
        (fieldValue as number) <= (value[1] as number)
      );
    default:
      throw new DatabaseError(`Unsupported operator: ${operator}`);
  }
}

// ============================================================================
// ResultSet
// ============================================================================

/**
 * Result set
 */
export class ResultSet {
  private rows: Row[];
  private currentIndex: number;

  constructor(rows: Row[]) {
    this.rows = rows;
    this.currentIndex = 0;
  }

  /**
   * Fetch all rows
   */
  fetchAll(): Row[] {
    return this.rows;
  }

  /**
   * Fetch single row as associative array
   */
  fetchAssoc(): Row | null {
    if (this.currentIndex >= this.rows.length) {
      return null;
    }
    return this.rows[this.currentIndex++]!;
  }

  /**
   * Fetch column values
   */
  fetchCol(column: number | string = 0): unknown[] {
    if (typeof column === 'number') {
      return this.rows.map((row) => Object.values(row)[column]);
    }
    return this.rows.map((row) => row[column]);
  }

  /**
   * Fetch single field value
   */
  fetchField(): unknown {
    if (this.rows.length === 0) {
      return null;
    }
    const firstRow = this.rows[0]!;
    return Object.values(firstRow)[0];
  }

  /**
   * Fetch row as object
   */
  fetchObject(): Row | null {
    if (this.currentIndex >= this.rows.length) {
      return null;
    }
    return this.rows[this.currentIndex++]!;
  }

  /**
   * Get row count
   */
  rowCount(): number {
    return this.rows.length;
  }
}

// ============================================================================
// Schema
// ============================================================================

/**
 * Schema management
 */
export class Schema {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Create table
   */
  async createTable(name: string, spec: TableSpec): Promise<void> {
    const tablePath = this.db.getTablePath(name);

    // Check if table exists
    try {
      await fs.access(tablePath);
      throw new DatabaseError(`Table ${name} already exists`);
    } catch (err: unknown) {
      const error = err as NodeError;
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    // Create empty table with schema metadata
    const tableData = {
      _schema: spec,
      _rows: [] as Row[],
    };

    await fs.writeFile(tablePath, JSON.stringify(tableData, null, 2), 'utf-8');
  }

  /**
   * Drop table
   */
  async dropTable(name: string): Promise<void> {
    const tablePath = this.db.getTablePath(name);

    try {
      await fs.unlink(tablePath);
    } catch (err: unknown) {
      const error = err as NodeError;
      if (error.code === 'ENOENT') {
        throw new DatabaseError(`Table ${name} does not exist`);
      }
      throw new DatabaseError(`Failed to drop table ${name}: ${error.message}`);
    }
  }

  /**
   * Check if table exists
   */
  async tableExists(name: string): Promise<boolean> {
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
  async addField(table: string, field: string, spec: FieldSpec): Promise<void> {
    const rows = await this.db.loadTable(table);

    // Add field to all existing rows with default value
    const defaultValue = spec.default !== undefined ? spec.default : null;
    const newRows = rows.map((row) => ({
      ...row,
      [field]: defaultValue,
    }));

    await this.db.saveTable(table, newRows);
  }

  /**
   * Drop field from table
   */
  async dropField(table: string, field: string): Promise<void> {
    const rows = await this.db.loadTable(table);

    const newRows = rows.map((row) => {
      const { [field]: _removed, ...rest } = row;
      return rest;
    });

    await this.db.saveTable(table, newRows);
  }

  /**
   * Check if field exists
   */
  async fieldExists(table: string, field: string): Promise<boolean> {
    const rows = await this.db.loadTable(table);

    if (rows.length === 0) {
      return false;
    }

    return field in rows[0]!;
  }

  /**
   * Add index (metadata only in JSON implementation)
   */
  async addIndex(_table: string, _name: string, _fields: string[]): Promise<boolean> {
    // In JSON implementation, indexes are just metadata
    // Real implementation would create index structures
    return true;
  }

  /**
   * Drop index
   */
  async dropIndex(_table: string, _name: string): Promise<boolean> {
    return true;
  }

  /**
   * Check if index exists
   */
  async indexExists(_table: string, _name: string): Promise<boolean> {
    return false;
  }

  /**
   * Add primary key
   */
  async addPrimaryKey(_table: string, _fields: string[]): Promise<boolean> {
    // Metadata only
    return true;
  }

  /**
   * Drop primary key
   */
  async dropPrimaryKey(_table: string): Promise<boolean> {
    return true;
  }

  /**
   * Add unique key
   */
  async addUniqueKey(_table: string, _name: string, _fields: string[]): Promise<boolean> {
    return true;
  }

  /**
   * Drop unique key
   */
  async dropUniqueKey(_table: string, _name: string): Promise<boolean> {
    return true;
  }

  /**
   * Change field (rename and/or modify spec)
   */
  async changeField(
    table: string,
    field: string,
    newName: string,
    _spec: FieldSpec
  ): Promise<void> {
    const rows = await this.db.loadTable(table);

    const newRows = rows.map((row) => {
      if (field !== newName) {
        const value = row[field];
        const { [field]: _removed, ...rest } = row;
        return { ...rest, [newName]: value };
      }
      return row;
    });

    await this.db.saveTable(table, newRows);
  }
}

// ============================================================================
// DatabaseError
// ============================================================================

/**
 * Database error class
 */
export class DatabaseError extends Error {
  override name = 'DatabaseError';

  constructor(message: string) {
    super(message);
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create default database instance
 */
export function createDatabase(storagePath: string = STORAGE_PATH): Database {
  return new Database(storagePath);
}

export default Database;
