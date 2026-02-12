/**
 * ai/index.js - AI Core Module
 *
 * WHY THIS EXISTS:
 * Provides core AI infrastructure including the provider plugin system,
 * allowing the CMS to integrate with multiple AI services (OpenAI, Anthropic, etc.)
 * through a unified interface.
 *
 * DESIGN DECISIONS:
 * - Provider plugin architecture for extensibility
 * - Service-based registration for dependency injection
 * - Configuration-driven provider instantiation
 *
 * USAGE:
 *   const providerManager = context.services.get('ai-provider-manager');
 *   const providers = await providerManager.discoverProviders();
 */

import providerManager from './core/provider-manager.js';

/**
 * Register AI core services
 */
export function hook_services(register, context) {
  // Register the provider manager as a service
  register('ai-provider-manager', providerManager);

  console.log('[ai] AI Provider Manager service registered');
}
