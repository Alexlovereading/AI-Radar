#!/usr/bin/env node
// 此编排只跑模型平台+官方渠道；社区由 scripts/run-community.mjs 负责
// Sequentially imports and runs model-directory + official-source scrapers, appends
// everything they return to data/events.jsonl, scores the accumulated events, and fires
// Feishu notifications for anything that crossed the "reserve" threshold (score >= 30).

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { scoreEvents } from "../scoring/score.mjs";
import { notifyEntity } from "../notify/feishu.mjs";
import { runScraper, runManifestSequential } from "../lib/scraper-runner.mjs";

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVENTS_PATH = path.join(ROOT, "data", "events.jsonl");

// Delay between each scraper run, to be polite to upstream APIs. Scrapers run strictly
// sequentially (not concurrently) so a burst of simultaneous requests never happens.
const DELAY_MS = 300;

// Exact source key -> file path for model-directories + official-sources only.
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
];

async function appendEvents(items) {
  if (items.length === 0) return;
  await mkdir(path.dirname(EVENTS_PATH), { recursive: true });
  const lines = items.map((item) => JSON.stringify(item)).join("\n") + "\n";
  await appendFile(EVENTS_PATH, lines, "utf8");
}

async function main() {
  const startedAt = Date.now();
  const results = [];

  await runManifestSequential(
    MANIFEST,
    async (sourceKey, relativePath) => {
      const result = await runScraper(sourceKey, relativePath, { logPrefix: "[run-all]" });
      results.push(result);
      await appendEvents(result.items);
    },
    { delayMs: DELAY_MS }
  );

  const failed = results.filter((r) => r.status !== "ok").map((r) => r.sourceKey);
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

  // Regenerate site/data/entities.json from the scored output, so the Next.js site
  // (and any host like Vercel that redeploys on git push) always reflects the latest run
  // without a separate manual step.
  try {
    await execFileAsync("node", ["scripts/build-site-data.mjs"], { cwd: ROOT });
    console.log("[run-all] site/data/entities.json refreshed");
  } catch (err) {
    console.error(`[run-all] failed to refresh site data: ${err.message}`);
  }
}

main().catch((err) => {
  console.error(`[run-all] fatal error: ${err.stack ?? err.message}`);
  process.exitCode = 1;
});
