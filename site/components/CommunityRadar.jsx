"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import RefreshButton from "./RefreshButton.jsx";

const CATEGORY_LABEL = {
  community: "社区讨论",
  trending: "趋势信号",
};

const SOURCE_KIND = {
  hackernews: "community",
  reddit: "community",
  producthunt: "community",
  appsumo: "community",
  "github-trending": "trending",
  "google-trends": "trending",
  "chrome-web-store": "trending",
};

const HEAT_FIELDS = [
  { key: "points", label: "Points" },
  { key: "comments", label: "评论" },
  { key: "num_comments", label: "评论" },
  { key: "starsToday", label: "今日 Star" },
  { key: "stars", label: "Star" },
  { key: "approxTraffic", label: "搜索热度" },
  { key: "score", label: "赞" },
  { key: "likes", label: "赞" },
  { key: "downloads", label: "下载" },
];

const SOURCE_STATUS = {
  ok: { label: "正常", className: "ok" },
  skipped: { label: "已跳过", className: "skipped" },
  error: { label: "失败", className: "error" },
};

function isSpotlight(item) {
  return item.tier === "spotlight" || item.score >= 70;
}

function isWatch(item) {
  if (isSpotlight(item)) return false;
  return item.tier === "watch" || (item.score >= 45 && item.score < 70);
}

function categoryLabel(item) {
  const key = item.category || SOURCE_KIND[item.source] || "";
  return CATEGORY_LABEL[key] || "社区消息";
}

function formatShanghaiDateTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatHeatValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Intl.NumberFormat("zh-CN").format(value);
  }
  const text = String(value).trim();
  return text;
}

function heatMetrics(meta) {
  if (!meta || typeof meta !== "object") return [];
  const seen = new Set();
  const metrics = [];
  for (const field of HEAT_FIELDS) {
    const value = meta[field.key];
    if (value == null || value === "") continue;
    if (seen.has(field.label)) continue;
    seen.add(field.label);
    metrics.push({ label: field.label, value: formatHeatValue(value) });
  }
  return metrics;
}

function itemKey(item, index) {
  return item.slug || `${item.source}-${item.url || item.name}-${index}`;
}

function HeatRow({ meta }) {
  const metrics = heatMetrics(meta);
  const description = typeof meta?.description === "string" ? meta.description.trim() : "";
  const tagline = typeof meta?.tagline === "string" ? meta.tagline.trim() : "";
  const language = typeof meta?.language === "string" ? meta.language.trim() : "";
  const subreddit = typeof meta?.subreddit === "string" ? meta.subreddit.trim() : "";
  const extras = [language, subreddit ? `r/${subreddit.replace(/^r\//, "")}` : ""]
    .filter(Boolean);

  if (metrics.length === 0 && !description && !tagline && extras.length === 0) {
    return null;
  }

  return (
    <div className="community-heat">
      {metrics.length > 0 && (
        <ul className="community-heat-list">
          {metrics.map((metric) => (
            <li key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </li>
          ))}
        </ul>
      )}
      {(description || tagline) && (
        <p className="community-heat-note">{description || tagline}</p>
      )}
      {extras.length > 0 && (
        <p className="community-heat-extra">{extras.join(" · ")}</p>
      )}
    </div>
  );
}

