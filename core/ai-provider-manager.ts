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

// @ts-expect-error -- lib/Plugin is plain JS without declaration files
import { PluginManager } from './lib/Plugin/index.js';
import { checkProviderLimit } from './ai-rate-limiter.ts';

// ============================================================================
// Types
// ============================================================================

/** Provider plugin definition */
interface ProviderDefinition {
  id: string;
  label?: string;
  description?: string;
  models?: string[];
  operations?: string[];
  _module?: string;
  [key: string]: unknown;
}

/** AI provider instance interface */
interface AIProviderInstance {
  getModels: () => Promise<string[]> | string[];
  isUsable: () => Promise<boolean> | boolean;
  getSupportedOperations: () => Promise<string[]> | string[];
  [key: string]: unknown;
}

/** Service container interface */
interface ServiceContainer {
  get: (name: string) => unknown;
  [key: string]: unknown;
}

/** Hook manager interface */
interface HookManager {
  trigger: (name: string, data: Record<string, unknown>) => Promise<void>;
  register: (name: string, handler: (ctx: Record<string, unknown>) => void | Promise<void>) => void;
}

/** Boot context for initialization */
interface BootContext {
  services: ServiceContainer;
  hooks: HookManager;
  modulePaths: string[];
}

/** Usable provider entry */
interface UsableProvider {
  id: string;
  provider: AIProviderInstance;
}

/** Rate limit error with extra fields */
interface RateLimitError extends Error {
  code?: string;
  provider?: string;
  retryAfter?: number;
  resetAt?: number;
}

// ============================================================================
// State
// ============================================================================

/**
 * Service state
 */
let pluginManager: InstanceType<typeof PluginManager> | null = null;
let providerCache: Map<string, AIProviderInstance> = new Map();
let services: ServiceContainer | null = null;
let hooks: HookManager | null = null;
let initialized: boolean = false;

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize the AI Provider Manager
 *
 * @param ctx - Service context
 */
export function init(ctx: BootContext): void {
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
 * @returns Array of provider definitions
 */
export async function discoverProviders(): Promise<ProviderDefinition[]> {
  if (!initialized || !pluginManager) {
    throw new Error('[ai-provider-manager] Service not initialized');
  }

  const definitions = await pluginManager.getDefinitions();
  return Array.from(definitions.values()) as ProviderDefinition[];
}

/**
 * Check if a provider plugin exists
 *
 * @param providerId - Provider plugin ID (e.g., 'openai', 'anthropic')
 * @returns True if provider exists
 */
export async function hasProvider(providerId: string): Promise<boolean> {
  if (!initialized || !pluginManager) {
    throw new Error('[ai-provider-manager] Service not initialized');
  }

  return pluginManager.hasDefinition(providerId);
}

/**
 * Get provider definition without instantiating
 *
 * @param providerId - Provider plugin ID
 * @returns Provider definition or null
 */
export async function getProviderDefinition(providerId: string): Promise<ProviderDefinition | null> {
  if (!initialized || !pluginManager) {
    throw new Error('[ai-provider-manager] Service not initialized');
  }

  return pluginManager.getDefinition(providerId) as ProviderDefinition | null;
}

/**
 * Load and instantiate an AI provider plugin
 *
 * WHY: Creates a provider instance with its configuration.
 * Caches instances to avoid recreating on every request.
 * Returns an object implementing the AIProvider interface.
 *
 * @param providerId - Provider plugin ID (e.g., 'openai')
 * @param configuration - Optional runtime configuration
 * @returns Provider instance
 * @throws If provider not found or invalid
 */
export async function loadProvider(providerId: string, configuration: Record<string, unknown> = {}): Promise<AIProviderInstance> {
  if (!initialized || !pluginManager) {
    throw new Error('[ai-provider-manager] Service not initialized');
  }

  // WHY: Check cache first to reuse instances
  const cacheKey = `${providerId}:${JSON.stringify(configuration)}`;
  if (providerCache.has(cacheKey)) {
    return providerCache.get(cacheKey)!;
  }

  // WHY: Get provider configuration from config service if not passed
  if (!configuration.apiKey && services) {
    const configService = services.get('config') as { get?: (key: string) => Record<string, unknown> | undefined } | null;
    if (configService && typeof configService.get === 'function') {
      const providerConfig = configService.get(`ai.providers.${providerId}`) || {};
      configuration = { ...providerConfig, ...configuration };
    }
  }

  // WHY: Use PluginManager to create instance
  const provider = await pluginManager.createInstance(providerId, configuration) as AIProviderInstance;

  // WHY: Validate that provider implements required methods
  const requiredMethods = ['getModels', 'isUsable', 'getSupportedOperations'] as const;
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
 * @returns Array of usable providers with their IDs
 */
export async function getUsableProviders(): Promise<UsableProvider[]> {
  if (!initialized || !pluginManager) {
    throw new Error('[ai-provider-manager] Service not initialized');
  }

  const definitions = await pluginManager.getDefinitions();
  const usable: UsableProvider[] = [];

  for (const [id] of definitions.entries()) {
    try {
      const provider = await loadProvider(id as string);
      if (await provider.isUsable()) {
        usable.push({ id: id as string, provider });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ai-provider-manager] Error checking provider "${id}":`, message);
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
 * @param operation - Operation name ('chat', 'embed', etc.)
 * @param args - Operation arguments
 * @param modelSpec - Model specification (e.g., 'openai/gpt-4' or 'gpt-4')
 * @returns Operation result
 */
export async function routeToProvider(operation: string, args: unknown[], modelSpec: string | null): Promise<unknown> {
  if (!initialized) {
    throw new Error('[ai-provider-manager] Service not initialized');
  }

  // WHY: Parse model spec to extract provider prefix
  // Format: "provider/model" or just "model"
  let providerId: string | null = null;
  let model: string | null = modelSpec;

  if (modelSpec && modelSpec.includes('/')) {
    const parts = modelSpec.split('/', 2);
    providerId = parts[0] ?? null;
    model = parts[1] ?? null;
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
    const error: RateLimitError = new Error(rateLimit.error);
    error.code = 'RATE_LIMIT_EXCEEDED';
    error.provider = providerId;
    error.retryAfter = rateLimit.retryAfter;
    error.resetAt = rateLimit.resetAt;
    throw error;
  }

  // WHY: Execute the operation with provided arguments
  const operationFn = provider[operation];
  if (typeof operationFn !== 'function') {
    throw new Error(
      `[ai-provider-manager] Provider "${providerId}" missing method for operation "${operation}"`
    );
  }

  return (operationFn as (...a: unknown[]) => unknown)(...args, model);
}

/**
 * Clear the provider instance cache
 *
 * WHY: Call after configuration changes or during development
 * to force reload of provider instances.
 */
export function clearCache(): void {
  providerCache.clear();
  console.log('[ai-provider-manager] Provider cache cleared');
}

/**
 * Clear plugin definitions cache
 *
 * WHY: Call after installing/uninstalling provider modules
 * to force rediscovery of available providers.
 */
export function clearDefinitions(): void {
  if (pluginManager) {
    pluginManager.clearCachedDefinitions();
  }
  clearCache();
  console.log('[ai-provider-manager] Provider definitions cleared');
}

/**
 * Service name for registration
 */
export const name: string = 'ai-provider-manager';
