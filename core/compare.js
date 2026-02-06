/**
 * compare.js - Content Comparison and Merge Tools
 *
 * Provides side-by-side comparison of content items and revisions,
 * with support for merging changes and resolving conflicts.
 *
 * USE CASES:
 * ==========
 * - Compare current content vs historical revision
 * - Compare two different content items of same type
 * - Merge changes after concurrent edits
 * - Resolve import conflicts
 *
 * DIFF ALGORITHM:
 * ===============
 * Field-level comparison with status:
 * - unchanged: same value in both
 * - modified: different values
 * - added: only in B (right side)
 * - removed: only in A (left side)
 *
 * For text fields, supports line-level and word-level diffs.
 *
 * MERGE STRATEGIES:
 * =================
 * - ours: prefer left/original changes
 * - theirs: prefer right/incoming changes
 * - manual: require explicit resolution for each conflict
 * - auto: auto-merge non-conflicting, flag true conflicts
 */

// ===========================================
// Module State
// ===========================================

let contentService = null;

/**
 * Initialize compare module
 * @param {Object} content - Content service reference
 */
export function init(content) {
  contentService = content;
  console.log('[compare] Compare module initialized');
}

// ===========================================
// Core Comparison Functions
// ===========================================

/**
 * Compare two content items field by field
 *
 * @param {Object} itemA - First content item (left side)
 * @param {Object} itemB - Second content item (right side)
 * @param {Object} [options] - Comparison options
 * @param {string[]} [options.ignoreFields] - Fields to ignore
 * @param {boolean} [options.textDiff] - Enable text diff for strings
 * @returns {Object} Comparison result
 *
 * @example
 * const result = compare(articleA, articleB);
 * console.log(result.fields.title.status); // 'modified'
 */
export function compare(itemA, itemB, options = {}) {
  const {
    ignoreFields = ['id', 'created', 'updated', 'type'],
    textDiff = true,
  } = options;

  const result = {
    equal: true,
    fields: {},
    summary: {
      unchanged: 0,
      modified: 0,
      added: 0,
      removed: 0,
    },
  };

  // Get all unique field names from both items
  const allFields = new Set([
    ...Object.keys(itemA || {}),
    ...Object.keys(itemB || {}),
  ]);

  for (const field of allFields) {
    // Skip ignored fields
    if (ignoreFields.includes(field)) continue;

    const hasA = itemA && field in itemA;
    const hasB = itemB && field in itemB;
    const valueA = itemA?.[field];
    const valueB = itemB?.[field];

    let fieldResult;

    if (!hasA && hasB) {
      // Field only in B (added)
      fieldResult = { status: 'added', b: valueB };
      result.summary.added++;
      result.equal = false;
    } else if (hasA && !hasB) {
      // Field only in A (removed)
      fieldResult = { status: 'removed', a: valueA };
      result.summary.removed++;
      result.equal = false;
    } else if (deepEqual(valueA, valueB)) {
      // Same value
      fieldResult = { status: 'unchanged', value: valueA };
      result.summary.unchanged++;
    } else {
      // Different values
      fieldResult = { status: 'modified', a: valueA, b: valueB };
      result.summary.modified++;
      result.equal = false;

      // Add text diff for string fields
      if (textDiff && typeof valueA === 'string' && typeof valueB === 'string') {
        fieldResult.diff = diffText(valueA, valueB);
      }
    }

    result.fields[field] = fieldResult;
  }

  return result;
}

/**
 * Compare two revisions of the same content item
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {string} tsA - Timestamp of first revision
 * @param {string} tsB - Timestamp of second revision (or 'current')
 * @returns {Object} Comparison result with revision metadata
 */
