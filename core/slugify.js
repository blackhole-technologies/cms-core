/**
 * slugify.js - URL Slug Generation Utilities
 *
 * WHY SLUGS:
 * ==========
 * Slugs are URL-friendly versions of titles or names.
 * Instead of: /article/1705123456789-x7k9m
 * You get:    /article/hello-world
 *
 * BENEFITS:
 * - SEO-friendly URLs (search engines prefer readable URLs)
 * - Human-readable (users can understand what they'll see)
 * - Shareable (looks better in social media, emails)
 * - Memorable (easier to type or remember)
 *
 * DESIGN DECISIONS:
 * =================
 *
 * 1. TRANSLITERATION
 *    Unicode characters are converted to ASCII equivalents:
 *    - é → e, ñ → n, ü → u, etc.
 *    - This ensures URLs work in all browsers and systems
 *    - Some CMS systems use URL encoding instead, but that's ugly
 *
 * 2. SEPARATOR
 *    Hyphens (-) are preferred over underscores (_):
 *    - Google treats hyphens as word separators
 *    - Hyphens are more readable in URLs
 *    - Industry standard for most modern systems
 *
 * 3. UNIQUENESS
 *    Slugs should be unique within a content type:
 *    - First "Hello World" → hello-world
 *    - Second "Hello World" → hello-world-1
 *    - This prevents URL collisions
 *
 * 4. HISTORY TRACKING
 *    When a slug changes, the old slug is preserved:
 *    - Old URLs continue to work via redirects
 *    - SEO juice isn't lost when renaming content
 *    - Users' bookmarks don't break
 */

/**
 * Character transliteration map
 * Converts accented and special characters to ASCII
 */
const TRANSLITERATION_MAP = {
  // Latin extended characters
  'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a', 'å': 'a', 'æ': 'ae',
  'ç': 'c', 'č': 'c', 'ć': 'c',
  'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e', 'ě': 'e',
  'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i',
  'ð': 'd', 'đ': 'd',
  'ñ': 'n', 'ń': 'n',
  'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'ø': 'o', 'œ': 'oe',
  'ř': 'r',
  'š': 's', 'ś': 's', 'ş': 's',
  'ù': 'u', 'ú': 'u', 'û': 'u', 'ü': 'u', 'ů': 'u',
  'ý': 'y', 'ÿ': 'y',
  'ž': 'z', 'ź': 'z', 'ż': 'z',
  'þ': 'th', 'ß': 'ss',
  // Uppercase versions
  'À': 'a', 'Á': 'a', 'Â': 'a', 'Ã': 'a', 'Ä': 'a', 'Å': 'a', 'Æ': 'ae',
  'Ç': 'c', 'Č': 'c', 'Ć': 'c',
  'È': 'e', 'É': 'e', 'Ê': 'e', 'Ë': 'e', 'Ě': 'e',
  'Ì': 'i', 'Í': 'i', 'Î': 'i', 'Ï': 'i',
  'Ð': 'd', 'Đ': 'd',
  'Ñ': 'n', 'Ń': 'n',
  'Ò': 'o', 'Ó': 'o', 'Ô': 'o', 'Õ': 'o', 'Ö': 'o', 'Ø': 'o', 'Œ': 'oe',
  'Ř': 'r',
  'Š': 's', 'Ś': 's', 'Ş': 's',
  'Ù': 'u', 'Ú': 'u', 'Û': 'u', 'Ü': 'u', 'Ů': 'u',
  'Ý': 'y', 'Ÿ': 'y',
  'Ž': 'z', 'Ź': 'z', 'Ż': 'z',
  'Þ': 'th',
  // Currency and symbols
  '€': 'euro', '£': 'pound', '¥': 'yen', '$': 'dollar',
  '©': 'c', '®': 'r', '™': 'tm',
  // Common replacements
  '&': 'and', '@': 'at', '#': 'hash',
  // Cyrillic (basic)
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo',
  'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
  'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
  'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch',
  'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
};

/**
 * Default slug options
 */
const DEFAULT_OPTIONS = {
  lowercase: true,
  separator: '-',
  maxLength: 100,
  transliterate: true,
  trim: true,
};

