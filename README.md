# Manifold

Manifold 是一个 API-first 的个人 digital garden：同一套内容和个人资料模型，同时服务公开阅读端与私有管理端。

当前产品包含：

- Web 首页、写作归档、文章详情和 SEO 元数据。
- `THOUGHT` 与 `ARTICLE` Markdown 内容，支持标签、搜索和页码分页；文稿支持数学公式、代码高亮和一键复制代码。
- Thoughts 是轻量碎记；Articles 提供由 Core 派生的阅读时长和目录。
- 匿名评论提交与 Admin 评论管理、`LIKE` 访客反应。
- Admin 登录、可撤销会话（logout/logout-all）、在线改密码、内容发布生命周期、评论管理、Profile、Site 和首页 composition 管理。
- Go Core、SQLite、JWT + Casbin 鉴权（DB 会话校验、可撤销）、请求/追踪 ID、审计事件和 TTL 缓存。
- **锚定链**：Core 内嵌单写者 PoW 锚定链——每次业务数据变更自动锚定为可验证承诺（只存哈希、站点密钥签名），公开访客也可提交任意 payload 求锚定；sim/proof 双挖矿模式 + 缓冲成块，全链重放验证。`/chain` 提供轻量入口，`/chain/explorer` 浏览区块与证书，`/chain/tools` 提供验证与公开提交，详情页展示锚定徽标。契约见 [`docs/chain.md`](docs/chain.md)。

## 架构

```text
Browser
  |                         +----------------------+
  +--> app/web (Next.js) ---|                      |
  +--> app/admin (Vite) ----| @manifold/sdk ------+--> app/core (Go REST)
                            | @manifold/contracts |          |
                            | @manifold/render    |          +--> SQLite
                            +----------------------+
```

Core 是唯一拥有业务持久化的服务。Web/Admin 不导入 Go 代码、不读取 SQLite；跨端类型来自 `packages/contracts`，HTTP 调用集中在 `packages/sdk`。

## 仓库结构

| 路径 | 作用 |
| --- | --- |
| [`app/core`](app/core/README.md) | Go API、配置、鉴权、SQLite store、缓存、审计和领域模型 |
| [`app/web`](app/web/README.md) | Next.js 公开阅读端，默认端口 `3000` |
| [`app/admin`](app/admin/README.md) | React + Vite 私有管理端，默认端口 `5173` |
| `packages/contracts` | 共享 TypeScript API 类型 |
| `packages/sdk` | 基于原生 `fetch` 的强类型 API 客户端 |
| `packages/render` | Web/Admin 共用的 Markdown 与内容阅读渲染器 |
| `docs/design-system` | 设计 token、组件规范和校验工具 |
| `scripts/browser-check.cjs` | Playwright Web/Admin 验收流程 |
| `app/*/README.md` | 各项目的背景、架构、运行方式和边界 |

详细契约与同步规则：

- [`AGENTS.md`](AGENTS.md)：项目背景、架构边界、文档同步准则和验证门槛。
- [`docs/core.md`](docs/core.md)：Core 当前 API、数据模型和架构。
- [`docs/chain.md`](docs/chain.md)：锚定链契约——证书/区块结构、哈希与签名、变更锚定清单、挖矿与验证。
- [`docs/admin.md`](docs/admin.md)：Admin 工作区、API 调用和状态流。
- [`docs/decisions/web.md`](docs/decisions/web.md)：Web 当前路由、数据流和阅读器架构。
- [`docs/web.md`](docs/web.md)：Web 公共行为摘要和阅读能力索引。
- [`docs/decisions/`](docs/decisions/)：架构决策与当前实现背景。
- [`packages/contracts/README.md`](packages/contracts/README.md)：共享 TypeScript 契约。
- [`packages/sdk/README.md`](packages/sdk/README.md)：Core SDK 方法和请求约定。

## 前置条件

- Node.js `>=20.9`（Next.js 16）
- pnpm `11.19.0`
- Go `1.26.5` 或更新版本
- 浏览器回归需要 Playwright Chromium

## 快速开始

Core、Web、Admin 是独立进程。Core 首次启动会创建当前 SQLite schema、创建父目录并写入演示数据；旧 schema 的数据库会原地增量升级，只有比当前 binary 更新的数据库才拒绝启动。

