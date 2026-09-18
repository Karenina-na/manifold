# Core 当前契约

> 本文是 `app/core` 当前实现的权威说明。API、数据模型、配置、错误、缓存和审计发生变化时，必须在同一变更中更新本文。历史方案放在 `docs/decisions/`，不应覆盖本文的运行时事实。

## 1. 背景与边界

`app/core` 是 Manifold 唯一的后端服务和业务数据所有者。它为公开 Web 和私有 Admin 提供 REST/JSON API，并负责 SQLite、鉴权、内容生命周期、评论管理、访客反应、匿名在线 Presence、统计、缓存、审计，以及 Admin 专用 Agent 的运行时、工具和 session 临时记忆。

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
├── cmd/server/main.go              # 配置、seed 解析、数据库、HTTP server、优雅关闭
├── internal/config/config.go       # CORE_* 环境变量与 .env 自动加载
├── internal/handler/               # HTTP 路由、中间件、handler、错误和分页
│   ├── routes.go                   # 路由注册
│   ├── response.go                 # handler 依赖、生命周期和 Router
│   └── response_helpers.go         # JSON、错误、集合和健康检查响应
├── internal/application/           # 写用例及 audit、anchor、cache 编排
├── internal/agent/                 # Provider、场景工厂、工具循环、上下文构建、session 内存与 OpenAI 适配
├── internal/auth/auth.go           # bcrypt、JWT、Casbin
├── internal/github/                # GitHub OAuth 上游客户端及其协议测试
├── internal/model/content.go       # Core 领域 JSON model
├── internal/store/bootstrap.go     # SQLite 初始化、迁移和 seed 应用
├── internal/store/                 # 领域数据查询和写入
├── internal/seed/                  # 种子数据文件（bootstrap.json、dev.json）与解析校验
├── internal/cache/                 # 内容/统计缓存
├── internal/events/                # 审计发布器和 worker
├── internal/system/                # Admin system endpoint 的主机资源采样
├── db/migrations/                 # 按版本顺序执行的 SQLite schema
└── Dockerfile
```

运行时 schema 由 `app/core/db/migrations/` 下的迁移初始化，迁移按版本顺序应用（`bootstrap.go` 的 `migrate()`）。旧库（版本低于 binary）原地增量升级；只有版本高于 binary 的库才拒绝启动，提示升级 Core binary。

## 3. 运行配置

Core 使用 `caarlos0/env` 读取 `CORE_` 前缀变量；启动时自动从工作目录向上查找最近的 `.env` 文件并加载（已存在的环境变量优先，值不做 shell 展开，因此 bcrypt 哈希中的 `$` 原样保留）。`make core-run` 在 `app/core` 内执行，会向上找到仓库根目录的 `.env`。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CORE_ENV` | `development` | 运行环境。`production` 时启用生产校验（拒绝 dev 默认 `CORE_JWT_SECRET`/`CORE_ADMIN_PASSWORD_HASH`，并校验 `CORE_TRUSTED_PROXY_CIDRS` 的 CIDR），且首次启动只播种空站点骨架、不写入演示内容 |
| `CORE_ADDR` | `:8080` | HTTP 监听地址 |
| `CORE_DATABASE_PATH` | `./data/manifold.db` | SQLite 路径，父目录自动创建 |
| `CORE_ALLOWED_ORIGINS` | `http://localhost:3000,http://localhost:5173` | CORS 来源，逗号分隔 |
| `CORE_TRUSTED_PROXY_CIDRS` | 空 | 可提供可信 `X-Real-IP` 的代理 CIDR，逗号分隔；未命中时忽略转发头 |
| `CORE_JWT_SECRET` | `manifold-dev-secret-change-me` | JWT 根密钥，Core 用 HMAC-SHA256 分别派生 admin/visitor 的 HS256 用途子密钥；生产必须替换 |
| `CORE_ADMIN_USERNAME` | `admin` | 管理用户名 |
| `CORE_ADMIN_PASSWORD_HASH` | 内置 bcrypt hash | 管理密码 hash；发布配置留空时由打包脚本生成并写回 |
| `CORE_CONTENT_CACHE_TTL` | `30s` | 内容详情缓存 TTL |
| `CORE_STATS_CACHE_TTL` | `30s` | 统计缓存 TTL |
| `CORE_AUDIT_EVENT_BUFFER` | `256` | 审计队列容量 |
| `CORE_RATE_LIMIT_PER_MIN` | `60` | 公开写入口共用的限流配额（每分钟每客户端）：`POST /presence`、`POST /content/{slug}/comments`、`PUT`/`DELETE /content/{slug}/likes`、`POST /auth/github/exchange`、`POST /chain/anchors`；超限返回 429 `RATE_LIMITED` |
| `CORE_LOGIN_RATE_LIMIT_PER_MIN` | `5` | 管理端登录 `POST /admin/session` 的独立配额（每分钟每客户端），比公开限流更紧 |
| `CORE_MEDIA_MAX_BYTES` | `5242880` | 单次上传大小上限（5MB），超限返回 413 |
| `CORE_PUBLIC_URL` | 空 | 构建媒体绝对 URL 的公开基地址；为空时用请求的 Host（`X-Forwarded-Proto` 场景仅取 `r.TLS`/http） |
| `CORE_SEED_FILE` | 空 | 自定义种子文件路径，语义见“种子数据”章节 |
| `CORE_CHAIN_PROOF_MODE` | `sim` | 锚定链挖矿模式：`sim` 固定延迟出块，`proof` 真跑 SHA-256 碰撞；语义见 [`docs/chain.md`](chain.md) |
| `CORE_CHAIN_DIFFICULTY` | `6` | proof 模式前导 0 十六进制位数，取值必须落在 `[1, 6]`（`chain.MinProofDifficulty`…`chain.MaxProofDifficulty`），越界时进程拒绝启动；sim 下存 0 |
| `CORE_CHAIN_SIM_DELAY` | `1s` | sim 模式模拟挖矿延迟 |
| `CORE_CHAIN_BATCH_SIZE` | `32` | 缓冲满阈值：pending 证书达到该数量立即打包 |
| `CORE_CHAIN_MAX_BLOCK_ANCHORS` | `500` | 单块证书上限 |
| `CORE_CHAIN_FLUSH_TIMEOUT` | `30s` | 防饿死阀门：最老 pending 等待上限 |
| `CORE_CHAIN_ANCHOR_MAX_BYTES` | `65536` | 公开/Admin 锚定提交 payload 上限，超限 413 |
| `CORE_CHAIN_VERIFY_RATE_PER_MIN` | `20` | 四个 verify 入口共用的独立限流配额（每分钟）；verify 每请求全链重放，比公开提交更昂贵，配额更紧（见 [`docs/chain.md`](chain.md) 第 10 节） |
| `CORE_GITHUB_CLIENT_ID` | 空 | GitHub OAuth App 的 Client ID；为空时 `/api/v1/auth/me` 返回 `providers: []`，GitHub 评论登录整体禁用 |
| `CORE_GITHUB_CLIENT_SECRET` | 空 | GitHub OAuth App 的 Client Secret，仅存于 Core 侧，绝不下发到 Web |
| `CORE_GITHUB_REDIRECT_URI` | 空 | GitHub OAuth 回调地址，必须与 Web 端 `/api/v1/auth/callback/github` 的注册 URI 一致（开发为 `http://localhost:3000/api/v1/auth/callback/github`）；生产用环境变量覆盖 |

