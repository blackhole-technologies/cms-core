/**
 * graphql.js - GraphQL API Layer
 *
 * WHY THIS EXISTS:
 * Provide a GraphQL API for content queries:
 * - Auto-generated schema from content types
 * - Query and mutation resolvers
 * - Nested type resolution
 * - Zero external dependencies
 *
 * DESIGN DECISIONS:
 * - Minimal GraphQL parser (subset of spec)
 * - Schema generated from content service types
 * - Reference fields auto-resolve to nested objects
 * - Authentication via request context
 */

/**
 * Configuration
 */
let config = {
  enabled: true,
  playground: true,
  introspection: true,
  maxDepth: 5,
};

/**
 * Services
 */
let contentService = null;
let authService = null;

/**
 * Cached schema
 */
let cachedSchema = null;
let cachedSchemaString = null;

/**
 * GraphQL type mappings from CMS field types
 */
/**
 * Fields that must never be exposed in API responses.
 * Prevents leaking password hashes, secrets, and tokens.
 */
const SENSITIVE_FIELDS = new Set([
  'password',
  'passwordHash',
  'password_hash',
  'secret',
  'sessionSecret',
  'apiSecret',
  'token',
  'resetToken',
  'reset_token',
]);

const TYPE_MAPPINGS = {
  string: 'String',
  text: 'String',
  markdown: 'String',
  html: 'String',
  number: 'Float',
  integer: 'Int',
  float: 'Float',
  boolean: 'Boolean',
  date: 'String',
  datetime: 'String',
  time: 'String',
  email: 'String',
  url: 'String',
  slug: 'String',
  select: 'String',
  multiselect: '[String]',
  reference: null, // Resolved to actual type
  file: 'String',
  image: 'String',
  json: 'JSON',
  array: '[String]',
};

/**
 * Initialize GraphQL service
 *
 * @param {Object} content - Content service
 * @param {Object} auth - Auth service (optional)
 * @param {Object} graphqlConfig - Configuration
 */
export function init(content, auth = null, graphqlConfig = {}) {
  contentService = content;
  authService = auth;
  config = { ...config, ...graphqlConfig };

  // Clear cached schema
  cachedSchema = null;
  cachedSchemaString = null;
}

/**
 * Build GraphQL schema from content types
 *
 * @returns {Object} Schema object with types, queries, mutations
 */
export function buildSchema() {
  if (cachedSchema) return cachedSchema;

  const types = contentService.listTypes();
  const schema = {
    types: {},
    queries: {},
    mutations: {},
    inputTypes: {},
  };

  // Build type definitions for each content type
  for (const { type, schema: fieldSchema } of types) {
    const typeName = capitalizeFirst(type);
    const fields = {};
    const inputFields = {};

    // Standard fields
    fields.id = { type: 'ID', required: true };
    fields.created = { type: 'String' };
    fields.updated = { type: 'String' };
    fields.status = { type: 'String' };
    fields._version = { type: 'Int' };

    // Custom fields from schema
    for (const [fieldName, fieldDef] of Object.entries(fieldSchema || {})) {
      const graphqlType = mapFieldType(fieldDef, types);
      if (graphqlType) {
        fields[fieldName] = {
          type: graphqlType,
          required: fieldDef.required || false,
          isReference: fieldDef.type === 'reference',
          referenceTarget: fieldDef.target,
        };

        // Input type doesn't include references as nested objects
        if (fieldDef.type === 'reference') {
          inputFields[fieldName] = { type: 'ID' };
        } else {
          inputFields[fieldName] = {
            type: graphqlType.replace('!', ''), // Input fields not required
          };
        }
      }
    }

    schema.types[typeName] = {
      name: typeName,
      contentType: type,
      fields,
    };

    schema.inputTypes[`${typeName}Input`] = {
      name: `${typeName}Input`,
      fields: inputFields,
    };

    // Query resolvers
    schema.queries[type] = {
      type: typeName,
      args: { id: { type: 'ID', required: true } },
      resolver: createSingleResolver(type),
    };

    schema.queries[pluralize(type)] = {
      type: `[${typeName}]`,
      args: {
        limit: { type: 'Int' },
        offset: { type: 'Int' },
        status: { type: 'String' },
        sort: { type: 'String' },
        order: { type: 'String' },
      },
      resolver: createListResolver(type),
    };

    // Mutation resolvers
    schema.mutations[`create${typeName}`] = {
      type: typeName,
      args: { input: { type: `${typeName}Input`, required: true } },
      resolver: createCreateResolver(type),
    };

    schema.mutations[`update${typeName}`] = {
      type: typeName,
      args: {
        id: { type: 'ID', required: true },
        input: { type: `${typeName}Input`, required: true },
      },
      resolver: createUpdateResolver(type),
    };

    schema.mutations[`delete${typeName}`] = {
      type: 'Boolean',
      args: { id: { type: 'ID', required: true } },
      resolver: createDeleteResolver(type),
    };
  }

  cachedSchema = schema;
  return schema;
}

