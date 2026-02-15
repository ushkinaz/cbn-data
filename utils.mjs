// @ts-check
import AdmZip from "adm-zip";
import minimatch from "minimatch";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

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
    console.log(`    🎨 Extracting ${externalGfxEntries.length} external tileset assets...`);
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
