# Responsive Images

Responsive image rendering with breakpoints and art direction.

## Overview

Responsive Images provides:

- **Breakpoints**: Named viewport sizes (mobile, tablet, desktop, wide)
- **Responsive Styles**: Map breakpoints to image styles
- **srcset/sizes**: Automatic attribute generation
- **Picture Element**: Art direction with different images per breakpoint
- **Lazy Loading**: Built-in loading="lazy" support
- **WebP/AVIF**: Modern format support

## Quick Start

```javascript
// Get the service
const responsiveImages = ctx.services.get('responsiveImages');

// Generate responsive <img> tag
const html = await responsiveImages.generateImg(
  'path/to/image.jpg',
  'content',  // responsive style
  { alt: 'My image' }
);

// Generate <picture> for art direction
const pictureHtml = await responsiveImages.generatePicture(
  'path/to/image.jpg',
  'hero',
  { alt: 'Hero image' }
);
```

## Built-in Breakpoints

| ID | Label | Range | Media Query |
|----|-------|-------|-------------|
| `mobile` | Mobile | 0-575px | `(max-width: 575px)` |
| `tablet` | Tablet | 576-991px | `(min-width: 576px) and (max-width: 991px)` |
| `desktop` | Desktop | 992-1399px | `(min-width: 992px) and (max-width: 1399px)` |
| `wide` | Wide | 1400px+ | `(min-width: 1400px)` |
| `retina` | Retina | - | `(min-resolution: 192dpi)` |

## Built-in Responsive Styles

| Style | Description | Mappings |
|-------|-------------|----------|
| `hero` | Full-width hero images | mobile→hero_mobile, tablet→hero_tablet, desktop→hero_desktop, wide→hero_wide |
| `content` | Article content images | mobile→medium, tablet/desktop→large, wide→xlarge |
| `thumbnail` | Grid thumbnails | mobile→thumbnail_small, tablet/desktop→thumbnail, wide→thumbnail_large |
| `card` | Card/teaser images | mobile→card_mobile, tablet/desktop→card, wide→card_large |
| `avatar` | Profile images | mobile→avatar_small, rest→avatar |

## API Reference

### Breakpoints

```javascript
// List breakpoints
const breakpoints = responsiveImages.listBreakpoints();

// Get single breakpoint
const bp = responsiveImages.getBreakpoint('tablet');

// Register custom breakpoint
responsiveImages.registerBreakpoint({
  id: 'ultrawide',
  label: 'Ultra Wide',
  minWidth: 1920,
  maxWidth: null,
  weight: 4,
});
```

### Responsive Styles

```javascript
// List styles
const styles = responsiveImages.listResponsiveStyles();

// Get single style
const style = responsiveImages.getResponsiveStyle('hero');

// Register custom style
await responsiveImages.registerResponsiveStyle({
  id: 'gallery',
  label: 'Gallery Image',
  description: 'Images in a lightbox gallery',
  mappings: {
    mobile: 'gallery_small',
    tablet: 'gallery_medium',
    desktop: 'gallery_large',
    wide: 'gallery_xlarge',
  },
  fallbackStyle: 'gallery_large',
  lazyLoad: true,
  sizes: [
    '(max-width: 575px) 100vw',
    '(max-width: 991px) 50vw',
    '800px',
  ],
});

// Update style
await responsiveImages.updateResponsiveStyle('gallery', {
  lazyLoad: false,
});

// Delete style
await responsiveImages.deleteResponsiveStyle('gallery');
```

### HTML Generation

```javascript
// Generate <img> with srcset
const imgHtml = await responsiveImages.generateImg(
  'path/to/image.jpg',
  'content',
  {
    alt: 'Description',
    class: 'my-image',
    width: 800,
    height: 600,
    lazyLoad: true,  // default from style
  }
);
// Output:
// <img src="/media/styles/large/image.jpg"
//      srcset="/media/styles/medium/image.jpg 600w, ..."
//      sizes="(max-width: 575px) 100vw, 800px"
//      alt="Description"
//      loading="lazy" decoding="async" />

// Generate <picture> for art direction
const pictureHtml = await responsiveImages.generatePicture(
  'path/to/image.jpg',
  'hero',
  {
    alt: 'Hero image',
    class: 'hero-image',
  }
);
// Output:
// <picture>
//   <source media="(min-width: 1400px)" srcset="/media/styles/hero_wide/image.webp" type="image/webp" />
//   <source media="(min-width: 1400px)" srcset="/media/styles/hero_wide/image.jpg" />
//   <source media="(min-width: 992px)" ... />
//   ...
//   <img src="/media/styles/hero_desktop/image.jpg" alt="Hero image" />
// </picture>

// High-level render with optional figure wrapper
const html = await responsiveImages.render(
  'path/to/image.jpg',
  'content',
  {
    alt: 'My image',
    caption: 'Image caption',  // Wraps in <figure>
    artDirection: true,        // Use <picture> instead of <img>
  }
);
```

### Utilities

```javascript
// Generate srcset string
const srcset = await responsiveImages.generateSrcset(
  'path/to/image.jpg',
  ['small', 'medium', 'large']
);
// Returns: "/media/styles/small/image.jpg 300w, /media/styles/medium/image.jpg 600w, ..."

// Generate sizes string
const sizes = responsiveImages.generateSizes([
  '(max-width: 575px) 100vw',
  '(max-width: 991px) 80vw',
  '800px',
]);
// Returns: "(max-width: 575px) 100vw, (max-width: 991px) 80vw, 800px"

// Calculate aspect ratio padding (for CSS aspect ratio boxes)
const padding = responsiveImages.getAspectRatioPadding(1920, 1080);
// Returns: 56.25 (for 16:9)
```

## CLI Commands

```bash
# List breakpoints
node index.js images:breakpoints

# List responsive styles
node index.js images:responsive

# Generate responsive HTML
node index.js images:render path/to/image.jpg content
node index.js images:render path/to/image.jpg hero --picture
```

## Admin Routes

| Route | Description |
|-------|-------------|
| `GET /admin/responsive-images` | Responsive styles management |

## Configuration

In `config/site.json`:

```json
{
  "responsiveImages": {
    "enabled": true,
    "defaultLazyLoad": true,
    "defaultFallbackStyle": "large",
    "enableWebP": true,
    "enableAVIF": false,
    "placeholderType": "blur"
  }
}
```

## Storage

- **Breakpoints**: `config/breakpoints.json`
- **Responsive styles**: `config/responsive-images.json`

## Integration with Image Styles

Responsive Images works with the `image-styles` service:

```javascript
// Define image styles first
imageStyles.registerStyle({
  id: 'hero_mobile',
  width: 576,
  height: 324,
  crop: true,
});

// Then map them in responsive style
responsiveImages.registerResponsiveStyle({
  id: 'hero',
  mappings: {
    mobile: 'hero_mobile',
    // ...
  },
});
```

## Template Helper

```html
{{! In your templates }}
{{responsive-image path="uploads/photo.jpg" style="content" alt="Photo" }}

{{! With art direction }}
{{responsive-image path="uploads/hero.jpg" style="hero" alt="Hero" picture=true }}
```
