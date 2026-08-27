// Google Trends community scraper.
//
// Context (per task brief): `pytrends`, the old unofficial Python client, is archived/dead.
// There is no official Trends API. This module tries the legacy-but-currently-working public
// RSS feed for daily trending searches: https://trends.google.com/trending/rss?geo=US
//
// Verified during development: this endpoint returns HTTP 200 with valid RSS 2.0 XML
// (custom `ht:` namespace fields for approx_traffic, related news items, etc.), parseable
// with `rss-parser`. If Google changes/removes this endpoint (404, non-XML body, or a shape
// that fails to parse), we console.warn clearly and return [] — we do NOT fabricate trending
// terms. Note for future work: the actively-maintained option found in research is the
// Python library `trendspyg`, which would require a Python sidecar process; that's out of
// scope for this Node-only pass, so this feed is the best-effort fallback.
//
// Caveat: every <item><link> in this feed points at the feed URL itself, not a per-term
// page, so there's no natural per-item URL or id. We use the feed URL as `url` for every
// item and derive `id` from a normalized version of the trending term's title.

import Parser from "rss-parser";
import { diffAndSave } from "../../lib/snapshot.mjs";

const SOURCE_KEY = "google-trends";
const FEED_URL = "https://trends.google.com/trending/rss?geo=US";

const parser = new Parser({
  customFields: {
    item: [["ht:approx_traffic", "approxTraffic"]],
  },
});

export default async function run() {
  let feed;
  try {
    const res = await fetch(FEED_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ai-word-radar/0.1)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    feed = await parser.parseString(xml);
  } catch (err) {
    console.warn(
      `[${SOURCE_KEY}] fetch/parse failed (${err.message}) — Google Trends RSS may have ` +
        `changed format or been removed. This source needs a proper Trends client ` +
        `(see comment above re: trendspyg + Python sidecar) for a durable fix. Returning [].`
    );
    return [];
  }

  const items = Array.isArray(feed?.items) ? feed.items : [];
  if (items.length === 0) {
    console.warn(`[${SOURCE_KEY}] feed parsed but contained 0 items — returning [].`);
    return [];
  }

  const fresh = items
    .filter((it) => it?.title)
    .map((it) => ({
      id: normalize(it.title),
      name: it.title,
      url: it.link || FEED_URL,
      meta: {
        approxTraffic: it.approxTraffic ?? null,
        pubDate: it.pubDate ?? null,
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

function normalize(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toNewItem(item) {
  return {
    source: SOURCE_KEY,
    sourceLabel: "Google Trends",
    category: "trending",
    id: item.id,
    name: item.name,
    url: item.url,
    detectedAt: new Date().toISOString(),
    meta: item.meta ?? {},
  };
}
