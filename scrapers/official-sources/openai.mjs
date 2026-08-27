// OpenAI official news scraper.
//
// OpenAI publishes a confirmed-live official RSS feed at https://openai.com/news/rss.xml
// (verified 2026-08-27: HTTP 200, well-formed RSS 2.0, ~20 <item> entries with
// title/link/guid/pubDate). No HTML scraping needed here.

import Parser from "rss-parser";
import { diffAndSave } from "../../lib/snapshot.mjs";

const SOURCE_KEY = "openai";
const SOURCE_LABEL = "OpenAI";
const FEED_URL = "https://openai.com/news/rss.xml";

const parser = new Parser();

export default async function run() {
  let feed;
  try {
    feed = await parser.parseURL(FEED_URL);
  } catch (err) {
    console.warn(`[${SOURCE_KEY}] failed to fetch/parse ${FEED_URL}: ${err.message}`);
    return [];
  }

  const items = Array.isArray(feed?.items) ? feed.items : [];
  if (items.length === 0) {
    console.warn(`[${SOURCE_KEY}] feed parsed but contained 0 items — feed shape may have changed`);
    return [];
  }

  const fresh = items
    .map((item) => {
      const id = item.link ?? item.guid;
      if (!id || !item.title) return null;
      return {
        id,
        name: item.title,
        url: item.link ?? id,
        meta: {
          pubDate: item.pubDate ?? null,
          categories: item.categories ?? [],
          contentSnippet: item.contentSnippet ?? null,
        },
      };
    })
    .filter(Boolean);

  const added = await diffAndSave(SOURCE_KEY, fresh);

  return added.map((item) => ({
    source: SOURCE_KEY,
    sourceLabel: SOURCE_LABEL,
    category: "official-source",
    id: item.id,
    name: item.name,
    url: item.url,
    detectedAt: new Date().toISOString(),
    meta: item.meta ?? {},
  }));
}
