import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, cp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { after, before, test } from "node:test";

const execFileAsync = promisify(execFile);

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const REAL_BUILD = path.join(ROOT, "scripts", "build-community-data.mjs");
const REAL_SCORING = path.join(ROOT, "scoring", "community-score.mjs");
const REAL_FILTER = path.join(ROOT, "lib", "community-filter.mjs");
const REAL_OUT = path.join(ROOT, "site", "data", "community-signals.json");

const KNOWN_SOURCE_KEYS = [
  "hackernews",
  "github-trending",
  "reddit",
  "google-trends",
  "producthunt",
  "chrome-web-store",
  "appsumo",
];

const MOCK_PASSTHROUGH = `\
export const DISPLAY_COMMUNITY_SCORE_MIN = 45;

export function shanghaiDateKey(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

export function scoreAndRank(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    score: Number.isFinite(Number(item.score)) ? Number(item.score) : 80,
    tier: item.tier || "watch",
    breakdown: Array.isArray(item.breakdown) ? item.breakdown : [],
  }));
}
`;

const MOCK_THROWING = `\
export const DISPLAY_COMMUNITY_SCORE_MIN = 45;
export function scoreAndRank() {
  throw new Error("intentional scoring failure");
}
`;

let realOutFingerprint = null;

before(async () => {
  realOutFingerprint = await fileFingerprint(REAL_OUT);
});

after(async () => {
  const afterRun = await fileFingerprint(REAL_OUT);
  assert.deepEqual(
    afterRun,
    realOutFingerprint,
    "tests must not write the real site/data/community-signals.json",
  );
});

test("latest 快照优先于 events.jsonl", async () => {
  const { stdout, payload } = await withHarness({ scoring: "mock" }, async (dir) => {
    const today = nowIso();
    await writeLatest(dir, "hackernews", [
      makeItem({
        id: "latest-1",
        name: "FROM-LATEST OpenAI GPT-5",
        detectedAt: today,
        score: 90,
      }),
    ]);
    await writeEvents(dir, [
      makeItem({
        id: "events-1",
        name: "FROM-EVENTS Anthropic Claude",
        detectedAt: today,
        score: 99,
      }),
    ]);
  });

  const names = payload.items.map((it) => it.name);
  assert.ok(
    names.some((name) => name.includes("FROM-LATEST")),
    `expected latest item, got ${JSON.stringify(names)}`,
  );
  assert.equal(
    names.some((name) => name.includes("FROM-EVENTS")),
    false,
    "events.jsonl items must be ignored when latest snapshots exist",
  );
  assert.match(stdout, /input=latest/);
});

test("非上海当天的 item 不进 items", async () => {
  const { payload } = await withHarness({ scoring: "mock" }, async (dir) => {
    await writeLatest(dir, "hackernews", [
      makeItem({
        id: "old-1",
        name: "Yesterday GPT-5 leak",
        detectedAt: notTodayIso(),
        score: 99,
      }),
      makeItem({
        id: "today-1",
        name: "Today GPT-5 release",
        detectedAt: nowIso(),
        score: 90,
      }),
    ]);
  });

  const names = payload.items.map((it) => it.name);
  assert.equal(names.includes("Yesterday GPT-5 leak"), false);
  assert.equal(names.includes("Today GPT-5 release"), true);
});

test("分数 < 45 不进 items", async () => {
  const { payload } = await withHarness({ scoring: "mock" }, async (dir) => {
    const today = nowIso();
    await writeLatest(dir, "hackernews", [
      makeItem({
        id: "low",
        name: "Low score AI widget",
        detectedAt: today,
        score: 44,
      }),
      makeItem({
        id: "edge",
        name: "Edge score AI model",
        detectedAt: today,
        score: 45,
      }),
      makeItem({
        id: "high",
        name: "High score AI model",
        detectedAt: today,
        score: 70,
      }),
    ]);
  });

  const byName = new Map(payload.items.map((it) => [it.name, it]));
  assert.equal(byName.has("Low score AI widget"), false);
  assert.ok(byName.has("Edge score AI model"));
  assert.equal(byName.get("Edge score AI model").score, 45);
  assert.ok(byName.has("High score AI model"));
  assert.ok(payload.items.every((it) => it.score >= 45));
});

test("无输入时 7 个源 skipped + items []", async () => {
  const { stdout, payload } = await withHarness({ scoring: "mock" }, async () => {});

  assert.deepEqual(
    payload.sources.map((s) => s.key),
    KNOWN_SOURCE_KEYS,
  );
  assert.equal(payload.sources.length, 7);
  for (const source of payload.sources) {
    assert.equal(source.status, "skipped", `${source.key} should be skipped`);
    assert.equal(source.count, 0);
  }
  assert.deepEqual(payload.items, []);
  assert.match(stdout, /input=none/);
});

