# Web 当前架构与 API 消费契约

> 本文记录 `app/web` 的当前实现，而不是未来页面规划。修改 Web 路由、页面数据、Core 调用、Markdown 渲染、评论/反应、SEO、可观测性或设计约束时必须同步本文。历史方案不得把 Projects、Technology、Manuscript 等已移出范围的内容写成当前功能。

## 1. 项目定位

Web 是公开阅读端，负责把 Profile、Now、Stats、Thoughts 和 Writings 组合成个人数字花园。它不持有业务数据，不读 SQLite，不导入 Admin 或 Core Go 包，所有 Core 请求都通过 `@manifold/sdk`。

运行时边界：

```text
Next Server/Browser Components
          |
          +--> @manifold/sdk --> Core /api/v1
          +--> @manifold/contracts
```

Server Component 负责首屏数据、详情读取和 SEO；Client Component 负责评论、反应、导航菜单、错误恢复和局部状态。

## 2. 页面与路由

| 路由 | 类型 | Core 数据 | 行为 |
| --- | --- | --- | --- |
| `/` | Dynamic Server Component | profile、site、2 条 Article、3 条 Thought、now、stats | Hero、Compact CV、Recent Activity、统计 |
| `/thoughts` | Dynamic Server Component | `feed({ kind: "THOUGHT" })` | 轻量时间线/标签入口 |
| `/thoughts/[id]` | Dynamic Server Component | 通过 ID 获取 Thought 详情 | 复用统一阅读器和评论/反应 |
| `/writing` | Dynamic Server Component | `content({ kind: "ARTICLE" })` | 长文列表、标签、阅读时长 |
| `/writing/[slug]` | Dynamic Server Component | `contentBySlug(slug)` | SEO、TOC、Markdown、评论和反应 |
| `/health` | Route Handler | 无 | Web 进程 liveness，Core 健康检查仍为 `/healthz` |

详情页根据 content kind 选择返回路径：Thought 用 `/thoughts/{id}`，Article 用 `/writing/{slug}`。Core 返回的 `href` 是列表链接的来源，页面不自行重建业务 URL。

## 3. 首页数据流

`loadHomeData()` 并行调用：

```text
profile()
site()
feed({ limit: 2, kind: "ARTICLE" })
feed({ limit: 3, kind: "THOUGHT" })
now()
stats()
```

两组内容在 Web 内按 `publishedAt ?? createdAt` 倒序混排。统计、发布状态和内容计数只使用 Core 返回值，不在浏览器重新计算。任一请求失败时，首页显示 Core unavailable 状态，不暴露内部错误。

## 4. Markdown 阅读器

Web 和 Admin 使用相同的 Markdown 能力组合：

- `react-markdown`：React 渲染边界。
- `remark-gfm`：表格、任务列表、删除线等 GFM。
- `remark-math` + `rehype-katex` + `katex`：行内和块级数学公式。
- `rehype-highlight`：代码块语法高亮。
- `rehype-sanitize`：第三方插件处理后进行 HTML 清洗。
- 原生 `navigator.clipboard`：代码块复制，不额外引入 clipboard 包。

`app/web/components/markdown-content.tsx` 统一生成 h2/h3 anchor id、代码工具条和复制状态。Core 只存 Markdown，不承诺内容生成的 HTML 安全；禁止使用 `dangerouslySetInnerHTML` 绕过清洗。

Article 的 `metadata.toc` 是 Core 持久化的目录来源，Web 使用对应 `id` 生成 sticky TOC。新增运行时标题 ID 算法时必须同步 Core metadata 约定和 Admin 编辑/生成逻辑。

## 5. 评论与反应

### 评论

`CommentThread` 使用 React Hook Form、Zod 和 TanStack Query：

1. `comments(slug)` 读取 Core 返回的 APPROVED 评论。
2. 表单要求正文 3 到 4000 字符，作者名/网站可选，附轻量验证码。
3. `onMutate` 先插入本地 pending comment，提交成功后用 Core 的 201 结果替换。
4. 失败时回滚 pending 并保留输入，UI 显示错误。
5. Query key 为 `comments + slug`，不要把 Admin 审核状态复制到 Web。

### 反应

`getVisitorId()` 将匿名 ID 保存在 `localStorage` 的 `manifold.visitorId`。`ReactionBar`：

- GET 可携带 `X-Visitor-ID`，PUT/DELETE 必须携带。
- LIKE/FAVORITE 先乐观更新，再用 Core 返回的 `ReactionSummary` 校正。
- 失败时恢复旧快照，结束后失效 reaction query。

## 6. SEO、错误和可观测性

- `layout.tsx` 使用 `NEXT_PUBLIC_SITE_URL` 作为 `metadataBase`。
- 内容详情从同一份 Core 数据生成 title、description、canonical 和 Open Graph metadata。
- `app/error.tsx` 处理路由级异常，`global-error.tsx` 处理根级异常；错误页提供重试和 trace reference，不显示内部 stack。
- SDK 每次请求发送 `X-Trace-ID`；客户端错误通过 `reportClientError` 记录 scope、错误名、消息、stack 和 trace ID。
- Core unavailable 时优先显示可理解的恢复提示，不把网络异常转成空内容。

## 7. 配置和依赖

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NEXT_PUBLIC_CORE_URL` | `http://localhost:8080` | Server/Browser SDK 请求 Core |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | canonical 和 metadataBase |

主要依赖：Next.js 16、React 19、TanStack Query、React Hook Form、Zod、Radix Themes、Lucide React、Framer Motion、Markdown/公式/高亮链路。新增依赖必须说明用户能力、包体、SSR/CSR 影响和安全边界，并更新 `app/web/package.json`、本文与 `docs/web.md`。

## 8. 设计和开发约束

1. 颜色和字体优先使用 `app/web/app/globals.css` 中对齐 `docs/design-system/src/tokens.css` 的变量。
2. 不在页面组件中直接拼接 Core URL，不直接计算 Core 统计或状态。
3. 新增 Client Component 前确认是否真的需要浏览器状态，避免把整页改成 CSR。
4. 页面必须有 loading/error/empty 状态和移动端约束；按钮使用现有图标体系和可访问名称。
5. Markdown 必须经过 sanitize；任何 renderer 改动都要检查 XSS、标题锚点和代码复制。

## 9. 修改与验证

修改 Web 时同步检查：

- `packages/contracts/README.md`、`packages/sdk/README.md` 是否仍描述真实调用。
- `docs/core.md` 是否需要更新响应、参数或错误说明。
- `docs/admin.md` 是否共享了 Markdown、内容类型或 API 变化。
- `docs/web.md` 索引和 `app/web/README.md` 是否仍准确。

```bash
pnpm --filter @manifold/web typecheck
pnpm --filter @manifold/web lint
pnpm --filter @manifold/web build
pnpm browser-test
```
