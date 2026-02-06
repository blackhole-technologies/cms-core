# Media Library

Reusable media entity management for cms-core.

## Overview

Media Library provides a centralized repository for all media assets:

- **Media Entities**: Files with metadata, not just uploads
- **Multiple Types**: Image, video, audio, document, remote_video
- **Usage Tracking**: Know where each media is used
- **Thumbnail Generation**: Automatic thumbnails via image-styles
- **Remote Video**: YouTube/Vimeo support with embed URLs

## Quick Start

```javascript
// Get the service
const mediaLibrary = ctx.services.get('mediaLibrary');

// Upload an image
const entity = await mediaLibrary.createFromUpload({
  data: fileBuffer,
  filename: 'photo.jpg',
  mimeType: 'image/jpeg',
  size: fileBuffer.length,
}, {
  name: 'My Photo',
  alt: 'A beautiful landscape',
  tags: ['nature', 'landscape'],
});

// Get media URL
const url = mediaLibrary.getUrl(entity);
const thumbnail = mediaLibrary.getThumbnailUrl(entity);
```

## Media Types

| Type | Extensions | Description |
|------|------------|-------------|
| `image` | jpg, png, gif, webp, svg | Photos and graphics |
| `video` | mp4, webm, ogg, mov | Video files |
| `audio` | mp3, wav, ogg, aac | Audio files |
| `document` | pdf, doc, docx, xls, ppt | Documents |
| `remote_video` | - | YouTube, Vimeo embeds |

## API Reference

### Creating Media

```javascript
// From file upload
const image = await mediaLibrary.createFromUpload({
  data: buffer,        // Buffer or file path
  filename: 'photo.jpg',
  mimeType: 'image/jpeg',
  size: buffer.length,
}, {
  name: 'Photo Title',
  alt: 'Alt text for accessibility',
  caption: 'Photo caption',
  credit: 'Photographer name',
  tags: ['tag1', 'tag2'],
  status: 'published',  // or 'draft'
});

// From remote video URL
const video = await mediaLibrary.createFromUrl(
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  {
    name: 'My Video',
    caption: 'Video description',
  }
);
```

### Reading Media

```javascript
// Get by ID
const entity = mediaLibrary.get('media-id');

// List with filters
const result = mediaLibrary.list({
  mediaType: 'image',   // Filter by type
  search: 'landscape',  // Search in name
  tags: ['nature'],     // Filter by tags
  page: 1,
  limit: 20,
  sort: 'created',
  order: 'desc',
});
// Returns: { items, total, offset, limit }
```

### Updating & Deleting

```javascript
// Update metadata
await mediaLibrary.update('media-id', {
  name: 'New Name',
  alt: 'Updated alt text',
  tags: ['new', 'tags'],
});

// Delete (also deletes file by default)
await mediaLibrary.remove('media-id');

// Delete entity but keep file
await mediaLibrary.remove('media-id', { deleteFile: false });

// Bulk operations
await mediaLibrary.bulkUpdate(['id1', 'id2'], { status: 'draft' });
await mediaLibrary.bulkDelete(['id1', 'id2']);
```

### URLs and Embeds

```javascript
// Get public URL
const url = mediaLibrary.getUrl(entity);

// Get URL with image style
const styledUrl = mediaLibrary.getUrl(entity, 'thumbnail');

// Get thumbnail URL (auto-generated)
const thumb = mediaLibrary.getThumbnailUrl(entity);

// Get embed code for remote videos
const embed = mediaLibrary.getEmbed(entity, {
  width: 560,
  height: 315,
});
```

### Usage Tracking

```javascript
// Track where media is used
await mediaLibrary.trackUsage('media-id', 'article', 'article-123', 'featured_image');

// Remove usage tracking
await mediaLibrary.removeUsage('media-id', 'article', 'article-123');

// Get usage info
const usage = mediaLibrary.getUsage('media-id');
// Returns: [{ contentType, contentId, field, added }]

// Check if in use
const inUse = mediaLibrary.isInUse('media-id');
```

### Statistics

```javascript
const stats = mediaLibrary.getStats();
// Returns:
// {
//   total: 150,
//   byType: { image: 100, video: 30, document: 20 },
//   totalSize: 1073741824, // bytes
//   recentlyAdded: 12,
// }
```

### Custom Media Types

```javascript
// Register a custom media type
mediaLibrary.registerMediaType({
  id: 'podcast',
  label: 'Podcast Episode',
  description: 'Audio podcast episodes',
  extensions: ['mp3', 'm4a'],
  mimeTypes: ['audio/mpeg', 'audio/mp4'],
  schema: {
    duration: { type: 'number' },
    episode: { type: 'number' },
    series: { type: 'string' },
  },
  icon: 'podcast',
});

// Get type info
const type = mediaLibrary.getMediaType('podcast');

// List all types
const types = mediaLibrary.listMediaTypes();

// Detect type from file
const detectedType = mediaLibrary.detectMediaType('episode.mp3', 'audio/mpeg');
```

## CLI Commands

```bash
# List media items
node index.js media:library
node index.js media:library --type=image --limit=50

# Show statistics
node index.js media:stats

# List media types
node index.js media:types

# Show usage for a media item
node index.js media:usage <media-id>
```

## Admin Routes

| Route | Description |
|-------|-------------|
| `GET /admin/media/library` | Media browser |
| `GET /admin/media/library/:id` | Media detail view |
| `GET /admin/media/library/browse` | Browser modal API |
| `POST /admin/media/upload` | Upload endpoint |

## Configuration

In `config/site.json`:

```json
{
  "mediaLibrary": {
    "enabled": true,
    "contentType": "media-entity",
    "thumbnailStyle": "thumbnail",
    "maxFileSize": 52428800,
    "allowedTypes": ["image", "video", "audio", "document", "remote_video"]
  }
}
```

## Hooks

| Hook | Trigger |
|------|---------|
| `media-library:beforeCreate` | Before creating media entity |
| `media-library:afterCreate` | After creating media entity |
| `media-library:beforeUpdate` | Before updating media entity |
| `media-library:afterUpdate` | After updating media entity |
| `media-library:beforeDelete` | Before deleting media entity |
| `media-library:afterDelete` | After deleting media entity |

## Integration with Editor

The WYSIWYG editor can embed media using:

```html
<media-embed data-media-id="media-123"></media-embed>
```

This is processed during content save to render the actual embed.
