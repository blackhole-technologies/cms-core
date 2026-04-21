#!/usr/bin/env node
/**
 * Regression test for AI Core features 1, 2, and 3
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import AIProviderInterface from '../../modules/ai/core/provider-interface.js';
import providerManager from '../../modules/ai/core/provider-manager.js';
import OpenAIProvider from '../../modules/ai/providers/openai.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const results = {
  feature1: { passed: [], failed: [] },
  feature2: { passed: [], failed: [] },
  feature3: { passed: [], failed: [] }
};

console.log('=== AI Core Regression Testing ===\n');

// Feature 1: AI Provider plugin interface exists
console.log('Testing Feature 1: AI Provider plugin interface exists');
try {
  // Step 1: Verify file exists
  const interfacePath = path.join(__dirname, 'modules/ai/core/provider-interface.js');
  if (fs.existsSync(interfacePath)) {
    results.feature1.passed.push('✓ provider-interface.js exists');
  } else {
    results.feature1.failed.push('✗ provider-interface.js not found');
  }

  // Step 2: Check that it exports a base class
  if (typeof AIProviderInterface === 'function') {
    results.feature1.passed.push('✓ Interface exports a base class');
  } else {
    results.feature1.failed.push('✗ Interface does not export a class');
  }

  // Step 3-5: Check required methods exist
  const prototype = AIProviderInterface.prototype;
  const requiredMethods = ['getModels', 'isUsable', 'getSupportedOperations'];

  for (const method of requiredMethods) {
    if (typeof prototype[method] === 'function') {
      results.feature1.passed.push(`✓ ${method}() method is defined`);
    } else {
      results.feature1.failed.push(`✗ ${method}() method is missing`);
    }
  }

  // Step 6: Check for JSDoc (basic check - methods have comments)
  const interfaceSource = fs.readFileSync(interfacePath, 'utf-8');
  if (interfaceSource.includes('/**') && interfaceSource.includes('@returns')) {
    results.feature1.passed.push('✓ JSDoc documentation present');
  } else {
    results.feature1.failed.push('✗ JSDoc documentation missing');
  }

  // Step 7: Check for required config properties
  const testInstance = Object.create(AIProviderInterface.prototype);
  testInstance.config = {};
  if (typeof testInstance.getRequiredConfig === 'function') {
    const config = testInstance.getRequiredConfig.call({ getRequiredConfig: AIProviderInterface.prototype.getRequiredConfig });
    if (Array.isArray(config) && config.length > 0) {
      results.feature1.passed.push('✓ Required configuration properties defined');
    } else {
      results.feature1.failed.push('✗ Required configuration not properly defined');
    }
  }

} catch (error) {
  results.feature1.failed.push(`✗ Error: ${error.message}`);
}

console.log(results.feature1.passed.join('\n'));
if (results.feature1.failed.length > 0) {
  console.log(results.feature1.failed.join('\n'));
}
console.log('');

// Feature 2: AI Provider plugin manager works
console.log('Testing Feature 2: AI Provider plugin manager works');
try {
  // Step 1: Verify file exists
  const managerPath = path.join(__dirname, 'modules/ai/core/provider-manager.js');
  if (fs.existsSync(managerPath)) {
    results.feature2.passed.push('✓ provider-manager.js exists');
  } else {
    results.feature2.failed.push('✗ provider-manager.js not found');
  }

  // Step 2: Test discoverProviders()
  if (typeof providerManager.discoverProviders === 'function') {
    const providers = await providerManager.discoverProviders();
    if (Array.isArray(providers)) {
      results.feature2.passed.push(`✓ discoverProviders() returns array (found ${providers.length} providers)`);

      if (providers.includes('openai')) {
        results.feature2.passed.push('✓ OpenAI provider discovered');
      }
    } else {
      results.feature2.failed.push('✗ discoverProviders() does not return array');
    }
  } else {
    results.feature2.failed.push('✗ discoverProviders() method missing');
  }

  // Step 3: Test loadProvider()
  if (typeof providerManager.loadProvider === 'function') {
    try {
      const provider = await providerManager.loadProvider('openai', { apiKey: 'test-key' });
      if (provider) {
        results.feature2.passed.push('✓ loadProvider() instantiates provider');

        // Step 4: Verify loaded provider implements interface
        if (typeof provider.getModels === 'function' &&
            typeof provider.isUsable === 'function' &&
            typeof provider.getSupportedOperations === 'function') {
          results.feature2.passed.push('✓ Loaded provider implements interface');
        } else {
          results.feature2.failed.push('✗ Loaded provider missing required methods');
        }
      }
    } catch (error) {
      results.feature2.failed.push(`✗ loadProvider() error: ${error.message}`);
    }
  } else {
    results.feature2.failed.push('✗ loadProvider() method missing');
  }

  // Step 5: Test error handling for missing provider
  try {
    await providerManager.loadProvider('nonexistent-provider');
    results.feature2.failed.push('✗ Should throw error for missing provider');
  } catch (error) {
    if (error.message.includes('not found') || error.message.includes('Provider not found')) {
      results.feature2.passed.push('✓ Error handling for missing provider works');
    } else {
      results.feature2.failed.push(`✗ Wrong error for missing provider: ${error.message}`);
    }
  }

  // Step 6: Test caching
  const provider1 = await providerManager.loadProvider('openai', { apiKey: 'test' });
  const provider2 = await providerManager.loadProvider('openai', { apiKey: 'test' });
  if (provider1 === provider2) {
    results.feature2.passed.push('✓ Provider instances are cached and reused');
  } else {
    results.feature2.failed.push('✗ Provider caching not working');
  }

  // Step 7: Test configuration passing
  const configuredProvider = await providerManager.loadProvider('openai', { apiKey: 'my-key' });
  if (configuredProvider.config && configuredProvider.config.apiKey === 'my-key') {
    results.feature2.passed.push('✓ Configuration passed during instantiation');
  } else {
    results.feature2.failed.push('✗ Configuration not properly passed');
  }

} catch (error) {
  results.feature2.failed.push(`✗ Error: ${error.message}`);
}

console.log(results.feature2.passed.join('\n'));
if (results.feature2.failed.length > 0) {
  console.log(results.feature2.failed.join('\n'));
}
console.log('');

// Feature 3: OpenAI provider implemented
console.log('Testing Feature 3: OpenAI provider implemented');
try {
  // Step 1: Verify file exists
  const openaiPath = path.join(__dirname, 'modules/ai/providers/openai.js');
  if (fs.existsSync(openaiPath)) {
    results.feature3.passed.push('✓ openai.js exists');
  } else {
    results.feature3.failed.push('✗ openai.js not found');
  }

  // Step 2: Check it extends the base interface
  const provider = new OpenAIProvider({ apiKey: 'test-key' });
  if (provider instanceof AIProviderInterface) {
    results.feature3.passed.push('✓ OpenAI provider extends AIProviderInterface');
  } else {
    results.feature3.failed.push('✗ OpenAI provider does not extend interface');
  }

  // Step 3: Test getModels()
  if (typeof provider.getModels === 'function') {
    const models = await provider.getModels();
    const modelIds = models.map(m => m.id);

    if (modelIds.includes('gpt-4') && modelIds.includes('gpt-3.5-turbo')) {
      results.feature3.passed.push('✓ getModels() returns OpenAI models (gpt-4, gpt-3.5-turbo, etc.)');
    } else {
      results.feature3.failed.push('✗ getModels() missing expected models');
    }
  } else {
    results.feature3.failed.push('✗ getModels() method missing');
  }

  // Step 4: Test getSupportedOperations()
  if (typeof provider.getSupportedOperations === 'function') {
    const operations = provider.getSupportedOperations();
    const expected = ['chat', 'embeddings', 'text-to-speech', 'text-to-image'];

    if (expected.every(op => operations.includes(op))) {
      results.feature3.passed.push('✓ getSupportedOperations() returns all expected operations');
    } else {
      results.feature3.failed.push(`✗ getSupportedOperations() missing operations. Got: ${operations.join(', ')}`);
    }
  } else {
    results.feature3.failed.push('✗ getSupportedOperations() method missing');
  }

  // Step 5: Test isUsable() with API key
  const providerWithKey = new OpenAIProvider({ apiKey: 'test-key' });
  if (typeof providerWithKey.isUsable === 'function') {
    const usable = await providerWithKey.isUsable();
    if (usable === true) {
      results.feature3.passed.push('✓ isUsable() returns true when API key configured');
    } else {
      results.feature3.failed.push('✗ isUsable() should return true with API key');
    }
  } else {
    results.feature3.failed.push('✗ isUsable() method missing');
  }

  // Step 6: Test isUsable() without API key
  const providerNoKey = new OpenAIProvider({});
  const usableNoKey = await providerNoKey.isUsable();
  if (usableNoKey === false) {
    results.feature3.passed.push('✓ isUsable() returns false when API key missing');
  } else {
    results.feature3.failed.push('✗ isUsable() should return false without API key');
  }

  // Step 7: Verify API format (check that methods exist and use correct endpoints)
  if (typeof provider.chat === 'function' &&
      typeof provider.embeddings === 'function' &&
      typeof provider.textToSpeech === 'function' &&
      typeof provider.textToImage === 'function') {
    results.feature3.passed.push('✓ API methods implemented (chat, embeddings, textToSpeech, textToImage)');

    // Check the source code uses official OpenAI endpoints
    const source = fs.readFileSync(openaiPath, 'utf-8');
    if (source.includes('api.openai.com/v1') &&
        source.includes('/chat/completions') &&
        source.includes('/embeddings') &&
        source.includes('/audio/speech') &&
        source.includes('/images/generations')) {
      results.feature3.passed.push('✓ Uses official OpenAI API endpoints');
    } else {
      results.feature3.failed.push('✗ Not using correct OpenAI API endpoints');
    }
  } else {
    results.feature3.failed.push('✗ API methods missing');
  }

} catch (error) {
  results.feature3.failed.push(`✗ Error: ${error.message}`);
}

console.log(results.feature3.passed.join('\n'));
if (results.feature3.failed.length > 0) {
  console.log(results.feature3.failed.join('\n'));
}
console.log('');

// Summary
console.log('=== Summary ===');
const feature1Status = results.feature1.failed.length === 0 ? 'PASS' : 'FAIL';
const feature2Status = results.feature2.failed.length === 0 ? 'PASS' : 'FAIL';
const feature3Status = results.feature3.failed.length === 0 ? 'PASS' : 'FAIL';

console.log(`Feature 1 (AI Provider Interface): ${feature1Status}`);
console.log(`  Passed: ${results.feature1.passed.length}, Failed: ${results.feature1.failed.length}`);

console.log(`Feature 2 (Provider Manager): ${feature2Status}`);
console.log(`  Passed: ${results.feature2.passed.length}, Failed: ${results.feature2.failed.length}`);

console.log(`Feature 3 (OpenAI Provider): ${feature3Status}`);
console.log(`  Passed: ${results.feature3.passed.length}, Failed: ${results.feature3.failed.length}`);

// Exit with error code if any feature failed
const allPassed = feature1Status === 'PASS' && feature2Status === 'PASS' && feature3Status === 'PASS';
process.exit(allPassed ? 0 : 1);
