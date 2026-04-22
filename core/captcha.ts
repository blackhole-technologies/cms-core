/**
 * captcha.ts - Math-Based CAPTCHA + Proof-of-Work Challenge
 *
 * WHY THIS EXISTS:
 * Bots can fill forms but can't solve math problems (yet).
 * This is a zero-dependency alternative to Google reCAPTCHA or FriendlyCAPTCHA.
 *
 * HOW IT WORKS:
 * 1. Generate a math problem ("What is 7 + 4?")
 * 2. Store the answer in an HMAC-signed token (same pattern as core/csrf.ts)
 * 3. Render the question + input field + hidden token in the form
 * 4. On submit, verify the user's answer matches the signed token
 *
 * WHY HMAC TOKENS (not server-side state):
 * Stateless verification — no need to store pending challenges in memory or on disk.
 * The token is self-validating: HMAC(answer + timestamp, secret).
 *
 * POW HASH FIX (Task 16 / CHANGELOG 0.2.0):
 * The previous implementation had a client/server mismatch:
 *   - client computed plain SHA-256 via crypto.subtle.digest("SHA-256", …)
 *   - server verified with createHmac('sha256', challenge).update(nonce)
 * These produce entirely different digests, so honest submissions always failed
 * and the PoW gate was effectively a random-fail nuisance rather than a guard.
 *
 * The correct protocol for a public PoW challenge is plain SHA-256 on both sides.
 * The challenge value itself is unpredictable (random bytes) and the HMAC is used
 * only to sign the challenge envelope so an attacker can't swap the difficulty.
 *
 * Drupal parity: equivalent to `captcha` + `friendlycaptcha` contrib modules.
 */

import { createHmac, createHash, randomBytes } from 'node:crypto';

// ============================================================================
// Types
// ============================================================================

/** Difficulty levels. 'simple' is the default; 'hard' is the strictest. */
type Difficulty = 'simple' | 'medium' | 'hard';

/** CAPTCHA challenge type. */
type CaptchaType = 'math' | 'pow';

/** Configuration shape for the CAPTCHA module. */
interface CaptchaConfig {
  enabled: boolean;
  difficulty: Difficulty;
  type: CaptchaType;
}

/** Result envelope for validate(). */
interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Partial context object supplied by the boot sequence. Only `sessionSecret`
 * is consumed here; the rest is ignored.
 */
interface BootContext {
  sessionSecret?: string;
}

/** Shape of the form data passed to validate(). Narrowed as we read fields. */
type FormData = Record<string, unknown>;

// ============================================================================
// Module state
// ============================================================================

let config: CaptchaConfig = { enabled: true, difficulty: 'simple', type: 'math' };
let secret = '';

/**
 * Initialize the CAPTCHA module.
 */
export function init(
  captchaConfig: Partial<CaptchaConfig> | null | undefined,
  context: BootContext | null | undefined
): void {
  if (captchaConfig) {
    config = { ...config, ...captchaConfig };
  }
  secret = context?.sessionSecret || 'captcha-fallback-secret';
  console.log(`[captcha] Initialized (enabled: ${config.enabled}, difficulty: ${config.difficulty})`);
}

/**
 * Generate a math problem based on difficulty.
 */
