/**
 * Embeddings Operation
 *
 * Provides text-to-vector embedding functionality.
 * Converts text inputs into numerical vector representations
 * for semantic search, similarity matching, and clustering.
 *
 * WHY THIS EXISTS:
 * Embeddings are the foundation for semantic AI features:
 * - Semantic search (find similar content by meaning, not keywords)
 * - Content recommendations (suggest related articles/products)
 * - Clustering (group similar items automatically)
 * - Classification (categorize content by semantic similarity)
 *
 * Different providers offer different embedding models with varying:
 * - Dimensions (768, 1024, 1536, etc.)
 * - Quality (semantic understanding depth)
 * - Cost (tokens per embedding)
 * - Speed (latency per request)
 */

/**
 * Generate embeddings for text input
 *
 * @param {AIProviderInterface} provider - The AI provider instance
 * @param {string|Array<string>} text - Text to embed (single string or array)
 * @param {Object} options - Embedding options
 * @param {string} [options.model] - Model to use for embeddings
 * @param {Object} [options.context] - Boot context with services (for logging)
 * @returns {Promise<Object>} Embedding result with vectors and dimensions
 */
export async function generateEmbedding(provider, text, options = {}) {
  // Validate inputs
  if (!provider) {
    throw new Error('Provider is required');
  }

  if (!text || (typeof text !== 'string' && !Array.isArray(text))) {
    throw new Error('Text must be a string or array of strings');
  }

  if (typeof text === 'string' && text.trim().length === 0) {
    throw new Error('Text cannot be empty');
  }

  if (Array.isArray(text)) {
    if (text.length === 0) {
      throw new Error('Text array cannot be empty');
    }
    for (const item of text) {
      if (typeof item !== 'string' || item.trim().length === 0) {
        throw new Error('All text items must be non-empty strings');
      }
    }
  }

  // Check if provider supports embeddings operation
  const supportedOps = provider.getSupportedOperations();
  if (!supportedOps.includes('embeddings')) {
    throw new Error(`Provider ${provider.constructor.name} does not support embeddings operation`);
  }

  // Check if provider is usable
  const isUsable = await provider.isUsable();
  if (!isUsable) {
    throw new Error(`Provider ${provider.constructor.name} is not currently usable`);
  }

  const startTime = Date.now();
  const providerName = provider.constructor.name.replace('Provider', '').toLowerCase();

  try {
    // Call provider's embed method
    const result = await provider.embed(text, options.model, options);
    const responseTime = Date.now() - startTime;

    // Validate response format
    if (!result || !result.embeddings) {
      throw new Error('Provider returned invalid embedding response');
    }

    if (!Array.isArray(result.embeddings)) {
      throw new Error('Embeddings must be an array');
    }

    // Log to ai-stats service if available
    if (options.context?.services) {
      try {
        const aiStats = options.context.services.get('ai-stats');
        if (aiStats) {
          const textCount = Array.isArray(text) ? text.length : 1;
          const totalTokens = result.usage?.total_tokens || (textCount * 100); // Estimate if not provided

          aiStats.log({
            provider: providerName,
            operation: 'embeddings',
            model: result.model || options.model,
            tokensIn: totalTokens,
            tokensOut: 0,
            cost: calculateEmbeddingCost(providerName, result.model || options.model, totalTokens),
            responseTime,
            status: 'success'
          });
        }
      } catch (logError) {
        console.error('[embeddings] Failed to log usage:', logError.message);
      }
    }

    // Return standardized format
    return {
      embeddings: result.embeddings,
      dimensions: result.dimensions || result.embeddings[0]?.length || 0,
      model: result.model || options.model,
      usage: result.usage || null
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;

    // Log error to ai-stats
    if (options.context?.services) {
      try {
        const aiStats = options.context.services.get('ai-stats');
        if (aiStats) {
          aiStats.log({
            provider: providerName,
            operation: 'embeddings',
            model: options.model,
            tokensIn: 0,
            tokensOut: 0,
            cost: 0,
            responseTime,
            status: 'error',
            error: error.message
          });
        }
      } catch (logError) {
        // Ignore logging errors
      }
    }

    throw new Error(`Embeddings operation failed: ${error.message}`);
  }
}

/**
 * Generate a single embedding vector
 * Convenience wrapper for single text input
 *
 * @param {AIProviderInterface} provider - The AI provider instance
 * @param {string} text - Text to embed
 * @param {Object} options - Embedding options
 * @returns {Promise<Float64Array>} Single embedding vector
 */
export async function generateSingleEmbedding(provider, text, options = {}) {
  if (typeof text !== 'string') {
    throw new Error('Text must be a string for single embedding');
  }

  const result = await generateEmbedding(provider, text, options);
  return result.embeddings[0];
}

/**
 * Generate multiple embeddings in batch
 * More efficient than calling generateSingleEmbedding repeatedly
 *
 * @param {AIProviderInterface} provider - The AI provider instance
 * @param {Array<string>} texts - Array of texts to embed
 * @param {Object} options - Embedding options
 * @returns {Promise<Array<Float64Array>>} Array of embedding vectors
 */
export async function generateBatchEmbeddings(provider, texts, options = {}) {
  if (!Array.isArray(texts)) {
    throw new Error('Texts must be an array for batch embedding');
  }

  const result = await generateEmbedding(provider, texts, options);
  return result.embeddings;
}

/**
 * Calculate cosine similarity between two embedding vectors
 * Returns value between -1 (opposite) and 1 (identical)
 *
 * WHY COSINE SIMILARITY:
 * - Standard metric for vector similarity in NLP
 * - Handles different vector magnitudes gracefully
 * - Range of -1 to 1 is intuitive (0 = orthogonal, 1 = same direction)
 *
 * @param {Float64Array|Array<number>} vectorA - First embedding vector
 * @param {Float64Array|Array<number>} vectorB - Second embedding vector
 * @returns {number} Cosine similarity score
 */
export function cosineSimilarity(vectorA, vectorB) {
  if (!vectorA || !vectorB) {
    throw new Error('Both vectors are required');
  }

  if (vectorA.length !== vectorB.length) {
    throw new Error(`Vector dimensions must match (${vectorA.length} !== ${vectorB.length})`);
  }

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < vectorA.length; i++) {
    dotProduct += vectorA[i] * vectorB[i];
    magnitudeA += vectorA[i] * vectorA[i];
    magnitudeB += vectorB[i] * vectorB[i];
  }

  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Find most similar text from a set
 * Returns the text with highest cosine similarity to query
 *
 * @param {Float64Array} queryVector - Query embedding vector
 * @param {Array<Object>} candidates - Array of {text, vector} objects
 * @param {number} [topK=1] - Number of top results to return
 * @returns {Array<Object>} Top K results with {text, similarity} sorted by similarity
 */
export function findMostSimilar(queryVector, candidates, topK = 1) {
  if (!queryVector || !Array.isArray(candidates)) {
    throw new Error('Query vector and candidates array are required');
  }

  const results = candidates.map(candidate => ({
    text: candidate.text,
    similarity: cosineSimilarity(queryVector, candidate.vector)
  }));

  // Sort by similarity (highest first)
  results.sort((a, b) => b.similarity - a.similarity);

  return results.slice(0, topK);
}

/**
 * Calculate estimated cost for embedding operation
 * WHY: Track spending across providers for budget monitoring
 *
 * @private
 * @param {string} provider - Provider name
 * @param {string} model - Model name
 * @param {number} tokens - Total tokens processed
 * @returns {number} Estimated cost in USD
 */
function calculateEmbeddingCost(provider, model, tokens) {
  if (!tokens) return 0;

  // Pricing per 1M tokens (as of Feb 2026)
  const pricing = {
    openai: {
      'text-embedding-ada-002': 0.1,
      'text-embedding-3-small': 0.02,
      'text-embedding-3-large': 0.13
    },
    anthropic: {
      // Anthropic doesn't offer embedding models as of Feb 2026
      default: 0
    },
    ollama: {
      // Local models have no API cost
      default: 0
    }
  };

  const providerPricing = pricing[provider];
  if (!providerPricing) return 0;

  const pricePerMillion = providerPricing[model] || providerPricing.default || 0;

  // Calculate cost: (tokens / 1,000,000) * price_per_million
  return (tokens / 1_000_000) * pricePerMillion;
}
