# `app/core`

Manifold 唯一的后端服务和业务数据所有者，提供 REST/JSON API、DB 会话校验的 JWT/Casbin 鉴权（可撤销会话、在线改密码）、SQLite、内容生命周期、首页时间线聚合、公开正文摘录派生、Thoughts 归档与置顶配置、评论管理、访客反应、统计、缓存、审计，以及 Admin 专用的场景化 Agent、临时 conversation history、session 记忆、SQLite 运行设置与 SSE 运行流。

当前详细契约见 [`docs/core.md`](../../docs/core.md)，其中记录 Core 的路由、公开/Admin API、请求/响应、错误 envelope、`THOUGHT`/`ARTICLE` 模型、metadata 校验、版本控制、迁移、SQLite schema、配置、缓存和异步审计架构。

源码以 `internal/` 下的职责包组织：`handler` 负责 HTTP 边界，`application` 编排写用例，`store` 隔离 SQLite，`agent` 由 `runtime`、`provider`、`conversation`、`memory`、`prompt`、`scenario`、`tool` 七个模块组成；`conversation/compact` 负责 conversation summary 的自动/手动增量策略、trace 清理、专用 Prompt 与 LLM 压缩。Conversation、session-scoped Memory 与 Runtime Context 各自独立，Runtime 负责顶层运行编排且其余模块不依赖 Runtime。`github` 封装 GitHub OAuth 上游通信，`system` 采样主机资源，其余鉴权、链、缓存、事件、模型与 seed 各自独立。

## 运行

```bash
make core-run
cd app/core
go test -count=1 ./...
go vet ./...
```

默认监听 `:8080`，默认数据库为 `./data/manifold.db`，配置使用 `CORE_*` 环境变量。通过反向代理运行时，`CORE_TRUSTED_PROXY_CIDRS` 控制哪些 TCP 对端可以用清洗后的 `X-Real-IP` 参与限流分桶；默认不信任任何代理。修改 Core 时必须同步 [`docs/core.md`](../../docs/core.md)、[`docs/admin.md`](../../docs/admin.md)、[`docs/decisions/web.md`](../../docs/decisions/web.md)、[`packages/contracts/README.md`](../../packages/contracts/README.md)、[`packages/sdk/README.md`](../../packages/sdk/README.md) 和根目录 [`AGENTS.md`](../../AGENTS.md)。

## Prompt 预览

使用当前 Scenario、工具注册表和 Runtime Context 组装完整 system prompt 及对话上下文：

```bash
cd app/core
go run ./scripts/build-system-prompt
go run ./scripts/build-system-prompt "请说明当前可用能力"
```

脚本使用临时 SQLite 数据库，不连接外部 Provider，也不会修改项目数据库。

根目录 `pnpm package:release -- --env .env.production` 会以 `CGO_ENABLED=0 GOOS=linux GOARCH=amd64` 生成发布包内的 `bin/manifold-core`。若生产配置中的管理员密码 hash 为空，打包脚本通过 `cmd/password-hash` 生成 bcrypt hash、写回配置并在终端一次性显示随机初始密码；该 hash 仅在首次启动时播种 `admin_credentials`，之后以 DB 行为权威（在线改密码写库、重启保留）。包内 supervisor 从发布根目录启动 Core，并把生产配置作为环境变量传入；相对数据库路径因此稳定落在 `data/manifold.db`。发布归档不携带数据库，公共 HTTP 契约不变。
