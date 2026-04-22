/**
 * checklist.ts - Site Checklist / Status Checks
 *
 * Drupal's "Status report" page shows administrators whether their site
 * is configured correctly: cron running, security settings, search index
 * up-to-date, etc. This module provides the same for CMS Core.
 *
 * Drupal parity: equivalent to system_status() + hook_requirements().
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type CheckStatus = 'ok' | 'warning' | 'error';

export interface CheckResult {
  status?: CheckStatus;
  description?: string;
  value?: unknown;
}

type CheckFn = () => Promise<CheckResult> | CheckResult;

interface CheckEntry {
  id: string;
  title: string;
  category: string;
  check: CheckFn;
}

interface RegisterConfig {
  title: string;
  category?: string;
  check: CheckFn;
}

export interface RanCheck {
  id: string;
  title: string;
  category: string;
  status: CheckStatus;
  description: string;
  value: unknown;
}

export interface ChecklistSummary {
  timestamp: string;
  total: number;
  ok: number;
  warnings: number;
  errors: number;
  categories: Record<string, RanCheck[]>;
  results: RanCheck[];
}

const checks = new Map<string, CheckEntry>();

let baseDir: string | null = null;
let checklistDir: string | null = null;

export function init(baseDirPath: string): void {
  baseDir = baseDirPath;
  checklistDir = join(baseDir, 'content', '.checklist');

  if (!existsSync(checklistDir)) {
    mkdirSync(checklistDir, { recursive: true });
  }

  registerBuiltinChecks();
  console.log(`[checklist] Initialized (${checks.size} checks registered)`);
}

export function register(id: string, config: RegisterConfig): void {
  checks.set(id, {
    id,
    title: config.title,
    category: config.category || 'general',
    check: config.check,
  });
}

export async function runAll(): Promise<ChecklistSummary> {
  const results: RanCheck[] = [];

  for (const [id, entry] of checks) {
    try {
      const result = await entry.check();
      results.push({
        id,
        title: entry.title,
        category: entry.category,
        status: result.status || 'ok',
        description: result.description || '',
        value: result.value ?? null,
      });
    } catch (err) {
      results.push({
        id,
        title: entry.title,
        category: entry.category,
        status: 'error',
        description: `Check failed: ${(err as Error).message}`,
        value: null,
      });
    }
  }

  const grouped: Record<string, RanCheck[]> = {};
  for (const r of results) {
    const bucket = grouped[r.category];
    if (!bucket) {
      grouped[r.category] = [r];
    } else {
      bucket.push(r);
    }
  }

  const summary: ChecklistSummary = {
    timestamp: new Date().toISOString(),
    total: results.length,
    ok: results.filter((r) => r.status === 'ok').length,
    warnings: results.filter((r) => r.status === 'warning').length,
    errors: results.filter((r) => r.status === 'error').length,
    categories: grouped,
    results,
  };

  if (checklistDir) {
    try {
      writeFileSync(
        join(checklistDir, 'last-run.json'),
        JSON.stringify(summary, null, 2),
        'utf-8'
      );
    } catch {
      // Non-critical — cache write failure doesn't break checks
    }
  }

  return summary;
}

export function getLastRun(): ChecklistSummary | null {
  if (!checklistDir) return null;
  const filePath = join(checklistDir, 'last-run.json');
  if (!existsSync(filePath)) return null;

  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as ChecklistSummary;
  } catch {
    return null;
  }
}

export async function runCheck(id: string): Promise<RanCheck | null> {
  const entry = checks.get(id);
  if (!entry) return null;

  try {
    const result = await entry.check();
    return {
      id,
      title: entry.title,
      category: entry.category,
      status: result.status || 'ok',
      description: result.description || '',
      value: result.value ?? null,
    };
  } catch (err) {
    return {
      id,
      title: entry.title,
      category: entry.category,
      status: 'error',
      description: `Check failed: ${(err as Error).message}`,
      value: null,
    };
  }
}

export function listChecks(): Array<{ id: string; title: string; category: string }> {
  return Array.from(checks.values()).map((c) => ({
    id: c.id,
    title: c.title,
    category: c.category,
  }));
}

// ============================================
// BUILT-IN CHECKS
// ============================================

function registerBuiltinChecks(): void {
  register('node_version', {
    title: 'Node.js version',
    category: 'system',
    check: async () => {
      const version = process.version;
      const major = parseInt(version.slice(1));
      if (major >= 20) {
        return { status: 'ok', description: `Node.js ${version}`, value: version };
      }
      if (major >= 18) {
        return {
          status: 'warning',
          description: `Node.js ${version} — consider upgrading to 20+`,
          value: version,
        };
      }
      return {
        status: 'error',
        description: `Node.js ${version} — version 18+ required`,
        value: version,
      };
    },
  });

  register('memory_usage', {
    title: 'Memory usage',
    category: 'system',
    check: async () => {
      const mem = process.memoryUsage();
      const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
      const rssMB = Math.round(mem.rss / 1024 / 1024);
      if (heapMB > 512) {
        return {
          status: 'warning',
          description: `Heap: ${heapMB}MB, RSS: ${rssMB}MB — high memory usage`,
          value: heapMB,
        };
      }
      return {
        status: 'ok',
        description: `Heap: ${heapMB}MB, RSS: ${rssMB}MB`,
        value: heapMB,
      };
    },
  });

  register('uptime', {
    title: 'Process uptime',
    category: 'system',
    check: async () => {
      const secs = process.uptime();
      const hours = Math.floor(secs / 3600);
      const mins = Math.floor((secs % 3600) / 60);
      return { status: 'ok', description: `${hours}h ${mins}m`, value: secs };
    },
  });

  register('content_directory', {
    title: 'Content directory',
    category: 'storage',
    check: async () => {
      const dir = join(baseDir ?? '.', 'content');
      if (existsSync(dir)) {
        return { status: 'ok', description: 'Content directory exists and is accessible' };
      }
      return { status: 'error', description: 'Content directory is missing' };
    },
  });

  register('config_directory', {
    title: 'Configuration directory',
    category: 'storage',
    check: async () => {
      const dir = join(baseDir ?? '.', 'config');
      if (existsSync(dir)) {
        return { status: 'ok', description: 'Config directory exists' };
      }
      return { status: 'error', description: 'Config directory is missing' };
    },
  });

  register('media_directory', {
    title: 'Media directory',
    category: 'storage',
    check: async () => {
      const dir = join(baseDir ?? '.', 'media');
      if (existsSync(dir)) {
        return { status: 'ok', description: 'Media directory exists' };
      }
      return {
        status: 'warning',
        description: 'Media directory not yet created (will be created on first upload)',
      };
    },
  });

  register('env_mode', {
    title: 'Environment mode',
    category: 'security',
    check: async () => {
      const env = process.env.NODE_ENV || 'development';
      if (env === 'production') {
        return { status: 'ok', description: 'Running in production mode', value: env };
      }
      return {
        status: 'warning',
        description: `Running in ${env} mode — use NODE_ENV=production for live sites`,
        value: env,
      };
    },
  });
}

export const name = 'checklist';
