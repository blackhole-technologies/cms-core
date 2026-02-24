/**
 * seo.ts - Content SEO Analyzer Service
 *
 * WHY THIS EXISTS:
 * Search engine optimization is critical for content discoverability.
 * Editors often miss basic SEO best practices when creating content:
 * - Titles too short or too long for search result display
 * - Missing or poor meta descriptions
 * - Focus keywords not used in strategic locations
 * - Content too thin to rank well
 * - Poor keyword density (too sparse or keyword stuffing)
 *
 * This service analyzes content against SEO best practices and provides
 * actionable recommendations. Inspired by Drupal's yoast_seo / metatag
 * modules and the Yoast SEO plugin approach.
 *
 * ARCHITECTURE:
 * - Plugin-based analyzer system: each analysis is a separate function
 * - Severity levels match accessibility service: error, warning, info, pass
 * - Returns structured results with metrics, recommendations, and scores
 * - Focus keyword support: analyze content against a target keyword
 * - Integrates with content system via hooks for automatic analysis on save
 *
 * SUPPORTED ANALYSES:
 * - Title tag length and quality
 * - Meta description length and quality
 * - Focus keyword presence in title, body, URL, meta description
 * - Keyword density calculation
 * - Content length assessment
 * - Heading analysis (H1 presence, keyword in headings)
 * - Readability scoring (Flesch-Kincaid approximation)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

// ============================================================================
// Types
// ============================================================================

/** SEO status/severity levels */
type SeoStatusValue = 'error' | 'warning' | 'info' | 'pass';

/** Content item with flexible fields for SEO analysis */
interface ContentItem {
  id: string;
  type: string;
  title?: string;
  summary?: string;
  body?: string | { value: string; format?: string };
  slug?: string;
  [key: string]: unknown;
}

/** Analysis options passed to analyzers */
interface AnalyzeOptions {
  focusKeyword?: string;
  metaDescription?: string;
  only?: string[];
  skip?: string[];
  [key: string]: unknown;
}

/** Configuration for title length rules */
interface TitleConfig {
  minLength: number;
  maxLength: number;
  optimalMin: number;
  optimalMax: number;
}

/** Configuration for meta description length rules */
interface MetaDescriptionConfig {
  minLength: number;
  maxLength: number;
  optimalMin: number;
  optimalMax: number;
}

/** Configuration for content length rules */
interface ContentLengthConfig {
  minWords: number;
  goodWords: number;
  excellentWords: number;
}

/** Configuration for keyword density rules */
interface KeywordConfig {
  minDensity: number;
  maxDensity: number;
  optimalMin: number;
  optimalMax: number;
}

/** Full SEO configuration */
interface SeoConfig {
  enabled: boolean;
  autoAnalyze: boolean;
  title: TitleConfig;
  metaDescription: MetaDescriptionConfig;
  content: ContentLengthConfig;
  keyword: KeywordConfig;
  [key: string]: unknown;
}

/** Result returned by an individual analyzer */
interface AnalyzerResult {
  status: SeoStatusValue;
  message: string;
  value?: number | null;
  details?: Record<string, unknown> | null;
  recommendation?: string;
}

/** Analyzer definition provided by caller */
interface AnalyzerDef {
  name: string;
  description: string;
  category?: string;
  analyze: (content: ContentItem, options: AnalyzeOptions, config: SeoConfig) => AnalyzerResult | null;
}

/** Registered analyzer with id */
interface RegisteredAnalyzer {
  id: string;
  name: string;
  description: string;
  category: string;
  analyze: (content: ContentItem, options: AnalyzeOptions, config: SeoConfig) => AnalyzerResult | null;
}

/** Analyzer info returned by getAnalyzers() */
interface AnalyzerInfo {
  id: string;
  name: string;
  description: string;
  category: string;
}

/** Individual metric result */
interface SeoMetric {
  id: string;
  name: string;
  category: string;
  status: SeoStatusValue;
  message: string;
  value: number | null;
  details: Record<string, unknown> | null;
}

/** Recommendation entry */
interface SeoRecommendation {
  analyzerId: string;
  severity: SeoStatusValue;
  message: string;
}

/** Full analysis result */
interface SeoAnalysisResult {
  metrics: SeoMetric[];
  score: number;
  summary: string;
  recommendations: SeoRecommendation[];
  focusKeyword?: string | null;
  lastAnalyzed?: string | null;
  total?: number;
  byStatus?: {
    pass: number;
    error: number;
    warning: number;
    info: number;
  };
}

