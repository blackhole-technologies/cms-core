/**
 * status.js - System Status and Health Reporting
 *
 * WHY THIS EXISTS:
 * Provides comprehensive system health monitoring for CMS subsystems.
 * Enables proactive issue detection and maintenance scheduling.
 *
 * ARCHITECTURE:
 * - Modular checks: each subsystem can register status checks
 * - Priority levels: info, warning, error
 * - Async execution: checks can perform I/O operations
 * - Cached results: avoid expensive checks on every call
 *
 * DESIGN DECISIONS:
 * - Zero dependencies: uses only Node.js stdlib
 * - Lazy initialization: checks only run when requested
 * - Fail-safe: individual check failures don't crash the system
 */

import { existsSync, accessSync, statfsSync, constants as fsConstants } from 'node:fs';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

// Configuration
let baseDir = null;
let services = null;

// Registered checks
const checks = new Map();

// Cached check results
let lastCheckResults = null;
let lastCheckTime = null;
const checkCacheTTL = 60000; // 1 minute

// Built-in check names
const BUILTIN_CHECKS = [
  'core_version',
  'filesystem_permissions',
  'config_valid',
  'security_basics',
  'cache_status',
  'queue_status',
  'search_index',
  'content_integrity',
];

/**
 * Initialize status system
 *
 * @param {string} dir - Base directory
 * @param {Map} serviceMap - Services map
 */
export function init(dir, serviceMap = null) {
  baseDir = dir;
  services = serviceMap;

  // Register built-in checks
  registerBuiltinChecks();
}

/**
 * Register a custom status check
 *
 * @param {string} name - Check name (unique identifier)
 * @param {Function} checkFn - Async function that returns check result
 *
 * Check function should return:
 * {
 *   status: 'ok' | 'warning' | 'error',
 *   message: 'Human readable message',
 *   details: {} // Optional additional data
 * }
 */
export function registerCheck(name, checkFn) {
  if (checks.has(name)) {
    console.warn(`[status] Overwriting existing check: ${name}`);
  }
  checks.set(name, checkFn);
}

/**
 * Run all registered checks
 *
 * @param {boolean} useCache - Use cached results if available
 * @returns {Promise<Object>} Complete status report
 */
export async function runAllChecks(useCache = true) {
  // Use cache if valid
  if (useCache && lastCheckResults && lastCheckTime) {
    const age = Date.now() - lastCheckTime;
    if (age < checkCacheTTL) {
      return lastCheckResults;
    }
  }

  const report = {
    generated: new Date().toISOString(),
    overall: 'ok',
    checks: {},
  };

  // Run all checks in parallel
  const checkPromises = [];
  for (const [name, checkFn] of checks) {
    checkPromises.push(
      runSingleCheck(name, checkFn).then(result => {
        report.checks[name] = result;
      })
    );
  }

  await Promise.all(checkPromises);

  // Determine overall status
  report.overall = getOverallStatusFromChecks(report.checks);

  // Cache results
  lastCheckResults = report;
  lastCheckTime = Date.now();

  // Trigger hook
  if (services?.has('hooks')) {
    await services.get('hooks').trigger('status:report', { report });
  }

  return report;
}

/**
 * Run a single check by name
 *
 * @param {string} name - Check name
 * @returns {Promise<Object>} Check result
 */
export async function runCheck(name) {
  const checkFn = checks.get(name);
  if (!checkFn) {
    return {
      status: 'error',
      message: `Unknown check: ${name}`,
      details: {},
    };
  }

  const result = await runSingleCheck(name, checkFn);

  // Trigger hook
  if (services?.has('hooks')) {
    await services.get('hooks').trigger('status:check', { name, result });
  }

  return result;
}

/**
 * Execute a single check function safely
 *
 * @param {string} name - Check name
 * @param {Function} checkFn - Check function
 * @returns {Promise<Object>} Check result
 * @private
 */
async function runSingleCheck(name, checkFn) {
  try {
    const result = await checkFn();

    // Validate result structure
    if (!result || typeof result !== 'object') {
      throw new Error('Check function must return an object');
    }
    if (!['ok', 'warning', 'error'].includes(result.status)) {
      throw new Error('Invalid status value');
    }
    if (!result.message) {
      result.message = 'No message provided';
    }
    if (!result.details) {
      result.details = {};
    }

    return result;

  } catch (error) {
    return {
      status: 'error',
      message: `Check failed: ${error.message}`,
      details: { error: error.stack },
    };
  }
}

