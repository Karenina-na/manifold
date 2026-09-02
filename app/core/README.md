# `app/core`

Manifold 唯一的后端服务和业务数据所有者，提供 REST/JSON API、JWT/Casbin 鉴权、SQLite、内容生命周期、公开正文摘录派生、Thoughts 归档与置顶配置、评论审核、访客反应、统计、缓存和审计。

当前详细契约见 [`docs/core.md`](../../docs/core.md)，其中记录 Core 的路由、公开/Admin API、请求/响应、错误 envelope、`THOUGHT`/`ARTICLE` 模型、metadata 校验、版本控制、迁移、SQLite schema、配置、缓存和异步审计架构。

## 运行

```bash
make core-run
cd app/core
go test -count=1 ./...
go vet ./...
```

默认监听 `:8080`，默认数据库为 `./data/manifold.db`，配置使用 `CORE_*` 环境变量。通过反向代理运行时，`CORE_TRUSTED_PROXY_CIDRS` 控制哪些 TCP 对端可以用清洗后的 `X-Real-IP` 参与限流分桶；默认不信任任何代理。修改 Core 时必须同步 [`docs/core.md`](../../docs/core.md)、[`docs/admin.md`](../../docs/admin.md)、[`docs/decisions/web.md`](../../docs/decisions/web.md)、[`packages/contracts/README.md`](../../packages/contracts/README.md)、[`packages/sdk/README.md`](../../packages/sdk/README.md) 和根目录 [`AGENTS.md`](../../AGENTS.md)。

根目录 `pnpm package:release -- --env .env.production` 会以 `CGO_ENABLED=0 GOOS=linux GOARCH=amd64` 生成发布包内的 `bin/manifold-core`。若生产配置中的管理员密码 hash 为空，打包脚本通过 `cmd/password-hash` 生成 bcrypt hash、写回配置并在终端一次性显示随机初始密码。包内 supervisor 从发布根目录启动 Core，并把生产配置作为环境变量传入；相对数据库路径因此稳定落在 `data/manifold.db`。发布归档不携带数据库，公共 HTTP 契约不变。
