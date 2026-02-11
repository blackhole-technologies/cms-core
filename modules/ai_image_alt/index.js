/**
 * ai_image_alt/index.js - AI-Powered Image Alt Text Generation
 *
 * WHY THIS EXISTS:
 * Automatically generates accessible, descriptive alt text for images using AI providers.
 * Improves web accessibility compliance and reduces manual content entry burden.
 *
 * DESIGN DECISIONS:
 * - Integrates with AI registry to use configured providers
 * - Supports multiple AI providers with automatic fallback
 * - Includes quality scoring to ensure alt text meets WCAG standards
 * - Provides both service API and CLI interface
 * - Stores generation metadata for analytics
 *
 * USAGE:
 *   const altTextService = services.get('ai-alt-text');
 *   const result = await altTextService.generate(imagePath);
 *   const score = await altTextService.scoreQuality(altText);
 */

import { readFileSync, existsSync } from 'node:fs';
import { basename, extname } from 'node:path';

/**
 * Service state
 */
let services = null;

/**
 * Supported image formats
 */
const SUPPORTED_FORMATS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Initialize the alt text generation service
 */
export function hook_boot(context) {
  services = context.services;

  // Register the alt text service
  services.register('ai-alt-text', () => ({
    generate: generateAltText,
    scoreQuality: scoreAltTextQuality,
    bulk: bulkGenerate
  }));

  console.log('[ai_image_alt] Alt text generation service loaded');
}

/**
 * Register CLI commands
 */
export function hook_cli(register, context) {
  // Generate alt text for a single image
  register('ai:alt:generate', async (args, ctx) => {
    const imagePath = args[0];

    if (!imagePath) {
      console.error('Error: Image path is required');
      console.log('Usage: node index.js ai:alt:generate <image-path>');
      return;
    }

    try {
      console.log(`\nGenerating alt text for: ${imagePath}`);
      const result = await generateAltText(imagePath, ctx.services);

      console.log('\nResult:');
      console.log(`  Alt Text: ${result.altText}`);
      console.log(`  Confidence: ${(result.confidence * 100).toFixed(1)}%`);
      console.log(`  Provider: ${result.provider}`);
      console.log(`  Quality Score: ${result.qualityScore}/100`);

      if (result.qualityFeedback && result.qualityFeedback.length > 0) {
        console.log('\nQuality Feedback:');
        result.qualityFeedback.forEach(feedback => {
          console.log(`  - ${feedback}`);
        });
      }
      console.log('');
    } catch (error) {
      console.error(`Error: ${error.message}`);
    }
  }, 'Generate alt text for an image using AI');

  // Bulk generate alt text
  register('ai:alt:bulk', async (args, ctx) => {
    const directory = args[0] || './media';

    console.log(`\nBulk generating alt text for images in: ${directory}\n`);

    try {
      const results = await bulkGenerate(directory, ctx.services);

      console.log('\nBulk Generation Complete:');
      console.log(`  Total: ${results.total}`);
      console.log(`  Success: ${results.success}`);
      console.log(`  Failed: ${results.failed}`);
      console.log(`  Skipped: ${results.skipped}`);
      console.log('');

      if (results.errors.length > 0) {
        console.log('Errors:');
        results.errors.forEach(err => {
          console.log(`  - ${err.file}: ${err.error}`);
        });
        console.log('');
      }
    } catch (error) {
      console.error(`Error: ${error.message}`);
    }
  }, 'Bulk generate alt text for all images in a directory');

  // Score alt text quality
  register('ai:alt:score', async (args, ctx) => {
    const altText = args.join(' ');

    if (!altText) {
      console.error('Error: Alt text is required');
      console.log('Usage: node index.js ai:alt:score <alt-text>');
      return;
    }

    try {
      const result = await scoreAltTextQuality(altText);

      console.log('\nAlt Text Quality Analysis:');
      console.log(`  Text: "${altText}"`);
      console.log(`  Score: ${result.score}/100`);
      console.log(`  Grade: ${result.grade}`);
      console.log('');

      if (result.feedback.length > 0) {
        console.log('Feedback:');
        result.feedback.forEach(feedback => {
          console.log(`  - ${feedback}`);
        });
        console.log('');
      }

      console.log('Criteria Breakdown:');
      for (const [criterion, score] of Object.entries(result.criteria)) {
        console.log(`  ${criterion}: ${score}/20`);
      }
      console.log('');
    } catch (error) {
      console.error(`Error: ${error.message}`);
    }
  }, 'Score the quality of alt text');
}

/**
 * Generate alt text for an image
 *
 * @param {string} imagePath - Path to the image file
 * @param {Object} serviceContainer - Service container (optional, uses module-level if not provided)
 * @returns {Promise<Object>} - Generated alt text with metadata
 */
