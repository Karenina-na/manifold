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
- 一致性由跨层测试锁定：Core 的 handler/store API 测试覆盖运行时 JSON 形状；本包的 `test/fixtures.test.ts` 断言 `test/fixtures/wire.json` 满足共享类型。

## 空值语义（全契约统一）

- `?:` 仅表示"该视图不携带此概念"（如 `body` 仅详情视图、`deletedAt` 仅管理端评论）。
- `| null` 表示"概念存在但值可空"；Core 一律输出键并以 `null` 表达空值，不再省略键。

## 导出类型

### 内容

- `ContentKind = "THOUGHT" | "ARTICLE"`
- `ContentStatus = "DRAFT" | "PUBLISHED" | "DELETED"`
- `Content`：公开内容对象（列表与详情共用基底）。所有内容统一 slug 寻址（`slug` 必填）；`title: string | null`（Thought 可无标题）；`publishedAt: string` 非空（公开视图仅含已发布内容）；不含 `status`/`version`/`href`——公开内容恒为已发布、版本号是管理端锁概念、URL 由 Web 端按路由拼接。
- `ContentDetail = Content & { body }`：公开详情，含完整 Markdown 正文。
- `AdminContent`：管理端全状态视图（`status`、`publishedAt: string | null`（草稿未发布）、乐观锁 `version`、`body`）。
- `ContentInput`：创建输入的判别联合（`kind` 与 metadata 绑定）。`slug` 必填；metadata 使用 `ThoughtMetadataInput`/`ArticleMetadataInput`。
- `ThoughtMetadataInput`：`mood`/`question`/`context`/`source` 均为必需键，值可为字符串或 `null`。
- `ArticleMetadataInput`：`language: string | null` 与 `aiAssisted: boolean`。`readingMinutes`/`toc` 是 Core 保存时从正文派生的字段，只出现在响应 `ArticleMetadata` 中，不接受客户端输入。
- `UpdateContentInput`：判别联合的全量替换输入，`kind` 与 `metadata` 类型绑定，`expectedVersion` 必填。
- `ContentQuery`：`kind`（单值或多值 `string[]`，多值 OR）、`tag`（同上）、`q`、`page`/`pageSize`、`sort = "newest" | "oldest" | "updated"`、`aiAssisted`。
- `AdminContentQuery extends ContentQuery`：追加 `status`。
- `ContentDetailQuery`：公开详情参数 `trackView`（默认 true，传 `false` 关闭浏览计数）、`referrer`。
- `ThoughtConfig` / `ThoughtConfigInput`：可空 `featuredThoughtId` 的 Admin 配置读写契约。
- `WritingConfig` / `WritingConfigInput`：可空 `featuredWritingId` 的 Admin 配置读写契约。
- `TagQuery` / `TagSummary`：`/api/v1/tags` 的可选 `kind` 参数和 `{ name, count }` 聚合项。
- `Media` / `MediaQuery`：管理端媒体对象（`url` 为绝对地址，写入 Markdown 正文使用）与媒体库列表参数。
- `MediaReference`：媒体被内容引用时的引用条目 `{ contentId, kind, title, slug, status }`，出现在 `DELETE /admin/media/{id}` 的 409 `MEDIA_IN_USE` 错误 `details.references` 中，也作为 `GET /admin/media/{id}/references` 的 `{ references: [...] }` 返回项；`status` 只可能是 `DRAFT`/`PUBLISHED`（引用查询已排除已删除内容）。
- `ChangePasswordInput`：`POST /admin/password` 请求体 `{ currentPassword, newPassword }`（新密码 ≥8 字符）。

响应端 `ArticleMetadata`：`readingMinutes`、`toc`、`language`、`aiAssisted`；前两项由 Core 派生。响应端 `ThoughtMetadata`：`mood`/`question`/`context`/`source` 全部输出，可空值用 `null`。

### 分页（唯一模型）

- `Pagination = { page, pageSize, totalItems, totalPages }`：全部列表端点使用同一页码分页模型，不再有 cursor 语义。
- `Collection<T> = { data, pagination }`：统一列表响应信封。

### 其他公共资源

