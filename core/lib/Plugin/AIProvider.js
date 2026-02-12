/**
 * @file
 * AI Provider Plugin Base Class
 *
 * WHY THIS EXISTS:
 * Provides a standard interface for all AI provider plugins (OpenAI, Anthropic, Ollama, etc.).
 * Defines the contract that all AI providers must implement including:
 * - Model discovery (getModels)
 * - Capability checking (isUsable, getSupportedOperations)
 * - Operation execution (chat, embeddings, text-to-speech, etc.)
 *
 * DESIGN DECISIONS:
 * - Extends PluginBase for standard plugin lifecycle
 * - Abstract methods throw errors to enforce implementation
 * - Returns promises for async operations (API calls)
 * - Streaming support via callback pattern
 *
 * USAGE:
 *   class OpenAIProvider extends AIProvider {
 *     async getModels() { return [...]; }
 *     async isUsable() { return true; }
 *     // ... implement other methods
 *   }
 */

import { PluginBase } from './PluginBase.js';

export class AIProvider extends PluginBase {
  /**
   * Get available models from this provider.
   *
   * WHY: Each provider offers different models with different capabilities.
   * Returns model metadata so the system can present choices to users
   * and route requests to appropriate models.
   *
   * @returns {Promise<Array<{id: string, name: string, operations: string[]}>>}
   *   Array of model objects with:
   *   - id: Model identifier used in API calls (e.g., 'gpt-4', 'claude-sonnet-4')
   *   - name: Human-readable name for UI display
   *   - operations: Array of supported operations (e.g., ['chat', 'embeddings'])
   *
   * @example
   *   const models = await provider.getModels();
   *   // [
   *   //   { id: 'gpt-4', name: 'GPT-4', operations: ['chat'] },
   *   //   { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', operations: ['chat'] }
   *   // ]
   */
  async getModels() {
    throw new Error(`AIProvider.getModels() must be implemented by ${this.getPluginId()}`);
  }

  /**
   * Check if this provider is usable (configured with API keys, etc.).
   *
   * WHY: Providers need API keys or other configuration to function.
   * This check allows the system to only show/use providers that are
   * properly configured. Returns false if API key missing or invalid.
   *
   * @returns {Promise<boolean>} True if provider is ready to use
   *
   * @example
   *   if (await provider.isUsable()) {
   *     // Use this provider
   *   } else {
   *     // Show "Please configure API key" message
   *   }
   */
  async isUsable() {
    throw new Error(`AIProvider.isUsable() must be implemented by ${this.getPluginId()}`);
  }

  /**
   * Get list of operations this provider supports.
   *
   * WHY: Not all providers support all operations. OpenAI has chat and embeddings,
   * but maybe not speech-to-text. Allows system to route requests to providers
   * that actually support the requested operation.
   *
   * @returns {Promise<string[]>} Array of supported operation names
   *   Valid operations: 'chat', 'embeddings', 'text-to-speech', 'speech-to-text',
   *   'text-to-image', 'image-classification', 'content-moderation'
   *
   * @example
   *   const ops = await provider.getSupportedOperations();
   *   // ['chat', 'embeddings', 'text-to-image']
   */
  async getSupportedOperations() {
    throw new Error(`AIProvider.getSupportedOperations() must be implemented by ${this.getPluginId()}`);
  }

  /**
   * Execute a chat operation.
   *
   * WHY: Chat is the most common AI operation - conversational interaction
   * with the model. Supports streaming for real-time response display.
   *
   * @param {Array<{role: string, content: string}>} messages - Conversation history
   *   Each message has:
   *   - role: 'system' | 'user' | 'assistant'
   *   - content: Message text
   * @param {string} model - Model ID to use (from getModels())
   * @param {Object} options - Optional parameters
   * @param {boolean} [options.stream=false] - Enable streaming responses
   * @param {Function} [options.onChunk] - Callback for streaming chunks: (text) => void
   * @param {number} [options.temperature=0.7] - Sampling temperature (0-2)
   * @param {number} [options.maxTokens=1024] - Maximum response length
   *
   * @returns {Promise<{role: string, content: string, usage?: Object}>}
   *   Assistant's response with optional usage stats
   *
   * @example
   *   // Non-streaming
   *   const response = await provider.chat([
   *     { role: 'system', content: 'You are helpful.' },
   *     { role: 'user', content: 'Hello!' }
   *   ], 'gpt-4');
   *   console.log(response.content); // "Hello! How can I help you today?"
   *
   * @example
   *   // Streaming
   *   const response = await provider.chat(messages, 'gpt-4', {
   *     stream: true,
   *     onChunk: (text) => process.stdout.write(text)
   *   });
   */
  async chat(messages, model, options = {}) {
    throw new Error(`AIProvider.chat() must be implemented by ${this.getPluginId()}`);
  }

