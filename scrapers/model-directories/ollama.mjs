// Ollama has no official "list all models" API — GitHub issue ollama/ollama#8554
// requesting one is still open/unresolved (confirmed as of investigation time).
//
// Working approach (same one used by github.com/simonw/ollama-models-atom-feed):
// fetch https://ollama.com/search?o=newest (server-rendered HTML, sorted newest-first)
// and parse the model cards with cheerio.
//
// Verified live 2026-08-27: GET https://ollama.com/search?o=newest returns 200 with an
// HTML list `<ul role="list"><li>...<a href="/library/<slug>">...` — one <li> per model.
// Inside each <li>:
//   - <a href="/library/<slug>"> wraps the whole card
//   - <h2><span>display name</span></h2> — display name (usually == slug)
//   - <p class="max-w-lg ..."> — short description
//   - capability badge <span> elements with a class containing "indigo-600" (e.g. vision,
//     tools, thinking)
//   - a stats <p> containing "<n> Pulls", "<n> Tags", and "Updated <relative time>" with a
//     `title="<full UTC timestamp>"` attribute on the "Updated" stat span
// This page only returns ~20 cards per request; there's a `?page=2` (and hx-get) for more,
// but since we only care about the newest listings and diff against the last snapshot, a
// single fetch of the newest-sorted first page is sufficient to catch new arrivals.

import * as cheerio from "cheerio";
import { diffAndSave } from "../../lib/snapshot.mjs";

const SOURCE_KEY = "ollama";
const SEARCH_URL = "https://ollama.com/search?o=newest";

export default async function run() {
  let html;
  try {
    const res = await fetch(SEARCH_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ai-word-radar/0.1; +https://github.com/)",
      },
    });
    if (!res.ok) {
      console.warn(`[ollama] fetch failed: HTTP ${res.status} from ${SEARCH_URL}`);
      return [];
    }
    html = await res.text();
  } catch (err) {
    console.warn(`[ollama] fetch threw: ${err.message}`);
    return [];
  }

  let fresh;
  try {
    fresh = parseModels(html);
  } catch (err) {
    console.warn(`[ollama] parse threw: ${err.message}`);
    return [];
  }

  if (fresh.length === 0) {
    console.warn(
      "[ollama] parsed 0 models from search page — selector likely stale, DOM structure may have changed"
    );
    return [];
  }

  const added = await diffAndSave(SOURCE_KEY, fresh);
  return added.map(toNewItem);
}

function parseModels(html) {
  const $ = cheerio.load(html);
  const cards = $('a[href^="/library/"]');

  if (cards.length === 0) {
    return [];
  }

  const seen = new Set();
  const results = [];

  cards.each((_, el) => {
    const $card = $(el);
    const href = $card.attr("href") || "";
    const slug = href.replace(/^\/library\//, "").trim();
    if (!slug || seen.has(slug)) return;
    seen.add(slug);

    const name = $card.find("h2 span").first().text().trim() || slug;
    const description = $card.find("p.max-w-lg").first().text().trim() || null;

    const capabilities = [];
    $card.find('span[class*="indigo-600"]').each((__, badge) => {
      const text = $(badge).text().trim();
      if (text) capabilities.push(text);
    });

    // Stats line: "<n> Pulls   <n> Tags   Updated <relative>" — flatten whitespace and
    // regex out the pieces rather than relying on brittle nth-child selectors.
    const statsText = $card
      .find("p.my-1.flex, p.flex.space-x-5")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();

    const pullsMatch = statsText.match(/([\d.,]+[kKmM]?)\s*Pulls/);
    const tagsMatch = statsText.match(/([\d.,]+[kKmM]?)\s*Tags/);
    const updatedRelative = statsText.match(/Updated\s+(.+?)(?:$)/);

    const updatedAtTitle = $card
      .find("span[title]")
      .filter((__, s) => /updated/i.test($(s).parent().text() || ""))
      .first()
      .attr("title");

    results.push({
      id: slug,
      name,
      url: `https://ollama.com/library/${slug}`,
      meta: {
        description,
        capabilities,
        pulls: pullsMatch ? pullsMatch[1] : null,
        tags: tagsMatch ? tagsMatch[1] : null,
        updatedRelative: updatedRelative ? updatedRelative[1].trim() : null,
        updatedAt: updatedAtTitle || null,
      },
    });
  });

  return results;
}

function toNewItem(item) {
  return {
    source: SOURCE_KEY,
    sourceLabel: "Ollama",
    category: "model-directory",
    id: item.id,
    name: item.name,
    url: item.url,
    detectedAt: new Date().toISOString(),
    meta: item.meta ?? {},
  };
}
