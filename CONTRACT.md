# 数据契约(所有子模块必须遵守)

这份文档是 8 个并行子代理之间唯一的接口约定。每个 scraper 模块互不感知彼此的实现,
只通过这里定义的形状交换数据。

## 1. Scraper 模块规范

路径:`scrapers/<group>/<source-key>.mjs`

每个文件必须 `export default` 一个 **无参数、返回 Promise** 的异步函数,函数内部自己完成
"抓取当前数据 → 调用 lib/snapshot.mjs 的 diffAndSave → 返回新增条目数组"。示例:

```js
// scrapers/model-directories/openrouter.mjs
import { diffAndSave } from "../../lib/snapshot.mjs";

const SOURCE_KEY = "openrouter";

export default async function run() {
  const res = await fetch("https://openrouter.ai/api/v1/models");
  if (!res.ok) throw new Error(`openrouter fetch failed: ${res.status}`);
  const json = await res.json();

  const fresh = json.data.map((m) => ({
    id: m.id,
    name: m.name ?? m.id,
    url: `https://openrouter.ai/${m.id}`,
    meta: { pricing: m.pricing, context_length: m.context_length },
  }));

  const added = await diffAndSave(SOURCE_KEY, fresh);

  return added.map((item) => toNewItem(item));
}

function toNewItem(item) {
  return {
    source: SOURCE_KEY,
    sourceLabel: "OpenRouter",
    category: "model-directory",
    id: item.id,
    name: item.name,
    url: item.url,
    detectedAt: new Date().toISOString(),
    meta: item.meta ?? {},
  };
}
```

## 2. NewItem 形状(scraper 的返回值元素)

```ts
{
  source: string;        // 机器可读 key,必须等于文件名(不含扩展名),如 "openrouter"
  sourceLabel: string;   // 人类可读名称,如 "OpenRouter"
  category: "model-directory" | "official-source" | "community" | "trending";
  id: string;            // 该 source 内部唯一 id(不必全局唯一)
  name: string;          // 展示名称,如模型名/帖子标题/产品名
  url: string;           // 可点击链接
  detectedAt: string;    // ISO timestamp,首次发现时间
  meta: object;          // 该 source 特有的原始字段,供评分引擎使用,取不到就给 {}
}
```

**关键原则:没有拿到的字段一律省略或标 `null`,绝不编造。** 抓不到开发者信息就是
`meta.developer = "unknown"`,不要猜测。

## 3. 抓不到 / 无官方 API 的 source 怎么办

用 `cheerio` 抓 HTML 时,如果目标网站结构不确定或抓取失败,`run()` 必须 `console.warn`
并返回空数组 `[]`,不能抛出未捕获异常导致整个 workflow 中断。抓取失败本身也是一种信号,
在 stderr 里说清楚失败原因(HTTP 状态码/选择器找不到元素)。

## 4. Manifest(由整合模块统一维护)

`scripts/run-all.mjs`(整合模块负责,其他模块不要碰这个文件)按下表固定的
`source key -> 文件路径` 列表依次 `import()` 并调用每个模块的 `run()`,把所有
`NewItem` 汇总写入 `data/events.jsonl`(每行一个 JSON 对象,追加写入,不覆盖历史)。

| source key            | 文件路径(相对项目根)                                  | 负责的子代理 |
|------------------------|--------------------------------------------------------|--------------|
| openrouter              | scrapers/model-directories/openrouter.mjs               | Agent 1 |
| huggingface             | scrapers/model-directories/huggingface.mjs               | Agent 1 |
| replicate                | scrapers/model-directories/replicate.mjs                  | Agent 1 |
| together                 | scrapers/model-directories/together.mjs                   | Agent 1 |
| fireworks                | scrapers/model-directories/fireworks.mjs                  | Agent 1 |
| ollama                    | scrapers/model-directories/ollama.mjs                       | Agent 2 |
| falai                      | scrapers/model-directories/falai.mjs                         | Agent 2 |
| artificial-analysis    | scrapers/model-directories/artificial-analysis.mjs   | Agent 2 |
| lmarena                   | scrapers/model-directories/lmarena.mjs                    | Agent 2 |
| openai                     | scrapers/official-sources/openai.mjs                        | Agent 3 |
| anthropic                | scrapers/official-sources/anthropic.mjs                   | Agent 3 |
| deepmind                 | scrapers/official-sources/deepmind.mjs                    | Agent 3 |
| meta                        | scrapers/official-sources/meta.mjs                          | Agent 3 |
| qwen                       | scrapers/official-sources/qwen.mjs                          | Agent 3 |
| deepseek                  | scrapers/official-sources/deepseek.mjs                    | Agent 3 |
| xai                          | scrapers/official-sources/xai.mjs                             | Agent 4 |
| mistral                    | scrapers/official-sources/mistral.mjs                       | Agent 4 |
| kimi                         | scrapers/official-sources/kimi.mjs                            | Agent 4 |
| zhipu                       | scrapers/official-sources/zhipu.mjs                          | Agent 4 |
| minimax                    | scrapers/official-sources/minimax.mjs                     | Agent 4 |
| producthunt              | scrapers/community/producthunt.mjs                        | Agent 4 |
| github-trending        | scrapers/community/github-trending.mjs                 | Agent 4 |
| hackernews                | scrapers/community/hackernews.mjs                          | Agent 4 |
| reddit                       | scrapers/community/reddit.mjs                                 | Agent 5 |
| chrome-web-store       | scrapers/community/chrome-web-store.mjs                | Agent 5 |
| appsumo                    | scrapers/community/appsumo.mjs                               | Agent 5 |
| google-trends            | scrapers/community/google-trends.mjs                     | Agent 5 |

每个 scraper 文件 **只能创建这张表里分给自己的文件**,不要动别人的文件,也不要碰
`scripts/run-all.mjs`、根目录 `package.json`、根目录 `README.md`(这三个由整合模块 Agent 5 统一维护)。

## 5. 评分引擎输入(Agent 5 负责,供其余模块了解全局)

`scoring/score.mjs` 读取 `data/events.jsonl` 里最近的 `NewItem`,按用户定义的规则打分
(头部公司正式发布 +30、上线主流模型平台 +15、免费或低价 +15、性能超过热门模型 +15、
一小时内多处独立讨论 +15、YouTube 教程出现 +10、出现 pricing/API 问题 +15、Google 自动
补全出现 +20、单个博主转载 -15、无公开使用入口 -10、只是传闻 -10),
输出到 `data/scored.json`,分数分档:<30 记录不建站,30-60 先占域名/单页,60-80 当天上线,
80+ 立即做完整专题站。

## 6. 网站(site/)数据输入契约

`site/` 下的页面不直接读 `data/`,而是读 `site/data/entities.json`(由 Agent 8 从
`data/scored.json` + `data/events.jsonl` 转换生成)。每个 entity 形状:

```ts
{
  slug: string;              // URL 用,如 "ox-alpha"
  name: string;
  status: "public-preview" | "rumored" | "confirmed" | "unknown";
  developer: string | "unknown";   // 明确未知就写 "unknown",页面上要展示 "Developer: Unknown"
  officialModelId: string | null;
  score: number;
  lastVerified: string;      // ISO date,页面必须展示 "Last verified: <date>"
  sources: { label: string; url: string }[];
  isRumor: boolean;          // true 时页面必须标注"传闻/推测"
}
```

**任何页面模板严禁编造开发商、参数、价格。** 拿不到的字段展示为 "Unknown" 或
"Developer: Unknown / Status: Public preview / Last verified: <date>",这是用户明确提出的
底线要求。
