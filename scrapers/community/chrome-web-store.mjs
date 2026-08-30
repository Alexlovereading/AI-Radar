// Chrome Web Store scraper. The listing is a client-rendered SPA, so this
// requires Playwright. Missing playwright / missing browser / timeout → warn + [].
// Never treat unrelated featured extensions as "newest".

import {
  isAiRelatedCommunity,
  isJunkCommunityItem,
  passesHardFilter,
} from "../../lib/community-filter.mjs";

const SOURCE_KEY = "chrome-web-store";
const SEARCH_URL =
  "https://chromewebstore.google.com/search/artificial%20intelligence?hl=en";
const PLAYWRIGHT_TIMEOUT_MS = 30_000;
const MIN_USERS = 50;

const FEATURED_JUNK =
  /\b(ublock|adblock|adblock plus|lastpass|honey|dark reader|grammarly|capital one|rakuten|avast|norton)\b/i;

export default async function run() {
  let playwright;
  try {
    playwright = await import("playwright");
  } catch (err) {
    console.warn(
      `[${SOURCE_KEY}] playwright not available (${err.message}) — skipping Chrome Web Store`
    );
    return [];
  }

  let browser;
  try {
    browser = await withTimeout(
      playwright.chromium.launch({ headless: true }),
      PLAYWRIGHT_TIMEOUT_MS,
      "chromium.launch"
    );
    const page = await browser.newPage();
    page.setDefaultTimeout(PLAYWRIGHT_TIMEOUT_MS);

    await page.goto(SEARCH_URL, {
      waitUntil: "domcontentloaded",
      timeout: PLAYWRIGHT_TIMEOUT_MS,
    });

    await clickNewest(page);

    try {
      await page.waitForSelector('a[href*="/detail/"]', { timeout: PLAYWRIGHT_TIMEOUT_MS });
    } catch {
      console.warn(`[${SOURCE_KEY}] timed out waiting for extension listings`);
      return [];
    }

    await sleep(1500);

    const raw = await page.evaluate(extractCards);

    const items = [];
    const seen = new Set();
    for (const card of raw) {
      if (!card?.id || seen.has(card.id)) continue;
      seen.add(card.id);

      if (card.featured) continue;
      if (FEATURED_JUNK.test(card.name ?? "")) continue;

      const blob = `${card.name ?? ""} ${card.snippet ?? ""}`;
      if (!isAiRelatedCommunity(blob)) continue;
      if (
        isJunkCommunityItem({
          source: SOURCE_KEY,
          name: card.name,
          meta: { contentSnippet: card.snippet },
        })
      ) {
        continue;
      }

      const users = Number.isFinite(card.users) ? card.users : 0;
      if (!card.isNew && users < MIN_USERS) continue;

      const item = {
        source: SOURCE_KEY,
        sourceLabel: "Chrome Web Store",
        category: "community",
        id: card.id,
        name: card.name || card.slug || card.id,
        url: card.url,
        detectedAt: new Date().toISOString(),
        meta: {
          slug: card.slug ?? null,
          users: Number.isFinite(card.users) ? card.users : null,
          reviews: Number.isFinite(card.reviews) ? card.reviews : null,
          isNew: Boolean(card.isNew),
          snippet: card.snippet ?? null,
          contentSnippet: card.snippet ?? null,
          points: Number.isFinite(card.users) ? card.users : 0,
        },
      };
      if (!passesHardFilter(item)) continue;
      items.push(item);
    }

    return items;
  } catch (err) {
    console.warn(`[${SOURCE_KEY}] scrape failed: ${err.message}`);
    return [];
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore close errors
      }
    }
  }
}

async function clickNewest(page) {
  try {
    const newest = page.getByText(/^newest$/i).first();
    if (await newest.isVisible({ timeout: 4000 })) {
      await newest.click({ timeout: 4000 });
    }
  } catch {
    // Sort control is optional; search results still get AI-filtered below.
  }
}

function extractCards() {
  const seen = new Set();
  const out = [];
  for (const a of document.querySelectorAll('a[href*="/detail/"]')) {
    const href = a.getAttribute("href") || "";
    const m = href.match(/\/detail\/(?:([^/]+)\/)?([a-p]{32})/i);
    if (!m) continue;
    const slug = m[1] || "";
    const id = m[2].toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);

    const card = a.closest("[role='listitem'], article, li") || a.parentElement || a;
    const text = (card.innerText || a.textContent || "").replace(/\s+/g, " ").trim();
    const featured = /^(featured|recommended|editors'? pick)\b/i.test(text);
    const usersM = text.match(/([\d,.]+)\s*(?:users?|user)/i);
    const users = usersM ? Number(usersM[1].replace(/,/g, "")) : null;
    const reviewsM = text.match(/([\d,.]+)\s*(?:reviews?|ratings?)/i);
    const reviews = reviewsM ? Number(reviewsM[1].replace(/,/g, "")) : null;
    const isNew = /\bnew\b/i.test(text.slice(0, 80));
    const name = (a.getAttribute("title") || a.innerText || slug)
      .replace(/\s+/g, " ")
      .trim();

    out.push({
      id,
      slug,
      name,
      url: `https://chromewebstore.google.com/detail/${slug ? `${slug}/` : ""}${id}`,
      users: Number.isFinite(users) ? users : null,
      reviews: Number.isFinite(reviews) ? reviews : null,
      isNew,
      featured,
      snippet: text.slice(0, 240) || null,
    });
  }
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}
