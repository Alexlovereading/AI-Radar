#!/usr/bin/env node
// Community-radar orchestrator. Sequentially runs the 7 community scrapers, overwrites
// today's dynamic snapshots (not a first-seen diff), ranks candidates, writes the
// site payload, and appends only high-score items to the community history log.
// The history log itself IS first-seen deduped: qualifying items are accumulated into
// a persistent "community-history-seen" snapshot (keyed by slug, via lib/snapshot.mjs),
// and only items not already present in that snapshot get appended to events.jsonl —
// so a signal that stays hot across many 20-minute runs is logged once, not every run.
// Does not notify Feishu — community heat is a dashboard signal, not a "reserve domain" alert.
//
// Dynamic imports (resolved at runtime):
//   ../scoring/community-score.mjs → scoreAndRank, shanghaiDateKey, DISPLAY_COMMUNITY_SCORE_MIN
//   ../lib/community-filter.mjs    → COMMUNITY_SOURCES
// If the scoring module loads, scoreAndRank is mandatory. The score=0 dump is only
// used when that import itself throws.

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { diffAndSave, loadSnapshot } from "../lib/snapshot.mjs";
import { runScraper, runManifestSequential } from "../lib/scraper-runner.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LATEST_DIR = path.join(ROOT, "data", "community", "latest");
const EVENTS_PATH = path.join(ROOT, "data", "community", "events.jsonl");
const SIGNALS_PATH = path.join(ROOT, "site", "data", "community-signals.json");

const DELAY_MS = 300;
const HISTORY_SCORE_MIN = 45;
// Snapshot key (data/snapshots/community-history-seen.json) that accumulates every item
// (by slug) that has ever crossed HISTORY_SCORE_MIN, so appendHistory can dedup against it.
const HISTORY_SEEN_SNAPSHOT_KEY = "community-history-seen";

// Fallback when lib/community-filter.mjs is missing. Same 7 keys as CONTRACT.md §4.
const FALLBACK_SOURCE_KEYS = [
  "producthunt",
  "github-trending",
  "hackernews",
  "reddit",
  "chrome-web-store",
  "appsumo",
  "google-trends",
];

const SOURCE_LABELS = {
  producthunt: "Product Hunt",
  "github-trending": "GitHub Trending",
  hackernews: "Hacker News",
  reddit: "Reddit",
  "chrome-web-store": "Chrome Web Store",
  appsumo: "AppSumo",
  "google-trends": "Google Trends",
};

const MANIFEST = [
  ["producthunt", "../scrapers/community/producthunt.mjs"],
  ["github-trending", "../scrapers/community/github-trending.mjs"],
  ["hackernews", "../scrapers/community/hackernews.mjs"],
  ["reddit", "../scrapers/community/reddit.mjs"],
  ["chrome-web-store", "../scrapers/community/chrome-web-store.mjs"],
  ["appsumo", "../scrapers/community/appsumo.mjs"],
  ["google-trends", "../scrapers/community/google-trends.mjs"],
];

