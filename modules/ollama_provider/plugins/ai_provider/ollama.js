/**
 * Ollama Provider Plugin
 *
 * Implements the AIProvider interface for Ollama local models.
 * Supports: chat, embeddings with locally-hosted models.
 *
 * WHY NO NPM DEPENDENCIES:
 * cms-core is zero-dependency by design. We use node:http directly
 * to make Ollama API calls. This keeps the codebase lean and auditable.
 *
 * WHY OLLAMA:
 * Ollama runs AI models locally without cloud dependencies. Users control
 * their data and avoid API costs. Perfect for privacy-sensitive applications.
 */

import { AIProvider } from '../../../../core/lib/Plugin/index.js';
import http from 'node:http';

/**
 * Ollama Provider class
 */
class OllamaProvider extends AIProvider {
  constructor(configuration, pluginId, pluginDefinition) {
    super(configuration, pluginId, pluginDefinition);

    // WHY PARSE URL:
    // Support both http://localhost:11434 and localhost:11434 formats
    const baseURL = configuration.baseURL || 'http://localhost:11434';
    const url = new URL(baseURL.startsWith('http') ? baseURL : `http://${baseURL}`);

    this.hostname = url.hostname;
    this.port = url.port || 11434;
    this.protocol = url.protocol.replace(':', '');
  }

  /**
   * Get available Ollama models by querying the API
   *
   * WHY DYNAMIC MODEL DISCOVERY:
   * Unlike cloud providers with fixed model lists, Ollama models depend on
   * what the user has pulled/installed locally. We query the API to get
   * the actual list of available models.
   */
  async getModels() {
    try {
      const models = await this._makeRequest('/api/tags', null, { method: 'GET' });

      // WHY MAP TO STANDARD FORMAT:
      // Transform Ollama's response format to our AIProvider interface
      return models.models.map(model => ({
        id: model.name,
        name: model.name,
        operations: this._detectOperations(model),
      }));
    } catch (error) {
      // WHY RETURN EMPTY ARRAY ON ERROR:
      // If Ollama isn't running, return empty list instead of throwing.
      // This allows the system to show "No models available" gracefully.
      return [];
    }
  }

  /**
   * Detect which operations a model supports based on its capabilities
   *
   * WHY CAPABILITY DETECTION:
   * Different Ollama models have different capabilities. Some are chat-only,
   * others support embeddings. We need to determine this per model.
   */
  _detectOperations(model) {
    const operations = ['chat']; // All models support chat

    // WHY CHECK MODEL DETAILS:
    // Embedding models typically have 'embed' in their name
    if (model.name.includes('embed')) {
      operations.push('embeddings');
    }

    return operations;
  }

