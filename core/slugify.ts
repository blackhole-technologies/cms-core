/**
 * slugify.ts - URL Slug Generation Utilities
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
 *    - e -> e, n -> n, u -> u, etc.
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
 *    - First "Hello World" -> hello-world
 *    - Second "Hello World" -> hello-world-1
 *    - This prevents URL collisions
 *
 * 4. HISTORY TRACKING
 *    When a slug changes, the old slug is preserved:
 *    - Old URLs continue to work via redirects
 *    - SEO juice isn't lost when renaming content
 *    - Users' bookmarks don't break
 */

// ============================================================================
// Types
// ============================================================================

/** Options for slugify() */
export interface SlugifyOptions {
  lowercase?: boolean;
  separator?: string;
  maxLength?: number;
  transliterate?: boolean;
  trim?: boolean;
}

/** Options for generateUniqueSlug() */
export interface UniqueSlugOptions {
  maxAttempts?: number;
}

/** Options for validateSlug() */
export interface ValidateSlugOptions {
  separator?: string;
  maxLength?: number;
}

/** Result of slug validation */
export interface SlugValidationResult {
  valid: boolean;
  errors: string[];
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Character transliteration map
 * Converts accented and special characters to ASCII
 */
const TRANSLITERATION_MAP: Record<string, string> = {
    // Latin extended characters
    '\u00e0': 'a', '\u00e1': 'a', '\u00e2': 'a', '\u00e3': 'a', '\u00e4': 'a', '\u00e5': 'a', '\u00e6': 'ae',
    '\u00e7': 'c', '\u010d': 'c', '\u0107': 'c',
    '\u00e8': 'e', '\u00e9': 'e', '\u00ea': 'e', '\u00eb': 'e', '\u011b': 'e',
    '\u00ec': 'i', '\u00ed': 'i', '\u00ee': 'i', '\u00ef': 'i',
    '\u00f0': 'd', '\u0111': 'd',
    '\u00f1': 'n', '\u0144': 'n',
    '\u00f2': 'o', '\u00f3': 'o', '\u00f4': 'o', '\u00f5': 'o', '\u00f6': 'o', '\u00f8': 'o', '\u0153': 'oe',
    '\u0159': 'r',
    '\u0161': 's', '\u015b': 's', '\u015f': 's',
    '\u00f9': 'u', '\u00fa': 'u', '\u00fb': 'u', '\u00fc': 'u', '\u016f': 'u',
    '\u00fd': 'y', '\u00ff': 'y',
    '\u017e': 'z', '\u017a': 'z', '\u017c': 'z',
    '\u00fe': 'th', '\u00df': 'ss',
    // Uppercase versions
    '\u00c0': 'a', '\u00c1': 'a', '\u00c2': 'a', '\u00c3': 'a', '\u00c4': 'a', '\u00c5': 'a', '\u00c6': 'ae',
    '\u00c7': 'c', '\u010c': 'c', '\u0106': 'c',
    '\u00c8': 'e', '\u00c9': 'e', '\u00ca': 'e', '\u00cb': 'e', '\u011a': 'e',
    '\u00cc': 'i', '\u00cd': 'i', '\u00ce': 'i', '\u00cf': 'i',
    '\u00d0': 'd', '\u0110': 'd',
    '\u00d1': 'n', '\u0143': 'n',
    '\u00d2': 'o', '\u00d3': 'o', '\u00d4': 'o', '\u00d5': 'o', '\u00d6': 'o', '\u00d8': 'o', '\u0152': 'oe',
    '\u0158': 'r',
    '\u0160': 's', '\u015a': 's', '\u015e': 's',
    '\u00d9': 'u', '\u00da': 'u', '\u00db': 'u', '\u00dc': 'u', '\u016e': 'u',
    '\u00dd': 'y', '\u0178': 'y',
    '\u017d': 'z', '\u0179': 'z', '\u017b': 'z',
    '\u00de': 'th',
    // Currency and symbols
    '\u20ac': 'euro', '\u00a3': 'pound', '\u00a5': 'yen', '$': 'dollar',
    '\u00a9': 'c', '\u00ae': 'r', '\u2122': 'tm',
    // Common replacements
    '&': 'and', '@': 'at', '#': 'hash',
    // Cyrillic (basic)
    '\u0430': 'a', '\u0431': 'b', '\u0432': 'v', '\u0433': 'g', '\u0434': 'd', '\u0435': 'e', '\u0451': 'yo',
    '\u0436': 'zh', '\u0437': 'z', '\u0438': 'i', '\u0439': 'y', '\u043a': 'k', '\u043b': 'l', '\u043c': 'm',
    '\u043d': 'n', '\u043e': 'o', '\u043f': 'p', '\u0440': 'r', '\u0441': 's', '\u0442': 't', '\u0443': 'u',
    '\u0444': 'f', '\u0445': 'kh', '\u0446': 'ts', '\u0447': 'ch', '\u0448': 'sh', '\u0449': 'shch',
    '\u044a': '', '\u044b': 'y', '\u044c': '', '\u044d': 'e', '\u044e': 'yu', '\u044f': 'ya',
};

/** Default slug options */
const DEFAULT_OPTIONS: Required<SlugifyOptions> = {
    lowercase: true,
    separator: '-',
    maxLength: 100,
    transliterate: true,
    trim: true,
};

// ============================================================================
// Private Helpers
// ============================================================================

/**
 * Truncate slug to maxLength, preferring word boundaries
 *
 * WHY SMART TRUNCATION:
 * - 'hello-world-this-is-a-long-title' truncated at 20 should be 'hello-world-this-is'
 * - Not 'hello-world-this-is-' (trailing separator)
 * - Not 'hello-world-this-is-a' (cut mid-word is OK as last resort)
 */
function truncateSlug(slug: string, maxLength: number, separator: string): string {
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
 */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Transliterate a string - convert special characters to ASCII
 *
 * WHY NOT USE A LIBRARY:
 * - Zero dependencies is a project goal
 * - Our map covers common cases (Latin, some Cyrillic)
 * - Can be extended as needed
 */
export function transliterate(text: string): string {
    if (!text || typeof text !== 'string') {
        return '';
    }
    let result = '';
    for (const char of text) {
        result += TRANSLITERATION_MAP[char] ?? char;
    }
    return result;
}

/**
 * Convert text to a URL-safe slug
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
 * slugify('Cafe au Lait')          // 'cafe-au-lait'
 * slugify('  Multiple   Spaces ')  // 'multiple-spaces'
 * slugify('Price: $100!')          // 'price-dollar100'
 */
export function slugify(text: string, options: SlugifyOptions = {}): string {
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
 * Generate a unique slug by appending a number suffix
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
export async function generateUniqueSlug(
    baseSlug: string,
    existsFn: (slug: string) => boolean | Promise<boolean>,
    options: UniqueSlugOptions = {}
): Promise<string> {
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
 * VALIDATION RULES:
 * - Must not be empty
 * - Must contain only lowercase letters, numbers, and separator
 * - Must not start or end with separator
 * - Must not have consecutive separators
 * - Must not exceed maxLength
 */
export function validateSlug(slug: string, options: ValidateSlugOptions = {}): SlugValidationResult {
    const { separator = '-', maxLength = 100 } = options;
    const errors: string[] = [];
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
 * WHY CHECK:
 * - Sometimes people pass IDs where slugs are expected
 * - IDs look like: 1705123456789-x7k9m
 * - Slugs look like: hello-world
 */
export function looksLikeId(slug: string): boolean {
    if (!slug)
        return false;
    // ID pattern: timestamp-random (13 digits + hyphen + 5 alphanumeric)
    return /^\d{13}-[a-z0-9]{5}$/.test(slug);
}

/**
 * Extract slug from a URL path
 *
 * @example
 * extractSlugFromPath('/article/hello-world')  // 'hello-world'
 * extractSlugFromPath('/blog/2024/my-post')    // 'my-post'
 */
export function extractSlugFromPath(path: string): string | null {
    if (!path)
        return null;
    const segments = path.split('/').filter(Boolean);
    return segments.length > 0 ? segments[segments.length - 1]! : null;
}
