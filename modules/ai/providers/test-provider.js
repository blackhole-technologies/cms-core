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
}

export default TestProvider;