  /**
   * Check if Ollama server is reachable
   *
   * WHY TEST CONNECTION:
   * Unlike cloud APIs with API keys, Ollama just needs the server running.
   * We test connectivity by trying to list models.
   */
  async isUsable() {
    try {
      await this._makeRequest('/api/tags', null, { method: 'GET' });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get supported operations
   *
   * WHY AGGREGATE FROM MODELS:
   * Operations depend on which models are installed. We check available
   * models to determine overall provider capabilities.
   */
  async getSupportedOperations() {
    const models = await this.getModels();
    const operations = new Set();

    for (const model of models) {
      for (const op of model.operations) {
        operations.add(op);
      }
    }

    return Array.from(operations);
  }

  /**
   * Execute chat completion
   */
  async chat(messages, model, options = {}) {
    const { stream = false, temperature = 0.7, maxTokens, onChunk } = options;

    // WHY CONVERT MESSAGE FORMAT:
    // Ollama expects a different format than OpenAI/Anthropic
    const payload = {
      model,
      messages,
      stream,
      options: {
        temperature,
      },
    };

    if (maxTokens) {
      payload.options.num_predict = maxTokens;
    }

    return this._makeRequest('/api/chat', payload, {
      stream,
      onChunk,
    });
  }

  /**
   * Generate embeddings
   */
  async embed(text, model, options = {}) {
    const input = Array.isArray(text) ? text : [text];

    // WHY SEQUENTIAL REQUESTS:
    // Ollama's /api/embeddings endpoint processes one text at a time
    const embeddings = [];

    for (const item of input) {
      const payload = {
        model,
        prompt: item,
      };

      const response = await this._makeRequest('/api/embeddings', payload);

      // WHY CONVERT TO FLOAT64ARRAY:
      // Standard format for vector operations
      embeddings.push(new Float64Array(response.embedding));
    }

    return {
      embeddings,
      dimensions: embeddings[0].length,
    };
  }

  /**
   * Helper: Make HTTP request to Ollama API
   *
   * WHY USE node:http DIRECTLY:
   * - Zero dependencies (no fetch, no axios)
   * - Full control over streaming, headers, timeouts
   * - Ollama runs locally on HTTP (not HTTPS)
   */
  async _makeRequest(path, payload, options = {}) {
    const { stream = false, onChunk, method = 'POST' } = options;

    return new Promise((resolve, reject) => {
      const data = payload ? JSON.stringify(payload) : null;

      const requestOptions = {
        hostname: this.hostname,
        port: this.port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
        },
      };

      if (data) {
        requestOptions.headers['Content-Length'] = Buffer.byteLength(data);
      }

      const req = http.request(requestOptions, (res) => {
        let responseBody = '';

        // WHY HANDLE STREAMING:
        // Ollama streaming sends newline-delimited JSON (NDJSON)
        if (stream && onChunk) {
          let buffer = '';

          res.on('data', (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');

            // WHY KEEP LAST LINE:
            // Last line might be incomplete, process it on next chunk
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.trim()) {
                try {
                  const parsed = JSON.parse(line);

                  // WHY CHECK MESSAGE CONTENT:
                  // Ollama chat streaming sends { message: { content: '...' } }
                  if (parsed.message?.content) {
                    const text = parsed.message.content;
                    onChunk(text);
                    responseBody += text;
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
            reject(new Error(`[ollama] API error ${res.statusCode}: ${responseBody}`));
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
            // WHY PARSE JSON:
            // Standard API response format
            try {
              const parsed = JSON.parse(responseBody);

              // WHY HANDLE DIFFERENT ENDPOINTS:
              // Chat endpoint returns { message: {...} }
              // Embeddings endpoint returns { embedding: [...] }
              // Tags endpoint returns { models: [...] }
              if (parsed.message) {
                resolve({
                  role: 'assistant',
                  content: parsed.message.content,
                });
              } else {
                resolve(parsed);
              }
            } catch (e) {
              reject(new Error(`[ollama] Failed to parse response: ${e.message}`));
            }
          }
        });
      });

      req.on('error', (error) => {
        // WHY ENHANCE ERROR MESSAGE:
        // Help users understand when Ollama isn't running
        if (error.code === 'ECONNREFUSED') {
          reject(new Error(`[ollama] Connection refused. Is Ollama running? (${this.hostname}:${this.port})`));
        } else {
          reject(error);
        }
      });

      if (data) {
        req.write(data);
      }
      req.end();
    });
  }

  /**
   * Build configuration form
   */
  buildConfigurationForm(form = {}) {
    form.baseURL = {
      '#type': 'textfield',
      '#title': 'Base URL',
      '#description': 'Ollama server URL (default: http://localhost:11434)',
      '#default_value': this._configuration.baseURL || 'http://localhost:11434',
    };

    form.help = {
      '#type': 'markup',
      '#markup': '<p><strong>Note:</strong> Ollama must be installed and running locally. <a href="https://ollama.ai" target="_blank">Download Ollama</a></p>',
    };

    return form;
  }
}

/**
 * Plugin definition
 */
export const definition = {
  id: 'ollama',
  label: 'Ollama',
  description: 'Local AI models via Ollama',
  category: 'AI Provider',
  provider: 'Ollama',
  models: [], // Dynamic - queried from server
  operations: ['chat', 'embeddings'],
  weight: 20,
};

/**
 * Plugin factory
 */
export default function create(configuration, pluginId, pluginDefinition) {
  return new OllamaProvider(configuration, pluginId, pluginDefinition);
}
