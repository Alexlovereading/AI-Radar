// Anthropic official news scraper.
//
// Anthropic has NO official RSS feed (confirmed by research and by the absence of
// any <link rel="alternate" type="application/rss+xml"> on the page). Scraping
// https://www.anthropic.com/news as HTML instead.
//
// Investigation notes (2026-08-27): a real fetch of https://www.anthropic.com/news
// returns HTTP 200 with real server-rendered HTML (Next.js). Article links look like
// `<a href="/news/<slug>" class="...">`. Two different card layouts appear on the
// page and use different tags for the title (an `<h4>` in the "Featured" grid, a
// `<span>` in the plain "Publication list" further down), but both consistently use
// a CSS-module class ending in "...title" (e.g. `FeaturedGrid-module...__title`,
// `PublicationList-module...__title`). Selecting any descendant whose class contains
// "title" (case-insensitive) covers both layouts without depending on the Next.js
// build-hash prefix, which will change across deploys.

import * as cheerio from "cheerio";
import { diffAndSave } from "../../lib/snapshot.mjs";

const SOURCE_KEY = "anthropic";
const SOURCE_LABEL = "Anthropic";
const PAGE_URL = "https://www.anthropic.com/news";

function parseArticles(html, baseUrl) {
  const $ = cheerio.load(html);
  const seen = new Map();

  $('a[href^="/news/"]').each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href === "/news" || href === "/news/") return;

    let abs;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      return;
    }

    let title = $(el).find('[class*="title" i]').first().text().trim();
    if (!title) title = $(el).text().trim();
    title = title.replace(/\s+/g, " ");
    if (!title) return;

    if (!seen.has(abs)) {
      seen.set(abs, { id: abs, name: title, url: abs, meta: {} });
    }
  });

  return [...seen.values()];
}

export default async function run() {
  let html;
  try {
    const res = await fetch(PAGE_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ai-word-radar/1.0)" },
    });
    if (!res.ok) {
      console.warn(`[${SOURCE_KEY}] fetch failed for ${PAGE_URL}: HTTP ${res.status}`);
      return [];
    }
    html = await res.text();
  } catch (err) {
    console.warn(`[${SOURCE_KEY}] fetch failed for ${PAGE_URL}: ${err.message}`);
    return [];
  }

  const fresh = parseArticles(html, PAGE_URL);
  if (fresh.length === 0) {
    console.warn(`[${SOURCE_KEY}] parsed 0 items from ${PAGE_URL} — selectors may be stale`);
    return [];
  }

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
