/**
 * workflow-advanced.js - Advanced Editorial Workflow System
 *
 * WHY THIS EXISTS:
 * Extends basic workflow (draft/published) with:
 * - Custom workflow states beyond draft/published
 * - Transition rules between states
 * - Role-based permissions for transitions
 * - Transition hooks (email, audit, etc.)
 * - Multiple parallel workflows
 * - Scheduled transitions
 * - Complete transition history
 * - Per-content-type workflow assignment
 *
 * DESIGN DECISION: Build on existing workflow
 * Uses content.js workflow as foundation. Advanced workflows
 * map to basic status (draft/published) for compatibility.
 *
 * Zero dependencies - Node.js standard library only
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Module state
 */
let baseDir = null;
let contentModule = null;
let schedulerModule = null;
let hooksModule = null;
let workflowsDir = null;

/**
 * In-memory workflow configurations
 * { workflowId: { label, states, transitions } }
 */
let workflows = {};

/**
 * Content type to workflow assignments
 * { contentType: workflowId }
 */
let assignments = {};

/**
 * Content workflow state storage
 * { 'type/id': { currentState, workflowId, history: [] } }
 */
let contentStates = {};

/**
 * Scheduled transitions queue
 * { id, type, contentId, transition, datetime, workflowId }
 */
let scheduledTransitions = [];
let nextScheduledId = 1;

/**
 * Initialize workflow system
 *
 * @param {string} dir - Base directory
 * @param {Object} content - Content module instance
 * @param {Object} scheduler - Scheduler module instance (optional)
 * @param {Object} hooks - Hooks module instance (optional)
 */
export async function init(dir, content, scheduler = null, hooks = null) {
  baseDir = dir;
  contentModule = content;
  schedulerModule = scheduler;
  hooksModule = hooks;
  workflowsDir = join(baseDir, 'config');

  // Ensure directories exist
  if (!existsSync(workflowsDir)) {
    await mkdir(workflowsDir, { recursive: true });
  }

  // Load workflows from config
  await loadWorkflows();

  // Load assignments
  await loadAssignments();

  // Load content states
  await loadContentStates();

  // Load scheduled transitions
  await loadScheduledTransitions();

  // Register scheduler job if available
  if (schedulerModule && typeof schedulerModule.schedule === 'function') {
    schedulerModule.schedule('workflow:transitions', '* * * * *', checkScheduledTransitions);
  }
}

/**
 * Load workflows from config/workflows.json
 */
async function loadWorkflows() {
  const path = join(workflowsDir, 'workflows.json');
  if (!existsSync(path)) {
    workflows = {};
    return;
  }

  try {
    const data = await readFile(path, 'utf8');
    workflows = JSON.parse(data);
  } catch (error) {
    console.error(`[workflow-advanced] Failed to load workflows: ${error.message}`);
    workflows = {};
  }
}

/**
 * Save workflows to config/workflows.json
 */
async function saveWorkflows() {
  const path = join(workflowsDir, 'workflows.json');
  await writeFile(path, JSON.stringify(workflows, null, 2), 'utf8');
}

/**
 * Load workflow assignments from config/workflow-assignments.json
 */
async function loadAssignments() {
  const path = join(workflowsDir, 'workflow-assignments.json');
  if (!existsSync(path)) {
    assignments = {};
    return;
  }

  try {
    const data = await readFile(path, 'utf8');
    assignments = JSON.parse(data);
  } catch (error) {
    console.error(`[workflow-advanced] Failed to load assignments: ${error.message}`);
    assignments = {};
  }
}

/**
 * Save workflow assignments
 */
async function saveAssignments() {
  const path = join(workflowsDir, 'workflow-assignments.json');
  await writeFile(path, JSON.stringify(assignments, null, 2), 'utf8');
}

/**
 * Load content states from data/workflow-states.json
 */
async function loadContentStates() {
  const path = join(baseDir, 'data', 'workflow-states.json');
  if (!existsSync(path)) {
    contentStates = {};
    return;
  }

  try {
    const data = await readFile(path, 'utf8');
    contentStates = JSON.parse(data);
  } catch (error) {
    console.error(`[workflow-advanced] Failed to load content states: ${error.message}`);
    contentStates = {};
  }
}

/**
 * Save content states
 */
async function saveContentStates() {
  const path = join(baseDir, 'data', 'workflow-states.json');
  const dir = join(baseDir, 'data');

  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  await writeFile(path, JSON.stringify(contentStates, null, 2), 'utf8');
}

