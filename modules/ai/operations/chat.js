/**
 * Chat Operation
 *
 * Provides chat completion functionality with support for both
 * streaming and non-streaming responses from AI providers.
 */

/**
 * Execute a chat completion request
 * @param {AIProviderInterface} provider - The AI provider instance
 * @param {Array<Object>} messages - Array of message objects with {role, content}
 * @param {Object} options - Chat options
 * @param {string} [options.model] - Model to use
 * @param {number} [options.temperature] - Sampling temperature (0-2)
 * @param {number} [options.maxTokens] - Maximum tokens to generate
 * @param {boolean} [options.stream=false] - Enable streaming responses
 * @returns {Promise<Object>|AsyncGenerator} Complete response or async generator
 */
export function executeChat(provider, messages, options = {}) {
  // For streaming, return the generator directly
  if (options.stream) {
    return executeChatStreamingWrapper(provider, messages, options);
  }

  // For non-streaming, return the promise
  return executeChatNonStreamingWrapper(provider, messages, options);
}

/**
 * Wrapper for non-streaming chat with validation
 * @private
 */
async function executeChatNonStreamingWrapper(provider, messages, options) {
  // Validate inputs
  if (!provider) {
    throw new Error('Provider is required');
  }

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    throw new Error('Messages array is required and cannot be empty');
  }

  // Validate message format
  for (const message of messages) {
    if (!message.role || !message.content) {
      throw new Error('Each message must have role and content properties');
    }
    if (!['system', 'user', 'assistant'].includes(message.role)) {
      throw new Error(`Invalid message role: ${message.role}. Must be system, user, or assistant`);
    }
  }

  // Check if provider supports chat operation
  const supportedOps = provider.getSupportedOperations();
  if (!supportedOps.includes('chat')) {
    throw new Error(`Provider ${provider.constructor.name} does not support chat operation`);
  }

  // Check if provider is usable
  const isUsable = await provider.isUsable();
  if (!isUsable) {
    throw new Error(`Provider ${provider.constructor.name} is not currently usable`);
  }

  // Prepare chat options
  const chatOptions = {
    messages,
    model: options.model,
    temperature: options.temperature,
    max_tokens: options.maxTokens,
    stream: false
  };

  return executeChatNonStreaming(provider, chatOptions);
}

/**
 * Wrapper for streaming chat with validation
 * @private
 */
async function* executeChatStreamingWrapper(provider, messages, options) {
  // Validate inputs
  if (!provider) {
    throw new Error('Provider is required');
  }

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    throw new Error('Messages array is required and cannot be empty');
  }

  // Validate message format
  for (const message of messages) {
    if (!message.role || !message.content) {
      throw new Error('Each message must have role and content properties');
    }
    if (!['system', 'user', 'assistant'].includes(message.role)) {
      throw new Error(`Invalid message role: ${message.role}. Must be system, user, or assistant`);
    }
  }

  // Check if provider supports chat operation
  const supportedOps = provider.getSupportedOperations();
  if (!supportedOps.includes('chat')) {
    throw new Error(`Provider ${provider.constructor.name} does not support chat operation`);
  }

  // Check if provider is usable
  const isUsable = await provider.isUsable();
  if (!isUsable) {
    throw new Error(`Provider ${provider.constructor.name} is not currently usable`);
  }

  // Prepare chat options
  const chatOptions = {
    messages,
    model: options.model,
    temperature: options.temperature,
    max_tokens: options.maxTokens,
    stream: true
  };

  // Yield from the streaming generator
  yield* executeChatStreaming(provider, chatOptions);
}

/**
 * Execute non-streaming chat completion
 * @private
 */
async function executeChatNonStreaming(provider, options) {
  try {
    const response = await provider.chat(options);

    return {
      content: response.choices?.[0]?.message?.content || '',
      model: response.model,
      usage: response.usage,
      finishReason: response.choices?.[0]?.finish_reason
    };
  } catch (error) {
    throw new Error(`Chat operation failed: ${error.message}`);
  }
}

/**
 * Execute streaming chat completion
 * Returns an async generator that yields text deltas
 * @private
 */
async function* executeChatStreaming(provider, options) {
  try {
    // Enable streaming in provider options
    const streamOptions = { ...options, stream: true };

    // Check if provider has a chatStream method
    if (typeof provider.chatStream === 'function') {
      const stream = await provider.chatStream(streamOptions);

      // If provider returns an async generator, yield from it
      if (stream && typeof stream[Symbol.asyncIterator] === 'function') {
        for await (const chunk of stream) {
          if (chunk.delta) {
            yield chunk.delta;
          }
        }
      }
    } else if (typeof provider.chat === 'function') {
      // Fallback: provider doesn't have streaming, return complete response as single chunk
      const response = await provider.chat({ ...options, stream: false });
      yield {
        content: response.choices?.[0]?.message?.content || '',
        finishReason: 'complete'
      };
    } else {
      throw new Error('Provider does not support chat operation');
    }
  } catch (error) {
    throw new Error(`Streaming chat operation failed: ${error.message}`);
  }
}

/**
 * Format messages for chat completion
 * Helper function to create properly formatted message objects
 * @param {string} role - Message role (system, user, assistant)
 * @param {string} content - Message content
 * @returns {Object} Formatted message object
 */
export function formatMessage(role, content) {
  if (!['system', 'user', 'assistant'].includes(role)) {
    throw new Error(`Invalid role: ${role}. Must be system, user, or assistant`);
  }

  if (!content || typeof content !== 'string') {
    throw new Error('Content must be a non-empty string');
  }

  return { role, content };
}

/**
 * Create a system message
 * @param {string} content - Message content
 * @returns {Object} System message object
 */
export function systemMessage(content) {
  return formatMessage('system', content);
}

/**
 * Create a user message
 * @param {string} content - Message content
 * @returns {Object} User message object
 */
export function userMessage(content) {
  return formatMessage('user', content);
}

/**
 * Create an assistant message
 * @param {string} content - Message content
 * @returns {Object} Assistant message object
 */
export function assistantMessage(content) {
  return formatMessage('assistant', content);
}
