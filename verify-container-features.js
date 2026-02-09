#!/usr/bin/env node
/**
 * Comprehensive verification for Container features #12, #13, #14
 *
 * This script verifies ALL acceptance criteria from the feature specs.
 */

import { Container } from './core/lib/DependencyInjection/Container.js';

let failures = 0;

function assert(condition, message) {
  if (!condition) {
    console.error('✗ FAIL:', message);
    failures++;
  } else {
    console.log('✓', message);
  }
}

console.log('=== Feature #12: Container.register() ===\n');

const container = new Container();

// Test: container.register('foo', () => new Foo(), {tags:['my_tag']})
container.register('foo', () => ({ name: 'Foo' }), {
  tags: ['my_tag']
});

// Test: container._definitions.has('foo') === true
assert(container._definitions.has('foo'), 'container._definitions.has("foo") === true');
assert(container._definitions.get('foo').factory !== undefined, 'Factory function stored');
assert(container._definitions.get('foo').tags.includes('my_tag'), 'Tags stored correctly');
assert(container._definitions.get('foo').singleton === true, 'Singleton defaults to true');

// Verify tag indexing
assert(container._tags.has('my_tag'), 'Tag index created');
assert(container._tags.get('my_tag').has('foo'), 'Service indexed under tag');

console.log('\n=== Feature #13: Container.get() ===\n');

// Register serviceA with deps=['serviceB']
container.register('serviceB', () => ({ id: 'B' }));
container.register('serviceA', (serviceB) => {
  return { id: 'A', dependency: serviceB };
}, {
  deps: ['serviceB']
});

// Test: get('serviceA') resolves serviceB first
const serviceA = container.get('serviceA');
assert(serviceA.id === 'A', 'serviceA instantiated');
assert(serviceA.dependency.id === 'B', 'Dependency serviceB resolved first');

// Test: get('?missing') returns null
const optionalResult = container.get('?nonexistent_service');
assert(optionalResult === null, 'Optional dependency returns null when missing');

// Test with registered optional dependency
container.register('with_optional', (required, optional) => {
  return { required, optional };
}, {
  deps: ['serviceB', '?nonexistent_service']
});

const withOptional = container.get('with_optional');
assert(withOptional.required.id === 'B', 'Required dependency resolved');
assert(withOptional.optional === null, 'Optional missing dependency is null');

// Test: get('unknown') throws with list of available services
try {
  container.get('completely_unknown_service');
  assert(false, 'Should throw error for unknown service');
} catch (err) {
  assert(err.message.includes('not found'), 'Error mentions service not found');
  assert(err.message.includes('Available services'), 'Error lists available services');
}

// Test singleton caching
container.register('singleton_test', () => ({ rand: Math.random() }), {
  singleton: true
});

const instance1 = container.get('singleton_test');
const instance2 = container.get('singleton_test');
assert(instance1 === instance2, 'Singleton returns same instance');
assert(instance1.rand === instance2.rand, 'Singleton caches correctly');

// Test non-singleton
container.register('non_singleton', () => ({ rand: Math.random() }), {
  singleton: false
});

const ns1 = container.get('non_singleton');
const ns2 = container.get('non_singleton');
assert(ns1 !== ns2, 'Non-singleton creates new instances');

// Test alias
container.register('main_svc', () => ({ type: 'main' }), {
  alias: 'alias_svc'
});

const viaMain = container.get('main_svc');
const viaAlias = container.get('alias_svc');
assert(viaMain === viaAlias, 'Alias resolves to same service');

console.log('\n=== Feature #14: Utility Methods ===\n');

// Register 3 services with tag 'plugin_manager'
container.register('pm1', () => ({ id: 1 }), { tags: ['plugin_manager'] });
container.register('pm2', () => ({ id: 2 }), { tags: ['plugin_manager'] });
container.register('pm3', () => ({ id: 3 }), { tags: ['plugin_manager'] });

// Test: getTagged('plugin_manager').length === 3
const tagged = container.getTagged('plugin_manager');
assert(Array.isArray(tagged), 'getTagged returns array');
assert(tagged.length === 3, 'getTagged returns 3 services');
assert(tagged[0].name && tagged[0].service, 'Tagged items have name and service');
assert(tagged.every(t => t.service.id), 'All services instantiated');

// Test: has()
assert(container.has('serviceA') === true, 'has() returns true for existing service');
assert(container.has('nonexistent') === false, 'has() returns false for missing service');

// Test: list()
const allServices = container.list();
assert(Array.isArray(allServices), 'list() returns array');
assert(allServices.length > 10, 'list() returns all service names');
assert(allServices.includes('serviceA'), 'list() includes registered services');

// Test: reset()
container.register('reset_test', () => ({ id: Math.random() }));
const before = container.get('reset_test');
container.reset();
const after = container.get('reset_test');
assert(before.id !== after.id, 'reset() clears cached instances');
assert(container.has('reset_test'), 'reset() keeps definitions');

// Test: getLazy()
let lazyInstantiated = false;
container.register('lazy_test', () => {
  lazyInstantiated = true;
  return {
    getValue: () => 'test value',
    property: 42
  };
});

const lazyProxy = container.getLazy('lazy_test');
assert(lazyInstantiated === false, 'getLazy returns proxy without instantiation');

const value = lazyProxy.getValue();
assert(lazyInstantiated === true, 'Proxy instantiates on property access');
assert(value === 'test value', 'Proxy delegates method calls');

const prop = lazyProxy.property;
assert(prop === 42, 'Proxy delegates property access');

console.log('\n=== Additional Methods ===\n');

// Test: registerProvider()
const providerContainer = new Container();
providerContainer.registerProvider('test_module', (c) => {
  c.register('test.service', () => ({ module: 'test' }));
});

assert(providerContainer.has('test.service'), 'registerProvider registers services');

// Test: decorate()
const decorateContainer = new Container();
decorateContainer.register('base', () => ({
  getValue: () => 'original'
}));

decorateContainer.decorate('base', (inner) => ({
  ...inner,
  getValue: () => 'decorated: ' + inner.getValue()
}));

const decorated = decorateContainer.get('base');
assert(decorated.getValue() === 'decorated: original', 'decorate() wraps service');

// Test decorate clears cache
decorateContainer.register('cached', () => ({ value: 'first' }));
const first = decorateContainer.get('cached');
decorateContainer.decorate('cached', (inner) => ({ value: 'second' }));
const second = decorateContainer.get('cached');
assert(first.value !== second.value, 'decorate() clears cached instance');

console.log('\n=== VERIFICATION COMPLETE ===\n');

if (failures === 0) {
  console.log('✓ All acceptance criteria verified');
  console.log('✓ Features #12, #13, #14 are PASSING');
  process.exit(0);
} else {
  console.error(`✗ ${failures} verification(s) failed`);
  process.exit(1);
}
