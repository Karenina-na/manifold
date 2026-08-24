# `app/core`：Manifold Core API

## 项目背景

`app/core` 是 Manifold 的唯一后端服务和数据所有者。项目将个人资料、首页构成、内容、项目、当前状态、评论和访客反应整理成一组稳定的 HTTP 资源，让 Web、Admin 以及未来客户端共享同一套规则。

Core 面向两类调用方：

- 公开阅读端读取已发布资源，并提交评论或访客反应。
- 私有 Admin 使用 Bearer JWT 编辑配置和内容、推进状态、审核评论并读取统计。

SQLite 文件对调用方完全隐藏。Core 启动时自动创建数据库目录、建表和演示种子数据，因此本地 MVP 不依赖独立数据库服务或迁移工具。

## 职责边界

Core 负责：

- HTTP 路由、CORS、请求/追踪 ID 和统一 JSON 错误。
- 请求校验、公开资源可见性和 Admin 鉴权。
- SQLite schema、种子数据、查询、更新和并发版本控制。
- 内容发布状态、评论审核状态、反应唯一性和统计聚合。
- 内容详情缓存、统计缓存和异步审计事件。

Core 不负责：

- 页面布局、Markdown HTML 渲染和浏览器状态管理。
- Admin 表单或 Web 组件；前端只能通过 `@manifold/sdk` 访问 Core。
- 文件/媒体资产、搜索索引、经历和研究系列等尚未落地的资源。

## 技术架构

```text
HTTP request
    |
    v
chi Router
  - requestIDMiddleware
  - CORS
  - public handlers
  - /api/v1/admin -> JWT + Casbin middleware
    |
    v
apiHandler
  - validator/v10 boundary validation
  - cache.ContentCache / cache.StatsCache
  - store.Store
  - events.AuditPublisher
    |
    +--> modernc.org/sqlite (single connection)
    +--> audit queue -> SQLite audit_events
```

| 层 | 实现 | 选择原因 |
| --- | --- | --- |
| HTTP | Go `net/http` + `go-chi/chi` | 标准库服务器模型和清晰路由组合 |
| CORS | `go-chi/cors` | 明确允许来源、方法、请求头和暴露响应头 |
| 校验 | `go-playground/validator` | 在 handler 边界统一校验 |
| 鉴权 | HS256 JWT + Casbin | JWT 承载会话，Casbin 映射 `admin` 角色 |
| 数据库 | SQLite + `modernc.org/sqlite` | 单体个人站点零外部依赖，支持 `CGO_ENABLED=0` |
| 缓存 | `hashicorp/golang-lru/v2/expirable` | 内容 LRU 和统计 TTL 快照 |
| 审计 | 有界 channel + worker | 非关键副作用不阻塞原始请求 |

## 目录与模块

```text
app/core/
├── cmd/server/main.go              # 进程入口、信号处理、优雅关闭
├── internal/config/config.go       # CORE_* 环境变量解析
├── internal/handler/response.go    # 路由、handler、错误和分页辅助
├── internal/auth/auth.go           # JWT、Casbin 管理权限
├── internal/store/store.go         # SQLite 初始化、种子、查询和写入
├── internal/model/content.go       # Core 领域模型和 JSON 字段
├── internal/cache/content.go        # slug -> Content 的 TTL LRU
├── internal/cache/stats.go          # published stats 单条 TTL 快照
├── internal/events/dispatcher.go   # 异步审计队列和关闭 drain
├── db/schema.sql                    # sqlc/未来生成流程使用的 schema
├── db/queries.sql                   # 未来 sqlc 查询来源
├── sqlc.yaml                        # Go store 和 TypeScript 生成配置入口
├── tygo.yaml                        # 领域模型到 TypeScript 的生成配置入口
└── Dockerfile                       # 无 CGO Go 构建 + Alpine 运行镜像
```

`internal` 包只对 Core 可见，其他 workspace 不能导入。共享前端契约维护在 `packages/contracts`，不要把 Go 内部类型当作前端公共 API。

## 启动与配置

从仓库根目录：

```bash
pnpm install
make core-run
```

只运行 Core 测试：

```bash
cd app/core
go test ./...
go vet ./...
```

默认监听 `:8080`，默认数据库为 `./data/manifold.db`。配置通过 `CORE_` 前缀读取：

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `CORE_ADDR` | `:8080` | HTTP 监听地址 |
| `CORE_DATABASE_PATH` | `./data/manifold.db` | SQLite 文件，父目录自动创建 |
| `CORE_ALLOWED_ORIGINS` | `http://localhost:3000,http://localhost:5173` | CORS 来源列表 |
| `CORE_JWT_SECRET` | `manifold-dev-secret-change-me` | JWT HS256 密钥 |
| `CORE_ADMIN_USERNAME` | `admin` | 唯一管理账号 |
| `CORE_ADMIN_PASSWORD_HASH` | 内置 bcrypt 哈希 | 管理密码哈希 |
| `CORE_CONTENT_CACHE_TTL` | `30s` | 内容详情缓存 TTL |
| `CORE_STATS_CACHE_TTL` | `30s` | 统计缓存 TTL |
| `CORE_AUDIT_EVENT_BUFFER` | `256` | 审计队列容量 |

生产部署必须覆盖开发 JWT secret、管理密码哈希、允许来源和数据库路径。Core 不会自动读取仓库根目录的 `.env` 文件。

本地默认凭据为 `admin` / `password`；这是开发种子配置，不应直接用于生产。

Docker 镜像以非 root 用户 `manifold` 运行并暴露 `8080`：

```bash
cd app/core
docker build -t manifold-core .
docker run --rm -p 8080:8080 -e CORE_JWT_SECRET=replace-me manifold-core
```