默认开发账号为 `admin` / `password`，仅用于本地联调。

> **锚定链**：Core 内嵌单写者 PoW 锚定链，所有业务 DB 写路径自动提交 SHA-256 承诺证书，并提供公开无许可锚定接口与全链重放验证。证书/区块结构、锚定清单、挖矿生命周期与验证语义的完整契约见 [`docs/chain.md`](chain.md)。

### 统一发布包

根目录 `pnpm package:release -- --env .env.production` 为 Linux x64 交叉编译纯 Go Core，并与 Web/Admin 产物一起写入 zip。归档内容直接位于 ZIP 根目录，不包含额外的版本目录；生产配置原样保存为包内 `.env`；若 `CORE_ADMIN_PASSWORD_HASH` 为空，脚本生成随机初始密码、调用 Core 的 bcrypt 工具计算 hash，并以 `0600` 权限原子写回源配置，明文只在当前终端显示一次。打包前仍会拒绝开发默认密钥、开发默认密码 hash、非 `:8080` 地址、非 `./data/manifold.db` 路径、localhost 公开 URL、非法可信代理 CIDR 和缺少 Web/Admin 来源的 CORS 配置。公开 URL 可使用与内部监听端口不同的 HTTP(S) origin；归档不包含 SQLite 文件，首次启动按生产 seed 规则只初始化结构骨架。

解压后的 `./manifold start|stop|restart|status` 只管理该归档记录的 supervisor PID。运行器将 `.env`、日志和 PID 状态限制为 `0600`，将 `data/`、`logs/`、`run/` 限制为 `0700`；启动子进程前会清除宿主环境中的 `CORE_*`、`NEXT_PUBLIC_*` 和 `VITE_*`，再注入包内 `.env`，避免服务器 shell 配置覆盖已验证的发布值。Core 日志写入 `logs/core.log`，数据库写入 `data/manifold.db`。正常停止仍走现有 SIGTERM 优雅关闭与审计队列 drain。该发布能力不改变 Core 路由、响应或业务契约。

### 种子数据

数据库初始化时，Core 对空库一次性应用种子计划；门闩是 `profile` 表行数（而非内容表），因此通过 Admin 删光内容后重启不会复活演示数据。种子计划由 `CORE_ENV` 与 `CORE_SEED_FILE` 共同决定：

| 场景 | 行为 |
| --- | --- |
| 开发（默认，`CORE_ENV` 非 `production` 且未设 `CORE_SEED_FILE`） | 应用内置 `internal/seed/dev.json`：profile、site_config、20 条 PUBLISHED 内容、1 条 DRAFT 内容和归档配置单例 |
| 开发 + `CORE_SEED_FILE` | 应用自定义 JSON 文件；`profile`/`siteConfig` 缺省时回退内置 bootstrap 默认，`contents` 完全来自文件 |
| 生产（`CORE_ENV=production`） | 只应用结构骨架（profile + site_config），内容库为空，由管理员创建全部内容；即使设置了 `CORE_SEED_FILE` 也只采用其骨架字段、忽略 `contents` |

种子文件格式（JSON，与 `internal/seed/bootstrap.json`、`dev.json` 同构）：

- `profile`：站点身份（`displayName` 必填，其余可选）；提供时整体替换内置默认。
- `siteConfig`：`navigation`（`label/href` 必填）、`sections`（枚举 `PROFILE/BACKGROUND/RECENT_CONTENT/UPDATES/SERIES/CONTACT`，不重复）；`title/description/footer/commentsEnabled/social` 可选，缺省时沿用数据库列默认值。
- `contents`：`kind`（`THOUGHT`/`ARTICLE`）、`slug` 必填且唯一；`status` 仅允许 `DRAFT`/`PUBLISHED`（默认 PUBLISHED，DRAFT 行不写 `published_at`）；`id` 缺省自动生成；`metadata` 按类型校验（派生字段由 Core 从正文计算）；`publishedAt`（RFC3339）可回填发布时间。
- 摘要（excerpt）、阅读时长、TOC 一律由 Core 派生，不写入种子文件；文件非法（未知字段、重复 slug、非法枚举）时启动直接失败。

`thoughts_config`/`writings_config` 单例（初始无置顶）由 Core 无条件保证存在，不属于可定制种子数据。

## 4. HTTP 通用约定

- 基础路径为 `/api/v1`，媒体类型为 JSON。
- 时间为 UTC RFC3339 字符串，ID 为不透明字符串。
- 每个请求都有 `X-Request-ID` 和 `X-Trace-ID`；客户端可传入 `X-Trace-ID`，Core 会校验/生成并回传。生成侧不使用 CSPRNG，回退形态为 `req_<UnixNano>` / `trace_<UnixNano>`，并追加一个进程内单调递增的序号，使同一纳秒内的并发请求不会拿到相同的 ID。
- CORS 允许 `GET/POST/PUT/DELETE/OPTIONS`，请求头包括 `Authorization`、`Content-Type`、`X-Trace-ID`、`X-Visitor-ID`。
- 集合响应统一为 `{ data, pagination }`；分页统一使用 `page/pageSize/totalItems/totalPages`，默认页码为 1。`pageSize` 下限为 1，`totalPages` 至少为 1，`page` 超出 `[1, totalPages]` 时夹紧到边界；因此空集合恒为 `page=1`、`totalPages=1`（`totalItems=0`），而不是 `totalPages=0`。所有列表端点（含 `/api/v1/tags` 这类一次性返回全部项的端点）走同一套夹紧逻辑。
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

常见状态码：`400` 查询/访客参数无效，`401` JWT 缺失或无效，`403` 角色无权限，`404` 不存在或对调用者不可见，`409` 唯一键/版本冲突，`413` 请求体超过上限，`422` 输入校验失败，`500` 服务端故障。

所有 JSON 请求体都在统一的解码边界（`internal/handler` 的 `decodeJSON`）套一层 `http.MaxBytesReader`，上限 **1 MiB**；超限一律返回 `413 PAYLOAD_TOO_LARGE`，而不是先缓冲整个请求体再报成校验失败。媒体上传（`CORE_MEDIA_MAX_BYTES`）与锚定提交（`CORE_CHAIN_ANCHOR_MAX_BYTES`）有各自更小的上限，各自返回 `413 MEDIA_TOO_LARGE` / `413 PAYLOAD_TOO_LARGE`。

`code` 的完整枚举是 `ApiErrorCode`（`packages/contracts/src/index.ts` 的 `API_ERROR_CODES`），Core 侧的常量集中在 `app/core/internal/apierror/codes.go`。两侧由 `packages/contracts/test/error-codes.test.ts` 强制逐项相等，因此新增或改名一个错误码必须同时改两处，否则测试失败——客户端可以放心地对 `code` 做穷尽 `switch`。