```bash
pnpm install
make core-run
```

另开终端启动两个前端（开发 supervisor 会分别托管 Web/Admin；任一前端异常退出后按退避自动重启，同一服务连续 5 次立即失败后停止重启并提示原因，运行满 60 秒后失败计数清零）：

```bash
pnpm dev
```

打开：

- Web：<http://localhost:3000>
- Admin：<http://localhost:5173>
- Web 健康检查：<http://localhost:3000/health>
- Core 健康检查：<http://localhost:8080/healthz>

默认代码配置已能在这些端口运行。自定义配置时：

```bash
cp .env.example .env
```

Core 启动时会自动从工作目录向上查找并加载 `.env`（`make core-run` 在 `app/core` 内执行，会找到仓库根目录的 `.env`）；Next.js 和 Vite 本身就会读取根目录 `.env`。已有环境变量优先于 `.env` 文件；`.env` 中的值原样使用、不做 shell 展开，因此 bcrypt 哈希中的 `$` 无需转义，也不需要 `source .env`。

Admin 的 `VITE_CORE_URL` 必须指向 Core（默认 `http://localhost:8080`），不是 Admin 的 `5173`。

## 配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CORE_ENV` | `development` | Core 运行环境；发布包必须设为 `production` |
| `CORE_ADDR` | `:8080` | Core 监听地址 |
| `CORE_DATABASE_PATH` | `./data/manifold.db` | SQLite 文件路径 |
| `CORE_ALLOWED_ORIGINS` | `http://localhost:3000,http://localhost:5173` | CORS 来源，逗号分隔 |
| `CORE_TRUSTED_PROXY_CIDRS` | 空 | 可提供可信 `X-Real-IP` 的反向代理网段；同机 OpenResty 使用 `127.0.0.1/32,::1/128` |
| `CORE_JWT_SECRET` | `manifold-dev-secret-change-me` | JWT 根密钥；Core 按 admin/visitor 用途派生独立签名子密钥，生产环境必须更换 |
| `CORE_ADMIN_USERNAME` | `admin` | 管理用户名 |
| `CORE_ADMIN_PASSWORD_HASH` | `.env.example` 中的 bcrypt 哈希 | 管理密码哈希，不要写明文；发布配置留空时由打包脚本生成 |
| `CORE_CONTENT_CACHE_TTL` | `30s` | 内容详情缓存 TTL |
| `CORE_STATS_CACHE_TTL` | `30s` | 统计缓存 TTL |
| `CORE_AUDIT_EVENT_BUFFER` | `256` | 审计队列容量 |
| `CORE_SEED_FILE` | 空 | 自定义种子 JSON；留空时开发环境用内置演示数据，生产环境只初始化骨架、内容库为空（详见 `docs/core.md` 种子数据章节） |
| `CORE_CHAIN_PROOF_MODE` | `sim` | 锚定链挖矿模式：`sim` 固定延迟出块，`proof` 真跑 SHA-256 碰撞（详见 `docs/chain.md`） |
| `CORE_CHAIN_DIFFICULTY` | `6` | proof 模式前导 0 十六进制位数，合法区间 `[1, 6]`，越界拒绝启动；sim 下忽略 |
| `CORE_CHAIN_SIM_DELAY` | `1s` | sim 模式模拟挖矿延迟 |
| `CORE_CHAIN_BATCH_SIZE` | `32` | 缓冲满阈值：pending 证书达到该数量立即打包 |
| `CORE_CHAIN_MAX_BLOCK_ANCHORS` | `500` | 单块证书上限 |
| `CORE_CHAIN_FLUSH_TIMEOUT` | `30s` | 防饿死阀门：最老 pending 等待上限 |
| `CORE_CHAIN_ANCHOR_MAX_BYTES` | `65536` | 公开/Admin 锚定提交 payload 上限，超限 413 |
| `NEXT_PUBLIC_CORE_URL` | `http://localhost:8080` | Web 请求 Core 的地址 |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | canonical/metadata 基准地址 |
| `VITE_CORE_URL` | `http://localhost:8080` | Admin 请求 Core 的地址 |
| `VITE_WEB_URL` | `http://localhost:3000` | Admin 中公开内容链接的 Web 基地址 |
| `ADMIN_PUBLIC_URL` | 空 | 发布清单中的 Admin 公开 origin；独立域名反向代理时必须设置 |

