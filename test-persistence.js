/**
 * Test data persistence across server restart
 */
import { ConfigEntity } from './core/lib/Config/ConfigEntity.js';

async function testPersistence() {
  try {
    // Create test entity
    const testEntity = new ConfigEntity('test_type', {
      id: 'RESTART_TEST_12345',
      label: 'Restart Test',
      created: Date.now()
    });

    await testEntity.save();
    console.log('✓ Test entity created and saved');
    console.log('  ID:', testEntity.id);
    console.log('  Label:', testEntity.get('label'));

    // Verify it was saved
    const loaded = await ConfigEntity.load('test_type', 'RESTART_TEST_12345');
    if (loaded) {
      console.log('✓ Test entity loaded successfully');
      console.log('  Loaded label:', loaded.get('label'));
    } else {
      console.error('✗ Failed to load test entity');
      process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    console.error('✗ Error:', error.message);
    process.exit(1);
  }
}

testPersistence();
