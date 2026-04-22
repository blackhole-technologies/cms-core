#!/usr/bin/env node
/**
 * Round-trip test for the CAPTCHA proof-of-work verifier.
 *
 * This is the test that would have caught the client/server hash mismatch
 * fixed for v0.2.0 (Task 16). We use a very small bit-count so the test
 * finds a valid nonce in milliseconds and stays deterministic regardless of
 * environment.
 *
 * Strategy: mimic the client's hashing (plain SHA-256 of challenge+nonce,
 * UTF-8 encoded) and assert the server-side verifyPow() accepts the nonce.
 */

import { createHash } from 'node:crypto';
import { verifyPow, difficultyBits } from '../../core/captcha.ts';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${error.message}`);
    failed++;
  }
}

/**
 * Client-equivalent: find the first nonce where SHA-256(challenge+nonce) has
 * `bits` leading zero bits. Matches the server's verifyPow() logic exactly.
 */
function findNonce(challenge, bits, maxTries = 1_000_000) {
  const fullBytes = Math.floor(bits / 8);
  const remainBits = bits % 8;
  for (let n = 0; n < maxTries; n++) {
    const nonce = n.toString(36);
    const hash = createHash('sha256').update(challenge + nonce, 'utf8').digest();
    let ok = true;
    for (let i = 0; i < fullBytes; i++) {
      if (hash[i] !== 0) { ok = false; break; }
    }
    if (ok && remainBits > 0 && fullBytes < hash.length) {
      if ((hash[fullBytes] >> (8 - remainBits)) !== 0) ok = false;
    }
    if (ok) return nonce;
  }
  throw new Error(`No nonce found within ${maxTries} tries for bits=${bits}`);
}

test('verifyPow accepts a client-computed nonce (8 bits)', () => {
  const challenge = 'deadbeefcafebabe';
  const bits = 8;
  const nonce = findNonce(challenge, bits);
  if (!verifyPow(challenge, nonce, bits)) {
    throw new Error('verifyPow rejected a nonce the client logic accepted');
  }
});

test('verifyPow accepts a client-computed nonce (12 bits, simple difficulty default)', () => {
  const challenge = '0123456789abcdef0123456789abcdef';
  const bits = 12;
  const nonce = findNonce(challenge, bits);
  if (!verifyPow(challenge, nonce, bits)) {
    throw new Error('verifyPow rejected a nonce the client logic accepted');
  }
});

test('verifyPow rejects a nonce that does not meet the difficulty', () => {
  // Nonce "0" almost certainly does not produce 16 leading zero bits.
  const challenge = 'f00dfeedf00dfeed';
  const ok = verifyPow(challenge, '0', 16);
  if (ok) {
    throw new Error('verifyPow accepted a nonce that should not meet 16-bit difficulty');
  }
});

test('difficultyBits maps level strings correctly', () => {
  if (difficultyBits('simple') !== 12) throw new Error('simple should be 12 bits');
  if (difficultyBits('medium') !== 16) throw new Error('medium should be 16 bits');
  if (difficultyBits('hard') !== 20) throw new Error('hard should be 20 bits');
  if (difficultyBits(undefined) !== 12) throw new Error('default should be 12 bits');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
