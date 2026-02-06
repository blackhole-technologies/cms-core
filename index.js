/**
 * index.js - CMS Entry Point
 *
 * WHY THIS FILE EXISTS:
 * This is the single entry point for the CMS.
 * Running `node index.js` starts the entire system.
 *
 * MODES OF OPERATION:
 * 1. Server mode: `node index.js` - boots and stays running
 * 2. CLI mode: `node index.js <command>` - boots, runs command, exits
 *
 * WHY SUPPORT BOTH:
 * - Server mode for running the CMS as a service
 * - CLI mode for admin tasks (enable modules, view config, etc.)
 *
 * WHY fileURLToPath:
 * ES modules don't have __dirname. We need to derive the directory
 * from import.meta.url to pass to the boot sequence.
 */

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { boot } from './core/boot.js';
import * as cli from './core/cli.js';

// WHY DERIVE __dirname:
// import.meta.url gives us "file:///path/to/index.js"
// We need "/path/to" for the boot sequence
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Detect if running in CLI mode
 *
 * WHY SEPARATE CHECK:
 * Makes the logic clear and testable.
 * CLI mode is when a command is provided as argument.
 */
const { command, args } = cli.parse();
const isCliMode = command !== null;

/**
 * Start the CMS
 *
 * WHY IIFE (Immediately Invoked Function Expression):
 * Top-level await requires ES2022 or --experimental flags.
 * IIFE with async works everywhere and makes error handling explicit.
 */
(async () => {
  try {
    // ========================================
    // CLI Mode: Boot, run command, exit
    // ========================================
    if (isCliMode) {
      // WHY QUIET BOOT FOR CLI:
      // CLI users want command output, not boot logs.
      // We boot with { quiet: true } to suppress normal logs.
      const context = await boot(__dirname, { quiet: true });

      // Run the command
      const success = await cli.run(command, args, context);

      // WHY EXIT WITH CODE:
      // Scripts and CI/CD pipelines need to know if command succeeded.
      // Exit code 0 = success, 1 = failure.
      process.exit(success ? 0 : 1);
    }

    // ========================================
    // Server Mode: Boot and stay running
    // ========================================
    console.log('='.repeat(50));
    console.log('CMS Core - Starting...');
    console.log('='.repeat(50));

    const context = await boot(__dirname);

    console.log('\n' + '='.repeat(50));
    console.log('CMS Core - Running');
    console.log('='.repeat(50));

    // WHY KEEP PROCESS ALIVE:
    // In server mode, we want the process to stay running.
    // The watcher keeps the event loop active.
    // Future: HTTP server will also keep it alive.

  } catch (error) {
    // WHY EXIT WITH CODE 1:
    // Non-zero exit code signals failure to process managers
    // (systemd, Docker, PM2) so they can restart or alert.
    console.error('\nFatal error during startup:');
    console.error(error);
    process.exit(1);
  }
})();
