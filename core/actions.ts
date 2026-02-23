/**
 * actions.js - Actions and Rules System
 *
 * WHY THIS EXISTS:
 * ===============
 * Inspired by Drupal's Actions/Rules modules, this provides:
 * - Reusable actions (publish, email, log, etc.)
 * - Event-driven automation
 * - Conditional logic before action execution
 * - Scheduled and batched action execution
 *
 * ARCHITECTURE:
 * ============
 * Actions: Atomic operations (publish content, send email)
 * Events: Triggers that can fire actions (content created, user login)
 * Conditions: Checks that must pass before actions run
 * Rules: Event + Conditions + Actions combinations
 *
 * STORAGE:
 * =======
 * Rules stored in config/rules.json
 * Actions are registered in memory by modules
 * Events are triggered by core/modules at runtime
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as https from 'node:https';
import * as http from 'node:http';

// ============================================================================
// Types
// ============================================================================

/** Action execute function */
type ActionExecuteFn = (context: Record<string, unknown>, settings: Record<string, unknown>) => Promise<unknown>;

/** Condition evaluate function */
type ConditionEvaluateFn = (context: Record<string, unknown>, settings: Record<string, unknown>) => Promise<boolean>;

/** Action definition */
interface ActionDefinition {
  label: string;
  execute: ActionExecuteFn;
  schema: Record<string, unknown>;
}

/** Action registration config */
interface ActionConfig {
  label?: string;
  execute: ActionExecuteFn;
  schema?: Record<string, unknown>;
}

/** Event definition */
interface EventDefinition {
  label: string;
  context: Record<string, unknown>;
}

/** Event registration config */
interface EventConfig {
  label?: string;
  context?: Record<string, unknown>;
}

/** Condition definition */
interface ConditionDefinition {
  label: string;
  evaluate: ConditionEvaluateFn;
  schema: Record<string, unknown>;
}

/** Condition registration config */
interface ConditionConfig {
  label?: string;
  evaluate: ConditionEvaluateFn;
  schema?: Record<string, unknown>;
}

/** Rule condition config (stored in rules.json) */
interface RuleConditionConfig {
  plugin: string;
  settings?: Record<string, unknown>;
}

/** Rule action config (stored in rules.json) */
interface RuleActionConfig {
  plugin: string;
  settings?: Record<string, unknown>;
}

/** Rule definition */
interface Rule {
  label: string;
  event: string;
  conditions: RuleConditionConfig[];
  actions: RuleActionConfig[];
  enabled: boolean;
}

/** Rule creation config */
interface RuleConfig {
  label?: string;
  event: string;
  conditions?: RuleConditionConfig[];
  actions?: RuleActionConfig[];
  enabled?: boolean;
}

/** Scheduled action entry */
interface ScheduledAction {
  id: string;
  actionId: string;
  context: Record<string, unknown>;
  settings: Record<string, unknown>;
  executeAt: string;
  created: string;
  executed: boolean;
  executedAt?: string;
  error?: string;
}

/** Execution log entry */
interface ExecutionLogEntry {
  ruleId: string;
  context: string;
  result: unknown;
  timestamp: string;
}

/** Event trigger results */
interface TriggerResults {
  event: string;
  context: Record<string, unknown>;
  matched: number;
  executed: Array<{ rule: string; result?: unknown; error?: string }>;
}

/** Rule execution result */
interface RuleExecutionResult {
  executed: boolean;
  reason?: string;
  actions?: Array<{ action: string; result?: unknown; error?: string }>;
}

/** Batch execution result */
interface BatchResult {
  item: Record<string, unknown>;
  result?: unknown;
  error?: string;
  success: boolean;
}

/** Hooks system interface */
interface HooksSystem {
  trigger: (name: string, data: Record<string, unknown>) => Promise<void>;
  register: (name: string, handler: (ctx: Record<string, unknown>) => Promise<void>, priority?: number) => void;
}

/** Email system interface */
interface EmailSystem {
  send: (to: string, subject: string, body: string, options?: Record<string, unknown>) => Promise<void>;
}

/** Tokens system interface */
interface TokensSystem {
  replace: (str: string, context: Record<string, unknown>) => string;
}

/** Content service interface */
interface ContentService {
  update: (type: string, id: string, data: Record<string, unknown>) => Promise<void>;
  delete: (type: string, id: string) => Promise<void>;
  create: (type: string, data: Record<string, unknown>) => Promise<{ id?: string } | null>;
  clone?: (type: string, id: string) => Promise<{ id?: string } | null>;
  get: (type: string, id: string) => { tags?: string[]; [key: string]: unknown } | null;
}

/** Rules storage format */
interface RulesStorage {
  rules: Record<string, Rule>;
  scheduled?: ScheduledAction[];
  actions?: Record<string, unknown>;
}

/** Exported config format */
interface ExportedConfig {
  rules: Record<string, Rule>;
  actions: Record<string, { label: string; schema: Record<string, unknown> }>;
  events: Record<string, EventDefinition>;
  conditions: Record<string, { label: string; schema: Record<string, unknown> }>;
}

