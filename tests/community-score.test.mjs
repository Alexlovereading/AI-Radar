import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COMMUNITY_SOURCES,
  isJunkCommunityItem,
  isTodayShanghai,
  normalizeCommunityKey,
  passesHardFilter,
  shanghaiDateKey,
} from "../lib/community-filter.mjs";
import {
  DISPLAY_COMMUNITY_SCORE_MIN,
  MAX_PER_SOURCE,
  MAX_TOTAL,
  scoreAndRank,
  scoreCommunityItem,
} from "../scoring/community-score.mjs";

const NOW = Date.parse("2026-08-28T14:00:00+08:00");
const TODAY = new Date(NOW).toISOString();
const YESTERDAY = new Date(NOW - 36 * 3600 * 1000).toISOString();

function makeItem(overrides = {}) {
  const { meta: metaOverrides, ...rest } = overrides;
  return {
    source: "hackernews",
    sourceLabel: "Hacker News",
    category: "community",
    id: "1",
    name: "OpenAI releases GPT-5",
    url: "https://openai.com/gpt-5",
    detectedAt: TODAY,
    ...rest,
    meta: {
      points: 80,
      comments: 20,
      createdAt: TODAY,
      ...metaOverrides,
    },
  };
}

test("COMMUNITY_SOURCES lists the seven community/trending keys", () => {
  for (const key of [
    "hackernews",
    "github-trending",
    "reddit",
    "google-trends",
    "producthunt",
    "chrome-web-store",
    "appsumo",
  ]) {
    assert.ok(COMMUNITY_SOURCES.has(key), `missing ${key}`);
  }
});

test("跨日：昨天的 item 硬过滤失败", () => {
  const item = makeItem({
    detectedAt: YESTERDAY,
    meta: { createdAt: YESTERDAY, points: 200, comments: 80 },
  });
  assert.equal(isTodayShanghai(YESTERDAY, NOW), false);
  assert.equal(isTodayShanghai(TODAY, NOW), true);
  assert.equal(passesHardFilter(item, NOW), false);
});

test("垃圾内容拒绝（awesome-list、招聘）", () => {
  const awesome = makeItem({
    name: "awesome-chatgpt: curated list of LLM tools",
    url: "https://github.com/foo/awesome-chatgpt",
    meta: { points: 200, comments: 80, createdAt: TODAY },
  });
  const job = makeItem({
    name: "Hiring: AI engineer to train LLM agents",
    url: "https://news.ycombinator.com/item?id=job",
    meta: { points: 120, comments: 40, createdAt: TODAY },
  });
  assert.equal(isJunkCommunityItem(awesome), true);
  assert.equal(isJunkCommunityItem(job), true);
  assert.equal(passesHardFilter(awesome, NOW), false);
  assert.equal(passesHardFilter(job, NOW), false);
});

test("awesome 误判修复：普通形容词用法不算 junk，awesome-list 仓库仍算 junk", () => {
  const normalSentence = makeItem({
    name: "This awesome AI coding agent just launched",
    url: "https://news.ycombinator.com/item?id=normal",
    meta: { points: 150, comments: 40, createdAt: TODAY },
  });
  const awesomeList = makeItem({
    name: "awesome-chatgpt-prompts: curated list of LLM tools",
    url: "https://github.com/foo/awesome-chatgpt-prompts",
    meta: { points: 200, comments: 80, createdAt: TODAY },
  });
  assert.equal(isJunkCommunityItem(normalSentence), false);
  assert.equal(isJunkCommunityItem(awesomeList), true);
});

test("AI 新模型帖能过硬过滤", () => {
  const item = makeItem();
  assert.equal(passesHardFilter(item, NOW), true);
});

test("跨源同名合并加分", () => {
  const hn = makeItem({
    source: "hackernews",
    id: "hn-1",
    url: "https://news.ycombinator.com/item?id=1",
  });
  const reddit = makeItem({
    source: "reddit",
    sourceLabel: "Reddit",
    id: "re-1",
    url: "https://reddit.com/r/LocalLLaMA/gpt5",
    meta: { score: 90, num_comments: 30, created_utc: NOW / 1000 },
  });

  assert.equal(normalizeCommunityKey(hn), normalizeCommunityKey(reddit));

  const solo = scoreCommunityItem(hn, { now: NOW });
  const merged = scoreAndRank([hn, reddit], { now: NOW });
  assert.equal(merged.length, 1);
  assert.ok(merged[0].sources.includes("hackernews"));
  assert.ok(merged[0].sources.includes("reddit"));
  assert.ok(
    merged[0].score > solo.score,
    `expected merged ${merged[0].score} > solo ${solo.score}`
  );
  const cross = merged[0].breakdown.find((row) => row.key === "corroboration");
  assert.ok(cross && cross.points > 0);
});