- `Profile` / `ProfileInput`：身份、简介、网站、简历、兴趣、教育（`ProfileEducationItem`）、经历（`ProfileExperienceItem`）、个人 Series（`ProfileSeriesItem`）和联系方式（`ProfileContact`）。数组字段全部必填键（可为空数组），`resumeUrl: string | null`。
- `SiteConfig` / `SiteConfigInput`：站点设置（Admin 读写），含 `title`（必填 ≤80）/`description`（≤200）/`footer`（≤200）/`social`（≤6 项）/`commentsEnabled`/`navigation`（1..10 项）/`sections`（1..10 项，`HomepageSection` 枚举）。
- `SiteComposition extends SiteConfig`：公开 `GET /api/v1/site` 响应，追加按 kind 限定的 `featuredThought` 与 `featuredWriting`（置顶内容随站点组合下发）。
- `Stats` / `AdminStats`：公开统计和 Admin 统计包装。
- `AdminOverview` 及其子类型：Admin 总览聚合。
- `AnalyticsViews` / `AnalyticsViewsQuery`：去重浏览事件分析（`days` 默认 30 上限 90）。
- `SystemStatus`：Core 运行状态。
- `AuditEvent` / `AuditEventCollection` / `AuditQuery`：审计事件（含 `requestId`/`traceId: string | null` 关联键），`page`/`pageSize` 分页。
- `PresenceStatus`：匿名在线心跳。
- `Comment`：公开评论。`authorUrl`/`replyToId` 可空值用 `null`；`avatarSeed` 必有；`hidden` 标记被隐藏的评论。隐藏行仍保留线程位置，但公开响应会清空作者名、网站、正文和头像种子；软删时间 `deletedAt` 仅出现在管理端视图。
- `AdminComment extends Comment`：管理端评论视图，追加 `deletedAt: string | null`、`hiddenAt: string | null` 与所属内容 `contentTitle`/`contentSlug`/`contentKind`；内容外键和 slug 均为数据库非空约束。
- `CreateCommentInput`：评论创建输入。
- `UpdateCommentInput`：管理员覆盖评论作者资料的部分更新输入；`authorUrl: null` 显式清空网站。
- `CommentQuery`：公开评论参数 `page`/`pageSize`/`q`；分页只作用于顶层评论，回复永远随其顶层同页。
- `AdminCommentQuery`：管理评论参数 `contentId`/`q`/`page`/`pageSize`/`focus`。
- `LikeSummary`：点赞统计和当前访客状态。
- `ApiErrorBody`：Core 结构化错误响应字段；SDK 的运行时 `ApiError` 见 [`packages/sdk/README.md`](../sdk/README.md)。

## 契约规则

1. 时间戳使用 Core 返回的 UTC RFC3339 字符串；客户端不得重新定义时间格式。
2. `ContentInput`/`UpdateContentInput` 与响应的 metadata 必须通过 `kind` 判别，不能把 Thought 和 Article 合并成无约束的 `Record<string, unknown>`。
3. Core 仍会做最终校验：slug 全局唯一且创建时必填；更新需要 `expectedVersion`；Article 语义要求 `title` 非空。
4. 修改任何导出类型时，同步更新本 README 与 `test/fixtures/wire.json`，保持 Go golden 测试与 TS fixtures 测试同时通过。

## 修改流程

修改 `src/index.ts` 时：

1. 先确认 Core JSON 真实响应和错误语义。
2. 更新类型、本 README 的字段/枚举说明与 `test/fixtures/wire.json`。
3. 更新 `packages/sdk/README.md`、SDK 方法和测试。
4. 检查 `docs/core.md`、`docs/admin.md`、`docs/decisions/web.md` 及调用方。
5. 运行 `pnpm --filter @manifold/contracts test`、`pnpm check` 和 `pnpm test`。

不要在这里只记录尚未实现的规划资源；规划内容应放到 `docs/decisions/` 并明确状态。

## 命令

| 命令 | 作用 |
| --- | --- |
| `pnpm --filter @manifold/contracts typecheck` | 检查公共类型 |
| `pnpm --filter @manifold/contracts test` | fixtures 类型断言 + TypeScript 检查 |