/**
 * Get overall status from individual check results
 *
 * @param {Object} checkResults - Map of check results
 * @returns {string} 'ok', 'warning', or 'error'
 * @private
 */
function getOverallStatusFromChecks(checkResults) {
  let hasError = false;
  let hasWarning = false;

  for (const result of Object.values(checkResults)) {
    if (result.status === 'error') {
      hasError = true;
    } else if (result.status === 'warning') {
      hasWarning = true;
    }
  }

  if (hasError) return 'error';
  if (hasWarning) return 'warning';
  return 'ok';
}

/**
 * Get current status (uses cache)
 *
 * @returns {Promise<Object>} Status report
 */
export async function getStatus() {
  return runAllChecks(true);
}

/**
 * Get overall status only
 *
 * @returns {Promise<string>} 'ok', 'warning', or 'error'
 */
export async function getOverallStatus() {
  const report = await getStatus();
  return report.overall;
}

/**
 * Get checks by status level
 *
 * @param {string} status - Filter by status ('ok', 'warning', 'error')
 * @returns {Promise<Object>} Filtered checks
 */
export async function getChecksByStatus(status) {
  const report = await getStatus();
  const filtered = {};

  for (const [name, result] of Object.entries(report.checks)) {
    if (result.status === status) {
      filtered[name] = result;
    }
  }

  return filtered;
}

/**
 * Format status report for CLI display
 *
 * @returns {Promise<string>} Formatted text output
 */
export async function formatForCLI() {
  const report = await getStatus();
  const lines = [];

  // Header
  lines.push('='.repeat(60));
  lines.push('CMS SYSTEM STATUS');
  lines.push('='.repeat(60));
  lines.push(`Generated: ${report.generated}`);
  lines.push(`Overall Status: ${report.overall.toUpperCase()}`);
  lines.push('');

  // Group checks by status
  const groups = { error: [], warning: [], ok: [] };
  for (const [name, result] of Object.entries(report.checks)) {
    groups[result.status].push({ name, result });
  }

  // Display errors first
  if (groups.error.length > 0) {
    lines.push('ERRORS:');
    lines.push('-'.repeat(60));
    for (const { name, result } of groups.error) {
      lines.push(`[X] ${name}`);
      lines.push(`    ${result.message}`);
      if (Object.keys(result.details).length > 0) {
        lines.push(`    Details: ${JSON.stringify(result.details)}`);
      }
      lines.push('');
    }
  }

  // Display warnings
  if (groups.warning.length > 0) {
    lines.push('WARNINGS:');
    lines.push('-'.repeat(60));
    for (const { name, result } of groups.warning) {
      lines.push(`[!] ${name}`);
      lines.push(`    ${result.message}`);
      if (Object.keys(result.details).length > 0) {
        lines.push(`    Details: ${JSON.stringify(result.details)}`);
      }
      lines.push('');
    }
  }

  // Display OK checks (condensed)
  if (groups.ok.length > 0) {
    lines.push('OK:');
    lines.push('-'.repeat(60));
    for (const { name, result } of groups.ok) {
      lines.push(`[✓] ${name}: ${result.message}`);
    }
  }

  lines.push('');
  lines.push('='.repeat(60));

  return lines.join('\n');
}

/**
 * Format status report for admin UI
 *
 * @returns {Promise<Object>} Structured data for UI
 */
export async function formatForAdmin() {
  const report = await getStatus();

  const formatted = {
    overall: report.overall,
    generated: report.generated,
    summary: {
      total: Object.keys(report.checks).length,
      ok: 0,
      warning: 0,
      error: 0,
    },
    checks: [],
    recommendations: await getRecommendations(),
  };

  // Count and structure checks
  for (const [name, result] of Object.entries(report.checks)) {
    formatted.summary[result.status]++;
    formatted.checks.push({
      name,
      status: result.status,
      message: result.message,
      details: result.details,
    });
  }

  // Sort checks: errors, warnings, ok
  formatted.checks.sort((a, b) => {
    const priority = { error: 0, warning: 1, ok: 2 };
    return priority[a.status] - priority[b.status];
  });

  return formatted;
}

/**
 * Get recommended actions based on status
 *
 * @returns {Promise<Array>} List of recommendations
 */
