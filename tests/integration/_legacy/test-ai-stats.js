/**
 * test-ai-stats.js - Comprehensive test suite for AI stats service
 *
 * Tests all requirements from Feature #4:
 * 1. Service initialization following service pattern
 * 2. Data structure with correct fields
 * 3. log() method records operations
 * 4. Daily JSON file storage (YYYY-MM-DD.json)
 * 5. File rotation (30-day retention)
 * 6. Aggregation methods
 * 7. Integration with ai-registry (manual test)
 * 8. Memory buffer with batch writes
 * 9-13. Verification tests
 */

import * as aiStats from '../../core/ai-stats.ts';
import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE_DIR = process.cwd();
const STATS_DIR = join(BASE_DIR, 'content', 'ai-stats');

// ANSI color codes for output
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

let passCount = 0;
let failCount = 0;

function log(message, color = RESET) {
  console.log(`${color}${message}${RESET}`);
}

function pass(testName) {
  passCount++;
  log(`✓ ${testName}`, GREEN);
}

function fail(testName, error) {
  failCount++;
  log(`✗ ${testName}`, RED);
  log(`  Error: ${error}`, RED);
}

function section(title) {
  log(`\n${'='.repeat(60)}`, BLUE);
  log(title, BLUE);
  log('='.repeat(60), BLUE);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

function getDateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
}

// Clean up before tests
function cleanupStatsDir() {
  if (existsSync(STATS_DIR)) {
    const files = readdirSync(STATS_DIR);
    for (const file of files) {
      if (file.endsWith('.json')) {
        unlinkSync(join(STATS_DIR, file));
      }
    }
  }
}

section('AI Stats Service Test Suite');

// Test 1: Service initialization
section('Test 1: Service Initialization');
try {
  cleanupStatsDir();
  aiStats.init(BASE_DIR);

  if (existsSync(STATS_DIR)) {
    pass('Service initialized and created stats directory');
  } else {
    fail('Service initialization', 'Stats directory not created');
  }
} catch (err) {
  fail('Service initialization', err.message);
}

// Test 2: Data structure validation
section('Test 2: Data Structure');
try {
  const result = aiStats.log({
    provider: 'anthropic',
    operation: 'chat.completion',
    tokensIn: 100,
    tokensOut: 50,
    cost: 0.0025,
    responseTime: 1250,
    status: 'success',
  });

  if (result === true) {
    pass('log() accepts correct data structure');
  } else {
    fail('Data structure validation', 'log() returned false');
  }
} catch (err) {
  fail('Data structure validation', err.message);
}

// Test 3: Missing required fields
section('Test 3: Validation - Missing Required Fields');
try {
  const result = aiStats.log({
    tokensIn: 100,
    // Missing provider and operation
  });

  if (result === false) {
    pass('log() rejects events without required fields');
  } else {
    fail('Required fields validation', 'log() should return false for invalid data');
  }
} catch (err) {
  fail('Required fields validation', err.message);
}

// Test 4: Log 10 operations and verify file creation
section('Test 4: Log 10 Operations');
try {
  cleanupStatsDir();
  aiStats.clear(); // Clear buffer

  // Log 10 events
  for (let i = 0; i < 10; i++) {
    aiStats.log({
      provider: 'anthropic',
      operation: 'chat.completion',
      tokensIn: 100 + i,
      tokensOut: 50 + i,
      cost: 0.0025,
      responseTime: 1000 + (i * 10),
      status: 'success',
    });
  }

  // Force flush
  aiStats.flush();

  const today = getTodayDate();
  const filePath = join(STATS_DIR, `${today}.json`);

  if (existsSync(filePath)) {
    const content = readFileSync(filePath, 'utf-8');
    const events = JSON.parse(content);

    if (events.length === 10) {
      pass(`10 events logged to ${today}.json`);
    } else {
      fail('Event logging', `Expected 10 events, got ${events.length}`);
    }
  } else {
    fail('File creation', `${today}.json not created`);
  }
} catch (err) {
  fail('Log 10 operations', err.message);
}

// Test 5: Verify JSON structure
section('Test 5: Verify JSON Structure');
try {
  const today = getTodayDate();
  const filePath = join(STATS_DIR, `${today}.json`);
  const content = readFileSync(filePath, 'utf-8');
  const events = JSON.parse(content);

  if (events.length > 0) {
    const event = events[0];
    const requiredFields = ['timestamp', 'provider', 'operation', 'tokensIn', 'tokensOut', 'cost', 'responseTime', 'status'];
    const hasAllFields = requiredFields.every(field => field in event);

    if (hasAllFields) {
      pass('JSON file contains correct event structure');
      log(`  Sample event: ${JSON.stringify(event, null, 2)}`, YELLOW);
    } else {
      fail('JSON structure', 'Event missing required fields');
    }
  } else {
    fail('JSON structure', 'No events in file');
  }
} catch (err) {
  fail('JSON structure validation', err.message);
}