// ============================================================================
// State
// ============================================================================

/**
 * Base directory for config files
 */
let baseDir: string = '';

/**
 * Hooks system reference
 */
let hooksSystem: HooksSystem | null = null;

/**
 * Email system reference
 */
let emailSystem: EmailSystem | null = null;

/**
 * Tokens system reference
 */
let tokensSystem: TokensSystem | null = null;

/**
 * Content service reference (set via wireHooks)
 */
let contentService: ContentService | null = null;

/**
 * Registered actions
 * Structure: { actionId: { label, execute, schema } }
 */
const actions: Map<string, ActionDefinition> = new Map();

/**
 * Registered events
 * Structure: { eventId: { label, context } }
 */
const events: Map<string, EventDefinition> = new Map();

/**
 * Registered conditions
 * Structure: { conditionId: { label, evaluate, schema } }
 */
const conditions: Map<string, ConditionDefinition> = new Map();

/**
 * Loaded rules
 * Structure: { ruleId: { label, event, conditions, actions, enabled } }
 */
let rules: Record<string, Rule> = {};

/**
 * Scheduled actions queue
 */
const scheduledActions: ScheduledAction[] = [];

/**
 * Action execution log
 */
const executionLog: ExecutionLogEntry[] = [];
const MAX_LOG_SIZE: number = 1000;

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize actions system
 *
 * @param dir - Base directory
 * @param hooks - Hooks system reference
 * @param email - Email system reference
 * @param tokens - Tokens system reference
 */
export function init(dir: string, hooks: HooksSystem | null = null, email: EmailSystem | null = null, tokens: TokensSystem | null = null): void {
  baseDir = dir;
  hooksSystem = hooks;
  emailSystem = email;
  tokensSystem = tokens;

  // Ensure config directory exists
  const configDir = join(baseDir, 'config');
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  // Load rules from storage
  loadRules();

  // Register built-in actions
  registerBuiltInActions();

  // Register built-in conditions
  registerBuiltInConditions();

  // Register built-in events
  registerBuiltInEvents();

  console.log('[actions] Initialized');
}

// ============================================================================
// Action Registry
// ============================================================================

/**
 * Register an action
 *
 * @param id - Action ID (e.g., 'content:publish')
 * @param config - Action configuration
 */
export function registerAction(id: string, config: ActionConfig): void {
  if (!id || !config.execute) {
    throw new Error('Action must have id and execute function');
  }

  actions.set(id, {
    label: config.label || id,
    execute: config.execute,
    schema: config.schema || {}
  });

  if (hooksSystem) {
    hooksSystem.trigger('action:registered', { id, config });
  }
}

/**
 * Get all registered actions
 *
 * @returns Actions map
 */
export function getActions(): Record<string, ActionDefinition> {
  return Object.fromEntries(actions);
}

/**
 * Get specific action
 *
 * @param id - Action ID
 * @returns Action config or null
 */
export function getAction(id: string): ActionDefinition | null {
  return actions.get(id) || null;
}

// ============================================================================
// Event Registry
// ============================================================================

/**
 * Register an event
 *
 * @param id - Event ID (e.g., 'content:publish')
 * @param config - Event configuration
 */
export function registerEvent(id: string, config: EventConfig): void {
  if (!id) {
    throw new Error('Event must have id');
  }

  events.set(id, {
    label: config.label || id,
    context: config.context || {}
  });

  if (hooksSystem) {
    hooksSystem.trigger('event:registered', { id, config });
  }
}

/**
 * Get all registered events
 *
 * @returns Events map
 */
// WHY: Named getEventsMap to avoid collision with analytics getEvents.
// The original JS used the same name 'getEvents' which shadows the analytics one.
export function getEvents(): Record<string, EventDefinition> {
  return Object.fromEntries(events);
}

// ============================================================================
// Condition Registry
// ============================================================================

/**
 * Register a condition
 *
 * @param id - Condition ID (e.g., 'content_type')
 * @param config - Condition configuration
 */
export function registerCondition(id: string, config: ConditionConfig): void {
  if (!id || !config.evaluate) {
    throw new Error('Condition must have id and evaluate function');
  }

  conditions.set(id, {
    label: config.label || id,
    evaluate: config.evaluate,
    schema: config.schema || {}
  });

  if (hooksSystem) {
    hooksSystem.trigger('condition:registered', { id, config });
  }
}

/**
 * Get all registered conditions
 *
 * @returns Conditions map
 */
export function getConditions(): Record<string, ConditionDefinition> {
  return Object.fromEntries(conditions);
}

// ============================================================================
// Rule Management
// ============================================================================

/**
 * Create a new rule
 *
 * @param id - Rule ID
 * @param config - Rule configuration
 * @returns Created rule
 */