/**
 * Load scheduled transitions
 */
async function loadScheduledTransitions() {
  const path = join(baseDir, 'data', 'scheduled-transitions.json');
  if (!existsSync(path)) {
    scheduledTransitions = [];
    nextScheduledId = 1;
    return;
  }

  try {
    const data = await readFile(path, 'utf8');
    const parsed = JSON.parse(data);
    scheduledTransitions = parsed.transitions || [];
    nextScheduledId = parsed.nextId || 1;
  } catch (error) {
    console.error(`[workflow-advanced] Failed to load scheduled transitions: ${error.message}`);
    scheduledTransitions = [];
    nextScheduledId = 1;
  }
}

/**
 * Save scheduled transitions
 */
async function saveScheduledTransitions() {
  const path = join(baseDir, 'data', 'scheduled-transitions.json');
  const dir = join(baseDir, 'data');

  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  await writeFile(
    path,
    JSON.stringify({ transitions: scheduledTransitions, nextId: nextScheduledId }, null, 2),
    'utf8'
  );
}

/**
 * Create or update a workflow
 *
 * @param {string} id - Workflow identifier
 * @param {Object} config - Workflow configuration
 * @param {string} config.label - Human-readable label
 * @param {Object} config.states - State definitions { stateId: { label, initial?, published? } }
 * @param {Object} config.transitions - Transition rules { transitionId: { from: [], to, roles: [] } }
 * @returns {Object} Created workflow
 */
export async function createWorkflow(id, config) {
  const { label, states, transitions } = config;

  if (!label || !states || !transitions) {
    throw new Error('Workflow requires label, states, and transitions');
  }

  // Validate states
  const stateIds = Object.keys(states);
  if (stateIds.length === 0) {
    throw new Error('Workflow must have at least one state');
  }

  // Find initial state
  const initialStates = stateIds.filter(sid => states[sid].initial);
  if (initialStates.length === 0) {
    throw new Error('Workflow must have one initial state');
  }
  if (initialStates.length > 1) {
    throw new Error('Workflow can only have one initial state');
  }

  // Validate transitions
  for (const [tid, trans] of Object.entries(transitions)) {
    if (!Array.isArray(trans.from) || trans.from.length === 0) {
      throw new Error(`Transition "${tid}" must have at least one "from" state`);
    }
    if (!trans.to) {
      throw new Error(`Transition "${tid}" must have a "to" state`);
    }
    // Check all states exist
    for (const fromState of trans.from) {
      if (!states[fromState]) {
        throw new Error(`Transition "${tid}" references unknown state "${fromState}"`);
      }
    }
    if (!states[trans.to]) {
      throw new Error(`Transition "${tid}" references unknown state "${trans.to}"`);
    }
    // Ensure roles array
    if (!Array.isArray(trans.roles)) {
      trans.roles = [];
    }
  }

  workflows[id] = { label, states, transitions };
  await saveWorkflows();

  return workflows[id];
}

/**
 * Get workflow by ID
 *
 * @param {string} id - Workflow identifier
 * @returns {Object|null} Workflow configuration
 */
export function getWorkflow(id) {
  return workflows[id] || null;
}

/**
 * List all workflows
 *
 * @returns {Object} Workflows { id: config }
 */
export function listWorkflows() {
  return { ...workflows };
}

/**
 * Delete workflow
 *
 * @param {string} id - Workflow identifier
 */
export async function deleteWorkflow(id) {
  if (!workflows[id]) {
    throw new Error(`Workflow "${id}" not found`);
  }

  // Check if workflow is assigned to any content types
  const assignedTypes = Object.entries(assignments)
    .filter(([, wid]) => wid === id)
    .map(([type]) => type);

  if (assignedTypes.length > 0) {
    throw new Error(
      `Cannot delete workflow "${id}". Assigned to: ${assignedTypes.join(', ')}`
    );
  }

  delete workflows[id];
  await saveWorkflows();
}

/**
 * Assign workflow to content type
 *
 * @param {string} contentType - Content type
 * @param {string} workflowId - Workflow identifier
 */
export async function assignWorkflow(contentType, workflowId) {
  if (!workflows[workflowId]) {
    throw new Error(`Workflow "${workflowId}" not found`);
  }

  assignments[contentType] = workflowId;
  await saveAssignments();
}

