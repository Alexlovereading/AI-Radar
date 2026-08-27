// Google DeepMind official blog scraper.
//
// Investigation notes (2026-08-27): https://deepmind.google/discover/blog/ returns
// HTTP 200 with real server-rendered HTML — no redirect/404 needed. DeepMind now
// publishes most posts on blog.google (with a `?utm_source=deepmind.google` tag)
// rather than under deepmind.google itself, so article links point off-domain; that's
// expected and fine, the id/url is just whatever the canonical article URL is.
// Each post is an `<article class="card card-blog ...">` containing an
// `<a class="card__overlay-link" href="...">` (the actual link, aria-hidden, used for
// click tracking) and an `<h3 class="... card__title">Title</h3>`. These class names
// are plain semantic strings (not build-hashed), so they should stay stable across
// deploys; selecting on `article.card-blog` + `.card__title` is intentionally not
// coupled to the anchor's own class in case that changes.

import * as cheerio from "cheerio";
import { diffAndSave } from "../../lib/snapshot.mjs";

const SOURCE_KEY = "deepmind";
const SOURCE_LABEL = "Google DeepMind";
const PAGE_URL = "https://deepmind.google/discover/blog/";

function parseArticles(html, baseUrl) {
  const $ = cheerio.load(html);
  const seen = new Map();

  $("article.card-blog, article.card").each((_, el) => {
    const card = $(el);
    const href = card.find("a[href]").first().attr("href");
    if (!href) return;

    let abs;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      return;
    }

    let title = card.find('[class*="card__title"], [class*="title"]').first().text().trim();
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
