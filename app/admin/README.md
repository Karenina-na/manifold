# `app/admin`

Manifold 私有管理端，负责登录、Dashboard、Thought/Article 内容编辑、评论管理、Profile 和公开 composition 设置；Settings 通过 Core 的独立 Thoughts 配置接口选择公开 Thoughts 页的置顶内容。

当前详细契约见 [`docs/admin.md`](../../docs/admin.md)，其中记录 Vite + React 19、Mantine、TanStack Query、React Hook Form/Zod、Recharts、Lucide、vditor（Context tab 的 IR 编辑器，运行时资源由 `scripts/sync-vditor.mjs` 本地化到 `public/vditor/`，不依赖第三方 CDN）、PWA 架构与 `@manifold/render` 共享渲染包，以及 SDK 调用、会话、query key、表单字段和状态流。

## 运行

```bash
pnpm --filter @manifold/admin dev
pnpm --filter @manifold/admin typecheck
pnpm --filter @manifold/admin lint
pnpm --filter @manifold/admin test
pnpm --filter @manifold/admin build
pnpm --filter @manifold/admin preview
```

根目录 `pnpm dev` 使用开发 supervisor 同时启动 Web 和 Admin；任一前端异常退出（包括 `SIGTERM` 导致的退出码 143）会按退避自动重启。直接运行本工作区命令时仍由调用方负责进程重启。

配置 `VITE_CORE_URL` 指向 Core，默认是 `http://localhost:8080`。根目录 `pnpm browser-test` 会验证 Web -> Core -> Admin 的联调流程。

生产发布使用 Vite 的 `dist` 静态产物，不使用 `vite preview`。根目录 `pnpm package:release -- --env .env.production` 将 `VITE_CORE_URL` 与 `VITE_WEB_URL` 固化到 Admin bundle；独立域名反向代理通过 `ADMIN_PUBLIC_URL` 记录 Admin 的公开 origin。管理员密码 hash 为空时，打包脚本生成随机初始密码、写回 hash，并在当前终端显示一次。包内 supervisor 通过无第三方运行时依赖的 Node 静态服务器在 `:5173` 提供 dist、PWA 和 vditor 资源。

目录约定：`src/app/` 放登录、导航和错误恢复壳；`src/workspaces/` 放 Dashboard、Profile、Writings、Thoughts、Media、Comments 页面；`src/features/settings/` 聚合 Settings 页面、校验与安全面板；`src/components/common/`、`src/components/content/`、`src/components/forms/` 按职责放跨工作区组件；`src/i18n/` 放语言资源与格式化；`src/lib/` 放 SDK client、观测和无界面 hook。组件文件用 PascalCase，工具与 hook 用 kebab-case。

修改 Admin 工作区、API 调用、表单或依赖时，必须同时检查 [`docs/admin.md`](../../docs/admin.md)、[`docs/core.md`](../../docs/core.md)、[`packages/sdk/README.md`](../../packages/sdk/README.md) 和根目录 [`AGENTS.md`](../../AGENTS.md)。
