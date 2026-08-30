// Data-access layer for site/data/community-signals.json.
//
// The JSON is imported directly at build time rather than read via node:fs at
// request time, so this module works on edge/Workers runtimes with no runtime
// filesystem (e.g. Cloudflare Pages) as well as on Node — see site/lib/entities.mjs
// for the full rationale. That does mean the file must exist at build time (it's
// committed to git by the pipeline, same as site/data/entities.json); what this
// module still guards against is the *content* being missing/malformed shape-wise
// (e.g. `{}` or a stale payload with fields renamed), via normalize() below.

import signalsData from "../data/community-signals.json";

/**
 * @typedef {object} CommunitySource
 * @property {string} key
 * @property {string} label
 * @property {"ok"|"skipped"|"error"} status
 * @property {number} count
 * @property {string} note
 */

/**
 * @typedef {object} CommunityBreakdown
 * @property {number} points
 * @property {string} label
 */

/**
 * @typedef {object} CommunityItem
 * @property {string} slug
 * @property {string} name
 * @property {string} url
 * @property {string} source
 * @property {string} sourceLabel
 * @property {string} [category]
 * @property {number} score
 * @property {"spotlight"|"watch"|string} tier
 * @property {CommunityBreakdown[]} breakdown
 * @property {Record<string, unknown>} meta
 * @property {string} detectedAt
 */

/**
 * @typedef {object} CommunitySignals
 * @property {string} generatedAt
 * @property {string} shanghaiDate
 * @property {CommunitySource[]} sources
 * @property {CommunityItem[]} items
 */

const EMPTY = Object.freeze({
  generatedAt: "",
  shanghaiDate: "",
  sources: [],
  items: [],
});

const SOURCE_STATUSES = new Set(["ok", "skipped", "error"]);

function asString(value) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function asNumber(value) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeSource(raw) {
  if (!raw || typeof raw !== "object") return null;
  const status = SOURCE_STATUSES.has(raw.status) ? raw.status : "ok";
  return {
    key: asString(raw.key),
    label: asString(raw.label) || asString(raw.key) || "未知来源",
    status,
    count: asNumber(raw.count),
    note: asString(raw.note),
  };
}

function normalizeBreakdown(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    points: asNumber(raw.points),
    label: asString(raw.label),
  };
}

function normalizeItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = asString(raw.name);
  if (!name) return null;
  const meta = raw.meta && typeof raw.meta === "object" && !Array.isArray(raw.meta) ? raw.meta : {};
  const breakdown = Array.isArray(raw.breakdown)
    ? raw.breakdown.map(normalizeBreakdown).filter(Boolean)
    : [];
  return {
    slug: asString(raw.slug),
    name,
    url: asString(raw.url),
    source: asString(raw.source),
    sourceLabel: asString(raw.sourceLabel) || asString(raw.source) || "社区来源",
    category: asString(raw.category),
    score: asNumber(raw.score),
    tier: asString(raw.tier),
    breakdown,
    meta,
    detectedAt: asString(raw.detectedAt),
  };
}

function normalize(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ...EMPTY };
  return {
    generatedAt: asString(data.generatedAt),
    shanghaiDate: asString(data.shanghaiDate),
    sources: Array.isArray(data.sources) ? data.sources.map(normalizeSource).filter(Boolean) : [],
    items: Array.isArray(data.items) ? data.items.map(normalizeItem).filter(Boolean) : [],
  };
}

/**
 * Load today's community hotspot payload.
 * @returns {Promise<CommunitySignals>}
 */
export async function loadCommunitySignals() {
  return normalize(signalsData);
}
