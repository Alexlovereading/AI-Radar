// Hard filter for community / trending sources (HN, GitHub Trending, Reddit,
// Google Trends, Product Hunt, Chrome Web Store, AppSumo).
//
// Separate from lib/signal-filter.mjs, which is tuned for Hugging Face junk and
// a broad `\bai\b` match. Community posts need a stricter "is this actually about
// models / agents / releases / OSS?" check, plus same-calendar-day (Asia/Shanghai)
// and an importance signal before anything is scored for the community page.

export const COMMUNITY_SOURCES = new Set([
  "hackernews",
  "github-trending",
  "reddit",
  "google-trends",
  "producthunt",
  "chrome-web-store",
  "appsumo",
]);

const SHANGHAI = "Asia/Shanghai";

const MODEL_OR_LAB_PATTERN =
  /\b(gpt[-\s]?[0-9a-z.]*|chatgpt|claude|gemini|gemma|deepseek|qwen|mistral|mixtral|llama|grok|kimi|glm|minimax|phi[-\s]?\d|command[-\s]?r|ernie|hunyuan|falcon|olmo|veo|sora|imagen|flux|stable[\s-]?diffusion|midjourney|copilot|cursor|windsurf|openai|anthropic|deepmind|huggingface|hugging\s?face|meta[- ]?llama|mistralai|xai)\b/i;

const AI_SUBSTANCE_PATTERN =
  /\b(llm|large language model|language model|foundation model|multimodal|transformer|neural network|machine learning|deep learning|generative ai|genai|artificial intelligence|agentic|ai agents?|coding agents?|autonomous agents?|rag|retrieval[- ]augmented|inference|reasoning|chain[- ]of[- ]thought|fine[- ]?tun(?:e|ing)|benchmark|leaderboard|eval(?:uation|s)?|open[- ]source(?:d)?|vllm|ollama|langchain|llamaindex|mcp|tool[- ]use|coding assistant|text[- ]to[- ](?:image|video|speech)|diffusion model|whisper|embedding|tokenizer|context window|mixture of experts|moe|人工智能|大模型|智能体|推理模型|评测)\b/i;

const WEAK_AI_PATTERN = /\b(ai|a\.i\.|人工智能|大模型)\b/i;

const TECH_CONTEXT_PATTERN =
  /\b(model|models|llm|agent|agents|agentic|api|sdk|github|open[- ]source|release|launch|benchmark|eval|chatbot|copilot|prompt|token|inference|reasoning|rag|fine[- ]?tune)\b/i;

const VERSION_PATTERN =
  /\b(?:v?\d+(?:\.\d+){0,2}|flash|pro|ultra|max|mini|nano|preview|opus|sonnet|haiku)\b/i;

const RELEASE_ACTION_PATTERN =
  /\b(launch(?:ed|es|ing)?|introduc(?:e|ed|es|ing)|announc(?:e|ed|es|ing)|releas(?:e|ed|es|ing)|preview(?:ed|s|ing)?|unveil(?:ed|s|ing)?|now available|open[- ]source[ds]?|shipping|发布|开源)\b/i;

