import { readFileSync, writeFileSync } from 'node:fs';

const configPath = './config/site.json';
const originalConfig = readFileSync(configPath, 'utf-8');
const config = JSON.parse(originalConfig);
config.server = { ...config.server, port: 0 };
writeFileSync(configPath, JSON.stringify(config, null, 2));

try {
  const { boot } = await import('./core/boot.js');
  const context = await boot(process.cwd(), { quiet: true });

  console.log('\n=== Debug Info ===');
  console.log('container.has("entity_type.manager"):', context.container.has('entity_type.manager'));
  console.log('container.get("entity_type.manager"):', context.container.get('entity_type.manager'));

  const etm = context.container.get('entity_type.manager');
  console.log('ETM methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(etm)));

  const defs = etm.getDefinitions();
  console.log('Definitions:', defs);
  console.log('Definition count:', Object.keys(defs).length);

  // Restore
  writeFileSync(configPath, originalConfig);
} catch (e) {
  console.error(e);
  writeFileSync(configPath, originalConfig);
  process.exit(1);
}
