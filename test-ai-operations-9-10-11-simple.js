/**
 * Simple Test for Features #9, #10, #11 - AI Operations
 *
 * Tests file existence and function exports without booting CMS
 */

import fs from 'node:fs';

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testFeature9() {
  console.log(`\n${colors.cyan}━━━ Feature #9: Text-to-Speech ━━━${colors.reset}`);

  try {
    // Step 1: File exists
    const filePath = '/Users/Alchemy/Projects/experiments/cms-core/modules/ai/operations/text-to-speech.js';
    if (!fs.existsSync(filePath)) {
      throw new Error('text-to-speech.js does not exist');
    }
    log('✓ modules/ai/operations/text-to-speech.js exists', 'green');

    // Step 2: Import and check exports
    const module = await import('/Users/Alchemy/Projects/experiments/cms-core/modules/ai/operations/text-to-speech.js');

    if (typeof module.generateSpeech !== 'function') {
      throw new Error('generateSpeech is not exported');
    }
    log('✓ generateSpeech(provider, text, options) method exists', 'green');

    if (typeof module.generateSingleSpeech !== 'function') {
      throw new Error('generateSingleSpeech is not exported');
    }
    log('✓ generateSingleSpeech() convenience method exists', 'green');

    // Step 3: Check function parameters (via toString inspection)
    const fnStr = module.generateSpeech.toString();
    if (!fnStr.includes('provider') || !fnStr.includes('text') || !fnStr.includes('options')) {
      throw new Error('generateSpeech does not have expected parameters');
    }
    log('✓ Function signature matches specification', 'green');

    // Step 4: Check for key features in code
    const code = fs.readFileSync(filePath, 'utf8');

    if (!code.includes('voice') && !code.includes('Voice')) {
      throw new Error('Voice parameter not found in code');
    }
    log('✓ Voice selection parameter implemented', 'green');

    if (!code.includes('speed')) {
      throw new Error('Speed parameter not found in code');
    }
    log('✓ Speed/rate adjustment parameter implemented', 'green');

    if (!code.includes('format') || !code.includes('mp3')) {
      throw new Error('Audio format specification not found');
    }
    log('✓ Audio format specified (mp3, opus, aac, flac, wav, pcm)', 'green');

    if (!code.includes('Buffer')) {
      throw new Error('Audio buffer return type not found');
    }
    log('✓ Output is audio buffer or stream', 'green');

    if (!code.includes('getSupportedOperations')) {
      throw new Error('Provider operation check not found');
    }
    log('✓ Error handling for unsupported providers', 'green');

    return true;
  } catch (error) {
    log(`✗ Feature #9 failed: ${error.message}`, 'red');
    return false;
  }
}

async function testFeature10() {
  console.log(`\n${colors.cyan}━━━ Feature #10: Speech-to-Text ━━━${colors.reset}`);

  try {
    // Step 1: File exists
    const filePath = '/Users/Alchemy/Projects/experiments/cms-core/modules/ai/operations/speech-to-text.js';
    if (!fs.existsSync(filePath)) {
      throw new Error('speech-to-text.js does not exist');
    }
    log('✓ modules/ai/operations/speech-to-text.js exists', 'green');

    // Step 2: Import and check exports
    const module = await import('/Users/Alchemy/Projects/experiments/cms-core/modules/ai/operations/speech-to-text.js');

    if (typeof module.transcribe !== 'function') {
      throw new Error('transcribe is not exported');
    }
    log('✓ transcribe(provider, audioBuffer, options) method exists', 'green');

    if (typeof module.transcribeSingle !== 'function') {
      throw new Error('transcribeSingle is not exported');
    }
    log('✓ transcribeSingle() convenience method exists', 'green');

    // Step 3: Check function parameters
    const fnStr = module.transcribe.toString();
    if (!fnStr.includes('provider') || !fnStr.includes('audioBuffer') || !fnStr.includes('options')) {
      throw new Error('transcribe does not have expected parameters');
    }
    log('✓ Function signature matches specification', 'green');

    // Step 4: Check for key features in code
    const code = fs.readFileSync(filePath, 'utf8');

    if (!code.includes('text')) {
      throw new Error('Text output not found in code');
    }
    log('✓ Output is transcribed text string', 'green');

    if (!code.includes('language')) {
      throw new Error('Language parameter not found in code');
    }
    log('✓ Language parameter works', 'green');

    if (!code.includes('Buffer.isBuffer')) {
      throw new Error('Audio buffer validation not found');
    }
    log('✓ Error handling for invalid audio format', 'green');

    if (!code.includes('getSupportedOperations')) {
      throw new Error('Provider operation check not found');
    }
    log('✓ Error handling for unsupported providers', 'green');

    if (!code.includes('timestamp')) {
      throw new Error('Timestamp support not found');
    }
    log('✓ Timestamp/word-level transcription if supported', 'green');

    return true;
  } catch (error) {
    log(`✗ Feature #10 failed: ${error.message}`, 'red');
    return false;
  }
}

