# `app/web`

Manifold 公开阅读端，负责 Home、Thoughts、Writings、Markdown 阅读、评论和访客反应。

当前详细契约见 [`docs/decisions/web.md`](../../docs/decisions/web.md)，摘要索引见 [`docs/web.md`](../../docs/web.md)。其中记录 Next.js App Router 的页面、Server/Client Component 边界、SEO 数据流、Core 请求、评论/反应 query、Markdown 公式/高亮/sanitize/TOC/复制能力，以及 Design System 约束。

当前路由：`/`、`/thoughts`、`/thoughts/[id]`、`/writing`、`/writing/[slug]`、`/health`。

## 运行

```bash
pnpm --filter @manifold/web dev
pnpm --filter @manifold/web typecheck
pnpm --filter @manifold/web lint
pnpm --filter @manifold/web build
pnpm browser-test
```

配置 `NEXT_PUBLIC_CORE_URL` 指向 Core，`NEXT_PUBLIC_SITE_URL` 用于 canonical 和 metadataBase。修改 Web 路由、页面数据、渲染器或交互时，必须同时检查 [`docs/decisions/web.md`](../../docs/decisions/web.md)、[`docs/core.md`](../../docs/core.md)、[`packages/sdk/README.md`](../../packages/sdk/README.md) 和根目录 [`AGENTS.md`](../../AGENTS.md)。
