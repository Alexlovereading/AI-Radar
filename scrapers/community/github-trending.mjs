// GitHub Trending (daily) community scraper.
// The listing is already "today"; we keep AI-related repos and drop awesome-lists,
// tutorials, and generic libraries. Returns the filtered list every run — heat
// (stars today) changes, so we do not diff first-seen.

import * as cheerio from "cheerio";
import {
  isAiRelatedCommunity,
  isJunkCommunityItem,
  passesHardFilter,
} from "../../lib/community-filter.mjs";

const SOURCE_KEY = "github-trending";
const TRENDING_URL = "https://github.com/trending?since=daily";

const GENERIC_REPO_NAMES = new Set([
  "googletest",
  "gtest",
  "catch2",
  "junit",
  "junit5",
  "pytest",
  "lodash",
  "express",
  "react",
  "vue",
  "angular",
  "django",
  "rails",
  "linux",
  "kubernetes",
  "terraform",
  "hello-world",
  "dotfiles",
]);

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
    const items = [];

    $("article.Box-row").each((_, el) => {
      const row = $(el);

      const rawName = row.find("h2 a").first().text().replace(/\s+/g, " ").trim();
      if (!rawName) return;
      const id = rawName.replace(/\s*\/\s*/g, "/");
      if (!id.includes("/")) return;

      const description =
        row.find("p.col-9").first().text().replace(/\s+/g, " ").trim() || null;

      const repo = id.split("/")[1] ?? "";
      const blob = `${id} ${description ?? ""}`;
      if (!isAiRelatedCommunity(blob)) return;
      if (GENERIC_REPO_NAMES.has(repo.toLowerCase())) return;

      const candidate = {
        source: SOURCE_KEY,
        name: id,
        meta: { description },
      };
      if (isJunkCommunityItem(candidate)) return;

      const starsText = row
        .find('a[href$="/stargazers"]')
        .first()
        .text()
        .replace(/\s+/g, " ")
        .trim();
      const stars = starsText ? Number(starsText.replace(/,/g, "")) : null;

      const todayText = row
        .find("span.d-inline-block.float-sm-right")
        .first()
        .text()
        .replace(/\s+/g, " ")
        .trim();
      const todayMatch = todayText.match(/([\d,]+)\s+stars today/i);
      const starsToday = todayMatch ? Number(todayMatch[1].replace(/,/g, "")) : null;

      const language =
        row.find('span[itemprop="programmingLanguage"]').first().text().trim() || null;

      const item = {
        source: SOURCE_KEY,
        sourceLabel: "GitHub Trending",
        category: "trending",
        id,
        name: id,
        url: `https://github.com/${id}`,
        detectedAt: new Date().toISOString(),
        meta: {
          description,
          stars: Number.isFinite(stars) ? stars : null,
          starsToday: Number.isFinite(starsToday) ? starsToday : null,
          language,
        },
      };
      if (!passesHardFilter(item)) return;
      items.push(item);
    });

    if (items.length === 0 && $("article.Box-row").length === 0) {
      console.warn(
        "[github-trending] parsed 0 repos — selector may be stale, check GitHub's current markup"
      );
    }

    return items;
  } catch (err) {
    console.warn(`[github-trending] scrape failed: ${err.message}`);
    return [];
  }
}
