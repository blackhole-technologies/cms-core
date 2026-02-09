/**
 * Deprecation Logger
 * ==================
 *
 * Tracks and reports usage of deprecated/legacy APIs during migration to new patterns.
 * Warns once per deprecated API to avoid spam, provides migration guidance,
 * and can suppress specific warnings during controlled migrations.
 *
 * Used by the Bridge layer to monitor usage of legacy core/hooks.js and
 * core/services.js APIs while migrating to HookManager and Container.
 *
 * @example Basic usage
 * ```javascript
 * const logger = new DeprecationLogger();
 * logger.log('hooks.register', 'Use hookManager.on()');
 * // console.warn: DEPRECATED: hooks.register is deprecated. Use hookManager.on()
 * logger.log('hooks.register', 'Use hookManager.on()');
 * // (silent - already warned once)
 * ```
 *
 * @example Suppressing warnings
 * ```javascript
 * logger.suppress('hooks.register');
 * logger.log('hooks.register', 'Use hookManager.on()');
 * // (silent - suppressed)
 * ```
 *
 * @example Getting migration report
 * ```javascript
 * const report = logger.report();
 * // [
 * //   {api: 'hooks.register', alternative: 'Use hookManager.on()', count: 3, stack: '...'},
 * //   {api: 'services.get', alternative: 'Use container.get()', count: 5, stack: '...'}
 * // ]
 * ```
 */

// WHY SYMBOL: Private fields that can't be accidentally accessed or collided with
const _logged = Symbol('logged');
const _suppressed = Symbol('suppressed');

export class DeprecationLogger {
  constructor() {
    // Track which APIs have been logged (first call only)
    // WHY MAP: Stores {api → {alternative, count, stack}}
    this[_logged] = new Map();

    // Track which APIs are suppressed (no warnings)
    // WHY SET: Fast O(1) lookup
    this[_suppressed] = new Set();
  }

  /**
   * Log a deprecation warning for a legacy API.
   * Warns on first call only (per API) to avoid spam.
   * Captures stack trace for debugging.
   *
   * @param {string} apiName - Name of the deprecated API (e.g., 'hooks.register')
   * @param {string} alternative - Migration guidance (e.g., 'Use hookManager.on()')
   *
   * @example
   * ```javascript
   * logger.log('hooks.register', 'Use hookManager.on()');
   * ```
   */
  log(apiName, alternative) {
    // Skip if this API is suppressed
    if (this[_suppressed].has(apiName)) {
      return;
    }

    // Check if we've already logged this API
    if (this[_logged].has(apiName)) {
      // Increment count but don't warn again
      const entry = this[_logged].get(apiName);
      entry.count++;
      return;
    }

    // First call - capture stack trace
    // WHY ERROR: Easiest way to capture stack trace in Node.js
    const stack = new Error().stack;

    // Store the entry
    this[_logged].set(apiName, {
      alternative,
      count: 1,
      stack,
    });

    // Warn to console
    console.warn(`DEPRECATED: ${apiName} is deprecated. ${alternative}`);
  }

  /**
   * Suppress warnings for a specific API.
   * Useful during controlled migrations where you know the usage is temporary.
   *
   * @param {string} apiName - Name of the API to suppress warnings for
   *
   * @example
   * ```javascript
   * logger.suppress('hooks.register');
   * logger.log('hooks.register', 'Use hookManager.on()');
   * // (no warning)
   * ```
   */
  suppress(apiName) {
    this[_suppressed].add(apiName);
  }

  /**
   * Get a summary of all deprecated API calls with migration guidance.
   * Returns array of entries sorted by API name.
   *
   * @returns {Array<{api: string, alternative: string, count: number, stack: string}>}
   *
   * @example
   * ```javascript
   * const report = logger.report();
   * console.log(`Found ${report.length} deprecated API usages`);
   * report.forEach(({api, alternative, count}) => {
   *   console.log(`  ${api} (${count} calls) → ${alternative}`);
   * });
   * ```
   */
  report() {
    const entries = [];

    for (const [api, data] of this[_logged].entries()) {
      entries.push({
        api,
        alternative: data.alternative,
        count: data.count,
        stack: data.stack,
      });
    }

    // Sort by API name for consistent output
    return entries.sort((a, b) => a.api.localeCompare(b.api));
  }

  /**
   * Reset all tracking (useful for testing).
   * Clears logged entries and suppressed APIs.
   */
  reset() {
    this[_logged].clear();
    this[_suppressed].clear();
  }

  /**
   * Check if an API has been logged.
   * Useful for testing.
   *
   * @param {string} apiName - API to check
   * @returns {boolean}
   */
  hasLogged(apiName) {
    return this[_logged].has(apiName);
  }

  /**
   * Check if an API is suppressed.
   * Useful for testing.
   *
   * @param {string} apiName - API to check
   * @returns {boolean}
   */
  isSuppressed(apiName) {
    return this[_suppressed].has(apiName);
  }
}
