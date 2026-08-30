// Hacker News community scraper.
// Algolia search_by_date has no boolean OR, so we query each term separately
// and merge by objectID. Community heat changes every run — return today's
// candidates instead of diffing "first seen".

import {
  isAiRelatedCommunity,
  isJunkCommunityItem,
  isTodayShanghai,
  passesHardFilter,
} from "../../lib/community-filter.mjs";

const SOURCE_KEY = "hackernews";
const QUERY_TERMS = ["AI", "LLM", '"language model"'];
const LOOKBACK_SECONDS = 86400;
const MIN_POINTS = 20;
const MIN_COMMENTS = 10;

export default async function run() {
  try {
    const since = Math.floor(Date.now() / 1000) - LOOKBACK_SECONDS;

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

    const items = [];
    for (const hit of byId.values()) {
      const title = String(hit.title);
      const createdAtI = Number(hit.created_at_i ?? 0);
      const points = Number(hit.points ?? 0);
      const numComments = Number(hit.num_comments ?? 0);

      if (!isAiRelatedCommunity(title)) continue;
      if (isJunkCommunityItem({ source: SOURCE_KEY, name: title })) continue;
      if (!createdAtI || !isTodayShanghai(createdAtI)) continue;
      if (points < MIN_POINTS && numComments < MIN_COMMENTS) continue;

      const item = {
        source: SOURCE_KEY,
        sourceLabel: "Hacker News",
        category: "community",
        id: String(hit.objectID),
        name: title,
        url: hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`,
        detectedAt: new Date().toISOString(),
        meta: {
          hnUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
          points: Number.isFinite(points) ? points : 0,
          comments: Number.isFinite(numComments) ? numComments : 0,
          num_comments: Number.isFinite(numComments) ? numComments : 0,
          created_at: hit.created_at ?? null,
        },
      };
      if (!passesHardFilter(item)) continue;
      items.push(item);
    }

    return items;
  } catch (err) {
    console.warn(`[hackernews] scrape failed: ${err.message}`);
    return [];
  }
}
