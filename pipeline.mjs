// @ts-check
import AdmZip from "adm-zip";
import minimatch from "minimatch";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { toPinyin } from "./pinyin.mjs";
import po2json from "po2json";

/**
 * @typedef {Object} ExecOptions
 * @property {boolean} [silent]
 * @property {boolean} [ignoreError]
 * @property {string} [cwd]
 */

/**
 * Execute a shell command
 * @param {string} cmd
 * @param {ExecOptions & import("child_process").ExecSyncOptions} options
 */
export function exec(cmd, options = {}) {
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
 * Breaks a large JSON string into single objects and adds __filename with line numbers.
 * @param {string} str
 */
export function breakJSONIntoSingleObjects(str) {
  const objs = [];
  let depth = 0;
  let line = 1;
  let start = -1;
  let startLine = -1;
  let inString = false;
  let inStringEscSequence = false;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (inString) {
      if (inStringEscSequence) {
        inStringEscSequence = false;
      } else {
        if (c === "\\") inStringEscSequence = true;
        else if (c === '"') inString = false;
      }
    } else {
      if (c === "{") {
        if (depth === 0) {
          start = i;
          startLine = line;
        }
        depth++;
      } else if (c === "}") {
        depth--;
        if (depth === 0) {
          objs.push({
            obj: JSON.parse(str.slice(start, i + 1)),
            start: startLine,
            end: line,
          });
        }
      } else if (c === '"') {
        inString = true;
      } else if (c === "\n") {
        line++;
      }
    }
  }
  return objs;
}

/**
 * Write file to disk, creating parent directories as needed
 * @param {string} baseDir
 * @param {string} relativePath
 * @param {string | Buffer} content
 */
export function writeFile(baseDir, relativePath, content) {
  const fullPath = path.join(baseDir, relativePath);
  const dir = path.dirname(fullPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fullPath, content);
}

/**
 * Get existing builds from builds.json
 * @param {string} workspaceDir
 */
export function getExistingBuilds(workspaceDir) {
  const buildsPath = path.join(workspaceDir, "builds.json");
  if (fs.existsSync(buildsPath)) {
    return JSON.parse(fs.readFileSync(buildsPath, "utf8"));
  }
  return [];
}

/**
 * Strip 'gfx/' prefix from file path if present
 * @param {string} filePath
 * @returns {string} Normalized path without gfx/ prefix
 */
export function stripGfxPrefix(filePath) {
  return filePath.startsWith("gfx/") ? filePath.slice(4) : filePath;
}

/**
 * Create a generator function that yields filtered zip entries
 * @param {Buffer} zipBuffer
 * @returns {(pattern: string) => Generator<{name: string, data: () => string, raw: () => Buffer}>}
 */
export function createGlobFn(zipBuffer) {
  const z = new AdmZip(zipBuffer);
  /** @param {string} pattern */
  function* glob(pattern) {
    for (const f of z.getEntries()) {
      if (f.isDirectory) continue;
      if (minimatch(f.entryName, pattern)) {
        yield {
          name: f.entryName.replaceAll("\\", "/").split("/").slice(1).join("/"),
          data: () => f.getData().toString("utf8"),
          raw: () => f.getData(),
        };
      }
    }
  }
  return glob;
}

/**
 * Check if a file is already compressed using the 'file' utility
 * @param {string} filePath
 */