test("每源上限 5、全局上限 20", () => {
  const sixHn = Array.from({ length: 6 }, (_, i) =>
    makeItem({
      id: `hn-${i}`,
      name: `OpenAI releases GPT-5 build ${i}`,
      url: `https://openai.com/gpt-5-${i}`,
      meta: { points: 200, comments: 50, createdAt: TODAY },
    })
  );
  const hnRanked = scoreAndRank(sixHn, { now: NOW });
  assert.equal(hnRanked.length, MAX_PER_SOURCE);
  assert.ok(hnRanked.every((it) => it.source === "hackernews"));

  const sources = [
    "hackernews",
    "github-trending",
    "reddit",
    "google-trends",
    "producthunt",
  ];
  const many = [];
  for (const source of sources) {
    for (let i = 0; i < 5; i++) {
      many.push(
        makeItem({
          source,
          id: `${source}-${i}`,
          name: `OpenAI releases GPT-5 ${source} ${i}`,
          url: `https://example.com/${source}/${i}`,
          meta: {
            points: 200,
            comments: 40,
            starsToday: 120,
            score: 180,
            num_comments: 40,
            votes: 150,
            approxTraffic: "200K+",
            createdAt: TODAY,
          },
        })
      );
    }
  }
  assert.equal(many.length, 25);
  const ranked = scoreAndRank(many, { now: NOW });
  assert.equal(ranked.length, MAX_TOTAL);
  const counts = new Map();
  for (const it of ranked) {
    counts.set(it.source, (counts.get(it.source) ?? 0) + 1);
  }
  for (const n of counts.values()) {
    assert.ok(n <= MAX_PER_SOURCE);
  }
});

test("阈值边界：44 不进，45 进", () => {
  assert.equal(DISPLAY_COMMUNITY_SCORE_MIN, 45);

  const low = makeItem({
    source: "github-trending",
    sourceLabel: "GitHub Trending",
    category: "trending",
    id: "low",
    name: "acme/fast-llm-inference",
    url: "https://github.com/acme/fast-llm-inference",
    meta: { description: "LLM inference toolkit", starsToday: 33, createdAt: TODAY },
  });
  const high = makeItem({
    source: "github-trending",
    sourceLabel: "GitHub Trending",
    category: "trending",
    id: "high",
    name: "acme/fast-llm-serving",
    url: "https://github.com/acme/fast-llm-serving",
    meta: { description: "LLM inference toolkit", starsToday: 40, createdAt: TODAY },
  });

  assert.equal(passesHardFilter(low, NOW), true);
  assert.equal(passesHardFilter(high, NOW), true);
  assert.equal(scoreCommunityItem(low, { now: NOW }).score, 44);
  assert.equal(scoreCommunityItem(high, { now: NOW }).score, 45);

  const ranked = scoreAndRank([low, high], { now: NOW });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].id, "high");
  assert.ok(ranked[0].score >= DISPLAY_COMMUNITY_SCORE_MIN);
});

test("分数在 0–100", () => {
  const samples = [
    makeItem(),
    makeItem({
      source: "google-trends",
      name: "ChatGPT",
      meta: { approxTraffic: "200K+", pubDate: TODAY },
    }),
    makeItem({
      source: "github-trending",
      name: "vllm-project/vllm",
      meta: { description: "fast LLM inference", starsToday: 5000, stars: 99_999 },
    }),
    makeItem({
      source: "appsumo",
      name: "Some AI writing widget",
      meta: { users: 0, reviews: 0, createdAt: TODAY },
    }),
    makeItem({
      name: "OpenAI releases GPT-5",
      meta: { points: 1e9, comments: 1e9, createdAt: TODAY },
    }),
  ];

  for (const item of samples) {
    const result = scoreCommunityItem(item, { now: NOW });
    assert.ok(result.score >= 0 && result.score <= 100, `score ${result.score}`);
    assert.equal(result.score, Math.round(result.score));
    for (const row of result.breakdown) {
      assert.ok(row.points >= 0, `${row.key} negative`);
    }
  }

  const ranked = scoreAndRank(samples, { now: NOW });
  for (const item of ranked) {
    assert.ok(item.score >= 0 && item.score <= 100);
  }
});

test("shanghaiDateKey 使用 Asia/Shanghai 日历日", () => {
  assert.equal(shanghaiDateKey(NOW), "2026-08-28");
  const lateUtc = Date.parse("2026-08-27T18:00:00Z");
  assert.equal(shanghaiDateKey(lateUtc), "2026-08-28");
});
