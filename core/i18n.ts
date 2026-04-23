/**
 * i18n.ts - Internationalization and Localization
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
import type { IncomingMessage, ServerResponse } from 'node:http';

// ============================================================================
// Types
// ============================================================================

/** i18n configuration */
interface I18nConfig {
  enabled: boolean;
  defaultLocale: string;
  locales: string[];
  /** Fall back to default locale if translation missing */
  fallback: boolean;
  /** Cookie name for locale preference */
  cookieName: string;
  /** Query param for locale override */
  queryParam: string;
}

/** Statistics for a locale's translation coverage */
export interface CompletionStats {
  total: number;
  translated: number;
  percentage: number;
}

/** Available locale descriptor */
export interface LocaleInfo {
  code: string;
  name: string;
  keyCount: number;
  isDefault: boolean;
}

/** Export envelope */
export interface TranslationExport {
  locale: string;
  exported: string;
  translations: Record<string, string>;
}

/** Import result */
export interface ImportResult {
  added: number;
  updated: number;
}

/** Content service — only the methods consumed by i18n are described here */
interface ContentService {
  read(type: string, id: string): Record<string, unknown> | null;
  getSchema(type: string): Record<string, { type: string; translatable?: boolean }> | null;
  update(type: string, id: string, data: Record<string, unknown>): Promise<Record<string, unknown> | null>;
}

// ============================================================================
// Module state
// ============================================================================

/**
 * Configuration
 */
let config: I18nConfig = {
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
let baseDir: string | null = null;
let localesDir: string | null = null;

/**
 * Loaded translations
 * Structure: { locale: { key: value } }
 */
const translations: Record<string, Record<string, string>> = {};

/**
 * Content service reference for content translations
 */
let contentService: ContentService | null = null;

/**
 * Initialize i18n system
 */
export function init(dir: string, i18nConfig: Partial<I18nConfig> = {}, content: ContentService | null = null): void {
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
 */
export function loadLocale(code: string): boolean {
  if (!localesDir) return false;

  const localePath = join(localesDir, `${code}.json`);

  if (!existsSync(localePath)) {
    // Create empty locale file if it doesn't exist
    translations[code] = {};
    return false;
  }

  try {
    const data = JSON.parse(readFileSync(localePath, 'utf-8')) as Record<string, string>;
    translations[code] = data;
    return true;
  } catch (error) {
    console.warn(`[i18n] Failed to load locale ${code}: ${(error as Error).message}`);
    translations[code] = {};
    return false;
  }
}

/**
 * Save translations to file
 */
export function saveLocale(code: string): boolean {
  if (!localesDir) return false;

  const localePath = join(localesDir, `${code}.json`);

  try {
    writeFileSync(localePath, JSON.stringify(translations[code] || {}, null, 2) + '\n');
    return true;
  } catch (error) {
    console.error(`[i18n] Failed to save locale ${code}: ${(error as Error).message}`);
    return false;
  }
}

/**
 * Translate a key with optional interpolation.
 *
 * Interpolation uses {{param}} syntax:
 * t('content.created', { type: 'article' }) => "Created article successfully"
 */
export function t(key: string, params: Record<string, unknown> = {}, locale: string | null = null): string {
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
    value = value.replace(/\{\{(\w+)\}\}/g, (match: string, param: string) => {
      return params[param] !== undefined ? String(params[param]) : match;
    });
  }

  return value;
}

/**
 * Set the default locale
 */
export function setDefaultLocale(code: string): void {
  if (!config.locales.includes(code)) {
    throw new Error(`Locale '${code}' is not in the configured locales list`);
  }
  config.defaultLocale = code;
}

/**
 * Get the default locale
 */
export function getDefaultLocale(): string {
  return config.defaultLocale;
}

/**
 * Detect locale from HTTP request
 * Priority: query param > cookie > Accept-Language header > default
 */
export function getLocale(req: IncomingMessage): string {
  // 1. Check query parameter
  if (req.url) {
    const url = new URL(req.url, 'http://localhost');
    const queryLocale = url.searchParams.get(config.queryParam);
    if (queryLocale && config.locales.includes(queryLocale)) {
      return queryLocale;
    }
  }

  // 2. Check cookie
  const cookieHeader = (req.headers as Record<string, string | string[] | undefined>)['cookie'];
  const cookies = parseCookies(typeof cookieHeader === 'string' ? cookieHeader : '');
  const cookieLocale = cookies[config.cookieName];
  if (cookieLocale && config.locales.includes(cookieLocale)) {
    return cookieLocale;
  }

  // 3. Check Accept-Language header
  const acceptLanguage = (req.headers as Record<string, string | string[] | undefined>)['accept-language'];
  if (typeof acceptLanguage === 'string') {
    const preferred = parseAcceptLanguage(acceptLanguage);
    for (const lang of preferred) {
      // Check exact match
      if (config.locales.includes(lang)) {
        return lang;
      }
      // Check base language (e.g., 'en-US' -> 'en')
      const base = lang.split('-')[0] ?? '';
      if (base && config.locales.includes(base)) {
        return base;
      }
    }
  }

  // 4. Return default
  return config.defaultLocale;
}

/**
 * Parse cookie header into object
 */
function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  cookieHeader.split(';').forEach((cookie: string) => {
    const eqIdx = cookie.indexOf('=');
    if (eqIdx === -1) return;
    const name = cookie.slice(0, eqIdx).trim();
    const value = cookie.slice(eqIdx + 1).trim();
    if (name && value) {
      cookies[name] = decodeURIComponent(value);
    }
  });

  return cookies;
}

