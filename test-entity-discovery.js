import { readFileSync, writeFileSync } from 'node:fs';

const configPath = './config/site.json';
const originalConfig = readFileSync(configPath, 'utf-8');
const config = JSON.parse(originalConfig);
config.server = { ...config.server, port: 0 };
writeFileSync(configPath, JSON.stringify(config, null, 2));

try {
  const { boot } = await import('./core/boot.js');
  const context = await boot(process.cwd(), { quiet: false }); // NOT quiet

  const etm = context.container.get('entity_type.manager');
  const defs = etm.getDefinitions();

  console.log('\n=== Entity Discovery Result ===');
  console.log('Entity types discovered:', Object.keys(defs).length);
  console.log('Entity type names:', Object.keys(defs).join(', '));

  writeFileSync(configPath, originalConfig);
  process.exit(0);
} catch (e) {
  console.error(e);
  writeFileSync(configPath, originalConfig);
  process.exit(1);
}
