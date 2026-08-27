// Scoring engine. Reads data/events.jsonl (one NewItem per line, appended over time by
// scripts/run-all.mjs), groups events into entities, scores each entity against the rule
// set from CONTRACT.md section 5 / the user's original spec, and writes data/scored.json.
//
// HONESTY NOTE (per project ground rule: never fabricate a signal): several of the rules
// in the spec have no real data source wired up yet (YouTube mentions, Google autocomplete,
// "beats a popular model on benchmarks", single-blogger-repost detection). Those are exposed
// as `manualOverrides` fields on each scored entity, always `null` unless a human fills them
// in later — they are NEVER guessed at or defaulted to a nonzero score contribution. Every
// other rule below is a real best-effort heuristic computed from actual event data; comments
// on each one explain exactly what signal it's approximating and where it can be wrong.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVENTS_PATH = path.join(ROOT, "data", "events.jsonl");
const SCORED_PATH = path.join(ROOT, "data", "scored.json");

// Sources that are genuinely "头部公司" (well-known frontier labs) official channels, per
// the CONTRACT.md manifest's official-sources group. Kept as an explicit allowlist rather
// than trusting category alone, since "official-source" is a broad bucket.
const MAJOR_LAB_SOURCES = new Set([
  "openai",
  "anthropic",
  "deepmind",
  "meta",
  "qwen",
  "deepseek",
  "xai",
  "mistral",
  "kimi",
  "zhipu",
  "minimax",
]);

const MODEL_DIRECTORY_SOURCES = new Set([
  "openrouter",
  "huggingface",
  "replicate",
  "together",
  "fireworks",
  "ollama",
  "falai",
  "artificial-analysis",
  "lmarena",
]);

// "一小时内多处独立讨论" (multiple independent discussions within an hour) is approximated
// as: the same entity shows up under >=2 distinct `source` values within this rolling
// window of the newest event we have for that entity. A strict 1-hour window is very tight
// given a 20-minute poll cadence (CONTRACT §... / .github/workflows/radar.yml), so this is
// widened to a few hours to actually have a chance of catching cross-source corroboration.
// This is a documented approximation, not the literal "1 hour" from the spec.
const CROSS_SOURCE_WINDOW_MS = 4 * 60 * 60 * 1000;

const TIER_THRESHOLDS = [
  { min: 80, tier: "full-site" },
  { min: 60, tier: "launch-today" },
  { min: 30, tier: "reserve" },
  { min: -Infinity, tier: "log-only" },
];

export async function scoreEvents({
  eventsPath = EVENTS_PATH,
  outPath = SCORED_PATH,
} = {}) {
  const events = await readEvents(eventsPath);
  const groups = groupByEntity(events);

  const scored = [...groups.values()]
    .map((group) => scoreEntity(group))
    .sort((a, b) => b.score - a.score);

  await writeFile(outPath, JSON.stringify(scored, null, 2) + "\n", "utf8");

  return scored;
}

async function readEvents(eventsPath) {
  let raw;
  try {
    raw = await readFile(eventsPath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }

  const events = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch (err) {
      console.warn(`[score] skipping malformed events.jsonl line: ${err.message}`);
    }
  }
  return events;
}

function groupByEntity(events) {
  const groups = new Map();
  for (const item of events) {
    if (!item?.name) continue;
    const key = normalizeKey(item.name);
    if (!groups.has(key)) groups.set(key, { key, name: item.name, items: [] });
    groups.get(key).items.push(item);
  }
  return groups;
}

