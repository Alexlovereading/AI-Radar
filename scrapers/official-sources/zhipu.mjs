// Zhipu AI (GLM / Z.ai) official news scraper.
//
// Investigation (2026-08-27):
//  - https://open.bigmodel.cn is a bare Vue SPA shell (~4KB of HTML, all content loaded
//    client-side via JS bundles) — nothing to scrape server-side.
//  - https://www.zhipuai.cn is a Next.js (App Router) site. Its homepage nav has a
//    "新闻动态" (News) item that is a client-side-routed <span>, not a plain <a href>, so it
//    isn't discoverable purely from the homepage's static <a href> links. However the route
//    itself resolves directly: https://www.zhipuai.cn/zh/news returns a full server-rendered
//    page (confirmed via curl, HTTP 200) with 15 news/press items rendered as plain
//    `<a href="/zh/news/{id}">` cards, each containing an `<h3 class="line-clamp-2 ...">`
//    title and a `<p>` publish-date. This is confirmed live, reliable, structured HTML —
//    no need to fall back to the embedded Next.js RSC JSON payload also present in the page.
//
// Selector basis: `a[href^="/zh/news/"]` cards; title = first `h3` text inside the card;
// date = first `p` text inside the card (format observed as "YYYY/MM/DD"). The numeric
// trailing path segment of the href is a stable per-article id.

import * as cheerio from "cheerio";
import { diffAndSave } from "../../lib/snapshot.mjs";

const SOURCE_KEY = "zhipu";
const NEWS_URL = "https://www.zhipuai.cn/zh/news";
const BASE_URL = "https://www.zhipuai.cn";
const UA = "Mozilla/5.0 (compatible; ai-word-radar/1.0)";

export default async function run() {
  try {
    const res = await fetch(NEWS_URL, { headers: { "User-Agent": UA } });
    if (!res.ok) {
      console.warn(`[${SOURCE_KEY}] fetch failed: HTTP ${res.status}`);
      return [];
    }
    const html = await res.text();
    const $ = cheerio.load(html);

    const seen = new Map();
    $('a[href^="/zh/news/"]').each((_, el) => {
      const $el = $(el);
      const href = $el.attr("href");
      if (!href) return;
      const match = href.match(/^\/zh\/news\/([A-Za-z0-9_-]+)\/?$/);
      if (!match) return; // skip anything that isn't a per-article detail link
      const id = match[1];
      if (seen.has(id)) return;

      const title = $el.find("h3").first().text().trim();
      if (!title) return;
      const dateText = $el.find("p").first().text().trim();

      seen.set(id, {
        id,
        name: title,
        url: new URL(href, BASE_URL).toString(),
        meta: dateText ? { date: dateText } : {},
      });
    });

    const fresh = [...seen.values()];

    if (fresh.length === 0) {
      console.warn(
        `[${SOURCE_KEY}] parsed 0 items from ${NEWS_URL} — selectors may be stale or the news section moved`
      );
      return [];
    }

    const added = await diffAndSave(SOURCE_KEY, fresh);

    return added.map((item) => ({
      source: SOURCE_KEY,
      sourceLabel: "Zhipu AI (GLM)",
      category: "official-source",
      id: item.id,
      name: item.name,
      url: item.url,
      detectedAt: new Date().toISOString(),
      meta: item.meta ?? {},
    }));
  } catch (err) {
    console.warn(`[${SOURCE_KEY}] scrape failed: ${err.message}`);
    return [];
  }
}
