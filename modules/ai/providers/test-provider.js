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
}

export default TestProvider;