export function createRule(id: string, config: RuleConfig): Rule {
  if (rules[id]) {
    throw new Error(`Rule "${id}" already exists`);
  }

  const rule: Rule = {
    label: config.label || id,
    event: config.event,
    conditions: config.conditions || [],
    actions: config.actions || [],
    enabled: config.enabled !== false
  };

  rules[id] = rule;
  saveRules();

  if (hooksSystem) {
    hooksSystem.trigger('rule:created', { id, rule });
  }

  return rule;
}

/**
 * Update an existing rule
 *
 * @param id - Rule ID
 * @param config - Updated configuration
 * @returns Updated rule
 */
export function updateRule(id: string, config: Partial<Rule>): Rule {
  if (!rules[id]) {
    throw new Error(`Rule "${id}" not found`);
  }

  rules[id] = {
    ...rules[id],
    ...config
  };

  saveRules();

  if (hooksSystem) {
    hooksSystem.trigger('rule:updated', { id, rule: rules[id] });
  }

  return rules[id];
}

/**
 * Delete a rule
 *
 * @param id - Rule ID
 */
export function deleteRule(id: string): void {
  if (!rules[id]) {
    throw new Error(`Rule "${id}" not found`);
  }

  const rule = rules[id];
  delete rules[id];
  saveRules();

  if (hooksSystem) {
    hooksSystem.trigger('rule:deleted', { id, rule });
  }
}

/**
 * Get all rules
 *
 * @returns Rules map
 */
export function getRules(): Record<string, Rule> {
  return { ...rules };
}

/**
 * Get specific rule
 *
 * @param id - Rule ID
 * @returns Rule or null
 */
export function getRule(id: string): Rule | null {
  return rules[id] || null;
}

// ============================================================================
// Event Triggering
// ============================================================================

/**
 * Trigger an event and run matching rules
 *
 * @param eventId - Event ID
 * @param context - Event context data
 * @returns Execution results
 */
export async function triggerEvent(eventId: string, context: Record<string, unknown> = {}): Promise<TriggerResults> {
  const event = events.get(eventId);
  if (!event) {
    console.warn(`[actions] Unknown event: ${eventId}`);
    return { event: eventId, context, matched: 0, executed: [] };
  }

  // Find matching rules
  const matchingRules = Object.entries(rules)
    .filter(([_id, rule]) => rule.enabled && rule.event === eventId)
    .map(([id, rule]) => ({ id, ...rule }));

  const results: TriggerResults = {
    event: eventId,
    context,
    matched: matchingRules.length,
    executed: []
  };

  // Execute each matching rule
  for (const rule of matchingRules) {
    try {
      const result = await executeRule(rule.id, context);
      results.executed.push({ rule: rule.id, result });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[actions] Error executing rule ${rule.id}:`, message);
      results.executed.push({ rule: rule.id, error: message });
    }
  }

  if (hooksSystem) {
    await hooksSystem.trigger('event:triggered', { eventId, results });
  }

  return results;
}

// ============================================================================
// Rule Execution
// ============================================================================

/**
 * Execute a specific rule
 *
 * @param ruleId - Rule ID
 * @param context - Execution context
 * @returns Execution result
 */
export async function executeRule(ruleId: string, context: Record<string, unknown> = {}): Promise<RuleExecutionResult> {
  const rule = rules[ruleId];
  if (!rule) {
    throw new Error(`Rule "${ruleId}" not found`);
  }

  if (!rule.enabled) {
    return { executed: false, reason: 'disabled' };
  }

  // Allow hooks to modify context
  if (hooksSystem) {
    await hooksSystem.trigger('rule:evaluate', { ruleId, rule, context });
  }

  // Evaluate conditions
  const conditionsPassed = await evaluateConditions(rule.conditions, context);

  if (!conditionsPassed) {
    logExecution(ruleId, context, { executed: false, reason: 'conditions failed' });
    return { executed: false, reason: 'conditions failed' };
  }

  // Execute actions
  const actionResults: Array<{ action: string; result?: unknown; error?: string }> = [];
  for (const actionConfig of rule.actions) {
    try {
      const result = await executeAction(
        actionConfig.plugin,
        context,
        actionConfig.settings || {}
      );
      actionResults.push({ action: actionConfig.plugin, result });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[actions] Error executing action ${actionConfig.plugin}:`, message);
      actionResults.push({ action: actionConfig.plugin, error: message });
    }
  }

  const result: RuleExecutionResult = {
    executed: true,
    actions: actionResults
  };

  logExecution(ruleId, context, result);

  return result;
}

// ============================================================================
// Condition Evaluation
// ============================================================================

/**
 * Evaluate conditions
 *
 * @param conditionConfigs - Array of condition configurations
 * @param context - Evaluation context
 * @returns Whether all conditions passed
 */
