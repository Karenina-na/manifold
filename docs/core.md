# Core 当前契约

> 本文是 `app/core` 当前实现的权威说明。API、数据模型、配置、错误、缓存和审计发生变化时，必须在同一变更中更新本文。历史方案放在 `docs/decisions/`，不应覆盖本文的运行时事实。

## 1. 背景与边界

`app/core` 是 Manifold 唯一的后端服务和业务数据所有者。它为公开 Web 和私有 Admin 提供 REST/JSON API，并负责 SQLite、鉴权、内容生命周期、评论管理、访客反应、匿名在线 Presence、统计、缓存和审计。

Core 不负责页面布局、Markdown HTML 展示、浏览器状态、Admin 表单或 PWA。Web/Admin 只能通过 `packages/sdk` 访问 Core，不能读 SQLite 或导入 Core 的 Go 内部包。

当前产品范围：Home、Thoughts、Writings、Profile、Site、Comments、Likes、匿名 Presence、Stats。内容只有 `THOUGHT` 与 `ARTICLE` 两种类型；Projects、Technology、Manuscript、Now、ResearchSeries 等是历史或未来规划，不是当前运行时 API。

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
| 数据 | SQLite、`modernc.org/sqlite` | schema、种子、查询和写入 |
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
├── internal/store/store.go         # SQLite 初始化、种子和 CRUD
├── internal/cache/                 # 内容/统计缓存
├── internal/events/                # 审计发布器和 worker
├── db/schema.sql                   # schema 对照文件
└── Dockerfile
```

运行时 schema 由 `internal/store/store.go` 内嵌 DDL 初始化（不执行历史迁移；数据库文件与当前 schema 不兼容时直接重建）；修改表结构时必须同步 `app/core/db/schema.sql` 与内嵌 schema。

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
| `CORE_MEDIA_MAX_BYTES` | `5242880` | 单次上传大小上限（5MB），超限返回 413 |
| `CORE_PUBLIC_URL` | 空 | 构建媒体绝对 URL 的公开基地址；为空时用请求的 Host（`X-Forwarded-Proto` 场景仅取 `r.TLS`/http） |

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
| `GET` | `/healthz` | `{ status: "ok", version, startedAt }`，进程启动时间用于计算 uptime |
| `GET` | `/api/v1/profile` | `Profile`，包含身份、教育/经历、个人 `series` 和 `contacts` |
| `GET` | `/api/v1/site` | 站点组合：profile 引用、站点身份（`title`/`description`/`footer`/`social`）、`commentsEnabled`、导航和 `sections`（枚举见下）；归档 pin 由 `thoughts_config`/`writings_config` 独立承载 |
| `GET` | `/api/v1/feed` | 内容集合，使用与 `/content` 相同的筛选 |
| `GET` | `/api/v1/content` | 已发布内容摘要集合，包含 Core 从 Markdown 正文派生的纯文本 `excerpt`、`viewCount`、`likeCount` 和未软删 `commentCount` 聚合值 |
| `GET` | `/api/v1/thoughts` | Thoughts 归档 aggregate：置顶 Thought（`thoughts_config` 配置，未配置/撤回时回退最新已发布 Thought）、排除置顶后的页码分页列表和总数，支持 `tag`/`q` 过滤（只作用于时间轴，置顶不受影响，多 tag 按 OR 命中任一标签）；内容项同样包含 `excerpt` |
| `GET` | `/api/v1/writings` | Writings 归档 aggregate：置顶 Writing（`writings_config` 配置，未配置/撤回时回退最新已发布 Writing）、排除置顶后的页码分页列表和总数，支持 `tag`/`q`/`sort`（newest/oldest/updated）/`aiAssisted` 过滤（只作用于时间轴，置顶不受影响，多 tag 按 OR 命中任一标签）；内容项同样包含 `excerpt` |
| `GET` | `/api/v1/tags` | 已发布内容的标签聚合 `Collection<TagSummary>`（`{ name, count }`，按 count 降序、name 升序），可用 `kind=THOUGHT|ARTICLE` 过滤 |
| `GET` | `/api/v1/content/{slug}` | 通过 slug 或 ID 返回已发布详情和 Markdown body；默认记录一次 `content.viewed` 审计事件并写入浏览事件（识别访客按 `(content, visitor, UTC 日)` 去重，匿名浏览每次都记录），内部 metadata 请求可传 `trackView=false` 跳过计数；来源归一为 origin 供分析——优先读 `referrer` 查询参数（SDK 为服务端 fetch 转发浏览器原始 Referer），为空时回退 HTTP `Referer` 头 |
| `GET` | `/api/v1/media/{id}` | 公开提供上传的媒体字节；`Content-Type` 为上传嗅探的 MIME，附 `Cache-Control: public, max-age=31536000, immutable` 与 `ETag: "<sha256>"`，`If-None-Match` 命中返回 304 |
| `GET` | `/api/v1/content/{slug}/comments` | 返回未软删评论，支持 `page`/`limit`/`q`；平铺返回当前页顶层评论及其全部回复（含 `replyToId` 供前端组线程） |
| `POST` | `/api/v1/content/{slug}/comments` | 创建评论并立即公开，201；站点设置 `commentsEnabled=false` 时返回 403 `COMMENT_DISABLED`（管理端评论接口不受此开关限制） |
| `GET` | `/api/v1/content/{slug}/likes` | 点赞统计和当前访客状态 |
| `PUT` | `/api/v1/content/{slug}/likes` | 添加点赞，200 |
| `DELETE` | `/api/v1/content/{slug}/likes` | 移除点赞，200 |
| `GET` | `/api/v1/stats` | 已发布统计 `Stats`；`wordCount` 与 `readingMinutes` 使用同一分词器：拉丁/数字词各计 1，每个 CJK 字符计 1 |
| `POST` | `/api/v1/presence` | 使用 `X-Visitor-ID` 更新匿名心跳，返回最近 5 分钟活跃访客数 |

内容列表参数：

```text
kind=THOUGHT|ARTICLE   # 可重复或逗号分隔
tag=systems             # 标签（单个最长 80）；可重复或逗号分隔多值（最多 10 个），多值按 OR 命中任一标签
q=boundary              # 标题/摘要/正文搜索（最长 200）
cursor=<opaque>
page=1..                # 页码模式；与 cursor 互斥，同时传返回 400
sort=newest|oldest|updated  # 默认 newest：newest/oldest 按 COALESCE(published_at, created_at)，updated 按 updated_at
aiAssisted=true|false   # 按 metadata_json 的 aiAssisted 布尔值过滤（缺省视为 false）
skipFirst=true          # 仅 page 模式可用：列表跳过排序后的第一条（Web 用作 Featured），totalPages 按剩余条数计算
limit=1..50
```

`page` 模式下 `pagination` 额外返回 `page/pageSize/totalItems/totalPages`（`totalItems` 仍为过滤后的完整条数，不因 `skipFirst` 减少；超出范围的页码夹紧到最后一页）；cursor 模式的 `pagination` 保持 `{ nextCursor, hasMore }`。

Thoughts 归档参数为 `page`（默认 1）、`limit`（默认 8，范围 1..50）、`tag`（单个最长 80，可重复或逗号分隔多值，最多 10 个，OR 语义）和 `q`（最长 200，标题/摘要/正文搜索）。响应为 `{ featured, data, pagination }`，其中 `pagination` 包含 `page/pageSize/totalItems/totalPages`。Core 优先使用 `thoughts_config.featured_thought_id` 指向的已发布 Thought；配置为空、目标撤回/删除或类型已改变时回退到最新已发布 Thought。置顶项不进入 `data`，`totalItems` 也只统计非置顶归档项；`tag`/`q` 只过滤时间轴与 `totalItems`，不影响置顶选择；超出范围的页码会夹紧到最后一页。

公开列表的 `excerpt` 是 Core 从 `body` 派生的最多 360 个 Unicode 字符的纯文本：移除 Markdown 标题、列表、链接目标、强调、行内代码、HTML 标签与代码围栏，并压缩空白。`summary` 仍是独立的编辑字段；列表响应不暴露完整 Markdown `body`，详情接口继续返回完整正文。

评论输入：`body` 必填且最多 4000 字符；`authorName` 最多 80 字符，可空时归一化为 `Anonymous`；`authorUrl`、`replyToId` 和 `avatarSeed`（最多 64 字符）可选。`replyToId` 必须指向同一内容下未软删的评论，否则返回 422 `REPLY_TARGET_INVALID`。评论不再有审核状态：创建即公开，admin 只能软删除或恢复。

公开评论列表参数：`page`（默认 1，1 起）、`limit`（每页顶层评论数，默认 10，范围 1..50）和 `q`（最长 200，按作者名或正文做大小写不敏感子串搜索，`cursor` 为预留参数暂被忽略）。分页只作用于顶层评论：响应平铺当前页的顶层评论（`createdAt` 升序）加它们各自的全部回复（回复升序），线程永不跨页拆散；被软删父级的回复随父级一起隐藏。`q` 是线程级搜索——顶层或其任一回复命中即返回整条线程。带 `page` 时 `pagination` 返回 `page/pageSize/totalItems/totalPages`：`totalItems` 为匹配集内全部公开评论（含回复），`totalPages` 按匹配的顶层评论计，超出范围的页码夹紧到最后一页；非法 `page`/`limit`/`q` 返回 400 `INVALID_QUERY`。

管理评论列表参数：`contentId`（可选，缺省跨全部内容）、`q`（线程级搜索，最长 200）、`page`（默认 1）、`pageSize`（默认 20，范围 1..100）和 `focus`（评论 id，最长 64）。与公开列表语义一致但有两点差异：含已软删评论（软删回复仍把其线程带入结果集），顶层评论按 `createdAt` 降序（回复仍升序）。`focus` 指向某条评论（顶层或回复）时返回该线程所在页（含线程自己的顶层评论页码），线程不匹配过滤条件或 id 不存在时回落到请求页；未知 `contentId` 返回 404 `CONTENT_NOT_FOUND`，非法参数返回 400 `INVALID_QUERY`。每行评论都 JOIN 内容附 `contentTitle`/`contentSlug`/`contentKind`。

反应请求必须使用 `X-Visitor-ID`，长度 8 到 128，只允许字母、数字、`_`、`-`。PUT/DELETE 对 `(content, visitor)` 幂等。

## 6. Admin API

`POST /api/v1/admin/session` 使用用户名和 bcrypt 密码登录，返回 12 小时 HS256 JWT。除登录接口外，所有 Admin 请求都需要 `Authorization: Bearer <token>`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET/PATCH` | `/api/v1/admin/profile` | 读取/更新 Profile、简历、兴趣、教育、经历、个人 Series 和联系方式 |
| `GET/PATCH` | `/api/v1/admin/site` | 读取/更新站点设置（全量对象）：`title`（必填 ≤80）、`description`（≤200）、`footer`（≤200）、`social`（≤6 项，同导航项结构）、`commentsEnabled`、`navigation`（1..10 项）与 `sections`（1..10 项，枚举 `PROFILE/BACKGROUND/RECENT_CONTENT/UPDATES/SERIES/CONTACT`，去重）；PATCH 校验失败返回 422，成功审计 `site.updated` |
| `GET/PATCH` | `/api/v1/admin/writings/config` | 读取/更新 Writings 置顶配置；PATCH body 为 `{ featuredWritingId: string \| null }`，非空必须引用已发布 ARTICLE，成功审计 `writings.config.updated` |
| `GET/PATCH` | `/api/v1/admin/thoughts/config` | 读取/更新 Thoughts 置顶配置；PATCH body 为 `{ featuredThoughtId: string \| null }` |
| `GET` | `/api/v1/admin/content` | 管理内容列表，支持 `kind`、`status`、`tag`（单值或多值，OR 语义）、`q`、cursor 以及可选 `sort`/`page`/`aiAssisted`/`skipFirst`，并返回 `viewCount` / `likeCount` / `commentCount` |
| `GET` | `/api/v1/admin/content/{id}` | 读取单条管理内容（含完整 body 与 metadata），供 Admin 详情页直接刷新恢复 |
| `POST` | `/api/v1/admin/content` | 创建 DRAFT |
| `PATCH` | `/api/v1/admin/content/{id}` | 局部更新和类型转换 |
| `POST` | `/api/v1/admin/content/{id}/comments` | 以管理员身份在该内容（含 DRAFT）下创建评论，201；输入与公开创建一致，审计 `comment.created` |
| `POST` | `/api/v1/admin/content/{id}/publish` | DRAFT -> PUBLISHED；目标不存在或已软删时返回 404 `CONTENT_NOT_FOUND`（软删内容不可通过状态迁移复活） |
| `POST` | `/api/v1/admin/content/{id}/unpublish` | PUBLISHED -> DRAFT，保留原始 `published_at`；目标不存在或已软删时返回 404 `CONTENT_NOT_FOUND` |
| `DELETE` | `/api/v1/admin/content/{id}` | 软删除，204；目标不存在或已软删时返回 404 `CONTENT_NOT_FOUND` |
| `GET` | `/api/v1/admin/comments` | 线程分页的管理评论列表（含已软删，附 `deletedAt`），支持 `contentId`/`q`/`page`/`pageSize`/`focus`；每行额外返回 `contentTitle`/`contentSlug`/`contentKind` |
| `DELETE` | `/api/v1/admin/comments/{id}` | 软删除评论，204 |
| `POST` | `/api/v1/admin/comments/{id}/restore` | 恢复软删评论，204 |
| `GET` | `/api/v1/admin/stats` | `AdminStats`，包含 `content` |
| `GET` | `/api/v1/admin/overview` | `AdminOverview` 聚合：内容计数（含 `draftCount`）、`totalViews`/`totalLikes`/`totalComments`（均只统计未软删内容；`totalViews` 用累计 `view_count`，与分析页的去重事件口径设计上不等）/`activeVisitors`、近 12 个月 `created`/`published` 趋势（`published` 按不可变的首发 `published_at` 归月）、浏览量 Top 5 已发布内容和 Top 10 标签；TTL 快照缓存 |
| `GET` | `/api/v1/admin/analytics/views` | `AnalyticsViews`：`days`（默认 30，上限 90）范围内去重浏览事件总数、独立访客、逐日 `{date, views, uniqueVisitors}`（缺失日补零）和 Top 10 referrer（空记 `direct`） |
| `GET` | `/api/v1/admin/system` | `SystemStatus`：version、`startedAt`、`uptimeSeconds`、SQLite 体积、内容缓存条目、Go heap/goroutine/进程 RSS（`sysRssBytes`）和审计事件总数；`resources` 块（CPU 占比与逻辑核数、内存 used/total/percent、load average 1/5/15、数据库所在分区的磁盘 used/total/percent）和 `host` 块（`hostname`/`os`/`platform`/`kernelArch`）。资源指标经 gopsutil 采样，单项失败降级为零值不报错；CPU 采用 `cpu.Percent(0, false)` 非阻塞差值采样，进程启动后首次请求 CPU 占比为 0 |
| `GET` | `/api/v1/admin/audit` | `AuditEventCollection`：审计事件服务端分页，`page`（默认 1）、`pageSize`（默认 10，上限 50）、`q`（OR 匹配 `event_name`/`actor`/`resource_id`，≤200 字符）；响应附 `pagination: PagePagination`，`page` 超界时钳制到最后一页返回，按 `createdAt` 降序 |
| `GET` | `/api/v1/admin/media` | `Collection<Media>`：媒体库服务端分页，`page`（默认 1）、`pageSize`（默认 20，上限 50）、`q`（按文件名/ID 过滤，≤200 字符）；`url` 为绝对地址，按 `createdAt` 降序 |
| `POST` | `/api/v1/admin/media` | 上传图片：raw bytes（非 multipart）+ `?filename=`；`http.DetectContentType` 嗅探并仅接受 png/jpeg/webp/gif/avif（拒绝 SVG，415）；超过 `CORE_MEDIA_MAX_BYTES` 返回 413；按 SHA256 去重幂等（重复上传返回已有记录）；响应 201 `Media`（含绝对 `url`，写进 Markdown 正文使用）；审计 `media.uploaded` |
| `DELETE` | `/api/v1/admin/media/{id}` | 物理删除媒体，204；Markdown 中的引用会变成死链，由编辑端自行清理；审计 `media.deleted` |