function generateProblem(): { question: string; answer: number } {
  const difficulty = config.difficulty || 'simple';

  if (difficulty === 'hard') {
    // Multiplication with small numbers
    const a = Math.floor(Math.random() * 12) + 1;
    const b = Math.floor(Math.random() * 12) + 1;
    return { question: `What is ${a} × ${b}?`, answer: a * b };
  }

  if (difficulty === 'medium') {
    // Addition and subtraction with larger numbers
    const ops = ['+', '-'] as const;
    const op = ops[Math.floor(Math.random() * ops.length)] ?? '+';
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
function signAnswer(answer: number, timestamp: number): string {
  return createHmac('sha256', secret)
    .update(`${answer}:${timestamp}`)
    .digest('hex')
    .substring(0, 24);
}

/**
 * Generate CAPTCHA HTML to inject into a form.
 */
export function generateField(): string {
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
 * Difficulty → leading-zero bit count for the proof-of-work.
 * Extracted so the same table is used by server verifier and test harness.
 */
export function difficultyBits(level: Difficulty | string | undefined): number {
  return level === 'hard' ? 20 : level === 'medium' ? 16 : 12;
}

/**
 * Sign the PoW envelope so the client can't tamper with the difficulty bits.
 * This is HMAC (keyed) — the challenge itself is random.
 */
function signPowEnvelope(challenge: string, bits: number, timestamp: number): string {
  return createHmac('sha256', secret)
    .update(`pow:${challenge}:${bits}:${timestamp}`)
    .digest('hex')
    .substring(0, 24);
}

/**
 * Verify SHA-256(challenge + nonce) has `bits` leading zero bits.
 * Exported so tests can round-trip client-equivalent hashing against the verifier.
 *
 * NOTE: we use UTF-8 encoding of the challenge+nonce string on both sides. The
 * browser client does `new TextEncoder().encode(challenge + nonce)` which
 * produces UTF-8 bytes; since challenge+nonce are ASCII hex/base36 this is
 * byte-identical to Node's `Buffer.from(challenge + nonce, 'utf8')`.
 */
export function verifyPow(challenge: string, nonce: string, bits: number): boolean {
  // Plain SHA-256, matching the client's `crypto.subtle.digest("SHA-256", …)`.
  const hash = createHash('sha256').update(challenge + nonce, 'utf8').digest();
  const fullBytes = Math.floor(bits / 8);
  const remainBits = bits % 8;

  for (let i = 0; i < fullBytes; i++) {
    if (hash[i] !== 0) return false;
  }
  if (remainBits > 0 && fullBytes < hash.length) {
    const byte = hash[fullBytes];
    if (byte === undefined) return false;
    if ((byte >> (8 - remainBits)) !== 0) return false;
  }
  return true;
}

/**
 * Generate a proof-of-work CAPTCHA field.
 * The browser must find a nonce where SHA-256(challenge + nonce) has N leading zero bits.
 * Invisible to users — runs in the background via inline JS.
 */
function generatePowField(): string {
  const challenge = randomBytes(16).toString('hex');
  const timestamp = Date.now();
  const bits = difficultyBits(config.difficulty);
  const sig = signPowEnvelope(challenge, bits, timestamp);
  const powToken = `pow:${timestamp}:${challenge}:${bits}:${sig}`;

  // Inline JS that computes the proof-of-work using SubtleCrypto (async, non-blocking).
  // The client and server MUST agree on the hash: plain SHA-256 of (challenge || nonce).
  return `<div class="captcha-group captcha-pow" data-difficulty="${bits}">` +
    `<input type="hidden" name="captcha_token" value="${powToken}">` +
    `<input type="hidden" name="captcha_nonce" id="captcha_nonce" value="">` +
    `<span class="captcha-pow-status">Verifying you are human...</span>` +
    `<script>` +
    `(async function(){` +
    `const challenge="${challenge}";` +
    `const bits=${bits};` +
    `const fullBytes=Math.floor(bits/8);` +
    `const remainBits=bits%8;` +
    `const enc=new TextEncoder();` +
    `for(let n=0;n<1e8;n++){` +
    `const nonce=n.toString(36);` +
    // Plain SHA-256(challenge + nonce) — matches server's createHash('sha256').
    `const data=enc.encode(challenge+nonce);` +
    `const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",data));` +
    `let ok=true;` +
    `for(let i=0;i<fullBytes;i++){if(hash[i]!==0){ok=false;break;}}` +
    `if(ok&&remainBits>0&&(fullBytes<hash.length)&&((hash[fullBytes]>>(8-remainBits))!==0)){ok=false;}` +
    `if(ok){` +
    `document.getElementById("captcha_nonce").value=nonce;` +
    `document.querySelector(".captcha-pow-status").textContent="Verified!";` +
    `break;}}` +
    `})();` +
    `</script>` +
    `</div>`;
}

/**
 * Validate a CAPTCHA submission.
 * Handles both math and proof-of-work tokens.
 */
export function validate(formData: FormData): ValidationResult {
  if (!config.enabled) return { valid: true };

  const token = typeof formData.captcha_token === 'string' ? formData.captcha_token : '';
  if (!token) {
    return { valid: false, reason: 'CAPTCHA token required' };
  }

  // Proof-of-work validation
  if (token.startsWith('pow:')) {
    return validatePow(formData);
  }

  // Math CAPTCHA validation
  const answer = formData.captcha_answer;
  if (answer === undefined || answer === null || answer === '') {
    return { valid: false, reason: 'CAPTCHA answer required' };
  }

  const [timestampStr, sig] = token.split('.');
  if (timestampStr === undefined || sig === undefined) {
    return { valid: false, reason: 'Invalid CAPTCHA token' };
  }
  const timestamp = parseInt(timestampStr, 10);

  if (isNaN(timestamp)) {
    return { valid: false, reason: 'Invalid CAPTCHA token' };
  }

  // Token expires after 10 minutes
  const age = (Date.now() - timestamp) / 1000;
  if (age > 600) {
    return { valid: false, reason: 'CAPTCHA expired, please try again' };
  }

  const numAnswer = parseInt(String(answer), 10);
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
 *   1. The challenge envelope signature (HMAC over challenge+bits+timestamp)
 *   2. The timestamp hasn't expired
 *   3. SHA-256(challenge + nonce) has the required leading zero bits
 */
function validatePow(formData: FormData): ValidationResult {
  const token = typeof formData.captcha_token === 'string' ? formData.captcha_token : '';
  const nonce = typeof formData.captcha_nonce === 'string' ? formData.captcha_nonce : '';

  if (!nonce) {
    return { valid: false, reason: 'Proof-of-work not completed' };
  }

  // Parse token: "pow:timestamp:challenge:difficultyBits:sig"
  const parts = token.split(':');
  if (parts.length !== 5 || parts[0] !== 'pow') {
    return { valid: false, reason: 'Invalid proof-of-work token' };
  }

  const timestampStr = parts[1];
  const challenge = parts[2];
  const bitsStr = parts[3];
  const sig = parts[4];
  if (
    timestampStr === undefined ||
    challenge === undefined ||
    bitsStr === undefined ||
    sig === undefined
  ) {
    return { valid: false, reason: 'Malformed proof-of-work token' };
  }

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

  // Verify HMAC signature on the challenge envelope
  const expectedSig = signPowEnvelope(challenge, bits, timestamp);
  if (sig !== expectedSig) {
    return { valid: false, reason: 'Invalid proof-of-work signature' };
  }

  // Verify the proof-of-work: SHA-256(challenge + nonce) must have `bits` leading zero bits.
  if (!verifyPow(challenge, nonce, bits)) {
    return { valid: false, reason: 'Invalid proof-of-work' };
  }

  return { valid: true };
}

/**
 * Check if CAPTCHA is enabled.
 */
export function isEnabled(): boolean {
  return config.enabled;
}