export async function evaluateConditions(conditionConfigs: RuleConditionConfig[] = [], context: Record<string, unknown> = {}): Promise<boolean> {
  if (conditionConfigs.length === 0) {
    return true; // No conditions = always pass
  }

  for (const conditionConfig of conditionConfigs) {
    const condition = conditions.get(conditionConfig.plugin);

    if (!condition) {
      console.warn(`[actions] Unknown condition: ${conditionConfig.plugin}`);
      return false;
    }

    try {
      const passed = await condition.evaluate(context, conditionConfig.settings || {});
      if (!passed) {
        return false;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[actions] Error evaluating condition ${conditionConfig.plugin}:`, message);
      return false;
    }
  }

  return true;
}

// ============================================================================
// Action Execution
// ============================================================================

/**
 * Execute a specific action
 *
 * @param actionId - Action ID
 * @param context - Execution context
 * @param settings - Action settings
 * @returns Action result
 */
export async function executeAction(actionId: string, context: Record<string, unknown> = {}, settings: Record<string, unknown> = {}): Promise<unknown> {
  const action = actions.get(actionId);

  if (!action) {
    throw new Error(`Action "${actionId}" not found`);
  }

  // Replace tokens in settings
  const processedSettings = tokensSystem
    ? replaceTokensInObject(settings, context) as Record<string, unknown>
    : settings;

  // Allow hooks to modify execution
  if (hooksSystem) {
    await hooksSystem.trigger('action:execute', { actionId, context, settings: processedSettings });
  }

  // Execute action
  const result = await action.execute(context, processedSettings);

  return result;
}

// ============================================================================
// Scheduled Actions
// ============================================================================

/**
 * Schedule an action for future execution
 *
 * @param actionId - Action ID
 * @param context - Execution context
 * @param settings - Action settings
 * @param datetime - When to execute
 * @returns Scheduled action
 */
export function scheduleAction(actionId: string, context: Record<string, unknown>, settings: Record<string, unknown>, datetime: Date | string): ScheduledAction {
  const executeAt = datetime instanceof Date ? datetime : new Date(datetime);

  if (executeAt <= new Date()) {
    throw new Error('Scheduled time must be in the future');
  }

  const scheduled: ScheduledAction = {
    id: `scheduled-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    actionId,
    context,
    settings,
    executeAt: executeAt.toISOString(),
    created: new Date().toISOString(),
    executed: false
  };

  scheduledActions.push(scheduled);

  // Set timeout for execution
  const delay = executeAt.getTime() - new Date().getTime();
  setTimeout(async () => {
    await processScheduledAction(scheduled.id);
  }, delay);

  return scheduled;
}

/**
 * Process a scheduled action
 *
 * @param id - Scheduled action ID
 */
async function processScheduledAction(id: string): Promise<void> {
  const scheduled = scheduledActions.find((s: ScheduledAction) => s.id === id);
  if (!scheduled || scheduled.executed) {
    return;
  }

  try {
    await executeAction(scheduled.actionId, scheduled.context, scheduled.settings);
    scheduled.executed = true;
    scheduled.executedAt = new Date().toISOString();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[actions] Error executing scheduled action ${id}:`, message);
    scheduled.error = message;
  }
}

/**
 * Get scheduled actions
 *
 * @returns Scheduled actions copy
 */
export function getScheduledActions(): ScheduledAction[] {
  return [...scheduledActions];
}

// ============================================================================
// Batch Execution
// ============================================================================

/**
 * Execute action on multiple items
 *
 * @param actionId - Action ID
 * @param items - Items to process
 * @param settings - Action settings
 * @returns Results for each item
 */
export async function batchExecute(actionId: string, items: Record<string, unknown>[], settings: Record<string, unknown> = {}): Promise<BatchResult[]> {
  const results: BatchResult[] = [];

  for (const item of items) {
    try {
      const result = await executeAction(actionId, item, settings);
      results.push({ item, result, success: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[actions] Batch execution error:`, message);
      results.push({ item, error: message, success: false });
    }
  }

  return results;
}

// ============================================================================
// Built-in Actions
// ============================================================================

/**
 * Register built-in actions
 */