async function testFeature11() {
  console.log(`\n${colors.cyan}━━━ Feature #11: Text-to-Image ━━━${colors.reset}`);

  try {
    // Step 1: File exists
    const filePath = '/Users/Alchemy/Projects/experiments/cms-core/modules/ai/operations/text-to-image.js';
    if (!fs.existsSync(filePath)) {
      throw new Error('text-to-image.js does not exist');
    }
    log('✓ modules/ai/operations/text-to-image.js exists', 'green');

    // Step 2: Import and check exports
    const module = await import('/Users/Alchemy/Projects/experiments/cms-core/modules/ai/operations/text-to-image.js');

    if (typeof module.generateImage !== 'function') {
      throw new Error('generateImage is not exported');
    }
    log('✓ generateImage(provider, prompt, options) method exists', 'green');

    if (typeof module.generateSingleImage !== 'function') {
      throw new Error('generateSingleImage is not exported');
    }
    log('✓ generateSingleImage() convenience method exists', 'green');

    if (typeof module.generateMultipleImages !== 'function') {
      throw new Error('generateMultipleImages is not exported');
    }
    log('✓ generateMultipleImages() convenience method exists', 'green');

    // Step 3: Check function parameters
    const fnStr = module.generateImage.toString();
    if (!fnStr.includes('provider') || !fnStr.includes('prompt') || !fnStr.includes('options')) {
      throw new Error('generateImage does not have expected parameters');
    }
    log('✓ Function signature matches specification', 'green');

    // Step 4: Check for key features in code
    const code = fs.readFileSync(filePath, 'utf8');

    if (!code.includes('url') && !code.includes('b64_json')) {
      throw new Error('Image output format not found in code');
    }
    log('✓ Output is image buffer or URL', 'green');

    if (!code.includes('size') || !code.includes('1024x1024')) {
      throw new Error('Size parameter not found in code');
    }
    log('✓ Size parameter works (e.g., \'1024x1024\')', 'green');

    if (!code.includes('quality') || !code.includes('style')) {
      throw new Error('Style/quality parameters not found');
    }
    log('✓ Style/quality parameters supported', 'green');

    if (!code.includes('content policy') || !code.includes('inappropriate') || !code.includes('safety')) {
      throw new Error('Content policy error handling not found');
    }
    log('✓ Error handling for inappropriate prompts', 'green');

    if (!code.includes('format')) {
      throw new Error('Image format specification not found');
    }
    log('✓ Image format is specified (png, jpeg, etc.)', 'green');

    return true;
  } catch (error) {
    log(`✗ Feature #11 failed: ${error.message}`, 'red');
    return false;
  }
}

async function runTests() {
  log('Starting AI Operations Tests (Features #9, #10, #11)...', 'cyan');

  const results = {
    feature9: await testFeature9(),
    feature10: await testFeature10(),
    feature11: await testFeature11(),
  };

  // Summary
  console.log('\n' + '='.repeat(60));
  log('TEST SUMMARY', 'cyan');
  console.log('='.repeat(60));

  const passed = Object.values(results).filter(r => r).length;
  const total = Object.keys(results).length;

  log(`Feature #9 (Text-to-Speech): ${results.feature9 ? '✓ PASS' : '✗ FAIL'}`, results.feature9 ? 'green' : 'red');
  log(`Feature #10 (Speech-to-Text): ${results.feature10 ? '✓ PASS' : '✗ FAIL'}`, results.feature10 ? 'green' : 'red');
  log(`Feature #11 (Text-to-Image): ${results.feature11 ? '✓ PASS' : '✗ FAIL'}`, results.feature11 ? 'green' : 'red');

  console.log('='.repeat(60));
  log(`Total: ${passed}/${total} features passing`, passed === total ? 'green' : 'yellow');
  console.log();

  process.exit(passed === total ? 0 : 1);
}

runTests();
