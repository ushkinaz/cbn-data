import run from "./prune-data.mjs";

await run({
  dryRun: !process.env.GITHUB_TOKEN,
});

