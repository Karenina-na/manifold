# `@manifold/sdk`

`@manifold/sdk` 是 Web/Admin 调用 Core 的唯一 HTTP 客户端。它基于原生 `fetch`，负责 URL 编码、JSON 序列化、Bearer token、追踪 ID、204 响应和结构化 `ApiError`；它不负责 React 状态、缓存、重试策略或业务展示。

## 使用边界

```ts
const client = new ManifoldClient({ baseUrl: coreUrl, token })
const page = await client.content({ kind: "ARTICLE", pageSize: 20 })
```

- Web Server Component 使用无缓存 fetch 创建 client。
- Web Client Component 和 Admin 使用浏览器默认 fetch，并由 TanStack Query 管理缓存。
- SDK 不读取 SQLite、不保存 token、不决定权限，也不替调用方刷新 session。
- 输入输出类型全部来自 `@manifold/contracts`。

## 配置与请求生命周期

`ManifoldClientOptions`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `baseUrl` | `string` | Core 地址，构造时移除末尾 `/` |
| `fetch` | `typeof fetch` | 可选注入，用于 Next Server、测试或自定义 transport |
| `token` | `string` | 可选 Bearer token |

每次请求：

1. 以 `baseUrl + path` 组合 URL；所有路径段一律经 `encodeURIComponent` 编码。
2. 设置 `Accept: application/json`。
3. 生成并发送 `X-Trace-ID`。
4. 有 body 时设置 `Content-Type: application/json` 并 `JSON.stringify`；body 为 `Blob` 时按二进制透传（仅当 Blob 携带类型时设置 `Content-Type`）。
5. 有 token 时设置 `Authorization: Bearer <token>`。
6. 将数组 query 参数以逗号连接，跳过 `undefined`、`null` 和空字符串。
7. 非 2xx 解析 Core 的 `{ error: ... }`；204 返回 `undefined`；其他成功响应解析 JSON。

## 方法清单

### 公开 API

| 方法 | HTTP | Core 路径 | 返回 |
| --- | --- | --- | --- |
| `health()` | GET | `/healthz` | `HealthStatus` |
| `profile()` | GET | `/api/v1/profile` | `Profile` |
| `site()` | GET | `/api/v1/site` | `SiteComposition`（站点设置 + `pinnedThoughts`/`pinnedWritings` 置顶内容数组） |
| `homeTimeline(query?)` | GET | `/api/v1/home/timeline` | `HomeTimeline`，取最新 `limit` 条后按首发时间升序返回首页 Updates 的轻量项（仅 `id/kind/slug/title/summary/publishedAt`）；`limit` 默认和上限 1000，响应以 `totalItems`/`truncated` 标记截断 |
| `content(query?)` | GET | `/api/v1/content` | `Collection<Content>`，唯一公共列表面；`query` 支持 `kind`（单值或多值 `string[]`，数组序列化为逗号分隔，多值按 OR 命中任一标签）、`tag`（同上）、`q`、`page`/`pageSize`（页码分页）、`sort`、`aiAssisted` |
| `tags(query?)` | GET | `/api/v1/tags` | `Collection<TagSummary>` 标签聚合，`query` 支持 `kind = "THOUGHT" \| "ARTICLE"` |
| `contentBySlug(slug, query?, visitorId?)` | GET | `/api/v1/content/:slug` | `ContentDetail`；`query: { trackView: false }` 关闭浏览计数（默认计入），`referrer` 传 origin 形式的来源供浏览事件分析；`visitorId` 附带 `X-Visitor-ID` 供 Core 按"同人同内容同 UTC 日"去重浏览事件 |
| `stats()` | GET | `/api/v1/stats` | `Stats` |
| `presence(visitorId)` | POST | `/api/v1/presence` | `PresenceStatus` |
| `comments(slug, query?)` | GET | `/api/v1/content/:slug/comments` | `Collection<Comment>`，`query` 支持 `page`（1 起）、`pageSize`（每页顶层评论数）和 `q`（按作者或正文搜索，线程级命中）；分页只作用于顶层评论，回复随其顶层同页返回 |
| `createComment(slug, input)` | POST | `/api/v1/content/:slug/comments` | `Comment` |
| `likes(slug, visitorId?)` | GET | `/api/v1/content/:slug/likes` | `LikeSummary` |
| `setLike(slug, visitorId, enabled)` | PUT/DELETE | `/api/v1/content/:slug/likes` | `LikeSummary` |
| `authMe()` | GET | `/api/v1/auth/me` | `AuthMeResponse`；未带 visitor 凭据时 `authenticated=false` 并返回 `providers`（已配置的第三方登录） |
| `exchangeGitHub(input)` | POST | `/api/v1/auth/github/exchange` | `GitHubExchangeResponse`；`{ code }` 换发 visitor 会话 JWT，90 天 |

### 评论访客会话（GitHub 登录）