/**
 * Transliterate a string - convert special characters to ASCII
 *
 * @param {string} text - Input text with potential unicode characters
 * @returns {string} - ASCII-safe string
 *
 * WHY NOT USE A LIBRARY:
 * - Zero dependencies is a project goal
 * - Our map covers common cases (Latin, some Cyrillic)
 * - Can be extended as needed
 */
export function transliterate(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }

  let result = '';
  for (const char of text) {
    result += TRANSLITERATION_MAP[char] || char;
  }
  return result;
}

/**
 * Convert text to a URL-safe slug
 *
 * @param {string} text - The text to slugify (e.g., "Hello World!")
 * @param {Object} options - Slug options
 * @param {boolean} options.lowercase - Convert to lowercase (default: true)
 * @param {string} options.separator - Word separator (default: '-')
 * @param {number} options.maxLength - Maximum slug length (default: 100)
 * @param {boolean} options.transliterate - Convert unicode to ASCII (default: true)
 * @param {boolean} options.trim - Trim whitespace (default: true)
 * @returns {string} - URL-safe slug
 *
 * TRANSFORMATION STEPS:
 * 1. Transliterate unicode characters
 * 2. Convert to lowercase (if enabled)
 * 3. Replace spaces and invalid chars with separator
 * 4. Collapse multiple separators
 * 5. Remove leading/trailing separators
 * 6. Truncate to maxLength
 *
 * @example
 * slugify('Hello World!')          // 'hello-world'
 * slugify('Café au Lait')          // 'cafe-au-lait'
 * slugify('  Multiple   Spaces ')  // 'multiple-spaces'
 * slugify('Price: $100!')          // 'price-dollar100'
 */
export function slugify(text, options = {}) {
  if (!text || typeof text !== 'string') {
    return '';
  }

  const opts = { ...DEFAULT_OPTIONS, ...options };
  let slug = text;

  // Step 1: Transliterate unicode to ASCII
  if (opts.transliterate) {
    slug = transliterate(slug);
  }

  // Step 2: Convert to lowercase
  if (opts.lowercase) {
    slug = slug.toLowerCase();
  }

  // Step 3: Replace non-alphanumeric characters with separator
  // Keep only letters, numbers, and the separator
  slug = slug.replace(/[^a-zA-Z0-9]+/g, opts.separator);

  // Step 4: Collapse multiple separators
  const sepRegex = new RegExp(`${escapeRegex(opts.separator)}+`, 'g');
  slug = slug.replace(sepRegex, opts.separator);

  // Step 5: Remove leading/trailing separators
  if (opts.trim) {
    const trimRegex = new RegExp(`^${escapeRegex(opts.separator)}|${escapeRegex(opts.separator)}$`, 'g');
    slug = slug.replace(trimRegex, '');
  }

  // Step 6: Truncate to maxLength (but don't cut mid-word if possible)
  if (opts.maxLength > 0 && slug.length > opts.maxLength) {
    slug = truncateSlug(slug, opts.maxLength, opts.separator);
  }

  return slug;
}

/**
 * Truncate slug to maxLength, preferring word boundaries
 *
 * @param {string} slug - The slug to truncate
 * @param {number} maxLength - Maximum length
 * @param {string} separator - Word separator
 * @returns {string} - Truncated slug
 *
 * WHY SMART TRUNCATION:
 * - 'hello-world-this-is-a-long-title' truncated at 20 should be 'hello-world-this-is'
 * - Not 'hello-world-this-is-' (trailing separator)
 * - Not 'hello-world-this-is-a' (cut mid-word is OK as last resort)
 */
function truncateSlug(slug, maxLength, separator) {
  if (slug.length <= maxLength) {
    return slug;
  }

  // Cut at maxLength
  let truncated = slug.substring(0, maxLength);

  // Try to cut at last separator
  const lastSep = truncated.lastIndexOf(separator);
  if (lastSep > maxLength * 0.5) { // Only if we keep at least half
    truncated = truncated.substring(0, lastSep);
  }

  // Remove trailing separator if any
  while (truncated.endsWith(separator)) {
    truncated = truncated.slice(0, -separator.length);
  }

  return truncated;
}

