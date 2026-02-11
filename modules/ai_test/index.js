/**
 * ai_test module - Test AI provider for registry verification
 *
 * This is a minimal test module that registers itself as an AI provider
 * to verify the AI registry system is working correctly.
 */

/**
 * hook_boot - Initialize the test AI module
 */
export function hook_boot(context) {
  console.log('[ai_test] Test AI module loaded');
}

/**
 * hook_cli - Register CLI commands for testing
 */
export function hook_cli(register, context) {
  register('ai:test:info', async (args, ctx) => {
    const aiRegistry = ctx.services.get('ai-registry');
    const module = aiRegistry.getModule('ai_test');

    console.log('\nTest AI Module Info:');
    console.log(`  Name: ${module.name}`);
    console.log(`  Type: ${module.type}`);
    console.log(`  Status: ${module.status}`);
    console.log(`  Capabilities:`, JSON.stringify(module.capabilities, null, 2));
    console.log('');
  }, 'Show test AI module information');
}