function fallbackShanghaiDateKey(now = Date.now()) {
  const date = new Date(typeof now === "number" ? now : Date.now());
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function toSourceSet(raw) {
  if (!raw) return new Set(FALLBACK_SOURCE_KEYS);
  if (raw instanceof Set) return raw;
  if (Array.isArray(raw)) {
    const keys = raw
      .map((entry) => (typeof entry === "string" ? entry : entry?.key))
      .filter(Boolean);
    return keys.length > 0 ? new Set(keys) : new Set(FALLBACK_SOURCE_KEYS);
  }
  return new Set(FALLBACK_SOURCE_KEYS);
}

async function loadCommunitySources() {
  try {
    const mod = await import("../lib/community-filter.mjs");
    return toSourceSet(mod.COMMUNITY_SOURCES);
  } catch (err) {
    console.warn(
      `[run-community] lib/community-filter.mjs not available (${err.message}) — using hardcoded source keys`
    );
    return new Set(FALLBACK_SOURCE_KEYS);
  }
}

async function loadScoring() {
  let mod;
  try {
    mod = await import("../scoring/community-score.mjs");
  } catch (err) {
    console.warn(
      `[run-community] scoring/community-score.mjs import failed (${err.message}) — writing unfiltered candidates with score=0`
    );
    return {
      imported: false,
      scoreAndRank: null,
      shanghaiDateKey: fallbackShanghaiDateKey,
      displayMin: HISTORY_SCORE_MIN,
    };
  }

  if (typeof mod.scoreAndRank !== "function") {
    throw new Error(
      "scoring/community-score.mjs loaded but scoreAndRank is not a function — refusing the score=0 dump"
    );
  }
  if (typeof mod.shanghaiDateKey !== "function") {
    throw new Error(
      "scoring/community-score.mjs loaded but shanghaiDateKey is not a function"
    );
  }
  const displayMin = Number(mod.DISPLAY_COMMUNITY_SCORE_MIN);
  if (!Number.isFinite(displayMin)) {
    throw new Error(
      "scoring/community-score.mjs loaded but DISPLAY_COMMUNITY_SCORE_MIN is not a finite number"
    );
  }
  return {
    imported: true,
    scoreAndRank: mod.scoreAndRank,
    shanghaiDateKey: mod.shanghaiDateKey,
    displayMin,
  };
}

async function writeLatest(sourceKey, items) {
  await mkdir(LATEST_DIR, { recursive: true });
  const file = path.join(LATEST_DIR, `${sourceKey}.json`);
  await writeFile(file, JSON.stringify(items, null, 2) + "\n", "utf8");
}

function makeSlug(source, idOrName) {
  const base = `${source}-${idOrName ?? ""}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || source;
}

function toSignalItem(item) {
  const source = String(item?.source ?? "");
  const name = String(item?.name ?? "");
  const meta =
    item?.meta && typeof item.meta === "object" && !Array.isArray(item.meta) ? item.meta : {};
  const breakdown = Array.isArray(item?.breakdown)
    ? item.breakdown.map((row) => ({
        points: Number(row?.points) || 0,
        label: String(row?.label ?? ""),
      }))
    : [];
  const scoreRaw = Number(item?.score);
  return {
    slug: String(item?.slug || makeSlug(source, item?.id ?? name)),
    name,
    url: String(item?.url ?? ""),
    source,
    sourceLabel: String(item?.sourceLabel || SOURCE_LABELS[source] || source),
    score: Number.isFinite(scoreRaw) ? scoreRaw : 0,
    tier: String(item?.tier ?? ""),
    breakdown,
    meta,
    detectedAt: String(item?.detectedAt ?? ""),
  };
}

async function appendHistory(items, scoreMin) {
  const min = Number.isFinite(Number(scoreMin)) ? Number(scoreMin) : HISTORY_SCORE_MIN;
  const qualifying = items.filter((item) => Number(item.score) >= min);

  // Union today's qualifying items into everything ever seen before, keyed by slug, so an
  // item that drops below the threshold (or stops appearing) later isn't forgotten and
  // re-appended if it resurfaces. diffAndSave then reports only the slugs that are new to
  // the union — i.e. items crossing the threshold for the first time — and persists the
  // union as the new snapshot for next run.
  const prevSeen = await loadSnapshot(HISTORY_SEEN_SNAPSHOT_KEY);
  const seenBySlug = new Map(prevSeen.map((item) => [item.slug, item]));
  for (const item of qualifying) seenBySlug.set(item.slug, item);
  const union = [...seenBySlug.values()];

  const newlySeen = await diffAndSave(HISTORY_SEEN_SNAPSHOT_KEY, union, (item) => item.slug);
  if (newlySeen.length === 0) return 0;

  const lines = newlySeen.map((item) => JSON.stringify(item));
  await mkdir(path.dirname(EVENTS_PATH), { recursive: true });
  await appendFile(EVENTS_PATH, lines.join("\n") + "\n", "utf8");
  return lines.length;
}

async function writeSignals(payload) {
  await mkdir(path.dirname(SIGNALS_PATH), { recursive: true });
  await writeFile(SIGNALS_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

async function main() {
  const startedAt = Date.now();
  const allowed = await loadCommunitySources();
  const scoring = await loadScoring();

  const sources = [];
  const candidates = [];

  await runManifestSequential(
    MANIFEST,
    async (sourceKey, relativePath) => {
      const label = SOURCE_LABELS[sourceKey] ?? sourceKey;

      if (!allowed.has(sourceKey)) {
        sources.push({
          key: sourceKey,
          label,
          status: "skipped",
          count: 0,
          note: "not in COMMUNITY_SOURCES",
        });
        await writeLatest(sourceKey, []);
        return;
      }

      const result = await runScraper(sourceKey, relativePath, { logPrefix: "[run-community]" });
      await writeLatest(sourceKey, result.items);
      candidates.push(...result.items);
      sources.push({
        key: sourceKey,
        label,
        status: result.status,
        count: result.items.length,
        note: result.note ?? "",
      });
    },
    { delayMs: DELAY_MS }
  );

  const now = Date.now();
  let items;
  if (scoring.imported) {
    const ranked = scoring.scoreAndRank(candidates, { now });
    const list = Array.isArray(ranked) ? ranked : [];
    items = list
      .map(toSignalItem)
      .filter((item) => item.name && item.score >= scoring.displayMin);
  } else {
    items = candidates.map(toSignalItem).filter((item) => item.name);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    shanghaiDate: scoring.shanghaiDateKey(now),
    sources,
    items,
  };
  await writeSignals(payload);

  const appended = await appendHistory(items, scoring.displayMin);

  const failed = sources.filter((s) => s.status === "error").map((s) => s.key);
  const skipped = sources.filter((s) => s.status === "skipped").map((s) => s.key);
  const perSourceCounts = sources.map((s) => `${s.key}=${s.count}`).join(", ");

  console.log(`\n[run-community] scraping done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  console.log(`[run-community] candidates: ${candidates.length}; display items: ${items.length}`);
  console.log(`[run-community] per-source counts: ${perSourceCounts}`);
  console.log(`[run-community] wrote ${SIGNALS_PATH}`);
  console.log(`[run-community] appended ${appended} items (score >= ${scoring.displayMin}) to ${EVENTS_PATH}`);
  if (skipped.length > 0) {
    console.log(`[run-community] skipped sources (${skipped.length}): ${skipped.join(", ")}`);
  }
  if (failed.length > 0) {
    console.log(`[run-community] FAILED sources (${failed.length}): ${failed.join(", ")}`);
  } else {
    console.log("[run-community] all scrapers ran without throwing");
  }
}

main().catch((err) => {
  console.error(`[run-community] fatal error: ${err.stack ?? err.message}`);
  process.exitCode = 1;
});
