# Core 当前契约

> 本文是 `app/core` 当前实现的权威说明。API、数据模型、配置、错误、缓存和审计发生变化时，必须在同一变更中更新本文。历史方案放在 `docs/decisions/`，不应覆盖本文的运行时事实。

## 1. 背景与边界

`app/core` 是 Manifold 唯一的后端服务和业务数据所有者。它为公开 Web 和私有 Admin 提供 REST/JSON API，并负责 SQLite、鉴权、内容生命周期、评论审核、访客反应、匿名在线 Presence、统计、缓存和审计。

Core 不负责页面布局、Markdown HTML 展示、浏览器状态、Admin 表单或 PWA。Web/Admin 只能通过 `packages/sdk` 访问 Core，不能读 SQLite 或导入 Core 的 Go 内部包。

当前产品范围：Home、Thoughts、Writings、Profile、Site、Now、Comments、Reactions、匿名 Presence、Stats。内容只有 `THOUGHT` 与 `ARTICLE` 两种类型；Projects、Technology、Manuscript、ResearchSeries 等是历史或未来规划，不是当前运行时 API。

## 2. 架构

```text
HTTP
  |
  v
chi Router
  ├─ request/trace ID middleware
  ├─ CORS
  ├─ public handlers
  └─ /api/v1/admin -> JWT + Casbin
          |
          v
      apiHandler
  ├─ validator/v10
  ├─ ContentCache / StatsCache
  ├─ store.Store
  └─ events.AuditPublisher
          |
          +--> modernc.org/sqlite
          +--> bounded audit queue -> audit_events
```

| 层 | 当前实现 | 责任 |
| --- | --- | --- |
| HTTP | Go `net/http`、Chi | 路由、中间件、状态码和响应头 |
| 校验 | `go-playground/validator/v10` + handler 业务校验 | JSON 边界、枚举、长度、metadata 和版本规则 |
| 鉴权 | HS256 JWT + Casbin | 单一 `admin` 角色，保护 `/api/v1/admin/*` |
| 数据 | SQLite、`modernc.org/sqlite` | schema、迁移、种子、查询和写入 |
| 缓存 | expirable LRU | 内容详情和统计 TTL 快照 |
| 审计 | 有界 channel + worker | 异步写入非关键审计事件，支持关闭 drain |

### 目录职责

```text
app/core/
├── cmd/server/main.go              # 配置、数据库、HTTP server、优雅关闭
├── internal/config/config.go       # CORE_* 环境变量
├── internal/handler/response.go    # 路由、handler、错误、分页和校验
├── internal/auth/auth.go           # bcrypt、JWT、Casbin
├── internal/model/content.go       # Core 领域 JSON model
├── internal/store/store.go         # SQLite 初始化、迁移、种子和 CRUD
├── internal/cache/                 # 内容/统计缓存
├── internal/events/                # 审计发布器和 worker
├── db/schema.sql                   # schema 对照文件
└── Dockerfile
```

运行时 schema 由 `internal/store/store.go` 初始化；修改表结构时必须同步 `app/core/db/schema.sql`、迁移逻辑和迁移测试。

## 3. 运行配置

Core 使用 `caarlos0/env` 读取 `CORE_` 前缀变量，不自动读取仓库根目录 `.env`。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CORE_ADDR` | `:8080` | HTTP 监听地址 |
| `CORE_DATABASE_PATH` | `./data/manifold.db` | SQLite 路径，父目录自动创建 |
| `CORE_ALLOWED_ORIGINS` | `http://localhost:3000,http://localhost:5173` | CORS 来源，逗号分隔 |
| `CORE_JWT_SECRET` | `manifold-dev-secret-change-me` | HS256 密钥，生产必须替换 |
| `CORE_ADMIN_USERNAME` | `admin` | 管理用户名 |
| `CORE_ADMIN_PASSWORD_HASH` | 内置 bcrypt hash | 管理密码 hash |
| `CORE_CONTENT_CACHE_TTL` | `30s` | 内容详情缓存 TTL |
| `CORE_STATS_CACHE_TTL` | `30s` | 统计缓存 TTL |
| `CORE_AUDIT_EVENT_BUFFER` | `256` | 审计队列容量 |

默认开发账号为 `admin` / `password`，仅用于本地联调。

## 4. HTTP 通用约定

