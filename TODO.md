# AI Radar 交接待办

拷到另一台电脑后先看这份。不要 git commit，除非明确要求。

---

## 本次清理删了什么

| 路径 | 原因 |
|---|---|
| `site/.next/` | Next.js 构建缓存，另一台电脑重新 `npm run dev` 会再生成 |
| 根目录 `node_modules/` | 依赖目录，需重新 `npm install` |
| `site/node_modules/` | 同上 |
| `.superdesign/` | Superdesign 设计草稿（`design-system.md`、`init/`、`resume.json`），站点代码不 import |
| `.DS_Store` | macOS 垃圾文件 |

未发现「完全没人 import 的死脚本」可删：`scrapers/`、`scoring/`、`lib/`、`scripts/`、`notify/`、`tests/` 都仍被流水线或测试用到。`scoring/keywords.mjs` 没有被 `radar` 调用，但 README / GUIDE 把它当正式功能写了，所以保留。

`package.json`、`package-lock.json`、`site/package.json`、`site/package-lock.json`、`.git/`、`data/` 业务数据、GUIDE / README / CONTRACT 都没动。

`.gitignore` 补了一行 `.DS_Store`。

---

## 已完成（当前代码状态）

- 首页 `/` 只展示模型平台 + 官方渠道（`radar:models` → `site/data/entities.json`）。
- 社区独立页 `/community`：当天评分、来源筛选芯片。
- 流水线拆分：
  - `npm run radar:models` → `scripts/run-all.mjs`
  - `npm run radar:community` → `scripts/run-community.mjs`
  - `npm run radar` → 两者串行

---

## 另一台电脑：立刻要做的

1. 安装 **Node 20**（与 `.github/workflows/radar.yml` 一致）。用 `nvm` 的话：`nvm install 20 && nvm use 20`。
2. **两个目录都要装依赖**（不要漏 `site/`）：

```bash
# 仓库根目录：爬虫 / 评分 / cheerio / rss-parser / playwright（optional）
npm install

# 站点
cd site
npm install
```

3. Playwright 在根目录 `package.json` 的 `optionalDependencies` 里。`npm install` 只装 Node 包，**还要装浏览器**：

```bash
# 在仓库根目录
npx playwright install chromium
```

Chrome Web Store、AppSumo 都靠 Playwright。没装浏览器时这两个 scraper 会 warn 后返回 `[]`，流水线仍记成 `status: "ok"`。

4. 预览站点（不要先 `next build`）：

```bash
cd site
npm run dev
```

浏览器打开 http://localhost:3000 （模型雷达）和 http://localhost:3000/community （社区）。

5. 本地跑一遍流水线（可选，要联网）：

```bash
# 仓库根目录
npm run radar:models      # 模型 + 官方
npm run radar:community   # 社区
# 或一次全跑：
npm run radar
```

6. 跑测试：

```bash
node --test tests/community-score.test.mjs tests/build-community-data.test.mjs
```

---

## 环境变量与 GitHub Actions secrets

本地可建根目录 `.env`（已被 gitignore）。GitHub：仓库 Settings → Secrets and variables → Actions。

工作流 `.github/workflows/radar.yml` **实际注入**的 secrets：

| Secret | 用途 | 缺了会怎样 |
|---|---|---|
| `FEISHU_WEBHOOK_URL` | 模型实体评分 ≥ 30 时飞书通知 | 评分照跑，不发通知 |
| `REPLICATE_API_TOKEN` | Replicate 模型目录 | 该源 skip，返回 `[]` |
| `TOGETHER_API_KEY` | Together AI | 同上 |
| `FIREWORKS_API_KEY` | Fireworks（两个都要） | 同上 |
| `FIREWORKS_ACCOUNT_ID` | Fireworks | 同上 |
| `ARTIFICIAL_ANALYSIS_API_KEY` | Artificial Analysis | 同上 |
| `PRODUCTHUNT_TOKEN` | Product Hunt GraphQL | 社区该源 skip，返回 `[]` |

`GITHUB_TOKEN` 由 Actions 自动提供，不用手配。

CI 目前只在**根目录** `npm ci`，没有 `npx playwright install`，也没有装 `site/` 的依赖。所以 GitHub 上 Chrome Web Store / AppSumo 会一直空，直到工作流补上浏览器安装。