test("scoring 模块 mock 与真实调用都不 throw", async () => {
  const today = nowIso();
  const item = makeItem({
    id: "real-1",
    name: "OpenAI releases GPT-5",
    detectedAt: today,
    score: 80,
    meta: { points: 200, comments: 80, createdAt: today },
  });

  const mockRun = await withHarness({ scoring: "mock" }, async (dir) => {
    await writeLatest(dir, "hackernews", [item]);
  });
  assert.equal(mockRun.code, 0);

  const realRun = await withHarness({ scoring: "real" }, async (dir) => {
    await writeLatest(dir, "hackernews", [item]);
  });
  assert.equal(realRun.code, 0);
  assert.ok(Array.isArray(realRun.payload.items));

  const throwRun = await withHarness({ scoring: "throw" }, async (dir) => {
    await writeLatest(dir, "hackernews", [item]);
  });
  assert.equal(throwRun.code, 0);
  assert.deepEqual(throwRun.payload.items, []);
  assert.match(throwRun.stderr, /scoreAndRank failed/);
});

function nowIso() {
  return new Date().toISOString();
}

function notTodayIso() {
  return new Date(Date.now() - 48 * 3600 * 1000).toISOString();
}

function makeItem(overrides = {}) {
  const { meta: metaOverrides, ...rest } = overrides;
  const detectedAt = rest.detectedAt ?? nowIso();
  return {
    source: "hackernews",
    sourceLabel: "Hacker News",
    category: "community",
    id: "1",
    name: "OpenAI releases GPT-5",
    url: "https://news.ycombinator.com/item?id=1",
    detectedAt,
    ...rest,
    meta: {
      points: 80,
      comments: 20,
      createdAt: detectedAt,
      ...metaOverrides,
    },
  };
}

async function withHarness({ scoring }, setup) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "build-community-data-"));
  try {
    await mkdir(path.join(dir, "scripts"), { recursive: true });
    await mkdir(path.join(dir, "scoring"), { recursive: true });
    await mkdir(path.join(dir, "lib"), { recursive: true });
    await mkdir(path.join(dir, "data", "community", "latest"), { recursive: true });
    await mkdir(path.join(dir, "site", "data"), { recursive: true });
    await cp(REAL_BUILD, path.join(dir, "scripts", "build-community-data.mjs"));
    // build-community-data.mjs imports date helpers from lib/community-filter.mjs
    // directly (regardless of which scoring module is used), so it must always
    // be present in the harness dir.
    await cp(REAL_FILTER, path.join(dir, "lib", "community-filter.mjs"));

    if (scoring === "real") {
      await cp(REAL_SCORING, path.join(dir, "scoring", "community-score.mjs"));
    } else if (scoring === "throw") {
      await writeFile(path.join(dir, "scoring", "community-score.mjs"), MOCK_THROWING);
    } else {
      await writeFile(path.join(dir, "scoring", "community-score.mjs"), MOCK_PASSTHROUGH);
    }

    await setup(dir);
    const result = await runBuild(dir);
    const outPath = path.join(dir, "site", "data", "community-signals.json");
    const payload = JSON.parse(await readFile(outPath, "utf8"));
    return { ...result, payload, dir };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runBuild(dir) {
  const script = path.join(dir, "scripts", "build-community-data.mjs");
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [script], {
      cwd: dir,
      encoding: "utf8",
      timeout: 15_000,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return {
      code: typeof err.code === "number" ? err.code : 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? String(err),
    };
  }
}

async function writeLatest(dir, sourceKey, items) {
  const file = path.join(dir, "data", "community", "latest", `${sourceKey}.json`);
  await writeFile(
    file,
    JSON.stringify({ key: sourceKey, status: "ok", items }, null, 2) + "\n",
  );
}

async function writeEvents(dir, items) {
  const file = path.join(dir, "data", "community", "events.jsonl");
  await writeFile(file, items.map((it) => JSON.stringify(it)).join("\n") + "\n");
}

async function fileFingerprint(filePath) {
  try {
    const [info, body] = await Promise.all([stat(filePath), readFile(filePath)]);
    return { exists: true, mtimeMs: info.mtimeMs, size: info.size, body: body.toString() };
  } catch (err) {
    if (err.code === "ENOENT") return { exists: false };
    throw err;
  }
}
