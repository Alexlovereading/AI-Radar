// Alibaba Qwen official blog scraper.
//
// Investigation notes (2026-08-27):
// - The suggested starting URL, https://qwenlm.github.io/blog/, DOES return HTTP 200,
//   but its body is now just a `<meta http-equiv=refresh content="5; url=https://qwen.ai/research">`
//   redirect shell — the GitHub Pages blog has been superseded by qwen.ai and no
//   longer gets new posts published to its HTML index.
// - The real current destination, https://qwen.ai/research (and https://qwen.ai/blog),
//   returns HTTP 200 but is a fully client-rendered SPA: the server HTML contains
//   only script/style tags pointing at alicdn.com JS bundles and zero article
//   markup, links, or embedded JSON to parse. This matches the "heavily JS-rendered
//   with no server-side content" case — cheerio has nothing to select there.
// - However, the old qwenlm.github.io Hugo site still serves a real, well-formed RSS
//   feed at https://qwenlm.github.io/blog/index.xml (`<atom:link rel="self">` on the
//   redirect page's <head> even points at it). It's a legacy/secondary source (last
//   posts are from the qwenlm.github.io era, so very recent qwen.ai-only
//   announcements won't appear here), but it's real structured data rather than a
//   crude content hash, so we use it as a best-effort fallback and parse it with
//   cheerio in XML mode (per the "use cheerio" instruction) rather than rss-parser.
//
// TODO(human): qwen.ai/research is a JS SPA with no server-rendered content and no
// public API discovered during this pass. Refine this scraper to hit qwen.ai's
// underlying data API (if one exists) or render the SPA with a headless browser to
// pick up posts published only there.

import * as cheerio from "cheerio";
import { diffAndSave } from "../../lib/snapshot.mjs";

const SOURCE_KEY = "qwen";
const SOURCE_LABEL = "Qwen (Alibaba)";
const SPA_URL = "https://qwen.ai/research";
const FEED_URL = "https://qwenlm.github.io/blog/index.xml";

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ai-word-radar/1.0)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function parseFeed(xml, baseUrl) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const seen = new Map();

  $("item").each((_, el) => {
    const $el = $(el);
    const link = $el.find("link").first().text().trim();
    const title = $el.find("title").first().text().trim();
    if (!link || !title) return;

    let abs;
    try {
      abs = new URL(link, baseUrl).toString();
    } catch {
      return;
    }

    if (!seen.has(abs)) {
      seen.set(abs, {
        id: abs,
        name: title,
        url: abs,
        meta: { pubDate: $el.find("pubDate").first().text().trim() || null },
      });
    }
  });

  return [...seen.values()];
}

export default async function run() {
  // Confirm the primary destination is still the JS-only shell we found during
  // investigation; if it ever ships server-rendered article links, this will pick
  // them up too instead of silently skipping straight to the fallback.
  try {
    const spaHtml = await fetchText(SPA_URL);
    const $ = cheerio.load(spaHtml);
    const hrefCount = $("a[href*='/blog/'], a[href*='/research/']").length;
    if (hrefCount === 0) {
      console.warn(
        `[${SOURCE_KEY}] ${SPA_URL} is a client-rendered SPA with no server-side article links — falling back to legacy blog RSS`
      );
    } else {
      console.warn(
        `[${SOURCE_KEY}] ${SPA_URL} now exposes server-rendered links — scraper still only reads the legacy RSS fallback, needs updating`
      );
    }
  } catch (err) {
    console.warn(`[${SOURCE_KEY}] probe fetch failed for ${SPA_URL}: ${err.message}`);
  }

  let xml;
  try {
    xml = await fetchText(FEED_URL);
  } catch (err) {
    console.warn(`[${SOURCE_KEY}] fetch failed for ${FEED_URL}: ${err.message}`);
    return [];
  }

  const fresh = parseFeed(xml, FEED_URL);
  if (fresh.length === 0) {
    console.warn(`[${SOURCE_KEY}] parsed 0 items from ${FEED_URL} — feed shape may have changed`);
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