async function generateAltText(imagePath, serviceContainer = null) {
  const svc = serviceContainer || services;

  // Validate image exists
  if (!existsSync(imagePath)) {
    throw new Error(`Image not found: ${imagePath}`);
  }

  // Validate file format
  const ext = extname(imagePath).toLowerCase().replace('.', '');
  if (!SUPPORTED_FORMATS.includes(ext)) {
    throw new Error(`Unsupported image format: ${ext}. Supported: ${SUPPORTED_FORMATS.join(', ')}`);
  }

  // Check file size
  const stats = await import('node:fs/promises').then(fs => fs.stat(imagePath));
  if (stats.size > MAX_IMAGE_SIZE) {
    throw new Error(`Image too large: ${(stats.size / 1024 / 1024).toFixed(2)}MB. Maximum: ${MAX_IMAGE_SIZE / 1024 / 1024}MB`);
  }

  // Read image data
  const imageData = readFileSync(imagePath);
  const imageBase64 = imageData.toString('base64');

  // Get AI registry to find available providers
  const aiRegistry = svc.get('ai-registry');
  const providers = aiRegistry.getByType('provider');

  if (providers.length === 0) {
    throw new Error('No AI providers available. Please configure at least one provider.');
  }

  // Try providers in order until one succeeds
  let lastError = null;
  for (const provider of providers) {
    if (provider.status !== 'active') {
      continue;
    }

    try {
      // Call AI provider to generate alt text
      const result = await callProviderForAltText(provider, imageBase64, ext, svc);

      // Score the quality of generated alt text
      const qualityResult = await scoreAltTextQuality(result.altText);

      // Log the operation
      const aiStats = svc.get('ai-stats');
      if (aiStats) {
        aiStats.log({
          provider: provider.name,
          operation: 'generate-alt-text',
          tokensIn: result.tokensIn || 0,
          tokensOut: result.tokensOut || 0,
          responseTime: result.responseTime || 0,
          status: 'success',
          cost: result.cost || 0
        });
      }

      return {
        altText: result.altText,
        confidence: result.confidence || 0.9,
        provider: provider.name,
        qualityScore: qualityResult.score,
        qualityGrade: qualityResult.grade,
        qualityFeedback: qualityResult.feedback,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      lastError = error;
      console.warn(`[ai_image_alt] Provider ${provider.name} failed: ${error.message}`);

      // Log the error
      const aiStats = svc.get('ai-stats');
      if (aiStats) {
        aiStats.log({
          provider: provider.name,
          operation: 'generate-alt-text',
          tokensIn: 0,
          tokensOut: 0,
          responseTime: 0,
          status: 'error',
          error: error.message,
          cost: 0
        });
      }
    }
  }

  throw new Error(`All providers failed. Last error: ${lastError?.message || 'Unknown error'}`);
}

/**
 * Call an AI provider to generate alt text
 *
 * @param {Object} provider - Provider metadata
 * @param {string} imageBase64 - Base64-encoded image data
 * @param {string} format - Image format (jpg, png, etc)
 * @param {Object} svc - Service container
 * @returns {Promise<Object>} - Provider response
 */
async function callProviderForAltText(provider, imageBase64, format, svc) {
  // For now, use a mock implementation since we don't have actual AI providers configured
  // In production, this would call the actual provider API

  // Simulate AI processing delay
  await new Promise(resolve => setTimeout(resolve, 100));

  // Generate mock alt text based on provider
  const mockAltTexts = [
    'A photograph showing a scenic landscape with mountains in the background and a lake in the foreground',
    'An image depicting a modern office workspace with a laptop, coffee cup, and notepad on a desk',
    'A close-up photo of colorful flowers blooming in a garden during springtime',
    'An illustration showing a group of people collaborating around a conference table',
    'A screenshot displaying a user interface with navigation elements and content sections'
  ];

  const altText = mockAltTexts[Math.floor(Math.random() * mockAltTexts.length)];

  return {
    altText,
    confidence: 0.85 + Math.random() * 0.1,
    tokensIn: Math.floor(500 + Math.random() * 500),
    tokensOut: Math.floor(20 + Math.random() * 30),
    responseTime: Math.floor(100 + Math.random() * 200),
    cost: 0.002 + Math.random() * 0.003
  };
}

/**
 * Score the quality of alt text based on accessibility guidelines
 *
 * @param {string} altText - The alt text to score
 * @returns {Object} - Quality score with feedback
 */
async function scoreAltTextQuality(altText) {
  if (!altText || typeof altText !== 'string') {
    throw new Error('Alt text is required and must be a string');
  }

  const criteria = {
    length: 0,        // Optimal length (5-125 chars)
    specificity: 0,   // Contains specific details (proper nouns, colors, numbers)
    clarity: 0,       // Clear, descriptive language
    accessibility: 0, // Follows WCAG guidelines
    technical: 0      // No file extensions, jargon, or redundant phrases
  };

  const feedback = [];

  // Length check (5-125 characters is ideal)
  const length = altText.trim().length;
  if (length < 5) {
    criteria.length = 5;
    feedback.push('Alt text is too short. Aim for at least 5 characters.');
  } else if (length > 125) {
    criteria.length = 10;
    feedback.push('Alt text is too long. Keep it under 125 characters.');
  } else if (length >= 5 && length <= 50) {
    criteria.length = 20;
  } else if (length > 50 && length <= 125) {
    criteria.length = 18;
  }

  // Specificity check - look for concrete details
  const hasProperNouns = /[A-Z][a-z]+/.test(altText);
  const hasNumbers = /\d+/.test(altText);
  const hasColors = /(red|blue|green|yellow|orange|purple|pink|black|white|gray|brown|silver|gold)/i.test(altText);

  let specificityScore = 10;
  if (hasProperNouns) specificityScore += 4;
  if (hasNumbers) specificityScore += 3;
  if (hasColors) specificityScore += 3;
  criteria.specificity = Math.min(specificityScore, 20);

  if (specificityScore < 15) {
    feedback.push('Consider adding more specific details (names, colors, numbers, etc.).');
  }

  // Clarity check - avoid generic phrases
  const genericPhrases = [
    'image of', 'picture of', 'photo of', 'graphic of',
    'a image', 'an image', 'this shows', 'this depicts'
  ];

  let clarityScore = 20;
  for (const phrase of genericPhrases) {
    if (altText.toLowerCase().includes(phrase)) {
      clarityScore -= 5;
      feedback.push(`Avoid generic phrase: "${phrase}". Be more direct.`);
      break;
    }
  }
  criteria.clarity = Math.max(clarityScore, 5);

  // Accessibility check - WCAG guidelines
  let accessibilityScore = 20;

  // Check for redundant "alt" or "alternative text"
  if (/\b(alt|alternative)\s+(text|tag|attribute)\b/i.test(altText)) {
    accessibilityScore -= 5;
    feedback.push('Do not include "alt text" or similar phrases in the alt text itself.');
  }

  // Check for ending punctuation (good practice)
  if (!/[.!?]$/.test(altText)) {
    accessibilityScore -= 2;
    feedback.push('Consider ending with punctuation for better screen reader pauses.');
  }

  criteria.accessibility = Math.max(accessibilityScore, 5);

  // Technical check - no file extensions or technical jargon
  let technicalScore = 20;

  const fileExtensions = /\.(jpg|jpeg|png|gif|webp|svg|bmp|tiff?)/i;
  if (fileExtensions.test(altText)) {
    technicalScore -= 8;
    feedback.push('Remove file extensions from alt text.');
  }

  // Check for technical jargon
  if (/\b(pixel|resolution|dpi|rgb|cmyk|file|document)\b/i.test(altText)) {
    technicalScore -= 5;
    feedback.push('Avoid technical jargon. Describe what the image shows, not its technical properties.');
  }

  criteria.technical = Math.max(technicalScore, 5);

  // Calculate total score
  const totalScore = Object.values(criteria).reduce((sum, score) => sum + score, 0);

  // Determine grade
  let grade;
  if (totalScore >= 90) grade = 'A (Excellent)';
  else if (totalScore >= 80) grade = 'B (Good)';
  else if (totalScore >= 70) grade = 'C (Fair)';
  else if (totalScore >= 60) grade = 'D (Needs Improvement)';
  else grade = 'F (Poor)';

  return {
    score: totalScore,
    grade,
    criteria,
    feedback: feedback.length > 0 ? feedback : ['Alt text meets quality standards.']
  };
}

/**
 * Bulk generate alt text for all images in a directory
 *
 * @param {string} directory - Directory path
 * @param {Object} serviceContainer - Service container
 * @returns {Promise<Object>} - Bulk operation results
 */
async function bulkGenerate(directory, serviceContainer = null) {
  const { readdir } = await import('node:fs/promises');
  const { join } = await import('node:path');

  if (!existsSync(directory)) {
    throw new Error(`Directory not found: ${directory}`);
  }

  const files = await readdir(directory);
  const imageFiles = files.filter(file => {
    const ext = extname(file).toLowerCase().replace('.', '');
    return SUPPORTED_FORMATS.includes(ext);
  });

  const results = {
    total: imageFiles.length,
    success: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    generated: []
  };

  for (const file of imageFiles) {
    const filePath = join(directory, file);

    try {
      const result = await generateAltText(filePath, serviceContainer);
      results.success++;
      results.generated.push({
        file,
        altText: result.altText,
        qualityScore: result.qualityScore
      });

      console.log(`✓ ${file}: ${result.altText} (Score: ${result.qualityScore}/100)`);
    } catch (error) {
      results.failed++;
      results.errors.push({
        file,
        error: error.message
      });

      console.error(`✗ ${file}: ${error.message}`);
    }
  }

  return results;
}
