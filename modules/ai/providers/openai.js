/**
 * OpenAI Provider
 *
 * Implements the AI provider interface for OpenAI's API.
 * Supports chat, embeddings, text-to-speech, and text-to-image generation.
 */

import AIProviderInterface from '../core/provider-interface.js';

class OpenAIProvider extends AIProviderInterface {
  constructor(config = {}) {
    super(config);
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    this.baseURL = config.baseURL || 'https://api.openai.com/v1';
  }

  /**
   * Get list of available OpenAI models
   * @returns {Promise<Array<Object>>} Array of model objects
   */
  async getModels() {
    return [
      {
        id: 'gpt-4',
        name: 'GPT-4',
        capabilities: ['chat']
      },
      {
        id: 'gpt-4-turbo',
        name: 'GPT-4 Turbo',
        capabilities: ['chat']
      },
      {
        id: 'gpt-3.5-turbo',
        name: 'GPT-3.5 Turbo',
        capabilities: ['chat']
      },
      {
        id: 'text-embedding-ada-002',
        name: 'Text Embedding Ada 002',
        capabilities: ['embeddings']
      },
      {
        id: 'text-embedding-3-small',
        name: 'Text Embedding 3 Small',
        capabilities: ['embeddings']
      },
      {
        id: 'text-embedding-3-large',
        name: 'Text Embedding 3 Large',
        capabilities: ['embeddings']
      },
      {
        id: 'tts-1',
        name: 'Text-to-Speech 1',
        capabilities: ['text-to-speech']
      },
      {
        id: 'tts-1-hd',
        name: 'Text-to-Speech 1 HD',
        capabilities: ['text-to-speech']
      },
      {
        id: 'dall-e-3',
        name: 'DALL-E 3',
        capabilities: ['text-to-image']
      },
      {
        id: 'dall-e-2',
        name: 'DALL-E 2',
        capabilities: ['text-to-image']
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
    return ['chat', 'embeddings', 'text-to-speech', 'text-to-image'];
  }

  /**
   * Get provider metadata
   * @returns {Object} Provider information
   */
  getMetadata() {
    return {
      name: 'OpenAIProvider',
      version: '1.0.0',
      description: 'OpenAI API provider with support for chat, embeddings, TTS, and image generation'
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
        description: 'OpenAI API key for authentication'
      },
      {
        name: 'baseURL',
        type: 'string',
        required: false,
        description: 'Base URL for OpenAI API (defaults to https://api.openai.com/v1)'
      }
    ];
  }

  /**
   * Execute a chat completion request
   * @param {Object} options - Request options
   * @returns {Promise<Object>} API response
   */
  async chat(options) {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: options.model || 'gpt-3.5-turbo',
        messages: options.messages,
        temperature: options.temperature,
        max_tokens: options.max_tokens,
        ...options
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Generate embeddings for text
   * @param {Object} options - Request options
   * @returns {Promise<Object>} API response
   */
  async embeddings(options) {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const response = await fetch(`${this.baseURL}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: options.model || 'text-embedding-ada-002',
        input: options.input,
        ...options
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Generate speech from text
   * @param {Object} options - Request options
   * @returns {Promise<ArrayBuffer>} Audio data
   */
  async textToSpeech(options) {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const response = await fetch(`${this.baseURL}/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: options.model || 'tts-1',
        input: options.input,
        voice: options.voice || 'alloy',
        ...options
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    return response.arrayBuffer();
  }

  /**
   * Generate image from text prompt
   * @param {Object} options - Request options
   * @returns {Promise<Object>} API response
   */
  async textToImage(options) {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const response = await fetch(`${this.baseURL}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: options.model || 'dall-e-3',
        prompt: options.prompt,
        n: options.n || 1,
        size: options.size || '1024x1024',
        ...options
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    return response.json();
  }
}

export default OpenAIProvider;
