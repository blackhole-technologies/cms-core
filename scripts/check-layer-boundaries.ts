#!/usr/bin/env node
/**
 * Layer-boundary lint.
 *
 * WHY this exists:
 *   Invariant #5 of the top-tier roadmap — "Every external surface has a boundary
 *   contract" — starts at the architecture level. Layer boundaries within src/core
 *   keep the dependency graph intelligible as it grows. Most importantly:
 *
 *     core -> modules is always wrong. Modules REGISTER WITH core at boot time;
 *     core must never reach into modules. If a core file imports from a module,
 *     the dependency is inverted and the layering has collapsed.
 *
 *   The script also enforces ordering among core subsystems (security, storage,
 *   rendering, http, entities). Several of those rules match src/core/<subsystem>/
 *   paths that do not yet exist — they activate automatically as Phase 1 of the
 *   roadmap restructures the codebase into src/core/<subsystem>/.
 *
 * HOW it behaves:
 *   - Scans source files under core/, modules/, src/, plus root entry points.
 *   - For each file, extracts relative import specifiers (static, dynamic,
 *     re-export, and CommonJS require) via regex + String.matchAll. Bare
 *     package specifiers (npm / Node built-ins) are ignored — we only audit
 *     intra-repo edges.
 *   - For each (source, target) edge, checks every deny rule. A match is a
 *     violation; violations listed in .layer-ignore are grandfathered.
 *   - Exits 0 if no enforced violations; 1 otherwise.
 *   - `npm run check:layers -- list-violations` emits ignore-file-ready lines
 *     (used to bootstrap .layer-ignore on first run).
 *
 * WHY regex (not a full AST):
 *   A TypeScript AST via ts.createSourceFile would be more correct on edge cases
 *   (e.g. specifiers that look like imports inside comments or template literals),
 *   but it adds dependency weight and boot cost for a lint that sees ~200 files.
 *   The regex covers the forms that actually produce graph edges. Rare false
 *   positives from commented-out code are handled by .layer-ignore.
 *
 * See: docs/plans/2026-04-24-top-tier-roadmap.md (Phase 0 PR 0.2, Invariant #5).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const REPO_ROOT = process.cwd();
const IGNORE_FILE = '.layer-ignore';

interface DenyRule {
  /** Regex matched against the source file's repo-relative POSIX path. */
  source: RegExp;
  /** Regex matched against the import target's repo-relative POSIX path. */
  target: RegExp;
  /** Human-readable explanation; appears in violation output and ignore-file lines. */
  reason: string;
}

// Rules are evaluated for every intra-repo import edge. First match wins; the
// rules are disjoint by construction (source/target regexes don't overlap).
const DENY_RULES: DenyRule[] = [
  // --- Always-applicable (applies to both current flat core/ and future src/core/) ---
  {
    source: /^(src\/)?core(\/|$)/,
    target: /^(src\/)?modules(\/|$)/,
    reason: 'core must not import from modules (modules register with core at boot)',
  },

  // --- Activates as Phase 1 restructures into src/core/<subsystem>/ ---
  // Today these match nothing because the subfolders do not exist; they start
  // catching violations the moment PR 1.2+ creates them.
  {
    source: /^src\/core\/security(\/|$)/,
    target: /^src\/core\/rendering(\/|$)/,
    reason: 'security is below rendering (rendering may use security, not the reverse)',
  },
  {
    source: /^src\/core\/storage(\/|$)/,
    target: /^src\/core\/http(\/|$)/,
    reason: 'storage is below http (repositories must not know about HTTP)',
  },
  {
    source: /^src\/core\/rendering(\/|$)/,
    target: /^src\/core\/storage(\/|$)/,
    reason: 'rendering must reach storage through entities/operations, not directly',
  },
  {
    source: /^src\/core\/entities(\/|$)/,
    target: /^src\/core\/http(\/|$)/,
    reason: 'entities are below http (handlers use entities, not the reverse)',
  },
  {
    source: /^src\/core\/observability(\/|$)/,
    target: /^src\/core\/(http|rendering|entities|storage|security)(\/|$)/,
    reason: 'observability is the lowest layer; it instruments others, it does not depend on them',
  },
];

const SOURCE_EXT = /\.(ts|tsx|js|mjs|cjs)$/;

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

const SKIP_FILE_PATTERNS: RegExp[] = [/\.d\.ts$/, /\.test\.(ts|tsx|js)$/, /\.spec\.(ts|tsx|js)$/];

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

// Static import / export-from. Anchored to line-start via `(?:^|\n)` so it does
// not match `import(...)` inside expressions — those are dynamic, handled below.
const STATIC_IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
// Dynamic import() / CommonJS require(). `\b` prefix prevents matches on
// identifiers that happen to end in "import" or "require".
const DYNAMIC_IMPORT_RE = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]/g;

