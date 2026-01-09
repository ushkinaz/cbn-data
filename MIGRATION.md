# GFX Migration Script

## Purpose

This script fetches missing GFX files for old builds in the `cbn-data` repository and converts them to WebP format. It's designed to be run locally to add GFX assets to historical builds that were created before GFX was included in the data branch.

## Prerequisites

### 1. Install WebP Tools

**macOS:**
```bash
brew install webp
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt-get update && sudo apt-get install -y webp
```

### 2. GitHub Token

You need a GitHub personal access token to download release zipballs:

1. Create a token at: https://github.com/settings/tokens
2. Only `public_repo` scope is needed (or no scopes for public repos)
3. Export it as an environment variable:
   ```bash
   export GITHUB_TOKEN=your_token_here
   ```

### 3. Install Dependencies

The script uses dependencies already in `package.json`:

```bash
cd /Users/dmitry/Workspace/C-BN/cbn-data
yarn install --frozen-lockfile --ignore-engines
```

## Usage

### Dry Run (Recommended First)

Always start with a dry run to see what would be downloaded:

```bash
export GITHUB_TOKEN=your_token_here
node migrate-gfx.mjs --dry-run
```

This will:
- Check out the main branch into `data_workspace/`
- Read `builds.json` to find existing builds
- Identify which builds are missing GFX files
- Report what would be downloaded
- **Not make any changes**

### Live Migration

Once you've reviewed the dry-run output, run the actual migration:

```bash
export GITHUB_TOKEN=your_token_here
node migrate-gfx.mjs
```

### Force Update

To force update and re-optimize GFX even if they already exist:

```bash
export GITHUB_TOKEN=your_token_here
node migrate-gfx.mjs --force
```

### Custom Branch

To migrate a different branch (e.g., `dev`):

```bash
export GITHUB_TOKEN=your_token_here
node migrate-gfx.mjs --branch=dev
```

### Single Build (Testing)

To process a specific build only:

```bash
export GITHUB_TOKEN=your_token_here
node migrate-gfx.mjs --build=2024-01-01
```

Combine options:

```bash
export GITHUB_TOKEN=your_token_here
node migrate-gfx.mjs --dry-run --build=2024-01-01
```

## What It Does

The script performs the following steps:

1. **Workspace Setup**: Creates or updates `data_workspace/` directory with the target branch
2. **Tool Checks**: Verifies that `cwebp` is installed and `GITHUB_TOKEN` is set
3. **Build Analysis**: Reads `builds.json` and identifies builds missing GFX (or all builds if `--force` is used)
4. **Download**: For each build, downloads the release zipball from `cataclysmbn/Cataclysm-BN`
5. **Extract**: Extracts all files matching `*/gfx/**/*` from the zipball
6. **Convert**: Converts PNG files to WebP using `cwebp -preset icon` (optimized for tilesets/icons)
7. **Cleanup**: Deletes original PNG files after successful conversion
8. **Non-PNG Files**: Copies other GFX files (like JSON tileset configs) as-is
9. **Git Prep**: Shows git status and next steps for committing

## Output Example

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔄 GFX Migration Script
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Branch: main
Workspace: data_workspace
Mode: LIVE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📥 Updating existing workspace...
✅ Workspace updated

📦 Found 73 builds in builds.json

🔍 Found 45 builds missing GFX:

   - 2024-01-01
   - 2024-01-02
   ...

📦 Processing 2024-01-01
  📥 Downloading zipball for 2024-01-01...
  📦 Extracting 234 GFX files...
  ✅ Extracted 234 files, converted 189 PNGs to WebP

📦 Processing 2024-01-02
  📥 Downloading zipball for 2024-01-02...
  📦 Extracting 234 GFX files...
  ✅ Extracted 234 files, converted 189 PNGs to WebP

...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Summary:
   Builds processed: 45
   Files extracted: 10530
   PNGs converted to WebP: 8505
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 Git Status:
...

✅ Migration complete!

Next steps:
   1. Review changes: cd data_workspace && git status
   2. Commit changes: cd data_workspace && git add -A && git commit -m "Add missing GFX files (WebP)"
   3. Push to remote: cd data_workspace && git push origin main
```

## After Migration

Once the script completes:

1. **Review the changes**:
   ```bash
   cd data_workspace
   git status
   git diff --stat
   ```

2. **Commit the changes**:
   ```bash
   git add -A
   git commit -m "Add missing GFX files (WebP)"
   ```

3. **Push to remote**:
   ```bash
   git push origin main
   ```

## Troubleshooting

### "GITHUB_TOKEN environment variable is required"

Set the token before running:
```bash
export GITHUB_TOKEN=your_token_here
```

### "cwebp not found"

Install WebP tools as described in Prerequisites.

### "No builds found"

Ensure `builds.json` exists in the workspace. The script needs to check out the data branch first.

### Rate limiting

If you're processing many builds, GitHub API may rate-limit you. The token helps, but you may need to wait if you hit limits.

### Large downloads

Each zipball is ~50-100MB. Processing many builds will download significant data. Ensure you have enough disk space and bandwidth.

## Technical Details

### WebP Conversion Settings

- **Preset**: `icon` - Optimized for graphics with sharp edges and solid colors (perfect for tilesets)
- **No quality parameter**: The `icon` preset handles quality optimization automatically
- Better compression and faster encoding than generic quality settings

### What Gets Converted

- **PNG files**: Converted to WebP with `-preset icon`, originals deleted
- **Other files**: JSON tileset configs, metadata files - copied as-is
- **No GFX**: If a release has no `gfx/` directory, it's skipped with a warning

### Idempotency

The script is safe to run multiple times:
- Builds that already have GFX are skipped
- You can use `--build=TAG` to retry a specific build
- No duplicate work or file corruption

## Notes

- The script only processes builds listed in `builds.json`
- It automatically skips builds that already have GFX files
- Uses the same GFX extraction logic as `pull-data.mjs` for consistency
- Downloads are temporary - only the final WebP files are kept
