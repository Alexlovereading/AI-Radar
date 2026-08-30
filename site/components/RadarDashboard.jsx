"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import RefreshButton from "./RefreshButton.jsx";

const STATUS = {
  confirmed: { label: "官方来源已收录", className: "confirmed" },
  "public-preview": { label: "模型平台已收录", className: "public-preview" },
  rumored: { label: "传闻", className: "rumored" },
  unknown: { label: "待核实", className: "unknown" },
};

const CHANNELS = {
  "Hugging Face": {
    kind: "模型平台",
    description: "开源模型与项目的托管平台。这里出现的是新增模型仓库，用来尽早发现名字；不代表厂商官方发布，也不代表它已经热门。",
    short: "模型平台的新仓库，仅代表被平台收录。",
  },
  "Hacker News": {
    kind: "开发者社区",
    description: "开发者分享和讨论技术产品的社区。这里出现的是社区链接或讨论，用来发现行业话题；不代表内容已经核实。",
    short: "开发者社区出现了相关链接或讨论。",
  },
  "Google Trends": {
    kind: "搜索趋势",
    description: "美国区大众搜索趋势，用来观察人们正在搜索什么。它可能与 AI 无关，因此这里只作为噪音较高的线索。",
    short: "大众搜索趋势线索，可能与 AI 无关。",
  },
};

function getChannelInfo(label) {
  return CHANNELS[label] ?? {
    kind: "监测渠道",
    description: "雷达从这个公开渠道发现了相关名称。请进入详情查看原始链接和更多证据。",
    short: "公开监测渠道发现的一条线索。",
  };
}

function getAttention(score) {
  if (score >= 70) return { key: "full-site", label: "立即建专题", cue: "高优先级：可进入完整专题准备。" };
  if (score >= 50) return { key: "launch-today", label: "今日上线", cue: "强信号：建议今天准备落地页。" };
  if (score >= 30) return { key: "reserve", label: "建单页观察", cue: "已达到行动门槛，可先建单页并等待更多来源。" };
  return { key: "log-only", label: "观察线索", cue: "有初步信号，继续等待官方或多来源确认。" };
}

function StatusPill({ status }) {
  const item = STATUS[status] ?? STATUS.unknown;
  return (
    <span className={`status-pill status-pill--${item.className}`}>
      {item.label}
    </span>
  );
}

