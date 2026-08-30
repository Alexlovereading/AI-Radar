// HuggingFace model directory scraper.
//
// Primary source: GET /api/models?sort=createdAt&direction=-1&limit=100 — confirmed live
// (2026-08-27), returns a flat array sorted newest-first. Each item confirmed to carry
// `id` (aka `modelId`), `createdAt`, `likes`, `downloads`. NOTE: `pipeline_tag` is NOT
// always present in this endpoint's response (missing on several observed items), so it
// is treated as optional/nullable below rather than assumed.
//
// Secondary source: GET /api/trending?type=model&limit=20 — confirmed live, but the shape
// is nested and different from the models endpoint:
//   { recentlyTrending: [{ repoData: { id, author, downloads, likes, pipeline_tag,
//                                       lastModified, ... }, repoType }] }
// The model id lives at `repoData.id`, not top-level. Both sources use the same id format
// (e.g. "org/model-name"), so they are merged into one map keyed by id before diffing.
// The createdAt-sorted endpoint is the priority signal for "new model" detection; trending
// is merged in as a bonus signal and may surface items missing from the first page of the
// createdAt list.

import { diffAndSave } from "../../lib/snapshot.mjs";
import { isMajorOrg, matchesJunkPattern } from "../../lib/signal-filter.mjs";

const SOURCE_KEY = "huggingface";
const MODELS_URL =
  "https://huggingface.co/api/models?sort=createdAt&direction=-1&limit=100";
const TRENDING_URL = "https://huggingface.co/api/trending?type=model&limit=20";

export default async function run() {
  const merged = new Map();

  // Primary: newest-created models.
  try {
    const res = await fetch(MODELS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const list = Array.isArray(json) ? json : [];
    for (const m of list) {
      const id = m?.id ?? m?.modelId;
      if (!id) continue;
      // The createdAt feed is dominated by test repos, fine-tunes and quant
      // conversions (hundreds/hour). Only major-org repos are newsworthy here;
      // everything else needs trending traction (secondary feed) to surface.
      if (!isMajorOrg(id)) continue;
      merged.set(id, {
        id,
        name: id,
        url: `https://huggingface.co/${id}`,
        meta: {
          pipeline_tag: m.pipeline_tag ?? null,
          downloads: m.downloads ?? null,
          likes: m.likes ?? null,
        },
      });
    }
  } catch (err) {
    console.warn(`[${SOURCE_KEY}] createdAt-sorted fetch failed: ${err.message}`);
  }

  // Secondary: trending models (merged in, doesn't block on failure).
  try {
    const res = await fetch(TRENDING_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const list = Array.isArray(json?.recentlyTrending) ? json.recentlyTrending : [];
    for (const entry of list) {
      const repo = entry?.repoData;
      const id = repo?.id;
      if (!id) continue;
      // Trending already implies traction, but obvious junk (test repos, quant
      // conversions, adapters) is still not a "new model" worth reporting.
      if (matchesJunkPattern(id)) continue;
      if (merged.has(id)) continue; // primary source already has full data for this id
      merged.set(id, {
        id,
        name: id,
        url: `https://huggingface.co/${id}`,
        meta: {
          pipeline_tag: repo.pipeline_tag ?? null,
          downloads: repo.downloads ?? null,
          likes: repo.likes ?? null,
        },
      });
    }
  } catch (err) {
    console.warn(`[${SOURCE_KEY}] trending fetch failed: ${err.message}`);
  }

  const fresh = [...merged.values()];

  // Both source fetches failed — nothing to diff against, bail out cleanly.
  if (fresh.length === 0) {
    return [];
  }

  let added;
  try {
    added = await diffAndSave(SOURCE_KEY, fresh);
  } catch (err) {
    console.warn(`[${SOURCE_KEY}] diffAndSave failed: ${err.message}`);
    return [];
  }

  return added.map(toNewItem);
}

function toNewItem(item) {
  return {
    source: SOURCE_KEY,
    sourceLabel: "Hugging Face",
    category: "model-directory",
    id: item.id,
    name: item.name,
    url: item.url,
    detectedAt: new Date().toISOString(),
    meta: item.meta ?? {},
  };
}
