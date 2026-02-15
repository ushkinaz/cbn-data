// @ts-check
import path from "path";
import {
  writeFile,
  getExistingBuilds,
  updateSymlinks,
  createGlobFn,
  processMods,
  collateAllJson,
  processLangs,
  processBaseGfx,
  extractExternalTilesets,
} from "./pipeline.mjs";

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

    const zBuf = Buffer.from(/** @type {any} */ (zip));

    const buildDir = path.join(workspaceDir, pathBase);
    const globFn = createGlobFn(zBuf);

    const modStats = processMods(globFn, buildDir, dryRun, {
      extractAssets: true,
      convertGfx: false,
      writeJson: true,
    });

    const { data } = collateAllJson(
      globFn,
      buildDir,
      tag_name,
      release,
      modStats.dataMods,
      dryRun,
    );

    const { langs } = await processLangs(globFn, buildDir, dryRun, data);

    processBaseGfx(globFn, buildDir, dryRun, { convertGfx: false });
    extractExternalTilesets(globFn, buildDir, dryRun, {
      convertPNG: false,
    });

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
