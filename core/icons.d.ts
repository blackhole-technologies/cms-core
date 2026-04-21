/**
 * Declaration file for icons.js
 *
 * WHY THIS EXISTS:
 * - `core/icons.js` has no .d.ts and the project does not enable `allowJs`,
 *   so TypeScript consumers (e.g. `core/icon-renderer.ts`) would otherwise
 *   implicitly get `any` for every import from this module.
 * - Converting icons.js to TypeScript is out of scope for Task 1.7b
 *   (type-hygiene only — no runtime behavior changes), so we ship a minimal
 *   ambient shim that describes only the exports currently consumed.
 *
 * WHAT'S COVERED:
 * - `getIcon(id)` and `getIconSvg(id)` — the two functions used by
 *   `icon-renderer.ts`.
 * - Full public surface (init, discoverPluginPacks, searchIcons, listPacks,
 *   getIconsByPack, getStats, registerCli, name) — included for completeness
 *   so future TS consumers don't trip over the same TS7016 error.
 *
 * If icons.js is later converted to TypeScript, delete this shim.
 */

/** Icon metadata record stored in the registry. Shape mirrors what
 *  `registerIcon()` writes — see `core/icons.js` for source of truth. */
export interface IconMetadata {
  id: string;
  name: string;
  pack: string;
  path: string;
  tags: string[];
  aliases: string[];
  [key: string]: unknown;
}

/** Icon pack descriptor returned by listPacks(). */
export interface IconPack {
  id: string;
  name: string;
  path: string;
  count: number;
  [key: string]: unknown;
}

/** Registry statistics. */
export interface IconStats {
  totalPacks: number;
  totalIcons: number;
  packs: Array<{ id: string; name: string; count: number }>;
}

/** Options for `searchIcons()`. */
export interface SearchIconsOptions {
  limit?: number;
  pack?: string;
  exact?: boolean;
}

/** Icon configuration passed to init(). */
export interface IconConfig {
  enabled?: boolean;
  packs?: string[];
  [key: string]: unknown;
}

/** Minimal shape of the hooks service consumed by discoverPluginPacks. */
export interface IconsHooksService {
  invoke: (event: string, ...args: unknown[]) => Promise<unknown> | unknown;
  [key: string]: unknown;
}

export function init(iconConfig?: IconConfig, baseDirPath?: string): void;
export function discoverPluginPacks(hooksService: IconsHooksService): Promise<void>;
export function getIcon(id: string): IconMetadata | null;
export function searchIcons(query: string, options?: SearchIconsOptions): IconMetadata[];
export function listPacks(): IconPack[];
export function getIconsByPack(packId: string): IconMetadata[];
export function getIconSvg(id: string): string | null;
export function getStats(): IconStats;
export function registerCli(register: (cmd: unknown) => void): void;
export const name: string;