/**
 * Unassign workflow from content type
 *
 * @param {string} contentType - Content type
 */
export async function unassignWorkflow(contentType) {
  delete assignments[contentType];
  await saveAssignments();
}

/**
 * Get workflow assignment for content type
 *
 * @param {string} contentType - Content type
 * @returns {string|null} Workflow ID or null
 */
export function getAssignment(contentType) {
  return assignments[contentType] || null;
}

/**
 * Get content state
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @returns {Object|null} State { currentState, workflowId, history }
 */
export function getContentState(type, id) {
  const key = `${type}/${id}`;
  return contentStates[key] || null;
}

/**
 * Initialize content with workflow
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @returns {Object} Initial state
 */
export async function initializeContent(type, id) {
  const workflowId = assignments[type];
  if (!workflowId) {
    throw new Error(`No workflow assigned to content type "${type}"`);
  }

  const workflow = workflows[workflowId];
  if (!workflow) {
    throw new Error(`Workflow "${workflowId}" not found`);
  }

  // Find initial state
  const initialState = Object.keys(workflow.states).find(
    sid => workflow.states[sid].initial
  );

  const key = `${type}/${id}`;
  contentStates[key] = {
    currentState: initialState,
    workflowId,
    history: [
      {
        state: initialState,
        timestamp: new Date().toISOString(),
        user: 'system',
        transition: null,
      },
    ],
  };

  await saveContentStates();

  return contentStates[key];
}

/**
 * Check if user can perform transition
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {string} transitionId - Transition identifier
 * @param {Object} user - User object with roles
 * @returns {boolean} Can transition
 */
export function canTransition(type, id, transitionId, user) {
  const key = `${type}/${id}`;
  const state = contentStates[key];

  if (!state) {
    return false;
  }

  const workflow = workflows[state.workflowId];
  if (!workflow) {
    return false;
  }

  const transition = workflow.transitions[transitionId];
  if (!transition) {
    return false;
  }

  // Check current state allows this transition
  if (!transition.from.includes(state.currentState)) {
    return false;
  }

  // Check user has required role
  if (transition.roles.length === 0) {
    return true; // No role restriction
  }

  if (!user || !Array.isArray(user.roles)) {
    return false;
  }

  return transition.roles.some(role => user.roles.includes(role));
}

/**
 * Get available transitions for content
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {Object} user - User object with roles
 * @returns {Array} Available transitions { id, label, to }
 */
export function getAvailableTransitions(type, id, user) {
  const key = `${type}/${id}`;
  const state = contentStates[key];

  if (!state) {
    return [];
  }

  const workflow = workflows[state.workflowId];
  if (!workflow) {
    return [];
  }

  const available = [];

  for (const [tid, transition] of Object.entries(workflow.transitions)) {
    if (canTransition(type, id, tid, user)) {
      available.push({
        id: tid,
        label: transition.label || tid,
        to: transition.to,
        toLabel: workflow.states[transition.to]?.label || transition.to,
      });
    }
  }

  return available;
}

/**
 * Perform workflow transition
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {string} transitionId - Transition identifier
 * @param {Object} user - User object
 * @param {Object} options - Transition options
 * @returns {Object} New state
 */
export async function doTransition(type, id, transitionId, user, options = {}) {
  if (!canTransition(type, id, transitionId, user)) {
    throw new Error(`Transition "${transitionId}" not allowed`);
  }

  const key = `${type}/${id}`;
  const state = contentStates[key];
  const workflow = workflows[state.workflowId];
  const transition = workflow.transitions[transitionId];

  const fromState = state.currentState;
  const toState = transition.to;

  // Fire before hook
  if (hooksModule) {
    await hooksModule.trigger('workflow:beforeTransition', {
      type,
      id,
      transition: transitionId,
      fromState,
      toState,
      user,
      options,
    });
  }

  // Update state
  state.currentState = toState;
  state.history.push({
    state: toState,
    timestamp: new Date().toISOString(),
    user: user?.username || user?.id || 'unknown',
    transition: transitionId,
    fromState,
  });

  await saveContentStates();

  // Update content status in base workflow
  if (contentModule) {
    const newStatus = workflow.states[toState].published ? 'published' : 'draft';
    try {
      await contentModule.setStatus(type, id, newStatus, { skipHooks: true });
    } catch (error) {
      console.error(`[workflow-advanced] Failed to sync status: ${error.message}`);
    }
  }

  // Fire after hook
  if (hooksModule) {
    await hooksModule.trigger('workflow:afterTransition', {
      type,
      id,
      transition: transitionId,
      fromState,
      toState,
      user,
      options,
    });
  }

  return state;
}

