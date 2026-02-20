/**
 * Build script for CMS Core frontend assets
 *
 * Bundles TipTap editor and other JS modules into single files
 * for inclusion in admin templates.
 *
 * Usage:
 *   node build.js          - Build once
 *   node build.js --watch  - Watch mode for development
 */

import { build, context } from 'esbuild';

const isWatch = process.argv.includes('--watch');

const editorConfig = {
  entryPoints: ['public/js/editor/index.js'],
  bundle: true,
  outfile: 'public/js/editor.bundle.js',
  format: 'iife',
  globalName: 'CMSEditor',
  target: ['es2020'],
  minify: !isWatch,
  sourcemap: isWatch,
  logLevel: 'info',
};

const commandPaletteConfig = {
  entryPoints: ['public/js/command-palette.js'],
  bundle: true,
  outfile: 'public/js/command-palette.bundle.js',
  format: 'iife',
  globalName: 'CommandPalette',
  target: ['es2020'],
  minify: !isWatch,
  sourcemap: isWatch,
  logLevel: 'info',
};

async function run() {
  if (isWatch) {
    console.log('[build] Starting watch mode...');

    const editorCtx = await context(editorConfig);
    await editorCtx.watch();
    console.log('[build] Watching editor/index.js for changes...');
  } else {
    console.log('[build] Building editor bundle...');
    await build(editorConfig);
    console.log('[build] Done: public/js/editor.bundle.js');
  }
}

run().catch((err) => {
  console.error('[build] Build failed:', err);
  process.exit(1);
});
