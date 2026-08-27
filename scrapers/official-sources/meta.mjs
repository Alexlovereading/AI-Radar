// Meta AI official blog scraper.
//
// Investigation notes (2026-08-27): https://ai.meta.com/blog/ returns HTTP 200 with
// real server-rendered HTML via a plain Node `fetch()` + generic UA (an earlier
// manual `curl` attempt got a Facebook edge "something went wrong" error page, but
// that did not reproduce from Node — likely a one-off/geo edge quirk, not a real
// bot block). The page is built on Meta's internal Comet/Facebook web stack, which
// generates short, atomic, per-build CSS class names (e.g. `_8w6a`, `_amcw`) that
// are NOT stable across deploys, so selectors must avoid them entirely.
//
// What IS stable: article links are plain `<a href="https://ai.meta.com/blog/<slug>/">`.
// Some of those anchors carry `aria-label="Read <Title>"`; others don't set
// aria-label but have the title as their own visible text content. So: match on the
// href pattern only, then take the title from `aria-label` (stripping the "Read "
// prefix) if present, falling back to the anchor's text content.
//
// Wrinkle: the same href/article often appears wrapped by *multiple* anchors on the
// page (an image-card link plus a text link, for responsive layouts), and one of
// those wrapping anchors can be a bare "FEATURED" badge with no real title text. So
// candidates are scored per href (aria-label wins, then longer/non-badge text) and
// the best one is kept instead of just the first one encountered in DOM order.

import * as cheerio from "cheerio";
import { diffAndSave } from "../../lib/snapshot.mjs";

const SOURCE_KEY = "meta";
const SOURCE_LABEL = "Meta AI";
const PAGE_URL = "https://ai.meta.com/blog/";
const ARTICLE_HREF_RE = /^https:\/\/ai\.meta\.com\/blog\/[a-z0-9-]+\/?$/i;

// Short, all-caps labels like "FEATURED" or "NEW" are card badges, not titles.
function isBadgeText(text) {
  return text.length <= 12 && text === text.toUpperCase();
}

function scoreCandidate(title, hasAriaLabel) {
  let score = title.length;
  if (hasAriaLabel) score += 1000;
  if (isBadgeText(title)) score -= 2000;
  return score;
}

function parseArticles(html, baseUrl) {
  const $ = cheerio.load(html);
  const best = new Map(); // href -> { title, score }

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    let abs;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      return;
    }

    if (!ARTICLE_HREF_RE.test(abs)) return;

    const ariaLabel = $(el).attr("aria-label") ?? "";
    const hasAriaLabel = Boolean(ariaLabel);
    let title = ariaLabel.replace(/^Read\s+/i, "").trim();
    if (!title) title = $(el).text().trim();
    title = title.replace(/\s+/g, " ");
    if (!title) return;

    const score = scoreCandidate(title, hasAriaLabel);
    const existing = best.get(abs);
    if (!existing || score > existing.score) {
      best.set(abs, { title, score });
    }
  });

  return [...best.entries()].map(([abs, { title }]) => ({
    id: abs,
    name: title,
    url: abs,
    meta: {},
  }));
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
