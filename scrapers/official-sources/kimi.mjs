import * as cheerio from "cheerio";
import { diffAndSave } from "../../lib/snapshot.mjs";

const SOURCE_KEY = "kimi";
const SOURCE_LABEL = "Moonshot AI (Kimi)";

// Investigation notes (2026-08-27):
// `curl -sL -A "Mozilla/5.0 (compatible; ai-word-radar/1.0)" https://www.moonshot.ai`
// returned HTTP 200 but is a client-side-rendered app shell (vike-react) with no
// server-rendered article content — its nav does link out to a "Research" item
// pointing at https://www.kimi.ai/blog/, which is the real announcements page.
// `curl ... https://kimi.moonshot.cn` also returned HTTP 200 (a different,
// larger Next.js app) but its raw HTML contains no nav links matching
// news/blog/更新/公告/博客, so it was not used.
// `curl ... https://www.kimi.ai/blog/` returned HTTP 200 with real
// server-rendered HTML (Next.js): repeated `div.menu-card` blocks, each
// containing `a[href^="/blog/"]` with an `aria-label` title, an `h4.card-title`,
// and a `p.card-date` with an ISO-ish date (e.g. "2026-07-16"). This gives
// reliable structured data without needing JS execution.
const BLOG_URL = "https://www.kimi.ai/blog/";

function parseArticles(html, baseUrl) {
  const $ = cheerio.load(html);
  const seen = new Map();

  $(".menu-card").each((_, el) => {
    const anchor = $(el).find('a[href^="/blog/"]').first();
    const href = anchor.attr("href");
    if (!href) return;

    let abs;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      return;
    }

    // Skip the blog index itself.
    if (/\/blog\/?$/.test(abs)) return;

    const title =
      $(el).find(".card-title").first().text().trim() ||
      anchor.attr("aria-label")?.trim() ||
      "";
    if (!title) return;

    const date = $(el).find(".card-date").first().text().trim();

    if (!seen.has(abs)) {
      seen.set(abs, {
        id: abs,
        name: title,
        url: abs,
        meta: date ? { date } : {},
      });
    }
  });

  return [...seen.values()];
}

export default async function run() {
  try {
    const res = await fetch(BLOG_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ai-word-radar/1.0)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!res.ok) {
      console.warn(`[kimi] fetch failed for ${BLOG_URL}: HTTP ${res.status}`);
      return [];
    }

    const html = await res.text();
    const fresh = parseArticles(html, BLOG_URL);

    if (fresh.length === 0) {
      console.warn(
        `[kimi] parsed 0 items from ${BLOG_URL} — selectors may be stale or the page may now be client-rendered`
      );
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
  } catch (err) {
    console.warn(`[kimi] scrape failed for ${BLOG_URL}: ${err.message}`);
    return [];
  }
}