/** Stored SEO metadata */
interface SeoMeta {
  focusKeyword?: string;
  metaDescription?: string;
  seoScore?: number;
  lastAnalyzed?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/** Initialization options */
interface SeoInitOptions {
  baseDir?: string;
  content?: ContentService | null;
  hooks?: HooksService | null;
  config?: Partial<SeoConfig>;
}

/** Content service interface */
interface ContentService {
  read(type: string, id: string): ContentItem | null;
  list(type: string): ContentItem[];
}

/** Hooks service interface */
interface HooksService {
  register(event: string, handler: (ctx: Record<string, unknown>) => Promise<void>, priority?: number, namespace?: string): void;
}

/** CLI register function type */
type CliRegisterFn = (
  cmdName: string,
  handler: (args: string[]) => Promise<boolean>,
  description: string,
  category: string
) => void;

/** Router service interface */
interface RouterService {
  register(method: string, path: string, handler: (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => Promise<void>): void;
}

/**
 * Severity/status levels for SEO analysis results
 *
 * WHY FOUR LEVELS:
 * - error: Critical SEO issue that will significantly hurt rankings
 * - warning: Notable SEO concern that should be addressed
 * - info: Suggestion for improvement (nice to have)
 * - pass: This check passed (positive feedback for editors)
 */
const STATUS = {
  ERROR: 'error' as SeoStatusValue,
  WARNING: 'warning' as SeoStatusValue,
  INFO: 'info' as SeoStatusValue,
  PASS: 'pass' as SeoStatusValue,
};

/**
 * SEO configuration defaults
 *
 * WHY CONFIGURABLE:
 * Different sites have different SEO needs. A news site cares about
 * different metrics than an e-commerce catalog.
 */
const DEFAULTS = {
  title: {
    minLength: 30,
    maxLength: 60,
    optimalMin: 40,
    optimalMax: 55,
  } satisfies TitleConfig,
  metaDescription: {
    minLength: 70,
    maxLength: 160,
    optimalMin: 120,
    optimalMax: 155,
  } satisfies MetaDescriptionConfig,
  content: {
    minWords: 300,
    goodWords: 600,
    excellentWords: 1500,
  } satisfies ContentLengthConfig,
  keyword: {
    minDensity: 0.5,    // Minimum keyword density percentage
    maxDensity: 3.0,    // Maximum before it's considered stuffing
    optimalMin: 1.0,
    optimalMax: 2.5,
  } satisfies KeywordConfig,
};

/**
 * Registry of SEO analyzers
 * Each analyzer is { id, name, description, category, analyze: (content, options) => result }
 */
const analyzers: Map<string, RegisteredAnalyzer> = new Map();

/**
 * Module state
 */
let initialized = false;
let contentService: ContentService | null = null;
let hooksService: HooksService | null = null;
let baseDir: string | null = null;
let configData: SeoConfig = {
  enabled: true,
  autoAnalyze: false,
  ...DEFAULTS,
};
let seoMetaStore: string | null = null; // Path to SEO metadata storage

/**
 * Initialize the SEO analyzer service
 */
export function init(opts: SeoInitOptions = {}): void {
  baseDir = opts.baseDir ?? process.cwd();
  contentService = opts.content ?? null;
  hooksService = opts.hooks ?? null;
  configData = {
    enabled: true,
    autoAnalyze: false,
    ...DEFAULTS,
    ...opts.config,
  } as SeoConfig;

  // SEO metadata storage directory
  seoMetaStore = join(baseDir, 'config', 'seo-metadata');
  if (!existsSync(seoMetaStore)) {
    mkdirSync(seoMetaStore, { recursive: true });
  }

  // Register built-in analyzers
  registerBuiltinAnalyzers();

  initialized = true;
}

/**
 * Export service name for boot registration
 */
export const name: string = 'seo';

/**
 * Register a new SEO analyzer
 */
export function registerAnalyzer(id: string, analyzerDef: AnalyzerDef): void {
  analyzers.set(id, {
    id,
    name: analyzerDef.name,
    description: analyzerDef.description,
    category: analyzerDef.category ?? 'general',
    analyze: analyzerDef.analyze,
  });
}

/**
 * Get all registered analyzers
 */
export function getAnalyzers(): AnalyzerInfo[] {
  return Array.from(analyzers.values()).map(a => ({
    id: a.id,
    name: a.name,
    description: a.description,
    category: a.category,
  }));
}

/**
 * Run all SEO analyzers on content
 */
export function analyze(contentItem: ContentItem | null, options: AnalyzeOptions = {}): SeoAnalysisResult {
  if (!contentItem) {
    return {
      metrics: [],
      score: 0,
      summary: 'No content to analyze',
      recommendations: [],
    };
  }

  // Try to load stored SEO metadata (focus keyword, meta description, etc.)
  const seoMeta = loadSeoMeta(contentItem.type, contentItem.id) ?? {};

  // Merge provided options with stored metadata
  const effectiveOptions: AnalyzeOptions = {
    ...options,
    focusKeyword: (options.focusKeyword as string | undefined) ?? seoMeta.focusKeyword ?? '',
    metaDescription: (options.metaDescription as string | undefined) ?? seoMeta.metaDescription ?? (typeof contentItem.summary === 'string' ? contentItem.summary : '') ?? '',
  };

  const { only, skip } = options;

  // Run each registered analyzer
  const metrics: SeoMetric[] = [];
  const recommendations: SeoRecommendation[] = [];

  for (const [analyzerId, analyzerDef] of analyzers) {
    if (only && !only.includes(analyzerId)) continue;
    if (skip && skip.includes(analyzerId)) continue;

    try {
      const result = analyzerDef.analyze(contentItem, effectiveOptions, configData);
      if (result) {
        metrics.push({
          id: analyzerId,
          name: analyzerDef.name,
          category: analyzerDef.category,
          status: result.status ?? STATUS.INFO,
          message: result.message ?? '',
          value: result.value !== undefined ? (result.value ?? null) : null,
          details: result.details ?? null,
        });

        if (result.recommendation) {
          recommendations.push({
            analyzerId,
            severity: result.status ?? STATUS.INFO,
            message: result.recommendation,
          });
        }
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      metrics.push({
        id: analyzerId,
        name: analyzerDef.name,
        category: analyzerDef.category,
        status: STATUS.INFO,
        message: `Analysis failed: ${errMsg}`,
        value: null,
        details: null,
      });
    }
  }

  // Calculate overall SEO score
  const score = calculateSeoScore(metrics);

  return {
    metrics,
    score,
    summary: generateSeoSummary(metrics, score),
    recommendations: recommendations.filter(r => r.severity !== STATUS.PASS),
    focusKeyword: (effectiveOptions.focusKeyword as string) || null,
    lastAnalyzed: seoMeta.lastAnalyzed ?? null,
    total: metrics.length,
    byStatus: {
      pass: metrics.filter(m => m.status === 'pass').length,
      error: metrics.filter(m => m.status === 'error').length,
      warning: metrics.filter(m => m.status === 'warning').length,
      info: metrics.filter(m => m.status === 'info').length,
    },
  };
}

/**
 * Analyze a specific content item by type and ID
 */
export function analyzeContent(type: string, id: string, options: AnalyzeOptions = {}): SeoAnalysisResult {
  if (!contentService) {
    return { metrics: [], score: 0, summary: 'Content service not available', recommendations: [] };
  }

  try {
    const item = contentService.read(type, id);
    if (!item) {
      return { metrics: [], score: 0, summary: `Content not found: ${type}/${id}`, recommendations: [] };
    }
    const result = analyze(item, options);

    // Store the SEO score with metadata for persistence
    // WHY: Feature #165 requires score to be stored with content
    if (result.score !== undefined) {
      saveSeoMeta(type, id, {
        seoScore: result.score,
        lastAnalyzed: new Date().toISOString(),
      });
    }

    return result;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { metrics: [], score: 0, summary: `Error loading content: ${errMsg}`, recommendations: [] };
  }
}

/**
 * Get the stored SEO score for a content item
 *
 * WHY THIS EXISTS:
 * Feature #165 requires SEO scores to be stored and retrievable without
 * running full analysis. This allows displaying scores in content lists,
 * dashboards, and APIs efficiently.
 */
export function getSeoScore(type: string, id: string): number | null {
  const meta = loadSeoMeta(type, id);
  return (meta?.seoScore as number | undefined) ?? null;
}

/**
 * Save SEO metadata for a content item
 *
 * WHY SEPARATE STORAGE:
 * SEO metadata (focus keyword, meta description overrides, etc.) is editorial
 * configuration, not content data. Storing separately keeps content schema clean
 * and allows SEO changes without creating content revisions.
 */
export function saveSeoMeta(type: string, id: string, meta: Partial<SeoMeta>): SeoMeta | undefined {
  if (!seoMetaStore) return undefined;

  const filePath = join(seoMetaStore, `${type}--${id}.json`);
  const existing = loadSeoMeta(type, id) ?? {};
  const updated: SeoMeta = { ...existing, ...meta, updatedAt: new Date().toISOString() };

  writeFileSync(filePath, JSON.stringify(updated, null, 2));
  return updated;
}

/**
 * Load SEO metadata for a content item
 */
export function loadSeoMeta(type: string, id: string): SeoMeta | null {
  if (!seoMetaStore) return null;

  const filePath = join(seoMetaStore, `${type}--${id}.json`);
  try {
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, 'utf-8')) as SeoMeta;
    }
  } catch {
    // Gracefully handle corrupt files
  }
  return null;
}

