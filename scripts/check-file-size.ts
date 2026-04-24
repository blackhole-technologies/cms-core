#!/usr/bin/env node
/**
 * File-size ceiling check.
 *
 * WHY this exists:
 *   Invariant #3 of the top-tier roadmap (docs/plans/2026-04-24-top-tier-roadmap.md) states:
 *   "No file over 500 lines in src/core, no file over 800 lines in src/modules, except
 *   generated code. Hard ceiling enforced by CI lint."
 *
 *   The purpose is not to punish length but to keep module boundaries visible. A 2,000-line
 *   file almost always hides several concerns that should be separate modules. Enforcing
 *   the ceiling forces the split at authoring time, not after the fact.
 *
 * HOW the check behaves:
 *   - Scans source files under: core/, modules/, src/ (post-Phase-1 paths), plus root-level
 *     index.*, server.*, build.* entry points.
 *   - A file exceeding its tier's ceiling produces a violation.
 *   - Violations listed in .size-ignore are grandfathered (existing oversized files whose
 *     refactor is scheduled for a specific roadmap phase).
 *   - Exits 0 if no enforced violations; 1 otherwise.
 *   - `npm run check:size -- list-violations` emits raw violations (used to bootstrap the
 *     ignore file on first run).
 *
 * WHY .size-ignore uses exact paths (not globs):
 *   Globs would let new oversized files slip in under an ancestor pattern. Per-file entries
 *   force a deliberate decision for every grandfathered file and make the remaining debt
 *   visible as a line count.
 *
 * See also: Invariant #3 and Phase 0 PR 0.1 in docs/plans/2026-04-24-top-tier-roadmap.md
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const REPO_ROOT = process.cwd();
const IGNORE_FILE = '.size-ignore';

// Ceilings per tier. First matching pattern wins. Paths are always POSIX-style
// (forward slashes) — we normalize below.
interface Tier {
  match: (posixPath: string) => boolean;
  max: number;
  label: string;
}

const TIERS: Tier[] = [
  // Core framework: tighter ceiling because these modules are shared across every
  // feature — bloat here costs everyone.
  { match: (p) => /^(src\/)?core(\/|$)/.test(p), max: 500, label: 'core' },
  // Modules: looser because a feature module can legitimately span more surface area
  // (its routes, handlers, schemas, migrations) before it should be split.
  { match: (p) => /^(src\/)?modules(\/|$)/.test(p), max: 800, label: 'modules' },
  // Root entry points: same ceiling as core — they're orchestration code.
  { match: (p) => /^(index|server|build)\.(ts|js|mjs|cjs)$/.test(p), max: 500, label: 'root' },
];

// Which extensions count as "source." We deliberately include .js/.mjs/.cjs so
// the lint applies equally during the in-flight TS port; a large .js file is still
// large after renaming to .ts.
const SOURCE_EXT = /\.(ts|tsx|js|mjs|cjs)$/;

// Directories we never descend into. Content, media, public assets, vendored code,
// and generated artifacts are all outside the "source we own" scope.
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'content',
  'media',
  'public',
  'themes',
  'logs',
  'backups',
  '.archive',
  '.autoforge',
  '.claude',
  '.playwright-mcp',
  'tests',
  'docs',
]);

// File-level skips within allowed directories.
const SKIP_FILE_PATTERNS: RegExp[] = [
  /\.d\.ts$/, // Declaration files are compiler output, not hand-authored length.
  /\.test\.(ts|tsx|js)$/,
  /\.spec\.(ts|tsx|js)$/,
];

function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/');
}

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.isFile() && SOURCE_EXT.test(entry.name)) {
      if (SKIP_FILE_PATTERNS.some((re) => re.test(entry.name))) continue;
      out.push(full);
    }
  }
  return out;
}

// Counts lines by scanning for newline characters. We treat a trailing non-newline
// line as a line (so a 1-char file with no newline counts as 1, matching `wc -l`
// POSIX semantics only loosely — `wc -l` would return 0 in that case, but every
// editor and every reviewer thinks of it as 1 line).
function countLines(path: string): number {
  const buf = readFileSync(path);
  if (buf.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 10 /* \n */) n++;
  }
  if (buf[buf.length - 1] !== 10) n++;
  return n;
}

function tierFor(posixPath: string): Tier | null {
  for (const tier of TIERS) {
    if (tier.match(posixPath)) return tier;
  }
  return null;
}

function loadIgnore(): Set<string> {
  const ignored = new Set<string>();
  if (!existsSync(IGNORE_FILE)) return ignored;
  const text = readFileSync(IGNORE_FILE, 'utf8');
  for (const rawLine of text.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    // Strip inline comment: "core/content.ts  # refactor in Phase 2"
    const hashIndex = trimmed.indexOf('#');
    const path = (hashIndex === -1 ? trimmed : trimmed.slice(0, hashIndex)).trim();
    if (path) ignored.add(path);
  }
  return ignored;
}

interface Violation {
  path: string;
  lines: number;
  max: number;
  tier: string;
  ignored: boolean;
}

function collectViolations(): { scanned: number; violations: Violation[] } {
  const roots = ['core', 'modules', 'src'];
  const files: string[] = [];

  for (const root of roots) {
    const full = join(REPO_ROOT, root);
    if (existsSync(full) && statSync(full).isDirectory()) {
      files.push(...walk(full));
    }
  }
  // Root-level entry points.
  for (const name of ['index.ts', 'index.js', 'server.ts', 'server.js', 'build.ts', 'build.js']) {
    const full = join(REPO_ROOT, name);
    if (existsSync(full) && statSync(full).isFile()) {
      files.push(full);
    }
  }

  const ignored = loadIgnore();
  const violations: Violation[] = [];

  for (const abs of files) {
    const rel = toPosix(relative(REPO_ROOT, abs));
    const tier = tierFor(rel);
    if (!tier) continue;
    const lines = countLines(abs);
    if (lines > tier.max) {
      violations.push({
        path: rel,
        lines,
        max: tier.max,
        tier: tier.label,
        ignored: ignored.has(rel),
      });
    }
  }

  return { scanned: files.length, violations };
}

// Entry point: dispatch on first argv.
const mode = process.argv[2];
const { scanned, violations } = collectViolations();

if (mode === 'list-violations') {
  // Emit raw violation lines; used to bootstrap .size-ignore on first run, or to
  // see current state without considering ignores. Sort by lines descending so the
  // worst offenders are visible first.
  for (const v of violations.sort((a, b) => b.lines - a.lines)) {
    console.log(`${v.path}  # ${v.lines} lines, ${v.tier} ceiling ${v.max}`);
  }
  process.exit(0);
}

const enforced = violations.filter((v) => !v.ignored);
const grandfathered = violations.filter((v) => v.ignored);

console.log(`file-size: scanned ${scanned} source file(s)`);
if (grandfathered.length > 0) {
  console.log(`  ${grandfathered.length} grandfathered via ${IGNORE_FILE}`);
}

if (enforced.length === 0) {
  console.log('  OK — no new ceiling violations');
  process.exit(0);
}

console.log('');
console.log(`✗ ${enforced.length} file(s) exceed size ceiling:`);
for (const v of enforced.sort((a, b) => b.lines - a.lines)) {
  console.log(`  ${v.path}  ${v.lines} lines (${v.tier} ceiling: ${v.max})`);
}
console.log('');
console.log(
  `To resolve: split the file(s) below ceiling, or if the size is unavoidable\n` +
    `and the file is scheduled for a later refactor phase, add it to ${IGNORE_FILE}\n` +
    `with a comment citing the roadmap phase that refactors it.`
);
process.exit(1);
