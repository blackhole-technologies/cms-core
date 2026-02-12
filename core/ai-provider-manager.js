/**
 * ai-provider-manager.js - AI Provider Plugin Manager
 *
 * WHY THIS EXISTS:
 * Manages discovery, loading, and instantiation of AI provider plugins.
 * Provides a unified interface for the CMS to interact with multiple AI providers
 * (OpenAI, Anthropic, Ollama, etc.) without knowing their implementation details.
 *
 * DESIGN DECISIONS:
 * - Uses PluginManager for discovery and instantiation
 * - Integrates with AI registry for metadata tracking
 * - Caches provider instances for performance
 * - Supports hot-reload during development
 * - Provides routing based on model prefixes (e.g., "openai/gpt-4")
 *
 * USAGE:
 *   const providerManager = services.get('ai-provider-manager');
 *   const providers = await providerManager.discoverProviders();
 *   const provider = await providerManager.loadProvider('openai');
 *   const response = await providerManager.routeToProvider('chat', [messages], 'openai/gpt-4');
 */

import { PluginManager } from './lib/Plugin/index.js';
import { checkProviderLimit } from './ai-rate-limiter.js';

/**
 * Service state
 */
let pluginManager = null;
let providerCache = new Map();
let services = null;
let hooks = null;
let initialized = false;

/**
 * Initialize the AI Provider Manager
 *
 * @param {Object} ctx - Service context
 * @param {Object} ctx.services - DI container
 * @param {Object} ctx.hooks - Hook manager
 * @param {Array} ctx.modulePaths - Discovered module paths
 */
export function init(ctx) {
  if (!ctx || !ctx.services || !ctx.hooks || !ctx.modulePaths) {
    throw new Error('[ai-provider-manager] Invalid context: services, hooks, and modulePaths required');
  }

  services = ctx.services;
  hooks = ctx.hooks;

  // WHY: Create a PluginManager specifically for AI providers
  // Scans modules/*/plugins/ai_provider/ for provider implementations
  pluginManager = new PluginManager('ai_provider', {
    subdir: 'ai_provider',
    alterHook: 'ai_provider_info_alter',
    defaults: {
      category: 'AI Provider',
      weight: 0,
    },
  });

  // WHY: Wire up infrastructure after instantiation
  pluginManager.setInfrastructure(services, hooks, ctx.modulePaths);

  initialized = true;
  console.log('[ai-provider-manager] Service initialized');
}

/**
 * Discover all available AI provider plugins
 *
 * WHY: Scans all modules for provider plugins and returns their metadata.
 * Used by admin UI to show available providers and their capabilities.
 *
 * @returns {Promise<Array<Object>>} Array of provider definitions
 *   Each definition includes:
 *   - id: Provider plugin ID
 *   - label: Human-readable name
 *   - description: Provider description
 *   - models: Array of supported models
 *   - operations: Array of supported operations
 *   - _module: Source module name
 *
 * @example
 *   const providers = await discoverProviders();
 *   // [
 *   //   { id: 'openai', label: 'OpenAI', models: [...], operations: ['chat', 'embeddings'] },
 *   //   { id: 'anthropic', label: 'Anthropic', models: [...], operations: ['chat'] }
 *   // ]
 */
export async function discoverProviders() {
  if (!initialized) {
    throw new Error('[ai-provider-manager] Service not initialized');
  }

  const definitions = await pluginManager.getDefinitions();
  return Array.from(definitions.values());
}

/**
 * Check if a provider plugin exists
 *
 * @param {string} providerId - Provider plugin ID (e.g., 'openai', 'anthropic')
 * @returns {Promise<boolean>} True if provider exists
 */
export async function hasProvider(providerId) {
  if (!initialized) {
    throw new Error('[ai-provider-manager] Service not initialized');
  }

  return pluginManager.hasDefinition(providerId);
}

/**
 * Get provider definition without instantiating
 *
 * @param {string} providerId - Provider plugin ID
 * @returns {Promise<Object|null>} Provider definition or null
 */
export async function getProviderDefinition(providerId) {
  if (!initialized) {
    throw new Error('[ai-provider-manager] Service not initialized');
  }

  return pluginManager.getDefinition(providerId);
}

/**
 * Load and instantiate an AI provider plugin
 *
 * WHY: Creates a provider instance with its configuration.
 * Caches instances to avoid recreating on every request.
 * Returns an object implementing the AIProvider interface.
 *
 * @param {string} providerId - Provider plugin ID (e.g., 'openai')
 * @param {Object} configuration - Optional runtime configuration
 * @returns {Promise<Object>} Provider instance
 * @throws {Error} If provider not found or invalid
 *
 * @example
 *   const provider = await loadProvider('openai', {
 *     apiKey: 'sk-...',
 *     organization: 'org-...'
 *   });
 *   const models = await provider.getModels();
 */
