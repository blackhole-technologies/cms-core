/**
 * Fallback Chain Handler
 *
 * Implements provider fallback logic for AI operations.
 * When a primary provider fails, operations can automatically
 * fall back to alternative providers in a configured chain.
 *
 * WHY THIS EXISTS:
 * - Improves reliability by handling provider outages
 * - Allows graceful degradation when providers are unavailable
 * - Enables cost optimization by trying cheaper providers first
 *
 * USAGE:
 *   const chain = new FallbackChain([openai, anthropic, ollama]);
 *   const result = await chain.execute('chat', messages, options);
 */

export class FallbackChain {
  /**
   * Create a new fallback chain
   * @param {Array<AIProviderInterface>} providers - Array of provider instances in priority order
   */
  constructor(providers = []) {
    if (!Array.isArray(providers) || providers.length === 0) {
      throw new Error('FallbackChain requires at least one provider');
    }
    this.providers = providers;
  }

  /**
   * Execute an operation with fallback logic
   * @param {string} operation - Operation type (chat, embeddings, etc.)
   * @param {Function} operationFn - The operation function to execute
   * @param {Array} args - Arguments to pass to the operation function
   * @returns {Promise<Object>} Operation result
   */
  async execute(operation, operationFn, ...args) {
    const errors = [];

    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i];
      const providerName = provider.constructor.name;

