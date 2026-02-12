/**
 * OpenAI Provider Plugin
 *
 * Implements the AIProvider interface for OpenAI's API.
 * Supports: chat, embeddings, text-to-speech, speech-to-text, text-to-image.
 *
 * WHY NO NPM DEPENDENCIES:
 * cms-core is zero-dependency by design. We use node:https directly
 * to make OpenAI API calls. This keeps the codebase lean and auditable.
 */

import { AIProvider } from '../../../../../core/lib/Plugin/index.js';
import https from 'node:https';

/**
 * OpenAI Provider class
 */
class OpenAIProvider extends AIProvider {
  constructor(configuration, pluginId, pluginDefinition) {
    super(configuration, pluginId, pluginDefinition);

    // WHY STORE API KEY:
    // Need it for every API request. Configuration passed during instantiation.
    this.apiKey = configuration.apiKey || null;
    this.organization = configuration.organization || null;
    this.baseURL = configuration.baseURL || 'api.openai.com';
  }

  /**
   * Get available OpenAI models
   */
  async getModels() {
    return [
      {
        id: 'gpt-4',
        name: 'GPT-4',
        operations: ['chat'],
      },
      {
        id: 'gpt-4-turbo',
        name: 'GPT-4 Turbo',
        operations: ['chat'],
      },
      {
        id: 'gpt-3.5-turbo',
        name: 'GPT-3.5 Turbo',
        operations: ['chat'],
      },
      {
        id: 'text-embedding-ada-002',
        name: 'Ada Embeddings v2',
        operations: ['embeddings'],
      },
      {
        id: 'dall-e-3',
        name: 'DALL-E 3',
        operations: ['text-to-image'],
      },
      {
        id: 'tts-1',
        name: 'Text-to-Speech',
        operations: ['text-to-speech'],
      },
      {
        id: 'whisper-1',
        name: 'Whisper',
        operations: ['speech-to-text'],
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
    return ['chat', 'embeddings', 'text-to-speech', 'speech-to-text', 'text-to-image'];
  }

  /**
   * Execute chat completion
   */
  async chat(messages, model, options = {}) {
    if (!this.apiKey) {
      throw new Error('[openai] API key not configured');
    }

    const { stream = false, temperature = 0.7, maxTokens = 1024, onChunk } = options;

    const payload = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream,
    };

    return this._makeRequest('/v1/chat/completions', payload, {
      stream,
      onChunk,
    });
  }

  /**
   * Generate embeddings
   */
  async embed(text, model, options = {}) {
    if (!this.apiKey) {
      throw new Error('[openai] API key not configured');
    }

    const input = Array.isArray(text) ? text : [text];

    const payload = {
      model,
      input,
    };

    const response = await this._makeRequest('/v1/embeddings', payload);

    // WHY CONVERT TO FLOAT64ARRAY:
    // Standard format for vector operations (similarity, search, etc.)
    const embeddings = response.data.map(item =>
      new Float64Array(item.embedding)
    );

    return {
      embeddings,
      dimensions: embeddings[0].length,
    };
  }

  /**
   * Text-to-Speech
   */
  async textToSpeech(text, model, options = {}) {
    if (!this.apiKey) {
      throw new Error('[openai] API key not configured');
    }

    const { voice = 'alloy', format = 'mp3', speed = 1.0 } = options;

    const payload = {
      model,
      input: text,
      voice,
      response_format: format,
      speed,
    };

    const response = await this._makeRequest('/v1/audio/speech', payload, {
      binary: true,
    });

    return response; // Returns Buffer
  }

  /**
   * Speech-to-Text
   */
  async speechToText(audio, model, options = {}) {
    if (!this.apiKey) {
      throw new Error('[openai] API key not configured');
    }

    // WHY MULTIPART FORM DATA:
    // Whisper API requires file upload, not JSON
    const { language, prompt } = options;

    const boundary = `----OpenAIFormBoundary${Date.now()}`;
    const formData = this._buildMultipartForm(audio, {
      model,
      language,
      prompt,
    }, boundary);

    const response = await this._makeRequest('/v1/audio/transcriptions', formData, {
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
    });

    return response;
  }

  /**
   * Text-to-Image
   */
  async textToImage(prompt, model, options = {}) {
    if (!this.apiKey) {
      throw new Error('[openai] API key not configured');
    }

    const { size = '1024x1024', n = 1, quality = 'standard', style } = options;

    const payload = {
      model,
      prompt,
      n,
      size,
      quality,
    };

    if (style) {
      payload.style = style;
    }

    const response = await this._makeRequest('/v1/images/generations', payload);

    return response.data;
  }

  /**
   * Helper: Make HTTPS request to OpenAI API
   *
   * WHY USE node:https DIRECTLY:
   * - Zero dependencies (no fetch, no axios)
   * - Full control over streaming, headers, timeouts
   * - Works in Node.js without polyfills
   */
  async _makeRequest(path, payload, options = {}) {
    const { stream = false, onChunk, binary = false, headers = {} } = options;

    return new Promise((resolve, reject) => {
      const data = typeof payload === 'string' ? payload : JSON.stringify(payload);

      const requestOptions = {
        hostname: this.baseURL,
        port: 443,
        path,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...headers,
        },
      };

      if (this.organization) {
        requestOptions.headers['OpenAI-Organization'] = this.organization;
      }

      const req = https.request(requestOptions, (res) => {
        let responseBody = binary ? [] : '';

        // WHY HANDLE STREAMING:
        // For chat completions with stream: true, OpenAI sends SSE events
        if (stream && onChunk) {
          res.on('data', (chunk) => {
            const lines = chunk.toString().split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') continue;

                try {
                  const parsed = JSON.parse(data);
                  const content = parsed.choices[0]?.delta?.content;
                  if (content) {
                    onChunk(content);
                    responseBody += content;
                  }
                } catch (e) {
                  // Skip malformed JSON
                }
              }
            }
          });
        } else if (binary) {
          // WHY COLLECT BINARY DATA AS BUFFER:
          // For audio/image responses
          res.on('data', (chunk) => {
            responseBody.push(chunk);
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
            reject(new Error(`[openai] API error ${res.statusCode}: ${responseBody}`));
            return;
          }

          if (stream && onChunk) {
            // WHY RETURN COMPLETE TEXT:
            // For streaming, return the accumulated response
            resolve({
              role: 'assistant',
              content: responseBody,
            });
          } else if (binary) {
            // WHY CONCATENATE BUFFERS:
            // Return complete binary response
            resolve(Buffer.concat(responseBody));
          } else {
            // WHY PARSE JSON:
            // Standard API response format
            try {
              const parsed = JSON.parse(responseBody);

              // WHY EXTRACT CHAT MESSAGE:
              // OpenAI returns { choices: [{ message: { role, content } }] }
              if (path === '/v1/chat/completions') {
                resolve(parsed.choices[0].message);
              } else {
                resolve(parsed);
              }
            } catch (e) {
              reject(new Error(`[openai] Failed to parse response: ${e.message}`));
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
   * Helper: Build multipart form data for file uploads
   */
  _buildMultipartForm(fileBuffer, fields, boundary) {
    const parts = [];

    // Add text fields
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && value !== null) {
        parts.push(
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
          `${value}\r\n`
        );
      }
    }

    // Add file
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="audio.wav"\r\n` +
      `Content-Type: audio/wav\r\n\r\n`
    );

    parts.push(fileBuffer);
    parts.push(`\r\n--${boundary}--\r\n`);

    return Buffer.concat(parts.map(p => Buffer.isBuffer(p) ? p : Buffer.from(p)));
  }

  /**
   * Build configuration form
   */
  buildConfigurationForm(form = {}) {
    form.apiKey = {
      '#type': 'textfield',
      '#title': 'API Key',
      '#required': true,
      '#description': 'Get your API key from platform.openai.com/account/api-keys',
      '#default_value': this._configuration.apiKey || '',
    };

    form.organization = {
      '#type': 'textfield',
      '#title': 'Organization ID',
      '#description': 'Optional. Your OpenAI organization ID.',
      '#default_value': this._configuration.organization || '',
    };

    form.baseURL = {
      '#type': 'textfield',
      '#title': 'Base URL',
      '#description': 'API base URL (default: api.openai.com)',
      '#default_value': this._configuration.baseURL || 'api.openai.com',
    };

    return form;
  }
}

/**
 * Plugin definition
 */
export const definition = {
  id: 'openai',
  label: 'OpenAI',
  description: 'OpenAI API integration (GPT-4, DALL-E, Whisper)',
  category: 'AI Provider',
  provider: 'OpenAI',
  models: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo', 'text-embedding-ada-002', 'dall-e-3', 'tts-1', 'whisper-1'],
  operations: ['chat', 'embeddings', 'text-to-speech', 'speech-to-text', 'text-to-image'],
  weight: 0,
};

/**
 * Plugin factory
 */
export default function create(configuration, pluginId, pluginDefinition) {
  return new OpenAIProvider(configuration, pluginId, pluginDefinition);
}
