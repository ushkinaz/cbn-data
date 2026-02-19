// @ts-check
/**
 * Data Backfill Script
 * 
 * Backfills GFX files for old builds, converts PNGs to WebP, and precompresses JSON files.
 * 
 * Prerequisites:
 *   - brew install webp brotli  (macOS)
 *   - sudo apt-get install webp brotli  (Linux)
 *   - pnpm install --frozen-lockfile --ignore-engines
 *   - export GITHUB_TOKEN=your_token_here
 * 
 * Usage:
 *   node backfill-data.mjs --dry-run              # Test run (recommended first)
 *   node backfill-data.mjs                        # Live migration
 *   node backfill-data.mjs --force                # Force re-process
 *   node backfill-data.mjs --build=2024-01-10     # Specific build
 *   node backfill-data.mjs --branch=dev           # Custom branch
 * 
 * What it does:
 *   1. Creates/updates git worktree for target branch in data_workspace/
 *   2. Finds builds missing GFX or compressed JSON
 *   3. Downloads release zipballs (if zip-derived steps are needed)
 *   4. Extracts GFX, converts PNG→WebP (if GFX needed)
 *   5. Deletes original PNGs
 *   6. Precompresses JSON with Brotli, renames to .json (if compression needed)
 *   7. Logs per-step progress for long-running steps
 *   Note: Final .json files are Brotli-compressed (Cloudflare-compatible)
 * 
 * After migration:
 *   cd data_workspace
 *   git status
 *   git add -A && git commit -m "Backfill GFX (WebP) and precompress JSON"
 *   git push origin main
 */

import { Octokit } from "octokit";
import fs from "fs";
import path from "path";
import {
  exec,
  getExistingBuilds,
  isCompressed,
  updateSymlinks,
  processLangs,
  collateAllJson,
  processMods,
  processBaseGfx,
  compressJsonFiles,
  extractExternalTilesets,
  createGlobFn,
} from "./pipeline.mjs";

/** @type {string[]} */
const forbiddenTags = [];

const DEFAULT_BRANCH = "main";
const DEFAULT_WORKSPACE = "data_workspace";

/**
 * Parse command line arguments
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const dryRun = args.includes("--dry-run");
    const force = args.includes("--force");
    const branchArg = args.find(arg => arg.startsWith("--branch="));
    const branch = branchArg ? branchArg.split("=")[1] : DEFAULT_BRANCH;
    const buildArg = args.find(arg => arg.startsWith("--build="));
    const specificBuild = buildArg ? buildArg.split("=")[1] : null;
    return { dryRun, branch, force, specificBuild };
}

/**
 * Check if a build has translation files
 * @param {string} workspaceDir
 * @param {string} buildTag
 */
function hasLangs(workspaceDir, buildTag) {
  const langDir = path.join(workspaceDir, "data", buildTag, "lang");
  const langFiles = exec(
    `find "${langDir}" -type f -name "*.json" 2>/dev/null`,
    {
      silent: true,
      ignoreError: true,
    },
  );
  return !!(langFiles && String(langFiles).trim().length > 0);
}

/**
 * Check if a build has GFX files
 * @param {string} workspaceDir
 * @param {string} buildTag
 */
function hasGfxFiles(workspaceDir, buildTag) {
  const gfxDir = path.join(workspaceDir, "data", buildTag, "gfx");
  const modsDir = path.join(workspaceDir, "data", buildTag, "mods");

  // Consider a build complete only when both base gfx and mod assets exist.
  const gfxFiles = exec(`find "${gfxDir}" -type f 2>/dev/null`, {
    silent: true,
    ignoreError: true,
  });
  const hasBaseGfx = !!(gfxFiles && String(gfxFiles).trim().length > 0);

  const modFiles = exec(`find "${modsDir}" -type f 2>/dev/null`, {
    silent: true,
    ignoreError: true,
  });
  const hasModAssets = !!(modFiles && String(modFiles).trim().length > 0);

  return hasBaseGfx && hasModAssets;
}

/**
 * Check if a build has external tileset assets
 * @param {string} workspaceDir
 * @param {string} buildTag
 */
