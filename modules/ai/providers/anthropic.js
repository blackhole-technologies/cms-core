/**
 * Anthropic Provider
 *
 * Implements the AI provider interface for Anthropic's Claude API.
 * Supports chat operations with Claude models.
 */

import AIProviderInterface from '../core/provider-interface.js';

class AnthropicProvider extends AIProviderInterface {
  constructor(config = {}) {
    super(config);
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    this.baseURL = config.baseURL || 'https://api.anthropic.com/v1';
    this.apiVersion = config.apiVersion || '2023-06-01';
  }

  /**
   * Get list of available Anthropic Claude models
   * @returns {Promise<Array<Object>>} Array of model objects
   */
  async getModels() {
    return [
      {
        id: 'claude-3-opus-20240229',
        name: 'Claude 3 Opus',
        capabilities: ['chat']
      },
      {
        id: 'claude-3-sonnet-20240229',
        name: 'Claude 3 Sonnet',
        capabilities: ['chat']
      },
      {
        id: 'claude-3-haiku-20240307',
        name: 'Claude 3 Haiku',
        capabilities: ['chat']
      },
      {
        id: 'claude-2.1',
        name: 'Claude 2.1',
        capabilities: ['chat']
      },
      {
        id: 'claude-2.0',
        name: 'Claude 2.0',
        capabilities: ['chat']
      },
      {
        id: 'claude-instant-1.2',
        name: 'Claude Instant 1.2',
        capabilities: ['chat']
      }
    ];
  }

  /**
   * Check if the provider is usable (has valid API key)
   * @returns {Promise<boolean>} True if API key is configured
   */
  async isUsable() {
    return Boolean(this.apiKey);
  }

  /**
   * Get supported operation types
   * @returns {Array<string>} Array of operation types
   */
  getSupportedOperations() {
    return ['chat'];
  }

  /**
   * Get provider metadata
   * @returns {Object} Provider information
   */
  getMetadata() {
    return {
      name: 'AnthropicProvider',
      version: '1.0.0',
      description: 'Anthropic Claude API provider with support for chat completions'
    };
  }

  /**
   * Get required configuration properties
   * @returns {Array<Object>} Configuration schema
   */
  getRequiredConfig() {
    return [
      {
        name: 'apiKey',
        type: 'string',
        required: true,
        description: 'Anthropic API key for authentication'
      },
      {
        name: 'baseURL',
        type: 'string',
        required: false,
        description: 'Base URL for Anthropic API (defaults to https://api.anthropic.com/v1)'
      },
      {
        name: 'apiVersion',
        type: 'string',
        required: false,
        description: 'API version to use (defaults to 2023-06-01)'
      }
    ];
  }

  /**
   * Execute a chat completion request using Anthropic's Messages API
   * @param {Object} options - Request options
   * @returns {Promise<Object>} API response
   */
  async chat(options) {
    if (!this.apiKey) {
      throw new Error('Anthropic API key not configured');
    }

    // Convert OpenAI-style messages to Anthropic format
    const messages = this._convertMessages(options.messages || []);

    const response = await fetch(`${this.baseURL}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': this.apiVersion
      },
      body: JSON.stringify({
        model: options.model || 'claude-3-sonnet-20240229',
        messages: messages,
        max_tokens: options.max_tokens || 1024,
        temperature: options.temperature,
        system: options.system,
        ...options
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.statusText} - ${error}`);
    }

    return response.json();
  }

  /**
   * Convert messages to Anthropic format
   * @private
   * @param {Array<Object>} messages - Messages in OpenAI format
   * @returns {Array<Object>} Messages in Anthropic format
   */
  _convertMessages(messages) {
    // Anthropic expects messages with role (user/assistant) and content
    // System messages should be extracted to the top-level system parameter
    return messages
      .filter(msg => msg.role !== 'system')
      .map(msg => ({
        role: msg.role,
        content: msg.content
      }));
  }
}

export default AnthropicProvider;