// Extract approximate import edges from a source file. Returns { path, line }
// for each edge; line is 1-indexed.
function extractImports(content: string): Array<{ path: string; line: number }> {
  const results: Array<{ path: string; line: number }> = [];

  // Offset -> line-number map (1-indexed). Binary search on the array of
  // newline offsets to locate a match's line cheaply.
  const lineStarts: number[] = [0];
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) lineStarts.push(i + 1);
  }
  function lineAt(offset: number): number {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if ((lineStarts[mid] ?? 0) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  for (const m of content.matchAll(STATIC_IMPORT_RE)) {
    if (m[1] && m.index !== undefined) {
      results.push({ path: m[1], line: lineAt(m.index) });
    }
  }
  for (const m of content.matchAll(DYNAMIC_IMPORT_RE)) {
    if (m[1] && m.index !== undefined) {
      results.push({ path: m[1], line: lineAt(m.index) });
    }
  }

  return results;
}

// Resolve a specifier to a repo-relative POSIX path, or null if it's a bare
// module specifier we shouldn't audit (npm package, Node built-in, alias).
// Intentionally NOT running the full Node resolver — we only need enough to
// determine which layer the target lives in, which is a prefix match.
function resolveToRepoRel(specifier: string, fromFileAbs: string): string | null {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) return null;
  const abs = specifier.startsWith('/') ? specifier : resolve(dirname(fromFileAbs), specifier);
  return toPosix(relative(REPO_ROOT, abs));
}

// Normalize for ignore-key stability. A single logical import can appear written
// as '../foo', '../foo.ts', '../foo.js', or '../foo/index' depending on tooling —
// collapse all to '../foo' for the ignore key.
function normalizeForKey(path: string): string {
  return path.replace(/\.(ts|tsx|js|mjs|cjs)$/, '').replace(/\/index$/, '');
}

interface Violation {
  source: string;
  target: string;
  line: number;
  rule: string;
  key: string; // `${sourceNormalized} -> ${targetNormalized}`
}

function loadIgnore(): Set<string> {
  const ignored = new Set<string>();
  if (!existsSync(IGNORE_FILE)) return ignored;
  const text = readFileSync(IGNORE_FILE, 'utf8');
  for (const rawLine of text.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const hashIdx = trimmed.indexOf('#');
    const key = (hashIdx === -1 ? trimmed : trimmed.slice(0, hashIdx)).trim();
    if (key) ignored.add(key);
  }
  return ignored;
}

function collectViolations() {
  const roots = ['core', 'modules', 'src'];
  const files: string[] = [];
  for (const r of roots) {
    const full = join(REPO_ROOT, r);
    if (existsSync(full) && statSync(full).isDirectory()) {
      files.push(...walk(full));
    }
  }
  for (const name of ['index.ts', 'index.js', 'server.ts', 'server.js', 'build.ts', 'build.js']) {
    const full = join(REPO_ROOT, name);
    if (existsSync(full) && statSync(full).isFile()) {
      files.push(full);
    }
  }

  const ignored = loadIgnore();
  const violations: Violation[] = [];
  let importsAnalyzed = 0;

  for (const abs of files) {
    const sourceRel = toPosix(relative(REPO_ROOT, abs));
    const sourceKey = normalizeForKey(sourceRel);

    let content: string;
    try {
      content = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }

    for (const { path: spec, line } of extractImports(content)) {
      const targetRel = resolveToRepoRel(spec, abs);
      if (!targetRel) continue;
      importsAnalyzed++;
      const targetKey = normalizeForKey(targetRel);
      for (const rule of DENY_RULES) {
        if (rule.source.test(sourceRel) && rule.target.test(targetRel)) {
          violations.push({
            source: sourceRel,
            target: targetRel,
            line,
            rule: rule.reason,
            key: `${sourceKey} -> ${targetKey}`,
          });
          break; // first match wins — rules are disjoint
        }
      }
    }
  }

  return { scanned: files.length, importsAnalyzed, violations, ignored };
}

const mode = process.argv[2];
const { scanned, importsAnalyzed, violations, ignored } = collectViolations();

if (mode === 'list-violations') {
  // Emit deduplicated keys so .layer-ignore can be bootstrapped directly from output.
  const seen = new Set<string>();
  for (const v of violations) {
    if (seen.has(v.key)) continue;
    seen.add(v.key);
    console.log(`${v.key}  # ${v.rule}`);
  }
  process.exit(0);
}

const enforced = violations.filter((v) => !ignored.has(v.key));
const grandfathered = violations.filter((v) => ignored.has(v.key));

console.log(
  `layer-boundaries: scanned ${scanned} source file(s), ${importsAnalyzed} relative import(s) analyzed`
);
if (grandfathered.length > 0) {
  // A grandfathered edge might appear in multiple files if the same source
  // imports the same target at multiple locations — count unique keys.
  const grandfatheredKeys = new Set(grandfathered.map((v) => v.key));
  console.log(`  ${grandfatheredKeys.size} grandfathered edge(s) via ${IGNORE_FILE}`);
}

if (enforced.length === 0) {
  console.log('  OK — no layer-boundary violations');
  process.exit(0);
}

console.log('');
console.log(`✗ ${enforced.length} layer-boundary violation(s):`);
for (const v of enforced.sort((a, b) => a.source.localeCompare(b.source) || a.line - b.line)) {
  console.log(`  ${v.source}:${v.line}`);
  console.log(`    -> ${v.target}`);
  console.log(`    ${v.rule}`);
}
console.log('');
console.log(
  `To resolve: refactor to remove the cross-layer import, or if the violation is\n` +
    `unavoidable and the source is scheduled for a later refactor phase, add\n` +
    `"<source> -> <target>  # <reason + phase>" to ${IGNORE_FILE}.`
);
process.exit(1);
