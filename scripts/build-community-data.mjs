#!/usr/bin/env node
// Rebuild site/data/community-signals.json from today's community candidates.
//
// Prefer data/community/latest/<source>.json (written by scripts/run-community.mjs).
// If that directory has no JSON snapshots, fall back to data/community/events.jsonl.
// Scoring lives in scoring/community-score.mjs — if it is missing, warn and write
// empty `items` rather than throwing (the community page still needs a valid payload).

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  isTodayShanghai,
  resolveItemTime,
  shanghaiDateKey,
} from "../lib/community-filter.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, "..");

const LATEST_DIR = path.join(PROJECT_ROOT, "data", "community", "latest");
const EVENTS_PATH = path.join(PROJECT_ROOT, "data", "community", "events.jsonl");
const OUT_PATH = path.join(PROJECT_ROOT, "site", "data", "community-signals.json");

const FALLBACK_SCORE_MIN = 45;

const KNOWN_SOURCES = [
  ["hackernews", "Hacker News"],
  ["github-trending", "GitHub Trending"],
  ["reddit", "Reddit"],
  ["google-trends", "Google Trends"],
  ["producthunt", "Product Hunt"],
  ["chrome-web-store", "Chrome Web Store"],
  ["appsumo", "AppSumo"],
];

const SOURCE_LABELS = Object.fromEntries(KNOWN_SOURCES);
const SOURCE_STATUSES = new Set(["ok", "skipped", "error"]);

// shanghaiDateKey, isTodayShanghai, and resolveItemTime (== former local
// itemTime, including the item?.detectedAt fallback; internally uses
// parseTimestamp, the former local toMillis) are imported from
// lib/community-filter.mjs — verified equivalent behavior before removing
// the local copies here.

function isTodayItem(item, now, { allowUndated = false } = {}) {
  const ts = resolveItemTime(item);
  if (ts == null) return allowUndated;
  return isTodayShanghai(ts, now);
}

function asItems(raw) {
  if (Array.isArray(raw)) return raw.filter((it) => it && typeof it === "object");
  if (raw && typeof raw === "object" && Array.isArray(raw.items)) {
    return raw.items.filter((it) => it && typeof it === "object");
  }
  return [];
}

function sourceRecord(partial) {
  const status = SOURCE_STATUSES.has(partial.status) ? partial.status : "ok";
  const key = String(partial.key ?? "");
  return {
    key,
    label: String(partial.label || SOURCE_LABELS[key] || key || "未知来源"),
    status,
    count: Number.isFinite(Number(partial.count)) ? Number(partial.count) : 0,
    note: String(partial.note ?? ""),
  };
}

function slugify(text) {
  const ascii = String(text ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (ascii) return ascii;
  const compact = String(text ?? "")
    .toLowerCase()
    .replace(/[^\u4e00-\u9fff\w]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return compact.slice(0, 48);
}

function itemSlug(item, used) {
  const base =
    slugify(item.name) ||
    slugify(`${item.source}-${item.id || item.url || ""}`) ||
    "item";
  let slug = base;
  let n = 2;
  while (used.has(slug)) slug = `${base}-${n++}`;
  used.add(slug);
  return slug;
}

function normalizeBreakdown(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const points = Number(row.points);
      return {
        points: Number.isFinite(points) ? points : 0,
        label: String(row.label ?? ""),
      };
    })
    .filter(Boolean);
}

function toOutputItem(item, slug) {
  const score = Number(item.score);
  const out = {
    slug,
    name: String(item.name ?? ""),
    url: String(item.url ?? ""),
    source: String(item.source ?? ""),
    sourceLabel: String(
      item.sourceLabel || SOURCE_LABELS[item.source] || item.source || "社区来源",
    ),
    score: Number.isFinite(score) ? score : 0,
    tier: String(item.tier ?? ""),
    breakdown: normalizeBreakdown(item.breakdown),
    meta:
      item.meta && typeof item.meta === "object" && !Array.isArray(item.meta)
        ? item.meta
        : {},
    detectedAt: String(item.detectedAt ?? ""),
  };
  if (item.category) out.category = String(item.category);
  return out;
}

function mergeSources(records) {
  const byKey = new Map();
  for (const rec of records) {
    if (!rec.key) continue;
    byKey.set(rec.key, rec);
  }
  const ordered = [];
  for (const [key, label] of KNOWN_SOURCES) {
    ordered.push(
      byKey.get(key) ??
        sourceRecord({ key, label, status: "skipped", count: 0, note: "暂无当天快照" }),
    );
    byKey.delete(key);
  }
  for (const rec of byKey.values()) ordered.push(rec);
  return ordered;
}

async function loadScoring() {
  try {
    const mod = await import("../scoring/community-score.mjs");
    if (typeof mod.scoreAndRank !== "function") {
      console.warn(
        "[build-community-data] scoring/community-score.mjs has no scoreAndRank export. Writing empty items.",
      );
      return null;
    }
    return mod;
  } catch (err) {
    console.warn(
      `[build-community-data] scoring/community-score.mjs is missing or failed to load (${err.message}). Writing empty items.`,
    );
    return null;
  }
}