// NOTE: this is exact (post-normalization) name matching, not fuzzy/substring matching.
// "GPT-6" and "GPT-6 pricing announced" normalize to different keys and end up as separate
// entities, even though a human would read the second as being about the first. Fixing that
// would need real entity extraction (NER or a known-model-name index) which is out of scope
// here — documented as a real limitation of the grouping, not silently papered over.
export function normalizeKey(name) {
  return String(name)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function scoreEntity(group) {
  const { key, items } = group;
  // Prefer the earliest-seen display name so it stays stable across runs.
  const name = [...items].sort((a, b) =>
    (a.detectedAt ?? "") < (b.detectedAt ?? "") ? -1 : 1
  )[0].name;

  const breakdown = [];
  let score = 0;

  const add = (points, label) => {
    score += points;
    breakdown.push({ points, label });
  };

  // +30 头部公司正式发布: any event from a known frontier lab's official-source scraper.
  if (items.some((it) => it.category === "official-source" && MAJOR_LAB_SOURCES.has(it.source))) {
    add(30, "official announcement from a major lab");
  }

  // +15 上线主流模型平台: any event from a known model-directory scraper.
  if (items.some((it) => it.category === "model-directory" && MODEL_DIRECTORY_SOURCES.has(it.source))) {
    add(15, "listed on a mainstream model directory");
  }

  // +15 免费或明显低价: best-effort heuristic on meta.pricing. Only fires when pricing data
  // is actually present and looks free/near-zero — never assumed when pricing is absent.
  if (items.some((it) => looksFreeOrCheap(it.meta?.pricing))) {
    add(15, "pricing metadata indicates free or very low cost");
  }

  // 性能超过热门模型: NO reliable signal available (no benchmark-comparison source wired
  // up). Left as a manual override field below — intentionally NOT scored here.

  // +15 一小时内多处独立讨论: >=2 distinct sources for this entity within CROSS_SOURCE_WINDOW_MS
  // of each other (approximated window, see constant comment above).
  if (hasCrossSourceCorroboration(items)) {
    add(15, "corroborated by >=2 independent sources in a short window");
  }

  // YouTube 教程出现: no YouTube scraper exists in this project. Manual override field only.

  // +15 出现 pricing/API 问题: heuristic on item name/title text mentioning pricing/API/setup.
  if (items.some((it) => /\b(pricing|api|how to use)\b/i.test(it.name ?? ""))) {
    add(15, "title text mentions pricing/API/how-to-use");
  }

  // Google 自动补全出现: no autocomplete-scraping signal wired up. Manual override field only.

  // 单个博主转载 -15: cannot reliably distinguish "a single blogger reposting" from a
  // legitimate first mention with current fields (would need author-influence/reach data
  // we don't have). Manual override field only, not scored automatically.

  // -10 无公开使用入口: model-directory items with no usable url, or explicit "waitlist"
  // language in the name — best-effort signal for "not actually accessible yet".
  if (
    items.some(
      (it) =>
        it.category === "model-directory" &&
        (!it.url || /waitlist/i.test(it.name ?? ""))
    )
  ) {
    add(-10, "no public access point (missing url / waitlist)");
  }

  // -10 只是内部代号或传闻: name/id contains "stealth", or no item carries a confirmed
  // meta.officialModelId anywhere. This is an approximation — officialModelId is not part
  // of the core NewItem shape, only an optional meta field some scrapers may set.
  const hasStealthMarker = items.some(
    (it) => /stealth/i.test(it.name ?? "") || /stealth/i.test(it.id ?? "")
  );
  const hasConfirmedModelId = items.some((it) => Boolean(it.meta?.officialModelId));
  if (hasStealthMarker || !hasConfirmedModelId) {
    add(-10, hasStealthMarker ? "name/id suggests a stealth/codename release" : "no confirmed official model id across events");
  }

  const tier = TIER_THRESHOLDS.find((t) => score >= t.min).tier;

  return {
    key,
    name,
    score,
    tier,
    breakdown,
    // Signals the spec calls for that this pass has no real data source for. Always null
    // until a human (or a future scraper) fills them in — never guessed.
    manualOverrides: {
      beatsPopularModelOnBenchmark: null, // 性能超过热门模型
      youtubeTutorialAppeared: null, // YouTube 教程出现
      googleAutocompleteAppeared: null, // Google 自动补全出现
      singleBloggerRepost: null, // 单个博主转载 (-15 if a human confirms it)
    },
    items,
  };
}

function looksFreeOrCheap(pricing) {
  if (pricing == null) return false;
  if (typeof pricing === "string") return /\bfree\b/i.test(pricing);
  if (typeof pricing === "number") return pricing === 0;
  if (typeof pricing === "object") {
    const values = Object.values(pricing).filter((v) => typeof v === "number");
    if (values.length > 0 && values.every((v) => v === 0)) return true;
    const strings = Object.values(pricing).filter((v) => typeof v === "string");
    return strings.some((v) => /\bfree\b/i.test(v));
  }
  return false;
}

function hasCrossSourceCorroboration(items) {
  const sorted = [...items].sort((a, b) =>
    new Date(a.detectedAt ?? 0) - new Date(b.detectedAt ?? 0)
  );
  for (let i = 0; i < sorted.length; i++) {
    const windowStart = new Date(sorted[i].detectedAt ?? 0).getTime();
    const sourcesInWindow = new Set();
    for (let j = i; j < sorted.length; j++) {
      const t = new Date(sorted[j].detectedAt ?? 0).getTime();
      if (t - windowStart > CROSS_SOURCE_WINDOW_MS) break;
      sourcesInWindow.add(sorted[j].source);
    }
    if (sourcesInWindow.size >= 2) return true;
  }
  return false;
}

// Allow running directly: `node scoring/score.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  scoreEvents().then((scored) => {
    console.log(`[score] wrote ${scored.length} scored entities to ${SCORED_PATH}`);
  });
}
