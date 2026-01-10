// @ts-check
import { readFileSync, writeFileSync, rmSync } from "fs";
import { join } from "path";

/**
 * @typedef {Object} RunOptions
 * @property {boolean} [dryRun]
 */

/** @param {RunOptions} options */
export default async function run({ dryRun = false } = {}) {
  if (dryRun) {
    console.log("(DRY RUN) No changes will be made to the repository.");
  }

  // Get configuration from environment
  const workspaceDir = process.env.WORKSPACE_DIR || "data_workspace";
  const dataBranch = process.env.DATA_BRANCH || "main";

  console.log(`Working directory: ${workspaceDir}`);
  console.log(`Data branch: ${dataBranch}`);

  // Read builds.json from workspace
  const buildsJsonPath = join(workspaceDir, "builds.json");
  let existingBuilds = [];

  try {
    const buildsContent = readFileSync(buildsJsonPath, "utf-8");
    existingBuilds = JSON.parse(buildsContent);
    console.log(`Read ${existingBuilds.length} builds from builds.json`);
  } catch (err) {
    console.log("Could not read builds.json, assuming empty");
  }

  // Apply retention policy
  const { kept: keptBuilds, removed: removedBuilds } = applyRetentionPolicy(
    existingBuilds,
    new Date(),
  );

  if (removedBuilds.length === 0) {
    console.log("Retention policy: no builds to remove");
    return;
  }

  console.log(
    `Retention policy: keeping ${keptBuilds.length} builds, removing ${removedBuilds.length} builds`,
  );

  if (dryRun) {
    console.log("(DRY RUN) Would remove the following builds:");
    for (const build of removedBuilds) {
      console.log(`  - ${build.build_number}`);
    }
    console.log("(DRY RUN) skipping filesystem changes");
    return;
  }

  // Remove build directories from data/
  const dataDir = join(workspaceDir, "data");
  const removedBuildNumbers = new Set(
    removedBuilds.map((b) => String(b.build_number)),
  );

  console.log("Removing old build directories...");
  for (const buildNumber of removedBuildNumbers) {
    const buildDir = join(dataDir, buildNumber);
    try {
      rmSync(buildDir, { recursive: true, force: true });
      console.log(`  Removed: data/${buildNumber}`);
    } catch (err) {
      const error = /** @type {Error} */ (err);
      console.log(`  Warning: could not remove data/${buildNumber}: ${error.message}`);
    }
  }

  // Write updated builds.json
  console.log(`Writing ${keptBuilds.length} builds to builds.json...`);
  writeFileSync(buildsJsonPath, JSON.stringify(keptBuilds));

  console.log("✅ Pruning complete");
}

/**
 * @param {any} build
 * @returns {Date | null}
 */
function getBuildDate(build) {
  if (build?.created_at) {
    const createdAt = new Date(build.created_at);
    if (!Number.isNaN(createdAt.getTime())) {
      return createdAt;
    }
  }

  if (typeof build?.build_number === "string") {
    const match = build.build_number.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) {
      const fallback = new Date(`${match[1]}T00:00:00Z`);
      if (!Number.isNaN(fallback.getTime())) {
        return fallback;
      }
    }
  }

  return null;
}

/**
 * @param {Date} date
 * @param {number} dayMs
 */
function toDayKey(date, dayMs) {
  return Math.floor(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) /
      dayMs,
  );
}

/**
 * @param {any[]} builds
 * @param {Date} now
 */
function applyRetentionPolicy(builds, now) {
  const ONE_DAY = 1000 * 60 * 60 * 24;
  const kept = [];
  const removed = [];
  const buildsWithoutDate = [];

  // Group builds by build day (UTC) while tracking age from 'now'
  const buildsByDay = new Map();
  const nowDayKey = toDayKey(now, ONE_DAY);

  for (const b of builds) {
    // 1. Keep all stable releases.
    if (!b.prerelease) {
      kept.push(b);
      continue;
    }

    const buildDate = getBuildDate(b);
    if (!buildDate) {
      kept.push(b);
      buildsWithoutDate.push(b);
      continue;
    }

    const buildDayKey = toDayKey(buildDate, ONE_DAY);
    const ageDays = Math.max(0, nowDayKey - buildDayKey);

    // We only care about positive age, though future builds (clock skew?) treated as day 0
    const day = Math.max(0, ageDays);

    if (!buildsByDay.has(buildDayKey)) {
      buildsByDay.set(buildDayKey, { day, builds: [] });
    }
    buildsByDay.get(buildDayKey).builds.push({
      build: b,
      timestamp: buildDate.getTime(),
    });
  }

  // Iterate over groups and apply rules
  // Sort keys just for deterministic processing order, though not strictly needed
  const days = [...buildsByDay.keys()].sort((a, b) => a - b);

  if (buildsWithoutDate.length > 0) {
    console.log(
      `Retention policy: keep ${buildsWithoutDate.length} builds without valid date`,
    );
  }

  for (const dayKey of days) {
    const { day, builds: dailyBuilds } = buildsByDay.get(dayKey);
    // Sort descending by timestamp (latest first) to pick "last build of the day"
    dailyBuilds.sort(
      (/** @type {{ timestamp: number }} */ a, /** @type {{ timestamp: number }} */ b) =>
        b.timestamp - a.timestamp,
    );

    const latestInDay = dailyBuilds[0].build;
    const rest = dailyBuilds.slice(1).map((/** @type {{ build: any }} */ entry) => entry.build);

    // Rule 2: In the last 30 days (0 <= day < 30), keep all builds.
    if (day < 30) {
      kept.push(...dailyBuilds.map((/** @type {{ build: any }} */ entry) => entry.build));
      continue;
    }

    // For older ranges, we only consider keeping the latest build of the day (if rule matches)
    // All others in the same day are removed.

    // Default to removing conflicting/extra builds of the day
    removed.push(...rest);

    // Now decide for 'latestInDay'

    // Rule 3: 30 <= day < 90. Keep if day % 2 === 0.
    if (day >= 30 && day < 90) {
      // Use build day parity so retention stays stable across runs.
      if (dayKey % 2 === 0) {
        kept.push(latestInDay);
      } else {
        removed.push(latestInDay);
      }
      continue;
    }

    // Rule 4: 90 <= day < 210. Keep if day % 4 === 0.
    if (day >= 90 && day < 210) {
      if (dayKey % 4 === 0) {
        kept.push(latestInDay);
      } else {
        removed.push(latestInDay);
      }
      continue;
    }

    // Rule 5: 210 <= day < 450. Keep if day % 8 === 0.
    if (day >= 210 && day < 450) {
      if (dayKey % 8 === 0) {
        kept.push(latestInDay);
      } else {
        removed.push(latestInDay);
      }
      continue;
    }

    // Rule 6: Delete all builds older than 450 days.
    if (day >= 450) {
      removed.push(latestInDay);
      // noinspection UnnecessaryContinueJS
      continue;
    }
  }

  return { kept, removed };
}

export { applyRetentionPolicy };
