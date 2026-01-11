// @ts-check
/**
 * Data Backfill Script
 * 
 * Backfills GFX files for old builds, converts PNGs to WebP, and precompresses JSON files.
 * 
 * Prerequisites:
 *   - brew install webp brotli  (macOS)
 *   - sudo apt-get install webp brotli  (Linux)
 *   - yarn install --frozen-lockfile --ignore-engines
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
 *   3. Downloads release zipballs (if GFX needed)
 *   4. Extracts GFX, converts PNG→WebP (if GFX needed)
 *   5. Deletes original PNGs
 *   6. Precompresses JSON with Brotli, renames to .json (if compression needed)
 *   Note: Final .json files are Brotli-compressed (Cloudflare-compatible)
 * 
 * After migration:
 *   cd data_workspace
 *   git status
 *   git add -A && git commit -m "Backfill GFX (WebP) and precompress JSON"
 *   git push origin main
 */

import AdmZip from "adm-zip";
import minimatch from "minimatch";
import { Octokit } from "octokit";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

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
 * Execute a shell command
 * @param {string} cmd
 * @param {object} options
 */
function exec(cmd, options = {}) {
    try {
        const result = execSync(cmd, {
            encoding: "utf8",
            stdio: options.silent ? "pipe" : "inherit",
            ...options,
        });
        return result;
    } catch (error) {
        if (!options.ignoreError) {
            throw error;
        }
        return null;
    }
}

/**
 * Strip 'gfx/' prefix from file path
 * @param {string} filePath
 */
function stripGfxPrefix(filePath) {
    return filePath.startsWith("gfx/") ? filePath.slice(4) : filePath;
}

/**
 * Write file to disk, creating parent directories as needed
 * @param {string} baseDir
 * @param {string} relativePath
 * @param {Buffer} content
 */
function writeFile(baseDir, relativePath, content) {
    const fullPath = path.join(baseDir, relativePath);
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content);
}

/**
 * Get existing builds from builds.json
 * @param {string} workspaceDir
 */
function getExistingBuilds(workspaceDir) {
    const buildsPath = path.join(workspaceDir, "builds.json");
    if (fs.existsSync(buildsPath)) {
        return JSON.parse(fs.readFileSync(buildsPath, "utf8"));
    }
    return [];
}

/**
 * Check if a build has GFX files
 * @param {string} workspaceDir
 * @param {string} buildTag
 */
function hasGfxFiles(workspaceDir, buildTag) {
    const gfxDir = path.join(workspaceDir, "data", buildTag, "gfx");
    if (!fs.existsSync(gfxDir)) {
        return false;
    }

    // Check if directory has any files (recursively)
    const files = exec(`find "${gfxDir}" -type f`, { silent: true, ignoreError: true });
    return files && files.trim().length > 0;
}

/**
 * Check if a build has precompressed JSON files
 * @param {string} workspaceDir
 * @param {string} buildTag
 */
function hasCompressedJson(workspaceDir, buildTag) {
    const buildDir = path.join(workspaceDir, "data", buildTag);
    if (!fs.existsSync(buildDir)) {
        return false;
    }

    // Check for .compressed marker file (new strategy)
    const markerPath = path.join(buildDir, ".compressed");
    if (fs.existsSync(markerPath)) {
        return true;
    }

    // Fallback: Use brotli -t to check if JSON files are compressed
    const allJsonPath = path.join(buildDir, "all.json");
    if (!fs.existsSync(allJsonPath)) {
        return false;
    }

    try {
        // Use brotli -t to test if the file is a valid Brotli stream
        execSync(`brotli -t "${allJsonPath}"`, { stdio: "ignore" });
        return true;
    } catch (error) {
        return false;
    }
}


/**
 * Create glob function for zip file
 * @param {Buffer} zipBuffer
 */
function createGlobFn(zipBuffer) {
    const z = new AdmZip(zipBuffer);
    return function* glob(pattern) {
        for (const f of z.getEntries()) {
            if (f.isDirectory) continue;
            if (minimatch(f.entryName, pattern)) {
                yield {
                    name: f.entryName.replaceAll("\\", "/").split("/").slice(1).join("/"),
                    raw: () => f.getData(),
                };
            }
        }
    };
}

/**
 * Convert PNG to WebP
 * @param {string} pngPath
 * @param {boolean} dryRun
 * @returns {boolean} success
 */
