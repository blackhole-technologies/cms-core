/**
 * Ollama Provider Module
 *
 * Provides local AI models via Ollama.
 */

/**
 * Implements hook_boot().
 * Called during system initialization.
 */
export function hook_boot() {
  // WHY: Module loads during boot to register AI provider plugin
  // The plugin system automatically discovers plugins/ai_provider/ollama.js
}

export default {
  hook_boot,
};
