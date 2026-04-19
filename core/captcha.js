/**
 * captcha.js - Math-Based CAPTCHA Challenge
 *
 * WHY THIS EXISTS:
 * Bots can fill forms but can't solve math problems (yet).
 * This is a zero-dependency alternative to Google reCAPTCHA or FriendlyCAPTCHA.
 *
 * HOW IT WORKS:
 * 1. Generate a math problem ("What is 7 + 4?")
 * 2. Store the answer in an HMAC-signed token (same pattern as core/csrf.js)
 * 3. Render the question + input field + hidden token in the form
 * 4. On submit, verify the user's answer matches the signed token
 *
 * WHY HMAC TOKENS (not server-side state):
 * Stateless verification — no need to store pending challenges in memory or on disk.
 * The token is self-validating: HMAC(answer + timestamp, secret).
 *
 * Drupal parity: equivalent to `captcha` + `friendlycaptcha` contrib modules.
 */

import { createHmac, randomBytes } from 'node:crypto';

let config = { enabled: true, difficulty: 'simple', type: 'math' };
let secret = '';

/**
 * Initialize the CAPTCHA module.
 * @param {Object} captchaConfig - Config from site.json `captcha` key
 * @param {Object} context - Boot context
 */
export function init(captchaConfig, context) {
  if (captchaConfig) {
    config = { ...config, ...captchaConfig };
  }
  secret = context?.sessionSecret || 'captcha-fallback-secret';
  console.log(`[captcha] Initialized (enabled: ${config.enabled}, difficulty: ${config.difficulty})`);
}

/**
 * Generate a math problem based on difficulty.
 * @returns {{ question: string, answer: number }}
 */
function generateProblem() {
  const difficulty = config.difficulty || 'simple';

  if (difficulty === 'hard') {
    // Multiplication with small numbers
    const a = Math.floor(Math.random() * 12) + 1;
    const b = Math.floor(Math.random() * 12) + 1;
    return { question: `What is ${a} × ${b}?`, answer: a * b };
  }

  if (difficulty === 'medium') {
    // Addition and subtraction with larger numbers
    const ops = ['+', '-'];
    const op = ops[Math.floor(Math.random() * ops.length)];
    const a = Math.floor(Math.random() * 20) + 1;
    const b = Math.floor(Math.random() * Math.min(a, 20)) + 1; // b <= a to avoid negative results
    const answer = op === '+' ? a + b : a - b;
    return { question: `What is ${a} ${op} ${b}?`, answer };
  }

  // Simple: addition with small numbers
  const a = Math.floor(Math.random() * 10) + 1;
  const b = Math.floor(Math.random() * 10) + 1;
  return { question: `What is ${a} + ${b}?`, answer: a + b };
}

/**
 * Sign an answer with a timestamp for stateless verification.
 */
function signAnswer(answer, timestamp) {
  return createHmac('sha256', secret)
    .update(`${answer}:${timestamp}`)
    .digest('hex')
    .substring(0, 24);
}

/**
 * Generate CAPTCHA HTML to inject into a form.
 * Returns raw HTML string — use {{{captchaField}}} in templates.
 *
 * Supports two types:
 *   'math' (default) - User solves a math problem
 *   'pow'  - Invisible proof-of-work computed by the browser (FriendlyCAPTCHA-style)
 */
export function generateField() {
  if (!config.enabled) return '';

  if (config.type === 'pow') {
    return generatePowField();
  }

  const { question, answer } = generateProblem();
  const timestamp = Date.now();
  const sig = signAnswer(answer, timestamp);
  const token = `${timestamp}.${sig}`;

  return `<div class="captcha-group">` +
    `<label for="captcha_answer">${question}</label>` +
    `<input type="number" name="captcha_answer" id="captcha_answer" required autocomplete="off" class="form-input" style="max-width:120px;">` +
    `<input type="hidden" name="captcha_token" value="${token}">` +
    `</div>`;
}

/**
 * Generate a proof-of-work CAPTCHA field.
 * The browser must find a nonce where SHA-256(challenge + nonce) has N leading zero bits.
 * Invisible to users — runs in the background via inline JS.
 */
