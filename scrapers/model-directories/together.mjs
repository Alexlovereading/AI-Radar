// Together AI model directory scraper.
//
// GET /v1/models — tried unauthenticated first. Confirmed live (2026-08-27) that without
// an API key this returns HTTP 401 with a *plain-text* body ("Missing API key"), not JSON,
// so error responses are read as text rather than parsed as JSON. Could not verify the
// authenticated success response shape (no TOGETHER_API_KEY available in this environment)
// — CONTRACT/task notes say each item has an `id` field and pricing info, so field access
// below is defensive/optional-chained rather than assumed.

import { diffAndSave } from "../../lib/snapshot.mjs";

const SOURCE_KEY = "together";
const API_URL = "https://api.together.ai/v1/models";

export default async function run() {
  let json;
  try {
    json = await fetchModels();
  } catch (err) {
    console.warn(`[${SOURCE_KEY}] fetch failed: ${err.message}`);
    return [];
  }

  if (json === null) {
    // Unauthenticated call was rejected and no TOGETHER_API_KEY was available to retry with.
    console.warn(
      `[${SOURCE_KEY}] request unauthorized and TOGETHER_API_KEY not set, skipping together scraper`
    );
    return [];
  }

  const list = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];

  const fresh = list
    .filter((m) => m?.id)
    .map((m) => ({
      id: m.id,
      name: m?.display_name ?? m?.name ?? m.id,
      url: `https://api.together.xyz/models/${m.id}`,
      meta: {
        // Pricing schema unverified — keep the raw object if present, otherwise null.
        pricing: m?.pricing ?? null,
        context_length: m?.context_length ?? m?.context_window ?? null,
        type: m?.type ?? null,
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

// Returns parsed JSON on success, or null if unauthenticated and no retry key available.
// Throws on any other failure (network error, non-401 bad status, retry-with-key failure).
async function fetchModels() {
  const res = await fetch(API_URL);
  if (res.ok) return res.json();

  if (res.status !== 401) {
    throw new Error(`HTTP ${res.status}`);
  }

  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) return null;

  const retryRes = await fetch(API_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!retryRes.ok) {
    throw new Error(`HTTP ${retryRes.status} (with TOGETHER_API_KEY)`);
  }
  return retryRes.json();
}

function toNewItem(item) {
  return {
    source: SOURCE_KEY,
    sourceLabel: "Together AI",
    category: "model-directory",
    id: item.id,
    name: item.name,
    url: item.url,
    detectedAt: new Date().toISOString(),
    meta: item.meta ?? {},
  };
}
