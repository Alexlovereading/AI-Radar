import * as cheerio from "cheerio";
import { diffAndSave } from "../../lib/snapshot.mjs";

const SOURCE_KEY = "mistral";
const SOURCE_LABEL = "Mistral AI";
const UA = "Mozilla/5.0 (compatible; ai-word-radar/1.0)";

// Investigation notes (2026-08-27):
// `curl -sL -A "Mozilla/5.0 (compatible; ai-word-radar/1.0)" https://mistral.ai/news`
// returned HTTP 200 with real server-rendered HTML (~2600 lines, no JS-shell —
// actual <a href="/news/..."> article links are present in the raw response).
// While inspecting that HTML we found the page links to an RSS feed at
// https://mistral.ai/news/rss, which returned HTTP 200 with a clean, well-formed
// RSS 2.0 feed (82 <item> entries, each with <title>, <link>, <guid>, <pubDate>,
// and often <description>). That's strictly more reliable structured data than
// scraping the HTML news cards (no risk of stale CSS-class selectors, and it
// comes with real publish dates + descriptions for the `meta` field), so we use
// it as the primary source, parsed with cheerio in XML mode. The `/news` HTML
// page is kept as a fallback in case the RSS feed ever goes away.
const RSS_URL = "https://mistral.ai/news/rss";
const NEWS_URL = "https://mistral.ai/news";

function idFromUrl(url) {
  try {
    const u = new URL(url);
    const slug = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean).pop();
    return slug || url;
  } catch {
    return url;
  }
}

async function tryRss() {
  const res = await fetch(RSS_URL, {
    headers: {
      "User-Agent": UA,
      Accept: "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!res.ok) {
    console.warn(`[mistral] RSS fetch failed: HTTP ${res.status}`);
    return null;
  }

  const xml = await res.text();
  const $ = cheerio.load(xml, { xmlMode: true });
  const items = $("item");

  if (items.length === 0) {
    console.warn("[mistral] RSS parsed 0 <item> elements — feed structure may have changed");
    return null;
  }

  const fresh = [];
  items.each((_, el) => {
    const $el = $(el);
    const link = $el.find("link").first().text().trim();
    const title = $el.find("title").first().text().trim();
    if (!link || !title) return;

    let abs;
    try {
      abs = new URL(link, RSS_URL).toString();
    } catch {
      return;
    }

    const description = $el.find("description").first().text().trim() || null;
    const pubDate = $el.find("pubDate").first().text().trim() || null;
    const guid = $el.find("guid").first().text().trim() || null;

    fresh.push({
      id: idFromUrl(abs),
      name: title,
      url: abs,
      meta: { description, pubDate, guid },
    });
  });

  return fresh;
}

function parseNewsHtml(html, baseUrl) {
  const $ = cheerio.load(html);
  const seen = new Map();

  $('a[href^="/news/"], a[href*="mistral.ai/news/"]').each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    let abs;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      return;
    }

    // Skip the index page itself, category filter links, and the rss link.
    if (/\/news\/?$/.test(abs)) return;
    if (/\/news\/rss\/?$/.test(abs)) return;
    if (abs.includes("?categories=")) return;

    const text = $(el).text().trim().replace(/\s+/g, " ");
    if (!text || text.length < 3) return;

    const id = idFromUrl(abs);
    if (!seen.has(id)) {
      seen.set(id, { id, name: text, url: abs, meta: {} });
    }
  });

  return [...seen.values()];
}

async function tryNewsHtml() {
  const res = await fetch(NEWS_URL, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!res.ok) {
    console.warn(`[mistral] news page fetch failed: HTTP ${res.status}`);
    return null;
  }

  const html = await res.text();
  const fresh = parseNewsHtml(html, NEWS_URL);

  if (fresh.length === 0) {
    console.warn("[mistral] news page parsed 0 items — selectors may be stale");
    return null;
  }

  return fresh;
}

export default async function run() {
  let fresh = null;

  try {
    fresh = await tryRss();
  } catch (err) {
    console.warn(`[mistral] RSS scrape failed: ${err.message}`);
  }

  if (!fresh) {
    try {
      fresh = await tryNewsHtml();
    } catch (err) {
      console.warn(`[mistral] news page scrape failed: ${err.message}`);
    }
  }

  if (!fresh || fresh.length === 0) {
    console.warn("[mistral] both RSS feed and news page failed to yield items — returning no items this run");
    return [];
  }

  try {
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
  } catch (err) {
    console.warn(`[mistral] diffAndSave failed: ${err.message}`);
    return [];
  }
}
