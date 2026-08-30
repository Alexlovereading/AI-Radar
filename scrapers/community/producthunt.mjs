// Product Hunt GraphQL scraper. Requires PRODUCTHUNT_TOKEN. Returns today's
// AI-topic posts that already have some votes — not a first-seen snapshot.

import {
  isAiRelatedCommunity,
  isJunkCommunityItem,
  isTodayShanghai,
  passesHardFilter,
} from "../../lib/community-filter.mjs";

const SOURCE_KEY = "producthunt";
const MIN_VOTES = 20;
const LOOKBACK_MS = 86400 * 1000;

const QUERY = `query ($postedAfter: DateTime) {
  posts(topic: "artificial-intelligence", order: NEWEST, first: 20, postedAfter: $postedAfter) {
    edges {
      node {
        id
        name
        url
        tagline
        website
        votesCount
        commentsCount
        createdAt
        topics {
          edges {
            node {
              name
              slug
            }
          }
        }
      }
    }
  }
}`;

export default async function run() {
  try {
    const token = process.env.PRODUCTHUNT_TOKEN;
    if (!token) {
      console.warn(
        "[producthunt] PRODUCTHUNT_TOKEN not set — skipping (scraping the JS-heavy web UI is unreliable)"
      );
      return [];
    }

    const postedAfter = new Date(Date.now() - LOOKBACK_MS).toISOString();
    let json = await fetchPosts(token, postedAfter);
    if (!json) return [];
    if (json.errors) {
      console.warn(
        `[producthunt] GraphQL errors (with postedAfter): ${JSON.stringify(json.errors)}`
      );
      json = await fetchPosts(token, null);
      if (!json) return [];
      if (json.errors) {
        console.warn(`[producthunt] GraphQL errors: ${JSON.stringify(json.errors)}`);
        return [];
      }
    }

    const edges = json?.data?.posts?.edges ?? [];
    const items = [];

    for (const edge of edges) {
      const node = edge?.node;
      if (!node?.id || !node?.name) continue;

      const topicNames = (node.topics?.edges ?? [])
        .map((e) => e?.node?.name)
        .filter(Boolean);
      const blob = `${node.name} ${node.tagline ?? ""} ${topicNames.join(" ")}`;
      if (!isAiRelatedCommunity(blob)) continue;
      if (isJunkCommunityItem({ source: SOURCE_KEY, name: node.name, meta: { tagline: node.tagline } })) {
        continue;
      }
      if (!node.createdAt || !isTodayShanghai(node.createdAt)) continue;

      const votesCount = Number(node.votesCount ?? 0);
      if (votesCount < MIN_VOTES) continue;

      const commentsCount = Number(node.commentsCount ?? 0);

      const item = {
        source: SOURCE_KEY,
        sourceLabel: "Product Hunt",
        category: "trending",
        id: String(node.id),
        name: node.name,
        url: node.website ?? node.url,
        detectedAt: new Date().toISOString(),
        meta: {
          votes: Number.isFinite(votesCount) ? votesCount : 0,
          comments: Number.isFinite(commentsCount) ? commentsCount : 0,
          votesCount: Number.isFinite(votesCount) ? votesCount : 0,
          commentsCount: Number.isFinite(commentsCount) ? commentsCount : 0,
          createdAt: node.createdAt ?? null,
          tagline: node.tagline ?? null,
          topic: topicNames[0] ?? "artificial-intelligence",
          points: Number.isFinite(votesCount) ? votesCount : 0,
        },
      };
      if (!passesHardFilter(item)) continue;
      items.push(item);
    }

    return items;
  } catch (err) {
    console.warn(`[producthunt] scrape failed: ${err.message}`);
    return [];
  }
}

async function fetchPosts(token, postedAfter) {
  const res = await fetch("https://api.producthunt.com/v2/api/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: QUERY,
      variables: { postedAfter: postedAfter ?? null },
    }),
  });
  if (!res.ok) {
    console.warn(`[producthunt] GraphQL fetch failed: HTTP ${res.status}`);
    return null;
  }
  return res.json();
}
