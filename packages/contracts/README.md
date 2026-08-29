# `@manifold/contracts`

`@manifold/contracts` 是 Manifold Web、Admin、SDK 共享的 TypeScript 公共契约。它只描述跨进程可见的请求、响应和枚举，不包含 Core 的数据库实现、React 组件或业务计算。

## 边界

```text
app/core JSON <--> packages/contracts <--> packages/sdk <--> Web / Admin
```

- Core 的 Go model 和 handler 决定运行时行为。
- Contracts 把运行时 JSON 形状表达为 TypeScript 类型。
- SDK 使用这些类型约束 HTTP 方法的输入和输出。
- Web/Admin 不应自行声明同名的 API 类型或通过 `any` 绕过契约。

## 导出类型

### 内容

- `ContentKind = "THOUGHT" | "ARTICLE"`
- `ContentStatus = "DRAFT" | "PUBLISHED" | "DELETED"`
- `ContentSummary`：列表和轻量内容对象，`slug`、`title` 可为空，并包含 Core 从 Markdown 正文派生的可选纯文本 `excerpt`、聚合的 `viewCount`、`likeCount` 与未软删 `commentCount`。`summary` 与 `excerpt` 语义独立。
- `Content`：公开摘要对象，不含完整 `body`，并按 `kind` 判别 metadata。
- `AdminContent`：管理端内容对象，包含完整 Markdown `body`。
- `ContentDetail`：详情对象，`body` 必填。
- `ContentInput`：创建输入的判别联合：Thought 和 Article 使用不同 metadata。
- `UpdateContentInput`：带必填 `expectedVersion` 的局部更新，可改变 `kind` 和 `slug`。
- `ThoughtArchive` / `ThoughtArchiveQuery`：Core 计算的置顶 Thought、非置顶归档页和页码参数；`ThoughtArchiveQuery` 额外接受 `tag`/`q`，只过滤时间轴，不影响置顶。`tag` 支持单值或多值（`string[]`），多值按 OR（命中任一标签）过滤。
- `ThoughtConfig` / `ThoughtConfigInput`：可空 `featuredThoughtId` 的 Admin 配置读写契约。
- `TagQuery` / `TagSummary`：`/api/v1/tags` 的可选 `kind` 参数和 `{ name, count }` 聚合项。

Article 的 `ArticleMetadata` 字段：

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| `readingMinutes` | `number` | Core 根据文章正文计算的阅读时长 |
| `toc` | `{ id, label, level }[]` | Core 根据二、三级 Markdown 标题生成，`level` 只能是 2 或 3 |
| `frontmatter` | `Record<string, string>` | 独立 JSON 元数据，不是 YAML 解析结果 |
| `technologies` | `string[]` | 技术标签 |
| `language` | `string` | 文章主要语言 |
| `difficulty` | `BEGINNER \| INTERMEDIATE \| ADVANCED` | 难度 |
| `repositoryUrl` | `string` | 可选仓库地址字符串 |

Thought 的 `ThoughtMetadata` 字段为 `mood`、`question`、`context`、`source`，全部可选字符串。

### 其他公共资源