export function compareRevisions(type, id, tsA, tsB) {
  if (!contentService) {
    throw new Error('Compare module not initialized');
  }

  // Get the revisions
  let itemA, itemB;
  let metaA, metaB;

  if (tsA === 'current') {
    itemA = contentService.read(type, id);
    metaA = { timestamp: 'current', label: 'Current Version' };
  } else {
    itemA = contentService.getRevision(type, id, tsA);
    metaA = { timestamp: tsA, label: `Revision ${tsA}` };
  }

  if (tsB === 'current') {
    itemB = contentService.read(type, id);
    metaB = { timestamp: 'current', label: 'Current Version' };
  } else {
    itemB = contentService.getRevision(type, id, tsB);
    metaB = { timestamp: tsB, label: `Revision ${tsB}` };
  }

  if (!itemA) {
    throw new Error(`Revision not found: ${type}/${id} @ ${tsA}`);
  }
  if (!itemB) {
    throw new Error(`Revision not found: ${type}/${id} @ ${tsB}`);
  }

  const comparison = compare(itemA, itemB);

  return {
    ...comparison,
    type,
    id,
    revisionA: metaA,
    revisionB: metaB,
  };
}

/**
 * Compare current content with a specific revision
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {string} timestamp - Revision timestamp
 * @returns {Object} Comparison result
 */
export function compareWithRevision(type, id, timestamp) {
  return compareRevisions(type, id, timestamp, 'current');
}

// ===========================================
// Text Diff Functions
// ===========================================

/**
 * Compute line-by-line diff for text content
 *
 * @param {string} textA - Original text
 * @param {string} textB - Modified text
 * @param {Object} [options] - Diff options
 * @param {boolean} [options.wordLevel] - Enable word-level diff
 * @returns {Object} Diff result with lines and changes
 */
export function diffText(textA, textB, options = {}) {
  const { wordLevel = false } = options;

  const linesA = (textA || '').split('\n');
  const linesB = (textB || '').split('\n');

  // Simple line-by-line diff using LCS algorithm
  const lcs = computeLCS(linesA, linesB);
  const changes = [];

  let iA = 0, iB = 0;

  for (const match of lcs) {
    // Lines removed from A (before this match)
    while (iA < match.indexA) {
      changes.push({ type: 'removed', line: linesA[iA], lineNum: iA + 1 });
      iA++;
    }
    // Lines added in B (before this match)
    while (iB < match.indexB) {
      changes.push({ type: 'added', line: linesB[iB], lineNum: iB + 1 });
      iB++;
    }
    // Unchanged line
    changes.push({ type: 'unchanged', line: linesA[iA], lineNum: iA + 1 });
    iA++;
    iB++;
  }

  // Remaining lines after last match
  while (iA < linesA.length) {
    changes.push({ type: 'removed', line: linesA[iA], lineNum: iA + 1 });
    iA++;
  }
  while (iB < linesB.length) {
    changes.push({ type: 'added', line: linesB[iB], lineNum: iB + 1 });
    iB++;
  }

  return {
    linesA: linesA.length,
    linesB: linesB.length,
    changes,
    stats: {
      added: changes.filter(c => c.type === 'added').length,
      removed: changes.filter(c => c.type === 'removed').length,
      unchanged: changes.filter(c => c.type === 'unchanged').length,
    },
  };
}

/**
 * Compute diff for a single field value
 *
 * @param {*} valueA - Original value
 * @param {*} valueB - Modified value
 * @returns {Object} Diff result
 */
export function diff(valueA, valueB) {
  if (deepEqual(valueA, valueB)) {
    return { status: 'unchanged', value: valueA };
  }

  const result = { status: 'modified', a: valueA, b: valueB };

  // Add text diff for strings
  if (typeof valueA === 'string' && typeof valueB === 'string') {
    result.diff = diffText(valueA, valueB);
  }

  // Add array diff for arrays
  if (Array.isArray(valueA) && Array.isArray(valueB)) {
    result.diff = diffArrays(valueA, valueB);
  }

  return result;
}

/**
 * Compute diff for arrays
 *
 * @param {Array} arrA - Original array
 * @param {Array} arrB - Modified array
 * @returns {Object} Array diff result
 */
function diffArrays(arrA, arrB) {
  const added = arrB.filter(item => !arrA.some(a => deepEqual(a, item)));
  const removed = arrA.filter(item => !arrB.some(b => deepEqual(b, item)));
  const kept = arrA.filter(item => arrB.some(b => deepEqual(b, item)));

  return {
    added,
    removed,
    kept,
    stats: {
      added: added.length,
      removed: removed.length,
      kept: kept.length,
    },
  };
}

