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

// ============================================
// STATE
// ============================================

/**
 * Base directory for config files
 */
let baseDir = '';

/**
 * Hooks system reference
 */
let hooksSystem = null;

/**
 * Email system reference
 */
let emailSystem = null;

/**
 * Tokens system reference
 */
let tokensSystem = null;

/**
 * Content service reference (set via wireHooks)
 */
let contentService = null;

/**
 * Registered actions
 * Structure: { actionId: { label, execute, schema } }
 */
const actions = new Map();

/**
 * Registered events
 * Structure: { eventId: { label, context } }
 */
const events = new Map();

/**
 * Registered conditions
 * Structure: { conditionId: { label, evaluate, schema } }
 */
const conditions = new Map();

/**
 * Loaded rules
 * Structure: { ruleId: { label, event, conditions, actions, enabled } }
 */
let rules = {};

/**
 * Scheduled actions queue
 */
const scheduledActions = [];

/**
 * Action execution log
 */
const executionLog = [];
const MAX_LOG_SIZE = 1000;

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize actions system
 *
 * @param {string} dir - Base directory
 * @param {Object} hooks - Hooks system reference
 * @param {Object} email - Email system reference
 * @param {Object} tokens - Tokens system reference
 */
export function init(dir, hooks = null, email = null, tokens = null) {
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

// ============================================
// ACTION REGISTRY
// ============================================

/**
 * Register an action
 *
 * @param {string} id - Action ID (e.g., 'content:publish')
 * @param {Object} config - Action configuration
 * @param {string} config.label - Human-readable label
 * @param {Function} config.execute - async (context, settings) => result
 * @param {Object} config.schema - Settings schema (optional)
 */
export function registerAction(id, config) {
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
 * @returns {Object} Actions map
 */
export function getActions() {
  return Object.fromEntries(actions);
}

/**
 * Get specific action
 *
 * @param {string} id - Action ID
 * @returns {Object|null} Action config or null
 */
export function getAction(id) {
  return actions.get(id) || null;
}

// ============================================
// EVENT REGISTRY
// ============================================

/**
 * Register an event
 *
 * @param {string} id - Event ID (e.g., 'content:publish')
 * @param {Object} config - Event configuration
 * @param {string} config.label - Human-readable label
 * @param {Object} config.context - Expected context structure
 */
export function registerEvent(id, config) {
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
 * @returns {Object} Events map
 */
export function getEvents() {
  return Object.fromEntries(events);
}

// ============================================
// CONDITION REGISTRY
// ============================================

/**
 * Register a condition
 *
 * @param {string} id - Condition ID (e.g., 'content_type')
 * @param {Object} config - Condition configuration
 * @param {string} config.label - Human-readable label
 * @param {Function} config.evaluate - async (context, settings) => boolean
 * @param {Object} config.schema - Settings schema (optional)
 */
export function registerCondition(id, config) {
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
 * @returns {Object} Conditions map
 */
export function getConditions() {
  return Object.fromEntries(conditions);
}

// ============================================
// RULE MANAGEMENT
// ============================================

/**
 * Create a new rule
 *
 * @param {string} id - Rule ID
 * @param {Object} config - Rule configuration
 * @param {string} config.label - Human-readable label
 * @param {string} config.event - Event ID to trigger on
 * @param {Array} config.conditions - Array of condition configs
 * @param {Array} config.actions - Array of action configs
 * @param {boolean} config.enabled - Whether rule is enabled
 * @returns {Object} Created rule
 */
export function createRule(id, config) {
  if (rules[id]) {
    throw new Error(`Rule "${id}" already exists`);
  }

  const rule = {
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
 * @param {string} id - Rule ID
 * @param {Object} config - Updated configuration
 * @returns {Object} Updated rule
 */
export function updateRule(id, config) {
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
 * @param {string} id - Rule ID
 */
export function deleteRule(id) {
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
 * @returns {Object} Rules map
 */
export function getRules() {
  return { ...rules };
}

/**
 * Get specific rule
 *
 * @param {string} id - Rule ID
 * @returns {Object|null} Rule or null
 */
export function getRule(id) {
  return rules[id] || null;
}

// ============================================
// EVENT TRIGGERING
// ============================================

/**
 * Trigger an event and run matching rules
 *
 * @param {string} eventId - Event ID
 * @param {Object} context - Event context data
 * @returns {Promise<Object>} Execution results
 */
export async function triggerEvent(eventId, context = {}) {
  const event = events.get(eventId);
  if (!event) {
    console.warn(`[actions] Unknown event: ${eventId}`);
    return { matched: [], executed: [] };
  }

  // Find matching rules
  const matchingRules = Object.entries(rules)
    .filter(([id, rule]) => rule.enabled && rule.event === eventId)
    .map(([id, rule]) => ({ id, ...rule }));

  const results = {
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
    } catch (error) {
      console.error(`[actions] Error executing rule ${rule.id}:`, error.message);
      results.executed.push({ rule: rule.id, error: error.message });
    }
  }

  if (hooksSystem) {
    await hooksSystem.trigger('event:triggered', { eventId, results });
  }

  return results;
}

// ============================================
// RULE EXECUTION
// ============================================

/**
 * Execute a specific rule
 *
 * @param {string} ruleId - Rule ID
 * @param {Object} context - Execution context
 * @returns {Promise<Object>} Execution result
 */
export async function executeRule(ruleId, context = {}) {
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
  const actionResults = [];
  for (const actionConfig of rule.actions) {
    try {
      const result = await executeAction(
        actionConfig.plugin,
        context,
        actionConfig.settings || {}
      );
      actionResults.push({ action: actionConfig.plugin, result });
    } catch (error) {
      console.error(`[actions] Error executing action ${actionConfig.plugin}:`, error.message);
      actionResults.push({ action: actionConfig.plugin, error: error.message });
    }
  }

  const result = {
    executed: true,
    actions: actionResults
  };

  logExecution(ruleId, context, result);

  return result;
}

// ============================================
// CONDITION EVALUATION
// ============================================

/**
 * Evaluate conditions
 *
 * @param {Array} conditionConfigs - Array of condition configurations
 * @param {Object} context - Evaluation context
 * @returns {Promise<boolean>} Whether all conditions passed
 */
export async function evaluateConditions(conditionConfigs = [], context = {}) {
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
    } catch (error) {
      console.error(`[actions] Error evaluating condition ${conditionConfig.plugin}:`, error.message);
      return false;
    }
  }

  return true;
}

// ============================================
// ACTION EXECUTION
// ============================================

/**
 * Execute a specific action
 *
 * @param {string} actionId - Action ID
 * @param {Object} context - Execution context
 * @param {Object} settings - Action settings
 * @returns {Promise<*>} Action result
 */
export async function executeAction(actionId, context = {}, settings = {}) {
  const action = actions.get(actionId);

  if (!action) {
    throw new Error(`Action "${actionId}" not found`);
  }

  // Replace tokens in settings
  const processedSettings = tokensSystem
    ? replaceTokensInObject(settings, context)
    : settings;

  // Allow hooks to modify execution
  if (hooksSystem) {
    await hooksSystem.trigger('action:execute', { actionId, context, settings: processedSettings });
  }

  // Execute action
  const result = await action.execute(context, processedSettings);

  return result;
}

// ============================================
// SCHEDULED ACTIONS
// ============================================

/**
 * Schedule an action for future execution
 *
 * @param {string} actionId - Action ID
 * @param {Object} context - Execution context
 * @param {Object} settings - Action settings
 * @param {Date|string} datetime - When to execute
 * @returns {Object} Scheduled action
 */
export function scheduleAction(actionId, context, settings, datetime) {
  const executeAt = datetime instanceof Date ? datetime : new Date(datetime);

  if (executeAt <= new Date()) {
    throw new Error('Scheduled time must be in the future');
  }

  const scheduled = {
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
  const delay = executeAt - new Date();
  setTimeout(async () => {
    await processScheduledAction(scheduled.id);
  }, delay);

  return scheduled;
}

/**
 * Process a scheduled action
 *
 * @param {string} id - Scheduled action ID
 */
async function processScheduledAction(id) {
  const scheduled = scheduledActions.find(s => s.id === id);
  if (!scheduled || scheduled.executed) {
    return;
  }

  try {
    await executeAction(scheduled.actionId, scheduled.context, scheduled.settings);
    scheduled.executed = true;
    scheduled.executedAt = new Date().toISOString();
  } catch (error) {
    console.error(`[actions] Error executing scheduled action ${id}:`, error.message);
    scheduled.error = error.message;
  }
}

/**
 * Get scheduled actions
 *
 * @returns {Array} Scheduled actions
 */
export function getScheduledActions() {
  return [...scheduledActions];
}

// ============================================
// BATCH EXECUTION
// ============================================

/**
 * Execute action on multiple items
 *
 * @param {string} actionId - Action ID
 * @param {Array} items - Items to process
 * @param {Object} settings - Action settings
 * @returns {Promise<Array>} Results for each item
 */
export async function batchExecute(actionId, items, settings = {}) {
  const results = [];

  for (const item of items) {
    try {
      const result = await executeAction(actionId, item, settings);
      results.push({ item, result, success: true });
    } catch (error) {
      console.error(`[actions] Batch execution error:`, error.message);
      results.push({ item, error: error.message, success: false });
    }
  }

  return results;
}

// ============================================
// BUILT-IN ACTIONS
// ============================================

/**
 * Register built-in actions
 */
function registerBuiltInActions() {
  // Content actions - use real content service when available
  registerAction('content:publish', {
    label: 'Publish content',
    execute: async (context, settings) => {
      if (contentService && context.content?.type && context.content?.id) {
        await contentService.update(context.content.type, context.content.id, { status: 'published' });
      }
      return { published: true, id: context.content?.id };
    }
  });

  registerAction('content:unpublish', {
    label: 'Unpublish content',
    execute: async (context, settings) => {
      if (contentService && context.content?.type && context.content?.id) {
        await contentService.update(context.content.type, context.content.id, { status: 'draft' });
      }
      return { unpublished: true, id: context.content?.id };
    }
  });

  registerAction('content:delete', {
    label: 'Delete content',
    execute: async (context, settings) => {
      if (contentService && context.content?.type && context.content?.id) {
        await contentService.delete(context.content.type, context.content.id);
      }
      return { deleted: true, id: context.content?.id };
    }
  });

  registerAction('content:clone', {
    label: 'Clone content',
    execute: async (context, settings) => {
      if (contentService && context.content?.type && context.content?.id) {
        const cloned = await contentService.clone?.(context.content.type, context.content.id);
        return { cloned: true, id: cloned?.id };
      }
      return { cloned: false, reason: 'Content service unavailable' };
    }
  });

  registerAction('content:set_field', {
    label: 'Set field value',
    execute: async (context, settings) => {
      if (!contentService || !context.content?.type || !context.content?.id) {
        return { updated: false, reason: 'Content not available' };
      }
      const update = {};
      update[settings.field] = settings.value;
      await contentService.update(context.content.type, context.content.id, update);
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
      if (!contentService || !context.content?.type || !context.content?.id) {
        return { updated: false };
      }
      await contentService.update(context.content.type, context.content.id, {
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
      const data = { ...settings.data };
      // Replace tokens in data values
      for (const [k, v] of Object.entries(data)) {
        if (typeof v === 'string') data[k] = replaceTokens(v, context);
      }
      const item = await contentService.create(settings.type, data);
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
    execute: async (context, settings) => {
      console.log(`[actions] Blocking user: ${context.user?.id}`);
      return { blocked: true };
    }
  });

  registerAction('user:unblock', {
    label: 'Unblock user',
    execute: async (context, settings) => {
      console.log(`[actions] Unblocking user: ${context.user?.id}`);
      return { unblocked: true };
    }
  });

  registerAction('user:role_add', {
    label: 'Add user role',
    execute: async (context, settings) => {
      console.log(`[actions] Adding role ${settings.role} to user: ${context.user?.id}`);
      return { roleAdded: settings.role };
    },
    schema: {
      role: { type: 'string', required: true }
    }
  });

  registerAction('user:role_remove', {
    label: 'Remove user role',
    execute: async (context, settings) => {
      console.log(`[actions] Removing role ${settings.role} from user: ${context.user?.id}`);
      return { roleRemoved: settings.role };
    },
    schema: {
      role: { type: 'string', required: true }
    }
  });

  // System actions
  registerAction('system:message', {
    label: 'Display message',
    execute: async (context, settings) => {
      const message = settings.message || 'No message provided';
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
      const message = settings.message || JSON.stringify(context);
      const level = settings.level || 'info';
      console[level](`[actions] ${message}`);
      return { logged: true, level };
    },
    schema: {
      message: { type: 'string' },
      level: { type: 'string', enum: ['log', 'info', 'warn', 'error'] }
    }
  });

  registerAction('system:redirect', {
    label: 'Redirect to URL',
    execute: async (context, settings) => {
      const url = settings.url || '/';
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

      const to = settings.to || context.user?.email;
      const subject = settings.subject || 'Notification';
      const body = settings.body || '';

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
      const url = replaceTokens(settings.url || '', context);
      const method = (settings.method || 'POST').toUpperCase();
      const body = settings.includeContext !== false
        ? JSON.stringify({ event: context._event || null, data: context.content || context.user || {} })
        : settings.body || '';
      try {
        const { request } = await import('node:https');
        const parsed = new URL(url);
        return new Promise((resolve, reject) => {
          const req = (parsed.protocol === 'https:' ? require('node:https') : require('node:http'))
            .request(url, { method, headers: { 'Content-Type': 'application/json' } }, (res) => {
              let data = '';
              res.on('data', d => data += d);
              res.on('end', () => resolve({ status: res.statusCode, body: data.slice(0, 500) }));
            });
          req.on('error', e => resolve({ error: e.message }));
          if (body && method !== 'GET') req.write(body);
          req.end();
        });
      } catch (err) {
        return { error: err.message };
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
      if (!contentService || !context.content?.type || !context.content?.id) {
        return { tagged: false };
      }
      const item = contentService.get(context.content.type, context.content.id);
      if (!item) return { tagged: false };
      const tags = Array.isArray(item.tags) ? [...item.tags] : [];
      if (!tags.includes(settings.tag)) {
        tags.push(settings.tag);
        await contentService.update(context.content.type, context.content.id, { tags });
      }
      return { tagged: true, tag: settings.tag };
    },
    schema: {
      tag: { type: 'string', required: true }
    }
  });
}

// ============================================
// BUILT-IN CONDITIONS
// ============================================

/**
 * Register built-in conditions
 */
function registerBuiltInConditions() {
  registerCondition('content_type', {
    label: 'Content type is',
    evaluate: async (context, settings) => {
      const contentType = context.content?.type;
      const allowedTypes = settings.types || [];
      return allowedTypes.includes(contentType);
    },
    schema: {
      types: { type: 'array', required: true }
    }
  });

  registerCondition('user_role', {
    label: 'User has role',
    evaluate: async (context, settings) => {
      const userRoles = context.user?.roles || [];
      const requiredRole = settings.role;
      return userRoles.includes(requiredRole);
    },
    schema: {
      role: { type: 'string', required: true }
    }
  });

  registerCondition('field_value', {
    label: 'Field value equals',
    evaluate: async (context, settings) => {
      const fieldValue = context.content?.[settings.field];
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
      const fieldValue = context.content?.[settings.field];
      if (Array.isArray(fieldValue)) {
        return fieldValue.includes(settings.value);
      }
      if (typeof fieldValue === 'string') {
        return fieldValue.includes(settings.value);
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
    evaluate: async (context, settings) => {
      return !!context.user && context.user.id !== 'anonymous';
    }
  });

  registerCondition('time_range', {
    label: 'Current time in range',
    evaluate: async (context, settings) => {
      const now = new Date();
      const start = settings.start ? new Date(settings.start) : null;
      const end = settings.end ? new Date(settings.end) : null;

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
    evaluate: async (context, settings) => {
      return context.content?.status === 'published';
    }
  });

  registerCondition('field_is_empty', {
    label: 'Field is empty',
    evaluate: async (context, settings) => {
      const val = context.content?.[settings.field];
      return val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0);
    },
    schema: {
      field: { type: 'string', required: true }
    }
  });

  registerCondition('field_not_empty', {
    label: 'Field is not empty',
    evaluate: async (context, settings) => {
      const val = context.content?.[settings.field];
      return val !== undefined && val !== null && val !== '' && !(Array.isArray(val) && val.length === 0);
    },
    schema: {
      field: { type: 'string', required: true }
    }
  });

  registerCondition('path_matches', {
    label: 'Path matches pattern',
    evaluate: async (context, settings) => {
      const path = context.path || context.content?.slug || '';
      const pattern = settings.pattern || '';
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
      const tags = context.content?.tags || [];
      return Array.isArray(tags) && tags.includes(settings.tag);
    },
    schema: {
      tag: { type: 'string', required: true }
    }
  });
}

// ============================================
// BUILT-IN EVENTS
// ============================================

/**
 * Register built-in events
 */
function registerBuiltInEvents() {
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

// ============================================
// PERSISTENCE
// ============================================

/**
 * Load rules from storage
 */
function loadRules() {
  const rulesPath = join(baseDir, 'config', 'rules.json');

  if (existsSync(rulesPath)) {
    try {
      const data = JSON.parse(readFileSync(rulesPath, 'utf-8'));
      rules = data.rules || {};

      // Load scheduled actions
      if (data.scheduled) {
        scheduledActions.push(...data.scheduled.filter(s => !s.executed));

        // Reschedule pending actions
        for (const scheduled of scheduledActions) {
          const executeAt = new Date(scheduled.executeAt);
          if (executeAt > new Date()) {
            const delay = executeAt - new Date();
            setTimeout(async () => {
              await processScheduledAction(scheduled.id);
            }, delay);
          }
        }
      }
    } catch (error) {
      console.error('[actions] Error loading rules:', error.message);
      rules = {};
    }
  } else {
    rules = {};
  }
}

/**
 * Save rules to storage
 */
function saveRules() {
  const rulesPath = join(baseDir, 'config', 'rules.json');

  const data = {
    rules,
    scheduled: scheduledActions,
    actions: {
      // Store configured actions (not built-in)
    }
  };

  try {
    writeFileSync(rulesPath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error('[actions] Error saving rules:', error.message);
  }
}

// ============================================
// LOGGING
// ============================================

/**
 * Log action execution
 *
 * @param {string} ruleId - Rule ID
 * @param {Object} context - Execution context
 * @param {Object} result - Execution result
 */
function logExecution(ruleId, context, result) {
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
 * @param {number} limit - Max entries
 * @returns {Array} Log entries
 */
export function getExecutionLog(limit = 50) {
  return executionLog.slice(0, limit);
}

/**
 * Clear execution log
 */
export function clearExecutionLog() {
  executionLog.length = 0;
}

// ============================================
// TOKEN REPLACEMENT
// ============================================

/**
 * Replace tokens in object recursively
 *
 * @param {*} obj - Object to process
 * @param {Object} context - Token context
 * @returns {*} Processed object
 */
function replaceTokensInObject(obj, context) {
  if (typeof obj === 'string') {
    return replaceTokens(obj, context);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => replaceTokensInObject(item, context));
  }

  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = replaceTokensInObject(value, context);
    }
    return result;
  }

  return obj;
}

/**
 * Replace tokens in string
 *
 * @param {string} str - String with tokens
 * @param {Object} context - Token context
 * @returns {string} Processed string
 */
function replaceTokens(str, context) {
  if (!tokensSystem || !tokensSystem.replace) {
    // Fallback simple replacement
    return str.replace(/\[([^\]]+)\]/g, (match, path) => {
      const parts = path.split(':');
      let value = context;
      for (const part of parts) {
        value = value?.[part];
      }
      return value !== undefined ? String(value) : match;
    });
  }

  return tokensSystem.replace(str, context);
}

// ============================================
// UTILITIES
// ============================================

/**
 * Export all rules and configuration
 *
 * @returns {Object} Complete configuration
 */
export function exportConfig() {
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
 * @param {Object} config - Configuration to import
 */
export function importConfig(config) {
  if (config.rules) {
    rules = { ...config.rules };
    saveRules();
  }
}

// ============================================
// HOOK WIRING — connects CMS events to ECA rules
// ============================================

/**
 * Wire CMS hook events into the ECA rule engine.
 * Call this after all modules are initialized (READY phase)
 * so that content/user operations automatically trigger matching rules.
 *
 * @param {Object} hooks - The hooks system
 * @param {Object} contentSvc - The content service
 */
export function wireHooks(hooks, contentSvc) {
  if (!hooks) return;
  contentService = contentSvc;

  // Content lifecycle hooks → ECA events
  const contentHooks = [
    ['content:afterCreate', 'content:create'],
    ['content:afterUpdate', 'content:update'],
    ['content:afterDelete', 'content:delete'],
    ['content:afterPublish', 'content:publish'],
    ['content:afterUnpublish', 'content:unpublish'],
  ];

  for (const [hookName, eventId] of contentHooks) {
    hooks.register(hookName, async (ctx) => {
      try {
        const ecaCtx = { ...ctx, _event: eventId };
        await triggerEvent(eventId, ecaCtx);
      } catch (err) {
        console.error(`[eca] Error triggering ${eventId} from ${hookName}:`, err.message);
      }
    }, 100); // Low priority — run after core handlers
  }

  // User lifecycle hooks → ECA events
  const userHooks = [
    ['user:afterLogin', 'user:login'],
    ['user:afterLogout', 'user:logout'],
    ['user:afterRegister', 'user:register'],
    ['user:afterUpdate', 'user:update'],
  ];

  for (const [hookName, eventId] of userHooks) {
    hooks.register(hookName, async (ctx) => {
      try {
        await triggerEvent(eventId, { ...ctx, _event: eventId });
      } catch (err) {
        console.error(`[eca] Error triggering ${eventId} from ${hookName}:`, err.message);
      }
    }, 100);
  }

  // System hooks
  hooks.register('cron:run', async (ctx) => {
    try {
      await triggerEvent('system:cron', { ...ctx, _event: 'system:cron', timestamp: new Date().toISOString() });
    } catch (err) {
      console.error('[eca] Error triggering system:cron:', err.message);
    }
  }, 100);

  // Register additional events now that we know the full system
  registerEvent('comment:create', { label: 'Comment created', context: { comment: 'object', content: 'object' } });
  registerEvent('form:submit', { label: 'Form submitted', context: { form: 'object', data: 'object' } });
  registerEvent('workflow:transition', { label: 'Workflow transition', context: { content: 'object', from: 'string', to: 'string' } });

  // Wire comment/form/workflow hooks if they exist
  hooks.register('comment:afterCreate', async (ctx) => {
    try { await triggerEvent('comment:create', { ...ctx, _event: 'comment:create' }); } catch (e) { /* silent */ }
  }, 100);

  hooks.register('workflow:afterTransition', async (ctx) => {
    try { await triggerEvent('workflow:transition', { ...ctx, _event: 'workflow:transition' }); } catch (e) { /* silent */ }
  }, 100);

  console.log(`[eca] Wired ${contentHooks.length + userHooks.length + 3} hook→event bridges`);
}