## 5. 公开 API

公开读取不需要认证；草稿和软删除内容永远不可见。

| 方法 | 路径 | 返回/行为 |
| --- | --- | --- |
| `GET` | `/healthz` | `{ status: "ok", version, startedAt }`，进程启动时间用于计算 uptime |
| `GET` | `/api/v1/profile` | `Profile`，包含身份、教育/经历、个人 `series` 和 `contacts` |
| `GET` | `/api/v1/site` | 站点组合：profile 引用、站点身份（`title`/`description`/`footer`/`social`）、`commentsEnabled`、导航和 `sections`（枚举见下）；归档 pin 由 `thoughts_config`/`writings_config` 独立承载 |
| `GET` | `/api/v1/home/timeline` | 首页 Updates 的有限公开投影 `{ data, totalItems, truncated }`；`data` 项只含 `id/kind/slug/title/summary/publishedAt`，取最新 `limit` 条后按不可变首发时间升序；`limit` 默认 1000、上限 1000，超上限钳制，非法或未知参数返回 400 `INVALID_QUERY` |
| `GET` | `/api/v1/content` | 已发布内容摘要集合，包含 Core 从 Markdown 正文派生的纯文本 `excerpt`、`viewCount`、`likeCount` 和可见线程口径的 `commentCount` 聚合值 |
| `GET` | `/api/v1/tags` | 已发布内容的标签聚合 `Collection<TagSummary>`（`{ name, count }`，按 count 降序、name 升序），可用 `kind=THOUGHT|ARTICLE` 过滤 |
| `GET` | `/api/v1/content/{slug}` | 按 slug 返回已发布详情和 Markdown body（**仅 slug，无 ID 回退**；按 ID 读取是管理端 `/api/v1/admin/content/{id}` 的能力）；默认记录一次 `content.viewed` 审计事件并写入浏览事件（识别访客按 `(content, visitor, UTC 日)` 去重，匿名浏览每次都记录），内部 metadata 请求可传 `trackView=false` 跳过计数；来源归一为 origin 供分析——优先读 `referrer` 查询参数（SDK 为服务端 fetch 转发浏览器原始 Referer），为空时回退 HTTP `Referer` 头 |
| `GET` | `/api/v1/media/{id}` | 公开提供上传的媒体字节；`Content-Type` 为上传嗅探的 MIME，附 `Cache-Control: public, max-age=31536000, immutable` 与 `ETag: "<sha256>"`，`If-None-Match` 命中返回 304 |
| `GET` | `/api/v1/content/{slug}/comments` | 返回未软删评论线程，支持 `page`/`pageSize`/`q`；隐藏评论保留线程位置并只返回 `hidden=true` 与结构字段，作者名、网站、正文和头像种子清空；平铺返回当前页顶层评论及其全部回复 |
| `POST` | `/api/v1/content/{slug}/comments` | 创建评论并立即公开，201；站点设置 `commentsEnabled=false` 时返回 403 `COMMENT_DISABLED`（管理端评论接口不受此开关限制） |
| `GET` | `/api/v1/content/{slug}/likes` | 点赞统计和当前访客状态 |
| `PUT` | `/api/v1/content/{slug}/likes` | 添加点赞，200 |
| `DELETE` | `/api/v1/content/{slug}/likes` | 移除点赞，200 |
| `GET` | `/api/v1/stats` | 已发布统计 `Stats`；`wordCount` 与 `readingMinutes` 使用**两个不同的分词器**：`wordCount` 把每个拉丁/数字词和每个 CJK 字符都计 1；`readingMinutes` 把拉丁/数字词计 1、CJK 字符计 **0.5**（`(cjk+1)/2`），再按每 200 单位 1 分钟向上取整、下限 1 分钟——CJK 的 0.5 权重是阅读速度估算，不代表字数 |
| `POST` | `/api/v1/presence` | 使用 `X-Visitor-ID` 更新匿名心跳，返回最近 5 分钟活跃访客数 |
| `GET` | `/api/v1/auth/me` | 评论访客会话：未带有效 `Authorization: Bearer` 时返回 `{authenticated:false, providers:[...]}`；带有效 visitor token 时返回 `{authenticated:true, provider, displayName, avatarUrl, providers}`。`providers` 枚举当前已配置的第三方登录（仅 `github`；未配置时为空数组，Web 端只显示访客入口） |
| `POST` | `/api/v1/auth/github/exchange` | GitHub 授权码换发 visitor 会话：body `{code}`，成功后返回 `{token, provider, displayName, avatarUrl}`（JWT，90 天，`iss=manifold-core`、`aud=manifold-visitor`）；GitHub 未配置时返回 501 `GITHUB_AUTH_DISABLED`，缺少 `code` 时 422 `VALIDATION_ERROR`，`code` 无效或被 GitHub 拒绝时 502 `GITHUB_AUTH_FAILED`，拉取 GitHub profile 失败时 502 `GITHUB_PROFILE_FAILED`。受 `publicLimiter` 限流 |

`/auth/github/exchange` 是无浏览器 cookie 上下文的服务端授权码交换边界，不签发或校验 OAuth `state`。浏览器调用方必须在调用该端点前自行完成 CSRF 往返绑定；当前 Web 的 login/callback 路由用 10 分钟 HttpOnly、SameSite=Lax cookie 保存并严格比对随机 `state`，只有比对成功才向 Core 交换 `code`。新增客户端不得绕过这一约束。

内容列表参数：

```text
kind=THOUGHT|ARTICLE   # 可重复或逗号分隔
tag=systems             # 标签（单个最长 80）；可重复或逗号分隔多值（最多 10 个），多值按 OR 命中任一标签
q=boundary              # 标题/摘要/正文搜索（最长 200）
page=1..                # 页码模式，超出范围夹紧到最后一页
sort=newest|oldest|updated  # 默认 newest：newest/oldest 按 COALESCE(published_at, created_at)，updated 按 updated_at
aiAssisted=true|false   # 按 metadata_json 的 aiAssisted 布尔值过滤（缺省视为 false）
pageSize=1..50
```

`pagination` 始终返回 `page/pageSize/totalItems/totalPages`。置顶内容由 `/api/v1/site` 的 `pinnedThoughts/pinnedWritings` 按置顶顺序提供（显式置顶，空数组表示无置顶），归档列表通过 `/api/v1/content` 的 `kind`、`tag`、`q`、`sort` 和 `aiAssisted` 查询。

所有 `q` 过滤（公开内容与 Thoughts 搜索、Admin 内容/评论/媒体列表、审计列表、`MediaReferences` 的正文引用扫描）都是**字面包含**匹配：`%`、`_` 和 `\` 在进入 SQL 前被转义，并统一使用 `ESCAPE '\'`。因此输入 `50%` 只匹配含字面 `50%` 的记录，`under_score` 不会匹配 `underXscore`。

