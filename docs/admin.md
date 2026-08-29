# Admin 当前契约

> 本文是 `app/admin` 当前实现的权威说明。工作区、Core API 调用、query key、表单字段、认证或构建边界变化时必须同步本文。

## 1. 背景与边界

`app/admin` 是单一 owner 使用的私有管理端，负责登录、统计与 Now 状态、Profile、Writings/Thoughts 发布、评论管理（软删除/恢复）和首页 composition。它是独立的 Vite/React 应用，不复用 Web 页面组件、不访问 Core SQLite、不复制 Core 业务规则。

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

主要模块：`src/App.tsx` 管理登录和工作区；`src/api.ts` 创建 SDK client；`SettingsWorkspace.tsx` 管理 Site composition；`workspaces/` 下分别负责 Dashboard（数据总览）、Profile、Writings、Thoughts 和评论管理；`ErrorBoundary.tsx` 负责渲染恢复。

Dashboard、Profile、Writings、Thoughts、Comments、Settings 通过 lazy chunk 加载，登录壳同步加载。

## 3. 登录和会话

登录表单使用 React Hook Form + Zod，调用 `POST /api/v1/admin/session`。成功后把 `accessToken`、用户名和本地过期时间存到 `sessionStorage` 的 `manifold.admin.session`。

- 页面初始化时读取 session；过期或缺失则显示登录页。
- SDK 自动发送 `Authorization: Bearer <token>` 和 `X-Trace-ID`。
- Core 返回 `ApiError`，UI 显示稳定的用户提示；不要在 Admin 重新实现 JWT 验证。
- 当前只有 `admin` 角色，没有注册、角色管理或多用户 UI。

## 4. 工作区和 API

### Dashboard

纯数据展示工作区，无编辑表单。数据全部来自 Core 聚合端点，不在浏览器重新统计：

- 指标卡行（6 张）：Published、Drafts、Total views、Likes、Comments、Visitors now，来自 `adminOverview()` 的 `content`。
- 趋势区：月度 `created`/`published` 双系列面积图（`overview.trend.monthly`，近 12 个月）；近 30 天去重浏览/独立访客面积图（`adminAnalyticsViews({ days: 30 })`）。
- 排名区：浏览量 Top 5 已发布内容与 Top 10 标签横向条形图（`overview.topContent` / `overview.tags`）。
- 动态区（结构对齐，两面板均为顶部搜索框 + 列表 + 底部分页，每页 10 条，列表区 `flex:1` 撑满使外框等高）：
  - Recent comments：复用 `adminComments()`（query key 与 Comments 工作区共享），客户端过滤未软删评论并按 authorName/body 大小写不敏感搜索，本地分页；
  - Recent activity：`adminAudit({ page, pageSize: 10, q })` 服务端分页，`q` OR 匹配事件名/操作者/资源 ID，搜索 250ms 防抖且重置回第 1 页。
- 底部系统健康卡：顶部 CPU/内存/磁盘三个环形图（used vs free，`isAnimationActive` 关闭）+ cells（version、uptime、Host（hostname · platform）、CPU（核数 · 占比）、内存/磁盘（used/total · percent，磁盘为数据库所在分区）、load average 1/5/15、进程 RSS、heap、goroutines、DB 体积、内容缓存条目、审计事件总数和启动时间）；卡片标题区带独立刷新按钮，仅失效 `admin-system` query（`system.isFetching` 时图标旋转）。资源指标由 Core 经 gopsutil 采样，单项失败显示为零值。

Refresh 按钮同时 refetch 四个 query。Now 状态功能已整体移除（Core 端点与 `NowStatus` 契约删除），Dashboard 不再承载任何 Now 编辑。

### Profile

三栏工作台：左侧分区锚点导航（Identity / Links / Interests / CV / Series / Contact）+ 中间分组表单 + 右侧实时预览（随输入渲染公开首页的简化版，Admin 自绘，不依赖 Web 组件）。窄屏（<1180px）隐藏导航，<900px 时预览移到表单下方。

`GET/PATCH /api/v1/admin/profile`，包含 displayName、handle、headline、bio、avatarUrl、location、organization、websiteUrl、resumeUrl、interests、education、experience、series、contacts。表单为结构化编辑器（react-hook-form `useFieldArray` + 嵌套 zod，行级错误落位）：

- interests 使用 chip 输入（Enter/逗号添加、× 移除、Backspace 删除末项）；
- education/experience/series/contacts 为可增删、上下排序的行编辑器，不再手写 JSON；
- contacts 每行带图标网格 picker（`github`/`x`/`mail`/`rss`/`telegram`/`podcast`/`tv`/`flame`/`message`/`at`/`radio`/空 = globe 兜底），行内实时提示公开渲染结果；Admin 复刻 Web 端 `profile-surfaces.tsx` 的 icon/label/url 启发式映射（`resolveContactKey`），两处必须保持同步；
- URL 校验：avatar/website/resume 允许空或 http(s)，contacts/series URL 必填且为 http(s) 或 mailto；headline/bio 显示字符计数；
- 表单脏状态（isDirty）出现底部 sticky 保存条（Unsaved changes · Save/Discard），保存成功后按钮短暂显示 Saved。

