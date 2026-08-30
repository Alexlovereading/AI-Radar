// Google Trends daily RSS. The public feed mixes sports/celebrity with everything
// else; only AI-related *titles* are returned (related news is attached as meta).
// Traffic is parsed to a number for scoring. No first-seen diff — the daily list
// is the candidate set each run.

import {
  isAiRelatedCommunity,
  isJunkCommunityItem,
  isTodayShanghai,
  passesHardFilter,
} from "../../lib/community-filter.mjs";

const SOURCE_KEY = "google-trends";
const FEED_URL = "https://trends.google.com/trending/rss?geo=US";

export default async function run() {
  let xml;
  try {
    const res = await fetch(FEED_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ai-word-radar/0.1)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    xml = await res.text();
  } catch (err) {
    console.warn(
      `[${SOURCE_KEY}] fetch/parse failed (${err.message}) — Google Trends RSS may have ` +
        `changed format or been removed. Returning [].`
    );
    return [];
  }

  let parsed;
  try {
    parsed = parseRssItems(xml);
  } catch (err) {
    console.warn(`[${SOURCE_KEY}] RSS parse failed: ${err.message}`);
    return [];
  }

  if (parsed.length === 0) {
    console.warn(`[${SOURCE_KEY}] feed parsed but contained 0 items — returning [].`);
    return [];
  }

  const items = [];
  for (const it of parsed) {
    if (!it.title) continue;
    if (!isAiRelatedCommunity(it.title)) continue;
    if (isJunkCommunityItem({ source: SOURCE_KEY, name: it.title })) continue;
    if (it.pubDate && !isTodayShanghai(it.pubDate)) continue;

    const relatedNews = it.newsTitles;
    const approxTraffic = parseTraffic(it.approxTrafficRaw);

    const item = {
      source: SOURCE_KEY,
      sourceLabel: "Google Trends",
      category: "trending",
      id: normalize(it.title),
      name: it.title,
      url: it.link || FEED_URL,
      detectedAt: new Date().toISOString(),
      meta: {
        approxTraffic,
        approxTrafficRaw: it.approxTrafficRaw,
        pubDate: it.pubDate,
        relatedNews,
      },
    };
    if (!passesHardFilter(item)) continue;
    items.push(item);
  }

  return items;
}

export function parseRssItems(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const title = decodeEntities(inner(block, "title"));
    const approxTrafficRaw = inner(block, "ht:approx_traffic") || null;
    const pubDate = inner(block, "pubDate") || null;
    const link = inner(block, "link") || FEED_URL;
    const newsTitles = [
      ...block.matchAll(/<ht:news_item_title>([\s\S]*?)<\/ht:news_item_title>/g),
    ]
      .map((x) => decodeEntities(x[1]).trim())
      .filter(Boolean);
    items.push({ title, approxTrafficRaw, pubDate, link, newsTitles });
  }
  return items;
}

// Tolerates an optional attribute list on the opening tag (e.g. `<title type="text">`)
// so a minor upstream feed change doesn't silently null out a field.
export function inner(block, tag) {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : "";
}

export function decodeEntities(s) {
  return String(s ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function parseTraffic(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(String(raw).replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function normalize(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