// ===========================================
// Merge Functions
// ===========================================

/**
 * Three-way merge of content items
 *
 * @param {Object} base - Common ancestor (original)
 * @param {Object} ours - Our changes (left)
 * @param {Object} theirs - Their changes (right)
 * @param {string} [strategy='manual'] - Merge strategy
 * @returns {Object} Merge result with conflicts
 *
 * Strategies:
 * - 'ours': prefer our changes on conflict
 * - 'theirs': prefer their changes on conflict
 * - 'manual': mark conflicts for manual resolution
 * - 'auto': auto-merge non-conflicts, mark true conflicts
 */
export function merge(base, ours, theirs, strategy = 'manual') {
  const result = {
    merged: {},
    conflicts: [],
    applied: [],
    strategy,
  };

  // Get all fields
  const allFields = new Set([
    ...Object.keys(base || {}),
    ...Object.keys(ours || {}),
    ...Object.keys(theirs || {}),
  ]);

  const ignoreFields = ['id', 'created', 'updated', 'type'];

  for (const field of allFields) {
    if (ignoreFields.includes(field)) {
      // Keep base value for system fields
      result.merged[field] = ours?.[field] ?? base?.[field];
      continue;
    }

    const baseVal = base?.[field];
    const ourVal = ours?.[field];
    const theirVal = theirs?.[field];

    const baseChanged = !deepEqual(baseVal, ourVal);
    const theirChanged = !deepEqual(baseVal, theirVal);
    const bothSame = deepEqual(ourVal, theirVal);

    if (!baseChanged && !theirChanged) {
      // No changes
      result.merged[field] = baseVal;
    } else if (baseChanged && !theirChanged) {
      // Only we changed
      result.merged[field] = ourVal;
      result.applied.push({ field, source: 'ours', value: ourVal });
    } else if (!baseChanged && theirChanged) {
      // Only they changed
      result.merged[field] = theirVal;
      result.applied.push({ field, source: 'theirs', value: theirVal });
    } else if (bothSame) {
      // Both changed to same value
      result.merged[field] = ourVal;
      result.applied.push({ field, source: 'both', value: ourVal });
    } else {
      // Conflict: both changed to different values
      const conflict = {
        field,
        base: baseVal,
        ours: ourVal,
        theirs: theirVal,
      };

      switch (strategy) {
        case 'ours':
          result.merged[field] = ourVal;
          result.applied.push({ field, source: 'ours (conflict)', value: ourVal });
          break;
        case 'theirs':
          result.merged[field] = theirVal;
          result.applied.push({ field, source: 'theirs (conflict)', value: theirVal });
          break;
        case 'auto':
        case 'manual':
        default:
          result.conflicts.push(conflict);
          // Don't set merged value for conflicts in manual mode
          break;
      }
    }
  }

  result.hasConflicts = result.conflicts.length > 0;

  return result;
}

/**
 * Get conflicts between base and two changed versions
 *
 * @param {Object} base - Common ancestor
 * @param {Object} ours - Our changes
 * @param {Object} theirs - Their changes
 * @returns {Object[]} Array of conflict objects
 */
export function getConflicts(base, ours, theirs) {
  const result = merge(base, ours, theirs, 'manual');
  return result.conflicts;
}

/**
 * Apply a merge result to content
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {Object} mergeResult - Result from merge()
 * @param {Object} [resolutions] - Manual conflict resolutions
 * @returns {Promise<Object>} Updated content item
 */
export async function applyMerge(type, id, mergeResult, resolutions = {}) {
  if (!contentService) {
    throw new Error('Compare module not initialized');
  }

  // Build final merged data
  const data = { ...mergeResult.merged };

  // Apply manual resolutions for conflicts
  for (const conflict of mergeResult.conflicts) {
    const resolution = resolutions[conflict.field];
    if (resolution === 'ours') {
      data[conflict.field] = conflict.ours;
    } else if (resolution === 'theirs') {
      data[conflict.field] = conflict.theirs;
    } else if (resolution === 'base') {
      data[conflict.field] = conflict.base;
    } else if (resolution !== undefined) {
      // Custom value provided
      data[conflict.field] = resolution;
    } else {
      throw new Error(`Unresolved conflict for field: ${conflict.field}`);
    }
  }

  // Update the content
  const updated = await contentService.update(type, id, data);
  return updated;
}

