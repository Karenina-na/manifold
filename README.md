# Manifold

Manifold 是一个 API-First 的个人数字化心智空间，用于展示经历、文章、思考与研究。

## Quick Start

```bash
pnpm install
cp .env.example .env
make core-test
pnpm build
```

`app/admin` 使用官方 create-vite 初始化，`app/web` 使用官方 create-next-app 初始化。

Core 使用 Go 标准模块初始化流程，依赖通过 `go get` 与 `go mod tidy` 管理。

## Repository

- `app/core`：Go HTTP API、配置、鉴权、SQLite 存储和领域模型。
- `app/web`：Next.js 展示端。
- `app/admin`：React + Vite PWA 管理端。
- `packages/contracts`：跨端 TypeScript API 契约。
- `packages/sdk`：基于原生 fetch 的强类型 API 客户端。
- `docs/core.md`、`docs/web.md`、`docs/admin.md`：接口、模块和验收契约。

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

接口契约、资源边界和演进顺序见 [`docs/core.md`](docs/core.md)；Web 与 Admin 的消费约定分别见 [`docs/web.md`](docs/web.md) 和 [`docs/admin.md`](docs/admin.md)。

## Project Status

当前仓库已完成第一阶段 API 契约、Core MVP、Web 阅读流和 Admin 管理流的基础实现，包含服务端分页/筛选、内容并发版本控制以及 Profile、Site composition、Projects 配置管理。真实浏览器集成验证和 Experiences、Media、ResearchSeries 等扩展资源仍按独立切片推进。

## Contributing

提交前运行：

```bash
make test
make check
```

提交信息使用 Conventional Commits，例如 `feat(core): add entries endpoint`。
