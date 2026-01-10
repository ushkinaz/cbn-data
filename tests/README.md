# Retention Policy Tests

Tests for `prune-data.mjs` retention logic.

## Run Tests

```bash
yarn test
# or
node tests/test-retention.mjs
```

## What It Tests

- ✓ All stable releases kept
- ✓ All builds <30 days kept  
- ✓ Thinning schedule applied correctly
- ✓ Retention stable across multiple days
- ✓ Builds without dates preserved

## Test Data

- `test-builds.json` - 77 builds from before pruning bug
