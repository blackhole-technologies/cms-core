/**
 * Image Classification Operation
 *
 * Provides image analysis and classification functionality.
 * Analyzes images and returns labels/categories with confidence scores.
 *
 * WHY THIS EXISTS:
 * Image classification enables AI-powered visual understanding:
 * - Automatic image tagging and categorization
 * - Content organization (sort photos by subject)
 * - Accessibility (alt text generation)
 * - Content moderation (identify inappropriate images)
 * - Search and discovery (find images by content)
 * - Quality control (detect defects in products)
 *
 * Different providers offer different capabilities:
 * - Object detection (what's in the image)
 * - Scene classification (indoor, outdoor, nature)
 * - Concept tagging (emotions, activities, styles)
 * - OCR (text extraction from images)
 * - Confidence scoring (how certain the model is)
 */

/**
 * Classify an image and return labels with confidence scores
 *
 * @param {AIProviderInterface} provider - The AI provider instance
 * @param {Buffer|string} image - Image data (Buffer) or base64 string
 * @param {Object} options - Classification options
 * @param {string} [options.model] - Model to use for classification
 * @param {number} [options.maxLabels=10] - Maximum number of labels to return
 * @param {number} [options.minConfidence=0.5] - Minimum confidence threshold (0-1)
 * @param {string} [options.prompt] - Optional prompt to guide classification
 * @param {Object} [options.context] - Boot context with services (for logging)
 * @returns {Promise<Object>} Classification result with labels and scores
 */
export async function classifyImage(provider, image, options = {}) {
  // Validate inputs
  if (!provider) {
    throw new Error('Provider is required');
  }

  if (!image) {
    throw new Error('Image is required');
  }

  // WHY VALIDATE IMAGE FORMAT:
  // Must be Buffer or base64 string
  if (!Buffer.isBuffer(image) && typeof image !== 'string') {
    throw new Error('Image must be a Buffer or base64 string');
  }

  // WHY CHECK USABILITY:
  // Provider might not be configured or might lack API keys
  const usable = await provider.isUsable();
  if (!usable) {
    throw new Error(`Provider ${provider.pluginId} is not usable (check configuration)`);
  }

  // WHY CHECK SUPPORTED OPERATIONS:
  // Not all providers support image classification
  const operations = await provider.getSupportedOperations();
  if (!operations.includes('image-classification')) {
    throw new Error(`Provider ${provider.pluginId} does not support image-classification operation`);
  }

  // Extract options with defaults
  const maxLabels = options.maxLabels || 10;
  const minConfidence = options.minConfidence !== undefined ? options.minConfidence : 0.5;
  const prompt = options.prompt || 'What objects, scenes, and concepts are in this image? Provide a detailed list.';

  // Validate parameters
  if (maxLabels < 1 || maxLabels > 100) {
    throw new Error('maxLabels must be between 1 and 100');
  }

  if (minConfidence < 0 || minConfidence > 1) {
    throw new Error('minConfidence must be between 0 and 1');
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
      const classificationModel = models.find(m => m.operations.includes('image-classification'));
      if (!classificationModel) {
        throw new Error(`Provider ${provider.pluginId} has no image-classification models available`);
      }
      model = classificationModel.id;
    }

    // WHY CALL PROVIDER METHOD:
    // Provider handles API-specific details
    const result = await provider.classifyImage(image, model, {
      maxLabels,
      minConfidence,
      prompt,
    });

    // WHY STANDARDIZE OUTPUT:
    // Ensure consistent format across providers
    const normalizedResult = {
      labels: Array.isArray(result.labels) ? result.labels : [],
      model: result.model || model,
      imageSize: result.imageSize || null,
    };

    // WHY FILTER BY CONFIDENCE:
    // Remove labels below threshold
    normalizedResult.labels = normalizedResult.labels.filter(
      label => label.confidence >= minConfidence
    );

    // WHY LIMIT RESULTS:
    // Cap at maxLabels to avoid overwhelming output
    normalizedResult.labels = normalizedResult.labels.slice(0, maxLabels);

    // WHY SORT BY CONFIDENCE:
    // Most confident predictions first
    normalizedResult.labels.sort((a, b) => b.confidence - a.confidence);

    // Log success to ai-stats
    if (stats) {
      const responseTime = Date.now() - startTime;
      const cost = calculateCost(provider.pluginId, model);

      stats.log({
        provider: provider.pluginId,
        operation: 'image-classification',
        model,
        timestamp: new Date().toISOString(),
        status: 'success',
        labelCount: normalizedResult.labels.length,
        responseTime,
        cost,
      });
    }

    return normalizedResult;

  } catch (error) {
    // WHY CHECK FOR INVALID IMAGE:
    // Image might be corrupted or unsupported format
    const isImageError = error.message?.toLowerCase().includes('invalid image')
      || error.message?.toLowerCase().includes('unsupported format')
      || error.message?.toLowerCase().includes('corrupted');

    // Log error to ai-stats
    if (stats) {
      const responseTime = Date.now() - startTime;
      stats.log({
        provider: provider.pluginId,
        operation: 'image-classification',
        model: options.model || 'unknown',
        timestamp: new Date().toISOString(),
        status: isImageError ? 'invalid_image' : 'error',
        error: error.message,
        responseTime,
      });
    }

    throw error;
  }
}

