// AppSumo scraper. /software/new/ now redirects to /browse/ and the old
// "View deal:" cards are gone. Playwright opens the AI search + AI collection
// and reads __NEXT_DATA__ (more stable than CSS selectors). Missing playwright
// or timeout → warn + [].

import {
  isAiRelatedCommunity,
  isJunkCommunityItem,
  isTodayShanghai,
  passesHardFilter,
} from "../../lib/community-filter.mjs";

const SOURCE_KEY = "appsumo";
const PLAYWRIGHT_TIMEOUT_MS = 30_000;

const LISTING_URLS = [
  "https://appsumo.com/browse/?query=AI",
  "https://appsumo.com/collections/build-it-with-ai/",
  "https://appsumo.com/software/new/",
];

export default async function run() {
  let playwright;
  try {
    playwright = await import("playwright");
  } catch (err) {
    console.warn(`[${SOURCE_KEY}] playwright not available (${err.message}) — skipping AppSumo`);
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

    const bySlug = new Map();
    for (const url of LISTING_URLS) {
      try {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: PLAYWRIGHT_TIMEOUT_MS,
        });
        await sleep(1200);
        const deals = await page.evaluate(extractDeals);
        for (const deal of deals) {
          if (deal?.slug && !bySlug.has(deal.slug)) bySlug.set(deal.slug, deal);
        }
      } catch (err) {
        console.warn(`[${SOURCE_KEY}] ${url} failed: ${err.message}`);
      }
    }

    const items = [];
    for (const deal of bySlug.values()) {
      const name = deal.public_name || deal.slug;
      const description = deal.card_description || "";
      const taxonomyText = flattenTaxonomy(deal.taxonomy);
      const blob = `${name} ${description} ${taxonomyText} ${deal.slug}`;
      if (!isAiRelatedCommunity(blob)) continue;
      if (
        isJunkCommunityItem({
          source: SOURCE_KEY,
          name,
          meta: { description },
        })
      ) {
        continue;
      }

      const startMs = deal.start_date ? Date.parse(deal.start_date) : NaN;
      const isNewTag = Array.isArray(deal.internal_tags)
        ? deal.internal_tags.some((t) => /new/i.test(String(t)))
        : false;
      if (Number.isFinite(startMs)) {
        if (!isTodayShanghai(startMs)) continue;
      } else if (!isNewTag) {
        continue;
      }
      if (deal.has_ended) continue;

      const reviews = Number(deal.review_count ?? 0) || 0;
      const users = Number(deal.total_votes_count ?? 0) || 0;

      const item = {
        source: SOURCE_KEY,
        sourceLabel: "AppSumo",
        category: "community",
        id: deal.slug,
        name,
        url: `https://appsumo.com/products/${deal.slug}/`,
        detectedAt: new Date().toISOString(),
        meta: {
          description: description || null,
          startDate: deal.start_date ?? null,
          createdAt: deal.start_date ?? null,
          price: deal.price ?? null,
          originalPrice: deal.original_price ?? null,
          reviewCount: deal.review_count ?? null,
          users,
          reviews,
          taxonomy: taxonomyText || null,
          points: reviews || users,
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

function extractDeals() {
  const out = [];
  const seen = new Set();

  const el = document.querySelector("#__NEXT_DATA__");
  if (el?.textContent) {
    try {
      const data = JSON.parse(el.textContent);
      const pageProps = data?.props?.pageProps ?? {};
      const lists = [
        pageProps?.fallbackData?.[0]?.deals,
        pageProps?.deals?.deals,
        pageProps?.deals,
      ];
      for (const list of lists) {
        if (!Array.isArray(list)) continue;
        for (const d of list) {
          const slug = d?.slug;
          if (!slug || seen.has(slug) || !d.public_name) continue;
          seen.add(slug);
          out.push(normalizeDeal(d));
        }
      }
    } catch {
      // fall through to DOM
    }
  }

  if (out.length === 0) {
    for (const a of document.querySelectorAll('a[href*="/products/"]')) {
      const href = a.getAttribute("href") || "";
      const m = href.match(/\/products\/([^/?#]+)\/?/);
      if (!m) continue;
      const slug = m[1];
      if (seen.has(slug)) continue;
      seen.add(slug);
      const name = (a.getAttribute("aria-label") || a.textContent || slug)
        .replace(/^View deal:\s*/i, "")
        .replace(/\s+/g, " ")
        .trim();
      out.push({
        slug,
        public_name: name,
        card_description: "",
        start_date: null,
        internal_tags: [],
        has_ended: false,
        price: null,
        original_price: null,
        review_count: null,
        total_votes_count: null,
        taxonomy: null,
      });
    }
  }

  return out;

  function normalizeDeal(d) {
    return {
      slug: d.slug,
      public_name: d.public_name,
      card_description: d.card_description ?? "",
      start_date: d.dates?.start_date ?? null,
      internal_tags: d.internal_tags ?? [],
      has_ended: Boolean(d.has_ended),
      price: d.price ?? null,
      original_price: d.original_price ?? null,
      review_count: d.reviews_summary?.review_count ?? d.deal_review?.review_count ?? null,
      total_votes_count: d.total_votes_count ?? null,
      taxonomy: d.taxonomy ?? null,
    };
  }
}

function flattenTaxonomy(taxonomy) {
  if (!taxonomy || typeof taxonomy !== "object") return "";
  const parts = [];
  for (const v of Object.values(taxonomy)) {
    if (v?.search_values) parts.push(...v.search_values);
    else if (v?.value_enumeration) parts.push(v.value_enumeration);
  }
  return parts.join(" ");
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