- `Profile` / `ProfileInput`：身份、简介、网站、简历、兴趣、教育、经历、个人 Series 和联系方式。`series` 使用 `{ name, url, description, category? }`，`contacts` 使用 `{ label, url, handle?, icon? }`。
- `SiteComposition` / `SiteConfig`：首页内容引用、导航和 sections。
- `Stats` / `AdminStats`：公开统计和 Admin 统计包装。
- `AdminOverview` 及其子类型：Admin 总览聚合（内容计数含草稿、浏览/点赞/评论总量、在线访客、月度趋势、Top 内容、标签分布）。
- `AnalyticsViews` / `AnalyticsViewsQuery`：去重浏览事件分析（总量、独立访客、逐日曲线、referrer Top N，`days` 默认 30 上限 90）。
- `SystemStatus`：Core 运行状态（version、startedAt、uptime、DB 体积、缓存条目、heap/goroutine/进程 RSS、`resources` 服务器资源块、`host` 主机信息块、审计事件总数）。
- `AuditEvent` / `AuditEventCollection` / `AuditQuery`：审计事件服务端分页读取（`page`/`pageSize` 默认 10 上限 50、`q` 过滤），响应附 `PagePagination`。
- `PresenceStatus`：匿名在线心跳返回的活跃访客数和观测时间；Core 只保留短期心跳，不返回访客身份。
- `Comment`、`CreateCommentInput`：评论对象与创建输入。评论无审核状态，创建即公开；`Comment` 含 `replyToId`、`avatarSeed`（访客头像种子），admin 视图额外携带 `deletedAt`。
- `CommentQuery`：公开评论列表参数。`page`（1 起）与 `limit`（每页顶层评论数）用于页码分页，`q` 按作者或正文做大小写不敏感子串搜索；`cursor` 目前为预留字段，Core 忽略。带 `page` 时响应 `pagination` 附带 `page/pageSize/totalItems/totalPages`：`totalItems` 计匹配集内全部公开评论（含回复），`totalPages` 按匹配的顶层评论计。搜索为线程级命中——任一评论命中即整条线程（顶层加全部回复）返回；分页只作用于顶层评论，回复永远随其顶层同页。
- `LikeSummary`：文章点赞统计和当前访客状态。
- `Collection<T>`、`Pagination`：统一列表响应。`Pagination` 在 cursor 模式为 `{ nextCursor, hasMore }`；使用 `page` 参数时额外返回 `page/pageSize/totalItems/totalPages`。
- `PagePagination`：Thoughts aggregate 使用的 `page/pageSize/totalItems/totalPages` 页码响应。
- `ContentQuery`、`AdminContentQuery`：服务端筛选和分页参数。`ContentQuery` 支持 `kind`、`tag`（单值或多值 `string[]`，多值按 OR 命中任一标签）、`q`、cursor 或 `page`（互斥）、`sort = "newest" | "oldest" | "updated"`、`aiAssisted` 布尔过滤和 `skipFirst`（仅 `page` 模式，列表跳过排序后的第一条）。
- `ApiErrorBody`：Core 结构化错误响应字段；SDK 的运行时 `ApiError` 见 [`packages/sdk/README.md`](../sdk/README.md)。

## 契约规则

1. 时间戳使用 Core 返回的 UTC RFC3339 字符串；客户端不得重新定义时间格式。
2. `Collection<T>` 的 `pagination.nextCursor` 是不透明字符串，只能原样转发。
3. `ContentInput` 与 `Content` 的 metadata 必须通过 `kind` 判别，不能把 Thought 和 Article 合并成无约束的 `Record<string, unknown>`。
4. Core 仍会做最终校验：Article 创建/转换需要 title 和 slug；更新需要 `expectedVersion`。
5. 可选字段的 `undefined`、`null` 和空字符串由具体 API 约定决定，新增字段必须明确是否向后兼容。

## 修改流程

修改 `src/index.ts` 时：

1. 先确认 Core JSON 真实响应和错误语义。
2. 更新类型和本 README 的字段/枚举说明。
3. 更新 `packages/sdk/README.md`、SDK 方法和测试。
4. 检查 `docs/core.md`、`docs/admin.md`、`docs/decisions/web.md` 及调用方。
5. 运行 `pnpm --filter @manifold/contracts typecheck`、`pnpm check` 和 `pnpm test`。

不要在这里只记录尚未实现的规划资源；规划内容应放到 `docs/decisions/` 并明确状态。

## 命令

| 命令 | 作用 |
| --- | --- |
| `pnpm --filter @manifold/contracts typecheck` | 检查公共类型 |
| `pnpm --filter @manifold/contracts test` | 当前等价于 TypeScript 检查 |
