// Shared snapshot/diff helper used by every scraper module.
// Snapshots persist as JSON in data/snapshots/<key>.json and are tracked in git,
// so git history itself is the audit trail of what changed and when (git-scraping pattern).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SNAPSHOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../data/snapshots"
);

export async function loadSnapshot(key) {
  try {
    const raw = await readFile(path.join(SNAPSHOT_DIR, `${key}.json`), "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

export async function saveSnapshot(key, items) {
  await mkdir(SNAPSHOT_DIR, { recursive: true });
  const sorted = [...items].sort((a, b) => (a.id > b.id ? 1 : -1));
  await writeFile(
    path.join(SNAPSHOT_DIR, `${key}.json`),
    JSON.stringify(sorted, null, 2) + "\n",
    "utf8"
  );
}

// Returns items present in currItems but not in prevItems, matched by idFn.
export function diffById(prevItems, currItems, idFn = (x) => x.id) {
  const prevIds = new Set(prevItems.map(idFn));
  return currItems.filter((item) => !prevIds.has(idFn(item)));
}

// Convenience wrapper: load -> diff against fresh items -> save -> return new ones.
// `fresh` must already be the full current list for this source.
export async function diffAndSave(key, fresh, idFn = (x) => x.id) {
  const prev = await loadSnapshot(key);
  const added = diffById(prev, fresh, idFn);
  await saveSnapshot(key, fresh);
  return added;
}
