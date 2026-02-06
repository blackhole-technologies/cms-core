/**
 * i18n.js - Internationalization and Localization
 *
 * WHY THIS EXISTS:
 * Multi-language support enables:
 * - UI translations for admin interface
 * - Content translations for public-facing pages
 * - Locale detection from request headers/cookies
 * - Interpolation for dynamic strings
 *
 * TRANSLATION FILE STRUCTURE:
 * /locales/<code>.json
 * {
 *   "common.save": "Save",
 *   "content.created": "Created {{type}} successfully"
 * }
 *
 * CONTENT TRANSLATIONS:
 * Stored inline with _translations object:
 * {
 *   "title": "Hello",
 *   "_translations": {
 *     "es": { "title": "Hola" },
 *     "fr": { "title": "Bonjour" }
 *   }
 * }
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Configuration
 */
let config = {
  enabled: true,
  defaultLocale: 'en',
  locales: ['en'],
  fallback: true,        // Fall back to default locale if translation missing
  cookieName: 'locale',  // Cookie name for locale preference
  queryParam: 'locale',  // Query param for locale override
};

/**
 * Base directory and locales path
 */
let baseDir = null;
let localesDir = null;

/**
 * Loaded translations
 * Structure: { locale: { key: value } }
 */
const translations = {};

/**
 * Content service reference for content translations
 */
let contentService = null;

/**
 * Initialize i18n system
 *
 * @param {string} dir - Base directory
 * @param {Object} i18nConfig - i18n configuration
 * @param {Object} content - Content service reference
 */
export function init(dir, i18nConfig = {}, content = null) {
  baseDir = dir;
  contentService = content;

  // Merge config
  config = { ...config, ...i18nConfig };

  // Setup locales directory
  localesDir = join(baseDir, 'locales');
  if (!existsSync(localesDir)) {
    mkdirSync(localesDir, { recursive: true });
  }

  // Load all configured locales
  for (const locale of config.locales) {
    loadLocale(locale);
  }
}

/**
 * Load translation file for a locale
 *
 * @param {string} code - Locale code (e.g., 'en', 'es', 'fr')
 * @returns {boolean} - Success
 */
export function loadLocale(code) {
  if (!localesDir) return false;

  const localePath = join(localesDir, `${code}.json`);

  if (!existsSync(localePath)) {
    // Create empty locale file if it doesn't exist
    translations[code] = {};
    return false;
  }

  try {
    const data = JSON.parse(readFileSync(localePath, 'utf-8'));
    translations[code] = data;
    return true;
  } catch (error) {
    console.warn(`[i18n] Failed to load locale ${code}: ${error.message}`);
    translations[code] = {};
    return false;
  }
}

/**
 * Save translations to file
 *
 * @param {string} code - Locale code
 * @returns {boolean} - Success
 */
export function saveLocale(code) {
  if (!localesDir) return false;

  const localePath = join(localesDir, `${code}.json`);

  try {
    writeFileSync(localePath, JSON.stringify(translations[code] || {}, null, 2) + '\n');
    return true;
  } catch (error) {
    console.error(`[i18n] Failed to save locale ${code}: ${error.message}`);
    return false;
  }
}

/**
 * Translate a key with optional interpolation
 *
 * @param {string} key - Translation key (e.g., 'common.save')
 * @param {Object} params - Interpolation parameters
 * @param {string} locale - Locale to use (defaults to default locale)
 * @returns {string} - Translated string or key if not found
 *
 * Interpolation uses {{param}} syntax:
 * t('content.created', { type: 'article' }) => "Created article successfully"
 */
export function t(key, params = {}, locale = null) {
  const targetLocale = locale || config.defaultLocale;

  // Try target locale first
  let value = translations[targetLocale]?.[key];

  // Fallback to default locale if enabled and not found
  if (value === undefined && config.fallback && targetLocale !== config.defaultLocale) {
    value = translations[config.defaultLocale]?.[key];
  }

  // Return key if no translation found
  if (value === undefined) {
    return key;
  }

  // Interpolate parameters
  if (params && typeof params === 'object') {
    value = value.replace(/\{\{(\w+)\}\}/g, (match, param) => {
      return params[param] !== undefined ? String(params[param]) : match;
    });
  }

  return value;
}

