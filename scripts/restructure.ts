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
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { Project, SyntaxKind } from 'ts-morph';

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
  // `allowJs` makes ts-morph load `.js` files into the project graph so their
  // imports can be tracked alongside `.ts` files. cms-core has many `.js`
  // files importing `.ts` files (the in-flight TS port is mid-rename), so
  // every restructure must walk both layers.
  const tsConfigPath = resolve(projectRoot, 'tsconfig.json');
  const project = existsSync(tsConfigPath)
    ? new Project({
        tsConfigFilePath: tsConfigPath,
        skipAddingFilesFromTsConfig: true,
        compilerOptions: { allowJs: true },
      })
    : new Project({ compilerOptions: { allowJs: true } });

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

  // After moves, ts-morph's default specifier-rewriter strips file extensions
  // (it emits TS-conventional `'./csrf'` rather than `'./csrf.ts'`). cms-core
  // runs under Node ESM with `--experimental-strip-types`, which requires
  // explicit extensions, so we re-add them here. Idempotent: imports that
  // already have an extension are left alone.
  preserveImportExtensions(project);

  // Snapshot AFTER moves + extension fix; diff to find files whose imports
  // changed.
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

/**
 * Walks every source file's imports and re-attaches a file extension to any
 * relative module specifier that doesn't have one, when a real `.ts`/`.tsx`/
 * `.js`/`.mjs`/`.cjs` file exists at the resolved location. Required because
 * ts-morph's `SourceFile.move()` strips extensions from rewritten imports
 * (TS-conventional output), which breaks Node ESM's runtime resolver.
 *
 * Covers three reference sites that all share the same gap:
 *   1. Static `import ... from '...'` declarations.
 *   2. Dynamic `import('...')` call expressions.
 *   3. JSDoc `@type {import('...')}` type references in `.js` files.
 *
 * Idempotent — running on already-extensionful imports is a no-op.
 */
function preserveImportExtensions(project: Project): void {
  const candidateExts = ['.ts', '.tsx', '.js', '.mjs', '.cjs'] as const;
  const extRegex = /\.(ts|tsx|js|mjs|cjs|jsx|json)$/;

  /**
   * Looks up `spec` in the in-memory project graph by trying each candidate
   * extension in order. Returns `spec + matchedExtension` if found, or null
   * if the specifier should be left alone (bare specifier, already has an
   * extension, or no project file matches at the resolved location).
   */
  function findExtensionFor(spec: string, sfDir: string): string | null {
    if (!spec.startsWith('./') && !spec.startsWith('../')) return null;
    if (extRegex.test(spec)) return null;
    // Check the in-memory project graph rather than the file system —
    // moves performed via SourceFile.move() are not flushed to disk until
    // project.saveSync(), and this function runs before that flush.
    for (const ext of candidateExts) {
      const candidate = resolve(sfDir, spec + ext);
      if (project.getSourceFile(candidate)) {
        return spec + ext;
      }
    }
    return null;
  }

  for (const sf of project.getSourceFiles()) {
    const sfDir = dirname(sf.getFilePath());

    // (1) Static `import ... from '...'` and `export ... from '...'`.
    for (const imp of sf.getImportDeclarations()) {
      const fixed = findExtensionFor(imp.getModuleSpecifierValue(), sfDir);
      if (fixed) imp.setModuleSpecifier(fixed);
    }

    // (2) Dynamic `import('...')` calls. ts-morph rewrites the path during
    // SourceFile.move() but doesn't preserve the extension; re-add it here
    // so Node ESM's runtime resolver can still find the target.
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue;
      const args = call.getArguments();
      if (args.length === 0) continue;
      const first = args[0];
      if (!first || first.getKind() !== SyntaxKind.StringLiteral) continue;
      const lit = first.asKindOrThrow(SyntaxKind.StringLiteral);
      const fixed = findExtensionFor(lit.getLiteralValue(), sfDir);
      if (fixed) lit.setLiteralValue(fixed);
    }

    // (3) ImportTypeNode references — both inline TypeScript types like
    // `let x: import('./foo.ts').Bar` AND JSDoc `@type {import('...')}` types
    // in `.js` files. They share the same TypeScript AST node (ImportType)
    // and the same extension-preservation gap.
    //
    // Note: ts-morph's default forEachDescendant / getDescendantsOfKind on a
    // SourceFile does NOT walk INTO JSDoc subtrees — JSDoc nodes hang off
    // parents via `getJsDocs()` rather than via regular child links. We
    // collect ImportTypeNodes from BOTH the regular AST and from each JSDoc
    // subtree explicitly. (Inline-TS ImportTypes pre-existed; JSDoc support
    // landed in PR 1.3 after the cms-core entities/storage move surfaced
    // pg-client.js JSDoc imports losing their extension.)
    const allImportTypes = [
      ...sf.getDescendantsOfKind(SyntaxKind.ImportType),
      ...sf
        .getDescendantsOfKind(SyntaxKind.JSDoc)
        .flatMap((jsDoc) => jsDoc.getDescendantsOfKind(SyntaxKind.ImportType)),
    ];
    for (const importType of allImportTypes) {
      const arg = importType.getArgument();
      if (arg.getKind() !== SyntaxKind.LiteralType) continue;
      const literalType = arg.asKindOrThrow(SyntaxKind.LiteralType);
      const inner = literalType.getLiteral();
      if (inner.getKind() !== SyntaxKind.StringLiteral) continue;
      const stringLit = inner.asKindOrThrow(SyntaxKind.StringLiteral);
      const fixed = findExtensionFor(stringLit.getLiteralValue(), sfDir);
      if (fixed) stringLit.setLiteralValue(fixed);
    }
  }
}

function snapshotImports(project: Project): Map<string, string[]> {
  const snap = new Map<string, string[]>();
  for (const sf of project.getSourceFiles()) {
    const specs: string[] = [];

    // Static `import ... from '...'` / `export ... from '...'`.
    for (const imp of sf.getImportDeclarations()) {
      specs.push(`static:${imp.getModuleSpecifierValue()}`);
    }

    // Dynamic `import('...')` calls.
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue;
      const args = call.getArguments();
      const first = args[0];
      if (!first || first.getKind() !== SyntaxKind.StringLiteral) continue;
      const lit = first.asKindOrThrow(SyntaxKind.StringLiteral);
      specs.push(`dynamic:${lit.getLiteralValue()}`);
    }

    // ImportTypeNode — both inline TS and JSDoc-wrapped (the latter is not
    // reached by the source file's default descendant walk; collect via the
    // JSDoc subtree explicitly).
    const allImportTypes = [
      ...sf.getDescendantsOfKind(SyntaxKind.ImportType),
      ...sf
        .getDescendantsOfKind(SyntaxKind.JSDoc)
        .flatMap((jsDoc) => jsDoc.getDescendantsOfKind(SyntaxKind.ImportType)),
    ];
    for (const importType of allImportTypes) {
      const arg = importType.getArgument();
      if (arg.getKind() !== SyntaxKind.LiteralType) continue;
      const literalType = arg.asKindOrThrow(SyntaxKind.LiteralType);
      const inner = literalType.getLiteral();
      if (inner.getKind() !== SyntaxKind.StringLiteral) continue;
      const stringLit = inner.asKindOrThrow(SyntaxKind.StringLiteral);
      specs.push(`importType:${stringLit.getLiteralValue()}`);
    }

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
