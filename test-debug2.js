import { readFileSync, writeFileSync } from 'node:fs';

const configPath = './config/site.json';
const originalConfig = readFileSync(configPath, 'utf-8');
const config = JSON.parse(originalConfig);
config.server = { ...config.server, port: 0 };
writeFileSync(configPath, JSON.stringify(config, null, 2));

try {
  const { boot } = await import('./core/boot.js');
  const context = await boot(process.cwd(), { quiet: true });

  const hookManager = context.hookManager;
  const etm = context.container.get('entity_type.manager');

  console.log('\n=== Before Manual Discovery ===');
  const before = etm.getDefinitions();
  console.log('Definitions before:', Object.keys(before));

  console.log('\n=== Hook Test ===');
  const results = await hookManager.invokeAll('entity:type:info');
  console.log('invokeAll results:', results);

  for (const result of results) {
    console.log('Result type:', typeof result);
    console.log('Result:', result);
  }

  console.log('\n=== Manual Discovery ===');
  await etm.discoverEntityTypes();

  console.log('\n=== After Manual Discovery ===');
  const after = etm.getDefinitions();
  console.log('Definitions after:', Object.keys(after));

  writeFileSync(configPath, originalConfig);
  process.exit(0);
} catch (e) {
  console.error(e);
  writeFileSync(configPath, originalConfig);
  process.exit(1);
}
