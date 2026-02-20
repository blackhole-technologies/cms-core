/**
 * Test Feature #1: Function call plugin interface exists
 *
 * Verification steps:
 * 1. Read core/lib/Plugin/FunctionCallPlugin.js
 * 2. Verify interface defines: getName(), getDescription(), getParametersSchema(), execute(params)
 * 3. Verify PluginManager can discover and load function call plugins
 * 4. Verify plugins can be registered and invoked programmatically
 */

import { FunctionCallPlugin } from './core/lib/Plugin/FunctionCallPlugin.js';
import { FunctionCallPluginManager } from './core/lib/Plugin/FunctionCallPluginManager.js';

console.log('='.repeat(80));
console.log('FEATURE #1: Function Call Plugin Interface Test');
console.log('='.repeat(80));

let testsPassed = 0;
let testsFailed = 0;

function pass(message) {
  console.log('\x1b[32m✓\x1b[0m', message);
  testsPassed++;
}

function fail(message, error) {
  console.log('\x1b[31m✗\x1b[0m', message);
  if (error) console.error('  Error:', error.message);
  testsFailed++;
}

// ========================================
// STEP 1: Verify FunctionCallPlugin exists and has required methods
// ========================================
console.log('\n[Step 1] Verifying FunctionCallPlugin interface...\n');

try {
  // Check class exists
  if (typeof FunctionCallPlugin !== 'function') {
    throw new Error('FunctionCallPlugin is not a class/constructor');
  }
  pass('FunctionCallPlugin class exists');

  // Create a test instance
  const testConfig = { testOption: 'value' };
  const testId = 'test_tool';
  const testDef = {
    name: 'test_function',
    description: 'A test function',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string' }
      }
    },
    permission: 'test:execute'
  };

  const plugin = new FunctionCallPlugin(testConfig, testId, testDef, null);
  pass('FunctionCallPlugin can be instantiated');

  // Verify required methods exist
  const requiredMethods = ['getName', 'getDescription', 'getParametersSchema', 'execute'];
  for (const method of requiredMethods) {
    if (typeof plugin[method] !== 'function') {
      throw new Error(`Missing required method: ${method}`);
    }
  }
  pass('All required methods exist: ' + requiredMethods.join(', '));

  // Test getName()
  const name = plugin.getName();
  if (name !== 'test_function') {
    throw new Error(`getName() returned ${name}, expected test_function`);
  }
  pass('getName() returns correct value');

  // Test getDescription()
  const description = plugin.getDescription();
  if (description !== 'A test function') {
    throw new Error(`getDescription() returned ${description}`);
  }
  pass('getDescription() returns correct value');

  // Test getParametersSchema()
  const schema = plugin.getParametersSchema();
  if (!schema || schema.type !== 'object') {
    throw new Error('getParametersSchema() did not return valid schema');
  }
  pass('getParametersSchema() returns valid JSON schema');

  // Test getPermission()
  const permission = plugin.getPermission();
  if (permission !== 'test:execute') {
    throw new Error(`getPermission() returned ${permission}`);
  }
  pass('getPermission() returns correct value');

  // Test toAIFormat()
  const openAIFormat = plugin.toAIFormat('openai');
  if (!openAIFormat.name || !openAIFormat.description || !openAIFormat.parameters) {
    throw new Error('toAIFormat() did not return valid OpenAI format');
  }
  pass('toAIFormat("openai") returns valid format');

  const anthropicFormat = plugin.toAIFormat('anthropic');
  if (!anthropicFormat.name || !anthropicFormat.input_schema) {
    throw new Error('toAIFormat() did not return valid Anthropic format');
  }
  pass('toAIFormat("anthropic") returns valid format');

} catch (error) {
  fail('FunctionCallPlugin interface verification failed', error);
}

// ========================================
// STEP 2: Verify FunctionCallPluginManager exists
// ========================================
console.log('\n[Step 2] Verifying FunctionCallPluginManager...\n');

try {
  // Check class exists
  if (typeof FunctionCallPluginManager !== 'function') {
    throw new Error('FunctionCallPluginManager is not a class/constructor');
  }
  pass('FunctionCallPluginManager class exists');

  // Create manager instance
  const manager = new FunctionCallPluginManager();
  pass('FunctionCallPluginManager can be instantiated');

  // Verify it has expected methods
  const managerMethods = [
    'getDefinitions',
    'getDefinition',
    'createInstance',
    'execute',
    'getAvailableTools',
    'getToolsByCategory',
    'registerTool',
    'listToolNames'
  ];

  for (const method of managerMethods) {
    if (typeof manager[method] !== 'function') {
      throw new Error(`Missing required method: ${method}`);
    }
  }
  pass('FunctionCallPluginManager has all expected methods');

} catch (error) {
  fail('FunctionCallPluginManager verification failed', error);
}

