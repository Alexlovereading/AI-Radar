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
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  hasTraction,
  isAiRelated,
  isMajorOrg,
} from "../lib/signal-filter.mjs";

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

// Items below this score stay in the append-only history but are not sent to the site.
// This keeps the dashboard focused without destroying raw evidence.
export const DISPLAY_SCORE_MIN = 20;

const TIER_THRESHOLDS = [
  { min: 70, tier: "full-site" },
  { min: 50, tier: "launch-today" },
  { min: 30, tier: "reserve" },
  { min: -Infinity, tier: "log-only" },
];

const TRUSTED_DIRECTORY_SOURCES = new Set([
  "openrouter",
  "lmarena",
  "artificial-analysis",
]);

// Community / trending sources belong to the separate community radar. Model scoring
// ignores them (history in events.jsonl is left intact) so official + directory
// signals are not mixed with HN/GitHub/Reddit/etc. noise.
const COMMUNITY_OR_TRENDING_SOURCES = new Set([
  "hackernews",
  "github-trending",
  "reddit",
  "google-trends",
  "producthunt",
  "chrome-web-store",
  "appsumo",
]);

const MODEL_FAMILY_PATTERN =
  /\b(gpt[-\s]?[0-9a-z.]*|o[134]\b|claude|gemini|gemma|llama|deepseek|qwen|mistral|mixtral|grok|kimi|glm|minimax|phi[-\s]?\d|command[-\s]?r|ernie|hunyuan|yi[-\s]?\d|falcon|olmo|veo|sora|imagen|stable diffusion|flux|wan[-\s]?\d|ltx[-\s]?\d)\b/i;
const VERSION_PATTERN = /\b(?:v?\d+(?:\.\d+){0,2}|flash|pro|ultra|max|mini|nano|preview)\b/i;
const RELEASE_ACTION_PATTERN =
  /\b(launch(?:ed|es|ing)?|introduc(?:e|ed|es|ing)|announc(?:e|ed|es|ing)|releas(?:e|ed|es|ing)|preview(?:ed|s|ing)?|unveil(?:ed|s|ing)?|now available|open[- ]source[ds]?)\b/i;
const IMPORTANT_NEWS_PATTERN =
  /\b(api|platform|standard|benchmark|evaluation|safety|security|partnership|acquisition|funding|pricing|availability|developer|research)\b/i;

