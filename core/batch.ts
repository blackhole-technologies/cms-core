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
import * as hooks from './hooks.ts';

// ============= Types =============

/** Status values for a batch */
type BatchStatus = 'created' | 'processing' | 'paused' | 'completed' | 'failed' | 'cancelled';

/** A single operation queued in a batch */
interface BatchOperation {
  callback: string;
  args: unknown[];
}

/** Result of a completed operation */
interface BatchOperationResult {
  index: number;
  result: unknown;
  success: boolean;
}

/** Error record for a failed operation */
interface BatchOperationError {
  index: number;
  operation: BatchOperation;
  error: string;
  timestamp: string;
}

/** Batch record stored in memory and on disk */
interface Batch {
  id: string;
  title: string;
  operations: BatchOperation[];
  current: number;
  total: number;
  context: Record<string, unknown>;
  status: BatchStatus;
  continueOnError: boolean;
  started: string | null;
  completed: string | null;
  errors: BatchOperationError[];
  results: BatchOperationResult[];
  createdBy: string;
  createdAt: string;
}

/** Batch progress snapshot */
interface BatchProgress {
  current: number;
  total: number;
  percentage: number;
  errors: number;
  remaining: number;
  status: BatchStatus;
}

/** Batch statistics */
interface BatchStats {
  total: number;
  created: number;
  processing: number;
  paused: number;
  completed: number;
  failed: number;
  cancelled: number;
  active: number;
  [key: string]: number;
}

/** Minimal hooks service interface */
interface HooksService {
  trigger(event: string, context: Record<string, unknown>): Promise<Record<string, unknown>>;
  register(event: string, handler: (ctx: Record<string, unknown>) => Promise<void>, priority: number, source: string): void;
}

// ============= State =============

// Configuration
let baseDir = './content';
let queue: unknown = null;
let hooksInstance: HooksService | null = null;

// Batch storage
let batchDir: string | null = null;

// In-memory batch storage
// Map<batchId, batch>
const batches = new Map<string, Batch>();

// Registered callback handlers
// Map<callbackName, handler>
const callbacks = new Map<string, (...args: unknown[]) => Promise<unknown>>();

// Active processing locks
const processing = new Set<string>();

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
export function init(contentDir: string, queueService: unknown, hooksService: HooksService | null): void {
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
  if (!batchDir || !fs.existsSync(batchDir as string)) {
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
        console.error(`[batch] Failed to load ${file}:`, (error as Error).message);
      }
    }

    if (loaded > 0) {
      console.log(`[batch] Loaded ${loaded} active batches`);
    }
  } catch (error) {
    console.error('[batch] Failed to load batches:', (error as Error).message);
  }
}

/**
 * Save batch to persistence
 * @param {object} batch - Batch object
 */