/**
 * Calculate SEO score from 0-100 based on analysis metrics
 *
 * WHY WEIGHTED SCORING:
 * Different SEO factors have different impact. Title and content
 * quality matter more than meta description for most search engines.
 */
function calculateSeoScore(metrics: SeoMetric[]): number {
  if (metrics.length === 0) return 0;

  // Weight by status
  const statusWeights: Record<string, number> = {
    pass: 1.0,
    info: 0.5,
    warning: 0.25,
    error: 0.0,
  };

  let totalWeight = 0;
  let weightedSum = 0;

  for (const metric of metrics) {
    const weight = statusWeights[metric.status] ?? 0.5;
    weightedSum += weight;
    totalWeight += 1;
  }

  if (totalWeight === 0) return 0;
  return Math.round((weightedSum / totalWeight) * 100);
}

/**
 * Generate a human-readable SEO summary
 */
function generateSeoSummary(metrics: SeoMetric[], score: number): string {
  if (metrics.length === 0) return 'No analysis performed';

  const passes = metrics.filter(m => m.status === 'pass').length;
  const errors = metrics.filter(m => m.status === 'error').length;
  const warnings = metrics.filter(m => m.status === 'warning').length;

  let quality: string;
  if (score >= 80) quality = 'Good';
  else if (score >= 60) quality = 'Needs improvement';
  else if (score >= 40) quality = 'Poor';
  else quality = 'Critical issues';

  return `${quality} (${passes}/${metrics.length} checks passed, ${errors} errors, ${warnings} warnings)`;
}

// ============================================================
// BUILT-IN SEO ANALYZERS
// ============================================================

/**
 * Register all built-in SEO analyzers
 */
