// Replicate model directory scraper.
//
// GET /v1/models?sort_by=model_created_at&sort_direction=desc requires
// `Authorization: Bearer ${REPLICATE_API_TOKEN}` — confirmed live (2026-08-27) that the
// endpoint returns HTTP 401 with no token: {"title":"Unauthenticated", ...}. Could not
// verify the authenticated response body shape (no token available in this environment),
// so field access below is defensive/optional-chained based on Replicate's documented
// model object (results: [{ url, owner, name, description, visibility, run_count,
// latest_version, ... }], next: <cursor url>|null). Only the first page is fetched —
// sufficient for a 20-minute poll interval, no need to paginate exhaustively.

import { diffAndSave } from "../../lib/snapshot.mjs";

const SOURCE_KEY = "replicate";
const API_URL =
  "https://api.replicate.com/v1/models?sort_by=model_created_at&sort_direction=desc";

export default async function run() {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    console.warn(
      `[${SOURCE_KEY}] REPLICATE_API_TOKEN not set, skipping replicate scraper`
    );
    return [];
  }

  let json;
  try {
    const res = await fetch(API_URL, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = await res.json();
  } catch (err) {
    console.warn(`[${SOURCE_KEY}] fetch failed: ${err.message}`);
    return [];
  }

  const list = Array.isArray(json?.results) ? json.results : [];

  const fresh = list
    .map((m) => {
      const owner = m?.owner ?? null;
      const name = m?.name ?? null;
      // id for diffing = "owner/name" style identifier, per Replicate's own model URLs.
      const id = owner && name ? `${owner}/${name}` : m?.url ?? null;
      if (!id) return null;
      return {
        id,
        name: name ?? id,
        url: m?.url ?? `https://replicate.com/${id}`,
        meta: {
          description: m?.description ?? null,
          visibility: m?.visibility ?? null,
          run_count: m?.run_count ?? null,
          // latest_version shape unverified without live auth — keep only the id if present.
          latest_version_id: m?.latest_version?.id ?? null,
        },
      };
    })
    .filter(Boolean);

  let added;
  try {
    added = await diffAndSave(SOURCE_KEY, fresh);
  } catch (err) {
    console.warn(`[${SOURCE_KEY}] diffAndSave failed: ${err.message}`);
    return [];
  }

  return added.map(toNewItem);
}

function toNewItem(item) {
  return {
    source: SOURCE_KEY,
    sourceLabel: "Replicate",
    category: "model-directory",
    id: item.id,
    name: item.name,
    url: item.url,
    detectedAt: new Date().toISOString(),
    meta: item.meta ?? {},
  };
}
