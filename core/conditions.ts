/**
 * conditions.ts - Condition Plugin System
 *
 * WHY THIS EXISTS:
 * Many CMS features need conditional logic: show block if user has role,
 * apply workflow if field equals value, send notification if condition met.
 * This provides a flexible, composable condition system with logical operators.
 *
 * Drupal equivalent: ConditionPluginBase, ConditionManager
 *
 * DESIGN DECISION:
 * - Plugin-based (extensible with custom conditions)
 * - Logical operators (AND, OR, NOT) for composition
 * - Context-based evaluation (pass runtime data)
 * - Built-in common conditions (role, permission, field checks)
 * - Debugging support (evaluation traces)
 *
 * @example Simple condition
 * ```typescript
 * const result = evaluateCondition({
 *   type: 'hasRole',
 *   role: 'admin',
 * }, { user: { roles: ['admin', 'editor'] } });
 *
 * console.log(result.passes); // true
 * ```
 *
 * @example Logical operators
 * ```typescript
 * const result = evaluateCondition({
 *   operator: 'AND',
 *   conditions: [
 *     { type: 'hasRole', role: 'editor' },
 *     { type: 'fieldEquals', field: 'status', value: 'published' },
 *   ],
 * }, context);
 * ```
 *
 * @example Negation
 * ```typescript
 * const result = evaluateCondition({
 *   negate: true,
 *   condition: { type: 'hasRole', role: 'anonymous' },
 * }, context);
 * // Passes if user does NOT have 'anonymous' role
 * ```
 */

// ============================================================================
// Types
// ============================================================================

/** Function that evaluates a condition given its config and a runtime context */
export type ConditionEvaluator = (config: ConditionConfig, context: ConditionContext) => boolean;

