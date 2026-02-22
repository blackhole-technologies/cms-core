/**
 * Core Utilities Module
 * Common utility functions used across the CMS
 */

// ============================================================================
// Types
// ============================================================================

/** A plain JavaScript object with string keys — the recursive building block
 *  for deepMerge, get/set, and other object utilities. */
export interface PlainObject {
    [key: string]: unknown;
}

// ============================================================================
// HTML Escaping
// ============================================================================

/** HTML entity map for escaping */
const HTML_ENTITIES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
    '`': '&#x60;',
    '=': '&#x3D;'
};

/**
 * Escape HTML special characters to prevent XSS
 */
export function escapeHtml(str: unknown): string {
    if (typeof str !== 'string') {
        return String(str ?? '');
    }
    return str.replace(/[&<>"'`=/]/g, char => HTML_ENTITIES[char] ?? char);
}

/**
 * Decode HTML entities back to characters
 */
export function decodeHtml(str: unknown): string {
    if (typeof str !== 'string')
        return String(str ?? '');
    return str
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, '/')
        .replace(/&#x60;/g, '`')
        .replace(/&#x3D;/g, '=');
}

// ============================================================================
// Object Utilities
// ============================================================================

/**
 * Deep merge objects (Drupal-style drupal_array_merge_deep)
 */
export function deepMerge<T extends PlainObject>(target: T, ...sources: PlainObject[]): T {
    if (!sources.length)
        return target;
    const source = sources.shift();
    if (isPlainObject(target) && isPlainObject(source)) {
        for (const key in source) {
            const sourceVal: unknown = source[key];
            if (isPlainObject(sourceVal)) {
                if (!target[key])
                    Object.assign(target, { [key]: {} });
                deepMerge(target[key] as PlainObject, sourceVal as PlainObject);
            }
            else if (Array.isArray(sourceVal)) {
                const targetVal: unknown = target[key];
                (target as PlainObject)[key] = Array.isArray(targetVal)
                    ? [...targetVal, ...sourceVal]
                    : [...sourceVal];
            }
            else {
                Object.assign(target, { [key]: sourceVal });
            }
        }
    }
    return deepMerge(target, ...sources);
}

/**
 * Check if value is a plain object
 */
export function isPlainObject(obj: unknown): obj is PlainObject {
    return obj !== null && typeof obj === 'object' && (obj as object).constructor === Object;
}

// ============================================================================
// String Utilities
// ============================================================================

/**
 * Generate a machine name from a human-readable string
 */
export function machineName(str: unknown): string {
    return String(str)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .substring(0, 64);
}

/**
 * Generate a UUID v4
 */
export function uuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Create a slug from a string (URL-safe)
 * WHY SEPARATE FROM core/slugify.ts:
 * This is a simpler inline slugify for general use. The dedicated
 * slugify module handles transliteration, uniqueness, and validation.
 */
export function slugify(str: unknown): string {
    return String(str)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 128);
}

/**
 * Truncate string with ellipsis
 */
export function truncate(str: unknown, length: number = 100, suffix: string = '...'): string {
    if (typeof str !== 'string')
        return '';
    if (str.length <= length)
        return str;
    return str.substring(0, length - suffix.length).trim() + suffix;
}

// ============================================================================
// Value Checking
// ============================================================================

/**
 * Check if a value is empty (Drupal-style empty())
 */
export function isEmpty(value: unknown): boolean {
    if (value === null || value === undefined)
        return true;
    if (typeof value === 'string')
        return value.trim() === '';
    if (Array.isArray(value))
        return value.length === 0;
    if (isPlainObject(value))
        return Object.keys(value).length === 0;
    return false;
}

// ============================================================================
// Object Path Access
// ============================================================================

/**
 * Get nested property from object using dot notation
 */
export function get<T = unknown>(obj: unknown, path: string, defaultValue?: T): T | undefined {
    if (!obj || typeof path !== 'string')
        return defaultValue;
    const keys = path.split('.');
    let result: unknown = obj;
    for (const key of keys) {
        if (result === null || result === undefined)
            return defaultValue;
        result = (result as PlainObject)[key];
    }
    return (result === undefined ? defaultValue : result) as T | undefined;
}

/**
 * Set nested property on object using dot notation
 */
export function set<T extends PlainObject>(obj: T, path: string, value: unknown): T {
    if (!obj || typeof path !== 'string')
        return obj;
    const keys = path.split('.');
    let current: PlainObject = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i] as string;
        if (!current[key] || typeof current[key] !== 'object') {
            current[key] = {};
        }
        current = current[key] as PlainObject;
    }
    const lastKey = keys[keys.length - 1];
    if (lastKey !== undefined) {
        current[lastKey] = value;
    }
    return obj;
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
    if (bytes === 0)
        return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'] as const;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

// ============================================================================
// Function Utilities
// ============================================================================

/**
 * Debounce function calls
 */
export function debounce<TArgs extends unknown[]>(
    fn: (...args: TArgs) => void,
    wait: number = 100
): (...args: TArgs) => void {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    return function (this: unknown, ...args: TArgs): void {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn.apply(this, args), wait);
    };
}

/**
 * Throttle function calls
 */
export function throttle<TArgs extends unknown[]>(
    fn: (...args: TArgs) => void,
    limit: number = 100
): (...args: TArgs) => void {
    let inThrottle = false;
    return function (this: unknown, ...args: TArgs): void {
        if (!inThrottle) {
            fn.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// ============================================================================
// Default Export
// ============================================================================

export default {
    escapeHtml,
    decodeHtml,
    deepMerge,
    isPlainObject,
    machineName,
    uuid,
    slugify,
    truncate,
    isEmpty,
    get,
    set,
    formatBytes,
    debounce,
    throttle
};
