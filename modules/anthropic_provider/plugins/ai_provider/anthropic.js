/**
 * Anthropic Provider Plugin
 *
 * Implements the AIProvider interface for Anthropic's Claude API.
 * Supports: chat operations with Claude models.
 *
 * WHY NO NPM DEPENDENCIES:
 * cms-core is zero-dependency by design. We use node:https directly
 * to make Anthropic API calls. This keeps the codebase lean and auditable.
 */

import { AIProvider } from '../../../../core/lib/Plugin/index.js';
import https from 'node:https';

/**
 * Anthropic Provider class
 */
class AnthropicProvider extends AIProvider {
  constructor(configuration, pluginId, pluginDefinition) {
    super(configuration, pluginId, pluginDefinition);

    // WHY STORE API KEY:
    // Need it for every API request. Configuration passed during instantiation.
    this.apiKey = configuration.apiKey || null;
    this.baseURL = configuration.baseURL || 'api.anthropic.com';
    this.apiVersion = configuration.apiVersion || '2023-06-01';
  }

  /**
   * Get available Anthropic models
   */
  async getModels() {
    return [
      {
        id: 'claude-opus-4-20250514',
        name: 'Claude Opus 4',
        operations: ['chat'],
      },
      {
        id: 'claude-sonnet-4-20250514',
        name: 'Claude Sonnet 4',
        operations: ['chat'],
      },
      {
        id: 'claude-3-5-sonnet-20241022',
        name: 'Claude 3.5 Sonnet',
        operations: ['chat'],
      },
      {
        id: 'claude-3-opus-20240229',
        name: 'Claude 3 Opus',
        operations: ['chat'],
      },
      {
        id: 'claude-3-sonnet-20240229',
        name: 'Claude 3 Sonnet',
        operations: ['chat'],
      },
      {
        id: 'claude-3-haiku-20240307',
        name: 'Claude 3 Haiku',
        operations: ['chat'],
      },
    ];
  }

  /**
   * Check if provider is configured with API key
   */
  async isUsable() {
    return !!this.apiKey;
  }

  /**
   * Get supported operations
   */
  async getSupportedOperations() {
    return ['chat'];
  }

  /**
   * Execute chat completion
   *
   * WHY MESSAGE FORMAT CONVERSION:
   * Anthropic API uses a different message format than OpenAI.
   * - System messages are separate from conversation messages
   * - Messages array only contains user/assistant messages
   */
  async chat(messages, model, options = {}) {
    if (!this.apiKey) {
      throw new Error('[anthropic] API key not configured');
    }

    const { stream = false, temperature = 1.0, maxTokens = 4096, onChunk } = options;

    // WHY SEPARATE SYSTEM MESSAGES:
    // Anthropic API expects system prompt as a separate field, not in messages array
    const systemMessages = messages.filter(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    const payload = {
      model,
      messages: conversationMessages,
      max_tokens: maxTokens,
      temperature,
      stream,
    };

    // WHY CONCATENATE SYSTEM MESSAGES:
    // If multiple system messages exist, combine them into one
    if (systemMessages.length > 0) {
      payload.system = systemMessages.map(m => m.content).join('\n\n');
    }

    return this._makeRequest('/v1/messages', payload, {
      stream,
      onChunk,
    });
  }

  /**
   * Helper: Make HTTPS request to Anthropic API
   *
   * WHY USE node:https DIRECTLY:
   * - Zero dependencies (no fetch, no axios)
   * - Full control over streaming, headers, timeouts
   * - Works in Node.js without polyfills
   */
  async _makeRequest(path, payload, options = {}) {
    const { stream = false, onChunk } = options;

    return new Promise((resolve, reject) => {
      const data = JSON.stringify(payload);

      const requestOptions = {
        hostname: this.baseURL,
        port: 443,
        path,
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': this.apiVersion,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      };

      const req = https.request(requestOptions, (res) => {
        let responseBody = '';

        // WHY HANDLE STREAMING:
        // For messages with stream: true, Anthropic sends SSE events
        if (stream && onChunk) {
          let buffer = '';

          res.on('data', (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');

            // WHY KEEP LAST LINE:
            // Last line might be incomplete, process it on next chunk
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);

                try {
                  const parsed = JSON.parse(data);

                  // WHY HANDLE DIFFERENT EVENT TYPES:
                  // Anthropic streaming sends multiple event types
                  if (parsed.type === 'content_block_delta') {
                    const text = parsed.delta?.text;
                    if (text) {
                      onChunk(text);
                      responseBody += text;
                    }
                  }
                } catch (e) {
                  // Skip malformed JSON
                }
              }
            }
          });
        } else {
          // WHY COLLECT JSON RESPONSE:
          // Standard API responses
          res.on('data', (chunk) => {
            responseBody += chunk.toString();
          });
        }

        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`[anthropic] API error ${res.statusCode}: ${responseBody}`));
            return;
          }

          if (stream && onChunk) {
            // WHY RETURN COMPLETE TEXT:
            // For streaming, return the accumulated response
            resolve({
              role: 'assistant',
              content: responseBody,
            });
          } else {
            // WHY PARSE JSON AND EXTRACT CONTENT:
            // Anthropic returns { content: [{ type: 'text', text: '...' }] }
            try {
              const parsed = JSON.parse(responseBody);

              // WHY EXTRACT TEXT FROM CONTENT BLOCKS:
              // Anthropic response format uses content blocks
              const textBlocks = parsed.content.filter(block => block.type === 'text');
              const content = textBlocks.map(block => block.text).join('\n');

              resolve({
                role: 'assistant',
                content,
                usage: parsed.usage,
              });
            } catch (e) {
              reject(new Error(`[anthropic] Failed to parse response: ${e.message}`));
            }
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.write(data);
      req.end();
    });
  }

  /**
   * Build configuration form
   */
  buildConfigurationForm(form = {}) {
    form.apiKey = {
      '#type': 'textfield',
      '#title': 'API Key',
      '#required': true,
      '#description': 'Get your API key from console.anthropic.com/account/keys',
      '#default_value': this._configuration.apiKey || '',
    };

    form.baseURL = {
      '#type': 'textfield',
      '#title': 'Base URL',
      '#description': 'API base URL (default: api.anthropic.com)',
      '#default_value': this._configuration.baseURL || 'api.anthropic.com',
    };

    form.apiVersion = {
      '#type': 'textfield',
      '#title': 'API Version',
      '#description': 'Anthropic API version (default: 2023-06-01)',
      '#default_value': this._configuration.apiVersion || '2023-06-01',
    };

    return form;
  }
}

/**
 * Plugin definition
 */
export const definition = {
  id: 'anthropic',
  label: 'Anthropic',
  description: 'Anthropic Claude API integration',
  category: 'AI Provider',
  provider: 'Anthropic',
  models: ['claude-opus-4-20250514', 'claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'],
  operations: ['chat'],
  weight: 10,
};

/**
 * Plugin factory
 */
export default function create(configuration, pluginId, pluginDefinition) {
  return new AnthropicProvider(configuration, pluginId, pluginDefinition);
}