      try {
        // Check if provider is usable
        const isUsable = await provider.isUsable();
        if (!isUsable) {
          const error = new Error(`Provider ${providerName} is not usable (configuration issue)`);
          errors.push({ provider: providerName, error: error.message });
          console.log(`[fallback-chain] Skipping ${providerName}: not usable`);
          continue;
        }

        // Check if provider supports the operation
        const supportedOps = provider.getSupportedOperations();
        if (!supportedOps.includes(operation)) {
          const error = new Error(`Provider ${providerName} does not support ${operation} operation`);
          errors.push({ provider: providerName, error: error.message });
          console.log(`[fallback-chain] Skipping ${providerName}: doesn't support ${operation}`);
          continue;
        }

        // Try executing the operation
        console.log(`[fallback-chain] Attempting ${operation} with ${providerName} (attempt ${i + 1}/${this.providers.length})`);
        const result = await operationFn(provider, ...args);

        // Success! Return the result
        console.log(`[fallback-chain] ✓ Success with ${providerName}`);
        return {
          success: true,
          provider: providerName,
          result,
          attemptedProviders: errors.map(e => e.provider).concat(providerName)
        };
      } catch (error) {
        errors.push({ provider: providerName, error: error.message });
        console.log(`[fallback-chain] ✗ Failed with ${providerName}: ${error.message}`);

        // If this is not the last provider, try the next one
        if (i < this.providers.length - 1) {
          console.log(`[fallback-chain] Falling back to next provider...`);
          continue;
        }
      }
    }

    // All providers failed
    const failureMessage = errors.map(e => `${e.provider}: ${e.error}`).join('; ');
    throw new Error(`All providers in chain failed for ${operation} operation. Errors: ${failureMessage}`);
  }

  /**
   * Execute a chat operation with fallback
   * @param {Array<Object>} messages - Chat messages
   * @param {Object} options - Chat options
   * @returns {Promise<Object>} Chat response
   */
  async executeChat(messages, options = {}) {
    const operationFn = async (provider, msgs, opts) => {
      // Import chat operation
      const { executeChat } = await import('../operations/chat.js');
      return executeChat(provider, msgs, opts);
    };

    const response = await this.execute('chat', operationFn, messages, options);
    return response.result;
  }

  /**
   * Execute an embeddings operation with fallback
   * @param {string|Array<string>} input - Text to embed
   * @param {Object} options - Embedding options
   * @returns {Promise<Object>} Embeddings response
   */
  async executeEmbeddings(input, options = {}) {
    const operationFn = async (provider, text, opts) => {
      // Import embeddings operation
      const { generateEmbedding } = await import('../operations/embeddings.js');
      return generateEmbedding(provider, text, opts);
    };

    const response = await this.execute('embeddings', operationFn, input, options);
    return response.result;
  }

  /**
   * Execute a text-to-speech operation with fallback
   * @param {string} text - Text to convert to speech
   * @param {Object} options - TTS options
   * @returns {Promise<Buffer>} Audio buffer
   */
  async executeTextToSpeech(text, options = {}) {
    const operationFn = async (provider, txt, opts) => {
      const { generateSpeech } = await import('../operations/text-to-speech.js');
      return generateSpeech(provider, txt, opts);
    };

    const response = await this.execute('text-to-speech', operationFn, text, options);
    return response.result;
  }

  /**
   * Execute a speech-to-text operation with fallback
   * @param {Buffer} audioBuffer - Audio data
   * @param {Object} options - STT options
   * @returns {Promise<Object>} Transcription result
   */
  async executeSpeechToText(audioBuffer, options = {}) {
    const operationFn = async (provider, audio, opts) => {
      const { transcribe } = await import('../operations/speech-to-text.js');
      return transcribe(provider, audio, opts);
    };

    const response = await this.execute('speech-to-text', operationFn, audioBuffer, options);
    return response.result;
  }

  /**
   * Execute a text-to-image operation with fallback
   * @param {string} prompt - Image generation prompt
   * @param {Object} options - Image generation options
   * @returns {Promise<Array>} Generated images
   */
  async executeTextToImage(prompt, options = {}) {
    const operationFn = async (provider, prmt, opts) => {
      const { generateImage } = await import('../operations/text-to-image.js');
      return generateImage(provider, prmt, opts);
    };

    const response = await this.execute('text-to-image', operationFn, prompt, options);
    return response.result;
  }

  /**
   * Execute an image classification operation with fallback
   * @param {string|Buffer} image - Image to classify
   * @param {Object} options - Classification options
   * @returns {Promise<Object>} Classification result
   */
  async executeImageClassification(image, options = {}) {
    const operationFn = async (provider, img, opts) => {
      const { classifyImage } = await import('../operations/image-classification.js');
      return classifyImage(provider, img, opts);
    };

    const response = await this.execute('image-classification', operationFn, image, options);
    return response.result;
  }

  /**
   * Execute a content moderation operation with fallback
   * @param {string|Buffer} content - Content to moderate
   * @param {Object} options - Moderation options
   * @returns {Promise<Object>} Moderation result
   */
  async executeContentModeration(content, options = {}) {
    const operationFn = async (provider, cnt, opts) => {
      const { moderateContent } = await import('../operations/content-moderation.js');
      return moderateContent(provider, cnt, opts);
    };

    const response = await this.execute('content-moderation', operationFn, content, options);
    return response.result;
  }

  /**
   * Get the number of providers in the chain
   * @returns {number} Number of providers
   */
  getProviderCount() {
    return this.providers.length;
  }

  /**
   * Get the names of providers in the chain
   * @returns {Array<string>} Provider names
   */
  getProviderNames() {
    return this.providers.map(p => p.constructor.name);
  }
}

/**
 * Create a fallback chain from provider manager
 * @param {ProviderManager} providerManager - The provider manager instance
 * @param {Array<string>} providerNames - Names of providers in fallback order
 * @param {Object} configs - Configuration for each provider {providerName: config}
 * @returns {Promise<FallbackChain>} Configured fallback chain
 */
export async function createFallbackChain(providerManager, providerNames, configs = {}) {
  if (!providerNames || !Array.isArray(providerNames) || providerNames.length === 0) {
    throw new Error('createFallbackChain requires an array of provider names');
  }

  const providers = [];

  for (const name of providerNames) {
    try {
      const config = configs[name] || {};
      const provider = await providerManager.loadProvider(name, config);
      providers.push(provider);
    } catch (error) {
      console.warn(`[fallback-chain] Could not load provider ${name}: ${error.message}`);
      // Continue loading other providers
    }
  }

  if (providers.length === 0) {
    throw new Error('Could not load any providers for fallback chain');
  }

  return new FallbackChain(providers);
}

export default FallbackChain;