> **Now 状态已移除**：`GET /api/v1/now`、`GET/PUT /api/v1/admin/now`、`now_status` 表与 `now.updated` 审计事件已删除，迁移方式为删除调用方后无数据保留诉求（Web 首页 mood 徽标同步移除）。

内容创建的 Article 必须有非空 `title` 和 `slug`；Thought 两者可为空。PATCH 必须提供 `expectedVersion`，版本不匹配返回 `409 VERSION_CONFLICT`。类型转换为 Article 时，最终 title/slug 也必须满足 Article 规则。

更新 Thoughts 配置时，非空 `featuredThoughtId` 必须引用当前已发布的 `THOUGHT`；Article、草稿、软删除或不存在的 ID 返回 `422 VALIDATION_ERROR`。传 `null` 表示清除显式置顶，公开归档随后回退最新已发布 Thought。

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
| `published_at/created_at/updated_at/version` | 生命周期、时间和乐观并发；`published_at` 是首次发布的不可变事实——publish 仅在为 NULL 时写入，unpublish 保留，重新发布不重置 |
| `view_count` | 公开详情读取时同步递增的持久化浏览量 |

Metadata：Thought 使用 `mood/question/context/source`；Article 使用 `readingMinutes/toc/frontmatter/technologies/language/difficulty/repositoryUrl/aiAssisted`。`excerpt` 不是持久化字段，由 Core 在读取边界从正文派生。保存 ARTICLE 时 Core 会根据 Markdown body 覆盖计算 `readingMinutes`（约 200 个词/分钟，至少 1 分钟，CJK 字符按 0.5 词折算）并从二、三级标题重建 `toc`；编辑端不应手工提交这些派生字段。`aiAssisted` 由 Admin 编辑端写入 metadata_json，Core 不做枚举校验、仅按布尔语义透传（公开列表 `aiAssisted=false` 过滤时缺省视为 false）。Core 仍会校验 metadata 的类型、长度、TOC 层级、技术标签和难度枚举。

