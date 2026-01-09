# Prune Data Retention Tests

This directory contains self-contained tests for the `prune-data.mjs` retention policy.

## Setup

The tests import the actual functions from `../prune-data.mjs` and use test data in this directory.

## Test Data

- `test-builds.json` - Original 77 builds from before the pruning bug

## Test Files

### `test-retention.mjs`
Main test suite with five tests:
1. **Stable Releases Test** - Verifies all stable releases are always kept
2. **Recent Builds Test** - Verifies all builds <30 days old are kept
3. **Multi-Day Stability Test** - Verifies retention stays stable across 5 days
4. **Parity Stability Test** - Verifies kept builds do not flip across runs
5. **Missing Date Test** - Verifies builds without dates are kept

Run: `node tests/test-retention.mjs`

## Running Tests in Another Branch

To test a different version of `prune-data.mjs`:

```bash
# 1. Copy the entire tests directory to the other branch
cp -r tests /path/to/other/branch/tests

# 2. In the other branch, run the tests
cd /path/to/other/branch
node tests/test-retention.mjs
```

The tests will automatically import `applyRetentionPolicy` from `../prune-data.mjs`.

## Expected Results (Fixed Version)

**test-retention.mjs:**
- All 5 tests should PASS
- Should retain ≥40 builds after 5 days
