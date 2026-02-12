/**
 * Content Moderation Operation
 *
 * Provides content moderation functionality for text and images.
 * Analyzes content for unsafe or inappropriate material.
 *
 * WHY THIS EXISTS:
 * Content moderation protects users and platforms:
 * - User safety (filter harmful content)
 * - Legal compliance (COPPA, GDPR, local laws)
 * - Community standards (enforce platform rules)
 * - Brand protection (prevent reputation damage)
 * - Automated review (scale human moderation)
 *
 * Moderation categories typically include:
 * - Hate speech and harassment
 * - Violence and graphic content
 * - Sexual content (explicit, suggestive)
 * - Self-harm content
 * - Illegal activities
 * - Spam and scams
 *
 * Different providers offer different capabilities:
 * - Text moderation (profanity, toxicity, hate speech)
 * - Image moderation (nudity, violence, disturbing)
 * - Multi-category scoring (granular feedback)
 * - Severity levels (warning vs block)
 * - False positive rates (precision vs recall)
 */

/**
 * Moderate content (text or image) for unsafe material
 *
 * @param {AIProviderInterface} provider - The AI provider instance
 * @param {string|Buffer} content - Text string or image Buffer
 * @param {Object} options - Moderation options
 * @param {string} [options.model] - Model to use for moderation
 * @param {Array<string>} [options.categories] - Specific categories to check
 * @param {number} [options.threshold=0.5] - Threshold for flagging (0-1)
 * @param {string} [options.contentType='text'] - 'text' or 'image'
 * @param {Object} [options.context] - Boot context with services (for logging)
 * @returns {Promise<Object>} Moderation result with flags and scores
 */
export async function moderateContent(provider, content, options = {}) {
  // Validate inputs
  if (!provider) {
    throw new Error('Provider is required');
  }

  if (!content) {
    throw new Error('Content is required');
  }

  // WHY DETECT CONTENT TYPE:
  // Different APIs for text vs images
  const contentType = options.contentType || (Buffer.isBuffer(content) ? 'image' : 'text');

  if (contentType === 'text' && typeof content !== 'string') {
    throw new Error('Text content must be a string');
  }

  if (contentType === 'image' && !Buffer.isBuffer(content) && typeof content !== 'string') {
    throw new Error('Image content must be a Buffer or base64 string');
  }

  // WHY CHECK USABILITY:
  // Provider might not be configured or might lack API keys
  const usable = await provider.isUsable();
  if (!usable) {
    throw new Error(`Provider ${provider.pluginId} is not usable (check configuration)`);
  }

  // WHY CHECK SUPPORTED OPERATIONS:
  // Not all providers support content moderation
  const operations = await provider.getSupportedOperations();
  if (!operations.includes('content-moderation')) {
    throw new Error(`Provider ${provider.pluginId} does not support content-moderation operation`);
  }

  // Extract options with defaults
  const threshold = options.threshold !== undefined ? options.threshold : 0.5;
  const categories = options.categories || [
    'hate',
    'hate/threatening',
    'harassment',
    'harassment/threatening',
    'self-harm',
    'self-harm/intent',
    'self-harm/instructions',
    'sexual',
    'sexual/minors',
    'violence',
    'violence/graphic',
  ];

  // Validate threshold
  if (threshold < 0 || threshold > 1) {
    throw new Error('threshold must be between 0 and 1');
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
      const moderationModel = models.find(m => m.operations.includes('content-moderation'));
      if (!moderationModel) {
        throw new Error(`Provider ${provider.pluginId} has no content-moderation models available`);
      }
      model = moderationModel.id;
    }

    // WHY CALL PROVIDER METHOD:
    // Provider handles API-specific details
    const result = await provider.moderateContent(content, model, {
      contentType,
      categories,
      threshold,
    });

    // WHY STANDARDIZE OUTPUT:
    // Ensure consistent format across providers
    const normalizedResult = {
      flagged: result.flagged || false,
      categories: result.categories || {},
      categoryScores: result.categoryScores || {},
      model: result.model || model,
      contentType,
    };

    // WHY DETERMINE SEVERITY:
    // Provide actionable guidance
    const maxScore = Math.max(...Object.values(normalizedResult.categoryScores));
    const flaggedCategories = Object.keys(normalizedResult.categories).filter(
      cat => normalizedResult.categories[cat]
    );

    normalizedResult.severity = determineSeverity(maxScore, flaggedCategories);
    normalizedResult.action = determineAction(normalizedResult.severity);

    // Log success to ai-stats
    if (stats) {
      const responseTime = Date.now() - startTime;
      const cost = calculateCost(provider.pluginId, model, contentType);

      stats.log({
        provider: provider.pluginId,
        operation: 'content-moderation',
        model,
        timestamp: new Date().toISOString(),
        status: 'success',
        flagged: normalizedResult.flagged,
        severity: normalizedResult.severity,
        contentType,
        responseTime,
        cost,
      });
    }

    return normalizedResult;

  } catch (error) {
    // WHY CHECK FOR UNSUPPORTED CONTENT:
    // Content might be in unsupported format
    const isContentError = error.message?.toLowerCase().includes('unsupported content')
      || error.message?.toLowerCase().includes('invalid format')
      || error.message?.toLowerCase().includes('content type');

    // Log error to ai-stats
    if (stats) {
      const responseTime = Date.now() - startTime;
      stats.log({
        provider: provider.pluginId,
        operation: 'content-moderation',
        model: options.model || 'unknown',
        timestamp: new Date().toISOString(),
        status: isContentError ? 'unsupported_content' : 'error',
        error: error.message,
        contentType,
        responseTime,
      });
    }

    throw error;
  }
}

