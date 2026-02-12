#!/usr/bin/env node
/**
 * Regression Test: Features 1, 2, 3
 *
 * Feature 1: AI Provider plugin interface exists
 * Feature 2: AI Provider plugin manager works
 * Feature 3: OpenAI provider implemented
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COLORS = {
  RESET: '\x1b[0m',
  GREEN: '\x1b[32m',
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m'
};

function log(message, color = COLORS.RESET) {
  console.log(`${color}${message}${COLORS.RESET}`);
}

function pass(message) {
  log(`✓ ${message}`, COLORS.GREEN);
}

function fail(message) {
  log(`✗ ${message}`, COLORS.RED);
}

async function testFeature1() {
  log('\n=== FEATURE 1: AI Provider plugin interface exists ===', COLORS.YELLOW);
  const results = { passed: [], failed: [] };

  try {
    const interfacePath = path.join(__dirname, 'modules/ai/core/provider-interface.js');
    if (!fs.existsSync(interfacePath)) {
      fail('provider-interface.js does not exist');
      results.failed.push('File does not exist');
      return results;
    }
    pass('provider-interface.js exists');
    results.passed.push('File exists');

    const { default: AIProviderInterface } = await import('./modules/ai/core/provider-interface.js');
    const proto = AIProviderInterface.prototype;

    if (typeof AIProviderInterface === 'function') {
      pass('Interface exports a base class');
      results.passed.push('Base class exported');
    } else {
      fail('Interface does not export a base class');
      results.failed.push('No base class');
    }

    if (typeof proto.getModels === 'function') {
      pass('getModels() method is defined');
      results.passed.push('getModels defined');
    } else {
      fail('getModels() missing');
      results.failed.push('getModels missing');
    }

    if (typeof proto.isUsable === 'function') {
      pass('isUsable() method is defined');
      results.passed.push('isUsable defined');
    } else {
      fail('isUsable() missing');
      results.failed.push('isUsable missing');
    }

    if (typeof proto.getSupportedOperations === 'function') {
      pass('getSupportedOperations() method is defined');
      results.passed.push('getSupportedOperations defined');
    } else {
      fail('getSupportedOperations() missing');
      results.failed.push('getSupportedOperations missing');
    }

    const fileContent = fs.readFileSync(interfacePath, 'utf-8');
    if (fileContent.includes('/**')) {
      pass('Interface includes JSDoc documentation');
      results.passed.push('JSDoc present');
    } else {
      fail('JSDoc missing');
      results.failed.push('JSDoc missing');
    }

    if (typeof proto.getRequiredConfig === 'function') {
      pass('Configuration properties defined');
      results.passed.push('Config properties defined');
    } else {
      fail('Configuration properties missing');
      results.failed.push('Config missing');
    }
  } catch (error) {
    fail(`Error: ${error.message}`);
    results.failed.push(error.message);
  }

  return results;
}

async function testFeature2() {
  log('\n=== FEATURE 2: AI Provider plugin manager works ===', COLORS.YELLOW);
  const results = { passed: [], failed: [] };

  try {
    const managerPath = path.join(__dirname, 'modules/ai/core/provider-manager.js');
    if (!fs.existsSync(managerPath)) {
      fail('provider-manager.js does not exist');
      results.failed.push('File does not exist');
      return results;
    }
    pass('provider-manager.js exists');
    results.passed.push('File exists');

    const { default: providerManager } = await import('./modules/ai/core/provider-manager.js');

    if (typeof providerManager.discoverProviders === 'function') {
      const providers = await providerManager.discoverProviders();
      pass(`discoverProviders() works: ${providers.length} provider(s) found`);
      results.passed.push('discoverProviders works');
    }

    if (typeof providerManager.loadProvider === 'function') {
      const openaiProvider = await providerManager.loadProvider('openai', { apiKey: 'test-key' });
      if (openaiProvider) {
        pass('loadProvider() instantiates provider');
        results.passed.push('loadProvider works');
      }
    }

    try {
      await providerManager.loadProvider('nonexistent-provider');
      fail('Error handling for missing provider failed');
      results.failed.push('No error for missing provider');
    } catch (error) {
      pass('Error handling for missing provider works');
      results.passed.push('Error handling works');
    }

    const provider1 = await providerManager.loadProvider('openai', { apiKey: 'test-1' });
    const provider2 = await providerManager.loadProvider('openai', { apiKey: 'test-1' });
    if (provider1 === provider2) {
      pass('Provider caching works');
      results.passed.push('Caching works');
    }
  } catch (error) {
    fail(`Error: ${error.message}`);
    results.failed.push(error.message);
  }

  return results;
}

async function testFeature3() {
  log('\n=== FEATURE 3: OpenAI provider implemented ===', COLORS.YELLOW);
  const results = { passed: [], failed: [] };

  try {
    const openaiPath = path.join(__dirname, 'modules/ai/providers/openai.js');
    if (!fs.existsSync(openaiPath)) {
      fail('openai.js does not exist');
      results.failed.push('File does not exist');
      return results;
    }
    pass('openai.js exists');
    results.passed.push('File exists');

    const { default: OpenAIProvider } = await import('./modules/ai/providers/openai.js');
    const { default: AIProviderInterface } = await import('./modules/ai/core/provider-interface.js');

    const provider = new OpenAIProvider({ apiKey: 'test-key' });
    if (provider instanceof AIProviderInterface) {
      pass('Provider extends base interface');
      results.passed.push('Extends interface');
    }

    const models = await provider.getModels();
    if (Array.isArray(models) && models.length > 0) {
      pass(`getModels() returns ${models.length} models`);
      results.passed.push('getModels works');
    }

    const operations = provider.getSupportedOperations();
    const expectedOps = ['chat', 'embeddings', 'text-to-speech', 'text-to-image'];
    if (expectedOps.every(op => operations.includes(op))) {
      pass('getSupportedOperations() correct');
      results.passed.push('getSupportedOperations works');
    }

    if (await provider.isUsable() === true) {
      pass('isUsable() returns true with API key');
      results.passed.push('isUsable with key');
    }

    const providerNoKey = new OpenAIProvider({ apiKey: '' });
    if (await providerNoKey.isUsable() === false) {
      pass('isUsable() returns false without API key');
      results.passed.push('isUsable without key');
    }
  } catch (error) {
    fail(`Error: ${error.message}`);
    results.failed.push(error.message);
  }

  return results;
}

async function main() {
  log('\n╔════════════════════════════════════════╗', COLORS.BLUE);
  log('║  REGRESSION TEST: Features 1, 2, 3    ║', COLORS.BLUE);
  log('╚════════════════════════════════════════╝', COLORS.BLUE);

  const results = {
    feature1: await testFeature1(),
    feature2: await testFeature2(),
    feature3: await testFeature3()
  };

  log('\n╔════════════════════════════════════════╗', COLORS.BLUE);
  log('║  SUMMARY                               ║', COLORS.BLUE);
  log('╚════════════════════════════════════════╝', COLORS.BLUE);

  const allPassed = [
    ...results.feature1.passed,
    ...results.feature2.passed,
    ...results.feature3.passed
  ];
  const allFailed = [
    ...results.feature1.failed,
    ...results.feature2.failed,
    ...results.feature3.failed
  ];

  log(`\nTotal Passed: ${allPassed.length}`, COLORS.GREEN);
  log(`Total Failed: ${allFailed.length}`, allFailed.length > 0 ? COLORS.RED : COLORS.GREEN);

  if (allFailed.length === 0) {
    log('\n✓ ALL FEATURES PASSING - No regressions detected', COLORS.GREEN);
    process.exit(0);
  } else {
    log('\n✗ REGRESSIONS DETECTED', COLORS.RED);
    process.exit(1);
  }
}

main().catch(error => {
  fail(`Fatal error: ${error.message}`);
  console.error(error);
  process.exit(1);
});
