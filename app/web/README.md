# `app/web`：Manifold Web 阅读端

## 项目背景

`app/web` 是 Manifold 面向读者的公开网站。它把 Core 提供的个人资料、当前状态、内容流和统计组合成一个可阅读的数字花园，并在文章详情页提供 Markdown 阅读、评论和访客反应。

Web 的关键约束是“只消费公开 API，不拥有业务数据”：

- 页面不直接访问 SQLite，也不导入 `app/admin`。
- 所有 Core 请求都经由 `@manifold/sdk`，类型来自 `@manifold/contracts`。
- Server Component 负责首屏数据和 SEO；Client Component 只负责评论、反应、动画和交互状态。
- Core 不承诺 Markdown HTML 安全，Web 在渲染时使用 `rehype-sanitize` 清理结果。

## 产品内容

`GET /health` 返回 Web 进程级 liveness 状态，供本地开发运行器和反向代理探测；Core 的服务健康检查仍使用 `/healthz`。

### 首页

`/` 通过 `loadHomeData` 并行请求六组数据：

- `profile`：身份、简介、头像首字母、位置和网站。
- `site`：首页导航/sections 和精选引用。
- `feed`：最近 6 条内容，展示 kind、标题、摘要、日期和标签。
- `now`：当前正在关注的主题。
- `stats`：已发布条目、字数、研究笔记等统计。

六个请求任意一个失败时，首页进入统一的 Core unavailable 错误状态；页面不从前端自行计算业务统计。

### 写作归档

`/writing` 使用 `content({ limit: 50 })` 读取公开内容，按 Core 返回的顺序展示归档。每一项包含发布时间、标题、摘要、标签、内容类型和指向 `/writing/:slug` 的 href。

### 内容详情

`/writing/[slug]` 是动态 Server Component：

1. 根据 slug 调用 `contentBySlug`。
2. 同一份内容用于 title、description、canonical 和 Open Graph metadata。

详情页会根据 `kind` 展示对应的类型信息：技术记录显示技术栈/语言/难度，思考显示情绪/问题/上下文，文稿显示体裁/阶段/字数。
3. 正文通过 `remark-gfm` 支持 GFM，再由 `rehype-sanitize` 过滤。
4. 文章底部挂载 `ReactionBar` 和 `CommentThread`。
5. slug 不存在或内容未发布时显示可理解的缺失状态，不暴露 Core 堆栈。

## 技术架构

```text
Next.js App Router
├── Server Components
│   ├── app/page.tsx
│   ├── app/writing/page.tsx
│   ├── app/writing/[slug]/page.tsx
├── Client Components
│   ├── providers.tsx       # Radix Theme + TanStack Query
│   ├── comment-thread.tsx  # 表单、评论查询和乐观 pending
│   └── reaction-bar.tsx    # visitor ID、乐观反应和回滚
└── lib/api.ts
    ├── createServerClient()  # no-store fetch
    └── createBrowserClient() # 浏览器 fetch
              |
              v
       @manifold/sdk -> Core /api/v1
```

| 层 | 实现 | 作用 |
| --- | --- | --- |
| 页面 | Next.js 16 App Router + React 19 | SSR、动态 slug、metadata |
| 请求 | `@manifold/sdk` | 统一 Core 请求和 `ApiError` |
| Server state | TanStack Query | 评论/反应查询、30 秒 stale time、重试和失效 |
| 表单 | React Hook Form + Zod | 评论输入校验 |
| 阅读 | `react-markdown` + `remark-gfm` | Markdown/GFM 解析 |
| 安全 | `rehype-sanitize` | 渲染前清理 HTML |
| UI | Radix Themes + Lucide React | 可访问控件和图标 |
| 动画 | Framer Motion | 评论列表进入动画 |

## 目录与模块

```text
app/web/
├── app/
│   ├── layout.tsx                 # metadataBase、Providers、SiteNav
│   ├── page.tsx                   # 首页组合
│   ├── writing/page.tsx           # 写作归档
│   ├── writing/[slug]/page.tsx    # 详情、Markdown、评论、反应
│   ├── error.tsx                  # 路由级错误边界
│   ├── global-error.tsx           # 根级错误边界
│   └── globals.css/site.module.css
├── components/
│   ├── providers.tsx              # QueryClient 和 Radix Theme
│   ├── site-nav.tsx               # 站点导航
│   ├── comment-thread.tsx         # 评论查询、表单和 pending
│   ├── reaction-bar.tsx            # LIKE/FAVORITE 交互
│   └── error-state.tsx             # 可恢复错误页
├── lib/
│   ├── api.ts                     # SDK client、首页聚合、visitor ID
│   └── observability.ts           # trace ID 和客户端错误日志
├── next.config.ts                 # Core URL 注入
└── package.json
```

## 请求和状态流

### 服务端数据

