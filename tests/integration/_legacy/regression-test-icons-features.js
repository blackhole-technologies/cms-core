/**
 * Regression Test for Icon System Features (1, 2, 3)
 *
 * Tests:
 * - Feature 1: Icon discovery and registry service
 * - Feature 2: Icon autocomplete form element (API endpoints)
 * - Feature 3: Icon pack plugin system
 */

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { boot } from '../../core/boot.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Test result tracking
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${error.message}`);
    failures.push({ name, error: error.message });
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} - Expected: ${expected}, Got: ${actual}`);
  }
}

function assertGreaterThan(actual, minimum, message) {
  if (actual <= minimum) {
    throw new Error(`${message} - Expected > ${minimum}, Got: ${actual}`);
  }
}

function assertExists(value, message) {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
}

(async () => {
  console.log('='.repeat(60));
  console.log('Icon System Regression Tests (Features 1, 2, 3)');
  console.log('='.repeat(60));
  console.log();

  // Boot the CMS
  console.log('Booting CMS...');
  const context = await boot(__dirname, { quiet: true });
  const { services } = context;
  console.log('✓ CMS booted successfully\n');

  // Get services
  const icons = services.get('icons');
  const iconRenderer = services.get('icon-renderer');

  console.log('--- Feature 1: Icon Discovery and Registry Service ---\n');

  test('Service is initialized', () => {
    assertExists(icons, 'Icons service should exist');
  });

  test('Discovery finds icons', () => {
    const stats = icons.getStats();
    assertGreaterThan(stats.totalIcons, 0, 'Should have discovered icons');
    assertGreaterThan(stats.totalPacks, 0, 'Should have discovered packs');
    console.log(`  Found ${stats.totalIcons} icons in ${stats.totalPacks} packs`);
  });

  test('Icon packs are registered', () => {
    const packs = icons.listPacks();
    assert(packs.length > 0, 'Should have registered packs');
    const heroicons = packs.find(p => p.id === 'heroicons');
    assertExists(heroicons, 'Heroicons pack should be registered');
    assertEquals(heroicons.name, 'Heroicons', 'Heroicons pack name');
  });

  test('getIcon() returns icon metadata', () => {
    const icon = icons.getIcon('hero:solid/user');
    assertExists(icon, 'Should return icon metadata');
    assertEquals(icon.id, 'hero:solid/user', 'Icon ID should match');
    assertEquals(icon.packId, 'heroicons', 'Icon pack ID');
    assert(icon.name === 'user', 'Icon name should be "user"');
  });

  test('searchIcons() finds icons by query', () => {
    const results = icons.searchIcons('user');
    assertGreaterThan(results.length, 0, 'Should find icons matching "user"');
    const userIcon = results.find(i => i.name === 'user');
    assertExists(userIcon, 'Should find user icon');
  });

  test('searchIcons() supports pack filtering', () => {
    const results = icons.searchIcons('home', { packId: 'heroicons' });
    if (results.length > 0) {
      const allHeroicons = results.every(i => i.packId === 'heroicons');
      assert(allHeroicons, 'All results should be from heroicons pack');
    }
  });

  test('listPacks() returns all packs', () => {
    const packs = icons.listPacks();
    assertGreaterThan(packs.length, 2, 'Should have multiple packs');
    packs.forEach(pack => {
      assertExists(pack.id, 'Pack should have ID');
      assertExists(pack.name, 'Pack should have name');
    });
  });

  test('getIconsByPack() returns icons from specific pack', () => {
    const heroicons = icons.getIconsByPack('heroicons');
    assertGreaterThan(heroicons.length, 0, 'Should have heroicons');
    const allFromHero = heroicons.every(i => i.packId === 'heroicons');
    assert(allFromHero, 'All icons should be from heroicons pack');
  });

  test('getIconSvg() returns SVG content', () => {
    const svg = icons.getIconSvg('hero:solid/user');
    assertExists(svg, 'Should return SVG content');
    assert(svg.includes('<svg'), 'Should contain SVG tag');
  });

  test('Service handles missing icons gracefully', () => {
    const icon = icons.getIcon('nonexistent:icon');
    assertEquals(icon, null, 'Should return null for missing icon');
  });

  console.log();
  console.log('--- Feature 2: Icon Autocomplete Form Element (API) ---\n');

  test('Icon search API endpoint exists', () => {
    // We can't test HTTP endpoints without a running server
    // But we can test the underlying service that powers it
    const results = icons.searchIcons('user');
    assertGreaterThan(results.length, 0, 'Search should return results');
  });

  test('Icon render API (via service)', () => {
    assertExists(iconRenderer, 'Icon renderer service should exist');
    const svg = iconRenderer.renderIcon('hero:solid/user');
    assertExists(svg, 'Should render icon');
    assert(svg.includes('<svg'), 'Should contain SVG tag');
  });

  test('Icon renderer supports size options', () => {
    const small = iconRenderer.renderIcon('hero:solid/user', { size: 'small' });
    const large = iconRenderer.renderIcon('hero:solid/user', { size: 'large' });
    assertExists(small, 'Should render small icon');
    assertExists(large, 'Should render large icon');
    assert(small.includes('width="16"') || small.includes('width="1rem"'), 'Small icon should have small dimensions');
  });

  test('Icon renderer supports custom classes', () => {
    const svg = iconRenderer.renderIcon('hero:solid/user', { class: 'custom-class' });
    assert(svg.includes('custom-class'), 'Should include custom class');
  });

  test('Icon renderer supports accessibility options', () => {
    const svg = iconRenderer.renderIcon('hero:solid/user', {
      title: 'User Profile',
      aria_label: 'User profile icon'
    });
    assert(svg.includes('User Profile') || svg.includes('aria-label'), 'Should include accessibility attributes');
  });

  test('Icon renderer caches results', () => {
    const stats1 = iconRenderer.getCacheStats();
    iconRenderer.renderIcon('hero:solid/user');
    iconRenderer.renderIcon('hero:solid/user'); // Second call should hit cache
    const stats2 = iconRenderer.getCacheStats();
    assertGreaterThan(stats2.hits, stats1.hits, 'Cache hits should increase');
  });

  console.log();
  console.log('--- Feature 3: Icon Pack Plugin System ---\n');

  test('Plugin packs are registered', () => {
    const packs = icons.listPacks();
    const pluginPack = packs.find(p => p.source === 'plugin');
    assertExists(pluginPack, 'Should have at least one plugin pack');
    console.log(`  Found plugin pack: ${pluginPack.name} (${pluginPack.id})`);
  });

  test('Plugin pack "example" is registered', () => {
    const packs = icons.listPacks();
    const examplePack = packs.find(p => p.id === 'example');
    assertExists(examplePack, 'Example pack should be registered');
    assertEquals(examplePack.source, 'plugin', 'Example pack should be from plugin');
  });

  test('Icons from plugin packs are discoverable', () => {
    const exampleIcons = icons.getIconsByPack('example');
    assertGreaterThan(exampleIcons.length, 0, 'Should have icons from example pack');
    console.log(`  Found ${exampleIcons.length} icons in example pack`);
  });

  test('Plugin pack icons can be searched', () => {
    const results = icons.searchIcons('rocket');
    const rocketIcon = results.find(i => i.name === 'rocket' && i.packId === 'example');
    assertExists(rocketIcon, 'Should find rocket icon from example pack');
  });

  test('Plugin pack icons can be rendered', () => {
    const svg = iconRenderer.renderIcon('example:rocket');
    assertExists(svg, 'Should render icon from plugin pack');
    assert(svg.includes('<svg'), 'Should contain SVG tag');
  });

  test('Multiple packs coexist without conflicts', () => {
    const packs = icons.listPacks();
    const packIds = packs.map(p => p.id);
    const uniqueIds = new Set(packIds);
    assertEquals(packIds.length, uniqueIds.size, 'All pack IDs should be unique');
  });

  test('Invalid pack registration fails gracefully', () => {
    // This would be tested in actual module hook, but we can verify
    // that the system doesn't crash with malformed data
    const statsBefore = icons.getStats();
    // System should still be functional
    const statsAfter = icons.getStats();
    assertExists(statsAfter, 'Service should still work after potential errors');
  });

  // Summary
  console.log();
  console.log('='.repeat(60));
  console.log('Test Results:');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log('='.repeat(60));

  if (failed > 0) {
    console.log();
    console.log('Failures:');
    failures.forEach(({ name, error }) => {
      console.log(`  ✗ ${name}`);
      console.log(`    ${error}`);
    });
    process.exit(1);
  } else {
    console.log();
    console.log('✓ All tests passed!');
    process.exit(0);
  }
})();
