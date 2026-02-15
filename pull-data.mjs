// @ts-check
import po2json from "po2json";
import path from "path";
import fs from "fs";
import { toPinyin } from "./pinyin.mjs";
import {
  breakJSONIntoSingleObjects,
  postprocessPoJson,
  createGlobFn as glob,
  stripGfxPrefix,
  writeFile,
  getExistingBuilds,
} from "./utils.mjs";

/** @type {string[]} */
const forbiddenTags = [];

/** @param {import('github-script').AsyncFunctionArguments & {dryRun?: boolean}} AsyncFunctionArguments */
export default async function run({ github, context, dryRun = false }) {
  // Get workspace directory - either from env or default to data_workspace
  const workspaceDir = process.env.WORKSPACE_DIR || "data_workspace";

  if (dryRun) {
    console.log("(DRY RUN) No changes will be made to the repository.");
  }

  const dataBranch = process.env.DATA_BRANCH || "main";

  console.log(`Working in directory: ${workspaceDir}`);
  console.log(`Target branch: ${dataBranch}`);

  console.log("Fetching release list...");

  const { data: releases } = await github.rest.repos.listReleases({
    owner: "cataclysmbn",
    repo: "Cataclysm-BN",
  });

  const existingBuilds = getExistingBuilds(workspaceDir);
  console.log(`Found ${existingBuilds.length} existing builds`);

  const newBuilds = [];

  for (const release of releases.filter(
    (r) =>
      !existingBuilds.some(
        (/** @type {any} */ b) => b.build_number === r.tag_name,
      ),
  )) {
    const { tag_name } = release;
    const pathBase = `data/${tag_name}`;
    console.group(`Processing ${tag_name}...`);
    if (forbiddenTags.includes(tag_name)) {
      console.log(`Skipping ${tag_name} because it's on the forbidden list.`);
      continue;
    }

    console.log(`Fetching source...`);

    const { data: zip } = await github.rest.repos.downloadZipballArchive({
      owner: "cataclysmbn",
      repo: "Cataclysm-BN",
      ref: tag_name,
    });

    // @ts-ignore
    const zBuf = Buffer.from(zip);
    const globFn = glob(zBuf);

    console.group("Collating base JSON...");
    /** @type {any[]} */
    const data = [];
    for (const f of globFn("*/data/json/**/*.json")) {
      const filename = f.name;
      const objs = breakJSONIntoSingleObjects(f.data());
      for (const { obj, start, end } of objs) {
        obj.__filename = filename + `#L${start}-L${end}`;
        data.push(obj);
      }
    }
    console.log(`Found ${data.length} objects.`);
    console.groupEnd();

    console.group("Collating mods JSON...");
    /** @type {Record<string, { info: any, data: any[] }>} */
    const dataMods = {};
    for (const i of globFn("*/data/mods/*/modinfo.json")) {
      const modname = i.name.split("/")[2];
      const modInfo = JSON.parse(i.data()).find(
        (/** @type {any} */ i) => i.type === "MOD_INFO",
      );
      if (!modInfo || modInfo.obsolete) {
        continue;
      }
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

      // Extract GFX/Assets from mods
      for (const f of globFn(`*/data/mods/${modname}/**/*.png`)) {
        // Skip if it's the modinfo.json we already processed above, or if it's already in the data list
        if (f.name.endsWith("modinfo.json")) continue;

        if (!dryRun) {
          const relPath = f.name.split("/").slice(3).join("/");
          const targetPath = `${pathBase}/mods/${modId}/${relPath}`;

          writeFile(workspaceDir, targetPath, f.raw());
        }
      }
    }
    console.log(
      `Found ${Object.values(dataMods).reduce((acc, m) => acc + m.data.length, 0)} objects in ${Object.keys(dataMods).length} mods.`,
    );
    console.groupEnd();

    const allJson = JSON.stringify({
      build_number: tag_name,
      release,
      data,
      mods: Object.fromEntries(
        Object.entries(dataMods).map(([name, mod]) => [name, mod.info]),
      ),
    });

    const allModsJson = JSON.stringify(dataMods);

    if (!dryRun) {
      writeFile(workspaceDir, `${pathBase}/all.json`, allJson);
      writeFile(workspaceDir, `${pathBase}/all_mods.json`, allModsJson);
    }

    console.group("Processing languages...");
    const langs = await Promise.all(
      [...globFn("*/lang/po/*.po")].map(async (f) => {
        const lang = path.basename(f.name, ".po");
        // @ts-ignore
        const json = postprocessPoJson(po2json.parse(f.data()));
        const jsonStr = JSON.stringify(json);

        if (!dryRun) {
          writeFile(workspaceDir, `${pathBase}/lang/${lang}.json`, jsonStr);

          if (lang.startsWith("zh_")) {
            const pinyinMap = toPinyin(data, json);
            const pinyinStr = JSON.stringify(pinyinMap);
            writeFile(
              workspaceDir,
              `${pathBase}/lang/${lang}_pinyin.json`,
              pinyinStr,
            );
          }
        }
        return lang;
      }),
    );
    console.log(`Found ${langs.length} languages.`);
    console.groupEnd();

    console.group("Processing gfx...");
    const gfxEntries = [...globFn("*/gfx/**/*")];
    const gfxFiles = [];
    if (gfxEntries.length === 0) {
      console.log("No gfx assets found.");
    } else {
      for (const entry of gfxEntries) {
        const relPath = stripGfxPrefix(entry.name);
        const gfxPath = `${pathBase}/gfx/${relPath}`;
        if (!dryRun) {
          // Minify JSON files (like tile_config.json) to reduce size
          const isJson = relPath.toLowerCase().endsWith(".json");
          if (isJson) {
            const jsonContent = JSON.stringify(
              JSON.parse(entry.raw().toString("utf8")),
            );
            writeFile(workspaceDir, gfxPath, jsonContent);
          } else {
            writeFile(workspaceDir, gfxPath, entry.raw());
          }
        }
        gfxFiles.push(relPath);
      }
      console.log(`Found ${gfxFiles.length} gfx assets.`);
    }

    console.groupEnd();

    newBuilds.push({
      build_number: tag_name,
      prerelease: release.prerelease,
      created_at: release.created_at,
      langs,
    });
    console.groupEnd();
  }

  if (newBuilds.length === 0) {
    console.log("No new builds to process. We're done here.");
    return;
  }

  const builds = existingBuilds.concat(newBuilds);
  builds.sort((/** @type {any} */ a, /** @type {any} */ b) =>
    b.created_at.localeCompare(a.created_at),
  );

  console.log(`Writing ${builds.length} builds to builds.json...`);
  if (!dryRun) {
    writeFile(workspaceDir, "builds.json", JSON.stringify(builds));
  }

  // Update semantic symlinks (stable/nightly)
  updateSymlinks(workspaceDir, builds, dryRun);

  if (dryRun) {
    console.log("(DRY RUN) Skipping git commit.");
    return;
  }

  console.log(
    "Files written successfully. Commit should be handled by workflow.",
  );
}

/**
 * Create/update semantic symlinks for stable and nightly builds
 * @param {string} workspaceDir
 * @param {Array<{build_number: string, prerelease: boolean}>} builds
 * @param {boolean} dryRun
 */
function updateSymlinks(workspaceDir, builds, dryRun) {
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

    // Remove existing symlink/file/directory
    try {
      const stats = fs.lstatSync(linkPath);
      if (stats.isSymbolicLink() || stats.isFile()) {
        fs.unlinkSync(linkPath);
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
