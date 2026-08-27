// Reddit community scraper.
// Reddit's read-only public JSON endpoints (GET /r/<sub>/new.json) work without OAuth,
// but Reddit aggressively blocks requests with a missing/generic User-Agent (and, in some
// networks, datacenter IPs regardless of UA — verified during development: this sandbox's
// outbound IP got a 403 "block" HTML page instead of JSON even with a descriptive UA set).
// That's a network-level condition, not a code bug, so each subreddit fetch is wrapped in
// its own try/catch and a failure there just yields zero items for that subreddit rather
// than crashing the whole scraper or the orchestrator.
//
// Diffing: each subreddit gets its own snapshot key (`reddit-<subreddit>`) so new posts are
// tracked independently per subreddit, matching CONTRACT.md's per-source diffAndSave model.
// This module's single default-exported run() then aggregates every subreddit's new posts
// into one flat array, all tagged source: "reddit" per the manifest.

import { diffAndSave } from "../../lib/snapshot.mjs";

const SOURCE_KEY = "reddit";
const SOURCE_LABEL = "Reddit";
const USER_AGENT = "ai-word-radar/0.1 (monitoring bot)";
const SUBREDDITS = ["LocalLLaMA", "singularity", "OpenAI", "artificial"];

export default async function run() {
  const allNew = [];

  for (const subreddit of SUBREDDITS) {
    try {
      const items = await fetchSubreddit(subreddit);
      allNew.push(...items);
    } catch (err) {
      console.warn(`[${SOURCE_KEY}] r/${subreddit} failed: ${err.message}`);
    }
  }

  return allNew;
}

async function fetchSubreddit(subreddit) {
  const url = `https://www.reddit.com/r/${subreddit}/new.json?limit=25`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json();
  const children = json?.data?.children;
  if (!Array.isArray(children)) throw new Error("unexpected response shape (no data.children)");

  const fresh = children
    .map((c) => c?.data)
    .filter((d) => d?.id && d?.permalink)
    .map((d) => ({
      id: d.id,
      name: d.title ?? d.id,
      url: `https://reddit.com${d.permalink}`,
      meta: {
        subreddit,
        author: d.author ?? "unknown",
        score: typeof d.score === "number" ? d.score : null,
        num_comments: typeof d.num_comments === "number" ? d.num_comments : null,
        created_utc: d.created_utc ?? null,
      },
    }));

  const snapshotKey = `${SOURCE_KEY}-${subreddit}`;
  const added = await diffAndSave(snapshotKey, fresh);

  return added.map(toNewItem);
}

function toNewItem(item) {
  return {
    source: SOURCE_KEY,
    sourceLabel: SOURCE_LABEL,
    category: "community",
    id: item.id,
    name: item.name,
    url: item.url,
    detectedAt: new Date().toISOString(),
    meta: item.meta ?? {},
  };
}
