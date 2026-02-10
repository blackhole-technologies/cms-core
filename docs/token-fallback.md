# Token Fallback System

## Overview

The Token Fallback System extends CMS-Core's token replacement with OR-separated fallback chains. This allows content templates to gracefully handle missing data by specifying multiple fallback options.

## Syntax

```
{field:title|field:name|"Default Value"}
```

- **Pipe separator (`|`)**: Separates fallback options
- **Token references**: `field:title`, `content:author:name`
- **Literal defaults**: `"String in quotes"` or `'String in quotes'`
- **Evaluation order**: Left to right, stops at first non-empty value

## Features

### Feature #1: Token OR Fallback Logic

Parse and handle OR-separated token chains:

```javascript
import { parseTokenWithFallbacks } from './core/tokens.js';

const options = parseTokenWithFallbacks('{field:title|field:name|"Untitled"}');
// Returns: ['field:title', 'field:name', '"Untitled"']
```

**Supported formats:**
- `{option1|option2|option3}` - Curly braces (recommended for fallbacks)
- `[option1|option2]` - Square brackets
- `option1|option2` - No brackets

### Feature #2: Chained Token Evaluation

Evaluate fallback chain with field resolution:

```javascript
import { evaluateFallbackChain } from './core/tokens.js';

const context = {
  entity: {
    fields: {
      name: 'Article Name'
      // title is missing
    }
  }
};

const value = await evaluateFallbackChain(
  ['field:title', 'field:name', '"Untitled"'],
  context
);
// Returns: "Article Name" (skips missing title, uses name)
```

**Empty value handling:**
- `null` and `undefined` trigger fallback
- Empty strings `''` trigger fallback
- Whitespace-only `'   '` triggers fallback
- Zero `0` and `false` are valid (do NOT trigger fallback)

### Feature #3: Default Literal Values

Use quoted strings as final fallback defaults:

```javascript
import { replaceWithFallbacks } from './core/tokens.js';

const template = 'Title: {field:title|"Untitled Article"}';
const context = { entity: { fields: {} } };

const result = await replaceWithFallbacks(template, context);
// Returns: "Title: Untitled Article"
```

**Quote support:**
- Double quotes: `"Default value"`
- Single quotes: `'Default value'`
- Escaped quotes: `"Say \"Hello\""`
- Special characters: `"Line 1\nLine 2"`

## API Reference

### `parseTokenWithFallbacks(tokenString)`

Parse token string into array of fallback options.

**Parameters:**
- `tokenString` (string): Token with fallbacks like `{field:title|field:name|"Default"}`

**Returns:** Array of fallback options

**Example:**
```javascript
parseTokenWithFallbacks('{field:title|"Untitled"}');
// ['field:title', '"Untitled"']
```

### `evaluateFallbackChain(fallbackOptions, context)`

Evaluate fallback chain, returning first non-empty value.

**Parameters:**
- `fallbackOptions` (Array): Array of options from `parseTokenWithFallbacks()`
- `context` (Object): Context for token resolution

**Returns:** Promise<string> - First non-empty value or empty string

**Example:**
```javascript
await evaluateFallbackChain(
  ['field:title', '"Untitled"'],
  { entity: { fields: {} } }
);
// "Untitled"
```

### `replaceWithFallbacks(text, context)`

Replace tokens with fallback support in text.

**Parameters:**
- `text` (string): Text containing tokens with fallbacks
- `context` (Object): Context for token resolution

**Returns:** Promise<string> - Text with tokens replaced

**Example:**
```javascript
await replaceWithFallbacks(
  'URL: /articles/{field:slug|field:title|"default"}',
  { entity: { fields: { title: 'My Article' } } }
);
// "URL: /articles/My Article"
```

### `isLiteral(option)`

Check if fallback option is a quoted literal.

**Parameters:**
- `option` (string): Fallback option

**Returns:** boolean

**Example:**
```javascript
isLiteral('"Hello"');     // true
isLiteral("'World'");     // true
isLiteral('field:title'); // false
```

### `extractLiteral(option)`

Extract unquoted value from literal string.

**Parameters:**
- `option` (string): Quoted literal like `"Hello"`

**Returns:** string - Unquoted and unescaped value

**Example:**
```javascript
extractLiteral('"Say \\"Hello\\""');
// 'Say "Hello"'
```

## Usage Examples

### Basic Fallback

```javascript
// Simple 2-option fallback
{field:title|"Untitled"}

// 3-option chain
{field:title|field:name|"No Title"}
```

### URL Generation

```javascript
// SEO-friendly URLs with fallbacks
<a href="/articles/{field:slug|field:title|"article"}">Read more</a>
```

### Meta Tags

