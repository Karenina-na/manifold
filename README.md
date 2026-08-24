# Manifold

Manifold 是一个 API-first 的个人 digital garden：同一套内容和个人资料模型，同时服务公开阅读端、私有管理端和未来的研究/经历扩展。

当前 MVP 已包含：

- Web 首页、写作归档、文章详情和 SEO 元数据。
- `THOUGHT` 与 `ARTICLE` Markdown 内容，支持标签、搜索和 cursor 分页；文稿支持数学公式、代码高亮和一键复制代码。
- Thoughts 是轻量碎记；Articles 是带阅读时长、目录和 frontmatter 的深度文稿。
- 匿名评论提交与 Admin 审核、`LIKE`/`FAVORITE` 访客反应。
- Admin 登录、内容发布生命周期、评论审核、Now、Profile 和首页 composition 管理。
- Go Core、SQLite、JWT + Casbin 鉴权、请求/追踪 ID、审计事件和 TTL 缓存。

## 架构

```text
Browser
  |                         +----------------------+
  +--> app/web (Next.js) ---|                      |
  +--> app/admin (Vite) ----| @manifold/sdk ------+--> app/core (Go REST)
                            | @manifold/contracts |          |
                            +----------------------+          +--> SQLite
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
| `scripts/browser-check.cjs` | Playwright Web/Admin 验收流程 |
| `app/*/README.md` | 各项目的背景、架构、运行方式和边界 |

## 前置条件

- Node.js `>=20.9`（Next.js 16）
- pnpm `11.19.0`
- Go `1.26.5` 或更新版本
- 浏览器回归需要 Playwright Chromium

## 快速开始

Core、Web、Admin 是独立进程。Core 首次启动会自动建表、创建 SQLite 父目录，并对旧内容表执行兼容迁移后写入演示数据。

```bash
pnpm install
make core-run
```

另开终端启动两个前端：

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

仓库根目录的 `.env` 不会被 Go、Next.js 或 Vite 自动加载。传入变量时不要直接 `source .env`（bcrypt 哈希包含 `$`），可使用：

```bash
env $(grep -Ev '^(#|$)' .env | xargs) make core-run
env $(grep -Ev '^(#|$)' .env | xargs) pnpm dev
```

Admin 的 `VITE_CORE_URL` 必须指向 Core（默认 `http://localhost:8080`），不是 Admin 的 `5173`。

## 配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CORE_ADDR` | `:8080` | Core 监听地址 |
| `CORE_DATABASE_PATH` | `./data/manifold.db` | SQLite 文件路径 |
| `CORE_ALLOWED_ORIGINS` | `http://localhost:3000,http://localhost:5173` | CORS 来源，逗号分隔 |
| `CORE_JWT_SECRET` | `manifold-dev-secret-change-me` | JWT 密钥，生产环境必须更换 |
| `CORE_ADMIN_USERNAME` | `admin` | 管理用户名 |
| `CORE_ADMIN_PASSWORD_HASH` | `.env.example` 中的 bcrypt 哈希 | 管理密码哈希，不要写明文 |
| `CORE_CONTENT_CACHE_TTL` | `30s` | 内容详情缓存 TTL |
| `CORE_STATS_CACHE_TTL` | `30s` | 统计缓存 TTL |
| `CORE_AUDIT_EVENT_BUFFER` | `256` | 审计队列容量 |
| `NEXT_PUBLIC_CORE_URL` | `http://localhost:8080` | Web 请求 Core 的地址 |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | canonical/metadata 基准地址 |
| `VITE_CORE_URL` | `http://localhost:8080` | Admin 请求 Core 的地址 |

本地默认管理账号为 `admin`，密码为 `password`。生产环境请立即通过 `CORE_ADMIN_USERNAME` 和 `CORE_ADMIN_PASSWORD_HASH` 替换。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 并行启动 Web 和 Admin，不启动 Core |
| `make core-run` | 启动 Go API |
| `pnpm build` | 构建全部 workspace |
| `pnpm check` | TypeScript 类型检查 |
| `pnpm test` | workspace 测试（不含 Go） |
| `make core-test` | `go test ./...` |
| `make test` | Go + workspace 测试 |
| `make check` | `go vet ./...` + TypeScript 检查 |
| `pnpm browser-install` | 安装 Chromium |
| `pnpm browser-test` | 临时启动三端，回归 Web 评论/反应和 Admin 审核 |
| `pnpm --filter @manifold/web lint` | Web ESLint |
| `pnpm --filter @manifold/admin lint` | Admin Oxlint |

浏览器脚本默认使用临时端口和数据库，结束后清理。已有 Chrome 可设置 `MANIFOLD_CHROME_PATH`；可用 `MANIFOLD_*` 覆盖地址、测试文章或凭据。连接外部服务会执行写操作，必须显式设置 `MANIFOLD_ALLOW_EXTERNAL_MUTATIONS=1`。

## 产品入口

### Web

- `/`：Profile、Now、统计和最近内容。
- `/writing`：公开内容归档。
- `/writing/:slug`：Markdown 详情、标签、评论和反应。

正文使用 `react-markdown` + `remark-gfm` + `rehype-sanitize`；评论无需注册，反应通过浏览器持久化的 `X-Visitor-ID` 区分访客。

### Admin

登录后提供 Dashboard、Content、Comments、Now、Settings 五个工作区，分别覆盖统计、草稿/发布、评论审核、当前状态和 Profile/Site 管理。Admin 使用 Core 签发的 Bearer JWT；当前没有公开注册、访客登录或多用户账号体系。

## Core API 概览

基础路径为 `/api/v1`。集合统一返回 `{ data, pagination }`；内容流支持 `kind`、`tag`、`q`、`cursor`、`limit`（`1..50`，默认 `20`）。

公开接口：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/healthz` | 健康检查和版本 |
| `GET` | `/api/v1/profile`、`/api/v1/site` | 资料和首页 composition |
| `GET` | `/api/v1/feed`、`/api/v1/content` | 内容流和筛选列表 |
| `GET` | `/api/v1/content/:slug` | Markdown 详情 |
| `GET/POST` | `/api/v1/content/:slug/comments` | 评论读取/提交 |
| `GET/PUT/DELETE` | `/api/v1/content/:slug/reactions/:kind` | `LIKE`、`FAVORITE` |
| `GET` | `/api/v1/now`、`/api/v1/stats` | 当前状态、统计 |

管理接口位于 `/api/v1/admin`，除 `POST /session` 外都需要 `Authorization: Bearer <token>`，覆盖 Profile、Site、Content、Comments、Now 和 Stats 的读写。

错误统一为 `{ error: { code, message, details?, requestId?, traceId? } }`；Core 会返回 `X-Request-ID` 和 `X-Trace-ID`。具体实现说明见 [`app/core/README.md`](app/core/README.md)、[`app/web/README.md`](app/web/README.md) 和 [`app/admin/README.md`](app/admin/README.md)。

## 数据与生命周期

- SQLite 由 Core 独占；store 负责建表、兼容旧列和种子数据。
- Content 类型为 `THOUGHT`、`ARTICLE`；状态为 `DRAFT`、`PUBLISHED`、`DELETED`。
- 更新带 `expectedVersion`；版本冲突会拒绝覆盖。
- 删除是软删除；草稿和已删除内容不进入公开接口。
- 评论创建后是 `PENDING`，批准后才公开。
- 反应按 `(content, visitor, kind)` 唯一，`PUT` / `DELETE` 幂等。
- 内容详情和已发布统计使用 TTL 缓存；状态变化会失效对应缓存。
- 审计事件通过有界异步队列写入 SQLite；队列满不会让原始请求失败。

## 当前边界

P0 聚焦首页、Profile、Site、Now、Thoughts、Writings、Comments、Reactions 和 Stats。跨资源搜索、links、媒体资产、经历详情和 research series 不属于当前产品范围。

## 贡献

提交前运行：

```bash
make test
make check
pnpm build
```

跨端类型先改 [`packages/contracts/src/index.ts`](packages/contracts/src/index.ts)，HTTP 调用通过 [`packages/sdk/src/index.ts`](packages/sdk/src/index.ts) 暴露；不要让前端直接拼接 Core 请求或访问 SQLite。提交信息使用 Conventional Commits，例如 `feat(core): add entries endpoint`。更多约定见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。