function SignalCard({ item }) {
  const spotlight = isSpotlight(item);
  const title = item.url ? (
    <a href={item.url} target="_blank" rel="noreferrer noopener" className="community-card-title">
      {item.name}
    </a>
  ) : (
    <span className="community-card-title">{item.name}</span>
  );

  return (
    <article className={`community-card${spotlight ? " community-card--spotlight" : ""}`}>
      <div className="community-card-main">
        <div className="community-card-meta">
          <span className="community-origin">{item.sourceLabel}</span>
          <span className="community-category">{categoryLabel(item)}</span>
        </div>
        <h3>{title}</h3>
        <HeatRow meta={item.meta} />
        {Array.isArray(item.breakdown) && item.breakdown.length > 0 && (
          <ul className="community-breakdown">
            {item.breakdown.map((row, index) => (
              <li key={`${item.slug}-b-${index}`}>
                <span>+{row.points}</span>
                {row.label}
              </li>
            ))}
          </ul>
        )}
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            className="community-card-link"
          >
            打开原始链接 ↗
          </a>
        )}
      </div>
      <div className="community-card-score">
        <span>当日评分</span>
        <strong>{item.score}</strong>
        <small>{spotlight ? "今日重点" : "值得关注"}</small>
      </div>
    </article>
  );
}

function EmptyState({ title, detail }) {
  return (
    <div className="community-empty">
      <span className="community-empty-mark" aria-hidden="true">·</span>
      <div>
        <h3>{title}</h3>
        <p>{detail}</p>
      </div>
    </div>
  );
}

function sourceKeyOf(source) {
  return source?.key || source?.label || "";
}

