/**
 * TEMPLATE: AI Provider Plugin
 * 
 * Each AI provider registers itself with the AI service.
 * Providers declare what models and operations they support.
 * The AI service routes requests to the appropriate provider.
 * 
 * Used by: TIER 1 (AI Core) features
 */

// Module: modules/ai/providers/example.js
export function init(ctx) {
  const ai = ctx.services.get('ai');

  ai.registerProvider('example', {
    // What this provider offers
    name: 'Example Provider',
    models: ['example-large', 'example-small'],
    operations: ['chat', 'embeddings'],

    // Health check
    async isUsable() {
      const config = ctx.services.get('config').get('ai.providers.example');
      return !!config?.apiKey;
    },

    // Return available models
    async getModels() {
      return [
        { id: 'example-large', name: 'Example Large', operations: ['chat', 'embeddings'] },
        { id: 'example-small', name: 'Example Small', operations: ['chat'] }
      ];
    },

    // Chat operation — streaming support via callback
    async chat(messages, model, options = {}) {
      const config = ctx.services.get('config').get('ai.providers.example');
      const { stream, temperature, maxTokens } = options;

      // Build request using node:https (NO npm deps)
      const https = await import('node:https');
      const payload = JSON.stringify({
        model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        temperature: temperature ?? 0.7,
        max_tokens: maxTokens ?? 1024,
        stream: !!stream
      });

      // ... make request, parse response
      // If streaming, call options.onChunk(text) for each chunk
      // Return { role: 'assistant', content: fullResponse }
    },

    // Embeddings operation
    async embed(text, model) {
      // ... return { vector: Float64Array, dimensions: 1536 }
    }
  });
}

/**
 * Usage from any module:
 * 
 *   const ai = ctx.services.get('ai');
 *   const response = await ai.chat([
 *     { role: 'system', content: 'You are helpful.' },
 *     { role: 'user', content: 'Hello' }
 *   ], { model: 'anthropic/claude-sonnet-4-5', stream: true });
 * 
 * The AI service resolves the provider from the model prefix.
 */