function hasExternalTilesets(workspaceDir, buildTag) {
  const externalDir = path.join(
    workspaceDir,
    "data",
    buildTag,
    "gfx",
    "external_tileset",
  );
  const externalFiles = exec(`find "${externalDir}" -type f 2>/dev/null`, {
    silent: true,
    ignoreError: true,
  });
  return !!(externalFiles && String(externalFiles).trim().length > 0);
}

function listJsonFiles(buildDir) {
  const findResult = exec(
    `find "${buildDir}" -type f -name "*.json" 2>/dev/null`,
    { silent: true, ignoreError: true },
  );

  if (!findResult) return [];

  return String(findResult)
    .trim()
    .split("\n")
    .filter((f) => f);
}

function allJsonCompressed(buildDir) {
  const jsonFiles = listJsonFiles(buildDir);
  if (jsonFiles.length === 0) return false;

  // If ANY file is not compressed, the whole build is not "fully compressed"
  for (const f of jsonFiles) {
    if (!isCompressed(f)) return false;
  }

  return true;
}

/**
 * Check if a build has precompressed JSON files
 * @param {string} workspaceDir
 * @param {string} buildTag
 */
function hasCompressedJson(workspaceDir, buildTag) {
  const buildDir = path.join(workspaceDir, "data", buildTag);
  if (!fs.existsSync(buildDir)) return false;

  return allJsonCompressed(buildDir);
}

/**
 * Check if a build has all_mods.json
 * @param {string} workspaceDir
 * @param {string} buildTag
 */
function hasAllModsJson(workspaceDir, buildTag) {
  return fs.existsSync(
    path.join(workspaceDir, "data", buildTag, "all_mods.json"),
  );
}

/**
 * Check if a build has all.json
 * @param {string} workspaceDir
 * @param {string} buildTag
 */
function hasAllJson(workspaceDir, buildTag) {
  return fs.existsSync(path.join(workspaceDir, "data", buildTag, "all.json"));
}


/**
 * Main migration function
 */