function generatePowField() {
  const challenge = randomBytes(16).toString('hex');
  const timestamp = Date.now();
  // Difficulty: number of leading zero bits required
  const difficultyBits = config.difficulty === 'hard' ? 20 : config.difficulty === 'medium' ? 16 : 12;
  const sig = createHmac('sha256', secret)
    .update(`pow:${challenge}:${difficultyBits}:${timestamp}`)
    .digest('hex')
    .substring(0, 24);
  const powToken = `pow:${timestamp}:${challenge}:${difficultyBits}:${sig}`;

  // Inline JS that computes the proof-of-work using SubtleCrypto (async, non-blocking)
  return `<div class="captcha-group captcha-pow" data-difficulty="${difficultyBits}">` +
    `<input type="hidden" name="captcha_token" value="${powToken}">` +
    `<input type="hidden" name="captcha_nonce" id="captcha_nonce" value="">` +
    `<span class="captcha-pow-status">Verifying you are human...</span>` +
    `<script>` +
    `(async function(){` +
    `const challenge="${challenge}";` +
    `const bits=${difficultyBits};` +
    `const mask=(1<<(bits%8))-1;` +
    `const fullBytes=Math.floor(bits/8);` +
    `const enc=new TextEncoder();` +
    `for(let n=0;n<1e8;n++){` +
    `const data=enc.encode(challenge+n.toString(36));` +
    `const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",data));` +
    `let ok=true;` +
    `for(let i=0;i<fullBytes;i++){if(hash[i]!==0){ok=false;break;}}` +
    `if(ok&&(fullBytes<hash.length)&&(hash[fullBytes]>>(8-bits%8))===0){` +
    `document.getElementById("captcha_nonce").value=n.toString(36);` +
    `document.querySelector(".captcha-pow-status").textContent="Verified!";` +
    `break;}}` +
    `})();` +
    `</script>` +
    `</div>`;
}

/**
 * Validate a CAPTCHA submission.
 * Handles both math and proof-of-work tokens.
 * @param {Object} formData - Parsed form data with captcha_answer/captcha_nonce and captcha_token
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validate(formData) {
  if (!config.enabled) return { valid: true };

  const token = formData.captcha_token;
  if (!token) {
    return { valid: false, reason: 'CAPTCHA token required' };
  }

  // Proof-of-work validation
  if (token.startsWith('pow:')) {
    return validatePow(formData);
  }

  // Math CAPTCHA validation
  const answer = formData.captcha_answer;
  if (!answer) {
    return { valid: false, reason: 'CAPTCHA answer required' };
  }

  const [timestampStr, sig] = token.split('.');
  const timestamp = parseInt(timestampStr, 10);

  if (isNaN(timestamp)) {
    return { valid: false, reason: 'Invalid CAPTCHA token' };
  }

  // Token expires after 10 minutes
  const age = (Date.now() - timestamp) / 1000;
  if (age > 600) {
    return { valid: false, reason: 'CAPTCHA expired, please try again' };
  }

  const numAnswer = parseInt(answer, 10);
  if (isNaN(numAnswer)) {
    return { valid: false, reason: 'Please enter a number' };
  }

  const expectedSig = signAnswer(numAnswer, timestamp);
  if (sig !== expectedSig) {
    return { valid: false, reason: 'Incorrect CAPTCHA answer' };
  }

  return { valid: true };
}

/**
 * Validate a proof-of-work CAPTCHA submission.
 * Verifies:
 *   1. The challenge token signature (HMAC)
 *   2. The timestamp hasn't expired
 *   3. SHA-256(challenge + nonce) has the required leading zero bits
 */
function validatePow(formData) {
  const token = formData.captcha_token;
  const nonce = formData.captcha_nonce;

  if (!nonce) {
    return { valid: false, reason: 'Proof-of-work not completed' };
  }

  // Parse token: "pow:timestamp:challenge:difficultyBits:sig"
  const parts = token.split(':');
  if (parts.length !== 5 || parts[0] !== 'pow') {
    return { valid: false, reason: 'Invalid proof-of-work token' };
  }

  const [, timestampStr, challenge, bitsStr, sig] = parts;
  const timestamp = parseInt(timestampStr, 10);
  const bits = parseInt(bitsStr, 10);

  if (isNaN(timestamp) || isNaN(bits)) {
    return { valid: false, reason: 'Malformed proof-of-work token' };
  }

  // Check expiry (10 minutes)
  const age = (Date.now() - timestamp) / 1000;
  if (age > 600) {
    return { valid: false, reason: 'CAPTCHA expired, please try again' };
  }

  // Verify HMAC signature on the challenge
  const expectedSig = createHmac('sha256', secret)
    .update(`pow:${challenge}:${bits}:${timestamp}`)
    .digest('hex')
    .substring(0, 24);

  if (sig !== expectedSig) {
    return { valid: false, reason: 'Invalid proof-of-work signature' };
  }

  // Verify the proof-of-work: SHA-256(challenge + nonce) must have `bits` leading zero bits
  const hash = createHmac('sha256', challenge).update(nonce).digest();
  const fullBytes = Math.floor(bits / 8);
  const remainBits = bits % 8;

  for (let i = 0; i < fullBytes; i++) {
    if (hash[i] !== 0) {
      return { valid: false, reason: 'Invalid proof-of-work' };
    }
  }
  if (remainBits > 0 && fullBytes < hash.length) {
    if ((hash[fullBytes] >> (8 - remainBits)) !== 0) {
      return { valid: false, reason: 'Invalid proof-of-work' };
    }
  }

  return { valid: true };
}

/**
 * Check if CAPTCHA is enabled.
 */
export function isEnabled() {
  return config.enabled;
}
