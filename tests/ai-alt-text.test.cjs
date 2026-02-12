/**
 * Tests for AI Alt Text Generation and Quality Scoring
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Import services
const altTextGenerator = require('../core/services/ai-alt-text-generator.cjs');
const altTextScorer = require('../core/services/alt-text-quality-scorer.cjs');

// Test suite
async function runTests() {
  console.log('Running AI Alt Text Tests...\n');

  let passed = 0;
  let failed = 0;

  // ========================================
  // Feature 1: Alt Text Generation Service
  // ========================================

  console.log('Feature 1: Alt Text Generation Service');
  console.log('=====================================');

  // Test 1: Service initialization
  try {
    await altTextGenerator.initialize({
      primaryProvider: 'openai',
      fallbackProviders: ['anthropic', 'gemini']
    });
    console.log('✓ Service initializes successfully');
    passed++;
  } catch (error) {
    console.log('✗ Service initialization failed:', error.message);
    failed++;
  }

  // Test 2: Provider registration
  try {
    assert(altTextGenerator.providers.size >= 3, 'Should register multiple providers');
    assert(altTextGenerator.providers.has('openai'), 'Should have OpenAI provider');
    assert(altTextGenerator.providers.has('anthropic'), 'Should have Anthropic provider');
    assert(altTextGenerator.providers.has('gemini'), 'Should have Gemini provider');
    console.log('✓ Providers registered correctly (OpenAI, Anthropic, Gemini)');
    passed++;
  } catch (error) {
    console.log('✗ Provider registration failed:', error.message);
    failed++;
  }

  // Test 3: Generate alt text with mock data
  try {
    const mockImageBuffer = Buffer.from('fake-image-data');
    const result = await altTextGenerator.generateAltText(mockImageBuffer);

    assert(result.altText, 'Should generate alt text');
    assert(typeof result.altText === 'string', 'Alt text should be string');
    assert(result.altText.length > 0, 'Alt text should not be empty');
    assert(result.provider, 'Should specify provider used');
    assert(result.confidence >= 0 && result.confidence <= 1, 'Confidence should be 0-1');
    console.log(`✓ Generates alt text: "${result.altText}"`);
    passed++;
  } catch (error) {
    console.log('✗ Alt text generation failed:', error.message);
    failed++;
  }

  // Test 4: Alt text sanitization
  try {
    const mockImageBuffer = Buffer.from('test-data');
    const result = await altTextGenerator.generateAltText(mockImageBuffer);

    // Check that redundant phrases are removed
    assert(!result.altText.toLowerCase().startsWith('image of'), 'Should remove "image of"');
    assert(!result.altText.toLowerCase().startsWith('picture of'), 'Should remove "picture of"');
    assert(result.altText[0] === result.altText[0].toUpperCase(), 'Should capitalize first letter');
    console.log('✓ Sanitizes alt text (removes redundant phrases)');
    passed++;
  } catch (error) {
    console.log('✗ Alt text sanitization failed:', error.message);
    failed++;
  }

  // Test 5: Rate limiting
  try {
    // Reinitialize with fresh rate limits
    const testGenerator = require('../core/services/ai-alt-text-generator.cjs');
    testGenerator.rateLimits = new Map(); // Reset rate limits

    await testGenerator.initialize({
      rateLimit: { requests: 2, perMinute: 60 }
    });

    const mockImage = Buffer.from('test');
    const result1 = await testGenerator.generateAltText(mockImage);
    const result2 = await testGenerator.generateAltText(mockImage);

    // Both should succeed
    assert(result1.altText, 'First request should succeed');
    assert(result2.altText, 'Second request should succeed');

    // Third request should fail due to rate limit
    const result3 = await testGenerator.generateAltText(mockImage);

    // Check if it failed (error property present)
    if (result3.error && result3.error.includes('Rate limit')) {
      console.log('✓ Rate limiting works correctly');
      passed++;
    } else {
      console.log('✗ Rate limiting not enforced');
      failed++;
    }
  } catch (error) {
    console.log('✗ Rate limiting test failed:', error.message);
    failed++;
  }

  console.log('');

  // ========================================
  // Feature 4: Alt Text Quality Scoring
  // ========================================

  console.log('Feature 4: Alt Text Quality Scoring Service');
  console.log('==========================================');

  // Test 6: Scoring excellent alt text
  try {
    const result = altTextScorer.score('Red vintage bicycle leaning against a brick wall with morning sunlight.');

    assert(result.score >= 75, 'Good alt text should score 75+');
    assert(result.rating === 'Excellent' || result.rating === 'Good', 'Should have positive rating');
    assert(result.passed === true, 'Should pass quality check');
    console.log(`✓ Scores good alt text: ${result.score}/100 (${result.rating})`);
    passed++;
  } catch (error) {
    console.log('✗ Good alt text scoring failed:', error.message);
    failed++;
  }

  // Test 7: Penalizing poor alt text
  try {
    const result = altTextScorer.score('image of dog');

    assert(result.score < 60, 'Poor alt text should score below 60');
    assert(result.suggestions.length > 0, 'Should provide suggestions');
    assert(result.passed === false, 'Should fail quality check');
    console.log(`✓ Penalizes poor alt text: ${result.score}/100 with ${result.suggestions.length} suggestions`);
    passed++;
  } catch (error) {
    console.log('✗ Poor alt text scoring failed:', error.message);
    failed++;
  }

  // Test 8: Length validation
  try {
    const tooShort = altTextScorer.score('dog');
    const tooLong = altTextScorer.score('This is an extremely long alt text description that goes on and on and on, providing way too much detail about every single aspect of the image which is definitely not recommended for accessibility purposes.');

    assert(tooShort.penalties.some(p => p.includes('short')), 'Should penalize short text');
    assert(tooLong.penalties.some(p => p.includes('long')), 'Should penalize long text');
    console.log('✓ Validates length constraints (min/max)');
    passed++;
  } catch (error) {
    console.log('✗ Length validation failed:', error.message);
    failed++;
  }

  // Test 9: Redundant phrase detection
  try {
    const redundant1 = altTextScorer.score('Image of a cat sitting on a couch.');
    const redundant2 = altTextScorer.score('Picture of mountains at sunset.');

    assert(redundant1.penalties.some(p => p.toLowerCase().includes('redundant')), 'Should detect "image of"');
    assert(redundant2.penalties.some(p => p.toLowerCase().includes('redundant')), 'Should detect "picture of"');
    console.log('✓ Detects redundant phrases (image of, picture of)');
    passed++;
  } catch (error) {
    console.log('✗ Redundant phrase detection failed:', error.message);
    failed++;
  }

  // Test 10: WCAG compliance checking
  try {
    const placeholder = altTextScorer.score('insert alt text here');

    assert(placeholder.score < 50, 'Placeholder text should score very low');
    assert(placeholder.penalties.some(p => p.toLowerCase().includes('wcag')), 'Should flag WCAG violation');
    console.log('✓ Validates WCAG compliance (flags placeholders)');
    passed++;
  } catch (error) {
    console.log('✗ WCAG compliance check failed:', error.message);
    failed++;
  }

  // Test 11: Scoring profiles
  try {
    const altText = 'A dog playing.';

    altTextScorer.setProfile('lenient');
    const lenient = altTextScorer.score(altText);

    altTextScorer.setProfile('strict');
    const strict = altTextScorer.score(altText);

    altTextScorer.setProfile('balanced');
    const balanced = altTextScorer.score(altText);

    assert(lenient.score >= balanced.score, 'Lenient should score higher');
    assert(strict.score <= balanced.score, 'Strict should score lower');
    console.log(`✓ Scoring profiles work: lenient=${lenient.score}, balanced=${balanced.score}, strict=${strict.score}`);
    passed++;
  } catch (error) {
    console.log('✗ Scoring profiles failed:', error.message);
    failed++;
  }

  // Test 12: Batch scoring
  try {
    const altTexts = [
      'Red bicycle against brick wall.',
      'image of cat',
      'Golden retriever puppy playing in park.',
      ''
    ];

    const results = altTextScorer.batchScore(altTexts);

    assert(results.length === 4, 'Should score all texts');
    assert(results[0].score > results[1].score, 'Good text should score higher than poor text');
    assert(results[3].score === 0, 'Empty text should score 0');
    console.log('✓ Batch scoring works correctly');
    passed++;
  } catch (error) {
    console.log('✗ Batch scoring failed:', error.message);
    failed++;
  }

  // Test 13: Criteria documentation
  try {
    const criteria = altTextScorer.getCriteria();

    assert(criteria.profiles, 'Should have profiles');
    assert(criteria.criteria, 'Should have criteria');
    assert(criteria.scoring, 'Should have scoring ranges');
    console.log('✓ Provides scoring criteria documentation');
    passed++;
  } catch (error) {
    console.log('✗ Criteria documentation failed:', error.message);
    failed++;
  }

  console.log('');

  // ========================================
  // Summary
  // ========================================

  console.log('========================================');
  console.log(`Tests Complete: ${passed} passed, ${failed} failed`);
  console.log('========================================');

  return { passed, failed, total: passed + failed };
}

// Run tests if executed directly
if (require.main === module) {
  runTests().then(results => {
    process.exit(results.failed > 0 ? 1 : 0);
  }).catch(error => {
    console.error('Test suite error:', error);
    process.exit(1);
  });
}

module.exports = runTests;
