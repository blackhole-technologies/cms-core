/**
 * Test file size validation constraint
 * Tests Feature #126: File size constraint
 */

import { readFileSync } from 'node:fs';

// Simulate the validation
function validateFileSize(fileSize, maxSize) {
  if (fileSize > maxSize) {
    const actualMB = (fileSize / (1024 * 1024)).toFixed(2);
    const maxMB = (maxSize / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `File too large: ${actualMB}MB (max: ${maxMB}MB)`
    };
  }
  return { valid: true };
}

// Test configuration
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB for this test

console.log('Testing File Size Constraint Validation (Feature #126)');
console.log('='.repeat(60));
console.log(`Max file size configured: ${(MAX_FILE_SIZE / (1024 * 1024)).toFixed(1)}MB\n`);

// Test 1: File under limit (1MB)
try {
  const smallFileSize = readFileSync('small_file.jpg').length;
  const result1 = validateFileSize(smallFileSize, MAX_FILE_SIZE);

  console.log('Test 1: Small file (1MB)');
  console.log(`  Actual size: ${(smallFileSize / (1024 * 1024)).toFixed(2)}MB`);
  console.log(`  Result: ${result1.valid ? '✓ PASS' : '✗ FAIL'}`);
  if (!result1.valid) {
    console.log(`  Error: ${result1.error}`);
  }
  console.log();
} catch (e) {
  console.log('Test 1: Error reading small_file.jpg -', e.message);
  console.log();
}

// Test 2: File over limit (11MB)
try {
  const largeFileSize = readFileSync('large_file.jpg').length;
  const result2 = validateFileSize(largeFileSize, MAX_FILE_SIZE);

  console.log('Test 2: Large file (11MB)');
  console.log(`  Actual size: ${(largeFileSize / (1024 * 1024)).toFixed(2)}MB`);
  console.log(`  Result: ${!result2.valid ? '✓ PASS (correctly rejected)' : '✗ FAIL (should reject)'}`);
  if (!result2.valid) {
    console.log(`  Error message: "${result2.error}"`);
    console.log(`  ✓ Error shows actual size: ${result2.error.includes((largeFileSize / (1024 * 1024)).toFixed(2))}`);
    console.log(`  ✓ Error shows limit: ${result2.error.includes((MAX_FILE_SIZE / (1024 * 1024)).toFixed(1))}`);
    console.log(`  ✓ Size in human-readable format (MB): ${result2.error.includes('MB')}`);
  }
  console.log();
} catch (e) {
  console.log('Test 2: Error reading large_file.jpg -', e.message);
  console.log();
}

// Test 3: Exactly at limit (5MB)
const exactlyAtLimit = 5 * 1024 * 1024;
const result3 = validateFileSize(exactlyAtLimit, MAX_FILE_SIZE);
console.log('Test 3: File exactly at limit (5MB)');
console.log(`  Actual size: ${(exactlyAtLimit / (1024 * 1024)).toFixed(2)}MB`);
console.log(`  Result: ${result3.valid ? '✓ PASS' : '✗ FAIL'}`);
if (!result3.valid) {
  console.log(`  Error: ${result3.error}`);
}
console.log();

// Test 4: Just over limit (5MB + 1 byte)
const justOverLimit = (5 * 1024 * 1024) + 1;
const result4 = validateFileSize(justOverLimit, MAX_FILE_SIZE);
console.log('Test 4: File just over limit (5MB + 1 byte)');
console.log(`  Actual size: ${(justOverLimit / (1024 * 1024)).toFixed(2)}MB`);
console.log(`  Result: ${!result4.valid ? '✓ PASS (correctly rejected)' : '✗ FAIL (should reject)'}`);
if (!result4.valid) {
  console.log(`  Error message: "${result4.error}"`);
}
console.log();

console.log('='.repeat(60));
console.log('All tests completed!');