/**
 * Simple two-way merge (no base version)
 * Copies fields from source to target where target field is missing
 *
 * @param {string} type - Content type
 * @param {string} targetId - Target content ID
 * @param {string} sourceId - Source content ID
 * @param {Object} [options] - Merge options
 * @param {string} [options.strategy='theirs'] - Conflict strategy
 * @param {string[]} [options.fields] - Specific fields to merge
 * @returns {Promise<Object>} Merge result
 */
export async function mergeFrom(type, targetId, sourceId, options = {}) {
  if (!contentService) {
    throw new Error('Compare module not initialized');
  }

  const { strategy = 'theirs', fields = null } = options;

  const target = contentService.read(type, targetId);
  const source = contentService.read(type, sourceId);

  if (!target) throw new Error(`Target not found: ${type}/${targetId}`);
  if (!source) throw new Error(`Source not found: ${type}/${sourceId}`);

  // Use target as base for simple two-way merge
  const result = merge(target, target, source, strategy);

  // Filter to specific fields if requested
  if (fields && fields.length > 0) {
    for (const key of Object.keys(result.merged)) {
      if (!fields.includes(key) && !['id', 'created', 'updated', 'type'].includes(key)) {
        result.merged[key] = target[key];
      }
    }
    result.applied = result.applied.filter(a => fields.includes(a.field));
    result.conflicts = result.conflicts.filter(c => fields.includes(c.field));
  }

  return result;
}

// ===========================================
// Utility Functions
// ===========================================

/**
 * Deep equality check for values
 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, i) => deepEqual(val, b[i]));
  }

  if (typeof a === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(key => deepEqual(a[key], b[key]));
  }

  return false;
}

/**
 * Compute Longest Common Subsequence for line diff
 * Returns array of matching line positions
 */
function computeLCS(arrA, arrB) {
  const m = arrA.length;
  const n = arrB.length;

  // Build LCS length table
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (arrA[i - 1] === arrB[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find LCS
  const matches = [];
  let i = m, j = n;

  while (i > 0 && j > 0) {
    if (arrA[i - 1] === arrB[j - 1]) {
      matches.unshift({ indexA: i - 1, indexB: j - 1, line: arrA[i - 1] });
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return matches;
}

/**
 * Format comparison result for CLI display
 *
 * @param {Object} result - Comparison result
 * @param {Object} [options] - Display options
 * @returns {string} Formatted output
 */
export function formatComparison(result, options = {}) {
  const { showUnchanged = false, maxLength = 50 } = options;
  const lines = [];

  for (const [field, data] of Object.entries(result.fields)) {
    if (data.status === 'unchanged' && !showUnchanged) continue;

    lines.push(`  ${field}:`);

    switch (data.status) {
      case 'unchanged':
        const val = truncate(String(data.value), maxLength);
        lines.push(`    (unchanged: ${val})`);
        break;
      case 'modified':
        lines.push(`    - ${truncate(String(data.a), maxLength)}`);
        lines.push(`    + ${truncate(String(data.b), maxLength)}`);
        break;
      case 'added':
        lines.push(`    + ${truncate(String(data.b), maxLength)}`);
        break;
      case 'removed':
        lines.push(`    - ${truncate(String(data.a), maxLength)}`);
        break;
    }
    lines.push('');
  }

  lines.push(`Summary: ${result.summary.modified} modified, ${result.summary.unchanged} unchanged, ${result.summary.added} added, ${result.summary.removed} removed`);

  return lines.join('\n');
}

/**
 * Truncate string for display
 */
function truncate(str, maxLength) {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

// ===========================================
// Default Export
// ===========================================

export default {
  init,
  compare,
  compareRevisions,
  compareWithRevision,
  diff,
  diffText,
  merge,
  getConflicts,
  applyMerge,
  mergeFrom,
  formatComparison,
};
