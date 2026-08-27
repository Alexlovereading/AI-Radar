# AI Word Radar

Monitors ~27 AI-related sources — model directories, official lab blogs, and
community/trending sources — to catch new AI model and product names early, score how
likely each one is to "break out," and flag which ones are worth building a landing page
for before everyone else does.

## Architecture

```
scrapers/*/*.mjs  →  data/events.jsonl  →  scoring/score.mjs  →  data/scored.json  →  notify/feishu.mjs
     (27 sources)      (append-only log)      (rule-based)         (per-entity)        (webhook, score >= 30)
```

- Each scraper in `scrapers/<group>/<source>.mjs` fetches its source, diffs against a
  snapshot in `data/snapshots/<key>.json` (see `lib/snapshot.mjs`), and returns only new
  items as `NewItem[]` (shape defined in `CONTRACT.md`).
- `scripts/run-all.mjs` orchestrates: runs all 27 scrapers sequentially (300ms apart, to
  be polite to upstream APIs), appends new items to `data/events.jsonl`, then scores and
  notifies.
- `scoring/score.mjs` groups events into entities (normalized by name) and scores each
  against a fixed rule set, writing `data/scored.json`. Tiers: `log-only` (<30),
  `reserve` (30–60), `launch-today` (60–80), `full-site` (80+).
- `scoring/keywords.mjs` generates launch-day / usage / competition keyword batches for an
  entity name, for SEO/landing-page prep once it clears a threshold.
- `notify/feishu.mjs` posts a plain-text Feishu webhook message for any entity scoring 30+.
- `site/` is separate and does **not** read `data/` directly — it reads
  `site/data/entities.json`, produced from `data/scored.json` + `data/events.jsonl` by a
  separate conversion step (see `CONTRACT.md` §6).
- `.github/workflows/radar.yml` runs the pipeline on a 20-minute cron and commits `data/`
  changes back to the repo (git-scraping pattern — history is the audit trail).

## Running locally

```bash
npm install
npm run radar
```

This runs `node scripts/run-all.mjs`: scrape, append to `data/events.jsonl`, score into
`data/scored.json`, notify for "reserve" tier or above. All API keys are optional —
scrapers missing one skip themselves gracefully (`console.warn` + return `[]`).

## Optional secrets / env vars

| Variable | Unlocks |
|---|---|
| `FEISHU_WEBHOOK_URL` | Feishu (Lark) notifications for entities scoring >= 30. Without it, scoring still runs; notifications are skipped. |
| `REPLICATE_API_TOKEN` | Replicate model-directory scraper. |
| `TOGETHER_API_KEY` | Together AI model-directory scraper. |
| `FIREWORKS_API_KEY` / `FIREWORKS_ACCOUNT_ID` | Fireworks AI scraper (both required). |
| `ARTIFICIAL_ANALYSIS_API_KEY` | Artificial Analysis model-directory scraper. |
| `PRODUCTHUNT_TOKEN` | Product Hunt community scraper. |

Public/no-auth sources (OpenRouter, Hugging Face, Ollama, official lab blogs, Hacker
News, GitHub Trending, Reddit, AppSumo, Google Trends RSS, etc.) need no env vars.

## Known limitations

- **Chrome Web Store**: category/sort listing is client-JS-rendered. Plain HTTP+cheerio
  gets an empty shell or stray links unrelated to the requested sort — confirmed
  unreliable in testing, matching the known-broken `AdamSlack/chrome-web-store-scraper`
  project. Needs a headless browser (Playwright/Puppeteer); out of scope here. Always
  returns `[]` with a clear warning.
- **AppSumo**: works fine — the "new software" listing is server-rendered and scraped
  directly with cheerio.
- **Google Trends**: `pytrends` is archived/dead and there's no official API. Uses the
  legacy `trends.google.com/trending/rss` feed, which works today but is undocumented and
  could change without notice. A more durable option (`trendspyg`) is Python-only and
  would need a sidecar process — out of scope for this Node-only pass.
- **LM Arena / fal.ai**: no stable official public API; those scrapers are necessarily
  best-effort HTML/unofficial-endpoint scrapes and may break without warning.
- **Scoring engine**: some spec rules (beats a popular model on benchmarks, YouTube
  tutorial appearances, Google autocomplete, single-blogger-repost detection) have no
  real data source. They're exposed as `null` `manualOverrides` fields per entity, never
  silently scored — see `scoring/score.mjs` comments for which signals are real vs.
  placeholders.
- **Cross-source corroboration window**: the spec's "within one hour" is widened to a few
  hours in practice, since a 20-minute poll cadence makes a strict 1-hour window unlikely
  to catch much. Documented in `scoring/score.mjs`.