```javascript
// SEO meta tags with smart defaults
<title>{field:metaTitle|field:title|"Untitled"} | [site:name]</title>
<meta name="description" content="{field:metaDescription|field:description|"No description"}" />
```

### Complex Templates

```javascript
<article>
  <h1>{field:title|field:name|"Untitled"}</h1>
  <p class="author">By {field:author|"Anonymous"}</p>
  <p>{field:description|field:body|"No description available"}</p>
</article>
```

### Deep Chains (4+ levels)

```javascript
// Try multiple sources before default
{field:title|field:name|field:slug|field:id|"No Title Available"}
```

## Performance

The token fallback system is optimized for performance:

- **Early termination**: Stops at first non-empty value
- **Lazy evaluation**: Only evaluates tokens as needed
- **No regex overhead**: Simple string parsing
- **Efficient**: 8+ tokens processed in <100ms

## Error Handling

The system gracefully handles errors:

- **Missing tokens**: Continue to next fallback
- **Null entities**: Use defaults
- **Invalid syntax**: Keep original token
- **Token resolution errors**: Try next option

## Integration

### With Existing Token System

Fallback tokens work alongside standard tokens:

```javascript
// Mix both syntaxes
'Title: {field:title|"Untitled"} - Created: [date:short]'
```

### With Field System

Access entity fields directly:

```javascript
const context = {
  entity: {
    fields: {
      title: 'My Article',
      slug: 'my-article'
    }
  }
};

await replaceWithFallbacks('{field:title|"Untitled"}', context);
```

## Testing

Comprehensive test suites included:

- **Unit tests**: `tests/unit/token-fallback.test.js` (44 tests)
- **Integration tests**: `tests/integration/token-fallback-integration.test.js` (17 tests)

Run tests:
```bash
node tests/unit/token-fallback.test.js
node tests/integration/token-fallback-integration.test.js
```

## Migration Guide

### From Standard Tokens

**Before:**
```javascript
// Had to check if field exists before rendering
{field:title}
```

**After:**
```javascript
// Automatic fallback handling
{field:title|"Untitled"}
```

### From Manual Fallbacks

**Before:**
```javascript
// Manual fallback logic in code
const title = entity.title || entity.name || "Untitled";
```

**After:**
```javascript
// Declarative fallbacks in template
{field:title|field:name|"Untitled"}
```

## Best Practices

1. **Always provide a default**: End fallback chains with a quoted literal
   ```javascript
   {field:title|"Untitled"}  // Good
   {field:title|field:name}   // No final default
   ```

2. **Order by preference**: Most specific first, most general last
   ```javascript
   {field:metaTitle|field:title|field:name|"Page"}
   ```

3. **Keep chains reasonable**: 2-4 options is typical, avoid excessive depth
   ```javascript
   {field:title|field:name|"Untitled"}  // Good (3 options)
   ```

4. **Use meaningful defaults**: Provide context-appropriate fallbacks
   ```javascript
   {field:author|"Anonymous Author"}  // Better than "N/A"
   ```

5. **Quote all literals**: Always use quotes for literal strings
   ```javascript
   {field:title|"Untitled"}     // Correct
   {field:title|Untitled}       // Wrong - tries to resolve as token
   ```

## Implementation Details

### Architecture

The fallback system extends `core/tokens.js`:

- **Parsing**: `parseTokenWithFallbacks()` splits OR-separated options
- **Evaluation**: `evaluateFallbackChain()` processes options sequentially
- **Integration**: `replaceWithFallbacks()` combines with standard token replacement

### Empty Value Detection

Values considered empty (trigger fallback):
- `null`
- `undefined`
- `''` (empty string)
- `'   '` (whitespace only)

Values considered non-empty (stop fallback):
- `'0'` (string zero)
- `0` (number zero)
- `false` (boolean false)
- Non-empty strings
- Objects and arrays

### Quote Handling

Supports both quote styles with escape sequences:

```javascript
"Double quotes with \"escapes\""
'Single quotes with \'escapes\''
```

Escape sequences processed:
- `\"` → `"`
- `\'` → `'`
- `\\` → `\`
- `\n` → newline
- `\t` → tab

## Future Enhancements

Potential future additions:

1. **Conditional fallbacks**: `{field:title|if(published, field:name)|"Draft"}`
2. **Transform fallbacks**: `{field:title|uppercase(field:name)|"UNTITLED"}`
3. **Computed fallbacks**: `{field:slug|slugify(field:title)|"article"}`
4. **Type coercion**: `{field:count|"0"}` with number conversion

## License

Part of CMS-Core - see project LICENSE file.

## Contributors

- CMS-Core Team
- Token Fallback System (Features #1, #2, #3)
