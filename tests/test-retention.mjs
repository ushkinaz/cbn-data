// @ts-check
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { applyRetentionPolicy } from '../prune-data.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DATA = join(__dirname, 'test-builds.json');
const ONE_DAY = 1000 * 60 * 60 * 24;

function makeBuild(base, days, suffix) {
  const date = new Date(base.getTime() - days * ONE_DAY);
  return {
    build_number: `${date.toISOString().slice(0, 10)}${suffix}`,
    prerelease: true,
    created_at: date.toISOString(),
  };
}

function toBuildNumbers(builds) {
  return builds.map(b => b.build_number).sort();
}

/**
 * Test: Multi-day stability test
 * Verifies that the retention policy doesn't cause excessive pruning across multiple days
 */
function testMultiDayStability() {
  console.log('\n=== Test: Multi-Day Stability ===\n');
  
  const builds = JSON.parse(readFileSync(TEST_DATA, 'utf8'));
  console.log(`Starting with ${builds.length} builds`);
  
  let currentBuilds = builds;
  for (let day = 0; day < 5; day++) {
    const testDate = new Date("2026-01-07T00:00:00Z");
    testDate.setDate(testDate.getDate() + day);
    
    const result = applyRetentionPolicy(currentBuilds, testDate);
    
    console.log(`Day ${day + 1} (${testDate.toISOString().split('T')[0]}): Kept ${result.kept.length}, Removed ${result.removed.length}`);
    
    if (result.removed.length > 0 && day > 0) {
      const removedNames = result.removed.map(b => b.build_number).join(', ');
      if (removedNames.length < 100) {
        console.log(`  Removed: ${removedNames}`);
      } else {
        console.log(`  Removed: ${result.removed.length} builds`);
      }
    }
    
    currentBuilds = result.kept;
  }
  
  const stable = currentBuilds.filter(b => !b.prerelease);
  const prerelease = currentBuilds.filter(b => b.prerelease);
  console.log(`\nFinal: ${stable.length} stable + ${prerelease.length} prerelease = ${currentBuilds.length} total`);
  
  // Verify we retain a reasonable number of builds
  const EXPECTED_MIN = 40; // Should retain at least 40 builds
  if (currentBuilds.length >= EXPECTED_MIN) {
    console.log(`✅ PASS: Retained ${currentBuilds.length} builds (>= ${EXPECTED_MIN})`);
    return true;
  } else {
    console.log(`❌ FAIL: Only ${currentBuilds.length} builds remaining (expected >= ${EXPECTED_MIN})`);
    return false;
  }
}

/**
 * Test: Verify stable releases are always kept
 */
function testStableReleases() {
  console.log('\n=== Test: Stable Releases Always Kept ===\n');
  
  const builds = JSON.parse(readFileSync(TEST_DATA, 'utf8'));
  const stableBuilds = builds.filter(b => !b.prerelease);
  
  console.log(`Found ${stableBuilds.length} stable releases in test data`);
  
  const testDate = new Date("2026-01-07T00:00:00Z");
  const result = applyRetentionPolicy(builds, testDate);
  const keptStable = result.kept.filter(b => !b.prerelease);
  
  console.log(`After retention: ${keptStable.length} stable releases kept`);
  
  if (keptStable.length === stableBuilds.length) {
    console.log(`✅ PASS: All stable releases kept`);
    return true;
  } else {
    console.log(`❌ FAIL: ${stableBuilds.length - keptStable.length} stable releases lost`);
    return false;
  }
}

/**
 * Test: Verify <30 day builds are all kept
 */
function testRecentBuilds() {
  console.log('\n=== Test: Recent Builds (<30 days) All Kept ===\n');
  
  const builds = JSON.parse(readFileSync(TEST_DATA, 'utf8'));
  const testDate = new Date("2026-01-07T00:00:00Z");
  
  const recentBuilds = builds.filter(b => {
    if (!b.prerelease) return false;
    const age = Math.floor((testDate.getTime() - new Date(b.created_at).getTime()) / ONE_DAY);
    return age < 30;
  });
  
  console.log(`Found ${recentBuilds.length} prerelease builds < 30 days old`);
  
  const result = applyRetentionPolicy(builds, testDate);
  const keptRecent = result.kept.filter(b => {
    if (!b.prerelease) return false;
    const age = Math.floor((testDate.getTime() - new Date(b.created_at).getTime()) / ONE_DAY);
    return age < 30;
  });
  
  console.log(`After retention: ${keptRecent.length} recent builds kept`);
  
  if (keptRecent.length === recentBuilds.length) {
    console.log(`✅ PASS: All recent builds kept`);
    return true;
  } else {
    console.log(`❌ FAIL: ${recentBuilds.length - keptRecent.length} recent builds lost`);
    return false;
  }
}

/**
 * Test: Verify parity stability across consecutive runs
 */
function testParityStability() {
  console.log('\n=== Test: Parity Stability Across Runs ===\n');

  const base = new Date('2024-08-01T12:00:00Z');
  const builds = [40, 41, 42, 43, 44].map(d => makeBuild(base, d, `-${d}`));

  const run1 = applyRetentionPolicy(builds, base);
  const run2 = applyRetentionPolicy(builds, new Date(base.getTime() + ONE_DAY));

  const keptRun1 = toBuildNumbers(run1.kept);
  const keptRun2 = toBuildNumbers(run2.kept);

  if (JSON.stringify(keptRun1) === JSON.stringify(keptRun2)) {
    console.log('✅ PASS: Kept builds stable across runs');
    return true;
  } else {
    console.log('❌ FAIL: Kept builds changed across runs');
    return false;
  }
}

/**
 * Test: Verify builds without dates are kept
 */
function testMissingDateIsKept() {
  console.log('\n=== Test: Missing Date Build Kept ===\n');

  const base = new Date('2024-08-01T12:00:00Z');
  const build = { build_number: 'experimental-foo', prerelease: true };
  const result = applyRetentionPolicy([build], base);

  if (result.kept.length === 1 && result.removed.length === 0) {
    console.log('✅ PASS: Missing-date build kept');
    return true;
  } else {
    console.log('❌ FAIL: Missing-date build removed');
    return false;
  }
}

// Run all tests
console.log('Running prune-data.mjs retention policy tests...');
console.log('='.repeat(50));

const results = [
  testStableReleases(),
  testRecentBuilds(),
  testMultiDayStability(),
  testParityStability(),
  testMissingDateIsKept(),
];

console.log('\n' + '='.repeat(50));
const passed = results.filter(r => r).length;
const total = results.length;

if (passed === total) {
  console.log(`\n✅ All ${total} tests PASSED`);
  process.exit(0);
} else {
  console.log(`\n❌ ${total - passed} of ${total} tests FAILED`);
  process.exit(1);
}
