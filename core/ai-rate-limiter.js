/**
 * ai-rate-limiter.js - AI Provider Rate Limiting Service
 *
 * WHY THIS EXISTS:
 * AI providers have API rate limits and costs per request. This service:
 * - Prevents exceeding provider API limits (avoid 429 errors)
 * - Controls costs by limiting requests per time window
 * - Tracks per-provider limits separately
 * - Integrates with existing rate limiting infrastructure
 *
 * DESIGN DECISIONS:
 * - Uses core/ratelimit.js for the sliding window algorithm
 * - Per-provider limits (not global)
 * - Configurable via config/ai_providers.json
 * - Tracks at provider level, not per model
 * - Returns descriptive error messages
 *
 * USAGE:
 *   import { checkProviderLimit } from './core/ai-rate-limiter.js';
 *
 *   const result = await checkProviderLimit('openai');
 *   if (!result.allowed) {
 *     throw new Error(result.error);
 *   }
 */

import { checkLimit, createLimiter } from './ratelimit.ts';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Default rate limits per provider (requests per minute)
 *
 * WHY THESE DEFAULTS:
 * - Conservative to prevent unexpected API bills
 * - Can be overridden in config
 * - Based on typical free tier limits
 */
const DEFAULT_LIMITS = {
  openai: { points: 60, duration: 60 }, // 60 requests/minute
  anthropic: { points: 50, duration: 60 }, // 50 requests/minute
  ollama: { points: 1000, duration: 60 }, // 1000 requests/minute (local, no limit)
};

/**
 * Load rate limit config from ai_providers.json
 *
 * @returns {Object} - Rate limit configuration per provider
 */
function loadRateLimitConfig() {
  const configPath = join(process.cwd(), 'config', 'ai_providers.json');

  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    const rateLimits = {};

    // Extract rate limits from provider config
    for (const [providerId, providerConfig] of Object.entries(config.providers || {})) {
      if (providerConfig.rateLimit) {
        rateLimits[providerId] = providerConfig.rateLimit;
      }
    }

    return rateLimits;
  } catch (error) {
    console.error('[ai-rate-limiter] Failed to load config:', error.message);
    return {};
  }
}

/**
 * Get rate limit configuration for a provider
 *
 * @param {string} providerId - Provider ID (openai, anthropic, ollama)
 * @returns {Object} - { points, duration } configuration
 */
export function getProviderRateLimit(providerId) {
  const configLimits = loadRateLimitConfig();

  // Priority: config > defaults > fallback
  return configLimits[providerId]
    || DEFAULT_LIMITS[providerId]
    || { points: 30, duration: 60 }; // fallback: 30/minute
}

/**
 * Check if a request to an AI provider is allowed under rate limits
 *
 * @param {string} providerId - Provider ID (openai, anthropic, ollama)
 * @param {Object} options - Optional overrides for points/duration
 * @returns {Object} - { allowed, remaining, resetAt, error?, retryAfter? }
 *
 * @example
 * const result = await checkProviderLimit('openai');
 * if (!result.allowed) {
 *   throw new Error(result.error); // "Rate limit exceeded for openai. Try again in 45 seconds."
 * }
 */
export function checkProviderLimit(providerId, options = {}) {
  const limit = getProviderRateLimit(providerId);

  // Merge with any overrides
  const finalOptions = {
    points: options.points || limit.points,
    duration: options.duration || limit.duration,
    reason: `ai-provider:${providerId}`,
  };

  // Generate key: ai-provider:openai
  const key = `ai-provider:${providerId}`;

  // Check the limit
  const result = checkLimit(key, finalOptions);

  // Add error message if blocked
  if (!result.allowed) {
    result.error = `Rate limit exceeded for ${providerId}. ${result.retryAfter} requests per ${finalOptions.duration} seconds. Try again in ${result.retryAfter} seconds.`;
    result.provider = providerId;
  }

  return result;
}

/**
 * Create a rate limiter for a specific provider
 *
 * @param {string} providerId - Provider ID
 * @returns {Object} - Limiter instance with check() method
 *
 * @example
 * const openaiLimiter = createProviderLimiter('openai');
 * const result = openaiLimiter.check();
 */
export function createProviderLimiter(providerId) {
  const limit = getProviderRateLimit(providerId);

  return createLimiter({
    ...limit,
    reason: `ai-provider:${providerId}`,
  });
}

/**
 * Get current rate limit status for all providers
 *
 * @param {Array} providerIds - Array of provider IDs to check
 * @returns {Object} - Status per provider
 *
 * @example
 * const status = getProviderRateLimitStatus(['openai', 'anthropic']);
 * // {
 * //   openai: { limit: 60, remaining: 42, resetAt: 1612345678000 },
 * //   anthropic: { limit: 50, remaining: 50, resetAt: 1612345678000 }
 * // }
 */
export function getProviderRateLimitStatus(providerIds) {
  const status = {};

  for (const providerId of providerIds) {
    const limit = getProviderRateLimit(providerId);
    const key = `ai-provider:${providerId}`;

    // Check without consuming a request (just get status)
    const result = checkLimit(key, { ...limit, reason: `ai-provider:${providerId}` });

    status[providerId] = {
      limit: limit.points,
      remaining: Math.max(0, result.remaining),
      resetAt: result.resetAt,
      blocked: result.blocked || false,
      retryAfter: result.retryAfter || 0,
    };
  }

  return status;
}

/**
 * Middleware to check AI provider rate limits
 *
 * @param {string} providerIdParam - Name of ctx param that contains provider ID
 * @returns {Function} - Middleware function
 *
 * @example
 * router.use(aiProviderRateLimit('providerId'), 'aiRateLimit', '/api/ai/:providerId/*');
 */
export function aiProviderRateLimit(providerIdParam = 'providerId') {
  return async function aiRateLimitMiddleware(req, res, ctx, next) {
    const providerId = ctx.params?.[providerIdParam] || ctx[providerIdParam];

    if (!providerId) {
      // No provider specified, skip rate limiting
      await next();
      return;
    }

    const result = checkProviderLimit(providerId);

    // Add rate limit headers
    res.setHeader('X-RateLimit-Limit', result.limit || 60);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, result.remaining || 0));
    res.setHeader('X-RateLimit-Reset', Math.floor(result.resetAt / 1000));

    if (!result.allowed) {
      res.setHeader('Retry-After', result.retryAfter);
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Rate Limit Exceeded',
        message: result.error,
        provider: result.provider,
        retryAfter: result.retryAfter,
      }));
      return;
    }

    // Request allowed, continue
    await next();
  };
}

export default {
  getProviderRateLimit,
  checkProviderLimit,
  createProviderLimiter,
  getProviderRateLimitStatus,
  aiProviderRateLimit,
};