async function migrate() {
  const { dryRun, branch, force, specificBuild } = parseArgs();

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🔄 Data Backfill Script");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Branch: ${branch}`);
  console.log(`Workspace: ${DEFAULT_WORKSPACE}`);
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
  if (force) {
    console.log(`Force: true (overwriting existing GFX)`);
  }
  if (specificBuild) {
    console.log(`Target: ${specificBuild} only`);
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Check for GitHub token
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("❌ Error: GITHUB_TOKEN environment variable is required");
    console.error("   Set it with: export GITHUB_TOKEN=your_token_here");
    console.error(
      "   You can create a token at: https://github.com/settings/tokens",
    );
    console.error("   Only 'public_repo' scope is needed\n");
    process.exit(1);
  }

  const github = new Octokit({ auth: token });

  // Initialize or update the workspace using git worktree
  const worktreeExists = fs.existsSync(DEFAULT_WORKSPACE);
  const isWorktree =
    worktreeExists && fs.existsSync(path.join(DEFAULT_WORKSPACE, ".git"));

  if (!worktreeExists) {
    console.log("📥 Creating git worktree for data branch...");
    exec(`git worktree add ${DEFAULT_WORKSPACE} ${branch}`);
    console.log("✅ Worktree created\n");
  } else if (!isWorktree) {
    console.error(
      `❌ Error: ${DEFAULT_WORKSPACE} exists but is not a git worktree`,
    );
    console.error(`   Please remove it or use a different workspace directory`);
    process.exit(1);
  } else {
    console.log("📥 Updating existing worktree...");
    exec(`git -C ${DEFAULT_WORKSPACE} fetch origin ${branch}`);
    exec(`git -C ${DEFAULT_WORKSPACE} reset --hard origin/${branch}`);
    console.log("✅ Worktree updated\n");
  }

  // Check if webp tools are installed
  try {
    exec("which cwebp", { silent: true });
  } catch (error) {
    console.error("❌ Error: cwebp not found. Please install WebP tools:");
    console.error("   macOS: brew install webp");
    console.error("   Linux: sudo apt-get install webp");
    process.exit(1);
  }

  // Read builds.json
  const builds = getExistingBuilds(DEFAULT_WORKSPACE);
  console.log(`📦 Found ${builds.length} builds in builds.json\n`);

  if (builds.length === 0) {
    console.log("ℹ️  No builds found. Nothing to do.");
    return;
  }

  // No pre-filtering of buildsToProcess anymore.
  // We will iterate one-by-one and decide.
  const buildsToProcess = builds.filter(
    (/** @type {any} */ b) =>
      !specificBuild || b.build_number === specificBuild,
  );

  console.log(`🔍 Checking ${buildsToProcess.length} builds for updates...\n`);

  // Process each build
  let totalExtracted = 0;
  let totalConverted = 0;
  let totalFailed = 0;
  let totalJsonGenerated = 0;
  let totalJsonCompressed = 0;
  let buildsProcessed = 0;

  for (const build of buildsToProcess) {
    if (forbiddenTags.includes(build.build_number)) {
      continue;
    }

    const pathBase = `data/${build.build_number}`;
    const buildDir = path.join(DEFAULT_WORKSPACE, pathBase);

    const needs = {
      GFX: force || !hasGfxFiles(DEFAULT_WORKSPACE, build.build_number),
      JSON:
        force ||
        !hasAllModsJson(DEFAULT_WORKSPACE, build.build_number) ||
        !hasAllJson(DEFAULT_WORKSPACE, build.build_number),
      Langs: force || !hasLangs(DEFAULT_WORKSPACE, build.build_number),
      ETS: force || !hasExternalTilesets(DEFAULT_WORKSPACE, build.build_number),
      Compression:
        force || !hasCompressedJson(DEFAULT_WORKSPACE, build.build_number),
    };

    const needsArray = Object.entries(needs)
      .filter(([_, value]) => value)
      .map(([key, _]) => key);

    if (needsArray.length === 0) {
      console.log(`  ⏭️  Skipping ${build.build_number} (already up-to-date)`);
      continue;
    }

    buildsProcessed++;
    console.group(`📦 Processing ${build.build_number}`);
    console.log(`  Needs: ${needsArray.join(", ")}`);

    const {
      GFX: needsGfx,
      JSON: needsJson,
      Langs: needsLangs,
      ETS: needsExternalTilesets,
      Compression: needsCompression,
    } = needs;

    if (needsGfx || needsJson || needsLangs || needsExternalTilesets) {
      console.log(
        `  📥 Downloading zipball (needed for: ${needsArray.filter((n) => n !== "Compression").join(", ")})`,
      );
      const { data: zip } = await github.rest.repos.downloadZipballArchive({
        owner: "cataclysmbn",
        repo: "Cataclysm-BN",
        ref: build.build_number,
      });
      const globFn = createGlobFn(Buffer.from(/** @type {any} */ (zip)));

      let releaseData = null;
      if (needsJson || needsLangs) {
        try {
          const { data: rel } = await github.rest.repos.getReleaseByTag({
            owner: "cataclysmbn",
            repo: "Cataclysm-BN",
            tag: build.build_number,
          });
          releaseData = rel;
        } catch (e) {}
      }

      /** @type {any[] | null} */
      let data = null;
      /** @type {Record<string, any> | null} */
      let dataMods = null;
      let modStats = null;

      if (needsJson) {
        console.log("  🧩 Generating JSON bundles...");
        modStats = processMods(globFn, buildDir, dryRun, {
          extractAssets: needsGfx,
          convertGfx: needsGfx,
          force,
          writeJson: true,
        });
        dataMods = modStats.dataMods;
        if (needsGfx) {
          totalExtracted += modStats.extracted;
          totalConverted += modStats.converted;
          totalFailed += modStats.failed;
          console.log(
            `    Mods assets: extracted ${modStats.extracted}, converted ${modStats.converted}, failed ${modStats.failed}`,
          );
        }
        const collateRes = collateAllJson(
          globFn,
          buildDir,
          build.build_number,
          releaseData,
          dataMods,
          dryRun,
        );
        data = collateRes.data;
        totalJsonGenerated += 2;
        console.log(`    all.json objects: ${collateRes.count}`);
      } else if (needsGfx) {
        console.log("  🧩 Extracting mod assets...");
        modStats = processMods(globFn, buildDir, dryRun, {
          extractAssets: true,
          convertGfx: true,
          force,
          writeJson: false,
        });
        dataMods = modStats.dataMods;
        totalExtracted += modStats.extracted;
        totalConverted += modStats.converted;
        totalFailed += modStats.failed;
        console.log(
          `    Mods assets: extracted ${modStats.extracted}, converted ${modStats.converted}, failed ${modStats.failed}`,
        );
      }

      if (needsLangs) {
        console.log("  🌐 Processing translations...");
        if (!data || !dataMods) {
          const langModStats = processMods(globFn, buildDir, true, {
            extractAssets: false,
            writeJson: false,
          });
          dataMods = langModStats.dataMods;
          const collateRes = collateAllJson(
            globFn,
            buildDir,
            build.build_number,
            releaseData,
            dataMods,
            true,
          );
          data = collateRes.data;
        }
        const langRes = await processLangs(globFn, buildDir, dryRun, data);
        console.log(`    Languages: ${langRes.langs.length}`);
      }

      if (needsGfx) {
        console.log("  🎨 Processing base GFX...");
        const stats = processBaseGfx(globFn, buildDir, dryRun, {
          convertGfx: true,
          force,
        });
        totalExtracted += stats.extracted;
        totalConverted += stats.converted;
        totalFailed += stats.failed;
        console.log(
          `    Base GFX: extracted ${stats.extracted}, converted ${stats.converted}, failed ${stats.failed}`,
        );
      }

      if (needsExternalTilesets) {
        console.log("  🧩 Processing external tilesets...");
        const stats = extractExternalTilesets(globFn, buildDir, dryRun, {
          convertPNG: true,
          force,
        });
        totalExtracted += stats.extracted;
        totalConverted += stats.converted;
        totalFailed += stats.failed;
        console.log(
          `    External tilesets: extracted ${stats.extracted}, converted ${stats.converted}, failed ${stats.failed}`,
        );
      }
    }

    if (needsCompression) {
      console.log("  🗜️  Precompressing JSON...");
      const stats = compressJsonFiles(buildDir, dryRun, force);
      totalJsonCompressed += stats.compressedCount;
      console.log(
        `    JSON files: ${stats.jsonCount}, compressed: ${stats.compressedCount}`,
      );
      if (!dryRun && allJsonCompressed(buildDir)) {
        console.log("    Build fully compressed");
      }
    }

    console.groupEnd();
    console.log("");
  }

  // Summary
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📊 Summary:");
  console.log(`   Builds processed: ${buildsProcessed}`);
  console.log(`   Files extracted: ${totalExtracted}`);
  console.log(`   PNGs converted to WebP: ${totalConverted}`);
  if (totalJsonGenerated > 0) {
    console.log(`   JSON files generated: ${totalJsonGenerated}`);
  }
  if (totalJsonCompressed > 0) {
    console.log(`   JSON files compressed: ${totalJsonCompressed}`);
  }
  if (totalFailed > 0) {
    console.log(`   Failed conversions: ${totalFailed}`);
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Files are already handled in the main loop above

  if (dryRun) {
    console.log("ℹ️  This was a DRY RUN. No files were modified.");
    console.log("   Run without --dry-run to perform actual migration.\n");
    return;
  }

  // Show git status and next steps
  if (totalExtracted > 0 || totalJsonGenerated > 0 || totalJsonCompressed > 0) {
    console.log("📋 Git Status:");
    exec(`git -C ${DEFAULT_WORKSPACE} status --short`);
    console.log("");

    // Update semantic symlinks (stable/nightly)
    updateSymlinks(DEFAULT_WORKSPACE, builds, dryRun);

    console.log("✅ Migration complete!");
    console.log("\nNext steps:");
    console.log(`   1. Review changes: cd ${DEFAULT_WORKSPACE} && git status`);
    console.log(
      `   2. Commit changes: cd ${DEFAULT_WORKSPACE} && git add -A && git commit -m "Add missing GFX files (WebP)"`,
    );
    console.log(
      `   3. Push to remote: cd ${DEFAULT_WORKSPACE} && git push origin ${branch}`,
    );
  } else {
    console.log("ℹ️  No files were added.");
  }

  console.log("");
}

// Run the migration
migrate().catch(error => {
    console.error("\n❌ Error during migration:");
    console.error(error.message);
    if (error.stack) {
        console.error(error.stack);
    }
    process.exit(1);
});