/**
 * Set the default locale
 *
 * @param {string} code - Locale code
 */
export function setDefaultLocale(code) {
  if (!config.locales.includes(code)) {
    throw new Error(`Locale '${code}' is not in the configured locales list`);
  }
  config.defaultLocale = code;
}

/**
 * Get the default locale
 *
 * @returns {string}
 */
export function getDefaultLocale() {
  return config.defaultLocale;
}

/**
 * Detect locale from HTTP request
 * Priority: query param > cookie > Accept-Language header > default
 *
 * @param {http.IncomingMessage} req - HTTP request
 * @returns {string} - Detected locale code
 */
export function getLocale(req) {
  // 1. Check query parameter
  if (req.url) {
    const url = new URL(req.url, 'http://localhost');
    const queryLocale = url.searchParams.get(config.queryParam);
    if (queryLocale && config.locales.includes(queryLocale)) {
      return queryLocale;
    }
  }

  // 2. Check cookie
  const cookies = parseCookies(req.headers?.cookie || '');
  const cookieLocale = cookies[config.cookieName];
  if (cookieLocale && config.locales.includes(cookieLocale)) {
    return cookieLocale;
  }

  // 3. Check Accept-Language header
  const acceptLanguage = req.headers?.['accept-language'];
  if (acceptLanguage) {
    const preferred = parseAcceptLanguage(acceptLanguage);
    for (const lang of preferred) {
      // Check exact match
      if (config.locales.includes(lang)) {
        return lang;
      }
      // Check base language (e.g., 'en-US' -> 'en')
      const base = lang.split('-')[0];
      if (config.locales.includes(base)) {
        return base;
      }
    }
  }

  // 4. Return default
  return config.defaultLocale;
}

/**
 * Parse cookie header into object
 * @private
 */
function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;

  cookieHeader.split(';').forEach(cookie => {
    const [name, value] = cookie.trim().split('=');
    if (name && value) {
      cookies[name] = decodeURIComponent(value);
    }
  });

  return cookies;
}

/**
 * Parse Accept-Language header into sorted list
 * @private
 */
function parseAcceptLanguage(header) {
  const languages = [];

  header.split(',').forEach(part => {
    const [lang, qPart] = part.trim().split(';');
    const q = qPart ? parseFloat(qPart.split('=')[1]) : 1;
    languages.push({ lang: lang.trim(), q });
  });

  // Sort by quality value descending
  languages.sort((a, b) => b.q - a.q);

  return languages.map(l => l.lang);
}

/**
 * Get list of available locales
 *
 * @returns {Array<{ code: string, name: string, keyCount: number, isDefault: boolean }>}
 */
export function getAvailableLocales() {
  return config.locales.map(code => ({
    code,
    name: getLocaleName(code),
    keyCount: Object.keys(translations[code] || {}).length,
    isDefault: code === config.defaultLocale,
  }));
}

/**
 * Get human-readable locale name
 * @private
 */
function getLocaleName(code) {
  const names = {
    en: 'English',
    es: 'Español',
    fr: 'Français',
    de: 'Deutsch',
    it: 'Italiano',
    pt: 'Português',
    nl: 'Nederlands',
    ru: 'Русский',
    zh: '中文',
    ja: '日本語',
    ko: '한국어',
    ar: 'العربية',
  };
  return names[code] || code.toUpperCase();
}

/**
 * Add translations at runtime
 *
 * @param {string} locale - Locale code
 * @param {Object} newTranslations - Key-value pairs to add
 */
export function addTranslations(locale, newTranslations) {
  if (!translations[locale]) {
    translations[locale] = {};
  }

  Object.assign(translations[locale], newTranslations);
}

/**
 * Get all translations for a locale
 *
 * @param {string} locale - Locale code
 * @returns {Object} - All translations
 */
