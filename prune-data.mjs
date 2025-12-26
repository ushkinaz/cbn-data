// @ts-check

/** @param {import('github-script').AsyncFunctionArguments & {dryRun?: boolean}} AsyncFunctionArguments */
export default async function run({ github, context, dryRun = false }) {
  if (dryRun) {
    console.log("(DRY RUN) No changes will be made to the repository.");
  }
  const dataBranch = "main";

  console.log("Collecting info from existing builds...");
  const { data: baseCommit } = await github.rest.repos.getCommit({
    ...context.repo,
    ref: dataBranch,
  });

  const { data: buildsJson } = await github.rest.repos.getContent({
    ...context.repo,
    path: "builds.json",
    ref: baseCommit.sha,
  });

  if (!("type" in buildsJson) || buildsJson.type !== "file")
    throw new Error("builds.json is not a file");

  const existingBuilds = JSON.parse(
    Buffer.from(buildsJson.content, "base64").toString("utf8"),
  );

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

  /** @type {{ path: string; mode: "100644" | "100755" | "040000" | "160000" | "120000"; type: "blob" | "commit" | "tree"; sha: string | null }[]} */
  const blobs = [];
  /** @type {'100644'} */
  const mode = "100644";
  /** @type {'blob'} */
  const type = "blob";

  /**
   * @param {string | Buffer} content
   */
  async function uploadBlob(content) {
    if (dryRun) return { data: { sha: "dry-run-sha" } };
    return typeof content === "string"
      ? await retry(() =>
          github.rest.git.createBlob({
            ...context.repo,
            content,
            encoding: "utf-8",
          }),
        )
      : await retry(() =>
          github.rest.git.createBlob({
            ...context.repo,
            content: content.toString("base64"),
            encoding: "base64",
          }),
        );
  }

  /**
   * Upload a blob to GitHub and save it in our blob list for later tree creation.
   * @param {string} path
   * @param {string | Buffer} content
   */
  async function createBlob(path, content) {
    console.log(`Creating blob at ${path}...`);
    const blob = await uploadBlob(content);
    blobs.push({
      path,
      mode,
      type,
      sha: blob.data.sha,
    });
    return blob;
  }

  const pathsToDelete = new Set();
  for (const build of removedBuilds) {
    console.log(
      `Marking artifacts for deletion for build ${build.build_number}...`,
    );
    pathsToDelete.add(`data/${build.build_number}/all.json`);
    pathsToDelete.add(`data/${build.build_number}/all_mods.json`);
    if (build.langs) {
      for (const lang of build.langs) {
        pathsToDelete.add(`data/${build.build_number}/lang/${lang}.json`);
        if (lang.startsWith("zh_")) {
          pathsToDelete.add(
            `data/${build.build_number}/lang/${lang}_pinyin.json`,
          );
        }
      }
    }
  }

  console.log(`Writing ${keptBuilds.length} builds to builds.json...`);
  const buildsBlob = await createBlob(
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
      email: "hhg2cbn@users.noreply.github.com",
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
 * @param {any[]} builds
 * @param {Date} now
 */
function applyRetentionPolicy(builds, now) {
  const ONE_DAY = 1000 * 60 * 60 * 24;
  const kept = [];
  const removed = [];

  // Group builds by day-age (0-indexed days ago from 'now')
  const buildsByDay = new Map();

  for (const b of builds) {
    // 1. Keep all stable releases.
    if (!b.prerelease) {
      kept.push(b);
      continue;
    }

    const ageMs = now.getTime() - new Date(b.created_at).getTime();
    const ageDays = Math.floor(ageMs / ONE_DAY);

    // We only care about positive age, though future builds (clock skew?) treated as day 0
    const day = Math.max(0, ageDays);

    if (!buildsByDay.has(day)) {
      buildsByDay.set(day, []);
    }
    buildsByDay.get(day).push(b);
  }

  // Iterate over groups and apply rules
  // Sort keys just for deterministic processing order, though not strictly needed
  const days = [...buildsByDay.keys()].sort((a, b) => a - b);

  for (const day of days) {
    const dailyBuilds = buildsByDay.get(day);
    // Sort descending by created_at (latest first) to pick "last build of the day"
    dailyBuilds.sort((/** @type {any} */ a, /** @type {any} */ b) =>
      b.created_at.localeCompare(a.created_at),
    );

    const latestInDay = dailyBuilds[0];
    const rest = dailyBuilds.slice(1);

    // Rule 2: In the last 30 days (0 <= day < 30), keep all builds.
    if (day < 30) {
      kept.push(...dailyBuilds);
      continue;
    }

    // For older ranges, we only consider keeping the latest build of the day (if rule matches)
    // All others in the same day are removed.

    // Default to removing conflicting/extra builds of the day
    removed.push(...rest);

    // Now decide for 'latestInDay'

    // Rule 3: 30 <= day < 90. Keep if day % 2 === 0.
    if (day >= 30 && day < 90) {
      if (day % 2 === 0) {
        kept.push(latestInDay);
      } else {
        removed.push(latestInDay);
      }
      continue;
    }

    // Rule 4: 90 <= day < 210. Keep if day % 4 === 0.
    if (day >= 90 && day < 210) {
      if (day % 4 === 0) {
        kept.push(latestInDay);
      } else {
        removed.push(latestInDay);
      }
      continue;
    }

    // Rule 5: 210 <= day < 450. Keep if day % 8 === 0.
    if (day >= 210 && day < 450) {
      if (day % 8 === 0) {
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

/**
 * @param {() => Promise<any>} fn
 * @param {number} retries
 */
async function retry(fn, retries = 10) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Error", msg, "- retrying...");
      // Wait an increasing amount of time between retries
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
  throw new Error("Max retries reached");
}
