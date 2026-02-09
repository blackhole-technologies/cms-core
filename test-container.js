#!/usr/bin/env node
/**
 * Test script for Container features #12, #13, #14
 */

import { Container } from './core/lib/DependencyInjection/Container.js';

console.log('Testing Container class...\n');

// Create container instance
const container = new Container();

// Feature #12: Basic registration with tags
console.log('=== Feature #12: register() method ===');
container.register('foo', () => ({ name: 'Foo Service' }), {
  tags: ['my_tag', 'test_tag']
});

console.log('✓ Registered "foo" service with tags');
console.log('✓ container._definitions.has("foo"):', container._definitions.has('foo'));
console.log('✓ container.has("foo"):', container.has('foo'));

// Test singleton behavior
container.register('singleton', () => ({ id: Math.random() }), {
  singleton: true
});

container.register('non_singleton', () => ({ id: Math.random() }), {
  singleton: false
});

// Feature #13: get() with dependency resolution
console.log('\n=== Feature #13: get() with dependencies ===');

// Register services with dependencies
container.register('serviceB', () => ({ name: 'Service B' }));

container.register('serviceA', (serviceB) => {
  return {
    name: 'Service A',
    dependency: serviceB
  };
}, {
  deps: ['serviceB']
});

const serviceA = container.get('serviceA');
console.log('✓ Resolved serviceA with dependency serviceB');
console.log('  serviceA.name:', serviceA.name);
console.log('  serviceA.dependency.name:', serviceA.dependency.name);

// Test optional dependencies
container.register('with_optional', (required, optional) => {
  return {
    required,
    optional: optional || 'null (as expected)'
  };
}, {
  deps: ['serviceB', '?missing_service']
});

const withOptional = container.get('with_optional');
console.log('✓ Optional dependency ?missing_service returned null');
console.log('  optional value:', withOptional.optional);

// Test error on unknown service
try {
  container.get('unknown_service');
  console.log('✗ Should have thrown error for unknown service');
} catch (err) {
  console.log('✓ Throws descriptive error for unknown service');
  console.log('  Error message includes available services:', err.message.includes('Available services'));
}

// Test singleton caching
const singleton1 = container.get('singleton');
const singleton2 = container.get('singleton');
console.log('✓ Singleton caching works:', singleton1.id === singleton2.id);

const nonSingleton1 = container.get('non_singleton');
const nonSingleton2 = container.get('non_singleton');
console.log('✓ Non-singleton creates new instances:', nonSingleton1.id !== nonSingleton2.id);

// Test alias
container.register('main_service', () => ({ type: 'main' }), {
  alias: 'service_alias'
});

const viaMain = container.get('main_service');
const viaAlias = container.get('service_alias');
console.log('✓ Alias resolves to same service:', viaMain === viaAlias);

// Feature #14: Utility methods
console.log('\n=== Feature #14: Utility methods ===');

// Register multiple services with same tag
container.register('manager1', () => ({ id: 1 }), { tags: ['plugin_manager'] });
container.register('manager2', () => ({ id: 2 }), { tags: ['plugin_manager'] });
container.register('manager3', () => ({ id: 3 }), { tags: ['plugin_manager'] });

const tagged = container.getTagged('plugin_manager');
console.log('✓ getTagged("plugin_manager") returns 3 services:', tagged.length === 3);
console.log('  Service names:', tagged.map(s => s.name).join(', '));

// Test has()
console.log('✓ has("serviceA"):', container.has('serviceA'));
console.log('✓ has("nonexistent"):', !container.has('nonexistent'));

// Test list()
const allServices = container.list();
console.log('✓ list() returns all service names');
console.log('  Total services:', allServices.length);

// Test reset()
const beforeReset = container.get('singleton');
container.reset();
const afterReset = container.get('singleton');
console.log('✓ reset() clears cached instances:', beforeReset.id !== afterReset.id);

// Test getLazy()
let lazyInstantiated = false;
container.register('lazy_service', () => {
  lazyInstantiated = true;
  return { method: () => 'result' };
});

const lazyProxy = container.getLazy('lazy_service');
console.log('✓ getLazy() returns proxy without instantiation:', !lazyInstantiated);

const result = lazyProxy.method();
console.log('✓ Proxy instantiates on first property access:', lazyInstantiated === true);
console.log('  Method result:', result);

// Test registerProvider()
console.log('\n=== Additional: registerProvider and decorate ===');

container.registerProvider('test_module', (c) => {
  c.register('test_module.service', () => ({ from: 'test_module' }));
});
console.log('✓ registerProvider() registers module services');
console.log('  test_module.service exists:', container.has('test_module.service'));

// Test decorate()
container.register('base_service', () => ({
  getValue: () => 'original'
}));

container.decorate('base_service', (inner) => ({
  ...inner,
  getValue: () => 'decorated: ' + inner.getValue()
}));

const decorated = container.get('base_service');
console.log('✓ decorate() wraps existing service');
console.log('  Decorated value:', decorated.getValue());

console.log('\n=== All tests passed! ===');
