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

默认监听 `:8080`，默认数据库为 `./data/manifold.db`，配置使用 `CORE_*` 环境变量。修改 Core 时必须同步 [`docs/core.md`](../../docs/core.md)、[`docs/admin.md`](../../docs/admin.md)、[`docs/decisions/web.md`](../../docs/decisions/web.md)、[`packages/contracts/README.md`](../../packages/contracts/README.md)、[`packages/sdk/README.md`](../../packages/sdk/README.md) 和根目录 [`AGENTS.md`](../../AGENTS.md)。