function saveBatch(batch: Batch): void {
  if (!batchDir) return;

  try {
    const filePath = path.join(batchDir, `${batch.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(batch, null, 2));
  } catch (error) {
    console.error(`[batch] Failed to save batch ${batch.id}:`, (error as Error).message);
  }
}

/**
 * Delete batch file
 * @param {string} batchId - Batch ID
 */
function deleteBatchFile(batchId: string): void {
  if (!batchDir) return;

  try {
    const filePath = path.join(batchDir, `${batchId}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error(`[batch] Failed to delete batch ${batchId}:`, (error as Error).message);
  }
}

/**
 * Create a new batch
 * @param {string} title - Batch title
 * @param {Array} operations - Array of {callback, args}
 * @param {object} options - Batch options
 * @returns {object} - Created batch
 */
export function createBatch(title: string, operations: BatchOperation[] = [], options: { context?: Record<string, unknown>; continueOnError?: boolean; userId?: string } = {}): Batch {
  const now = new Date().toISOString();

  const batch: Batch = {
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
  hooksInstance?.trigger('batch:created', { batch: batch as unknown as Record<string, unknown> });

  return batch;
}

/**
 * Add operation to existing batch
 * @param {string} batchId - Batch ID
 * @param {string} callback - Callback name
 * @param {Array} args - Operation arguments
 * @returns {boolean} - Success
 */
export function addOperation(batchId: string, callback: string, args: unknown[] = []): boolean {
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
export async function processBatch(batchId: string, limit = 0): Promise<Batch> {
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
  await hooksInstance?.trigger('batch:start', { batch: batch as unknown as Record<string, unknown> });

  try {
    const operations = batch.operations;
    const toProcess = limit > 0
      ? Math.min(limit, operations.length - batch.current)
      : operations.length - batch.current;

    for (let i = 0; i < toProcess; i++) {
      const index = batch.current;
      const operation = operations[index]!;

      try {
        // Execute operation
        const result = await executeOperation(operation, batch);
        batch.results.push({ index, result, success: true });

        // Update progress
        batch.current++;
        saveBatch(batch);

        // Trigger progress hook
        await hooksInstance?.trigger('batch:progress', {
          batch: batch as unknown as Record<string, unknown>,
          progress: getProgress(batchId) as unknown as Record<string, unknown>,
        });

      } catch (error) {
        // Record error
        batch.errors.push({
          index,
          operation,
          error: (error as Error).message,
          timestamp: new Date().toISOString(),
        });

        batch.current++;
        saveBatch(batch);

        // Trigger error hook
        await hooksInstance?.trigger('batch:error', {
          batch: batch as unknown as Record<string, unknown>,
          error: error as Record<string, unknown>,
          operation: operation as unknown as Record<string, unknown>,
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
      await hooksInstance?.trigger('batch:finish', { batch: batch as unknown as Record<string, unknown> });

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
async function executeOperation(operation: BatchOperation, batch: Batch): Promise<unknown> {
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
export async function processAll(batchId: string): Promise<Batch> {
  return await processBatch(batchId, 0);
}

/**
 * Get batch status
 * @param {string} batchId - Batch ID
 * @returns {object|null} - Batch or null
 */
export function getBatchStatus(batchId: string): Batch | null {
  return batches.get(batchId) || null;
}

/**
 * Cancel a batch
 * @param {string} batchId - Batch ID
 * @returns {boolean} - Success
 */
export function cancelBatch(batchId: string): boolean {
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
  hooksInstance?.trigger('batch:cancelled', { batch: batch as unknown as Record<string, unknown> });

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
export function registerCallback(name: string, fn: (...args: unknown[]) => Promise<unknown>): void {
  callbacks.set(name, fn);
}

/**
 * Get batch progress
 * @param {string} batchId - Batch ID
 * @returns {object} - Progress data
 */
export function getProgress(batchId: string): BatchProgress | null {
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
export function onFinish(batchId: string, callback: (batch: Batch) => void): void {
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
  hooksInstance?.register(hookName, async (context) => {
    const ctxBatch = context['batch'] as Batch | undefined;
    if (ctxBatch && ctxBatch.id === batchId) {
      callback(ctxBatch);
    }
  }, 10, 'batch:onFinish');
}

/**
 * List all batches
 * @param {object} filter - Filter options
 * @returns {Array} - Array of batches
 */
export function listBatches(filter: { status?: BatchStatus; userId?: string } = {}): Batch[] {
  const result: Batch[] = [];

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
  result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return result;
}

/**
 * Get batch statistics
 * @returns {object} - Statistics
 */
export function getStats(): BatchStats {
  const stats: BatchStats = {
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
      const completedAt = new Date(batch.completed ?? 0);
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
export function pauseBatch(batchId: string): boolean {
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
export async function resumeBatch(batchId: string, limit = 0): Promise<Batch> {
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
export function registerBuiltinCallbacks(context: { services: Map<string, { update: (type: unknown, id: unknown, data: unknown) => Promise<unknown>; remove: (type: unknown, id: unknown) => Promise<unknown> }> }): void {
  const content = context.services.get('content')!;

  // content:publish
  registerCallback('content:publish', async (...args: unknown[]) => {
    const [contentType, id] = args;
    return await content.update(contentType, id, { status: 'published' });
  });

  // content:unpublish
  registerCallback('content:unpublish', async (...args: unknown[]) => {
    const [contentType, id] = args;
    return await content.update(contentType, id, { status: 'draft' });
  });

  // content:archive
  registerCallback('content:archive', async (...args: unknown[]) => {
    const [contentType, id] = args;
    return await content.update(contentType, id, { status: 'archived' });
  });

  // content:delete
  registerCallback('content:delete', async (...args: unknown[]) => {
    const [contentType, id] = args;
    return await content.remove(contentType, id);
  });

  // content:update
  registerCallback('content:update', async (...args: unknown[]) => {
    const [contentType, id, data] = args;
    return await content.update(contentType, id, data);
  });

  console.log('[batch] Built-in callbacks registered');
}
