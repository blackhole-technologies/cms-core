#!/usr/bin/env node

/**
 * Tests for scripts/restructure.ts (Phase 1 PR 1.1).
 *
 * Each test copies the fixture project to a fresh temp directory, runs the
 * codemod against the copy, and asserts on the resulting filesystem state.
 * Cleanup happens unconditionally in the `finally` so a failed assertion
 * doesn't leak temp directories.
 */

import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/restructure-fixture', import.meta.url));

function setupTmp() {
  const tmp = mkdtempSync(join(tmpdir(), 'restructure-'));
  cpSync(FIXTURE_DIR, tmp, { recursive: true });
  return tmp;
}

await test('restructure moves files and rewrites cross-file imports', async () => {
  const tmp = setupTmp();
  try {
    const { restructure } = await import('../../scripts/restructure.ts');
    const report = restructure({
      mappings: [{ from: 'foo.ts', to: 'src/foo.ts' }],
      projectRoot: tmp,
    });

    assert.equal(
      report.errors.length,
      0,
      `unexpected errors: ${JSON.stringify(report.errors, null, 2)}`
    );
    assert.equal(report.filesMoved.length, 1);
    assert.equal(existsSync(join(tmp, 'foo.ts')), false, 'old path should be gone');
    assert.equal(existsSync(join(tmp, 'src/foo.ts')), true, 'new path should exist');

    // bar.ts is in the root and imported foo via './foo.ts'; should now point
    // to './src/foo.ts' — extension MUST be preserved (Node ESM runtime
    // requirement for cms-core; see preserveImportExtensions in the codemod).
    const barContent = readFileSync(join(tmp, 'bar.ts'), 'utf-8');
    assert.match(barContent, /from\s+['"]\.\/src\/foo\.ts['"]/, `bar.ts:\n${barContent}`);

    // baz/baz.ts is in a subdir; should now point to '../src/foo.ts'
    const bazContent = readFileSync(join(tmp, 'baz/baz.ts'), 'utf-8');
    assert.match(bazContent, /from\s+['"]\.\.\/src\/foo\.ts['"]/, `baz/baz.ts:\n${bazContent}`);

    // js-importer.js (a plain .js file) imports './foo.ts' — verifies allowJs
    // loaded the JS layer into the project so its imports got rewritten.
    const jsContent = readFileSync(join(tmp, 'js-importer.js'), 'utf-8');
    assert.match(jsContent, /from\s+['"]\.\/src\/foo\.ts['"]/, `js-importer.js:\n${jsContent}`);

    // All three importers should be reported as updated.
    for (const expected of ['bar.ts', 'baz/baz.ts', 'js-importer.js']) {
      assert.ok(
        report.filesWithImportUpdates.some((p) => p.endsWith(expected)),
        `${expected} not reported as updated: ${JSON.stringify(report.filesWithImportUpdates)}`
      );
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

await test('restructure errors when source file does not exist in the project', async () => {
  const tmp = setupTmp();
  try {
    const { restructure } = await import('../../scripts/restructure.ts');
    const report = restructure({
      mappings: [{ from: 'nonexistent.ts', to: 'src/nonexistent.ts' }],
      projectRoot: tmp,
    });
    assert.equal(report.errors.length, 1);
    assert.match(report.errors[0].reason, /source file not found/);
    assert.equal(report.filesMoved.length, 0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

await test('restructure errors when destination already exists', async () => {
  const tmp = setupTmp();
  try {
    writeFileSync(join(tmp, 'collide.ts'), 'export const collide = 1;\n');
    const { restructure } = await import('../../scripts/restructure.ts');
    const report = restructure({
      mappings: [{ from: 'foo.ts', to: 'collide.ts' }],
      projectRoot: tmp,
    });
    assert.equal(report.errors.length, 1);
    assert.match(report.errors[0].reason, /destination already exists/);
    assert.equal(report.filesMoved.length, 0);
    // foo.ts must not have been moved
    assert.equal(existsSync(join(tmp, 'foo.ts')), true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

await test('restructure dry-run does not write changes to disk', async () => {
  const tmp = setupTmp();
  try {
    const { restructure } = await import('../../scripts/restructure.ts');
    const report = restructure({
      mappings: [{ from: 'foo.ts', to: 'src/foo.ts' }],
      projectRoot: tmp,
      dryRun: true,
    });

    assert.equal(report.errors.length, 0);
    assert.equal(report.filesMoved.length, 1, 'report should still claim the move');
    // ...but the on-disk state should be unchanged
    assert.equal(existsSync(join(tmp, 'foo.ts')), true, 'old path must still exist');
    assert.equal(existsSync(join(tmp, 'src/foo.ts')), false, 'new path must not exist');

    // bar.ts on disk should not have been rewritten either — must still
    // contain the original './foo.ts' import (with extension preserved).
    const barContent = readFileSync(join(tmp, 'bar.ts'), 'utf-8');
    assert.match(
      barContent,
      /from\s+['"]\.\/foo\.ts['"]/,
      `bar.ts should still import './foo.ts':\n${barContent}`
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

await test('restructure handles multiple mappings in one call', async () => {
  const tmp = setupTmp();
  try {
    const { restructure } = await import('../../scripts/restructure.ts');
    const report = restructure({
      mappings: [
        { from: 'foo.ts', to: 'src/foo.ts' },
        { from: 'bar.ts', to: 'src/bar.ts' },
      ],
      projectRoot: tmp,
    });

    assert.equal(report.errors.length, 0);
    assert.equal(report.filesMoved.length, 2);
    assert.equal(existsSync(join(tmp, 'src/foo.ts')), true);
    assert.equal(existsSync(join(tmp, 'src/bar.ts')), true);

    // bar.ts moved to src/bar.ts and its import to foo (also moved to
    // src/foo.ts) should be a same-directory './foo.ts' reference now.
    const movedBar = readFileSync(join(tmp, 'src/bar.ts'), 'utf-8');
    assert.match(movedBar, /from\s+['"]\.\/foo\.ts['"]/, `src/bar.ts:\n${movedBar}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