function convertToWebp(pngPath, dryRun) {
    const webpPath = pngPath.replace(/\.png$/, ".webp");

    if (dryRun) {
        return true;
    }

    try {
        exec(`cwebp -preset icon "${pngPath}" -o "${webpPath}"`, { silent: true });
        fs.unlinkSync(pngPath);
        return true;
    } catch (error) {
        console.error(`    ⚠️  Failed to convert: ${path.basename(pngPath)}`);
        return false;
    }
}

/**
 * Download and extract GFX for a build
 * @param {Octokit} github
 * @param {string} buildTag
 * @param {string} targetDir
 * @param {boolean} dryRun
 */
async function downloadAndExtractGfx(github, buildTag, targetDir, dryRun) {
    console.log(`  📥 Downloading zipball for ${buildTag}...`);

    if (dryRun) {
        console.log(`  [DRY RUN] Would download and extract GFX`);
        return { extracted: 0, converted: 0, failed: 0 };
    }

    try {
        const { data: zip } = await github.rest.repos.downloadZipballArchive({
            owner: "cataclysmbn",
            repo: "Cataclysm-BN",
            ref: buildTag,
        });

        // @ts-ignore
        const zipBuffer = Buffer.from(zip);
        const globFn = createGlobFn(zipBuffer);

        let extracted = 0;
        let converted = 0;
        let failed = 0;

        // Extract GFX files
        const gfxEntries = [...globFn("*/gfx/**/*")];

        if (gfxEntries.length === 0) {
            console.log(`  ⚠️  No GFX files found in release`);
            return { extracted: 0, converted: 0, failed: 0 };
        }

        console.log(`  📦 Extracting ${gfxEntries.length} GFX files...`);

        for (const entry of gfxEntries) {
            const relPath = stripGfxPrefix(entry.name);
            const isPng = relPath.toLowerCase().endsWith(".png");

            if (isPng) {
                // Write PNG temporarily, then convert to WebP
                const tempPngPath = path.join(targetDir, "gfx", relPath);
                writeFile(targetDir, `gfx/${relPath}`, entry.raw());
                extracted++;

                if (convertToWebp(tempPngPath, false)) {
                    converted++;
                } else {
                    failed++;
                }
            } else {
                // Non-PNG files (like JSON tileset configs) - minify JSON files to reduce size
                const isJson = relPath.toLowerCase().endsWith(".json");
                if (isJson) {
                    const jsonContent = JSON.stringify(JSON.parse(entry.raw().toString("utf8")));
                    writeFile(targetDir, `gfx/${relPath}`, Buffer.from(jsonContent, "utf8"));
                } else {
                    writeFile(targetDir, `gfx/${relPath}`, entry.raw());
                }
                extracted++;
            }
        }

        console.log(`  ✅ Extracted ${extracted} files, converted ${converted} PNGs to WebP`);
        if (failed > 0) {
            console.log(`  ⚠️  Failed to convert ${failed} PNGs`);
        }

        return { extracted, converted, failed };
    } catch (error) {
        console.error(`  ❌ Error downloading/extracting: ${error.message}`);
        return { extracted: 0, converted: 0, failed: 0 };
    }
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
        console.error("   You can create a token at: https://github.com/settings/tokens");
        console.error("   Only 'public_repo' scope is needed\n");
        process.exit(1);
    }

    const github = new Octokit({ auth: token });

    // Initialize or update the workspace using git worktree
    const worktreeExists = fs.existsSync(DEFAULT_WORKSPACE);
    const isWorktree = worktreeExists && fs.existsSync(path.join(DEFAULT_WORKSPACE, ".git"));

    if (!worktreeExists) {
        console.log("📥 Creating git worktree for data branch...");
        exec(`git worktree add ${DEFAULT_WORKSPACE} ${branch}`);
        console.log("✅ Worktree created\n");
    } else if (!isWorktree) {
        console.error(`❌ Error: ${DEFAULT_WORKSPACE} exists but is not a git worktree`);
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

    // Filter builds missing GFX or compressed JSON (unless --force is used)
    let buildsToPprocess = builds
        .filter(b => !specificBuild || b.build_number === specificBuild)
        .filter(b => force || !hasGfxFiles(DEFAULT_WORKSPACE, b.build_number) || !hasCompressedJson(DEFAULT_WORKSPACE, b.build_number));

    if (buildsToPprocess.length === 0) {
        if (specificBuild) {
            console.log(`ℹ️  Build ${specificBuild} is already complete or doesn't exist.`);
        } else {
            console.log("ℹ️  All builds are already complete. Nothing to do.");
        }
        return;
    }

    console.log(`🔍 Found ${buildsToPprocess.length} builds needing migration:\n`);
    for (const build of buildsToPprocess) {
        console.log(`   - ${build.build_number}`);
    }
    console.log("");

    // Process each build
    let totalExtracted = 0;
    let totalConverted = 0;
    let totalFailed = 0;

    for (const build of buildsToPprocess) {
        console.log(`📦 Processing ${build.build_number}`);
        const targetDir = path.join(DEFAULT_WORKSPACE, "data", build.build_number);

        const needsGfx = force || !hasGfxFiles(DEFAULT_WORKSPACE, build.build_number);

        if (needsGfx) {
            const stats = await downloadAndExtractGfx(
                github,
                build.build_number,
                targetDir,
                dryRun
            );

            totalExtracted += stats.extracted;
            totalConverted += stats.converted;
            totalFailed += stats.failed;
        } else {
            console.log(`  ✓ GFX already exists, skipping download`);
        }

        console.log("");
    }

    // Summary
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📊 Summary:");
    console.log(`   Builds processed: ${buildsToPprocess.length}`);
    console.log(`   Files extracted: ${totalExtracted}`);
    console.log(`   PNGs converted to WebP: ${totalConverted}`);
    if (totalFailed > 0) {
        console.log(`   Failed conversions: ${totalFailed}`);
    }
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    // Precompress JSON files (independent of GFX processing)
    if (!dryRun) {
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log("🗜️  Precompressing JSON files (Brotli → JSON)");
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

        let jsonCount = 0;
        let compressedCount = 0;

        // Check if brotli is available
        const hasBrotli = exec("which brotli", { silent: true, ignoreError: true });

        if (!hasBrotli) {
            console.error("❌ Error: brotli not found. Please install Brotli:");
            console.error("   macOS: brew install brotli");
            console.error("   Linux: sudo apt-get install brotli");
            process.exit(1);
        }

        for (const build of buildsToPprocess) {
            const needsCompression = force || !hasCompressedJson(DEFAULT_WORKSPACE, build.build_number);

            if (!needsCompression) {
                continue; // Skip builds that already have compressed files
            }

            const buildDir = path.join(DEFAULT_WORKSPACE, "data", build.build_number);

            // Find all JSON files in this build
            const findResult = exec(`find "${buildDir}" -type f -name "*.json" 2>/dev/null`, {
                silent: true,
                ignoreError: true
            });

            if (!findResult) continue;

            const jsonFiles = findResult.trim().split("\n").filter(f => f);

            for (const jsonFile of jsonFiles) {
                jsonCount++;

                // Brotli compression (quality 11 = maximum)
                try {
                    exec(`brotli -q 11 -k -f "${jsonFile}"`, { silent: true });

                    // Rename the compressed .br file to replace the original .json
                    const brFile = `${jsonFile}.br`;
                    if (fs.existsSync(brFile)) {
                        fs.renameSync(brFile, jsonFile);
                        compressedCount++;
                    }
                } catch (e) {
                // Ignore errors
                }

                if (jsonCount % 10 === 0) {
                    process.stdout.write(`\r  📄 Processed ${jsonCount} JSON files...`);
                }
            }

            // After successfully compressing all JSON files in the build, create marker
            if (!dryRun) {
                fs.writeFileSync(path.join(buildDir, ".compressed"), "true");
            }
        }

        // Clear progress line
        if (jsonCount > 0) {
            process.stdout.write("\r" + " ".repeat(80) + "\r");
        }

        console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log("📊 Compression Summary:");
        console.log(`   JSON files found: ${jsonCount}`);
        console.log(`   Brotli compressed: ${compressedCount}`);
        console.log(`   ℹ️  Files are now Brotli-compressed .json`);
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    }

    if (dryRun) {
        console.log("ℹ️  This was a DRY RUN. No files were modified.");
        console.log("   Run without --dry-run to perform actual migration.\n");
        return;
    }

    // Show git status and next steps
    if (totalExtracted > 0) {
        console.log("📋 Git Status:");
        exec(`git -C ${DEFAULT_WORKSPACE} status --short`);
        console.log("");

        console.log("✅ Migration complete!");
        console.log("\nNext steps:");
        console.log(`   1. Review changes: cd ${DEFAULT_WORKSPACE} && git status`);
        console.log(`   2. Commit changes: cd ${DEFAULT_WORKSPACE} && git add -A && git commit -m "Add missing GFX files (WebP)"`);
        console.log(`   3. Push to remote: cd ${DEFAULT_WORKSPACE} && git push origin ${branch}`);
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