其他表：`profile`、`site_config`、`thoughts_config`、`writings_config`、`comments`、`likes`、`presence`、`audit_events`、`content_view_events`、`media`。`media`（`id`、`mime`、`size`、`sha256 UNIQUE`、`filename`、`data BLOB`、`created_at`）保存上传的图片字节，按 SHA256 去重（相同字节复用同一行）；`mime` 只允许 png/jpeg/webp/gif/avif（上传时嗅探，SVG 永不入库）；公开访问 `GET /api/v1/media/{id}` 依赖该表，缓存语义见路由表。`content_view_events` 是浏览事件表（`content_id`、`visitor_id`、`referrer`（origin 或空）、`day`（UTC 日期）、`created_at`）：识别访客通过部分唯一索引 `(content_id, visitor_id, day) WHERE visitor_id != ''` 按"同人同内容同 UTC 日"去重，匿名浏览每次插入一条；该表驱动 `GET /admin/analytics/views`，与累计 `view_count` 并存——`view_count` 保持无条件递增，分析口径只统计去重事件，Admin 侧两处浏览量（Overview 的 `totalViews` 与 Analytics 的 `totalViews`）设计上不相等，差异即匿名与重复访问。`thoughts_config` 是 `thoughts_1` 单例，`featured_thought_id` 是可空的 `content(id)` 外键；`writings_config` 是 `writings_1` 单例，`featured_writing_id` 同构，分别承载 Thoughts/Writings 归档置顶。Core 为归档查询维护 `(kind,status,published_at DESC)` 索引。`content.view_count` 在公开详情读取时同步原子递增，列表响应直接返回该持久化计数；`likeCount` 从 `likes` 聚合，`commentCount` 只统计未软删评论，评论创建、软删除或恢复时 Core 会失效对应内容详情缓存。详情读取同时写入 `audit_events(event_name = 'content.viewed', resource_type = 'content')` 供观测使用，审计队列丢弃不会影响浏览量统计。Profile 包含 `resume_url`、`interests_json`、`education_json`、`experience_json`、`series_json`、`contacts_json`；Series 项为 `{name,url,description,category?}`，联系方式为 `{label,url,handle?,icon?}`；`site_config` 是 `site_1` 单例，包含站点身份列（`title`、`description`、`footer_text`、`social_json`、`comments_enabled`）与首页组合列（`navigation_json`、`sections_json`）。评论创建即公开（无审核状态，`deleted_at` 软删标记，`avatar_seed` 保存访客头像种子），可见性索引为 `idx_comments_content_visibility (content_id, deleted_at, created_at)`；点赞有 `(content_id, visitor_id)` 唯一约束；Presence 只保存匿名 visitor ID 的最近心跳时间，过期窗口为 5 分钟。