`createServerClient` 使用 `NEXT_PUBLIC_CORE_URL` 创建 SDK，并包装 fetch 为 `cache: "no-store"`。首页、归档和详情每次服务端请求都会向 Core 获取当前数据，不使用 Next 静态数据缓存。

根布局的 `metadataBase` 来自 `NEXT_PUBLIC_SITE_URL`，默认为 `http://localhost:3000`。详情页 metadata 通过同一个 slug 查询生成。

### 评论

`CommentThread` 使用 query key `["comments", slug]`：

1. 加载 Core 返回的已批准评论。
2. 使用 React Hook Form + Zod 校验：正文 3 到 4000 字符，姓名可选，网站必须是完整 URL 或空值。
3. `onMutate` 追加本地 `PENDING` 评论，立即显示 `Awaiting review`。
4. Core 成功返回 `201` 后，用服务端 comment 替换 pending，并清空表单。
5. 公开列表永远只来自 Core 的 `APPROVED` 数据；审核发生在 Admin。

### 反应

`getVisitorId` 在 localStorage 保存 `manifold.visitorId`，首次访问用 `crypto.randomUUID()` 生成。`ReactionBar`：

- 读取时可发送 `X-Visitor-ID`，写入时必须发送。
- mutation 先乐观更新计数和 viewer flags。
- 请求失败时恢复旧快照；请求结束后重新失效查询。
- Core 返回的 summary 是最终状态，避免前端计数漂移。

## 配置与运行

从仓库根目录：

```bash
pnpm install
pnpm --filter @manifold/web dev
```

开发服务器默认 `http://localhost:3000`，Core 默认 `http://localhost:8080`。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NEXT_PUBLIC_CORE_URL` | `http://localhost:8080` | Server/Browser SDK 请求 Core |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | canonical 和 metadataBase |
| `PORT` | Next 默认值 | 可由 CLI/宿主环境覆盖 |

根目录 `.env` 不会自动被 Next 读取；使用 shell、进程管理器或部署平台注入变量。修改 `NEXT_PUBLIC_*` 后需重启开发服务器或重新构建。

## 命令

| 命令 | 作用 |
| --- | --- |
| `pnpm --filter @manifold/web dev` | Web 开发服务器 |
| `pnpm --filter @manifold/web build` | 生产构建 |
| `pnpm --filter @manifold/web start` | 启动已构建服务 |
| `pnpm --filter @manifold/web lint` | ESLint |
| `pnpm --filter @manifold/web typecheck` | TypeScript 检查 |
| `pnpm --filter @manifold/web test` | 当前等价于 TypeScript 检查 |
| `pnpm browser-test` | 根脚本真实浏览器回归 |

浏览器回归会创建临时 Core 数据库和端口，启动临时 Web/Admin，并检查文章详情、LIKE、FAVORITE、评论提交、Admin 登录和评论批准。

## 错误处理和可观测性

- 页面数据失败时显示可理解错误文案。
- `app/error.tsx` 捕获路由错误，`app/global-error.tsx` 捕获根级错误。
- 错误页提供重试和 trace reference，不显示内部 stack。
- `reportClientError` 记录 `manifold.client_error`、scope、trace ID、错误名、消息和 stack。
- SDK 每次请求发送 `X-Trace-ID`，Core 错误可能携带 request/trace ID。

## 开发约束

1. 公开数据只能通过 `@manifold/sdk` 读取，不在页面组件中直接请求 Core。
2. 不重新计算 Core 统计或自行判断发布状态，以 API response 为准。
3. Markdown 必须经过 `rehype-sanitize`，不要使用 `dangerouslySetInnerHTML`。
4. 新增客户端状态优先放在对应 Client Component，不把整个页面改成客户端渲染。
5. 评论和反应变更后保持 query key 一致并正确失效。
6. 新增页面同步 metadata、加载/错误状态和移动端布局，并更新本 README。

## 测试重点

| 范围 | 命令/文件 | 关注点 |
| --- | --- | --- |
| 类型 | `pnpm --filter @manifold/web typecheck` | Server/Client 边界和 SDK 类型 |
| 构建 | `pnpm --filter @manifold/web build` | Next 编译、metadata、路由产物 |
| lint | `pnpm --filter @manifold/web lint` | ESLint 规则 |
| SDK | `packages/sdk/src/index.test.ts` | URL、header、ApiError 和 reaction 请求 |
| 浏览器 | `scripts/browser-check.cjs` | 详情、反应、评论和 Admin 联动 |

## 当前边界

当前 Web 只覆盖首页、技术/思考/文稿归档和详情页。Projects、Timeline、跨资源搜索、媒体附件、经历详情和研究系列尚未有页面或 SDK 方法，也不属于当前产品范围。新增资源时应先补 Core contract、contracts、SDK，再加入页面。
