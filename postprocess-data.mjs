// @ts-check
import fs from "fs";
import path from "path";
import {
  exec,
  isCompressed,
  convertToWebp,
  compressJsonFiles,
} from "./pipeline.mjs";

const DEFAULT_WORKSPACE = "data_workspace";

function parseArgs() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");
  const workspaceArg = args.find((arg) => arg.startsWith("--workspace="));
  const workspaceDir = workspaceArg
    ? workspaceArg.split("=")[1]
    : DEFAULT_WORKSPACE;
  return { dryRun, force, workspaceDir };
}

function ensureTool(tool) {
  const found = exec(`which ${tool}`, { silent: true, ignoreError: true });
  if (!found) {
    console.error(`❌ Error: ${tool} not found. Please install it.`);
    process.exit(1);
  }
}

function listFilesByExt(baseDir, ext) {
  if (!fs.existsSync(baseDir)) return [];
  const result = exec(
    `find "${baseDir}" -type f -name "*${ext}" 2>/dev/null`,
    { silent: true, ignoreError: true },
  );
  if (!result) return [];
  return String(result)
    .trim()
    .split("\n")
    .filter((f) => f);
}

function listJsonFiles(buildDir) {
  const result = exec(
    `find "${buildDir}" -type f -name "*.json" 2>/dev/null`,
    { silent: true, ignoreError: true },
  );
  if (!result) return [];
  return String(result)
    .trim()
    .split("\n")
    .filter((f) => f);
}

function allJsonCompressed(buildDir) {
  const jsonFiles = listJsonFiles(buildDir);
  if (jsonFiles.length === 0) return false;
  for (const jsonFile of jsonFiles) {
    if (!isCompressed(jsonFile)) return false;
  }
  return true;
}

function convertPngs(pngFiles, dryRun, force) {
  let converted = 0;
  let failed = 0;
  let skipped = 0;

  for (const pngPath of pngFiles) {
    const webpPath = pngPath.replace(/\.png$/i, ".webp");
    if (!force && fs.existsSync(webpPath)) {
      skipped++;
      continue;
    }
    const ok = convertToWebp(pngPath, dryRun, force);
    if (ok) converted++;
    else failed++;
  }

  return { converted, failed, skipped };
}

async function postprocess() {
  const { dryRun, force, workspaceDir } = parseArgs();

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🔧 Postprocess data workspace");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Workspace: ${workspaceDir}`);
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
  if (force) console.log("Force: true (reprocess all)");
  console.log("");

  if (!dryRun) {
    ensureTool("cwebp");
    ensureTool("brotli");
  }

  const dataDir = path.join(workspaceDir, "data");
  if (!fs.existsSync(dataDir)) {
    console.error(`❌ Error: data directory not found at ${dataDir}`);
    process.exit(1);
  }

  const builds = fs.readdirSync(dataDir).sort();
  let totalConverted = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let totalJsonCount = 0;
  let totalCompressed = 0;

  for (const buildName of builds) {
    if (buildName === "stable" || buildName === "nightly") continue;

    const buildDir = path.join(dataDir, buildName);
    let stats = null;
    try {
      stats = fs.lstatSync(buildDir);
    } catch (e) {
      continue;
    }
    if (!stats.isDirectory() || stats.isSymbolicLink()) continue;

    console.group(`📦 Processing ${buildName}`);

    const gfxDir = path.join(buildDir, "gfx");
    const modsDir = path.join(buildDir, "mods");

    const gfxPngs = listFilesByExt(gfxDir, ".png");
    const modPngs = listFilesByExt(modsDir, ".png");

    if (gfxPngs.length > 0) {
      console.log(`  🎨 Converting base GFX (${gfxPngs.length} PNGs)`);
      const res = convertPngs(gfxPngs, dryRun, force);
      totalConverted += res.converted;
      totalFailed += res.failed;
      totalSkipped += res.skipped;
      console.log(
        `    Converted ${res.converted}, failed ${res.failed}, skipped ${res.skipped}`,
      );
    } else {
      console.log("  🎨 No base GFX PNGs");
    }

    if (modPngs.length > 0) {
      console.log(`  🧩 Converting mod GFX (${modPngs.length} PNGs)`);
      const res = convertPngs(modPngs, dryRun, force);
      totalConverted += res.converted;
      totalFailed += res.failed;
      totalSkipped += res.skipped;
      console.log(
        `    Converted ${res.converted}, failed ${res.failed}, skipped ${res.skipped}`,
      );
    } else {
      console.log("  🧩 No mod PNGs");
    }

    const markerPath = path.join(buildDir, ".compressed");
    if (!force && fs.existsSync(markerPath)) {
      console.log("  🗜️  JSON already compressed (marker present)");
      console.groupEnd();
      console.log("");
      continue;
    }

    console.log("  🗜️  Precompressing JSON...");
    const compressionStats = compressJsonFiles(buildDir, dryRun, force);
    totalJsonCount += compressionStats.jsonCount;
    totalCompressed += compressionStats.compressedCount;
    console.log(
      `    JSON files: ${compressionStats.jsonCount}, compressed: ${compressionStats.compressedCount}`,
    );
    if (!dryRun && allJsonCompressed(buildDir)) {
      fs.writeFileSync(markerPath, "true");
      console.log("    .compressed marker written");
    }

    console.groupEnd();
    console.log("");
  }

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📊 Summary");
  console.log(`  PNG converted: ${totalConverted}`);
  console.log(`  PNG failed: ${totalFailed}`);
  console.log(`  PNG skipped: ${totalSkipped}`);
  console.log(`  JSON found: ${totalJsonCount}`);
  console.log(`  JSON compressed: ${totalCompressed}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

postprocess().catch((error) => {
  console.error("\n❌ Error during postprocess:");
  console.error(error.message);
  if (error.stack) console.error(error.stack);
  process.exit(1);
});
