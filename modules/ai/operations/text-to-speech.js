/**
 * Text-to-Speech Operation
 *
 * Provides text-to-speech functionality to convert text into spoken audio.
 * Supports voice selection, speed adjustment, and multiple audio formats.
 *
 * WHY THIS EXISTS:
 * Text-to-speech enables accessibility and audio content generation:
 * - Accessibility (screen readers, audio articles for visually impaired)
 * - Content creation (podcasts, audiobooks, voiceovers)
 * - Language learning (pronunciation examples)
 * - Notifications (spoken alerts and reminders)
 *
 * Different providers offer different voices with varying:
 * - Languages and accents
 * - Voice quality (natural vs robotic)
 * - Emotion and tone
 * - Cost per character
 */

/**
 * Generate speech audio from text
 *
 * @param {AIProviderInterface} provider - The AI provider instance
 * @param {string} text - Text to convert to speech
 * @param {Object} options - Speech generation options
 * @param {string} [options.model] - Model/voice engine to use
 * @param {string} [options.voice='alloy'] - Voice name (e.g., 'alloy', 'echo', 'nova')
 * @param {string} [options.format='mp3'] - Audio format (mp3, opus, aac, flac, wav, pcm)
 * @param {number} [options.speed=1.0] - Speech speed (0.25-4.0, 1.0 is normal)
 * @param {Object} [options.context] - Boot context with services (for logging)
 * @returns {Promise<Buffer>} Audio buffer in requested format
 */
export async function generateSpeech(provider, text, options = {}) {
  // Validate inputs
  if (!provider) {
    throw new Error('Provider is required');
  }

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Text must be a non-empty string');
  }

  // WHY CHECK USABILITY:
  // Provider might not be configured or might lack API keys
  const usable = await provider.isUsable();
  if (!usable) {
    throw new Error(`Provider ${provider.pluginId} is not usable (check configuration)`);
  }

  // WHY CHECK SUPPORTED OPERATIONS:
  // Not all providers support text-to-speech (e.g., Anthropic doesn't)
  const operations = await provider.getSupportedOperations();
  if (!operations.includes('text-to-speech')) {
    throw new Error(`Provider ${provider.pluginId} does not support text-to-speech operation`);
  }

  // Extract options
  const voice = options.voice || 'alloy';
  const format = options.format || 'mp3';
  const speed = options.speed || 1.0;

  // Validate speed range
  if (speed < 0.25 || speed > 4.0) {
    throw new Error('Speed must be between 0.25 and 4.0');
  }

  // Get ai-stats service for logging
  const stats = options.context?.container?.get('ai-stats');
  const startTime = Date.now();

  try {
    // WHY GET MODELS FIRST:
    // Need to determine which model to use if not specified
    let model = options.model;
    if (!model) {
      const models = await provider.getModels();
      const ttsModel = models.find(m => m.operations.includes('text-to-speech'));
      if (!ttsModel) {
        throw new Error(`Provider ${provider.pluginId} has no text-to-speech models available`);
      }
      model = ttsModel.id;
    }

    // WHY CALL PROVIDER METHOD:
    // Provider handles API-specific details (OpenAI uses /v1/audio/speech)
    const audioBuffer = await provider.textToSpeech(text, model, {
      voice,
      format,
      speed,
    });

    // Log success to ai-stats
    if (stats) {
      const responseTime = Date.now() - startTime;
      const cost = calculateCost(provider.pluginId, model, text.length);

      stats.log({
        provider: provider.pluginId,
        operation: 'text-to-speech',
        model,
        timestamp: new Date().toISOString(),
        status: 'success',
        inputChars: text.length,
        outputBytes: audioBuffer.length,
        responseTime,
        cost,
      });
    }

    return audioBuffer;

  } catch (error) {
    // Log error to ai-stats
    if (stats) {
      const responseTime = Date.now() - startTime;
      stats.log({
        provider: provider.pluginId,
        operation: 'text-to-speech',
        model: options.model || 'unknown',
        timestamp: new Date().toISOString(),
        status: 'error',
        error: error.message,
        responseTime,
      });
    }

    throw error;
  }
}

/**
 * Calculate cost for text-to-speech operation
 *
 * WHY THIS FUNCTION:
 * Different providers charge differently:
 * - OpenAI charges per character (~$0.015 per 1000 chars for tts-1)
 * - Local models (Ollama) are free
 *
 * @param {string} providerId - Provider identifier
 * @param {string} model - Model identifier
 * @param {number} charCount - Number of characters
 * @returns {number} Estimated cost in USD
 * @private
 */
function calculateCost(providerId, model, charCount) {
  if (providerId === 'ollama') {
    return 0; // Local models are free
  }

  if (providerId === 'openai') {
    // OpenAI pricing (as of 2024)
    if (model.startsWith('tts-1-hd')) {
      return (charCount / 1000) * 0.030; // $0.030 per 1K chars
    }
    if (model.startsWith('tts-1')) {
      return (charCount / 1000) * 0.015; // $0.015 per 1K chars
    }
  }

  // Unknown model/provider - estimate conservatively
  return (charCount / 1000) * 0.020;
}

/**
 * Convenience wrapper for generating speech from a single text input
 *
 * @param {AIProviderInterface} provider - The AI provider instance
 * @param {string} text - Text to convert to speech
 * @param {Object} options - Speech generation options
 * @returns {Promise<Buffer>} Audio buffer
 */
export async function generateSingleSpeech(provider, text, options = {}) {
  return generateSpeech(provider, text, options);
}