function EntityCard({ entity, featured = false }) {
  const attention = getAttention(entity.score);
  const sourceCount = entity.sources?.length ?? 0;
  const channels = Array.from(
    new Map((entity.sources ?? []).map((source) => [source.label, source])).values(),
  );

  return (
    <li>
      <article
        className={`radar-entity-card${featured ? " radar-entity-card--featured" : ""}`}
      >
        <div className="radar-entity-content">
          <div className="radar-entity-heading">
            <Link href={`/models/${entity.slug}`} className="radar-entity-name">
              {entity.name}
            </Link>
            <StatusPill status={entity.status} />
            <span className={`attention-tag attention-tag--${attention.key}`}>
              {attention.label}
            </span>
          </div>
          <div className="radar-source-block">
            <span className="radar-source-label">发现渠道</span>
            <div className="radar-source-links">
              {channels.map((channel) => (
                <a
                  key={`${entity.slug}-${channel.label}`}
                  href={channel.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="source-chip"
                >
                  {channel.label} · {getChannelInfo(channel.label).kind} ↗
                </a>
              ))}
            </div>
            <p>
              {channels.map((channel) => getChannelInfo(channel.label).short).join("；") ||
                "暂时没有记录到具体渠道。"}
            </p>
          </div>
          <div className="radar-entity-facts">
            <span>{sourceCount} 条来源记录</span>
            <span>数据生成于 {entity.lastVerified}</span>
            {entity.isRumor && <span className="rumor-note">未经官方确认</span>}
          </div>
          <p className="radar-entity-cue">{attention.cue}</p>
        </div>
        <div className="radar-entity-score">
          <span>雷达评分</span>
          <strong>{entity.score}</strong>
          <Link href={`/models/${entity.slug}`} className="radar-entity-action">
            查看详情与证据 →
          </Link>
        </div>
      </article>
    </li>
  );
}

export default function RadarDashboard({ entities }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [attention, setAttention] = useState("all");
  const [source, setSource] = useState("all");

  const summary = useMemo(() => {
    const latestVerified = entities.reduce(
      (latest, entity) => entity.lastVerified > latest ? entity.lastVerified : latest,
      "",
    );

    return {
      total: entities.length,
      listed: entities.filter((entity) => entity.status === "public-preview").length,
      confirmed: entities.filter((entity) => entity.status === "confirmed").length,
      priority: entities.filter((entity) => entity.score >= 30).length,
      unverified: entities.filter((entity) => entity.isRumor).length,
      latestVerified: latestVerified || "—",
    };
  }, [entities]);

  const sortedEntities = useMemo(
    () => [...entities].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "en")),
    [entities],
  );

  const priorityEntities = sortedEntities.filter((entity) => entity.score >= 30);

  const channelSummary = useMemo(() => {
    const counts = new Map();
    for (const entity of entities) {
      for (const label of new Set((entity.sources ?? []).map((item) => item.label))) {
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([label, count]) => ({ label, count, ...getChannelInfo(label) }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "en"));
  }, [entities]);

  const filteredEntities = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return sortedEntities.filter((entity) => {
      const matchesQuery = !normalizedQuery || entity.name.toLocaleLowerCase().includes(normalizedQuery);
      const matchesStatus =
        status === "all" ||
        (status === "unconfirmed" ? entity.isRumor : entity.status === status);
      const tier = getAttention(entity.score).key;
      const matchesAttention = attention === "all" || tier === attention;
      const matchesSource =
        source === "all" || (entity.sources ?? []).some((item) => item.label === source);
      return matchesQuery && matchesStatus && matchesAttention && matchesSource;
    });
  }, [attention, query, sortedEntities, source, status]);

  const resetFilters = () => {
    setQuery("");
    setStatus("all");
    setAttention("all");
    setSource("all");
  };

  return (
    <main className="radar-dashboard">
      <header className="radar-hero">
        <div className="kicker">AI Word Radar · AI 新词雷达</div>
        <h1>在 AI 新名字走红前，先判断它值不值得关注</h1>
        <p>
          系统持续扫描模型平台、官方渠道和社区讨论，把新出现的 AI 名称汇总、标注来源并打分。
          你只需要先看关注级别，再决定要不要投入时间制作专题页面。
        </p>
        <p className="radar-community-entry">
          <Link href="/community">查看今日社区热点 →</Link>
        </p>
        <RefreshButton />
      </header>

      <section className="radar-summary" aria-label="雷达数据概览">
        <div className="summary-card"><span>候选记录</span><strong>{summary.total}</strong><small>当前数据库总量</small></div>
        <div className="summary-card"><span>模型平台已收录</span><strong>{summary.listed}</strong><small>不等于厂商确认</small></div>
        <div className="summary-card"><span>官方来源</span><strong>{summary.confirmed}</strong><small>厂商渠道已有记录</small></div>
        <div className="summary-card summary-card--accent"><span>重点关注</span><strong>{summary.priority}</strong><small>雷达评分 ≥ 30</small></div>
        <div className="summary-card summary-card--warn"><span>待进一步核验</span><strong>{summary.unverified}</strong><small>证据尚未闭环</small></div>
        <div className="summary-card"><span>数据生成于</span><strong className="summary-date">{summary.latestVerified}</strong><small>并非逐条发布日期</small></div>
      </section>

      <section className="priority-section" aria-labelledby="priority-title">
        <div className="section-heading">
          <div>
            <span className="section-eyebrow">先看这里</span>
            <h2 id="priority-title">行动候选 / 重点关注</h2>
          </div>
          <span className="section-count">{priorityEntities.length} 条</span>
        </div>
        {priorityEntities.length > 0 ? (
          <ul className="radar-entity-list">
            {priorityEntities.slice(0, 6).map((entity) => (
              <EntityCard key={entity.slug} entity={entity} featured />
            ))}
          </ul>
        ) : (
          <div className="priority-empty">
            <span className="priority-empty-mark" aria-hidden="true">✓</span>
            <div>
              <h3>当前没有达到关注门槛的项目</h3>
              <p>现有记录都低于 30 分，适合继续观察，不建议现在投入专题制作资源。</p>
            </div>
          </div>
        )}
      </section>

      <section className="records-section" aria-labelledby="records-title">
        <div className="section-heading records-heading">
          <div>
            <span className="section-eyebrow">完整档案</span>
            <h2 id="records-title">全部候选记录</h2>
          </div>
          <span className="section-count" aria-live="polite">显示 {filteredEntities.length} / {entities.length} 条</span>
        </div>

        <div className="channel-guide" aria-labelledby="channel-guide-title">
          <div className="channel-guide-intro">
            <span className="section-eyebrow">来源备注</span>
            <h3 id="channel-guide-title">这些数据分别从哪里来？</h3>
            <p>渠道只说明雷达在哪里发现了这条线索，不代表模型质量，也不等于厂商已经确认。</p>
          </div>
          <div className="channel-guide-grid">
            {channelSummary.map((channel) => (
              <div key={channel.label} className="channel-guide-card">
                <div>
                  <strong>{channel.label}</strong>
                  <span>{channel.kind} · 当前 {channel.count} 条</span>
                </div>
                <p>{channel.description}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="radar-controls" role="search" aria-label="筛选候选记录">
          <div className="search-field">
            <label htmlFor="model-search">搜索模型名称</label>
            <input
              id="model-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="例如 Qwen、DeepSeek…"
            />
          </div>
          <div className="filter-field">
            <label htmlFor="status-filter">验证状态</label>
            <select id="status-filter" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">全部状态</option>
              <option value="confirmed">官方来源已收录</option>
              <option value="public-preview">模型平台已收录</option>
              <option value="unconfirmed">未经官方确认</option>
              <option value="unknown">待核实</option>
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="attention-filter">关注级别</label>
            <select id="attention-filter" value={attention} onChange={(event) => setAttention(event.target.value)}>
              <option value="all">全部级别</option>
              <option value="full-site">立即建专题 · 70+</option>
              <option value="launch-today">今日上线 · 50–69</option>
              <option value="reserve">建单页观察 · 30–49</option>
              <option value="log-only">观察线索 · 20–29</option>
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="source-filter">发现渠道</label>
            <select id="source-filter" value={source} onChange={(event) => setSource(event.target.value)}>
              <option value="all">全部渠道</option>
              {channelSummary.map((channel) => (
                <option key={channel.label} value={channel.label}>
                  {channel.label} · {channel.count} 条
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="reset-button" onClick={resetFilters}>重置</button>
        </div>

        {filteredEntities.length > 0 ? (
          <ul className="radar-entity-list radar-entity-list--all">
            {filteredEntities.map((entity) => <EntityCard key={entity.slug} entity={entity} />)}
          </ul>
        ) : (
          <div className="records-empty">
            <h3>没有找到符合条件的记录</h3>
            <p>换一个关键词或重置筛选条件再试。</p>
            <button type="button" onClick={resetFilters}>清除筛选</button>
          </div>
        )}
      </section>

      <section className="score-guide" aria-labelledby="score-guide-title">
        <div className="section-heading">
          <div>
            <span className="section-eyebrow">决策规则</span>
            <h2 id="score-guide-title">怎么看雷达评分？</h2>
          </div>
        </div>
        <div className="score-guide-grid">
          <div><strong>70 分以上 · 立即建专题</strong><p>达到完整站点级别，可优先投入内容与页面资源。</p></div>
          <div><strong>50–69 分 · 今日上线</strong><p>信号较强，建议当天准备或发布落地页。</p></div>
          <div><strong>30–49 分 · 建单页观察</strong><p>进入储备名单，可先建单页并等待更多来源交叉验证。</p></div>
          <div><strong>20–29 分 · 观察线索</strong><p>有初步价值，继续等待官方或多来源确认；低于 20 分不会显示。</p></div>
        </div>
        <p className="score-guide-note">评分代表监测信号强度，不代表模型质量，也不等于官方确认。</p>
      </section>
    </main>
  );
}
