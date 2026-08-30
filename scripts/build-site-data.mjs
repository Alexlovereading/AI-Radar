// Run after scoring/score.mjs produces data/scored.json: node scripts/build-site-data.mjs
//
// Transforms data/scored.json (CONTRACT.md section 5 shape:
// Array<{ key, name, score, tier, items: NewItem[] }>) into the entity shape
// consumed by the site (CONTRACT.md section 6 / site/data/entities.json):
//
//   { slug, name, status, developer, officialModelId, score, lastVerified,
//     sources, isRumor }
//
// This script's whole job is to REGENERATE site/data/entities.json from
// data/scored.json each time it is run (full replace, not merge). Running it
// once data/scored.json exists will replace the current seed/sample entities
// (the "Ox Alpha" / "Claude Opus 5" examples) with real pipeline output.
//
// Compliance rule (non-negotiable): never invent developer, officialModelId,
// or any other fact without real source data backing it. Missing developer
// resolves to the literal string "unknown"; missing officialModelId resolves
// to null. Every heuristic below is documented as a heuristic.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { isLowSignalItem } from "../lib/signal-filter.mjs";
import { DISPLAY_SCORE_MIN } from "../scoring/score.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, "..");
const SCORED_PATH = path.join(PROJECT_ROOT, "data", "scored.json");
const ENTITIES_OUT_PATH = path.join(
  PROJECT_ROOT,
  "site",
  "data",
  "entities.json",
);

/**
 * Heuristic: slugify a group `key` into a URL-safe slug.
 * Lowercase, then any run of non-alphanumeric characters becomes a single
 * hyphen, and leading/trailing hyphens are trimmed.
 */
function slugify(key) {
  return String(key)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Heuristic: does this item's `meta` (or the item itself) carry something
 * that looks like a genuine official model identifier?
 *
 * We only trust `id` as a model identifier when the item's `category` is
 * "official-source" or "model-directory" — those are sources that actually
 * publish/host a specific model under a specific id (a vendor blog post, a
 * model-directory listing). For "community" or "trending" items (forum
 * threads, HN posts, trend signals) the `id` field per CONTRACT.md section 2
 * is just "该 source 内部唯一 id" — an internal post/thread id, NOT a model
 * identifier — so treating it as one would fabricate a fact we don't have.
 * This is intentionally conservative — a false negative (missing an ID) is
 * a display inconvenience, a false positive (fabricating an ID) is a
 * compliance failure.
 */
function extractOfficialModelId(item) {
  if (item?.category !== "official-source" && item?.category !== "model-directory") {
    return null;
  }
  const candidate = item?.meta?.id ?? item?.id;
  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  if (!trimmed) return null;
  return trimmed;
}

/**
 * Heuristic: derive `status` for a scored group from the categories present
 * across its items.
 *   - Any item with category === "official-source"  -> "confirmed"
 *     (the lab/vendor's own channel reported it directly)
 *   - Else, any item carrying what looks like a real official model id
 *     (see extractOfficialModelId) -> "public-preview"
 *     (it's listed/available somewhere with a concrete model id, but we
 *     have no official-source confirmation)
 *   - Else -> "unknown"
 *     (only community/directory chatter, no official id, no vendor source)
 */
function deriveStatus(items) {
  const hasOfficialSource = items.some(
    (item) => item.category === "official-source",
  );
  if (hasOfficialSource) return "confirmed";

  const hasOfficialModelId = items.some(
    (item) => extractOfficialModelId(item) !== null,
  );
  if (hasOfficialModelId) return "public-preview";

  return "unknown";
}

/**
 * Heuristic: derive `developer`. We only trust an official-source item's
 * `sourceLabel` (e.g. "OpenAI", "Anthropic") as a developer name, since that
 * category means the item came from the vendor's own blog/announcement
 * channel. Any other signal (directory listings, community posts) is not
 * strong enough to assert a developer, per the compliance requirement —
 * those resolve to the literal string "unknown".
 */
function deriveDeveloper(items) {
  const officialSourceItem = items.find(
    (item) => item.category === "official-source" && item.sourceLabel,
  );
  return officialSourceItem ? officialSourceItem.sourceLabel : "unknown";
}

/**
 * Heuristic: derive `officialModelId` from whichever item first carries one
 * (see extractOfficialModelId). null if none of the group's items carry one.
 */
function deriveOfficialModelId(items) {
  for (const item of items) {
    const id = extractOfficialModelId(item);
    if (id) return id;
  }
  return null;
}

/**
 * Heuristic: derive `isRumor`.
 *   - status === "confirmed" -> false (vendor confirmed it directly)
 *   - status === "unknown"   -> true  (nothing but unverified chatter)
 *   - status === "public-preview" -> true UNLESS we also have a confirmed
 *     developer (i.e. an official-source item backed it), in which case a
 *     public preview with a known vendor behind it isn't a bare rumor.
 *     Since deriveStatus only assigns "confirmed" when an official-source
 *     item exists, in practice "public-preview" here always pairs with
 *     developer === "unknown", so this resolves to true — this branch is
 *     kept explicit/documented in case deriveStatus's logic changes later.
 *   - status === "rumored" -> true
 */
function deriveIsRumor(status, developer) {
  if (status === "confirmed") return false;
  if (status === "public-preview") return developer === "unknown";
  return true;
}

function toEntity(group) {
  const items = Array.isArray(group.items) ? group.items : [];
  const status = deriveStatus(items);
  const developer = deriveDeveloper(items);

  return {
    slug: slugify(group.key),
    name: group.name,
    status,
    developer,
    officialModelId: deriveOfficialModelId(items),
    score: group.score,
    lastVerified: new Date().toISOString().slice(0, 10),
    sources: items.map((item) => ({
      label: item.sourceLabel,
      url: item.url,
    })),
    isRumor: deriveIsRumor(status, developer),
  };
}

async function main() {
  let scoredRaw;
  try {
    scoredRaw = await readFile(SCORED_PATH, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") {
      console.warn(
        `[build-site-data] ${SCORED_PATH} does not exist yet (scoring/score.mjs hasn't run). ` +
          `Leaving site/data/entities.json untouched.`,
      );
      return;
    }
    throw err;
  }

  const scored = JSON.parse(scoredRaw);
  if (!Array.isArray(scored)) {
    console.warn(
      `[build-site-data] ${SCORED_PATH} did not contain an array as expected. ` +
        `Leaving site/data/entities.json untouched.`,
    );
    return;
  }

  // Keep raw evidence and all scores in data/, but only publish useful signals.
  // An item must clear both gates: a meaningful radar score and at least one
  // non-junk source record.
  const visible = scored.filter(
    (group) =>
      group.score >= DISPLAY_SCORE_MIN &&
      (Array.isArray(group.items) ? group.items : []).some(
        (item) => !isLowSignalItem(item),
      ),
  );

  const entities = visible.map(toEntity);

  await writeFile(
    ENTITIES_OUT_PATH,
    JSON.stringify(entities, null, 2) + "\n",
    "utf-8",
  );

  console.log(
    `[build-site-data] Wrote ${entities.length} entities to ${ENTITIES_OUT_PATH} ` +
      `(filtered out ${scored.length - visible.length} below ${DISPLAY_SCORE_MIN} or low-signal)`,
  );
}

main().catch((err) => {
  console.error("[build-site-data] Failed:", err);
  process.exitCode = 1;
});
