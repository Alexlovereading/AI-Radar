import { diffAndSave } from "../../lib/snapshot.mjs";

const SOURCE_KEY = "producthunt";

// Product Hunt's public web UI is JS-rendered (client-side React) and does not
// reliably expose post data in server HTML, so scraping it with cheerio is not
// viable. The only reliable path is the official GraphQL API, which requires
// OAuth. We only attempt the API path when PRODUCTHUNT_TOKEN is configured;
// otherwise we skip this source entirely rather than scrape unreliable JS UI.
export default async function run() {
  try {
    const token = process.env.PRODUCTHUNT_TOKEN;
    if (!token) {
      console.warn(
        "[producthunt] PRODUCTHUNT_TOKEN not set — skipping (scraping the JS-heavy web UI is unreliable)"
      );
      return [];
    }

    const query = `query {
      posts(topic: "artificial-intelligence", order: NEWEST, first: 20) {
        edges {
          node {
            id
            name
            url
            tagline
            website
          }
        }
      }
    }`;

    const res = await fetch("https://api.producthunt.com/v2/api/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });

    if (!res.ok) {
      console.warn(`[producthunt] GraphQL fetch failed: HTTP ${res.status}`);
      return [];
    }

    const json = await res.json();

    if (json.errors) {
      console.warn(`[producthunt] GraphQL errors: ${JSON.stringify(json.errors)}`);
      return [];
    }

    const edges = json?.data?.posts?.edges ?? [];
    const fresh = edges.map(({ node }) => ({
      id: node.id,
      name: node.name,
      url: node.website ?? node.url,
      meta: { tagline: node.tagline ?? null },
    }));

    const added = await diffAndSave(SOURCE_KEY, fresh);

    return added.map((item) => ({
      source: SOURCE_KEY,
      sourceLabel: "Product Hunt",
      category: "trending",
      id: item.id,
      name: item.name,
      url: item.url,
      detectedAt: new Date().toISOString(),
      meta: item.meta ?? {},
    }));
  } catch (err) {
    console.warn(`[producthunt] scrape failed: ${err.message}`);
    return [];
  }
}
