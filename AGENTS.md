# Guidance for contributors

This repository mirrors JSON, translation, and tileset gfx data from Cataclysm: Bright Nights and deploys it at [https://cbn-data.pages.dev/](https://cbn-data.pages.dev/) as static data snapshots. Use these notes for any work under this directory.

## Repository structure
This repository uses **orphan branches** with completely separate histories:
- **Action branch** `action`: contains automation scripts, workflows, and configuration files
- **Data branches** (`main`, `dev`): contain generated game data snapshots with no common files or ancestor commits with action branches

GitHub Actions check out a data branch into a separate directory (typically `data_workspace/`) while keeping `action` at the repo root. Any git operations against data branches in scripts or workflows must:
- Use `cwd: data_workspace` (or the configured checkout path) when running `git`
- Treat `data_workspace` as the root that contains `builds.json` and the `data/` tree
- Generated data must **never** be committed to `action`; automation writes directly to the data branches

## Install & common commands

### Dependencies
Use Yarn 1.x as pinned in `package.json`/`yarn.lock`:
```bash
cd /Users/dmitry/Workspace/C-BN/cbn-data
yarn install --frozen-lockfile --ignore-engines
```

### Tests
Run the retention test suite:
```bash
yarn test
# or
node tests/test-retention.mjs
```

The tests exercise the retention policy in `prune-data.mjs` using `tests/test-builds.json`.

### Local update runs (dry-run by default)
These launchers simulate the GitHub Actions environment by constructing an `Octokit` client and passing a `github-script`-style `context`.

Pull new game data into the configured data branch (default `main` via `DATA_BRANCH` in `pull-data.mjs`):
```bash
node pull-data-launcher.js
# With real writes (non–dry run), provide a GitHub token with repo access:
GITHUB_TOKEN={{GITHUB_TOKEN}} node pull-data-launcher.js
```

Prune old builds and rewrite `builds.json`/`data/` in `main` according to the retention policy:
```bash
node prune-data-launcher.js
# Non–dry run:
GITHUB_TOKEN={{GITHUB_TOKEN}} node prune-data-launcher.js
```

Both launchers run in **dry-run** mode when `GITHUB_TOKEN` is not set (`dryRun: !process.env.GITHUB_TOKEN`). In dry-run mode:
- `pull-data-launcher.js` writes to `workspace/` directory without committing
- `prune-data-launcher.js` computes changes but doesn't update the data branch
- `migrate-gfx.mjs` (via `MIGRATION.md` instructions) performs local GFX recovery/migration

### GFX Migration
For historical builds missing WebP assets, use the migration utility:
```bash
# See MIGRATION.md for details
GITHUB_TOKEN=xxx node migrate-gfx.mjs --dry-run
```


## Code architecture

### Runtime and module style
- Node.js ESM throughout (`"type": "module"` in `package.json`)
- Key automation entrypoints are `.mjs` modules with `// @ts-check` where applicable for JS type safety
- Heavy lifting uses a small set of dependencies: `adm-zip`, `minimatch`, `po2json`, `pinyin`, `octokit`

### High-level components

#### `pull-data.mjs`
End-to-end pipeline to ingest upstream releases and write structured data snapshots to the filesystem.

Key responsibilities:
- Reads `builds.json` from workspace directory to find existing builds
- Determines the latest experimental release by matching release tag names against a `YYYY-MM-DD` pattern
- For each new release (not present in `existingBuilds`):
  - Downloads the upstream zipball using GitHub API
  - Extracts game JSON from `*/data/json/**/*.json`, splits concatenated arrays into per-object JSON with line-number annotations, and writes `all.json`
  - Extracts mod metadata and data from `*/data/mods/*/`, writes `all_mods.json`
  - Processes translations from `*/lang/po/*.po` using `po2json` and `postprocessPoJson`, writing `lang/<lang>.json` and gzipped versions under `data/latest.gz/` for the latest build
  - For Chinese locales (`zh_*`), generates pinyin mirror JSONs via `toPinyin` from `pinyin.mjs` and gzipped variants  
  - Mirrors gfx assets from upstream `*/gfx/**/*` into `data/<tag>/gfx/`
- Writes/updates directly to filesystem:
  - `data/<tag>/all.json` and `data/<tag>/all_mods.json` for each new build
  - `builds.json` (sorted newest-first, containing metadata like `build_number`, `prerelease`, `created_at`, and `langs`)
  - `data/latest/*` and `data/latest.gz/*` mirrors for the latest experimental, including gfx assets
- Works on a checked-out data branch (via `WORKSPACE_DIR` env var, default `data_workspace`)
- Honors `dryRun`: no files are written when enabled
- Does NOT commit or convert GFX - the workflow (`pull-data.yml`) handles GFX conversion to WebP and git operations after this script completes

#### `prune-data.mjs`
Implements and applies the retention policy for historical builds. Runs monthly via `prune-data.yml` workflow.

Structure:
- `run({ github, context, dryRun })`:
  - Reads configuration from environment: `WORKSPACE_DIR` (default `data_workspace`) and `DATA_BRANCH` (default `main`)
  - Reads `builds.json` from the workspace directory
  - Calls `applyRetentionPolicy(existingBuilds, new Date())` to partition builds into `kept` and `removed`
  - In non–dry run:
    - Deletes removed build directories from `data/` on filesystem
    - Writes updated `builds.json` with only kept builds
  - No git operations - workflow handles commits

- `applyRetentionPolicy(builds, now)` (also exported and covered by tests):
  - Computes build dates via `getBuildDate` using `created_at` or a `YYYY-MM-DD` prefix of `build_number`
  - Groups prerelease builds by UTC day and assigns each day an integer key used for parity
  - Rules:
    - Keep all non-prerelease (stable) builds
    - Keep all prerelease builds from the last 30 days
    - For older prerelease builds, keep only the latest build per day on a thinning schedule (every 2/4/8 days depending on age) and drop others in that day
    - Drop all builds older than 450 days
  - Returns `{ kept, removed }` and logs how many builds lack valid dates

#### `.github/workflows/prune-data.yml`
Monthly workflow (12th of month at 02:00 UTC) that:
1. Checks out the action branch and target data branch (with full history)
2. Applies retention policy via `prune-data.mjs` to prune old builds
3. Commits pruned data
4. Creates/updates backup branch with pre-squash state
5. Squashes all commits in the data branch into a single commit
6. Force-pushes the squashed branch

Inputs for manual runs:
- `target_branch`: Choice of `main` or `dev` (default: `main`)
- `backup_branch`: Free-form text for backup branch name (default: `backup`)

#### `lib.mjs` (`GitHubHelper`)
Shared helper previously used for Git tree manipulation via GitHub API.

Capabilities:
- `getExistingBuilds(dataBranch)` reads the tip commit for `dataBranch`, fetches `builds.json` at that commit, decodes it, and returns `{ baseCommit, existingBuilds }`
- `uploadBlob(content)` wraps `github.rest.git.createBlob` with retries and respects `dryRun`
- `createBlob(path, content)` uploads content and records a blob entry (path/mode/sha) onto an internal `blobs` array for later tree construction
- `copyBlob(fromPath, toPath)` reuses an earlier blob sha in `blobs` to mirror content between paths (e.g. copying from `data/<build>/...` to `data/latest/...`)

Note: No longer used by `pull-data.mjs` or `prune-data.mjs` - both now use direct filesystem operations. Retained for potential future use.

#### `pinyin.mjs`
- Given parsed game data and a translation JSON object, builds a parallel JSON mapping names to pinyin representations using the `pinyin` package
- Keeps translation metadata in the `""` key, mirroring the translation file structure

#### `migrate-gfx.mjs`
Utility to backfill GFX for older builds that were archived before GFX processing was automated.
- Downloads release zipball, extracts PNGs, converts to WebP with `cwebp -preset icon`, and deletes originals.
- See [MIGRATION.md](file:///Users/dmitry/Workspace/C-BN/cbn-data/MIGRATION.md) for usage details.

#### Launchers (`pull-data-launcher.js`, `prune-data-launcher.js`)
Thin ESM wrappers that:
- Create an `Octokit` instance using `process.env.GITHUB_TOKEN`
- Construct a minimal `context` (`{ repo: { owner: "ushkinaz", repo: "cbn-data" } }`)
- Call the corresponding `run` function with `dryRun` derived from whether `GITHUB_TOKEN` is set

#### Tests (`tests/`)
- `tests/test-retention.mjs` imports `applyRetentionPolicy` from `../prune-data.mjs` and validates:
  - All stable releases are always kept
  - All recent builds (<30 days) are kept
  - Retention behavior is stable across multiple simulated days
  - Builds do not flip between kept/removed across runs
  - Builds missing dates are always kept
- `tests/README.md` documents copying the tests into another branch to validate changes to `prune-data.mjs` there

## Coding conventions
- Preserve ESM (`"type": "module"`) and existing `// @ts-check` headers and JSDoc typings when editing or adding modules
- Prefer small, reusable helpers (like `GitHubHelper`) over inlining complex logic into workflows or scripts
- Keep logging concise (imperative sentences, no trailing punctuation) to match the current scripts
- Reuse existing dependencies (`adm-zip`, `minimatch`, `po2json`, `octokit`, `pinyin`) instead of adding new heavy packages when possible
- Maintain the `dryRun` behavior in automation entrypoints so local runs and CI diagnostics do not mutate data branches when `GITHUB_TOKEN` is absent
- When changing how workflows interact with data branches, honor the separation between the `action` workspace root and the data checkout directory (e.g. `data_workspace/`) and ensure all filesystem and git paths line up with that model

## Documentation and housekeeping
- Update README.md or in-file comments when behavior or inputs change; keep explanations minimal and actionable
- Keep commit messages and PR summaries focused on the observable change (what changed and why) rather than implementation minutiae