## API 资源

### 公开接口

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| `GET` | `/healthz` | 健康检查和版本 |
| `GET` | `/api/v1/profile` | 读取 Profile |
| `GET` | `/api/v1/site` | 首页 composition 引用、导航和 sections |
| `GET` | `/api/v1/feed` | 首页内容流 |
| `GET` | `/api/v1/content` | 已发布内容摘要集合 |
| `GET` | `/api/v1/content/{slug}` | 已发布详情和 Markdown body |
| `GET` / `POST` | `/api/v1/content/{slug}/comments` | 已批准评论 / 创建 PENDING 评论 |
| `GET` | `/api/v1/content/{slug}/reactions` | 反应汇总和当前访客状态 |
| `PUT` / `DELETE` | `/api/v1/content/{slug}/reactions/{kind}` | 添加/移除 LIKE 或 FAVORITE |
| `GET` | `/api/v1/now` | 当前状态 |
| `GET` | `/api/v1/stats` | 已发布内容统计 |

内容列表支持 `kind`、`tag`、`q`、`cursor` 和 `limit`。limit 为 1 到 50，默认 20；返回 `{ data, pagination }`，cursor 是客户端只应原样转发的不透明值。

### 管理接口

`POST /api/v1/admin/session` 校验用户名和 bcrypt 密码，签发有效期 12 小时的 HS256 JWT。除登录接口外，`/api/v1/admin/*` 全部经过 Casbin `admin` 策略和 JWT middleware。

| 资源 | 管理能力 |
| --- | --- |
| Profile | 更新展示名、handle、headline、bio、头像、位置、组织和网站 |
| Site | 更新首页导航、sections 和精选内容引用 |
| Content | 创建草稿、局部更新、发布、撤回发布、软删除 |
| Comments | 按状态读取，PENDING -> APPROVED 或 REJECTED |
| Now | 更新标题、详情和 mood |
| Stats | 读取内容统计和待审核评论数 |

## 数据模型与不变量

运行时 schema 在 `internal/store/store.go` 中内嵌执行；`db/schema.sql` 是 sqlc 生成流程的源文件，当前 `db/queries.sql` 仍未接入运行时。

核心表：

- `profile`：单例 `profile_1`。
- `content`：THOUGHT / ARTICLE，分别承载轻量思考和深度文稿。Thought 的 title/slug 可为空，Article 要求 title/slug；状态 DRAFT / PUBLISHED / DELETED。`metadata_json` 保存思考来源、文稿阅读时长、TOC 和 frontmatter。
- `now_status`：单例 `now_1`，用于首页当前状态信号。
- `site_config`：单例 `site_1`，JSON 字段存储精选内容、导航和 sections。
- `comments`：关联 content，默认 PENDING，公开读取只允许 APPROVED。
- `reactions`：`(content_id, visitor_id, kind)` 唯一，避免重复反应。
- `audit_events`：保存事件、资源、actor、request ID、trace ID 和 metadata。

状态和并发规则：

1. 创建内容总是 DRAFT，发布时写入 `published_at` 并递增 version。
2. 更新内容必须提交 `expectedVersion`；版本不匹配返回 `409 VERSION_CONFLICT`。
3. 删除内容是 DELETED 软删除，公开查询永远排除草稿和已删除记录。
4. 评论提交后立即返回 201，但状态为 PENDING，不会出现在公开评论列表。
5. 反应写入使用 INSERT OR IGNORE，PUT/DELETE 对调用方保持幂等。

## 请求、错误和可观测性

每个请求都会经过 request ID middleware。客户端可传 `X-Trace-ID`，Core 会生成/透传并在响应头暴露 `X-Request-ID`、`X-Trace-ID`。错误格式为：

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "Content was updated elsewhere.",
    "requestId": "req_...",
    "traceId": "trace_..."
  }
}
```

生产入口使用 `RouterWithLifecycle`：审计事件进入有界异步队列，队列满时记录丢弃事件但不让业务请求失败；进程退出时最多等待 5 秒排空已接受事件。测试或不需要生命周期管理的内部调用可以使用同步 `Router`。

## 缓存策略

- `ContentCache`：最多 256 个 slug，TTL 默认 30 秒；Core 初始化时预热 Site composition 中的精选内容。
- `StatsCache`：只有一个已发布统计快照，TTL 默认 30 秒；公开和 Admin stats 共用。
- 内容更新、发布、撤回发布和删除会清除对应内容缓存及统计缓存。
- 缓存只优化读取，不改变 API response shape，也不作为持久化来源。

## 测试与修改指南

| 文件 | 覆盖内容 |
| --- | --- |
| `internal/auth/auth_test.go` | 登录、JWT 授权、过期 token、错误密码 |
| `internal/cache/*_test.go` | TTL、失效和统计快照 |
| `internal/events/dispatcher_test.go` | 队列投递、溢出和关闭超时 |
| `internal/store/store_test.go` | schema、种子、内容版本和数据操作 |
| `internal/handler/*_test.go` | 路由、状态码、错误和 handler 行为 |

修改 API 时按顺序：

1. 先更新 `packages/contracts/src/index.ts` 中的跨端类型。
2. 更新 `packages/sdk/src/index.ts` 的 client method 和 SDK 测试。
3. 在 model、store、handler 中实现 Core 行为和错误语义。
4. 更新本 README，并同步 Web/Admin README。
5. 运行 `go test ./...`、`go vet ./...` 和根目录浏览器回归。

不要让 handler 直接散落 SQL；业务持久化应集中在 `Store`。不要将未过滤的草稿/删除内容暴露到公开 handler，也不要把审计、缓存或数据库内部字段加入公共响应。
