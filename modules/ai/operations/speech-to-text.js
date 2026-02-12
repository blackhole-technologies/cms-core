/**
 * Speech-to-Text Operation
 *
 * Provides speech recognition functionality to transcribe audio into text.
 * Supports multiple languages, audio formats, and optional timestamps.
 *
 * WHY THIS EXISTS:
 * Speech-to-text enables voice input and audio content processing:
 * - Voice commands and dictation
 * - Meeting and lecture transcription
 * - Accessibility (voice navigation for users with mobility impairments)
 * - Content indexing (make audio/video searchable)
 * - Subtitles and captions generation
 *
 * Different providers offer different capabilities:
 * - Languages supported
 * - Accuracy and WER (Word Error Rate)
 * - Real-time vs batch processing
 * - Timestamp precision
 * - Cost per minute
 */

/**
 * Transcribe audio to text
 *
 * @param {AIProviderInterface} provider - The AI provider instance
 * @param {Buffer} audioBuffer - Audio data as Buffer
 * @param {Object} options - Transcription options
 * @param {string} [options.model] - Model to use for transcription
 * @param {string} [options.language] - Language code (e.g., 'en', 'es', 'fr')
 * @param {string} [options.prompt] - Optional context to guide transcription
 * @param {boolean} [options.timestamps=false] - Include word-level timestamps (if supported)
 * @param {Object} [options.context] - Boot context with services (for logging)
 * @returns {Promise<Object>} Transcription result with text and optional timestamps
 */
export async function transcribe(provider, audioBuffer, options = {}) {
  // Validate inputs
  if (!provider) {
    throw new Error('Provider is required');
  }

  if (!audioBuffer || !Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
    throw new Error('Audio buffer is required and cannot be empty');
  }

  // WHY CHECK USABILITY:
  // Provider might not be configured or might lack API keys
  const usable = await provider.isUsable();
  if (!usable) {
    throw new Error(`Provider ${provider.pluginId} is not usable (check configuration)`);
  }

  // WHY CHECK SUPPORTED OPERATIONS:
  // Not all providers support speech-to-text
  const operations = await provider.getSupportedOperations();
  if (!operations.includes('speech-to-text')) {
    throw new Error(`Provider ${provider.pluginId} does not support speech-to-text operation`);
  }

  // Extract options
  const language = options.language || 'en';
  const prompt = options.prompt || undefined;
  const timestamps = options.timestamps || false;

  // Get ai-stats service for logging
  const stats = options.context?.container?.get('ai-stats');
  const startTime = Date.now();

  try {
    // WHY GET MODELS FIRST:
    // Need to determine which model to use if not specified
    let model = options.model;
    if (!model) {
      const models = await provider.getModels();
      const sttModel = models.find(m => m.operations.includes('speech-to-text'));
      if (!sttModel) {
        throw new Error(`Provider ${provider.pluginId} has no speech-to-text models available`);
      }
      model = sttModel.id;
    }

    // WHY CALL PROVIDER METHOD:
    // Provider handles API-specific details (OpenAI uses /v1/audio/transcriptions)
    const result = await provider.speechToText(audioBuffer, model, {
      language,
      prompt,
      timestamps,
    });

    // WHY STANDARDIZE OUTPUT:
    // Different providers return different formats, normalize to { text, ... }
    const transcription = typeof result === 'string'
      ? { text: result }
      : result;

    // Log success to ai-stats
    if (stats) {
      const responseTime = Date.now() - startTime;
      const audioDurationSec = estimateAudioDuration(audioBuffer.length);
      const cost = calculateCost(provider.pluginId, model, audioDurationSec);

      stats.log({
        provider: provider.pluginId,
        operation: 'speech-to-text',
        model,
        timestamp: new Date().toISOString(),
        status: 'success',
        inputBytes: audioBuffer.length,
        outputChars: transcription.text?.length || 0,
        audioDurationSec,
        responseTime,
        cost,
      });
    }

    return transcription;

  } catch (error) {
    // Log error to ai-stats
    if (stats) {
      const responseTime = Date.now() - startTime;
      stats.log({
        provider: provider.pluginId,
        operation: 'speech-to-text',
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
 * Estimate audio duration from buffer size
 *
 * WHY THIS FUNCTION:
 * We can't easily get actual duration without parsing audio headers,
 * so estimate based on typical compression ratios:
 * - MP3 128kbps: ~16KB per second
 * - Opus 64kbps: ~8KB per second
 * - WAV uncompressed: ~176KB per second
 *
 * Use conservative estimate (assume MP3-like compression)
 *
 * @param {number} bytes - Audio buffer size
 * @returns {number} Estimated duration in seconds
 * @private
 */
function estimateAudioDuration(bytes) {
  // Assume ~16KB per second (MP3 128kbps)
  const estimatedSeconds = bytes / (16 * 1024);
  return Math.max(1, Math.round(estimatedSeconds));
}

/**
 * Calculate cost for speech-to-text operation
 *
 * WHY THIS FUNCTION:
 * Different providers charge differently:
 * - OpenAI Whisper: $0.006 per minute
 * - Local models (Ollama): free
 *
 * @param {string} providerId - Provider identifier
 * @param {string} model - Model identifier
 * @param {number} durationSec - Audio duration in seconds
 * @returns {number} Estimated cost in USD
 * @private
 */
function calculateCost(providerId, model, durationSec) {
  if (providerId === 'ollama') {
    return 0; // Local models are free
  }

  if (providerId === 'openai') {
    // OpenAI Whisper pricing (as of 2024)
    const minutes = durationSec / 60;
    return minutes * 0.006; // $0.006 per minute
  }

  // Unknown provider - estimate conservatively
  const minutes = durationSec / 60;
  return minutes * 0.010;
}

/**
 * Convenience wrapper for transcribing a single audio file
 *
 * @param {AIProviderInterface} provider - The AI provider instance
 * @param {Buffer} audioBuffer - Audio data
 * @param {Object} options - Transcription options
 * @returns {Promise<Object>} Transcription result
 */
export async function transcribeSingle(provider, audioBuffer, options = {}) {
  return transcribe(provider, audioBuffer, options);
}