/**
 * Calculate cost for image classification operation
 *
 * WHY THIS FUNCTION:
 * Different providers charge differently:
 * - OpenAI GPT-4 Vision: Based on token usage (image + text)
 * - Google Vision API: Per image (~$1.50 per 1000)
 * - Amazon Rekognition: Per image (~$1.00 per 1000)
 * - Local models (Ollama): free
 *
 * @param {string} providerId - Provider identifier
 * @param {string} model - Model identifier
 * @returns {number} Estimated cost in USD
 * @private
 */
function calculateCost(providerId, model) {
  if (providerId === 'ollama') {
    return 0; // Local models are free
  }

  if (providerId === 'openai') {
    // GPT-4 Vision uses token-based pricing
    // Average image classification: ~1000 tokens
    // GPT-4 Vision: ~$0.01 per request (rough estimate)
    return 0.01;
  }

  // Unknown provider/model - estimate conservatively
  return 0.015;
}

/**
 * Convenience wrapper for classifying a single image with top labels
 *
 * @param {AIProviderInterface} provider - The AI provider instance
 * @param {Buffer|string} image - Image data
 * @param {number} topK - Number of top labels to return
 * @param {Object} options - Additional options
 * @returns {Promise<Array<Object>>} Top K labels sorted by confidence
 */
export async function classifyImageTopK(provider, image, topK = 5, options = {}) {
  const result = await classifyImage(provider, image, { ...options, maxLabels: topK });
  return result.labels;
}

/**
 * Check if image contains specific objects or concepts
 *
 * @param {AIProviderInterface} provider - The AI provider instance
 * @param {Buffer|string} image - Image data
 * @param {Array<string>} targetLabels - Labels to look for
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Detection result with matched labels
 */
export async function detectObjects(provider, image, targetLabels, options = {}) {
  if (!Array.isArray(targetLabels) || targetLabels.length === 0) {
    throw new Error('targetLabels must be a non-empty array');
  }

  const customPrompt = `Does this image contain any of these: ${targetLabels.join(', ')}? List all that are present with confidence scores.`;

  const result = await classifyImage(provider, image, {
    ...options,
    prompt: customPrompt,
    maxLabels: targetLabels.length,
  });

  // WHY FILTER MATCHES:
  // Only return labels that match target list
  const matches = result.labels.filter(label =>
    targetLabels.some(target =>
      label.name.toLowerCase().includes(target.toLowerCase()) ||
      target.toLowerCase().includes(label.name.toLowerCase())
    )
  );

  return {
    found: matches.length > 0,
    matches,
    model: result.model,
  };
}
