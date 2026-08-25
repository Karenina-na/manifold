# Admin 当前契约

> 本文是 `app/admin` 当前实现的权威说明。工作区、Core API 调用、query key、表单字段、认证或构建边界变化时必须同步本文。

## 1. 背景与边界

`app/admin` 是单一 owner 使用的私有管理端，负责登录、内容发布、评论审核、Now、Profile、首页 composition 和统计。它是独立的 Vite/React 应用，不复用 Web 页面组件、不访问 Core SQLite、不复制 Core 业务规则。

Core 负责最终鉴权和状态转换；Admin 只持有 session token，组织表单、查询缓存和用户反馈。

## 2. 技术架构

```text
Vite + React 19
├── App.tsx: session / Login / Sidebar / lazy workspaces
├── Mantine 9: controls and feedback
├── React Hook Form + Zod: form boundary
├── TanStack Query: server state and invalidation
├── Recharts: Dashboard chart
├── Lucide React: actions and navigation icons
├── vite-plugin-pwa: manifest / service worker
└── @manifold/sdk -> Core /api/v1/admin
```

主要模块：`src/App.tsx` 管理登录和工作区；`src/api.ts` 创建 SDK client；`SettingsWorkspace.tsx` 管理 Profile/Site；`workspaces/ContentWorkspace.tsx` 管理 Thought/Article；其余工作区分别负责 Dashboard、评论和 Now；`ErrorBoundary.tsx` 负责渲染恢复。

Dashboard、Content、Comments、Now、Settings 通过 lazy chunk 加载，登录壳同步加载。

## 3. 登录和会话

登录表单使用 React Hook Form + Zod，调用 `POST /api/v1/admin/session`。成功后把 `accessToken`、用户名和本地过期时间存到 `sessionStorage` 的 `manifold.admin.session`。

- 页面初始化时读取 session；过期或缺失则显示登录页。
- SDK 自动发送 `Authorization: Bearer <token>` 和 `X-Trace-ID`。
- Core 返回 `ApiError`，UI 显示稳定的用户提示；不要在 Admin 重新实现 JWT 验证。
- 当前只有 `admin` 角色，没有注册、角色管理或多用户 UI。

## 4. 工作区和 API

### Dashboard

调用 `GET /api/v1/admin/stats`，读取 `AdminStats.content` 的 `contentCount`、`articleCount`、`thoughtCount`、`wordCount`，以及 `pendingComments`。图表只展示 Core 聚合，不在浏览器重新统计。刷新只重新请求 `admin-stats`。

### Content

| 操作 | SDK/Core |
| --- | --- |
| 列表和筛选 | `adminContent({ kind, status, tag, q, cursor, limit })` |
| 创建草稿 | `createContent(ContentInput)` |
| 编辑/转换 | `updateContent(id, UpdateContentInput)` |
| 发布/撤回 | `publishContent(id)` / `unpublishContent(id)` |
| 删除 | `deleteContent(id)`，Core 返回 204 |

Thought 模式字段：正文、可选 title/slug、tags、mood、question、context、source。

Article 模式字段：title、slug、summary、Markdown body、tags、readingMinutes、frontmatter JSON、technologies、language、difficulty。编辑器右侧使用 `react-markdown`、GFM、数学公式、代码高亮和 sanitize 进行实时预览。

规则：Article 创建和转换时 title、slug 必填；Thought 可为空；所有更新带 `expectedVersion`；新建总是 DRAFT；列表筛选由 Core 执行。

### Comments

`adminComments("PENDING")` 读取审核队列；Approve/Reject 分别调用 `POST /api/v1/admin/comments/{id}/approve|reject`，成功为 204。成功后失效 `admin-comments` 和 `admin-stats`。

### Now

`now()` 读取当前状态，`updateNow(input)` 调用 `PUT /api/v1/admin/now`。成功后失效 `now` query。

### Settings

Profile 调用 `GET/PATCH /api/v1/admin/profile`，包含 displayName、handle、headline、bio、avatarUrl、location、organization、websiteUrl、resumeUrl、interests、education、experience、series、contacts。Series 和联系方式在 Settings 以 JSON 编辑，Web 首页以公开卡片/链接展示。

Site 调用 `GET/PATCH /api/v1/admin/site`，包含 `featuredContent`、`navigation` 和 `sections`。浏览器先用 Zod 校验 navigation JSON 和 sections，Core 仍做最终校验。

## 5. Query key 和失效

| Query key | 来源 | 写入后失效 |
| --- | --- | --- |
| `admin-stats` | `adminStats()` | 评论审核后、Dashboard 手动刷新 |
| `admin-content` + filter | `adminContent()` | 内容创建、更新、发布、撤回、删除 |
| `admin-comments` | `adminComments("PENDING")` | Approve/Reject |
| `now` | `now()` | 更新 Now |
| `admin-profile` | `adminProfile()` | 保存 Profile |
| `admin-site` | `adminSite()` | 保存 Site |

只失效受影响的资源 key，不使用全局清缓存替代资源级更新。

## 6. 配置、命令和构建

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `VITE_CORE_URL` | `http://localhost:8080` | Core API 地址 |

```bash
pnpm --filter @manifold/admin dev
pnpm --filter @manifold/admin typecheck
pnpm --filter @manifold/admin lint
pnpm --filter @manifold/admin build
pnpm --filter @manifold/admin preview
```

根目录 `pnpm browser-test` 会启动隔离 Core/Web/Admin，验证登录、stats、反应、评论提交和审核。

## 7. 修改规则

修改工作区 API、字段或状态时：

1. 先更新 `packages/contracts` 和 `packages/sdk`，再更新工作区。
2. 同步本文、`docs/core.md` 和 Web 文档中受影响的调用方。
3. 更新对应 query key、错误态、loading 态和浏览器验收。
4. 新增依赖时记录用途、包体和替代方案；当前 Markdown 依赖的用途见 `docs/decisions/web.md`。

管理控件优先使用 Mantine/Lucide，保持键盘访问、loading、error、empty 状态；设计令牌遵循 `docs/design-system/`。