  /**
   * Generate embeddings (vector representations) for text.
   *
   * WHY: Embeddings enable semantic search, similarity matching, and RAG.
   * Converts text into high-dimensional vectors that capture meaning.
   *
   * @param {string|string[]} text - Text to embed (single string or array)
   * @param {string} model - Model ID to use (from getModels())
   *
   * @returns {Promise<{embeddings: Float64Array[], dimensions: number}>}
   *   - embeddings: Array of vectors (one per input text)
   *   - dimensions: Vector dimensionality (e.g., 1536 for OpenAI ada-002)
   *
   * @example
   *   const result = await provider.embed('Hello world', 'text-embedding-ada-002');
   *   console.log(result.embeddings[0].length); // 1536
   *   console.log(result.dimensions); // 1536
   */
  async embed(text, model, options = {}) {
    throw new Error(`AIProvider.embed() must be implemented by ${this.getPluginId()}`);
  }

  /**
   * Convert text to speech (TTS).
   *
   * WHY: Generate audio from text for accessibility, voice assistants, etc.
   *
   * @param {string} text - Text to convert to speech
   * @param {string} model - Model/voice ID to use
   * @param {Object} options - Optional parameters
   * @param {string} [options.voice] - Voice preset (e.g., 'alloy', 'nova')
   * @param {string} [options.format='mp3'] - Audio format (mp3, opus, aac, flac)
   * @param {number} [options.speed=1.0] - Speech speed (0.25-4.0)
   *
   * @returns {Promise<Buffer>} Audio data as Buffer
   */
  async textToSpeech(text, model, options = {}) {
    throw new Error(`AIProvider.textToSpeech() must be implemented by ${this.getPluginId()}`);
  }

  /**
   * Convert speech to text (STT).
   *
   * WHY: Transcribe audio for voice commands, captions, etc.
   *
   * @param {Buffer} audio - Audio data (supported formats: mp3, mp4, mpeg, mpga, m4a, wav, webm)
   * @param {string} model - Model ID to use
   * @param {Object} options - Optional parameters
   * @param {string} [options.language] - Language code (e.g., 'en', 'es')
   * @param {string} [options.prompt] - Optional context to improve accuracy
   *
   * @returns {Promise<{text: string, language?: string}>}
   *   Transcribed text and detected language
   */
  async speechToText(audio, model, options = {}) {
    throw new Error(`AIProvider.speechToText() must be implemented by ${this.getPluginId()}`);
  }

  /**
   * Generate an image from text prompt.
   *
   * WHY: Create visual content from descriptions (DALL-E, Stable Diffusion, etc.)
   *
   * @param {string} prompt - Text description of desired image
   * @param {string} model - Model ID to use
   * @param {Object} options - Optional parameters
   * @param {string} [options.size='1024x1024'] - Image dimensions
   * @param {number} [options.n=1] - Number of images to generate
   * @param {string} [options.quality='standard'] - Image quality (standard, hd)
   * @param {string} [options.style] - Style preset if supported
   *
   * @returns {Promise<Array<{url?: string, b64_json?: string}>>}
   *   Array of generated images (either URL or base64-encoded)
   */
  async textToImage(prompt, model, options = {}) {
    throw new Error(`AIProvider.textToImage() must be implemented by ${this.getPluginId()}`);
  }

  /**
   * Classify or analyze image content.
   *
   * WHY: Identify objects, scenes, text in images for tagging, moderation, alt text.
   *
   * @param {Buffer|string} image - Image data (Buffer) or URL
   * @param {string} model - Model ID to use
   * @param {Object} options - Optional parameters
   * @param {string[]} [options.labels] - Specific labels to check for
   *
   * @returns {Promise<{labels: Array<{name: string, confidence: number}>}>}
   *   Detected labels with confidence scores (0-1)
   */
  async classifyImage(image, model, options = {}) {
    throw new Error(`AIProvider.classifyImage() must be implemented by ${this.getPluginId()}`);
  }

  /**
   * Moderate content for policy violations.
   *
   * WHY: Detect harmful content (hate speech, violence, etc.) for safety.
   *
   * @param {string} content - Text or image URL to moderate
   * @param {string} model - Model ID to use
   *
   * @returns {Promise<{flagged: boolean, categories: Object<string, boolean>, scores: Object<string, number>}>}
   *   - flagged: True if content violates policies
   *   - categories: Specific violation categories (hate, violence, sexual, etc.)
   *   - scores: Confidence scores for each category (0-1)
   */
  async moderateContent(content, model, options = {}) {
    throw new Error(`AIProvider.moderateContent() must be implemented by ${this.getPluginId()}`);
  }

  /**
   * Get provider-specific configuration form.
   *
   * WHY: Each provider needs different settings (API keys, endpoints, etc.).
   * Returns a FormAPI-compatible render array for the admin UI.
   *
   * @param {Object} form - Current form state
   * @returns {Object} Enhanced form with provider settings fields
   *
   * @example
   *   buildConfigurationForm(form) {
   *     form.apiKey = {
   *       '#type': 'textfield',
   *       '#title': 'API Key',
   *       '#required': true,
   *       '#description': 'Get your API key from platform.openai.com'
   *     };
   *     return form;
   *   }
   */
  buildConfigurationForm(form = {}) {
    // WHY: Default returns form unchanged. Providers override to add their fields.
    return form;
  }
}
