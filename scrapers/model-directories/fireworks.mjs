// Fireworks AI model directory scraper.
//
// GET /v1/accounts/${FIREWORKS_ACCOUNT_ID}/models requires both
// `Authorization: Bearer ${FIREWORKS_API_KEY}` and a valid account id in the URL path.
// Confirmed live (2026-08-27) that a request with no key/account returns HTTP 401
// ({"error":{"message":"You must provide an API key...","code":"UNAUTHORIZED",...}}).
// Could not verify the authenticated response body shape (no FIREWORKS_API_KEY /
// FIREWORKS_ACCOUNT_ID available in this environment) — field access below is
// defensive/optional-chained, and the list is read from whichever of `models` / `data` /
// a bare top-level array is actually present rather than assuming one.

import { diffAndSave } from "../../lib/snapshot.mjs";

const SOURCE_KEY = "fireworks";

export default async function run() {
  const apiKey = process.env.FIREWORKS_API_KEY;
  const accountId = process.env.FIREWORKS_ACCOUNT_ID;

  if (!apiKey || !accountId) {
    console.warn(
      `[${SOURCE_KEY}] FIREWORKS_API_KEY and/or FIREWORKS_ACCOUNT_ID not set, skipping fireworks scraper`
    );
    return [];
  }

  const apiUrl = `https://api.fireworks.ai/v1/accounts/${accountId}/models`;

  let json;
  try {
    const res = await fetch(apiUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = await res.json();
  } catch (err) {
    console.warn(`[${SOURCE_KEY}] fetch failed: ${err.message}`);
    return [];
  }

  // Response shape unverified — try the plausible container keys defensively.
  const list = Array.isArray(json)
    ? json
    : Array.isArray(json?.models)
      ? json.models
      : Array.isArray(json?.data)
        ? json.data
        : [];

  const fresh = list
    .map((m) => {
      // Fireworks resource names look like "accounts/<acct>/models/<name>"; fall back
      // through the fields we're unsure about rather than assuming one is present.
      const id = m?.name ?? m?.id ?? null;
      if (!id) return null;
      const shortName = typeof id === "string" ? id.split("/").pop() : id;
      return {
        id,
        name: m?.displayName ?? shortName,
        url: `https://fireworks.ai/models/${accountId}/${shortName}`,
        meta: {
          state: m?.state ?? null,
          kind: m?.kind ?? m?.type ?? null,
          createTime: m?.createTime ?? null,
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
    sourceLabel: "Fireworks AI",
    category: "model-directory",
    id: item.id,
    name: item.name,
    url: item.url,
    detectedAt: new Date().toISOString(),
    meta: item.meta ?? {},
  };
}
