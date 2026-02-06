/**
 * batch.js - Batch Operations System
 *
 * WHY THIS EXISTS:
 * Large bulk operations (publishing 500+ items, mass updates) need:
 * - Progressive processing to avoid timeouts
 * - Progress tracking for UI feedback
 * - Resume capability for interrupted batches
 * - Flexible operation chaining
 * - Error handling per item
 *
 * BATCH vs QUEUE:
 * - Queue: individual long-running jobs (export, import)
 * - Batch: coordinated operations on multiple items with shared context
 *
 * BATCH LIFECYCLE:
 * created → processing → completed/failed
 *          ↓           ↓
 *          └─ paused ─┘
 *
 * STORAGE:
 * In-memory + logs/batches/ for persistence
 */

import * as fs from 'fs';
import * as path from 'path';
import * as hooks from './hooks.js';

// Configuration
let baseDir = './content';
let queue = null;
let hooksInstance = null;

// Batch storage
let batchDir = null;

// In-memory batch storage
// Map<batchId, batch>
const batches = new Map();

// Registered callback handlers
// Map<callbackName, handler>
const callbacks = new Map();

// Active processing locks
const processing = new Set();

/**
 * Generate unique batch ID
 */
function generateBatchId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `batch_${timestamp}_${random}`;
}

/**
 * Initialize batch system
 * @param {string} contentDir - Base content directory
 * @param {object} queueService - Queue service reference
 * @param {object} hooksService - Hooks service reference
 */
export function init(contentDir, queueService, hooksService) {
  baseDir = contentDir;
  queue = queueService;
  hooksInstance = hooksService || hooks;

  // Set up batch directory
  batchDir = path.join(baseDir, 'logs', 'batches');
  if (!fs.existsSync(batchDir)) {
    fs.mkdirSync(batchDir, { recursive: true });
  }

  // Load persisted batches
  loadBatches();

  console.log('[batch] Initialized');
}

/**
 * Load batches from persistence
 */
function loadBatches() {
  if (!batchDir || !fs.existsSync(batchDir)) {
    return;
  }

  try {
    const files = fs.readdirSync(batchDir);
    let loaded = 0;

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      try {
        const filePath = path.join(batchDir, file);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        // Only load active batches
        if (data.status === 'processing' || data.status === 'paused') {
          batches.set(data.id, data);
          loaded++;
        }
      } catch (error) {
        console.error(`[batch] Failed to load ${file}:`, error.message);
      }
    }

    if (loaded > 0) {
      console.log(`[batch] Loaded ${loaded} active batches`);
    }
  } catch (error) {
    console.error('[batch] Failed to load batches:', error.message);
  }
}

/**
 * Save batch to persistence
 * @param {object} batch - Batch object
 */
