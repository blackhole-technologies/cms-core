/**
 * Server wrapper with auto-restart support.
 *
 * When the CMS process exits with code 0 (clean exit), it respawns automatically.
 * This enables the admin "Restart server" feature — the child calls process.exit(0)
 * and this wrapper brings it right back up.
 *
 * Exit code !== 0 is treated as a crash and stops the wrapper too.
 *
 * Usage: node server.js   (or npm start)
 * Direct: node index.js   (no auto-restart, for debugging)
 */

import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = join(__dirname, 'index.js');

let restarting = false;

function start() {
  const child = fork(entry, process.argv.slice(2), {
    stdio: 'inherit',
    cwd: __dirname,
  });

  child.on('exit', (code, signal) => {
    if (code === 0 && !signal) {
      // Clean exit — restart
      console.log('\n[server] Restarting...\n');
      restarting = true;
      // Small delay to let ports release
      setTimeout(() => start(), 1000);
    } else if (signal) {
      console.log(`[server] Process killed by signal ${signal}`);
      process.exit(1);
    } else {
      console.log(`[server] Process exited with code ${code}`);
      process.exit(code);
    }
  });

  // Forward SIGINT/SIGTERM to child
  const forward = (sig) => {
    child.kill(sig);
  };
  process.on('SIGINT', forward);
  process.on('SIGTERM', forward);
}

start();