/**
 * Map CMS field type to GraphQL type
 *
 * @param {Object} fieldDef - Field definition
 * @param {Array} types - All content types
 * @returns {string|null}
 */
function mapFieldType(fieldDef, types) {
  if (!fieldDef || !fieldDef.type) return 'String';

  if (fieldDef.type === 'reference' && fieldDef.target) {
    // Check if target type exists
    const targetExists = types.some(t => t.type === fieldDef.target);
    if (targetExists) {
      return capitalizeFirst(fieldDef.target);
    }
    return 'ID'; // Fallback to ID if target not found
  }

  return TYPE_MAPPINGS[fieldDef.type] || 'String';
}

/**
 * Generate GraphQL schema string (SDL)
 *
 * @returns {string}
 */
export function generateSchemaString() {
  if (cachedSchemaString) return cachedSchemaString;

  const schema = buildSchema();
  const lines = [];

  lines.push('# Generated GraphQL Schema');
  lines.push('# Auto-generated from CMS content types');
  lines.push('');

  // Scalar types
  lines.push('scalar JSON');
  lines.push('');

  // Type definitions
  for (const [typeName, typeDef] of Object.entries(schema.types)) {
    lines.push(`type ${typeName} {`);
    for (const [fieldName, fieldDef] of Object.entries(typeDef.fields)) {
      const typeStr = fieldDef.required ? `${fieldDef.type}!` : fieldDef.type;
      lines.push(`  ${fieldName}: ${typeStr}`);
    }
    lines.push('}');
    lines.push('');
  }

  // Input types
  for (const [typeName, typeDef] of Object.entries(schema.inputTypes)) {
    lines.push(`input ${typeName} {`);
    for (const [fieldName, fieldDef] of Object.entries(typeDef.fields)) {
      lines.push(`  ${fieldName}: ${fieldDef.type}`);
    }
    lines.push('}');
    lines.push('');
  }

  // Query type
  lines.push('type Query {');
  for (const [queryName, queryDef] of Object.entries(schema.queries)) {
    const args = formatArgs(queryDef.args);
    lines.push(`  ${queryName}${args}: ${queryDef.type}`);
  }
  lines.push('}');
  lines.push('');

  // Mutation type
  lines.push('type Mutation {');
  for (const [mutationName, mutationDef] of Object.entries(schema.mutations)) {
    const args = formatArgs(mutationDef.args);
    lines.push(`  ${mutationName}${args}: ${mutationDef.type}`);
  }
  lines.push('}');

  cachedSchemaString = lines.join('\n');
  return cachedSchemaString;
}

/**
 * Format arguments for schema string
 *
 * @param {Object} args
 * @returns {string}
 */
function formatArgs(args) {
  if (!args || Object.keys(args).length === 0) return '';

  const argStrs = Object.entries(args).map(([name, def]) => {
    const typeStr = def.required ? `${def.type}!` : def.type;
    return `${name}: ${typeStr}`;
  });

  return `(${argStrs.join(', ')})`;
}

