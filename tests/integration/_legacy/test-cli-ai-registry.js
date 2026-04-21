/**
 * Test CLI command: ai:registry:list
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('\n='.repeat(60));
console.log('Testing CLI Command: ai:registry:list');
console.log('='.repeat(60));

const child = spawn('node', [join(__dirname, 'index.js'), 'ai:registry:list'], {
  cwd: __dirname,
  timeout: 8000,
});

let stdout = '';
let stderr = '';

child.stdout.on('data', (data) => {
  stdout += data.toString();
});

child.stderr.on('data', (data) => {
  stderr += data.toString();
});

child.on('close', (code) => {
  console.log('\nCommand output:');
  console.log(stdout);

  if (stderr) {
    console.log('\nStderr:');
    console.log(stderr);
  }

  console.log('\n' + '='.repeat(60));

  if (code === 0 && stdout.includes('AI Modules Registry')) {
    console.log('✅ CLI command works correctly');
    console.log('='.repeat(60));
    process.exit(0);
  } else {
    console.log(`❌ CLI command failed (exit code: ${code})`);
    console.log('='.repeat(60));
    process.exit(1);
  }
});

child.on('error', (error) => {
  console.error('Error running command:', error);
  process.exit(1);
});

// Timeout fallback
setTimeout(() => {
  child.kill();
  console.log('\n❌ Command timed out');
  process.exit(1);
}, 10000);