// Test 6: Memory buffer with batch writes (150 events)
section('Test 6: Memory Buffer - Log 150 Events');
try {
  cleanupStatsDir();
  aiStats.clear();

  // Log 150 events
  for (let i = 0; i < 150; i++) {
    aiStats.log({
      provider: i % 2 === 0 ? 'anthropic' : 'openai',
      operation: 'chat.completion',
      tokensIn: 100,
      tokensOut: 50,
      cost: 0.0025,
      responseTime: 1000,
      status: 'success',
    });
  }

  // Wait for automatic flush (should trigger at 100 events)
  await sleep(500);

  const today = getTodayDate();
  const filePath = join(STATS_DIR, `${today}.json`);

  if (existsSync(filePath)) {
    const content = readFileSync(filePath, 'utf-8');
    const events = JSON.parse(content);

    if (events.length >= 100) {
      pass(`Batch write triggered at 100 events (found ${events.length} events)`);
    } else {
      fail('Batch write', `Expected at least 100 events after auto-flush, got ${events.length}`);
    }
  } else {
    fail('Batch write', 'File not created');
  }

  // Force flush remaining events
  aiStats.flush();

  // Verify all 150 events are now written
  const finalContent = readFileSync(filePath, 'utf-8');
  const finalEvents = JSON.parse(finalContent);

  if (finalEvents.length === 150) {
    pass(`All 150 events written after manual flush`);
  } else {
    fail('Complete batch write', `Expected 150 events total, got ${finalEvents.length}`);
  }
} catch (err) {
  fail('Memory buffer test', err.message);
}

// Test 7: getDaily() aggregation
section('Test 7: getDaily() Aggregation');
try {
  const today = getTodayDate();
  const stats = aiStats.getDaily(today);

  if (stats && stats.totalEvents === 150) {
    pass('getDaily() returns correct event count');
  } else {
    fail('getDaily() count', `Expected 150 events, got ${stats?.totalEvents}`);
  }

  if (stats.totalTokensIn === 150 * 100) {
    pass('getDaily() calculates total tokens in correctly');
  } else {
    fail('getDaily() tokens in', `Expected ${150 * 100}, got ${stats.totalTokensIn}`);
  }

  if (stats.totalTokensOut === 150 * 50) {
    pass('getDaily() calculates total tokens out correctly');
  } else {
    fail('getDaily() tokens out', `Expected ${150 * 50}, got ${stats.totalTokensOut}`);
  }

  if (stats.avgResponseTime === 1000) {
    pass('getDaily() calculates average response time correctly');
  } else {
    fail('getDaily() avg response time', `Expected 1000ms, got ${stats.avgResponseTime}`);
  }

  if (stats.byProvider.anthropic && stats.byProvider.openai) {
    pass('getDaily() breaks down stats by provider');
    log(`  anthropic: ${stats.byProvider.anthropic.count} events`, YELLOW);
    log(`  openai: ${stats.byProvider.openai.count} events`, YELLOW);
  } else {
    fail('getDaily() by provider', 'Missing provider breakdown');
  }

  log(`  Full stats: ${JSON.stringify(stats, null, 2)}`, YELLOW);
} catch (err) {
  fail('getDaily() aggregation', err.message);
}

// Test 8: File rotation (30-day retention)
section('Test 8: File Rotation - 30-Day Retention');
try {
  // Create a stats file from 35 days ago
  const oldDate = getDateDaysAgo(35);
  const oldFilePath = join(STATS_DIR, `${oldDate}.json`);

  writeFileSync(oldFilePath, JSON.stringify([
    {
      timestamp: new Date(oldDate).toISOString(),
      provider: 'test',
      operation: 'test',
      tokensIn: 10,
      tokensOut: 10,
      cost: 0.01,
      responseTime: 100,
      status: 'success',
    }
  ]), 'utf-8');

  if (existsSync(oldFilePath)) {
    pass(`Created test file from 35 days ago: ${oldDate}.json`);
  } else {
    fail('File creation', 'Could not create old file');
  }

  // Run rotation
  const deletedCount = aiStats.rotateFiles();

  if (!existsSync(oldFilePath)) {
    pass('File rotation deleted files older than 30 days');
    log(`  Deleted ${deletedCount} file(s)`, YELLOW);
  } else {
    fail('File rotation', 'Old file still exists after rotation');
  }

  // Verify recent files are kept
  const recentDate = getDateDaysAgo(5);
  const recentFilePath = join(STATS_DIR, `${recentDate}.json`);

  writeFileSync(recentFilePath, JSON.stringify([]), 'utf-8');
  aiStats.rotateFiles();

  if (existsSync(recentFilePath)) {
    pass('File rotation keeps files within 30-day window');
    unlinkSync(recentFilePath); // Clean up
  } else {
    fail('File retention', 'Recent file was deleted');
  }
} catch (err) {
  fail('File rotation test', err.message);
}