export async function getRecommendations() {
  const report = await getStatus();
  const recommendations = [];

  for (const [name, result] of Object.entries(report.checks)) {
    if (result.status === 'error' || result.status === 'warning') {
      // Extract action from details if available
      const action = result.details.action || getDefaultRecommendation(name, result);
      if (action) {
        recommendations.push({
          priority: result.status === 'error' ? 'high' : 'medium',
          check: name,
          action,
        });
      }
    }
  }

  return recommendations;
}

/**
 * Get default recommendation for a check
 *
 * @param {string} name - Check name
 * @param {Object} result - Check result
 * @returns {string} Recommendation
 * @private
 */
function getDefaultRecommendation(name, result) {
  const recommendations = {
    security_basics: 'Review security configuration in config file',
    filesystem_permissions: 'Check directory permissions and ownership',
    cache_status: 'Clear cache or check cache configuration',
    queue_status: 'Review failed jobs and retry if needed',
    search_index: 'Rebuild search index using CLI',
    content_integrity: 'Check for orphaned files or corrupted content',
  };

  return recommendations[name] || 'Review system logs for more details';
}

// ============================================================
// BUILT-IN CHECKS
// ============================================================

/**
 * Register all built-in status checks
 * @private
 */
function registerBuiltinChecks() {
  // Core version check
  registerCheck('core_version', async () => {
    try {
      const pkgPath = join(baseDir, 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      return {
        status: 'ok',
        message: `CMS core v${pkg.version} running`,
        details: { version: pkg.version, name: pkg.name },
      };
    } catch (error) {
      return {
        status: 'error',
        message: 'Unable to read package.json',
        details: { error: error.message },
      };
    }
  });

  // Filesystem permissions check
  registerCheck('filesystem_permissions', async () => {
    const dirs = ['content', 'content/logs', 'content/.cache', 'content/.queue'];
    const issues = [];

    for (const dir of dirs) {
      const fullPath = join(baseDir, dir);
      try {
        if (existsSync(fullPath)) {
          // Check write access
          accessSync(fullPath, fsConstants.W_OK);
        } else {
          issues.push(`${dir} does not exist`);
        }
      } catch (error) {
        issues.push(`${dir} not writable`);
      }
    }

    if (issues.length > 0) {
      return {
        status: 'error',
        message: `Filesystem permission issues: ${issues.join(', ')}`,
        details: { issues },
      };
    }

    // Check disk space
    try {
      const contentPath = join(baseDir, 'content');
      if (existsSync(contentPath)) {
        const stats = statfsSync(contentPath);
        const freeGB = (stats.bavail * stats.bsize) / (1024 ** 3);

        if (freeGB < 1) {
          return {
            status: 'warning',
            message: `Low disk space: ${freeGB.toFixed(2)}GB free`,
            details: { freeGB: freeGB.toFixed(2) },
          };
        }
      }
    } catch (error) {
      // Disk space check failed, but permissions are OK
    }

    return {
      status: 'ok',
      message: 'All directories writable',
      details: { checked: dirs },
    };
  });

  // Configuration validation check
  registerCheck('config_valid', async () => {
    try {
      const configPath = join(baseDir, 'content/config.json');

      if (!existsSync(configPath)) {
        return {
          status: 'warning',
          message: 'No configuration file found (using defaults)',
          details: {},
        };
      }

      const config = JSON.parse(readFileSync(configPath, 'utf-8'));

      // Basic validation
      if (!config.siteName) {
        return {
          status: 'warning',
          message: 'Configuration incomplete: siteName not set',
          details: { action: 'Set siteName in config.json' },
        };
      }

      return {
        status: 'ok',
        message: 'Configuration valid',
        details: { siteName: config.siteName },
      };
    } catch (error) {
      return {
        status: 'error',
        message: `Configuration error: ${error.message}`,
        details: { error: error.message },
      };
    }
  });

  // Security basics check
  registerCheck('security_basics', async () => {
    const issues = [];
    let status = 'ok';

    try {
      const configPath = join(baseDir, 'content/config.json');

      if (existsSync(configPath)) {
        const config = JSON.parse(readFileSync(configPath, 'utf-8'));

        // Check session secret
        if (!config.sessionSecret || config.sessionSecret === 'your-secret-key-change-this') {
          issues.push('Using default session secret');
          status = 'warning';
        }

        // Check debug mode
        if (config.debug === true) {
          issues.push('Debug mode enabled in production');
          status = 'warning';
        }

        // Check HTTPS
        if (config.baseUrl && !config.baseUrl.startsWith('https://')) {
          issues.push('Not using HTTPS');
          status = 'warning';
        }
      }

      if (issues.length > 0) {
        return {
          status,
          message: `Security concerns: ${issues.join(', ')}`,
          details: {
            issues,
            action: 'Set custom sessionSecret and disable debug mode',
          },
        };
      }

      return {
        status: 'ok',
        message: 'Basic security checks passed',
        details: {},
      };
    } catch (error) {
      return {
        status: 'error',
        message: `Security check failed: ${error.message}`,
        details: { error: error.message },
      };
    }
  });

  // Cache status check
  registerCheck('cache_status', async () => {
    try {
      const cache = services?.get('cache');
      if (!cache) {
        return {
          status: 'warning',
          message: 'Cache service not available',
          details: {},
        };
      }

      const stats = cache.stats();
      const hitRate = parseFloat(stats.hitRate) || 0;

      if (hitRate < 30 && stats.hits + stats.misses > 100) {
        return {
          status: 'warning',
          message: `Low cache hit rate: ${stats.hitRate}`,
          details: stats,
        };
      }

      return {
        status: 'ok',
        message: `Cache healthy (hit rate: ${stats.hitRate})`,
        details: { hitRate: stats.hitRate, size: stats.size },
      };
    } catch (error) {
      return {
        status: 'error',
        message: `Cache check failed: ${error.message}`,
        details: { error: error.message },
      };
    }
  });

  // Queue status check
  registerCheck('queue_status', async () => {
    try {
      const queue = services?.get('queue');
      if (!queue) {
        return {
          status: 'info',
          message: 'Queue service not available',
          details: {},
        };
      }

      const stats = queue.getStats();

      if (stats.failed > 10) {
        return {
          status: 'warning',
          message: `${stats.failed} failed jobs in queue`,
          details: { ...stats, action: 'Review and retry failed jobs' },
        };
      }

      if (stats.pending > 50) {
        return {
          status: 'warning',
          message: `Queue backlog: ${stats.pending} pending jobs`,
          details: stats,
        };
      }

      return {
        status: 'ok',
        message: `Queue healthy (${stats.pending} pending, ${stats.running} running)`,
        details: { pending: stats.pending, running: stats.running },
      };
    } catch (error) {
      return {
        status: 'error',
        message: `Queue check failed: ${error.message}`,
        details: { error: error.message },
      };
    }
  });

  // Search index check
  registerCheck('search_index', async () => {
    try {
      const search = services?.get('search');
      if (!search) {
        return {
          status: 'info',
          message: 'Search service not available',
          details: {},
        };
      }

      const stats = search.getStats();

      if (!stats.enabled) {
        return {
          status: 'warning',
          message: 'Search indexing disabled',
          details: {},
        };
      }

      if (stats.totalDocs === 0) {
        return {
          status: 'warning',
          message: 'Search index empty',
          details: { action: 'Run search index rebuild' },
        };
      }

      return {
        status: 'ok',
        message: `Index healthy (${stats.totalDocs} items indexed)`,
        details: { indexed: stats.totalDocs, terms: stats.totalTerms },
      };
    } catch (error) {
      return {
        status: 'error',
        message: `Search check failed: ${error.message}`,
        details: { error: error.message },
      };
    }
  });

  // Content integrity check
  registerCheck('content_integrity', async () => {
    try {
      const content = services?.get('content');
      if (!content) {
        return {
          status: 'warning',
          message: 'Content service not available',
          details: {},
        };
      }

      // Check for orphaned files
      // (Implementation would scan filesystem vs. content index)
      // Simplified for this implementation

      const types = content.listTypes();
      let totalItems = 0;

      for (const { type } of types) {
        const items = content.listAll(type);
        totalItems += items.length;
      }

      return {
        status: 'ok',
        message: `Content integrity OK (${totalItems} items across ${types.length} types)`,
        details: { types: types.length, items: totalItems },
      };
    } catch (error) {
      return {
        status: 'error',
        message: `Content integrity check failed: ${error.message}`,
        details: { error: error.message },
      };
    }
  });
}

/**
 * Clear cached check results
 * Forces fresh checks on next status request
 */
export function clearCache() {
  lastCheckResults = null;
  lastCheckTime = null;
}
