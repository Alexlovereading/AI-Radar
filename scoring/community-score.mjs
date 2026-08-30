// Independent 0–100 scorer for community / trending items.
// Does not feed the model-radar homepage. Weights (from the community-radar plan):
//   主题与事件重要性 40 · 当天热度 30 · 来源可信度 10 · 时效性 10 · 跨来源印证 10
// Heat is normalized per source so HN points are never compared raw to GitHub stars.

import {
  communityItemText,
  isAiRelatedCommunity,
  looksLikeHotProject,
  looksLikeImportantRelease,
  looksLikeNewModel,
  looksLikeTrendSpike,
  normalizeCommunityKey,
  passesHardFilter,
  resolveItemTime,
  shanghaiDateKey,
  toNumber,
} from "../lib/community-filter.mjs";

export { shanghaiDateKey };

export const DISPLAY_COMMUNITY_SCORE_MIN = 45;
export const MAX_PER_SOURCE = 5;
export const MAX_TOTAL = 20;

const SOURCE_CREDIBILITY = {
  hackernews: { points: 10, label: "Hacker News" },
  "github-trending": { points: 9, label: "GitHub Trending" },
  "google-trends": { points: 8, label: "Google Trends" },
  producthunt: { points: 7, label: "Product Hunt" },
  reddit: { points: 6, label: "Reddit" },
  "chrome-web-store": { points: 5, label: "Chrome Web Store" },
  appsumo: { points: 4, label: "AppSumo" },
};

export function scoreCommunityItem(item, { peers = [], now = Date.now() } = {}) {
  const group = uniqueGroup(item, peers);
  const text = group.map(communityItemText).join(" ");
  const sources = [...new Set(group.map((it) => it.source).filter(Boolean))];

  const importance = importanceScore(item, text);
  const heat = bestHeat(group);
  const source = bestSource(sources);
  const recency = recencyScore(group, now);
  const corroboration = corroborationScore(sources);

  const breakdown = [
    {
      key: "importance",
      label: "主题与事件重要性",
      points: importance.points,
      max: 40,
      note: importance.note,
    },
    {
      key: "heat",
      label: "当天热度",
      points: heat.points,
      max: 30,
      note: heat.note,
    },
    {
      key: "source",
      label: "来源可信度",
      points: source.points,
      max: 10,
      note: source.note,
    },
    {
      key: "recency",
      label: "时效性",
      points: recency.points,
      max: 10,
      note: recency.note,
    },
    {
      key: "corroboration",
      label: "跨来源印证",
      points: corroboration.points,
      max: 10,
      note: corroboration.note,
    },
  ];

  const rawTotal = breakdown.reduce((sum, row) => sum + row.points, 0);
  const score = clamp(Math.round(rawTotal), 0, 100);
  const tier = tierOf(score);

  return {
    score,
    tier,
    tierLabel: tier === "spotlight" ? "今日重点" : tier === "watch" ? "值得关注" : "不展示",
    breakdown,
    engagement: heat.engagement,
  };
}

export function scoreAndRank(items, { now = Date.now() } = {}) {
  const eligible = (Array.isArray(items) ? items : []).filter((it) =>
    passesHardFilter(it, now)
  );

  const groups = groupByKey(eligible);
  const scored = [];
  for (const [key, group] of groups) {
    const representative = pickRepresentative(group);
    const result = scoreCommunityItem(representative, { peers: group, now });
    scored.push({
      ...representative,
      key,
      score: result.score,
      tier: result.tier,
      tierLabel: result.tierLabel,
      breakdown: result.breakdown,
      engagement: result.engagement,
      sources: [...new Set(group.map((it) => it.source))],
    });
  }

  const displayed = scored
    .filter((it) => it.score >= DISPLAY_COMMUNITY_SCORE_MIN)
    .sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)));

  const perSource = new Map();
  const out = [];
  for (const item of displayed) {
    const n = perSource.get(item.source) ?? 0;
    if (n >= MAX_PER_SOURCE) continue;
    perSource.set(item.source, n + 1);
    out.push(item);
    if (out.length >= MAX_TOTAL) break;
  }
  return out;
}

