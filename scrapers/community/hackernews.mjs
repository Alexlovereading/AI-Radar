import { diffAndSave } from "../../lib/snapshot.mjs";

const SOURCE_KEY = "hackernews";

// HN's Algolia search_by_date endpoint does NOT support boolean "OR" inside the
// `query` param — it parses the query as an AND-of-terms full-text match, so a
// literal `query=AI OR LLM OR "language model"` requires the literal word "OR"
// to co-occur and returns almost nothing (confirmed via manual testing: `AI`
// alone matches hundreds of stories/day, but `AI OR LLM` matches ~1, and
// `AI OR LLM OR GPT` matches 0). To get real OR semantics we run one query per
// term and merge+dedupe the results by objectID.
const QUERY_TERMS = ["AI", "LLM", '"language model"'];

export default async function run() {
  try {
    const since = Math.floor(Date.now() / 1000) - 86400;

    const results = await Promise.all(
      QUERY_TERMS.map(async (term) => {
        const params = new URLSearchParams({
          tags: "story",
          query: term,
          numericFilters: `created_at_i>${since}`,
        });
        const url = `https://hn.algolia.com/api/v1/search_by_date?${params.toString()}`;
        try {
          const res = await fetch(url);
          if (!res.ok) {
            console.warn(`[hackernews] fetch failed for query "${term}": HTTP ${res.status}`);
            return [];
          }
          const json = await res.json();
          return json.hits ?? [];
        } catch (err) {
          console.warn(`[hackernews] fetch failed for query "${term}": ${err.message}`);
          return [];
        }
      })
    );

    const byId = new Map();
    for (const hits of results) {
      for (const hit of hits) {
        if (hit && hit.objectID && hit.title && !byId.has(hit.objectID)) {
          byId.set(hit.objectID, hit);
        }
      }
    }

    const fresh = [...byId.values()].map((hit) => ({
      id: String(hit.objectID),
      name: hit.title,
      url: hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`,
      meta: {
        hnUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
        createdAt: hit.created_at ?? null,
      },
    }));

    const added = await diffAndSave(SOURCE_KEY, fresh);

    return added.map((item) => ({
      source: SOURCE_KEY,
      sourceLabel: "Hacker News",
      category: "community",
      id: item.id,
      name: item.name,
      url: item.url,
      detectedAt: new Date().toISOString(),
      meta: item.meta ?? {},
    }));
  } catch (err) {
    console.warn(`[hackernews] scrape failed: ${err.message}`);
    return [];
  }
}
