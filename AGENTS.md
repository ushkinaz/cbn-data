# Guidance for contributors

This repository stores the automation that builds and publishes Cataclysm: Bright Nights data snapshots. Use these notes for any work under this directory.

## Coding conventions
- Keep modules in ESM form (`type: module` is set) and preserve existing `// @ts-check` headers and JSDoc typings for editor safety.
- Prefer small, reusable helpers over inlining complex logic, and keep logging concise (imperative sentences, no trailing punctuation) to match the current scripts.
- Avoid introducing heavyweight dependencies; reuse built-ins or existing packages (`adm-zip`, `minimatch`, `po2json`, `octokit`, `pinyin`) when possible.
- Scripts should continue to support `dryRun` execution so local runs do not push changes when `GITHUB_TOKEN` is absent.
- Generated game data should not be committed to this branch—automation writes it to the `main` data branch.

## Testing and verification
- Use `yarn install --frozen-lockfile` to add dependencies before running scripts.
- For manual checks, prefer `node pull-data-launcher.js` or `node prune-data-launcher.js`; both default to a dry run without `GITHUB_TOKEN`. Network-heavy runs are optional when unrelated to the change.

## Documentation and housekeeping
- Update README.md or in-file comments when behavior or inputs change; keep explanations minimal and actionable.
- Keep commit messages and PR summaries focused on the observable change (what changed and why) rather than implementation minutiae.
