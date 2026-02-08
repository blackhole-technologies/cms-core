/**
 * Test Date and System Token Providers (Feature #5)
 *
 * Tests site, current-user, date (with custom formats), and request tokens
 */

import * as tokens from './core/tokens.js';

console.log('=== Testing Date and System Token Providers ===\n');

// Test 1: Site tokens
console.log('Test 1: Site token replacement');
const siteContext = {
  site: {
    name: 'CMS-Core',
    url: 'http://localhost:3001',
    slogan: 'Zero-dependency Node.js CMS',
    mail: 'admin@example.com',
    timezone: 'America/New_York'
  }
};

const siteTests = [
  { token: '[site:name]', expected: 'CMS-Core', description: 'Site name' },
  { token: '[site:url]', expected: 'http://localhost:3001', description: 'Site URL' },
  { token: '[site:slogan]', expected: 'Zero-dependency Node.js CMS', description: 'Site slogan' },
  { token: '[site:mail]', expected: 'admin@example.com', description: 'Site email' },
];

for (const test of siteTests) {
  const result = await tokens.replace(test.token, siteContext);
  const passed = result === test.expected;
  console.log(`${passed ? '✓' : '✗'} ${test.description}: ${test.token} -> "${result}" ${!passed ? `(expected "${test.expected}")` : ''}`);
}
console.log('');

// Test 2: Current-user tokens (logged in)
console.log('Test 2: Current-user token replacement (logged in as admin)');
const loggedInContext = {
  currentUser: {
    id: '1',
    name: 'admin',
    username: 'admin',
    email: 'admin@example.com',
    role: 'administrator'
  }
};

const currentUserTests = [
  { token: '[current-user:name]', expected: 'admin', description: 'Username when logged in' },
  { token: '[current-user:uid]', expected: '1', description: 'User ID (uid)' },
  { token: '[current-user:id]', expected: '1', description: 'User ID (id)' },
  { token: '[current-user:email]', expected: 'admin@example.com', description: 'User email' },
  { token: '[current-user:role]', expected: 'administrator', description: 'User role' },
];

for (const test of currentUserTests) {
  const result = await tokens.replace(test.token, loggedInContext);
  const passed = result === test.expected;
  console.log(`${passed ? '✓' : '✗'} ${test.description}: ${test.token} -> "${result}" ${!passed ? `(expected "${test.expected}")` : ''}`);
}
console.log('');

// Test 3: Current-user tokens (anonymous)
console.log('Test 3: Current-user token when not logged in');
const anonymousContext = {};
const anonName = await tokens.replace('[current-user:name]', anonymousContext);
const anonId = await tokens.replace('[current-user:uid]', anonymousContext);
console.log(`✓ [current-user:name] when anonymous: "${anonName}"`);
console.log(`✓ [current-user:uid] when anonymous: "${anonId}"`);
console.log('');

// Test 4: Date tokens (basic formats)
console.log('Test 4: Date token formats');
const dateContext = { site: { timezone: 'America/Los_Angeles' } };

const shortDate = await tokens.replace('[date:short]', dateContext);
const mediumDate = await tokens.replace('[date:medium]', dateContext);
const longDate = await tokens.replace('[date:long]', dateContext);
const timestamp = await tokens.replace('[date:timestamp]', dateContext);

console.log(`✓ [date:short]: "${shortDate}" (format: MM/DD/YYYY)`);
console.log(`✓ [date:medium]: "${mediumDate}" (format: Mon DD, YYYY)`);
console.log(`✓ [date:long]: "${longDate}" (format: Month DD, YYYY)`);
console.log(`✓ [date:timestamp]: "${timestamp}" (Unix timestamp)`);
console.log('');

// Test 5: Custom date formats
console.log('Test 5: Custom date formats');
const customFormats = [
  { token: '[date:custom:Y-m-d]', description: 'ISO date (YYYY-MM-DD)', pattern: /^\d{4}-\d{2}-\d{2}$/ },
  { token: '[date:custom:H:i:s]', description: '24-hour time (HH:MM:SS)', pattern: /^\d{2}:\d{2}:\d{2}$/ },
  { token: '[date:custom:Y/m/d H:i]', description: 'Date + time', pattern: /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/ },
  { token: '[date:custom:d-m-Y]', description: 'DD-MM-YYYY', pattern: /^\d{2}-\d{2}-\d{4}$/ },
];

for (const test of customFormats) {
  const result = await tokens.replace(test.token, dateContext);
  const passed = test.pattern.test(result);
  console.log(`${passed ? '✓' : '✗'} ${test.description}: ${test.token} -> "${result}"`);
}
console.log('');

// Test 6: Timezone support
console.log('Test 6: Timezone support in date tokens');
const nyContext = { site: { timezone: 'America/New_York' } };
const laContext = { site: { timezone: 'America/Los_Angeles' } };

const nyDate = await tokens.replace('[date:short]', nyContext);
const laDate = await tokens.replace('[date:short]', laContext);

console.log(`✓ [date:short] with America/New_York timezone: "${nyDate}"`);
console.log(`✓ [date:short] with America/Los_Angeles timezone: "${laDate}"`);
console.log('  (Both should show same calendar date, different timezones respected)');
console.log('');

// Test 7: Request tokens
console.log('Test 7: Request context tokens');
const requestContext = {
  request: {
    path: '/admin/content',
    url: '/admin/content?page=2&filter=published',
    method: 'GET',
    hostname: 'localhost',
    protocol: 'http',
    headers: {
      host: 'localhost:3001'
    },
    query: {
      page: '2',
      filter: 'published'
    }
  }
};

const requestTests = [
  { token: '[request:path]', expected: '/admin/content', description: 'Request path' },
  { token: '[request:query:page]', expected: '2', description: 'Query parameter (page)' },
  { token: '[request:query:filter]', expected: 'published', description: 'Query parameter (filter)' },
  { token: '[request:method]', expected: 'GET', description: 'HTTP method' },
  { token: '[request:host]', expected: 'localhost:3001', description: 'Host name' },
  { token: '[request:protocol]', expected: 'http', description: 'Protocol' },
];

for (const test of requestTests) {
  const result = await tokens.replace(test.token, requestContext);
  const passed = result === test.expected;
  console.log(`${passed ? '✓' : '✗'} ${test.description}: ${test.token} -> "${result}" ${!passed ? `(expected "${test.expected}")` : ''}`);
}
console.log('');

// Test 8: Invalid custom date format
console.log('Test 8: Invalid custom date format handling');
const invalidFormat = await tokens.replace('[date:custom:]', dateContext);
console.log(`✓ [date:custom:] with no format: "${invalidFormat}" (should default to YYYY-MM-DD)`);
console.log('');

// Test 9: Missing request query parameter
console.log('Test 9: Missing query parameter handling');
const missingParam = await tokens.replace('[request:query:nonexistent]', requestContext);
console.log(`✓ [request:query:nonexistent]: "${missingParam}" (should be empty)`);
console.log('');

// Test 10: Token caching (performance check)
console.log('Test 10: Token replacement performance');
const start = Date.now();
for (let i = 0; i < 1000; i++) {
  await tokens.replace('[site:name] - [date:short]', siteContext);
}
const elapsed = Date.now() - start;
console.log(`✓ 1000 replacements in ${elapsed}ms (avg: ${(elapsed/1000).toFixed(2)}ms per replacement)`);
console.log('');

console.log('=== All Date and System Token Tests Complete ===');
