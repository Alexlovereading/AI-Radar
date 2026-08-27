// DeepSeek official news/research scraper.
//
// Investigation notes (2026-08-27): the DeepSeek homepage (https://www.deepseek.com/en)
// links to a dedicated news listing at https://www.deepseek.com/en/news/ ("Research &
// News"), which returns HTTP 200 with real server-rendered HTML — used directly as the
// page URL rather than the homepage. Article cards are `<a href="/en/news/<slug>/">`
// with two layout variants: a single featured `a.ds-news-hero-card` (title in an
// `<h2 class="... ds-text-heading2 ...">`) and several `a.ds-news-list-item` (title in
// an `<h3 class="... ds-text-title ...">`). Both variants consistently nest the title
// in the first heading (h2/h3) inside the anchor, so selecting any h2/h3 descendant
// covers both without depending on the full class list.

import * as cheerio from "cheerio";
import { diffAndSave } from "../../lib/snapshot.mjs";

const SOURCE_KEY = "deepseek";
const SOURCE_LABEL = "DeepSeek";
const PAGE_URL = "https://www.deepseek.com/en/news/";
const ARTICLE_HREF_RE = /^\/en\/news\/[a-z0-9-]+\/?$/i;

function parseArticles(html, baseUrl) {
  const $ = cheerio.load(html);
  const seen = new Map();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || !ARTICLE_HREF_RE.test(href)) return;

    let abs;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      return;
    }

    let title = $(el).find("h1, h2, h3").first().text().trim();
    if (!title) title = $(el).find("img[alt]").first().attr("alt")?.trim() ?? "";
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