- 基础路径为 `/api/v1`，媒体类型为 JSON。
- 时间为 UTC RFC3339 字符串，ID 为不透明字符串。
- 每个请求都有 `X-Request-ID` 和 `X-Trace-ID`；客户端可传入 `X-Trace-ID`，Core 会校验/生成并回传。
- CORS 允许 `GET/POST/PUT/PATCH/DELETE/OPTIONS`，请求头包括 `Authorization`、`Content-Type`、`Idempotency-Key`、`X-Trace-ID`、`X-Visitor-ID`。
- 集合响应统一为 `{ data, pagination }`；`nextCursor` 是不透明 cursor，默认 `limit=20`，最大 50。
- 错误统一为：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid content input.",
    "requestId": "req_...",
    "traceId": "trace_..."
  }
}
```

常见状态码：`400` 查询/访客参数无效，`401` JWT 缺失或无效，`403` 角色无权限，`404` 不存在或对调用者不可见，`409` 唯一键/版本冲突，`422` 输入校验失败，`500` 服务端故障。

## 5. 公开 API

公开读取不需要认证；草稿和软删除内容永远不可见。

| 方法 | 路径 | 返回/行为 |
| --- | --- | --- |
| `GET` | `/healthz` | `{ status: "ok", version }` |
| `GET` | `/api/v1/profile` | `Profile`，包含身份、教育/经历、个人 `series` 和 `contacts` |
| `GET` | `/api/v1/site` | 首页 profile 引用、精选内容、导航和 sections |
| `GET` | `/api/v1/feed` | 内容集合，使用与 `/content` 相同的筛选 |
| `GET` | `/api/v1/content` | 已发布内容摘要集合，包含 `viewCount` 和 `likeCount` 聚合值 |
| `GET` | `/api/v1/content/{slug}` | 通过 slug 或 ID 返回已发布详情和 Markdown body；默认记录一次 `content.viewed` 审计事件，内部 metadata 请求可传 `trackView=false` 跳过计数 |
| `GET` | `/api/v1/content/{slug}/comments` | 只返回 `APPROVED` 评论 |
| `POST` | `/api/v1/content/{slug}/comments` | 创建 `PENDING` 评论，201 |
| `GET` | `/api/v1/content/{slug}/reactions` | 反应统计和当前访客状态 |
| `PUT` | `/api/v1/content/{slug}/reactions/{kind}` | 添加 `LIKE`/`FAVORITE`，200 |
| `DELETE` | `/api/v1/content/{slug}/reactions/{kind}` | 移除反应，200 |
| `GET` | `/api/v1/now` | `NowStatus` |
| `GET` | `/api/v1/stats` | 已发布统计 `Stats` |
| `POST` | `/api/v1/presence` | 使用 `X-Visitor-ID` 更新匿名心跳，返回最近 5 分钟活跃访客数 |

内容列表参数：

```text
kind=THOUGHT|ARTICLE   # 可重复或逗号分隔
tag=systems             # 标签
q=boundary              # 标题/摘要/正文搜索
cursor=<opaque>
limit=1..50
```

评论输入：`body` 必填且最多 4000 字符；`authorName` 最多 80 字符，可空时归一化为 `Anonymous`；`authorUrl` 和 `replyToId` 可选。

反应请求必须使用 `X-Visitor-ID`，长度 8 到 128，只允许字母、数字、`_`、`-`。PUT/DELETE 对 `(content, visitor, kind)` 幂等。

## 6. Admin API

`POST /api/v1/admin/session` 使用用户名和 bcrypt 密码登录，返回 12 小时 HS256 JWT。除登录接口外，所有 Admin 请求都需要 `Authorization: Bearer <token>`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET/PATCH` | `/api/v1/admin/profile` | 读取/更新 Profile、简历、兴趣、教育、经历、个人 Series 和联系方式 |
| `GET/PATCH` | `/api/v1/admin/site` | 读取/更新首页 composition |
| `GET` | `/api/v1/admin/content` | 管理内容列表，支持 `kind`、`status`、`tag`、`q`、cursor，并返回 `viewCount` / `likeCount` |
| `POST` | `/api/v1/admin/content` | 创建 DRAFT |
| `PATCH` | `/api/v1/admin/content/{id}` | 局部更新和类型转换 |
| `POST` | `/api/v1/admin/content/{id}/publish` | DRAFT -> PUBLISHED |
| `POST` | `/api/v1/admin/content/{id}/unpublish` | PUBLISHED -> DRAFT |
| `DELETE` | `/api/v1/admin/content/{id}` | 软删除，204 |
| `GET` | `/api/v1/admin/comments` | 按状态读取评论，默认 PENDING |
| `POST` | `/api/v1/admin/comments/{id}/approve` | APPROVED，204 |
| `POST` | `/api/v1/admin/comments/{id}/reject` | REJECTED，204 |
| `GET` | `/api/v1/admin/now` | 读取 Now |
| `PUT` | `/api/v1/admin/now` | 更新 Now |
| `GET` | `/api/v1/admin/stats` | `AdminStats`，包含 `content` 和 `pendingComments` |

