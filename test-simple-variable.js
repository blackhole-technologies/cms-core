import * as icons from './core/icons.js';
import * as iconRenderer from './core/icon-renderer.js';
import * as template from './core/template.js';
import { readFileSync } from 'node:fs';

const iconConfig = JSON.parse(readFileSync('/Users/Alchemy/Projects/experiments/cms-core/config/icons.json', 'utf-8'));
icons.init(iconConfig, '/Users/Alchemy/Projects/experiments/cms-core');
template.setIconRenderer(iconRenderer);

// Test 1: icon as a literal word that triggers the helper
const result1 = template.renderString('{{icon}}', {});
console.log('Test 1 - Literal {{icon}}:');
console.log('  VarPath would be: "icon"');
console.log('  Starts with "icon ": ', 'icon'.startsWith('icon '));
console.log('  Result:', result1);

// Test 2: Check if the regex even matches {{icon something}}
const testStr = '{{icon hero}}';
const varRegex = /\{\{(@?\w+(?:\.\w+)*)\}\}/g;
const matches = [...testStr.matchAll(varRegex)];
console.log('\nTest 2 - Regex matching {{icon hero}}:');
console.log('  Matches:', matches.length);
if (matches.length > 0) {
  console.log('  Captured:', matches.map(m => m[1]));
}
