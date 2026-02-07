/**
 * test-oembed-cache.js - Create a cached YouTube oEmbed response for testing
 *
 * WHY: Network fetches may be blocked in sandbox. This seeds the cache
 * with a realistic YouTube oEmbed response so we can verify the full
 * fetch → parse → extract pipeline works correctly.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const key = crypto.createHash('md5').update(url).digest('hex');

// Real YouTube oEmbed response format (from YouTube's API docs)
const oembedResponse = {
  type: 'video',
  version: '1.0',
  title: 'Rick Astley - Never Gonna Give You Up (Official Music Video)',
  author_name: 'Rick Astley',
  author_url: 'https://www.youtube.com/@RickAstleyYT',
  provider_name: 'YouTube',
  provider_url: 'https://www.youtube.com/',
  thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  thumbnail_width: 480,
  thumbnail_height: 360,
  html: '<iframe width="800" height="450" src="https://www.youtube.com/embed/dQw4w9WgXcQ?feature=oembed" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen title="Rick Astley - Never Gonna Give You Up (Official Music Video)"></iframe>',
  width: 800,
  height: 450,
};

const cacheData = {
  url,
  oembed: oembedResponse,
  fetchedAt: new Date().toISOString(),
};

const cacheDir = path.join('content', '.cache', 'oembed');
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}

const cachePath = path.join(cacheDir, `${key}.json`);
fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2));
console.log(`Cache key: ${key}`);
console.log(`Cache file: ${cachePath}`);
console.log('YouTube oEmbed cache entry created successfully');
