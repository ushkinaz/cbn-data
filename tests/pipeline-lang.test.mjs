import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import AdmZip from "adm-zip";

import {
  fetchTranslationsGlobFn,
  hasPoFiles,
  processLangs,
} from "../pipeline.mjs";

const po = `msgid ""
msgstr ""
"Language: fr\\n"
"Plural-Forms: nplurals=2; plural=(n > 1);\\n"

msgid "apple"
msgstr "pomme"
`;

/**
 * @param {Array<{name: string, data: () => string, raw: () => Buffer}>} entries
 */
function createLangGlobFn(entries) {
  /** @param {string} pattern */
  return function* glob(pattern) {
    if (pattern !== "*/lang/po/*.po") return;
    yield* entries;
  };
}

test("hasPoFiles detects available PO translations", () => {
  const globFn = createLangGlobFn([
    { name: "lang/po/fr.po", data: () => po, raw: () => Buffer.from(po) },
  ]);

  assert.equal(hasPoFiles(globFn), true);
  assert.equal(hasPoFiles(createLangGlobFn([])), false);
});

test("fetchTranslationsGlobFn downloads the external translations archive", async () => {
  const zip = new AdmZip();
  zip.addFile("translations-main/lang/po/fr.po", Buffer.from(po));

  /** @type {Array<Record<string, string>>} */
  const calls = [];
  const github = {
    rest: {
      repos: {
        downloadZipballArchive: async (options) => {
          calls.push(options);
          return { data: zip.toBuffer() };
        },
      },
    },
  };

  // @ts-expect-error This mock implements the needed GitHub REST method.
  const globFn = await fetchTranslationsGlobFn(github);

  assert.deepEqual(calls, [
    { owner: "cataclysmbn", repo: "translations", ref: "main" },
  ]);
  assert.equal(hasPoFiles(globFn), true);
  assert.equal([...globFn("*/lang/po/*.po")][0].name, "lang/po/fr.po");
});

test("processLangs writes JSON from a translations repository layout", async (t) => {
  const buildDir = await mkdtemp(path.join(os.tmpdir(), "cbn-data-lang-"));
  t.after(() => rm(buildDir, { recursive: true, force: true }));

  const globFn = createLangGlobFn([
    { name: "lang/po/fr.po", data: () => po, raw: () => Buffer.from(po) },
  ]);
  const { langs } = await processLangs(globFn, buildDir, false, []);

  assert.deepEqual(langs, ["fr"]);
  const json = JSON.parse(
    await readFile(path.join(buildDir, "lang", "fr.json"), "utf8"),
  );
  assert.equal(json[""].language, "fr");
  assert.equal(json.apple, "pomme");
});