export function getTranslations(locale) {
  return { ...(translations[locale] || {}) };
}

/**
 * Set a single translation
 *
 * @param {string} locale - Locale code
 * @param {string} key - Translation key
 * @param {string} value - Translation value
 */
export function setTranslation(locale, key, value) {
  if (!translations[locale]) {
    translations[locale] = {};
  }
  translations[locale][key] = value;
}

/**
 * Delete a translation
 *
 * @param {string} locale - Locale code
 * @param {string} key - Translation key
 */
export function deleteTranslation(locale, key) {
  if (translations[locale]) {
    delete translations[locale][key];
  }
}

/**
 * Get all unique keys across all locales
 *
 * @returns {string[]} - All translation keys
 */
export function getAllKeys() {
  const keys = new Set();

  for (const locale of Object.keys(translations)) {
    for (const key of Object.keys(translations[locale])) {
      keys.add(key);
    }
  }

  return Array.from(keys).sort();
}

/**
 * Get missing translations for a locale
 *
 * @param {string} locale - Locale to check
 * @returns {string[]} - Keys missing in this locale
 */
export function getMissingKeys(locale) {
  const allKeys = getAllKeys();
  const localeKeys = new Set(Object.keys(translations[locale] || {}));

  return allKeys.filter(key => !localeKeys.has(key));
}

/**
 * Get translation completion stats for a locale
 *
 * @param {string} locale - Locale code
 * @returns {{ total: number, translated: number, percentage: number }}
 */
export function getCompletionStats(locale) {
  const allKeys = getAllKeys();
  const translated = Object.keys(translations[locale] || {}).length;

  return {
    total: allKeys.length,
    translated,
    percentage: allKeys.length > 0 ? Math.round((translated / allKeys.length) * 100) : 100,
  };
}

/**
 * Create a new locale
 *
 * @param {string} code - Locale code
 * @returns {boolean} - Success
 */
export function createLocale(code) {
  if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(code)) {
    throw new Error('Invalid locale code format. Use "xx" or "xx-XX" format.');
  }

  if (translations[code]) {
    return false; // Already exists
  }

  translations[code] = {};

  // Add to configured locales if not present
  if (!config.locales.includes(code)) {
    config.locales.push(code);
  }

  // Save empty locale file
  saveLocale(code);

  return true;
}

/**
 * Export translations for a locale
 *
 * @param {string} locale - Locale code
 * @returns {Object} - Translations object
 */
export function exportTranslations(locale) {
  return {
    locale,
    exported: new Date().toISOString(),
    translations: translations[locale] || {},
  };
}

/**
 * Import translations for a locale
 *
 * @param {string} locale - Locale code
 * @param {Object} data - Import data
 * @param {boolean} merge - Merge with existing (true) or replace (false)
 * @returns {{ added: number, updated: number }}
 */
export function importTranslations(locale, data, merge = true) {
  const existing = translations[locale] || {};
  const incoming = data.translations || data;

  let added = 0;
  let updated = 0;

  if (!merge) {
    translations[locale] = {};
  }

  for (const [key, value] of Object.entries(incoming)) {
    if (existing[key] === undefined) {
      added++;
    } else if (existing[key] !== value) {
      updated++;
    }
    translations[locale] = translations[locale] || {};
    translations[locale][key] = value;
  }

  saveLocale(locale);

  return { added, updated };
}

// ========================================
// Content Translation Support
// ========================================

/**
 * Get translated content item
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {string} locale - Target locale
 * @returns {Object|null} - Translated content or null
 */
export function getContentTranslation(type, id, locale) {
  if (!contentService) return null;

  const item = contentService.read(type, id);
  if (!item) return null;

  // If requesting default locale, return original
  if (locale === config.defaultLocale) {
    return { ...item, _locale: locale };
  }

  // Check for translations
  const itemTranslations = item._translations?.[locale];
  if (!itemTranslations) {
    // Return original with fallback flag if fallback enabled
    if (config.fallback) {
      return { ...item, _locale: config.defaultLocale, _fallback: true };
    }
    return null;
  }

  // Merge translated fields with original
  const translated = { ...item };
  for (const [field, value] of Object.entries(itemTranslations)) {
    translated[field] = value;
  }
  translated._locale = locale;

  // Remove _translations from output
  delete translated._translations;

  return translated;
}