function groupByKey(items) {
  const groups = new Map();
  for (const item of items) {
    const key = normalizeCommunityKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function pickRepresentative(group) {
  return [...group].sort((a, b) => {
    const heatDiff = heatScore(b).points - heatScore(a).points;
    if (heatDiff !== 0) return heatDiff;
    const cred =
      (SOURCE_CREDIBILITY[b.source]?.points ?? 0) -
      (SOURCE_CREDIBILITY[a.source]?.points ?? 0);
    return cred;
  })[0];
}

function uniqueGroup(item, peers) {
  const out = [];
  const seen = new Set();
  for (const candidate of [item, ...peers]) {
    if (!candidate) continue;
    const id = `${candidate.source ?? ""}::${candidate.id ?? ""}::${candidate.url ?? ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(candidate);
  }
  return out;
}

function importanceScore(item, text) {
  if (looksLikeNewModel(text)) {
    return { points: 40, note: "新模型或版本发布" };
  }
  if (looksLikeImportantRelease(item, text)) {
    return { points: 26, note: "重要发布或开源" };
  }
  if (looksLikeHotProject(item)) {
    return { points: 20, note: "高热项目" };
  }
  if (looksLikeTrendSpike(item)) {
    return { points: 16, note: "趋势突增" };
  }
  if (isAiRelatedCommunity(text)) {
    return { points: 8, note: "AI 相关讨论" };
  }
  return { points: 0, note: "主题信号不足" };
}

function bestHeat(group) {
  let best = heatScore(group[0]);
  for (const item of group.slice(1)) {
    const next = heatScore(item);
    if (next.points > best.points) best = next;
  }
  return best;
}

function heatScore(item) {
  const meta = item?.meta ?? {};
  const engagement = collectEngagement(item);
  let points = 0;
  let note = "无当天热度数据";

  switch (item?.source) {
    case "hackernews": {
      const p = ratio(toNumber(meta.points), 150, 21);
      const c = ratio(toNumber(meta.comments), 80, 9);
      points = Math.min(30, p + c);
      note = `HN ${toNumber(meta.points)} points · ${toNumber(meta.comments)} comments`;
      break;
    }
    case "github-trending": {
      const today = toNumber(meta.starsToday);
      if (today > 0) {
        points = ratio(today, 200, 30);
        note = `GitHub 今日 ${today} stars`;
      } else {
        const stars = toNumber(meta.stars);
        points = ratio(stars, 5000, 30);
        note = stars > 0 ? `GitHub 累计 ${stars} stars` : "无 GitHub 热度数据";
      }
      break;
    }
    case "reddit": {
      const p = ratio(toNumber(meta.score), 200, 21);
      const c = ratio(toNumber(meta.num_comments), 80, 9);
      points = Math.min(30, p + c);
      note = `Reddit ${toNumber(meta.score)} score · ${toNumber(meta.num_comments)} comments`;
      break;
    }
    case "producthunt": {
      const p = ratio(toNumber(meta.votes), 200, 21);
      const c = ratio(toNumber(meta.comments), 50, 9);
      points = Math.min(30, p + c);
      note = `Product Hunt ${toNumber(meta.votes)} votes · ${toNumber(meta.comments)} comments`;
      break;
    }
    case "google-trends": {
      const traffic = toNumber(meta.approxTraffic);
      points = ratio(traffic, 200_000, 30);
      note =
        traffic > 0
          ? `Google Trends 约 ${formatTraffic(meta.approxTraffic)} 搜索`
          : "无 Trends 流量数据";
      break;
    }
    case "chrome-web-store": {
      const u = ratio(toNumber(meta.users), 50_000, 21);
      const r = ratio(toNumber(meta.reviews), 200, 9);
      points = Math.min(30, u + r);
      note = `Chrome 商店 ${toNumber(meta.users)} users · ${toNumber(meta.reviews)} reviews`;
      break;
    }
    case "appsumo": {
      const u = ratio(toNumber(meta.users), 5000, 21);
      const r = ratio(toNumber(meta.reviews), 100, 9);
      points = Math.min(30, u + r);
      note = `AppSumo ${toNumber(meta.users)} users · ${toNumber(meta.reviews)} reviews`;
      break;
    }
    default: {
      points = 0;
      note = "未知来源，热度按 0";
    }
  }

  return { points, note, engagement: { ...engagement, normalized: points } };
}

function collectEngagement(item) {
  const meta = item?.meta ?? {};
  switch (item?.source) {
    case "hackernews":
      return { points: toNumber(meta.points), comments: toNumber(meta.comments) };
    case "github-trending":
      return { starsToday: toNumber(meta.starsToday), stars: toNumber(meta.stars) };
    case "reddit":
      return { score: toNumber(meta.score), num_comments: toNumber(meta.num_comments) };
    case "producthunt":
      return { votes: toNumber(meta.votes), comments: toNumber(meta.comments) };
    case "google-trends":
      return { approxTraffic: toNumber(meta.approxTraffic) };
    case "chrome-web-store":
    case "appsumo":
      return { users: toNumber(meta.users), reviews: toNumber(meta.reviews) };
    default:
      return {};
  }
}

function bestSource(sources) {
  let best = { points: 0, note: "来源未知" };
  for (const source of sources) {
    const row = SOURCE_CREDIBILITY[source];
    if (row && row.points >= best.points) {
      best = { points: row.points, note: row.label };
    }
  }
  return best;
}

function recencyScore(group, now) {
  let newest = null;
  for (const item of group) {
    const ts = resolveItemTime(item);
    if (ts == null) continue;
    if (newest == null || ts > newest) newest = ts;
  }
  if (newest == null) return { points: 4, note: "当天（时间未知）" };
  const hours = (now - newest) / 3_600_000;
  if (hours < 0 || hours <= 3) return { points: 10, note: "3 小时内" };
  if (hours <= 8) return { points: 8, note: "8 小时内" };
  if (hours <= 14) return { points: 6, note: "14 小时内" };
  if (shanghaiDateKey(newest) === shanghaiDateKey(now)) {
    return { points: 4, note: "当天较早" };
  }
  return { points: 0, note: "已过当天" };
}

function corroborationScore(sources) {
  if (sources.length >= 3) return { points: 10, note: `${sources.length} 个来源同时出现` };
  if (sources.length === 2) return { points: 7, note: "2 个来源同时出现" };
  return { points: 0, note: "单源" };
}

function tierOf(score) {
  if (score >= 70) return "spotlight";
  if (score >= DISPLAY_COMMUNITY_SCORE_MIN) return "watch";
  return "hidden";
}

function ratio(value, cap, maxPoints) {
  if (!Number.isFinite(value) || value <= 0 || !cap) return 0;
  return Math.min(maxPoints, Math.round((value / cap) * maxPoints));
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function formatTraffic(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  const n = toNumber(value);
  if (n >= 1e6) return `${Math.round(n / 1e5) / 10}M+`;
  if (n >= 1e3) return `${Math.round(n / 100) / 10}K+`;
  return String(n);
}
