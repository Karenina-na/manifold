# `app/admin`

Manifold 私有管理端，负责登录、Dashboard、Thought/Article 内容编辑、评论审核、Now、Profile 和公开 composition 设置；Settings 通过 Core 的独立 Thoughts 配置接口选择公开 Thoughts 页的置顶内容。

当前详细契约见 [`docs/admin.md`](../../docs/admin.md)，其中记录 Vite + React 19、Mantine、TanStack Query、React Hook Form/Zod、Recharts、Lucide、PWA 架构，以及 SDK 调用、会话、query key、表单字段和状态流。

## 运行

```bash
pnpm --filter @manifold/admin dev
pnpm --filter @manifold/admin typecheck
pnpm --filter @manifold/admin lint
pnpm --filter @manifold/admin build
pnpm --filter @manifold/admin preview
```

配置 `VITE_CORE_URL` 指向 Core，默认是 `http://localhost:8080`。根目录 `pnpm browser-test` 会验证 Web -> Core -> Admin 的联调流程。

修改 Admin 工作区、API 调用、表单或依赖时，必须同时检查 [`docs/admin.md`](../../docs/admin.md)、[`docs/core.md`](../../docs/core.md)、[`packages/sdk/README.md`](../../packages/sdk/README.md) 和根目录 [`AGENTS.md`](../../AGENTS.md)。