function registerBuiltinAnalyzers(): void {

  // ----- ANALYZER: Title length -----
  registerAnalyzer('title-length', {
    name: 'Title Length',
    description: 'Check if the title is within optimal length for search results',
    category: 'title',
    analyze: (content: ContentItem, _options: AnalyzeOptions, config: SeoConfig): AnalyzerResult => {
      const title = (content.title as string) ?? '';
      const len = title.length;
      const cfg = config.title ?? DEFAULTS.title;

      if (len === 0) {
        return {
          status: 'error',
          message: 'Title is missing',
          value: 0,
          recommendation: 'Add a descriptive title between 30-60 characters',
        };
      }

      if (len < cfg.minLength) {
        return {
          status: 'warning',
          message: `Title is too short (${len} characters, minimum ${cfg.minLength})`,
          value: len,
          recommendation: `Expand the title to at least ${cfg.minLength} characters for better search visibility`,
        };
      }

      if (len > cfg.maxLength) {
        return {
          status: 'warning',
          message: `Title is too long (${len} characters, maximum ${cfg.maxLength}). It will be truncated in search results`,
          value: len,
          recommendation: `Shorten the title to under ${cfg.maxLength} characters to prevent truncation in search results`,
        };
      }

      if (len >= cfg.optimalMin && len <= cfg.optimalMax) {
        return {
          status: 'pass',
          message: `Title length is optimal (${len} characters)`,
          value: len,
        };
      }

      return {
        status: 'pass',
        message: `Title length is acceptable (${len} characters)`,
        value: len,
      };
    },
  });

  // ----- ANALYZER: Title keyword presence -----
  registerAnalyzer('title-keyword', {
    name: 'Keyword in Title',
    description: 'Check if focus keyword appears in the title',
    category: 'keyword',
    analyze: (content: ContentItem, options: AnalyzeOptions): AnalyzerResult => {
      const keyword = options.focusKeyword;
      if (!keyword) {
        return {
          status: 'info',
          message: 'No focus keyword set - cannot check title keyword presence',
          recommendation: 'Set a focus keyword to enable keyword analysis',
        };
      }

      const title = ((content.title as string) ?? '').toLowerCase();
      const kw = keyword.toLowerCase();

      if (title.includes(kw)) {
        const pos = title.indexOf(kw);
        const isEarly = pos < title.length * 0.5;

        return {
          status: 'pass',
          message: isEarly
            ? `Focus keyword "${keyword}" found near the beginning of the title`
            : `Focus keyword "${keyword}" found in the title`,
          value: pos,
          details: { position: pos, isEarly },
        };
      }

      return {
        status: 'error',
        message: `Focus keyword "${keyword}" not found in the title`,
        recommendation: `Include the focus keyword "${keyword}" in your title, ideally near the beginning`,
      };
    },
  });

  // ----- ANALYZER: Meta description length -----
  registerAnalyzer('meta-description-length', {
    name: 'Meta Description Length',
    description: 'Check if meta description is within optimal length',
    category: 'description',
    analyze: (content: ContentItem, options: AnalyzeOptions, config: SeoConfig): AnalyzerResult => {
      const desc = (options.metaDescription as string) ?? (typeof content.summary === 'string' ? content.summary : '') ?? '';
      const len = desc.length;
      const cfg = config.metaDescription ?? DEFAULTS.metaDescription;

      if (len === 0) {
        return {
          status: 'warning',
          message: 'Meta description is missing',
          value: 0,
          recommendation: 'Add a meta description between 120-155 characters to control how your content appears in search results',
        };
      }

      if (len < cfg.minLength) {
        return {
          status: 'warning',
          message: `Meta description is too short (${len} characters, minimum ${cfg.minLength})`,
          value: len,
          recommendation: `Expand the meta description to at least ${cfg.minLength} characters`,
        };
      }

      if (len > cfg.maxLength) {
        return {
          status: 'warning',
          message: `Meta description is too long (${len} characters, maximum ${cfg.maxLength}). It will be truncated`,
          value: len,
          recommendation: `Shorten to under ${cfg.maxLength} characters to prevent truncation in search results`,
        };
      }

      return {
        status: 'pass',
        message: `Meta description length is good (${len} characters)`,
        value: len,
      };
    },
  });

  // ----- ANALYZER: Meta description keyword -----
  registerAnalyzer('meta-description-keyword', {
    name: 'Keyword in Meta Description',
    description: 'Check if focus keyword appears in the meta description',
    category: 'keyword',
    analyze: (content: ContentItem, options: AnalyzeOptions): AnalyzerResult => {
      const keyword = options.focusKeyword;
      if (!keyword) {
        return {
          status: 'info',
          message: 'No focus keyword set',
        };
      }

      const desc = ((options.metaDescription as string) ?? (typeof content.summary === 'string' ? content.summary : '') ?? '').toLowerCase();
      const kw = keyword.toLowerCase();

      if (desc.length === 0) {
        return {
          status: 'warning',
          message: 'No meta description to check for keyword',
          recommendation: 'Add a meta description containing your focus keyword',
        };
      }

      if (desc.includes(kw)) {
        return {
          status: 'pass',
          message: `Focus keyword "${keyword}" found in meta description`,
        };
      }

      return {
        status: 'warning',
        message: `Focus keyword "${keyword}" not found in meta description`,
        recommendation: `Include "${keyword}" in your meta description for better search snippet relevance`,
      };
    },
  });

  // ----- ANALYZER: Content length -----
  registerAnalyzer('content-length', {
    name: 'Content Length',
    description: 'Check if content has sufficient length for SEO',
    category: 'content',
    analyze: (content: ContentItem, _options: AnalyzeOptions, config: SeoConfig): AnalyzerResult => {
      const body = extractPlainText(content);
      const wordCount = countWords(body);
      const cfg = config.content ?? DEFAULTS.content;

      if (wordCount === 0) {
        return {
          status: 'error',
          message: 'Content body is empty',
          value: 0,
          recommendation: `Write at least ${cfg.minWords} words of quality content`,
        };
      }

      if (wordCount < cfg.minWords) {
        return {
          status: 'warning',
          message: `Content is thin (${wordCount} words, minimum ${cfg.minWords} recommended)`,
          value: wordCount,
          recommendation: `Add more content to reach at least ${cfg.minWords} words. Search engines favor comprehensive content`,
        };
      }

      if (wordCount >= cfg.excellentWords) {
        return {
          status: 'pass',
          message: `Excellent content length (${wordCount} words)`,
          value: wordCount,
          details: { level: 'excellent' },
        };
      }

      if (wordCount >= cfg.goodWords) {
        return {
          status: 'pass',
          message: `Good content length (${wordCount} words)`,
          value: wordCount,
          details: { level: 'good' },
        };
      }

      return {
        status: 'pass',
        message: `Acceptable content length (${wordCount} words)`,
        value: wordCount,
        details: { level: 'acceptable' },
      };
    },
  });

  // ----- ANALYZER: Keyword density -----
  registerAnalyzer('keyword-density', {
    name: 'Keyword Density',
    description: 'Check if focus keyword appears with optimal frequency in content',
    category: 'keyword',
    analyze: (content: ContentItem, options: AnalyzeOptions, config: SeoConfig): AnalyzerResult => {
      const keyword = options.focusKeyword;
      if (!keyword) {
        return {
          status: 'info',
          message: 'No focus keyword set - cannot check keyword density',
        };
      }

      const body = extractPlainText(content);
      const wordCount = countWords(body);

      if (wordCount === 0) {
        return {
          status: 'warning',
          message: 'No content to analyze keyword density',
        };
      }

      const kw = keyword.toLowerCase();
      const bodyLower = body.toLowerCase();

      // Count keyword occurrences
      let count = 0;
      let pos = 0;
      while ((pos = bodyLower.indexOf(kw, pos)) !== -1) {
        count++;
        pos += kw.length;
      }

      const density = (count * keyword.split(/\s+/).length / wordCount) * 100;
      const cfg = config.keyword ?? DEFAULTS.keyword;

      if (count === 0) {
        return {
          status: 'error',
          message: `Focus keyword "${keyword}" not found in content body`,
          value: 0,
          details: { count, density: 0, wordCount },
          recommendation: `Use "${keyword}" naturally throughout your content, aiming for ${cfg.optimalMin}-${cfg.optimalMax}% density`,
        };
      }

      if (density < cfg.minDensity) {
        return {
          status: 'warning',
          message: `Keyword density is low (${density.toFixed(1)}%, found ${count} times in ${wordCount} words)`,
          value: density,
          details: { count, density, wordCount },
          recommendation: `Use "${keyword}" a few more times. Target ${cfg.optimalMin}-${cfg.optimalMax}% density`,
        };
      }

      if (density > cfg.maxDensity) {
        return {
          status: 'warning',
          message: `Keyword density is too high (${density.toFixed(1)}%) - this may be seen as keyword stuffing`,
          value: density,
          details: { count, density, wordCount },
          recommendation: `Reduce usage of "${keyword}" to under ${cfg.maxDensity}% to avoid penalties`,
        };
      }

      return {
        status: 'pass',
        message: `Good keyword density (${density.toFixed(1)}%, "${keyword}" found ${count} times)`,
        value: density,
        details: { count, density, wordCount },
      };
    },
  });

  // ----- ANALYZER: Keyword in URL/slug -----
  registerAnalyzer('keyword-in-url', {
    name: 'Keyword in URL',
    description: 'Check if focus keyword appears in the content URL/slug',
    category: 'keyword',
    analyze: (content: ContentItem, options: AnalyzeOptions): AnalyzerResult => {
      const keyword = options.focusKeyword;
      if (!keyword) {
        return {
          status: 'info',
          message: 'No focus keyword set',
        };
      }

      const slug = ((content.slug as string) ?? content.id ?? '').toLowerCase();
      const kw = keyword.toLowerCase().replace(/\s+/g, '-');
      const kwWords = keyword.toLowerCase().split(/\s+/);

      // Check if any keyword word appears in slug
      const found = kwWords.some(w => slug.includes(w));

      if (found) {
        return {
          status: 'pass',
          message: `Focus keyword found in URL slug ("${slug}")`,
        };
      }

      return {
        status: 'warning',
        message: `Focus keyword "${keyword}" not found in URL slug ("${slug}")`,
        recommendation: `Consider including "${kw}" in the URL for better search relevance`,
      };
    },
  });

  // ----- ANALYZER: Heading analysis -----
  registerAnalyzer('heading-analysis', {
    name: 'Heading Analysis',
    description: 'Check for proper heading usage and keyword presence',
    category: 'content',
    analyze: (content: ContentItem, options: AnalyzeOptions): AnalyzerResult => {
      const body = getBodyHtml(content);
      if (!body) {
        return {
          status: 'info',
          message: 'No HTML body content to analyze headings',
        };
      }

      // Extract headings
      const headingRegex = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
      const headings: Array<{ level: number; text: string }> = [];
      let match: RegExpExecArray | null;
      while ((match = headingRegex.exec(body)) !== null) {
        headings.push({
          level: parseInt(match[1]!, 10),
          text: stripHtml(match[2]!).trim(),
        });
      }

      if (headings.length === 0) {
        return {
          status: 'warning',
          message: 'No headings found in content. Use headings to structure your content',
          recommendation: 'Add headings (H2, H3) to break up content and improve readability',
        };
      }

      // Check for keyword in headings
      const keyword = options.focusKeyword;
      if (keyword) {
        const kw = keyword.toLowerCase();
        const hasKeywordInHeading = headings.some(h => h.text.toLowerCase().includes(kw));

        if (!hasKeywordInHeading) {
          return {
            status: 'warning',
            message: `Focus keyword "${keyword}" not found in any heading`,
            details: { headingCount: headings.length },
            recommendation: `Include "${keyword}" in at least one subheading (H2-H3)`,
          };
        }

        return {
          status: 'pass',
          message: `Focus keyword "${keyword}" found in headings (${headings.length} headings total)`,
          details: { headingCount: headings.length },
        };
      }

      return {
        status: 'pass',
        message: `Content has ${headings.length} heading(s)`,
        details: { headingCount: headings.length },
      };
    },
  });

  // ----- ANALYZER: Readability -----
  registerAnalyzer('readability', {
    name: 'Readability Score',
    description: 'Estimate content readability using Flesch-Kincaid approximation',
    category: 'content',
    analyze: (content: ContentItem): AnalyzerResult => {
      const text = extractPlainText(content);
      const wordCount = countWords(text);

      if (wordCount < 10) {
        return {
          status: 'info',
          message: 'Not enough content to calculate readability',
          value: null,
        };
      }

      const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
      const sentenceCount = Math.max(sentences.length, 1);
      const syllableCount = estimateSyllables(text);

      // Flesch Reading Ease formula
      const fre = 206.835 - (1.015 * (wordCount / sentenceCount)) - (84.6 * (syllableCount / wordCount));
      const score = Math.max(0, Math.min(100, Math.round(fre)));

      let level: string;
      if (score >= 80) level = 'Easy to read';
      else if (score >= 60) level = 'Standard';
      else if (score >= 40) level = 'Somewhat difficult';
      else level = 'Difficult to read';

      if (score >= 60) {
        return {
          status: 'pass',
          message: `${level} (Flesch score: ${score}/100)`,
          value: score,
          details: { fleschScore: score, wordCount, sentenceCount, level },
        };
      }

      if (score >= 40) {
        return {
          status: 'warning',
          message: `${level} (Flesch score: ${score}/100)`,
          value: score,
          details: { fleschScore: score, wordCount, sentenceCount, level },
          recommendation: 'Try using shorter sentences and simpler words to improve readability',
        };
      }

      return {
        status: 'warning',
        message: `${level} (Flesch score: ${score}/100)`,
        value: score,
        details: { fleschScore: score, wordCount, sentenceCount, level },
        recommendation: 'Content is complex. Use shorter sentences, simpler vocabulary, and break up long paragraphs',
      };
    },
  });

  // ----- ANALYZER: Internal links -----
  registerAnalyzer('internal-links', {
    name: 'Internal Links',
    description: 'Check for presence of internal links in content',
    category: 'content',
    analyze: (content: ContentItem): AnalyzerResult => {
      const body = getBodyHtml(content);
      if (!body) {
        return {
          status: 'info',
          message: 'No HTML body to check for links',
        };
      }

      const linkRegex = /<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>/gi;
      let internalCount = 0;
      let externalCount = 0;
      let match: RegExpExecArray | null;

      while ((match = linkRegex.exec(body)) !== null) {
        const href = match[1]!;
        if (href.startsWith('http://') || href.startsWith('https://')) {
          externalCount++;
        } else if (href.startsWith('/') || href.startsWith('#') || !href.includes('://')) {
          internalCount++;
        }
      }

      if (internalCount === 0 && externalCount === 0) {
        return {
          status: 'info',
          message: 'No links found in content',
          recommendation: 'Add internal links to related content to improve site navigation and SEO',
        };
      }

      if (internalCount === 0) {
        return {
          status: 'warning',
          message: `No internal links found (${externalCount} external link(s))`,
          recommendation: 'Add links to related content on your site for better internal linking',
        };
      }

      return {
        status: 'pass',
        message: `Found ${internalCount} internal and ${externalCount} external link(s)`,
        details: { internalCount, externalCount },
      };
    },
  });
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Strip HTML tags from string
 */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

/**
 * Get the body/content HTML from a content item
 *
 * WHY FLEXIBLE:
 * Body field can be a string or a structured object { value, format }
 */
function getBodyHtml(content: ContentItem): string {
  if (content.body) {
    if (typeof content.body === 'string') return content.body;
    if (typeof content.body === 'object' && content.body.value) return String(content.body.value);
  }
  return '';
}

/**
 * Extract all plain text from a content item
 * Combines title, summary, body into one text block
 */
function extractPlainText(content: ContentItem): string {
  const parts: string[] = [];

  if (content.title) parts.push(content.title);
  if (content.summary) parts.push(typeof content.summary === 'string' ? content.summary : '');

  const body = getBodyHtml(content);
  if (body) parts.push(stripHtml(body));

  // Also grab any other text fields
  const systemFields = new Set([
    'id', 'type', 'created', 'updated', 'status',
    'publishedAt', 'scheduledAt', 'slug', 'author',
    'isDefaultRevision', 'revisionId', 'title', 'summary', 'body',
  ]);

  for (const [key, value] of Object.entries(content)) {
    if (systemFields.has(key)) continue;
    if (typeof value === 'string' && value.trim().length > 0) {
      parts.push(stripHtml(value));
    }
  }

  return parts.join(' ');
}

/**
 * Count words in text
 */
function countWords(text: string): number {
  const words = text.trim().split(/\s+/).filter(w => w.length > 0);
  return words.length;
}

/**
 * Estimate syllable count in text
 *
 * WHY ESTIMATE:
 * True syllable counting requires a dictionary. This heuristic
 * works reasonably well for English text using vowel pattern matching.
 */
function estimateSyllables(text: string): number {
  const words = text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 0);
  let total = 0;

  for (const word of words) {
    let count = 0;
    // Count vowel groups
    const matches = word.match(/[aeiouy]+/g);
    if (matches) count = matches.length;

    // Subtract silent 'e' at end
    if (word.endsWith('e') && count > 1) count--;

    // Ensure at least 1 syllable per word
    if (count < 1) count = 1;

    total += count;
  }

  return total;
}