async function readLatest(now) {
  let names;
  try {
    names = await readdir(LATEST_DIR);
  } catch (err) {
    if (err.code === "ENOENT") return { used: false, items: [], sources: [] };
    throw err;
  }

  const files = names.filter((name) => name.endsWith(".json")).sort();
  if (files.length === 0) return { used: false, items: [], sources: [] };

  const items = [];
  const sources = [];

  for (const file of files) {
    const key = file.slice(0, -".json".length);
    const filePath = path.join(LATEST_DIR, file);
    try {
      const raw = JSON.parse(await readFile(filePath, "utf-8"));
      const parsed = asItems(raw);
      const today = parsed.filter((it) => isTodayItem(it, now, { allowUndated: true }));
      const wrapped = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
      sources.push(
        sourceRecord({
          key: wrapped.key || key,
          label: wrapped.label || SOURCE_LABELS[key] || key,
          status: wrapped.status || "ok",
          count: today.length,
          note: wrapped.note ?? "",
        }),
      );
      for (const item of today) {
        items.push({
          ...item,
          source: item.source || key,
          sourceLabel: item.sourceLabel || SOURCE_LABELS[item.source || key] || key,
        });
      }
    } catch (err) {
      sources.push(
        sourceRecord({
          key,
          label: SOURCE_LABELS[key] || key,
          status: "error",
          count: 0,
          note: `读取失败: ${err.message}`,
        }),
      );
    }
  }

  return { used: true, items, sources };
}

async function readEventsJsonl(now) {
  let raw;
  try {
    raw = await readFile(EVENTS_PATH, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") return { used: false, items: [], sources: [] };
    throw err;
  }

  const items = [];
  const perSource = new Map();

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      console.warn("[build-community-data] skipped malformed line in events.jsonl");
      continue;
    }
    if (!obj || typeof obj !== "object") continue;
    if (!isTodayItem(obj, now, { allowUndated: false })) continue;
    items.push(obj);
    const key = String(obj.source || "");
    if (!key) continue;
    const prev = perSource.get(key) ?? 0;
    perSource.set(key, prev + 1);
  }

  const sources = [...perSource.entries()].map(([key, count]) =>
    sourceRecord({
      key,
      label: SOURCE_LABELS[key] || key,
      status: "ok",
      count,
      note: "from events.jsonl",
    }),
  );

  return { used: true, items, sources };
}

function payload({ generatedAt, shanghaiDate, sources, items }) {
  return {
    generatedAt,
    shanghaiDate,
    sources: mergeSources(sources),
    items,
  };
}

async function writePayload(data) {
  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

async function main() {
  const now = Date.now();
  const generatedAt = new Date(now).toISOString();
  const scoring = await loadScoring();
  const dateKey =
    typeof scoring?.shanghaiDateKey === "function"
      ? scoring.shanghaiDateKey(now)
      : shanghaiDateKey(now);
  const scoreMin =
    typeof scoring?.DISPLAY_COMMUNITY_SCORE_MIN === "number"
      ? scoring.DISPLAY_COMMUNITY_SCORE_MIN
      : FALLBACK_SCORE_MIN;

  const latest = await readLatest(now);
  const loaded = latest.used ? latest : await readEventsJsonl(now);
  const inputKind = latest.used
    ? "latest"
    : loaded.used
      ? "events.jsonl"
      : "none";

  if (!scoring) {
    const data = payload({
      generatedAt,
      shanghaiDate: dateKey,
      sources: loaded.sources,
      items: [],
    });
    await writePayload(data);
    console.warn(
      `[build-community-data] Wrote 0 items to ${OUT_PATH} ` +
        `(input=${inputKind}, candidates=${loaded.items.length}, scoring unavailable)`,
    );
    return;
  }

  let ranked;
  try {
    ranked = scoring.scoreAndRank(loaded.items, { now });
  } catch (err) {
    console.warn(
      `[build-community-data] scoreAndRank failed (${err.message}). Writing empty items.`,
    );
    const data = payload({
      generatedAt,
      shanghaiDate: dateKey,
      sources: loaded.sources,
      items: [],
    });
    await writePayload(data);
    return;
  }

  const scoredList = Array.isArray(ranked) ? ranked : ranked?.items ?? [];
  const usedSlugs = new Set();
  const items = scoredList
    .filter((item) => item && typeof item === "object")
    .filter((item) => isTodayItem(item, now, { allowUndated: true }))
    .filter((item) => Number(item.score) >= scoreMin)
    .filter((item) => String(item.name ?? "").trim())
    .map((item) => toOutputItem(item, itemSlug(item, usedSlugs)));

  const data = payload({
    generatedAt,
    shanghaiDate: dateKey,
    sources: loaded.sources,
    items,
  });
  await writePayload(data);

  console.log(
    `[build-community-data] Wrote ${items.length} items to ${OUT_PATH} ` +
      `(input=${inputKind}, candidates=${loaded.items.length}, ` +
      `min=${scoreMin}, dropped=${scoredList.length - items.length})`,
  );
}

main().catch((err) => {
  console.error("[build-community-data] Failed:", err);
  process.exitCode = 1;
});