function registerBuiltInActions(): void {
  // Content actions - use real content service when available
  registerAction('content:publish', {
    label: 'Publish content',
    execute: async (context, _settings) => {
      const content = context.content as Record<string, unknown> | undefined;
      if (contentService && content?.type && content?.id) {
        await contentService.update(content.type as string, content.id as string, { status: 'published' });
      }
      return { published: true, id: content?.id };
    }
  });

  registerAction('content:unpublish', {
    label: 'Unpublish content',
    execute: async (context, _settings) => {
      const content = context.content as Record<string, unknown> | undefined;
      if (contentService && content?.type && content?.id) {
        await contentService.update(content.type as string, content.id as string, { status: 'draft' });
      }
      return { unpublished: true, id: content?.id };
    }
  });

  registerAction('content:delete', {
    label: 'Delete content',
    execute: async (context, _settings) => {
      const content = context.content as Record<string, unknown> | undefined;
      if (contentService && content?.type && content?.id) {
        await contentService.delete(content.type as string, content.id as string);
      }
      return { deleted: true, id: content?.id };
    }
  });

  registerAction('content:clone', {
    label: 'Clone content',
    execute: async (context, _settings) => {
      const content = context.content as Record<string, unknown> | undefined;
      if (contentService && content?.type && content?.id) {
        const cloned = await contentService.clone?.(content.type as string, content.id as string);
        return { cloned: true, id: cloned?.id };
      }
      return { cloned: false, reason: 'Content service unavailable' };
    }
  });

  registerAction('content:set_field', {
    label: 'Set field value',
    execute: async (context, settings) => {
      const content = context.content as Record<string, unknown> | undefined;
      if (!contentService || !content?.type || !content?.id) {
        return { updated: false, reason: 'Content not available' };
      }
      const update: Record<string, unknown> = {};
      update[settings.field as string] = settings.value;
      await contentService.update(content.type as string, content.id as string, update);
      return { updated: true, field: settings.field, value: settings.value };
    },
    schema: {
      field: { type: 'string', required: true },
      value: { type: 'any', required: true }
    }
  });

  registerAction('content:set_workflow_state', {
    label: 'Set workflow state',
    execute: async (context, settings) => {
      const content = context.content as Record<string, unknown> | undefined;
      if (!contentService || !content?.type || !content?.id) {
        return { updated: false };
      }
      await contentService.update(content.type as string, content.id as string, {
        _workflow_state: settings.state
      });
      return { updated: true, state: settings.state };
    },
    schema: {
      state: { type: 'string', required: true }
    }
  });

  registerAction('content:create', {
    label: 'Create content',
    execute: async (context, settings) => {
      if (!contentService) return { created: false };
      const data = { ...(settings.data as Record<string, unknown>) };
      // Replace tokens in data values
      for (const [k, v] of Object.entries(data)) {
        if (typeof v === 'string') data[k] = replaceTokens(v, context);
      }
      const item = await contentService.create(settings.type as string, data);
      return { created: true, id: item?.id };
    },
    schema: {
      type: { type: 'string', required: true },
      data: { type: 'object', required: true }
    }
  });

  // User actions - stubs
  registerAction('user:block', {
    label: 'Block user',
    execute: async (context, _settings) => {
      const user = context.user as Record<string, unknown> | undefined;
      console.log(`[actions] Blocking user: ${user?.id}`);
      return { blocked: true };
    }
  });

  registerAction('user:unblock', {
    label: 'Unblock user',
    execute: async (context, _settings) => {
      const user = context.user as Record<string, unknown> | undefined;
      console.log(`[actions] Unblocking user: ${user?.id}`);
      return { unblocked: true };
    }
  });

  registerAction('user:role_add', {
    label: 'Add user role',
    execute: async (context, settings) => {
      const user = context.user as Record<string, unknown> | undefined;
      console.log(`[actions] Adding role ${settings.role} to user: ${user?.id}`);
      return { roleAdded: settings.role };
    },
    schema: {
      role: { type: 'string', required: true }
    }
  });

  registerAction('user:role_remove', {
    label: 'Remove user role',
    execute: async (context, settings) => {
      const user = context.user as Record<string, unknown> | undefined;
      console.log(`[actions] Removing role ${settings.role} from user: ${user?.id}`);
      return { roleRemoved: settings.role };
    },
    schema: {
      role: { type: 'string', required: true }
    }
  });

  // System actions
  registerAction('system:message', {
    label: 'Display message',
    execute: async (_context, settings) => {
      const message = (settings.message as string) || 'No message provided';
      console.log(`[actions] MESSAGE: ${message}`);
      return { message };
    },
    schema: {
      message: { type: 'string', required: true }
    }
  });

  registerAction('system:log', {
    label: 'Log to console',
    execute: async (context, settings) => {
      const message = (settings.message as string) || JSON.stringify(context);
      const level = (settings.level as string) || 'info';
      const consoleFn = console[level as 'log' | 'info' | 'warn' | 'error'] || console.info;
      consoleFn(`[actions] ${message}`);
      return { logged: true, level };
    },
    schema: {
      message: { type: 'string' },
      level: { type: 'string', enum: ['log', 'info', 'warn', 'error'] }
    }
  });

  registerAction('system:redirect', {
    label: 'Redirect to URL',
    execute: async (_context, settings) => {
      const url = (settings.url as string) || '/';
      console.log(`[actions] Redirect to: ${url}`);
      return { redirect: url };
    },
    schema: {
      url: { type: 'string', required: true }
    }
  });

  registerAction('system:email', {
    label: 'Send email',
    execute: async (context, settings) => {
      if (!emailSystem) {
        throw new Error('Email system not available');
      }

      const user = context.user as Record<string, unknown> | undefined;
      const to = (settings.to as string) || (user?.email as string);
      const subject = (settings.subject as string) || 'Notification';
      const body = (settings.body as string) || '';

      await emailSystem.send(to, subject, body, { html: true });

      return { sent: true, to };
    },
    schema: {
      to: { type: 'string' },
      subject: { type: 'string', required: true },
      body: { type: 'string', required: true }
    }
  });

  registerAction('system:webhook', {
    label: 'Call webhook',
    execute: async (context, settings) => {
      const url = replaceTokens((settings.url as string) || '', context);
      const method = ((settings.method as string) || 'POST').toUpperCase();
      const body = settings.includeContext !== false
        ? JSON.stringify({ event: context._event || null, data: context.content || context.user || {} })
        : (settings.body as string) || '';
      try {
        const parsed = new URL(url);
        return new Promise((resolve, _reject) => {
          const httpModule = parsed.protocol === 'https:' ? https : http;
          const req = httpModule.request(url, { method, headers: { 'Content-Type': 'application/json' } }, (res) => {
              let data = '';
              res.on('data', (d: Buffer) => data += d);
              res.on('end', () => resolve({ status: res.statusCode, body: data.slice(0, 500) }));
            });
          req.on('error', (e: Error) => resolve({ error: e.message }));
          if (body && method !== 'GET') req.write(body);
          req.end();
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
    },
    schema: {
      url: { type: 'string', required: true },
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH'] },
      includeContext: { type: 'boolean' },
      body: { type: 'string' }
    }
  });

  registerAction('content:add_tag', {
    label: 'Add tag to content',
    execute: async (context, settings) => {
      const content = context.content as Record<string, unknown> | undefined;
      if (!contentService || !content?.type || !content?.id) {
        return { tagged: false };
      }
      const item = contentService.get(content.type as string, content.id as string);
      if (!item) return { tagged: false };
      const tags: string[] = Array.isArray(item.tags) ? [...item.tags] : [];
      if (!tags.includes(settings.tag as string)) {
        tags.push(settings.tag as string);
        await contentService.update(content.type as string, content.id as string, { tags });
      }
      return { tagged: true, tag: settings.tag };
    },
    schema: {
      tag: { type: 'string', required: true }
    }
  });
}

// ============================================================================
// Built-in Conditions
// ============================================================================

/**
 * Register built-in conditions
 */
function registerBuiltInConditions(): void {
  registerCondition('content_type', {
    label: 'Content type is',
    evaluate: async (context, settings) => {
      const content = context.content as Record<string, unknown> | undefined;
      const contentType = content?.type as string | undefined;
      const allowedTypes = (settings.types as string[]) || [];
      return allowedTypes.includes(contentType as string);
    },
    schema: {
      types: { type: 'array', required: true }
    }
  });

  registerCondition('user_role', {
    label: 'User has role',
    evaluate: async (context, settings) => {
      const user = context.user as Record<string, unknown> | undefined;
      const userRoles = (user?.roles as string[]) || [];
      const requiredRole = settings.role as string;
      return userRoles.includes(requiredRole);
    },
    schema: {
      role: { type: 'string', required: true }
    }
  });

  registerCondition('field_value', {
    label: 'Field value equals',
    evaluate: async (context, settings) => {
      const content = context.content as Record<string, unknown> | undefined;
      const fieldValue = content?.[settings.field as string];
      return fieldValue === settings.value;
    },
    schema: {
      field: { type: 'string', required: true },
      value: { type: 'any', required: true }
    }
  });

  registerCondition('field_contains', {
    label: 'Field contains value',
    evaluate: async (context, settings) => {
      const content = context.content as Record<string, unknown> | undefined;
      const fieldValue = content?.[settings.field as string];
      if (Array.isArray(fieldValue)) {
        return fieldValue.includes(settings.value);
      }
      if (typeof fieldValue === 'string') {
        return fieldValue.includes(settings.value as string);
      }
      return false;
    },
    schema: {
      field: { type: 'string', required: true },
      value: { type: 'any', required: true }
    }
  });

  registerCondition('user_authenticated', {
    label: 'User is authenticated',
    evaluate: async (context, _settings) => {
      const user = context.user as Record<string, unknown> | undefined;
      return !!user && user.id !== 'anonymous';
    }
  });

  registerCondition('time_range', {
    label: 'Current time in range',
    evaluate: async (_context, settings) => {
      const now = new Date();
      const start = settings.start ? new Date(settings.start as string) : null;
      const end = settings.end ? new Date(settings.end as string) : null;

      if (start && now < start) return false;
      if (end && now > end) return false;

      return true;
    },
    schema: {
      start: { type: 'string' },
      end: { type: 'string' }
    }
  });

  registerCondition('content_is_published', {
    label: 'Content is published',
    evaluate: async (context, _settings) => {
      const content = context.content as Record<string, unknown> | undefined;
      return content?.status === 'published';
    }
  });

  registerCondition('field_is_empty', {
    label: 'Field is empty',
    evaluate: async (context, settings) => {
      const content = context.content as Record<string, unknown> | undefined;
      const val = content?.[settings.field as string];
      return val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0);
    },
    schema: {
      field: { type: 'string', required: true }
    }
  });

  registerCondition('field_not_empty', {
    label: 'Field is not empty',
    evaluate: async (context, settings) => {
      const content = context.content as Record<string, unknown> | undefined;
      const val = content?.[settings.field as string];
      return val !== undefined && val !== null && val !== '' && !(Array.isArray(val) && val.length === 0);
    },
    schema: {
      field: { type: 'string', required: true }
    }
  });

  registerCondition('path_matches', {
    label: 'Path matches pattern',
    evaluate: async (context, settings) => {
      const content = context.content as Record<string, unknown> | undefined;
      const path = (context.path as string) || (content?.slug as string) || '';
      const pattern = (settings.pattern as string) || '';
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(path);
      }
      return path === pattern;
    },
    schema: {
      pattern: { type: 'string', required: true }
    }
  });

  registerCondition('content_has_tag', {
    label: 'Content has tag',
    evaluate: async (context, settings) => {
      const content = context.content as Record<string, unknown> | undefined;
      const tags = (content?.tags as string[]) || [];
      return Array.isArray(tags) && tags.includes(settings.tag as string);
    },
    schema: {
      tag: { type: 'string', required: true }
    }
  });
}

// ============================================================================
// Built-in Events
// ============================================================================

/**
 * Register built-in events
 */
function registerBuiltInEvents(): void {
  // Content events
  registerEvent('content:create', {
    label: 'Content created',
    context: { content: 'object' }
  });

  registerEvent('content:update', {
    label: 'Content updated',
    context: { content: 'object', original: 'object' }
  });

  registerEvent('content:delete', {
    label: 'Content deleted',
    context: { content: 'object' }
  });

  registerEvent('content:publish', {
    label: 'Content published',
    context: { content: 'object' }
  });

  registerEvent('content:unpublish', {
    label: 'Content unpublished',
    context: { content: 'object' }
  });

  // User events
  registerEvent('user:login', {
    label: 'User logged in',
    context: { user: 'object' }
  });

  registerEvent('user:logout', {
    label: 'User logged out',
    context: { user: 'object' }
  });

  registerEvent('user:register', {
    label: 'User registered',
    context: { user: 'object' }
  });

  registerEvent('user:update', {
    label: 'User updated',
    context: { user: 'object', original: 'object' }
  });

  // System events
  registerEvent('system:cron', {
    label: 'Cron run',
    context: { timestamp: 'string' }
  });

  registerEvent('system:boot', {
    label: 'System boot',
    context: {}
  });
}

// ============================================================================
// Persistence
// ============================================================================

/**
 * Load rules from storage
 */
function loadRules(): void {
  const rulesPath = join(baseDir, 'config', 'rules.json');

  if (existsSync(rulesPath)) {
    try {
      const data = JSON.parse(readFileSync(rulesPath, 'utf-8')) as RulesStorage;
      rules = data.rules || {};

      // Load scheduled actions
      if (data.scheduled) {
        scheduledActions.push(...data.scheduled.filter((s: ScheduledAction) => !s.executed));

        // Reschedule pending actions
        for (const scheduled of scheduledActions) {
          const executeAt = new Date(scheduled.executeAt);
          if (executeAt > new Date()) {
            const delay = executeAt.getTime() - new Date().getTime();
            setTimeout(async () => {
              await processScheduledAction(scheduled.id);
            }, delay);
          }
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[actions] Error loading rules:', message);
      rules = {};
    }
  } else {
    rules = {};
  }
}

/**
 * Save rules to storage
 */
function saveRules(): void {
  const rulesPath = join(baseDir, 'config', 'rules.json');

  const data: RulesStorage = {
    rules,
    scheduled: scheduledActions,
    actions: {
      // Store configured actions (not built-in)
    }
  };

  try {
    writeFileSync(rulesPath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[actions] Error saving rules:', message);
  }
}

// ============================================================================
// Logging
// ============================================================================

/**
 * Log action execution
 *
 * @param ruleId - Rule ID
 * @param context - Execution context
 * @param result - Execution result
 */
function logExecution(ruleId: string, context: Record<string, unknown>, result: unknown): void {
  executionLog.unshift({
    ruleId,
    context: JSON.stringify(context).slice(0, 200),
    result,
    timestamp: new Date().toISOString()
  });

  if (executionLog.length > MAX_LOG_SIZE) {
    executionLog.length = MAX_LOG_SIZE;
  }
}

/**
 * Get execution log
 *
 * @param limit - Max entries
 * @returns Log entries
 */
export function getExecutionLog(limit: number = 50): ExecutionLogEntry[] {
  return executionLog.slice(0, limit);
}

/**
 * Clear execution log
 */
export function clearExecutionLog(): void {
  executionLog.length = 0;
}

// ============================================================================
// Token Replacement
// ============================================================================

/**
 * Replace tokens in object recursively
 *
 * @param obj - Object to process
 * @param context - Token context
 * @returns Processed object
 */
function replaceTokensInObject(obj: unknown, context: Record<string, unknown>): unknown {
  if (typeof obj === 'string') {
    return replaceTokens(obj, context);
  }

  if (Array.isArray(obj)) {
    return obj.map((item: unknown) => replaceTokensInObject(item, context));
  }

  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = replaceTokensInObject(value, context);
    }
    return result;
  }

  return obj;
}

/**
 * Replace tokens in string
 *
 * @param str - String with tokens
 * @param context - Token context
 * @returns Processed string
 */
function replaceTokens(str: string, context: Record<string, unknown>): string {
  if (!tokensSystem || !tokensSystem.replace) {
    // Fallback simple replacement
    return str.replace(/\[([^\]]+)\]/g, (match: string, path: string) => {
      const parts = path.split(':');
      let value: unknown = context;
      for (const part of parts) {
        value = (value as Record<string, unknown>)?.[part];
      }
      return value !== undefined ? String(value) : match;
    });
  }

  return tokensSystem.replace(str, context);
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Export all rules and configuration
 *
 * @returns Complete configuration
 */
export function exportConfig(): ExportedConfig {
  return {
    rules,
    actions: Object.fromEntries(
      Array.from(actions.entries()).map(([id, action]) => [
        id,
        { label: action.label, schema: action.schema }
      ])
    ),
    events: Object.fromEntries(events),
    conditions: Object.fromEntries(
      Array.from(conditions.entries()).map(([id, condition]) => [
        id,
        { label: condition.label, schema: condition.schema }
      ])
    )
  };
}

/**
 * Import rules configuration
 *
 * @param config - Configuration to import
 */
export function importConfig(config: { rules?: Record<string, Rule> }): void {
  if (config.rules) {
    rules = { ...config.rules };
    saveRules();
  }
}

// ============================================================================
// Hook Wiring -- connects CMS events to ECA rules
// ============================================================================

/**
 * Wire CMS hook events into the ECA rule engine.
 * Call this after all modules are initialized (READY phase)
 * so that content/user operations automatically trigger matching rules.
 *
 * @param hooks - The hooks system
 * @param contentSvc - The content service
 */
export function wireHooks(hooks: HooksSystem, contentSvc: ContentService): void {
  if (!hooks) return;
  contentService = contentSvc;

  // Content lifecycle hooks -> ECA events
  const contentHooks: Array<[string, string]> = [
    ['content:afterCreate', 'content:create'],
    ['content:afterUpdate', 'content:update'],
    ['content:afterDelete', 'content:delete'],
    ['content:afterPublish', 'content:publish'],
    ['content:afterUnpublish', 'content:unpublish'],
  ];

  for (const [hookName, eventId] of contentHooks) {
    hooks.register(hookName, async (ctx: Record<string, unknown>) => {
      try {
        const ecaCtx = { ...ctx, _event: eventId };
        await triggerEvent(eventId, ecaCtx);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[eca] Error triggering ${eventId} from ${hookName}:`, message);
      }
    }, 100); // Low priority -- run after core handlers
  }

  // User lifecycle hooks -> ECA events
  const userHooks: Array<[string, string]> = [
    ['user:afterLogin', 'user:login'],
    ['user:afterLogout', 'user:logout'],
    ['user:afterRegister', 'user:register'],
    ['user:afterUpdate', 'user:update'],
  ];

  for (const [hookName, eventId] of userHooks) {
    hooks.register(hookName, async (ctx: Record<string, unknown>) => {
      try {
        await triggerEvent(eventId, { ...ctx, _event: eventId });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[eca] Error triggering ${eventId} from ${hookName}:`, message);
      }
    }, 100);
  }

  // System hooks
  hooks.register('cron:run', async (ctx: Record<string, unknown>) => {
    try {
      await triggerEvent('system:cron', { ...ctx, _event: 'system:cron', timestamp: new Date().toISOString() });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[eca] Error triggering system:cron:', message);
    }
  }, 100);

  // Register additional events now that we know the full system
  registerEvent('comment:create', { label: 'Comment created', context: { comment: 'object', content: 'object' } });
  registerEvent('form:submit', { label: 'Form submitted', context: { form: 'object', data: 'object' } });
  registerEvent('workflow:transition', { label: 'Workflow transition', context: { content: 'object', from: 'string', to: 'string' } });

  // Wire comment/form/workflow hooks if they exist
  hooks.register('comment:afterCreate', async (ctx: Record<string, unknown>) => {
    try { await triggerEvent('comment:create', { ...ctx, _event: 'comment:create' }); } catch (_e: unknown) { /* silent */ }
  }, 100);

  hooks.register('workflow:afterTransition', async (ctx: Record<string, unknown>) => {
    try { await triggerEvent('workflow:transition', { ...ctx, _event: 'workflow:transition' }); } catch (_e: unknown) { /* silent */ }
  }, 100);

  console.log(`[eca] Wired ${contentHooks.length + userHooks.length + 3} hook->event bridges`);
}
