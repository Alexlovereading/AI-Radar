// Chrome Web Store community scraper.
//
// KNOWN LIMITATION (verified during development, not a guess): the current Chrome Web
// Store (chromewebstore.google.com) is a client-side-rendered SPA. Testing a plain HTTP GET
// of https://chromewebstore.google.com/category/extensions?sort=newest with cheerio showed
// inconsistent, unreliable behavior across repeated fetches:
//   - Most requests return ~876KB of HTML with zero "/detail/<id>" listing links and only
//     ~9 <script> tags of shell/bootstrap code — the extension grid for the requested
//     category/sort is filled in by client-side JS after load, so cheerio (which only sees
//     the initial HTML) finds nothing.
//   - Occasionally a request instead returns a handful of "/detail/<id>" anchors, but for
//     an unrelated "recommended/featured" widget that has nothing to do with the requested
//     `sort=newest` extensions listing (e.g. generic popular extensions unrelated to "new"
//     or to AI at all) — i.e. the `?sort=newest` query param appears to be ignored by
//     server-side rendering and only applied by client JS routing.
// Either way, there is no reliable way to get the actual "newest extensions" listing via
// plain HTTP+cheerio. This matches the known real-world project
// AdamSlack/chrome-web-store-scraper, which is confirmed broken for the same reason.
//
// Rather than ship a parser that could silently return misleading/irrelevant listings
// (or nothing) with no explanation, this module makes a real fetch + cheerio attempt,
// then unconditionally warns that this source needs a headless browser (Playwright/
// Puppeteer) to render the page and apply the sort before scraping — out of scope for
// this pass — and returns []. It never reports incidental/unrelated links as real data.

import * as cheerio from "cheerio";

const SOURCE_KEY = "chrome-web-store";
const LISTING_URL = "https://chromewebstore.google.com/category/extensions?sort=newest";

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
  // Real extension listing links look like /detail/<name>/<32-char-id>.
  const detailLinkCount = $('a[href*="/detail/"]').length;

  console.warn(
    `[${SOURCE_KEY}] fetched ${html.length} bytes, found ${detailLinkCount} "/detail/" ` +
      `link(s) in raw HTML. Chrome Web Store's category/sort listing is client-JS-rendered ` +
      `and unreliable to scrape with plain HTTP+cheerio (confirmed during development: the ` +
      `grid is empty most of the time, and any stray "/detail/" links present do not ` +
      `correspond to the requested sort=newest listing). This source needs a headless ` +
      `browser (Playwright/Puppeteer) to render the page before scraping, which is out of ` +
      `scope for this pass. Returning [].`
  );
  return [];
}