Thoughts 归档参数为 `page`（默认 1）、`pageSize`（默认 8，范围 1..50）、`tag`（单个最长 80，可重复或逗号分隔多值，最多 10 个，OR 语义）和 `q`（最长 200，标题/摘要/正文搜索）。响应为 `{ data, pagination }`。置顶项由 `/api/v1/site` 的 `pinnedThoughts` 单独下发并仍保留在 `data` 中；`tag`/`q` 只过滤时间轴；超出范围的页码会夹紧到最后一页。

公开列表的 `excerpt` 是 Core 从 `body` 派生的最多 360 个 Unicode 字符的纯文本：移除 Markdown 标题、列表、链接目标、强调、行内代码、HTML 标签与代码围栏，并压缩空白。`summary` 仍是独立的编辑字段；列表响应不暴露完整 Markdown `body`，详情接口继续返回完整正文。

评论输入：`body` 必填且最多 4000 字符；`authorName` 最多 80 字符，可空时归一化为 `Anonymous`；`authorUrl`、`replyToId` 和 `avatarSeed`（最多 64 字符）可选。`replyToId` 必须指向同一内容下未软删的评论，否则返回 422 `REPLY_TARGET_INVALID`。评论创建即公开；admin 可独立隐藏/恢复或软删除/恢复，隐藏不会级联到回复。

评论身份（`authorProvider`/`authorAvatarUrl`）：无有效 visitor 会话时走匿名路径，作者名/头像种子由客户端提供，响应 `authorProvider="visitor"`；带有效 visitor token 时 Core **服务端覆盖**客户端提交的 `authorName`/`avatarSeed`（清空头像种子），使用 GitHub 身份（`authorProvider="github"`、`authorAvatarUrl` 取 GitHub 头像快照），无效 token 返回 401 `INVALID_VISITOR_SESSION`。`authorAvatarUrl` 是账号资料的快照列，GitHub 改名/换头像不影响历史评论。

公开评论列表参数：`page`（默认 1，1 起）、`pageSize`（每页顶层评论数，默认 10，范围 1..100）和 `q`（最长 200，按作者名或正文做大小写不敏感子串搜索）。分页只作用于顶层评论：响应平铺当前页的顶层评论（`createdAt` 升序）加它们各自的全部回复（回复升序），线程永不跨页拆散；被软删父级的回复随父级一起隐藏，隐藏行保留并以 `hidden=true` 标记，但不返回作者名、网站、正文或头像种子。`q` 是线程级搜索——隐藏评论的作者/正文不参与匹配，顶层或其任一可见回复命中即返回整条线程。带 `page` 时 `pagination` 返回 `page/pageSize/totalItems/totalPages`：`totalItems` 为匹配集内全部未软删评论（含隐藏行和回复），`totalPages` 按匹配的顶层评论计，超出范围的页码夹紧到最后一页；非法 `page`/`pageSize`/`q` 返回 400 `INVALID_QUERY`。

管理评论列表参数：`contentId`（可选，缺省跨全部内容）、`q`（线程级搜索，最长 200）、`page`（默认 1）、`pageSize`（默认 20，范围 1..100）和 `focus`（评论 id，最长 64）。与公开列表语义一致但含已软删评论（软删回复仍把其线程带入结果集），管理行附 `deletedAt` 与 `hiddenAt`，顶层评论按 `createdAt` 降序（回复仍升序）。`focus` 指向某条评论（顶层或回复）时返回该线程所在页（含线程自己的顶层评论页码），线程不匹配过滤条件或 id 不存在时回落到请求页；未知 `contentId` 返回 404 `CONTENT_NOT_FOUND`，非法参数返回 400 `INVALID_QUERY`。每行评论都 JOIN 内容附 `contentTitle`/`contentSlug`/`contentKind`。

反应请求必须使用 `X-Visitor-ID`，长度 8 到 128，只允许字母、数字、`_`、`-`。PUT/DELETE 对 `(content, visitor)` 幂等。

### 锚定链公开 API（`/api/v1/chain`，无认证，不走内容 TTL 缓存）

