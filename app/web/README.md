# `app/web`

Manifold 公开阅读端，负责 Home、Thoughts、Writings、Markdown 阅读、评论和访客反应。

当前详细契约见 [`docs/decisions/web.md`](../../docs/decisions/web.md)，摘要索引见 [`docs/web.md`](../../docs/web.md)。其中记录 Next.js App Router 的页面、Server/Client Component 边界、SEO 数据流、Core 请求、评论/反应 query、Markdown 公式/高亮/sanitize/TOC/复制能力，以及 Design System 约束。

当前路由：`/`、`/thoughts`、`/thoughts/[id]`、`/writing`、`/writing/[slug]`、`/feed.xml`、`/health`。

`/thoughts` 由 Server Component 读取 Core 的 Thoughts aggregate，翻页时请求 Core 的对应页；置顶有效性、最新回退、置顶排除、正文摘录和页数均由 Core 负责，Web 只把当前页按 UTC 年份/月份/日期组织成分块时间轴：年份为卡片 surface 之外的分节标题行，月份标签与日期节点在左栏和纵轴上，内容 surface 按年份框住卡片。Thoughts 与 Writings 归档都把星号灰色摘要和正文摘录分开，普通项限制两行正文、置顶项限制四行；归档页显示 Core 返回的点赞、观看和已审核评论数，不在 Web 端额外请求评论或计算统计。

首页按 Profile/Introduction、Recent Content、Updates、Contribution activity、My Series、Contact 六段组织共同信息，展示语言参考仓库根目录的 `1.html`；Introduction 使用不透明 surface，Updates 使用最近 10 个内容的 `updatedAt`，同日更新合并为一个水平日期点，hover/focus 后在竖向预览中展示当天每条内容；Contribution activity 使用每类最多 1000 条公开内容的 `updatedAt`，可按年份切换并按 UTC 日期显示 0-4 级热度；My Series 使用紧凑索引卡片，Contact 使用纯图标 rail，详情在 hover/focus 时通过脱离局部层叠上下文的浮层展示；页脚在线人数通过 Core presence 心跳返回，不使用 mock；页面数据、状态徽标和内容链接仍以 Core 返回值为准。

## 运行

```bash
pnpm --filter @manifold/web dev
pnpm --filter @manifold/web typecheck
pnpm --filter @manifold/web lint
pnpm --filter @manifold/web test
pnpm --filter @manifold/web build
pnpm browser-test
```

配置 `NEXT_PUBLIC_CORE_URL` 指向 Core，`NEXT_PUBLIC_SITE_URL` 用于 canonical 和 metadataBase。修改 Web 路由、页面数据、渲染器或交互时，必须同时检查 [`docs/decisions/web.md`](../../docs/decisions/web.md)、[`docs/core.md`](../../docs/core.md)、[`packages/sdk/README.md`](../../packages/sdk/README.md) 和根目录 [`AGENTS.md`](../../AGENTS.md)。