/**
 * Schedule transition for future execution
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {string} transitionId - Transition identifier
 * @param {string|Date} datetime - When to execute
 * @param {Object} user - User scheduling the transition
 * @returns {Object} Scheduled transition
 */
export async function scheduleTransition(type, id, transitionId, datetime, user) {
  const key = `${type}/${id}`;
  const state = contentStates[key];

  if (!state) {
    throw new Error(`Content ${type}/${id} not in workflow`);
  }

  const workflow = workflows[state.workflowId];
  const transition = workflow.transitions[transitionId];

  if (!transition) {
    throw new Error(`Transition "${transitionId}" not found`);
  }

  const scheduleDate = typeof datetime === 'string' ? new Date(datetime) : datetime;

  if (scheduleDate <= new Date()) {
    throw new Error('Schedule time must be in the future');
  }

  const scheduled = {
    id: nextScheduledId++,
    type,
    contentId: id,
    transition: transitionId,
    datetime: scheduleDate.toISOString(),
    workflowId: state.workflowId,
    scheduledBy: user?.username || user?.id || 'unknown',
    createdAt: new Date().toISOString(),
  };

  scheduledTransitions.push(scheduled);
  await saveScheduledTransitions();

  return scheduled;
}

/**
 * Cancel scheduled transition
 *
 * @param {number} scheduledId - Scheduled transition ID
 */
export async function cancelScheduledTransition(scheduledId) {
  const index = scheduledTransitions.findIndex(s => s.id === scheduledId);
  if (index === -1) {
    throw new Error(`Scheduled transition ${scheduledId} not found`);
  }

  scheduledTransitions.splice(index, 1);
  await saveScheduledTransitions();
}

/**
 * Get scheduled transitions for content
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @returns {Array} Scheduled transitions
 */
export function getScheduledTransitions(type, id) {
  return scheduledTransitions.filter(s => s.type === type && s.contentId === id);
}

/**
 * Check and execute scheduled transitions
 */
async function checkScheduledTransitions() {
  const now = new Date();
  const due = scheduledTransitions.filter(s => new Date(s.datetime) <= now);

  for (const scheduled of due) {
    try {
      // Execute transition
      await doTransition(
        scheduled.type,
        scheduled.contentId,
        scheduled.transition,
        { username: 'scheduler', roles: ['admin'] }, // System user
        { scheduled: true }
      );

      // Remove from queue
      const index = scheduledTransitions.findIndex(s => s.id === scheduled.id);
      if (index !== -1) {
        scheduledTransitions.splice(index, 1);
      }

      // Fire hook
      if (hooksModule) {
        await hooksModule.trigger('workflow:scheduled', {
          type: scheduled.type,
          id: scheduled.contentId,
          transition: scheduled.transition,
          scheduled,
        });
      }

      console.log(
        `[workflow-advanced] Executed scheduled transition: ${scheduled.type}/${scheduled.contentId} -> ${scheduled.transition}`
      );
    } catch (error) {
      console.error(
        `[workflow-advanced] Failed scheduled transition ${scheduled.id}: ${error.message}`
      );
    }
  }

  if (due.length > 0) {
    await saveScheduledTransitions();
  }
}

/**
 * Get transition history for content
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @returns {Array} History entries
 */
export function getTransitionHistory(type, id) {
  const key = `${type}/${id}`;
  const state = contentStates[key];
  return state ? [...state.history] : [];
}

/**
 * Export all workflow data (for backup/migration)
 *
 * @returns {Object} All workflow data
 */
export function exportData() {
  return {
    workflows,
    assignments,
    contentStates,
    scheduledTransitions,
    nextScheduledId,
  };
}

/**
 * Import workflow data (for restore/migration)
 *
 * @param {Object} data - Workflow data to import
 */
export async function importData(data) {
  if (data.workflows) workflows = data.workflows;
  if (data.assignments) assignments = data.assignments;
  if (data.contentStates) contentStates = data.contentStates;
  if (data.scheduledTransitions) scheduledTransitions = data.scheduledTransitions;
  if (data.nextScheduledId) nextScheduledId = data.nextScheduledId;

  await saveWorkflows();
  await saveAssignments();
  await saveContentStates();
  await saveScheduledTransitions();
}
