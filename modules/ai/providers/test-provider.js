/**
 * Test Provider
 * Simple test implementation for verification
 */

import AIProviderInterface from '../core/provider-interface.js';

class TestProvider extends AIProviderInterface {
  constructor(config = {}) {
    super(config);
  }

  async getModels() {
    return [
      {
        id: 'test-model-1',
        name: 'Test Model 1',
        capabilities: ['chat', 'embeddings']
      },
      {
        id: 'test-model-2',
        name: 'Test Model 2',
        capabilities: ['chat']
      }
    ];
  }

  async isUsable() {
    return true;
  }

  getSupportedOperations() {
    return ['chat', 'embeddings'];
  }

  getMetadata() {
    return {
      name: 'TestProvider',
      version: '1.0.0',
      description: 'Test provider for verification'
    };
  }

  /**
   * Execute a chat completion request
   * @param {Object} options - Request options
   * @returns {Promise<Object>} Mock response
   */
  async chat(options) {
    // Return a mock response in OpenAI format
    return {
      id: 'test-response-1',
      object: 'chat.completion',
      created: Date.now(),
      model: options.model || 'test-model-1',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'This is a test response from the test provider.'
          },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30
      }
    };
  }

  /**
   * Execute a streaming chat completion request
   * @param {Object} options - Request options
   * @returns {AsyncGenerator} Mock streaming response
   */
  async* chatStream(options) {
    // Yield mock streaming chunks
    const words = ['This', 'is', 'a', 'test', 'streaming', 'response'];

    for (const word of words) {
      yield {
        delta: {
          content: word + ' ',
          role: 'assistant'
        }
      };
      // Small delay to simulate streaming
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // Final chunk
    yield {
      delta: {
        content: '',
        finishReason: 'stop'
      }
    };
  }

  /**
   * Generate embeddings for text
   * @param {Object} options - Options with input and model
   * @returns {Promise<Object>} Mock embedding response in OpenAI format
   */
  async embeddings(options) {
    const text = options.input || '';
    const model = options.model || 'test-model-1';

    // Return a mock embedding vector (768 dimensions like many real models)
    // Generate deterministic but varied values based on text content
    const dimensions = 768;
    const hash = text.split('').reduce((acc, char) => {
      return ((acc << 5) - acc) + char.charCodeAt(0);
    }, 0);

    const embedding = [];
    for (let i = 0; i < dimensions; i++) {
      // Generate pseudo-random values between -1 and 1
      const value = Math.sin(hash * (i + 1)) * 0.5;
      embedding.push(value);
    }

    // Return in OpenAI format
    return {
      object: 'list',
      data: [
        {
          object: 'embedding',
          embedding,
          index: 0
        }
      ],
      model,
      usage: {
        prompt_tokens: text.split(' ').length,
        total_tokens: text.split(' ').length
      }
    };
  }
}

export default TestProvider;