链数据低频且要求即时可见 pending 状态，集合统一 `{ data, pagination }`。完整契约（证书/区块结构、验证语义、错误码）见 [`docs/chain.md`](chain.md)。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/chain` | `ChainInfo`：height、totalAnchors、pendingAnchors、proofMode、difficulty、genesisHash、tipHash、sitePublicKey |
| `GET` | `/api/v1/chain/anchors` | 证书列表（`createdAt` 降序），`source`（九值枚举）/`ref` 过滤 + `page`/`pageSize`（默认 20，上限 100） |
| `POST` | `/api/v1/chain/anchors` | 无许可锚定提交（`publicLimiter` 限流）：`{payload, label?}`，payload ≤ `CORE_CHAIN_ANCHOR_MAX_BYTES`；202 `{anchorId, subjectHash, status:"pending"}`，超限 413 `PAYLOAD_TOO_LARGE`；只存哈希不存原文 |
| `GET` | `/api/v1/chain/anchors/{id}` | 单张证书 |
| `GET` | `/api/v1/chain/blocks` | 区块摘要列表（`block_index` 降序），摘要含 `anchorCount` 不含 certIds |
| `GET` | `/api/v1/chain/blocks/{id}` | 区块详情：`certIds` + 内含全部证书 |
| `GET` | `/api/v1/chain/verify?hash=` | 按哈希查证（64 位 hex）；每请求全链重放验证 |
| `POST` | `/api/v1/chain/verify` | 贴原文查证：`{payload}`，Core 按原字节重算哈希后查证 |
| `GET` | `/api/v1/chain/verify/content/{slug}` | 按公开内容查证：live 行重建 canonical payload；仅 PUBLISHED，否则 404 |
| `GET` | `/api/v1/chain/verify/comment/{id}` | 按评论查证：同上；隐藏/软删评论 404（历史承诺仍可按哈希验证） |

四个 verify 入口共用独立限流桶 `verifyLimiter`（`CORE_CHAIN_VERIFY_RATE_PER_MIN`，默认 20/min），命中 `429`——每次验证全链重放，配额必须低于公开写入。
| `GET` | `/api/v1/chain/keys` | `{keys: [{keyId, publicKey, createdAt}]}` 站点公钥列表 |

`GET /api/v1/content/{slug}` 的响应在锚定链启用时额外携带 `latestAnchor: { anchorId, subjectHash, status, blockId } | null`（按 contentId 的最新 content 源证书；链未启用或无证书时为 `null`）。

## 6. Admin API

`POST /api/v1/admin/session` 使用用户名和 bcrypt 密码登录，返回 12 小时 HS256 JWT（`iss=manifold-core`、`aud=manifold-admin`，claims 携带 `jti`，对应 `admin_sessions` 一行）。除登录接口外，所有 Admin 请求都需要 `Authorization: Bearer <token>`，且服务端逐请求校验 session 未吊销、未过期。

Admin 与 visitor token 使用从 `CORE_JWT_SECRET` 按用途派生的不同签名子密钥，并分别强制 `aud=manifold-admin` / `aud=manifold-visitor`，不能跨认证域复用。升级前签发、没有 `iss`/`aud` 且直接使用旧根密钥签名的 token 仅在其原有 `exp` 之前走兼容验证；兼容解析仍要求 admin token 带 `role=admin` + `jti`、visitor token 带 provider 且不带 `jti`，旧 token 也不能跨认证域。带新域 claims 却使用旧根密钥签名的 token 会被拒绝。该兼容窗口最长为 visitor token 的 90 天，不会延长旧 token 的有效期。

登录失败的响应按失败原因分流，不把服务端故障伪装成密码错误：

| 情形 | 状态码 | 错误码 | 审计 |
| --- | --- | --- | --- |
| 用户名不存在或密码不匹配 | 401 | `INVALID_CREDENTIALS` | `admin.session.failed`（含 username 与源 IP，**绝不记录明文密码**） |
| 凭据存储不可读、会话 ID 生成失败或 `admin_sessions` 写入失败 | 500 | `SESSION_UNAVAILABLE` | 不写 `admin.session.failed` |

用户名不存在时仍会对一个固定的哑元 hash 执行一次 bcrypt 比较，使"用户名不存在"和"密码错误"的响应耗时一致，避免通过响应时间枚举用户名。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET/PUT` | `/api/v1/admin/profile` | 读取/全量更新 Profile、简历、兴趣、教育、经历、个人 Series 和联系方式 |
| `GET/PUT` | `/api/v1/admin/site` | 读取/全量更新站点设置 |
| `GET/PUT` | `/api/v1/admin/writings/config` | 读取/更新 Writings 置顶配置 |
| `GET/PUT` | `/api/v1/admin/thoughts/config` | 读取/更新 Thoughts 置顶配置 |
| `GET` | `/api/v1/admin/content` | 管理内容列表，支持 `kind`、`status`、`tag`（单值或多值，OR 语义）、`q`、`sort`、`page`、`pageSize` 和 `aiAssisted`，并返回 `viewCount` / `likeCount` / `commentCount` |
| `GET` | `/api/v1/admin/content/{id}` | 读取单条管理内容（含完整 body 与 metadata），供 Admin 详情页直接刷新恢复 |
| `POST` | `/api/v1/admin/content` | 创建 DRAFT |
| `PUT` | `/api/v1/admin/content/{id}` | 全量替换和类型转换，必须携带 `expectedVersion` |
| `POST` | `/api/v1/admin/content/{id}/comments` | 以管理员身份在该内容（含 DRAFT）下创建评论，201；输入与公开创建一致，审计 `comment.created` |
| `POST` | `/api/v1/admin/content/{id}/publish` | DRAFT -> PUBLISHED；目标不存在或已软删时返回 404 `CONTENT_NOT_FOUND`（软删内容不可通过状态迁移复活） |
| `POST` | `/api/v1/admin/content/{id}/unpublish` | PUBLISHED -> DRAFT，保留原始 `published_at`；目标不存在或已软删时返回 404 `CONTENT_NOT_FOUND` |
| `POST` | `/api/v1/admin/content/{id}/restore` | DELETED -> DRAFT，版本号 +1，200 返回 `AdminContent`；目标不存在返回 404 `CONTENT_NOT_FOUND`。仅对已软删内容有效——非软删目标由 store 以版本冲突表达，handler 未单独映射，因此返回 500 `CONTENT_RESTORE_FAILED` |
| `DELETE` | `/api/v1/admin/content/{id}` | 软删除，204；目标不存在或已软删时返回 404 `CONTENT_NOT_FOUND` |
| `GET` | `/api/v1/admin/comments` | 线程分页的管理评论列表（含已软删和隐藏，附 `deletedAt`/`hiddenAt`），支持 `contentId`/`q`/`page`/`pageSize`/`focus`；每行额外返回 `contentTitle`/`contentSlug`/`contentKind` |
| `DELETE` | `/api/v1/admin/comments/{id}` | 软删除评论，204 |
| `POST` | `/api/v1/admin/comments/{id}/restore` | 恢复软删评论，204 |
| `POST` | `/api/v1/admin/comments/{id}/hide` | 隐藏未删除评论，204；刷新可见评论计数并审计 `comment.hidden` |
| `POST` | `/api/v1/admin/comments/{id}/unhide` | 恢复隐藏评论，204；刷新可见评论计数并审计 `comment.unhidden` |
| `PUT` | `/api/v1/admin/comments/{id}` | 部分覆盖 `authorName`/`authorUrl`/`avatarSeed`，204；已删除评论返回 422 `COMMENT_DELETED`，审计 `comment.updated` |
| `GET` | `/api/v1/admin/stats` | `AdminStats`，包含 `content` |
| `GET` | `/api/v1/admin/overview` | `AdminOverview` 聚合：内容计数（含 `draftCount`）、`totalViews`/`totalLikes`/`totalComments`（均只统计未软删内容；`totalViews` 用累计 `view_count`，与分析页的去重事件口径设计上不等）/`activeVisitors`、近 12 个月 `created`/`published` 趋势（`published` 按不可变的首发 `published_at` 归月）、浏览量 Top 5 已发布内容和 Top 10 标签；TTL 快照缓存 |
| `GET` | `/api/v1/admin/analytics/views` | `AnalyticsViews`：`days`（默认 30，上限 90）范围内去重浏览事件总数、独立访客、逐日 `{date, views, uniqueVisitors}`（缺失日补零）和 Top 10 referrer（空记 `direct`） |
| `GET` | `/api/v1/admin/system` | `SystemStatus`：version、`startedAt`、`uptimeSeconds`、SQLite 体积、内容缓存条目、Go heap/goroutine/进程 RSS（`sysRssBytes`）和审计事件总数；`resources` 块（CPU 占比与逻辑核数、内存 used/total/percent、load average 1/5/15、数据库所在分区的磁盘 used/total/percent）和 `host` 块（`hostname`/`os`/`platform`/`kernelArch`）。资源指标经 gopsutil 采样，单项失败降级为零值不报错；CPU 采用 `cpu.Percent(0, false)` 非阻塞差值采样，进程启动后首次请求 CPU 占比为 0 |
| `GET` | `/api/v1/admin/audit` | `AuditEventCollection`：审计事件服务端分页，`page`（默认 1）、`pageSize`（默认 10，上限 50）、`q`（OR 匹配 `event_name`/`actor`/`resource_id`，≤200 字符）；响应附 `pagination: PagePagination`，`page` 超界时钳制到最后一页返回，按 `createdAt` 降序 |
| `POST` | `/api/v1/admin/session/logout` | 吊销当前会话（JWT `jti`），204；审计 `admin.session.revoked`。吊销后该 token 再请求返回 401 |
| `POST` | `/api/v1/admin/session/{id}/logout` | 按 id 吊销当前用户的指定会话（来自 session list），204；审计 `admin.session.revoked`。目标必须属于当前 subject（否则 404），吊销当前会话等价于 logout；已吊销/不存在的 id 幂等返回 204 |
| `POST` | `/api/v1/admin/session/logout-all` | 吊销该 subject 除当前外所有活跃会话，204；审计 `admin.sessions.revoked_all` |
| `GET` | `/api/v1/admin/session/list` | `AdminSessionList`：该 subject 的活跃会话（未吊销、未过期），按 `createdAt` 降序；吊销的会话即软删除，不再出现在列表中（`revoked_at` 仍保留在 `admin_sessions` 表供审计） |
| `POST` | `/api/v1/admin/password` | `ChangePasswordInput{currentPassword,newPassword}`，校验旧密码 → 写新 bcrypt hash → 吊销当前外所有会话，204；审计 `admin.password.changed`。旧密码错误返回 401 `INVALID_CREDENTIALS` |
| `GET` | `/api/v1/admin/media` | `Collection<Media>`：媒体库服务端分页，`page`（默认 1）、`pageSize`（默认 20，上限 50）、`q`（按文件名/ID 过滤，≤200 字符）；`url` 为绝对地址且键恒存在（不省略，服务端无法构造时为 `""`），按 `createdAt` 降序 |
| `POST` | `/api/v1/admin/media` | 上传媒体：raw bytes（非 multipart）+ `?filename=`；`http.DetectContentType` 嗅探并仅接受 png/jpeg/webp/gif/avif 图片与 `application/pdf`（拒绝 SVG 与其他类型，415）；超过 `CORE_MEDIA_MAX_BYTES` 返回 413；按 SHA256 去重幂等（重复上传返回已有记录，包括并发重复上传——去重是单条 `INSERT ... ON CONFLICT(sha256) DO NOTHING` 加回读，不是先查后插，因此抢输的一方返回既有行而不是 500）；媒体 id 为 `crypto/rand` 生成的随机值；响应 201 `Media`（含绝对 `url`，图片写进 Markdown 正文使用，PDF 用于 Profile resume 链接）；审计 `media.uploaded` |
| `DELETE` | `/api/v1/admin/media/{id}` | 物理删除媒体，204；删除前检查非删除内容正文是否引用该媒体，被引用则返回 409 `MEDIA_IN_USE`（`details.references` 列出引用内容），否则删除；审计 `media.deleted` |
| `GET` | `/api/v1/admin/media/{id}/references` | `{ references: [...] }`：非删除内容（DRAFT/PUBLISHED）正文中引用该媒体的列表，每项为 `MediaReference{ contentId, kind, title, slug, status }`；`status` 只可能是 `DRAFT`/`PUBLISHED`；未知 id 返回空列表 |
| `POST` | `/api/v1/admin/chain/anchors` | 管理员锚定提交：请求体与响应同公开通道（source = `admin`），无独立限流；语义见 [`docs/chain.md`](chain.md) |
| `GET` | `/api/v1/admin/agent/settings` | `AgentSettings`；返回 Provider、模型与运行上限，以及 `apiKeyConfigured`，不返回 API key 明文 |
| `PUT` | `/api/v1/admin/agent/settings` | 全量替换非密钥字段；`openAIBaseURL` 保存时会清理首尾空白、去掉尾部斜杠并确保路径包含 `/v1`；`apiKey` 省略时保留、字符串时替换、`null` 时清除；审计 `agent.settings.updated` |
| `GET` | `/api/v1/admin/agent/messages` | 当前 JWT `jti` 绑定的临时 user/assistant 消息 `{messages}`；assistant 消息可附带 `trace`（思考阶段、工具输入输出、结束原因与累计用量）；时间为 UTC RFC3339 |
| `POST` | `/api/v1/admin/agent/messages` | `{message}`（1..4000 字符）启动一次 Agent 运行，返回 `text/event-stream`；Provider 未配置时在建立流前返回 503 `AGENT_UNAVAILABLE` |
| `DELETE` | `/api/v1/admin/agent/messages` | 清空当前 session 的 Agent 对话，204 |
| `DELETE` | `/api/v1/admin/agent/messages/{messageId}` | Undo 指定用户消息：原子删除该消息及其后的全部消息，返回 `{draft,messages}`；目标不存在或不是用户消息时返回 404 `AGENT_MESSAGE_NOT_FOUND` |

