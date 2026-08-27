// LM Arena has no official API. Per the brief, the real data source is the Hugging Face
// dataset lmarena-ai/leaderboard-dataset.
//
// Investigation:
// 1. GET https://huggingface.co/api/datasets/lmarena-ai/leaderboard-dataset (200 OK) —
//    confirms the dataset's `siblings` are ALL `.parquet` files (e.g.
//    "text/latest-00000-of-00001.parquet") and its tags include "format:parquet". So the
//    brief's anticipated worst case is correct: there is no CSV/JSON file to fetch directly
//    from `.../resolve/main/<filename>`, only parquet, which we can't parse without adding a
//    dependency (parquet is a binary columnar format — would need duckdb-wasm, parquetjs, or
//    a Python sidecar to read).
//
// 2. Rather than stop there, we use Hugging Face's own public Datasets Server API, which
//    serves any parquet-backed dataset as plain JSON rows server-side — no parquet parsing
//    and no new npm dependency required, just fetch() + JSON.parse:
//
//      GET https://datasets-server.huggingface.co/rows
//          ?dataset=lmarena-ai/leaderboard-dataset&config=text&split=latest&offset=0&length=100
//
//    Verified live: returns 200 with real rows shaped like
//      { model_name, organization, license, rating, rating_lower, rating_upper, variance,
//        vote_count, rank, category, leaderboard_publish_date }
//    The "text" config's "latest" split holds the current text-arena leaderboard across many
//    `category` values (overall, chinese, coding, ...); rows are grouped contiguously by
//    category and "overall" (the main ranking) occupies roughly the first ~400 rows. We page
//    through until `category` stops being "overall" (or hit a safety cap), so we only pull
//    the main leaderboard rather than all ~10k rows across every category.
//
// This is technically a "future implementer" note fulfilled in code: if HF's datasets-server
// ever goes away or the dataset's config/columns change, the fallback is exactly what the
// brief anticipated — parse the raw .parquet siblings, which requires a parquet reader
// (duckdb-wasm or a Python sidecar) since none is installed here.

import { diffAndSave } from "../../lib/snapshot.mjs";

const SOURCE_KEY = "lmarena";
const HF_DATASET_API = "https://huggingface.co/api/datasets/lmarena-ai/leaderboard-dataset";
const ROWS_API = "https://datasets-server.huggingface.co/rows";
const CONFIG = "text";
const SPLIT = "latest";
const PAGE_LENGTH = 100;
const MAX_PAGES = 6; // ~600 rows safety cap in case "overall" is larger than expected

export default async function run() {
  // Sanity check the dataset is still parquet-only / still exists in the shape we expect.
  // Not fatal if this call fails — the rows API is what we actually depend on.
  try {
    const res = await fetch(HF_DATASET_API);
    if (!res.ok) {
      console.warn(`[lmarena] HF dataset metadata check failed: HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn(`[lmarena] HF dataset metadata check threw: ${err.message}`);
  }

  let fresh;
  try {
    fresh = await fetchOverallLeaderboard();
  } catch (err) {
    console.warn(`[lmarena] datasets-server rows fetch/parse threw: ${err.message}`);
    return [];
  }

  if (!fresh || fresh.length === 0) {
    console.warn(
      "[lmarena] no rows parsed from HF datasets-server — dataset config/columns may have " +
        "changed. Fallback would require parsing the raw .parquet files directly " +
        "(consider duckdb-wasm or a Python sidecar), which is not implemented here."
    );
    return [];
  }

  const added = await diffAndSave(SOURCE_KEY, fresh);
  return added.map(toNewItem);
}

async function fetchOverallLeaderboard() {
  const results = [];
  const seen = new Set();

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const offset = page * PAGE_LENGTH;
    const url = new URL(ROWS_API);
    url.searchParams.set("dataset", "lmarena-ai/leaderboard-dataset");
    url.searchParams.set("config", CONFIG);
    url.searchParams.set("split", SPLIT);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("length", String(PAGE_LENGTH));

    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      console.warn(`[lmarena] rows fetch failed at offset ${offset}: HTTP ${res.status}`);
      break;
    }

    const json = await res.json();
    const rows = Array.isArray(json.rows) ? json.rows : [];
    if (rows.length === 0) break;

    let sawNonOverall = false;
    for (const { row } of rows) {
      if (!row || !row.model_name) continue;
      if (row.category !== "overall") {
        sawNonOverall = true;
        break;
      }
      if (seen.has(row.model_name)) continue;
      seen.add(row.model_name);
      results.push({
        id: row.model_name,
        name: row.model_name,
        url: "https://lmarena.ai/leaderboard",
        meta: {
          organization: row.organization ?? "unknown",
          license: row.license ?? null,
          rating: row.rating ?? null,
          ratingLower: row.rating_lower ?? null,
          ratingUpper: row.rating_upper ?? null,
          voteCount: row.vote_count ?? null,
          rank: row.rank ?? null,
          category: row.category ?? null,
          leaderboardPublishDate: row.leaderboard_publish_date ?? null,
        },
      });
    }

    if (sawNonOverall) break; // moved past the "overall" category, stop paging
    if (rows.length < PAGE_LENGTH) break; // last page
  }

  return results;
}

function toNewItem(item) {
  return {
    source: SOURCE_KEY,
    sourceLabel: "LM Arena",
    category: "model-directory",
    id: item.id,
    name: item.name,
    url: item.url,
    detectedAt: new Date().toISOString(),
    meta: item.meta ?? {},
  };
}
