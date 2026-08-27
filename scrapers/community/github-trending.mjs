import * as cheerio from "cheerio";
import { diffAndSave } from "../../lib/snapshot.mjs";

const SOURCE_KEY = "github-trending";
const TRENDING_URL = "https://github.com/trending?since=daily";

export default async function run() {
  try {
    const res = await fetch(TRENDING_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ai-word-radar/1.0)" },
    });
    if (!res.ok) {
      console.warn(`[github-trending] fetch failed: HTTP ${res.status}`);
      return [];
    }
    const html = await res.text();
    const $ = cheerio.load(html);
    const fresh = [];

    $("article.Box-row").each((_, el) => {
      const row = $(el);

      // Repo name lives in h2.h3.lh-condensed > a, rendered as "owner /\nrepo"
      // (with an icon <svg> before it) — normalize whitespace then strip
      // spaces around the slash to get "owner/repo".
      const rawName = row.find("h2 a").first().text().replace(/\s+/g, " ").trim();
      if (!rawName) return;
      const id = rawName.replace(/\s*\/\s*/g, "/");
      if (!id.includes("/")) return;

      const description =
        row.find("p.col-9").first().text().replace(/\s+/g, " ").trim() || null;

      // Total stars link: <a href="/owner/repo/stargazers">1,234</a>
      const starsText = row.find('a[href$="/stargazers"]').first().text().replace(/\s+/g, " ").trim();
      const stars = starsText ? Number(starsText.replace(/,/g, "")) : null;

      const language = row.find('span[itemprop="programmingLanguage"]').first().text().trim() || null;

      fresh.push({
        id,
        name: id,
        url: `https://github.com/${id}`,
        meta: {
          description,
          stars: Number.isFinite(stars) ? stars : null,
          language,
        },
      });
    });

    if (fresh.length === 0) {
      console.warn("[github-trending] parsed 0 repos — selector may be stale, check GitHub's current markup");
      return [];
    }

    const added = await diffAndSave(SOURCE_KEY, fresh);
    return added.map((item) => ({
      source: SOURCE_KEY,
      sourceLabel: "GitHub Trending",
      category: "trending",
      id: item.id,
      name: item.name,
      url: item.url,
      detectedAt: new Date().toISOString(),
      meta: item.meta ?? {},
    }));
  } catch (err) {
    console.warn(`[github-trending] scrape failed: ${err.message}`);
    return [];
  }
}
