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

  console.log('\n=== Hook Test ===');
  console.log('Has entity_type_info handlers:', hookManager.hasHandlers('entity_type_info'));
  console.log('Has entity:type:info handlers:', hookManager.hasHandlers('entity:type:info'));

  console.log('\nCalling invokeAll("entity_type_info"):');
  const result1 = await hookManager.invokeAll('entity_type_info');
  console.log('Result:', result1);

  console.log('\nCalling invokeAll("entity:type:info"):');
  const result2 = await hookManager.invokeAll('entity:type:info');
  console.log('Result:', result2);

  writeFileSync(configPath, originalConfig);
  process.exit(0);
} catch (e) {
  console.error(e);
  writeFileSync(configPath, originalConfig);
  process.exit(1);
}