/**
 * Execute a GraphQL query
 *
 * @param {string} query - GraphQL query string
 * @param {Object} variables - Query variables
 * @param {Object} context - Request context (user, etc.)
 * @returns {Object} Result with data and/or errors
 */
export function executeQuery(query, variables = {}, context = {}) {
  try {
    const parsed = parseQuery(query);

    if (parsed.errors) {
      return { errors: parsed.errors };
    }

    const schema = buildSchema();
    const result = { data: {} };

    for (const operation of parsed.operations) {
      if (operation.type === 'query') {
        for (const selection of operation.selections) {
          const queryDef = schema.queries[selection.name];
          if (!queryDef) {
            return { errors: [{ message: `Unknown query: ${selection.name}` }] };
          }

          const args = resolveArgs(selection.args, variables);
          const data = queryDef.resolver(args, context);
          result.data[selection.alias || selection.name] = selectFields(
            data,
            selection.selections,
            schema,
            context,
            0
          );
        }
      } else if (operation.type === 'mutation') {
        for (const selection of operation.selections) {
          const mutationDef = schema.mutations[selection.name];
          if (!mutationDef) {
            return { errors: [{ message: `Unknown mutation: ${selection.name}` }] };
          }

          const args = resolveArgs(selection.args, variables);
          try {
            const data = mutationDef.resolver(args, context);
            result.data[selection.alias || selection.name] = selectFields(
              data,
              selection.selections,
              schema,
              context,
              0
            );
          } catch (error) {
            return { errors: [{ message: error.message }] };
          }
        }
      }
    }

    return result;
  } catch (error) {
    return { errors: [{ message: error.message }] };
  }
}

/**
 * Parse a GraphQL query string
 *
 * Minimal parser supporting:
 * - Queries and mutations
 * - Field selections
 * - Arguments
 * - Variables
 * - Aliases
 *
 * @param {string} query
 * @returns {Object}
 */
export function parseQuery(query) {
  const tokens = tokenize(query);
  const operations = [];
  let pos = 0;

  function peek() {
    return tokens[pos];
  }

  function consume(expected) {
    const token = tokens[pos];
    if (expected && token !== expected) {
      throw new Error(`Expected '${expected}', got '${token}'`);
    }
    pos++;
    return token;
  }

  function parseSelectionSet() {
    const selections = [];
    consume('{');

    while (peek() && peek() !== '}') {
      selections.push(parseField());
    }

    consume('}');
    return selections;
  }

  function parseField() {
    let name = consume();
    let alias = null;

    // Check for alias
    if (peek() === ':') {
      consume(':');
      alias = name;
      name = consume();
    }

    let args = {};
    if (peek() === '(') {
      args = parseArguments();
    }

    let selections = [];
    if (peek() === '{') {
      selections = parseSelectionSet();
    }

    return { name, alias, args, selections };
  }

  function parseArguments() {
    const args = {};
    consume('(');

    while (peek() && peek() !== ')') {
      const name = consume();
      consume(':');
      const value = parseValue();
      args[name] = value;

      if (peek() === ',') consume(',');
    }

    consume(')');
    return args;
  }

  function parseValue() {
    const token = peek();

    // Variable reference
    if (token === '$') {
      consume('$');
      return { type: 'variable', name: consume() };
    }

    // String
    if (token && token.startsWith('"')) {
      consume();
      return token.slice(1, -1);
    }

    // Number
    if (token && /^-?\d+(\.\d+)?$/.test(token)) {
      consume();
      return parseFloat(token);
    }

    // Boolean
    if (token === 'true' || token === 'false') {
      consume();
      return token === 'true';
    }

    // Null
    if (token === 'null') {
      consume();
      return null;
    }

    // Object (input type)
    if (token === '{') {
      return parseObjectValue();
    }

    // Array
    if (token === '[') {
      return parseArrayValue();
    }

    // Enum or identifier
    consume();
    return token;
  }

  function parseObjectValue() {
    const obj = {};
    consume('{');

    while (peek() && peek() !== '}') {
      const key = consume();
      consume(':');
      const value = parseValue();
      obj[key] = value;

      if (peek() === ',') consume(',');
    }

    consume('}');
    return obj;
  }

  function parseArrayValue() {
    const arr = [];
    consume('[');

    while (peek() && peek() !== ']') {
      arr.push(parseValue());
      if (peek() === ',') consume(',');
    }

    consume(']');
    return arr;
  }

  try {
    while (pos < tokens.length) {
      const token = peek();

      if (token === 'query' || token === 'mutation') {
        const type = consume();
        let name = null;
        let variables = {};

        // Optional operation name
        if (peek() && peek() !== '{' && peek() !== '(') {
          name = consume();
        }

        // Optional variables
        if (peek() === '(') {
          consume('(');
          while (peek() && peek() !== ')') {
            if (peek() === '$') {
              consume('$');
              const varName = consume();
              consume(':');
              const varType = consume();
              // Handle required types (!)
              if (peek() === '!') consume('!');
              variables[varName] = { type: varType };
            }
            if (peek() === ',') consume(',');
          }
          consume(')');
        }

        const selections = parseSelectionSet();
        operations.push({ type, name, variables, selections });
      } else if (token === '{') {
        // Shorthand query
        const selections = parseSelectionSet();
        operations.push({ type: 'query', name: null, variables: {}, selections });
      } else {
        pos++; // Skip unknown tokens
      }
    }

    return { operations };
  } catch (error) {
    return { errors: [{ message: `Parse error: ${error.message}` }] };
  }
}

