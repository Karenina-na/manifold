# Manifold

Manifold 是一个 API-First 的个人数字化心智空间，用于展示经历、文章、思考与研究。

## Quick Start

```bash
pnpm install
cp .env.example .env
make core-test
pnpm build
```

`apps/admin` 使用官方 create-vite 初始化，`apps/web` 使用官方 create-next-app 初始化。

Core 使用 Go 标准模块初始化流程，依赖通过 `go get` 与 `go mod tidy` 管理。

## Repository

- `apps/core`：Go HTTP API、配置、鉴权、SQLite 存储和领域模型。
- `apps/web`：Next.js 展示端。
- `apps/admin`：React + Vite PWA 管理端。
- `packages/contracts`：跨端 TypeScript API 契约。
- `packages/sdk`：基于原生 fetch 的强类型 API 客户端。
- `docs/design-system`：现有设计系统与 token 合约。

## Development

```bash
# Terminal 1
make core-run

# Terminal 2
pnpm --filter @manifold/web dev

# Terminal 3
pnpm --filter @manifold/admin dev
```

## Commands

- `make core-run` 启动 Go API。
- `pnpm --filter @manifold/web dev` 启动 Web。
- `pnpm --filter @manifold/admin dev` 启动 Admin。
- `pnpm build` 构建全部 workspace。

完整 API 约定见 [`docs/api-spec.md`](docs/api-spec.md)，架构边界见 [`docs/architecture.md`](docs/architecture.md)。

## Project Status

当前仓库是第一阶段项目骨架：应用入口、Core 健康检查、公共 API 边界、共享 Contracts/SDK 和基础文档已经建立。内容 CRUD、鉴权管理、Markdown 渲染和部署流程将在后续独立提交中实现。

## Contributing

提交前运行：

```bash
make test
make check
```

提交信息使用 Conventional Commits，例如 `feat(core): add entries endpoint`。
