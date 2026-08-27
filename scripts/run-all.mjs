#!/usr/bin/env node
// Master orchestrator. Sequentially imports and runs every scraper module in the
// CONTRACT.md §4 manifest, appends everything they return to data/events.jsonl, scores
// the accumulated events, and fires Feishu notifications for anything that crossed the
// "reserve" threshold (score >= 30). This file — plus package.json and README.md — is the
// only place that's allowed to know about all 27 scraper paths at once; individual scraper
// modules stay ignorant of each other per the contract.

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scoreEvents } from "../scoring/score.mjs";
import { notifyEntity } from "../notify/feishu.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVENTS_PATH = path.join(ROOT, "data", "events.jsonl");

// Delay between each scraper run, to be polite to upstream APIs. Scrapers run strictly
// sequentially (not concurrently) so a burst of 27 simultaneous requests never happens.
const DELAY_MS = 300;

// Exact source key -> file path manifest from CONTRACT.md §4. Hardcoded and trusted per
// the parallel-build agreement: 4 other agents are creating these files concurrently.
const MANIFEST = [
  ["openrouter", "../scrapers/model-directories/openrouter.mjs"],
  ["huggingface", "../scrapers/model-directories/huggingface.mjs"],
  ["replicate", "../scrapers/model-directories/replicate.mjs"],
  ["together", "../scrapers/model-directories/together.mjs"],
  ["fireworks", "../scrapers/model-directories/fireworks.mjs"],
  ["ollama", "../scrapers/model-directories/ollama.mjs"],
  ["falai", "../scrapers/model-directories/falai.mjs"],
  ["artificial-analysis", "../scrapers/model-directories/artificial-analysis.mjs"],
  ["lmarena", "../scrapers/model-directories/lmarena.mjs"],
  ["openai", "../scrapers/official-sources/openai.mjs"],
  ["anthropic", "../scrapers/official-sources/anthropic.mjs"],
  ["deepmind", "../scrapers/official-sources/deepmind.mjs"],
  ["meta", "../scrapers/official-sources/meta.mjs"],
  ["qwen", "../scrapers/official-sources/qwen.mjs"],
  ["deepseek", "../scrapers/official-sources/deepseek.mjs"],
  ["xai", "../scrapers/official-sources/xai.mjs"],
  ["mistral", "../scrapers/official-sources/mistral.mjs"],
  ["kimi", "../scrapers/official-sources/kimi.mjs"],
  ["zhipu", "../scrapers/official-sources/zhipu.mjs"],
  ["minimax", "../scrapers/official-sources/minimax.mjs"],
  ["producthunt", "../scrapers/community/producthunt.mjs"],
  ["github-trending", "../scrapers/community/github-trending.mjs"],
  ["hackernews", "../scrapers/community/hackernews.mjs"],
  ["reddit", "../scrapers/community/reddit.mjs"],
  ["chrome-web-store", "../scrapers/community/chrome-web-store.mjs"],
  ["appsumo", "../scrapers/community/appsumo.mjs"],
  ["google-trends", "../scrapers/community/google-trends.mjs"],
];

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runScraper(sourceKey, relativePath) {
  let mod;
  try {
    mod = await import(relativePath);
  } catch (err) {
    console.error(`[run-all] FAILED to import ${sourceKey} (${relativePath}): ${err.message}`);
    return { sourceKey, ok: false, items: [] };
  }

  const run = mod.default;
  if (typeof run !== "function") {
    console.error(`[run-all] FAILED: ${sourceKey} has no default export function`);
    return { sourceKey, ok: false, items: [] };
  }

  try {
    const items = await run();
    if (!Array.isArray(items)) {
      console.error(`[run-all] FAILED: ${sourceKey} run() did not return an array`);
      return { sourceKey, ok: false, items: [] };
    }
    return { sourceKey, ok: true, items };
  } catch (err) {
    console.error(`[run-all] FAILED: ${sourceKey} run() threw: ${err.message}`);
    return { sourceKey, ok: false, items: [] };
  }
}

async function appendEvents(items) {
  if (items.length === 0) return;
  await mkdir(path.dirname(EVENTS_PATH), { recursive: true });
  const lines = items.map((item) => JSON.stringify(item)).join("\n") + "\n";
  await appendFile(EVENTS_PATH, lines, "utf8");
}

async function main() {
  const startedAt = Date.now();
  const results = [];

  for (let i = 0; i < MANIFEST.length; i++) {
    const [sourceKey, relativePath] = MANIFEST[i];
    const result = await runScraper(sourceKey, relativePath);
    results.push(result);
    await appendEvents(result.items);

    if (i < MANIFEST.length - 1) await sleep(DELAY_MS);
  }

  const failed = results.filter((r) => !r.ok).map((r) => r.sourceKey);
  const perSourceCounts = results.map((r) => `${r.sourceKey}=${r.items.length}`).join(", ");
  const totalNew = results.reduce((sum, r) => sum + r.items.length, 0);

  console.log(`\n[run-all] scraping done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  console.log(`[run-all] total new items: ${totalNew}`);
  console.log(`[run-all] per-source counts: ${perSourceCounts}`);
  if (failed.length > 0) {
    console.log(`[run-all] FAILED sources (${failed.length}): ${failed.join(", ")}`);
  } else {
    console.log("[run-all] all scrapers ran without throwing");
  }

  // Score the accumulated events.jsonl (not just this run's new items — scoring aggregates
  // across all recorded history so cross-source corroboration over time keeps working).
  const scored = await scoreEvents();

  const tierCounts = scored.reduce((acc, e) => {
    acc[e.tier] = (acc[e.tier] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `[run-all] scored ${scored.length} entities — tiers: ${JSON.stringify(tierCounts)}`
  );

  // Notify for anything at "reserve" tier or above (score >= 30).
  const toNotify = scored.filter((e) => e.score >= 30);
  let notified = 0;
  for (const entity of toNotify) {
    const sent = await notifyEntity(entity);
    if (sent) notified++;
  }
  console.log(`[run-all] notified ${notified}/${toNotify.length} entities >= reserve tier`);
}

main().catch((err) => {
  console.error(`[run-all] fatal error: ${err.stack ?? err.message}`);
  process.exitCode = 1;
});