本地默认管理账号为 `admin`，密码为 `password`。生产环境请立即通过 `CORE_ADMIN_USERNAME` 和 `CORE_ADMIN_PASSWORD_HASH` 替换。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 由开发 supervisor 启动 Web 和 Admin，不启动 Core；异常退出自动重启 |
| `make core-run` | 启动 Go API |
| `pnpm build` | 构建全部 workspace |
| `pnpm check` | TypeScript 类型检查 + 设计系统 token 漂移与模板 lint |
| `pnpm test` | 发布脚本与 workspace 测试（不含 Go） |
| `pnpm package:release -- --env .env.production` | 生成 Linux x64 glibc 三端发布 zip |
| `make core-test` | `go test ./...` |
| `make test` | Go + workspace 测试 |
| `make check` | `go vet ./...` + `pnpm check` |
| `pnpm browser-install` | 安装 Chromium |
| `pnpm browser-test` | 临时启动三端，回归 Web 评论/反应和 Admin 评论管理 |
| `pnpm --filter @manifold/web lint` | Web ESLint |
| `pnpm --filter @manifold/admin lint` | Admin Oxlint |

浏览器脚本默认使用临时端口和数据库，结束后清理。已有 Chrome 可设置 `MANIFOLD_CHROME_PATH`；可用 `MANIFOLD_*` 覆盖地址、测试文章或凭据。连接外部服务会执行写操作，必须显式设置 `MANIFOLD_ALLOW_EXTERNAL_MUTATIONS=1`。

## Linux 发布包

发布脚本支持在 macOS arm64 或 Linux 构建面向 Linux x64 glibc 的归档。构建机需要 Node.js `>=20.9.0`、pnpm `>=11.19.0`、Go `>=1.26.5` 和 Info-ZIP；目标服务器只需要 Node.js `>=20.9.0`、glibc `>=2.28`、支持 SSE4.2 的 x64 CPU 和 unzip。

先从 `.env.example` 创建独立的 `.env.production`，把所有公开 URL 改为最终 IP、端口或 HTTPS 域名，并设置 `CORE_ENV=production` 与非默认 `CORE_JWT_SECRET`。`CORE_ADMIN_PASSWORD_HASH` 可以预先填写非默认 bcrypt hash，也可以留空让打包脚本生成。发布配置还必须保持 `CORE_ADDR=:8080`、`CORE_DATABASE_PATH=./data/manifold.db`，并让 `CORE_ALLOWED_ORIGINS` 同时包含 Web 和 Admin 的公开 origin。三个独立域名部署还需设置 `ADMIN_PUBLIC_URL`；内部监听端口仍固定为 `3000/5173/8080`。发布脚本不会执行 shell `source`，bcrypt 中的 `$` 会原样保留。

```bash
pnpm package:release -- --env .env.production
```

当 `CORE_ADMIN_PASSWORD_HASH` 为空时，打包脚本先生成随机初始密码，通过 Core 使用的 bcrypt 实现计算 hash，再以 `0600` 权限原子写回该配置文件。初始用户名和明文密码只在终端显示一次，必须立即保存到密码管理器；后续打包复用已写回的 hash，不会再次重置密码。CI 日志可能持久化终端输出，不应在不受保护的公共 CI 中使用自动生成模式。

产物位于 `dist/releases/manifold-<git-sha>-linux-x64-glibc.zip`。归档包含 Linux Core 二进制、Next.js standalone、Admin 静态文件、生产 `.env` 和运行管理器，不包含数据库、日志或 PID；打包校验会拒绝任何 `.db`、`.db3`、`.sqlite`、`.sqlite3` 及其 `-wal`/`-shm` 侧车文件。由于 `.env` 含生产密钥，归档必须通过受保护通道传输并限制访问。

上传并解压后，文件会直接落在目标目录，不会额外套一层版本目录；在该目录运行：

```bash
./manifold start
./manifold status
./manifold restart
./manifold stop
```