> **不兼容历史 schema**：Core 不再迁移旧库（历史 kind 枚举、评论审核 `status` 列、`featured_content_json` 归档 pin、`reactions`/`now_status` 表等一律不兼容）；部署时用当前 schema 重建数据库文件。个别长期开发库中可能残留 `projects` 表（历史规划，1 行示例数据）——它不属于运行时 schema，不被任何 API 读写，仅作历史数据保留，可手动 `DROP TABLE projects` 清理。

## 8. 缓存、审计和关闭

- Core 启动时先绑定 `CORE_ADDR`，成功后才打开 SQLite、执行 schema 初始化；端口冲突会直接退出且不修改数据库。
- 内容详情使用最多 256 项的 TTL LRU；Core 启动时预热归档置顶的 Writing 与 Thought（Thought 以公开 URL 的内容 ID 为 key，Writing 以 slug 为 key，无 slug 时跳过）。
- 缓存失效按内容可能被服务的全部 key 进行：内容 ID（Thought 详情 URL）与 slug（Writing 详情 URL 及 Thought 的可选 slug），不再整表清空；内容创建、更新、发布、撤回、删除、点赞变化与评论软删/恢复都会清理相关缓存。
- Stats 与 Admin Overview 各使用单条 TTL 快照（共用 `CORE_STATS_CACHE_TTL`）。
- 审计事件通过有界异步队列写入 `audit_events`；队列满会记录丢弃但不让业务请求失败。
- `RouterWithLifecycle` 用于生产入口；监听失败会结束进程，正常关闭时最多等待 5 秒排空已接受事件；`Router` 仅用于同步内部调用/测试。公共 HTTP 契约不受启动生命周期影响。

### 依赖记录：github.com/shirou/gopsutil/v4

- 用途：`GET /admin/system` 的服务器资源与主机信息只读采样（CPU 占比/核数、内存、load average、数据库所在磁盘分区、进程 RSS、hostname/platform/kernelArch）。
- 替代方案：手写 `/proc` 解析仅覆盖 Linux，否决；gopsutil 是 Go 生态资源采样的事实标准且跨 macOS/Linux。
- 权衡与安全边界：纯 Go 无 cgo，只读系统信息，无新增攻击面；引入其纯 Go 子依赖树，二进制体积小幅增加，无网络行为。资源采样失败一律降级零值，不影响业务可用性。

## 9. 修改与验证清单

修改 Core 时必须检查：

- 路由/字段/状态码是否需要同步 `packages/contracts`、`packages/sdk`、`docs/admin.md`、`docs/decisions/web.md`。
- schema 是否同时修改 `app/core/db/schema.sql`、内嵌 schema 和测试。
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