function saveBatch(batch) {
  if (!batchDir) return;

  try {
    const filePath = path.join(batchDir, `${batch.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(batch, null, 2));
  } catch (error) {
    console.error(`[batch] Failed to save batch ${batch.id}:`, error.message);
  }
}

/**
 * Delete batch file
 * @param {string} batchId - Batch ID
 */
function deleteBatchFile(batchId) {
  if (!batchDir) return;

  try {
    const filePath = path.join(batchDir, `${batchId}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error(`[batch] Failed to delete batch ${batchId}:`, error.message);
  }
}

/**
 * Create a new batch
 * @param {string} title - Batch title
 * @param {Array} operations - Array of {callback, args}
 * @param {object} options - Batch options
 * @returns {object} - Created batch
 */
export function createBatch(title, operations = [], options = {}) {
  const now = new Date().toISOString();

  const batch = {
    id: generateBatchId(),
    title,
    operations,
    current: 0,
    total: operations.length,
    context: options.context || {},
    status: 'created',
    continueOnError: options.continueOnError !== false,
    started: null,
    completed: null,
    errors: [],
    results: [],
    createdBy: options.userId || 'system',
    createdAt: now,
  };

  batches.set(batch.id, batch);
  saveBatch(batch);

  // Trigger hook
  hooksInstance.trigger('batch:created', { batch });

  return batch;
}

/**
 * Add operation to existing batch
 * @param {string} batchId - Batch ID
 * @param {string} callback - Callback name
 * @param {Array} args - Operation arguments
 * @returns {boolean} - Success
 */
export function addOperation(batchId, callback, args = []) {
  const batch = batches.get(batchId);

  if (!batch) {
    return false;
  }

  if (batch.status !== 'created' && batch.status !== 'paused') {
    return false; // Can only add to created/paused batches
  }

  batch.operations.push({ callback, args });
  batch.total = batch.operations.length;
  saveBatch(batch);

  return true;
}

/**
 * Process batch operations
 * @param {string} batchId - Batch ID
 * @param {number} limit - Max operations to process (0 = all)
 * @returns {Promise<object>} - Batch result
 */
export async function processBatch(batchId, limit = 0) {
  const batch = batches.get(batchId);

  if (!batch) {
    throw new Error(`Batch not found: ${batchId}`);
  }

  if (processing.has(batchId)) {
    throw new Error(`Batch already processing: ${batchId}`);
  }

  // Mark as processing
  processing.add(batchId);

  if (!batch.started) {
    batch.started = new Date().toISOString();
  }
  batch.status = 'processing';
  saveBatch(batch);

  // Trigger start hook
  await hooksInstance.trigger('batch:start', { batch });

  try {
    const operations = batch.operations;
    const toProcess = limit > 0
      ? Math.min(limit, operations.length - batch.current)
      : operations.length - batch.current;

    for (let i = 0; i < toProcess; i++) {
      const index = batch.current;
      const operation = operations[index];

      try {
        // Execute operation
        const result = await executeOperation(operation, batch);
        batch.results.push({ index, result, success: true });

        // Update progress
        batch.current++;
        saveBatch(batch);

        // Trigger progress hook
        await hooksInstance.trigger('batch:progress', {
          batch,
          progress: getProgress(batchId),
        });

      } catch (error) {
        // Record error
        batch.errors.push({
          index,
          operation,
          error: error.message,
          timestamp: new Date().toISOString(),
        });

        batch.current++;
        saveBatch(batch);

        // Trigger error hook
        await hooksInstance.trigger('batch:error', {
          batch,
          error,
          operation,
        });

        // Stop if not continuing on error
        if (!batch.continueOnError) {
          batch.status = 'failed';
          batch.completed = new Date().toISOString();
          saveBatch(batch);
          processing.delete(batchId);
          return batch;
        }
      }
    }

    // Check if completed
    if (batch.current >= batch.total) {
      batch.status = 'completed';
      batch.completed = new Date().toISOString();

      // Trigger finish hook
      await hooksInstance.trigger('batch:finish', { batch });

      // Clean up
      deleteBatchFile(batchId);
    } else {
      batch.status = 'paused';
    }

    saveBatch(batch);

  } finally {
    processing.delete(batchId);
  }

  return batch;
}

/**
 * Execute a single operation
 * @param {object} operation - Operation {callback, args}
 * @param {object} batch - Batch context
 * @returns {Promise<*>} - Operation result
 */
async function executeOperation(operation, batch) {
  const { callback, args } = operation;
  const handler = callbacks.get(callback);

  if (!handler) {
    throw new Error(`No handler registered for callback: ${callback}`);
  }

  // Execute with batch context
  return await handler(...args, batch.context);
}

/**
 * Process all remaining operations
 * @param {string} batchId - Batch ID
 * @returns {Promise<object>} - Batch result
 */
export async function processAll(batchId) {
  return await processBatch(batchId, 0);
}

/**
 * Get batch status
 * @param {string} batchId - Batch ID
 * @returns {object|null} - Batch or null
 */
export function getBatchStatus(batchId) {
  return batches.get(batchId) || null;
}

/**
 * Cancel a batch
 * @param {string} batchId - Batch ID
 * @returns {boolean} - Success
 */
export function cancelBatch(batchId) {
  const batch = batches.get(batchId);

  if (!batch) {
    return false;
  }

  if (batch.status === 'completed' || batch.status === 'failed') {
    return false; // Already finished
  }

  if (processing.has(batchId)) {
    return false; // Currently processing
  }

  batch.status = 'cancelled';
  batch.completed = new Date().toISOString();
  saveBatch(batch);

  // Trigger hook
  hooksInstance.trigger('batch:cancelled', { batch });

  // Clean up
  deleteBatchFile(batchId);

  return true;
}

/**
 * Get all active batches
 * @returns {Array} - Array of active batches
 */
export function getActiveBatches() {
  const active = [];

  for (const batch of batches.values()) {
    if (batch.status === 'processing' || batch.status === 'paused') {
      active.push(batch);
    }
  }

  return active;
}

/**
 * Register a callback handler
 * @param {string} name - Callback name (e.g., 'content:publish')
 * @param {Function} fn - Handler function
 */
export function registerCallback(name, fn) {
  callbacks.set(name, fn);
}

/**
 * Get batch progress
 * @param {string} batchId - Batch ID
 * @returns {object} - Progress data
 */
export function getProgress(batchId) {
  const batch = batches.get(batchId);

  if (!batch) {
    return null;
  }

  const percentage = batch.total > 0
    ? Math.round((batch.current / batch.total) * 100)
    : 0;

  return {
    current: batch.current,
    total: batch.total,
    percentage,
    errors: batch.errors.length,
    remaining: batch.total - batch.current,
    status: batch.status,
  };
}

/**
 * Register finish callback for batch
 * @param {string} batchId - Batch ID
 * @param {Function} callback - Callback function
 */
export function onFinish(batchId, callback) {
  const batch = batches.get(batchId);

  if (!batch) {
    return;
  }

  // If already finished, call immediately
  if (batch.status === 'completed' || batch.status === 'failed') {
    callback(batch);
    return;
  }

  // Register one-time hook listener
  const hookName = `batch:finish:${batchId}`;
  hooksInstance.register(hookName, async (context) => {
    if (context.batch.id === batchId) {
      callback(context.batch);
    }
  }, 10, 'batch:onFinish');
}

/**
 * List all batches
 * @param {object} filter - Filter options
 * @returns {Array} - Array of batches
 */
export function listBatches(filter = {}) {
  const result = [];

  for (const batch of batches.values()) {
    if (filter.status && batch.status !== filter.status) {
      continue;
    }
    if (filter.userId && batch.createdBy !== filter.userId) {
      continue;
    }
    result.push(batch);
  }

  // Sort by creation date (newest first)
  result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return result;
}

/**
 * Get batch statistics
 * @returns {object} - Statistics
 */
export function getStats() {
  const stats = {
    total: batches.size,
    created: 0,
    processing: 0,
    paused: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    active: processing.size,
  };

  for (const batch of batches.values()) {
    stats[batch.status] = (stats[batch.status] || 0) + 1;
  }

  return stats;
}

/**
 * Clean up completed batches
 * @param {number} maxAge - Max age in days (default: 7)
 * @returns {number} - Number of batches cleaned
 */
export function cleanup(maxAge = 7) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAge);

  let cleaned = 0;

  for (const [id, batch] of batches) {
    if (batch.status === 'completed' || batch.status === 'failed' || batch.status === 'cancelled') {
      const completedAt = new Date(batch.completed);
      if (completedAt < cutoff) {
        batches.delete(id);
        deleteBatchFile(id);
        cleaned++;
      }
    }
  }

  return cleaned;
}