export async function scoreEvents({
  eventsPath = EVENTS_PATH,
  outPath = SCORED_PATH,
} = {}) {
  const events = await readEvents(eventsPath);
  // Skip community/trending rows before grouping. events.jsonl is append-only
  // history and is never rewritten here — those items are simply not scored.
  const groups = groupByEntity(events.filter((item) => !isCommunityOrTrendingEvent(item)));

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

function isCommunityOrTrendingEvent(item) {
  return (
    item?.category === "community" ||
    item?.category === "trending" ||
    COMMUNITY_OR_TRENDING_SOURCES.has(item?.source)
  );
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

  const officialItems = items.filter(
    (it) => it.category === "official-source" && MAJOR_LAB_SOURCES.has(it.source)
  );
  const directoryItems = items.filter(
    (it) => it.category === "model-directory" && MODEL_DIRECTORY_SOURCES.has(it.source)
  );
  const allText = items
    .map((it) => `${it.name ?? ""} ${it.meta?.description ?? ""} ${it.meta?.contentSnippet ?? ""}`)
    .join(" ");

  // Official channels are not all equally important. A named/versioned model release is
  // actionable; a platform/API announcement is notable; routine company/news posts remain
  // in history but normally stay below the site's display threshold.
  if (officialItems.length > 0) {
    const officialText = officialItems
      .map((it) => `${it.name ?? ""} ${it.meta?.contentSnippet ?? ""}`)
      .join(" ");
    if (looksLikeModelRelease(officialText)) {
      add(55, "major lab announced a named or versioned model");
    } else if (
      RELEASE_ACTION_PATTERN.test(officialText) ||
      IMPORTANT_NEWS_PATTERN.test(officialText)
    ) {
      add(35, "important announcement from a major lab");
    } else {
      add(15, "routine update from a major lab");
    }
  }

  if (directoryItems.length > 0) {
    add(15, "listed on a mainstream model directory");

    if (
      directoryItems.some(
        (it) => TRUSTED_DIRECTORY_SOURCES.has(it.source) || isMajorOrg(it.id ?? it.name)
      )
    ) {
      add(10, "trusted directory or major model publisher");
    }

    if (looksLikeModelRelease(allText)) {
      add(10, "name looks like a distinct model/version release");
    }
  }

  // Measured traction. Hugging Face and LM Arena expose real usage/engagement fields;
  // no points are guessed when a source does not provide them.
  if (items.some((it) => hasStrongTraction(it.meta))) {
    add(15, "strong measured adoption or engagement");
  } else if (items.some((it) => hasTraction(it.meta))) {
    add(8, "early measured adoption or engagement");
  }

  if (items.some((it) => isStrongLeaderboardEntry(it.meta))) {
    add(20, "strong LM Arena rank backed by substantial votes");
  }

  // Community/trending items receive no automatic source points. They need a clearly
  // AI/model-related title and real engagement before they can reach the display bar.
  if (officialItems.length === 0 && directoryItems.length === 0 && isAiRelated(allText)) {
    add(5, "AI-related community or trend signal");
    if (looksLikeModelRelease(allText)) add(5, "community item discusses a model/version");
    const engagement = bestCommunityEngagement(items);
    if (engagement >= 150) add(15, "high community engagement");
    else if (engagement >= 50) add(10, "meaningful community engagement");
  }

  // Free or clearly near-zero pricing is useful, but it supplements release evidence
  // rather than turning an otherwise weak item into a recommendation by itself.
  if (items.some((it) => looksFreeOrCheap(it.meta?.pricing))) {
    add(10, "pricing metadata indicates free or very low cost");
  }

  // 性能超过热门模型: NO reliable signal available (no benchmark-comparison source wired
  // up). Left as a manual override field below — intentionally NOT scored here.

  // +15 一小时内多处独立讨论: >=2 distinct sources for this entity within CROSS_SOURCE_WINDOW_MS
  // of each other (approximated window, see constant comment above).
  if (hasCrossSourceCorroboration(items)) {
    add(20, "corroborated by >=2 independent sources in a short window");
  }

  // YouTube 教程出现: no YouTube scraper exists in this project. Manual override field only.

  // Pricing/API interest is supporting evidence, not a primary release signal.
  if (items.some((it) => /\b(pricing|api|how to use)\b/i.test(it.name ?? ""))) {
    add(5, "title text mentions pricing/API/how-to-use");
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

  // Only explicit stealth/codename wording is penalized. Missing officialModelId is not:
  // most current scrapers do not populate that optional field, so the old blanket penalty
  // incorrectly punished almost every legitimate item.
  const hasStealthMarker = items.some(
    (it) =>
      /\b(stealth|codename|rumou?r(?:ed)?)\b/i.test(it.name ?? "") ||
      /\b(stealth|codename|rumou?r(?:ed)?)\b/i.test(it.id ?? "")
  );
  if (hasStealthMarker) {
    add(-10, "name suggests a stealth, codename, or rumored release");
  }

  if (items.every((it) => isStaleDirectoryEntry(it))) {
    add(-20, "directory entry predates detection by more than 90 days");
  }

  // Radar confidence is a 0–100 signal, not a quality rating. Never display negatives.
  score = Math.max(0, Math.min(100, score));
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
    const values = Object.values(pricing)
      .map((v) => (typeof v === "number" ? v : Number(v)))
      .filter(Number.isFinite);
    if (values.length > 0 && values.every((v) => v === 0)) return true;
    const strings = Object.values(pricing).filter((v) => typeof v === "string");
    return strings.some((v) => /\bfree\b/i.test(v));
  }
  return false;
}

function looksLikeModelRelease(text) {
  return (
    MODEL_FAMILY_PATTERN.test(text) &&
    (VERSION_PATTERN.test(text) || RELEASE_ACTION_PATTERN.test(text))
  );
}

function hasStrongTraction(meta) {
  const likes = Number(meta?.likes ?? 0);
  const downloads = Number(meta?.downloads ?? 0);
  return likes >= 100 || downloads >= 10_000;
}

function isStrongLeaderboardEntry(meta) {
  const rank = Number(meta?.rank);
  const votes = Number(meta?.voteCount);
  return Number.isFinite(rank) && rank <= 50 && Number.isFinite(votes) && votes >= 500;
}

function bestCommunityEngagement(items) {
  return Math.max(
    0,
    ...items.map((it) =>
      Math.max(
        Number(it.meta?.points ?? 0),
        Number(it.meta?.starsToday ?? 0),
        Number(it.meta?.approxTraffic ?? 0)
      )
    )
  );
}

// Publish/update-date coverage by source (verified against each scraper's meta shape):
//   falai (meta.date), artificial-analysis (meta.releaseDate),
//   lmarena (meta.leaderboardPublishDate), ollama (meta.updatedAt),
//   fireworks (meta.createTime).
// huggingface, openrouter, replicate, and together expose no publish/release-date
// signal at all (pipeline_tag/downloads/likes, pricing/context_length, etc.), so this
// check is always false — and therefore never contributes the -20 penalty — for those
// four sources. That's the correct safe default when staleness can't be determined,
// not evidence those entries are fresh.
function isStaleDirectoryEntry(item) {
  if (item?.category !== "model-directory") return false;
  const dateValue =
    item.meta?.date ??
    item.meta?.releaseDate ??
    item.meta?.leaderboardPublishDate ??
    item.meta?.updatedAt ??
    item.meta?.createTime;
  if (!dateValue) return false;
  const published = new Date(dateValue).getTime();
  const detected = new Date(item.detectedAt ?? 0).getTime();
  if (!Number.isFinite(published) || !Number.isFinite(detected)) return false;
  return detected - published > 90 * 24 * 60 * 60 * 1000;
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
// Compare via pathToFileURL / fileURLToPath so paths with spaces (e.g. "AI Radar") match.
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]))
) {
  scoreEvents().then((scored) => {
    console.log(`[score] wrote ${scored.length} scored entities to ${SCORED_PATH}`);
  });
}
