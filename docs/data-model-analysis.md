# CMS-Core Data Model Analysis

## Executive Summary

cms-core implements a flat-file JSON storage system inspired by static site generators. This analysis compares its data model to Drupal's entity system and provides recommendations for extending flat-file capabilities.

---

## 1. Current Data Model

### 1.1 Storage Architecture

```
/content
  /<type>/           # Each content type is a directory
    <id>.json        # Each content item is a JSON file
  /.revisions/       # Version history
  /.trash/           # Soft-deleted items
  /.cache/           # Query cache
  /.search/          # Search index
```

### 1.2 Content Object Structure

```json
{
  "id": "1769863137477-t2p9b",
  "type": "greeting",
  "created": "2026-01-31T12:38:57.477Z",
  "updated": "2026-02-01T04:06:01.717Z",
  "status": "published",
  "publishedAt": "2026-02-01T04:06:01.716Z",
  "scheduledAt": null,
  ...userFields
}
```

**System Fields:**
- `id` - Timestamp-based unique identifier
- `type` - Content type name
- `created` / `updated` - ISO timestamps
- `status` - Workflow state (draft/pending/published/archived)
- `publishedAt` / `scheduledAt` - Workflow timestamps

### 1.3 ID Generation

Format: `<timestamp>-<random>` (e.g., `1705123456789-x7k9m`)

Benefits:
- Chronological sorting by default
- No collision with same-millisecond creates
- Filesystem-safe characters

### 1.4 Schema System

```javascript
register('greeting', {
  name: { type: 'string', required: true },
  message: { type: 'string', required: true }
}, 'module-name');
```

Supported field types:
- `string`, `number`, `boolean`, `array`, `object`
- `relation` (belongsTo, hasMany, belongsToMany)
- `computed` (virtual fields)
- `slug` (URL-friendly identifiers)

### 1.5 Existing Features

| Feature | Status | Implementation |
|---------|--------|----------------|
| Content CRUD | Complete | `core/content.js` |
| Revisions | Complete | `.revisions/<id>/<timestamp>.json` |
| Workflow | Complete | draft/pending/published/archived |
| Soft Delete | Complete | `.trash/<type>/<id>.json` |
| Caching | Complete | In-memory with TTL |
| Search | Complete | Full-text index |
| Computed Fields | Complete | Virtual properties |
| Slugs | Complete | Auto-generation + history |
| Relations | Basic | ID references only |
| Comments | Complete | Threaded with moderation |
| Filtering | Complete | Django-style operators |

---

## 2. Drupal Entity System Comparison

### 2.1 Entity Types

| Drupal Entity | cms-core Equivalent | Gap |
|---------------|---------------------|-----|
| `node` (content) | Content types | Equivalent |
| `user` | `user` type | Equivalent |
| `taxonomy_term` | Contract exists | Not implemented |
| `menu_link` | Contract exists | Not implemented |
| `file` | `core/media.js` | Partial |
| `comment` | `core/comments.js` | Equivalent |
| `block_content` | None | Missing |

### 2.2 Entity Bundles (Content Types)

| Feature | Drupal | cms-core |
|---------|--------|----------|
| Dynamic types | Via UI | Code-only |
| Field inheritance | Base + bundle | None |
| Display modes | Multiple | None |
| Form modes | Multiple | None |

### 2.3 Field Storage

| Drupal | cms-core |
|--------|----------|
| Separate field tables | Embedded in JSON |
| Revision tables | Separate files |
| Field cardinality | Schema-defined |
| Delta ordering | Array index |

### 2.4 Entity References

**Drupal:**
```php
$node->get('field_author')->entity  // Full entity
$node->get('field_tags')->referencedEntities()
```

**cms-core:**
```javascript
// Storage: { author: "userId123" }
// Populate: read('post', id, { populate: ['author'] })
```

| Feature | Drupal | cms-core |
|---------|--------|----------|
| Reference types | entity_reference | relation field |
| Target bundles | Configurable | Not implemented |
| Autocreate | Configurable | Not implemented |
| Bidirectional | Views/reverse | hasMany computed |
| Cascade delete | Configurable | Not implemented |
| Integrity check | Enforced | Optional |

### 2.5 Taxonomy

| Feature | Drupal | cms-core |
|---------|--------|----------|
| Vocabularies | Native | Contract only |
| Hierarchical terms | Native | Contract only |
| Term references | Field type | Manual |
| Term weights | Native | Contract only |
| Multiple parents | Supported | Not designed |

### 2.6 Menu System

| Feature | Drupal | cms-core |
|---------|--------|----------|
| Named menus | Native | Contract only |
| Menu links | Entity | Contract only |
| Hierarchy | Native | Contract only |
| Access control | Per-link | Contract only |
| Auto-links | From content | Not implemented |

### 2.7 Revisions

| Feature | Drupal | cms-core |
|---------|--------|----------|
| Revision storage | Database tables | Separate files |
| Default revision | Marked | Current file |
| Revision log | Per revision | Not implemented |
| Revision author | Tracked | Not tracked |
| Forward revisions | Supported | Not supported |

---

## 3. Gap Analysis

### 3.1 Critical Gaps

1. **Taxonomy System** - Contracts exist, implementation missing
2. **Menu System** - Contracts exist, implementation missing
3. **Entity Reference Enhancements** - Target bundles, autocreate, cascade
4. **Revision Metadata** - Author, log message, forward revisions

### 3.2 Important Gaps