// ========================================
// STEP 3: Test programmatic registration
// ========================================
console.log('\n[Step 3] Testing programmatic plugin registration...\n');

try {
  const manager = new FunctionCallPluginManager();

  // Register a test plugin
  manager.registerTool({
    id: 'test_add',
    name: 'add_numbers',
    description: 'Add two numbers together',
    parameters: {
      type: 'object',
      properties: {
        a: { type: 'number', description: 'First number' },
        b: { type: 'number', description: 'Second number' }
      },
      required: ['a', 'b']
    },
    execute: async (params, context) => {
      return { result: params.a + params.b };
    }
  });

  pass('Plugin registered successfully via registerTool()');

  // Verify it appears in definitions
  const toolNames = await manager.listToolNames();
  if (!toolNames.includes('test_add')) {
    throw new Error('Registered plugin not found in tool list');
  }
  pass('Registered plugin appears in listToolNames()');

  // Get the definition
  const def = await manager.getDefinition('test_add');
  if (!def || def.id !== 'test_add') {
    throw new Error('Could not retrieve registered plugin definition');
  }
  pass('Can retrieve registered plugin definition via getDefinition()');

} catch (error) {
  fail('Programmatic registration test failed', error);
}

// ========================================
// STEP 4: Test plugin execution
// ========================================
console.log('\n[Step 4] Testing plugin execution...\n');

try {
  const manager = new FunctionCallPluginManager();

  // Register a test plugin with execute function
  manager.registerTool({
    id: 'test_greet',
    name: 'greet_user',
    description: 'Greet a user by name',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'User name' }
      },
      required: ['name']
    },
    execute: async (params, context) => {
      return {
        success: true,
        message: `Hello, ${params.name}!`
      };
    }
  });

  pass('Test plugin with execute() registered');

  // Execute the plugin
  const result = await manager.execute('test_greet', { name: 'Alice' }, {});
  if (!result || result.message !== 'Hello, Alice!') {
    throw new Error('Plugin execution returned unexpected result');
  }
  pass('Plugin executed successfully via manager.execute()');

  if (result.success !== true) {
    throw new Error('Plugin execution result missing expected fields');
  }
  pass('Plugin execution result has expected structure');

} catch (error) {
  fail('Plugin execution test failed', error);
}

// ========================================
// STEP 5: Test AI format conversion
// ========================================
console.log('\n[Step 5] Testing AI format conversion...\n');

try {
  const manager = new FunctionCallPluginManager();

  manager.registerTool({
    id: 'test_search',
    name: 'search_content',
    description: 'Search for content in the CMS',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Maximum results', default: 10 }
      },
      required: ['query']
    },
    execute: async (params) => ({ results: [] })
  });

  const tools = await manager.getAvailableTools({}, 'openai');
  if (!Array.isArray(tools) || tools.length === 0) {
    throw new Error('getAvailableTools() did not return array');
  }
  pass('getAvailableTools() returns array of tools');

  const tool = tools[0];
  if (!tool.name || !tool.description || !tool.parameters) {
    throw new Error('Tool missing required fields for AI provider');
  }
  pass('Tool has required fields: name, description, parameters');

  // Test Anthropic format
  const anthropicTools = await manager.getAvailableTools({}, 'anthropic');
  if (!anthropicTools[0].input_schema) {
    throw new Error('Anthropic format missing input_schema');
  }
  pass('getAvailableTools() supports Anthropic format');

} catch (error) {
  fail('AI format conversion test failed', error);
}

// ========================================
// Summary
// ========================================
console.log('\n' + '='.repeat(80));
console.log('TEST SUMMARY');
console.log('='.repeat(80));
console.log(`✓ Passed: ${testsPassed}`);
console.log(`✗ Failed: ${testsFailed}`);
console.log(`Total:    ${testsPassed + testsFailed}`);

if (testsFailed === 0) {
  console.log('\n\x1b[32m🎉 ALL TESTS PASSED! Feature #1 is complete.\x1b[0m\n');
  process.exit(0);
} else {
  console.log('\n\x1b[31m❌ SOME TESTS FAILED\x1b[0m\n');
  process.exit(1);
}
