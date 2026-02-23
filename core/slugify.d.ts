/**
 * Declaration file for slugify.js
 * Provides type information for the slugify module used by content.ts and taxonomy.ts
 */

export function transliterate(text: string): string;
export function slugify(text: string, options?: { maxLength?: number; separator?: string; lowercase?: boolean }): string;
export function generateUniqueSlug(baseSlug: string, existsFn: (slug: string) => boolean | Promise<boolean>, options?: { maxAttempts?: number; separator?: string }): Promise<string>;
export function validateSlug(slug: string, options?: { separator?: string; minLength?: number; maxLength?: number; allowDots?: boolean }): { valid: boolean; errors: string[] };
export function looksLikeId(slug: string): boolean;
export function extractSlugFromPath(path: string): string;

declare const _default: {
  transliterate: typeof transliterate;
  slugify: typeof slugify;
  generateUniqueSlug: typeof generateUniqueSlug;
  validateSlug: typeof validateSlug;
  looksLikeId: typeof looksLikeId;
  extractSlugFromPath: typeof extractSlugFromPath;
};
export default _default;
