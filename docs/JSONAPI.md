# JSON:API

Full JSON:API 1.1 specification compliant API for headless CMS usage.

## Overview

JSON:API provides a standardized API format at `/jsonapi`:

- **Resource Objects**: type/id/attributes/relationships structure
- **Compound Documents**: Include related resources with `?include=`
- **Sparse Fieldsets**: Request only needed fields with `?fields[type]=`
- **Filtering**: Filter by any field with `?filter[field]=`
- **Sorting**: Sort by any field with `?sort=`
- **Pagination**: Offset-based with `?page[offset]=` and `?page[limit]=`
- **Error Objects**: Standardized error responses

## Specification

This implementation follows [JSON:API 1.1](https://jsonapi.org/format/1.1/).

**Content-Type**: `application/vnd.api+json`

## Quick Start

```bash
# List articles
curl http://localhost:3000/jsonapi/article

# Get single article with author
curl "http://localhost:3000/jsonapi/article/123?include=author"

# Create article
curl -X POST http://localhost:3000/jsonapi/article \
  -H "Content-Type: application/vnd.api+json" \
  -d '{
    "data": {
      "type": "article",
      "attributes": {
        "title": "Hello World",
        "body": "Content here"
      }
    }
  }'
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/jsonapi` | Entry point (list all resource types) |
| `GET` | `/jsonapi/{type}` | List resources |
| `POST` | `/jsonapi/{type}` | Create resource |
| `GET` | `/jsonapi/{type}/{id}` | Get single resource |
| `PATCH` | `/jsonapi/{type}/{id}` | Update resource |
| `DELETE` | `/jsonapi/{type}/{id}` | Delete resource |
| `GET` | `/jsonapi/{type}/{id}/relationships/{rel}` | Get relationship |
| `PATCH` | `/jsonapi/{type}/{id}/relationships/{rel}` | Update relationship |

## Query Parameters

### Pagination

```
?page[offset]=0&page[limit]=20
?page[number]=2&page[size]=20
```

Default limit: 20. Maximum limit: 100.

### Sorting

```
?sort=created           # Ascending
?sort=-created          # Descending
?sort=category,-created # Multiple (first takes precedence)
```

### Filtering

```
?filter[status]=published
?filter[views][gt]=100
?filter[category][in]=news,blog
```

Operators: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `contains`, `in`

### Including Related Resources

```
?include=author
?include=author,tags
?include=author.profile    # Nested (up to 3 levels deep)
```

### Sparse Fieldsets

```
?fields[article]=title,created
?fields[article]=title&fields[author]=name
```

## Response Format

### Collection Response

```json
{
  "jsonapi": { "version": "1.1" },
  "data": [
    {
      "type": "article",
      "id": "123",
      "attributes": {
        "title": "Hello World",
        "body": "Content here",
        "created": "2024-01-01T00:00:00Z"
      },
      "relationships": {
        "author": {
          "data": { "type": "user", "id": "456" },
          "links": {
            "self": "/jsonapi/article/123/relationships/author",
            "related": "/jsonapi/article/123/author"
          }
        }
      },
      "links": {
        "self": "/jsonapi/article/123"
      }
    }
  ],
  "included": [
    {
      "type": "user",
      "id": "456",
      "attributes": {
        "name": "John Doe"
      }
    }
  ],
  "meta": {
    "total": 42,
    "offset": 0,
    "limit": 20
  },
  "links": {
    "self": "/jsonapi/article",
    "next": "/jsonapi/article?page[offset]=20&page[limit]=20"
  }
}
```

### Single Resource Response

```json
{
  "jsonapi": { "version": "1.1" },
  "data": {
    "type": "article",
    "id": "123",
    "attributes": { ... },
    "relationships": { ... },
    "links": { "self": "/jsonapi/article/123" }
  },
  "links": {
    "self": "/jsonapi/article/123"
  }
}
```

### Error Response

```json
{
  "jsonapi": { "version": "1.1" },
  "errors": [
    {
      "status": "404",
      "title": "Not Found",
      "detail": "Resource \"article/999\" not found"
    }
  ]
}
```

## API Reference

### Resource Registration

```javascript
const jsonapi = ctx.services.get('jsonapi');

// Register a resource with relationships
jsonapi.registerResource({
  type: 'article',
  contentType: 'article',  // Internal content type
  attributes: {
    // Optional: Attribute mapping/transformation
  },
  relationships: {
    author: {
      type: 'user',
      field: 'authorId',  // Field containing the ID
    },
    tags: {
      type: 'tag',
      field: 'tagIds',
    },
  },
  defaultFields: ['title', 'created'],  // Optional sparse fieldset default
  publicRead: true,
  publicWrite: false,
});

// Auto-register all content types
jsonapi.autoRegisterContentTypes();
```

### Programmatic Access

```javascript
// Get config
const config = jsonapi.getConfig();

// Check if enabled
if (jsonapi.isEnabled()) {
  // ...
}

// Create custom error
throw new jsonapi.JsonApiError(
  400,
  'Validation Error',
  'Title is required',
  { pointer: '/data/attributes/title' }
);
```

## CLI Commands

```bash
# Show JSON:API configuration
node index.js jsonapi:resources

# Fetch resources (shows curl command)
node index.js jsonapi:fetch article
node index.js jsonapi:fetch article 123 --include=author
```

## Admin Routes

| Route | Description |
|-------|-------------|
| `GET /admin/jsonapi` | JSON:API explorer with documentation |

## Configuration

In `config/site.json`:

```json
{
  "jsonapi": {
    "enabled": true,
    "basePath": "/jsonapi",
    "defaultPageLimit": 20,
    "maxPageLimit": 100,
    "includeDepth": 3,
    "allowAnonymousRead": true,
    "allowAnonymousWrite": false
  }
}
```

## Authentication

By default:
- **GET** requests are allowed anonymously
- **POST/PATCH/DELETE** require authentication

Configure via `publicRead` and `publicWrite` per resource or globally.

For authenticated requests, include session cookie or implement token-based auth.

## Comparison with Other APIs

| Feature | JSON:API | GraphQL | REST |
|---------|----------|---------|------|
| Relationships | ✓ via include | ✓ native | Manual |
| Sparse fields | ✓ via fields[] | ✓ native | Manual |
| Filtering | ✓ via filter[] | ✓ arguments | Custom |
| Pagination | ✓ standardized | Custom | Custom |
| Spec compliance | JSON:API 1.1 | GraphQL spec | None |

## Frontend Integration

Example with fetch:

```javascript
// List articles with author
const response = await fetch('/jsonapi/article?include=author', {
  headers: {
    'Accept': 'application/vnd.api+json',
  },
});
const { data, included, meta } = await response.json();

// Create article
await fetch('/jsonapi/article', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/vnd.api+json',
  },
  body: JSON.stringify({
    data: {
      type: 'article',
      attributes: {
        title: 'New Article',
        body: 'Content...',
      },
    },
  }),
});
```

Popular JSON:API clients:
- [devour-client](https://github.com/twg/devour) (JavaScript)
- [spraypaint](https://www.graphiti.dev/js/) (JavaScript)
- [ember-data](https://guides.emberjs.com/release/models/) (Ember.js)
