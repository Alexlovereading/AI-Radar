// Shared scraper-orchestration helpers used by scripts/run-all.mjs and
// scripts/run-community.mjs. Both scripts sequentially run a manifest of scraper
// modules with error isolation and a polite delay between requests; this module
// is the single place that logic lives, so a reliability fix (timeout, retry,
// error-shape change) only needs to be made once.

export async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Dynamically imports a scraper module and runs its default export with full
// error isolation: an import failure, a missing/non-function default export, a
// thrown run(), and a non-array return are all caught here and normalized into
// the same result shape, so callers never need their own try/catch around a
// scraper invocation.
export async function runScraper(sourceKey, relativePath, { logPrefix = "[scraper]" } = {}) {
  let mod;
  try {
    mod = await import(relativePath);
  } catch (err) {
    console.error(`${logPrefix} FAILED to import ${sourceKey} (${relativePath}): ${err.message}`);
    return { sourceKey, status: "error", items: [], note: err.message };
  }

  const run = mod.default;
  if (typeof run !== "function") {
    const note = "no default export function";
    console.error(`${logPrefix} FAILED: ${sourceKey} ${note}`);
    return { sourceKey, status: "error", items: [], note };
  }

  try {
    const items = await run();
    if (!Array.isArray(items)) {
      const note = "run() did not return an array";
      console.error(`${logPrefix} FAILED: ${sourceKey} ${note}`);
      return { sourceKey, status: "error", items: [], note };
    }
    return { sourceKey, status: "ok", items, note: "" };
  } catch (err) {
    console.error(`${logPrefix} FAILED: ${sourceKey} run() threw: ${err.message}`);
    return { sourceKey, status: "error", items: [], note: err.message };
  }
}

// Calls `handler(sourceKey, relativePath, index)` for every [sourceKey, relativePath]
// pair in `manifest`, strictly sequentially, waiting `delayMs` between each call (never
// after the last one) so upstream APIs never see concurrent or back-to-back requests
// from this process. `handler` decides what to do with each source (e.g. call
// runScraper and record the result) — this helper only owns the iteration/delay shape.
export async function runManifestSequential(manifest, handler, { delayMs = 300 } = {}) {
  for (let i = 0; i < manifest.length; i++) {
    const [sourceKey, relativePath] = manifest[i];
    await handler(sourceKey, relativePath, i);
    if (i < manifest.length - 1) await sleep(delayMs);
  }
}