export async function loadProvider(providerId, configuration = {}) {
  if (!initialized) {
    throw new Error('[ai-provider-manager] Service not initialized');
  }

  // WHY: Check cache first to reuse instances
  const cacheKey = `${providerId}:${JSON.stringify(configuration)}`;
  if (providerCache.has(cacheKey)) {
    return providerCache.get(cacheKey);
  }

  // WHY: Get provider configuration from config service if not passed
  if (!configuration.apiKey && services) {
    const configService = services.get('config');
    if (configService) {
      const providerConfig = configService.get(`ai.providers.${providerId}`) || {};
      configuration = { ...providerConfig, ...configuration };
    }
  }

  // WHY: Use PluginManager to create instance
  const provider = await pluginManager.createInstance(providerId, configuration);

  // WHY: Validate that provider implements required methods
  const requiredMethods = ['getModels', 'isUsable', 'getSupportedOperations'];
  for (const method of requiredMethods) {
    if (typeof provider[method] !== 'function') {
      throw new Error(
        `[ai-provider-manager] Provider "${providerId}" missing required method: ${method}`
      );
    }
  }

  // WHY: Cache the instance for future use
  providerCache.set(cacheKey, provider);

  console.log(`[ai-provider-manager] Loaded provider: ${providerId}`);
  return provider;
}

/**
 * Get all usable (configured) providers
 *
 * WHY: Filters providers by their isUsable() check.
 * Only returns providers that have valid configuration (API keys, etc.)
 *
 * @returns {Promise<Array<{id: string, provider: Object}>>}
 *   Array of usable providers with their IDs
 *
 * @example
 *   const usable = await getUsableProviders();
 *   // [{ id: 'openai', provider: OpenAIProvider }, ...]
 */
export async function getUsableProviders() {
  if (!initialized) {
    throw new Error('[ai-provider-manager] Service not initialized');
  }

  const definitions = await pluginManager.getDefinitions();
  const usable = [];

  for (const [id, def] of definitions.entries()) {
    try {
      const provider = await loadProvider(id);
      if (await provider.isUsable()) {
        usable.push({ id, provider });
      }
    } catch (error) {
      console.error(`[ai-provider-manager] Error checking provider "${id}":`, error.message);
    }
  }

  return usable;
}

/**
 * Route an AI operation to the appropriate provider
 *
 * WHY: Provides a unified interface for AI operations.
 * Automatically routes to the correct provider based on model prefix.
 * Falls back to first usable provider if no prefix specified.
 *
 * @param {string} operation - Operation name ('chat', 'embed', etc.)
 * @param {Array} args - Operation arguments
 * @param {string} modelSpec - Model specification (e.g., 'openai/gpt-4' or 'gpt-4')
 * @returns {Promise<*>} Operation result
 *
 * @example
 *   // With provider prefix
 *   const response = await routeToProvider('chat', [[...messages]], 'openai/gpt-4');
 *
 * @example
 *   // Without prefix (uses first usable provider)
 *   const embeddings = await routeToProvider('embed', ['Hello world'], 'text-embedding-ada-002');
 */
export async function routeToProvider(operation, args, modelSpec) {
  if (!initialized) {
    throw new Error('[ai-provider-manager] Service not initialized');
  }

  // WHY: Parse model spec to extract provider prefix
  // Format: "provider/model" or just "model"
  let providerId = null;
  let model = modelSpec;

  if (modelSpec && modelSpec.includes('/')) {
    [providerId, model] = modelSpec.split('/', 2);
  }

  // WHY: If no provider specified, find first usable provider supporting this operation
  if (!providerId) {
    const usable = await getUsableProviders();
    for (const { id, provider } of usable) {
      const ops = await provider.getSupportedOperations();
      if (ops.includes(operation)) {
        providerId = id;
        break;
      }
    }

    if (!providerId) {
      throw new Error(
        `[ai-provider-manager] No usable provider found for operation "${operation}"`
      );
    }
  }

  // WHY: Load the provider and execute operation
  const provider = await loadProvider(providerId);

  // WHY: Verify operation is supported
  const supportedOps = await provider.getSupportedOperations();
  if (!supportedOps.includes(operation)) {
    throw new Error(
      `[ai-provider-manager] Provider "${providerId}" does not support operation "${operation}"`
    );
  }

  // WHY: Check rate limits before executing operation (Feature #19)
  // Prevents exceeding provider API limits and manages costs
  const rateLimit = checkProviderLimit(providerId);
  if (!rateLimit.allowed) {
    const error = new Error(rateLimit.error);
    error.code = 'RATE_LIMIT_EXCEEDED';
    error.provider = providerId;
    error.retryAfter = rateLimit.retryAfter;
    error.resetAt = rateLimit.resetAt;
    throw error;
  }

  // WHY: Execute the operation with provided arguments
  if (typeof provider[operation] !== 'function') {
    throw new Error(
      `[ai-provider-manager] Provider "${providerId}" missing method for operation "${operation}"`
    );
  }

  return provider[operation](...args, model);
}

/**
 * Clear the provider instance cache
 *
 * WHY: Call after configuration changes or during development
 * to force reload of provider instances.
 */
export function clearCache() {
  providerCache.clear();
  console.log('[ai-provider-manager] Provider cache cleared');
}

/**
 * Clear plugin definitions cache
 *
 * WHY: Call after installing/uninstalling provider modules
 * to force rediscovery of available providers.
 */
export function clearDefinitions() {
  if (pluginManager) {
    pluginManager.clearCachedDefinitions();
  }
  clearCache();
  console.log('[ai-provider-manager] Provider definitions cleared');
}

/**
 * Service name for registration
 */
export const name = 'ai-provider-manager';
