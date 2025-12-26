// @ts-check

/**
 * Shared GitHub helper for Cataclysm BN data processing.
 */
export class GitHubHelper {
  constructor({ github, context, dryRun }) {
    this.github = github;
    this.context = context;
    this.dryRun = dryRun;
    this.blobs = [];
  }

  /**
   * @param {() => Promise<any>} fn
   * @param {number} retries
   */
  async retry(fn, retries = 10) {
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

  /**
   * Collecting info from existing builds.
   * @param {string} dataBranch
   * @returns {Promise<{ baseCommit: import('@octokit/rest').RestEndpointMethodTypes["repos"]["getCommit"]["response"]["data"], existingBuilds: any[] }>}
   */
  async getExistingBuilds(dataBranch) {
    console.log("Collecting info from existing builds...");
    const { data: baseCommit } = await this.github.rest.repos.getCommit({
      ...this.context.repo,
      ref: dataBranch,
    });

    const { data: buildsJson } = await this.github.rest.repos.getContent({
      ...this.context.repo,
      path: "builds.json",
      ref: baseCommit.sha,
    });

    if (!("type" in buildsJson) || buildsJson.type !== "file")
      throw new Error("builds.json is not a file");

    const existingBuilds = JSON.parse(
      Buffer.from(buildsJson.content, "base64").toString("utf8"),
    );

    return { baseCommit, existingBuilds };
  }

  /**
   * @param {string | Buffer} content
   */
  async uploadBlob(content) {
    if (this.dryRun) return { data: { sha: "dry-run-sha" } };
    return typeof content === "string"
      ? await this.retry(() =>
          this.github.rest.git.createBlob({
            ...this.context.repo,
            content,
            encoding: "utf-8",
          }),
        )
      : await this.retry(() =>
          this.github.rest.git.createBlob({
            ...this.context.repo,
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
  async createBlob(path, content) {
    console.log(`Creating blob at ${path}...`);
    const blob = await this.uploadBlob(content);
    this.blobs.push({
      path,
      mode: "100644",
      type: "blob",
      sha: blob.data.sha,
    });
    return blob;
  }

  /**
   * Copy an already-created blob to a new path.
   * @param {string} fromPath
   * @param {string} toPath
   */
  copyBlob(fromPath, toPath) {
    const existingBlob = this.blobs.find((b) => b.path === fromPath);
    if (!existingBlob) {
      throw new Error(`Blob not found: ${fromPath}`);
    }
    this.blobs.push({
      path: toPath,
      mode: "100644",
      type: "blob",
      sha: existingBlob.sha,
    });
  }
}