---

## 待办（按优先级）

### 1. Product Hunt：配 `PRODUCTHUNT_TOKEN`

申请：https://www.producthunt.com/v2/oauth/applications  
本地 export 或写进 `.env` 后跑 `npm run radar:community`。没 token 时 scraper 会 warn 并返回空数组。

### 2. Reddit：403

`scrapers/community/reddit.mjs` 用公开 JSON + User-Agent `ai-word-radar/0.1 (monitoring bot)`。机房 IP / 默认 UA 经常 403，子版失败后跳过，最终仍返回 `[]` 且 `status: "ok"`。

可行方向（选一个落地）：

- 换成 Reddit 能接受的浏览器 UA，或走代理再请求。
- 用官方 API（OAuth client id/secret），不要依赖匿名 JSON。

### 3. 来源状态：skip 时页面不要显示「正常」

`CommunityRadar` 已经有文案：`ok` → 正常，`skipped` → 已跳过，`error` → 失败。

真正的问题在采集层：缺 token、缺 Playwright、Reddit 403、主动 skip 时，scraper **catch 后 `return []`**，`scripts/run-community.mjs` 一律记 `status: "ok"`。页面就会把「没跑成」显示成「正常 · 0 条」。

改法建议：scraper 用抛错或约定返回值区分 skip/error；`run-community.mjs` 把 `skipped` / `error` 写进 `site/data/community-signals.json` 的 `sources[].status` 和 `note`。未知 status 不要 fallback 成「正常」（现在是 `SOURCE_STATUS[source.status] ?? SOURCE_STATUS.ok`）。

### 4. Hacker News / Google Trends 当天 0 条 ≠ 没接上

这两个源是接好的。当天 `data/community/latest/hackernews.json`、`google-trends.json` 经常是 `[]`，因为：

- 只收**北京时间当天**的条目。
- 必须过 AI 主题过滤（`isAiRelatedCommunity`）。
- HN 还有热度门槛（约 20 points / 10 comments）。
- Google Trends RSS 是美国综合热搜，体育/明星居多，标题里带 AI 的很少。

排查时先看 scraper 的 console.warn，再看 `latest/*.json` 是空数组还是根本没写出文件。

### 5. 不要在开发服跑着时 `next build`

`cd site && npm run dev` 期间不要执行 `npm run build` / `next build`。会把正在用的 `site/.next` 弄坏，dev 热更新失败或页面空白。要构建就先停掉 dev。

---

## 日常命令速查

| 命令 | 在哪跑 | 做什么 |
|---|---|---|
| `npm install` | **仓库根目录** | 爬虫依赖 |
| `npm install` | **`site/`** | Next.js 站点依赖 |
| `npx playwright install chromium` | 仓库根目录 | 浏览器二进制 |
| `npm run radar:models` | 根目录 | 模型平台 + 官方渠道 |
| `npm run radar:community` | 根目录 | 社区 7 源 |
| `npm run radar` | 根目录 | 上面两个都跑 |
| `npm run dev` | `site/` | 本地预览 |
| `node --test tests/*.test.mjs` | 根目录 | 社区评分 + build-community-data |

站点读的是 `site/data/entities.json` 和 `site/data/community-signals.json`，不直接读 `data/`。改完爬虫要再跑对应 `radar:*` 才会反映到页面。

---

## 可选、非阻塞

- `data/snapshots/` 里还留着社区迁走之前的旧文件：`appsumo.json`、`github-trending.json`、`google-trends.json`、`hackernews.json`。当前 `radar:models` 不再写它们；社区快照在 `data/community/latest/`。确认无历史对照需求后再删。
- `scoring/keywords.mjs`：给实体生成 SEO 关键词矩阵，未接入 npm script。要用就 `node -e "import('./scoring/keywords.mjs').then(m => console.log(m.generateKeywordMatrix('GPT-5.5')))"`。
- GitHub Actions 若要在 CI 上真正跑 Chrome Web Store / AppSumo：在 `radar.yml` 的 `npm ci` 之后加 `npx playwright install --with-deps chromium`。
- `scripts/build-community-data.mjs` 可从 `data/community/latest/` 重生成 `site/data/community-signals.json`，不必重新爬。测试里会覆盖它。