/**
 * Register CLI commands for SEO analysis
 */
export function registerCli(register: CliRegisterFn): void {
  // seo:analyze <type> <id> - Analyze content SEO
  register('seo:analyze', async (args: string[]): Promise<boolean> => {
    if (args.length < 2) {
      console.log('Usage: seo:analyze <type> <id> [--keyword=<keyword>]');
      console.log('Example: seo:analyze article my-post --keyword="node.js cms"');
      return true;
    }

    const [type, id] = args as [string, string, ...string[]];
    const keywordArg = args.find(a => a.startsWith('--keyword='));
    const keyword = keywordArg ? keywordArg.replace('--keyword=', '').replace(/^["']|["']$/g, '') : undefined;

    const result = analyzeContent(type, id, { focusKeyword: keyword });

    console.log(`\nSEO Analysis: ${type}/${id}`);
    console.log(`Score: ${result.score}/100`);
    console.log(`Summary: ${result.summary}`);
    if (result.focusKeyword) console.log(`Focus Keyword: "${result.focusKeyword}"`);

    if (result.metrics.length > 0) {
      console.log('\nMetrics:');
      for (const metric of result.metrics) {
        const icon = metric.status === 'pass' ? '\u2705' :
                     metric.status === 'error' ? '\u274C' :
                     metric.status === 'warning' ? '\u26A0\uFE0F' : '\u2139\uFE0F';
        console.log(`  ${icon} [${metric.category}] ${metric.name}: ${metric.message}`);
      }
    }

    if (result.recommendations.length > 0) {
      console.log('\nRecommendations:');
      for (const rec of result.recommendations) {
        console.log(`  \uD83D\uDCA1 ${rec.message}`);
      }
    }

    return true;
  }, 'Analyze content for SEO optimization', 'seo');

  // seo:analyzers - List available analyzers
  register('seo:analyzers', async (): Promise<boolean> => {
    const allAnalyzers = getAnalyzers();
    console.log(`\nRegistered SEO Analyzers (${allAnalyzers.length}):`);

    const categories: Record<string, AnalyzerInfo[]> = {};
    for (const a of allAnalyzers) {
      if (!categories[a.category]) categories[a.category] = [];
      categories[a.category]!.push(a);
    }

    for (const [cat, items] of Object.entries(categories)) {
      console.log(`\n  ${cat.toUpperCase()}:`);
      for (const a of items) {
        console.log(`    \u2022 ${a.name}: ${a.description}`);
      }
    }
    return true;
  }, 'List available SEO analyzers', 'seo');

  // seo:keyword <type> <id> <keyword> - Set focus keyword
  register('seo:keyword', async (args: string[]): Promise<boolean> => {
    if (args.length < 3) {
      console.log('Usage: seo:keyword <type> <id> <keyword>');
      console.log('Example: seo:keyword article my-post "node.js cms"');
      return true;
    }

    const [type, id, ...keywordParts] = args as [string, string, ...string[]];
    const keyword = keywordParts.join(' ').replace(/^["']|["']$/g, '');

    saveSeoMeta(type, id, { focusKeyword: keyword });
    console.log(`Focus keyword set to "${keyword}" for ${type}/${id}`);

    // Auto-run analysis
    const result = analyzeContent(type, id, { focusKeyword: keyword });
    console.log(`SEO Score: ${result.score}/100`);

    return true;
  }, 'Set focus keyword for content item', 'seo');

  // seo:description <type> <id> <description> - Set meta description
  register('seo:description', async (args: string[]): Promise<boolean> => {
    if (args.length < 3) {
      console.log('Usage: seo:description <type> <id> <description>');
      console.log('Example: seo:description article my-post "Learn about our CMS features and benefits"');
      return true;
    }

    const [type, id, ...descParts] = args as [string, string, ...string[]];
    const description = descParts.join(' ').replace(/^["']|["']$/g, '');

    saveSeoMeta(type, id, { metaDescription: description });
    console.log(`Meta description set for ${type}/${id}:`);
    console.log(`  "${description}"`);
    console.log(`  Length: ${description.length} characters`);

    // Provide length guidance
    const cfg = configData.metaDescription ?? DEFAULTS.metaDescription;
    if (description.length < cfg.minLength) {
      console.log(`  \u26A0\uFE0F  Too short (minimum ${cfg.minLength} characters)`);
    } else if (description.length > cfg.maxLength) {
      console.log(`  \u26A0\uFE0F  Too long (maximum ${cfg.maxLength} characters)`);
    } else if (description.length >= cfg.optimalMin && description.length <= cfg.optimalMax) {
      console.log(`  \u2705 Optimal length (${cfg.optimalMin}-${cfg.optimalMax} characters)`);
    } else {
      console.log(`  \u2705 Acceptable length`);
    }

    // Auto-run analysis with the new description
    const result = analyzeContent(type, id, { metaDescription: description });
    console.log(`\nSEO Score: ${result.score}/100`);

    return true;
  }, 'Set meta description for content item', 'seo');

  // seo:score <type> <id> - Show stored SEO score
  register('seo:score', async (args: string[]): Promise<boolean> => {
    if (args.length < 2) {
      console.log('Usage: seo:score <type> <id>');
      console.log('Example: seo:score article my-post');
      return true;
    }

    const [type, id] = args as [string, string, ...string[]];
    const score = getSeoScore(type, id);
    const scoreMeta = loadSeoMeta(type, id);

    if (score === null) {
      console.log(`No SEO score found for ${type}/${id}`);
      console.log('Run "seo:analyze" to calculate the score');
    } else {
      const scoreIcon = score >= 80 ? '\uD83D\uDFE2' : score >= 50 ? '\uD83D\uDFE1' : '\uD83D\uDD34';
      console.log(`\nSEO Score for ${type}/${id}: ${scoreIcon} ${score}/100`);
      if (scoreMeta?.lastAnalyzed) {
        console.log(`Last analyzed: ${scoreMeta.lastAnalyzed}`);
      }
      if (scoreMeta?.focusKeyword) {
        console.log(`Focus keyword: "${scoreMeta.focusKeyword}"`);
      }
    }
    return true;
  }, 'Show stored SEO score for content item', 'seo');

  // seo:meta <type> <id> - Show SEO metadata
  register('seo:meta', async (args: string[]): Promise<boolean> => {
    if (args.length < 2) {
      console.log('Usage: seo:meta <type> <id>');
      return true;
    }

    const [type, id] = args as [string, string, ...string[]];
    const metaData = loadSeoMeta(type, id);

    if (!metaData) {
      console.log(`No SEO metadata found for ${type}/${id}`);
    } else {
      console.log(`\nSEO Metadata for ${type}/${id}:`);
      for (const [key, value] of Object.entries(metaData)) {
        console.log(`  ${key}: ${value}`);
      }
    }
    return true;
  }, 'Show SEO metadata for content item', 'seo');

  // seo:scan <type> - Scan all content of a type
  register('seo:scan', async (args: string[]): Promise<boolean> => {
    if (args.length < 1) {
      console.log('Usage: seo:scan <type>');
      return true;
    }

    const type = args[0]!;
    if (!contentService) {
      console.log('Content service not available');
      return false;
    }

    try {
      const items = contentService.list(type);
      console.log(`\nScanning ${items.length} ${type}(s) for SEO issues...\n`);

      for (const item of items) {
        const result = analyze(item);
        const scoreIcon = result.score >= 80 ? '\uD83D\uDFE2' : result.score >= 50 ? '\uD83D\uDFE1' : '\uD83D\uDD34';
        console.log(`  ${scoreIcon} ${item.id} (${item.title ?? 'untitled'}): Score ${result.score}/100 - ${result.summary}`);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.log(`Error scanning ${type}: ${errMsg}`);
    }

    return true;
  }, 'Scan all content of a type for SEO issues', 'seo');
}

/**
 * Register HTTP routes for SEO API
 */
export function registerRoutes(router: RouterService, _auth: unknown): void {
  // GET /api/seo/analyze/:type/:id - Analyze content SEO
  router.register('GET', '/api/seo/analyze/:type/:id', async (req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> => {
    const { type, id } = params;
    const url = new URL(req.url!, `http://${req.headers.host ?? 'localhost'}`);
    const keyword = url.searchParams.get('keyword') ?? undefined;

    const result = analyzeContent(type!, id!, { focusKeyword: keyword });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  });

  // POST /api/seo/analyze - Analyze arbitrary content
  router.register('POST', '/api/seo/analyze', async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let body = '';
    for await (const chunk of req) body += chunk;

    try {
      const data = JSON.parse(body) as Record<string, unknown>;
      const contentItem = (data.content ?? data) as ContentItem;
      const focusKeyword = data.focusKeyword as string | undefined;
      const metaDescription = data.metaDescription as string | undefined;
      const result = analyze(contentItem, { focusKeyword, metaDescription });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON', message: errMsg }));
    }
  });

  // GET /api/seo/analyzers - List available analyzers
  router.register('GET', '/api/seo/analyzers', async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ analyzers: getAnalyzers() }));
  });

  // GET /api/seo/meta/:type/:id - Get SEO metadata
  router.register('GET', '/api/seo/meta/:type/:id', async (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> => {
    const { type, id } = params;
    const metaData = loadSeoMeta(type!, id!);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(metaData ?? {}));
  });

  // PUT /api/seo/meta/:type/:id - Save SEO metadata
  router.register('PUT', '/api/seo/meta/:type/:id', async (req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> => {
    const { type, id } = params;
    let body = '';
    for await (const chunk of req) body += chunk;

    try {
      const metaData = JSON.parse(body) as Partial<SeoMeta>;
      const updated = saveSeoMeta(type!, id!, metaData);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(updated));
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON', message: errMsg }));
    }
  });

  // GET /admin/seo - SEO admin dashboard
  router.register('GET', '/admin/seo', async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const allAnalyzers = getAnalyzers();

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>SEO Analyzer - Admin</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; }
    .container { max-width: 900px; margin: 0 auto; padding: 20px; }
    h1 { margin-bottom: 20px; }
    .card { background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .card h2 { margin-bottom: 15px; font-size: 18px; }
    .form-row { display: flex; gap: 10px; margin-bottom: 12px; align-items: end; }
    .form-group { display: flex; flex-direction: column; gap: 4px; }
    .form-group label { font-size: 12px; font-weight: 600; color: #666; }
    .form-group input { padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; }
    button { padding: 8px 20px; background: #0073aa; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; }
    button:hover { background: #005a87; }
    .score { font-size: 48px; font-weight: bold; text-align: center; margin: 20px 0; }
    .score-good { color: #2e7d32; }
    .score-ok { color: #f57f17; }
    .score-bad { color: #c62828; }
    .metric { padding: 12px; margin: 8px 0; border-left: 4px solid #ddd; background: #fafafa; border-radius: 0 4px 4px 0; }
    .metric-pass { border-left-color: #2e7d32; }
    .metric-error { border-left-color: #c62828; }
    .metric-warning { border-left-color: #f57f17; }
    .metric-info { border-left-color: #1565c0; }
    .metric-category { font-size: 11px; color: #999; text-transform: uppercase; letter-spacing: 1px; }
    .recommendation { font-size: 13px; color: #555; margin-top: 6px; font-style: italic; }
    .nav { background: #23282d; padding: 10px 20px; margin-bottom: 20px; }
    .nav a { color: #eee; text-decoration: none; margin-right: 15px; }
    .nav a:hover { color: white; }
    .analyzer-list { list-style: none; }
    .analyzer-list li { padding: 8px; border-bottom: 1px solid #eee; }
    .analyzer-list li:last-child { border-bottom: none; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: bold; background: #e3f2fd; color: #1565c0; }
  </style>
</head>
<body>
  <div class="nav">
    <a href="/admin">\u2190 Dashboard</a>
    <a href="/admin/seo">SEO</a>
    <a href="/admin/accessibility">Accessibility</a>
    <a href="/admin/content">Content</a>
  </div>
  <div class="container">
    <h1>\uD83D\uDCCA SEO Analyzer</h1>

    <div class="card">
      <h2>Analyze Content</h2>
      <div class="form-row">
        <div class="form-group">
          <label>Content Type</label>
          <input type="text" id="contentType" placeholder="e.g., article" value="article">
        </div>
        <div class="form-group">
          <label>Content ID</label>
          <input type="text" id="contentId" placeholder="e.g., my-post">
        </div>
        <div class="form-group">
          <label>Focus Keyword (optional)</label>
          <input type="text" id="focusKeyword" placeholder="e.g., node.js cms">
        </div>
        <button onclick="runAnalysis()">Analyze</button>
      </div>
      <div id="results"></div>
    </div>

    <div class="card">
      <h2>Available Analyzers (${allAnalyzers.length})</h2>
      <ul class="analyzer-list">
        ${allAnalyzers.map(a => `
          <li>
            <span class="badge">${a.category}</span>
            <strong>${a.name}</strong>
            <div style="font-size:13px;color:#666">${a.description}</div>
          </li>
        `).join('')}
      </ul>
    </div>
  </div>

  <script>
    async function runAnalysis() {
      const type = document.getElementById('contentType').value;
      const id = document.getElementById('contentId').value;
      const keyword = document.getElementById('focusKeyword').value;
      const resultsDiv = document.getElementById('results');

      if (!type || !id) {
        resultsDiv.innerHTML = '<p style="color:red">Please enter content type and ID</p>';
        return;
      }

      resultsDiv.innerHTML = '<p>Analyzing...</p>';

      try {
        let url = '/api/seo/analyze/' + type + '/' + id;
        if (keyword) url += '?keyword=' + encodeURIComponent(keyword);

        const resp = await fetch(url);
        const data = await resp.json();

        let scoreClass = data.score >= 80 ? 'score-good' : data.score >= 50 ? 'score-ok' : 'score-bad';

        let html = '<div class="score ' + scoreClass + '">' + data.score + '/100</div>';
        html += '<p style="text-align:center;margin-bottom:20px">' + data.summary + '</p>';
        if (data.focusKeyword) {
          html += '<p style="text-align:center;margin-bottom:20px;color:#666">Focus Keyword: <strong>"' + data.focusKeyword + '"</strong></p>';
        }

        if (data.metrics && data.metrics.length > 0) {
          for (const metric of data.metrics) {
            html += '<div class="metric metric-' + metric.status + '">';
            html += '<div class="metric-category">' + metric.category + '</div>';
            html += '<strong>' + metric.name + '</strong>: ' + metric.message;
            html += '</div>';
          }
        }

        if (data.recommendations && data.recommendations.length > 0) {
          html += '<h3 style="margin-top:20px;margin-bottom:10px">Recommendations</h3>';
          for (const rec of data.recommendations) {
            html += '<div class="recommendation">\uD83D\uDCA1 ' + rec.message + '</div>';
          }
        }

        resultsDiv.innerHTML = html;
      } catch (err) {
        resultsDiv.innerHTML = '<p style="color:red">Error: ' + err.message + '</p>';
      }
    }
  </script>
</body>
</html>`;

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });
}
