# Developer Guide

Mirrors JSON, translation, and GFX data from Cataclysm: Bright Nights → [cbn-data.pages.dev](https://cbn-data.pages.dev/)

## Repository Structure

**Orphan branches:**
- `action` - Scripts, workflows, config
- `main`/`dev` - Generated data snapshots

Data branches checked out to `data_workspace/` in workflows. Never commit generated data to `action`.

## Install

```bash
yarn install --frozen-lockfile --ignore-engines
```

## Common Commands

```bash
# Run tests
yarn test
```
```bash
# Pull data (dry-run)
node pull-data-launcher.js
```
```bash
# Pull data (live)
GITHUB_TOKEN=xxx node pull-data-launcher.js
```
```bash
# Prune data (dry-run)
node prune-data-launcher.js
```
```bash
# Prune data (live)
GITHUB_TOKEN=xxx node prune-data-launcher.js
```
```bash
# Backfill data (see script header for full docs)
GITHUB_TOKEN=xxx node backfill-data.mjs --dry-run
GITHUB_TOKEN=xxx node backfill-data.mjs
```

## Key Scripts

### `pull-data.mjs`
Ingests upstream releases → writes data snapshots.

**Does:**
- Downloads zipballs from cataclysmbn/Cataclysm-BN
- Extracts JSON (`all.json`), mods (`all_mods.json`), translations (`lang/*.json`)
- For Chinese: generates pinyin variants
- Extracts GFX assets
- Writes to filesystem (workflow handles WebP conversion + Brotli compression)

**Doesn't:**
- Commit (workflow does this)
- Convert GFX (workflow does PNG→WebP)
- Compress JSON (workflow does Brotli compression)

### `prune-data.mjs`
Applies retention policy, removes old builds.

**Retention rules:**
- Keep all stable releases
- Keep all builds <30 days
- Thinning schedule >30 days:
  - 30-90d: every 2 days
  - 90-180d: every 4 days
  - 180-450d: every 8 days
- Drop builds >450 days

Runs monthly. Creates backup branch before squashing history.

### `backfill-data.mjs`
Backfills missing GFX + Brotli-compresses JSON for old builds.

**Independent processes:**
- Downloads/converts GFX only if missing WebP
- Brotli-compresses JSON only if not already compressed

See script header (`node backfill-data.mjs`) for full documentation.

### `pinyin.mjs`
Generates pinyin mappings for Chinese translations using the `pinyin` package.

## Workflows

### `.github/workflows/pull-data.yml`
**Schedule:** Every 12 hours  
**Runs:**
1. Checkout action + data branches
2. Run `pull-data.mjs`
3. Install compression tools (webp, brotli)
4. Convert PNG→WebP
5. Brotli-compress JSON (replaces .json files with compressed versions)
6. Commit + push to data branch

### `.github/workflows/prune-data.yml`
**Schedule:** Monthly (12th at 02:00 UTC)  
**Runs:**
1. Apply retention policy
2. Delete old builds
3. Create backup branch
4. Squash history
5. Force push

## Testing

**`tests/test-retention.mjs`** validates pruning logic:
- Stable releases always kept
- Recent builds (<30d) kept
- Thinning applied correctly
- Retention stable across days

## Data Structure

```
data_workspace/
├── builds.json              # Build metadata (Brotli-compressed)
└── data/
    └── 2024-01-10/
        ├── all.json         # Game objects (Brotli-compressed)
        ├── all_mods.json    # Mod data (Brotli-compressed)
        ├── lang/            # Translations (Brotli-compressed)
        │   ├── fr.json
        │   ├── zh_CN.json
        │   └── zh_CN_pinyin.json
        └── gfx/             # WebP graphics
```

**Note:** All `.json` files are actually Brotli-compressed. The `_headers` file 
instructs Cloudflare to serve them with `Content-Encoding: br`.

## Deployment

Cloudflare Pages deploys directly from `main` branch.

**Compression Strategy:**
Cloudflare Pages cannot automatically serve `.br` files with proper encoding headers.
Workaround: All JSON files are Brotli-compressed but saved as `.json` (without extension).
The `_headers` file declares `Content-Encoding: br` for all `.json` files.

This achieves ~90% smaller file sizes while maintaining compatibility.

## Contributing

Built for [The Hitchhiker's Guide to Cataclysm: Bright Nights](https://cbn-guide.pages.dev/).

Questions? Check script headers or workflow comments.