Agent SSE 事件是判别联合：`run.started` → 每次模型调用的 `reasoning.started` / `reasoning.completed` → 可选的 `tool.started` / `tool.completed` → `content.delta` → `run.completed`；流建立后的失败以 `run.error` 收尾。`run.started.messageId` 是 Core 已写入 session memory 的用户消息 ID，Admin 用它把乐观消息替换为可 Undo 的稳定目标。reasoning 事件只表示运行状态，不包含模型隐藏推理文本。`run.completed.usage` 是本次工具循环内全部 Provider 调用的累计 token 数。

Agent Runtime 以 `Provider.Chat(ctx, ChatRequest) (*ChatResponse, error)` 为唯一模型边界；`ChatRequest` 统一 Messages/Tools/Model/Options，`ChatResponse` 统一 Content/ToolCalls/Usage/FinishReason。场景注册表按名称调用工厂，场景同时提供行为型 `PromptSpec` 与该场景允许的工具注册表；`PromptSpec.Build` 按固定顺序渲染 `ROLE`、`INSTRUCTION SCOPE`、`SOURCE PRIORITY`、`TOOL USE`、运行时生成的 `CAPABILITY BOUNDARIES`、`UNTRUSTED DATA HANDLING`、`KNOWLEDGE BOUNDARIES`、`SCOPE AND SAFETY`、`STYLE`、`UNCERTAINTY AND ERRORS`、`OUTPUT CONTRACT`。`ToolDefinition` 注册时必须显式提供名称、Provider `Description`、Prompt `Usage` 和合法 `Effect`；其中 `Usage` 用于工具用法的自然语言投影，`Effect` 同时用于能力边界投影和 Runtime 执行保护，`Description`/`Parameters` 只用于 Provider function schema；这些元数据不会发送到上游协议。`ToolRegistry` 是当前能力真相源：当前 Runtime 只执行 `read_only` 工具，写入和破坏性工具在授权机制落地前会被拒绝。Runtime 不包含 Manifold 业务工具选择。当前 `manifold` 场景提供 `get_current_time`、`calculator`、`get_user_profile`、`get_writings`、`get_thoughts`，锚定链启用时追加只读 `get_chain_status`。Context Builder 每次构建时从 PromptSpec 和当前工具注册表生成 system prompt，再拼接当前 session 最近消息和本次 user 消息；若消息数截断落在一轮对话中间，会丢弃开头孤立的 assistant 消息。内容工具只返回已发布内容的基本信息，不返回 Markdown body；链工具不提交证书。

Agent 设置由迁移 `0007` 的 `agent_settings` 单例保存，默认值为 OpenAI / `gpt-5-mini` / 6 个工具回合 / 40 条历史 / 2048 输出 token / `https://api.openai.com/v1`，API key 默认为空。Core 不读取对应的 `CORE_AGENT_*` 或 `CORE_OPENAI_*` 环境变量。`openAIBaseURL` 在保存和运行时都会清理首尾空白、去掉尾部斜杠，并在路径中缺少 `v1` 时自动补齐 `/v1`。每次运行前读取当前行；API key 为空时历史读取与清空仍可用，运行在建立 SSE 前返回 503 `AGENT_UNAVAILABLE`。API key 在 SQLite 中保存，但响应、审计元数据和日志仅暴露是否已配置。

