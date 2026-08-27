// fal.ai has no documented public "list all models" REST endpoint on its own docs landing
// page, but investigation turned up something better than scraping HTML:
//
// 1. Fetched https://fal.ai/docs/llms.txt (200 OK, ~90KB plain text). This turned out to be
//    a documentation *index* (a flat list of doc page links + one-line descriptions), not a
//    model catalog — so it's not directly parseable for model listings.
// 2. That index links to https://fal.ai/docs/platform-apis/v1/models.md ("Model search —
//    Unified endpoint for discovering model endpoints"). Fetching that page reveals a real,
//    documented, versioned REST API:
//
//      GET https://api.fal.ai/v1/models?limit=100&cursor=<cursor>
//
//    Auth is OPTIONAL (only needed for higher rate limits), confirmed live:
//    `curl https://api.fal.ai/v1/models?limit=5` returns 200 with real JSON:
//      { models: [{ endpoint_id, metadata: { display_name, category, description,
//                    status, tags, updated_at, model_url, date, ... } }],
//        next_cursor, has_more }
//
// This is far more reliable than parsing the /models HTML page, so we use it instead of the
// cheerio fallback described in the original brief. Kept defensive per the contract: any
// failure warns and returns [].

import { diffAndSave } from "../../lib/snapshot.mjs";

const SOURCE_KEY = "falai";
const API_URL = "https://api.fal.ai/v1/models";
const PAGE_LIMIT = 100;
const MAX_PAGES = 10; // caps at ~1000 models per run; plenty to catch new listings

export default async function run() {
  let fresh;
  try {
    fresh = await fetchAllModels();
  } catch (err) {
    console.warn(`[falai] fetch/parse threw: ${err.message}`);
    return [];
  }

  if (!fresh || fresh.length === 0) {
    console.warn(
      "[falai] no models returned from https://api.fal.ai/v1/models — endpoint may have " +
        "changed shape, or fal.ai has no stable scrape/API target right now"
    );
    return [];
  }

  const added = await diffAndSave(SOURCE_KEY, fresh);
  return added.map(toNewItem);
}

async function fetchAllModels() {
  const results = [];
  let cursor = null;
  let hasMore = true;
  let page = 0;

  while (hasMore && page < MAX_PAGES) {
    const url = new URL(API_URL);
    url.searchParams.set("limit", String(PAGE_LIMIT));
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      console.warn(`[falai] page ${page} fetch failed: HTTP ${res.status}`);
      break;
    }

    const json = await res.json();
    const models = Array.isArray(json.models) ? json.models : [];
    for (const m of models) {
      if (!m.endpoint_id) continue;
      const meta = m.metadata ?? {};
      results.push({
        id: m.endpoint_id,
        name: meta.display_name ?? m.endpoint_id,
        url: meta.model_url ?? `https://fal.ai/models/${m.endpoint_id}`,
        meta: {
          category: meta.category ?? null,
          description: meta.description ?? null,
          status: meta.status ?? null,
          tags: meta.tags ?? [],
          date: meta.date ?? null,
          updatedAt: meta.updated_at ?? null,
        },
      });
    }

    hasMore = Boolean(json.has_more);
    cursor = json.next_cursor ?? null;
    page += 1;
    if (!cursor) break;
  }

  return results;
}

function toNewItem(item) {
  return {
    source: SOURCE_KEY,
    sourceLabel: "fal.ai",
    category: "model-directory",
    id: item.id,
    name: item.name,
    url: item.url,
    detectedAt: new Date().toISOString(),
    meta: item.meta ?? {},
  };
}