内容创建的 Article 必须有非空 `title` 和 `slug`；Thought 两者可为空。PATCH 必须提供 `expectedVersion`，版本不匹配返回 `409 VERSION_CONFLICT`。类型转换为 Article 时，最终 title/slug 也必须满足 Article 规则。

## 7. 数据模型

`content` 是统一内容表：

| 字段 | 约束 |
| --- | --- |
| `id` | 主键 |
| `kind` | `THOUGHT` 或 `ARTICLE` |
| `status` | `DRAFT`、`PUBLISHED`、`DELETED` |
| `slug` | 可空、唯一；Article 必填，Thought 默认用 ID 访问 |
| `title` | 可空；Article 必填 |
| `summary/body/tags_json/metadata_json` | Markdown、标签和类型 metadata |
| `published_at/created_at/updated_at/version` | 生命周期、时间和乐观并发 |
| `view_count` | 公开详情读取时同步递增的持久化浏览量 |

Metadata：Thought 使用 `mood/question/context/source`；Article 使用 `readingMinutes/toc/frontmatter/technologies/language/difficulty/repositoryUrl`。保存 ARTICLE 时 Core 会根据 Markdown body 覆盖计算 `readingMinutes`（约 200 个词/分钟，至少 1 分钟）并从二、三级标题重建 `toc`；编辑端不应手工提交这两个派生字段。Core 仍会校验 metadata 的类型、长度、TOC 层级、技术标签和难度枚举。

其他表：`profile`、`site_config`、`now_status`、`comments`、`reactions`、`presence`、`audit_events`。`content.view_count` 在公开详情读取时同步原子递增，列表响应直接返回该持久化计数；`likeCount` 从 `reactions` 聚合 `LIKE`。详情读取同时写入 `audit_events(event_name = 'content.viewed', resource_type = 'content')` 供观测使用，审计队列丢弃不会影响浏览量统计。Profile 包含 `resume_url`、`interests_json`、`education_json`、`experience_json`、`series_json`、`contacts_json`；Series 项为 `{name,url,description,category?}`，联系方式为 `{label,url,handle?,icon?}`；Site 是单例配置；评论默认 PENDING；反应有 `(content_id, visitor_id, kind)` 唯一约束；Presence 只保存匿名 visitor ID 的最近心跳时间，过期窗口为 5 分钟。

旧 SQLite content 类型迁移规则：`POST/RESEARCH/TECH/MANUSCRIPT -> ARTICLE`，`NOTE -> THOUGHT`，并重建 kind CHECK 约束。迁移必须保持可重复执行。

## 8. 缓存、审计和关闭

- 内容详情使用最多 256 项的 TTL LRU；Core 启动时预热 Site 精选内容。
- Stats 使用单条 TTL 快照；内容创建、更新、发布、撤回和删除会清理相关缓存。
- 审计事件通过有界异步队列写入 `audit_events`；队列满会记录丢弃但不让业务请求失败。
- `RouterWithLifecycle` 用于生产入口，关闭时最多等待 5 秒排空已接受事件；`Router` 仅用于同步内部调用/测试。

## 9. 修改与验证清单

修改 Core 时必须检查：

- 路由/字段/状态码是否需要同步 `packages/contracts`、`packages/sdk`、`docs/admin.md`、`docs/decisions/web.md`。
- schema 是否同时修改 `app/core/db/schema.sql`、内嵌 schema、迁移和测试。
- 缓存、审计、鉴权、CORS、配置或错误语义是否需要更新本文。

```bash
cd app/core && go test -count=1 ./... && go vet ./...
cd ../..
pnpm check
pnpm test
pnpm build
pnpm browser-test
git diff --check
```