对话记忆由 `internal/agent` 中的 `SessionMessageRepository`/`SessionMemory` 能力接口和 `Memory` 进程内实现承载，以 Admin JWT `jti` 隔离；运行服务与 HTTP handler 不依赖具体内存类型。持久消息类型为 `SessionMessage`，与 Provider 对话使用的 `Message` 分开。Run、List、Clear 与 Undo 统一经过 session 锁，清空或注销不会与正在生成的同 session 回复交错。assistant 消息同时保存不含隐藏推理文本的运行摘要，供 Admin 重新打开 Agent 时恢复思考卡片。Undo 以用户消息 ID 为边界，删除该消息及所有后续 user/assistant 消息，使下一次运行从重组后的历史继续。显式清空、当前/指定 session 注销、logout-all 和改密码吊销其他 session 时删除对应记忆；Core 重启也会全部丢失。该路径不写 SQLite，不属于 `docs/chain.md` 第 4 节的数据库写清单，也不产生锚定证书。

内容创建和更新的 Article 必须有非空 `title` 和 `slug`；Thought 两者可为空。更新使用 PUT，必须提交完整内容和 `expectedVersion`，版本不匹配返回 `409 VERSION_CONFLICT`。类型转换为 Article 时，最终 title/slug 也必须满足 Article 规则。

更新 Thoughts 配置时，`pinnedIds` 整体替换置顶集合：每个 ID 必须引用当前已发布的 `THOUGHT` 且不重复；Article、草稿、软删除或不存在的 ID 返回 `422 VALIDATION_ERROR`。传 `[]` 表示清除所有置顶。Writings 配置同构。Admin 列表可用 `pinned=true` 仅过滤已置顶内容。

`PUT /admin/profile` 是全量替换，字段约束由 Core 校验，Admin 表单的 zod schema 只是同一组规则的即时反馈、不是权威：`displayName` 必填且 ≤160 字符；`handle` ≤80、`headline` ≤240、`bio` ≤4000、`location` ≤160、`organization` ≤160；`avatarUrl`、`websiteUrl`、`resumeUrl` 允许为空，非空时必须是 `http(s)://` 绝对地址；`interests` 每项非空且 ≤60；`education`/`experience` 每项的机构、项目/职位名非空且 ≤160、`period` 非空且 ≤80；`series` 每项 `name` 非空 ≤160、`url` 必填且为 `http(s)` 或 `mailto`、`description` ≤400、`category` ≤80；`contacts` 每项 `label` 非空 ≤80、`url` 必填且为 `http(s)` 或 `mailto`、`handle` ≤120、`icon` ≤40。长度按字符（Unicode code point）计而非字节，CJK 内容因此不会被提前拒绝。任一字段不合规返回 `422 VALIDATION_ERROR` 且不写入任何字段；URL scheme 白名单是公开站点把这些值直接渲染进 `href` 时的边界，`javascript:`、`data:` 等一律拒绝。

## 7. 数据模型

`content` 是统一内容表：

| 字段 | 约束 |
| --- | --- |
| `id` | 主键 |
| `kind` | `THOUGHT` 或 `ARTICLE` |
| `status` | `DRAFT`、`PUBLISHED`、`DELETED` |
| `slug` | 非空、全局唯一；Article 和 Thought 均必须由输入提供 |
| `title` | 可空；Article 必填 |
| `summary/body/excerpt/metadata_json` | Markdown、Core 派生摘要和类型 metadata；标签独立存储在 `content_tags` |
| `published_at/created_at/updated_at/version` | 生命周期、时间和乐观并发；`published_at` 是首次发布的不可变事实——publish 仅在为 NULL 时写入，unpublish 保留，重新发布不重置 |
| `view_count` | 公开详情读取时同步递增的持久化浏览量 |

Metadata：Thought 使用 `mood/question/context/source`；Article 使用 Core 派生的 `readingMinutes/toc` 与可编辑的 `language/aiAssisted`。`excerpt` 在保存时由 Core 从正文生成并持久化。客户端不得提交派生字段，未知 metadata 字段和错误 null/type 直接拒绝。

锚定链三表由迁移 `0005` 引入；迁移 `0006` 引入第三方身份和评论 provider 字段，迁移 `0007` 引入 Agent 设置；当前 Core `schemaVersion` 为 7。

其他表包括 `profile`、`site_config`、`thoughts_config`、`writings_config`、`agent_settings`、`pins`、`comments`、`likes`、`presence`、`audit_events`、`content_view_events`、`media`、`admin_credentials`、`admin_sessions`、`identities`，以及锚定链三表（迁移 `0005`，当前 `schemaVersion` 7）。链表结构、只增不改不变量与全部链语义见 [`docs/chain.md`](chain.md)。

`agent_settings` 是 `agent_1` 单例，保存 Provider、模型、运行上限、OpenAI Base URL 与 API key；管理 API 不回传 key 明文。`media`（`id`、`mime`、`size`、`sha256 UNIQUE`、`filename`、`data BLOB`、`created_at`）保存上传的媒体字节（图片与 PDF），按 SHA256 去重（相同字节复用同一行）；`mime` 只允许 png/jpeg/webp/gif/avif 与 `application/pdf`（上传时嗅探，SVG 永不入库）；公开访问 `GET /api/v1/media/{id}` 依赖该表，缓存语义见路由表。`admin_credentials`（`id`、`username`、`password_hash`、`updated_at`）保存管理员 bcrypt 凭据：首次启动用 `CORE_ADMIN_PASSWORD_HASH` 播种一行，之后以 DB 行为权威，`CORE_ADMIN_PASSWORD_HASH` 不再覆盖（改密码写入此行、重启保留）。`admin_sessions`（`id`（= JWT `jti`）、`subject`、`created_at`、`expires_at`、`revoked_at`）支持可撤销会话：登录时插入一行，`RequireAdmin` 每次校验 `revoked_at IS NULL AND expires_at > now`，`logout`/`logout-all`/改密码都会写 `revoked_at`。`content_view_events` 是浏览事件表（`content_id`、`visitor_id`、`referrer`（origin 或空）、`day`（UTC 日期）、`created_at`）：识别访客通过部分唯一索引 `(content_id, visitor_id, day) WHERE visitor_id != ''` 按"同人同内容同 UTC 日"去重，匿名浏览每次插入一条；该表驱动 `GET /admin/analytics/views`，与累计 `view_count` 并存——`view_count` 保持无条件递增，分析口径只统计去重事件，Admin 侧两处浏览量（Overview 的 `totalViews` 与 Analytics 的 `totalViews`）设计上不相等，差异即匿名与重复访问。`thoughts_config` 是 `thoughts_1` 单例，仅保留 `updated_at`；`writings_config` 是 `writings_1` 单例，同构。置顶由 `pins` 表承载：`pins`（`content_id` 主键、`content(id)` 外键 `ON DELETE CASCADE`、`kind`、`position`、`created_at`），每个 kind 按 `(kind, position)` 排序，置顶顺序即插入/替换顺序。Core 为归档查询维护 `(kind,status,published_at DESC)` 索引。`content.view_count` 在公开详情读取时同步原子递增，列表响应直接返回该持久化计数；`likeCount` 从 `likes` 聚合，`commentCount` 只统计未删除且未隐藏评论（隐藏只影响被选中的行，回复不级联），评论创建、隐藏/取消隐藏、软删除或恢复时 Core 会失效对应内容详情缓存并刷新 Admin Overview。详情读取同时写入 `audit_events(event_name = 'content.viewed', resource_type = 'content')` 供观测使用，审计队列丢弃不会影响浏览量统计。Profile 包含 `resume_url`、`interests_json`、`education_json`、`experience_json`、`series_json`、`contacts_json`；Series 项为 `{name,url,description,category}`（category 可为 null），联系方式为 `{label,url,handle,icon}`（handle/icon 可为 null）；`site_config` 是 `site_1` 单例，包含站点身份列（`title`、`description`、`footer_text`、`social_json`、`comments_enabled`）与首页组合列（`navigation_json`、`sections_json`）。评论创建即公开（无审核状态，`deleted_at` 软删标记，`hidden_at` 隐藏标记，二者正交，公开列表保留隐藏行但脱敏），可见性索引为 `idx_comments_content_visibility (content_id, created_at) WHERE deleted_at IS NULL`；`comments` 额外含 `author_provider`（`visitor`/`github`，默认 `visitor`）与 `author_avatar_url`（账号头像快照，匿名评论为空字符串）两列。`identities`（`id` 主键形如 `identity_github_<providerID>`、`provider`、`provider_id`、`display_name`、`avatar_url`、`created_at`、`updated_at`）以 `UNIQUE(provider, provider_id)` 记录第三方登录身份，OAuth 换发时 upsert 刷新展示名/头像；visitor 会话 JWT 只携带身份引用与展示信息，不接触 admin 凭据。点赞有 `(content_id, visitor_id)` 唯一约束；Presence 只保存匿名 visitor ID 的最近心跳时间，过期窗口为 5 分钟。

