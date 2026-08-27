// OpenRouter model directory scraper.
// GET /api/v1/models is public, no auth required. Confirmed live shape (2026-08-27):
// { data: [{ id, canonical_slug, hugging_face_id, name, created, description,
//            context_length, architecture, pricing, top_provider, ... }] }
// No official RSS feed exists for OpenRouter (their FAQ points to Discord instead),
// so the REST endpoint is the only source here.

import { diffAndSave } from "../../lib/snapshot.mjs";

const SOURCE_KEY = "openrouter";
const API_URL = "https://openrouter.ai/api/v1/models";

export default async function run() {
  let json;
  try {
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = await res.json();
  } catch (err) {
    console.warn(`[${SOURCE_KEY}] fetch failed: ${err.message}`);
    return [];
  }

  const list = Array.isArray(json?.data) ? json.data : [];

  const fresh = list
    .filter((m) => m?.id)
    .map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      url: `https://openrouter.ai/${m.id}`,
      meta: {
        pricing: m.pricing ?? null,
        context_length: m.context_length ?? null,
      },
    }));

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
    sourceLabel: "OpenRouter",
    category: "model-directory",
    id: item.id,
    name: item.name,
    url: item.url,
    detectedAt: new Date().toISOString(),
    meta: item.meta ?? {},
  };
}