1. **Block Content** - No equivalent for reusable content blocks
2. **Display Modes** - Single view per type
3. **Translation Integration** - i18n exists but not entity-aware
4. **Media Library** - Basic file handling only

### 3.3 Nice-to-Have Gaps

1. **Dynamic Type Creation** - Code-only vs UI
2. **Field Inheritance** - No base type support
3. **Workspaces** - No staging environment concept

---

## 4. Recommendations

### 4.1 Entity References Enhancement

**Current:**
```javascript
// core/content.js line 560-585
relation: {
  type: 'relation',
  target: 'user',
  relation: 'belongsTo'
}
```

**Recommended additions:**
```javascript
{
  type: 'relation',
  target: 'user',
  relation: 'belongsTo',
  targetBundles: ['author', 'editor'],  // NEW: limit allowed types
  autocreate: true,                      // NEW: create on reference
  cascade: 'nullify',                    // NEW: delete behavior (nullify|cascade|restrict)
  bidirectional: {                       // NEW: auto-update inverse
    field: 'posts',
    relation: 'hasMany'
  }
}
```

### 4.2 Taxonomy Implementation

**Storage structure:**
```
/content
  /vocabulary/
    categories.json
    tags.json
  /term/
    cat-news.json      # vocabularyId + slug
    tag-javascript.json
```

**Term schema:**
```javascript
{
  id: 'cat-news-tech',
  vocabularyId: 'categories',
  name: 'Technology',
  slug: 'tech',
  parentId: 'cat-news',           // Hierarchy
  weight: 0,
  depth: 1,                        // Computed
  path: ['cat-news'],             // Computed ancestors
  created: '...',
  updated: '...'
}
```

**Performance considerations:**
- Cache hierarchy trees in memory
- Store computed `depth` and `path` on write
- Index by vocabularyId for fast filtering

### 4.3 Menu Implementation

**Storage structure:**
```
/content
  /menu/
    main-menu.json
    footer.json
  /menu-item/
    <id>.json
```

**Menu item schema:**
```javascript
{
  id: '...',
  menuId: 'main-menu',
  title: 'About Us',
  type: 'content',           // internal|external|content|route|separator
  link: '/about',
  contentType: 'page',       // For type='content'
  contentId: 'page-about',
  parentId: null,
  weight: 10,
  depth: 0,                  // Computed
  enabled: true,
  roles: ['authenticated'],  // Access control
  created: '...',
  updated: '...'
}
```

**Tree building:**
```javascript
// Build hierarchy on read, cache result
function buildMenuTree(menuId) {
  const items = list('menu-item', { filters: { menuId }, sortBy: 'weight' });
  return buildTree(items, null); // Recursive parent matching
}
```

### 4.4 Revision Enhancements

**Extended revision format:**
```javascript
{
  ...contentData,
  _revision: {
    author: 'user-123',
    authorName: 'admin',
    message: 'Fixed typo in title',
    timestamp: '...',
    isDefault: true,
    parent: 'previous-revision-timestamp'
  }
}
```

**Forward revisions:**
- Allow creating revisions that aren't the default
- Useful for editorial workflows
- Store `isDefault: false` in non-default revisions

---

## 5. Flat-File Performance Considerations

### 5.1 Current Limitations

| Operation | Complexity | Scalability |
|-----------|------------|-------------|
| Read by ID | O(1) file read | Excellent |
| List all | O(n) file reads | Poor at scale |
| Filter | O(n) full scan | Poor at scale |
| Search | O(1) index lookup | Good |
| Relations | O(m) lookups | Degrades with depth |

### 5.2 Scaling Strategies

**Index files:**
```
/content/<type>/.index.json
{
  "byId": { "id1": { path, created, updated } },
  "bySlug": { "slug1": "id1" },
  "byField": {
    "status": { "published": ["id1", "id2"] }
  },
  "count": 150,
  "lastUpdated": "..."
}
```

**Sharding by date:**
```
/content/post/
  /2026/
    /01/
      post1.json
      post2.json
```

**Caching hierarchy trees:**
- Taxonomy: Cache full vocabulary tree
- Menus: Cache full menu tree
- Invalidate on any term/item change

### 5.3 Recommended Limits

| Content Type | Flat-File Limit | With Index |
|--------------|-----------------|------------|
| Static pages | 500 | 2,000 |
| Blog posts | 1,000 | 5,000 |
| Taxonomy terms | 500/vocab | 2,000/vocab |
| Menu items | 100/menu | 500/menu |
| Users | 100 | 1,000 |
| Comments | 1,000/content | 10,000/content |

---

## 6. Implementation Priorities

### Phase 1: Core Entity Features
1. Implement taxonomy system (vocabulary + terms)
2. Implement menu system (menus + items)
3. Add revision metadata (author, message)

### Phase 2: Reference Enhancements
1. Target bundle restrictions
2. Cascade delete options
3. Bidirectional references

### Phase 3: Scale & Performance
1. Index files for large content types
2. Lazy loading for relations
3. Background index rebuilding

### Phase 4: Advanced Features
1. Forward revisions
2. Block content type
3. Display modes

---

## 7. Files Modified/Created

This analysis is based on:
- `/core/content.js` - Main content system (2000+ lines)
- `/core/comments.js` - Comment system with threading
- `/contracts/taxonomy.d.ts` - Taxonomy contract (not implemented)
- `/contracts/menu.d.ts` - Menu contract (not implemented)
- `/config/site.json` - Configuration

---

*Generated: 2026-02-03*
*cms-core version: 0.0.60*