// Test 9: getByProvider() aggregation
section('Test 9: getByProvider() Aggregation');
try {
  const stats = aiStats.getByProvider('anthropic', 30);

  if (stats && stats.totalEvents > 0) {
    pass('getByProvider() returns stats for specific provider');
    log(`  Total events: ${stats.totalEvents}`, YELLOW);
    log(`  Total cost: $${stats.totalCost.toFixed(4)}`, YELLOW);
  } else {
    fail('getByProvider()', 'No stats returned');
  }
} catch (err) {
  fail('getByProvider() aggregation', err.message);
}

// Test 10: getTotalCost()
section('Test 10: getTotalCost()');
try {
  const totalCost = aiStats.getTotalCost(30);

  if (typeof totalCost === 'number' && totalCost > 0) {
    pass('getTotalCost() calculates total cost across all providers');
    log(`  Total cost (30 days): $${totalCost.toFixed(4)}`, YELLOW);
  } else {
    fail('getTotalCost()', `Invalid cost returned: ${totalCost}`);
  }
} catch (err) {
  fail('getTotalCost()', err.message);
}

// Test 11: getHourly() aggregation
section('Test 11: getHourly() Aggregation');
try {
  const today = getTodayDate();
  const hourlyStats = aiStats.getHourly(today);

  if (Array.isArray(hourlyStats) && hourlyStats.length === 24) {
    pass('getHourly() returns 24 hours of stats');

    // Find hours with events
    const hoursWithEvents = hourlyStats.filter(h => h.totalEvents > 0);
    if (hoursWithEvents.length > 0) {
      pass(`getHourly() shows events in ${hoursWithEvents.length} hour(s)`);
      log(`  Example hour: ${JSON.stringify(hoursWithEvents[0], null, 2)}`, YELLOW);
    }
  } else {
    fail('getHourly()', `Expected 24 entries, got ${hourlyStats?.length}`);
  }
} catch (err) {
  fail('getHourly() aggregation', err.message);
}

// Test 12: getAvailableDates()
section('Test 12: getAvailableDates()');
try {
  const dates = aiStats.getAvailableDates();

  if (Array.isArray(dates) && dates.length > 0) {
    pass('getAvailableDates() returns list of dates');
    log(`  Available dates: ${dates.join(', ')}`, YELLOW);
  } else {
    fail('getAvailableDates()', 'No dates returned');
  }
} catch (err) {
  fail('getAvailableDates()', err.message);
}

// Test 13: Error handling
section('Test 13: Error Handling');
try {
  // Test with error status
  aiStats.log({
    provider: 'test',
    operation: 'test',
    status: 'error',
    error: 'Test error message',
  });

  // Test with timeout status
  aiStats.log({
    provider: 'test',
    operation: 'test',
    status: 'timeout',
  });

  aiStats.flush();

  const today = getTodayDate();
  const stats = aiStats.getDaily(today);

  if (stats.byStatus.error > 0 && stats.byStatus.timeout > 0) {
    pass('Service tracks error and timeout statuses');
    log(`  Errors: ${stats.byStatus.error}, Timeouts: ${stats.byStatus.timeout}`, YELLOW);
  } else {
    fail('Error tracking', 'Error/timeout events not tracked');
  }
} catch (err) {
  fail('Error handling test', err.message);
}

// Final summary
section('Test Results Summary');
const total = passCount + failCount;
const percentage = total > 0 ? ((passCount / total) * 100).toFixed(1) : 0;

log(`Total tests: ${total}`, BLUE);
log(`Passed: ${passCount}`, GREEN);
log(`Failed: ${failCount}`, failCount > 0 ? RED : GREEN);
log(`Success rate: ${percentage}%`, percentage === '100.0' ? GREEN : YELLOW);

if (failCount === 0) {
  log('\n🎉 All tests passed! AI stats service is working correctly.', GREEN);
} else {
  log('\n⚠️  Some tests failed. Review the output above.', YELLOW);
}

// Shutdown service
aiStats.shutdown();
log('\nService shut down.', BLUE);

process.exit(failCount > 0 ? 1 : 0);