/**
 * Escape special regex characters
 *
 * @param {string} str - String to escape
 * @returns {string} - Regex-safe string
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Generate a unique slug by appending a number suffix
 *
 * @param {string} baseSlug - The desired slug
 * @param {Function} existsFn - Function that returns true if slug exists
 * @param {Object} options - Options
 * @param {number} options.maxAttempts - Maximum attempts before giving up (default: 100)
 * @returns {Promise<string>} - Unique slug
 *
 * UNIQUENESS STRATEGY:
 * - Try base slug first: 'hello-world'
 * - If exists, try: 'hello-world-1', 'hello-world-2', etc.
 * - Give up after maxAttempts to prevent infinite loops
 *
 * WHY ASYNC:
 * - existsFn might need to check a database or filesystem
 * - Allows for async uniqueness checks
 *
 * @example
 * const slug = await generateUniqueSlug('hello-world', async (s) => {
 *   return content.getBySlug('article', s) !== null;
 * });
 */
export async function generateUniqueSlug(baseSlug, existsFn, options = {}) {
  const { maxAttempts = 100 } = options;

  // Try base slug first
  if (!(await existsFn(baseSlug))) {
    return baseSlug;
  }

  // Try numbered suffixes
  for (let i = 1; i <= maxAttempts; i++) {
    const candidateSlug = `${baseSlug}-${i}`;
    if (!(await existsFn(candidateSlug))) {
      return candidateSlug;
    }
  }

  // Give up - use timestamp suffix as fallback
  const timestamp = Date.now().toString(36);
  return `${baseSlug}-${timestamp}`;
}

/**
 * Validate a slug format
 *
 * @param {string} slug - Slug to validate
 * @param {Object} options - Validation options
 * @param {string} options.separator - Expected separator (default: '-')
 * @param {number} options.maxLength - Maximum length (default: 100)
 * @returns {Object} - { valid: boolean, errors: string[] }
 *
 * VALIDATION RULES:
 * - Must not be empty
 * - Must contain only lowercase letters, numbers, and separator
 * - Must not start or end with separator
 * - Must not have consecutive separators
 * - Must not exceed maxLength
 */
export function validateSlug(slug, options = {}) {
  const { separator = '-', maxLength = 100 } = options;
  const errors = [];

  if (!slug || typeof slug !== 'string') {
    return { valid: false, errors: ['Slug is required'] };
  }

  // Check characters
  const validPattern = new RegExp(`^[a-z0-9${escapeRegex(separator)}]+$`);
  if (!validPattern.test(slug)) {
    errors.push('Slug must contain only lowercase letters, numbers, and hyphens');
  }

  // Check leading/trailing separator
  if (slug.startsWith(separator)) {
    errors.push('Slug must not start with a hyphen');
  }
  if (slug.endsWith(separator)) {
    errors.push('Slug must not end with a hyphen');
  }

  // Check consecutive separators
  const consecutivePattern = new RegExp(`${escapeRegex(separator)}{2,}`);
  if (consecutivePattern.test(slug)) {
    errors.push('Slug must not have consecutive hyphens');
  }

  // Check length
  if (slug.length > maxLength) {
    errors.push(`Slug must not exceed ${maxLength} characters`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Check if a slug looks like an auto-generated ID
 *
 * @param {string} slug - Slug to check
 * @returns {boolean} - True if it looks like an ID
 *
 * WHY CHECK:
 * - Sometimes people pass IDs where slugs are expected
 * - IDs look like: 1705123456789-x7k9m
 * - Slugs look like: hello-world
 */
export function looksLikeId(slug) {
  if (!slug) return false;
  // ID pattern: timestamp-random (13 digits + hyphen + 5 alphanumeric)
  return /^\d{13}-[a-z0-9]{5}$/.test(slug);
}

/**
 * Extract slug from a URL path
 *
 * @param {string} path - URL path like '/article/hello-world' or '/blog/2024/hello-world'
 * @returns {string|null} - Extracted slug or null
 *
 * @example
 * extractSlugFromPath('/article/hello-world')  // 'hello-world'
 * extractSlugFromPath('/blog/2024/my-post')    // 'my-post'
 */
export function extractSlugFromPath(path) {
  if (!path) return null;
  const segments = path.split('/').filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : null;
}
