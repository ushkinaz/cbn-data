import { GitHubHelper } from "./lib.mjs";

/** @param {import('github-script').AsyncFunctionArguments & {dryRun?: boolean}} AsyncFunctionArguments */
export default async function run({ github, context, dryRun = false }) {
  const helper = new GitHubHelper({ github, context, dryRun });
  if (dryRun) {
    console.log("(DRY RUN) No changes will be made to the repository.");
  }
  const dataBranch = "main";

  const { baseCommit, existingBuilds } =
    await helper.getExistingBuilds(dataBranch);

  // Apply retention policy
  const { kept: keptBuilds, removed: removedBuilds } = applyRetentionPolicy(
    existingBuilds,
    new Date(),
  );

  if (removedBuilds.length === 0) {
    console.log("Retention policy: no builds to remove.");
    return;
  }

  console.log(
    `Retention policy: keeping ${keptBuilds.length} builds, removing ${removedBuilds.length} builds.`,
  );

  console.log(`Writing ${keptBuilds.length} builds to builds.json...`);
  const buildsBlob = await helper.createBlob(
    "builds.json",
    JSON.stringify(keptBuilds),
  );

  if (dryRun) {
    console.log("(DRY RUN) skipping commit and push.");
    return;
  }

  console.log("Fetching root tree...");
  const { data: baseTree } = await github.rest.git.getTree({
    ...context.repo,
    tree_sha: baseCommit.commit.tree.sha,
  });

  const dataEntry = baseTree.tree.find((item) => item.path === "data");
  if (!dataEntry) {
    throw new Error("Could not find 'data' directory in root tree");
  }

  console.log("Fetching 'data' tree...");
  const { data: dataTree } = await github.rest.git.getTree({
    ...context.repo,
    tree_sha: dataEntry.sha,
  });

  const removedBuildNumbers = new Set(
    removedBuilds.map((b) => String(b.build_number)),
  );

  console.log("Filtering 'data' tree...");
  const keptDataItems = dataTree.tree
    .filter((item) => {
      // item.path is the filename/dirname within 'data/'
      return item.path && !removedBuildNumbers.has(item.path);
    })
    .map((item) => ({
      path: /** @type {string} */ (item.path),
      mode: /** @type {"100644" | "100755" | "040000" | "160000" | "120000"} */ (
        item.mode
      ),
      type: /** @type {"blob" | "commit" | "tree"} */ (item.type),
      sha: item.sha,
    }));

  console.log("Creating new 'data' tree...");
  const { data: newDataTree } = await github.rest.git.createTree({
    ...context.repo,
    tree: keptDataItems,
  });

  console.log("Creating new root tree...");
  const { data: tree } = await github.rest.git.createTree({
    ...context.repo,
    base_tree: baseTree.sha,
    tree: [
      {
        path: "data",
        mode: "040000",
        type: "tree",
        sha: newDataTree.sha,
      },
      {
        path: "builds.json",
        mode: "100644",
        type: "blob",
        sha: buildsBlob.data.sha,
      },
    ],
  });

  console.log("Creating commit...");
  const { data: commit } = await github.rest.git.createCommit({
    ...context.repo,
    message: `Prune data, keeping ${keptBuilds.length} builds`,
    tree: tree.sha,
    author: {
      name: "HHG2CBN Update Bot",
      email: "hhg2cbn@users.nooreply.github.com",
    },
    parents: [baseCommit.sha],
  });

  console.log(`Updating ref ${dataBranch}...`);
  await github.rest.git.updateRef({
    ...context.repo,
    ref: `heads/${dataBranch}`,
    sha: commit.sha,
    force: true,
  });
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
    const rest = dailyBuilds.slice(1).map((entry) => entry.build);

    // Rule 2: In the last 30 days (0 <= day < 30), keep all builds.
    if (day < 30) {
      kept.push(...dailyBuilds.map((entry) => entry.build));
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