export function isCompressed(filePath) {
  if (!fs.existsSync(filePath)) return false;
  try {
    // Use brotli -t to test if the file is a valid Brotli stream
    execSync(`brotli -t "${filePath}"`, { stdio: "ignore" });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Convert PNG to WebP
 * @param {string} pngPath
 * @param {boolean} dryRun
 * @param {boolean} [force]
 * @returns {boolean} success
 */
export function convertToWebp(pngPath, dryRun, force = false) {
  const webpPath = pngPath.replace(/\.png$/, ".webp");

  if (fs.existsSync(webpPath) && !force) {
    return true;
  }

  if (dryRun) {
    return true;
  }

  try {
    execSync(`cwebp -preset icon "${pngPath}" -o "${webpPath}"`, {
      stdio: "ignore",
    });
    fs.unlinkSync(pngPath);
    return true;
  } catch (error) {
    console.error(`    ⚠️  Failed to convert: ${path.basename(pngPath)}`);
    return false;
  }
}

/**
 * Clean up po2json output
 * @param {Record<string, any>} jsonData
 */
export function postprocessPoJson(jsonData) {
  /** @type {any} */
  const json = {};
  for (const key in jsonData) {
    if ("" === key) {
      json[""] = {
        language: jsonData[""]["language"],
        "plural-forms": jsonData[""]["plural-forms"],
      };
      continue;
    }
    if ("" !== jsonData[key][1])
      json[key] =
        2 === jsonData[key].length ? jsonData[key][1] : jsonData[key].slice(1);
  }
  return json;
}

/**
 * Extract external tileset assets from source zip
 * @param {ReturnType<createGlobFn>} globFn
 * @param {string} buildDir - Base directory for the build (e.g. data_workspace/data/TAG)
 * @param {boolean} dryRun
 * @param {object} [options]
 * @param {boolean} [options.convertPNG] - Whether to convert PNG to WebP immediately (for backfill script)
 * @param {boolean} [options.force] - Force conversion even if WebP exists
 */
export function extractExternalTilesets(
  globFn,
  buildDir,
  dryRun,
  options = {},
) {
  const { convertPNG = false, force = false } = options;
  const externalGfxEntries = [...globFn("*/data/json/external_tileset/**/*")];

  let extracted = 0;
  let converted = 0;
  let failed = 0;

  if (externalGfxEntries.length > 0) {
    console.log(
      `    🎨 Extracting ${externalGfxEntries.length} external tileset assets...`,
    );
  }

  for (const entry of externalGfxEntries) {
    // entry.name is something like "BN-source-dir/data/json/external_tileset/Aftershock_normal.png"
    // After createGlobFn processing, name is something like "data/json/external_tileset/Aftershock_normal.png"
    const relPath = entry.name.split("/").slice(3).join("/");
    if (!relPath || relPath === "README.md") continue;

    // We only want image assets for external tilesets.
    // metadata (JSON) is already included in all.json compilation.
    const isPng = relPath.toLowerCase().endsWith(".png");
    if (!isPng) continue;

    const targetPath = `gfx/external_tileset/${relPath}`;
    const webpPath = path.join(buildDir, targetPath.replace(/\.png$/, ".webp"));

    if (!dryRun) {
      // Don't write PNG if WebP already exists (saves disk space and prevents git noise)
      if (!fs.existsSync(webpPath) || force) {
        writeFile(buildDir, targetPath, entry.raw());
        extracted++;
        if (convertPNG) {
          if (convertToWebp(path.join(buildDir, targetPath), dryRun, force)) {
            converted++;
          } else {
            failed++;
          }
        }
      }
    }
  }
  return { extracted, converted, failed, count: externalGfxEntries.length };
}

/**
 * Process languages from source zip
 * @param {ReturnType<createGlobFn>} globFn
 * @param {string} buildDir
 * @param {boolean} dryRun
 * @param {any[]} data - All game objects for pinyin mapping
 */
export async function processLangs(globFn, buildDir, dryRun, data) {
  const langs = (
    await Promise.all(
      [...globFn("*/lang/po/*.po")].map(async (f) => {
        const lang = path.basename(f.name, ".po");
        // @ts-ignore
        const json = postprocessPoJson(po2json.parse(f.data()));
        const jsonStr = JSON.stringify(json);

        if (!dryRun) {
          writeFile(buildDir, `lang/${lang}.json`, jsonStr);

          if (lang.startsWith("zh_")) {
            const pinyinMap = toPinyin(data, json);
            const pinyinStr = JSON.stringify(pinyinMap);
            writeFile(buildDir, `lang/${lang}_pinyin.json`, pinyinStr);
          }
        }
        return lang;
      }),
    )
  ).filter(Boolean);
  return { langs };
}

/**
 * Collate all game data into all.json
 * @param {ReturnType<createGlobFn>} globFn
 * @param {string} buildDir
 * @param {string} tag_name
 * @param {any} release
 * @param {Record<string, any>} dataMods - Mod info mapping
 * @param {boolean} dryRun
 */
export function collateAllJson(
  globFn,
  buildDir,
  tag_name,
  release,
  dataMods,
  dryRun,
) {
  const data = [];
  for (const f of globFn("*/data/json/**/*.json")) {
    const filename = f.name;
    const objs = breakJSONIntoSingleObjects(f.data());
    for (const { obj, start, end } of objs) {
      obj.__filename = filename + `#L${start}-L${end}`;
      data.push(obj);
    }
  }

  const allJson = JSON.stringify({
    build_number: tag_name,
    release,
    data,
    mods: Object.fromEntries(
      Object.entries(dataMods).map(([name, mod]) => [name, mod.info]),
    ),
  });

  if (!dryRun) {
    fs.writeFileSync(path.join(buildDir, "all.json"), allJson);
  }
  return { count: data.length, data };
}

/**
 * Collate mods into all_mods.json and extract assets
 * @param {ReturnType<createGlobFn>} globFn
 * @param {string} buildDir
 * @param {boolean} dryRun
 * @param {Object} [options]
 * @param {boolean} [options.extractAssets]
 * @param {boolean} [options.convertGfx]
 * @param {boolean} [options.force]
 * @param {boolean} [options.writeJson]
 */
export function processMods(globFn, buildDir, dryRun, options = {}) {
  const {
    extractAssets = true,
    convertGfx = false,
    force = false,
    writeJson = true,
  } = options;
  /** @type {Record<string, { info: any, data: any[] }>} */
  const dataMods = {};
  let extracted = 0;
  let converted = 0;
  let failed = 0;

  for (const i of globFn("*/data/mods/*/modinfo.json")) {
    const modname = i.name.split("/")[2];
    const modInfo = JSON.parse(i.data()).find(
      (/** @type {any} */ i) => i.type === "MOD_INFO",
    );
    if (!modInfo || modInfo.obsolete) continue;

    const modId = modInfo.id;
    dataMods[modId] = { info: modInfo, data: [] };

    for (const f of globFn(`*/data/mods/${modname}/**/*.json`)) {
      const filename = f.name;
      const objs = breakJSONIntoSingleObjects(f.data());
      for (const { obj, start, end } of objs) {
        if (obj.type === "MOD_INFO") continue;
        obj.__filename = filename + `#L${start}-L${end}`;
        dataMods[modId].data.push(obj);
      }
    }

    if (extractAssets) {
      for (const f of globFn(`*/data/mods/${modname}/**/*.png`)) {
        const relPath = f.name.split("/").slice(3).join("/");
        const targetPath = `mods/${modId}/${relPath}`;
        if (!dryRun) {
          const fullPath = path.join(buildDir, targetPath);
          const webpPath = fullPath.replace(/\.png$/, ".webp");
          if (!fs.existsSync(webpPath) || force) {
            writeFile(buildDir, targetPath, f.raw());
            extracted++;
            if (convertGfx) {
              if (convertToWebp(fullPath, dryRun, force)) converted++;
              else failed++;
            }
          }
        }
      }
    }
  }

  if (!dryRun && writeJson) {
    fs.writeFileSync(
      path.join(buildDir, "all_mods.json"),
      JSON.stringify(dataMods),
    );
  }
  return { dataMods, extracted, converted, failed };
}

/**
 * Process base GFX assets
 * @param {ReturnType<createGlobFn>} globFn
 * @param {string} buildDir
 * @param {boolean} dryRun
 * @param {Object} [options]
 * @param {boolean} [options.convertGfx]
 * @param {boolean} [options.force]
 */
export function processBaseGfx(globFn, buildDir, dryRun, options = {}) {
  const { convertGfx = false, force = false } = options;
  let extracted = 0;
  let converted = 0;
  let failed = 0;

  const gfxEntries = [...globFn("*/gfx/**/*")];
  for (const entry of gfxEntries) {
    const relPath = stripGfxPrefix(entry.name);
    if (!relPath) continue;

    const targetPath = `gfx/${relPath}`;
    const fullPath = path.join(buildDir, targetPath);
    const webpPath = fullPath.replace(/\.png$/, ".webp");

    if (!dryRun) {
      const isPng = relPath.toLowerCase().endsWith(".png");
      const isJson = relPath.toLowerCase().endsWith(".json");

      if (isPng) {
        if (!fs.existsSync(webpPath) || force) {
          writeFile(buildDir, targetPath, entry.raw());
          extracted++;
          if (convertGfx) {
            if (convertToWebp(fullPath, dryRun, force)) converted++;
            else failed++;
          }
        }
      } else if (isJson) {
        try {
          writeFile(
            buildDir,
            targetPath,
            JSON.stringify(JSON.parse(entry.data())),
          );
          extracted++;
        } catch (e) {
          writeFile(buildDir, targetPath, entry.raw());
          extracted++;
        }
      } else {
        writeFile(buildDir, targetPath, entry.raw());
        extracted++;
      }
    }
  }
  return { extracted, converted, failed };
}

/**
 * Pre-compress JSON files with Brotli
 * @param {string} buildDir
 * @param {boolean} dryRun
 * @param {boolean} [force]
 */
export function compressJsonFiles(buildDir, dryRun, force = false) {
  let jsonCount = 0;
  let compressedCount = 0;

  const findResult = exec(
    `find "${buildDir}" -type f -name "*.json" 2>/dev/null`,
    { silent: true, ignoreError: true },
  );

  if (!findResult) return { jsonCount, compressedCount };

  const jsonFiles = String(findResult)
    .trim()
    .split("\n")
    .filter((f) => f);

  for (const jsonFile of jsonFiles) {
    jsonCount++;
    if (!force && isCompressed(jsonFile)) continue;

    if (dryRun) {
      compressedCount++;
      continue;
    }

    try {
      exec(`brotli -q 11 -k -f "${jsonFile}"`, { silent: true });
      const brFile = `${jsonFile}.br`;
      if (fs.existsSync(brFile)) {
        fs.renameSync(brFile, jsonFile);
        compressedCount++;
      }
    } catch (e) {}
  }
  return { jsonCount, compressedCount };
}

/**
 * Create/update semantic symlinks for stable and nightly builds
 * @param {string} workspaceDir
 * @param {Array<{build_number: string, prerelease: boolean}>} builds
 * @param {boolean} dryRun
 */
export function updateSymlinks(workspaceDir, builds, dryRun) {
  const dataDir = path.join(workspaceDir, "data");

  // Find targets (builds are sorted newest first)
  const stableTarget = builds.find((b) => !b.prerelease)?.build_number;
  const nightlyTarget = builds.find((b) => b.prerelease)?.build_number;

  const symlinks = [
    { name: "stable", target: stableTarget },
    { name: "nightly", target: nightlyTarget },
  ];

  console.group("Updating semantic symlinks...");
  for (const { name, target } of symlinks) {
    if (!target) {
      console.log(`  ⚠️  No ${name} build found, skipping symlink`);
      continue;
    }

    const linkPath = path.join(dataDir, name);

    if (dryRun) {
      console.log(`  (DRY RUN) Would create: ${name} -> ${target}`);
      continue;
    }

    // Remove existing symlink/file/directory safely
    try {
      const stats = fs.lstatSync(linkPath);
      if (stats.isSymbolicLink() || stats.isFile()) {
        fs.unlinkSync(linkPath);
      } else if (stats.isDirectory()) {
        console.warn(`  ⚠️  ${name} is a real directory at ${linkPath}. Skipping symlink creation to avoid deletion.`);
        continue;
      }
    } catch (e) {
      // Doesn't exist, that's fine
    }

    // Create relative symlink (target is just the directory name)
    fs.symlinkSync(target, linkPath);
    console.log(`  ✅ ${name} -> ${target}`);
  }
  console.groupEnd();
}
