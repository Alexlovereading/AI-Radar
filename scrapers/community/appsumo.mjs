// AppSumo community scraper.
//
// Verified during development: unlike Chrome Web Store, https://appsumo.com/software/new/
// IS server-rendered — a plain fetch + cheerio returns real product listings with no JS
// execution needed. Each deal card contains an anchor like:
//   <a href="/products/<slug>/" aria-label="View deal: <Product Name>" ...>
// which gives a stable id (slug) and display name directly from the initial HTML. Confirmed
// ~20 unique products present per page load on the "/software/new/" listing.
//
// If AppSumo changes their markup and that selector stops matching, we warn clearly and
// return [] rather than guessing at a different structure or fabricating listings.

import * as cheerio from "cheerio";
import { diffAndSave } from "../../lib/snapshot.mjs";

const SOURCE_KEY = "appsumo";
const LISTING_URL = "https://appsumo.com/software/new/";

export default async function run() {
  let html;
  try {
    const res = await fetch(LISTING_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ai-word-radar/0.1)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (err) {
    console.warn(`[${SOURCE_KEY}] fetch failed: ${err.message}`);
    return [];
  }

  const $ = cheerio.load(html);
  const cards = $('a[aria-label^="View deal: "]');

  if (cards.length === 0) {
    console.warn(
      `[${SOURCE_KEY}] page returned ${html.length} bytes but 0 'View deal:' product cards — ` +
        `AppSumo's markup may have changed. Skipping for this pass; returning [].`
    );
    return [];
  }

  const seen = new Set();
  const fresh = [];
  cards.each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const slugMatch = href.match(/\/products\/([^/]+)\/?/);
    if (!slugMatch) return;
    const id = slugMatch[1];
    if (seen.has(id)) return;
    seen.add(id);

    const ariaLabel = $(el).attr("aria-label") ?? "";
    const name = ariaLabel.replace(/^View deal:\s*/, "").trim() || id;

    fresh.push({
      id,
      name,
      url: `https://appsumo.com/products/${id}/`,
      meta: {},
    });
  });

  let added;
  try {
    added = await diffAndSave(SOURCE_KEY, fresh);
  } catch (err) {
    console.warn(`[${SOURCE_KEY}] diffAndSave failed: ${err.message}`);
    return [];
  }

  return added.map(toNewItem);
}

function toNewItem(item) {
  return {
    source: SOURCE_KEY,
    sourceLabel: "AppSumo",
    category: "community",
    id: item.id,
    name: item.name,
    url: item.url,
    detectedAt: new Date().toISOString(),
    meta: item.meta ?? {},
  };
}
