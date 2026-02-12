/**
 * Text-to-Image Operation
 *
 * Provides image generation functionality from text prompts.
 * Supports size selection, style options, and quality settings.
 *
 * WHY THIS EXISTS:
 * Text-to-image enables AI-powered visual content creation:
 * - Automated illustration and artwork generation
 * - Marketing and advertising creative
 * - Concept visualization and prototyping
 * - Content personalization (dynamic images per user)
 * - Product mockups and variations
 *
 * Different providers offer different capabilities:
 * - Image resolution and quality
 * - Style control (realistic, artistic, cartoon)
 * - Speed (seconds to minutes per image)
 * - Content filtering and safety
 * - Cost per image
 */

/**
 * Generate an image from a text prompt
 *
 * @param {AIProviderInterface} provider - The AI provider instance
 * @param {string} prompt - Text description of desired image
 * @param {Object} options - Image generation options
 * @param {string} [options.model] - Model to use for generation
 * @param {string} [options.size='1024x1024'] - Image dimensions (e.g., '256x256', '512x512', '1024x1024', '1792x1024', '1024x1792')
 * @param {number} [options.n=1] - Number of images to generate (1-10)
 * @param {string} [options.quality='standard'] - Quality setting ('standard' or 'hd')
 * @param {string} [options.style] - Style hint (e.g., 'vivid', 'natural')
 * @param {string} [options.format='url'] - Return format ('url' or 'b64_json')
 * @param {Object} [options.context] - Boot context with services (for logging)
 * @returns {Promise<Array<Object>>} Array of image objects with url or b64_json
 */
export async function generateImage(provider, prompt, options = {}) {
  // Validate inputs
  if (!provider) {
    throw new Error('Provider is required');
  }

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new Error('Prompt must be a non-empty string');
  }

  // WHY CHECK USABILITY:
  // Provider might not be configured or might lack API keys
  const usable = await provider.isUsable();
  if (!usable) {
    throw new Error(`Provider ${provider.pluginId} is not usable (check configuration)`);
  }

  // WHY CHECK SUPPORTED OPERATIONS:
  // Not all providers support text-to-image (e.g., Anthropic doesn't have image generation)
  const operations = await provider.getSupportedOperations();
  if (!operations.includes('text-to-image')) {
    throw new Error(`Provider ${provider.pluginId} does not support text-to-image operation`);
  }

  // Extract options with defaults
  const size = options.size || '1024x1024';
  const n = options.n || 1;
  const quality = options.quality || 'standard';
  const style = options.style || undefined;
  const format = options.format || 'url';

  // Validate size format
  if (!isValidSize(size)) {
    throw new Error(`Invalid size format: ${size}. Expected format like '1024x1024'`);
  }

  // Validate n parameter
  if (n < 1 || n > 10) {
    throw new Error('Number of images (n) must be between 1 and 10');
  }

  // Validate quality
  if (quality !== 'standard' && quality !== 'hd') {
    throw new Error('Quality must be "standard" or "hd"');
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
      const imageModel = models.find(m => m.operations.includes('text-to-image'));
      if (!imageModel) {
        throw new Error(`Provider ${provider.pluginId} has no text-to-image models available`);
      }
      model = imageModel.id;
    }

    // WHY CALL PROVIDER METHOD:
    // Provider handles API-specific details (OpenAI uses /v1/images/generations)
    const images = await provider.textToImage(prompt, model, {
      size,
      n,
      quality,
      style,
      format,
    });

    // WHY STANDARDIZE OUTPUT:
    // Ensure output is always an array of image objects
    const normalizedImages = Array.isArray(images) ? images : [images];

    // Log success to ai-stats
    if (stats) {
      const responseTime = Date.now() - startTime;
      const cost = calculateCost(provider.pluginId, model, size, quality, n);

      stats.log({
        provider: provider.pluginId,
        operation: 'text-to-image',
        model,
        timestamp: new Date().toISOString(),
        status: 'success',
        promptLength: prompt.length,
        imageCount: normalizedImages.length,
        imageSize: size,
        imageQuality: quality,
        responseTime,
        cost,
      });
    }

    return normalizedImages;

  } catch (error) {
    // WHY CHECK FOR CONTENT POLICY VIOLATIONS:
    // Image generation can fail due to inappropriate prompts
    const isContentError = error.message?.toLowerCase().includes('content policy')
      || error.message?.toLowerCase().includes('safety')
      || error.message?.toLowerCase().includes('inappropriate');

    // Log error to ai-stats
    if (stats) {
      const responseTime = Date.now() - startTime;
      stats.log({
        provider: provider.pluginId,
        operation: 'text-to-image',
        model: options.model || 'unknown',
        timestamp: new Date().toISOString(),
        status: isContentError ? 'content_policy_violation' : 'error',
        error: error.message,
        responseTime,
      });
    }

    throw error;
  }
}

