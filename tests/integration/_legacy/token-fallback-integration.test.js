/**
 * Integration Tests for Token Fallback with Real Field Data
 * Tests end-to-end scenarios with entity fields
 */

import {
  replaceWithFallbacks,
  registerToken,
} from '../../core/tokens.ts';

// Color helpers
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
};

let passed = 0;
let failed = 0;

function assertEquals(actual, expected, message) {
  const isEqual = JSON.stringify(actual) === JSON.stringify(expected);
  if (isEqual) {
    console.log(`${colors.green}✓${colors.reset} ${message}`);
    passed++;
  } else {
    console.log(`${colors.red}✗${colors.reset} ${message}`);
    console.log(`  Expected: ${JSON.stringify(expected)}`);
    console.log(`  Actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

console.log(`\n${colors.blue}=== Token Fallback Integration Tests ===${colors.reset}\n`);

// Register field tokens that access entity fields
registerToken('field', 'title', (ctx) => ctx.entity?.fields?.title || null);
registerToken('field', 'name', (ctx) => ctx.entity?.fields?.name || null);
registerToken('field', 'slug', (ctx) => ctx.entity?.fields?.slug || null);
registerToken('field', 'description', (ctx) => ctx.entity?.fields?.description || null);
registerToken('field', 'author', (ctx) => ctx.entity?.fields?.author || null);

// ==================================================================
// SCENARIO 1: Content entity with partial data
// ==================================================================
console.log(`${colors.yellow}Scenario 1: Content entity with partial data${colors.reset}`);

const articleWithTitle = {
  entity: {
    id: 1,
    type: 'article',
    fields: {
      title: 'How to Use Token Fallbacks',
      slug: 'token-fallbacks-guide',
      // name and description are missing
    }
  }
};

const test1 = await replaceWithFallbacks(
  'Title: {field:title|field:name|"Untitled"}',
  articleWithTitle
);
assertEquals(test1, 'Title: How to Use Token Fallbacks', 'Use title when available');

const test2 = await replaceWithFallbacks(
  'URL: /articles/{field:slug|field:title|"default"}',
  articleWithTitle
);
assertEquals(test2, 'URL: /articles/token-fallbacks-guide', 'Use slug in URL pattern');

// ==================================================================
// SCENARIO 2: Content entity with only name (no title)
// ==================================================================
console.log(`\n${colors.yellow}Scenario 2: Content entity missing primary field${colors.reset}`);

const articleWithNameOnly = {
  entity: {
    id: 2,
    type: 'article',
    fields: {
      name: 'Fallback Mechanism',
      description: 'This article demonstrates fallbacks',
      // title and slug are missing
    }
  }
};

const test3 = await replaceWithFallbacks(
  'Title: {field:title|field:name|"Untitled"}',
  articleWithNameOnly
);
assertEquals(test3, 'Title: Fallback Mechanism', 'Fall back to name when title missing');

const test4 = await replaceWithFallbacks(
  'Meta: {field:description|field:title|"No description"}',
  articleWithNameOnly
);
assertEquals(test4, 'Meta: This article demonstrates fallbacks', 'Use description field');

// ==================================================================
// SCENARIO 3: Empty content entity (use all defaults)
// ==================================================================
console.log(`\n${colors.yellow}Scenario 3: Empty entity - all defaults used${colors.reset}`);

const emptyArticle = {
  entity: {
    id: 3,
    type: 'article',
    fields: {}
  }
};

const test5 = await replaceWithFallbacks(
  'Title: {field:title|field:name|"Untitled Article"}',
  emptyArticle
);
assertEquals(test5, 'Title: Untitled Article', 'Use literal default when all fields empty');

const test6 = await replaceWithFallbacks(
  'Author: {field:author|"Anonymous"}',
  emptyArticle
);
assertEquals(test6, 'Author: Anonymous', 'Default author when field empty');

const test7 = await replaceWithFallbacks(
  'Description: {field:description|field:title|"No description available"}',
  emptyArticle
);
assertEquals(test7, 'Description: No description available', 'Multi-level fallback to default');

// ==================================================================
// SCENARIO 4: Complex template with multiple fallbacks
// ==================================================================
console.log(`\n${colors.yellow}Scenario 4: Complex template with multiple fallbacks${colors.reset}`);

const partialArticle = {
  entity: {
    id: 4,
    type: 'article',
    fields: {
      title: 'Advanced Features',
      author: 'Jane Doe',
      // slug and description missing
    }
  }
};

const template = `
<article>
  <h1>{field:title|field:name|"Untitled"}</h1>
  <p class="author">By {field:author|"Anonymous"}</p>
  <p class="description">{field:description|"No description available"}</p>
  <a href="/articles/{field:slug|field:title|"article"}">Read more</a>
</article>
`.trim();

const test8 = await replaceWithFallbacks(template, partialArticle);
const expectedHTML = `
<article>
  <h1>Advanced Features</h1>
  <p class="author">By Jane Doe</p>
  <p class="description">No description available</p>
  <a href="/articles/Advanced Features">Read more</a>
</article>
`.trim();

assertEquals(test8, expectedHTML, 'Complex HTML template with multiple fallbacks');

// ==================================================================
// SCENARIO 5: Chaining 4+ levels deep
// ==================================================================
console.log(`\n${colors.yellow}Scenario 5: Deep fallback chains (4+ levels)${colors.reset}`);

const minimalArticle = {
  entity: {
    id: 5,
    type: 'article',
    fields: {
      description: 'Only description exists',
      // title, name, slug missing
    }
  }
};

const test9 = await replaceWithFallbacks(
  '{field:title|field:name|field:slug|field:description|"Nothing Available"}',
  minimalArticle
);
assertEquals(test9, 'Only description exists', 'Deep chain fallback to 4th option');

const fullyEmptyArticle = {
  entity: {
    id: 6,
    type: 'article',
    fields: {}
  }
};

const test10 = await replaceWithFallbacks(
  '{field:title|field:name|field:slug|field:description|"No Content"}',
  fullyEmptyArticle
);
assertEquals(test10, 'No Content', 'Deep chain fallback to literal default');

// ==================================================================
// SCENARIO 6: Performance with many fallback tokens
// ==================================================================
console.log(`\n${colors.yellow}Scenario 6: Performance with multiple tokens${colors.reset}`);

const richArticle = {
  entity: {
    id: 7,
    type: 'article',
    fields: {
      title: 'Performance Test',
      name: 'Perf Test Name',
      slug: 'perf-test',
      description: 'Testing performance',
      author: 'Test Author'
    }
  }
};

const longTemplate = `
Title: {field:title|"Untitled"}
Name: {field:name|"No Name"}
Slug: {field:slug|"no-slug"}
Description: {field:description|"No Description"}
Author: {field:author|"Anonymous"}
URL: /articles/{field:slug|field:name|"default"}
Meta: {field:description|field:title|"No meta"}
Alt: {field:title|field:name|field:slug|"No alt"}
`.trim();

const startTime = Date.now();
const test11 = await replaceWithFallbacks(longTemplate, richArticle);
const duration = Date.now() - startTime;

const expectedLong = `
Title: Performance Test
Name: Perf Test Name
Slug: perf-test
Description: Testing performance
Author: Test Author
URL: /articles/perf-test
Meta: Testing performance
Alt: Performance Test
`.trim();

assertEquals(test11, expectedLong, `Process 8 fallback tokens (took ${duration}ms)`);

// Performance check - should be fast
if (duration < 100) {
  console.log(`${colors.green}✓${colors.reset} Performance acceptable: ${duration}ms < 100ms`);
  passed++;
} else {
  console.log(`${colors.red}✗${colors.reset} Performance slow: ${duration}ms >= 100ms`);
  failed++;
}

// ==================================================================
// SCENARIO 7: Edge cases and error handling
// ==================================================================
console.log(`\n${colors.yellow}Scenario 7: Edge cases${colors.reset}`);

// Test 7.1: Null entity
const test12 = await replaceWithFallbacks(
  '{field:title|"Default"}',
  { entity: null }
);
assertEquals(test12, 'Default', 'Handle null entity gracefully');

// Test 7.2: Missing entity property
const test13 = await replaceWithFallbacks(
  '{field:title|"Default"}',
  {}
);
assertEquals(test13, 'Default', 'Handle missing entity property');

// Test 7.3: Empty string field should trigger fallback
const articleWithEmptyTitle = {
  entity: {
    fields: {
      title: '',
      name: 'Valid Name'
    }
  }
};

const test14 = await replaceWithFallbacks(
  '{field:title|field:name|"Untitled"}',
  articleWithEmptyTitle
);
assertEquals(test14, 'Valid Name', 'Empty string triggers fallback');

// Test 7.4: Whitespace-only field should trigger fallback
const articleWithWhitespaceTitle = {
  entity: {
    fields: {
      title: '   ',
      name: 'Valid Name'
    }
  }
};

const test15 = await replaceWithFallbacks(
  '{field:title|field:name|"Untitled"}',
  articleWithWhitespaceTitle
);
assertEquals(test15, 'Valid Name', 'Whitespace-only field triggers fallback');

// ==================================================================
// SCENARIO 8: Real-world use case - SEO meta tags
// ==================================================================
console.log(`\n${colors.yellow}Scenario 8: Real-world use case - SEO meta tags${colors.reset}`);

const blogPost = {
  entity: {
    id: 8,
    type: 'blog_post',
    fields: {
      title: 'Understanding Token Fallbacks in CMS',
      author: 'John Smith',
      // metaDescription missing, will fall back
    }
  },
  site: {
    name: 'My Blog'
  }
};

const seoTemplate = `
<title>{field:title|"Untitled"} | [site:name]</title>
<meta name="description" content="{field:description|field:title|"Read more on [site:name]"}" />
<meta name="author" content="{field:author|"Site Author"}" />
`.trim();

const test16 = await replaceWithFallbacks(seoTemplate, blogPost);
const expectedSEO = `
<title>Understanding Token Fallbacks in CMS | My Blog</title>
<meta name="description" content="Understanding Token Fallbacks in CMS" />
<meta name="author" content="John Smith" />
`.trim();

assertEquals(test16, expectedSEO, 'SEO meta tags with mixed token types');

// ==================================================================
// SUMMARY
// ==================================================================
console.log(`\n${colors.blue}=== Integration Test Summary ===${colors.reset}`);
console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
console.log(`${colors.red}Failed: ${failed}${colors.reset}`);
console.log(`Total: ${passed + failed}\n`);

if (failed === 0) {
  console.log(`${colors.green}✓ All integration tests passed!${colors.reset}\n`);
  process.exit(0);
} else {
  console.log(`${colors.red}✗ Some integration tests failed${colors.reset}\n`);
  process.exit(1);
}
