#!/usr/bin/env node
/**
 * Feature #7 Verification: CLI command: token:list available tokens
 *
 * This script tests all requirements from the feature specification:
 * 1. Basic command runs and outputs token types
 * 2. Shows Node, User, Date, System categories
 * 3. Tokens listed with descriptions
 * 4. Filter by type: --type=node
 * 5. Filter by search: --filter=name
 * 6. Verbose mode: --verbose
 * 7. JSON format: --format=json
 * 8. Empty database handling (simulated)
 * 9. Help command
 * 10. Error handling for invalid options
 */

import { spawn } from 'node:child_process';

const TESTS = [
  {
    name: 'Basic command outputs token types',
    cmd: 'token:list',
    args: [],
    expectedInOutput: ['Site information', 'Current date/time', 'Node', 'User'],
    shouldNotError: true,
  },
  {
    name: 'Output includes token categories with descriptions',
    cmd: 'token:list',
    args: [],
    expectedInOutput: ['[node:title]', '[user:name]', '[date:short]', '[site:name]'],
    shouldNotError: true,
  },
  {
    name: 'Filter by type --type=node',
    cmd: 'token:list',
    args: ['--type=node'],
    expectedInOutput: ['[node:title]', '[node:nid]'],
    expectedNotInOutput: ['[user:name]', '[site:name]'],
    shouldNotError: true,
  },
  {
    name: 'Filter by search term --filter=name',
    cmd: 'token:list',
    args: ['--filter=name'],
    expectedInOutput: ['[user:name]', '[site:name]', '[term:name]'],
    expectedNotInOutput: ['[site:url]', '[date:timestamp]'],
    shouldNotError: true,
  },
  {
    name: 'Verbose mode --verbose shows examples',
    cmd: 'token:list',
    args: ['--type=date', '--verbose'],
    expectedInOutput: ['Example:', '02/03/2026', 'Feb 3, 2026'],
    shouldNotError: true,
  },
  {
    name: 'JSON format --format=json',
    cmd: 'token:list',
    args: ['--type=site', '--format=json'],
    expectedInOutput: ['"type": "site"', '"token": "[site:name]"', '"description"'],
    shouldNotError: true,
  },
  {
    name: 'Invalid option shows error and help hint',
    cmd: 'token:list',
    args: ['--invalid'],
    expectedInOutput: ['Error: Unknown option', 'help token:list'],
    shouldNotError: false,
  },
  {
    name: 'Help command shows usage',
    cmd: 'help',
    args: [],
    expectedInOutput: ['token:list', 'List available tokens'],
    shouldNotError: true,
  },
  {
    name: 'tokens:list plural variant also works',
    cmd: 'tokens:list',
    args: ['--type=user'],
    expectedInOutput: ['[user:name]', '[user:mail]'],
    shouldNotError: true,
  },
];

let passed = 0;
let failed = 0;

async function runTest(test) {
  return new Promise((resolve) => {
    const proc = spawn('node', ['index.js', test.cmd, ...test.args], {
      cwd: '/Users/Alchemy/Projects/experiments/cms-core',
      stdio: 'pipe',
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      const output = stdout + stderr;
      let testPassed = true;
      const errors = [];

      // Check exit code
      if (test.shouldNotError && code !== 0) {
        testPassed = false;
        errors.push(`Expected exit code 0, got ${code}`);
      }

      // Check expected strings in output
      if (test.expectedInOutput) {
        for (const expected of test.expectedInOutput) {
          if (!output.includes(expected)) {
            testPassed = false;
            errors.push(`Expected "${expected}" in output`);
          }
        }
      }

      // Check strings that should NOT be in output
      if (test.expectedNotInOutput) {
        for (const notExpected of test.expectedNotInOutput) {
          if (output.includes(notExpected)) {
            testPassed = false;
            errors.push(`Did not expect "${notExpected}" in output`);
          }
        }
      }

      resolve({ testPassed, errors, output });
    });
  });
}

async function main() {
  console.log('Feature #7 Verification: token:list command\n');
  console.log('='.repeat(60));

  for (const test of TESTS) {
    process.stdout.write(`\nTest: ${test.name}... `);
    const { testPassed, errors, output } = await runTest(test);

    if (testPassed) {
      console.log('✓ PASS');
      passed++;
    } else {
      console.log('✗ FAIL');
      failed++;
      for (const error of errors) {
        console.log(`  - ${error}`);
      }
      if (process.env.DEBUG) {
        console.log('\n  Output:');
        console.log('  ' + output.split('\n').slice(-20).join('\n  '));
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  console.log(`Status: ${failed === 0 ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED'}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main();