/**
 * Pause a running batch
 * @param {string} batchId - Batch ID
 * @returns {boolean} - Success
 */
export function pauseBatch(batchId) {
  const batch = batches.get(batchId);

  if (!batch) {
    return false;
  }

  if (batch.status !== 'processing') {
    return false;
  }

  if (processing.has(batchId)) {
    return false; // Can't pause while actively processing
  }

  batch.status = 'paused';
  saveBatch(batch);

  return true;
}

/**
 * Resume a paused batch
 * @param {string} batchId - Batch ID
 * @param {number} limit - Max operations to process (0 = all)
 * @returns {Promise<object>} - Batch result
 */
export async function resumeBatch(batchId, limit = 0) {
  const batch = batches.get(batchId);

  if (!batch) {
    throw new Error(`Batch not found: ${batchId}`);
  }

  if (batch.status !== 'paused') {
    throw new Error(`Batch not paused: ${batchId}`);
  }

  return await processBatch(batchId, limit);
}

// ============================================================
// BUILT-IN CALLBACKS
// ============================================================

/**
 * Register built-in batch callbacks
 * Called during boot to set up standard operations
 */
export function registerBuiltinCallbacks(context) {
  const content = context.services.get('content');

  // content:publish
  registerCallback('content:publish', async (contentType, id, batchContext) => {
    return await content.update(contentType, id, { status: 'published' });
  });

  // content:unpublish
  registerCallback('content:unpublish', async (contentType, id, batchContext) => {
    return await content.update(contentType, id, { status: 'draft' });
  });

  // content:archive
  registerCallback('content:archive', async (contentType, id, batchContext) => {
    return await content.update(contentType, id, { status: 'archived' });
  });

  // content:delete
  registerCallback('content:delete', async (contentType, id, batchContext) => {
    return await content.remove(contentType, id);
  });

  // content:update
  registerCallback('content:update', async (contentType, id, data, batchContext) => {
    return await content.update(contentType, id, data);
  });

  console.log('[batch] Built-in callbacks registered');
}
