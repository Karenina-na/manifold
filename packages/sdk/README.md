# `@manifold/sdk`

`@manifold/sdk` 是 Web/Admin 调用 Core 的唯一 HTTP 客户端。它基于原生 `fetch`，负责 URL 编码、JSON 序列化、Bearer token、追踪 ID、204 响应和结构化 `ApiError`；它不负责 React 状态、缓存、重试策略或业务展示。

## 使用边界

```ts
const client = new ManifoldClient({ baseUrl: coreUrl, token })
const page = await client.content({ kind: "ARTICLE", limit: 20 })
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

1. 以 `baseUrl + path` 组合 URL。
2. 设置 `Accept: application/json`。
3. 生成并发送 `X-Trace-ID`。
4. 有 body 时设置 `Content-Type: application/json` 并 `JSON.stringify`。
5. 有 token 时设置 `Authorization: Bearer <token>`。
6. 将数组 query 参数以逗号连接，跳过 `undefined`、`null` 和空字符串。
7. 非 2xx 解析 Core 的 `{ error: ... }`；204 返回 `undefined`；其他成功响应解析 JSON。

## 方法清单

### 公开 API

| 方法 | HTTP | Core 路径 | 返回 |
| --- | --- | --- | --- |
| `health()` | GET | `/healthz` | `HealthStatus` |
| `profile()` | GET | `/api/v1/profile` | `Profile` |
| `site()` | GET | `/api/v1/site` | `SiteComposition` |
| `feed(query?)` | GET | `/api/v1/feed` | `Collection<Content>` |
| `content(query?)` | GET | `/api/v1/content` | `Collection<Content>`，内容项包含 `viewCount` / `likeCount` |
| `contentBySlug(slug, options?)` | GET | `/api/v1/content/:slug` | `ContentDetail`；`{ trackView: false }` 用于不计入浏览量的 metadata 读取 |
| `now()` | GET | `/api/v1/now` | `NowStatus` |
| `stats()` | GET | `/api/v1/stats` | `Stats` |
| `presence(visitorId)` | POST | `/api/v1/presence` | `PresenceStatus` |
| `comments(slug, query?)` | GET | `/api/v1/content/:slug/comments` | `Collection<Comment>` |
| `createComment(slug, input)` | POST | `/api/v1/content/:slug/comments` | `Comment` |
| `likes(slug, visitorId?)` | GET | `/api/v1/content/:slug/likes` | `LikeSummary` |
| `setLike(slug, visitorId, enabled)` | PUT/DELETE | `/api/v1/content/:slug/likes` | `LikeSummary` |

### Admin API

| 方法 | HTTP | Core 路径 | 返回 |
| --- | --- | --- | --- |
| `login(input)` | POST | `/api/v1/admin/session` | `LoginResponse` |
| `adminStats()` | GET | `/api/v1/admin/stats` | `AdminStats` |
| `adminProfile()` / `updateProfile(input)` | GET/PATCH | `/api/v1/admin/profile` | `Profile` |
| `adminSite()` / `updateSite(input)` | GET/PATCH | `/api/v1/admin/site` | `SiteConfig` |
| `adminContent(query?)` | GET | `/api/v1/admin/content` | `Collection<Content>`，内容项包含 `viewCount` / `likeCount` |
| `createContent(input)` | POST | `/api/v1/admin/content` | `Content` |
| `updateContent(id, input)` | PATCH | `/api/v1/admin/content/:id` | `Content` |
| `publishContent(id)` / `unpublishContent(id)` | POST | `/publish` `/unpublish` | `Content` |
| `deleteContent(id)` | DELETE | `/api/v1/admin/content/:id` | `void`，204 |
| `adminComments(status?)` | GET | `/api/v1/admin/comments` | `Collection<Comment>` |
| `approveComment(id)` / `rejectComment(id)` | POST | `/api/v1/admin/comments/:id/*` | `void`，204 |
| `updateNow(input)` | PUT | `/api/v1/admin/now` | `NowStatus` |

SDK 当前没有自动提供重试、轮询、分页迭代器或 token refresh；这些职责由调用方的 React Query、Server Component 或 session 层承担。

## 错误模型

`ApiError` 字段：`status`、`code`、`message`、可选 `details`、`requestId`、`traceId`。

```ts
try {
  await client.updateContent(id, input)
} catch (error) {
  if (error instanceof ApiError && error.code === "VERSION_CONFLICT") {
    // 重新读取内容并让用户决定如何合并
  }
}
```

响应 body 不是合法 JSON 时，SDK 使用 `REQUEST_FAILED` 和 HTTP status 生成兜底错误；不要在 UI 中依赖服务端英文 message，优先使用稳定 `code`。

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