/**
 * Determine severity level based on scores and categories
 *
 * WHY THIS FUNCTION:
 * Provides actionable severity levels for content policy enforcement
 *
 * @param {number} maxScore - Highest category score
 * @param {Array<string>} flaggedCategories - Categories that were flagged
 * @returns {string} Severity level: 'none', 'low', 'medium', 'high', 'critical'
 * @private
 */
function determineSeverity(maxScore, flaggedCategories) {
  if (flaggedCategories.length === 0 || maxScore < 0.5) {
    return 'none';
  }

  // WHY CHECK FOR CRITICAL CATEGORIES:
  // Some content requires immediate action
  const criticalCategories = ['sexual/minors', 'self-harm/instructions', 'violence/graphic'];
  const hasCritical = flaggedCategories.some(cat => criticalCategories.includes(cat));

  if (hasCritical || maxScore >= 0.9) {
    return 'critical';
  }

  if (maxScore >= 0.8) {
    return 'high';
  }

  if (maxScore >= 0.65) {
    return 'medium';
  }

  return 'low';
}

/**
 * Determine recommended action based on severity
 *
 * WHY THIS FUNCTION:
 * Provides clear guidance for content policy enforcement
 *
 * @param {string} severity - Severity level
 * @returns {string} Recommended action
 * @private
 */
function determineAction(severity) {
  const actions = {
    none: 'allow',
    low: 'warn',
    medium: 'review',
    high: 'block',
    critical: 'block_and_report',
  };

  return actions[severity] || 'review';
}

/**
 * Calculate cost for content moderation operation
 *
 * WHY THIS FUNCTION:
 * Different providers charge differently:
 * - OpenAI Moderation API: Free (as of Feb 2026)
 * - Google Perspective API: Free up to quota
 * - Amazon Rekognition: Per image (~$1.00 per 1000)
 * - Local models (Ollama): free
 *
 * @param {string} providerId - Provider identifier
 * @param {string} model - Model identifier
 * @param {string} contentType - 'text' or 'image'
 * @returns {number} Estimated cost in USD
 * @private
 */
function calculateCost(providerId, model, contentType) {
  if (providerId === 'ollama') {
    return 0; // Local models are free
  }

  if (providerId === 'openai') {
    // OpenAI moderation API is free
    return 0;
  }

  // Unknown provider/model - estimate conservatively
  return contentType === 'image' ? 0.001 : 0.0001;
}

/**
 * Convenience wrapper for text moderation
 *
 * @param {AIProviderInterface} provider - The AI provider instance
 * @param {string} text - Text to moderate
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Moderation result
 */
export async function moderateText(provider, text, options = {}) {
  if (typeof text !== 'string') {
    throw new Error('Text must be a string');
  }

  return moderateContent(provider, text, { ...options, contentType: 'text' });
}

/**
 * Convenience wrapper for image moderation
 *
 * @param {AIProviderInterface} provider - The AI provider instance
 * @param {Buffer|string} image - Image to moderate
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Moderation result
 */
export async function moderateImage(provider, image, options = {}) {
  if (!Buffer.isBuffer(image) && typeof image !== 'string') {
    throw new Error('Image must be a Buffer or base64 string');
  }

  return moderateContent(provider, image, { ...options, contentType: 'image' });
}

/**
 * Check if content is safe (not flagged)
 *
 * @param {AIProviderInterface} provider - The AI provider instance
 * @param {string|Buffer} content - Content to check
 * @param {Object} options - Additional options
 * @returns {Promise<boolean>} True if content is safe
 */
export async function isSafeContent(provider, content, options = {}) {
  const result = await moderateContent(provider, content, options);
  return !result.flagged && result.severity === 'none';
}

/**
 * Batch moderate multiple content items
 *
 * @param {AIProviderInterface} provider - The AI provider instance
 * @param {Array<string|Buffer>} contents - Content items to moderate
 * @param {Object} options - Additional options
 * @returns {Promise<Array<Object>>} Array of moderation results
 */
export async function moderateBatch(provider, contents, options = {}) {
  if (!Array.isArray(contents)) {
    throw new Error('Contents must be an array');
  }

  // WHY MODERATE IN PARALLEL:
  // Faster for multiple items (but respect rate limits)
  const results = await Promise.all(
    contents.map(content => moderateContent(provider, content, options))
  );

  return results;
}
