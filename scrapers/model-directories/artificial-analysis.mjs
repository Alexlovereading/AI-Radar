// Artificial Analysis has a real, documented API. Investigation via a live fetch of the
// generated OpenAPI contract at https://artificialanalysis.ai/api/v2/openapi (YAML, 200 OK)
// confirms the exact paths — the brief's guessed path `/v2/data/llms/models` does not exist
// (404 on artificialanalysis.ai and on api.artificialanalysis.ai). The real ones are:
//
//   GET https://artificialanalysis.ai/api/v2/language/models        (Pro+ tier only)
//   GET https://artificialanalysis.ai/api/v2/language/models/free   (any valid key, incl. Free)
//
// Confirmed live: `curl https://artificialanalysis.ai/api/v2/language/models/free
//   -H "x-api-key: test"` returns 401 `{"error":"Invalid API key."}` — i.e. the route exists
// and is auth-gated, as opposed to a 404 for made-up paths. Since the brief specifies the
// free tier (100 requests/24h), we use the `/free` route, which is what a Free-tier key can
// actually call (the non-free route 403s for Free keys per the spec).
//
// Response shape (from the OpenAPI examples, LLMModelsFreeResponse):
//   {
//     tier, intelligence_index_version,
//     pagination: { page, page_size, total_pages, has_more },
//     data: [{ id, name, slug, release_date, model_creator: { id, name },
//              evaluations: {...}, pricing: {...}, performance: {...} }]
//   }
//
// Model detail pages on the public site follow /models/<slug> (verified live:
// https://artificialanalysis.ai/models/gpt-oss-20b -> 200), so that's used for `url`.

import { diffAndSave } from "../../lib/snapshot.mjs";

const SOURCE_KEY = "artificial-analysis";
const API_URL = "https://artificialanalysis.ai/api/v2/language/models/free";
const MAX_PAGES = 10;

export default async function run() {
  const apiKey = process.env.ARTIFICIAL_ANALYSIS_API_KEY;
  if (!apiKey) {
    console.warn(
      "[artificial-analysis] ARTIFICIAL_ANALYSIS_API_KEY is not set — skipping (needs a real key, free tier is 100 req/24h)"
    );
    return [];
  }

  let fresh;
  try {
    fresh = await fetchAllModels(apiKey);
  } catch (err) {
    console.warn(`[artificial-analysis] fetch/parse threw: ${err.message}`);
    return [];
  }

  if (!fresh || fresh.length === 0) {
    console.warn(
      "[artificial-analysis] no models returned — API shape may have changed since this was written"
    );
    return [];
  }

  const added = await diffAndSave(SOURCE_KEY, fresh);
  return added.map(toNewItem);
}

async function fetchAllModels(apiKey) {
  const results = [];
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= MAX_PAGES) {
    const url = new URL(API_URL);
    url.searchParams.set("page", String(page));

    const res = await fetch(url, {
      headers: { "x-api-key": apiKey, Accept: "application/json" },
    });

    if (!res.ok) {
      console.warn(`[artificial-analysis] page ${page} fetch failed: HTTP ${res.status}`);
      break;
    }

    const json = await res.json();
    const data = Array.isArray(json.data) ? json.data : [];
    for (const m of data) {
      if (!m.slug) continue;
      results.push({
        id: m.slug,
        name: m.name ?? m.slug,
        url: `https://artificialanalysis.ai/models/${m.slug}`,
        meta: {
          releaseDate: m.release_date ?? null,
          developer: m.model_creator?.name ?? "unknown",
          evaluations: m.evaluations ?? {},
          pricing: m.pricing ?? {},
          performance: m.performance ?? {},
        },
      });
    }

    hasMore = Boolean(json.pagination?.has_more);
    page += 1;
  }

  return results;
}

function toNewItem(item) {
  return {
    source: SOURCE_KEY,
    sourceLabel: "Artificial Analysis",
    category: "model-directory",
    id: item.id,
    name: item.name,
    url: item.url,
    detectedAt: new Date().toISOString(),
    meta: item.meta ?? {},
  };
}
