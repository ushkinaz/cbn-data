# Developer Guide

Mirrors JSON, translation, and GFX data from Cataclysm: Bright Nights → https://data.cataclysmbn-guide.com/

## Repository Structure

Orphan branches:
- action: scripts, workflows, config
- main/dev: generated data snapshots

Data branches are checked out to data_workspace/ in workflows. Do not commit generated data to the action branch.

## Install

```
pnpm install
```

## Build / Lint / Test

Build:
- No build step (scripts run directly with Node.js).

Lint / Format:
- No lint or formatting tools are configured in this repo.

Tests:
- Run all tests: `pnpm test`

## Common Commands

- Pull data (dry-run): `node pull-data-launcher.js`
- Pull data (live): `GITHUB_TOKEN=xxx node pull-data-launcher.js`
- Postprocess assets (CI parity): `node postprocess-data.mjs --workspace=data_workspace`
- Postprocess assets (dry-run): `node postprocess-data.mjs --workspace=data_workspace --dry-run`
- Backfill data (see script header for full docs):
  - `GITHUB_TOKEN=xxx node backfill-data.mjs --dry-run`
  - `GITHUB_TOKEN=xxx node backfill-data.mjs`
- Prune data (dry-run): `node prune-data-launcher.js`
- Prune data (live): `GITHUB_TOKEN=xxx node prune-data-launcher.js`

## Code Style

Language/runtime:
- ES modules (`type: "module"` in package.json).
- Use `// @ts-check` at file top for JS with JSDoc types.

Imports:
- Use named imports from `./pipeline.mjs` for shared worker functions.
- Keep imports ordered: external first, then internal.

Formatting:
- Double quotes for strings.
- Semicolons required.
- Two-space indentation.

Types / JSDoc:
- Prefer JSDoc for function params/returns and local type hints.
- Use `/** @type {...} */` for inline type assertions.

Naming:
- camelCase for variables/functions.
- UPPER_SNAKE for constants.
- Descriptive names for pipeline workers and steps.

Error handling:
- Use try/catch for external calls (GitHub API, filesystem, exec).
- Log concise errors, avoid swallowing failures silently unless explicitly safe.
- For retry logic, see existing patterns (if reintroduced).

Logging:
- Use per-step progress logs for long-running steps.
- Keep logs grouped per build (`console.group` / `console.groupEnd`).

Pipeline conventions:
- `pipeline.mjs` is a set of dumb worker utilities (no decisions).
- `backfill-data.mjs` owns decision-making and conditional execution.
- `pull-data.mjs` runs unconditional steps for new releases.

Compression:
- `.json` files are Brotli-compressed and served with `Content-Encoding: br`.

## Key Scripts

### pull-data.mjs
Ingests upstream releases → writes data snapshots.

Does:
- Downloads zipballs from cataclysmbn/Cataclysm-BN
- Extracts JSON (`all.json`), mods (`all_mods.json`), translations (`lang/*.json`)
- Generates pinyin variants for Chinese
- Extracts base/mod/external tileset assets

Does not:
- Convert PNG→WebP (handled in postprocess step)
- Compress JSON (handled in postprocess step)

### postprocess-data.mjs
Postprocesses data workspace to align with CI:
- Converts PNG→WebP for base gfx and mod assets
- Brotli-compresses `.json` files
- Designed to be deterministic and reusable in CI and manual runs

### backfill-data.mjs
Backfills missing GFX + Brotli-compresses JSON for old builds.

Notes:
- Decision-making happens here.
- Uses pipeline workers and per-step progress logs.

### prune-data.mjs
Applies retention policy and removes old builds.

Retention rules:
- Keep all stable releases
- Keep all builds <30 days
- Thinning schedule >30 days:
  - 30-90d: every 2 days
  - 90-180d: every 4 days
  - 180-450d: every 8 days
- Drop builds >450 days

## Workflows

### .github/workflows/pull-data.yml
Schedule: Every 12 hours

Runs:
1. Checkout action + data branches
2. Run pull-data.mjs
3. Install webp + brotli tools
4. Run postprocess-data.mjs
5. Commit + push to data branch

### .github/workflows/prune-data.yml
Schedule: Monthly (12th at 02:00 UTC)

Runs:
1. Apply retention policy
2. Delete old builds
3. Create backup branch
4. Squash history
5. Force push

## Testing

tests/test-retention.mjs validates pruning logic:
- Stable releases always kept
- Recent builds (<30d) kept
- Thinning applied correctly
- Retention stable across days

## Data Structure

data_workspace/
├── builds.json              # Build metadata (NOT compressed - used by workflows)
└── data/
    ├── stable -> v0.9.1/     # Symlink to latest stable release
    ├── nightly -> 2026-01-10/ # Symlink to latest prerelease
    └── 2024-01-10/
        ├── all.json          # Game objects (Brotli-compressed)
        ├── all_mods.json     # Mod data (Brotli-compressed)
        ├── lang/             # Translations (Brotli-compressed)
        │   ├── fr.json
        │   ├── zh_CN.json
        │   └── zh_CN_pinyin.json
        └── gfx/              # WebP graphics

Symlinks `stable` and `nightly` are filesystem symlinks updated on each pull-data run.
They provide stable URLs without resolving via builds.json. Not included in builds.json.

## Rules Files

No Cursor rules or Copilot instructions found in this repository.