const JOB_PATTERN =
  /\b(hiring|we'?re hiring|jobs?\b|career[s]?\b|recruiter|internship|looking for (an? )?(engineer|developer|researcher)|职位|招聘|招人|内推)\b/i;

const TUTORIAL_PATTERN =
  /\b(tutorial|how[- ]to\b|beginner'?s? guide|crash course|learn .{0,40} in \d+|step[- ]by[- ]step|for dummies|教程|入门|从零|小白)\b/i;

const AWESOME_PATTERN =
  /\bawesome[-_]|awesome\s+list|curated\s+list|资源合集|合集\b/i;

const MARKETING_PATTERN =
  /\b(discount code|coupon|limited[- ]time offer|buy now|promo code|affiliate link|优惠码|促销|限时优惠)\b/i;

const REPOST_PATTERN =
  /\b(\[?(re[- ]?post|repost)\]?|x[- ]?post|cross[- ]?post|转发|转载)\b/i;

const CHATTER_PATTERN =
  /\b(shower thoughts?|hot take|unpopular opinion|what if ai\b|ai will (replace|take over)|just my (2 cents|thoughts)|daily discussion|casual chat|泛谈)\b/i;

export function shanghaiDateKey(now = Date.now()) {
  const ts = typeof now === "number" ? now : parseTimestamp(now);
  const date = new Date(Number.isFinite(ts) ? ts : Date.now());
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function isTodayShanghai(isoOrUnix, now = Date.now()) {
  const ts = parseTimestamp(isoOrUnix);
  if (ts == null) return false;
  return shanghaiDateKey(ts) === shanghaiDateKey(now);
}

export function parseTimestamp(isoOrUnix) {
  if (isoOrUnix == null || isoOrUnix === "") return null;
  if (isoOrUnix instanceof Date) {
    const ms = isoOrUnix.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof isoOrUnix === "number") {
    if (!Number.isFinite(isoOrUnix)) return null;
    return isoOrUnix < 1e12 ? isoOrUnix * 1000 : isoOrUnix;
  }
  const s = String(isoOrUnix).trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    return n < 1e12 ? n * 1000 : n;
  }
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? parsed : null;
}

export function communityItemText(item) {
  if (typeof item === "string") return item;
  const meta = item?.meta ?? {};
  return [
    item?.name,
    item?.id,
    meta.description,
    meta.contentSnippet,
    meta.tagline,
    meta.title,
  ]
    .filter(Boolean)
    .join(" ");
}

export function isAiRelatedCommunity(text) {
  const s = String(text ?? "");
  if (!s.trim()) return false;
  if (MODEL_OR_LAB_PATTERN.test(s) || AI_SUBSTANCE_PATTERN.test(s)) return true;
  if (WEAK_AI_PATTERN.test(s) && TECH_CONTEXT_PATTERN.test(s)) return true;
  const compact = s.trim();
  if (compact.length <= 24 && WEAK_AI_PATTERN.test(compact)) return true;
  return false;
}

export function isJunkCommunityItem(item) {
  const name = String(item?.name ?? "");
  const text = communityItemText(item);
  if (JOB_PATTERN.test(name) || JOB_PATTERN.test(text)) return true;
  if (AWESOME_PATTERN.test(name) || AWESOME_PATTERN.test(text)) return true;
  if (TUTORIAL_PATTERN.test(name) || TUTORIAL_PATTERN.test(text)) return true;
  if (MARKETING_PATTERN.test(text)) return true;
  if (REPOST_PATTERN.test(name) || REPOST_PATTERN.test(text)) return true;
  if (CHATTER_PATTERN.test(text) && !looksLikeNewModel(text) && !looksLikeImportantRelease(item)) {
    return true;
  }
  return false;
}

export function looksLikeNewModel(text) {
  const s = String(text ?? "");
  return MODEL_OR_LAB_PATTERN.test(s) && (VERSION_PATTERN.test(s) || RELEASE_ACTION_PATTERN.test(s));
}

export function looksLikeImportantRelease(item, text = communityItemText(item)) {
  const s = String(text ?? "");
  if (RELEASE_ACTION_PATTERN.test(s) && isAiRelatedCommunity(s)) return true;
  const source = item?.source;
  if (
    source === "producthunt" ||
    source === "chrome-web-store" ||
    source === "appsumo"
  ) {
    return isAiRelatedCommunity(s);
  }
  return false;
}

export function looksLikeHotProject(item) {
  const meta = item?.meta ?? {};
  switch (item?.source) {
    case "github-trending":
      return true;
    case "hackernews":
      return toNumber(meta.points) >= 15 || toNumber(meta.comments) >= 8;
    case "reddit":
      return toNumber(meta.score) >= 20 || toNumber(meta.num_comments) >= 10;
    case "producthunt":
      return toNumber(meta.votes) >= 15;
    case "chrome-web-store":
      return toNumber(meta.users) >= 1000 || toNumber(meta.reviews) >= 20;
    case "appsumo":
      return toNumber(meta.users) > 0 || toNumber(meta.reviews) > 0;
    default:
      return false;
  }
}

export function looksLikeTrendSpike(item) {
  if (item?.source === "google-trends") return true;
  return toNumber(item?.meta?.approxTraffic) >= 10_000;
}

export function hasHighlightSignal(item) {
  const text = communityItemText(item);
  return (
    looksLikeNewModel(text) ||
    looksLikeImportantRelease(item, text) ||
    looksLikeHotProject(item) ||
    looksLikeTrendSpike(item)
  );
}

export function passesHardFilter(item, now = Date.now()) {
  if (!item || !COMMUNITY_SOURCES.has(item.source)) return false;
  const ts = resolveItemTime(item);
  if (ts == null || !isTodayShanghai(ts, now)) return false;
  const text = communityItemText(item);
  if (!isAiRelatedCommunity(text)) return false;
  if (isJunkCommunityItem(item)) return false;
  return hasHighlightSignal(item);
}

export function normalizeCommunityKey(item) {
  const nameKey = normalizeName(item?.name);
  const urlKey = canonicalizeUrl(item?.url);
  if (nameKey.length >= 4) return nameKey;
  if (urlKey) return urlKey;
  return nameKey || String(item?.id ?? "");
}

export function resolveItemTime(item) {
  const meta = item?.meta ?? {};
  const preferred = [
    meta.createdAt,
    meta.created_at,
    meta.created_utc,
    meta.pubDate,
    meta.publishedAt,
    meta.date,
  ];
  for (const value of preferred) {
    const ts = parseTimestamp(value);
    if (ts != null) return ts;
  }
  return parseTimestamp(item?.detectedAt);
}

function normalizeName(name) {
  return String(name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "")
    .trim();
}

function canonicalizeUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    return `${host}${path}`;
  } catch {
    return String(url).toLowerCase().replace(/\/+$/, "");
  }
}

export function toNumber(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const s = String(value).trim().replace(/,/g, "").replace(/\+/g, "");
  const m = s.match(/^([\d.]+)\s*([kmb])?$/i);
  if (!m) {
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return 0;
  const unit = (m[2] || "").toLowerCase();
  const mul = unit === "k" ? 1e3 : unit === "m" ? 1e6 : unit === "b" ? 1e9 : 1;
  return n * mul;
}
