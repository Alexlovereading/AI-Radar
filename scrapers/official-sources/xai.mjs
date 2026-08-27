import * as cheerio from "cheerio";
import { diffAndSave } from "../../lib/snapshot.mjs";

const SOURCE_KEY = "xai";
const SOURCE_LABEL = "xAI";

// Investigation notes (2026-08-27):
// `curl -sL -A "Mozilla/5.0 (compatible; ai-word-radar/1.0)" https://x.ai/news`
// and the same request against https://x.ai/blog both returned HTTP 403 with a
// Cloudflare "Attention Required! | Cloudflare" / "Sorry, you have been blocked"
// interstitial (~5.5KB), even after trying a full desktop Chrome User-Agent and
// Accept/Accept-Language headers. This is Cloudflare bot-management blocking the
// request outright (not a JS-challenge that could be waited out, and not a plain
// client-side-rendered shell) — there is no real page HTML to select against.
// Because the block page's only "content" is a per-request Cloudflare Ray ID that
// changes every single time, hashing it would manufacture a "new item" on every
// run, which would be worse than reporting nothing. So this scraper does a real
// fetch + best-effort cheerio parse (kept in case the block ever lifts, or this
// runs from an environment Cloudflare doesn't challenge), and cleanly no-ops with
// a clear warning whenever the response isn't real HTML.
const CANDIDATE_URLS = ["https://x.ai/news", "https://x.ai/blog"];

function parseArticles(html, baseUrl) {
  const $ = cheerio.load(html);
  const seen = new Map();

  $('a[href*="/news/"], a[href*="/blog/"]').each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    let abs;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      return;
    }

    // Skip the index pages themselves and non-article anchors.
    if (/\/(news|blog)\/?$/.test(abs)) return;

    const text = $(el).text().trim().replace(/\s+/g, " ");
    if (!text || text.length < 3) return;

    if (!seen.has(abs)) {
      seen.set(abs, { id: abs, name: text, url: abs, meta: {} });
    }
  });

  return [...seen.values()];
}

export default async function run() {
  for (const pageUrl of CANDIDATE_URLS) {
    try {
      const res = await fetch(pageUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ai-word-radar/1.0)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      if (!res.ok) {
        console.warn(`[xai] fetch failed for ${pageUrl}: HTTP ${res.status}`);
        continue;
      }

      const html = await res.text();

      if (/Cloudflare|Attention Required|cf-error-details/i.test(html)) {
        console.warn(
          `[xai] ${pageUrl} returned a Cloudflare block/challenge page, not real content — skipping`
        );
        continue;
      }

      const fresh = parseArticles(html, pageUrl);

      if (fresh.length === 0) {
        console.warn(`[xai] parsed 0 items from ${pageUrl} — selectors may be stale`);
        continue;
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
      console.warn(`[xai] scrape failed for ${pageUrl}: ${err.message}`);
    }
  }

  console.warn(
    "[xai] all candidate URLs (x.ai/news, x.ai/blog) are blocked by Cloudflare or unparseable — returning no items this run"
  );
  return [];
}
