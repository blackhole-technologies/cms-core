/**
 * Anthropic Provider Module
 *
 * Provides Claude AI models via the Anthropic API.
 */

/**
 * Implements hook_boot().
 * Called during system initialization.
 */
export function hook_boot() {
  // WHY: Module loads during boot to register AI provider plugin
  // The plugin system automatically discovers plugins/ai_provider/anthropic.js
}

export default {
  hook_boot,
};
