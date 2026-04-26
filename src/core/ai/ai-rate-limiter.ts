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

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkLimit, createLimiter } from '../../../core/ratelimit.ts';

// ============================================================================
// Types
// ============================================================================

/** Rate limit configuration for a provider */
interface RateLimitConfig {
  points: number;
  duration: number;
}

/** Options for checking provider limits */
interface CheckOptions {
  points?: number;
  duration?: number;
}

/** Result from checking a provider's rate limit */
interface ProviderLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
  limit?: number;
  blocked?: boolean;
  error?: string;
  provider?: string;
}

/** Status information for a provider's rate limit */
interface ProviderStatus {
  limit: number;
  remaining: number;
  resetAt: number;
  blocked: boolean;
  retryAfter: number;
}

/** HTTP request object (minimal interface) */
interface HttpRequest {
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

/** HTTP response object (minimal interface) */
interface HttpResponse {
  setHeader: (name: string, value: string | number) => void;
  writeHead: (statusCode: number, headers?: Record<string, string>) => void;
  end: (data?: string) => void;
}

/** Route context */
interface RouteContext {
  params?: Record<string, string>;
  [key: string]: unknown;
}

/** Middleware next function */
type NextFunction = () => Promise<void>;

// ============================================================================
// State
// ============================================================================

/**
 * Default rate limits per provider (requests per minute)
 *
 * WHY THESE DEFAULTS:
 * - Conservative to prevent unexpected API bills
 * - Can be overridden in config
 * - Based on typical free tier limits
 */
const DEFAULT_LIMITS: Record<string, RateLimitConfig> = {
  openai: { points: 60, duration: 60 }, // 60 requests/minute
  anthropic: { points: 50, duration: 60 }, // 50 requests/minute
  ollama: { points: 1000, duration: 60 }, // 1000 requests/minute (local, no limit)
};

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Load rate limit config from ai_providers.json
 *
 * @returns Rate limit configuration per provider
 */
function loadRateLimitConfig(): Record<string, RateLimitConfig> {
  const configPath = join(process.cwd(), 'config', 'ai_providers.json');

  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as {
      providers?: Record<string, { rateLimit?: RateLimitConfig }>;
    };
    const rateLimits: Record<string, RateLimitConfig> = {};

    // Extract rate limits from provider config
    for (const [providerId, providerConfig] of Object.entries(config.providers || {})) {
      if (providerConfig.rateLimit) {
        rateLimits[providerId] = providerConfig.rateLimit;
      }
    }

    return rateLimits;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ai-rate-limiter] Failed to load config:', message);
    return {};
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get rate limit configuration for a provider
 *
 * @param providerId - Provider ID (openai, anthropic, ollama)
 * @returns { points, duration } configuration
 */
export function getProviderRateLimit(providerId: string): RateLimitConfig {
  const configLimits = loadRateLimitConfig();

  // Priority: config > defaults > fallback
  return configLimits[providerId] || DEFAULT_LIMITS[providerId] || { points: 30, duration: 60 }; // fallback: 30/minute
}

/**
 * Check if a request to an AI provider is allowed under rate limits
 *
 * @param providerId - Provider ID (openai, anthropic, ollama)
 * @param options - Optional overrides for points/duration
 * @returns { allowed, remaining, resetAt, error?, retryAfter? }
 *
 * @example
 * const result = await checkProviderLimit('openai');
 * if (!result.allowed) {
 *   throw new Error(result.error); // "Rate limit exceeded for openai. Try again in 45 seconds."
 * }
 */
export function checkProviderLimit(
  providerId: string,
  options: CheckOptions = {}
): ProviderLimitResult {
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
  const result = checkLimit(key, finalOptions) as ProviderLimitResult;

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
 * @param providerId - Provider ID
 * @returns Limiter instance with check() method
 *
 * @example
 * const openaiLimiter = createProviderLimiter('openai');
 * const result = openaiLimiter.check();
 */
export function createProviderLimiter(providerId: string): ReturnType<typeof createLimiter> {
  const limit = getProviderRateLimit(providerId);

  return createLimiter({
    ...limit,
    reason: `ai-provider:${providerId}`,
  });
}

/**
 * Get current rate limit status for all providers
 *
 * @param providerIds - Array of provider IDs to check
 * @returns Status per provider
 *
 * @example
 * const status = getProviderRateLimitStatus(['openai', 'anthropic']);
 * // {
 * //   openai: { limit: 60, remaining: 42, resetAt: 1612345678000 },
 * //   anthropic: { limit: 50, remaining: 50, resetAt: 1612345678000 }
 * // }
 */
export function getProviderRateLimitStatus(providerIds: string[]): Record<string, ProviderStatus> {
  const status: Record<string, ProviderStatus> = {};

  for (const providerId of providerIds) {
    const limit = getProviderRateLimit(providerId);
    const key = `ai-provider:${providerId}`;

    // Check without consuming a request (just get status)
    const result = checkLimit(key, {
      ...limit,
      reason: `ai-provider:${providerId}`,
    }) as ProviderLimitResult;

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
 * @param providerIdParam - Name of ctx param that contains provider ID
 * @returns Middleware function
 *
 * @example
 * router.use(aiProviderRateLimit('providerId'), 'aiRateLimit', '/api/ai/:providerId/*');
 */
export function aiProviderRateLimit(
  providerIdParam: string = 'providerId'
): (req: HttpRequest, res: HttpResponse, ctx: RouteContext, next: NextFunction) => Promise<void> {
  return async function aiRateLimitMiddleware(
    req: HttpRequest,
    res: HttpResponse,
    ctx: RouteContext,
    next: NextFunction
  ): Promise<void> {
    const providerId =
      ctx.params?.[providerIdParam] || (ctx[providerIdParam] as string | undefined);

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
      res.setHeader('Retry-After', result.retryAfter || 0);
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'Rate Limit Exceeded',
          message: result.error,
          provider: result.provider,
          retryAfter: result.retryAfter,
        })
      );
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