function sortByScore(list) {
  return [...list].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

export default function CommunityRadar({ data }) {
  const payload = data ?? { generatedAt: "", shanghaiDate: "", sources: [], items: [] };
  const sources = Array.isArray(payload.sources) ? payload.sources : [];
  const items = Array.isArray(payload.items) ? payload.items : [];
  const [selectedSource, setSelectedSource] = useState(null);

  const allSpotlight = useMemo(
    () => sortByScore(items.filter(isSpotlight)),
    [items],
  );
  const allWatch = useMemo(
    () => sortByScore(items.filter(isWatch)),
    [items],
  );

  const visibleItems = selectedSource
    ? items.filter((item) => item.source === selectedSource)
    : items;
  const spotlight = sortByScore(visibleItems.filter(isSpotlight));
  const watch = sortByScore(visibleItems.filter(isWatch));
  const qualified = spotlight.length + watch.length;
  const updatedAt = formatShanghaiDateTime(payload.generatedAt);
  const skippedOrError = sources.filter((source) => source.status !== "ok");
  const selectedLabel =
    sources.find((source) => sourceKeyOf(source) === selectedSource)?.label ||
    selectedSource;

  function toggleSource(key) {
    if (!key) return;
    setSelectedSource((current) => (current === key ? null : key));
  }

  return (
    <main className="community-dashboard">
      <header className="community-hero">
        <div className="kicker">Community · 社区热点</div>
        <h1>
          {payload.shanghaiDate
            ? `北京时间 ${payload.shanghaiDate} 的社区讨论与趋势`
            : "当天的社区讨论与趋势"}
        </h1>
        <p>
          只展示当天、评分达标的帖子和项目。这里不是模型候选库，也没有厂商确认含义。
        </p>
        <p className="community-hero-nav">
          <Link href="/">← 返回模型雷达</Link>
        </p>
        <RefreshButton />
      </header>

      <section className="community-summary" aria-label="当日热点概览">
        <div className="summary-card">
          <span>北京时间</span>
          <strong className="summary-date">{payload.shanghaiDate || "—"}</strong>
          <small>仅收录当天信号</small>
        </div>
        <div className="summary-card summary-card--accent">
          <span>今日重点</span>
          <strong>{allSpotlight.length}</strong>
          <small>spotlight / 评分 ≥ 70</small>
        </div>
        <div className="summary-card">
          <span>值得关注</span>
          <strong>{allWatch.length}</strong>
          <small>watch / 评分 45–69</small>
        </div>
        <div className={`summary-card${skippedOrError.length ? " summary-card--warn" : ""}`}>
          <span>来源异常</span>
          <strong>{skippedOrError.length}</strong>
          <small>跳过或失败的渠道</small>
        </div>
        <div className="summary-card">
          <span>最后更新</span>
          <strong className="summary-date">{updatedAt || "尚未更新"}</strong>
          <small>generatedAt · 北京时间</small>
        </div>
      </section>

      <section className="community-sources" aria-labelledby="community-sources-title">
        <div className="section-heading">
          <div>
            <span className="section-eyebrow">采集状态</span>
            <h2 id="community-sources-title">来源运行状态</h2>
          </div>
          <span className="section-count">{sources.length} 个渠道</span>
        </div>
        {sources.length > 0 ? (
          <>
            <ul className="community-source-list" role="list">
              <li>
                <button
                  type="button"
                  className={`community-source-chip${selectedSource == null ? " community-source-chip--active" : ""}`}
                  aria-pressed={selectedSource == null}
                  onClick={() => setSelectedSource(null)}
                >
                  <span className="community-source-dot" aria-hidden="true" />
                  <strong>全部</strong>
                  <span>取消筛选</span>
                </button>
              </li>
              {sources.map((source) => {
                const status = SOURCE_STATUS[source.status] ?? SOURCE_STATUS.ok;
                const key = sourceKeyOf(source);
                const active = selectedSource === key;
                return (
                  <li key={key}>
                    <button
                      type="button"
                      className={`community-source-chip community-source-chip--${status.className}${active ? " community-source-chip--active" : ""}`}
                      aria-pressed={active}
                      aria-label={`筛选 ${source.label || key}`}
                      onClick={() => toggleSource(key)}
                    >
                      <span className="community-source-dot" aria-hidden="true" />
                      <strong>{source.label}</strong>
                      <span>{status.label}</span>
                      <span>{source.count} 条</span>
                      {source.note ? <em>{source.note}</em> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="community-filter-status" aria-live="polite">
              {selectedSource
                ? `正在筛选 ${selectedLabel}。再点一次该来源或点「全部」可恢复。`
                : "点某个来源，下面列表只显示该渠道的热点。"}
            </p>
          </>
        ) : (
          <p className="community-sources-empty">暂无来源运行记录。</p>
        )}
      </section>

      {!selectedSource && allSpotlight.length + allWatch.length === 0 ? (
        <EmptyState
          title="今天暂无达到门槛的社区热点"
          detail="评分达标的社区讨论与趋势项目会显示在这里。模型候选请回模型雷达查看。"
        />
      ) : selectedSource && qualified === 0 ? (
        <EmptyState
          title="这个来源今天没有达到门槛的热点"
          detail={`${selectedLabel} 今天没有进入「今日重点」或「值得关注」的条目。可点「全部」查看其他来源。`}
        />
      ) : (
        <>
          <section className="community-section" aria-labelledby="community-spotlight-title">
            <div className="section-heading">
              <div>
                <span className="section-eyebrow">当天最热</span>
                <h2 id="community-spotlight-title">今日重点</h2>
              </div>
              <span className="section-count">{spotlight.length} 条</span>
            </div>
            {spotlight.length > 0 ? (
              <ul className="community-card-list">
                {spotlight.map((item, index) => (
                  <li key={itemKey(item, index)}>
                    <SignalCard item={item} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="community-section-empty">
                {selectedSource
                  ? "这个来源今天没有达到重点门槛的热点。"
                  : "今天还没有达到重点门槛的社区热点。"}
              </p>
            )}
          </section>

          <section className="community-section" aria-labelledby="community-watch-title">
            <div className="section-heading">
              <div>
                <span className="section-eyebrow">继续跟进</span>
                <h2 id="community-watch-title">值得关注</h2>
              </div>
              <span className="section-count">{watch.length} 条</span>
            </div>
            {watch.length > 0 ? (
              <ul className="community-card-list">
                {watch.map((item, index) => (
                  <li key={itemKey(item, index)}>
                    <SignalCard item={item} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="community-section-empty">
                {selectedSource
                  ? "这个来源今天没有 45–69 分段的热点。"
                  : "今天没有 45–69 分段的社区热点。"}
              </p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