`start` 在后台启动 Web `:3000`、Admin `:5173` 和 Core `:8080`，完成三项健康检查后才返回。PID 状态位于 `run/manifold.pid`，日志位于 `logs/`；`.env`、日志和归档使用 `0600`，`data/`、`logs/`、`run/` 使用 `0700`。Web 意外退出时 supervisor 会按退避独立重启 Web，保留 Core 和 Admin；连续 5 次立即失败（缺少 `server.js`、端口冲突这类起不来的情况）后停止重启并写入 `service_restart_limit_reached`，此时 Core 与 Admin 仍在运行、`status` 报告 Web unhealthy，需要人工 `restart`；Web 连续运行满 60 秒后失败计数清零，因此偶发崩溃不会累积到上限。Core 意外退出或 Admin 监听失败时才停止整组服务。首次启动在 `data/manifold.db` 初始化空的生产站点骨架。发布包不会注册开机自启或终止 TLS，但支持由 OpenResty 等反向代理公开三个服务。

包内服务继承 supervisor 的环境，但 `CORE_`、`NEXT_PUBLIC_`、`VITE_` 三个前缀一律剔除后重新注入包内 `.env`，因此宿主机的 `CORE_*` 无法覆盖归档配置（这是真正重要的那一条）。`NEXT_PUBLIC_*`/`VITE_*` 的剔除只是纵深防御——二者在构建期已内联进产物，运行时值本来就到不了前端；`NODE_ENV`/`PORT`/`HOSTNAME` 与 `MANIFOLD_*` 仍会透传，前三个由 supervisor 按服务显式设置覆盖，后者是 supervisor 自身的控制变量。

`run/manifold.pid` 是 JSON 记录，含 supervisor PID、启动 token、发布根目录和当前受管服务的 PID，由 supervisor 在子进程集合变化时重写。写入走临时文件加 `link`/`rename`，因此并发读者不会看到半截记录；`start`/`stop`/`status` 只在 PID 存活**且**命令行匹配该记录时才认为部署在运行，所以旧格式记录或被复用的 PID 不会被误信。supervisor 被 `SIGKILL` 或机器断电时不会执行清理，受管服务会继续占用 `3000/5173/8080`：此时 `status` 报告 supervisor 已退出并提示执行 `stop`，而 `start` 和 `stop` 都会按记录中的子进程 PID 回收这些孤儿进程（逐个确认命令行指向同一发布根目录后才发信号，并输出 `Reclaimed N orphaned service process(es)`），端口随即释放。

OpenResty 使用独立域名时，将 Web、Admin、Core 分别代理到 `http://127.0.0.1:3000`、`http://127.0.0.1:5173`、`http://127.0.0.1:8080`。三个 location 都应传递 `Host $host`、`X-Forwarded-Proto $scheme`，Core 还必须传递由 OpenResty 清洗后的 `X-Real-IP $remote_addr`；只有来源命中 `CORE_TRUSTED_PROXY_CIDRS` 时 Core 才用该值区分限流客户端。若 OpenResty 位于 Cloudflare 后方，先用 realip 模块和 Cloudflare 官方网段恢复 `$remote_addr`，不要直接透传客户端可伪造的请求头。服务器防火墙应阻止公网绕过代理直接访问 `3000/5173/8080`。

`data/` 必须独立备份并跨版本保留。没有在线 SQLite 备份工具时，先执行 `./manifold stop`，完整复制 `data/`，再执行 `./manifold start`，避免复制数据库时遗漏 WAL 状态。

升级时把新 zip 解压到旧版本的同级目录，先在旧目录执行 `./manifold stop`，再将旧目录的 `data/` 完整复制到新目录并确认权限仅部署用户可读写，最后在新目录执行 `./manifold start` 和 `./manifold status`。确认新版本正常前保留旧目录和独立数据库备份；不要直接覆盖正在运行的发布目录。

## 产品入口

### Web

- `/`：Profile、统计和最近内容。
- `/writing`：公开内容归档。
- `/writing/:slug`：Markdown 详情、标签、评论和反应。
- `/thoughts`：Thoughts 时间线归档。
- `/thoughts/:slug`：Thought 详情、评论和反应。
- `/chain`：锚定链概览与入口。
- `/chain/explorer`：按页浏览区块/证书，筛选证书并查看详情。
- `/chain/tools`：按 payload/哈希/slug/comment 查证，提交公开锚定并查看 pending 记录。

正文使用 `react-markdown` + `remark-gfm` + `rehype-sanitize`；评论无需注册，反应通过浏览器持久化的 `X-Visitor-ID` 区分访客。

