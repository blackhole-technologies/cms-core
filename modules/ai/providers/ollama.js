/**
 * Ollama Provider
 *
 * Implements the AI provider interface for Ollama local models.
 * Supports chat and embeddings with locally-hosted models via Ollama.
 */

import AIProviderInterface from '../core/provider-interface.js';
import http from 'node:http';

class OllamaProvider extends AIProviderInterface {
  constructor(config = {}) {
    super(config);

    // Parse base URL to extract hostname and port
    const baseURL = config.baseURL || 'http://localhost:11434';
    const url = new URL(baseURL.startsWith('http') ? baseURL : `http://${baseURL}`);

    this.hostname = url.hostname;
    this.port = url.port || 11434;
    this.baseURL = baseURL;
  }

  /**
   * Get list of available Ollama models by querying the API
   * @returns {Promise<Array<Object>>} Array of model objects
   */
  async getModels() {
    try {
      const response = await this._makeRequest('/api/tags', null, { method: 'GET' });

      if (!response.models || !Array.isArray(response.models)) {
        return [];
      }

      return response.models.map(model => ({
        id: model.name,
        name: model.name,
        capabilities: this._detectCapabilities(model)
      }));
    } catch (error) {
      // Return empty array if Ollama is not running or unreachable
      return [];
    }
  }

  /**
   * Detect which capabilities a model supports based on its name/metadata
   * @private
   */
  _detectCapabilities(model) {
    const capabilities = ['chat']; // All Ollama models support chat

    // Embedding models typically have 'embed' in their name
    if (model.name.includes('embed')) {
      capabilities.push('embeddings');
    }

    return capabilities;
  }

  /**
   * Check if Ollama server is reachable
   * @returns {Promise<boolean>} True if server is accessible
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
   * Get supported operation types based on available models
   * @returns {Array<string>} Array of operation types
   */
  getSupportedOperations() {
    // Return synchronous default capabilities
    // Actual capabilities are determined dynamically via getModels()
    return ['chat', 'embeddings'];
  }

  /**
   * Get provider metadata
   * @returns {Object} Provider information
   */
  getMetadata() {
    return {
      name: 'OllamaProvider',
      version: '1.0.0',
      description: 'Ollama local AI models provider with support for chat and embeddings'
    };
  }

  /**
   * Get required configuration properties
   * @returns {Array<Object>} Configuration schema
   */
  getRequiredConfig() {
    return [
      {
        name: 'baseURL',
        type: 'string',
        required: false,
        description: 'Ollama server URL (defaults to http://localhost:11434)'
      }
    ];
  }

  /**
   * Make HTTP request to Ollama API
   * @private
   */
  async _makeRequest(path, payload, options = {}) {
    const { method = 'POST' } = options;

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

        res.on('data', (chunk) => {
          responseBody += chunk.toString();
        });

        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`Ollama API error ${res.statusCode}: ${responseBody}`));
            return;
          }

          try {
            const parsed = JSON.parse(responseBody);
            resolve(parsed);
          } catch (e) {
            reject(new Error(`Failed to parse Ollama response: ${e.message}`));
          }
        });
      });

      req.on('error', (error) => {
        if (error.code === 'ECONNREFUSED') {
          reject(new Error(`Connection refused. Is Ollama running at ${this.hostname}:${this.port}?`));
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
   * Execute a chat completion request
   * @param {Object} options - Request options
   * @returns {Promise<Object>} API response
   */
  async chat(options) {
    const payload = {
      model: options.model || 'llama2',
      messages: options.messages,
      stream: false,
      options: {
        temperature: options.temperature || 0.7,
      },
    };

    if (options.max_tokens) {
      payload.options.num_predict = options.max_tokens;
    }

    const response = await this._makeRequest('/api/chat', payload);

    return {
      message: response.message,
      model: response.model,
      created_at: response.created_at
    };
  }

  /**
   * Generate embeddings for text
   * @param {Object} options - Request options
   * @returns {Promise<Object>} API response
   */
  async embeddings(options) {
    const input = Array.isArray(options.input) ? options.input : [options.input];
    const embeddings = [];

    // Ollama processes one embedding at a time
    for (const text of input) {
      const payload = {
        model: options.model,
        prompt: text,
      };

      const response = await this._makeRequest('/api/embeddings', payload);
      embeddings.push(response.embedding);
    }

    return {
      embeddings,
      model: options.model
    };
  }
}

export default OllamaProvider;
