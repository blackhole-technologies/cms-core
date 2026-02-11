/**
 * ai_test_timeout module - Test AI provider that simulates timeout
 *
 * This module is used to test the health check timeout functionality.
 */

/**
 * hook_boot - Initialize the test AI module
 */
export function hook_boot(context) {
  console.log('[ai_test_timeout] Timeout test AI module loaded (disabled by default)');
}