### Admin

登录后提供 Dashboard、Thoughts、Writings、Comments、Media、Profile 和 Settings 工作区，并可从顶部打开居中的 Agent 对话框。Agent 的 Provider、模型、运行上限、OpenAI Base URL 与 API key 在 Settings 中管理，不使用发布环境变量；对话仅使用当前 Admin session 的进程内记忆，可读取作者画像、已发布内容摘要和链状态，不读取正文。Admin 使用 Core 签发的 Bearer JWT；当前没有公开注册、访客登录或多用户账号体系。

## Core API 概览

基础路径为 `/api/v1`。集合统一返回 `{ data, pagination }`；内容列表支持 `kind`、`tag`、`q`、`page`、`pageSize`、`sort` 和 `aiAssisted`。

公开接口：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/healthz` | 健康检查和版本 |
| `GET` | `/api/v1/profile`、`/api/v1/site` | 资料和首页 composition |
| `GET` | `/api/v1/content` | 内容流和筛选列表 |
| `GET` | `/api/v1/content/:slug` | Markdown 详情 |
| `GET/POST` | `/api/v1/content/:slug/comments` | 评论读取/提交 |
| `GET/PUT/DELETE` | `/api/v1/content/:slug/likes` | 点赞统计、添加和移除 |
| `GET` | `/api/v1/stats` | 统计 |

公开接口（锚定链，见 [`docs/chain.md`](docs/chain.md)）：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/api/v1/chain` | 链概览：高度、证书数、pending、模式、站点公钥 |
| `POST` | `/api/v1/chain/anchors` | 公开提交任意 payload 求锚定（限流 + 64KB 上限，只存哈希） |
| `GET` | `/api/v1/chain/anchors`、`/api/v1/chain/blocks` | 证书/区块列表与详情 |
| `GET/POST` | `/api/v1/chain/verify` | 按哈希或贴原文查证（含全链完整性重放） |

管理接口位于 `/api/v1/admin`，除 `POST /session` 外都需要 `Authorization: Bearer <token>`，覆盖 Profile、Site、Content、Comments、Media 和 Stats 的读写。

错误统一为 `{ error: { code, message, details?, requestId?, traceId? } }`；Core 会返回 `X-Request-ID` 和 `X-Trace-ID`。具体实现说明见 [`app/core/README.md`](app/core/README.md)、[`app/web/README.md`](app/web/README.md) 和 [`app/admin/README.md`](app/admin/README.md)。

## 数据与生命周期

- SQLite 由 Core 独占；迁移按版本顺序原地升级旧库，只有比 binary 更新的数据库才拒绝启动。
- Content 类型为 `THOUGHT`、`ARTICLE`；状态为 `DRAFT`、`PUBLISHED`、`DELETED`。
- 更新带 `expectedVersion`；版本冲突会拒绝覆盖。
- 删除是软删除；草稿和已删除内容不进入公开接口。
- 评论创建后立即公开；删除通过 `deleted_at` 隐藏评论或整条线程。
- 反应按 `(content, visitor, kind)` 唯一，`PUT` / `DELETE` 幂等。
- 内容详情和已发布统计使用 TTL 缓存；状态变化会失效对应缓存。
- 审计事件通过有界异步队列写入 SQLite；队列满不会让原始请求失败。
- 锚定链：每次业务数据变更（内容、评论、点赞、Profile、Site、媒体、认证）自动提交承诺证书，缓冲成块后由后台矿工挖块确认；心跳、浏览事件和审计事件是登记在案的例外。链表只增不改，验证走全链重放。详见 [`docs/chain.md`](docs/chain.md)。

## 当前边界

当前产品范围聚焦首页、Profile、Site、Thoughts、Writings、Comments、Media、Likes 和 Stats。跨资源搜索、经历详情和 research series 不属于当前产品范围。

## 贡献

提交前运行：

```bash
make test
make check
pnpm build
```

跨端类型先改 [`packages/contracts/src/index.ts`](packages/contracts/src/index.ts)，HTTP 调用通过 [`packages/sdk/src/index.ts`](packages/sdk/src/index.ts) 暴露；不要让前端直接拼接 Core 请求或访问 SQLite。提交信息使用 Conventional Commits，例如 `feat(core): add entries endpoint`。更多约定见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。
