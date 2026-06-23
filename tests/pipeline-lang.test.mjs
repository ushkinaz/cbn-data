import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import AdmZip from "adm-zip";

import {
  createCachedTranslationsGlobFn,
  fetchTranslationsGlobFn,
  hasPoFiles,
  processLangs,
} from "../pipeline.mjs";

const translationsArchive = {
  owner: "cataclysmbn",
  repo: "translations",
  ref: "main",
};
const po = `msgid ""
msgstr ""
"Language: fr\\n"
"Plural-Forms: nplurals=2; plural=(n > 1);\\n"

msgid "apple"
msgstr "pomme"
`;
const poEntry = () => ({
  name: "lang/po/fr.po",
  data: () => po,
  raw: () => Buffer.from(po),
});
const createLangGlobFn = (entries) => function* glob(pattern) {
  if (pattern === "*/lang/po/*.po") yield* entries;
};
const createZipBuffer = () => {
  const zip = new AdmZip();
  zip.addFile("translations-main/lang/po/fr.po", Buffer.from(po));
  return zip.toBuffer();
};
const createGithubMock = (downloadZipballArchive) => ({
  rest: { repos: { downloadZipballArchive } },
});

test("hasPoFiles detects available PO translations", () => {
  assert.equal(hasPoFiles(createLangGlobFn([poEntry()])), true);
  assert.equal(hasPoFiles(createLangGlobFn([])), false);
});

test("fetchTranslationsGlobFn downloads and processLangs converts external archive", async (t) => {
  const calls = [];
  const github = createGithubMock(async (options) => {
    calls.push(options);
    return { data: createZipBuffer() };
  });
  const buildDir = await mkdtemp(path.join(os.tmpdir(), "cbn-data-lang-"));
  t.after(() => rm(buildDir, { recursive: true, force: true }));

  const globFn = await fetchTranslationsGlobFn(github);
  const { langs } = await processLangs(globFn, buildDir, false, []);
  const json = JSON.parse(
    await readFile(path.join(buildDir, "lang", "fr.json"), "utf8"),
  );

  assert.deepEqual(calls, [translationsArchive]);
  assert.equal(hasPoFiles(globFn), true);
  assert.deepEqual(langs, ["fr"]);
  assert.equal(json[""].language, "fr");
  assert.equal(json.apple, "pomme");
});

test("fetchTranslationsGlobFn wraps download errors with repository context", async () => {
  const originalError = new Error("rate limit");
  const github = createGithubMock(async () => {
    throw originalError;
  });

  await assert.rejects(
    () => fetchTranslationsGlobFn(github),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(
        error.message,
        /Failed to download translations archive cataclysmbn\/translations@main: rate limit/,
      );
      assert.equal(error.cause, originalError);
      return true;
    },
  );
});

test("createCachedTranslationsGlobFn caches successes and retries failures", async () => {
  let cachedCalls = 0;
  const getCachedGlobFn = createCachedTranslationsGlobFn(
    createGithubMock(async () => {
      cachedCalls++;
      return { data: createZipBuffer() };
    }),
  );
  const [firstGlobFn, secondGlobFn] = await Promise.all([
    getCachedGlobFn(),
    getCachedGlobFn(),
  ]);

  assert.equal(cachedCalls, 1);
  assert.equal(firstGlobFn, secondGlobFn);
  assert.equal(hasPoFiles(firstGlobFn), true);

  let retryCalls = 0;
  const getRetryGlobFn = createCachedTranslationsGlobFn(
    createGithubMock(async () => {
      if (++retryCalls === 1) throw new Error("temporary outage");
      return { data: createZipBuffer() };
    }),
  );
  await assert.rejects(() => getRetryGlobFn(), /temporary outage/);
  const [retryGlobFn, sameRetryGlobFn] = await Promise.all([
    getRetryGlobFn(),
    getRetryGlobFn(),
  ]);

  assert.equal(retryCalls, 2);
  assert.equal(retryGlobFn, sameRetryGlobFn);
  assert.equal(hasPoFiles(retryGlobFn), true);
});