/**
 * Parse Accept-Language header into sorted list
 */
function parseAcceptLanguage(header: string): string[] {
  const languages: Array<{ lang: string; q: number }> = [];

  header.split(',').forEach((part: string) => {
    const [lang, qPart] = part.trim().split(';');
    const qStr = qPart ? qPart.split('=')[1] : undefined;
    const q = qStr ? parseFloat(qStr) : 1;
    if (lang) {
      languages.push({ lang: lang.trim(), q });
    }
  });

  // Sort by quality value descending
  languages.sort((a, b) => b.q - a.q);

  return languages.map((l) => l.lang);
}

/**
 * Get list of available locales
 */
export function getAvailableLocales(): LocaleInfo[] {
  return config.locales.map(code => ({
    code,
    name: getLocaleName(code),
    keyCount: Object.keys(translations[code] || {}).length,
    isDefault: code === config.defaultLocale,
  }));
}

/**
 * Get human-readable locale name
 */
function getLocaleName(code: string): string {
  const names: Record<string, string> = {
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
 */
export function addTranslations(locale: string, newTranslations: Record<string, string>): void {
  if (!translations[locale]) {
    translations[locale] = {};
  }

  Object.assign(translations[locale], newTranslations);
}

/**
 * Get all translations for a locale
 */
export function getTranslations(locale: string): Record<string, string> {
  return { ...(translations[locale] || {}) };
}

/**
 * Set a single translation
 */
export function setTranslation(locale: string, key: string, value: string): void {
  if (!translations[locale]) {
    translations[locale] = {};
  }
  translations[locale][key] = value;
}

/**
 * Delete a translation
 */
export function deleteTranslation(locale: string, key: string): void {
  if (translations[locale]) {
    delete translations[locale][key];
  }
}

/**
 * Get all unique keys across all locales
 */
export function getAllKeys(): string[] {
  const keys = new Set<string>();

  for (const locale of Object.keys(translations)) {
    for (const key of Object.keys(translations[locale] ?? {})) {
      keys.add(key);
    }
  }

  return Array.from(keys).sort();
}

/**
 * Get missing translations for a locale
 */
export function getMissingKeys(locale: string): string[] {
  const allKeys = getAllKeys();
  const localeKeys = new Set(Object.keys(translations[locale] || {}));

  return allKeys.filter(key => !localeKeys.has(key));
}

/**
 * Get translation completion stats for a locale
 */
export function getCompletionStats(locale: string): CompletionStats {
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
 */
export function createLocale(code: string): boolean {
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
 */
export function exportTranslations(locale: string): TranslationExport {
  return {
    locale,
    exported: new Date().toISOString(),
    translations: translations[locale] || {},
  };
}

/**
 * Import translations for a locale
 */
export function importTranslations(locale: string, data: TranslationExport | Record<string, string>, merge: boolean = true): ImportResult {
  const existing = translations[locale] || {};
  const incoming = (data as TranslationExport).translations ?? (data as Record<string, string>);

  let added = 0;
  let updated = 0;

  if (!merge) {
    translations[locale] = {};
  }

  for (const [key, value] of Object.entries(incoming)) {
    const existingVal = existing[key];
    if (existingVal === undefined) {
      added++;
    } else if (existingVal !== value) {
      updated++;
    }
    if (!translations[locale]) {
      translations[locale] = {};
    }
    translations[locale]![key] = String(value);
  }

  saveLocale(locale);

  return { added, updated };
}

// ========================================
// Content Translation Support
// ========================================

/**
 * Get translated content item
 */
export function getContentTranslation(type: string, id: string, locale: string): Record<string, unknown> | null {
  if (!contentService) return null;

  const item = contentService.read(type, id);
  if (!item) return null;

  // If requesting default locale, return original
  if (locale === config.defaultLocale) {
    return { ...item, _locale: locale };
  }

  // Check for translations
  const itemTranslations = (item['_translations'] as Record<string, Record<string, unknown>> | undefined)?.[locale];
  if (!itemTranslations) {
    // Return original with fallback flag if fallback enabled
    if (config.fallback) {
      return { ...item, _locale: config.defaultLocale, _fallback: true };
    }
    return null;
  }

  // Merge translated fields with original
  const translated: Record<string, unknown> = { ...item };
  for (const [field, value] of Object.entries(itemTranslations)) {
    translated[field] = value;
  }
  translated['_locale'] = locale;

  // Remove _translations from output
  delete translated['_translations'];

  return translated;
}

/**
 * Set content translation
 */
export async function setContentTranslation(
  type: string,
  id: string,
  locale: string,
  data: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
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
  const translationData: Record<string, unknown> = {};
  for (const field of translatableFields) {
    if (data[field] !== undefined) {
      translationData[field] = data[field];
    }
  }

  // Update _translations
  const existingTranslations: Record<string, Record<string, unknown>> = (item['_translations'] as Record<string, Record<string, unknown>> | undefined) ?? {};
  existingTranslations[locale] = translationData;

  // Update content with new translations
  await contentService.update(type, id, {
    _translations: existingTranslations,
  });

  return contentService.read(type, id);
}

/**
 * Delete content translation
 */
export async function deleteContentTranslation(type: string, id: string, locale: string): Promise<boolean> {
  if (!contentService) return false;

  const item = contentService.read(type, id);
  const existingTrans = item ? (item['_translations'] as Record<string, unknown> | undefined) : undefined;
  if (!item || !existingTrans?.[locale]) return false;

  const existingTranslations: Record<string, unknown> = { ...existingTrans };
  delete existingTranslations[locale];

  await contentService.update(type, id, {
    _translations: Object.keys(existingTranslations).length > 0 ? existingTranslations : null,
  });

  return true;
}

/**
 * Get translatable fields from schema
 */
export function getTranslatableFields(schema: Record<string, { type: string; translatable?: boolean }> | null | undefined): string[] {
  if (!schema) return [];

  const fields: string[] = [];
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
 */
export function getContentTranslationStatus(type: string, id: string): Record<string, { translated: number; total: number; percentage: number; isDefault: boolean }> {
  if (!contentService) return {};

  const item = contentService.read(type, id);
  if (!item) return {};

  const schema = contentService.getSchema(type);
  const translatableFields = getTranslatableFields(schema);
  const totalFields = translatableFields.length;

  const status: Record<string, { translated: number; total: number; percentage: number; isDefault: boolean }> = {};

  for (const locale of config.locales) {
    if (locale === config.defaultLocale) {
      status[locale] = { translated: totalFields, total: totalFields, percentage: 100, isDefault: true };
      continue;
    }

    const localeTransMap = (item['_translations'] as Record<string, Record<string, unknown>> | undefined)?.[locale] ?? {};
    const translatedFields = translatableFields.filter((f) => localeTransMap[f] !== undefined).length;

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
 */
export function getConfig(): I18nConfig {
  return { ...config };
}

/**
 * Check if i18n is enabled
 */
export function isEnabled(): boolean {
  return config.enabled;
}

/**
 * Set locale cookie in response
 */
export function setLocaleCookie(res: ServerResponse, locale: string): void {
  res.setHeader('Set-Cookie', `${config.cookieName}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`);
}