预览面板还原：头像/姓名/headline、organization 行、bio、`#interests`、Background（education/experience）、Contact 图标带（含 websiteUrl 合成条目与 location 遥测显示规则）、series 序号卡。query key 维持 `['admin-profile']`，保存成功后失效。

### Writings

Writings 工作区固定 `kind: 'ARTICLE'`，列表调用 `adminContent({ kind: 'ARTICLE' })`，query key 为 `['admin-content', 'ARTICLE']`。

| 操作 | SDK/Core |
| --- | --- |
| 列表 | `adminContent({ kind: 'ARTICLE' })`，列表项显示 Core 返回的浏览量和点赞数 |
| 创建草稿 | `createContent(ContentInput)` |
| 编辑 | `updateContent(id, UpdateContentInput)` |
| 发布/撤回 | `publishContent(id)` / `unpublishContent(id)` |
| 删除 | `deleteContent(id)`，Core 返回 204 |

编辑器字段：title、slug（均必填）、summary、Markdown body、tags、frontmatter JSON、technologies、language（下拉选择）、difficulty。阅读时长和目录由 Core 在保存时根据 Markdown 自动计算，编辑器以只读状态展示预计时长；右侧使用 `react-markdown`、GFM、数学公式、代码高亮和 sanitize 进行实时预览。

### Thoughts

Thoughts 工作区固定 `kind: 'THOUGHT'`，列表调用 `adminContent({ kind: 'THOUGHT' })`，query key 为 `['admin-content', 'THOUGHT']`。操作表与 Writings 相同（创建/编辑/发布/撤回/删除）。

编辑器字段：正文必填，title、slug 可选（为空时 Core 使用 ID）；tags、mood、question、context、source。

规则：所有更新带 `expectedVersion`；新建总是 DRAFT；两个内容工作区的写入失效统一使用 `['admin-content']` 前缀并同步失效 `admin-overview`，保证 Writings、Thoughts、Settings 的置顶选择器和 Dashboard 指标互相同步。

### Comments

`adminComments()` 读取全量评论（含已软删，按 `createdAt` 降序）；Delete 调用 `DELETE /api/v1/admin/comments/{id}`（软删除），Restore 调用 `POST /api/v1/admin/comments/{id}/restore`，成功均为 204。操作后失效 `admin-comments` 和 `admin-overview`。评论创建即公开，这里只做软删除/恢复管理。

Now 状态功能已整体移除（Core 端点删除），本仓库无对应工作区。

### Settings

Site 调用 `GET/PATCH /api/v1/admin/site`，包含 `featuredContent`、`navigation` 和 `sections`。Thoughts 置顶独立调用 `GET/PATCH /api/v1/admin/thoughts/config`；Settings 以每页 50 条按 cursor 读取全部已发布 Thoughts 填充 Pinned thought 选择器。置顶与 Site composition 使用两个独立保存动作和 mutation，避免跨资源部分成功被误报为整体失败；置顶保存将所选 ID 或 `null` 写入 `thoughts_config`，Core 最终校验目标必须是已发布 Thought，清空后公开归档由 Core 回退最新项。浏览器仍用 Zod 校验 navigation JSON 和 sections。

## 5. Query key 和失效

| Query key | 来源 | 写入后失效 |
| --- | --- | --- |
| `admin-overview` | `adminOverview()` | Dashboard 手动刷新 |
| `admin-analytics` + days | `adminAnalyticsViews({ days: 30 })` | Dashboard 手动刷新 |
| `admin-system` | `adminSystem()` | Dashboard 手动刷新 |
| `admin-comments` | `adminComments()`（Dashboard 评论面板与 Comments 工作区共享） | 软删除/恢复评论、Dashboard 手动刷新 |
| `admin-audit` + page + q | `adminAudit({ page, pageSize: 10, q })` | Dashboard 手动刷新 |
| `admin-content` + `ARTICLE` | Writings 列表 `adminContent({ kind: 'ARTICLE' })` | 内容创建、更新、发布、撤回、删除（统一失效 `['admin-content']` 前缀） |
| `admin-content` + `THOUGHT` | Thoughts 列表 `adminContent({ kind: 'THOUGHT' })` | 同上 |
| `admin-content` + `THOUGHT` + `PUBLISHED` | Settings 的置顶 Thought 选项 | 同上 |
| `admin-profile` | `adminProfile()` | 保存 Profile |
| `admin-site` | `adminSite()` | 保存 Site |
| `admin-thought-config` | `adminThoughtConfig()` | 保存 Thoughts 置顶配置 |

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

根目录 `pnpm browser-test` 会启动隔离 Core/Web/Admin，验证登录、stats、反应、评论提交与回复、软删除和恢复。

## 7. 修改规则

修改工作区 API、字段或状态时：

1. 先更新 `packages/contracts` 和 `packages/sdk`，再更新工作区。
2. 同步本文、`docs/core.md` 和 Web 文档中受影响的调用方。
3. 更新对应 query key、错误态、loading 态和浏览器验收。
4. 新增依赖时记录用途、包体和替代方案；当前 Markdown 依赖的用途见 `docs/decisions/web.md`。

管理控件优先使用 Mantine/Lucide，保持键盘访问、loading、error、empty 状态；设计令牌遵循 `docs/design-system/`。
