import * as tabsFormatter from './core/formatters/field-group/tabs.formatter.js';

console.log('\n=== Testing Tabs Formatter (Horizontal) ===\n');

const horizontalGroup = {
  group_name: 'info_tabs',
  label: 'Information Tabs',
  format_settings: {
    orientation: 'horizontal',
    default_tab: 0
  },
  children: ['basic', 'advanced', 'metadata']
};

const fields = [
  {
    name: 'basic',
    label: 'Basic Info',
    html: '<div class="basic-fields"><input name="title" placeholder="Title" /></div>'
  },
  {
    name: 'advanced',
    label: 'Advanced',
    html: '<div class="advanced-fields"><textarea name="description"></textarea></div>'
  },
  {
    name: 'metadata',
    label: 'Metadata',
    html: '<div class="metadata-fields"><input name="tags" placeholder="Tags" /></div>'
  }
];

const horizontalHtml = tabsFormatter.render(horizontalGroup, fields);
console.log(horizontalHtml);

console.log('\n=== Testing Tabs Formatter (Vertical) ===\n');

const verticalGroup = {
  group_name: 'settings_tabs',
  label: 'Settings Tabs',
  format_settings: {
    orientation: 'vertical',
    default_tab: 1
  },
  children: ['general', 'appearance', 'privacy']
};

const settingsFields = [
  { name: 'general', label: 'General', html: '<div>General settings</div>' },
  { name: 'appearance', label: 'Appearance', html: '<div>Appearance settings</div>' },
  { name: 'privacy', label: 'Privacy', html: '<div>Privacy settings</div>' }
];

const verticalHtml = tabsFormatter.render(verticalGroup, settingsFields);
console.log(verticalHtml);

console.log('\n=== Tests Complete ===\n');