/** Runtime context passed to condition evaluators */
export interface ConditionContext {
  user?: {
    roles?: string[];
    permissions?: string[];
    id?: string;
    [key: string]: unknown;
  };
  currentUser?: {
    roles?: string[];
    permissions?: string[];
    [key: string]: unknown;
  };
  entity?: Record<string, unknown>;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Configuration for a single condition or logical group */
export interface ConditionConfig {
  /** Condition plugin type (e.g., 'hasRole', 'fieldEquals') */
  type?: string;
  /** Logical operator for combining conditions */
  operator?: 'AND' | 'OR';
  /** Nested conditions (used with operator) */
  conditions?: ConditionConfig[];
  /** When true, negate the inner condition */
  negate?: boolean;
  /** Inner condition to negate */
  condition?: ConditionConfig;
  /** Additional config fields passed to the evaluator */
  [key: string]: unknown;
}

/** Result of evaluating a condition */
export interface ConditionResult {
  passes: boolean;
  trace: string[];
}

/** The conditions service API object */
export interface ConditionsApi {
  registerCondition: typeof registerCondition;
  evaluateCondition: typeof evaluateCondition;
  setDebugMode: typeof setDebugMode;
  isDebugMode: typeof isDebugMode;
  listConditionTypes: typeof listConditionTypes;
  hasConditionType: typeof hasConditionType;
  clearConditions: typeof clearConditions;
}

// ============================================================================
// State
// ============================================================================

/**
 * Condition plugin registry
 * Structure: { pluginType: evaluatorFunction }
 */
const conditionPlugins: Record<string, ConditionEvaluator> = {};

/**
 * Debug mode flag
 */
let debugMode = false;

// ============================================================================
// Public API
// ============================================================================

/**
 * Register a condition plugin
 *
 * @param type - Condition type identifier (e.g., 'hasRole', 'fieldEquals')
 * @param evaluator - Function(config, context) => boolean
 *
 * WHY FUNCTION-BASED (not class-based):
 * Condition evaluation is simple: take config and context, return boolean.
 * Function-based API is cleaner and easier to use than classes.
 */
export function registerCondition(type: string, evaluator: ConditionEvaluator): void {
  if (!type || typeof type !== 'string') {
    throw new Error('Condition type must be a non-empty string');
  }

  if (typeof evaluator !== 'function') {
    throw new Error(`Condition evaluator for "${type}" must be a function`);
  }

  conditionPlugins[type] = evaluator;
}

/**
 * Evaluate a condition
 *
 * @param conditionConfig - Condition configuration
 * @param context - Runtime context (user, entity, request, etc.)
 * @returns Object with passes boolean and trace array
 *
 * WHY RETURN TRACE:
 * Debugging complex conditions is hard. Trace shows which conditions passed/failed.
 */
export function evaluateCondition(conditionConfig: ConditionConfig, context: ConditionContext = {}): ConditionResult {
  const trace: string[] = [];

  // Handle logical operators
  if (conditionConfig.operator) {
    return evaluateLogicalOperator(conditionConfig, context, trace);
  }

  // Handle negation wrapper
  if (conditionConfig.negate && conditionConfig.condition) {
    const innerResult = evaluateCondition(conditionConfig.condition, context);
    const passes = !innerResult.passes;

    if (debugMode) {
      trace.push(`NOT (${innerResult.passes}) = ${passes}`);
      trace.push(...innerResult.trace.map(t => '  ' + t));
    }

    return { passes, trace };
  }

  // Handle single condition
  if (!conditionConfig.type) {
    throw new Error('Condition must have a type or operator');
  }

  const evaluator = conditionPlugins[conditionConfig.type];
  if (!evaluator) {
    throw new Error(
      `Unknown condition type: ${conditionConfig.type}. ` +
      `Available types: ${Object.keys(conditionPlugins).join(', ') || 'none'}`
    );
  }

  try {
    const passes = evaluator(conditionConfig, context);

    if (debugMode) {
      trace.push(`${conditionConfig.type} = ${passes}`);
    }

    return { passes, trace };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    if (debugMode) {
      trace.push(`${conditionConfig.type} = ERROR: ${message}`);
    }

    throw new Error(
      `Condition "${conditionConfig.type}" evaluation failed: ${message}`
    );
  }
}

/**
 * Evaluate logical operator (AND, OR)
 *
 * @param config - Operator configuration
 * @param context - Runtime context
 * @param trace - Debug trace
 * @returns Evaluation result with passes and trace
 */
function evaluateLogicalOperator(config: ConditionConfig, context: ConditionContext, trace: string[]): ConditionResult {
  const { operator, conditions } = config;

  if (!Array.isArray(conditions) || conditions.length === 0) {
    throw new Error(`${operator} operator requires an array of conditions`);
  }

  const results: ConditionResult[] = [];

  for (const condition of conditions) {
    const result = evaluateCondition(condition, context);
    results.push(result);

    if (debugMode) {
      trace.push(...result.trace);
    }

    // Short-circuit optimization
    if (operator === 'AND' && !result.passes) {
      break; // No need to evaluate remaining conditions
    }
    if (operator === 'OR' && result.passes) {
      break; // No need to evaluate remaining conditions
    }
  }

  let passes: boolean;
  if (operator === 'AND') {
    passes = results.every(r => r.passes);
  } else if (operator === 'OR') {
    passes = results.some(r => r.passes);
  } else {
    throw new Error(`Unknown operator: ${operator}. Use 'AND' or 'OR'`);
  }

  if (debugMode) {
    trace.push(`${operator} = ${passes}`);
  }

  return { passes, trace };
}

/**
 * Enable or disable debug mode
 *
 * @param enabled - True to enable debug traces
 */
export function setDebugMode(enabled: boolean): void {
  debugMode = Boolean(enabled);
}

/**
 * Get debug mode status
 *
 * @returns True if debug mode is enabled
 */
export function isDebugMode(): boolean {
  return debugMode;
}

/**
 * List all registered condition types
 *
 * @returns Array of condition type names
 */
export function listConditionTypes(): string[] {
  return Object.keys(conditionPlugins);
}

/**
 * Check if a condition type is registered
 *
 * @param type - Condition type
 * @returns True if type exists
 */
export function hasConditionType(type: string): boolean {
  return type in conditionPlugins;
}

/**
 * Clear all registered conditions (for testing)
 */
export function clearConditions(): void {
  for (const key of Object.keys(conditionPlugins)) {
    delete conditionPlugins[key];
  }
}

// ========================================
// Built-in Condition Plugins
// ========================================

/**
 * hasRole - Check if user has a specific role
 *
 * Config: { type: 'hasRole', role: 'admin' }
 * Context: { user: { roles: ['admin', 'editor'] } }
 */
registerCondition('hasRole', (config, context) => {
  if (!config.role) {
    throw new Error('hasRole condition requires a "role" parameter');
  }

  const user = context.user || context.currentUser;
  if (!user) {
    return false; // No user = no roles
  }

  const roles = user.roles || [];
  return roles.includes(config.role as string);
});

/**
 * hasPermission - Check if user has a specific permission
 *
 * Config: { type: 'hasPermission', permission: 'content.edit' }
 * Context: { user: { permissions: ['content.edit', 'content.delete'] } }
 */
registerCondition('hasPermission', (config, context) => {
  if (!config.permission) {
    throw new Error('hasPermission condition requires a "permission" parameter');
  }

  const user = context.user || context.currentUser;
  if (!user) {
    return false;
  }

  const permissions = user.permissions || [];
  return permissions.includes(config.permission as string);
});

/**
 * fieldEquals - Check if a field equals a specific value
 *
 * Config: { type: 'fieldEquals', field: 'status', value: 'published' }
 * Context: { entity: { status: 'published' } }
 */
registerCondition('fieldEquals', (config, context) => {
  if (!config.field) {
    throw new Error('fieldEquals condition requires a "field" parameter');
  }

  const entity = (context.entity || context.data || context) as Record<string, unknown>;
  const actualValue = resolveFieldValue(entity, config.field as string);
  const expectedValue = config.value;

  // Use loose equality for comparison (allows "123" === 123)
  // eslint-disable-next-line eqeqeq
  return actualValue == expectedValue;
});

/**
 * fieldEmpty - Check if a field is empty (null, undefined, or empty string)
 *
 * Config: { type: 'fieldEmpty', field: 'description' }
 * Context: { entity: { description: '' } }
 */
registerCondition('fieldEmpty', (config, context) => {
  if (!config.field) {
    throw new Error('fieldEmpty condition requires a "field" parameter');
  }

  const entity = (context.entity || context.data || context) as Record<string, unknown>;
  const value = resolveFieldValue(entity, config.field as string);

  return value === null || value === undefined || value === '';
});

/**
 * Helper: Resolve field value (supports nested paths like 'user.profile.name')
 *
 * @param entity - Entity or data object
 * @param path - Field path
 * @returns Field value or undefined
 */
function resolveFieldValue(entity: Record<string, unknown>, path: string): unknown {
  if (!path || typeof path !== 'string') {
    return undefined;
  }

  const parts = path.split('.');
  let current: unknown = entity;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Initialize the conditions service
 *
 * @param _context - Boot context
 * @returns The conditions API
 */
export function init(_context: unknown): ConditionsApi {
  return {
    registerCondition,
    evaluateCondition,
    setDebugMode,
    isDebugMode,
    listConditionTypes,
    hasConditionType,
    clearConditions,
  };
}

/** Services container interface for registration */
interface ServiceContainer {
  register?: (name: string, factory: () => ConditionsApi, options?: Record<string, unknown>) => void;
}

/**
 * Register with services container
 *
 * @param services - Legacy services object
 * @param container - DI container
 */
export function register(services: ServiceContainer | null, container: ServiceContainer | null): void {
  const api: ConditionsApi = {
    registerCondition,
    evaluateCondition,
    setDebugMode,
    isDebugMode,
    listConditionTypes,
    hasConditionType,
    clearConditions,
  };

  // Legacy pattern
  if (services && typeof services.register === 'function') {
    services.register('conditions', () => api);
  }

  // New container pattern
  if (container && typeof container.register === 'function') {
    container.register('conditions', () => api, {
      tags: ['plugin', 'conditions'],
      singleton: true,
    });
  }
}

// Export default API
export default {
  init,
  register,
  registerCondition,
  evaluateCondition,
  setDebugMode,
  isDebugMode,
  listConditionTypes,
  hasConditionType,
  clearConditions,
};
