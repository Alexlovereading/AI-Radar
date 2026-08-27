import * as cheerio from "cheerio";
import { diffAndSave } from "../../lib/snapshot.mjs";

const SOURCE_KEY = "minimax";
const SOURCE_LABEL = "MiniMax";
const UA = "Mozilla/5.0 (compatible; ai-word-radar/1.0)";

// Investigation notes (2026-08-27):
// `curl -sL -A "Mozilla/5.0 (compatible; ai-word-radar/1.0)" https://www.minimax.io`
// and `... https://www.minimaxi.com` both returned HTTP 200 with real
// server-rendered HTML (~380KB / ~350KB). minimax.io is the English-language
// site, minimaxi.com is the Chinese-language mirror with near-identical
// structure/markup (same class names, same routes). Both expose the same nav
// links: `/blog`, `/news`, `/about`.
//
// `/news` only had a single article link on either domain (light section, not
// a reliable feed). `/blog` on minimax.io returned 12 distinct
// `<a class="no-underline overflow-hidden" href="/blog/...">` cards, each
// wrapping a `<section>` containing an `<h3>` title, a row of category tag
// `<span>`s, and a `<span>` with a `YYYY-MM-DD` publish date. This is
// server-rendered (present in the raw curl response, no JS execution needed)
// and structurally consistent across every card, so we use minimax.io/blog as
// the primary source. Titles are expected to sometimes be Chinese-language
// (MiniMax posts bilingual/CN-only content occasionally) even on the English
// domain — that's captured faithfully, not translated.
const BLOG_URL = "https://www.minimax.io/blog";

function idFromUrl(url) {
  try {
    const u = new URL(url);
    const slug = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean).pop();
    return slug || url;
  } catch {
    return url;
  }
}

function parseBlogHtml(html, baseUrl) {
  const $ = cheerio.load(html);
  const seen = new Map();

  $('a[href^="/blog/"]').each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href");
    if (!href) return;

    let abs;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      return;
    }

    // Skip the index page itself / any non-article anchor.
    if (/\/blog\/?$/.test(abs)) return;

    const title = $el.find("h3").first().text().trim().replace(/\s+/g, " ");
    if (!title) return;

    const id = idFromUrl(abs);
    if (seen.has(id)) return;

    // Best-effort extras: category tags and a YYYY-MM-DD publish date, if present.
    const tags = [];
    $el.find("span").each((__, span) => {
      const t = $(span).text().trim();
      if (
        t &&
        t !== "Read More" &&
        /^[A-Za-z0-9 .+-]{1,20}$/.test(t) &&
        !/^\d{4}-\d{2}-\d{2}$/.test(t)
      ) {
        tags.push(t);
      }
    });
    let publishedDate = null;
    $el.find("span").each((__, span) => {
      const t = $(span).text().trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(t)) publishedDate = t;
    });

    seen.set(id, {
      id,
      name: title,
      url: abs,
      meta: {
        ...(tags.length ? { tags } : {}),
        ...(publishedDate ? { publishedDate } : {}),
      },
    });
  });

  return [...seen.values()];
}

export default async function run() {
  try {
    const res = await fetch(BLOG_URL, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!res.ok) {
      console.warn(`[minimax] blog page fetch failed: HTTP ${res.status}`);
      return [];
    }

    const html = await res.text();
    const fresh = parseBlogHtml(html, BLOG_URL);

    if (fresh.length === 0) {
      console.warn("[minimax] parsed 0 items from /blog — selectors may be stale or page structure changed");
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
    console.warn(`[minimax] scrape failed: ${err.message}`);
    return [];
  }
}