/**
 * Tokenize a GraphQL query string
 *
 * @param {string} query
 * @returns {Array}
 */
function tokenize(query) {
  const tokens = [];
  let pos = 0;

  while (pos < query.length) {
    // Skip whitespace and comments
    while (pos < query.length) {
      const char = query[pos];
      if (char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === ',') {
        pos++;
      } else if (char === '#') {
        // Skip comment until newline
        while (pos < query.length && query[pos] !== '\n') pos++;
      } else {
        break;
      }
    }

    if (pos >= query.length) break;

    const char = query[pos];

    // Special characters
    if ('{}'.includes(char) || '()'.includes(char) || '[]'.includes(char) || char === ':' || char === '!' || char === '$' || char === '@') {
      tokens.push(char);
      pos++;
      continue;
    }

    // String
    if (char === '"') {
      let str = '"';
      pos++;
      while (pos < query.length && query[pos] !== '"') {
        if (query[pos] === '\\' && pos + 1 < query.length) {
          str += query[pos] + query[pos + 1];
          pos += 2;
        } else {
          str += query[pos];
          pos++;
        }
      }
      str += '"';
      pos++; // Skip closing quote
      tokens.push(str);
      continue;
    }

    // Number
    if (char === '-' || (char >= '0' && char <= '9')) {
      let num = '';
      while (pos < query.length && /[-\d.eE+]/.test(query[pos])) {
        num += query[pos];
        pos++;
      }
      tokens.push(num);
      continue;
    }

    // Identifier or keyword
    if (/[a-zA-Z_]/.test(char)) {
      let ident = '';
      while (pos < query.length && /[a-zA-Z0-9_]/.test(query[pos])) {
        ident += query[pos];
        pos++;
      }
      tokens.push(ident);
      continue;
    }

    // Unknown character - skip
    pos++;
  }

  return tokens;
}

/**
 * Resolve argument values with variables
 *
 * @param {Object} args
 * @param {Object} variables
 * @returns {Object}
 */
function resolveArgs(args, variables) {
  const resolved = {};

  for (const [name, value] of Object.entries(args)) {
    if (value && typeof value === 'object' && value.type === 'variable') {
      resolved[name] = variables[value.name];
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      resolved[name] = resolveArgs(value, variables);
    } else {
      resolved[name] = value;
    }
  }

  return resolved;
}

