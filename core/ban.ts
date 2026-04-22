/**
 * ban.ts - IP Ban Service for CMS-Core
 *
 * - In-memory cache for fast middleware checks (runs on EVERY request)
 * - Single JSON file storage (content/ban/bans.json)
 * - CIDR range support for network-level blocks
 * - Temporary ban support via expires field
 * - Zero dependencies (Node.js built-in only)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

interface BanEntry {
  ip: string;
  reason: string;
  created: string;
  expires: string | null;
  bannedBy: string;
}

interface BanConfig {
  enabled: boolean;
  message: string;
  statusCode: number;
}

interface AddBanOptions {
  reason?: string;
  expires?: string | null;
  bannedBy?: string;
}

interface BanStats {
  total: number;
  permanent: number;
  temporary: number;
  expired: number;
}

type NextFn = () => void | Promise<void>;

let banDir = '';
let banFile = '';
let banCache: BanEntry[] = [];
let config: BanConfig = {
  enabled: true,
  message: 'Your IP address has been banned.',
  statusCode: 403,
};

export function init(cfg: Partial<BanConfig> = {}, baseDir: string): void {
  config = { ...config, ...cfg };
  banDir = join(baseDir, 'content', 'ban');
  banFile = join(banDir, 'bans.json');

  if (!existsSync(banDir)) {
    mkdirSync(banDir, { recursive: true });
  }

  loadBans();
}

function loadBans(): void {
  if (!existsSync(banFile)) {
    banCache = [];
    return;
  }
  try {
    const data = JSON.parse(readFileSync(banFile, 'utf8')) as { bans?: BanEntry[] };
    banCache = data.bans || [];
  } catch (e) {
    console.error('[ban] Error loading bans:', (e as Error).message);
    banCache = [];
  }
}

function saveBans(): void {
  try {
    writeFileSync(banFile, `${JSON.stringify({ bans: banCache }, null, 2)}\n`);
  } catch (e) {
    console.error('[ban] Error saving bans:', (e as Error).message);
    throw e;
  }
}

/** Convert IPv4 address to 32-bit integer. */
function ipToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return 0;
  }
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  const c = parts[2] ?? 0;
  const d = parts[3] ?? 0;
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

/** Check if IP matches CIDR range. */
function ipMatchesCidr(ip: string, cidr: string): boolean {
  if (!cidr.includes('/')) {
    return ip === cidr;
  }

  const [network, prefixStr] = cidr.split('/');
  if (network === undefined || prefixStr === undefined) return false;
  const prefix = parseInt(prefixStr, 10);

  if (isNaN(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }

  const ipInt = ipToInt(ip);
  const networkInt = ipToInt(network);

  if (ipInt === 0 || networkInt === 0) {
    return false;
  }

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;

  return (ipInt & mask) === (networkInt & mask);
}

function normalizeIp(ip: string | undefined | null): string {
  if (!ip) return '';

  if (ip.startsWith('::ffff:')) {
    return ip.substring(7);
  }

  return ip;
}

function isExpired(ban: BanEntry): boolean {
  if (!ban.expires) return false;
  return new Date(ban.expires) < new Date();
}

function filterActive(bans: BanEntry[]): BanEntry[] {
  return bans.filter((ban) => !isExpired(ban));
}

export function listBans(): BanEntry[] {
  return filterActive(banCache);
}

export function getBan(ip: string): BanEntry | null {
  const normalized = normalizeIp(ip);
  const activeBans = filterActive(banCache);
  return activeBans.find((ban) => ban.ip === normalized) || null;
}

export function addBan(ip: string, options: AddBanOptions = {}): BanEntry {
  const normalized = normalizeIp(ip);

  banCache = banCache.filter((ban) => ban.ip !== normalized);

  const banEntry: BanEntry = {
    ip: normalized,
    reason: options.reason || 'No reason provided',
    created: new Date().toISOString(),
    expires: options.expires || null,
    bannedBy: options.bannedBy || 'system',
  };

  banCache.push(banEntry);
  saveBans();

  return banEntry;
}

export function removeBan(ip: string): boolean {
  const normalized = normalizeIp(ip);
  const beforeLength = banCache.length;

  banCache = banCache.filter((ban) => ban.ip !== normalized);

  if (banCache.length < beforeLength) {
    saveBans();
    return true;
  }

  return false;
}

export function isBanned(ip: string): BanEntry | null {
  const normalized = normalizeIp(ip);
  if (!normalized) return null;

  const activeBans = filterActive(banCache);

  const exactMatch = activeBans.find((ban) => ban.ip === normalized);
  if (exactMatch) return exactMatch;

  for (const ban of activeBans) {
    if (ban.ip.includes('/') && ipMatchesCidr(normalized, ban.ip)) {
      return ban;
    }
  }

  return null;
}

export function getStats(): BanStats {
  const active = filterActive(banCache);
  return {
    total: active.length,
    permanent: active.filter((ban) => !ban.expires).length,
    temporary: active.filter((ban) => ban.expires).length,
    expired: banCache.length - active.length,
  };
}

export function reloadBans(): void {
  loadBans();
}

function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    const first = forwarded.split(',')[0];
    return first ? normalizeIp(first.trim()) : '';
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return normalizeIp(forwarded[0].split(',')[0]?.trim());
  }

  return normalizeIp(req.socket?.remoteAddress || '');
}

/**
 * Express/Connect middleware for IP ban checking.
 */
export function middleware(): (
  req: IncomingMessage,
  res: ServerResponse,
  context: unknown,
  next: NextFn
) => Promise<void> {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    _context: unknown,
    next: NextFn
  ): Promise<void> => {
    if (!config.enabled) {
      await next();
      return;
    }

    const clientIp = getClientIp(req);
    if (!clientIp) {
      await next();
      return;
    }

    const ban = isBanned(clientIp);
    if (ban) {
      console.warn(`[ban] Blocked request from ${clientIp}: ${ban.reason}`);

      res.writeHead(config.statusCode, { 'Content-Type': 'text/plain' });
      res.end(config.message);
      return;
    }

    await next();
  };
}
