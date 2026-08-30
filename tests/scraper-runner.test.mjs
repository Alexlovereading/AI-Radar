import assert from "node:assert/strict";
import { test } from "node:test";
import { runScraper, runManifestSequential, sleep } from "../lib/scraper-runner.mjs";

test("runScraper: import failure returns status=error with the import error message", async () => {
  const result = await runScraper("bad-source", "./does-not-exist.mjs", { logPrefix: "[test]" });
  assert.equal(result.sourceKey, "bad-source");
  assert.equal(result.status, "error");
  assert.deepEqual(result.items, []);
  assert.ok(result.note.length > 0);
});

test("runScraper: module with no default export returns status=error", async () => {
  const result = await runScraper(
    "no-default",
    new URL("./fixtures/no-default-export.mjs", import.meta.url).href,
    { logPrefix: "[test]" }
  );
  assert.equal(result.status, "error");
  assert.equal(result.note, "no default export function");
});

test("runScraper: default export that throws returns status=error with thrown message", async () => {
  const result = await runScraper(
    "throws",
    new URL("./fixtures/throwing-default-export.mjs", import.meta.url).href,
    { logPrefix: "[test]" }
  );
  assert.equal(result.status, "error");
  assert.equal(result.note, "boom");
});

test("runScraper: default export that resolves a non-array returns status=error", async () => {
  const result = await runScraper(
    "not-array",
    new URL("./fixtures/non-array-default-export.mjs", import.meta.url).href,
    { logPrefix: "[test]" }
  );
  assert.equal(result.status, "error");
  assert.equal(result.note, "run() did not return an array");
});

test("runScraper: default export that resolves an array returns status=ok with the items", async () => {
  const result = await runScraper(
    "good",
    new URL("./fixtures/ok-default-export.mjs", import.meta.url).href,
    { logPrefix: "[test]" }
  );
  assert.equal(result.status, "ok");
  assert.deepEqual(result.items, [{ id: 1 }, { id: 2 }]);
  assert.equal(result.note, "");
});

test("runManifestSequential: calls handler once per manifest entry, in order", async () => {
  const manifest = [
    ["a", "./a.mjs"],
    ["b", "./b.mjs"],
    ["c", "./c.mjs"],
  ];
  const calls = [];
  await runManifestSequential(
    manifest,
    async (sourceKey, relativePath, index) => {
      calls.push({ sourceKey, relativePath, index });
    },
    { delayMs: 1 }
  );
  assert.deepEqual(calls, [
    { sourceKey: "a", relativePath: "./a.mjs", index: 0 },
    { sourceKey: "b", relativePath: "./b.mjs", index: 1 },
    { sourceKey: "c", relativePath: "./c.mjs", index: 2 },
  ]);
});

test("runManifestSequential: waits delayMs between calls but not after the last one", async () => {
  const manifest = [
    ["a", "./a.mjs"],
    ["b", "./b.mjs"],
  ];
  const timestamps = [];
  const start = Date.now();
  await runManifestSequential(
    manifest,
    async () => {
      timestamps.push(Date.now() - start);
    },
    { delayMs: 40 }
  );
  assert.ok(timestamps[1] - timestamps[0] >= 35, `expected >=35ms gap, got ${timestamps[1] - timestamps[0]}`);
});

test("sleep: resolves after roughly the requested delay", async () => {
  const start = Date.now();
  await sleep(20);
  assert.ok(Date.now() - start >= 15);
});