/**
 * Set content translation
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {string} locale - Target locale
 * @param {Object} data - Translated field values
 * @returns {Object|null} - Updated content or null
 */
export async function setContentTranslation(type, id, locale, data) {
  if (!contentService) return null;

  const item = contentService.read(type, id);
  if (!item) return null;

  // Can't translate to default locale (that's the original)
  if (locale === config.defaultLocale) {
    throw new Error('Cannot create translation for default locale');
  }

  // Get schema to find translatable fields
  const schema = contentService.getSchema(type);
  const translatableFields = getTranslatableFields(schema);

  // Filter data to only include translatable fields
  const translationData = {};
  for (const field of translatableFields) {
    if (data[field] !== undefined) {
      translationData[field] = data[field];
    }
  }

  // Update _translations
  const existingTranslations = item._translations || {};
  existingTranslations[locale] = translationData;

  // Update content with new translations
  await contentService.update(type, id, {
    _translations: existingTranslations,
  });

  return contentService.read(type, id);
}

/**
 * Delete content translation
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {string} locale - Locale to delete
 * @returns {boolean} - Success
 */
export async function deleteContentTranslation(type, id, locale) {
  if (!contentService) return false;

  const item = contentService.read(type, id);
  if (!item || !item._translations?.[locale]) return false;

  const existingTranslations = { ...item._translations };
  delete existingTranslations[locale];

  await contentService.update(type, id, {
    _translations: Object.keys(existingTranslations).length > 0 ? existingTranslations : null,
  });

  return true;
}

/**
 * Get translatable fields from schema
 *
 * @param {Object} schema - Content type schema
 * @returns {string[]} - Field names that are translatable
 */
export function getTranslatableFields(schema) {
  if (!schema) return [];

  const fields = [];
  for (const [field, def] of Object.entries(schema)) {
    // String fields with translatable: true (or by default for common fields)
    if (def.type === 'string' && def.translatable !== false) {
      // Auto-detect common translatable fields
      const commonTranslatable = ['title', 'name', 'description', 'body', 'content', 'summary', 'excerpt'];
      if (def.translatable === true || commonTranslatable.includes(field)) {
        fields.push(field);
      }
    }
  }

  return fields;
}

/**
 * Get content translation status
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @returns {Object} - Translation status per locale
 */
export function getContentTranslationStatus(type, id) {
  if (!contentService) return {};

  const item = contentService.read(type, id);
  if (!item) return {};

  const schema = contentService.getSchema(type);
  const translatableFields = getTranslatableFields(schema);
  const totalFields = translatableFields.length;

  const status = {};

  for (const locale of config.locales) {
    if (locale === config.defaultLocale) {
      status[locale] = { translated: totalFields, total: totalFields, percentage: 100, isDefault: true };
      continue;
    }

    const translation = item._translations?.[locale] || {};
    const translatedFields = translatableFields.filter(f => translation[f] !== undefined).length;

    status[locale] = {
      translated: translatedFields,
      total: totalFields,
      percentage: totalFields > 0 ? Math.round((translatedFields / totalFields) * 100) : 100,
      isDefault: false,
    };
  }

  return status;
}

/**
 * Get i18n configuration
 *
 * @returns {Object}
 */
export function getConfig() {
  return { ...config };
}

/**
 * Check if i18n is enabled
 *
 * @returns {boolean}
 */
export function isEnabled() {
  return config.enabled;
}

/**
 * Set locale cookie in response
 *
 * @param {http.ServerResponse} res - HTTP response
 * @param {string} locale - Locale code
 */
export function setLocaleCookie(res, locale) {
  res.setHeader('Set-Cookie', `${config.cookieName}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`);
}