`ManifoldClient` 构造选项新增 `browserVisitorCookie: true`：开启后浏览器环境自动读取 `manifold-visitor` cookie（Web 端 OAuth 回调写入），并以 `Authorization: Bearer <token>` 直连 Core（浏览器直连 Core 时 cookie 域隔离，必须走 header 转递）。开启后 `createComment` 带有效会话时由 Core 服务端覆盖作者名/头像，`authMe()` 返回登录态；未开启时走匿名路径不变。服务端调用方不要开启该选项。

### 锚定链（公开，`docs/chain.md`）

| 方法 | HTTP | Core 路径 | 返回 |
| --- | --- | --- | --- |
| `chain()` | GET | `/api/v1/chain` | `ChainInfo`（height/totalAnchors/pendingAnchors/proofMode/difficulty/genesisHash/tipHash/sitePublicKey） |
| `chainAnchors(query?)` | GET | `/api/v1/chain/anchors` | `Collection<ChainAnchor>`，`query` 支持 `source`（九值枚举）/`ref`/`page`/`pageSize` |
| `chainAnchor(id)` | GET | `/api/v1/chain/anchors/{id}` | `ChainAnchor` |
| `submitAnchor(input)` | POST | `/api/v1/chain/anchors` | 202 `SubmitAnchorResponse`（`anchorId`/`subjectHash`/`status:"pending"`）；`payload` 为任意文本（≤`CORE_CHAIN_ANCHOR_MAX_BYTES`，超限 413 `PAYLOAD_TOO_LARGE`），只存哈希不存原文 |
| `chainBlocks(query?)` | GET | `/api/v1/chain/blocks` | `Collection<ChainBlockSummary>`（block_index 降序） |
| `chainBlock(id)` | GET | `/api/v1/chain/blocks/{id}` | `ChainBlockDetail`（`certIds` + 内含 `anchors`） |
| `verifyByHash(hash)` | GET | `/api/v1/chain/verify?hash=…` | `VerifyResponse`（64 位 hex） |
| `verifyPayload(payload)` | POST | `/api/v1/chain/verify` | `VerifyResponse`；Core 按原字节重算哈希后查证，客户端不做任何哈希 |
| `verifyContent(slug)` | GET | `/api/v1/chain/verify/content/{slug}` | `VerifyResponse`；仅 PUBLISHED 内容，Core 从 live 行重建 canonical payload |
| `verifyComment(id)` | GET | `/api/v1/chain/verify/comment/{id}` | `VerifyResponse`；隐藏/软删评论 404 |
| `chainKeys()` | GET | `/api/v1/chain/keys` | `{ keys: ChainPublicKey[] }` 站点公钥列表 |

### Admin API

