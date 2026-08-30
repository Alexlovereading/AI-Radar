// Reddit community scraper.
// Public JSON endpoints work without OAuth, but Reddit often 403s datacenter IPs.
// A 403/failure on one subreddit is skipped; the rest still run. Returns today's
// hot/top candidates every run — do not diff first-seen (score/comments change).

import {
  isAiRelatedCommunity,
  isJunkCommunityItem,
  isTodayShanghai,
  passesHardFilter,
} from "../../lib/community-filter.mjs";

const SOURCE_KEY = "reddit";
const SOURCE_LABEL = "Reddit";
const USER_AGENT = "ai-word-radar/0.1 (monitoring bot)";

const SUBREDDITS = ["LocalLLaMA", "singularity", "OpenAI", "artificial"];

const THRESHOLDS = {
  localllama: { score: 20, comments: 10 },
  singularity: { score: 50, comments: 20 },
  openai: { score: 50, comments: 20 },
  artificial: { score: 30, comments: 15 },
};
const DEFAULT_THRESHOLD = { score: 50, comments: 20 };

export default async function run() {
  const all = [];

  for (const subreddit of SUBREDDITS) {
    try {
      const items = await fetchSubreddit(subreddit);
      all.push(...items);
    } catch (err) {
      console.warn(`[${SOURCE_KEY}] r/${subreddit} failed: ${err.message}`);
    }
  }

  return all;
}

async function fetchSubreddit(subreddit) {
  const children = await fetchListing(subreddit);
  const bar = THRESHOLDS[subreddit.toLowerCase()] ?? DEFAULT_THRESHOLD;
  const items = [];

  for (const child of children) {
    const d = child?.data;
    if (!d?.id || !d?.permalink) continue;
    if (d.stickied) continue;

    const title = d.title ?? d.id;
    const createdUtc = Number(d.created_utc ?? 0);
    const score = typeof d.score === "number" ? d.score : 0;
    const numComments = typeof d.num_comments === "number" ? d.num_comments : 0;

    if (!createdUtc || !isTodayShanghai(createdUtc)) continue;
    if (!isAiRelatedCommunity(title)) continue;
    if (isJunkCommunityItem({ source: SOURCE_KEY, name: title })) continue;
    if (score < bar.score && numComments < bar.comments) continue;

    const item = {
      source: SOURCE_KEY,
      sourceLabel: SOURCE_LABEL,
      category: "community",
      id: d.id,
      name: title,
      url: `https://reddit.com${d.permalink}`,
      detectedAt: new Date().toISOString(),
      meta: {
        score,
        num_comments: numComments,
        subreddit,
        created_utc: createdUtc,
        points: score,
        author: d.author ?? "unknown",
      },
    };
    if (!passesHardFilter(item)) continue;
    items.push(item);
  }

  return items;
}

async function fetchListing(subreddit) {
  const urls = [
    `https://www.reddit.com/r/${subreddit}/top.json?t=day&limit=25`,
    `https://www.reddit.com/r/${subreddit}/hot.json?limit=25`,
  ];

  for (const url of urls) {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (res.status === 403) {
      console.warn(`[${SOURCE_KEY}] r/${subreddit} HTTP 403 — skipping this subreddit`);
      return [];
    }
    if (!res.ok) {
      console.warn(`[${SOURCE_KEY}] r/${subreddit} ${url} HTTP ${res.status}`);
      continue;
    }

    let json;
    try {
      json = await res.json();
    } catch (err) {
      console.warn(`[${SOURCE_KEY}] r/${subreddit} non-JSON response: ${err.message}`);
      return [];
    }

    const children = json?.data?.children;
    if (!Array.isArray(children)) {
      console.warn(`[${SOURCE_KEY}] r/${subreddit} unexpected response shape`);
      continue;
    }
    return children;
  }

  return [];
}