/**
 * Select and return only requested fields
 *
 * @param {Object|Array} data
 * @param {Array} selections
 * @param {Object} schema
 * @param {Object} context
 * @param {number} depth
 * @returns {Object|Array|null}
 */
function selectFields(data, selections, schema, context, depth) {
  if (depth > config.maxDepth) {
    return null;
  }

  if (data === null || data === undefined) {
    return null;
  }

  if (Array.isArray(data)) {
    return data.map(item => selectFields(item, selections, schema, context, depth));
  }

  if (!selections || selections.length === 0) {
    return data;
  }

  const result = {};

  for (const selection of selections) {
    const fieldName = selection.name;
    let value = data[fieldName];

    // Handle reference fields - resolve nested objects
    if (selection.selections && selection.selections.length > 0) {
      // This might be a reference field that needs resolution
      if (value && typeof value === 'string') {
        // Value is an ID, need to resolve it
        const typeName = findReferenceType(data, fieldName, schema);
        if (typeName) {
          const resolved = resolveReference(typeName, value, context);
          value = selectFields(resolved, selection.selections, schema, context, depth + 1);
        }
      } else if (value && typeof value === 'object') {
        value = selectFields(value, selection.selections, schema, context, depth + 1);
      }
    }

    result[selection.alias || fieldName] = value;
  }

  return result;
}

/**
 * Find the reference type for a field
 *
 * @param {Object} data
 * @param {string} fieldName
 * @param {Object} schema
 * @returns {string|null}
 */
function findReferenceType(data, fieldName, schema) {
  // Try to determine the content type from the data
  const contentType = data._type || data.type;
  if (contentType) {
    const typeName = capitalizeFirst(contentType);
    const typeDef = schema.types[typeName];
    if (typeDef && typeDef.fields[fieldName]) {
      const fieldDef = typeDef.fields[fieldName];
      if (fieldDef.isReference && fieldDef.referenceTarget) {
        return fieldDef.referenceTarget;
      }
    }
  }

  return null;
}

/**
 * Resolve a reference to its actual object
 *
 * @param {string} type
 * @param {string} id
 * @param {Object} context
 * @returns {Object|null}
 */
function resolveReference(type, id, context) {
  if (!contentService) return null;

  try {
    const item = contentService.read(type, id);
    if (item) {
      item._type = type;
    }
    return stripSensitive(item);
  } catch (error) {
    return null;
  }
}

/**
 * Create a single item resolver
 *
 * @param {string} type
 * @returns {Function}
 */
/**
 * Strip sensitive fields from a content item before returning via API
 *
 * @param {Object} item - Content item
 * @returns {Object} - Sanitized item
 */
function stripSensitive(item) {
  if (!item) return item;
  for (const field of SENSITIVE_FIELDS) {
    if (field in item) {
      delete item[field];
    }
  }
  return item;
}

function createSingleResolver(type) {
  return (args, context) => {
    const item = contentService.read(type, args.id);
    if (item) {
      item._type = type;
    }
    return stripSensitive(item);
  };
}

/**
 * Create a list resolver
 *
 * @param {string} type
 * @returns {Function}
 */
function createListResolver(type) {
  return (args, context) => {
    const options = {
      page: args.offset ? Math.floor(args.offset / (args.limit || 20)) + 1 : 1,
      limit: args.limit || 20,
      sort: args.sort || 'created',
      order: args.order || 'desc',
    };

    if (args.status) {
      options.filters = [{ field: 'status', op: 'eq', value: args.status }];
    }

    const result = contentService.list(type, options);
    return result.items.map(item => stripSensitive({ ...item, _type: type }));
  };
}

/**
 * Create a create resolver
 *
 * @param {string} type
 * @returns {Function}
 */
