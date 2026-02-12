/**
 * AI Provider Interface
 *
 * Base interface that all AI provider plugins must implement.
 * Defines the contract for discovering models, checking availability,
 * and declaring supported operations.
 */

class AIProviderInterface {
  /**
   * Create a new AI provider instance
   * @param {Object} config - Provider configuration including API keys and settings
   */
  constructor(config = {}) {
    if (this.constructor === AIProviderInterface) {
      throw new Error('AIProviderInterface is an abstract class and cannot be instantiated directly');
    }
    this.config = config;
  }

  /**
   * Get list of available models from this provider
   * @returns {Promise<Array<Object>>} Array of model objects with {id, name, capabilities}
   * @abstract
   */
  async getModels() {
    throw new Error('getModels() must be implemented by provider');
  }

  /**
   * Check if this provider is currently usable (has valid credentials, network access, etc.)
   * @returns {Promise<boolean>} True if provider is ready to use
   * @abstract
   */
  async isUsable() {
    throw new Error('isUsable() must be implemented by provider');
  }

  /**
   * Get list of operation types this provider supports
   * @returns {Array<string>} Array of operation type names (e.g., ['chat', 'embeddings', 'text-to-image'])
   * @abstract
   */
  getSupportedOperations() {
    throw new Error('getSupportedOperations() must be implemented by provider');
  }

  /**
   * Get provider metadata
   * @returns {Object} Provider information {name, version, description}
   */
  getMetadata() {
    return {
      name: this.constructor.name,
      version: '1.0.0',
      description: 'AI Provider'
    };
  }

  /**
   * Get required configuration properties for this provider
   * @returns {Array<Object>} Array of config property definitions {name, type, required, description}
   */
  getRequiredConfig() {
    return [
      {
        name: 'apiKey',
        type: 'string',
        required: true,
        description: 'API key for authentication'
      }
    ];
  }

  /**
   * Validate provider configuration
   * @param {Object} config - Configuration to validate
   * @returns {Object} {valid: boolean, errors: Array<string>}
   */
  validateConfig(config) {
    const errors = [];
    const required = this.getRequiredConfig();

    for (const prop of required) {
      if (prop.required && !config[prop.name]) {
        errors.push(`Missing required configuration: ${prop.name}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

export default AIProviderInterface;
