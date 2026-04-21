import * as icons from '../../core/icons.js';
import * as iconRenderer from '../../core/icon-renderer.ts';
import * as template from '../../core/template.ts';
import { readFileSync } from 'node:fs';

const iconConfig = JSON.parse(readFileSync('/Users/Alchemy/Projects/experiments/cms-core/config/icons.json', 'utf-8'));
icons.init(iconConfig, '/Users/Alchemy/Projects/experiments/cms-core');
template.setIconRenderer(iconRenderer);

const result = template.renderString('{{icon hero:solid/user}}', {});
console.log('Result length:', result.length);
console.log('Result:', result);
console.log('Contains <svg:', result.includes('<svg'));