function createCreateResolver(type) {
  return (args, context) => {
    // Check authentication if auth service available
    if (authService && !context.user) {
      throw new Error('Authentication required');
    }

    const input = args.input || {};
    const result = contentService.create(type, input, {
      userId: context.user?.id,
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to create');
    }

    const item = contentService.read(type, result.id);
    if (item) {
      item._type = type;
    }
    return stripSensitive(item);
  };
}

/**
 * Create an update resolver
 *
 * @param {string} type
 * @returns {Function}
 */
function createUpdateResolver(type) {
  return (args, context) => {
    // Check authentication if auth service available
    if (authService && !context.user) {
      throw new Error('Authentication required');
    }

    const input = args.input || {};
    const result = contentService.update(type, args.id, input, {
      userId: context.user?.id,
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to update');
    }

    const item = contentService.read(type, args.id);
    if (item) {
      item._type = type;
    }
    return stripSensitive(item);
  };
}

/**
 * Create a delete resolver
 *
 * @param {string} type
 * @returns {Function}
 */
function createDeleteResolver(type) {
  return (args, context) => {
    // Check authentication if auth service available
    if (authService && !context.user) {
      throw new Error('Authentication required');
    }

    const result = contentService.delete(type, args.id, {
      userId: context.user?.id,
    });

    return result.success;
  };
}

/**
 * Get list of GraphQL types
 *
 * @returns {Array}
 */
export function listTypes() {
  const schema = buildSchema();
  return Object.entries(schema.types).map(([name, def]) => ({
    name,
    contentType: def.contentType,
    fields: Object.entries(def.fields).map(([fieldName, fieldDef]) => ({
      name: fieldName,
      type: fieldDef.type,
      required: fieldDef.required,
    })),
  }));
}

/**
 * Clear cached schema (call when content types change)
 */
export function clearCache() {
  cachedSchema = null;
  cachedSchemaString = null;
}

/**
 * Get configuration
 *
 * @returns {Object}
 */
export function getConfig() {
  return { ...config };
}

/**
 * Check if GraphQL is enabled
 *
 * @returns {boolean}
 */
export function isEnabled() {
  return config.enabled;
}

/**
 * Check if playground is enabled
 *
 * @returns {boolean}
 */
export function isPlaygroundEnabled() {
  return config.enabled && config.playground;
}

/**
 * Capitalize first letter
 *
 * @param {string} str
 * @returns {string}
 */
function capitalizeFirst(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Simple pluralize
 *
 * @param {string} str
 * @returns {string}
 */
function pluralize(str) {
  if (!str) return '';
  if (str.endsWith('y')) {
    return str.slice(0, -1) + 'ies';
  }
  if (str.endsWith('s') || str.endsWith('x') || str.endsWith('ch') || str.endsWith('sh')) {
    return str + 'es';
  }
  return str + 's';
}

/**
 * Generate GraphQL Playground HTML
 *
 * @param {string} endpoint
 * @returns {string}
 */
export function generatePlaygroundHTML(endpoint = '/graphql') {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>GraphQL Playground</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1e1e1e; color: #d4d4d4; }
    .container { display: flex; height: 100vh; }
    .sidebar { width: 300px; background: #252526; border-right: 1px solid #3c3c3c; display: flex; flex-direction: column; }
    .main { flex: 1; display: flex; flex-direction: column; }
    .header { padding: 1rem; background: #333; border-bottom: 1px solid #3c3c3c; }
    .header h1 { font-size: 1.25rem; color: #e535ab; }
    .editor-container { flex: 1; display: flex; }
    .editor { flex: 1; display: flex; flex-direction: column; }
    .editor-header { padding: 0.5rem 1rem; background: #2d2d2d; border-bottom: 1px solid #3c3c3c; font-size: 0.85rem; color: #888; }
    textarea { flex: 1; background: #1e1e1e; color: #d4d4d4; border: none; padding: 1rem; font-family: 'Monaco', 'Menlo', monospace; font-size: 14px; resize: none; outline: none; }
    .results { flex: 1; border-left: 1px solid #3c3c3c; }
    .results pre { padding: 1rem; font-family: 'Monaco', 'Menlo', monospace; font-size: 14px; white-space: pre-wrap; overflow: auto; height: calc(100% - 2rem); }
    .toolbar { padding: 0.75rem 1rem; background: #2d2d2d; border-top: 1px solid #3c3c3c; display: flex; gap: 0.5rem; }
    .btn { padding: 0.5rem 1rem; border: none; border-radius: 4px; cursor: pointer; font-size: 0.9rem; }
    .btn-primary { background: #e535ab; color: white; }
    .btn-primary:hover { background: #d42d9e; }
    .btn-secondary { background: #3c3c3c; color: #d4d4d4; }
    .btn-secondary:hover { background: #4c4c4c; }
    .schema-section { padding: 1rem; overflow: auto; flex: 1; }
    .schema-section h3 { font-size: 0.9rem; margin-bottom: 0.5rem; color: #888; }
    .type-list { list-style: none; }
    .type-list li { padding: 0.375rem 0; cursor: pointer; }
    .type-list li:hover { color: #e535ab; }
    .type-list code { font-size: 0.85rem; }
    .variables-section { border-top: 1px solid #3c3c3c; }
    .variables-section textarea { height: 120px; }
    .error { color: #f44747; }
    .success { color: #89d185; }
  </style>
</head>
<body>
  <div class="container">
    <div class="sidebar">
      <div class="header">
        <h1>GraphQL Playground</h1>
      </div>
      <div class="schema-section">
        <h3>TYPES</h3>
        <ul class="type-list" id="typeList"></ul>
      </div>
    </div>
    <div class="main">
      <div class="editor-container">
        <div class="editor">
          <div class="editor-header">Query</div>
          <textarea id="query" placeholder="# Enter your GraphQL query here
{
  greetings(limit: 5) {
    id
    name
    message
  }
}"></textarea>
          <div class="variables-section">
            <div class="editor-header">Variables (JSON)</div>
            <textarea id="variables" placeholder="{}"></textarea>
          </div>
        </div>
        <div class="results">
          <div class="editor-header">Results</div>
          <pre id="results"></pre>
        </div>
      </div>
      <div class="toolbar">
        <button class="btn btn-primary" onclick="executeQuery()">Execute (Ctrl+Enter)</button>
        <button class="btn btn-secondary" onclick="prettify()">Prettify</button>
        <button class="btn btn-secondary" onclick="clearResults()">Clear</button>
      </div>
    </div>
  </div>
  <script>
    const endpoint = '${endpoint}';

    async function executeQuery() {
      const query = document.getElementById('query').value;
      const variablesStr = document.getElementById('variables').value;
      const resultsEl = document.getElementById('results');

      let variables = {};
      try {
        if (variablesStr.trim()) {
          variables = JSON.parse(variablesStr);
        }
      } catch (e) {
        resultsEl.innerHTML = '<span class="error">Invalid JSON in variables</span>';
        return;
      }

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, variables }),
        });

        const result = await response.json();
        resultsEl.textContent = JSON.stringify(result, null, 2);

        if (result.errors) {
          resultsEl.innerHTML = '<span class="error">' + JSON.stringify(result, null, 2) + '</span>';
        }
      } catch (e) {
        resultsEl.innerHTML = '<span class="error">Request failed: ' + e.message + '</span>';
      }
    }

    function prettify() {
      const queryEl = document.getElementById('query');
      // Simple prettify - just clean up whitespace
      queryEl.value = queryEl.value
        .replace(/\\s+/g, ' ')
        .replace(/\\{ /g, '{\\n  ')
        .replace(/ \\}/g, '\\n}')
        .replace(/, /g, '\\n  ');
    }

    function clearResults() {
      document.getElementById('results').textContent = '';
    }

    // Keyboard shortcut
    document.getElementById('query').addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'Enter') {
        executeQuery();
      }
    });

    // Load schema types
    async function loadTypes() {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: '{ __types }' }),
        });
      } catch (e) {}

      // For now, just show placeholder types
      const typeList = document.getElementById('typeList');
      typeList.innerHTML = '<li><code>Query</code></li><li><code>Mutation</code></li>';
    }

    loadTypes();
  </script>
</body>
</html>`;
}
