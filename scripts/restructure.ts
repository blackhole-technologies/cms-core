#!/usr/bin/env node
/**
 * scripts/restructure.ts — directory-restructure codemod (Phase 1 PR 1.1).
 *
 * Takes a mapping.json describing path-to-path file moves, performs each move
 * via ts-morph's SourceFile.move() (which rewrites all reference imports
 * across the project), saves to disk, and reports a diff summary.
 *
 * Usage:
 *   node --experimental-strip-types scripts/restructure.ts \
 *     --mapping path/to/mapping.json [--dry-run] [--root <dir>]
 *
 * mapping.json shape:
 *   [
 *     { "from": "core/foo.ts", "to": "src/core/foo.ts" },
 *     ...
 *   ]
 *
 * Implementation notes:
 * - Loads the entire codebase into a ts-morph Project so cross-file import
 *   references can be detected and rewritten in a single pass.
 * - SourceFile.move(toAbs) does the in-memory move + import rewrite;
 *   project.saveSync() flushes to disk. Git's rename detection picks up
 *   the move automatically — no explicit `git mv` is needed.
 * - Errors per mapping accumulate in the report rather than throw, so the
 *   caller can examine the full picture. CLI exits non-zero when errors > 0.
 */

import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { Project } from 'ts-morph';

export interface Mapping {
  /** Source path, relative to projectRoot. */
  from: string;
  /** Destination path, relative to projectRoot. */
  to: string;
}

export interface RestructureReport {
  /** Mappings that succeeded. */
  filesMoved: Mapping[];
  /**
   * Source-file paths (relative to projectRoot) whose import specifiers were
   * rewritten as a side effect of the moves.
   */
  filesWithImportUpdates: string[];
  /** Mappings that failed, with reasons. */
  errors: { mapping: Mapping; reason: string }[];
}

export interface RestructureOptions {
  mappings: Mapping[];
  /** Absolute path to the project root. */
  projectRoot: string;
  /** When true, do not write changes to disk. Default false. */
  dryRun?: boolean;
}

/**
 * Runs the restructure codemod and returns a report of what changed.
 *
 * Side effect: when `dryRun: false` (default), writes all in-memory file
 * moves and import-rewrites back to disk via ts-morph's `saveSync`.
 */
export function restructure(options: RestructureOptions): RestructureReport {
  const { mappings, projectRoot, dryRun = false } = options;

  const report: RestructureReport = {
    filesMoved: [],
    filesWithImportUpdates: [],
    errors: [],
  };

  // We don't require a tsconfig.json for the codemod to work — relative-import
  // rewriting needs only the source-file graph. If a tsconfig exists at the
  // root, we use it (slightly faster initial parse), otherwise we set up a
  // bare Project.
  const tsConfigPath = resolve(projectRoot, 'tsconfig.json');
  const project = existsSync(tsConfigPath)
    ? new Project({
        tsConfigFilePath: tsConfigPath,
        skipAddingFilesFromTsConfig: true,
      })
    : new Project();

  // Walk the project and add every TS/JS source file. Excludes are aligned
  // with what's gitignored or otherwise non-source.
  project.addSourceFilesAtPaths([
    `${projectRoot}/**/*.{ts,tsx,js,mjs,cjs}`,
    `!${projectRoot}/node_modules/**`,
    `!${projectRoot}/.git/**`,
    `!${projectRoot}/.archive/**`,
    `!${projectRoot}/content/**`,
    `!${projectRoot}/dist/**`,
    `!${projectRoot}/build/**`,
  ]);

  // Snapshot import specifiers BEFORE any moves, keyed by absolute path.
  // The diff against the after-snapshot identifies which non-moved files
  // had their imports rewritten as a side effect.
  const beforeSnapshot = snapshotImports(project);

  // Apply each mapping in order. Each move triggers ts-morph to rewrite
  // imports across the project for the moved file.
  for (const mapping of mappings) {
    const fromAbs = resolve(projectRoot, mapping.from);
    const toAbs = resolve(projectRoot, mapping.to);

    const sf = project.getSourceFile(fromAbs);
    if (!sf) {
      report.errors.push({
        mapping,
        reason: `source file not found in project: ${mapping.from}`,
      });
      continue;
    }
    if (existsSync(toAbs)) {
      report.errors.push({
        mapping,
        reason: `destination already exists: ${mapping.to}`,
      });
      continue;
    }

    sf.move(toAbs);
    report.filesMoved.push(mapping);
  }

  // Snapshot AFTER moves; diff to find files whose imports changed.
  const afterSnapshot = snapshotImports(project);
  const movedToPaths = new Set(report.filesMoved.map((m) => resolve(projectRoot, m.to)));
  for (const [path, afterImports] of afterSnapshot) {
    if (movedToPaths.has(path)) continue; // skip the moved files themselves
    const beforeImports = beforeSnapshot.get(path);
    if (!beforeImports) continue;
    if (!stringArraysEqual(beforeImports, afterImports)) {
      report.filesWithImportUpdates.push(relative(projectRoot, path));
    }
  }

  if (!dryRun) {
    project.saveSync();
  }

  return report;
}

function snapshotImports(project: Project): Map<string, string[]> {
  const snap = new Map<string, string[]>();
  for (const sf of project.getSourceFiles()) {
    const specs = sf.getImportDeclarations().map((i) => i.getModuleSpecifierValue());
    snap.set(sf.getFilePath(), specs);
  }
  return snap;
}

function stringArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ────────────────────────────────────────────────────────────────────
// CLI entry point
// ────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      mapping: { type: 'string', short: 'm' },
      'dry-run': { type: 'boolean' },
      root: { type: 'string', default: process.cwd() },
    },
    allowPositionals: false,
  });

  if (!values.mapping) {
    console.error('Usage: restructure --mapping <path/to/mapping.json> [--dry-run] [--root <dir>]');
    return 2;
  }

  const projectRoot = resolve(values.root ?? process.cwd());
  const mappingPath = resolve(projectRoot, values.mapping);
  const mappings: Mapping[] = JSON.parse(readFileSync(mappingPath, 'utf-8'));

  console.log(`restructure: ${mappings.length} mapping(s) from ${values.mapping}`);
  if (values['dry-run']) console.log('  (dry-run mode — no files written)');

  const report = restructure({
    mappings,
    projectRoot,
    dryRun: values['dry-run'] === true,
  });

  console.log(`\n  files moved: ${report.filesMoved.length}`);
  for (const m of report.filesMoved) {
    console.log(`    ${m.from} → ${m.to}`);
  }
  console.log(`  files with import updates: ${report.filesWithImportUpdates.length}`);
  if (report.filesWithImportUpdates.length > 0 && report.filesWithImportUpdates.length <= 20) {
    for (const f of report.filesWithImportUpdates) {
      console.log(`    ${f}`);
    }
  }

  if (report.errors.length > 0) {
    console.error(`\n  errors: ${report.errors.length}`);
    for (const e of report.errors) {
      console.error(`    ${e.mapping.from} → ${e.mapping.to}: ${e.reason}`);
    }
    return 1;
  }

  return 0;
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
