import run from "./pull-data.mjs";
import { Octokit } from "octokit";

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

// Use 'workspace' for local testing (create it if needed)
if (!process.env.WORKSPACE_DIR) {
  process.env.WORKSPACE_DIR = "workspace";
}

await run({
  github: octokit,
  context: {
    repo: { owner: "ushkinaz", repo: "cbn-data" },
  },
  dryRun: !process.env.GITHUB_TOKEN,
});