| 方法 | HTTP | Core 路径 | 返回 |
| --- | --- | --- | --- |
| `login(input)` | POST | `/api/v1/admin/session` | `LoginResponse` |
| `logoutSession()` | POST | `/api/v1/admin/session/logout` | `void`，204；吊销当前会话（token 立即失效） |
| `logoutSessionById(id)` | POST | `/api/v1/admin/session/{id}/logout` | `void`，204；按 id 吊销当前用户的指定会话（来自 `adminSessions()` 列表），吊销后该行从列表软删除 |
| `logoutAllSessions()` | POST | `/api/v1/admin/session/logout-all` | `void`，204；吊销该用户除当前外所有会话 |
| `changePassword(input)` | POST | `/api/v1/admin/password` | `void`，204；body `ChangePasswordInput{currentPassword,newPassword}`，成功后吊销其他会话；旧密码错误抛 `ApiError` 401 |
| `adminStats()` | GET | `/api/v1/admin/stats` | `AdminStats` |
| `adminOverview()` | GET | `/api/v1/admin/overview` | `AdminOverview`（TTL 缓存聚合） |
| `adminAnalyticsViews(query?)` | GET | `/api/v1/admin/analytics/views` | `AnalyticsViews` |
| `adminSystem()` | GET | `/api/v1/admin/system` | `SystemStatus` |
| `adminAudit(query?)` | GET | `/api/v1/admin/audit` | `AuditEventCollection`（服务端分页：`page`/`pageSize`/`q` + `pagination`） |
| `listMedia(query?)` | GET | `/api/v1/admin/media` | `Collection<Media>`（服务端分页：`page`/`pageSize`/`q`） |
| `uploadMedia(blob, filename)` | POST | `/api/v1/admin/media?filename=…` | `Media`（二进制 body，Core 按 201 返回含绝对 `url`） |
| `deleteMedia(id)` | DELETE | `/api/v1/admin/media/{id}` | `void`，204；媒体被内容引用时抛 `ApiError` 409 `MEDIA_IN_USE`（`details.references` 列出引用内容） |
| `mediaReferences(id)` | GET | `/api/v1/admin/media/{id}/references` | `MediaReferenceList`（`{ references: [...] }`，每项含 `contentId`/`kind`/`title`/`slug`/`status`） |
| `adminProfile()` / `updateProfile(input)` | GET/PUT | `/api/v1/admin/profile` | `Profile` |
| `adminSite()` / `updateSite(input)` | GET/PUT | `/api/v1/admin/site` | `SiteConfig`；`updateSite` 全量提交站点设置 |
| `adminThoughtConfig()` / `updateThoughtConfig(input)` | GET/PUT | `/api/v1/admin/thoughts/config` | `ThoughtConfig`，`pinnedIds: string[]` 整体替换置顶 |
| `adminWritingConfig()` / `updateWritingConfig(input)` | GET/PUT | `/api/v1/admin/writings/config` | `WritingConfig`，`pinnedIds` 每个 ID 必须引用已发布 ARTICLE |
| `adminContent(query?)` | GET | `/api/v1/admin/content` | `Collection<AdminContent>`，`query` 在公共过滤之上追加 `status` 与 `pinned`（布尔，仅过滤已置顶） |
| `adminContentItem(id)` | GET | `/api/v1/admin/content/{id}` | `AdminContent`，单条管理内容 |
| `createContent(input)` | POST | `/api/v1/admin/content` | `AdminContent` |
| `updateContent(id, input)` | PUT | `/api/v1/admin/content/:id` | `AdminContent`；完整替换并携带 `expectedVersion` |
| `publishContent(id)` / `unpublishContent(id)` | POST | `/publish` `/unpublish` | `AdminContent` |
| `deleteContent(id)` | DELETE | `/api/v1/admin/content/:id` | `void`，204，软删除 |
| `restoreContent(id)` | POST | `/api/v1/admin/content/:id/restore` | `AdminContent`，从软删除恢复为草稿 |
| `adminComments(query?)` | GET | `/api/v1/admin/comments` | `Collection<AdminComment>`，线程分页（`AdminCommentQuery`：`contentId`/`q`/`page`/`pageSize`/`focus`），含已软删（`deletedAt`）和隐藏时间（`hiddenAt`），行内附内容字段 |
| `adminCreateComment(contentId, input)` | POST | `/api/v1/admin/content/:id/comments` | `Comment`，201；可在草稿上创建，作者为空归一化为 `Anonymous` |
| `deleteComment(id)` | DELETE | `/api/v1/admin/comments/:id` | `void`，204，软删除 |
| `restoreComment(id)` | POST | `/api/v1/admin/comments/:id/restore` | `void`，204 |
| `hideComment(id)` / `unhideComment(id)` | POST | `/api/v1/admin/comments/{id}/hide` `/unhide` | `void`，204；隐藏与软删除正交，已删除评论返回 `COMMENT_DELETED` |
| `updateCommentAuthor(id, input)` | PUT | `/api/v1/admin/comments/{id}` | `void`，204；部分覆盖 `UpdateCommentInput`，`authorUrl: null` 清空网站 |
| `adminSubmitAnchor(input)` | POST | `/api/v1/admin/chain/anchors` | 202 `SubmitAnchorResponse`；管理员通道提交任意 payload（source = `admin`），请求体同公开通道，需 Bearer JWT |

SDK 当前没有自动提供重试、轮询、分页迭代器或 token refresh；这些职责由调用方的 React Query、Server Component 或 session 层承担。

## 错误模型

`ApiError` 字段：`status`、`code`、`message`、可选 `details`、`requestId`、`traceId`。`code` 的类型是 `ApiFailureCode = ApiErrorCode | "REQUEST_FAILED"`：`ApiErrorCode` 是 Core 的错误码契约（见 [`packages/contracts/README.md`](../contracts/README.md)），因此对 `code` 的比较和 `switch` 都受类型检查；`REQUEST_FAILED` 是 SDK 自己的兜底值。

```ts
try {
  await client.updateContent(id, input)
} catch (error) {
  if (error instanceof ApiError && error.code === "VERSION_CONFLICT") {
    // 重新读取内容并让用户决定如何合并
  }
}
```

响应 body 不是合法 JSON，或错误码不在 `ApiErrorCode` 枚举内时，SDK 使用 `REQUEST_FAILED` 和 HTTP status 生成兜底错误；不要在 UI 中依赖服务端英文 message，优先使用稳定 `code`。

## 测试与修改流程

修改 `src/index.ts` 时：

1. 先更新或确认 `packages/contracts` 类型和 `docs/core.md` API 事实。
2. 增加 URL、method、headers、body、状态码或错误字段测试到 `src/index.test.ts`。
3. 同步本 README 的方法表和调用边界。
4. 检查 Web/Admin 的 query key、错误处理和认证行为。
5. 运行 `pnpm --filter @manifold/sdk test`、`pnpm check`、`pnpm build` 和相关浏览器回归。

不要在 SDK 中添加只被一个页面使用的业务逻辑；如果 API 尚未在 Core 实现，不要先暴露一个看似可用的 client method。

## 命令

| 命令 | 作用 |
| --- | --- |
| `pnpm --filter @manifold/sdk typecheck` | TypeScript 类型检查 |
| `pnpm --filter @manifold/sdk test` | Node test runner 执行 SDK 请求测试 |
