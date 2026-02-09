/**
 * Test for Feature #11: Render System Barrel Export
 *
 * Acceptance Criteria:
 * 1. Create core/lib/Render/index.js file ✓
 * 2. Import Renderer from ./Renderer.js ✓
 * 3. Import RenderArray from ./RenderArray.js ✓
 * 4. Import CacheMetadata from ./CacheMetadata.js ✓
 * 5. Import Attribute from ./Attribute.js ✓
 * 6. Export all four classes ✓
 * 7. Test: import { Renderer, RenderArray, CacheMetadata, Attribute } works
 * 8. Verify no errors on import
 */

import { Renderer, RenderArray, CacheMetadata, Attribute } from './core/lib/Render/index.js';

console.log('Testing Feature #11: Render System Barrel Export\n');

let testsRun = 0;
let testsPassed = 0;

function test(description, fn) {
  testsRun++;
  try {
    fn();
    testsPassed++;
    console.log(`✓ ${description}`);
  } catch (error) {
    console.log(`✗ ${description}`);
    console.error(`  Error: ${error.message}`);
  }
}

// Test 1: Renderer is imported and is a class
test('Renderer is imported and is a constructor function', () => {
  if (typeof Renderer !== 'function') {
    throw new Error('Renderer is not a function');
  }
  if (!Renderer.prototype) {
    throw new Error('Renderer is not a constructor');
  }
});

// Test 2: RenderArray is imported and is a class
test('RenderArray is imported and is a constructor function', () => {
  if (typeof RenderArray !== 'function') {
    throw new Error('RenderArray is not a function');
  }
  if (!RenderArray.prototype) {
    throw new Error('RenderArray is not a constructor');
  }
});

// Test 3: CacheMetadata is imported and is a class
test('CacheMetadata is imported and is a constructor function', () => {
  if (typeof CacheMetadata !== 'function') {
    throw new Error('CacheMetadata is not a function');
  }
  if (!CacheMetadata.prototype) {
    throw new Error('CacheMetadata is not a constructor');
  }
});

// Test 4: Attribute is imported and is a class
test('Attribute is imported and is a constructor function', () => {
  if (typeof Attribute !== 'function') {
    throw new Error('Attribute is not a function');
  }
  if (!Attribute.prototype) {
    throw new Error('Attribute is not a constructor');
  }
});

// Test 5: Renderer can be instantiated
test('Renderer can be instantiated', () => {
  const renderer = new Renderer();
  if (!(renderer instanceof Renderer)) {
    throw new Error('Renderer instance check failed');
  }
});

// Test 6: RenderArray has static methods
test('RenderArray has static utility methods', () => {
  if (typeof RenderArray.children !== 'function') {
    throw new Error('RenderArray.children is not a function');
  }
  if (typeof RenderArray.isRenderArray !== 'function') {
    throw new Error('RenderArray.isRenderArray is not a function');
  }
  if (typeof RenderArray.normalize !== 'function') {
    throw new Error('RenderArray.normalize is not a function');
  }
});

// Test 7: CacheMetadata can be instantiated
test('CacheMetadata can be instantiated', () => {
  const meta = new CacheMetadata();
  if (!(meta instanceof CacheMetadata)) {
    throw new Error('CacheMetadata instance check failed');
  }
});

// Test 8: Attribute can be instantiated
test('Attribute can be instantiated', () => {
  const attr = new Attribute();
  if (!(attr instanceof Attribute)) {
    throw new Error('Attribute instance check failed');
  }
});

// Test 9: Verify all exports are distinct
test('All exported classes are distinct', () => {
  if (Renderer === RenderArray || Renderer === CacheMetadata || Renderer === Attribute) {
    throw new Error('Exported classes are not distinct');
  }
  if (RenderArray === CacheMetadata || RenderArray === Attribute) {
    throw new Error('Exported classes are not distinct');
  }
  if (CacheMetadata === Attribute) {
    throw new Error('Exported classes are not distinct');
  }
});

// Test 10: Integration test - create a simple render array and process it
test('Integration: Renderer can process render arrays with all components', () => {
  const renderer = new Renderer();

  // Create a render array with attributes
  const attr = new Attribute();
  attr.addClass('test-class');
  attr.setAttribute('id', 'test-id');

  const renderArray = {
    '#type': 'html_tag',
    '#tag': 'div',
    '#attributes': attr,
    '#value': 'Test content'
  };

  // Normalize the render array
  RenderArray.normalize(renderArray);

  // Verify normalization added defaults
  if (typeof renderArray['#weight'] !== 'number') {
    throw new Error('RenderArray.normalize did not add #weight');
  }
  if (typeof renderArray['#access'] !== 'boolean') {
    throw new Error('RenderArray.normalize did not add #access');
  }
});

// Test 11: CacheMetadata integration
test('Integration: CacheMetadata can be added to render context', () => {
  const meta = new CacheMetadata();
  meta.addCacheTags(['node:1', 'user:2']);
  meta.addCacheContexts(['user', 'route']);
  meta.setCacheMaxAge(3600);

  const tags = meta.getCacheTags();
  const contexts = meta.getCacheContexts();
  const maxAge = meta.getCacheMaxAge();

  if (tags.length !== 2 || !tags.includes('node:1')) {
    throw new Error('CacheMetadata tags not working');
  }
  if (contexts.length !== 2 || !contexts.includes('user')) {
    throw new Error('CacheMetadata contexts not working');
  }
  if (maxAge !== 3600) {
    throw new Error('CacheMetadata max age not working');
  }
});

// Test 12: Attribute integration
test('Integration: Attribute can generate HTML attribute strings', () => {
  const attr = new Attribute();
  attr.addClass('foo');
  attr.addClass('bar');
  attr.setAttribute('data-test', 'value');

  const html = attr.toString();

  if (!html.includes('class="foo bar"')) {
    throw new Error('Attribute class rendering failed');
  }
  if (!html.includes('data-test="value"')) {
    throw new Error('Attribute custom attribute rendering failed');
  }
});

console.log(`\n${testsPassed}/${testsRun} tests passed`);

if (testsPassed === testsRun) {
  console.log('\n✅ Feature #11 COMPLETE: Render System barrel export works correctly');
  process.exit(0);
} else {
  console.log('\n❌ Some tests failed');
  process.exit(1);
}