> **不兼容历史 schema**：程序按版本顺序应用迁移，旧库（版本低于 binary）原地升级；只有版本高于 binary 的库才拒绝启动，提示升级 Core binary。

## 8. 缓存、审计和关闭

- Core 启动时先解析种子计划（可能读取 `CORE_SEED_FILE`），再绑定 `CORE_ADDR`；成功后才打开 SQLite、执行 schema 初始化与空库种子应用；端口冲突会直接退出且不修改数据库。
- 内容详情使用最多 256 项的 TTL LRU；Core 启动时预热归档置顶的 Writing 与 Thought（Thought 以公开 URL 的内容 ID 为 key，Writing 以 slug 为 key，无 slug 时跳过）。公开详情记录浏览量后使用事务返回的最新 `view_count` 更新响应和缓存，避免缓存命中延长旧计数的存活时间。
- 缓存失效按内容可能被服务的全部 key 进行：内容 ID（Thought 详情 URL）与 slug（Writing 详情 URL 及 Thought 的可选 slug），不再整表清空；内容创建、更新、发布、撤回、删除、点赞变化与评论创建、隐藏/取消隐藏、软删/恢复和作者资料更新都会清理相关缓存。
- Stats 与 Admin Overview 各使用单条 TTL 快照（共用 `CORE_STATS_CACHE_TTL`）。
- 审计事件通过有界异步队列写入 `audit_events`；队列满会记录丢弃但不让业务请求失败。
- `RouterWithLifecycle` 用于生产入口；监听失败会结束进程，正常关闭时先取消并等待矿工 goroutine，再最多等待 5 秒排空已接受的审计事件；`Router` 仅用于同步内部调用/测试。分层现状：HTTP handler 负责协议边界，**读路径直接调用 `internal/store`**，不经过 `internal/application`；`internal/application` 只承载写用例，以及随写发生的 audit、anchor 和 cache 失效编排；`internal/store` 隐藏 SQLite 查询。依赖方向因此是 handler → store（读）与 handler → application → store（写）两条无环路径，读路径不做二次封装是当前的分层选择而非缺失。公共 HTTP 契约不受启动生命周期影响。
- 发布包 supervisor 在 Web 子进程异常退出时按退避独立重启 Web，Core 和 Admin 保持运行；连续 5 次立即失败后停止重启并记录 `service_restart_limit_reached`（此时 Core/Admin 仍在运行、`status` 报告 Web unhealthy），Web 连续运行满 60 秒后失败计数清零；Core 异常退出或 Admin 监听失败时才向其余进程发送 SIGTERM。`stop` 等待正常退出，超时后才发送 SIGKILL。包内后台运行不包含开机自启、日志轮转、HTTPS 或反向代理。
- Core 限流默认按 TCP 对端地址分桶。仅当对端位于 `CORE_TRUSTED_PROXY_CIDRS` 时才读取 `X-Real-IP`；反向代理必须覆盖并清洗该头，不能透传客户端输入。该配置只改变限流身份识别，不改变 HTTP 契约。
- 请求取消沿调用链传播：`internal/store` 与 `internal/chain` 的每个方法都以 `context.Context` 为首参，SQL 一律走 `QueryContext`/`QueryRowContext`/`ExecContext` 和 `BeginTx(ctx, nil)`，handler 传入 `r.Context()`。因此客户端断开或进程关闭会中止在途查询与整链回放，而不是让一个已经没人等待的请求跑完。三处各自持有 context 来源：矿工 `OnMined` 回调用矿工自身的 lifetime context（关闭矿工即取消），审计 dispatcher 的落库 sink 用 detached context（事件在产生它的请求结束之后才被排空），`store.Open` 用启动 context，使关闭能中断迁移与种子应用。仅测试调用的 `MineOnce`/`InsertBlock` 包装仍用 `context.Background()`，生产路径不经过它们。本次未新增数据库写路径，`docs/chain.md` §4 锚定清单无需登记新 source。**公共 HTTP 契约、路由、字段、枚举与状态码均未变化。**

### 依赖记录：github.com/shirou/gopsutil/v4

- 用途：`GET /admin/system` 的服务器资源与主机信息只读采样（CPU 占比/核数、内存、load average、数据库所在磁盘分区、进程 RSS、hostname/platform/kernelArch）。
- 替代方案：手写 `/proc` 解析仅覆盖 Linux，否决；gopsutil 是 Go 生态资源采样的事实标准且跨 macOS/Linux。
- 权衡与安全边界：纯 Go 无 cgo，只读系统信息，无新增攻击面；引入其纯 Go 子依赖树，二进制体积小幅增加，无网络行为。资源采样失败一律降级零值，不影响业务可用性。

## 9. 修改与验证清单

修改 Core 时必须检查：

- 路由/字段/状态码是否需要同步 `packages/contracts`、`packages/sdk`、`docs/admin.md`、`docs/decisions/web.md`、`docs/chain.md`（链行为或锚定清单）。
- schema 是否同时修改 `app/core/db/migrations/` 与测试。
- **新增任何数据库写路径时，必须按 `docs/chain.md` §4 登记锚定清单（source/payload/metadata）或说明例外，并接入 `anchorBusinessChange`；不允许静默绕过锚定清单。**
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
