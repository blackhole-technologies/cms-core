/**
 * honeypot.js - General-Purpose Anti-Spam Protection
 *
 * WHY THIS EXISTS:
 * Bots fill out every visible form field and submit instantly.
 * Honeypot uses two tricks to catch them:
 * 1. A hidden field that humans won't see but bots will fill
 * 2. A minimum time check — humans take seconds to fill forms, bots are instant
 *
 * The hidden field name is randomized per-boot to avoid bot fingerprinting.
 * The timestamp is HMAC-signed to prevent tampering (same pattern as core/csrf.js).
 *
 * Drupal parity: equivalent to the `honeypot` contrib module.
 */

import { createHmac } from 'node:crypto';

let config = { enabled: true, minTime: 3 };
let secret = '';

// Randomized field name per-boot — bots can't hard-code it
const honeypotFieldName = `hp_${Math.random().toString(36).substring(2, 10)}`;
const timestampFieldName = `ts_${Math.random().toString(36).substring(2, 10)}`;

/**
 * Initialize the honeypot module.
 * @param {Object} honeypotConfig - Config from site.json `honeypot` key
 * @param {Object} context - Boot context with services, sessionSecret, etc.
 */
export function init(honeypotConfig, context) {
  if (honeypotConfig) {
    config = { ...config, ...honeypotConfig };
  }
  secret = context?.sessionSecret || 'honeypot-fallback-secret';
  console.log(`[honeypot] Initialized (enabled: ${config.enabled}, minTime: ${config.minTime}s, field: ${honeypotFieldName})`);
}

/**
 * Sign a timestamp so bots can't forge it.
 */
function signTimestamp(timestamp) {
  return createHmac('sha256', secret)
    .update(String(timestamp))
    .digest('hex')
    .substring(0, 16);
}

/**
 * Generate honeypot HTML fields to inject into forms.
 * Returns raw HTML string — use {{{honeypotFields}}} in templates.
 */
export function generateFields() {
  if (!config.enabled) return '';

  const now = Date.now();
  const sig = signTimestamp(now);

  // Hidden field styled to be invisible to humans, visible to bots
  // Using CSS rather than type="hidden" — some bots skip type="hidden" but fill visible-looking fields
  return `<div style="position:absolute;left:-9999px;top:-9999px;" aria-hidden="true">` +
    `<label for="${honeypotFieldName}">Leave this blank</label>` +
    `<input type="text" name="${honeypotFieldName}" id="${honeypotFieldName}" value="" tabindex="-1" autocomplete="off">` +
    `</div>` +
    `<input type="hidden" name="${timestampFieldName}" value="${now}.${sig}">`;
}

/**
 * Validate a form submission against honeypot rules.
 * @param {Object} formData - Parsed form data
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validate(formData) {
  if (!config.enabled) return { valid: true };

  // Check 1: Honeypot field must be empty
  if (formData[honeypotFieldName]) {
    return { valid: false, reason: 'Bot detected (honeypot field filled)' };
  }

  // Check 2: Timestamp must exist and be valid
  const tsValue = formData[timestampFieldName];
  if (!tsValue) {
    return { valid: false, reason: 'Missing timestamp field' };
  }

  const [timestampStr, sig] = tsValue.split('.');
  const timestamp = parseInt(timestampStr, 10);

  if (isNaN(timestamp)) {
    return { valid: false, reason: 'Invalid timestamp' };
  }

  // Verify signature
  const expectedSig = signTimestamp(timestamp);
  if (sig !== expectedSig) {
    return { valid: false, reason: 'Tampered timestamp' };
  }

  // Check 3: Minimum time elapsed
  const elapsed = (Date.now() - timestamp) / 1000;
  if (elapsed < config.minTime) {
    return { valid: false, reason: `Form submitted too quickly (${elapsed.toFixed(1)}s < ${config.minTime}s minimum)` };
  }

  return { valid: true };
}

/**
 * Get the field names (for stripping from saved data).
 */
export function getFieldNames() {
  return [honeypotFieldName, timestampFieldName];
}

/**
 * Check if honeypot is enabled.
 */
export function isEnabled() {
  return config.enabled;
}