/**
 * Validate image size format
 *
 * WHY THIS FUNCTION:
 * Size must be in format like '1024x1024', '512x512', etc.
 * Common sizes for different providers:
 * - OpenAI DALL-E 3: 1024x1024, 1792x1024, 1024x1792
 * - OpenAI DALL-E 2: 256x256, 512x512, 1024x1024
 *
 * @param {string} size - Size string
 * @returns {boolean} True if valid
 * @private
 */
function isValidSize(size) {
  return /^\d+x\d+$/.test(size);
}

/**
 * Calculate cost for text-to-image operation
 *
 * WHY THIS FUNCTION:
 * Different providers charge differently:
 * - OpenAI DALL-E 3 standard 1024x1024: $0.040 per image
 * - OpenAI DALL-E 3 HD 1024x1024: $0.080 per image
 * - OpenAI DALL-E 3 standard 1024x1792/1792x1024: $0.080 per image
 * - OpenAI DALL-E 3 HD 1024x1792/1792x1024: $0.120 per image
 * - OpenAI DALL-E 2: $0.018 (256), $0.020 (512), $0.020 (1024)
 * - Local models (Ollama): free
 *
 * @param {string} providerId - Provider identifier
 * @param {string} model - Model identifier
 * @param {string} size - Image size (e.g., '1024x1024')
 * @param {string} quality - Quality setting ('standard' or 'hd')
 * @param {number} count - Number of images
 * @returns {number} Estimated cost in USD
 * @private
 */
function calculateCost(providerId, model, size, quality, count) {
  if (providerId === 'ollama') {
    return 0; // Local models are free
  }

  if (providerId === 'openai') {
    // Parse size dimensions
    const [width, height] = size.split('x').map(Number);
    const pixels = width * height;
    const isLarge = pixels > 1024 * 1024; // Larger than 1024x1024

    if (model === 'dall-e-3') {
      let costPerImage;
      if (isLarge) {
        // 1024x1792 or 1792x1024
        costPerImage = quality === 'hd' ? 0.120 : 0.080;
      } else {
        // 1024x1024
        costPerImage = quality === 'hd' ? 0.080 : 0.040;
      }
      return costPerImage * count;
    }

    if (model === 'dall-e-2') {
      if (pixels <= 256 * 256) return 0.018 * count;
      if (pixels <= 512 * 512) return 0.020 * count;
      return 0.020 * count;
    }
  }

  // Unknown provider/model - estimate conservatively
  return 0.050 * count;
}

/**
 * Convenience wrapper for generating a single image
 *
 * @param {AIProviderInterface} provider - The AI provider instance
 * @param {string} prompt - Text description
 * @param {Object} options - Image generation options
 * @returns {Promise<Object>} Single image object
 */
export async function generateSingleImage(provider, prompt, options = {}) {
  const images = await generateImage(provider, prompt, { ...options, n: 1 });
  return images[0];
}

/**
 * Convenience wrapper for generating multiple images
 *
 * @param {AIProviderInterface} provider - The AI provider instance
 * @param {string} prompt - Text description
 * @param {number} count - Number of images to generate (1-10)
 * @param {Object} options - Image generation options
 * @returns {Promise<Array<Object>>} Array of image objects
 */
export async function generateMultipleImages(provider, prompt, count, options = {}) {
  return generateImage(provider, prompt, { ...options, n: count });
}
